/**
 * @fileoverview Composite Construction Base Class
 *
 * Provides an abstract base class for composing multiple constructions.
 * Composite constructions orchestrate child constructions and manage
 * confidence propagation across their results.
 *
 * Use this base class when your construction:
 * - Orchestrates multiple sub-constructions
 * - Needs to propagate confidence through sequential or parallel operations
 * - Combines results from multiple sources
 *
 * Examples: Multi-stage analysis pipelines, parallel checks, orchestrated workflows
 *
 * CONFIDENCE PROPAGATION RULES:
 * - Sequential (D2): min(steps) - weakest link determines overall confidence
 * - Parallel-All (D3): product(branches) - all must succeed
 * - Parallel-Any (D4): 1 - product(1 - branches) - any can succeed
 *
 * @packageDocumentation
 */

import type { Librarian } from '../../api/librarian.js';
import type { ConfidenceValue, DerivedConfidence } from '../../epistemics/confidence.js';
import {
  sequenceConfidence,
  parallelAllConfidence,
  parallelAnyConfidence,
  getNumericValue,
  absent,
} from '../../epistemics/confidence.js';
import {
  BaseConstruction,
  type ConstructionResult,
  type ConstructionContext,
} from './construction_base.js';
import type { EvidenceId } from '../../epistemics/evidence_ledger.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Execution mode for child constructions.
 */
export type ExecutionMode = 'sequential' | 'parallel';

/**
 * Strategy for combining parallel results.
 */
export type ParallelCombineStrategy = 'all' | 'any' | 'majority';

/**
 * Options for composite execution.
 */
export interface CompositeExecutionOptions {
  /** How to execute children */
  mode?: ExecutionMode;
  /** How to combine parallel results */
  combineStrategy?: ParallelCombineStrategy;
  /** Maximum concurrent executions for parallel mode */
  maxConcurrency?: number;
  /** Whether to continue on child failure */
  continueOnFailure?: boolean;
  /** Timeout for the entire composite execution */
  timeoutMs?: number;
}

/**
 * Result of a child construction execution.
 */
export interface ChildResult<TOutput extends ConstructionResult> {
  /** The child construction ID */
  childId: string;
  /** Whether execution succeeded */
  success: boolean;
  /** The result if successful */
  result?: TOutput;
  /** Error if failed */
  error?: Error;
  /** Execution time */
  executionTimeMs: number;
}

/**
 * Result of a composite construction.
 */
export interface CompositeResult extends ConstructionResult {
  /** Results from all child constructions */
  childResults: Array<ChildResult<ConstructionResult>>;
  /** Number of successful children */
  successCount: number;
  /** Number of failed children */
  failureCount: number;
  /** Total execution time across all children */
  totalChildTimeMs: number;
}

// ============================================================================
// COMPOSITE CONSTRUCTION BASE
// ============================================================================

/**
 * Abstract base class for composite constructions.
 *
 * Composite constructions orchestrate multiple child constructions and
 * manage confidence propagation across their results. This enables building
 * complex analysis pipelines while maintaining principled confidence tracking.
 *
 * Type Parameters:
 * - TInput: The input type for the composite construction
 * - TOutput: The output type, must extend ConstructionResult
 *
 * @example
 * ```typescript
 * interface AnalysisInput {
 *   files: string[];
 * }
 *
 * interface FullAnalysisResult extends CompositeResult {
 *   qualityScore: number;
 *   securityScore: number;
 *   overallGrade: string;
 * }
 *
 * class FullAnalysisPipeline extends CompositeConstruction<AnalysisInput, FullAnalysisResult> {
 *   readonly CONSTRUCTION_ID = 'FullAnalysisPipeline';
 *
 *   async execute(input: AnalysisInput): Promise<FullAnalysisResult> {
 *     // Run quality and security checks in parallel
 *     const [qualityResult, securityResult] = await Promise.all([
 *       this.qualityChecker.execute(input),
 *       this.securityChecker.execute(input),
 *     ]);
 *
 *     const confidence = this.propagateConfidenceParallel([qualityResult, securityResult]);
 *     const evidenceRefs = this.mergeEvidenceRefs([qualityResult, securityResult]);
 *
 *     return {
 *       qualityScore: qualityResult.score,
 *       securityScore: securityResult.score,
 *       overallGrade: this.computeGrade(qualityResult.score, securityResult.score),
 *       childResults: [...],
 *       successCount: 2,
 *       failureCount: 0,
 *       totalChildTimeMs: qualityResult.analysisTimeMs + securityResult.analysisTimeMs,
 *       confidence,
 *       evidenceRefs,
 *       analysisTimeMs: Date.now() - startTime,
 *     };
 *   }
 * }
 * ```
 */
export abstract class CompositeConstruction<TInput, TOutput extends ConstructionResult>
  extends BaseConstruction<TInput, TOutput> {

  /**
   * Child constructions managed by this composite.
   * Subclasses should populate this in their constructor.
   */
  protected children: Array<BaseConstruction<unknown, ConstructionResult>> = [];

  /**
   * Register a child construction.
   *
   * @param child - The child construction to register
   */
  protected addChild<TChildInput, TChildOutput extends ConstructionResult>(
    child: BaseConstruction<TChildInput, TChildOutput>
  ): void {
    this.children.push(child as BaseConstruction<unknown, ConstructionResult>);

    // Propagate calibration tracker to children
    if (this.calibrationTracker) {
      child.setCalibrationTracker(this.calibrationTracker);
    }
  }

  /**
   * Propagate confidence through a sequential pipeline (D2 rule).
   *
   * Uses min(steps) - the overall confidence is limited by the weakest link.
   * This is appropriate when all steps must succeed for the overall result
   * to be meaningful.
   *
   * @param results - Array of results from sequential steps
   * @returns The propagated confidence value
   */
  protected propagateConfidenceSequential(results: ConstructionResult[]): ConfidenceValue {
    if (results.length === 0) {
      return absent('insufficient_data');
    }
    const confidences = results.map((r) => r.confidence);
    return sequenceConfidence(confidences);
  }

  /**
   * Propagate confidence through parallel-all operations (D3 rule).
   *
   * Uses product(branches) - all branches must succeed.
   * This is appropriate when all parallel operations must succeed
   * for the overall result to be valid.
   *
   * @param results - Array of results from parallel operations
   * @returns The propagated confidence value
   */
  protected propagateConfidenceParallel(results: ConstructionResult[]): ConfidenceValue {
    if (results.length === 0) {
      return absent('insufficient_data');
    }
    const confidences = results.map((r) => r.confidence);
    return parallelAllConfidence(confidences);
  }

  /**
   * Propagate confidence through parallel-any operations (D4 rule).
   *
   * Uses 1 - product(1 - branches) - any branch can succeed.
   * This is appropriate when any one of the parallel operations
   * succeeding is sufficient for the overall result.
   *
   * @param results - Array of results from parallel operations
   * @returns The propagated confidence value
   */
  protected propagateConfidenceAny(results: ConstructionResult[]): ConfidenceValue {
    if (results.length === 0) {
      return absent('insufficient_data');
    }
    const confidences = results.map((r) => r.confidence);
    return parallelAnyConfidence(confidences);
  }

  /**
   * Propagate confidence with majority voting.
   *
   * Requires a majority of branches to succeed. Confidence is based
   * on the proportion that succeeded and their individual confidences.
   *
   * @param results - Array of results
   * @param threshold - Minimum proportion required (default: 0.5)
   * @returns The propagated confidence value
   */
  protected propagateConfidenceMajority(
    results: ConstructionResult[],
    threshold: number = 0.5
  ): ConfidenceValue {
    if (results.length === 0) {
      return absent('insufficient_data');
    }

    // Get numeric values, treating absent as 0
    const values = results.map((r) => getNumericValue(r.confidence) ?? 0);
    const successCount = values.filter((v) => v >= threshold).length;
    const proportion = successCount / results.length;

    // If majority threshold met, use average of successful confidences
    if (proportion >= threshold) {
      const successfulValues = values.filter((v) => v >= threshold);
      const avgConfidence = successfulValues.reduce((a, b) => a + b, 0) / successfulValues.length;

      return {
        type: 'derived',
        value: avgConfidence * proportion, // Scale by proportion
        formula: `majority_vote(${successCount}/${results.length})`,
        inputs: results.map((r, i) => ({ name: `branch_${i}`, confidence: r.confidence })),
      } satisfies DerivedConfidence;
    }

    // Majority not met - lower confidence
    return {
      type: 'derived',
      value: proportion * 0.5, // Penalized confidence
      formula: `failed_majority(${successCount}/${results.length})`,
      inputs: results.map((r, i) => ({ name: `branch_${i}`, confidence: r.confidence })),
    } satisfies DerivedConfidence;
  }

  /**
   * Merge evidence references from multiple results.
   *
   * @param results - Array of results to merge evidence from
   * @returns Combined array of all evidence references (deduplicated)
   */
  protected mergeEvidenceRefs(results: ConstructionResult[]): EvidenceId[] {
    const allRefs = results.flatMap((r) => r.evidenceRefs);
    return [...new Set(allRefs)]; // Deduplicate
  }

  /**
   * Execute children in sequence.
   *
   * Executes each child one after another, stopping on first failure
   * unless continueOnFailure is true.
   *
   * @param inputs - Array of inputs for each child
   * @param options - Execution options
   * @returns Array of child results
   */
  protected async executeSequential<TChildInput>(
    inputs: TChildInput[],
    options: CompositeExecutionOptions = {}
  ): Promise<Array<ChildResult<ConstructionResult>>> {
    const results: Array<ChildResult<ConstructionResult>> = [];

    for (let i = 0; i < this.children.length && i < inputs.length; i++) {
      const child = this.children[i];
      const input = inputs[i];
      const startTime = Date.now();

      try {
        const result = await child.execute(input);
        results.push({
          childId: child.CONSTRUCTION_ID,
          success: true,
          result,
          executionTimeMs: Date.now() - startTime,
        });
      } catch (error) {
        results.push({
          childId: child.CONSTRUCTION_ID,
          success: false,
          error: error instanceof Error ? error : new Error(String(error)),
          executionTimeMs: Date.now() - startTime,
        });

        if (!options.continueOnFailure) {
          break;
        }
      }
    }

    return results;
  }

  /**
   * Execute children in parallel.
   *
   * Executes all children concurrently, optionally limiting concurrency.
   *
   * @param inputs - Array of inputs for each child
   * @param options - Execution options
   * @returns Array of child results
   */
  protected async executeParallel<TChildInput>(
    inputs: TChildInput[],
    options: CompositeExecutionOptions = {}
  ): Promise<Array<ChildResult<ConstructionResult>>> {
    const maxConcurrency = options.maxConcurrency ?? this.children.length;

    if (maxConcurrency >= this.children.length) {
      // Execute all at once
      return this.executeAllParallel(inputs);
    }

    // Execute with limited concurrency
    return this.executeWithConcurrencyLimit(inputs, maxConcurrency, options);
  }

  /**
   * Execute all children in parallel without concurrency limit.
   */
  private async executeAllParallel<TChildInput>(
    inputs: TChildInput[]
  ): Promise<Array<ChildResult<ConstructionResult>>> {
    const promises = this.children.map(async (child, i) => {
      const input = inputs[i];
      const startTime = Date.now();

      try {
        const result = await child.execute(input);
        return {
          childId: child.CONSTRUCTION_ID,
          success: true,
          result,
          executionTimeMs: Date.now() - startTime,
        } satisfies ChildResult<ConstructionResult>;
      } catch (error) {
        return {
          childId: child.CONSTRUCTION_ID,
          success: false,
          error: error instanceof Error ? error : new Error(String(error)),
          executionTimeMs: Date.now() - startTime,
        } satisfies ChildResult<ConstructionResult>;
      }
    });

    return Promise.all(promises);
  }

  /**
   * Execute with limited concurrency.
   */
  private async executeWithConcurrencyLimit<TChildInput>(
    inputs: TChildInput[],
    maxConcurrency: number,
    _options: CompositeExecutionOptions
  ): Promise<Array<ChildResult<ConstructionResult>>> {
    const results: Array<ChildResult<ConstructionResult>> = [];
    const pending: Array<Promise<void>> = [];
    let index = 0;

    const executeOne = async (childIndex: number): Promise<void> => {
      const child = this.children[childIndex];
      const input = inputs[childIndex];
      const startTime = Date.now();

      try {
        const result = await child.execute(input);
        results[childIndex] = {
          childId: child.CONSTRUCTION_ID,
          success: true,
          result,
          executionTimeMs: Date.now() - startTime,
        };
      } catch (error) {
        results[childIndex] = {
          childId: child.CONSTRUCTION_ID,
          success: false,
          error: error instanceof Error ? error : new Error(String(error)),
          executionTimeMs: Date.now() - startTime,
        };
      }
    };

    while (index < this.children.length) {
      while (pending.length < maxConcurrency && index < this.children.length) {
        const promise = executeOne(index++);
        pending.push(promise);
      }

      if (pending.length > 0) {
        await Promise.race(pending);
        // Remove completed promises
        const completed = pending.filter(() => results.some((r) => r !== undefined));
        for (const p of completed) {
          const idx = pending.indexOf(p);
          if (idx !== -1) {
            pending.splice(idx, 1);
          }
        }
      }
    }

    // Wait for remaining
    await Promise.all(pending);

    return results;
  }

  /**
   * Build a composite result from child results.
   *
   * @param childResults - Results from child executions
   * @param confidence - The propagated confidence
   * @param analysisTimeMs - Total analysis time
   * @returns The composite result base
   */
  protected buildCompositeResult(
    childResults: Array<ChildResult<ConstructionResult>>,
    confidence: ConfidenceValue,
    analysisTimeMs: number
  ): CompositeResult {
    const successCount = childResults.filter((r) => r.success).length;
    const failureCount = childResults.filter((r) => !r.success).length;
    const totalChildTimeMs = childResults.reduce((sum, r) => sum + r.executionTimeMs, 0);

    // Merge evidence from successful children
    const successfulResults = childResults
      .filter((r) => r.success && r.result)
      .map((r) => r.result!);
    const evidenceRefs = this.mergeEvidenceRefs(successfulResults);

    // Add composite-level evidence
    this.addEvidence(evidenceRefs, `composite:${successCount}/${childResults.length}_succeeded`);

    // Record prediction
    const predictionId = this.recordPrediction(
      `Composite: ${successCount}/${childResults.length} children succeeded`,
      confidence,
      {
        childCount: childResults.length,
        successCount,
        failureCount,
        totalChildTimeMs,
      }
    );

    return {
      childResults,
      successCount,
      failureCount,
      totalChildTimeMs,
      confidence,
      evidenceRefs,
      analysisTimeMs,
      predictionId,
    };
  }
}
