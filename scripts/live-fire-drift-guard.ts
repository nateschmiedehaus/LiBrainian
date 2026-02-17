import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

interface MatrixSummaryRun {
  profile: string;
  passed: boolean;
  aggregate: {
    passRate: number;
    meanJourneyPassRate: number;
    meanRetrievedContextRate: number;
    meanBlockingValidationRate: number;
  };
}

interface MatrixSummary {
  runs: MatrixSummaryRun[];
}

interface LatestPointer {
  matrixSummaryPath?: string;
}

function parseRate(raw: string | undefined, fallback: number): number {
  if (!raw || raw.trim().length === 0) return fallback;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`invalid rate value: ${raw}`);
  }
  return parsed;
}

function readJsonFile(filePath: string): unknown {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

function resolveMatrixSummary(pointerPath: string): { pointerPath: string; summaryPath: string; summary: MatrixSummary } {
  const pointer = readJsonFile(pointerPath) as LatestPointer;
  const summaryPath = pointer.matrixSummaryPath
    ? path.resolve(path.dirname(pointerPath), pointer.matrixSummaryPath)
    : pointerPath;
  const summary = readJsonFile(summaryPath) as MatrixSummary;
  if (!Array.isArray(summary.runs)) {
    throw new Error(`invalid matrix summary at ${summaryPath}`);
  }
  return {
    pointerPath,
    summaryPath,
    summary,
  };
}

const args = parseArgs({
  options: {
    'current-pointer': { type: 'string' },
    'baseline-pointer': { type: 'string' },
    'max-pass-rate-drop': { type: 'string' },
    'max-context-rate-drop': { type: 'string' },
    'max-journey-rate-drop': { type: 'string' },
    'require-baseline': { type: 'boolean', default: false },
  },
});

const currentPointerPath = args.values['current-pointer']
  ? path.resolve(args.values['current-pointer'])
  : path.resolve('state/eval/live-fire/latest.json');
const baselinePointerPath = args.values['baseline-pointer']
  ? path.resolve(args.values['baseline-pointer'])
  : path.resolve('state/eval/live-fire/latest.prev.json');
const maxPassRateDrop = parseRate(args.values['max-pass-rate-drop'], 0.05);
const maxContextRateDrop = parseRate(args.values['max-context-rate-drop'], 0.05);
const maxJourneyRateDrop = parseRate(args.values['max-journey-rate-drop'], 0.05);
const requireBaseline = Boolean(args.values['require-baseline']);

const report = {
  schema: 'LiveFireDriftGuardReport.v1',
  createdAt: new Date().toISOString(),
  currentPointerPath,
  baselinePointerPath,
  thresholds: {
    maxPassRateDrop,
    maxContextRateDrop,
    maxJourneyRateDrop,
  },
  comparedProfiles: 0,
  passed: true,
  reasons: [] as string[],
  warnings: [] as string[],
};

if (!fs.existsSync(currentPointerPath)) {
  report.passed = false;
  report.reasons.push(`missing_current_pointer:${currentPointerPath}`);
  console.log(JSON.stringify(report, null, 2));
  process.exit(1);
}

if (!fs.existsSync(baselinePointerPath)) {
  if (requireBaseline) {
    report.passed = false;
    report.reasons.push(`missing_baseline_pointer:${baselinePointerPath}`);
    console.log(JSON.stringify(report, null, 2));
    process.exit(1);
  }
  report.warnings.push(`baseline_pointer_missing:${baselinePointerPath}`);
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

const current = resolveMatrixSummary(currentPointerPath);
const baseline = resolveMatrixSummary(baselinePointerPath);
const currentRuns = new Map(current.summary.runs.map((run) => [run.profile, run]));
const baselineRuns = new Map(baseline.summary.runs.map((run) => [run.profile, run]));

for (const [profile, baselineRun] of baselineRuns.entries()) {
  const currentRun = currentRuns.get(profile);
  if (!currentRun) {
    report.passed = false;
    report.reasons.push(`missing_profile_in_current:${profile}`);
    continue;
  }
  report.comparedProfiles += 1;
  if (baselineRun.passed && !currentRun.passed) {
    report.passed = false;
    report.reasons.push(`profile_regressed_to_fail:${profile}`);
  }

  const passRateDrop = baselineRun.aggregate.passRate - currentRun.aggregate.passRate;
  if (passRateDrop > maxPassRateDrop) {
    report.passed = false;
    report.reasons.push(`pass_rate_drop:${profile}:${passRateDrop.toFixed(3)}`);
  }

  const contextRateDrop = baselineRun.aggregate.meanRetrievedContextRate - currentRun.aggregate.meanRetrievedContextRate;
  if (contextRateDrop > maxContextRateDrop) {
    report.passed = false;
    report.reasons.push(`context_rate_drop:${profile}:${contextRateDrop.toFixed(3)}`);
  }

  const journeyRateDrop = baselineRun.aggregate.meanJourneyPassRate - currentRun.aggregate.meanJourneyPassRate;
  if (journeyRateDrop > maxJourneyRateDrop) {
    report.passed = false;
    report.reasons.push(`journey_rate_drop:${profile}:${journeyRateDrop.toFixed(3)}`);
  }
}

console.log(JSON.stringify(report, null, 2));
process.exit(report.passed ? 0 : 1);
