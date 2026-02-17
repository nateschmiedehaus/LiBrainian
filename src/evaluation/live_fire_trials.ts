import path from 'node:path';
import { runAgenticJourney, type JourneyLlmMode, type JourneyProtocol } from './agentic_journey.js';
import { runExternalRepoSmoke } from './external_repo_smoke.js';
import {
  classifyGateReasons,
  countByCategory,
  countBySeverity,
  type ClassifiedGateReason,
  type GateReasonCategory,
  type GateReasonSeverity,
} from './reason_taxonomy.js';

export interface LiveFireTrialOptions {
  reposRoot: string;
  rounds?: number;
  maxRepos?: number;
  repoNames?: string[];
  llmModes?: JourneyLlmMode[];
  deterministic?: boolean;
  protocol?: JourneyProtocol;
  strictObjective?: boolean;
  includeSmoke?: boolean;
  minJourneyPassRate?: number;
  minRetrievedContextRate?: number;
  maxBlockingValidationRate?: number;
  journeyTimeoutMs?: number;
  smokeTimeoutMs?: number;
  artifactRoot?: string;
}

export interface LiveFireJourneyStats {
  total: number;
  failures: number;
  passRate: number;
  retrievedContextRate: number;
  blockingValidationRate: number;
  providerPrerequisiteFailures: number;
  validationPrerequisiteFailures: number;
  unverifiedTraceErrors: number;
  fallbackContextSelections: number;
  failedRepos: string[];
}

export interface LiveFireSmokeStats {
  total: number;
  failures: number;
  passRate: number;
  failedRepos: string[];
}

export interface LiveFireRunResult {
  round: number;
  llmMode: JourneyLlmMode;
  journey: LiveFireJourneyStats;
  smoke?: LiveFireSmokeStats;
  journeyArtifacts?: {
    root: string;
    reportPath: string;
    repoReportPaths: string[];
  };
  smokeArtifacts?: {
    root: string;
    reportPath: string;
    repoReportPaths: string[];
  };
  passed: boolean;
  reasons: string[];
}

export interface LiveFireAggregate {
  totalRuns: number;
  passingRuns: number;
  passRate: number;
  meanJourneyPassRate: number;
  meanRetrievedContextRate: number;
  meanBlockingValidationRate: number;
  meanSmokePassRate?: number;
  reasonCounts: Record<string, number>;
  failedRepos: string[];
}

export interface LiveFireGateResult {
  passed: boolean;
  reasons: string[];
  classifiedReasons: ClassifiedGateReason[];
  severityCounts: Record<GateReasonSeverity, number>;
  categoryCounts: Record<GateReasonCategory, number>;
}

export interface LiveFireTrialReport {
  schema: 'LiveFireTrialReport.v1';
  createdAt: string;
  options: {
    reposRoot: string;
    rounds: number;
    maxRepos?: number;
    repoNames?: string[];
    llmModes: JourneyLlmMode[];
    deterministic: boolean;
    protocol: JourneyProtocol;
    strictObjective: boolean;
    includeSmoke: boolean;
    minJourneyPassRate: number;
    minRetrievedContextRate: number;
    maxBlockingValidationRate: number;
    journeyTimeoutMs: number;
    smokeTimeoutMs: number;
    artifactRoot?: string;
  };
  runs: LiveFireRunResult[];
  aggregate: LiveFireAggregate;
  gates: LiveFireGateResult;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values));
}

function countReasons(runs: LiveFireRunResult[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const run of runs) {
    for (const reason of run.reasons) {
      counts[reason] = (counts[reason] ?? 0) + 1;
    }
  }
  return counts;
}

function resolveLlmModes(raw?: JourneyLlmMode[]): JourneyLlmMode[] {
  if (!raw || raw.length === 0) return ['disabled'];
  const filtered = raw.filter((mode): mode is JourneyLlmMode => mode === 'disabled' || mode === 'optional');
  return filtered.length > 0 ? dedupe(filtered) as JourneyLlmMode[] : ['disabled'];
}

function normalizeTimeout(raw: number | undefined, fallback: number): number {
  if (!Number.isFinite(raw) || (raw ?? 0) <= 0) return fallback;
  return Math.floor(raw as number);
}

function sanitizePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
}

function hasCompleteRunArtifacts(
  artifacts: LiveFireRunResult['journeyArtifacts'] | LiveFireRunResult['smokeArtifacts'] | undefined,
  expectedRepoReports: number
): boolean {
  if (!artifacts) return false;
  if (!artifacts.root || !artifacts.reportPath) return false;
  if (!Array.isArray(artifacts.repoReportPaths)) return false;
  const minimum = Math.max(1, expectedRepoReports);
  return artifacts.repoReportPaths.length >= minimum;
}

async function withTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  label: string
): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  const controller = new AbortController();
  const timeoutError = new Error(`${label}_timeout_after_${timeoutMs}ms`);
  try {
    return await Promise.race([
      run(controller.signal),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort(timeoutError);
          reject(timeoutError);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function computeJourneyStats(
  report: Awaited<ReturnType<typeof runAgenticJourney>>
): LiveFireJourneyStats {
  const total = report.results.length;
  const failures = report.results.filter((result) => !result.journeyOk || result.errors.length > 0).length;
  const retrieved = report.results.filter((result) => result.contextSelection === 'retrieved').length;
  const blockingValidations = report.results.filter((result) => Boolean(result.validation?.blocking)).length;
  const providerPrerequisiteFailures = report.results.filter((result) =>
    result.errors.some((error) => error.includes('provider_unavailable'))
  ).length;
  const validationPrerequisiteFailures = report.results.filter((result) =>
    result.errors.some((error) => error.includes('validation_unavailable'))
  ).length;
  const unverifiedTraceErrors = report.results.filter((result) =>
    result.errors.some((error) => error.includes('unverified_by_trace('))
  ).length;
  const fallbackContextSelections = report.results.filter((result) =>
    result.errors.includes('fallback_context_file_selection')
    || result.contextSelection === 'fallback'
  ).length;
  const failedRepos = report.results
    .filter((result) => !result.journeyOk || result.errors.length > 0)
    .map((result) => result.repo);

  return {
    total,
    failures,
    passRate: total > 0 ? (total - failures) / total : 0,
    retrievedContextRate: total > 0 ? retrieved / total : 0,
    blockingValidationRate: total > 0 ? blockingValidations / total : 0,
    providerPrerequisiteFailures,
    validationPrerequisiteFailures,
    unverifiedTraceErrors,
    fallbackContextSelections,
    failedRepos,
  };
}

function computeSmokeStats(
  report: Awaited<ReturnType<typeof runExternalRepoSmoke>>
): LiveFireSmokeStats {
  const total = report.results.length;
  const failures = report.results.filter((result) => result.errors.length > 0 || (!result.overviewOk && !result.contextOk)).length;
  const failedRepos = report.results
    .filter((result) => result.errors.length > 0 || (!result.overviewOk && !result.contextOk))
    .map((result) => result.repo);

  return {
    total,
    failures,
    passRate: total > 0 ? (total - failures) / total : 0,
    failedRepos,
  };
}

export async function runLiveFireTrials(options: LiveFireTrialOptions): Promise<LiveFireTrialReport> {
  const rounds = Number.isFinite(options.rounds) && (options.rounds ?? 0) > 0 ? Math.floor(options.rounds ?? 1) : 3;
  const llmModes = resolveLlmModes(options.llmModes);
  const deterministic = options.deterministic ?? true;
  const protocol = options.protocol ?? 'objective';
  const strictObjective = options.strictObjective ?? true;
  const includeSmoke = options.includeSmoke ?? true;
  const minJourneyPassRate = clamp01(options.minJourneyPassRate ?? 1);
  const minRetrievedContextRate = clamp01(options.minRetrievedContextRate ?? 0.95);
  const maxBlockingValidationRate = clamp01(options.maxBlockingValidationRate ?? 0);
  const journeyTimeoutMs = normalizeTimeout(options.journeyTimeoutMs, 180000);
  const smokeTimeoutMs = normalizeTimeout(options.smokeTimeoutMs, 120000);
  const artifactRoot = options.artifactRoot && options.artifactRoot.trim().length > 0
    ? path.resolve(options.artifactRoot)
    : undefined;

  const runs: LiveFireRunResult[] = [];

  for (let round = 1; round <= rounds; round += 1) {
    for (const llmMode of llmModes) {
      const reasons: string[] = [];
      let journey: LiveFireJourneyStats;
      let journeyArtifacts: LiveFireRunResult['journeyArtifacts'];
      let journeyExecutionFailed = false;
      try {
        const runArtifactRoot = artifactRoot
          ? path.join(
            artifactRoot,
            `round-${round}`,
            `llm-${sanitizePathSegment(llmMode)}`,
            'journey'
          )
          : undefined;
        const journeyReport = await withTimeout(
          (signal) => runAgenticJourney({
            reposRoot: options.reposRoot,
            maxRepos: options.maxRepos,
            repoNames: options.repoNames,
            llmMode,
            deterministic,
            protocol,
            strictObjective,
            artifactRoot: runArtifactRoot,
            runLabel: `round-${round}-${llmMode}`,
            signal,
          }),
          journeyTimeoutMs,
          'journey'
        );
        journey = computeJourneyStats(journeyReport);
        journeyArtifacts = journeyReport.artifacts;
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        journeyExecutionFailed = true;
        journey = {
          total: 0,
          failures: 1,
          passRate: 0,
          retrievedContextRate: 0,
          blockingValidationRate: 1,
          providerPrerequisiteFailures: detail.includes('provider_unavailable') ? 1 : 0,
          validationPrerequisiteFailures: detail.includes('validation_unavailable') ? 1 : 0,
          unverifiedTraceErrors: detail.includes('unverified_by_trace(') ? 1 : 0,
          fallbackContextSelections: detail.includes('fallback_context_file_selection') ? 1 : 0,
          failedRepos: [],
        };
        reasons.push(`journey_execution_failed:${detail}`);
      }

      let smoke: LiveFireSmokeStats | undefined;
      let smokeArtifacts: LiveFireRunResult['smokeArtifacts'];
      if (includeSmoke && !journeyExecutionFailed) {
        try {
          const runArtifactRoot = artifactRoot
            ? path.join(
              artifactRoot,
              `round-${round}`,
              `llm-${sanitizePathSegment(llmMode)}`,
              'smoke'
            )
            : undefined;
          const smokeReport = await withTimeout(
            (signal) => runExternalRepoSmoke({
              reposRoot: options.reposRoot,
              maxRepos: options.maxRepos,
              repoNames: options.repoNames,
              artifactRoot: runArtifactRoot,
              runLabel: `round-${round}-${llmMode}`,
              signal,
            }),
            smokeTimeoutMs,
            'smoke'
          );
          smoke = computeSmokeStats(smokeReport);
          smokeArtifacts = smokeReport.artifacts;
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          smoke = {
            total: 0,
            failures: 1,
            passRate: 0,
            failedRepos: [],
          };
          reasons.push(`smoke_execution_failed:${detail}`);
        }
      } else if (includeSmoke && journeyExecutionFailed) {
        smoke = {
          total: 0,
          failures: 1,
          passRate: 0,
          failedRepos: [],
        };
        reasons.push('smoke_skipped_due_journey_execution_failure');
      }
      if (journey.total === 0) {
        reasons.push('journey_results_missing');
      }
      if (includeSmoke && (smoke?.total ?? 0) === 0) {
        reasons.push('smoke_results_missing');
      }
      if (artifactRoot) {
        if (!hasCompleteRunArtifacts(journeyArtifacts, journey.total)) {
          reasons.push('journey_artifacts_incomplete');
        }
        if (includeSmoke && !hasCompleteRunArtifacts(smokeArtifacts, smoke?.total ?? 0)) {
          reasons.push('smoke_artifacts_incomplete');
        }
      }
      if (journey.passRate < minJourneyPassRate) {
        reasons.push(`journey_pass_rate_below_threshold:${journey.passRate.toFixed(3)}<${minJourneyPassRate.toFixed(3)}`);
      }
      if (journey.retrievedContextRate < minRetrievedContextRate) {
        reasons.push(`retrieved_context_rate_below_threshold:${journey.retrievedContextRate.toFixed(3)}<${minRetrievedContextRate.toFixed(3)}`);
      }
      if (journey.blockingValidationRate > maxBlockingValidationRate) {
        reasons.push(`blocking_validation_rate_above_threshold:${journey.blockingValidationRate.toFixed(3)}>${maxBlockingValidationRate.toFixed(3)}`);
      }
      if (journey.providerPrerequisiteFailures > 0) {
        reasons.push(`provider_prerequisite_failures:${journey.providerPrerequisiteFailures}`);
      }
      if (journey.validationPrerequisiteFailures > 0) {
        reasons.push(`validation_prerequisite_failures:${journey.validationPrerequisiteFailures}`);
      }
      if (journey.unverifiedTraceErrors > 0) {
        reasons.push(`journey_unverified_trace_errors:${journey.unverifiedTraceErrors}`);
      }
      if (journey.fallbackContextSelections > 0) {
        reasons.push(`journey_fallback_context_selections:${journey.fallbackContextSelections}`);
      }
      if (smoke && smoke.failures > 0) {
        reasons.push(`smoke_failures:${smoke.failures}`);
      }

      runs.push({
        round,
        llmMode,
        journey,
        smoke,
        journeyArtifacts,
        smokeArtifacts,
        passed: reasons.length === 0,
        reasons,
      });
    }
  }

  const aggregate: LiveFireAggregate = {
    totalRuns: runs.length,
    passingRuns: runs.filter((run) => run.passed).length,
    passRate: runs.length > 0 ? runs.filter((run) => run.passed).length / runs.length : 0,
    meanJourneyPassRate: avg(runs.map((run) => run.journey.passRate)),
    meanRetrievedContextRate: avg(runs.map((run) => run.journey.retrievedContextRate)),
    meanBlockingValidationRate: avg(runs.map((run) => run.journey.blockingValidationRate)),
    meanSmokePassRate: includeSmoke ? avg(runs.map((run) => run.smoke?.passRate ?? 0)) : undefined,
    reasonCounts: countReasons(runs),
    failedRepos: dedupe(
      runs.flatMap((run) => [
        ...run.journey.failedRepos,
        ...(run.smoke?.failedRepos ?? []),
      ])
    ),
  };

  const gateReasons: string[] = [];
  if (aggregate.passRate < 1) {
    gateReasons.push('at_least_one_live_fire_run_failed');
  }
  if (aggregate.meanJourneyPassRate < minJourneyPassRate) {
    gateReasons.push(`aggregate_journey_pass_rate_below_threshold:${aggregate.meanJourneyPassRate.toFixed(3)}<${minJourneyPassRate.toFixed(3)}`);
  }
  if (aggregate.meanRetrievedContextRate < minRetrievedContextRate) {
    gateReasons.push(`aggregate_retrieved_context_rate_below_threshold:${aggregate.meanRetrievedContextRate.toFixed(3)}<${minRetrievedContextRate.toFixed(3)}`);
  }
  if (aggregate.meanBlockingValidationRate > maxBlockingValidationRate) {
    gateReasons.push(`aggregate_blocking_validation_rate_above_threshold:${aggregate.meanBlockingValidationRate.toFixed(3)}>${maxBlockingValidationRate.toFixed(3)}`);
  }
  if (runs.some((run) => run.reasons.some((reason) => reason.startsWith('provider_prerequisite_failures:')))) {
    gateReasons.push('provider_prerequisite_failures_detected');
  }
  if (runs.some((run) => run.reasons.some((reason) => reason.startsWith('validation_prerequisite_failures:')))) {
    gateReasons.push('validation_prerequisite_failures_detected');
  }
  if (runs.some((run) => run.reasons.some((reason) => reason.startsWith('journey_unverified_trace_errors:')))) {
    gateReasons.push('journey_unverified_trace_detected');
  }
  if (runs.some((run) => run.reasons.some((reason) => reason.startsWith('journey_fallback_context_selections:')))) {
    gateReasons.push('journey_fallback_context_detected');
  }
  if (runs.some((run) => run.reasons.some((reason) => reason.startsWith('journey_execution_failed:')))) {
    gateReasons.push('journey_execution_failures_detected');
  }
  if (runs.some((run) => run.reasons.some((reason) => reason.startsWith('smoke_execution_failed:')))) {
    gateReasons.push('smoke_execution_failures_detected');
  }
  if (runs.some((run) => run.reasons.includes('journey_artifacts_incomplete'))) {
    gateReasons.push('journey_artifact_integrity_failures_detected');
  }
  if (runs.some((run) => run.reasons.includes('smoke_artifacts_incomplete'))) {
    gateReasons.push('smoke_artifact_integrity_failures_detected');
  }
  const classifiedGateReasons = classifyGateReasons(gateReasons);

  return {
    schema: 'LiveFireTrialReport.v1',
    createdAt: new Date().toISOString(),
    options: {
      reposRoot: options.reposRoot,
      rounds,
      maxRepos: options.maxRepos,
      repoNames: options.repoNames,
      llmModes,
      deterministic,
      protocol,
      strictObjective,
      includeSmoke,
      minJourneyPassRate,
      minRetrievedContextRate,
      maxBlockingValidationRate,
      journeyTimeoutMs,
      smokeTimeoutMs,
      artifactRoot,
    },
    runs,
    aggregate,
    gates: {
      passed: gateReasons.length === 0,
      reasons: gateReasons,
      classifiedReasons: classifiedGateReasons,
      severityCounts: countBySeverity(classifiedGateReasons),
      categoryCounts: countByCategory(classifiedGateReasons),
    },
  };
}
