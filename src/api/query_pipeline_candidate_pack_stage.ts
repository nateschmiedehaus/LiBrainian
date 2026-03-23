import type { LibrarianStorage } from '../storage/types.js';
import type {
  ContextPack,
  LibrarianQuery,
  LibrarianVersion,
  StageIssueSeverity,
  StageName,
} from '../types.js';
import type { GraphEntityType } from '../graphs/metrics.js';
import {
  configurable,
  resolveQuantifiedValue,
} from '../epistemics/quantification.js';
import type { StageTracker } from './query_stage_reporting.js';

const q = (value: number, range: [number, number], rationale: string): number =>
  resolveQuantifiedValue(configurable(value, range, rationale));

const FALLBACK_MIN_CONFIDENCE_MVP = q(
  0.45,
  [0, 1],
  'Fallback minimum confidence for MVP packs.'
);
const FALLBACK_MIN_CONFIDENCE_FULL = q(
  0.7,
  [0, 1],
  'Fallback minimum confidence for full packs.'
);
const FALLBACK_CANDIDATE_LIMIT = 80;
const FALLBACK_RESULT_LIMIT = 6;

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

export async function runCandidatePackStage(options: {
  storage: LibrarianStorage;
  query: LibrarianQuery;
  workspaceRoot: string;
  candidates: Candidate[];
  directPacks: ContextPack[];
  candidateScoreMap: Map<string, number>;
  stageTracker: StageTracker;
  recordCoverageGap: RecordCoverageGap;
  explanationParts: string[];
  version: LibrarianVersion;
  collectCandidatePacksFn: (
    storage: LibrarianStorage,
    candidates: Candidate[],
    depth: LibrarianQuery['depth'],
  ) => Promise<ContextPack[]>;
  dedupePacksFn: (packs: ContextPack[]) => ContextPack[];
  collectFilesystemFallbackPacksFn: (
    workspaceRoot: string,
    intent: string,
    version: LibrarianVersion,
  ) => Promise<ContextPack[]>;
  rankHeuristicFallbackPacksFn: (
    packs: ContextPack[],
    intent: string,
  ) => ContextPack[];
  scoreAnchoredDirectPackFn: (pack: ContextPack, intent: string) => number;
  filterPacksToWorkspaceFn: (
    packs: ContextPack[],
    workspaceRoot: string,
  ) => { packs: ContextPack[]; dropped: number };
}): Promise<{ allPacks: ContextPack[]; usedFilesystemFallback: boolean }> {
  const {
    storage,
    query,
    workspaceRoot,
    candidates,
    directPacks,
    candidateScoreMap,
    stageTracker,
    recordCoverageGap,
    explanationParts,
    version,
    collectCandidatePacksFn,
    dedupePacksFn,
    collectFilesystemFallbackPacksFn,
    rankHeuristicFallbackPacksFn,
    scoreAnchoredDirectPackFn,
    filterPacksToWorkspaceFn,
  } = options;
  const candidatePacks = await collectCandidatePacksFn(storage, candidates, query.depth);
  let usedFilesystemFallback = false;
  if (candidatePacks.length && candidates.length) {
    explanationParts.push(`Added ${candidatePacks.length} packs from semantic + graph candidates.`);
  }
  const allPacks = dedupePacksFn([...directPacks, ...candidatePacks]);
  if (!allPacks.length) {
    const fallbackStage = stageTracker.start('fallback', 1);
    const filesystemFallback = await collectFilesystemFallbackPacksFn(workspaceRoot, query.intent ?? '', version);
    if (filesystemFallback.length) {
      allPacks.push(...filesystemFallback);
      usedFilesystemFallback = true;
      explanationParts.push('Applied filesystem lexical fallback because indexed packs were unavailable.');
      stageTracker.finish(fallbackStage, { outputCount: filesystemFallback.length, filteredCount: 0 });
    } else {
      const fallbackMinConfidence = version.qualityTier === 'mvp'
        ? FALLBACK_MIN_CONFIDENCE_MVP
        : FALLBACK_MIN_CONFIDENCE_FULL;
      let fallbackCandidates = await storage.getContextPacks({ minConfidence: fallbackMinConfidence, limit: FALLBACK_CANDIDATE_LIMIT });
      if (!fallbackCandidates.length) fallbackCandidates = await storage.getContextPacks({ limit: FALLBACK_CANDIDATE_LIMIT });
      const fallback = rankHeuristicFallbackPacksFn(fallbackCandidates, query.intent ?? '').slice(0, FALLBACK_RESULT_LIMIT);
      if (fallback.length) {
        allPacks.push(...fallback);
        explanationParts.push('Applied heuristic fallback ranking (lexical + outcome-weighted) because semantic match was unavailable.');
        stageTracker.finish(fallbackStage, { outputCount: fallback.length, filteredCount: 0 });
      } else {
        recordCoverageGap(
          'fallback',
          'No context packs available from storage.',
          'significant',
          'Run bootstrap or lower the minimum confidence threshold.'
        );
        stageTracker.finish(fallbackStage, { outputCount: 0, filteredCount: 0, status: 'failed' });
      }
    }
  }
  if (directPacks.length) {
    for (const pack of directPacks) {
      const existing = candidateScoreMap.get(pack.targetId) ?? 0;
      candidateScoreMap.set(
        pack.targetId,
        Math.max(existing, scoreAnchoredDirectPackFn(pack, query.intent ?? ''))
      );
    }
  }
  const workspaceScoped = filterPacksToWorkspaceFn(allPacks, workspaceRoot);
  if (workspaceScoped.dropped > 0) {
    recordCoverageGap(
      'post_processing',
      `Filtered ${workspaceScoped.dropped} context packs that were outside the current workspace root.`,
      'significant',
      'Run `librainian bootstrap --force --mode fast` to rebuild workspace-scoped packs.'
    );
    explanationParts.push(`Filtered ${workspaceScoped.dropped} out-of-workspace packs.`);
  }
  return { allPacks: workspaceScoped.packs, usedFilesystemFallback };
}
