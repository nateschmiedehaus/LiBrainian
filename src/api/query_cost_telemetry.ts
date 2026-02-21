import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { resolveDbPath } from '../cli/db_path.js';

const DEFAULT_INPUT_RATE_PER_1M = 3;
const DEFAULT_OUTPUT_RATE_PER_1M = 15;
const DEFAULT_LOOKBACK_DAYS = 7;
const DEFAULT_MAX_PER_QUERY = 10;
const DEFAULT_SESSION_BUDGET_USD = 1;
const MAX_QUERY_SCAN_ROWS = 5000;
const QUERY_TOOL_NAME = 'query';
const QUERY_COMPLETE_TOOL_NAME = 'librarian_query_complete';

type LedgerRow = {
  id: string;
  timestamp: string;
  session_id: string | null;
  cost_usd: number | null;
  duration_ms: number | null;
  cache_hit: number | null;
  payload: string;
};

type ToolCallPayload = {
  toolName?: unknown;
  arguments?: unknown;
  result?: unknown;
  durationMs?: unknown;
  latencyMs?: unknown;
  cacheHit?: unknown;
  costUsd?: unknown;
  llmCalls?: unknown;
  tokenUsage?: {
    input?: unknown;
    output?: unknown;
    total?: unknown;
    model?: unknown;
  };
  queryId?: unknown;
  model?: unknown;
};

export type QueryCostSample = {
  id: string;
  timestamp: string;
  sessionId: string | null;
  queryId: string | null;
  tokensIn: number;
  tokensOut: number;
  totalTokens: number;
  llmCalls: number;
  latencyMs: number;
  estimatedCostUsd: number;
  cacheHit: boolean | null;
  model: string | null;
  source: 'mcp_query_tool' | 'query_complete_evidence';
};

export type QueryCostSummary = {
  sessionId: string | null;
  queriesCount: number;
  totalTokensIn: number;
  totalTokensOut: number;
  totalTokens: number;
  llmCalls: number;
  totalCostUsd: number;
  avgLatencyMs: number;
  budgetUsd: number;
  budgetExceeded: boolean;
};

export type QuerySessionDistribution = {
  sessionId: string | null;
  queriesCount: number;
  totalCostUsd: number;
};

export type QueryCostTelemetry = {
  kind: 'QueryCostTelemetry.v1';
  generatedAt: string;
  workspace: string;
  dataSource: 'evidence_ledger';
  lookbackDays: number;
  budgetUsd: number;
  totals: QueryCostSummary;
  session: QueryCostSummary | null;
  perQuery: QueryCostSample[];
  sessionDistribution: QuerySessionDistribution[];
  alerts: string[];
};

export async function readQueryCostTelemetry(options: {
  workspaceRoot: string;
  sessionId?: string;
  budgetUsd?: number;
  lookbackDays?: number;
  maxPerQuery?: number;
}): Promise<QueryCostTelemetry | null> {
  const workspaceRoot = path.resolve(options.workspaceRoot);
  const lookbackDays = clampInt(options.lookbackDays, DEFAULT_LOOKBACK_DAYS, 1, 365);
  const maxPerQuery = clampInt(options.maxPerQuery, DEFAULT_MAX_PER_QUERY, 1, 100);
  const budgetUsd = normalizeMoney(
    options.budgetUsd ?? readCostRate('LIBRARIAN_SESSION_COST_BUDGET_USD', DEFAULT_SESSION_BUDGET_USD)
  );
  const requestedSessionId = normalizeSessionId(options.sessionId);
  const dbPath = await resolveDbPath(workspaceRoot);
  const ledgerPath = path.join(path.dirname(dbPath), 'evidence_ledger.db');
  try {
    await fs.access(ledgerPath);
  } catch {
    return null;
  }

  const BetterSqlite3 = (await import('better-sqlite3')).default;
  const db = new BetterSqlite3(ledgerPath, { readonly: true });
  try {
    const sinceIso = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();
    const rows = db.prepare(
      `
      SELECT id, timestamp, session_id, cost_usd, duration_ms, cache_hit, payload
      FROM evidence_ledger
      WHERE kind = 'tool_call' AND timestamp >= ?
      ORDER BY timestamp DESC
      LIMIT ?
      `
    ).all(sinceIso, MAX_QUERY_SCAN_ROWS) as LedgerRow[];

    const allCandidates = rows
      .map((row) => toQueryCostSample(row))
      .filter((sample): sample is QueryCostSample => sample !== null);
    const queryToolSamples = allCandidates.filter((sample) => sample.source === 'mcp_query_tool');
    const selectedSamples = queryToolSamples.length > 0
      ? queryToolSamples
      : allCandidates.filter((sample) => sample.source === 'query_complete_evidence');

    const totals = buildSummary(selectedSamples, budgetUsd, null);
    const sessionId = requestedSessionId ?? selectedSamples.find((sample) => sample.sessionId)?.sessionId ?? null;
    const sessionSamples = sessionId
      ? selectedSamples.filter((sample) => sample.sessionId === sessionId)
      : [];
    const session = sessionId ? buildSummary(sessionSamples, budgetUsd, sessionId) : null;
    const perQuerySource = sessionSamples.length > 0 ? sessionSamples : selectedSamples;
    const perQuery = perQuerySource.slice(0, maxPerQuery);
    const sessionDistribution = buildSessionDistribution(selectedSamples).slice(0, 10);

    const alerts: string[] = [];
    if (session && session.budgetExceeded) {
      alerts.push(
        `session_cost_budget_exceeded: session=${session.sessionId} cost=$${session.totalCostUsd.toFixed(4)} budget=$${budgetUsd.toFixed(4)}`
      );
    }

    return {
      kind: 'QueryCostTelemetry.v1',
      generatedAt: new Date().toISOString(),
      workspace: workspaceRoot,
      dataSource: 'evidence_ledger',
      lookbackDays,
      budgetUsd,
      totals,
      session,
      perQuery,
      sessionDistribution,
      alerts,
    };
  } finally {
    db.close();
  }
}

function toQueryCostSample(row: LedgerRow): QueryCostSample | null {
  const payload = parsePayload(row.payload);
  const toolName = asString(payload.toolName);
  if (toolName !== QUERY_TOOL_NAME && toolName !== QUERY_COMPLETE_TOOL_NAME) {
    return null;
  }
  const source: QueryCostSample['source'] = toolName === QUERY_TOOL_NAME
    ? 'mcp_query_tool'
    : 'query_complete_evidence';
  const tokenUsage = payload.tokenUsage;
  const payloadArgs = payload.arguments;
  const payloadResult = payload.result;
  const tokensIn = Math.max(0, toFiniteInt(tokenUsage?.input) ?? estimateTokens(payloadArgs));
  const tokensOut = Math.max(0, toFiniteInt(tokenUsage?.output) ?? estimateTokens(payloadResult));
  const totalTokens = Math.max(tokensIn + tokensOut, toFiniteInt(tokenUsage?.total) ?? 0);
  const latencyMs = Math.max(
    0,
    toFiniteInt(row.duration_ms)
      ?? toFiniteInt(payload.durationMs)
      ?? toFiniteInt(payload.latencyMs)
      ?? toFiniteInt(getField(payloadResult, 'latencyMs'))
      ?? 0
  );
  const explicitCost = toFiniteNumber(row.cost_usd) ?? toFiniteNumber(payload.costUsd);
  const estimatedCostUsd = normalizeMoney(
    explicitCost ?? estimateCostUsd(tokensIn, tokensOut)
  );
  const cacheHit = toBooleanFromDb(row.cache_hit)
    ?? toBoolean(payload.cacheHit)
    ?? toBoolean(getField(payloadResult, 'cacheHit'));
  const llmCalls = Math.max(
    0,
    toFiniteInt(payload.llmCalls)
      ?? toFiniteInt(getField(payloadResult, 'llmCalls'))
      ?? (asString(getField(payloadResult, 'synthesisMode')) === 'llm' ? 1 : 0)
  );

  return {
    id: row.id,
    timestamp: row.timestamp,
    sessionId: normalizeSessionId(row.session_id),
    queryId: findQueryId(payload),
    tokensIn,
    tokensOut,
    totalTokens,
    llmCalls,
    latencyMs,
    estimatedCostUsd,
    cacheHit,
    model: asString(tokenUsage?.model) ?? asString(payload.model) ?? asString(getField(payloadResult, 'model')) ?? null,
    source,
  };
}

function parsePayload(raw: string): ToolCallPayload {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object') {
      return parsed as ToolCallPayload;
    }
  } catch {
    // Keep fallthrough default.
  }
  return {};
}

function findQueryId(payload: ToolCallPayload): string | null {
  return (
    asString(payload.queryId)
    ?? asString(getField(payload.arguments, 'queryId'))
    ?? asString(getField(payload.result, 'queryId'))
    ?? asString(getField(payload.result, 'feedbackToken'))
    ?? null
  );
}

function buildSummary(samples: QueryCostSample[], budgetUsd: number, sessionId: string | null): QueryCostSummary {
  const queriesCount = samples.length;
  const totalTokensIn = samples.reduce((sum, sample) => sum + sample.tokensIn, 0);
  const totalTokensOut = samples.reduce((sum, sample) => sum + sample.tokensOut, 0);
  const totalTokens = samples.reduce((sum, sample) => sum + sample.totalTokens, 0);
  const llmCalls = samples.reduce((sum, sample) => sum + sample.llmCalls, 0);
  const totalLatency = samples.reduce((sum, sample) => sum + sample.latencyMs, 0);
  const totalCostUsd = normalizeMoney(samples.reduce((sum, sample) => sum + sample.estimatedCostUsd, 0));
  const avgLatencyMs = queriesCount > 0 ? Math.round((totalLatency / queriesCount) * 100) / 100 : 0;
  const budgetExceeded = totalCostUsd > budgetUsd && queriesCount > 0;

  return {
    sessionId,
    queriesCount,
    totalTokensIn,
    totalTokensOut,
    totalTokens,
    llmCalls,
    totalCostUsd,
    avgLatencyMs,
    budgetUsd,
    budgetExceeded,
  };
}

function buildSessionDistribution(samples: QueryCostSample[]): QuerySessionDistribution[] {
  const grouped = new Map<string, { sessionId: string | null; queriesCount: number; totalCostUsd: number }>();
  for (const sample of samples) {
    const key = sample.sessionId ?? '__null__';
    const current = grouped.get(key) ?? { sessionId: sample.sessionId, queriesCount: 0, totalCostUsd: 0 };
    current.queriesCount += 1;
    current.totalCostUsd += sample.estimatedCostUsd;
    grouped.set(key, current);
  }
  return Array.from(grouped.values())
    .map((item) => ({
      sessionId: item.sessionId,
      queriesCount: item.queriesCount,
      totalCostUsd: normalizeMoney(item.totalCostUsd),
    }))
    .sort((a, b) => {
      if (b.totalCostUsd !== a.totalCostUsd) return b.totalCostUsd - a.totalCostUsd;
      return b.queriesCount - a.queriesCount;
    });
}

function estimateTokens(value: unknown): number {
  if (value === null || value === undefined) return 0;
  try {
    const size = JSON.stringify(value).length;
    if (size <= 0) return 0;
    return Math.max(1, Math.ceil(size / 4));
  } catch {
    return 0;
  }
}

function estimateCostUsd(tokensIn: number, tokensOut: number): number {
  const inputRate = readCostRate('LIBRARIAN_COST_INPUT_PER_1M', DEFAULT_INPUT_RATE_PER_1M);
  const outputRate = readCostRate('LIBRARIAN_COST_OUTPUT_PER_1M', DEFAULT_OUTPUT_RATE_PER_1M);
  return ((tokensIn / 1_000_000) * inputRate) + ((tokensOut / 1_000_000) * outputRate);
}

function readCostRate(envVar: string, fallback: number): number {
  const raw = process.env[envVar];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function toFiniteInt(value: unknown): number | null {
  const parsed = toFiniteNumber(value);
  return parsed === null ? null : Math.trunc(parsed);
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return null;
}

function toBooleanFromDb(value: unknown): boolean | null {
  const parsed = toFiniteNumber(value);
  if (parsed === null) return null;
  if (parsed === 0) return false;
  if (parsed === 1) return true;
  return null;
}

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function normalizeMoney(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.round(value * 1_000_000) / 1_000_000;
}

function normalizeSessionId(value: unknown): string | null {
  const normalized = asString(value);
  return normalized ?? null;
}

function getField(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object') return undefined;
  return (value as Record<string, unknown>)[key];
}
