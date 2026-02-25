import type { GraphEntityType } from '../graphs/metrics.js';

export interface QueryCandidateMergeInput {
  entityId: string;
  entityType: GraphEntityType;
  path?: string;
  semanticSimilarity: number;
  graphSimilarity?: number;
  cochange?: number;
  confidence: number;
  recency: number;
}

export function candidateKey(candidate: QueryCandidateMergeInput): string {
  return `${candidate.entityType}:${candidate.entityId}`;
}

export function mergeCandidates<T extends QueryCandidateMergeInput>(
  primary: T[],
  additions: T[]
): T[] {
  const map = new Map<string, T>();
  for (const candidate of [...primary, ...additions]) {
    const key = candidateKey(candidate);
    const existing = map.get(key);
    if (!existing) {
      map.set(key, candidate);
      continue;
    }
    existing.semanticSimilarity = Math.max(existing.semanticSimilarity, candidate.semanticSimilarity);
    if (candidate.graphSimilarity !== undefined) {
      existing.graphSimilarity = Math.max(existing.graphSimilarity ?? 0, candidate.graphSimilarity);
    }
    if (!existing.path && candidate.path) {
      existing.path = candidate.path;
    }
    if (candidate.cochange !== undefined) {
      existing.cochange = Math.max(existing.cochange ?? 0, candidate.cochange);
    }
    existing.confidence = Math.max(existing.confidence, candidate.confidence);
    existing.recency = Math.max(existing.recency, candidate.recency);
  }
  return Array.from(map.values());
}
