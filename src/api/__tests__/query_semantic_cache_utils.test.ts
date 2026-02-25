import { describe, expect, it } from 'vitest';
import type { LibrarianQuery, LibrarianVersion, LlmRequirement } from '../../types.js';
import {
  buildQueryCacheKey,
  buildSemanticCacheScopeSignature,
  classifySemanticCacheCategory,
  computeSemanticIntentSimilarity,
  normalizeIntentForCache,
} from '../query_semantic_cache_utils.js';

const VERSION: LibrarianVersion = {
  major: 2,
  minor: 0,
  patch: 0,
  string: '2.0.0',
  qualityTier: 'full',
  indexedAt: new Date('2026-02-25T00:00:00.000Z'),
  indexerVersion: '2.0.0',
  features: [],
};

const LLM_REQUIREMENT: LlmRequirement = 'optional';

function makeQuery(intent: string): LibrarianQuery {
  return {
    intent,
    depth: 'L1',
  };
}

describe('query_semantic_cache_utils', () => {
  it('normalizes intents by applying synonyms, suffix stripping, and stop-word filtering', () => {
    const normalized = normalizeIntentForCache('How does authentication methods work?');
    expect(normalized).toBe('auth function workflow');
  });

  it('builds stable cache keys for semantically equivalent intents and sorted file scopes', () => {
    const queryA: LibrarianQuery = {
      ...makeQuery('How does authentication work?'),
      affectedFiles: ['src/z.ts', 'src/a.ts'],
      filter: { language: 'ts', excludeTests: true },
      workingFile: 'src/app.ts',
    };
    const queryB: LibrarianQuery = {
      ...makeQuery('how auth works'),
      affectedFiles: ['src/a.ts', 'src/z.ts'],
      filter: { language: 'ts', excludeTests: true },
      workingFile: 'src/app.ts',
    };

    const keyA = buildQueryCacheKey(queryA, VERSION, LLM_REQUIREMENT, true);
    const keyB = buildQueryCacheKey(queryB, VERSION, LLM_REQUIREMENT, true);
    expect(keyA).toBe(keyB);
  });

  it('classifies diagnostic, conceptual, and lookup intents', () => {
    expect(classifySemanticCacheCategory('why does login fail with timeout?')).toBe('diagnostic');
    expect(classifySemanticCacheCategory('architecture overview of auth flow')).toBe('conceptual');
    expect(classifySemanticCacheCategory('find login middleware')).toBe('lookup');
  });

  it('builds scope signatures that are order-insensitive for affected files', () => {
    const queryA: LibrarianQuery = {
      ...makeQuery('find auth'),
      affectedFiles: ['b.ts', 'a.ts'],
      filter: { pathPrefix: 'src', excludeTests: true },
      hydeExpansion: true,
    };
    const queryB: LibrarianQuery = {
      ...makeQuery('find auth'),
      affectedFiles: ['a.ts', 'b.ts'],
      filter: { pathPrefix: 'src', excludeTests: true },
      hydeExpansion: true,
    };

    expect(buildSemanticCacheScopeSignature(queryA)).toBe(buildSemanticCacheScopeSignature(queryB));
  });

  it('computes high similarity for overlapping intents and exact match as 1', () => {
    const exact = computeSemanticIntentSimilarity('auth middleware flow', 'auth middleware flow');
    const overlap = computeSemanticIntentSimilarity('auth middleware flow', 'auth session flow');
    const disjoint = computeSemanticIntentSimilarity('auth middleware flow', 'pricing invoice export');

    expect(exact).toBe(1);
    expect(overlap).toBeGreaterThan(disjoint);
  });
});
