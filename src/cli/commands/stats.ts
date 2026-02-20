import { parseArgs } from 'node:util';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { resolveDbPath } from '../db_path.js';

export interface StatsCommandOptions {
  workspace: string;
  args: string[];
  rawArgs: string[];
}

interface ToolSummary {
  tool: string;
  calls: number;
  totalCostUsd: number;
  avgDurationMs: number;
  cacheHits: number;
}

interface DailySummary {
  day: string;
  calls: number;
  totalCostUsd: number;
  avgDurationMs: number;
}

interface StatsReport {
  kind: 'LibrarianStats.v1';
  generatedAt: string;
  workspace: string;
  windowDays: number;
  totals: {
    calls: number;
    totalCostUsd: number;
    avgDurationMs: number;
    cacheHitRate: number;
  };
  topExpensiveTools: ToolSummary[];
  daily: DailySummary[];
  recommendations: string[];
}

export async function statsCommand(options: StatsCommandOptions): Promise<void> {
  const { workspace, rawArgs } = options;
  const { values } = parseArgs({
    args: rawArgs.slice(1),
    options: {
      days: { type: 'string' },
      limit: { type: 'string' },
      json: { type: 'boolean', default: false },
    },
    allowPositionals: true,
    strict: false,
  });

  const windowDays = clampInteger(values.days as string | undefined, 7, 1, 365);
  const limit = clampInteger(values.limit as string | undefined, 5, 1, 50);
  const workspacePath = path.resolve(workspace);

  const dbPath = await resolveDbPath(workspacePath);
  const ledgerPath = path.join(path.dirname(dbPath), 'evidence_ledger.db');

  try {
    await fs.access(ledgerPath);
  } catch {
    const message = `Evidence ledger not found at ${ledgerPath}. Run MCP-backed flows first to collect stats.`;
    if (values.json) {
      console.log(JSON.stringify({ kind: 'LibrarianStats.v1', error: message }, null, 2));
      return;
    }
    console.log(message);
    return;
  }

  const BetterSqlite3 = (await import('better-sqlite3')).default;
  const db = new BetterSqlite3(ledgerPath, { readonly: true });

  try {
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();

    const totalsRow = db.prepare(
      `
      SELECT
        COUNT(*) AS calls,
        COALESCE(SUM(COALESCE(cost_usd, 0)), 0) AS total_cost_usd,
        COALESCE(AVG(COALESCE(duration_ms, 0)), 0) AS avg_duration_ms,
        COALESCE(SUM(CASE WHEN cache_hit = 1 THEN 1 ELSE 0 END), 0) AS cache_hits
      FROM evidence_ledger
      WHERE kind = 'tool_call' AND timestamp >= ?
    `
    ).get(since) as {
      calls: number;
      total_cost_usd: number;
      avg_duration_ms: number;
      cache_hits: number;
    };

    const topExpensiveTools = db.prepare(
      `
      SELECT
        COALESCE(json_extract(payload, '$.toolName'), 'unknown') AS tool,
        COUNT(*) AS calls,
        COALESCE(SUM(COALESCE(cost_usd, 0)), 0) AS total_cost_usd,
        COALESCE(AVG(COALESCE(duration_ms, 0)), 0) AS avg_duration_ms,
        COALESCE(SUM(CASE WHEN cache_hit = 1 THEN 1 ELSE 0 END), 0) AS cache_hits
      FROM evidence_ledger
      WHERE kind = 'tool_call' AND timestamp >= ?
      GROUP BY tool
      ORDER BY total_cost_usd DESC, avg_duration_ms DESC
      LIMIT ?
    `
    ).all(since, limit) as Array<{
      tool: string;
      calls: number;
      total_cost_usd: number;
      avg_duration_ms: number;
      cache_hits: number;
    }>;

    const daily = db.prepare(
      `
      SELECT
        substr(timestamp, 1, 10) AS day,
        COUNT(*) AS calls,
        COALESCE(SUM(COALESCE(cost_usd, 0)), 0) AS total_cost_usd,
        COALESCE(AVG(COALESCE(duration_ms, 0)), 0) AS avg_duration_ms
      FROM evidence_ledger
      WHERE kind = 'tool_call' AND timestamp >= ?
      GROUP BY day
      ORDER BY day DESC
    `
    ).all(since) as Array<{
      day: string;
      calls: number;
      total_cost_usd: number;
      avg_duration_ms: number;
    }>;

    const calls = Math.max(0, Number(totalsRow.calls ?? 0));
    const cacheHits = Math.max(0, Number(totalsRow.cache_hits ?? 0));
    const report: StatsReport = {
      kind: 'LibrarianStats.v1',
      generatedAt: new Date().toISOString(),
      workspace: workspacePath,
      windowDays,
      totals: {
        calls,
        totalCostUsd: roundMoney(totalsRow.total_cost_usd),
        avgDurationMs: roundNumber(totalsRow.avg_duration_ms),
        cacheHitRate: calls > 0 ? roundNumber(cacheHits / calls) : 0,
      },
      topExpensiveTools: topExpensiveTools.map((row) => ({
        tool: row.tool,
        calls: Number(row.calls),
        totalCostUsd: roundMoney(row.total_cost_usd),
        avgDurationMs: roundNumber(row.avg_duration_ms),
        cacheHits: Number(row.cache_hits),
      })),
      daily: daily.map((row) => ({
        day: row.day,
        calls: Number(row.calls),
        totalCostUsd: roundMoney(row.total_cost_usd),
        avgDurationMs: roundNumber(row.avg_duration_ms),
      })),
      recommendations: buildRecommendations({
        calls,
        totalCostUsd: roundMoney(totalsRow.total_cost_usd),
        avgDurationMs: roundNumber(totalsRow.avg_duration_ms),
        topExpensiveTools: topExpensiveTools.map((row) => ({
          tool: row.tool,
          calls: Number(row.calls),
          totalCostUsd: roundMoney(row.total_cost_usd),
          avgDurationMs: roundNumber(row.avg_duration_ms),
          cacheHits: Number(row.cache_hits),
        })),
      }),
    };

    if (values.json) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    console.log('Librarian Stats');
    console.log('==============\n');
    console.log(`Workspace: ${report.workspace}`);
    console.log(`Window: last ${report.windowDays} day(s)`);
    console.log(`Total tool calls: ${report.totals.calls}`);
    console.log(`Estimated cost: $${report.totals.totalCostUsd.toFixed(4)}`);
    console.log(`Average duration: ${report.totals.avgDurationMs.toFixed(1)}ms`);
    console.log(`Cache hit rate: ${(report.totals.cacheHitRate * 100).toFixed(1)}%`);

    console.log('\nTop expensive tools:');
    if (report.topExpensiveTools.length === 0) {
      console.log('  - No tool_call entries in selected window');
    } else {
      for (const tool of report.topExpensiveTools) {
        console.log(
          `  - ${tool.tool}: $${tool.totalCostUsd.toFixed(4)} across ${tool.calls} calls (avg ${tool.avgDurationMs.toFixed(1)}ms)`
        );
      }
    }

    if (report.recommendations.length > 0) {
      console.log('\nRecommendations:');
      for (const recommendation of report.recommendations) {
        console.log(`  - ${recommendation}`);
      }
    }
  } finally {
    db.close();
  }
}

function buildRecommendations(input: {
  calls: number;
  totalCostUsd: number;
  avgDurationMs: number;
  topExpensiveTools: ToolSummary[];
}): string[] {
  const recommendations: string[] = [];
  if (input.calls === 0) {
    recommendations.push('No tool-call telemetry yet. Run MCP flows and re-check `librarian stats`.');
    return recommendations;
  }
  if (input.totalCostUsd >= 1) {
    recommendations.push(`Last-window spend is $${input.totalCostUsd.toFixed(2)}; inspect top tools for optimization opportunities.`);
  }
  if (input.avgDurationMs > 1200) {
    recommendations.push('Average tool duration exceeds 1.2s; run `librarian doctor --json` and check storage/provider health.');
  }
  const topTool = input.topExpensiveTools[0];
  if (topTool && topTool.totalCostUsd > 0) {
    recommendations.push(`Highest cost tool is \`${topTool.tool}\`; prioritize cache and retrieval tuning there first.`);
  }
  return recommendations;
}

function clampInteger(value: string | undefined, fallback: number, min: number, max: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 10000) / 10000;
}

function roundNumber(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}
