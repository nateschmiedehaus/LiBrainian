import type { ConstructionPlan, LibrarianQuery, LibrarianVersion } from '../types.js';
import type { CachedResponse } from './query_cache_response_utils.js';
import {
  buildClarifyingQuestions,
  categorizeRetrievalStatus,
  computeRetrievalEntropy,
} from './retrieval_escalation.js';

export interface CacheHydrationOptions {
  baseResponse: CachedResponse;
  query: LibrarianQuery;
  latencyMs: number;
  version: LibrarianVersion;
  traceId: string;
  disclosures: string[];
  constructionPlan: ConstructionPlan;
}

export function hydrateCachedQueryResponse(options: CacheHydrationOptions): CachedResponse {
  const response = {
    ...options.baseResponse,
    query: options.query,
    cacheHit: true,
    latencyMs: options.latencyMs,
    version: options.version,
    traceId: options.traceId,
    disclosures: options.disclosures,
    constructionPlan: options.constructionPlan,
    synthesisMode: 'cache',
  } as CachedResponse;

  if (options.query.showLlmErrors === false) {
    response.llmError = undefined;
  }

  applyCachedRetrievalDefaults(response, options.query);
  return response;
}

export function applyCachedRetrievalDefaults(response: CachedResponse, query: LibrarianQuery): void {
  response.retrievalEntropy = response.retrievalEntropy
    ?? computeRetrievalEntropy(response.packs);
  response.retrievalStatus = response.retrievalStatus
    ?? categorizeRetrievalStatus({
      totalConfidence: response.totalConfidence,
      packCount: response.packs.length,
    });
  response.retrievalInsufficient = response.retrievalInsufficient
    ?? ((query.depth ?? 'L1') === 'L3' && response.totalConfidence < 0.3);

  if (response.retrievalInsufficient && !response.suggestedClarifyingQuestions?.length) {
    response.suggestedClarifyingQuestions = buildClarifyingQuestions(query.intent ?? '');
  }
}
