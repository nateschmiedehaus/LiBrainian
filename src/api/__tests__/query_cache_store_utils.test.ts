import { describe, expect, it, vi } from 'vitest';
import type { ContextPack, LibrarianQuery, LibrarianVersion, QueryCacheEntry } from '../../types.js';
import {
  getQueryCache,
  setCachedQuery,
  type QueryCacheStore,
} from '../query_cache_store_utils.js';
import { serializeCachedResponse, type CachedResponse } from '../query_cache_response_utils.js';

const TEST_VERSION: LibrarianVersion = {
  major: 1,
  minor: 0,
  patch: 0,
  string: '1.0.0-test',
  qualityTier: 'full',
  indexedAt: new Date('2026-02-01T00:00:00.000Z'),
  indexerVersion: 'test',
  features: [],
};

const makePack = (id: string): ContextPack => ({
  packId: `pack:${id}`,
  packType: 'module_context',
  targetId: id,
  summary: `Summary for ${id}`,
  keyFacts: ['fact'],
  codeSnippets: [],
  relatedFiles: [`src/${id}.ts`],
  confidence: 0.8,
  createdAt: new Date('2026-02-01T01:00:00.000Z'),
  accessCount: 0,
  lastOutcome: 'unknown',
  successCount: 0,
  failureCount: 0,
  version: TEST_VERSION,
  invalidationTriggers: [],
});

const makeQuery = (depth: LibrarianQuery['depth'] = 'L2'): LibrarianQuery => ({
  intent: 'trace query cache behavior',
  depth,
});

const makeResponse = (depth: LibrarianQuery['depth'] = 'L2'): CachedResponse => ({
  query: makeQuery(depth),
  packs: [makePack('alpha')],
  disclosures: [],
  traceId: 'trace:test',
  totalConfidence: 0.7,
  cacheHit: false,
  latencyMs: 42,
  version: TEST_VERSION,
  drillDownHints: [],
});

describe('query_cache_store_utils', () => {
  it('hydrates persistent cache entries and memoizes in memory tiers', async () => {
    const response = makeResponse('L2');
    const entry: QueryCacheEntry = {
      queryHash: 'key-1',
      queryParams: JSON.stringify(response.query),
      response: serializeCachedResponse(response),
      createdAt: new Date().toISOString(),
      lastAccessed: new Date().toISOString(),
      accessCount: 1,
    };
    const getQueryCacheEntry = vi.fn(async (_key: string) => entry);
    const storage = { getQueryCacheEntry } as QueryCacheStore;

    const cache = getQueryCache(storage);
    const first = await cache.get('key-1');
    const second = await cache.get('key-1');

    expect(first).not.toBeNull();
    expect(first?.version.indexedAt).toBeInstanceOf(Date);
    expect(first?.packs[0]?.createdAt).toBeInstanceOf(Date);
    expect(second?.packs[0]?.targetId).toBe('alpha');
    expect(getQueryCacheEntry).toHaveBeenCalledTimes(1);
  });

  it('drops stale persistent entries and prunes storage', async () => {
    const response = makeResponse('L0');
    const staleCreatedAt = new Date(Date.now() - (5 * 60 * 1000 + 2000)).toISOString();
    const entry: QueryCacheEntry = {
      queryHash: 'key-stale',
      queryParams: JSON.stringify(response.query),
      response: serializeCachedResponse(response),
      createdAt: staleCreatedAt,
      lastAccessed: staleCreatedAt,
      accessCount: 1,
    };
    const getQueryCacheEntry = vi.fn(async (_key: string) => entry);
    const pruneQueryCache = vi.fn(async () => 1);
    const storage = { getQueryCacheEntry, pruneQueryCache } as QueryCacheStore;

    const cache = getQueryCache(storage);
    const hydrated = await cache.get('key-stale');

    expect(hydrated).toBeNull();
    expect(pruneQueryCache).toHaveBeenCalledWith({
      maxEntries: 1000,
      maxAgeMs: 30 * 60 * 1000,
    });
  });

  it('persists cached query responses through the storage adapter', async () => {
    const response = makeResponse('L1');
    const upsertQueryCacheEntry = vi.fn(async (_entry: QueryCacheEntry) => undefined);
    const pruneQueryCache = vi.fn(async () => 0);
    const storage = { upsertQueryCacheEntry, pruneQueryCache } as QueryCacheStore;

    await setCachedQuery('key-write', response, storage, makeQuery('L1'));

    expect(upsertQueryCacheEntry).toHaveBeenCalledTimes(1);
    expect(upsertQueryCacheEntry).toHaveBeenCalledWith(expect.objectContaining({
      queryHash: 'key-write',
      queryParams: JSON.stringify(response.query),
      accessCount: 1,
    }));
    expect(pruneQueryCache).toHaveBeenCalledWith({
      maxEntries: 1000,
      maxAgeMs: 30 * 60 * 1000,
    });
  });
});
