import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  DEFAULT_COMPOSITION_UTILITY_SCENARIOS,
  type CompositionUtilityReport,
  evaluateCompositionUtility,
} from '../src/evaluation/composition_utility.js';
import {
  evaluateTestingDiscipline,
  type ConstructableDetectionSample,
  type TestingDisciplineThresholds,
} from '../src/evaluation/testing_discipline.js';
import { detectOptimalConstructables } from '../src/constructions/auto_selector.js';
import { safeJsonParse } from '../src/utils/safe_json.js';

function parseNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function loadJson(filePath: string): Promise<unknown> {
  const raw = await readFile(filePath, 'utf8');
  const parsed = safeJsonParse<unknown>(raw);
  if (!parsed.ok) {
    throw new Error(`invalid_json:${filePath}`);
  }
  return parsed.value;
}

function isCompositionUtilityReport(value: unknown): value is CompositionUtilityReport {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<CompositionUtilityReport>;
  return (
    typeof candidate.passRate === 'number'
    && typeof candidate.top1Accuracy === 'number'
    && typeof candidate.top3Recall === 'number'
    && typeof candidate.totalScenarios === 'number'
  );
}

function collectCandidateRepos(useCaseReport: unknown, smokeReport: unknown): string[] {
  const useCaseResults = Array.isArray((useCaseReport as { results?: unknown[] }).results)
    ? ((useCaseReport as { results?: Array<{ repo?: string }> }).results ?? [])
    : [];
  const smokeResults = Array.isArray((smokeReport as { results?: unknown[] }).results)
    ? ((smokeReport as { results?: Array<{ repo?: string }> }).results ?? [])
    : [];

  const repos = [
    ...useCaseResults.map((item) => item.repo),
    ...smokeResults.map((item) => item.repo),
  ].filter((value): value is string => typeof value === 'string' && value.length > 0);

  return Array.from(new Set(repos));
}

async function collectConstructableSamples(
  reposRoot: string,
  repoNames: string[],
  maxRepos: number
): Promise<ConstructableDetectionSample[]> {
  const samples: ConstructableDetectionSample[] = [];
  for (const repo of repoNames.slice(0, maxRepos)) {
    const workspace = path.join(reposRoot, repo);
    try {
      const config = await detectOptimalConstructables(workspace);
      samples.push({
        repo,
        primaryLanguage: config.analysis.primaryLanguage,
        enabledConstructables: config.enabled,
      });
    } catch {
      samples.push({
        repo,
        primaryLanguage: null,
        enabledConstructables: [],
      });
    }
  }
  return samples;
}

const args = parseArgs({
  options: {
    out: { type: 'string', default: 'state/eval/testing-discipline/report.json' },
    abReport: { type: 'string', default: 'eval-results/ab-harness-report.json' },
    useCaseReport: { type: 'string', default: 'eval-results/agentic-use-case-review.json' },
    liveFireReport: { type: 'string', default: 'state/eval/live-fire/hardcore/report.json' },
    externalSmokeReport: { type: 'string', default: 'state/eval/smoke/external/all-repos/report.json' },
    compositionReport: { type: 'string', default: 'state/eval/compositions/CompositionUtilityReport.v1.json' },
    compositionOut: { type: 'string', default: 'state/eval/compositions/CompositionUtilityReport.v1.json' },
    reposRoot: { type: 'string', default: 'eval-corpus/external-repos' },
    maxConstructableRepos: { type: 'string', default: '6' },
    minUseCaseRepos: { type: 'string' },
    minUseCaseIds: { type: 'string' },
    minUseCasePassRate: { type: 'string' },
    minUseCaseEvidenceRate: { type: 'string' },
    minUseCaseUsefulSummaryRate: { type: 'string' },
    maxUseCaseStrictFailureShare: { type: 'string' },
    minLiveFireRuns: { type: 'string' },
    minLiveFireRetrievedContextRate: { type: 'string' },
    maxLiveFireBlockingValidationRate: { type: 'string' },
    minSmokeRepos: { type: 'string' },
    minSmokeLanguages: { type: 'string' },
    minCompositionPassRate: { type: 'string' },
    minCompositionTop1Accuracy: { type: 'string' },
    minCompositionTop3Recall: { type: 'string' },
    minConstructableLanguages: { type: 'string' },
  },
});

const workspaceRoot = process.cwd();
const outPath = path.resolve(workspaceRoot, args.values.out ?? 'state/eval/testing-discipline/report.json');
const abReportPath = path.resolve(workspaceRoot, args.values.abReport ?? 'eval-results/ab-harness-report.json');
const useCaseReportPath = path.resolve(workspaceRoot, args.values.useCaseReport ?? 'eval-results/agentic-use-case-review.json');
const liveFireReportPath = path.resolve(workspaceRoot, args.values.liveFireReport ?? 'state/eval/live-fire/hardcore/report.json');
const externalSmokeReportPath = path.resolve(workspaceRoot, args.values.externalSmokeReport ?? 'state/eval/smoke/external/all-repos/report.json');
const compositionReportPath = path.resolve(workspaceRoot, args.values.compositionReport ?? 'state/eval/compositions/CompositionUtilityReport.v1.json');
const compositionOutPath = path.resolve(workspaceRoot, args.values.compositionOut ?? 'state/eval/compositions/CompositionUtilityReport.v1.json');
const reposRoot = path.resolve(workspaceRoot, args.values.reposRoot ?? 'eval-corpus/external-repos');
const maxConstructableRepos = Math.max(1, Math.floor(parseNumber(args.values.maxConstructableRepos) ?? 6));

const abReport = await loadJson(abReportPath);
const useCaseReport = await loadJson(useCaseReportPath);
const liveFireReport = await loadJson(liveFireReportPath);
const externalSmokeReport = await loadJson(externalSmokeReportPath);
let compositionUtilityReport: CompositionUtilityReport;
let compositionReportSource: 'existing-artifact' | 'computed-default';
let compositionReportExists = true;
try {
  await stat(compositionReportPath);
} catch {
  compositionReportExists = false;
}

if (compositionReportExists) {
  const loadedComposition = await loadJson(compositionReportPath);
  if (!isCompositionUtilityReport(loadedComposition)) {
    throw new Error(`invalid_composition_report:${compositionReportPath}`);
  }
  compositionUtilityReport = loadedComposition;
  compositionReportSource = 'existing-artifact';
} else {
  compositionUtilityReport = evaluateCompositionUtility(DEFAULT_COMPOSITION_UTILITY_SCENARIOS);
  compositionReportSource = 'computed-default';
}

await mkdir(path.dirname(compositionOutPath), { recursive: true });
await writeFile(compositionOutPath, JSON.stringify(compositionUtilityReport, null, 2), 'utf8');

const candidateRepos = collectCandidateRepos(useCaseReport, externalSmokeReport);
const constructableSamples = await collectConstructableSamples(reposRoot, candidateRepos, maxConstructableRepos);

const thresholdOverridesRaw: Partial<TestingDisciplineThresholds> = {
  minUseCaseRepos: parseNumber(args.values.minUseCaseRepos),
  minUseCaseIds: parseNumber(args.values.minUseCaseIds),
  minUseCasePassRate: parseNumber(args.values.minUseCasePassRate),
  minUseCaseEvidenceRate: parseNumber(args.values.minUseCaseEvidenceRate),
  minUseCaseUsefulSummaryRate: parseNumber(args.values.minUseCaseUsefulSummaryRate),
  maxUseCaseStrictFailureShare: parseNumber(args.values.maxUseCaseStrictFailureShare),
  minLiveFireRuns: parseNumber(args.values.minLiveFireRuns),
  minLiveFireRetrievedContextRate: parseNumber(args.values.minLiveFireRetrievedContextRate),
  maxLiveFireBlockingValidationRate: parseNumber(args.values.maxLiveFireBlockingValidationRate),
  minSmokeRepos: parseNumber(args.values.minSmokeRepos),
  minSmokeLanguages: parseNumber(args.values.minSmokeLanguages),
  minCompositionPassRate: parseNumber(args.values.minCompositionPassRate),
  minCompositionTop1Accuracy: parseNumber(args.values.minCompositionTop1Accuracy),
  minCompositionTop3Recall: parseNumber(args.values.minCompositionTop3Recall),
  minConstructableLanguages: parseNumber(args.values.minConstructableLanguages),
};

const thresholdOverrides = Object.fromEntries(
  Object.entries(thresholdOverridesRaw).filter(([, value]) => value !== undefined)
) as Partial<TestingDisciplineThresholds>;

const report = evaluateTestingDiscipline({
  abReport,
  useCaseReport,
  liveFireReport,
  externalSmokeReport,
  compositionUtilityReport,
  constructableSamples,
  thresholds: thresholdOverrides,
});

await mkdir(path.dirname(outPath), { recursive: true });
await writeFile(outPath, JSON.stringify(report, null, 2), 'utf8');

console.log(`Testing-discipline report written to: ${outPath}`);
console.log(`Composition utility source: ${compositionReportSource}`);
console.log(`Checks: ${report.summary.passedChecks}/${report.summary.totalChecks} passed`);
console.log(`Blocking failures: ${report.summary.failedBlockingChecks}`);
console.log(`Warnings: ${report.summary.warningChecks}`);

const failedChecks = report.checks.filter((item) => !item.passed);
if (failedChecks.length > 0) {
  for (const check of failedChecks) {
    console.error(`${check.id}: ${check.observed} (expected ${check.expected})`);
  }
  process.exitCode = 1;
}
