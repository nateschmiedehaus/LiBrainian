/**
 * @fileoverview Calibration Laws - Algebraic Laws for Confidence Values
 *
 * Implements and verifies algebraic laws that confidence values must satisfy
 * to form a bounded semilattice. This formalization ensures that confidence
 * composition operations preserve mathematical properties.
 *
 * Key structures:
 * - Semilattice: (S, meet, join) where meet = min, join = max
 * - Monoid for product: (S, *, 1) for independent AND composition
 * - Bounded lattice: top = 1.0 (deterministic), bottom = absent
 *
 * References:
 * - Davey & Priestley, "Introduction to Lattices and Order"
 * - Fundamental Primitive Theory investigation
 *
 * @packageDocumentation
 */

import {
  type ConfidenceValue,
  type CalibrationStatus,
  type MeasuredConfidence,
  measuredConfidence,
  deterministic,
  absent,
  getNumericValue,
  andConfidence,
  orConfidence,
} from './confidence.js';

// ============================================================================
// SEMILATTICE LAW DEFINITIONS
// ============================================================================

/**
 * A semilattice law definition with description and verification function.
 */
export interface SemilatticeLaw {
  /** Name of the law */
  name: string;
  /** Mathematical description */
  description: string;
  /** LaTeX-style symbolic representation */
  symbol: string;
}

/**
 * The five fundamental semilattice laws.
 *
 * These laws ensure that confidence composition operations are well-behaved:
 * - Associativity: Order of grouping doesn't matter
 * - Commutativity: Order of operands doesn't matter
 * - Idempotence: Combining with self yields self
 * - Identity: Combining with identity element yields self
 * - Absorption: meet(a, join(a, b)) = a
 */
export const SEMILATTICE_LAWS = {
  associativity: {
    name: 'associativity',
    description: 'Grouping does not affect result: (a op b) op c = a op (b op c)',
    symbol: '(a ∧ b) ∧ c = a ∧ (b ∧ c)',
  } as SemilatticeLaw,

  commutativity: {
    name: 'commutativity',
    description: 'Order of operands does not affect result: a op b = b op a',
    symbol: 'a ∧ b = b ∧ a',
  } as SemilatticeLaw,

  idempotence: {
    name: 'idempotence',
    description: 'Combining with self yields self: a op a = a',
    symbol: 'a ∧ a = a',
  } as SemilatticeLaw,

  identity: {
    name: 'identity',
    description: 'Combining with identity yields self: a op e = a',
    symbol: 'a ∧ 1 = a (for meet), a ∨ 0 = a (for join)',
  } as SemilatticeLaw,

  absorption: {
    name: 'absorption',
    description: 'Meet absorbs join: meet(a, join(a, b)) = a',
    symbol: 'a ∧ (a ∨ b) = a',
  } as SemilatticeLaw,
};

// ============================================================================
// LAW CHECK RESULT
// ============================================================================

/**
 * Result of checking whether an operation satisfies an algebraic law.
 */
export interface LawCheckResult {
  /** Name of the law being checked */
  law: string;
  /** Whether the law is satisfied */
  satisfied: boolean;
  /** Counterexample if law fails (inputs that violate the law) */
  counterexample?: {
    inputs: unknown[];
    expected: unknown;
    actual: unknown;
  };
}

// ============================================================================
// LAW VERIFICATION FUNCTIONS
// ============================================================================

/**
 * Check if an operation satisfies associativity: (a op b) op c = a op (b op c)
 *
 * @param op - Binary operation to check
 * @param values - Sample values to test
 * @param eq - Equality function for comparing results
 * @returns LawCheckResult indicating whether law holds
 */
export function checkAssociativity<T>(
  op: (a: T, b: T) => T,
  values: T[],
  eq: (a: T, b: T) => boolean
): LawCheckResult {
  // Need at least 3 values to test associativity, but we can reuse values
  if (values.length < 3) {
    // Vacuously satisfied with fewer than 3 distinct values
    return { law: 'associativity', satisfied: true };
  }

  for (let i = 0; i < values.length; i++) {
    for (let j = 0; j < values.length; j++) {
      for (let k = 0; k < values.length; k++) {
        const a = values[i];
        const b = values[j];
        const c = values[k];

        const left = op(op(a, b), c);
        const right = op(a, op(b, c));

        if (!eq(left, right)) {
          return {
            law: 'associativity',
            satisfied: false,
            counterexample: {
              inputs: [a, b, c],
              expected: right,
              actual: left,
            },
          };
        }
      }
    }
  }

  return { law: 'associativity', satisfied: true };
}

/**
 * Check if an operation satisfies commutativity: a op b = b op a
 *
 * @param op - Binary operation to check
 * @param values - Sample values to test
 * @param eq - Equality function for comparing results
 * @returns LawCheckResult indicating whether law holds
 */
export function checkCommutativity<T>(
  op: (a: T, b: T) => T,
  values: T[],
  eq: (a: T, b: T) => boolean
): LawCheckResult {
  if (values.length < 2) {
    return { law: 'commutativity', satisfied: true };
  }

  for (let i = 0; i < values.length; i++) {
    for (let j = i + 1; j < values.length; j++) {
      const a = values[i];
      const b = values[j];

      const left = op(a, b);
      const right = op(b, a);

      if (!eq(left, right)) {
        return {
          law: 'commutativity',
          satisfied: false,
          counterexample: {
            inputs: [a, b],
            expected: right,
            actual: left,
          },
        };
      }
    }
  }

  return { law: 'commutativity', satisfied: true };
}

/**
 * Check if an operation satisfies idempotence: a op a = a
 *
 * @param op - Binary operation to check
 * @param values - Sample values to test
 * @param eq - Equality function for comparing results
 * @returns LawCheckResult indicating whether law holds
 */
export function checkIdempotence<T>(
  op: (a: T, b: T) => T,
  values: T[],
  eq: (a: T, b: T) => boolean
): LawCheckResult {
  for (const a of values) {
    const result = op(a, a);

    if (!eq(result, a)) {
      return {
        law: 'idempotence',
        satisfied: false,
        counterexample: {
          inputs: [a],
          expected: a,
          actual: result,
        },
      };
    }
  }

  return { law: 'idempotence', satisfied: true };
}

/**
 * Check if an operation satisfies identity: a op e = a
 *
 * @param op - Binary operation to check
 * @param values - Sample values to test
 * @param identity - The identity element
 * @param eq - Equality function for comparing results
 * @returns LawCheckResult indicating whether law holds
 */
export function checkIdentity<T>(
  op: (a: T, b: T) => T,
  values: T[],
  identity: T,
  eq: (a: T, b: T) => boolean
): LawCheckResult {
  for (const a of values) {
    const result = op(a, identity);

    if (!eq(result, a)) {
      return {
        law: 'identity',
        satisfied: false,
        counterexample: {
          inputs: [a, identity],
          expected: a,
          actual: result,
        },
      };
    }
  }

  return { law: 'identity', satisfied: true };
}

/**
 * Check if operations satisfy absorption: meet(a, join(a, b)) = a
 *
 * @param meet - Meet operation (typically min)
 * @param join - Join operation (typically max)
 * @param values - Sample values to test
 * @param eq - Equality function for comparing results
 * @returns LawCheckResult indicating whether law holds
 */
export function checkAbsorption<T>(
  meet: (a: T, b: T) => T,
  join: (a: T, b: T) => T,
  values: T[],
  eq: (a: T, b: T) => boolean
): LawCheckResult {
  if (values.length < 2) {
    return { law: 'absorption', satisfied: true };
  }

  for (let i = 0; i < values.length; i++) {
    for (let j = 0; j < values.length; j++) {
      const a = values[i];
      const b = values[j];

      // Check: meet(a, join(a, b)) = a
      const result = meet(a, join(a, b));

      if (!eq(result, a)) {
        return {
          law: 'absorption',
          satisfied: false,
          counterexample: {
            inputs: [a, b],
            expected: a,
            actual: result,
          },
        };
      }
    }
  }

  return { law: 'absorption', satisfied: true };
}

/**
 * Verify all semilattice laws for a pair of meet/join operations.
 *
 * @param meet - Meet operation
 * @param join - Join operation
 * @param values - Sample values to test
 * @param meetIdentity - Identity element for meet (typically 1/top)
 * @param joinIdentity - Identity element for join (typically 0/bottom)
 * @param eq - Equality function
 * @returns Object with results for each law
 */
export function verifyAllLaws<T>(
  meet: (a: T, b: T) => T,
  join: (a: T, b: T) => T,
  values: T[],
  meetIdentity: T,
  joinIdentity: T,
  eq: (a: T, b: T) => boolean
): {
  associativity: LawCheckResult;
  commutativity: LawCheckResult;
  idempotence: LawCheckResult;
  identity: LawCheckResult;
  absorption: LawCheckResult;
} {
  return {
    associativity: checkAssociativity(meet, values, eq),
    commutativity: checkCommutativity(meet, values, eq),
    idempotence: checkIdempotence(meet, values, eq),
    identity: checkIdentity(meet, values, meetIdentity, eq),
    absorption: checkAbsorption(meet, join, values, eq),
  };
}

// ============================================================================
// CALIBRATION RULES
// ============================================================================

/**
 * A rule for how calibration status propagates through composition.
 */
export interface CalibrationRule {
  /** Name of the rule */
  name: string;
  /** Human-readable description */
  description: string;
  /** The operation this rule applies to */
  operation: string;
  /** Apply the rule to input calibration statuses */
  apply: (inputs: CalibrationStatus[]) => CalibrationStatus;
}

/**
 * Rules for how calibration propagates through different operations.
 *
 * General principle: Calibration is only preserved if ALL inputs are preserved.
 * Any degraded or unknown input causes the output to be degraded.
 */
export const CALIBRATION_RULES: CalibrationRule[] = [
  {
    name: 'preserved_through_min',
    description: 'min of preserved values is preserved',
    operation: 'min',
    apply: (inputs: CalibrationStatus[]): CalibrationStatus => {
      if (inputs.length === 0) return 'unknown';
      if (inputs.every(s => s === 'preserved')) return 'preserved';
      return 'degraded';
    },
  },
  {
    name: 'preserved_through_max',
    description: 'max of preserved values is preserved',
    operation: 'max',
    apply: (inputs: CalibrationStatus[]): CalibrationStatus => {
      if (inputs.length === 0) return 'unknown';
      if (inputs.every(s => s === 'preserved')) return 'preserved';
      return 'degraded';
    },
  },
  {
    name: 'preserved_through_product',
    description: 'product of preserved values is preserved (assuming independence)',
    operation: 'product',
    apply: (inputs: CalibrationStatus[]): CalibrationStatus => {
      if (inputs.length === 0) return 'unknown';
      if (inputs.every(s => s === 'preserved')) return 'preserved';
      return 'degraded';
    },
  },
  {
    name: 'preserved_through_noisy_or',
    description: 'noisy-or of preserved values is preserved (assuming independence)',
    operation: 'noisy_or',
    apply: (inputs: CalibrationStatus[]): CalibrationStatus => {
      if (inputs.length === 0) return 'unknown';
      if (inputs.every(s => s === 'preserved')) return 'preserved';
      return 'degraded';
    },
  },
];

/**
 * Apply the appropriate calibration rule for an operation.
 *
 * @param operation - The operation name (min, max, product, noisy_or)
 * @param inputs - Calibration statuses of inputs
 * @returns Resulting calibration status
 */
export function applyCalibrationRule(
  operation: string,
  inputs: CalibrationStatus[]
): CalibrationStatus {
  const rule = CALIBRATION_RULES.find(r => r.operation === operation);
  if (!rule) {
    return 'unknown';
  }
  return rule.apply(inputs);
}

// ============================================================================
// CALIBRATION TRACKER
// ============================================================================

/**
 * A single step in the calibration trace.
 */
export interface CalibrationTrace {
  /** Operation applied */
  operation: string;
  /** Input calibration statuses */
  inputs: CalibrationStatus[];
  /** Output calibration status */
  output: CalibrationStatus;
  /** Timestamp */
  timestamp: number;
}

/**
 * Tracks calibration status through a series of compositions.
 *
 * This class provides a way to trace how calibration propagates through
 * a computation, making it easier to identify where degradation occurs.
 */
export class CalibrationTracker {
  private status: CalibrationStatus;
  private trace: CalibrationTrace[] = [];

  /**
   * Create a new calibration tracker.
   *
   * @param initialStatus - Starting calibration status
   */
  constructor(initialStatus: CalibrationStatus) {
    this.status = initialStatus;
  }

  /**
   * Apply an operation and track its effect on calibration.
   *
   * @param operation - Name of the operation
   * @param inputs - Calibration statuses of inputs
   * @returns Resulting calibration status
   */
  applyOperation(operation: string, inputs: CalibrationStatus[]): CalibrationStatus {
    const output = applyCalibrationRule(operation, inputs);

    this.trace.push({
      operation,
      inputs: [...inputs],
      output,
      timestamp: Date.now(),
    });

    this.status = output;
    return output;
  }

  /**
   * Get current calibration status.
   */
  getStatus(): CalibrationStatus {
    return this.status;
  }

  /**
   * Get the full trace of operations.
   */
  getTrace(): CalibrationTrace[] {
    return [...this.trace];
  }

  /**
   * Reset the tracker with a new initial status.
   */
  reset(newStatus: CalibrationStatus): void {
    this.status = newStatus;
    this.trace = [];
  }
}

// ============================================================================
// SEMILATTICE STRUCTURE
// ============================================================================

/**
 * A bounded semilattice structure with meet and join operations.
 */
export interface Semilattice<T> {
  /** Meet operation (greatest lower bound / min) */
  meet: (a: T, b: T) => T;
  /** Join operation (least upper bound / max) */
  join: (a: T, b: T) => T;
  /** Top element (identity for meet) */
  top: T;
  /** Bottom element (identity for join) */
  bottom: T;
  /** Verify all semilattice laws */
  verifyLaws: (samples: T[]) => LawCheckResult[];
}

/**
 * The semilattice structure for ConfidenceValue.
 *
 * - meet = andConfidence (min semantics)
 * - join = orConfidence (max semantics)
 * - top = deterministic(1.0)
 * - bottom = absent
 */
export const ConfidenceSemilattice: Semilattice<ConfidenceValue> = {
  meet: andConfidence,
  join: orConfidence,
  top: deterministic(true, 'lattice_top'),
  bottom: absent('not_applicable'),

  verifyLaws(samples: ConfidenceValue[]): LawCheckResult[] {
    return [
      checkAssociativity(andConfidence, samples, confidenceEquals),
      checkCommutativity(andConfidence, samples, confidenceEquals),
      checkIdempotence(andConfidence, samples, confidenceEquals),
      checkIdentity(andConfidence, samples, this.top, confidenceEquals),
      checkAbsorption(andConfidence, orConfidence, samples, confidenceEquals),
    ];
  },
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/** Floating point tolerance for equality comparisons */
const EPSILON = 1e-9;

/**
 * Check if two ConfidenceValues are equal (by numeric value).
 *
 * @param a - First confidence value
 * @param b - Second confidence value
 * @returns True if values are numerically equal within tolerance
 */
export function confidenceEquals(a: ConfidenceValue, b: ConfidenceValue): boolean {
  const aVal = getNumericValue(a);
  const bVal = getNumericValue(b);

  // Both absent
  if (aVal === null && bVal === null) {
    return true;
  }

  // One absent, one not
  if (aVal === null || bVal === null) {
    return false;
  }

  // Compare with floating point tolerance
  return Math.abs(aVal - bVal) < EPSILON;
}

/**
 * Create a test ConfidenceValue from a numeric value.
 *
 * @param value - Numeric value in [0, 1]
 * @returns A MeasuredConfidence with the given value
 */
export function createTestConfidence(value: number): ConfidenceValue {
  // Clamp to [0, 1]
  const clamped = Math.max(0, Math.min(1, value));

  return measuredConfidence({
    datasetId: `test-${clamped}`,
    sampleSize: 100,
    accuracy: clamped,
    ci95: [Math.max(0, clamped - 0.05), Math.min(1, clamped + 0.05)],
  });
}
