import type { LiBrainianStorage } from '../storage/types.js';
import { safeJsonParseSimple } from '../utils/safe_json.js';

export type ExecutionOutcome = 'success' | 'failure' | 'partial' | 'unknown';

export interface ExecutionTrace {
  executionId: string;
  compositionId?: string;
  primitiveSequence: string[];
  operatorsUsed: string[];
  intent: string;
  outcome: ExecutionOutcome;
  durationMs: number;
  timestamp: string;
}

type ExecutionTraceState = {
  schema_version: 1;
  updatedAt: string;
  items: ExecutionTrace[];
};

const EXECUTION_TRACES_KEY = 'librarian.execution_traces.v1';

export async function recordExecutionTrace(
  storage: LiBrainianStorage,
  trace: ExecutionTrace,
  options: { maxTraces?: number } = {}
): Promise<void> {
  const records = await loadExecutionTraces(storage);
  const next = records.filter((item) => item.executionId !== trace.executionId);
  next.push(normalizeTrace(trace));
  const sorted = next.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  const maxTraces = options.maxTraces;
  const trimmed = typeof maxTraces === 'number' && maxTraces > 0 && sorted.length > maxTraces
    ? sorted.slice(sorted.length - maxTraces)
    : sorted;
  await writeExecutionTraces(storage, trimmed);
}

export async function listExecutionTraces(
  storage: LiBrainianStorage,
  options: { limit?: number } = {}
): Promise<ExecutionTrace[]> {
  const records = await loadExecutionTraces(storage);
  const sorted = records.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  const limit = options.limit;
  const sliced = typeof limit === 'number' && limit > 0 ? sorted.slice(0, limit) : sorted;
  return sliced.map((item) => ({ ...item }));
}

function normalizeTrace(trace: ExecutionTrace): ExecutionTrace {
  return {
    executionId: trace.executionId,
    compositionId: trace.compositionId,
    primitiveSequence: Array.isArray(trace.primitiveSequence)
      ? trace.primitiveSequence.filter((id) => typeof id === 'string' && id.length > 0)
      : [],
    operatorsUsed: Array.isArray(trace.operatorsUsed)
      ? trace.operatorsUsed.filter((id) => typeof id === 'string' && id.length > 0)
      : [],
    intent: typeof trace.intent === 'string' ? trace.intent : '',
    outcome: trace.outcome ?? 'unknown',
    durationMs: Number.isFinite(trace.durationMs) ? Math.max(0, trace.durationMs) : 0,
    timestamp: typeof trace.timestamp === 'string' && trace.timestamp
      ? trace.timestamp
      : new Date().toISOString(),
  };
}

async function loadExecutionTraces(storage: LiBrainianStorage): Promise<ExecutionTrace[]> {
  const raw = await storage.getState(EXECUTION_TRACES_KEY);
  if (!raw) return [];
  const parsed = safeJsonParseSimple<ExecutionTraceState>(raw);
  if (!parsed || !Array.isArray(parsed.items)) return [];
  return parsed.items.map((item) => ({ ...item }));
}

async function writeExecutionTraces(
  storage: LiBrainianStorage,
  items: ExecutionTrace[]
): Promise<void> {
  const payload: ExecutionTraceState = {
    schema_version: 1,
    updatedAt: new Date().toISOString(),
    items,
  };
  await storage.setState(EXECUTION_TRACES_KEY, JSON.stringify(payload));
}
