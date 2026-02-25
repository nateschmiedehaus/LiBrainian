import { HierarchicalMemory } from '../cache/tiered_cache.js';
import type { LibrarianStorage, QueryCacheEntry } from '../storage/types.js';
import type { LibrarianQuery } from '../types.js';
import { safeJsonParse } from '../utils/safe_json.js';
import { noResult } from './empty_values.js';
import {
  deserializeCachedResponse,
  QUERY_CACHE_TTL_L1_MS,
  QUERY_CACHE_TTL_L2_MS,
  resolveQueryCacheTier,
  resolveQueryCacheTtl,
  serializeCachedResponse,
  type CachedResponse,
} from './query_cache_response_utils.js';

export type QueryCacheStore = LibrarianStorage & {
  getQueryCacheEntry?: (queryHash: string) => Promise<QueryCacheEntry | null>;
  upsertQueryCacheEntry?: (entry: QueryCacheEntry) => Promise<void>;
  recordQueryCacheAccess?: (queryHash: string) => Promise<void>;
  pruneQueryCache?: (options: { maxEntries: number; maxAgeMs: number }) => Promise<number>;
  getRecentQueryCacheEntries?: (limit: number) => Promise<QueryCacheEntry[]>;
};

const QUERY_CACHE_L1_LIMIT = 100;
const QUERY_CACHE_L2_LIMIT = 1000;
const queryCacheByStorage = new WeakMap<LibrarianStorage, HierarchicalMemory<CachedResponse>>();

export function getQueryCache(storage: LibrarianStorage): HierarchicalMemory<CachedResponse> {
  const existing = queryCacheByStorage.get(storage);
  if (existing) return existing;
  const memory = new HierarchicalMemory<CachedResponse>({
    l1Max: QUERY_CACHE_L1_LIMIT,
    l2Max: QUERY_CACHE_L2_LIMIT,
    l1TtlMs: QUERY_CACHE_TTL_L1_MS,
    l2TtlMs: QUERY_CACHE_TTL_L2_MS,
    l3: {
      get: (key) => readPersistentCache(storage, key),
      set: (key, value) => writePersistentCache(storage, key, value),
    },
  });
  queryCacheByStorage.set(storage, memory);
  return memory;
}

function extractQueryDepth(entry: QueryCacheEntry): LibrarianQuery['depth'] | undefined {
  const parsed = safeJsonParse<LibrarianQuery>(entry.queryParams);
  if (!parsed.ok || !parsed.value) return undefined;
  return parsed.value.depth;
}

export async function setCachedQuery(
  key: string,
  response: CachedResponse,
  storage: LibrarianStorage,
  query: LibrarianQuery
): Promise<void> {
  const cache = getQueryCache(storage);
  await cache.set(key, response, resolveQueryCacheTier(query));
}

async function readPersistentCache(storage: LibrarianStorage, key: string): Promise<CachedResponse | null> {
  const cacheStore = storage as QueryCacheStore;
  if (!cacheStore.getQueryCacheEntry) return noResult();
  const entry = await cacheStore.getQueryCacheEntry(key);
  if (!entry) return noResult();
  const createdAt = Date.parse(entry.createdAt);
  const ttlMs = resolveQueryCacheTtl(extractQueryDepth(entry));
  if (Number.isFinite(createdAt) && Date.now() - createdAt > ttlMs) {
    if (cacheStore.pruneQueryCache) {
      await cacheStore.pruneQueryCache({ maxEntries: QUERY_CACHE_L2_LIMIT, maxAgeMs: QUERY_CACHE_TTL_L2_MS });
    }
    return noResult();
  }
  const parsed = deserializeCachedResponse(entry.response);
  if (!parsed) return noResult();
  return parsed;
}

async function writePersistentCache(storage: LibrarianStorage, key: string, response: CachedResponse): Promise<void> {
  const cacheStore = storage as QueryCacheStore;
  if (!cacheStore?.upsertQueryCacheEntry) return;
  const nowIso = new Date().toISOString();
  await cacheStore.upsertQueryCacheEntry({
    queryHash: key,
    queryParams: JSON.stringify(response.query),
    response: serializeCachedResponse(response),
    createdAt: nowIso,
    lastAccessed: nowIso,
    accessCount: 1,
  });
  if (cacheStore.pruneQueryCache) {
    await cacheStore.pruneQueryCache({ maxEntries: QUERY_CACHE_L2_LIMIT, maxAgeMs: QUERY_CACHE_TTL_L2_MS });
  }
}
