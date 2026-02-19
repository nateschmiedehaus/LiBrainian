export type CodebaseSize = 'small' | 'medium' | 'large';
export type BenchmarkSlaStatus = 'pass' | 'alert' | 'block';

export interface SlaAssessment {
  metricId: string;
  status: BenchmarkSlaStatus;
  target: number;
  actual: number;
  ratio: number;
}

export const PERFORMANCE_SLA = {
  queryLatency: {
    p50Ms: 500,
    p95Ms: 2000,
    p99Ms: 5000,
    coldStartMs: 10_000,
  },
  indexingThroughput: {
    smallMs: 30_000,
    mediumMs: 5 * 60_000,
    largeMs: 30 * 60_000,
    incremental10FilesMs: 10_000,
  },
  memoryBudget: {
    peakIndexingMb: 2048,
    runtimeServingMb: 512,
  },
  enforcement: {
    alertMultiplier: 1.2,
    blockMultiplier: 2.0,
  },
} as const;

export function classifyCodebaseSize(fileCount: number): CodebaseSize {
  if (fileCount < 1000) return 'small';
  if (fileCount <= 10_000) return 'medium';
  return 'large';
}

export function resolveFullIndexTargetMs(fileCount: number): number {
  const size = classifyCodebaseSize(fileCount);
  if (size === 'small') return PERFORMANCE_SLA.indexingThroughput.smallMs;
  if (size === 'medium') return PERFORMANCE_SLA.indexingThroughput.mediumMs;
  return PERFORMANCE_SLA.indexingThroughput.largeMs;
}

export function assessSlaMetric(
  metricId: string,
  target: number,
  actual: number,
  options?: { alertMultiplier?: number; blockMultiplier?: number }
): SlaAssessment {
  const alertMultiplier = options?.alertMultiplier ?? PERFORMANCE_SLA.enforcement.alertMultiplier;
  const blockMultiplier = options?.blockMultiplier ?? PERFORMANCE_SLA.enforcement.blockMultiplier;
  const ratio = target <= 0 ? 0 : actual / target;
  const status: BenchmarkSlaStatus =
    ratio > blockMultiplier
      ? 'block'
      : ratio > alertMultiplier
      ? 'alert'
      : 'pass';

  return {
    metricId,
    status,
    target,
    actual,
    ratio,
  };
}
