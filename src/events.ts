import { logError } from './telemetry/logger.js';
import { getErrorMessage } from './utils/errors.js';
import type { LiBrainianEvent, LiBrainianEventType } from './types.js';
import type { IndexChangeEventType } from './storage/types.js';

export type LiBrainianEventHandler = (event: LiBrainianEvent) => void | Promise<void>;
export type { LiBrainianEvent, LiBrainianEventType };

export class LiBrainianEventBus {
  private handlers = new Map<LiBrainianEventType | '*', Set<LiBrainianEventHandler>>();

  on(eventType: LiBrainianEventType | '*', handler: LiBrainianEventHandler): () => void {
    if (!this.handlers.has(eventType)) this.handlers.set(eventType, new Set());
    this.handlers.get(eventType)!.add(handler);
    return () => {
      this.handlers.get(eventType)?.delete(handler);
    };
  }

  once(eventType: LiBrainianEventType | '*', handler: LiBrainianEventHandler): () => void {
    const wrappedHandler: LiBrainianEventHandler = async (event) => {
      this.handlers.get(eventType)?.delete(wrappedHandler);
      await handler(event);
    };
    return this.on(eventType, wrappedHandler);
  }

  async emit(event: LiBrainianEvent): Promise<void> {
    const specificHandlers = this.handlers.get(event.type);
    if (specificHandlers) {
      for (const handler of specificHandlers) {
        try {
          await handler(event);
        } catch (error: unknown) {
          logError(`LiBrainian event handler error for ${event.type}`, {
            error: getErrorMessage(error),
          });
        }
      }
    }
    const wildcardHandlers = this.handlers.get('*');
    if (wildcardHandlers) {
      for (const handler of wildcardHandlers) {
        try {
          await handler(event);
        } catch (error: unknown) {
          logError('LiBrainian wildcard event handler error', {
            error: getErrorMessage(error),
          });
        }
      }
    }
  }

  off(eventType: LiBrainianEventType | '*'): void { this.handlers.delete(eventType); }
  clear(): void { this.handlers.clear(); }
}

export const globalEventBus = new LiBrainianEventBus();

export function createBootstrapStartedEvent(workspace: string): LiBrainianEvent {
  return { type: 'bootstrap_started', timestamp: new Date(), data: { workspace } };
}

export function createBootstrapPhaseCompleteEvent(workspace: string, phase: string, durationMs: number, itemsProcessed: number): LiBrainianEvent {
  return { type: 'bootstrap_phase_complete', timestamp: new Date(), data: { workspace, phase, durationMs, itemsProcessed } };
}

export function createBootstrapCompleteEvent(workspace: string, success: boolean, durationMs: number, error?: string): LiBrainianEvent {
  return { type: 'bootstrap_complete', timestamp: new Date(), data: { workspace, success, durationMs, error } };
}

export function createIndexingStartedEvent(taskId: string, type: string, fileCount: number): LiBrainianEvent {
  return { type: 'indexing_started', timestamp: new Date(), data: { taskId, type, fileCount } };
}

export function createIndexingCompleteEvent(taskId: string, filesProcessed: number, functionsIndexed: number, durationMs: number): LiBrainianEvent {
  return { type: 'indexing_complete', timestamp: new Date(), data: { taskId, filesProcessed, functionsIndexed, durationMs } };
}

export function createIngestionStartedEvent(workspace: string): LiBrainianEvent {
  return { type: 'ingestion_started', timestamp: new Date(), data: { workspace } };
}

export function createIngestionSourceCompletedEvent(
  workspace: string,
  sourceType: string,
  itemCount: number,
  errorCount: number
): LiBrainianEvent {
  return {
    type: 'ingestion_source_completed',
    timestamp: new Date(),
    data: { workspace, sourceType, itemCount, errorCount },
  };
}

export function createIngestionCompletedEvent(
  workspace: string,
  itemsProcessed: number,
  errorCount: number
): LiBrainianEvent {
  return { type: 'ingestion_completed', timestamp: new Date(), data: { workspace, itemsProcessed, errorCount } };
}

export function createTaskReceivedEvent(taskId: string, intent: string, scope?: string[]): LiBrainianEvent {
  return { type: 'task_received', timestamp: new Date(), data: { taskId, intent, scope: scope ?? [] } };
}

export function createTaskCompletedEvent(taskId: string, success: boolean, packsUsed?: string[], reason?: string, intent?: string): LiBrainianEvent {
  return { type: 'task_completed', timestamp: new Date(), data: { taskId, success, packsUsed: packsUsed ?? [], reason, intent } };
}

export function createTaskFailedEvent(taskId: string, packsUsed?: string[], reason?: string, intent?: string): LiBrainianEvent {
  return { type: 'task_failed', timestamp: new Date(), data: { taskId, success: false, packsUsed: packsUsed ?? [], reason, intent } };
}

export function createFileModifiedEvent(filePath: string, reason?: string): LiBrainianEvent {
  return { type: 'file_modified', timestamp: new Date(), data: { filePath, reason } };
}

export function createFileCreatedEvent(filePath: string): LiBrainianEvent {
  return { type: 'file_created', timestamp: new Date(), data: { filePath } };
}

export function createFileDeletedEvent(filePath: string): LiBrainianEvent {
  return { type: 'file_deleted', timestamp: new Date(), data: { filePath } };
}

export function createLanguageOnboardingEvent(
  filePath: string,
  extension: string,
  parser: string,
  reason?: string
): LiBrainianEvent {
  return {
    type: 'language_onboarding',
    timestamp: new Date(),
    data: { filePath, extension, parser, reason },
  };
}

export function createEntityCreatedEvent(entityType: string, entityId: string, filePath?: string): LiBrainianEvent {
  return { type: 'entity_created', timestamp: new Date(), data: { entityType, entityId, filePath } };
}

export function createEntityUpdatedEvent(entityType: string, entityId: string, filePath?: string): LiBrainianEvent {
  return { type: 'entity_updated', timestamp: new Date(), data: { entityType, entityId, filePath } };
}

export function createEntityDeletedEvent(entityType: string, entityId: string, filePath?: string): LiBrainianEvent {
  return { type: 'entity_deleted', timestamp: new Date(), data: { entityType, entityId, filePath } };
}

export function createQueryReceivedEvent(queryId: string, intent: string, depth: string, sessionId?: string): LiBrainianEvent {
  return { type: 'query_received', timestamp: new Date(), data: { queryId, intent, depth }, sessionId };
}

export function createQueryStartedEvent(queryId: string, intent: string, depth: string, sessionId?: string): LiBrainianEvent {
  return createQueryReceivedEvent(queryId, intent, depth, sessionId);
}

export function createQueryCompleteEvent(queryId: string, packCount: number, cacheHit: boolean, latencyMs: number, sessionId?: string): LiBrainianEvent {
  return { type: 'query_complete', timestamp: new Date(), data: { queryId, packCount, cacheHit, latencyMs }, sessionId };
}

export function createContextPackInvalidatedEvent(packId: string, reason?: string): LiBrainianEvent {
  return { type: 'context_pack_invalidated', timestamp: new Date(), data: { packId, reason } };
}

export function createContextPacksInvalidatedEvent(triggerPath: string, count: number): LiBrainianEvent {
  return { type: 'context_packs_invalidated', timestamp: new Date(), data: { triggerPath, count } };
}

export function createUpgradeStartedEvent(fromVersion: string, toVersion: string, upgradeType: string): LiBrainianEvent {
  return { type: 'upgrade_started', timestamp: new Date(), data: { fromVersion, toVersion, upgradeType } };
}

export function createUpgradeCompleteEvent(fromVersion: string, toVersion: string, success: boolean, error?: string): LiBrainianEvent {
  return { type: 'upgrade_complete', timestamp: new Date(), data: { fromVersion, toVersion, success, error } };
}

export function createConfidenceUpdatedEvent(entityId: string, entityType: string, confidence: number, delta: number): LiBrainianEvent {
  return { type: 'confidence_updated', timestamp: new Date(), data: { entityId, entityType, confidence, delta } };
}

export function createThresholdAlertEvent(alert: { kind: string; message: string; severity: string }): LiBrainianEvent {
  return { type: 'threshold_alert', timestamp: new Date(), data: alert };
}

export function createContextPackInvalidationEvent(packId: string, outcome: 'success' | 'failure'): LiBrainianEvent {
  return { type: 'context_pack_invalidated', timestamp: new Date(), data: { packId, outcome } };
}

// ============================================================================
// NEW EVENT FACTORY FUNCTIONS
// ============================================================================

export function createBootstrapErrorEvent(workspace: string, error: string, phase?: string): LiBrainianEvent {
  return { type: 'bootstrap_error', timestamp: new Date(), data: { workspace, error, phase } };
}

export function createQueryStartEvent(queryId: string, intent: string, depth: string, sessionId?: string): LiBrainianEvent {
  return { type: 'query_start', timestamp: new Date(), data: { queryId, intent, depth }, sessionId };
}

export function createQueryResultEvent(queryId: string, packCount: number, confidence: number, latencyMs: number, sessionId?: string): LiBrainianEvent {
  return { type: 'query_result', timestamp: new Date(), data: { queryId, packCount, confidence, latencyMs }, sessionId };
}

export function createQueryErrorEvent(queryId: string, error: string, sessionId?: string): LiBrainianEvent {
  return { type: 'query_error', timestamp: new Date(), data: { queryId, error }, sessionId };
}

export function createIndexFileEvent(filePath: string, functionsFound: number, durationMs: number): LiBrainianEvent {
  return { type: 'index_file', timestamp: new Date(), data: { filePath, functionsFound, durationMs } };
}

export function createIndexFunctionEvent(functionId: string, functionName: string, filePath: string): LiBrainianEvent {
  return { type: 'index_function', timestamp: new Date(), data: { functionId, functionName, filePath } };
}

export function createIndexCompleteEvent(filesProcessed: number, functionsIndexed: number, durationMs: number): LiBrainianEvent {
  return { type: 'index_complete', timestamp: new Date(), data: { filesProcessed, functionsIndexed, durationMs } };
}

export function createIndexChangeEvent(
  changeType: IndexChangeEventType,
  path: string,
  version: number,
  timestamp?: string
): LiBrainianEvent {
  const eventTimestamp = timestamp ? new Date(timestamp) : new Date();
  return {
    type: 'index_change',
    timestamp: eventTimestamp,
    data: {
      changeType,
      path,
      version,
      timestamp: eventTimestamp.toISOString(),
    },
  };
}

export function createUnderstandingGenerationStartedEvent(totalEntities: number): LiBrainianEvent {
  return { type: 'understanding_generation_started', timestamp: new Date(), data: { totalEntities } };
}

export function createUnderstandingGeneratedEvent(
  entityId: string,
  entityType: string,
  filePath: string,
  confidence: number,
  partial: boolean
): LiBrainianEvent {
  return {
    type: 'understanding_generated',
    timestamp: new Date(),
    data: { entityId, entityType, filePath, confidence, partial },
  };
}

export function createUnderstandingGenerationCompleteEvent(
  successCount: number,
  failureCount: number,
  partialCount: number,
  durationMs: number
): LiBrainianEvent {
  return {
    type: 'understanding_generation_complete',
    timestamp: new Date(),
    data: { successCount, failureCount, partialCount, durationMs },
  };
}

export function createUnderstandingInvalidatedEvent(
  entityId: string,
  entityType: string,
  reason?: string
): LiBrainianEvent {
  return { type: 'understanding_invalidated', timestamp: new Date(), data: { entityId, entityType, reason } };
}

export function createFeedbackReceivedEvent(
  taskId: string,
  success: boolean,
  packsUsed?: string[],
  reason?: string
): LiBrainianEvent {
  return { type: 'feedback_received', timestamp: new Date(), data: { taskId, success, packsUsed: packsUsed ?? [], reason } };
}

export function createEngineRelevanceEvent(intent: string, packCount: number, confidence: number): LiBrainianEvent {
  return { type: 'engine_relevance', timestamp: new Date(), data: { intent, packCount, confidence } };
}

export function createEngineConstraintEvent(file: string, violations: number, warnings: number, blocking: boolean): LiBrainianEvent {
  return { type: 'engine_constraint', timestamp: new Date(), data: { file, violations, warnings, blocking } };
}

export function createEngineConfidenceEvent(entityId: string, entityType: string, confidence: number, delta: number): LiBrainianEvent {
  return { type: 'engine_confidence', timestamp: new Date(), data: { entityId, entityType, confidence, delta } };
}

export function createIntegrationContextEvent(taskId: string, workspace: string, intent: string, packCount: number): LiBrainianEvent {
  return { type: 'integration_context', timestamp: new Date(), data: { taskId, workspace, intent, packCount } };
}

export function createIntegrationOutcomeEvent(taskId: string, success: boolean, filesModified?: string[], reason?: string): LiBrainianEvent {
  return { type: 'integration_outcome', timestamp: new Date(), data: { taskId, success, filesModified: filesModified ?? [], reason } };
}

// ============================================================================
// EVENT SUBSCRIPTION HELPERS
// ============================================================================

/**
 * Subscribe to a specific event type or all events ('*').
 * Returns an unsubscribe function.
 */
export function onLiBrainianEvent(type: LiBrainianEventType | '*', handler: LiBrainianEventHandler): () => void {
  return globalEventBus.on(type, handler);
}

/**
 * Subscribe to a specific event type or all events ('*') for a single occurrence.
 * The handler will be automatically removed after it fires once.
 */
export function onceLiBrainianEvent(type: LiBrainianEventType | '*', handler: LiBrainianEventHandler): void {
  globalEventBus.once(type, handler);
}
