/**
 * @fileoverview Tests for Iterative Retrieval (WU-1108)
 *
 * Tests are written FIRST (TDD). Implementation comes AFTER these tests fail.
 *
 * The Iterative Retrieval system improves retrieval quality by doing multiple
 * rounds of retrieval, using results from each round to refine the next.
 * This is a Tier-2 feature.
 *
 * @packageDocumentation
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import {
  IterativeRetriever,
  createIterativeRetriever,
  type IterativeRetrievalConfig,
  type IterativeRetrievalResult,
  type RetrievalRound,
  type IterativeRetrievalResultItem,
} from '../iterative_retrieval.js';

// ============================================================================
// TEST FIXTURES
// ============================================================================

const LIBRARIAN_ROOT = path.resolve(__dirname, '../../..');

// Sample retrieval results for testing
const sampleResults: IterativeRetrievalResultItem[] = [
  {
    file: 'src/agents/problem_detector.ts',
    score: 0.95,
    snippet: 'export class ProblemDetector implements Agent { ... }',
    matchedTerms: ['ProblemDetector', 'Agent'],
  },
  {
    file: 'src/agents/types.ts',
    score: 0.85,
    snippet: 'export interface Agent { agentType: AgentType; name: string; }',
    matchedTerms: ['Agent', 'AgentType'],
  },
  {
    file: 'src/agents/index.ts',
    score: 0.75,
    snippet: 'export { ProblemDetector } from "./problem_detector.js";',
    matchedTerms: ['ProblemDetector'],
  },
];

// ============================================================================
// FACTORY FUNCTION TESTS
// ============================================================================

describe('createIterativeRetriever', () => {
  it('should create a retriever instance', () => {
    const retriever = createIterativeRetriever();
    expect(retriever).toBeInstanceOf(IterativeRetriever);
  });
});

// ============================================================================
// EXTRACT NEW TERMS TESTS
// ============================================================================

describe('IterativeRetriever - extractNewTerms', () => {
  let retriever: IterativeRetriever;

  beforeAll(() => {
    retriever = createIterativeRetriever();
  });

  it('should extract function names from snippets', () => {
    const results: IterativeRetrievalResultItem[] = [
      {
        file: 'src/utils.ts',
        score: 0.9,
        snippet: 'export function calculateMetrics(input: Data): Metrics { ... }',
        matchedTerms: ['Metrics'],
      },
    ];
    const existingTerms = ['Metrics'];

    const newTerms = retriever.extractNewTerms(results, existingTerms);

    expect(newTerms).toContain('calculateMetrics');
    expect(newTerms).not.toContain('Metrics'); // Already existed
  });

  it('should extract class names from snippets', () => {
    const results: IterativeRetrievalResultItem[] = [
      {
        file: 'src/models.ts',
        score: 0.9,
        snippet: 'export class DataProcessor { process() { return new ProcessedData(); } }',
        matchedTerms: [],
      },
    ];

    const newTerms = retriever.extractNewTerms(results, []);

    expect(newTerms).toContain('DataProcessor');
  });

  it('should extract import sources', () => {
    const results: IterativeRetrievalResultItem[] = [
      {
        file: 'src/main.ts',
        score: 0.9,
        snippet: "import { Logger } from './logging/logger.js';",
        matchedTerms: [],
      },
    ];

    const newTerms = retriever.extractNewTerms(results, []);

    // Should extract Logger as an identifier and path-based terms
    expect(newTerms).toContain('Logger');
    // Path segments may be extracted (logging, logger)
    expect(newTerms.some((t) => t.toLowerCase().includes('logging') || t.toLowerCase().includes('logger'))).toBe(true);
  });

  it('should extract type references', () => {
    const results: IterativeRetrievalResultItem[] = [
      {
        file: 'src/types.ts',
        score: 0.9,
        snippet: 'function process(input: UserInput): OutputResult { ... }',
        matchedTerms: [],
      },
    ];

    const newTerms = retriever.extractNewTerms(results, []);

    expect(newTerms).toContain('UserInput');
    expect(newTerms).toContain('OutputResult');
  });

  it('should not include existing terms', () => {
    const results: IterativeRetrievalResultItem[] = [
      {
        file: 'src/test.ts',
        score: 0.9,
        snippet: 'class Foo { bar: Bar; baz: Baz }',
        matchedTerms: ['Foo'],
      },
    ];
    const existingTerms = ['Foo', 'Bar'];

    const newTerms = retriever.extractNewTerms(results, existingTerms);

    expect(newTerms).not.toContain('Foo');
    expect(newTerms).not.toContain('Bar');
    expect(newTerms).toContain('Baz');
  });

  it('should handle empty results array', () => {
    const newTerms = retriever.extractNewTerms([], []);
    expect(newTerms).toEqual([]);
  });

  it('should deduplicate terms', () => {
    const results: IterativeRetrievalResultItem[] = [
      {
        file: 'src/a.ts',
        score: 0.9,
        snippet: 'class Foo {}',
        matchedTerms: [],
      },
      {
        file: 'src/b.ts',
        score: 0.8,
        snippet: 'import { Foo } from "./a.js";',
        matchedTerms: [],
      },
    ];

    const newTerms = retriever.extractNewTerms(results, []);

    // Should only have Foo once
    expect(newTerms.filter((t) => t === 'Foo').length).toBe(1);
  });
});

// ============================================================================
// EXPAND QUERY TESTS
// ============================================================================

describe('IterativeRetriever - expandQuery', () => {
  let retriever: IterativeRetriever;

  beforeAll(() => {
    retriever = createIterativeRetriever();
  });

  it('should expand query with new terms', () => {
    const originalQuery = 'find authentication';
    const newTerms = ['AuthService', 'login', 'credentials'];

    const expandedQuery = retriever.expandQuery(originalQuery, newTerms);

    expect(expandedQuery).toContain('authentication');
    expect(expandedQuery).toContain('AuthService');
    expect(expandedQuery).toContain('login');
    expect(expandedQuery).toContain('credentials');
  });

  it('should preserve original query intent', () => {
    const originalQuery = 'how does caching work';
    const newTerms = ['CacheManager', 'redis'];

    const expandedQuery = retriever.expandQuery(originalQuery, newTerms);

    expect(expandedQuery).toContain('caching');
    expect(expandedQuery).toContain('work');
  });

  it('should handle empty new terms', () => {
    const originalQuery = 'find something';
    const expandedQuery = retriever.expandQuery(originalQuery, []);

    expect(expandedQuery).toBe(originalQuery);
  });

  it('should limit query expansion to avoid overly long queries', () => {
    const originalQuery = 'find feature';
    const newTerms = Array.from({ length: 50 }, (_, i) => `Term${i}`);

    const expandedQuery = retriever.expandQuery(originalQuery, newTerms);

    // Should not include all 50 terms
    expect(expandedQuery.split(' ').length).toBeLessThan(30);
  });
});

// ============================================================================
// CHASE REFERENCES TESTS
// ============================================================================

describe('IterativeRetriever - chaseReferences', () => {
  let retriever: IterativeRetriever;

  beforeAll(() => {
    retriever = createIterativeRetriever();
  });

  it('should find imported files', async () => {
    // Create a temp file or use existing test fixture
    const referencedFiles = await retriever.chaseReferences(
      path.join(LIBRARIAN_ROOT, 'src/evaluation/citation_verifier.ts'),
      LIBRARIAN_ROOT
    );

    // Should find imports like ast_fact_extractor.js
    expect(referencedFiles.some((f) => f.includes('ast_fact_extractor'))).toBe(true);
  });

  it('should find exported file targets', async () => {
    const referencedFiles = await retriever.chaseReferences(
      path.join(LIBRARIAN_ROOT, 'src/evaluation/index.ts'),
      LIBRARIAN_ROOT
    );

    // Should find re-exported modules
    expect(referencedFiles.length).toBeGreaterThan(0);
  });

  it('should handle non-existent files gracefully', async () => {
    const referencedFiles = await retriever.chaseReferences(
      '/nonexistent/file.ts',
      LIBRARIAN_ROOT
    );

    expect(referencedFiles).toEqual([]);
  });

  it('should return unique file references', async () => {
    const referencedFiles = await retriever.chaseReferences(
      path.join(LIBRARIAN_ROOT, 'src/evaluation/index.ts'),
      LIBRARIAN_ROOT
    );

    const uniqueFiles = [...new Set(referencedFiles)];
    expect(referencedFiles.length).toBe(uniqueFiles.length);
  });

  it('should resolve relative paths', async () => {
    const referencedFiles = await retriever.chaseReferences(
      path.join(LIBRARIAN_ROOT, 'src/evaluation/citation_verifier.ts'),
      LIBRARIAN_ROOT
    );

    // All paths should be absolute or normalized
    for (const file of referencedFiles) {
      expect(file.startsWith('src/') || path.isAbsolute(file)).toBe(true);
    }
  });
});

// ============================================================================
// CALCULATE COVERAGE GAIN TESTS
// ============================================================================

describe('IterativeRetriever - calculateCoverageGain', () => {
  let retriever: IterativeRetriever;

  beforeAll(() => {
    retriever = createIterativeRetriever();
  });

  it('should calculate positive gain when new coverage is higher', () => {
    const prevRound: RetrievalRound = {
      round: 1,
      query: 'find auth',
      results: [{ file: 'a.ts', score: 0.9, snippet: '', matchedTerms: ['auth'] }],
      newTerms: [],
      coverage: 0.3,
    };

    const currentRound: RetrievalRound = {
      round: 2,
      query: 'find auth login',
      results: [
        { file: 'a.ts', score: 0.9, snippet: '', matchedTerms: ['auth'] },
        { file: 'b.ts', score: 0.8, snippet: '', matchedTerms: ['login'] },
      ],
      newTerms: [],
      coverage: 0.6,
    };

    const gain = retriever.calculateCoverageGain(prevRound, currentRound);

    expect(gain).toBeCloseTo(0.3, 2);
  });

  it('should return zero gain when coverage stays the same', () => {
    const prevRound: RetrievalRound = {
      round: 1,
      query: 'find auth',
      results: [{ file: 'a.ts', score: 0.9, snippet: '', matchedTerms: [] }],
      newTerms: [],
      coverage: 0.5,
    };

    const currentRound: RetrievalRound = {
      round: 2,
      query: 'find auth login',
      results: [{ file: 'a.ts', score: 0.9, snippet: '', matchedTerms: [] }],
      newTerms: [],
      coverage: 0.5,
    };

    const gain = retriever.calculateCoverageGain(prevRound, currentRound);

    expect(gain).toBe(0);
  });

  it('should return negative gain when coverage decreases', () => {
    const prevRound: RetrievalRound = {
      round: 1,
      query: 'find auth',
      results: [{ file: 'a.ts', score: 0.9, snippet: '', matchedTerms: [] }],
      newTerms: [],
      coverage: 0.7,
    };

    const currentRound: RetrievalRound = {
      round: 2,
      query: 'find auth narrow',
      results: [],
      newTerms: [],
      coverage: 0.4,
    };

    const gain = retriever.calculateCoverageGain(prevRound, currentRound);

    expect(gain).toBeLessThan(0);
  });

  it('should handle first round (no previous)', () => {
    const currentRound: RetrievalRound = {
      round: 1,
      query: 'find auth',
      results: [{ file: 'a.ts', score: 0.9, snippet: '', matchedTerms: [] }],
      newTerms: ['AuthService'],
      coverage: 0.4,
    };

    // Pass undefined or a zero-coverage "round 0"
    const prevRound: RetrievalRound = {
      round: 0,
      query: '',
      results: [],
      newTerms: [],
      coverage: 0,
    };

    const gain = retriever.calculateCoverageGain(prevRound, currentRound);

    expect(gain).toBe(0.4);
  });
});

// ============================================================================
// RETRIEVE (MAIN FUNCTION) TESTS
// ============================================================================

describe('IterativeRetriever - retrieve', () => {
  let retriever: IterativeRetriever;

  beforeAll(() => {
    retriever = createIterativeRetriever();
  });

  it('should perform multi-round retrieval', async () => {
    const config: IterativeRetrievalConfig = {
      maxRounds: 3,
      minCoverageGain: 0.05,
      termExpansion: true,
      crossFileChasing: true,
    };

    const result = await retriever.retrieve('Agent', LIBRARIAN_ROOT, config);

    expect(result.rounds.length).toBeGreaterThanOrEqual(1);
    expect(result.rounds.length).toBeLessThanOrEqual(3);
    expect(result.query).toBe('Agent');
    expect(result.finalResults).toBeDefined();
    expect(Array.isArray(result.filesExplored)).toBe(true);
  });

  it('should stop when coverage gain is below threshold', async () => {
    const config: IterativeRetrievalConfig = {
      maxRounds: 10,
      minCoverageGain: 0.5, // High threshold - should stop early
      termExpansion: true,
      crossFileChasing: false,
    };

    const result = await retriever.retrieve('Agent', LIBRARIAN_ROOT, config);

    // Should stop before 10 rounds due to insufficient coverage gain
    expect(result.rounds.length).toBeLessThan(10);
  });

  it('should respect maxRounds limit', async () => {
    const config: IterativeRetrievalConfig = {
      maxRounds: 2,
      minCoverageGain: 0.01,
      termExpansion: true,
      crossFileChasing: true,
    };

    const result = await retriever.retrieve('evaluation', LIBRARIAN_ROOT, config);

    expect(result.rounds.length).toBeLessThanOrEqual(2);
  });

  it('should accumulate discovered terms across rounds', async () => {
    const config: IterativeRetrievalConfig = {
      maxRounds: 3,
      minCoverageGain: 0.05,
      termExpansion: true,
      crossFileChasing: false,
    };

    const result = await retriever.retrieve('Agent', LIBRARIAN_ROOT, config);

    // Should discover new terms
    expect(result.termsDiscovered.length).toBeGreaterThanOrEqual(0);

    // Terms discovered should be unique
    const uniqueTerms = [...new Set(result.termsDiscovered)];
    expect(result.termsDiscovered.length).toBe(uniqueTerms.length);
  });

  it('should track files explored', async () => {
    const config: IterativeRetrievalConfig = {
      maxRounds: 2,
      minCoverageGain: 0.05,
      termExpansion: true,
      crossFileChasing: true,
    };

    const result = await retriever.retrieve('evaluation', LIBRARIAN_ROOT, config);

    expect(result.filesExplored.length).toBeGreaterThan(0);
    // Files explored should be unique
    const uniqueFiles = [...new Set(result.filesExplored)];
    expect(result.filesExplored.length).toBe(uniqueFiles.length);
  });

  it('should use default config when none provided', async () => {
    const result = await retriever.retrieve('Agent', LIBRARIAN_ROOT);

    expect(result.rounds.length).toBeGreaterThanOrEqual(1);
    expect(result.finalResults).toBeDefined();
  });

  it('should include round number in each round', async () => {
    const result = await retriever.retrieve('Agent', LIBRARIAN_ROOT, {
      maxRounds: 2,
      minCoverageGain: 0.01,
      termExpansion: false,
      crossFileChasing: false,
    });

    for (let i = 0; i < result.rounds.length; i++) {
      expect(result.rounds[i].round).toBe(i + 1);
    }
  });

  it('should calculate total coverage', async () => {
    const result = await retriever.retrieve('evaluation', LIBRARIAN_ROOT, {
      maxRounds: 2,
      minCoverageGain: 0.01,
      termExpansion: true,
      crossFileChasing: false,
    });

    expect(typeof result.totalCoverage).toBe('number');
    expect(result.totalCoverage).toBeGreaterThanOrEqual(0);
    expect(result.totalCoverage).toBeLessThanOrEqual(1);
  });
});

// ============================================================================
// CROSS-FILE CHASING TESTS
// ============================================================================

describe('IterativeRetriever - Cross-file chasing', () => {
  let retriever: IterativeRetriever;

  beforeAll(() => {
    retriever = createIterativeRetriever();
  });

  it('should follow imports when crossFileChasing is enabled', async () => {
    const resultWithChasing = await retriever.retrieve('CitationVerifier', LIBRARIAN_ROOT, {
      maxRounds: 2,
      minCoverageGain: 0.01,
      termExpansion: false,
      crossFileChasing: true,
    });

    const resultWithoutChasing = await retriever.retrieve('CitationVerifier', LIBRARIAN_ROOT, {
      maxRounds: 2,
      minCoverageGain: 0.01,
      termExpansion: false,
      crossFileChasing: false,
    });

    // With chasing, should potentially find more files
    expect(resultWithChasing.filesExplored.length).toBeGreaterThanOrEqual(
      resultWithoutChasing.filesExplored.length
    );
  });

  it('should not follow imports when crossFileChasing is disabled', async () => {
    const result = await retriever.retrieve('index', LIBRARIAN_ROOT, {
      maxRounds: 1,
      minCoverageGain: 0.5,
      termExpansion: false,
      crossFileChasing: false,
    });

    // Should only have files from initial retrieval
    expect(result.rounds.length).toBe(1);
  });
});

// ============================================================================
// TERM EXPANSION TESTS
// ============================================================================

describe('IterativeRetriever - Term expansion', () => {
  let retriever: IterativeRetriever;

  beforeAll(() => {
    retriever = createIterativeRetriever();
  });

  it('should expand query when termExpansion is enabled', async () => {
    const result = await retriever.retrieve('Agent', LIBRARIAN_ROOT, {
      maxRounds: 2,
      minCoverageGain: 0.01,
      termExpansion: true,
      crossFileChasing: false,
    });

    // Second round should have an expanded query
    if (result.rounds.length > 1) {
      expect(result.rounds[1].query.length).toBeGreaterThanOrEqual(result.rounds[0].query.length);
    }
  });

  it('should not expand query when termExpansion is disabled', async () => {
    const result = await retriever.retrieve('Agent', LIBRARIAN_ROOT, {
      maxRounds: 2,
      minCoverageGain: 0.01,
      termExpansion: false,
      crossFileChasing: false,
    });

    // All rounds should have the same query
    for (const round of result.rounds) {
      expect(round.query).toBe('Agent');
    }
  });
});

// ============================================================================
// INTERFACE TESTS
// ============================================================================

describe('IterativeRetrievalResult Interface', () => {
  let retriever: IterativeRetriever;

  beforeAll(() => {
    retriever = createIterativeRetriever();
  });

  it('should have all required fields', async () => {
    const result = await retriever.retrieve('test', LIBRARIAN_ROOT);

    expect(result.query).toBeDefined();
    expect(Array.isArray(result.rounds)).toBe(true);
    expect(Array.isArray(result.finalResults)).toBe(true);
    expect(typeof result.totalCoverage).toBe('number');
    expect(Array.isArray(result.termsDiscovered)).toBe(true);
    expect(Array.isArray(result.filesExplored)).toBe(true);
  });
});

describe('RetrievalRound Interface', () => {
  let retriever: IterativeRetriever;

  beforeAll(() => {
    retriever = createIterativeRetriever();
  });

  it('should have all required fields in each round', async () => {
    const result = await retriever.retrieve('evaluation', LIBRARIAN_ROOT, {
      maxRounds: 1,
      minCoverageGain: 0.5,
      termExpansion: false,
      crossFileChasing: false,
    });

    expect(result.rounds.length).toBeGreaterThanOrEqual(1);

    const round = result.rounds[0];
    expect(typeof round.round).toBe('number');
    expect(typeof round.query).toBe('string');
    expect(Array.isArray(round.results)).toBe(true);
    expect(Array.isArray(round.newTerms)).toBe(true);
    expect(typeof round.coverage).toBe('number');
  });
});

describe('IterativeRetrievalResultItem Interface', () => {
  let retriever: IterativeRetriever;

  beforeAll(() => {
    retriever = createIterativeRetriever();
  });

  it('should have all required fields in result items', async () => {
    const result = await retriever.retrieve('evaluation', LIBRARIAN_ROOT, {
      maxRounds: 1,
      minCoverageGain: 0.5,
      termExpansion: false,
      crossFileChasing: false,
    });

    if (result.finalResults.length > 0) {
      const item = result.finalResults[0];
      expect(typeof item.file).toBe('string');
      expect(typeof item.score).toBe('number');
      expect(typeof item.snippet).toBe('string');
      expect(Array.isArray(item.matchedTerms)).toBe(true);
    }
  });
});

// ============================================================================
// EDGE CASES
// ============================================================================

describe('IterativeRetriever - Edge Cases', () => {
  let retriever: IterativeRetriever;

  beforeAll(() => {
    retriever = createIterativeRetriever();
  });

  it('should handle empty query', async () => {
    const result = await retriever.retrieve('', LIBRARIAN_ROOT);

    expect(result.rounds.length).toBeGreaterThanOrEqual(0);
    expect(result.finalResults).toBeDefined();
  });

  it('should handle non-existent repo path', async () => {
    const result = await retriever.retrieve('test', '/nonexistent/repo/path');

    expect(result.finalResults).toEqual([]);
    expect(result.filesExplored).toEqual([]);
  });

  it('should handle query with special characters', async () => {
    const result = await retriever.retrieve('find: "test" (config)', LIBRARIAN_ROOT);

    expect(result).toBeDefined();
    expect(result.query).toContain('test');
  });

  it('should handle very long query', async () => {
    const longQuery = 'search '.repeat(100);
    const result = await retriever.retrieve(longQuery, LIBRARIAN_ROOT, {
      maxRounds: 1,
      minCoverageGain: 0.5,
      termExpansion: false,
      crossFileChasing: false,
    });

    expect(result).toBeDefined();
  });

  it('should handle maxRounds of 0', async () => {
    const result = await retriever.retrieve('test', LIBRARIAN_ROOT, {
      maxRounds: 0,
      minCoverageGain: 0.01,
      termExpansion: true,
      crossFileChasing: true,
    });

    // Should return with 0 rounds or handle gracefully
    expect(result.rounds.length).toBe(0);
  });

  it('should handle negative minCoverageGain', async () => {
    const result = await retriever.retrieve('Agent', LIBRARIAN_ROOT, {
      maxRounds: 2,
      minCoverageGain: -0.5,
      termExpansion: true,
      crossFileChasing: false,
    });

    // Should still work (negative threshold means always continue)
    expect(result).toBeDefined();
  });
});

// ============================================================================
// PERFORMANCE TESTS
// ============================================================================

describe('IterativeRetriever - Performance', () => {
  let retriever: IterativeRetriever;

  beforeAll(() => {
    retriever = createIterativeRetriever();
  });

  it('should complete within reasonable time for typical queries', async () => {
    const start = Date.now();

    await retriever.retrieve('evaluation', LIBRARIAN_ROOT, {
      maxRounds: 3,
      minCoverageGain: 0.05,
      termExpansion: true,
      crossFileChasing: true,
    });

    const elapsed = Date.now() - start;

    // Should complete within 10 seconds
    expect(elapsed).toBeLessThan(10000);
  });

  it('should not degrade significantly with more rounds', async () => {
    const start1 = Date.now();
    await retriever.retrieve('test', LIBRARIAN_ROOT, {
      maxRounds: 1,
      minCoverageGain: 0.5,
      termExpansion: false,
      crossFileChasing: false,
    });
    const time1 = Date.now() - start1;

    const start3 = Date.now();
    await retriever.retrieve('test', LIBRARIAN_ROOT, {
      maxRounds: 3,
      minCoverageGain: 0.5,
      termExpansion: false,
      crossFileChasing: false,
    });
    const time3 = Date.now() - start3;

    // 3 rounds should not take more than 5x the time of 1 round
    // (accounting for some overhead and caching)
    expect(time3).toBeLessThan(time1 * 5 + 1000);
  });
});
