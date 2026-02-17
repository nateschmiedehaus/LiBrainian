/**
 * @fileoverview Bridge between LibrarianEventBus and the evidence ledger.
 *
 * Records librarian events into the evidence ledger with stable session IDs and
 * emits correlation-conflict entries when multiple sessions touch the same task/query.
 */

import type { LibrarianEvent, LibrarianEventHandler, LibrarianEventBus } from '../events.js';
import { globalEventBus } from '../events.js';
import type { IEvidenceLedger, SessionId, ToolCallEvidence } from './evidence_ledger.js';
import { logWarning } from '../telemetry/logger.js';

export interface EventLedgerBridgeOptions {
  ledger: IEvidenceLedger;
  eventBus?: LibrarianEventBus;
  enabled?: boolean;
}

const EVENT_TOOL_PREFIX = 'librarian_event';
const CONFLICT_TOOL_NAME = 'librarian_event_conflict';
const MAX_APPEND_ATTEMPTS = 3;
const BASE_RETRY_DELAY_MS = 25;

let unsubscribe: (() => void) | null = null;
let activeLedger: IEvidenceLedger | null = null;
let activeEventBus: LibrarianEventBus | null = null;

const correlationIndex = new Map<string, Set<string>>();
const recordedConflicts = new Set<string>();

function coerceSessionId(value: unknown): SessionId | undefined {
  if (typeof value !== 'string') return undefined;
  if (!value.trim()) return undefined;
  if (value.startsWith('unverified_by_trace(')) return undefined;
  return value as SessionId;
}

function extractSessionId(event: LibrarianEvent): SessionId | undefined {
  const data = (event.data ?? {}) as Record<string, unknown>;
  return coerceSessionId(
    event.sessionId ??
      event.correlationId ??
      data.sessionId ??
      data.correlationId
  );
}

function extractCorrelationKey(event: LibrarianEvent): string | null {
  const data = (event.data ?? {}) as Record<string, unknown>;
  const taskId = typeof data.taskId === 'string' ? data.taskId : undefined;
  if (taskId) return `task:${taskId}`;
  const queryId = typeof data.queryId === 'string' ? data.queryId : undefined;
  if (queryId) return `query:${queryId}`;
  const executionId = typeof data.executionId === 'string' ? data.executionId : undefined;
  if (executionId) return `execution:${executionId}`;
  return null;
}

function safePayload(value: unknown): unknown {
  try {
    JSON.stringify(value);
    return value;
  } catch {
    return {
      unverified: 'unverified_by_trace(non_serializable_event_payload)',
      summary: String(value),
    };
  }
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function appendWithRetry(
  ledger: IEvidenceLedger,
  entry: Parameters<IEvidenceLedger['append']>[0]
): Promise<void> {
  for (let attempt = 0; attempt < MAX_APPEND_ATTEMPTS; attempt += 1) {
    try {
      await ledger.append(entry);
      return;
    } catch (error) {
      if (attempt === MAX_APPEND_ATTEMPTS - 1) {
        logWarning('Evidence ledger append failed for event bridge', {
          error: error instanceof Error ? error.message : String(error),
        });
        return;
      }
      const backoff = Math.min(250, BASE_RETRY_DELAY_MS * Math.pow(2, attempt));
      await delay(backoff);
    }
  }
}

async function recordEventEntry(ledger: IEvidenceLedger, event: LibrarianEvent, sessionId?: SessionId): Promise<void> {
  const correlationKey = extractCorrelationKey(event);
  const payload: ToolCallEvidence = {
    toolName: `${EVENT_TOOL_PREFIX}:${event.type}`,
    arguments: {
      eventType: event.type,
      timestamp: event.timestamp.toISOString(),
      correlationKey,
      data: safePayload(event.data),
    },
    result: {
      recorded: true,
    },
    success: true,
    durationMs: 0,
  };

  await appendWithRetry(ledger, {
    kind: 'tool_call',
    payload,
    provenance: {
      source: 'system_observation',
      method: 'event_bus',
      agent: { type: 'tool', identifier: 'LibrarianEventBus' },
    },
    relatedEntries: [],
    sessionId,
  });
}

async function recordConflictEntries(
  ledger: IEvidenceLedger,
  correlationKey: string,
  sessions: Set<string>
): Promise<void> {
  const sessionList = Array.from(sessions);
  for (const sessionId of sessionList) {
    const conflictKey = `${correlationKey}:${sessionId}`;
    if (recordedConflicts.has(conflictKey)) continue;
    recordedConflicts.add(conflictKey);
    const payload: ToolCallEvidence = {
      toolName: CONFLICT_TOOL_NAME,
      arguments: {
        correlationKey,
        sessions: sessionList,
      },
      result: {
        conflict: true,
      },
      success: false,
      durationMs: 0,
      errorMessage: `unverified_by_trace(multi_agent_conflict): ${correlationKey}`,
    };
    await appendWithRetry(ledger, {
      kind: 'tool_call',
      payload,
      provenance: {
        source: 'system_observation',
        method: 'event_correlation',
        agent: { type: 'tool', identifier: 'LibrarianEventBus' },
      },
      relatedEntries: [],
      sessionId: sessionId as SessionId,
    });
  }
}

const bridgeHandler: LibrarianEventHandler = async (event: LibrarianEvent): Promise<void> => {
  if (!activeLedger) return;
  const sessionId = extractSessionId(event);
  try {
    await recordEventEntry(activeLedger, event, sessionId);

    const correlationKey = extractCorrelationKey(event);
    if (!correlationKey || !sessionId) return;
    const sessions = correlationIndex.get(correlationKey) ?? new Set<string>();
    sessions.add(sessionId);
    correlationIndex.set(correlationKey, sessions);
    if (sessions.size > 1) {
      await recordConflictEntries(activeLedger, correlationKey, sessions);
    }
  } catch (error) {
    logWarning('Event ledger bridge failed to record event', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

export function enableEventLedgerBridge(options: EventLedgerBridgeOptions): void {
  activeLedger = options.ledger;
  if (options.enabled === false) return;
  if (unsubscribe) return;
  const bus = options.eventBus ?? globalEventBus;
  activeEventBus = bus;
  unsubscribe = bus.on('*', bridgeHandler);
}

export function disableEventLedgerBridge(): void {
  if (unsubscribe) {
    unsubscribe();
  }
  unsubscribe = null;
  activeLedger = null;
  activeEventBus = null;
}

export function isEventLedgerBridgeEnabled(): boolean {
  return unsubscribe !== null;
}

export function resetEventLedgerBridgeState(): void {
  correlationIndex.clear();
  recordedConflicts.clear();
}

export async function collectCorrelationConflictDisclosures(
  ledger: IEvidenceLedger,
  sessionId: SessionId
): Promise<string[]> {
  try {
    const entries = await ledger.query({
      sessionId,
      kinds: ['tool_call'],
      textSearch: `"toolName":"${CONFLICT_TOOL_NAME}"`,
    });
    const conflictMap = new Map<string, Set<string>>();
    for (const entry of entries) {
      const payload = entry.payload as ToolCallEvidence | undefined;
      if (!payload || payload.toolName !== CONFLICT_TOOL_NAME) continue;
      const args = payload.arguments as { correlationKey?: unknown; sessions?: unknown } | undefined;
      const correlationKey = typeof args?.correlationKey === 'string'
        ? args?.correlationKey
        : 'unknown';
      const sessions = Array.isArray(args?.sessions)
        ? args?.sessions.filter((session) => typeof session === 'string') as string[]
        : [];
      const existing = conflictMap.get(correlationKey) ?? new Set<string>();
      for (const session of sessions) existing.add(session);
      conflictMap.set(correlationKey, existing);
    }
    if (conflictMap.size === 0) return [];
    const summaries = Array.from(conflictMap.entries()).map(([key, sessions]) => {
      const suffix = sessions.size ? ` (${Array.from(sessions).join(', ')})` : '';
      return `${key}${suffix}`;
    });
    return [`unverified_by_trace(multi_agent_conflict): ${summaries.join('; ')}`];
  } catch {
    return [];
  }
}

export function getEventLedgerBridgeEventBus(): LibrarianEventBus | null {
  return activeEventBus;
}

export const EVENT_LEDGER_CONFLICT_TOOL_NAME = CONFLICT_TOOL_NAME;
