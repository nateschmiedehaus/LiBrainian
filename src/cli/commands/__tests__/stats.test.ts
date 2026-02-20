import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { statsCommand } from '../stats.js';

const tempDirs: string[] = [];

async function createWorkspace(): Promise<string> {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librainian-stats-'));
  tempDirs.push(workspace);
  await fs.mkdir(path.join(workspace, '.librarian'), { recursive: true });
  return workspace;
}

async function seedLedger(workspace: string): Promise<void> {
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
      );
    `);

    const now = new Date().toISOString();
    const provenance = JSON.stringify({ source: 'tool_output', method: 'test' });
    const empty = '[]';

    const insert = db.prepare(`
      INSERT INTO evidence_ledger (
        id, timestamp, kind, payload, provenance, confidence, related_entries, session_id,
        cost_usd, duration_ms, agent_id, attempt_number, cache_hit
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insert.run(
      'ev_1',
      now,
      'tool_call',
      JSON.stringify({ toolName: 'query', success: true }),
      provenance,
      null,
      empty,
      'sess_a',
      0.35,
      220,
      'agent-a',
      1,
      1
    );

    insert.run(
      'ev_2',
      now,
      'tool_call',
      JSON.stringify({ toolName: 'run_audit', success: true }),
      provenance,
      null,
      empty,
      'sess_a',
      0.65,
      940,
      'agent-a',
      1,
      0
    );
  } finally {
    db.close();
  }
}

describe('statsCommand', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(async () => {
    logSpy.mockRestore();
    await Promise.all(tempDirs.splice(0, tempDirs.length).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  it('renders json stats summary from evidence ledger', async () => {
    const workspace = await createWorkspace();
    await seedLedger(workspace);

    await statsCommand({
      workspace,
      args: [],
      rawArgs: ['stats', '--json'],
    });

    const payload = logSpy.mock.calls
      .map((call) => String(call[0]))
      .find((line) => line.includes('"LibrarianStats.v1"'));

    expect(payload).toBeTruthy();
    const parsed = JSON.parse(payload!);
    expect(parsed.totals.calls).toBe(2);
    expect(parsed.totals.totalCostUsd).toBeCloseTo(1.0, 4);
    expect(parsed.topExpensiveTools[0].tool).toBe('run_audit');
  });

  it('prints a guidance message when no evidence ledger exists', async () => {
    const workspace = await createWorkspace();

    await statsCommand({
      workspace,
      args: [],
      rawArgs: ['stats'],
    });

    const output = logSpy.mock.calls.map((call) => String(call[0])).join('\n');
    expect(output).toContain('Evidence ledger not found');
  });
});
