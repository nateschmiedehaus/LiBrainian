import type {
  ContextPack,
  LibrarianQuery,
  StageIssueSeverity,
  StageName,
} from '../types.js';

const MMR_DEFAULT_LAMBDA = 0.5;

export type CoverageGapRecorder = (
  stage: StageName,
  message: string,
  severity?: StageIssueSeverity
) => void;

export function tokenizeForMmr(pack: ContextPack): string[] {
  const parts: string[] = [pack.targetId, pack.summary];
  if (Array.isArray(pack.keyFacts)) {
    parts.push(...pack.keyFacts);
  }
  if (Array.isArray(pack.relatedFiles)) {
    parts.push(...pack.relatedFiles);
  }
  return parts
    .join(' ')
    .toLowerCase()
    .split(/[^a-z0-9_]+/g)
    .filter((token) => token.length >= 2);
}

export function buildTfVector(tokens: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return counts;
}

export function cosineSimilarity(left: Map<string, number>, right: Map<string, number>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let dot = 0;
  let normLeft = 0;
  let normRight = 0;
  for (const value of left.values()) {
    normLeft += value * value;
  }
  for (const value of right.values()) {
    normRight += value * value;
  }
  for (const [token, leftValue] of left.entries()) {
    const rightValue = right.get(token);
    if (!rightValue) continue;
    dot += leftValue * rightValue;
  }
  if (normLeft === 0 || normRight === 0) return 0;
  return dot / (Math.sqrt(normLeft) * Math.sqrt(normRight));
}

export function clampMmrLambda(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return MMR_DEFAULT_LAMBDA;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

export function applyMmrDiversification(options: {
  packs: ContextPack[];
  query: LibrarianQuery;
  candidateScoreMap: Map<string, number>;
  explanationParts: string[];
  recordCoverageGap: CoverageGapRecorder;
}): ContextPack[] {
  const { packs, query, candidateScoreMap, explanationParts, recordCoverageGap } = options;
  if (query.diversify !== true || packs.length < 2) return packs;

  const lambda = clampMmrLambda(query.diversityLambda);
  const vectors = packs.map((pack) => buildTfVector(tokenizeForMmr(pack)));
  const relevance = packs.map((pack) => {
    const scored = candidateScoreMap.get(pack.targetId) ?? pack.confidence;
    return Number.isFinite(scored)
      ? Math.max(0, Math.min(1, scored))
      : Math.max(0, Math.min(1, pack.confidence));
  });

  if (relevance.every((value) => value === 0)) {
    recordCoverageGap('reranking', 'MMR diversification skipped due to zero relevance scores.', 'minor');
    return packs;
  }

  const selectedIndexes: number[] = [];
  const remaining = new Set<number>(packs.map((_, index) => index));

  while (remaining.size > 0) {
    let bestIndex = -1;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const index of remaining) {
      const maxSimilarity = selectedIndexes.length === 0
        ? 0
        : Math.max(...selectedIndexes.map((picked) => cosineSimilarity(vectors[index], vectors[picked])));
      const mmrScore = (lambda * relevance[index]) - ((1 - lambda) * maxSimilarity);
      if (mmrScore > bestScore) {
        bestScore = mmrScore;
        bestIndex = index;
      }
    }
    if (bestIndex < 0) break;
    remaining.delete(bestIndex);
    selectedIndexes.push(bestIndex);
  }

  if (selectedIndexes.length !== packs.length) {
    recordCoverageGap(
      'reranking',
      'MMR diversification produced incomplete output; preserving original order.',
      'minor'
    );
    return packs;
  }

  explanationParts.push(`Applied MMR diversification (lambda=${lambda.toFixed(2)}) to reduce redundant packs.`);
  return selectedIndexes.map((index) => packs[index]);
}
