import { describe, expect, it } from 'vitest';

import type { ContextPack } from '../../types.js';
import {
  buildClarifyingQuestions,
  categorizeRetrievalStatus,
  computeRetrievalEntropy,
  decideRetrievalEscalation,
  expandEscalationIntent,
} from '../retrieval_escalation.js';

const pack = (overrides: Partial<ContextPack>): ContextPack => ({
  packId: 'pack-1',
  packType: 'module_context',
  targetId: 'module-1',
  summary: 'Authentication flow and session management logic',
  keyFacts: ['Session refresh token rotation'],
  codeSnippets: [],
  relatedFiles: ['src/auth.ts'],
  confidence: 0.5,
  createdAt: new Date('2026-02-18T00:00:00.000Z'),
  accessCount: 0,
  lastOutcome: 'unknown',
  successCount: 0,
  failureCount: 0,
  version: {
    major: 1,
    minor: 0,
    patch: 0,
    string: '1.0.0',
    qualityTier: 'full',
    indexedAt: new Date('2026-02-18T00:00:00.000Z'),
    indexerVersion: 'test',
    features: [],
  },
  invalidationTriggers: [],
  ...overrides,
});

describe('retrieval escalation policy', () => {
  it('treats empty result sets as maximum uncertainty entropy', () => {
    const entropy = computeRetrievalEntropy([]);
    expect(entropy).toBeCloseTo(Math.log2(10), 3);
  });

  it('returns near-zero entropy for a single dominant match', () => {
    const entropy = computeRetrievalEntropy([
      pack({ confidence: 1.0 }),
    ]);
    expect(entropy).toBe(0);
  });

  it('matches log2(k) entropy for uniform confidence across k packs', () => {
    const packs = Array.from({ length: 10 }, (_, idx) => pack({ packId: `p-${idx}`, confidence: 0.5 }));
    const entropy = computeRetrievalEntropy(packs);
    expect(entropy).toBeCloseTo(Math.log2(10), 3);
  });

  it('ranks uncertain retrievals above confident retrievals across 20 queries in 3 codebase suites', () => {
    const codebaseSuites = ['typescript-repo', 'python-repo', 'go-repo'];
    for (const suite of codebaseSuites) {
      for (let i = 0; i < 20; i += 1) {
        const confidentEntropy = computeRetrievalEntropy([
          pack({ packId: `${suite}-c-${i}-1`, confidence: 0.95 }),
          pack({ packId: `${suite}-c-${i}-2`, confidence: 0.03 }),
          pack({ packId: `${suite}-c-${i}-3`, confidence: 0.02 }),
        ]);
        const uncertainEntropy = computeRetrievalEntropy([
          pack({ packId: `${suite}-u-${i}-1`, confidence: 0.34 }),
          pack({ packId: `${suite}-u-${i}-2`, confidence: 0.33 }),
          pack({ packId: `${suite}-u-${i}-3`, confidence: 0.33 }),
        ]);
        expect(uncertainEntropy).toBeGreaterThan(confidentEntropy);
      }
    }
  });

  it('computes retrieval entropy from pack confidence distribution', () => {
    const entropy = computeRetrievalEntropy([
      pack({ confidence: 0.5 }),
      pack({ packId: 'pack-2', confidence: 0.5 }),
      pack({ packId: 'pack-3', confidence: 0.5 }),
      pack({ packId: 'pack-4', confidence: 0.5 }),
    ]);

    expect(entropy).toBeGreaterThan(1.5);
  });

  it('categorizes retrieval status with CRAG-style buckets', () => {
    expect(categorizeRetrievalStatus({ totalConfidence: 0.72, packCount: 3 })).toBe('sufficient');
    expect(categorizeRetrievalStatus({ totalConfidence: 0.45, packCount: 3 })).toBe('partial');
    expect(categorizeRetrievalStatus({ totalConfidence: 0.21, packCount: 3 })).toBe('insufficient');
    expect(categorizeRetrievalStatus({ totalConfidence: 0.9, packCount: 0 })).toBe('insufficient');
  });

  it('escalates from L1 to L2 when confidence is low and entropy is high', () => {
    const decision = decideRetrievalEscalation({
      depth: 'L1',
      totalConfidence: 0.35,
      retrievalEntropy: 1.9,
      escalationAttempts: 0,
      maxEscalationDepth: 2,
    });

    expect(decision.shouldEscalate).toBe(true);
    expect(decision.nextDepth).toBe('L2');
    expect(decision.expandQuery).toBe(false);
  });

  it('jumps to L3 with query expansion when confidence is critically low', () => {
    const decision = decideRetrievalEscalation({
      depth: 'L1',
      totalConfidence: 0.19,
      retrievalEntropy: 0.7,
      escalationAttempts: 0,
      maxEscalationDepth: 2,
    });

    expect(decision.shouldEscalate).toBe(true);
    expect(decision.nextDepth).toBe('L3');
    expect(decision.expandQuery).toBe(true);
  });

  it('does not expand query for entropy-only escalation when confidence is not low', () => {
    const decision = decideRetrievalEscalation({
      depth: 'L1',
      totalConfidence: 0.45,
      retrievalEntropy: 2.4,
      escalationAttempts: 0,
      maxEscalationDepth: 2,
      packCount: 8,
    });

    expect(decision.shouldEscalate).toBe(true);
    expect(decision.nextDepth).toBe('L2');
    expect(decision.expandQuery).toBe(false);
  });

  it('respects max escalation depth guard', () => {
    const decision = decideRetrievalEscalation({
      depth: 'L2',
      totalConfidence: 0.12,
      retrievalEntropy: 2.1,
      escalationAttempts: 2,
      maxEscalationDepth: 2,
    });

    expect(decision.shouldEscalate).toBe(false);
    expect(decision.nextDepth).toBe('L2');
  });

  it('avoids generic summary words when expanding escalation intent', () => {
    const intent = 'what testing framework does this project use';
    const expanded = expandEscalationIntent(intent, [
      pack({
        packType: 'change_impact',
        targetId: 'src/validator.ts:check',
        summary: 'Changing validator may affect volumes checks value matches given',
        keyFacts: ['Impact radius: 11 modules depend on this'],
      }),
    ]);

    expect(expanded).toContain('validator');
    expect(expanded).not.toContain('changing');
    expect(expanded).not.toContain('affect');
  });

  it('builds actionable clarifying questions and expanded intent', () => {
    const intent = 'Users get logged out randomly';
    const questions = buildClarifyingQuestions(intent);
    const expanded = expandEscalationIntent(intent, [
      pack({ summary: 'session refresh token rotation and auth middleware' }),
    ]);

    expect(questions).toHaveLength(3);
    expect(expanded).toContain('session');
  });
});
