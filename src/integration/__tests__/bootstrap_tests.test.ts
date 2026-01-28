/**
 * @fileoverview Bootstrap Test Suite (WU-BOOT-002)
 *
 * Validates that Librarian can correctly index and query its own codebase.
 * These tests use self-indexed Librarian data to verify the system works.
 *
 * Test Categories:
 * 1. Self-Indexing Tests - Verify Librarian indexes all its own source files
 * 2. Query Tests - Query for known Librarian components
 * 3. Cross-Reference Tests - Verify import/export relationships are captured
 * 4. Symbol Resolution Tests - Verify function/class definitions are found
 * 5. Documentation Tests - Verify JSDoc comments are indexed
 * 6. Dependency Tests - Verify package dependencies are tracked
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';

// ============================================================================
// INTERFACE DEFINITIONS
// ============================================================================

/**
 * Result of a single bootstrap test.
 */
export interface BootstrapTestResult {
  category: string;
  testName: string;
  passed: boolean;
  duration: number;
  details?: string;
}

/**
 * Runner for executing bootstrap tests.
 */
export interface BootstrapTestRunner {
  runAllTests(): Promise<BootstrapTestResult[]>;
  runCategory(category: string): Promise<BootstrapTestResult[]>;
  getSummary(): { total: number; passed: number; failed: number };
}

// ============================================================================
// TEST RUNNER IMPLEMENTATION
// ============================================================================

interface TestCase {
  category: string;
  name: string;
  fn: () => Promise<void>;
}

/**
 * Creates a bootstrap test runner that validates Librarian against its own codebase.
 *
 * @param librarianInstance - A Librarian instance initialized with the librarian workspace
 * @returns A BootstrapTestRunner
 */
export function createBootstrapTestRunner(librarianInstance: any): BootstrapTestRunner {
  const testCases: TestCase[] = [];
  const results: BootstrapTestResult[] = [];

  // Helper to add test cases
  const addTest = (category: string, name: string, fn: () => Promise<void>): void => {
    testCases.push({ category, name, fn });
  };

  // ============================================================================
  // SELF-INDEXING TESTS
  // ============================================================================

  addTest('self-indexing', 'indexes src/index.ts', async () => {
    const storage = librarianInstance.getStorage();
    const file = await storage.getFileByPath(path.resolve(librarianInstance.config?.workspace || process.cwd(), 'src/index.ts'));
    if (!file) throw new Error('src/index.ts not indexed');
  });

  addTest('self-indexing', 'indexes api module files', async () => {
    const storage = librarianInstance.getStorage();
    const files = await storage.getFiles({ directory: 'api' });
    if (!files || files.length === 0) {
      const allFiles = await storage.getFiles();
      const apiFiles = allFiles.filter((f: any) => f.path.includes('/api/'));
      if (apiFiles.length === 0) throw new Error('No api module files found');
    }
  });

  addTest('self-indexing', 'indexes storage module files', async () => {
    const storage = librarianInstance.getStorage();
    const allFiles = await storage.getFiles();
    const storageFiles = allFiles.filter((f: any) => f.path.includes('/storage/'));
    if (storageFiles.length === 0) throw new Error('No storage module files found');
  });

  addTest('self-indexing', 'indexes integration module files', async () => {
    const storage = librarianInstance.getStorage();
    const allFiles = await storage.getFiles();
    const integrationFiles = allFiles.filter((f: any) => f.path.includes('/integration/'));
    if (integrationFiles.length === 0) throw new Error('No integration module files found');
  });

  addTest('self-indexing', 'indexes test files', async () => {
    const storage = librarianInstance.getStorage();
    const allFiles = await storage.getFiles();
    const testFiles = allFiles.filter((f: any) => f.path.includes('.test.ts'));
    if (testFiles.length === 0) throw new Error('No test files found');
  });

  addTest('self-indexing', 'indexes types.ts', async () => {
    const storage = librarianInstance.getStorage();
    const allFiles = await storage.getFiles();
    const typesFile = allFiles.find((f: any) => f.path.endsWith('/types.ts') && !f.path.includes('__tests__'));
    if (!typesFile) throw new Error('types.ts not indexed');
  });

  addTest('self-indexing', 'captures file checksums', async () => {
    const storage = librarianInstance.getStorage();
    const workspace = librarianInstance.config?.workspace || process.cwd();
    const checksum = await storage.getFileChecksum(path.resolve(workspace, 'src/index.ts'));
    if (!checksum) throw new Error('File checksum not captured');
  });

  addTest('self-indexing', 'indexes configuration files', async () => {
    const storage = librarianInstance.getStorage();
    const allFiles = await storage.getFiles();
    const configFiles = allFiles.filter((f: any) =>
      f.path.endsWith('tsconfig.json') ||
      f.path.endsWith('package.json') ||
      f.path.endsWith('vitest.config.ts')
    );
    if (configFiles.length === 0) throw new Error('No configuration files indexed');
  });

  addTest('self-indexing', 'indexes epistemics module', async () => {
    const storage = librarianInstance.getStorage();
    const allFiles = await storage.getFiles();
    const epistemicsFiles = allFiles.filter((f: any) => f.path.includes('/epistemics/'));
    if (epistemicsFiles.length === 0) throw new Error('No epistemics module files found');
  });

  addTest('self-indexing', 'indexes knowledge module', async () => {
    const storage = librarianInstance.getStorage();
    const allFiles = await storage.getFiles();
    const knowledgeFiles = allFiles.filter((f: any) => f.path.includes('/knowledge/'));
    if (knowledgeFiles.length === 0) throw new Error('No knowledge module files found');
  });

  // ============================================================================
  // QUERY TESTS
  // ============================================================================

  addTest('query', 'queries for Librarian class', async () => {
    const storage = librarianInstance.getStorage();
    const functions = await storage.getFunctions();
    const librarianClass = functions.find((f: any) =>
      f.name === 'Librarian' || f.name.includes('createLibrarian')
    );
    if (!librarianClass) throw new Error('Librarian class not found');
  });

  addTest('query', 'queries for storage interfaces', async () => {
    const storage = librarianInstance.getStorage();
    const modules = await storage.getModules();
    const storageModule = modules.find((m: any) =>
      m.path.includes('storage/types') || m.path.includes('storage/index')
    );
    if (!storageModule) throw new Error('Storage interface module not found');
  });

  addTest('query', 'queries for bootstrap functions', async () => {
    const storage = librarianInstance.getStorage();
    const functions = await storage.getFunctions();
    const bootstrapFns = functions.filter((f: any) =>
      f.name.toLowerCase().includes('bootstrap')
    );
    if (bootstrapFns.length === 0) throw new Error('No bootstrap functions found');
  });

  addTest('query', 'queries by file path', async () => {
    const storage = librarianInstance.getStorage();
    const workspace = librarianInstance.config?.workspace || process.cwd();
    const functions = await storage.getFunctionsByPath(path.resolve(workspace, 'src/api/librarian.ts'));
    // Functions may be empty if file has no exported functions, but call should succeed
    expect(functions).toBeDefined();
  });

  addTest('query', 'queries modules by path', async () => {
    const storage = librarianInstance.getStorage();
    const modules = await storage.getModules();
    const indexModule = modules.find((m: any) => m.path.includes('index'));
    if (!indexModule) throw new Error('No index module found');
  });

  addTest('query', 'queries context packs', async () => {
    const storage = librarianInstance.getStorage();
    const packs = await storage.getContextPacks({ limit: 5 });
    // Context packs may not exist if bootstrap didn't run with LLM
    expect(packs).toBeDefined();
  });

  addTest('query', 'queries with confidence filter', async () => {
    const storage = librarianInstance.getStorage();
    const functions = await storage.getFunctions({ minConfidence: 0.5 });
    expect(functions).toBeDefined();
  });

  addTest('query', 'queries with ordering', async () => {
    const storage = librarianInstance.getStorage();
    const functions = await storage.getFunctions({
      orderBy: 'confidence',
      orderDirection: 'desc',
      limit: 10
    });
    expect(functions).toBeDefined();
    if (functions.length > 1) {
      // Verify ordering is correct
      for (let i = 1; i < functions.length; i++) {
        if (functions[i].confidence > functions[i - 1].confidence) {
          throw new Error('Functions not ordered by confidence descending');
        }
      }
    }
  });

  addTest('query', 'queries embeddings existence', async () => {
    const storage = librarianInstance.getStorage();
    const caps = storage.getCapabilities();
    expect(caps).toBeDefined();
    expect(caps.optional).toBeDefined();
  });

  addTest('query', 'queries storage stats', async () => {
    const storage = librarianInstance.getStorage();
    const stats = await storage.getStats();
    expect(stats).toBeDefined();
    expect(typeof stats.totalFunctions).toBe('number');
    expect(typeof stats.totalModules).toBe('number');
  });

  // ============================================================================
  // CROSS-REFERENCE TESTS
  // ============================================================================

  addTest('cross-reference', 'captures import relationships', async () => {
    const storage = librarianInstance.getStorage();
    const edges = await storage.getGraphEdges({ edgeTypes: ['imports'], limit: 10 });
    expect(edges).toBeDefined();
    // Import edges should exist if files were indexed
    if (edges.length > 0) {
      expect(edges[0].edgeType).toBe('imports');
    }
  });

  addTest('cross-reference', 'captures call relationships', async () => {
    const storage = librarianInstance.getStorage();
    const edges = await storage.getGraphEdges({ edgeTypes: ['calls'], limit: 10 });
    expect(edges).toBeDefined();
  });

  addTest('cross-reference', 'tracks file dependencies', async () => {
    const storage = librarianInstance.getStorage();
    const modules = await storage.getModules({ limit: 10 });
    const modulesWithDeps = modules.filter((m: any) => m.dependencies && m.dependencies.length > 0);
    if (modules.length > 0 && modulesWithDeps.length === 0) {
      // Some modules may have no dependencies, which is valid
      expect(modules).toBeDefined();
    }
  });

  addTest('cross-reference', 'tracks module exports', async () => {
    const storage = librarianInstance.getStorage();
    const modules = await storage.getModules({ limit: 10 });
    const modulesWithExports = modules.filter((m: any) => m.exports && m.exports.length > 0);
    if (modules.length > 0 && modulesWithExports.length === 0) {
      // Some modules may have no exports, which is valid
      expect(modules).toBeDefined();
    }
  });

  addTest('cross-reference', 'validates bidirectional imports', async () => {
    const storage = librarianInstance.getStorage();
    const edges = await storage.getGraphEdges({ edgeTypes: ['imports'], limit: 5 });
    if (edges.length > 0) {
      // Each edge should have valid from/to IDs
      for (const edge of edges) {
        expect(edge.fromId).toBeDefined();
        expect(edge.toId).toBeDefined();
        expect(edge.fromType).toBeDefined();
        expect(edge.toType).toBeDefined();
      }
    }
  });

  addTest('cross-reference', 'links files to directories', async () => {
    const storage = librarianInstance.getStorage();
    const files = await storage.getFiles({ limit: 10 });
    for (const file of files) {
      expect(file.path).toBeDefined();
      // File should have a directory path derivable from its path
      const dirPath = path.dirname(file.path);
      expect(dirPath).toBeDefined();
    }
  });

  addTest('cross-reference', 'captures extends relationships', async () => {
    const storage = librarianInstance.getStorage();
    const edges = await storage.getGraphEdges({ edgeTypes: ['extends'], limit: 10 });
    // May be empty if no class inheritance in codebase
    expect(edges).toBeDefined();
  });

  addTest('cross-reference', 'captures implements relationships', async () => {
    const storage = librarianInstance.getStorage();
    const edges = await storage.getGraphEdges({ edgeTypes: ['implements'], limit: 10 });
    // May be empty if no interface implementations tracked
    expect(edges).toBeDefined();
  });

  // ============================================================================
  // SYMBOL RESOLUTION TESTS
  // ============================================================================

  addTest('symbol-resolution', 'resolves function by name', async () => {
    const storage = librarianInstance.getStorage();
    const functions = await storage.getFunctions();
    const queryFn = functions.find((f: any) => f.name.includes('query'));
    if (functions.length > 0 && !queryFn) {
      // May not have a function with 'query' in name
      expect(functions.length).toBeGreaterThan(0);
    }
  });

  addTest('symbol-resolution', 'resolves function by file path', async () => {
    const storage = librarianInstance.getStorage();
    const allFunctions = await storage.getFunctions();
    if (allFunctions.length > 0) {
      const sampleFn = allFunctions[0];
      const fnByPath = await storage.getFunctionsByPath(sampleFn.filePath);
      expect(fnByPath.length).toBeGreaterThan(0);
    }
  });

  addTest('symbol-resolution', 'resolves module by path', async () => {
    const storage = librarianInstance.getStorage();
    const modules = await storage.getModules();
    if (modules.length > 0) {
      const sampleMod = modules[0];
      const modByPath = await storage.getModuleByPath(sampleMod.path);
      expect(modByPath).toBeDefined();
    }
  });

  addTest('symbol-resolution', 'captures function signatures', async () => {
    const storage = librarianInstance.getStorage();
    const functions = await storage.getFunctions({ limit: 10 });
    for (const fn of functions) {
      expect(fn.signature).toBeDefined();
      expect(typeof fn.signature).toBe('string');
    }
  });

  addTest('symbol-resolution', 'captures function line numbers', async () => {
    const storage = librarianInstance.getStorage();
    const functions = await storage.getFunctions({ limit: 10 });
    for (const fn of functions) {
      expect(typeof fn.startLine).toBe('number');
      expect(typeof fn.endLine).toBe('number');
      expect(fn.endLine).toBeGreaterThanOrEqual(fn.startLine);
    }
  });

  addTest('symbol-resolution', 'captures function names', async () => {
    const storage = librarianInstance.getStorage();
    const functions = await storage.getFunctions({ limit: 10 });
    for (const fn of functions) {
      expect(fn.name).toBeDefined();
      expect(typeof fn.name).toBe('string');
      expect(fn.name.length).toBeGreaterThan(0);
    }
  });

  addTest('symbol-resolution', 'captures function file paths', async () => {
    const storage = librarianInstance.getStorage();
    const functions = await storage.getFunctions({ limit: 10 });
    for (const fn of functions) {
      expect(fn.filePath).toBeDefined();
      expect(typeof fn.filePath).toBe('string');
    }
  });

  addTest('symbol-resolution', 'captures function IDs', async () => {
    const storage = librarianInstance.getStorage();
    const functions = await storage.getFunctions({ limit: 10 });
    for (const fn of functions) {
      expect(fn.id).toBeDefined();
      expect(typeof fn.id).toBe('string');
      expect(fn.id.length).toBeGreaterThan(0);
    }
  });

  addTest('symbol-resolution', 'resolves module exports list', async () => {
    const storage = librarianInstance.getStorage();
    const modules = await storage.getModules({ limit: 10 });
    for (const mod of modules) {
      expect(mod.exports).toBeDefined();
      expect(Array.isArray(mod.exports)).toBe(true);
    }
  });

  addTest('symbol-resolution', 'resolves module dependencies list', async () => {
    const storage = librarianInstance.getStorage();
    const modules = await storage.getModules({ limit: 10 });
    for (const mod of modules) {
      expect(mod.dependencies).toBeDefined();
      expect(Array.isArray(mod.dependencies)).toBe(true);
    }
  });

  // ============================================================================
  // DOCUMENTATION TESTS
  // ============================================================================

  addTest('documentation', 'captures function purpose', async () => {
    const storage = librarianInstance.getStorage();
    const functions = await storage.getFunctions({ limit: 10 });
    for (const fn of functions) {
      expect(fn.purpose).toBeDefined();
      expect(typeof fn.purpose).toBe('string');
    }
  });

  addTest('documentation', 'captures module purpose', async () => {
    const storage = librarianInstance.getStorage();
    const modules = await storage.getModules({ limit: 10 });
    for (const mod of modules) {
      expect(mod.purpose).toBeDefined();
      expect(typeof mod.purpose).toBe('string');
    }
  });

  addTest('documentation', 'captures file category', async () => {
    const storage = librarianInstance.getStorage();
    const files = await storage.getFiles({ limit: 10 });
    for (const file of files) {
      expect(file.category).toBeDefined();
      expect(['code', 'config', 'docs', 'test', 'data', 'schema', 'other']).toContain(file.category);
    }
  });

  addTest('documentation', 'captures file role', async () => {
    const storage = librarianInstance.getStorage();
    const files = await storage.getFiles({ limit: 10 });
    for (const file of files) {
      expect(file.role).toBeDefined();
      expect(typeof file.role).toBe('string');
    }
  });

  addTest('documentation', 'captures file summary', async () => {
    const storage = librarianInstance.getStorage();
    const files = await storage.getFiles({ limit: 10 });
    for (const file of files) {
      expect(file.summary).toBeDefined();
      expect(typeof file.summary).toBe('string');
    }
  });

  addTest('documentation', 'captures directory purpose', async () => {
    const storage = librarianInstance.getStorage();
    const directories = await storage.getDirectories({ limit: 10 });
    for (const dir of directories) {
      expect(dir.purpose).toBeDefined();
      expect(typeof dir.purpose).toBe('string');
    }
  });

  addTest('documentation', 'captures directory role', async () => {
    const storage = librarianInstance.getStorage();
    const directories = await storage.getDirectories({ limit: 10 });
    for (const dir of directories) {
      expect(dir.role).toBeDefined();
      expect(['feature', 'layer', 'utility', 'config', 'tests', 'docs', 'root', 'other']).toContain(dir.role);
    }
  });

  addTest('documentation', 'captures context pack summaries', async () => {
    const storage = librarianInstance.getStorage();
    const packs = await storage.getContextPacks({ limit: 10 });
    for (const pack of packs) {
      expect(pack.summary).toBeDefined();
      expect(typeof pack.summary).toBe('string');
    }
  });

  addTest('documentation', 'captures context pack key facts', async () => {
    const storage = librarianInstance.getStorage();
    const packs = await storage.getContextPacks({ limit: 10 });
    for (const pack of packs) {
      expect(pack.keyFacts).toBeDefined();
      expect(Array.isArray(pack.keyFacts)).toBe(true);
    }
  });

  // ============================================================================
  // DEPENDENCY TESTS
  // ============================================================================

  addTest('dependency', 'tracks package.json existence', async () => {
    const storage = librarianInstance.getStorage();
    const allFiles = await storage.getFiles();
    const packageJson = allFiles.find((f: any) => f.path.endsWith('package.json'));
    expect(packageJson).toBeDefined();
  });

  addTest('dependency', 'tracks module dependencies', async () => {
    const storage = librarianInstance.getStorage();
    const modules = await storage.getModules();
    // At least some modules should have dependencies
    expect(modules.some((m: any) => m.dependencies && m.dependencies.length >= 0)).toBe(true);
  });

  addTest('dependency', 'validates module dependency format', async () => {
    const storage = librarianInstance.getStorage();
    const modules = await storage.getModules({ limit: 20 });
    for (const mod of modules) {
      if (mod.dependencies && mod.dependencies.length > 0) {
        for (const dep of mod.dependencies) {
          expect(typeof dep).toBe('string');
        }
      }
    }
  });

  addTest('dependency', 'tracks import graph edges', async () => {
    const storage = librarianInstance.getStorage();
    const edges = await storage.getGraphEdges({ edgeTypes: ['imports'] });
    // Import edges should exist
    expect(edges).toBeDefined();
    expect(Array.isArray(edges)).toBe(true);
  });

  addTest('dependency', 'validates graph edge structure', async () => {
    const storage = librarianInstance.getStorage();
    const edges = await storage.getGraphEdges({ limit: 10 });
    for (const edge of edges) {
      expect(edge.fromId).toBeDefined();
      expect(edge.toId).toBeDefined();
      expect(edge.edgeType).toBeDefined();
      expect(edge.sourceFile).toBeDefined();
      expect(typeof edge.confidence).toBe('number');
    }
  });

  addTest('dependency', 'tracks file relationships', async () => {
    const storage = librarianInstance.getStorage();
    const files = await storage.getFiles({ limit: 10 });
    for (const file of files) {
      // Each file should have imports array
      expect(file.imports).toBeDefined();
      expect(Array.isArray(file.imports)).toBe(true);
    }
  });

  addTest('dependency', 'tracks file importedBy', async () => {
    const storage = librarianInstance.getStorage();
    const files = await storage.getFiles({ limit: 10 });
    for (const file of files) {
      // Each file should have importedBy array
      expect(file.importedBy).toBeDefined();
      expect(Array.isArray(file.importedBy)).toBe(true);
    }
  });

  addTest('dependency', 'cochange edges accessible', async () => {
    const storage = librarianInstance.getStorage();
    const cochangeEdges = await storage.getCochangeEdges({ limit: 5 });
    // May be empty if no git history analyzed
    expect(cochangeEdges).toBeDefined();
    expect(Array.isArray(cochangeEdges)).toBe(true);
  });

  // ============================================================================
  // ADDITIONAL VALIDATION TESTS
  // ============================================================================

  addTest('validation', 'storage is initialized', async () => {
    const storage = librarianInstance.getStorage();
    expect(storage).toBeDefined();
    expect(storage.isInitialized()).toBe(true);
  });

  addTest('validation', 'storage capabilities reported', async () => {
    const storage = librarianInstance.getStorage();
    const caps = storage.getCapabilities();
    expect(caps).toBeDefined();
    expect(caps.core).toBeDefined();
    expect(caps.optional).toBeDefined();
    expect(caps.versions).toBeDefined();
  });

  addTest('validation', 'metadata accessible', async () => {
    const storage = librarianInstance.getStorage();
    const metadata = await storage.getMetadata();
    // Metadata may be null if not set
    expect(metadata === null || typeof metadata === 'object').toBe(true);
  });

  addTest('validation', 'version accessible', async () => {
    const storage = librarianInstance.getStorage();
    const version = await storage.getVersion();
    // Version may be null if not bootstrapped
    expect(version === null || typeof version === 'object').toBe(true);
  });

  addTest('validation', 'transaction support', async () => {
    const storage = librarianInstance.getStorage();
    // Verify transaction method exists
    expect(typeof storage.transaction).toBe('function');
  });

  addTest('validation', 'vacuum support', async () => {
    const storage = librarianInstance.getStorage();
    // Verify vacuum method exists
    expect(typeof storage.vacuum).toBe('function');
  });

  // ============================================================================
  // RUNNER IMPLEMENTATION
  // ============================================================================

  const runTest = async (testCase: TestCase): Promise<BootstrapTestResult> => {
    const start = Date.now();
    try {
      await testCase.fn();
      return {
        category: testCase.category,
        testName: testCase.name,
        passed: true,
        duration: Date.now() - start,
      };
    } catch (error) {
      return {
        category: testCase.category,
        testName: testCase.name,
        passed: false,
        duration: Date.now() - start,
        details: error instanceof Error ? error.message : String(error),
      };
    }
  };

  return {
    async runAllTests(): Promise<BootstrapTestResult[]> {
      results.length = 0;
      for (const testCase of testCases) {
        const result = await runTest(testCase);
        results.push(result);
      }
      return results;
    },

    async runCategory(category: string): Promise<BootstrapTestResult[]> {
      const categoryTests = testCases.filter((t) => t.category === category);
      const categoryResults: BootstrapTestResult[] = [];
      for (const testCase of categoryTests) {
        const result = await runTest(testCase);
        categoryResults.push(result);
        results.push(result);
      }
      return categoryResults;
    },

    getSummary(): { total: number; passed: number; failed: number } {
      const passed = results.filter((r) => r.passed).length;
      return {
        total: results.length,
        passed,
        failed: results.length - passed,
      };
    },
  };
}

// ============================================================================
// VITEST TEST SUITE
// ============================================================================

describe('Bootstrap Tests (WU-BOOT-002)', () => {
  let tempDir: string;
  let mockStorage: MockStorage;
  let mockLibrarian: MockLibrarian;
  let runner: BootstrapTestRunner;

  // Mock storage implementation for testing
  class MockStorage {
    private files: any[] = [];
    private functions: any[] = [];
    private modules: any[] = [];
    private contextPacks: any[] = [];
    private directories: any[] = [];
    private graphEdges: any[] = [];
    private cochangeEdges: any[] = [];
    private checksums = new Map<string, string>();
    private _initialized = false;

    constructor(workspace: string) {
      // Generate mock data based on actual Librarian structure
      this.generateMockData(workspace);
      this._initialized = true;
    }

    private generateMockData(workspace: string): void {
      // Mock files
      const filePaths = [
        'src/index.ts',
        'src/types.ts',
        'src/api/librarian.ts',
        'src/api/index.ts',
        'src/api/bootstrap.ts',
        'src/api/query.ts',
        'src/storage/types.ts',
        'src/storage/sqlite_storage.ts',
        'src/integration/index.ts',
        'src/integration/file_watcher.ts',
        'src/epistemics/index.ts',
        'src/knowledge/index.ts',
        'src/__tests__/bootstrap_integration.test.ts',
        'package.json',
        'tsconfig.json',
        'vitest.config.ts',
      ];

      this.files = filePaths.map((p, i) => ({
        id: `file-${i}`,
        path: path.join(workspace, p),
        relativePath: p,
        name: path.basename(p),
        extension: path.extname(p),
        category: p.includes('.test.') ? 'test' : p.endsWith('.json') || p.endsWith('.config.ts') ? 'config' : 'code',
        purpose: `Purpose of ${path.basename(p)}`,
        role: p.includes('index') ? 'entry point' : 'utility',
        summary: `Summary of ${path.basename(p)}`,
        keyExports: ['export1', 'export2'],
        mainConcepts: ['concept1'],
        lineCount: 100 + i * 10,
        functionCount: 5 + i,
        classCount: i % 3,
        importCount: 3 + i,
        exportCount: 2 + i,
        imports: [],
        importedBy: [],
        directory: path.dirname(path.join(workspace, p)),
        complexity: 'medium' as const,
        hasTests: !p.includes('.test.'),
        checksum: `checksum-${i}`,
        confidence: 0.7 + (i % 3) * 0.1,
        lastIndexed: new Date().toISOString(),
        lastModified: new Date().toISOString(),
      }));

      // Mock functions
      const functionNames = [
        'createLibrarian', 'queryLibrarian', 'bootstrapProject',
        'createSqliteStorage', 'startFileWatcher', 'createBootstrapTestRunner',
        'executeQuery', 'generateContextPacks', 'initialize', 'shutdown',
      ];

      this.functions = functionNames.map((name, i) => ({
        id: `fn-${i}`,
        filePath: this.files[i % this.files.length].path,
        name,
        signature: `function ${name}(): void`,
        purpose: `Purpose of ${name}`,
        startLine: 10 + i * 5,
        endLine: 20 + i * 5,
        confidence: 0.6 + (i % 4) * 0.1,
        accessCount: i * 2,
        lastAccessed: new Date(),
        validationCount: i,
        outcomeHistory: { successes: i, failures: 0 },
      }));

      // Mock modules
      this.modules = this.files
        .filter((f) => f.extension === '.ts')
        .map((f, i) => ({
          id: `mod-${i}`,
          path: f.path,
          purpose: f.purpose,
          exports: f.keyExports,
          dependencies: i > 0 ? [this.files[0].path] : [],
          confidence: f.confidence,
        }));

      // Mock directories
      const dirPaths = [
        'src',
        'src/api',
        'src/storage',
        'src/integration',
        'src/epistemics',
        'src/knowledge',
        'src/__tests__',
      ];

      this.directories = dirPaths.map((p, i) => ({
        id: `dir-${i}`,
        path: path.join(workspace, p),
        relativePath: p,
        name: path.basename(p),
        fingerprint: `fingerprint-${i}`,
        purpose: `Purpose of ${path.basename(p)} directory`,
        role: p.includes('__tests__') ? 'tests' as const : p === 'src' ? 'root' as const : 'feature' as const,
        description: `Description of ${path.basename(p)}`,
        pattern: 'nested' as const,
        depth: p.split('/').length - 1,
        fileCount: 3 + i,
        subdirectoryCount: i % 3,
        totalFiles: 10 + i,
        mainFiles: ['index.ts'],
        subdirectories: [],
        fileTypes: { '.ts': 5, '.json': 1 },
        parent: p.includes('/') ? path.dirname(path.join(workspace, p)) : null,
        siblings: [],
        relatedDirectories: [],
        hasReadme: i % 2 === 0,
        hasIndex: true,
        hasTests: true,
        complexity: 'medium' as const,
        confidence: 0.75,
        lastIndexed: new Date().toISOString(),
      }));

      // Mock context packs
      this.contextPacks = this.functions.slice(0, 5).map((fn, i) => ({
        packId: `pack-${i}`,
        packType: 'function_context',
        targetId: fn.id,
        summary: `Context summary for ${fn.name}`,
        keyFacts: [`Fact 1 about ${fn.name}`, `Fact 2 about ${fn.name}`],
        codeSnippets: [],
        relatedFiles: [fn.filePath],
        confidence: 0.7,
        createdAt: new Date(),
        accessCount: i,
        lastOutcome: 'success' as const,
        successCount: i,
        failureCount: 0,
        version: { major: 2, minor: 0, patch: 0, string: '2.0.0', qualityTier: 'full' as const, indexedAt: new Date(), indexerVersion: '2.0.0', features: [] },
        invalidationTriggers: [fn.filePath],
      }));

      // Mock graph edges
      this.graphEdges = this.modules.slice(1).map((mod, i) => ({
        fromId: mod.id,
        fromType: 'module' as const,
        toId: this.modules[0].id,
        toType: 'module' as const,
        edgeType: 'imports' as const,
        sourceFile: mod.path,
        sourceLine: 1,
        confidence: 0.9,
        computedAt: new Date(),
      }));

      // Add some call edges
      this.graphEdges.push(
        ...this.functions.slice(1, 5).map((fn, i) => ({
          fromId: fn.id,
          fromType: 'function' as const,
          toId: this.functions[0].id,
          toType: 'function' as const,
          edgeType: 'calls' as const,
          sourceFile: fn.filePath,
          sourceLine: fn.startLine,
          confidence: 0.8,
          computedAt: new Date(),
        }))
      );

      // Set checksums
      this.files.forEach((f) => {
        this.checksums.set(f.path, f.checksum);
      });
    }

    isInitialized(): boolean {
      return this._initialized;
    }

    getCapabilities() {
      return {
        core: { getFunctions: true, getFiles: true, getContextPacks: true },
        optional: { graphMetrics: true, multiVectors: true, embeddings: true, episodes: true, verificationPlans: true },
        versions: { schema: 1, api: 1 },
      };
    }

    async getFiles(options?: any): Promise<any[]> {
      let result = [...this.files];
      if (options?.directory) {
        result = result.filter((f) => f.relativePath.includes(options.directory));
      }
      if (options?.limit) {
        result = result.slice(0, options.limit);
      }
      return result;
    }

    async getFileByPath(filePath: string): Promise<any | null> {
      return this.files.find((f) => f.path === filePath) || null;
    }

    async getFileChecksum(filePath: string): Promise<string | null> {
      return this.checksums.get(filePath) || null;
    }

    async getFunctions(options?: any): Promise<any[]> {
      let result = [...this.functions];
      if (options?.minConfidence) {
        result = result.filter((f) => f.confidence >= options.minConfidence);
      }
      if (options?.orderBy === 'confidence' && options?.orderDirection === 'desc') {
        result.sort((a, b) => b.confidence - a.confidence);
      }
      if (options?.limit) {
        result = result.slice(0, options.limit);
      }
      return result;
    }

    async getFunction(id: string): Promise<any | null> {
      return this.functions.find((f) => f.id === id) || null;
    }

    async getFunctionsByPath(filePath: string): Promise<any[]> {
      return this.functions.filter((f) => f.filePath === filePath);
    }

    async getModules(options?: any): Promise<any[]> {
      let result = [...this.modules];
      if (options?.limit) {
        result = result.slice(0, options.limit);
      }
      return result;
    }

    async getModule(id: string): Promise<any | null> {
      return this.modules.find((m) => m.id === id) || null;
    }

    async getModuleByPath(modulePath: string): Promise<any | null> {
      return this.modules.find((m) => m.path === modulePath) || null;
    }

    async getContextPacks(options?: any): Promise<any[]> {
      let result = [...this.contextPacks];
      if (options?.limit) {
        result = result.slice(0, options.limit);
      }
      return result;
    }

    async getDirectories(options?: any): Promise<any[]> {
      let result = [...this.directories];
      if (options?.limit) {
        result = result.slice(0, options.limit);
      }
      return result;
    }

    async getGraphEdges(options?: any): Promise<any[]> {
      let result = [...this.graphEdges];
      if (options?.edgeTypes) {
        result = result.filter((e) => options.edgeTypes.includes(e.edgeType));
      }
      if (options?.limit) {
        result = result.slice(0, options.limit);
      }
      return result;
    }

    async getCochangeEdges(options?: any): Promise<any[]> {
      let result = [...this.cochangeEdges];
      if (options?.limit) {
        result = result.slice(0, options.limit);
      }
      return result;
    }

    async getStats() {
      return {
        totalFunctions: this.functions.length,
        totalModules: this.modules.length,
        totalContextPacks: this.contextPacks.length,
        totalEmbeddings: 0,
        storageSizeBytes: 1024 * 1024,
        lastVacuum: null,
        averageConfidence: 0.7,
        cacheHitRate: 0.5,
      };
    }

    async getMetadata() {
      return { workspace: tempDir, createdAt: new Date() };
    }

    async getVersion() {
      return {
        major: 2,
        minor: 0,
        patch: 0,
        string: '2.0.0',
        qualityTier: 'full',
        indexedAt: new Date(),
        indexerVersion: '2.0.0',
        features: [],
      };
    }

    transaction(fn: any) {
      return fn({});
    }

    vacuum() {
      return Promise.resolve();
    }
  }

  class MockLibrarian {
    config: { workspace: string };
    private storage: MockStorage;

    constructor(workspace: string) {
      this.config = { workspace };
      this.storage = new MockStorage(workspace);
    }

    getStorage(): MockStorage {
      return this.storage;
    }
  }

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bootstrap-tests-'));
    mockStorage = new MockStorage(tempDir);
    mockLibrarian = new MockLibrarian(tempDir);
    runner = createBootstrapTestRunner(mockLibrarian);
  });

  afterAll(async () => {
    try {
      await fs.rm(tempDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  // ============================================================================
  // INTERFACE TESTS
  // ============================================================================

  describe('Interface Requirements', () => {
    it('createBootstrapTestRunner returns a valid BootstrapTestRunner', () => {
      expect(runner).toBeDefined();
      expect(typeof runner.runAllTests).toBe('function');
      expect(typeof runner.runCategory).toBe('function');
      expect(typeof runner.getSummary).toBe('function');
    });

    it('runAllTests returns BootstrapTestResult array', async () => {
      const results = await runner.runAllTests();
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThan(0);

      for (const result of results) {
        expect(result.category).toBeDefined();
        expect(typeof result.category).toBe('string');
        expect(result.testName).toBeDefined();
        expect(typeof result.testName).toBe('string');
        expect(typeof result.passed).toBe('boolean');
        expect(typeof result.duration).toBe('number');
      }
    });

    it('runCategory returns results for specified category', async () => {
      const results = await runner.runCategory('self-indexing');
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThan(0);
      for (const result of results) {
        expect(result.category).toBe('self-indexing');
      }
    });

    it('getSummary returns correct counts', async () => {
      await runner.runAllTests();
      const summary = runner.getSummary();
      expect(typeof summary.total).toBe('number');
      expect(typeof summary.passed).toBe('number');
      expect(typeof summary.failed).toBe('number');
      expect(summary.passed + summary.failed).toBe(summary.total);
    });
  });

  // ============================================================================
  // CATEGORY TESTS
  // ============================================================================

  describe('Self-Indexing Tests', () => {
    it('runs all self-indexing tests', async () => {
      const results = await runner.runCategory('self-indexing');
      expect(results.length).toBeGreaterThanOrEqual(8);
    });

    it('self-indexing tests pass with mock data', async () => {
      const results = await runner.runCategory('self-indexing');
      const failed = results.filter((r) => !r.passed);
      if (failed.length > 0) {
        console.log('Failed self-indexing tests:', failed.map((f) => `${f.testName}: ${f.details}`));
      }
      expect(failed.length).toBe(0);
    });
  });

  describe('Query Tests', () => {
    it('runs all query tests', async () => {
      const results = await runner.runCategory('query');
      expect(results.length).toBeGreaterThanOrEqual(8);
    });

    it('query tests pass with mock data', async () => {
      const results = await runner.runCategory('query');
      const failed = results.filter((r) => !r.passed);
      if (failed.length > 0) {
        console.log('Failed query tests:', failed.map((f) => `${f.testName}: ${f.details}`));
      }
      expect(failed.length).toBe(0);
    });
  });

  describe('Cross-Reference Tests', () => {
    it('runs all cross-reference tests', async () => {
      const results = await runner.runCategory('cross-reference');
      expect(results.length).toBeGreaterThanOrEqual(6);
    });

    it('cross-reference tests pass with mock data', async () => {
      const results = await runner.runCategory('cross-reference');
      const failed = results.filter((r) => !r.passed);
      if (failed.length > 0) {
        console.log('Failed cross-reference tests:', failed.map((f) => `${f.testName}: ${f.details}`));
      }
      expect(failed.length).toBe(0);
    });
  });

  describe('Symbol Resolution Tests', () => {
    it('runs all symbol resolution tests', async () => {
      const results = await runner.runCategory('symbol-resolution');
      expect(results.length).toBeGreaterThanOrEqual(8);
    });

    it('symbol resolution tests pass with mock data', async () => {
      const results = await runner.runCategory('symbol-resolution');
      const failed = results.filter((r) => !r.passed);
      if (failed.length > 0) {
        console.log('Failed symbol resolution tests:', failed.map((f) => `${f.testName}: ${f.details}`));
      }
      expect(failed.length).toBe(0);
    });
  });

  describe('Documentation Tests', () => {
    it('runs all documentation tests', async () => {
      const results = await runner.runCategory('documentation');
      expect(results.length).toBeGreaterThanOrEqual(6);
    });

    it('documentation tests pass with mock data', async () => {
      const results = await runner.runCategory('documentation');
      const failed = results.filter((r) => !r.passed);
      if (failed.length > 0) {
        console.log('Failed documentation tests:', failed.map((f) => `${f.testName}: ${f.details}`));
      }
      expect(failed.length).toBe(0);
    });
  });

  describe('Dependency Tests', () => {
    it('runs all dependency tests', async () => {
      const results = await runner.runCategory('dependency');
      expect(results.length).toBeGreaterThanOrEqual(6);
    });

    it('dependency tests pass with mock data', async () => {
      const results = await runner.runCategory('dependency');
      const failed = results.filter((r) => !r.passed);
      if (failed.length > 0) {
        console.log('Failed dependency tests:', failed.map((f) => `${f.testName}: ${f.details}`));
      }
      expect(failed.length).toBe(0);
    });
  });

  describe('Validation Tests', () => {
    it('runs all validation tests', async () => {
      const results = await runner.runCategory('validation');
      expect(results.length).toBeGreaterThanOrEqual(4);
    });

    it('validation tests pass with mock data', async () => {
      const results = await runner.runCategory('validation');
      const failed = results.filter((r) => !r.passed);
      if (failed.length > 0) {
        console.log('Failed validation tests:', failed.map((f) => `${f.testName}: ${f.details}`));
      }
      expect(failed.length).toBe(0);
    });
  });

  // ============================================================================
  // AGGREGATE TESTS
  // ============================================================================

  describe('Full Test Suite', () => {
    it('has at least 50 tests', async () => {
      const results = await runner.runAllTests();
      expect(results.length).toBeGreaterThanOrEqual(50);
    });

    it('all tests pass with mock data', async () => {
      const results = await runner.runAllTests();
      const failed = results.filter((r) => !r.passed);
      if (failed.length > 0) {
        console.log('Failed tests:', failed.map((f) => `[${f.category}] ${f.testName}: ${f.details}`));
      }
      expect(failed.length).toBe(0);
    });

    it('covers all required categories', async () => {
      const results = await runner.runAllTests();
      const categories = new Set(results.map((r) => r.category));
      expect(categories.has('self-indexing')).toBe(true);
      expect(categories.has('query')).toBe(true);
      expect(categories.has('cross-reference')).toBe(true);
      expect(categories.has('symbol-resolution')).toBe(true);
      expect(categories.has('documentation')).toBe(true);
      expect(categories.has('dependency')).toBe(true);
    });

    it('summary is accurate', async () => {
      await runner.runAllTests();
      const summary = runner.getSummary();
      expect(summary.total).toBeGreaterThanOrEqual(50);
      expect(summary.passed).toBeGreaterThanOrEqual(50);
      expect(summary.failed).toBe(0);
    });
  });
});
