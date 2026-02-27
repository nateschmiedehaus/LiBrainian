# Integration Use Case Test Results

**Test Date:** 2026-01-31
**Test Type:** INTEGRATION queries
**Assessment Goal:** Did LiBrainian explain integrations between modules?

---

## Test Summary

| Query | Confidence | Packs Found | Cache Hit | Latency | Result |
|-------|------------|-------------|-----------|---------|--------|
| CLI + API integration | 0.795 | 2 | false | 1556ms | PARTIAL |
| Storage + query integration | 0.846 | 10 | false | 1690ms | GOOD |
| Bootstrap + indexer relationship | 0.492 | 2 | true | 1173ms | POOR |
| MCP server integration points | 0.416 | 1 | false | 1759ms | POOR |
| File watcher + reindexing | 0.681 | 5 | false | 1402ms | PARTIAL |

**Overall Assessment:** MIXED - Integration queries show inconsistent performance

---

## Detailed Results

### Query 1: "how does CLI integrate with API"

**Confidence:** 0.795
**Packs Found:** 2
**Latency:** 1556ms

**Context Packs Returned:**
1. `buildCliEnv()` - Builds sanitized environment for CLI subprocess execution (src/api/llm_provider_discovery.ts, lines 666-676)
2. `detectAuthRuleType()` - Detect auth rule type from description (src/guidance/parser.ts, lines 756-762)

**Assessment:** PARTIAL
- The results do NOT explain how CLI integrates with API
- Instead returned tangential CLI-related functions
- Missing: CLI command handlers, API entry points, CLI->API call flow
- Expected files like `src/cli/commands/*.ts` calling `src/api/*.ts` were not surfaced

---

### Query 2: "storage and query integration"

**Confidence:** 0.846
**Packs Found:** 10
**Latency:** 1690ms

**Context Packs Returned:**
1. `assembleContext()` - Assembles AgentKnowledgeContext from LiBrainian query response (src/api/query.ts, lines 1126-1146)
2. `getQueryCache()` - Gets hierarchical memory cache for query responses (src/api/query.ts, lines 2297-2312)
3. `runSemanticRetrievalStage()` - Embeds query intent and retrieves similar entities (src/api/query.ts, lines 1563-1636)
4. `writePersistentCache()` - Writes cached response to persistent storage (src/api/query.ts, lines 2356-2371)
5. `readPersistentCache()` - Reads cached response from persistent storage (src/api/query.ts, lines 2338-2354)
6. `queryLibrarian()` - Primary API for querying knowledge base (src/api/query.ts, lines 441-1100)
7. `resolveStorageCapabilities()` - Detects storage backend capabilities (src/api/query.ts, lines 2247-2272)
8. `createQueryInterface()` - Factory function creating QueryInterface (src/api/query_interface.ts, lines 46-65)
9. `upsertFunctions()` - Function in sqlite_storage.ts (src/storage/sqlite_storage.ts, lines 1214-1264)
10. `initialize()` - Initialize storage, embedding service, indexer (src/api/LiBrainian.ts, lines 199-340)

**Assessment:** GOOD
- Shows clear integration points between query and storage layers
- Includes cache read/write functions showing storage persistence
- Shows query functions that access storage (resolveStorageCapabilities, getQueryCache)
- Includes sqlite_storage upsert showing data flow to persistence
- Good variety of integration touchpoints

---

### Query 3: "bootstrap and indexer relationship"

**Confidence:** 0.492 (LOW)
**Packs Found:** 2
**Latency:** 1173ms
**Coherence Warning:** "Results appear scattered/incoherent (39%)"

**Context Packs Returned:**
1. `selfBootstrap()` - Bootstrap LiBrainian knowledge index on a codebase (src/agents/self_improvement/self_bootstrap.ts, lines 220-324)
2. `createIndexLibrarian()` - Function in index_librarian.ts (src/agents/index_librarian.ts, lines 1743-1747)

**Assessment:** POOR
- Only 2 results with low confidence
- Results do not explain the RELATIONSHIP between bootstrap and indexer
- Missing: How bootstrap invokes indexer, data flow, sequence of operations
- System flagged results as "scattered/incoherent" at 39%
- Need explicit integration documentation or cross-references

---

### Query 4: "MCP server integration points"

**Confidence:** 0.416 (LOW)
**Packs Found:** 1
**Latency:** 1759ms

**Context Packs Returned:**
1. `createLibrarianMCPServer()` - Create and start a LiBrainian MCP server (src/mcp/server.ts, lines 2662-2667)

**Assessment:** POOR
- Only 1 result with low confidence
- Does NOT explain integration points - just shows server creation
- Missing: How MCP server connects to LiBrainian core, tool handlers, protocol bridges
- Should have returned MCP handler implementations, tool registrations, connection lifecycle

---

### Query 5: "file watcher and reindexing integration"

**Confidence:** 0.681
**Packs Found:** 5
**Latency:** 1402ms

**Context Packs Returned:**
1. `handleFsEvent()` - Handle raw fs.watch event (src/integration/file_watcher_integration.ts, lines 323-342)
2. `onFileChange()` - Register handler for file change events (src/integration/file_watcher_integration.ts, lines 254-259)
3. `createFileWatcher()` - Create new file watcher instance (src/integration/file_watcher_integration.ts, lines 561-563)
4. `calculateModuleComplexity()` - irrelevant (src/knowledge/quality_metrics.ts) - NOISE
5. `assessRisk()` - irrelevant (src/engines/meta_engine.ts) - NOISE

**Assessment:** PARTIAL
- Good: Found file_watcher_integration.ts with relevant functions
- Shows event handling and change registration
- Missing: The actual REINDEXING integration - how watcher triggers reindex
- 2 out of 5 results are noise (not related to file watching or reindexing)
- Needs to show the connection from file change -> reindex trigger

---

## Key Observations

### Strengths
1. **Storage + Query integration worked well** - Retrieved 10 relevant packs showing clear integration patterns
2. **File watcher basics found** - Core file watching functions were identified
3. **Reasonable latency** - All queries completed in under 2 seconds

### Weaknesses
1. **Integration relationships poorly explained** - Results often show individual components, not how they connect
2. **Low pack counts for integration queries** - Many queries returned only 1-2 packs
3. **Noise in results** - Some unrelated functions included (quality_metrics, meta_engine)
4. **Coherence issues flagged** - Bootstrap query showed 39% coherence, indicating scattered results

### Root Causes
1. **Semantic search finds terms, not relationships** - "bootstrap AND indexer" finds documents mentioning either, not their connection
2. **Graph relationships may be incomplete** - Integration edges between modules may not be well-indexed
3. **No cross-module relationship extraction** - System lacks explicit integration pattern detection

---

## Recommendations

1. **Add integration-aware indexing** - Extract and index explicit integration points (function calls between modules, imports, dependency injection)

2. **Improve relationship queries** - Detect "X and Y relationship" patterns and search for edges between X and Y, not just nodes containing X or Y

3. **Add module boundary detection** - Identify when results span multiple modules and boost results that show cross-module connections

4. **Filter noise better** - Results like `calculateModuleComplexity` for a file watcher query should be excluded

5. **Consider integration-specific techniques** - Add a retrieval technique specifically for "how does A connect to B" queries

---

## Scoring

| Metric | Score | Notes |
|--------|-------|-------|
| Relevance | 3/5 | Some queries found relevant code, others missed |
| Completeness | 2/5 | Integration relationships not fully explained |
| Integration Explanation | 2/5 | Shows components but not connections |
| Noise Level | 3/5 | Some irrelevant results mixed in |
| Confidence Calibration | 3/5 | Low confidence correctly flagged poor results |

**Overall Integration UC Score: 2.6/5 - Needs Improvement**
