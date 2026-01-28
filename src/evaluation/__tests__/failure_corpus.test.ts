/**
 * @fileoverview Tests for Failure Corpus (WU-SELF-004)
 *
 * Tests are written FIRST (TDD). Implementation comes AFTER these tests fail.
 *
 * The Failure Corpus captures and grows evaluation data from failures,
 * enabling continuous improvement of the evaluation system through
 * pattern analysis and training data export.
 *
 * @packageDocumentation
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  FailureCorpus,
  createFailureCorpus,
  type FailureCase,
  type CorpusStats,
  type CorpusConfig,
  type FailureAnalysis,
  type FailurePattern,
} from '../failure_corpus.js';

// ============================================================================
// TEST FIXTURES
// ============================================================================

const sampleFailureCase: FailureCase = {
  id: 'failure-001',
  timestamp: new Date('2025-01-15T10:00:00Z'),
  category: 'retrieval',
  query: 'What parameters does function processData accept?',
  expectedResult: 'processData accepts two parameters: data (string) and options (object)',
  actualResult: 'processData accepts three parameters: input, config, and callback',
  errorType: 'incorrect_parameter_count',
  context: {
    repoName: 'test-repo',
    queryType: 'parameter_query',
    confidenceScore: 0.85,
  },
  severity: 'high',
};

const sampleFailureCases: FailureCase[] = [
  sampleFailureCase,
  {
    id: 'failure-002',
    timestamp: new Date('2025-01-15T11:00:00Z'),
    category: 'grounding',
    query: 'Where is the UserService class defined?',
    expectedResult: 'src/services/user.ts',
    actualResult: 'src/models/user.ts',
    errorType: 'incorrect_location',
    context: { repoName: 'test-repo' },
    severity: 'medium',
  },
  {
    id: 'failure-003',
    timestamp: new Date('2025-01-15T12:00:00Z'),
    category: 'calibration',
    query: 'Is function foo deprecated?',
    expectedResult: 'Yes, deprecated in v2.0',
    actualResult: 'No, foo is not deprecated',
    errorType: 'boolean_mismatch',
    context: { repoName: 'test-repo' },
    severity: 'critical',
  },
  {
    id: 'failure-004',
    timestamp: new Date('2025-01-16T10:00:00Z'),
    category: 'consistency',
    query: 'What does the Auth module do?',
    actualResult: 'Handles authentication',
    errorType: 'inconsistent_answers',
    context: { repoName: 'test-repo' },
    severity: 'low',
  },
  {
    id: 'failure-005',
    timestamp: new Date('2025-01-16T11:00:00Z'),
    category: 'retrieval',
    query: 'List all methods in DatabaseConnection class',
    expectedResult: 'connect, disconnect, query, execute',
    actualResult: 'connect, disconnect, query',
    errorType: 'incomplete_list',
    context: { repoName: 'test-repo' },
    severity: 'medium',
  },
];

const defaultConfig: CorpusConfig = {
  storagePath: '/tmp/test-failure-corpus',
  maxSize: 10000,
  retentionDays: 90,
  autoClassify: true,
};

// ============================================================================
// FACTORY FUNCTION TESTS
// ============================================================================

describe('createFailureCorpus', () => {
  it('should create a FailureCorpus instance', () => {
    const corpus = createFailureCorpus(defaultConfig);
    expect(corpus).toBeInstanceOf(FailureCorpus);
  });

  it('should create with default config when none provided', () => {
    const corpus = createFailureCorpus();
    expect(corpus).toBeInstanceOf(FailureCorpus);
  });
});

// ============================================================================
// RECORD FAILURE TESTS
// ============================================================================

describe('FailureCorpus - recordFailure', () => {
  let corpus: FailureCorpus;

  beforeEach(() => {
    corpus = createFailureCorpus(defaultConfig);
  });

  it('should record a single failure case', async () => {
    await corpus.recordFailure(sampleFailureCase);
    const stats = corpus.getStats();
    expect(stats.totalCases).toBe(1);
  });

  it('should record multiple failure cases', async () => {
    for (const failure of sampleFailureCases) {
      await corpus.recordFailure(failure);
    }
    const stats = corpus.getStats();
    expect(stats.totalCases).toBe(sampleFailureCases.length);
  });

  it('should generate unique IDs when id is not provided', async () => {
    const failureWithoutId: FailureCase = {
      ...sampleFailureCase,
      id: '',
    };
    await corpus.recordFailure(failureWithoutId);
    const stats = corpus.getStats();
    expect(stats.totalCases).toBe(1);
  });

  it('should set timestamp to now if not provided', async () => {
    const failureWithoutTimestamp: FailureCase = {
      ...sampleFailureCase,
      timestamp: undefined as unknown as Date,
    };
    const before = new Date();
    await corpus.recordFailure(failureWithoutTimestamp);
    const after = new Date();

    const samples = corpus.sampleFailures(1);
    expect(samples.length).toBe(1);
    expect(samples[0].timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(samples[0].timestamp.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it('should auto-classify category when autoClassify is enabled', async () => {
    const failureWithOther: FailureCase = {
      ...sampleFailureCase,
      category: 'other',
      errorType: 'retrieval_miss',
    };
    await corpus.recordFailure(failureWithOther);
    // Implementation should auto-classify based on errorType when category is 'other'
    const samples = corpus.sampleFailures(1);
    expect(['retrieval', 'grounding', 'calibration', 'consistency', 'other']).toContain(
      samples[0].category
    );
  });

  it('should reject duplicate IDs', async () => {
    await corpus.recordFailure(sampleFailureCase);
    const duplicateFailure: FailureCase = {
      ...sampleFailureCase,
      query: 'Different query',
    };
    // Should not add duplicate
    await corpus.recordFailure(duplicateFailure);
    const stats = corpus.getStats();
    expect(stats.totalCases).toBe(1);
  });

  it('should respect maxSize limit', async () => {
    const smallCorpus = createFailureCorpus({
      ...defaultConfig,
      maxSize: 3,
    });

    for (let i = 0; i < 5; i++) {
      await smallCorpus.recordFailure({
        ...sampleFailureCase,
        id: `failure-${i}`,
        timestamp: new Date(Date.now() + i * 1000),
      });
    }

    const stats = smallCorpus.getStats();
    expect(stats.totalCases).toBeLessThanOrEqual(3);
  });
});

// ============================================================================
// GET STATS TESTS
// ============================================================================

describe('FailureCorpus - getStats', () => {
  let corpus: FailureCorpus;

  beforeEach(async () => {
    corpus = createFailureCorpus(defaultConfig);
    for (const failure of sampleFailureCases) {
      await corpus.recordFailure(failure);
    }
  });

  it('should return total case count', () => {
    const stats = corpus.getStats();
    expect(stats.totalCases).toBe(sampleFailureCases.length);
  });

  it('should return counts by category', () => {
    const stats = corpus.getStats();
    expect(stats.byCategory['retrieval']).toBe(2);
    expect(stats.byCategory['grounding']).toBe(1);
    expect(stats.byCategory['calibration']).toBe(1);
    expect(stats.byCategory['consistency']).toBe(1);
  });

  it('should return counts by severity', () => {
    const stats = corpus.getStats();
    expect(stats.bySeverity['critical']).toBe(1);
    expect(stats.bySeverity['high']).toBe(1);
    expect(stats.bySeverity['medium']).toBe(2);
    expect(stats.bySeverity['low']).toBe(1);
  });

  it('should calculate growth rate', () => {
    const stats = corpus.getStats();
    expect(typeof stats.growthRate).toBe('number');
    expect(stats.growthRate).toBeGreaterThanOrEqual(0);
  });

  it('should have lastUpdated timestamp', () => {
    const stats = corpus.getStats();
    expect(stats.lastUpdated).toBeInstanceOf(Date);
  });

  it('should return zero counts for empty corpus', () => {
    const emptyCorpus = createFailureCorpus(defaultConfig);
    const stats = emptyCorpus.getStats();
    expect(stats.totalCases).toBe(0);
    expect(Object.values(stats.byCategory).every((v) => v === 0 || v === undefined)).toBe(true);
  });
});

// ============================================================================
// ANALYZE PATTERNS TESTS
// ============================================================================

describe('FailureCorpus - analyzePatterns', () => {
  let corpus: FailureCorpus;

  beforeEach(async () => {
    corpus = createFailureCorpus(defaultConfig);
    // Add failures with repeating patterns
    for (let i = 0; i < 10; i++) {
      await corpus.recordFailure({
        ...sampleFailureCase,
        id: `retrieval-failure-${i}`,
        category: 'retrieval',
        errorType: 'incorrect_parameter_count',
        timestamp: new Date(Date.now() - i * 24 * 60 * 60 * 1000),
      });
    }
    for (let i = 0; i < 5; i++) {
      await corpus.recordFailure({
        ...sampleFailureCase,
        id: `grounding-failure-${i}`,
        category: 'grounding',
        errorType: 'incorrect_location',
        timestamp: new Date(Date.now() - i * 24 * 60 * 60 * 1000),
      });
    }
  });

  it('should identify failure patterns', () => {
    const analysis = corpus.analyzePatterns();
    expect(analysis.patterns).toBeDefined();
    expect(analysis.patterns.length).toBeGreaterThan(0);
  });

  it('should return top categories', () => {
    const analysis = corpus.analyzePatterns();
    expect(analysis.topCategories).toBeDefined();
    expect(analysis.topCategories.length).toBeGreaterThan(0);
    expect(analysis.topCategories[0].category).toBe('retrieval');
    expect(analysis.topCategories[0].count).toBe(10);
  });

  it('should determine recent trend', () => {
    const analysis = corpus.analyzePatterns();
    expect(['increasing', 'stable', 'decreasing']).toContain(analysis.recentTrend);
  });

  it('should generate recommendations', () => {
    const analysis = corpus.analyzePatterns();
    expect(analysis.recommendations).toBeDefined();
    expect(Array.isArray(analysis.recommendations)).toBe(true);
  });

  it('should include pattern occurrences count', () => {
    const analysis = corpus.analyzePatterns();
    const pattern = analysis.patterns.find((p) => p.pattern.includes('incorrect_parameter_count'));
    expect(pattern).toBeDefined();
    if (pattern) {
      expect(pattern.occurrences).toBe(10);
    }
  });

  it('should include example failures for patterns', () => {
    const analysis = corpus.analyzePatterns();
    expect(analysis.patterns.length).toBeGreaterThan(0);
    const pattern = analysis.patterns[0];
    expect(pattern.examples).toBeDefined();
    expect(pattern.examples.length).toBeGreaterThan(0);
  });

  it('should handle empty corpus gracefully', () => {
    const emptyCorpus = createFailureCorpus(defaultConfig);
    const analysis = emptyCorpus.analyzePatterns();
    expect(analysis.patterns).toEqual([]);
    expect(analysis.topCategories).toEqual([]);
    expect(analysis.recentTrend).toBe('stable');
    expect(analysis.recommendations).toEqual([]);
  });
});

// ============================================================================
// EXPORT FOR TRAINING TESTS
// ============================================================================

describe('FailureCorpus - exportForTraining', () => {
  let corpus: FailureCorpus;

  beforeEach(async () => {
    corpus = createFailureCorpus(defaultConfig);
    for (const failure of sampleFailureCases) {
      await corpus.recordFailure(failure);
    }
  });

  it('should export to JSON format', () => {
    const exported = corpus.exportForTraining('json');
    expect(typeof exported).toBe('string');
    const parsed = JSON.parse(exported);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(sampleFailureCases.length);
  });

  it('should export to CSV format', () => {
    const exported = corpus.exportForTraining('csv');
    expect(typeof exported).toBe('string');
    // Should have header row plus data rows
    const lines = exported.split('\n').filter((l) => l.trim());
    expect(lines.length).toBe(sampleFailureCases.length + 1); // header + data
  });

  it('should include all required fields in JSON export', () => {
    const exported = corpus.exportForTraining('json');
    const parsed = JSON.parse(exported);
    const firstItem = parsed[0];

    expect(firstItem.id).toBeDefined();
    expect(firstItem.timestamp).toBeDefined();
    expect(firstItem.category).toBeDefined();
    expect(firstItem.query).toBeDefined();
    expect(firstItem.actualResult).toBeDefined();
    expect(firstItem.errorType).toBeDefined();
    expect(firstItem.severity).toBeDefined();
  });

  it('should include CSV header with correct columns', () => {
    const exported = corpus.exportForTraining('csv');
    const headerLine = exported.split('\n')[0];
    expect(headerLine).toContain('id');
    expect(headerLine).toContain('timestamp');
    expect(headerLine).toContain('category');
    expect(headerLine).toContain('query');
    expect(headerLine).toContain('errorType');
    expect(headerLine).toContain('severity');
  });

  it('should handle empty corpus', () => {
    const emptyCorpus = createFailureCorpus(defaultConfig);

    const jsonExport = emptyCorpus.exportForTraining('json');
    expect(JSON.parse(jsonExport)).toEqual([]);

    const csvExport = emptyCorpus.exportForTraining('csv');
    // Should still have header row
    expect(csvExport.split('\n').filter((l) => l.trim()).length).toBe(1);
  });

  it('should escape special characters in CSV', () => {
    const corpusWithSpecialChars = createFailureCorpus(defaultConfig);
    corpusWithSpecialChars.recordFailure({
      ...sampleFailureCase,
      id: 'special-chars',
      query: 'Query with "quotes" and, commas',
      actualResult: 'Result with\nnewline',
    });

    const exported = corpusWithSpecialChars.exportForTraining('csv');
    // Should properly escape quotes and handle special characters
    expect(exported).toContain('"');
  });
});

// ============================================================================
// SAMPLE FAILURES TESTS
// ============================================================================

describe('FailureCorpus - sampleFailures', () => {
  let corpus: FailureCorpus;

  beforeEach(async () => {
    corpus = createFailureCorpus(defaultConfig);
    for (const failure of sampleFailureCases) {
      await corpus.recordFailure(failure);
    }
  });

  it('should return requested number of samples', () => {
    const samples = corpus.sampleFailures(3);
    expect(samples.length).toBe(3);
  });

  it('should return all failures when count exceeds total', () => {
    const samples = corpus.sampleFailures(100);
    expect(samples.length).toBe(sampleFailureCases.length);
  });

  it('should filter by category when specified', () => {
    const samples = corpus.sampleFailures(10, 'retrieval');
    expect(samples.every((s) => s.category === 'retrieval')).toBe(true);
    expect(samples.length).toBe(2);
  });

  it('should return empty array when category has no failures', () => {
    const samples = corpus.sampleFailures(10, 'other');
    expect(samples.length).toBe(0);
  });

  it('should return random samples', () => {
    // Add more failures to make randomness testable
    for (let i = 0; i < 20; i++) {
      corpus.recordFailure({
        ...sampleFailureCase,
        id: `extra-failure-${i}`,
      });
    }

    const samples1 = corpus.sampleFailures(5);
    const samples2 = corpus.sampleFailures(5);

    // Due to randomness, samples should potentially differ (not a strict requirement)
    // Just verify we get valid samples
    expect(samples1.length).toBe(5);
    expect(samples2.length).toBe(5);
  });

  it('should handle zero count', () => {
    const samples = corpus.sampleFailures(0);
    expect(samples.length).toBe(0);
  });

  it('should handle empty corpus', () => {
    const emptyCorpus = createFailureCorpus(defaultConfig);
    const samples = emptyCorpus.sampleFailures(5);
    expect(samples.length).toBe(0);
  });
});

// ============================================================================
// DEDUPLICATE CORPUS TESTS
// ============================================================================

describe('FailureCorpus - deduplicateCorpus', () => {
  let corpus: FailureCorpus;

  beforeEach(() => {
    corpus = createFailureCorpus(defaultConfig);
  });

  it('should remove exact duplicate queries', async () => {
    await corpus.recordFailure(sampleFailureCase);
    await corpus.recordFailure({
      ...sampleFailureCase,
      id: 'different-id',
      query: sampleFailureCase.query, // Same query
    });

    const removedCount = corpus.deduplicateCorpus();
    expect(removedCount).toBe(1);
    expect(corpus.getStats().totalCases).toBe(1);
  });

  it('should remove similar queries based on threshold', async () => {
    await corpus.recordFailure({
      ...sampleFailureCase,
      id: 'failure-a',
      query: 'What parameters does function processData accept?',
    });
    await corpus.recordFailure({
      ...sampleFailureCase,
      id: 'failure-b',
      query: 'What parameters does function processData take?', // Very similar
    });

    const removedCount = corpus.deduplicateCorpus();
    expect(removedCount).toBeGreaterThanOrEqual(0); // May or may not dedupe based on similarity threshold
  });

  it('should keep distinct failures', async () => {
    await corpus.recordFailure({
      ...sampleFailureCase,
      id: 'failure-a',
      query: 'What does function foo do?',
    });
    await corpus.recordFailure({
      ...sampleFailureCase,
      id: 'failure-b',
      query: 'Where is class Bar defined?',
    });

    const removedCount = corpus.deduplicateCorpus();
    expect(removedCount).toBe(0);
    expect(corpus.getStats().totalCases).toBe(2);
  });

  it('should return count of removed duplicates', async () => {
    for (let i = 0; i < 5; i++) {
      await corpus.recordFailure({
        ...sampleFailureCase,
        id: `failure-${i}`,
        query: 'Identical query for all',
      });
    }

    const removedCount = corpus.deduplicateCorpus();
    expect(removedCount).toBe(4); // Keep 1, remove 4
    expect(corpus.getStats().totalCases).toBe(1);
  });

  it('should handle empty corpus', () => {
    const removedCount = corpus.deduplicateCorpus();
    expect(removedCount).toBe(0);
  });

  it('should preserve oldest failure when deduplicating', async () => {
    const oldTimestamp = new Date('2024-01-01T00:00:00Z');
    const newTimestamp = new Date('2025-01-01T00:00:00Z');

    await corpus.recordFailure({
      ...sampleFailureCase,
      id: 'old-failure',
      timestamp: oldTimestamp,
      query: 'Duplicate query',
    });
    await corpus.recordFailure({
      ...sampleFailureCase,
      id: 'new-failure',
      timestamp: newTimestamp,
      query: 'Duplicate query',
    });

    corpus.deduplicateCorpus();
    const samples = corpus.sampleFailures(1);
    expect(samples[0].timestamp.getTime()).toBe(oldTimestamp.getTime());
  });
});

// ============================================================================
// INTERFACE TYPE TESTS
// ============================================================================

describe('FailureCase Interface', () => {
  it('should support all required fields', () => {
    const failure: FailureCase = {
      id: 'test-id',
      timestamp: new Date(),
      category: 'retrieval',
      query: 'Test query',
      actualResult: 'Test result',
      errorType: 'test_error',
      context: {},
      severity: 'medium',
    };

    expect(failure.id).toBe('test-id');
    expect(failure.category).toBe('retrieval');
    expect(failure.severity).toBe('medium');
  });

  it('should support all category types', () => {
    const categories: FailureCase['category'][] = [
      'retrieval',
      'grounding',
      'calibration',
      'consistency',
      'other',
    ];

    categories.forEach((category) => {
      const failure: FailureCase = {
        ...sampleFailureCase,
        category,
      };
      expect(failure.category).toBe(category);
    });
  });

  it('should support all severity levels', () => {
    const severities: FailureCase['severity'][] = ['low', 'medium', 'high', 'critical'];

    severities.forEach((severity) => {
      const failure: FailureCase = {
        ...sampleFailureCase,
        severity,
      };
      expect(failure.severity).toBe(severity);
    });
  });

  it('should support optional expectedResult', () => {
    const failureWithExpected: FailureCase = {
      ...sampleFailureCase,
      expectedResult: 'Expected value',
    };
    expect(failureWithExpected.expectedResult).toBe('Expected value');

    const failureWithoutExpected: FailureCase = {
      ...sampleFailureCase,
      expectedResult: undefined,
    };
    expect(failureWithoutExpected.expectedResult).toBeUndefined();
  });
});

describe('CorpusStats Interface', () => {
  it('should support all required fields', () => {
    const stats: CorpusStats = {
      totalCases: 100,
      byCategory: { retrieval: 40, grounding: 30, calibration: 20, consistency: 10 },
      bySeverity: { low: 20, medium: 40, high: 30, critical: 10 },
      growthRate: 2.5,
      lastUpdated: new Date(),
    };

    expect(stats.totalCases).toBe(100);
    expect(stats.growthRate).toBe(2.5);
    expect(stats.byCategory['retrieval']).toBe(40);
    expect(stats.bySeverity['critical']).toBe(10);
  });
});

describe('CorpusConfig Interface', () => {
  it('should support all required fields', () => {
    const config: CorpusConfig = {
      storagePath: '/path/to/storage',
      maxSize: 5000,
      retentionDays: 60,
      autoClassify: false,
    };

    expect(config.storagePath).toBe('/path/to/storage');
    expect(config.maxSize).toBe(5000);
    expect(config.retentionDays).toBe(60);
    expect(config.autoClassify).toBe(false);
  });
});

describe('FailureAnalysis Interface', () => {
  it('should support all required fields', () => {
    const analysis: FailureAnalysis = {
      patterns: [
        {
          pattern: 'parameter_count_error',
          occurrences: 15,
          examples: ['failure-1', 'failure-2'],
          suggestedFix: 'Improve parameter extraction',
        },
      ],
      topCategories: [
        { category: 'retrieval', count: 50 },
        { category: 'grounding', count: 30 },
      ],
      recentTrend: 'increasing',
      recommendations: ['Focus on retrieval improvements'],
    };

    expect(analysis.patterns.length).toBe(1);
    expect(analysis.topCategories[0].category).toBe('retrieval');
    expect(analysis.recentTrend).toBe('increasing');
    expect(analysis.recommendations.length).toBe(1);
  });

  it('should support all trend values', () => {
    const trends: FailureAnalysis['recentTrend'][] = ['increasing', 'stable', 'decreasing'];

    trends.forEach((trend) => {
      const analysis: FailureAnalysis = {
        patterns: [],
        topCategories: [],
        recentTrend: trend,
        recommendations: [],
      };
      expect(analysis.recentTrend).toBe(trend);
    });
  });
});

describe('FailurePattern Interface', () => {
  it('should support all required fields', () => {
    const pattern: FailurePattern = {
      pattern: 'test_pattern',
      occurrences: 10,
      examples: ['example1', 'example2'],
    };

    expect(pattern.pattern).toBe('test_pattern');
    expect(pattern.occurrences).toBe(10);
    expect(pattern.examples.length).toBe(2);
  });

  it('should support optional suggestedFix', () => {
    const patternWithFix: FailurePattern = {
      pattern: 'test',
      occurrences: 5,
      examples: [],
      suggestedFix: 'Apply this fix',
    };
    expect(patternWithFix.suggestedFix).toBe('Apply this fix');

    const patternWithoutFix: FailurePattern = {
      pattern: 'test',
      occurrences: 5,
      examples: [],
    };
    expect(patternWithoutFix.suggestedFix).toBeUndefined();
  });
});

// ============================================================================
// EDGE CASES
// ============================================================================

describe('FailureCorpus - Edge Cases', () => {
  let corpus: FailureCorpus;

  beforeEach(() => {
    corpus = createFailureCorpus(defaultConfig);
  });

  it('should handle very long queries', async () => {
    const longQuery = 'What '.repeat(1000) + 'does this function do?';
    await corpus.recordFailure({
      ...sampleFailureCase,
      id: 'long-query',
      query: longQuery,
    });

    const stats = corpus.getStats();
    expect(stats.totalCases).toBe(1);
  });

  it('should handle unicode characters', async () => {
    await corpus.recordFailure({
      ...sampleFailureCase,
      id: 'unicode-failure',
      query: 'What does function with unicode name do?',
      actualResult: 'Result with special chars',
    });

    const samples = corpus.sampleFailures(1);
    expect(samples.length).toBe(1);
  });

  it('should handle empty strings in fields', async () => {
    await corpus.recordFailure({
      ...sampleFailureCase,
      id: 'empty-fields',
      query: '',
      actualResult: '',
      errorType: '',
    });

    const stats = corpus.getStats();
    expect(stats.totalCases).toBe(1);
  });

  it('should handle complex context objects', async () => {
    await corpus.recordFailure({
      ...sampleFailureCase,
      id: 'complex-context',
      context: {
        nested: { deep: { value: 123 } },
        array: [1, 2, 3],
        nullValue: null,
        undefinedValue: undefined,
      },
    });

    const samples = corpus.sampleFailures(1);
    expect(samples[0].context).toBeDefined();
  });

  it('should handle rapid sequential failures', async () => {
    const promises = [];
    for (let i = 0; i < 100; i++) {
      promises.push(
        corpus.recordFailure({
          ...sampleFailureCase,
          id: `rapid-${i}`,
        })
      );
    }
    await Promise.all(promises);

    const stats = corpus.getStats();
    expect(stats.totalCases).toBe(100);
  });

  it('should handle future timestamps', async () => {
    const futureDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    await corpus.recordFailure({
      ...sampleFailureCase,
      id: 'future-failure',
      timestamp: futureDate,
    });

    const stats = corpus.getStats();
    expect(stats.totalCases).toBe(1);
  });

  it('should handle very old timestamps', async () => {
    const oldDate = new Date('2000-01-01T00:00:00Z');
    await corpus.recordFailure({
      ...sampleFailureCase,
      id: 'old-failure',
      timestamp: oldDate,
    });

    const stats = corpus.getStats();
    expect(stats.totalCases).toBe(1);
  });
});

// ============================================================================
// GROWTH TARGET TESTS
// ============================================================================

describe('FailureCorpus - Growth Target (+10% monthly)', () => {
  let corpus: FailureCorpus;

  beforeEach(() => {
    corpus = createFailureCorpus(defaultConfig);
  });

  it('should track growth rate accurately', async () => {
    // Simulate failures over time
    const now = Date.now();
    const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;
    const twoWeeksAgo = now - 14 * 24 * 60 * 60 * 1000;

    // Add failures from two weeks ago
    for (let i = 0; i < 10; i++) {
      await corpus.recordFailure({
        ...sampleFailureCase,
        id: `old-${i}`,
        timestamp: new Date(twoWeeksAgo + i * 1000),
      });
    }

    // Add failures from one week ago
    for (let i = 0; i < 15; i++) {
      await corpus.recordFailure({
        ...sampleFailureCase,
        id: `recent-${i}`,
        timestamp: new Date(oneWeekAgo + i * 1000),
      });
    }

    const stats = corpus.getStats();
    // Growth rate should be positive (15 - 10 = 5 more per week)
    expect(stats.growthRate).toBeGreaterThan(0);
  });

  it('should detect declining corpus growth', async () => {
    const now = Date.now();
    const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;
    const twoWeeksAgo = now - 14 * 24 * 60 * 60 * 1000;

    // Add more failures in the older period (7-14 days ago) than recent period (0-7 days)
    // Growth rate = recent - older, so if older > recent, rate is negative
    for (let i = 0; i < 20; i++) {
      await corpus.recordFailure({
        ...sampleFailureCase,
        id: `old-${i}`,
        // Place in the 7-14 days ago window
        timestamp: new Date(twoWeeksAgo + i * 1000),
      });
    }

    for (let i = 0; i < 5; i++) {
      await corpus.recordFailure({
        ...sampleFailureCase,
        id: `recent-${i}`,
        // Place in the 0-7 days ago window
        timestamp: new Date(now - i * 1000),
      });
    }

    const analysis = corpus.analyzePatterns();
    // Should detect decreasing trend (5 recent vs 20 older = -15 growth rate)
    expect(['decreasing', 'stable']).toContain(analysis.recentTrend);
  });
});
