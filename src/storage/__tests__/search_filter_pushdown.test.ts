import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { createSqliteStorage } from '../sqlite_storage.js';
import type { ContextPack, FunctionKnowledge } from '../../types.js';
import type { LibrarianStorage } from '../types.js';

function normalize(values: number[]): Float32Array {
  const vector = new Float32Array(values);
  let norm = 0;
  for (const value of values) norm += value * value;
  const scale = Math.sqrt(norm);
  for (let i = 0; i < vector.length; i += 1) {
    vector[i] = vector[i]! / scale;
  }
  return vector;
}

function buildFunction(id: string, filePath: string, signature = 'export function auth() {}'): FunctionKnowledge {
  return {
    id,
    filePath,
    name: id,
    signature,
    purpose: `${id} purpose`,
    startLine: 1,
    endLine: 8,
    confidence: 0.9,
    accessCount: 0,
    lastAccessed: null,
    validationCount: 0,
    outcomeHistory: { successes: 0, failures: 0 },
  };
}

function buildPack(packId: string, targetId: string, relatedFile: string): ContextPack {
  return {
    packId,
    packType: 'function_context',
    targetId,
    summary: `${targetId} summary`,
    keyFacts: [`${targetId} fact`],
    codeSnippets: [],
    relatedFiles: [relatedFile],
    confidence: 0.8,
    createdAt: new Date('2026-02-19T00:00:00.000Z'),
    accessCount: 0,
    lastOutcome: 'unknown',
    successCount: 0,
    failureCount: 0,
    version: {
      major: 0,
      minor: 2,
      patch: 1,
      string: '0.2.1',
      qualityTier: 'full',
      indexedAt: new Date('2026-02-19T00:00:00.000Z'),
      indexerVersion: 'test',
      features: [],
    },
    invalidationTriggers: [relatedFile],
  };
}

describe('search filter pushdown', () => {
  let tempDir = '';
  let storage: LibrarianStorage | null = null;
  let apiFile = '';
  let webFile = '';

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-search-filter-'));
    apiFile = path.join(tempDir, 'packages', 'api', 'src', 'auth.ts');
    webFile = path.join(tempDir, 'packages', 'web', 'src', 'auth.ts');
    await fs.mkdir(path.dirname(apiFile), { recursive: true });
    await fs.mkdir(path.dirname(webFile), { recursive: true });
    await fs.writeFile(apiFile, 'export function apiAuth() { return true; }\n', 'utf8');
    await fs.writeFile(webFile, 'export function webAuth() { return true; }\n', 'utf8');

    const dbPath = path.join(tempDir, 'librarian.sqlite');
    storage = createSqliteStorage(dbPath, tempDir);
    await storage.initialize();

    await storage.upsertFunction(buildFunction('fn-web', webFile));
    await storage.upsertFunction(buildFunction('fn-api', apiFile));
    await storage.setEmbedding('fn-web', normalize([1, 0]), {
      modelId: 'test-model',
      entityType: 'function',
    });
    await storage.setEmbedding('fn-api', normalize([0.7, 0.3]), {
      modelId: 'test-model',
      entityType: 'function',
    });

    await storage.upsertContextPack(buildPack('pack-web', 'fn-web', webFile));
    await storage.upsertContextPack(buildPack('pack-api', 'fn-api', apiFile));
  });

  afterEach(async () => {
    if (storage) {
      await storage.close();
      storage = null;
    }
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('applies pathPrefix before limiting similarity candidates', async () => {
    const query = normalize([1, 0]);

    const unfiltered = await storage!.findSimilarByEmbedding(query, {
      limit: 1,
      minSimilarity: 0,
      entityTypes: ['function'],
    });
    expect(unfiltered.results).toHaveLength(1);
    expect(unfiltered.results[0]?.entityId).toBe('fn-web');

    const filtered = await storage!.findSimilarByEmbedding(query, {
      limit: 1,
      minSimilarity: 0,
      entityTypes: ['function'],
      filter: {
        pathPrefix: 'packages/api/',
      },
    });
    expect(filtered.results).toHaveLength(1);
    expect(filtered.results[0]?.entityId).toBe('fn-api');
  });

  it('filters context packs by relative path anchors and path prefixes', async () => {
    const byRelative = await storage!.getContextPacks({
      relatedFilesAny: ['packages/api/src/auth.ts'],
      limit: 5,
    });
    expect(byRelative.map((pack) => pack.packId)).toContain('pack-api');
    expect(byRelative.map((pack) => pack.packId)).not.toContain('pack-web');

    const byPrefix = await storage!.getContextPacks({
      relatedFilePrefix: 'packages/api/',
      limit: 1,
    });
    expect(byPrefix).toHaveLength(1);
    expect(byPrefix[0]?.packId).toBe('pack-api');
  });
});

