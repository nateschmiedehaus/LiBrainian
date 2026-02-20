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
