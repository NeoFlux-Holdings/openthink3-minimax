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
  description?: string;
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
  status: 'native' | 'external';
};

export const SKILLS: Skill[] = [
  {
    id: 'gbrain-search',
    name: 'Brain Search',
    description:
      'Hybrid recall: vector search (BGE-small) over D1 pages + FTS5 keyword search. Re-ranks with combined score.',
    defaultEnabled: true,
    requiresConfig: false,
    workerEndpoint: '/api/skill/search',
    triggerKeywords: ['search', 'recall', 'find', 'lookup', 'what did', 'where is'],
    configFields: [],
    status: 'native',
  },
  {
    id: 'gbrain-think',
    name: 'Brain Think',
    description:
      'Synthesis layer: recalls relevant pages, then streams a Llama 3.3 70B answer with citations.',
    defaultEnabled: true,
    requiresConfig: false,
    workerEndpoint: '/api/skill/think',
    triggerKeywords: ['think', 'synthesize', 'explain', 'summarize', 'what do i know'],
    configFields: [],
    status: 'native',
  },
  {
    id: 'gbrain-capture',
    name: 'Brain Capture',
    description:
      'Write a new page to gbrain (D1 + Vectorize + FTS5) from a chat message or selected text.',
    defaultEnabled: true,
    requiresConfig: false,
    workerEndpoint: '/api/skill/capture',
    triggerKeywords: ['capture', 'remember', 'save to brain', 'note this'],
    configFields: [],
    status: 'native',
  },
  {
    id: 'gstack-run',
    name: 'GStack Run',
    description:
      'Execution stack: dispatches commands to the OrchestratorDO MCP server. Cloudflare-native tools.',
    defaultEnabled: true,
    requiresConfig: false,
    workerEndpoint: '/api/skill/run',
    triggerKeywords: ['deploy', 'run', 'execute', 'schedule', 'tunnel', 'pr'],
    configFields: [],
    status: 'native',
  },
  {
    id: 'gbrain-evals',
    name: 'Brain Evals',
    description:
      'Runs the in-worker eval suite (Llama 3.1 8B) nightly via cron, posts scorecards to the benchmarks page.',
    defaultEnabled: true,
    requiresConfig: false,
    workerEndpoint: '/api/skill/evals',
    triggerKeywords: ['benchmark', 'eval', 'scorecard'],
    configFields: [],
    status: 'native',
  },
];

const enabledKey = (id: SkillId) => `openthink_skill_${id}_enabled`;

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

export function isSkillConfigured(_id: SkillId): boolean {
  return true; // all skills are native + auto-configured
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
      config: {},
    },
  };
}

export function skillWorkerUrl(skill: Skill, apiUrl: string): string {
  const base = apiUrl.endsWith('/') ? apiUrl.slice(0, -1) : apiUrl;
  return `${base}${skill.workerEndpoint}`;
}
