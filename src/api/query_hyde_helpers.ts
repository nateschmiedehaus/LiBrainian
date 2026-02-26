import type { SimilarityResult } from '../storage/types.js';
import { emptyArray } from './empty_values.js';

const HYDE_RRF_K = 60;
const HYDE_MAX_STUB_CHARS = 1200;
const IDENTIFIER_EXPANSION_MAX_VARIANTS = 3;
const IDENTIFIER_EXPANSION_SYNONYMS: Record<string, string[]> = {
  permission: ['access', 'authorization', 'role'],
  permissions: ['access', 'authorization', 'roles'],
  auth: ['authentication', 'authorization'],
  authenticate: ['login', 'sign in'],
  login: ['authenticate', 'sign in'],
  user: ['account', 'principal', 'identity'],
  users: ['accounts', 'principals', 'identities'],
  route: ['endpoint', 'path'],
  routes: ['endpoints', 'paths'],
};

function normalizeIdentifierToken(token: string): string {
  return token.trim().toLowerCase();
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildIdentifierExpansionVariants(intent: string): string[] {
  const normalizedIntent = intent.trim();
  if (!normalizedIntent) return emptyArray<string>();

  const variants = new Set<string>();
  const tokens = (normalizedIntent.toLowerCase().match(/[a-z0-9]+/g) ?? [])
    .map((token) => normalizeIdentifierToken(token))
    .filter(Boolean);
  const tokenSet = new Set(tokens);

  for (const token of tokenSet) {
    const synonyms = Object.prototype.hasOwnProperty.call(IDENTIFIER_EXPANSION_SYNONYMS, token)
      ? IDENTIFIER_EXPANSION_SYNONYMS[token]
      : undefined;
    if (!Array.isArray(synonyms) || synonyms.length === 0) continue;
    const replacementPattern = new RegExp(`\\b${escapeRegex(token)}\\b`, 'ig');
    for (const synonym of synonyms.slice(0, 2)) {
      const replaced = normalizedIntent.replace(replacementPattern, synonym);
      if (replaced !== normalizedIntent) variants.add(replaced);
    }
  }

  if (
    tokenSet.has('user') &&
    (tokenSet.has('permission') ||
      tokenSet.has('permissions') ||
      tokenSet.has('role') ||
      tokenSet.has('roles'))
  ) {
    variants.add('canAccessRoute checkUserRole authorizeUser');
  }
  if (tokenSet.has('auth') || tokenSet.has('authenticate') || tokenSet.has('login')) {
    variants.add('authenticateUser authorizeRequest checkUserRole');
  }

  return Array.from(variants).slice(0, IDENTIFIER_EXPANSION_MAX_VARIANTS);
}

function buildHydePrompt(intent: string): string {
  return [
    'Write a TypeScript function signature plus a concise 2-line docstring that would implement this request.',
    'Keep it grounded to likely production code and avoid placeholders.',
    '',
    `Request: ${intent}`,
  ].join('\n');
}

function normalizeHydeExpansion(content: string): string | null {
  const withoutFences = content
    .replace(/^```[a-zA-Z]*\s*/g, '')
    .replace(/```$/g, '')
    .trim();
  if (!withoutFences) return null;
  return withoutFences.slice(0, HYDE_MAX_STUB_CHARS);
}

function fuseSimilarityResultListsWithRrf(
  resultLists: SimilarityResult[][],
  limit: number
): SimilarityResult[] {
  const rankScores = new Map<
    string,
    {
      entityId: string;
      entityType: SimilarityResult['entityType'];
      rrf: number;
      maxSimilarity: number;
    }
  >();

  const applyList = (results: SimilarityResult[]): void => {
    for (let i = 0; i < results.length; i += 1) {
      const result = results[i];
      const key = `${result.entityType}:${result.entityId}`;
      const existing = rankScores.get(key);
      const rrfIncrement = 1 / (HYDE_RRF_K + i + 1);
      if (existing) {
        existing.rrf += rrfIncrement;
        existing.maxSimilarity = Math.max(existing.maxSimilarity, result.similarity);
      } else {
        rankScores.set(key, {
          entityId: result.entityId,
          entityType: result.entityType,
          rrf: rrfIncrement,
          maxSimilarity: result.similarity,
        });
      }
    }
  };

  for (const list of resultLists) {
    applyList(list);
  }

  const ranked = Array.from(rankScores.values())
    .sort((a, b) => b.rrf - a.rrf || b.maxSimilarity - a.maxSimilarity)
    .slice(0, Math.max(1, limit));

  const topRrf = ranked[0]?.rrf ?? 1;
  return ranked.map((entry) => ({
    entityId: entry.entityId,
    entityType: entry.entityType,
    similarity: Math.max(entry.maxSimilarity, Math.min(1, entry.rrf / topRrf)),
  }));
}

function fuseSimilarityResultsWithRrf(
  direct: SimilarityResult[],
  hyde: SimilarityResult[],
  limit: number
): SimilarityResult[] {
  return fuseSimilarityResultListsWithRrf([direct, hyde], limit);
}

export {
  buildHydePrompt,
  buildIdentifierExpansionVariants,
  fuseSimilarityResultListsWithRrf,
  fuseSimilarityResultsWithRrf,
  normalizeHydeExpansion,
};
