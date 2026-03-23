import type {
  EmbeddableEntityType,
  LibrarianStorage,
  SimilarityResult,
  StorageCapabilities,
} from '../storage/types.js';
import type {
  LibrarianQuery,
  LibrarianVersion,
  StageIssueSeverity,
  StageName,
} from '../types.js';
import type { GraphEntityType } from '../graphs/metrics.js';
import type { EmbeddingService } from './embeddings.js';
import type { GovernorContext } from './governor_context.js';
import {
  configurable,
  resolveQuantifiedValue,
} from '../epistemics/quantification.js';
import { resolveSemanticCandidateWindow } from './query_depth_profile.js';
import type { StageTracker } from './query_stage_reporting.js';

const q = (value: number, range: [number, number], rationale: string): number =>
  resolveQuantifiedValue(configurable(value, range, rationale));

const MIN_SIMILARITY_MVP = q(0.35, [0, 1], 'Minimum semantic similarity for MVP retrieval.');
const MIN_SIMILARITY_FULL = q(0.35, [0, 1], 'Minimum semantic similarity for full retrieval.');

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

type ResolvedQueryEmbeddings = {
  directEmbedding: Float32Array;
  hydeEmbedding: Float32Array | null;
  identifierEmbeddings: Float32Array[];
};

export type RecordCoverageGap = (
  stage: StageName,
  message: string,
  severity?: StageIssueSeverity,
  remediation?: string,
) => void;

export type SemanticRetrievalDiagnostics = {
  vectorIndexDegraded: boolean;
  vectorIndexEmpty: boolean;
  noSemanticMatches: boolean;
  embeddingUnavailable: boolean;
  degradedReason?: string;
};

export type SemanticQueryClassificationShape = {
  isMetaQuery: boolean;
  isDefinitionQuery: boolean;
  documentBias: number;
  definitionBias: number;
  entityTypes: EmbeddableEntityType[];
};

export async function runSemanticRetrievalStage<TQueryClassification extends SemanticQueryClassificationShape>(options: {
  storage: LibrarianStorage;
  query: LibrarianQuery;
  embeddingService: EmbeddingService;
  governor: GovernorContext;
  stageTracker: StageTracker;
  recordCoverageGap: RecordCoverageGap;
  capabilities: StorageCapabilities;
  version: LibrarianVersion;
  embeddingAvailable: boolean;
  isModelLoadedFn: () => boolean;
  preloadEmbeddingModelFn: () => Promise<unknown>;
  logWarningFn: (message: string, context?: Record<string, unknown>) => void;
  resolveQueryEmbeddingsFn: (
    query: LibrarianQuery,
    embeddingService: EmbeddingService,
    governor: GovernorContext,
  ) => Promise<ResolvedQueryEmbeddings>;
  classifyQueryIntentFn: (intent: string) => TQueryClassification;
  applyIntentTypeRoutingOverridesFn: (
    classification: TQueryClassification,
    intentType: LibrarianQuery['intentType'] | undefined,
    affectedFiles: string[] | undefined,
  ) => TQueryClassification;
  fuseSimilarityResultListsWithRrfFn: (
    results: SimilarityResult[][],
    limit: number,
  ) => SimilarityResult[];
  applyDocumentBiasFn: (
    results: SimilarityResult[],
    documentBias: number,
  ) => SimilarityResult[];
  applyDefinitionBiasFn: (
    results: SimilarityResult[],
    definitionBias: number,
  ) => SimilarityResult[];
  hydrateCandidatesFn: (
    results: SimilarityResult[],
    storage: LibrarianStorage,
  ) => Promise<Candidate[]>;
  injectFilenameCandidatesFn: (
    intent: string,
    existingCandidates: Candidate[],
    storage: LibrarianStorage,
    knownPaths?: string[],
  ) => Promise<{ candidates: Candidate[]; added: number }>;
  extractIntentAnchorPathsFn: (intent: string) => string[];
}): Promise<{
  candidates: Candidate[];
  queryEmbedding: Float32Array | null;
  queryClassification?: TQueryClassification;
  diagnostics: SemanticRetrievalDiagnostics;
}> {
  const {
    storage,
    query,
    embeddingService,
    governor,
    stageTracker,
    recordCoverageGap,
    capabilities,
    version,
    embeddingAvailable,
    isModelLoadedFn,
    preloadEmbeddingModelFn,
    logWarningFn,
    resolveQueryEmbeddingsFn,
    classifyQueryIntentFn,
    applyIntentTypeRoutingOverridesFn,
    fuseSimilarityResultListsWithRrfFn,
    applyDocumentBiasFn,
    applyDefinitionBiasFn,
    hydrateCandidatesFn,
    injectFilenameCandidatesFn,
    extractIntentAnchorPathsFn,
  } = options;
  let queryEmbedding: Float32Array | null = null;
  let candidates: Candidate[] = [];
  let queryClassification: TQueryClassification | undefined;
  let semanticCandidateWindow = 0;
  let searchExecutions = 0;

  const diagnostics: SemanticRetrievalDiagnostics = {
    vectorIndexDegraded: false,
    vectorIndexEmpty: false,
    noSemanticMatches: false,
    embeddingUnavailable: false,
    degradedReason: undefined,
  };

  if (query.coldStartStructuralOnly && !isModelLoadedFn()) {
    void preloadEmbeddingModelFn().catch(() => undefined);
    recordCoverageGap(
      'semantic_retrieval',
      'Returning structural retrieval results while embedding model prewarms.',
      'minor',
      'Retry query after prewarm for full semantic retrieval.'
    );
  } else if (embeddingAvailable && !isModelLoadedFn()) {
    logWarningFn('Embedding model not preloaded - first query may experience cold-start latency. Ensure preloadEmbeddingModel() is called during bootstrap.', {
      stage: 'semantic_retrieval',
    });
  }

  const semanticStage = stageTracker.start('semantic_retrieval', query.intent && query.depth !== 'L0' ? 1 : 0);
  if (query.coldStartStructuralOnly && !isModelLoadedFn()) {
    stageTracker.finish(semanticStage, {
      outputCount: 0,
      filteredCount: 0,
      status: 'partial',
    });
  } else if (semanticStage.inputCount > 0) {
    semanticCandidateWindow = resolveSemanticCandidateWindow(query.depth, false);
    if (!embeddingAvailable) {
      diagnostics.embeddingUnavailable = true;
      const reason = capabilities.optional.embeddings
        ? 'Embedding provider unavailable.'
        : 'Embedding retrieval unsupported by storage.';
      recordCoverageGap(
        'semantic_retrieval',
        reason,
        'significant',
        capabilities.optional.embeddings ? 'Authenticate a live embedding provider.' : 'Use a storage backend with embedding support.'
      );
    } else {
      const resolvedEmbeddings = await resolveQueryEmbeddingsFn(query, embeddingService, governor);
      queryEmbedding = resolvedEmbeddings.hydeEmbedding ?? resolvedEmbeddings.directEmbedding;
      const minSimilarity = version.qualityTier === 'mvp'
        ? MIN_SIMILARITY_MVP
        : MIN_SIMILARITY_FULL;

      queryClassification = applyIntentTypeRoutingOverridesFn(
        classifyQueryIntentFn(query.intent ?? ''),
        query.intentType,
        query.affectedFiles,
      );

      const searchLimit = resolveSemanticCandidateWindow(query.depth, queryClassification.isMetaQuery);
      semanticCandidateWindow = searchLimit;
      const searchMinSimilarity = queryClassification.isMetaQuery ? minSimilarity * 0.9 : minSimilarity;

      const directSearchResponse = await storage.findSimilarByEmbedding(resolvedEmbeddings.directEmbedding, {
        limit: searchLimit,
        minSimilarity: searchMinSimilarity,
        entityTypes: queryClassification.entityTypes,
        filter: query.filter,
      });
      searchExecutions += 1;
      applySimilaritySearchDegradation('direct', directSearchResponse, diagnostics, recordCoverageGap);

      const resultLists: SimilarityResult[][] = [directSearchResponse.results];
      if (resolvedEmbeddings.hydeEmbedding) {
        const hydeSearchResponse = await storage.findSimilarByEmbedding(resolvedEmbeddings.hydeEmbedding, {
          limit: searchLimit,
          minSimilarity: searchMinSimilarity,
          entityTypes: queryClassification.entityTypes,
          filter: query.filter,
        });
        searchExecutions += 1;
        applySimilaritySearchDegradation('hyde', hydeSearchResponse, diagnostics, recordCoverageGap);
        resultLists.push(hydeSearchResponse.results);
      }

      for (let i = 0; i < resolvedEmbeddings.identifierEmbeddings.length; i += 1) {
        const expansionSearchResponse = await storage.findSimilarByEmbedding(resolvedEmbeddings.identifierEmbeddings[i], {
          limit: searchLimit,
          minSimilarity: searchMinSimilarity,
          entityTypes: queryClassification.entityTypes,
          filter: query.filter,
        });
        searchExecutions += 1;
        applySimilaritySearchDegradation(`identifier_expansion_${i + 1}`, expansionSearchResponse, diagnostics, recordCoverageGap);
        resultLists.push(expansionSearchResponse.results);
      }

      let similarResults = resultLists.length === 1
        ? resultLists[0]
        : fuseSimilarityResultListsWithRrfFn(resultLists, searchLimit);

      if (queryClassification.isMetaQuery && queryClassification.documentBias > 0.3) {
        similarResults = applyDocumentBiasFn(similarResults, queryClassification.documentBias);
      }

      if (queryClassification.isDefinitionQuery && queryClassification.definitionBias > 0.1) {
        similarResults = applyDefinitionBiasFn(similarResults, queryClassification.definitionBias);
      }

      if (!similarResults.length) {
        diagnostics.noSemanticMatches = true;
        recordCoverageGap(
          'semantic_retrieval',
          `No semantic matches above similarity threshold (${minSimilarity}).`,
          'moderate',
          'Refine the query intent or add affectedFiles to anchor the search.'
        );
      }
      candidates = await hydrateCandidatesFn(similarResults, storage);
    }

    if (query.intent) {
      const injected = await injectFilenameCandidatesFn(
        query.intent,
        candidates,
        storage,
        [...(query.affectedFiles ?? []), ...extractIntentAnchorPathsFn(query.intent)]
      );
      if (injected.added > 0) {
        candidates = injected.candidates;
      }
    }
  } else if (!query.intent) {
    recordCoverageGap('semantic_retrieval', 'No query intent provided for semantic search.', 'minor');
  }
  stageTracker.finish(semanticStage, {
    outputCount: candidates.length,
    filteredCount: 0,
    telemetry: {
      candidateWindow: semanticCandidateWindow,
      searchExecutions,
    },
  });
  return { candidates, queryEmbedding, queryClassification, diagnostics };
}

function applySimilaritySearchDegradation(
  source: string,
  response: {
    degraded?: boolean;
    degradedReason?: string;
  },
  diagnostics: SemanticRetrievalDiagnostics,
  recordCoverageGap: RecordCoverageGap,
): void {
  if (!response.degraded) return;
  diagnostics.vectorIndexDegraded = true;
  if (!diagnostics.degradedReason) {
    diagnostics.degradedReason = response.degradedReason;
  }
  const emptyIndex = response.degradedReason === 'vector_index_empty' || response.degradedReason === 'vector_index_null';
  if (emptyIndex) {
    diagnostics.vectorIndexEmpty = true;
  }
  recordCoverageGap(
    'semantic_retrieval',
    `Similarity search (${source}) degraded: ${response.degradedReason ?? 'unknown'}`,
    emptyIndex ? 'significant' : 'moderate',
    'Re-bootstrap the index or check embedding configuration.'
  );
}
