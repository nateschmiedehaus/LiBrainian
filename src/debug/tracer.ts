/**
 * @fileoverview Unified Debugging/Tracing for the LiBrainian system (G10)
 *
 * Provides distributed tracing capabilities for debugging librainian operations.
 * Spans can be nested to track hierarchical operations like:
 * - Query execution with sub-spans for embedding, search, ranking
 * - Bootstrap phases with sub-spans for each indexing step
 * - Engine reasoning with sub-spans for each evaluation
 */

import { randomUUID } from 'crypto';

// ============================================================================
// TRACE TYPES
// ============================================================================

/**
 * An event that occurred during a span's execution.
 */
export interface TraceEvent {
  name: string;
  timestamp: number;
  attributes: Record<string, unknown>;
}

/**
 * A trace span representing a unit of work.
 * Spans can be nested via parentId to form a trace tree.
 */
export interface TraceSpan {
  id: string;
  name: string;
  startTime: number;
  endTime?: number;
  parentId?: string;
  attributes: Record<string, unknown>;
  events: TraceEvent[];
}

/**
 * Options for starting a new span.
 */
export interface StartSpanOptions {
  parentId?: string;
  attributes?: Record<string, unknown>;
}

/**
 * Exported trace format for analysis.
 */
export interface ExportedTrace {
  spans: TraceSpan[];
  rootSpanId: string | null;
  startTime: number;
  endTime: number;
  durationMs: number;
}

// ============================================================================
// TRACER IMPLEMENTATION
// ============================================================================

/**
 * LiBrainianTracer provides distributed tracing for debugging librainian operations.
 *
 * Usage:
 * ```typescript
 * const tracer = new LiBrainianTracer();
 * const spanId = tracer.startSpan('queryLiBrainian');
 * tracer.addEvent(spanId, 'embedding_generated', { tokens: 128 });
 * // ... do work ...
 * tracer.endSpan(spanId);
 * const traces = tracer.exportTraces();
 * ```
 */
export class LiBrainianTracer {
  private spans: Map<string, TraceSpan> = new Map();
  private activeSpanId: string | null = null;
  private enabled: boolean = true;

  /**
   * Enable or disable tracing globally.
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Check if tracing is enabled.
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Start a new trace span.
   * @param name - The name of the operation being traced
   * @param options - Optional parent span ID and initial attributes
   * @returns The span ID for reference in other operations
   */
  startSpan(name: string, options?: StartSpanOptions | string): string {
    if (!this.enabled) {
      return '';
    }

    // Handle legacy signature: startSpan(name, parentId?)
    const opts: StartSpanOptions = typeof options === 'string'
      ? { parentId: options }
      : options ?? {};

    const id = randomUUID();
    const span: TraceSpan = {
      id,
      name,
      startTime: Date.now(),
      parentId: opts.parentId,
      attributes: opts.attributes ?? {},
      events: [],
    };

    this.spans.set(id, span);
    this.activeSpanId = id;

    return id;
  }

  /**
   * End a trace span.
   * @param spanId - The ID of the span to end
   */
  endSpan(spanId: string): void {
    if (!this.enabled || !spanId) {
      return;
    }

    const span = this.spans.get(spanId);
    if (!span) {
      return;
    }

    span.endTime = Date.now();

    // If this was the active span, clear it or set to parent
    if (this.activeSpanId === spanId) {
      this.activeSpanId = span.parentId ?? null;
    }
  }

  /**
   * Add an event to a span.
   * @param spanId - The ID of the span to add the event to
   * @param name - The name of the event
   * @param attributes - Optional attributes for the event
   */
  addEvent(spanId: string, name: string, attributes?: Record<string, unknown>): void {
    if (!this.enabled || !spanId) {
      return;
    }

    const span = this.spans.get(spanId);
    if (!span) {
      return;
    }

    span.events.push({
      name,
      timestamp: Date.now(),
      attributes: attributes ?? {},
    });
  }

  /**
   * Set an attribute on a span.
   * @param spanId - The ID of the span
   * @param key - The attribute key
   * @param value - The attribute value
   */
  setAttribute(spanId: string, key: string, value: unknown): void {
    if (!this.enabled || !spanId) {
      return;
    }

    const span = this.spans.get(spanId);
    if (!span) {
      return;
    }

    span.attributes[key] = value;
  }

  /**
   * Set multiple attributes on a span.
   * @param spanId - The ID of the span
   * @param attributes - The attributes to set
   */
  setAttributes(spanId: string, attributes: Record<string, unknown>): void {
    if (!this.enabled || !spanId) {
      return;
    }

    const span = this.spans.get(spanId);
    if (!span) {
      return;
    }

    Object.assign(span.attributes, attributes);
  }

  /**
   * Get a specific trace span.
   * @param spanId - The ID of the span to retrieve
   * @returns The span, or undefined if not found
   */
  getTrace(spanId: string): TraceSpan | undefined {
    return this.spans.get(spanId);
  }

  /**
   * Get the currently active span ID.
   */
  getActiveSpanId(): string | null {
    return this.activeSpanId;
  }

  /**
   * Export all traces as a flat array.
   * @returns All recorded trace spans
   */
  exportTraces(): TraceSpan[] {
    return Array.from(this.spans.values());
  }

  /**
   * Export traces as a structured trace object.
   * @returns Structured trace with root span and timing info
   */
  exportStructuredTrace(): ExportedTrace {
    const spans = this.exportTraces();
    const rootSpans = spans.filter(span => !span.parentId);
    const rootSpanId = rootSpans.length === 1 ? rootSpans[0].id : null;

    let startTime = Infinity;
    let endTime = 0;

    for (const span of spans) {
      if (span.startTime < startTime) {
        startTime = span.startTime;
      }
      if (span.endTime && span.endTime > endTime) {
        endTime = span.endTime;
      }
    }

    if (!Number.isFinite(startTime)) {
      startTime = Date.now();
    }
    if (endTime === 0) {
      endTime = Date.now();
    }

    return {
      spans,
      rootSpanId,
      startTime,
      endTime,
      durationMs: endTime - startTime,
    };
  }

  /**
   * Get child spans of a given span.
   * @param spanId - The parent span ID
   * @returns Array of child spans
   */
  getChildSpans(spanId: string): TraceSpan[] {
    return Array.from(this.spans.values()).filter(span => span.parentId === spanId);
  }

  /**
   * Build a tree representation of the trace.
   * @param spanId - The root span ID (or undefined for all root spans)
   * @returns Tree structure with span and children
   */
  buildTraceTree(spanId?: string): TraceTree[] {
    const rootSpans = spanId
      ? [this.spans.get(spanId)].filter(Boolean) as TraceSpan[]
      : Array.from(this.spans.values()).filter(span => !span.parentId);

    const buildNode = (span: TraceSpan): TraceTree => {
      const children = this.getChildSpans(span.id);
      return {
        span,
        children: children.map(buildNode),
        durationMs: span.endTime ? span.endTime - span.startTime : Date.now() - span.startTime,
      };
    };

    return rootSpans.map(buildNode);
  }

  /**
   * Clear all recorded traces.
   */
  clear(): void {
    this.spans.clear();
    this.activeSpanId = null;
  }

  /**
   * Get the number of recorded spans.
   */
  get size(): number {
    return this.spans.size;
  }
}

/**
 * Tree representation of a trace.
 */
export interface TraceTree {
  span: TraceSpan;
  children: TraceTree[];
  durationMs: number;
}

// ============================================================================
// GLOBAL TRACER INSTANCE
// ============================================================================

/**
 * Global tracer instance for the librainian system.
 * Use this for consistent tracing across all librainian operations.
 */
export const globalTracer = new LiBrainianTracer();

/**
 * Create a new tracer instance.
 * Useful for isolated testing or custom tracing scenarios.
 */
export function createTracer(): LiBrainianTracer {
  return new LiBrainianTracer();
}

// ============================================================================
// TRACING UTILITIES
// ============================================================================

/**
 * Trace an async function execution.
 * Automatically creates a span and handles errors.
 *
 * @param name - The name of the operation
 * @param fn - The async function to trace
 * @param options - Optional tracer and parent span
 * @returns The result of the function
 */
export async function traceAsync<T>(
  name: string,
  fn: (spanId: string) => Promise<T>,
  options?: { tracer?: LiBrainianTracer; parentId?: string; attributes?: Record<string, unknown> }
): Promise<T> {
  const tracer = options?.tracer ?? globalTracer;
  const spanId = tracer.startSpan(name, {
    parentId: options?.parentId,
    attributes: options?.attributes,
  });

  try {
    const result = await fn(spanId);
    tracer.setAttribute(spanId, 'status', 'ok');
    return result;
  } catch (error) {
    tracer.setAttribute(spanId, 'status', 'error');
    tracer.setAttribute(spanId, 'error.message', error instanceof Error ? error.message : String(error));
    tracer.setAttribute(spanId, 'error.type', error instanceof Error ? error.name : 'unknown');
    throw error;
  } finally {
    tracer.endSpan(spanId);
  }
}

/**
 * Trace a sync function execution.
 * Automatically creates a span and handles errors.
 *
 * @param name - The name of the operation
 * @param fn - The sync function to trace
 * @param options - Optional tracer and parent span
 * @returns The result of the function
 */
export function traceSync<T>(
  name: string,
  fn: (spanId: string) => T,
  options?: { tracer?: LiBrainianTracer; parentId?: string; attributes?: Record<string, unknown> }
): T {
  const tracer = options?.tracer ?? globalTracer;
  const spanId = tracer.startSpan(name, {
    parentId: options?.parentId,
    attributes: options?.attributes,
  });

  try {
    const result = fn(spanId);
    tracer.setAttribute(spanId, 'status', 'ok');
    return result;
  } catch (error) {
    tracer.setAttribute(spanId, 'status', 'error');
    tracer.setAttribute(spanId, 'error.message', error instanceof Error ? error.message : String(error));
    tracer.setAttribute(spanId, 'error.type', error instanceof Error ? error.name : 'unknown');
    throw error;
  } finally {
    tracer.endSpan(spanId);
  }
}

/**
 * Format a trace tree as a string for debugging.
 * @param tree - The trace tree to format
 * @param indent - The current indentation level
 * @returns Formatted string representation
 */
export function formatTraceTree(tree: TraceTree[], indent: number = 0): string {
  const lines: string[] = [];
  const prefix = '  '.repeat(indent);

  for (const node of tree) {
    const status = node.span.attributes['status'] as string | undefined;
    const statusIcon = status === 'error' ? '[X]' : status === 'ok' ? '[+]' : '[ ]';
    const duration = `${node.durationMs}ms`;

    lines.push(`${prefix}${statusIcon} ${node.span.name} (${duration})`);

    // Add events
    for (const event of node.span.events) {
      const eventTime = event.timestamp - node.span.startTime;
      lines.push(`${prefix}  > ${event.name} (+${eventTime}ms)`);
    }

    // Add children
    if (node.children.length > 0) {
      lines.push(formatTraceTree(node.children, indent + 1));
    }
  }

  return lines.join('\n');
}
