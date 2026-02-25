import path from 'node:path';
import { promises as fs } from 'node:fs';

import type { LibrarianStorage } from '../storage/types.js';
import type { LibrarianQuery } from '../types.js';
import { safeJsonParse } from '../utils/safe_json.js';

export const DEFAULT_MAX_ESCALATION_DEPTH = 2;
export const MAX_ALLOWED_ESCALATION_DEPTH = 8;

export interface RetrievalEscalationEvent {
  queryHash: string;
  intent: string;
  fromDepth: LibrarianQuery['depth'];
  toDepth: LibrarianQuery['depth'];
  totalConfidence: number;
  retrievalEntropy: number;
  reasons: string[];
  attempt: number;
  maxEscalationDepth: number;
  returnedPackIds: string[];
}

export interface RetrievalConfidenceObservationEvent {
  queryHash: string;
  intent?: string;
  confidenceScore: number;
  retrievalEntropy: number;
  returnedPackIds: string[];
  timestamp: string;
  fromDepth?: LibrarianQuery['depth'];
  toDepth?: LibrarianQuery['depth'];
  escalationReason?: string;
  attempt?: number;
  maxEscalationDepth?: number;
  routedStrategy?: string;
}

export async function resolveWorkspaceRoot(storage: LibrarianStorage): Promise<string> {
  try {
    const metadata = await storage.getMetadata();
    if (metadata?.workspace) return metadata.workspace;
  } catch {
    // Fall back to cwd when metadata is unavailable.
  }
  return process.cwd();
}

export async function resolveMaxEscalationDepth(workspaceRoot: string, override?: number): Promise<number> {
  if (typeof override === 'number' && Number.isFinite(override)) {
    return normalizeEscalationDepth(override);
  }

  const configPaths = [
    path.join(workspaceRoot, 'librainian.config.json'),
    path.join(workspaceRoot, '.librarian', 'config.json'),
  ];

  for (const configPath of configPaths) {
    try {
      const raw = await fs.readFile(configPath, 'utf8');
      const parsed = safeJsonParse<Record<string, unknown>>(raw);
      if (!parsed.ok || !parsed.value || typeof parsed.value !== 'object') continue;

      const topLevel = parsed.value.max_escalation_depth;
      const retrievalScoped = (parsed.value.retrieval as { max_escalation_depth?: unknown } | undefined)?.max_escalation_depth;
      const candidate = typeof topLevel === 'number' ? topLevel : (typeof retrievalScoped === 'number' ? retrievalScoped : undefined);
      if (candidate !== undefined) {
        return normalizeEscalationDepth(candidate);
      }
    } catch {
      // Optional config file; ignore read/parse failures.
    }
  }

  return DEFAULT_MAX_ESCALATION_DEPTH;
}

export async function logRetrievalEscalationEvent(
  storage: LibrarianStorage,
  workspaceRoot: string,
  event: RetrievalEscalationEvent,
): Promise<void> {
  const now = new Date().toISOString();
  await logRetrievalConfidenceObservation(storage, workspaceRoot, {
    queryHash: event.queryHash,
    intent: event.intent,
    confidenceScore: event.totalConfidence,
    retrievalEntropy: event.retrievalEntropy,
    returnedPackIds: event.returnedPackIds,
    timestamp: now,
    fromDepth: event.fromDepth,
    toDepth: event.toDepth,
    escalationReason: event.reasons.join('|') || 'policy_triggered',
    attempt: event.attempt,
    maxEscalationDepth: event.maxEscalationDepth,
  });
}

export async function logRetrievalConfidenceObservation(
  storage: LibrarianStorage,
  workspaceRoot: string,
  event: RetrievalConfidenceObservationEvent,
): Promise<void> {
  try {
    await storage.appendRetrievalConfidenceLog({
      queryHash: event.queryHash,
      confidenceScore: Number(event.confidenceScore.toFixed(4)),
      retrievalEntropy: Number(event.retrievalEntropy.toFixed(4)),
      returnedPackIds: event.returnedPackIds.slice(0, 50),
      timestamp: event.timestamp,
      intent: event.intent,
      fromDepth: event.fromDepth,
      toDepth: event.toDepth,
      escalationReason: event.escalationReason,
      attempt: event.attempt,
      maxEscalationDepth: event.maxEscalationDepth,
      routedStrategy: event.routedStrategy,
    });
  } catch {
    // Storage logging is best-effort and must never break query execution.
  }

  try {
    const logPath = path.join(workspaceRoot, '.librarian', 'retrieval_confidence_log.jsonl');
    await fs.mkdir(path.dirname(logPath), { recursive: true });
    const record = {
      timestamp: event.timestamp,
      query_hash: event.queryHash,
      escalation_reason: event.escalationReason ?? null,
      intent: event.intent,
      from_depth: event.fromDepth ?? null,
      to_depth: event.toDepth ?? null,
      confidence_score: Number(event.confidenceScore.toFixed(4)),
      retrieval_entropy: Number(event.retrievalEntropy.toFixed(4)),
      returned_pack_ids: event.returnedPackIds.slice(0, 50),
      attempt: event.attempt ?? null,
      max_escalation_depth: event.maxEscalationDepth ?? null,
      routed_strategy: event.routedStrategy ?? null,
    };
    await fs.appendFile(logPath, `${JSON.stringify(record)}\n`, 'utf8');
  } catch {
    // Logging must never break query execution.
  }
}

function normalizeEscalationDepth(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_MAX_ESCALATION_DEPTH;
  return Math.max(0, Math.min(MAX_ALLOWED_ESCALATION_DEPTH, Math.floor(value)));
}
