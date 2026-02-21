import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { execSync } from 'node:child_process';
import {
  runSelfUnderstandingEvaluation,
  type SelfUnderstandingEvaluationReport,
} from '../src/evaluation/self_understanding.js';

interface SelfUnderstandingHistoryEntry {
  generatedAt: string;
  commitSha?: string;
  totalQuestions: number;
  overallAccuracy: number;
  callersAccuracy: number;
  implementationAccuracy: number;
  thresholdsPassed: boolean;
}

interface SelfUnderstandingHistory {
  kind: 'SelfUnderstandingHistory.v1';
  runs: SelfUnderstandingHistoryEntry[];
}

interface SelfUnderstandingReportArtifact {
  kind: 'SelfUnderstandingReport.v1';
  generatedAt: string;
  workspace: string;
  repoName: string;
  commitSha?: string;
  totalQuestions: number;
  thresholdsPassed: boolean;
  thresholds: SelfUnderstandingEvaluationReport['thresholds'];
  overall: SelfUnderstandingEvaluationReport['overall'];
  callers: SelfUnderstandingEvaluationReport['callers'];
  implementation: SelfUnderstandingEvaluationReport['implementation'];
  dashboard: SelfUnderstandingEvaluationReport['dashboard'];
  trend: {
    baselineGeneratedAt?: string;
    deltaOverallAccuracy?: number;
    deltaCallersAccuracy?: number;
    deltaImplementationAccuracy?: number;
  };
  queryResults: SelfUnderstandingEvaluationReport['queryResults'];
}

function parseOptionalNumber(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function resolveCommitSha(raw: string | undefined): string | undefined {
  if (raw && raw.trim().length > 0) {
    return raw.trim();
  }

  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return undefined;
  }
}

async function loadHistory(historyPath: string): Promise<SelfUnderstandingHistory> {
  try {
    const raw = await readFile(historyPath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed
      && typeof parsed === 'object'
      && (parsed as { kind?: unknown }).kind === 'SelfUnderstandingHistory.v1'
      && Array.isArray((parsed as { runs?: unknown }).runs)
    ) {
      return parsed as SelfUnderstandingHistory;
    }
  } catch {
    // no-op
  }

  return {
    kind: 'SelfUnderstandingHistory.v1',
    runs: [],
  };
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function buildMarkdownReport(report: SelfUnderstandingReportArtifact): string {
  const lines: string[] = [];
  lines.push('# Self-Understanding Evaluation', '');
  lines.push(`- Generated: ${report.generatedAt}`);
  lines.push(`- Workspace: ${report.workspace}`);
  lines.push(`- Repo: ${report.repoName}`);
  if (report.commitSha) {
    lines.push(`- Commit: ${report.commitSha}`);
  }
  lines.push(`- Questions evaluated: ${report.totalQuestions}`);
  lines.push(`- Thresholds passed: ${report.thresholdsPassed ? 'yes' : 'no'}`, '');

  lines.push('## Scores');
  lines.push(`- Overall: ${formatPercent(report.overall.accuracy)} (${report.overall.passed}/${report.overall.total})`);
  lines.push(`- Callers: ${formatPercent(report.callers.accuracy)} (${report.callers.passed}/${report.callers.total})`);
  lines.push(
    `- Implementation: ${formatPercent(report.implementation.accuracy)} (${report.implementation.passed}/${report.implementation.total})`
  );
  lines.push(
    `- Thresholds: callers >= ${formatPercent(report.thresholds.callersMinAccuracy)}, implementation >= ${formatPercent(report.thresholds.implementationMinAccuracy)}`
  );

  if (typeof report.trend.deltaOverallAccuracy === 'number') {
    lines.push('', '## Trend vs Previous Run');
    lines.push(`- Previous run: ${report.trend.baselineGeneratedAt ?? 'unknown'}`);
    lines.push(`- Delta overall: ${formatPercent(report.trend.deltaOverallAccuracy)}`);
    lines.push(`- Delta callers: ${formatPercent(report.trend.deltaCallersAccuracy ?? 0)}`);
    lines.push(
      `- Delta implementation: ${formatPercent(report.trend.deltaImplementationAccuracy ?? 0)}`
    );
  }

  return lines.join('\n');
}

const args = parseArgs({
  options: {
    workspace: { type: 'string' },
    repoName: { type: 'string' },
    minQuestions: { type: 'string', default: '50' },
    maxQuestions: { type: 'string' },
    minTokenRecall: { type: 'string' },
    queryDepth: { type: 'string', default: 'L1' },
    queryTokenBudget: { type: 'string', default: '800' },
    maxFactsPerType: { type: 'string', default: '250' },
    timeoutMs: { type: 'string', default: '45000' },
    skipEmbeddings: { type: 'boolean', default: false },
    autoBootstrap: { type: 'boolean', default: false },
    callersMinAccuracy: { type: 'string', default: '0.8' },
    implementationMinAccuracy: { type: 'string', default: '0.7' },
    artifact: { type: 'string', default: 'state/eval/self-understanding/report.json' },
    history: { type: 'string', default: 'state/eval/self-understanding/history.json' },
    markdown: { type: 'string', default: 'state/eval/self-understanding/report.md' },
    commitSha: { type: 'string' },
  },
});

const workspace = path.resolve(args.values.workspace ?? process.cwd());
const repoName = args.values.repoName;
const artifactPath = path.resolve(workspace, args.values.artifact ?? 'state/eval/self-understanding/report.json');
const historyPath = path.resolve(workspace, args.values.history ?? 'state/eval/self-understanding/history.json');
const markdownPath = path.resolve(workspace, args.values.markdown ?? 'state/eval/self-understanding/report.md');
const commitSha = resolveCommitSha(args.values.commitSha);

async function main(): Promise<void> {
  const evaluation = await runSelfUnderstandingEvaluation({
    workspace,
    repoName,
    minQuestions: parseOptionalNumber(args.values.minQuestions) ?? 50,
    maxQuestions: parseOptionalNumber(args.values.maxQuestions),
    minTokenRecall: parseOptionalNumber(args.values.minTokenRecall),
    queryDepth:
      args.values.queryDepth === 'L0'
      || args.values.queryDepth === 'L1'
      || args.values.queryDepth === 'L2'
      || args.values.queryDepth === 'L3'
        ? args.values.queryDepth
        : 'L1',
    queryTokenBudget: parseOptionalNumber(args.values.queryTokenBudget),
    maxFactsPerType: parseOptionalNumber(args.values.maxFactsPerType),
    timeoutMs: parseOptionalNumber(args.values.timeoutMs) ?? 45_000,
    skipEmbeddings: args.values.skipEmbeddings ?? false,
    autoBootstrap: args.values.autoBootstrap ?? false,
    thresholds: {
      callersMinAccuracy: parseOptionalNumber(args.values.callersMinAccuracy) ?? 0.8,
      implementationMinAccuracy: parseOptionalNumber(args.values.implementationMinAccuracy) ?? 0.7,
    },
  });

  const history = await loadHistory(historyPath);
  const previous = history.runs.at(-1);

  const artifact: SelfUnderstandingReportArtifact = {
    ...evaluation,
    commitSha,
    trend: {
      baselineGeneratedAt: previous?.generatedAt,
      deltaOverallAccuracy:
        typeof previous?.overallAccuracy === 'number'
          ? evaluation.overall.accuracy - previous.overallAccuracy
          : undefined,
      deltaCallersAccuracy:
        typeof previous?.callersAccuracy === 'number'
          ? evaluation.callers.accuracy - previous.callersAccuracy
          : undefined,
      deltaImplementationAccuracy:
        typeof previous?.implementationAccuracy === 'number'
          ? evaluation.implementation.accuracy - previous.implementationAccuracy
          : undefined,
    },
  };

  history.runs.push({
    generatedAt: evaluation.generatedAt,
    commitSha,
    totalQuestions: evaluation.totalQuestions,
    overallAccuracy: evaluation.overall.accuracy,
    callersAccuracy: evaluation.callers.accuracy,
    implementationAccuracy: evaluation.implementation.accuracy,
    thresholdsPassed: evaluation.thresholdsPassed,
  });

  await mkdir(path.dirname(artifactPath), { recursive: true });
  await mkdir(path.dirname(historyPath), { recursive: true });
  await mkdir(path.dirname(markdownPath), { recursive: true });
  await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  await writeFile(historyPath, `${JSON.stringify(history, null, 2)}\n`, 'utf8');
  await writeFile(markdownPath, `${buildMarkdownReport(artifact)}\n`, 'utf8');

  console.log(`Self-understanding report: ${artifactPath}`);
  console.log(`Self-understanding history: ${historyPath}`);
  console.log(`Self-understanding markdown: ${markdownPath}`);
  console.log(`Questions: ${evaluation.totalQuestions}`);
  console.log(`Callers accuracy: ${formatPercent(evaluation.callers.accuracy)}`);
  console.log(`Implementation accuracy: ${formatPercent(evaluation.implementation.accuracy)}`);

  if (!evaluation.thresholdsPassed) {
    console.error(
      `self_understanding_threshold_failed: callers=${formatPercent(evaluation.callers.accuracy)} (min ${formatPercent(
        evaluation.thresholds.callersMinAccuracy
      )}), implementation=${formatPercent(evaluation.implementation.accuracy)} (min ${formatPercent(
        evaluation.thresholds.implementationMinAccuracy
      )})`
    );
    process.exitCode = 1;
  }
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`self_understanding_run_failed: ${message}`);
  process.exitCode = 1;
}
