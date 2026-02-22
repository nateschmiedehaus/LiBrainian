import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WET_TESTING_POLICY_CONFIG,
  createWetTestingPolicyDecisionArtifact,
  evaluateWetTestingPolicy,
  parseWetTestingPolicyConfig,
} from '../wet_testing_policy.js';

describe('wet-testing policy', () => {
  it('rejects malformed policy schema', () => {
    expect(() => parseWetTestingPolicyConfig({
      kind: 'WetTestingPolicyConfig.v1',
      schemaVersion: 2,
      rules: [],
    })).toThrow(/invalid_wet_testing_policy_config/);
  });

  it('returns deterministic decisions regardless of rule declaration order', () => {
    const context = {
      riskLevel: 'critical',
      blastRadius: 'repo',
      novelty: 'novel',
      providerDependence: 'mixed',
      trigger: 'release',
      executionSurface: 'publish',
      userImpact: 'blocker',
      releaseCritical: true,
      requiresExternalRepo: true,
    } as const;

    const orderedDecision = evaluateWetTestingPolicy(DEFAULT_WET_TESTING_POLICY_CONFIG, context);
    const reversedPolicy = {
      ...DEFAULT_WET_TESTING_POLICY_CONFIG,
      rules: [...DEFAULT_WET_TESTING_POLICY_CONFIG.rules].reverse(),
    };
    const reversedDecision = evaluateWetTestingPolicy(reversedPolicy, context);

    expect(orderedDecision.matchedRuleId).toBe('critical-release-wet');
    expect(reversedDecision.matchedRuleId).toBe('critical-release-wet');
    expect(reversedDecision.requiredEvidenceMode).toBe(orderedDecision.requiredEvidenceMode);
    expect(reversedDecision.reason).toBe(orderedDecision.reason);
    expect(reversedDecision.contextKey).toBe(orderedDecision.contextKey);
  });

  it('emits machine-readable decision artifacts', () => {
    const decision = evaluateWetTestingPolicy(
      DEFAULT_WET_TESTING_POLICY_CONFIG,
      {
        riskLevel: 'high',
        blastRadius: 'cross_module',
        novelty: 'modified',
        providerDependence: 'llm',
        trigger: 'ci',
        executionSurface: 'patrol',
        userImpact: 'high',
        releaseCritical: true,
        requiresExternalRepo: false,
      },
    );
    const artifact = createWetTestingPolicyDecisionArtifact(
      decision,
      DEFAULT_WET_TESTING_POLICY_CONFIG,
      '2026-02-22T00:00:00.000Z',
    );
    const serialized = JSON.stringify(artifact);
    const parsed = JSON.parse(serialized) as {
      kind?: string;
      schemaVersion?: number;
      decision?: { requiredEvidenceMode?: string; failClosed?: boolean };
      policyDigest?: string;
    };

    expect(parsed.kind).toBe('WetTestingPolicyDecisionArtifact.v1');
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.decision?.requiredEvidenceMode).toBe('wet');
    expect(parsed.decision?.failClosed).toBe(true);
    expect(typeof parsed.policyDigest).toBe('string');
    expect(parsed.policyDigest?.length).toBe(64);
  });
});
