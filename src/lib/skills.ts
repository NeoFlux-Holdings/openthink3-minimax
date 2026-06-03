export type SkillId =
  | 'gbrain-search'
  | 'gbrain-think'
  | 'gbrain-capture'
  | 'gstack-run'
  | 'gbrain-evals';

export type ConfigField = {
  key: string;
  label: string;
  type: 'url' | 'password' | 'text';
  required: boolean;
  placeholder?: string;
};

export type Skill = {
  id: SkillId;
  name: string;
  description: string;
  defaultEnabled: boolean;
  requiresConfig: boolean;
  workerEndpoint: string;
  triggerKeywords: string[];
  configFields: ConfigField[];
  premium?: boolean;
};

export const SKILLS: Skill[] = [
  {
    id: 'gbrain-search',
    name: 'Brain Search',
    description: "Hybrid retrieval across the user's brain. Surfaces top pages by vector + BM25 + RRF + graph signals.",
    defaultEnabled: true,
    requiresConfig: true,
    workerEndpoint: '/api/gbrain/search',
    triggerKeywords: ['search', 'recall', 'find', 'lookup', 'what did', 'where is'],
    configFields: [
      { key: 'gbrainUrl', label: 'Brain server URL', type: 'url', required: true, placeholder: 'https://brain.example.com' },
      { key: 'gbrainToken', label: 'Auth token', type: 'password', required: true, placeholder: 'gbrain_xxx' },
    ],
  },
  {
    id: 'gbrain-think',
    name: 'Brain Think',
    description: 'Synthesis layer: composes a prose answer with citations + gap analysis. Costs LLM.',
    defaultEnabled: true,
    requiresConfig: true,
    workerEndpoint: '/api/gbrain/think',
    triggerKeywords: ['think', 'synthesize', 'explain', 'summarize', 'what do i know'],
    configFields: [
      { key: 'gbrainUrl', label: 'Brain server URL', type: 'url', required: true },
      { key: 'gbrainToken', label: 'Auth token', type: 'password', required: true },
    ],
  },
  {
    id: 'gbrain-capture',
    name: 'Brain Capture',
    description: "Write a new page to the user's brain from a chat message or selected text.",
    defaultEnabled: true,
    requiresConfig: true,
    workerEndpoint: '/api/gbrain/capture',
    triggerKeywords: ['capture', 'remember', 'save to brain', 'note this'],
    configFields: [
      { key: 'gbrainUrl', label: 'Brain server URL', type: 'url', required: true },
      { key: 'gbrainToken', label: 'Auth token', type: 'password', required: true },
    ],
  },
  {
    id: 'gstack-run',
    name: 'GStack Run',
    description: 'Execution stack: pick the right path, run cron jobs, deploy, open PRs, manage tunnels.',
    defaultEnabled: true,
    requiresConfig: true,
    workerEndpoint: '/api/gstack/run',
    triggerKeywords: ['deploy', 'run', 'execute', 'schedule', 'tunnel', 'pr'],
    configFields: [
      { key: 'gstackUrl', label: 'GStack server URL', type: 'url', required: true },
    ],
  },
  {
    id: 'gbrain-evals',
    name: 'Brain Evals',
    description: 'Run gbrain-evals benchmark nightly, post scorecards to /benchmarks on the deployed site.',
    defaultEnabled: false,
    requiresConfig: false,
    workerEndpoint: '/api/gbrain/evals/run',
    triggerKeywords: ['benchmark', 'eval', 'scorecard'],
    configFields: [],
  },
];

const enabledKey = (id: SkillId) => `openthink_skill_${id}_enabled`;
const configKey = (id: SkillId) => `openthink_skill_${id}_config`;

export function getSkill(id: SkillId): Skill | undefined {
  return SKILLS.find((s) => s.id === id);
}

export function isSkillEnabled(id: SkillId): boolean {
  if (typeof window === 'undefined') return getSkill(id)?.defaultEnabled ?? false;
  const stored = localStorage.getItem(enabledKey(id));
  if (stored === null) return getSkill(id)?.defaultEnabled ?? false;
  return stored === 'true';
}

export function setSkillEnabled(id: SkillId, enabled: boolean): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(enabledKey(id), String(enabled));
  window.dispatchEvent(new Event('storage'));
}

export function getSkillConfig(id: SkillId): Record<string, string> {
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

export function setSkillConfig(id: SkillId, config: Record<string, string>): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(configKey(id), JSON.stringify(config));
  window.dispatchEvent(new Event('storage'));
}

export function isSkillConfigured(id: SkillId): boolean {
  const skill = getSkill(id);
  if (!skill || !skill.requiresConfig) return true;
  const config = getSkillConfig(id);
  return skill.configFields
    .filter((f) => f.required)
    .every((f) => (config[f.key] ?? '').trim().length > 0);
}

export function clearSkillConfig(id: SkillId): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(configKey(id));
  window.dispatchEvent(new Event('storage'));
}

const hasKeyword = (haystack: string, needle: string) => haystack.indexOf(needle) !== -1;

export function detectSkill(message: string): Skill | null {
  const normalized = message.toLowerCase();
  for (const skill of SKILLS) {
    const lowerKeywords = skill.triggerKeywords.map((keyword) => keyword.toLowerCase());
    for (const keyword of lowerKeywords) {
      if (hasKeyword(normalized, keyword)) {
        return skill;
      }
    }
  }
  return null;
}

export type SkillInvocation = {
  skill: Skill;
  request: {
    prompt: string;
    config: Record<string, string>;
  };
};

export function buildSkillInvocation(message: string): SkillInvocation | null {
  const skill = detectSkill(message);
  if (!skill) return null;
  if (!isSkillEnabled(skill.id)) return null;
  if (skill.requiresConfig && !isSkillConfigured(skill.id)) return null;
  return {
    skill,
    request: {
      prompt: message,
      config: getSkillConfig(skill.id),
    },
  };
}

export function skillWorkerUrl(skill: Skill, apiUrl: string): string {
  const base = apiUrl.endsWith('/') ? apiUrl.slice(0, -1) : apiUrl;
  return `${base}${skill.workerEndpoint}`;
}
