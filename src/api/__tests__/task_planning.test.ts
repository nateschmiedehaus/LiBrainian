import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  planTask,
  classifyTask,
  isTaskPlanningQuery,
  extractTaskFromQuery,
  type TaskPlan,
  type TaskType,
} from '../task_planning.js';
import type { LiBrainianStorage } from '../../storage/types.js';

// ============================================================================
// MOCK STORAGE
// ============================================================================

function createMockStorage(options: {
  functions?: Array<{
    id: string;
    filePath: string;
    name: string;
    purpose: string;
    signature: string;
    startLine: number;
    endLine: number;
    confidence: number;
    accessCount: number;
    lastAccessed: Date | null;
    validationCount: number;
    outcomeHistory: { successes: number; failures: number };
  }>;
  modules?: Array<{
    id: string;
    path: string;
    purpose: string;
    exports: string[];
    dependencies: string[];
    confidence: number;
  }>;
  graphEdges?: Array<{
    fromId: string;
    fromType: 'function' | 'module' | 'file' | 'directory';
    toId: string;
    toType: 'function' | 'module' | 'file' | 'directory';
    edgeType: 'calls' | 'imports' | 'extends' | 'implements';
    sourceFile: string;
    sourceLine: number | null;
    confidence: number;
    computedAt: Date;
  }>;
} = {}): LiBrainianStorage {
  return {
    initialize: vi.fn(),
    close: vi.fn(),
    isInitialized: vi.fn().mockReturnValue(true),
    getCapabilities: vi.fn().mockReturnValue({
      core: { getFunctions: true, getFiles: true, getContextPacks: true },
      optional: {},
      versions: { schema: 1, api: 1 },
    }),
    getFunctions: vi.fn().mockResolvedValue(options.functions || []),
    getModules: vi.fn().mockResolvedValue(options.modules || []),
    getGraphEdges: vi.fn().mockResolvedValue(options.graphEdges || []),
    // Add other required methods as no-ops
    getMetadata: vi.fn().mockResolvedValue(null),
    setMetadata: vi.fn().mockResolvedValue(undefined),
    getState: vi.fn().mockResolvedValue(null),
    setState: vi.fn().mockResolvedValue(undefined),
    getVersion: vi.fn().mockResolvedValue(null),
    setVersion: vi.fn().mockResolvedValue(undefined),
    getFunction: vi.fn().mockResolvedValue(null),
    getFunctionByPath: vi.fn().mockResolvedValue(null),
    getFunctionsByPath: vi.fn().mockResolvedValue([]),
    getFunctionsByName: vi.fn().mockResolvedValue([]),
    upsertFunction: vi.fn().mockResolvedValue(undefined),
    upsertFunctions: vi.fn().mockResolvedValue(undefined),
    deleteFunction: vi.fn().mockResolvedValue(undefined),
    deleteFunctionsByPath: vi.fn().mockResolvedValue(undefined),
    getModule: vi.fn().mockResolvedValue(null),
    getModuleByPath: vi.fn().mockResolvedValue(null),
    upsertModule: vi.fn().mockResolvedValue(undefined),
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
    invalidateCache: vi.fn().mockResolvedValue(0),
    invalidateEmbeddings: vi.fn().mockResolvedValue(0),
    getReverseDependencies: vi.fn().mockResolvedValue([]),
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
    transaction: vi.fn().mockImplementation((fn) => fn({})),
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
    upsertTestMapping: vi.fn().mockResolvedValue({ id: '1', testPath: '', sourcePath: '', confidence: 0, createdAt: new Date(), updatedAt: new Date() }),
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
  } as unknown as LiBrainianStorage;
}

// ============================================================================
// TESTS: classifyTask
// ============================================================================

describe('classifyTask', () => {
  describe('bug fix classification', () => {
    const bugQueries = [
      'fix the crash in query handler',
      'bug: null pointer exception',
      'broken pagination in list view',
      'issue with login failing',
      'regression in the search feature',
    ];

    for (const query of bugQueries) {
      it(`classifies "${query}" as bug_fix`, () => {
        expect(classifyTask(query)).toBe('bug_fix');
      });
    }
  });

  describe('feature add classification', () => {
    const featureQueries = [
      'add caching to the API',
      'implement rate limiting',
      'create new endpoint for users',
      'build a notification system',
      'develop real-time updates',
    ];

    for (const query of featureQueries) {
      it(`classifies "${query}" as feature_add`, () => {
        expect(classifyTask(query)).toBe('feature_add');
      });
    }
  });

  describe('feature modify classification', () => {
    const modifyQueries = [
      'update the search algorithm',
      'modify the response handler',
      'change the response format',
      'improve logging output',
      'enhance user validation',
    ];

    for (const query of modifyQueries) {
      it(`classifies "${query}" as feature_modify`, () => {
        expect(classifyTask(query)).toBe('feature_modify');
      });
    }
  });

  describe('refactor classification', () => {
    const refactorQueries = [
      'refactor the authentication module',
      'restructure the storage layer',
      'clean up the utility functions',
      'extract common code into shared module',
      'split the monolithic service',
    ];

    for (const query of refactorQueries) {
      it(`classifies "${query}" as refactor`, () => {
        expect(classifyTask(query)).toBe('refactor');
      });
    }
  });

  describe('performance classification', () => {
    const perfQueries = [
      'optimize database queries',
      'speed up the search function',
      'reduce memory usage',
      'lower latency of the system',
      'make the cache faster',
    ];

    for (const query of perfQueries) {
      it(`classifies "${query}" as performance`, () => {
        expect(classifyTask(query)).toBe('performance');
      });
    }
  });

  describe('security classification', () => {
    const securityQueries = [
      'encrypt sensitive data',
      'sanitize user input',
      'validate and escape untrusted data',
      'encrypt all passwords',
      'sanitize SQL queries',
    ];

    for (const query of securityQueries) {
      it(`classifies "${query}" as security`, () => {
        expect(classifyTask(query)).toBe('security');
      });
    }
  });

  describe('documentation classification', () => {
    const docQueries = [
      'document the API endpoints',
      'write documentation for the module',
      'explain the architecture in docs',
      'describe the configuration options',
      'clarify the usage in README',
    ];

    for (const query of docQueries) {
      it(`classifies "${query}" as documentation`, () => {
        expect(classifyTask(query)).toBe('documentation');
      });
    }
  });

  describe('test classification', () => {
    const testQueries = [
      'write unit tests for storage',
      'increase test coverage',
      'write integration test for database',
      'write spec test for the module',
      'e2e tests for user flow',
    ];

    for (const query of testQueries) {
      it(`classifies "${query}" as test`, () => {
        expect(classifyTask(query)).toBe('test');
      });
    }
  });

  describe('dependency update classification', () => {
    const depQueries = [
      'upgrade typescript to version 5',
      'bump package versions',
      'migrate to new React version',
      'upgrade npm packages',
    ];

    for (const query of depQueries) {
      it(`classifies "${query}" as dependency_update`, () => {
        expect(classifyTask(query)).toBe('dependency_update');
      });
    }
  });

  describe('configuration classification', () => {
    const configQueries = [
      'setup development settings',
      'configure logging levels',
      'setup environment configuration',
      'initialize config options',
    ];

    for (const query of configQueries) {
      it(`classifies "${query}" as configuration`, () => {
        expect(classifyTask(query)).toBe('configuration');
      });
    }
  });
});

// ============================================================================
// TESTS: isTaskPlanningQuery
// ============================================================================

describe('isTaskPlanningQuery', () => {
  describe('matches planning queries', () => {
    const planningQueries = [
      'how should I implement caching',
      'how do I implement rate limiting',
      'how to add authentication',
      'plan to implement new feature',
      'what files do I need to change',
      'implementation guide for caching',
      'where should I start',
      "what's the best way to implement this",
      'help me plan the implementation',
      'before I start implementing',
      'what would be affected by this change',
    ];

    for (const query of planningQueries) {
      it(`matches "${query}"`, () => {
        expect(isTaskPlanningQuery(query)).toBe(true);
      });
    }
  });

  describe('does not match non-planning queries', () => {
    const nonPlanningQueries = [
      'what does this function do',
      'show me the code for authentication',
      'find the login handler',
      'list all API endpoints',
      'explain the architecture',
    ];

    for (const query of nonPlanningQueries) {
      it(`does not match "${query}"`, () => {
        expect(isTaskPlanningQuery(query)).toBe(false);
      });
    }
  });
});

// ============================================================================
// TESTS: extractTaskFromQuery
// ============================================================================

describe('extractTaskFromQuery', () => {
  it('extracts task from "how should I implement" queries', () => {
    const query = 'how should I implement caching for the API';
    expect(extractTaskFromQuery(query)).toBe('caching for the API');
  });

  it('extracts task from "how to implement" queries', () => {
    const query = 'how to implement rate limiting';
    expect(extractTaskFromQuery(query)).toBe('rate limiting');
  });

  it('extracts task from "plan to" queries', () => {
    const query = 'plan to implement user authentication';
    expect(extractTaskFromQuery(query)).toBe('user authentication');
  });

  it('extracts task from "implementation plan for" queries', () => {
    const query = 'implementation plan for caching system';
    expect(extractTaskFromQuery(query)).toBe('caching system');
  });

  it('handles queries with trailing question marks', () => {
    const query = 'how should I implement caching???';
    expect(extractTaskFromQuery(query)).toBe('caching');
  });

  it('returns original query if no prefix matches', () => {
    const query = 'add caching to the system';
    expect(extractTaskFromQuery(query)).toBe('add caching to the system');
  });
});

// ============================================================================
// TESTS: planTask
// ============================================================================

describe('planTask', () => {
  it('generates a plan with all required fields', async () => {
    const storage = createMockStorage({
      functions: [
        {
          id: 'fn1',
          filePath: '/project/src/api/query.ts',
          name: 'queryHandler',
          purpose: 'Handles API queries',
          signature: 'function queryHandler()',
          startLine: 1,
          endLine: 100,
          confidence: 0.8,
          accessCount: 10,
          lastAccessed: new Date(),
          validationCount: 5,
          outcomeHistory: { successes: 4, failures: 1 },
        },
      ],
    });

    const plan = await planTask(storage, 'add caching to the query handler', '/project');

    expect(plan.task).toBe('add caching to the query handler');
    expect(plan.classification).toBe('feature_add');
    expect(plan.complexity).toBeDefined();
    expect(plan.estimatedScope).toBeDefined();
    expect(plan.steps).toBeDefined();
    expect(plan.steps.length).toBeGreaterThan(0);
    expect(plan.contextFiles).toBeDefined();
    expect(plan.filesToModify).toBeDefined();
    expect(plan.testsRequired).toBeDefined();
    expect(plan.risks).toBeDefined();
    expect(plan.preflightChecks).toBeDefined();
    expect(plan.confidence).toBeGreaterThan(0);
    expect(plan.confidence).toBeLessThanOrEqual(1);
    expect(plan.planningTimeMs).toBeGreaterThanOrEqual(0);
  });

  it('identifies relevant context files', async () => {
    const storage = createMockStorage({
      functions: [
        {
          id: 'fn1',
          filePath: '/project/src/api/cache.ts',
          name: 'cacheGet',
          purpose: 'Get implement caching value for queries',
          signature: 'function cacheGet(key: string)',
          startLine: 1,
          endLine: 20,
          confidence: 0.9,
          accessCount: 5,
          lastAccessed: new Date(),
          validationCount: 3,
          outcomeHistory: { successes: 3, failures: 0 },
        },
        {
          id: 'fn2',
          filePath: '/project/src/api/cache.ts',
          name: 'cacheSet',
          purpose: 'Set implement caching value for queries',
          signature: 'function cacheSet(key: string, value: any)',
          startLine: 25,
          endLine: 45,
          confidence: 0.9,
          accessCount: 5,
          lastAccessed: new Date(),
          validationCount: 3,
          outcomeHistory: { successes: 3, failures: 0 },
        },
      ],
    });

    const plan = await planTask(storage, 'implement caching for queries', '/project');

    // Should find context files based on keyword matching
    expect(plan.contextFiles.length).toBeGreaterThan(0);
    expect(plan.contextFiles.some((f) => f.path.includes('cache'))).toBe(true);
  });

  it('generates appropriate steps for bug fixes', async () => {
    const storage = createMockStorage({
      functions: [
        {
          id: 'fn1',
          filePath: '/project/src/api/query.ts',
          name: 'executeQuery',
          purpose: 'Execute database query',
          signature: 'function executeQuery()',
          startLine: 1,
          endLine: 50,
          confidence: 0.8,
          accessCount: 10,
          lastAccessed: new Date(),
          validationCount: 5,
          outcomeHistory: { successes: 4, failures: 1 },
        },
      ],
    });

    const plan = await planTask(storage, 'fix the null pointer crash in query execution', '/project');

    expect(plan.classification).toBe('bug_fix');
    expect(plan.steps.some((s) => s.action === 'investigate')).toBe(true);
    expect(plan.steps.some((s) => s.action === 'verify')).toBe(true);
  });

  it('identifies risks for security tasks', async () => {
    const storage = createMockStorage();

    // Use a more specific security-focused task
    const plan = await planTask(storage, 'encrypt and sanitize all user input', '/project');

    expect(plan.classification).toBe('security');
    expect(plan.risks.length).toBeGreaterThan(0);
    expect(plan.risks.some((r) => r.risk.toLowerCase().includes('security'))).toBe(true);
  });

  it('generates test requirements', async () => {
    const storage = createMockStorage({
      functions: [
        {
          id: 'fn1',
          filePath: '/project/src/api/handler.ts',
          name: 'handler',
          purpose: 'Request handler add validation to process',
          signature: 'function handler()',
          startLine: 1,
          endLine: 50,
          confidence: 0.8,
          accessCount: 10,
          lastAccessed: new Date(),
          validationCount: 5,
          outcomeHistory: { successes: 4, failures: 1 },
        },
      ],
    });

    const plan = await planTask(storage, 'add validation to the handler', '/project');

    // Test requirements are generated based on affected files
    expect(plan.testsRequired.length).toBeGreaterThan(0);
    expect(plan.testsRequired[0].scenarios.length).toBeGreaterThan(0);
  });

  it('handles empty storage gracefully', async () => {
    const storage = createMockStorage();

    const plan = await planTask(storage, 'implement new feature', '/project');

    expect(plan.task).toBe('implement new feature');
    expect(plan.classification).toBe('feature_add');
    expect(plan.steps.length).toBeGreaterThan(0);
    expect(plan.confidence).toBeGreaterThan(0);
  });

  it('generates appropriate preflight checks for dependency updates', async () => {
    const storage = createMockStorage();

    const plan = await planTask(storage, 'upgrade TypeScript to version 5', '/project');

    expect(plan.classification).toBe('dependency_update');
    expect(plan.preflightChecks.some((c) => c.toLowerCase().includes('backup'))).toBe(true);
    expect(plan.preflightChecks.some((c) => c.toLowerCase().includes('breaking'))).toBe(true);
  });

  it('identifies API risks when API files affected', async () => {
    const storage = createMockStorage({
      functions: [
        {
          id: 'fn1',
          filePath: '/project/src/api/endpoints.ts',
          name: 'getUser',
          purpose: 'Get user API endpoint',
          signature: 'function getUser()',
          startLine: 1,
          endLine: 50,
          confidence: 0.8,
          accessCount: 10,
          lastAccessed: new Date(),
          validationCount: 5,
          outcomeHistory: { successes: 4, failures: 1 },
        },
      ],
    });

    const plan = await planTask(storage, 'modify the API endpoint response', '/project');

    expect(plan.risks.some((r) => r.risk.toLowerCase().includes('api'))).toBe(true);
    expect(plan.preflightChecks.some((c) => c.toLowerCase().includes('api'))).toBe(true);
  });
});

// ============================================================================
// TESTS: Plan Structure
// ============================================================================

describe('TaskPlan structure', () => {
  it('has steps with proper dependencies', async () => {
    const storage = createMockStorage({
      functions: [
        {
          id: 'fn1',
          filePath: '/project/src/service.ts',
          name: 'service',
          purpose: 'Service function for logging',
          signature: 'function service()',
          startLine: 1,
          endLine: 50,
          confidence: 0.8,
          accessCount: 10,
          lastAccessed: new Date(),
          validationCount: 5,
          outcomeHistory: { successes: 4, failures: 1 },
        },
      ],
    });

    const plan = await planTask(storage, 'add logging to the service', '/project');

    // Verify step order is sequential
    const orders = plan.steps.map((s) => s.order);
    for (let i = 1; i < orders.length; i++) {
      expect(orders[i]).toBeGreaterThan(orders[i - 1]);
    }

    // Verify dependencies reference valid steps (must be less than or equal to current step minus 1)
    for (const step of plan.steps) {
      for (const dep of step.dependencies) {
        expect(dep).toBeLessThanOrEqual(step.order - 1);
      }
    }
  });

  it('has valid complexity values', async () => {
    const storage = createMockStorage();
    const plan = await planTask(storage, 'add feature', '/project');

    const validComplexities = ['trivial', 'simple', 'moderate', 'complex', 'epic'];
    expect(validComplexities).toContain(plan.complexity);
  });

  it('has valid risk levels', async () => {
    const storage = createMockStorage();
    const plan = await planTask(storage, 'security update', '/project');

    const validRiskLevels = ['low', 'medium', 'high'];
    expect(validRiskLevels).toContain(plan.estimatedScope.riskLevel);
  });

  it('has valid file priorities', async () => {
    const storage = createMockStorage({
      functions: [
        {
          id: 'fn1',
          filePath: '/project/src/test.ts',
          name: 'test',
          purpose: 'Test function for testing',
          signature: 'function test()',
          startLine: 1,
          endLine: 10,
          confidence: 0.9,
          accessCount: 5,
          lastAccessed: new Date(),
          validationCount: 3,
          outcomeHistory: { successes: 3, failures: 0 },
        },
      ],
    });

    const plan = await planTask(storage, 'implement test feature', '/project');

    const validPriorities = ['must-read', 'should-read', 'helpful'];
    for (const file of plan.contextFiles) {
      expect(validPriorities).toContain(file.priority);
    }
  });
});
