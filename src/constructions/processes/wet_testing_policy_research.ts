import {
  DEFAULT_WET_TESTING_POLICY_CONFIG,
  evaluateWetTestingPolicy,
  type WetTestingEvidenceMode,
  type WetTestingPolicyConfig,
  type WetTestingPolicyContext,
} from './wet_testing_policy.js';

export interface WetTestingDecisionMatrixV1 {
  kind: 'WetTestingDecisionMatrix.v1';
  schemaVersion: 1;
  dimensions: {
    riskLevel: string;
    blastRadius: string;
    novelty: string;
    providerDependence: string;
    releaseCritical: string;
    trigger: string;
    executionSurface: string;
    userImpact: string;
    requiresExternalRepo: string;
  };
  thresholds: Array<{
    id: string;
    summary: string;
    expectedEvidenceMode: WetTestingEvidenceMode;
    failClosed: boolean;
  }>;
}

export interface WetTestingRepresentativeScenarioV1 {
  id: string;
  title: string;
  rationale: string;
  context: WetTestingPolicyContext;
  expected: {
    requiredEvidenceMode: WetTestingEvidenceMode;
    failClosed: boolean;
  };
}

export interface WetTestingPolicyResearchScenarioResult {
  id: string;
  expectedEvidenceMode: WetTestingEvidenceMode;
  actualEvidenceMode: WetTestingEvidenceMode;
  expectedFailClosed: boolean;
  actualFailClosed: boolean;
  evidenceModeMatch: boolean;
  failClosedMatch: boolean;
  riskOfOverEnforcement: boolean;
  riskOfUnderEnforcement: boolean;
}

export interface WetTestingPolicyResearchArtifactV1 {
  kind: 'WetTestingPolicyResearchArtifact.v1';
  schemaVersion: 1;
  scenarioCount: number;
  modeMismatchCount: number;
  failClosedMismatchCount: number;
  overEnforcementRiskCount: number;
  underEnforcementRiskCount: number;
  results: WetTestingPolicyResearchScenarioResult[];
}

const evidenceModeRank: Record<WetTestingEvidenceMode, number> = {
  dry: 0,
  mixed: 1,
  wet: 2,
};

export const WET_TESTING_DECISION_MATRIX_V1: WetTestingDecisionMatrixV1 = {
  kind: 'WetTestingDecisionMatrix.v1',
  schemaVersion: 1,
  dimensions: {
    riskLevel: 'Escalates evidence requirement from low->critical.',
    blastRadius: 'Broader blast radius biases toward mixed/wet.',
    novelty: 'Novel behavior increases evidence burden.',
    providerDependence: 'LLM/mixed dependence requires stronger proof.',
    releaseCritical: 'Release-critical paths must fail closed.',
    trigger: 'CI/release triggers are stricter than manual.',
    executionSurface: 'Patrol/dogfood/publish surfaces require operational proof.',
    userImpact: 'High/blocker impact raises required confidence.',
    requiresExternalRepo: 'External-repo workflows require durable proof artifacts.',
  },
  thresholds: [
    {
      id: 'critical-release-wet',
      summary: 'High+ risk + release-critical + CI/release trigger => wet + fail-closed.',
      expectedEvidenceMode: 'wet',
      failClosed: true,
    },
    {
      id: 'high-impact-patrol-mixed',
      summary: 'High-impact patrol/dogfood/publish paths => mixed + fail-closed.',
      expectedEvidenceMode: 'mixed',
      failClosed: true,
    },
    {
      id: 'provider-dependent-mixed',
      summary: 'Provider-dependent medium+ risk paths => mixed + fail-closed.',
      expectedEvidenceMode: 'mixed',
      failClosed: true,
    },
    {
      id: 'default-dry',
      summary: 'All other contexts default to dry, not fail-closed.',
      expectedEvidenceMode: 'dry',
      failClosed: false,
    },
  ],
};

export const WET_TESTING_REPRESENTATIVE_SCENARIOS_V1: WetTestingRepresentativeScenarioV1[] = [
  {
    id: 'scenario-01-release-critical-ci',
    title: 'Release CI on critical risk path',
    rationale: 'Ship-blocking release path must require wet evidence.',
    context: {
      riskLevel: 'critical',
      blastRadius: 'repo',
      novelty: 'novel',
      providerDependence: 'mixed',
      trigger: 'release',
      executionSurface: 'publish',
      userImpact: 'blocker',
      releaseCritical: true,
      requiresExternalRepo: true,
    },
    expected: { requiredEvidenceMode: 'wet', failClosed: true },
  },
  {
    id: 'scenario-02-full-scheduled-patrol',
    title: 'Scheduled full patrol on external repos',
    rationale: 'High-impact scheduled patrol should require mixed evidence.',
    context: {
      riskLevel: 'high',
      blastRadius: 'cross_module',
      novelty: 'modified',
      providerDependence: 'mixed',
      trigger: 'schedule',
      executionSurface: 'patrol',
      userImpact: 'high',
      releaseCritical: false,
      requiresExternalRepo: true,
    },
    expected: { requiredEvidenceMode: 'mixed', failClosed: true },
  },
  {
    id: 'scenario-03-quick-manual-low-risk',
    title: 'Manual quick patrol for low-risk triage',
    rationale: 'Low-risk manual checks can remain dry to reduce cost.',
    context: {
      riskLevel: 'low',
      blastRadius: 'module',
      novelty: 'known',
      providerDependence: 'embeddings',
      trigger: 'manual',
      executionSurface: 'patrol',
      userImpact: 'medium',
      releaseCritical: false,
      requiresExternalRepo: true,
    },
    expected: { requiredEvidenceMode: 'dry', failClosed: false },
  },
  {
    id: 'scenario-04-provider-dependent-medium',
    title: 'Provider-dependent medium-risk integration check',
    rationale: 'Provider dependence at medium risk should move to mixed.',
    context: {
      riskLevel: 'medium',
      blastRadius: 'module',
      novelty: 'modified',
      providerDependence: 'llm',
      trigger: 'ci',
      executionSurface: 'integration',
      userImpact: 'medium',
      releaseCritical: false,
      requiresExternalRepo: false,
    },
    expected: { requiredEvidenceMode: 'mixed', failClosed: true },
  },
  {
    id: 'scenario-05-manual-release-critical',
    title: 'Manual release-critical validation',
    rationale: 'Release-critical should still require wet even if manually invoked.',
    context: {
      riskLevel: 'high',
      blastRadius: 'repo',
      novelty: 'modified',
      providerDependence: 'mixed',
      trigger: 'release',
      executionSurface: 'publish',
      userImpact: 'blocker',
      releaseCritical: true,
      requiresExternalRepo: true,
    },
    expected: { requiredEvidenceMode: 'wet', failClosed: true },
  },
  {
    id: 'scenario-06-high-user-impact-dogfood',
    title: 'Dogfood run with high user impact',
    rationale: 'High impact on dogfood surface needs mixed operational proof.',
    context: {
      riskLevel: 'high',
      blastRadius: 'cross_module',
      novelty: 'novel',
      providerDependence: 'embeddings',
      trigger: 'ci',
      executionSurface: 'dogfood',
      userImpact: 'high',
      releaseCritical: false,
      requiresExternalRepo: false,
    },
    expected: { requiredEvidenceMode: 'mixed', failClosed: true },
  },
  {
    id: 'scenario-07-low-risk-unit',
    title: 'Low-risk unit flow with no release constraints',
    rationale: 'Low-risk local unit checks should remain dry.',
    context: {
      riskLevel: 'low',
      blastRadius: 'local',
      novelty: 'known',
      providerDependence: 'none',
      trigger: 'manual',
      executionSurface: 'unit',
      userImpact: 'low',
      releaseCritical: false,
      requiresExternalRepo: false,
    },
    expected: { requiredEvidenceMode: 'dry', failClosed: false },
  },
  {
    id: 'scenario-08-medium-risk-patrol',
    title: 'Medium-risk patrol with LLM dependence',
    rationale: 'Medium risk with LLM dependence should require mixed fail-closed.',
    context: {
      riskLevel: 'medium',
      blastRadius: 'module',
      novelty: 'modified',
      providerDependence: 'llm',
      trigger: 'schedule',
      executionSurface: 'patrol',
      userImpact: 'medium',
      releaseCritical: false,
      requiresExternalRepo: true,
    },
    expected: { requiredEvidenceMode: 'mixed', failClosed: true },
  },
  {
    id: 'scenario-09-critical-non-release',
    title: 'Critical risk but non-release CI triage',
    rationale: 'Critical risk in CI should require at least mixed fail-closed.',
    context: {
      riskLevel: 'critical',
      blastRadius: 'repo',
      novelty: 'novel',
      providerDependence: 'mixed',
      trigger: 'ci',
      executionSurface: 'patrol',
      userImpact: 'blocker',
      releaseCritical: false,
      requiresExternalRepo: true,
    },
    expected: { requiredEvidenceMode: 'mixed', failClosed: true },
  },
  {
    id: 'scenario-10-release-low-risk-override',
    title: 'Release trigger with low intrinsic risk but ship criticality',
    rationale: 'Release trigger + criticality should still push to wet.',
    context: {
      riskLevel: 'high',
      blastRadius: 'module',
      novelty: 'known',
      providerDependence: 'embeddings',
      trigger: 'release',
      executionSurface: 'publish',
      userImpact: 'high',
      releaseCritical: true,
      requiresExternalRepo: false,
    },
    expected: { requiredEvidenceMode: 'wet', failClosed: true },
  },
];

export function evaluateWetTestingPolicyResearch(
  policyConfig: WetTestingPolicyConfig = DEFAULT_WET_TESTING_POLICY_CONFIG,
): WetTestingPolicyResearchArtifactV1 {
  const policy = policyConfig;
  const results = WET_TESTING_REPRESENTATIVE_SCENARIOS_V1.map((scenario) => {
    const decision = evaluateWetTestingPolicy(policy, scenario.context);
    const modeMatch = decision.requiredEvidenceMode === scenario.expected.requiredEvidenceMode;
    const failClosedMatch = decision.failClosed === scenario.expected.failClosed;
    const expectedRank = evidenceModeRank[scenario.expected.requiredEvidenceMode];
    const actualRank = evidenceModeRank[decision.requiredEvidenceMode];
    return {
      id: scenario.id,
      expectedEvidenceMode: scenario.expected.requiredEvidenceMode,
      actualEvidenceMode: decision.requiredEvidenceMode,
      expectedFailClosed: scenario.expected.failClosed,
      actualFailClosed: decision.failClosed,
      evidenceModeMatch: modeMatch,
      failClosedMatch,
      riskOfOverEnforcement: actualRank > expectedRank,
      riskOfUnderEnforcement: actualRank < expectedRank,
    };
  });

  return {
    kind: 'WetTestingPolicyResearchArtifact.v1',
    schemaVersion: 1,
    scenarioCount: results.length,
    modeMismatchCount: results.filter((entry) => !entry.evidenceModeMatch).length,
    failClosedMismatchCount: results.filter((entry) => !entry.failClosedMatch).length,
    overEnforcementRiskCount: results.filter((entry) => entry.riskOfOverEnforcement).length,
    underEnforcementRiskCount: results.filter((entry) => entry.riskOfUnderEnforcement).length,
    results,
  };
}
