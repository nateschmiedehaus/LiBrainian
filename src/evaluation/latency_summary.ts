export type QueryLatencySample = {
  queryType: string;
  latencyMs: number;
};

export type LatencySummary = {
  count: number;
  minMs: number;
  maxMs: number;
  meanMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
};

export type QueryLatencySummary = LatencySummary & {
  byQueryType: Record<string, LatencySummary>;
};

function percentile(sorted: number[], rank: number): number {
  if (sorted.length === 0) return 0;
  const normalized = Math.max(0, Math.min(1, rank));
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(normalized * sorted.length) - 1),
  );
  return sorted[index] ?? sorted[sorted.length - 1] ?? 0;
}

function summarize(latencies: number[]): LatencySummary {
  if (latencies.length === 0) {
    return {
      count: 0,
      minMs: 0,
      maxMs: 0,
      meanMs: 0,
      p50Ms: 0,
      p95Ms: 0,
      p99Ms: 0,
    };
  }
  const sorted = [...latencies].sort((left, right) => left - right);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  return {
    count: sorted.length,
    minMs: sorted[0] ?? 0,
    maxMs: sorted[sorted.length - 1] ?? 0,
    meanMs: total / sorted.length,
    p50Ms: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    p99Ms: percentile(sorted, 0.99),
  };
}

export function summarizeLatencySamples(samples: QueryLatencySample[]): QueryLatencySummary {
  const byQueryType: Record<string, number[]> = {};
  for (const sample of samples) {
    const key = sample.queryType;
    if (!byQueryType[key]) byQueryType[key] = [];
    byQueryType[key].push(sample.latencyMs);
  }

  const byQueryTypeSummary: Record<string, LatencySummary> = {};
  for (const [queryType, latencies] of Object.entries(byQueryType)) {
    byQueryTypeSummary[queryType] = summarize(latencies);
  }

  return {
    ...summarize(samples.map((sample) => sample.latencyMs)),
    byQueryType: byQueryTypeSummary,
  };
}
