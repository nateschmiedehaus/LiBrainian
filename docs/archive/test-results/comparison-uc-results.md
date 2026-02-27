# Comparison Query Use Case Test Results

**Date:** 2026-01-31
**Test Mode:** `--no-synthesis` (LLM disabled, retrieval-only)
**Quality Tier:** MVP

## Summary

| Query | Packs Found | Confidence | Did It Explain Differences? | Rating |
|-------|-------------|------------|----------------------------|--------|
| MVP vs full bootstrap modes | 2 | 0.634 | No | FAIL |
| queryLibrarian vs queryWithLLM | 4 | 0.640 | Partial | PARTIAL |
| context packs vs embeddings | 1 | 0.754 | No | FAIL |
| precondition vs postcondition gates | 5 | 0.681 | Partial | PARTIAL |
| structural scan vs semantic indexing phases | 6 | 0.559 | No | FAIL |

**Overall Assessment:** The LiBrainian fails to adequately handle comparison queries. It retrieves relevant functions but does not present comparative information.

---

## Detailed Results

### Query 1: "difference between mvp and full bootstrap modes"

**Command:**
```bash
npx tsx src/cli/index.ts query "difference between mvp and full bootstrap modes" --no-synthesis
```

**Results:**
- **Latency:** 2849ms
- **Packs Found:** 2
- **Total Confidence:** 0.634

**Context Packs Retrieved:**
1. `getStatus()` - BootstrapStatus getter (0.761 confidence)
2. `createContract()` - Contract creation function (0.788 confidence)

**Assessment:** FAIL
- The query explicitly asks about "difference between MVP and full bootstrap modes"
- Neither returned pack explains bootstrap modes, tiers, or their differences
- `getStatus()` relates to bootstrap status but doesn't explain mode differences
- `createContract()` is entirely unrelated to bootstrap modes
- No comparison or contrast is presented

**Expected:** Functions that define or document MVP tier characteristics vs full tier characteristics (e.g., from `src/bootstrap/tiered_bootstrap.ts` or tier configuration).

---

### Query 2: "queryLibrarian vs queryWithLLM"

**Command:**
```bash
npx tsx src/cli/index.ts query "queryLibrarian vs queryWithLLM" --no-synthesis
```

**Results:**
- **Latency:** 3109ms
- **Packs Found:** 4
- **Total Confidence:** 0.640

**Context Packs Retrieved:**
1. `queryLibrarianWithObserver()` - Wrapper for queryLibrarian (0.901 confidence)
2. `canAnswerFromSummaries()` - Checks if LLM needed (0.866 confidence)
3. `resolveQueryCacheTier()` - Cache tier resolution (0.825 confidence)
4. `query()` - LLM-requiring query execution (0.799 confidence)

**Assessment:** PARTIAL
- Found relevant query-related functions
- `queryLibrarianWithObserver()` is close to `queryLibrarian`
- `query()` mentions LLM requirement but doesn't explain the difference
- `canAnswerFromSummaries()` hints at LLM decision logic
- **Missing:** Direct `queryLibrarian` and `queryWithLLM` function definitions side-by-side
- **Missing:** Explicit explanation of when/why to use each

---

### Query 3: "context packs vs embeddings"

**Command:**
```bash
npx tsx src/cli/index.ts query "context packs vs embeddings" --no-synthesis
```

**Results:**
- **Latency:** 1743ms
- **Packs Found:** 1
- **Total Confidence:** 0.754

**Context Packs Retrieved:**
1. `dedupePacks()` - Pack deduplication utility (0.754 confidence)

**Assessment:** FAIL
- Only 1 pack returned for a comparison query
- `dedupePacks()` is tangentially related to packs but doesn't explain what context packs ARE
- No embedding-related functions returned
- No explanation of the conceptual difference between context packs (structured knowledge bundles) and embeddings (vector representations)

**Expected:** Functions from `src/api/packs.ts`, `src/api/embeddings.ts`, or types defining `ContextPack` and embedding structures.

---

### Query 4: "precondition vs postcondition gates"

**Command:**
```bash
npx tsx src/cli/index.ts query "precondition vs postcondition gates" --no-synthesis
```

**Results:**
- **Latency:** 1093ms
- **Packs Found:** 5
- **Total Confidence:** 0.681

**Context Packs Retrieved:**
1. `mapTechniquePreconditions()` - Precondition conversion (0.860 confidence)
2. `runPostconditionGates()` - Postcondition gate runner (0.816 confidence)
3. `runPreconditionGates()` - Precondition gate runner (0.815 confidence)
4. `definePostcondition()` - Postcondition definition (0.752 confidence)
5. `getCloneClustersWithAnalysis()` - Clone analysis (0.825 confidence) - **NOISE**

**Assessment:** PARTIAL
- Found both precondition and postcondition functions
- `runPreconditionGates()` and `runPostconditionGates()` show the parallel structure
- `mapTechniquePreconditions()` and `definePostcondition()` show definition patterns
- **Missing:** Explanation of WHEN each is used (pre-phase vs post-phase)
- **Missing:** Summary of key differences in purpose
- **Noise:** `getCloneClustersWithAnalysis()` is unrelated

---

### Query 5: "structural scan vs semantic indexing phases"

**Command:**
```bash
npx tsx src/cli/index.ts query "structural scan vs semantic indexing phases" --no-synthesis
```

**Results:**
- **Latency:** 960ms
- **Packs Found:** 6
- **Total Confidence:** 0.559 (lowest)

**Context Packs Retrieved:**
1. `getHighRelevancePatterns()` - Document pattern prioritization (0.821 confidence)
2. `findAlternativeAnalysisMethods()` - Analysis method discovery (0.847 confidence)
3. `suggestNextSteps()` - Next step suggestions (0.840 confidence)
4. `retrieve()` - Hybrid document retrieval (0.797 confidence)
5. `inferMethodFromStage()` - Method inference from stage (0.836 confidence)
6. `betaMean()` - Beta distribution mean (0.792 confidence) - **NOISE**

**Assessment:** FAIL
- None of the returned packs explain bootstrap phases
- No mention of "structural scan" phase or "semantic indexing" phase
- `inferMethodFromStage()` is the closest but doesn't explain the phase differences
- High noise ratio with `betaMean()` completely unrelated
- Lowest confidence (0.559) indicates poor semantic match

**Expected:** Functions from bootstrap phases like `runStructuralScan()`, `runSemanticIndexing()`, or phase definitions.

---

## Root Cause Analysis

### Why Comparison Queries Fail

1. **No Comparison Intent Detection:**
   - The system treats "X vs Y" queries the same as "X" or "Y" queries
   - No special handling to retrieve BOTH concepts and present them side-by-side

2. **Semantic Similarity Limitations:**
   - Embeddings find functions related to EITHER term but not comparative context
   - "vs", "difference", "compared to" keywords don't influence retrieval strategy

3. **No Synthesized Explanations:**
   - With `--no-synthesis`, there's no LLM to explain differences
   - But even with synthesis, the retrieved packs don't support comparison

4. **Missing Conceptual Summaries:**
   - Context packs contain function signatures, not conceptual definitions
   - No "what is X" knowledge chunks that would support comparison

### Recommendations for Improvement

1. **Detect Comparison Intent:**
   ```typescript
   if (query.includes(' vs ') || query.includes('difference between')) {
     // Extract both concepts
     // Retrieve packs for BOTH
     // Return paired results
   }
   ```

2. **Add Conceptual Knowledge Packs:**
   - Index docstrings and README content as conceptual definitions
   - Create "definition" pack types that explain what concepts ARE

3. **Implement Contrastive Retrieval:**
   - When comparing X vs Y, retrieve top-N for X AND top-N for Y
   - Score based on how well each pack explains its respective concept

4. **Add Side-by-Side Output Format:**
   - For comparison queries, structure output as:
     ```
     == X ==
     [packs about X]

     == Y ==
     [packs about Y]

     == Key Differences ==
     [synthesized or extracted differences]
     ```

---

## Metrics Summary

| Metric | Value |
|--------|-------|
| Total Queries | 5 |
| Pass | 0 (0%) |
| Partial | 2 (40%) |
| Fail | 3 (60%) |
| Average Confidence | 0.654 |
| Average Packs Found | 3.6 |
| Average Latency | 1951ms |

**Conclusion:** Comparison queries are a significant weakness of the current retrieval system. The LiBrainian needs dedicated comparison handling logic to provide meaningful answers to "X vs Y" queries.
