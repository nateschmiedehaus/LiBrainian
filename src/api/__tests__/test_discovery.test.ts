import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as path from 'node:path';
import {
  detectTestQuery,
  findTestsForClass,
  type TestDiscoveryResult,
  type TestQueryDetection,
} from '../test_discovery.js';

describe('detectTestQuery', () => {
  describe('positive cases - should detect test queries', () => {
    it('detects "tests for SqliteLiBrainianStorage"', () => {
      const result = detectTestQuery('tests for SqliteLiBrainianStorage');
      expect(result.isTestQuery).toBe(true);
      expect(result.target).toBe('SqliteLiBrainianStorage');
      expect(result.confidence).toBeGreaterThanOrEqual(0.85);
    });

    it('detects "test for SymbolTable"', () => {
      const result = detectTestQuery('test for SymbolTable');
      expect(result.isTestQuery).toBe(true);
      expect(result.target).toBe('SymbolTable');
    });

    it('detects "tests of QueryRunner"', () => {
      const result = detectTestQuery('tests of QueryRunner');
      expect(result.isTestQuery).toBe(true);
      expect(result.target).toBe('QueryRunner');
    });

    it('detects "tests covering EmbeddingService"', () => {
      const result = detectTestQuery('tests covering EmbeddingService');
      expect(result.isTestQuery).toBe(true);
      expect(result.target).toBe('EmbeddingService');
    });

    it('detects "SqliteLiBrainianStorage tests"', () => {
      const result = detectTestQuery('SqliteLiBrainianStorage tests');
      expect(result.isTestQuery).toBe(true);
      expect(result.target).toBe('SqliteLiBrainianStorage');
    });

    it('detects "unit tests for ConfigManager"', () => {
      const result = detectTestQuery('unit tests for ConfigManager');
      expect(result.isTestQuery).toBe(true);
      expect(result.target).toBe('ConfigManager');
    });

    it('detects "integration tests for GraphBuilder"', () => {
      const result = detectTestQuery('integration tests for GraphBuilder');
      expect(result.isTestQuery).toBe(true);
      expect(result.target).toBe('GraphBuilder');
    });

    it('detects "find tests for Parser"', () => {
      const result = detectTestQuery('find tests for Parser');
      expect(result.isTestQuery).toBe(true);
      expect(result.target).toBe('Parser');
    });

    it('detects "test files for IndexService"', () => {
      const result = detectTestQuery('test files for IndexService');
      expect(result.isTestQuery).toBe(true);
      expect(result.target).toBe('IndexService');
    });

    it('detects "test coverage for Logger"', () => {
      const result = detectTestQuery('test coverage for Logger');
      expect(result.isTestQuery).toBe(true);
      expect(result.target).toBe('Logger');
    });

    it('has higher confidence for PascalCase targets', () => {
      const pascalCase = detectTestQuery('tests for SqliteLiBrainianStorage');
      const camelCase = detectTestQuery('tests for sqliteLiBrainianStorage');

      expect(pascalCase.confidence).toBeGreaterThan(camelCase.confidence);
    });
  });

  describe('negative cases - should not detect test queries', () => {
    it('does not detect "how does authentication work"', () => {
      const result = detectTestQuery('how does authentication work');
      expect(result.isTestQuery).toBe(false);
    });

    it('does not detect "what is the architecture"', () => {
      const result = detectTestQuery('what is the architecture');
      expect(result.isTestQuery).toBe(false);
    });

    it('does not detect "find all imports"', () => {
      const result = detectTestQuery('find all imports');
      expect(result.isTestQuery).toBe(false);
    });

    it('does not detect "tests for the file" (generic word)', () => {
      const result = detectTestQuery('tests for the file');
      // 'the' is an excluded target, so this shouldn't match
      expect(result.isTestQuery).toBe(false);
    });

    it('does not detect "tests" alone', () => {
      const result = detectTestQuery('tests');
      expect(result.isTestQuery).toBe(false);
    });
  });
});

describe('findTestsForClass', () => {
  // We use the actual workspace to test real file discovery
  const workspaceRoot = path.resolve(__dirname, '../../..');

  it('finds test files that reference SqliteLiBrainianStorage', async () => {
    const result = await findTestsForClass(workspaceRoot, 'SqliteLiBrainianStorage');

    expect(result.testFiles.length).toBeGreaterThan(0);
    expect(result.coverageStatus).not.toBe('none');

    // Should find test files that actually reference the class
    // We know from grep that these files exist:
    // - src/api/__tests__/query_intent_classification.test.ts
    // - src/constructions/__tests__/symbol_table.test.ts
    // - src/constructions/__tests__/comparison.test.ts
    // - src/api/__tests__/exhaustive_graph_query.test.ts
    const expectedPatterns = [
      'query_intent_classification.test.ts',
      'symbol_table.test.ts',
      'comparison.test.ts',
      'exhaustive_graph_query.test.ts',
    ];

    const foundAnyExpected = expectedPatterns.some(pattern =>
      result.testFiles.some(f => f.includes(pattern))
    );
    expect(foundAnyExpected).toBe(true);
  }, 30000);

  it('finds test files for ContextPack', async () => {
    const result = await findTestsForClass(workspaceRoot, 'ContextPack');

    // ContextPack is a widely used type, should find multiple test files
    expect(result.testFiles.length).toBeGreaterThan(0);
  }, 30000);

  it('returns empty for non-existent class', async () => {
    // Use a class name that definitely won't appear anywhere
    // Note: the string we're searching for is split to avoid self-matching
    const result = await findTestsForClass(workspaceRoot, 'Xyz' + 'Abc' + 'Unique' + '999');

    expect(result.testFiles.length).toBe(0);
    expect(result.coverageStatus).toBe('none');
  }, 30000);

  it('discovery method is class_reference when found by grepping', async () => {
    // SqliteLiBrainianStorage doesn't have a file named after it,
    // so it should be found via class_reference
    const result = await findTestsForClass(workspaceRoot, 'SqliteLiBrainianStorage');

    // Since there's no SqliteLiBrainianStorage.test.ts, discovery should be via reference
    expect(['class_reference', 'both']).toContain(result.discoveryMethod);
  }, 30000);
});
