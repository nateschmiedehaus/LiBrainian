/**
 * @fileoverview Bridge between LiBrainian events and the tracing system
 *
 * This module automatically creates trace spans from librainian events,
 * providing unified debugging without modifying existing code paths.
 */

import type { LiBrainianEvent, LiBrainianEventHandler } from '../events.js';
import { globalEventBus } from '../events.js';
import { globalTracer, type LiBrainianTracer } from './tracer.js';

// ============================================================================
// TYPES
// ============================================================================

export interface TracingBridgeOptions {
  tracer?: LiBrainianTracer;
  enabled?: boolean;
}

// ============================================================================
// EVENT TO SPAN MAPPING
// ============================================================================

// Track active spans by operation ID
const activeSpans = new Map<string, string>();

/**
 * Handle librainian events and create corresponding trace spans.
 */
const bridgeHandler: LiBrainianEventHandler = (event: LiBrainianEvent): void => {
  const tracer = globalTracer;
  if (!tracer.isEnabled()) return;

  switch (event.type) {
    // Query events
    case 'query_received': {
      const data = event.data as { queryId?: string; intent?: string; depth?: string };
      if (data.queryId) {
        const spanId = tracer.startSpan('queryLiBrainian', {
          attributes: {
            queryId: data.queryId,
            intent: data.intent,
            depth: data.depth,
          },
        });
        activeSpans.set(`query:${data.queryId}`, spanId);
      }
      break;
    }

    case 'query_complete': {
      const data = event.data as { queryId?: string; packCount?: number; cacheHit?: boolean; latencyMs?: number };
      if (data.queryId) {
        const spanId = activeSpans.get(`query:${data.queryId}`);
        if (spanId) {
          tracer.setAttributes(spanId, {
            packCount: data.packCount,
            cacheHit: data.cacheHit,
            latencyMs: data.latencyMs,
            status: 'ok',
          });
          tracer.endSpan(spanId);
          activeSpans.delete(`query:${data.queryId}`);
        }
      }
      break;
    }

    // Bootstrap events
    case 'bootstrap_started': {
      const data = event.data as { workspace?: string };
      const spanId = tracer.startSpan('bootstrapProject', {
        attributes: { workspace: data.workspace },
      });
      if (data.workspace) {
        activeSpans.set(`bootstrap:${data.workspace}`, spanId);
      }
      break;
    }

    case 'bootstrap_phase_complete': {
      const data = event.data as { workspace?: string; phase?: string; durationMs?: number; itemsProcessed?: number };
      if (data.workspace) {
        const parentSpanId = activeSpans.get(`bootstrap:${data.workspace}`);
        if (parentSpanId) {
          tracer.addEvent(parentSpanId, `phase_complete:${data.phase}`, {
            durationMs: data.durationMs,
            itemsProcessed: data.itemsProcessed,
          });
        }
      }
      break;
    }

    case 'bootstrap_complete': {
      const data = event.data as { workspace?: string; success?: boolean; durationMs?: number; error?: string };
      if (data.workspace) {
        const spanId = activeSpans.get(`bootstrap:${data.workspace}`);
        if (spanId) {
          tracer.setAttributes(spanId, {
            success: data.success,
            durationMs: data.durationMs,
            status: data.success ? 'ok' : 'error',
            error: data.error,
          });
          tracer.endSpan(spanId);
          activeSpans.delete(`bootstrap:${data.workspace}`);
        }
      }
      break;
    }

    // Indexing events
    case 'indexing_started': {
      const data = event.data as { taskId?: string; type?: string; fileCount?: number };
      if (data.taskId) {
        const spanId = tracer.startSpan('indexing', {
          attributes: {
            taskId: data.taskId,
            type: data.type,
            fileCount: data.fileCount,
          },
        });
        activeSpans.set(`index:${data.taskId}`, spanId);
      }
      break;
    }

    case 'indexing_complete': {
      const data = event.data as { taskId?: string; filesProcessed?: number; functionsIndexed?: number; durationMs?: number };
      if (data.taskId) {
        const spanId = activeSpans.get(`index:${data.taskId}`);
        if (spanId) {
          tracer.setAttributes(spanId, {
            filesProcessed: data.filesProcessed,
            functionsIndexed: data.functionsIndexed,
            durationMs: data.durationMs,
            status: 'ok',
          });
          tracer.endSpan(spanId);
          activeSpans.delete(`index:${data.taskId}`);
        }
      }
      break;
    }

    // Engine events
    case 'engine_relevance': {
      const data = event.data as { intent?: string; packCount?: number; confidence?: number };
      const spanId = tracer.startSpan('engine:relevance', {
        attributes: {
          intent: data.intent,
          packCount: data.packCount,
          confidence: data.confidence,
        },
      });
      tracer.endSpan(spanId);
      break;
    }

    case 'engine_constraint': {
      const data = event.data as { file?: string; violations?: number; warnings?: number; blocking?: boolean };
      const spanId = tracer.startSpan('engine:constraint', {
        attributes: {
          file: data.file,
          violations: data.violations,
          warnings: data.warnings,
          blocking: data.blocking,
        },
      });
      tracer.endSpan(spanId);
      break;
    }

    case 'confidence_updated': {
      const data = event.data as { entityId?: string; entityType?: string; confidence?: number; delta?: number };
      const spanId = tracer.startSpan('engine:confidence', {
        attributes: {
          entityId: data.entityId,
          entityType: data.entityType,
          confidence: data.confidence,
          delta: data.delta,
        },
      });
      tracer.endSpan(spanId);
      break;
    }

    // Task events
    case 'task_received': {
      const data = event.data as { taskId?: string; intent?: string; scope?: string[] };
      if (data.taskId) {
        const spanId = tracer.startSpan('task', {
          attributes: {
            taskId: data.taskId,
            intent: data.intent,
            scope: data.scope,
          },
        });
        activeSpans.set(`task:${data.taskId}`, spanId);
      }
      break;
    }

    case 'task_completed':
    case 'task_failed': {
      const data = event.data as { taskId?: string; success?: boolean; packsUsed?: string[]; reason?: string };
      if (data.taskId) {
        const spanId = activeSpans.get(`task:${data.taskId}`);
        if (spanId) {
          tracer.setAttributes(spanId, {
            success: data.success,
            packsUsed: data.packsUsed,
            reason: data.reason,
            status: data.success ? 'ok' : 'error',
          });
          tracer.endSpan(spanId);
          activeSpans.delete(`task:${data.taskId}`);
        }
      }
      break;
    }

    // File events (create instant spans)
    case 'file_modified':
    case 'file_created':
    case 'file_deleted': {
      const data = event.data as { filePath?: string; reason?: string };
      const spanId = tracer.startSpan(`file:${event.type.replace('file_', '')}`, {
        attributes: {
          filePath: data.filePath,
          reason: data.reason,
        },
      });
      tracer.endSpan(spanId);
      break;
    }

    // Context pack events
    case 'context_pack_invalidated':
    case 'context_packs_invalidated': {
      const data = event.data as { packId?: string; triggerPath?: string; count?: number; reason?: string };
      const spanId = tracer.startSpan('contextPack:invalidated', {
        attributes: {
          packId: data.packId,
          triggerPath: data.triggerPath,
          count: data.count,
          reason: data.reason,
        },
      });
      tracer.endSpan(spanId);
      break;
    }

    // Upgrade events
    case 'upgrade_started': {
      const data = event.data as { fromVersion?: string; toVersion?: string; upgradeType?: string };
      const spanId = tracer.startSpan('upgrade', {
        attributes: {
          fromVersion: data.fromVersion,
          toVersion: data.toVersion,
          upgradeType: data.upgradeType,
        },
      });
      activeSpans.set('upgrade', spanId);
      break;
    }

    case 'upgrade_complete': {
      const data = event.data as { fromVersion?: string; toVersion?: string; success?: boolean; error?: string };
      const spanId = activeSpans.get('upgrade');
      if (spanId) {
        tracer.setAttributes(spanId, {
          success: data.success,
          error: data.error,
          status: data.success ? 'ok' : 'error',
        });
        tracer.endSpan(spanId);
        activeSpans.delete('upgrade');
      }
      break;
    }

    default:
      // For any other events, create a simple trace entry
      if (event.type) {
        const spanId = tracer.startSpan(`event:${event.type}`, {
          attributes: event.data as Record<string, unknown>,
        });
        tracer.endSpan(spanId);
      }
  }
};

// ============================================================================
// PUBLIC API
// ============================================================================

let unsubscribe: (() => void) | null = null;

/**
 * Enable the tracing bridge.
 * This subscribes to all librainian events and creates corresponding trace spans.
 */
export function enableTracingBridge(options?: TracingBridgeOptions): void {
  if (unsubscribe) {
    return; // Already enabled
  }

  const tracer = options?.tracer ?? globalTracer;
  if (options?.enabled !== undefined) {
    tracer.setEnabled(options.enabled);
  }

  unsubscribe = globalEventBus.on('*', bridgeHandler);
}

/**
 * Disable the tracing bridge.
 */
export function disableTracingBridge(): void {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
}

/**
 * Check if the tracing bridge is enabled.
 */
export function isTracingBridgeEnabled(): boolean {
  return unsubscribe !== null;
}

/**
 * Get the number of active spans.
 * Useful for debugging span leaks.
 */
export function getActiveSpanCount(): number {
  return activeSpans.size;
}

/**
 * Clear all active spans.
 * Useful for testing or resetting state.
 */
export function clearActiveSpans(): void {
  activeSpans.clear();
}
