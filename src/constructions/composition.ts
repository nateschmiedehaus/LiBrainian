/**
 * @fileoverview Composition Framework for Building Construction Pipelines
 *
 * Provides composition operators and decorators for combining constructions:
 * - Sequence: Execute constructions in order (output feeds into next)
 * - Parallel: Execute constructions simultaneously on same input
 * - Conditional: Choose between constructions based on predicate
 * - Decorators: Add retry, timeout, caching, and tracing
 *
 * All compositions properly propagate confidence according to epistemic rules:
 * - D2: Sequential = min(steps) - weakest link determines overall confidence
 * - D3: Parallel-All = product(branches) - all must succeed
 * - D4: Parallel-Any = 1 - product(1-branches) - any can succeed
 *
 * @packageDocumentation
 */

import type { ConfidenceValue } from '../epistemics/confidence.js';
import {
  getNumericValue,
  sequenceConfidence,
  parallelAllConfidence,
  parallelAnyConfidence,
  absent,
  deterministic,
  computeCalibrationStatus,
} from '../epistemics/confidence.js';
import type {
  ConstructionResult,
  ConstructionContext,
} from './base/construction_base.js';
import {
  ConstructionError,
  ConstructionTimeoutError,
} from './base/construction_base.js';
import type { Construction } from './types.js';

// ============================================================================
// COMPOSABLE CONSTRUCTION INTERFACE
// ============================================================================

/**
 * @deprecated Use {@link Construction} from `./types` directly.
 */
export type ComposableConstruction<TInput, TOutput extends ConstructionResult> =
  Construction<TInput, TOutput, ConstructionError, unknown>;

// ============================================================================
// CONFIGURATION TYPES
// ============================================================================

/**
 * Configuration for retry behavior.
 */
export interface RetryConfig {
  /** Maximum number of retry attempts */
  maxAttempts: number;
  /** Base delay between retries in milliseconds */
  baseDelayMs: number;
  /** Maximum delay between retries in milliseconds */
  maxDelayMs?: number;
  /** Exponential backoff factor (default: 2) */
  backoffFactor?: number;
  /** Predicate to determine if error is retryable */
  isRetryable?: (error: Error) => boolean;
}

/**
 * Configuration for caching behavior.
 */
export interface CacheConfig {
  /** Time-to-live in milliseconds */
  ttlMs: number;
  /** Maximum number of cached entries */
  maxEntries?: number;
  /** Function to generate cache key from input */
  keyGenerator?: (input: unknown) => string;
}

/**
 * Tracer interface for construction tracing.
 */
export interface Tracer {
  /** Start a new span */
  startSpan(name: string, options?: { parentId?: string; attributes?: Record<string, unknown> }): string;
  /** End a span */
  endSpan(spanId: string): void;
  /** Add an event to a span */
  addEvent(spanId: string, name: string, attributes?: Record<string, unknown>): void;
  /** Set attributes on a span */
  setAttribute(spanId: string, key: string, value: unknown): void;
}

// ============================================================================
// CONFIDENCE PROPAGATION (D2-D4)
// ============================================================================

/**
 * D2: Propagate confidence through sequential composition.
 * Result confidence is the minimum of all step confidences (weakest link).
 *
 * @param confidences - Array of confidence values from each step
 * @returns Combined confidence value
 */
export function propagateSequential(confidences: ConfidenceValue[]): ConfidenceValue {
  if (confidences.length === 0) {
    return absent('insufficient_data');
  }
  return sequenceConfidence(confidences);
}

/**
 * D3: Propagate confidence through parallel-all composition.
 * Result confidence is the product of all branch confidences (all must succeed).
 *
 * @param confidences - Array of confidence values from each branch
 * @returns Combined confidence value
 */
export function propagateParallelAll(confidences: ConfidenceValue[]): ConfidenceValue {
  if (confidences.length === 0) {
    return absent('insufficient_data');
  }
  return parallelAllConfidence(confidences);
}

/**
 * D4: Propagate confidence through parallel-any composition.
 * Result confidence is 1 - product(1 - c) (any can succeed).
 *
 * @param confidences - Array of confidence values from each branch
 * @returns Combined confidence value
 */
export function propagateParallelAny(confidences: ConfidenceValue[]): ConfidenceValue {
  if (confidences.length === 0) {
    return absent('insufficient_data');
  }
  return parallelAnyConfidence(confidences);
}

/**
 * Propagate confidence using a custom derivation formula.
 *
 * @param inputs - Array of input confidence values
 * @param formula - Formula string (e.g., 'weighted_average', 'max', 'custom')
 * @returns Derived confidence value
 */
export function propagateDerived(
  inputs: ConfidenceValue[],
  formula: string
): ConfidenceValue {
  if (inputs.length === 0) {
    return absent('insufficient_data');
  }

  const values = inputs.map(getNumericValue);
  const presentValues = values.filter((v): v is number => v !== null);

  if (presentValues.length === 0) {
    return absent('uncalibrated');
  }

  let computedValue: number;

  switch (formula) {
    case 'min':
      computedValue = Math.min(...presentValues);
      break;
    case 'max':
      computedValue = Math.max(...presentValues);
      break;
    case 'average':
      computedValue = presentValues.reduce((a, b) => a + b, 0) / presentValues.length;
      break;
    case 'product':
      computedValue = presentValues.reduce((a, b) => a * b, 1);
      break;
    case 'noisy_or':
      computedValue = 1 - presentValues.map(v => 1 - v).reduce((a, b) => a * b, 1);
      break;
    default:
      // For unknown formulas, use conservative min
      computedValue = Math.min(...presentValues);
  }

  const calibrationStatus = computeCalibrationStatus(inputs);

  return {
    type: 'derived',
    value: Math.max(0, Math.min(1, computedValue)),
    formula,
    inputs: inputs.map((c, i) => ({ name: `input_${i}`, confidence: c })),
    calibrationStatus,
  };
}

// ============================================================================
// COMPOSITION OPERATORS
// ============================================================================

/**
 * Compose constructions in sequence (output of one feeds into next).
 *
 * @param first - First construction to execute
 * @param second - Second construction that receives first's output
 * @returns A new construction that executes both in sequence
 */
export function sequence<T1, T2 extends ConstructionResult, T3 extends ConstructionResult>(
  first: ComposableConstruction<T1, T2>,
  second: ComposableConstruction<T2, T3>
): SequenceConstruction<T1, T3> {
  return new SequenceConstruction(first, second);
}

/**
 * Run constructions in parallel on same input.
 *
 * @param constructions - Array of constructions to run in parallel
 * @returns A new construction that executes all in parallel
 */
export function parallel<TInput, TOutputs extends ConstructionResult[]>(
  constructions: ComposableConstruction<TInput, TOutputs[number]>[]
): ParallelConstruction<TInput, TOutputs> {
  return new ParallelConstruction(constructions);
}

/**
 * Conditional execution based on predicate.
 *
 * @param predicate - Function that determines which branch to take
 * @param ifTrue - Construction to execute if predicate returns true
 * @param ifFalse - Construction to execute if predicate returns false
 * @returns A new construction that conditionally executes
 */
export function conditional<TInput, TOutput extends ConstructionResult>(
  predicate: (input: TInput) => boolean | Promise<boolean>,
  ifTrue: ComposableConstruction<TInput, TOutput>,
  ifFalse: ComposableConstruction<TInput, TOutput>
): ConditionalConstruction<TInput, TOutput> {
  return new ConditionalConstruction(predicate, ifTrue, ifFalse);
}

// ============================================================================
// DECORATORS
// ============================================================================

/**
 * Add retry logic to a construction.
 *
 * @param construction - The construction to wrap with retry logic
 * @param config - Retry configuration
 * @returns A new construction with retry capability
 */
export function withRetry<TInput, TOutput extends ConstructionResult>(
  construction: ComposableConstruction<TInput, TOutput>,
  config: RetryConfig
): RetryConstruction<TInput, TOutput> {
  return new RetryConstruction(construction, config);
}

/**
 * Add timeout to a construction.
 *
 * @param construction - The construction to wrap with timeout
 * @param timeoutMs - Timeout in milliseconds
 * @returns A new construction with timeout capability
 */
export function withTimeout<TInput, TOutput extends ConstructionResult>(
  construction: ComposableConstruction<TInput, TOutput>,
  timeoutMs: number
): TimeoutConstruction<TInput, TOutput> {
  return new TimeoutConstruction(construction, timeoutMs);
}

/**
 * Add caching to a construction.
 *
 * @param construction - The construction to wrap with caching
 * @param config - Cache configuration
 * @returns A new construction with caching capability
 */
export function withCache<TInput, TOutput extends ConstructionResult>(
  construction: ComposableConstruction<TInput, TOutput>,
  config: CacheConfig
): CachedConstruction<TInput, TOutput> {
  return new CachedConstruction(construction, config);
}

/**
 * Add logging/tracing to a construction.
 *
 * @param construction - The construction to wrap with tracing
 * @param tracer - The tracer to use
 * @returns A new construction with tracing capability
 */
export function withTracing<TInput, TOutput extends ConstructionResult>(
  construction: ComposableConstruction<TInput, TOutput>,
  tracer: Tracer
): TracedConstruction<TInput, TOutput> {
  return new TracedConstruction(construction, tracer);
}

// ============================================================================
// SEQUENCE CONSTRUCTION
// ============================================================================

/**
 * A construction that executes two constructions in sequence.
 * The output of the first construction feeds into the second.
 */
export class SequenceConstruction<TInput, TOutput extends ConstructionResult>
  implements ComposableConstruction<TInput, TOutput>
{
  public readonly id: string;
  public readonly name: string;

  constructor(
    private readonly first: ComposableConstruction<TInput, ConstructionResult>,
    private readonly second: ComposableConstruction<ConstructionResult, TOutput>
  ) {
    this.id = `sequence:${first.id}>${second.id}`;
    this.name = `Sequence(${first.name}, ${second.name})`;
  }

  async execute(input: TInput): Promise<TOutput> {
    const startTime = Date.now();
    const evidenceRefs: string[] = [];

    // Execute first construction
    const firstResult = await this.first.execute(input);
    evidenceRefs.push(...firstResult.evidenceRefs);
    evidenceRefs.push(`sequence:step_1:${this.first.id}`);

    // Execute second construction with first's output
    const secondResult = await this.second.execute(firstResult);
    evidenceRefs.push(...secondResult.evidenceRefs);
    evidenceRefs.push(`sequence:step_2:${this.second.id}`);

    // Propagate confidence using D2 (sequential = min)
    const propagatedConfidence = propagateSequential([
      firstResult.confidence,
      secondResult.confidence,
    ]);

    return {
      ...secondResult,
      confidence: propagatedConfidence,
      evidenceRefs,
      analysisTimeMs: Date.now() - startTime,
    };
  }

  getEstimatedConfidence(): ConfidenceValue {
    const firstEstimate = this.first.getEstimatedConfidence?.() ?? absent('uncalibrated');
    const secondEstimate = this.second.getEstimatedConfidence?.() ?? absent('uncalibrated');
    return propagateSequential([firstEstimate, secondEstimate]);
  }
}

// ============================================================================
// PARALLEL CONSTRUCTION
// ============================================================================

/**
 * Result of a parallel construction execution.
 */
export interface ParallelResult<TOutputs extends ConstructionResult[]> extends ConstructionResult {
  /** Results from each parallel branch */
  readonly results: TOutputs;
  /** Individual confidences from each branch */
  readonly branchConfidences: ConfidenceValue[];
}

/**
 * A construction that executes multiple constructions in parallel on the same input.
 */
export class ParallelConstruction<TInput, TOutputs extends ConstructionResult[]>
  implements ComposableConstruction<TInput, ParallelResult<TOutputs>>
{
  public readonly id: string;
  public readonly name: string;

  constructor(
    private readonly constructions: ComposableConstruction<TInput, TOutputs[number]>[],
    private readonly propagationMode: 'all' | 'any' = 'all'
  ) {
    this.id = `parallel:${constructions.map(c => c.id).join('|')}`;
    this.name = `Parallel(${constructions.map(c => c.name).join(', ')})`;
  }

  async execute(input: TInput): Promise<ParallelResult<TOutputs>> {
    const startTime = Date.now();
    const evidenceRefs: string[] = [];

    // Execute all constructions in parallel
    const resultPromises = this.constructions.map(async (construction, index) => {
      const result = await construction.execute(input);
      evidenceRefs.push(`parallel:branch_${index}:${construction.id}`);
      return result;
    });

    const results = await Promise.all(resultPromises);

    // Collect evidence from all results
    for (const result of results) {
      evidenceRefs.push(...result.evidenceRefs);
    }

    // Extract confidences from results
    const branchConfidences = results.map(r => r.confidence);

    // Propagate confidence based on mode
    const propagatedConfidence = this.propagationMode === 'all'
      ? propagateParallelAll(branchConfidences)
      : propagateParallelAny(branchConfidences);

    return {
      results: results as unknown as TOutputs,
      branchConfidences,
      confidence: propagatedConfidence,
      evidenceRefs,
      analysisTimeMs: Date.now() - startTime,
    };
  }

  getEstimatedConfidence(): ConfidenceValue {
    const estimates = this.constructions.map(
      c => c.getEstimatedConfidence?.() ?? absent('uncalibrated')
    );
    return this.propagationMode === 'all'
      ? propagateParallelAll(estimates)
      : propagateParallelAny(estimates);
  }
}

// ============================================================================
// CONDITIONAL CONSTRUCTION
// ============================================================================

/**
 * Result of a conditional construction execution.
 */
export interface ConditionalResult<TOutput extends ConstructionResult> extends ConstructionResult {
  /** The actual result from the executed branch */
  readonly result: TOutput;
  /** Which branch was taken */
  readonly branchTaken: 'true' | 'false';
}

/**
 * A construction that conditionally executes one of two constructions based on a predicate.
 */
export class ConditionalConstruction<TInput, TOutput extends ConstructionResult>
  implements ComposableConstruction<TInput, ConditionalResult<TOutput>>
{
  public readonly id: string;
  public readonly name: string;

  constructor(
    private readonly predicate: (input: TInput) => boolean | Promise<boolean>,
    private readonly ifTrue: ComposableConstruction<TInput, TOutput>,
    private readonly ifFalse: ComposableConstruction<TInput, TOutput>
  ) {
    this.id = `conditional:${ifTrue.id}|${ifFalse.id}`;
    this.name = `Conditional(${ifTrue.name}, ${ifFalse.name})`;
  }

  async execute(input: TInput): Promise<ConditionalResult<TOutput>> {
    const startTime = Date.now();
    const evidenceRefs: string[] = [];

    // Evaluate predicate
    const predicateResult = await this.predicate(input);
    evidenceRefs.push(`conditional:predicate:${predicateResult}`);

    // Execute appropriate branch
    const branchTaken: 'true' | 'false' = predicateResult ? 'true' : 'false';
    const construction = predicateResult ? this.ifTrue : this.ifFalse;

    const result = await construction.execute(input);
    evidenceRefs.push(...result.evidenceRefs);
    evidenceRefs.push(`conditional:branch_${branchTaken}:${construction.id}`);

    // For conditional, confidence is the branch confidence
    // (the decision itself is deterministic)
    return {
      result,
      branchTaken,
      confidence: result.confidence,
      evidenceRefs,
      analysisTimeMs: Date.now() - startTime,
    };
  }

  getEstimatedConfidence(): ConfidenceValue {
    // For conditional, we use max of both branches as estimate
    // (we don't know which will be taken)
    const trueEstimate = this.ifTrue.getEstimatedConfidence?.() ?? absent('uncalibrated');
    const falseEstimate = this.ifFalse.getEstimatedConfidence?.() ?? absent('uncalibrated');
    return propagateDerived([trueEstimate, falseEstimate], 'max');
  }
}

// ============================================================================
// RETRY CONSTRUCTION
// ============================================================================

/**
 * Result of a retry construction execution.
 */
export interface RetryResult<TOutput extends ConstructionResult> extends ConstructionResult {
  /** The successful result */
  readonly result: TOutput;
  /** Number of attempts made */
  readonly attempts: number;
  /** Errors from failed attempts */
  readonly errors: Error[];
}

/**
 * A construction that retries on failure.
 */
export class RetryConstruction<TInput, TOutput extends ConstructionResult>
  implements ComposableConstruction<TInput, RetryResult<TOutput>>
{
  public readonly id: string;
  public readonly name: string;

  constructor(
    private readonly construction: ComposableConstruction<TInput, TOutput>,
    private readonly config: RetryConfig
  ) {
    this.id = `retry:${construction.id}`;
    this.name = `Retry(${construction.name}, max=${config.maxAttempts})`;
  }

  async execute(input: TInput): Promise<RetryResult<TOutput>> {
    const startTime = Date.now();
    const evidenceRefs: string[] = [];
    const errors: Error[] = [];
    let attempts = 0;

    const isRetryable = this.config.isRetryable ?? (() => true);
    const backoffFactor = this.config.backoffFactor ?? 2;
    const maxDelayMs = this.config.maxDelayMs ?? this.config.baseDelayMs * 10;

    while (attempts < this.config.maxAttempts) {
      attempts++;
      evidenceRefs.push(`retry:attempt_${attempts}`);

      try {
        const result = await this.construction.execute(input);
        evidenceRefs.push(...result.evidenceRefs);

        // Success - return the result
        return {
          result,
          attempts,
          errors,
          confidence: result.confidence,
          evidenceRefs,
          analysisTimeMs: Date.now() - startTime,
        };
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        errors.push(err);
        evidenceRefs.push(`retry:error:${err.message.substring(0, 50)}`);

        if (!isRetryable(err) || attempts >= this.config.maxAttempts) {
          throw new ConstructionError(
            `Retry failed after ${attempts} attempts: ${err.message}`,
            this.id,
            err
          );
        }

        // Calculate delay with exponential backoff
        const delay = Math.min(
          this.config.baseDelayMs * Math.pow(backoffFactor, attempts - 1),
          maxDelayMs
        );

        await sleep(delay);
      }
    }

    // Should not reach here, but TypeScript needs this
    throw new ConstructionError(
      `Retry exhausted all ${this.config.maxAttempts} attempts`,
      this.id
    );
  }

  getEstimatedConfidence(): ConfidenceValue {
    // Retrying can improve confidence over a single attempt
    // Use the underlying construction's estimate
    return this.construction.getEstimatedConfidence?.() ?? absent('uncalibrated');
  }
}

// ============================================================================
// TIMEOUT CONSTRUCTION
// ============================================================================

/**
 * A construction that times out after a specified duration.
 */
export class TimeoutConstruction<TInput, TOutput extends ConstructionResult>
  implements ComposableConstruction<TInput, TOutput>
{
  public readonly id: string;
  public readonly name: string;

  constructor(
    private readonly construction: ComposableConstruction<TInput, TOutput>,
    private readonly timeoutMs: number
  ) {
    this.id = `timeout:${construction.id}`;
    this.name = `Timeout(${construction.name}, ${timeoutMs}ms)`;
  }

  async execute(input: TInput): Promise<TOutput> {
    const startTime = Date.now();

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new ConstructionTimeoutError(this.id, this.timeoutMs));
      }, this.timeoutMs);
    });

    try {
      const result = await Promise.race([
        this.construction.execute(input),
        timeoutPromise,
      ]);

      return {
        ...result,
        analysisTimeMs: Date.now() - startTime,
      };
    } catch (error) {
      if (error instanceof ConstructionTimeoutError) {
        throw error;
      }
      throw new ConstructionError(
        `Construction failed: ${error instanceof Error ? error.message : String(error)}`,
        this.id,
        error instanceof Error ? error : undefined
      );
    }
  }

  getEstimatedConfidence(): ConfidenceValue {
    return this.construction.getEstimatedConfidence?.() ?? absent('uncalibrated');
  }
}

// ============================================================================
// CACHED CONSTRUCTION
// ============================================================================

/**
 * Cache entry structure.
 */
interface CacheEntry<TOutput> {
  result: TOutput;
  timestamp: number;
}

/**
 * A construction that caches results.
 */
export class CachedConstruction<TInput, TOutput extends ConstructionResult>
  implements ComposableConstruction<TInput, TOutput>
{
  public readonly id: string;
  public readonly name: string;

  private readonly cache: Map<string, CacheEntry<TOutput>> = new Map();
  private readonly keyGenerator: (input: TInput) => string;

  constructor(
    private readonly construction: ComposableConstruction<TInput, TOutput>,
    private readonly config: CacheConfig
  ) {
    this.id = `cached:${construction.id}`;
    this.name = `Cached(${construction.name}, ttl=${config.ttlMs}ms)`;
    this.keyGenerator = (config.keyGenerator as (input: TInput) => string) ??
      ((input: TInput) => JSON.stringify(input));
  }

  async execute(input: TInput): Promise<TOutput> {
    const startTime = Date.now();
    const key = this.keyGenerator(input);
    const now = Date.now();

    // Check cache
    const cached = this.cache.get(key);
    if (cached && (now - cached.timestamp) < this.config.ttlMs) {
      return {
        ...cached.result,
        evidenceRefs: [...cached.result.evidenceRefs, `cache:hit:${key.substring(0, 20)}`],
        analysisTimeMs: Date.now() - startTime,
      };
    }

    // Execute and cache
    const result = await this.construction.execute(input);

    // Enforce max entries
    if (this.config.maxEntries && this.cache.size >= this.config.maxEntries) {
      // Remove oldest entry
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(key, { result, timestamp: now });

    return {
      ...result,
      evidenceRefs: [...result.evidenceRefs, `cache:miss:${key.substring(0, 20)}`],
      analysisTimeMs: Date.now() - startTime,
    };
  }

  /**
   * Clear the cache.
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics.
   */
  getCacheStats(): { size: number; maxEntries: number | undefined; ttlMs: number } {
    return {
      size: this.cache.size,
      maxEntries: this.config.maxEntries,
      ttlMs: this.config.ttlMs,
    };
  }

  getEstimatedConfidence(): ConfidenceValue {
    return this.construction.getEstimatedConfidence?.() ?? absent('uncalibrated');
  }
}

// ============================================================================
// TRACED CONSTRUCTION
// ============================================================================

/**
 * A construction that adds tracing/logging.
 */
export class TracedConstruction<TInput, TOutput extends ConstructionResult>
  implements ComposableConstruction<TInput, TOutput>
{
  public readonly id: string;
  public readonly name: string;

  constructor(
    private readonly construction: ComposableConstruction<TInput, TOutput>,
    private readonly tracer: Tracer
  ) {
    this.id = `traced:${construction.id}`;
    this.name = `Traced(${construction.name})`;
  }

  async execute(input: TInput): Promise<TOutput> {
    const spanId = this.tracer.startSpan(this.construction.name, {
      attributes: {
        constructionId: this.construction.id,
        inputType: typeof input,
      },
    });

    try {
      this.tracer.addEvent(spanId, 'execution_started', {
        timestamp: Date.now(),
      });

      const result = await this.construction.execute(input);

      this.tracer.addEvent(spanId, 'execution_completed', {
        timestamp: Date.now(),
        confidenceType: result.confidence.type,
        confidenceValue: getNumericValue(result.confidence),
        evidenceCount: result.evidenceRefs.length,
      });

      this.tracer.setAttribute(spanId, 'status', 'success');
      this.tracer.setAttribute(spanId, 'analysisTimeMs', result.analysisTimeMs);

      return {
        ...result,
        evidenceRefs: [...result.evidenceRefs, `trace:${spanId}`],
      };
    } catch (error) {
      this.tracer.addEvent(spanId, 'execution_failed', {
        timestamp: Date.now(),
        error: error instanceof Error ? error.message : String(error),
      });

      this.tracer.setAttribute(spanId, 'status', 'error');
      this.tracer.setAttribute(spanId, 'error', error instanceof Error ? error.message : String(error));

      throw error;
    } finally {
      this.tracer.endSpan(spanId);
    }
  }

  getEstimatedConfidence(): ConfidenceValue {
    return this.construction.getEstimatedConfidence?.() ?? absent('uncalibrated');
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Sleep for a specified duration.
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Create a simple composable construction from a function.
 *
 * @param id - Unique identifier for the construction
 * @param name - Human-readable name
 * @param executor - Function that executes the construction logic
 * @returns A ComposableConstruction instance
 */
export function createConstruction<TInput, TData>(
  id: string,
  name: string,
  executor: (input: TInput) => Promise<{ data: TData; confidence: ConfidenceValue; evidenceRefs?: string[] }>
): ComposableConstruction<TInput, ConstructionResult & { data: TData }> {
  return {
    id,
    name,
    async execute(input: TInput): Promise<ConstructionResult & { data: TData }> {
      const startTime = Date.now();
      const result = await executor(input);
      return {
        data: result.data,
        confidence: result.confidence,
        evidenceRefs: result.evidenceRefs ?? [],
        analysisTimeMs: Date.now() - startTime,
      };
    },
  };
}

/**
 * Create a deterministic construction that always succeeds.
 *
 * @param id - Unique identifier for the construction
 * @param name - Human-readable name
 * @param transform - Synchronous transform function
 * @returns A ComposableConstruction instance with deterministic confidence
 */
export function createDeterministicConstruction<TInput, TData>(
  id: string,
  name: string,
  transform: (input: TInput) => TData
): ComposableConstruction<TInput, ConstructionResult & { data: TData }> {
  return createConstruction(id, name, async (input: TInput) => ({
    data: transform(input),
    confidence: deterministic(true, 'deterministic_transform'),
  }));
}

/**
 * Wrap a construction result as a composable construction.
 * Useful for creating identity constructions or constants.
 *
 * @param id - Unique identifier
 * @param name - Human-readable name
 * @param result - The constant result to return
 * @returns A ComposableConstruction that always returns the same result
 */
export function constant<TInput, TOutput extends ConstructionResult>(
  id: string,
  name: string,
  result: TOutput
): ComposableConstruction<TInput, TOutput> {
  return {
    id,
    name,
    async execute(_input: TInput): Promise<TOutput> {
      return result;
    },
    getEstimatedConfidence(): ConfidenceValue {
      return result.confidence;
    },
  };
}

// ============================================================================
// PIPELINE BUILDER
// ============================================================================

/**
 * Fluent builder for construction pipelines.
 */
export class PipelineBuilder<TInput, TCurrent extends ConstructionResult> {
  private construction: ComposableConstruction<TInput, TCurrent>;

  constructor(initial: ComposableConstruction<TInput, TCurrent>) {
    this.construction = initial;
  }

  /**
   * Add a step to the pipeline.
   */
  then<TNext extends ConstructionResult>(
    next: ComposableConstruction<TCurrent, TNext>
  ): PipelineBuilder<TInput, TNext> {
    const sequenced = new SequenceConstruction(this.construction, next);
    return new PipelineBuilder(sequenced as unknown as ComposableConstruction<TInput, TNext>);
  }

  /**
   * Add retry to the current pipeline.
   */
  withRetry(config: RetryConfig): PipelineBuilder<TInput, RetryResult<TCurrent>> {
    const retried = new RetryConstruction(this.construction, config);
    return new PipelineBuilder(retried);
  }

  /**
   * Add timeout to the current pipeline.
   */
  withTimeout(timeoutMs: number): PipelineBuilder<TInput, TCurrent> {
    const timed = new TimeoutConstruction(this.construction, timeoutMs);
    return new PipelineBuilder(timed);
  }

  /**
   * Add caching to the current pipeline.
   */
  withCache(config: CacheConfig): PipelineBuilder<TInput, TCurrent> {
    const cached = new CachedConstruction(this.construction, config);
    return new PipelineBuilder(cached);
  }

  /**
   * Add tracing to the current pipeline.
   */
  withTracing(tracer: Tracer): PipelineBuilder<TInput, TCurrent> {
    const traced = new TracedConstruction(this.construction, tracer);
    return new PipelineBuilder(traced);
  }

  /**
   * Build the final construction.
   */
  build(): ComposableConstruction<TInput, TCurrent> {
    return this.construction;
  }
}

/**
 * Start building a pipeline.
 */
export function pipeline<TInput, TOutput extends ConstructionResult>(
  initial: ComposableConstruction<TInput, TOutput>
): PipelineBuilder<TInput, TOutput> {
  return new PipelineBuilder(initial);
}

// ============================================================================
// PARALLEL BUILDER
// ============================================================================

/**
 * Builder for parallel constructions with configurable propagation.
 */
export class ParallelBuilder<TInput, TOutputs extends ConstructionResult[]> {
  constructor(
    private readonly constructions: ComposableConstruction<TInput, TOutputs[number]>[],
    private propagationMode: 'all' | 'any' = 'all'
  ) {}

  /**
   * Use parallel-all propagation (all must succeed).
   */
  requireAll(): ParallelBuilder<TInput, TOutputs> {
    this.propagationMode = 'all';
    return this;
  }

  /**
   * Use parallel-any propagation (any can succeed).
   */
  requireAny(): ParallelBuilder<TInput, TOutputs> {
    this.propagationMode = 'any';
    return this;
  }

  /**
   * Build the parallel construction.
   */
  build(): ParallelConstruction<TInput, TOutputs> {
    return new ParallelConstruction(this.constructions, this.propagationMode);
  }
}

/**
 * Start building a parallel construction.
 */
export function parallelBuilder<TInput, TOutputs extends ConstructionResult[]>(
  constructions: ComposableConstruction<TInput, TOutputs[number]>[]
): ParallelBuilder<TInput, TOutputs> {
  return new ParallelBuilder(constructions);
}

// ============================================================================
// RE-EXPORTS
// ============================================================================

// Re-export types from base for convenience
export type {
  ConstructionResult,
  ConstructionContext,
} from './base/construction_base.js';

export {
  ConstructionError,
  ConstructionTimeoutError,
  ConstructionCancelledError,
} from './base/construction_base.js';
