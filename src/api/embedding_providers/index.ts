/**
 * @fileoverview Embedding Provider Abstraction Layer
 *
 * This module provides a unified interface for the embedding system.
 * It wraps the real embedding providers (@huggingface/transformers, sentence-transformers)
 * with a provider-style interface for consistency with the rest of the librarian.
 *
 * POLICY (VISION.md 8.5):
 * - Embeddings MUST be real semantic vectors from dedicated embedding models
 * - LLM-generated "embeddings" are FORBIDDEN (they're hallucinated numbers)
 * - NO TIMEOUTS - operations complete or fail, never timeout
 * - NO RETRY LIMITS - retry until success or unrecoverable error
 *
 * Provider priority: @huggingface/transformers → sentence-transformers
 */

import { EmbeddingService, type EmbeddingKind, type EmbeddingResult, type EmbeddingProvider } from '../embeddings.js';
import {
  REAL_EMBEDDING_DIMENSION,
  cosineSimilarity as realCosineSimilarity,
  normalizeEmbedding as realNormalizeEmbedding,
} from './real_embeddings.js';

export interface EmbeddingProviderConfig {
  provider?: EmbeddingProvider;
  modelId?: string;
  dimensions?: number;
  maxBatchSize?: number;
}

export interface EmbeddingProviderResult {
  embeddings: Float32Array[];
  model: string;
  provider: EmbeddingProvider;
  tokensUsed: number;
  latencyMs: number;
}

export interface ProviderStatus {
  available: boolean;
  reason?: string;
  lastSuccess?: string;
  lastError?: string;
  avgLatencyMs?: number;
}

/**
 * Unified embedding provider that wraps the real embedding service.
 * Uses @huggingface/transformers or sentence-transformers for real semantic embeddings.
 */
export class UnifiedEmbeddingProvider {
  private readonly service: EmbeddingService;
  private readonly dimensions: number;
  private lastSuccess?: string;
  private lastError?: string;
  private latencyHistory: number[] = [];

  constructor(config: EmbeddingProviderConfig = {}) {
    this.dimensions = config.dimensions ?? REAL_EMBEDDING_DIMENSION;
    this.service = new EmbeddingService({
      provider: config.provider ?? 'xenova',
      modelId: config.modelId ?? 'all-MiniLM-L6-v2',
      embeddingDimension: this.dimensions,
      maxBatchSize: config.maxBatchSize ?? 10,
    });
  }

  getDimensions(): number {
    return REAL_EMBEDDING_DIMENSION;
  }

  async isAvailable(): Promise<boolean> {
    // Check if any real embedding provider is available
    try {
      const { isXenovaAvailable, isSentenceTransformersAvailable } = await import('./real_embeddings.js');
      return await isXenovaAvailable() || await isSentenceTransformersAvailable();
    } catch {
      return false;
    }
  }

  /**
   * Generate embeddings for a batch of texts.
   */
  async generateEmbeddings(
    texts: string[],
    kind: EmbeddingKind = 'code'
  ): Promise<EmbeddingProviderResult> {
    if (texts.length === 0) {
      return {
        embeddings: [],
        model: 'all-MiniLM-L6-v2',
        provider: 'xenova',
        tokensUsed: 0,
        latencyMs: 0,
      };
    }

    const startTime = Date.now();

    try {
      const requests = texts.map(text => ({ text, kind }));
      const results = await this.service.generateEmbeddings(requests);
      const latencyMs = Date.now() - startTime;

      this.recordLatency(latencyMs);
      this.lastSuccess = new Date().toISOString();

      const tokensUsed = results.reduce((sum, r) => sum + r.tokenCount, 0);
      const firstResult = results[0];

      return {
        embeddings: results.map(r => r.embedding),
        model: firstResult?.modelId ?? 'all-MiniLM-L6-v2',
        provider: firstResult?.provider ?? 'xenova',
        tokensUsed,
        latencyMs,
      };
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  /**
   * Generate a single embedding.
   */
  async generateEmbedding(
    text: string,
    kind: EmbeddingKind = 'code'
  ): Promise<{ embedding: Float32Array; model: string; provider: EmbeddingProvider }> {
    const result = await this.generateEmbeddings([text], kind);
    const embedding = result.embeddings[0];
    if (!embedding) {
      throw new Error('No embedding returned');
    }
    return {
      embedding,
      model: result.model,
      provider: result.provider,
    };
  }

  async getStatus(): Promise<ProviderStatus> {
    const available = await this.isAvailable();
    return {
      available,
      reason: available
        ? 'Real embedding provider available (@huggingface/transformers or sentence-transformers)'
        : 'No embedding provider available. Install @huggingface/transformers (npm) or sentence-transformers (Python).',
      lastSuccess: this.lastSuccess,
      lastError: this.lastError,
      avgLatencyMs: this.getAverageLatency(),
    };
  }

  private recordLatency(latencyMs: number): void {
    this.latencyHistory.push(latencyMs);
    if (this.latencyHistory.length > 100) {
      this.latencyHistory.shift();
    }
  }

  private getAverageLatency(): number | undefined {
    if (this.latencyHistory.length === 0) return undefined;
    const sum = this.latencyHistory.reduce((a, b) => a + b, 0);
    return Math.round(sum / this.latencyHistory.length);
  }
}

/**
 * Helper to normalize embeddings to unit vectors.
 */
export function normalizeEmbedding(embedding: number[] | Float32Array): Float32Array {
  const arr = embedding instanceof Float32Array ? embedding : new Float32Array(embedding);
  return realNormalizeEmbedding(arr);
}

/**
 * Compute cosine similarity between two normalized embeddings.
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  return realCosineSimilarity(a, b);
}

/**
 * Create a default embedding provider using real embedding models.
 */
export function createDefaultProvider(config: EmbeddingProviderConfig = {}): UnifiedEmbeddingProvider {
  return new UnifiedEmbeddingProvider(config);
}

// Re-export types from the main embeddings module for convenience
export type { EmbeddingKind, EmbeddingResult, EmbeddingProvider } from '../embeddings.js';
export { REAL_EMBEDDING_DIMENSION } from './real_embeddings.js';
