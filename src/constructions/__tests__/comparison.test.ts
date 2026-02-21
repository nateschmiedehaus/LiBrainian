/**
 * @fileoverview Tests for Comparison Construction
 *
 * Tests the comparison module for:
 * - Intent detection (difference between, X vs Y, compare X and Y)
 * - Entity analysis and comparison
 * - Pack generation
 * - Result formatting
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  detectComparisonIntent,
  shouldUseComparisonMode,
  compareEntities,
  createComparisonPack,
  formatComparisonResult,
  findAndAnalyzeEntity,
  type ComparisonIntent,
  type ComparisonResult,
  type AnalyzedEntity,
} from '../comparison.js';
import type { LiBrainianStorage } from '../../storage/types.js';
import type { FunctionKnowledge, ModuleKnowledge } from '../../types.js';

// ============================================================================
// MOCK STORAGE
// ============================================================================

function createMockStorage(functions: FunctionKnowledge[] = [], modules: ModuleKnowledge[] = []): LiBrainianStorage {
  return {
    getFunctions: vi.fn().mockResolvedValue(functions),
    getModules: vi.fn().mockResolvedValue(modules),
    queryUniversalKnowledge: vi.fn().mockResolvedValue([]),
    // Add other required methods as stubs
    initialize: vi.fn(),
    close: vi.fn(),
    isInitialized: vi.fn().mockReturnValue(true),
    getCapabilities: vi.fn().mockReturnValue({
      core: { getFunctions: true, getFiles: true, getContextPacks: true },
      optional: {},
      versions: { schema: 1, api: 1 },
    }),
  } as unknown as LiBrainianStorage;
}

// ============================================================================
// INTENT DETECTION TESTS
// ============================================================================

describe('detectComparisonIntent', () => {
  describe('difference patterns', () => {
    it('should detect "difference between X and Y"', () => {
      const intent = detectComparisonIntent('difference between createSqliteStorage and createStorageFromBackend');
      expect(intent.isComparison).toBe(true);
      expect(intent.entityA).toBe('createSqliteStorage');
      expect(intent.entityB).toBe('createStorageFromBackend');
      expect(intent.comparisonType).toBe('difference');
      expect(intent.confidence).toBeGreaterThanOrEqual(0.9);
    });

    it('should detect "what is the difference between X and Y"', () => {
      const intent = detectComparisonIntent('what is the difference between FunctionA and FunctionB');
      expect(intent.isComparison).toBe(true);
      expect(intent.entityA).toBe('FunctionA');
      expect(intent.entityB).toBe('FunctionB');
      expect(intent.comparisonType).toBe('difference');
    });

    it('should detect "differences between X and Y"', () => {
      const intent = detectComparisonIntent('differences between ModuleA and ModuleB');
      expect(intent.isComparison).toBe(true);
      expect(intent.entityA).toBe('ModuleA');
      expect(intent.entityB).toBe('ModuleB');
      expect(intent.comparisonType).toBe('difference');
    });

    it('should detect simple "difference X Y"', () => {
      const intent = detectComparisonIntent('difference createSqliteStorage createStorageFromBackend');
      expect(intent.isComparison).toBe(true);
      expect(intent.entityA).toBe('createSqliteStorage');
      expect(intent.entityB).toBe('createStorageFromBackend');
    });
  });

  describe('versus patterns', () => {
    it('should detect "X vs Y"', () => {
      const intent = detectComparisonIntent('createSqliteStorage vs createStorageFromBackend');
      expect(intent.isComparison).toBe(true);
      expect(intent.entityA).toBe('createSqliteStorage');
      expect(intent.entityB).toBe('createStorageFromBackend');
      expect(intent.comparisonType).toBe('versus');
    });

    it('should detect "X versus Y"', () => {
      const intent = detectComparisonIntent('FunctionA versus FunctionB');
      expect(intent.isComparison).toBe(true);
      expect(intent.entityA).toBe('FunctionA');
      expect(intent.entityB).toBe('FunctionB');
      expect(intent.comparisonType).toBe('versus');
    });

    it('should detect "X vs. Y" with period', () => {
      const intent = detectComparisonIntent('ClassA vs. ClassB');
      expect(intent.isComparison).toBe(true);
      expect(intent.entityA).toBe('ClassA');
      expect(intent.entityB).toBe('ClassB');
    });
  });

  describe('compare patterns', () => {
    it('should detect "compare X and Y"', () => {
      const intent = detectComparisonIntent('compare createSqliteStorage and createStorageFromBackend');
      expect(intent.isComparison).toBe(true);
      expect(intent.entityA).toBe('createSqliteStorage');
      expect(intent.entityB).toBe('createStorageFromBackend');
      expect(intent.comparisonType).toBe('compare');
    });

    it('should detect "compare X with Y"', () => {
      const intent = detectComparisonIntent('compare FunctionA with FunctionB');
      expect(intent.isComparison).toBe(true);
      expect(intent.entityA).toBe('FunctionA');
      expect(intent.entityB).toBe('FunctionB');
      expect(intent.comparisonType).toBe('compare');
    });

    it('should detect "compare X to Y"', () => {
      const intent = detectComparisonIntent('compare ModuleA to ModuleB');
      expect(intent.isComparison).toBe(true);
      expect(intent.entityA).toBe('ModuleA');
      expect(intent.entityB).toBe('ModuleB');
    });

    it('should detect "X compared to Y"', () => {
      const intent = detectComparisonIntent('createSqliteStorage compared to createStorageFromBackend');
      expect(intent.isComparison).toBe(true);
      expect(intent.entityA).toBe('createSqliteStorage');
      expect(intent.entityB).toBe('createStorageFromBackend');
    });
  });

  describe('choice patterns', () => {
    it('should detect "which should I use, X or Y"', () => {
      const intent = detectComparisonIntent('which should I use, createSqliteStorage or createStorageFromBackend');
      expect(intent.isComparison).toBe(true);
      expect(intent.entityA).toBe('createSqliteStorage');
      expect(intent.entityB).toBe('createStorageFromBackend');
      expect(intent.comparisonType).toBe('choice');
    });

    it('should detect "when to use X vs Y"', () => {
      const intent = detectComparisonIntent('when to use FunctionA vs FunctionB');
      expect(intent.isComparison).toBe(true);
      expect(intent.entityA).toBe('FunctionA');
      expect(intent.entityB).toBe('FunctionB');
      expect(intent.comparisonType).toBe('choice');
    });
  });

  describe('similarity patterns', () => {
    it('should detect "how similar are X and Y"', () => {
      const intent = detectComparisonIntent('how similar are createSqliteStorage and createStorageFromBackend');
      expect(intent.isComparison).toBe(true);
      expect(intent.entityA).toBe('createSqliteStorage');
      expect(intent.entityB).toBe('createStorageFromBackend');
      expect(intent.comparisonType).toBe('similarity');
    });

    it('should detect "how different are X and Y"', () => {
      const intent = detectComparisonIntent('how different are ClassA and ClassB');
      expect(intent.isComparison).toBe(true);
      expect(intent.entityA).toBe('ClassA');
      expect(intent.entityB).toBe('ClassB');
    });
  });

  describe('non-comparison queries', () => {
    it('should not detect regular queries', () => {
      const intent = detectComparisonIntent('what does createSqliteStorage do');
      expect(intent.isComparison).toBe(false);
      expect(intent.entityA).toBeNull();
      expect(intent.entityB).toBeNull();
    });

    it('should not detect queries with single entity', () => {
      const intent = detectComparisonIntent('how does createSqliteStorage work');
      expect(intent.isComparison).toBe(false);
    });

    it('should handle empty query', () => {
      const intent = detectComparisonIntent('');
      expect(intent.isComparison).toBe(false);
    });

    it('should handle null-like input', () => {
      const intent = detectComparisonIntent(null as unknown as string);
      expect(intent.isComparison).toBe(false);
    });

    it('should not match short identifiers', () => {
      // Single character identifiers should be rejected
      const intent = detectComparisonIntent('difference between a and b');
      expect(intent.isComparison).toBe(false);
    });
  });
});

describe('shouldUseComparisonMode', () => {
  it('should return true for comparison queries', () => {
    expect(shouldUseComparisonMode('difference between X and Y')).toBe(false); // X and Y are too short
    expect(shouldUseComparisonMode('difference between FunctionA and FunctionB')).toBe(true);
  });

  it('should return false for non-comparison queries', () => {
    expect(shouldUseComparisonMode('what does FunctionA do')).toBe(false);
  });
});

// ============================================================================
// ENTITY ANALYSIS TESTS
// ============================================================================

describe('findAndAnalyzeEntity', () => {
  it('should find and analyze a function', async () => {
    const mockFunction: FunctionKnowledge = {
      id: 'fn:createSqliteStorage',
      name: 'createSqliteStorage',
      filePath: 'src/storage/sqlite_storage.ts',
      startLine: 6045,
      endLine: 6047,
      signature: 'function createSqliteStorage(dbPath: string, workspaceRoot?: string): LiBrainianStorage',
      purpose: 'Creates a SQLite storage instance.',
      confidence: 0.9,
      accessCount: 0,
      lastAccessed: null,
      validationCount: 0,
      outcomeHistory: { successes: 0, failures: 0 },
    };

    const storage = createMockStorage([mockFunction]);
    const entity = await findAndAnalyzeEntity('createSqliteStorage', storage);

    expect(entity).not.toBeNull();
    expect(entity!.name).toBe('createSqliteStorage');
    expect(entity!.kind).toBe('function');
    expect(entity!.filePath).toBe('src/storage/sqlite_storage.ts');
    expect(entity!.startLine).toBe(6045);
    expect(entity!.parameters).toContain('dbPath');
    expect(entity!.returnType).toBe('LiBrainianStorage');
  });

  it('should return null for non-existent entity', async () => {
    const storage = createMockStorage([]);
    const entity = await findAndAnalyzeEntity('nonExistentFunction', storage);
    expect(entity).toBeNull();
  });

  it('should handle case-insensitive matching', async () => {
    const mockFunction: FunctionKnowledge = {
      id: 'fn:MyFunction',
      name: 'MyFunction',
      filePath: 'src/test.ts',
      startLine: 1,
      endLine: 10,
      signature: 'function MyFunction(): void',
      purpose: 'Test function',
      confidence: 0.9,
      accessCount: 0,
      lastAccessed: null,
      validationCount: 0,
      outcomeHistory: { successes: 0, failures: 0 },
    };

    const storage = createMockStorage([mockFunction]);
    const entity = await findAndAnalyzeEntity('myfunction', storage);

    expect(entity).not.toBeNull();
    expect(entity!.name).toBe('MyFunction');
  });
});

// ============================================================================
// COMPARISON TESTS
// ============================================================================

describe('compareEntities', () => {
  it('should compare two functions in the same file', async () => {
    const fnA: FunctionKnowledge = {
      id: 'fn:createSqliteStorage',
      name: 'createSqliteStorage',
      filePath: 'src/storage/sqlite_storage.ts',
      startLine: 6045,
      endLine: 6047,
      signature: 'function createSqliteStorage(dbPath: string, workspaceRoot?: string): LiBrainianStorage',
      purpose: 'Creates a SQLite storage instance directly.',
      confidence: 0.9,
      accessCount: 0,
      lastAccessed: null,
      validationCount: 0,
      outcomeHistory: { successes: 0, failures: 0 },
    };

    const fnB: FunctionKnowledge = {
      id: 'fn:createStorageFromBackend',
      name: 'createStorageFromBackend',
      filePath: 'src/storage/sqlite_storage.ts',
      startLine: 6064,
      endLine: 6085,
      signature: 'async function createStorageFromBackend(backend: StorageBackend): Promise<LiBrainianStorage>',
      purpose: 'Creates storage from backend configuration.',
      confidence: 0.9,
      accessCount: 0,
      lastAccessed: null,
      validationCount: 0,
      outcomeHistory: { successes: 0, failures: 0 },
    };

    const storage = createMockStorage([fnA, fnB]);
    const intent = detectComparisonIntent('difference between createSqliteStorage and createStorageFromBackend');

    const result = await compareEntities(intent, storage);

    expect(result).not.toBeNull();
    expect(result!.entityA.name).toBe('createSqliteStorage');
    expect(result!.entityB.name).toBe('createStorageFromBackend');

    // Should find similarity - same file
    const sameFileSimilarity = result!.similarities.find(s => s.aspect === 'Location');
    expect(sameFileSimilarity).toBeDefined();

    // Should find difference - async vs sync
    const asyncDiff = result!.differences.find(d => d.aspect === 'Async behavior');
    expect(asyncDiff).toBeDefined();
    expect(asyncDiff!.significance).toBe('significant');

    // Should have a recommendation
    expect(result!.recommendation.length).toBeGreaterThan(0);

    // Should have a summary
    expect(result!.summary.length).toBeGreaterThan(0);
  });

  it('should return null for non-comparison intent', async () => {
    const storage = createMockStorage([]);
    const intent = detectComparisonIntent('what does X do');
    const result = await compareEntities(intent, storage);
    expect(result).toBeNull();
  });

  it('should return null when entities not found', async () => {
    const storage = createMockStorage([]);
    const intent = detectComparisonIntent('difference between NonExistentA and NonExistentB');
    const result = await compareEntities(intent, storage);
    expect(result).toBeNull();
  });
});

// ============================================================================
// PACK GENERATION TESTS
// ============================================================================

describe('createComparisonPack', () => {
  it('should create a valid context pack', () => {
    const result: ComparisonResult = {
      entityA: {
        name: 'createSqliteStorage',
        kind: 'function',
        filePath: 'src/storage/sqlite_storage.ts',
        startLine: 6045,
        endLine: 6047,
        isAsync: false,
        parameters: ['dbPath', 'workspaceRoot'],
        returnType: 'LiBrainianStorage',
      },
      entityB: {
        name: 'createStorageFromBackend',
        kind: 'function',
        filePath: 'src/storage/sqlite_storage.ts',
        startLine: 6064,
        endLine: 6085,
        isAsync: true,
        parameters: ['backend'],
        returnType: 'Promise<LiBrainianStorage>',
      },
      similarities: [
        { aspect: 'Location', description: 'Both in same file' },
        { aspect: 'Type', description: 'Both are functions' },
      ],
      differences: [
        {
          aspect: 'Async behavior',
          entityADescription: 'Synchronous function',
          entityBDescription: 'Asynchronous function',
          significance: 'significant',
        },
        {
          aspect: 'Parameters',
          entityADescription: 'Takes 2 parameters',
          entityBDescription: 'Takes 1 parameter',
          significance: 'moderate',
        },
      ],
      recommendation: 'Use createSqliteStorage for simple cases. Use createStorageFromBackend for config-based setup.',
      summary: 'Both are functions in the same file with 2 similarities and 2 differences.',
      confidence: 0.85,
    };

    const intent = detectComparisonIntent('difference between createSqliteStorage and createStorageFromBackend');
    const pack = createComparisonPack(result, intent);

    expect(pack.packId).toBe('comparison:createSqliteStorage_vs_createStorageFromBackend');
    expect(pack.packType).toBe('decision_context');
    expect(pack.summary).toBe(result.summary);
    expect(pack.keyFacts.length).toBeGreaterThan(0);
    expect(pack.relatedFiles).toContain('src/storage/sqlite_storage.ts');
    expect(pack.confidence).toBe(0.85);
    expect(pack.invalidationTriggers).toContain('src/storage/sqlite_storage.ts');
  });

  it('should include key differences in keyFacts', () => {
    const result: ComparisonResult = {
      entityA: {
        name: 'FunctionA',
        kind: 'function',
        filePath: 'src/a.ts',
        startLine: 1,
      },
      entityB: {
        name: 'FunctionB',
        kind: 'function',
        filePath: 'src/b.ts',
        startLine: 1,
      },
      similarities: [],
      differences: [
        {
          aspect: 'Return type',
          entityADescription: 'Returns string',
          entityBDescription: 'Returns number',
          significance: 'significant',
        },
      ],
      recommendation: 'Choose based on return type needs.',
      summary: 'Two functions in different files.',
      confidence: 0.7,
    };

    const intent = detectComparisonIntent('FunctionA vs FunctionB');
    const pack = createComparisonPack(result, intent);

    const hasReturnTypeFact = pack.keyFacts.some(f => f.includes('Return type'));
    expect(hasReturnTypeFact).toBe(true);
  });
});

// ============================================================================
// FORMATTING TESTS
// ============================================================================

describe('formatComparisonResult', () => {
  it('should format comparison result as readable string', () => {
    const result: ComparisonResult = {
      entityA: {
        name: 'createSqliteStorage',
        kind: 'function',
        filePath: 'src/storage/sqlite_storage.ts',
        startLine: 6045,
        endLine: 6047,
        signature: 'function createSqliteStorage(dbPath: string): LiBrainianStorage',
        purpose: 'Creates SQLite storage directly.',
      },
      entityB: {
        name: 'createStorageFromBackend',
        kind: 'function',
        filePath: 'src/storage/sqlite_storage.ts',
        startLine: 6064,
        endLine: 6085,
        signature: 'async function createStorageFromBackend(backend: StorageBackend): Promise<LiBrainianStorage>',
        purpose: 'Creates storage from configuration.',
      },
      similarities: [
        { aspect: 'Location', description: 'Both in src/storage/sqlite_storage.ts' },
      ],
      differences: [
        {
          aspect: 'Async behavior',
          entityADescription: 'Synchronous',
          entityBDescription: 'Asynchronous',
          significance: 'significant',
        },
      ],
      recommendation: 'Use createSqliteStorage for simple cases.',
      summary: 'Both functions in same file.',
      confidence: 0.85,
    };

    const formatted = formatComparisonResult(result);

    expect(formatted).toContain('Comparison: createSqliteStorage vs createStorageFromBackend');
    expect(formatted).toContain('Kind: function');
    expect(formatted).toContain('Similarities');
    expect(formatted).toContain('Differences');
    expect(formatted).toContain('Recommendation');
    expect(formatted).toContain('85%');
  });
});

// ============================================================================
// EDGE CASES
// ============================================================================

describe('edge cases', () => {
  it('should handle entities with minimal information', async () => {
    const fnA: FunctionKnowledge = {
      id: 'fn:minimalA',
      name: 'minimalA',
      filePath: 'src/a.ts',
      startLine: 1,
      endLine: 1,
      signature: '',
      purpose: '',
      confidence: 0.5,
      accessCount: 0,
      lastAccessed: null,
      validationCount: 0,
      outcomeHistory: { successes: 0, failures: 0 },
    };

    const fnB: FunctionKnowledge = {
      id: 'fn:minimalB',
      name: 'minimalB',
      filePath: 'src/b.ts',
      startLine: 1,
      endLine: 1,
      signature: '',
      purpose: '',
      confidence: 0.5,
      accessCount: 0,
      lastAccessed: null,
      validationCount: 0,
      outcomeHistory: { successes: 0, failures: 0 },
    };

    const storage = createMockStorage([fnA, fnB]);
    const intent = detectComparisonIntent('minimalA vs minimalB');
    const result = await compareEntities(intent, storage);

    expect(result).not.toBeNull();
    expect(result!.entityA.name).toBe('minimalA');
    expect(result!.entityB.name).toBe('minimalB');
    // Should still generate a valid comparison even with minimal data
    expect(result!.summary.length).toBeGreaterThan(0);
    expect(result!.recommendation.length).toBeGreaterThan(0);
  });

  it('should handle async function signatures correctly', () => {
    const intent = detectComparisonIntent('asyncFunc vs syncFunc');
    expect(intent.isComparison).toBe(true);
  });

  it('should detect comparison with complex names', () => {
    const intent = detectComparisonIntent('difference between SqliteLiBrainianStorage and PostgresLiBrainianStorage');
    expect(intent.isComparison).toBe(true);
    expect(intent.entityA).toBe('SqliteLiBrainianStorage');
    expect(intent.entityB).toBe('PostgresLiBrainianStorage');
  });

  it('should handle underscore names', () => {
    const intent = detectComparisonIntent('compare create_storage and create_backend');
    expect(intent.isComparison).toBe(true);
    expect(intent.entityA).toBe('create_storage');
    expect(intent.entityB).toBe('create_backend');
  });
});

// ============================================================================
// SEMANTIC/BEHAVIORAL DIFFERENCE ANALYSIS TESTS
// ============================================================================

import {
  analyzeSemanticDifferences,
  generateUnifiedDiff,
  formatUnifiedDiff,
  longestCommonSubsequence,
  compareModules,
  formatModuleComparison,
  type BehavioralDifference,
  type CodeDiff,
  type ModuleComparison,
} from '../comparison.js';

describe('analyzeSemanticDifferences', () => {
  describe('error handling detection', () => {
    it('should detect try/catch difference', () => {
      const codeA = 'function foo() { try { doSomething(); } catch (e) { handle(e); } }';
      const codeB = 'function foo() { doSomething(); }';

      const diffs = analyzeSemanticDifferences(codeA, codeB);

      expect(diffs).toContainEqual(expect.objectContaining({
        aspect: 'error_handling',
        entityA: 'has try/catch',
        entityB: 'no error handling',
      }));
    });

    it('should detect .catch() promise handling', () => {
      const codeA = 'fetch(url).catch(handleError)';
      const codeB = 'fetch(url)';

      const diffs = analyzeSemanticDifferences(codeA, codeB);

      expect(diffs.some(d => d.aspect === 'error_handling')).toBe(true);
    });

    it('should not report difference when both have error handling', () => {
      const codeA = 'try { a(); } catch (e) {}';
      const codeB = 'try { b(); } catch (e) {}';

      const diffs = analyzeSemanticDifferences(codeA, codeB);

      expect(diffs.some(d => d.aspect === 'error_handling')).toBe(false);
    });
  });

  describe('caching detection', () => {
    it('should detect caching difference', () => {
      const codeA = 'const cache = new Map(); function get(key) { if (cache.has(key)) return cache.get(key); }';
      const codeB = 'function get(key) { return fetchFromDb(key); }';

      const diffs = analyzeSemanticDifferences(codeA, codeB);

      expect(diffs).toContainEqual(expect.objectContaining({
        aspect: 'caching',
        entityA: 'implements caching',
        entityB: 'no caching',
      }));
    });

    it('should detect memoize pattern', () => {
      const codeA = 'const memoizedFn = memoize(expensiveOp)';
      const codeB = 'const result = expensiveOp()';

      const diffs = analyzeSemanticDifferences(codeA, codeB);

      expect(diffs.some(d => d.aspect === 'caching')).toBe(true);
    });
  });

  describe('validation detection', () => {
    it('should detect validation difference', () => {
      const codeA = 'function process(input) { if (!input) throw new Error("invalid"); return transform(input); }';
      const codeB = 'function process(input) { return transform(input); }';

      const diffs = analyzeSemanticDifferences(codeA, codeB);

      expect(diffs).toContainEqual(expect.objectContaining({
        aspect: 'validation',
        entityA: 'validates input',
        entityB: 'no validation',
      }));
    });

    it('should detect assert pattern', () => {
      const codeA = 'assert(value > 0)';
      const codeB = 'return value';

      const diffs = analyzeSemanticDifferences(codeA, codeB);

      expect(diffs.some(d => d.aspect === 'validation')).toBe(true);
    });
  });

  describe('logging detection', () => {
    it('should detect logging difference', () => {
      const codeA = 'function save(data) { console.log("Saving:", data); db.save(data); }';
      const codeB = 'function save(data) { db.save(data); }';

      const diffs = analyzeSemanticDifferences(codeA, codeB);

      expect(diffs).toContainEqual(expect.objectContaining({
        aspect: 'logging',
        entityA: 'has logging',
        entityB: 'no logging',
      }));
    });

    it('should detect logger instance usage', () => {
      const codeA = 'logger.info("Processing request")';
      const codeB = 'processRequest()';

      const diffs = analyzeSemanticDifferences(codeA, codeB);

      expect(diffs.some(d => d.aspect === 'logging')).toBe(true);
    });
  });

  describe('async detection', () => {
    it('should detect async/await difference', () => {
      const codeA = 'async function fetchData() { const data = await api.get(); return data; }';
      const codeB = 'function getData() { return cache.get(); }';

      const diffs = analyzeSemanticDifferences(codeA, codeB);

      expect(diffs).toContainEqual(expect.objectContaining({
        aspect: 'async',
        entityA: 'asynchronous',
        entityB: 'synchronous',
      }));
    });

    it('should detect Promise usage', () => {
      const codeA = 'return new Promise((resolve) => resolve(42))';
      const codeB = 'return 42';

      const diffs = analyzeSemanticDifferences(codeA, codeB);

      expect(diffs.some(d => d.aspect === 'async')).toBe(true);
    });

    it('should detect .then() chain', () => {
      const codeA = 'fetch(url).then(r => r.json())';
      const codeB = 'JSON.parse(data)';

      const diffs = analyzeSemanticDifferences(codeA, codeB);

      expect(diffs.some(d => d.aspect === 'async')).toBe(true);
    });
  });

  describe('null safety detection', () => {
    it('should detect optional chaining difference', () => {
      const codeA = 'const name = user?.profile?.name';
      const codeB = 'const name = user.profile.name';

      const diffs = analyzeSemanticDifferences(codeA, codeB);

      expect(diffs).toContainEqual(expect.objectContaining({
        aspect: 'null_safety',
        entityA: 'null-safe',
        entityB: 'no null checks',
      }));
    });

    it('should detect nullish coalescing', () => {
      const codeA = 'const value = input ?? defaultValue';
      const codeB = 'const value = input';

      const diffs = analyzeSemanticDifferences(codeA, codeB);

      expect(diffs.some(d => d.aspect === 'null_safety')).toBe(true);
    });
  });

  describe('resilience detection', () => {
    it('should detect retry logic', () => {
      const codeA = 'async function withRetry() { for (let i = 0; i < 3; i++) { try { return await api.call(); } catch { await backoff(i); } } }';
      const codeB = 'async function simple() { return await api.call(); }';

      const diffs = analyzeSemanticDifferences(codeA, codeB);

      expect(diffs).toContainEqual(expect.objectContaining({
        aspect: 'resilience',
        entityA: 'has retry/resilience',
        entityB: 'no retry logic',
      }));
    });
  });

  describe('timeout detection', () => {
    it('should detect timeout handling', () => {
      const codeA = 'const controller = new AbortController(); setTimeout(() => controller.abort(), timeout);';
      const codeB = 'await fetch(url)';

      const diffs = analyzeSemanticDifferences(codeA, codeB);

      expect(diffs).toContainEqual(expect.objectContaining({
        aspect: 'timeout',
        entityA: 'has timeout handling',
        entityB: 'no timeout',
      }));
    });
  });

  describe('multiple differences', () => {
    it('should detect multiple behavioral differences', () => {
      const codeA = `
        async function robustFetch(url) {
          try {
            const cached = cache.get(url);
            if (cached) return cached;
            console.log('Fetching:', url);
            const data = await fetch(url);
            cache.set(url, data);
            return data;
          } catch (e) {
            logger.error(e);
            throw e;
          }
        }
      `;
      const codeB = `
        function simpleFetch(url) {
          return fetch(url);
        }
      `;

      const diffs = analyzeSemanticDifferences(codeA, codeB);

      // Should detect: error_handling, caching, logging, async
      expect(diffs.length).toBeGreaterThanOrEqual(3);
      expect(diffs.some(d => d.aspect === 'error_handling')).toBe(true);
      expect(diffs.some(d => d.aspect === 'caching')).toBe(true);
      expect(diffs.some(d => d.aspect === 'logging')).toBe(true);
    });
  });

  describe('no differences', () => {
    it('should return empty array for identical behavior patterns', () => {
      const codeA = 'async function a() { try { await x(); } catch (e) { log(e); } }';
      const codeB = 'async function b() { try { await y(); } catch (e) { log(e); } }';

      const diffs = analyzeSemanticDifferences(codeA, codeB);

      expect(diffs.length).toBe(0);
    });
  });
});

// ============================================================================
// CODE DIFFING TESTS
// ============================================================================

describe('longestCommonSubsequence', () => {
  it('should find LCS of identical arrays', () => {
    const a = ['line1', 'line2', 'line3'];
    const b = ['line1', 'line2', 'line3'];

    const lcs = longestCommonSubsequence(a, b);

    expect(lcs).toEqual(['line1', 'line2', 'line3']);
  });

  it('should find LCS of completely different arrays', () => {
    const a = ['a', 'b', 'c'];
    const b = ['x', 'y', 'z'];

    const lcs = longestCommonSubsequence(a, b);

    expect(lcs).toEqual([]);
  });

  it('should find LCS with partial overlap', () => {
    const a = ['a', 'b', 'c', 'd'];
    const b = ['x', 'b', 'c', 'y'];

    const lcs = longestCommonSubsequence(a, b);

    expect(lcs).toEqual(['b', 'c']);
  });

  it('should handle empty arrays', () => {
    expect(longestCommonSubsequence([], ['a', 'b'])).toEqual([]);
    expect(longestCommonSubsequence(['a', 'b'], [])).toEqual([]);
    expect(longestCommonSubsequence([], [])).toEqual([]);
  });

  it('should find LCS in classic example', () => {
    const a = ['A', 'G', 'C', 'A', 'T'];
    const b = ['G', 'A', 'C'];

    const lcs = longestCommonSubsequence(a, b);

    // Multiple valid LCS exist: ['G', 'C'], ['G', 'A'], ['A', 'C']
    expect(lcs.length).toBe(2);
  });
});

describe('generateUnifiedDiff', () => {
  it('should produce no changes for identical code', () => {
    const code = 'function foo() {\n  return 1;\n}';

    const diff = generateUnifiedDiff(code, code);

    expect(diff.additions).toBe(0);
    expect(diff.deletions).toBe(0);
    expect(diff.changes).toBe(0);
  });

  it('should detect single line change', () => {
    const codeA = 'function foo() {\n  return 1;\n}';
    const codeB = 'function foo() {\n  return 2;\n}';

    const diff = generateUnifiedDiff(codeA, codeB);

    expect(diff.additions).toBe(1);
    expect(diff.deletions).toBe(1);
    expect(diff.changes).toBe(2);
  });

  it('should detect added lines', () => {
    const codeA = 'line1\nline2';
    const codeB = 'line1\nline2\nline3';

    const diff = generateUnifiedDiff(codeA, codeB);

    expect(diff.additions).toBe(1);
    expect(diff.deletions).toBe(0);
    expect(diff.changes).toBe(1);
  });

  it('should detect deleted lines', () => {
    const codeA = 'line1\nline2\nline3';
    const codeB = 'line1\nline2';

    const diff = generateUnifiedDiff(codeA, codeB);

    expect(diff.additions).toBe(0);
    expect(diff.deletions).toBe(1);
    expect(diff.changes).toBe(1);
  });

  it('should track line numbers correctly', () => {
    const codeA = 'a\nb\nc';
    const codeB = 'a\nx\nc';

    const diff = generateUnifiedDiff(codeA, codeB);

    const contextLines = diff.hunks[0].lines.filter(l => l.type === 'context');
    const addLines = diff.hunks[0].lines.filter(l => l.type === 'add');
    const deleteLines = diff.hunks[0].lines.filter(l => l.type === 'delete');

    // Context lines should have both line numbers
    expect(contextLines.every(l => l.oldLineNumber !== undefined && l.newLineNumber !== undefined)).toBe(true);

    // Add lines should have only new line number
    expect(addLines.every(l => l.newLineNumber !== undefined)).toBe(true);

    // Delete lines should have only old line number
    expect(deleteLines.every(l => l.oldLineNumber !== undefined)).toBe(true);
  });

  it('should handle complete rewrite', () => {
    const codeA = 'old1\nold2\nold3';
    const codeB = 'new1\nnew2\nnew3';

    const diff = generateUnifiedDiff(codeA, codeB);

    expect(diff.additions).toBe(3);
    expect(diff.deletions).toBe(3);
    expect(diff.changes).toBe(6);
  });

  it('should handle empty strings', () => {
    expect(generateUnifiedDiff('', '').changes).toBe(0);
    expect(generateUnifiedDiff('line', '').deletions).toBe(1);
    expect(generateUnifiedDiff('', 'line').additions).toBe(1);
  });
});

describe('formatUnifiedDiff', () => {
  it('should format diff with standard headers', () => {
    const codeA = 'old line';
    const codeB = 'new line';
    const diff = generateUnifiedDiff(codeA, codeB);

    const formatted = formatUnifiedDiff(diff, 'file_a.ts', 'file_b.ts');

    expect(formatted).toContain('--- file_a.ts');
    expect(formatted).toContain('+++ file_b.ts');
  });

  it('should format hunk headers correctly', () => {
    const codeA = 'line1\nline2';
    const codeB = 'line1\nline2\nline3';
    const diff = generateUnifiedDiff(codeA, codeB);

    const formatted = formatUnifiedDiff(diff);

    expect(formatted).toMatch(/@@ -\d+,\d+ \+\d+,\d+ @@/);
  });

  it('should use +/- prefixes for changes', () => {
    const codeA = 'delete me';
    const codeB = 'add me';
    const diff = generateUnifiedDiff(codeA, codeB);

    const formatted = formatUnifiedDiff(diff);

    expect(formatted).toContain('-delete me');
    expect(formatted).toContain('+add me');
  });

  it('should use space prefix for context lines', () => {
    const codeA = 'same\ndifferent\nsame';
    const codeB = 'same\nchanged\nsame';
    const diff = generateUnifiedDiff(codeA, codeB);

    const formatted = formatUnifiedDiff(diff);
    const lines = formatted.split('\n');

    // Context lines should start with space
    const contextLines = lines.filter(l => l.startsWith(' '));
    expect(contextLines.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// MODULE COMPARISON TESTS
// ============================================================================

function createMockStorageWithFunctions(
  functions: FunctionKnowledge[]
): LiBrainianStorage {
  return {
    getFunctions: vi.fn().mockResolvedValue(functions),
    getFunctionsByPath: vi.fn().mockImplementation(async (path: string) => {
      return functions.filter(fn => fn.filePath === path);
    }),
    getModules: vi.fn().mockResolvedValue([]),
    queryUniversalKnowledge: vi.fn().mockResolvedValue([]),
    initialize: vi.fn(),
    close: vi.fn(),
    isInitialized: vi.fn().mockReturnValue(true),
    getCapabilities: vi.fn().mockReturnValue({
      core: { getFunctions: true, getFiles: true, getContextPacks: true },
      optional: {},
      versions: { schema: 1, api: 1 },
    }),
  } as unknown as LiBrainianStorage;
}

describe('compareModules', () => {
  it('should identify common exports', async () => {
    const functions: FunctionKnowledge[] = [
      {
        id: 'fn:a:createStorage',
        name: 'createStorage',
        filePath: 'src/storage/sqlite.ts',
        startLine: 1,
        endLine: 10,
        signature: 'function createStorage(): Storage',
        purpose: 'Create storage',
        confidence: 0.9,
        accessCount: 0,
        lastAccessed: null,
        validationCount: 0,
        outcomeHistory: { successes: 0, failures: 0 },
      },
      {
        id: 'fn:a:closeStorage',
        name: 'closeStorage',
        filePath: 'src/storage/sqlite.ts',
        startLine: 15,
        endLine: 20,
        signature: 'function closeStorage(): void',
        purpose: 'Close storage',
        confidence: 0.9,
        accessCount: 0,
        lastAccessed: null,
        validationCount: 0,
        outcomeHistory: { successes: 0, failures: 0 },
      },
      {
        id: 'fn:b:createStorage',
        name: 'createStorage',
        filePath: 'src/storage/postgres.ts',
        startLine: 1,
        endLine: 15,
        signature: 'function createStorage(config: Config): Storage',
        purpose: 'Create storage',
        confidence: 0.9,
        accessCount: 0,
        lastAccessed: null,
        validationCount: 0,
        outcomeHistory: { successes: 0, failures: 0 },
      },
      {
        id: 'fn:b:migrate',
        name: 'migrate',
        filePath: 'src/storage/postgres.ts',
        startLine: 20,
        endLine: 30,
        signature: 'function migrate(): Promise<void>',
        purpose: 'Run migrations',
        confidence: 0.9,
        accessCount: 0,
        lastAccessed: null,
        validationCount: 0,
        outcomeHistory: { successes: 0, failures: 0 },
      },
    ];

    const storage = createMockStorageWithFunctions(functions);

    const comparison = await compareModules(
      storage,
      'src/storage/sqlite.ts',
      'src/storage/postgres.ts'
    );

    expect(comparison.commonExports).toContain('createStorage');
    expect(comparison.uniqueToA).toContain('closeStorage');
    expect(comparison.uniqueToB).toContain('migrate');
  });

  it('should detect changed signatures', async () => {
    const functions: FunctionKnowledge[] = [
      {
        id: 'fn:a:process',
        name: 'process',
        filePath: 'src/moduleA.ts',
        startLine: 1,
        endLine: 10,
        signature: 'function process(input: string): string',
        purpose: 'Process input',
        confidence: 0.9,
        accessCount: 0,
        lastAccessed: null,
        validationCount: 0,
        outcomeHistory: { successes: 0, failures: 0 },
      },
      {
        id: 'fn:b:process',
        name: 'process',
        filePath: 'src/moduleB.ts',
        startLine: 1,
        endLine: 15,
        signature: 'async function process(input: string, options?: Options): Promise<string>',
        purpose: 'Process input',
        confidence: 0.9,
        accessCount: 0,
        lastAccessed: null,
        validationCount: 0,
        outcomeHistory: { successes: 0, failures: 0 },
      },
    ];

    const storage = createMockStorageWithFunctions(functions);

    const comparison = await compareModules(
      storage,
      'src/moduleA.ts',
      'src/moduleB.ts'
    );

    expect(comparison.changedSignatures.length).toBe(1);
    expect(comparison.changedSignatures[0].name).toBe('process');
    expect(comparison.changedSignatures[0].signatureA).toContain('string');
    expect(comparison.changedSignatures[0].signatureB).toContain('Promise');
  });

  it('should calculate structural similarity correctly', async () => {
    // Identical modules
    const functions: FunctionKnowledge[] = [
      {
        id: 'fn:a:foo',
        name: 'foo',
        filePath: 'src/a.ts',
        startLine: 1,
        endLine: 5,
        signature: 'function foo(): void',
        purpose: '',
        confidence: 0.9,
        accessCount: 0,
        lastAccessed: null,
        validationCount: 0,
        outcomeHistory: { successes: 0, failures: 0 },
      },
      {
        id: 'fn:a:bar',
        name: 'bar',
        filePath: 'src/a.ts',
        startLine: 10,
        endLine: 15,
        signature: 'function bar(): void',
        purpose: '',
        confidence: 0.9,
        accessCount: 0,
        lastAccessed: null,
        validationCount: 0,
        outcomeHistory: { successes: 0, failures: 0 },
      },
      {
        id: 'fn:b:foo',
        name: 'foo',
        filePath: 'src/b.ts',
        startLine: 1,
        endLine: 5,
        signature: 'function foo(): void',
        purpose: '',
        confidence: 0.9,
        accessCount: 0,
        lastAccessed: null,
        validationCount: 0,
        outcomeHistory: { successes: 0, failures: 0 },
      },
      {
        id: 'fn:b:bar',
        name: 'bar',
        filePath: 'src/b.ts',
        startLine: 10,
        endLine: 15,
        signature: 'function bar(): void',
        purpose: '',
        confidence: 0.9,
        accessCount: 0,
        lastAccessed: null,
        validationCount: 0,
        outcomeHistory: { successes: 0, failures: 0 },
      },
    ];

    const storage = createMockStorageWithFunctions(functions);

    const comparison = await compareModules(storage, 'src/a.ts', 'src/b.ts');

    // Both have foo and bar, so 100% similarity
    expect(comparison.structuralSimilarity).toBe(1);
  });

  it('should handle empty modules', async () => {
    const storage = createMockStorageWithFunctions([]);

    const comparison = await compareModules(
      storage,
      'src/empty1.ts',
      'src/empty2.ts'
    );

    expect(comparison.commonExports).toEqual([]);
    expect(comparison.uniqueToA).toEqual([]);
    expect(comparison.uniqueToB).toEqual([]);
    expect(comparison.structuralSimilarity).toBe(0);
  });

  it('should generate meaningful summary', async () => {
    const functions: FunctionKnowledge[] = [
      {
        id: 'fn:a:shared',
        name: 'shared',
        filePath: 'src/a.ts',
        startLine: 1,
        endLine: 5,
        signature: 'function shared(): void',
        purpose: '',
        confidence: 0.9,
        accessCount: 0,
        lastAccessed: null,
        validationCount: 0,
        outcomeHistory: { successes: 0, failures: 0 },
      },
      {
        id: 'fn:a:onlyA',
        name: 'onlyA',
        filePath: 'src/a.ts',
        startLine: 10,
        endLine: 15,
        signature: 'function onlyA(): void',
        purpose: '',
        confidence: 0.9,
        accessCount: 0,
        lastAccessed: null,
        validationCount: 0,
        outcomeHistory: { successes: 0, failures: 0 },
      },
      {
        id: 'fn:b:shared',
        name: 'shared',
        filePath: 'src/b.ts',
        startLine: 1,
        endLine: 5,
        signature: 'function shared(): void',
        purpose: '',
        confidence: 0.9,
        accessCount: 0,
        lastAccessed: null,
        validationCount: 0,
        outcomeHistory: { successes: 0, failures: 0 },
      },
    ];

    const storage = createMockStorageWithFunctions(functions);

    const comparison = await compareModules(storage, 'src/a.ts', 'src/b.ts');

    expect(comparison.summary).toContain('Common exports: 1');
    expect(comparison.summary).toContain('Unique to A: 1');
    expect(comparison.summary).toContain('Structural similarity:');
  });
});

describe('formatModuleComparison', () => {
  it('should format comparison result', () => {
    const comparison: ModuleComparison = {
      moduleA: 'src/storage/sqlite.ts',
      moduleB: 'src/storage/postgres.ts',
      commonExports: ['createStorage', 'closeStorage'],
      uniqueToA: ['vacuum'],
      uniqueToB: ['migrate', 'replicate'],
      changedSignatures: [
        {
          name: 'createStorage',
          signatureA: 'function createStorage(): Storage',
          signatureB: 'function createStorage(config: Config): Storage',
          diff: 'Different parameter count',
        },
      ],
      structuralSimilarity: 0.66,
      summary: 'Module comparison summary',
    };

    const formatted = formatModuleComparison(comparison);

    expect(formatted).toContain('Module A: src/storage/sqlite.ts');
    expect(formatted).toContain('Module B: src/storage/postgres.ts');
    expect(formatted).toContain('Structural Similarity: 66.0%');
    expect(formatted).toContain('Common Exports');
    expect(formatted).toContain('createStorage');
    expect(formatted).toContain('Only in Module A');
    expect(formatted).toContain('vacuum');
    expect(formatted).toContain('Only in Module B');
    expect(formatted).toContain('migrate');
    expect(formatted).toContain('Changed Signatures');
  });

  it('should handle empty sections gracefully', () => {
    const comparison: ModuleComparison = {
      moduleA: 'src/a.ts',
      moduleB: 'src/b.ts',
      commonExports: [],
      uniqueToA: [],
      uniqueToB: [],
      changedSignatures: [],
      structuralSimilarity: 0,
      summary: 'No overlap',
    };

    const formatted = formatModuleComparison(comparison);

    expect(formatted).toContain('Module A: src/a.ts');
    expect(formatted).toContain('Module B: src/b.ts');
    expect(formatted).toContain('Structural Similarity: 0.0%');
    // Should not contain section headers for empty sections
    expect(formatted).not.toContain('Common Exports');
  });
});
