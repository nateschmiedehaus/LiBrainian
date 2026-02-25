import type {
  LibrarianQuery,
  LibrarianVersion,
  LlmRequirement,
} from '../types.js';

export type SemanticCacheCategory = 'lookup' | 'conceptual' | 'diagnostic';

const QUERY_CACHE_STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'does',
  'do',
  'describe',
  'for',
  'how',
  'in',
  'is',
  'me',
  'of',
  'or',
  'please',
  'the',
  'to',
  'what',
]);

const QUERY_CACHE_SYNONYMS: Record<string, string> = {
  authentication: 'auth',
  authenticate: 'auth',
  authenticated: 'auth',
  implementation: 'function',
  implementations: 'function',
  method: 'function',
  methods: 'function',
  routine: 'function',
  routines: 'function',
  authn: 'auth',
  login: 'auth',
  logins: 'auth',
  explain: 'describe',
  explains: 'describe',
  flow: 'workflow',
  flows: 'workflow',
  work: 'workflow',
  works: 'workflow',
};

function stripSimpleSuffix(token: string): string {
  if (token.length > 5 && token.endsWith('ing')) return token.slice(0, -3);
  if (token.length > 4 && token.endsWith('ed')) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith('es')) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith('s')) return token.slice(0, -1);
  return token;
}

export function normalizeIntentForCache(intent: string): string {
  const tokens = intent
    .toLowerCase()
    .match(/[a-z0-9_]+/g)
    ?.map((token) => QUERY_CACHE_SYNONYMS[token] ?? token)
    .map((token) => stripSimpleSuffix(token))
    .filter((token) => token.length > 1 && !QUERY_CACHE_STOP_WORDS.has(token));

  if (!tokens || tokens.length === 0) {
    return intent.trim().toLowerCase();
  }
  return Array.from(new Set(tokens)).sort().join(' ');
}

export function buildQueryCacheKey(
  query: LibrarianQuery,
  version: LibrarianVersion,
  llmRequirement: LlmRequirement,
  synthesisEnabled: boolean,
): string {
  const normalizedIntent = normalizeIntentForCache(query.intent);
  const files = query.affectedFiles?.slice().sort().join('|') ?? '';
  const filterKey = query.filter
    ? [
      query.filter.pathPrefix ?? '',
      query.filter.language ?? '',
      typeof query.filter.isExported === 'boolean' ? String(query.filter.isExported) : '',
      typeof query.filter.isPure === 'boolean' ? String(query.filter.isPure) : '',
      query.filter.excludeTests ? '1' : '0',
      typeof query.filter.maxFileSizeBytes === 'number' ? String(query.filter.maxFileSizeBytes) : '',
    ].join('|')
    : '';
  const workingFile = query.workingFile ?? '';
  const versionKey = `${version.string}:${version.indexedAt?.getTime?.() ?? 0}`;
  const embeddingRequirement = query.embeddingRequirement ?? '';
  const methodGuidanceFlag = query.disableMethodGuidance === true ? 1 : 0;
  const forceSummarySynthesisFlag = query.forceSummarySynthesis === true ? 1 : 0;
  const hydeExpansionFlag = query.hydeExpansion === true ? 1 : 0;
  return `${versionKey}|llm:${llmRequirement}|embed:${embeddingRequirement}|syn:${synthesisEnabled ? 1 : 0}|mg:${methodGuidanceFlag}|fs:${forceSummarySynthesisFlag}|hyde:${hydeExpansionFlag}|${query.depth}|${query.taskType ?? ''}|${query.minConfidence ?? ''}|${normalizedIntent}|${files}|wf:${workingFile}|flt:${filterKey}`;
}

export function classifySemanticCacheCategory(intent: string): SemanticCacheCategory {
  const normalized = intent.toLowerCase();
  if (
    /\b(error|exception|bug|failed|failing|timeout|trace|stack)\b/.test(normalized)
    || normalized.includes('why does')
  ) {
    return 'diagnostic';
  }
  if (
    /\bhow does\b/.test(normalized)
    || /\barchitecture\b/.test(normalized)
    || /\bdesign\b/.test(normalized)
    || /\boverview\b/.test(normalized)
    || /\bconcept\b/.test(normalized)
  ) {
    return 'conceptual';
  }
  return 'lookup';
}

export function buildSemanticCacheScopeSignature(query: LibrarianQuery): string {
  const files = query.affectedFiles?.slice().sort().join('|') ?? '';
  const filterKey = query.filter
    ? [
      query.filter.pathPrefix ?? '',
      query.filter.language ?? '',
      typeof query.filter.isExported === 'boolean' ? String(query.filter.isExported) : '',
      typeof query.filter.isPure === 'boolean' ? String(query.filter.isPure) : '',
      query.filter.excludeTests ? '1' : '0',
      typeof query.filter.maxFileSizeBytes === 'number' ? String(query.filter.maxFileSizeBytes) : '',
    ].join('|')
    : '';
  const hydeFlag = query.hydeExpansion === true ? '1' : '0';
  return [
    query.depth ?? 'L1',
    query.taskType ?? '',
    query.embeddingRequirement ?? '',
    hydeFlag,
    query.workingFile ?? '',
    files,
    filterKey,
  ].join('|');
}

export function computeSemanticIntentSimilarity(currentIntent: string, candidateIntent: string): number {
  if (currentIntent === candidateIntent) return 1;
  const currentTokens = new Set(currentIntent.split(' ').filter(Boolean));
  const candidateTokens = new Set(candidateIntent.split(' ').filter(Boolean));
  if (currentTokens.size === 0 || candidateTokens.size === 0) return 0;

  let overlap = 0;
  for (const token of currentTokens) {
    if (candidateTokens.has(token)) overlap += 1;
  }
  const union = new Set([...currentTokens, ...candidateTokens]).size;
  const jaccard = union > 0 ? overlap / union : 0;

  const total = currentTokens.size + candidateTokens.size;
  const dice = total > 0 ? (2 * overlap) / total : 0;
  return Math.max(jaccard, dice);
}
