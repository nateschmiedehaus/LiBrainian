/**
 * @fileoverview WU-META-001: Librarian Self-Bootstrap Test
 *
 * This test validates that Librarian can successfully index its own codebase.
 * It serves as the ultimate dogfooding test - if Librarian can't understand
 * itself, it can't be trusted to understand other codebases.
 *
 * Test modes:
 * 1. File Discovery Mode (always runs) - Validates file discovery without LLM
 * 2. Full Bootstrap Mode (requires LLM) - Complete indexing with LLM providers
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs/promises';
import { glob } from 'glob';
import { selfBootstrap, type SelfBootstrapOptions } from '../self_bootstrap.js';
import type { LibrarianStorage } from '../../../storage/types.js';
import { isExcluded, getAllIncludePatterns, UNIVERSAL_EXCLUDES } from '../../../universal_patterns.js';

// ============================================================================
// TEST CONFIGURATION
// ============================================================================

// __dirname in ESM resolves to: src/agents/self_improvement/__tests__/
// Need to go up 4 levels to reach librarian root
const LIBRARIAN_ROOT = path.resolve(__dirname, '../../../..');

// Files that MUST be discovered in any valid Librarian index
const REQUIRED_FILES = [
  'src/agents/index_librarian.ts',
  'src/agents/self_improvement/self_bootstrap.ts',
  'src/storage/types.ts',
  'src/universal_patterns.ts',
  'src/types.ts',
];

// Directories that should be EXCLUDED (node_modules, dist, .git)
// Note: .github is NOT excluded (it's different from .git directory)
const EXCLUDED_DIRECTORY_PATTERNS = [
  '/node_modules/',
  '/dist/',
  '/.git/',  // Only the .git directory, not .github
];

// Exclude patterns for the self-bootstrap test
const SELF_BOOTSTRAP_EXCLUDES = [
  'node_modules/**',
  'dist/**',
  '**/*.test.ts',
  'eval-corpus/**',
  '.git/**',
  '**/fixtures/**',
  '**/__snapshots__/**',
];

// ============================================================================
// FILE DISCOVERY UTILITY
// ============================================================================

/**
 * Discover files to index using the same logic as selfBootstrap.
 * This allows us to test file discovery without requiring LLM providers.
 */
async function discoverFilesForSelfBootstrap(
  rootDir: string,
  excludePatterns: string[],
  maxFiles?: number
): Promise<string[]> {
  const includePatterns = getAllIncludePatterns();

  // Combine default and custom exclude patterns
  const allExcludes = [
    ...UNIVERSAL_EXCLUDES,
    ...excludePatterns,
    // Always exclude test fixtures and snapshots
    '**/__snapshots__/**',
    '**/fixtures/**',
    '**/test-data/**',
  ];

  const files = await glob(includePatterns, {
    cwd: rootDir,
    ignore: allExcludes,
    absolute: true,
    follow: false,
    nodir: true,
  });

  // Filter out any remaining excluded files
  const filteredFiles = files.filter((file) => {
    const relativePath = path.relative(rootDir, file);
    return !isExcluded(relativePath);
  });

  // Sort for deterministic ordering
  filteredFiles.sort();

  // Apply max files limit if specified
  if (maxFiles && maxFiles > 0) {
    return filteredFiles.slice(0, maxFiles);
  }

  return filteredFiles;
}

// ============================================================================
// MOCK STORAGE FOR DRY RUN MODE
// ============================================================================

/**
 * Create a mock storage that tracks what files would be indexed.
 * Used for file discovery validation without LLM providers.
 */
function createDryRunStorage(): LibrarianStorage & { trackedFiles: Set<string> } {
  const trackedFiles = new Set<string>();

  return {
    trackedFiles,
    isInitialized: vi.fn().mockReturnValue(true),
    initialize: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    getCapabilities: vi.fn().mockReturnValue({
      core: { getFunctions: true, getFiles: true, getContextPacks: true },
      optional: { graphMetrics: false, multiVectors: false, embeddings: false, episodes: false, verificationPlans: false },
      versions: { schema: 1, api: 1 },
    }),
    getGraphEdges: vi.fn().mockResolvedValue([]),
    getFileChecksum: vi.fn().mockResolvedValue(null),
    setFileChecksum: vi.fn().mockImplementation((path: string) => {
      trackedFiles.add(path);
      return Promise.resolve();
    }),
    getFunctionByPath: vi.fn().mockResolvedValue(null),
    getModuleByPath: vi.fn().mockResolvedValue(null),
    upsertFunction: vi.fn().mockResolvedValue(undefined),
    upsertModule: vi.fn().mockResolvedValue(undefined),
    upsertContextPack: vi.fn().mockResolvedValue(undefined),
    getContextPack: vi.fn().mockResolvedValue(null),
    deleteGraphEdgesForSource: vi.fn().mockResolvedValue(undefined),
    upsertGraphEdges: vi.fn().mockResolvedValue(undefined),
    recordIndexingResult: vi.fn().mockResolvedValue(undefined),
    // Add all other required methods with default implementations
    getMetadata: vi.fn().mockResolvedValue(null),
    setMetadata: vi.fn().mockResolvedValue(undefined),
    getState: vi.fn().mockResolvedValue(null),
    setState: vi.fn().mockResolvedValue(undefined),
    getVersion: vi.fn().mockResolvedValue(null),
    setVersion: vi.fn().mockResolvedValue(undefined),
    getFunctions: vi.fn().mockResolvedValue([]),
    getFunction: vi.fn().mockResolvedValue(null),
    getFunctionsByPath: vi.fn().mockResolvedValue([]),
    upsertFunctions: vi.fn().mockResolvedValue(undefined),
    deleteFunction: vi.fn().mockResolvedValue(undefined),
    deleteFunctionsByPath: vi.fn().mockResolvedValue(undefined),
    getModules: vi.fn().mockResolvedValue([]),
    getModule: vi.fn().mockResolvedValue(null),
    deleteModule: vi.fn().mockResolvedValue(undefined),
    getFiles: vi.fn().mockResolvedValue([]),
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
    getContextPackForTarget: vi.fn().mockResolvedValue(null),
    invalidateContextPacks: vi.fn().mockResolvedValue(0),
    deleteContextPack: vi.fn().mockResolvedValue(undefined),
    recordContextPackAccess: vi.fn().mockResolvedValue(undefined),
    deleteFileChecksum: vi.fn().mockResolvedValue(undefined),
    getEmbedding: vi.fn().mockResolvedValue(null),
    setEmbedding: vi.fn().mockResolvedValue(undefined),
    findSimilarByEmbedding: vi.fn().mockResolvedValue([]),
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
    getIngestionItem: vi.fn().mockResolvedValue(null),
    getIngestionItems: vi.fn().mockResolvedValue([]),
    upsertIngestionItem: vi.fn().mockResolvedValue(undefined),
    deleteIngestionItem: vi.fn().mockResolvedValue(undefined),
    getLastIndexingResult: vi.fn().mockResolvedValue(null),
    recordBootstrapReport: vi.fn().mockResolvedValue(undefined),
    getLastBootstrapReport: vi.fn().mockResolvedValue(null),
    updateConfidence: vi.fn().mockResolvedValue(undefined),
    applyTimeDecay: vi.fn().mockResolvedValue(0),
    transaction: vi.fn().mockImplementation(async (fn) => fn({
      upsertFunction: vi.fn().mockResolvedValue(undefined),
      upsertModule: vi.fn().mockResolvedValue(undefined),
      upsertContextPack: vi.fn().mockResolvedValue(undefined),
      upsertIngestionItem: vi.fn().mockResolvedValue(undefined),
      upsertTestMapping: vi.fn().mockResolvedValue({ id: 'test' }),
      upsertCommit: vi.fn().mockResolvedValue({ id: 'commit' }),
      upsertOwnership: vi.fn().mockResolvedValue({ id: 'ownership' }),
      setEmbedding: vi.fn().mockResolvedValue(undefined),
      upsertMultiVector: vi.fn().mockResolvedValue(undefined),
      deleteFunction: vi.fn().mockResolvedValue(undefined),
      deleteFunctionsByPath: vi.fn().mockResolvedValue(undefined),
      deleteModule: vi.fn().mockResolvedValue(undefined),
      deleteFileByPath: vi.fn().mockResolvedValue(undefined),
      deleteUniversalKnowledgeByFile: vi.fn().mockResolvedValue(0),
      deleteContextPack: vi.fn().mockResolvedValue(undefined),
      invalidateContextPacks: vi.fn().mockResolvedValue(0),
      upsertGraphEdges: vi.fn().mockResolvedValue(undefined),
      deleteGraphEdgesForSource: vi.fn().mockResolvedValue(undefined),
      setFileChecksum: vi.fn().mockResolvedValue(undefined),
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
    upsertTestMapping: vi.fn().mockResolvedValue({ id: 'test' } as any),
    deleteTestMapping: vi.fn().mockResolvedValue(undefined),
    deleteTestMappingsByTestPath: vi.fn().mockResolvedValue(0),
    getCommit: vi.fn().mockResolvedValue(null),
    getCommitBySha: vi.fn().mockResolvedValue(null),
    getCommits: vi.fn().mockResolvedValue([]),
    upsertCommit: vi.fn().mockResolvedValue({ id: 'commit' } as any),
    deleteCommit: vi.fn().mockResolvedValue(undefined),
    deleteCommitBySha: vi.fn().mockResolvedValue(undefined),
    getOwnership: vi.fn().mockResolvedValue(null),
    getOwnershipByFilePath: vi.fn().mockResolvedValue([]),
    getOwnershipByAuthor: vi.fn().mockResolvedValue([]),
    getOwnerships: vi.fn().mockResolvedValue([]),
    upsertOwnership: vi.fn().mockResolvedValue({ id: 'ownership' } as any),
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
  } as unknown as LibrarianStorage & { trackedFiles: Set<string> };
}

// ============================================================================
// WU-META-001: LIBRARIAN SELF-BOOTSTRAP TESTS
// ============================================================================

describe('WU-META-001: Librarian Self-Bootstrap', () => {
  // ==========================================================================
  // FILE DISCOVERY TESTS (DRY RUN MODE)
  // ==========================================================================

  describe('File Discovery (Dry Run Mode)', () => {
    it('should discover Librarian source files', async () => {
      const files = await discoverFilesForSelfBootstrap(
        LIBRARIAN_ROOT,
        SELF_BOOTSTRAP_EXCLUDES
      );

      // Should find a substantial number of files
      expect(files.length).toBeGreaterThan(50);

      // Log file count for visibility
      console.log(`[meta_bootstrap] Discovered ${files.length} files in Librarian codebase`);
    });

    it('should discover all required core files', async () => {
      const files = await discoverFilesForSelfBootstrap(
        LIBRARIAN_ROOT,
        SELF_BOOTSTRAP_EXCLUDES
      );

      const relativeFiles = files.map(f => path.relative(LIBRARIAN_ROOT, f));

      for (const required of REQUIRED_FILES) {
        const found = relativeFiles.some(f => f.endsWith(required) || f === required);
        expect(found, `Required file not found: ${required}`).toBe(true);
      }
    });

    it('should exclude node_modules, dist, and git directories', async () => {
      const files = await discoverFilesForSelfBootstrap(
        LIBRARIAN_ROOT,
        SELF_BOOTSTRAP_EXCLUDES
      );

      for (const file of files) {
        const relativePath = path.relative(LIBRARIAN_ROOT, file);
        // Convert to forward slashes for cross-platform matching
        const normalizedPath = '/' + relativePath.replace(/\\/g, '/');
        for (const excludedPattern of EXCLUDED_DIRECTORY_PATTERNS) {
          expect(
            normalizedPath.includes(excludedPattern),
            `File should be excluded: ${relativePath} (contains ${excludedPattern})`
          ).toBe(false);
        }
      }
    });

    it('should exclude test files when configured', async () => {
      const files = await discoverFilesForSelfBootstrap(
        LIBRARIAN_ROOT,
        SELF_BOOTSTRAP_EXCLUDES
      );

      // Filter to find test files in the Librarian src directory (not eval-corpus or external repos)
      const librarianSrcTestFiles = files.filter(f => {
        const rel = path.relative(LIBRARIAN_ROOT, f);
        return (f.endsWith('.test.ts') || f.endsWith('.spec.ts')) &&
               rel.startsWith('src/') &&
               !rel.includes('eval-corpus') &&
               !rel.includes('external-repos');
      });

      // Should not find any test files in Librarian's own src directory
      if (librarianSrcTestFiles.length > 0) {
        console.log('[meta_bootstrap] Unexpected test files found:', librarianSrcTestFiles.slice(0, 5));
      }
      expect(librarianSrcTestFiles.length).toBe(0);
    });

    it('should respect maxFiles limit', async () => {
      const maxFiles = 50;
      const files = await discoverFilesForSelfBootstrap(
        LIBRARIAN_ROOT,
        SELF_BOOTSTRAP_EXCLUDES,
        maxFiles
      );

      expect(files.length).toBeLessThanOrEqual(maxFiles);
    });

    it('should discover TypeScript source files', async () => {
      const files = await discoverFilesForSelfBootstrap(
        LIBRARIAN_ROOT,
        SELF_BOOTSTRAP_EXCLUDES
      );

      const tsFiles = files.filter(f => f.endsWith('.ts') && !f.endsWith('.d.ts'));
      expect(tsFiles.length).toBeGreaterThan(30);

      // Log TypeScript file count
      console.log(`[meta_bootstrap] Found ${tsFiles.length} TypeScript files`);
    });

    it('should discover key agent files', async () => {
      const files = await discoverFilesForSelfBootstrap(
        LIBRARIAN_ROOT,
        SELF_BOOTSTRAP_EXCLUDES
      );

      const relativeFiles = files.map(f => path.relative(LIBRARIAN_ROOT, f));

      // Key agent files
      const keyAgentFiles = [
        'src/agents/index_librarian.ts',
        'src/agents/ast_indexer.ts',
        'src/agents/types.ts',
      ];

      for (const keyFile of keyAgentFiles) {
        const found = relativeFiles.some(f => f === keyFile || f.endsWith(keyFile));
        expect(found, `Key agent file not found: ${keyFile}`).toBe(true);
      }
    });

    it('should discover self-improvement primitives', async () => {
      const files = await discoverFilesForSelfBootstrap(
        LIBRARIAN_ROOT,
        SELF_BOOTSTRAP_EXCLUDES
      );

      const selfImprovementFiles = files.filter(f =>
        f.includes('self_improvement') && !f.includes('__tests__')
      );

      // Should have self_bootstrap.ts, self_refresh.ts, analyze_architecture.ts, etc.
      expect(selfImprovementFiles.length).toBeGreaterThanOrEqual(5);

      console.log(`[meta_bootstrap] Found ${selfImprovementFiles.length} self-improvement primitives`);
    });
  });

  // ==========================================================================
  // SELF-REFERENTIAL DETECTION TESTS
  // ==========================================================================

  describe('Self-Referential Detection', () => {
    it('should detect Librarian as self-referential', async () => {
      // Check that package.json exists and has librarian name
      const packageJsonPath = path.join(LIBRARIAN_ROOT, 'package.json');
      const packageContent = await fs.readFile(packageJsonPath, 'utf8');
      const pkg = JSON.parse(packageContent);

      // Package name should be 'librarian'
      const isLibrarianPackage = (
        pkg.name === 'librarian' ||
        pkg.name === '@librarian/core' ||
        pkg.name?.includes('librarian')
      );
      expect(isLibrarianPackage).toBe(true);
    });

    it('should have required marker files for self-referential detection', async () => {
      const markers = [
        'src/agents/index_librarian.ts',
        'src/storage/types.ts',
        'package.json',
      ];

      for (const marker of markers) {
        const markerPath = path.join(LIBRARIAN_ROOT, marker);
        const exists = await fs.access(markerPath).then(() => true).catch(() => false);
        expect(exists, `Marker file should exist: ${marker}`).toBe(true);
      }
    });
  });

  // ==========================================================================
  // FULL BOOTSTRAP TESTS (REQUIRES LLM - SKIPPED IN CI)
  // ==========================================================================

  describe('Full Bootstrap (requires LLM provider)', () => {
    const hasLlmProvider = () => {
      // Check if LLM provider is available
      return !!(
        process.env.ANTHROPIC_API_KEY ||
        process.env.OPENAI_API_KEY ||
        process.env.LIBRARIAN_LLM_PROVIDER
      );
    };

    it.skipIf(!hasLlmProvider())('should successfully bootstrap Librarian codebase', async () => {
      const mockStorage = createDryRunStorage();

      // This test requires actual LLM provider - will throw ProviderUnavailableError otherwise
      try {
        const result = await selfBootstrap({
          rootDir: LIBRARIAN_ROOT,
          excludePatterns: SELF_BOOTSTRAP_EXCLUDES,
          maxFiles: 10, // Start very conservative
          storage: mockStorage,
          verbose: true,
          indexConfig: {
            generateEmbeddings: false, // Skip embeddings for faster test
            createContextPacks: true,
            computeGraphMetrics: false,
          },
        });

        expect(result.indexedFiles).toBeGreaterThan(0);
        expect(result.isSelfReferential).toBe(true);
        expect(result.errors).toHaveLength(0);

        console.log(`[meta_bootstrap] Full bootstrap result:`, {
          indexedFiles: result.indexedFiles,
          extractedSymbols: result.extractedSymbols,
          graphNodes: result.graphNodes,
          graphEdges: result.graphEdges,
          duration: result.duration,
          isSelfReferential: result.isSelfReferential,
        });
      } catch (error) {
        // If ProviderUnavailableError, this is expected without LLM
        if (error instanceof Error && error.message.includes('provider_unavailable')) {
          console.log('[meta_bootstrap] LLM provider not available - full bootstrap test skipped');
          return;
        }
        throw error;
      }
    }, { timeout: 60000 }); // 60 second timeout for full bootstrap
  });

  // ==========================================================================
  // COVERAGE ANALYSIS TESTS
  // ==========================================================================

  describe('Coverage Analysis', () => {
    it('should report file category distribution', async () => {
      const files = await discoverFilesForSelfBootstrap(
        LIBRARIAN_ROOT,
        SELF_BOOTSTRAP_EXCLUDES
      );

      const categories: Record<string, number> = {};

      for (const file of files) {
        const ext = path.extname(file);
        categories[ext] = (categories[ext] || 0) + 1;
      }

      console.log('[meta_bootstrap] File category distribution:', categories);

      // TypeScript should be the dominant language
      expect(categories['.ts'] || 0).toBeGreaterThan(categories['.js'] || 0);
    });

    it('should report directory structure depth', async () => {
      const files = await discoverFilesForSelfBootstrap(
        LIBRARIAN_ROOT,
        SELF_BOOTSTRAP_EXCLUDES
      );

      const depths = files.map(f => {
        const relativePath = path.relative(LIBRARIAN_ROOT, f);
        return relativePath.split(path.sep).length;
      });

      const maxDepth = Math.max(...depths);
      const avgDepth = depths.reduce((a, b) => a + b, 0) / depths.length;

      console.log('[meta_bootstrap] Directory structure:', {
        maxDepth,
        avgDepth: avgDepth.toFixed(2),
        totalFiles: files.length,
      });

      // Reasonable depth bounds for a well-organized codebase
      expect(maxDepth).toBeLessThan(10);
      expect(avgDepth).toBeGreaterThan(2);
    });
  });
});
