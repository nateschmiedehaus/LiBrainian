import { describe, it, expect } from 'vitest';
import type { ContextPack, LibrarianQuery, LibrarianVersion } from '../../types.js';
import {
  deserializeCachedResponse,
  QUERY_CACHE_TTL_L1_MS,
  QUERY_CACHE_TTL_L2_MS,
  resolveQueryCacheTier,
  resolveQueryCacheTtl,
  serializeCachedResponse,
  type CachedResponse,
} from '../query_cache_response_utils.js';

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

const makeResponse = (): CachedResponse => ({
  query: makeQuery(),
  packs: [makePack('alpha')],
  disclosures: [],
  traceId: 'trace:test',
  totalConfidence: 0.7,
  cacheHit: false,
  latencyMs: 42,
  version: TEST_VERSION,
  drillDownHints: [],
  explanation: 'cache hit rationale',
  coverageGaps: ['gap-a'],
});

describe('query_cache_response_utils', () => {
  it('resolves cache tier from query depth', () => {
    expect(resolveQueryCacheTier(makeQuery('L0'))).toBe('l1');
    expect(resolveQueryCacheTier(makeQuery('L1'))).toBe('l2');
    expect(resolveQueryCacheTier(makeQuery('L2'))).toBe('l2');
  });

  it('resolves cache TTL from depth', () => {
    expect(resolveQueryCacheTtl('L0')).toBe(QUERY_CACHE_TTL_L1_MS);
    expect(resolveQueryCacheTtl('L1')).toBe(QUERY_CACHE_TTL_L2_MS);
    expect(resolveQueryCacheTtl(undefined)).toBe(QUERY_CACHE_TTL_L2_MS);
  });

  it('serializes and deserializes cached responses with date restoration', () => {
    const response = makeResponse();
    const serialized = serializeCachedResponse(response);
    const deserialized = deserializeCachedResponse(serialized);

    expect(deserialized).not.toBeNull();
    expect(deserialized?.version.indexedAt).toBeInstanceOf(Date);
    expect(deserialized?.packs[0]?.createdAt).toBeInstanceOf(Date);
    expect(deserialized?.version.string).toBe(response.version.string);
    expect(deserialized?.packs[0]?.targetId).toBe('alpha');
    expect(deserialized?.coverageGaps).toEqual(['gap-a']);
  });

  it('returns null for invalid cached payloads', () => {
    expect(deserializeCachedResponse('not-json')).toBeNull();
    expect(deserializeCachedResponse('{}')).toBeNull();
  });
});
