/**
 * @fileoverview Tests for Unified Librarian Orchestrator
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  initializeLibrarian,
  hasSession,
  getSession,
  shutdownAllSessions,
  getActiveSessionCount,
  type LibrarianSession,
  type TaskResult,
  type HealthReport,
} from '../unified_init.js';

// Mock dependencies
vi.mock('../../integration/first_run_gate.js', () => ({
  ensureLibrarianReady: vi.fn().mockResolvedValue({
    success: true,
    librarian: {
      query: vi.fn().mockResolvedValue({
        packs: [],
        summary: 'Test summary',
      }),
      reindexFiles: vi.fn().mockResolvedValue(undefined),
      isReady: () => true,
    },
    wasBootstrapped: false,
    wasUpgraded: false,
    durationMs: 100,
  }),
  getLibrarian: vi.fn().mockReturnValue({
    query: vi.fn().mockResolvedValue({
      packs: [],
      summary: 'Test summary',
    }),
    reindexFiles: vi.fn().mockResolvedValue(undefined),
  }),
  isLibrarianReady: vi.fn().mockReturnValue(true),
  resetGate: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../integration/wave0_integration.js', () => ({
  enrichTaskContext: vi.fn().mockResolvedValue({
    summary: 'Test context',
    keyFacts: ['Fact 1'],
    snippets: [],
    relatedFiles: ['file.ts'],
    patterns: [],
    gotchas: [],
    confidence: 0.8,
    drillDownHints: [],
    methodHints: [],
    packIds: ['pack-1', 'pack-2'],
  }),
  recordTaskOutcome: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../integration/file_watcher.js', () => ({
  startFileWatcher: vi.fn().mockResolvedValue({
    stop: vi.fn().mockResolvedValue(undefined),
  }),
  stopFileWatcher: vi.fn(),
}));

vi.mock('../../measurement/observability.js', () => ({
  generateStateReport: vi.fn().mockResolvedValue({
    kind: 'LibrarianStateReport.v1',
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    codeGraphHealth: {
      entityCount: 100,
      relationCount: 50,
      coverageRatio: 0.95,
      orphanEntities: 5,
      cycleCount: 0,
      entityCountByType: {},
    },
    indexFreshness: {
      lastIndexTime: new Date().toISOString(),
      stalenessMs: 1000,
      pendingChanges: 0,
      indexVersion: '1.0.0',
      isFresh: true,
    },
    confidenceState: {
      meanConfidence: 0.75,
      geometricMeanConfidence: 0.73,
      lowConfidenceCount: 5,
      defeaterCount: 2,
      defeatersByType: {},
      calibrationError: null,
    },
    queryPerformance: {
      queryLatencyP50: 100,
      queryLatencyP99: 500,
      cacheHitRate: 0.8,
      retrievalRecall: 0.9,
      queryCount: 50,
    },
    recoveryState: 'healthy',
    lastRecoveryTime: null,
    health: {
      status: 'healthy',
      checks: {
        indexFresh: true,
        confidenceAcceptable: true,
        defeatersLow: true,
        latencyAcceptable: true,
        coverageAcceptable: true,
      },
      degradationReasons: [],
    },
  }),
  assessHealth: vi.fn().mockReturnValue({
    status: 'healthy',
    checks: {
      indexFresh: true,
      confidenceAcceptable: true,
      defeatersLow: true,
      latencyAcceptable: true,
      coverageAcceptable: true,
    },
    degradationReasons: [],
  }),
  SLO_THRESHOLDS: {
    indexFreshnessMs: 300000,
    queryLatencyP50Ms: 500,
    queryLatencyP99Ms: 2000,
    confidenceMeanMin: 0.7,
    maxDefeatersHealthy: 10,
    coverageRatioMin: 0.9,
    recoveryTimeMs: 900000,
  },
}));

vi.mock('../../integration/recovery.js', () => ({
  executeRecovery: vi.fn().mockResolvedValue({
    success: true,
    actionsExecuted: [],
    tokensUsed: 0,
    embeddingsUsed: 0,
    filesReindexed: 0,
    durationMs: 100,
    errors: [],
    newState: 'healthy',
  }),
  getRecoveryStatus: vi.fn().mockReturnValue({
    currentState: 'healthy',
    inProgress: false,
    lastRecoveryTime: null,
    remainingBudget: {
      maxTokensPerHour: 100000,
      maxEmbeddingsPerHour: 1000,
      maxReindexFilesPerHour: 100,
      cooldownAfterRecovery: 15,
    },
    cooldownRemainingMs: 0,
  }),
  diagnoseDegradation: vi.fn().mockReturnValue([]),
}));

vi.mock('../../integration/agent_feedback.js', () => ({
  processAgentFeedback: vi.fn().mockResolvedValue({
    adjustments: [],
    gaps: [],
    processed: true,
  }),
}));

vi.mock('../../telemetry/logger.js', () => ({
  logInfo: vi.fn(),
  logWarning: vi.fn(),
  logError: vi.fn(),
}));

describe('Unified Librarian Orchestrator', () => {
  const testWorkspace = '/test/workspace';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await shutdownAllSessions();
  });

  describe('initializeLibrarian', () => {
    it('should initialize and return a session', async () => {
      const session = await initializeLibrarian(testWorkspace, { silent: true });

      expect(session).toBeDefined();
      expect(session.workspace).toBe(testWorkspace);
      expect(typeof session.query).toBe('function');
      expect(typeof session.getContext).toBe('function');
      expect(typeof session.recordOutcome).toBe('function');
      expect(typeof session.health).toBe('function');
      expect(typeof session.shutdown).toBe('function');
    });

    it('should reuse existing session for same workspace', async () => {
      const session1 = await initializeLibrarian(testWorkspace, { silent: true });
      const session2 = await initializeLibrarian(testWorkspace, { silent: true });

      expect(session1.workspace).toBe(session2.workspace);
      expect(getActiveSessionCount()).toBe(1);
    });

    it('should track active sessions', async () => {
      expect(getActiveSessionCount()).toBe(0);
      expect(hasSession(testWorkspace)).toBe(false);

      await initializeLibrarian(testWorkspace, { silent: true });

      expect(getActiveSessionCount()).toBe(1);
      expect(hasSession(testWorkspace)).toBe(true);
    });

    it('should support silent mode', async () => {
      const { logInfo } = await import('../../telemetry/logger.js');

      await initializeLibrarian(testWorkspace, { silent: true });

      // In silent mode, progress logging should be minimal
      // (the actual test depends on implementation)
      expect(logInfo).not.toHaveBeenCalledWith(
        expect.stringContaining('Bootstrap started'),
        expect.any(Object)
      );
    });
  });

  describe('LibrarianSession.query', () => {
    it('should query and return context with packIds', async () => {
      const session = await initializeLibrarian(testWorkspace, { silent: true });
      const context = await session.query('How does authentication work?');

      expect(context).toBeDefined();
      expect(context.packIds).toBeInstanceOf(Array);
      expect(context.summary).toBeDefined();
    });

    it('should support query options', async () => {
      const session = await initializeLibrarian(testWorkspace, { silent: true });
      const context = await session.query('Test query', {
        taskType: 'implementation',
        ucRequirements: ['UC-001'],
      });

      expect(context).toBeDefined();
    });
  });

  describe('LibrarianSession.getContext', () => {
    it('should get context for specific files', async () => {
      const session = await initializeLibrarian(testWorkspace, { silent: true });
      const context = await session.getContext(['src/auth.ts', 'src/session.ts']);

      expect(context).toBeDefined();
      expect(context.packIds).toBeInstanceOf(Array);
    });
  });

  describe('LibrarianSession.recordOutcome', () => {
    it('should record task outcome', async () => {
      const { recordTaskOutcome } = await import('../../integration/wave0_integration.js');
      const session = await initializeLibrarian(testWorkspace, { silent: true });

      const result: TaskResult = {
        success: true,
        packIds: ['pack-1', 'pack-2'],
        filesModified: ['src/auth.ts'],
      };

      await session.recordOutcome(result);

      expect(recordTaskOutcome).toHaveBeenCalledWith(testWorkspace, expect.objectContaining({
        success: true,
        packIds: ['pack-1', 'pack-2'],
        filesModified: ['src/auth.ts'],
      }));
    });

    it('should handle failure outcomes', async () => {
      const { recordTaskOutcome } = await import('../../integration/wave0_integration.js');
      const session = await initializeLibrarian(testWorkspace, { silent: true });

      const result: TaskResult = {
        success: false,
        packIds: ['pack-1'],
        failureReason: 'Test failure',
        failureType: 'assertion',
      };

      await session.recordOutcome(result);

      expect(recordTaskOutcome).toHaveBeenCalledWith(testWorkspace, expect.objectContaining({
        success: false,
        failureReason: 'Test failure',
        failureType: 'assertion',
      }));
    });
  });

  describe('LibrarianSession.health', () => {
    it('should return health report', async () => {
      const session = await initializeLibrarian(testWorkspace, { silent: true });
      const health = session.health();

      expect(health).toBeDefined();
      expect(health.status).toBe('healthy');
      expect(health.recoveryState).toBe('healthy');
      expect(health.checks).toBeDefined();
      expect(health.backgroundProcesses).toBeDefined();
      expect(typeof health.uptimeMs).toBe('number');
      expect(health.tier).toBe('full');
    });

    it('should show background processes status', async () => {
      const session = await initializeLibrarian(testWorkspace, { silent: true });
      const health = session.health();

      expect(health.backgroundProcesses.fileWatcher).toBe(true);
      expect(health.backgroundProcesses.selfHealing).toBe(true);
    });

    it('should track uptime', async () => {
      const session = await initializeLibrarian(testWorkspace, { silent: true });

      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 10));

      const health = session.health();
      expect(health.uptimeMs).toBeGreaterThanOrEqual(5);
    });
  });

  describe('LibrarianSession.shutdown', () => {
    it('should clean up resources on shutdown', async () => {
      const { resetGate } = await import('../../integration/first_run_gate.js');
      const session = await initializeLibrarian(testWorkspace, { silent: true });

      expect(hasSession(testWorkspace)).toBe(true);

      await session.shutdown();

      expect(hasSession(testWorkspace)).toBe(false);
      expect(resetGate).toHaveBeenCalledWith(testWorkspace);
    });
  });

  describe('Session management', () => {
    it('should get existing session', async () => {
      await initializeLibrarian(testWorkspace, { silent: true });

      const session = getSession(testWorkspace);

      expect(session).not.toBeNull();
      expect(session?.workspace).toBe(testWorkspace);
    });

    it('should return null for non-existent session', () => {
      const session = getSession('/non/existent/path');
      expect(session).toBeNull();
    });

    it('should shutdown all sessions', async () => {
      await initializeLibrarian(testWorkspace, { silent: true });
      await initializeLibrarian('/another/workspace', { silent: true });

      expect(getActiveSessionCount()).toBe(2);

      await shutdownAllSessions();

      expect(getActiveSessionCount()).toBe(0);
    });
  });

  describe('Options', () => {
    it('should respect skipWatcher option', async () => {
      const session = await initializeLibrarian(testWorkspace, {
        silent: true,
        skipWatcher: true,
      });

      const health = session.health();
      expect(health.backgroundProcesses.fileWatcher).toBe(false);
    });

    it('should respect skipHealing option', async () => {
      const session = await initializeLibrarian(testWorkspace, {
        silent: true,
        skipHealing: true,
      });

      const health = session.health();
      expect(health.backgroundProcesses.selfHealing).toBe(false);
    });
  });
});

describe('Type exports', () => {
  it('should export all necessary types', async () => {
    // These imports should work without errors
    const types = await import('../unified_init.js');

    expect(types.initializeLibrarian).toBeDefined();
    expect(types.hasSession).toBeDefined();
    expect(types.getSession).toBeDefined();
    expect(types.shutdownAllSessions).toBeDefined();
    expect(types.getActiveSessionCount).toBeDefined();
  });
});
