/**
 * @fileoverview Embedding Service - REAL EMBEDDING PROVIDERS ONLY
 *
 * ╔══════════════════════════════════════════════════════════════════════════════╗
 * ║  POLICY (Wave0):                                                              ║
 * ║                                                                               ║
 * ║  - Embeddings MUST be real semantic vectors from dedicated embedding models   ║
 * ║  - LLM-generated "embeddings" are FORBIDDEN (they're hallucinated numbers)    ║
 * ║  - Retries are bounded (max retry limits + backoff)                           ║
 * ║  - Time budgets/cancellation are imposed by callers (governor/worker)         ║
 * ║                                                                               ║
 * ║  Provider Priority:                                                           ║
 * ║  1. @huggingface/transformers (pure JS, bge-small-en-v1.5, 384 dimensions)     ║
 * ║  2. sentence-transformers via Python subprocess (fallback)                    ║
 * ║                                                                               ║
 * ║  See: src/EMBEDDING_RULES.md and docs/LIVE_PROVIDERS_PLAYBOOK.md              ║
 * ╚══════════════════════════════════════════════════════════════════════════════╝
 */

import {
  generateRealEmbedding,
  generateRealEmbeddings,
  REAL_EMBEDDING_DIMENSION,
  cosineSimilarity,
  EMBEDDING_MODELS,
  setEmbeddingModel,
  type EmbeddingModelId,
} from './embedding_providers/real_embeddings.js';
import { getErrorMessage } from '../utils/errors.js';
import { emptyArray } from './empty_values.js';
import { createEmptyRedactionCounts, mergeRedactionCounts, redactText, type RedactionCounts } from './redaction.js';
import { configurable, resolveQuantifiedValue } from '../epistemics/quantification.js';
import { appendPrivacyAuditEvent } from '../security/privacy_audit.js';

export type EmbeddingKind = 'code' | 'query' | 'document';
export type EmbeddingProvider = 'xenova' | 'sentence-transformers';

// ============================================================================
// EMBEDDING MODEL CONFIGURATION
// ============================================================================

/**
 * Embedding model configuration.
 *
 * Supports multiple providers and models with environment variable overrides:
 * - LIBRARIAN_EMBEDDING_MODEL: Model identifier (e.g., 'all-MiniLM-L6-v2')
 * - LIBRAINIAN_EMBEDDING_PROVIDER (or legacy LIBRARIAN_EMBEDDING_PROVIDER):
 *   Provider preference ('xenova' | 'sentence-transformers')
 */
export interface EmbeddingConfig {
  /** Model identifier (e.g., 'all-MiniLM-L6-v2', 'jina-embeddings-v2-base-en') */
  model: string;
  /** Embedding vector dimensions */
  dimensions: number;
  /** Provider to use */
  provider: EmbeddingProvider;
  /** Maximum context window in tokens */
  contextWindow: number;
  /** Batch size for processing multiple texts */
  batchSize: number;
  /** Human-readable description */
  description: string;
}

/**
 * Available embedding model configurations.
 *
 * Each model is identified by a key in the format 'provider:model-name' or just 'model-name'.
 */
export const DEFAULT_EMBEDDING_CONFIGS: Record<string, EmbeddingConfig> = {
  // Xenova models (pure JS, offline)
  'xenova:bge-small-en-v1.5': {
    model: 'bge-small-en-v1.5',
    dimensions: 384,
    provider: 'xenova',
    contextWindow: 512,
    batchSize: 32,
    description: 'BGE small v1.5 - recommended for code retrieval (#865)',
  },
  'xenova:all-MiniLM-L6-v2': {
    model: 'all-MiniLM-L6-v2',
    dimensions: 384,
    provider: 'xenova',
    contextWindow: 256,
    batchSize: 32,
    description: 'Legacy NL model - 256 token limit causes truncation (#662)',
  },
  'xenova:jina-embeddings-v2-base-en': {
    model: 'jina-embeddings-v2-base-en',
    dimensions: 768,
    provider: 'xenova',
    contextWindow: 8192,
    batchSize: 16,
    description: 'Large context (8K tokens, 768d) - needs dimension migration',
  },
  // Shorthand aliases (default to xenova provider)
  'bge-small-en-v1.5': {
    model: 'bge-small-en-v1.5',
    dimensions: 384,
    provider: 'xenova',
    contextWindow: 512,
    batchSize: 32,
    description: 'BGE small v1.5 - recommended for code retrieval (#865)',
  },
  'all-MiniLM-L6-v2': {
    model: 'all-MiniLM-L6-v2',
    dimensions: 384,
    provider: 'xenova',
    contextWindow: 256,
    batchSize: 32,
    description: 'Legacy NL model - 256 token limit causes truncation (#662)',
  },
  'jina-embeddings-v2-base-en': {
    model: 'jina-embeddings-v2-base-en',
    dimensions: 768,
    provider: 'xenova',
    contextWindow: 8192,
    batchSize: 16,
    description: 'Large context (8K tokens, 768d) - needs dimension migration',
  },
};

/**
 * Get embedding configuration from model identifier.
 *
 * Resolution order:
 * 1. If modelId provided, use it directly
 * 2. Check LIBRARIAN_EMBEDDING_MODEL environment variable
 * 3. Fall back to 'bge-small-en-v1.5' (default, #865)
 *
 * @param modelId - Optional model identifier
 * @returns Embedding configuration for the model
 * @throws Error if model is not found
 *
 * @example
 * ```typescript
 * // Use default model
 * const config = getEmbeddingConfig();
 *
 * // Use specific model
 * const config = getEmbeddingConfig('jina-embeddings-v2-base-en');
 *
 * // Use environment variable
 * process.env.LIBRARIAN_EMBEDDING_MODEL = 'xenova:bge-small-en-v1.5';
 * const config = getEmbeddingConfig(); // Uses bge-small-en-v1.5
 * ```
 */
export function getEmbeddingConfig(modelId?: string): EmbeddingConfig {
  const id = modelId
    || process.env.LIBRAINIAN_EMBEDDING_MODEL
    || process.env.LIBRARIAN_EMBEDDING_MODEL
    || 'bge-small-en-v1.5';

  const config = DEFAULT_EMBEDDING_CONFIGS[id];

  if (!config) {
    const availableModels = Object.keys(DEFAULT_EMBEDDING_CONFIGS)
      .filter(k => !k.includes(':')) // Show only short names
      .join(', ');
    throw new Error(
      `Unknown embedding model: ${id}. Available models: ${availableModels}`
    );
  }

  // Apply provider override from environment if set
  const providerOverride =
    process.env.LIBRAINIAN_EMBEDDING_PROVIDER
    ?? process.env.LIBRARIAN_EMBEDDING_PROVIDER;
  if (providerOverride === 'xenova' || providerOverride === 'sentence-transformers') {
    return { ...config, provider: providerOverride };
  }

  return config;
}

/**
 * List all available embedding models.
 *
 * @returns Array of model configurations with their identifiers
 */
export function listEmbeddingModels(): Array<{ id: string; config: EmbeddingConfig }> {
  const seen = new Set<string>();
  const result: Array<{ id: string; config: EmbeddingConfig }> = [];

  for (const [id, config] of Object.entries(DEFAULT_EMBEDDING_CONFIGS)) {
    // Only include short names (without provider prefix) to avoid duplicates
    if (!id.includes(':') && !seen.has(config.model)) {
      seen.add(config.model);
      result.push({ id, config });
    }
  }

  return result;
}

/**
 * Configure the embedding service with a specific model.
 *
 * This updates the global embedding model used by the EmbeddingService.
 *
 * @param modelId - Model identifier to use
 * @throws Error if model is not found
 */
export function configureEmbeddingModel(modelId?: string): EmbeddingConfig {
  const config = getEmbeddingConfig(modelId);

  // Update the underlying real_embeddings module
  if (config.model in EMBEDDING_MODELS) {
    setEmbeddingModel(config.model as EmbeddingModelId);
  }

  return config;
}

export interface EmbeddingRequest {
  text: string;
  kind: EmbeddingKind;
  hint?: string;
  id?: string;  // Optional entity ID for tracking
}

export interface EmbeddingMetadata {
  modelId: string;
  provider: EmbeddingProvider;
  generatedAt: string;
  tokenCount: number;
}

export interface EmbeddingResult extends EmbeddingMetadata {
  embedding: Float32Array;
}

export interface EmbeddingRetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  jitterFactor: number;
  nonRetryableErrors: string[];
}

export interface EmbeddingNormalizationConfig {
  validateNormalization: boolean;
  normTolerance: number;
  autoNormalize: boolean;
}

export interface EmbeddingServiceOptions {
  provider?: EmbeddingProvider;
  modelId?: string;
  embeddingDimension?: number;
  maxBatchSize?: number;
  maxConcurrentBatches?: number;
  batchDelayMs?: number;
  retryConfig?: Partial<EmbeddingRetryConfig>;
  normalizationConfig?: Partial<EmbeddingNormalizationConfig>;
  governorContext?: GovernorContextLike;
  redactSensitive?: boolean;
  blockOnRedaction?: boolean;
  now?: () => Date;
  workspaceRoot?: string;
}

type GovernorContextLike = {
  checkBudget: () => void;
  recordTokens: (tokens: number) => void;
  recordRetry: () => void;
  snapshot?: () => { config?: { maxEmbeddingsPerBatch?: number } };
};

// ============================================================================
// EMBEDDING CONFIGURATION - REAL SEMANTIC VECTORS ONLY
// ============================================================================
//
// POLICY: Use dedicated embedding models, NOT LLMs.
// LLM-generated "embeddings" are hallucinated numbers without semantic meaning.
//
// Default model: bge-small-en-v1.5 (384d, 512 tokens) - selected in #865.
// Provides 384-dimensional embeddings trained with contrastive learning on
// diverse retrieval tasks. Same dimension as legacy MiniLM (no migration needed).
//
const DEFAULT_EMBEDDING_DIMENSION = REAL_EMBEDDING_DIMENSION; // 384
const DEFAULT_BATCH_SIZE = configurable(10, [1, 128], 'Default batch size for embedding generation.');
const DEFAULT_MAX_CONCURRENT_BATCHES = configurable(1, [1, 8], 'Default concurrency for embedding batches.');
const DEFAULT_BATCH_DELAY_MS = configurable(0, [0, 10_000], 'Default delay between embedding batches (ms).');
const DEFAULT_RETRY_MAX = configurable(5, [0, 10], 'Maximum retries for embedding generation.');
const DEFAULT_RETRY_INITIAL_DELAY_MS = configurable(
  1000,
  [0, 120_000],
  'Initial backoff delay for embedding retries (ms).'
);
const DEFAULT_RETRY_MAX_DELAY_MS = configurable(
  60000,
  [0, 300_000],
  'Maximum backoff delay for embedding retries (ms).'
);
const DEFAULT_RETRY_BACKOFF_MULTIPLIER = configurable(
  2,
  [1, 5],
  'Backoff multiplier for embedding retries.'
);
const DEFAULT_RETRY_JITTER_FACTOR = configurable(
  0.2,
  [0, 1],
  'Jitter factor for embedding retry backoff.'
);
const DEFAULT_NORM_TOLERANCE = configurable(
  1e-3,
  [1e-6, 0.1],
  'Tolerance for embedding vector normalization checks.'
);
const DEFAULT_EMBEDDING_RETRY_CONFIG: EmbeddingRetryConfig = {
  maxRetries: resolveQuantifiedValue(DEFAULT_RETRY_MAX),
  initialDelayMs: resolveQuantifiedValue(DEFAULT_RETRY_INITIAL_DELAY_MS),
  maxDelayMs: resolveQuantifiedValue(DEFAULT_RETRY_MAX_DELAY_MS),
  backoffMultiplier: resolveQuantifiedValue(DEFAULT_RETRY_BACKOFF_MULTIPLIER),
  jitterFactor: resolveQuantifiedValue(DEFAULT_RETRY_JITTER_FACTOR),
  nonRetryableErrors: [
    'provider_unavailable',
    'embedding_redaction_blocked',
    // Deterministic validation failures; retries won't change the embedding.
    'embedding_zero_norm',
    'embedding_non_finite',
    'embedding_invalid_norm',
    'invalid_input',
    'invalid_request',
  ],
};
const DEFAULT_EMBEDDING_NORMALIZATION_CONFIG: EmbeddingNormalizationConfig = {
  validateNormalization: true,
  normTolerance: resolveQuantifiedValue(DEFAULT_NORM_TOLERANCE),
  autoNormalize: true,
};

// Re-export utilities
export { cosineSimilarity, REAL_EMBEDDING_DIMENSION };

export class EmbeddingService {
  private readonly provider: EmbeddingProvider;
  private readonly modelId: string;
  private readonly embeddingDimension: number;
  private readonly contextWindowTokens: number;
  private readonly maxBatchSize: number;
  private readonly maxConcurrentBatches: number;
  private readonly batchDelayMs: number;
  private readonly retryConfig: EmbeddingRetryConfig;
  private readonly normalizationConfig: EmbeddingNormalizationConfig;
  private readonly governorContext: GovernorContextLike | null;
  private readonly redactSensitive: boolean;
  private readonly blockOnRedaction: boolean;
  private readonly now: () => Date;
  private readonly workspaceRoot: string;

  constructor(options: EmbeddingServiceOptions = {}) {
    const explicitModelId = options.modelId ?? process.env.LIBRARIAN_EMBEDDING_MODEL;
    let modelConfig: EmbeddingConfig;
    let resolvedModelId: string;
    try {
      modelConfig = getEmbeddingConfig(explicitModelId);
      resolvedModelId = modelConfig.model;
    } catch {
      // Fallback to bge-small-en-v1.5 (384d, same as MiniLM); if that also
      // fails somehow, the outer getEmbeddingConfig will throw.
      modelConfig = getEmbeddingConfig('bge-small-en-v1.5');
      resolvedModelId = explicitModelId ?? modelConfig.model;
    }

    this.provider = options.provider ?? modelConfig.provider;
    this.modelId = resolvedModelId;
    this.embeddingDimension = options.embeddingDimension ?? modelConfig.dimensions;
    this.contextWindowTokens = modelConfig.contextWindow;
    this.maxBatchSize = resolveQuantifiedValue(options.maxBatchSize ?? DEFAULT_BATCH_SIZE);
    this.maxConcurrentBatches = resolveQuantifiedValue(
      options.maxConcurrentBatches ?? DEFAULT_MAX_CONCURRENT_BATCHES
    );
    this.batchDelayMs = resolveQuantifiedValue(options.batchDelayMs ?? DEFAULT_BATCH_DELAY_MS);
    this.retryConfig = resolveEmbeddingRetryConfig(options.retryConfig);
    this.normalizationConfig = resolveEmbeddingNormalizationConfig(options.normalizationConfig);
    this.governorContext = options.governorContext ?? null;
    this.redactSensitive = options.redactSensitive ?? true;
    this.blockOnRedaction = options.blockOnRedaction ?? false;
    this.now = options.now ?? (() => new Date());
    this.workspaceRoot = options.workspaceRoot ?? process.cwd();

    // Validate dimension matches real embedding model
    if (this.embeddingDimension !== REAL_EMBEDDING_DIMENSION) {
      console.warn(
        `[librarian] Warning: embeddingDimension (${this.embeddingDimension}) differs from ` +
        `REAL_EMBEDDING_DIMENSION (${REAL_EMBEDDING_DIMENSION}). Using real model dimension.`
      );
    }
  }

  /**
   * Returns the dimension of embeddings produced by this service.
   * @returns The embedding vector dimension for the configured model.
   */
  getEmbeddingDimension(): number {
    return this.embeddingDimension;
  }

  /**
   * Generates an embedding vector for a single text input.
   *
   * This is a convenience wrapper around generateEmbeddings for single requests.
   * Uses a real embedding provider (default: `@huggingface/transformers` all-MiniLM-L6-v2).
   *
   * @param request - The embedding request with text and optional kind/id
   * @param options - Optional governor context for resource tracking
   * @returns The embedding result with vector and metadata
   * @throws Error if the embedding generation fails
   *
   * @example
   * ```typescript
   * const result = await embeddingService.generateEmbedding({
   *   text: 'function that validates user input',
   *   kind: 'query'
   * });
   * console.log(result.embedding.length); // 384
   * ```
   */
  async generateEmbedding(
    request: EmbeddingRequest,
    options: { governorContext?: GovernorContextLike } = {}
  ): Promise<EmbeddingResult> {
    const [result] = await this.generateEmbeddings([request], options);
    if (!result) {
      throw new Error('unverified_by_trace(provider_invalid_output): empty embedding result');
    }
    return result;
  }

  /**
   * Generates embedding vectors for multiple text inputs in batches.
   *
   * Automatically handles batching, rate limiting, and concurrent requests
   * based on the service configuration and governor budget constraints.
   *
   * @param requests - Array of embedding requests to process
   * @param options - Optional governor context for resource tracking
   * @returns Array of embedding results in the same order as inputs
   *
   * @example
   * ```typescript
   * const results = await embeddingService.generateEmbeddings([
   *   { text: 'authentication middleware', kind: 'document' },
   *   { text: 'user login flow', kind: 'document' }
   * ]);
   * ```
   */
  async generateEmbeddings(
    requests: EmbeddingRequest[],
    options: { governorContext?: GovernorContextLike } = {}
  ): Promise<EmbeddingResult[]> {
    if (requests.length === 0) return emptyArray<EmbeddingResult>();

    const results: EmbeddingResult[] = [];
    const governor = options.governorContext ?? this.governorContext ?? null;
    const batchSize = resolveBatchSize(this.maxBatchSize, governor);
    if (batchSize <= 0) {
      throw new Error('Embedding batch size must be positive');
    }
    const batches = chunkRequests(requests, batchSize);
    const concurrency = Math.max(1, this.maxConcurrentBatches);
    const resultsByBatch: EmbeddingResult[][] = new Array(batches.length);
    let nextIndex = 0;

    const worker = async (): Promise<void> => {
      while (nextIndex < batches.length) {
        const index = nextIndex;
        nextIndex += 1;
        const batch = batches[index];
        const batchResults = await this.generateBatchEmbeddings(batch, governor);
        resultsByBatch[index] = batchResults;
        if (this.batchDelayMs > 0 && index < batches.length - 1) {
          await delay(this.batchDelayMs);
        }
      }
    };

    const workers = Array.from({ length: Math.min(concurrency, batches.length) }, () => worker());
    await Promise.all(workers);
    for (const batchResults of resultsByBatch) {
      if (batchResults) results.push(...batchResults);
    }

    return results;
  }

  private async generateBatchEmbeddings(
    batch: EmbeddingRequest[],
    governorContext?: GovernorContextLike | null
  ): Promise<EmbeddingResult[]> {
    const { batch: sanitizedBatch, redactions } = this.redactSensitive
      ? sanitizeEmbeddingBatch(batch)
      : { batch, redactions: createEmptyRedactionCounts() };

    if (this.blockOnRedaction && redactions.total > 0) {
      throw new Error('unverified_by_trace(embedding_redaction_blocked): redactions detected in embedding inputs');
    }

    const requestTokens = sanitizedBatch.map((item) => estimateTokenCount(item.text));
    const results: EmbeddingResult[] = [];

    // Bounded retries with exponential backoff to prevent infinite hangs.
    for (const [index, item] of sanitizedBatch.entries()) {
      let lastError: Error | null = null;
      let success = false;
      const maxRetries = this.retryConfig.maxRetries;
      const maxAttempts = maxRetries + 1;

      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        try {
          governorContext?.checkBudget();

          const result = await this.generateEmbeddingWithContextWindow(item.text, governorContext ?? null);
          const embedding = normalizeEmbeddingIfNeeded(result.embedding, this.normalizationConfig);
          const generatedAt = this.now().toISOString();

          results.push({
            embedding,
            modelId: this.modelId,
            provider: result.provider,
            generatedAt,
            tokenCount: requestTokens[index] ?? estimateTokenCount(item.text),
          });

          success = true;
          break;
        } catch (error: unknown) {
          const message = getErrorMessage(error);
          lastError = error instanceof Error ? error : new Error(message);

          // Check for unrecoverable errors
          if (message.includes('No embedding provider available')) {
            // This is unrecoverable - no provider can be found
            throw wrapProviderUnavailable(message);
          }
          if (isNonRetryableEmbeddingError(error, this.retryConfig)) {
            throw lastError;
          }

          if (attempt >= maxRetries) {
            break;
          }

          governorContext?.recordRetry();
          const backoffMs = computeRetryDelayMs(attempt + 1, this.retryConfig);
          console.warn(
            `[librarian] Embedding generation failed (attempt ${attempt + 1}/${maxAttempts}), ` +
            `retrying in ${backoffMs}ms: ${message}`
          );
          await delay(backoffMs);
        }
      }
      if (!success) {
        const message = lastError ? getErrorMessage(lastError) : 'unknown error';
        throw new Error(`unverified_by_trace(embedding_retry_exhausted): ${message}`);
      }
    }

    await this.recordPrivacyAuditForBatch(sanitizedBatch, results);
    return results;
  }

  private async generateEmbeddingWithContextWindow(
    text: string,
    governorContext: GovernorContextLike | null
  ): Promise<{ embedding: Float32Array; provider: EmbeddingProvider }> {
    const modelId = this.modelId as EmbeddingModelId;
    const requestTokens = estimateTokenCount(text);

    if (requestTokens <= this.contextWindowTokens) {
      const result = await generateRealEmbedding(text, modelId);
      return {
        embedding: result.embedding,
        provider: result.provider,
      };
    }

    const chunks = chunkTextForEmbedding(text, this.contextWindowTokens);
    const chunkEmbeddings: Float32Array[] = [];
    let provider: EmbeddingProvider = this.provider;

    for (const chunk of chunks) {
      governorContext?.checkBudget();
      const chunkResult = await generateRealEmbedding(chunk, modelId);
      chunkEmbeddings.push(chunkResult.embedding);
      provider = chunkResult.provider;
    }

    return {
      embedding: mergeChunkEmbeddings(chunkEmbeddings),
      provider,
    };
  }

  private async recordPrivacyAuditForBatch(batch: EmbeddingRequest[], results: EmbeddingResult[]): Promise<void> {
    if (results.length === 0) return;
    const files = batch
      .map((request) => request.hint)
      .filter((hint): hint is string => typeof hint === 'string' && hint.trim().length > 0);
    const provider = results[0]?.provider ?? this.provider;
    await appendPrivacyAuditEvent(this.workspaceRoot, {
      ts: this.now().toISOString(),
      op: 'embed',
      files,
      model: `${provider}/${this.modelId}`,
      local: true,
      contentSent: false,
      status: 'allowed',
      note: `count=${results.length}`,
    }).catch(() => {
      // Non-blocking audit trail. Never fail embeddings due to audit writes.
    });
  }
}

function chunkRequests<T>(requests: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < requests.length; i += size) {
    batches.push(requests.slice(i, i + size));
  }
  return batches;
}

function estimateTokenCount(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 1;
  return Math.max(1, Math.ceil(trimmed.length / 4));
}

function chunkTextForEmbedding(
  text: string,
  contextWindowTokens: number
): string[] {
  const safeContextTokens = Math.max(1, Math.floor(contextWindowTokens));
  const maxCharsPerChunk = safeContextTokens * 4;
  if (text.length <= maxCharsPerChunk) {
    return [text];
  }

  // Keep overlap so boundaries do not lose semantics across neighboring windows.
  const overlapChars = Math.min(
    maxCharsPerChunk - 1,
    Math.max(1, Math.floor(maxCharsPerChunk * 0.2))
  );

  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(text.length, start + maxCharsPerChunk);
    chunks.push(text.slice(start, end));
    if (end >= text.length) break;
    start = Math.max(0, end - overlapChars);
  }

  return chunks;
}

function mergeChunkEmbeddings(embeddings: Float32Array[]): Float32Array {
  if (embeddings.length === 0) {
    throw new Error('unverified_by_trace(provider_invalid_output): no chunk embeddings to merge');
  }

  const dimension = embeddings[0].length;
  const merged = new Float32Array(dimension);
  for (const embedding of embeddings) {
    if (embedding.length !== dimension) {
      throw new Error('unverified_by_trace(provider_invalid_output): chunk embeddings have inconsistent dimensions');
    }
    for (let i = 0; i < dimension; i++) {
      merged[i] += embedding[i];
    }
  }

  for (let i = 0; i < dimension; i++) {
    merged[i] /= embeddings.length;
  }

  return merged;
}

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveEmbeddingRetryConfig(
  override?: Partial<EmbeddingRetryConfig>
): EmbeddingRetryConfig {
  const maxRetries = Number.isFinite(override?.maxRetries)
    ? Math.max(0, Math.floor(override?.maxRetries as number))
    : DEFAULT_EMBEDDING_RETRY_CONFIG.maxRetries;
  const initialDelayMs = Number.isFinite(override?.initialDelayMs)
    ? Math.max(0, override?.initialDelayMs as number)
    : DEFAULT_EMBEDDING_RETRY_CONFIG.initialDelayMs;
  const rawMaxDelay = Number.isFinite(override?.maxDelayMs)
    ? Math.max(0, override?.maxDelayMs as number)
    : DEFAULT_EMBEDDING_RETRY_CONFIG.maxDelayMs;
  const maxDelayMs = Math.max(initialDelayMs, rawMaxDelay);
  const backoffMultiplier = Number.isFinite(override?.backoffMultiplier)
    ? Math.max(1, override?.backoffMultiplier as number)
    : DEFAULT_EMBEDDING_RETRY_CONFIG.backoffMultiplier;
  const jitterFactor = Number.isFinite(override?.jitterFactor)
    ? clampNumber(override?.jitterFactor as number, 0, 1)
    : DEFAULT_EMBEDDING_RETRY_CONFIG.jitterFactor;
  const nonRetryableErrors = normalizeNonRetryableErrors(
    override?.nonRetryableErrors,
    DEFAULT_EMBEDDING_RETRY_CONFIG.nonRetryableErrors
  );

  return {
    maxRetries,
    initialDelayMs,
    maxDelayMs,
    backoffMultiplier,
    jitterFactor,
    nonRetryableErrors,
  };
}

function resolveEmbeddingNormalizationConfig(
  override?: Partial<EmbeddingNormalizationConfig>
): EmbeddingNormalizationConfig {
  return {
    validateNormalization: override?.validateNormalization ?? DEFAULT_EMBEDDING_NORMALIZATION_CONFIG.validateNormalization,
    normTolerance: Number.isFinite(override?.normTolerance)
      ? Math.max(0, override?.normTolerance as number)
      : DEFAULT_EMBEDDING_NORMALIZATION_CONFIG.normTolerance,
    autoNormalize: override?.autoNormalize ?? DEFAULT_EMBEDDING_NORMALIZATION_CONFIG.autoNormalize,
  };
}

function normalizeNonRetryableErrors(
  overrides: unknown,
  defaults: string[]
): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const entry of defaults) {
    const lowered = entry.trim().toLowerCase();
    if (!lowered || seen.has(lowered)) continue;
    seen.add(lowered);
    normalized.push(lowered);
  }
  if (Array.isArray(overrides)) {
    for (const entry of overrides) {
      if (typeof entry !== 'string') continue;
      const lowered = entry.trim().toLowerCase();
      if (!lowered || seen.has(lowered)) continue;
      seen.add(lowered);
      normalized.push(lowered);
    }
  }
  return normalized;
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function computeRetryDelayMs(
  attempt: number,
  config: EmbeddingRetryConfig,
  randomFn: () => number = Math.random
): number {
  if (attempt <= 0) return 0;
  const baseDelay = config.initialDelayMs * Math.pow(config.backoffMultiplier, attempt - 1);
  const capped = Math.min(config.maxDelayMs, baseDelay);
  if (!config.jitterFactor) {
    return Math.max(0, Math.round(capped));
  }
  const jitter = capped * config.jitterFactor * (randomFn() - 0.5);
  const withJitter = capped + jitter;
  return Math.min(config.maxDelayMs, Math.max(0, Math.round(withJitter)));
}

function isNonRetryableEmbeddingError(
  error: unknown,
  config: EmbeddingRetryConfig
): boolean {
  const message = getErrorMessage(error).toLowerCase();
  return config.nonRetryableErrors.some((needle) => needle && message.includes(needle));
}

function normalizeEmbeddingIfNeeded(
  embedding: Float32Array,
  config: EmbeddingNormalizationConfig
): Float32Array {
  if (!config.validateNormalization) return embedding;
  const norm = computeEmbeddingNorm(embedding);
  if (!Number.isFinite(norm)) {
    throw new Error('unverified_by_trace(embedding_non_finite): cannot normalize non-finite embedding');
  }
  if (norm === 0) {
    throw new Error('unverified_by_trace(embedding_zero_norm): cannot normalize zero-length embedding');
  }
  if (Math.abs(norm - 1) <= config.normTolerance) {
    return embedding;
  }
  if (!config.autoNormalize) {
    throw new Error(
      `unverified_by_trace(embedding_not_normalized): norm=${norm.toFixed(6)} tolerance=${config.normTolerance}`
    );
  }
  return normalizeEmbeddingWithNorm(embedding, norm);
}

// Scaled sum-of-squares (LAPACK-style) to avoid overflow/underflow in L2 norms.
function computeEmbeddingNorm(embedding: Float32Array): number {
  let scale = 0;
  let sumsq = 1;
  for (let i = 0; i < embedding.length; i++) {
    const value = embedding[i];
    const abs = Math.abs(value);
    if (!Number.isFinite(abs)) {
      return Number.NaN;
    }
    if (abs === 0) {
      continue;
    }
    if (scale < abs) {
      const ratio = scale / abs;
      sumsq = 1 + sumsq * ratio * ratio;
      scale = abs;
    } else {
      const ratio = abs / scale;
      sumsq += ratio * ratio;
    }
  }
  if (scale === 0) return 0;
  return scale * Math.sqrt(sumsq);
}

function normalizeEmbeddingWithNorm(
  embedding: Float32Array,
  norm: number
): Float32Array {
  if (!Number.isFinite(norm) || norm === 0) {
    throw new Error('unverified_by_trace(embedding_invalid_norm): cannot normalize embedding with invalid norm');
  }
  const normalized = new Float32Array(embedding.length);
  for (let i = 0; i < embedding.length; i++) {
    normalized[i] = embedding[i] / norm;
  }
  return normalized;
}

function wrapProviderUnavailable(message: string): Error {
  if (message.includes('unverified_by_trace')) {
    return new Error(message);
  }
  return new Error(`unverified_by_trace(provider_unavailable): ${message}`);
}

function sanitizeEmbeddingBatch(
  batch: EmbeddingRequest[]
): { batch: EmbeddingRequest[]; redactions: RedactionCounts } {
  let counts = createEmptyRedactionCounts();
  const sanitized = batch.map((item) => {
    const redacted = redactText(item.text);
    counts = mergeRedactionCounts(counts, redacted.counts);
    return { ...item, text: redacted.text };
  });
  return { batch: sanitized, redactions: counts };
}

function resolveBatchSize(defaultBatchSize: number, governor: GovernorContextLike | null): number {
  const governorBatchSize = governor?.snapshot?.().config?.maxEmbeddingsPerBatch;
  if (Number.isFinite(governorBatchSize) && (governorBatchSize ?? 0) > 0) {
    if (Number.isFinite(defaultBatchSize) && defaultBatchSize > 0) {
      return Math.min(defaultBatchSize, governorBatchSize as number);
    }
    return governorBatchSize as number;
  }
  return defaultBatchSize;
}

export const __testing = {
  resolveEmbeddingRetryConfig,
  resolveEmbeddingNormalizationConfig,
  computeRetryDelayMs,
  isNonRetryableEmbeddingError,
  normalizeEmbeddingIfNeeded,
  computeEmbeddingNorm,
  normalizeEmbeddingWithNorm,
  chunkTextForEmbedding,
  mergeChunkEmbeddings,
  DEFAULT_EMBEDDING_RETRY_CONFIG,
  DEFAULT_EMBEDDING_NORMALIZATION_CONFIG,
};
