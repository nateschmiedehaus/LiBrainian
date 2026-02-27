# Code Navigation Use Case Test Results

**Date:** 2026-01-31
**Test Type:** Code Navigation Accuracy Assessment
**LiBrainian Version:** Current development build

## Executive Summary

| Query | Accuracy | Verdict |
|-------|----------|---------|
| Where is queryLibrarian defined? | PARTIAL | Found related but not exact definition |
| Find classes extending Error | FAIL | Wrong results - no Error subclasses found |
| What calls bootstrap function? | PARTIAL | Found bootstrap-related code but not callers |
| Find LibrarianStorage implementations | PARTIAL | Found users, missed the implementation |
| Go to ContextPack definition | FAIL | Found usages, not the type definition |

**Overall Score: 1/5 accurate, 3/5 partial, 1/5 failed**

---

## Test 1: "Where is function queryLibrarian defined"

### LiBrainian Response
- **Confidence:** 0.840
- **Latency:** 1541ms
- **Top Result:** `queryLibrarianWithObserver` at `src/api/query.ts:1102-1120`

### Ground Truth
```
src/api/query.ts:777 - export async function queryLibrarian(
src/api/query.ts:1537 - export async function queryLibrarianWithObserver(
src/__tests__/mvp_librarian.system.test.ts:107 - export async function queryLibrarian(
```

### Assessment
**Verdict: PARTIAL**

The LiBrainian found `queryLibrarianWithObserver` (a related wrapper function) but the TOP result should have been the main `queryLibrarian` function at line 777. The exact function definition exists at `src/api/query.ts:777` but was not the primary result. The LiBrainian DID point to the correct file (`src/api/query.ts`) in multiple results.

**Issues:**
- Primary definition at line 777 was not the first result
- Returned wrapper function instead of main definition
- However, all results pointed to correct file

---

## Test 2: "Find all classes that extend Error"

### LiBrainian Response
- **Confidence:** 0.799
- **Latency:** 3676ms
- **Top Results:**
  1. `assertCompositionReferences` - validation function (WRONG)
  2. `classifyError` - error classification function (WRONG)
  3. `extractErrorType` - error type extraction (WRONG)
  4. `extractClasses` - class extraction function (WRONG)

### Ground Truth
```
src/cli/errors.ts:388 - class CliError extends Error
src/core/errors.ts:25 - abstract class LibrarianError extends Error
src/utils/output_validator.ts:26 - class OutputValidationError extends Error
src/security/error_boundary.ts:190 - class LibrarianErrorBase extends Error
src/utils/async.ts:22 - class TimeoutError extends Error
src/storage/transactions.ts:15 - class TransactionConflictError extends Error
src/state/index_state.ts:97 - class IndexNotReadyError extends Error
src/constructions/base/construction_base.ts:100 - class ConstructionError extends Error
src/api/provider_check.ts:30 - class ProviderUnavailableError extends Error
src/epistemics/universal_coherence.ts:634 - class GroundingError extends Error
src/epistemics/universal_coherence.ts:652 - class NetworkError extends Error
src/api/bootstrap.ts:2230 - class IngestionTransactionError extends Error
src/epistemics/rollback.ts:165-203 - multiple checkpoint errors
src/epistemics/evidence_ledger.ts:521 - class MissingAgentAttributionError extends Error
src/epistemics/contracts.ts:331 - class ContractViolation extends Error
src/quality/file_size_guard.ts:123 - class FileSizeError extends Error
```

### Assessment
**Verdict: FAIL**

The LiBrainian completely failed this query. It returned functions related to error handling but **NONE** of the actual Error subclasses. This is a fundamental code navigation failure.

**Critical Issues:**
- Zero correct results in top 6
- Returned error-related functions instead of class declarations
- Missed all 15+ Error subclasses in the codebase
- Query type (structural "extends Error" pattern) not recognized

---

## Test 3: "What calls the bootstrap function"

### LiBrainian Response
- **Confidence:** 0.803
- **Latency:** 1393ms
- **Top Results:**
  1. `createBootstrapConfig` - bootstrap config creator
  2. `getBootstrapStatus` - status getter
  3. `createBootstrapStartedEvent` - event creator
  4. `createBootstrapErrorEvent` - event creator
  5. `createBootstrapCompleteEvent` - event creator

### Ground Truth (callers of bootstrapProject)
```
src/api/LiBrainian.ts - calls bootstrapProject
test/LiBrainian.system.test.ts - calls bootstrap functions
src/cli/commands/bootstrap.ts - bootstrapCommand calls bootstrap APIs
```

### Assessment
**Verdict: PARTIAL**

The LiBrainian found bootstrap-RELATED code but did not correctly identify the CALLERS. The query asked "what calls bootstrap" but the results show bootstrap-adjacent functions, not call sites.

**Issues:**
- Did not show actual call sites
- Returned definitions/creators instead of callers
- Query intent (call graph navigation) not properly handled
- Did correctly identify bootstrap-related files

---

## Test 4: "Find implementations of LibrarianStorage interface"

### LiBrainian Response
- **Confidence:** 0.567 (lowest of all queries)
- **Latency:** 971ms
- **Explanation:** "Definition query detected: boosted interface/type declarations over implementations"
- **Top Results:**
  1. `getStorage(): LibrarianStorage | null` - getter returning type
  2. `resolveQueryCacheTier` - unrelated query function
  3. `getCurrentVersion` - version function
  4. `getEngines` - engine getter
  5. `createSqliteStorage` - factory function (CLOSE but not implementation)

### Ground Truth
```
Interface: src/storage/types.ts:61 - export interface LibrarianStorage
Implementation: src/storage/sqlite_storage.ts:225 - export class SqliteLibrarianStorage implements LibrarianStorage
```

### Assessment
**Verdict: PARTIAL**

The LiBrainian paradoxically noted it "boosted interface/type declarations over implementations" when the query explicitly asked for IMPLEMENTATIONS. Result #5 (`createSqliteStorage`) is close but the actual implementing class `SqliteLibrarianStorage` was not surfaced.

**Issues:**
- Query intent misclassified (asked for implementations, boosted definitions)
- The sole implementation class not in top results
- Factory function found but not the actual class
- Low confidence (0.567) indicates system uncertainty

---

## Test 5: "Go to definition of ContextPack type"

### LiBrainian Response
- **Confidence:** 0.633
- **Latency:** 760ms (cache hit)
- **Explanation:** "Definition query detected: boosted interface/type declarations over implementations"
- **Top Results:**
  1. `getContextPack` - function returning ContextPack
  2. `buildPackIndex` - function using ContextPack
  3. `makePack` - test helper creating ContextPack
  4. `isCompileIntentBundlesToolInput` - type guard
  5. `resolveContextLevel` - context level resolver

### Ground Truth
```
src/types.ts:238 - export interface ContextPack {
```

### Assessment
**Verdict: FAIL**

Despite the system noting "Definition query detected", it did NOT return the actual type definition at `src/types.ts:238`. All results are functions that USE ContextPack, not the definition itself.

**Critical Issues:**
- The actual definition location (`src/types.ts:238`) not in results
- "Definition query detected" message suggests intent was recognized
- Results are all usages, not the definition
- This is the canonical "go to definition" IDE operation - critical failure

---

## Root Cause Analysis

### Pattern: Semantic Similarity Over Structural Accuracy

The LiBrainian consistently returns semantically related content but fails at structural code navigation patterns:

1. **"extends Error"** - requires AST/inheritance relationship understanding
2. **"what calls X"** - requires call graph analysis
3. **"implements Interface"** - requires implementation tracking
4. **"go to definition"** - requires symbol resolution

### Missing Capabilities

1. **Symbol Resolution:** No direct mapping from symbol name to definition location
2. **Inheritance Graph:** No tracking of class extends/implements relationships
3. **Call Graph:** No indexing of function call sites
4. **Query Intent Classification:** Misclassifies "find implementations" as definition query

### Recommendations

1. **Add symbol index:** Direct name-to-location mapping for definitions
2. **Build inheritance graph:** Track extends/implements relationships
3. **Index call sites:** Enable "find callers" queries
4. **Fix intent classification:** "Find implementations" should not boost definitions
5. **Add structural query mode:** For AST-pattern queries vs semantic queries

---

## Summary Statistics

| Metric | Value |
|--------|-------|
| Total Queries | 5 |
| Fully Correct | 0 |
| Partially Correct | 3 |
| Failed | 2 |
| Avg Confidence | 0.728 |
| Avg Latency | 1.46s |

**Conclusion:** The LiBrainian performs semantic search well but lacks fundamental code navigation capabilities (go-to-definition, find-references, find-implementations, call-graph). These are standard IDE features that users expect from a code intelligence tool.
