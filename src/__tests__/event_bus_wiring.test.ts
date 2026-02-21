/**
 * @fileoverview Tests for verifying LiBrainianEventBus wiring across the system.
 *
 * This test file verifies that events are properly emitted from all key operations:
 * - Bootstrap operations (start, phase, complete, error)
 * - Query operations (start, result, error)
 * - Index operations (file, function, complete)
 * - Engine operations (relevance, constraint, confidence)
 * - Integration operations (context, outcome)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  globalEventBus,
  onLiBrainianEvent,
  onceLiBrainianEvent,
  createBootstrapStartedEvent,
  createBootstrapPhaseCompleteEvent,
  createBootstrapCompleteEvent,
  createBootstrapErrorEvent,
  createQueryStartEvent,
  createQueryResultEvent,
  createQueryErrorEvent,
  createIndexFileEvent,
  createIndexFunctionEvent,
  createIndexCompleteEvent,
  createEntityCreatedEvent,
  createEntityUpdatedEvent,
  createEntityDeletedEvent,
  createUnderstandingInvalidatedEvent,
  createEngineRelevanceEvent,
  createEngineConstraintEvent,
  createEngineConfidenceEvent,
  createIntegrationContextEvent,
  createIntegrationOutcomeEvent,
  type LiBrainianEvent,
} from '../events.js';

describe('LiBrainianEventBus Wiring', () => {
  // Collect events for verification
  const collectedEvents: LiBrainianEvent[] = [];
  let unsubscribe: (() => void) | null = null;

  beforeEach(() => {
    collectedEvents.length = 0;
    // Subscribe to all events for testing
    unsubscribe = onLiBrainianEvent('*', (event) => {
      collectedEvents.push(event);
    });
  });

  afterEach(() => {
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
  });

  describe('onLiBrainianEvent subscription', () => {
    it('should subscribe to all events with wildcard', async () => {
      const event = createBootstrapStartedEvent('/test/workspace');
      await globalEventBus.emit(event);

      expect(collectedEvents).toHaveLength(1);
      expect(collectedEvents[0].type).toBe('bootstrap_started');
    });

    it('should return an unsubscribe function', async () => {
      const specificEvents: LiBrainianEvent[] = [];
      const unsub = onLiBrainianEvent('query_start', (event) => {
        specificEvents.push(event);
      });

      await globalEventBus.emit(createQueryStartEvent('q1', 'test intent', 'L1'));
      expect(specificEvents).toHaveLength(1);

      unsub();

      await globalEventBus.emit(createQueryStartEvent('q2', 'test intent', 'L1'));
      expect(specificEvents).toHaveLength(1); // Should not have received second event
    });
  });

  describe('onceLiBrainianEvent subscription', () => {
    it('should only fire once', async () => {
      const onceEvents: LiBrainianEvent[] = [];
      onceLiBrainianEvent('index_complete', (event) => {
        onceEvents.push(event);
      });

      await globalEventBus.emit(createIndexCompleteEvent(10, 50, 1000));
      await globalEventBus.emit(createIndexCompleteEvent(20, 100, 2000));

      expect(onceEvents).toHaveLength(1);
      expect((onceEvents[0].data as { filesProcessed: number }).filesProcessed).toBe(10);
    });
  });

  describe('Bootstrap events', () => {
    it('should emit bootstrap:start event', async () => {
      const event = createBootstrapStartedEvent('/workspace');
      await globalEventBus.emit(event);

      const emitted = collectedEvents.find((e) => e.type === 'bootstrap_started');
      expect(emitted).toBeDefined();
      expect((emitted?.data as { workspace: string }).workspace).toBe('/workspace');
    });

    it('should emit bootstrap:phase event', async () => {
      const event = createBootstrapPhaseCompleteEvent('/workspace', 'structural_scan', 5000, 100);
      await globalEventBus.emit(event);

      const emitted = collectedEvents.find((e) => e.type === 'bootstrap_phase_complete');
      expect(emitted).toBeDefined();
      expect((emitted?.data as { phase: string }).phase).toBe('structural_scan');
    });

    it('should emit bootstrap:complete event', async () => {
      const event = createBootstrapCompleteEvent('/workspace', true, 10000);
      await globalEventBus.emit(event);

      const emitted = collectedEvents.find((e) => e.type === 'bootstrap_complete');
      expect(emitted).toBeDefined();
      expect((emitted?.data as { success: boolean }).success).toBe(true);
    });

    it('should emit bootstrap:error event', async () => {
      const event = createBootstrapErrorEvent('/workspace', 'Connection failed', 'semantic_indexing');
      await globalEventBus.emit(event);

      const emitted = collectedEvents.find((e) => e.type === 'bootstrap_error');
      expect(emitted).toBeDefined();
      expect((emitted?.data as { error: string }).error).toBe('Connection failed');
      expect((emitted?.data as { phase?: string }).phase).toBe('semantic_indexing');
    });
  });

  describe('Query events', () => {
    it('should emit query:start event', async () => {
      const event = createQueryStartEvent('q-123', 'find authentication logic', 'L1');
      await globalEventBus.emit(event);

      const emitted = collectedEvents.find((e) => e.type === 'query_start');
      expect(emitted).toBeDefined();
      expect((emitted?.data as { queryId: string }).queryId).toBe('q-123');
      expect((emitted?.data as { intent: string }).intent).toBe('find authentication logic');
    });

    it('should emit query:result event', async () => {
      const event = createQueryResultEvent('q-123', 5, 0.85, 150);
      await globalEventBus.emit(event);

      const emitted = collectedEvents.find((e) => e.type === 'query_result');
      expect(emitted).toBeDefined();
      expect((emitted?.data as { packCount: number }).packCount).toBe(5);
      expect((emitted?.data as { confidence: number }).confidence).toBe(0.85);
    });

    it('should emit query:error event', async () => {
      const event = createQueryErrorEvent('q-123', 'Timeout exceeded');
      await globalEventBus.emit(event);

      const emitted = collectedEvents.find((e) => e.type === 'query_error');
      expect(emitted).toBeDefined();
      expect((emitted?.data as { error: string }).error).toBe('Timeout exceeded');
    });
  });

  describe('Index events', () => {
    it('should emit index:file event', async () => {
      const event = createIndexFileEvent('/src/auth/login.ts', 8, 250);
      await globalEventBus.emit(event);

      const emitted = collectedEvents.find((e) => e.type === 'index_file');
      expect(emitted).toBeDefined();
      expect((emitted?.data as { filePath: string }).filePath).toBe('/src/auth/login.ts');
      expect((emitted?.data as { functionsFound: number }).functionsFound).toBe(8);
    });

    it('should emit index:function event', async () => {
      const event = createIndexFunctionEvent('fn-123', 'authenticateUser', '/src/auth/login.ts');
      await globalEventBus.emit(event);

      const emitted = collectedEvents.find((e) => e.type === 'index_function');
      expect(emitted).toBeDefined();
      expect((emitted?.data as { functionName: string }).functionName).toBe('authenticateUser');
    });

    it('should emit index:complete event', async () => {
      const event = createIndexCompleteEvent(100, 500, 30000);
      await globalEventBus.emit(event);

      const emitted = collectedEvents.find((e) => e.type === 'index_complete');
      expect(emitted).toBeDefined();
      expect((emitted?.data as { filesProcessed: number }).filesProcessed).toBe(100);
      expect((emitted?.data as { functionsIndexed: number }).functionsIndexed).toBe(500);
    });
  });

  describe('Entity events', () => {
    it('should emit entity:created event', async () => {
      const event = createEntityCreatedEvent('file', 'file-123', '/src/auth/login.ts');
      await globalEventBus.emit(event);

      const emitted = collectedEvents.find((e) => e.type === 'entity_created');
      expect(emitted).toBeDefined();
      expect((emitted?.data as { entityType: string }).entityType).toBe('file');
    });

    it('should emit entity:updated event', async () => {
      const event = createEntityUpdatedEvent('module', 'mod-123', '/src/core/module.ts');
      await globalEventBus.emit(event);

      const emitted = collectedEvents.find((e) => e.type === 'entity_updated');
      expect(emitted).toBeDefined();
      expect((emitted?.data as { entityId: string }).entityId).toBe('mod-123');
    });

    it('should emit entity:deleted event', async () => {
      const event = createEntityDeletedEvent('function', 'fn-123', '/src/utils/helpers.ts');
      await globalEventBus.emit(event);

      const emitted = collectedEvents.find((e) => e.type === 'entity_deleted');
      expect(emitted).toBeDefined();
      expect((emitted?.data as { entityType: string }).entityType).toBe('function');
    });

    it('should emit understanding:invalidated event', async () => {
      const event = createUnderstandingInvalidatedEvent('uk-123', 'function', 'file_removed');
      await globalEventBus.emit(event);

      const emitted = collectedEvents.find((e) => e.type === 'understanding_invalidated');
      expect(emitted).toBeDefined();
      expect((emitted?.data as { reason: string }).reason).toBe('file_removed');
    });
  });

  describe('Engine events', () => {
    it('should emit engine:relevance event', async () => {
      const event = createEngineRelevanceEvent('find database queries', 12, 0.78);
      await globalEventBus.emit(event);

      const emitted = collectedEvents.find((e) => e.type === 'engine_relevance');
      expect(emitted).toBeDefined();
      expect((emitted?.data as { intent: string }).intent).toBe('find database queries');
      expect((emitted?.data as { packCount: number }).packCount).toBe(12);
    });

    it('should emit engine:constraint event', async () => {
      const event = createEngineConstraintEvent('/src/utils.ts', 2, 3, true);
      await globalEventBus.emit(event);

      const emitted = collectedEvents.find((e) => e.type === 'engine_constraint');
      expect(emitted).toBeDefined();
      expect((emitted?.data as { violations: number }).violations).toBe(2);
      expect((emitted?.data as { blocking: boolean }).blocking).toBe(true);
    });

    it('should emit engine:confidence event', async () => {
      const event = createEngineConfidenceEvent('fn-123', 'function', 0.75, 0.1);
      await globalEventBus.emit(event);

      const emitted = collectedEvents.find((e) => e.type === 'engine_confidence');
      expect(emitted).toBeDefined();
      expect((emitted?.data as { entityId: string }).entityId).toBe('fn-123');
      expect((emitted?.data as { confidence: number }).confidence).toBe(0.75);
    });
  });

  describe('Integration events', () => {
    it('should emit integration:context event', async () => {
      const event = createIntegrationContextEvent('task-123', '/workspace', 'implement login', 5);
      await globalEventBus.emit(event);

      const emitted = collectedEvents.find((e) => e.type === 'integration_context');
      expect(emitted).toBeDefined();
      expect((emitted?.data as { taskId: string }).taskId).toBe('task-123');
      expect((emitted?.data as { packCount: number }).packCount).toBe(5);
    });

    it('should emit integration:outcome event', async () => {
      const event = createIntegrationOutcomeEvent('task-123', true, ['/src/auth.ts'], 'completed successfully');
      await globalEventBus.emit(event);

      const emitted = collectedEvents.find((e) => e.type === 'integration_outcome');
      expect(emitted).toBeDefined();
      expect((emitted?.data as { success: boolean }).success).toBe(true);
      expect((emitted?.data as { filesModified: string[] }).filesModified).toContain('/src/auth.ts');
    });
  });

  describe('Event timestamps', () => {
    it('should include timestamp on all events', async () => {
      const before = new Date();
      await globalEventBus.emit(createBootstrapStartedEvent('/workspace'));
      const after = new Date();

      expect(collectedEvents).toHaveLength(1);
      const event = collectedEvents[0];
      expect(event.timestamp).toBeInstanceOf(Date);
      expect(event.timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(event.timestamp.getTime()).toBeLessThanOrEqual(after.getTime());
    });
  });
});
