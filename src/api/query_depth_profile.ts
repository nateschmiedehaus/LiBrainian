import type { LibrarianQuery } from '../types.js';
import { configurable, resolveQuantifiedValue } from '../epistemics/quantification.js';

const q = (value: number, range: [number, number], rationale: string): number =>
  resolveQuantifiedValue(configurable(value, range, rationale));

type QueryDepthProfile = Exclude<LibrarianQuery['depth'], undefined>;

const DEFAULT_QUERY_DEPTH_PROFILE: QueryDepthProfile = 'L1';

const SEMANTIC_CANDIDATE_WINDOW_BY_DEPTH: Record<QueryDepthProfile, number> = {
  L0: Math.max(0, Math.round(q(0, [0, 40], 'Semantic candidate window for L0 depth.'))),
  L1: Math.max(0, Math.round(q(12, [0, 40], 'Semantic candidate window for L1 depth.'))),
  L2: Math.max(0, Math.round(q(16, [0, 40], 'Semantic candidate window for L2 depth.'))),
  L3: Math.max(0, Math.round(q(20, [0, 40], 'Semantic candidate window for L3 depth.'))),
};

const SEMANTIC_META_CANDIDATE_WINDOW_BONUS = Math.max(
  0,
  Math.round(q(4, [0, 20], 'Additional semantic candidate window for meta-queries.')),
);

const SEMANTIC_META_CANDIDATE_WINDOW_MAX = Math.max(
  0,
  Math.round(q(24, [0, 60], 'Maximum semantic candidate window for meta-queries.')),
);

const RERANK_WINDOW_BY_DEPTH: Record<QueryDepthProfile, number> = {
  L0: Math.max(0, Math.round(q(0, [0, 40], 'Cross-encoder rerank window for L0 depth.'))),
  L1: Math.max(0, Math.round(q(0, [0, 40], 'Cross-encoder rerank window for L1 depth.'))),
  L2: Math.max(0, Math.round(q(10, [0, 40], 'Cross-encoder rerank window for L2 depth.'))),
  L3: Math.max(0, Math.round(q(14, [0, 40], 'Cross-encoder rerank window for L3 depth.'))),
};

export function resolveQueryDepthProfile(depth: LibrarianQuery['depth'] | undefined): QueryDepthProfile {
  return depth ?? DEFAULT_QUERY_DEPTH_PROFILE;
}

export function resolveSemanticCandidateWindow(
  depth: LibrarianQuery['depth'] | undefined,
  isMetaQuery: boolean,
): number {
  const baseWindow = SEMANTIC_CANDIDATE_WINDOW_BY_DEPTH[resolveQueryDepthProfile(depth)];
  if (!isMetaQuery || baseWindow <= 0) {
    return baseWindow;
  }
  return Math.min(
    SEMANTIC_META_CANDIDATE_WINDOW_MAX,
    baseWindow + SEMANTIC_META_CANDIDATE_WINDOW_BONUS,
  );
}

export function resolveRerankWindow(depth: LibrarianQuery['depth'] | undefined): number {
  return RERANK_WINDOW_BY_DEPTH[resolveQueryDepthProfile(depth)];
}
