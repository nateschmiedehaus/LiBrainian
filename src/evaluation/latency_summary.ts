export type QueryLatencySample = {
  queryType: string;
  latencyMs: number;
};

export type LatencyStats = {
  sampleCount: number;
  minMs: number;
  maxMs: number;
  meanMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
};

export type LatencySummary = {
  overall: LatencyStats;
  byQueryType: Record<string, LatencyStats>;
};

function percentile(sortedValues: number[], percentileValue: number): number {
  if (sortedValues.length === 0) return 0;
  const clamped = Math.min(1, Math.max(0, percentileValue));
  const index = Math.ceil(clamped * sortedValues.length) - 1;
  const boundedIndex = Math.min(sortedValues.length - 1, Math.max(0, index));
  return sortedValues[boundedIndex] ?? 0;
}

function summarizeLatencies(latencies: number[]): LatencyStats {
  if (latencies.length === 0) {
    return {
      sampleCount: 0,
      minMs: 0,
      maxMs: 0,
      meanMs: 0,
      p50Ms: 0,
      p95Ms: 0,
      p99Ms: 0,
    };
  }

  const sorted = [...latencies].sort((left, right) => left - right);
  const total = sorted.reduce((sum, latency) => sum + latency, 0);
  return {
    sampleCount: sorted.length,
    minMs: sorted[0] ?? 0,
    maxMs: sorted[sorted.length - 1] ?? 0,
    meanMs: total / sorted.length,
    p50Ms: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    p99Ms: percentile(sorted, 0.99),
  };
}

export function summarizeLatencySamples(samples: QueryLatencySample[]): LatencySummary {
  const byType = new Map<string, number[]>();
  const allLatencies: number[] = [];

  for (const sample of samples) {
    if (!Number.isFinite(sample.latencyMs) || sample.latencyMs < 0) continue;
    allLatencies.push(sample.latencyMs);
    const bucket = byType.get(sample.queryType) ?? [];
    bucket.push(sample.latencyMs);
    byType.set(sample.queryType, bucket);
  }

  const byQueryType: Record<string, LatencyStats> = {};
  for (const [queryType, latencies] of byType.entries()) {
    byQueryType[queryType] = summarizeLatencies(latencies);
  }

  return {
    overall: summarizeLatencies(allLatencies),
    byQueryType,
  };
}
