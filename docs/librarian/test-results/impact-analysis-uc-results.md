# Impact Analysis Use Case Test Results

**Test Date:** 2026-01-31
**Test Environment:** LiBrainian CLI with `--no-synthesis` flag
**Purpose:** Evaluate LiBrainian's ability to predict code change impact

## Executive Summary

| Query | Confidence | Accuracy | Verdict |
|-------|------------|----------|---------|
| bootstrap.ts impact | 0.795 | Partial | WEAK |
| LibrarianStorage interface | 0.789 | Poor | FAIL |
| query.ts blast radius | 0.799 | Mixed | WEAK |
| embeddings downstream effects | 0.637 | Partial | WEAK |
| types.ts ripple effects | 0.522 | Poor | FAIL |

**Overall Assessment: INADEQUATE for impact analysis use cases**

The LiBrainian system demonstrates fundamental limitations in performing accurate impact analysis. While it successfully identifies semantically related code, it fails to trace actual dependency chains, call hierarchies, and interface implementations that constitute true "impact" analysis.

---

## Detailed Test Results

### Test 1: "what would break if I change bootstrap.ts"

**Query:** `npx tsx src/cli/index.ts query "what would break if I change bootstrap.ts" --no-synthesis`

**LiBrainian Results:**
- Confidence: 0.795
- Latency: 2110ms
- Packs Found: 10

**Key Findings Returned:**
1. `createBootstrapConfig()` - bootstrap.ts (correct - self-reference)
2. `forceRebootstrap()` - LiBrainian.ts (correct consumer)
3. `ensureReady()` - LiBrainian.ts (related but not direct consumer)
4. `isReady()` - LiBrainian.ts (related but not direct consumer)
5. `createMockConfig()` - validation_gates.test.ts (test file)
6. Various test helper functions

**Actual Impact (from grep analysis):**
- 34 files import from bootstrap
- Key consumers NOT identified:
  - `src/cli/commands/bootstrap.ts` (CLI command handler)
  - `src/cli/commands/query.ts` (uses bootstrap config)
  - `src/bootstrap/index.ts` (bootstrap subsystem)
  - `src/integration/index.ts` (integration layer)
  - Multiple test files in agents/self_improvement

**Accuracy Assessment:** PARTIAL (40% recall)

**Issues:**
- Returned functions FROM bootstrap.ts rather than things that DEPEND ON it
- Missed CLI command handlers that are primary consumers
- Did not trace the full dependency tree
- Test files returned but critical production code missed

---

### Test 2: "impact of modifying LibrarianStorage interface"

**Query:** `npx tsx src/cli/index.ts query "impact of modifying LibrarianStorage interface" --no-synthesis`

**LiBrainian Results:**
- Confidence: 0.789
- Latency: 1586ms
- Packs Found: 10

**Key Findings Returned:**
1. `getStorage()` - LiBrainian.ts (accessor, not implementing)
2. `resolveQueryCacheTier()` - query.ts (unrelated)
3. `createLibrarianSync()` - LiBrainian.ts (factory, not interface consumer)
4. `createSelfImprovementReportGenerator()` - self_improvement_report.ts (uses storage)
5. `createSqliteStorage()` - sqlite_storage.ts (implementation - correct)
6. `setStorage()` - self_index_validator.ts (injection point)
7. `createStalenessTracker()` - staleness.ts (uses storage)

**Actual Impact (from grep analysis):**
- **240 files** reference LibrarianStorage
- Critical implementors/consumers NOT identified:
  - `src/storage/sqlite_storage.ts` - Primary implementation (6000+ lines)
  - `src/storage/types.ts` - Interface definition itself
  - `src/agents/` - 20+ agent files using storage
  - `src/knowledge/` - All knowledge extractors
  - `src/graphs/` - Graph analysis modules
  - `src/state/` - All state management modules

**Accuracy Assessment:** POOR (15% recall)

**Issues:**
- Did not identify the interface DEFINITION location
- Missed the primary SQLite implementation details
- Random sampling of consumers, no systematic traversal
- Query cache tier function returned is completely unrelated

---

### Test 3: "blast radius of changes to query.ts"

**Query:** `npx tsx src/cli/index.ts query "blast radius of changes to query.ts" --no-synthesis`

**LiBrainian Results:**
- Confidence: 0.799
- Latency: 1842ms
- Packs Found: 10

**Key Findings Returned:**
1. `resolveCochangeAnchors()` - query.ts (self-reference)
2. `resolveQueryCacheTtl()` - query.ts (self-reference)
3. `createEmptyResponse()` - federation/query.ts (related query module)
4. `reset()` - query_batcher.ts (related utility)
5. `query()` - impact.ts (different query concept)
6. `resolveBatchSize()` - embeddings.ts (unrelated)
7. `getBlastRadius()` - relevance_engine.ts (semantic match on "blast radius")
8. `analyzeBlastRadius()` - impact.ts (semantic match)
9. `estimateBlastRadius()` - cascading_impact.ts (semantic match)
10. `generateStateReport()` - observability.ts (unrelated)

**Actual Impact (from grep analysis):**
- 9 files directly import from api/query
- Key consumers:
  - `src/engines/relevance_engine.ts` (identified)
  - `src/integration/agent_protocol.ts` (not identified)
  - Multiple system test files (not identified)

**Accuracy Assessment:** MIXED (30% recall)

**Issues:**
- Returned many semantic matches for "blast radius" rather than dependency analysis
- Self-referential functions from query.ts are not useful for impact analysis
- Some legitimate consumers found but discovery was incidental

---

### Test 4: "downstream effects of changing embeddings"

**Query:** `npx tsx src/cli/index.ts query "downstream effects of changing embeddings" --no-synthesis`

**LiBrainian Results:**
- Confidence: 0.637 (low - appropriate uncertainty)
- Latency: 2705ms
- Packs Found: 10

**Key Findings Returned:**
1. `resolveEmbeddingNormalizationConfig()` - embeddings.ts (self-reference)
2. `generateEmbedding()` - embeddings.ts (self-reference)
3. `generateRealEmbedding()` - real_embeddings.ts (provider implementation)
4. `getEmbeddingDimension()` - embeddings.ts (self-reference)
5. `createDefaultProvider()` - embedding_providers/index.ts (provider factory)
6. `setEmbeddingModel()` - real_embeddings.ts (configuration)
7. `normalizeEmbedding()` - embedding_providers/index.ts (utility)
8. `shouldGenerateEmbeddings()` - universal_patterns.ts (configuration)
9. `getEmbedding()` - providers/types.ts (registry access)
10. `registerEmbedding()` - providers/types.ts (registration)

**Actual Impact (from grep analysis):**
- 28 files import from embeddings
- Key consumers NOT identified:
  - `src/api/bootstrap.ts` (uses embeddings during indexing)
  - `src/agents/ast_indexer.ts` (generates embeddings)
  - `src/agents/index_librarian.ts` (embedding orchestration)
  - `src/agents/swarm_runner.ts` (parallel embedding)
  - `src/engines/index.ts` (engine toolkit uses embeddings)

**Accuracy Assessment:** PARTIAL (35% recall)

**Issues:**
- All results are from the embeddings module itself or its immediate providers
- No actual downstream CONSUMERS identified
- Missing critical bootstrap/indexing pipeline
- Missing agent layer dependencies

---

### Test 5: "ripple effects of modifying types.ts"

**Query:** `npx tsx src/cli/index.ts query "ripple effects of modifying types.ts" --no-synthesis`

**LiBrainian Results:**
- Confidence: 0.522 (appropriately low)
- Latency: 785ms
- Packs Found: 9

**Key Findings Returned:**
1. `buildChangeImpactPack()` - packs.ts (semantic match on "ripple")
2. `isHighImpactEntity()` - cascading_impact.ts (semantic match)
3. `getPropagationFactor()` - cascading_impact.ts (semantic match)
4. `computeConfidence()` - workflow_validation_construction.ts (unrelated)
5. `inferUsageType()` - refactoring_safety_checker.ts (unrelated)
6. `normalizeFunctionSignature()` - bug_investigation_assistant.ts (unrelated)
7. `mutateCoChangeBoost()` - retrieval_emitter.ts (unrelated)
8. `reset()` - adaptive_config.ts (unrelated)
9. `generateDomainName()` - domain_registry.ts (unrelated)

**Actual Impact (from grep analysis):**
- **239 files** import from types.ts (within LiBrainian codebase)
- This is the MOST impactful file in the entire codebase
- Key consumers NOT identified:
  - Every API module
  - Every storage module
  - Every knowledge extractor
  - Every CLI command
  - Every test file

**Accuracy Assessment:** POOR (0% recall)

**Issues:**
- ZERO actual consumers of types.ts identified
- All results are semantic matches for "ripple effects" and "modifying"
- Completely missed the point that types.ts is the foundational type system
- The 0.522 confidence is appropriate but still indicates uncertainty rather than admitting inability

---

## Root Cause Analysis

### Why Impact Analysis Fails

1. **Semantic Over Structural:** LiBrainian prioritizes semantic similarity (vector embeddings) over structural relationships (import graphs, call hierarchies). "Blast radius" returns functions about blast radius, not files affected by changes.

2. **No Import Graph Traversal:** The system does not systematically traverse import/export relationships to identify true dependencies.

3. **Self-Reference Bias:** Queries about file X tend to return functions FROM file X rather than functions that DEPEND ON X.

4. **Missing Transitive Closure:** Even when direct consumers are found, the cascading secondary and tertiary effects are not traced.

5. **No Interface Implementation Tracking:** Queries about interfaces do not identify implementing classes or conforming modules.

6. **Keyword Conflation:** Terms like "impact", "blast radius", "ripple effects" match conceptual documentation rather than actual dependency data.

### Comparison with Actual Dependencies

| File | LiBrainian Identified | Actual Dependents | Recall |
|------|---------------------|-------------------|--------|
| bootstrap.ts | ~5 | 34 | 15% |
| LibrarianStorage | ~6 | 240 | 2.5% |
| query.ts | ~4 | 9 | 44% |
| embeddings | ~4 | 28 | 14% |
| types.ts | 0 | 239 | 0% |

---

## Recommendations

### For Impact Analysis Use Cases

1. **Implement Explicit Dependency Graphs:** Store and query import/export relationships as first-class edges in the knowledge graph.

2. **Add "dependents-of" Query Type:** Create a specialized query mode that returns files importing a given module.

3. **Trace Call Hierarchies:** For function-level impact, track which functions call the target function.

4. **Interface Consumer Detection:** When querying interfaces, automatically find implementations and type usages.

5. **Transitive Closure Support:** Allow queries to specify depth for multi-hop dependency analysis.

6. **Separate Semantic from Structural:** Impact queries should use structural analysis (AST/imports), not embedding similarity.

### Query Reformulation

Users asking about "impact" should be routed to deterministic graph queries rather than semantic search:

```
// Instead of semantic search:
query "what would break if I change X"

// Use structural query:
dependents --file X --depth 3 --include-tests
```

---

## Conclusion

LiBrainian demonstrates adequate capability for semantic code search and conceptual queries but fails at true impact analysis. The fundamental architecture prioritizes "what is similar" over "what depends on what", making it unsuitable for change impact prediction without significant enhancements to dependency tracking.

**Overall Grade: D (Inadequate)**

- Semantic relevance: B (finds related concepts)
- Structural accuracy: F (misses actual dependencies)
- Completeness: D (low recall across all tests)
- Confidence calibration: C (sometimes appropriately uncertain)

For impact analysis use cases, developers should rely on:
- IDE "Find Usages" functionality
- `grep` for import statements
- TypeScript compiler's reference analysis
- Dedicated dependency analysis tools (madge, dependency-cruiser)
