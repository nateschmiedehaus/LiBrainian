import {
  DEFAULT_WET_TESTING_POLICY_CONFIG,
  createWetTestingPolicyDecisionArtifact,
  evaluateWetTestingPolicy,
  parseWetTestingPolicyConfig,
  type WetTestingPolicyConfig,
  type WetTestingPolicyDecisionArtifact,
  type WetTestingEvidenceMode,
} from './wet_testing_policy.js';

export type PatrolPolicyTrigger = 'manual' | 'schedule' | 'ci' | 'release';

export interface PatrolPolicyEvaluationInput {
  mode: 'quick' | 'full' | 'release';
  trigger: PatrolPolicyTrigger;
  dryRun: boolean;
  hasCommand: boolean;
  observationExtracted: boolean;
  timedOut: boolean;
  policyConfig?: WetTestingPolicyConfig;
}

export interface PatrolPolicyEnforcementResult {
  kind: 'PatrolPolicyEnforcementResult.v1';
  requiredEvidenceMode: WetTestingEvidenceMode;
  observedEvidenceMode: 'none' | 'dry' | 'mixed' | 'wet';
  enforcement: 'allowed' | 'blocked';
  reason: string;
  decisionArtifact: WetTestingPolicyDecisionArtifact;
}

function deriveObservedEvidenceMode(input: PatrolPolicyEvaluationInput): PatrolPolicyEnforcementResult['observedEvidenceMode'] {
  if (input.timedOut && !input.observationExtracted) return 'none';
  if (input.dryRun && !input.hasCommand) return 'dry';
  if (input.hasCommand && input.observationExtracted && !input.timedOut) return 'wet';
  if (input.hasCommand || input.observationExtracted) return 'mixed';
  return 'none';
}

function satisfiesEvidenceRequirement(
  required: WetTestingEvidenceMode,
  observed: PatrolPolicyEnforcementResult['observedEvidenceMode'],
): boolean {
  if (required === 'dry') return observed !== 'none';
  if (required === 'mixed') return observed === 'mixed' || observed === 'wet';
  return observed === 'wet';
}

function deriveContext(input: PatrolPolicyEvaluationInput) {
  if (input.mode === 'release') {
    return {
      riskLevel: 'critical',
      blastRadius: 'repo',
      novelty: 'novel',
      providerDependence: 'mixed',
      trigger: input.trigger === 'manual' ? 'release' : input.trigger,
      executionSurface: 'patrol',
      userImpact: 'blocker',
      releaseCritical: true,
      requiresExternalRepo: true,
    } as const;
  }

  if (input.mode === 'full') {
    return {
      riskLevel: 'high',
      blastRadius: 'cross_module',
      novelty: 'modified',
      providerDependence: 'mixed',
      trigger: input.trigger === 'release' ? 'ci' : input.trigger,
      executionSurface: 'patrol',
      userImpact: 'high',
      releaseCritical: input.trigger === 'release',
      requiresExternalRepo: true,
    } as const;
  }

  return {
    riskLevel: 'low',
    blastRadius: 'module',
    novelty: 'known',
    providerDependence: 'embeddings',
    trigger: input.trigger === 'release' ? 'manual' : input.trigger,
    executionSurface: 'patrol',
    userImpact: 'medium',
    releaseCritical: false,
    requiresExternalRepo: true,
  } as const;
}

export function evaluatePatrolPolicy(
  input: PatrolPolicyEvaluationInput,
): PatrolPolicyEnforcementResult {
  const policy = input.policyConfig
    ? parseWetTestingPolicyConfig(input.policyConfig)
    : DEFAULT_WET_TESTING_POLICY_CONFIG;
  const context = deriveContext(input);
  const decision = evaluateWetTestingPolicy(policy, context);
  const decisionArtifact = createWetTestingPolicyDecisionArtifact(decision, policy);
  const observedEvidenceMode = deriveObservedEvidenceMode(input);
  const sufficientEvidence = satisfiesEvidenceRequirement(
    decision.requiredEvidenceMode,
    observedEvidenceMode,
  );
  const blocked = decision.failClosed && !sufficientEvidence;

  return {
    kind: 'PatrolPolicyEnforcementResult.v1',
    requiredEvidenceMode: decision.requiredEvidenceMode,
    observedEvidenceMode,
    enforcement: blocked ? 'blocked' : 'allowed',
    reason: blocked
      ? `wet-testing policy fail-closed: required=${decision.requiredEvidenceMode} observed=${observedEvidenceMode}`
      : `wet-testing policy satisfied: required=${decision.requiredEvidenceMode} observed=${observedEvidenceMode}`,
    decisionArtifact,
  };
}
