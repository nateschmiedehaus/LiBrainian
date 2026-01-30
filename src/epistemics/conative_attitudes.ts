/**
 * @fileoverview Conative Attitudes for the Epistemic Framework
 *
 * Implements action-directed epistemic attitudes: intentions, preferences, desires, hopes, and fears.
 * These extend the basic epistemic attitudes (entertaining, accepting, rejecting, questioning, suspending)
 * with practical reasoning capabilities based on the Belief-Desire-Intention (BDI) model.
 *
 * Theoretical foundation:
 * - Preferences, intentions, and goals are epistemic phenomena constructable from the six primitives
 * - Preferences have epistemic content: "I prefer A to B" expresses an epistemic state about relative value
 * - Intentions involve commitment to truth: "I intend to X" involves accepting "I will X" as something to make true
 * - Goals are desired states: A goal is content about a future state with positive valence
 * - Practical reasoning is coherence: Deciding what to do is evaluating coherence of action-belief sets
 *
 * References:
 * - Bratman, M.E. (1987) "Intention, Plans, and Practical Reason"
 * - Rao, A.S. & Georgeff, M.P. (1995) "BDI Agents: From Theory to Practice"
 * - docs/librarian/specs/adversarial/synthesis/03-action-theory.md
 *
 * @packageDocumentation
 */

import { randomUUID } from 'node:crypto';
import type {
  Content,
  ContentType,
  AttitudeType,
  GradedStrength,
  EpistemicObject,
  Grounding,
  ObjectId,
  GroundingId,
  ExtendedGroundingType,
  CoherenceNetwork,
  EvaluationContext,
} from './universal_coherence.js';
import {
  constructContent,
  constructAttitude,
  constructEpistemicObject,
  constructGrounding,
  constructCoherenceNetwork,
  evaluateCoherence,
  createObjectId,
} from './universal_coherence.js';

// ============================================================================
// SCHEMA VERSION
// ============================================================================

/** Current schema version for conative attitude types */
export const CONATIVE_ATTITUDES_SCHEMA_VERSION = '1.0.0';

// ============================================================================
// EXTENDED ATTITUDE TYPES
// ============================================================================

/**
 * Conative attitude types extend the base epistemic attitudes with action-directed stances.
 * These capture practical reasoning orientations toward content.
 */
export type ConativeAttitudeType =
  | 'intending'   // Committed to making content true through action
  | 'preferring'  // Content ranks higher than alternatives
  | 'desiring'    // Content is wanted (but not committed to pursue)
  | 'hoping'      // Content is wanted with positive expectation
  | 'fearing';    // Content is unwanted with negative expectation

/**
 * Extended attitude type union combining epistemic and conative attitudes.
 * This is the full set of attitudes available in the framework.
 */
export type ExtendedAttitudeType = AttitudeType | ConativeAttitudeType;

/**
 * Type guard for ConativeAttitudeType
 */
export function isConativeAttitudeType(type: string): type is ConativeAttitudeType {
  return ['intending', 'preferring', 'desiring', 'hoping', 'fearing'].includes(type);
}

/**
 * Type guard for ExtendedAttitudeType
 */
export function isExtendedAttitudeType(type: string): type is ExtendedAttitudeType {
  const epistemicTypes: AttitudeType[] = ['entertaining', 'accepting', 'rejecting', 'questioning', 'suspending'];
  return epistemicTypes.includes(type as AttitudeType) || isConativeAttitudeType(type);
}

// ============================================================================
// CONATIVE ATTITUDE INTERFACE
// ============================================================================

/**
 * Preference ordering types for ranked alternatives.
 */
export type PreferenceOrdering = 'strict' | 'weak' | 'indifference';

/**
 * ConativeAttitude extends the basic Attitude with conative-specific properties.
 * This captures the practical reasoning aspects of the attitude.
 */
export interface ConativeAttitude {
  /** The conative attitude type */
  readonly type: ConativeAttitudeType;

  /** Strength of the attitude (for graded attitudes) */
  readonly strength?: GradedStrength;

  /**
   * Commitment strength for intentions.
   * 0 = no commitment, 1 = full commitment.
   * Higher values indicate stronger resistance to revision.
   */
  readonly commitmentStrength: number;

  /**
   * Ordered list of alternative content IDs for preferences.
   * Earlier elements are preferred over later elements.
   */
  readonly preferenceOrdering?: string[];

  /**
   * Intensity of desire for desiring/hoping/fearing attitudes.
   * 0 = minimal desire/fear, 1 = maximal desire/fear.
   */
  readonly desireIntensity?: number;

  /**
   * Valence of the attitude (positive for hoping/desiring, negative for fearing).
   */
  readonly valence?: 'positive' | 'negative' | 'neutral';
}

/**
 * Validate that commitmentStrength is in valid range [0, 1]
 */
export function validateCommitmentStrength(value: number): boolean {
  return typeof value === 'number' && value >= 0 && value <= 1 && !Number.isNaN(value);
}

/**
 * Validate that desireIntensity is in valid range [0, 1]
 */
export function validateDesireIntensity(value: number): boolean {
  return typeof value === 'number' && value >= 0 && value <= 1 && !Number.isNaN(value);
}

/**
 * Type guard for ConativeAttitude
 */
export function isConativeAttitude(value: unknown): value is ConativeAttitude {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.type === 'string' &&
    isConativeAttitudeType(obj.type) &&
    typeof obj.commitmentStrength === 'number' &&
    validateCommitmentStrength(obj.commitmentStrength)
  );
}

// ============================================================================
// CONATIVE ATTITUDE CONSTRUCTOR
// ============================================================================

/**
 * Options for constructing a conative attitude.
 */
export interface ConativeAttitudeOptions {
  /** Graded strength of the attitude */
  strength?: GradedStrength;

  /** Commitment strength (required for intending) */
  commitmentStrength?: number;

  /** Preference ordering for preferring attitudes */
  preferenceOrdering?: string[];

  /** Desire intensity for desiring/hoping/fearing */
  desireIntensity?: number;

  /** Valence (positive, negative, or neutral) */
  valence?: 'positive' | 'negative' | 'neutral';
}

/**
 * Construct a conative attitude with appropriate defaults for each type.
 *
 * @param type - The conative attitude type
 * @param options - Additional options
 * @returns A fully constructed ConativeAttitude
 * @throws Error if required options are missing for the given type
 */
export function constructConativeAttitude(
  type: ConativeAttitudeType,
  options: ConativeAttitudeOptions = {}
): ConativeAttitude {
  // Validate and set defaults based on type
  let commitmentStrength: number;
  let valence: 'positive' | 'negative' | 'neutral';

  switch (type) {
    case 'intending':
      // Intending requires commitment
      commitmentStrength = options.commitmentStrength ?? 0.8;
      valence = options.valence ?? 'positive';
      if (!validateCommitmentStrength(commitmentStrength)) {
        throw new Error(`Invalid commitmentStrength for intending: ${commitmentStrength}`);
      }
      break;

    case 'preferring':
      // Preferring has moderate commitment
      commitmentStrength = options.commitmentStrength ?? 0.5;
      valence = options.valence ?? 'neutral';
      break;

    case 'desiring':
      // Desiring has lower commitment than intending
      commitmentStrength = options.commitmentStrength ?? 0.3;
      valence = options.valence ?? 'positive';
      break;

    case 'hoping':
      // Hoping is positive desire with low commitment
      commitmentStrength = options.commitmentStrength ?? 0.2;
      valence = 'positive';
      break;

    case 'fearing':
      // Fearing is negative desire with low commitment
      commitmentStrength = options.commitmentStrength ?? 0.2;
      valence = 'negative';
      break;

    default:
      throw new Error(`Unknown conative attitude type: ${type}`);
  }

  // Validate desireIntensity if provided
  if (options.desireIntensity !== undefined && !validateDesireIntensity(options.desireIntensity)) {
    throw new Error(`Invalid desireIntensity: ${options.desireIntensity}`);
  }

  return {
    type,
    strength: options.strength,
    commitmentStrength,
    preferenceOrdering: options.preferenceOrdering,
    desireIntensity: options.desireIntensity,
    valence,
  };
}

// ============================================================================
// INTENTION TYPE
// ============================================================================

/**
 * Grounding relation for means-end reasoning.
 * Captures how actions or intermediate goals contribute to achieving the intention.
 */
export interface MeansEndRelation {
  /** The grounding relation */
  readonly grounding: Grounding;

  /** Description of how the means contributes to the end */
  readonly contribution: string;

  /**
   * Necessity of this means for the end.
   * 'necessary' = required for the goal
   * 'sufficient' = alone achieves the goal
   * 'contributing' = helps but neither necessary nor sufficient
   */
  readonly necessity: 'necessary' | 'sufficient' | 'contributing';
}

/**
 * Intention represents a committed plan to achieve a goal through specified means.
 * Intentions are characterized by:
 * 1. A goal (what is intended)
 * 2. Means-end relations (how to achieve it)
 * 3. Conditions (prerequisites that must hold)
 * 4. Commitment strength (resistance to revision)
 */
export interface Intention {
  /** Unique identifier for this intention */
  readonly id: string;

  /** The goal content - what is intended to be achieved */
  readonly goal: Content;

  /** Means-end relations - how to achieve the goal */
  readonly meansEnd: MeansEndRelation[];

  /** Prerequisites that must hold for the intention to be executable */
  readonly conditions: string[];

  /** The conative attitude underlying this intention */
  readonly attitude: ConativeAttitude;

  /** When this intention was created */
  readonly createdAt: string;

  /** Current status of the intention */
  readonly status: IntentionStatus;

  /** Optional deadline for the intention */
  readonly deadline?: string;

  /** Optional priority (lower is higher priority) */
  readonly priority?: number;
}

/** Status of an intention */
export type IntentionStatus =
  | 'pending'      // Not yet started
  | 'active'       // Being pursued
  | 'suspended'    // Temporarily paused
  | 'achieved'     // Successfully completed
  | 'abandoned'    // Given up
  | 'superseded';  // Replaced by another intention

/**
 * Type guard for Intention
 */
export function isIntention(value: unknown): value is Intention {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.id === 'string' &&
    typeof obj.goal === 'object' &&
    Array.isArray(obj.meansEnd) &&
    Array.isArray(obj.conditions) &&
    isConativeAttitude(obj.attitude) &&
    obj.attitude.type === 'intending' &&
    typeof obj.createdAt === 'string' &&
    typeof obj.status === 'string'
  );
}

/**
 * Options for creating an intention
 */
export interface CreateIntentionOptions {
  /** Custom ID (generated if not provided) */
  id?: string;

  /** Means-end relations */
  meansEnd?: MeansEndRelation[];

  /** Conditions/prerequisites */
  conditions?: string[];

  /** Commitment strength (0-1) */
  commitmentStrength?: number;

  /** Graded strength */
  strength?: GradedStrength;

  /** Initial status */
  status?: IntentionStatus;

  /** Deadline */
  deadline?: string;

  /** Priority (lower = higher priority) */
  priority?: number;
}

/**
 * Create an intention with the specified goal and options.
 *
 * @param goalContent - The content describing what is intended
 * @param options - Additional options
 * @returns A fully constructed Intention
 */
export function createIntention(
  goalContent: Content | string,
  options: CreateIntentionOptions = {}
): Intention {
  const goal = typeof goalContent === 'string'
    ? constructContent(goalContent, 'propositional')
    : goalContent;

  const attitude = constructConativeAttitude('intending', {
    commitmentStrength: options.commitmentStrength ?? 0.8,
    strength: options.strength,
  });

  return {
    id: options.id ?? `intention_${randomUUID()}`,
    goal,
    meansEnd: options.meansEnd ?? [],
    conditions: options.conditions ?? [],
    attitude,
    createdAt: new Date().toISOString(),
    status: options.status ?? 'pending',
    deadline: options.deadline,
    priority: options.priority,
  };
}

/**
 * Add a means-end relation to an intention.
 */
export function addMeansToIntention(
  intention: Intention,
  meansObjectId: ObjectId,
  contribution: string,
  necessity: 'necessary' | 'sufficient' | 'contributing' = 'contributing',
  groundingStrength?: GradedStrength
): Intention {
  // Create a grounding from the means to the goal
  const intentionObjectId = intention.id as unknown as ObjectId;
  const grounding = constructGrounding(
    meansObjectId,
    intentionObjectId,
    'enabling',
    groundingStrength
  );

  const meansEndRelation: MeansEndRelation = {
    grounding,
    contribution,
    necessity,
  };

  return {
    ...intention,
    meansEnd: [...intention.meansEnd, meansEndRelation],
  };
}

/**
 * Add a condition to an intention.
 */
export function addConditionToIntention(
  intention: Intention,
  condition: string
): Intention {
  return {
    ...intention,
    conditions: [...intention.conditions, condition],
  };
}

/**
 * Update the status of an intention.
 */
export function updateIntentionStatus(
  intention: Intention,
  status: IntentionStatus
): Intention {
  return {
    ...intention,
    status,
  };
}

/**
 * Check if an intention's conditions are satisfied given a set of beliefs.
 */
export function areConditionsSatisfied(
  intention: Intention,
  satisfiedConditions: Set<string>
): boolean {
  return intention.conditions.every(condition => satisfiedConditions.has(condition));
}

// ============================================================================
// PREFERENCE TYPE
// ============================================================================

/**
 * Preference represents a ranking of alternatives.
 * Preferences are characterized by:
 * 1. A set of alternatives
 * 2. An ordering type (strict, weak, or indifference)
 * 3. Whether transitivity holds
 */
export interface Preference {
  /** Unique identifier for this preference */
  readonly id: string;

  /** The ranked alternatives (Content objects) */
  readonly alternatives: Content[];

  /** Type of ordering */
  readonly ordering: PreferenceOrdering;

  /**
   * Whether the preference is transitive.
   * If true: A > B and B > C implies A > C
   */
  readonly transitivity: boolean;

  /** The conative attitude underlying this preference */
  readonly attitude: ConativeAttitude;

  /** When this preference was created */
  readonly createdAt: string;

  /** Dimension on which alternatives are compared (e.g., 'utility', 'aesthetics') */
  readonly dimension?: string;
}

/**
 * Type guard for Preference
 */
export function isPreference(value: unknown): value is Preference {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.id === 'string' &&
    Array.isArray(obj.alternatives) &&
    typeof obj.ordering === 'string' &&
    typeof obj.transitivity === 'boolean' &&
    isConativeAttitude(obj.attitude) &&
    obj.attitude.type === 'preferring' &&
    typeof obj.createdAt === 'string'
  );
}

/**
 * Options for creating a preference
 */
export interface CreatePreferenceOptions {
  /** Custom ID (generated if not provided) */
  id?: string;

  /** Ordering type */
  ordering?: PreferenceOrdering;

  /** Whether transitivity holds */
  transitivity?: boolean;

  /** Commitment strength (0-1) */
  commitmentStrength?: number;

  /** Graded strength */
  strength?: GradedStrength;

  /** Dimension of comparison */
  dimension?: string;
}

/**
 * Create a preference over the given alternatives.
 *
 * @param alternatives - The alternatives in preference order (most preferred first)
 * @param options - Additional options
 * @returns A fully constructed Preference
 */
export function createPreference(
  alternatives: (Content | string)[],
  options: CreatePreferenceOptions = {}
): Preference {
  const contentAlternatives = alternatives.map(alt =>
    typeof alt === 'string' ? constructContent(alt, 'propositional') : alt
  );

  const preferenceOrderingIds = contentAlternatives.map(c => c.id);

  const attitude = constructConativeAttitude('preferring', {
    commitmentStrength: options.commitmentStrength ?? 0.5,
    strength: options.strength,
    preferenceOrdering: preferenceOrderingIds,
  });

  return {
    id: options.id ?? `preference_${randomUUID()}`,
    alternatives: contentAlternatives,
    ordering: options.ordering ?? 'strict',
    transitivity: options.transitivity ?? true,
    attitude,
    createdAt: new Date().toISOString(),
    dimension: options.dimension,
  };
}

/**
 * Check if alternative A is preferred to alternative B.
 */
export function isPreferred(
  preference: Preference,
  alternativeA: Content | string,
  alternativeB: Content | string
): boolean {
  const aId = typeof alternativeA === 'string' ? alternativeA : alternativeA.id;
  const bId = typeof alternativeB === 'string' ? alternativeB : alternativeB.id;

  const aIndex = preference.alternatives.findIndex(alt => alt.id === aId);
  const bIndex = preference.alternatives.findIndex(alt => alt.id === bId);

  if (aIndex === -1 || bIndex === -1) {
    return false; // One or both alternatives not in preference
  }

  switch (preference.ordering) {
    case 'strict':
      return aIndex < bIndex;
    case 'weak':
      return aIndex <= bIndex;
    case 'indifference':
      return true; // All alternatives are equally preferred
  }
}

/**
 * Get the most preferred alternative.
 */
export function getMostPreferred(preference: Preference): Content | undefined {
  if (preference.alternatives.length === 0) {
    return undefined;
  }
  return preference.alternatives[0];
}

/**
 * Get the least preferred alternative.
 */
export function getLeastPreferred(preference: Preference): Content | undefined {
  if (preference.alternatives.length === 0) {
    return undefined;
  }
  return preference.alternatives[preference.alternatives.length - 1];
}

/**
 * Check if a preference relation is transitive.
 * For a transitive preference: if A > B and B > C, then A > C.
 */
export function checkTransitivity(preference: Preference): boolean {
  if (!preference.transitivity || preference.ordering === 'indifference') {
    return true; // No transitivity requirement or all equal
  }

  // For strict and weak orderings with transitivity, the linear order is inherently transitive
  // by construction (array index ordering)
  return true;
}

/**
 * Validate that a preference ordering is consistent.
 * Returns an array of inconsistency descriptions if any are found.
 */
export function validatePreferenceConsistency(preference: Preference): string[] {
  const inconsistencies: string[] = [];

  // Check for duplicate alternatives
  const ids = preference.alternatives.map(a => a.id);
  const uniqueIds = new Set(ids);
  if (uniqueIds.size !== ids.length) {
    inconsistencies.push('Preference contains duplicate alternatives');
  }

  // Check transitivity if required
  if (preference.transitivity && !checkTransitivity(preference)) {
    inconsistencies.push('Preference violates transitivity');
  }

  return inconsistencies;
}

// ============================================================================
// GOAL TYPE
// ============================================================================

/**
 * Goal represents a desired state with achievement criteria.
 * Goals are characterized by:
 * 1. A desired state (what we want to achieve)
 * 2. Achievement criteria (how we know it's achieved)
 * 3. Priority (importance relative to other goals)
 */
export interface Goal {
  /** Unique identifier for this goal */
  readonly id: string;

  /** The desired state to achieve */
  readonly desiredState: Content;

  /** Criteria for determining achievement */
  readonly achievementCriteria: string[];

  /** Priority (0 = highest, larger = lower priority) */
  readonly priority: number;

  /** The conative attitude underlying this goal */
  readonly attitude: ConativeAttitude;

  /** When this goal was created */
  readonly createdAt: string;

  /** Current status of the goal */
  readonly status: GoalStatus;

  /** Parent goal ID if this is a subgoal */
  readonly parentGoalId?: string;

  /** IDs of subgoals */
  readonly subgoalIds: string[];
}

/** Status of a goal */
export type GoalStatus =
  | 'active'       // Currently being pursued
  | 'achieved'     // Successfully completed
  | 'failed'       // Could not be achieved
  | 'suspended'    // Temporarily paused
  | 'abandoned';   // Given up

/**
 * Type guard for Goal
 */
export function isGoal(value: unknown): value is Goal {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.id === 'string' &&
    typeof obj.desiredState === 'object' &&
    Array.isArray(obj.achievementCriteria) &&
    typeof obj.priority === 'number' &&
    isConativeAttitude(obj.attitude) &&
    (obj.attitude.type === 'desiring' || obj.attitude.type === 'hoping') &&
    typeof obj.createdAt === 'string' &&
    typeof obj.status === 'string' &&
    Array.isArray(obj.subgoalIds)
  );
}

/**
 * Options for creating a goal
 */
export interface CreateGoalOptions {
  /** Custom ID (generated if not provided) */
  id?: string;

  /** Achievement criteria */
  achievementCriteria?: string[];

  /** Priority (default 0 = highest) */
  priority?: number;

  /** Initial status */
  status?: GoalStatus;

  /** Parent goal ID if this is a subgoal */
  parentGoalId?: string;

  /** Subgoal IDs */
  subgoalIds?: string[];

  /** Desire intensity (0-1) */
  desireIntensity?: number;

  /** Commitment strength (0-1) */
  commitmentStrength?: number;

  /** Graded strength */
  strength?: GradedStrength;

  /** Whether to use hoping (default) or desiring attitude */
  attitudeType?: 'desiring' | 'hoping';
}

/**
 * Create a goal with the specified desired state and options.
 *
 * @param desiredState - The content describing the desired state
 * @param options - Additional options
 * @returns A fully constructed Goal
 */
export function createGoal(
  desiredState: Content | string,
  options: CreateGoalOptions = {}
): Goal {
  const state = typeof desiredState === 'string'
    ? constructContent(desiredState, 'propositional')
    : desiredState;

  const attitudeType = options.attitudeType ?? 'desiring';
  const attitude = constructConativeAttitude(attitudeType, {
    commitmentStrength: options.commitmentStrength ?? 0.5,
    strength: options.strength,
    desireIntensity: options.desireIntensity ?? 0.7,
  });

  return {
    id: options.id ?? `goal_${randomUUID()}`,
    desiredState: state,
    achievementCriteria: options.achievementCriteria ?? [],
    priority: options.priority ?? 0,
    attitude,
    createdAt: new Date().toISOString(),
    status: options.status ?? 'active',
    parentGoalId: options.parentGoalId,
    subgoalIds: options.subgoalIds ?? [],
  };
}

/**
 * Add an achievement criterion to a goal.
 */
export function addCriterionToGoal(goal: Goal, criterion: string): Goal {
  return {
    ...goal,
    achievementCriteria: [...goal.achievementCriteria, criterion],
  };
}

/**
 * Add a subgoal to a goal.
 */
export function addSubgoal(goal: Goal, subgoalId: string): Goal {
  return {
    ...goal,
    subgoalIds: [...goal.subgoalIds, subgoalId],
  };
}

/**
 * Update the status of a goal.
 */
export function updateGoalStatus(goal: Goal, status: GoalStatus): Goal {
  return {
    ...goal,
    status,
  };
}

/**
 * Check if a goal is achieved based on satisfied criteria.
 */
export function isGoalAchieved(
  goal: Goal,
  satisfiedCriteria: Set<string>
): boolean {
  if (goal.achievementCriteria.length === 0) {
    return false; // No criteria means we can't determine achievement
  }
  return goal.achievementCriteria.every(criterion => satisfiedCriteria.has(criterion));
}

/**
 * Compute goal progress as percentage of satisfied criteria.
 */
export function computeGoalProgress(
  goal: Goal,
  satisfiedCriteria: Set<string>
): number {
  if (goal.achievementCriteria.length === 0) {
    return 0;
  }
  const satisfied = goal.achievementCriteria.filter(c => satisfiedCriteria.has(c)).length;
  return satisfied / goal.achievementCriteria.length;
}

// ============================================================================
// DESIRE TYPE
// ============================================================================

/**
 * Desire represents a want without the commitment of an intention.
 * Desires are weaker than intentions - they represent what the agent wants
 * but has not committed to pursuing.
 */
export interface Desire {
  /** Unique identifier for this desire */
  readonly id: string;

  /** The desired content */
  readonly content: Content;

  /** The conative attitude underlying this desire */
  readonly attitude: ConativeAttitude;

  /** When this desire was created */
  readonly createdAt: string;

  /** Whether this is a positive (hoping) or negative (fearing) desire */
  readonly valence: 'positive' | 'negative';
}

/**
 * Type guard for Desire
 */
export function isDesire(value: unknown): value is Desire {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.id === 'string' &&
    typeof obj.content === 'object' &&
    isConativeAttitude(obj.attitude) &&
    ['desiring', 'hoping', 'fearing'].includes(obj.attitude.type) &&
    typeof obj.createdAt === 'string' &&
    typeof obj.valence === 'string'
  );
}

/**
 * Create a desire (positive want).
 */
export function createDesire(
  content: Content | string,
  options: {
    id?: string;
    desireIntensity?: number;
    commitmentStrength?: number;
    strength?: GradedStrength;
  } = {}
): Desire {
  const desiredContent = typeof content === 'string'
    ? constructContent(content, 'propositional')
    : content;

  const attitude = constructConativeAttitude('desiring', {
    desireIntensity: options.desireIntensity ?? 0.5,
    commitmentStrength: options.commitmentStrength ?? 0.3,
    strength: options.strength,
  });

  return {
    id: options.id ?? `desire_${randomUUID()}`,
    content: desiredContent,
    attitude,
    createdAt: new Date().toISOString(),
    valence: 'positive',
  };
}

/**
 * Create a hope (positive want with positive expectation).
 */
export function createHope(
  content: Content | string,
  options: {
    id?: string;
    desireIntensity?: number;
    commitmentStrength?: number;
    strength?: GradedStrength;
  } = {}
): Desire {
  const desiredContent = typeof content === 'string'
    ? constructContent(content, 'propositional')
    : content;

  const attitude = constructConativeAttitude('hoping', {
    desireIntensity: options.desireIntensity ?? 0.5,
    commitmentStrength: options.commitmentStrength ?? 0.2,
    strength: options.strength,
  });

  return {
    id: options.id ?? `hope_${randomUUID()}`,
    content: desiredContent,
    attitude,
    createdAt: new Date().toISOString(),
    valence: 'positive',
  };
}

/**
 * Create a fear (negative desire).
 */
export function createFear(
  content: Content | string,
  options: {
    id?: string;
    desireIntensity?: number;
    commitmentStrength?: number;
    strength?: GradedStrength;
  } = {}
): Desire {
  const fearedContent = typeof content === 'string'
    ? constructContent(content, 'propositional')
    : content;

  const attitude = constructConativeAttitude('fearing', {
    desireIntensity: options.desireIntensity ?? 0.5,
    commitmentStrength: options.commitmentStrength ?? 0.2,
    strength: options.strength,
  });

  return {
    id: options.id ?? `fear_${randomUUID()}`,
    content: fearedContent,
    attitude,
    createdAt: new Date().toISOString(),
    valence: 'negative',
  };
}

// ============================================================================
// BDI AGENT STATE
// ============================================================================

/**
 * BDI (Belief-Desire-Intention) Agent State captures the full practical reasoning
 * state of an agent.
 */
export interface BDIAgentState {
  /** Agent identifier */
  readonly agentId: string;

  /** Agent name */
  readonly agentName: string;

  /** Agent's beliefs as a coherence network */
  readonly beliefs: CoherenceNetwork;

  /** Agent's desires (including hopes and fears) */
  readonly desires: Desire[];

  /** Agent's intentions */
  readonly intentions: Intention[];

  /** Agent's goals */
  readonly goals: Goal[];

  /** Agent's preferences */
  readonly preferences: Preference[];

  /** When this state snapshot was created */
  readonly createdAt: string;
}

/**
 * Type guard for BDIAgentState
 */
export function isBDIAgentState(value: unknown): value is BDIAgentState {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.agentId === 'string' &&
    typeof obj.agentName === 'string' &&
    typeof obj.beliefs === 'object' &&
    Array.isArray(obj.desires) &&
    Array.isArray(obj.intentions) &&
    Array.isArray(obj.goals) &&
    Array.isArray(obj.preferences) &&
    typeof obj.createdAt === 'string'
  );
}

/**
 * Options for creating a BDI agent state
 */
export interface CreateBDIAgentOptions {
  /** Initial beliefs (as epistemic objects) */
  initialBeliefs?: EpistemicObject[];

  /** Initial desires */
  initialDesires?: Desire[];

  /** Initial intentions */
  initialIntentions?: Intention[];

  /** Initial goals */
  initialGoals?: Goal[];

  /** Initial preferences */
  initialPreferences?: Preference[];
}

/**
 * Create a BDI agent state.
 */
export function createBDIAgentState(
  agentId: string,
  agentName: string,
  options: CreateBDIAgentOptions = {}
): BDIAgentState {
  const beliefs = constructCoherenceNetwork(
    options.initialBeliefs ?? [],
    [],
    { name: `${agentName}'s Beliefs`, validate: false }
  );

  return {
    agentId,
    agentName,
    beliefs,
    desires: options.initialDesires ?? [],
    intentions: options.initialIntentions ?? [],
    goals: options.initialGoals ?? [],
    preferences: options.initialPreferences ?? [],
    createdAt: new Date().toISOString(),
  };
}

/**
 * Add a belief to an agent's state.
 */
export function addBelief(
  state: BDIAgentState,
  belief: EpistemicObject
): BDIAgentState {
  const newBeliefs = constructCoherenceNetwork(
    [...state.beliefs.objects.values(), belief],
    [...state.beliefs.groundings.values()],
    { name: state.beliefs.name, validate: false }
  );

  return {
    ...state,
    beliefs: newBeliefs,
  };
}

/**
 * Add a desire to an agent's state.
 */
export function addDesireToAgent(state: BDIAgentState, desire: Desire): BDIAgentState {
  return {
    ...state,
    desires: [...state.desires, desire],
  };
}

/**
 * Add an intention to an agent's state.
 */
export function addIntentionToAgent(state: BDIAgentState, intention: Intention): BDIAgentState {
  return {
    ...state,
    intentions: [...state.intentions, intention],
  };
}

/**
 * Add a goal to an agent's state.
 */
export function addGoalToAgent(state: BDIAgentState, goal: Goal): BDIAgentState {
  return {
    ...state,
    goals: [...state.goals, goal],
  };
}

/**
 * Add a preference to an agent's state.
 */
export function addPreferenceToAgent(state: BDIAgentState, preference: Preference): BDIAgentState {
  return {
    ...state,
    preferences: [...state.preferences, preference],
  };
}

// ============================================================================
// PRACTICAL REASONING
// ============================================================================

/**
 * Result of practical reasoning - selecting an action based on goals, beliefs, and intentions.
 */
export interface PracticalReasoningResult {
  /** Whether the reasoning found a coherent action */
  readonly coherent: boolean;

  /** The recommended intention (if any) */
  readonly recommendedIntention: Intention | null;

  /** Explanations for the reasoning */
  readonly reasoning: string[];

  /** Conflicts detected during reasoning */
  readonly conflicts: string[];

  /** Overall coherence score (0-1) */
  readonly coherenceScore: number;
}

/**
 * Evaluate practical coherence of an agent's state.
 * This is practical reasoning: deciding what to do based on beliefs, desires, and intentions.
 *
 * @param state - The agent's BDI state
 * @param context - Evaluation context
 * @returns Practical reasoning result
 */
export function evaluatePracticalCoherence(
  state: BDIAgentState,
  context?: EvaluationContext
): PracticalReasoningResult {
  const reasoning: string[] = [];
  const conflicts: string[] = [];

  // Check if there are any intentions
  if (state.intentions.length === 0) {
    reasoning.push('No intentions to evaluate');
    return {
      coherent: true,
      recommendedIntention: null,
      reasoning,
      conflicts,
      coherenceScore: 1.0,
    };
  }

  // Get active intentions
  const activeIntentions = state.intentions.filter(i =>
    i.status === 'active' || i.status === 'pending'
  );

  if (activeIntentions.length === 0) {
    reasoning.push('No active intentions');
    return {
      coherent: true,
      recommendedIntention: null,
      reasoning,
      conflicts,
      coherenceScore: 1.0,
    };
  }

  // Check for conflicting intentions
  for (let i = 0; i < activeIntentions.length; i++) {
    for (let j = i + 1; j < activeIntentions.length; j++) {
      const intentionA = activeIntentions[i];
      const intentionB = activeIntentions[j];

      // Check if conditions conflict
      const overlappingConditions = intentionA.conditions.filter(c =>
        intentionB.conditions.includes(c)
      );

      if (overlappingConditions.length > 0) {
        reasoning.push(
          `Intentions ${intentionA.id} and ${intentionB.id} share conditions: ${overlappingConditions.join(', ')}`
        );
      }
    }
  }

  // Sort by priority (lower = higher priority) and commitment strength
  const sortedIntentions = [...activeIntentions].sort((a, b) => {
    const priorityDiff = (a.priority ?? Infinity) - (b.priority ?? Infinity);
    if (priorityDiff !== 0) return priorityDiff;
    return b.attitude.commitmentStrength - a.attitude.commitmentStrength;
  });

  const recommendedIntention = sortedIntentions[0];
  reasoning.push(
    `Recommended intention: ${recommendedIntention.id} with priority ${recommendedIntention.priority ?? 'unset'} and commitment ${recommendedIntention.attitude.commitmentStrength}`
  );

  // Compute coherence score based on conflicts and commitment
  let coherenceScore = 1.0;
  coherenceScore -= conflicts.length * 0.1;
  coherenceScore = Math.max(0, coherenceScore);

  return {
    coherent: conflicts.length === 0,
    recommendedIntention,
    reasoning,
    conflicts,
    coherenceScore,
  };
}

/**
 * Check if an intention is achievable given current beliefs.
 *
 * @param intention - The intention to check
 * @param beliefs - The agent's belief network
 * @returns Whether the intention is achievable and why/why not
 */
export function isIntentionAchievable(
  intention: Intention,
  beliefs: CoherenceNetwork
): { achievable: boolean; reasons: string[] } {
  const reasons: string[] = [];

  // Check if all conditions are believed to hold
  for (const condition of intention.conditions) {
    const conditionBelieved = Array.from(beliefs.objects.values()).some(obj =>
      obj.attitude.type === 'accepting' &&
      typeof obj.content.value === 'string' &&
      obj.content.value.includes(condition)
    );

    if (!conditionBelieved) {
      reasons.push(`Condition not believed: ${condition}`);
    }
  }

  // Check if means-end relations are grounded
  for (const meansEnd of intention.meansEnd) {
    if (meansEnd.necessity === 'necessary') {
      const meansExists = beliefs.objects.has(meansEnd.grounding.from);
      if (!meansExists) {
        reasons.push(`Necessary means not available: ${meansEnd.contribution}`);
      }
    }
  }

  return {
    achievable: reasons.length === 0,
    reasons,
  };
}

/**
 * Derive an intention from a goal.
 * This creates an intention to achieve the goal, inheriting the goal's criteria as conditions.
 *
 * @param goal - The goal to derive an intention from
 * @param commitmentStrength - Commitment strength for the intention
 * @returns A new intention derived from the goal
 */
export function deriveIntentionFromGoal(
  goal: Goal,
  commitmentStrength: number = 0.8
): Intention {
  return createIntention(goal.desiredState, {
    conditions: goal.achievementCriteria,
    commitmentStrength,
    priority: goal.priority,
    strength: goal.attitude.strength,
  });
}

// ============================================================================
// INTEGRATION WITH EPISTEMIC OBJECTS
// ============================================================================

/**
 * Convert an intention to an epistemic object for inclusion in a coherence network.
 */
export function intentionToEpistemicObject(intention: Intention): EpistemicObject {
  const content = constructContent(
    {
      type: 'intention',
      goal: intention.goal,
      conditions: intention.conditions,
      deadline: intention.deadline,
    },
    'structured'
  );

  const attitude = constructAttitude(
    'accepting',
    intention.attitude.strength ?? { value: intention.attitude.commitmentStrength, basis: 'estimated' }
  );

  return constructEpistemicObject(content, attitude, {
    source: { type: 'agent', description: 'Agent intention' },
    status: intention.status === 'achieved' ? 'active' :
      intention.status === 'abandoned' ? 'retracted' : 'active',
  });
}

/**
 * Convert a goal to an epistemic object for inclusion in a coherence network.
 */
export function goalToEpistemicObject(goal: Goal): EpistemicObject {
  const content = constructContent(
    {
      type: 'goal',
      desiredState: goal.desiredState,
      achievementCriteria: goal.achievementCriteria,
      priority: goal.priority,
    },
    'structured'
  );

  const attitude = constructAttitude(
    'accepting',
    goal.attitude.strength ?? { value: goal.attitude.desireIntensity ?? 0.5, basis: 'estimated' }
  );

  return constructEpistemicObject(content, attitude, {
    source: { type: 'agent', description: 'Agent goal' },
    status: goal.status === 'achieved' ? 'active' :
      goal.status === 'failed' || goal.status === 'abandoned' ? 'defeated' : 'active',
  });
}

/**
 * Convert a preference to an epistemic object for inclusion in a coherence network.
 */
export function preferenceToEpistemicObject(preference: Preference): EpistemicObject {
  const content = constructContent(
    {
      type: 'preference',
      alternatives: preference.alternatives,
      ordering: preference.ordering,
      transitivity: preference.transitivity,
      dimension: preference.dimension,
    },
    'structured'
  );

  const attitude = constructAttitude(
    'accepting',
    preference.attitude.strength ?? { value: preference.attitude.commitmentStrength, basis: 'estimated' }
  );

  return constructEpistemicObject(content, attitude, {
    source: { type: 'agent', description: 'Agent preference' },
    status: 'active',
  });
}

// ============================================================================
// EXPORTS SUMMARY
// ============================================================================

// Types are exported inline with their definitions above
// The following are the main public exports:

export {
  // Re-export relevant types from universal_coherence for convenience
  type Content,
  type ContentType,
  type GradedStrength,
  type EpistemicObject,
  type Grounding,
  type ObjectId,
  type CoherenceNetwork,
  type EvaluationContext,
};
