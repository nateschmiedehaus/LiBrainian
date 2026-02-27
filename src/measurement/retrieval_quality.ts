/**
 * @fileoverview Retrieval Quality Measurement
 *
 * Per docs/archive/validation.md: Multi-vector scoring must be verified
 * with ranking-comparison tests. This module provides:
 * 1. Curated evaluation dataset format (query → relevant_files/targets)
 * 2. Compute Recall@k, Precision@k, nDCG
 * 3. Emit RetrievalQualityReport.v1 audit artifacts
 *
 * UNDERSTANDING_LAYER mandate: All retrieval claims must be evidence-backed.
 */

// ============================================================================
// TYPES (RetrievalQualityReport.v1 Schema)
// ============================================================================

/**
 * A single evaluation query with known relevant targets.
 */
export interface EvaluationQuery {
  /** Unique query ID */
  queryId: string;
  /** Natural language query or search string */
  query: string;
  /** Query type for weight profile selection */
  queryType?: 'purpose-query' | 'similar-purpose' | 'similar-structure' | 'related-modules' | 'compatible-apis' | 'default';
  /** Set of relevant file/entity IDs (ground truth) */
  relevantTargets: string[];
  /** Optional graded relevance scores (for nDCG calculation) */
  gradedRelevance?: Record<string, number>;
  /** Optional category for segmented analysis */
  category?: string;
}

/**
 * Results from running a single evaluation query.
 */
export interface EvaluationResult {
  /** Query ID */
  queryId: string;
  /** Ranked list of retrieved entity IDs */
  retrievedIds: string[];
  /** Scores for each retrieved entity */
  scores: number[];
  /** Latency in milliseconds */
  latencyMs: number;
  /** Which retrieval method was used */
  method: 'multi-vector' | 'single-vector' | 'baseline';
}

/**
 * Per-query metrics computed from evaluation results.
 */
export interface QueryMetrics {
  queryId: string;
  /** Recall at k (fraction of relevant items retrieved) */
  recallAtK: Record<number, number>;
  /** Precision at k (fraction of retrieved items that are relevant) */
  precisionAtK: Record<number, number>;
  /** Normalized discounted cumulative gain at k */
  ndcgAtK: Record<number, number>;
  /** Mean reciprocal rank (1/rank of first relevant result) */
  mrr: number;
  /** Whether any relevant item was found in top k */
  hitAtK: Record<number, boolean>;
  /** Latency in milliseconds */
  latencyMs: number;
}

/**
 * Aggregated retrieval quality metrics.
 */
export interface AggregateMetrics {
  /** Mean Recall@k across all queries */
  meanRecallAtK: Record<number, number>;
  /** Mean Precision@k across all queries */
  meanPrecisionAtK: Record<number, number>;
  /** Mean nDCG@k across all queries */
  meanNdcgAtK: Record<number, number>;
  /** Mean reciprocal rank */
  meanMrr: number;
  /** Hit rate at k (fraction of queries with at least one hit) */
  hitRateAtK: Record<number, number>;
  /** Mean query latency in milliseconds */
  meanLatencyMs: number;
  /** P99 query latency in milliseconds */
  p99LatencyMs: number;
}

/**
 * Comparison between two retrieval methods.
 */
export interface MethodComparison {
  /** Method A name */
  methodA: string;
  /** Method B name */
  methodB: string;
  /** Relative improvement in mean Recall@5: (A - B) / B */
  recallDelta: number;
  /** Relative improvement in mean nDCG@5: (A - B) / B */
  ndcgDelta: number;
  /** Relative improvement in MRR: (A - B) / B */
  mrrDelta: number;
  /** Number of queries where A outperformed B */
  aWins: number;
  /** Number of queries where B outperformed A */
  bWins: number;
  /** Number of ties */
  ties: number;
  /** Statistical significance (p-value from paired t-test, if computed) */
  pValue?: number;
}

/**
 * RetrievalQualityReport.v1 - Audit artifact for retrieval quality.
 */
export interface RetrievalQualityReport {
  kind: 'RetrievalQualityReport.v1';
  schemaVersion: 1;

  /** ISO 8601 timestamp */
  generatedAt: string;
  /** Evaluation dataset version/name */
  datasetVersion: string;
  /** Total number of evaluation queries */
  queryCount: number;

  /** Aggregate metrics for the primary retrieval method */
  aggregate: AggregateMetrics;

  /** Per-query metrics (for debugging and detailed analysis) */
  perQuery: QueryMetrics[];

  /** Method comparison (if baseline was also evaluated) */
  comparison?: MethodComparison;

  /** Quality thresholds and compliance */
  compliance: {
    /** Target Recall@5 (e.g., 0.7) */
    recallTarget: number;
    /** Actual Recall@5 */
    recallActual: number;
    /** Does actual meet target? */
    meetsRecallTarget: boolean;
    /** Target nDCG@5 (e.g., 0.6) */
    ndcgTarget: number;
    /** Actual nDCG@5 */
    ndcgActual: number;
    /** Does actual meet target? */
    meetsNdcgTarget: boolean;
    /** Target MRR (e.g., 0.5) */
    mrrTarget: number;
    /** Actual MRR */
    mrrActual: number;
    /** Does actual meet target? */
    meetsMrrTarget: boolean;
  };

  /** Evidence trace for provenance */
  evidence: {
    /** Method name */
    method: string;
    /** Configuration used */
    config: Record<string, unknown>;
    /** Repository/workspace path */
    workspace: string;
    /** Prompt digest if LLM was involved */
    promptDigest?: string;
  };

  /** Trend vs previous report */
  trend?: {
    previousRecall: number;
    previousNdcg: number;
    direction: 'improving' | 'degrading' | 'stable';
  };
}

// ============================================================================
// METRIC COMPUTATION
// ============================================================================

/**
 * Standard k values for evaluation.
 */
export const DEFAULT_K_VALUES = [1, 3, 5, 10, 20] as const;

/**
 * Default quality targets.
 */
export const DEFAULT_TARGETS = {
  recallAt5: 0.7,
  ndcgAt5: 0.6,
  mrr: 0.5,
};

/**
 * Compute retrieval metrics for a single query.
 */
export function computeQueryMetrics(
  query: EvaluationQuery,
  result: EvaluationResult,
  kValues: readonly number[] = DEFAULT_K_VALUES
): QueryMetrics {
  const relevantSet = new Set(query.relevantTargets);
  const retrieved = result.retrievedIds;

  const recallAtK: Record<number, number> = {};
  const precisionAtK: Record<number, number> = {};
  const ndcgAtK: Record<number, number> = {};
  const hitAtK: Record<number, boolean> = {};

  // Compute metrics for each k
  for (const k of kValues) {
    const topK = retrieved.slice(0, k);
    const relevantInTopK = topK.filter((id) => relevantSet.has(id)).length;

    // Recall@k: fraction of relevant items found in top k
    recallAtK[k] = query.relevantTargets.length > 0
      ? relevantInTopK / query.relevantTargets.length
      : 0;

    // Precision@k: fraction of top k that are relevant
    precisionAtK[k] = k > 0 ? relevantInTopK / k : 0;

    // Hit@k: any relevant item in top k?
    hitAtK[k] = relevantInTopK > 0;

    // nDCG@k
    ndcgAtK[k] = computeNdcg(topK, query.relevantTargets, query.gradedRelevance);
  }

  // MRR: 1/rank of first relevant result
  const firstRelevantRank = retrieved.findIndex((id) => relevantSet.has(id));
  const mrr = firstRelevantRank >= 0 ? 1 / (firstRelevantRank + 1) : 0;

  return {
    queryId: query.queryId,
    recallAtK,
    precisionAtK,
    ndcgAtK,
    mrr,
    hitAtK,
    latencyMs: result.latencyMs,
  };
}

/**
 * Compute normalized discounted cumulative gain.
 */
function computeNdcg(
  rankedIds: string[],
  relevantIds: string[],
  gradedRelevance?: Record<string, number>
): number {
  const relevantSet = new Set(relevantIds);

  // DCG: sum of relevance / log2(rank + 1)
  let dcg = 0;
  for (let i = 0; i < rankedIds.length; i++) {
    const id = rankedIds[i];
    const relevance = gradedRelevance?.[id] ?? (relevantSet.has(id) ? 1 : 0);
    dcg += relevance / Math.log2(i + 2); // +2 because rank is 1-indexed
  }

  // Ideal DCG: sort by relevance descending
  const idealRelevances = relevantIds
    .map((id) => gradedRelevance?.[id] ?? 1)
    .sort((a, b) => b - a)
    .slice(0, rankedIds.length);

  let idcg = 0;
  for (let i = 0; i < idealRelevances.length; i++) {
    idcg += idealRelevances[i] / Math.log2(i + 2);
  }

  return idcg > 0 ? dcg / idcg : 0;
}

/**
 * Aggregate metrics across multiple queries.
 */
export function aggregateMetrics(
  perQuery: QueryMetrics[],
  kValues: readonly number[] = DEFAULT_K_VALUES
): AggregateMetrics {
  if (perQuery.length === 0) {
    const empty: Record<number, number> = {};
    for (const k of kValues) {
      empty[k] = 0;
    }
    return {
      meanRecallAtK: empty,
      meanPrecisionAtK: empty,
      meanNdcgAtK: empty,
      meanMrr: 0,
      hitRateAtK: empty,
      meanLatencyMs: 0,
      p99LatencyMs: 0,
    };
  }

  const meanRecallAtK: Record<number, number> = {};
  const meanPrecisionAtK: Record<number, number> = {};
  const meanNdcgAtK: Record<number, number> = {};
  const hitRateAtK: Record<number, number> = {};

  for (const k of kValues) {
    meanRecallAtK[k] = mean(perQuery.map((q) => q.recallAtK[k] ?? 0));
    meanPrecisionAtK[k] = mean(perQuery.map((q) => q.precisionAtK[k] ?? 0));
    meanNdcgAtK[k] = mean(perQuery.map((q) => q.ndcgAtK[k] ?? 0));
    hitRateAtK[k] = mean(perQuery.map((q) => (q.hitAtK[k] ? 1 : 0)));
  }

  const latencies = perQuery.map((q) => q.latencyMs).sort((a, b) => a - b);
  const p99Index = Math.floor(latencies.length * 0.99);

  return {
    meanRecallAtK,
    meanPrecisionAtK,
    meanNdcgAtK,
    meanMrr: mean(perQuery.map((q) => q.mrr)),
    hitRateAtK,
    meanLatencyMs: mean(latencies),
    p99LatencyMs: latencies[p99Index] ?? 0,
  };
}

/**
 * Compare two retrieval methods.
 */
export function compareRetrievalMethods(
  metricsA: QueryMetrics[],
  metricsB: QueryMetrics[],
  methodAName: string,
  methodBName: string
): MethodComparison {
  const aggA = aggregateMetrics(metricsA);
  const aggB = aggregateMetrics(metricsB);

  const recallA = aggA.meanRecallAtK[5] ?? 0;
  const recallB = aggB.meanRecallAtK[5] ?? 0;
  const ndcgA = aggA.meanNdcgAtK[5] ?? 0;
  const ndcgB = aggB.meanNdcgAtK[5] ?? 0;

  // Count wins/losses per query
  let aWins = 0;
  let bWins = 0;
  let ties = 0;

  const byQuery = new Map<string, { a: QueryMetrics; b: QueryMetrics }>();
  for (const m of metricsA) {
    byQuery.set(m.queryId, { a: m, b: undefined as unknown as QueryMetrics });
  }
  for (const m of metricsB) {
    const entry = byQuery.get(m.queryId);
    if (entry) {
      entry.b = m;
    }
  }

  for (const [, { a, b }] of byQuery) {
    if (!a || !b) continue;
    const scoreA = (a.recallAtK[5] ?? 0) + (a.ndcgAtK[5] ?? 0);
    const scoreB = (b.recallAtK[5] ?? 0) + (b.ndcgAtK[5] ?? 0);
    if (scoreA > scoreB + 0.01) {
      aWins++;
    } else if (scoreB > scoreA + 0.01) {
      bWins++;
    } else {
      ties++;
    }
  }

  return {
    methodA: methodAName,
    methodB: methodBName,
    recallDelta: recallB > 0 ? (recallA - recallB) / recallB : 0,
    ndcgDelta: ndcgB > 0 ? (ndcgA - ndcgB) / ndcgB : 0,
    mrrDelta: aggB.meanMrr > 0 ? (aggA.meanMrr - aggB.meanMrr) / aggB.meanMrr : 0,
    aWins,
    bWins,
    ties,
  };
}

/**
 * Generate a complete RetrievalQualityReport.
 */
export function generateRetrievalQualityReport(
  queries: EvaluationQuery[],
  results: EvaluationResult[],
  config: {
    method: string;
    workspace: string;
    datasetVersion: string;
    config?: Record<string, unknown>;
    previousReport?: RetrievalQualityReport;
    baselineResults?: EvaluationResult[];
    targets?: typeof DEFAULT_TARGETS;
  }
): RetrievalQualityReport {
  const targets = config.targets ?? DEFAULT_TARGETS;

  // Compute per-query metrics
  const resultByQuery = new Map(results.map((r) => [r.queryId, r]));
  const perQuery: QueryMetrics[] = [];

  for (const query of queries) {
    const result = resultByQuery.get(query.queryId);
    if (result) {
      perQuery.push(computeQueryMetrics(query, result));
    }
  }

  // Aggregate metrics
  const aggregate = aggregateMetrics(perQuery);

  // Method comparison if baseline provided
  let comparison: MethodComparison | undefined;
  if (config.baselineResults) {
    const baselineResultByQuery = new Map(config.baselineResults.map((r) => [r.queryId, r]));
    const baselinePerQuery: QueryMetrics[] = [];
    for (const query of queries) {
      const result = baselineResultByQuery.get(query.queryId);
      if (result) {
        baselinePerQuery.push(computeQueryMetrics(query, result));
      }
    }
    comparison = compareRetrievalMethods(perQuery, baselinePerQuery, config.method, 'baseline');
  }

  // Compliance check
  const recallActual = aggregate.meanRecallAtK[5] ?? 0;
  const ndcgActual = aggregate.meanNdcgAtK[5] ?? 0;
  const mrrActual = aggregate.meanMrr;

  // Trend analysis
  let trend: RetrievalQualityReport['trend'];
  if (config.previousReport) {
    const prevRecall = config.previousReport.aggregate.meanRecallAtK[5] ?? 0;
    const prevNdcg = config.previousReport.aggregate.meanNdcgAtK[5] ?? 0;
    const recallDelta = recallActual - prevRecall;
    const ndcgDelta = ndcgActual - prevNdcg;
    const avgDelta = (recallDelta + ndcgDelta) / 2;
    trend = {
      previousRecall: prevRecall,
      previousNdcg: prevNdcg,
      direction: avgDelta > 0.02 ? 'improving' : avgDelta < -0.02 ? 'degrading' : 'stable',
    };
  }

  return {
    kind: 'RetrievalQualityReport.v1',
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    datasetVersion: config.datasetVersion,
    queryCount: queries.length,
    aggregate,
    perQuery,
    comparison,
    compliance: {
      recallTarget: targets.recallAt5,
      recallActual,
      meetsRecallTarget: recallActual >= targets.recallAt5,
      ndcgTarget: targets.ndcgAt5,
      ndcgActual,
      meetsNdcgTarget: ndcgActual >= targets.ndcgAt5,
      mrrTarget: targets.mrr,
      mrrActual,
      meetsMrrTarget: mrrActual >= targets.mrr,
    },
    evidence: {
      method: config.method,
      config: config.config ?? {},
      workspace: config.workspace,
    },
    trend,
  };
}

// ============================================================================
// HELPERS
// ============================================================================

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

// ============================================================================
// TYPE GUARD
// ============================================================================

export function isRetrievalQualityReport(value: unknown): value is RetrievalQualityReport {
  if (!value || typeof value !== 'object') return false;
  const r = value as Record<string, unknown>;
  return r.kind === 'RetrievalQualityReport.v1' && r.schemaVersion === 1;
}
