# Universal Coherence Design

**Status**: Design Specification
**Version**: 1.0.0
**Date**: 2026-01-29
**Input**: `docs/librarian/specs/research/universal-epistemic-primitives.md`
**Purpose**: Design universal constructors for building ANY epistemic structure from primitives, with practical presets for common domains

---

## Executive Summary

This document specifies a **universal constructor system** for building epistemic structures from the six primitives identified in the universal epistemic primitives research:

1. **Distinguishability** (Delta) - The capacity to differentiate
2. **Content** (C) - That which can be distinguished
3. **Grounding** (G) - The "in virtue of" relation
4. **Attitude** (A) - Epistemic stance toward content
5. **Agent** (a) - Locus of epistemic states
6. **Context** (K) - Situation of evaluation

And the four primitive operations:

1. **CONSTRUCT** - Build complex from simple
2. **RELATE** - Establish grounding connections
3. **EVALUATE** - Assess status given relations
4. **REVISE** - Update under new information

### Key Design Principles

1. **Domain Agnosticism**: Constructors work for any domain - software, science, law, medicine
2. **Composition**: Complex structures emerge from composing simpler ones
3. **Preset Templates**: Common configurations available out-of-the-box
4. **Auto-Configuration**: Intelligent inference of appropriate structure
5. **Integration**: Maps cleanly to existing Librarian epistemics

---

## Table of Contents

1. [Universal Constructors](#1-universal-constructors)
2. [Type System](#2-type-system)
3. [Grounding Constructor](#3-grounding-constructor)
4. [Coherence Network Constructor](#4-coherence-network-constructor)
5. [Abstraction Level Constructor](#5-abstraction-level-constructor)
6. [Derivation Constructor](#6-derivation-constructor)
7. [Coherence Evaluator](#7-coherence-evaluator)
8. [Domain Presets](#8-domain-presets)
9. [Auto-Configuration](#9-auto-configuration)
10. [Integration Mapping](#10-integration-mapping)
11. [Implementation Notes](#11-implementation-notes)

---

## 1. Universal Constructors

### 1.1 Design Philosophy

The universal constructors are **domain-agnostic**. Instead of:

```typescript
// Domain-specific (AVOID):
function createPrinciple(content: string): Principle
function createArchitecturalDecision(content: string): ADR
function createHypothesis(content: string): Hypothesis
```

We provide:

```typescript
// Universal (PREFERRED):
function constructEpistemicObject(
  content: Content,
  attitude: Attitude,
  grounding?: Grounding[]
): EpistemicObject
```

The same constructor builds principles, decisions, hypotheses, legal claims, and any other epistemic object.

### 1.2 Constructor Signatures

```typescript
// ============================================================================
// CORE CONSTRUCTORS
// ============================================================================

/**
 * Construct any epistemic object from primitives.
 * This is the primary entry point for building knowledge.
 */
function constructEpistemicObject(
  content: Content,
  attitude: Attitude,
  options?: ConstructOptions
): EpistemicObject;

/**
 * Establish a grounding relation between objects.
 * Grounding is the "in virtue of" relation - X grounds Y means
 * Y holds (partially) because of X.
 */
function constructGrounding(
  from: EpistemicObject,
  to: EpistemicObject,
  type: GroundingType,
  strength?: GroundingStrength
): Grounding;

/**
 * Build a coherence network - a set of objects with grounding relations.
 * This is the fundamental structure for organized knowledge.
 */
function constructCoherenceNetwork(
  objects: EpistemicObject[],
  groundings: Grounding[],
  options?: NetworkOptions
): CoherenceNetwork;

/**
 * Define an abstraction level within a hierarchy.
 * Levels organize objects by their position in grounding chains.
 */
function constructAbstractionLevel(
  name: string,
  entrenchment: number,
  constraints?: LevelConstraints
): AbstractionLevel;

/**
 * Build a derived object from grounded sources.
 * Derivation tracks how new knowledge emerges from existing knowledge.
 */
function constructDerivation(
  sources: EpistemicObject[],
  result: Content,
  formula: DerivationFormula
): DerivedObject;

/**
 * Evaluate the coherence status of a structure.
 * Returns detailed diagnostics on consistency and grounding.
 */
function evaluateCoherence(
  structure: CoherenceNetwork | EpistemicObject[],
  context?: EvaluationContext
): CoherenceEvaluation;
```

---

## 2. Type System

### 2.1 Primitive Types

```typescript
// ============================================================================
// PRIMITIVE TYPES (from universal-epistemic-primitives.md)
// ============================================================================

/**
 * Distinguishability - the capacity to differentiate one thing from another.
 * This is the most fundamental epistemic concept.
 */
export type Distinguishability = 'distinguished' | 'indistinguished';

/**
 * Content - anything that can be the object of an epistemic state.
 * More primitive than "proposition" - no logical structure required.
 */
export interface Content {
  /** Unique identifier for this content */
  readonly id: ContentId;

  /** The distinguishing data - what makes this content unique */
  readonly data: unknown;

  /** Content type for structural classification */
  readonly contentType: ContentType;

  /** Optional schema for structured content */
  readonly schema?: ContentSchema;

  /** Hash for content-addressable identity */
  readonly hash: string;
}

/** Branded type for content IDs */
export type ContentId = string & { readonly __brand: 'ContentId' };

/** Types of content that can be distinguished */
export type ContentType =
  | 'propositional'  // "The cat is on the mat" - truth-evaluable
  | 'perceptual'     // <visual field state> - sensory
  | 'procedural'     // <how to do X> - know-how
  | 'indexical'      // <this, here, now> - context-dependent
  | 'interrogative'  // "Is X the case?" - questions
  | 'imperative'     // "Do X" - commands
  | 'structured';    // Complex/composite content

/**
 * Attitude - epistemic stance toward content.
 * How an agent relates to content epistemically.
 */
export interface Attitude {
  /** Type of attitude */
  readonly type: AttitudeType;

  /** Strength of attitude (for graded attitudes) */
  readonly strength?: GradedStrength;

  /** Conditions under which attitude holds (for conditional attitudes) */
  readonly conditions?: Content[];
}

/** Primitive attitude types */
export type AttitudeType =
  | 'entertaining'   // C is before the mind
  | 'accepting'      // C is taken to hold
  | 'rejecting'      // C is taken not to hold
  | 'questioning'    // C's status is open
  | 'suspending';    // C's status is deliberately deferred

/** Graded strength for continuous attitudes */
export interface GradedStrength {
  /** Numeric strength in [0, 1] */
  readonly value: number;

  /** Provenance of the strength value */
  readonly provenance: StrengthProvenance;
}

/** How the strength value was determined */
export type StrengthProvenance =
  | { type: 'measured'; measurement: MeasurementData }
  | { type: 'derived'; formula: string; inputs: GradedStrength[] }
  | { type: 'bounded'; low: number; high: number; basis: string }
  | { type: 'assigned'; reason: string };

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

/** Branded type for agent IDs */
export type AgentId = string & { readonly __brand: 'AgentId' };

/** Types of agents */
export type AgentType =
  | 'human'       // Individual human
  | 'ai'          // AI system
  | 'collective'  // Group (jury, committee, community)
  | 'idealized';  // Theoretical reasoner

/** Trust levels for agents */
export type TrustLevel = 'untrusted' | 'low' | 'medium' | 'high' | 'authoritative';

/**
 * Context - the complete situation for epistemic evaluation.
 * Knowledge claims are always relative to context.
 */
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

/** Stakes levels affect required evidence strength */
export type StakesLevel = 'low' | 'medium' | 'high' | 'critical';
```

### 2.2 Constructed Types

```typescript
// ============================================================================
// CONSTRUCTED TYPES (built from primitives)
// ============================================================================

/**
 * An epistemic object - the fundamental unit of knowledge.
 * Constructed from content + attitude + optional grounding.
 */
export interface EpistemicObject {
  /** Unique identifier */
  readonly id: EpistemicObjectId;

  /** The content this object is about */
  readonly content: Content;

  /** The attitude toward the content */
  readonly attitude: Attitude;

  /** Agent who holds this epistemic state */
  readonly agent: Agent;

  /** Direct groundings for this object */
  readonly groundings: Grounding[];

  /** Abstraction level if assigned */
  readonly level?: AbstractionLevel;

  /** Metadata for tracking and debugging */
  readonly metadata: EpistemicMetadata;

  /** Schema version */
  readonly schemaVersion: string;
}

/** Branded type for epistemic object IDs */
export type EpistemicObjectId = string & { readonly __brand: 'EpistemicObjectId' };

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

/** Status of an epistemic object */
export type ObjectStatus =
  | 'active'      // Currently held
  | 'defeated'    // Invalidated by defeater
  | 'suspended'   // Temporarily suspended
  | 'superseded'  // Replaced by newer object
  | 'retracted';  // Explicitly withdrawn

/**
 * Grounding - the "in virtue of" relation.
 * X grounds Y means Y holds (partially) because of X.
 */
export interface Grounding {
  /** Unique identifier */
  readonly id: GroundingId;

  /** The grounding object (what provides the ground) */
  readonly ground: EpistemicObjectId;

  /** The grounded object (what is grounded) */
  readonly grounded: EpistemicObjectId;

  /** Type of grounding relation */
  readonly type: GroundingType;

  /** Strength of the grounding */
  readonly strength: GroundingStrength;

  /** Whether this grounding is active */
  readonly active: boolean;

  /** Explanation of why this grounding holds */
  readonly explanation?: string;
}

/** Branded type for grounding IDs */
export type GroundingId = string & { readonly __brand: 'GroundingId' };

/** Types of grounding relations */
export type GroundingType =
  | 'full'         // Y holds entirely in virtue of X
  | 'partial'      // Y holds partially in virtue of X
  | 'enabling'     // X enables Y to hold
  | 'undermining'  // X grounds the falsity of Y (defeat)
  | 'rebutting'    // X directly contradicts Y (defeat)
  | 'undercutting';// X attacks the grounding of Y (defeat)

/** Strength of a grounding relation */
export interface GroundingStrength {
  /** Numeric strength in [0, 1] */
  readonly value: number;

  /** How strength was determined */
  readonly basis: StrengthBasis;
}

/** Basis for grounding strength */
export type StrengthBasis =
  | 'logical'      // Logical entailment
  | 'evidential'   // Evidential support
  | 'testimonial'  // Testimony
  | 'inferential'  // Inferred
  | 'stipulated';  // Assigned by convention

/**
 * Abstraction level - position in a grounding hierarchy.
 * Objects at higher levels are grounded in objects at lower levels.
 */
export interface AbstractionLevel {
  /** Level name */
  readonly name: string;

  /** Numeric position (0 = most fundamental) */
  readonly position: number;

  /** Entrenchment - resistance to revision */
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
  readonly objects: Map<EpistemicObjectId, EpistemicObject>;

  /** All groundings in the network */
  readonly groundings: Map<GroundingId, Grounding>;

  /** Abstraction levels (if hierarchical) */
  readonly levels?: AbstractionLevel[];

  /** Network configuration */
  readonly config: NetworkConfig;

  /** Current coherence status */
  readonly coherenceStatus: CoherenceStatus;
}

/** Branded type for network IDs */
export type NetworkId = string & { readonly __brand: 'NetworkId' };

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

/** Types of coherence rules */
export type CoherenceRuleType =
  | 'no_contradictions'     // Objects with accepting attitudes must not conflict
  | 'grounding_acyclicity'  // No circular grounding (unless allowed)
  | 'level_grounding'       // Objects at level N must be grounded in level < N
  | 'minimum_grounding'     // Objects must have minimum grounding strength
  | 'coverage'              // All objects must be connected
  | 'entrenchment_ordering' // Higher levels have lower entrenchment
  | 'custom';               // Custom rule

/**
 * Derived object - an object constructed from others via derivation.
 */
export interface DerivedObject extends EpistemicObject {
  /** Derivation formula used */
  readonly derivation: DerivationFormula;

  /** Source objects */
  readonly sources: EpistemicObjectId[];

  /** Derivation timestamp */
  readonly derivedAt: string;
}

/** Formula for deriving new objects */
export interface DerivationFormula {
  /** Formula type */
  readonly type: DerivationFormulaType;

  /** Human-readable description */
  readonly description: string;

  /** Parameters */
  readonly params?: Record<string, unknown>;
}

/** Types of derivation formulas */
export type DerivationFormulaType =
  | 'conjunction'   // All sources must hold
  | 'disjunction'   // At least one source must hold
  | 'inference'     // Logical inference from sources
  | 'aggregation'   // Statistical aggregation
  | 'synthesis'     // Creative combination
  | 'custom';       // Custom derivation
```

### 2.3 Evaluation Types

```typescript
// ============================================================================
// EVALUATION TYPES
// ============================================================================

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

/** A coherence violation */
export interface CoherenceViolation {
  /** Which rule was violated */
  readonly rule: CoherenceRule;

  /** Objects involved in the violation */
  readonly objects: EpistemicObjectId[];

  /** Human-readable explanation */
  readonly explanation: string;

  /** Suggested remediation */
  readonly remediation?: string;
}

/** Full evaluation of coherence */
export interface CoherenceEvaluation {
  /** Input structure that was evaluated */
  readonly input: CoherenceNetwork | EpistemicObject[];

  /** Coherence status */
  readonly status: CoherenceStatus;

  /** Per-object evaluation */
  readonly objectEvaluations: Map<EpistemicObjectId, ObjectEvaluation>;

  /** Grounding graph analysis */
  readonly groundingAnalysis: GroundingAnalysis;

  /** Recommendations */
  readonly recommendations: EvaluationRecommendation[];

  /** Evaluation context used */
  readonly context: EvaluationContext;
}

/** Evaluation of a single object */
export interface ObjectEvaluation {
  /** Object ID */
  readonly objectId: EpistemicObjectId;

  /** Grounding status */
  readonly groundingStatus: 'grounded' | 'partially_grounded' | 'ungrounded';

  /** Effective grounding strength */
  readonly effectiveStrength: number;

  /** Active defeaters */
  readonly defeaters: Grounding[];

  /** Whether object is contradicted */
  readonly contradicted: boolean;

  /** Contradicting objects */
  readonly contradictedBy?: EpistemicObjectId[];
}

/** Analysis of grounding structure */
export interface GroundingAnalysis {
  /** Total grounding edges */
  readonly totalGroundings: number;

  /** Active grounding edges */
  readonly activeGroundings: number;

  /** Objects with no grounding (foundations) */
  readonly foundations: EpistemicObjectId[];

  /** Objects with circular grounding */
  readonly cycles: EpistemicObjectId[][];

  /** Maximum grounding chain depth */
  readonly maxDepth: number;

  /** Average grounding per object */
  readonly averageGroundingPerObject: number;
}

/** Recommendation from evaluation */
export interface EvaluationRecommendation {
  /** Recommendation type */
  readonly type: RecommendationType;

  /** Priority (0 = highest) */
  readonly priority: number;

  /** Description */
  readonly description: string;

  /** Affected objects */
  readonly affectedObjects: EpistemicObjectId[];

  /** Suggested action */
  readonly action: string;
}

/** Types of recommendations */
export type RecommendationType =
  | 'add_grounding'        // Object needs more grounding
  | 'resolve_contradiction' // Contradiction needs resolution
  | 'break_cycle'          // Cycle needs breaking
  | 'strengthen_grounding' // Grounding is too weak
  | 'remove_object'        // Object should be removed
  | 'add_evidence'         // More evidence needed
  | 'review_level';        // Object may be at wrong level
```

---

## 3. Grounding Constructor

### 3.1 Implementation

```typescript
// ============================================================================
// GROUNDING CONSTRUCTOR
// ============================================================================

/**
 * Options for constructing grounding relations.
 */
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
 * - ground and grounded must be valid EpistemicObjects
 * - type must be a valid GroundingType
 * - If type is 'full', strength must be 1.0
 *
 * POSTCONDITIONS:
 * - Returns a valid Grounding object
 * - Grounding is indexed in both ground and grounded
 * - If validate is true, coherence is checked
 *
 * INVARIANTS:
 * - Grounding is asymmetric: GROUNDS(X,Y) implies not GROUNDS(Y,X)
 * - Grounding is irreflexive: not GROUNDS(X,X)
 * - Full grounding implies maximum strength
 *
 * @param ground - The object providing the ground
 * @param grounded - The object being grounded
 * @param type - Type of grounding relation
 * @param strength - Strength of the grounding (default: inferred from type)
 * @param options - Additional options
 * @returns The constructed Grounding
 * @throws GroundingError if validation fails
 */
export function constructGrounding(
  ground: EpistemicObject,
  grounded: EpistemicObject,
  type: GroundingType,
  strength?: GroundingStrength,
  options: GroundingOptions = {}
): Grounding {
  // Validate irreflexivity
  if (ground.id === grounded.id) {
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

  const grounding: Grounding = {
    id: createGroundingId(),
    ground: ground.id,
    grounded: grounded.id,
    type,
    strength: effectiveStrength,
    active: options.activate ?? true,
    explanation: options.explanation,
  };

  return grounding;
}

/**
 * Infer grounding strength from type.
 */
function inferGroundingStrength(type: GroundingType): GroundingStrength {
  const strengthMap: Record<GroundingType, number> = {
    full: 1.0,
    partial: 0.5,
    enabling: 0.3,
    undermining: 0.7,
    rebutting: 0.9,
    undercutting: 0.6,
  };

  return {
    value: strengthMap[type],
    basis: 'inferential',
  };
}

/**
 * Construct multiple groundings efficiently.
 */
export function constructGroundings(
  specifications: Array<{
    ground: EpistemicObject;
    grounded: EpistemicObject;
    type: GroundingType;
    strength?: GroundingStrength;
  }>,
  options: GroundingOptions = {}
): Grounding[] {
  return specifications.map(spec =>
    constructGrounding(spec.ground, spec.grounded, spec.type, spec.strength, options)
  );
}

/**
 * Error thrown when grounding construction fails.
 */
export class GroundingError extends Error {
  constructor(
    public readonly code: GroundingErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'GroundingError';
  }
}

export type GroundingErrorCode =
  | 'REFLEXIVITY_VIOLATION'
  | 'ASYMMETRY_VIOLATION'
  | 'STRENGTH_MISMATCH'
  | 'CYCLE_DETECTED'
  | 'INVALID_TYPE';
```

---

## 4. Coherence Network Constructor

### 4.1 Implementation

```typescript
// ============================================================================
// COHERENCE NETWORK CONSTRUCTOR
// ============================================================================

/**
 * Options for constructing coherence networks.
 */
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
 * Default coherence rules applied to all networks.
 */
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

/**
 * Construct a coherence network from objects and groundings.
 *
 * PRECONDITIONS:
 * - All objects must be valid EpistemicObjects
 * - All groundings must reference objects in the network
 * - If levels provided, they must have unique positions
 *
 * POSTCONDITIONS:
 * - Returns a valid CoherenceNetwork
 * - All objects are indexed by ID
 * - All groundings are indexed by ID
 * - If validate is true, coherence is checked
 *
 * INVARIANTS:
 * - Network is self-contained (no dangling references)
 * - Coherence status is always computable
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
  const objectMap = new Map<EpistemicObjectId, EpistemicObject>();
  for (const obj of objects) {
    if (objectMap.has(obj.id)) {
      throw new NetworkError('DUPLICATE_OBJECT', `Duplicate object ID: ${obj.id}`);
    }
    objectMap.set(obj.id, obj);
  }

  // Validate groundings reference existing objects
  const groundingMap = new Map<GroundingId, Grounding>();
  for (const grounding of groundings) {
    if (!objectMap.has(grounding.ground)) {
      throw new NetworkError(
        'DANGLING_REFERENCE',
        `Grounding references non-existent ground: ${grounding.ground}`
      );
    }
    if (!objectMap.has(grounding.grounded)) {
      throw new NetworkError(
        'DANGLING_REFERENCE',
        `Grounding references non-existent grounded: ${grounding.grounded}`
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

/**
 * Error thrown when network construction fails.
 */
export class NetworkError extends Error {
  constructor(
    public readonly code: NetworkErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'NetworkError';
  }
}

export type NetworkErrorCode =
  | 'DUPLICATE_OBJECT'
  | 'DANGLING_REFERENCE'
  | 'INVALID_LEVEL'
  | 'COHERENCE_FAILURE';
```

---

## 5. Abstraction Level Constructor

### 5.1 Implementation

```typescript
// ============================================================================
// ABSTRACTION LEVEL CONSTRUCTOR
// ============================================================================

/**
 * Construct an abstraction level for hierarchical organization.
 *
 * Levels organize epistemic objects by their position in grounding chains.
 * Objects at higher levels are grounded in objects at lower levels.
 *
 * Entrenchment determines resistance to revision:
 * - 1.0 = maximally entrenched (rarely revised)
 * - 0.0 = minimally entrenched (easily revised)
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
  // Validate entrenchment bounds
  if (entrenchment < 0 || entrenchment > 1) {
    throw new Error(`Entrenchment must be in [0, 1], got ${entrenchment}`);
  }

  // Validate position is non-negative
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
  levelNames: string[],
  entrenchmentValues?: number[]
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

/**
 * Assign an object to a level based on its grounding depth.
 *
 * @param object - The object to assign
 * @param network - The coherence network containing the object
 * @returns The appropriate level, or undefined if cannot be determined
 */
export function inferObjectLevel(
  object: EpistemicObject,
  network: CoherenceNetwork
): AbstractionLevel | undefined {
  if (!network.levels || network.levels.length === 0) {
    return undefined;
  }

  // Compute grounding depth
  const depth = computeGroundingDepth(object.id, network);

  // Map depth to level
  const levelIndex = Math.min(depth, network.levels.length - 1);
  return network.levels[levelIndex];
}

/**
 * Compute the grounding depth of an object.
 * Depth 0 = no groundings (foundation)
 * Depth n = max depth of grounds + 1
 */
function computeGroundingDepth(
  objectId: EpistemicObjectId,
  network: CoherenceNetwork,
  visited: Set<string> = new Set()
): number {
  if (visited.has(objectId)) {
    return 0; // Cycle detected, treat as foundation
  }
  visited.add(objectId);

  // Find all groundings where this object is grounded
  const myGroundings = Array.from(network.groundings.values()).filter(
    g => g.grounded === objectId && g.active
  );

  if (myGroundings.length === 0) {
    return 0; // No groundings = foundation
  }

  // Depth = max depth of grounds + 1
  let maxGroundDepth = 0;
  for (const grounding of myGroundings) {
    const groundDepth = computeGroundingDepth(grounding.ground, network, visited);
    maxGroundDepth = Math.max(maxGroundDepth, groundDepth);
  }

  return maxGroundDepth + 1;
}
```

---

## 6. Derivation Constructor

### 6.1 Implementation

```typescript
// ============================================================================
// DERIVATION CONSTRUCTOR
// ============================================================================

/**
 * Construct a derived object from source objects.
 *
 * Derivation tracks how new knowledge emerges from existing knowledge.
 * The formula specifies how sources combine to produce the result.
 *
 * @param sources - Source objects to derive from
 * @param resultContent - Content of the derived object
 * @param formula - How sources combine
 * @param agent - Agent performing the derivation
 * @returns The derived object
 */
export function constructDerivation(
  sources: EpistemicObject[],
  resultContent: Content,
  formula: DerivationFormula,
  agent: Agent
): DerivedObject {
  // Validate sources
  if (sources.length === 0) {
    throw new DerivationError('EMPTY_SOURCES', 'Derivation requires at least one source');
  }

  // Compute derived attitude based on formula and source attitudes
  const derivedAttitude = computeDerivedAttitude(sources, formula);

  // Compute derived strength
  const derivedStrength = computeDerivedStrength(sources, formula);

  const now = new Date().toISOString();

  const derivedObject: DerivedObject = {
    id: createEpistemicObjectId(),
    content: resultContent,
    attitude: {
      type: derivedAttitude,
      strength: derivedStrength,
    },
    agent,
    groundings: [], // Groundings will be added separately
    metadata: {
      createdAt: now,
      source: {
        type: 'derivation',
        description: formula.description,
      },
      status: 'active',
    },
    schemaVersion: '1.0.0',
    derivation: formula,
    sources: sources.map(s => s.id),
    derivedAt: now,
  };

  return derivedObject;
}

/**
 * Compute the derived attitude type based on formula and sources.
 */
function computeDerivedAttitude(
  sources: EpistemicObject[],
  formula: DerivationFormula
): AttitudeType {
  const attitudes = sources.map(s => s.attitude.type);

  switch (formula.type) {
    case 'conjunction':
      // All must accept for conjunction to accept
      return attitudes.every(a => a === 'accepting') ? 'accepting' : 'entertaining';

    case 'disjunction':
      // Any accepting makes disjunction accepting
      return attitudes.some(a => a === 'accepting') ? 'accepting' : 'entertaining';

    case 'inference':
      // Inference preserves accepting if premises accept
      return attitudes.every(a => a === 'accepting') ? 'accepting' : 'entertaining';

    case 'aggregation':
    case 'synthesis':
    case 'custom':
    default:
      // Default: entertaining (conservative)
      return 'entertaining';
  }
}

/**
 * Compute the derived strength based on formula and sources.
 */
function computeDerivedStrength(
  sources: EpistemicObject[],
  formula: DerivationFormula
): GradedStrength | undefined {
  const strengths = sources
    .map(s => s.attitude.strength?.value)
    .filter((v): v is number => v !== undefined);

  if (strengths.length === 0) {
    return undefined;
  }

  let derivedValue: number;

  switch (formula.type) {
    case 'conjunction':
      // Conjunction: minimum (weakest link)
      derivedValue = Math.min(...strengths);
      break;

    case 'disjunction':
      // Disjunction: maximum (strongest option)
      derivedValue = Math.max(...strengths);
      break;

    case 'inference':
      // Inference: product (chain rule)
      derivedValue = strengths.reduce((a, b) => a * b, 1);
      break;

    case 'aggregation':
      // Aggregation: average
      derivedValue = strengths.reduce((a, b) => a + b, 0) / strengths.length;
      break;

    case 'synthesis':
    case 'custom':
    default:
      // Default: minimum (conservative)
      derivedValue = Math.min(...strengths);
  }

  return {
    value: derivedValue,
    provenance: {
      type: 'derived',
      formula: formula.description,
      inputs: sources
        .filter(s => s.attitude.strength)
        .map(s => s.attitude.strength!),
    },
  };
}

/**
 * Error thrown when derivation fails.
 */
export class DerivationError extends Error {
  constructor(
    public readonly code: DerivationErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'DerivationError';
  }
}

export type DerivationErrorCode =
  | 'EMPTY_SOURCES'
  | 'INCONSISTENT_ATTITUDES'
  | 'INVALID_FORMULA';
```

---

## 7. Coherence Evaluator

### 7.1 Implementation

```typescript
// ============================================================================
// COHERENCE EVALUATOR
// ============================================================================

/**
 * Evaluate the coherence of a structure.
 *
 * This is the primary function for checking whether a network
 * of epistemic objects maintains internal consistency.
 *
 * @param structure - Network or array of objects to evaluate
 * @param context - Optional evaluation context
 * @returns Detailed coherence evaluation
 */
export function evaluateCoherence(
  structure: CoherenceNetwork | EpistemicObject[],
  context?: EvaluationContext
): CoherenceEvaluation {
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
 * Check for contradictions between accepting objects.
 */
function checkNoContradictions(
  rule: CoherenceRule,
  network: CoherenceNetwork
): CoherenceViolation[] {
  const violations: CoherenceViolation[] = [];

  // Get all accepting objects
  const acceptingObjects = Array.from(network.objects.values()).filter(
    obj => obj.attitude.type === 'accepting'
  );

  // Check for contradictory pairs (via undermining/rebutting groundings)
  for (const grounding of network.groundings.values()) {
    if (grounding.type === 'undermining' || grounding.type === 'rebutting') {
      const ground = network.objects.get(grounding.ground);
      const grounded = network.objects.get(grounding.grounded);

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
 * Find all cycles in the grounding graph.
 */
function findGroundingCycles(network: CoherenceNetwork): EpistemicObjectId[][] {
  const cycles: EpistemicObjectId[][] = [];
  const visited = new Set<string>();
  const recursionStack = new Set<string>();
  const path: EpistemicObjectId[] = [];

  // Build adjacency list (ground -> grounded)
  const adjacency = new Map<EpistemicObjectId, EpistemicObjectId[]>();
  for (const obj of network.objects.keys()) {
    adjacency.set(obj, []);
  }
  for (const grounding of network.groundings.values()) {
    if (grounding.active && grounding.type !== 'undermining' && grounding.type !== 'rebutting') {
      const list = adjacency.get(grounding.ground) ?? [];
      list.push(grounding.grounded);
      adjacency.set(grounding.ground, list);
    }
  }

  function dfs(nodeId: EpistemicObjectId): void {
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
      g => g.grounded === obj.id && g.active && g.type !== 'undermining' && g.type !== 'rebutting'
    );

    // Check that grounds are at lower levels
    for (const grounding of objGroundings) {
      const ground = network.objects.get(grounding.ground);
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
      g => g.grounded === obj.id && g.active && g.type !== 'undermining' && g.type !== 'rebutting'
    );

    if (objGroundings.length === 0) {
      violations.push({
        rule,
        objects: [obj.id],
        explanation: `Object ${obj.id} has no grounding`,
        remediation: 'Add grounding relations or mark as foundation',
      });
    } else {
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
  // Find connected components
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
 * Find connected components in the network.
 */
function findConnectedComponents(network: CoherenceNetwork): EpistemicObjectId[][] {
  const visited = new Set<string>();
  const components: EpistemicObjectId[][] = [];

  // Build undirected adjacency
  const adjacency = new Map<EpistemicObjectId, Set<EpistemicObjectId>>();
  for (const obj of network.objects.keys()) {
    adjacency.set(obj, new Set());
  }
  for (const grounding of network.groundings.values()) {
    if (grounding.active) {
      adjacency.get(grounding.ground)?.add(grounding.grounded);
      adjacency.get(grounding.grounded)?.add(grounding.ground);
    }
  }

  function bfs(start: EpistemicObjectId): EpistemicObjectId[] {
    const component: EpistemicObjectId[] = [];
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
 * Analyze the grounding structure of a network.
 */
function analyzeGrounding(network: CoherenceNetwork): GroundingAnalysis {
  const allGroundings = Array.from(network.groundings.values());
  const activeGroundings = allGroundings.filter(g => g.active);

  // Find foundations (objects with no positive grounding)
  const grounded = new Set<string>();
  for (const g of activeGroundings) {
    if (g.type !== 'undermining' && g.type !== 'rebutting' && g.type !== 'undercutting') {
      grounded.add(g.grounded);
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
    foundations: foundations as EpistemicObjectId[],
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
): Map<EpistemicObjectId, ObjectEvaluation> {
  const evaluations = new Map<EpistemicObjectId, ObjectEvaluation>();

  for (const [objectId, obj] of network.objects) {
    // Find groundings
    const positiveGroundings = Array.from(network.groundings.values()).filter(
      g => g.grounded === objectId && g.active &&
           g.type !== 'undermining' && g.type !== 'rebutting' && g.type !== 'undercutting'
    );

    // Find defeaters
    const defeaters = Array.from(network.groundings.values()).filter(
      g => g.grounded === objectId && g.active &&
           (g.type === 'undermining' || g.type === 'rebutting' || g.type === 'undercutting')
    );

    // Compute effective strength
    const positiveStrength = positiveGroundings.reduce((sum, g) => sum + g.strength.value, 0);
    const defeatStrength = defeaters.reduce((sum, g) => sum + g.strength.value, 0);
    const effectiveStrength = Math.max(0, positiveStrength - defeatStrength);

    // Determine grounding status
    let groundingStatus: 'grounded' | 'partially_grounded' | 'ungrounded';
    if (effectiveStrength >= context.standards.minimumGroundingStrength) {
      groundingStatus = 'grounded';
    } else if (effectiveStrength > 0) {
      groundingStatus = 'partially_grounded';
    } else {
      groundingStatus = 'ungrounded';
    }

    // Check for contradictions
    const contradictedBy: EpistemicObjectId[] = [];
    for (const g of network.groundings.values()) {
      if ((g.type === 'undermining' || g.type === 'rebutting') &&
          g.grounded === objectId && g.active) {
        const ground = network.objects.get(g.ground);
        if (ground?.attitude.type === 'accepting') {
          contradictedBy.push(g.ground);
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
  objectEvaluations: Map<EpistemicObjectId, ObjectEvaluation>
): number {
  // Start at 1.0 and deduct for violations
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
  objectEvaluations: Map<EpistemicObjectId, ObjectEvaluation>,
  groundingAnalysis: GroundingAnalysis
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
```

---

## 8. Domain Presets

### 8.1 Software Development Preset

```typescript
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
 *
 * Models the philosophy -> principles -> architecture -> design -> implementation
 * hierarchy common in software engineering.
 */
export const SOFTWARE_DEV_PRESET: PresetConfig = {
  id: 'software_development',
  name: 'Software Development',
  description: 'For software projects: philosophy guides principles, which guide architecture, design, and implementation',

  levels: [
    'philosophy',       // Why we build software this way
    'principles',       // Guiding rules derived from philosophy
    'architecture',     // System-level structure
    'design',           // Component-level decisions
    'implementation',   // Actual code
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

  guidance: `
    Use this preset for software projects where you want to trace implementation
    decisions back to design, architecture, principles, and ultimately philosophy.

    Higher levels (philosophy, principles) should be more stable and harder to revise.
    Lower levels (design, implementation) are more flexible and frequently changed.

    When conflicts arise, prefer revising lower-level objects over higher-level ones.
  `,
};

/**
 * Scientific Method Preset
 *
 * Models the theory -> hypothesis -> prediction -> experiment -> data -> conclusion
 * hierarchy of scientific reasoning.
 */
export const SCIENTIFIC_METHOD_PRESET: PresetConfig = {
  id: 'scientific_method',
  name: 'Scientific Method',
  description: 'For scientific inquiry: theories generate hypotheses, predictions, experiments, and conclusions',

  levels: [
    'theory',       // Fundamental explanatory frameworks
    'hypothesis',   // Testable claims derived from theory
    'prediction',   // Specific expected outcomes
    'experiment',   // Methods for testing
    'data',         // Observed results
    'conclusion',   // What the data shows
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
    {
      id: 'conclusion_grounds_theory',
      description: 'Conclusions can ground or defeat theories (bidirectional)',
      type: 'custom',
      severity: 'info',
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

  guidance: `
    Use this preset for scientific reasoning where you want to track the flow
    from theory to evidence and back.

    Key insight: This is bidirectional. Theories ground hypotheses and predictions,
    but data and conclusions can also revise or defeat theories.

    Data has low entrenchment (easily revised with new observations).
    Conclusions have moderate entrenchment (can be revised but with care).
    Theories have high entrenchment (only revised under strong evidence).
  `,
};

/**
 * Legal Reasoning Preset
 *
 * Models the constitution -> statute -> precedent -> rule -> application
 * hierarchy of legal analysis.
 */
export const LEGAL_REASONING_PRESET: PresetConfig = {
  id: 'legal_reasoning',
  name: 'Legal Reasoning',
  description: 'For legal analysis: constitutional principles guide statutes, precedents, rules, and applications',

  levels: [
    'constitution',  // Fundamental law
    'statute',       // Enacted legislation
    'precedent',     // Prior court decisions
    'rule',          // Derived legal rules
    'application',   // Application to specific facts
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
    {
      id: 'stare_decisis',
      description: 'Later precedents should not contradict earlier without justification',
      type: 'custom',
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

  guidance: `
    Use this preset for legal reasoning where authority flows from higher
    sources (constitution) to lower applications.

    Constitutional provisions are maximally entrenched.
    Statutes can be revised by legislature but not by courts.
    Precedents can be overruled but with strong justification.
    Rules and applications are more flexible.
  `,
};

/**
 * Medical Diagnosis Preset
 *
 * Models the pathophysiology -> symptom -> sign -> test -> diagnosis -> treatment
 * hierarchy of medical reasoning.
 */
export const MEDICAL_DIAGNOSIS_PRESET: PresetConfig = {
  id: 'medical_diagnosis',
  name: 'Medical Diagnosis',
  description: 'For medical reasoning: pathophysiology explains symptoms and signs, guiding tests, diagnosis, and treatment',

  levels: [
    'pathophysiology',  // Disease mechanisms
    'symptom',          // Patient-reported experiences
    'sign',             // Observable findings
    'test',             // Diagnostic tests
    'diagnosis',        // Concluded condition
    'treatment',        // Therapeutic interventions
  ],

  groundingDirection: 'bidirectional',

  defaultEntrenchment: [0.8, 0.4, 0.5, 0.6, 0.7, 0.5],

  coherenceRules: [
    ...DEFAULT_COHERENCE_RULES,
    {
      id: 'symptom_from_pathophysiology',
      description: 'Symptoms should be explainable by pathophysiology',
      type: 'level_grounding',
      severity: 'info',
    },
    {
      id: 'diagnosis_from_signs_tests',
      description: 'Diagnosis must be grounded in signs and tests',
      type: 'level_grounding',
      severity: 'error',
    },
    {
      id: 'treatment_from_diagnosis',
      description: 'Treatment must be appropriate for diagnosis',
      type: 'level_grounding',
      severity: 'error',
    },
    {
      id: 'test_indicated_by_symptoms',
      description: 'Tests should be indicated by symptoms and signs',
      type: 'custom',
      severity: 'warning',
    },
  ],

  typicalContent: {
    pathophysiology: ['propositional'],
    symptom: ['propositional', 'perceptual'],
    sign: ['propositional', 'perceptual'],
    test: ['structured', 'procedural'],
    diagnosis: ['propositional', 'structured'],
    treatment: ['procedural', 'imperative'],
  },

  guidance: `
    Use this preset for medical diagnostic reasoning.

    Key insight: This is bidirectional and probabilistic. Pathophysiology
    predicts symptoms, but symptoms also provide evidence for diagnosis.

    Symptoms have low entrenchment (patient reports can be unreliable).
    Signs have moderate entrenchment (objective but still interpretive).
    Tests have higher entrenchment (objective measurements).
    Diagnosis has moderate-high entrenchment (but can be revised).
  `,
};

/**
 * Project Management Preset
 *
 * Models the vision -> goals -> objectives -> milestones -> tasks
 * hierarchy of project planning.
 */
export const PROJECT_MANAGEMENT_PRESET: PresetConfig = {
  id: 'project_management',
  name: 'Project Management',
  description: 'For project planning: vision drives goals, objectives, milestones, and tasks',

  levels: [
    'vision',       // Long-term aspiration
    'goals',        // Strategic outcomes
    'objectives',   // Measurable targets
    'milestones',   // Key checkpoints
    'tasks',        // Individual work items
  ],

  groundingDirection: 'down',

  defaultEntrenchment: [0.95, 0.85, 0.7, 0.5, 0.3],

  coherenceRules: [
    ...DEFAULT_COHERENCE_RULES,
    {
      id: 'goal_from_vision',
      description: 'Goals should advance the vision',
      type: 'level_grounding',
      severity: 'warning',
    },
    {
      id: 'objective_from_goal',
      description: 'Objectives should contribute to goals',
      type: 'level_grounding',
      severity: 'warning',
    },
    {
      id: 'task_from_milestone',
      description: 'Tasks should contribute to milestones',
      type: 'level_grounding',
      severity: 'info',
    },
    {
      id: 'no_orphan_tasks',
      description: 'All tasks should be linked to objectives',
      type: 'coverage',
      severity: 'warning',
    },
  ],

  typicalContent: {
    vision: ['propositional'],
    goals: ['propositional'],
    objectives: ['propositional', 'structured'],
    milestones: ['structured'],
    tasks: ['procedural', 'imperative'],
  },

  guidance: `
    Use this preset for project planning where work traces back to vision.

    Vision is highly stable (rarely changes).
    Goals change slowly (quarterly/yearly).
    Objectives change moderately (monthly/quarterly).
    Milestones change as needed (weekly/monthly).
    Tasks change frequently (daily/weekly).
  `,
};

/**
 * Argument Analysis Preset
 *
 * Models the claim -> warrant -> backing -> evidence -> qualifier
 * structure of Toulmin arguments.
 */
export const ARGUMENT_ANALYSIS_PRESET: PresetConfig = {
  id: 'argument_analysis',
  name: 'Argument Analysis (Toulmin)',
  description: 'For analyzing arguments: evidence supports claims via warrants and backing',

  levels: [
    'backing',      // Foundational support for warrants
    'warrant',      // General principle connecting evidence to claim
    'evidence',     // Specific data/facts
    'qualifier',    // Strength modifiers
    'claim',        // The conclusion
    'rebuttal',     // Counter-considerations
  ],

  groundingDirection: 'bidirectional',

  defaultEntrenchment: [0.8, 0.7, 0.5, 0.3, 0.6, 0.4],

  coherenceRules: [
    ...DEFAULT_COHERENCE_RULES,
    {
      id: 'claim_from_evidence_warrant',
      description: 'Claims must be supported by evidence via warrants',
      type: 'level_grounding',
      severity: 'error',
    },
    {
      id: 'warrant_from_backing',
      description: 'Warrants should be supported by backing',
      type: 'level_grounding',
      severity: 'warning',
    },
    {
      id: 'rebuttal_defeats_claim',
      description: 'Rebuttals can defeat claims',
      type: 'custom',
      severity: 'info',
    },
  ],

  typicalContent: {
    backing: ['propositional'],
    warrant: ['propositional'],
    evidence: ['propositional', 'perceptual', 'structured'],
    qualifier: ['propositional'],
    claim: ['propositional'],
    rebuttal: ['propositional'],
  },

  guidance: `
    Use this preset for analyzing and constructing arguments.

    Based on the Toulmin model of argumentation:
    - Evidence (data) supports Claims
    - Warrants explain why evidence supports the claim
    - Backing provides support for warrants
    - Qualifiers indicate strength ("possibly", "probably")
    - Rebuttals are counter-considerations

    Rebuttals act as defeaters in the grounding network.
  `,
};

/**
 * All available presets.
 */
export const DOMAIN_PRESETS: Record<string, PresetConfig> = {
  software_development: SOFTWARE_DEV_PRESET,
  scientific_method: SCIENTIFIC_METHOD_PRESET,
  legal_reasoning: LEGAL_REASONING_PRESET,
  medical_diagnosis: MEDICAL_DIAGNOSIS_PRESET,
  project_management: PROJECT_MANAGEMENT_PRESET,
  argument_analysis: ARGUMENT_ANALYSIS_PRESET,
};
```

---

## 9. Auto-Configuration

### 9.1 Structure Inference

```typescript
// ============================================================================
// AUTO-CONFIGURATION
// ============================================================================

/**
 * Result of inferring coherence structure.
 */
export interface InferredStructure {
  /** Suggested preset (if one matches well) */
  suggestedPreset?: PresetConfig;

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
 * This analyzes the objects to suggest an appropriate preset and configuration.
 *
 * @param objects - Objects to analyze
 * @returns Inferred structure with reasoning
 */
export function inferCoherenceStructure(
  objects: EpistemicObject[]
): InferredStructure {
  const reasoning: string[] = [];

  // Analyze content types
  const contentTypes = new Map<ContentType, number>();
  for (const obj of objects) {
    const type = obj.content.contentType;
    contentTypes.set(type, (contentTypes.get(type) ?? 0) + 1);
  }

  // Analyze existing groundings
  const groundingPatterns = analyzeGroundingPatterns(objects);

  // Analyze attitude distribution
  const attitudes = new Map<AttitudeType, number>();
  for (const obj of objects) {
    const type = obj.attitude.type;
    attitudes.set(type, (attitudes.get(type) ?? 0) + 1);
  }

  // Score each preset
  const presetScores: Array<{ preset: PresetConfig; score: number }> = [];

  for (const preset of Object.values(DOMAIN_PRESETS)) {
    const score = scorePresetFit(preset, contentTypes, groundingPatterns, attitudes);
    presetScores.push({ preset, score });
  }

  // Sort by score
  presetScores.sort((a, b) => b.score - a.score);

  const bestMatch = presetScores[0];

  if (bestMatch.score > 0.5) {
    reasoning.push(`Best matching preset: ${bestMatch.preset.name} (score: ${bestMatch.score.toFixed(2)})`);

    return {
      suggestedPreset: bestMatch.preset,
      confidence: bestMatch.score,
      levels: constructHierarchy(
        bestMatch.preset.levels as string[],
        bestMatch.preset.defaultEntrenchment as number[]
      ),
      groundingDirection: bestMatch.preset.groundingDirection,
      reasoning,
    };
  }

  // No good preset match - infer custom structure
  reasoning.push('No preset matched well, inferring custom structure');

  // Infer levels from grounding depth
  const depths = new Set<number>();
  for (const obj of objects) {
    const depth = inferObjectDepth(obj, objects);
    depths.add(depth);
  }

  const levelCount = depths.size;
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
    groundingDirection: groundingPatterns.bidirectional ? 'bidirectional' : 'down',
    reasoning,
  };
}

/**
 * Analyze grounding patterns in objects.
 */
function analyzeGroundingPatterns(
  objects: EpistemicObject[]
): { bidirectional: boolean; cyclic: boolean; depth: number } {
  // Build quick grounding index
  const groundedBy = new Map<string, string[]>();
  const grounds = new Map<string, string[]>();

  for (const obj of objects) {
    for (const g of obj.groundings) {
      const list = groundedBy.get(g.grounded) ?? [];
      list.push(g.ground);
      groundedBy.set(g.grounded, list);

      const list2 = grounds.get(g.ground) ?? [];
      list2.push(g.grounded);
      grounds.set(g.ground, list2);
    }
  }

  // Check for bidirectional patterns
  let bidirectional = false;
  for (const obj of objects) {
    const myGrounders = groundedBy.get(obj.id) ?? [];
    const iGround = grounds.get(obj.id) ?? [];

    // If I ground something that grounds me, it's bidirectional
    for (const g of myGrounders) {
      if (iGround.includes(g)) {
        bidirectional = true;
        break;
      }
    }
    if (bidirectional) break;
  }

  // Compute max depth
  let maxDepth = 0;
  for (const obj of objects) {
    const depth = inferObjectDepth(obj, objects);
    maxDepth = Math.max(maxDepth, depth);
  }

  return { bidirectional, cyclic: false, depth: maxDepth };
}

/**
 * Infer the depth of an object based on its groundings.
 */
function inferObjectDepth(
  obj: EpistemicObject,
  allObjects: EpistemicObject[],
  visited: Set<string> = new Set()
): number {
  if (visited.has(obj.id)) return 0;
  visited.add(obj.id);

  if (obj.groundings.length === 0) return 0;

  let maxGroundDepth = 0;
  for (const g of obj.groundings) {
    if (g.type === 'undermining' || g.type === 'rebutting' || g.type === 'undercutting') {
      continue;
    }

    const ground = allObjects.find(o => o.id === g.ground);
    if (ground) {
      const groundDepth = inferObjectDepth(ground, allObjects, visited);
      maxGroundDepth = Math.max(maxGroundDepth, groundDepth);
    }
  }

  return maxGroundDepth + 1;
}

/**
 * Score how well a preset fits the observed patterns.
 */
function scorePresetFit(
  preset: PresetConfig,
  contentTypes: Map<ContentType, number>,
  groundingPatterns: { bidirectional: boolean; depth: number },
  attitudes: Map<AttitudeType, number>
): number {
  let score = 0;

  // Check grounding direction match
  if (preset.groundingDirection === 'bidirectional' && groundingPatterns.bidirectional) {
    score += 0.3;
  } else if (preset.groundingDirection !== 'bidirectional' && !groundingPatterns.bidirectional) {
    score += 0.2;
  }

  // Check depth match
  if (groundingPatterns.depth <= preset.levels.length) {
    score += 0.3;
  }

  // Check content type match
  if (preset.typicalContent) {
    let typeMatches = 0;
    for (const [type, count] of contentTypes) {
      for (const levelContent of Object.values(preset.typicalContent)) {
        if (levelContent.includes(type)) {
          typeMatches += count;
          break;
        }
      }
    }
    const totalContent = Array.from(contentTypes.values()).reduce((a, b) => a + b, 0);
    score += 0.4 * (typeMatches / Math.max(1, totalContent));
  }

  return score;
}

/**
 * Suggest a preset based on a domain hint.
 *
 * @param domainHint - Free-text hint about the domain
 * @returns Suggested preset configuration
 */
export function suggestPreset(domainHint: string): PresetConfig {
  const hint = domainHint.toLowerCase();

  // Keyword matching
  const keywords: Record<string, string> = {
    'software': 'software_development',
    'code': 'software_development',
    'programming': 'software_development',
    'architecture': 'software_development',
    'science': 'scientific_method',
    'research': 'scientific_method',
    'experiment': 'scientific_method',
    'hypothesis': 'scientific_method',
    'law': 'legal_reasoning',
    'legal': 'legal_reasoning',
    'court': 'legal_reasoning',
    'statute': 'legal_reasoning',
    'medical': 'medical_diagnosis',
    'diagnosis': 'medical_diagnosis',
    'patient': 'medical_diagnosis',
    'treatment': 'medical_diagnosis',
    'project': 'project_management',
    'planning': 'project_management',
    'task': 'project_management',
    'milestone': 'project_management',
    'argument': 'argument_analysis',
    'debate': 'argument_analysis',
    'claim': 'argument_analysis',
    'evidence': 'argument_analysis',
  };

  for (const [keyword, presetId] of Object.entries(keywords)) {
    if (hint.includes(keyword)) {
      return DOMAIN_PRESETS[presetId];
    }
  }

  // Default to software development
  return SOFTWARE_DEV_PRESET;
}

/**
 * Adapt a preset to specific needs.
 *
 * @param preset - Base preset to adapt
 * @param customizations - Customizations to apply
 * @returns Adapted preset configuration
 */
export function adaptPreset(
  preset: PresetConfig,
  customizations: Partial<PresetConfig>
): PresetConfig {
  return {
    ...preset,
    ...customizations,
    id: customizations.id ?? `${preset.id}_custom`,
    name: customizations.name ?? `${preset.name} (Customized)`,
    levels: customizations.levels ?? preset.levels,
    coherenceRules: [
      ...(preset.coherenceRules as CoherenceRule[]),
      ...((customizations.coherenceRules as CoherenceRule[]) ?? []),
    ],
    defaultEntrenchment: customizations.defaultEntrenchment ?? preset.defaultEntrenchment,
  };
}
```

---

## 10. Integration Mapping

### 10.1 Mapping to Librarian Types

```typescript
// ============================================================================
// INTEGRATION WITH LIBRARIAN EPISTEMICS
// ============================================================================

/**
 * Mapping between Universal Coherence types and Librarian types.
 *
 * This section defines how the universal primitives map to
 * the existing Librarian epistemic infrastructure.
 */

import type { ConfidenceValue as LibrarianConfidenceValue } from '../epistemics/confidence.js';
import type { Claim as LibrarianClaim, EvidenceGraph } from '../epistemics/types.js';
import type { ExtendedDefeater as LibrarianDefeater } from '../epistemics/types.js';
import type { EvidenceEntry, IEvidenceLedger } from '../epistemics/evidence_ledger.js';

/**
 * Convert a Librarian ConfidenceValue to a universal GradedStrength.
 */
export function confidenceToGradedStrength(
  confidence: LibrarianConfidenceValue
): GradedStrength | undefined {
  switch (confidence.type) {
    case 'deterministic':
      return {
        value: confidence.value,
        provenance: {
          type: 'assigned',
          reason: confidence.reason,
        },
      };

    case 'derived':
      return {
        value: confidence.value,
        provenance: {
          type: 'derived',
          formula: confidence.formula,
          inputs: confidence.inputs.map(i =>
            confidenceToGradedStrength(i.confidence)!
          ).filter(Boolean),
        },
      };

    case 'measured':
      return {
        value: confidence.value,
        provenance: {
          type: 'measured',
          measurement: {
            datasetId: confidence.measurement.datasetId,
            sampleSize: confidence.measurement.sampleSize,
            accuracy: confidence.measurement.accuracy,
          },
        },
      };

    case 'bounded':
      return {
        value: (confidence.low + confidence.high) / 2,
        provenance: {
          type: 'bounded',
          low: confidence.low,
          high: confidence.high,
          basis: confidence.citation,
        },
      };

    case 'absent':
      return undefined;
  }
}

/**
 * Convert a universal GradedStrength to a Librarian ConfidenceValue.
 */
export function gradedStrengthToConfidence(
  strength: GradedStrength
): LibrarianConfidenceValue {
  switch (strength.provenance.type) {
    case 'measured':
      return {
        type: 'measured',
        value: strength.value,
        measurement: {
          datasetId: strength.provenance.measurement.datasetId,
          sampleSize: strength.provenance.measurement.sampleSize,
          accuracy: strength.provenance.measurement.accuracy,
          confidenceInterval: [strength.value - 0.1, strength.value + 0.1],
          measuredAt: new Date().toISOString(),
        },
      };

    case 'derived':
      return {
        type: 'derived',
        value: strength.value,
        formula: strength.provenance.formula,
        inputs: strength.provenance.inputs.map((input, i) => ({
          name: `input_${i}`,
          confidence: gradedStrengthToConfidence(input),
        })),
      };

    case 'bounded':
      return {
        type: 'bounded',
        low: strength.provenance.low,
        high: strength.provenance.high,
        basis: 'theoretical',
        citation: strength.provenance.basis,
      };

    case 'assigned':
    default:
      return {
        type: 'deterministic',
        value: strength.value >= 0.5 ? 1.0 : 0.0,
        reason: strength.provenance.reason ?? 'assigned',
      };
  }
}

/**
 * Convert a Librarian Claim to a universal EpistemicObject.
 */
export function claimToEpistemicObject(
  claim: LibrarianClaim,
  agent?: Agent
): EpistemicObject {
  return {
    id: claim.id as unknown as EpistemicObjectId,
    content: {
      id: `content_${claim.id}` as ContentId,
      data: claim.proposition,
      contentType: 'propositional',
      hash: claim.id,
    },
    attitude: {
      type: claim.status === 'active' ? 'accepting' :
            claim.status === 'defeated' ? 'rejecting' : 'suspending',
      strength: confidenceToGradedStrength(claim.confidence),
    },
    agent: agent ?? {
      id: claim.source.id as AgentId,
      type: claim.source.type === 'llm' ? 'ai' :
            claim.source.type === 'human' ? 'human' : 'ai',
      name: claim.source.id,
    },
    groundings: [],
    metadata: {
      createdAt: claim.createdAt,
      source: {
        type: claim.source.type,
        description: claim.source.id,
      },
      status: claim.status === 'active' ? 'active' :
              claim.status === 'defeated' ? 'defeated' :
              claim.status === 'superseded' ? 'superseded' : 'suspended',
    },
    schemaVersion: claim.schemaVersion,
  };
}

/**
 * Convert a universal EpistemicObject to a Librarian Claim.
 */
export function epistemicObjectToClaim(
  obj: EpistemicObject
): Omit<LibrarianClaim, 'signalStrength'> {
  return {
    id: obj.id as unknown as LibrarianClaim['id'],
    proposition: typeof obj.content.data === 'string'
      ? obj.content.data
      : JSON.stringify(obj.content.data),
    type: 'semantic',
    subject: {
      type: 'entity',
      id: obj.content.id,
      name: obj.content.id,
    },
    createdAt: obj.metadata.createdAt,
    source: {
      type: obj.agent.type === 'ai' ? 'llm' :
            obj.agent.type === 'human' ? 'human' : 'tool',
      id: obj.agent.id,
    },
    status: obj.metadata.status === 'active' ? 'active' :
            obj.metadata.status === 'defeated' ? 'defeated' :
            obj.metadata.status === 'superseded' ? 'superseded' : 'pending',
    confidence: obj.attitude.strength
      ? gradedStrengthToConfidence(obj.attitude.strength)
      : { type: 'absent', reason: 'uncalibrated' },
    schemaVersion: obj.schemaVersion,
  };
}

/**
 * Convert a Librarian EvidenceGraph to a universal CoherenceNetwork.
 */
export function evidenceGraphToCoherenceNetwork(
  graph: EvidenceGraph,
  presetId?: string
): CoherenceNetwork {
  const preset = presetId ? DOMAIN_PRESETS[presetId] : SOFTWARE_DEV_PRESET;

  // Convert claims to objects
  const objects: EpistemicObject[] = [];
  for (const claim of graph.claims.values()) {
    objects.push(claimToEpistemicObject(claim));
  }

  // Convert edges to groundings
  const groundings: Grounding[] = [];
  for (const edge of graph.edges) {
    const groundingType = edgeTypeToGroundingType(edge.type);
    groundings.push({
      id: edge.id as GroundingId,
      ground: edge.fromClaimId as unknown as EpistemicObjectId,
      grounded: edge.toClaimId as unknown as EpistemicObjectId,
      type: groundingType,
      strength: {
        value: edge.strength,
        basis: 'evidential',
      },
      active: true,
    });
  }

  // Add defeater groundings
  for (const defeater of graph.defeaters) {
    for (const claimId of defeater.affectedClaimIds) {
      groundings.push({
        id: `grounding_${defeater.id}_${claimId}` as GroundingId,
        ground: defeater.id as unknown as EpistemicObjectId,
        grounded: claimId as unknown as EpistemicObjectId,
        type: defeaterTypeToGroundingType(defeater.type),
        strength: {
          value: defeater.confidenceReduction,
          basis: 'evidential',
        },
        active: defeater.status === 'active',
      });
    }
  }

  return constructCoherenceNetwork(objects, groundings, {
    name: graph.workspace,
    levels: constructHierarchy(
      preset.levels as string[],
      preset.defaultEntrenchment as number[]
    ),
    groundingDirection: preset.groundingDirection,
    rules: preset.coherenceRules as CoherenceRule[],
    validate: false, // Don't validate during conversion
  });
}

/**
 * Convert edge type to grounding type.
 */
function edgeTypeToGroundingType(edgeType: string): GroundingType {
  switch (edgeType) {
    case 'supports':
      return 'partial';
    case 'opposes':
      return 'undermining';
    case 'assumes':
      return 'enabling';
    case 'defeats':
    case 'rebuts':
      return 'rebutting';
    case 'undercuts':
    case 'undermines':
      return 'undercutting';
    case 'supersedes':
      return 'full';
    case 'depends_on':
      return 'enabling';
    default:
      return 'partial';
  }
}

/**
 * Convert defeater type to grounding type.
 */
function defeaterTypeToGroundingType(defeaterType: string): GroundingType {
  switch (defeaterType) {
    case 'contradiction':
      return 'rebutting';
    case 'test_failure':
      return 'rebutting';
    case 'code_change':
    case 'staleness':
    case 'coverage_gap':
    case 'tool_failure':
    case 'sandbox_mismatch':
    case 'hash_mismatch':
    case 'dependency_drift':
    case 'schema_version':
      return 'undercutting';
    case 'new_info':
    case 'untrusted_content':
    case 'provider_unavailable':
      return 'undermining';
    default:
      return 'undermining';
  }
}

/**
 * Store a CoherenceNetwork as an EvidenceEntry.
 */
export async function storeNetworkAsEvidence(
  network: CoherenceNetwork,
  ledger: IEvidenceLedger,
  sessionId?: string
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
    sessionId: sessionId as any,
  });

  return entry;
}
```

---

## 11. Implementation Notes

### 11.1 ID Generation

```typescript
// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

import { randomUUID } from 'node:crypto';

/** Generate a unique ContentId */
export function createContentId(prefix: string = 'content'): ContentId {
  return `${prefix}_${randomUUID()}` as ContentId;
}

/** Generate a unique EpistemicObjectId */
export function createEpistemicObjectId(prefix: string = 'obj'): EpistemicObjectId {
  return `${prefix}_${randomUUID()}` as EpistemicObjectId;
}

/** Generate a unique GroundingId */
export function createGroundingId(prefix: string = 'grounding'): GroundingId {
  return `${prefix}_${randomUUID()}` as GroundingId;
}

/** Generate a unique NetworkId */
export function createNetworkId(prefix: string = 'network'): NetworkId {
  return `${prefix}_${randomUUID()}` as NetworkId;
}

/** Generate a unique AgentId */
export function createAgentId(prefix: string = 'agent'): AgentId {
  return `${prefix}_${randomUUID()}` as AgentId;
}
```

### 11.2 Content Construction

```typescript
/**
 * Construct content from various inputs.
 */
export function constructContent(
  data: unknown,
  options?: {
    contentType?: ContentType;
    schema?: ContentSchema;
    id?: ContentId;
  }
): Content {
  const contentType = options?.contentType ?? inferContentType(data);
  const hash = computeContentHash(data);

  return {
    id: options?.id ?? createContentId(),
    data,
    contentType,
    schema: options?.schema,
    hash,
  };
}

/**
 * Infer content type from data.
 */
function inferContentType(data: unknown): ContentType {
  if (typeof data === 'string') {
    // Simple heuristics
    if (data.endsWith('?')) return 'interrogative';
    if (data.startsWith('Do ') || data.startsWith('Please ')) return 'imperative';
    return 'propositional';
  }

  if (typeof data === 'function') return 'procedural';
  if (typeof data === 'object') return 'structured';

  return 'propositional';
}

/**
 * Compute hash of content data.
 */
function computeContentHash(data: unknown): string {
  const { createHash } = require('node:crypto');
  const serialized = JSON.stringify(data);
  return createHash('sha256').update(serialized).digest('hex').slice(0, 16);
}
```

### 11.3 Epistemic Object Construction

```typescript
/**
 * Options for constructing epistemic objects.
 */
export interface ConstructOptions {
  /** Agent holding this epistemic state */
  agent?: Agent;

  /** Initial groundings */
  groundings?: Grounding[];

  /** Abstraction level */
  level?: AbstractionLevel;

  /** Custom ID */
  id?: EpistemicObjectId;

  /** Source description */
  source?: SourceDescriptor;
}

/** Description of the source of an epistemic object */
export interface SourceDescriptor {
  type: string;
  description: string;
  version?: string;
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
  const agent = options.agent ?? createDefaultAgent();
  const now = new Date().toISOString();

  return {
    id: options.id ?? createEpistemicObjectId(),
    content,
    attitude,
    agent,
    groundings: options.groundings ?? [],
    level: options.level,
    metadata: {
      createdAt: now,
      source: options.source ?? { type: 'manual', description: 'Manually constructed' },
      status: 'active',
    },
    schemaVersion: '1.0.0',
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
```

### 11.4 Schema Version

```typescript
/** Current schema version for all universal coherence types */
export const UNIVERSAL_COHERENCE_SCHEMA_VERSION = '1.0.0';
```

---

## Summary

This design specification provides:

1. **Universal Constructors** (Section 1-7): Domain-agnostic functions for building any epistemic structure from the six primitives and four operations.

2. **Complete Type System** (Section 2): Full TypeScript type definitions for all primitives and constructed types, ensuring type safety.

3. **Six Domain Presets** (Section 8):
   - Software Development (philosophy -> implementation)
   - Scientific Method (theory -> conclusion)
   - Legal Reasoning (constitution -> application)
   - Medical Diagnosis (pathophysiology -> treatment)
   - Project Management (vision -> tasks)
   - Argument Analysis (Toulmin model)

4. **Auto-Configuration** (Section 9): Algorithms to infer appropriate structure from objects or domain hints.

5. **Integration Mapping** (Section 10): Complete mapping between universal types and existing Librarian epistemics.

The system is designed to be:
- **Universal**: Any epistemic domain can be modeled
- **Composable**: Complex structures emerge from simple operations
- **Practical**: Presets enable quick adoption
- **Extensible**: Custom presets and rules are supported
- **Integrated**: Maps cleanly to existing Librarian infrastructure

---

*This specification establishes the universal constructor system for building any epistemic structure from primitive building blocks, with practical presets for common domains and auto-configuration for ease of use.*
