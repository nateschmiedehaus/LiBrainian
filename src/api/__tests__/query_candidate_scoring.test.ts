import { describe, expect, it } from 'vitest';
import type { QueryCandidateScoringInput } from '../query_candidate_scoring.js';
import {
  computeCentrality,
  computeRecency,
  scoreCandidates,
} from '../query_candidate_scoring.js';

describe('query_candidate_scoring', () => {
  it('returns default recency when timestamp is missing', () => {
    expect(computeRecency(null, 0.5, 30)).toBe(0.5);
  });

  it('computes decayed recency for older timestamps', () => {
    const nowMs = Date.UTC(2026, 0, 30);
    const thirtyDaysOld = new Date(Date.UTC(2025, 11, 31));
    const recency = computeRecency(thirtyDaysOld, 0.5, 30, nowMs);
    expect(recency).toBeCloseTo(Math.exp(-1), 10);
  });

  it('computes graph centrality as mean of centrality dimensions', () => {
    const centrality = computeCentrality({
      entityId: 'func:a',
      entityType: 'function',
      betweenness: 0.2,
      closeness: 0.5,
      eigenvector: 0.8,
      pagerank: 0.1,
      inDegree: 1,
      outDegree: 2,
      totalDegree: 3,
      communityId: 0,
    });
    expect(centrality).toBeCloseTo(0.5, 10);
  });

  it('scores candidates using max of semantic and graph similarity signals', () => {
    const candidates: QueryCandidateScoringInput[] = [
      {
        semanticSimilarity: 0.2,
        graphSimilarity: 0.9,
        pagerank: 0.5,
        centrality: 0.5,
        confidence: 0.5,
        recency: 0.5,
      },
      {
        semanticSimilarity: 0.8,
        graphSimilarity: 0.1,
        pagerank: 0.5,
        centrality: 0.5,
        confidence: 0.5,
        recency: 0.5,
      },
    ];

    scoreCandidates(candidates, {
      semantic: 1,
      pagerank: 0,
      centrality: 0,
      confidence: 0,
      recency: 0,
      cochange: 0,
    });

    expect(candidates[0].score).toBe(1);
    expect(candidates[1].score).toBe(0);
  });
});
