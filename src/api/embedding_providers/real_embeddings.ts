/**
 * @fileoverview Real Embedding Providers
 *
 * This module provides REAL semantic embeddings using dedicated embedding models.
 * These are NOT LLM-generated "embeddings" (which are hallucinated numbers).
 *
 * Available Models (evaluated in #865 via scripts/eval-embedding-models.mjs):
 * - bge-small-en-v1.5: RECOMMENDED for code retrieval (384d, 512 tokens, MTEB-ranked)
 * - all-MiniLM-L6-v2: General NLP fallback (384d, 256 tokens)
 * - jina-embeddings-v2-base-en: Large context (768d, 8192 tokens, requires dimension migration)
 *
 * Model Selection Rationale (#865):
 *   bge-small-en-v1.5 is preferred over all-MiniLM-L6-v2 because:
 *   - Same 384-dimensional output (no database migration needed)
 *   - 512-token context window (2x the 256-token MiniLM limit)
 *   - Trained with contrastive learning on diverse retrieval tasks (BAAI)
 *   - Top-ranked on MTEB retrieval benchmarks
 *   - Reduces truncation rate for typical code functions (most are 100-400 tokens)
 *
 *   jina-embeddings-v2-base-en and nomic-embed-text-v1.5 offer 8K context
 *   but require 768-dimensional embeddings (a separate database migration).
 *
 * Provider Priority:
 * 1. @xenova/transformers (pure JS, no dependencies, works offline)
 * 2. sentence-transformers via Python subprocess (highest quality)
 *
 * POLICY (from VISION.md 8.5):
 * - SPEED DOES NOT MATTER - correctness is everything
 * - NO TIMEOUTS - operations complete or fail, never timeout
 * - NO RETRY LIMITS - retry until success or unrecoverable error
 * - LLM-generated embeddings are FORBIDDEN
 */

import { spawn } from 'node:child_process';
import { logInfo, logWarning } from '../../telemetry/logger.js';

/**
 * Available embedding models with their properties.
 *
 * Evaluated in #865 (scripts/eval-embedding-models.mjs) using 31 real LiBrainian
 * source files and 15 code retrieval test cases:
 *
 *   Model                   | R@5   | R@10  | MRR   | Trunc | Embed/fn
 *   bge-small-en-v1.5       | 68.4% | 79.6% | 0.905 | 96.8% | 185ms
 *   nomic-embed-text-v1.5   | 64.9% | 78.2% | 0.933 |  0.0% | 4.02s
 *   jina-embeddings-v2-base  | 62.7% | 77.3% | 0.933 |  0.0% | 6.27s
 *
 * bge-small-en-v1.5 is the recommended default: best Recall@5/10 for code
 * retrieval, same 384d dimension as MiniLM (no migration), 20-30x faster
 * than 768d models. The high truncation rate (96.8%) occurs because we
 * embed first-200-lines snippets (~1500 tokens avg) which exceed the 512-
 * token window. In practice, individual functions are shorter and fit better.
 *
 * 768d models (jina-v2, nomic-v1.5) eliminate truncation entirely but
 * require a database schema migration for the embedding dimension change.
 */
export const EMBEDDING_MODELS = {
  // BGE small v1.5 - RECOMMENDED for code retrieval (#865)
  // 384d (same as MiniLM), 512-token context (2x MiniLM), MTEB top-ranked
  'bge-small-en-v1.5': {
    xenovaId: 'Xenova/bge-small-en-v1.5',
    pythonId: 'BAAI/bge-small-en-v1.5',
    dimension: 384,
    contextWindow: 512,
    description: 'BGE small v1.5 - recommended for code retrieval (384d, 512 tokens, MTEB-ranked)',
  },
  // General NLP model - legacy/fallback (256 token context)
  // Note: "AUC 1.0" claim was from a trivial 3-sample test, not meaningful.
  // 256-token limit causes silent truncation on most real code functions (#662).
  'all-MiniLM-L6-v2': {
    xenovaId: 'Xenova/all-MiniLM-L6-v2',
    pythonId: 'all-MiniLM-L6-v2',
    dimension: 384,
    contextWindow: 256,
    description: 'Legacy NL model - 256 token limit causes truncation on code (#662)',
  },
  // Jina embeddings v2 - 8K context window, good for full files
  // Requires 768d dimension (database migration needed before use as default)
  'jina-embeddings-v2-base-en': {
    xenovaId: 'Xenova/jina-embeddings-v2-base-en',
    pythonId: 'jinaai/jina-embeddings-v2-base-en',
    dimension: 768,
    contextWindow: 8192,
    description: 'Large context (8K tokens, 768d) - needs dimension migration',
  },
} as const;

export type EmbeddingModelId = keyof typeof EMBEDDING_MODELS;

// Default model - bge-small-en-v1.5 recommended by #865 evaluation
// Same 384d dimension as MiniLM so no database migration needed.
// Fallback: all-MiniLM-L6-v2 (if BGE model fails to load)
export const DEFAULT_CODE_MODEL: EmbeddingModelId = 'bge-small-en-v1.5';
export const DEFAULT_NLP_MODEL: EmbeddingModelId = 'all-MiniLM-L6-v2';

// Current active model
let currentModelId: EmbeddingModelId = DEFAULT_CODE_MODEL;
const INVALID_EMBEDDING_NORM_TOLERANCE = 1e-10;
const DEFAULT_EMBEDDING_BATCH_SIZE = 8;

// Embedding dimension (depends on model)
export function getEmbeddingDimension(modelId: EmbeddingModelId = currentModelId): number {
  return EMBEDDING_MODELS[modelId].dimension;
}

// For backwards compatibility - must match DEFAULT_CODE_MODEL (all-MiniLM-L6-v2)
export const REAL_EMBEDDING_DIMENSION = 384;

// Lazy-loaded transformers pipelines (one per model)
const pipelines: Map<string, any> = new Map();
const pipelineLoadings: Map<string, Promise<any>> = new Map();

/**
 * Set the active embedding model.
 */
export function setEmbeddingModel(modelId: EmbeddingModelId): void {
  if (!(modelId in EMBEDDING_MODELS)) {
    throw new Error(`Unknown model: ${modelId}. Available: ${Object.keys(EMBEDDING_MODELS).join(', ')}`);
  }
  currentModelId = modelId;
}

/**
 * Get the current embedding model ID.
 */
export function getCurrentModel(): EmbeddingModelId {
  return currentModelId;
}

/**
 * Check if the embedding model is already loaded for the current model.
 */
export function isModelLoaded(modelId: EmbeddingModelId = currentModelId): boolean {
  const model = EMBEDDING_MODELS[modelId];
  return pipelines.has(model.xenovaId);
}

/**
 * Preload the embedding model to avoid cold-start latency on first query.
 * This should be called during bootstrap after storage initialization.
 *
 * @returns Promise that resolves when the model is loaded
 */
export async function preloadEmbeddingModel(modelId: EmbeddingModelId = currentModelId): Promise<void> {
  if (isModelLoaded(modelId)) {
    return;
  }
  await getXenovaPipeline(modelId);
}

/**
 * Initialize the @xenova/transformers pipeline for a specific model.
 * This is lazy-loaded on first use to avoid slow startup.
 */
async function getXenovaPipeline(modelId: EmbeddingModelId = currentModelId): Promise<any> {
  const model = EMBEDDING_MODELS[modelId];
  const cacheKey = model.xenovaId;

  if (pipelines.has(cacheKey)) {
    return pipelines.get(cacheKey);
  }

  if (pipelineLoadings.has(cacheKey)) {
    return pipelineLoadings.get(cacheKey);
  }

  const loading = (async () => {
    try {
      // Dynamic import to avoid bundling issues
      const { pipeline: createPipeline } = await import('@xenova/transformers');

      logInfo(`[librarian] Loading embedding model (${modelId})...`);

      // Use feature-extraction pipeline for embeddings
      const pipe = await createPipeline('feature-extraction', model.xenovaId, {
        // Use quantized model for faster loading (if available)
        quantized: modelId === 'all-MiniLM-L6-v2', // Only MiniLM has quantized version
      });

      logInfo(`[librarian] Embedding model ${modelId} loaded successfully`);
      pipelines.set(cacheKey, pipe);
      return pipe;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logWarning(`[librarian] Failed to load @xenova/transformers model ${modelId}`, { error: message });
      pipelineLoadings.delete(cacheKey);
      throw error;
    }
  })();

  pipelineLoadings.set(cacheKey, loading);
  return loading;
}

function assertValidEmbeddingInput(text: string): void {
  if (text.trim().length === 0) {
    throw new Error('unverified_by_trace(provider_invalid_output): embedding input is empty or whitespace-only');
  }
}

function toFloat32Embedding(data: unknown): Float32Array {
  if (data instanceof Float32Array) {
    return data;
  }
  if (Array.isArray(data)) {
    return new Float32Array(data);
  }
  if (ArrayBuffer.isView(data)) {
    const vectorLike = data as unknown as { [index: number]: number; length?: number };
    if (typeof vectorLike.length !== 'number') {
      throw new Error('unverified_by_trace(provider_invalid_output): provider returned non-indexable typed array payload');
    }
    return new Float32Array(Array.from({ length: vectorLike.length }, (_, i) => vectorLike[i] ?? 0));
  }
  throw new Error('unverified_by_trace(provider_invalid_output): provider returned non-vector embedding payload');
}

function validateEmbeddingVector(
  embedding: Float32Array,
  context: string
): Float32Array {
  if (embedding.length === 0) {
    throw new Error(`unverified_by_trace(provider_invalid_output): ${context} returned empty embedding`);
  }

  let normSq = 0;
  for (let i = 0; i < embedding.length; i++) {
    const value = embedding[i];
    if (!Number.isFinite(value)) {
      throw new Error(`unverified_by_trace(provider_invalid_output): ${context} returned non-finite embedding values`);
    }
    normSq += value * value;
  }

  if (normSq <= INVALID_EMBEDDING_NORM_TOLERANCE) {
    throw new Error(`unverified_by_trace(provider_invalid_output): ${context} returned zero-norm embedding`);
  }

  return embedding;
}

/**
 * Check if @xenova/transformers is available.
 */
export async function isXenovaAvailable(): Promise<boolean> {
  try {
    await import('@xenova/transformers');
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if sentence-transformers (Python) is available.
 */
export async function isSentenceTransformersAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn('python3', ['-c', 'import sentence_transformers; print("ok")'], {
      timeout: 10000,
    });

    let output = '';
    proc.stdout?.on('data', (data) => { output += data.toString(); });

    proc.on('close', (code) => {
      resolve(code === 0 && output.includes('ok'));
    });

    proc.on('error', () => {
      resolve(false);
    });
  });
}

function resolveEmbeddingBatchSize(): number {
  const raw = process.env.LIBRARIAN_EMBEDDING_BATCH_SIZE;
  if (!raw) return DEFAULT_EMBEDDING_BATCH_SIZE;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return DEFAULT_EMBEDDING_BATCH_SIZE;
  }
  return Math.min(parsed, 64);
}

async function mapWithConcurrency<TInput, TOutput>(
  items: TInput[],
  concurrency: number,
  mapper: (item: TInput, index: number) => Promise<TOutput>
): Promise<TOutput[]> {
  const normalizedConcurrency = Math.max(1, Math.min(concurrency, items.length || 1));
  const results: TOutput[] = new Array(items.length);
  let cursor = 0;

  const workers = Array.from({ length: normalizedConcurrency }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await mapper(items[index], index);
    }
  });

  await Promise.all(workers);
  return results;
}

/**
 * Generate embeddings using @xenova/transformers.
 * Model dimension depends on the selected model.
 */
export async function generateXenovaEmbedding(
  text: string,
  modelId: EmbeddingModelId = currentModelId
): Promise<Float32Array> {
  assertValidEmbeddingInput(text);
  const pipe = await getXenovaPipeline(modelId);

  // Generate embedding
  const output = await pipe(text, {
    pooling: 'mean',
    normalize: true,
  });

  // Extract the embedding data
  const embedding = toFloat32Embedding(output?.data);
  return validateEmbeddingVector(embedding, `xenova:${modelId}`);
}

/**
 * Generate embeddings using sentence-transformers via Python subprocess.
 * Model dimension depends on the selected model.
 *
 * This is higher quality but requires Python + sentence-transformers installed.
 */
export async function generateSentenceTransformerEmbedding(
  text: string,
  modelId: EmbeddingModelId = currentModelId
): Promise<Float32Array> {
  assertValidEmbeddingInput(text);
  const model = EMBEDDING_MODELS[modelId];

  return new Promise((resolve, reject) => {
    const pythonCode = `
import sys
import json
from sentence_transformers import SentenceTransformer

model = SentenceTransformer('${model.pythonId}')
text = sys.stdin.read()
embedding = model.encode(text, normalize_embeddings=True)
print(json.dumps(embedding.tolist()))
`;

    const proc = spawn('python3', ['-c', pythonCode], {
      // NO TIMEOUT - per VISION.md 8.4
    });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data) => { stdout += data.toString(); });
    proc.stderr?.on('data', (data) => { stderr += data.toString(); });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`sentence-transformers failed: ${stderr}`));
        return;
      }

      try {
        const parsed = JSON.parse(stdout.trim()) as unknown;
        const embedding = toFloat32Embedding(parsed);
        resolve(validateEmbeddingVector(embedding, `sentence-transformers:${modelId}`));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        reject(new Error(`unverified_by_trace(provider_invalid_output): failed to parse embedding output (${message})`));
      }
    });

    proc.on('error', (error) => {
      reject(error);
    });

    // Send text to stdin
    proc.stdin?.write(text);
    proc.stdin?.end();
  });
}

/**
 * Generate embeddings using the best available provider.
 *
 * Priority:
 * 1. @xenova/transformers (pure JS)
 * 2. sentence-transformers (Python)
 *
 * Retry/backoff limits are enforced by EmbeddingService.
 */
export async function generateRealEmbedding(
  text: string,
  modelId: EmbeddingModelId = currentModelId
): Promise<{
  embedding: Float32Array;
  provider: 'xenova' | 'sentence-transformers';
  dimension: number;
  model: EmbeddingModelId;
}> {
  // Try @xenova/transformers first (pure JS, no dependencies)
  if (await isXenovaAvailable()) {
    try {
      const embedding = await generateXenovaEmbedding(text, modelId);
      return {
        embedding,
        provider: 'xenova',
        dimension: embedding.length,
        model: modelId,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logWarning(`[librarian] Xenova embedding failed for ${modelId}; trying sentence-transformers`, { error: message });
    }
  }

  // Fall back to sentence-transformers
  if (await isSentenceTransformersAvailable()) {
    const embedding = await generateSentenceTransformerEmbedding(text, modelId);
    return {
      embedding,
      provider: 'sentence-transformers',
      dimension: embedding.length,
      model: modelId,
    };
  }

  throw new Error(
    'No embedding provider available. Install @xenova/transformers (npm) or sentence-transformers (Python).'
  );
}

/**
 * Generate embeddings for multiple texts in batch.
 * Uses the best available provider.
 */
export async function generateRealEmbeddings(
  texts: string[],
  modelId: EmbeddingModelId = currentModelId
): Promise<{
  embeddings: Float32Array[];
  provider: 'xenova' | 'sentence-transformers';
  dimension: number;
  model: EmbeddingModelId;
}> {
  const expectedDim = EMBEDDING_MODELS[modelId].dimension;

  if (texts.length === 0) {
    return { embeddings: [], provider: 'xenova', dimension: expectedDim, model: modelId };
  }

  const maxBatchSize = resolveEmbeddingBatchSize();
  if (await isXenovaAvailable()) {
    try {
      const embeddings = await mapWithConcurrency(texts, maxBatchSize, (text) =>
        generateXenovaEmbedding(text, modelId)
      );
      return {
        embeddings,
        provider: 'xenova',
        dimension: embeddings[0]?.length ?? expectedDim,
        model: modelId,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logWarning(`[librarian] Xenova batch embedding failed for ${modelId}; trying sentence-transformers`, { error: message });
    }
  }

  if (await isSentenceTransformersAvailable()) {
    const embeddings = await mapWithConcurrency(texts, maxBatchSize, (text) =>
      generateSentenceTransformerEmbedding(text, modelId)
    );
    return {
      embeddings,
      provider: 'sentence-transformers',
      dimension: embeddings[0]?.length ?? expectedDim,
      model: modelId,
    };
  }

  throw new Error(
    'No embedding provider available. Install @xenova/transformers (npm) or sentence-transformers (Python).'
  );
}

/**
 * Compute cosine similarity between two embeddings.
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(`Dimension mismatch: ${a.length} vs ${b.length}`);
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  return dot / denominator;
}

/**
 * Normalize an embedding to unit length.
 */
export function normalizeEmbedding(embedding: Float32Array): Float32Array {
  let norm = 0;
  for (let i = 0; i < embedding.length; i++) {
    norm += embedding[i] * embedding[i];
  }
  norm = Math.sqrt(norm);

  if (norm === 0) {
    throw new Error('Cannot normalize zero vector');
  }

  const result = new Float32Array(embedding.length);
  for (let i = 0; i < embedding.length; i++) {
    result[i] = embedding[i] / norm;
  }

  return result;
}

export const __testing = {
  resolveEmbeddingBatchSize,
  mapWithConcurrency,
};
