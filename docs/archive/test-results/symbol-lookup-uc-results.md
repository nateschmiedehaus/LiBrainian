# Symbol Lookup Use Case Test Results

**Date:** 2026-01-31
**Test Type:** Specific Symbol Lookup (Exact Name Matching)
**Mode:** --no-synthesis (raw retrieval only)

## Summary

| Symbol | Found Exact Match? | Confidence | Location in Results | Verdict |
|--------|-------------------|------------|---------------------|---------|
| `SqliteLibrarianStorage` class | NO | 0.779 | Not in results | FAIL |
| `bootstrapProject` function | NO | 0.797 | Not in results | FAIL |
| `LibrarianQuery` type | PARTIAL | 0.857 | Via usages, not definition | PARTIAL |
| `createSpinner` utility | NO | 0.910 | Not in results | FAIL |
| `EXCLUDE_PATTERNS` constant | PARTIAL | 0.821 | Via `isExcluded()` function | PARTIAL |

**Overall Assessment: 0/5 EXACT MATCHES - CRITICAL FAILURE**

---

## Detailed Results

### 1. SqliteLibrarianStorage class

**Query:** `"SqliteLibrarianStorage class"`
**Expected:** `src/storage/sqlite_storage.ts:225` - `export class SqliteLibrarianStorage implements LibrarianStorage`
**Latency:** 1923ms
**Confidence:** 0.779

**Actual Results (Top 4):**
1. `createSqliteStorage` function (lines 6045-6047) - Confidence: 0.794
2. `getModuleByPath` function (lines 1320-1326) - Confidence: 0.767
3. `createFederatedId` function (unrelated file) - Confidence: 0.789
4. `getProviderRegistry` function (unrelated file) - Confidence: 0.764

**Analysis:**
- The LiBrainian found functions IN the same file but NOT the class definition itself
- The class `SqliteLibrarianStorage` at line 225 was NOT returned
- Instead, it returned a factory function that creates the class instance
- This suggests the indexer may not be capturing class definitions as first-class entities

**Verdict:** FAIL - Did not return the actual class definition

---

### 2. bootstrapProject function

**Query:** `"bootstrapProject function"`
**Expected:** `src/api/bootstrap.ts:821` - `export async function bootstrapProject(...)`
**Latency:** 1412ms
**Confidence:** 0.797

**Actual Results (Top 10):**
1. `createBootstrapStartedEvent` - events.ts:60-62 - Confidence: 0.818
2. `createBootstrapCompleteEvent` - events.ts:68-70 - Confidence: 0.830
3. `createBootstrapErrorEvent` - events.ts:198-200 - Confidence: 0.819
4. `createBootstrapConfig` - bootstrap.ts:2978-2987 - Confidence: 0.870
5. `getBootstrapStatus` - bootstrap.ts:773-783 - Confidence: 0.822
6. `createTieredBootstrap` - tiered_bootstrap.ts:1053-1057 - Confidence: 0.812
7. `resolveSuggestionConfig` - bootstrap.ts:2886-2890 - Confidence: 0.737
8. `isBootstrapPhaseProgress` - bootstrap.ts:280-287 - Confidence: 0.752
9. `isPlainObject` - bootstrap.ts:2481-2485 - Confidence: 0.767
10. `isBootstrapRecoveryState` - bootstrap.ts:246-264 - Confidence: 0.752

**Analysis:**
- The actual `bootstrapProject` function at line 821 was NOT returned
- Results are bootstrap-RELATED but not the exact function requested
- Found many helper/utility functions from bootstrap.ts but missed the main export
- The semantic search found "bootstrap" concept but failed at precise symbol matching

**Verdict:** FAIL - Did not return the actual `bootstrapProject` function

---

### 3. LibrarianQuery type definition

**Query:** `"LibrarianQuery type definition"`
**Expected:** `src/types.ts:783` - `export interface LibrarianQuery`
**Latency:** 1463ms
**Confidence:** 0.857

**Actual Results (Top 10):**
1. `buildFollowUpQuery` - context_sessions.ts:417-425 - Confidence: 0.895
2. `queryLibrarianWithObserver` - query.ts:1102-1120 - Confidence: 0.901
3. `buildDrillDownQuery` - context_sessions.ts:427-435 - Confidence: 0.885
4. `extractQueryDepth` - query.ts:2322-2326 - Confidence: 0.903
5. `resolveQueryCacheTier` - query.ts:2314-2316 - Confidence: 0.825
6. `buildContextQuery` - context_assembly.ts:272-274 - Confidence: 0.841
7. `query` - LiBrainian.ts:674-676 - Confidence: 0.799
8. `resolveQueryCacheTtl` - query.ts:2318-2320 - Confidence: 0.829
9. `queryRequired` - LiBrainian.ts:678-681 - Confidence: 0.817
10. `createFallbackQueryInterface` - context_assembly.ts:103-109 - Confidence: 0.877

**Analysis:**
- The type definition in `src/types.ts:783` was NOT returned
- All results are USAGES of `LibrarianQuery` as a parameter type
- The system found functions that USE the type but not the type definition itself
- This indicates type/interface definitions are not being indexed or ranked properly

**Verdict:** PARTIAL - Found usages but not the actual type definition

---

### 4. createSpinner utility

**Query:** `"createSpinner utility"`
**Expected:** `src/cli/progress.ts:20` - `export function createSpinner(initialMessage: string): SpinnerHandle`
**Latency:** 2641ms
**Confidence:** 0.910 (highest!)

**Actual Results (Top 6):**
1. `buildQueryEpisode` - query_episodes.ts:18-76 - Confidence: 0.918
2. `setCachedQuery` - query.ts:2328-2336 - Confidence: 0.912
3. `createQueryInterface` - query_interface.ts:46-65 - Confidence: 0.911
4. `executeDeltaMap` - delta_map_template.ts:488-573 - Confidence: 0.908
5. `parseSynthesisResponse` - query_synthesis.ts:321-379 - Confidence: 0.908
6. `parseYamlDocument` - infra_map_template.ts:814-822 - Confidence: 0.903

**Coverage Gap Note:** "No semantic matches above similarity threshold (0.35)"

**Analysis:**
- COMPLETE MISS - `createSpinner` at `src/cli/progress.ts:20` not found at all
- System fell back to "general packs" with completely unrelated results
- The word "spinner" and "utility" triggered no relevant semantic matches
- Ironically has the HIGHEST confidence (0.910) while being completely wrong
- This is the worst failure case - high confidence on completely wrong results

**Verdict:** FAIL - Total miss, returned unrelated results with high confidence

---

### 5. EXCLUDE_PATTERNS constant

**Query:** `"EXCLUDE_PATTERNS constant"`
**Expected:** `src/universal_patterns.ts:533` - `export const EXCLUDE_PATTERNS = UNIVERSAL_EXCLUDES`
**Latency:** 1916ms
**Confidence:** 0.821

**Actual Results (Top 10):**
1. `createOptionalPrimitive` - pattern_catalog.ts:236-243 - Confidence: 0.856
2. `buildPatternPack` - packs.ts:343-379 - Confidence: 0.863
3. `validatePatternCatalog` - pattern_catalog.ts:330-352 - Confidence: 0.856
4. `buildPatternSummaryInput` - packs.ts:625-631 - Confidence: 0.842
5. `patternConfidence` - pattern_catalog.ts:214-216 - Confidence: 0.797
6. `findPatterns` - tdd_engine.ts:564-602 - Confidence: 0.767
7. `isExcluded` - universal_patterns.ts:491-501 - Confidence: 0.850
8. `globToRegex` - universal_patterns.ts:365-388 - Confidence: 0.828
9. `getAllIncludePatterns` - universal_patterns.ts:406-412 - Confidence: 0.801
10. `analyzeAllTPatterns` - t_patterns.ts:2418-2609 - Confidence: 0.757

**Analysis:**
- The constant `EXCLUDE_PATTERNS` at `src/universal_patterns.ts:533` was NOT directly returned
- Found functions from the same file (`isExcluded`, `globToRegex`, `getAllIncludePatterns`) that use the constant
- Found pattern-RELATED functions from other files
- Semantic search matched "pattern" and "exclude" concepts but not the constant itself
- Constants/variables appear to not be indexed as first-class entities

**Verdict:** PARTIAL - Found related functions from same file, not the constant itself

---

## Root Cause Analysis

### Why Exact Symbol Lookup Fails

1. **No Symbol Table Index**
   - The LiBrainian appears to lack a dedicated symbol-to-location index
   - It relies on semantic similarity of function summaries, not symbol names
   - Class definitions, type definitions, and constants are not first-class indexed entities

2. **Semantic Matching Overrides Exact Matching**
   - Query "SqliteLibrarianStorage class" matches "sqlite" + "storage" semantically
   - This finds functions IN sqlite_storage.ts but not the class itself
   - No exact string matching on symbol names

3. **Function-Centric Indexing**
   - The system heavily indexes functions (as seen by `[function_context]` pack types)
   - Classes, interfaces, types, and constants appear under-indexed
   - Only function signatures are captured in pack summaries

4. **Confidence Scores Uncorrelated with Relevance**
   - `createSpinner` query: 0.910 confidence - 100% wrong results
   - High confidence means "matched something" not "matched the right thing"
   - No penalty for failing to find the exact requested symbol

5. **No Fallback to Symbol Search**
   - When semantic search fails to find exact matches, no fallback to AST/symbol lookup
   - System returns "general packs" instead of admitting it cannot find the symbol

---

## Recommendations

### Critical Fixes Needed

1. **Add Symbol Name Index**
   ```typescript
   // Index structure needed:
   Map<symbolName, { file: string, line: number, kind: 'class' | 'function' | 'type' | 'const' }>
   ```

2. **Index All Entity Types**
   - Classes and their methods
   - Interfaces and type aliases
   - Constants and exported variables
   - Enums

3. **Exact Match Priority**
   - If query contains a symbol name that exists, prioritize exact match
   - Fall back to semantic only if no exact match found

4. **Query Intent Detection**
   - Detect queries asking for specific symbols: "X class", "X function", "X type"
   - Route these to symbol index first, semantic index second

5. **Calibrate Confidence Properly**
   - Confidence should drop significantly when falling back to general packs
   - "No semantic matches" should result in low confidence, not 0.910

---

## Verified Symbol Locations (Ground Truth)

| Symbol | Actual Location |
|--------|-----------------|
| `SqliteLibrarianStorage` | `src/storage/sqlite_storage.ts:225` |
| `bootstrapProject` | `src/api/bootstrap.ts:821` |
| `LibrarianQuery` | `src/types.ts:783` |
| `createSpinner` | `src/cli/progress.ts:20` |
| `EXCLUDE_PATTERNS` | `src/universal_patterns.ts:533` |

---

## Conclusion

The LiBrainian **fundamentally cannot perform exact symbol lookup**. It is designed for semantic/conceptual queries ("how does authentication work?") but fails at precise code navigation ("where is class X defined?").

For a code intelligence tool, this is a critical gap. Developers frequently need to find exact symbol definitions, and the current system would consistently mislead them with semantically-related but incorrect results.

**Severity:** CRITICAL
**User Impact:** Developers will waste time looking at wrong code locations
**Trust Impact:** High-confidence wrong answers erode trust in the tool
