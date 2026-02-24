import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { initializeLibrarian } from '../src/orchestrator/index.js';
import {
  evaluateSelfUnderstanding,
  renderSelfUnderstandingDashboard,
  toSelfUnderstandingHistoryEntry,
  type SelfUnderstandingHistoryEntry,
} from '../src/evaluation/self_understanding.js';

function parseNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.floor(parsed));
}

async function readHistory(historyPath: string): Promise<SelfUnderstandingHistoryEntry[]> {
  try {
    const raw = await readFile(historyPath, 'utf8');
    return raw
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as SelfUnderstandingHistoryEntry)
      .filter((entry) => typeof entry.generatedAt === 'string');
  } catch {
    return [];
  }
}

function resolveCommitSha(workspace: string, explicitCommit: string | undefined): string | undefined {
  if (explicitCommit && explicitCommit.trim().length > 0) {
    return explicitCommit.trim();
  }
  const result = spawnSync('git', ['-C', workspace, 'rev-parse', '--short', 'HEAD'], {
    encoding: 'utf8',
    stdio: 'pipe',
  });
  if ((result.status ?? 1) !== 0) return undefined;
  const value = result.stdout.trim();
  return value.length > 0 ? value : undefined;
}

const args = parseArgs({
  options: {
    workspace: { type: 'string', default: process.cwd() },
    repoName: { type: 'string', default: 'librarian' },
    out: { type: 'string', default: 'state/eval/self-understanding/report.json' },
    history: { type: 'string', default: 'state/eval/self-understanding/history.jsonl' },
    dashboard: { type: 'string', default: 'state/eval/self-understanding/dashboard.md' },
    minQuestions: { type: 'string', default: '50' },
    maxQuestions: { type: 'string', default: '60' },
    commit: { type: 'string' },
  },
});

const workspace = path.resolve(args.values.workspace ?? process.cwd());
const repoName = args.values.repoName ?? 'librarian';
const outPath = path.resolve(process.cwd(), args.values.out ?? 'state/eval/self-understanding/report.json');
const historyPath = path.resolve(process.cwd(), args.values.history ?? 'state/eval/self-understanding/history.jsonl');
const dashboardPath = path.resolve(
  process.cwd(),
  args.values.dashboard ?? 'state/eval/self-understanding/dashboard.md'
);
const minQuestions = parseNumber(args.values.minQuestions, 50);
const maxQuestions = parseNumber(args.values.maxQuestions, Math.max(60, minQuestions));
const commitSha = resolveCommitSha(workspace, args.values.commit);

const session = await initializeLibrarian(workspace, {
  silent: true,
  skipWatcher: true,
  skipHealing: true,
});

let report;
try {
  report = await evaluateSelfUnderstanding({
    workspace,
    repoName,
    minQuestionCount: minQuestions,
    maxQuestionCount: maxQuestions,
    answerQuestion: async (intent) => session.query(intent),
  });
} finally {
  await session.shutdown().catch(() => undefined);
}

await mkdir(path.dirname(outPath), { recursive: true });
await writeFile(outPath, JSON.stringify(report, null, 2), 'utf8');

const historyEntry = toSelfUnderstandingHistoryEntry(report, commitSha);
await mkdir(path.dirname(historyPath), { recursive: true });
await appendFile(historyPath, `${JSON.stringify(historyEntry)}\n`, 'utf8');
const history = await readHistory(historyPath);

const dashboard = renderSelfUnderstandingDashboard(report, history);
await mkdir(path.dirname(dashboardPath), { recursive: true });
await writeFile(dashboardPath, dashboard, 'utf8');

console.log(`Self-understanding report written to: ${outPath}`);
console.log(`Self-understanding history written to: ${historyPath}`);
console.log(`Self-understanding dashboard written to: ${dashboardPath}`);
console.log(`Question count: ${report.generatedQuestionCount} generated / ${report.evaluatedQuestionCount} evaluated`);
console.log(`Overall accuracy: ${report.metrics.overallAccuracy.toFixed(3)}`);
console.log(`Callers accuracy: ${report.metrics.callersAccuracy.toFixed(3)}`);
console.log(`Implementation accuracy: ${report.metrics.implementationAccuracy.toFixed(3)}`);
console.log(`Gate: ${report.summary.passed ? 'pass' : 'fail'}`);

if (!report.summary.passed) {
  for (const reason of report.summary.reasons) {
    console.error(reason);
  }
  process.exitCode = 1;
}
