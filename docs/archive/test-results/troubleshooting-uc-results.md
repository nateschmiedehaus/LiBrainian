# LiBrainian Troubleshooting Query Test Results

**Date:** 2026-01-31
**Test Type:** Troubleshooting Use Case Evaluation
**Mode:** `--no-synthesis` (raw retrieval results only)

## Executive Summary

LiBrainian was tested with 5 common troubleshooting queries to assess its ability to surface relevant code for debugging issues. Overall, the results show **partial effectiveness** for troubleshooting scenarios, with strengths in specific technical domains but significant gaps for general diagnostic queries.

**Overall Assessment:** Would this help troubleshoot issues? **PARTIALLY - with caveats**

| Query | Confidence | Packs | Usefulness | Grade |
|-------|------------|-------|------------|-------|
| Bootstrap fails with zero files error | 0.787 | 9 | Good | B+ |
| Query returns empty results | 0.596 | 6 | Poor | D |
| Database locked error | 0.100 | 1 | Poor | D |
| Embedding generation fails | 0.663 | 10 | Excellent | A |
| Watch mode not detecting changes | 0.546 | 4 | Fair | C |

---

## Detailed Results

### 1. Bootstrap fails with zero files error

**Confidence:** 0.787 | **Packs:** 9 | **Latency:** 1662ms | **Cache:** miss

**Results Quality: GOOD (B+)**

The LiBrainian correctly identified bootstrap-related functions that would be useful for troubleshooting:

| Pack | Confidence | File | Relevance |
|------|------------|------|-----------|
| `ensureReady()` | 0.771 | LiBrainian.ts | HIGH - Checks initialization state |
| `createBootstrapErrorEvent()` | 0.819 | events.ts | HIGH - Error event creation |
| `createBootstrapCompleteEvent()` | 0.830 | events.ts | MEDIUM - Completion tracking |
| `writeBootstrapRecoveryState()` | 0.752 | bootstrap.ts | MEDIUM - Recovery state handling |
| `clearBootstrapRecoveryState()` | 0.752 | bootstrap.ts | MEDIUM - State cleanup |
| `formatError()` | 0.815 | errors.ts | MEDIUM - Error formatting |
| `readBootstrapRecoveryState()` | 0.752 | bootstrap.ts | MEDIUM - State reading |
| `selfBootstrap()` | 0.828 | self_bootstrap.ts | HIGH - Main bootstrap logic |
| `computeChangeFrequency()` | 0.767 | scoring.ts | LOW - Not directly relevant |

**Strengths:**
- Found the main bootstrap function and error handling
- Identified recovery state management functions
- Good coverage of bootstrap lifecycle

**Gaps:**
- Missing file discovery/glob logic that might cause "zero files"
- No config parsing functions that could cause exclusion issues
- No `.gitignore` or pattern matching logic

**Troubleshooting Value:** A developer could use these results to understand bootstrap error events and recovery mechanisms, but might miss the actual cause of "zero files" (likely in file discovery patterns).

---

### 2. Query returns empty results

**Confidence:** 0.596 | **Packs:** 6 | **Latency:** 1574ms | **Cache:** miss

**Results Quality: POOR (D)**

The system fell back to general packs due to no semantic matches above threshold (0.35).

| Pack | Confidence | File | Relevance |
|------|------------|------|-----------|
| `buildQueryEpisode()` | 0.918 | query_episodes.ts | LOW - Logging, not debugging |
| `setCachedQuery()` | 0.912 | query.ts | LOW - Caching, not empty results |
| `createQueryInterface()` | 0.911 | query_interface.ts | LOW - Factory, not troubleshooting |
| `executeDeltaMap()` | 0.908 | delta_map_template.ts | IRRELEVANT |
| `parseSynthesisResponse()` | 0.908 | query_synthesis.ts | LOW - Response parsing |
| `parseYamlDocument()` | 0.903 | infra_map_template.ts | IRRELEVANT |

**Critical Gap Notice:**
```
Coverage Gaps:
  - No semantic matches above similarity threshold (0.35).
```

**Strengths:**
- None for this specific troubleshooting scenario

**Gaps:**
- Missing scoring/ranking logic that determines result thresholds
- Missing embedding similarity computation
- Missing pack filtering logic
- Missing minimum confidence thresholds
- No query preprocessing/normalization code

**Troubleshooting Value:** These results would NOT help a developer debug why queries return empty. The returned functions are about query lifecycle management, not result generation.

---

### 3. Database locked error

**Confidence:** 0.100 | **Packs:** 1 | **Latency:** 997ms | **Cache:** HIT

**Results Quality: POOR (D)**

Extremely low confidence with only a single result returned.

| Pack | Confidence | File | Relevance |
|------|------------|------|-----------|
| `releaseWorkspaceLock()` | 0.752 | workspace_lock.ts | MEDIUM - Lock release only |

**Strengths:**
- Found at least one lock-related function

**Gaps:**
- Missing `acquireWorkspaceLock()` function
- Missing SQLite BUSY/LOCKED error handling
- Missing lock timeout configuration
- Missing lock file path resolution
- Missing concurrent access handling in storage layer
- Missing WAL mode configuration

**Troubleshooting Value:** A single lock release function is insufficient. A developer would need the full locking mechanism, SQLite error handling, and retry logic to debug "database locked" errors.

**Note:** The very low confidence (0.100) and cache hit suggest this query may have been poorly indexed or the cached result is outdated.

---

### 4. Embedding generation fails

**Confidence:** 0.663 | **Packs:** 10 | **Latency:** 1339ms | **Cache:** miss

**Results Quality: EXCELLENT (A)**

Comprehensive coverage of the embedding system.

| Pack | Confidence | File | Relevance |
|------|------------|------|-----------|
| `generateRealEmbedding()` | 0.831 | real_embeddings.ts | HIGH - Core generation |
| `generateEmbedding()` | 0.805 | index.ts | HIGH - Main entry point |
| `generateEmbedding()` | 0.863 | embeddings.ts | HIGH - API layer |
| `generateRealEmbeddings()` | 0.825 | real_embeddings.ts | HIGH - Batch generation |
| `createDefaultProvider()` | 0.808 | index.ts | MEDIUM - Provider setup |
| `setEmbeddingModel()` | 0.808 | real_embeddings.ts | MEDIUM - Model selection |
| `generateXenovaEmbedding()` | 0.802 | real_embeddings.ts | HIGH - Specific provider |
| `embedFileChunks()` | 0.822 | function_chunking.ts | MEDIUM - File processing |
| `createEmbeddingId()` | 0.765 | contracts.ts | LOW - ID creation |
| `getEmbedding()` | 0.799 | types.ts | MEDIUM - Provider access |

**Strengths:**
- Complete coverage of embedding generation pipeline
- Multiple provider implementations (Xenova, sentence-transformers)
- Both single and batch generation functions
- Model configuration functions

**Troubleshooting Value:** Excellent. A developer could trace the entire embedding generation flow from API call through provider selection to actual model invocation.

---

### 5. Watch mode not detecting changes

**Confidence:** 0.546 | **Packs:** 4 | **Latency:** 1622ms | **Cache:** miss

**Results Quality: FAIR (C)**

Partial coverage with some irrelevant results.

| Pack | Confidence | File | Relevance |
|------|------------|------|-----------|
| `isWatching()` | 0.740 | file_watcher_integration.ts | MEDIUM - Status check only |
| `watchCommand()` | 0.752 | watch.ts | MEDIUM - CLI entry point |
| `getWatchState()` | 0.767 | watch_state.ts | MEDIUM - State retrieval |
| `fetchJson()` | 0.767 | pagerduty.ts | IRRELEVANT |

**Strengths:**
- Found core watch-related functions
- Identified state management

**Gaps:**
- Missing actual file system event handlers
- Missing chokidar/fsevents configuration
- Missing ignore pattern logic
- Missing debounce/throttle configuration
- Irrelevant PagerDuty function pollutes results

**Troubleshooting Value:** Partial. Would help understand watch state but missing the actual change detection mechanism (file system watcher configuration, event handlers).

---

## Analysis Summary

### What Works Well

1. **Domain-specific technical queries** - "embedding generation fails" returned excellent results because the query maps directly to well-indexed code domains
2. **Bootstrap-related queries** - Good coverage of initialization and error handling
3. **Multi-signal scoring** - When semantic matches exist, the graph neighbors and community detection improve results

### What Needs Improvement

1. **Generic troubleshooting language** - Queries like "empty results" or "locked error" don't map well to code semantics
2. **Error handling coverage** - Error paths and exception handlers are under-indexed
3. **System state queries** - Configuration and runtime state debugging is poorly supported
4. **Fallback quality** - When semantic match fails, fallback results are often irrelevant

### Recommendations for Better Troubleshooting Support

1. **Index error messages** - Create packs from error message strings and their throw sites
2. **Add troubleshooting-specific synonyms** - "empty results" -> "no matches", "below threshold", "filtered out"
3. **Include configuration code** - Index default values, environment variable handling
4. **Create diagnostic packs** - Special packs for common error scenarios with cross-references
5. **Improve lock/concurrent access indexing** - Database operations need better coverage

### Use Case Verdict

**Would this help troubleshoot issues?**

| Scenario | Verdict |
|----------|---------|
| Technical domain issues (embeddings, parsing) | YES |
| Initialization/bootstrap problems | PARTIALLY |
| Generic error messages | NO |
| Concurrency/locking issues | NO |
| Configuration problems | PARTIALLY |

**Overall:** LiBrainian is useful for troubleshooting when the developer knows the technical domain (e.g., "embedding generation") but struggles with symptom-based queries (e.g., "empty results", "locked error"). For effective troubleshooting support, consider augmenting with error message indexing and diagnostic-specific packs.

---

## Raw Metrics

| Metric | Query 1 | Query 2 | Query 3 | Query 4 | Query 5 | Average |
|--------|---------|---------|---------|---------|---------|---------|
| Confidence | 0.787 | 0.596 | 0.100 | 0.663 | 0.546 | 0.538 |
| Packs | 9 | 6 | 1 | 10 | 4 | 6.0 |
| Entropy | 0.747 | 0.973 | 0.469 | 0.922 | 0.994 | 0.821 |
| Variance | 0.168 | 0.241 | 0.090 | 0.223 | 0.248 | 0.194 |
| Latency (ms) | 1662 | 1574 | 997 | 1339 | 1622 | 1439 |

**Note:** High entropy values (Query 2, 5) indicate uncertainty in results. Query 3's very low confidence (0.100) and single pack suggest a coverage gap in the index.
