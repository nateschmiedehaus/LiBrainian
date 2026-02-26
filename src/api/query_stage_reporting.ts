import type {
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
