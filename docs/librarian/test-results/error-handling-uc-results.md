# Error Handling Use Case Test Results

**Date:** 2026-01-31
**Test Type:** Error Handling Patterns Discovery

## Test Queries Executed

| Query | Status | Packs Found | Confidence | Latency |
|-------|--------|-------------|------------|---------|
| "how are errors handled in this codebase" | SUCCESS | 10 | 0.809 | 1547ms |
| "try catch blocks and error recovery" | SUCCESS | 9 | 0.794 | 1921ms |
| "custom error classes and error types" | SUCCESS | 10 | 0.819 | 7143ms |
| "logging errors" | SUCCESS | 5 | 0.600 | 764ms |
| "graceful degradation patterns" | SUCCESS | 6 | 0.579 | 1278ms |

## Assessment

### 1. Did it find the error handling patterns?

**Partially - Good coverage of error-related functions but missed key structural elements.**

**What Was Found:**

Query 1 - "how are errors handled in this codebase":
- `recordConditionError()` - Error array management
- `formatLlmError()` - LLM error formatting
- `classifyError()` - Error classification into ErrorEnvelope
- `isErrorHandlingCall()` - Error handling call detection
- `createError()` - CliError factory function
- `isNullError()` - Null error detection
- `createErrorEnvelope()` - Structured error creation
- `isErrorEnvelope()` - Type guard for ErrorEnvelope
- `getExitCode()` - Exit code mapping
- `withErrorBoundarySync()` - Sync error boundary

Query 2 - "try catch blocks and error recovery":
- `resume()` - Composition checkpoint recovery
- `formatErrorWithHints()` - Human-readable error formatting
- `executeWithRetry()` - Retry mechanism with contracts
- `handleRetry()` - Stalled agent retry handling
- `extractErrorSignature()` - Bug report error extraction
- `analyzeT23ExceptionPropagation()` - Exception propagation analysis
- `recordOutcome()` - Recovery outcome recording
- `forceResetRecovery()` - Manual recovery intervention
- `acquireWorkspaceLock()` - Lock acquisition with error handling

Query 3 - "custom error classes and error types":
- `formatLlmError()` - LLM error extraction
- `getErrorMessage()` / `getErrorStack()` - Error utility functions
- `classifyError()` - Error classification
- `normalizeError()` - Error normalization
- `isTypeError()` - Type error detection
- `createError()` - Error factory
- `extractErrorType()` - Error type extraction from messages

Query 4 - "logging errors":
- `getErrors()` - Error event retrieval from audit
- `logError()` - Audit error logging
- `logResourceAccess()` - Resource access logging
- `logToolCall()` - Tool call logging with errors
- (Included `computeLogLoss()` - false positive, math function)

Query 5 - "graceful degradation patterns":
- `getTrackedStrategies()` - Degradation strategy tracking
- `detectUnstableAbstractions()` - Architecture smell detection
- `detectStaleGroundings()` - Temporal decay detection
- `groupByDecayFunction()` - Decay function grouping
- `detectGodModules()` - Module coupling detection
- `detectOscillation()` - Improvement loop oscillation detection

### 2. Could you understand the error strategy from results?

**Partial Understanding - The results reveal several key patterns but lack the big picture.**

**What Could Be Understood:**

1. **Error Envelope Pattern**: The codebase uses `ErrorEnvelope` as a structured error format with:
   - Machine-readable error codes
   - Human-readable messages
   - Retryability hints
   - Recovery suggestions

2. **CLI Error Hierarchy**: There's a `CliError` class with specific error codes (PROVIDER_UNAVAILABLE, NOT_BOOTSTRAPPED, etc.)

3. **Error Classification**: The codebase classifies unknown errors into known categories using message pattern matching

4. **Audit Logging**: Errors are logged through an audit system in `src/mcp/audit.ts`

5. **Recovery System**: There's a sophisticated recovery system with strategies for different degradation types

**What Was NOT Clear:**

1. **Core Error Hierarchy**: The primary error class hierarchy in `src/core/errors.ts` was NOT returned in any query results:
   - `LibrarianError` (abstract base class)
   - `StorageError`, `ProviderError`, `ExtractionError`, `ValidationError`, `QueryError`
   - `EmbeddingError`, `DiscoveryError`, `TransactionError`, `SchemaError`
   - `ConfigurationError`, `ExecutionError`, `ParseError`

2. **Error Boundaries**: The complete error boundary system in `src/security/error_boundary.ts` was only partially revealed

3. **Result Type Pattern**: The `Result<T, E>` type pattern in `src/core/result.ts` was NOT discovered at all

### 3. What error handling code was missed?

**Significant components were missed:**

#### A. Core Error Classes (`src/core/errors.ts`)
The entire error hierarchy with 12+ specialized error classes was NOT returned:

```typescript
// These were NOT found:
export abstract class LibrarianError extends Error {
  abstract readonly code: string;
  abstract readonly retryable: boolean;
  readonly timestamp = Date.now();
  toJSON(): ErrorJSON;
  toString(): string;
}

export class StorageError extends LibrarianError { /* ... */ }
export class ProviderError extends LibrarianError { /* ... */ }
export class ExtractionError extends LibrarianError { /* ... */ }
export class ValidationError extends LibrarianError { /* ... */ }
export class QueryError extends LibrarianError { /* ... */ }
export class EmbeddingError extends LibrarianError { /* ... */ }
export class DiscoveryError extends LibrarianError { /* ... */ }
export class TransactionError extends LibrarianError { /* ... */ }
export class SchemaError extends LibrarianError { /* ... */ }
export class ConfigurationError extends LibrarianError { /* ... */ }
export class ExecutionError extends LibrarianError { /* ... */ }
export class ParseError extends LibrarianError { /* ... */ }
```

#### B. Error Factory (`src/core/errors.ts`)
The centralized error factory pattern was NOT discovered:

```typescript
// NOT found:
export const Errors = {
  storage: (operation, message, retryable, cause) => new StorageError(...),
  provider: (provider, reason, message, retryable) => new ProviderError(...),
  extraction: (extractor, phase, message, retryable, filePath) => new ExtractionError(...),
  // ... 9 more factory methods
};
```

#### C. Result Type Pattern (`src/core/result.ts`)
The entire Result monad implementation was missed:

```typescript
// NOT found:
export type Result<T, E = Error> = OkResult<T> | ErrResult<E>;
export const Ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const Err = <E>(error: E): Result<never, E> => ({ ok: false, error });

// Safe wrappers:
export async function safeAsync<T>(fn: () => Promise<T>): Promise<Result<T, Error>>;
export function safeSync<T>(fn: () => T): Result<T, Error>;
export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<Result<T, Error>>;
export async function withRetry<T>(fn: () => Promise<T>, options): Promise<Result<T, Error>>;
```

#### D. Error Boundary Classes (`src/security/error_boundary.ts`)
The specific error classes in the security module were NOT returned:

```typescript
// NOT found:
export class ValidationError extends LibrarianErrorBase { /* ... */ }
export class AuthenticationError extends LibrarianErrorBase { /* ... */ }
export class AuthorizationError extends LibrarianErrorBase { /* ... */ }
export class NotFoundError extends LibrarianErrorBase { /* ... */ }
export class RateLimitError extends LibrarianErrorBase { /* ... */ }
export class InternalError extends LibrarianErrorBase { /* ... */ }
```

#### E. Recovery System (`src/integration/recovery.ts`)
Key recovery components were missed:

```typescript
// NOT found:
export interface RecoveryBudget { /* ... */ }
export type DegradationType = 'stale_index' | 'low_confidence' | 'high_defeater_count' | /* ... */;
export interface RecoveryAction { /* ... */ }
export async function executeRecovery(storage, budget): Promise<RecoveryResult>;
export function planRecoveryActions(diagnoses, budget): RecoveryAction[];
```

#### F. Additional Error Classes Found in Codebase (Not Returned)

From grep analysis, these error classes exist but were not returned:

| File | Error Class |
|------|-------------|
| `src/utils/output_validator.ts` | `OutputValidationError` |
| `src/utils/async.ts` | `TimeoutError` |
| `src/storage/transactions.ts` | `TransactionConflictError` |
| `src/state/index_state.ts` | `IndexNotReadyError` |
| `src/quality/file_size_guard.ts` | `FileSizeError` |
| `src/constructions/base/construction_base.ts` | `ConstructionError`, `ConstructionTimeoutError`, `ConstructionCancelledError` |
| `src/api/bootstrap.ts` | `IngestionTransactionError` |
| `src/api/provider_check.ts` | `ProviderUnavailableError` |
| `src/epistemics/universal_coherence.ts` | `GroundingError`, `NetworkError` |
| `src/epistemics/rollback.ts` | `CheckpointNotFoundError`, `CheckpointVerificationError`, `StateVersionMismatchError`, `RollbackFailedError` |
| `src/epistemics/evidence_ledger.ts` | `MissingAgentAttributionError` |

## Summary Statistics

**Error Handling Infrastructure Size:**
- Custom error classes: 30+ across the codebase
- try-catch blocks: 1,112 occurrences in 347 files
- catch blocks: 599 occurrences in 205 files

**LiBrainian Coverage:**
- Found: 40 error-related functions/utilities (scattered across queries)
- Missed: Core error hierarchy (12 classes), Result type, 15+ specialized error classes
- Class-level discovery: ~30% coverage
- Function-level discovery: ~60% coverage

## Recommendations

1. **Index class declarations**: The LiBrainian heavily prioritizes function-level packs but misses class hierarchies entirely. Error class definitions should be indexed as first-class entities.

2. **Cross-reference type exports**: The `ErrorEnvelope` type and `LibrarianError` base class are central to understanding but were not surfaced in results.

3. **Module-level context**: For error handling, understanding the module structure (e.g., `src/core/errors.ts` as the canonical error module) is more valuable than individual function discovery.

4. **Pattern recognition**: The Result type pattern (`Ok`/`Err` monads) is a significant error handling strategy but was completely missed because it doesn't match "error" in function names.

5. **File-based queries**: Consider adding a "show me the error handling architecture" query type that returns key error-related files rather than individual functions.

## Conclusion

The LiBrainian successfully finds error handling utility functions and some error classification/recovery code, but **fails to surface the fundamental error class hierarchy and structural patterns**. A developer asking "how are errors handled" would understand the ErrorEnvelope format and some utilities but would miss the core `LibrarianError` class hierarchy and the `Result<T, E>` pattern that are central to the codebase's error handling strategy.

**Overall Grade: C+**
- Function discovery: Good
- Class/type discovery: Poor
- Architectural understanding: Insufficient
