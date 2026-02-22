import { describe, expect, it } from 'vitest';
import {
  WET_TESTING_DECISION_MATRIX_V1,
  WET_TESTING_REPRESENTATIVE_SCENARIOS_V1,
  evaluateWetTestingPolicyResearch,
} from '../wet_testing_policy_research.js';

describe('wet-testing policy research artifacts', () => {
  it('provides an explicit, versioned decision matrix', () => {
    expect(WET_TESTING_DECISION_MATRIX_V1.kind).toBe('WetTestingDecisionMatrix.v1');
    expect(WET_TESTING_DECISION_MATRIX_V1.schemaVersion).toBe(1);
    expect(WET_TESTING_DECISION_MATRIX_V1.thresholds.length).toBeGreaterThanOrEqual(4);
  });

  it('classifies at least ten representative scenarios with rationale', () => {
    expect(WET_TESTING_REPRESENTATIVE_SCENARIOS_V1.length).toBeGreaterThanOrEqual(10);
    for (const scenario of WET_TESTING_REPRESENTATIVE_SCENARIOS_V1) {
      expect(typeof scenario.rationale).toBe('string');
      expect(scenario.rationale.length).toBeGreaterThan(10);
      expect(scenario.expected.requiredEvidenceMode).toMatch(/^(wet|dry|mixed)$/);
    }
  });

  it('produces machine-readable evaluation output consumable by policy evaluator', () => {
    const artifact = evaluateWetTestingPolicyResearch();

    expect(artifact.kind).toBe('WetTestingPolicyResearchArtifact.v1');
    expect(artifact.schemaVersion).toBe(1);
    expect(artifact.scenarioCount).toBeGreaterThanOrEqual(10);
    expect(Array.isArray(artifact.results)).toBe(true);
    expect(artifact.results.length).toBe(artifact.scenarioCount);
    expect(artifact.modeMismatchCount).toBe(0);
    expect(artifact.failClosedMismatchCount).toBe(0);
  });
});
