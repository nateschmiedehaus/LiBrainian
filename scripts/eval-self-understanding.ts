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
  type SelfUnderstandingReport,
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

function sanitizeReasonValue(value: string): string {
  return value
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9:_./-]/g, '')
    .slice(0, 240);
}

function createFailureReport(
  workspace: string,
  repoName: string,
  minQuestionCount: number,
  reasonPrefix: string,
  error: unknown
): SelfUnderstandingReport {
  const details = error instanceof Error && error.message.trim().length > 0 ? error.message : 'unknown_error';
  return {
    schema: 'SelfUnderstandingReport.v1',
    generatedAt: new Date().toISOString(),
    workspace,
    repoName,
    generatedQuestionCount: 0,
    evaluatedQuestionCount: 0,
    thresholds: {
      minQuestionCount,
      callersAccuracy: 0.8,
      implementationAccuracy: 0.7,
      perQuestionCallersScore: 0.8,
      perQuestionImplementationScore: 0.7,
      perQuestionGeneralScore: 0.6,
    },
    metrics: {
      overallAccuracy: 0,
      callersAccuracy: 0,
      implementationAccuracy: 0,
    },
    summary: {
      passed: false,
      reasons: [
        `question_count_below_threshold:0<${minQuestionCount}`,
        `${reasonPrefix}:${sanitizeReasonValue(details)}`,
      ],
    },
    results: [],
  };
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
    answerTimeoutMs: { type: 'string', default: '45000' },
    bootstrapTimeoutMs: { type: 'string', default: '120000' },
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
const answerTimeoutMs = parseNumber(args.values.answerTimeoutMs, 45000);
const bootstrapTimeoutMs = parseNumber(args.values.bootstrapTimeoutMs, 120000);
const commitSha = resolveCommitSha(workspace, args.values.commit);
if (!process.env.LIBRARIAN_BOOTSTRAP_BACKUP_MAX_BYTES && !process.env.LIBRAINIAN_BOOTSTRAP_BACKUP_MAX_BYTES) {
  process.env.LIBRARIAN_BOOTSTRAP_BACKUP_MAX_BYTES = String(256 * 1024 * 1024);
}

let report: SelfUnderstandingReport;
let session: Awaited<ReturnType<typeof initializeLibrarian>> | undefined;
try {
  session = await initializeLibrarian(workspace, {
    silent: true,
    skipWatcher: true,
    skipHealing: true,
    bootstrapTimeoutMs,
  });
  try {
    report = await evaluateSelfUnderstanding({
      workspace,
      repoName,
      minQuestionCount: minQuestions,
      maxQuestionCount: maxQuestions,
      answerTimeoutMs,
      answerQuestion: async (intent) => session.query(intent),
    });
  } catch (error) {
    report = createFailureReport(workspace, repoName, minQuestions, 'evaluation_failure', error);
  }
} catch (error) {
  report = createFailureReport(workspace, repoName, minQuestions, 'initialization_failure', error);
} finally {
  await session?.shutdown().catch(() => undefined);
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
