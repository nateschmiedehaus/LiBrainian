import { safeJsonParse, getResultErrorMessage } from '../utils/safe_json.js';
import { resolveLlmServiceAdapter } from '../adapters/llm_service.js';
import type { LibrarianStorage } from '../storage/types.js';
import type { GovernorContext } from '../api/governor_context.js';
import { emptyArray } from '../api/empty_values.js';
import type { MethodFamilyId } from './method_guidance.js';
import { createHash } from 'crypto';

const CACHE_STATE_KEY = 'librarian.method_pack_cache.v1';
const SCHEMA_VERSION = 1;
const DEFAULT_MAX_AGE_DAYS = 7;
const PROMPT_MAX_INTENT_CHARS = 400;

/**
 * Evidence trace for LLM-generated method pack content.
 * Per UNDERSTANDING_LAYER mandate: all semantic claims require evidence.
 */
export interface MethodPackEvidence {
  /** LLM provider used (claude/codex) */
  provider: 'claude' | 'codex';
  /** Model ID that generated the pack */
  modelId: string;
  /** ISO timestamp of generation */
  generatedAt: string;
  /** SHA-256 digest of the prompt (first 16 chars) */
  promptDigest: string;
  /** Token count (if available from provider) */
  tokenCount?: number;
  /** Duration in milliseconds */
  durationMs?: number;
}

export interface MethodPack {
  schema_version: number;
  kind: 'LibrarianMethodPack.v1';
  families: MethodFamilyId[];
  uc_ids: string[];
  intent: string | null;
  hints: string[];
  steps: string[];
  required_inputs: string[];
  map_codes: string[];
  confidence: number;
  generated_at: string;
  /** Evidence trace for provenance (UNDERSTANDING_LAYER mandate) */
  evidence?: MethodPackEvidence;
}

export interface MethodPackCacheEntry extends MethodPack {
  cache_key: string;
  last_used_at: string;
  hit_count: number;
}

type MethodPackCache = {
  schema_version: number;
  updated_at: string;
  packs: Record<string, MethodPackCacheEntry>;
};

const METHOD_FAMILY_FOCUS: Record<MethodFamilyId, string> = {
  'MF-01': 'framing + planning',
  'MF-02': 'diagnostics + causality',
  'MF-03': 'dependency + graph reasoning',
  'MF-04': 'evidence + validation',
  'MF-05': 'architecture + design',
  'MF-06': 'data + schema',
  'MF-07': 'performance + scaling',
  'MF-08': 'security + compliance',
  'MF-09': 'delivery + operations',
  'MF-10': 'knowledge + trust',
  'MF-11': 'coordination + workflow',
  'MF-12': 'resilience + chaos',
  'MF-13': 'packaging + onboarding',
  'MF-14': 'model + provider governance',
};

const MAP_CODES = [
  'MAP.ID', 'MAP.STRUCT', 'MAP.ARCH', 'MAP.DEP', 'MAP.FLOW', 'MAP.CONTRACT',
  'MAP.IMPACT', 'MAP.OWNER', 'MAP.RISK', 'MAP.TEST', 'MAP.PERF', 'MAP.SEC',
  'MAP.COMP', 'MAP.QUALITY', 'MAP.EVOL', 'MAP.RATIONALE', 'MAP.RELEASE',
  'MAP.OBS', 'MAP.CONFIG', 'MAP.BUILD', 'MAP.RUNTIME', 'MAP.DOCS', 'MAP.API',
  'MAP.DATA', 'MAP.PRODUCT', 'MAP.PROJECT', 'MAP.LANG', 'MAP.AGENT', 'MAP.KNOW',
];

export async function getMethodPack(options: {
  storage: LibrarianStorage;
  families: MethodFamilyId[];
  ucIds?: string[];
  intent?: string | null;
  llmProvider: 'claude' | 'codex';
  llmModelId: string;
  llmTimeoutMs?: number;
  governorContext?: GovernorContext;
  maxAgeDays?: number;
}): Promise<MethodPackCacheEntry> {
  const families = Array.from(new Set(options.families)).sort();
  if (families.length === 0) {
    throw new Error('unverified_by_trace(method_pack_missing_families): no method families provided');
  }
  const ucIds = options.ucIds ? Array.from(new Set(options.ucIds)).sort() : emptyArray<string>();
  const intent = normalizeIntent(options.intent ?? null);
  const cacheKey = buildCacheKey(families, ucIds, intent);
  const cache = await loadCache(options.storage);
  const now = new Date().toISOString();
  const maxAgeDays = options.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS;

  const existing = cache.packs[cacheKey];
  if (existing && !isExpired(existing, maxAgeDays)) {
    existing.last_used_at = now;
    existing.hit_count = (existing.hit_count ?? 0) + 1;
    cache.updated_at = now;
    await saveCache(options.storage, cache);
    return existing;
  }

  const pack = await generateMethodPack({
    families,
    ucIds,
    intent,
    llmProvider: options.llmProvider,
    llmModelId: options.llmModelId,
    llmTimeoutMs: options.llmTimeoutMs,
    governorContext: options.governorContext,
  });
  const entry: MethodPackCacheEntry = {
    ...pack,
    cache_key: cacheKey,
    last_used_at: now,
    hit_count: 1,
  };
  cache.packs[cacheKey] = entry;
  cache.updated_at = now;
  await saveCache(options.storage, cache);
  return entry;
}

export async function preloadMethodPacks(options: {
  storage: LibrarianStorage;
  families: MethodFamilyId[];
  llmProvider: 'claude' | 'codex';
  llmModelId: string;
  llmTimeoutMs?: number;
  governorContext?: GovernorContext;
}): Promise<number> {
  let created = 0;
  for (const family of options.families) {
    await getMethodPack({
      storage: options.storage,
      families: [family],
      llmProvider: options.llmProvider,
      llmModelId: options.llmModelId,
      llmTimeoutMs: options.llmTimeoutMs,
      governorContext: options.governorContext,
    });
    created += 1;
  }
  return created;
}

async function generateMethodPack(options: {
  families: MethodFamilyId[];
  ucIds: string[];
  intent: string | null;
  llmProvider: 'claude' | 'codex';
  llmModelId: string;
  llmTimeoutMs?: number;
  governorContext?: GovernorContext;
}): Promise<MethodPack> {
  const llm = resolveLlmServiceAdapter();
  const familyContext = options.families
    .map((family) => `${family}: ${METHOD_FAMILY_FOCUS[family]}`)
    .join('\n');
  const prompt = [
    'You are Librarian. Build a method pack for an agent.',
    'Return JSON only, no commentary.',
    'Schema:',
    '{"schema_version":1,"kind":"LibrarianMethodPack.v1","families":["MF-01"],"uc_ids":["UC-001"],"intent":null,"hints":[""],"steps":[""],"required_inputs":[""],"map_codes":["MAP.ARCH"],"confidence":0.0,"generated_at":""}',
    'Rules:',
    '- Provide 3-8 hints, 3-10 steps, 3-12 required inputs.',
    '- Map codes must be chosen from the list below.',
    '- Keep hints short and action-oriented.',
    '',
    'Method families:',
    familyContext,
    '',
    `UC IDs: ${options.ucIds.join(', ') || 'none'}`,
    `Intent: ${options.intent ?? 'none'}`,
    '',
    `Map codes: ${MAP_CODES.join(', ')}`,
  ].join('\n');

  // Create evidence trace (UNDERSTANDING_LAYER mandate)
  const promptDigest = createHash('sha256').update(prompt).digest('hex').slice(0, 16);
  const startTime = Date.now();

  options.governorContext?.checkBudget();
  const response = await llm.chat({
    provider: options.llmProvider,
    modelId: options.llmModelId,
    messages: [
      { role: 'system', content: 'Return JSON only. Follow the schema exactly.' },
      { role: 'user', content: prompt },
    ],
    timeoutMs: options.llmTimeoutMs,
    governorContext: options.governorContext ?? undefined,
  });

  const durationMs = Date.now() - startTime;
  const generatedAt = new Date().toISOString();
  const parsed = parseMethodPackResponse(response.content, options.families);

  // Build evidence trace for provenance (token count not available from CLI-based providers)
  const evidence: MethodPackEvidence = {
    provider: options.llmProvider,
    modelId: options.llmModelId,
    generatedAt,
    promptDigest,
    durationMs,
  };

  return {
    ...parsed,
    generated_at: generatedAt,
    evidence,
  };
}

function parseMethodPackResponse(text: string, expectedFamilies: MethodFamilyId[]): MethodPack {
  const json = extractFirstJson(text);
  if (!json) {
    throw new Error('unverified_by_trace(provider_invalid_output): no JSON found in method pack response');
  }
  const parsed = safeJsonParse<Record<string, unknown>>(json);
  if (!parsed.ok) {
    const message = getResultErrorMessage(parsed) || 'invalid JSON';
    throw new Error(`unverified_by_trace(provider_invalid_output): ${message}`);
  }
  const value = parsed.value as Partial<MethodPack>;
  if (value.kind !== 'LibrarianMethodPack.v1' || value.schema_version !== 1) {
    throw new Error('unverified_by_trace(provider_invalid_output): invalid method pack schema');
  }
  const families = Array.isArray(value.families)
    ? value.families.filter((family): family is MethodFamilyId => typeof family === 'string')
    : emptyArray<MethodFamilyId>();
  if (families.length === 0) {
    throw new Error('unverified_by_trace(provider_invalid_output): missing method families');
  }
  return {
    schema_version: SCHEMA_VERSION,
    kind: 'LibrarianMethodPack.v1',
    families: expectedFamilies.length ? expectedFamilies : families,
    uc_ids: Array.isArray(value.uc_ids) ? value.uc_ids.filter((uc) => typeof uc === 'string') : emptyArray<string>(),
    intent: typeof value.intent === 'string' ? value.intent : null,
    hints: normalizeList(value.hints),
    steps: normalizeList(value.steps),
    required_inputs: normalizeList(value.required_inputs),
    map_codes: normalizeList(value.map_codes),
    confidence: clampConfidence(value.confidence),
    generated_at: value.generated_at ?? '',
  };
}

function extractFirstJson(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (char === '\\' && inString) {
      escape = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
    }
    if (!inString) {
      if (char === '{') depth += 1;
      if (char === '}') depth -= 1;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }
  return null;
}

function normalizeList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
    .slice(0, 24);
}

function clampConfidence(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0.6;
  return Math.max(0, Math.min(1, value));
}

function buildCacheKey(families: MethodFamilyId[], ucIds: string[], intent: string | null): string {
  const ucKey = ucIds.length ? `uc:${ucIds.join(',')}` : 'uc:none';
  const intentKey = intent ? `intent:${intent}` : 'intent:none';
  return `families:${families.join(',')}|${ucKey}|${intentKey}`;
}

function normalizeIntent(intent: string | null): string | null {
  if (!intent) return null;
  const trimmed = intent.trim().replace(/\s+/g, ' ');
  if (!trimmed) return null;
  return trimmed.length > PROMPT_MAX_INTENT_CHARS
    ? trimmed.slice(0, PROMPT_MAX_INTENT_CHARS)
    : trimmed;
}

async function loadCache(storage: LibrarianStorage): Promise<MethodPackCache> {
  const raw = await storage.getState(CACHE_STATE_KEY);
  if (!raw) {
    return { schema_version: SCHEMA_VERSION, updated_at: new Date().toISOString(), packs: {} };
  }
  const parsed = safeJsonParse<Record<string, unknown>>(raw);
  if (!parsed.ok || !parsed.value || typeof parsed.value !== 'object') {
    return { schema_version: SCHEMA_VERSION, updated_at: new Date().toISOString(), packs: {} };
  }
  const value = parsed.value as Partial<MethodPackCache>;
  if (value.schema_version !== SCHEMA_VERSION || !value.packs) {
    return { schema_version: SCHEMA_VERSION, updated_at: new Date().toISOString(), packs: {} };
  }
  return {
    schema_version: SCHEMA_VERSION,
    updated_at: value.updated_at ?? new Date().toISOString(),
    packs: value.packs ?? {},
  };
}

async function saveCache(storage: LibrarianStorage, cache: MethodPackCache): Promise<void> {
  await storage.setState(CACHE_STATE_KEY, JSON.stringify(cache));
}

function isExpired(entry: MethodPackCacheEntry, maxAgeDays: number): boolean {
  if (maxAgeDays <= 0) return false;
  const last = Date.parse(entry.generated_at || entry.last_used_at);
  if (!Number.isFinite(last)) return true;
  const ageMs = Date.now() - last;
  return ageMs > maxAgeDays * 24 * 60 * 60 * 1000;
}
