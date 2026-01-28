/**
 * @fileoverview Tests for SelfImprovementExecutor
 *
 * WU-SELF-301: SelfImprovementExecutor implementation
 *
 * Tests cover:
 * - Successful primitive execution
 * - Successful composition execution
 * - Error handling and retries
 * - Timeout handling
 * - Dry run mode
 * - Event emission
 * - Metrics tracking
 * - Execution context management
 * - Execution history
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  SelfImprovementExecutor,
  createSelfImprovementExecutor,
  type ExecutionContext,
  type ExecutionOptions,
  type ExecutionResult,
  type ExecutorMetrics,
  type ExecutionEntry,
  type ExecutorEvent,
  type ExecutorEventHandler,
} from '../executor.js';
import type { LibrarianStorage } from '../../../storage/types.js';

describe('SelfImprovementExecutor', () => {
  let mockStorage: LibrarianStorage;
  let executor: SelfImprovementExecutor;
  const defaultRootDir = '/test/repo';

  beforeEach(() => {
    mockStorage = {
      isInitialized: vi.fn().mockReturnValue(true),
      initialize: vi.fn().mockResolvedValue(undefined),
      getGraphEdges: vi.fn().mockResolvedValue([]),
      getModules: vi.fn().mockResolvedValue([]),
    } as unknown as LibrarianStorage;

    executor = new SelfImprovementExecutor({
      rootDir: defaultRootDir,
      storage: mockStorage,
      retryDelayMs: 1, // Fast retries for testing
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ============================================================================
  // CONSTRUCTOR AND INITIALIZATION
  // ============================================================================

  describe('constructor and initialization', () => {
    it('creates executor with default options', () => {
      const exec = new SelfImprovementExecutor({
        rootDir: defaultRootDir,
        storage: mockStorage,
      });

      expect(exec).toBeDefined();
      expect(exec.isReady()).toBe(true);
    });

    it('creates executor with custom options', () => {
      const exec = new SelfImprovementExecutor({
        rootDir: defaultRootDir,
        storage: mockStorage,
        options: {
          maxRetries: 5,
          timeoutMs: 60000,
          dryRun: true,
          verbose: true,
        },
      });

      expect(exec).toBeDefined();
      expect(exec.isReady()).toBe(true);
    });

    it('throws error when rootDir is missing', () => {
      expect(() => {
        new SelfImprovementExecutor({
          rootDir: '',
          storage: mockStorage,
        });
      }).toThrow('rootDir is required');
    });

    it('throws error when storage is missing', () => {
      expect(() => {
        new SelfImprovementExecutor({
          rootDir: defaultRootDir,
          storage: undefined as unknown as LibrarianStorage,
        });
      }).toThrow('storage is required');
    });
  });

  // ============================================================================
  // PRIMITIVE EXECUTION - SUCCESS CASES
  // ============================================================================

  describe('executePrimitive - success cases', () => {
    it('executes a registered primitive successfully', async () => {
      const mockPrimitive = vi.fn().mockResolvedValue({ data: 'result' });
      executor.registerPrimitive('test_primitive', mockPrimitive);

      const result = await executor.executePrimitive<{ data: string }>('test_primitive', { input: 'test' });

      expect(result.success).toBe(true);
      expect(result.result).toEqual({ data: 'result' });
      expect(result.error).toBeUndefined();
      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(result.retries).toBe(0);
    });

    it('passes correct input to primitive', async () => {
      const mockPrimitive = vi.fn().mockResolvedValue({ ok: true });
      executor.registerPrimitive('test_primitive', mockPrimitive);

      const input = { foo: 'bar', count: 42 };
      await executor.executePrimitive('test_primitive', input);

      expect(mockPrimitive).toHaveBeenCalledWith(
        expect.objectContaining(input),
        expect.any(Object)
      );
    });

    it('provides execution context to primitive', async () => {
      const mockPrimitive = vi.fn().mockResolvedValue({ ok: true });
      executor.registerPrimitive('test_primitive', mockPrimitive);

      await executor.executePrimitive('test_primitive', {});

      expect(mockPrimitive).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          executionId: expect.any(String),
          startedAt: expect.any(Date),
          rootDir: defaultRootDir,
          options: expect.any(Object),
        })
      );
    });

    it('tracks execution duration accurately', async () => {
      const delay = 50;
      const mockPrimitive = vi.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, delay));
        return { ok: true };
      });
      executor.registerPrimitive('slow_primitive', mockPrimitive);

      const result = await executor.executePrimitive('slow_primitive', {});

      expect(result.duration).toBeGreaterThanOrEqual(delay - 10);
      expect(result.duration).toBeLessThan(delay + 100);
    });
  });

  // ============================================================================
  // COMPOSITION EXECUTION - SUCCESS CASES
  // ============================================================================

  describe('executeComposition - success cases', () => {
    it('executes a registered composition successfully', async () => {
      const mockComposition = vi.fn().mockResolvedValue({ steps: 3, success: true });
      executor.registerComposition('test_composition', mockComposition);

      const result = await executor.executeComposition<{ steps: number; success: boolean }>(
        'test_composition',
        { input: 'test' }
      );

      expect(result.success).toBe(true);
      expect(result.result).toEqual({ steps: 3, success: true });
      expect(result.error).toBeUndefined();
      expect(result.retries).toBe(0);
    });

    it('passes correct input to composition', async () => {
      const mockComposition = vi.fn().mockResolvedValue({ ok: true });
      executor.registerComposition('test_composition', mockComposition);

      const input = { depth: 2, options: ['a', 'b'] };
      await executor.executeComposition('test_composition', input);

      expect(mockComposition).toHaveBeenCalledWith(
        expect.objectContaining(input),
        expect.any(Object)
      );
    });

    it('provides execution context to composition', async () => {
      const mockComposition = vi.fn().mockResolvedValue({ ok: true });
      executor.registerComposition('test_composition', mockComposition);

      await executor.executeComposition('test_composition', {});

      expect(mockComposition).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          executionId: expect.any(String),
          startedAt: expect.any(Date),
          rootDir: defaultRootDir,
        })
      );
    });
  });

  // ============================================================================
  // ERROR HANDLING AND RETRIES
  // ============================================================================

  describe('error handling and retries', () => {
    it('returns error result when primitive throws', async () => {
      const error = new Error('Primitive failed');
      const mockPrimitive = vi.fn().mockRejectedValue(error);
      executor.registerPrimitive('failing_primitive', mockPrimitive);

      const result = await executor.executePrimitive('failing_primitive', {});

      expect(result.success).toBe(false);
      expect(result.result).toBeUndefined();
      expect(result.error).toBeDefined();
      expect(result.error?.message).toBe('Primitive failed');
    });

    it('retries primitive on transient failure', async () => {
      let callCount = 0;
      const mockPrimitive = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount < 3) {
          throw new Error('Transient error');
        }
        return { ok: true };
      });

      const exec = new SelfImprovementExecutor({
        rootDir: defaultRootDir,
        storage: mockStorage,
        options: { maxRetries: 3, timeoutMs: 30000, dryRun: false, verbose: false },
        retryDelayMs: 1, // Fast retries for testing
      });
      exec.registerPrimitive('flaky_primitive', mockPrimitive);

      const result = await exec.executePrimitive('flaky_primitive', {});

      expect(result.success).toBe(true);
      expect(result.retries).toBe(2);
      expect(mockPrimitive).toHaveBeenCalledTimes(3);
    });

    it('fails after max retries exceeded', async () => {
      const mockPrimitive = vi.fn().mockRejectedValue(new Error('Persistent error'));

      const exec = new SelfImprovementExecutor({
        rootDir: defaultRootDir,
        storage: mockStorage,
        options: { maxRetries: 2, timeoutMs: 30000, dryRun: false, verbose: false },
        retryDelayMs: 1, // Fast retries for testing
      });
      exec.registerPrimitive('always_fails', mockPrimitive);

      const result = await exec.executePrimitive('always_fails', {});

      expect(result.success).toBe(false);
      expect(result.retries).toBe(2);
      expect(mockPrimitive).toHaveBeenCalledTimes(3); // Initial + 2 retries
    });

    it('returns error for unregistered primitive', async () => {
      const result = await executor.executePrimitive('nonexistent_primitive', {});

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('not registered');
    });

    it('returns error for unregistered composition', async () => {
      const result = await executor.executeComposition('nonexistent_composition', {});

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('not registered');
    });
  });

  // ============================================================================
  // TIMEOUT HANDLING
  // ============================================================================

  describe('timeout handling', () => {
    it('times out slow primitive execution', async () => {
      const mockPrimitive = vi.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        return { ok: true };
      });

      const exec = new SelfImprovementExecutor({
        rootDir: defaultRootDir,
        storage: mockStorage,
        options: { maxRetries: 0, timeoutMs: 100, dryRun: false, verbose: false },
      });
      exec.registerPrimitive('slow_primitive', mockPrimitive);

      const result = await exec.executePrimitive('slow_primitive', {});

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('timeout');
    }, 10000);

    it('times out slow composition execution', async () => {
      const mockComposition = vi.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        return { ok: true };
      });

      const exec = new SelfImprovementExecutor({
        rootDir: defaultRootDir,
        storage: mockStorage,
        options: { maxRetries: 0, timeoutMs: 100, dryRun: false, verbose: false },
      });
      exec.registerComposition('slow_composition', mockComposition);

      const result = await exec.executeComposition('slow_composition', {});

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('timeout');
    }, 10000);

    it('respects custom timeout per execution', async () => {
      const mockPrimitive = vi.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return { ok: true };
      });

      const exec = new SelfImprovementExecutor({
        rootDir: defaultRootDir,
        storage: mockStorage,
        options: { maxRetries: 0, timeoutMs: 50, dryRun: false, verbose: false },
      });
      exec.registerPrimitive('medium_primitive', mockPrimitive);

      // Should timeout with default (50ms)
      const result1 = await exec.executePrimitive('medium_primitive', {});
      expect(result1.success).toBe(false);

      // Should succeed with extended timeout
      const result2 = await exec.executePrimitive('medium_primitive', {}, { timeoutMs: 500 });
      expect(result2.success).toBe(true);
    }, 10000);
  });

  // ============================================================================
  // DRY RUN MODE
  // ============================================================================

  describe('dry run mode', () => {
    it('does not execute primitive in dry run mode', async () => {
      const mockPrimitive = vi.fn().mockResolvedValue({ ok: true });

      const exec = new SelfImprovementExecutor({
        rootDir: defaultRootDir,
        storage: mockStorage,
        options: { maxRetries: 3, timeoutMs: 30000, dryRun: true, verbose: false },
      });
      exec.registerPrimitive('test_primitive', mockPrimitive);

      const result = await exec.executePrimitive('test_primitive', {});

      expect(result.success).toBe(true);
      expect(result.result).toEqual({ dryRun: true, primitiveName: 'test_primitive' });
      expect(mockPrimitive).not.toHaveBeenCalled();
    });

    it('does not execute composition in dry run mode', async () => {
      const mockComposition = vi.fn().mockResolvedValue({ ok: true });

      const exec = new SelfImprovementExecutor({
        rootDir: defaultRootDir,
        storage: mockStorage,
        options: { maxRetries: 3, timeoutMs: 30000, dryRun: true, verbose: false },
      });
      exec.registerComposition('test_composition', mockComposition);

      const result = await exec.executeComposition('test_composition', {});

      expect(result.success).toBe(true);
      expect(result.result).toEqual({ dryRun: true, compositionName: 'test_composition' });
      expect(mockComposition).not.toHaveBeenCalled();
    });

    it('still validates primitive exists in dry run mode', async () => {
      const exec = new SelfImprovementExecutor({
        rootDir: defaultRootDir,
        storage: mockStorage,
        options: { maxRetries: 3, timeoutMs: 30000, dryRun: true, verbose: false },
      });

      const result = await exec.executePrimitive('nonexistent', {});

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('not registered');
    });
  });

  // ============================================================================
  // EVENT EMISSION
  // ============================================================================

  describe('event emission', () => {
    it('emits execution_started event', async () => {
      const handler = vi.fn();
      executor.on('execution_started', handler);

      const mockPrimitive = vi.fn().mockResolvedValue({ ok: true });
      executor.registerPrimitive('test_primitive', mockPrimitive);

      await executor.executePrimitive('test_primitive', {});

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'execution_started',
          executionId: expect.any(String),
          name: 'test_primitive',
          kind: 'primitive',
        })
      );
    });

    it('emits execution_completed event on success', async () => {
      const handler = vi.fn();
      executor.on('execution_completed', handler);

      const mockPrimitive = vi.fn().mockResolvedValue({ ok: true });
      executor.registerPrimitive('test_primitive', mockPrimitive);

      await executor.executePrimitive('test_primitive', {});

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'execution_completed',
          executionId: expect.any(String),
          name: 'test_primitive',
          success: true,
          duration: expect.any(Number),
        })
      );
    });

    it('emits execution_failed event on error', async () => {
      const handler = vi.fn();
      executor.on('execution_failed', handler);

      const mockPrimitive = vi.fn().mockRejectedValue(new Error('Failed'));
      const exec = new SelfImprovementExecutor({
        rootDir: defaultRootDir,
        storage: mockStorage,
        options: { maxRetries: 0, timeoutMs: 30000, dryRun: false, verbose: false },
      });
      exec.on('execution_failed', handler);
      exec.registerPrimitive('failing_primitive', mockPrimitive);

      await exec.executePrimitive('failing_primitive', {});

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'execution_failed',
          executionId: expect.any(String),
          name: 'failing_primitive',
          error: expect.any(String),
        })
      );
    });

    it('emits execution_retry event on retry', async () => {
      const handler = vi.fn();
      let callCount = 0;
      const mockPrimitive = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount < 2) {
          throw new Error('Transient');
        }
        return { ok: true };
      });

      const exec = new SelfImprovementExecutor({
        rootDir: defaultRootDir,
        storage: mockStorage,
        options: { maxRetries: 3, timeoutMs: 30000, dryRun: false, verbose: false },
        retryDelayMs: 1, // Fast retries for testing
      });
      exec.on('execution_retry', handler);
      exec.registerPrimitive('flaky_primitive', mockPrimitive);

      await exec.executePrimitive('flaky_primitive', {});

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'execution_retry',
          executionId: expect.any(String),
          name: 'flaky_primitive',
          attempt: 2,
          error: expect.any(String),
        })
      );
    });

    it('allows unsubscribing from events', async () => {
      const handler = vi.fn();
      const unsubscribe = executor.on('execution_started', handler);

      const mockPrimitive = vi.fn().mockResolvedValue({ ok: true });
      executor.registerPrimitive('test_primitive', mockPrimitive);

      await executor.executePrimitive('test_primitive', {});
      expect(handler).toHaveBeenCalledTimes(1);

      unsubscribe();

      await executor.executePrimitive('test_primitive', {});
      expect(handler).toHaveBeenCalledTimes(1); // Still 1, not 2
    });

    it('supports wildcard event subscription', async () => {
      const handler = vi.fn();
      executor.on('*', handler);

      const mockPrimitive = vi.fn().mockResolvedValue({ ok: true });
      executor.registerPrimitive('test_primitive', mockPrimitive);

      await executor.executePrimitive('test_primitive', {});

      // Should receive both started and completed events
      expect(handler).toHaveBeenCalledTimes(2);
    });
  });

  // ============================================================================
  // METRICS TRACKING
  // ============================================================================

  describe('metrics tracking', () => {
    it('tracks total execution count', async () => {
      const mockPrimitive = vi.fn().mockResolvedValue({ ok: true });
      executor.registerPrimitive('test_primitive', mockPrimitive);

      await executor.executePrimitive('test_primitive', {});
      await executor.executePrimitive('test_primitive', {});
      await executor.executePrimitive('test_primitive', {});

      const metrics = executor.getMetrics();
      expect(metrics.totalExecutions).toBe(3);
    });

    it('tracks successful execution count', async () => {
      const mockPrimitive = vi.fn().mockResolvedValue({ ok: true });
      executor.registerPrimitive('test_primitive', mockPrimitive);

      await executor.executePrimitive('test_primitive', {});
      await executor.executePrimitive('test_primitive', {});

      const metrics = executor.getMetrics();
      expect(metrics.successfulExecutions).toBe(2);
    });

    it('tracks failed execution count', async () => {
      const mockPrimitive = vi.fn().mockRejectedValue(new Error('Failed'));
      const exec = new SelfImprovementExecutor({
        rootDir: defaultRootDir,
        storage: mockStorage,
        options: { maxRetries: 0, timeoutMs: 30000, dryRun: false, verbose: false },
      });
      exec.registerPrimitive('failing_primitive', mockPrimitive);

      await exec.executePrimitive('failing_primitive', {});
      await exec.executePrimitive('failing_primitive', {});

      const metrics = exec.getMetrics();
      expect(metrics.failedExecutions).toBe(2);
    });

    it('tracks total retry count', async () => {
      let callCount = 0;
      const mockPrimitive = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount < 3) {
          throw new Error('Transient');
        }
        return { ok: true };
      });

      const exec = new SelfImprovementExecutor({
        rootDir: defaultRootDir,
        storage: mockStorage,
        options: { maxRetries: 3, timeoutMs: 30000, dryRun: false, verbose: false },
        retryDelayMs: 1, // Fast retries for testing
      });
      exec.registerPrimitive('flaky_primitive', mockPrimitive);

      await exec.executePrimitive('flaky_primitive', {});

      const metrics = exec.getMetrics();
      expect(metrics.totalRetries).toBe(2);
    });

    it('tracks average execution duration', async () => {
      const mockPrimitive = vi.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return { ok: true };
      });
      executor.registerPrimitive('slow_primitive', mockPrimitive);

      await executor.executePrimitive('slow_primitive', {});
      await executor.executePrimitive('slow_primitive', {});

      const metrics = executor.getMetrics();
      expect(metrics.averageDurationMs).toBeGreaterThanOrEqual(15);
    });

    it('tracks primitive vs composition counts separately', async () => {
      const mockPrimitive = vi.fn().mockResolvedValue({ ok: true });
      const mockComposition = vi.fn().mockResolvedValue({ ok: true });
      executor.registerPrimitive('test_primitive', mockPrimitive);
      executor.registerComposition('test_composition', mockComposition);

      await executor.executePrimitive('test_primitive', {});
      await executor.executeComposition('test_composition', {});
      await executor.executeComposition('test_composition', {});

      const metrics = executor.getMetrics();
      expect(metrics.primitiveExecutions).toBe(1);
      expect(metrics.compositionExecutions).toBe(2);
    });

    it('resets metrics when requested', async () => {
      const mockPrimitive = vi.fn().mockResolvedValue({ ok: true });
      executor.registerPrimitive('test_primitive', mockPrimitive);

      await executor.executePrimitive('test_primitive', {});
      await executor.executePrimitive('test_primitive', {});

      executor.resetMetrics();
      const metrics = executor.getMetrics();

      expect(metrics.totalExecutions).toBe(0);
      expect(metrics.successfulExecutions).toBe(0);
    });
  });

  // ============================================================================
  // EXECUTION HISTORY
  // ============================================================================

  describe('execution history', () => {
    it('records execution entries', async () => {
      const mockPrimitive = vi.fn().mockResolvedValue({ ok: true });
      executor.registerPrimitive('test_primitive', mockPrimitive);

      await executor.executePrimitive('test_primitive', { foo: 'bar' });

      const history = executor.getExecutionHistory();
      expect(history.length).toBe(1);
      expect(history[0]).toMatchObject({
        executionId: expect.any(String),
        name: 'test_primitive',
        kind: 'primitive',
        success: true,
        startedAt: expect.any(Date),
        completedAt: expect.any(Date),
        duration: expect.any(Number),
        retries: 0,
      });
    });

    it('records input and output in history', async () => {
      const mockPrimitive = vi.fn().mockResolvedValue({ result: 'success' });
      executor.registerPrimitive('test_primitive', mockPrimitive);

      await executor.executePrimitive('test_primitive', { input: 'data' });

      const history = executor.getExecutionHistory();
      expect(history[0].input).toEqual({ input: 'data' });
      expect(history[0].output).toEqual({ result: 'success' });
    });

    it('records error in history on failure', async () => {
      const mockPrimitive = vi.fn().mockRejectedValue(new Error('Test error'));
      const exec = new SelfImprovementExecutor({
        rootDir: defaultRootDir,
        storage: mockStorage,
        options: { maxRetries: 0, timeoutMs: 30000, dryRun: false, verbose: false },
      });
      exec.registerPrimitive('failing_primitive', mockPrimitive);

      await exec.executePrimitive('failing_primitive', {});

      const history = exec.getExecutionHistory();
      expect(history[0].success).toBe(false);
      expect(history[0].error).toBe('Test error');
    });

    it('limits history to configured max entries', async () => {
      const mockPrimitive = vi.fn().mockResolvedValue({ ok: true });
      const exec = new SelfImprovementExecutor({
        rootDir: defaultRootDir,
        storage: mockStorage,
        maxHistoryEntries: 5,
      });
      exec.registerPrimitive('test_primitive', mockPrimitive);

      for (let i = 0; i < 10; i++) {
        await exec.executePrimitive('test_primitive', { index: i });
      }

      const history = exec.getExecutionHistory();
      expect(history.length).toBe(5);
      // Should keep the most recent entries
      expect(history[history.length - 1].input).toEqual({ index: 9 });
    });

    it('clears history when requested', async () => {
      const mockPrimitive = vi.fn().mockResolvedValue({ ok: true });
      executor.registerPrimitive('test_primitive', mockPrimitive);

      await executor.executePrimitive('test_primitive', {});
      await executor.executePrimitive('test_primitive', {});

      executor.clearHistory();
      const history = executor.getExecutionHistory();

      expect(history.length).toBe(0);
    });
  });

  // ============================================================================
  // CONTEXT STATE MANAGEMENT
  // ============================================================================

  describe('context state management', () => {
    it('allows setting state in context', async () => {
      let capturedContext: ExecutionContext | undefined;
      const mockPrimitive = vi.fn().mockImplementation(async (_input, ctx) => {
        ctx.state.set('key', 'value');
        capturedContext = ctx;
        return { ok: true };
      });
      executor.registerPrimitive('test_primitive', mockPrimitive);

      await executor.executePrimitive('test_primitive', {});

      expect(capturedContext?.state.get('key')).toBe('value');
    });

    it('provides fresh state for each execution', async () => {
      const stateValues: Array<unknown> = [];
      const mockPrimitive = vi.fn().mockImplementation(async (_input, ctx) => {
        stateValues.push(ctx.state.get('key'));
        ctx.state.set('key', 'set_value');
        return { ok: true };
      });
      executor.registerPrimitive('test_primitive', mockPrimitive);

      await executor.executePrimitive('test_primitive', {});
      await executor.executePrimitive('test_primitive', {});

      // Each execution should start with fresh state
      expect(stateValues).toEqual([undefined, undefined]);
    });

    it('generates unique execution IDs', async () => {
      const executionIds: string[] = [];
      const mockPrimitive = vi.fn().mockImplementation(async (_input, ctx) => {
        executionIds.push(ctx.executionId);
        return { ok: true };
      });
      executor.registerPrimitive('test_primitive', mockPrimitive);

      await executor.executePrimitive('test_primitive', {});
      await executor.executePrimitive('test_primitive', {});
      await executor.executePrimitive('test_primitive', {});

      // All IDs should be unique
      const uniqueIds = new Set(executionIds);
      expect(uniqueIds.size).toBe(3);
    });
  });

  // ============================================================================
  // FACTORY FUNCTION
  // ============================================================================

  describe('createSelfImprovementExecutor', () => {
    it('creates executor with bound default options', () => {
      const exec = createSelfImprovementExecutor({
        rootDir: defaultRootDir,
        storage: mockStorage,
      });

      expect(exec).toBeDefined();
      expect(exec.isReady()).toBe(true);
    });

    it('allows custom options in factory', () => {
      const exec = createSelfImprovementExecutor({
        rootDir: defaultRootDir,
        storage: mockStorage,
        options: {
          maxRetries: 10,
          timeoutMs: 120000,
          dryRun: true,
          verbose: true,
        },
      });

      expect(exec).toBeDefined();
    });
  });

  // ============================================================================
  // INTERFACE TYPE CHECKS
  // ============================================================================

  describe('interface type checks', () => {
    it('has correct ExecutionContext shape', () => {
      const context: ExecutionContext = {
        executionId: 'exec-123',
        startedAt: new Date(),
        rootDir: '/test',
        options: {
          maxRetries: 3,
          timeoutMs: 30000,
          dryRun: false,
          verbose: false,
        },
        state: new Map(),
      };

      expect(context.executionId).toBe('exec-123');
      expect(context.startedAt).toBeInstanceOf(Date);
      expect(context.rootDir).toBe('/test');
      expect(context.options.maxRetries).toBe(3);
      expect(context.state).toBeInstanceOf(Map);
    });

    it('has correct ExecutionOptions shape', () => {
      const options: ExecutionOptions = {
        maxRetries: 5,
        timeoutMs: 60000,
        dryRun: true,
        verbose: true,
      };

      expect(options.maxRetries).toBe(5);
      expect(options.timeoutMs).toBe(60000);
      expect(options.dryRun).toBe(true);
      expect(options.verbose).toBe(true);
    });

    it('has correct ExecutionResult shape', () => {
      const successResult: ExecutionResult<{ data: string }> = {
        success: true,
        result: { data: 'test' },
        duration: 100,
        retries: 0,
      };

      const failureResult: ExecutionResult<unknown> = {
        success: false,
        error: new Error('Failed'),
        duration: 50,
        retries: 2,
      };

      expect(successResult.success).toBe(true);
      expect(successResult.result?.data).toBe('test');
      expect(failureResult.success).toBe(false);
      expect(failureResult.error?.message).toBe('Failed');
    });

    it('has correct ExecutorMetrics shape', () => {
      const metrics: ExecutorMetrics = {
        totalExecutions: 100,
        successfulExecutions: 90,
        failedExecutions: 10,
        totalRetries: 15,
        averageDurationMs: 150,
        primitiveExecutions: 70,
        compositionExecutions: 30,
      };

      expect(metrics.totalExecutions).toBe(100);
      expect(metrics.successfulExecutions + metrics.failedExecutions).toBe(100);
      expect(metrics.primitiveExecutions + metrics.compositionExecutions).toBe(100);
    });

    it('has correct ExecutionEntry shape', () => {
      const entry: ExecutionEntry = {
        executionId: 'exec-456',
        name: 'test_primitive',
        kind: 'primitive',
        success: true,
        startedAt: new Date(),
        completedAt: new Date(),
        duration: 100,
        retries: 0,
        input: { foo: 'bar' },
        output: { result: 'ok' },
      };

      expect(entry.executionId).toBe('exec-456');
      expect(entry.kind).toBe('primitive');
      expect(entry.input).toEqual({ foo: 'bar' });
    });
  });
});
