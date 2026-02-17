import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COMPOSITION_UTILITY_SCENARIOS,
  evaluateCompositionUtility,
} from '../evaluation/composition_utility.js';

describe('composition utility evaluation', () => {
  it('passes default scenario suite at high coverage', () => {
    const report = evaluateCompositionUtility(DEFAULT_COMPOSITION_UTILITY_SCENARIOS);

    expect(report.totalScenarios).toBeGreaterThanOrEqual(8);
    expect(report.passRate).toBeGreaterThanOrEqual(0.9);
    expect(report.top3Recall).toBeGreaterThanOrEqual(0.9);
    expect(report.top1Accuracy).toBeGreaterThanOrEqual(0.5);
    expect(report.failures).toEqual([]);
    expect(report.scenarioResults).toHaveLength(report.totalScenarios);
  });

  it('fails when scenario expectation is not matched', () => {
    const report = evaluateCompositionUtility([
      {
        id: 'scenario-negative',
        intent: 'friendly team update',
        expectedCompositionId: 'tc_release_readiness',
      },
    ]);

    expect(report.passRate).toBe(0);
    expect(report.top3Recall).toBe(0);
    expect(report.top1Accuracy).toBe(0);
    expect(report.failures[0]?.rank).toBeNull();
    expect(report.failures[0]?.reason).toContain('expected composition missing');
  });
});
