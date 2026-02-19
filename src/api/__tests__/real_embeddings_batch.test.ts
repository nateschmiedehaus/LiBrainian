import { describe, it, expect } from 'vitest';
import { __testing } from '../embedding_providers/real_embeddings.js';

describe('real embedding batching utilities', () => {
  it('maps with bounded concurrency while preserving input order', async () => {
    const inputs = [1, 2, 3, 4, 5, 6];
    let active = 0;
    let maxActive = 0;

    const outputs = await __testing.mapWithConcurrency(inputs, 2, async (value) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return value * 10;
    });

    expect(outputs).toEqual([10, 20, 30, 40, 50, 60]);
    expect(maxActive).toBeGreaterThan(1);
    expect(maxActive).toBeLessThanOrEqual(2);
  });

  it('uses default and clamped embedding batch size from env', () => {
    const previous = process.env.LIBRARIAN_EMBEDDING_BATCH_SIZE;
    try {
      delete process.env.LIBRARIAN_EMBEDDING_BATCH_SIZE;
      expect(__testing.resolveEmbeddingBatchSize()).toBe(8);

      process.env.LIBRARIAN_EMBEDDING_BATCH_SIZE = '16';
      expect(__testing.resolveEmbeddingBatchSize()).toBe(16);

      process.env.LIBRARIAN_EMBEDDING_BATCH_SIZE = '1000';
      expect(__testing.resolveEmbeddingBatchSize()).toBe(64);

      process.env.LIBRARIAN_EMBEDDING_BATCH_SIZE = 'invalid';
      expect(__testing.resolveEmbeddingBatchSize()).toBe(8);
    } finally {
      if (previous === undefined) {
        delete process.env.LIBRARIAN_EMBEDDING_BATCH_SIZE;
      } else {
        process.env.LIBRARIAN_EMBEDDING_BATCH_SIZE = previous;
      }
    }
  });
});
