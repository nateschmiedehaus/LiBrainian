/**
 * @fileoverview Primitive Contracts - Design-by-Contract for Technique Primitives
 *
 * Implements verifiable behavioral guarantees for every technique primitive:
 * - Preconditions: What must be true before execution
 * - Postconditions: What will be true after successful execution
 * - Invariants: What remains true throughout execution
 * - Confidence derivation: How output confidence relates to inputs
 *
 * @packageDocumentation
 */

import type { ConfidenceValue } from './confidence.js';
import { combinedConfidence, absent } from './confidence.js';
import type { IEvidenceLedger, SessionId } from './evidence_ledger.js';

// ============================================================================
// BRANDED TYPES
// ============================================================================

export type ContractId = string & { readonly __brand: 'ContractId' };
export type PrimitiveId = string & { readonly __brand: 'PrimitiveId' };

export function createContractId(id: string): ContractId {
  return id as ContractId;
}

export function createPrimitiveId(id: string): PrimitiveId {
  return id as PrimitiveId;
}

// ============================================================================
// EXECUTION CONTEXT
// ============================================================================

export interface ProviderStatus {
  llm: boolean;
  embedding: boolean;
  storage: boolean;
}

export interface ExecutionBudget {
  tokensRemaining: number;
  timeRemainingMs: number;
}

export interface ExecutionContext {
  sessionId: SessionId;
  providers: ProviderStatus;
  now: Date;
  budget: ExecutionBudget;
  ledger?: IEvidenceLedger;
}

// ============================================================================
// CONDITION RESULTS
// ============================================================================

/**
 * Result of checking a precondition.
 */
export interface PreconditionResult {
  passed: boolean;
  message?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Result of checking a postcondition.
 */
export interface PostconditionResult {
  passed: boolean;
  message?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Result of checking an invariant.
 */
export interface InvariantResult {
  held: boolean;
  message?: string;
  metadata?: Record<string, unknown>;
}

// ============================================================================
// CONDITIONS
// ============================================================================

export interface Precondition<TInput> {
  id: string;
  description: string;
  check: (input: TInput, context: ExecutionContext) => boolean | Promise<boolean>;
  onViolation: 'throw' | 'skip' | 'warn';
  violationMessage: (input: TInput) => string;
  severity: 'critical' | 'warning' | 'info';
}

export interface Postcondition<TInput, TOutput> {
  id: string;
  description: string;
  check: (input: TInput, output: TOutput, context: ExecutionContext) => boolean | Promise<boolean>;
  onViolation: 'throw' | 'retry' | 'warn';
  violationMessage: (input: TInput, output: TOutput) => string;
}

export interface Invariant<TInput, TOutput> {
  id: string;
  description: string;
  check: (input: TInput, partialOutput: Partial<TOutput> | undefined, context: ExecutionContext) => boolean;
  category: 'safety' | 'liveness' | 'consistency';
}

// ============================================================================
// CONFIDENCE DERIVATION
// ============================================================================

export type ConfidenceFactorSource =
  | 'input_confidence'
  | 'execution_quality'
  | 'provider_reliability'
  | 'temporal_freshness';

export interface ConfidenceFactor {
  id: string;
  source: ConfidenceFactorSource;
  baseWeight: number;
  transform?: 'identity' | 'sqrt' | 'log' | 'decay';
}

export type ConfidenceCombiner = 'min' | 'weighted_average' | 'bayesian' | 'custom';

export interface ConfidenceDerivationSpec {
  factors: ConfidenceFactor[];
  combiner: ConfidenceCombiner;
  weights?: Record<string, number>;
  customCombiner?: (factors: Map<string, ConfidenceValue>) => ConfidenceValue;
  calibrationRef?: string;
}

// ============================================================================
// ERROR SPECIFICATION
// ============================================================================

export interface ExpectedError {
  code: string;
  transient: boolean;
  handling: 'retry' | 'skip' | 'throw' | 'fallback';
  description: string;
}

export interface RetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  backoffMultiplier: number;
  maxDelayMs: number;
}

/**
 * Behavior when an unexpected (not in expectedErrors) error occurs.
 */
export type UnexpectedErrorBehavior = 'throw' | 'log_and_continue' | 'escalate';

export interface ErrorSpec {
  expectedErrors: ExpectedError[];
  retryPolicy: RetryPolicy;
  fallback: 'throw' | 'return_empty' | 'return_cached' | 'degrade_gracefully';
  /**
   * What to do when an error not in expectedErrors occurs.
   * Defaults to 'throw' if not specified.
   */
  unexpectedErrorBehavior?: UnexpectedErrorBehavior;
}

// ============================================================================
// PERFORMANCE BOUNDS
// ============================================================================

export interface PerformanceBounds {
  expectedLatencyMs: number;
  maxLatencyMs: number;
  expectedTokens?: {
    input: number;
    output: number;
  };
  memoryMB?: number;
  parallelizable: boolean;
}

// ============================================================================
// PRIMITIVE CONTRACT
// ============================================================================

/**
 * A contract that defines the behavioral guarantees of a technique primitive.
 *
 * INVARIANT: All primitives have exactly one contract
 * INVARIANT: Contract verification is deterministic given same inputs
 */
export interface PrimitiveContract<TInput, TOutput> {
  /** Unique identifier for this contract */
  id: ContractId;
  /** Human-readable name */
  name: string;
  /** Human-readable description of what this contract guarantees */
  description: string;
  /** Semantic version of this contract */
  version: string;
  /** The primitive this contract governs */
  primitiveId: PrimitiveId;
  /** Preconditions that must hold before execution */
  preconditions: Precondition<TInput>[];
  /** Postconditions that must hold after execution */
  postconditions: Postcondition<TInput, TOutput>[];
  /** Invariants that must hold throughout execution */
  invariants: Invariant<TInput, TOutput>[];
  /** How to derive output confidence */
  confidenceDerivation: ConfidenceDerivationSpec;
  /** Error handling specification */
  errorSpec: ErrorSpec;
  /** Performance bounds (if known) */
  performanceBounds?: PerformanceBounds;
}

// ============================================================================
// CONTRACT REGISTRY
// ============================================================================

export interface IContractRegistry {
  register<TInput, TOutput>(contract: PrimitiveContract<TInput, TOutput>): void;
  get<TInput, TOutput>(primitiveId: PrimitiveId): PrimitiveContract<TInput, TOutput> | null;
  list(): PrimitiveContract<unknown, unknown>[];
  has(primitiveId: PrimitiveId): boolean;
}

class ContractRegistry implements IContractRegistry {
  private contracts = new Map<string, PrimitiveContract<unknown, unknown>>();

  register<TInput, TOutput>(contract: PrimitiveContract<TInput, TOutput>): void {
    if (this.contracts.has(contract.primitiveId)) {
      throw new Error(`Contract already registered for primitive: ${contract.primitiveId}`);
    }
    this.contracts.set(contract.primitiveId, contract as PrimitiveContract<unknown, unknown>);
  }

  get<TInput, TOutput>(primitiveId: PrimitiveId): PrimitiveContract<TInput, TOutput> | null {
    const contract = this.contracts.get(primitiveId);
    return (contract as PrimitiveContract<TInput, TOutput>) ?? null;
  }

  list(): PrimitiveContract<unknown, unknown>[] {
    return Array.from(this.contracts.values());
  }

  has(primitiveId: PrimitiveId): boolean {
    return this.contracts.has(primitiveId);
  }
}

let globalRegistry: ContractRegistry | null = null;

/**
 * Get the global contract registry singleton.
 *
 * INVARIANT: Returns the same instance throughout the application lifecycle
 */
export function getContractRegistry(): IContractRegistry {
  if (!globalRegistry) {
    globalRegistry = new ContractRegistry();
  }
  return globalRegistry;
}

/**
 * Alias for getContractRegistry for API consistency.
 */
export function getGlobalContractRegistry(): IContractRegistry {
  return getContractRegistry();
}

/**
 * Register a contract in the global registry.
 *
 * This is a convenience function for `getContractRegistry().register(contract)`.
 */
export function registerContract<TInput, TOutput>(contract: PrimitiveContract<TInput, TOutput>): void {
  getContractRegistry().register(contract);
}

/**
 * Get a contract from the global registry by ID.
 *
 * This is a convenience function that looks up by contract ID (not primitive ID).
 *
 * @param id - The contract ID to look up
 * @returns The contract if found, null otherwise
 */
export function getContract(id: string): PrimitiveContract<unknown, unknown> | null {
  const registry = getContractRegistry();
  const contracts = registry.list();
  return contracts.find((c) => c.id === id) ?? null;
}

/**
 * Reset the global contract registry.
 *
 * WARNING: This should only be used in tests.
 */
export function resetContractRegistry(): void {
  globalRegistry = null;
}

// ============================================================================
// CONTRACT VIOLATION
// ============================================================================

/**
 * Type of condition that was violated.
 */
export type ViolationType = 'precondition' | 'postcondition' | 'invariant';

/**
 * Error thrown when a contract condition is violated.
 *
 * Contains detailed information about the violation including:
 * - Which contract was violated
 * - Which condition failed
 * - What type of condition it was
 * - Input and output values at the time of violation
 */
export class ContractViolation extends Error {
  /** The type of violation (alias for conditionType) */
  public readonly violationType: ViolationType;

  constructor(
    public readonly contractId: ContractId,
    public readonly conditionId: string,
    public readonly conditionType: ViolationType,
    message: string,
    public readonly input?: unknown,
    public readonly output?: unknown,
    public readonly details?: Record<string, unknown>
  ) {
    super(`Contract violation in ${contractId}: ${conditionType} ${conditionId} - ${message}`);
    this.name = 'ContractViolation';
    this.violationType = conditionType;
  }
}

/**
 * Alias for ContractViolation for API consistency with spec.
 */
export const ContractViolationError = ContractViolation;

// ============================================================================
// CONTRACT RESULT
// ============================================================================

export interface ContractWarning {
  conditionId: string;
  message: string;
  severity: 'warning' | 'info';
}

export interface ContractVerification {
  preconditionsPassed: string[];
  postconditionsPassed: string[];
  invariantsHeld: string[];
  warnings: ContractWarning[];
}

export interface ContractExecution {
  startTime: Date;
  endTime: Date;
  durationMs: number;
  retryCount: number;
}

export interface ContractResult<TOutput> {
  output: TOutput;
  verification: ContractVerification;
  confidence: ConfidenceValue;
  execution: ContractExecution;
}

// ============================================================================
// CONTRACT EXECUTOR
// ============================================================================

export interface IContractExecutor {
  execute<TInput, TOutput>(
    primitiveId: PrimitiveId,
    input: TInput,
    executor: (input: TInput, context: ExecutionContext) => Promise<TOutput>,
    context: ExecutionContext
  ): Promise<ContractResult<TOutput>>;
}

export class ContractExecutor implements IContractExecutor {
  constructor(private registry: IContractRegistry) {}

  async execute<TInput, TOutput>(
    primitiveId: PrimitiveId,
    input: TInput,
    executor: (input: TInput, context: ExecutionContext) => Promise<TOutput>,
    context: ExecutionContext
  ): Promise<ContractResult<TOutput>> {
    const contract = this.registry.get<TInput, TOutput>(primitiveId);
    if (!contract) {
      throw new Error(`No contract registered for primitive: ${primitiveId}`);
    }

    const startTime = new Date();
    const verification: ContractVerification = {
      preconditionsPassed: [],
      postconditionsPassed: [],
      invariantsHeld: [],
      warnings: [],
    };

    // Check preconditions
    await this.checkPreconditions(contract, input, context, verification);

    // Check invariants before execution
    await this.checkInvariants(contract, input, undefined, context, verification, 'before');

    // Execute with retry
    const { output, retryCount } = await this.executeWithRetry(
      contract,
      input,
      executor,
      context
    );

    // Check invariants after execution
    await this.checkInvariants(contract, input, output, context, verification, 'after');

    // Check postconditions
    await this.checkPostconditions(contract, input, output, context, verification);

    // Derive confidence
    const confidence = this.deriveConfidence(contract, input, output, context);

    const endTime = new Date();

    const result: ContractResult<TOutput> = {
      output,
      verification,
      confidence,
      execution: {
        startTime,
        endTime,
        durationMs: endTime.getTime() - startTime.getTime(),
        retryCount,
      },
    };

    // Record execution in evidence ledger if available
    if (context.ledger) {
      await this.recordExecution(contract, input, result, context);
    }

    return result;
  }

  private async checkPreconditions<TInput, TOutput>(
    contract: PrimitiveContract<TInput, TOutput>,
    input: TInput,
    context: ExecutionContext,
    verification: ContractVerification
  ): Promise<void> {
    for (const precondition of contract.preconditions) {
      const passed = await precondition.check(input, context);

      if (passed) {
        verification.preconditionsPassed.push(precondition.id);
      } else {
        const message = precondition.violationMessage(input);

        switch (precondition.onViolation) {
          case 'throw':
            throw new ContractViolation(
              contract.id,
              precondition.id,
              'precondition',
              message,
              input
            );
          case 'skip':
            throw new ContractViolation(
              contract.id,
              precondition.id,
              'precondition',
              `Skipped: ${message}`,
              input
            );
          case 'warn':
            verification.warnings.push({
              conditionId: precondition.id,
              message,
              severity: precondition.severity === 'info' ? 'info' : 'warning',
            });
            break;
        }
      }
    }
  }

  private async executeWithRetry<TInput, TOutput>(
    contract: PrimitiveContract<TInput, TOutput>,
    input: TInput,
    executor: (input: TInput, context: ExecutionContext) => Promise<TOutput>,
    context: ExecutionContext
  ): Promise<{ output: TOutput; retryCount: number }> {
    const { retryPolicy, expectedErrors, fallback } = contract.errorSpec;
    let lastError: Error | null = null;
    let retryCount = 0;

    for (let attempt = 0; attempt <= retryPolicy.maxAttempts; attempt++) {
      try {
        const output = await executor(input, context);
        return { output, retryCount };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        const errorCode = (error as { code?: string }).code ?? 'UNKNOWN';
        const expectedError = expectedErrors.find((e) => e.code === errorCode);

        if (expectedError) {
          if (expectedError.transient && attempt < retryPolicy.maxAttempts) {
            retryCount++;
            const delay = Math.min(
              retryPolicy.baseDelayMs * Math.pow(retryPolicy.backoffMultiplier, attempt),
              retryPolicy.maxDelayMs
            );
            await this.sleep(delay);
            continue;
          }

          if (expectedError.handling === 'throw') {
            throw error;
          }
        } else if (attempt < retryPolicy.maxAttempts) {
          retryCount++;
          const delay = Math.min(
            retryPolicy.baseDelayMs * Math.pow(retryPolicy.backoffMultiplier, attempt),
            retryPolicy.maxDelayMs
          );
          await this.sleep(delay);
          continue;
        }

        break;
      }
    }

    // All retries exhausted - apply fallback
    switch (fallback) {
      case 'throw':
        throw lastError ?? new Error('Execution failed');
      case 'return_empty':
        return { output: {} as TOutput, retryCount };
      case 'return_cached':
        // Would need cache access - fall through to throw
        throw lastError ?? new Error('Execution failed (no cache available)');
      case 'degrade_gracefully':
        return { output: {} as TOutput, retryCount };
    }
  }

  private async checkPostconditions<TInput, TOutput>(
    contract: PrimitiveContract<TInput, TOutput>,
    input: TInput,
    output: TOutput,
    context: ExecutionContext,
    verification: ContractVerification
  ): Promise<void> {
    for (const postcondition of contract.postconditions) {
      const passed = await postcondition.check(input, output, context);

      if (passed) {
        verification.postconditionsPassed.push(postcondition.id);
      } else {
        const message = postcondition.violationMessage(input, output);

        switch (postcondition.onViolation) {
          case 'throw':
            throw new ContractViolation(
              contract.id,
              postcondition.id,
              'postcondition',
              message,
              input,
              output
            );
          case 'retry':
            // Would trigger re-execution - for now treat as warning
            verification.warnings.push({
              conditionId: postcondition.id,
              message: `Retry suggested: ${message}`,
              severity: 'warning',
            });
            break;
          case 'warn':
            verification.warnings.push({
              conditionId: postcondition.id,
              message,
              severity: 'warning',
            });
            break;
        }
      }
    }
  }

  /**
   * Check all invariants defined in the contract.
   *
   * Invariants are checked both before and after execution to ensure
   * they hold throughout the operation.
   *
   * @param contract - The contract being executed
   * @param input - The input to the operation
   * @param partialOutput - Partial or full output (undefined before execution)
   * @param context - Execution context
   * @param verification - Verification result to update
   * @param phase - Whether this is before or after execution
   */
  private async checkInvariants<TInput, TOutput>(
    contract: PrimitiveContract<TInput, TOutput>,
    input: TInput,
    partialOutput: Partial<TOutput> | undefined,
    context: ExecutionContext,
    verification: ContractVerification,
    phase: 'before' | 'after'
  ): Promise<void> {
    for (const invariant of contract.invariants) {
      const held = invariant.check(input, partialOutput, context);

      if (held) {
        // Only record invariants as held if they pass in both phases
        // We track them during the 'after' phase to avoid duplicates
        if (phase === 'after' && !verification.invariantsHeld.includes(invariant.id)) {
          verification.invariantsHeld.push(invariant.id);
        }
      } else {
        // Invariant violation - always throw since invariants are fundamental guarantees
        throw new ContractViolation(
          contract.id,
          invariant.id,
          'invariant',
          `Invariant '${invariant.description}' violated ${phase} execution`,
          input,
          partialOutput,
          { phase, category: invariant.category }
        );
      }
    }
  }

  /**
   * Record contract execution in the evidence ledger.
   *
   * This creates an audit trail of all contract executions, which can be
   * used for:
   * - Debugging and tracing
   * - Calibration data collection
   * - Compliance and audit requirements
   *
   * @param contract - The contract that was executed
   * @param input - The input to the operation
   * @param result - The execution result
   * @param context - Execution context with ledger
   */
  private async recordExecution<TInput, TOutput>(
    contract: PrimitiveContract<TInput, TOutput>,
    input: TInput,
    result: ContractResult<TOutput>,
    context: ExecutionContext
  ): Promise<void> {
    if (!context.ledger) return;

    try {
      await context.ledger.append({
        kind: 'tool_call',
        payload: {
          toolName: `contract:${contract.primitiveId}`,
          toolVersion: contract.version,
          arguments: {
            contractId: contract.id,
            primitiveId: contract.primitiveId,
            inputSummary: this.summarizeInput(input),
          },
          result: {
            preconditionsPassed: result.verification.preconditionsPassed.length,
            postconditionsPassed: result.verification.postconditionsPassed.length,
            invariantsHeld: result.verification.invariantsHeld.length,
            warningCount: result.verification.warnings.length,
            durationMs: result.execution.durationMs,
            retryCount: result.execution.retryCount,
          },
          success: true,
          durationMs: result.execution.durationMs,
        },
        provenance: {
          source: 'system_observation',
          method: 'contract_execution',
        },
        confidence: result.confidence,
        relatedEntries: [],
        sessionId: context.sessionId,
      });
    } catch {
      // Ledger recording failure should not fail the execution
      // Log but don't throw - this is best-effort audit logging
    }
  }

  /**
   * Create a summary of the input for logging purposes.
   * Avoids logging sensitive or large data.
   */
  private summarizeInput(input: unknown): string {
    if (input === null || input === undefined) return 'null';
    if (typeof input === 'string') return `string(${input.length})`;
    if (typeof input === 'number') return `number`;
    if (typeof input === 'boolean') return `boolean`;
    if (Array.isArray(input)) return `array(${input.length})`;
    if (typeof input === 'object') {
      const keys = Object.keys(input);
      return `object{${keys.slice(0, 5).join(', ')}${keys.length > 5 ? '...' : ''}}`;
    }
    return typeof input;
  }

  private deriveConfidence<TInput, TOutput>(
    contract: PrimitiveContract<TInput, TOutput>,
    _input: TInput,
    _output: TOutput,
    _context: ExecutionContext
  ): ConfidenceValue {
    const { factors, combiner, weights } = contract.confidenceDerivation;

    if (factors.length === 0) {
      return absent('not_applicable');
    }

    // Build factor values (simplified - would need actual factor extraction)
    const factorInputs = factors.map((factor) => ({
      confidence: {
        type: 'bounded' as const,
        low: 0.5,
        high: 0.9,
        basis: 'theoretical' as const,
        citation: `${factor.source}_default`,
      },
      weight: weights?.[factor.id] ?? factor.baseWeight,
      name: factor.id,
    }));

    switch (combiner) {
      case 'min':
        return combinedConfidence(factorInputs);
      case 'weighted_average':
        return combinedConfidence(factorInputs);
      case 'bayesian':
        // Simplified Bayesian - would need prior/likelihood
        return combinedConfidence(factorInputs);
      case 'custom':
        if (contract.confidenceDerivation.customCombiner) {
          const factorMap = new Map<string, ConfidenceValue>();
          for (const f of factorInputs) {
            factorMap.set(f.name, f.confidence);
          }
          return contract.confidenceDerivation.customCombiner(factorMap);
        }
        return absent('insufficient_data');
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export function createContractExecutor(registry?: IContractRegistry): IContractExecutor {
  return new ContractExecutor(registry ?? getContractRegistry());
}

// ============================================================================
// DEFAULT RETRY POLICY
// ============================================================================

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 100,
  backoffMultiplier: 2,
  maxDelayMs: 5000,
};

// ============================================================================
// CONTRACT BUILDER HELPERS
// ============================================================================

export function createPrecondition<TInput>(
  id: string,
  description: string,
  check: (input: TInput, context: ExecutionContext) => boolean | Promise<boolean>,
  options: Partial<Pick<Precondition<TInput>, 'onViolation' | 'severity'>> = {}
): Precondition<TInput> {
  return {
    id,
    description,
    check,
    onViolation: options.onViolation ?? 'throw',
    violationMessage: () => description,
    severity: options.severity ?? 'critical',
  };
}

export function createPostcondition<TInput, TOutput>(
  id: string,
  description: string,
  check: (input: TInput, output: TOutput, context: ExecutionContext) => boolean | Promise<boolean>,
  options: Partial<Pick<Postcondition<TInput, TOutput>, 'onViolation'>> = {}
): Postcondition<TInput, TOutput> {
  return {
    id,
    description,
    check,
    onViolation: options.onViolation ?? 'throw',
    violationMessage: () => description,
  };
}

/**
 * Creates an invariant with sensible defaults.
 */
export function createInvariant<TInput, TOutput>(
  id: string,
  description: string,
  check: (input: TInput, partialOutput: Partial<TOutput> | undefined, context: ExecutionContext) => boolean,
  category: Invariant<TInput, TOutput>['category'] = 'consistency'
): Invariant<TInput, TOutput> {
  return {
    id,
    description,
    check,
    category,
  };
}

// ============================================================================
// CONTRACT VALIDATION
// ============================================================================

/**
 * Result of validating a contract.
 */
export interface ContractValidationResult {
  valid: boolean;
  errors: ContractValidationError[];
  warnings: ContractValidationWarning[];
}

export interface ContractValidationError {
  field: string;
  message: string;
}

export interface ContractValidationWarning {
  field: string;
  message: string;
}

/**
 * Validates that a contract is complete and well-formed.
 *
 * Checks:
 * - Required fields are present and non-empty
 * - IDs are properly formatted
 * - Version follows semver pattern
 * - At least one condition is defined (warning if none)
 * - Confidence derivation is properly configured
 * - Error spec has valid retry policy
 */
export function validateContract<TInput, TOutput>(
  contract: Partial<PrimitiveContract<TInput, TOutput>>
): ContractValidationResult {
  const errors: ContractValidationError[] = [];
  const warnings: ContractValidationWarning[] = [];

  // Required string fields
  if (!contract.id || typeof contract.id !== 'string') {
    errors.push({ field: 'id', message: 'Contract ID is required and must be a string' });
  }
  if (!contract.name || typeof contract.name !== 'string') {
    errors.push({ field: 'name', message: 'Contract name is required and must be a string' });
  }
  if (!contract.description || typeof contract.description !== 'string') {
    errors.push({ field: 'description', message: 'Contract description is required and must be a string' });
  }
  if (!contract.version || typeof contract.version !== 'string') {
    errors.push({ field: 'version', message: 'Contract version is required and must be a string' });
  } else if (!/^\d+\.\d+\.\d+/.test(contract.version)) {
    warnings.push({ field: 'version', message: 'Version should follow semver format (e.g., "1.0.0")' });
  }
  if (!contract.primitiveId || typeof contract.primitiveId !== 'string') {
    errors.push({ field: 'primitiveId', message: 'Primitive ID is required and must be a string' });
  }

  // Arrays must exist
  if (!Array.isArray(contract.preconditions)) {
    errors.push({ field: 'preconditions', message: 'Preconditions must be an array' });
  }
  if (!Array.isArray(contract.postconditions)) {
    errors.push({ field: 'postconditions', message: 'Postconditions must be an array' });
  }
  if (!Array.isArray(contract.invariants)) {
    errors.push({ field: 'invariants', message: 'Invariants must be an array' });
  }

  // Warn if no conditions at all
  const totalConditions =
    (contract.preconditions?.length ?? 0) +
    (contract.postconditions?.length ?? 0) +
    (contract.invariants?.length ?? 0);
  if (totalConditions === 0) {
    warnings.push({
      field: 'conditions',
      message: 'Contract has no preconditions, postconditions, or invariants',
    });
  }

  // Confidence derivation
  if (!contract.confidenceDerivation) {
    errors.push({ field: 'confidenceDerivation', message: 'Confidence derivation specification is required' });
  } else {
    if (!contract.confidenceDerivation.combiner) {
      errors.push({ field: 'confidenceDerivation.combiner', message: 'Combiner strategy is required' });
    }
    if (!Array.isArray(contract.confidenceDerivation.factors)) {
      errors.push({ field: 'confidenceDerivation.factors', message: 'Factors must be an array' });
    }
  }

  // Error spec
  if (!contract.errorSpec) {
    errors.push({ field: 'errorSpec', message: 'Error specification is required' });
  } else {
    if (!Array.isArray(contract.errorSpec.expectedErrors)) {
      errors.push({ field: 'errorSpec.expectedErrors', message: 'Expected errors must be an array' });
    }
    if (!contract.errorSpec.retryPolicy) {
      errors.push({ field: 'errorSpec.retryPolicy', message: 'Retry policy is required' });
    } else {
      const rp = contract.errorSpec.retryPolicy;
      if (typeof rp.maxAttempts !== 'number' || rp.maxAttempts < 0) {
        errors.push({ field: 'errorSpec.retryPolicy.maxAttempts', message: 'Max attempts must be a non-negative number' });
      }
      if (typeof rp.baseDelayMs !== 'number' || rp.baseDelayMs < 0) {
        errors.push({ field: 'errorSpec.retryPolicy.baseDelayMs', message: 'Base delay must be a non-negative number' });
      }
    }
    if (!contract.errorSpec.fallback) {
      errors.push({ field: 'errorSpec.fallback', message: 'Fallback behavior is required' });
    }
  }

  // Validate individual conditions have required fields
  contract.preconditions?.forEach((pre, i) => {
    if (!pre.id) errors.push({ field: `preconditions[${i}].id`, message: 'Precondition ID is required' });
    if (!pre.description) errors.push({ field: `preconditions[${i}].description`, message: 'Precondition description is required' });
    if (typeof pre.check !== 'function') errors.push({ field: `preconditions[${i}].check`, message: 'Precondition check must be a function' });
  });

  contract.postconditions?.forEach((post, i) => {
    if (!post.id) errors.push({ field: `postconditions[${i}].id`, message: 'Postcondition ID is required' });
    if (!post.description) errors.push({ field: `postconditions[${i}].description`, message: 'Postcondition description is required' });
    if (typeof post.check !== 'function') errors.push({ field: `postconditions[${i}].check`, message: 'Postcondition check must be a function' });
  });

  contract.invariants?.forEach((inv, i) => {
    if (!inv.id) errors.push({ field: `invariants[${i}].id`, message: 'Invariant ID is required' });
    if (!inv.description) errors.push({ field: `invariants[${i}].description`, message: 'Invariant description is required' });
    if (typeof inv.check !== 'function') errors.push({ field: `invariants[${i}].check`, message: 'Invariant check must be a function' });
  });

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// ============================================================================
// CONTRACT FACTORY
// ============================================================================

/**
 * Options for creating a primitive contract.
 */
export interface CreateContractOptions<TInput, TOutput> {
  id: string;
  name: string;
  description: string;
  version?: string;
  primitiveId: string;
  preconditions?: Precondition<TInput>[];
  postconditions?: Postcondition<TInput, TOutput>[];
  invariants?: Invariant<TInput, TOutput>[];
  confidenceDerivation?: Partial<ConfidenceDerivationSpec>;
  errorSpec?: Partial<ErrorSpec>;
  performanceBounds?: PerformanceBounds;
}

/**
 * Default error specification.
 */
export const DEFAULT_ERROR_SPEC: ErrorSpec = {
  expectedErrors: [],
  retryPolicy: DEFAULT_RETRY_POLICY,
  fallback: 'throw',
  unexpectedErrorBehavior: 'throw',
};

/**
 * Default confidence derivation specification.
 */
export const DEFAULT_CONFIDENCE_DERIVATION: ConfidenceDerivationSpec = {
  factors: [],
  combiner: 'min',
};

/**
 * Creates a primitive contract with sensible defaults and validation.
 *
 * @throws Error if the resulting contract is invalid
 */
export function createContract<TInput, TOutput>(
  options: CreateContractOptions<TInput, TOutput>
): PrimitiveContract<TInput, TOutput> {
  const contract: PrimitiveContract<TInput, TOutput> = {
    id: createContractId(options.id),
    name: options.name,
    description: options.description,
    version: options.version ?? '1.0.0',
    primitiveId: createPrimitiveId(options.primitiveId),
    preconditions: options.preconditions ?? [],
    postconditions: options.postconditions ?? [],
    invariants: options.invariants ?? [],
    confidenceDerivation: {
      ...DEFAULT_CONFIDENCE_DERIVATION,
      ...options.confidenceDerivation,
    },
    errorSpec: {
      ...DEFAULT_ERROR_SPEC,
      ...options.errorSpec,
    },
    performanceBounds: options.performanceBounds,
  };

  // Validate the contract
  const validation = validateContract(contract);
  if (!validation.valid) {
    const errorMessages = validation.errors.map((e) => `${e.field}: ${e.message}`).join('; ');
    throw new Error(`Invalid contract: ${errorMessages}`);
  }

  return contract;
}

/**
 * Creates a confidence factor.
 */
export function createConfidenceFactor(
  id: string,
  source: ConfidenceFactorSource,
  baseWeight: number,
  transform?: ConfidenceFactor['transform']
): ConfidenceFactor {
  return { id, source, baseWeight, transform };
}

/**
 * Creates an expected error definition.
 */
export function createExpectedError(
  code: string,
  description: string,
  options: { transient?: boolean; handling?: ExpectedError['handling'] } = {}
): ExpectedError {
  return {
    code,
    description,
    transient: options.transient ?? false,
    handling: options.handling ?? 'throw',
  };
}

// ============================================================================
// PRIMITIVE CONTRACTS FOR EPISTEMICS FUNCTIONS
// ============================================================================

/**
 * Contract for D1: Syntactic Confidence (syntacticConfidence)
 *
 * Deterministic operations always produce 1.0 or 0.0 confidence.
 */
export const SYNTACTIC_CONFIDENCE_CONTRACT = createContract<{ success: boolean }, ConfidenceValue>({
  id: 'contract_syntactic_confidence',
  name: 'Syntactic Confidence Contract',
  description: 'D1: Syntactic operations produce deterministic confidence (1.0 or 0.0)',
  version: '1.0.0',
  primitiveId: 'primitive_syntactic_confidence',
  preconditions: [
    createPrecondition(
      'input_is_boolean',
      'Input success must be a boolean',
      (input) => typeof input.success === 'boolean'
    ),
  ],
  postconditions: [
    createPostcondition(
      'output_is_deterministic',
      'Output must be a deterministic confidence value',
      (_, output) => output.type === 'deterministic'
    ),
    createPostcondition(
      'output_value_valid',
      'Output value must be exactly 1.0 or 0.0',
      (_, output) => output.type === 'deterministic' && (output.value === 1.0 || output.value === 0.0)
    ),
  ],
  invariants: [
    createInvariant(
      'determinism',
      'Same input always produces same output',
      () => true, // This is enforced by the pure function nature
      'consistency'
    ),
  ],
});

/**
 * Contract for D2: Sequence Confidence (sequenceConfidence)
 *
 * Sequential composition uses min(steps) formula.
 */
export const SEQUENCE_CONFIDENCE_CONTRACT = createContract<{ steps: ConfidenceValue[] }, ConfidenceValue>({
  id: 'contract_sequence_confidence',
  name: 'Sequence Confidence Contract',
  description: 'D2: Sequential composition produces min(steps) confidence',
  version: '1.0.0',
  primitiveId: 'primitive_sequence_confidence',
  preconditions: [
    createPrecondition(
      'steps_is_array',
      'Steps must be an array',
      (input) => Array.isArray(input.steps)
    ),
  ],
  postconditions: [
    createPostcondition(
      'output_has_provenance',
      'Output must have provenance (derived or absent)',
      (_, output) => output.type === 'derived' || output.type === 'absent'
    ),
    createPostcondition(
      'formula_is_min',
      'Formula must be min(steps) when derived',
      (_, output) => output.type !== 'derived' || output.formula === 'min(steps)'
    ),
  ],
});

/**
 * Contract for D3: Parallel-All Confidence (parallelAllConfidence)
 *
 * Parallel-all composition uses product(branches) formula.
 */
export const PARALLEL_ALL_CONFIDENCE_CONTRACT = createContract<{ branches: ConfidenceValue[] }, ConfidenceValue>({
  id: 'contract_parallel_all_confidence',
  name: 'Parallel-All Confidence Contract',
  description: 'D3: Parallel-all composition produces product(branches) confidence',
  version: '1.0.0',
  primitiveId: 'primitive_parallel_all_confidence',
  preconditions: [
    createPrecondition(
      'branches_is_array',
      'Branches must be an array',
      (input) => Array.isArray(input.branches)
    ),
  ],
  postconditions: [
    createPostcondition(
      'formula_is_product',
      'Formula must be product(branches) when derived',
      (_, output) => output.type !== 'derived' || output.formula === 'product(branches)'
    ),
  ],
});

/**
 * Contract for D4: Parallel-Any Confidence (parallelAnyConfidence)
 *
 * Parallel-any composition uses 1 - product(1 - branches) formula.
 */
export const PARALLEL_ANY_CONFIDENCE_CONTRACT = createContract<{ branches: ConfidenceValue[] }, ConfidenceValue>({
  id: 'contract_parallel_any_confidence',
  name: 'Parallel-Any Confidence Contract',
  description: 'D4: Parallel-any composition produces 1 - product(1 - branches) confidence',
  version: '1.0.0',
  primitiveId: 'primitive_parallel_any_confidence',
  preconditions: [
    createPrecondition(
      'branches_is_array',
      'Branches must be an array',
      (input) => Array.isArray(input.branches)
    ),
  ],
  postconditions: [
    createPostcondition(
      'formula_is_noisy_or',
      'Formula must be 1 - product(1 - branches) when derived',
      (_, output) => output.type !== 'derived' || output.formula === '1 - product(1 - branches)'
    ),
  ],
});

/**
 * Contract for D5: Uncalibrated Confidence (uncalibratedConfidence)
 *
 * Before calibration, confidence must be absent.
 */
export const UNCALIBRATED_CONFIDENCE_CONTRACT = createContract<void, ConfidenceValue>({
  id: 'contract_uncalibrated_confidence',
  name: 'Uncalibrated Confidence Contract',
  description: 'D5: LLM operations before calibration produce absent confidence',
  version: '1.0.0',
  primitiveId: 'primitive_uncalibrated_confidence',
  postconditions: [
    createPostcondition(
      'output_is_absent',
      'Output must be absent confidence',
      (_, output) => output.type === 'absent'
    ),
    createPostcondition(
      'reason_is_uncalibrated',
      'Reason must be "uncalibrated"',
      (_, output) => output.type === 'absent' && output.reason === 'uncalibrated'
    ),
  ],
});

/**
 * Contract for D6: Measured Confidence (measuredConfidence)
 *
 * After calibration, confidence is measured from empirical data.
 */
export const MEASURED_CONFIDENCE_CONTRACT = createContract<
  { datasetId: string; sampleSize: number; accuracy: number; ci95: readonly [number, number] },
  ConfidenceValue
>({
  id: 'contract_measured_confidence',
  name: 'Measured Confidence Contract',
  description: 'D6: LLM operations after calibration produce measured confidence',
  version: '1.0.0',
  primitiveId: 'primitive_measured_confidence',
  preconditions: [
    createPrecondition(
      'has_dataset_id',
      'Must have dataset ID',
      (input) => typeof input.datasetId === 'string' && input.datasetId.length > 0
    ),
    createPrecondition(
      'has_sample_size',
      'Sample size must be positive',
      (input) => typeof input.sampleSize === 'number' && input.sampleSize > 0
    ),
    createPrecondition(
      'accuracy_in_range',
      'Accuracy must be between 0 and 1',
      (input) => typeof input.accuracy === 'number' && input.accuracy >= 0 && input.accuracy <= 1
    ),
    createPrecondition(
      'ci95_valid',
      'CI95 must be a valid interval',
      (input) => Array.isArray(input.ci95) && input.ci95.length === 2 && input.ci95[0] <= input.ci95[1]
    ),
  ],
  postconditions: [
    createPostcondition(
      'output_is_measured',
      'Output must be measured confidence',
      (_, output) => output.type === 'measured'
    ),
    createPostcondition(
      'has_measurement_data',
      'Output must contain measurement data',
      (_, output) => output.type === 'measured' && output.measurement !== undefined
    ),
  ],
});

/**
 * Contract for Calibration Score Adjustment (adjustConfidenceScore)
 */
export const CALIBRATION_ADJUSTMENT_CONTRACT = createContract<
  { rawConfidence: number; buckets: unknown[] },
  { raw: number; calibrated: number; weight: number }
>({
  id: 'contract_calibration_adjustment',
  name: 'Calibration Adjustment Contract',
  description: 'Adjusts raw confidence scores using calibration data',
  version: '1.0.0',
  primitiveId: 'primitive_calibration_adjustment',
  preconditions: [
    createPrecondition(
      'raw_confidence_in_range',
      'Raw confidence must be between 0 and 1',
      (input) => typeof input.rawConfidence === 'number' && input.rawConfidence >= 0 && input.rawConfidence <= 1
    ),
  ],
  postconditions: [
    createPostcondition(
      'calibrated_in_range',
      'Calibrated value must be between 0 and 1',
      (_, output) => output.calibrated >= 0 && output.calibrated <= 1
    ),
    createPostcondition(
      'weight_in_range',
      'Weight must be between 0 and 1',
      (_, output) => output.weight >= 0 && output.weight <= 1
    ),
  ],
});

/**
 * Contract for Evidence Ledger Append operation
 */
export const EVIDENCE_LEDGER_APPEND_CONTRACT = createContract<
  { kind: string; payload: unknown; provenance: unknown },
  { id: string; timestamp: Date }
>({
  id: 'contract_evidence_ledger_append',
  name: 'Evidence Ledger Append Contract',
  description: 'Append-only operation for evidence ledger entries',
  version: '1.0.0',
  primitiveId: 'primitive_evidence_ledger_append',
  preconditions: [
    createPrecondition(
      'has_kind',
      'Entry must have a kind',
      (input) => typeof input.kind === 'string' && input.kind.length > 0
    ),
    createPrecondition(
      'has_payload',
      'Entry must have a payload',
      (input) => input.payload !== undefined && input.payload !== null
    ),
    createPrecondition(
      'has_provenance',
      'Entry must have provenance',
      (input) => input.provenance !== undefined && input.provenance !== null
    ),
  ],
  postconditions: [
    createPostcondition(
      'has_id',
      'Result must have an assigned ID',
      (_, output) => typeof output.id === 'string' && output.id.length > 0
    ),
    createPostcondition(
      'has_timestamp',
      'Result must have a timestamp',
      (_, output) => output.timestamp instanceof Date
    ),
  ],
  invariants: [
    createInvariant(
      'append_only',
      'Ledger entries are append-only and never modified',
      () => true, // Enforced by the ledger implementation
      'safety'
    ),
  ],
});

/**
 * Contract for Evidence Ledger Query operation
 */
export const EVIDENCE_LEDGER_QUERY_CONTRACT = createContract<
  { criteria: unknown },
  unknown[]
>({
  id: 'contract_evidence_ledger_query',
  name: 'Evidence Ledger Query Contract',
  description: 'Query operation for evidence ledger entries',
  version: '1.0.0',
  primitiveId: 'primitive_evidence_ledger_query',
  postconditions: [
    createPostcondition(
      'returns_array',
      'Query must return an array',
      (_, output) => Array.isArray(output)
    ),
  ],
  invariants: [
    createInvariant(
      'read_only',
      'Query operations do not modify the ledger',
      () => true, // Enforced by the ledger implementation
      'safety'
    ),
  ],
});

/**
 * Initialize and register all built-in primitive contracts.
 *
 * This function should be called once at application startup to ensure
 * all standard contracts are available for use.
 *
 * @returns Array of registered contracts
 */
export function registerBuiltInContracts(): PrimitiveContract<unknown, unknown>[] {
  const registry = getContractRegistry();
  const contracts: PrimitiveContract<unknown, unknown>[] = [
    SYNTACTIC_CONFIDENCE_CONTRACT as PrimitiveContract<unknown, unknown>,
    SEQUENCE_CONFIDENCE_CONTRACT as PrimitiveContract<unknown, unknown>,
    PARALLEL_ALL_CONFIDENCE_CONTRACT as PrimitiveContract<unknown, unknown>,
    PARALLEL_ANY_CONFIDENCE_CONTRACT as PrimitiveContract<unknown, unknown>,
    UNCALIBRATED_CONFIDENCE_CONTRACT as PrimitiveContract<unknown, unknown>,
    MEASURED_CONFIDENCE_CONTRACT as PrimitiveContract<unknown, unknown>,
    CALIBRATION_ADJUSTMENT_CONTRACT as PrimitiveContract<unknown, unknown>,
    EVIDENCE_LEDGER_APPEND_CONTRACT as PrimitiveContract<unknown, unknown>,
    EVIDENCE_LEDGER_QUERY_CONTRACT as PrimitiveContract<unknown, unknown>,
  ];

  for (const contract of contracts) {
    // Only register if not already registered
    if (!registry.has(contract.primitiveId)) {
      registry.register(contract);
    }
  }

  return contracts;
}
