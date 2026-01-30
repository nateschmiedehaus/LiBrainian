/**
 * @fileoverview Unified Debugging/Tracing module for the Librarian system (G10)
 *
 * This module provides comprehensive debugging and tracing capabilities:
 *
 * ## Tracing
 * - Distributed tracing with span hierarchy
 * - Event recording within spans
 * - Global tracer for consistent tracing across operations
 * - Trace tree visualization
 *
 * ## Inspection
 * - Module inspection with dependencies and exports
 * - Function inspection with call graph and confidence
 * - Query execution inspection with timing breakdown
 * - Confidence inspection with breakdown and recommendations
 *
 * ## Usage
 *
 * ```typescript
 * import {
 *   globalTracer,
 *   traceAsync,
 *   createInspector,
 * } from 'librarian/debug';
 *
 * // Tracing an operation
 * const result = await traceAsync('myOperation', async (spanId) => {
 *   globalTracer.addEvent(spanId, 'step_1_complete');
 *   // ... do work ...
 *   return result;
 * });
 *
 * // Inspecting entities
 * const inspector = createInspector(storage);
 * const moduleInfo = await inspector.inspectModule('src/api/index.ts');
 * console.log(moduleInfo.confidence, moduleInfo.functions);
 * ```
 *
 * @packageDocumentation
 */

// Tracer exports
export {
  LibrarianTracer,
  globalTracer,
  createTracer,
  traceAsync,
  traceSync,
  formatTraceTree,
} from './tracer.js';

export type {
  TraceSpan,
  TraceEvent,
  StartSpanOptions,
  ExportedTrace,
  TraceTree,
} from './tracer.js';

// Inspector exports
export {
  LibrarianInspector,
  createInspector,
} from './inspector.js';

export type {
  ModuleInspection,
  FunctionInspection,
  QueryInspection,
  ConfidenceInspection,
  FunctionSummary,
  ContextPackSummary,
  ConfidenceHistoryEntry,
} from './inspector.js';

// Event bridge exports
export {
  enableTracingBridge,
  disableTracingBridge,
  isTracingBridgeEnabled,
  getActiveSpanCount,
  clearActiveSpans,
} from './event_bridge.js';

export type {
  TracingBridgeOptions,
} from './event_bridge.js';
