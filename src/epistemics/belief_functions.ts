/**
 * @fileoverview Dempster-Shafer Belief Functions
 *
 * Implements Dempster-Shafer theory for combining evidence from multiple sources
 * with explicit conflict detection. This provides a principled alternative to
 * Bayesian probability when:
 *
 * 1. **Handling Genuine Uncertainty**: D-S can express "I don't know" without
 *    forcing a probability distribution. Mass can be assigned to the full frame
 *    (complete ignorance) rather than requiring prior probabilities.
 *
 * 2. **Combining Independent Evidence Sources**: Dempster's rule of combination
 *    provides a principled way to fuse evidence from multiple independent sources.
 *
 * 3. **Detecting Conflict**: The conflict measure K quantifies disagreement between
 *    sources, enabling conflict-aware decision making.
 *
 * ## Key Concepts
 *
 * - **Frame of Discernment (Omega)**: The set of mutually exclusive possible states.
 *   For example, {working, broken, unknown} or {type_A, type_B, type_C}.
 *
 * - **Basic Probability Assignment (BPA/Mass Function)**: A function m: 2^Omega -> [0,1]
 *   where m(empty) = 0 and sum of all masses = 1. Unlike probability, mass is
 *   assigned to *sets* of outcomes, not just singletons.
 *
 * - **Belief (Bel)**: Lower probability bound. Bel(A) = sum of masses of all subsets of A.
 *   Represents the total support for A that cannot be contradicted.
 *
 * - **Plausibility (Pl)**: Upper probability bound. Pl(A) = sum of masses of all sets
 *   that intersect with A. Represents the maximum possible support for A.
 *
 * - **Dempster's Rule**: Combines two mass functions from independent sources:
 *   m(A) = [sum of m1(B)*m2(C) where B∩C=A] / (1-K)
 *   where K = sum of m1(B)*m2(C) where B∩C=empty (the conflict)
 *
 * ## When to Use D-S vs Bayesian Probability
 *
 * Use D-S when:
 * - You have genuine ignorance (not just uniform probability)
 * - You're combining evidence from independent sources
 * - You need explicit conflict detection
 * - Evidence supports sets of hypotheses, not just singletons
 *
 * Use Bayesian when:
 * - You have good prior estimates
 * - Sources are not independent (e.g., same underlying data)
 * - You need full probabilistic inference (conditioning, etc.)
 *
 * ## Integration with BoundedConfidence
 *
 * D-S belief functions naturally produce interval-valued confidence:
 * - Belief = lower bound
 * - Plausibility = upper bound
 *
 * Use `toBoundedConfidence()` to convert D-S results to Librarian's
 * BoundedConfidence type for integration with the rest of the system.
 *
 * ## References
 *
 * - Shafer, G. (1976) "A Mathematical Theory of Evidence"
 * - Dempster, A.P. (1968) "A generalization of Bayesian inference"
 * - Yager, R.R. (1987) "On the Dempster-Shafer framework and new combination rules"
 *
 * @packageDocumentation
 */

import type { BoundedConfidence } from './confidence.js';

// ============================================================================
// CORE TYPES
// ============================================================================

/**
 * A frame of discernment - the set of possible mutually exclusive states.
 *
 * The frame represents all possible hypotheses. For code analysis, this might be:
 * - {correct, incorrect} for validation
 * - {type_A, type_B, type_C} for classification
 * - {present, absent} for feature detection
 *
 * @template T - String literal type for frame elements
 *
 * @example
 * ```typescript
 * type CodeStatus = 'working' | 'broken' | 'unknown';
 * const frame: Frame<CodeStatus> = new Set(['working', 'broken', 'unknown']);
 * ```
 */
export type Frame<T extends string> = Set<T>;

/**
 * Serializes a subset to a canonical string key for Map storage.
 *
 * Subsets are sorted alphabetically for consistent hashing.
 *
 * @param subset - The subset to serialize
 * @returns A canonical string representation
 */
export function serializeSubset<T extends string>(subset: Set<T>): string {
  return [...subset].sort().join(',');
}

/**
 * Deserializes a subset key back to a Set.
 *
 * @param key - The serialized subset key
 * @returns The deserialized subset
 */
export function deserializeSubset<T extends string>(key: string): Set<T> {
  if (key === '') return new Set<T>();
  return new Set(key.split(',') as T[]);
}

/**
 * A belief mass function (Basic Probability Assignment).
 *
 * Maps subsets of the frame to mass values in [0,1].
 * - m(empty) = 0 (by definition)
 * - sum of all m(A) = 1
 *
 * Mass can be assigned to:
 * - Singletons: {A} with mass 0.8 means strong evidence for A
 * - Sets: {A,B} with mass 0.3 means evidence for "A or B" but not which
 * - Full frame (Omega): mass to full frame represents ignorance
 *
 * @template T - String literal type for frame elements
 *
 * @example
 * ```typescript
 * // Evidence strongly suggests 'working', with some uncertainty
 * const bm: BeliefMassFunction<'working' | 'broken'> = {
 *   frame: new Set(['working', 'broken']),
 *   masses: new Map([
 *     ['working', 0.7],           // Direct evidence for working
 *     ['working,broken', 0.3]     // Remaining mass = ignorance
 *   ])
 * };
 * ```
 */
export interface BeliefMassFunction<T extends string> {
  /** The frame of discernment */
  readonly frame: Frame<T>;

  /**
   * Mass assignments: serialized subset -> mass value [0,1].
   * Keys are comma-separated sorted element names.
   * Empty string key would be the empty set (always has mass 0).
   */
  readonly masses: Map<string, number>;
}

/**
 * Result of combining two belief functions using Dempster's rule.
 *
 * @template T - String literal type for frame elements
 */
export interface CombinationResult<T extends string> {
  /** The combined belief mass function */
  readonly combined: BeliefMassFunction<T>;

  /**
   * Conflict measure K (Dempster's conflict coefficient).
   *
   * - K = 0: No conflict, sources completely agree
   * - K approaching 1: High conflict, sources strongly disagree
   * - K = 1: Total conflict, combination is undefined
   *
   * When K is high, consider:
   * - Using Yager's rule (assigns conflict mass to ignorance)
   * - Investigating why sources disagree
   * - Not combining these sources at all
   */
  readonly conflict: number;

  /** Whether the result was normalized (always true for Dempster's rule) */
  readonly normalized: boolean;
}

/**
 * A mass assignment for creating belief mass functions.
 *
 * @template T - String literal type for frame elements
 */
export interface MassAssignment<T extends string> {
  /** The subset receiving this mass */
  readonly subset: Set<T>;

  /** The mass value [0,1] */
  readonly mass: number;
}

// ============================================================================
// CORE FUNCTIONS
// ============================================================================

/**
 * Creates a belief mass function from assignments.
 *
 * Validates that:
 * - All subsets are within the frame
 * - All masses are in [0,1]
 * - Masses sum to 1 (with small tolerance for floating point)
 * - No mass is assigned to the empty set
 *
 * @template T - String literal type for frame elements
 * @param frame - The frame of discernment
 * @param assignments - Array of subset -> mass assignments
 * @returns A valid BeliefMassFunction
 * @throws Error if validation fails
 *
 * @example
 * ```typescript
 * // Sensor reports "working" with 80% mass, 20% ignorance
 * const bm = createBeliefMass(
 *   new Set(['working', 'broken']),
 *   [
 *     { subset: new Set(['working']), mass: 0.8 },
 *     { subset: new Set(['working', 'broken']), mass: 0.2 }
 *   ]
 * );
 * ```
 */
export function createBeliefMass<T extends string>(
  frame: Frame<T>,
  assignments: Array<MassAssignment<T>>
): BeliefMassFunction<T> {
  const masses = new Map<string, number>();
  let totalMass = 0;

  for (const { subset, mass } of assignments) {
    // Validate subset is within frame
    for (const element of subset) {
      if (!frame.has(element)) {
        throw new Error(
          `Element "${element}" in subset is not in frame {${[...frame].join(', ')}}`
        );
      }
    }

    // Validate mass is in [0,1]
    if (mass < 0 || mass > 1) {
      throw new Error(`Mass must be in [0,1], got ${mass}`);
    }

    // Empty set must have zero mass
    if (subset.size === 0 && mass > 0) {
      throw new Error('Empty set must have zero mass');
    }

    // Skip zero-mass assignments
    if (mass === 0) continue;

    const key = serializeSubset(subset);
    masses.set(key, (masses.get(key) ?? 0) + mass);
    totalMass += mass;
  }

  // Validate masses sum to 1
  const TOLERANCE = 1e-9;
  if (Math.abs(totalMass - 1) > TOLERANCE) {
    throw new Error(
      `Masses must sum to 1, got ${totalMass}. Consider adding mass to the full frame (ignorance).`
    );
  }

  return { frame, masses };
}

/**
 * Creates a vacuous (completely ignorant) belief mass function.
 *
 * All mass is assigned to the full frame, representing complete ignorance.
 * This is the identity element for Dempster's combination.
 *
 * @template T - String literal type for frame elements
 * @param frame - The frame of discernment
 * @returns A vacuous belief mass function
 *
 * @example
 * ```typescript
 * // No evidence at all
 * const ignorance = createVacuousMass(new Set(['A', 'B', 'C']));
 * // belief(any singleton) = 0
 * // plausibility(any singleton) = 1
 * ```
 */
export function createVacuousMass<T extends string>(
  frame: Frame<T>
): BeliefMassFunction<T> {
  const masses = new Map<string, number>();
  masses.set(serializeSubset(frame), 1.0);
  return { frame, masses };
}

/**
 * Creates a Bayesian (consonant) belief mass function from a probability distribution.
 *
 * Each element gets mass equal to its probability. This is the special case
 * where D-S reduces to probability theory.
 *
 * @template T - String literal type for frame elements
 * @param frame - The frame of discernment
 * @param probabilities - Map from elements to their probabilities
 * @returns A Bayesian belief mass function
 * @throws Error if probabilities don't sum to 1
 *
 * @example
 * ```typescript
 * // Traditional probability: P(A)=0.3, P(B)=0.5, P(C)=0.2
 * const bayesian = createBayesianMass(
 *   new Set(['A', 'B', 'C']),
 *   new Map([['A', 0.3], ['B', 0.5], ['C', 0.2]])
 * );
 * ```
 */
export function createBayesianMass<T extends string>(
  frame: Frame<T>,
  probabilities: Map<T, number>
): BeliefMassFunction<T> {
  const assignments: MassAssignment<T>[] = [];

  for (const [element, prob] of probabilities) {
    if (!frame.has(element)) {
      throw new Error(`Element "${element}" is not in frame`);
    }
    assignments.push({ subset: new Set([element]), mass: prob });
  }

  return createBeliefMass(frame, assignments);
}

// ============================================================================
// BELIEF AND PLAUSIBILITY
// ============================================================================

/**
 * Calculates belief (lower probability) for a subset.
 *
 * Bel(A) = sum of m(B) for all B that are subsets of A.
 *
 * Belief represents the minimum probability that must be assigned to A.
 * It's the total mass of evidence that directly supports A without ambiguity.
 *
 * @template T - String literal type for frame elements
 * @param bm - The belief mass function
 * @param subset - The subset to calculate belief for
 * @returns Belief value in [0,1]
 *
 * @example
 * ```typescript
 * // If m({working}) = 0.6 and m({working, broken}) = 0.4
 * // Then Bel({working}) = 0.6 (only direct evidence counts)
 * // And Bel({working, broken}) = 1.0 (includes all mass)
 * ```
 */
export function belief<T extends string>(
  bm: BeliefMassFunction<T>,
  subset: Set<T>
): number {
  let bel = 0;

  for (const [key, mass] of bm.masses) {
    const focalElement = deserializeSubset<T>(key);

    // Check if focalElement is a subset of the query subset
    let isSubset = true;
    for (const element of focalElement) {
      if (!subset.has(element)) {
        isSubset = false;
        break;
      }
    }

    if (isSubset) {
      bel += mass;
    }
  }

  return bel;
}

/**
 * Calculates plausibility (upper probability) for a subset.
 *
 * Pl(A) = sum of m(B) for all B that intersect with A.
 * Equivalently: Pl(A) = 1 - Bel(not A)
 *
 * Plausibility represents the maximum probability that could be assigned to A.
 * It includes all mass that doesn't directly contradict A.
 *
 * @template T - String literal type for frame elements
 * @param bm - The belief mass function
 * @param subset - The subset to calculate plausibility for
 * @returns Plausibility value in [0,1]
 *
 * @example
 * ```typescript
 * // If m({working}) = 0.6 and m({working, broken}) = 0.4
 * // Then Pl({working}) = 1.0 (all mass could support working)
 * // But Pl({broken}) = 0.4 (only the ignorance mass)
 * ```
 */
export function plausibility<T extends string>(
  bm: BeliefMassFunction<T>,
  subset: Set<T>
): number {
  let pl = 0;

  for (const [key, mass] of bm.masses) {
    const focalElement = deserializeSubset<T>(key);

    // Check if focalElement intersects with the query subset
    let intersects = false;
    for (const element of focalElement) {
      if (subset.has(element)) {
        intersects = true;
        break;
      }
    }

    if (intersects) {
      pl += mass;
    }
  }

  return pl;
}

/**
 * Calculates the belief interval [Bel(A), Pl(A)] for a subset.
 *
 * The width of this interval represents epistemic uncertainty:
 * - Narrow interval: Strong evidence, clear conclusion
 * - Wide interval: Uncertain, more evidence needed
 *
 * @template T - String literal type for frame elements
 * @param bm - The belief mass function
 * @param subset - The subset to calculate interval for
 * @returns Tuple of [belief, plausibility]
 */
export function beliefInterval<T extends string>(
  bm: BeliefMassFunction<T>,
  subset: Set<T>
): [number, number] {
  return [belief(bm, subset), plausibility(bm, subset)];
}

/**
 * Calculates the pignistic probability for a hypothesis.
 *
 * The pignistic transformation converts belief functions to probability
 * by distributing mass evenly among elements of focal sets.
 *
 * BetP(x) = sum over A containing x of: m(A) / |A|
 *
 * This is useful when a point probability is needed for decision making.
 *
 * @template T - String literal type for frame elements
 * @param bm - The belief mass function
 * @param element - The singleton element
 * @returns Pignistic probability in [0,1]
 */
export function pignisticProbability<T extends string>(
  bm: BeliefMassFunction<T>,
  element: T
): number {
  let prob = 0;

  for (const [key, mass] of bm.masses) {
    const focalElement = deserializeSubset<T>(key);
    if (focalElement.has(element)) {
      prob += mass / focalElement.size;
    }
  }

  return prob;
}

// ============================================================================
// DEMPSTER'S RULE OF COMBINATION
// ============================================================================

/**
 * Combines two belief mass functions using Dempster's rule.
 *
 * Dempster's rule assumes the two sources are independent and combines
 * their evidence by:
 *
 * 1. Computing the intersection of each pair of focal elements
 * 2. Multiplying their masses
 * 3. Normalizing by (1-K) where K is the conflict
 *
 * The conflict K measures how much the sources disagree. High conflict
 * (K > 0.5) suggests the sources may not be reliable to combine.
 *
 * @template T - String literal type for frame elements
 * @param bm1 - First belief mass function
 * @param bm2 - Second belief mass function
 * @returns Combined belief mass function with conflict measure
 * @throws Error if frames don't match or total conflict (K=1)
 *
 * @example
 * ```typescript
 * // Source 1: 80% evidence for 'working'
 * const sensor1 = createBeliefMass(frame, [
 *   { subset: new Set(['working']), mass: 0.8 },
 *   { subset: frame, mass: 0.2 }
 * ]);
 *
 * // Source 2: 70% evidence for 'working'
 * const sensor2 = createBeliefMass(frame, [
 *   { subset: new Set(['working']), mass: 0.7 },
 *   { subset: frame, mass: 0.3 }
 * ]);
 *
 * // Combined: Even stronger evidence for 'working'
 * const combined = combineDempster(sensor1, sensor2);
 * // combined.conflict ≈ 0 (sources agree)
 * ```
 */
export function combineDempster<T extends string>(
  bm1: BeliefMassFunction<T>,
  bm2: BeliefMassFunction<T>
): CombinationResult<T> {
  // Validate frames match
  if (!framesEqual(bm1.frame, bm2.frame)) {
    throw new Error('Cannot combine belief functions with different frames');
  }

  const frame = bm1.frame;
  const rawMasses = new Map<string, number>();
  let conflict = 0;

  // Compute all pairwise intersections
  for (const [key1, mass1] of bm1.masses) {
    const set1 = deserializeSubset<T>(key1);

    for (const [key2, mass2] of bm2.masses) {
      const set2 = deserializeSubset<T>(key2);

      // Compute intersection
      const intersection = new Set<T>();
      for (const element of set1) {
        if (set2.has(element)) {
          intersection.add(element);
        }
      }

      const productMass = mass1 * mass2;

      if (intersection.size === 0) {
        // Empty intersection contributes to conflict
        conflict += productMass;
      } else {
        // Non-empty intersection contributes to combined mass
        const key = serializeSubset(intersection);
        rawMasses.set(key, (rawMasses.get(key) ?? 0) + productMass);
      }
    }
  }

  // Check for total conflict
  if (conflict >= 1 - 1e-10) {
    throw new Error(
      'Total conflict (K=1): Sources completely contradict each other. ' +
      'Cannot combine using Dempster\'s rule. Consider using combineWithHighConflict().'
    );
  }

  // Normalize by (1 - conflict)
  const normalization = 1 - conflict;
  const normalizedMasses = new Map<string, number>();

  for (const [key, mass] of rawMasses) {
    normalizedMasses.set(key, mass / normalization);
  }

  return {
    combined: { frame, masses: normalizedMasses },
    conflict,
    normalized: true,
  };
}

/**
 * Combines multiple belief mass functions sequentially.
 *
 * This is associative: combine([a, b, c]) = combine([combine([a, b]), c])
 *
 * @template T - String literal type for frame elements
 * @param bmArray - Array of belief mass functions to combine
 * @returns Combined result with cumulative conflict
 * @throws Error if fewer than 2 functions or incompatible frames
 */
export function combineMultiple<T extends string>(
  bmArray: BeliefMassFunction<T>[]
): CombinationResult<T> {
  if (bmArray.length < 2) {
    throw new Error('Need at least 2 belief mass functions to combine');
  }

  let result = combineDempster(bmArray[0], bmArray[1]);
  let cumulativeConflict = result.conflict;

  for (let i = 2; i < bmArray.length; i++) {
    result = combineDempster(result.combined, bmArray[i]);
    // Accumulate conflict (this is approximate - true cumulative conflict is more complex)
    cumulativeConflict = cumulativeConflict + result.conflict * (1 - cumulativeConflict);
  }

  return {
    combined: result.combined,
    conflict: cumulativeConflict,
    normalized: true,
  };
}

// ============================================================================
// CONFLICT HANDLING
// ============================================================================

/**
 * Default conflict threshold for determining if conflict is "too high".
 *
 * At K > 0.5, more than half of the evidence is conflicting.
 * This is a reasonable default, but applications may need different thresholds.
 */
export const DEFAULT_CONFLICT_THRESHOLD = 0.5;

/**
 * Checks if conflict is too high to reliably combine sources.
 *
 * When conflict is high, Dempster's rule may produce counterintuitive results
 * (Zadeh's paradox). Consider:
 * - Using Yager's rule instead
 * - Investigating why sources disagree
 * - Not combining the sources at all
 *
 * @param conflict - The conflict measure K from combination
 * @param threshold - Maximum acceptable conflict (default: 0.5)
 * @returns True if conflict exceeds threshold
 */
export function isConflictTooHigh(
  conflict: number,
  threshold: number = DEFAULT_CONFLICT_THRESHOLD
): boolean {
  return conflict > threshold;
}

/**
 * Conflict severity levels for decision making.
 */
export type ConflictSeverity = 'low' | 'moderate' | 'high' | 'critical';

/**
 * Analyzes conflict severity with suggested actions.
 *
 * @param conflict - The conflict measure K
 * @returns Severity level and recommended action
 */
export function analyzeConflict(conflict: number): {
  severity: ConflictSeverity;
  action: string;
} {
  if (conflict < 0.1) {
    return {
      severity: 'low',
      action: 'Sources agree well. Safe to combine.',
    };
  } else if (conflict < 0.3) {
    return {
      severity: 'moderate',
      action: 'Some disagreement. Review source reliability.',
    };
  } else if (conflict < 0.6) {
    return {
      severity: 'high',
      action: 'Significant conflict. Consider using Yager\'s rule or manual review.',
    };
  } else {
    return {
      severity: 'critical',
      action: 'Sources fundamentally disagree. Investigate before combining.',
    };
  }
}

/**
 * Combines belief functions using Yager's rule (handles high conflict).
 *
 * Unlike Dempster's rule, Yager's rule assigns conflict mass to the full
 * frame (ignorance) rather than normalizing it away. This is more
 * conservative and avoids counterintuitive results when sources conflict.
 *
 * Yager's rule:
 * - m(A) = sum of m1(B)*m2(C) where B∩C=A (same as Dempster)
 * - m(Omega) += conflict (instead of normalizing)
 *
 * @template T - String literal type for frame elements
 * @param bm1 - First belief mass function
 * @param bm2 - Second belief mass function
 * @returns Combined result (conflict is reported but not normalized away)
 *
 * @example
 * ```typescript
 * // When sources disagree significantly
 * const combined = combineWithHighConflict(source1, source2);
 * // Conflict mass goes to ignorance rather than being normalized
 * ```
 */
export function combineWithHighConflict<T extends string>(
  bm1: BeliefMassFunction<T>,
  bm2: BeliefMassFunction<T>
): CombinationResult<T> {
  // Validate frames match
  if (!framesEqual(bm1.frame, bm2.frame)) {
    throw new Error('Cannot combine belief functions with different frames');
  }

  const frame = bm1.frame;
  const masses = new Map<string, number>();
  let conflict = 0;

  // Compute all pairwise intersections
  for (const [key1, mass1] of bm1.masses) {
    const set1 = deserializeSubset<T>(key1);

    for (const [key2, mass2] of bm2.masses) {
      const set2 = deserializeSubset<T>(key2);

      // Compute intersection
      const intersection = new Set<T>();
      for (const element of set1) {
        if (set2.has(element)) {
          intersection.add(element);
        }
      }

      const productMass = mass1 * mass2;

      if (intersection.size === 0) {
        // Empty intersection contributes to conflict
        conflict += productMass;
      } else {
        // Non-empty intersection contributes to combined mass
        const key = serializeSubset(intersection);
        masses.set(key, (masses.get(key) ?? 0) + productMass);
      }
    }
  }

  // Yager's rule: Assign conflict mass to the full frame (ignorance)
  const frameKey = serializeSubset(frame);
  masses.set(frameKey, (masses.get(frameKey) ?? 0) + conflict);

  return {
    combined: { frame, masses },
    conflict,
    normalized: false, // Not normalized in the Dempster sense
  };
}

// ============================================================================
// INTEGRATION WITH BOUNDEDCONFIDENCE
// ============================================================================

/**
 * Converts a D-S belief function to BoundedConfidence for a specific hypothesis.
 *
 * This bridges D-S theory to Librarian's confidence system:
 * - Belief becomes the lower bound
 * - Plausibility becomes the upper bound
 *
 * @template T - String literal type for frame elements
 * @param bm - The belief mass function
 * @param hypothesis - The subset to convert (typically a singleton like {correct})
 * @returns BoundedConfidence compatible with Librarian's confidence system
 *
 * @example
 * ```typescript
 * // Convert D-S result to BoundedConfidence
 * const bounded = toBoundedConfidence(combined.combined, new Set(['correct']));
 * // bounded.low = belief (guaranteed support)
 * // bounded.high = plausibility (maximum possible support)
 * ```
 */
export function toBoundedConfidence<T extends string>(
  bm: BeliefMassFunction<T>,
  hypothesis: Set<T>
): BoundedConfidence {
  const bel = belief(bm, hypothesis);
  const pl = plausibility(bm, hypothesis);

  return {
    type: 'bounded',
    low: bel,
    high: pl,
    basis: 'formal_analysis',
    citation: `Dempster-Shafer belief function: Bel=${bel.toFixed(4)}, Pl=${pl.toFixed(4)}`,
  };
}

/**
 * Creates a BeliefMassFunction from a BoundedConfidence.
 *
 * This converts a simple interval back to a D-S structure on a binary frame.
 * The transformation:
 * - m({true}) = lower bound
 * - m({true, false}) = plausibility - belief (the uncertainty width)
 * - m({false}) = 1 - plausibility
 *
 * @param bounded - The bounded confidence to convert
 * @returns A belief mass function on frame {true, false}
 */
export function fromBoundedConfidence(
  bounded: BoundedConfidence
): BeliefMassFunction<'true' | 'false'> {
  type BinaryFrame = 'true' | 'false';
  const frame = new Set<BinaryFrame>(['true', 'false']);

  const assignments: MassAssignment<BinaryFrame>[] = [];

  // Mass for {true}: the belief (lower bound)
  if (bounded.low > 0) {
    assignments.push({
      subset: new Set<BinaryFrame>(['true']),
      mass: bounded.low,
    });
  }

  // Mass for {false}: 1 - plausibility (what definitely isn't true)
  const massForFalse = 1 - bounded.high;
  if (massForFalse > 0) {
    assignments.push({
      subset: new Set<BinaryFrame>(['false']),
      mass: massForFalse,
    });
  }

  // Mass for {true, false}: the uncertainty interval width
  const uncertainty = bounded.high - bounded.low;
  if (uncertainty > 0) {
    assignments.push({
      subset: frame,
      mass: uncertainty,
    });
  }

  // Handle edge case where all values are 0 (shouldn't happen with valid input)
  if (assignments.length === 0) {
    assignments.push({ subset: frame, mass: 1.0 });
  }

  return createBeliefMass(frame, assignments);
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Checks if two frames are equal.
 */
function framesEqual<T extends string>(frame1: Frame<T>, frame2: Frame<T>): boolean {
  if (frame1.size !== frame2.size) return false;
  for (const element of frame1) {
    if (!frame2.has(element)) return false;
  }
  return true;
}

/**
 * Gets all focal elements (subsets with non-zero mass).
 *
 * @template T - String literal type for frame elements
 * @param bm - The belief mass function
 * @returns Array of [subset, mass] pairs
 */
export function getFocalElements<T extends string>(
  bm: BeliefMassFunction<T>
): Array<[Set<T>, number]> {
  const result: Array<[Set<T>, number]> = [];

  for (const [key, mass] of bm.masses) {
    if (mass > 0) {
      result.push([deserializeSubset<T>(key), mass]);
    }
  }

  return result;
}

/**
 * Calculates the specificity of a belief mass function.
 *
 * Specificity measures how precise the evidence is:
 * - 1 = All mass on singletons (like probability)
 * - 0 = All mass on full frame (complete ignorance)
 *
 * @template T - String literal type for frame elements
 * @param bm - The belief mass function
 * @returns Specificity value in [0,1]
 */
export function specificity<T extends string>(bm: BeliefMassFunction<T>): number {
  const n = bm.frame.size;
  if (n <= 1) return 1;

  let spec = 0;
  const normalizer = n - 1;

  for (const [key, mass] of bm.masses) {
    const focalSize = deserializeSubset<T>(key).size;
    // Specificity contribution: (n - |A|) / (n - 1)
    spec += mass * (n - focalSize) / normalizer;
  }

  return spec;
}

/**
 * Calculates the non-specificity (entropy-like measure).
 *
 * Non-specificity measures the uncertainty due to imprecision:
 * - 0 = All mass on singletons
 * - High = Mass distributed on large sets
 *
 * @template T - String literal type for frame elements
 * @param bm - The belief mass function
 * @returns Non-specificity value >= 0
 */
export function nonSpecificity<T extends string>(bm: BeliefMassFunction<T>): number {
  let ns = 0;

  for (const [key, mass] of bm.masses) {
    const focalSize = deserializeSubset<T>(key).size;
    if (focalSize > 1) {
      // Hartley entropy: log2(|A|)
      ns += mass * Math.log2(focalSize);
    }
  }

  return ns;
}

/**
 * Type guard for BeliefMassFunction.
 */
export function isBeliefMassFunction(value: unknown): value is BeliefMassFunction<string> {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;

  return (
    candidate.frame instanceof Set &&
    candidate.masses instanceof Map
  );
}

/**
 * Type guard for CombinationResult.
 */
export function isCombinationResult(value: unknown): value is CombinationResult<string> {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;

  return (
    isBeliefMassFunction(candidate.combined) &&
    typeof candidate.conflict === 'number' &&
    typeof candidate.normalized === 'boolean'
  );
}
