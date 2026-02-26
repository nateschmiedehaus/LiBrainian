import { describe, expect, it } from 'vitest';
import {
  buildHydePrompt,
  buildIdentifierExpansionVariants,
  fuseSimilarityResultListsWithRrf,
  fuseSimilarityResultsWithRrf,
  normalizeHydeExpansion,
} from '../query_hyde_helpers.js';

describe('query hyde helpers', () => {
  it('builds a compact HyDE prompt that includes the request', () => {
    const prompt = buildHydePrompt('Implement token refresh flow');
    expect(prompt).toContain('Request: Implement token refresh flow');
    expect(prompt).toContain('TypeScript function signature');
  });

  it('normalizes fenced HyDE completions and truncates long content', () => {
    const normalized = normalizeHydeExpansion('```ts\nfunction fn() {}\n```');
    expect(normalized).toBe('function fn() {}');

    const oversized = `const data = "${'x'.repeat(2000)}";`;
    const trimmed = normalizeHydeExpansion(oversized);
    expect(trimmed?.length).toBe(1200);
  });

  it('expands identifier variants with permission/auth synonyms', () => {
    const variants = buildIdentifierExpansionVariants(
      'where does the app handle user permissions and login?'
    );
    expect(variants.length).toBeGreaterThan(0);
    expect(variants.some((variant) => /access|authorization|role/i.test(variant))).toBe(true);
    expect(variants.length).toBeLessThanOrEqual(3);
  });

  it('handles prototype-like identifiers without throwing', () => {
    expect(() => buildIdentifierExpansionVariants('How is constructor implemented?')).not.toThrow();
  });

  it('fuses rankings with reciprocal-rank fusion', () => {
    const direct = [
      { entityId: 'A', entityType: 'function', similarity: 0.9 },
      { entityId: 'B', entityType: 'module', similarity: 0.82 },
    ];
    const hyde = [
      { entityId: 'B', entityType: 'module', similarity: 0.7 },
      { entityId: 'C', entityType: 'function', similarity: 0.66 },
    ];
    const fused = fuseSimilarityResultsWithRrf(direct, hyde, 5);

    expect(fused[0]?.entityId).toBe('B');
    expect(fused.map((item) => `${item.entityType}:${item.entityId}`)).toEqual(
      expect.arrayContaining(['function:A', 'module:B', 'function:C'])
    );
  });

  it('fuses multiple ranked lists using shared RRF scoring', () => {
    const fused = fuseSimilarityResultListsWithRrf(
      [
        [
          { entityId: 'A', entityType: 'function', similarity: 0.9 },
          { entityId: 'B', entityType: 'module', similarity: 0.7 },
        ],
        [
          { entityId: 'B', entityType: 'module', similarity: 0.8 },
          { entityId: 'C', entityType: 'function', similarity: 0.65 },
        ],
        [{ entityId: 'D', entityType: 'function', similarity: 0.6 }],
      ],
      5
    );

    expect(fused[0]?.entityId).toBe('B');
    expect(fused.map((item) => `${item.entityType}:${item.entityId}`)).toEqual(
      expect.arrayContaining(['function:A', 'module:B', 'function:C', 'function:D'])
    );
  });
});
