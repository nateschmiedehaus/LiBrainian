/**
 * @fileoverview Tests for Test Suggestion System
 *
 * Tests the test suggestion generation that helps agents identify
 * what tests should be written for code.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  classifyTestSuggestionQuery,
  suggestTests,
  type TestSuggestion,
  type TestScenario,
  type MockRequirement,
  type TestSuggestionQueryClassification,
} from '../test_suggestions.js';
import type { LiBrainianStorage, GraphEdge } from '../../storage/types.js';
import type { FunctionKnowledge } from '../../types.js';

// ============================================================================
// MOCK HELPERS
// ============================================================================

function createMockFunction(overrides: Partial<FunctionKnowledge> = {}): FunctionKnowledge {
  return {
    id: 'func-1',
    filePath: 'src/api/query.ts',
    name: 'queryLiBrainian',
    signature: 'export async function queryLiBrainian(storage: LiBrainianStorage, query: LiBrainianQuery): Promise<LiBrainianResponse>',
    purpose: 'Executes a query against the librainian storage and returns relevant context packs',
    startLine: 100,
    endLine: 200,
    confidence: 0.9,
    accessCount: 10,
    lastAccessed: new Date(),
    validationCount: 5,
    outcomeHistory: { successes: 4, failures: 1 },
    ...overrides,
  };
}

function createMockStorage(options: {
  functions?: FunctionKnowledge[];
  edges?: GraphEdge[];
} = {}): LiBrainianStorage {
  const functions = options.functions ?? [];
  const edges = options.edges ?? [];

  return {
    getFunctionByPath: vi.fn().mockImplementation(async (path: string, name: string) => {
      return functions.find(f => f.filePath === path && f.name === name) ?? null;
    }),
    getFunctionsByPath: vi.fn().mockImplementation(async (path: string) => {
      return functions.filter(f => f.filePath === path);
    }),
    getGraphEdges: vi.fn().mockImplementation(async () => edges),
  } as unknown as LiBrainianStorage;
}

// ============================================================================
// QUERY CLASSIFICATION TESTS
// ============================================================================

describe('classifyTestSuggestionQuery', () => {
  describe('test suggestion query detection', () => {
    it('detects "what tests should I write for X" queries', () => {
      const result = classifyTestSuggestionQuery('what tests should I write for query.ts');
      expect(result.isTestSuggestionQuery).toBe(true);
      expect(result.target).toBe('query.ts');
      expect(result.confidence).toBeGreaterThan(0.9);
    });

    it('detects "suggest tests for X" queries', () => {
      const result = classifyTestSuggestionQuery('suggest tests for bootstrap');
      expect(result.isTestSuggestionQuery).toBe(true);
      expect(result.target).toBe('bootstrap');
    });

    it('detects "generate tests for X" queries', () => {
      const result = classifyTestSuggestionQuery('generate tests for storage.ts');
      expect(result.isTestSuggestionQuery).toBe(true);
      expect(result.target).toBe('storage.ts');
    });

    it('detects "test suggestions for X" queries', () => {
      const result = classifyTestSuggestionQuery('test suggestions for embeddings');
      expect(result.isTestSuggestionQuery).toBe(true);
      expect(result.target).toBe('embeddings');
    });

    it('detects "what should be tested in X" queries', () => {
      const result = classifyTestSuggestionQuery('what should be tested in src/api/query.ts');
      expect(result.isTestSuggestionQuery).toBe(true);
      expect(result.target).toBe('src/api/query.ts');
    });

    it('detects "how should I test X" queries', () => {
      const result = classifyTestSuggestionQuery('how should I test the bootstrap module');
      expect(result.isTestSuggestionQuery).toBe(true);
    });

    it('detects "test cases for X" queries', () => {
      const result = classifyTestSuggestionQuery('test cases for queryLiBrainian');
      expect(result.isTestSuggestionQuery).toBe(true);
      expect(result.target).toBe('queryLiBrainian');
    });

    it('detects "testing strategy for X" queries', () => {
      const result = classifyTestSuggestionQuery('testing strategy for src/api/librainian.ts');
      expect(result.isTestSuggestionQuery).toBe(true);
      expect(result.target).toBe('src/api/librainian.ts');
    });
  });

  describe('non-test suggestion query detection', () => {
    it('rejects "tests for X" queries (finding existing tests)', () => {
      const result = classifyTestSuggestionQuery('tests for query.ts');
      expect(result.isTestSuggestionQuery).toBe(false);
    });

    it('rejects general code queries', () => {
      const result = classifyTestSuggestionQuery('how does the query function work');
      expect(result.isTestSuggestionQuery).toBe(false);
    });

    it('rejects documentation queries', () => {
      const result = classifyTestSuggestionQuery('explain the architecture');
      expect(result.isTestSuggestionQuery).toBe(false);
    });

    it('rejects implementation queries', () => {
      const result = classifyTestSuggestionQuery('where is queryLiBrainian defined');
      expect(result.isTestSuggestionQuery).toBe(false);
    });
  });
});

// ============================================================================
// TEST SUGGESTION GENERATION TESTS
// ============================================================================

describe('suggestTests', () => {
  describe('basic suggestion generation', () => {
    it('generates suggestions for a function', async () => {
      const func = createMockFunction();
      const storage = createMockStorage({ functions: [func] });

      const suggestions = await suggestTests(storage, func.filePath);

      expect(suggestions).toHaveLength(1);
      expect(suggestions[0]!.targetFunction).toBe('queryLiBrainian');
      expect(suggestions[0]!.file).toBe(func.filePath);
    });

    it('generates test file path following conventions', async () => {
      const func = createMockFunction({ filePath: 'src/api/query.ts' });
      const storage = createMockStorage({ functions: [func] });

      const suggestions = await suggestTests(storage, func.filePath);

      expect(suggestions[0]!.testFile).toBe('src/api/__tests__/query.test.ts');
    });

    it('generates scenarios for each function', async () => {
      const func = createMockFunction();
      const storage = createMockStorage({ functions: [func] });

      const suggestions = await suggestTests(storage, func.filePath);

      expect(suggestions[0]!.scenarios.length).toBeGreaterThan(0);
      // Should have at least a happy path test
      expect(suggestions[0]!.scenarios.some(s => s.category === 'happy_path')).toBe(true);
    });

    it('returns empty array when no functions found', async () => {
      const storage = createMockStorage({ functions: [] });

      const suggestions = await suggestTests(storage, 'src/nonexistent.ts');

      expect(suggestions).toHaveLength(0);
    });
  });

  describe('specific function targeting', () => {
    it('returns suggestion only for specified function', async () => {
      const functions = [
        createMockFunction({ id: '1', name: 'functionA' }),
        createMockFunction({ id: '2', name: 'functionB' }),
        createMockFunction({ id: '3', name: 'functionC' }),
      ];
      const storage = createMockStorage({ functions });

      const suggestions = await suggestTests(storage, 'src/api/query.ts', 'functionB');

      expect(suggestions).toHaveLength(1);
      expect(suggestions[0]!.targetFunction).toBe('functionB');
    });

    it('returns empty when specified function not found', async () => {
      const func = createMockFunction({ name: 'existingFunc' });
      const storage = createMockStorage({ functions: [func] });

      const suggestions = await suggestTests(storage, func.filePath, 'nonExistentFunc');

      expect(suggestions).toHaveLength(0);
    });
  });

  describe('test type inference', () => {
    it('suggests unit tests for simple functions', async () => {
      const func = createMockFunction({
        signature: 'function simpleCalc(a: number, b: number): number',
        purpose: 'Calculates sum of two numbers',
      });
      const storage = createMockStorage({ functions: [func] });

      const suggestions = await suggestTests(storage, func.filePath);

      expect(suggestions[0]!.testType).toBe('unit');
    });

    it('suggests integration tests for database functions', async () => {
      const func = createMockFunction({
        signature: 'async function saveUser(db: Database, user: User): Promise<void>',
        purpose: 'Saves user to the database',
      });
      const storage = createMockStorage({
        functions: [func],
        edges: [
          { fromId: func.id, toId: 'db', edgeType: 'calls' } as GraphEdge,
          { fromId: func.id, toId: 'storage', edgeType: 'calls' } as GraphEdge,
          { fromId: func.id, toId: 'validator', edgeType: 'calls' } as GraphEdge,
        ],
      });

      const suggestions = await suggestTests(storage, func.filePath);

      expect(suggestions[0]!.testType).toBe('integration');
    });

    it('suggests e2e tests for server functions', async () => {
      const func = createMockFunction({
        signature: 'function startServer(port: number): void',
        purpose: 'Starts the HTTP server on specified port',
      });
      const storage = createMockStorage({ functions: [func] });

      const suggestions = await suggestTests(storage, func.filePath);

      expect(suggestions[0]!.testType).toBe('e2e');
    });
  });

  describe('priority calculation', () => {
    it('assigns critical priority to exported public API functions', async () => {
      const func = createMockFunction({
        signature: 'export async function queryLiBrainian(storage: LiBrainianStorage): Promise<Response>',
        purpose: 'Main public API for querying the librainian',
      });
      const storage = createMockStorage({ functions: [func] });

      const suggestions = await suggestTests(storage, func.filePath);

      expect(suggestions[0]!.priority).toBe('critical');
    });

    it('assigns high priority to complex functions', async () => {
      const func = createMockFunction({
        signature: 'function processData(a: string, b: number, c: boolean, d: object, e: Array<string>, f: Map<string, number>): ComplexResult',
        startLine: 1,
        endLine: 100, // Long function
      });
      const storage = createMockStorage({ functions: [func] });

      const suggestions = await suggestTests(storage, func.filePath);

      expect(['critical', 'high']).toContain(suggestions[0]!.priority);
    });

    it('assigns low priority to private functions', async () => {
      const func = createMockFunction({
        name: '_privateHelper',
        signature: 'function _privateHelper(): void',
      });
      const storage = createMockStorage({ functions: [func] });

      const suggestions = await suggestTests(storage, func.filePath, undefined, { includePrivate: true });

      expect(suggestions[0]!.priority).toBe('low');
    });

    it('sorts suggestions by priority', async () => {
      const functions = [
        createMockFunction({ id: '1', name: '_privateFunc', signature: 'function _privateFunc(): void' }),
        createMockFunction({ id: '2', name: 'exportedFunc', signature: 'export function exportedFunc(): void', purpose: 'public API' }),
        createMockFunction({ id: '3', name: 'normalFunc', signature: 'function normalFunc(): void' }),
      ];
      const storage = createMockStorage({ functions });

      const suggestions = await suggestTests(storage, 'src/api/query.ts', undefined, { includePrivate: true });

      // Higher priority should come first
      expect(suggestions[0]!.priority).toBe('critical');
      expect(suggestions[suggestions.length - 1]!.priority).toBe('low');
    });
  });

  describe('private function handling', () => {
    it('excludes private functions by default', async () => {
      const functions = [
        createMockFunction({ id: '1', name: 'publicFunc' }),
        createMockFunction({ id: '2', name: '_privateFunc' }),
      ];
      const storage = createMockStorage({ functions });

      const suggestions = await suggestTests(storage, 'src/api/query.ts');

      expect(suggestions).toHaveLength(1);
      expect(suggestions[0]!.targetFunction).toBe('publicFunc');
    });

    it('includes private functions when option is set', async () => {
      const functions = [
        createMockFunction({ id: '1', name: 'publicFunc' }),
        createMockFunction({ id: '2', name: '_privateFunc' }),
      ];
      const storage = createMockStorage({ functions });

      const suggestions = await suggestTests(storage, 'src/api/query.ts', undefined, { includePrivate: true });

      expect(suggestions).toHaveLength(2);
    });
  });

  describe('test function filtering', () => {
    it('excludes test functions from suggestions', async () => {
      const functions = [
        createMockFunction({ id: '1', name: 'realFunc', filePath: 'src/api/query.ts' }),
        createMockFunction({ id: '2', name: 'testRealFunc', filePath: 'src/api/__tests__/query.test.ts' }),
      ];
      const storage = createMockStorage({ functions });

      const suggestions = await suggestTests(storage, 'src/api/query.ts');

      expect(suggestions).toHaveLength(1);
      expect(suggestions[0]!.targetFunction).toBe('realFunc');
    });
  });
});

// ============================================================================
// SCENARIO GENERATION TESTS
// ============================================================================

describe('scenario generation', () => {
  describe('happy path scenarios', () => {
    it('generates happy path test for every function', async () => {
      const func = createMockFunction();
      const storage = createMockStorage({ functions: [func] });

      const suggestions = await suggestTests(storage, func.filePath);
      const happyPath = suggestions[0]!.scenarios.find(s => s.category === 'happy_path');

      expect(happyPath).toBeDefined();
      expect(happyPath!.name).toContain(func.name);
      expect(happyPath!.testCode).toContain('it(');
      expect(happyPath!.testCode).toContain('expect');
    });
  });

  describe('error handling scenarios', () => {
    it('generates error test for functions with error handling', async () => {
      const func = createMockFunction({
        signature: 'function validateInput(input: string): void throws ValidationError',
        purpose: 'Validates input and throws error if invalid',
      });
      const storage = createMockStorage({ functions: [func] });

      const suggestions = await suggestTests(storage, func.filePath);
      const errorTest = suggestions[0]!.scenarios.find(s => s.category === 'error_handling');

      expect(errorTest).toBeDefined();
      expect(errorTest!.testCode).toContain('toThrow');
    });

    it('skips error test for simple functions without error handling', async () => {
      const func = createMockFunction({
        signature: 'function add(a: number, b: number): number',
        purpose: 'Adds two numbers',
      });
      const storage = createMockStorage({ functions: [func] });

      const suggestions = await suggestTests(storage, func.filePath);
      const errorTest = suggestions[0]!.scenarios.find(s => s.category === 'error_handling');

      expect(errorTest).toBeUndefined();
    });
  });

  describe('edge case scenarios', () => {
    it('generates empty string test for string parameters', async () => {
      const func = createMockFunction({
        signature: 'function processText(text: string): string',
      });
      const storage = createMockStorage({ functions: [func] });

      const suggestions = await suggestTests(storage, func.filePath);
      const emptyStringTest = suggestions[0]!.scenarios.find(s =>
        s.category === 'edge_case' && s.name.includes('empty string')
      );

      expect(emptyStringTest).toBeDefined();
      expect(emptyStringTest!.input).toBe('""');
    });

    it('generates zero test for number parameters', async () => {
      const func = createMockFunction({
        signature: 'function calculate(value: number): number',
      });
      const storage = createMockStorage({ functions: [func] });

      const suggestions = await suggestTests(storage, func.filePath);
      const zeroTest = suggestions[0]!.scenarios.find(s =>
        s.category === 'edge_case' && s.name.includes('zero')
      );

      expect(zeroTest).toBeDefined();
      expect(zeroTest!.input).toBe('0');
    });

    it('generates empty array test for array parameters', async () => {
      const func = createMockFunction({
        signature: 'function processItems(items: string[]): number',
      });
      const storage = createMockStorage({ functions: [func] });

      const suggestions = await suggestTests(storage, func.filePath);
      const emptyArrayTest = suggestions[0]!.scenarios.find(s =>
        s.category === 'edge_case' && s.name.includes('empty array')
      );

      expect(emptyArrayTest).toBeDefined();
      expect(emptyArrayTest!.input).toBe('[]');
    });

    it('generates null/undefined test for optional parameters', async () => {
      const func = createMockFunction({
        signature: 'function getUser(id: string, options?: UserOptions): User | null',
      });
      const storage = createMockStorage({ functions: [func] });

      const suggestions = await suggestTests(storage, func.filePath);
      const nullTest = suggestions[0]!.scenarios.find(s =>
        s.category === 'edge_case' && s.name.includes('null')
      );

      expect(nullTest).toBeDefined();
    });
  });

  describe('async scenarios', () => {
    it('generates async-specific test for async functions', async () => {
      const func = createMockFunction({
        signature: 'async function fetchData(url: string): Promise<Data>',
      });
      const storage = createMockStorage({ functions: [func] });

      const suggestions = await suggestTests(storage, func.filePath);
      const asyncTest = suggestions[0]!.scenarios.find(s => s.category === 'async');

      expect(asyncTest).toBeDefined();
      expect(asyncTest!.testCode).toContain('await');
      expect(asyncTest!.testCode).toContain('resolves');
    });

    it('generates async error test with rejects assertion', async () => {
      const func = createMockFunction({
        signature: 'async function fetchData(url: string): Promise<Data>',
        purpose: 'Fetches data and throws error on failure',
      });
      const storage = createMockStorage({ functions: [func] });

      const suggestions = await suggestTests(storage, func.filePath);
      const errorTest = suggestions[0]!.scenarios.find(s => s.category === 'error_handling');

      expect(errorTest).toBeDefined();
      expect(errorTest!.testCode).toContain('rejects.toThrow');
    });
  });

  describe('scenario limits', () => {
    it('respects maxScenariosPerFunction option', async () => {
      const func = createMockFunction({
        signature: 'function complex(a: string, b: number, c: boolean, d: object): Result',
        purpose: 'Complex function with error handling that throws on failure',
      });
      const storage = createMockStorage({ functions: [func] });

      const suggestions = await suggestTests(storage, func.filePath, undefined, { maxScenariosPerFunction: 2 });

      expect(suggestions[0]!.scenarios.length).toBeLessThanOrEqual(2);
    });
  });
});

// ============================================================================
// MOCK REQUIREMENT TESTS
// ============================================================================

describe('mock requirements', () => {
  describe('pattern-based detection', () => {
    it('suggests fetch mock for HTTP functions', async () => {
      const func = createMockFunction({
        signature: 'async function fetchUser(id: string): Promise<User>',
        purpose: 'Fetches user data from the API using fetch',
      });
      const storage = createMockStorage({ functions: [func] });

      const suggestions = await suggestTests(storage, func.filePath);
      const fetchMock = suggestions[0]!.mockRequirements.find(m =>
        m.dependency.includes('fetch')
      );

      expect(fetchMock).toBeDefined();
      expect(fetchMock!.mockType).toBe('function');
    });

    it('suggests fs mock for file system functions', async () => {
      const func = createMockFunction({
        signature: 'async function readConfig(path: string): Promise<Config>',
        purpose: 'Reads configuration from a file using fs.readFile',
      });
      const storage = createMockStorage({ functions: [func] });

      const suggestions = await suggestTests(storage, func.filePath);
      const fsMock = suggestions[0]!.mockRequirements.find(m =>
        m.dependency === 'fs'
      );

      expect(fsMock).toBeDefined();
      expect(fsMock!.mockType).toBe('module');
      expect(fsMock!.suggestion).toContain("vi.mock");
    });

    it('suggests storage mock for database functions', async () => {
      const func = createMockFunction({
        signature: 'async function saveUser(storage: UserStorage, user: User): Promise<void>',
        purpose: 'Saves user to the database storage layer',
      });
      const storage = createMockStorage({ functions: [func] });

      const suggestions = await suggestTests(storage, func.filePath);
      const storageMock = suggestions[0]!.mockRequirements.find(m =>
        m.dependency.toLowerCase().includes('storage')
      );

      expect(storageMock).toBeDefined();
    });
  });

  describe('graph-based detection', () => {
    it('identifies external dependencies from graph edges', async () => {
      const func = createMockFunction();
      const storage = createMockStorage({
        functions: [func],
        edges: [
          {
            fromId: func.id,
            toId: 'node_modules/lodash/index.js',
            edgeType: 'imports',
            fromType: 'function',
            toType: 'module',
            sourceFile: func.filePath,
            confidence: 0.9,
            computedAt: new Date(),
          } as GraphEdge,
        ],
      });

      const suggestions = await suggestTests(storage, func.filePath);

      // Should detect external dependency
      expect(suggestions[0]!.mockRequirements.some(m =>
        m.reason.includes('External dependency')
      )).toBe(true);
    });
  });

  describe('setup code generation', () => {
    it('generates setup code when mocks are needed', async () => {
      const func = createMockFunction({
        purpose: 'Fetches data from storage and processes it',
      });
      const storage = createMockStorage({ functions: [func] });

      const suggestions = await suggestTests(storage, func.filePath);

      if (suggestions[0]!.mockRequirements.length > 0) {
        expect(suggestions[0]!.setupCode).toBeDefined();
        expect(suggestions[0]!.setupCode).toContain('beforeEach');
        expect(suggestions[0]!.setupCode).toContain('afterEach');
      }
    });

    it('omits setup code when no mocks needed', async () => {
      const func = createMockFunction({
        signature: 'function add(a: number, b: number): number',
        purpose: 'Adds two numbers together',
      });
      const storage = createMockStorage({ functions: [func], edges: [] });

      const suggestions = await suggestTests(storage, func.filePath);

      // Simple math function with no dependencies
      // Should have minimal or no mock requirements
      if (suggestions[0]!.mockRequirements.length === 0) {
        expect(suggestions[0]!.setupCode).toBeUndefined();
      }
    });
  });
});

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('integration: real-world scenarios', () => {
  it('generates comprehensive tests for complex async function', async () => {
    const func = createMockFunction({
      name: 'queryLiBrainian',
      signature: 'export async function queryLiBrainian(storage: LiBrainianStorage, query: LiBrainianQuery, options?: QueryOptions): Promise<LiBrainianResponse>',
      purpose: 'Executes a query against the librainian storage database and returns relevant context packs. Throws on invalid queries.',
      startLine: 100,
      endLine: 300,
    });
    const storage = createMockStorage({
      functions: [func],
      edges: [
        { fromId: func.id, toId: 'storage', edgeType: 'calls' } as GraphEdge,
        { fromId: func.id, toId: 'database', edgeType: 'calls' } as GraphEdge,
        { fromId: func.id, toId: 'cache', edgeType: 'calls' } as GraphEdge,
      ],
    });

    const suggestions = await suggestTests(storage, func.filePath);
    const suggestion = suggestions[0]!;

    // Should be high priority
    expect(['critical', 'high']).toContain(suggestion.priority);

    // Should suggest integration tests due to storage/database in purpose
    expect(suggestion.testType).toBe('integration');

    // Should have multiple scenarios
    expect(suggestion.scenarios.length).toBeGreaterThanOrEqual(2);

    // Should have happy path
    expect(suggestion.scenarios.some(s => s.category === 'happy_path')).toBe(true);

    // Should have async test
    expect(suggestion.scenarios.some(s => s.category === 'async')).toBe(true);

    // Should have error handling (due to "throws" in purpose)
    expect(suggestion.scenarios.some(s => s.category === 'error_handling')).toBe(true);

    // Should have mock requirements
    expect(suggestion.mockRequirements.length).toBeGreaterThan(0);

    // Should have setup code
    expect(suggestion.setupCode).toBeDefined();

    // Should have rationale
    expect(suggestion.rationale).toBeTruthy();
  });

  it('handles file with multiple functions of varying complexity', async () => {
    const testFilePath = 'src/api/test.ts';
    const functions = [
      createMockFunction({
        id: '1',
        name: 'exportedAsync',
        filePath: testFilePath,
        signature: 'export async function exportedAsync(): Promise<void>',
        purpose: 'Main exported public API async function that handles errors',
        startLine: 1,
        endLine: 100,
      }),
      createMockFunction({
        id: '2',
        name: 'simpleHelper',
        filePath: testFilePath,
        signature: 'function simpleHelper(x: number): number',
        purpose: 'Simple helper that adds one',
        startLine: 101,
        endLine: 105,
      }),
      createMockFunction({
        id: '3',
        name: '_privateUtil',
        filePath: testFilePath,
        signature: 'function _privateUtil(): void',
        purpose: 'Private utility function',
        startLine: 106,
        endLine: 110,
      }),
    ];
    const storage = createMockStorage({ functions });

    const suggestions = await suggestTests(storage, testFilePath);

    // Should exclude private by default
    expect(suggestions).toHaveLength(2);

    // Should be sorted by priority
    expect(suggestions[0]!.priority).toBe('critical'); // exported with "public API" in purpose
    expect(suggestions[1]!.priority).toBe('medium'); // simple helper
  });
});
