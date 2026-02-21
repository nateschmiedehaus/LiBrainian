/**
 * @fileoverview Librarian Traces Stub
 * Provides tracing utilities for standalone librarian.
 */

export interface TraceContext {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  startTime?: number;
}

export interface TraceRefs {
  traceId: string;
  spanId: string;
  baggage?: Record<string, string>;
}

export interface TraceRecord {
  traceId: string;
  spanId: string;
  name: string;
  startTime: number;
  endTime?: number;
  attributes?: Record<string, unknown>;
  status?: 'ok' | 'error';
  error?: string;
}

// Storage for traces (in-memory for now)
const traces: TraceRecord[] = [];

export function createTraceContext(): TraceContext {
  return {
    traceId: Math.random().toString(36).substring(2),
    spanId: Math.random().toString(36).substring(2),
    startTime: Date.now(),
  };
}

export function createLibrarianTraceContext(workspace?: string): TraceContext {
  const ctx = createTraceContext();
  if (workspace) {
    ctx.parentSpanId = workspace;  // Store workspace as context
  }
  return ctx;
}

export function getLibrarianTraceRefs(context?: TraceContext): string[] {
  if (context) {
    return [`trace:${context.traceId}`, `span:${context.spanId}`];
  }
  return [];
}

/**
 * Get trace refs as an object (for internal use)
 */
export function getLibrarianTraceRefsObject(context?: TraceContext): TraceRefs {
  if (context) {
    return {
      traceId: context.traceId,
      spanId: context.spanId,
      baggage: context.parentSpanId ? { workspace: context.parentSpanId } : undefined,
    };
  }
  return {
    traceId: Math.random().toString(36).substring(2),
    spanId: Math.random().toString(36).substring(2),
  };
}

export function recordLibrarianTrace(contextOrRecord: TraceContext | Partial<TraceRecord>, name?: string): void {
  if (name !== undefined) {
    // Called as recordLibrarianTrace(context, name)
    const ctx = contextOrRecord as TraceContext;
    traces.push({
      traceId: ctx.traceId,
      spanId: ctx.spanId,
      name,
      startTime: ctx.startTime ?? Date.now(),
      status: 'ok',
    });
  } else {
    // Called as recordLibrarianTrace(record)
    const record = contextOrRecord as Partial<TraceRecord>;
    traces.push({
      traceId: record.traceId ?? Math.random().toString(36).substring(2),
      spanId: record.spanId ?? Math.random().toString(36).substring(2),
      name: record.name ?? 'unknown',
      startTime: record.startTime ?? Date.now(),
      endTime: record.endTime,
      attributes: record.attributes,
      status: record.status ?? 'ok',
      error: record.error,
    });
  }
}

export function withTrace<T>(name: string, fn: () => T): T {
  const ctx = createTraceContext();
  try {
    const result = fn();
    recordLibrarianTrace({ ...ctx, name, endTime: Date.now(), status: 'ok' });
    return result;
  } catch (error) {
    recordLibrarianTrace({ ...ctx, name, endTime: Date.now(), status: 'error', error: String(error) });
    throw error;
  }
}

export async function withTraceAsync<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const ctx = createTraceContext();
  try {
    const result = await fn();
    recordLibrarianTrace({ ...ctx, name, endTime: Date.now(), status: 'ok' });
    return result;
  } catch (error) {
    recordLibrarianTrace({ ...ctx, name, endTime: Date.now(), status: 'error', error: String(error) });
    throw error;
  }
}

export function getTraces(): TraceRecord[] {
  return [...traces];
}

export function clearTraces(): void {
  traces.length = 0;
}
