import path from 'node:path';

import type {
  LibrarianStorage,
  StorageCapabilities,
} from '../storage/types.js';
import type {
  ContextPack,
  LibrarianQuery,
  StageIssueSeverity,
  StageName,
} from '../types.js';
import type {
  GraphEntityType,
  GraphMetricsEntry,
} from '../graphs/metrics.js';
import {
  buildMetricEmbeddings,
  findGraphNeighbors,
} from '../graphs/embeddings.js';
import {
  configurable,
  resolveQuantifiedValue,
} from '../epistemics/quantification.js';
import {
  computeCentrality,
  computeRecency,
} from './query_candidate_scoring.js';
import {
  candidateKey,
  mergeCandidates,
} from './query_candidate_merge.js';
import { resolveWorkspaceRoot } from './query_retrieval_observability.js';
import type { StageTracker } from './query_stage_reporting.js';

const q = (value: number, range: [number, number], rationale: string): number =>
  resolveQuantifiedValue(configurable(value, range, rationale));

const GRAPH_NEIGHBOR_MIN_SIMILARITY = q(
  0.6,
  [0, 1],
  'Minimum similarity for graph-neighbor expansion.'
);
const ENTITY_CONFIDENCE_FALLBACK = q(0.4, [0, 1], 'Fallback confidence for missing entity stats.');
const ENTITY_RECENCY_DEFAULT = q(0.5, [0, 1], 'Default recency for entities without timestamps.');
const ENTITY_RECENCY_FALLBACK = q(0.4, [0, 1], 'Fallback recency when entity stats are missing.');
const RECENCY_DECAY_DAYS = q(30, [1, 365], 'Recency decay window in days.');

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

type GraphMetricsStore = LibrarianStorage & {
  getGraphMetrics?: (options?: {
    entityIds?: string[];
    entityType?: GraphEntityType;
  }) => Promise<GraphMetricsEntry[]>;
};

export type RecordCoverageGap = (
  stage: StageName,
  message: string,
  severity?: StageIssueSeverity,
  remediation?: string,
) => void;

export async function runGraphExpansionStage(options: {
  storage: LibrarianStorage;
  query: LibrarianQuery;
  candidates: Candidate[];
  stageTracker: StageTracker;
  recordCoverageGap: RecordCoverageGap;
  capabilities: StorageCapabilities;
  explanationParts: string[];
  directPacks: ContextPack[];
}): Promise<Candidate[]> {
  const {
    storage,
    query,
    candidates: initialCandidates,
    stageTracker,
    recordCoverageGap,
    capabilities,
    explanationParts,
    directPacks,
  } = options;
  let candidates = initialCandidates;
  const graphStage = stageTracker.start('graph_expansion', candidates.length);
  let graphStageFinished = false;
  let expansion: { candidates: Candidate[]; communityAdded: number; graphAdded: number } = {
    candidates: [],
    communityAdded: 0,
    graphAdded: 0,
  };
  const graphStore = storage as GraphMetricsStore;
  const metricsByType = new Map<GraphEntityType, GraphMetricsEntry[]>();
  if (candidates.length) {
    const metricsLoaded = await loadGraphMetrics(graphStore, candidates, metricsByType, recordCoverageGap, capabilities);
    if (metricsLoaded) {
      applyGraphMetrics(candidates, metricsByType);
      expansion = await expandCandidates(candidates, metricsByType, storage, query.depth);
    } else {
      stageTracker.finish(graphStage, { outputCount: 0, filteredCount: 0, status: 'skipped' });
      graphStageFinished = true;
    }
  } else {
    stageTracker.finish(graphStage, { outputCount: 0, filteredCount: 0, status: 'skipped' });
    graphStageFinished = true;
  }
  if (!graphStageFinished) {
    stageTracker.finish(graphStage, { outputCount: expansion.candidates.length, filteredCount: 0 });
  }
  if (expansion.candidates.length) {
    candidates = mergeCandidates(candidates, expansion.candidates);
    applyGraphMetrics(candidates, metricsByType);
  }
  if (expansion.communityAdded > 0) explanationParts.push(`Added ${expansion.communityAdded} community neighbors.`);
  if (expansion.graphAdded > 0) explanationParts.push(`Added ${expansion.graphAdded} graph-similar entities.`);
  if (candidates.length) {
    const anchorFiles = resolveCochangeAnchors(query, directPacks);
    if (anchorFiles.length) {
      const boosted = await applyCochangeScores(storage, candidates, anchorFiles);
      if (boosted > 0) explanationParts.push(`Applied co-change boosts for ${boosted} candidates.`);
    }
  }
  return candidates;
}

export async function getEntityStats(
  entityId: string,
  entityType: GraphEntityType | 'document',
  storage: LibrarianStorage,
  similarityScore?: number,
): Promise<{ confidence: number; recency: number; path?: string }> {
  try {
    if (entityType === 'function') {
      const fn = await storage.getFunction(entityId);
      return {
        confidence: fn?.confidence ?? ENTITY_CONFIDENCE_FALLBACK,
        recency: computeRecency(fn?.lastAccessed ?? null, ENTITY_RECENCY_DEFAULT, RECENCY_DECAY_DAYS),
        path: fn?.filePath,
      };
    }
    if (entityType === 'document') {
      const docItem = await storage.getIngestionItem(entityId);
      const payload = docItem?.payload as { path?: string } | undefined;
      return {
        confidence: similarityScore ?? 0.5,
        recency: 0.9,
        path: payload?.path ?? entityId.replace(/^doc:/, ''),
      };
    }
    const mod = await storage.getModule(entityId);
    return {
      confidence: mod?.confidence ?? ENTITY_CONFIDENCE_FALLBACK,
      recency: ENTITY_RECENCY_DEFAULT,
      path: mod?.path,
    };
  } catch {
    return { confidence: ENTITY_CONFIDENCE_FALLBACK, recency: ENTITY_RECENCY_FALLBACK };
  }
}

async function loadGraphMetrics(
  storage: GraphMetricsStore,
  candidates: Candidate[],
  metricsByType: Map<GraphEntityType, GraphMetricsEntry[]>,
  recordCoverageGap: RecordCoverageGap,
  capabilities: StorageCapabilities,
): Promise<boolean> {
  if (!capabilities.optional.graphMetrics || !storage.getGraphMetrics) {
    recordCoverageGap('graph_expansion', 'Graph metrics unavailable for scoring.', 'moderate', 'Re-run bootstrap with graph metrics enabled.');
    return false;
  }
  let anyMetrics = false;
  const types = Array.from(new Set(candidates.map((candidate) => candidate.entityType)));
  for (const type of types) {
    try {
      const metrics = await storage.getGraphMetrics({ entityType: type });
      if (metrics.length) {
        metricsByType.set(type, metrics);
        anyMetrics = true;
      } else {
        recordCoverageGap('graph_expansion', `Graph metrics missing for ${type} entities.`, 'moderate');
      }
    } catch {
      recordCoverageGap('graph_expansion', `Graph metrics lookup failed for ${type} entities.`, 'moderate');
    }
  }
  return anyMetrics;
}

function applyGraphMetrics(candidates: Candidate[], metricsByType: Map<GraphEntityType, GraphMetricsEntry[]>): void {
  const cache = new Map<GraphEntityType, Map<string, GraphMetricsEntry>>();
  for (const [type, metrics] of metricsByType) {
    const map = new Map<string, GraphMetricsEntry>();
    for (const entry of metrics) map.set(entry.entityId, entry);
    cache.set(type, map);
  }
  for (const candidate of candidates) {
    const metrics = cache.get(candidate.entityType)?.get(candidate.entityId);
    if (!metrics) continue;
    candidate.pagerank = metrics.pagerank;
    candidate.centrality = computeCentrality(metrics);
    candidate.communityId = metrics.communityId;
  }
}

async function expandCandidates(
  candidates: Candidate[],
  metricsByType: Map<GraphEntityType, GraphMetricsEntry[]>,
  storage: LibrarianStorage,
  depth: LibrarianQuery['depth'],
): Promise<{ candidates: Candidate[]; communityAdded: number; graphAdded: number }> {
  if (!candidates.length || !metricsByType.size) return { candidates: [], communityAdded: 0, graphAdded: 0 };
  const bySignal = [...candidates].sort((left, right) => right.semanticSimilarity - left.semanticSimilarity);
  const topCandidates = bySignal.slice(0, 3);
  const existing = new Set(candidates.map((candidate) => candidateKey(candidate)));
  const expansions: Candidate[] = [];
  let communityAdded = 0;
  let graphAdded = 0;
  const communityLimit = depth === 'L3' ? 6 : depth === 'L2' ? 4 : 2;
  const graphLimit = depth === 'L3' ? 6 : depth === 'L2' ? 4 : 2;
  const embeddingsByType = new Map<GraphEntityType, Map<string, Float32Array>>();
  for (const [type, metrics] of metricsByType) {
    embeddingsByType.set(type, buildMetricEmbeddings(metrics));
  }
  for (const candidate of topCandidates) {
    const metrics = metricsByType.get(candidate.entityType);
    if (!metrics) continue;
    if (candidate.communityId !== null) {
      const communityMembers = metrics
        .filter((entry) => entry.communityId === candidate.communityId)
        .sort((left, right) => right.pagerank - left.pagerank);
      for (const entry of communityMembers) {
        if (communityAdded >= communityLimit) break;
        const key = `${candidate.entityType}:${entry.entityId}`;
        if (existing.has(key)) continue;
        existing.add(key);
        const stats = await getEntityStats(entry.entityId, candidate.entityType, storage);
        expansions.push({
          entityId: entry.entityId,
          entityType: candidate.entityType,
          path: stats.path,
          semanticSimilarity: 0,
          confidence: stats.confidence,
          recency: stats.recency,
          pagerank: 0,
          centrality: 0,
          communityId: entry.communityId,
        });
        communityAdded += 1;
      }
    }
    const embeddings = embeddingsByType.get(candidate.entityType);
    if (embeddings) {
      const neighbors = findGraphNeighbors(candidate.entityId, embeddings, {
        limit: graphLimit,
        minSimilarity: GRAPH_NEIGHBOR_MIN_SIMILARITY,
      });
      for (const neighbor of neighbors) {
        if (graphAdded >= graphLimit) break;
        const key = `${candidate.entityType}:${neighbor.entityId}`;
        if (existing.has(key)) continue;
        existing.add(key);
        const stats = await getEntityStats(neighbor.entityId, candidate.entityType, storage);
        expansions.push({
          entityId: neighbor.entityId,
          entityType: candidate.entityType,
          path: stats.path,
          semanticSimilarity: 0,
          graphSimilarity: neighbor.similarity,
          confidence: stats.confidence,
          recency: stats.recency,
          pagerank: 0,
          centrality: 0,
          communityId: null,
        });
        graphAdded += 1;
      }
    }
  }
  return { candidates: expansions, communityAdded, graphAdded };
}

function resolveCochangeAnchors(query: LibrarianQuery, directPacks: ContextPack[]): string[] {
  const anchors = new Set<string>();
  for (const file of query.affectedFiles ?? []) {
    if (file) anchors.add(file);
  }
  if (anchors.size < 6) {
    for (const pack of directPacks) {
      for (const file of pack.relatedFiles) {
        if (file) anchors.add(file);
      }
    }
  }
  return Array.from(anchors.values()).slice(0, 8);
}

async function applyCochangeScores(
  storage: LibrarianStorage,
  candidates: Candidate[],
  anchorFiles: string[],
): Promise<number> {
  if (!candidates.length || anchorFiles.length === 0) return 0;
  const workspaceRoot = await resolveWorkspaceRoot(storage);
  const normalizedAnchors = anchorFiles
    .map((file) => normalizeCochangePath(file, workspaceRoot))
    .filter((value): value is string => Boolean(value));
  if (!normalizedAnchors.length) return 0;
  const edgeCache = new Map<string, number>();
  let boosted = 0;
  for (const candidate of candidates) {
    const candidatePath = candidate.path ? normalizeCochangePath(candidate.path, workspaceRoot) : null;
    if (!candidatePath) {
      candidate.cochange = 0;
      continue;
    }
    let maxStrength = 0;
    for (const anchor of normalizedAnchors) {
      if (anchor === candidatePath) continue;
      const key = anchor < candidatePath ? `${anchor}||${candidatePath}` : `${candidatePath}||${anchor}`;
      let strength = edgeCache.get(key);
      if (strength === undefined) {
        const edges = await storage.getCochangeEdges({ fileA: anchor, fileB: candidatePath, limit: 1 });
        strength = edges[0]?.strength ?? 0;
        edgeCache.set(key, strength);
      }
      if (strength > maxStrength) maxStrength = strength;
    }
    if (maxStrength > 0) boosted += 1;
    candidate.cochange = maxStrength;
  }
  return boosted;
}

function normalizeCochangePath(value: string, workspaceRoot: string): string | null {
  if (!value) return null;
  const normalized = value.replace(/\\/g, '/');
  const absolute = path.isAbsolute(normalized) ? normalized : path.resolve(workspaceRoot, normalized);
  const relative = path.relative(workspaceRoot, absolute).replace(/\\/g, '/');
  if (!relative || relative.startsWith('..')) return null;
  return relative;
}
