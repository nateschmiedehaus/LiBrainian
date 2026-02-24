/**
 * @fileoverview Validation Construction Base Class
 *
 * Provides an abstract base class for rule-based validation constructions.
 * Validation constructions check inputs against a set of rules and report
 * violations and warnings.
 *
 * Use this base class when your construction:
 * - Validates input against defined rules
 * - Reports violations (failures) and warnings
 * - Has a binary valid/invalid verdict
 *
 * Examples: Architecture verification, schema validation, code style checking
 *
 * @packageDocumentation
 */

import type { Librarian } from '../../api/librarian.js';
import type { ConfidenceValue } from '../../epistemics/confidence.js';
import { bounded, getNumericValue } from '../../epistemics/confidence.js';
import { BaseConstruction, toEvidenceIds, type ConstructionResult } from './construction_base.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Severity level for validation findings.
 */
export type ValidationSeverity = 'error' | 'warning' | 'info';

/**
 * A violation found during validation.
 */
export interface Violation {
  /** Rule that was violated */
  ruleId: string;
  /** Human-readable description of the violation */
  description: string;
  /** Severity of the violation */
  severity: ValidationSeverity;
  /** Location where the violation occurred */
  location?: {
    file?: string;
    line?: number;
    column?: number;
  };
  /** Suggested fix for the violation */
  suggestion?: string;
  /** Additional context */
  context?: Record<string, unknown>;
}

/**
 * A warning found during validation (less severe than violations).
 */
export interface Warning {
  /** Rule that triggered the warning */
  ruleId: string;
  /** Human-readable description of the warning */
  description: string;
  /** Location where the warning applies */
  location?: {
    file?: string;
    line?: number;
    column?: number;
  };
  /** Suggested improvement */
  suggestion?: string;
}

/**
 * Result of a validation construction.
 */
export interface ValidationResult extends ConstructionResult {
  /** Whether the validation passed (no errors) */
  valid: boolean;
  /** Violations found (severity: error) */
  violations: Violation[];
  /** Warnings found (severity: warning or info) */
  warnings: Warning[];
  /** Number of items validated */
  itemsValidated: number;
  /** Number of rules applied */
  rulesApplied: number;
}

/**
 * A validation rule definition.
 */
export interface ValidationRule<TInput> {
  /** Unique rule identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Description of what the rule checks */
  description: string;
  /** Severity when rule is violated */
  severity: ValidationSeverity;
  /** Whether the rule is enabled */
  enabled: boolean;
  /** The validation function (returns violations if any) */
  check: (input: TInput) => Promise<Violation[]>;
}

// ============================================================================
// VALIDATION CONSTRUCTION BASE
// ============================================================================

/**
 * Abstract base class for validation constructions.
 *
 * Validation constructions check inputs against a set of rules and report
 * violations. The result indicates whether the input is valid (no errors)
 * along with a list of violations and warnings.
 *
 * Type Parameters:
 * - TInput: The input type to validate
 * - TRules: The type representing the rule set (for type-safe rule access)
 *
 * @example
 * ```typescript
 * interface SchemaInput {
 *   document: unknown;
 *   schemaId: string;
 * }
 *
 * interface SchemaRules {
 *   typeCheck: ValidationRule<SchemaInput>;
 *   formatCheck: ValidationRule<SchemaInput>;
 * }
 *
 * class SchemaValidator extends ValidationConstruction<SchemaInput, SchemaRules> {
 *   readonly CONSTRUCTION_ID = 'SchemaValidator';
 *
 *   getRules(): SchemaRules {
 *     return {
 *       typeCheck: {
 *         id: 'type-check',
 *         name: 'Type Check',
 *         description: 'Validates types match schema',
 *         severity: 'error',
 *         enabled: true,
 *         check: async (input) => { ... },
 *       },
 *       formatCheck: { ... },
 *     };
 *   }
 *
 *   async validate(input: SchemaInput): Promise<ValidationResult> {
 *     const rules = this.getRules();
 *     const violations = await this.applyRules(input, Object.values(rules));
 *     return this.buildValidationResult(violations, Object.keys(rules).length);
 *   }
 * }
 * ```
 */
export abstract class ValidationConstruction<TInput, TRules>
  extends BaseConstruction<TInput, ValidationResult> {

  /**
   * Get the rules for this validation construction.
   *
   * Subclasses must implement this to provide their rule set.
   *
   * @returns The rule set for this validation
   */
  abstract getRules(): TRules;

  /**
   * Perform the validation.
   *
   * Subclasses must implement this to perform their specific validation.
   *
   * @param input - The input to validate
   * @returns Promise resolving to the validation result
   */
  abstract validate(input: TInput): Promise<ValidationResult>;

  /**
   * Execute the construction (delegates to validate).
   *
   * @param input - The input to validate
   * @returns Promise resolving to the validation result
   */
  async execute(input: TInput): Promise<ValidationResult> {
    return this.validate(input);
  }

  /**
   * Apply a list of rules to an input and collect violations.
   *
   * @param input - The input to validate
   * @param rules - The rules to apply
   * @returns Promise resolving to array of all violations
   */
  protected async applyRules(
    input: TInput,
    rules: Array<ValidationRule<TInput>>
  ): Promise<Violation[]> {
    const allViolations: Violation[] = [];
    const enabledRules = rules.filter((r) => r.enabled);

    for (const rule of enabledRules) {
      try {
        const violations = await rule.check(input);
        allViolations.push(...violations);
      } catch (error) {
        // Rule execution failed - report as internal error
        allViolations.push({
          ruleId: rule.id,
          description: `Rule execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          severity: 'error',
          context: { error: String(error) },
        });
      }
    }

    return allViolations;
  }

  /**
   * Apply rules in parallel for better performance.
   *
   * @param input - The input to validate
   * @param rules - The rules to apply
   * @returns Promise resolving to array of all violations
   */
  protected async applyRulesParallel(
    input: TInput,
    rules: Array<ValidationRule<TInput>>
  ): Promise<Violation[]> {
    const enabledRules = rules.filter((r) => r.enabled);
    const results = await Promise.allSettled(
      enabledRules.map((rule) => rule.check(input))
    );

    const allViolations: Violation[] = [];

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const rule = enabledRules[i];

      if (result.status === 'fulfilled') {
        allViolations.push(...result.value);
      } else {
        // Rule execution failed
        allViolations.push({
          ruleId: rule.id,
          description: `Rule execution failed: ${result.reason}`,
          severity: 'error',
          context: { error: String(result.reason) },
        });
      }
    }

    return allViolations;
  }

  /**
   * Build a validation result from violations.
   *
   * @param violations - All violations found
   * @param rulesApplied - Number of rules that were applied
   * @param itemsValidated - Number of items validated
   * @param analysisTimeMs - Time taken for validation
   * @returns The complete validation result
   */
  protected buildValidationResult(
    violations: Violation[],
    rulesApplied: number,
    itemsValidated: number = 1,
    analysisTimeMs: number = 0
  ): ValidationResult {
    // Separate errors and warnings
    const errors = violations.filter((v) => v.severity === 'error');
    const warnings: Warning[] = violations
      .filter((v) => v.severity === 'warning' || v.severity === 'info')
      .map((v) => ({
        ruleId: v.ruleId,
        description: v.description,
        location: v.location,
        suggestion: v.suggestion,
      }));

    // Valid if no errors
    const valid = errors.length === 0;

    // Compute confidence
    const confidence = this.computeValidationConfidence(
      valid,
      errors.length,
      rulesApplied,
      itemsValidated
    );

    // Record prediction
    const predictionId = this.recordPrediction(
      `Validation ${valid ? 'passed' : 'failed'}: ${errors.length} errors, ${warnings.length} warnings`,
      confidence,
      {
        valid,
        errorCount: errors.length,
        warningCount: warnings.length,
        rulesApplied,
        itemsValidated,
      }
    );

    return {
      valid,
      violations: errors,
      warnings,
      itemsValidated,
      rulesApplied,
      confidence,
      evidenceRefs: toEvidenceIds([
        `validation:${rulesApplied}_rules`,
        `violations:${errors.length}_errors`,
        `warnings:${warnings.length}_warnings`,
      ]),
      analysisTimeMs,
      predictionId,
    };
  }

  /**
   * Compute confidence for a validation result.
   *
   * Confidence reflects:
   * - Rule coverage (more rules = higher confidence in completeness)
   * - Validation depth (more items validated = higher confidence)
   * - Certainty of results (clear violations are more certain)
   *
   * @param valid - Whether validation passed
   * @param errorCount - Number of errors found
   * @param rulesApplied - Number of rules applied
   * @param itemsValidated - Number of items validated
   * @returns Confidence value for the validation
   */
  protected computeValidationConfidence(
    valid: boolean,
    errorCount: number,
    rulesApplied: number,
    itemsValidated: number
  ): ConfidenceValue {
    // No rules applied = low confidence
    if (rulesApplied === 0) {
      return bounded(
        0.2,
        0.5,
        'theoretical',
        'No validation rules were applied'
      );
    }

    // Errors found = high confidence in the result
    // (we know it's invalid)
    if (errorCount > 0) {
      const confidenceBase = Math.min(0.95, 0.7 + (errorCount * 0.05));
      return {
        type: 'measured',
        value: confidenceBase,
        measurement: {
          datasetId: `${this.CONSTRUCTION_ID}_validation`,
          sampleSize: itemsValidated,
          accuracy: confidenceBase,
          confidenceInterval: [
            Math.max(0, confidenceBase - 0.1),
            Math.min(1, confidenceBase + 0.05),
          ],
          measuredAt: new Date().toISOString(),
        },
      };
    }

    // No errors found = confidence depends on rule coverage
    // More rules and items = higher confidence
    const ruleCoverageBonus = Math.min(0.2, rulesApplied * 0.02);
    const itemCoverageBonus = Math.min(0.1, itemsValidated * 0.01);
    const baseConfidence = 0.6 + ruleCoverageBonus + itemCoverageBonus;

    return {
      type: 'measured',
      value: Math.min(0.9, baseConfidence),
      measurement: {
        datasetId: `${this.CONSTRUCTION_ID}_validation`,
        sampleSize: itemsValidated,
        accuracy: baseConfidence,
        confidenceInterval: [
          Math.max(0, baseConfidence - 0.15),
          Math.min(1, baseConfidence + 0.1),
        ],
        measuredAt: new Date().toISOString(),
      },
    };
  }
}
