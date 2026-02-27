import { describe, expect, it } from 'vitest';
import { getCurrentVersion } from '../versioning.js';
import type { LibrarianQuery } from '../../types.js';

function baseQuery(intent: string, hydeExpansion = false): LibrarianQuery {
  return {
    intent,
    depth: 'L1',
    hydeExpansion,
  };
}

describe('HyDE retrieval helpers', () => {
  it('separates cache keys for direct vs HyDE retrieval', async () => {
    const { __testing } = await import('../query.js');
    const version = getCurrentVersion();

    const direct = __testing.buildQueryCacheKey(
      baseQuery('how does rate limiting work?', false),
      version,
      'disabled',
      false
    );
    const hyde = __testing.buildQueryCacheKey(
      baseQuery('how does rate limiting work?', true),
      version,
      'disabled',
      false
    );

    expect(direct).not.toBe(hyde);
  });

  it('normalizes fenced HyDE completions into raw code text', async () => {
    const { __testing } = await import('../query.js');
    const normalized = __testing.normalizeHydeExpansion('```ts\n/** doc */\nfunction fn() {}\n```');
    expect(normalized).toContain('function fn() {}');
    expect(normalized?.includes('```')).toBe(false);
  });

  it('fuses direct and HyDE rankings with reciprocal rank fusion', async () => {
    const { __testing } = await import('../query.js');
    const direct = [
      { entityId: 'A', entityType: 'function', similarity: 0.90 },
      { entityId: 'B', entityType: 'module', similarity: 0.82 },
    ] as const;
    const hyde = [
      { entityId: 'B', entityType: 'module', similarity: 0.70 },
      { entityId: 'C', entityType: 'function', similarity: 0.66 },
    ] as const;

    const fused = __testing.fuseSimilarityResultsWithRrf([...direct], [...hyde], 5);
    const fusedKeys = fused.map((item) => `${item.entityType}:${item.entityId}`);

    expect(fusedKeys).toContain('function:A');
    expect(fusedKeys).toContain('module:B');
    expect(fusedKeys).toContain('function:C');
    expect(fused[0]?.entityId).toBe('B');
  });

  it('generates identifier-expansion variants for permission-style intents', async () => {
    const { __testing } = await import('../query.js');
    const variants = __testing.buildIdentifierExpansionVariants('where does the app handle user permissions?');

    expect(variants.length).toBeGreaterThan(0);
    expect(variants.some((variant) => /access|authorization|role/i.test(variant))).toBe(true);
  });

  it('does not crash identifier expansion on prototype token names', async () => {
    const { __testing } = await import('../query.js');
    expect(() => __testing.buildIdentifierExpansionVariants('How is constructor implemented?')).not.toThrow();
    const variants = __testing.buildIdentifierExpansionVariants('How is constructor implemented?');
    expect(Array.isArray(variants)).toBe(true);
  });

  it('bypasses enumeration short-circuit for caller-style intents', async () => {
    const { __testing } = await import('../query.js');
    expect(__testing.shouldBypassEnumerationForIntent('Which functions call getLlmServiceAdapter?')).toBe(true);
    expect(__testing.shouldBypassEnumerationForIntent('List all functions in this file')).toBe(false);
  });

  it('uses stricter candidate materialization limits for caller probes at L0', async () => {
    const { __testing } = await import('../query.js');
    const callerLimit = __testing.resolveCandidateMaterializationLimit(
      'L0',
      'What functions or methods are callers of queryLibrarian?',
      false,
    );
    const genericLimit = __testing.resolveCandidateMaterializationLimit(
      'L0',
      'What does queryLibrarian do?',
      false,
    );
    expect(callerLimit).toBeLessThanOrEqual(genericLimit);
    expect(callerLimit).toBeGreaterThan(0);
  });

  it('caps candidate materialization to the top scored entries', async () => {
    const { __testing } = await import('../query.js');
    const capped = __testing.capCandidatesForMaterialization([
      {
        entityId: 'low',
        entityType: 'function',
        semanticSimilarity: 0.1,
        confidence: 0.2,
        recency: 0,
        pagerank: 0,
        centrality: 0,
        communityId: null,
      },
      {
        entityId: 'high',
        entityType: 'function',
        semanticSimilarity: 0.8,
        confidence: 0.9,
        recency: 0,
        pagerank: 0,
        centrality: 0,
        communityId: null,
      },
      {
        entityId: 'mid',
        entityType: 'function',
        semanticSimilarity: 0.5,
        confidence: 0.6,
        recency: 0,
        pagerank: 0,
        centrality: 0,
        communityId: null,
      },
    ], 2);
    expect(capped).toHaveLength(2);
    expect(capped[0]?.entityId).toBe('high');
    expect(capped.some((item: { entityId: string }) => item.entityId === 'low')).toBe(false);
  });

  it('fuses multiple expansion result lists into one RRF ranking', async () => {
    const { __testing } = await import('../query.js');
    const fused = __testing.fuseSimilarityResultListsWithRrf([
      [
        { entityId: 'A', entityType: 'function', similarity: 0.9 },
        { entityId: 'B', entityType: 'module', similarity: 0.7 },
      ],
      [
        { entityId: 'B', entityType: 'module', similarity: 0.8 },
        { entityId: 'C', entityType: 'function', similarity: 0.65 },
      ],
      [
        { entityId: 'D', entityType: 'function', similarity: 0.6 },
      ],
    ], 5);

    const keys = fused.map((item) => `${item.entityType}:${item.entityId}`);
    expect(keys).toContain('function:A');
    expect(keys).toContain('module:B');
    expect(keys).toContain('function:C');
    expect(keys).toContain('function:D');
    expect(fused[0]?.entityId).toBe('B');
  });
});
