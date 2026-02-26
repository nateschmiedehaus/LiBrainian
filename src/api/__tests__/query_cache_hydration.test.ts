import { describe, expect, it } from 'vitest';
import type {
  ConstructionPlan,
  ContextPack,
  LibrarianQuery,
  LibrarianVersion,
} from '../../types.js';
import type { CachedResponse } from '../query_cache_response_utils.js';
import {
  applyCachedRetrievalDefaults,
  hydrateCachedQueryResponse,
} from '../query_cache_hydration.js';

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

const TEST_PLAN: ConstructionPlan = {
  id: 'cp_test',
  templateId: 'T1',
  ucIds: [],
  intent: 'cache hydration',
  source: 'default',
  createdAt: '2026-02-01T00:00:00.000Z',
};

const makePack = (id: string, confidence = 0.2): ContextPack => ({
  packId: `pack:${id}`,
  packType: 'module_context',
  targetId: id,
  summary: `Summary for ${id}`,
  keyFacts: ['fact'],
  codeSnippets: [],
  relatedFiles: [`src/${id}.ts`],
  confidence,
  createdAt: new Date('2026-02-01T01:00:00.000Z'),
  accessCount: 0,
  lastOutcome: 'unknown',
  successCount: 0,
  failureCount: 0,
  version: TEST_VERSION,
  invalidationTriggers: [],
});

const makeQuery = (overrides: Partial<LibrarianQuery> = {}): LibrarianQuery => ({
  intent: 'why did this fail?',
  depth: 'L3',
  ...overrides,
});

const makeResponse = (overrides: Partial<CachedResponse> = {}): CachedResponse => ({
  query: makeQuery({ depth: 'L1' }),
  packs: [makePack('alpha', 0.2), makePack('beta', 0.25)],
  disclosures: [],
  traceId: 'trace:test',
  totalConfidence: 0.2,
  cacheHit: false,
  latencyMs: 42,
  version: TEST_VERSION,
  drillDownHints: [],
  ...overrides,
});

describe('query_cache_hydration', () => {
  it('hydrates cache responses with retrieval defaults and cache metadata', () => {
    const hydrated = hydrateCachedQueryResponse({
      baseResponse: makeResponse(),
      query: makeQuery(),
      latencyMs: 123,
      version: TEST_VERSION,
      traceId: 'trace:cache',
      disclosures: ['cache'],
      constructionPlan: TEST_PLAN,
    });

    expect(hydrated.cacheHit).toBe(true);
    expect(hydrated.synthesisMode).toBe('cache');
    expect(hydrated.latencyMs).toBe(123);
    expect(hydrated.traceId).toBe('trace:cache');
    expect(hydrated.disclosures).toEqual(['cache']);
    expect(hydrated.retrievalEntropy).toBeGreaterThan(0);
    expect(hydrated.retrievalStatus).toBe('insufficient');
    expect(hydrated.retrievalInsufficient).toBe(true);
    expect(hydrated.suggestedClarifyingQuestions?.length).toBe(3);
  });

  it('preserves existing retrieval metadata and clarifying questions', () => {
    const response = makeResponse({
      retrievalEntropy: 0.1,
      retrievalStatus: 'partial',
      retrievalInsufficient: true,
      suggestedClarifyingQuestions: ['existing question'],
    });

    applyCachedRetrievalDefaults(response, makeQuery({ depth: 'L2' }));

    expect(response.retrievalEntropy).toBe(0.1);
    expect(response.retrievalStatus).toBe('partial');
    expect(response.suggestedClarifyingQuestions).toEqual(['existing question']);
  });

  it('suppresses llmError when showLlmErrors is disabled', () => {
    const hydrated = hydrateCachedQueryResponse({
      baseResponse: makeResponse({ llmError: 'provider failed' }),
      query: makeQuery({ showLlmErrors: false }),
      latencyMs: 5,
      version: TEST_VERSION,
      traceId: 'trace:llm',
      disclosures: [],
      constructionPlan: TEST_PLAN,
    });

    expect(hydrated.llmError).toBeUndefined();
  });
});
