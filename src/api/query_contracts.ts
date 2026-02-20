import { z } from 'zod';
import type {
  ContextPack,
  LibrarianQuery,
  LibrarianVersion,
  QueryIntentType,
  QueryResultContract,
  SynthesizedResponse,
} from '../types.js';

const IMPACT_TASK_TYPES = new Set([
  'impact',
  'impact_analysis',
  'change_impact',
  'breaking_change',
  'dependency',
]);

const INTENT_TO_TASK_TYPE: Record<QueryIntentType, string | undefined> = {
  understand: 'analysis',
  debug: 'debugging',
  refactor: 'refactor',
  impact: 'impact_analysis',
  security: 'security_audit',
  test: 'test_coverage',
  document: 'documentation',
  navigate: 'analysis',
  general: undefined,
};

export const QueryIntentTypeSchema = z.enum([
  'understand',
  'debug',
  'refactor',
  'impact',
  'security',
  'test',
  'document',
  'navigate',
  'general',
]);

export const QueryRelevantFileSchema = z.object({
  path: z.string().min(1),
  role: z.string().min(1),
  confidence: z.number().min(0).max(1),
}).strict();

export const UnderstandResponseSchema = z.object({
  intentType: z.literal('understand'),
  summary: z.string().min(1),
  keyFacts: z.array(z.string()),
  relevantFiles: z.array(QueryRelevantFileSchema),
  confidence: z.number().min(0).max(1),
  dataAge: z.string().min(1),
}).strict();

export const ImpactResponseSchema = z.object({
  intentType: z.literal('impact'),
  directImpact: z.array(z.object({
    file: z.string().min(1),
    reason: z.string().min(1),
  }).strict()),
  transitiveImpact: z.array(z.object({
    file: z.string().min(1),
    hopDistance: z.number().int().min(1),
  }).strict()),
  safeToChange: z.boolean(),
  riskFactors: z.array(z.string()),
  confidence: z.number().min(0).max(1),
}).strict();

export const QueryResultContractSchema = z.discriminatedUnion('intentType', [
  UnderstandResponseSchema,
  ImpactResponseSchema,
]);

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function normalizeIntentTypeFromTaskType(taskType: string | undefined): QueryIntentType {
  const normalized = taskType?.trim().toLowerCase();
  if (!normalized) return 'general';
  if (IMPACT_TASK_TYPES.has(normalized)) return 'impact';
  if (normalized.includes('debug')) return 'debug';
  if (normalized.includes('security')) return 'security';
  if (normalized.includes('test')) return 'test';
  if (normalized.includes('doc')) return 'document';
  if (normalized.includes('refactor')) return 'refactor';
  if (normalized.includes('navigate')) return 'navigate';
  return 'understand';
}

export function resolveQueryIntentType(query: LibrarianQuery): QueryIntentType {
  if (query.intentType) return query.intentType;
  return normalizeIntentTypeFromTaskType(query.taskType);
}

export function normalizeQueryIntentType(query: LibrarianQuery): LibrarianQuery {
  const intentType = resolveQueryIntentType(query);
  const inferredTaskType = query.taskType ?? INTENT_TO_TASK_TYPE[intentType];
  if (query.intentType === intentType && query.taskType === inferredTaskType) {
    return query;
  }
  return {
    ...query,
    intentType,
    taskType: inferredTaskType,
  };
}

function collectRelevantFilesFromPacks(packs: ContextPack[]): Array<{
  path: string;
  role: string;
  confidence: number;
}> {
  const files = new Map<string, { path: string; role: string; confidence: number }>();
  for (const pack of packs) {
    const role = pack.summary?.trim() || `Referenced in ${pack.packType}`;
    for (const path of pack.relatedFiles ?? []) {
      if (!path) continue;
      const confidence = clampConfidence(pack.confidence);
      const existing = files.get(path);
      if (!existing || confidence > existing.confidence) {
        files.set(path, { path, role, confidence });
      }
    }
  }
  return Array.from(files.values())
    .sort((left, right) => right.confidence - left.confidence)
    .slice(0, 25);
}

function collectRiskFactors(disclosures: string[] | undefined): string[] {
  const normalized = disclosures ?? [];
  const risks = normalized
    .filter((entry) => /critical|significant|failed|degraded|insufficient|missing/i.test(entry))
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return Array.from(new Set(risks)).slice(0, 20);
}

function toIsoString(indexedAt: LibrarianVersion['indexedAt']): string {
  if (indexedAt instanceof Date) {
    return indexedAt.toISOString();
  }
  return new Date(indexedAt).toISOString();
}

export function buildQueryResultContract(input: {
  query: LibrarianQuery;
  packs: ContextPack[];
  synthesis?: SynthesizedResponse;
  totalConfidence: number;
  version: LibrarianVersion;
  disclosures?: string[];
}): QueryResultContract | undefined {
  const { query, packs, synthesis, totalConfidence, version, disclosures } = input;
  const intentType = resolveQueryIntentType(query);
  if (intentType === 'impact') {
    const directImpact = collectRelevantFilesFromPacks(packs).map((entry) => ({
      file: entry.path,
      reason: entry.role,
    }));
    const riskFactors = collectRiskFactors(disclosures);
    const contractCandidate = {
      intentType: 'impact' as const,
      directImpact,
      transitiveImpact: [] as Array<{ file: string; hopDistance: number }>,
      safeToChange: directImpact.length <= 6 && riskFactors.length === 0 && clampConfidence(totalConfidence) >= 0.7,
      riskFactors,
      confidence: clampConfidence(totalConfidence),
    };
    const parsed = ImpactResponseSchema.safeParse(contractCandidate);
    return parsed.success ? parsed.data : undefined;
  }

  if (intentType !== 'understand') {
    return undefined;
  }

  const summary = synthesis?.answer?.trim()
    || packs[0]?.summary?.trim()
    || `Retrieved ${packs.length} context pack${packs.length === 1 ? '' : 's'} for "${query.intent}".`;
  const factsFromPacks = packs.flatMap((pack) => pack.keyFacts ?? []);
  const keyFacts = Array.from(new Set([
    ...(synthesis?.keyInsights ?? []),
    ...factsFromPacks,
  ].map((entry) => entry.trim()).filter((entry) => entry.length > 0))).slice(0, 12);
  const contractCandidate = {
    intentType: 'understand' as const,
    summary,
    keyFacts,
    relevantFiles: collectRelevantFilesFromPacks(packs),
    confidence: clampConfidence(totalConfidence),
    dataAge: toIsoString(version.indexedAt),
  };
  const parsed = UnderstandResponseSchema.safeParse(contractCandidate);
  return parsed.success ? parsed.data : undefined;
}
