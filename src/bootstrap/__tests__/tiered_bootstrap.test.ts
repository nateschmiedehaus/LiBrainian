/**
 * @fileoverview Tests for Tiered Bootstrap System
 *
 * Tests progressive bootstrap functionality including:
 * - Tier completion within time budgets
 * - Progressive feature enablement
 * - Abort signal handling
 * - Progress callbacks
 * - Error handling and recovery
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {
  TieredBootstrap,
  createTieredBootstrap,
  BootstrapTier,
  FEATURES,
  TIER_FEATURES,
  type TieredBootstrapOptions,
  type TierStats,
} from '../tiered_bootstrap.js';
import type { LibrarianStorage } from '../../storage/types.js';

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Create a minimal mock storage for testing.
 */
function createMockStorage(): LibrarianStorage {
  const files = new Map<string, unknown>();
  const directories = new Map<string, unknown>();

  return {
    initialize: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    isInitialized: vi.fn().mockReturnValue(true),
    getCapabilities: vi.fn().mockReturnValue({
      core: { getFunctions: true, getFiles: true, getContextPacks: true },
      optional: {},
      versions: { schema: 1, api: 1 },
    }),
    getMetadata: vi.fn().mockResolvedValue(null),
    setMetadata: vi.fn().mockResolvedValue(undefined),
    getState: vi.fn().mockResolvedValue(null),
    setState: vi.fn().mockResolvedValue(undefined),
    getVersion: vi.fn().mockResolvedValue(null),
    setVersion: vi.fn().mockResolvedValue(undefined),
    getFiles: vi.fn().mockImplementation(async () => Array.from(files.values())),
    getFile: vi.fn().mockImplementation(async (id) => files.get(id) ?? null),
    getFileByPath: vi.fn().mockImplementation(async (path) => {
      for (const file of files.values()) {
        if ((file as { path?: string }).path === path) return file;
      }
      return null;
    }),
    getFilesByDirectory: vi.fn().mockResolvedValue([]),
    upsertFile: vi.fn().mockImplementation(async (file) => {
      files.set(file.id, file);
    }),
    upsertFiles: vi.fn().mockImplementation(async (fileList) => {
      for (const file of fileList) {
        files.set(file.id, file);
      }
    }),
    deleteFile: vi.fn().mockResolvedValue(undefined),
    deleteFileByPath: vi.fn().mockResolvedValue(undefined),
    getDirectories: vi.fn().mockImplementation(async () => Array.from(directories.values())),
    getDirectory: vi.fn().mockImplementation(async (id) => directories.get(id) ?? null),
    getDirectoryByPath: vi.fn().mockResolvedValue(null),
    getSubdirectories: vi.fn().mockResolvedValue([]),
    upsertDirectory: vi.fn().mockImplementation(async (dir) => {
      directories.set(dir.id, dir);
    }),
    upsertDirectories: vi.fn().mockImplementation(async (dirList) => {
      for (const dir of dirList) {
        directories.set(dir.id, dir);
      }
    }),
    deleteDirectory: vi.fn().mockResolvedValue(undefined),
    deleteDirectoryByPath: vi.fn().mockResolvedValue(undefined),
    // Add remaining required methods as stubs
    getFunctions: vi.fn().mockResolvedValue([]),
    getFunction: vi.fn().mockResolvedValue(null),
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
    transaction: vi.fn().mockImplementation(async (fn) => fn({
      upsertFunction: vi.fn(),
      upsertModule: vi.fn(),
      upsertContextPack: vi.fn(),
      upsertIngestionItem: vi.fn(),
      upsertTestMapping: vi.fn(),
      upsertCommit: vi.fn(),
      upsertOwnership: vi.fn(),
      setEmbedding: vi.fn(),
      upsertMultiVector: vi.fn(),
      deleteFunction: vi.fn(),
      deleteFunctionsByPath: vi.fn(),
      deleteModule: vi.fn(),
      upsertFile: vi.fn(),
      upsertFiles: vi.fn(),
      upsertDirectory: vi.fn(),
      upsertDirectories: vi.fn(),
      upsertAssessment: vi.fn(),
      upsertAssessments: vi.fn(),
      deleteFileByPath: vi.fn(),
      deleteUniversalKnowledgeByFile: vi.fn(),
      deleteContextPack: vi.fn(),
      invalidateContextPacks: vi.fn(),
      upsertGraphEdges: vi.fn(),
      deleteGraphEdgesForSource: vi.fn(),
      setFileChecksum: vi.fn(),
    })),
    vacuum: vi.fn().mockResolvedValue(undefined),
    getStats: vi.fn().mockResolvedValue({
      totalFunctions: 0,
      totalModules: 0,
      totalContextPacks: 0,
      totalEmbeddings: 0,
      storageSizeBytes: 0,
      lastVacuum: null,
      averageConfidence: 0,
      cacheHitRate: 0,
    }),
    setGraphMetrics: vi.fn().mockResolvedValue(undefined),
    getGraphMetrics: vi.fn().mockResolvedValue([]),
    deleteGraphMetrics: vi.fn().mockResolvedValue(undefined),
    storeCochangeEdges: vi.fn().mockResolvedValue(undefined),
    getCochangeEdges: vi.fn().mockResolvedValue([]),
    getCochangeEdgeCount: vi.fn().mockResolvedValue(0),
    deleteCochangeEdges: vi.fn().mockResolvedValue(undefined),
    setEvidence: vi.fn().mockResolvedValue(undefined),
    getEvidenceForTarget: vi.fn().mockResolvedValue([]),
    deleteEvidence: vi.fn().mockResolvedValue(undefined),
    getConfidenceEvents: vi.fn().mockResolvedValue([]),
    countConfidenceUpdates: vi.fn().mockResolvedValue(0),
    getTestMapping: vi.fn().mockResolvedValue(null),
    getTestMappings: vi.fn().mockResolvedValue([]),
    getTestMappingsByTestPath: vi.fn().mockResolvedValue([]),
    getTestMappingsBySourcePath: vi.fn().mockResolvedValue([]),
    upsertTestMapping: vi.fn().mockResolvedValue({ id: '1', testPath: '', sourcePath: '', confidence: 1, createdAt: new Date(), updatedAt: new Date() }),
    deleteTestMapping: vi.fn().mockResolvedValue(undefined),
    deleteTestMappingsByTestPath: vi.fn().mockResolvedValue(0),
    getCommit: vi.fn().mockResolvedValue(null),
    getCommitBySha: vi.fn().mockResolvedValue(null),
    getCommits: vi.fn().mockResolvedValue([]),
    upsertCommit: vi.fn().mockResolvedValue({ id: '1', sha: '', message: '', author: '', category: '', filesChanged: [], createdAt: new Date() }),
    deleteCommit: vi.fn().mockResolvedValue(undefined),
    deleteCommitBySha: vi.fn().mockResolvedValue(undefined),
    getOwnership: vi.fn().mockResolvedValue(null),
    getOwnershipByFilePath: vi.fn().mockResolvedValue([]),
    getOwnershipByAuthor: vi.fn().mockResolvedValue([]),
    getOwnerships: vi.fn().mockResolvedValue([]),
    upsertOwnership: vi.fn().mockResolvedValue({ id: '1', filePath: '', author: '', score: 0, lastModified: new Date(), createdAt: new Date() }),
    deleteOwnership: vi.fn().mockResolvedValue(undefined),
    deleteOwnershipByFilePath: vi.fn().mockResolvedValue(0),
    getUniversalKnowledge: vi.fn().mockResolvedValue(null),
    getUniversalKnowledgeByFile: vi.fn().mockResolvedValue([]),
    getUniversalKnowledgeByKind: vi.fn().mockResolvedValue([]),
    queryUniversalKnowledge: vi.fn().mockResolvedValue([]),
    upsertUniversalKnowledge: vi.fn().mockResolvedValue(undefined),
    upsertUniversalKnowledgeBatch: vi.fn().mockResolvedValue(undefined),
    deleteUniversalKnowledge: vi.fn().mockResolvedValue(undefined),
    deleteUniversalKnowledgeByFile: vi.fn().mockResolvedValue(0),
    searchUniversalKnowledgeBySimilarity: vi.fn().mockResolvedValue([]),
    getAssessment: vi.fn().mockResolvedValue(null),
    getAssessmentByPath: vi.fn().mockResolvedValue(null),
    getAssessments: vi.fn().mockResolvedValue([]),
    upsertAssessment: vi.fn().mockResolvedValue(undefined),
    upsertAssessments: vi.fn().mockResolvedValue(undefined),
    deleteAssessment: vi.fn().mockResolvedValue(undefined),
    deleteAssessmentByPath: vi.fn().mockResolvedValue(undefined),
    getSCCEntries: vi.fn().mockResolvedValue([]),
    getSCCByEntity: vi.fn().mockResolvedValue(null),
    upsertSCCEntries: vi.fn().mockResolvedValue(undefined),
    deleteSCCEntries: vi.fn().mockResolvedValue(undefined),
    getCFGEdges: vi.fn().mockResolvedValue([]),
    getCFGForFunction: vi.fn().mockResolvedValue([]),
    upsertCFGEdges: vi.fn().mockResolvedValue(undefined),
    deleteCFGEdgesForFunction: vi.fn().mockResolvedValue(undefined),
    getBayesianConfidence: vi.fn().mockResolvedValue(null),
    getBayesianConfidences: vi.fn().mockResolvedValue([]),
    upsertBayesianConfidence: vi.fn().mockResolvedValue(undefined),
    updateBayesianConfidence: vi.fn().mockResolvedValue(undefined),
    getStabilityMetrics: vi.fn().mockResolvedValue(null),
    getStabilityMetricsList: vi.fn().mockResolvedValue([]),
    upsertStabilityMetrics: vi.fn().mockResolvedValue(undefined),
    getFeedbackLoop: vi.fn().mockResolvedValue(null),
    getFeedbackLoops: vi.fn().mockResolvedValue([]),
    upsertFeedbackLoop: vi.fn().mockResolvedValue(undefined),
    resolveFeedbackLoop: vi.fn().mockResolvedValue(undefined),
    getGraphCacheEntry: vi.fn().mockResolvedValue(null),
    upsertGraphCacheEntry: vi.fn().mockResolvedValue(undefined),
    pruneExpiredGraphCache: vi.fn().mockResolvedValue(0),
    getBlameEntries: vi.fn().mockResolvedValue([]),
    getBlameForFile: vi.fn().mockResolvedValue([]),
    getBlameStats: vi.fn().mockResolvedValue(null),
    upsertBlameEntries: vi.fn().mockResolvedValue(undefined),
    deleteBlameForFile: vi.fn().mockResolvedValue(0),
    getDiffRecords: vi.fn().mockResolvedValue([]),
    getDiffForCommit: vi.fn().mockResolvedValue([]),
    upsertDiffRecords: vi.fn().mockResolvedValue(undefined),
    deleteDiffForCommit: vi.fn().mockResolvedValue(0),
    getReflogEntries: vi.fn().mockResolvedValue([]),
    upsertReflogEntries: vi.fn().mockResolvedValue(undefined),
    deleteReflogEntries: vi.fn().mockResolvedValue(0),
    getCloneEntries: vi.fn().mockResolvedValue([]),
    getClonesByEntity: vi.fn().mockResolvedValue([]),
    getCloneClusters: vi.fn().mockResolvedValue([]),
    upsertCloneEntries: vi.fn().mockResolvedValue(undefined),
    deleteCloneEntries: vi.fn().mockResolvedValue(0),
    getDebtMetrics: vi.fn().mockResolvedValue([]),
    getDebtForEntity: vi.fn().mockResolvedValue(null),
    getDebtHotspots: vi.fn().mockResolvedValue([]),
    upsertDebtMetrics: vi.fn().mockResolvedValue(undefined),
    deleteDebtMetrics: vi.fn().mockResolvedValue(undefined),
    getKnowledgeEdges: vi.fn().mockResolvedValue([]),
    getKnowledgeEdgesFrom: vi.fn().mockResolvedValue([]),
    getKnowledgeEdgesTo: vi.fn().mockResolvedValue([]),
    getKnowledgeSubgraph: vi.fn().mockResolvedValue({ nodes: [], edges: [], metrics: { nodeCount: 0, edgeCount: 0, density: 0, avgDegree: 0 } }),
    upsertKnowledgeEdges: vi.fn().mockResolvedValue(undefined),
    deleteKnowledgeEdge: vi.fn().mockResolvedValue(undefined),
    deleteKnowledgeEdgesForEntity: vi.fn().mockResolvedValue(0),
    getFaultLocalizations: vi.fn().mockResolvedValue([]),
    upsertFaultLocalization: vi.fn().mockResolvedValue(undefined),
    deleteFaultLocalization: vi.fn().mockResolvedValue(undefined),
  } as unknown as LibrarianStorage;
}

/**
 * Create a test workspace with sample files.
 */
async function createTestWorkspace(): Promise<string> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tiered-bootstrap-test-'));

  // Create directory structure
  await fs.mkdir(path.join(tempDir, 'src'), { recursive: true });
  await fs.mkdir(path.join(tempDir, 'src', 'utils'), { recursive: true });
  await fs.mkdir(path.join(tempDir, 'src', '__tests__'), { recursive: true });

  // Create package.json
  await fs.writeFile(
    path.join(tempDir, 'package.json'),
    JSON.stringify({
      name: 'test-project',
      main: './src/index.js',
      exports: {
        '.': './src/index.js',
        './utils': './src/utils/index.js',
      },
    })
  );

  // Create source files
  await fs.writeFile(
    path.join(tempDir, 'src', 'index.ts'),
    `
export { helper } from './utils/helper.js';
export { Config } from './config.js';

export function main(): void {
  console.log('Hello, world!');
}

export async function asyncMain(): Promise<void> {
  await Promise.resolve();
}
`
  );

  await fs.writeFile(
    path.join(tempDir, 'src', 'config.ts'),
    `
export interface Config {
  name: string;
  value: number;
}

export const DEFAULT_CONFIG: Config = {
  name: 'default',
  value: 42,
};

export class ConfigManager {
  private config: Config;

  constructor(config?: Config) {
    this.config = config ?? DEFAULT_CONFIG;
  }

  get(key: keyof Config): Config[keyof Config] {
    return this.config[key];
  }
}
`
  );

  await fs.writeFile(
    path.join(tempDir, 'src', 'utils', 'index.ts'),
    `
export { helper } from './helper.js';
export { format } from './format.js';
`
  );

  await fs.writeFile(
    path.join(tempDir, 'src', 'utils', 'helper.ts'),
    `
import { format } from './format.js';

export function helper(value: string): string {
  return format(value.toUpperCase());
}

const privateHelper = (): void => {};
`
  );

  await fs.writeFile(
    path.join(tempDir, 'src', 'utils', 'format.ts'),
    `
export function format(value: string): string {
  return \`[formatted: \${value}]\`;
}

export type FormatOptions = {
  prefix?: string;
  suffix?: string;
};
`
  );

  await fs.writeFile(
    path.join(tempDir, 'src', '__tests__', 'index.test.ts'),
    `
import { describe, it, expect } from 'vitest';
import { main } from '../index.js';

describe('main', () => {
  it('should work', () => {
    expect(main).toBeDefined();
  });
});
`
  );

  await fs.writeFile(
    path.join(tempDir, 'src', 'script.py'),
    `
import os

def run():
  return os.getenv('PATH')

def compute(value):
  return value * 2
`
  );

  await fs.writeFile(
    path.join(tempDir, 'src', 'service.go'),
    `
package service

import "fmt"

func Start() {
  fmt.Println("starting")
}
`
  );

  await fs.writeFile(
    path.join(tempDir, 'ci.yml'),
    `
name: ci
jobs:
  test:
    runs-on: ubuntu-latest
`
  );

  // Create a README
  await fs.writeFile(
    path.join(tempDir, 'README.md'),
    '# Test Project\n\nThis is a test project for tiered bootstrap.\n'
  );

  return tempDir;
}

/**
 * Clean up test workspace.
 */
async function cleanupTestWorkspace(tempDir: string): Promise<void> {
  try {
    await fs.rm(tempDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

// ============================================================================
// TESTS
// ============================================================================

describe('TieredBootstrap', () => {
  let tempDir: string;
  let mockStorage: LibrarianStorage;

  beforeEach(async () => {
    tempDir = await createTestWorkspace();
    mockStorage = createMockStorage();
  });

  afterEach(async () => {
    await cleanupTestWorkspace(tempDir);
  });

  describe('Basic Functionality', () => {
    it('should complete all tiers successfully', async () => {
      const bootstrap = createTieredBootstrap({
        rootPath: tempDir,
        storage: mockStorage,
      });

      await bootstrap.start();

      const status = bootstrap.getStatus();
      expect(status.currentTier).toBe(BootstrapTier.FULL);
      expect(status.isComplete).toBe(true);
      expect(status.inProgress).toBe(false);
      expect(status.error).toBeUndefined();
    });

    it('should process tiers in order: IMMEDIATE -> FAST -> FULL', async () => {
      const completedTiers: BootstrapTier[] = [];

      const bootstrap = createTieredBootstrap({
        rootPath: tempDir,
        storage: mockStorage,
        onTierComplete: (tier) => {
          completedTiers.push(tier);
        },
      });

      await bootstrap.start();

      expect(completedTiers).toEqual([
        BootstrapTier.IMMEDIATE,
        BootstrapTier.FAST,
        BootstrapTier.FULL,
      ]);
    });

    it('should throw error if started twice', async () => {
      const bootstrap = createTieredBootstrap({
        rootPath: tempDir,
        storage: mockStorage,
      });

      // Start bootstrap but don't await
      const startPromise = bootstrap.start();

      // Try to start again immediately
      await expect(bootstrap.start()).rejects.toThrow('Bootstrap already in progress');

      // Clean up
      await startPromise;
    });
  });

  describe('Tier 0 (IMMEDIATE) - File Discovery', () => {
    it('should complete Tier 0 within time budget', async () => {
      const tier0TimeoutMs = 5000;
      let tier0Duration = 0;

      const bootstrap = createTieredBootstrap({
        rootPath: tempDir,
        storage: mockStorage,
        tier0TimeoutMs,
        onTierComplete: (tier, stats) => {
          if (tier === BootstrapTier.IMMEDIATE) {
            tier0Duration = stats.durationMs;
          }
        },
      });

      await bootstrap.start();

      expect(tier0Duration).toBeLessThan(tier0TimeoutMs);
    });

    it('should discover files and directories', async () => {
      const bootstrap = createTieredBootstrap({
        rootPath: tempDir,
        storage: mockStorage,
      });

      await bootstrap.start();

      const discoveredFiles = bootstrap.getDiscoveredFiles();
      expect(discoveredFiles.length).toBeGreaterThan(0);

      // Should have found our test files
      const fileNames = discoveredFiles.map((f) => f.name);
      expect(fileNames).toContain('index.ts');
      expect(fileNames).toContain('config.ts');
      expect(fileNames).toContain('helper.ts');
      expect(fileNames).toContain('format.ts');
    });

    it('should classify files correctly', async () => {
      const bootstrap = createTieredBootstrap({
        rootPath: tempDir,
        storage: mockStorage,
      });

      await bootstrap.start();

      const discoveredFiles = bootstrap.getDiscoveredFiles();
      const testFile = discoveredFiles.find((f) => f.name === 'index.test.ts');
      const codeFile = discoveredFiles.find((f) => f.name === 'index.ts');
      const docsFile = discoveredFiles.find((f) => f.name === 'README.md');

      expect(testFile?.category).toBe('test');
      expect(codeFile?.category).toBe('code');
      expect(docsFile?.category).toBe('docs');
    });

    it('should enable FILE_SEARCH and BASIC_NAVIGATION after Tier 0', async () => {
      const bootstrap = createTieredBootstrap({
        rootPath: tempDir,
        storage: mockStorage,
      });

      // Wait for Tier 0 only
      const waitPromise = bootstrap.waitForTier(BootstrapTier.IMMEDIATE);
      bootstrap.start().catch(() => {});

      await waitPromise;

      expect(bootstrap.isFeatureEnabled(FEATURES.FILE_SEARCH)).toBe(true);
      expect(bootstrap.isFeatureEnabled(FEATURES.BASIC_NAVIGATION)).toBe(true);
      expect(bootstrap.isFeatureEnabled(FEATURES.SYMBOL_SEARCH)).toBe(false);
    });

    it('should store file knowledge in storage', async () => {
      const bootstrap = createTieredBootstrap({
        rootPath: tempDir,
        storage: mockStorage,
      });

      await bootstrap.start();

      // Verify upsertFiles was called
      expect(mockStorage.upsertFiles).toHaveBeenCalled();
      expect(mockStorage.upsertDirectories).toHaveBeenCalled();
    });
  });

  describe('Tier 1 (FAST) - Symbol Extraction', () => {
    it('should complete Tier 1 within time budget', async () => {
      const tier1TimeoutMs = 30000;
      let tier1Duration = 0;

      const bootstrap = createTieredBootstrap({
        rootPath: tempDir,
        storage: mockStorage,
        tier1TimeoutMs,
        onTierComplete: (tier, stats) => {
          if (tier === BootstrapTier.FAST) {
            tier1Duration = stats.durationMs;
          }
        },
      });

      await bootstrap.start();

      expect(tier1Duration).toBeLessThan(tier1TimeoutMs);
    });

    it('should extract symbols from source files', async () => {
      const bootstrap = createTieredBootstrap({
        rootPath: tempDir,
        storage: mockStorage,
      });

      await bootstrap.start();

      const symbols = bootstrap.getExtractedSymbols();
      const symbolNames = symbols.map((s) => s.name);

      // Should have found our test symbols
      expect(symbolNames).toContain('main');
      expect(symbolNames).toContain('asyncMain');
      expect(symbolNames).toContain('Config');
      expect(symbolNames).toContain('ConfigManager');
      expect(symbolNames).toContain('helper');
      expect(symbolNames).toContain('format');
      expect(symbolNames).toContain('run');
      expect(symbolNames).toContain('compute');
      expect(symbolNames).toContain('Start');
      expect(symbolNames).toContain('jobs');
    });

    it('should identify exported vs private symbols', async () => {
      const bootstrap = createTieredBootstrap({
        rootPath: tempDir,
        storage: mockStorage,
      });

      await bootstrap.start();

      const symbols = bootstrap.getExtractedSymbols();
      const mainSymbol = symbols.find((s) => s.name === 'main');
      const helperSymbol = symbols.find((s) => s.name === 'helper');

      expect(mainSymbol?.isExported).toBe(true);
      expect(helperSymbol?.isExported).toBe(true);
    });

    it('should build import graph edges', async () => {
      const bootstrap = createTieredBootstrap({
        rootPath: tempDir,
        storage: mockStorage,
      });

      await bootstrap.start();

      const edges = bootstrap.getImportEdges();
      expect(edges.length).toBeGreaterThan(0);

      // helper.ts imports format.ts
      const helperImport = edges.find(
        (e) => e.sourceFile.includes('helper.ts') && e.targetFile.includes('format.ts')
      );
      expect(helperImport).toBeDefined();
    });

    it('should enable SYMBOL_SEARCH and GO_TO_DEFINITION after Tier 1', async () => {
      const bootstrap = createTieredBootstrap({
        rootPath: tempDir,
        storage: mockStorage,
      });

      const waitPromise = bootstrap.waitForTier(BootstrapTier.FAST);
      bootstrap.start().catch(() => {});

      await waitPromise;

      expect(bootstrap.isFeatureEnabled(FEATURES.SYMBOL_SEARCH)).toBe(true);
      expect(bootstrap.isFeatureEnabled(FEATURES.GO_TO_DEFINITION)).toBe(true);
      expect(bootstrap.isFeatureEnabled(FEATURES.IMPORT_GRAPH)).toBe(true);
    });
  });

  describe('Tier 2 (FULL) - Complete Analysis', () => {
    it('should enable all features after Tier 2', async () => {
      const bootstrap = createTieredBootstrap({
        rootPath: tempDir,
        storage: mockStorage,
      });

      await bootstrap.start();

      for (const feature of Object.values(FEATURES)) {
        expect(bootstrap.isFeatureEnabled(feature)).toBe(true);
      }
    });

    it('should set isComplete to true after Tier 2', async () => {
      const bootstrap = createTieredBootstrap({
        rootPath: tempDir,
        storage: mockStorage,
      });

      await bootstrap.start();

      const status = bootstrap.getStatus();
      expect(status.isComplete).toBe(true);
      expect(status.currentTier).toBe(BootstrapTier.FULL);
    });
  });

  describe('Progress Callbacks', () => {
    it('should fire progress callbacks for each tier', async () => {
      const progressUpdates: Array<{ tier: BootstrapTier; progress: number }> = [];

      const bootstrap = createTieredBootstrap({
        rootPath: tempDir,
        storage: mockStorage,
        onProgress: (tier, progress) => {
          progressUpdates.push({ tier, progress });
        },
      });

      await bootstrap.start();

      // Should have progress updates for all tiers
      const tier0Updates = progressUpdates.filter((p) => p.tier === BootstrapTier.IMMEDIATE);
      const tier1Updates = progressUpdates.filter((p) => p.tier === BootstrapTier.FAST);
      const tier2Updates = progressUpdates.filter((p) => p.tier === BootstrapTier.FULL);

      expect(tier0Updates.length).toBeGreaterThan(0);
      expect(tier1Updates.length).toBeGreaterThan(0);
      expect(tier2Updates.length).toBeGreaterThan(0);

      // Progress should end at 1.0 for each tier
      expect(tier0Updates[tier0Updates.length - 1].progress).toBe(1.0);
      expect(tier1Updates[tier1Updates.length - 1].progress).toBe(1.0);
      expect(tier2Updates[tier2Updates.length - 1].progress).toBe(1.0);
    });

    it('should fire tier complete callbacks with stats', async () => {
      const completedStats: TierStats[] = [];

      const bootstrap = createTieredBootstrap({
        rootPath: tempDir,
        storage: mockStorage,
        onTierComplete: (_tier, stats) => {
          completedStats.push(stats);
        },
      });

      await bootstrap.start();

      expect(completedStats.length).toBe(3);

      // Each stats should have required fields
      for (const stats of completedStats) {
        expect(stats.tier).toBeDefined();
        expect(stats.filesProcessed).toBeGreaterThanOrEqual(0);
        expect(stats.durationMs).toBeGreaterThanOrEqual(0);
        expect(stats.enabledFeatures.length).toBeGreaterThan(0);
      }
    });
  });

  describe('Abort Signal', () => {
    it('should stop bootstrap when abort signal is triggered', async () => {
      const controller = new AbortController();

      const bootstrap = createTieredBootstrap({
        rootPath: tempDir,
        storage: mockStorage,
        abortSignal: controller.signal,
        onTierComplete: () => {
          // Abort after first tier completes
          controller.abort();
        },
      });

      await bootstrap.start();

      const status = bootstrap.getStatus();
      // Should have stopped early (may complete tier 1 depending on timing)
      expect(status.currentTier).toBeLessThanOrEqual(BootstrapTier.FAST);
    });

    it('should stop gracefully via abort() method', async () => {
      const bootstrap = createTieredBootstrap({
        rootPath: tempDir,
        storage: mockStorage,
        onTierComplete: () => {
          // Abort after first tier completes
          bootstrap.abort();
        },
      });

      await bootstrap.start();

      const status = bootstrap.getStatus();
      expect(status.currentTier).toBeLessThanOrEqual(BootstrapTier.FAST);
    });
  });

  describe('waitForTier', () => {
    it('should resolve immediately for already completed tiers', async () => {
      const bootstrap = createTieredBootstrap({
        rootPath: tempDir,
        storage: mockStorage,
      });

      await bootstrap.start();

      // All tiers already complete
      const start = Date.now();
      await bootstrap.waitForTier(BootstrapTier.IMMEDIATE);
      await bootstrap.waitForTier(BootstrapTier.FAST);
      await bootstrap.waitForTier(BootstrapTier.FULL);
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(100); // Should be nearly instant
    });

    it('should resolve immediately for NONE tier', async () => {
      const bootstrap = createTieredBootstrap({
        rootPath: tempDir,
        storage: mockStorage,
      });

      const start = Date.now();
      await bootstrap.waitForTier(BootstrapTier.NONE);
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(10);
    });

    it('should wait for tier to complete', async () => {
      const bootstrap = createTieredBootstrap({
        rootPath: tempDir,
        storage: mockStorage,
      });

      // Start bootstrap in background
      const startPromise = bootstrap.start();

      // Wait for IMMEDIATE tier
      await bootstrap.waitForTier(BootstrapTier.IMMEDIATE);

      // IMMEDIATE should be complete
      const status = bootstrap.getStatus();
      expect(status.currentTier).toBeGreaterThanOrEqual(BootstrapTier.IMMEDIATE);
      expect(bootstrap.isFeatureEnabled(FEATURES.FILE_SEARCH)).toBe(true);

      // Clean up
      await startPromise;
    });
  });

  describe('Error Handling', () => {
    it('should handle errors gracefully and set error state', async () => {
      // Create storage that throws on upsertFiles
      const errorStorage = createMockStorage();
      vi.mocked(errorStorage.upsertFiles).mockRejectedValue(new Error('Storage error'));

      const bootstrap = createTieredBootstrap({
        rootPath: tempDir,
        storage: errorStorage,
      });

      await expect(bootstrap.start()).rejects.toThrow('Storage error');

      const status = bootstrap.getStatus();
      expect(status.error).toBeDefined();
      expect(status.error?.message).toBe('Storage error');
    });

    it('should handle non-existent workspace', async () => {
      const bootstrap = createTieredBootstrap({
        rootPath: '/non/existent/path',
        storage: mockStorage,
      });

      // Should complete but with no files
      await bootstrap.start();

      const discoveredFiles = bootstrap.getDiscoveredFiles();
      expect(discoveredFiles.length).toBe(0);
    });
  });

  describe('Feature Checking', () => {
    it('should correctly report feature availability via isFeatureEnabled', async () => {
      const bootstrap = createTieredBootstrap({
        rootPath: tempDir,
        storage: mockStorage,
      });

      // Before start, no features should be enabled
      expect(bootstrap.isFeatureEnabled(FEATURES.FILE_SEARCH)).toBe(false);
      expect(bootstrap.isFeatureEnabled(FEATURES.SYMBOL_SEARCH)).toBe(false);
      expect(bootstrap.isFeatureEnabled(FEATURES.FULL_ANALYSIS)).toBe(false);

      await bootstrap.start();

      // After completion, all features should be enabled
      expect(bootstrap.isFeatureEnabled(FEATURES.FILE_SEARCH)).toBe(true);
      expect(bootstrap.isFeatureEnabled(FEATURES.SYMBOL_SEARCH)).toBe(true);
      expect(bootstrap.isFeatureEnabled(FEATURES.FULL_ANALYSIS)).toBe(true);
    });
  });

  describe('TIER_FEATURES Mapping', () => {
    it('should have correct features for each tier', () => {
      expect(TIER_FEATURES[BootstrapTier.NONE].size).toBe(0);

      expect(TIER_FEATURES[BootstrapTier.IMMEDIATE].has(FEATURES.FILE_SEARCH)).toBe(true);
      expect(TIER_FEATURES[BootstrapTier.IMMEDIATE].has(FEATURES.BASIC_NAVIGATION)).toBe(true);
      expect(TIER_FEATURES[BootstrapTier.IMMEDIATE].has(FEATURES.SYMBOL_SEARCH)).toBe(false);

      expect(TIER_FEATURES[BootstrapTier.FAST].has(FEATURES.SYMBOL_SEARCH)).toBe(true);
      expect(TIER_FEATURES[BootstrapTier.FAST].has(FEATURES.GO_TO_DEFINITION)).toBe(true);
      expect(TIER_FEATURES[BootstrapTier.FAST].has(FEATURES.IMPORT_GRAPH)).toBe(true);

      expect(TIER_FEATURES[BootstrapTier.FULL].has(FEATURES.FULL_ANALYSIS)).toBe(true);
      expect(TIER_FEATURES[BootstrapTier.FULL].has(FEATURES.PATTERN_DETECTION)).toBe(true);
      expect(TIER_FEATURES[BootstrapTier.FULL].has(FEATURES.ARCHITECTURE_ANALYSIS)).toBe(true);
    });

    it('should include all lower tier features in higher tiers', () => {
      // FAST should include all IMMEDIATE features
      for (const feature of TIER_FEATURES[BootstrapTier.IMMEDIATE]) {
        expect(TIER_FEATURES[BootstrapTier.FAST].has(feature)).toBe(true);
      }

      // FULL should include all FAST features
      for (const feature of TIER_FEATURES[BootstrapTier.FAST]) {
        expect(TIER_FEATURES[BootstrapTier.FULL].has(feature)).toBe(true);
      }
    });
  });

  describe('Status Reporting', () => {
    it('should return accurate status', async () => {
      const bootstrap = createTieredBootstrap({
        rootPath: tempDir,
        storage: mockStorage,
      });

      // Initial status
      let status = bootstrap.getStatus();
      expect(status.currentTier).toBe(BootstrapTier.NONE);
      expect(status.isComplete).toBe(false);
      expect(status.inProgress).toBe(false);
      expect(status.tierStats.size).toBe(0);
      expect(status.enabledFeatures.size).toBe(0);

      await bootstrap.start();

      // Final status
      status = bootstrap.getStatus();
      expect(status.currentTier).toBe(BootstrapTier.FULL);
      expect(status.isComplete).toBe(true);
      expect(status.inProgress).toBe(false);
      expect(status.tierStats.size).toBe(3);
      expect(status.enabledFeatures.size).toBe(Object.values(FEATURES).length);
    });

    it('should return a copy of status data', async () => {
      const bootstrap = createTieredBootstrap({
        rootPath: tempDir,
        storage: mockStorage,
      });

      await bootstrap.start();

      const status1 = bootstrap.getStatus();
      const status2 = bootstrap.getStatus();

      // Should be equal but not the same object
      expect(status1.tierStats).toEqual(status2.tierStats);
      expect(status1.tierStats).not.toBe(status2.tierStats);
      expect(status1.enabledFeatures).toEqual(status2.enabledFeatures);
      expect(status1.enabledFeatures).not.toBe(status2.enabledFeatures);
    });
  });

  describe('Configuration Options', () => {
    it('should respect custom include patterns', async () => {
      const bootstrap = createTieredBootstrap({
        rootPath: tempDir,
        storage: mockStorage,
        includePatterns: ['**/*.ts'],
      });

      await bootstrap.start();

      const discoveredFiles = bootstrap.getDiscoveredFiles();

      // Should only have .ts files
      for (const file of discoveredFiles) {
        expect(file.extension).toBe('.ts');
      }

      // Should not have README.md
      expect(discoveredFiles.find((f) => f.name === 'README.md')).toBeUndefined();
    });

    it('should respect custom exclude patterns', async () => {
      const bootstrap = createTieredBootstrap({
        rootPath: tempDir,
        storage: mockStorage,
        excludePatterns: ['**/__tests__/**', '**/node_modules/**'],
      });

      await bootstrap.start();

      const discoveredFiles = bootstrap.getDiscoveredFiles();

      // Should not have test files
      expect(discoveredFiles.find((f) => f.relativePath.includes('__tests__'))).toBeUndefined();
    });

    it('should respect custom time budgets', async () => {
      const tier0TimeoutMs = 10000; // Very generous
      const tier1TimeoutMs = 60000;

      const bootstrap = createTieredBootstrap({
        rootPath: tempDir,
        storage: mockStorage,
        tier0TimeoutMs,
        tier1TimeoutMs,
      });

      await bootstrap.start();

      const status = bootstrap.getStatus();
      const tier0Stats = status.tierStats.get(BootstrapTier.IMMEDIATE);
      const tier1Stats = status.tierStats.get(BootstrapTier.FAST);

      // Should complete well under the generous budgets
      expect(tier0Stats?.durationMs).toBeLessThan(tier0TimeoutMs);
      expect(tier1Stats?.durationMs).toBeLessThan(tier1TimeoutMs);
    });

    it('should respect maxFileSizeBytes option', async () => {
      // Create a large file
      const largeContent = 'x'.repeat(1024 * 1024 * 2); // 2MB
      await fs.writeFile(path.join(tempDir, 'src', 'large.ts'), largeContent);

      const bootstrap = createTieredBootstrap({
        rootPath: tempDir,
        storage: mockStorage,
        maxFileSizeBytes: 1024 * 1024, // 1MB limit
      });

      await bootstrap.start();

      // Large file should be discovered but not have symbols extracted
      const discoveredFiles = bootstrap.getDiscoveredFiles();
      const largeFile = discoveredFiles.find((f) => f.name === 'large.ts');
      expect(largeFile).toBeDefined();

      // Symbols should not include anything from large file
      const symbols = bootstrap.getExtractedSymbols();
      const largeFileSymbols = symbols.filter((s) =>
        s.filePath.includes('large.ts')
      );
      expect(largeFileSymbols.length).toBe(0);
    });
  });

  describe('Factory Function', () => {
    it('should create instance via createTieredBootstrap', () => {
      const bootstrap = createTieredBootstrap({
        rootPath: tempDir,
        storage: mockStorage,
      });

      expect(bootstrap).toBeInstanceOf(TieredBootstrap);
    });
  });
});
