/**
 * @fileoverview Core Base Class for All Constructions
 *
 * Provides the foundational abstract class that all constructions extend.
 * This base class enforces common patterns for:
 * - Confidence tracking and calibration
 * - Evidence collection
 * - Timing metrics
 * - Prediction recording for calibration
 *
 * PHILOSOPHICAL ALIGNMENT (UNDERSTANDING_LAYER.md):
 * All constructions produce verifiable outputs with traceable confidence.
 * This base class ensures consistent epistemic properties across all constructions.
 *
 * @packageDocumentation
 */

import type { Librarian } from '../../api/librarian.js';
import type { ConfidenceValue } from '../../epistemics/confidence.js';
import {
  sequenceConfidence,
  parallelAllConfidence,
  getNumericValue,
} from '../../epistemics/confidence.js';
import { createEvidenceId, type EvidenceId } from '../../epistemics/evidence_ledger.js';
import type { ConstructionCalibrationTracker } from '../calibration_tracker.js';
import { generatePredictionId } from '../calibration_tracker.js';
import { fail, ok } from '../types.js';
import type { Construction, Context } from '../types.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Base result interface for all construction outputs.
 *
 * Every construction must produce a result that includes:
 * - confidence: Principled confidence value with provenance
 * - evidenceRefs: Trail of evidence supporting the result
 * - analysisTimeMs: Performance metric for the analysis
 * - predictionId: Optional ID for calibration tracking
 */
export interface ConstructionResult {
  /** Confidence in this result with mandatory provenance */
  confidence: ConfidenceValue;
  /** Evidence trail supporting this result */
  evidenceRefs: EvidenceId[];
  /** Time taken to produce this result in milliseconds */
  analysisTimeMs: number;
  /** Optional prediction ID for calibration tracking */
  predictionId?: string;
}

export function toEvidenceIds(refs: readonly (EvidenceId | string)[]): EvidenceId[] {
  return refs.map((ref) => createEvidenceId(String(ref)));
}

/**
 * Options for construction execution.
 */
export interface ConstructionExecutionOptions {
  /** Whether to record prediction for calibration tracking */
  recordPrediction?: boolean;
  /** Custom prediction claim (if not provided, uses default) */
  predictionClaim?: string;
  /** Additional context for prediction */
  predictionContext?: Record<string, unknown>;
}

/**
 * Context passed through construction execution.
 * Carries tracing, cancellation, and metadata.
 */
export interface ConstructionContext {
  /** Unique ID for this execution */
  readonly executionId: string;
  /** Parent span ID for tracing */
  readonly parentSpanId?: string;
  /** Cancellation signal */
  readonly signal?: AbortSignal;
  /** Additional metadata */
  readonly metadata?: Record<string, unknown>;
}

/**
 * Metadata about a construction for debugging and monitoring.
 */
export interface ConstructionMetadata {
  /** When this construction was created */
  readonly createdAt: Date;
  /** Version of the construction */
  readonly version?: string;
  /** Tags for categorization */
  readonly tags?: readonly string[];
  /** Description of what this construction does */
  readonly description?: string;
}

// ============================================================================
// ERROR TYPES
// ============================================================================

/**
 * Error thrown when a construction fails.
 */
export class ConstructionError extends Error {
  readonly kind: string = 'construction_error';
  readonly retriable: boolean = false;

  constructor(
    message: string,
    public readonly constructionId: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'ConstructionError';
  }
}

/**
 * Error thrown when a construction times out.
 */
export class ConstructionTimeoutError extends ConstructionError {
  readonly kind = 'timeout';
  readonly retriable = true;

  constructor(
    constructionId: string,
    public readonly timeoutMs: number
  ) {
    super(`Construction ${constructionId} timed out after ${timeoutMs}ms`, constructionId);
    this.name = 'ConstructionTimeoutError';
  }
}

/**
 * Error thrown when a construction is cancelled.
 */
export class ConstructionCancelledError extends ConstructionError {
  readonly kind = 'cancelled';
  readonly retriable = false;

  constructor(constructionId: string) {
    super(`Construction ${constructionId} was cancelled`, constructionId);
    this.name = 'ConstructionCancelledError';
  }
}

/**
 * Error thrown when construction input validation fails.
 */
export class ConstructionInputError extends ConstructionError {
  readonly kind = 'input_error';
  readonly retriable = false;

  constructor(
    message: string,
    public readonly fieldPath?: string,
    constructionId: string = 'input_validation'
  ) {
    super(message, constructionId);
    this.name = 'ConstructionInputError';
  }
}

/**
 * Error thrown when required capabilities are unavailable.
 */
export class ConstructionCapabilityError extends ConstructionError {
  readonly kind = 'capability_missing';
  readonly retriable = false;

  constructor(
    public readonly requiredCapability: string,
    constructionId: string = 'capability_check'
  ) {
    super(`Missing required capability: ${requiredCapability}`, constructionId);
    this.name = 'ConstructionCapabilityError';
  }
}

/**
 * Error thrown when model/provider-backed construction execution fails.
 */
export class ConstructionLLMError extends ConstructionError {
  readonly kind = 'llm_error';
  readonly retriable = true;

  constructor(
    public readonly model: string,
    public readonly httpStatus?: number,
    constructionId: string = 'llm_execution'
  ) {
    super(
      `LLM call failed on model ${model}${httpStatus !== undefined ? ` (HTTP ${httpStatus})` : ''}`,
      constructionId
    );
    this.name = 'ConstructionLLMError';
  }
}

// ============================================================================
// BASE CONSTRUCTION CLASS
// ============================================================================

/**
 * Abstract base class for all constructions.
 *
 * Constructions are composed primitives that combine librarian capabilities
 * to solve higher-level problems while maintaining epistemic properties.
 *
 * Type Parameters:
 * - TInput: The input type for the construction's execute method
 * - TOutput: The output type, must extend ConstructionResult
 *
 * INVARIANT: All subclasses must implement execute() and CONSTRUCTION_ID
 * INVARIANT: All outputs must include valid ConfidenceValue with provenance
 *
 * @example
 * ```typescript
 * class MyConstruction extends BaseConstruction<MyInput, MyResult> {
 *   readonly CONSTRUCTION_ID = 'MyConstruction';
 *
 *   async execute(input: MyInput): Promise<MyResult> {
 *     const startTime = Date.now();
 *     const evidenceRefs: string[] = [];
 *
 *     // ... perform analysis ...
 *     this.addEvidence(evidenceRefs, 'step1:completed');
 *
 *     const confidence = this.computeConfidence(...);
 *     const predictionId = this.recordPrediction('My claim', confidence);
 *
 *     return {
 *       // ... result fields ...
 *       confidence,
 *       evidenceRefs,
 *       analysisTimeMs: Date.now() - startTime,
 *       predictionId,
 *     };
 *   }
 * }
 * ```
 */
export abstract class BaseConstruction<TInput, TOutput extends ConstructionResult> {
  /**
   * Unique identifier for this construction type.
   * Used for calibration tracking and logging.
   */
  abstract readonly CONSTRUCTION_ID: string;

  /** Librarian instance for querying the codebase */
  protected librarian: Librarian;

  /** Optional calibration tracker for recording predictions */
  protected calibrationTracker?: ConstructionCalibrationTracker;

  /**
   * Create a new construction instance.
   *
   * @param librarian - The librarian instance for codebase queries
   */
  constructor(librarian: Librarian) {
    this.librarian = librarian;
  }

  /**
   * Set the calibration tracker for this construction.
   *
   * When set, predictions will be recorded for calibration measurement.
   *
   * @param tracker - The calibration tracker to use
   */
  setCalibrationTracker(tracker: ConstructionCalibrationTracker): void {
    this.calibrationTracker = tracker;
  }

  /**
   * Get the construction ID for calibration tracking.
   *
   * @returns The construction's unique identifier
   */
  getConstructionId(): string {
    return this.CONSTRUCTION_ID;
  }

  /**
   * Execute the construction's primary operation.
   *
   * This is the main entry point for using a construction. Subclasses
   * must implement this method to perform their specific analysis.
   *
   * @param input - The input for the construction
   * @returns Promise resolving to the construction's result
   */
  abstract execute(input: TInput, context?: Context): Promise<TOutput>;

  /**
   * Bridge this base construction instance to the canonical construction interface.
   *
   * @param name - Human-readable construction name
   * @param description - Optional construction description
   * @returns Canonical construction adapter
   */
  toConstruction(name: string, description?: string): Construction<TInput, TOutput> {
    const constructionId = this.CONSTRUCTION_ID;
    return {
      id: constructionId,
      name,
      description,
      execute: async (input: TInput, context?: Context) => {
        if (context?.signal.aborted) {
          return fail<TOutput, ConstructionError>(
            new ConstructionCancelledError(constructionId),
            undefined,
            constructionId,
          );
        }
        try {
          const value = await this.execute(input, context);
          return ok<TOutput, ConstructionError>(value);
        } catch (error) {
          const normalized = error instanceof ConstructionError
            ? error
            : error instanceof Error
              ? new ConstructionError(error.message, constructionId, error)
              : new ConstructionError(`Non-error failure: ${String(error)}`, constructionId);
          return fail<TOutput, ConstructionError>(normalized, undefined, constructionId);
        }
      },
    };
  }

  /**
   * Record a prediction for calibration tracking.
   *
   * Predictions are tracked to measure calibration - whether stated
   * confidence matches actual accuracy over time.
   *
   * @param claim - The claim being made (e.g., "Refactoring is safe")
   * @param confidence - The confidence in this claim
   * @param context - Optional additional context
   * @returns The prediction ID (for later outcome recording)
   */
  protected recordPrediction(
    claim: string,
    confidence: ConfidenceValue,
    context?: Record<string, unknown>
  ): string {
    const predictionId = generatePredictionId(this.CONSTRUCTION_ID);

    if (this.calibrationTracker) {
      this.calibrationTracker.recordPrediction(
        this.CONSTRUCTION_ID,
        predictionId,
        confidence,
        claim,
        context
      );
    }

    return predictionId;
  }

  /**
   * Add an evidence reference to the evidence trail.
   *
   * Evidence references document the steps taken during analysis,
   * providing traceability for the result.
   *
   * @param refs - The array to add the reference to
   * @param ref - The evidence reference to add
   */
  protected addEvidence(refs: EvidenceId[], ref: string | EvidenceId): void {
    refs.push(createEvidenceId(String(ref)));
  }

  /**
   * Propagate confidence through a sequential pipeline.
   *
   * Uses D2 rule: sequential composition = min(steps)
   * The overall confidence is limited by the weakest link.
   *
   * @param results - Array of results from sequential steps
   * @returns The propagated confidence value
   */
  protected propagateConfidenceSequential(results: ConstructionResult[]): ConfidenceValue {
    const confidences = results.map((r) => r.confidence);
    return sequenceConfidence(confidences);
  }

  /**
   * Propagate confidence through parallel operations.
   *
   * Uses D3 rule: parallel-all composition = product(branches)
   * All branches must succeed for the overall operation to succeed.
   *
   * @param results - Array of results from parallel operations
   * @returns The propagated confidence value
   */
  protected propagateConfidenceParallel(results: ConstructionResult[]): ConfidenceValue {
    const confidences = results.map((r) => r.confidence);
    return parallelAllConfidence(confidences);
  }

  /**
   * Merge evidence references from multiple results.
   *
   * @param results - Array of results to merge evidence from
   * @returns Combined array of all evidence references
   */
  protected mergeEvidenceRefs(results: ConstructionResult[]): EvidenceId[] {
    return [...new Set(results.flatMap((r) => r.evidenceRefs))];
  }

  /**
   * Extract numeric value from confidence for threshold checks.
   *
   * @param confidence - The confidence value
   * @returns Numeric value or null if absent
   */
  protected getConfidenceValue(confidence: ConfidenceValue): number | null {
    return getNumericValue(confidence);
  }
}

// ============================================================================
// CALIBRATED CONSTRUCTION INTERFACE
// ============================================================================

/**
 * Interface for constructions that support calibration tracking.
 *
 * Constructions implementing this interface can have their predictions
 * tracked and verified for calibration measurement.
 */
export interface CalibratedConstruction {
  /** Get the construction ID for calibration tracking */
  getConstructionId(): string;
  /** Set the calibration tracker to use */
  setCalibrationTracker(tracker: ConstructionCalibrationTracker): void;
}
