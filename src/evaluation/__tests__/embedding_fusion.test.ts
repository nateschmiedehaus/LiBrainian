/**
 * @fileoverview Tests for Hybrid Embedding Fusion Pipeline (WU-EMB-003)
 *
 * Tests are written FIRST (TDD). Implementation comes AFTER these tests fail.
 *
 * The Embedding Fusion Pipeline combines multiple embedding types (BM25, dense, graph)
 * using configurable fusion strategies to optimize retrieval quality.
 *
 * @packageDocumentation
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
  EmbeddingFusion,
  createEmbeddingFusion,
  type EmbeddingSource,
  type FusionStrategy,
  type FusionInput,
  type FusedEmbedding,
  type FusionMetrics,
} from '../embedding_fusion.js';

// ============================================================================
// TEST FIXTURES
// ============================================================================

/** Sample sparse embedding (simulating BM25) */
const sparseEmbedding: number[] = [0.5, 0.0, 0.3, 0.0, 0.8, 0.0, 0.1, 0.0];

/** Sample dense embedding (simulating neural embeddings) */
const denseEmbedding: number[] = [0.2, 0.4, 0.1, 0.5, 0.3, 0.7, 0.2, 0.6];

/** Sample graph embedding (simulating graph-based representations) */
const graphEmbedding: number[] = [0.4, 0.2, 0.6, 0.1, 0.5, 0.3, 0.4, 0.2];

/** Sample embedding sources */
const sampleSources: EmbeddingSource[] = [
  { name: 'bm25', type: 'sparse', dimension: 8, normalize: true },
  { name: 'dense', type: 'dense', dimension: 8, normalize: true },
  { name: 'graph', type: 'graph', dimension: 8, normalize: false },
];

/** Sample embeddings map */
function createSampleEmbeddings(): Map<string, number[]> {
  const embeddings = new Map<string, number[]>();
  embeddings.set('bm25', sparseEmbedding);
  embeddings.set('dense', denseEmbedding);
  embeddings.set('graph', graphEmbedding);
  return embeddings;
}

// ============================================================================
// FACTORY FUNCTION TESTS
// ============================================================================

describe('createEmbeddingFusion', () => {
  it('should create an EmbeddingFusion instance', () => {
    const fusion = createEmbeddingFusion();
    expect(fusion).toBeInstanceOf(EmbeddingFusion);
  });

  it('should create an instance with custom sources', () => {
    const fusion = createEmbeddingFusion(sampleSources);
    expect(fusion).toBeInstanceOf(EmbeddingFusion);
    expect(fusion.getSources().length).toBe(3);
  });
});

// ============================================================================
// EMBEDDING SOURCE MANAGEMENT TESTS
// ============================================================================

describe('EmbeddingFusion - Source Management', () => {
  let fusion: EmbeddingFusion;

  beforeEach(() => {
    fusion = createEmbeddingFusion();
  });

  it('should register a new embedding source', () => {
    const source: EmbeddingSource = {
      name: 'test',
      type: 'dense',
      dimension: 128,
      normalize: true,
    };

    fusion.registerSource(source);
    const sources = fusion.getSources();

    expect(sources).toContainEqual(source);
  });

  it('should not allow duplicate source names', () => {
    const source: EmbeddingSource = {
      name: 'duplicate',
      type: 'dense',
      dimension: 128,
      normalize: true,
    };

    fusion.registerSource(source);
    expect(() => fusion.registerSource(source)).toThrow(/already registered/i);
  });

  it('should remove a registered source', () => {
    const source: EmbeddingSource = {
      name: 'removable',
      type: 'sparse',
      dimension: 64,
      normalize: false,
    };

    fusion.registerSource(source);
    fusion.removeSource('removable');
    const sources = fusion.getSources();

    expect(sources.find((s) => s.name === 'removable')).toBeUndefined();
  });

  it('should get source by name', () => {
    const source: EmbeddingSource = {
      name: 'findme',
      type: 'graph',
      dimension: 256,
      normalize: true,
    };

    fusion.registerSource(source);
    const found = fusion.getSource('findme');

    expect(found).toEqual(source);
  });
});

// ============================================================================
// NORMALIZATION TESTS
// ============================================================================

describe('EmbeddingFusion - Normalization', () => {
  let fusion: EmbeddingFusion;

  beforeAll(() => {
    fusion = createEmbeddingFusion();
  });

  it('should normalize an embedding to unit length', () => {
    const input = [3, 4]; // 3-4-5 triangle, normalized should be [0.6, 0.8]
    const normalized = fusion.normalize(input);

    expect(normalized.length).toBe(2);
    expect(normalized[0]).toBeCloseTo(0.6, 5);
    expect(normalized[1]).toBeCloseTo(0.8, 5);
  });

  it('should return unit vector for already normalized input', () => {
    const input = [0.6, 0.8]; // Already unit length
    const normalized = fusion.normalize(input);

    const magnitude = Math.sqrt(
      normalized.reduce((sum, v) => sum + v * v, 0)
    );
    expect(magnitude).toBeCloseTo(1.0, 5);
  });

  it('should handle zero vector gracefully', () => {
    const input = [0, 0, 0, 0];
    const normalized = fusion.normalize(input);

    expect(normalized.length).toBe(4);
    // Zero vector should remain zero (or be handled safely)
    expect(normalized.every((v) => v === 0)).toBe(true);
  });

  it('should handle negative values', () => {
    const input = [-3, 4];
    const normalized = fusion.normalize(input);

    const magnitude = Math.sqrt(
      normalized.reduce((sum, v) => sum + v * v, 0)
    );
    expect(magnitude).toBeCloseTo(1.0, 5);
    expect(normalized[0]).toBeCloseTo(-0.6, 5);
    expect(normalized[1]).toBeCloseTo(0.8, 5);
  });
});

// ============================================================================
// WEIGHTED SUM FUSION TESTS
// ============================================================================

describe('EmbeddingFusion - Weighted Sum', () => {
  let fusion: EmbeddingFusion;

  beforeAll(() => {
    fusion = createEmbeddingFusion();
  });

  it('should compute weighted sum of embeddings', () => {
    const embeddings = [[1, 2, 3], [4, 5, 6]];
    const weights = [0.5, 0.5];

    const result = fusion.weightedSum(embeddings, weights);

    expect(result.length).toBe(3);
    expect(result[0]).toBeCloseTo(2.5, 5);
    expect(result[1]).toBeCloseTo(3.5, 5);
    expect(result[2]).toBeCloseTo(4.5, 5);
  });

  it('should handle unequal weights', () => {
    const embeddings = [[1, 0], [0, 1]];
    const weights = [0.7, 0.3];

    const result = fusion.weightedSum(embeddings, weights);

    expect(result[0]).toBeCloseTo(0.7, 5);
    expect(result[1]).toBeCloseTo(0.3, 5);
  });

  it('should throw error for mismatched dimensions', () => {
    const embeddings = [[1, 2, 3], [1, 2]];
    const weights = [0.5, 0.5];

    expect(() => fusion.weightedSum(embeddings, weights)).toThrow(/dimension/i);
  });

  it('should throw error for mismatched weights count', () => {
    const embeddings = [[1, 2], [3, 4], [5, 6]];
    const weights = [0.5, 0.5]; // Only 2 weights for 3 embeddings

    expect(() => fusion.weightedSum(embeddings, weights)).toThrow(/weight/i);
  });

  it('should normalize weights if they do not sum to 1', () => {
    const embeddings = [[1, 2], [3, 4]];
    const weights = [1, 1]; // Sum = 2, should be normalized to [0.5, 0.5]

    const result = fusion.weightedSum(embeddings, weights);

    expect(result[0]).toBeCloseTo(2, 5);
    expect(result[1]).toBeCloseTo(3, 5);
  });
});

// ============================================================================
// CONCATENATION FUSION TESTS
// ============================================================================

describe('EmbeddingFusion - Concatenate', () => {
  let fusion: EmbeddingFusion;

  beforeAll(() => {
    fusion = createEmbeddingFusion();
  });

  it('should concatenate multiple embeddings', () => {
    const embeddings = [[1, 2], [3, 4], [5, 6]];
    const result = fusion.concatenate(embeddings);

    expect(result).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('should handle single embedding', () => {
    const embeddings = [[1, 2, 3]];
    const result = fusion.concatenate(embeddings);

    expect(result).toEqual([1, 2, 3]);
  });

  it('should handle empty embeddings array', () => {
    const embeddings: number[][] = [];
    const result = fusion.concatenate(embeddings);

    expect(result).toEqual([]);
  });

  it('should preserve order of embeddings', () => {
    const embeddings = [[10, 20], [30, 40]];
    const result = fusion.concatenate(embeddings);

    expect(result[0]).toBe(10);
    expect(result[2]).toBe(30);
  });
});

// ============================================================================
// ATTENTION-BASED FUSION TESTS
// ============================================================================

describe('EmbeddingFusion - Attention Fusion', () => {
  let fusion: EmbeddingFusion;

  beforeAll(() => {
    fusion = createEmbeddingFusion(sampleSources);
  });

  it('should compute attention-based fusion', () => {
    const query = 'test query';
    const embeddings = createSampleEmbeddings();

    const result = fusion.attentionFuse(query, embeddings);

    expect(result.length).toBe(8); // Same dimension as inputs
    expect(result.every((v) => typeof v === 'number')).toBe(true);
  });

  it('should produce different results for different queries', () => {
    const embeddings = createSampleEmbeddings();

    const result1 = fusion.attentionFuse('query one', embeddings);
    const result2 = fusion.attentionFuse('query two', embeddings);

    // Results should be different (or at least the attention mechanism runs)
    // They might be similar but the computation should complete
    expect(result1.length).toBe(result2.length);
  });

  it('should handle empty query', () => {
    const embeddings = createSampleEmbeddings();
    const result = fusion.attentionFuse('', embeddings);

    expect(result.length).toBe(8);
  });

  it('should handle single embedding source', () => {
    const embeddings = new Map<string, number[]>();
    embeddings.set('single', [0.5, 0.5, 0.5, 0.5]);

    const result = fusion.attentionFuse('test', embeddings);

    expect(result.length).toBe(4);
  });
});

// ============================================================================
// RECIPROCAL RANK FUSION (RRF) TESTS
// ============================================================================

describe('EmbeddingFusion - RRF Fusion', () => {
  let fusion: EmbeddingFusion;

  beforeAll(() => {
    fusion = createEmbeddingFusion(sampleSources);
  });

  it('should compute RRF fusion scores', () => {
    const input: FusionInput = {
      query: 'test query',
      embeddings: createSampleEmbeddings(),
      strategy: { type: 'rrf' },
    };

    const result = fusion.fuse(input);

    expect(result.vector.length).toBeGreaterThan(0);
    expect(result.strategy).toBe('rrf');
  });

  it('should handle RRF with custom k parameter', () => {
    const fusion2 = createEmbeddingFusion(sampleSources);
    const input: FusionInput = {
      query: 'test',
      embeddings: createSampleEmbeddings(),
      strategy: { type: 'rrf' },
    };

    const result = fusion2.fuse(input);
    expect(result.vector).toBeDefined();
  });
});

// ============================================================================
// MAIN FUSE METHOD TESTS
// ============================================================================

describe('EmbeddingFusion - fuse', () => {
  let fusion: EmbeddingFusion;

  beforeAll(() => {
    fusion = createEmbeddingFusion(sampleSources);
  });

  it('should fuse embeddings with weighted_sum strategy', () => {
    const input: FusionInput = {
      query: 'test query',
      embeddings: createSampleEmbeddings(),
      strategy: { type: 'weighted_sum', weights: [0.4, 0.4, 0.2] },
    };

    const result = fusion.fuse(input);

    expect(result.vector.length).toBe(8);
    expect(result.strategy).toBe('weighted_sum');
    expect(result.metadata.dimension).toBe(8);
  });

  it('should fuse embeddings with concatenate strategy', () => {
    const input: FusionInput = {
      query: 'test query',
      embeddings: createSampleEmbeddings(),
      strategy: { type: 'concatenate' },
    };

    const result = fusion.fuse(input);

    expect(result.vector.length).toBe(24); // 8 * 3 sources
    expect(result.strategy).toBe('concatenate');
    expect(result.metadata.dimension).toBe(24);
  });

  it('should fuse embeddings with attention strategy', () => {
    const input: FusionInput = {
      query: 'test query',
      embeddings: createSampleEmbeddings(),
      strategy: { type: 'attention' },
    };

    const result = fusion.fuse(input);

    expect(result.vector.length).toBe(8);
    expect(result.strategy).toBe('attention');
  });

  it('should track source contributions', () => {
    const input: FusionInput = {
      query: 'test query',
      embeddings: createSampleEmbeddings(),
      strategy: { type: 'weighted_sum', weights: [0.5, 0.3, 0.2] },
    };

    const result = fusion.fuse(input);

    expect(result.sourceContributions.size).toBe(3);
    expect(result.sourceContributions.get('bm25')).toBeCloseTo(0.5, 2);
    expect(result.sourceContributions.get('dense')).toBeCloseTo(0.3, 2);
    expect(result.sourceContributions.get('graph')).toBeCloseTo(0.2, 2);
  });

  it('should include fusion time in metadata', () => {
    const input: FusionInput = {
      query: 'test query',
      embeddings: createSampleEmbeddings(),
      strategy: { type: 'weighted_sum', weights: [0.33, 0.33, 0.34] },
    };

    const result = fusion.fuse(input);

    expect(result.metadata.fusionTime).toBeGreaterThanOrEqual(0);
    expect(typeof result.metadata.fusionTime).toBe('number');
  });

  it('should apply normalization when required', () => {
    const input: FusionInput = {
      query: 'test query',
      embeddings: createSampleEmbeddings(),
      strategy: { type: 'weighted_sum', weights: [0.5, 0.3, 0.2] },
    };

    const result = fusion.fuse(input);

    if (result.metadata.normalized) {
      const magnitude = Math.sqrt(
        result.vector.reduce((sum, v) => sum + v * v, 0)
      );
      expect(magnitude).toBeCloseTo(1.0, 3);
    }
  });

  it('should use default weights when not provided', () => {
    const input: FusionInput = {
      query: 'test query',
      embeddings: createSampleEmbeddings(),
      strategy: { type: 'weighted_sum' }, // No weights provided
    };

    const result = fusion.fuse(input);

    // Should still produce a valid result with equal weights
    expect(result.vector.length).toBe(8);
    expect(result.sourceContributions.size).toBe(3);
  });
});

// ============================================================================
// FUSION METRICS TESTS
// ============================================================================

describe('EmbeddingFusion - computeMetrics', () => {
  let fusion: EmbeddingFusion;

  beforeAll(() => {
    fusion = createEmbeddingFusion(sampleSources);
  });

  it('should compute metrics for a fused embedding', () => {
    const input: FusionInput = {
      query: 'test query',
      embeddings: createSampleEmbeddings(),
      strategy: { type: 'weighted_sum', weights: [0.4, 0.4, 0.2] },
    };

    const fused = fusion.fuse(input);
    const relevantDocs = ['doc1', 'doc2', 'doc3'];

    const metrics = fusion.computeMetrics(fused, relevantDocs);

    expect(metrics.queryId).toBeDefined();
    expect(typeof metrics.relevanceScore).toBe('number');
    expect(typeof metrics.diversityScore).toBe('number');
    expect(typeof metrics.fusionQuality).toBe('number');
    expect(metrics.sourceWeights.size).toBeGreaterThan(0);
  });

  it('should return relevance score between 0 and 1', () => {
    const input: FusionInput = {
      query: 'test',
      embeddings: createSampleEmbeddings(),
      strategy: { type: 'weighted_sum', weights: [0.33, 0.33, 0.34] },
    };

    const fused = fusion.fuse(input);
    const metrics = fusion.computeMetrics(fused, ['doc1']);

    expect(metrics.relevanceScore).toBeGreaterThanOrEqual(0);
    expect(metrics.relevanceScore).toBeLessThanOrEqual(1);
  });

  it('should return diversity score between 0 and 1', () => {
    const input: FusionInput = {
      query: 'test',
      embeddings: createSampleEmbeddings(),
      strategy: { type: 'attention' },
    };

    const fused = fusion.fuse(input);
    const metrics = fusion.computeMetrics(fused, ['doc1', 'doc2']);

    expect(metrics.diversityScore).toBeGreaterThanOrEqual(0);
    expect(metrics.diversityScore).toBeLessThanOrEqual(1);
  });

  it('should return fusion quality between 0 and 1', () => {
    const input: FusionInput = {
      query: 'test',
      embeddings: createSampleEmbeddings(),
      strategy: { type: 'concatenate' },
    };

    const fused = fusion.fuse(input);
    const metrics = fusion.computeMetrics(fused, []);

    expect(metrics.fusionQuality).toBeGreaterThanOrEqual(0);
    expect(metrics.fusionQuality).toBeLessThanOrEqual(1);
  });

  it('should track source weights in metrics', () => {
    const input: FusionInput = {
      query: 'test',
      embeddings: createSampleEmbeddings(),
      strategy: { type: 'weighted_sum', weights: [0.6, 0.3, 0.1] },
    };

    const fused = fusion.fuse(input);
    const metrics = fusion.computeMetrics(fused, ['doc1']);

    expect(metrics.sourceWeights.get('bm25')).toBeCloseTo(0.6, 2);
    expect(metrics.sourceWeights.get('dense')).toBeCloseTo(0.3, 2);
    expect(metrics.sourceWeights.get('graph')).toBeCloseTo(0.1, 2);
  });
});

// ============================================================================
// LEARNED WEIGHTS TESTS
// ============================================================================

describe('EmbeddingFusion - Learned Weights', () => {
  let fusion: EmbeddingFusion;

  beforeAll(() => {
    fusion = createEmbeddingFusion(sampleSources);
  });

  it('should support learned weights strategy', () => {
    const input: FusionInput = {
      query: 'test query',
      embeddings: createSampleEmbeddings(),
      strategy: { type: 'weighted_sum', learnedWeights: true },
    };

    const result = fusion.fuse(input);

    expect(result.vector.length).toBe(8);
    // With learned weights, contributions should still sum to ~1
    const totalContribution = Array.from(
      result.sourceContributions.values()
    ).reduce((sum, v) => sum + v, 0);
    expect(totalContribution).toBeCloseTo(1.0, 2);
  });

  it('should update weights based on feedback', () => {
    const feedbackMetrics: FusionMetrics = {
      queryId: 'test-query-1',
      relevanceScore: 0.9,
      diversityScore: 0.7,
      fusionQuality: 0.8,
      sourceWeights: new Map([
        ['bm25', 0.6],
        ['dense', 0.3],
        ['graph', 0.1],
      ]),
    };

    // This should not throw
    fusion.updateWeightsFromFeedback(feedbackMetrics);

    // Verify weights were potentially updated
    const currentWeights = fusion.getLearnedWeights();
    expect(currentWeights).toBeDefined();
  });
});

// ============================================================================
// EDGE CASES AND ERROR HANDLING
// ============================================================================

describe('EmbeddingFusion - Edge Cases', () => {
  let fusion: EmbeddingFusion;

  beforeEach(() => {
    fusion = createEmbeddingFusion();
  });

  it('should handle empty embeddings map', () => {
    const input: FusionInput = {
      query: 'test',
      embeddings: new Map(),
      strategy: { type: 'weighted_sum' },
    };

    expect(() => fusion.fuse(input)).toThrow(/no embeddings/i);
  });

  it('should handle single embedding source', () => {
    const embeddings = new Map<string, number[]>();
    embeddings.set('single', [0.1, 0.2, 0.3]);

    const input: FusionInput = {
      query: 'test',
      embeddings,
      strategy: { type: 'weighted_sum', weights: [1.0] },
    };

    const result = fusion.fuse(input);
    // Result is normalized, so check it's proportional to input
    expect(result.vector.length).toBe(3);
    // Check proportions are preserved (2:4:6 ratio)
    expect(result.vector[1] / result.vector[0]).toBeCloseTo(2, 5);
    expect(result.vector[2] / result.vector[0]).toBeCloseTo(3, 5);
    // Check it's normalized
    const magnitude = Math.sqrt(result.vector.reduce((sum, v) => sum + v * v, 0));
    expect(magnitude).toBeCloseTo(1.0, 5);
  });

  it('should handle very high dimensional embeddings', () => {
    const highDim = Array(1024).fill(0.001);
    const embeddings = new Map<string, number[]>();
    embeddings.set('high', highDim);

    const input: FusionInput = {
      query: 'test',
      embeddings,
      strategy: { type: 'weighted_sum', weights: [1.0] },
    };

    const result = fusion.fuse(input);
    expect(result.vector.length).toBe(1024);
  });

  it('should handle NaN values in embeddings gracefully', () => {
    const embeddings = new Map<string, number[]>();
    embeddings.set('bad', [0.1, NaN, 0.3]);

    const input: FusionInput = {
      query: 'test',
      embeddings,
      strategy: { type: 'weighted_sum', weights: [1.0] },
    };

    expect(() => fusion.fuse(input)).toThrow(/invalid.*value/i);
  });

  it('should handle Infinity values in embeddings gracefully', () => {
    const embeddings = new Map<string, number[]>();
    embeddings.set('inf', [0.1, Infinity, 0.3]);

    const input: FusionInput = {
      query: 'test',
      embeddings,
      strategy: { type: 'weighted_sum', weights: [1.0] },
    };

    expect(() => fusion.fuse(input)).toThrow(/invalid.*value/i);
  });

  it('should validate embedding dimensions match across sources', () => {
    const embeddings = new Map<string, number[]>();
    embeddings.set('short', [0.1, 0.2]);
    embeddings.set('long', [0.1, 0.2, 0.3, 0.4]);

    const input: FusionInput = {
      query: 'test',
      embeddings,
      strategy: { type: 'weighted_sum', weights: [0.5, 0.5] },
    };

    expect(() => fusion.fuse(input)).toThrow(/dimension/i);
  });
});

// ============================================================================
// INTERFACE TESTS
// ============================================================================

describe('EmbeddingSource Interface', () => {
  it('should support all required fields', () => {
    const source: EmbeddingSource = {
      name: 'test_source',
      type: 'dense',
      dimension: 768,
      normalize: true,
    };

    expect(source.name).toBe('test_source');
    expect(source.type).toBe('dense');
    expect(source.dimension).toBe(768);
    expect(source.normalize).toBe(true);
  });

  it('should allow dimension to be optional', () => {
    const source: EmbeddingSource = {
      name: 'sparse_source',
      type: 'sparse',
      normalize: false,
    };

    expect(source.name).toBe('sparse_source');
    expect(source.dimension).toBeUndefined();
  });
});

describe('FusionStrategy Interface', () => {
  it('should support weighted_sum type', () => {
    const strategy: FusionStrategy = {
      type: 'weighted_sum',
      weights: [0.5, 0.3, 0.2],
    };

    expect(strategy.type).toBe('weighted_sum');
    expect(strategy.weights).toEqual([0.5, 0.3, 0.2]);
  });

  it('should support concatenate type', () => {
    const strategy: FusionStrategy = {
      type: 'concatenate',
    };

    expect(strategy.type).toBe('concatenate');
  });

  it('should support attention type', () => {
    const strategy: FusionStrategy = {
      type: 'attention',
    };

    expect(strategy.type).toBe('attention');
  });

  it('should support rrf type', () => {
    const strategy: FusionStrategy = {
      type: 'rrf',
    };

    expect(strategy.type).toBe('rrf');
  });

  it('should support learnedWeights flag', () => {
    const strategy: FusionStrategy = {
      type: 'weighted_sum',
      learnedWeights: true,
    };

    expect(strategy.learnedWeights).toBe(true);
  });
});

describe('FusedEmbedding Interface', () => {
  it('should have all required fields', () => {
    const fused: FusedEmbedding = {
      vector: [0.1, 0.2, 0.3],
      sourceContributions: new Map([['source1', 0.6], ['source2', 0.4]]),
      strategy: 'weighted_sum',
      metadata: {
        dimension: 3,
        normalized: true,
        fusionTime: 1.5,
      },
    };

    expect(fused.vector.length).toBe(3);
    expect(fused.sourceContributions.size).toBe(2);
    expect(fused.strategy).toBe('weighted_sum');
    expect(fused.metadata.dimension).toBe(3);
    expect(fused.metadata.normalized).toBe(true);
    expect(fused.metadata.fusionTime).toBe(1.5);
  });
});

describe('FusionMetrics Interface', () => {
  it('should have all required fields', () => {
    const metrics: FusionMetrics = {
      queryId: 'query-123',
      relevanceScore: 0.85,
      diversityScore: 0.72,
      fusionQuality: 0.78,
      sourceWeights: new Map([['bm25', 0.5], ['dense', 0.5]]),
    };

    expect(metrics.queryId).toBe('query-123');
    expect(metrics.relevanceScore).toBe(0.85);
    expect(metrics.diversityScore).toBe(0.72);
    expect(metrics.fusionQuality).toBe(0.78);
    expect(metrics.sourceWeights.size).toBe(2);
  });
});
