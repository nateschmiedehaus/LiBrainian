import type {
  CoverageAssessment,
  QueryStageObserver,
  StageIssue,
  StageName,
  StageReport,
  StageTelemetry,
} from '../types.js';
import { logWarning } from '../telemetry/logger.js';

type StageContext = {
  stage: StageName;
  startedAt: number;
  inputCount: number;
  issues: StageIssue[];
};

export type StageTracker = ReturnType<typeof createStageTracker>;

export interface CoverageAssessmentWeights {
  baseOffset: number;
  packDivisor: number;
  gapPenaltyMax: number;
  gapPenaltyStep: number;
  totalConfidenceWeight: number;
  successRatioWeight: number;
  failedCountWeight: number;
  confidenceBase: number;
  confidenceSuccessWeight: number;
  confidenceFailedWeight: number;
}

export function normalizeStageObserver(value: unknown): QueryStageObserver | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'function') {
    throw new TypeError('onStage must be a function');
  }
  return value as QueryStageObserver;
}

function cloneStageReport(report: StageReport): StageReport {
  return {
    ...report,
    results: {
      ...report.results,
      telemetry: report.results.telemetry ? { ...report.results.telemetry } : undefined,
    },
    issues: report.issues.map((issue) => ({ ...issue })),
  };
}

function notifyStageObserver(onStage: QueryStageObserver | undefined, report: StageReport): void {
  if (!onStage) {
    return;
  }
  const snapshot = cloneStageReport(report);
  try {
    onStage(snapshot);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logWarning('Query stage observer failed', { stage: report.stage, error: message });
  }
}

function deriveStageStatus(inputCount: number, outputCount: number, issueCount: number): StageReport['status'] {
  if (inputCount === 0) return 'skipped';
  if (outputCount === 0) return issueCount > 0 ? 'failed' : 'partial';
  if (issueCount > 0) return 'partial';
  return 'success';
}

export function createStageTracker(onStage?: QueryStageObserver) {
  const stages: StageReport[] = [];
  const active = new Map<StageName, StageContext>();
  const pendingIssues = new Map<StageName, StageIssue[]>();
  const reported = new Set<StageName>();

  const issue = (stage: StageName, nextIssue: StageIssue): void => {
    const current = active.get(stage);
    if (current) {
      current.issues.push(nextIssue);
      return;
    }
    const queued = pendingIssues.get(stage) ?? [];
    queued.push(nextIssue);
    pendingIssues.set(stage, queued);
  };

  const start = (stage: StageName, inputCount: number): StageContext => {
    const queued = pendingIssues.get(stage) ?? [];
    pendingIssues.delete(stage);
    const context = { stage, startedAt: Date.now(), inputCount, issues: [...queued] };
    active.set(stage, context);
    return context;
  };

  const finish = (
    context: StageContext,
    options: {
      outputCount: number;
      filteredCount?: number;
      status?: StageReport['status'];
      telemetry?: StageTelemetry;
    }
  ): StageReport => {
    active.delete(context.stage);
    const filteredCount = options.filteredCount ?? Math.max(0, context.inputCount - options.outputCount);
    const status = options.status ?? deriveStageStatus(context.inputCount, options.outputCount, context.issues.length);
    const report: StageReport = {
      stage: context.stage,
      status,
      results: {
        inputCount: context.inputCount,
        outputCount: options.outputCount,
        filteredCount,
        telemetry: options.telemetry ? { ...options.telemetry } : undefined,
      },
      issues: context.issues,
      durationMs: Math.max(0, Date.now() - context.startedAt),
    };
    stages.push(report);
    reported.add(context.stage);
    notifyStageObserver(onStage, report);
    return report;
  };

  const finalizeMissing = (stageNames: StageName[]): void => {
    for (const stage of stageNames) {
      if (reported.has(stage)) continue;
      const queued = pendingIssues.get(stage) ?? [];
      pendingIssues.delete(stage);
      const report: StageReport = {
        stage,
        status: 'skipped',
        results: { inputCount: 0, outputCount: 0, filteredCount: 0 },
        issues: queued,
        durationMs: 0,
      };
      stages.push(report);
      reported.add(stage);
      notifyStageObserver(onStage, report);
    }
  };

  return {
    start,
    finish,
    issue,
    finalizeMissing,
    report: () => stages.slice(),
  };
}

export function buildStageCostSummary(stageReports: StageReport[]): {
  totalStageDurationMs: number;
  stageTimingsMs: Partial<Record<StageName, number>>;
  stageStatuses: Partial<Record<StageName, StageReport['status']>>;
  semanticRetrievalTelemetry: StageTelemetry | null;
  rerankingTelemetry: StageTelemetry | null;
} {
  const stageTimingsMs: Partial<Record<StageName, number>> = {};
  const stageStatuses: Partial<Record<StageName, StageReport['status']>> = {};
  let totalStageDurationMs = 0;
  for (const report of stageReports) {
    stageTimingsMs[report.stage] = report.durationMs;
    stageStatuses[report.stage] = report.status;
    totalStageDurationMs += report.durationMs;
  }
  const semanticRetrievalTelemetry =
    stageReports.find((report) => report.stage === 'semantic_retrieval')?.results.telemetry ?? null;
  const rerankingTelemetry =
    stageReports.find((report) => report.stage === 'reranking')?.results.telemetry ?? null;
  return {
    totalStageDurationMs,
    stageTimingsMs,
    stageStatuses,
    semanticRetrievalTelemetry,
    rerankingTelemetry,
  };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function buildCoverageSuggestions(
  stageReports: StageReport[],
  gaps: CoverageAssessment['gaps'],
  packCount: number
): string[] {
  const suggestions = new Set<string>();
  const hasStage = (stageName: StageName, status?: StageReport['status'] | Array<StageReport['status']>) => {
    const statusSet = Array.isArray(status) ? new Set(status) : null;
    return stageReports.some((stage) => stage.stage === stageName && (!statusSet || statusSet.has(stage.status)));
  };
  if (packCount === 0) suggestions.add('Index the project and include affected files to improve coverage.');
  if (hasStage('semantic_retrieval', ['partial', 'failed'])) {
    suggestions.add('Provide a more specific intent or affected files for stronger semantic matches.');
  }
  if (hasStage('graph_expansion', ['skipped', 'failed'])) {
    suggestions.add('Enable graph metrics during bootstrap to improve graph expansion.');
  }
  if (hasStage('synthesis', ['skipped', 'failed'])) {
    suggestions.add('Enable LLM providers to generate synthesized answers.');
  }
  if (gaps.some((gap) => gap.severity === 'significant')) {
    suggestions.add('Increase query depth or broaden affectedFiles to improve coverage.');
  }
  return Array.from(suggestions);
}

export function buildCoverageAssessment(options: {
  stageReports: StageReport[];
  totalConfidence: number;
  packCount: number;
  coverageGaps: string[];
  weights: CoverageAssessmentWeights;
}): CoverageAssessment {
  const { stageReports, totalConfidence, packCount, coverageGaps, weights } = options;
  const stageCount = Math.max(1, stageReports.length);
  const successCount = stageReports.filter((stage) => stage.status === 'success').length;
  const failedCount = stageReports.filter((stage) => stage.status === 'failed').length;
  const baseCoverage = packCount > 0 ? Math.min(1, weights.baseOffset + packCount / weights.packDivisor) : 0;
  const gapPenalty = Math.min(weights.gapPenaltyMax, coverageGaps.length * weights.gapPenaltyStep);
  const successRatio = successCount / stageCount;
  const estimatedCoverage = clamp01(
    baseCoverage +
      (totalConfidence * weights.totalConfidenceWeight) +
      (successRatio * weights.successRatioWeight) -
      gapPenalty -
      (failedCount * weights.failedCountWeight)
  );
  const coverageConfidence = clamp01(
    weights.confidenceBase +
      (successRatio * weights.confidenceSuccessWeight) -
      (failedCount * weights.confidenceFailedWeight)
  );
  const gaps = stageReports.flatMap((stage) =>
    stage.issues.map((issue) => ({
      source: stage.stage,
      description: issue.message,
      severity: issue.severity,
      remediation: issue.remediation,
    }))
  );
  const suggestions = buildCoverageSuggestions(stageReports, gaps, packCount);
  return {
    estimatedCoverage,
    coverageConfidence,
    gaps,
    suggestions,
  };
}
