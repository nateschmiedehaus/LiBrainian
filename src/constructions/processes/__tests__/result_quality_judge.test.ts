import { describe, expect, it } from 'vitest';
import type { ConstructionOutcome } from '../../types.js';
import { ConstructionError } from '../../base/construction_base.js';
import {
  createResultQualityJudgeConstruction,
  deriveResultQualityThresholds,
} from '../result_quality_judge.js';

function expectOkValue<T>(outcome: ConstructionOutcome<T, ConstructionError>): T {
  expect(outcome.ok).toBe(true);
  if (!outcome.ok) {
    throw outcome.error;
  }
  return outcome.value;
}

describe('ResultQualityJudge', () => {
  it('scores strong results as passing across all dimensions', async () => {
    const judge = createResultQualityJudgeConstruction();
    const result = expectOkValue(await judge.execute({
      query: 'session storage for authentication tokens',
      expectedFiles: ['src/auth/sessionStore.ts'],
      topFiles: ['src/auth/sessionStore.ts', 'src/auth/tokenValidator.ts'],
      confidenceValues: [0.81, 0.74],
      evidenceSnippets: ['createSession(userId)', 'validateToken(token)'],
    }));

    expect(result.kind).toBe('ResultQualityJudgment.v1');
    expect(result.pass).toBe(true);
    expect(result.findings).toHaveLength(0);
    expect(result.scores.relevance).toBeGreaterThanOrEqual(result.thresholds.relevance);
    expect(result.scores.completeness).toBeGreaterThanOrEqual(result.thresholds.completeness);
    expect(result.scores.actionability).toBeGreaterThanOrEqual(result.thresholds.actionability);
    expect(result.scores.accuracy).toBeGreaterThanOrEqual(result.thresholds.accuracy);
  });

  it('flags weak or polluted results as failing', async () => {
    const judge = createResultQualityJudgeConstruction();
    const result = expectOkValue(await judge.execute({
      query: 'loan policy and borrowing limits',
      expectedFiles: ['src/policy/loanPolicy.ts'],
      topFiles: ['.librarian/cache/context.json'],
      confidenceValues: [1.5],
      evidenceSnippets: [],
    }));

    expect(result.pass).toBe(false);
    expect(result.findings.length).toBeGreaterThan(0);
    const hasThresholdBreach =
      result.scores.relevance < result.thresholds.relevance ||
      result.scores.completeness < result.thresholds.completeness ||
      result.scores.actionability < result.thresholds.actionability ||
      result.scores.accuracy < result.thresholds.accuracy;
    expect(hasThresholdBreach).toBe(true);
  });

  it('derives calibrated thresholds from baseline seed values', () => {
    const thresholds = deriveResultQualityThresholds({
      relevanceFloor: 0.5,
      completenessFloor: 0.7,
      actionabilityFloor: 0.8,
      accuracyFloor: 0.9,
      unitPatrolPassRateFloor: 0.6,
    });

    expect(thresholds.relevance).toBe(0.5);
    expect(thresholds.completeness).toBe(0.6);
    expect(thresholds.actionability).toBe(0.7);
    expect(thresholds.accuracy).toBe(0.75);
  });
});
