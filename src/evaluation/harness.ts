/**
 * @fileoverview Evaluation Harness for LiBrainian
 *
 * Provides systematic evaluation of:
 * - Retrieval quality (precision, recall, nDCG)
 * - Pack confidence calibration
 * - Query latency and throughput
 * - Knowledge freshness
 *
 * @packageDocumentation
 */

// ============================================================================
// TYPES
// ============================================================================

/** Evaluation metric types */
export type MetricType =
  | 'precision'
  | 'recall'
  | 'f1'
  | 'ndcg'
  | 'mrr'
  | 'map'
  | 'latency'
  | 'throughput'
  | 'confidence_calibration';

/** Evaluation query with ground truth */
export interface EvaluationQuery {
  /** Query ID */
  id: string;

  /** Query intent */
  intent: string;

  /** Query type */
  intentType?: string;

  /** Expected relevant document IDs */
  relevantDocs: string[];

  /** Relevance grades (optional, for nDCG) */
  relevanceGrades?: Record<string, number>;

  /** Expected confidence range */
  expectedConfidence?: { min: number; max: number };

  /** Tags for categorization */
  tags?: string[];
}

/** Evaluation result for a single query */
export interface QueryEvaluationResult {
  /** Query ID */
  queryId: string;

  /** Retrieved document IDs */
  retrievedDocs: string[];

  /** Metrics for this query */
  metrics: Record<MetricType, number>;

  /** Latency in milliseconds */
  latencyMs: number;

  /** Confidence of top result */
  topConfidence?: number;

  /** Any errors */
  error?: string;
}

/** Aggregate evaluation results */
export interface EvaluationReport {
  /** Report ID */
  id: string;

  /** Report timestamp */
  timestamp: string;

  /** Configuration used */
  config: EvaluationConfig;

  /** Number of queries evaluated */
  queryCount: number;

  /** Aggregate metrics */
  aggregateMetrics: Record<MetricType, AggregateMetric>;

  /** Per-query results */
  queryResults: QueryEvaluationResult[];

  /** Breakdown by tag */
  byTag: Record<string, Record<MetricType, AggregateMetric>>;

  /** Summary statistics */
  summary: EvaluationSummary;
}

/** Aggregate metric with statistics */
export interface AggregateMetric {
  /** Mean value */
  mean: number;

  /** Median value */
  median: number;

  /** Standard deviation */
  std: number;

  /** Minimum value */
  min: number;

  /** Maximum value */
  max: number;

  /** Percentiles */
  percentiles: {
    p50: number;
    p90: number;
    p95: number;
    p99: number;
  };
}

/** Evaluation summary */
export interface EvaluationSummary {
  /** Overall quality grade */
  qualityGrade: 'A' | 'B' | 'C' | 'D' | 'F';

  /** Quality score (0-100) */
  qualityScore: number;

  /** Key findings */
  findings: string[];

  /** Recommendations */
  recommendations: string[];

  /** Pass/fail status */
  passed: boolean;

  /** Failure reasons if not passed */
  failureReasons?: string[];
}

/** Evaluation configuration */
export interface EvaluationConfig {
  /** Metrics to compute */
  metrics: MetricType[];

  /** Cutoff for precision/recall (k) */
  cutoffK: number;

  /** Minimum acceptable precision */
  minPrecision: number;

  /** Minimum acceptable recall */
  minRecall: number;

  /** Maximum acceptable latency (ms) */
  maxLatencyMs: number;

  /** Confidence calibration tolerance */
  calibrationTolerance: number;

  /** Number of warmup queries */
  warmupQueries: number;
}

/** Default evaluation configuration */
export const DEFAULT_EVAL_CONFIG: EvaluationConfig = {
  metrics: ['precision', 'recall', 'f1', 'ndcg', 'mrr', 'latency'],
  cutoffK: 10,
  minPrecision: 0.7,
  minRecall: 0.6,
  maxLatencyMs: 500,
  calibrationTolerance: 0.1,
  warmupQueries: 3,
};

// ============================================================================
// EVALUATION HARNESS
// ============================================================================

/**
 * Evaluation harness for systematic quality assessment.
 */
export class EvaluationHarness {
  private config: EvaluationConfig;
  private results: QueryEvaluationResult[] = [];

  constructor(config: Partial<EvaluationConfig> = {}) {
    this.config = { ...DEFAULT_EVAL_CONFIG, ...config };
  }

  // ==========================================================================
  // EVALUATION EXECUTION
  // ==========================================================================

  /**
   * Evaluate a single query result.
   */
  evaluateQuery(
    query: EvaluationQuery,
    retrievedDocs: string[],
    latencyMs: number,
    topConfidence?: number
  ): QueryEvaluationResult {
    const metrics: Record<MetricType, number> = {
      precision: 0,
      recall: 0,
      f1: 0,
      ndcg: 0,
      mrr: 0,
      map: 0,
      latency: latencyMs,
      throughput: 1000 / latencyMs,
      confidence_calibration: 0,
    };

    const k = this.config.cutoffK;
    const topK = retrievedDocs.slice(0, k);
    const relevantSet = new Set(query.relevantDocs);

    // Precision@k
    const truePositives = topK.filter((d) => relevantSet.has(d)).length;
    metrics.precision = topK.length > 0 ? truePositives / topK.length : 0;

    // Recall@k
    metrics.recall = relevantSet.size > 0 ? truePositives / relevantSet.size : 0;

    // F1
    if (metrics.precision + metrics.recall > 0) {
      metrics.f1 = (2 * metrics.precision * metrics.recall) / (metrics.precision + metrics.recall);
    }

    // MRR (Mean Reciprocal Rank)
    const firstRelevantIdx = retrievedDocs.findIndex((d) => relevantSet.has(d));
    metrics.mrr = firstRelevantIdx >= 0 ? 1 / (firstRelevantIdx + 1) : 0;

    // nDCG
    metrics.ndcg = this.calculateNDCG(query, retrievedDocs, k);

    // MAP
    metrics.map = this.calculateMAP(query, retrievedDocs);

    // Confidence calibration
    if (topConfidence !== undefined && query.expectedConfidence) {
      const inRange =
        topConfidence >= query.expectedConfidence.min &&
        topConfidence <= query.expectedConfidence.max;
      metrics.confidence_calibration = inRange ? 1 : 0;
    }

    const result: QueryEvaluationResult = {
      queryId: query.id,
      retrievedDocs,
      metrics,
      latencyMs,
      topConfidence,
    };

    this.results.push(result);
    return result;
  }

  /**
   * Run evaluation on a batch of queries.
   */
  async runBatch(
    queries: EvaluationQuery[],
    retriever: (query: EvaluationQuery) => Promise<{
      docs: string[];
      confidence?: number;
    }>
  ): Promise<EvaluationReport> {
    const startTime = Date.now();

    // Warmup
    for (let i = 0; i < Math.min(this.config.warmupQueries, queries.length); i++) {
      try {
        await retriever(queries[i]);
      } catch {
        // Ignore warmup errors
      }
    }

    // Evaluate
    for (const query of queries) {
      const queryStart = Date.now();
      try {
        const result = await retriever(query);
        const latencyMs = Date.now() - queryStart;
        this.evaluateQuery(query, result.docs, latencyMs, result.confidence);
      } catch (error) {
        this.results.push({
          queryId: query.id,
          retrievedDocs: [],
          metrics: this.emptyMetrics(),
          latencyMs: Date.now() - queryStart,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return this.generateReport(queries);
  }

  // ==========================================================================
  // METRICS CALCULATION
  // ==========================================================================

  private calculateNDCG(
    query: EvaluationQuery,
    retrievedDocs: string[],
    k: number
  ): number {
    const grades = query.relevanceGrades || {};
    const defaultGrade = 1; // Binary relevance if no grades

    // DCG
    let dcg = 0;
    for (let i = 0; i < Math.min(k, retrievedDocs.length); i++) {
      const doc = retrievedDocs[i];
      const grade = grades[doc] ?? (query.relevantDocs.includes(doc) ? defaultGrade : 0);
      dcg += grade / Math.log2(i + 2);
    }

    // Ideal DCG
    const idealRanking = [...query.relevantDocs]
      .map((d) => grades[d] ?? defaultGrade)
      .sort((a, b) => b - a);

    let idcg = 0;
    for (let i = 0; i < Math.min(k, idealRanking.length); i++) {
      idcg += idealRanking[i] / Math.log2(i + 2);
    }

    return idcg > 0 ? dcg / idcg : 0;
  }

  private calculateMAP(query: EvaluationQuery, retrievedDocs: string[]): number {
    const relevantSet = new Set(query.relevantDocs);
    let sumPrecision = 0;
    let relevantFound = 0;

    for (let i = 0; i < retrievedDocs.length; i++) {
      if (relevantSet.has(retrievedDocs[i])) {
        relevantFound++;
        sumPrecision += relevantFound / (i + 1);
      }
    }

    return relevantSet.size > 0 ? sumPrecision / relevantSet.size : 0;
  }

  // ==========================================================================
  // REPORT GENERATION
  // ==========================================================================

  /**
   * Generate evaluation report.
   */
  generateReport(queries: EvaluationQuery[]): EvaluationReport {
    const aggregateMetrics = this.aggregateMetrics();
    const byTag = this.aggregateByTag(queries);
    const summary = this.generateSummary(aggregateMetrics);

    return {
      id: `eval_${Date.now().toString(36)}`,
      timestamp: new Date().toISOString(),
      config: this.config,
      queryCount: this.results.length,
      aggregateMetrics,
      queryResults: this.results,
      byTag,
      summary,
    };
  }

  private aggregateMetrics(): Record<MetricType, AggregateMetric> {
    const result: Record<MetricType, AggregateMetric> = {} as Record<MetricType, AggregateMetric>;

    for (const metric of this.config.metrics) {
      const values = this.results
        .filter((r) => !r.error)
        .map((r) => r.metrics[metric]);

      result[metric] = this.computeAggregateMetric(values);
    }

    return result;
  }

  private computeAggregateMetric(values: number[]): AggregateMetric {
    if (values.length === 0) {
      return {
        mean: 0,
        median: 0,
        std: 0,
        min: 0,
        max: 0,
        percentiles: { p50: 0, p90: 0, p95: 0, p99: 0 },
      };
    }

    const sorted = [...values].sort((a, b) => a - b);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;

    return {
      mean,
      median: sorted[Math.floor(sorted.length / 2)],
      std: Math.sqrt(variance),
      min: sorted[0],
      max: sorted[sorted.length - 1],
      percentiles: {
        p50: sorted[Math.floor(sorted.length * 0.5)],
        p90: sorted[Math.floor(sorted.length * 0.9)],
        p95: sorted[Math.floor(sorted.length * 0.95)],
        p99: sorted[Math.floor(sorted.length * 0.99)],
      },
    };
  }

  private aggregateByTag(
    queries: EvaluationQuery[]
  ): Record<string, Record<MetricType, AggregateMetric>> {
    const byTag: Record<string, QueryEvaluationResult[]> = {};

    for (let i = 0; i < queries.length; i++) {
      const query = queries[i];
      const result = this.results[i];

      for (const tag of query.tags || ['untagged']) {
        if (!byTag[tag]) byTag[tag] = [];
        byTag[tag].push(result);
      }
    }

    const aggregated: Record<string, Record<MetricType, AggregateMetric>> = {};

    for (const [tag, results] of Object.entries(byTag)) {
      aggregated[tag] = {} as Record<MetricType, AggregateMetric>;
      for (const metric of this.config.metrics) {
        const values = results.filter((r) => !r.error).map((r) => r.metrics[metric]);
        aggregated[tag][metric] = this.computeAggregateMetric(values);
      }
    }

    return aggregated;
  }

  private generateSummary(
    metrics: Record<MetricType, AggregateMetric>
  ): EvaluationSummary {
    const findings: string[] = [];
    const recommendations: string[] = [];
    const failureReasons: string[] = [];

    // Check precision
    const precision = metrics.precision?.mean ?? 0;
    if (precision < this.config.minPrecision) {
      failureReasons.push(`Precision ${precision.toFixed(2)} below threshold ${this.config.minPrecision}`);
      recommendations.push('Improve embedding quality or add reranking');
    } else {
      findings.push(`Precision ${precision.toFixed(2)} meets threshold`);
    }

    // Check recall
    const recall = metrics.recall?.mean ?? 0;
    if (recall < this.config.minRecall) {
      failureReasons.push(`Recall ${recall.toFixed(2)} below threshold ${this.config.minRecall}`);
      recommendations.push('Expand query coverage or add graph traversal');
    } else {
      findings.push(`Recall ${recall.toFixed(2)} meets threshold`);
    }

    // Check latency
    const latency = metrics.latency?.percentiles.p95 ?? 0;
    if (latency > this.config.maxLatencyMs) {
      failureReasons.push(`P95 latency ${latency.toFixed(0)}ms exceeds threshold ${this.config.maxLatencyMs}ms`);
      recommendations.push('Optimize retrieval or enable caching');
    } else {
      findings.push(`P95 latency ${latency.toFixed(0)}ms within threshold`);
    }

    // Calculate quality score
    const qualityScore = Math.round(
      (precision / this.config.minPrecision * 40) +
      (recall / this.config.minRecall * 40) +
      (Math.max(0, (this.config.maxLatencyMs - latency) / this.config.maxLatencyMs) * 20)
    );

    const qualityGrade: 'A' | 'B' | 'C' | 'D' | 'F' =
      qualityScore >= 90 ? 'A' :
      qualityScore >= 80 ? 'B' :
      qualityScore >= 70 ? 'C' :
      qualityScore >= 60 ? 'D' : 'F';

    return {
      qualityGrade,
      qualityScore: Math.min(100, qualityScore),
      findings,
      recommendations,
      passed: failureReasons.length === 0,
      failureReasons: failureReasons.length > 0 ? failureReasons : undefined,
    };
  }

  private emptyMetrics(): Record<MetricType, number> {
    return {
      precision: 0,
      recall: 0,
      f1: 0,
      ndcg: 0,
      mrr: 0,
      map: 0,
      latency: 0,
      throughput: 0,
      confidence_calibration: 0,
    };
  }

  // ==========================================================================
  // UTILITIES
  // ==========================================================================

  /**
   * Reset results for new evaluation run.
   */
  reset(): void {
    this.results = [];
  }

  /**
   * Get current result count.
   */
  get resultCount(): number {
    return this.results.length;
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create an evaluation harness.
 */
export function createEvaluationHarness(
  config?: Partial<EvaluationConfig>
): EvaluationHarness {
  return new EvaluationHarness(config);
}
