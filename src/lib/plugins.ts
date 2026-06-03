export type PluginId = 'gbrain' | 'gstack' | 'exe-dev' | 'deepwiki';

export type ConfigField = {
  key: string;
  label: string;
  type: 'url' | 'token' | 'path' | 'text';
  required: boolean;
  placeholder?: string;
};

export type PluginHook =
  | { type: 'chat-message-before'; handler: 'log' | 'enrich' | 'capture' }
  | { type: 'chat-message-after'; handler: 'log' | 'enrich' }
  | { type: 'tool-execute-before'; handler: 'log' }
  | { type: 'cron-daily'; handler: 'gbrain-dream' | 'gbrain-evals' };

export type PluginTool = {
  name: string;
  description: string;
  schema: Record<string, unknown>;
  run: 'worker-endpoint' | 'local-function';
  workerEndpoint?: string;
};

export type OpenThinkPlugin = {
  id: PluginId;
  name: string;
  description: string;
  version: string;
  defaultEnabled: boolean;
  premium?: boolean;
  requiresConfig: boolean;
  configFields: ConfigField[];
  hooks: PluginHook[];
  tools: PluginTool[];
};

export type UserPlugin = {
  id: string;
  name: string;
  description: string;
  version: string;
  source: 'user';
  path: string;
};

export const PLUGINS: OpenThinkPlugin[] = [
  {
    id: 'gbrain',
    name: 'GBrain',
    description: 'PGLite-based personal knowledge layer with synthesis, graph traversal, and gap analysis. Pairs with the gbrain-search/gbrain-think/gbrain-capture skills.',
    version: '0.41.27.0',
    defaultEnabled: true,
    requiresConfig: true,
    configFields: [
      { key: 'gbrainServerUrl', label: 'GBrain server URL', type: 'url', required: true, placeholder: 'https://gbrain.example.com' },
      { key: 'gbrainToken', label: 'Auth token', type: 'token', required: true },
    ],
    hooks: [
      { type: 'chat-message-before', handler: 'capture' },
      { type: 'cron-daily', handler: 'gbrain-dream' },
    ],
    tools: [],
  },
  {
    id: 'gstack',
    name: 'GStack',
    description: 'Execution stack for the agent. Schedules crons, opens PRs, manages tunnels, deploys workers.',
    version: '0.13.0',
    defaultEnabled: true,
    premium: false,
    requiresConfig: true,
    configFields: [
      { key: 'gstackServerUrl', label: 'GStack server URL', type: 'url', required: true },
    ],
    hooks: [
      { type: 'tool-execute-before', handler: 'log' },
    ],
    tools: [],
  },
  {
    id: 'exe-dev',
    name: 'EXE.dev',
    description: 'Fallback VM execution for things CF Workers cannot do. Use for x86 binaries, FUSE mounts, >30s CPU workloads. Default OFF.',
    version: '0.4.0',
    defaultEnabled: false,
    premium: true,
    requiresConfig: true,
    configFields: [
      { key: 'exeApiKey', label: 'EXE API key', type: 'token', required: true },
    ],
    hooks: [],
    tools: [],
  },
  {
    id: 'deepwiki',
    name: 'DeepWiki',
    description: 'Indexes the OpenThink3 + gbrain + gstack + exe.dev + cloudflare repos for "ask the docs" answers. Default ON.',
    version: '1.0.0',
    defaultEnabled: true,
    requiresConfig: false,
    configFields: [],
    hooks: [],
    tools: [],
  },
];

const enabledKey = (id: PluginId) => `openthink_plugin_${id}_enabled`;
const configKey = (id: PluginId) => `openthink_plugin_${id}_config`;
const userPluginsKey = 'openthink_user_plugins';

export function getPlugin(id: PluginId): OpenThinkPlugin | undefined {
  return PLUGINS.find((p) => p.id === id);
}

export function listPlugins(): OpenThinkPlugin[] {
  return PLUGINS.slice();
}

export function isPluginEnabled(id: PluginId): boolean {
  if (typeof window === 'undefined') return getPlugin(id)?.defaultEnabled ?? false;
  const stored = localStorage.getItem(enabledKey(id));
  if (stored === null) return getPlugin(id)?.defaultEnabled ?? false;
  return stored === 'true';
}

export function setPluginEnabled(id: PluginId, enabled: boolean): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(enabledKey(id), String(enabled));
  window.dispatchEvent(new Event('storage'));
}

export function getPluginConfig(id: PluginId): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const raw = localStorage.getItem(configKey(id));
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, string>;
    }
  } catch {
    return {};
  }
  return {};
}

export function setPluginConfig(id: PluginId, config: Record<string, string>): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(configKey(id), JSON.stringify(config));
  window.dispatchEvent(new Event('storage'));
}

export function isPluginConfigured(id: PluginId): boolean {
  const plugin = getPlugin(id);
  if (!plugin || !plugin.requiresConfig) return true;
  const config = getPluginConfig(id);
  return plugin.configFields
    .filter((f) => f.required)
    .every((f) => (config[f.key] ?? '').trim().length > 0);
}

export function listEnabledPlugins(): OpenThinkPlugin[] {
  return PLUGINS.filter((p) => isPluginEnabled(p.id));
}

export function listUserPlugins(): UserPlugin[] {
  if (typeof window === 'undefined') return [];
  const raw = localStorage.getItem(userPluginsKey);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as UserPlugin[];
  } catch {
    return [];
  }
  return [];
}

export function addUserPlugin(plugin: UserPlugin): void {
  if (typeof window === 'undefined') return;
  const current = listUserPlugins();
  const next = current.filter((p) => p.id !== plugin.id).concat(plugin);
  localStorage.setItem(userPluginsKey, JSON.stringify(next));
  window.dispatchEvent(new Event('storage'));
}

export function removeUserPlugin(id: string): void {
  if (typeof window === 'undefined') return;
  const next = listUserPlugins().filter((p) => p.id !== id);
  localStorage.setItem(userPluginsKey, JSON.stringify(next));
  window.dispatchEvent(new Event('storage'));
}

export async function scanUserPlugins(): Promise<UserPlugin[]> {
  if (typeof window === 'undefined') return [];
  return listUserPlugins();
}

export type HookContext = {
  message: string;
  threadId: string;
  plugin: OpenThinkPlugin;
};

export type HookResult = {
  plugin: PluginId;
  hook: PluginHook['type'];
  handler: PluginHook['handler'];
  captured: boolean;
  detail?: string;
};

export async function dispatchChatMessageBefore(
  message: string,
  threadId: string,
): Promise<HookResult[]> {
  const results: HookResult[] = [];
  for (const plugin of listEnabledPlugins()) {
    for (const hook of plugin.hooks) {
      if (hook.type !== 'chat-message-before') continue;
      if (hook.handler === 'capture' && plugin.id === 'gbrain') {
        results.push({
          plugin: plugin.id,
          hook: hook.type,
          handler: hook.handler,
          captured: true,
          detail: `gbrain capture "${message.slice(0, 60)}${message.length > 60 ? '…' : ''}" (stub, thread=${threadId})`,
        });
        continue;
      }
      if (hook.handler === 'log' || hook.handler === 'enrich') {
        results.push({
          plugin: plugin.id,
          hook: hook.type,
          handler: hook.handler,
          captured: true,
          detail: `${plugin.id}.${hook.handler} (stub)`,
        });
      }
    }
  }
  return results;
}

export function summarizePluginHooks(results: HookResult[]): string {
  const parts: string[] = [];
  for (const r of results) {
    if (!r.captured) continue;
    parts.push(r.detail ?? `${r.plugin}.${r.handler}`);
  }
  return parts.join(' · ');
}
