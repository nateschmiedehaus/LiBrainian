/**
 * @fileoverview Tests for Calibration Laws (Algebraic Laws for Confidence Values)
 *
 * This test file validates the algebraic laws that confidence values must satisfy
 * to form a bounded semilattice. Tests are written FIRST following TDD principles.
 *
 * Algebraic Laws:
 * - Semilattice laws: associativity, commutativity, idempotence, identity, absorption
 * - Monoid laws for product: associativity, identity
 * - Calibration preservation rules through composition
 *
 * @packageDocumentation
 */

import { describe, it, expect } from 'vitest';
import {
  type ConfidenceValue,
  type CalibrationStatus,
  measuredConfidence,
  deterministic,
  bounded,
  absent,
  getNumericValue,
  andConfidence,
  orConfidence,
  deriveSequentialConfidence,
  deriveParallelConfidence,
} from '../confidence.js';
// Import the module we're testing (will be created after tests)
import {
  // Semilattice laws
  type SemilatticeLaw,
  SEMILATTICE_LAWS,

  // Law check result
  type LawCheckResult,

  // Law verification functions
  checkAssociativity,
  checkCommutativity,
  checkIdempotence,
  checkIdentity,
  checkAbsorption,
  verifyAllLaws,

  // Calibration rules
  type CalibrationRule,
  CALIBRATION_RULES,
  applyCalibrationRule,

  // Calibration tracker
  type CalibrationTrace,
  CalibrationTracker,

  // Semilattice structure
  type Semilattice,
  ConfidenceSemilattice,

  // Helper functions
  confidenceEquals,
  createTestConfidence,
} from '../calibration_laws.js';

// ============================================================================
// HELPER FACTORIES FOR TESTS
// ============================================================================

function createMeasured(value: number): ConfidenceValue {
  return measuredConfidence({
    datasetId: `test-${value}`,
    sampleSize: 100,
    accuracy: value,
    ci95: [Math.max(0, value - 0.05), Math.min(1, value + 0.05)],
  });
}

function createDeterministic(success: boolean): ConfidenceValue {
  return deterministic(success, 'test');
}

// ============================================================================
// SEMILATTICE LAW DEFINITIONS
// ============================================================================

describe('Semilattice Laws - Definition', () => {
  it('should define all required semilattice laws', () => {
    expect(SEMILATTICE_LAWS).toBeDefined();
    expect(SEMILATTICE_LAWS.associativity).toBeDefined();
    expect(SEMILATTICE_LAWS.commutativity).toBeDefined();
    expect(SEMILATTICE_LAWS.idempotence).toBeDefined();
    expect(SEMILATTICE_LAWS.identity).toBeDefined();
    expect(SEMILATTICE_LAWS.absorption).toBeDefined();
  });

  it('should have proper law descriptions', () => {
    expect(typeof SEMILATTICE_LAWS.associativity.description).toBe('string');
    expect(typeof SEMILATTICE_LAWS.commutativity.description).toBe('string');
    expect(typeof SEMILATTICE_LAWS.idempotence.description).toBe('string');
    expect(typeof SEMILATTICE_LAWS.identity.description).toBe('string');
    expect(typeof SEMILATTICE_LAWS.absorption.description).toBe('string');
  });
});

// ============================================================================
// LAW CHECK RESULT TYPE
// ============================================================================

describe('LawCheckResult type', () => {
  it('should return satisfied=true when law holds', () => {
    const result = checkAssociativity(
      (a, b) => Math.min(a, b),
      [0.5, 0.7, 0.3],
      (a, b) => a === b
    );
    expect(result.law).toBe('associativity');
    expect(result.satisfied).toBe(true);
    expect(result.counterexample).toBeUndefined();
  });

  it('should return counterexample when law fails', () => {
    // A deliberately non-associative operation
    const badOp = (a: number, b: number) => a - b;
    const result = checkAssociativity(
      badOp,
      [1, 2, 3],
      (a, b) => a === b
    );
    expect(result.satisfied).toBe(false);
    expect(result.counterexample).toBeDefined();
    expect(result.counterexample?.inputs).toHaveLength(3);
  });
});

// ============================================================================
// ASSOCIATIVITY LAW: (a ∧ b) ∧ c = a ∧ (b ∧ c)
// ============================================================================

describe('Associativity Law', () => {
  it('should hold for min operation on numeric values', () => {
    const values = [0.2, 0.5, 0.8, 0.3, 0.9];
    const result = checkAssociativity(
      (a, b) => Math.min(a, b),
      values,
      (a, b) => a === b
    );
    expect(result.satisfied).toBe(true);
  });

  it('should hold for max operation on numeric values', () => {
    const values = [0.2, 0.5, 0.8, 0.3, 0.9];
    const result = checkAssociativity(
      (a, b) => Math.max(a, b),
      values,
      (a, b) => a === b
    );
    expect(result.satisfied).toBe(true);
  });

  it('should hold for product operation on numeric values', () => {
    const values = [0.5, 0.6, 0.7, 0.8, 0.9];
    const result = checkAssociativity(
      (a, b) => a * b,
      values,
      (a, b) => Math.abs(a - b) < 1e-10 // floating point tolerance
    );
    expect(result.satisfied).toBe(true);
  });

  it('should hold for andConfidence on ConfidenceValue', () => {
    const values = [
      createMeasured(0.5),
      createMeasured(0.7),
      createMeasured(0.3),
    ];
    const result = checkAssociativity(
      andConfidence,
      values,
      confidenceEquals
    );
    expect(result.satisfied).toBe(true);
  });

  it('should hold for orConfidence on ConfidenceValue', () => {
    const values = [
      createMeasured(0.5),
      createMeasured(0.7),
      createMeasured(0.3),
    ];
    const result = checkAssociativity(
      orConfidence,
      values,
      confidenceEquals
    );
    expect(result.satisfied).toBe(true);
  });
});

// ============================================================================
// COMMUTATIVITY LAW: a ∧ b = b ∧ a
// ============================================================================

describe('Commutativity Law', () => {
  it('should hold for min operation', () => {
    const values = [0.2, 0.5, 0.8, 0.3, 0.9];
    const result = checkCommutativity(
      (a, b) => Math.min(a, b),
      values,
      (a, b) => a === b
    );
    expect(result.satisfied).toBe(true);
  });

  it('should hold for max operation', () => {
    const values = [0.2, 0.5, 0.8, 0.3, 0.9];
    const result = checkCommutativity(
      (a, b) => Math.max(a, b),
      values,
      (a, b) => a === b
    );
    expect(result.satisfied).toBe(true);
  });

  it('should hold for product operation', () => {
    const values = [0.5, 0.6, 0.7, 0.8, 0.9];
    const result = checkCommutativity(
      (a, b) => a * b,
      values,
      (a, b) => Math.abs(a - b) < 1e-10
    );
    expect(result.satisfied).toBe(true);
  });

  it('should hold for andConfidence', () => {
    const values = [
      createMeasured(0.5),
      createMeasured(0.7),
      createMeasured(0.3),
    ];
    const result = checkCommutativity(
      andConfidence,
      values,
      confidenceEquals
    );
    expect(result.satisfied).toBe(true);
  });

  it('should hold for orConfidence', () => {
    const values = [
      createMeasured(0.5),
      createMeasured(0.7),
      createMeasured(0.3),
    ];
    const result = checkCommutativity(
      orConfidence,
      values,
      confidenceEquals
    );
    expect(result.satisfied).toBe(true);
  });

  it('should fail for non-commutative operations', () => {
    const badOp = (a: number, b: number) => a - b;
    const result = checkCommutativity(
      badOp,
      [1, 2, 3],
      (a, b) => a === b
    );
    expect(result.satisfied).toBe(false);
  });
});

// ============================================================================
// IDEMPOTENCE LAW: a ∧ a = a
// ============================================================================

describe('Idempotence Law', () => {
  it('should hold for min operation', () => {
    const values = [0.0, 0.25, 0.5, 0.75, 1.0];
    const result = checkIdempotence(
      (a, b) => Math.min(a, b),
      values,
      (a, b) => a === b
    );
    expect(result.satisfied).toBe(true);
  });

  it('should hold for max operation', () => {
    const values = [0.0, 0.25, 0.5, 0.75, 1.0];
    const result = checkIdempotence(
      (a, b) => Math.max(a, b),
      values,
      (a, b) => a === b
    );
    expect(result.satisfied).toBe(true);
  });

  it('should NOT hold for product operation (except identity)', () => {
    const values = [0.5, 0.7, 0.9]; // product is not idempotent: 0.5 * 0.5 = 0.25 != 0.5
    const result = checkIdempotence(
      (a, b) => a * b,
      values,
      (a, b) => Math.abs(a - b) < 1e-10
    );
    expect(result.satisfied).toBe(false);
  });

  it('should hold for andConfidence (min-based)', () => {
    const values = [
      createMeasured(0.5),
      createMeasured(0.7),
      createMeasured(0.3),
    ];
    const result = checkIdempotence(
      andConfidence,
      values,
      confidenceEquals
    );
    expect(result.satisfied).toBe(true);
  });

  it('should hold for orConfidence (max-based)', () => {
    const values = [
      createMeasured(0.5),
      createMeasured(0.7),
      createMeasured(0.3),
    ];
    const result = checkIdempotence(
      orConfidence,
      values,
      confidenceEquals
    );
    expect(result.satisfied).toBe(true);
  });
});

// ============================================================================
// IDENTITY LAW: a ∧ 1 = a (for meet), a ∨ 0 = a (for join)
// ============================================================================

describe('Identity Law', () => {
  it('should hold for min with identity 1', () => {
    const values = [0.0, 0.25, 0.5, 0.75, 1.0];
    const result = checkIdentity(
      (a, b) => Math.min(a, b),
      values,
      1, // identity for min
      (a, b) => a === b
    );
    expect(result.satisfied).toBe(true);
  });

  it('should hold for max with identity 0', () => {
    const values = [0.0, 0.25, 0.5, 0.75, 1.0];
    const result = checkIdentity(
      (a, b) => Math.max(a, b),
      values,
      0, // identity for max
      (a, b) => a === b
    );
    expect(result.satisfied).toBe(true);
  });

  it('should hold for product with identity 1', () => {
    const values = [0.0, 0.25, 0.5, 0.75, 1.0];
    const result = checkIdentity(
      (a, b) => a * b,
      values,
      1, // identity for product
      (a, b) => Math.abs(a - b) < 1e-10
    );
    expect(result.satisfied).toBe(true);
  });

  it('should hold for andConfidence with deterministic(true)', () => {
    const identity = createDeterministic(true);
    const values = [
      createMeasured(0.5),
      createMeasured(0.7),
      createMeasured(0.3),
    ];
    const result = checkIdentity(
      andConfidence,
      values,
      identity,
      confidenceEquals
    );
    expect(result.satisfied).toBe(true);
  });

  it('should hold for orConfidence with deterministic(false)', () => {
    const identity = createDeterministic(false);
    const values = [
      createMeasured(0.5),
      createMeasured(0.7),
      createMeasured(0.3),
    ];
    const result = checkIdentity(
      orConfidence,
      values,
      identity,
      confidenceEquals
    );
    expect(result.satisfied).toBe(true);
  });
});

// ============================================================================
// ABSORPTION LAW: a ∧ (a ∨ b) = a
// ============================================================================

describe('Absorption Law', () => {
  it('should hold for min/max (meet/join)', () => {
    const values = [0.2, 0.4, 0.6, 0.8];
    const result = checkAbsorption(
      (a, b) => Math.min(a, b), // meet
      (a, b) => Math.max(a, b), // join
      values,
      (a, b) => a === b
    );
    expect(result.satisfied).toBe(true);
  });

  it('should hold for and/or on ConfidenceValue', () => {
    const values = [
      createMeasured(0.3),
      createMeasured(0.5),
      createMeasured(0.7),
      createMeasured(0.9),
    ];
    const result = checkAbsorption(
      andConfidence,
      orConfidence,
      values,
      confidenceEquals
    );
    expect(result.satisfied).toBe(true);
  });

  it('should verify dual absorption: a ∨ (a ∧ b) = a', () => {
    const values = [0.2, 0.4, 0.6, 0.8];
    // Dual: join(a, meet(a, b)) = a
    const result = checkAbsorption(
      (a, b) => Math.max(a, b), // join as first arg
      (a, b) => Math.min(a, b), // meet as second arg
      values,
      (a, b) => a === b
    );
    expect(result.satisfied).toBe(true);
  });
});

// ============================================================================
// CALIBRATION RULES
// ============================================================================

describe('Calibration Rules', () => {
  it('should define calibration preservation rules', () => {
    expect(CALIBRATION_RULES).toBeDefined();
    expect(Array.isArray(CALIBRATION_RULES)).toBe(true);
    expect(CALIBRATION_RULES.length).toBeGreaterThan(0);
  });

  it('should have rule for min preserving calibration', () => {
    const rule = CALIBRATION_RULES.find(r => r.name === 'preserved_through_min');
    expect(rule).toBeDefined();
    expect(rule!.apply(['preserved', 'preserved'])).toBe('preserved');
  });

  it('should degrade when any input is degraded (min)', () => {
    const rule = CALIBRATION_RULES.find(r => r.name === 'preserved_through_min');
    expect(rule).toBeDefined();
    expect(rule!.apply(['preserved', 'degraded'])).toBe('degraded');
  });

  it('should have rule for max preserving calibration', () => {
    const rule = CALIBRATION_RULES.find(r => r.name === 'preserved_through_max');
    expect(rule).toBeDefined();
    expect(rule!.apply(['preserved', 'preserved'])).toBe('preserved');
  });

  it('should have rule for product preserving calibration', () => {
    const rule = CALIBRATION_RULES.find(r => r.name === 'preserved_through_product');
    expect(rule).toBeDefined();
    expect(rule!.apply(['preserved', 'preserved'])).toBe('preserved');
  });

  it('should handle unknown status conservatively', () => {
    const rule = CALIBRATION_RULES.find(r => r.name === 'preserved_through_min');
    expect(rule).toBeDefined();
    expect(rule!.apply(['preserved', 'unknown'])).toBe('degraded');
  });

  it('should apply calibration rule to operation', () => {
    const result = applyCalibrationRule('min', ['preserved', 'preserved']);
    expect(result).toBe('preserved');
  });

  it('should apply calibration rule for unknown operation', () => {
    const result = applyCalibrationRule('unknown_op', ['preserved', 'preserved']);
    expect(result).toBe('unknown');
  });
});

// ============================================================================
// CALIBRATION TRACKER
// ============================================================================

describe('CalibrationTracker', () => {
  it('should initialize with given status', () => {
    const tracker = new CalibrationTracker('preserved');
    expect(tracker.getStatus()).toBe('preserved');
  });

  it('should track operation application', () => {
    const tracker = new CalibrationTracker('preserved');
    const result = tracker.applyOperation('min', ['preserved', 'preserved']);
    expect(result).toBe('preserved');
    expect(tracker.getStatus()).toBe('preserved');
  });

  it('should degrade status through operations', () => {
    const tracker = new CalibrationTracker('preserved');
    tracker.applyOperation('min', ['preserved', 'degraded']);
    expect(tracker.getStatus()).toBe('degraded');
  });

  it('should maintain trace of operations', () => {
    const tracker = new CalibrationTracker('preserved');
    tracker.applyOperation('min', ['preserved', 'preserved']);
    tracker.applyOperation('product', ['preserved', 'degraded']);

    const trace = tracker.getTrace();
    expect(trace).toHaveLength(2);
    expect(trace[0].operation).toBe('min');
    expect(trace[0].inputs).toEqual(['preserved', 'preserved']);
    expect(trace[0].output).toBe('preserved');
    expect(trace[1].operation).toBe('product');
    expect(trace[1].output).toBe('degraded');
  });

  it('should reset status and trace', () => {
    const tracker = new CalibrationTracker('preserved');
    tracker.applyOperation('min', ['preserved', 'degraded']);
    tracker.reset('preserved');

    expect(tracker.getStatus()).toBe('preserved');
    expect(tracker.getTrace()).toHaveLength(0);
  });

  it('should handle chain of operations', () => {
    const tracker = new CalibrationTracker('preserved');

    // Chain: min -> product -> max
    tracker.applyOperation('min', ['preserved', 'preserved']);
    tracker.applyOperation('product', ['preserved', 'preserved']);
    tracker.applyOperation('max', ['preserved', 'preserved']);

    expect(tracker.getStatus()).toBe('preserved');
    expect(tracker.getTrace()).toHaveLength(3);
  });
});

// ============================================================================
// CONFIDENCE SEMILATTICE STRUCTURE
// ============================================================================

describe('ConfidenceSemilattice', () => {
  it('should define meet operation (min)', () => {
    expect(ConfidenceSemilattice.meet).toBeDefined();

    const a = createMeasured(0.8);
    const b = createMeasured(0.5);
    const result = ConfidenceSemilattice.meet(a, b);

    expect(getNumericValue(result)).toBe(0.5);
  });

  it('should define join operation (max)', () => {
    expect(ConfidenceSemilattice.join).toBeDefined();

    const a = createMeasured(0.3);
    const b = createMeasured(0.7);
    const result = ConfidenceSemilattice.join(a, b);

    expect(getNumericValue(result)).toBe(0.7);
  });

  it('should define top element (deterministic 1.0)', () => {
    expect(ConfidenceSemilattice.top).toBeDefined();
    expect(getNumericValue(ConfidenceSemilattice.top)).toBe(1.0);
  });

  it('should define bottom element (absent)', () => {
    expect(ConfidenceSemilattice.bottom).toBeDefined();
    expect(ConfidenceSemilattice.bottom.type).toBe('absent');
  });

  it('should verify meet identity: a ∧ top = a', () => {
    const a = createMeasured(0.6);
    const result = ConfidenceSemilattice.meet(a, ConfidenceSemilattice.top);
    expect(getNumericValue(result)).toBe(0.6);
  });

  it('should verify join identity: a ∨ bottom = a', () => {
    const a = createMeasured(0.6);
    const result = ConfidenceSemilattice.join(a, ConfidenceSemilattice.bottom);
    // When one is absent, orConfidence returns the non-absent one
    expect(getNumericValue(result)).toBe(0.6);
  });

  it('should verify all semilattice laws', () => {
    const samples = [
      createMeasured(0.2),
      createMeasured(0.5),
      createMeasured(0.8),
      createMeasured(0.3),
      createMeasured(0.7),
    ];

    const results = ConfidenceSemilattice.verifyLaws(samples);

    expect(results).toHaveLength(5); // 5 laws
    results.forEach(result => {
      expect(result.satisfied).toBe(true);
    });
  });
});

// ============================================================================
// VERIFY ALL LAWS COMBINED
// ============================================================================

describe('verifyAllLaws', () => {
  it('should verify all laws for min operation on numbers', () => {
    const values = [0.1, 0.3, 0.5, 0.7, 0.9];
    const results = verifyAllLaws(
      (a, b) => Math.min(a, b),
      (a, b) => Math.max(a, b),
      values,
      1, // identity for meet
      0, // identity for join
      (a, b) => a === b
    );

    expect(results.associativity.satisfied).toBe(true);
    expect(results.commutativity.satisfied).toBe(true);
    expect(results.idempotence.satisfied).toBe(true);
    expect(results.identity.satisfied).toBe(true);
    expect(results.absorption.satisfied).toBe(true);
  });

  it('should detect law violations', () => {
    const values = [1, 2, 3, 4, 5];
    // Subtraction is not associative, commutative, or idempotent
    const results = verifyAllLaws(
      (a, b) => a - b,
      (a, b) => a + b, // Using addition as "join" (though not a true lattice)
      values,
      0, // 0 would be identity for addition
      0, // Subtraction doesn't have a real identity
      (a, b) => a === b
    );

    expect(results.associativity.satisfied).toBe(false);
    expect(results.commutativity.satisfied).toBe(false);
    expect(results.idempotence.satisfied).toBe(false);
  });
});

// ============================================================================
// CONFIDENCE EQUALITY
// ============================================================================

describe('confidenceEquals', () => {
  it('should compare deterministic values correctly', () => {
    const a = createDeterministic(true);
    const b = createDeterministic(true);
    const c = createDeterministic(false);

    expect(confidenceEquals(a, b)).toBe(true);
    expect(confidenceEquals(a, c)).toBe(false);
  });

  it('should compare measured values by numeric value', () => {
    const a = createMeasured(0.75);
    const b = createMeasured(0.75);
    const c = createMeasured(0.5);

    expect(confidenceEquals(a, b)).toBe(true);
    expect(confidenceEquals(a, c)).toBe(false);
  });

  it('should handle floating point tolerance', () => {
    const a = createMeasured(0.333333333);
    const b = createMeasured(0.333333334);

    expect(confidenceEquals(a, b)).toBe(true);
  });

  it('should compare absent values correctly', () => {
    const a = absent('uncalibrated');
    const b = absent('insufficient_data');

    // Both are absent, so numerically equal (both null)
    expect(confidenceEquals(a, b)).toBe(true);
  });

  it('should compare derived values by computed value', () => {
    const input1 = createMeasured(0.8);
    const input2 = createMeasured(0.6);

    const derived1 = andConfidence(input1, input2);
    const derived2 = andConfidence(input1, input2);

    expect(confidenceEquals(derived1, derived2)).toBe(true);
  });
});

// ============================================================================
// CREATETESTCONFIDENCE HELPER
// ============================================================================

describe('createTestConfidence', () => {
  it('should create measured confidence for numeric input', () => {
    const conf = createTestConfidence(0.75);
    expect(conf.type).toBe('measured');
    expect(getNumericValue(conf)).toBe(0.75);
  });

  it('should create deterministic confidence for 0 and 1', () => {
    const zero = createTestConfidence(0);
    const one = createTestConfidence(1);

    expect(getNumericValue(zero)).toBe(0);
    expect(getNumericValue(one)).toBe(1);
  });

  it('should clamp values to [0, 1] range', () => {
    const negative = createTestConfidence(-0.5);
    const overOne = createTestConfidence(1.5);

    expect(getNumericValue(negative)).toBe(0);
    expect(getNumericValue(overOne)).toBe(1);
  });
});

// ============================================================================
// MONOID PROPERTIES FOR PRODUCT
// ============================================================================

describe('Monoid Properties for Product', () => {
  it('should satisfy associativity for product', () => {
    const values = [0.5, 0.7, 0.9];
    const result = checkAssociativity(
      (a, b) => a * b,
      values,
      (a, b) => Math.abs(a - b) < 1e-10
    );
    expect(result.satisfied).toBe(true);
  });

  it('should satisfy identity for product (1 is identity)', () => {
    const values = [0.3, 0.5, 0.7, 0.9];
    const result = checkIdentity(
      (a, b) => a * b,
      values,
      1,
      (a, b) => Math.abs(a - b) < 1e-10
    );
    expect(result.satisfied).toBe(true);
  });

  it('should satisfy zero property (0 * a = 0)', () => {
    const values = [0.3, 0.5, 0.7, 0.9];
    for (const v of values) {
      expect(0 * v).toBe(0);
      expect(v * 0).toBe(0);
    }
  });
});

// ============================================================================
// BOUNDED LATTICE PROPERTIES
// ============================================================================

describe('Bounded Lattice Properties', () => {
  it('should have top as identity for meet', () => {
    const values = [0.2, 0.5, 0.8];
    for (const v of values) {
      expect(Math.min(v, 1)).toBe(v);
    }
  });

  it('should have bottom as identity for join', () => {
    const values = [0.2, 0.5, 0.8];
    for (const v of values) {
      expect(Math.max(v, 0)).toBe(v);
    }
  });

  it('should satisfy annihilator property for meet (a ∧ 0 = 0)', () => {
    const values = [0.2, 0.5, 0.8, 1.0];
    for (const v of values) {
      expect(Math.min(v, 0)).toBe(0);
    }
  });

  it('should satisfy annihilator property for join (a ∨ 1 = 1)', () => {
    const values = [0.0, 0.2, 0.5, 0.8];
    for (const v of values) {
      expect(Math.max(v, 1)).toBe(1);
    }
  });
});

// ============================================================================
// DISTRIBUTIVE LATTICE PROPERTIES (OPTIONAL BUT USEFUL)
// ============================================================================

describe('Distributive Lattice Properties', () => {
  it('should satisfy distributivity: a ∧ (b ∨ c) = (a ∧ b) ∨ (a ∧ c)', () => {
    const testCases = [
      [0.2, 0.5, 0.8],
      [0.3, 0.6, 0.9],
      [0.1, 0.4, 0.7],
    ];

    for (const [a, b, c] of testCases) {
      const left = Math.min(a, Math.max(b, c));
      const right = Math.max(Math.min(a, b), Math.min(a, c));
      expect(left).toBeCloseTo(right);
    }
  });

  it('should satisfy dual distributivity: a ∨ (b ∧ c) = (a ∨ b) ∧ (a ∨ c)', () => {
    const testCases = [
      [0.2, 0.5, 0.8],
      [0.3, 0.6, 0.9],
      [0.1, 0.4, 0.7],
    ];

    for (const [a, b, c] of testCases) {
      const left = Math.max(a, Math.min(b, c));
      const right = Math.min(Math.max(a, b), Math.max(a, c));
      expect(left).toBeCloseTo(right);
    }
  });
});

// ============================================================================
// CALIBRATION STATUS INTEGRATION
// ============================================================================

describe('Calibration Status Integration', () => {
  it('should preserve calibration through deriveSequentialConfidence', () => {
    const inputs = [
      createMeasured(0.8),
      createMeasured(0.6),
    ];

    const result = deriveSequentialConfidence(inputs);

    if (result.type === 'derived') {
      expect(result.calibrationStatus).toBe('preserved');
    }
  });

  it('should preserve calibration through deriveParallelConfidence', () => {
    const inputs = [
      createMeasured(0.8),
      createMeasured(0.6),
    ];

    const result = deriveParallelConfidence(inputs);

    if (result.type === 'derived') {
      expect(result.calibrationStatus).toBe('preserved');
    }
  });

  it('should degrade calibration when bounded value is included', () => {
    const inputs: ConfidenceValue[] = [
      createMeasured(0.8),
      bounded(0.5, 0.7, 'literature', 'test citation'),
    ];

    const result = deriveSequentialConfidence(inputs);

    if (result.type === 'derived') {
      expect(result.calibrationStatus).toBe('degraded');
    }
  });
});

// ============================================================================
// EDGE CASES
// ============================================================================

describe('Edge Cases', () => {
  it('should handle empty value array gracefully', () => {
    const result = checkAssociativity(
      (a, b) => Math.min(a, b),
      [],
      (a, b) => a === b
    );
    // With no values, law is vacuously satisfied
    expect(result.satisfied).toBe(true);
  });

  it('should handle single value array', () => {
    const result = checkAssociativity(
      (a, b) => Math.min(a, b),
      [0.5],
      (a, b) => a === b
    );
    // With one value, law is vacuously satisfied
    expect(result.satisfied).toBe(true);
  });

  it('should handle two values array', () => {
    const result = checkAssociativity(
      (a, b) => Math.min(a, b),
      [0.5, 0.7],
      (a, b) => a === b
    );
    // With two values, we can test associativity using the same values
    expect(result.satisfied).toBe(true);
  });

  it('should handle NaN gracefully in equality check', () => {
    const badOp = () => NaN;
    const result = checkCommutativity(
      badOp,
      [0.5, 0.7],
      (a, b) => Number.isNaN(a) && Number.isNaN(b) || a === b
    );
    // Both return NaN, so they're "equal" under our tolerance
    expect(result.satisfied).toBe(true);
  });
});
