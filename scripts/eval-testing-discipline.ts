import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { detectOptimalConstructables } from '../src/constructions/auto_selector.js';
import {
  evaluateTestingDiscipline,
  type ConstructableDetectionSample,
  type TestingDisciplineThresholds,
} from '../src/evaluation/testing_discipline.js';
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
  maxRepos: number,
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
    useCaseReport: { type: 'string', default: 'eval-results/agentic-use-case-review.json' },
    liveFireReport: { type: 'string', default: 'state/eval/live-fire/hardcore/report.json' },
    externalSmokeReport: { type: 'string', default: 'state/eval/smoke/external/all-repos/report.json' },
    reposRoot: { type: 'string', default: 'eval-corpus/external-repos' },
    maxConstructableRepos: { type: 'string', default: '6' },
    minUseCaseRepos: { type: 'string' },
    minUseCasePassRate: { type: 'string' },
    minUseCaseEvidenceRate: { type: 'string' },
    minUseCaseUsefulSummaryRate: { type: 'string' },
    maxUseCaseStrictFailureShare: { type: 'string' },
    minPrerequisitePassRate: { type: 'string' },
    minTargetPassRate: { type: 'string' },
    minTargetDependencyReadyShare: { type: 'string' },
    minLiveFireRuns: { type: 'string' },
    minSmokeRepos: { type: 'string' },
    minSmokeLanguages: { type: 'string' },
    minConstructableLanguages: { type: 'string' },
  },
});

const workspaceRoot = process.cwd();
const outPath = path.resolve(workspaceRoot, args.values.out ?? 'state/eval/testing-discipline/report.json');
const useCaseReportPath = path.resolve(workspaceRoot, args.values.useCaseReport ?? 'eval-results/agentic-use-case-review.json');
const liveFireReportPath = path.resolve(workspaceRoot, args.values.liveFireReport ?? 'state/eval/live-fire/hardcore/report.json');
const externalSmokeReportPath = path.resolve(workspaceRoot, args.values.externalSmokeReport ?? 'state/eval/smoke/external/all-repos/report.json');
const reposRoot = path.resolve(workspaceRoot, args.values.reposRoot ?? 'eval-corpus/external-repos');
const maxConstructableRepos = Math.max(1, Math.floor(parseNumber(args.values.maxConstructableRepos) ?? 6));

const useCaseReport = await loadJson(useCaseReportPath);
const liveFireReport = await loadJson(liveFireReportPath);
const externalSmokeReport = await loadJson(externalSmokeReportPath);

const candidateRepos = collectCandidateRepos(useCaseReport, externalSmokeReport);
const constructableSamples = await collectConstructableSamples(reposRoot, candidateRepos, maxConstructableRepos);

const thresholdOverridesRaw: Partial<TestingDisciplineThresholds> = {
  minUseCaseRepos: parseNumber(args.values.minUseCaseRepos),
  minUseCasePassRate: parseNumber(args.values.minUseCasePassRate),
  minUseCaseEvidenceRate: parseNumber(args.values.minUseCaseEvidenceRate),
  minUseCaseUsefulSummaryRate: parseNumber(args.values.minUseCaseUsefulSummaryRate),
  maxUseCaseStrictFailureShare: parseNumber(args.values.maxUseCaseStrictFailureShare),
  minPrerequisitePassRate: parseNumber(args.values.minPrerequisitePassRate),
  minTargetPassRate: parseNumber(args.values.minTargetPassRate),
  minTargetDependencyReadyShare: parseNumber(args.values.minTargetDependencyReadyShare),
  minLiveFireRuns: parseNumber(args.values.minLiveFireRuns),
  minSmokeRepos: parseNumber(args.values.minSmokeRepos),
  minSmokeLanguages: parseNumber(args.values.minSmokeLanguages),
  minConstructableLanguages: parseNumber(args.values.minConstructableLanguages),
};

const thresholds = Object.fromEntries(
  Object.entries(thresholdOverridesRaw).filter(([, value]) => value !== undefined),
) as Partial<TestingDisciplineThresholds>;

const report = evaluateTestingDiscipline({
  useCaseReport,
  liveFireReport,
  externalSmokeReport,
  constructableSamples,
  thresholds,
});

await mkdir(path.dirname(outPath), { recursive: true });
await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

console.log(`Testing-discipline report written to: ${outPath}`);
console.log(`Checks: ${report.summary.passedChecks}/${report.summary.totalChecks} passed`);
console.log(`Blocking failures: ${report.summary.failedBlockingChecks}`);
console.log(`Warnings: ${report.summary.warningChecks}`);

const failedChecks = report.checks.filter((check) => !check.passed);
if (failedChecks.length > 0) {
  for (const check of failedChecks) {
    console.error(`${check.id}: ${check.observed} (expected ${check.expected})`);
  }
  process.exitCode = 1;
}
