import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readQueryCostTelemetry } from '../query_cost_telemetry.js';

const tmpDirs: string[] = [];

async function createWorkspace(prefix: string): Promise<string> {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tmpDirs.push(workspace);
  await fs.mkdir(path.join(workspace, '.librarian'), { recursive: true });
  return workspace;
}

async function seedLedger(workspace: string, rows: Array<{
  id: string;
  timestamp: string;
  sessionId: string | null;
  costUsd: number | null;
  durationMs: number | null;
  cacheHit: number | null;
  payload: Record<string, unknown>;
}>): Promise<void> {
  const BetterSqlite3 = (await import('better-sqlite3')).default;
  const dbPath = path.join(workspace, '.librarian', 'evidence_ledger.db');
  const db = new BetterSqlite3(dbPath);
  try {
    db.exec(`
      CREATE TABLE evidence_ledger (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        kind TEXT NOT NULL,
        payload TEXT NOT NULL,
        provenance TEXT NOT NULL,
        confidence TEXT,
        related_entries TEXT NOT NULL DEFAULT '[]',
        session_id TEXT,
        cost_usd REAL,
        duration_ms INTEGER,
        agent_id TEXT,
        attempt_number INTEGER,
        cache_hit INTEGER
      )
    `);
    const insert = db.prepare(`
      INSERT INTO evidence_ledger (
        id, timestamp, kind, payload, provenance, confidence, related_entries, session_id,
        cost_usd, duration_ms, agent_id, attempt_number, cache_hit
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const row of rows) {
      insert.run(
        row.id,
        row.timestamp,
        'tool_call',
        JSON.stringify(row.payload),
        JSON.stringify({ source: 'tool_output', method: 'test' }),
        null,
        '[]',
        row.sessionId,
        row.costUsd,
        row.durationMs,
        'test-agent',
        1,
        row.cacheHit,
      );
    }
  } finally {
    db.close();
  }
}

describe('readQueryCostTelemetry', () => {
  afterEach(async () => {
    await Promise.all(tmpDirs.splice(0, tmpDirs.length).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  it('returns null when the evidence ledger is missing', async () => {
    const workspace = await createWorkspace('librarian-costs-missing-');
    const report = await readQueryCostTelemetry({ workspaceRoot: workspace });
    expect(report).toBeNull();
  });

  it('summarizes query tool telemetry with budget alerts', async () => {
    const workspace = await createWorkspace('librarian-costs-report-');
    const now = new Date();
    await seedLedger(workspace, [
      {
        id: 'q_1',
        timestamp: now.toISOString(),
        sessionId: 'sess-1',
        costUsd: 0.12,
        durationMs: 320,
        cacheHit: 0,
        payload: {
          toolName: 'query',
          tokenUsage: { input: 500, output: 250, total: 750, model: 'gpt-5-codex-medium' },
          result: { synthesisMode: 'llm' },
        },
      },
      {
        id: 'q_2',
        timestamp: new Date(now.getTime() - 1000).toISOString(),
        sessionId: 'sess-1',
        costUsd: 0.08,
        durationMs: 180,
        cacheHit: 1,
        payload: {
          toolName: 'query',
          tokenUsage: { input: 400, output: 200, total: 600, model: 'gpt-5-codex-medium' },
          llmCalls: 0,
          result: { synthesisMode: 'heuristic' },
        },
      },
      {
        id: 'ignore_1',
        timestamp: new Date(now.getTime() - 2000).toISOString(),
        sessionId: 'sess-1',
        costUsd: 0.25,
        durationMs: 900,
        cacheHit: 0,
        payload: {
          toolName: 'run_audit',
        },
      },
      {
        id: 'fallback_1',
        timestamp: new Date(now.getTime() - 3000).toISOString(),
        sessionId: 'sess-2',
        costUsd: 0.04,
        durationMs: 140,
        cacheHit: 0,
        payload: {
          toolName: 'librarian_query_complete',
          queryId: 'qry_fallback',
        },
      },
    ]);

    const report = await readQueryCostTelemetry({
      workspaceRoot: workspace,
      budgetUsd: 0.15,
      maxPerQuery: 5,
    });

    expect(report).not.toBeNull();
    expect(report?.totals.queriesCount).toBe(2);
    expect(report?.totals.totalTokens).toBe(1350);
    expect(report?.totals.totalCostUsd).toBeCloseTo(0.2, 6);
    expect(report?.session?.sessionId).toBe('sess-1');
    expect(report?.session?.budgetExceeded).toBe(true);
    expect(report?.alerts[0]).toContain('session_cost_budget_exceeded');
    expect(report?.perQuery.length).toBe(2);
    expect(report?.perQuery[0]?.source).toBe('mcp_query_tool');
  });

  it('falls back to query completion evidence when no query tool rows exist', async () => {
    const workspace = await createWorkspace('librarian-costs-fallback-');
    const now = new Date();
    await seedLedger(workspace, [
      {
        id: 'qc_1',
        timestamp: now.toISOString(),
        sessionId: 'sess-fallback',
        costUsd: null,
        durationMs: null,
        cacheHit: 0,
        payload: {
          toolName: 'librarian_query_complete',
          queryId: 'qry_1',
          latencyMs: 123,
          cacheHit: false,
          result: { small: 'output' },
        },
      },
    ]);

    const report = await readQueryCostTelemetry({
      workspaceRoot: workspace,
      sessionId: 'sess-fallback',
    });

    expect(report).not.toBeNull();
    expect(report?.totals.queriesCount).toBe(1);
    expect(report?.perQuery[0]?.source).toBe('query_complete_evidence');
    expect(report?.perQuery[0]?.latencyMs).toBe(123);
    expect(report?.perQuery[0]?.estimatedCostUsd).toBeGreaterThanOrEqual(0);
  });
});
