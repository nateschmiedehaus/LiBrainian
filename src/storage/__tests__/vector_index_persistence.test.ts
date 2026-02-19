import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createSqliteStorage } from '../sqlite_storage.js';
import type { EmbeddingMetadata, LibrarianStorage } from '../types.js';

function createEmbedding(seed: number, dimension = 64): Float32Array {
  const values = new Float32Array(dimension);
  let normSq = 0;
  for (let i = 0; i < dimension; i++) {
    const value = Math.sin(seed * 0.17 + i * 0.11);
    values[i] = value;
    normSq += value * value;
  }
  const norm = Math.sqrt(normSq);
  for (let i = 0; i < dimension; i++) {
    values[i] = values[i]! / norm;
  }
  return values;
}

describe('vector index persistence', () => {
  let tempDir = '';
  let dbPath = '';
  let storage: LibrarianStorage | null = null;
  let previousThreshold: string | undefined;
  const metadata: EmbeddingMetadata = {
    modelId: 'test-model',
    entityType: 'function',
  };

  beforeEach(async () => {
    previousThreshold = process.env.LIBRARIAN_HNSW_AUTO_THRESHOLD;
    process.env.LIBRARIAN_HNSW_AUTO_THRESHOLD = '1';
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-hnsw-persist-'));
    dbPath = path.join(tempDir, 'librarian.sqlite');
    storage = createSqliteStorage(dbPath, tempDir);
    await storage.initialize();
  });

  afterEach(async () => {
    if (storage) {
      await storage.close();
      storage = null;
    }
    if (previousThreshold === undefined) {
      delete process.env.LIBRARIAN_HNSW_AUTO_THRESHOLD;
    } else {
      process.env.LIBRARIAN_HNSW_AUTO_THRESHOLD = previousThreshold;
    }
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  async function seedEmbeddings(target: LibrarianStorage): Promise<Float32Array> {
    const first = createEmbedding(0);
    await target.setEmbedding('entity-0', first, metadata);
    for (let i = 1; i < 12; i++) {
      await target.setEmbedding(`entity-${i}`, createEmbedding(i), metadata);
    }
    return first;
  }

  it('creates .librarian/hnsw.bin after building index from embeddings', async () => {
    const query = await seedEmbeddings(storage!);
    const result = await storage!.findSimilarByEmbedding(query, {
      limit: 5,
      minSimilarity: 0,
    });

    expect(result.results.length).toBeGreaterThan(0);
    expect(existsSync(path.join(tempDir, '.librarian', 'hnsw.bin'))).toBe(true);
  });

  it('loads persisted hnsw.bin on restart when cache is fresh', async () => {
    const query = await seedEmbeddings(storage!);
    await storage!.findSimilarByEmbedding(query, {
      limit: 5,
      minSimilarity: 0,
    });
    await storage!.close();

    const reopened = createSqliteStorage(dbPath, tempDir);
    await reopened.initialize();
    storage = reopened;

    const loadItemsSpy = vi.spyOn(reopened as any, 'loadVectorIndexItems');
    const result = await reopened.findSimilarByEmbedding(query, {
      limit: 5,
      minSimilarity: 0,
    });

    expect(result.results.length).toBeGreaterThan(0);
    expect(loadItemsSpy).not.toHaveBeenCalled();
  });

  it('falls back to SQLite rebuild when hnsw.bin is missing', async () => {
    const query = await seedEmbeddings(storage!);
    await storage!.findSimilarByEmbedding(query, {
      limit: 5,
      minSimilarity: 0,
    });
    await fs.rm(path.join(tempDir, '.librarian', 'hnsw.bin'), { force: true });
    await storage!.close();

    const reopened = createSqliteStorage(dbPath, tempDir);
    await reopened.initialize();
    storage = reopened;

    const loadItemsSpy = vi.spyOn(reopened as any, 'loadVectorIndexItems');
    const result = await reopened.findSimilarByEmbedding(query, {
      limit: 5,
      minSimilarity: 0,
    });

    expect(result.results.length).toBeGreaterThan(0);
    expect(loadItemsSpy).toHaveBeenCalled();
    expect(existsSync(path.join(tempDir, '.librarian', 'hnsw.bin'))).toBe(true);
  });
});
