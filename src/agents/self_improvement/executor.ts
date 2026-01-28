/**
 * @fileoverview SelfImprovementExecutor - Orchestrates Self-Improvement Operations
 *
 * WU-SELF-301: SelfImprovementExecutor implementation
 *
 * This executor provides:
 * - Orchestration of primitives and compositions
 * - Execution context and state management
 * - Error recovery and retries
 * - Event emission for monitoring
 * - Execution metrics tracking
 *
 * Based on self-improvement-primitives.md specification.
 */

import type { LibrarianStorage } from '../../storage/types.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Options for execution behavior.
 */
export interface ExecutionOptions {
  /** Maximum number of retry attempts on failure */
  maxRetries: number;
  /** Timeout in milliseconds for execution */
  timeoutMs: number;
  /** If true, validate but don't execute */
  dryRun: boolean;
  /** Enable verbose logging */
  verbose: boolean;
}

/**
 * Execution context passed to primitives and compositions.
 */
export interface ExecutionContext {
  /** Unique identifier for this execution */
  executionId: string;
  /** When execution started */
  startedAt: Date;
  /** Root directory for operations */
  rootDir: string;
  /** Execution options */
  options: ExecutionOptions;
  /** Mutable state for this execution */
  state: Map<string, unknown>;
}

/**
 * Result of executing a primitive or composition.
 */
export interface ExecutionResult<T> {
  /** Whether execution succeeded */
  success: boolean;
  /** Result value on success */
  result?: T;
  /** Error on failure */
  error?: Error;
  /** Duration in milliseconds */
  duration: number;
  /** Number of retries performed */
  retries: number;
}

/**
 * Metrics tracked by the executor.
 */
export interface ExecutorMetrics {
  /** Total number of executions */
  totalExecutions: number;
  /** Number of successful executions */
  successfulExecutions: number;
  /** Number of failed executions */
  failedExecutions: number;
  /** Total number of retries across all executions */
  totalRetries: number;
  /** Average execution duration in milliseconds */
  averageDurationMs: number;
  /** Number of primitive executions */
  primitiveExecutions: number;
  /** Number of composition executions */
  compositionExecutions: number;
}

/**
 * Entry in execution history.
 */
export interface ExecutionEntry {
  /** Unique execution identifier */
  executionId: string;
  /** Name of primitive or composition */
  name: string;
  /** Whether this was a primitive or composition */
  kind: 'primitive' | 'composition';
  /** Whether execution succeeded */
  success: boolean;
  /** When execution started */
  startedAt: Date;
  /** When execution completed */
  completedAt: Date;
  /** Duration in milliseconds */
  duration: number;
  /** Number of retries */
  retries: number;
  /** Input provided */
  input: unknown;
  /** Output produced (if successful) */
  output?: unknown;
  /** Error message (if failed) */
  error?: string;
}

/**
 * Event types emitted by the executor.
 */
export type ExecutorEventType =
  | 'execution_started'
  | 'execution_completed'
  | 'execution_failed'
  | 'execution_retry'
  | '*';

/**
 * Base event interface for executor events.
 */
export interface ExecutorEventBase {
  type: ExecutorEventType;
  executionId: string;
  name: string;
  timestamp: Date;
}

/**
 * Event emitted when execution starts.
 */
export interface ExecutionStartedEvent extends ExecutorEventBase {
  type: 'execution_started';
  kind: 'primitive' | 'composition';
  input: unknown;
}

/**
 * Event emitted when execution completes successfully.
 */
export interface ExecutionCompletedEvent extends ExecutorEventBase {
  type: 'execution_completed';
  success: true;
  duration: number;
  result: unknown;
}

/**
 * Event emitted when execution fails.
 */
export interface ExecutionFailedEvent extends ExecutorEventBase {
  type: 'execution_failed';
  error: string;
  duration: number;
  retries: number;
}

/**
 * Event emitted when execution is retried.
 */
export interface ExecutionRetryEvent extends ExecutorEventBase {
  type: 'execution_retry';
  attempt: number;
  error: string;
}

/**
 * Union of all executor events.
 */
export type ExecutorEvent =
  | ExecutionStartedEvent
  | ExecutionCompletedEvent
  | ExecutionFailedEvent
  | ExecutionRetryEvent;

/**
 * Handler function for executor events.
 */
export type ExecutorEventHandler = (event: ExecutorEvent) => void | Promise<void>;

/**
 * Signature for primitive functions.
 */
export type PrimitiveFunction<I = unknown, O = unknown> = (
  input: I,
  context: ExecutionContext
) => Promise<O>;

/**
 * Signature for composition functions.
 */
export type CompositionFunction<I = unknown, O = unknown> = (
  input: I,
  context: ExecutionContext
) => Promise<O>;

/**
 * Configuration for SelfImprovementExecutor.
 */
export interface SelfImprovementExecutorConfig {
  /** Root directory for operations */
  rootDir: string;
  /** Storage instance */
  storage: LibrarianStorage;
  /** Execution options */
  options?: Partial<ExecutionOptions>;
  /** Maximum history entries to keep */
  maxHistoryEntries?: number;
  /** Base retry delay in milliseconds (for testing) */
  retryDelayMs?: number;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_OPTIONS: ExecutionOptions = {
  maxRetries: 3,
  timeoutMs: 300000, // 5 minutes
  dryRun: false,
  verbose: false,
};

const DEFAULT_MAX_HISTORY_ENTRIES = 1000;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Generate a unique execution ID.
 */
function generateExecutionId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 11);
  return `exec_${timestamp}_${random}`;
}

/**
 * Create a timeout promise that rejects after the specified duration.
 */
function createTimeoutPromise(timeoutMs: number): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => {
      reject(new Error(`Execution timeout after ${timeoutMs}ms`));
    }, timeoutMs);
  });
}

/**
 * Sleep for the specified duration.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// SELF IMPROVEMENT EXECUTOR
// ============================================================================

/**
 * Executor for self-improvement primitives and compositions.
 *
 * Provides:
 * - Registration and execution of primitives and compositions
 * - Execution context management
 * - Retry logic with backoff
 * - Timeout handling
 * - Dry run mode
 * - Event emission for monitoring
 * - Metrics and history tracking
 */
export class SelfImprovementExecutor {
  private readonly rootDir: string;
  private readonly storage: LibrarianStorage;
  private readonly options: ExecutionOptions;
  private readonly maxHistoryEntries: number;
  private readonly retryDelayMs: number;

  private primitives = new Map<string, PrimitiveFunction>();
  private compositions = new Map<string, CompositionFunction>();
  private eventHandlers = new Map<ExecutorEventType, Set<ExecutorEventHandler>>();
  private history: ExecutionEntry[] = [];
  private metrics: ExecutorMetrics = {
    totalExecutions: 0,
    successfulExecutions: 0,
    failedExecutions: 0,
    totalRetries: 0,
    averageDurationMs: 0,
    primitiveExecutions: 0,
    compositionExecutions: 0,
  };
  private totalDuration = 0;

  constructor(config: SelfImprovementExecutorConfig) {
    // Validate required parameters
    if (!config.rootDir) {
      throw new Error('rootDir is required for SelfImprovementExecutor');
    }
    if (!config.storage) {
      throw new Error('storage is required for SelfImprovementExecutor');
    }

    this.rootDir = config.rootDir;
    this.storage = config.storage;
    this.options = { ...DEFAULT_OPTIONS, ...config.options };
    this.maxHistoryEntries = config.maxHistoryEntries ?? DEFAULT_MAX_HISTORY_ENTRIES;
    this.retryDelayMs = config.retryDelayMs ?? 1000; // Default 1 second base delay
  }

  // ============================================================================
  // PUBLIC API - Status
  // ============================================================================

  /**
   * Check if the executor is ready for use.
   */
  isReady(): boolean {
    return Boolean(this.rootDir && this.storage);
  }

  // ============================================================================
  // PUBLIC API - Registration
  // ============================================================================

  /**
   * Register a primitive function.
   */
  registerPrimitive<I = unknown, O = unknown>(
    name: string,
    fn: PrimitiveFunction<I, O>
  ): void {
    this.primitives.set(name, fn as PrimitiveFunction);
  }

  /**
   * Register a composition function.
   */
  registerComposition<I = unknown, O = unknown>(
    name: string,
    fn: CompositionFunction<I, O>
  ): void {
    this.compositions.set(name, fn as CompositionFunction);
  }

  /**
   * Check if a primitive is registered.
   */
  hasPrimitive(name: string): boolean {
    return this.primitives.has(name);
  }

  /**
   * Check if a composition is registered.
   */
  hasComposition(name: string): boolean {
    return this.compositions.has(name);
  }

  // ============================================================================
  // PUBLIC API - Execution
  // ============================================================================

  /**
   * Execute a registered primitive.
   */
  async executePrimitive<T = unknown>(
    name: string,
    input: unknown,
    overrideOptions?: Partial<ExecutionOptions>
  ): Promise<ExecutionResult<T>> {
    // Validate primitive exists
    if (!this.primitives.has(name)) {
      return {
        success: false,
        error: new Error(`Primitive '${name}' is not registered`),
        duration: 0,
        retries: 0,
      };
    }

    const options = { ...this.options, ...overrideOptions };

    // Handle dry run mode
    if (options.dryRun) {
      return this.executeDryRun<T>(name, 'primitive');
    }

    const primitive = this.primitives.get(name)!;
    return this.executeWithRetry<T>(name, 'primitive', primitive, input, options);
  }

  /**
   * Execute a registered composition.
   */
  async executeComposition<T = unknown>(
    name: string,
    input: unknown,
    overrideOptions?: Partial<ExecutionOptions>
  ): Promise<ExecutionResult<T>> {
    // Validate composition exists
    if (!this.compositions.has(name)) {
      return {
        success: false,
        error: new Error(`Composition '${name}' is not registered`),
        duration: 0,
        retries: 0,
      };
    }

    const options = { ...this.options, ...overrideOptions };

    // Handle dry run mode
    if (options.dryRun) {
      return this.executeDryRun<T>(name, 'composition');
    }

    const composition = this.compositions.get(name)!;
    return this.executeWithRetry<T>(name, 'composition', composition, input, options);
  }

  // ============================================================================
  // PUBLIC API - Events
  // ============================================================================

  /**
   * Subscribe to executor events.
   * Returns an unsubscribe function.
   */
  on(eventType: ExecutorEventType, handler: ExecutorEventHandler): () => void {
    if (!this.eventHandlers.has(eventType)) {
      this.eventHandlers.set(eventType, new Set());
    }
    this.eventHandlers.get(eventType)!.add(handler);

    return () => {
      this.eventHandlers.get(eventType)?.delete(handler);
    };
  }

  // ============================================================================
  // PUBLIC API - Metrics
  // ============================================================================

  /**
   * Get current metrics.
   */
  getMetrics(): ExecutorMetrics {
    return { ...this.metrics };
  }

  /**
   * Reset metrics to initial values.
   */
  resetMetrics(): void {
    this.metrics = {
      totalExecutions: 0,
      successfulExecutions: 0,
      failedExecutions: 0,
      totalRetries: 0,
      averageDurationMs: 0,
      primitiveExecutions: 0,
      compositionExecutions: 0,
    };
    this.totalDuration = 0;
  }

  // ============================================================================
  // PUBLIC API - History
  // ============================================================================

  /**
   * Get execution history.
   */
  getExecutionHistory(): ExecutionEntry[] {
    return [...this.history];
  }

  /**
   * Clear execution history.
   */
  clearHistory(): void {
    this.history = [];
  }

  // ============================================================================
  // PRIVATE - Execution
  // ============================================================================

  /**
   * Execute in dry run mode - validate without running.
   */
  private executeDryRun<T>(
    name: string,
    kind: 'primitive' | 'composition'
  ): ExecutionResult<T> {
    const dryRunResult = kind === 'primitive'
      ? { dryRun: true, primitiveName: name }
      : { dryRun: true, compositionName: name };

    return {
      success: true,
      result: dryRunResult as T,
      duration: 0,
      retries: 0,
    };
  }

  /**
   * Execute with retry logic.
   */
  private async executeWithRetry<T>(
    name: string,
    kind: 'primitive' | 'composition',
    fn: PrimitiveFunction | CompositionFunction,
    input: unknown,
    options: ExecutionOptions
  ): Promise<ExecutionResult<T>> {
    const executionId = generateExecutionId();
    const startedAt = new Date();
    let retries = 0;
    let lastError: Error | undefined;

    // Emit started event
    await this.emitEvent({
      type: 'execution_started',
      executionId,
      name,
      kind,
      input,
      timestamp: startedAt,
    });

    // Create execution context
    const context: ExecutionContext = {
      executionId,
      startedAt,
      rootDir: this.rootDir,
      options,
      state: new Map(),
    };

    // Attempt execution with retries
    for (let attempt = 0; attempt <= options.maxRetries; attempt++) {
      try {
        // Execute with timeout
        const result = await Promise.race([
          fn(input, context),
          createTimeoutPromise(options.timeoutMs),
        ]);

        const completedAt = new Date();
        const duration = completedAt.getTime() - startedAt.getTime();

        // Update metrics
        this.updateMetrics(true, duration, retries, kind);

        // Record history
        this.recordHistory({
          executionId,
          name,
          kind,
          success: true,
          startedAt,
          completedAt,
          duration,
          retries,
          input,
          output: result,
        });

        // Emit completed event
        await this.emitEvent({
          type: 'execution_completed',
          executionId,
          name,
          success: true,
          duration,
          result,
          timestamp: completedAt,
        });

        return {
          success: true,
          result: result as T,
          duration,
          retries,
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // If this isn't the last attempt, emit retry event and try again
        if (attempt < options.maxRetries) {
          retries++;
          await this.emitEvent({
            type: 'execution_retry',
            executionId,
            name,
            attempt: attempt + 2, // Next attempt number (1-indexed)
            error: lastError.message,
            timestamp: new Date(),
          });

          // Exponential backoff (uses configurable base delay for testing)
          await sleep(Math.min(this.retryDelayMs * Math.pow(2, attempt), this.retryDelayMs * 10));
        }
      }
    }

    // All attempts failed
    const completedAt = new Date();
    const duration = completedAt.getTime() - startedAt.getTime();

    // Update metrics
    this.updateMetrics(false, duration, retries, kind);

    // Record history
    this.recordHistory({
      executionId,
      name,
      kind,
      success: false,
      startedAt,
      completedAt,
      duration,
      retries,
      input,
      error: lastError?.message,
    });

    // Emit failed event
    await this.emitEvent({
      type: 'execution_failed',
      executionId,
      name,
      error: lastError?.message ?? 'Unknown error',
      duration,
      retries,
      timestamp: completedAt,
    });

    return {
      success: false,
      error: lastError,
      duration,
      retries,
    };
  }

  // ============================================================================
  // PRIVATE - Events
  // ============================================================================

  /**
   * Emit an event to all subscribers.
   */
  private async emitEvent(event: ExecutorEvent): Promise<void> {
    // Notify specific type handlers
    const typeHandlers = this.eventHandlers.get(event.type);
    if (typeHandlers) {
      for (const handler of typeHandlers) {
        try {
          await handler(event);
        } catch (error) {
          // Log but don't throw - events shouldn't break execution
          if (this.options.verbose) {
            console.error(`[SelfImprovementExecutor] Event handler error:`, error);
          }
        }
      }
    }

    // Notify wildcard handlers
    const wildcardHandlers = this.eventHandlers.get('*');
    if (wildcardHandlers) {
      for (const handler of wildcardHandlers) {
        try {
          await handler(event);
        } catch (error) {
          if (this.options.verbose) {
            console.error(`[SelfImprovementExecutor] Wildcard event handler error:`, error);
          }
        }
      }
    }
  }

  // ============================================================================
  // PRIVATE - Metrics
  // ============================================================================

  /**
   * Update metrics after execution.
   */
  private updateMetrics(
    success: boolean,
    duration: number,
    retries: number,
    kind: 'primitive' | 'composition'
  ): void {
    this.metrics.totalExecutions++;
    if (success) {
      this.metrics.successfulExecutions++;
    } else {
      this.metrics.failedExecutions++;
    }
    this.metrics.totalRetries += retries;

    // Update average duration
    this.totalDuration += duration;
    this.metrics.averageDurationMs = this.totalDuration / this.metrics.totalExecutions;

    // Update kind-specific counts
    if (kind === 'primitive') {
      this.metrics.primitiveExecutions++;
    } else {
      this.metrics.compositionExecutions++;
    }
  }

  // ============================================================================
  // PRIVATE - History
  // ============================================================================

  /**
   * Record an execution in history.
   */
  private recordHistory(entry: ExecutionEntry): void {
    this.history.push(entry);

    // Trim history if it exceeds max entries
    if (this.history.length > this.maxHistoryEntries) {
      this.history = this.history.slice(-this.maxHistoryEntries);
    }
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a SelfImprovementExecutor with the specified configuration.
 */
export function createSelfImprovementExecutor(
  config: SelfImprovementExecutorConfig
): SelfImprovementExecutor {
  return new SelfImprovementExecutor(config);
}
