import type { MemoryTier } from '../cache/tiered_cache.js';
import type { ContextPack, LibrarianQuery, LibrarianResponse, LibrarianVersion } from '../types.js';
import type { EvidenceRef } from './evidence.js';
import { noResult } from './empty_values.js';
import { safeJsonParse } from '../utils/safe_json.js';

export type CachedResponse = LibrarianResponse & {
  explanation?: string;
  coverageGaps?: string[];
  evidenceByPack?: Record<string, EvidenceRef[]>;
};

export const QUERY_CACHE_TTL_L1_MS = 5 * 60 * 1000;
export const QUERY_CACHE_TTL_L2_MS = 30 * 60 * 1000;

type SerializedVersion = Omit<LibrarianVersion, 'indexedAt'> & { indexedAt: string };
type SerializedContextPack = Omit<ContextPack, 'createdAt' | 'version'> & {
  createdAt: string;
  version: SerializedVersion;
};
type SerializedResponse = Omit<CachedResponse, 'version' | 'packs'> & {
  version: SerializedVersion;
  packs: SerializedContextPack[];
};

export function resolveQueryCacheTier(query: LibrarianQuery): MemoryTier {
  return query.depth === 'L0' ? 'l1' : 'l2';
}

export function resolveQueryCacheTtl(depth?: LibrarianQuery['depth']): number {
  return depth === 'L0' ? QUERY_CACHE_TTL_L1_MS : QUERY_CACHE_TTL_L2_MS;
}

export function serializeCachedResponse(response: CachedResponse): string {
  return JSON.stringify(response, (_key, value) => (value instanceof Date ? value.toISOString() : value));
}

export function deserializeCachedResponse(raw: string): CachedResponse | null {
  const parsed = safeJsonParse<SerializedResponse>(raw);
  if (!parsed.ok) return noResult();
  const value = parsed.value;
  if (!value || !value.version || !Array.isArray(value.packs)) return noResult();
  const version = {
    ...value.version,
    indexedAt: new Date(value.version.indexedAt),
  };
  const packs = value.packs.map((pack) => ({
    ...pack,
    createdAt: new Date(pack.createdAt),
    version: {
      ...pack.version,
      indexedAt: new Date(pack.version.indexedAt),
    },
  }));
  return { ...value, version, packs };
}
