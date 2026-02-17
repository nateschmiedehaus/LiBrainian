# Primitive Contracts Specification

> **Version**: 1.0.0
> **Status**: DRAFT
> **Last Updated**: 2026-01-23
>
> **Theory Reference**: Implements design-by-contract for all technique primitives. See [technique-contracts.md](../technique-contracts.md).

---

## Executive Summary

Primitive Contracts define **verifiable behavioral guarantees** for every technique primitive in LiBrainian. Each primitive declares:

- **Preconditions**: What must be true before execution
- **Postconditions**: What will be true after successful execution
- **Invariants**: What remains true throughout execution
- **Confidence derivation**: How output confidence relates to inputs

This enables runtime verification, composition safety, and failure diagnosis.

---

## 1. Contract Interface

### 1.1 Core Types

```typescript
/**
 * A contract that defines the behavioral guarantees of a technique primitive.
 *
 * INVARIANT: All primitives have exactly one contract
 * INVARIANT: Contract verification is deterministic given same inputs
 */
interface PrimitiveContract<TInput, TOutput> {
  /** Unique identifier for this contract */
  id: ContractId;

  /** Human-readable name */
  name: string;

  /** The primitive this contract governs */
  primitiveId: PrimitiveId;

  /** Preconditions that must hold before execution */
  preconditions: Precondition<TInput>[];

  /** Postconditions that must hold after execution */
  postconditions: Postcondition<TInput, TOutput>[];

  /** Invariants that must hold throughout */
  invariants: Invariant<TInput, TOutput>[];

  /** How to derive output confidence */
  confidenceDerivation: ConfidenceDerivation;

  /** Error handling specification */
  errorSpec: ErrorSpec;

  /** Performance bounds (if known) */
  performanceBounds?: PerformanceBounds;
}

type ContractId = string & { readonly __brand: 'ContractId' };
type PrimitiveId = string & { readonly __brand: 'PrimitiveId' };
```

### 1.2 Conditions

```typescript
/**
 * A precondition that must be true before primitive execution.
 */
interface Precondition<TInput> {
  /** Unique identifier */
  id: string;

  /** Human-readable description */
  description: string;

  /** Check function - returns true if precondition holds */
  check: (input: TInput, context: ExecutionContext) => boolean | Promise<boolean>;

  /** What happens if violated */
  onViolation: 'throw' | 'skip' | 'warn';

  /** Error message if violated */
  violationMessage: (input: TInput) => string;

  /** Is this precondition critical (must pass) or advisory? */
  severity: 'critical' | 'warning' | 'info';
}

/**
 * A postcondition that must be true after successful execution.
 */
interface Postcondition<TInput, TOutput> {
  /** Unique identifier */
  id: string;

  /** Human-readable description */
  description: string;

  /** Check function - returns true if postcondition holds */
  check: (input: TInput, output: TOutput, context: ExecutionContext) => boolean | Promise<boolean>;

  /** What happens if violated */
  onViolation: 'throw' | 'retry' | 'warn';

  /** Error message if violated */
  violationMessage: (input: TInput, output: TOutput) => string;
}

/**
 * An invariant that must hold throughout execution.
 */
interface Invariant<TInput, TOutput> {
  /** Unique identifier */
  id: string;

  /** Human-readable description */
  description: string;

  /** Check function */
  check: (input: TInput, partialOutput: Partial<TOutput> | undefined, context: ExecutionContext) => boolean;

  /** What invariant category is this? */
  category: 'safety' | 'liveness' | 'consistency';
}
```

### 1.3 Execution Context

```typescript
/**
 * Context available during contract verification.
 */
interface ExecutionContext {
  /** Current session ID */
  sessionId: SessionId;

  /** Storage access */
  storage: ILibrarianStorage;

  /** Provider availability */
  providers: ProviderStatus;

  /** Current timestamp */
  now: Date;

  /** Execution budget remaining */
  budget: {
    tokensRemaining: number;
    timeRemainingMs: number;
  };

  /** Evidence ledger for recording */
  ledger: IEvidenceLedger;
}

interface ProviderStatus {
  llm: boolean;
  embedding: boolean;
  storage: boolean;
}
```

---

## 2. Confidence Derivation

### 2.1 Derivation Specification

```typescript
/**
 * How output confidence is derived from inputs and execution.
 */
interface ConfidenceDerivation {
  /** What factors contribute to output confidence */
  factors: ConfidenceFactor[];

  /** How to combine factors */
  combiner: 'min' | 'weighted_average' | 'bayesian' | 'custom';

  /** Weights for weighted_average combiner */
  weights?: Record<string, number>;

  /** Custom combiner function (if combiner === 'custom') */
  customCombiner?: (factors: Map<string, ConfidenceValue>) => ConfidenceValue;

  /** Calibration reference (if calibrated) */
  calibrationRef?: string;
}

interface ConfidenceFactor {
  /** Factor identifier */
  id: string;

  /** How to extract this factor */
  source: 'input_confidence' | 'execution_quality' | 'provider_reliability' | 'temporal_freshness';

  /** Base weight in combination */
  baseWeight: number;

  /** Optional transform to apply */
  transform?: 'identity' | 'sqrt' | 'log' | 'decay';
}
```

### 2.2 Example Derivation

```typescript
// Example: Semantic search confidence derivation
const searchConfidenceDerivation: ConfidenceDerivation = {
  factors: [
    {
      id: 'embedding_quality',
      source: 'execution_quality',
      baseWeight: 0.4,
    },
    {
      id: 'index_freshness',
      source: 'temporal_freshness',
      baseWeight: 0.3,
      transform: 'decay',
    },
    {
      id: 'query_clarity',
      source: 'input_confidence',
      baseWeight: 0.3,
    },
  ],
  combiner: 'weighted_average',
  calibrationRef: 'semantic_search_v1',
};
```

---

## 3. Error Specification

```typescript
/**
 * How errors are handled for this primitive.
 */
interface ErrorSpec {
  /** Expected error types and their handling */
  expectedErrors: ExpectedError[];

  /** Retry policy for transient errors */
  retryPolicy: RetryPolicy;

  /** Fallback behavior if all retries fail */
  fallback: 'throw' | 'return_empty' | 'return_cached' | 'degrade_gracefully';
}

interface ExpectedError {
  /** Error type/code */
  code: string;

  /** Is this transient (can retry)? */
  transient: boolean;

  /** How to handle */
  handling: 'retry' | 'skip' | 'throw' | 'fallback';

  /** Human-readable description */
  description: string;
}

interface RetryPolicy {
  /** Maximum retry attempts */
  maxAttempts: number;

  /** Base delay between retries (ms) */
  baseDelayMs: number;

  /** Backoff multiplier */
  backoffMultiplier: number;

  /** Maximum delay (ms) */
  maxDelayMs: number;
}
```

---

## 4. Performance Bounds

```typescript
/**
 * Expected performance characteristics.
 */
interface PerformanceBounds {
  /** Expected latency (p50) */
  expectedLatencyMs: number;

  /** Maximum acceptable latency */
  maxLatencyMs: number;

  /** Expected token usage */
  expectedTokens?: {
    input: number;
    output: number;
  };

  /** Memory usage estimate */
  memoryMB?: number;

  /** Whether this primitive can be parallelized */
  parallelizable: boolean;
}
```

---

## 5. Contract Registry

### 5.1 Registry Interface

```typescript
/**
 * Registry of all primitive contracts.
 */
interface IContractRegistry {
  /**
   * Register a contract for a primitive.
   */
  register<TInput, TOutput>(contract: PrimitiveContract<TInput, TOutput>): void;

  /**
   * Get contract for a primitive.
   */
  get<TInput, TOutput>(primitiveId: PrimitiveId): PrimitiveContract<TInput, TOutput> | null;

  /**
   * List all registered contracts.
   */
  list(): PrimitiveContract<unknown, unknown>[];

  /**
   * Check if a primitive has a contract.
   */
  has(primitiveId: PrimitiveId): boolean;
}
```

### 5.2 Global Registry

```typescript
/**
 * The global contract registry.
 * All primitives MUST register their contracts here.
 */
const contractRegistry: IContractRegistry = createContractRegistry();

// Registration example
contractRegistry.register({
  id: 'contract_tp_semantic_search' as ContractId,
  name: 'Semantic Search Contract',
  primitiveId: 'tp_semantic_search' as PrimitiveId,
  preconditions: [
    {
      id: 'index_exists',
      description: 'Embedding index must exist',
      check: async (_, ctx) => {
        const status = await ctx.storage.getIndexStatus();
        return status.embeddingsIndexed > 0;
      },
      onViolation: 'throw',
      violationMessage: () => 'No embedding index available',
      severity: 'critical',
    },
  ],
  postconditions: [
    {
      id: 'results_sorted',
      description: 'Results are sorted by relevance',
      check: (_, output) => {
        const scores = output.results.map((r) => r.score);
        return scores.every((s, i) => i === 0 || s <= scores[i - 1]);
      },
      onViolation: 'throw',
      violationMessage: () => 'Results not sorted by relevance',
    },
  ],
  invariants: [],
  confidenceDerivation: searchConfidenceDerivation,
  errorSpec: {
    expectedErrors: [
      { code: 'INDEX_STALE', transient: false, handling: 'throw', description: 'Index needs refresh' },
      { code: 'EMBEDDING_TIMEOUT', transient: true, handling: 'retry', description: 'Embedding provider timeout' },
    ],
    retryPolicy: { maxAttempts: 3, baseDelayMs: 100, backoffMultiplier: 2, maxDelayMs: 1000 },
    fallback: 'throw',
  },
  performanceBounds: {
    expectedLatencyMs: 50,
    maxLatencyMs: 500,
    parallelizable: true,
  },
});
```

---

## 6. Runtime Verification

### 6.1 Contract Executor

```typescript
/**
 * Executes a primitive with full contract verification.
 */
interface IContractExecutor {
  /**
   * Execute a primitive with contract verification.
   *
   * @throws ContractViolation if preconditions or postconditions fail
   */
  execute<TInput, TOutput>(
    primitiveId: PrimitiveId,
    input: TInput,
    executor: (input: TInput, context: ExecutionContext) => Promise<TOutput>,
    context: ExecutionContext
  ): Promise<ContractResult<TOutput>>;
}

interface ContractResult<TOutput> {
  /** The output (if successful) */
  output: TOutput;

  /** Contract verification details */
  verification: {
    preconditionsPassed: string[];
    postconditionsPassed: string[];
    invariantsHeld: string[];
    warnings: ContractWarning[];
  };

  /** Derived confidence */
  confidence: ConfidenceValue;

  /** Execution metadata */
  execution: {
    startTime: Date;
    endTime: Date;
    durationMs: number;
    retryCount: number;
  };
}

interface ContractWarning {
  conditionId: string;
  message: string;
  severity: 'warning' | 'info';
}
```

### 6.2 Contract Violation

```typescript
/**
 * Error thrown when a contract is violated.
 */
class ContractViolation extends Error {
  constructor(
    public readonly contractId: ContractId,
    public readonly conditionId: string,
    public readonly conditionType: 'precondition' | 'postcondition' | 'invariant',
    public readonly message: string,
    public readonly input?: unknown,
    public readonly output?: unknown
  ) {
    super(`Contract violation in ${contractId}: ${conditionType} ${conditionId} - ${message}`);
    this.name = 'ContractViolation';
  }
}
```

---

## 7. TDD Test Specifications

### 7.1 Tier-0 Tests (Deterministic)

| Test Case | Input | Expected Output |
|-----------|-------|-----------------|
| `precondition_pass` | Valid input | Execution proceeds |
| `precondition_fail_critical` | Invalid input | ContractViolation thrown |
| `precondition_fail_warning` | Minor issue | Warning recorded, execution proceeds |
| `postcondition_pass` | Valid output | Result returned |
| `postcondition_fail` | Invalid output | ContractViolation thrown |
| `postcondition_retry` | Transient fail | Retry attempted |
| `invariant_check` | During execution | Invariant verified |
| `confidence_derived` | Multiple factors | Combined correctly |
| `retry_with_backoff` | Transient error | Delays increase exponentially |
| `max_retries_exceeded` | Persistent error | Fallback triggered |

### 7.2 Tier-1 Tests (Integration)

| Test Case | Scenario | Acceptance Criteria |
|-----------|----------|---------------------|
| `registry_persists` | Register, restart, lookup | Contract found |
| `executor_records_evidence` | Execute with ledger | Evidence entries created |
| `parallel_execution` | Multiple parallel calls | No race conditions |
| `timeout_handling` | Slow primitive | Times out correctly |

### 7.3 BDD Scenarios

```gherkin
Feature: Primitive Contracts
  As a LiBrainian system
  I want all primitives to have contracts
  So that I can verify correctness and diagnose failures

  Scenario: Successful execution with contract verification
    Given I have a semantic search primitive
    And the embedding index exists
    When I execute a search query
    Then preconditions are verified before execution
    And postconditions are verified after execution
    And the result includes derived confidence

  Scenario: Precondition violation blocks execution
    Given I have a semantic search primitive
    And no embedding index exists
    When I attempt to execute a search query
    Then a ContractViolation is thrown
    And the message indicates "No embedding index available"

  Scenario: Transient error triggers retry
    Given I have a semantic search primitive
    And the embedding provider times out on first call
    When I execute a search query
    Then the primitive is retried
    And on success, the result is returned
    And retry count is recorded in metadata

  Scenario: Confidence derived from multiple factors
    Given I have a semantic search with:
      | Factor | Value |
      | embedding_quality | 0.9 |
      | index_freshness | 0.8 |
      | query_clarity | 0.7 |
    When the search completes
    Then confidence is derived as weighted average
    And derivation provenance is recorded
```

---

## 8. Example Contracts

### 8.1 AST Extraction Contract

```typescript
const astExtractionContract: PrimitiveContract<ExtractionInput, ExtractionOutput> = {
  id: 'contract_tp_ast_extraction' as ContractId,
  name: 'AST Extraction Contract',
  primitiveId: 'tp_ast_extraction' as PrimitiveId,
  preconditions: [
    {
      id: 'file_exists',
      description: 'Source file must exist',
      check: async (input, ctx) => {
        return await ctx.storage.fileExists(input.filePath);
      },
      onViolation: 'throw',
      violationMessage: (input) => `File not found: ${input.filePath}`,
      severity: 'critical',
    },
    {
      id: 'supported_language',
      description: 'Language must be supported',
      check: (input) => SUPPORTED_LANGUAGES.includes(input.language),
      onViolation: 'throw',
      violationMessage: (input) => `Unsupported language: ${input.language}`,
      severity: 'critical',
    },
  ],
  postconditions: [
    {
      id: 'valid_ast',
      description: 'Output contains valid AST',
      check: (_, output) => output.ast !== null && output.parseErrors.length === 0,
      onViolation: 'warn',
      violationMessage: (_, output) => `Parse errors: ${output.parseErrors.join(', ')}`,
    },
    {
      id: 'entities_extracted',
      description: 'At least one entity extracted',
      check: (_, output) => output.entities.length > 0,
      onViolation: 'warn',
      violationMessage: () => 'No entities extracted',
    },
  ],
  invariants: [],
  confidenceDerivation: {
    factors: [
      { id: 'parse_success', source: 'execution_quality', baseWeight: 0.7 },
      { id: 'language_tier', source: 'input_confidence', baseWeight: 0.3 },
    ],
    combiner: 'weighted_average',
  },
  errorSpec: {
    expectedErrors: [
      { code: 'PARSE_ERROR', transient: false, handling: 'fallback', description: 'Could not parse file' },
      { code: 'FILE_TOO_LARGE', transient: false, handling: 'throw', description: 'File exceeds size limit' },
    ],
    retryPolicy: { maxAttempts: 1, baseDelayMs: 0, backoffMultiplier: 1, maxDelayMs: 0 },
    fallback: 'return_empty',
  },
  performanceBounds: {
    expectedLatencyMs: 10,
    maxLatencyMs: 1000,
    parallelizable: true,
  },
};
```

---

## 9. Implementation Status

- [ ] Spec complete
- [ ] Tests written (Tier-0)
- [ ] Tests written (Tier-1)
- [ ] Contract registry implemented
- [ ] Contract executor implemented
- [ ] All primitives have contracts
- [ ] Gate passed

---

## Changelog

| Date | Change |
|------|--------|
| 2026-01-23 | Initial specification |
