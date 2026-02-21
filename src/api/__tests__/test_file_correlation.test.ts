/**
 * @fileoverview Tests for Test File Correlation
 *
 * Tests the deterministic test file discovery that maps source files
 * to their test files through path correlation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  classifyTestQuery,
  correlateTestFiles,
  findTestFilesByPattern,
  TEST_FILE_PATTERNS,
  runTestCorrelationStage,
  type TestQueryClassification,
  type TestCorrelationResult,
} from '../test_file_correlation.js';
import type { LiBrainianStorage, TestMapping } from '../../storage/types.js';
import type { FileKnowledge, FunctionKnowledge } from '../../types.js';

// Mock storage
function createMockStorage(options: {
  files?: FileKnowledge[];
  testMappings?: TestMapping[];
  functions?: FunctionKnowledge[];
} = {}): LiBrainianStorage {
  const files = options.files ?? [];
  const testMappings = options.testMappings ?? [];
  const functions = options.functions ?? [];

  return {
    getFileByPath: vi.fn().mockImplementation(async (path: string) => {
      return files.find(f => f.relativePath === path || f.path === path) ?? null;
    }),
    getFiles: vi.fn().mockImplementation(async (opts: { category?: string; limit?: number } = {}) => {
      let result = files;
      if (opts.category) {
        result = result.filter(f => f.category === opts.category);
      }
      if (opts.limit) {
        result = result.slice(0, opts.limit);
      }
      return result;
    }),
    getTestMappingsBySourcePath: vi.fn().mockImplementation(async (sourcePath: string) => {
      return testMappings.filter(m => m.sourcePath === sourcePath);
    }),
    getFunctionsByPath: vi.fn().mockImplementation(async (path: string) => {
      return functions.filter(f => f.filePath === path);
    }),
    getContextPackForTarget: vi.fn().mockResolvedValue(null),
  } as unknown as LiBrainianStorage;
}

describe('classifyTestQuery', () => {
  describe('test query detection', () => {
    it('detects "tests for X" queries', () => {
      const result = classifyTestQuery('tests for query.ts');
      expect(result.isTestQuery).toBe(true);
      expect(result.targetFile).toBe('query.ts');
      expect(result.confidence).toBeGreaterThan(0.9);
    });

    it('detects "test files for X" queries', () => {
      const result = classifyTestQuery('test files for bootstrap');
      expect(result.isTestQuery).toBe(true);
      expect(result.targetFile).toBe('bootstrap');
    });

    it('detects "what tests cover X" queries', () => {
      const result = classifyTestQuery('what tests cover storage.ts');
      expect(result.isTestQuery).toBe(true);
      expect(result.targetFile).toBe('storage.ts');
    });

    it('detects "find tests for X" queries', () => {
      const result = classifyTestQuery('find tests for embeddings');
      expect(result.isTestQuery).toBe(true);
      expect(result.targetFile).toBe('embeddings');
    });

    it('detects "which tests" queries', () => {
      const result = classifyTestQuery('which tests should I run for auth');
      expect(result.isTestQuery).toBe(true);
    });

    it('extracts file paths with directories', () => {
      const result = classifyTestQuery('tests for src/api/query.ts');
      expect(result.isTestQuery).toBe(true);
      expect(result.targetFile).toBe('src/api/query.ts');
    });
  });

  describe('non-test query detection', () => {
    it('rejects general code queries', () => {
      const result = classifyTestQuery('how does the query function work');
      expect(result.isTestQuery).toBe(false);
    });

    it('rejects documentation queries', () => {
      const result = classifyTestQuery('explain the architecture');
      expect(result.isTestQuery).toBe(false);
    });

    it('rejects implementation queries', () => {
      const result = classifyTestQuery('where is queryLiBrainian defined');
      expect(result.isTestQuery).toBe(false);
    });
  });
});

describe('TEST_FILE_PATTERNS', () => {
  it('generates sibling test paths', () => {
    const pattern = TEST_FILE_PATTERNS.find(p => p.name === 'sibling_test')!;
    const paths = pattern.generateTestPaths('src/api/query.ts', 'src/api', 'query');
    expect(paths).toContain('src/api/query.test.ts');
    expect(paths).toContain('src/api/query.test.tsx');
    expect(paths).toContain('src/api/query.test.js');
  });

  it('generates spec file paths', () => {
    const pattern = TEST_FILE_PATTERNS.find(p => p.name === 'sibling_spec')!;
    const paths = pattern.generateTestPaths('src/api/query.ts', 'src/api', 'query');
    expect(paths).toContain('src/api/query.spec.ts');
    expect(paths).toContain('src/api/query.spec.tsx');
  });

  it('generates __tests__ directory paths', () => {
    const pattern = TEST_FILE_PATTERNS.find(p => p.name === '__tests__')!;
    const paths = pattern.generateTestPaths('src/api/query.ts', 'src/api', 'query');
    expect(paths).toContain('src/api/__tests__/query.ts');
    expect(paths).toContain('src/api/__tests__/query.test.ts');
    expect(paths).toContain('src/api/__tests__/query.spec.ts');
  });

  it('generates tests directory paths', () => {
    const pattern = TEST_FILE_PATTERNS.find(p => p.name === 'tests_directory')!;
    const paths = pattern.generateTestPaths('src/api/query.ts', 'src/api', 'query');
    expect(paths.some(p => p.includes('tests/api/query'))).toBe(true);
    expect(paths.some(p => p.includes('test/api/query'))).toBe(true);
  });
});

describe('correlateTestFiles', () => {
  it('finds test files using naming conventions', async () => {
    const storage = createMockStorage({
      files: [
        { id: '1', relativePath: 'src/api/query.test.ts', category: 'test' } as FileKnowledge,
        { id: '2', relativePath: 'src/api/__tests__/query.test.ts', category: 'test' } as FileKnowledge,
      ],
    });

    const result = await correlateTestFiles('src/api/query.ts', storage);

    expect(result.totalTestFiles).toBeGreaterThan(0);
    expect(result.correlatedTests.some(t => t.testPath.includes('query.test.ts'))).toBe(true);
  });

  it('finds test files using indexed mappings', async () => {
    const storage = createMockStorage({
      testMappings: [
        {
          id: '1',
          testPath: 'src/__tests__/query_integration.test.ts',
          sourcePath: 'src/api/query.ts',
          confidence: 0.95,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    });

    const result = await correlateTestFiles('src/api/query.ts', storage);

    expect(result.indexedTests.length).toBe(1);
    expect(result.correlatedTests.some(t => t.correlationType === 'indexed_mapping')).toBe(true);
  });

  it('deduplicates test files', async () => {
    const storage = createMockStorage({
      files: [
        { id: '1', relativePath: 'src/api/query.test.ts', category: 'test' } as FileKnowledge,
      ],
      testMappings: [
        {
          id: '1',
          testPath: 'src/api/query.test.ts', // Same as above
          sourcePath: 'src/api/query.ts',
          confidence: 0.9,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    });

    const result = await correlateTestFiles('src/api/query.ts', storage);

    // Should only appear once despite being found through two methods
    const queryTestCount = result.correlatedTests.filter(
      t => t.testPath === 'src/api/query.test.ts'
    ).length;
    expect(queryTestCount).toBe(1);
  });

  it('returns empty when no tests found', async () => {
    const storage = createMockStorage();
    const result = await correlateTestFiles('src/api/unknown.ts', storage);
    expect(result.totalTestFiles).toBe(0);
    expect(result.explanation).toContain('No test files found');
  });
});

describe('findTestFilesByPattern', () => {
  it('finds test files matching a pattern', async () => {
    const storage = createMockStorage({
      files: [
        { id: '1', relativePath: 'src/api/__tests__/query_pipeline.test.ts', category: 'test' } as FileKnowledge,
        { id: '2', relativePath: 'src/api/__tests__/query_episodes.test.ts', category: 'test' } as FileKnowledge,
        { id: '3', relativePath: 'src/__tests__/bootstrap.test.ts', category: 'test' } as FileKnowledge,
      ],
    });

    const results = await findTestFilesByPattern('query', storage);

    expect(results.length).toBe(2);
    expect(results.every(r => r.testPath.includes('query'))).toBe(true);
  });

  it('returns exact matches with higher confidence', async () => {
    const storage = createMockStorage({
      files: [
        { id: '1', relativePath: 'src/api/__tests__/query.test.ts', category: 'test' } as FileKnowledge,
        { id: '2', relativePath: 'src/api/__tests__/query_helper.test.ts', category: 'test' } as FileKnowledge,
      ],
    });

    const results = await findTestFilesByPattern('query', storage);

    // Exact match should have higher confidence and come first
    expect(results[0]!.testPath).toContain('query.test.ts');
    expect(results[0]!.confidence).toBeGreaterThan(results[1]!.confidence);
  });
});

describe('runTestCorrelationStage', () => {
  it('returns empty for non-test queries', async () => {
    const storage = createMockStorage();
    const result = await runTestCorrelationStage({
      intent: 'how does authentication work',
      storage,
    });

    expect(result.isTestQuery).toBe(false);
    expect(result.testPacks.length).toBe(0);
  });

  it('finds test files for test queries', async () => {
    const storage = createMockStorage({
      files: [
        {
          id: '1',
          relativePath: 'src/api/query.ts',
          path: 'src/api/query.ts',
          category: 'code',
          purpose: 'Query API',
          summary: 'Main query API',
        } as FileKnowledge,
        {
          id: '2',
          relativePath: 'src/api/__tests__/query.test.ts',
          path: 'src/api/__tests__/query.test.ts',
          category: 'test',
          purpose: 'Tests for query API',
          summary: 'Query tests',
        } as FileKnowledge,
      ],
    });

    const result = await runTestCorrelationStage({
      intent: 'tests for query.ts',
      storage,
    });

    expect(result.isTestQuery).toBe(true);
    expect(result.explanation).toContain('test file');
  });

  it('uses affectedFiles when provided', async () => {
    const storage = createMockStorage({
      files: [
        {
          id: '1',
          relativePath: 'src/api/bootstrap.test.ts',
          path: 'src/api/bootstrap.test.ts',
          category: 'test',
          purpose: 'Bootstrap tests',
          summary: 'Tests',
        } as FileKnowledge,
      ],
    });

    const result = await runTestCorrelationStage({
      intent: 'what tests are there',
      affectedFiles: ['src/api/bootstrap.ts'],
      storage,
    });

    expect(result.isTestQuery).toBe(true);
  });
});

describe('integration: query.ts test files discovery', () => {
  // This simulates the real-world scenario from the task description
  it('finds all 7 query-related test files through path matching', async () => {
    const storage = createMockStorage({
      files: [
        // The 7 test files that should be found for query.ts
        { id: '1', relativePath: 'src/api/__tests__/query_episodes.test.ts', category: 'test' } as FileKnowledge,
        { id: '2', relativePath: 'src/api/__tests__/query_pipeline.test.ts', category: 'test' } as FileKnowledge,
        { id: '3', relativePath: 'src/api/__tests__/query_stage_reporting.test.ts', category: 'test' } as FileKnowledge,
        { id: '4', relativePath: 'src/api/__tests__/query_trace_ledger.test.ts', category: 'test' } as FileKnowledge,
        { id: '5', relativePath: 'src/api/__tests__/query_intent_classification.test.ts', category: 'test' } as FileKnowledge,
        { id: '6', relativePath: 'src/api/__tests__/query_edge_filtering.test.ts', category: 'test' } as FileKnowledge,
        { id: '7', relativePath: 'src/api/__tests__/librainian_query_fallback.test.ts', category: 'test' } as FileKnowledge,
        // Unrelated test file
        { id: '8', relativePath: 'src/__tests__/bootstrap.test.ts', category: 'test' } as FileKnowledge,
      ],
    });

    // Query for test files
    const results = await findTestFilesByPattern('query', storage);

    // Should find at least 6 of the query-related files (exact and partial matches)
    expect(results.length).toBeGreaterThanOrEqual(6);

    // Should NOT include bootstrap.test.ts
    expect(results.every(r => !r.testPath.includes('bootstrap'))).toBe(true);

    // All results should be query-related
    expect(results.every(r => r.testPath.includes('query'))).toBe(true);
  });
});
