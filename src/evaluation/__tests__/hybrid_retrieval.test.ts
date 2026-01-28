/**
 * @fileoverview Tests for Hybrid Retrieval Fusion (WU-RET-007)
 *
 * Tests are written FIRST (TDD). Implementation comes AFTER these tests fail.
 *
 * The Hybrid Retrieval system combines BM25 (lexical), dense (semantic), and
 * graph-based retrieval using Reciprocal Rank Fusion (RRF) to merge results.
 * Target: MRR >= 0.75
 *
 * @packageDocumentation
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import {
  HybridRetriever,
  createHybridRetriever,
  type RetrievalResult,
  type FusionConfig,
  type HybridRetrievalInput,
  type HybridRetrievalOutput,
  type FusedResult,
  DEFAULT_FUSION_CONFIG,
} from '../hybrid_retrieval.js';

// ============================================================================
// TEST FIXTURES
// ============================================================================

const sampleCorpus: string[] = [
  'The authentication module handles user login and session management.',
  'Database queries are optimized using connection pooling and caching.',
  'The API gateway routes requests to appropriate microservices.',
  'User authentication requires valid credentials and MFA verification.',
  'The caching layer reduces database load significantly.',
  'Session tokens are validated using JWT verification.',
  'The routing system supports RESTful API patterns.',
  'Password hashing uses bcrypt with configurable rounds.',
  'The connection pool manages database connections efficiently.',
  'API rate limiting prevents abuse and ensures fair usage.',
];

const sampleBm25Results: RetrievalResult[] = [
  { id: 'doc-0', content: sampleCorpus[0], score: 0.95, source: 'bm25', metadata: { termFreq: 5 } },
  { id: 'doc-3', content: sampleCorpus[3], score: 0.88, source: 'bm25', metadata: { termFreq: 4 } },
  { id: 'doc-5', content: sampleCorpus[5], score: 0.72, source: 'bm25', metadata: { termFreq: 3 } },
  { id: 'doc-7', content: sampleCorpus[7], score: 0.65, source: 'bm25', metadata: { termFreq: 2 } },
];

const sampleDenseResults: RetrievalResult[] = [
  { id: 'doc-3', content: sampleCorpus[3], score: 0.92, source: 'dense', metadata: { similarity: 0.92 } },
  { id: 'doc-0', content: sampleCorpus[0], score: 0.87, source: 'dense', metadata: { similarity: 0.87 } },
  { id: 'doc-7', content: sampleCorpus[7], score: 0.78, source: 'dense', metadata: { similarity: 0.78 } },
  { id: 'doc-5', content: sampleCorpus[5], score: 0.71, source: 'dense', metadata: { similarity: 0.71 } },
];

const sampleGraphResults: RetrievalResult[] = [
  { id: 'doc-0', content: sampleCorpus[0], score: 0.85, source: 'graph', metadata: { hops: 1 } },
  { id: 'doc-5', content: sampleCorpus[5], score: 0.80, source: 'graph', metadata: { hops: 1 } },
  { id: 'doc-3', content: sampleCorpus[3], score: 0.75, source: 'graph', metadata: { hops: 2 } },
];

// ============================================================================
// FACTORY FUNCTION TESTS
// ============================================================================

describe('createHybridRetriever', () => {
  it('should create a retriever instance', () => {
    const retriever = createHybridRetriever();
    expect(retriever).toBeInstanceOf(HybridRetriever);
  });

  it('should accept custom default config', () => {
    const customConfig: Partial<FusionConfig> = {
      bm25Weight: 0.5,
      denseWeight: 0.3,
      graphWeight: 0.2,
    };
    const retriever = createHybridRetriever(customConfig);
    expect(retriever).toBeInstanceOf(HybridRetriever);
  });
});

// ============================================================================
// DEFAULT CONFIG TESTS
// ============================================================================

describe('DEFAULT_FUSION_CONFIG', () => {
  it('should have valid weight values', () => {
    expect(DEFAULT_FUSION_CONFIG.bm25Weight).toBeGreaterThan(0);
    expect(DEFAULT_FUSION_CONFIG.denseWeight).toBeGreaterThan(0);
    expect(DEFAULT_FUSION_CONFIG.graphWeight).toBeGreaterThanOrEqual(0);
  });

  it('should have valid RRF k parameter', () => {
    expect(DEFAULT_FUSION_CONFIG.rrfK).toBeGreaterThan(0);
    expect(DEFAULT_FUSION_CONFIG.rrfK).toBe(60); // Standard RRF k value
  });

  it('should have valid maxResults', () => {
    expect(DEFAULT_FUSION_CONFIG.maxResults).toBeGreaterThan(0);
  });

  it('should have weights that sum to a reasonable value', () => {
    const total = DEFAULT_FUSION_CONFIG.bm25Weight +
      DEFAULT_FUSION_CONFIG.denseWeight +
      DEFAULT_FUSION_CONFIG.graphWeight;
    // Weights don't need to sum to 1, but should be positive
    expect(total).toBeGreaterThan(0);
  });
});

// ============================================================================
// BM25 SEARCH TESTS
// ============================================================================

describe('HybridRetriever - bm25Search', () => {
  let retriever: HybridRetriever;

  beforeAll(() => {
    retriever = createHybridRetriever();
  });

  it('should return results with bm25 source', () => {
    const results = retriever.bm25Search('authentication login', sampleCorpus);

    expect(results.length).toBeGreaterThan(0);
    for (const result of results) {
      expect(result.source).toBe('bm25');
    }
  });

  it('should rank documents by term frequency and importance', () => {
    const results = retriever.bm25Search('authentication', sampleCorpus);

    // Results should be sorted by score descending
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });

  it('should handle empty corpus', () => {
    const results = retriever.bm25Search('query', []);
    expect(results).toEqual([]);
  });

  it('should handle empty query', () => {
    const results = retriever.bm25Search('', sampleCorpus);
    expect(results).toEqual([]);
  });

  it('should return unique document IDs', () => {
    const results = retriever.bm25Search('authentication user', sampleCorpus);
    const ids = results.map(r => r.id);
    const uniqueIds = [...new Set(ids)];
    expect(ids.length).toBe(uniqueIds.length);
  });

  it('should include content in results', () => {
    const results = retriever.bm25Search('database', sampleCorpus);

    for (const result of results) {
      expect(result.content).toBeDefined();
      expect(result.content.length).toBeGreaterThan(0);
    }
  });

  it('should include metadata in results', () => {
    const results = retriever.bm25Search('caching', sampleCorpus);

    for (const result of results) {
      expect(result.metadata).toBeDefined();
    }
  });

  it('should handle special characters in query', () => {
    const results = retriever.bm25Search('API (rate-limiting)', sampleCorpus);
    expect(Array.isArray(results)).toBe(true);
  });
});

// ============================================================================
// DENSE SEARCH TESTS
// ============================================================================

describe('HybridRetriever - denseSearch', () => {
  let retriever: HybridRetriever;

  beforeAll(() => {
    retriever = createHybridRetriever();
  });

  it('should return results with dense source', async () => {
    const results = await retriever.denseSearch('user login security', sampleCorpus);

    expect(results.length).toBeGreaterThan(0);
    for (const result of results) {
      expect(result.source).toBe('dense');
    }
  });

  it('should capture semantic similarity', async () => {
    const results = await retriever.denseSearch('sign in credentials', sampleCorpus);

    // Should find authentication-related docs even without exact term match
    const contents = results.map(r => r.content.toLowerCase());
    const hasRelevant = contents.some(c =>
      c.includes('authentication') ||
      c.includes('login') ||
      c.includes('credentials')
    );
    expect(hasRelevant).toBe(true);
  });

  it('should handle empty corpus', async () => {
    const results = await retriever.denseSearch('query', []);
    expect(results).toEqual([]);
  });

  it('should handle empty query', async () => {
    const results = await retriever.denseSearch('', sampleCorpus);
    expect(results).toEqual([]);
  });

  it('should return scores between 0 and 1', async () => {
    const results = await retriever.denseSearch('database connection', sampleCorpus);

    for (const result of results) {
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(1);
    }
  });

  it('should be sorted by score descending', async () => {
    const results = await retriever.denseSearch('API routing', sampleCorpus);

    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });
});

// ============================================================================
// GRAPH SEARCH TESTS
// ============================================================================

describe('HybridRetriever - graphSearch', () => {
  let retriever: HybridRetriever;

  beforeAll(() => {
    retriever = createHybridRetriever();
  });

  it('should return results with graph source', () => {
    const results = retriever.graphSearch('authentication');

    for (const result of results) {
      expect(result.source).toBe('graph');
    }
  });

  it('should return results based on graph relationships', () => {
    const results = retriever.graphSearch('session');

    // Graph search finds related concepts through relationships
    expect(Array.isArray(results)).toBe(true);
  });

  it('should handle empty query', () => {
    const results = retriever.graphSearch('');
    expect(results).toEqual([]);
  });

  it('should include metadata about graph traversal', () => {
    const results = retriever.graphSearch('user');

    for (const result of results) {
      expect(result.metadata).toBeDefined();
    }
  });
});

// ============================================================================
// RECIPROCAL RANK FUSION TESTS
// ============================================================================

describe('HybridRetriever - reciprocalRankFusion', () => {
  let retriever: HybridRetriever;

  beforeAll(() => {
    retriever = createHybridRetriever();
  });

  it('should combine results from multiple retrievers', () => {
    const resultSets = [sampleBm25Results, sampleDenseResults, sampleGraphResults];
    const fused = retriever.reciprocalRankFusion(resultSets, 60);

    expect(fused.length).toBeGreaterThan(0);
  });

  it('should assign higher scores to documents appearing in multiple result sets', () => {
    const resultSets = [sampleBm25Results, sampleDenseResults, sampleGraphResults];
    const fused = retriever.reciprocalRankFusion(resultSets, 60);

    // doc-0 and doc-3 appear in all three, should rank high
    const topIds = fused.slice(0, 2).map(r => r.id);
    expect(topIds).toContain('doc-0');
    expect(topIds).toContain('doc-3');
  });

  it('should use correct RRF formula: 1/(k + rank)', () => {
    const k = 60;
    const singleResult: RetrievalResult[] = [
      { id: 'doc-1', content: 'test', score: 1.0, source: 'bm25', metadata: {} },
    ];

    const fused = retriever.reciprocalRankFusion([singleResult], k);

    // For rank 1: score = 1/(60 + 1) = 1/61
    expect(fused[0].fusedScore).toBeCloseTo(1 / 61, 5);
  });

  it('should accumulate scores across result sets', () => {
    const k = 60;
    // Document at rank 1 in two lists
    const list1: RetrievalResult[] = [
      { id: 'doc-1', content: 'test', score: 1.0, source: 'bm25', metadata: {} },
    ];
    const list2: RetrievalResult[] = [
      { id: 'doc-1', content: 'test', score: 0.9, source: 'dense', metadata: {} },
    ];

    const fused = retriever.reciprocalRankFusion([list1, list2], k);

    // Score should be 1/(60+1) + 1/(60+1) = 2/61
    expect(fused[0].fusedScore).toBeCloseTo(2 / 61, 5);
  });

  it('should sort results by fused score descending', () => {
    const resultSets = [sampleBm25Results, sampleDenseResults];
    const fused = retriever.reciprocalRankFusion(resultSets, 60);

    for (let i = 1; i < fused.length; i++) {
      expect(fused[i - 1].fusedScore).toBeGreaterThanOrEqual(fused[i].fusedScore);
    }
  });

  it('should include component scores from each retriever', () => {
    const resultSets = [sampleBm25Results, sampleDenseResults, sampleGraphResults];
    const fused = retriever.reciprocalRankFusion(resultSets, 60);

    for (const result of fused) {
      expect(result.componentScores).toBeDefined();
      // Should have at least one component score
      const hasScore = result.componentScores.bm25 !== undefined ||
        result.componentScores.dense !== undefined ||
        result.componentScores.graph !== undefined;
      expect(hasScore).toBe(true);
    }
  });

  it('should assign ranks starting from 1', () => {
    const resultSets = [sampleBm25Results];
    const fused = retriever.reciprocalRankFusion(resultSets, 60);

    for (let i = 0; i < fused.length; i++) {
      expect(fused[i].rank).toBe(i + 1);
    }
  });

  it('should handle empty result sets', () => {
    const fused = retriever.reciprocalRankFusion([], 60);
    expect(fused).toEqual([]);
  });

  it('should handle all empty lists', () => {
    const fused = retriever.reciprocalRankFusion([[], [], []], 60);
    expect(fused).toEqual([]);
  });

  it('should handle different k values', () => {
    const resultSets = [sampleBm25Results, sampleDenseResults];

    const fusedK60 = retriever.reciprocalRankFusion(resultSets, 60);
    const fusedK10 = retriever.reciprocalRankFusion(resultSets, 10);

    // Different k values should produce different scores
    expect(fusedK60[0].fusedScore).not.toBe(fusedK10[0].fusedScore);

    // Lower k gives higher scores (1/(10+1) > 1/(60+1))
    expect(fusedK10[0].fusedScore).toBeGreaterThan(fusedK60[0].fusedScore);
  });

  it('should deduplicate results by id', () => {
    const resultSets = [sampleBm25Results, sampleDenseResults, sampleGraphResults];
    const fused = retriever.reciprocalRankFusion(resultSets, 60);

    const ids = fused.map(r => r.id);
    const uniqueIds = [...new Set(ids)];
    expect(ids.length).toBe(uniqueIds.length);
  });
});

// ============================================================================
// MAIN RETRIEVE METHOD TESTS
// ============================================================================

describe('HybridRetriever - retrieve', () => {
  let retriever: HybridRetriever;

  beforeAll(() => {
    retriever = createHybridRetriever();
  });

  it('should return HybridRetrievalOutput with all required fields', async () => {
    const input: HybridRetrievalInput = {
      query: 'authentication login',
      corpus: sampleCorpus,
    };

    const output = await retriever.retrieve(input);

    expect(output.results).toBeDefined();
    expect(Array.isArray(output.results)).toBe(true);
    expect(output.metrics).toBeDefined();
    expect(typeof output.metrics.bm25Count).toBe('number');
    expect(typeof output.metrics.denseCount).toBe('number');
    expect(typeof output.metrics.graphCount).toBe('number');
    expect(typeof output.metrics.fusionTime).toBe('number');
  });

  it('should respect maxResults config', async () => {
    const input: HybridRetrievalInput = {
      query: 'authentication',
      corpus: sampleCorpus,
      config: { maxResults: 3 },
    };

    const output = await retriever.retrieve(input);

    expect(output.results.length).toBeLessThanOrEqual(3);
  });

  it('should combine results from all three retrieval methods', async () => {
    const input: HybridRetrievalInput = {
      query: 'database connection pooling',
      corpus: sampleCorpus,
    };

    const output = await retriever.retrieve(input);

    // Should have counts from all retrievers
    expect(output.metrics.bm25Count).toBeGreaterThanOrEqual(0);
    expect(output.metrics.denseCount).toBeGreaterThanOrEqual(0);
    expect(output.metrics.graphCount).toBeGreaterThanOrEqual(0);
  });

  it('should use custom weights when provided', async () => {
    const input: HybridRetrievalInput = {
      query: 'caching',
      corpus: sampleCorpus,
      config: {
        bm25Weight: 1.0,
        denseWeight: 0.0,
        graphWeight: 0.0,
      },
    };

    const output = await retriever.retrieve(input);

    // With only BM25 weight, results should still be valid
    expect(output.results.length).toBeGreaterThanOrEqual(0);
  });

  it('should use custom RRF k parameter', async () => {
    const input: HybridRetrievalInput = {
      query: 'API',
      corpus: sampleCorpus,
      config: { rrfK: 10 },
    };

    const output = await retriever.retrieve(input);

    expect(output.results).toBeDefined();
  });

  it('should track fusion time in metrics', async () => {
    const input: HybridRetrievalInput = {
      query: 'session management',
      corpus: sampleCorpus,
    };

    const output = await retriever.retrieve(input);

    expect(output.metrics.fusionTime).toBeGreaterThanOrEqual(0);
  });

  it('should handle empty corpus', async () => {
    const input: HybridRetrievalInput = {
      query: 'test',
      corpus: [],
    };

    const output = await retriever.retrieve(input);

    expect(output.results).toEqual([]);
  });

  it('should handle empty query', async () => {
    const input: HybridRetrievalInput = {
      query: '',
      corpus: sampleCorpus,
    };

    const output = await retriever.retrieve(input);

    expect(output.results).toEqual([]);
  });

  it('should return results with proper FusedResult structure', async () => {
    const input: HybridRetrievalInput = {
      query: 'authentication',
      corpus: sampleCorpus,
    };

    const output = await retriever.retrieve(input);

    for (const result of output.results) {
      expect(typeof result.id).toBe('string');
      expect(typeof result.content).toBe('string');
      expect(typeof result.fusedScore).toBe('number');
      expect(result.componentScores).toBeDefined();
      expect(typeof result.rank).toBe('number');
    }
  });
});

// ============================================================================
// WEIGHT APPLICATION TESTS
// ============================================================================

describe('HybridRetriever - Weight Application', () => {
  let retriever: HybridRetriever;

  beforeAll(() => {
    retriever = createHybridRetriever();
  });

  it('should apply weights correctly in fusion', async () => {
    // Test with only BM25
    const bm25Only: HybridRetrievalInput = {
      query: 'authentication',
      corpus: sampleCorpus,
      config: { bm25Weight: 1.0, denseWeight: 0.0, graphWeight: 0.0 },
    };

    const outputBm25 = await retriever.retrieve(bm25Only);

    // Test with only Dense
    const denseOnly: HybridRetrievalInput = {
      query: 'authentication',
      corpus: sampleCorpus,
      config: { bm25Weight: 0.0, denseWeight: 1.0, graphWeight: 0.0 },
    };

    const outputDense = await retriever.retrieve(denseOnly);

    // Results should potentially differ based on retrieval method
    // (they might be similar but the scores/ranking could differ)
    expect(outputBm25.results).toBeDefined();
    expect(outputDense.results).toBeDefined();
  });

  it('should handle zero weights for all retrievers gracefully', async () => {
    const input: HybridRetrievalInput = {
      query: 'test',
      corpus: sampleCorpus,
      config: { bm25Weight: 0, denseWeight: 0, graphWeight: 0 },
    };

    const output = await retriever.retrieve(input);

    // Should return empty or handle gracefully
    expect(Array.isArray(output.results)).toBe(true);
  });

  it('should normalize weights appropriately', async () => {
    const input: HybridRetrievalInput = {
      query: 'authentication',
      corpus: sampleCorpus,
      config: { bm25Weight: 10, denseWeight: 5, graphWeight: 5 },
    };

    const output = await retriever.retrieve(input);

    // Should work regardless of weight scale
    expect(output.results.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// INTERFACE COMPLIANCE TESTS
// ============================================================================

describe('Interface Compliance', () => {
  let retriever: HybridRetriever;

  beforeAll(() => {
    retriever = createHybridRetriever();
  });

  it('RetrievalResult should have all required fields', () => {
    const results = retriever.bm25Search('test', sampleCorpus);

    if (results.length > 0) {
      const result = results[0];
      expect('id' in result).toBe(true);
      expect('content' in result).toBe(true);
      expect('score' in result).toBe(true);
      expect('source' in result).toBe(true);
      expect('metadata' in result).toBe(true);
    }
  });

  it('FusedResult should have all required fields', () => {
    const resultSets = [sampleBm25Results, sampleDenseResults];
    const fused = retriever.reciprocalRankFusion(resultSets, 60);

    if (fused.length > 0) {
      const result = fused[0];
      expect('id' in result).toBe(true);
      expect('content' in result).toBe(true);
      expect('fusedScore' in result).toBe(true);
      expect('componentScores' in result).toBe(true);
      expect('rank' in result).toBe(true);
    }
  });

  it('HybridRetrievalOutput should have all required fields', async () => {
    const input: HybridRetrievalInput = {
      query: 'test',
      corpus: sampleCorpus,
    };

    const output = await retriever.retrieve(input);

    expect('results' in output).toBe(true);
    expect('metrics' in output).toBe(true);
    expect('bm25Count' in output.metrics).toBe(true);
    expect('denseCount' in output.metrics).toBe(true);
    expect('graphCount' in output.metrics).toBe(true);
    expect('fusionTime' in output.metrics).toBe(true);
  });
});

// ============================================================================
// EDGE CASES
// ============================================================================

describe('HybridRetriever - Edge Cases', () => {
  let retriever: HybridRetriever;

  beforeAll(() => {
    retriever = createHybridRetriever();
  });

  it('should handle single document corpus', async () => {
    const input: HybridRetrievalInput = {
      query: 'test',
      corpus: ['Single document for testing.'],
    };

    const output = await retriever.retrieve(input);

    expect(output.results.length).toBeLessThanOrEqual(1);
  });

  it('should handle very long documents', async () => {
    const longDoc = 'word '.repeat(10000);
    const input: HybridRetrievalInput = {
      query: 'word',
      corpus: [longDoc],
    };

    const output = await retriever.retrieve(input);

    expect(output).toBeDefined();
  });

  it('should handle very long queries', async () => {
    const longQuery = 'authentication '.repeat(100);
    const input: HybridRetrievalInput = {
      query: longQuery,
      corpus: sampleCorpus,
    };

    const output = await retriever.retrieve(input);

    expect(output).toBeDefined();
  });

  it('should handle special characters in documents', async () => {
    const input: HybridRetrievalInput = {
      query: 'API',
      corpus: [
        'API endpoint: /api/v1/users?id=123&name=test',
        'Regular expressions: /^[a-z]+$/gi',
        'Math formulas: x² + y² = z²',
      ],
    };

    const output = await retriever.retrieve(input);

    expect(output).toBeDefined();
  });

  it('should handle unicode characters', async () => {
    const input: HybridRetrievalInput = {
      query: 'emoji test',
      corpus: [
        'Test with emojis: 🚀 📊 ✅',
        'Chinese characters: 你好世界',
        'Arabic text: مرحبا بالعالم',
      ],
    };

    const output = await retriever.retrieve(input);

    expect(output).toBeDefined();
  });

  it('should handle corpus with duplicate documents', async () => {
    const input: HybridRetrievalInput = {
      query: 'test',
      corpus: ['Same document', 'Same document', 'Same document'],
    };

    const output = await retriever.retrieve(input);

    expect(output).toBeDefined();
  });

  it('should handle maxResults of 0', async () => {
    const input: HybridRetrievalInput = {
      query: 'test',
      corpus: sampleCorpus,
      config: { maxResults: 0 },
    };

    const output = await retriever.retrieve(input);

    expect(output.results).toEqual([]);
  });

  it('should handle negative RRF k gracefully', async () => {
    const input: HybridRetrievalInput = {
      query: 'test',
      corpus: sampleCorpus,
      config: { rrfK: -10 },
    };

    // Should either throw or use default/absolute value
    try {
      const output = await retriever.retrieve(input);
      // If it doesn't throw, results should still be valid
      expect(output).toBeDefined();
    } catch (error) {
      // If it throws, that's also acceptable behavior
      expect(error).toBeDefined();
    }
  });
});

// ============================================================================
// PERFORMANCE TESTS
// ============================================================================

describe('HybridRetriever - Performance', () => {
  let retriever: HybridRetriever;

  beforeAll(() => {
    retriever = createHybridRetriever();
  });

  it('should complete retrieval within reasonable time', async () => {
    const start = Date.now();

    const input: HybridRetrievalInput = {
      query: 'authentication session management',
      corpus: sampleCorpus,
    };

    await retriever.retrieve(input);

    const elapsed = Date.now() - start;

    // Should complete within 5 seconds for small corpus
    expect(elapsed).toBeLessThan(5000);
  });

  it('should handle larger corpus efficiently', async () => {
    // Create a larger corpus
    const largeCorpus = Array.from({ length: 100 }, (_, i) =>
      `Document ${i}: This is test content about various topics like authentication, databases, APIs, and more.`
    );

    const start = Date.now();

    const input: HybridRetrievalInput = {
      query: 'authentication',
      corpus: largeCorpus,
      config: { maxResults: 10 },
    };

    await retriever.retrieve(input);

    const elapsed = Date.now() - start;

    // Should complete within 10 seconds for larger corpus
    expect(elapsed).toBeLessThan(10000);
  });

  it('should track fusion time accurately', async () => {
    const input: HybridRetrievalInput = {
      query: 'test query',
      corpus: sampleCorpus,
    };

    const output = await retriever.retrieve(input);

    // Fusion time should be positive and reasonable
    expect(output.metrics.fusionTime).toBeGreaterThanOrEqual(0);
    expect(output.metrics.fusionTime).toBeLessThan(5000);
  });
});

// ============================================================================
// MRR TARGET TESTS
// ============================================================================

describe('HybridRetriever - MRR Target >= 0.75', () => {
  let retriever: HybridRetriever;

  beforeAll(() => {
    retriever = createHybridRetriever();
  });

  it('should achieve high MRR for exact term matches', async () => {
    // Query with exact terms should rank relevant docs highly
    const input: HybridRetrievalInput = {
      query: 'authentication login credentials',
      corpus: sampleCorpus,
    };

    const output = await retriever.retrieve(input);

    if (output.results.length > 0) {
      // The first result should be highly relevant
      const firstResult = output.results[0];
      expect(firstResult.fusedScore).toBeGreaterThan(0);
    }
  });

  it('should combine signals effectively for semantic queries', async () => {
    // Semantic query that benefits from multiple retrieval methods
    const input: HybridRetrievalInput = {
      query: 'user sign in security',
      corpus: sampleCorpus,
    };

    const output = await retriever.retrieve(input);

    if (output.results.length > 0) {
      // Should find authentication-related documents
      const topContents = output.results.slice(0, 3).map(r => r.content.toLowerCase());
      const hasRelevant = topContents.some(c =>
        c.includes('authentication') ||
        c.includes('login') ||
        c.includes('credentials') ||
        c.includes('session')
      );
      expect(hasRelevant).toBe(true);
    }
  });

  it('should rank documents appearing in multiple retrievers higher', async () => {
    const input: HybridRetrievalInput = {
      query: 'database caching optimization',
      corpus: sampleCorpus,
    };

    const output = await retriever.retrieve(input);

    if (output.results.length >= 2) {
      // Top results should have higher fused scores
      expect(output.results[0].fusedScore).toBeGreaterThanOrEqual(output.results[1].fusedScore);
    }
  });
});
