/**
 * @fileoverview Cross-Encoder Re-ranking
 *
 * Bi-encoders (like all-MiniLM) are fast but less accurate because
 * query and document are embedded separately.
 *
 * Cross-encoders see query and document TOGETHER, enabling:
 * 1. Direct semantic comparison
 * 2. Better handling of negation/context
 * 3. Higher accuracy for final ranking
 *
 * ARCHITECTURE:
 * ┌─────────────────────────────────────────────────────────────────┐
 * │                    RETRIEVAL PIPELINE                          │
 * ├─────────────────────────────────────────────────────────────────┤
 * │  1. Bi-encoder retrieves top-K (fast, coarse)                  │
 * │     Query → embed → cosine similarity → top-100                │
 * │                                                                 │
 * │  2. Cross-encoder re-ranks top-K (slow, precise)               │
 * │     For each (query, doc) pair → model([query, doc]) → score   │
 * │     → top-10                                                    │
 * └─────────────────────────────────────────────────────────────────┘
 *
 * Cross-encoder is ~100x slower but ~20% more accurate.
 * Perfect for re-ranking small candidate sets.
 */

import {
  AutoTokenizer,
  AutoModelForSequenceClassification,
  type PreTrainedTokenizer,
  type PreTrainedModel
} from '@xenova/transformers';

// ============================================================================
// TYPES
// ============================================================================

export interface RerankerResult {
  index: number;
  document: string;
  score: number;
  originalRank: number;
  newRank: number;
}

export interface RerankerOptions {
  /** Maximum documents to re-rank */
  topK?: number;
  /** Return top N after re-ranking */
  returnTopN?: number;
  /** Minimum score threshold */
  minScore?: number;
  /** Model to use */
  modelId?: CrossEncoderModelId;
}

export type CrossEncoderModelId =
  | 'cross-encoder/ms-marco-MiniLM-L-6-v2'
  | 'cross-encoder/ms-marco-MiniLM-L-12-v2';

// ============================================================================
// MODEL REGISTRY
// ============================================================================

interface CrossEncoderModel {
  xenovaId: string;
  description: string;
  avgLatencyMs: number;
}

const CROSS_ENCODER_MODELS: Record<CrossEncoderModelId, CrossEncoderModel> = {
  'cross-encoder/ms-marco-MiniLM-L-6-v2': {
    xenovaId: 'Xenova/ms-marco-MiniLM-L-6-v2',
    description: 'Fast cross-encoder for passage re-ranking (6 layers)',
    avgLatencyMs: 15,
  },
  'cross-encoder/ms-marco-MiniLM-L-12-v2': {
    xenovaId: 'Xenova/ms-marco-MiniLM-L-12-v2',
    description: 'Accurate cross-encoder for passage re-ranking (12 layers)',
    avgLatencyMs: 30,
  },
};

// ============================================================================
// CROSS-ENCODER SINGLETON (Per-Model Cache)
// ============================================================================

interface LoadedCrossEncoder {
  tokenizer: PreTrainedTokenizer;
  model: PreTrainedModel;
}

/**
 * Per-model cache to prevent race conditions when different models are requested
 * concurrently. Each model ID has its own loading state.
 *
 * ARCHITECTURAL REQUIREMENT (Determinism):
 * Cross-encoder affects retrieval ranking, which affects RetrievalQualityReport.v1.
 * Race conditions could cause non-deterministic retrieval quality measurements.
 * This per-model cache ensures reproducible behavior.
 */
const _modelCache = new Map<CrossEncoderModelId, LoadedCrossEncoder>();
const _loadingPromises = new Map<CrossEncoderModelId, Promise<LoadedCrossEncoder>>();

/**
 * Get or create the cross-encoder model and tokenizer.
 * Using direct model access instead of pipeline for proper logit extraction.
 * Thread-safe: concurrent calls for the SAME model wait on the same promise.
 * Different models can load concurrently without interference.
 */
async function getCrossEncoder(
  modelId: CrossEncoderModelId = 'cross-encoder/ms-marco-MiniLM-L-6-v2'
): Promise<LoadedCrossEncoder> {
  // Return cached model if already loaded
  const cached = _modelCache.get(modelId);
  if (cached) {
    return cached;
  }

  // If loading is in progress for this model, wait for it
  const existingPromise = _loadingPromises.get(modelId);
  if (existingPromise) {
    return existingPromise;
  }

  const modelConfig = CROSS_ENCODER_MODELS[modelId];
  if (!modelConfig) {
    throw new Error(`Unknown cross-encoder model: ${modelId}`);
  }

  // Start loading and store promise to prevent concurrent loads for THIS model
  const loadingPromise = (async () => {
    console.error(`[cross-encoder] Loading ${modelId}...`);
    const startTime = Date.now();

    // Load tokenizer and model directly for proper logit access
    const tokenizer = await AutoTokenizer.from_pretrained(modelConfig.xenovaId);
    const model = await AutoModelForSequenceClassification.from_pretrained(
      modelConfig.xenovaId,
      { quantized: true }
    );

    const loaded = { tokenizer, model };
    console.error(`[cross-encoder] Model loaded in ${Date.now() - startTime}ms`);

    return loaded;
  })();

  _loadingPromises.set(modelId, loadingPromise);

  try {
    const loaded = await loadingPromise;
    _modelCache.set(modelId, loaded);
    return loaded;
  } finally {
    _loadingPromises.delete(modelId);
  }
}

/**
 * Score a query-document pair using the cross-encoder.
 * Returns the raw logit score (higher = more relevant).
 */
async function scoreQueryDocumentPair(
  query: string,
  document: string,
  crossEncoder: LoadedCrossEncoder
): Promise<number> {
  // Tokenize as a pair
  const inputs = await crossEncoder.tokenizer(query, {
    text_pair: document.slice(0, 512), // Truncate document
    padding: true,
    truncation: true,
    return_tensors: 'pt'
  });

  // Get model output
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const output = await crossEncoder.model(inputs) as any;

  // Extract the relevance logit
  if (output.logits?.data) {
    return output.logits.data[0];
  }

  return 0;
}

// ============================================================================
// RE-RANKING
// ============================================================================

/**
 * Re-rank documents using cross-encoder.
 *
 * @param query The search query
 * @param documents The documents to re-rank
 * @param options Re-ranking options
 * @returns Re-ranked documents with scores
 */
export async function rerank(
  query: string,
  documents: string[],
  options: RerankerOptions = {}
): Promise<RerankerResult[]> {
  const {
    topK = 50,
    returnTopN = 10,
    minScore = -Infinity, // Raw logits can be negative
    modelId = 'cross-encoder/ms-marco-MiniLM-L-6-v2',
  } = options;

  // Limit documents to re-rank
  const docsToRerank = documents.slice(0, topK);

  if (docsToRerank.length === 0) {
    return [];
  }

  const crossEncoder = await getCrossEncoder(modelId);

  // Score each (query, document) pair
  const results: RerankerResult[] = [];

  for (let i = 0; i < docsToRerank.length; i++) {
    const doc = docsToRerank[i];

    try {
      // Score using direct model access for proper logit extraction
      const score = await scoreQueryDocumentPair(query, doc, crossEncoder);

      results.push({
        index: i,
        document: doc,
        score,
        originalRank: i + 1,
        newRank: 0, // Will be set after sorting
      });
    } catch (error) {
      console.warn(`[cross-encoder] Failed to score document ${i}:`, error);
      results.push({
        index: i,
        document: doc,
        score: -Infinity,
        originalRank: i + 1,
        newRank: 0,
      });
    }
  }

  // Sort by score (descending) - higher logit = more relevant
  results.sort((a, b) => b.score - a.score);

  // Assign new ranks
  for (let i = 0; i < results.length; i++) {
    results[i].newRank = i + 1;
  }

  // Filter by min score and return top N
  return results
    .filter((r) => r.score >= minScore)
    .slice(0, returnTopN);
}

// ============================================================================
// BATCH RE-RANKING
// ============================================================================

/**
 * Re-rank with batched scoring for efficiency.
 * Uses concurrent scoring for performance.
 */
export async function rerankBatch(
  query: string,
  documents: string[],
  options: RerankerOptions & { batchSize?: number } = {}
): Promise<RerankerResult[]> {
  const {
    topK = 50,
    returnTopN = 10,
    minScore = -Infinity,
    modelId = 'cross-encoder/ms-marco-MiniLM-L-6-v2',
    batchSize = 8,
  } = options;

  const docsToRerank = documents.slice(0, topK);

  if (docsToRerank.length === 0) {
    return [];
  }

  const crossEncoder = await getCrossEncoder(modelId);
  const results: RerankerResult[] = [];

  // Process in batches with concurrent scoring
  for (let batchStart = 0; batchStart < docsToRerank.length; batchStart += batchSize) {
    const batch = docsToRerank.slice(batchStart, batchStart + batchSize);

    try {
      // Score batch concurrently
      const scores = await Promise.all(
        batch.map((doc) => scoreQueryDocumentPair(query, doc, crossEncoder))
      );

      for (let i = 0; i < batch.length; i++) {
        results.push({
          index: batchStart + i,
          document: batch[i],
          score: scores[i],
          originalRank: batchStart + i + 1,
          newRank: 0,
        });
      }
    } catch (error) {
      console.warn(`[cross-encoder] Batch ${batchStart} failed:`, error);

      // Add low scores for failed batch
      for (let i = 0; i < batch.length; i++) {
        results.push({
          index: batchStart + i,
          document: batch[i],
          score: -Infinity,
          originalRank: batchStart + i + 1,
          newRank: 0,
        });
      }
    }
  }

  // Sort and assign ranks
  results.sort((a, b) => b.score - a.score);
  for (let i = 0; i < results.length; i++) {
    results[i].newRank = i + 1;
  }

  return results
    .filter((r) => r.score >= minScore)
    .slice(0, returnTopN);
}

// ============================================================================
// HYBRID RE-RANKING
// ============================================================================

export interface HybridRerankInput {
  document: string;
  biEncoderScore: number;
  metadata?: Record<string, unknown>;
}

export interface HybridRerankResult extends RerankerResult {
  biEncoderScore: number;
  hybridScore: number;
  metadata?: Record<string, unknown>;
}

/**
 * Combine bi-encoder and cross-encoder scores.
 */
export async function hybridRerank(
  query: string,
  inputs: HybridRerankInput[],
  options: RerankerOptions & {
    biEncoderWeight?: number;
    crossEncoderWeight?: number;
  } = {}
): Promise<HybridRerankResult[]> {
  const {
    topK = 50,
    returnTopN = 10,
    biEncoderWeight = 0.3,
    crossEncoderWeight = 0.7,
    modelId = 'cross-encoder/ms-marco-MiniLM-L-6-v2',
  } = options;

  // Get documents
  const documents = inputs.slice(0, topK).map((i) => i.document);

  // Cross-encoder scores
  const crossEncoderResults = await rerank(query, documents, { ...options, returnTopN: topK });

  // Create score map
  const crossScoreMap = new Map<number, number>();
  for (const result of crossEncoderResults) {
    crossScoreMap.set(result.index, result.score);
  }

  // Combine scores
  const results: HybridRerankResult[] = inputs.slice(0, topK).map((input, i) => {
    const crossScore = crossScoreMap.get(i) || 0;
    const hybridScore =
      biEncoderWeight * input.biEncoderScore + crossEncoderWeight * crossScore;

    return {
      index: i,
      document: input.document,
      score: crossScore,
      biEncoderScore: input.biEncoderScore,
      hybridScore,
      originalRank: i + 1,
      newRank: 0,
      metadata: input.metadata,
    };
  });

  // Sort by hybrid score
  results.sort((a, b) => b.hybridScore - a.hybridScore);

  // Assign ranks
  for (let i = 0; i < results.length; i++) {
    results[i].newRank = i + 1;
  }

  return results.slice(0, returnTopN);
}

// ============================================================================
// UTILITIES
// ============================================================================

/**
 * Preload cross-encoder model for faster first query.
 */
export async function preloadReranker(
  modelId: CrossEncoderModelId = 'cross-encoder/ms-marco-MiniLM-L-6-v2'
): Promise<void> {
  await getCrossEncoder(modelId);
}

/**
 * Get available cross-encoder models.
 */
export function getAvailableModels(): Array<{
  id: CrossEncoderModelId;
  description: string;
  avgLatencyMs: number;
}> {
  return Object.entries(CROSS_ENCODER_MODELS).map(([id, model]) => ({
    id: id as CrossEncoderModelId,
    description: model.description,
    avgLatencyMs: model.avgLatencyMs,
  }));
}

// All exports are inline above
