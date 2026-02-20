import { describe, expect, it } from 'vitest';
import type { ContextPack, LibrarianQuery, LibrarianVersion } from '../../types.js';
import {
  ImpactResponseSchema,
  QueryResultContractSchema,
  UnderstandResponseSchema,
  buildQueryResultContract,
  normalizeQueryIntentType,
  resolveQueryIntentType,
} from '../query_contracts.js';

const baseVersion: LibrarianVersion = {
  major: 1,
  minor: 0,
  patch: 0,
  string: '1.0.0',
  qualityTier: 'mvp',
  indexedAt: new Date('2026-01-01T00:00:00.000Z'),
  indexerVersion: 'test',
  features: [],
};

const basePack: ContextPack = {
  packId: 'pack-auth',
  packType: 'module_context',
  targetId: 'auth-module',
  summary: 'Handles token refresh and session validation.',
  keyFacts: ['Refresh tokens are rotated', 'Expired sessions are rejected'],
  codeSnippets: [],
  relatedFiles: ['src/auth/session.ts', 'src/auth/tokens.ts'],
  confidence: 0.88,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  accessCount: 0,
  lastOutcome: 'unknown',
  successCount: 0,
  failureCount: 0,
  version: baseVersion,
  invalidationTriggers: [],
};

describe('query contracts', () => {
  it('resolves explicit intentType over taskType inference', () => {
    const query: LibrarianQuery = {
      intent: 'show impact',
      intentType: 'understand',
      taskType: 'impact_analysis',
      depth: 'L1',
    };
    expect(resolveQueryIntentType(query)).toBe('understand');
  });

  it('normalizes intentType and infers taskType when missing', () => {
    const query: LibrarianQuery = {
      intent: 'what would this change impact?',
      intentType: 'impact',
      depth: 'L1',
    };
    const normalized = normalizeQueryIntentType(query);
    expect(normalized.intentType).toBe('impact');
    expect(normalized.taskType).toBe('impact_analysis');
  });

  it('builds a typed understand contract', () => {
    const contract = buildQueryResultContract({
      query: {
        intent: 'How does auth work?',
        intentType: 'understand',
        depth: 'L1',
      },
      packs: [basePack],
      synthesis: {
        answer: 'Authentication uses session validation and refresh token rotation.',
        confidence: 0.9,
        citations: [],
        keyInsights: ['Session validation', 'Refresh rotation'],
        uncertainties: [],
      },
      totalConfidence: 0.9,
      version: baseVersion,
      disclosures: [],
    });

    const parsed = QueryResultContractSchema.safeParse(contract);
    expect(parsed.success).toBe(true);
    expect(contract?.intentType).toBe('understand');
    if (contract?.intentType === 'understand') {
      expect(UnderstandResponseSchema.safeParse(contract).success).toBe(true);
      expect(contract.relevantFiles.length).toBeGreaterThan(0);
      expect(contract.summary).toContain('Authentication');
    }
  });

  it('builds a typed impact contract with risk factors', () => {
    const contract = buildQueryResultContract({
      query: {
        intent: 'What breaks if we change session refresh?',
        intentType: 'impact',
        depth: 'L1',
      },
      packs: [basePack],
      totalConfidence: 0.62,
      version: baseVersion,
      disclosures: ['critical: dependency graph degraded'],
    });

    const parsed = QueryResultContractSchema.safeParse(contract);
    expect(parsed.success).toBe(true);
    expect(contract?.intentType).toBe('impact');
    if (contract?.intentType === 'impact') {
      expect(ImpactResponseSchema.safeParse(contract).success).toBe(true);
      expect(contract.directImpact.length).toBeGreaterThan(0);
      expect(contract.riskFactors.length).toBeGreaterThan(0);
      expect(contract.safeToChange).toBe(false);
    }
  });
});
