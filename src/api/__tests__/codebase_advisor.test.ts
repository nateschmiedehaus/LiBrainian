import { describe, it, expect, vi } from 'vitest';
import type { ContextPack, LiBrainianResponse, LlmOptional } from '../../types.js';
import { getCurrentVersion } from '../versioning.js';
import { CodebaseCompositionAdvisor, __testing } from '../codebase_advisor.js';
import { logWarning } from '../../telemetry/logger.js';

const logWarningMock = vi.hoisted(() => vi.fn());

vi.mock('../../telemetry/logger.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../telemetry/logger.js')>();
  return {
    ...actual,
    logWarning: logWarningMock,
  };
});

function makePack(id: string, confidence = 0.8, files = ['src/example.ts']): ContextPack {
  return {
    packId: `pack_${id}`,
    packType: 'module_context',
    targetId: id,
    summary: 'summary',
    keyFacts: [],
    codeSnippets: [],
    relatedFiles: files,
    confidence,
    createdAt: new Date('2025-01-01T00:00:00Z'),
    accessCount: 0,
    lastOutcome: 'unknown',
    successCount: 0,
    failureCount: 0,
    version: getCurrentVersion(),
    invalidationTriggers: [],
  };
}

function buildResponse(intent: string, packs: ContextPack[]): LlmOptional<LiBrainianResponse> {
  return {
    query: { intent, depth: 'L1', llmRequirement: 'optional' },
    packs,
    disclosures: [],
    traceId: 'unverified_by_trace(replay_unavailable)',
    constructionPlan: {
      id: 'cp_advisor',
      templateId: 'T1',
      ucIds: [],
      intent,
      source: 'default',
      createdAt: new Date().toISOString(),
    },
    totalConfidence: packs.reduce((sum, pack) => sum + pack.confidence, 0),
    cacheHit: false,
    latencyMs: 1,
    version: getCurrentVersion(),
    drillDownHints: [],
    llmRequirement: 'optional',
    llmAvailable: true,
  };
}

describe('CodebaseCompositionAdvisor', () => {
  it('returns suggestions for detected auth features', async () => {
    const authPack = makePack('auth_feature', 0.9, ['src/auth.ts']);
    const queryOptional = vi.fn(async (query) => {
      if (query.intent.includes('authentication')) {
        return buildResponse(query.intent, [authPack]);
      }
      return buildResponse(query.intent, []);
    });
    const advisor = new CodebaseCompositionAdvisor({ queryOptional }, { maxSuggestions: 10 });

    const suggestions = await advisor.suggestCompositions();

    const ids = suggestions.map((suggestion) => suggestion.suggestedCompositionId);
    expect(ids).toContain('tc_auth_security_review');
  });

  it('deduplicates shared performance suggestions', async () => {
    const perfPack = makePack('perf_feature', 0.85, ['src/perf.ts']);
    const queryOptional = vi.fn(async (query) => {
      if (query.intent.includes('performance optimization') || query.intent.includes('async')) {
        return buildResponse(query.intent, [perfPack]);
      }
      return buildResponse(query.intent, []);
    });
    const advisor = new CodebaseCompositionAdvisor({ queryOptional }, { maxSuggestions: 10 });

    const suggestions = await advisor.suggestCompositions();
    const perfSuggestions = suggestions.filter(
      (suggestion) => suggestion.suggestedCompositionId === 'tc_performance_regression'
    );

    expect(perfSuggestions).toHaveLength(1);
  });

  it('keeps results from successful queries when some fail', async () => {
    const apiPack = makePack('api_feature', 0.9, ['src/api.ts']);
    const queryOptional = vi.fn(async (query) => {
      if (query.intent.includes('authentication')) {
        throw new Error('auth query failed');
      }
      if (query.intent.includes('API endpoints')) {
        return buildResponse(query.intent, [apiPack]);
      }
      return buildResponse(query.intent, []);
    });
    const advisor = new CodebaseCompositionAdvisor({ queryOptional }, { maxSuggestions: 10 });

    const suggestions = await advisor.suggestCompositions();

    expect(suggestions.some((s) => s.suggestedCompositionId === 'tc_api_change_review')).toBe(true);
    expect(vi.mocked(logWarning).mock.calls.length).toBeGreaterThan(0);
  });

  it('logs failures and returns empty suggestions when queries fail', async () => {
    const queryOptional = vi.fn(async () => {
      throw new Error('network down');
    });
    const advisor = new CodebaseCompositionAdvisor({ queryOptional });

    const suggestions = await advisor.suggestCompositions();

    expect(suggestions).toEqual([]);
    expect(vi.mocked(logWarning).mock.calls.length).toBeGreaterThan(0);
  });

  it('keeps higher priority suggestions when deduplicating', () => {
    const queryOptional = vi.fn(async (query) => buildResponse(query.intent, []));
    const advisor = new CodebaseCompositionAdvisor({ queryOptional });
    const prioritize = (advisor as unknown as {
      prioritizeSuggestions: (input: Array<{
        suggestedCompositionId: string;
        suggestedName: string;
        reason: string;
        basedOnFeatures: string[];
        suggestedPrimitives: string[];
        suggestedOperators: [];
        priority: 'high' | 'medium' | 'low';
        estimatedValue: string;
      }>) => Array<{ priority: 'high' | 'medium' | 'low' }>;
    }).prioritizeSuggestions;

    const prioritized = prioritize([
      {
        suggestedCompositionId: 'dup',
        suggestedName: 'dup',
        reason: 'low',
        basedOnFeatures: ['feature_a'],
        suggestedPrimitives: [],
        suggestedOperators: [],
        priority: 'low',
        estimatedValue: 'low',
      },
      {
        suggestedCompositionId: 'dup',
        suggestedName: 'dup',
        reason: 'high',
        basedOnFeatures: ['feature_b'],
        suggestedPrimitives: [],
        suggestedOperators: [],
        priority: 'high',
        estimatedValue: 'high',
      },
    ]);

    expect(prioritized[0]?.priority).toBe('high');
  });

  it('sanitizes descriptions and clamps length', () => {
    const input = `hello\u0000world\t\n`;
    const sanitized = __testing.sanitizeDescription(input);
    expect(sanitized).toBe('hello world');

    const long = 'a'.repeat(600);
    const clamped = __testing.sanitizeDescription(long);
    expect(clamped.length).toBe(500);
  });

  it('rejects invalid option ranges', () => {
    const queryOptional = vi.fn(async (query) => buildResponse(query.intent, []));
    expect(() => new CodebaseCompositionAdvisor({ queryOptional }, { minConfidence: 2 }))
      .toThrow('minConfidence');
    expect(() => new CodebaseCompositionAdvisor({ queryOptional }, { maxSuggestions: -1 }))
      .toThrow('maxSuggestions');
  });
});
