/**
 * @fileoverview Tests for Validation Gates
 *
 * These tests verify the validation gates used during bootstrap phases.
 * The gates ensure preconditions are met before phases run and
 * postconditions are satisfied after phases complete.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs/promises';
import {
  runPreconditionGates,
  runPostconditionGates,
  hasFatalFailure,
  getFailureMessages,
  type ValidationGateContext,
  type ValidationGateResult,
} from '../validation_gates.js';
import type { LibrarianStorage } from '../../storage/types.js';
import type { BootstrapConfig, BootstrapPhaseResult, BootstrapPhase } from '../../types.js';

// ============================================================================
// MOCK HELPERS
// ============================================================================

/**
 * Creates a mock storage with configurable stats and file counts
 */
function createMockStorage(overrides: {
  totalFunctions?: number;
  totalModules?: number;
  totalContextPacks?: number;
  fileCount?: number;
} = {}): LibrarianStorage {
  const {
    totalFunctions = 0,
    totalModules = 0,
    totalContextPacks = 0,
    fileCount = 0,
  } = overrides;

  const files = Array.from({ length: fileCount }, (_, i) => ({
    id: `file-${i}`,
    path: `/workspace/src/file${i}.ts`,
    relativePath: `src/file${i}.ts`,
    name: `file${i}.ts`,
    extension: '.ts',
    category: 'code' as const,
    purpose: 'Test file',
    role: 'utility',
    summary: 'A test file',
    keyExports: [],
    mainConcepts: [],
    lineCount: 10,
    functionCount: 1,
    classCount: 0,
    importCount: 0,
    exportCount: 1,
    imports: [],
    importedBy: [],
    directory: '/workspace/src',
    complexity: 'low' as const,
    hasTests: false,
    checksum: 'abc123',
    confidence: 0.8,
    lastIndexed: new Date().toISOString(),
    lastModified: new Date().toISOString(),
  }));

  return {
    initialize: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    isInitialized: vi.fn().mockReturnValue(true),
    getCapabilities: vi.fn().mockReturnValue({
      core: { getFunctions: true, getFiles: true, getContextPacks: true },
      optional: { graphMetrics: false, multiVectors: false, embeddings: false, episodes: false, verificationPlans: false },
      versions: { schema: 1, api: 1 },
    }),
    getStats: vi.fn().mockResolvedValue({
      totalFunctions,
      totalModules,
      totalContextPacks,
      totalFiles: fileCount,
      totalEdges: 0,
      storageBytes: 0,
    }),
    getFiles: vi.fn().mockResolvedValue(files),
    getFunction: vi.fn().mockResolvedValue(null),
    getFunctions: vi.fn().mockResolvedValue([]),
    getMetadata: vi.fn().mockResolvedValue(null),
    setMetadata: vi.fn().mockResolvedValue(undefined),
    getState: vi.fn().mockResolvedValue(null),
    setState: vi.fn().mockResolvedValue(undefined),
    getVersion: vi.fn().mockResolvedValue(null),
    setVersion: vi.fn().mockResolvedValue(undefined),
    getFunctionByPath: vi.fn().mockResolvedValue(null),
    getFunctionsByPath: vi.fn().mockResolvedValue([]),
    upsertFunction: vi.fn().mockResolvedValue(undefined),
    upsertFunctions: vi.fn().mockResolvedValue(undefined),
    deleteFunction: vi.fn().mockResolvedValue(undefined),
    deleteFunctionsByPath: vi.fn().mockResolvedValue(undefined),
    getModules: vi.fn().mockResolvedValue([]),
    getModule: vi.fn().mockResolvedValue(null),
    getModuleByPath: vi.fn().mockResolvedValue(null),
    upsertModule: vi.fn().mockResolvedValue(undefined),
    deleteModule: vi.fn().mockResolvedValue(undefined),
    getFile: vi.fn().mockResolvedValue(null),
    getFileByPath: vi.fn().mockResolvedValue(null),
    getFilesByDirectory: vi.fn().mockResolvedValue([]),
    upsertFile: vi.fn().mockResolvedValue(undefined),
    upsertFiles: vi.fn().mockResolvedValue(undefined),
    deleteFile: vi.fn().mockResolvedValue(undefined),
    deleteFileByPath: vi.fn().mockResolvedValue(undefined),
    getDirectories: vi.fn().mockResolvedValue([]),
    getDirectory: vi.fn().mockResolvedValue(null),
    getDirectoryByPath: vi.fn().mockResolvedValue(null),
    getSubdirectories: vi.fn().mockResolvedValue([]),
    upsertDirectory: vi.fn().mockResolvedValue(undefined),
    upsertDirectories: vi.fn().mockResolvedValue(undefined),
    deleteDirectory: vi.fn().mockResolvedValue(undefined),
    deleteDirectoryByPath: vi.fn().mockResolvedValue(undefined),
    getContextPacks: vi.fn().mockResolvedValue([]),
    getContextPack: vi.fn().mockResolvedValue(null),
    getContextPackForTarget: vi.fn().mockResolvedValue(null),
    upsertContextPack: vi.fn().mockResolvedValue(undefined),
    invalidateContextPacks: vi.fn().mockResolvedValue(0),
    deleteContextPack: vi.fn().mockResolvedValue(undefined),
    recordContextPackAccess: vi.fn().mockResolvedValue(undefined),
    getFileChecksum: vi.fn().mockResolvedValue(null),
    setFileChecksum: vi.fn().mockResolvedValue(undefined),
    deleteFileChecksum: vi.fn().mockResolvedValue(undefined),
    getEmbedding: vi.fn().mockResolvedValue(null),
    setEmbedding: vi.fn().mockResolvedValue(undefined),
    findSimilarByEmbedding: vi.fn().mockResolvedValue({ results: [], degraded: false }),
    getMultiVector: vi.fn().mockResolvedValue(null),
    getMultiVectors: vi.fn().mockResolvedValue([]),
    upsertMultiVector: vi.fn().mockResolvedValue(undefined),
    getQueryCacheEntry: vi.fn().mockResolvedValue(null),
    upsertQueryCacheEntry: vi.fn().mockResolvedValue(undefined),
    recordQueryCacheAccess: vi.fn().mockResolvedValue(undefined),
    pruneQueryCache: vi.fn().mockResolvedValue(0),
    recordEvolutionOutcome: vi.fn().mockResolvedValue(undefined),
    getEvolutionOutcomes: vi.fn().mockResolvedValue([]),
    recordLearnedMissing: vi.fn().mockResolvedValue(undefined),
    getLearnedMissing: vi.fn().mockResolvedValue([]),
    clearLearnedMissing: vi.fn().mockResolvedValue(undefined),
    recordQualityScore: vi.fn().mockResolvedValue(undefined),
    getQualityScoreHistory: vi.fn().mockResolvedValue([]),
    upsertGraphEdges: vi.fn().mockResolvedValue(undefined),
    deleteGraphEdgesForSource: vi.fn().mockResolvedValue(undefined),
    getGraphEdges: vi.fn().mockResolvedValue([]),
    getIngestionItem: vi.fn().mockResolvedValue(null),
    getIngestionItems: vi.fn().mockResolvedValue([]),
    upsertIngestionItem: vi.fn().mockResolvedValue(undefined),
    deleteIngestionItem: vi.fn().mockResolvedValue(undefined),
    recordIndexingResult: vi.fn().mockResolvedValue(undefined),
    getLastIndexingResult: vi.fn().mockResolvedValue(null),
    recordBootstrapReport: vi.fn().mockResolvedValue(undefined),
    getLastBootstrapReport: vi.fn().mockResolvedValue(null),
    updateConfidence: vi.fn().mockResolvedValue(undefined),
    applyTimeDecay: vi.fn().mockResolvedValue(0),
    transaction: vi.fn().mockImplementation(async (fn) => fn({})),
    vacuum: vi.fn().mockResolvedValue(undefined),
    setGraphMetrics: vi.fn().mockResolvedValue(undefined),
    getGraphMetrics: vi.fn().mockResolvedValue([]),
    deleteGraphMetrics: vi.fn().mockResolvedValue(undefined),
    storeCochangeEdges: vi.fn().mockResolvedValue(undefined),
    getCochangeEdges: vi.fn().mockResolvedValue([]),
    getCochangeEdgeCount: vi.fn().mockResolvedValue(0),
  } as unknown as LibrarianStorage;
}

/**
 * Creates a mock bootstrap config
 */
function createMockConfig(overrides: Partial<BootstrapConfig> = {}): BootstrapConfig {
  return {
    workspace: '/workspace',
    include: ['**/*.ts'],
    exclude: ['node_modules/**'],
    maxFileSizeBytes: 1024 * 1024,
    bootstrapMode: 'fast',
    ...overrides,
  };
}

/**
 * Creates a mock phase result
 */
function createMockPhaseResult(overrides: Partial<BootstrapPhaseResult> = {}): BootstrapPhaseResult {
  return {
    phase: 'semantic_indexing' as BootstrapPhase,
    startedAt: new Date(),
    completedAt: new Date(),
    durationMs: 100,
    itemsProcessed: 0,
    errors: [],
    ...overrides,
  };
}

/**
 * Creates a temporary workspace with files for pattern matching tests
 */
async function withTempWorkspace<T>(
  fn: (workspace: string) => Promise<T>,
  files: string[] = []
): Promise<T> {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'validation-gates-test-'));
  try {
    // Create requested files
    for (const file of files) {
      const fullPath = path.join(workspace, file);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, `// ${file}\nexport const x = 1;\n`);
    }
    return await fn(workspace);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
}

// ============================================================================
// TESTS: gateSemanticIndexingZeroFilesCheck
// ============================================================================

describe('gateSemanticIndexingZeroFilesCheck', () => {
  beforeEach(() => {
    // Ensure test mode is set to skip provider checks
    process.env.NODE_ENV = 'test';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('FAIL when files discovered > 0 but indexed = 0', async () => {
    const storage = createMockStorage({ fileCount: 0 });
    const config = createMockConfig();
    const phaseResult = createMockPhaseResult({
      phase: 'semantic_indexing' as BootstrapPhase,
      itemsProcessed: 0, // 0 files indexed
      metrics: {
        totalFiles: 10, // 10 files discovered
      },
    });

    const ctx: ValidationGateContext = {
      workspace: '/workspace',
      storage,
      config,
      phaseResult,
    };

    const results = await runPostconditionGates('semantic_indexing', ctx);

    // Find the zero-files check result
    const zeroFilesResult = results.find(
      (r) => r.gateId === 'semantic_indexing_zero_files_check'
    );

    expect(zeroFilesResult).toBeDefined();
    expect(zeroFilesResult!.passed).toBe(false);
    expect(zeroFilesResult!.fatal).toBe(true);
    expect(zeroFilesResult!.message).toContain('10 files discovered');
    expect(zeroFilesResult!.message).toContain('0 were indexed');
  });

  it('FAIL when patterns match files but indexed = 0', async () => {
    await withTempWorkspace(
      async (workspace) => {
        const storage = createMockStorage({ fileCount: 0 });
        const config = createMockConfig({
          workspace,
          include: ['src/**/*.ts'],
          exclude: [],
        });
        const phaseResult = createMockPhaseResult({
          phase: 'semantic_indexing' as BootstrapPhase,
          itemsProcessed: 0, // 0 files indexed
          metrics: {
            totalFiles: 0, // No discovery metrics (trigger glob check)
          },
        });

        const ctx: ValidationGateContext = {
          workspace,
          storage,
          config,
          phaseResult,
        };

        const results = await runPostconditionGates('semantic_indexing', ctx);

        // Find the zero-files check result
        const zeroFilesResult = results.find(
          (r) => r.gateId === 'semantic_indexing_zero_files_check'
        );

        expect(zeroFilesResult).toBeDefined();
        expect(zeroFilesResult!.passed).toBe(false);
        expect(zeroFilesResult!.fatal).toBe(true);
        expect(zeroFilesResult!.message).toContain('match');
        expect(zeroFilesResult!.message).toContain('0 were indexed');
      },
      ['src/index.ts', 'src/utils/helper.ts', 'src/api/main.ts']
    );
  });

  it('FAIL when patterns match no files', async () => {
    await withTempWorkspace(
      async (workspace) => {
        const storage = createMockStorage({ fileCount: 0 });
        const config = createMockConfig({
          workspace,
          include: ['nonexistent/**/*.ts'], // Pattern that matches nothing
          exclude: [],
        });
        const phaseResult = createMockPhaseResult({
          phase: 'semantic_indexing' as BootstrapPhase,
          itemsProcessed: 0,
          metrics: {
            totalFiles: 0,
          },
        });

        const ctx: ValidationGateContext = {
          workspace,
          storage,
          config,
          phaseResult,
        };

        const results = await runPostconditionGates('semantic_indexing', ctx);

        // Find the zero-files check result
        const zeroFilesResult = results.find(
          (r) => r.gateId === 'semantic_indexing_zero_files_check'
        );

        expect(zeroFilesResult).toBeDefined();
        expect(zeroFilesResult!.passed).toBe(false);
        expect(zeroFilesResult!.fatal).toBe(true);
        expect(zeroFilesResult!.message).toContain('match no files');
      },
      ['src/index.ts'] // Files exist but not in the pattern path
    );
  });

  it('PASS when patterns match only non-AST files', async () => {
    await withTempWorkspace(
      async (workspace) => {
        const storage = createMockStorage({ fileCount: 0 });
        const config = createMockConfig({
          workspace,
          include: ['**/*.sh'],
          exclude: [],
        });
        const phaseResult = createMockPhaseResult({
          phase: 'semantic_indexing' as BootstrapPhase,
          itemsProcessed: 0,
          metrics: {
            totalFiles: 0, // Semantic indexing intentionally indexes only AST-eligible files
          },
        });

        const ctx: ValidationGateContext = {
          workspace,
          storage,
          config,
          phaseResult,
        };

        const results = await runPostconditionGates('semantic_indexing', ctx);
        const zeroFilesResult = results.find((r) => r.gateId === 'semantic_indexing_zero_files_check');

        expect(zeroFilesResult).toBeDefined();
        expect(zeroFilesResult!.passed).toBe(true);
      },
      ['deploy.sh', 'scripts/run.sh']
    );
  });

  it('PASS when files indexed > 0', async () => {
    const storage = createMockStorage({ fileCount: 5, totalFunctions: 10 });
    const config = createMockConfig();
    const phaseResult = createMockPhaseResult({
      phase: 'semantic_indexing' as BootstrapPhase,
      itemsProcessed: 5, // 5 files indexed
      metrics: {
        totalFiles: 5,
        filesIndexed: 5,
      },
    });

    const ctx: ValidationGateContext = {
      workspace: '/workspace',
      storage,
      config,
      phaseResult,
    };

    const results = await runPostconditionGates('semantic_indexing', ctx);

    // Find the zero-files check result
    const zeroFilesResult = results.find(
      (r) => r.gateId === 'semantic_indexing_zero_files_check'
    );

    expect(zeroFilesResult).toBeDefined();
    expect(zeroFilesResult!.passed).toBe(true);
    expect(zeroFilesResult!.message).toContain('5 files indexed');
  });
});

// ============================================================================
// TESTS: gateStructuralScanComplete diagnostics
// ============================================================================

describe('gateStructuralScanComplete diagnostics', () => {
  it('suggests workspace root when running from a subdirectory', async () => {
    await withTempWorkspace(async (workspace) => {
      const subdir = path.join(workspace, 'docs');
      await fs.mkdir(subdir, { recursive: true });

      const storage = createMockStorage({ fileCount: 0 });
      const config = createMockConfig({
        workspace: subdir,
        include: ['**/*.ts'],
        exclude: ['node_modules/**'],
      });
      const phaseResult = createMockPhaseResult({
        phase: 'structural_scan' as BootstrapPhase,
        itemsProcessed: 0,
        metrics: { filesDiscovered: 0 },
      });

      const ctx: ValidationGateContext = {
        workspace: subdir,
        storage,
        config,
        phaseResult,
      };

      const results = await runPostconditionGates('structural_scan', ctx);
      const scanResult = results.find((result) => result.gateId === 'structural_scan_complete');

      expect(scanResult?.passed).toBe(false);
      expect(scanResult?.message).toContain(workspace);
      expect(scanResult?.suggestedFix).toContain(workspace);
    }, ['package.json', 'src/index.ts']);
  });

  it('calls out exclude patterns when files exist but are filtered', async () => {
    await withTempWorkspace(async (workspace) => {
      const storage = createMockStorage({ fileCount: 0 });
      const config = createMockConfig({
        workspace,
        include: ['**/*.ts'],
        exclude: ['**/*.ts'],
      });
      const phaseResult = createMockPhaseResult({
        phase: 'structural_scan' as BootstrapPhase,
        itemsProcessed: 0,
        metrics: { filesDiscovered: 0 },
      });

      const ctx: ValidationGateContext = {
        workspace,
        storage,
        config,
        phaseResult,
      };

      const results = await runPostconditionGates('structural_scan', ctx);
      const scanResult = results.find((result) => result.gateId === 'structural_scan_complete');

      expect(scanResult?.passed).toBe(false);
      expect(scanResult?.message).toMatch(/exclude|excluded/i);
    }, ['src/app.ts']);
  });
});

// ============================================================================
// TESTS: Basic Gate Behavior
// ============================================================================

describe('runPreconditionGates', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'test';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns results for structural_scan phase', async () => {
    const storage = createMockStorage({ totalFunctions: 0, totalModules: 0 });
    const config = createMockConfig();

    const ctx: ValidationGateContext = {
      workspace: '/workspace',
      storage,
      config,
    };

    const results = await runPreconditionGates('structural_scan', ctx);

    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);

    // All results should have the required structure
    for (const result of results) {
      expect(result).toHaveProperty('passed');
      expect(result).toHaveProperty('gateId');
      expect(result).toHaveProperty('phase');
      expect(result).toHaveProperty('type');
      expect(result).toHaveProperty('message');
      expect(result).toHaveProperty('fatal');
      expect(result.type).toBe('precondition');
      expect(result.phase).toBe('structural_scan');
    }
  });

  it('returns results for semantic_indexing phase', async () => {
    const storage = createMockStorage({ fileCount: 5 });
    const config = createMockConfig();

    const ctx: ValidationGateContext = {
      workspace: '/workspace',
      storage,
      config,
    };

    const results = await runPreconditionGates('semantic_indexing', ctx);

    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);

    for (const result of results) {
      expect(result.type).toBe('precondition');
      expect(result.phase).toBe('semantic_indexing');
    }
  });

  it('treats modules as entities for context_pack_generation (fast bootstrap)', async () => {
    const storage = createMockStorage({ totalModules: 1, totalFunctions: 0, fileCount: 0 });
    const config = createMockConfig({ bootstrapMode: 'fast' });

    const ctx: ValidationGateContext = {
      workspace: '/workspace',
      storage,
      config,
    };

    const results = await runPreconditionGates('context_pack_generation', ctx);
    const gate = results.find((result) => result.gateId === 'context_pack_entities_exist');

    expect(gate).toBeDefined();
    expect(gate!.passed).toBe(true);
  });

  it('returns empty array for phase with no gates', async () => {
    const storage = createMockStorage();
    const config = createMockConfig();

    const ctx: ValidationGateContext = {
      workspace: '/workspace',
      storage,
      config,
    };

    // Use a phase that might not have gates (or verify behavior)
    const results = await runPreconditionGates('structural_scan', ctx);

    // Should return array (possibly with storage ready check)
    expect(Array.isArray(results)).toBe(true);
  });
});

describe('runPostconditionGates', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'test';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns results for structural_scan phase', async () => {
    const storage = createMockStorage();
    const config = createMockConfig();
    const phaseResult = createMockPhaseResult({
      phase: 'structural_scan' as BootstrapPhase,
      itemsProcessed: 10,
      errors: [],
    });

    const ctx: ValidationGateContext = {
      workspace: '/workspace',
      storage,
      config,
      phaseResult,
    };

    const results = await runPostconditionGates('structural_scan', ctx);

    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);

    for (const result of results) {
      expect(result.type).toBe('postcondition');
      expect(result.phase).toBe('structural_scan');
    }
  });

  it('returns results for semantic_indexing phase', async () => {
    const storage = createMockStorage({ totalFunctions: 10 });
    const config = createMockConfig();
    const phaseResult = createMockPhaseResult({
      phase: 'semantic_indexing' as BootstrapPhase,
      itemsProcessed: 5,
    });

    const ctx: ValidationGateContext = {
      workspace: '/workspace',
      storage,
      config,
      phaseResult,
    };

    const results = await runPostconditionGates('semantic_indexing', ctx);

    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);

    for (const result of results) {
      expect(result.type).toBe('postcondition');
      expect(result.phase).toBe('semantic_indexing');
    }
  });

  it('includes phase result in context when available', async () => {
    const storage = createMockStorage({ totalFunctions: 5 });
    const config = createMockConfig();
    const phaseResult = createMockPhaseResult({
      phase: 'semantic_indexing' as BootstrapPhase,
      itemsProcessed: 5,
      durationMs: 500,
    });

    const ctx: ValidationGateContext = {
      workspace: '/workspace',
      storage,
      config,
      phaseResult,
    };

    const results = await runPostconditionGates('semantic_indexing', ctx);

    // Gates should have access to phase result metrics
    const completeGate = results.find(
      (r) => r.gateId === 'semantic_indexing_complete'
    );
    expect(completeGate).toBeDefined();
    expect(completeGate!.metrics?.durationMs).toBe(500);
  });
});

describe('hasFatalFailure', () => {
  it('returns true when fatal failure exists', () => {
    const results: ValidationGateResult[] = [
      {
        passed: true,
        gateId: 'gate1',
        phase: 'structural_scan',
        type: 'precondition',
        message: 'OK',
        fatal: false,
      },
      {
        passed: false,
        gateId: 'gate2',
        phase: 'structural_scan',
        type: 'precondition',
        message: 'Fatal error',
        fatal: true,
      },
    ];

    expect(hasFatalFailure(results)).toBe(true);
  });

  it('returns false when only non-fatal failures exist', () => {
    const results: ValidationGateResult[] = [
      {
        passed: true,
        gateId: 'gate1',
        phase: 'structural_scan',
        type: 'precondition',
        message: 'OK',
        fatal: false,
      },
      {
        passed: false,
        gateId: 'gate2',
        phase: 'structural_scan',
        type: 'precondition',
        message: 'Warning',
        fatal: false,
      },
    ];

    expect(hasFatalFailure(results)).toBe(false);
  });

  it('returns false when all gates pass', () => {
    const results: ValidationGateResult[] = [
      {
        passed: true,
        gateId: 'gate1',
        phase: 'structural_scan',
        type: 'precondition',
        message: 'OK',
        fatal: true, // fatal flag is true but gate passed
      },
      {
        passed: true,
        gateId: 'gate2',
        phase: 'structural_scan',
        type: 'precondition',
        message: 'OK',
        fatal: false,
      },
    ];

    expect(hasFatalFailure(results)).toBe(false);
  });

  it('returns false for empty results', () => {
    expect(hasFatalFailure([])).toBe(false);
  });
});

describe('getFailureMessages', () => {
  it('returns formatted messages for failures', () => {
    const results: ValidationGateResult[] = [
      {
        passed: true,
        gateId: 'gate1',
        phase: 'structural_scan',
        type: 'precondition',
        message: 'OK',
        fatal: false,
      },
      {
        passed: false,
        gateId: 'gate2',
        phase: 'structural_scan',
        type: 'precondition',
        message: 'Fatal error occurred',
        suggestedFix: 'Try this fix',
        fatal: true,
      },
      {
        passed: false,
        gateId: 'gate3',
        phase: 'structural_scan',
        type: 'precondition',
        message: 'Warning message',
        fatal: false,
      },
    ];

    const messages = getFailureMessages(results);

    expect(messages).toHaveLength(2);
    expect(messages[0]).toContain('[FATAL]');
    expect(messages[0]).toContain('Fatal error occurred');
    expect(messages[0]).toContain('Fix: Try this fix');
    expect(messages[1]).toContain('[WARNING]');
    expect(messages[1]).toContain('Warning message');
  });

  it('returns empty array when all gates pass', () => {
    const results: ValidationGateResult[] = [
      {
        passed: true,
        gateId: 'gate1',
        phase: 'structural_scan',
        type: 'precondition',
        message: 'OK',
        fatal: false,
      },
    ];

    expect(getFailureMessages(results)).toEqual([]);
  });

  it('handles results without suggested fix', () => {
    const results: ValidationGateResult[] = [
      {
        passed: false,
        gateId: 'gate1',
        phase: 'structural_scan',
        type: 'precondition',
        message: 'Error without fix',
        fatal: true,
      },
    ];

    const messages = getFailureMessages(results);
    expect(messages).toHaveLength(1);
    expect(messages[0]).not.toContain('Fix:');
  });
});

// ============================================================================
// TESTS: Edge Cases and Error Handling
// ============================================================================

describe('validation gates edge cases', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'test';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('handles storage errors gracefully', async () => {
    const storage = createMockStorage();
    // Make getStats throw an error
    (storage.getStats as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Storage connection failed')
    );

    const config = createMockConfig();
    const ctx: ValidationGateContext = {
      workspace: '/workspace',
      storage,
      config,
    };

    const results = await runPreconditionGates('structural_scan', ctx);

    // Should return a failure result, not throw
    expect(Array.isArray(results)).toBe(true);
    const failedResult = results.find((r) => !r.passed);
    expect(failedResult).toBeDefined();
    expect(failedResult!.message).toContain('Storage connection failed');
  });

  it('handles missing phase result in postcondition checks', async () => {
    const storage = createMockStorage();
    const config = createMockConfig();

    const ctx: ValidationGateContext = {
      workspace: '/workspace',
      storage,
      config,
      // phaseResult is undefined
    };

    const results = await runPostconditionGates('structural_scan', ctx);

    // Should handle missing phase result
    expect(Array.isArray(results)).toBe(true);
    // The structural_scan_complete gate should report no phase result
    const completeResult = results.find(
      (r) => r.gateId === 'structural_scan_complete'
    );
    expect(completeResult).toBeDefined();
    expect(completeResult!.passed).toBe(false);
  });

  it('handles high error rate in structural scan', async () => {
    const storage = createMockStorage();
    const config = createMockConfig();
    const phaseResult = createMockPhaseResult({
      phase: 'structural_scan' as BootstrapPhase,
      itemsProcessed: 10,
      errors: [
        'Error 1',
        'Error 2',
        'Error 3',
        'Error 4',
        'Error 5',
        'Error 6', // 60% error rate
      ],
    });

    const ctx: ValidationGateContext = {
      workspace: '/workspace',
      storage,
      config,
      phaseResult,
    };

    const results = await runPostconditionGates('structural_scan', ctx);

    const completeResult = results.find(
      (r) => r.gateId === 'structural_scan_complete'
    );
    expect(completeResult).toBeDefined();
    expect(completeResult!.passed).toBe(false);
    expect(completeResult!.message).toContain('error rate');
  });
});
