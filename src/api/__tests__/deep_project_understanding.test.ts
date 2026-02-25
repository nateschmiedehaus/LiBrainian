/**
 * @fileoverview Tests for Deep Project Understanding System
 *
 * Tests the comprehensive project understanding module that helps agents
 * understand any codebase quickly and accurately.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import {
  generateProjectUnderstanding,
  generateAgentContextPrompt,
  createDeepProjectUnderstandingPack,
  type ProjectUnderstanding,
  type GenerateProjectUnderstandingOptions,
} from '../project_understanding.js';
import type { LibrarianStorage } from '../../storage/types.js';
import type { FunctionKnowledge, ModuleKnowledge, FileKnowledge, LibrarianVersion } from '../../types.js';

// ============================================================================
// MOCK STORAGE
// ============================================================================

function createMockStorage(overrides?: Partial<LibrarianStorage>): LibrarianStorage {
  const mockFunctions: FunctionKnowledge[] = [
    {
      id: 'fn1',
      filePath: '/workspace/src/api/query.ts',
      name: 'queryLibrarian',
      signature: 'queryLibrarian(options: QueryOptions): Promise<QueryResult>',
      purpose: 'Main query entry point for the librarian API',
      startLine: 10,
      endLine: 50,
      confidence: 0.9,
      accessCount: 100,
      lastAccessed: new Date(),
      validationCount: 5,
      outcomeHistory: { successes: 10, failures: 1 },
    },
    {
      id: 'fn2',
      filePath: '/workspace/src/api/bootstrap.ts',
      name: 'createLibrarian',
      signature: 'createLibrarian(config: Config): Promise<Librarian>',
      purpose: 'Factory function to create a Librarian instance',
      startLine: 20,
      endLine: 80,
      confidence: 0.95,
      accessCount: 50,
      lastAccessed: new Date(),
      validationCount: 3,
      outcomeHistory: { successes: 8, failures: 0 },
    },
    {
      id: 'fn3',
      filePath: '/workspace/src/storage/sqlite.ts',
      name: 'getConnection',
      signature: 'getConnection(): Database',
      purpose: 'Gets database connection',
      startLine: 5,
      endLine: 15,
      confidence: 0.8,
      accessCount: 30,
      lastAccessed: new Date(),
      validationCount: 2,
      outcomeHistory: { successes: 5, failures: 0 },
    },
    {
      id: 'fn4',
      filePath: '/workspace/src/utils/helpers.ts',
      name: 'isValidInput',
      signature: 'isValidInput(input: unknown): boolean',
      purpose: 'Validates input data',
      startLine: 1,
      endLine: 10,
      confidence: 0.7,
      accessCount: 20,
      lastAccessed: new Date(),
      validationCount: 1,
      outcomeHistory: { successes: 3, failures: 0 },
    },
    {
      id: 'fn5',
      filePath: '/workspace/src/cli/index.ts',
      name: 'handleCommand',
      signature: 'handleCommand(args: string[]): Promise<void>',
      purpose: 'Handles CLI commands',
      startLine: 10,
      endLine: 100,
      confidence: 0.85,
      accessCount: 15,
      lastAccessed: new Date(),
      validationCount: 2,
      outcomeHistory: { successes: 4, failures: 1 },
    },
  ];

  const mockModules: ModuleKnowledge[] = [
    {
      id: 'mod1',
      path: '/workspace/src/api/index.ts',
      purpose: 'Main API exports',
      exports: ['queryLibrarian', 'createLibrarian', 'Librarian'],
      dependencies: ['./query.js', './bootstrap.js', '../storage/index.js'],
      confidence: 0.9,
    },
    {
      id: 'mod2',
      path: '/workspace/src/storage/index.ts',
      purpose: 'Storage layer exports',
      exports: ['SqliteStorage', 'MemoryStorage'],
      dependencies: ['./sqlite.js', './memory.js'],
      confidence: 0.85,
    },
    {
      id: 'mod3',
      path: '/workspace/src/cli/index.ts',
      purpose: 'CLI entry point',
      exports: ['main', 'handleCommand'],
      dependencies: ['../api/index.js', 'commander'],
      confidence: 0.9,
    },
    {
      id: 'mod4',
      path: '/workspace/src/utils/helpers.ts',
      purpose: 'Utility functions',
      exports: ['isValidInput', 'formatOutput'],
      dependencies: [],
      confidence: 0.8,
    },
  ];

  const mockFiles: FileKnowledge[] = [
    {
      id: 'file1',
      path: '/workspace/src/api/query.ts',
      relativePath: 'src/api/query.ts',
      name: 'query.ts',
      extension: 'ts',
      category: 'code',
      purpose: 'Query API implementation',
      role: 'core',
      summary: 'Handles librarian queries',
      keyExports: ['queryLibrarian'],
      mainConcepts: ['query', 'context'],
      lineCount: 200,
      functionCount: 5,
      classCount: 0,
      importCount: 10,
      exportCount: 3,
      imports: ['../storage/index.js'],
      importedBy: ['./index.ts'],
      directory: '/workspace/src/api',
      complexity: 'medium',
      hasTests: true,
      checksum: 'abc123',
      confidence: 0.9,
      lastIndexed: new Date().toISOString(),
      lastModified: new Date().toISOString(),
    },
    {
      id: 'file2',
      path: '/workspace/src/storage/sqlite.ts',
      relativePath: 'src/storage/sqlite.ts',
      name: 'sqlite.ts',
      extension: 'ts',
      category: 'code',
      purpose: 'SQLite storage implementation',
      role: 'storage',
      summary: 'SQLite database storage',
      keyExports: ['SqliteStorage'],
      mainConcepts: ['storage', 'database'],
      lineCount: 500,
      functionCount: 20,
      classCount: 1,
      importCount: 5,
      exportCount: 2,
      imports: ['better-sqlite3'],
      importedBy: ['./index.ts'],
      directory: '/workspace/src/storage',
      complexity: 'high',
      hasTests: true,
      checksum: 'def456',
      confidence: 0.85,
      lastIndexed: new Date().toISOString(),
      lastModified: new Date().toISOString(),
    },
    {
      id: 'file3',
      path: '/workspace/src/__tests__/query.test.ts',
      relativePath: 'src/__tests__/query.test.ts',
      name: 'query.test.ts',
      extension: 'ts',
      category: 'test',
      purpose: 'Tests for query module',
      role: 'test',
      summary: 'Query API tests',
      keyExports: [],
      mainConcepts: ['testing'],
      lineCount: 100,
      functionCount: 10,
      classCount: 0,
      importCount: 3,
      exportCount: 0,
      imports: ['../api/query.js', 'vitest'],
      importedBy: [],
      directory: '/workspace/src/__tests__',
      complexity: 'low',
      hasTests: false,
      checksum: 'ghi789',
      confidence: 0.9,
      lastIndexed: new Date().toISOString(),
      lastModified: new Date().toISOString(),
    },
  ];

  const defaultStorage: LibrarianStorage = {
    // Lifecycle
    initialize: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    isInitialized: vi.fn().mockReturnValue(true),
    getCapabilities: vi.fn().mockReturnValue({
      core: { getFunctions: true, getFiles: true, getContextPacks: true },
      optional: { graphMetrics: true, multiVectors: true, embeddings: true, episodes: false, verificationPlans: false },
      versions: { schema: 1, api: 1 },
    }),

    // Functions
    getFunctions: vi.fn().mockResolvedValue(mockFunctions),
    getFunction: vi.fn().mockResolvedValue(null),
    getFunctionByPath: vi.fn().mockResolvedValue(null),
    getFunctionsByPath: vi.fn().mockResolvedValue([]),
    getFunctionsByName: vi.fn().mockResolvedValue([]),
    upsertFunction: vi.fn().mockResolvedValue(undefined),
    upsertFunctions: vi.fn().mockResolvedValue(undefined),
    deleteFunction: vi.fn().mockResolvedValue(undefined),
    deleteFunctionsByPath: vi.fn().mockResolvedValue(undefined),

    // Modules
    getModules: vi.fn().mockResolvedValue(mockModules),
    getModule: vi.fn().mockResolvedValue(null),
    getModuleByPath: vi.fn().mockResolvedValue(null),
    upsertModule: vi.fn().mockResolvedValue(undefined),
    deleteModule: vi.fn().mockResolvedValue(undefined),
    upsertStrategicContracts: vi.fn().mockResolvedValue(undefined),
    getStrategicContracts: vi.fn().mockResolvedValue([]),
    getStrategicContract: vi.fn().mockResolvedValue(null),
    updateStrategicContractConsumers: vi.fn().mockResolvedValue(undefined),

    // Files
    getFiles: vi.fn().mockResolvedValue(mockFiles),
    getFile: vi.fn().mockResolvedValue(null),
    getFileByPath: vi.fn().mockResolvedValue(null),
    getFilesByDirectory: vi.fn().mockResolvedValue([]),
    upsertFile: vi.fn().mockResolvedValue(undefined),
    upsertFiles: vi.fn().mockResolvedValue(undefined),
    deleteFile: vi.fn().mockResolvedValue(undefined),
    deleteFileByPath: vi.fn().mockResolvedValue(undefined),

    // Directories
    getDirectories: vi.fn().mockResolvedValue([]),
    getDirectory: vi.fn().mockResolvedValue(null),
    getDirectoryByPath: vi.fn().mockResolvedValue(null),
    getSubdirectories: vi.fn().mockResolvedValue([]),
    upsertDirectory: vi.fn().mockResolvedValue(undefined),
    upsertDirectories: vi.fn().mockResolvedValue(undefined),
    deleteDirectory: vi.fn().mockResolvedValue(undefined),
    deleteDirectoryByPath: vi.fn().mockResolvedValue(undefined),

    // Graph edges
    upsertGraphEdges: vi.fn().mockResolvedValue(undefined),
    deleteGraphEdgesForSource: vi.fn().mockResolvedValue(undefined),
    getGraphEdges: vi.fn().mockResolvedValue([
      { fromId: 'mod1', toId: 'mod2', edgeType: 'imports', fromType: 'module', toType: 'module', sourceFile: 'src/api/index.ts', confidence: 0.9, computedAt: new Date() },
      { fromId: 'mod1', toId: 'mod3', edgeType: 'imports', fromType: 'module', toType: 'module', sourceFile: 'src/api/index.ts', confidence: 0.9, computedAt: new Date() },
      { fromId: 'mod2', toId: 'mod4', edgeType: 'imports', fromType: 'module', toType: 'module', sourceFile: 'src/storage/index.ts', confidence: 0.85, computedAt: new Date() },
    ]),

    // Graph metrics
    setGraphMetrics: vi.fn().mockResolvedValue(undefined),
    getGraphMetrics: vi.fn().mockResolvedValue([
      { entityId: 'mod1', entityType: 'module', pagerank: 0.9, betweenness: 0.5, inDegree: 5, outDegree: 3, computedAt: new Date().toISOString() },
      { entityId: 'mod2', entityType: 'module', pagerank: 0.7, betweenness: 0.3, inDegree: 3, outDegree: 2, computedAt: new Date().toISOString() },
    ]),
    deleteGraphMetrics: vi.fn().mockResolvedValue(undefined),

    // Context packs
    getContextPacks: vi.fn().mockResolvedValue([]),
    getContextPack: vi.fn().mockResolvedValue(null),
    getContextPackForTarget: vi.fn().mockResolvedValue(null),
    upsertContextPack: vi.fn().mockResolvedValue(undefined),
    invalidateContextPacks: vi.fn().mockResolvedValue(0),
    deleteContextPack: vi.fn().mockResolvedValue(undefined),
    recordContextPackAccess: vi.fn().mockResolvedValue(undefined),

    // Version
    getVersion: vi.fn().mockResolvedValue({ major: 0, minor: 2, patch: 0, string: '0.2.0', qualityTier: 'enhanced', indexedAt: new Date(), indexerVersion: '0.2.0', features: [] }),
    setVersion: vi.fn().mockResolvedValue(undefined),

    // Metadata
    getMetadata: vi.fn().mockResolvedValue(null),
    setMetadata: vi.fn().mockResolvedValue(undefined),
    getState: vi.fn().mockResolvedValue(null),
    setState: vi.fn().mockResolvedValue(undefined),

    // File checksums
    getFileChecksum: vi.fn().mockResolvedValue(null),
    setFileChecksum: vi.fn().mockResolvedValue(undefined),
    deleteFileChecksum: vi.fn().mockResolvedValue(undefined),

    // Embeddings
    getEmbedding: vi.fn().mockResolvedValue(null),
    setEmbedding: vi.fn().mockResolvedValue(undefined),
    findSimilarByEmbedding: vi.fn().mockResolvedValue({ results: [], degraded: false }),
    getMultiVector: vi.fn().mockResolvedValue(null),
    getMultiVectors: vi.fn().mockResolvedValue([]),
    upsertMultiVector: vi.fn().mockResolvedValue(undefined),

    // Cache invalidation
    invalidateCache: vi.fn().mockResolvedValue(0),
    invalidateEmbeddings: vi.fn().mockResolvedValue(0),
    getReverseDependencies: vi.fn().mockResolvedValue([]),

    // Query cache
    getQueryCacheEntry: vi.fn().mockResolvedValue(null),
    upsertQueryCacheEntry: vi.fn().mockResolvedValue(undefined),
    recordQueryCacheAccess: vi.fn().mockResolvedValue(undefined),
    pruneQueryCache: vi.fn().mockResolvedValue(0),

    // Evolution
    recordEvolutionOutcome: vi.fn().mockResolvedValue(undefined),
    getEvolutionOutcomes: vi.fn().mockResolvedValue([]),
    recordLearnedMissing: vi.fn().mockResolvedValue(undefined),
    getLearnedMissing: vi.fn().mockResolvedValue([]),
    clearLearnedMissing: vi.fn().mockResolvedValue(undefined),
    recordQualityScore: vi.fn().mockResolvedValue(undefined),
    getQualityScoreHistory: vi.fn().mockResolvedValue([]),

    // Confidence
    updateConfidence: vi.fn().mockResolvedValue(undefined),
    applyTimeDecay: vi.fn().mockResolvedValue(0),

    // Bulk operations
    transaction: vi.fn().mockImplementation((fn) => fn({} as any)),
    vacuum: vi.fn().mockResolvedValue(undefined),
    getStats: vi.fn().mockResolvedValue({
      totalFunctions: 5,
      totalModules: 4,
      totalContextPacks: 0,
      totalEmbeddings: 0,
      storageSizeBytes: 1000,
      lastVacuum: null,
      averageConfidence: 0.85,
      cacheHitRate: 0.5,
    }),

    // Cochange
    storeCochangeEdges: vi.fn().mockResolvedValue(undefined),
    getCochangeEdges: vi.fn().mockResolvedValue([]),
    getCochangeEdgeCount: vi.fn().mockResolvedValue(0),
    deleteCochangeEdges: vi.fn().mockResolvedValue(undefined),

    // Evidence
    setEvidence: vi.fn().mockResolvedValue(undefined),
    getEvidenceForTarget: vi.fn().mockResolvedValue([]),
    deleteEvidence: vi.fn().mockResolvedValue(undefined),

    // Confidence events
    getConfidenceEvents: vi.fn().mockResolvedValue([]),
    countConfidenceUpdates: vi.fn().mockResolvedValue(0),

    // Test mappings
    getTestMapping: vi.fn().mockResolvedValue(null),
    getTestMappings: vi.fn().mockResolvedValue([]),
    getTestMappingsByTestPath: vi.fn().mockResolvedValue([]),
    getTestMappingsBySourcePath: vi.fn().mockResolvedValue([]),
    upsertTestMapping: vi.fn().mockResolvedValue({ id: '1', testPath: '', sourcePath: '', confidence: 0.9, createdAt: new Date(), updatedAt: new Date() }),
    deleteTestMapping: vi.fn().mockResolvedValue(undefined),
    deleteTestMappingsByTestPath: vi.fn().mockResolvedValue(0),

    // Commits
    getCommit: vi.fn().mockResolvedValue(null),
    getCommitBySha: vi.fn().mockResolvedValue(null),
    getCommits: vi.fn().mockResolvedValue([]),
    upsertCommit: vi.fn().mockResolvedValue({ id: '1', sha: '', message: '', author: '', category: '', filesChanged: [], createdAt: new Date() }),
    deleteCommit: vi.fn().mockResolvedValue(undefined),
    deleteCommitBySha: vi.fn().mockResolvedValue(undefined),

    // Ownership
    getOwnership: vi.fn().mockResolvedValue(null),
    getOwnershipByFilePath: vi.fn().mockResolvedValue([]),
    getOwnershipByAuthor: vi.fn().mockResolvedValue([]),
    getOwnerships: vi.fn().mockResolvedValue([]),
    upsertOwnership: vi.fn().mockResolvedValue({ id: '1', filePath: '', author: '', score: 0, lastModified: new Date(), createdAt: new Date() }),
    deleteOwnership: vi.fn().mockResolvedValue(undefined),
    deleteOwnershipByFilePath: vi.fn().mockResolvedValue(0),

    // Ingestion
    getIngestionItem: vi.fn().mockResolvedValue(null),
    getIngestionItems: vi.fn().mockResolvedValue([]),
    upsertIngestionItem: vi.fn().mockResolvedValue(undefined),
    deleteIngestionItem: vi.fn().mockResolvedValue(undefined),
    recordIndexingResult: vi.fn().mockResolvedValue(undefined),
    getLastIndexingResult: vi.fn().mockResolvedValue(null),
    recordBootstrapReport: vi.fn().mockResolvedValue(undefined),
    getLastBootstrapReport: vi.fn().mockResolvedValue(null),

    // Universal knowledge
    getUniversalKnowledge: vi.fn().mockResolvedValue(null),
    getUniversalKnowledgeByFile: vi.fn().mockResolvedValue([]),
    getUniversalKnowledgeByKind: vi.fn().mockResolvedValue([]),
    queryUniversalKnowledge: vi.fn().mockResolvedValue([]),
    upsertUniversalKnowledge: vi.fn().mockResolvedValue(undefined),
    upsertUniversalKnowledgeBatch: vi.fn().mockResolvedValue(undefined),
    deleteUniversalKnowledge: vi.fn().mockResolvedValue(undefined),
    deleteUniversalKnowledgeByFile: vi.fn().mockResolvedValue(0),
    searchUniversalKnowledgeBySimilarity: vi.fn().mockResolvedValue([]),

    // Assessments
    getAssessment: vi.fn().mockResolvedValue(null),
    getAssessmentByPath: vi.fn().mockResolvedValue(null),
    getAssessments: vi.fn().mockResolvedValue([]),
    upsertAssessment: vi.fn().mockResolvedValue(undefined),
    upsertAssessments: vi.fn().mockResolvedValue(undefined),
    deleteAssessment: vi.fn().mockResolvedValue(undefined),
    deleteAssessmentByPath: vi.fn().mockResolvedValue(undefined),

    // Advanced analysis
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

    // Advanced library features
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

    ...overrides,
  } as LibrarianStorage;

  return defaultStorage;
}

// ============================================================================
// TESTS
// ============================================================================

describe('generateProjectUnderstanding', () => {
  const workspaceRoot = path.resolve(process.cwd());

  it('generates project understanding from indexed data', async () => {
    const storage = createMockStorage();

    const understanding = await generateProjectUnderstanding({
      workspace: workspaceRoot,
      storage,
      includeHotspots: true,
    });

    expect(understanding).toBeDefined();
    expect(understanding.name).toBeTruthy();
    expect(understanding.languages.length).toBeGreaterThan(0);
    expect(understanding.architecture).toBeDefined();
    expect(understanding.architecture.type).toBeTruthy();
    expect(understanding.conventions).toBeDefined();
    expect(understanding.agentGuidance).toBeDefined();
    expect(understanding.metadata.confidence).toBeGreaterThan(0);
  });

  it('detects TypeScript as primary language from indexed files', async () => {
    const storage = createMockStorage();

    const understanding = await generateProjectUnderstanding({
      workspace: workspaceRoot,
      storage,
    });

    expect(understanding.languages).toContain('TypeScript');
  });

  it('identifies architectural layers from directory structure', async () => {
    const storage = createMockStorage();

    const understanding = await generateProjectUnderstanding({
      workspace: workspaceRoot,
      storage,
    });

    // Should detect layers like api, storage from the mock files
    expect(understanding.architecture.layers.length).toBeGreaterThan(0);
  });

  it('detects naming conventions from function names', async () => {
    const storage = createMockStorage();

    const understanding = await generateProjectUnderstanding({
      workspace: workspaceRoot,
      storage,
    });

    // Mock functions use camelCase
    expect(understanding.conventions.namingStyle).toBe('camelCase');
  });

  it('identifies core modules by import count', async () => {
    const storage = createMockStorage();

    const understanding = await generateProjectUnderstanding({
      workspace: workspaceRoot,
      storage,
    });

    // Core modules should be identified from graph edges
    expect(understanding.architecture.coreModules).toBeDefined();
  });

  it('generates agent guidance', async () => {
    const storage = createMockStorage();

    const understanding = await generateProjectUnderstanding({
      workspace: workspaceRoot,
      storage,
    });

    expect(understanding.agentGuidance.beforeModifying.length).toBeGreaterThan(0);
    expect(understanding.agentGuidance.commonPatterns.length).toBeGreaterThan(0);
    expect(understanding.agentGuidance.antiPatterns.length).toBeGreaterThan(0);
    expect(understanding.agentGuidance.testingRequirements.length).toBeGreaterThan(0);
  });

  it('handles missing storage data gracefully', async () => {
    const emptyStorage = createMockStorage({
      getFunctions: vi.fn().mockResolvedValue([]),
      getModules: vi.fn().mockResolvedValue([]),
      getFiles: vi.fn().mockResolvedValue([]),
      getGraphEdges: vi.fn().mockResolvedValue([]),
      getGraphMetrics: vi.fn().mockResolvedValue([]),
    });

    const understanding = await generateProjectUnderstanding({
      workspace: workspaceRoot,
      storage: emptyStorage,
    });

    // Should still produce valid understanding with defaults
    expect(understanding).toBeDefined();
    expect(understanding.name).toBeTruthy();
    expect(understanding.conventions).toBeDefined();
    expect(understanding.agentGuidance).toBeDefined();
  });
});

describe('generateAgentContextPrompt', () => {
  it('generates a formatted context prompt', () => {
    const understanding: ProjectUnderstanding = {
      name: 'test-project',
      description: 'A test project',
      purpose: 'Testing the project understanding system',
      primaryLanguage: 'TypeScript',
      languages: ['TypeScript', 'JavaScript'],
      architecture: {
        type: 'library',
        layers: ['api', 'storage', 'utils'],
        entryPoints: ['src/index.ts', 'src/cli/index.ts'],
        coreModules: ['src/api/index.ts', 'src/storage/index.ts'],
      },
      dependencies: {
        runtime: ['lodash', 'axios'],
        dev: ['vitest', 'typescript'],
        frameworks: ['Express'],
        testFrameworks: ['Vitest'],
      },
      conventions: {
        namingStyle: 'camelCase',
        testPattern: '**/*.test.ts',
        configFormat: 'json',
        importStyle: 'relative',
      },
      hotspots: {
        mostChanged: ['src/api/query.ts'],
        mostComplex: ['src/storage/sqlite.ts'],
        mostImportant: ['src/api/index.ts'],
      },
      agentGuidance: {
        beforeModifying: ['Check tests', 'Review related code'],
        commonPatterns: ['Factory pattern', 'Async/await'],
        antiPatterns: ['Circular deps', 'No error handling'],
        testingRequirements: ['Unit tests required'],
      },
      metadata: {
        generatedAt: new Date().toISOString(),
        confidence: 0.85,
        sources: ['package.json', 'directory_structure'],
      },
    };

    const prompt = generateAgentContextPrompt(understanding);

    expect(prompt).toContain('PROJECT: test-project');
    expect(prompt).toContain('PURPOSE: Testing the project understanding system');
    expect(prompt).toContain('TYPE: library');
    expect(prompt).toContain('LANGUAGES: TypeScript, JavaScript');
    expect(prompt).toContain('CONVENTIONS:');
    expect(prompt).toContain('Naming: camelCase');
    expect(prompt).toContain('BEFORE MODIFYING CODE:');
    expect(prompt).toContain('COMMON PATTERNS:');
    expect(prompt).toContain('ANTI-PATTERNS TO AVOID:');
  });

  it('handles empty values gracefully', () => {
    const understanding: ProjectUnderstanding = {
      name: 'minimal-project',
      description: '',
      purpose: 'Unknown',
      primaryLanguage: 'unknown',
      languages: [],
      architecture: {
        type: 'monolith',
        layers: [],
        entryPoints: [],
        coreModules: [],
      },
      dependencies: {
        runtime: [],
        dev: [],
        frameworks: [],
        testFrameworks: [],
      },
      conventions: {
        namingStyle: 'camelCase',
        testPattern: '**/*.test.ts',
        configFormat: 'json',
        importStyle: 'relative',
      },
      hotspots: {
        mostChanged: [],
        mostComplex: [],
        mostImportant: [],
      },
      agentGuidance: {
        beforeModifying: [],
        commonPatterns: [],
        antiPatterns: [],
        testingRequirements: [],
      },
      metadata: {
        generatedAt: new Date().toISOString(),
        confidence: 0.3,
        sources: [],
      },
    };

    const prompt = generateAgentContextPrompt(understanding);

    expect(prompt).toContain('PROJECT: minimal-project');
    expect(prompt).toContain('CORE MODULES: Not yet identified');
    expect(prompt).toContain('ENTRY POINTS: Not yet identified');
    expect(prompt).toContain('FRAMEWORKS: None detected');
  });
});

describe('createDeepProjectUnderstandingPack', () => {
  it('creates a context pack from understanding', () => {
    const understanding: ProjectUnderstanding = {
      name: 'test-project',
      description: 'Test project',
      purpose: 'Testing',
      primaryLanguage: 'TypeScript',
      languages: ['TypeScript'],
      architecture: {
        type: 'library',
        layers: ['api'],
        entryPoints: ['src/index.ts'],
        coreModules: ['src/api/index.ts'],
      },
      dependencies: {
        runtime: ['lodash'],
        dev: ['vitest'],
        frameworks: ['Express'],
        testFrameworks: ['Vitest'],
      },
      conventions: {
        namingStyle: 'camelCase',
        testPattern: '**/*.test.ts',
        configFormat: 'json',
        importStyle: 'relative',
      },
      hotspots: {
        mostChanged: [],
        mostComplex: [],
        mostImportant: ['src/api/index.ts'],
      },
      agentGuidance: {
        beforeModifying: ['Check tests'],
        commonPatterns: ['Factory pattern'],
        antiPatterns: ['Circular deps'],
        testingRequirements: ['Unit tests'],
      },
      metadata: {
        generatedAt: new Date().toISOString(),
        confidence: 0.85,
        sources: ['package.json'],
      },
    };

    const version: LibrarianVersion = {
      major: 0,
      minor: 2,
      patch: 0,
      string: '0.2.0',
      qualityTier: 'enhanced',
      indexedAt: new Date(),
      indexerVersion: '0.2.0',
      features: [],
    };

    const pack = createDeepProjectUnderstandingPack(understanding, version);

    expect(pack.packId).toContain('deep_project_understanding');
    expect(pack.packType).toBe('project_understanding');
    expect(pack.targetId).toBe('project:root:deep');
    expect(pack.keyFacts.length).toBeGreaterThan(0);
    expect(pack.confidence).toBe(0.85);
    expect(pack.summary).toContain('PROJECT: test-project');
    expect(pack.invalidationTriggers).toContain('package.json');
  });
});

describe('Integration with real workspace', () => {
  const workspaceRoot = path.resolve(process.cwd());

  it('analyzes the actual librarian project', async () => {
    // Use the actual librarian project but with mock storage
    const storage = createMockStorage();

    const understanding = await generateProjectUnderstanding({
      workspace: workspaceRoot,
      storage,
      includeHotspots: false, // Skip hotspots for faster test
    });

    // Should detect this as a TypeScript project
    expect(understanding.primaryLanguage).toBe('TypeScript');
    expect(understanding.languages).toContain('TypeScript');

    // Should detect CLI nature from package.json bin field
    expect(['cli', 'library']).toContain(understanding.architecture.type);

    // Should have test framework detection
    expect(understanding.dependencies.testFrameworks).toContain('Vitest');

    // Metadata should be populated
    expect(understanding.metadata.sources.length).toBeGreaterThan(0);
    expect(understanding.metadata.confidence).toBeGreaterThan(0.3);
  });
});
