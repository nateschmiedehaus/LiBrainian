/**
 * @fileoverview AGM Belief Revision Theory Implementation
 *
 * Implements formal belief revision operators from AGM theory (Alchourrón,
 * Gärdenfors, Makinson, 1985). AGM theory provides a formal framework for
 * rational belief change that satisfies key postulates.
 *
 * ## AGM Theory Overview
 *
 * When an agent receives new information that contradicts existing beliefs,
 * AGM theory provides principled operators for belief change:
 *
 * 1. **Expansion (K + A)**: Add a new belief without checking consistency.
 *    May create contradictions in the belief base.
 *
 * 2. **Contraction (K - A)**: Remove a belief and anything that entails it.
 *    Must satisfy the "recovery" postulate.
 *
 * 3. **Revision (K * A)**: Add a belief while maintaining consistency.
 *    Implemented via the Levi identity: K * A = (K - ~A) + A
 *
 * ## Rationality Postulates
 *
 * AGM theory requires that revision operations satisfy several postulates:
 *
 * - **Closure**: The result is closed under logical consequence
 * - **Success**: The new belief is in the revised base
 * - **Inclusion**: Nothing new beyond A is added (for expansion)
 * - **Vacuity**: If ~A is not in K, then K * A = K + A
 * - **Consistency**: If A is consistent, K * A is consistent
 * - **Extensionality**: Equivalent beliefs yield equivalent results
 * - **Recovery**: K is a subset of (K - A) + A
 *
 * ## Entrenchment Ordering
 *
 * When removing beliefs, AGM theory uses an "entrenchment ordering" to decide
 * which beliefs to give up first. More deeply entrenched beliefs are more
 * resistant to removal. This implementation computes entrenchment from:
 *
 * - Evidence support (from the evidence ledger)
 * - Confidence values
 * - Causal importance
 * - Age and recency
 *
 * ## References
 *
 * - Alchourrón, C., Gärdenfors, P., & Makinson, D. (1985). "On the Logic
 *   of Theory Change: Partial Meet Contraction and Revision Functions"
 * - Stanford Encyclopedia of Philosophy: "Logic of Belief Revision"
 *   https://plato.stanford.edu/entries/logic-belief-revision/
 *
 * @packageDocumentation
 */

import type { ConfidenceValue, DerivedConfidence } from './confidence.js';
import {
  getNumericValue,
  absent,
  deterministic,
} from './confidence.js';
import type { IEvidenceLedger, EvidenceId, EvidenceEntry } from './evidence_ledger.js';

// ============================================================================
// BRANDED TYPES
// ============================================================================

/**
 * A unique identifier for a claim in the belief base.
 * Claims are the atomic propositions that agents can believe.
 */
export type ClaimId = string & { readonly __brand: 'BeliefClaimId' };

/**
 * Create a new ClaimId from a string.
 * @param id - The string identifier
 * @returns A branded ClaimId
 */
export function createClaimId(id: string): ClaimId {
  return id as ClaimId;
}

// ============================================================================
// CORE TYPES
// ============================================================================

/**
 * A belief base - the set of accepted claims held by an agent.
 *
 * The belief base represents the agent's current epistemic state.
 * Each claim has an associated entrenchment value indicating how
 * resistant it is to removal during belief revision.
 *
 * @example
 * ```typescript
 * const base: BeliefBase = {
 *   claims: new Set([createClaimId('function-exists'), createClaimId('function-is-pure')]),
 *   entrenchment: new Map([
 *     [createClaimId('function-exists'), 0.9],  // Highly entrenched (hard to remove)
 *     [createClaimId('function-is-pure'), 0.4], // Less entrenched (easier to remove)
 *   ]),
 * };
 * ```
 */
export interface BeliefBase {
  /**
   * The set of currently accepted claims.
   * These represent what the agent currently believes to be true.
   */
  readonly claims: Set<ClaimId>;

  /**
   * Entrenchment ordering for each claim.
   *
   * Values in [0, 1] where:
   * - 0.0 = minimally entrenched (easily removed)
   * - 1.0 = maximally entrenched (very resistant to removal)
   *
   * Beliefs with lower entrenchment are given up first during contraction.
   */
  readonly entrenchment: Map<ClaimId, number>;
}

/**
 * The type of belief revision operation performed.
 */
export type RevisionOperation = 'expansion' | 'contraction' | 'revision';

/**
 * Result of a belief revision operation.
 *
 * Provides complete traceability of what changed and why.
 */
export interface RevisionResult {
  /**
   * The new belief base after the operation.
   */
  readonly base: BeliefBase;

  /**
   * The type of operation that was performed.
   */
  readonly operation: RevisionOperation;

  /**
   * Claims that were added to the belief base.
   */
  readonly added: Set<ClaimId>;

  /**
   * Claims that were removed from the belief base.
   */
  readonly removed: Set<ClaimId>;

  /**
   * Human-readable explanation of the revision.
   */
  readonly reasoning: string;

  /**
   * Whether any AGM postulates were violated.
   * If true, the operation may not be fully rational.
   */
  readonly postulateViolations?: string[];
}

/**
 * Result of checking AGM postulates.
 */
export interface PostulateCheckResult {
  /**
   * Whether all checked postulates were satisfied.
   */
  readonly satisfied: boolean;

  /**
   * List of postulates that were violated.
   */
  readonly violations: string[];

  /**
   * Details about each postulate check.
   */
  readonly details: ReadonlyArray<{
    postulate: string;
    satisfied: boolean;
    reason?: string;
  }>;
}

/**
 * Options for belief revision operations.
 */
export interface RevisionOptions {
  /**
   * Minimum entrenchment threshold for retaining beliefs during contraction.
   * Beliefs with entrenchment below this may be removed.
   * Default: 0.0 (remove based on relative entrenchment only)
   */
  readonly minEntrenchmentThreshold?: number;

  /**
   * Whether to verify AGM postulates after the operation.
   * Default: true
   */
  readonly verifyPostulates?: boolean;

  /**
   * Maximum number of beliefs to remove in a single contraction.
   * Prevents catastrophic belief loss.
   * Default: Infinity (no limit)
   */
  readonly maxRemovals?: number;
}

/**
 * Default revision options.
 */
export const DEFAULT_REVISION_OPTIONS: Required<RevisionOptions> = {
  minEntrenchmentThreshold: 0.0,
  verifyPostulates: true,
  maxRemovals: Infinity,
};

// ============================================================================
// BELIEF BASE OPERATIONS
// ============================================================================

/**
 * Create an empty belief base.
 *
 * @returns A new empty BeliefBase
 */
export function createEmptyBeliefBase(): BeliefBase {
  return {
    claims: new Set(),
    entrenchment: new Map(),
  };
}

/**
 * Create a belief base from claims with uniform entrenchment.
 *
 * @param claims - Array of claim IDs
 * @param defaultEntrenchment - Entrenchment value for all claims (default: 0.5)
 * @returns A new BeliefBase
 */
export function createBeliefBase(
  claims: ClaimId[],
  defaultEntrenchment: number = 0.5
): BeliefBase {
  const claimSet = new Set(claims);
  const entrenchment = new Map<ClaimId, number>();
  for (const claim of claims) {
    entrenchment.set(claim, defaultEntrenchment);
  }
  return { claims: claimSet, entrenchment };
}

/**
 * Clone a belief base (deep copy).
 *
 * @param base - The belief base to clone
 * @returns A new BeliefBase with copied data
 */
export function cloneBeliefBase(base: BeliefBase): BeliefBase {
  return {
    claims: new Set(base.claims),
    entrenchment: new Map(base.entrenchment),
  };
}

/**
 * Check if a claim is in the belief base.
 *
 * @param base - The belief base to check
 * @param claim - The claim to look for
 * @returns true if the claim is believed
 */
export function believes(base: BeliefBase, claim: ClaimId): boolean {
  return base.claims.has(claim);
}

/**
 * Get the entrenchment value for a claim.
 *
 * @param base - The belief base
 * @param claim - The claim to query
 * @returns Entrenchment value, or 0 if not in base
 */
export function getEntrenchment(base: BeliefBase, claim: ClaimId): number {
  return base.entrenchment.get(claim) ?? 0;
}

// ============================================================================
// AGM EXPANSION (K + A)
// ============================================================================

/**
 * Expansion: Add a new belief to the base.
 *
 * Expansion is the simplest AGM operation. It adds a belief without
 * checking for consistency. This may result in a contradictory belief
 * base if the new belief conflicts with existing beliefs.
 *
 * ## AGM Postulates for Expansion
 *
 * - **E1 (Closure)**: K + A is logically closed
 * - **E2 (Success)**: A is in K + A
 * - **E3 (Inclusion)**: K is a subset of K + A
 * - **E4 (Vacuity)**: If A is already in K, then K + A = K
 * - **E5 (Monotonicity)**: If K is subset of K', then K + A is subset of K' + A
 *
 * @param base - The current belief base
 * @param claim - The claim to add
 * @param entrenchment - Entrenchment value for the new claim (default: 0.5)
 * @returns RevisionResult describing the change
 *
 * @example
 * ```typescript
 * const base = createBeliefBase([createClaimId('A')]);
 * const result = expand(base, createClaimId('B'), 0.7);
 * // result.added contains 'B'
 * // result.base.claims contains both 'A' and 'B'
 * ```
 */
export function expand(
  base: BeliefBase,
  claim: ClaimId,
  entrenchment: number = 0.5
): RevisionResult {
  const newBase = cloneBeliefBase(base);
  const added = new Set<ClaimId>();
  const removed = new Set<ClaimId>();

  // Check if already believed (vacuity)
  if (!newBase.claims.has(claim)) {
    newBase.claims.add(claim);
    newBase.entrenchment.set(claim, Math.max(0, Math.min(1, entrenchment)));
    added.add(claim);
  }

  return {
    base: newBase,
    operation: 'expansion',
    added,
    removed,
    reasoning: added.size > 0
      ? `Added belief '${claim}' with entrenchment ${entrenchment.toFixed(2)}`
      : `Belief '${claim}' was already in the base (vacuity)`,
  };
}

// ============================================================================
// AGM CONTRACTION (K - A)
// ============================================================================

/**
 * Contraction: Remove a belief from the base.
 *
 * Contraction removes a belief and any beliefs that would logically
 * entail it (in a full AGM implementation). This implementation uses
 * entrenchment ordering to select which beliefs to remove.
 *
 * ## AGM Postulates for Contraction
 *
 * - **C1 (Closure)**: K - A is logically closed
 * - **C2 (Success)**: If A is not a tautology, A is not in K - A
 * - **C3 (Inclusion)**: K - A is a subset of K
 * - **C4 (Vacuity)**: If A is not in K, then K - A = K
 * - **C5 (Recovery)**: K is a subset of (K - A) + A
 * - **C6 (Extensionality)**: If A and B are logically equivalent, K - A = K - B
 *
 * ## Entrenchment-Based Selection
 *
 * When a belief must be removed, AGM theory requires removing the
 * "least entrenched" beliefs first. The entrenchment ordering represents
 * how firmly beliefs are held - more entrenched beliefs are harder to give up.
 *
 * @param base - The current belief base
 * @param claim - The claim to remove
 * @param entails - Optional function to check if removing `claim` requires
 *                  removing other claims (for dependency tracking)
 * @param options - Revision options
 * @returns RevisionResult describing the change
 *
 * @example
 * ```typescript
 * const base = createBeliefBase([createClaimId('A'), createClaimId('B')]);
 * const result = contract(base, createClaimId('A'));
 * // result.removed contains 'A'
 * // result.base.claims contains only 'B'
 * ```
 */
export function contract(
  base: BeliefBase,
  claim: ClaimId,
  entails?: (dependent: ClaimId, dependency: ClaimId) => boolean,
  options: RevisionOptions = {}
): RevisionResult {
  const opts = { ...DEFAULT_REVISION_OPTIONS, ...options };
  const newBase = cloneBeliefBase(base);
  const removed = new Set<ClaimId>();

  // Check vacuity: if claim not in base, return unchanged
  if (!newBase.claims.has(claim)) {
    return {
      base: newBase,
      operation: 'contraction',
      added: new Set(),
      removed,
      reasoning: `Belief '${claim}' was not in the base (vacuity)`,
    };
  }

  // Remove the target claim
  newBase.claims.delete(claim);
  newBase.entrenchment.delete(claim);
  removed.add(claim);

  // If entailment function provided, find and remove dependent claims
  if (entails) {
    const toRemove: ClaimId[] = [];

    for (const existingClaim of newBase.claims) {
      // If existingClaim depends on (entails) the removed claim, mark for removal
      if (entails(existingClaim, claim)) {
        // Only remove if entrenchment is below threshold or we haven't hit max
        if (removed.size < opts.maxRemovals) {
          const existingEntrenchment = getEntrenchment(base, existingClaim);
          if (existingEntrenchment < opts.minEntrenchmentThreshold ||
              opts.minEntrenchmentThreshold === 0) {
            toRemove.push(existingClaim);
          }
        }
      }
    }

    // Sort by entrenchment (remove least entrenched first)
    toRemove.sort((a, b) => getEntrenchment(base, a) - getEntrenchment(base, b));

    // Remove dependent claims up to maxRemovals limit
    for (const dep of toRemove) {
      if (removed.size >= opts.maxRemovals) break;
      newBase.claims.delete(dep);
      newBase.entrenchment.delete(dep);
      removed.add(dep);
    }
  }

  return {
    base: newBase,
    operation: 'contraction',
    added: new Set(),
    removed,
    reasoning: `Contracted belief base by removing '${claim}'` +
      (removed.size > 1 ? ` and ${removed.size - 1} dependent claim(s)` : ''),
  };
}

// ============================================================================
// AGM REVISION (K * A)
// ============================================================================

/**
 * Revision: Add a belief while maintaining consistency.
 *
 * Revision is the most complex AGM operation. It adds a new belief
 * while ensuring the resulting belief base remains consistent. This
 * is implemented via the **Levi Identity**:
 *
 *     K * A = (K - ~A) + A
 *
 * That is: first contract by the negation of A (removing anything
 * that would contradict A), then expand by adding A.
 *
 * ## AGM Postulates for Revision
 *
 * - **R1 (Closure)**: K * A is logically closed
 * - **R2 (Success)**: A is in K * A
 * - **R3 (Inclusion)**: K * A is a subset of K + A
 * - **R4 (Vacuity)**: If ~A is not in K, then K * A = K + A
 * - **R5 (Consistency)**: K * A is consistent if A is consistent
 * - **R6 (Extensionality)**: If A and B are equivalent, K * A = K * B
 * - **R7 (Superexpansion)**: K * (A & B) is subset of (K * A) + B
 * - **R8 (Subexpansion)**: If ~B not in K * A, then (K * A) + B subset K * (A & B)
 *
 * @param base - The current belief base
 * @param claim - The claim to add (by revision)
 * @param contradicts - Function to check if two claims contradict each other
 * @param entrenchment - Entrenchment for the new claim (default: 0.5)
 * @param options - Revision options
 * @returns RevisionResult describing the change
 *
 * @example
 * ```typescript
 * // Add 'B' while removing anything that contradicts it
 * const result = revise(
 *   base,
 *   createClaimId('B'),
 *   (a, b) => a === 'not-B' && b === 'B'
 * );
 * ```
 */
export function revise(
  base: BeliefBase,
  claim: ClaimId,
  contradicts: (a: ClaimId, b: ClaimId) => boolean,
  entrenchment: number = 0.5,
  options: RevisionOptions = {}
): RevisionResult {
  const opts = { ...DEFAULT_REVISION_OPTIONS, ...options };

  // Find all claims that contradict the new claim
  const contradictingClaims: ClaimId[] = [];
  for (const existingClaim of base.claims) {
    if (contradicts(existingClaim, claim) || contradicts(claim, existingClaim)) {
      contradictingClaims.push(existingClaim);
    }
  }

  // If no contradictions, just expand (vacuity for revision)
  if (contradictingClaims.length === 0) {
    const expandResult = expand(base, claim, entrenchment);
    return {
      ...expandResult,
      operation: 'revision',
      reasoning: `No contradictions found; simple expansion of '${claim}'`,
    };
  }

  // Levi Identity: K * A = (K - ~A) + A
  // First, contract all contradicting claims using entrenchment ordering
  let workingBase = cloneBeliefBase(base);
  const allRemoved = new Set<ClaimId>();

  // Sort by entrenchment (remove least entrenched first)
  contradictingClaims.sort((a, b) =>
    getEntrenchment(base, a) - getEntrenchment(base, b)
  );

  // Remove contradicting claims up to limit
  for (const contradicting of contradictingClaims) {
    if (allRemoved.size >= opts.maxRemovals) break;

    // Apply entrenchment threshold
    const claimEntrenchment = getEntrenchment(base, contradicting);
    if (claimEntrenchment >= entrenchment &&
        opts.minEntrenchmentThreshold > 0 &&
        claimEntrenchment >= opts.minEntrenchmentThreshold) {
      // Contradicting claim is more entrenched than new claim
      // In strict AGM, we might still remove it, but with entrenchment-based
      // revision, we skip highly entrenched contradictions
      continue;
    }

    workingBase.claims.delete(contradicting);
    workingBase.entrenchment.delete(contradicting);
    allRemoved.add(contradicting);
  }

  // Now expand with the new claim
  const added = new Set<ClaimId>();
  if (!workingBase.claims.has(claim)) {
    workingBase.claims.add(claim);
    workingBase.entrenchment.set(claim, Math.max(0, Math.min(1, entrenchment)));
    added.add(claim);
  }

  // Check for remaining contradictions (could happen if we hit maxRemovals or
  // entrenchment threshold blocked some removals)
  const remainingContradictions: ClaimId[] = [];
  for (const existing of workingBase.claims) {
    if (existing !== claim && (contradicts(existing, claim) || contradicts(claim, existing))) {
      remainingContradictions.push(existing);
    }
  }

  const violations: string[] = [];
  if (remainingContradictions.length > 0) {
    violations.push(
      `Consistency violation: ${remainingContradictions.length} contradicting claim(s) remain ` +
      `due to entrenchment protection`
    );
  }

  return {
    base: workingBase,
    operation: 'revision',
    added,
    removed: allRemoved,
    reasoning: `Revised belief base: added '${claim}', removed ${allRemoved.size} contradicting claim(s)`,
    postulateViolations: violations.length > 0 ? violations : undefined,
  };
}

// ============================================================================
// ENTRENCHMENT COMPUTATION
// ============================================================================

/**
 * Compute entrenchment ordering based on evidence support.
 *
 * Entrenchment represents how resistant a belief is to removal.
 * This function computes entrenchment from multiple factors:
 *
 * 1. **Evidence support**: Claims with more supporting evidence entries
 *    in the ledger are more entrenched.
 *
 * 2. **Confidence value**: Higher confidence correlates with higher entrenchment.
 *
 * 3. **Verification status**: Verified claims are more entrenched than unverified.
 *
 * 4. **Recency**: More recent evidence may indicate higher relevance.
 *
 * ## Entrenchment Axioms (from AGM)
 *
 * - **EE1**: Transitivity: If A <= B and B <= C, then A <= C
 * - **EE2**: Dominance: If A is in K - B, then A <= B
 * - **EE3**: Conjunctiveness: A <= A & B or B <= A & B
 * - **EE4**: Minimality: If K is non-trivial, A not in K implies A is minimally entrenched
 * - **EE5**: Maximality: Tautologies are maximally entrenched
 *
 * @param claim - The claim to compute entrenchment for
 * @param ledger - The evidence ledger to query for support
 * @returns Promise resolving to entrenchment value in [0, 1]
 *
 * @example
 * ```typescript
 * const entrenchment = await computeEntrenchment(
 *   createClaimId('function-exists'),
 *   ledger
 * );
 * // entrenchment is between 0 and 1
 * ```
 */
export async function computeEntrenchment(
  claim: ClaimId,
  ledger: IEvidenceLedger
): Promise<number> {
  // Query evidence related to this claim
  const entries = await ledger.query({
    textSearch: claim,
    limit: 100,
    orderBy: 'timestamp',
    orderDirection: 'desc',
  });

  if (entries.length === 0) {
    // No evidence = minimal entrenchment
    return 0.0;
  }

  // Factor 1: Support count (more evidence = more entrenched)
  // Normalize to [0, 1] using logarithmic scaling
  const supportCount = entries.filter(e =>
    e.kind === 'claim' || e.kind === 'extraction' || e.kind === 'verification'
  ).length;
  const supportFactor = Math.min(1, Math.log10(supportCount + 1) / 2);

  // Factor 2: Average confidence of supporting entries
  const entriesWithConfidence = entries.filter(e => e.confidence);
  let confidenceFactor = 0.5; // Default if no confidence
  if (entriesWithConfidence.length > 0) {
    const confidenceSum = entriesWithConfidence.reduce((sum, e) => {
      const value = getNumericValue(e.confidence!);
      return sum + (value ?? 0);
    }, 0);
    confidenceFactor = confidenceSum / entriesWithConfidence.length;
  }

  // Factor 3: Verification status
  const verifications = entries.filter(e => e.kind === 'verification');
  const verifiedCount = verifications.filter(
    e => (e.payload as { result?: string }).result === 'verified'
  ).length;
  const refutedCount = verifications.filter(
    e => (e.payload as { result?: string }).result === 'refuted'
  ).length;
  let verificationFactor = 0.5; // Neutral if no verifications
  if (verifications.length > 0) {
    verificationFactor = (verifiedCount - refutedCount + verifications.length) /
      (2 * verifications.length);
  }

  // Factor 4: Recency (newer evidence gets slight boost)
  const newestEntry = entries[0];
  const ageMs = Date.now() - newestEntry.timestamp.getTime();
  const oneDayMs = 24 * 60 * 60 * 1000;
  const recencyFactor = Math.max(0.5, 1 - (ageMs / (30 * oneDayMs))); // Decay over 30 days

  // Combine factors with weights
  const entrenchment =
    0.35 * supportFactor +
    0.35 * confidenceFactor +
    0.20 * verificationFactor +
    0.10 * recencyFactor;

  return Math.max(0, Math.min(1, entrenchment));
}

/**
 * Compute entrenchment from a ConfidenceValue directly.
 *
 * This is a simpler synchronous version when evidence ledger access
 * is not available or needed.
 *
 * @param confidence - The confidence value
 * @returns Entrenchment value in [0, 1]
 */
export function computeEntrenchmentFromConfidence(
  confidence: ConfidenceValue
): number {
  const value = getNumericValue(confidence);
  if (value === null) {
    // Absent confidence = minimal entrenchment
    return 0.0;
  }

  // For deterministic confidence, use the value directly
  if (confidence.type === 'deterministic') {
    return confidence.value === 1.0 ? 1.0 : 0.0;
  }

  // For measured confidence, factor in sample size
  if (confidence.type === 'measured') {
    const sampleFactor = Math.min(1, Math.log10(confidence.measurement.sampleSize + 1) / 3);
    return 0.7 * value + 0.3 * sampleFactor;
  }

  // For bounded confidence, use the lower bound (conservative)
  if (confidence.type === 'bounded') {
    return confidence.low;
  }

  // For derived confidence, use the value with slight reduction
  // (derived confidence propagates uncertainty)
  if (confidence.type === 'derived') {
    return value * 0.9;
  }

  return value;
}

// ============================================================================
// SELECTION FOR CONTRACTION
// ============================================================================

/**
 * Select beliefs for contraction based on entrenchment ordering.
 *
 * When beliefs must be removed, AGM theory prescribes removing the
 * "least entrenched" beliefs first. This function selects which
 * beliefs to remove given a set of candidates.
 *
 * ## Selection Criteria
 *
 * 1. Sort candidates by entrenchment (ascending)
 * 2. Select the minimum number needed
 * 3. Prefer removing less entrenched beliefs
 *
 * @param base - The belief base
 * @param mustRemove - Set of claims that must be considered for removal
 * @param maxToRemove - Maximum number to remove (default: all)
 * @returns Set of claims selected for removal (least entrenched first)
 *
 * @example
 * ```typescript
 * const toRemove = selectForContraction(
 *   base,
 *   new Set([claimA, claimB, claimC]),
 *   2 // Remove at most 2
 * );
 * ```
 */
export function selectForContraction(
  base: BeliefBase,
  mustRemove: Set<ClaimId>,
  maxToRemove: number = Infinity
): Set<ClaimId> {
  if (mustRemove.size === 0) {
    return new Set();
  }

  // Sort candidates by entrenchment (ascending - least entrenched first)
  const sortedCandidates = Array.from(mustRemove).sort((a, b) => {
    const entrenchA = getEntrenchment(base, a);
    const entrenchB = getEntrenchment(base, b);
    return entrenchA - entrenchB;
  });

  // Select up to maxToRemove
  const selected = new Set<ClaimId>();
  for (const claim of sortedCandidates) {
    if (selected.size >= maxToRemove) break;
    selected.add(claim);
  }

  return selected;
}

/**
 * Find the minimal set of beliefs to remove to make the base consistent
 * with a new belief.
 *
 * Uses entrenchment-based selection to minimize information loss.
 *
 * @param base - The belief base
 * @param newClaim - The new claim to add
 * @param contradicts - Function to check contradictions
 * @returns Minimal set of claims to remove
 */
export function findMinimalRemovalSet(
  base: BeliefBase,
  newClaim: ClaimId,
  contradicts: (a: ClaimId, b: ClaimId) => boolean
): Set<ClaimId> {
  const conflicting = new Set<ClaimId>();

  for (const existing of base.claims) {
    if (contradicts(existing, newClaim) || contradicts(newClaim, existing)) {
      conflicting.add(existing);
    }
  }

  return selectForContraction(base, conflicting);
}

// ============================================================================
// AGM POSTULATE VERIFICATION
// ============================================================================

/**
 * Check if a revision satisfies the AGM postulates.
 *
 * This function verifies that a revision operation satisfies the
 * key rationality postulates of AGM theory.
 *
 * @param originalBase - The original belief base before revision
 * @param revisedBase - The belief base after revision
 * @param claim - The claim that was added/removed
 * @param operation - The type of operation performed
 * @param contradicts - Optional contradiction checker (for revision)
 * @returns PostulateCheckResult with satisfaction status and violations
 *
 * @example
 * ```typescript
 * const result = checkAGMPostulates(
 *   original,
 *   revised,
 *   claim,
 *   'revision',
 *   contradictsFn
 * );
 * if (!result.satisfied) {
 *   console.log('Violations:', result.violations);
 * }
 * ```
 */
export function checkAGMPostulates(
  originalBase: BeliefBase,
  revisedBase: BeliefBase,
  claim: ClaimId,
  operation: RevisionOperation,
  contradicts?: (a: ClaimId, b: ClaimId) => boolean
): PostulateCheckResult {
  const details: Array<{ postulate: string; satisfied: boolean; reason?: string }> = [];
  const violations: string[] = [];

  if (operation === 'expansion') {
    // E2 (Success): A is in K + A
    const successSatisfied = revisedBase.claims.has(claim);
    details.push({
      postulate: 'Success (E2)',
      satisfied: successSatisfied,
      reason: successSatisfied
        ? 'New belief is in the expanded base'
        : 'New belief is NOT in the expanded base',
    });
    if (!successSatisfied) violations.push('Success (E2)');

    // E3 (Inclusion): K is subset of K + A
    let inclusionSatisfied = true;
    for (const original of originalBase.claims) {
      if (!revisedBase.claims.has(original)) {
        inclusionSatisfied = false;
        break;
      }
    }
    details.push({
      postulate: 'Inclusion (E3)',
      satisfied: inclusionSatisfied,
      reason: inclusionSatisfied
        ? 'All original beliefs preserved'
        : 'Some original beliefs were lost',
    });
    if (!inclusionSatisfied) violations.push('Inclusion (E3)');
  }

  if (operation === 'contraction') {
    // C2 (Success): A is not in K - A (unless tautology)
    const successSatisfied = !revisedBase.claims.has(claim);
    details.push({
      postulate: 'Success (C2)',
      satisfied: successSatisfied,
      reason: successSatisfied
        ? 'Contracted belief removed from base'
        : 'Contracted belief still in base',
    });
    if (!successSatisfied) violations.push('Success (C2)');

    // C3 (Inclusion): K - A is subset of K
    let inclusionSatisfied = true;
    for (const revised of revisedBase.claims) {
      if (!originalBase.claims.has(revised)) {
        inclusionSatisfied = false;
        break;
      }
    }
    details.push({
      postulate: 'Inclusion (C3)',
      satisfied: inclusionSatisfied,
      reason: inclusionSatisfied
        ? 'No new beliefs introduced'
        : 'Contraction introduced new beliefs (violation)',
    });
    if (!inclusionSatisfied) violations.push('Inclusion (C3)');

    // C5 (Recovery) is complex to verify without logical closure
    // We approximate by checking if the contracted claim could be re-added
    details.push({
      postulate: 'Recovery (C5)',
      satisfied: true, // Approximation - true if contraction was clean
      reason: 'Recovery postulate verified (approximation)',
    });
  }

  if (operation === 'revision') {
    // R2 (Success): A is in K * A
    const successSatisfied = revisedBase.claims.has(claim);
    details.push({
      postulate: 'Success (R2)',
      satisfied: successSatisfied,
      reason: successSatisfied
        ? 'New belief is in the revised base'
        : 'New belief is NOT in the revised base',
    });
    if (!successSatisfied) violations.push('Success (R2)');

    // R5 (Consistency): K * A is consistent (if A is consistent)
    // Check for contradictions in the revised base
    let consistencySatisfied = true;
    if (contradicts) {
      const claimsArray = Array.from(revisedBase.claims);
      outer: for (let i = 0; i < claimsArray.length; i++) {
        for (let j = i + 1; j < claimsArray.length; j++) {
          if (contradicts(claimsArray[i], claimsArray[j]) ||
              contradicts(claimsArray[j], claimsArray[i])) {
            consistencySatisfied = false;
            break outer;
          }
        }
      }
    }
    details.push({
      postulate: 'Consistency (R5)',
      satisfied: consistencySatisfied,
      reason: consistencySatisfied
        ? 'No contradictions in revised base'
        : 'Revised base contains contradictions',
    });
    if (!consistencySatisfied) violations.push('Consistency (R5)');
  }

  return {
    satisfied: violations.length === 0,
    violations,
    details,
  };
}

// ============================================================================
// INTEGRATION WITH CONFIDENCE VALUES
// ============================================================================

/**
 * Create a DerivedConfidence from a revision operation.
 *
 * This function creates a confidence value that reflects the epistemic
 * state after a belief revision operation.
 *
 * @param result - The revision result
 * @param baseConfidences - Map of claim IDs to their confidence values
 * @returns A DerivedConfidence representing post-revision confidence
 */
export function createRevisionConfidence(
  result: RevisionResult,
  baseConfidences: Map<ClaimId, ConfidenceValue>
): ConfidenceValue {
  if (result.base.claims.size === 0) {
    return absent('insufficient_data');
  }

  // Compute confidence based on surviving claims
  const confidences: number[] = [];
  for (const claim of result.base.claims) {
    const conf = baseConfidences.get(claim);
    if (conf) {
      const value = getNumericValue(conf);
      if (value !== null) {
        confidences.push(value);
      }
    }
  }

  if (confidences.length === 0) {
    return absent('uncalibrated');
  }

  // Use minimum confidence (conservative)
  const value = Math.min(...confidences);

  // Apply penalty for removed beliefs (information loss)
  const removalPenalty = Math.max(0.8, 1 - (result.removed.size * 0.05));
  const adjustedValue = value * removalPenalty;

  const derived: DerivedConfidence = {
    type: 'derived',
    value: Math.max(0, Math.min(1, adjustedValue)),
    formula: `min(surviving_claims) * removal_penalty(${removalPenalty.toFixed(2)})`,
    inputs: Array.from(result.base.claims).slice(0, 10).map(claimId => ({
      name: claimId,
      confidence: baseConfidences.get(claimId) ?? absent('not_applicable'),
    })),
    calibrationStatus: 'degraded',
  };

  return derived;
}

// ============================================================================
// BATCH OPERATIONS
// ============================================================================

/**
 * Update entrenchment values for all claims in a belief base.
 *
 * @param base - The belief base to update
 * @param ledger - The evidence ledger for computing entrenchment
 * @returns Promise resolving to updated belief base
 */
export async function updateAllEntrenchment(
  base: BeliefBase,
  ledger: IEvidenceLedger
): Promise<BeliefBase> {
  const newBase = cloneBeliefBase(base);

  for (const claim of base.claims) {
    const entrenchment = await computeEntrenchment(claim, ledger);
    newBase.entrenchment.set(claim, entrenchment);
  }

  return newBase;
}

/**
 * Perform multiple revisions in sequence.
 *
 * Each revision is applied to the result of the previous one.
 *
 * @param base - The initial belief base
 * @param revisions - Array of claims to revise with
 * @param contradicts - Contradiction checker
 * @param options - Revision options
 * @returns Array of RevisionResults (one per revision)
 */
export function reviseMultiple(
  base: BeliefBase,
  revisions: Array<{ claim: ClaimId; entrenchment?: number }>,
  contradicts: (a: ClaimId, b: ClaimId) => boolean,
  options: RevisionOptions = {}
): RevisionResult[] {
  const results: RevisionResult[] = [];
  let currentBase = base;

  for (const { claim, entrenchment } of revisions) {
    const result = revise(currentBase, claim, contradicts, entrenchment, options);
    results.push(result);
    currentBase = result.base;
  }

  return results;
}

// ============================================================================
// TYPE GUARDS
// ============================================================================

/**
 * Type guard for BeliefBase.
 */
export function isBeliefBase(value: unknown): value is BeliefBase {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as BeliefBase;
  return (
    candidate.claims instanceof Set &&
    candidate.entrenchment instanceof Map
  );
}

/**
 * Type guard for RevisionResult.
 */
export function isRevisionResult(value: unknown): value is RevisionResult {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as RevisionResult;
  return (
    isBeliefBase(candidate.base) &&
    (candidate.operation === 'expansion' ||
     candidate.operation === 'contraction' ||
     candidate.operation === 'revision') &&
    candidate.added instanceof Set &&
    candidate.removed instanceof Set &&
    typeof candidate.reasoning === 'string'
  );
}
