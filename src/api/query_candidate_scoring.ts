import type { GraphMetricsEntry } from '../graphs/metrics.js';

export interface QueryCandidateScoringInput {
  semanticSimilarity: number;
  graphSimilarity?: number;
  pagerank: number;
  centrality: number;
  confidence: number;
  recency: number;
  cochange?: number;
  score?: number;
}

export interface QueryCandidateScoreWeights {
  semantic: number;
  pagerank: number;
  centrality: number;
  confidence: number;
  recency: number;
  cochange: number;
}

function scoreRange(values: number[]): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const value of values) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return { min: 0, max: 0 };
  }
  return { min, max };
}

function normalizeScore(value: number, range: { min: number; max: number }): number {
  const span = range.max - range.min;
  if (span <= 0) return range.max > 0 ? 1 : 0;
  return (value - range.min) / span;
}

export function computeRecency(
  date: Date | null,
  entityRecencyDefault: number,
  recencyDecayDays: number,
  nowMs: number = Date.now()
): number {
  if (!date) return entityRecencyDefault;
  const ageDays = (nowMs - date.getTime()) / (1000 * 60 * 60 * 24);
  const score = Math.exp(-ageDays / recencyDecayDays);
  return Math.max(0, Math.min(1, score));
}

export function computeCentrality(metrics: GraphMetricsEntry): number {
  return (metrics.betweenness + metrics.closeness + metrics.eigenvector) / 3;
}

export function scoreCandidates<T extends QueryCandidateScoringInput>(
  candidates: T[],
  weights: QueryCandidateScoreWeights
): void {
  if (!candidates.length) return;
  const semanticValues = candidates.map((candidate) =>
    Math.max(candidate.semanticSimilarity, candidate.graphSimilarity ?? 0)
  );
  const pagerankValues = candidates.map((candidate) => candidate.pagerank);
  const centralityValues = candidates.map((candidate) => candidate.centrality);
  const confidenceValues = candidates.map((candidate) => candidate.confidence);
  const recencyValues = candidates.map((candidate) => candidate.recency);
  const cochangeValues = candidates.map((candidate) => candidate.cochange ?? 0);
  const semanticRange = scoreRange(semanticValues);
  const pagerankRange = scoreRange(pagerankValues);
  const centralityRange = scoreRange(centralityValues);
  const confidenceRange = scoreRange(confidenceValues);
  const recencyRange = scoreRange(recencyValues);
  const cochangeRange = scoreRange(cochangeValues);
  for (const candidate of candidates) {
    const semanticSignal = Math.max(candidate.semanticSimilarity, candidate.graphSimilarity ?? 0);
    candidate.score = weights.semantic * normalizeScore(semanticSignal, semanticRange)
      + weights.pagerank * normalizeScore(candidate.pagerank, pagerankRange)
      + weights.centrality * normalizeScore(candidate.centrality, centralityRange)
      + weights.confidence * normalizeScore(candidate.confidence, confidenceRange)
      + weights.recency * normalizeScore(candidate.recency, recencyRange)
      + weights.cochange * normalizeScore(candidate.cochange ?? 0, cochangeRange);
  }
}
