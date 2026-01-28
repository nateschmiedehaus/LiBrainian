/**
 * @fileoverview Evidence Graph Types for Epistemic Engine
 *
 * Implements an explicit argument/evidence graph for knowledge validation.
 * Based on Pollock's defeaters and argumentation theory.
 *
 * Key principles:
 * - Every claim is a node with supports, opposes, assumptions, and defeaters
 * - Contradictions remain visible - never silently reconcile
 * - All defeaters are typed and computed
 *
 * References:
 * - Pollock, J.L. (1987) "Defeasible Reasoning"
 * - Dung, P.M. (1995) "On the Acceptability of Arguments"
 * - KDD 2025 "Uncertainty Quantification in LLMs"
 *
 * @packageDocumentation
 */

import { randomUUID } from 'node:crypto';
import type { ConfidenceValue } from './confidence.js';
import { absent, isConfidenceValue } from './confidence.js';

// ============================================================================
// SCHEMA VERSION
// ============================================================================

export const EVIDENCE_GRAPH_SCHEMA_VERSION = '1.0.0';

// ============================================================================
// CLAIM TYPES
// ============================================================================

/**
 * A claim in the evidence graph - the fundamental unit of knowledge.
 * Claims are propositions that can be supported, opposed, or defeated.
 */
export interface Claim {
  /** Unique identifier for this claim */
  id: ClaimId;

  /** The proposition being claimed (what is asserted) */
  proposition: string;

  /** Type of claim - affects how it's validated */
  type: ClaimType;

  /** Subject of the claim (entity, file, function, etc.) */
  subject: ClaimSubject;

  /** When this claim was created */
  createdAt: string;

  /** Source that generated this claim */
  source: ClaimSource;

  /** Current status of the claim */
  status: ClaimStatus;

  /** Epistemic claim confidence (Track D) */
  confidence: ConfidenceValue;

  /** Heuristic signal strength (non-calibrated) */
  signalStrength: ClaimSignalStrength;

  /** Schema version for forward compatibility */
  schemaVersion: string;
}

/** Branded type for claim IDs to prevent accidental mixing */
export type ClaimId = string & { readonly __brand: 'ClaimId' };

/** Helper to create a ClaimId */
export function createClaimId(id: string): ClaimId {
  return id as ClaimId;
}

/** Types of claims that can be made */
export type ClaimType =
  | 'semantic'          // What code does/means
  | 'structural'        // How code is organized
  | 'behavioral'        // How code behaves at runtime
  | 'quality'           // Code quality metrics
  | 'security'          // Security properties
  | 'contractual'       // API contracts and guarantees
  | 'relational'        // Relationships between entities
  | 'temporal'          // Time-based properties
  | 'ownership'         // Who owns/maintains code
  | 'provenance';       // Where knowledge came from

/** Subject of a claim - what the claim is about */
export interface ClaimSubject {
  /** Type of subject */
  type: 'entity' | 'file' | 'function' | 'module' | 'directory' | 'repo';

  /** Identifier for the subject */
  id: string;

  /** Human-readable name */
  name: string;

  /** Location in codebase (if applicable) */
  location?: {
    file: string;
    startLine?: number;
    endLine?: number;
  };
}

/** Source that generated a claim */
export interface ClaimSource {
  /** Type of source */
  type: 'llm' | 'static_analysis' | 'test' | 'human' | 'git' | 'tool' | 'inferred';

  /** Identifier (e.g., model ID, tool name) */
  id: string;

  /** Version of the source */
  version?: string;

  /** Trace ID for reproducibility */
  traceId?: string;
}

/** Status of a claim */
export type ClaimStatus =
  | 'active'            // Currently held as true
  | 'defeated'          // Invalidated by defeater
  | 'contradicted'      // In conflict with another claim
  | 'superseded'        // Replaced by newer claim
  | 'stale'             // Needs revalidation
  | 'pending';          // Awaiting validation

// ============================================================================
// CONFIDENCE DECOMPOSITION
// ============================================================================

/**
 * Decomposed confidence following the mandate's requirements.
 * Confidence is never a single number - it's always broken down by source.
 */
export interface ClaimSignalStrength {
  /** Overall signal strength (computed from components) */
  overall: number;

  /** Signal strength in retrieval accuracy */
  retrieval: number;

  /** Signal strength in structural analysis */
  structural: number;

  /** Signal strength in semantic understanding */
  semantic: number;

  /** Signal strength from test/execution evidence */
  testExecution: number;

  /** Signal strength based on recency */
  recency: number;

  /** How overall signal strength was computed */
  aggregationMethod: 'geometric_mean' | 'weighted_average' | 'minimum' | 'product';

  /** Weights used for aggregation */
  weights?: Record<string, number>;
}

/** Create default signal strength (unknown state) */
export function createDefaultSignalStrength(): ClaimSignalStrength {
  return {
    overall: 0.5,
    retrieval: 0.5,
    structural: 0.5,
    semantic: 0.5,
    testExecution: 0.5,
    recency: 0.5,
    aggregationMethod: 'geometric_mean',
  };
}

/** Compute overall signal strength using geometric mean */
export function computeOverallSignalStrength(conf: Omit<ClaimSignalStrength, 'overall'>): number {
  const values = [conf.retrieval, conf.structural, conf.semantic, conf.testExecution, conf.recency];
  const product = values.reduce((acc, v) => acc * v, 1);
  return Math.pow(product, 1 / values.length);
}

// ============================================================================
// EVIDENCE GRAPH EDGES
// ============================================================================

/**
 * An edge in the evidence graph connecting claims to evidence.
 */
export interface EvidenceEdge {
  /** Unique edge ID */
  id: string;

  /** Source claim ID */
  fromClaimId: ClaimId;

  /** Target claim ID (or evidence ID) */
  toClaimId: ClaimId;

  /** Type of relationship */
  type: EdgeType;

  /** Strength of the relationship (0-1) */
  strength: number;

  /** When this edge was created */
  createdAt: string;

  /** Optional metadata */
  metadata?: Record<string, unknown>;
}

/** Types of edges in the evidence graph */
export type EdgeType =
  | 'supports'          // Source provides evidence for target
  | 'opposes'           // Source provides counter-evidence
  | 'assumes'           // Source assumes target is true
  | 'defeats'           // Source is a defeater for target
  | 'rebuts'            // Source directly contradicts target
  | 'undercuts'         // Source attacks the justification, not the claim
  | 'undermines'        // Source reduces confidence without full defeat
  | 'supersedes'        // Source replaces target
  | 'depends_on'        // Source depends on target being true
  | 'co_occurs';        // Source and target tend to appear together

// ============================================================================
// DEFEATER TYPES (EXTENDED)
// ============================================================================

/**
 * Extended defeater types per the mandate.
 * Defeaters are conditions that invalidate or weaken claims.
 */
export type ExtendedDefeaterType =
  // Original types
  | 'code_change'           // Code was modified
  | 'test_failure'          // Test failed
  | 'contradiction'         // Contradicting evidence found
  | 'new_info'              // New information invalidates

  // New types per mandate
  | 'staleness'             // Knowledge is too old
  | 'coverage_gap'          // Insufficient evidence coverage
  | 'tool_failure'          // Analysis tool failed
  | 'sandbox_mismatch'      // Sandbox vs production difference
  | 'untrusted_content'     // Potentially injected content
  | 'provider_unavailable'  // LLM/embedding provider unavailable
  | 'hash_mismatch'         // Content hash doesn't match
  | 'dependency_drift'      // Dependencies changed
  | 'schema_version';       // Schema version incompatible

/**
 * Extended defeater with full metadata.
 */
export interface ExtendedDefeater {
  /** Unique defeater ID */
  id: string;

  /** Type of defeater */
  type: ExtendedDefeaterType;

  /** Human-readable description */
  description: string;

  /** Severity of the defeat */
  severity: DefeaterSeverity;

  /** When this defeater was detected */
  detectedAt: string;

  /** When this defeater was activated (if active) */
  activatedAt?: string;

  /** Current status */
  status: 'pending' | 'active' | 'resolved' | 'ignored';

  /** Evidence for the defeater */
  evidence?: string;

  /** Claims affected by this defeater */
  affectedClaimIds: ClaimId[];

  /** How much to reduce confidence (0-1) */
  confidenceReduction: number;

  /** Can this be automatically resolved? */
  autoResolvable: boolean;

  /** Resolution action if auto-resolvable */
  resolutionAction?: string;

  /**
   * IDs of defeaters that defeat this defeater (meta-defeat / higher-order defeat).
   * A defeater is only active if none of its defeatedBy defeaters are active.
   * This enables modeling of epistemic reinstatement where a defeater can be
   * defeated by counter-evidence or higher-order reasoning.
   *
   * WU-THIMPL-102: Higher-order defeat support
   */
  defeatedBy?: string[];
}

/** Severity levels for defeaters */
export type DefeaterSeverity =
  | 'full'              // Completely invalidates claim
  | 'partial'           // Significantly reduces confidence
  | 'warning'           // Minor confidence reduction
  | 'informational';    // No confidence impact, just FYI

// ============================================================================
// CONTRADICTION TRACKING
// ============================================================================

/**
 * A contradiction between claims.
 * Contradictions are NEVER silently reconciled per the mandate.
 */
export interface Contradiction {
  /** Unique contradiction ID */
  id: string;

  /** First claim in the contradiction */
  claimA: ClaimId;

  /** Second claim in the contradiction */
  claimB: ClaimId;

  /** Type of contradiction */
  type: ContradictionType;

  /** Human-readable explanation */
  explanation: string;

  /** When detected */
  detectedAt: string;

  /** Current status - must be explicitly resolved */
  status: ContradictionStatus;

  /** Resolution if resolved */
  resolution?: ContradictionResolution;

  /** Severity of the contradiction */
  severity: 'blocking' | 'significant' | 'minor';
}

/** Types of contradictions */
export type ContradictionType =
  | 'direct'            // Claims directly oppose each other
  | 'implicational'     // Claims imply contradictory consequences
  | 'temporal'          // Claims about same thing at different times
  | 'scope'             // Claims at different scopes that conflict
  | 'conditional';      // Claims that conflict under certain conditions

/** Status of a contradiction */
export type ContradictionStatus =
  | 'unresolved'        // Not yet addressed
  | 'investigating'     // Being investigated
  | 'resolved'          // Resolved with explanation
  | 'accepted';         // Accepted as an inherent ambiguity

/** Resolution of a contradiction */
export interface ContradictionResolution {
  /** How it was resolved */
  method: 'prefer_a' | 'prefer_b' | 'merge' | 'both_valid' | 'neither_valid' | 'context_dependent';

  /** Explanation of the resolution */
  explanation: string;

  /** Who/what resolved it */
  resolver: string;

  /** When it was resolved */
  resolvedAt: string;

  /** Explicit tradeoff documentation */
  tradeoff: string;
}

// ============================================================================
// EVIDENCE GRAPH CONTAINER
// ============================================================================

/**
 * The complete evidence graph for a workspace.
 */
export interface EvidenceGraph {
  /** Graph ID (typically workspace hash) */
  id: string;

  /** Schema version */
  schemaVersion: string;

  /** Workspace this graph is for */
  workspace: string;

  /** All claims in the graph */
  claims: Map<ClaimId, Claim>;

  /** All edges in the graph */
  edges: EvidenceEdge[];

  /** All active defeaters */
  defeaters: ExtendedDefeater[];

  /** All contradictions (never hidden) */
  contradictions: Contradiction[];

  /** Graph metadata */
  meta: EvidenceGraphMeta;
}

/** Metadata about the evidence graph */
export interface EvidenceGraphMeta {
  /** When the graph was created */
  createdAt: string;

  /** When last updated */
  updatedAt: string;

  /** Number of claims */
  claimCount: number;

  /** Number of active defeaters */
  activeDefeaterCount: number;

  /** Number of unresolved contradictions */
  unresolvedContradictionCount: number;

  /** Overall graph health (0-1) */
  health: number;

  /** Calibration metrics */
  calibration?: {
    expectedCalibrationError: number;
    brierScore: number;
    lastCalibrated: string;
  };
}

// ============================================================================
// TYPE GUARDS
// ============================================================================

/** Type guard for ClaimId */
export function isClaimId(value: unknown): value is ClaimId {
  return typeof value === 'string' && value.length > 0;
}

/** Type guard for Claim */
export function isClaim(value: unknown): value is Claim {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.id === 'string' &&
    typeof obj.proposition === 'string' &&
    typeof obj.type === 'string' &&
    typeof obj.subject === 'object' &&
    typeof obj.createdAt === 'string' &&
    typeof obj.source === 'object' &&
    typeof obj.status === 'string' &&
    isConfidenceValue(obj.confidence) &&
    typeof obj.signalStrength === 'object'
  );
}

/** Type guard for EvidenceEdge */
export function isEvidenceEdge(value: unknown): value is EvidenceEdge {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.id === 'string' &&
    typeof obj.fromClaimId === 'string' &&
    typeof obj.toClaimId === 'string' &&
    typeof obj.type === 'string' &&
    typeof obj.strength === 'number'
  );
}

/** Type guard for ExtendedDefeater */
export function isExtendedDefeater(value: unknown): value is ExtendedDefeater {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.id === 'string' &&
    typeof obj.type === 'string' &&
    typeof obj.description === 'string' &&
    typeof obj.severity === 'string' &&
    typeof obj.status === 'string'
  );
}

/** Type guard for Contradiction */
export function isContradiction(value: unknown): value is Contradiction {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.id === 'string' &&
    typeof obj.claimA === 'string' &&
    typeof obj.claimB === 'string' &&
    typeof obj.type === 'string' &&
    typeof obj.status === 'string'
  );
}

/** Type guard for EvidenceGraph */
export function isEvidenceGraph(value: unknown): value is EvidenceGraph {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.id === 'string' &&
    typeof obj.schemaVersion === 'string' &&
    typeof obj.workspace === 'string' &&
    obj.claims instanceof Map &&
    Array.isArray(obj.edges) &&
    Array.isArray(obj.defeaters) &&
    Array.isArray(obj.contradictions)
  );
}

// ============================================================================
// SERIALIZATION
// ============================================================================

/** Serializable version of EvidenceGraph (Map -> Record) */
export interface SerializedEvidenceGraph {
  id: string;
  schemaVersion: string;
  workspace: string;
  claims: Record<string, Claim>;
  edges: EvidenceEdge[];
  defeaters: ExtendedDefeater[];
  contradictions: Contradiction[];
  meta: EvidenceGraphMeta;
}

/** Serialize an EvidenceGraph for storage */
export function serializeEvidenceGraph(graph: EvidenceGraph): SerializedEvidenceGraph {
  const claims: Record<string, Claim> = {};
  for (const [id, claim] of graph.claims) {
    claims[id] = claim;
  }
  return {
    id: graph.id,
    schemaVersion: graph.schemaVersion,
    workspace: graph.workspace,
    claims,
    edges: graph.edges,
    defeaters: graph.defeaters,
    contradictions: graph.contradictions,
    meta: graph.meta,
  };
}

/** Deserialize an EvidenceGraph from storage */
export function deserializeEvidenceGraph(data: SerializedEvidenceGraph): EvidenceGraph {
  const claims = new Map<ClaimId, Claim>();
  for (const [id, claim] of Object.entries(data.claims)) {
    claims.set(createClaimId(id), claim);
  }
  return {
    id: data.id,
    schemaVersion: data.schemaVersion,
    workspace: data.workspace,
    claims,
    edges: data.edges,
    defeaters: data.defeaters,
    contradictions: data.contradictions,
    meta: data.meta,
  };
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/** Create an empty evidence graph */
export function createEmptyEvidenceGraph(workspace: string): EvidenceGraph {
  const now = new Date().toISOString();
  return {
    id: `graph_${workspace.replace(/[^a-zA-Z0-9]/g, '_')}`,
    schemaVersion: EVIDENCE_GRAPH_SCHEMA_VERSION,
    workspace,
    claims: new Map(),
    edges: [],
    defeaters: [],
    contradictions: [],
    meta: {
      createdAt: now,
      updatedAt: now,
      claimCount: 0,
      activeDefeaterCount: 0,
      unresolvedContradictionCount: 0,
      health: 1.0,
    },
  };
}

/** Create a new claim */
export function createClaim(
  props: Omit<Claim, 'id' | 'createdAt' | 'schemaVersion' | 'status' | 'confidence' | 'signalStrength'> & {
    id?: string;
    confidence?: ConfidenceValue;
    signalStrength?: Partial<ClaimSignalStrength>;
  }
): Claim {
  const signalStrength = {
    ...createDefaultSignalStrength(),
    ...props.signalStrength,
  };
  signalStrength.overall = computeOverallSignalStrength(signalStrength);

  return {
    id: createClaimId(props.id ?? `claim_${randomUUID()}`),
    proposition: props.proposition,
    type: props.type,
    subject: props.subject,
    createdAt: new Date().toISOString(),
    source: props.source,
    status: 'active',
    confidence: props.confidence ?? absent('uncalibrated'),
    signalStrength,
    schemaVersion: EVIDENCE_GRAPH_SCHEMA_VERSION,
  };
}

/** Create a new defeater */
export function createDefeater(
  props: Omit<ExtendedDefeater, 'id' | 'detectedAt' | 'status'>
): ExtendedDefeater {
  return {
    id: `defeater_${randomUUID()}`,
    type: props.type,
    description: props.description,
    severity: props.severity,
    detectedAt: new Date().toISOString(),
    status: 'pending',
    evidence: props.evidence,
    affectedClaimIds: props.affectedClaimIds,
    confidenceReduction: props.confidenceReduction,
    autoResolvable: props.autoResolvable,
    resolutionAction: props.resolutionAction,
  };
}

/** Create a new contradiction */
export function createContradiction(
  claimA: ClaimId,
  claimB: ClaimId,
  type: ContradictionType,
  explanation: string,
  severity: 'blocking' | 'significant' | 'minor' = 'significant'
): Contradiction {
  return {
    id: `contradiction_${randomUUID()}`,
    claimA,
    claimB,
    type,
    explanation,
    detectedAt: new Date().toISOString(),
    status: 'unresolved',
    severity,
  };
}
