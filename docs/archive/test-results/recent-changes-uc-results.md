# RECENT CHANGES Use Case Test Results

**Test Date:** 2026-01-31
**LiBrainian Version:** Current development branch (main)

## Executive Summary

**Overall Assessment: POOR - LiBrainian Does NOT Know About Recent Changes**

The LiBrainian fails to provide meaningful information about recent changes. It treats "recent changes" queries as semantic searches for code entities with similar text, rather than accessing actual git history, commit metadata, or change tracking data.

## Test Results

### Query 1: "what changed recently in bootstrap"

**Expected:** Information about recent commits affecting bootstrap.ts, such as:
- `7c2d5a2` fix: improve Claude CLI probe and add offline bootstrap mode
- `d2d6d9c` feat: implement adaptive resource management and epistemic framework

**Actual Result:**
- Confidence: 0.802
- Packs Found: 3
- Content: Generic function signatures from bootstrap-related files
  - `createBootstrapConfig()` from bootstrap.ts
  - `getStatus()` from tiered_bootstrap.ts
  - `setCalibrationTracker()` from workflow_validation_construction.ts

**Assessment:** FAIL - No actual change/commit information returned. Just found functions with "bootstrap" in the path.

---

### Query 2: "recent modifications to storage layer"

**Expected:** Information about commits like:
- `30946be` feat: enable TypeScript strict mode (modified sqlite_storage.ts)
- Actual file changes in storage/*.ts

**Actual Result:**
- Confidence: 0.809
- Packs Found: 9
- Content: Various storage-related functions
  - `createStalenessTracker()` - staleness tracking
  - `getStorageSlices()` - storage access
  - `purgeOldData()` - data cleanup
  - `findDependentFiles()` - dependency analysis
  - Other utility functions

**Assessment:** FAIL - No commit/change information. Just semantic matches for "storage" keyword.

---

### Query 3: "new features added lately"

**Expected:** Information about recently added features like:
- Adaptive resource management
- Epistemic framework
- TypeScript strict mode
- Calibration property-based tests

**Actual Result:**
- Confidence: 0.529 (low)
- Packs Found: 6
- Explanation: "Fell back to general packs (semantic match unavailable)"
- Coverage Gap: "No semantic matches above similarity threshold (0.35)"
- Content: Random high-confidence functions unrelated to recent features

**Assessment:** FAIL - Complete failure. Query too abstract to match semantically, and no change/feature tracking available.

---

### Query 4: "recent bug fixes"

**Expected:** Information about commits like:
- `7c2d5a2` fix: improve Claude CLI probe and add offline bootstrap mode
- `9b3f1f3` fix: resolve 13 failing tests

**Actual Result:**
- Confidence: 0.100 (very low)
- Packs Found: 1
- Content: Single irrelevant function (`setProblemDetector`)

**Assessment:** FAIL - Extremely poor results. The word "bug" or "fix" matched nothing meaningful.

---

### Query 5: "latest commits affecting query.ts"

**Expected:** Information about commits:
- `30946be` feat: enable TypeScript strict mode (modified query.ts)
- Actual commit hashes and messages

**Actual Result:**
- Confidence: 0.557
- Packs Found: 10
- Content: Functions from query.ts and related files
  - `buildQueryCacheKey()` - cache key building
  - `isCommitPayload()` - commit type guard
  - Various test helper functions
  - Functions from federation/query.ts

**Assessment:** PARTIAL FAIL - Found query.ts file content but no actual commit history or change information.

---

## Root Cause Analysis

### Why LiBrainian Fails at "Recent Changes" Queries

1. **No Git History Integration**: The LiBrainian does not query git log, commit history, or change metadata when processing queries. It only searches indexed code entities.

2. **Semantic-Only Matching**: Queries are processed through embedding similarity, which matches words like "bootstrap" to code with "bootstrap" in the text, not to actual change events.

3. **Missing Temporal Awareness**: There is no concept of "recent" in the current system. All indexed content is treated as equally current.

4. **No Change Event Tracking**: Despite having a `diff_indexer.ts` module with functions like `getHighImpactChanges()`, this functionality is not exposed through the query interface.

5. **Intent Classification Gap**: The query intent classifier does not recognize "recent changes" as a distinct query type requiring different data sources.

### What Would Be Needed

1. **Change/Commit Knowledge Packs**: Index git commits as first-class entities with:
   - Commit hash, message, author, date
   - Files changed, lines added/removed
   - Related functions/modules affected

2. **Temporal Query Support**: Add intent classification for temporal queries:
   - "recent", "latest", "new", "last week"
   - Route these to change-aware data sources

3. **Git Integration at Query Time**: For change queries, execute git commands or query indexed change data.

4. **Hybrid Retrieval**: Combine semantic matches with change recency signals.

---

## Detailed Test Output

### Query 1: "what changed recently in bootstrap"

```
Query Results:
  Intent          : what changed recently in bootstrap
  Depth           : L1
  Total Confidence: 0.802
  Packs Found     : 3

Context Packs:
  [function_context] createBootstrapConfig
  Confidence: 0.870
  Summary: Creates a bootstrap configuration by merging defaults with provided overrides.
  File: src/api/bootstrap.ts

  [function_context] getStatus
  Confidence: 0.761
  Summary: Get current bootstrap status.
  File: src/bootstrap/tiered_bootstrap.ts

  [function_context] setCalibrationTracker
  Confidence: 0.779
  Summary: Set the calibration tracker to use.
  File: src/constructions/strategic/workflow_validation_construction.ts
```

### Query 2: "recent modifications to storage layer"

```
Query Results:
  Intent          : recent modifications to storage layer
  Depth           : L1
  Total Confidence: 0.809
  Packs Found     : 9

Context Packs:
  [function_context] createStalenessTracker
  Confidence: 0.793
  File: src/storage/staleness.ts

  [function_context] getStorageSlices
  Confidence: 0.834
  File: src/api/LiBrainian.ts

  [function_context] getStorageCapabilities
  Confidence: 0.764
  File: src/api/LiBrainian.ts

  [function_context] purgeOldData
  Confidence: 0.866
  File: src/api/versioning.ts

  [function_context] findDependentFiles
  Confidence: 0.836
  File: src/agents/self_improvement/self_refresh.ts

  ... (4 more)
```

### Query 3: "new features added lately"

```
Query Results:
  Intent          : new features added lately
  Depth           : L1
  Total Confidence: 0.529
  Packs Found     : 6

Explanation:
  Fell back to general packs (semantic match unavailable).

Coverage Gaps:
  - No semantic matches above similarity threshold (0.35).
```

### Query 4: "recent bug fixes"

```
Query Results:
  Intent          : recent bug fixes
  Depth           : L1
  Total Confidence: 0.100
  Packs Found     : 1

Context Packs:
  [function_context] setProblemDetector
  Confidence: 0.792
  File: src/agents/self_improvement/meta_improvement_loop.ts
```

### Query 5: "latest commits affecting query.ts"

```
Query Results:
  Intent          : latest commits affecting query.ts
  Depth           : L1
  Total Confidence: 0.557
  Packs Found     : 10

Context Packs:
  [function_context] buildQueryCacheKey
  Confidence: 0.844
  File: src/api/query.ts

  [function_context] isCommitPayload
  Confidence: 0.810
  File: src/api/query.ts

  [function_context] getHighImpactChanges
  Confidence: 0.834
  File: src/ingest/diff_indexer.ts

  ... (7 more)
```

---

## Actual Recent Changes (Ground Truth)

```
Recent commits:
7c2d5a2 fix: improve Claude CLI probe and add offline bootstrap mode
d2d6d9c feat: implement adaptive resource management and epistemic framework
30946be feat: enable TypeScript strict mode
f67c065 test(epistemics): add calibration property-based tests
44132b7 docs: add architecture excellence review
e77fa30 feat(epistemics): migrate DerivedConfidence to proven formulas
7540534 feat(epistemics): add calibration laws and semilattice structure

Changes to bootstrap.ts:
- d2d6d9c feat: implement adaptive resource management and epistemic framework
- bee6961 HARD STOP: Circular evaluation
- 7a22f09 chore: initial LiBrainian extraction

Changes to storage layer:
- 30946be feat: enable TypeScript strict mode (sqlite_storage.ts)

Changes to query.ts:
- 30946be feat: enable TypeScript strict mode
```

---

## Recommendations

### Short-term Fixes

1. **Add Change Query Intent**: Create a new intent type for change/history queries that triggers alternative retrieval.

2. **Expose Diff Indexer Data**: The `getHighImpactChanges()` function exists but isn't used in query results. Wire it up.

3. **Git Log Fallback**: For queries containing "recent", "commit", "change", etc., supplement semantic results with git log output.

### Long-term Improvements

1. **Commit Knowledge Graph**: Index commits as nodes with edges to affected files/functions.

2. **Temporal Decay Scoring**: Add recency signals to ranking (files changed recently score higher for change queries).

3. **Change-Aware Pack Types**: Create `[commit_context]` and `[change_context]` pack types with commit metadata.

---

## Conclusion

The LiBrainian currently has **no capability** to answer questions about recent changes. It treats all queries as semantic searches over static code entities. This is a significant gap for developer workflows that frequently involve understanding "what changed" in a codebase.

**Priority:** HIGH - This is a fundamental expected capability for a code intelligence system.
