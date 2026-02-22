/**
 * @fileoverview Tests for Homeostasis Daemon
 *
 * Comprehensive tests for autonomous health maintenance.
 * Note: Timer-dependent tests are skipped to avoid hanging.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  HomeostasisDaemon,
  createHomeostasisDaemon,
  type HealingRecord,
} from '../daemon.js';
import {
  TriggerWiring,
  type TriggeredHealthCheck,
} from '../triggers.js';
import { LibrarianEventBus } from '../../events.js';
import type { LibrarianStorage, StorageStats } from '../../storage/types.js';
import type { GraphEdge, LibrarianEvent } from '../../types.js';
import * as logger from '../../telemetry/logger.js';
import * as seededPackValidation from '../seeded_pack_validation.js';

// ============================================================================
// TEST UTILITIES
// ============================================================================

function createMockStorage(): LibrarianStorage {
  const mockStats: StorageStats = {
    totalFunctions: 100,
    totalModules: 20,
    totalContextPacks: 50,
    totalEmbeddings: 200,
    storageSizeBytes: 1000000,
    lastVacuum: null,
    averageConfidence: 0.7,
    cacheHitRate: 0.8,
  };

  return {
    initialize: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    isInitialized: vi.fn().mockReturnValue(true),
    getStats: vi.fn().mockResolvedValue(mockStats),
    getFunctions: vi.fn().mockResolvedValue([]),
    getModules: vi.fn().mockResolvedValue([]),
    getContextPacks: vi.fn().mockResolvedValue([]),
  } as unknown as LibrarianStorage;
}

function createTestEventBus(): LibrarianEventBus {
  return new LibrarianEventBus();
}

// ============================================================================
// TRIGGER WIRING UNIT TESTS
// ============================================================================

describe('TriggerWiring', () => {
  let eventBus: LibrarianEventBus;
  let wiring: TriggerWiring;
  let triggers: TriggeredHealthCheck[];

  beforeEach(() => {
    eventBus = createTestEventBus();
    triggers = [];
  });

  afterEach(() => {
    if (wiring) {
      wiring.unwire();
    }
  });

  describe('configuration', () => {
    it('accepts custom configuration', () => {
      wiring = new TriggerWiring({
        fileChangeDebounceMs: 1000,
        queryFailureThreshold: 5,
        scheduledIntervalMs: 120000,
        excludePaths: ['custom_exclude'],
      });

      // No assertion needed - just verify it doesn't throw
      expect(wiring).toBeDefined();
    });

    it('uses default configuration when not provided', () => {
      wiring = new TriggerWiring();
      expect(wiring).toBeDefined();
    });
  });

  describe('trigger callback registration', () => {
    it('can register trigger callbacks', () => {
      wiring = new TriggerWiring();
      const unsubscribe = wiring.onTrigger((trigger) => {
        triggers.push(trigger);
      });

      expect(typeof unsubscribe).toBe('function');
    });

    it('can unregister trigger callbacks', () => {
      wiring = new TriggerWiring();
      const unsubscribe = wiring.onTrigger((trigger) => {
        triggers.push(trigger);
      });

      unsubscribe();
      // Callback should be removed - no assertion needed
    });
  });

  describe('wiring and unwiring', () => {
    it('can wire to event bus', () => {
      wiring = new TriggerWiring();
      wiring.wire(eventBus);
      // No assertion needed - just verify it doesn't throw
    });

    it('can unwire from event bus', () => {
      wiring = new TriggerWiring();
      wiring.wire(eventBus);
      wiring.unwire();
      // No assertion needed - just verify it doesn't throw
    });
  });

  describe('query failure accumulation', () => {
    it('accumulates query failures correctly', async () => {
      wiring = new TriggerWiring({ queryFailureThreshold: 3 });
      wiring.onTrigger((trigger) => {
        triggers.push(trigger);
      });
      wiring.wire(eventBus);

      // First two failures - no trigger
      await eventBus.emit({
        type: 'query_error',
        timestamp: new Date(),
        data: { queryId: 'q1', error: 'error1' },
      });
      await eventBus.emit({
        type: 'query_error',
        timestamp: new Date(),
        data: { queryId: 'q2', error: 'error2' },
      });

      expect(triggers).toHaveLength(0);

      // Third failure - trigger
      await eventBus.emit({
        type: 'query_error',
        timestamp: new Date(),
        data: { queryId: 'q3', error: 'error3' },
      });

      expect(triggers).toHaveLength(1);
      expect(triggers[0].source).toBe('query_failure');
      expect(triggers[0].failedQueries).toHaveLength(3);
    });

    it('resets on successful query', async () => {
      wiring = new TriggerWiring({ queryFailureThreshold: 3 });
      wiring.onTrigger((trigger) => {
        triggers.push(trigger);
      });
      wiring.wire(eventBus);

      // Two failures
      await eventBus.emit({
        type: 'query_error',
        timestamp: new Date(),
        data: { queryId: 'q1', error: 'error1' },
      });
      await eventBus.emit({
        type: 'query_error',
        timestamp: new Date(),
        data: { queryId: 'q2', error: 'error2' },
      });

      // Success resets
      await eventBus.emit({
        type: 'query_result',
        timestamp: new Date(),
        data: { queryId: 'q3', packCount: 5, confidence: 0.8, latencyMs: 100 },
      });

      // One more failure - still not enough
      await eventBus.emit({
        type: 'query_error',
        timestamp: new Date(),
        data: { queryId: 'q4', error: 'error4' },
      });

      expect(triggers).toHaveLength(0);
    });
  });

  describe('threshold alert handling', () => {
    it('triggers on threshold_alert event', async () => {
      wiring = new TriggerWiring();
      wiring.onTrigger((trigger) => {
        triggers.push(trigger);
      });
      wiring.wire(eventBus);

      await eventBus.emit({
        type: 'threshold_alert',
        timestamp: new Date(),
        data: { metric: 'fitness', current: 0.2, threshold: 0.5 },
      });

      expect(triggers).toHaveLength(1);
      expect(triggers[0].source).toBe('degradation');
      expect(triggers[0].metric).toBe('fitness');
    });

    it('determines urgency based on severity', async () => {
      wiring = new TriggerWiring();
      wiring.onTrigger((trigger) => {
        triggers.push(trigger);
      });
      wiring.wire(eventBus);

      // Critical (ratio < 0.3)
      await eventBus.emit({
        type: 'threshold_alert',
        timestamp: new Date(),
        data: { metric: 'fitness', current: 0.05, threshold: 0.3 },
      });

      expect(triggers[0].urgency).toBe('critical');
    });
  });

  describe('heal in progress flag', () => {
    it('can be set and used', () => {
      wiring = new TriggerWiring();
      wiring.setHealInProgress(true);
      wiring.setHealInProgress(false);
      // No assertion needed - just verify it doesn't throw
    });
  });
});

// ============================================================================
// HOMEOSTASIS DAEMON UNIT TESTS
// ============================================================================

describe('HomeostasisDaemon', () => {
  let daemon: HomeostasisDaemon;
  let mockStorage: LibrarianStorage;
  let eventBus: LibrarianEventBus;

  beforeEach(() => {
    mockStorage = createMockStorage();
    eventBus = createTestEventBus();
  });

  afterEach(async () => {
    if (daemon) {
      await daemon.stop();
    }
  });

  describe('lifecycle', () => {
    it('starts correctly', async () => {
      daemon = createHomeostasisDaemon({
        storage: mockStorage,
        eventBus,
      });

      expect(daemon.getStatus().running).toBe(false);

      await daemon.start();
      expect(daemon.getStatus().running).toBe(true);
      expect(daemon.getStatus().startedAt).toBeDefined();
    });

    it('stops correctly', async () => {
      daemon = createHomeostasisDaemon({
        storage: mockStorage,
        eventBus,
      });

      await daemon.start();
      await daemon.stop();
      expect(daemon.getStatus().running).toBe(false);
    });

    it('is idempotent for start', async () => {
      daemon = createHomeostasisDaemon({
        storage: mockStorage,
        eventBus,
      });

      await daemon.start();
      await daemon.start(); // Second start should be no-op
      expect(daemon.getStatus().running).toBe(true);
    });

    it('is idempotent for stop', async () => {
      daemon = createHomeostasisDaemon({
        storage: mockStorage,
        eventBus,
      });

      await daemon.stop(); // Stop without starting
      expect(daemon.getStatus().running).toBe(false);
    });
  });

  describe('status tracking', () => {
    it('returns initial status', () => {
      daemon = createHomeostasisDaemon({
        storage: mockStorage,
        eventBus,
      });

      const status = daemon.getStatus();
      expect(status.running).toBe(false);
      expect(status.healingInProgress).toBe(false);
      expect(status.healthChecksTriggered).toBe(0);
      expect(status.healingsCompleted).toBe(0);
    });
  });

  describe('manual trigger', () => {
    it('can manually trigger health check', async () => {
      daemon = createHomeostasisDaemon({
        storage: mockStorage,
        eventBus,
      });

      await daemon.start();

      const record = await daemon.triggerHealthCheck('test');

      expect(record).toBeDefined();
      expect(record?.trigger).toBe('manual');
      expect(record?.startedAt).toBeInstanceOf(Date);
      expect(record?.completedAt).toBeInstanceOf(Date);
    });

    it('records healing in history', async () => {
      daemon = createHomeostasisDaemon({
        storage: mockStorage,
        eventBus,
      });

      await daemon.start();
      await daemon.triggerHealthCheck('test');

      const history = daemon.getHealingHistory();
      expect(history).toHaveLength(1);
    });

    it('increments healing count', async () => {
      daemon = createHomeostasisDaemon({
        storage: mockStorage,
        eventBus,
      });

      await daemon.start();
      await daemon.triggerHealthCheck('test');

      expect(daemon.getStatus().healingsCompleted).toBe(1);
    });

    it('runs seeded-pack validation during health checks', async () => {
      const validatorSpy = vi
        .spyOn(seededPackValidation, 'validateSeededPacks')
        .mockResolvedValue({ checked: 0, invalidated: 0 });

      daemon = createHomeostasisDaemon({
        storage: mockStorage,
        eventBus,
      });

      await daemon.start();
      await daemon.triggerHealthCheck('seeded-pack-validation');

      expect(validatorSpy).toHaveBeenCalledTimes(1);
      expect(validatorSpy).toHaveBeenCalledWith(mockStorage);

      validatorSpy.mockRestore();
    });
  });

  describe('heal in progress guard', () => {
    it('skips health check if healing in progress', async () => {
      daemon = createHomeostasisDaemon({
        storage: mockStorage,
        eventBus,
      });

      await daemon.start();
      daemon.simulateHealInProgress(true);

      const record = await daemon.triggerHealthCheck('test');

      expect(record).toBeNull();
    });
  });

  describe('healing history', () => {
    it('maintains healing history', async () => {
      daemon = createHomeostasisDaemon({
        storage: mockStorage,
        eventBus,
      });

      await daemon.start();
      await daemon.triggerHealthCheck('test1');
      await daemon.triggerHealthCheck('test2');

      const history = daemon.getHealingHistory();
      expect(history).toHaveLength(2);
    });

    it('returns history in reverse order (most recent first)', async () => {
      daemon = createHomeostasisDaemon({
        storage: mockStorage,
        eventBus,
      });

      await daemon.start();
      await daemon.triggerHealthCheck('first');
      // Add small delay to ensure different timestamps
      await new Promise((resolve) => setTimeout(resolve, 5));
      await daemon.triggerHealthCheck('second');

      const history = daemon.getHealingHistory();
      // Most recent first (or equal time, in which case order by insertion is acceptable)
      expect(history[0].completedAt.getTime()).toBeGreaterThanOrEqual(
        history[1].completedAt.getTime()
      );
    });

    it('respects limit parameter', async () => {
      daemon = createHomeostasisDaemon({
        storage: mockStorage,
        eventBus,
      });

      await daemon.start();
      await daemon.triggerHealthCheck('test1');
      await daemon.triggerHealthCheck('test2');
      await daemon.triggerHealthCheck('test3');

      const history = daemon.getHealingHistory(2);
      expect(history).toHaveLength(2);
    });
  });

  describe('callbacks', () => {
    it('calls onRecoveryComplete callback', async () => {
      const completedRecords: HealingRecord[] = [];

      daemon = createHomeostasisDaemon({
        storage: mockStorage,
        eventBus,
        onRecoveryComplete: (record) => {
          completedRecords.push(record);
        },
      });

      await daemon.start();
      await daemon.triggerHealthCheck('test');

      expect(completedRecords).toHaveLength(1);
    });
  });

  describe('fitness computation', () => {
    it('computes fitness values', async () => {
      daemon = createHomeostasisDaemon({
        storage: mockStorage,
        eventBus,
      });

      await daemon.start();
      const record = await daemon.triggerHealthCheck('test');

      expect(record?.fitnessBefore).toBeDefined();
      expect(record?.fitnessAfter).toBeDefined();
      expect(typeof record?.fitnessBefore).toBe('number');
      expect(typeof record?.fitnessAfter).toBe('number');
    });
  });
});

// ============================================================================
// INTEGRATION TESTS (without timer dependencies)
// ============================================================================

describe('Homeostasis Integration', () => {
  it('emits safety_violation on indexing_complete when a monitored invariant is violated', async () => {
    const violatingEdges: GraphEdge[] = [
      {
        fromId: 'src/mcp/server.ts',
        fromType: 'file',
        toId: 'src/storage/sqlite_storage.ts',
        toType: 'file',
        edgeType: 'imports',
        sourceFile: 'src/mcp/server.ts',
        sourceLine: 12,
        confidence: 1,
        computedAt: new Date(),
      },
    ];

    const mockStorage = {
      ...createMockStorage(),
      getGraphEdges: vi.fn().mockResolvedValue(violatingEdges),
    } as LibrarianStorage;
    const eventBus = createTestEventBus();
    const warningSpy = vi.spyOn(logger, 'logWarning').mockImplementation(() => undefined);
    const safetyEvents: LibrarianEvent[] = [];

    eventBus.on('safety_violation', (event) => {
      safetyEvents.push(event);
    });

    const daemon = createHomeostasisDaemon({
      storage: mockStorage,
      eventBus,
    });

    await daemon.start();
    await eventBus.emit({
      type: 'indexing_complete',
      timestamp: new Date(),
      data: {
        taskId: 'index_1',
        filesProcessed: 10,
        functionsIndexed: 100,
        durationMs: 1500,
      },
    });
    await new Promise((resolve) => setImmediate(resolve));

    expect(safetyEvents).toHaveLength(1);
    expect(safetyEvents[0].data).toMatchObject({
      violatedProperty: 'G(no_direct_mcp_to_storage_imports)',
      severity: 'block',
      evidence: expect.objectContaining({
        sourceFile: 'src/mcp/server.ts',
        importPath: 'src/storage/sqlite_storage.ts',
      }),
    });
    expect(warningSpy).toHaveBeenCalledWith(
      '[homeostasis] safety_violation event received',
      expect.objectContaining({
        violatedProperty: 'G(no_direct_mcp_to_storage_imports)',
        severity: 'block',
      })
    );

    await daemon.stop();
    warningSpy.mockRestore();
  });

  it('does not emit safety_violation when monitored invariants hold', async () => {
    const cleanEdges: GraphEdge[] = [
      {
        fromId: 'src/mcp/server.ts',
        fromType: 'file',
        toId: 'src/api/index.ts',
        toType: 'file',
        edgeType: 'imports',
        sourceFile: 'src/mcp/server.ts',
        sourceLine: 20,
        confidence: 1,
        computedAt: new Date(),
      },
    ];

    const mockStorage = {
      ...createMockStorage(),
      getGraphEdges: vi.fn().mockResolvedValue(cleanEdges),
    } as LibrarianStorage;
    const eventBus = createTestEventBus();
    const safetyEvents: LibrarianEvent[] = [];

    eventBus.on('safety_violation', (event) => {
      safetyEvents.push(event);
    });

    const daemon = createHomeostasisDaemon({
      storage: mockStorage,
      eventBus,
    });

    await daemon.start();
    await eventBus.emit({
      type: 'indexing_complete',
      timestamp: new Date(),
      data: {
        taskId: 'index_2',
        filesProcessed: 10,
        functionsIndexed: 100,
        durationMs: 1500,
      },
    });
    await new Promise((resolve) => setImmediate(resolve));

    expect(safetyEvents).toHaveLength(0);

    await daemon.stop();
  });

  it('responds to threshold_alert events', async () => {
    const mockStorage = createMockStorage();
    const eventBus = createTestEventBus();
    const triggers: TriggeredHealthCheck[] = [];

    const daemon = createHomeostasisDaemon({
      storage: mockStorage,
      eventBus,
      onHealthCheckTriggered: (trigger) => {
        triggers.push(trigger);
      },
    });

    await daemon.start();

    // Emit threshold alert
    await eventBus.emit({
      type: 'threshold_alert',
      timestamp: new Date(),
      data: { metric: 'fitness', current: 0.2, threshold: 0.5 },
    });

    // Allow event processing
    await new Promise((resolve) => setImmediate(resolve));

    expect(triggers).toHaveLength(1);
    expect(triggers[0].source).toBe('degradation');

    await daemon.stop();
  });

  it('responds to query failures', async () => {
    const mockStorage = createMockStorage();
    const eventBus = createTestEventBus();
    const triggers: TriggeredHealthCheck[] = [];

    const daemon = createHomeostasisDaemon({
      storage: mockStorage,
      eventBus,
      triggerConfig: { queryFailureThreshold: 2 },
      onHealthCheckTriggered: (trigger) => {
        triggers.push(trigger);
      },
    });

    await daemon.start();

    // Emit 2 query failures
    await eventBus.emit({
      type: 'query_error',
      timestamp: new Date(),
      data: { queryId: 'q1', error: 'error1' },
    });
    await eventBus.emit({
      type: 'query_error',
      timestamp: new Date(),
      data: { queryId: 'q2', error: 'error2' },
    });

    // Allow event processing
    await new Promise((resolve) => setImmediate(resolve));

    expect(triggers).toHaveLength(1);
    expect(triggers[0].source).toBe('query_failure');

    await daemon.stop();
  });
});
