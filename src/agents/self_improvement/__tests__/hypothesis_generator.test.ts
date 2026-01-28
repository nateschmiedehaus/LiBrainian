/**
 * @fileoverview Tests for HypothesisGenerator (Self-Improvement Module)
 *
 * WU-SELF-001: Hypothesis Generation for Retrieval Failures
 *
 * Tests cover:
 * - Hypothesis generation from retrieval failures
 * - Ranking hypotheses by priority
 * - Active hypothesis tracking
 * - Marking hypotheses as tested
 * - Probe generation for testability
 * - All hypothesis types
 * - Configuration options
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createHypothesisGenerator,
  type HypothesisGenerator,
  type Hypothesis,
  type HypothesisGeneratorConfig,
  type RetrievalFailure,
  type HypothesisTestResult,
} from '../hypothesis_generator.js';

describe('HypothesisGenerator', () => {
  let generator: HypothesisGenerator;
  const defaultConfig: HypothesisGeneratorConfig = {
    maxHypothesesPerFailure: 5,
    minPriority: 0.1,
  };

  beforeEach(() => {
    generator = createHypothesisGenerator(defaultConfig);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ============================================================================
  // CONSTRUCTOR AND FACTORY
  // ============================================================================

  describe('createHypothesisGenerator factory', () => {
    it('creates generator with default configuration', () => {
      const gen = createHypothesisGenerator();
      expect(gen).toBeDefined();
      expect(gen.getActiveHypotheses()).toEqual([]);
    });

    it('creates generator with custom configuration', () => {
      const customConfig: HypothesisGeneratorConfig = {
        maxHypothesesPerFailure: 3,
        minPriority: 0.2,
      };
      const gen = createHypothesisGenerator(customConfig);
      expect(gen).toBeDefined();
    });
  });

  // ============================================================================
  // HYPOTHESIS GENERATION FROM FAILURE
  // ============================================================================

  describe('generateFromFailure', () => {
    it('generates hypotheses from a retrieval failure', async () => {
      const failure: RetrievalFailure = {
        query: 'How does the authentication module work?',
        expectedResult: 'AuthService class handles JWT tokens',
        actualResult: 'No relevant results found',
        retrievedContexts: [],
      };

      const hypotheses = await generator.generateFromFailure(failure);

      expect(hypotheses.length).toBeGreaterThan(0);
      expect(hypotheses.length).toBeLessThanOrEqual(defaultConfig.maxHypothesesPerFailure!);
    });

    it('generates hypotheses with required fields', async () => {
      const failure: RetrievalFailure = {
        query: 'What is the database connection string?',
        actualResult: 'Connection string is "localhost:5432"',
        retrievedContexts: ['Config file content...'],
      };

      const hypotheses = await generator.generateFromFailure(failure);

      hypotheses.forEach((h) => {
        expect(h.id).toBeDefined();
        expect(h.type).toBeDefined();
        expect(h.description).toBeDefined();
        expect(typeof h.testable).toBe('boolean');
        expect(h.probe).toBeDefined();
        expect(typeof h.priority).toBe('number');
        expect(h.createdAt).toBeInstanceOf(Date);
      });
    });

    it('generates testable hypotheses with valid probes', async () => {
      const failure: RetrievalFailure = {
        query: 'Find all API endpoints',
        actualResult: 'Incomplete list returned',
        retrievedContexts: ['routes.ts content...'],
      };

      const hypotheses = await generator.generateFromFailure(failure);

      const testableHypotheses = hypotheses.filter((h) => h.testable);
      expect(testableHypotheses.length).toBeGreaterThan(0);

      testableHypotheses.forEach((h) => {
        expect(h.probe.type).toMatch(/^(query|assertion|comparison)$/);
        expect(h.probe.parameters).toBeDefined();
      });
    });

    it('generates hypothesis for missing_context type', async () => {
      const failure: RetrievalFailure = {
        query: 'What is the user authentication flow?',
        expectedResult: 'OAuth2 flow with refresh tokens',
        actualResult: 'No results found',
        retrievedContexts: [],
      };

      const hypotheses = await generator.generateFromFailure(failure);

      const missingContextHypothesis = hypotheses.find((h) => h.type === 'missing_context');
      expect(missingContextHypothesis).toBeDefined();
      expect(missingContextHypothesis?.description).toContain('context');
    });

    it('generates hypothesis for wrong_ranking type', async () => {
      const failure: RetrievalFailure = {
        query: 'Main entry point of the application',
        expectedResult: 'index.ts exports main()',
        actualResult: 'Found test files instead',
        retrievedContexts: ['test1.ts', 'test2.ts', 'spec.ts'],
      };

      const hypotheses = await generator.generateFromFailure(failure);

      const wrongRankingHypothesis = hypotheses.find((h) => h.type === 'wrong_ranking');
      expect(wrongRankingHypothesis).toBeDefined();
    });

    it('generates hypothesis for stale_data type', async () => {
      const failure: RetrievalFailure = {
        query: 'Current API version',
        expectedResult: 'Version 2.0 with new endpoints',
        actualResult: 'Version 1.0',
        retrievedContexts: ['Old documentation...'],
      };

      const hypotheses = await generator.generateFromFailure(failure);

      const staleDataHypothesis = hypotheses.find((h) => h.type === 'stale_data');
      expect(staleDataHypothesis).toBeDefined();
    });

    it('generates hypothesis for embedding_mismatch type', async () => {
      const failure: RetrievalFailure = {
        query: 'function for calculating tax',
        expectedResult: 'calculateTax function in finance.ts',
        actualResult: 'Found unrelated math utilities',
        retrievedContexts: ['mathUtils.ts with add, subtract...'],
      };

      const hypotheses = await generator.generateFromFailure(failure);

      const embeddingMismatchHypothesis = hypotheses.find(
        (h) => h.type === 'embedding_mismatch'
      );
      expect(embeddingMismatchHypothesis).toBeDefined();
    });

    it('generates hypothesis for query_ambiguity type', async () => {
      const failure: RetrievalFailure = {
        query: 'get user',
        actualResult: 'Multiple unrelated results',
        retrievedContexts: ['getUser', 'getUserById', 'fetchUserProfile', 'userGetter'],
      };

      const hypotheses = await generator.generateFromFailure(failure);

      const ambiguityHypothesis = hypotheses.find((h) => h.type === 'query_ambiguity');
      expect(ambiguityHypothesis).toBeDefined();
    });

    it('assigns priorities based on failure characteristics', async () => {
      const failure: RetrievalFailure = {
        query: 'Critical security configuration',
        expectedResult: 'Security settings in config',
        actualResult: 'Empty result',
        retrievedContexts: [],
      };

      const hypotheses = await generator.generateFromFailure(failure);

      hypotheses.forEach((h) => {
        expect(h.priority).toBeGreaterThanOrEqual(0);
        expect(h.priority).toBeLessThanOrEqual(1);
      });
    });

    it('handles failure with no expected result', async () => {
      const failure: RetrievalFailure = {
        query: 'List all modules',
        actualResult: 'Partial list returned',
        retrievedContexts: ['module1.ts', 'module2.ts'],
      };

      const hypotheses = await generator.generateFromFailure(failure);

      expect(hypotheses.length).toBeGreaterThan(0);
    });

    it('handles failure with empty query', async () => {
      const failure: RetrievalFailure = {
        query: '',
        actualResult: 'Error: empty query',
        retrievedContexts: [],
      };

      const hypotheses = await generator.generateFromFailure(failure);

      // Should still generate hypotheses about the failure
      expect(hypotheses.length).toBeGreaterThan(0);
      const ambiguityHypothesis = hypotheses.find((h) => h.type === 'query_ambiguity');
      expect(ambiguityHypothesis).toBeDefined();
    });
  });

  // ============================================================================
  // HYPOTHESIS RANKING
  // ============================================================================

  describe('rankHypotheses', () => {
    it('ranks hypotheses by priority descending', () => {
      const hypotheses: Hypothesis[] = [
        createMockHypothesis({ id: 'h1', priority: 0.5 }),
        createMockHypothesis({ id: 'h2', priority: 0.9 }),
        createMockHypothesis({ id: 'h3', priority: 0.3 }),
      ];

      const ranked = generator.rankHypotheses(hypotheses);

      expect(ranked[0].id).toBe('h2');
      expect(ranked[1].id).toBe('h1');
      expect(ranked[2].id).toBe('h3');
    });

    it('handles hypotheses with equal priority', () => {
      const hypotheses: Hypothesis[] = [
        createMockHypothesis({ id: 'h1', priority: 0.5 }),
        createMockHypothesis({ id: 'h2', priority: 0.5 }),
        createMockHypothesis({ id: 'h3', priority: 0.5 }),
      ];

      const ranked = generator.rankHypotheses(hypotheses);

      expect(ranked.length).toBe(3);
      // Order should be stable
      expect(ranked.map((h) => h.id).sort()).toEqual(['h1', 'h2', 'h3']);
    });

    it('returns empty array for empty input', () => {
      const ranked = generator.rankHypotheses([]);
      expect(ranked).toEqual([]);
    });

    it('preserves all hypothesis properties after ranking', () => {
      const original: Hypothesis[] = [
        createMockHypothesis({
          id: 'h1',
          priority: 0.5,
          type: 'missing_context',
          description: 'Test description',
        }),
      ];

      const ranked = generator.rankHypotheses(original);

      expect(ranked[0]).toEqual(original[0]);
    });
  });

  // ============================================================================
  // ACTIVE HYPOTHESIS TRACKING
  // ============================================================================

  describe('getActiveHypotheses', () => {
    it('returns empty array initially', () => {
      const active = generator.getActiveHypotheses();
      expect(active).toEqual([]);
    });

    it('returns generated hypotheses as active', async () => {
      const failure: RetrievalFailure = {
        query: 'test query',
        actualResult: 'test result',
        retrievedContexts: [],
      };

      await generator.generateFromFailure(failure);
      const active = generator.getActiveHypotheses();

      expect(active.length).toBeGreaterThan(0);
    });

    it('excludes tested hypotheses from active', async () => {
      const failure: RetrievalFailure = {
        query: 'test query',
        actualResult: 'test result',
        retrievedContexts: [],
      };

      const generated = await generator.generateFromFailure(failure);
      const initialActive = generator.getActiveHypotheses();
      const initialCount = initialActive.length;

      // Mark first hypothesis as tested
      generator.markTested(generated[0].id, { confirmed: true, evidence: 'Test passed' });

      const afterActive = generator.getActiveHypotheses();
      expect(afterActive.length).toBe(initialCount - 1);
    });

    it('returns hypotheses sorted by priority', async () => {
      const failure: RetrievalFailure = {
        query: 'test query',
        actualResult: 'test result',
        retrievedContexts: ['context1', 'context2'],
      };

      await generator.generateFromFailure(failure);
      const active = generator.getActiveHypotheses();

      for (let i = 1; i < active.length; i++) {
        expect(active[i - 1].priority).toBeGreaterThanOrEqual(active[i].priority);
      }
    });
  });

  // ============================================================================
  // MARKING HYPOTHESES AS TESTED
  // ============================================================================

  describe('markTested', () => {
    it('marks hypothesis as confirmed', async () => {
      const failure: RetrievalFailure = {
        query: 'test query',
        actualResult: 'test result',
        retrievedContexts: [],
      };

      const generated = await generator.generateFromFailure(failure);
      const hypothesisId = generated[0].id;

      generator.markTested(hypothesisId, {
        confirmed: true,
        evidence: 'The index was indeed stale',
      });

      const active = generator.getActiveHypotheses();
      expect(active.find((h) => h.id === hypothesisId)).toBeUndefined();
    });

    it('marks hypothesis as refuted', async () => {
      const failure: RetrievalFailure = {
        query: 'test query',
        actualResult: 'test result',
        retrievedContexts: [],
      };

      const generated = await generator.generateFromFailure(failure);
      const hypothesisId = generated[0].id;

      generator.markTested(hypothesisId, {
        confirmed: false,
        evidence: 'Index was up to date',
      });

      const active = generator.getActiveHypotheses();
      expect(active.find((h) => h.id === hypothesisId)).toBeUndefined();
    });

    it('handles marking non-existent hypothesis gracefully', () => {
      // Should not throw
      expect(() => {
        generator.markTested('non-existent-id', {
          confirmed: true,
          evidence: 'Test evidence',
        });
      }).not.toThrow();
    });

    it('stores test result for later retrieval', async () => {
      const failure: RetrievalFailure = {
        query: 'test query',
        actualResult: 'test result',
        retrievedContexts: [],
      };

      const generated = await generator.generateFromFailure(failure);
      const hypothesisId = generated[0].id;
      const testResult: HypothesisTestResult = {
        confirmed: true,
        evidence: 'Found missing index entry',
      };

      generator.markTested(hypothesisId, testResult);

      const history = generator.getTestHistory();
      const entry = history.find((e) => e.hypothesisId === hypothesisId);
      expect(entry).toBeDefined();
      expect(entry?.result.confirmed).toBe(true);
      expect(entry?.result.evidence).toBe('Found missing index entry');
    });
  });

  // ============================================================================
  // PROBE GENERATION
  // ============================================================================

  describe('probe generation', () => {
    it('generates query probes for missing_context hypotheses', async () => {
      const failure: RetrievalFailure = {
        query: 'Authentication flow',
        expectedResult: 'OAuth implementation',
        actualResult: 'No results',
        retrievedContexts: [],
      };

      const hypotheses = await generator.generateFromFailure(failure);
      const missingContext = hypotheses.find((h) => h.type === 'missing_context');

      expect(missingContext?.probe.type).toBe('query');
      expect(missingContext?.probe.parameters).toHaveProperty('searchQuery');
    });

    it('generates comparison probes for wrong_ranking hypotheses', async () => {
      const failure: RetrievalFailure = {
        query: 'Main application entry',
        expectedResult: 'index.ts',
        actualResult: 'test files',
        retrievedContexts: ['test1.ts', 'test2.ts'],
      };

      const hypotheses = await generator.generateFromFailure(failure);
      const wrongRanking = hypotheses.find((h) => h.type === 'wrong_ranking');

      expect(wrongRanking?.probe.type).toBe('comparison');
      expect(wrongRanking?.probe.parameters).toHaveProperty('expectedRank');
    });

    it('generates assertion probes for stale_data hypotheses', async () => {
      const failure: RetrievalFailure = {
        query: 'Current version',
        expectedResult: 'v2.0',
        actualResult: 'v1.0',
        retrievedContexts: ['Old docs'],
      };

      const hypotheses = await generator.generateFromFailure(failure);
      const staleData = hypotheses.find((h) => h.type === 'stale_data');

      expect(staleData?.probe.type).toBe('assertion');
      expect(staleData?.probe.parameters).toHaveProperty('freshnessThreshold');
    });

    it('generates query probes for embedding_mismatch hypotheses', async () => {
      const failure: RetrievalFailure = {
        query: 'tax calculation',
        actualResult: 'math utilities',
        retrievedContexts: ['mathUtils.ts'],
      };

      const hypotheses = await generator.generateFromFailure(failure);
      const embeddingMismatch = hypotheses.find((h) => h.type === 'embedding_mismatch');

      expect(embeddingMismatch?.probe.type).toBe('query');
      expect(embeddingMismatch?.probe.parameters).toHaveProperty('synonymQueries');
    });

    it('generates assertion probes for query_ambiguity hypotheses', async () => {
      const failure: RetrievalFailure = {
        query: 'get',
        actualResult: 'too many results',
        retrievedContexts: ['get1', 'get2', 'get3'],
      };

      const hypotheses = await generator.generateFromFailure(failure);
      const ambiguity = hypotheses.find((h) => h.type === 'query_ambiguity');

      expect(ambiguity?.probe.type).toBe('assertion');
      expect(ambiguity?.probe.parameters).toHaveProperty('minQueryLength');
    });
  });

  // ============================================================================
  // HYPOTHESIS TYPE COVERAGE
  // ============================================================================

  describe('hypothesis type coverage', () => {
    it('covers all defined hypothesis types', async () => {
      const failures: RetrievalFailure[] = [
        {
          query: 'missing context test',
          expectedResult: 'expected',
          actualResult: 'nothing',
          retrievedContexts: [],
        },
        {
          query: 'ranking test',
          expectedResult: 'specific file',
          actualResult: 'wrong files',
          retrievedContexts: ['wrong1', 'wrong2', 'wrong3'],
        },
        {
          query: 'stale data test',
          expectedResult: 'new version',
          actualResult: 'old version',
          retrievedContexts: ['outdated doc'],
        },
        {
          query: 'embedding test',
          expectedResult: 'semantic match',
          actualResult: 'unrelated',
          retrievedContexts: ['unrelated content'],
        },
        {
          query: 'x',
          actualResult: 'ambiguous',
          retrievedContexts: ['a', 'b', 'c', 'd'],
        },
      ];

      const allTypes = new Set<string>();

      for (const failure of failures) {
        const hypotheses = await generator.generateFromFailure(failure);
        hypotheses.forEach((h) => allTypes.add(h.type));
      }

      expect(allTypes.has('missing_context')).toBe(true);
      expect(allTypes.has('wrong_ranking')).toBe(true);
      expect(allTypes.has('stale_data')).toBe(true);
      expect(allTypes.has('embedding_mismatch')).toBe(true);
      expect(allTypes.has('query_ambiguity')).toBe(true);
    });
  });

  // ============================================================================
  // CONFIGURATION OPTIONS
  // ============================================================================

  describe('configuration options', () => {
    it('respects maxHypothesesPerFailure limit', async () => {
      const gen = createHypothesisGenerator({ maxHypothesesPerFailure: 2 });

      const failure: RetrievalFailure = {
        query: 'test query',
        actualResult: 'test result',
        retrievedContexts: ['ctx1', 'ctx2', 'ctx3'],
      };

      const hypotheses = await gen.generateFromFailure(failure);

      expect(hypotheses.length).toBeLessThanOrEqual(2);
    });

    it('filters out hypotheses below minPriority', async () => {
      const gen = createHypothesisGenerator({ minPriority: 0.8 });

      const failure: RetrievalFailure = {
        query: 'test query',
        actualResult: 'test result',
        retrievedContexts: [],
      };

      const hypotheses = await gen.generateFromFailure(failure);

      hypotheses.forEach((h) => {
        expect(h.priority).toBeGreaterThanOrEqual(0.8);
      });
    });
  });

  // ============================================================================
  // EDGE CASES
  // ============================================================================

  describe('edge cases', () => {
    it('handles very long query strings', async () => {
      const failure: RetrievalFailure = {
        query: 'a'.repeat(10000),
        actualResult: 'test',
        retrievedContexts: [],
      };

      const hypotheses = await generator.generateFromFailure(failure);
      expect(hypotheses.length).toBeGreaterThan(0);
    });

    it('handles special characters in query', async () => {
      const failure: RetrievalFailure = {
        query: 'function<T>(x: T) => T & { [key: string]: unknown }',
        actualResult: 'test',
        retrievedContexts: [],
      };

      const hypotheses = await generator.generateFromFailure(failure);
      expect(hypotheses.length).toBeGreaterThan(0);
    });

    it('handles unicode characters in query', async () => {
      const failure: RetrievalFailure = {
        query: 'function processData(data) // Verarbeitung',
        actualResult: 'test',
        retrievedContexts: [],
      };

      const hypotheses = await generator.generateFromFailure(failure);
      expect(hypotheses.length).toBeGreaterThan(0);
    });

    it('handles large number of retrieved contexts', async () => {
      const failure: RetrievalFailure = {
        query: 'test',
        actualResult: 'test',
        retrievedContexts: Array(1000).fill('context'),
      };

      const hypotheses = await generator.generateFromFailure(failure);
      expect(hypotheses.length).toBeGreaterThan(0);
    });
  });

  // ============================================================================
  // INTERFACE TYPE CHECKS
  // ============================================================================

  describe('interface type checks', () => {
    it('has correct Hypothesis shape', async () => {
      const failure: RetrievalFailure = {
        query: 'test',
        actualResult: 'test',
        retrievedContexts: [],
      };

      const hypotheses = await generator.generateFromFailure(failure);
      const h = hypotheses[0];

      // Required fields
      expect(typeof h.id).toBe('string');
      expect(h.type).toMatch(
        /^(missing_context|wrong_ranking|stale_data|embedding_mismatch|query_ambiguity)$/
      );
      expect(typeof h.description).toBe('string');
      expect(typeof h.testable).toBe('boolean');
      expect(typeof h.priority).toBe('number');
      expect(h.createdAt).toBeInstanceOf(Date);

      // Probe structure
      expect(h.probe.type).toMatch(/^(query|assertion|comparison)$/);
      expect(typeof h.probe.parameters).toBe('object');
    });

    it('has correct RetrievalFailure shape', () => {
      const failure: RetrievalFailure = {
        query: 'test query',
        expectedResult: 'expected',
        actualResult: 'actual',
        retrievedContexts: ['ctx1', 'ctx2'],
      };

      expect(typeof failure.query).toBe('string');
      expect(typeof failure.expectedResult).toBe('string');
      expect(typeof failure.actualResult).toBe('string');
      expect(Array.isArray(failure.retrievedContexts)).toBe(true);
    });

    it('has correct HypothesisTestResult shape', () => {
      const result: HypothesisTestResult = {
        confirmed: true,
        evidence: 'Test evidence',
      };

      expect(typeof result.confirmed).toBe('boolean');
      expect(typeof result.evidence).toBe('string');
    });
  });
});

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function createMockHypothesis(overrides: Partial<Hypothesis> = {}): Hypothesis {
  return {
    id: `hyp-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    type: 'missing_context',
    description: 'Mock hypothesis description',
    testable: true,
    probe: {
      type: 'query',
      parameters: { searchQuery: 'test' },
    },
    priority: 0.5,
    createdAt: new Date(),
    ...overrides,
  };
}
