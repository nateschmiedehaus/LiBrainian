/**
 * @fileoverview Multi-Agent Epistemology for Librarian
 *
 * Implements principled handling of beliefs from multiple agents, including:
 * - Agent expertise and reliability modeling
 * - Peer disagreement resolution strategies
 * - Belief aggregation (linear and logarithmic opinion pools)
 * - Common knowledge computation
 * - Testimony evaluation
 *
 * Based on social epistemology research (philosophical-foundations.md):
 * - Testimony and trust (Coady, Lackey, Goldberg)
 * - Peer disagreement (conciliationist vs steadfast views)
 * - Epistemic democracy
 *
 * And game-theoretic foundations (mathematical-foundations.md):
 * - Common knowledge (Aumann)
 * - Multi-agent reasoning
 * - Epistemic game theory
 *
 * @packageDocumentation
 */

import type { ConfidenceValue } from './confidence.js';
import {
  absent,
  bounded,
  deterministic,
  getNumericValue,
} from './confidence.js';
import type { ClaimId, Claim } from './types.js';
import type { IEvidenceLedger, EvidenceId } from './evidence_ledger.js';

// ============================================================================
// AGENT MODELING
// ============================================================================

/**
 * Profile for an epistemic agent.
 *
 * Captures the agent's expertise across domains, their historical calibration,
 * and their trustworthiness as a source of testimony.
 *
 * Based on reliabilism (Goldman) - justification depends on the reliability
 * of the belief-forming process.
 */
export interface AgentProfile {
  /** Unique identifier for this agent */
  id: string;

  /** Human-readable name for the agent */
  name?: string;

  /**
   * Domain-specific expertise levels.
   * Maps domain identifiers to expertise scores in [0, 1].
   *
   * Example domains: 'typescript', 'react', 'security', 'testing'
   * 1.0 = world-class expert, 0.0 = no knowledge
   */
  expertise: Map<string, number>;

  /**
   * Historical calibration score.
   * Measures how well-calibrated the agent's confidence has been historically.
   *
   * 1.0 = perfectly calibrated (stated confidence matches accuracy)
   * 0.0 = completely miscalibrated
   *
   * Based on calibration curve analysis (Brier score, ECE).
   */
  calibration: number;

  /**
   * Trustworthiness as a source of testimony.
   * Measures reliability of the agent's assertions to others.
   *
   * 1.0 = completely trustworthy (no deception, careful assertions)
   * 0.0 = completely untrustworthy
   *
   * Based on testimony literature (Lackey, Coady).
   */
  trustworthiness: number;

  /** When this profile was created */
  createdAt?: string;

  /** When this profile was last updated */
  updatedAt?: string;

  /** Optional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Basis for an agent's belief.
 *
 * Different bases have different epistemic status:
 * - 'observation': Direct perception/measurement (strongest)
 * - 'inference': Derived from other beliefs via reasoning
 * - 'testimony': Received from another agent
 * - 'speculation': Hypothetical or uncertain (weakest)
 */
export type BeliefBasis = 'observation' | 'inference' | 'testimony' | 'speculation';

/**
 * A belief held by an agent about a specific claim.
 */
export interface AgentBelief {
  /** ID of the agent holding this belief */
  agentId: string;

  /** ID of the claim this belief is about */
  claim: ClaimId;

  /** The agent's confidence in the claim */
  confidence: ConfidenceValue;

  /** When this belief was formed/updated */
  timestamp: string;

  /**
   * Epistemic basis for the belief.
   * Affects how the belief should be weighted in aggregation.
   */
  basis: BeliefBasis;

  /**
   * Optional domain this belief relates to.
   * Used for expertise-weighted aggregation.
   */
  domain?: string;

  /**
   * Optional explanation for why the agent holds this belief.
   */
  reasoning?: string;

  /**
   * If basis is 'testimony', the ID of the agent who provided it.
   */
  sourceAgentId?: string;
}

/**
 * Type guard for AgentProfile.
 */
export function isAgentProfile(value: unknown): value is AgentProfile {
  if (!value || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.id === 'string' &&
    obj.expertise instanceof Map &&
    typeof obj.calibration === 'number' &&
    typeof obj.trustworthiness === 'number'
  );
}

/**
 * Type guard for AgentBelief.
 */
export function isAgentBelief(value: unknown): value is AgentBelief {
  if (!value || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.agentId === 'string' &&
    typeof obj.claim === 'string' &&
    typeof obj.confidence === 'object' &&
    typeof obj.timestamp === 'string' &&
    (obj.basis === 'observation' ||
      obj.basis === 'inference' ||
      obj.basis === 'testimony' ||
      obj.basis === 'speculation')
  );
}

/**
 * Create a new agent profile with defaults.
 */
export function createAgentProfile(
  id: string,
  options: Partial<Omit<AgentProfile, 'id'>> = {}
): AgentProfile {
  return {
    id,
    name: options.name,
    expertise: options.expertise ?? new Map(),
    calibration: options.calibration ?? 0.5, // Neutral default
    trustworthiness: options.trustworthiness ?? 0.5, // Neutral default
    createdAt: options.createdAt ?? new Date().toISOString(),
    updatedAt: options.updatedAt ?? new Date().toISOString(),
    metadata: options.metadata,
  };
}

/**
 * Create a new agent belief.
 */
export function createAgentBelief(
  agentId: string,
  claim: ClaimId,
  confidence: ConfidenceValue,
  basis: BeliefBasis,
  options: Partial<Omit<AgentBelief, 'agentId' | 'claim' | 'confidence' | 'basis'>> = {}
): AgentBelief {
  return {
    agentId,
    claim,
    confidence,
    timestamp: options.timestamp ?? new Date().toISOString(),
    basis,
    domain: options.domain,
    reasoning: options.reasoning,
    sourceAgentId: options.sourceAgentId,
  };
}

// ============================================================================
// DISAGREEMENT HANDLING
// ============================================================================

/**
 * Strategies for resolving peer disagreement.
 *
 * Based on the peer disagreement literature:
 * - 'equal_weight': Conciliatory view - give equal weight to peers (Christensen, Elga)
 * - 'expertise_weight': Weight by domain expertise
 * - 'track_record': Weight by historical calibration
 * - 'steadfast': Maintain one's own belief (Kelly, Titelbaum)
 * - 'suspend': Withhold judgment entirely (pyrrhonian approach)
 */
export type DisagreementStrategy =
  | 'equal_weight'
  | 'expertise_weight'
  | 'track_record'
  | 'steadfast'
  | 'suspend';

/**
 * Result of resolving a disagreement between agents.
 */
export interface DisagreementResolution {
  /** The beliefs that were in disagreement */
  beliefs: AgentBelief[];

  /** The strategy used for resolution */
  strategy: DisagreementStrategy;

  /** The resulting confidence value */
  result: ConfidenceValue;

  /** Explanation of how the result was computed */
  reasoning: string;

  /** Weights assigned to each agent (if applicable) */
  weights?: Map<string, number>;

  /** Degree of disagreement (0 = agreement, 1 = maximal disagreement) */
  disagreementDegree: number;
}

/**
 * Compute the degree of disagreement between beliefs.
 *
 * Returns a value in [0, 1] where:
 * - 0 = perfect agreement
 * - 1 = maximal disagreement (one believes 1.0, another believes 0.0)
 */
export function computeDisagreementDegree(beliefs: AgentBelief[]): number {
  if (beliefs.length <= 1) return 0;

  const values = beliefs
    .map((b) => getNumericValue(b.confidence))
    .filter((v): v is number => v !== null);

  if (values.length <= 1) return 0;

  const max = Math.max(...values);
  const min = Math.min(...values);

  return max - min;
}

/**
 * Resolve a disagreement between agents about a claim.
 *
 * Implements multiple resolution strategies based on peer disagreement literature:
 * - Conciliationism: When epistemic peers disagree, both should adjust
 * - Expertise weighting: Non-peers should defer to experts
 * - Track record: Weight by historical reliability
 *
 * @param beliefs - Array of agent beliefs about the same claim
 * @param profiles - Map of agent profiles for weighting
 * @param strategy - The resolution strategy to use
 * @param domain - Optional domain for expertise weighting
 * @returns DisagreementResolution with the result and reasoning
 */
export function resolveDisagreement(
  beliefs: AgentBelief[],
  profiles: Map<string, AgentProfile>,
  strategy: DisagreementStrategy,
  domain?: string
): DisagreementResolution {
  if (beliefs.length === 0) {
    return {
      beliefs: [],
      strategy,
      result: absent('insufficient_data'),
      reasoning: 'No beliefs to resolve',
      disagreementDegree: 0,
    };
  }

  if (beliefs.length === 1) {
    return {
      beliefs,
      strategy,
      result: beliefs[0].confidence,
      reasoning: 'Single belief - no disagreement to resolve',
      disagreementDegree: 0,
    };
  }

  const disagreementDegree = computeDisagreementDegree(beliefs);

  switch (strategy) {
    case 'equal_weight':
      return resolveEqualWeight(beliefs, disagreementDegree);

    case 'expertise_weight':
      return resolveExpertiseWeight(beliefs, profiles, domain ?? beliefs[0].domain, disagreementDegree);

    case 'track_record':
      return resolveTrackRecord(beliefs, profiles, disagreementDegree);

    case 'steadfast':
      // In steadfast view, we just return the first belief (caller's perspective)
      return {
        beliefs,
        strategy,
        result: beliefs[0].confidence,
        reasoning:
          'Steadfast strategy: maintaining original belief despite disagreement. ' +
          'Per Kelly/Titelbaum, one can maintain belief if one has good independent reasons.',
        disagreementDegree,
      };

    case 'suspend':
      return {
        beliefs,
        strategy,
        result: absent('insufficient_data'),
        reasoning:
          'Suspension strategy: withholding judgment due to peer disagreement. ' +
          'The presence of equally qualified disagreeing agents defeats justification.',
        disagreementDegree,
      };

    default:
      return {
        beliefs,
        strategy,
        result: absent('not_applicable'),
        reasoning: `Unknown strategy: ${strategy}`,
        disagreementDegree,
      };
  }
}

/**
 * Equal weight resolution (conciliatory view).
 *
 * Per Christensen and Elga, when epistemic peers disagree, both should
 * "split the difference" and adjust toward the average.
 */
function resolveEqualWeight(
  beliefs: AgentBelief[],
  disagreementDegree: number
): DisagreementResolution {
  const values = beliefs
    .map((b) => getNumericValue(b.confidence))
    .filter((v): v is number => v !== null);

  if (values.length === 0) {
    return {
      beliefs,
      strategy: 'equal_weight',
      result: absent('uncalibrated'),
      reasoning: 'No numeric confidence values available',
      disagreementDegree,
    };
  }

  const average = values.reduce((a, b) => a + b, 0) / values.length;

  return {
    beliefs,
    strategy: 'equal_weight',
    result: {
      type: 'derived',
      value: average,
      formula: 'equal_weight_average',
      inputs: beliefs.map((b, i) => ({
        name: `agent_${b.agentId}_belief`,
        confidence: b.confidence,
      })),
    },
    reasoning:
      `Equal weight resolution: averaged ${values.length} beliefs. ` +
      `Per conciliationism (Christensen, Elga), epistemic peers should split the difference.`,
    disagreementDegree,
  };
}

/**
 * Expertise-weighted resolution.
 *
 * Weights beliefs by domain expertise, acknowledging that not all
 * agents are epistemic peers in all domains.
 */
function resolveExpertiseWeight(
  beliefs: AgentBelief[],
  profiles: Map<string, AgentProfile>,
  domain: string | undefined,
  disagreementDegree: number
): DisagreementResolution {
  const weights = new Map<string, number>();
  let totalWeight = 0;
  let weightedSum = 0;

  for (const belief of beliefs) {
    const profile = profiles.get(belief.agentId);
    const value = getNumericValue(belief.confidence);

    if (value === null) continue;

    // Get expertise for the specific domain, default to 0.5
    let expertiseWeight = 0.5;
    if (profile && domain) {
      expertiseWeight = profile.expertise.get(domain) ?? 0.5;
    } else if (profile) {
      // Use average expertise if no specific domain
      const expertiseValues = Array.from(profile.expertise.values());
      if (expertiseValues.length > 0) {
        expertiseWeight = expertiseValues.reduce((a, b) => a + b, 0) / expertiseValues.length;
      }
    }

    weights.set(belief.agentId, expertiseWeight);
    totalWeight += expertiseWeight;
    weightedSum += value * expertiseWeight;
  }

  if (totalWeight === 0) {
    return {
      beliefs,
      strategy: 'expertise_weight',
      result: absent('uncalibrated'),
      reasoning: 'No weighted beliefs available',
      weights,
      disagreementDegree,
    };
  }

  const weightedAverage = weightedSum / totalWeight;

  return {
    beliefs,
    strategy: 'expertise_weight',
    result: {
      type: 'derived',
      value: weightedAverage,
      formula: 'expertise_weighted_average',
      inputs: beliefs.map((b) => ({
        name: `agent_${b.agentId}_belief`,
        confidence: b.confidence,
      })),
    },
    reasoning:
      `Expertise-weighted resolution for domain '${domain ?? 'general'}'. ` +
      `Weights: ${Array.from(weights.entries())
        .map(([id, w]) => `${id}=${w.toFixed(2)}`)
        .join(', ')}.`,
    weights,
    disagreementDegree,
  };
}

/**
 * Track record weighted resolution.
 *
 * Weights beliefs by historical calibration, giving more weight to
 * agents who have been well-calibrated in the past.
 */
function resolveTrackRecord(
  beliefs: AgentBelief[],
  profiles: Map<string, AgentProfile>,
  disagreementDegree: number
): DisagreementResolution {
  const weights = new Map<string, number>();
  let totalWeight = 0;
  let weightedSum = 0;

  for (const belief of beliefs) {
    const profile = profiles.get(belief.agentId);
    const value = getNumericValue(belief.confidence);

    if (value === null) continue;

    // Use calibration as weight, default to 0.5 if unknown
    const calibrationWeight = profile?.calibration ?? 0.5;

    weights.set(belief.agentId, calibrationWeight);
    totalWeight += calibrationWeight;
    weightedSum += value * calibrationWeight;
  }

  if (totalWeight === 0) {
    return {
      beliefs,
      strategy: 'track_record',
      result: absent('uncalibrated'),
      reasoning: 'No weighted beliefs available',
      weights,
      disagreementDegree,
    };
  }

  const weightedAverage = weightedSum / totalWeight;

  return {
    beliefs,
    strategy: 'track_record',
    result: {
      type: 'derived',
      value: weightedAverage,
      formula: 'track_record_weighted_average',
      inputs: beliefs.map((b) => ({
        name: `agent_${b.agentId}_belief`,
        confidence: b.confidence,
      })),
    },
    reasoning:
      `Track record weighted resolution. ` +
      `Weights based on historical calibration: ${Array.from(weights.entries())
        .map(([id, w]) => `${id}=${w.toFixed(2)}`)
        .join(', ')}.`,
    weights,
    disagreementDegree,
  };
}

// ============================================================================
// BELIEF AGGREGATION (OPINION POOLS)
// ============================================================================

/**
 * Aggregate multiple agent beliefs into a group belief.
 *
 * Uses expertise-weighted linear opinion pool by default.
 *
 * @param beliefs - Array of agent beliefs
 * @param profiles - Map of agent profiles for weighting
 * @param domain - Optional domain for expertise weighting
 * @returns Aggregated confidence value
 */
export function aggregateBeliefs(
  beliefs: AgentBelief[],
  profiles: Map<string, AgentProfile>,
  domain?: string
): ConfidenceValue {
  if (beliefs.length === 0) {
    return absent('insufficient_data');
  }

  // Compute weights based on expertise and calibration
  const weights = new Map<string, number>();

  for (const belief of beliefs) {
    const profile = profiles.get(belief.agentId);

    if (!profile) {
      weights.set(belief.agentId, 0.5); // Default weight
      continue;
    }

    // Combine expertise and calibration
    const expertise = domain ? (profile.expertise.get(domain) ?? 0.5) : 0.5;
    const calibration = profile.calibration;

    // Weight = expertise * calibration (both in [0, 1])
    const weight = expertise * calibration;
    weights.set(belief.agentId, weight);
  }

  return linearPool(beliefs, weights);
}

/**
 * Linear opinion pool (weighted arithmetic average).
 *
 * The standard approach for combining probability distributions.
 * Preserves external Bayesianity: if all agents agree on the evidence,
 * the group posterior equals each individual posterior.
 *
 * P_group(A) = Σ w_i * P_i(A)
 *
 * @param beliefs - Array of agent beliefs
 * @param weights - Map of agent ID to weight
 * @returns Aggregated confidence value
 */
export function linearPool(
  beliefs: AgentBelief[],
  weights: Map<string, number>
): ConfidenceValue {
  if (beliefs.length === 0) {
    return absent('insufficient_data');
  }

  let totalWeight = 0;
  let weightedSum = 0;
  const validBeliefs: Array<{ name: string; confidence: ConfidenceValue }> = [];

  for (const belief of beliefs) {
    const value = getNumericValue(belief.confidence);
    if (value === null) continue;

    const weight = weights.get(belief.agentId) ?? 1;
    totalWeight += weight;
    weightedSum += value * weight;
    validBeliefs.push({
      name: `agent_${belief.agentId}`,
      confidence: belief.confidence,
    });
  }

  if (totalWeight === 0 || validBeliefs.length === 0) {
    return absent('uncalibrated');
  }

  const result = weightedSum / totalWeight;

  return {
    type: 'derived',
    value: result,
    formula: 'linear_pool',
    inputs: validBeliefs,
  };
}

/**
 * Logarithmic opinion pool (weighted geometric average).
 *
 * Often preferred when combining expert opinions because it gives
 * greater weight to extreme opinions and is externally Bayesian.
 *
 * P_group(A) ∝ Π P_i(A)^w_i
 *
 * Normalized so that probabilities sum to 1.
 *
 * @param beliefs - Array of agent beliefs
 * @param weights - Map of agent ID to weight
 * @returns Aggregated confidence value (0-1)
 */
export function logPool(
  beliefs: AgentBelief[],
  weights: Map<string, number>
): number {
  if (beliefs.length === 0) {
    return 0.5; // Neutral default
  }

  let totalWeight = 0;
  let logSum = 0;
  let validCount = 0;

  for (const belief of beliefs) {
    const value = getNumericValue(belief.confidence);
    if (value === null || value <= 0 || value >= 1) continue;

    const weight = weights.get(belief.agentId) ?? 1;
    totalWeight += weight;

    // Use log-odds for numerical stability
    const logOdds = Math.log(value / (1 - value));
    logSum += weight * logOdds;
    validCount++;
  }

  if (totalWeight === 0 || validCount === 0) {
    return 0.5; // Neutral default
  }

  const weightedLogOdds = logSum / totalWeight;

  // Convert back from log-odds to probability
  return 1 / (1 + Math.exp(-weightedLogOdds));
}

// ============================================================================
// COMMON KNOWLEDGE
// ============================================================================

/**
 * Level of knowledge about a claim.
 *
 * Based on Aumann's common knowledge formalization:
 * - Level 0: Individual agent knows
 * - Level 1: Everyone knows (mutual knowledge)
 * - Level 2: Everyone knows everyone knows
 * - Level n: Iterative mutual knowledge
 * - Level ∞: Common knowledge (all levels simultaneously)
 */
export interface KnowledgeLevel {
  /** The knowledge level achieved */
  level: number;

  /** The set of agents involved */
  agents: Set<string>;

  /** The claim being known */
  claim: ClaimId;

  /** Whether this is common knowledge (effectively infinite level) */
  isCommonKnowledge: boolean;

  /** Evidence for this knowledge level */
  evidence?: EvidenceId[];
}

/**
 * Check if a claim is common knowledge among agents.
 *
 * Common knowledge (Aumann, 1976) requires:
 * 1. Everyone knows A
 * 2. Everyone knows everyone knows A
 * 3. Everyone knows everyone knows everyone knows A
 * 4. ... (infinite regress)
 *
 * In practice, we check whether the claim is derived from shared public
 * evidence that all agents have access to.
 *
 * @param claim - The claim to check
 * @param agents - The set of agents to consider
 * @param ledger - The evidence ledger for looking up shared evidence
 * @returns KnowledgeLevel describing the achieved level
 */
export async function isCommonKnowledge(
  claim: ClaimId,
  agents: string[],
  ledger: IEvidenceLedger
): Promise<KnowledgeLevel> {
  if (agents.length === 0) {
    return {
      level: 0,
      agents: new Set(),
      claim,
      isCommonKnowledge: false,
    };
  }

  // Query for evidence related to this claim
  const entries = await ledger.query({
    kinds: ['claim', 'verification', 'outcome'],
  });

  // Find entries that mention this claim
  const claimEntries = entries.filter(
    (e) =>
      e.payload &&
      typeof e.payload === 'object' &&
      'claimId' in e.payload &&
      (e.payload as { claimId: string }).claimId === claim
  );

  if (claimEntries.length === 0) {
    return {
      level: 0,
      agents: new Set(agents),
      claim,
      isCommonKnowledge: false,
    };
  }

  // Check if all agents have access to the same evidence
  // In a simple model, if the evidence is in the shared ledger,
  // all agents have access to it (public event).
  const publicEvidence = claimEntries.map((e) => e.id);

  // For now, we assume that if evidence is in the ledger, it's public
  // and creates common knowledge (Aumann's public event characterization)
  const agentSet = new Set(agents);

  // Level is "infinite" (common knowledge) if there's public evidence
  // that all agents can observe
  if (publicEvidence.length > 0) {
    return {
      level: Infinity,
      agents: agentSet,
      claim,
      isCommonKnowledge: true,
      evidence: publicEvidence,
    };
  }

  // Otherwise, we can't establish common knowledge
  return {
    level: 0,
    agents: agentSet,
    claim,
    isCommonKnowledge: false,
  };
}

/**
 * Compute the highest level of mutual knowledge achievable.
 *
 * Unlike common knowledge, mutual knowledge is finite and computable.
 * This checks how many iterations of "everyone knows" can be verified.
 *
 * @param claim - The claim to check
 * @param agents - The agents to consider
 * @param beliefs - Map of agent -> beliefs about what other agents believe
 * @param maxLevel - Maximum level to check (default: 3)
 * @returns The highest achievable knowledge level
 */
export function computeMutualKnowledgeLevel(
  claim: ClaimId,
  agents: string[],
  beliefs: Map<string, AgentBelief[]>,
  maxLevel = 3
): number {
  if (agents.length === 0) return 0;

  // Level 0: At least one agent knows
  let currentLevel = 0;

  // Check if all agents know the claim (level 1)
  const allKnow = agents.every((agent) => {
    const agentBeliefs = beliefs.get(agent) ?? [];
    return agentBeliefs.some(
      (b) =>
        b.claim === claim &&
        b.confidence.type !== 'absent' &&
        (getNumericValue(b.confidence) ?? 0) > 0.5
    );
  });

  if (!allKnow) return currentLevel;
  currentLevel = 1;

  // For higher levels, we would need beliefs about beliefs
  // This is a simplified model that assumes public knowledge creates common knowledge
  // More sophisticated implementations would track nested belief structures

  // In practice, if all agents have the same evidence in a shared ledger,
  // we can assume higher levels are achievable
  if (maxLevel > 1) {
    // Simplified: if level 1 is achieved with high confidence,
    // assume level 2 is likely achievable (agents can reason about each other)
    currentLevel = Math.min(maxLevel, 2);
  }

  return currentLevel;
}

// ============================================================================
// TESTIMONY EVALUATION
// ============================================================================

/**
 * Result of evaluating testimony.
 */
export interface TestimonyEvaluationResult {
  /** The original testimony being evaluated */
  testimony: AgentBelief;

  /** The speaker who provided the testimony */
  speaker: AgentProfile;

  /** The hearer evaluating the testimony */
  hearer: AgentProfile;

  /** The hearer's resulting confidence */
  resultingConfidence: ConfidenceValue;

  /** Factors that affected the evaluation */
  factors: {
    /** Speaker's trustworthiness factor */
    trustworthiness: number;
    /** Speaker's expertise in the domain */
    expertise: number;
    /** Speaker's historical calibration */
    calibration: number;
    /** Hearer's prior confidence (if any) */
    hearerPrior?: number;
  };

  /** Explanation of the evaluation */
  reasoning: string;
}

/**
 * Evaluate testimony from one agent to another.
 *
 * Based on testimony epistemology (Coady, Lackey):
 * - Reductionism: Testimony must be verified against independent evidence
 * - Anti-reductionism: Testimony is a basic source of knowledge
 * - Hybrid: Testimony is presumptively reliable but defeasible
 *
 * We take a hybrid approach, adjusting confidence based on:
 * 1. Speaker's trustworthiness
 * 2. Speaker's expertise in the relevant domain
 * 3. Speaker's historical calibration
 * 4. Basis of the speaker's belief
 *
 * @param testimony - The belief being communicated
 * @param speaker - Profile of the agent giving testimony
 * @param hearer - Profile of the agent receiving testimony
 * @returns Evaluation result with the hearer's resulting confidence
 */
export function evaluateTestimony(
  testimony: AgentBelief,
  speaker: AgentProfile,
  hearer: AgentProfile
): TestimonyEvaluationResult {
  const testimonialValue = getNumericValue(testimony.confidence);

  if (testimonialValue === null) {
    return {
      testimony,
      speaker,
      hearer,
      resultingConfidence: absent('uncalibrated'),
      factors: {
        trustworthiness: speaker.trustworthiness,
        expertise: 0,
        calibration: speaker.calibration,
      },
      reasoning: 'Cannot evaluate testimony with absent confidence',
    };
  }

  // Get speaker's expertise in the relevant domain
  const domain = testimony.domain;
  const expertise = domain ? (speaker.expertise.get(domain) ?? 0.5) : 0.5;

  // Compute the testimonial discount factor
  // Based on trustworthiness, expertise, and calibration
  const trustFactor = speaker.trustworthiness;
  const expertiseFactor = expertise;
  const calibrationFactor = speaker.calibration;

  // Basis factor: direct observation is most reliable
  let basisFactor: number;
  switch (testimony.basis) {
    case 'observation':
      basisFactor = 1.0;
      break;
    case 'inference':
      basisFactor = 0.9;
      break;
    case 'testimony':
      basisFactor = 0.7; // Testimony of testimony is weaker
      break;
    case 'speculation':
      basisFactor = 0.5;
      break;
  }

  // Combined transmission factor
  // Uses geometric mean to ensure low values in any factor have significant impact
  const factors = [trustFactor, expertiseFactor, calibrationFactor, basisFactor];
  const transmissionFactor = Math.pow(
    factors.reduce((a, b) => a * b, 1),
    1 / factors.length
  );

  // The hearer's confidence is attenuated by the transmission factor
  // This implements the intuition that testimony transfers at most as much
  // justification as the speaker had, often less
  const resultValue = testimonialValue * transmissionFactor;

  // Clamp to valid range
  const clampedResult = Math.max(0, Math.min(1, resultValue));

  return {
    testimony,
    speaker,
    hearer,
    resultingConfidence: {
      type: 'derived',
      value: clampedResult,
      formula: `testimony_evaluation(value=${testimonialValue.toFixed(3)}, transmission=${transmissionFactor.toFixed(3)})`,
      inputs: [
        { name: 'speaker_testimony', confidence: testimony.confidence },
        {
          name: 'transmission_factor',
          confidence: bounded(transmissionFactor, transmissionFactor, 'formal_analysis', 'testimony_evaluation'),
        },
      ],
    },
    factors: {
      trustworthiness: trustFactor,
      expertise: expertiseFactor,
      calibration: calibrationFactor,
    },
    reasoning:
      `Testimony from ${speaker.id} to ${hearer.id} evaluated. ` +
      `Original confidence: ${testimonialValue.toFixed(3)}, ` +
      `transmission factor: ${transmissionFactor.toFixed(3)} ` +
      `(trust=${trustFactor.toFixed(2)}, expertise=${expertiseFactor.toFixed(2)}, ` +
      `calibration=${calibrationFactor.toFixed(2)}, basis=${testimony.basis}). ` +
      `Resulting confidence: ${clampedResult.toFixed(3)}.`,
  };
}

/**
 * Check if testimony should be accepted (threshold-based).
 *
 * @param evaluation - Result of evaluateTestimony
 * @param threshold - Minimum confidence to accept (default: 0.5)
 * @returns true if the resulting confidence exceeds the threshold
 */
export function shouldAcceptTestimony(
  evaluation: TestimonyEvaluationResult,
  threshold = 0.5
): boolean {
  const value = getNumericValue(evaluation.resultingConfidence);
  return value !== null && value >= threshold;
}

// ============================================================================
// GROUP EPISTEMICS
// ============================================================================

/**
 * A group of agents with shared epistemic properties.
 */
export interface EpistemicGroup {
  /** Group identifier */
  id: string;

  /** Member agent IDs */
  members: Set<string>;

  /** Shared common knowledge claims */
  commonKnowledge: Set<ClaimId>;

  /** Group consensus beliefs */
  consensus: Map<ClaimId, ConfidenceValue>;

  /** Disagreements within the group */
  disagreements: Map<ClaimId, DisagreementResolution>;
}

/**
 * Create an epistemic group from a set of agents.
 */
export function createEpistemicGroup(
  id: string,
  members: string[]
): EpistemicGroup {
  return {
    id,
    members: new Set(members),
    commonKnowledge: new Set(),
    consensus: new Map(),
    disagreements: new Map(),
  };
}

/**
 * Compute group consensus on a claim.
 *
 * Uses expertise-weighted belief aggregation with disagreement detection.
 *
 * @param group - The epistemic group
 * @param claim - The claim to form consensus on
 * @param beliefs - All agent beliefs about the claim
 * @param profiles - Agent profiles for weighting
 * @param domain - Optional domain for expertise weighting
 * @returns Updated group with consensus and any disagreements
 */
export function computeGroupConsensus(
  group: EpistemicGroup,
  claim: ClaimId,
  beliefs: AgentBelief[],
  profiles: Map<string, AgentProfile>,
  domain?: string
): EpistemicGroup {
  // Filter to only beliefs from group members
  const memberBeliefs = beliefs.filter((b) => group.members.has(b.agentId));

  if (memberBeliefs.length === 0) {
    return group;
  }

  // Check for significant disagreement
  const disagreementDegree = computeDisagreementDegree(memberBeliefs);

  if (disagreementDegree > 0.3) {
    // Significant disagreement - use disagreement resolution
    const resolution = resolveDisagreement(
      memberBeliefs,
      profiles,
      'expertise_weight',
      domain
    );

    const updatedGroup: EpistemicGroup = {
      ...group,
      consensus: new Map(group.consensus),
      disagreements: new Map(group.disagreements),
    };
    updatedGroup.consensus.set(claim, resolution.result);
    updatedGroup.disagreements.set(claim, resolution);

    return updatedGroup;
  }

  // Low disagreement - aggregate normally
  const aggregated = aggregateBeliefs(memberBeliefs, profiles, domain);

  const updatedGroup: EpistemicGroup = {
    ...group,
    consensus: new Map(group.consensus),
  };
  updatedGroup.consensus.set(claim, aggregated);

  return updatedGroup;
}

// ============================================================================
// HELPERS AND UTILITIES
// ============================================================================

/**
 * Get all agents who believe a claim with confidence above threshold.
 */
export function getAgentsWhoKnow(
  beliefs: AgentBelief[],
  claim: ClaimId,
  threshold = 0.5
): string[] {
  return beliefs
    .filter((b) => {
      if (b.claim !== claim) return false;
      const value = getNumericValue(b.confidence);
      return value !== null && value >= threshold;
    })
    .map((b) => b.agentId);
}

/**
 * Get all claims that an agent believes with confidence above threshold.
 */
export function getAgentKnowledge(
  beliefs: AgentBelief[],
  agentId: string,
  threshold = 0.5
): ClaimId[] {
  return beliefs
    .filter((b) => {
      if (b.agentId !== agentId) return false;
      const value = getNumericValue(b.confidence);
      return value !== null && value >= threshold;
    })
    .map((b) => b.claim);
}

/**
 * Find claims where agents significantly disagree.
 *
 * @param beliefs - All agent beliefs
 * @param threshold - Disagreement degree threshold (default: 0.3)
 * @returns Array of claim IDs with significant disagreement
 */
export function findDisagreements(
  beliefs: AgentBelief[],
  threshold = 0.3
): ClaimId[] {
  // Group beliefs by claim
  const byClaimMap = new Map<ClaimId, AgentBelief[]>();
  for (const belief of beliefs) {
    const existing = byClaimMap.get(belief.claim) ?? [];
    existing.push(belief);
    byClaimMap.set(belief.claim, existing);
  }

  // Find claims with significant disagreement
  const disagreements: ClaimId[] = [];
  for (const [claim, claimBeliefs] of byClaimMap) {
    if (claimBeliefs.length < 2) continue;
    const degree = computeDisagreementDegree(claimBeliefs);
    if (degree >= threshold) {
      disagreements.push(claim);
    }
  }

  return disagreements;
}

/**
 * Compute the epistemic authority ranking of agents for a domain.
 *
 * Ranks agents by their combined expertise and track record.
 *
 * @param agents - Array of agent IDs to rank
 * @param profiles - Agent profiles
 * @param domain - Domain for expertise lookup
 * @returns Array of agent IDs sorted by authority (highest first)
 */
export function rankByAuthority(
  agents: string[],
  profiles: Map<string, AgentProfile>,
  domain?: string
): string[] {
  return [...agents].sort((a, b) => {
    const profileA = profiles.get(a);
    const profileB = profiles.get(b);

    const scoreA = computeAuthorityScore(profileA, domain);
    const scoreB = computeAuthorityScore(profileB, domain);

    return scoreB - scoreA; // Descending order
  });
}

/**
 * Compute authority score for a single agent.
 */
function computeAuthorityScore(
  profile: AgentProfile | undefined,
  domain?: string
): number {
  if (!profile) return 0.5;

  const expertise = domain ? (profile.expertise.get(domain) ?? 0.5) : 0.5;
  const calibration = profile.calibration;
  const trust = profile.trustworthiness;

  // Weighted combination: expertise matters most for authority
  return expertise * 0.5 + calibration * 0.3 + trust * 0.2;
}
