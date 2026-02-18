/**
 * @fileoverview Tests for embedding dimension mismatch auto-recovery
 *
 * These tests verify that the auto-recovery mechanisms work correctly
 * when embedding dimensions change (e.g., when switching embedding models).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { createSqliteStorage } from '../sqlite_storage.js';
import type { LibrarianStorage, EmbeddingMetadata } from '../types.js';

describe('Embedding Dimension Mismatch Recovery', () => {
  let storage: LibrarianStorage;
  let tempDir: string;
  let dbPath: string;

  beforeEach(async () => {
    // Create temporary directory for test database
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-test-'));
    dbPath = path.join(tempDir, 'test.db');
    storage = createSqliteStorage(dbPath, tempDir);
    await storage.initialize();
  });

  afterEach(async () => {
    await storage.close();
    // Clean up temp directory
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  /**
   * Helper to create embeddings with a specific dimension
   */
  function createEmbedding(dimension: number): Float32Array {
    const embedding = new Float32Array(dimension);
    for (let i = 0; i < dimension; i++) {
      embedding[i] = Math.random() - 0.5;
    }
    return embedding;
  }

  it('should report embedding stats correctly', async () => {
    // Store embeddings with different dimensions
    const metadata: EmbeddingMetadata = {
      modelId: 'test-model',
      entityType: 'function',
    };

    // 3 embeddings with dimension 384
    await storage.setEmbedding('fn1', createEmbedding(384), metadata);
    await storage.setEmbedding('fn2', createEmbedding(384), metadata);
    await storage.setEmbedding('fn3', createEmbedding(384), metadata);

    // 2 embeddings with dimension 768
    await storage.setEmbedding('fn4', createEmbedding(768), { ...metadata, modelId: 'large-model' });
    await storage.setEmbedding('fn5', createEmbedding(768), { ...metadata, modelId: 'large-model' });

    const stats = await storage.getEmbeddingStats();

    expect(stats).toHaveLength(2);
    expect(stats.find(s => s.dimension === 384)?.count).toBe(3);
    expect(stats.find(s => s.dimension === 768)?.count).toBe(2);
  });

  it('should clear mismatched embeddings correctly', async () => {
    const metadata: EmbeddingMetadata = {
      modelId: 'test-model',
      entityType: 'function',
    };

    // Store embeddings with different dimensions
    await storage.setEmbedding('fn1', createEmbedding(384), metadata);
    await storage.setEmbedding('fn2', createEmbedding(384), metadata);
    await storage.setEmbedding('fn3', createEmbedding(768), { ...metadata, modelId: 'large-model' });

    // Clear embeddings that don't match dimension 384
    const clearedCount = await storage.clearMismatchedEmbeddings(384);

    expect(clearedCount).toBe(1); // Only the 768-dim embedding should be cleared

    // Verify only 384-dim embeddings remain
    const stats = await storage.getEmbeddingStats();
    expect(stats).toHaveLength(1);
    expect(stats[0]?.dimension).toBe(384);
    expect(stats[0]?.count).toBe(2);
  });

  it('should auto-recover on similarity search when option is enabled', async () => {
    const metadata: EmbeddingMetadata = {
      modelId: 'old-model',
      entityType: 'function',
    };

    // Store embeddings with "old" dimension
    await storage.setEmbedding('fn1', createEmbedding(768), metadata);
    await storage.setEmbedding('fn2', createEmbedding(768), metadata);

    // Now query with a "new" dimension (simulating model change)
    const queryEmbedding = createEmbedding(384);

    // Without auto-recovery, this would throw
    const result = await storage.findSimilarByEmbedding(queryEmbedding, {
      limit: 10,
      minSimilarity: 0.5,
      autoRecoverDimensionMismatch: true,
    });

    // Should return degraded empty results after clearing mismatched embeddings
    expect(result.degraded).toBe(true);
    expect(result.degradedReason).toBe('auto_recovered_dimension_mismatch');
    expect(result.clearedMismatchedCount).toBe(2);
    expect(result.results).toHaveLength(0);

    // Verify embeddings were cleared
    const stats = await storage.getEmbeddingStats();
    expect(stats).toHaveLength(0);
  });

  it('should throw without auto-recovery option', async () => {
    const metadata: EmbeddingMetadata = {
      modelId: 'old-model',
      entityType: 'function',
    };

    // Store embeddings with "old" dimension
    await storage.setEmbedding('fn1', createEmbedding(768), metadata);
    await storage.setEmbedding('fn2', createEmbedding(768), metadata);

    // Query with different dimension without auto-recovery
    const queryEmbedding = createEmbedding(384);

    // Should throw error
    await expect(
      storage.findSimilarByEmbedding(queryEmbedding, {
        limit: 10,
        minSimilarity: 0.5,
        // autoRecoverDimensionMismatch not set (defaults to false)
      })
    ).rejects.toThrow('embedding_dimension_mismatch');
  });

  it('rejects zero-norm embeddings at storage boundary', async () => {
    const metadata: EmbeddingMetadata = {
      modelId: 'test-model',
      entityType: 'function',
    };
    const zeroVector = new Float32Array(384);

    await expect(storage.setEmbedding('zero-fn', zeroVector, metadata)).rejects.toThrow('provider_invalid_output');
  });
});
