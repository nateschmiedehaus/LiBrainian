import { parseArgs } from 'node:util';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { runAgenticUseCaseReview, type AgenticUseCaseEvidenceProfile } from '../src/evaluation/agentic_use_case_review.js';

function parseNumber(value: string | undefined): number | undefined {
  if (!value || value.trim().length === 0) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseList(value: string | undefined): string[] | undefined {
  if (!value || value.trim().length === 0) return undefined;
  const list = value.split(',').map((item) => item.trim()).filter(Boolean);
  return list.length > 0 ? list : undefined;
}

const args = parseArgs({
  options: {
    reposRoot: { type: 'string', default: 'eval-corpus/external-repos' },
    matrixPath: { type: 'string', default: 'docs/librarian/USE_CASE_MATRIX.md' },
    out: { type: 'string', default: 'eval-results/agentic-use-case-review.json' },
    maxRepos: { type: 'string' },
    maxUseCases: { type: 'string' },
    ucStart: { type: 'string' },
    ucEnd: { type: 'string' },
    repoNames: { type: 'string' },
    selectionMode: { type: 'string', default: 'probabilistic' },
    evidenceProfile: { type: 'string', default: 'custom' },
    uncertaintyHistoryPath: { type: 'string' },
    progressive: { type: 'boolean', default: true },
    deterministicQueries: { type: 'boolean', default: false },
    explorationIntentsPerRepo: { type: 'string' },
    minPassRate: { type: 'string' },
    minEvidenceRate: { type: 'string' },
    minUsefulSummaryRate: { type: 'string' },
    maxStrictFailureShare: { type: 'string' },
    minPrerequisitePassRate: { type: 'string' },
    minTargetPassRate: { type: 'string' },
    minTargetDependencyReadyShare: { type: 'string' },
    artifactRoot: { type: 'string', default: 'state/eval/use-case-review' },
    runLabel: { type: 'string' },
    initTimeoutMs: { type: 'string' },
    queryTimeoutMs: { type: 'string' },
  },
});

const selectionModeRaw = (args.values.selectionMode ?? 'probabilistic').trim().toLowerCase();
if (
  selectionModeRaw !== 'balanced'
  && selectionModeRaw !== 'sequential'
  && selectionModeRaw !== 'uncertainty'
  && selectionModeRaw !== 'adaptive'
  && selectionModeRaw !== 'probabilistic'
) {
  throw new Error(`invalid_selection_mode:${selectionModeRaw}`);
}
const evidenceProfileRaw = (args.values.evidenceProfile ?? 'custom').trim().toLowerCase();
if (
  evidenceProfileRaw !== 'release'
  && evidenceProfileRaw !== 'quick'
  && evidenceProfileRaw !== 'diagnostic'
  && evidenceProfileRaw !== 'custom'
) {
  throw new Error(`invalid_evidence_profile:${evidenceProfileRaw}`);
}

const reposRoot = path.resolve(process.cwd(), args.values.reposRoot ?? 'eval-corpus/external-repos');
const matrixPath = path.resolve(process.cwd(), args.values.matrixPath ?? 'docs/librarian/USE_CASE_MATRIX.md');
const outPath = path.resolve(process.cwd(), args.values.out ?? 'eval-results/agentic-use-case-review.json');
const artifactRoot = path.resolve(process.cwd(), args.values.artifactRoot ?? 'state/eval/use-case-review');
const thresholdValues = {
  minPassRate: parseNumber(args.values.minPassRate),
  minEvidenceRate: parseNumber(args.values.minEvidenceRate),
  minUsefulSummaryRate: parseNumber(args.values.minUsefulSummaryRate),
  maxStrictFailureShare: parseNumber(args.values.maxStrictFailureShare),
  minPrerequisitePassRate: parseNumber(args.values.minPrerequisitePassRate),
  minTargetPassRate: parseNumber(args.values.minTargetPassRate),
  minTargetDependencyReadyShare: parseNumber(args.values.minTargetDependencyReadyShare),
};
const thresholdOverrides = Object.fromEntries(
  Object.entries(thresholdValues).filter(([, value]) => typeof value === 'number' && Number.isFinite(value))
);

const report = await runAgenticUseCaseReview({
  reposRoot,
  matrixPath,
  maxRepos: parseNumber(args.values.maxRepos),
  maxUseCases: parseNumber(args.values.maxUseCases),
  ucStart: parseNumber(args.values.ucStart),
  ucEnd: parseNumber(args.values.ucEnd),
  repoNames: parseList(args.values.repoNames),
  selectionMode: selectionModeRaw as 'balanced' | 'sequential' | 'uncertainty' | 'adaptive' | 'probabilistic',
  evidenceProfile: evidenceProfileRaw as AgenticUseCaseEvidenceProfile,
  uncertaintyHistoryPath: args.values.uncertaintyHistoryPath
    ? path.resolve(process.cwd(), args.values.uncertaintyHistoryPath)
    : undefined,
  progressivePrerequisites: args.values.progressive ?? true,
  deterministicQueries: args.values.deterministicQueries ?? false,
  explorationIntentsPerRepo: parseNumber(args.values.explorationIntentsPerRepo),
  thresholds: thresholdOverrides,
  artifactRoot,
  runLabel: args.values.runLabel,
  initTimeoutMs: parseNumber(args.values.initTimeoutMs),
  queryTimeoutMs: parseNumber(args.values.queryTimeoutMs),
});

await mkdir(path.dirname(outPath), { recursive: true });
await writeFile(outPath, JSON.stringify(report, null, 2), 'utf8');

console.log(`Agentic use-case review report written to: ${outPath}`);
console.log(`Runs: ${report.summary.totalRuns}`);
console.log(`Evidence profile: ${report.options.evidenceProfile}`);
console.log(`Pass rate: ${(report.summary.passRate * 100).toFixed(1)}%`);
console.log(`Evidence rate: ${(report.summary.evidenceRate * 100).toFixed(1)}%`);
console.log(`Useful summary rate: ${(report.summary.usefulSummaryRate * 100).toFixed(1)}%`);
console.log(`Strict failure share: ${(report.summary.strictFailureShare * 100).toFixed(1)}%`);
console.log(`Exploration runs: ${report.exploration.summary.totalRuns}`);
console.log(`Exploration success rate: ${(report.exploration.summary.successRate * 100).toFixed(1)}%`);
console.log(`Exploration repo coverage: ${report.exploration.summary.uniqueReposCovered}`);
console.log(`Progressive enabled: ${report.summary.progression.enabled}`);
console.log(`Prerequisite pass rate: ${(report.summary.progression.prerequisitePassRate * 100).toFixed(1)}%`);
console.log(`Target pass rate: ${(report.summary.progression.targetPassRate * 100).toFixed(1)}%`);
console.log(`Target dependency-ready share: ${(report.summary.progression.targetDependencyReadyShare * 100).toFixed(1)}%`);
console.log(`Gate: ${report.gate.passed ? 'passed' : 'failed'}`);

if (!report.gate.passed) {
  console.log(`Gate reasons: ${report.gate.reasons.join(', ')}`);
  process.exitCode = 1;
}
