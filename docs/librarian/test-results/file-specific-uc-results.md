# File-Specific Query Test Results

**Test Date:** 2026-01-31
**Test Type:** FILE-SPECIFIC use case queries
**Flag:** `--no-synthesis`

## Executive Summary

| Query | File Found? | Accurate Explanation? | Grade |
|-------|-------------|----------------------|-------|
| explain src/api/bootstrap.ts | Partial | Partial | C |
| what does src/storage/sqlite_storage.ts do | Partial | Partial | C |
| summarize src/cli/index.ts | No | No | F |
| purpose of src/epistemics/calibration.ts | No | No | F |
| overview of src/query/multi_signal_scorer.ts | Yes | Yes | A |

**Overall Assessment:** POOR (2/5 queries successful)

---

## Detailed Test Results

### Query 1: "explain src/api/bootstrap.ts"

**Expected Behavior:** Return context packs that explain what `src/api/bootstrap.ts` does.

**Actual File Purpose (from source):**
- Bootstrap API for LiBrainian
- Orchestrates workspace initialization including: code indexing, knowledge graph building, embedding generation, ingestion from multiple sources (docs, config, CI, tests, deps, security, etc.)
- Handles bootstrap phases, recovery state, and progress tracking
- Creates and manages bootstrap configurations
- Key exports: `createBootstrapConfig`, `bootstrapStatePath`, various ingestion source integrations

**What LiBrainian Returned:**
- Confidence: 0.781
- 10 context packs found
- Top pack: `createBootstrapConfig` function (confidence 0.870) - CORRECT
- Also found: `isPlainObject`, `resolveSuggestionConfig`, `isBootstrapPhaseProgress`, `normalizeIngestionPath` - all from bootstrap.ts - CORRECT
- Found test file context and LiBrainian.ts functions - tangentially related

**Assessment:**
- **Pros:** Did find several functions from the target file
- **Cons:** Did not provide a file-level summary explaining what bootstrap.ts does as a whole; returned individual function contexts instead of a cohesive file explanation
- **Grade: C** - Found the right file and its functions, but failed to synthesize a file-level explanation

---

### Query 2: "what does src/storage/sqlite_storage.ts do"

**Expected Behavior:** Return explanation of the SQLite storage implementation.

**Actual File Purpose (from source):**
- SQLite storage implementation for LiBrainian using better-sqlite3
- Stores embeddings as BLOBs with brute-force cosine similarity search
- Implements `LibrarianStorage` interface
- Provides SQL injection prevention with allowlisted columns/tables
- Key functions: `createStorageFromBackend`, `createSqliteStorage`, `getModuleByPath`, etc.

**What LiBrainian Returned:**
- Confidence: 0.803
- 8 context packs found
- Top pack: `createStorageFromBackend` function (confidence 0.880) - CORRECT
- Also found: `createSqliteStorage`, `getModuleByPath`, `setVersion`, `isCodeSnippet` - all from sqlite_storage.ts - CORRECT
- Included unrelated: `createContentCache` (content_cache.ts), `createDeveloperExperienceConstruction`, `fromDebtMetrics` - NOISE

**Assessment:**
- **Pros:** Found the target file and several key functions
- **Cons:** Included unrelated files; no high-level explanation of what the storage module does
- **Grade: C** - Partial success, but noisy results and no cohesive explanation

---

### Query 3: "summarize src/cli/index.ts"

**Expected Behavior:** Return a summary of the CLI entry point file.

**Actual File Purpose (from source):**
- CLI entry point for LiBrainian
- Defines all CLI commands: status, query, bootstrap, inspect, confidence, validate, check-providers, visualize, watch, contract, diagnose, health, heal, evolve, eval, replay, analyze, config heal
- Parses command line arguments with `parseArgs`
- Routes to individual command handlers
- Provides structured error handling with JSON output support

**What LiBrainian Returned:**
- Confidence: 0.669 (lowest of all tests)
- 10 context packs found
- **No packs from src/cli/index.ts at all**
- Top pack: `summarizeContextSession` from LiBrainian.ts - WRONG FILE
- Other results: `buildFunctionPack`, `summarizeResponse`, `summarizeDependencies`, `summarizeIngestionItem` - all unrelated "summarize" functions

**Assessment:**
- **Pros:** None
- **Cons:** Completely missed the target file; semantic search matched "summarize" keyword to unrelated summarization functions
- **Critical Failure:** The file path was in the query but the system did not prioritize path-based matching
- **Grade: F** - Complete failure to find the requested file

---

### Query 4: "purpose of src/epistemics/calibration.ts"

**Expected Behavior:** Return explanation of the calibration module.

**Actual File Purpose (from source):**
- Calibration curve computation from outcome samples (Track F C2)
- Computes bucketed calibration curves
- Calculates Expected Calibration Error (ECE) and Maximum Calibration Error (MCE)
- Key exports: `computeCalibrationCurve`, `CalibrationSample`, `CalibrationBucket`, `CalibrationCurve`, `CalibrationReport`

**What LiBrainian Returned:**
- Confidence: 0.738
- 10 context packs found
- **No packs from src/epistemics/calibration.ts**
- Top pack: `applyCalibrationToPacks` from confidence_calibration.ts - RELATED BUT WRONG FILE
- Other results scattered across: calibration_laws.ts, task_validation.ts, measurement/calibration.ts, confidence.ts
- Found calibration-related functions but not from the specific file requested

**Assessment:**
- **Pros:** Found calibration-related code across the codebase
- **Cons:** Did not return any content from the specific file mentioned in the query
- **Critical Failure:** Query explicitly named the file path, but path-based lookup was not performed
- **Grade: F** - Failed to find the specific file, though found thematically related content

---

### Query 5: "overview of src/query/multi_signal_scorer.ts"

**Expected Behavior:** Return explanation of the multi-signal scoring system.

**Actual File Purpose (from source):**
- Multi-Signal Relevance Scorer combining 13 signals:
  1. Semantic similarity (embeddings)
  2. Structural proximity (AST/file distance)
  3. History correlation (co-change patterns)
  4. Access recency
  5. Query term match
  6. Domain relevance
  7. Entity type match
  8. Ownership match
  9. Risk correlation
  10. Test correlation
  11. Dependency distance
  12. Hotspot (churn + complexity)
  13. Directory affinity
- Implements learned weights and feedback-based weight updates

**What LiBrainian Returned:**
- Confidence: 0.796
- 10 context packs found
- **All top 10 packs from src/query/multi_signal_scorer.ts** - PERFECT
- Functions found: `scoreEntity`, `combineSignals`, `updateWeights`, `registerComputer`, `generateExplanation`, `scoreEntities`, `getWeights`, `setWeight`, `fromJSON`, `computeChurnScore`

**Assessment:**
- **Pros:** Excellent result - found all relevant functions from the target file
- **Cons:** Still lacks a cohesive file-level summary
- **Grade: A** - Successfully identified the correct file and returned relevant function contexts

---

## Critical Issues Identified

### 1. No File Path Recognition
The system does not appear to recognize when a query explicitly mentions a file path. Queries like "summarize src/cli/index.ts" should trigger a direct file lookup, but instead the system:
- Performs semantic search on "summarize"
- Ignores the explicit file path entirely
- Returns unrelated functions with similar names

### 2. Semantic Keyword Matching Dominates
The system over-relies on semantic similarity of keywords rather than recognizing explicit file references:
- "summarize" matches summarization functions
- "calibration" matches calibration-related code but not the specific file
- "purpose" matches purpose-related content

### 3. No File-Level Summaries
Even when the correct file is found (bootstrap.ts, sqlite_storage.ts, multi_signal_scorer.ts), the system returns individual function contexts rather than a cohesive file-level explanation.

### 4. Inconsistent Success
- Success depends heavily on how distinctive the file's function names are
- multi_signal_scorer.ts succeeded because its functions have unique names
- cli/index.ts failed because "summarize" is too generic

---

## Recommendations

### High Priority
1. **Implement explicit file path detection** - When query contains a recognizable file path pattern (e.g., `src/.../*.ts`), prioritize direct file lookup over semantic search
2. **Add file-level summary generation** - For file-specific queries, generate or retrieve a file-level summary rather than just function contexts

### Medium Priority
3. **Weight path matching higher** - When file path tokens appear in query, boost results from matching paths
4. **Add query intent classification** - Detect when user wants file-specific info vs. conceptual search

### Low Priority
5. **Consider module-level context packs** - Create and return module-level packs for file-specific queries

---

## Test Commands Used

```bash
npx tsx src/cli/index.ts query "explain src/api/bootstrap.ts" --no-synthesis
npx tsx src/cli/index.ts query "what does src/storage/sqlite_storage.ts do" --no-synthesis
npx tsx src/cli/index.ts query "summarize src/cli/index.ts" --no-synthesis
npx tsx src/cli/index.ts query "purpose of src/epistemics/calibration.ts" --no-synthesis
npx tsx src/cli/index.ts query "overview of src/query/multi_signal_scorer.ts" --no-synthesis
```

---

## Raw Output Samples

### Query 1 Output (bootstrap.ts)
```
Total Confidence: 0.781
Packs Found: 10
Top Pack: createBootstrapConfig - Confidence: 0.870
  Summary: Creates a bootstrap configuration by merging defaults with provided overrides.
  File: src/api/bootstrap.ts
```

### Query 3 Output (cli/index.ts) - FAILURE
```
Total Confidence: 0.669
Packs Found: 10
Top Pack: summarizeContextSession - Confidence: 0.792
  Summary: Generate a summary of a context session
  File: src/api/LiBrainian.ts  <-- WRONG FILE
```

### Query 5 Output (multi_signal_scorer.ts) - SUCCESS
```
Total Confidence: 0.796
Packs Found: 10
Top Pack: scoreEntity - Confidence: 0.845
  Summary: Score a single entity against a query context
  File: src/query/multi_signal_scorer.ts  <-- CORRECT FILE
```
