/**
 * @fileoverview Retrieval metric utilities for evaluation runner.
 */

export interface RetrievalMetrics {
  recallAtK: Record<number, number>;
  precisionAtK: Record<number, number>;
  ndcgAtK: Record<number, number>;
  mrr: number;
  map: number;
  hitAtK: Record<number, boolean>;
}

export interface RetrievalMetricOptions {
  retrievedDocs: string[];
  relevantDocs: string[];
  kValues: readonly number[];
  gradedRelevance?: Record<string, number>;
}

export function computeRetrievalMetrics(options: RetrievalMetricOptions): RetrievalMetrics {
  const { retrievedDocs, relevantDocs, kValues, gradedRelevance } = options;
  const relevantSet = new Set(relevantDocs);

  const recallAtK: Record<number, number> = {};
  const precisionAtK: Record<number, number> = {};
  const ndcgAtK: Record<number, number> = {};
  const hitAtK: Record<number, boolean> = {};

  for (const k of kValues) {
    const topK = retrievedDocs.slice(0, k);
    const uniqueHits = new Set<string>();

    for (const doc of topK) {
      if (relevantSet.has(doc)) {
        uniqueHits.add(doc);
      }
    }

    const hitCount = uniqueHits.size;
    recallAtK[k] = relevantSet.size > 0 ? hitCount / relevantSet.size : 0;
    precisionAtK[k] = k > 0 ? hitCount / k : 0;
    hitAtK[k] = hitCount > 0;
    ndcgAtK[k] = computeNdcg(topK, relevantDocs, gradedRelevance);
  }

  const firstRelevantRank = retrievedDocs.findIndex((doc) => relevantSet.has(doc));
  const mrr = firstRelevantRank >= 0 ? 1 / (firstRelevantRank + 1) : 0;

  return {
    recallAtK,
    precisionAtK,
    ndcgAtK,
    mrr,
    map: computeMap(retrievedDocs, relevantDocs),
    hitAtK,
  };
}

function computeNdcg(
  rankedDocs: string[],
  relevantDocs: string[],
  gradedRelevance?: Record<string, number>
): number {
  const relevantSet = new Set(relevantDocs);

  let dcg = 0;
  for (let i = 0; i < rankedDocs.length; i++) {
    const doc = rankedDocs[i];
    const relevance = gradedRelevance
      ? (gradedRelevance[doc] ?? 0)
      : relevantSet.has(doc)
        ? 1
        : 0;
    dcg += relevance / Math.log2(i + 2);
  }

  const idealDocs = relevantDocs.length > 0
    ? relevantDocs
    : Object.keys(gradedRelevance ?? {});
  const idealRelevances = idealDocs
    .map((doc) => gradedRelevance?.[doc] ?? 1)
    .sort((a, b) => b - a)
    .slice(0, rankedDocs.length);

  let idcg = 0;
  for (let i = 0; i < idealRelevances.length; i++) {
    idcg += idealRelevances[i] / Math.log2(i + 2);
  }

  return idcg > 0 ? dcg / idcg : 0;
}

function computeMap(retrievedDocs: string[], relevantDocs: string[]): number {
  if (relevantDocs.length === 0) return 0;
  const relevantSet = new Set(relevantDocs);
  const seen = new Set<string>();
  let hits = 0;
  let sumPrecision = 0;

  for (let i = 0; i < retrievedDocs.length; i++) {
    const doc = retrievedDocs[i];
    if (relevantSet.has(doc) && !seen.has(doc)) {
      hits++;
      seen.add(doc);
      sumPrecision += hits / (i + 1);
    }
  }

  return hits > 0 ? sumPrecision / relevantSet.size : 0;
}
