import { describe, it, expect, vi } from 'vitest';
import type { ContextPack, LibrarianQuery, LibrarianVersion } from '../../types.js';
import {
  applyMmrDiversification,
  buildTfVector,
  clampMmrLambda,
  cosineSimilarity,
  tokenizeForMmr,
} from '../query_mmr_utils.js';

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

const makePack = (id: string, summary: string, keyFacts: string[] = [], relatedFiles: string[] = []): ContextPack => ({
  packId: `pack:${id}`,
  packType: 'module_context',
  targetId: id,
  summary,
  keyFacts,
  codeSnippets: [],
  relatedFiles,
  confidence: 0.5,
  createdAt: new Date('2026-02-01T00:00:00.000Z'),
  accessCount: 0,
  lastOutcome: 'unknown',
  successCount: 0,
  failureCount: 0,
  version: TEST_VERSION,
  invalidationTriggers: [],
});

const makeQuery = (overrides: Partial<LibrarianQuery> = {}): LibrarianQuery => ({
  intent: 'find auth implementation details',
  depth: 'L2',
  ...overrides,
});

describe('query_mmr_utils', () => {
  it('tokenizeForMmr normalizes and merges all pack text fields', () => {
    const tokens = tokenizeForMmr(
      makePack(
        'session_manager',
        'Auth API summary',
        ['JWT rotation', 'x'],
        ['src/auth/session.ts']
      )
    );

    expect(tokens).toContain('session_manager');
    expect(tokens).toContain('auth');
    expect(tokens).toContain('api');
    expect(tokens).toContain('jwt');
    expect(tokens).toContain('src');
    expect(tokens).not.toContain('x');
  });

  it('buildTfVector counts token frequencies', () => {
    const vector = buildTfVector(['auth', 'auth', 'session']);
    expect(vector.get('auth')).toBe(2);
    expect(vector.get('session')).toBe(1);
  });

  it('cosineSimilarity handles empty vectors and overlap', () => {
    expect(cosineSimilarity(new Map(), new Map())).toBe(0);
    const left = buildTfVector(['a', 'b', 'b']);
    const right = buildTfVector(['a', 'b']);
    const disjoint = buildTfVector(['x', 'y']);
    expect(cosineSimilarity(left, right)).toBeGreaterThan(0);
    expect(cosineSimilarity(left, disjoint)).toBe(0);
  });

  it('clampMmrLambda clamps and defaults invalid values', () => {
    expect(clampMmrLambda(undefined)).toBe(0.5);
    expect(clampMmrLambda(Number.NaN)).toBe(0.5);
    expect(clampMmrLambda(-0.1)).toBe(0);
    expect(clampMmrLambda(1.2)).toBe(1);
    expect(clampMmrLambda(0.25)).toBe(0.25);
  });

  it('applyMmrDiversification returns unchanged packs when disabled', () => {
    const packs = [makePack('a', 'auth token'), makePack('b', 'session refresh')];
    const result = applyMmrDiversification({
      packs,
      query: makeQuery({ diversify: false }),
      candidateScoreMap: new Map(),
      explanationParts: [],
      recordCoverageGap: vi.fn(),
    });
    expect(result).toEqual(packs);
  });

  it('applyMmrDiversification records a gap when relevance is zero everywhere', () => {
    const recordCoverageGap = vi.fn();
    const packs = [
      { ...makePack('a', 'auth token'), confidence: 0 },
      { ...makePack('b', 'session refresh'), confidence: 0 },
    ];
    const result = applyMmrDiversification({
      packs,
      query: makeQuery({ diversify: true, diversityLambda: 0.5 }),
      candidateScoreMap: new Map([
        ['a', 0],
        ['b', 0],
      ]),
      explanationParts: [],
      recordCoverageGap,
    });
    expect(result).toEqual(packs);
    expect(recordCoverageGap).toHaveBeenCalledTimes(1);
    expect(recordCoverageGap.mock.calls[0]?.[1]).toContain('zero relevance');
  });

  it('applyMmrDiversification prefers diversity after selecting top relevance', () => {
    const authPrimary = makePack(
      'auth_primary',
      'auth session token refresh',
      ['token rotation', 'session refresh'],
      ['src/auth/session.ts']
    );
    const authSecondary = makePack(
      'auth_secondary',
      'auth session token invalidation',
      ['token lifecycle', 'session timeout'],
      ['src/auth/token.ts']
    );
    const paymentDistinct = makePack(
      'payment_distinct',
      'invoice billing reconciliation flow',
      ['invoice audit trail'],
      ['src/billing/invoice.ts']
    );

    const explanationParts: string[] = [];
    const result = applyMmrDiversification({
      packs: [authPrimary, authSecondary, paymentDistinct],
      query: makeQuery({ diversify: true, diversityLambda: 0.4 }),
      candidateScoreMap: new Map([
        ['auth_primary', 0.95],
        ['auth_secondary', 0.9],
        ['payment_distinct', 0.85],
      ]),
      explanationParts,
      recordCoverageGap: vi.fn(),
    });

    expect(result.map((pack) => pack.targetId)).toEqual([
      'auth_primary',
      'payment_distinct',
      'auth_secondary',
    ]);
    expect(explanationParts.some((part) => part.includes('Applied MMR diversification'))).toBe(true);
  });
});
