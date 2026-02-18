import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as realEmbeddings from '../embedding_providers/real_embeddings.js';
import { EmbeddingService, __testing } from '../embeddings.js';

describe('embedding context window handling', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('chunks long inputs and embeds all windows instead of truncating to model context', async () => {
    const embedSpy = vi.spyOn(realEmbeddings, 'generateRealEmbedding').mockImplementation(async (_text, modelId = 'all-MiniLM-L6-v2') => ({
      embedding: new Float32Array(384).fill(0.25),
      provider: 'xenova',
      dimension: 384,
      model: modelId,
    }));

    const service = new EmbeddingService({
      modelId: 'all-MiniLM-L6-v2',
      retryConfig: { maxRetries: 0 },
      now: () => new Date('2026-02-18T00:00:00.000Z'),
    });

    const longText = 'const longTokenizedLine = value + otherValue;\n'.repeat(60);
    const result = await service.generateEmbedding({
      text: longText,
      kind: 'code',
    });

    expect(embedSpy.mock.calls.length).toBeGreaterThan(1);
    expect(result.tokenCount).toBeGreaterThanOrEqual(400);
    expect(result.modelId).toBe('all-MiniLM-L6-v2');
    expect(result.generatedAt).toBe('2026-02-18T00:00:00.000Z');
    for (const call of embedSpy.mock.calls) {
      expect(call[1]).toBe('all-MiniLM-L6-v2');
    }
  });

  it('uses LIBRARIAN_EMBEDDING_MODEL when modelId is omitted', async () => {
    process.env.LIBRARIAN_EMBEDDING_MODEL = 'bge-small-en-v1.5';

    const embedSpy = vi.spyOn(realEmbeddings, 'generateRealEmbedding').mockImplementation(async (_text, modelId = 'all-MiniLM-L6-v2') => ({
      embedding: new Float32Array(384).fill(0.1),
      provider: 'xenova',
      dimension: 384,
      model: modelId,
    }));

    const service = new EmbeddingService({
      retryConfig: { maxRetries: 0 },
    });

    const result = await service.generateEmbedding({
      text: 'short text',
      kind: 'query',
    });

    expect(embedSpy).toHaveBeenCalledTimes(1);
    expect(embedSpy.mock.calls[0][1]).toBe('bge-small-en-v1.5');
    expect(result.modelId).toBe('bge-small-en-v1.5');
  });

  it('chunks with overlap and covers full text', () => {
    const text = Array.from({ length: 1600 }, (_, i) => String.fromCharCode(97 + (i % 26))).join('');
    const chunks = __testing.chunkTextForEmbedding(text, 100);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].startsWith(text.slice(0, 40))).toBe(true);
    expect(chunks[chunks.length - 1].endsWith(text.slice(-40))).toBe(true);
    expect(chunks[0].slice(-80)).toBe(chunks[1].slice(0, 80));
    expect(chunks[0].length).toBeLessThanOrEqual(400);
  });

  it('rejects merging chunk embeddings with mixed dimensions', () => {
    expect(() => __testing.mergeChunkEmbeddings([
      new Float32Array(384).fill(1),
      new Float32Array(383).fill(1),
    ])).toThrow('provider_invalid_output');
  });
});
