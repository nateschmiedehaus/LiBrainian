import { describe, expect, it } from 'vitest';
import type { QueryCandidateMergeInput } from '../query_candidate_merge.js';
import { candidateKey, mergeCandidates } from '../query_candidate_merge.js';

describe('query_candidate_merge', () => {
  it('builds stable candidate keys from entity type and id', () => {
    const key = candidateKey({
      entityId: 'func:src/index.ts::main',
      entityType: 'function',
      semanticSimilarity: 0.1,
      confidence: 0.2,
      recency: 0.3,
    });
    expect(key).toBe('function:func:src/index.ts::main');
  });

  it('merges duplicates and keeps strongest signals', () => {
    const primary: QueryCandidateMergeInput[] = [
      {
        entityId: 'func:src/index.ts::main',
        entityType: 'function',
        semanticSimilarity: 0.4,
        confidence: 0.6,
        recency: 0.3,
      },
    ];
    const additions: QueryCandidateMergeInput[] = [
      {
        entityId: 'func:src/index.ts::main',
        entityType: 'function',
        path: 'src/index.ts',
        semanticSimilarity: 0.8,
        graphSimilarity: 0.5,
        cochange: 0.7,
        confidence: 0.9,
        recency: 0.5,
      },
    ];

    const merged = mergeCandidates(primary, additions);
    expect(merged).toHaveLength(1);
    expect(merged[0].semanticSimilarity).toBe(0.8);
    expect(merged[0].graphSimilarity).toBe(0.5);
    expect(merged[0].cochange).toBe(0.7);
    expect(merged[0].confidence).toBe(0.9);
    expect(merged[0].recency).toBe(0.5);
    expect(merged[0].path).toBe('src/index.ts');
  });

  it('returns unique candidates when there are no collisions', () => {
    const merged = mergeCandidates(
      [
        {
          entityId: 'func:src/index.ts::main',
          entityType: 'function',
          semanticSimilarity: 0.4,
          confidence: 0.6,
          recency: 0.3,
        },
      ],
      [
        {
          entityId: 'mod:src/core/engine.ts',
          entityType: 'module',
          semanticSimilarity: 0.5,
          confidence: 0.7,
          recency: 0.4,
        },
      ]
    );

    expect(merged).toHaveLength(2);
  });
});
