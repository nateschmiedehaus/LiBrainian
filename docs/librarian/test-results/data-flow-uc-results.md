# Data Flow Use Case Test Results

**Date:** 2026-01-31
**Test Type:** Data Flow Understanding
**LiBrainian Version:** Current (from git)

## Executive Summary

The LiBrainian demonstrates **partial capability** for data flow queries. It excels at finding sanitization and validation functions but struggles with holistic system data flow tracing and database schema discovery.

| Query | Confidence | Packs Found | Assessment |
|-------|------------|-------------|------------|
| How does data flow through the system | 0.840 | 1 | Poor |
| Database models and schemas | 0.910 | 6 | Poor |
| Data transformation and mapping | 0.782 | 2 | Fair |
| State management and data stores | 0.852 | 2 | Fair |
| Data validation and sanitization pipeline | 0.838 | 10 | Good |

---

## Query 1: "How does data flow through the system"

### Results
- **Confidence:** 0.840
- **Packs Found:** 1
- **Latency:** 1670ms

### Returned Context
| File | Function | Summary |
|------|----------|---------|
| `src/analysis/data_flow.ts` | `findPath` | Find a path between two nodes in the data flow graph using BFS |

### Assessment

**Accuracy:** POOR

The LiBrainian only returned a single function (`findPath`) from `data_flow.ts` that is about finding paths in a data flow graph - it is not actually tracing how data flows through the LiBrainian system itself.

**What was missed:**
1. **Bootstrap pipeline:** How code is ingested via `src/api/bootstrap.ts`
2. **Indexing flow:** `src/ingest/` directory which processes files
3. **Query pipeline:** `src/api/query.ts` -> `src/api/query_interface.ts` flow
4. **Storage layer:** `src/storage/sqlite_storage.ts` persistence
5. **Embedding generation:** `src/api/embeddings.ts` -> vector index
6. **Graph construction:** `src/graphs/` modules building relationship graphs
7. **Knowledge extraction:** `src/knowledge/` extractors producing `FunctionKnowledge`, `ModuleKnowledge`

**Root Cause:** The query matched semantically on "data flow" which is a specific analysis module name, rather than understanding the user wanted system-level data architecture.

---

## Query 2: "Database models and schemas"

### Results
- **Confidence:** 0.910
- **Packs Found:** 6
- **Latency:** 1414ms

### Returned Context
| File | Function | Summary |
|------|----------|---------|
| `src/api/query_episodes.ts` | `buildQueryEpisode` | Constructs Episode object from QueryEpisodeInput |
| `src/api/query.ts` | `setCachedQuery` | Stores query response in cache tier |
| `src/api/query_interface.ts` | `createQueryInterface` | Factory for QueryInterface |
| `src/api/delta_map_template.ts` | `executeDeltaMap` | Template execution for git diff |
| `src/api/query_synthesis.ts` | `parseSynthesisResponse` | Parse LLM JSON into QuerySynthesisResult |
| `src/api/infra_map_template.ts` | `parseYamlDocument` | YAML parser entry point |

### Assessment

**Accuracy:** POOR

The query fell back to "general packs" due to no semantic matches above threshold (0.35). None of the returned functions relate to database models or schemas.

**What should have been found:**
1. **Core Type Definitions (`src/types.ts`):**
   - `FunctionKnowledge` - Function entity schema
   - `ModuleKnowledge` - Module entity schema
   - `FileKnowledge` - File entity schema with 30+ fields
   - `DirectoryKnowledge` - Directory entity schema
   - `DocumentKnowledge` - Documentation entity schema
   - `GraphEdge` - Relationship graph schema
   - `ContextPack` - Query result pack schema

2. **Storage Type Definitions (`src/storage/types.ts`):**
   - `LibrarianStorage` interface - full storage API
   - `StorageCapabilities` - capability declarations
   - 50+ query option types

3. **Actual Schema Files:**
   - `src/mcp/schema.ts` - MCP protocol schemas
   - `src/epistemics/evidence_record_schema.ts` - Evidence schemas
   - `src/ingest/schema_indexer.ts` - Schema processing

4. **SQLite Table Definitions:**
   - `src/storage/sqlite_storage.ts` contains table creation SQL

---

## Query 3: "Data transformation and mapping"

### Results
- **Confidence:** 0.782
- **Packs Found:** 2
- **Latency:** 1233ms

### Returned Context
| File | Function | Summary |
|------|----------|---------|
| `src/bootstrap/tiered_bootstrap.ts` | `mapToFileKnowledgeCategory` | Map FileCategory to FileKnowledge.category |
| `src/api/bootstrap.ts` | `fingerprintsMatch` | Compare workspace fingerprints |

### Assessment

**Accuracy:** FAIR

Found one genuine mapping function (`mapToFileKnowledgeCategory`). The second result (`fingerprintsMatch`) is not a data transformation.

**What was missed:**
1. **Type transformations in knowledge extractors:**
   - `src/knowledge/extractors/*.ts` - AST to knowledge transformations
   - Parsing raw code into `FunctionKnowledge`

2. **Data flow analysis transformations:**
   - `src/analysis/data_flow.ts` - `DataFlowNode`, `DataFlowEdge` types
   - Transform types: `assign`, `call`, `return`, `destructure`, `spread`, `await`

3. **Embedding transformations:**
   - `src/api/embeddings.ts` - Text to vector transformations

4. **Graph transformations:**
   - `src/graphs/*.ts` - Entity to graph node transformations

5. **Query result transformations:**
   - ContextPack construction from raw knowledge

---

## Query 4: "State management and data stores"

### Results
- **Confidence:** 0.852
- **Packs Found:** 2
- **Latency:** 1817ms

### Returned Context
| File | Function | Summary |
|------|----------|---------|
| `src/api/learning_loop.ts` | `loadLearningState` | Loads learning state from storage |
| `src/api/learning_loop.ts` | `persistLearningState` | Saves learning state to storage |

### Assessment

**Accuracy:** FAIR

Found two relevant state persistence functions from the learning loop. However, this represents only a tiny fraction of state management in the system.

**What was missed:**
1. **Primary Storage Layer:**
   - `src/storage/sqlite_storage.ts` - 3000+ line storage implementation
   - `src/storage/vector_index.ts` - Vector store
   - `src/storage/content_cache.ts` - Content caching

2. **State Types:**
   - `src/storage/types.ts` - 200+ line type definitions
   - `LibrarianStorage` interface with 50+ methods

3. **Epistemics Storage:**
   - `src/epistemics/storage.ts` - Belief and evidence storage

4. **Configuration State:**
   - `src/config/index.ts` - Configuration management

5. **Cache Management:**
   - Query cache, embedding cache, context pack cache

---

## Query 5: "Data validation and sanitization pipeline"

### Results
- **Confidence:** 0.838
- **Packs Found:** 10
- **Latency:** 2001ms

### Returned Context
| File | Function | Summary |
|------|----------|---------|
| `src/api/llm_provider_discovery.ts` | `sanitizeMetadataValue` | Recursively sanitizes metadata, redacting sensitive content |
| `src/api/technique_execution.ts` | `sanitizeCompositionInputs` | Validates and sanitizes composition inputs |
| `src/api/technique_execution.ts` | `sanitizeInputValue` | Recursively sanitizes input values |
| `src/api/operator_interpreters.ts` | `sanitizeOutputKey` | Validates output key for safe characters |
| `src/api/technique_execution.ts` | `sanitizeOutputValue` | Recursively sanitizes output values |
| `src/api/operator_interpreters.ts` | `sanitizeCheckpointRecord` | Sanitizes record for checkpoint |
| `src/api/operator_interpreters.ts` | `sanitizeCheckpointOutputs` | Sanitizes primitive outputs for checkpoint |
| `src/api/technique_execution.ts` | `normalizePromptPayload` | Sanitizes and truncates payload strings |
| `src/api/plan_compiler.ts` | `sanitizeId` | Sanitizes identifiers for error messages |
| `src/security/sanitization.ts` | `sanitizeQuery` | Sanitize a query intent |

### Assessment

**Accuracy:** GOOD

This query performed well, finding 10 relevant sanitization functions across multiple files. The results comprehensively cover:
- Input validation (`sanitizeCompositionInputs`, `sanitizeInputValue`)
- Output sanitization (`sanitizeOutputKey`, `sanitizeOutputValue`)
- Metadata redaction (`sanitizeMetadataValue`)
- Checkpoint safety (`sanitizeCheckpointRecord`, `sanitizeCheckpointOutputs`)
- Query safety (`sanitizeQuery`)

**What was missed:**
1. **SQL Injection Prevention (sqlite_storage.ts):**
   - `validateOrderColumn()` - ORDER BY column allowlist
   - `validateOrderDirection()` - Direction validation
   - `ALLOWED_ORDER_COLUMNS` - Column whitelist
   - `ALLOWED_TABLES` - Table name whitelist

2. **Redaction module:**
   - `src/api/redaction.ts` - Full redaction system

---

## Overall Assessment

### 1. Did it trace data flow accurately?

**NO** - The LiBrainian failed to provide a holistic view of data flow. Key gaps:

- **Missing system-level flow understanding:** No recognition of the bootstrap -> ingest -> index -> store -> query pipeline
- **Graph-based tracing not utilized:** Despite having a dedicated `data_flow.ts` module, it wasn't leveraged to trace actual system flow
- **Isolated function focus:** Returns individual functions rather than connected data paths

### 2. Could you understand data transformations?

**PARTIALLY** - The transformation query found one genuine mapping function, but missed:
- AST-to-knowledge transformations in extractors
- Text-to-embedding transformations
- Entity-to-graph transformations
- Raw data to ContextPack transformations

### 3. What data paths were missed?

**Critical Missing Paths:**

```
1. INGESTION PATH (not traced)
   File System -> Scanner -> Parser -> AST -> Extractors -> Knowledge Entities -> Storage

2. QUERY PATH (not traced)
   User Query -> Intent Classification -> Embedding -> Vector Search ->
   Scoring -> Pack Construction -> Response

3. GRAPH PATH (not traced)
   Code Entities -> Graph Edges -> Community Detection -> Metrics ->
   Centrality Scores

4. LEARNING PATH (partially traced - only state persistence)
   Query Outcomes -> Feedback -> Confidence Updates -> Quality Scores

5. BOOTSTRAP PATH (not traced)
   Workspace Detection -> Tier Selection -> Indexing Strategy ->
   Incremental Updates
```

---

## Recommendations

### For LiBrainian Improvement

1. **Add data flow graph queries:** Enable queries that trace actual code paths, not just semantic matches on "data flow"

2. **Index type definitions as schemas:** The `types.ts` files contain critical schema information that should be highly ranked for "schema" queries

3. **Create architecture-level context packs:** Pre-compute system-level data flow documentation that can answer "how does data flow" queries

4. **Improve fallback behavior:** When falling back to general packs (Query 2), apply domain-specific heuristics rather than returning unrelated functions

5. **Cross-reference storage layer:** Queries about "database" or "schema" should automatically include `src/storage/types.ts` and `src/types.ts`

### For Users

1. **Be specific:** Instead of "database models", try "FunctionKnowledge interface definition"
2. **Use file hints:** Add `--affected-files src/storage/` to constrain results
3. **Chain queries:** First ask "what storage modules exist", then drill into specific ones

---

## Test Artifacts

### Files Examined for Ground Truth
- `/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/LiBrainian/src/analysis/data_flow.ts`
- `/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/LiBrainian/src/storage/types.ts`
- `/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/LiBrainian/src/storage/sqlite_storage.ts`
- `/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/LiBrainian/src/types.ts`
- `/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/LiBrainian/src/security/sanitization.ts`

### Coverage Gaps Reported by LiBrainian
- `unverified_by_trace(watch_state_missing)`: Watch state unavailable
- `LLM disabled by request`: Synthesis disabled via `--no-synthesis`
- `No semantic matches above similarity threshold (0.35)`: Query 2 fallback
