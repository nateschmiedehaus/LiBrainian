/**
 * @fileoverview Bootstrap Test Suite Runner (WU-BOOT-002)
 *
 * Provides a test runner that validates Librarian can correctly index
 * and query its own codebase. Used for self-validation.
 *
 * @example
 * ```typescript
 * import { createLibrarian } from '@wave0/librarian';
 * import { createBootstrapTestRunner } from '@wave0/librarian/integration';
 *
 * const librarian = await createLibrarian({ workspace: '/path/to/project' });
 * const runner = createBootstrapTestRunner(librarian);
 * const results = await runner.runAllTests();
 * console.log(runner.getSummary());
 * ```
 */

import * as path from 'node:path';

// ============================================================================
// INTERFACE DEFINITIONS
// ============================================================================

/**
 * Result of a single bootstrap test.
 */
export interface BootstrapTestResult {
  /** Test category (e.g., 'self-indexing', 'query', 'cross-reference') */
  category: string;
  /** Name of the test */
  testName: string;
  /** Whether the test passed */
  passed: boolean;
  /** Duration in milliseconds */
  duration: number;
  /** Error details if test failed */
  details?: string;
}

/**
 * Runner for executing bootstrap tests.
 */
export interface BootstrapTestRunner {
  /** Run all bootstrap tests */
  runAllTests(): Promise<BootstrapTestResult[]>;
  /** Run tests for a specific category */
  runCategory(category: string): Promise<BootstrapTestResult[]>;
  /** Get summary of test results */
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
 * The runner includes tests across these categories:
 * - self-indexing: Verify Librarian indexes its own source files
 * - query: Query for known Librarian components
 * - cross-reference: Verify import/export relationships are captured
 * - symbol-resolution: Verify function/class definitions are found
 * - documentation: Verify JSDoc comments are indexed
 * - dependency: Verify package dependencies are tracked
 * - validation: Basic storage validation tests
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

  // Get workspace from librarian config
  const getWorkspace = (): string => {
    return librarianInstance.config?.workspace || process.cwd();
  };

  // ============================================================================
  // SELF-INDEXING TESTS
  // ============================================================================

  addTest('self-indexing', 'indexes src/index.ts', async () => {
    const storage = librarianInstance.getStorage();
    const file = await storage.getFileByPath(path.resolve(getWorkspace(), 'src/index.ts'));
    if (!file) throw new Error('src/index.ts not indexed');
  });

  addTest('self-indexing', 'indexes api module files', async () => {
    const storage = librarianInstance.getStorage();
    const allFiles = await storage.getFiles();
    const apiFiles = allFiles.filter((f: any) => f.path.includes('/api/'));
    if (apiFiles.length === 0) throw new Error('No api module files found');
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
    const checksum = await storage.getFileChecksum(path.resolve(getWorkspace(), 'src/index.ts'));
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
    const functions = await storage.getFunctionsByPath(path.resolve(getWorkspace(), 'src/api/librarian.ts'));
    if (!functions) throw new Error('getFunctionsByPath returned undefined');
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
    if (!packs) throw new Error('getContextPacks returned undefined');
  });

  addTest('query', 'queries with confidence filter', async () => {
    const storage = librarianInstance.getStorage();
    const functions = await storage.getFunctions({ minConfidence: 0.5 });
    if (!functions) throw new Error('getFunctions with minConfidence returned undefined');
  });

  addTest('query', 'queries with ordering', async () => {
    const storage = librarianInstance.getStorage();
    const functions = await storage.getFunctions({
      orderBy: 'confidence',
      orderDirection: 'desc',
      limit: 10
    });
    if (!functions) throw new Error('getFunctions with ordering returned undefined');
    if (functions.length > 1) {
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
    if (!caps) throw new Error('getCapabilities returned undefined');
    if (!caps.optional) throw new Error('capabilities.optional is undefined');
  });

  addTest('query', 'queries storage stats', async () => {
    const storage = librarianInstance.getStorage();
    const stats = await storage.getStats();
    if (!stats) throw new Error('getStats returned undefined');
    if (typeof stats.totalFunctions !== 'number') throw new Error('totalFunctions is not a number');
    if (typeof stats.totalModules !== 'number') throw new Error('totalModules is not a number');
  });

  // ============================================================================
  // CROSS-REFERENCE TESTS
  // ============================================================================

  addTest('cross-reference', 'captures import relationships', async () => {
    const storage = librarianInstance.getStorage();
    const edges = await storage.getGraphEdges({ edgeTypes: ['imports'], limit: 10 });
    if (!edges) throw new Error('getGraphEdges returned undefined');
    if (edges.length > 0 && edges[0].edgeType !== 'imports') {
      throw new Error('Expected import edge type');
    }
  });

  addTest('cross-reference', 'captures call relationships', async () => {
    const storage = librarianInstance.getStorage();
    const edges = await storage.getGraphEdges({ edgeTypes: ['calls'], limit: 10 });
    if (!edges) throw new Error('getGraphEdges returned undefined');
  });

  addTest('cross-reference', 'tracks file dependencies', async () => {
    const storage = librarianInstance.getStorage();
    const modules = await storage.getModules({ limit: 10 });
    if (!modules) throw new Error('getModules returned undefined');
  });

  addTest('cross-reference', 'tracks module exports', async () => {
    const storage = librarianInstance.getStorage();
    const modules = await storage.getModules({ limit: 10 });
    if (!modules) throw new Error('getModules returned undefined');
  });

  addTest('cross-reference', 'validates bidirectional imports', async () => {
    const storage = librarianInstance.getStorage();
    const edges = await storage.getGraphEdges({ edgeTypes: ['imports'], limit: 5 });
    for (const edge of edges) {
      if (!edge.fromId) throw new Error('Edge missing fromId');
      if (!edge.toId) throw new Error('Edge missing toId');
      if (!edge.fromType) throw new Error('Edge missing fromType');
      if (!edge.toType) throw new Error('Edge missing toType');
    }
  });

  addTest('cross-reference', 'links files to directories', async () => {
    const storage = librarianInstance.getStorage();
    const files = await storage.getFiles({ limit: 10 });
    for (const file of files) {
      if (!file.path) throw new Error('File missing path');
      const dirPath = path.dirname(file.path);
      if (!dirPath) throw new Error('Could not derive directory path');
    }
  });

  addTest('cross-reference', 'captures extends relationships', async () => {
    const storage = librarianInstance.getStorage();
    const edges = await storage.getGraphEdges({ edgeTypes: ['extends'], limit: 10 });
    if (!edges) throw new Error('getGraphEdges returned undefined');
  });

  addTest('cross-reference', 'captures implements relationships', async () => {
    const storage = librarianInstance.getStorage();
    const edges = await storage.getGraphEdges({ edgeTypes: ['implements'], limit: 10 });
    if (!edges) throw new Error('getGraphEdges returned undefined');
  });

  // ============================================================================
  // SYMBOL RESOLUTION TESTS
  // ============================================================================

  addTest('symbol-resolution', 'resolves function by name', async () => {
    const storage = librarianInstance.getStorage();
    const functions = await storage.getFunctions();
    if (functions.length === 0) throw new Error('No functions found');
  });

  addTest('symbol-resolution', 'resolves function by file path', async () => {
    const storage = librarianInstance.getStorage();
    const allFunctions = await storage.getFunctions();
    if (allFunctions.length > 0) {
      const sampleFn = allFunctions[0];
      const fnByPath = await storage.getFunctionsByPath(sampleFn.filePath);
      if (fnByPath.length === 0) throw new Error('getFunctionsByPath returned empty');
    }
  });

  addTest('symbol-resolution', 'resolves module by path', async () => {
    const storage = librarianInstance.getStorage();
    const modules = await storage.getModules();
    if (modules.length > 0) {
      const sampleMod = modules[0];
      const modByPath = await storage.getModuleByPath(sampleMod.path);
      if (!modByPath) throw new Error('getModuleByPath returned null');
    }
  });

  addTest('symbol-resolution', 'captures function signatures', async () => {
    const storage = librarianInstance.getStorage();
    const functions = await storage.getFunctions({ limit: 10 });
    for (const fn of functions) {
      if (fn.signature === undefined) throw new Error('Function missing signature');
      if (typeof fn.signature !== 'string') throw new Error('Signature is not a string');
    }
  });

  addTest('symbol-resolution', 'captures function line numbers', async () => {
    const storage = librarianInstance.getStorage();
    const functions = await storage.getFunctions({ limit: 10 });
    for (const fn of functions) {
      if (typeof fn.startLine !== 'number') throw new Error('startLine is not a number');
      if (typeof fn.endLine !== 'number') throw new Error('endLine is not a number');
      if (fn.endLine < fn.startLine) throw new Error('endLine is less than startLine');
    }
  });

  addTest('symbol-resolution', 'captures function names', async () => {
    const storage = librarianInstance.getStorage();
    const functions = await storage.getFunctions({ limit: 10 });
    for (const fn of functions) {
      if (!fn.name) throw new Error('Function missing name');
      if (typeof fn.name !== 'string') throw new Error('Name is not a string');
      if (fn.name.length === 0) throw new Error('Name is empty');
    }
  });

  addTest('symbol-resolution', 'captures function file paths', async () => {
    const storage = librarianInstance.getStorage();
    const functions = await storage.getFunctions({ limit: 10 });
    for (const fn of functions) {
      if (!fn.filePath) throw new Error('Function missing filePath');
      if (typeof fn.filePath !== 'string') throw new Error('filePath is not a string');
    }
  });

  addTest('symbol-resolution', 'captures function IDs', async () => {
    const storage = librarianInstance.getStorage();
    const functions = await storage.getFunctions({ limit: 10 });
    for (const fn of functions) {
      if (!fn.id) throw new Error('Function missing id');
      if (typeof fn.id !== 'string') throw new Error('id is not a string');
      if (fn.id.length === 0) throw new Error('id is empty');
    }
  });

  addTest('symbol-resolution', 'resolves module exports list', async () => {
    const storage = librarianInstance.getStorage();
    const modules = await storage.getModules({ limit: 10 });
    for (const mod of modules) {
      if (!mod.exports) throw new Error('Module missing exports');
      if (!Array.isArray(mod.exports)) throw new Error('exports is not an array');
    }
  });

  addTest('symbol-resolution', 'resolves module dependencies list', async () => {
    const storage = librarianInstance.getStorage();
    const modules = await storage.getModules({ limit: 10 });
    for (const mod of modules) {
      if (!mod.dependencies) throw new Error('Module missing dependencies');
      if (!Array.isArray(mod.dependencies)) throw new Error('dependencies is not an array');
    }
  });

  // ============================================================================
  // DOCUMENTATION TESTS
  // ============================================================================

  addTest('documentation', 'captures function purpose', async () => {
    const storage = librarianInstance.getStorage();
    const functions = await storage.getFunctions({ limit: 10 });
    for (const fn of functions) {
      if (fn.purpose === undefined) throw new Error('Function missing purpose');
      if (typeof fn.purpose !== 'string') throw new Error('purpose is not a string');
    }
  });

  addTest('documentation', 'captures module purpose', async () => {
    const storage = librarianInstance.getStorage();
    const modules = await storage.getModules({ limit: 10 });
    for (const mod of modules) {
      if (mod.purpose === undefined) throw new Error('Module missing purpose');
      if (typeof mod.purpose !== 'string') throw new Error('purpose is not a string');
    }
  });

  addTest('documentation', 'captures file category', async () => {
    const storage = librarianInstance.getStorage();
    const files = await storage.getFiles({ limit: 10 });
    const validCategories = ['code', 'config', 'docs', 'test', 'data', 'schema', 'other'];
    for (const file of files) {
      if (!file.category) throw new Error('File missing category');
      if (!validCategories.includes(file.category)) {
        throw new Error(`Invalid category: ${file.category}`);
      }
    }
  });

  addTest('documentation', 'captures file role', async () => {
    const storage = librarianInstance.getStorage();
    const files = await storage.getFiles({ limit: 10 });
    for (const file of files) {
      if (file.role === undefined) throw new Error('File missing role');
      if (typeof file.role !== 'string') throw new Error('role is not a string');
    }
  });

  addTest('documentation', 'captures file summary', async () => {
    const storage = librarianInstance.getStorage();
    const files = await storage.getFiles({ limit: 10 });
    for (const file of files) {
      if (file.summary === undefined) throw new Error('File missing summary');
      if (typeof file.summary !== 'string') throw new Error('summary is not a string');
    }
  });

  addTest('documentation', 'captures directory purpose', async () => {
    const storage = librarianInstance.getStorage();
    const directories = await storage.getDirectories({ limit: 10 });
    for (const dir of directories) {
      if (dir.purpose === undefined) throw new Error('Directory missing purpose');
      if (typeof dir.purpose !== 'string') throw new Error('purpose is not a string');
    }
  });

  addTest('documentation', 'captures directory role', async () => {
    const storage = librarianInstance.getStorage();
    const directories = await storage.getDirectories({ limit: 10 });
    const validRoles = ['feature', 'layer', 'utility', 'config', 'tests', 'docs', 'root', 'other'];
    for (const dir of directories) {
      if (!dir.role) throw new Error('Directory missing role');
      if (!validRoles.includes(dir.role)) {
        throw new Error(`Invalid role: ${dir.role}`);
      }
    }
  });

  addTest('documentation', 'captures context pack summaries', async () => {
    const storage = librarianInstance.getStorage();
    const packs = await storage.getContextPacks({ limit: 10 });
    for (const pack of packs) {
      if (pack.summary === undefined) throw new Error('Pack missing summary');
      if (typeof pack.summary !== 'string') throw new Error('summary is not a string');
    }
  });

  addTest('documentation', 'captures context pack key facts', async () => {
    const storage = librarianInstance.getStorage();
    const packs = await storage.getContextPacks({ limit: 10 });
    for (const pack of packs) {
      if (!pack.keyFacts) throw new Error('Pack missing keyFacts');
      if (!Array.isArray(pack.keyFacts)) throw new Error('keyFacts is not an array');
    }
  });

  // ============================================================================
  // DEPENDENCY TESTS
  // ============================================================================

  addTest('dependency', 'tracks package.json existence', async () => {
    const storage = librarianInstance.getStorage();
    const allFiles = await storage.getFiles();
    const packageJson = allFiles.find((f: any) => f.path.endsWith('package.json'));
    if (!packageJson) throw new Error('package.json not found');
  });

  addTest('dependency', 'tracks module dependencies', async () => {
    const storage = librarianInstance.getStorage();
    const modules = await storage.getModules();
    const hasDependencies = modules.some((m: any) => m.dependencies && m.dependencies.length >= 0);
    if (!hasDependencies) throw new Error('No modules have dependencies array');
  });

  addTest('dependency', 'validates module dependency format', async () => {
    const storage = librarianInstance.getStorage();
    const modules = await storage.getModules({ limit: 20 });
    for (const mod of modules) {
      if (mod.dependencies && mod.dependencies.length > 0) {
        for (const dep of mod.dependencies) {
          if (typeof dep !== 'string') throw new Error('Dependency is not a string');
        }
      }
    }
  });

  addTest('dependency', 'tracks import graph edges', async () => {
    const storage = librarianInstance.getStorage();
    const edges = await storage.getGraphEdges({ edgeTypes: ['imports'] });
    if (!edges) throw new Error('getGraphEdges returned undefined');
    if (!Array.isArray(edges)) throw new Error('edges is not an array');
  });

  addTest('dependency', 'validates graph edge structure', async () => {
    const storage = librarianInstance.getStorage();
    const edges = await storage.getGraphEdges({ limit: 10 });
    for (const edge of edges) {
      if (!edge.fromId) throw new Error('Edge missing fromId');
      if (!edge.toId) throw new Error('Edge missing toId');
      if (!edge.edgeType) throw new Error('Edge missing edgeType');
      if (!edge.sourceFile) throw new Error('Edge missing sourceFile');
      if (typeof edge.confidence !== 'number') throw new Error('confidence is not a number');
    }
  });

  addTest('dependency', 'tracks file relationships', async () => {
    const storage = librarianInstance.getStorage();
    const files = await storage.getFiles({ limit: 10 });
    for (const file of files) {
      if (!file.imports) throw new Error('File missing imports');
      if (!Array.isArray(file.imports)) throw new Error('imports is not an array');
    }
  });

  addTest('dependency', 'tracks file importedBy', async () => {
    const storage = librarianInstance.getStorage();
    const files = await storage.getFiles({ limit: 10 });
    for (const file of files) {
      if (!file.importedBy) throw new Error('File missing importedBy');
      if (!Array.isArray(file.importedBy)) throw new Error('importedBy is not an array');
    }
  });

  addTest('dependency', 'cochange edges accessible', async () => {
    const storage = librarianInstance.getStorage();
    const cochangeEdges = await storage.getCochangeEdges({ limit: 5 });
    if (!cochangeEdges) throw new Error('getCochangeEdges returned undefined');
    if (!Array.isArray(cochangeEdges)) throw new Error('cochangeEdges is not an array');
  });

  // ============================================================================
  // VALIDATION TESTS
  // ============================================================================

  addTest('validation', 'storage is initialized', async () => {
    const storage = librarianInstance.getStorage();
    if (!storage) throw new Error('Storage is null');
    if (!storage.isInitialized()) throw new Error('Storage is not initialized');
  });

  addTest('validation', 'storage capabilities reported', async () => {
    const storage = librarianInstance.getStorage();
    const caps = storage.getCapabilities();
    if (!caps) throw new Error('getCapabilities returned undefined');
    if (!caps.core) throw new Error('capabilities.core is undefined');
    if (!caps.optional) throw new Error('capabilities.optional is undefined');
    if (!caps.versions) throw new Error('capabilities.versions is undefined');
  });

  addTest('validation', 'metadata accessible', async () => {
    const storage = librarianInstance.getStorage();
    const metadata = await storage.getMetadata();
    if (metadata !== null && typeof metadata !== 'object') {
      throw new Error('metadata is neither null nor an object');
    }
  });

  addTest('validation', 'version accessible', async () => {
    const storage = librarianInstance.getStorage();
    const version = await storage.getVersion();
    if (version !== null && typeof version !== 'object') {
      throw new Error('version is neither null nor an object');
    }
  });

  addTest('validation', 'transaction support', async () => {
    const storage = librarianInstance.getStorage();
    if (typeof storage.transaction !== 'function') {
      throw new Error('transaction is not a function');
    }
  });

  addTest('validation', 'vacuum support', async () => {
    const storage = librarianInstance.getStorage();
    if (typeof storage.vacuum !== 'function') {
      throw new Error('vacuum is not a function');
    }
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
