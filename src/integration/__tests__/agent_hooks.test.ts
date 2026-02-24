/**
 * @fileoverview Tests for agent_hooks.ts - Automatic agent integration
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'path';
import * as fs from 'fs/promises';
import { tmpdir } from 'os';

import {
  getTaskContext,
  getContext,
  reportTaskOutcome,
  executeWithContext,
  startFileMonitoring,
  stopFileMonitoring,
  withFileMonitoring,
  createPreTaskHook,
  createPostTaskHook,
  createAgentHooks,
  isLibrarianAvailable,
  detectWorkspace,
  type TaskContext,
  type TaskContextRequest,
  type TaskOutcome,
  type AgentHookConfig,
} from '../agent_hooks.js';

// Mock the unified_init module (primary API)
// Factory must be self-contained - no external variable references
vi.mock('../../orchestrator/unified_init.js', () => {
  const mockSession = {
    query: vi.fn().mockResolvedValue({
      intent: 'test intent',
      summary: 'Test summary',
      keyFacts: ['Fact 1', 'Fact 2'],
      snippets: [],
      relatedFiles: ['src/test.ts'],
      patterns: [],
      gotchas: [],
      confidence: 0.8,
      drillDownHints: ['Check the tests'],
      methodHints: ['Use TDD'],
      packIds: ['pack-1', 'pack-2'],
    }),
    recordOutcome: vi.fn().mockResolvedValue(undefined),
    librarian: {
      getStorage: vi.fn().mockReturnValue({
        getContextPack: vi.fn().mockResolvedValue({ packId: 'pack-1', confidence: 0.5 }),
        upsertContextPack: vi.fn().mockResolvedValue(undefined),
        recordContextPackAccess: vi.fn().mockResolvedValue(undefined),
        setState: vi.fn().mockResolvedValue(undefined),
        getState: vi.fn().mockResolvedValue(null),
      }),
    },
  };
  return {
    initializeLibrarian: vi.fn().mockResolvedValue(mockSession),
    getSession: vi.fn().mockReturnValue(mockSession),
    hasSession: vi.fn().mockReturnValue(true),
  };
});

// Mock the dependencies
vi.mock('../wave0_integration.js', () => ({
  formatLibrarianContext: vi.fn().mockReturnValue('## Librarian Context\n\nTest formatted context'),
}));

vi.mock('../agent_feedback.js', () => ({
  processAgentFeedback: vi.fn().mockResolvedValue({
    feedbackId: 'feedback-1',
    processedAt: new Date().toISOString(),
    adjustmentsApplied: 2,
    gapsLogged: 0,
    adjustments: [],
    gaps: [],
  }),
  createTaskOutcomeFeedback: vi.fn().mockImplementation((queryId, packIds, outcome, agentId) => ({
    queryId,
    relevanceRatings: packIds.map((packId: string) => ({
      packId,
      relevant: outcome !== 'failure',
      usefulness: outcome === 'success' ? 1.0 : outcome === 'partial' ? 0.5 : 0.0,
    })),
    timestamp: new Date().toISOString(),
    agentId,
  })),
}));

vi.mock('../../telemetry/logger.js', () => ({
  logInfo: vi.fn(),
  logWarning: vi.fn(),
  logError: vi.fn(),
}));

vi.mock('../../events.js', () => ({
  globalEventBus: {
    emit: vi.fn().mockResolvedValue(undefined),
  },
  createTaskReceivedEvent: vi.fn().mockReturnValue({ type: 'task_received' }),
  createTaskCompletedEvent: vi.fn().mockReturnValue({ type: 'task_completed' }),
  createTaskFailedEvent: vi.fn().mockReturnValue({ type: 'task_failed' }),
  createFileModifiedEvent: vi.fn().mockReturnValue({ type: 'file_modified' }),
}));

vi.mock('../../constructions/processes/quality_bar_constitution_construction.js', () => ({
  getTaskQualityNorms: vi.fn().mockResolvedValue([
    {
      id: 'QBC-001',
      category: 'types',
      level: 'MUST',
      rule: 'Type definitions SHOULD use explicit interfaces or type aliases for public contracts.',
      frequency: 0.95,
      example: 'src/integration/agent_hooks.ts#TaskContext',
      score: 4.2,
    },
    {
      id: 'QBC-011',
      category: 'testing',
      level: 'SHOULD',
      rule: 'Unit and integration tests SHOULD be organized with describe blocks.',
      frequency: 0.88,
      example: 'src/integration/__tests__/agent_hooks.test.ts#describe',
      score: 3.4,
    },
    {
      id: 'QBC-009',
      category: 'logging',
      level: 'SHOULD',
      rule: 'Operational telemetry SHOULD use structured logInfo with stable bracketed tags.',
      frequency: 0.84,
      example: 'src/integration/agent_hooks.ts#logInfo',
      score: 3.1,
    },
  ]),
}));

describe('agent_hooks', () => {
  let testDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    testDir = path.join(tmpdir(), `agent-hooks-test-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('getTaskContext', () => {
    it('should return context for a valid request', async () => {
      const request: TaskContextRequest = {
        intent: 'Add error handling',
        affectedFiles: ['src/api.ts'],
      };

      const context = await getTaskContext(request, { workspace: testDir });

      expect(context).toBeDefined();
      expect(context.taskId).toBeDefined();
      expect(context.formatted).toContain('Librarian Context');
      expect(context.structured).toBeDefined();
      expect(context.structured.keyFacts).toContain('Fact 1');
      expect(context.packIds).toEqual(['pack-1', 'pack-2']);
      expect(context.confidence).toBe(0.8);
      expect(context.librarianAvailable).toBe(true);
      expect(context.qualityNorms).toHaveLength(3);
      expect(context.formatted).toContain('### Quality Norms');
    });

    it('should use provided taskId', async () => {
      const request: TaskContextRequest = {
        intent: 'Fix bug',
        taskId: 'custom-task-123',
      };

      const context = await getTaskContext(request, { workspace: testDir });

      expect(context.taskId).toBe('custom-task-123');
    });

    it('should return fallback context when Librarian fails', async () => {
      const { initializeLibrarian, hasSession } = await import('../../orchestrator/unified_init.js');
      vi.mocked(hasSession).mockReturnValueOnce(false);
      vi.mocked(initializeLibrarian).mockRejectedValueOnce(new Error('Initialization failed'));

      const request: TaskContextRequest = {
        intent: 'Test intent',
      };

      const context = await getTaskContext(request, { workspace: testDir });

      expect(context.librarianAvailable).toBe(false);
      expect(context.confidence).toBe(0);
      expect(context.formatted).toBe('');
      expect(context.qualityNorms).toEqual([]);
    });

    it('should cache context for repeated requests', async () => {
      const { getSession } = await import('../../orchestrator/unified_init.js');
      const session = vi.mocked(getSession)();

      const request: TaskContextRequest = {
        intent: 'Same request',
        affectedFiles: ['src/same.ts'],
      };

      // Clear previous calls
      if (session) {
        vi.mocked(session.query).mockClear();
      }

      // First call
      await getTaskContext(request, { workspace: testDir });
      // Second call with same request
      await getTaskContext(request, { workspace: testDir });

      // session.query should only be called once due to caching
      expect(session?.query).toHaveBeenCalledTimes(1);
    });
  });

  describe('getContext', () => {
    it('should be a shorthand for getTaskContext', async () => {
      const context = await getContext('Simple intent', ['file.ts'], { workspace: testDir });

      expect(context).toBeDefined();
      // Intent in structured context is set from the request (not the mock's returned intent)
      expect(context.structured.intent).toBe('Simple intent');
      expect(context.structured.summary).toBe('Test summary'); // From mock
    });
  });

  describe('reportTaskOutcome', () => {
    it('should record successful outcome', async () => {
      const { getSession } = await import('../../orchestrator/unified_init.js');
      const session = vi.mocked(getSession)();
      if (session) vi.mocked(session.recordOutcome).mockClear();

      const outcome: Omit<TaskOutcome, 'taskId'> = {
        success: true,
        filesModified: ['src/api.ts'],
      };

      await reportTaskOutcome('task-123', outcome, { workspace: testDir });

      expect(session?.recordOutcome).toHaveBeenCalledWith({
        taskId: 'task-123',
        packIds: [],
        success: true,
        filesModified: ['src/api.ts'],
        failureReason: undefined,
        failureType: undefined,
        intent: undefined,
      });
    });

    it('should record failed outcome', async () => {
      const { getSession } = await import('../../orchestrator/unified_init.js');
      const session = vi.mocked(getSession)();
      if (session) vi.mocked(session.recordOutcome).mockClear();

      const outcome: Omit<TaskOutcome, 'taskId'> = {
        success: false,
        failureReason: 'Test failed',
        failureType: 'knowledge_mismatch',
      };

      await reportTaskOutcome('task-456', outcome, { workspace: testDir });

      expect(session?.recordOutcome).toHaveBeenCalledWith({
        taskId: 'task-456',
        packIds: [],
        success: false,
        filesModified: undefined,
        failureReason: 'Test failed',
        failureType: 'knowledge_mismatch',
        intent: undefined,
      });
    });

    it('should accept TaskContext for pack IDs', async () => {
      const { getSession } = await import('../../orchestrator/unified_init.js');
      const session = vi.mocked(getSession)();
      if (session) vi.mocked(session.recordOutcome).mockClear();

      const context: TaskContext = {
        taskId: 'task-with-context',
        formatted: '',
        structured: { intent: 'test-intent' } as TaskContext['structured'],
        packIds: ['pack-a', 'pack-b'],
        confidence: 0.9,
        librarianAvailable: true,
        drillDownHints: [],
        methodHints: [],
        qualityNorms: [],
      };

      await reportTaskOutcome(context, { success: true }, { workspace: testDir });

      expect(session?.recordOutcome).toHaveBeenCalledWith(expect.objectContaining({
        taskId: 'task-with-context',
        packIds: ['pack-a', 'pack-b'],
        success: true,
        intent: 'test-intent',
      }));
    });
  });

  describe('file monitoring', () => {
    it('should track file changes during monitoring', async () => {
      const testFile = path.join(testDir, 'monitored.ts');
      await fs.writeFile(testFile, 'initial content');

      await startFileMonitoring('monitor-task', [testFile], { workspace: testDir });

      // Modify the file
      await fs.writeFile(testFile, 'modified content');

      const modifiedFiles = await stopFileMonitoring('monitor-task', { workspace: testDir });

      expect(modifiedFiles).toContain(testFile);
    });

    it('should detect new files', async () => {
      const testFile = path.join(testDir, 'new-file.ts');

      await startFileMonitoring('new-file-task', [testFile], { workspace: testDir });

      // Create the file
      await fs.writeFile(testFile, 'new content');

      const modifiedFiles = await stopFileMonitoring('new-file-task', { workspace: testDir });

      expect(modifiedFiles).toContain(testFile);
    });

    it('should detect deleted files', async () => {
      const testFile = path.join(testDir, 'to-delete.ts');
      await fs.writeFile(testFile, 'content');

      await startFileMonitoring('delete-task', [testFile], { workspace: testDir });

      // Delete the file
      await fs.unlink(testFile);

      const modifiedFiles = await stopFileMonitoring('delete-task', { workspace: testDir });

      expect(modifiedFiles).toContain(testFile);
    });

    it('should return empty array for unknown task', async () => {
      const modifiedFiles = await stopFileMonitoring('unknown-task');

      expect(modifiedFiles).toEqual([]);
    });
  });

  describe('withFileMonitoring', () => {
    it('should run task and return modified files', async () => {
      const testFile = path.join(testDir, 'task-file.ts');
      await fs.writeFile(testFile, 'initial');

      const { result, filesModified } = await withFileMonitoring(
        'with-monitoring-task',
        [testFile],
        async () => {
          await fs.writeFile(testFile, 'changed');
          return { success: true, value: 42 };
        },
        { workspace: testDir }
      );

      expect(result).toEqual({ success: true, value: 42 });
      expect(filesModified).toContain(testFile);
    });

    it('should stop monitoring even on error', async () => {
      const testFile = path.join(testDir, 'error-file.ts');

      await expect(
        withFileMonitoring(
          'error-task',
          [testFile],
          async () => {
            throw new Error('Task failed');
          },
          { workspace: testDir }
        )
      ).rejects.toThrow('Task failed');

      // Verify monitoring was stopped (no tracker should remain)
      const modifiedAfter = await stopFileMonitoring('error-task');
      expect(modifiedAfter).toEqual([]);
    });
  });

  describe('executeWithContext', () => {
    it('should get context, run task, and report outcome', async () => {
      const { getSession } = await import('../../orchestrator/unified_init.js');
      const session = vi.mocked(getSession)();
      if (session) vi.mocked(session.recordOutcome).mockClear();

      const result = await executeWithContext(
        { intent: 'Complete task', affectedFiles: [] },
        async (context) => {
          expect(context.formatted).toContain('Librarian Context');
          return { success: true, data: 'completed' };
        },
        { workspace: testDir }
      );

      expect(result).toEqual({ success: true, data: 'completed' });
      expect(session?.recordOutcome).toHaveBeenCalled();
    });

    it('should report failure on task error', async () => {
      const { getSession } = await import('../../orchestrator/unified_init.js');
      const session = vi.mocked(getSession)();
      if (session) vi.mocked(session.recordOutcome).mockClear();

      await expect(
        executeWithContext(
          { intent: 'Failing task' },
          async () => {
            throw new Error('Task explosion');
          },
          { workspace: testDir }
        )
      ).rejects.toThrow('Task explosion');

      expect(session?.recordOutcome).toHaveBeenCalledWith(expect.objectContaining({
        success: false,
        failureReason: 'Task explosion',
      }));
    });
  });

  describe('hook creators', () => {
    it('createPreTaskHook should return working function', async () => {
      const preTask = createPreTaskHook({ workspace: testDir });

      const context = await preTask('Test intent', ['file.ts']);

      expect(context).toBeDefined();
      expect(context.taskId).toBeDefined();
    });

    it('createPostTaskHook should return working function', async () => {
      const { getSession } = await import('../../orchestrator/unified_init.js');
      const session = vi.mocked(getSession)();
      if (session) vi.mocked(session.recordOutcome).mockClear();
      const postTask = createPostTaskHook({ workspace: testDir });

      await postTask('hook-task', { success: true });

      expect(session?.recordOutcome).toHaveBeenCalled();
    });

    it('createAgentHooks should return both hooks', async () => {
      const hooks = createAgentHooks({ workspace: testDir });

      expect(hooks.preTask).toBeInstanceOf(Function);
      expect(hooks.postTask).toBeInstanceOf(Function);

      const context = await hooks.preTask('Hook test');
      expect(context.taskId).toBeDefined();
    });
  });

  describe('isLibrarianAvailable', () => {
    it('should return true when Librarian is ready', async () => {
      const available = await isLibrarianAvailable(testDir);

      expect(available).toBe(true);
    });

    it('should return false when Librarian is not ready', async () => {
      const { hasSession } = await import('../../orchestrator/unified_init.js');
      vi.mocked(hasSession).mockReturnValueOnce(false);

      const available = await isLibrarianAvailable(testDir);

      expect(available).toBe(false);
    });
  });

  describe('detectWorkspace', () => {
    it('should detect workspace from .librarian directory', async () => {
      // Create .librarian directory
      const librarianDir = path.join(testDir, '.librarian');
      await fs.mkdir(librarianDir, { recursive: true });

      // Mock process.cwd to return testDir
      const originalCwd = process.cwd;
      process.cwd = () => testDir;

      try {
        const workspace = await detectWorkspace();
        expect(workspace).toBe(testDir);
      } finally {
        process.cwd = originalCwd;
      }
    });

    it('should return null when no .librarian directory exists', async () => {
      // Create a new empty directory
      const emptyDir = path.join(testDir, 'empty');
      await fs.mkdir(emptyDir, { recursive: true });

      // Mock process.cwd to return the empty directory
      const originalCwd = process.cwd;
      process.cwd = () => emptyDir;

      try {
        const workspace = await detectWorkspace();
        // Should return null since no .librarian exists
        expect(workspace).toBeNull();
      } finally {
        process.cwd = originalCwd;
      }
    });

    it('should use LIBRARIAN_WORKSPACE environment variable', async () => {
      // Create .librarian directory in testDir
      const librarianDir = path.join(testDir, '.librarian');
      await fs.mkdir(librarianDir, { recursive: true });

      // Set environment variable
      const originalEnv = process.env.LIBRARIAN_WORKSPACE;
      process.env.LIBRARIAN_WORKSPACE = testDir;

      try {
        const workspace = await detectWorkspace();
        expect(workspace).toBe(path.resolve(testDir));
      } finally {
        if (originalEnv === undefined) {
          delete process.env.LIBRARIAN_WORKSPACE;
        } else {
          process.env.LIBRARIAN_WORKSPACE = originalEnv;
        }
      }
    });
  });
});
