import { emptyArray } from '../api/empty_values.js';
import type { LibrarianStorage } from '../storage/types.js';
import type { GovernorContext } from '../api/governor_context.js';
import { getMethodPack } from './method_pack_service.js';

export type MethodFamilyId =
  | 'MF-01' | 'MF-02' | 'MF-03' | 'MF-04' | 'MF-05' | 'MF-06' | 'MF-07'
  | 'MF-08' | 'MF-09' | 'MF-10' | 'MF-11' | 'MF-12' | 'MF-13' | 'MF-14';

export interface MethodGuidance {
  families: MethodFamilyId[];
  hints: string[];
  source: 'llm' | 'uc' | 'taskType' | 'intent';
  packId?: string;
}

const UC_CLUSTER_RANGES: Array<{ name: string; min: number; max: number; families: MethodFamilyId[] }> = [
  { name: 'Orientation', min: 1, max: 10, families: ['MF-01', 'MF-03', 'MF-10'] },
  { name: 'Architecture', min: 11, max: 20, families: ['MF-03', 'MF-05', 'MF-04'] },
  { name: 'Ownership', min: 21, max: 30, families: ['MF-10', 'MF-11', 'MF-01'] },
  { name: 'Navigation', min: 31, max: 40, families: ['MF-03', 'MF-04', 'MF-02'] },
  { name: 'Impact', min: 41, max: 50, families: ['MF-03', 'MF-04', 'MF-07'] },
  { name: 'Behavior', min: 51, max: 60, families: ['MF-02', 'MF-04', 'MF-05'] },
  { name: 'Data', min: 61, max: 70, families: ['MF-06', 'MF-04', 'MF-08'] },
  { name: 'Build/Test', min: 71, max: 80, families: ['MF-09', 'MF-04'] },
  { name: 'Runtime', min: 81, max: 90, families: ['MF-07', 'MF-04', 'MF-10'] },
  { name: 'Performance', min: 91, max: 100, families: ['MF-07', 'MF-04'] },
  { name: 'Security', min: 101, max: 110, families: ['MF-08', 'MF-04'] },
  { name: 'Compliance', min: 111, max: 120, families: ['MF-08', 'MF-04', 'MF-09'] },
  { name: 'Config', min: 121, max: 130, families: ['MF-10', 'MF-04', 'MF-09'] },
  { name: 'Refactor', min: 131, max: 140, families: ['MF-05', 'MF-04', 'MF-01'] },
  { name: 'API', min: 141, max: 150, families: ['MF-05', 'MF-03', 'MF-04'] },
  { name: 'Release', min: 151, max: 160, families: ['MF-09', 'MF-04'] },
  { name: 'Reliability', min: 161, max: 170, families: ['MF-12', 'MF-07', 'MF-04'] },
  { name: 'Language', min: 171, max: 180, families: ['MF-03', 'MF-10', 'MF-01'] },
  { name: 'Multi-Repo', min: 181, max: 190, families: ['MF-03', 'MF-05', 'MF-10'] },
  { name: 'Product', min: 191, max: 200, families: ['MF-01', 'MF-10', 'MF-04'] },
  { name: 'Project', min: 201, max: 210, families: ['MF-11', 'MF-01', 'MF-04'] },
  { name: 'Agentic', min: 211, max: 220, families: ['MF-11', 'MF-10', 'MF-04'] },
  { name: 'Documentation', min: 221, max: 230, families: ['MF-10', 'MF-04'] },
  { name: 'Knowledge', min: 231, max: 240, families: ['MF-10', 'MF-04'] },
  { name: 'Edge', min: 241, max: 250, families: ['MF-02', 'MF-04', 'MF-12'] },
  { name: 'Synthesis', min: 251, max: 260, families: ['MF-01', 'MF-05', 'MF-10', 'MF-04'] },
];

const TASK_TYPE_FAMILY_HINTS: Record<string, MethodFamilyId[]> = {
  bug: ['MF-02', 'MF-04'],
  incident: ['MF-02', 'MF-12', 'MF-04'],
  refactor: ['MF-05', 'MF-01', 'MF-04'],
  performance: ['MF-07', 'MF-04'],
  security: ['MF-08', 'MF-04'],
  release: ['MF-09', 'MF-04'],
  onboarding: ['MF-01', 'MF-03', 'MF-10'],
};

export function resolveMethodFamilies(options: {
  ucIds?: string[];
  taskType?: string;
  intent?: string;
}): { families: MethodFamilyId[]; source: 'uc' | 'taskType' | 'intent' } | null {
  const ucIds = options.ucIds?.filter(Boolean) ?? emptyArray<string>();
  const taskType = options.taskType?.toLowerCase();
  const families = new Set<MethodFamilyId>();
  let source: 'uc' | 'taskType' | 'intent' = 'intent';

  if (ucIds.length > 0) {
    source = 'uc';
    for (const ucId of ucIds) {
      const numeric = Number.parseInt(ucId.replace(/[^0-9]/g, ''), 10);
      if (!Number.isFinite(numeric)) continue;
      const cluster = UC_CLUSTER_RANGES.find((entry) => numeric >= entry.min && numeric <= entry.max);
      if (cluster) {
        for (const family of cluster.families) families.add(family);
      }
    }
  }

  if (families.size === 0 && taskType) {
    source = 'taskType';
    const mapped = TASK_TYPE_FAMILY_HINTS[taskType];
    if (mapped) {
      for (const family of mapped) families.add(family);
    }
  }

  if (families.size === 0 && options.intent) {
    source = 'intent';
    const intent = options.intent.toLowerCase();
    const add = (family: MethodFamilyId) => families.add(family);
    if (intent.includes('perf') || intent.includes('latency') || intent.includes('slow')) add('MF-07');
    if (intent.includes('security') || intent.includes('auth') || intent.includes('vuln')) add('MF-08');
    if (intent.includes('refactor') || intent.includes('cleanup')) add('MF-05');
    if (intent.includes('test') || intent.includes('coverage')) add('MF-04');
    if (intent.includes('incident') || intent.includes('outage') || intent.includes('rollback')) add('MF-12');
    if (intent.includes('release') || intent.includes('deploy')) add('MF-09');
    if (intent.includes('architecture') || intent.includes('design')) add('MF-05');
    if (intent.includes('ownership') || intent.includes('owner') || intent.includes('review')) add('MF-10');
    if (intent.includes('dependency') || intent.includes('impact')) add('MF-03');
  }

  if (families.size === 0) {
    return null;
  }

  return { families: Array.from(families), source };
}

export async function resolveMethodGuidance(options: {
  ucIds?: string[];
  taskType?: string;
  intent?: string;
  maxHints?: number;
  storage?: LibrarianStorage;
  llmProvider?: 'claude' | 'codex';
  llmModelId?: string;
  llmTimeoutMs?: number;
  governorContext?: GovernorContext;
}): Promise<MethodGuidance | null> {
  const selection = resolveMethodFamilies(options);
  if (!selection) return null;
  if (!options.storage || !options.llmProvider || !options.llmModelId) {
    throw new Error('unverified_by_trace(provider_unavailable): method guidance requires storage and LLM configuration');
  }
  const pack = await getMethodPack({
    storage: options.storage,
    families: selection.families,
    ucIds: options.ucIds,
    intent: options.intent,
    llmProvider: options.llmProvider,
    llmModelId: options.llmModelId,
    llmTimeoutMs: options.llmTimeoutMs,
    governorContext: options.governorContext,
  });
  const maxHints = options.maxHints ?? 6;
  const hints = pack.hints.slice(0, maxHints);
  return {
    families: selection.families,
    hints,
    source: 'llm',
    packId: pack.cache_key,
  };
}
