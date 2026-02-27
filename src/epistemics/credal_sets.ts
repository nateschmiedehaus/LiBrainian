/**
 * @fileoverview Credal Sets for Imprecise Probability
 *
 * Implements credal sets and interval arithmetic for principled uncertainty
 * representation in Librarian's epistemic system.
 *
 * ## Mathematical Background
 *
 * A **credal set** is a convex set C of probability distributions representing
 * imprecise probability (Walley 1991). Instead of a single probability P(A),
 * we have:
 * - Lower probability: P*(A) = inf{P(A) : P in C}
 * - Upper probability: P*(A) = sup{P(A) : P in C}
 *
 * Key properties:
 * - P*(A) + P*(not-A) can be < 1 (genuine uncertainty)
 * - Coherent credal sets satisfy: P*(A) <= P*(A)
 * - Interval-valued belief: [P*(A), P*(A)]
 *
 * ## Relation to BoundedConfidence
 *
 * BoundedConfidence already captures the interval [low, high] representation.
 * This module extends it with:
 * - Proper credal set composition rules
 * - Interval arithmetic for combining uncertainty
 * - Marginalization and conditioning operations
 *
 * @see docs/archive/specs/research/mathematical-foundations.md (Section 1.2)
 * @packageDocumentation
 */

import type { BoundedConfidence, ConfidenceValue } from './confidence.js';
import { bounded, getNumericValue, isBoundedConfidence } from './confidence.js';

// ============================================================================
// INTERVAL ARITHMETIC
// ============================================================================

/**
 * An interval representing imprecise probability bounds.
 *
 * Intervals are the building blocks of credal set computation.
 * All operations preserve the property that lower <= upper.
 */
export interface Interval {
  /** Lower bound (infimum) */
  readonly lower: number;
  /** Upper bound (supremum) */
  readonly upper: number;
}

/**
 * Create an interval with validation.
 *
 * @param lower - Lower bound
 * @param upper - Upper bound
 * @returns Valid interval
 * @throws Error if lower > upper or bounds are outside [0, 1]
 */
export function createInterval(lower: number, upper: number): Interval {
  if (lower > upper) {
    throw new Error(`Invalid interval: lower (${lower}) > upper (${upper})`);
  }
  if (lower < 0 || upper > 1) {
    throw new Error(`Interval bounds must be in [0, 1], got [${lower}, ${upper}]`);
  }
  return { lower, upper };
}

/**
 * Check if a point value is contained in an interval.
 */
export function intervalContains(interval: Interval, value: number): boolean {
  return value >= interval.lower && value <= interval.upper;
}

/**
 * Add two intervals: [a, b] + [c, d] = [a+c, b+d].
 *
 * Clamped to [0, 1] for probability semantics.
 */
export function addIntervals(a: Interval, b: Interval): Interval {
  return createInterval(
    Math.max(0, a.lower + b.lower),
    Math.min(1, a.upper + b.upper)
  );
}

/**
 * Subtract intervals: [a, b] - [c, d] = [a-d, b-c].
 *
 * Clamped to [0, 1] for probability semantics.
 */
export function subtractIntervals(a: Interval, b: Interval): Interval {
  return createInterval(
    Math.max(0, a.lower - b.upper),
    Math.min(1, a.upper - b.lower)
  );
}

/**
 * Multiply two intervals: [a, b] * [c, d].
 *
 * For positive intervals in [0, 1]:
 * Result = [min(ac, ad, bc, bd), max(ac, ad, bc, bd)]
 *
 * Since all values are in [0, 1], this simplifies to:
 * Result = [a*c, b*d] for positive intervals.
 */
export function multiplyIntervals(a: Interval, b: Interval): Interval {
  // For [0, 1] intervals, all products are non-negative
  const products = [
    a.lower * b.lower,
    a.lower * b.upper,
    a.upper * b.lower,
    a.upper * b.upper,
  ];
  return createInterval(
    Math.min(...products),
    Math.max(...products)
  );
}

/**
 * Compute 1 - interval: 1 - [a, b] = [1-b, 1-a].
 *
 * Used for complement operations in probability.
 */
export function complementInterval(interval: Interval): Interval {
  return createInterval(1 - interval.upper, 1 - interval.lower);
}

/**
 * Interval for sequential composition (product of independent intervals).
 *
 * P(A AND B AND ...) = P(A) * P(B) * ... (assuming independence)
 *
 * For intervals: [prod(lowers), prod(uppers)]
 *
 * @param intervals - Array of intervals to compose sequentially
 * @returns Product interval representing P(all events)
 */
export function sequenceIntervals(intervals: Interval[]): Interval {
  if (intervals.length === 0) {
    return createInterval(1, 1); // Empty product = 1
  }

  let result = intervals[0];
  for (let i = 1; i < intervals.length; i++) {
    result = multiplyIntervals(result, intervals[i]);
  }
  return result;
}

/**
 * Interval for parallel AND composition (minimum).
 *
 * For pessimistic combination: take the minimum of all bounds.
 * This is the "weakest link" semantics.
 *
 * @param intervals - Array of intervals
 * @returns Interval with [min(lowers), min(uppers)]
 */
export function parallelIntervalsAnd(intervals: Interval[]): Interval {
  if (intervals.length === 0) {
    return createInterval(1, 1); // Identity for AND
  }

  return createInterval(
    Math.min(...intervals.map((i) => i.lower)),
    Math.min(...intervals.map((i) => i.upper))
  );
}

/**
 * Interval for parallel OR composition (noisy-or style).
 *
 * P(A OR B) = 1 - (1 - P(A)) * (1 - P(B)) (assuming independence)
 *
 * For intervals: 1 - product of complement intervals.
 *
 * @param intervals - Array of intervals
 * @returns Interval representing P(at least one event)
 */
export function parallelIntervalsOr(intervals: Interval[]): Interval {
  if (intervals.length === 0) {
    return createInterval(0, 0); // Identity for OR (nothing can happen)
  }

  // Compute complements: [1 - upper, 1 - lower] for each
  const complements = intervals.map(complementInterval);

  // Multiply complements (probability all fail)
  const allFail = sequenceIntervals(complements);

  // Return complement (probability at least one succeeds)
  return complementInterval(allFail);
}

/**
 * Compute the width of an interval (measure of imprecision).
 */
export function intervalWidth(interval: Interval): number {
  return interval.upper - interval.lower;
}

/**
 * Compute the midpoint of an interval.
 */
export function intervalMidpoint(interval: Interval): number {
  return (interval.lower + interval.upper) / 2;
}

/**
 * Check if an interval is precise (width = 0).
 */
export function isIntervalPrecise(interval: Interval): boolean {
  return Math.abs(interval.upper - interval.lower) < Number.EPSILON;
}

/**
 * Check if an interval is vacuous (spans entire [0, 1]).
 */
export function isIntervalVacuous(interval: Interval): boolean {
  return interval.lower <= Number.EPSILON && interval.upper >= 1 - Number.EPSILON;
}

// ============================================================================
// CREDAL SETS
// ============================================================================

/**
 * A credal set - represented as lower and upper probability bounds for each outcome.
 *
 * For a finite outcome space, a credal set can be represented by:
 * - For each outcome o: [P*(o), P*(o)]
 *
 * Coherence requires:
 * - sum(P*(o)) <= 1 (lower bounds don't exceed total mass)
 * - sum(P*(o)) >= 1 (upper bounds cover total mass)
 */
export interface CredalSet {
  /** The outcome space */
  readonly outcomes: readonly string[];
  /** Lower probability for each outcome: P*(outcome) */
  readonly lowerBounds: ReadonlyMap<string, number>;
  /** Upper probability for each outcome: P*(outcome) */
  readonly upperBounds: ReadonlyMap<string, number>;
}

/**
 * Create a credal set with validation.
 *
 * @param outcomes - The outcome space
 * @param lowerBounds - Lower probability bounds
 * @param upperBounds - Upper probability bounds
 * @returns Valid credal set
 * @throws Error if bounds are inconsistent
 */
export function createCredalSet(
  outcomes: string[],
  lowerBounds: Map<string, number>,
  upperBounds: Map<string, number>
): CredalSet {
  // Validate all outcomes have bounds
  for (const outcome of outcomes) {
    if (!lowerBounds.has(outcome)) {
      throw new Error(`Missing lower bound for outcome: ${outcome}`);
    }
    if (!upperBounds.has(outcome)) {
      throw new Error(`Missing upper bound for outcome: ${outcome}`);
    }
  }

  // Validate lower <= upper for each outcome
  for (const outcome of outcomes) {
    const lower = lowerBounds.get(outcome)!;
    const upper = upperBounds.get(outcome)!;
    if (lower > upper) {
      throw new Error(
        `Invalid bounds for outcome ${outcome}: lower (${lower}) > upper (${upper})`
      );
    }
    if (lower < 0 || upper > 1) {
      throw new Error(
        `Bounds must be in [0, 1] for outcome ${outcome}, got [${lower}, ${upper}]`
      );
    }
  }

  // Check coherence: sum of lowers <= 1, sum of uppers >= 1
  let lowerSum = 0;
  let upperSum = 0;
  for (const outcome of outcomes) {
    lowerSum += lowerBounds.get(outcome)!;
    upperSum += upperBounds.get(outcome)!;
  }

  if (lowerSum > 1 + Number.EPSILON) {
    throw new Error(`Incoherent credal set: sum of lower bounds (${lowerSum}) > 1`);
  }
  if (upperSum < 1 - Number.EPSILON) {
    throw new Error(`Incoherent credal set: sum of upper bounds (${upperSum}) < 1`);
  }

  return {
    outcomes: [...outcomes],
    lowerBounds: new Map(lowerBounds),
    upperBounds: new Map(upperBounds),
  };
}

/**
 * Check if a point probability distribution is in the credal set.
 *
 * A distribution P is in C if:
 * - P*(o) <= P(o) <= P*(o) for all outcomes o
 * - sum(P(o)) = 1
 *
 * @param credal - The credal set
 * @param distribution - A point probability distribution
 * @returns True if distribution is in the credal set
 */
export function isInCredalSet(
  credal: CredalSet,
  distribution: ReadonlyMap<string, number>
): boolean {
  // Check all outcomes are present and sum to 1
  let sum = 0;
  for (const outcome of credal.outcomes) {
    const prob = distribution.get(outcome);
    if (prob === undefined) {
      return false;
    }

    const lower = credal.lowerBounds.get(outcome)!;
    const upper = credal.upperBounds.get(outcome)!;

    if (prob < lower - Number.EPSILON || prob > upper + Number.EPSILON) {
      return false;
    }

    sum += prob;
  }

  // Check normalization
  return Math.abs(sum - 1) < Number.EPSILON;
}

/**
 * Create a vacuous credal set (complete ignorance).
 *
 * All distributions are possible:
 * - P*(o) = 0 for all outcomes
 * - P*(o) = 1 for all outcomes
 *
 * @param outcomes - The outcome space
 * @returns Vacuous credal set
 */
export function vacuousCredal(outcomes: string[]): CredalSet {
  const lowerBounds = new Map<string, number>();
  const upperBounds = new Map<string, number>();

  for (const outcome of outcomes) {
    lowerBounds.set(outcome, 0);
    upperBounds.set(outcome, 1);
  }

  return {
    outcomes: [...outcomes],
    lowerBounds,
    upperBounds,
  };
}

/**
 * Create a precise credal set (single distribution).
 *
 * Only one distribution is possible (zero imprecision).
 *
 * @param distribution - The precise probability distribution
 * @returns Precise credal set
 */
export function preciseCredal(distribution: ReadonlyMap<string, number>): CredalSet {
  const outcomes = [...distribution.keys()];
  const lowerBounds = new Map<string, number>();
  const upperBounds = new Map<string, number>();

  // Validate distribution sums to 1
  let sum = 0;
  for (const [outcome, prob] of distribution) {
    if (prob < 0 || prob > 1) {
      throw new Error(`Invalid probability for outcome ${outcome}: ${prob}`);
    }
    sum += prob;
    lowerBounds.set(outcome, prob);
    upperBounds.set(outcome, prob);
  }

  if (Math.abs(sum - 1) > Number.EPSILON) {
    throw new Error(`Distribution must sum to 1, got ${sum}`);
  }

  return {
    outcomes,
    lowerBounds,
    upperBounds,
  };
}

/**
 * Check if a credal set is vacuous (complete ignorance).
 */
export function isVacuous(credal: CredalSet): boolean {
  for (const outcome of credal.outcomes) {
    const lower = credal.lowerBounds.get(outcome)!;
    const upper = credal.upperBounds.get(outcome)!;

    // In a vacuous credal set, every outcome has [0, 1] bounds
    if (lower > Number.EPSILON || upper < 1 - Number.EPSILON) {
      return false;
    }
  }
  return true;
}

/**
 * Check if a credal set is precise (single distribution).
 */
export function isPrecise(credal: CredalSet): boolean {
  for (const outcome of credal.outcomes) {
    const lower = credal.lowerBounds.get(outcome)!;
    const upper = credal.upperBounds.get(outcome)!;

    if (Math.abs(upper - lower) > Number.EPSILON) {
      return false;
    }
  }
  return true;
}

/**
 * Get the interval for a specific outcome.
 */
export function getOutcomeInterval(credal: CredalSet, outcome: string): Interval {
  const lower = credal.lowerBounds.get(outcome);
  const upper = credal.upperBounds.get(outcome);

  if (lower === undefined || upper === undefined) {
    throw new Error(`Outcome ${outcome} not in credal set`);
  }

  return { lower, upper };
}

/**
 * Compute the total imprecision of a credal set.
 *
 * Sum of interval widths for all outcomes.
 */
export function credalImprecision(credal: CredalSet): number {
  let totalWidth = 0;
  for (const outcome of credal.outcomes) {
    const interval = getOutcomeInterval(credal, outcome);
    totalWidth += intervalWidth(interval);
  }
  return totalWidth;
}

// ============================================================================
// CREDAL OPERATIONS
// ============================================================================

/**
 * Marginalize a credal set to a subset of outcomes.
 *
 * For outcomes A subset Omega:
 * - P*(A) = sum of P*(a) for a in A
 * - P*(A) = 1 - sum of P*(b) for b not in A
 *
 * Actually, for proper marginalization we need:
 * - P*(A) = max(0, 1 - sum_{b not in A} P*(b))
 * - P*(A) = min(1, sum_{a in A} P*(a))
 *
 * @param credal - The credal set to marginalize
 * @param outcomes - The subset of outcomes to keep
 * @returns Marginalized credal set with a single outcome representing the subset
 */
export function marginalize(
  credal: CredalSet,
  outcomes: string[]
): CredalSet {
  // Validate outcomes are in the credal set
  for (const outcome of outcomes) {
    if (!credal.outcomes.includes(outcome)) {
      throw new Error(`Outcome ${outcome} not in credal set`);
    }
  }

  // Compute complement outcomes
  const complementOutcomes = credal.outcomes.filter((o) => !outcomes.includes(o));

  // Lower bound for subset = 1 - sum of upper bounds for complement
  let complementUpperSum = 0;
  for (const o of complementOutcomes) {
    complementUpperSum += credal.upperBounds.get(o)!;
  }
  const subsetLower = Math.max(0, 1 - complementUpperSum);

  // Upper bound for subset = sum of upper bounds for subset
  let subsetUpperSum = 0;
  for (const o of outcomes) {
    subsetUpperSum += credal.upperBounds.get(o)!;
  }
  const subsetUpper = Math.min(1, subsetUpperSum);

  // Create binary credal set: {subset, complement}
  const marginalized = new Map<string, number>();
  const marginalizedUpper = new Map<string, number>();

  marginalized.set('subset', subsetLower);
  marginalizedUpper.set('subset', subsetUpper);
  marginalized.set('complement', Math.max(0, 1 - subsetUpper));
  marginalizedUpper.set('complement', Math.min(1, 1 - subsetLower));

  return createCredalSet(['subset', 'complement'], marginalized, marginalizedUpper);
}

/**
 * Condition a credal set on evidence (an outcome being true).
 *
 * Using regular extension (Walley):
 * - P*(A | B) = P*(A intersect B) / P*(B)
 * - P*(A | B) = P*(A intersect B) / P*(B)
 *
 * For conditioning on a single outcome B:
 * - The conditioned credal set is over outcomes that could co-occur with B
 *
 * Simplified version for binary conditioning:
 * Returns the conditional bounds for the outcome given evidence.
 *
 * @param credal - The credal set
 * @param evidence - The outcome that is known to be true
 * @returns Interval representing P*(evidence | credal), P*(evidence | credal)
 */
export function condition(
  credal: CredalSet,
  evidence: string
): Interval {
  if (!credal.outcomes.includes(evidence)) {
    throw new Error(`Evidence outcome ${evidence} not in credal set`);
  }

  const evidenceLower = credal.lowerBounds.get(evidence)!;
  const evidenceUpper = credal.upperBounds.get(evidence)!;

  // If evidence is impossible (upper = 0), conditioning is undefined
  if (evidenceUpper < Number.EPSILON) {
    throw new Error(`Cannot condition on impossible evidence: P*(${evidence}) = 0`);
  }

  // The conditional probability of evidence given evidence is 1
  // But what we return is the credal interval for the evidence
  // This is a simplification - full conditioning requires joint distributions

  return createInterval(evidenceLower, evidenceUpper);
}

/**
 * Natural extension - extend credal set to new outcomes.
 *
 * When adding new outcomes with no information, use vacuous extension:
 * - New outcomes get [0, 1] bounds
 * - Existing bounds are preserved but may need rescaling
 *
 * @param credal - Original credal set
 * @param newOutcomes - New outcomes to add
 * @returns Extended credal set
 */
export function naturalExtension(
  credal: CredalSet,
  newOutcomes: string[]
): CredalSet {
  // Check for overlap
  for (const outcome of newOutcomes) {
    if (credal.outcomes.includes(outcome)) {
      throw new Error(`Outcome ${outcome} already in credal set`);
    }
  }

  const allOutcomes = [...credal.outcomes, ...newOutcomes];
  const lowerBounds = new Map<string, number>();
  const upperBounds = new Map<string, number>();

  // Preserve existing bounds (but lower bounds may need adjustment)
  // In natural extension, we preserve the constraints from original
  for (const outcome of credal.outcomes) {
    lowerBounds.set(outcome, credal.lowerBounds.get(outcome)!);
    upperBounds.set(outcome, credal.upperBounds.get(outcome)!);
  }

  // New outcomes are vacuous (no information)
  for (const outcome of newOutcomes) {
    lowerBounds.set(outcome, 0);
    upperBounds.set(outcome, 1);
  }

  return {
    outcomes: allOutcomes,
    lowerBounds,
    upperBounds,
  };
}

// ============================================================================
// BOUNDED CONFIDENCE INTEGRATION
// ============================================================================

/**
 * Convert BoundedConfidence to a binary CredalSet.
 *
 * A BoundedConfidence [low, high] represents uncertainty about a binary outcome
 * (success/failure). The credal set has:
 * - Outcomes: ['success', 'failure']
 * - P*(success) = low, P*(success) = high
 * - P*(failure) = 1 - high, P*(failure) = 1 - low
 *
 * @param bounded - BoundedConfidence value
 * @returns Binary credal set
 */
export function toCredalSet(bounded: BoundedConfidence): CredalSet {
  const lowerBounds = new Map<string, number>();
  const upperBounds = new Map<string, number>();

  lowerBounds.set('success', bounded.low);
  upperBounds.set('success', bounded.high);

  lowerBounds.set('failure', 1 - bounded.high);
  upperBounds.set('failure', 1 - bounded.low);

  return createCredalSet(['success', 'failure'], lowerBounds, upperBounds);
}

/**
 * Convert a CredalSet to BoundedConfidence for a specific outcome.
 *
 * @param credal - The credal set
 * @param outcome - The outcome to extract bounds for
 * @param basis - Basis for the bounded confidence
 * @param citation - Citation for the bounded confidence
 * @returns BoundedConfidence for the outcome
 */
export function toBoundedFromCredal(
  credal: CredalSet,
  outcome: string,
  basis: 'theoretical' | 'literature' | 'formal_analysis' = 'formal_analysis',
  citation: string = 'derived from credal set'
): BoundedConfidence {
  const interval = getOutcomeInterval(credal, outcome);
  return bounded(interval.lower, interval.upper, basis, citation);
}

/**
 * Convert any ConfidenceValue to an Interval.
 *
 * - Deterministic: [value, value]
 * - Derived: [value, value]
 * - Measured: [ci_low, ci_high] or [value, value] if no CI
 * - Bounded: [low, high]
 * - Absent: [0, 1] (vacuous)
 */
export function confidenceToInterval(confidence: ConfidenceValue): Interval {
  switch (confidence.type) {
    case 'deterministic':
      return createInterval(confidence.value, confidence.value);

    case 'derived':
      return createInterval(confidence.value, confidence.value);

    case 'measured':
      // Use confidence interval if available
      return createInterval(
        confidence.measurement.confidenceInterval[0],
        confidence.measurement.confidenceInterval[1]
      );

    case 'bounded':
      return createInterval(confidence.low, confidence.high);

    case 'absent':
      // Complete ignorance = vacuous interval
      return createInterval(0, 1);
  }
}

/**
 * Compose multiple BoundedConfidence values using credal set math.
 *
 * Operations:
 * - 'sequence': Product of intervals (independent AND)
 * - 'parallel_and': Minimum of intervals (pessimistic AND)
 * - 'parallel_or': Noisy-or of intervals (independent OR)
 *
 * @param bounds - Array of BoundedConfidence values to compose
 * @param operation - Composition operation
 * @returns Composed BoundedConfidence
 */
export function composeCredalBounds(
  bounds: BoundedConfidence[],
  operation: 'sequence' | 'parallel_and' | 'parallel_or'
): BoundedConfidence {
  if (bounds.length === 0) {
    // Identity elements
    const defaultInterval =
      operation === 'parallel_or'
        ? createInterval(0, 0)
        : createInterval(1, 1);

    return bounded(
      defaultInterval.lower,
      defaultInterval.upper,
      'formal_analysis',
      `identity for ${operation}`
    );
  }

  // Convert to intervals
  const intervals = bounds.map((b) => createInterval(b.low, b.high));

  // Apply operation
  let result: Interval;
  switch (operation) {
    case 'sequence':
      result = sequenceIntervals(intervals);
      break;
    case 'parallel_and':
      result = parallelIntervalsAnd(intervals);
      break;
    case 'parallel_or':
      result = parallelIntervalsOr(intervals);
      break;
  }

  // Combine citations
  const citations = bounds.map((b) => b.citation).join('; ');

  return bounded(
    result.lower,
    result.upper,
    'formal_analysis',
    `${operation}(${citations})`
  );
}

/**
 * Compose multiple ConfidenceValue values using credal set math.
 *
 * This is the general version that handles any ConfidenceValue type.
 * Converts all inputs to intervals, applies the operation, and returns
 * a BoundedConfidence result.
 *
 * @param values - Array of ConfidenceValue to compose
 * @param operation - Composition operation
 * @returns Composed BoundedConfidence
 */
export function composeConfidenceCredal(
  values: ConfidenceValue[],
  operation: 'sequence' | 'parallel_and' | 'parallel_or'
): BoundedConfidence {
  if (values.length === 0) {
    const defaultInterval =
      operation === 'parallel_or'
        ? createInterval(0, 0)
        : createInterval(1, 1);

    return bounded(
      defaultInterval.lower,
      defaultInterval.upper,
      'formal_analysis',
      `identity for ${operation}`
    );
  }

  // Convert all to intervals
  const intervals = values.map(confidenceToInterval);

  // Apply operation
  let result: Interval;
  switch (operation) {
    case 'sequence':
      result = sequenceIntervals(intervals);
      break;
    case 'parallel_and':
      result = parallelIntervalsAnd(intervals);
      break;
    case 'parallel_or':
      result = parallelIntervalsOr(intervals);
      break;
  }

  // Determine if all inputs were bounded
  const allBounded = values.every(isBoundedConfidence);
  const anyAbsent = values.some((v) => v.type === 'absent');

  let basis: 'theoretical' | 'literature' | 'formal_analysis' = 'formal_analysis';
  if (anyAbsent) {
    basis = 'theoretical'; // Includes vacuous intervals
  } else if (allBounded) {
    // Inherit basis from first bounded input
    const firstBounded = values.find(isBoundedConfidence) as BoundedConfidence;
    basis = firstBounded.basis;
  }

  return bounded(
    result.lower,
    result.upper,
    basis,
    `credal_${operation} over ${values.length} inputs`
  );
}

// ============================================================================
// IMPRECISION PROPAGATION
// ============================================================================

/**
 * Result of imprecision propagation through a derivation.
 */
export interface ImprecisionPropagationResult {
  /** Final interval bounds */
  readonly interval: Interval;
  /** Source of imprecision */
  readonly imprecisionSource:
    | 'data_scarcity'
    | 'disagreement'
    | 'theoretical'
    | 'composition';
  /** How much imprecision increased (width_after - max_width_before) */
  readonly widthIncrease: number;
  /** Number of inputs */
  readonly inputCount: number;
}

/**
 * Track imprecision propagation through interval composition.
 *
 * This helps understand how uncertainty grows through derivation chains.
 *
 * @param intervals - Input intervals
 * @param operation - Composition operation
 * @returns Propagation result with imprecision analysis
 */
export function trackImprecisionPropagation(
  intervals: Interval[],
  operation: 'sequence' | 'parallel_and' | 'parallel_or'
): ImprecisionPropagationResult {
  if (intervals.length === 0) {
    const identity =
      operation === 'parallel_or'
        ? createInterval(0, 0)
        : createInterval(1, 1);

    return {
      interval: identity,
      imprecisionSource: 'composition',
      widthIncrease: 0,
      inputCount: 0,
    };
  }

  // Compute max input width
  const maxInputWidth = Math.max(...intervals.map(intervalWidth));

  // Apply operation
  let result: Interval;
  switch (operation) {
    case 'sequence':
      result = sequenceIntervals(intervals);
      break;
    case 'parallel_and':
      result = parallelIntervalsAnd(intervals);
      break;
    case 'parallel_or':
      result = parallelIntervalsOr(intervals);
      break;
  }

  const outputWidth = intervalWidth(result);
  const widthIncrease = outputWidth - maxInputWidth;

  // Determine imprecision source
  let imprecisionSource: ImprecisionPropagationResult['imprecisionSource'];
  if (intervals.some(isIntervalVacuous)) {
    imprecisionSource = 'data_scarcity';
  } else if (widthIncrease > 0.1) {
    imprecisionSource = 'composition';
  } else {
    imprecisionSource = 'theoretical';
  }

  return {
    interval: result,
    imprecisionSource,
    widthIncrease,
    inputCount: intervals.length,
  };
}

// ============================================================================
// TYPE GUARDS
// ============================================================================

/**
 * Type guard for Interval.
 */
export function isInterval(value: unknown): value is Interval {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.lower === 'number' &&
    typeof candidate.upper === 'number' &&
    candidate.lower >= 0 &&
    candidate.upper <= 1 &&
    candidate.lower <= candidate.upper
  );
}

/**
 * Type guard for CredalSet.
 */
export function isCredalSet(value: unknown): value is CredalSet {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    Array.isArray(candidate.outcomes) &&
    candidate.lowerBounds instanceof Map &&
    candidate.upperBounds instanceof Map
  );
}
