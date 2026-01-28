/**
 * @fileoverview Tests for Self-Index Validator (WU-META-002)
 *
 * Validates that Librarian's self-index provides accurate and relevant
 * results when queried about its own codebase.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  SelfIndexValidator,
  createSelfIndexValidator,
  validateSelfIndex,
  DEFAULT_VALIDATION_QUERIES,
  type QuerySpec,
  type ValidationResult,
  type ValidationReport,
  type SelfIndexValidatorOptions,
} from '../self_index_validator.js';
import type { QueryInterface, SearchResult } from '../../../api/query_interface.js';

// ============================================================================
// TEST FIXTURES
// ============================================================================

/**
 * Standard validation queries covering key Librarian components.
 */
const validationQueries: QuerySpec[] = [
  {
    query: 'What is ConfidenceValue?',
    expectedFiles: ['src/epistemics/confidence.ts', 'src/epistemics/types.ts'],
    expectedConcepts: ['deterministic', 'derived', 'measured', 'bounded', 'absent'],
    category: 'epistemics',
  },
  {
    query: 'How does the evidence ledger work?',
    expectedFiles: ['src/epistemics/evidence_ledger.ts'],
    expectedConcepts: ['append', 'entry', 'provenance'],
    category: 'epistemics',
  },
  {
    query: 'What self-improvement primitives exist?',
    expectedFiles: ['src/agents/self_improvement/'],
    expectedConcepts: ['bootstrap', 'refresh', 'verify', 'analyze'],
    category: 'self-improvement',
  },
  {
    query: 'How are defeaters implemented?',
    expectedFiles: ['src/epistemics/defeaters.ts'],
    expectedConcepts: ['rebutting', 'undercutting', 'undermining'],
    category: 'epistemics',
  },
  {
    query: 'What templates are available?',
    expectedFiles: ['src/api/template_registry.ts'],
    expectedConcepts: ['T1', 'T2', 'RepoMap', 'DeltaMap'],
    category: 'api',
  },
];

/**
 * Create a mock search result.
 */
function createMockSearchResult(
  packId: string,
  summary: string,
  relatedFiles: string[],
  confidence = 0.8
): SearchResult {
  return {
    packId,
    packType: 'function_context',
    summary,
    confidence,
    relatedFiles,
  };
}

/**
 * Create a mock QueryInterface that returns controlled results.
 */
function createMockQueryInterface(
  resultMap: Record<string, SearchResult[]> = {}
): QueryInterface {
  return {
    queryIntent: vi.fn().mockResolvedValue({ packs: [], disclosures: [] }),
    queryFile: vi.fn().mockResolvedValue({ packs: [], disclosures: [] }),
    queryFunction: vi.fn().mockResolvedValue({ packs: [], disclosures: [] }),
    querySimilar: vi.fn().mockResolvedValue([]),
    search: vi.fn().mockImplementation(async (query: string) => {
      // Check if we have a predefined result for this query
      for (const [pattern, results] of Object.entries(resultMap)) {
        if (query.toLowerCase().includes(pattern.toLowerCase())) {
          return results;
        }
      }
      // Default: return empty results
      return [];
    }),
  };
}

/**
 * Create a well-indexed mock query interface that returns good results
 * for the standard validation queries.
 */
function createWellIndexedMockQueryInterface(): QueryInterface {
  const resultMap: Record<string, SearchResult[]> = {
    'confidencevalue': [
      createMockSearchResult(
        'pack-confidence-1',
        'ConfidenceValue is a type that can be deterministic, derived, measured, bounded, or absent',
        ['src/epistemics/confidence.ts', 'src/epistemics/types.ts']
      ),
    ],
    'evidence ledger': [
      createMockSearchResult(
        'pack-ledger-1',
        'Evidence ledger uses append-only entry storage with provenance tracking',
        ['src/epistemics/evidence_ledger.ts']
      ),
    ],
    'self-improvement primitives': [
      createMockSearchResult(
        'pack-self-1',
        'Self-improvement includes bootstrap, refresh, verify, and analyze primitives',
        ['src/agents/self_improvement/self_bootstrap.ts', 'src/agents/self_improvement/self_refresh.ts']
      ),
    ],
    'defeaters': [
      createMockSearchResult(
        'pack-defeaters-1',
        'Defeaters implement rebutting, undercutting, and undermining logic',
        ['src/epistemics/defeaters.ts']
      ),
    ],
    'templates': [
      createMockSearchResult(
        'pack-templates-1',
        'Templates include T1 RepoMap, T2 DeltaMap, and others',
        ['src/api/template_registry.ts']
      ),
    ],
    'storage': [
      createMockSearchResult(
        'pack-storage-1',
        'Storage handles function and module context packs',
        ['src/storage/types.ts', 'src/storage/sqlite_storage.ts']
      ),
    ],
    'calibration': [
      createMockSearchResult(
        'pack-calibration-1',
        'Calibration uses ECE, Brier score, and reliability bins',
        ['src/epistemics/calibration.ts']
      ),
    ],
    'query interface': [
      createMockSearchResult(
        'pack-query-1',
        'Query interface supports intent search and similar matching',
        ['src/api/query_interface.ts']
      ),
    ],
    'indexlibrarian': [
      createMockSearchResult(
        'pack-index-1',
        'IndexLibrarian indexes files and extracts function symbols',
        ['src/agents/index_librarian.ts']
      ),
    ],
    'epistemics module': [
      createMockSearchResult(
        'pack-epistypes-1',
        'Types include Claim, ClaimId, EvidenceEdge, and ExtendedDefeater',
        ['src/epistemics/types.ts']
      ),
    ],
    'self-bootstrap': [
      createMockSearchResult(
        'pack-bootstrap-1',
        'Self-bootstrap creates index with coverage metrics and isSelfReferential detection',
        ['src/agents/self_improvement/self_bootstrap.ts']
      ),
    ],
    'self-refresh': [
      createMockSearchResult(
        'pack-refresh-1',
        'Self-refresh handles incremental change updates',
        ['src/agents/self_improvement/self_refresh.ts']
      ),
    ],
    'architecture analyzed': [
      createMockSearchResult(
        'pack-arch-1',
        'Architecture analysis checks module dependencies, cycles, and coupling',
        ['src/agents/self_improvement/analyze_architecture.ts']
      ),
    ],
    'claims verified': [
      createMockSearchResult(
        'pack-verify-1',
        'Claims are verified using evidence and gettier detection',
        ['src/agents/self_improvement/verify_claim.ts']
      ),
    ],
    'patterns extracted': [
      createMockSearchResult(
        'pack-pattern-1',
        'Patterns are extracted with generalization and applicability analysis',
        ['src/agents/self_improvement/extract_pattern.ts']
      ),
    ],
  };

  return createMockQueryInterface(resultMap);
}

// ============================================================================
// TESTS
// ============================================================================

describe('SelfIndexValidator', () => {
  describe('construction', () => {
    it('creates validator with default options', () => {
      const validator = new SelfIndexValidator();
      expect(validator).toBeInstanceOf(SelfIndexValidator);
    });

    it('creates validator with query interface', () => {
      const mockInterface = createMockQueryInterface();
      const validator = new SelfIndexValidator({ queryInterface: mockInterface });
      expect(validator).toBeInstanceOf(SelfIndexValidator);
    });

    it('creates validator with custom pass threshold', () => {
      const validator = new SelfIndexValidator({ passThreshold: 0.7 });
      expect(validator).toBeInstanceOf(SelfIndexValidator);
    });

    it('creates validator with verbose option', () => {
      const validator = new SelfIndexValidator({ verbose: true });
      expect(validator).toBeInstanceOf(SelfIndexValidator);
    });
  });

  describe('createSelfIndexValidator factory', () => {
    it('creates validator instance', () => {
      const validator = createSelfIndexValidator();
      expect(validator).toBeInstanceOf(SelfIndexValidator);
    });

    it('passes options to constructor', () => {
      const mockInterface = createMockQueryInterface();
      const validator = createSelfIndexValidator({
        queryInterface: mockInterface,
        passThreshold: 0.6,
      });
      expect(validator).toBeInstanceOf(SelfIndexValidator);
    });
  });

  describe('validateQuery', () => {
    it('returns failed result when no query interface', async () => {
      const validator = new SelfIndexValidator();
      const spec: QuerySpec = {
        query: 'test query',
        expectedFiles: ['file.ts'],
        expectedConcepts: ['concept'],
      };

      const result = await validator.validateQuery(spec);

      expect(result.passed).toBe(false);
      expect(result.resultCount).toBe(0);
    });

    it('returns passed result when files and concepts are found', async () => {
      const mockInterface = createMockQueryInterface({
        'confidence': [
          createMockSearchResult(
            'pack-1',
            'ConfidenceValue supports deterministic, derived, measured, bounded, absent types',
            ['src/epistemics/confidence.ts']
          ),
        ],
      });

      const validator = new SelfIndexValidator({ queryInterface: mockInterface });
      const spec: QuerySpec = {
        query: 'What is ConfidenceValue?',
        expectedFiles: ['src/epistemics/confidence.ts'],
        expectedConcepts: ['deterministic', 'derived', 'measured'],
      };

      const result = await validator.validateQuery(spec);

      expect(result.passed).toBe(true);
      expect(result.foundFiles).toContain('src/epistemics/confidence.ts');
      expect(result.foundConcepts).toContain('deterministic');
      expect(result.relevanceScore).toBeGreaterThan(0.5);
    });

    it('returns failed result when expected files are missing', async () => {
      const mockInterface = createMockQueryInterface({
        'findme': [
          createMockSearchResult('result-1', 'irrelevant text here', ['completely/different/path.ts']),
        ],
      });

      // Use higher threshold so partial matches fail
      const validator = new SelfIndexValidator({
        queryInterface: mockInterface,
        passThreshold: 0.6,
      });
      const spec: QuerySpec = {
        query: 'findme',
        expectedFiles: ['wanted/target.ts', 'also/needed.ts'],
        expectedConcepts: ['uniqueTermNotInResults1234'],
      };

      const result = await validator.validateQuery(spec);

      // Missing files should be tracked regardless of overall pass/fail
      expect(result.missingFiles).toContain('wanted/target.ts');
      expect(result.missingFiles).toContain('also/needed.ts');
      // With low relevance, should fail with 0.6 threshold
      expect(result.relevanceScore).toBeLessThan(0.6);
      expect(result.passed).toBe(false);
    });

    it('returns failed result when expected concepts are missing', async () => {
      const mockInterface = createMockQueryInterface({
        'query': [
          createMockSearchResult('pack-1', 'Some content without expected terms', ['other/file.ts']),
        ],
      });

      const validator = new SelfIndexValidator({ queryInterface: mockInterface });
      const spec: QuerySpec = {
        query: 'query',
        expectedFiles: ['also_missing_file.ts'], // Need both to fail with 0.5 threshold
        expectedConcepts: ['expectedConcept'],
      };

      const result = await validator.validateQuery(spec);

      expect(result.passed).toBe(false);
      expect(result.missingConcepts).toContain('expectedConcept');
    });

    it('tracks query time', async () => {
      const mockInterface = createMockQueryInterface();
      const validator = new SelfIndexValidator({ queryInterface: mockInterface });
      const spec: QuerySpec = {
        query: 'test',
        expectedFiles: [],
        expectedConcepts: [],
      };

      const result = await validator.validateQuery(spec);

      expect(result.queryTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('includes category in result', async () => {
      const mockInterface = createMockQueryInterface();
      const validator = new SelfIndexValidator({ queryInterface: mockInterface });
      const spec: QuerySpec = {
        query: 'test',
        expectedFiles: [],
        expectedConcepts: [],
        category: 'test-category',
      };

      const result = await validator.validateQuery(spec);

      expect(result.category).toBe('test-category');
    });

    it('handles directory patterns in expected files', async () => {
      const mockInterface = createMockQueryInterface({
        'self-improvement': [
          createMockSearchResult(
            'pack-1',
            'Self-improvement primitives',
            ['src/agents/self_improvement/self_bootstrap.ts']
          ),
        ],
      });

      const validator = new SelfIndexValidator({ queryInterface: mockInterface });
      const spec: QuerySpec = {
        query: 'self-improvement',
        expectedFiles: ['src/agents/self_improvement/'],
        expectedConcepts: [],
      };

      const result = await validator.validateQuery(spec);

      expect(result.foundFiles).toContain('src/agents/self_improvement/');
      expect(result.missingFiles).toHaveLength(0);
    });

    it('respects custom pass threshold', async () => {
      const mockInterface = createMockQueryInterface({
        'partial': [
          createMockSearchResult('pack-1', 'Has conceptA', ['other.ts']),
        ],
      });

      // With low threshold, should pass
      const validatorLow = new SelfIndexValidator({
        queryInterface: mockInterface,
        passThreshold: 0.2,
      });
      const spec: QuerySpec = {
        query: 'partial',
        expectedFiles: ['expected.ts'],
        expectedConcepts: ['conceptA', 'conceptB'],
      };

      const resultLow = await validatorLow.validateQuery(spec);
      expect(resultLow.passed).toBe(true);
      expect(resultLow.relevanceScore).toBeGreaterThanOrEqual(0.2);

      // With high threshold, should fail
      const validatorHigh = new SelfIndexValidator({
        queryInterface: mockInterface,
        passThreshold: 0.9,
      });

      const resultHigh = await validatorHigh.validateQuery(spec);
      expect(resultHigh.passed).toBe(false);
    });
  });

  describe('runFullValidation', () => {
    it('runs all default validation queries', async () => {
      const mockInterface = createWellIndexedMockQueryInterface();
      const validator = new SelfIndexValidator({ queryInterface: mockInterface });

      const report = await validator.runFullValidation();

      expect(report.totalQueries).toBe(DEFAULT_VALIDATION_QUERIES.length);
      expect(report.results).toHaveLength(DEFAULT_VALIDATION_QUERIES.length);
    });

    it('includes custom queries in validation', async () => {
      const mockInterface = createWellIndexedMockQueryInterface();
      const validator = new SelfIndexValidator({ queryInterface: mockInterface });

      const customQueries: QuerySpec[] = [
        {
          query: 'custom query',
          expectedFiles: [],
          expectedConcepts: [],
          category: 'custom',
        },
      ];

      const report = await validator.runFullValidation(customQueries);

      expect(report.totalQueries).toBe(DEFAULT_VALIDATION_QUERIES.length + 1);
    });

    it('computes correct pass count', async () => {
      const mockInterface = createWellIndexedMockQueryInterface();
      const validator = new SelfIndexValidator({ queryInterface: mockInterface });

      const report = await validator.runFullValidation();

      // With well-indexed mock, most should pass
      expect(report.passedQueries).toBeGreaterThan(0);
      expect(report.passedQueries).toBeLessThanOrEqual(report.totalQueries);
    });

    it('computes average relevance score', async () => {
      const mockInterface = createWellIndexedMockQueryInterface();
      const validator = new SelfIndexValidator({ queryInterface: mockInterface });

      const report = await validator.runFullValidation();

      expect(report.avgRelevanceScore).toBeGreaterThanOrEqual(0);
      expect(report.avgRelevanceScore).toBeLessThanOrEqual(1);
    });

    it('computes coverage percentage', async () => {
      const mockInterface = createWellIndexedMockQueryInterface();
      const validator = new SelfIndexValidator({ queryInterface: mockInterface });

      const report = await validator.runFullValidation();

      expect(report.coveragePercent).toBeGreaterThanOrEqual(0);
      expect(report.coveragePercent).toBeLessThanOrEqual(100);
    });

    it('generates recommendations', async () => {
      const mockInterface = createMockQueryInterface(); // Returns empty results
      const validator = new SelfIndexValidator({ queryInterface: mockInterface });

      const report = await validator.runFullValidation();

      expect(report.recommendations).toBeInstanceOf(Array);
      expect(report.recommendations.length).toBeGreaterThan(0);
    });

    it('tracks total validation time', async () => {
      const mockInterface = createMockQueryInterface();
      const validator = new SelfIndexValidator({ queryInterface: mockInterface });

      const report = await validator.runFullValidation();

      expect(report.totalTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('includes category breakdown', async () => {
      const mockInterface = createWellIndexedMockQueryInterface();
      const validator = new SelfIndexValidator({ queryInterface: mockInterface });

      const report = await validator.runFullValidation();

      expect(report.categoryBreakdown).toBeDefined();
      if (report.categoryBreakdown) {
        expect(report.categoryBreakdown['epistemics']).toBeDefined();
        expect(report.categoryBreakdown['epistemics'].total).toBeGreaterThan(0);
      }
    });
  });

  describe('checkCoverage', () => {
    it('returns 1.0 for empty path list', async () => {
      const validator = new SelfIndexValidator();
      const coverage = await validator.checkCoverage([]);
      expect(coverage).toBe(1.0);
    });

    it('returns coverage ratio for found paths', async () => {
      const mockInterface = createMockQueryInterface({
        'src/epistemics/confidence.ts': [
          createMockSearchResult('pack-1', 'Confidence module', ['src/epistemics/confidence.ts']),
        ],
      });

      const validator = new SelfIndexValidator({ queryInterface: mockInterface });
      const coverage = await validator.checkCoverage([
        'src/epistemics/confidence.ts',
        'src/epistemics/other.ts', // Not found
      ]);

      expect(coverage).toBe(0.5);
    });
  });

  describe('validateSelfIndex convenience function', () => {
    it('runs validation and returns report', async () => {
      const mockInterface = createWellIndexedMockQueryInterface();
      const report = await validateSelfIndex({ queryInterface: mockInterface });

      expect(report).toBeDefined();
      expect(report.totalQueries).toBeGreaterThan(0);
      expect(report.results).toBeInstanceOf(Array);
    });

    it('includes custom queries', async () => {
      const mockInterface = createMockQueryInterface();
      const customQueries: QuerySpec[] = [
        { query: 'custom', expectedFiles: [], expectedConcepts: [] },
      ];

      const report = await validateSelfIndex(
        { queryInterface: mockInterface },
        customQueries
      );

      expect(report.totalQueries).toBe(DEFAULT_VALIDATION_QUERIES.length + 1);
    });
  });

  describe('DEFAULT_VALIDATION_QUERIES', () => {
    it('contains queries for all key Librarian components', () => {
      const categories = DEFAULT_VALIDATION_QUERIES.map((q) => q.category);
      const uniqueCategories = new Set(categories);

      // Should cover multiple areas
      expect(uniqueCategories.size).toBeGreaterThanOrEqual(3);
    });

    it('all queries have expected files', () => {
      for (const query of DEFAULT_VALIDATION_QUERIES) {
        expect(query.expectedFiles.length).toBeGreaterThan(0);
      }
    });

    it('all queries have expected concepts', () => {
      for (const query of DEFAULT_VALIDATION_QUERIES) {
        expect(query.expectedConcepts.length).toBeGreaterThan(0);
      }
    });

    it('includes ConfidenceValue query', () => {
      const confidenceQuery = DEFAULT_VALIDATION_QUERIES.find(
        (q) => q.query.includes('ConfidenceValue')
      );
      expect(confidenceQuery).toBeDefined();
      expect(confidenceQuery?.expectedConcepts).toContain('deterministic');
    });

    it('includes evidence ledger query', () => {
      const ledgerQuery = DEFAULT_VALIDATION_QUERIES.find(
        (q) => q.query.includes('evidence ledger')
      );
      expect(ledgerQuery).toBeDefined();
      expect(ledgerQuery?.expectedConcepts).toContain('append');
    });

    it('includes defeaters query', () => {
      const defeatersQuery = DEFAULT_VALIDATION_QUERIES.find(
        (q) => q.query.includes('defeaters')
      );
      expect(defeatersQuery).toBeDefined();
      expect(defeatersQuery?.expectedConcepts).toContain('rebutting');
      expect(defeatersQuery?.expectedConcepts).toContain('undercutting');
      expect(defeatersQuery?.expectedConcepts).toContain('undermining');
    });

    it('includes templates query', () => {
      const templatesQuery = DEFAULT_VALIDATION_QUERIES.find(
        (q) => q.query.includes('templates')
      );
      expect(templatesQuery).toBeDefined();
      expect(templatesQuery?.expectedConcepts).toContain('T1');
      expect(templatesQuery?.expectedConcepts).toContain('T2');
    });

    it('includes self-improvement query', () => {
      const selfImprovementQuery = DEFAULT_VALIDATION_QUERIES.find(
        (q) => q.query.includes('self-improvement')
      );
      expect(selfImprovementQuery).toBeDefined();
      expect(selfImprovementQuery?.expectedConcepts).toContain('bootstrap');
    });
  });

  describe('validation result structure', () => {
    it('ValidationResult has correct shape', () => {
      const result: ValidationResult = {
        query: 'test',
        passed: true,
        relevanceScore: 0.8,
        foundFiles: ['file.ts'],
        missingFiles: [],
        foundConcepts: ['concept'],
        missingConcepts: [],
        resultCount: 1,
        queryTimeMs: 100,
        category: 'test',
      };

      expect(result.query).toBe('test');
      expect(result.passed).toBe(true);
      expect(result.relevanceScore).toBe(0.8);
      expect(result.foundFiles).toContain('file.ts');
      expect(result.foundConcepts).toContain('concept');
      expect(result.resultCount).toBe(1);
      expect(result.queryTimeMs).toBe(100);
      expect(result.category).toBe('test');
    });

    it('ValidationReport has correct shape', () => {
      const report: ValidationReport = {
        totalQueries: 10,
        passedQueries: 8,
        avgRelevanceScore: 0.75,
        coveragePercent: 80,
        results: [],
        recommendations: ['recommendation'],
        totalTimeMs: 500,
        categoryBreakdown: {
          'epistemics': { total: 5, passed: 4, avgRelevance: 0.8 },
        },
      };

      expect(report.totalQueries).toBe(10);
      expect(report.passedQueries).toBe(8);
      expect(report.avgRelevanceScore).toBe(0.75);
      expect(report.coveragePercent).toBe(80);
      expect(report.recommendations).toContain('recommendation');
      expect(report.totalTimeMs).toBe(500);
      expect(report.categoryBreakdown?.['epistemics'].total).toBe(5);
    });
  });

  describe('edge cases', () => {
    it('handles query interface that throws errors', async () => {
      const mockInterface = createMockQueryInterface();
      mockInterface.search = vi.fn().mockRejectedValue(new Error('Query failed'));

      const validator = new SelfIndexValidator({ queryInterface: mockInterface });
      const spec: QuerySpec = {
        query: 'test',
        expectedFiles: [],
        expectedConcepts: [],
      };

      const result = await validator.validateQuery(spec);

      expect(result.passed).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('Query failed');
    });

    it('handles empty search results gracefully', async () => {
      const mockInterface = createMockQueryInterface();
      const validator = new SelfIndexValidator({ queryInterface: mockInterface });

      const spec: QuerySpec = {
        query: 'nonexistent',
        expectedFiles: ['expected.ts'],
        expectedConcepts: ['expected'],
      };

      const result = await validator.validateQuery(spec);

      expect(result.passed).toBe(false);
      expect(result.resultCount).toBe(0);
      expect(result.error).toBe('No results returned');
    });

    it('handles case-insensitive concept matching', async () => {
      const mockInterface = createMockQueryInterface({
        'test': [
          createMockSearchResult('pack-1', 'Contains DETERMINISTIC and DERIVED', []),
        ],
      });

      const validator = new SelfIndexValidator({ queryInterface: mockInterface });
      const spec: QuerySpec = {
        query: 'test',
        expectedFiles: [],
        expectedConcepts: ['deterministic', 'derived'],
      };

      const result = await validator.validateQuery(spec);

      expect(result.foundConcepts).toContain('deterministic');
      expect(result.foundConcepts).toContain('derived');
    });

    it('handles minResults constraint', async () => {
      const mockInterface = createMockQueryInterface({
        'test': [
          createMockSearchResult('pack-1', 'Content', []),
        ],
      });

      const validator = new SelfIndexValidator({ queryInterface: mockInterface });
      const spec: QuerySpec = {
        query: 'test',
        expectedFiles: [],
        expectedConcepts: [],
        minResults: 5,
      };

      const result = await validator.validateQuery(spec);

      expect(result.error).toContain('Expected at least 5 results');
    });
  });

  describe('dependency injection', () => {
    it('setQueryInterface updates the interface', async () => {
      const validator = new SelfIndexValidator();

      // Initially no interface
      let result = await validator.validateQuery({
        query: 'test',
        expectedFiles: [],
        expectedConcepts: [],
      });
      expect(result.resultCount).toBe(0);

      // Set interface
      const mockInterface = createMockQueryInterface({
        'test': [createMockSearchResult('pack-1', 'content', [])],
      });
      validator.setQueryInterface(mockInterface);

      result = await validator.validateQuery({
        query: 'test',
        expectedFiles: [],
        expectedConcepts: [],
      });
      expect(result.resultCount).toBe(1);
    });
  });
});
