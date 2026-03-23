import type {
  LibrarianStorage,
  MultiVectorRecord,
  MultiVectorQueryOptions,
  StorageCapabilities,
} from '../storage/types.js';
import type {
  LibrarianQuery,
  StageIssueSeverity,
  StageName,
} from '../types.js';
import type { GraphEntityType } from '../graphs/metrics.js';
import { configurable, resolveQuantifiedValue } from '../epistemics/quantification.js';
import { scoreCandidatesWithMultiSignals } from '../query/scoring.js';
import { scoreCandidates } from './query_candidate_scoring.js';
import { deserializeMultiVector, queryMultiVectors, QUERY_TYPE_WEIGHTS, type SerializedMultiVector } from './embedding_providers/multi_vector_representations.js';
import type { StageTracker } from './query_stage_reporting.js';

const q = (value: number, range: [number, number], rationale: string): number =>
  resolveQuantifiedValue(configurable(value, range, rationale));

const SCORE_WEIGHTS = {
  semantic: q(0.35, [0, 1], 'Semantic similarity weight for candidate scoring.'),
  pagerank: q(0.2, [0, 1], 'PageRank weight for candidate scoring.'),
  centrality: q(0.1, [0, 1], 'Graph centrality weight for candidate scoring.'),
  confidence: q(0.2, [0, 1], 'Stored confidence weight for candidate scoring.'),
  recency: q(0.1, [0, 1], 'Recency weight for candidate scoring.'),
  cochange: q(0.05, [0, 1], 'Co-change signal weight for candidate scoring.'),
};
const MULTI_VECTOR_BLEND_WEIGHT = q(0.18, [0, 1], 'Blend weight for multi-vector reranking.');
const BLEND_WEIGHT_MIN = q(0.05, [0, 1], 'Minimum blend weight for rescoring.');
const BLEND_WEIGHT_MAX = q(0.9, [0, 1], 'Maximum blend weight for rescoring.');

type Candidate = {
  entityId: string;
  entityType: GraphEntityType;
  path?: string;
  semanticSimilarity: number;
  confidence: number;
  recency: number;
  pagerank: number;
  centrality: number;
  communityId: number | null;
  graphSimilarity?: number;
  cochange?: number;
  score?: number;
};

export type RecordCoverageGap = (
  stage: StageName,
  message: string,
  severity?: StageIssueSeverity,
  remediation?: string,
) => void;

export async function runScoringStage(options: {
  storage: LibrarianStorage;
  query: LibrarianQuery;
  candidates: Candidate[];
  queryEmbedding: Float32Array | null;
  stageTracker: StageTracker;
  recordCoverageGap: RecordCoverageGap;
  capabilities: StorageCapabilities;
  explanationParts: string[];
}): Promise<{ candidates: Candidate[]; candidateScoreMap: Map<string, number> }> {
  const {
    storage,
    query,
    candidates,
    queryEmbedding,
    stageTracker,
    recordCoverageGap,
    capabilities,
    explanationParts,
  } = options;
  const candidateScoreMap = new Map<string, number>();
  const scoringStage = stageTracker.start('multi_signal_scoring', candidates.length);
  if (candidates.length) {
    let scoredMap: Map<string, { combinedScore: number }> | null = null;
    try {
      scoredMap = await scoreCandidatesWithMultiSignals(storage, candidates, query, queryEmbedding);
    } catch {
      scoredMap = null;
    }

    if (!scoredMap || scoredMap.size === 0) {
      recordCoverageGap('multi_signal_scoring', 'Multi-signal scorer unavailable; using baseline signal weights.', 'minor');
      scoreCandidates(candidates, SCORE_WEIGHTS);
      explanationParts.push('Scored candidates using baseline signal weights (multi-signal scorer unavailable).');
    } else {
      for (const candidate of candidates) {
        const scored = scoredMap.get(candidate.entityId);
        if (scored) {
          candidate.score = scored.combinedScore;
        }
      }
      explanationParts.push('Scored candidates using multi-signal relevance model.');
    }

    if (queryEmbedding && query.intent) {
      const moduleCandidateCount = candidates.filter((candidate) => candidate.entityType === 'module').length;
      const multiVectorStage = stageTracker.start('multi_vector_scoring', moduleCandidateCount);
      if (!moduleCandidateCount) {
        stageTracker.finish(multiVectorStage, { outputCount: 0, filteredCount: 0, status: 'skipped' });
      } else if (!capabilities.optional.multiVectors) {
        recordCoverageGap(
          'multi_vector_scoring',
          'Multi-vector embeddings unsupported by storage.',
          'moderate',
          'Use a storage backend that supports multi-vector embeddings.'
        );
        stageTracker.finish(multiVectorStage, { outputCount: 0, filteredCount: moduleCandidateCount, status: 'skipped' });
      } else {
        try {
          const multiVectorStats = await applyMultiVectorScores({
            storage,
            candidates,
            query,
            queryEmbedding,
          });
          if (multiVectorStats.applied > 0) {
            explanationParts.push(`Applied multi-vector scoring to ${multiVectorStats.applied} module candidates.`);
          }
          if (multiVectorStats.missing > 0) {
            recordCoverageGap(
              'multi_vector_scoring',
              `Multi-vector embeddings missing for ${multiVectorStats.missing} module candidates.`,
              'minor'
            );
          }
          const multiVectorStatus = multiVectorStats.applied > 0 ? undefined : 'partial';
          stageTracker.finish(multiVectorStage, {
            outputCount: multiVectorStats.applied,
            filteredCount: multiVectorStats.missing,
            status: multiVectorStatus,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          recordCoverageGap('multi_vector_scoring', `Multi-vector scoring unavailable (${message}).`, 'moderate');
          stageTracker.finish(multiVectorStage, { outputCount: 0, filteredCount: moduleCandidateCount, status: 'failed' });
        }
      }
    }

    for (const candidate of candidates) {
      if (typeof candidate.score === 'number') {
        candidateScoreMap.set(candidate.entityId, candidate.score);
        candidateScoreMap.set(`${candidate.entityType}:${candidate.entityId}`, candidate.score);
      }
    }
    stageTracker.finish(scoringStage, { outputCount: candidates.length, filteredCount: 0 });
  } else {
    stageTracker.finish(scoringStage, { outputCount: 0, filteredCount: 0, status: 'skipped' });
  }

  return { candidates, candidateScoreMap };
}

async function applyMultiVectorScores(options: {
  storage: LibrarianStorage;
  candidates: Candidate[];
  query: LibrarianQuery;
  queryEmbedding: Float32Array;
}): Promise<{ applied: number; missing: number }> {
  const { storage, candidates, query, queryEmbedding } = options;
  const moduleCandidates = candidates.filter((candidate) => candidate.entityType === 'module');
  if (!moduleCandidates.length) return { applied: 0, missing: 0 };
  const multiVectorStore = storage as LibrarianStorage & {
    getMultiVectors?: (options?: MultiVectorQueryOptions) => Promise<MultiVectorRecord[]>;
  };
  if (!multiVectorStore.getMultiVectors) {
    return { applied: 0, missing: moduleCandidates.length };
  }
  const records = await multiVectorStore.getMultiVectors({
    entityIds: moduleCandidates.map((candidate) => candidate.entityId),
    entityType: 'module',
  });
  if (!records.length) return { applied: 0, missing: moduleCandidates.length };
  const vectors = records.map((record) => {
    const vector = deserializeMultiVector(record.payload as SerializedMultiVector);
    return { ...vector, filePath: record.entityId };
  });
  const queryType = resolveMultiVectorQueryType(query);
  const matches = await queryMultiVectors(
    {
      queryText: query.intent,
      queryEmbedding,
    },
    vectors,
    {
      topK: vectors.length,
      queryType,
    }
  );
  const matchByEntity = new Map(matches.map((match) => [match.filePath, match]));
  let applied = 0;
  for (const candidate of moduleCandidates) {
    const match = matchByEntity.get(candidate.entityId);
    if (!match) continue;
    candidate.score = blendScores(candidate.score, match.weightedScore, MULTI_VECTOR_BLEND_WEIGHT);
    applied += 1;
  }
  const missing = Math.max(0, moduleCandidates.length - records.length);
  return { applied, missing };
}

function resolveMultiVectorQueryType(query: LibrarianQuery): keyof typeof QUERY_TYPE_WEIGHTS {
  const taskType = query.taskType?.toLowerCase() ?? '';
  const intent = query.intent?.toLowerCase() ?? '';
  const combined = `${taskType} ${intent}`.trim();
  if (!combined) return 'default';
  if (matchesAny(combined, ['what does', 'what is', 'explain', 'purpose', 'understand', 'how does', 'why does', 'describe', 'overview', 'summary'])) {
    return 'purpose-query';
  }
  if (matchesAny(combined, ['api', 'interface', 'contract', 'schema', 'endpoint', 'client', 'signature', 'public'])) {
    return 'compatible-apis';
  }
  if (matchesAny(combined, ['dependency', 'dependencies', 'import', 'integration', 'module', 'impact', 'coupling', 'graph'])) {
    return 'related-modules';
  }
  if (matchesAny(combined, ['structure', 'architecture', 'pattern', 'refactor', 'design', 'layout'])) {
    return 'similar-structure';
  }
  if (matchesAny(combined, ['similar', 'equivalent', 'analogue', 'analogy', 'compare', 'related'])) {
    return 'similar-purpose';
  }
  return 'default';
}

function matchesAny(value: string, needles: string[]): boolean {
  return needles.some((needle) => value.includes(needle));
}

function blendScores(base: number | undefined, extra: number, weight: number): number {
  if (typeof base !== 'number' || Number.isNaN(base)) return extra;
  const clampedWeight = Math.min(BLEND_WEIGHT_MAX, Math.max(BLEND_WEIGHT_MIN, weight));
  return base * (1 - clampedWeight) + extra * clampedWeight;
}
