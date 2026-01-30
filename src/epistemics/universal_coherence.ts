/**
 * @fileoverview Universal Coherence System
 *
 * Implements universal constructors for building ANY epistemic structure from primitives,
 * with practical presets for common domains.
 *
 * Based on the six universal epistemic primitives:
 * 1. Distinguishability (Delta) - The capacity to differentiate
 * 2. Content (C) - That which can be distinguished
 * 3. Grounding (G) - The "in virtue of" relation
 * 4. Attitude (A) - Epistemic stance toward content
 * 5. Agent (a) - Locus of epistemic states
 * 6. Context (K) - Situation of evaluation
 *
 * And the four primitive operations:
 * 1. CONSTRUCT - Build complex from simple
 * 2. RELATE - Establish grounding connections
 * 3. EVALUATE - Assess status given relations
 * 4. REVISE - Update under new information
 *
 * @packageDocumentation
 */

import { randomUUID, createHash } from 'node:crypto';
import type { ConfidenceValue } from './confidence.js';
import { absent, deterministic, bounded } from './confidence.js';
import type { Claim, ClaimId, ClaimSource, ClaimStatus } from './types.js';
import { createClaimId } from './types.js';
import type { IEvidenceLedger, EvidenceEntry, SessionId } from './evidence_ledger.js';

// ============================================================================
// SCHEMA VERSION
// ============================================================================

/** Current schema version for all universal coherence types */
export const UNIVERSAL_COHERENCE_SCHEMA_VERSION = '1.0.0';

// ============================================================================
// BRANDED TYPES (TYPE-SAFE IDS)
// ============================================================================

/** Branded type for content IDs */
export type ContentId = string & { readonly __brand: 'ContentId' };

/** Branded type for epistemic object IDs */
export type ObjectId = string & { readonly __brand: 'ObjectId' };

/** Branded type for grounding IDs */
export type GroundingId = string & { readonly __brand: 'GroundingId' };

/** Branded type for network IDs */
export type NetworkId = string & { readonly __brand: 'NetworkId' };

/** Branded type for agent IDs */
export type AgentId = string & { readonly __brand: 'AgentId' };

// ============================================================================
// ID CONSTRUCTORS
// ============================================================================

/** Generate a unique ContentId */
export function createContentId(prefix = 'content'): ContentId {
  return `${prefix}_${randomUUID()}` as ContentId;
}

/** Generate a unique ObjectId */
export function createObjectId(prefix = 'obj'): ObjectId {
  return `${prefix}_${randomUUID()}` as ObjectId;
}

/** Generate a unique GroundingId */
export function createGroundingId(prefix = 'grounding'): GroundingId {
  return `${prefix}_${randomUUID()}` as GroundingId;
}

/** Generate a unique NetworkId */
export function createNetworkId(prefix = 'network'): NetworkId {
  return `${prefix}_${randomUUID()}` as NetworkId;
}

/** Generate a unique AgentId */
export function createAgentId(prefix = 'agent'): AgentId {
  return `${prefix}_${randomUUID()}` as AgentId;
}

// ============================================================================
// PRIMITIVE TYPES
// ============================================================================

/** Types of content that can be distinguished */
export type ContentType =
  | 'propositional' // "The cat is on the mat" - truth-evaluable
  | 'perceptual' // <visual field state> - sensory
  | 'procedural' // <how to do X> - know-how
  | 'indexical' // <this, here, now> - context-dependent
  | 'interrogative' // "Is X the case?" - questions
  | 'imperative' // "Do X" - commands
  | 'structured'; // Complex/composite content

/** Schema for structured content */
export interface ContentSchema {
  readonly version: string;
  readonly type: string;
  readonly fields?: Record<string, string>;
}

/**
 * Content - anything that can be the object of an epistemic state.
 * More primitive than "proposition" - no logical structure required.
 */
export interface Content {
  /** Unique identifier for this content */
  readonly id: ContentId;

  /** The distinguishing data - what makes this content unique */
  readonly value: unknown;

  /** Content type for structural classification */
  readonly contentType: ContentType;

  /** Optional schema for structured content */
  readonly schema?: ContentSchema;

  /** Hash for content-addressable identity */
  readonly hash: string;
}

/** Primitive attitude types */
export type AttitudeType =
  | 'entertaining' // C is before the mind
  | 'accepting' // C is taken to hold
  | 'rejecting' // C is taken not to hold
  | 'questioning' // C's status is open
  | 'suspending'; // C's status is deliberately deferred

/** Basis for strength values */
export type StrengthBasis =
  | 'measured' // Empirically measured
  | 'derived' // Computed from other values
  | 'estimated' // Heuristic estimate
  | 'absent'; // No strength information

/** Graded strength for continuous attitudes */
export interface GradedStrength {
  /** Numeric strength in [0, 1] */
  readonly value: number;

  /** How the strength value was determined */
  readonly basis: StrengthBasis;
}

/**
 * Attitude - epistemic stance toward content.
 * How an agent relates to content epistemically.
 */
export interface Attitude {
  /** Type of attitude */
  readonly type: AttitudeType;

  /** Strength of attitude (for graded attitudes) */
  readonly strength?: GradedStrength;
}

/** Types of agents */
export type AgentType =
  | 'human' // Individual human
  | 'ai' // AI system
  | 'collective' // Group (jury, committee, community)
  | 'idealized'; // Theoretical reasoner

/** Trust levels for agents */
export type TrustLevel = 'untrusted' | 'low' | 'medium' | 'high' | 'authoritative';

/**
 * Agent - locus of epistemic states.
 * Anything that can hold attitudes toward contents.
 */
export interface Agent {
  /** Unique identifier for this agent */
  readonly id: AgentId;

  /** Agent type */
  readonly type: AgentType;

  /** Display name */
  readonly name: string;

  /** Version/capability information */
  readonly version?: string;

  /** Trust level for this agent */
  readonly trustLevel?: TrustLevel;
}

/** Types of grounding relations */
export type GroundingType =
  | 'evidential' // Evidence supports conclusion
  | 'explanatory' // Explanation grounds explanandum
  | 'constitutive' // Parts constitute whole
  | 'inferential' // Premise grounds conclusion
  | 'testimonial' // Testimony grounds belief
  | 'perceptual'; // Perception grounds belief

/** Extended grounding types including defeat */
export type ExtendedGroundingType =
  | GroundingType
  | 'full' // Y holds entirely in virtue of X
  | 'partial' // Y holds partially in virtue of X
  | 'enabling' // X enables Y to hold
  | 'undermining' // X grounds the falsity of Y (defeat)
  | 'rebutting' // X directly contradicts Y (defeat)
  | 'undercutting'; // X attacks the grounding of Y (defeat)

/** Strength of a grounding relation */
export interface GroundingStrength {
  /** Numeric strength in [0, 1] */
  readonly value: number;

  /** Basis for strength */
  readonly basis: 'logical' | 'evidential' | 'testimonial' | 'inferential' | 'stipulated';
}

/**
 * Grounding - the "in virtue of" relation.
 * X grounds Y means Y holds (partially) because of X.
 */
export interface Grounding {
  /** Unique identifier */
  readonly id: GroundingId;

  /** The grounding object (what provides the ground) - ObjectId */
  readonly from: ObjectId;

  /** The grounded object (what is grounded) - ObjectId */
  readonly to: ObjectId;

  /** Type of grounding relation */
  readonly type: ExtendedGroundingType;

  /** Strength of the grounding */
  readonly strength: GradedStrength;

  /** Whether this grounding is active */
  readonly active?: boolean;

  /** Explanation of why this grounding holds */
  readonly explanation?: string;
}

/**
 * Abstraction level - position in a grounding hierarchy.
 * Objects at higher levels are grounded in objects at lower levels.
 */
export interface AbstractionLevel {
  /** Level name */
  readonly name: string;

  /** Numeric position (0 = most fundamental) */
  readonly position: number;

  /** Entrenchment - resistance to revision [0, 1] */
  readonly entrenchment: number;

  /** Constraints on objects at this level */
  readonly constraints?: LevelConstraints;
}

/** Constraints on what can exist at a level */
export interface LevelConstraints {
  /** Allowed content types */
  readonly allowedContentTypes?: ContentType[];

  /** Required grounding depth */
  readonly requiredGroundingDepth?: number;

  /** Maximum objects at this level */
  readonly maxObjects?: number;

  /** Custom validation function name */
  readonly customValidator?: string;
}

/** Status of an epistemic object */
export type ObjectStatus =
  | 'active' // Currently held
  | 'defeated' // Invalidated by defeater
  | 'suspended' // Temporarily suspended
  | 'superseded' // Replaced by newer object
  | 'retracted'; // Explicitly withdrawn

/** Description of the source of an epistemic object */
export interface SourceDescriptor {
  readonly type: string;
  readonly description: string;
  readonly version?: string;
}

/** Metadata attached to epistemic objects */
export interface EpistemicMetadata {
  /** When the object was created */
  readonly createdAt: string;

  /** Source that created this object */
  readonly source: SourceDescriptor;

  /** Current status */
  readonly status: ObjectStatus;

  /** Revision history */
  readonly revisions?: RevisionEntry[];
}

/** Entry in revision history */
export interface RevisionEntry {
  readonly timestamp: string;
  readonly reason: string;
  readonly previousStatus: ObjectStatus;
}

/**
 * An epistemic object - the fundamental unit of knowledge.
 * Constructed from content + attitude + optional grounding.
 */
export interface EpistemicObject {
  /** Unique identifier */
  readonly id: ObjectId;

  /** The content this object is about */
  readonly content: Content;

  /** The attitude toward the content */
  readonly attitude: Attitude;

  /** Direct groundings for this object */
  readonly groundings: GroundingId[];

  /** Abstraction level if assigned */
  readonly level?: AbstractionLevel;

  /** Metadata for tracking and debugging */
  readonly metadata: EpistemicMetadata;
}

// ============================================================================
// COHERENCE NETWORK TYPES
// ============================================================================

/** Types of coherence rules */
export type CoherenceRuleType =
  | 'no_contradictions' // Objects with accepting attitudes must not conflict
  | 'grounding_acyclicity' // No circular grounding (unless allowed)
  | 'level_grounding' // Objects at level N must be grounded in level < N
  | 'minimum_grounding' // Objects must have minimum grounding strength
  | 'coverage' // All objects must be connected
  | 'entrenchment_ordering' // Higher levels have lower entrenchment
  | 'custom'; // Custom rule

/** A rule for checking coherence */
export interface CoherenceRule {
  /** Rule identifier */
  readonly id: string;

  /** Human-readable description */
  readonly description: string;

  /** Rule type */
  readonly type: CoherenceRuleType;

  /** Severity of violations */
  readonly severity: 'error' | 'warning' | 'info';

  /** Parameters for the rule */
  readonly params?: Record<string, unknown>;
}

/** Configuration for a coherence network */
export interface NetworkConfig {
  /** Grounding direction: 'up' (levels ground higher), 'down' (higher grounds lower) */
  readonly groundingDirection: 'up' | 'down' | 'bidirectional';

  /** Whether to allow cycles in grounding */
  readonly allowCycles: boolean;

  /** Maximum network size */
  readonly maxSize?: number;

  /** Coherence checking rules */
  readonly coherenceRules: CoherenceRule[];

  /** Default entrenchment values by level */
  readonly defaultEntrenchment?: number[];
}

/** A coherence violation */
export interface CoherenceViolation {
  /** Which rule was violated */
  readonly rule: CoherenceRule;

  /** Objects involved in the violation */
  readonly objects: ObjectId[];

  /** Human-readable explanation */
  readonly explanation: string;

  /** Suggested remediation */
  readonly remediation?: string;
}

/** Status of coherence for a network */
export interface CoherenceStatus {
  /** Whether the network is coherent */
  readonly coherent: boolean;

  /** Overall coherence score [0, 1] */
  readonly score: number;

  /** List of violations */
  readonly violations: CoherenceViolation[];

  /** When this status was computed */
  readonly computedAt: string;
}

/**
 * Coherence Network - a set of objects with grounding relations.
 * The fundamental structure for organized knowledge.
 */
export interface CoherenceNetwork {
  /** Unique identifier */
  readonly id: NetworkId;

  /** Name of this network */
  readonly name: string;

  /** All objects in the network */
  readonly objects: Map<ObjectId, EpistemicObject>;

  /** All groundings in the network */
  readonly groundings: Map<GroundingId, Grounding>;

  /** Abstraction levels (if hierarchical) */
  readonly levels?: AbstractionLevel[];

  /** Network configuration */
  readonly config: NetworkConfig;

  /** Coherence rules */
  readonly rules: CoherenceRule[];

  /** Current coherence status */
  readonly coherenceStatus: CoherenceStatus;
}

// ============================================================================
// EVALUATION TYPES
// ============================================================================

/** Grounding status of an object */
export type GroundingStatus = 'grounded' | 'partially_grounded' | 'ungrounded';

/** Evaluation of a single object */
export interface ObjectEvaluation {
  /** Object ID */
  readonly objectId: ObjectId;

  /** Grounding status */
  readonly groundingStatus: GroundingStatus;

  /** Effective grounding strength */
  readonly effectiveStrength: number;

  /** Active defeaters */
  readonly defeaters: Grounding[];

  /** Whether object is contradicted */
  readonly contradicted: boolean;

  /** Contradicting objects */
  readonly contradictedBy?: ObjectId[];
}

/** Analysis of grounding structure */
export interface GroundingAnalysis {
  /** Total grounding edges */
  readonly totalGroundings: number;

  /** Active grounding edges */
  readonly activeGroundings: number;

  /** Objects with no grounding (foundations) */
  readonly foundations: ObjectId[];

  /** Objects with circular grounding */
  readonly cycles: ObjectId[][];

  /** Maximum grounding chain depth */
  readonly maxDepth: number;

  /** Average grounding per object */
  readonly averageGroundingPerObject: number;
}

/** Types of recommendations */
export type RecommendationType =
  | 'add_grounding' // Object needs more grounding
  | 'resolve_contradiction' // Contradiction needs resolution
  | 'break_cycle' // Cycle needs breaking
  | 'strengthen_grounding' // Grounding is too weak
  | 'remove_object' // Object should be removed
  | 'add_evidence' // More evidence needed
  | 'review_level'; // Object may be at wrong level

/** Recommendation from evaluation */
export interface EvaluationRecommendation {
  /** Recommendation type */
  readonly type: RecommendationType;

  /** Priority (0 = highest) */
  readonly priority: number;

  /** Description */
  readonly description: string;

  /** Affected objects */
  readonly affectedObjects: ObjectId[];

  /** Suggested action */
  readonly action: string;
}

/** Stakes levels affect required evidence strength */
export type StakesLevel = 'low' | 'medium' | 'high' | 'critical';

/** Epistemic standards - what counts as sufficient grounding */
export interface EpistemicStandards {
  /** Minimum grounding strength required */
  readonly minimumGroundingStrength: number;

  /** Whether full defeat is fatal */
  readonly fullDefeatIsFatal: boolean;

  /** Maximum allowed coherence violations */
  readonly maxCoherenceViolations: number;

  /** Whether to require explicit grounding */
  readonly requireExplicitGrounding: boolean;
}

/** Context for epistemic evaluation */
export interface EvaluationContext {
  /** Available information in this context */
  readonly availableInformation: Content[];

  /** Epistemic standards in effect */
  readonly standards: EpistemicStandards;

  /** Practical stakes (affects required grounding strength) */
  readonly stakes: StakesLevel;

  /** Relevant alternatives to consider */
  readonly relevantAlternatives: Content[];

  /** Timestamp for temporal context */
  readonly timestamp?: string;

  /** Domain-specific context data */
  readonly domainContext?: Record<string, unknown>;
}

/** Full evaluation of coherence */
export interface CoherenceResult {
  /** Input structure that was evaluated */
  readonly input: CoherenceNetwork | EpistemicObject[];

  /** Coherence status */
  readonly status: CoherenceStatus;

  /** Per-object evaluation */
  readonly objectEvaluations: Map<ObjectId, ObjectEvaluation>;

  /** Grounding graph analysis */
  readonly groundingAnalysis: GroundingAnalysis;

  /** Recommendations */
  readonly recommendations: EvaluationRecommendation[];

  /** Evaluation context used */
  readonly context: EvaluationContext;
}

/** A conflict between objects */
export interface Conflict {
  /** First conflicting object */
  readonly objectA: ObjectId;

  /** Second conflicting object */
  readonly objectB: ObjectId;

  /** Type of conflict */
  readonly type: 'contradiction' | 'undermining' | 'rebutting';

  /** Explanation */
  readonly explanation: string;
}

/** A level consistency violation */
export interface LevelViolation {
  /** Object violating level constraints */
  readonly objectId: ObjectId;

  /** Expected level */
  readonly expectedLevel: number;

  /** Actual level */
  readonly actualLevel: number;

  /** Explanation */
  readonly explanation: string;
}

// ============================================================================
// ERROR TYPES
// ============================================================================

/** Error codes for grounding errors */
export type GroundingErrorCode =
  | 'REFLEXIVITY_VIOLATION'
  | 'ASYMMETRY_VIOLATION'
  | 'STRENGTH_MISMATCH'
  | 'CYCLE_DETECTED'
  | 'INVALID_TYPE';

/** Error thrown when grounding construction fails */
export class GroundingError extends Error {
  constructor(
    public readonly code: GroundingErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'GroundingError';
  }
}

/** Error codes for network errors */
export type NetworkErrorCode =
  | 'DUPLICATE_OBJECT'
  | 'DANGLING_REFERENCE'
  | 'INVALID_LEVEL'
  | 'COHERENCE_FAILURE';

/** Error thrown when network construction fails */
export class NetworkError extends Error {
  constructor(
    public readonly code: NetworkErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'NetworkError';
  }
}

// ============================================================================
// DEFAULT COHERENCE RULES
// ============================================================================

/** Default coherence rules applied to all networks */
export const DEFAULT_COHERENCE_RULES: CoherenceRule[] = [
  {
    id: 'no_contradictions',
    description: 'Objects with accepting attitudes must not conflict',
    type: 'no_contradictions',
    severity: 'error',
  },
  {
    id: 'grounding_connected',
    description: 'All non-foundation objects must have at least one grounding',
    type: 'minimum_grounding',
    severity: 'warning',
    params: { minimumStrength: 0.1 },
  },
  {
    id: 'no_grounding_cycles',
    description: 'Grounding relations must not form cycles',
    type: 'grounding_acyclicity',
    severity: 'error',
  },
];

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Compute hash of content data.
 */
function computeContentHash(data: unknown): string {
  const serialized = JSON.stringify(data);
  return createHash('sha256').update(serialized).digest('hex').slice(0, 16);
}

/**
 * Infer content type from data.
 */
function inferContentType(data: unknown): ContentType {
  if (typeof data === 'string') {
    if (data.endsWith('?')) return 'interrogative';
    if (data.startsWith('Do ') || data.startsWith('Please ')) return 'imperative';
    return 'propositional';
  }

  if (typeof data === 'function') return 'procedural';
  if (typeof data === 'object') return 'structured';

  return 'propositional';
}

/**
 * Infer grounding strength from type.
 */
function inferGroundingStrength(type: ExtendedGroundingType): GradedStrength {
  const strengthMap: Record<ExtendedGroundingType, number> = {
    full: 1.0,
    partial: 0.5,
    enabling: 0.3,
    undermining: 0.7,
    rebutting: 0.9,
    undercutting: 0.6,
    evidential: 0.7,
    explanatory: 0.6,
    constitutive: 0.8,
    inferential: 0.75,
    testimonial: 0.5,
    perceptual: 0.6,
  };

  return {
    value: strengthMap[type] ?? 0.5,
    basis: 'estimated',
  };
}

/**
 * Create a default agent for objects without explicit attribution.
 */
function createDefaultAgent(): Agent {
  return {
    id: createAgentId('system'),
    type: 'ai',
    name: 'System',
    trustLevel: 'medium',
  };
}

/**
 * Create a default evaluation context.
 */
function createDefaultContext(): EvaluationContext {
  return {
    availableInformation: [],
    standards: {
      minimumGroundingStrength: 0.3,
      fullDefeatIsFatal: true,
      maxCoherenceViolations: 0,
      requireExplicitGrounding: false,
    },
    stakes: 'medium',
    relevantAlternatives: [],
    timestamp: new Date().toISOString(),
  };
}

// ============================================================================
// CONTENT CONSTRUCTOR
// ============================================================================

/**
 * Construct content from various inputs.
 *
 * @param value - The data to wrap as content
 * @param contentType - Type of content (inferred if not provided)
 * @returns Constructed Content object
 */
export function constructContent(
  value: unknown,
  contentType?: ContentType
): Content {
  const effectiveType = contentType ?? inferContentType(value);
  const hash = computeContentHash(value);

  return {
    id: createContentId(),
    value,
    contentType: effectiveType,
    hash,
  };
}

// ============================================================================
// ATTITUDE CONSTRUCTOR
// ============================================================================

/**
 * Construct an attitude toward content.
 *
 * @param type - Type of attitude (accepting, rejecting, etc.)
 * @param strength - Optional graded strength
 * @returns Constructed Attitude object
 */
export function constructAttitude(
  type: AttitudeType,
  strength?: GradedStrength
): Attitude {
  return {
    type,
    strength,
  };
}

// ============================================================================
// EPISTEMIC OBJECT CONSTRUCTOR
// ============================================================================

/** Options for constructing epistemic objects */
export interface ConstructOptions {
  /** Custom ID */
  id?: ObjectId;

  /** Initial groundings */
  groundings?: GroundingId[];

  /** Abstraction level */
  level?: AbstractionLevel;

  /** Source description */
  source?: SourceDescriptor;

  /** Initial status */
  status?: ObjectStatus;
}

/**
 * Construct an epistemic object from content and attitude.
 *
 * This is the primary constructor for building knowledge.
 *
 * @param content - What the object is about
 * @param attitude - How the agent relates to the content
 * @param options - Additional construction options
 * @returns The constructed EpistemicObject
 */
export function constructEpistemicObject(
  content: Content,
  attitude: Attitude,
  options: ConstructOptions = {}
): EpistemicObject {
  const now = new Date().toISOString();

  return {
    id: options.id ?? createObjectId(),
    content,
    attitude,
    groundings: options.groundings ?? [],
    level: options.level,
    metadata: {
      createdAt: now,
      source: options.source ?? { type: 'manual', description: 'Manually constructed' },
      status: options.status ?? 'active',
    },
  };
}

// ============================================================================
// GROUNDING CONSTRUCTOR
// ============================================================================

/** Options for constructing grounding relations */
export interface GroundingOptions {
  /** Whether to validate the grounding relation */
  validate?: boolean;

  /** Whether to activate immediately */
  activate?: boolean;

  /** Explanation for why this grounding holds */
  explanation?: string;
}

/**
 * Construct a grounding relation between epistemic objects.
 *
 * PRECONDITIONS:
 * - from and to must be valid ObjectIds
 * - type must be a valid ExtendedGroundingType
 * - If type is 'full', strength must be 1.0
 *
 * @param from - The object providing the ground (ObjectId)
 * @param to - The object being grounded (ObjectId)
 * @param type - Type of grounding relation
 * @param strength - Strength of the grounding (default: inferred from type)
 * @param options - Additional options
 * @returns The constructed Grounding
 * @throws GroundingError if validation fails
 */
export function constructGrounding(
  from: ObjectId,
  to: ObjectId,
  type: ExtendedGroundingType,
  strength?: GradedStrength,
  options: GroundingOptions = {}
): Grounding {
  // Validate irreflexivity
  if (from === to) {
    throw new GroundingError('REFLEXIVITY_VIOLATION', 'Object cannot ground itself');
  }

  // Infer strength from type if not provided
  const effectiveStrength = strength ?? inferGroundingStrength(type);

  // Validate full grounding has strength 1.0
  if (type === 'full' && effectiveStrength.value !== 1.0) {
    throw new GroundingError(
      'STRENGTH_MISMATCH',
      'Full grounding requires strength 1.0'
    );
  }

  return {
    id: createGroundingId(),
    from,
    to,
    type,
    strength: effectiveStrength,
    active: options.activate ?? true,
    explanation: options.explanation,
  };
}

// ============================================================================
// ABSTRACTION LEVEL CONSTRUCTOR
// ============================================================================

/**
 * Construct an abstraction level for hierarchical organization.
 *
 * @param name - Human-readable name for the level
 * @param position - Numeric position (0 = most fundamental)
 * @param entrenchment - Resistance to revision [0, 1]
 * @param constraints - Optional constraints on objects at this level
 * @returns The constructed AbstractionLevel
 */
export function constructAbstractionLevel(
  name: string,
  position: number,
  entrenchment: number,
  constraints?: LevelConstraints
): AbstractionLevel {
  if (entrenchment < 0 || entrenchment > 1) {
    throw new Error(`Entrenchment must be in [0, 1], got ${entrenchment}`);
  }

  if (position < 0) {
    throw new Error(`Position must be non-negative, got ${position}`);
  }

  return {
    name,
    position,
    entrenchment,
    constraints,
  };
}

/**
 * Construct a complete hierarchy of levels.
 *
 * @param levelNames - Names from most fundamental to most derived
 * @param entrenchmentValues - Optional entrenchment values (default: decreasing)
 * @returns Array of AbstractionLevels
 */
export function constructHierarchy(
  levelNames: readonly string[],
  entrenchmentValues?: readonly number[]
): AbstractionLevel[] {
  const levels: AbstractionLevel[] = [];

  for (let i = 0; i < levelNames.length; i++) {
    // Default entrenchment: decreasing from 1.0 to 0.3
    const defaultEntrenchment = 1.0 - (i * 0.7 / Math.max(1, levelNames.length - 1));
    const entrenchment = entrenchmentValues?.[i] ?? defaultEntrenchment;

    levels.push(constructAbstractionLevel(levelNames[i], i, entrenchment));
  }

  return levels;
}

// ============================================================================
// COHERENCE NETWORK CONSTRUCTOR
// ============================================================================

/** Options for constructing coherence networks */
export interface NetworkConstructOptions {
  /** Name for the network */
  name?: string;

  /** Whether to validate on construction */
  validate?: boolean;

  /** Levels to use (if hierarchical) */
  levels?: AbstractionLevel[];

  /** Custom coherence rules */
  rules?: CoherenceRule[];

  /** Grounding direction */
  groundingDirection?: 'up' | 'down' | 'bidirectional';

  /** Whether to allow cycles */
  allowCycles?: boolean;
}

/**
 * Construct a coherence network from objects and groundings.
 *
 * @param objects - Objects to include in the network
 * @param groundings - Groundings between objects
 * @param options - Construction options
 * @returns The constructed CoherenceNetwork
 * @throws NetworkError if validation fails
 */
export function constructCoherenceNetwork(
  objects: EpistemicObject[],
  groundings: Grounding[],
  options: NetworkConstructOptions = {}
): CoherenceNetwork {
  // Index objects by ID
  const objectMap = new Map<ObjectId, EpistemicObject>();
  for (const obj of objects) {
    if (objectMap.has(obj.id)) {
      throw new NetworkError('DUPLICATE_OBJECT', `Duplicate object ID: ${obj.id}`);
    }
    objectMap.set(obj.id, obj);
  }

  // Validate groundings reference existing objects
  const groundingMap = new Map<GroundingId, Grounding>();
  for (const grounding of groundings) {
    if (!objectMap.has(grounding.from)) {
      throw new NetworkError(
        'DANGLING_REFERENCE',
        `Grounding references non-existent from: ${grounding.from}`
      );
    }
    if (!objectMap.has(grounding.to)) {
      throw new NetworkError(
        'DANGLING_REFERENCE',
        `Grounding references non-existent to: ${grounding.to}`
      );
    }
    groundingMap.set(grounding.id, grounding);
  }

  // Configure network
  const config: NetworkConfig = {
    groundingDirection: options.groundingDirection ?? 'down',
    allowCycles: options.allowCycles ?? false,
    coherenceRules: [...DEFAULT_COHERENCE_RULES, ...(options.rules ?? [])],
    defaultEntrenchment: options.levels?.map(l => l.entrenchment),
  };

  // Build network
  const network: CoherenceNetwork = {
    id: createNetworkId(),
    name: options.name ?? 'Unnamed Network',
    objects: objectMap,
    groundings: groundingMap,
    levels: options.levels,
    config,
    rules: config.coherenceRules,
    coherenceStatus: {
      coherent: true,
      score: 1.0,
      violations: [],
      computedAt: new Date().toISOString(),
    },
  };

  // Validate if requested
  if (options.validate !== false) {
    const evaluation = evaluateCoherence(network);
    return {
      ...network,
      coherenceStatus: evaluation.status,
    };
  }

  return network;
}

// ============================================================================
// COHERENCE EVALUATION
// ============================================================================

/**
 * Compute the grounding depth of an object.
 */
function computeGroundingDepth(
  objectId: ObjectId,
  network: CoherenceNetwork,
  visited: Set<string> = new Set()
): number {
  if (visited.has(objectId)) {
    return 0; // Cycle detected, treat as foundation
  }
  visited.add(objectId);

  // Find all groundings where this object is grounded
  const myGroundings = Array.from(network.groundings.values()).filter(
    g => g.to === objectId && (g.active !== false) &&
      g.type !== 'undermining' && g.type !== 'rebutting' && g.type !== 'undercutting'
  );

  if (myGroundings.length === 0) {
    return 0; // No groundings = foundation
  }

  // Depth = max depth of grounds + 1
  let maxGroundDepth = 0;
  for (const grounding of myGroundings) {
    const groundDepth = computeGroundingDepth(grounding.from, network, new Set(visited));
    maxGroundDepth = Math.max(maxGroundDepth, groundDepth);
  }

  return maxGroundDepth + 1;
}

/**
 * Find all cycles in the grounding graph.
 */
function findGroundingCycles(network: CoherenceNetwork): ObjectId[][] {
  const cycles: ObjectId[][] = [];
  const visited = new Set<string>();
  const recursionStack = new Set<string>();
  const path: ObjectId[] = [];

  // Build adjacency list (from -> to)
  const adjacency = new Map<ObjectId, ObjectId[]>();
  for (const obj of network.objects.keys()) {
    adjacency.set(obj, []);
  }
  for (const grounding of network.groundings.values()) {
    if ((grounding.active !== false) &&
      grounding.type !== 'undermining' &&
      grounding.type !== 'rebutting' &&
      grounding.type !== 'undercutting') {
      const list = adjacency.get(grounding.from) ?? [];
      list.push(grounding.to);
      adjacency.set(grounding.from, list);
    }
  }

  function dfs(nodeId: ObjectId): void {
    visited.add(nodeId);
    recursionStack.add(nodeId);
    path.push(nodeId);

    for (const neighbor of adjacency.get(nodeId) ?? []) {
      if (!visited.has(neighbor)) {
        dfs(neighbor);
      } else if (recursionStack.has(neighbor)) {
        // Found cycle
        const cycleStart = path.indexOf(neighbor);
        if (cycleStart !== -1) {
          cycles.push([...path.slice(cycleStart), neighbor]);
        }
      }
    }

    path.pop();
    recursionStack.delete(nodeId);
  }

  for (const objectId of network.objects.keys()) {
    if (!visited.has(objectId)) {
      dfs(objectId);
    }
  }

  return cycles;
}

/**
 * Find connected components in the network.
 */
function findConnectedComponents(network: CoherenceNetwork): ObjectId[][] {
  const visited = new Set<string>();
  const components: ObjectId[][] = [];

  // Build undirected adjacency
  const adjacency = new Map<ObjectId, Set<ObjectId>>();
  for (const obj of network.objects.keys()) {
    adjacency.set(obj, new Set());
  }
  for (const grounding of network.groundings.values()) {
    if (grounding.active !== false) {
      adjacency.get(grounding.from)?.add(grounding.to);
      adjacency.get(grounding.to)?.add(grounding.from);
    }
  }

  function bfs(start: ObjectId): ObjectId[] {
    const component: ObjectId[] = [];
    const queue = [start];
    visited.add(start);

    while (queue.length > 0) {
      const node = queue.shift()!;
      component.push(node);

      for (const neighbor of adjacency.get(node) ?? []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }

    return component;
  }

  for (const objectId of network.objects.keys()) {
    if (!visited.has(objectId)) {
      components.push(bfs(objectId));
    }
  }

  return components;
}

/**
 * Check for contradictions between accepting objects.
 */
function checkNoContradictions(
  rule: CoherenceRule,
  network: CoherenceNetwork
): CoherenceViolation[] {
  const violations: CoherenceViolation[] = [];

  // Check for contradictory pairs (via undermining/rebutting groundings)
  for (const grounding of network.groundings.values()) {
    if (grounding.type === 'undermining' || grounding.type === 'rebutting') {
      const ground = network.objects.get(grounding.from);
      const grounded = network.objects.get(grounding.to);

      if (ground && grounded &&
        ground.attitude.type === 'accepting' &&
        grounded.attitude.type === 'accepting') {
        violations.push({
          rule,
          objects: [ground.id, grounded.id],
          explanation: `Contradiction: ${ground.id} ${grounding.type}s ${grounded.id}, but both are accepted`,
          remediation: 'Reject one of the conflicting objects or add a defeater',
        });
      }
    }
  }

  return violations;
}

/**
 * Check for cycles in grounding relations.
 */
function checkGroundingAcyclicity(
  rule: CoherenceRule,
  network: CoherenceNetwork
): CoherenceViolation[] {
  if (network.config.allowCycles) {
    return [];
  }

  const violations: CoherenceViolation[] = [];
  const cycles = findGroundingCycles(network);

  for (const cycle of cycles) {
    violations.push({
      rule,
      objects: cycle,
      explanation: `Grounding cycle detected: ${cycle.join(' -> ')}`,
      remediation: 'Break the cycle by removing one grounding relation',
    });
  }

  return violations;
}

/**
 * Check that objects are grounded at appropriate levels.
 */
function checkLevelGrounding(
  rule: CoherenceRule,
  network: CoherenceNetwork
): CoherenceViolation[] {
  if (!network.levels || network.levels.length === 0) {
    return [];
  }

  const violations: CoherenceViolation[] = [];

  for (const obj of network.objects.values()) {
    if (!obj.level) continue;

    // Find groundings for this object
    const objGroundings = Array.from(network.groundings.values()).filter(
      g => g.to === obj.id && (g.active !== false) &&
        g.type !== 'undermining' && g.type !== 'rebutting' && g.type !== 'undercutting'
    );

    // Check that grounds are at lower levels
    for (const grounding of objGroundings) {
      const ground = network.objects.get(grounding.from);
      if (ground?.level && ground.level.position >= obj.level.position) {
        violations.push({
          rule,
          objects: [obj.id, ground.id],
          explanation: `Object ${obj.id} at level ${obj.level.name} is grounded by ${ground.id} at level ${ground.level.name}`,
          remediation: 'Ground objects only in lower-level objects',
        });
      }
    }
  }

  return violations;
}

/**
 * Check minimum grounding requirements.
 */
function checkMinimumGrounding(
  rule: CoherenceRule,
  network: CoherenceNetwork
): CoherenceViolation[] {
  const violations: CoherenceViolation[] = [];
  const minimumStrength = (rule.params?.minimumStrength as number) ?? 0.1;

  for (const obj of network.objects.values()) {
    // Skip if object is at level 0 (foundation)
    if (obj.level?.position === 0) continue;

    // Calculate effective grounding strength
    const objGroundings = Array.from(network.groundings.values()).filter(
      g => g.to === obj.id && (g.active !== false) &&
        g.type !== 'undermining' && g.type !== 'rebutting' && g.type !== 'undercutting'
    );

    if (objGroundings.length === 0 && obj.level !== undefined) {
      violations.push({
        rule,
        objects: [obj.id],
        explanation: `Object ${obj.id} has no grounding`,
        remediation: 'Add grounding relations or mark as foundation',
      });
    } else if (objGroundings.length > 0) {
      const totalStrength = objGroundings.reduce((sum, g) => sum + g.strength.value, 0);
      if (totalStrength < minimumStrength) {
        violations.push({
          rule,
          objects: [obj.id],
          explanation: `Object ${obj.id} has insufficient grounding strength (${totalStrength.toFixed(2)} < ${minimumStrength})`,
          remediation: 'Add stronger grounding relations',
        });
      }
    }
  }

  return violations;
}

/**
 * Check that all objects are connected.
 */
function checkCoverage(
  rule: CoherenceRule,
  network: CoherenceNetwork
): CoherenceViolation[] {
  const components = findConnectedComponents(network);

  if (components.length <= 1) {
    return [];
  }

  // Report all but the largest component as violations
  const sortedComponents = [...components].sort((a, b) => b.length - a.length);
  const violations: CoherenceViolation[] = [];

  for (let i = 1; i < sortedComponents.length; i++) {
    violations.push({
      rule,
      objects: sortedComponents[i],
      explanation: `Disconnected component of ${sortedComponents[i].length} object(s)`,
      remediation: 'Connect these objects to the main network',
    });
  }

  return violations;
}

/**
 * Check entrenchment ordering.
 */
function checkEntrenchmentOrdering(
  rule: CoherenceRule,
  network: CoherenceNetwork
): CoherenceViolation[] {
  if (!network.levels || network.levels.length < 2) {
    return [];
  }

  const violations: CoherenceViolation[] = [];

  for (let i = 1; i < network.levels.length; i++) {
    const lower = network.levels[i - 1];
    const higher = network.levels[i];

    if (higher.entrenchment > lower.entrenchment) {
      violations.push({
        rule,
        objects: [],
        explanation: `Level ${higher.name} (pos ${higher.position}) has higher entrenchment (${higher.entrenchment}) than ${lower.name} (${lower.entrenchment})`,
        remediation: 'Higher levels should have equal or lower entrenchment',
      });
    }
  }

  return violations;
}

/**
 * Check a single coherence rule.
 */
function checkRule(rule: CoherenceRule, network: CoherenceNetwork): CoherenceViolation[] {
  switch (rule.type) {
    case 'no_contradictions':
      return checkNoContradictions(rule, network);
    case 'grounding_acyclicity':
      return checkGroundingAcyclicity(rule, network);
    case 'level_grounding':
      return checkLevelGrounding(rule, network);
    case 'minimum_grounding':
      return checkMinimumGrounding(rule, network);
    case 'coverage':
      return checkCoverage(rule, network);
    case 'entrenchment_ordering':
      return checkEntrenchmentOrdering(rule, network);
    default:
      return [];
  }
}

/**
 * Check all coherence rules against a network.
 */
function checkCoherenceRules(network: CoherenceNetwork): CoherenceViolation[] {
  const violations: CoherenceViolation[] = [];

  for (const rule of network.config.coherenceRules) {
    const ruleViolations = checkRule(rule, network);
    violations.push(...ruleViolations);
  }

  return violations;
}

/**
 * Analyze the grounding structure of a network.
 */
function analyzeGrounding(network: CoherenceNetwork): GroundingAnalysis {
  const allGroundings = Array.from(network.groundings.values());
  const activeGroundings = allGroundings.filter(g => g.active !== false);

  // Find foundations (objects with no positive grounding)
  const grounded = new Set<string>();
  for (const g of activeGroundings) {
    if (g.type !== 'undermining' && g.type !== 'rebutting' && g.type !== 'undercutting') {
      grounded.add(g.to);
    }
  }
  const foundations = Array.from(network.objects.keys()).filter(id => !grounded.has(id));

  // Find cycles
  const cycles = findGroundingCycles(network);

  // Compute max depth
  let maxDepth = 0;
  for (const objectId of network.objects.keys()) {
    const depth = computeGroundingDepth(objectId, network);
    maxDepth = Math.max(maxDepth, depth);
  }

  return {
    totalGroundings: allGroundings.length,
    activeGroundings: activeGroundings.length,
    foundations: foundations as ObjectId[],
    cycles,
    maxDepth,
    averageGroundingPerObject: activeGroundings.length / Math.max(1, network.objects.size),
  };
}

/**
 * Evaluate each object individually.
 */
function evaluateObjects(
  network: CoherenceNetwork,
  context: EvaluationContext
): Map<ObjectId, ObjectEvaluation> {
  const evaluations = new Map<ObjectId, ObjectEvaluation>();

  for (const [objectId, _obj] of network.objects) {
    // Find groundings
    const positiveGroundings = Array.from(network.groundings.values()).filter(
      g => g.to === objectId && (g.active !== false) &&
        g.type !== 'undermining' && g.type !== 'rebutting' && g.type !== 'undercutting'
    );

    // Find defeaters
    const defeaters = Array.from(network.groundings.values()).filter(
      g => g.to === objectId && (g.active !== false) &&
        (g.type === 'undermining' || g.type === 'rebutting' || g.type === 'undercutting')
    );

    // Compute effective strength
    const positiveStrength = positiveGroundings.reduce((sum, g) => sum + g.strength.value, 0);
    const defeatStrength = defeaters.reduce((sum, g) => sum + g.strength.value, 0);
    const effectiveStrength = Math.max(0, positiveStrength - defeatStrength);

    // Determine grounding status
    let groundingStatus: GroundingStatus;
    if (effectiveStrength >= context.standards.minimumGroundingStrength) {
      groundingStatus = 'grounded';
    } else if (effectiveStrength > 0) {
      groundingStatus = 'partially_grounded';
    } else {
      groundingStatus = 'ungrounded';
    }

    // Check for contradictions
    const contradictedBy: ObjectId[] = [];
    for (const g of network.groundings.values()) {
      if ((g.type === 'undermining' || g.type === 'rebutting') &&
        g.to === objectId && (g.active !== false)) {
        const ground = network.objects.get(g.from);
        if (ground?.attitude.type === 'accepting') {
          contradictedBy.push(g.from);
        }
      }
    }

    evaluations.set(objectId, {
      objectId,
      groundingStatus,
      effectiveStrength,
      defeaters,
      contradicted: contradictedBy.length > 0,
      contradictedBy: contradictedBy.length > 0 ? contradictedBy : undefined,
    });
  }

  return evaluations;
}

/**
 * Compute overall coherence score.
 */
function computeCoherenceScore(
  violations: CoherenceViolation[],
  objectEvaluations: Map<ObjectId, ObjectEvaluation>
): number {
  let score = 1.0;

  // Deduct for violations
  for (const v of violations) {
    switch (v.rule.severity) {
      case 'error':
        score -= 0.2;
        break;
      case 'warning':
        score -= 0.1;
        break;
      case 'info':
        score -= 0.02;
        break;
    }
  }

  // Deduct for ungrounded/partially grounded objects
  let ungroundedCount = 0;
  let partialCount = 0;
  for (const eval_ of objectEvaluations.values()) {
    if (eval_.groundingStatus === 'ungrounded') ungroundedCount++;
    if (eval_.groundingStatus === 'partially_grounded') partialCount++;
  }

  const total = objectEvaluations.size;
  if (total > 0) {
    score -= (ungroundedCount / total) * 0.3;
    score -= (partialCount / total) * 0.1;
  }

  return Math.max(0, Math.min(1, score));
}

/**
 * Generate recommendations from evaluation results.
 */
function generateRecommendations(
  violations: CoherenceViolation[],
  objectEvaluations: Map<ObjectId, ObjectEvaluation>,
  _groundingAnalysis: GroundingAnalysis
): EvaluationRecommendation[] {
  const recommendations: EvaluationRecommendation[] = [];
  let priority = 0;

  // Recommendations from violations
  for (const v of violations) {
    if (v.remediation) {
      recommendations.push({
        type: v.rule.type === 'no_contradictions' ? 'resolve_contradiction' :
          v.rule.type === 'grounding_acyclicity' ? 'break_cycle' :
            v.rule.type === 'minimum_grounding' ? 'add_grounding' :
              'add_evidence',
        priority: priority++,
        description: v.remediation,
        affectedObjects: v.objects,
        action: v.remediation,
      });
    }
  }

  // Recommendations from object evaluations
  for (const [objectId, eval_] of objectEvaluations) {
    if (eval_.groundingStatus === 'ungrounded') {
      recommendations.push({
        type: 'add_grounding',
        priority: priority++,
        description: `Add grounding for object ${objectId}`,
        affectedObjects: [objectId],
        action: 'Identify and establish grounding relations',
      });
    } else if (eval_.groundingStatus === 'partially_grounded') {
      recommendations.push({
        type: 'strengthen_grounding',
        priority: priority++,
        description: `Strengthen grounding for object ${objectId}`,
        affectedObjects: [objectId],
        action: 'Add additional grounding or strengthen existing relations',
      });
    }
  }

  return recommendations;
}

/**
 * Evaluate the coherence of a structure.
 *
 * @param structure - Network or array of objects to evaluate
 * @param context - Optional evaluation context
 * @returns Detailed coherence evaluation
 */
export function evaluateCoherence(
  structure: CoherenceNetwork | EpistemicObject[],
  context?: EvaluationContext
): CoherenceResult {
  // Normalize input to network
  const network = Array.isArray(structure)
    ? constructCoherenceNetwork(structure, [], { validate: false })
    : structure;

  // Use default context if not provided
  const effectiveContext = context ?? createDefaultContext();

  // Apply coherence rules
  const violations = checkCoherenceRules(network);

  // Analyze grounding structure
  const groundingAnalysis = analyzeGrounding(network);

  // Evaluate each object
  const objectEvaluations = evaluateObjects(network, effectiveContext);

  // Compute overall status
  const errorCount = violations.filter(v => v.rule.severity === 'error').length;
  const coherent = errorCount === 0;
  const score = computeCoherenceScore(violations, objectEvaluations);

  // Generate recommendations
  const recommendations = generateRecommendations(violations, objectEvaluations, groundingAnalysis);

  return {
    input: structure,
    status: {
      coherent,
      score,
      violations,
      computedAt: new Date().toISOString(),
    },
    objectEvaluations,
    groundingAnalysis,
    recommendations,
    context: effectiveContext,
  };
}

/**
 * Find the grounding chain between two objects.
 *
 * @param network - The coherence network
 * @param from - Starting object
 * @param to - Target object
 * @returns Array of object IDs forming the path, or empty if no path exists
 */
export function findGroundingChain(
  network: CoherenceNetwork,
  from: ObjectId,
  to: ObjectId
): ObjectId[] {
  if (from === to) return [from];

  const visited = new Set<string>();
  const queue: { node: ObjectId; path: ObjectId[] }[] = [{ node: from, path: [from] }];

  // Build adjacency (from grounds to)
  const adjacency = new Map<ObjectId, ObjectId[]>();
  for (const obj of network.objects.keys()) {
    adjacency.set(obj, []);
  }
  for (const g of network.groundings.values()) {
    if ((g.active !== false) &&
      g.type !== 'undermining' && g.type !== 'rebutting' && g.type !== 'undercutting') {
      const list = adjacency.get(g.from) ?? [];
      list.push(g.to);
      adjacency.set(g.from, list);
    }
  }

  while (queue.length > 0) {
    const { node, path } = queue.shift()!;

    if (visited.has(node)) continue;
    visited.add(node);

    for (const neighbor of adjacency.get(node) ?? []) {
      if (neighbor === to) {
        return [...path, neighbor];
      }
      if (!visited.has(neighbor)) {
        queue.push({ node: neighbor, path: [...path, neighbor] });
      }
    }
  }

  return [];
}

/**
 * Detect conflicts in a network.
 *
 * @param network - The coherence network
 * @returns Array of detected conflicts
 */
export function detectConflicts(network: CoherenceNetwork): Conflict[] {
  const conflicts: Conflict[] = [];

  for (const g of network.groundings.values()) {
    if (g.type === 'rebutting' || g.type === 'undermining') {
      const objA = network.objects.get(g.from);
      const objB = network.objects.get(g.to);

      if (objA && objB &&
        objA.attitude.type === 'accepting' &&
        objB.attitude.type === 'accepting') {
        conflicts.push({
          objectA: g.from,
          objectB: g.to,
          type: g.type === 'rebutting' ? 'rebutting' : 'undermining',
          explanation: `${g.from} ${g.type}s ${g.to}, but both are accepted`,
        });
      }
    }
  }

  return conflicts;
}

/**
 * Check level consistency in a network.
 *
 * @param network - The coherence network
 * @returns Array of level violations
 */
export function checkLevelConsistency(network: CoherenceNetwork): LevelViolation[] {
  const violations: LevelViolation[] = [];

  if (!network.levels || network.levels.length === 0) {
    return violations;
  }

  for (const obj of network.objects.values()) {
    if (!obj.level) continue;

    // Compute expected level from grounding depth
    const depth = computeGroundingDepth(obj.id, network);
    const expectedLevel = Math.min(depth, network.levels.length - 1);

    if (obj.level.position !== expectedLevel) {
      violations.push({
        objectId: obj.id,
        expectedLevel,
        actualLevel: obj.level.position,
        explanation: `Object ${obj.id} has level ${obj.level.position} but grounding depth suggests level ${expectedLevel}`,
      });
    }
  }

  return violations;
}

// ============================================================================
// DOMAIN PRESETS
// ============================================================================

/**
 * Preset configuration for a domain.
 */
export interface PresetConfig {
  /** Preset identifier */
  readonly id: string;

  /** Human-readable name */
  readonly name: string;

  /** Description of when to use this preset */
  readonly description: string;

  /** Abstraction level names (most fundamental to most derived) */
  readonly levels: readonly string[];

  /** Grounding direction */
  readonly groundingDirection: 'up' | 'down' | 'bidirectional';

  /** Coherence rules for this domain */
  readonly coherenceRules: readonly CoherenceRule[];

  /** Default entrenchment values by level */
  readonly defaultEntrenchment: readonly number[];

  /** Typical content types at each level */
  readonly typicalContent?: Record<string, ContentType[]>;

  /** Domain-specific guidance */
  readonly guidance?: string;
}

/**
 * Software Development Preset
 */
export const SOFTWARE_DEV_PRESET: PresetConfig = {
  id: 'software_development',
  name: 'Software Development',
  description: 'For software projects: philosophy guides principles, which guide architecture, design, and implementation',

  levels: [
    'philosophy',
    'principles',
    'architecture',
    'design',
    'implementation',
  ],

  groundingDirection: 'down',

  defaultEntrenchment: [1.0, 0.9, 0.7, 0.5, 0.3],

  coherenceRules: [
    ...DEFAULT_COHERENCE_RULES,
    {
      id: 'implementation_requires_design',
      description: 'Implementation decisions must be grounded in design decisions',
      type: 'level_grounding',
      severity: 'warning',
    },
    {
      id: 'design_requires_architecture',
      description: 'Design decisions must be grounded in architectural decisions',
      type: 'level_grounding',
      severity: 'warning',
    },
    {
      id: 'architecture_requires_principles',
      description: 'Architectural decisions should be grounded in principles',
      type: 'level_grounding',
      severity: 'info',
    },
  ],

  typicalContent: {
    philosophy: ['propositional'],
    principles: ['propositional', 'imperative'],
    architecture: ['propositional', 'structured'],
    design: ['propositional', 'structured', 'procedural'],
    implementation: ['procedural', 'structured'],
  },

  guidance: `Use this preset for software projects where you want to trace implementation decisions back to design, architecture, principles, and ultimately philosophy.`,
};

/**
 * Scientific Method Preset
 */
export const SCIENTIFIC_METHOD_PRESET: PresetConfig = {
  id: 'scientific_method',
  name: 'Scientific Method',
  description: 'For scientific inquiry: theories generate hypotheses, predictions, experiments, and conclusions',

  levels: [
    'theory',
    'hypothesis',
    'prediction',
    'experiment',
    'data',
    'conclusion',
  ],

  groundingDirection: 'bidirectional',

  defaultEntrenchment: [0.9, 0.7, 0.5, 0.3, 0.1, 0.6],

  coherenceRules: [
    ...DEFAULT_COHERENCE_RULES,
    {
      id: 'hypothesis_from_theory',
      description: 'Hypotheses should be derivable from theory',
      type: 'level_grounding',
      severity: 'warning',
    },
    {
      id: 'prediction_from_hypothesis',
      description: 'Predictions must follow from hypotheses',
      type: 'level_grounding',
      severity: 'error',
    },
    {
      id: 'data_grounds_conclusion',
      description: 'Conclusions must be grounded in data',
      type: 'level_grounding',
      severity: 'error',
    },
  ],

  typicalContent: {
    theory: ['propositional'],
    hypothesis: ['propositional'],
    prediction: ['propositional'],
    experiment: ['procedural', 'structured'],
    data: ['structured'],
    conclusion: ['propositional'],
  },

  guidance: `Use this preset for scientific reasoning where you want to track the flow from theory to evidence and back.`,
};

/**
 * Legal Reasoning Preset
 */
export const LEGAL_REASONING_PRESET: PresetConfig = {
  id: 'legal_reasoning',
  name: 'Legal Reasoning',
  description: 'For legal analysis: constitutional principles guide statutes, precedents, rules, and applications',

  levels: [
    'constitution',
    'statute',
    'precedent',
    'rule',
    'application',
  ],

  groundingDirection: 'down',

  defaultEntrenchment: [1.0, 0.9, 0.8, 0.6, 0.4],

  coherenceRules: [
    ...DEFAULT_COHERENCE_RULES,
    {
      id: 'statute_from_constitution',
      description: 'Statutes must be consistent with constitutional principles',
      type: 'no_contradictions',
      severity: 'error',
    },
    {
      id: 'precedent_from_statute',
      description: 'Precedents interpret and apply statutes',
      type: 'level_grounding',
      severity: 'warning',
    },
    {
      id: 'rule_from_precedent',
      description: 'Legal rules are derived from precedent',
      type: 'level_grounding',
      severity: 'warning',
    },
  ],

  typicalContent: {
    constitution: ['propositional', 'imperative'],
    statute: ['propositional', 'imperative'],
    precedent: ['propositional', 'structured'],
    rule: ['propositional', 'imperative'],
    application: ['propositional'],
  },

  guidance: `Use this preset for legal reasoning where authority flows from higher sources (constitution) to lower applications.`,
};

/**
 * All available presets.
 */
export const PRESETS = {
  softwareDevelopment: SOFTWARE_DEV_PRESET,
  scientificMethod: SCIENTIFIC_METHOD_PRESET,
  legalReasoning: LEGAL_REASONING_PRESET,
} as const;

/** Preset keys */
export type PresetKey = keyof typeof PRESETS;

/**
 * Apply a preset to create a coherence network.
 *
 * @param preset - Key of the preset to apply
 * @returns A new coherence network configured with the preset
 */
export function applyPreset(preset: PresetKey): CoherenceNetwork {
  const config = PRESETS[preset];

  const levels = constructHierarchy(
    config.levels,
    config.defaultEntrenchment
  );

  return constructCoherenceNetwork([], [], {
    name: config.name,
    levels,
    groundingDirection: config.groundingDirection,
    rules: config.coherenceRules as CoherenceRule[],
    validate: false,
  });
}

/**
 * Adapt a preset with customizations.
 *
 * @param preset - Key of the preset to adapt
 * @param customizations - Customizations to apply
 * @returns A new coherence network with customizations
 */
export function adaptPreset(
  preset: PresetKey,
  customizations: {
    name?: string;
    additionalLevels?: string[];
    additionalRules?: CoherenceRule[];
    groundingDirection?: 'up' | 'down' | 'bidirectional';
  }
): CoherenceNetwork {
  const config = PRESETS[preset];

  const allLevelNames = [...config.levels, ...(customizations.additionalLevels ?? [])];
  const levels = constructHierarchy(allLevelNames);

  return constructCoherenceNetwork([], [], {
    name: customizations.name ?? `${config.name} (Customized)`,
    levels,
    groundingDirection: customizations.groundingDirection ?? config.groundingDirection,
    rules: [...(config.coherenceRules as CoherenceRule[]), ...(customizations.additionalRules ?? [])],
    validate: false,
  });
}

// ============================================================================
// AUTO-CONFIGURATION
// ============================================================================

/** Result of inferring coherence structure */
export interface InferredStructure {
  /** Suggested preset (if one matches well) */
  suggestedPreset?: PresetKey;

  /** Confidence in the suggestion */
  confidence: number;

  /** Inferred levels */
  levels: AbstractionLevel[];

  /** Inferred grounding direction */
  groundingDirection: 'up' | 'down' | 'bidirectional';

  /** Reasoning for the inference */
  reasoning: string[];
}

/**
 * Infer the likely coherence structure from a set of epistemic objects.
 *
 * @param objects - Objects to analyze
 * @returns Inferred structure with reasoning
 */
export function inferStructure(objects: EpistemicObject[]): InferredStructure {
  const reasoning: string[] = [];

  if (objects.length === 0) {
    return {
      confidence: 0,
      levels: [],
      groundingDirection: 'down',
      reasoning: ['No objects to analyze'],
    };
  }

  // Analyze content types
  const contentTypes = new Map<ContentType, number>();
  for (const obj of objects) {
    const type = obj.content.contentType;
    contentTypes.set(type, (contentTypes.get(type) ?? 0) + 1);
  }

  // Check for preset matches based on content types
  let bestMatch: PresetKey | undefined;
  let bestScore = 0;

  for (const [key, config] of Object.entries(PRESETS)) {
    let score = 0;

    // Check content type overlap
    if (config.typicalContent) {
      let matchCount = 0;
      let totalExpected = 0;

      for (const levelContent of Object.values(config.typicalContent)) {
        totalExpected += levelContent.length;
        for (const expectedType of levelContent) {
          if (contentTypes.has(expectedType)) {
            matchCount++;
          }
        }
      }

      score = matchCount / Math.max(1, totalExpected);
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = key as PresetKey;
    }
  }

  if (bestScore > 0.3 && bestMatch) {
    reasoning.push(`Best matching preset: ${PRESETS[bestMatch].name} (score: ${bestScore.toFixed(2)})`);

    const config = PRESETS[bestMatch];
    return {
      suggestedPreset: bestMatch,
      confidence: bestScore,
      levels: constructHierarchy(config.levels, config.defaultEntrenchment),
      groundingDirection: config.groundingDirection,
      reasoning,
    };
  }

  // No good match - create generic structure
  reasoning.push('No preset matched well, inferring custom structure');

  // Group objects by their grounding depth
  const depths = new Set<number>();
  const tempNetwork = constructCoherenceNetwork(objects, [], { validate: false });

  for (const obj of objects) {
    const depth = computeGroundingDepth(obj.id, tempNetwork);
    depths.add(depth);
  }

  const levelCount = Math.max(1, depths.size);
  const levels: AbstractionLevel[] = [];
  for (let i = 0; i < levelCount; i++) {
    levels.push(constructAbstractionLevel(
      `Level ${i}`,
      i,
      1.0 - (i * 0.6 / Math.max(1, levelCount - 1))
    ));
  }

  return {
    confidence: 0.3,
    levels,
    groundingDirection: 'down',
    reasoning,
  };
}

/**
 * Suggest a preset based on a domain hint.
 *
 * @param domainHint - Free-text hint about the domain
 * @returns Suggested preset key
 */
export function suggestPreset(domainHint: string): PresetKey {
  const hint = domainHint.toLowerCase();

  const keywords: Record<string, PresetKey> = {
    'software': 'softwareDevelopment',
    'code': 'softwareDevelopment',
    'programming': 'softwareDevelopment',
    'architecture': 'softwareDevelopment',
    'design': 'softwareDevelopment',
    'science': 'scientificMethod',
    'research': 'scientificMethod',
    'experiment': 'scientificMethod',
    'hypothesis': 'scientificMethod',
    'theory': 'scientificMethod',
    'law': 'legalReasoning',
    'legal': 'legalReasoning',
    'court': 'legalReasoning',
    'statute': 'legalReasoning',
    'constitution': 'legalReasoning',
  };

  for (const [keyword, presetKey] of Object.entries(keywords)) {
    if (hint.includes(keyword)) {
      return presetKey;
    }
  }

  // Default to software development
  return 'softwareDevelopment';
}

// ============================================================================
// INTEGRATION WITH LIBRARIAN EPISTEMICS
// ============================================================================

/**
 * Convert a GradedStrength to a Librarian ConfidenceValue.
 *
 * @param strength - The graded strength to convert
 * @returns A ConfidenceValue with appropriate provenance
 */
export function toConfidenceValue(strength: GradedStrength): ConfidenceValue {
  switch (strength.basis) {
    case 'measured':
      return {
        type: 'measured',
        value: strength.value,
        measurement: {
          datasetId: 'universal_coherence',
          sampleSize: 1,
          accuracy: strength.value,
          confidenceInterval: [Math.max(0, strength.value - 0.1), Math.min(1, strength.value + 0.1)],
          measuredAt: new Date().toISOString(),
        },
      };

    case 'derived':
      return {
        type: 'derived',
        value: strength.value,
        formula: 'grounding_aggregation',
        inputs: [],
      };

    case 'estimated':
      return bounded(
        Math.max(0, strength.value - 0.15),
        Math.min(1, strength.value + 0.15),
        'theoretical',
        'estimated_from_grading'
      );

    case 'absent':
    default:
      return absent('uncalibrated');
  }
}

/**
 * Convert a Librarian ConfidenceValue to a GradedStrength.
 *
 * @param confidence - The confidence value to convert
 * @returns A GradedStrength with appropriate basis
 */
export function fromConfidenceValue(confidence: ConfidenceValue): GradedStrength {
  switch (confidence.type) {
    case 'deterministic':
      return {
        value: confidence.value,
        basis: 'measured',
      };

    case 'derived':
      return {
        value: confidence.value,
        basis: 'derived',
      };

    case 'measured':
      return {
        value: confidence.value,
        basis: 'measured',
      };

    case 'bounded':
      return {
        value: (confidence.low + confidence.high) / 2,
        basis: 'estimated',
      };

    case 'absent':
    default:
      return {
        value: 0.5,
        basis: 'absent',
      };
  }
}

/**
 * Convert an EpistemicObject to a Librarian Claim.
 *
 * @param obj - The epistemic object to convert
 * @returns A Claim compatible with Librarian's evidence graph
 */
export function toClaim(obj: EpistemicObject): Claim {
  const confidence = obj.attitude.strength
    ? toConfidenceValue(obj.attitude.strength)
    : absent('uncalibrated');

  const status: ClaimStatus = obj.metadata.status === 'active' ? 'active' :
    obj.metadata.status === 'defeated' ? 'defeated' :
      obj.metadata.status === 'superseded' ? 'superseded' : 'pending';

  const source: ClaimSource = {
    type: obj.metadata.source.type === 'ai' ? 'llm' :
      obj.metadata.source.type === 'human' ? 'human' : 'tool',
    id: obj.metadata.source.description,
    version: obj.metadata.source.version,
  };

  return {
    id: createClaimId(obj.id),
    proposition: typeof obj.content.value === 'string'
      ? obj.content.value
      : JSON.stringify(obj.content.value),
    type: 'semantic',
    subject: {
      type: 'entity',
      id: obj.content.id,
      name: obj.content.id,
    },
    createdAt: obj.metadata.createdAt,
    source,
    status,
    confidence,
    signalStrength: {
      overall: obj.attitude.strength?.value ?? 0.5,
      retrieval: 0.5,
      structural: 0.5,
      semantic: obj.attitude.strength?.value ?? 0.5,
      testExecution: 0.5,
      recency: 1.0,
      aggregationMethod: 'geometric_mean',
    },
    schemaVersion: UNIVERSAL_COHERENCE_SCHEMA_VERSION,
  };
}

/**
 * Convert a Librarian Claim to an EpistemicObject.
 *
 * @param claim - The claim to convert
 * @returns An EpistemicObject
 */
export function fromClaim(claim: Claim): EpistemicObject {
  const content = constructContent(claim.proposition, 'propositional');

  const attitudeType: AttitudeType = claim.status === 'active' ? 'accepting' :
    claim.status === 'defeated' ? 'rejecting' : 'suspending';

  const attitude = constructAttitude(
    attitudeType,
    fromConfidenceValue(claim.confidence)
  );

  const status: ObjectStatus = claim.status === 'active' ? 'active' :
    claim.status === 'defeated' ? 'defeated' :
      claim.status === 'superseded' ? 'superseded' : 'suspended';

  return constructEpistemicObject(content, attitude, {
    id: claim.id as unknown as ObjectId,
    source: {
      type: claim.source.type,
      description: claim.source.id,
      version: claim.source.version,
    },
    status,
  });
}

/**
 * Store a CoherenceNetwork as evidence in the ledger.
 *
 * @param network - The network to store
 * @param ledger - The evidence ledger
 * @param sessionId - Optional session ID
 * @returns The created evidence entry
 */
export async function storeNetworkAsEvidence(
  network: CoherenceNetwork,
  ledger: IEvidenceLedger,
  sessionId?: SessionId
): Promise<EvidenceEntry> {
  const entry = await ledger.append({
    kind: 'episode',
    payload: {
      query: `Coherence network: ${network.name}`,
      stages: [
        { name: 'construct', durationMs: 0, success: true },
        { name: 'evaluate', durationMs: 0, success: network.coherenceStatus.coherent },
      ],
      totalDurationMs: 0,
      retrievedEntities: network.objects.size,
      synthesizedResponse: true,
    },
    provenance: {
      source: 'system_observation',
      method: 'coherence_network_construction',
    },
    confidence: {
      type: 'derived',
      value: network.coherenceStatus.score,
      formula: 'coherence_evaluation',
      inputs: [],
    },
    relatedEntries: [],
    sessionId,
  });

  return entry;
}
