import { describe, expect, it, vi } from 'vitest';
import type { ContextPack } from '../types.js';
import {
  DeepEvalSplitMetrics,
  diagnoseSplitFailure,
  evaluateDagMetric,
  type LibrarianEvalCase,
} from '../evaluation/deepeval_split_metrics.js';

function buildPack(packId: string, summary: string, keyFacts: string[]): ContextPack {
  return {
    packId,
    packType: 'function_context',
    targetId: `target:${packId}`,
    summary,
    keyFacts,
    codeSnippets: [],
    relatedFiles: [],
    confidence: 0.8,
    createdAt: new Date('2026-02-20T00:00:00.000Z'),
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
      indexedAt: new Date('2026-02-20T00:00:00.000Z'),
      indexerVersion: 'test',
      features: [],
    },
    invalidationTriggers: [],
  };
}

describe('DeepEvalSplitMetrics', () => {
  it('splits ground truth and retrieval context for faithfulness diagnostics', () => {
    const metrics = new DeepEvalSplitMetrics();
    const evalCase: LibrarianEvalCase = {
      query: 'How does auth session creation work?',
      groundTruthFacts: [
        'authenticateUser validates password credentials',
        'createSession persists refresh token',
      ],
      retrievalContext: [
        buildPack(
          'auth-1',
          'Authentication checks password and returns a user id.',
          [
            'authenticateUser validates password credentials',
            'createSession persists refresh token',
            'deleteAllSessions removes every account session globally',
          ],
        ),
      ],
      expectedTools: ['query'],
    };

    const result = metrics.evaluateFaithfulnessSplit(evalCase);
    expect(result.totalClaims).toBeGreaterThan(0);
    expect(result.score).toBeLessThan(1);
    expect(result.unsupportedClaims.some((claim) => claim.includes('deleteAllSessions'))).toBe(true);
  });

  it('diagnoses retrieval failures across three constructed scenarios', () => {
    const scenarioA = diagnoseSplitFailure({
      faithfulness: 0.2,
      answerRelevancy: 0.8,
      retrievalCoverage: 0.1,
    });
    const scenarioB = diagnoseSplitFailure({
      faithfulness: 0.45,
      answerRelevancy: 0.65,
      retrievalCoverage: 0.3,
    });
    const scenarioC = diagnoseSplitFailure({
      faithfulness: 0.3,
      answerRelevancy: 0.3,
      retrievalCoverage: 0.25,
    });

    expect(scenarioA.failureMode).toBe('retrieval_failure');
    expect(scenarioB.failureMode).toBe('retrieval_failure');
    expect(scenarioC.failureMode).toBe('mixed_failure');
  });

  it('reports evaluation_cost and keeps single-run cost under $0.50', () => {
    const metrics = new DeepEvalSplitMetrics();
    const result = metrics.evaluateCase({
      query: 'Explain token refresh flow',
      groundTruthFacts: ['refreshToken rotates signing key', 'session table stores expiry'],
      retrievalContext: [
        buildPack('refresh-1', 'Token refresh path updates session state', [
          'refreshToken rotates signing key',
          'session table stores expiry',
        ]),
      ],
      expectedTools: ['query', 'verify_claim'],
    });

    expect(result.evaluationCost.estimatedInputTokens).toBeGreaterThan(0);
    expect(result.evaluationCost.estimatedOutputTokens).toBeGreaterThan(0);
    expect(result.evaluationCost.estimatedCostUsd).toBeLessThan(0.5);
  });

  it('evaluates DAG metrics conditionally (step B only if step A passes)', async () => {
    const stepB = vi.fn(async () => ({ passed: true, score: 1 }));
    const report = await evaluateDagMetric([
      {
        id: 'step_a',
        evaluate: async () => ({ passed: false, score: 0, reason: 'precondition_failed' }),
      },
      {
        id: 'step_b',
        dependsOn: ['step_a'],
        evaluate: stepB,
      },
    ]);

    expect(stepB).not.toHaveBeenCalled();
    expect(report.passed).toBe(false);
    expect(report.steps.find((step) => step.stepId === 'step_b')?.status).toBe('skipped_dependency');
  });
});
