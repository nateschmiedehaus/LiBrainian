/**
 * @fileoverview Principled Confidence Type System
 *
 * Implements the ConfidenceValue type from track-d-quantification.md.
 *
 * CORE PRINCIPLE: No arbitrary numbers. Every confidence value MUST have provenance.
 *
 * The old `placeholder(0.7, 'id')` approach was documentation theater - a labeled
 * guess is still a guess. This principled approach forces either honest uncertainty
 * (`absent`) or real provenance (`measured`, `derived`, `deterministic`, `bounded`).
 *
 * @packageDocumentation
 */

import type { CalibrationAdjustmentOptions, CalibrationReport } from './calibration.js';
import { adjustConfidenceScore } from './calibration.js';
import type { ProvenFormulaNode } from './formula_ast.js';
import {
  migrateStringFormula,
  provenFormulaToString,
} from './formula_ast.js';

// ============================================================================
// TYPED FORMULA AST (WU-THIMPL-201)
// ============================================================================

/**
 * A node in the typed formula AST.
 *
 * This replaces string-based formula representations with a structured AST that:
 * - Enables type-safe formula manipulation
 * - Allows programmatic evaluation
 * - Supports serialization and comparison
 * - Prevents formula injection or malformed expressions
 *
 * @example
 * ```typescript
 * // min(a, b) * 0.9
 * const formula: FormulaNode = {
 *   type: 'scale',
 *   factor: 0.9,
 *   child: {
 *     type: 'min',
 *     children: [
 *       { type: 'value', name: 'a' },
 *       { type: 'value', name: 'b' }
 *     ]
 *   }
 * };
 * ```
 */
export type FormulaNode =
  | FormulaValueNode
  | FormulaMinNode
  | FormulaMaxNode
  | FormulaProductNode
  | FormulaSumNode
  | FormulaScaleNode;

/** A leaf node representing a named value */
export interface FormulaValueNode {
  readonly type: 'value';
  readonly name: string;
}

/** Minimum of child values */
export interface FormulaMinNode {
  readonly type: 'min';
  readonly children: readonly FormulaNode[];
}

/** Maximum of child values */
export interface FormulaMaxNode {
  readonly type: 'max';
  readonly children: readonly FormulaNode[];
}

/** Product of child values */
export interface FormulaProductNode {
  readonly type: 'product';
  readonly children: readonly FormulaNode[];
}

/** Sum of child values */
export interface FormulaSumNode {
  readonly type: 'sum';
  readonly children: readonly FormulaNode[];
}

/** Scale a child value by a constant factor */
export interface FormulaScaleNode {
  readonly type: 'scale';
  readonly factor: number;
  readonly child: FormulaNode;
}

/**
 * Convert a FormulaNode AST to a human-readable string representation.
 *
 * @param node - The formula AST node
 * @returns Human-readable formula string (e.g., "min(step_0, step_1)")
 *
 * @example
 * ```typescript
 * const formula: FormulaNode = {
 *   type: 'min',
 *   children: [
 *     { type: 'value', name: 'a' },
 *     { type: 'value', name: 'b' }
 *   ]
 * };
 * formulaToString(formula); // "min(a, b)"
 * ```
 */
export function formulaToString(node: FormulaNode): string {
  switch (node.type) {
    case 'value':
      return node.name;
    case 'min':
      return `min(${node.children.map(formulaToString).join(', ')})`;
    case 'max':
      return `max(${node.children.map(formulaToString).join(', ')})`;
    case 'product':
      if (node.children.length === 0) return '1';
      if (node.children.length === 1) return formulaToString(node.children[0]);
      return node.children.map(formulaToString).join(' * ');
    case 'sum':
      if (node.children.length === 0) return '0';
      if (node.children.length === 1) return formulaToString(node.children[0]);
      return `(${node.children.map(formulaToString).join(' + ')})`;
    case 'scale':
      return `${node.factor} * ${formulaToString(node.child)}`;
  }
}

/**
 * Evaluate a FormulaNode AST with the given values.
 *
 * @param node - The formula AST node
 * @param values - Map of variable names to their numeric values
 * @returns The computed numeric result
 * @throws Error if a required value is missing from the values map
 *
 * @example
 * ```typescript
 * const formula: FormulaNode = {
 *   type: 'min',
 *   children: [
 *     { type: 'value', name: 'a' },
 *     { type: 'value', name: 'b' }
 *   ]
 * };
 * const result = evaluateFormula(formula, new Map([['a', 0.8], ['b', 0.9]]));
 * // result = 0.8
 * ```
 */
export function evaluateFormula(node: FormulaNode, values: Map<string, number>): number {
  switch (node.type) {
    case 'value': {
      const value = values.get(node.name);
      if (value === undefined) {
        throw new Error(`Missing value for formula variable: ${node.name}`);
      }
      return value;
    }
    case 'min': {
      if (node.children.length === 0) {
        return Infinity; // Identity for min
      }
      return Math.min(...node.children.map((child) => evaluateFormula(child, values)));
    }
    case 'max': {
      if (node.children.length === 0) {
        return -Infinity; // Identity for max
      }
      return Math.max(...node.children.map((child) => evaluateFormula(child, values)));
    }
    case 'product': {
      return node.children.reduce((acc, child) => acc * evaluateFormula(child, values), 1);
    }
    case 'sum': {
      return node.children.reduce((acc, child) => acc + evaluateFormula(child, values), 0);
    }
    case 'scale': {
      return node.factor * evaluateFormula(node.child, values);
    }
  }
}

/**
 * Create a FormulaNode from a list of input names using the specified operation.
 *
 * @param operation - The operation type ('min', 'max', 'product', 'sum')
 * @param inputNames - Names of the input values
 * @returns A FormulaNode representing the operation
 */
export function createFormula(
  operation: 'min' | 'max' | 'product' | 'sum',
  inputNames: string[]
): FormulaNode {
  const children: FormulaValueNode[] = inputNames.map((name) => ({ type: 'value', name }));
  return { type: operation, children } as FormulaNode;
}

/**
 * Type guard to check if a value is a FormulaNode.
 */
export function isFormulaNode(value: unknown): value is FormulaNode {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { type?: unknown };
  return (
    candidate.type === 'value' ||
    candidate.type === 'min' ||
    candidate.type === 'max' ||
    candidate.type === 'product' ||
    candidate.type === 'sum' ||
    candidate.type === 'scale'
  );
}

// ============================================================================
// CONFIDENCE VALUE TYPES
// ============================================================================

/**
 * A confidence value with MANDATORY provenance.
 * Raw numbers are NOT allowed - every value must explain its origin.
 *
 * This replaces the old `QuantifiedValue` and eliminates the "placeholder" escape hatch.
 */
export type ConfidenceValue =
  | DeterministicConfidence
  | DerivedConfidence
  | MeasuredConfidence
  | BoundedConfidence
  | AbsentConfidence;

/**
 * Logically certain: 1.0 (definitely true) or 0.0 (definitely false)
 *
 * Use for: syntactic operations, parse success/failure, exact matches
 *
 * RULE: If an operation is deterministic, its confidence MUST be 1.0 or 0.0.
 * There is no uncertainty in whether a parse succeeded.
 */
export interface DeterministicConfidence {
  readonly type: 'deterministic';
  readonly value: 1.0 | 0.0;
  readonly reason: string; // "ast_parse_succeeded" / "exact_string_match"
}

/**
 * Computed from other confidence values via explicit formula.
 *
 * Use for: composed operations, pipelines, aggregations
 *
 * RULE: The formula must be mathematically valid and all inputs must be
 * ConfidenceValue (not raw numbers).
 */
export interface DerivedConfidence {
  readonly type: 'derived';
  readonly value: number; // 0.0 to 1.0, computed from formula
  readonly formula: string; // e.g., "min(step1, step2)" or "step1 * step2"
  readonly inputs: ReadonlyArray<{ name: string; confidence: ConfidenceValue }>;
  /**
   * Tracks whether derivation preserves input calibration properties.
   * - 'preserved': All inputs are calibrated and formula preserves calibration
   * - 'degraded': Some inputs are uncalibrated or formula may degrade calibration
   * - 'unknown': Calibration status cannot be determined
   */
  readonly calibrationStatus?: 'preserved' | 'degraded' | 'unknown';
  /**
   * Optional typed formula AST (WU-THIMPL-201).
   *
   * When present, provides a structured representation of the formula
   * that can be programmatically evaluated and manipulated.
   * The `formula` string field remains for human readability.
   */
  readonly formulaAst?: FormulaNode;
  /**
   * Optional proven formula AST (WU-THEORY-001).
   *
   * When present, provides a type-safe AST with proof terms that guarantee
   * the formula is valid by construction. This is the preferred way to
   * represent formulas going forward.
   *
   * The `formula` string field remains for backwards compatibility and
   * human readability.
   */
  readonly provenFormula?: ProvenFormulaNode;
}

/**
 * Empirically measured from historical outcomes.
 *
 * Use for: LLM operations after calibration, any operation with outcome data
 *
 * RULE: Must have actual measurement data. If you don't have data, use Absent.
 */
export interface MeasuredConfidence {
  readonly type: 'measured';
  readonly value: number;
  readonly measurement: {
    readonly datasetId: string;
    readonly sampleSize: number;
    readonly accuracy: number;
    readonly confidenceInterval: readonly [number, number]; // 95% CI
    readonly measuredAt: string; // ISO date
  };
}

/**
 * Range estimate with EXPLICIT basis.
 *
 * Use for: operations with theoretical bounds but no empirical data yet
 *
 * RULE: Must have citation or principled derivation. No guessing.
 */
export interface BoundedConfidence {
  readonly type: 'bounded';
  readonly low: number;
  readonly high: number;
  readonly basis: 'theoretical' | 'literature' | 'formal_analysis';
  readonly citation: string; // Paper, formal proof, or explicit reasoning
}

/**
 * Confidence is genuinely unknown.
 *
 * Use for: operations before calibration, new primitives
 *
 * RULE: System must handle operations without confidence values gracefully.
 * This is the HONEST state - we don't know yet.
 */
export interface AbsentConfidence {
  readonly type: 'absent';
  readonly reason: 'uncalibrated' | 'insufficient_data' | 'not_applicable';
}

// ============================================================================
// TYPE GUARDS
// ============================================================================

export function isDeterministicConfidence(value: ConfidenceValue): value is DeterministicConfidence {
  return value.type === 'deterministic';
}

export function isDerivedConfidence(value: ConfidenceValue): value is DerivedConfidence {
  return value.type === 'derived';
}

export function isMeasuredConfidence(value: ConfidenceValue): value is MeasuredConfidence {
  return value.type === 'measured';
}

export function isBoundedConfidence(value: ConfidenceValue): value is BoundedConfidence {
  return value.type === 'bounded';
}

export function isAbsentConfidence(value: ConfidenceValue): value is AbsentConfidence {
  return value.type === 'absent';
}

export function isConfidenceValue(value: unknown): value is ConfidenceValue {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { type?: unknown };
  return (
    candidate.type === 'deterministic' ||
    candidate.type === 'derived' ||
    candidate.type === 'measured' ||
    candidate.type === 'bounded' ||
    candidate.type === 'absent'
  );
}

// ============================================================================
// CALIBRATION STATUS HELPERS
// ============================================================================

/** Type alias for calibration status */
export type CalibrationStatus = 'preserved' | 'degraded' | 'unknown';

/**
 * Compute the calibration status for a derived confidence based on its inputs.
 *
 * Calibration is considered:
 * - 'preserved': All inputs are measured (calibrated) or deterministic
 * - 'degraded': At least one input is bounded, derived with unknown/degraded status, or absent
 * - 'unknown': Cannot determine calibration status
 *
 * @param inputs - Array of input confidence values
 * @returns The resulting calibration status
 */
export function computeCalibrationStatus(inputs: ConfidenceValue[]): CalibrationStatus {
  if (inputs.length === 0) {
    return 'unknown';
  }

  let allPreserved = true;
  let anyDegraded = false;

  for (const input of inputs) {
    switch (input.type) {
      case 'deterministic':
        // Deterministic values are perfectly calibrated (always correct)
        break;
      case 'measured':
        // Measured values are calibrated by definition
        break;
      case 'derived':
        // Check the derived confidence's calibration status
        if (input.calibrationStatus === 'degraded') {
          anyDegraded = true;
          allPreserved = false;
        } else if (input.calibrationStatus === 'unknown' || input.calibrationStatus === undefined) {
          // Treat unknown/missing as degraded for safety
          anyDegraded = true;
          allPreserved = false;
        }
        // 'preserved' maintains the current status
        break;
      case 'bounded':
        // Bounded values are not empirically calibrated
        anyDegraded = true;
        allPreserved = false;
        break;
      case 'absent':
        // Absent values definitely degrade calibration
        anyDegraded = true;
        allPreserved = false;
        break;
    }
  }

  if (allPreserved) {
    return 'preserved';
  }
  if (anyDegraded) {
    return 'degraded';
  }
  return 'unknown';
}

/**
 * Derive a sequential confidence with calibration tracking.
 *
 * Uses min(steps) formula. Calibration is preserved only if all inputs are calibrated.
 *
 * @param steps - Array of confidence values in the sequence
 * @returns DerivedConfidence with calibrationStatus set
 */
export function deriveSequentialConfidence(steps: ConfidenceValue[]): ConfidenceValue {
  if (steps.length === 0) {
    return { type: 'absent', reason: 'insufficient_data' };
  }

  // If any step has absent confidence, the sequence is degraded
  const values = steps.map(getNumericValue);
  if (values.some((v) => v === null)) {
    return {
      type: 'absent',
      reason: 'uncalibrated',
    };
  }

  const minValue = Math.min(...(values.filter((v): v is number => v !== null)));
  const calibrationStatus = computeCalibrationStatus(steps);
  const inputNames = steps.map((_, i) => `step_${i}`);

  // Build proven formula AST
  const provenFormula = migrateStringFormula('min(steps)', inputNames);

  const result: DerivedConfidence = {
    type: 'derived',
    value: minValue,
    formula: 'min(steps)',
    inputs: steps.map((s, i) => ({ name: `step_${i}`, confidence: s })),
    calibrationStatus,
  };

  // Add proven formula if migration was successful
  if (!(provenFormula instanceof Error)) {
    return { ...result, provenFormula };
  }

  return result;
}

/**
 * Derive a parallel confidence with calibration tracking.
 *
 * Uses product(branches) formula for independent AND.
 * Calibration is preserved only if all inputs are calibrated.
 *
 * Note: Product formula may degrade calibration even with calibrated inputs
 * if the independence assumption is violated.
 *
 * @param branches - Array of confidence values (assumed independent)
 * @returns DerivedConfidence with calibrationStatus set
 */
export function deriveParallelConfidence(branches: ConfidenceValue[]): ConfidenceValue {
  if (branches.length === 0) {
    return { type: 'absent', reason: 'insufficient_data' };
  }

  const values = branches.map(getNumericValue);
  if (values.some((v) => v === null)) {
    return {
      type: 'absent',
      reason: 'uncalibrated',
    };
  }

  const product = (values.filter((v): v is number => v !== null)).reduce((a, b) => a * b, 1);
  const calibrationStatus = computeCalibrationStatus(branches);
  const inputNames = branches.map((_, i) => `branch_${i}`);

  // Build proven formula AST
  const provenFormula = migrateStringFormula('product(branches)', inputNames);

  const result: DerivedConfidence = {
    type: 'derived',
    value: product,
    formula: 'product(branches)',
    inputs: branches.map((b, i) => ({ name: `branch_${i}`, confidence: b })),
    calibrationStatus,
  };

  // Add proven formula if migration was successful
  if (!(provenFormula instanceof Error)) {
    return { ...result, provenFormula };
  }

  return result;
}

// ============================================================================
// DERIVATION RULES (D1-D6)
// ============================================================================

/**
 * D1: Syntactic Operations → Deterministic
 *
 * AST parsing, regex matching, file reading - ALWAYS 1.0 or 0.0
 */
export function syntacticConfidence(success: boolean): DeterministicConfidence {
  return {
    type: 'deterministic',
    value: success ? 1.0 : 0.0,
    reason: success ? 'operation_succeeded' : 'operation_failed',
  };
}

/**
 * D2: Sequential Composition → min(steps)
 *
 * Sequential pipeline: confidence = minimum of steps (weakest link)
 */
export function sequenceConfidence(steps: ConfidenceValue[]): ConfidenceValue {
  if (steps.length === 0) {
    return { type: 'absent', reason: 'insufficient_data' };
  }

  // If any step has absent confidence, the sequence is degraded
  const values = steps.map(getNumericValue);
  if (values.some((v) => v === null)) {
    return {
      type: 'absent',
      reason: 'uncalibrated',
    };
  }

  const minValue = Math.min(...(values.filter((v): v is number => v !== null)));
  const inputNames = steps.map((_, i) => `step_${i}`);

  // Build proven formula AST
  const provenFormula = migrateStringFormula('min(steps)', inputNames);

  const result: DerivedConfidence = {
    type: 'derived',
    value: minValue,
    formula: 'min(steps)',
    inputs: steps.map((s, i) => ({ name: `step_${i}`, confidence: s })),
  };

  // Add proven formula if migration was successful
  if (!(provenFormula instanceof Error)) {
    return { ...result, provenFormula };
  }

  return result;
}

/**
 * D3: Parallel-All Composition → product(branches)
 *
 * All branches must succeed: confidence = product (independent AND)
 *
 * **Independence Assumption**: This formula assumes all branch confidences are
 * statistically independent. For correlated inputs (e.g., branches that share
 * underlying data sources, code paths, or LLM calls), the product formula may
 * produce miscalibrated results - typically underestimating confidence when
 * branches are positively correlated, or overestimating when negatively correlated.
 *
 * Consider using `sequenceConfidence` (min) if branch outcomes are highly correlated,
 * or apply domain-specific correlation adjustments before combining.
 *
 * @param branches - Array of confidence values to combine (assumed independent)
 * @returns Derived confidence representing P(all branches succeed)
 */
export function parallelAllConfidence(branches: ConfidenceValue[]): ConfidenceValue {
  if (branches.length === 0) {
    return { type: 'absent', reason: 'insufficient_data' };
  }

  const values = branches.map(getNumericValue);
  if (values.some((v) => v === null)) {
    return {
      type: 'absent',
      reason: 'uncalibrated',
    };
  }

  const product = (values.filter((v): v is number => v !== null)).reduce((a, b) => a * b, 1);
  const inputNames = branches.map((_, i) => `branch_${i}`);

  // Build proven formula AST
  const provenFormula = migrateStringFormula('product(branches)', inputNames);

  const result: DerivedConfidence = {
    type: 'derived',
    value: product,
    formula: 'product(branches)',
    inputs: branches.map((b, i) => ({ name: `branch_${i}`, confidence: b })),
  };

  // Add proven formula if migration was successful
  if (!(provenFormula instanceof Error)) {
    return { ...result, provenFormula };
  }

  return result;
}

/**
 * D4: Parallel-Any Composition → 1 - product(1 - branches)
 *
 * Any branch can succeed: confidence = 1 - product of failures (independent OR)
 *
 * **Independence Assumption**: This formula assumes all branch confidences are
 * statistically independent. For correlated inputs (e.g., branches that share
 * underlying data sources, code paths, or LLM calls), the formula may produce
 * miscalibrated results - typically overestimating confidence when branches are
 * positively correlated (because if one fails, others are likely to fail too).
 *
 * Consider using `orConfidence` for pairwise combinations with explicit correlation
 * handling, or apply domain-specific correlation adjustments before combining.
 *
 * @param branches - Array of confidence values to combine (assumed independent)
 * @returns Derived confidence representing P(at least one branch succeeds)
 */
export function parallelAnyConfidence(branches: ConfidenceValue[]): ConfidenceValue {
  if (branches.length === 0) {
    return { type: 'absent', reason: 'insufficient_data' };
  }

  const values = branches.map(getNumericValue);
  if (values.some((v) => v === null)) {
    return {
      type: 'absent',
      reason: 'uncalibrated',
    };
  }

  const validValues = values.filter((v): v is number => v !== null);
  const failureProduct = validValues.map((v) => 1 - v).reduce((a, b) => a * b, 1);
  const inputNames = branches.map((_, i) => `branch_${i}`);

  // Build proven formula AST
  const provenFormula = migrateStringFormula('1 - product(1 - branches)', inputNames);

  const result: DerivedConfidence = {
    type: 'derived',
    value: 1 - failureProduct,
    formula: '1 - product(1 - branches)',
    inputs: branches.map((b, i) => ({ name: `branch_${i}`, confidence: b })),
  };

  // Add proven formula if migration was successful
  if (!(provenFormula instanceof Error)) {
    return { ...result, provenFormula };
  }

  return result;
}

// ============================================================================
// CORRELATION-AWARE DERIVATION (WU-THIMPL-117)
// ============================================================================

/**
 * Options for correlation-aware parallel confidence derivation.
 */
export interface CorrelationOptions {
  /**
   * Correlation coefficient between branches (0 to 1).
   *
   * - 0 = independent (standard product formula)
   * - 1 = perfectly correlated (reduces to min/max)
   * - Values in between = partial correlation
   *
   * For positive correlation, the effective joint probability is higher than
   * the product (for AND) or lower than noisy-or (for OR).
   */
  correlation?: number;
}

/**
 * Derive parallel-all confidence with optional correlation adjustment.
 *
 * This function extends `parallelAllConfidence` to handle correlated inputs.
 * When branches are positively correlated (they tend to succeed or fail together),
 * the standard product formula underestimates the joint probability.
 *
 * **Mathematical Background:**
 *
 * For two variables with correlation ρ:
 * - P(A ∧ B) = P(A)P(B) + ρ√(P(A)(1-P(A))P(B)(1-P(B)))
 *
 * For n variables, we use a conservative linear interpolation:
 * - At ρ=0: P = product(branches)
 * - At ρ=1: P = min(branches)
 * - For 0 < ρ < 1: P = (1-ρ)*product + ρ*min
 *
 * This interpolation is a simplification of the true multivariate distribution
 * but provides a principled adjustment for correlation.
 *
 * @param branches - Array of confidence values to combine
 * @param options - Optional correlation parameter
 * @returns Derived confidence with correlation adjustment
 *
 * @example
 * ```typescript
 * // Two branches from same LLM call (correlated)
 * const result = deriveParallelAllConfidence(
 *   [branch1, branch2],
 *   { correlation: 0.7 }
 * );
 * // Result will be higher than pure product
 * ```
 */
export function deriveParallelAllConfidence(
  branches: ConfidenceValue[],
  options: CorrelationOptions = {}
): ConfidenceValue {
  if (branches.length === 0) {
    return { type: 'absent', reason: 'insufficient_data' };
  }

  const values = branches.map(getNumericValue);
  if (values.some((v) => v === null)) {
    return { type: 'absent', reason: 'uncalibrated' };
  }

  const validValues = values.filter((v): v is number => v !== null);
  const correlation = Math.max(0, Math.min(1, options.correlation ?? 0));

  // Independent case: product
  const product = validValues.reduce((a, b) => a * b, 1);

  // Perfectly correlated case: minimum
  const minVal = Math.min(...validValues);

  // Interpolate based on correlation
  // At ρ=0: use product, at ρ=1: use min
  const adjustedValue = (1 - correlation) * product + correlation * minVal;

  const formula = correlation === 0
    ? 'product(branches)'
    : `correlation_adjusted_product(ρ=${correlation.toFixed(2)})`;

  const calibrationStatus = computeCalibrationStatus(branches);
  const inputNames = branches.map((_, i) => `branch_${i}`);

  // Build proven formula AST (for non-correlated case)
  const provenFormula = correlation === 0
    ? migrateStringFormula('product(branches)', inputNames)
    : null; // Correlation-adjusted formulas are not yet supported in proven AST

  const result: DerivedConfidence = {
    type: 'derived',
    value: adjustedValue,
    formula,
    inputs: branches.map((b, i) => ({ name: `branch_${i}`, confidence: b })),
    calibrationStatus,
  };

  // Add proven formula if migration was successful
  if (provenFormula !== null && !(provenFormula instanceof Error)) {
    return { ...result, provenFormula };
  }

  return result;
}

/**
 * Options for parallel-any confidence derivation.
 */
export interface ParallelAnyOptions extends CorrelationOptions {
  /**
   * How to handle Absent inputs (WU-THIMPL-213).
   *
   * - 'strict': Return Absent if ANY input is Absent (original behavior)
   * - 'relaxed': Compute result from non-Absent inputs only (OR semantics)
   *
   * For OR semantics, if ANY input has real confidence, the output should too.
   * This is because in OR logic, we only need one success - so we can compute
   * the probability using only the branches we know about.
   *
   * Default: 'relaxed' (aligned with OR semantics)
   */
  absentHandling?: 'strict' | 'relaxed';
}

/**
 * Derive parallel-any confidence with optional correlation adjustment.
 *
 * This function extends `parallelAnyConfidence` to handle correlated inputs.
 * When branches are positively correlated (they tend to succeed or fail together),
 * the standard noisy-or formula overestimates the probability of at least one
 * success.
 *
 * **Mathematical Background:**
 *
 * For two variables with correlation ρ:
 * - P(A ∨ B) = P(A) + P(B) - P(A ∧ B)
 *
 * For n variables, we use a conservative linear interpolation:
 * - At ρ=0: P = 1 - product(1 - branches) [noisy-or]
 * - At ρ=1: P = max(branches)
 * - For 0 < ρ < 1: P = (1-ρ)*noisy_or + ρ*max
 *
 * **Absent Handling (WU-THIMPL-213):**
 *
 * For OR semantics, if ANY input has real confidence, the output should too.
 * With `absentHandling: 'relaxed'` (default), Absent inputs are excluded from
 * computation. The rationale: in OR logic, we only need one branch to succeed,
 * so unknown branches can be ignored - the known branches still give us a
 * valid lower bound on the probability of at least one success.
 *
 * With `absentHandling: 'strict'`, the original behavior is preserved where
 * any Absent input causes the output to be Absent.
 *
 * @param branches - Array of confidence values to combine
 * @param options - Optional correlation and absent handling parameters
 * @returns Derived confidence with correlation adjustment
 *
 * @example
 * ```typescript
 * // Three retrieval attempts that may share failure modes
 * const result = deriveParallelAnyConfidence(
 *   [attempt1, attempt2, attempt3],
 *   { correlation: 0.5 }
 * );
 * // Result will be lower than pure noisy-or
 *
 * // With one absent branch (relaxed handling)
 * const partial = deriveParallelAnyConfidence(
 *   [measuredConf, absent()],
 *   { absentHandling: 'relaxed' }
 * );
 * // Returns derived confidence using only the measured input
 * ```
 */
export function deriveParallelAnyConfidence(
  branches: ConfidenceValue[],
  options: ParallelAnyOptions = {}
): ConfidenceValue {
  if (branches.length === 0) {
    return { type: 'absent', reason: 'insufficient_data' };
  }

  const absentHandling = options.absentHandling ?? 'relaxed';

  // Separate present and absent branches
  const presentBranches: ConfidenceValue[] = [];
  const presentValues: number[] = [];

  for (const branch of branches) {
    const value = getNumericValue(branch);
    if (value !== null) {
      presentBranches.push(branch);
      presentValues.push(value);
    }
  }

  // Handle based on absent handling mode
  if (absentHandling === 'strict') {
    // Original behavior: any absent means result is absent
    if (presentValues.length < branches.length) {
      return { type: 'absent', reason: 'uncalibrated' };
    }
  } else {
    // Relaxed behavior (WU-THIMPL-213): compute from present branches only
    // For OR semantics, if no branch has confidence, we can't compute
    if (presentValues.length === 0) {
      return { type: 'absent', reason: 'uncalibrated' };
    }
  }

  const correlation = Math.max(0, Math.min(1, options.correlation ?? 0));

  // Independent case: noisy-or
  const failureProduct = presentValues.map((v) => 1 - v).reduce((a, b) => a * b, 1);
  const noisyOr = 1 - failureProduct;

  // Perfectly correlated case: maximum
  const max = Math.max(...presentValues);

  // Interpolate based on correlation
  // At ρ=0: use noisy-or, at ρ=1: use max
  const adjustedValue = (1 - correlation) * noisyOr + correlation * max;

  // Build formula string
  let formula: string;
  const hasAbsent = presentBranches.length < branches.length;

  if (correlation === 0) {
    formula = hasAbsent
      ? `1 - product(1 - present_branches) [${presentBranches.length}/${branches.length} branches]`
      : '1 - product(1 - branches)';
  } else {
    formula = hasAbsent
      ? `correlation_adjusted_noisy_or(ρ=${correlation.toFixed(2)}) [${presentBranches.length}/${branches.length} branches]`
      : `correlation_adjusted_noisy_or(ρ=${correlation.toFixed(2)})`;
  }

  // Calibration status is based on present branches only
  const calibrationStatus = computeCalibrationStatus(presentBranches);
  const inputNames = branches.map((_, i) => `branch_${i}`);

  // Build proven formula AST (for non-correlated, non-absent case)
  const provenFormula = correlation === 0 && !hasAbsent
    ? migrateStringFormula('1 - product(1 - branches)', inputNames)
    : null; // Correlation-adjusted or partial formulas are not yet supported in proven AST

  const result: DerivedConfidence = {
    type: 'derived',
    value: adjustedValue,
    formula,
    inputs: branches.map((b, i) => ({ name: `branch_${i}`, confidence: b })),
    calibrationStatus: hasAbsent ? 'degraded' : calibrationStatus,
  };

  // Add proven formula if migration was successful
  if (provenFormula !== null && !(provenFormula instanceof Error)) {
    return { ...result, provenFormula };
  }

  return result;
}

/**
 * D5: LLM Operations Before Calibration → Absent
 *
 * BEFORE any calibration data exists - be honest
 */
export function uncalibratedConfidence(): AbsentConfidence {
  return {
    type: 'absent',
    reason: 'uncalibrated',
  };
}

/**
 * D6: LLM Operations After Calibration → Measured
 *
 * AFTER calibration with real outcome data
 */
export interface CalibrationResult {
  datasetId: string;
  sampleSize: number;
  accuracy: number;
  ci95: readonly [number, number];
}

export function measuredConfidence(data: CalibrationResult): MeasuredConfidence {
  return {
    type: 'measured',
    value: data.accuracy,
    measurement: {
      datasetId: data.datasetId,
      sampleSize: data.sampleSize,
      accuracy: data.accuracy,
      confidenceInterval: data.ci95,
      measuredAt: new Date().toISOString(),
    },
  };
}

// ============================================================================
// CALIBRATION ADJUSTMENT (Track F C3)
// ============================================================================

export interface ConfidenceAdjustmentResult {
  confidence: ConfidenceValue;
  raw: number | null;
  calibrated: number | null;
  weight: number;
  status: 'uncalibrated' | 'calibrating' | 'calibrated';
  datasetId?: string;
}

export function adjustConfidenceValue(
  confidence: ConfidenceValue,
  report: CalibrationReport,
  options: CalibrationAdjustmentOptions = {}
): ConfidenceAdjustmentResult {
  const raw = getNumericValue(confidence);
  if (raw === null) {
    return {
      confidence,
      raw: null,
      calibrated: null,
      weight: 0,
      status: 'uncalibrated',
      datasetId: report.datasetId,
    };
  }

  const adjustment = adjustConfidenceScore(raw, report, options);
  const formula = `calibration_curve:${report.datasetId}`;

  // For calibration curves, we don't build a proven formula since they
  // represent external calibration data rather than a derivation formula.
  // The formula string documents the calibration source.
  const adjusted: DerivedConfidence = {
    type: 'derived',
    value: adjustment.calibrated,
    formula,
    inputs: [{ name: 'raw_confidence', confidence }],
  };

  return {
    confidence: adjusted,
    raw,
    calibrated: adjustment.calibrated,
    weight: adjustment.weight,
    status: resolveCalibrationStatus(report, adjustment.weight),
    datasetId: report.datasetId,
  };
}

// ============================================================================
// DEGRADATION HANDLERS
// ============================================================================

/**
 * Get the numeric value from a ConfidenceValue, or null if absent.
 */
export function getNumericValue(conf: ConfidenceValue): number | null {
  switch (conf.type) {
    case 'deterministic':
    case 'derived':
    case 'measured':
      return conf.value;
    case 'bounded':
      return (conf.low + conf.high) / 2; // Use midpoint
    case 'absent':
      return null;
  }
}

function resolveCalibrationStatus(
  report: CalibrationReport,
  weight: number
): 'uncalibrated' | 'calibrating' | 'calibrated' {
  if (report.sampleSize <= 0) return 'uncalibrated';
  if (weight >= 1) return 'calibrated';
  return 'calibrating';
}

/**
 * Get effective confidence with conservative defaults for absent values.
 *
 * Option B from the spec: Use conservative lower bound
 */
export function getEffectiveConfidence(conf: ConfidenceValue): number {
  switch (conf.type) {
    case 'deterministic':
    case 'derived':
    case 'measured':
      return conf.value;
    case 'bounded':
      return conf.low; // Conservative: use lower bound
    case 'absent':
      return 0.0; // Most conservative: treat as zero confidence
  }
}

/**
 * Select best composition when some have absent confidence.
 *
 * Option A from the spec: Degrade to equal weighting
 */
export function selectWithDegradation<T extends { confidence: ConfidenceValue; id: string }>(
  items: T[]
): T | null {
  if (items.length === 0) {
    return null;
  }

  const withConfidence = items.filter((item) => item.confidence.type !== 'absent');

  if (withConfidence.length === 0) {
    // No confidence data - all options are equally viable
    // Use deterministic selection (alphabetical by id)
    return [...items].sort((a, b) => a.id.localeCompare(b.id))[0];
  }

  // Sort by confidence (those with data)
  return [...withConfidence].sort(
    (a, b) => getEffectiveConfidence(b.confidence) - getEffectiveConfidence(a.confidence)
  )[0];
}

/**
 * Block operations that require confidence above a threshold.
 *
 * Option C from the spec: Block operations requiring confidence
 */
export interface ExecutionBlockResult {
  status: 'allowed' | 'blocked';
  effectiveConfidence: number;
  confidenceType: ConfidenceValue['type'];
  mitigation?: string;
  reason?: string;
}

export function checkConfidenceThreshold(
  conf: ConfidenceValue,
  minConfidence: number
): ExecutionBlockResult {
  const effective = getEffectiveConfidence(conf);

  if (effective >= minConfidence) {
    return {
      status: 'allowed',
      effectiveConfidence: effective,
      confidenceType: conf.type,
    };
  }

  return {
    status: 'blocked',
    effectiveConfidence: effective,
    confidenceType: conf.type,
    reason: `Confidence ${effective.toFixed(2)} below threshold ${minConfidence}`,
    mitigation:
      conf.type === 'absent'
        ? 'Run calibration suite to obtain confidence data'
        : 'Use a higher-confidence primitive',
  };
}

/**
 * Report the confidence status for user visibility.
 */
export interface ConfidenceStatusReport {
  type: ConfidenceValue['type'];
  numericValue: number | null;
  isCalibrated: boolean;
  explanation: string;
}

export function reportConfidenceStatus(conf: ConfidenceValue): ConfidenceStatusReport {
  const numericValue = getNumericValue(conf);
  const isCalibrated = conf.type === 'measured';

  let explanation: string;
  switch (conf.type) {
    case 'deterministic':
      explanation = `Logically certain (${conf.reason})`;
      break;
    case 'derived':
      explanation = `Computed via ${conf.formula} from ${conf.inputs.length} inputs`;
      break;
    case 'measured':
      explanation = `Calibrated from ${conf.measurement.sampleSize} samples (${(conf.measurement.accuracy * 100).toFixed(1)}% accuracy)`;
      break;
    case 'bounded':
      explanation = `Bounded [${conf.low}, ${conf.high}] based on ${conf.basis}: ${conf.citation}`;
      break;
    case 'absent':
      explanation = `Unknown confidence (${conf.reason})`;
      break;
  }

  return {
    type: conf.type,
    numericValue,
    isCalibrated,
    explanation,
  };
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Create a deterministic confidence value.
 */
export function deterministic(success: boolean, reason: string): DeterministicConfidence {
  return {
    type: 'deterministic',
    value: success ? 1.0 : 0.0,
    reason,
  };
}

/**
 * Create a bounded confidence value.
 */
export function bounded(
  low: number,
  high: number,
  basis: 'theoretical' | 'literature' | 'formal_analysis',
  citation: string
): BoundedConfidence {
  if (low > high) {
    throw new Error(`Bounded confidence: low (${low}) must be <= high (${high})`);
  }
  if (low < 0 || high > 1) {
    throw new Error(`Bounded confidence: values must be in [0, 1], got [${low}, ${high}]`);
  }
  return {
    type: 'bounded',
    low,
    high,
    basis,
    citation,
  };
}

/**
 * Create an absent confidence value.
 */
export function absent(
  reason: 'uncalibrated' | 'insufficient_data' | 'not_applicable' = 'uncalibrated'
): AbsentConfidence {
  return {
    type: 'absent',
    reason,
  };
}

// ============================================================================
// D7 BOUNDARY ENFORCEMENT UTILITIES
// ============================================================================

/**
 * Combine multiple confidence values with weights.
 *
 * D7 compliant: Produces derived confidence with full provenance.
 */
export function combinedConfidence(
  inputs: Array<{ confidence: ConfidenceValue; weight: number; name: string }>
): ConfidenceValue {
  if (inputs.length === 0) {
    return { type: 'absent', reason: 'insufficient_data' };
  }

  // Filter to only present confidences
  const presentInputs = inputs.filter(
    (i) => i.confidence.type !== 'absent'
  );

  if (presentInputs.length === 0) {
    return { type: 'absent', reason: 'uncalibrated' };
  }

  const totalWeight = presentInputs.reduce((sum, i) => sum + i.weight, 0);
  const weightedValue = presentInputs.reduce((sum, i) => {
    const value = getNumericValue(i.confidence);
    return sum + (value ?? 0) * i.weight;
  }, 0) / totalWeight;

  const inputNames = presentInputs.map((i) => i.name);

  // Build proven formula AST
  const provenFormula = migrateStringFormula('weighted_average', inputNames);

  const result: DerivedConfidence = {
    type: 'derived',
    value: Math.max(0, Math.min(1, weightedValue)),
    formula: 'weighted_average',
    inputs: presentInputs.map((i) => ({
      name: i.name,
      confidence: i.confidence,
    })),
  };

  // Add proven formula if migration was successful
  if (!(provenFormula instanceof Error)) {
    return { ...result, provenFormula };
  }

  return result;
}

/**
 * Apply temporal decay to confidence.
 *
 * D7 compliant: Produces derived confidence with decay provenance.
 */
export function applyDecay(
  confidence: ConfidenceValue,
  ageMs: number,
  halfLifeMs: number
): ConfidenceValue {
  if (confidence.type === 'absent') return confidence;

  const currentValue = getNumericValue(confidence);
  if (currentValue === null) return confidence;

  const decayFactor = Math.pow(0.5, ageMs / halfLifeMs);
  const decayedValue = currentValue * decayFactor;

  return {
    type: 'derived',
    value: decayedValue,
    formula: `decay(${decayFactor.toFixed(4)})`,
    inputs: [
      { name: 'original', confidence },
      {
        name: 'decay_factor',
        confidence: {
          type: 'deterministic',
          value: decayFactor >= 0.5 ? 1.0 : 0.0,
          reason: `age_${ageMs}ms_halflife_${halfLifeMs}ms`,
        },
      },
    ],
  };
}

/**
 * Compose confidence through logical AND (minimum).
 *
 * D7 compliant: Produces derived confidence.
 */
export function andConfidence(a: ConfidenceValue, b: ConfidenceValue): ConfidenceValue {
  if (a.type === 'absent') return a;
  if (b.type === 'absent') return b;

  const aVal = getNumericValue(a);
  const bVal = getNumericValue(b);
  if (aVal === null || bVal === null) {
    return { type: 'absent', reason: 'insufficient_data' };
  }

  // Build proven formula AST
  const provenFormula = migrateStringFormula('min(a, b)', ['a', 'b']);

  const result: DerivedConfidence = {
    type: 'derived',
    value: Math.min(aVal, bVal),
    formula: 'min(a, b)',
    inputs: [
      { name: 'a', confidence: a },
      { name: 'b', confidence: b },
    ],
  };

  // Add proven formula if migration was successful
  if (!(provenFormula instanceof Error)) {
    return { ...result, provenFormula };
  }

  return result;
}

/**
 * Compose confidence through logical OR (maximum).
 *
 * D7 compliant: Produces derived confidence.
 */
export function orConfidence(a: ConfidenceValue, b: ConfidenceValue): ConfidenceValue {
  const aVal = getNumericValue(a);
  const bVal = getNumericValue(b);

  if (aVal !== null && bVal !== null) {
    // Build proven formula AST
    const provenFormula = migrateStringFormula('max(a, b)', ['a', 'b']);

    const result: DerivedConfidence = {
      type: 'derived',
      value: Math.max(aVal, bVal),
      formula: 'max(a, b)',
      inputs: [
        { name: 'a', confidence: a },
        { name: 'b', confidence: b },
      ],
    };

    // Add proven formula if migration was successful
    if (!(provenFormula instanceof Error)) {
      return { ...result, provenFormula };
    }

    return result;
  }
  if (aVal !== null) return a;
  if (bVal !== null) return b;
  return { type: 'absent', reason: 'insufficient_data' };
}

/**
 * Check if confidence meets a minimum threshold.
 *
 * D7 compliant: Uses getEffectiveConfidence for safe extraction.
 */
export function meetsThreshold(confidence: ConfidenceValue, threshold: number): boolean {
  return getEffectiveConfidence(confidence) >= threshold;
}

/**
 * Type guard to detect raw numeric confidence violations.
 *
 * D7 enforcement: Use this to validate at runtime.
 */
export function assertConfidenceValue(
  value: unknown,
  context: string
): asserts value is ConfidenceValue {
  if (!isConfidenceValue(value)) {
    throw new Error(
      `D7_VIOLATION(${context}): Expected ConfidenceValue, got ${typeof value}. ` +
      `Raw numeric confidence is forbidden - use deterministic(), bounded(), measuredConfidence(), or absent().`
    );
  }
}
