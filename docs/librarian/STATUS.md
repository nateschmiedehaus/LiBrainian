# Librarian Status (Target vs Reality)

Status: authoritative
Scope: Implementation tracking with verification depth and evidence links.
Last Verified: 2026-01-26
Owner: librarianship
Version: 1.3.0

## How to Use This File

1. Only record verified facts with evidence links.
2. Claims without trace are labeled `unverified_by_trace(<reason>)`.
3. This file is the single source of truth for current status.
4. Each claim MUST include a verification depth and evidence links.

## Verification Depth Levels

| Level | Definition | Required Evidence |
|-------|------------|-------------------|
| `stubbed` | Interface/type exists, implementation is placeholder | Code path only |
| `partial` | Code exists but wiring incomplete or unverified | Code path + integration point |
| `code-reviewed` | Code exists and has been reviewed for correctness | Code path + review trace |
| `tested` | Code exists with passing tests | Code path + test file + assertion |
| `live-verified` | Verified with live providers and audit artifacts | Code path + test + audit artifact |

## Evidence Link Format

Evidence links use the following format:
- **Code**: `src/path/file.ts:functionName` or `src/path/file.ts:L42-L56`
- **Test**: `test/path/file.test.ts:testName`
- **Doc**: `docs/path/file.md#section`
- **Audit**: `state/audits/path/artifact.json`

**Note**: Evidence links should point at `src/**` in the standalone Librarian repository. Wave0 shims live in the Wave0 repo. Legacy `packages/librarian/**` references are pending migration (unverified_by_trace(extraction_link_migration_pending)).

## Status Tracking

### Infrastructure

| Component | Depth | Evidence | Notes |
|-----------|-------|----------|-------|
| Canonical doc architecture | tested | `docs/librarian/DOCS_ARCHITECTURE.md`, `docs/librarian/README.md` | Doc governance active |
| Schema definitions | code-reviewed | `docs/librarian/SCHEMAS.md` | v1.0.0 all primitives |
| Legacy research archive | code-reviewed | `docs/librarian/legacy/` | Preserved for reference |
| System architecture | code-reviewed | `docs/librarian/SYSTEM_ARCHITECTURE.md` | Directory map + toolkit |
| Pipeline wiring inventory | code-reviewed | `docs/librarian/PIPELINES_AND_WIRING.md` | Full integration map |
| Repository extraction boundary | tested | `docs/librarian/GATES.json`, `scripts/check_librarian_extraction_prereqs.mjs` | Standalone repo cutover gated |
| State persistence (watch, verification plans, execution traces) | tested | `src/state/watch_state.ts`, `src/state/verification_plans.ts`, `src/state/execution_traces.ts`, `src/integration/__tests__/file_watcher.test.ts:file_watcher`, `src/api/__tests__/librarian_memory.test.ts:stores and lists verification plans`, `src/api/__tests__/composition_evolution.test.ts:CompositionEvolutionEngine` | Storage-backed state for watch health and evolution tracking |

### Knowledge Layer

| Component | Depth | Evidence | Notes |
|-----------|-------|----------|-------|
| Understanding layer schema | code-reviewed | `docs/librarian/UNDERSTANDING_LAYER.md`, `docs/librarian/SCHEMAS.md` | Confidence formula documented |
| Knowledge generator | partial | `packages/librarian/src/knowledge/generator.ts:generateForFunction`, `packages/librarian/src/knowledge/generator.ts:generateForModule` | LLM-backed, needs live verification |
| Semantic extractors | tested | `packages/librarian/src/knowledge/extractors/semantics.ts`, `packages/librarian/src/knowledge/extractors/security_extractor.ts`, `packages/librarian/src/knowledge/extractors/evidence_collector.ts`, `scripts/audit_llm_mandate.mjs`, `packages/librarian/src/__tests__/llm_mandate.test.ts` | Semantic outputs carry LLM evidence; mandate audit enforced in Tier-0 |
| Rationale extractor | tested | `packages/librarian/src/knowledge/extractors/rationale_extractor.ts:extractRationale`, `packages/librarian/src/__tests__/llm_mandate.test.ts` | `extractRationale` is forbidden (must use LLM); throws `unverified_by_trace(rationale_llm_required)` |
| File/directory extractors | partial | `packages/librarian/src/knowledge/extractors/file_extractor.ts`, `packages/librarian/src/knowledge/extractors/directory_extractor.ts` | LLM-required for semantic fields; stored record schema does not yet carry per-record LLM evidence |
| Knowledge sources injection | tested | `packages/librarian/src/knowledge/synthesizer.ts:buildKnowledgeSources`, `packages/librarian/src/api/context_assembly.ts:KnowledgeSourceRef` | Explicit mapCodes and category fields for agent access |

### Embedding & Vector Layer

| Component | Depth | Evidence | Notes |
|-----------|-------|----------|-------|
| EmbeddingService | partial | `packages/librarian/src/api/embeddings.ts`, `packages/librarian/src/api/embedding_providers/` | Real providers required |
| Multi-vector storage | partial | `packages/librarian/src/storage/sqlite_storage.ts`, `packages/librarian/src/migrations/001_initial.sql` | Schema ready, wiring unverified |
| Multi-vector indexing | partial | `packages/librarian/src/agents/index_librarian.ts:indexModule` | Embeddings persisted |
| Multi-vector scoring | tested | `packages/librarian/src/api/query.ts`, `packages/librarian/src/__tests__/multi_vector_verification.test.ts` | RetrievalQualityReport.v1 artifact generated |
| Embedding model selection | partial | Model ID: `all-MiniLM-L6-v2` (default) | 384-dim, AUC validated |

### Provider Integration

| Component | Depth | Evidence | Notes |
|-----------|-------|----------|-------|
| Provider gate | tested | `src/api/provider_gate.ts`, `src/api/provider_check.ts`, `src/__tests__/provider_gate.test.ts` | Tier-0 provider gate checks passing |
| First-run gate | partial | `packages/librarian/src/integration/first_run_gate.ts` | Pre-bootstrap check |
| Daily model selection | partial | `src/models/model_policy.ts:ensureDailyModelSelection` | Haiku-class default |
| Model discovery | partial | `src/models/model_discovery.ts` | Live doc fetch required |
| LLM service | partial | `src/soma/providers/llm_service.ts` | Timeout policy not enforced |

### Bootstrap & Indexing

**Bootstrap Mode Note**: Bootstrap defaults to `fast` mode which skips LLM-based ingestion sources (commits, docs enrichment). For complete knowledge including commit history and semantic doc summaries, use `--mode full`:
```bash
librarian bootstrap --mode full
```
This requires live LLM providers and takes longer but produces comprehensive knowledge.

| Component | Depth | Evidence | Notes |
|-----------|-------|----------|-------|
| Bootstrap pipeline | live-verified | `packages/librarian/src/api/bootstrap.ts`, `state/audits/librarian/provider/` | Claude Sonnet 4.5 verified |
| Method pack preloading | partial | `packages/librarian/src/api/bootstrap.ts:preloadMethodPacks` | MF-01..MF-14 families |
| AST indexer | partial | `packages/librarian/src/agents/ast_indexer.ts` | TypeScript parser active |
| Index librarian | partial | `packages/librarian/src/agents/index_librarian.ts` | Multi-vector storage wired |
| Binary file detection | partial | `packages/librarian/src/agents/index_librarian.ts` | Skips binary content |
| Symlink-safe discovery | partial | `packages/librarian/src/api/bootstrap.ts` | Prevents cycles |

### Query Pipeline

| Component | Depth | Evidence | Notes |
|-----------|-------|----------|-------|
| Query API | partial | `packages/librarian/src/api/query.ts` | Provider-gated |
| Query evidence ledger events | tested | `src/api/query.ts:appendQueryEvidence`, `src/api/query.ts:appendStageEvidence`, `src/api/__tests__/query_trace_ledger.test.ts:records query lifecycle and stage evidence` | Tier-0 evidence ledger wiring verified |
| Context assembly | partial | `packages/librarian/src/api/context_assembly.ts` | Knowledge sources merged |
| UC requirements | partial | `packages/librarian/src/api/query.ts:deriveUCRequirements` | Task-type mapping |
| Method hints | partial | `packages/librarian/src/methods/method_guidance.ts` | Heuristic-only currently |
| Method pack service | tested | `packages/librarian/src/methods/method_pack_service.ts:MethodPackEvidence` | Evidence traces include provider, modelId, promptDigest, durationMs |

### Language Support

| Component | Depth | Evidence | Notes |
|-----------|-------|----------|-------|
| Language onboarding policy | code-reviewed | `docs/librarian/SYSTEM_ARCHITECTURE.md`, `docs/librarian/PIPELINES_AND_WIRING.md` | Immediate support requirement |
| LLM fallback parsing | partial | `packages/librarian/src/agents/ast_indexer.ts` | Onboarding events emitted |
| Onboarding events | partial | `packages/librarian/src/events.ts:emitLanguageOnboarding` | Gap tracking enabled |

### Integration & Events

| Component | Depth | Evidence | Notes |
|-----------|-------|----------|-------|
| Event bus | partial | `packages/librarian/src/events.ts` | Typed event emission |
| File watcher | tested | `packages/librarian/src/integration/file_watcher.ts`, `packages/librarian/src/integration/__tests__/file_watcher.test.ts` | Incremental updates with lazy cascade re-indexing |
| Cascade re-indexing | tested | `packages/librarian/src/integration/file_watcher.ts:CascadeReindexQueue` | Background queue for dependent file updates (rate-limited, retry logic, max 50 dependents) |
| Wave0 integration | partial | `packages/librarian/src/integration/wave0_integration.ts` | Co-change edges |
| Co-change computation | tested | `packages/librarian/src/graphs/temporal_graph.ts:buildTemporalGraph`, `packages/librarian/src/__tests__/co_change_signals.test.ts` | Computed at bootstrap via runRelationshipMapping phase |

### Use Cases & Methods

| Component | Depth | Evidence | Notes |
|-----------|-------|----------|-------|
| UC matrix (310 UCs) | code-reviewed | `docs/librarian/USE_CASE_MATRIX.md` | Docs-only evidence |
| Method catalog (200+) | code-reviewed | `docs/librarian/USE_CASE_MATRIX.md` | Integrated with UCs |
| UC-to-method mapping | code-reviewed | `docs/librarian/USE_CASE_MATRIX.md#appendix-c` | Cluster mapping |
| Coverage audit checklist | tested | `packages/librarian/src/cli/commands/coverage.ts`, `state/audits/librarian/coverage/uc_method_scenario_matrix.json` | UCMethodScenarioMatrix.v1 with evidence tracking, --strict mode |

### Packaging & OSS

| Component | Depth | Evidence | Notes |
|-----------|-------|----------|-------|
| Packaging guide | code-reviewed | `docs/librarian/PACKAGING_AND_ONBOARDING.md` | Drop-in injection |
| Extension points | code-reviewed | `docs/librarian/VISION.md`, `docs/librarian/SYSTEM_ARCHITECTURE.md` | Parser/mapper hooks |
| CLI interface | partial | `packages/librarian/src/cli/commands/bootstrap.ts` | Scope parameter |

### MCP Server

| Component | Depth | Evidence | Notes |
|-----------|-------|----------|-------|
| MCP Server core | tested | `packages/librarian/src/mcp/server.ts`, `packages/librarian/src/mcp/__tests__/server.test.ts` | 35 tests passing |
| MCP Schema validation | tested | `packages/librarian/src/mcp/schema.ts`, `packages/librarian/src/mcp/__tests__/schema.test.ts` | 58 tests, Zod schemas |
| MCP Authentication | tested | `packages/librarian/src/mcp/authentication.ts`, `packages/librarian/src/mcp/__tests__/authentication.test.ts` | 48 tests, session-based |
| MCP Audit logging | tested | `packages/librarian/src/mcp/audit.ts`, `packages/librarian/src/mcp/__tests__/audit.test.ts` | 42 tests, structured logging |
| MCP Tools (7 tools) | tested | `packages/librarian/src/mcp/server.ts:handleToolCall` | bootstrap, query, verify_claim, run_audit, diff_runs, export_index, get_context_pack_bundle |
| MCP Resources | tested | `packages/librarian/src/mcp/server.ts:handleResourceRead` | file-tree, symbols, knowledge-maps, method-packs, provenance, identity |
| MCP Documentation | code-reviewed | `docs/librarian/MCP_SERVER.md` | Full API reference |

### Security Module

| Component | Depth | Evidence | Notes |
|-----------|-------|----------|-------|
| Input sanitization | tested | `packages/librarian/src/security/sanitization.ts`, `packages/librarian/src/security/__tests__/security.test.ts` | Path traversal, injection prevention |
| Rate limiting | tested | `packages/librarian/src/security/rate_limiter.ts`, `packages/librarian/src/security/__tests__/security.test.ts` | Token bucket, sliding window |
| Circuit breaker | tested | `packages/librarian/src/security/rate_limiter.ts:CircuitBreaker` | Failure protection |
| Error boundaries | tested | `packages/librarian/src/security/error_boundary.ts`, `packages/librarian/src/security/__tests__/security.test.ts` | Safe error exposure |
| Secure configuration | tested | `packages/librarian/src/security/index.ts:createSecureConfig` | Sensible defaults |
| Security checks | tested | `packages/librarian/src/security/index.ts:applySecurityChecks` | Combined validation |

### Evaluation Harness

| Component | Depth | Evidence | Notes |
|-----------|-------|----------|-------|
| Evaluation metrics | tested | `packages/librarian/src/evaluation/harness.ts`, `packages/librarian/src/evaluation/__tests__/harness.test.ts` | 33 tests passing |
| Precision/Recall@k | tested | `packages/librarian/src/evaluation/harness.ts:evaluateQuery` | Binary and graded |
| nDCG calculation | tested | `packages/librarian/src/evaluation/harness.ts:calculateNDCG` | Discounted cumulative gain |
| MAP calculation | tested | `packages/librarian/src/evaluation/harness.ts:calculateMAP` | Mean average precision |
| MRR calculation | tested | `packages/librarian/src/evaluation/harness.ts:evaluateQuery` | Mean reciprocal rank |
| Batch evaluation | tested | `packages/librarian/src/evaluation/harness.ts:runBatch` | Warmup + evaluation |
| Quality grading | tested | `packages/librarian/src/evaluation/harness.ts:generateSummary` | A/B/C/D/F grades |
| Aggregate statistics | tested | `packages/librarian/src/evaluation/harness.ts:aggregateMetrics` | Mean, median, std, percentiles |

### Retrieval System (Enhanced)

| Component | Depth | Evidence | Notes |
|-----------|-------|----------|-------|
| Graph-augmented similarity | tested | `packages/librarian/src/api/embedding_providers/graph_augmented_similarity.ts`, `packages/librarian/src/api/__tests__/retrieval.test.ts` | Combines embedding + graph signals |
| Multi-vector representations | tested | `packages/librarian/src/api/embedding_providers/multi_vector_representations.ts`, `packages/librarian/src/api/__tests__/retrieval.test.ts` | 4 aspect vectors |
| Cross-encoder reranking | tested | `packages/librarian/src/api/embedding_providers/cross_encoder_reranker.ts`, `packages/librarian/src/api/__tests__/retrieval.test.ts` | ColBERT-style scoring |
| Query caching | tested | `packages/librarian/src/api/__tests__/retrieval.test.ts` | File-change invalidation |
| Enhanced retrieval | tested | `packages/librarian/src/api/embedding_providers/enhanced_retrieval.ts`, `packages/librarian/src/api/__tests__/retrieval.test.ts` | Full pipeline |

### Quality & Validation

| Component | Depth | Evidence | Notes |
|-----------|-------|----------|-------|
| Slop detection | live-verified | `state/audits/slop_review/2026-01-04T20-48-34-034Z/SlopReviewReport.v1.json` | Passed after fix |
| Build validation | live-verified | `npm run build` output | TypeScript passes |
| Risk register | code-reviewed | `docs/librarian/WORKPLAN.md` | Failure modes tracked |

## Known Gaps (Ordered by Priority)

### Critical (Violates Core Mandate)

1. **LLM Evidence Missing for File/Directory Semantic Records**
   - Location: `packages/librarian/src/knowledge/extractors/file_extractor.ts`, `packages/librarian/src/knowledge/extractors/directory_extractor.ts`, `packages/librarian/src/storage/sqlite_storage.ts`
   - Violation: Understanding mandate evidence requirements in `docs/librarian/UNDERSTANDING_LAYER.md#understanding-mandate-llm-required`
   - Required Fix: Store per-record LLM evidence (provider/modelId/promptDigest/timestamp) for file/directory semantic fields (or mark those fields `unverified_by_trace(...)` when evidence is absent)
   - Status: Universal knowledge semantic extractors now carry `meta.llmEvidence`; file/directory record schema does not yet carry LLM evidence

2. **Timeout Policy Not Enforced**
   - Location: `src/soma/providers/llm_service.ts`
   - Violation: Waiting policy (no timeouts unless explicit)
   - Required Fix: Remove default timeouts, add explicit timeout parameters
   - Status: Default timeouts set to 0 (waiting); explicit timeout parameters available

### High (Affects Correctness) - RESOLVED

3. ~~**Method Packs Not Evidence-Backed**~~
   - Location: `packages/librarian/src/methods/method_pack_service.ts`
   - **RESOLVED 2026-01-08**: Added `MethodPackEvidence` interface with provider, modelId, promptDigest, durationMs
   - Evidence: `packages/librarian/src/methods/method_pack_service.ts:MethodPackEvidence`

4. ~~**Multi-Vector Scoring Unverified**~~
   - Location: `packages/librarian/src/api/query.ts`
   - **RESOLVED 2026-01-08**: Added `RetrievalQualityReport.v1` artifact and verification tests
   - Evidence: `packages/librarian/src/measurement/retrieval_quality.ts`, `packages/librarian/src/__tests__/multi_vector_verification.test.ts`

5. ~~**Co-Change Edges Not Computed at Bootstrap**~~
   - Location: `packages/librarian/src/graphs/temporal_graph.ts`
   - **RESOLVED**: Implemented via `buildTemporalGraph` in `runRelationshipMapping` bootstrap phase
   - Evidence: `packages/librarian/src/api/bootstrap.ts:runRelationshipMapping`, `packages/librarian/src/__tests__/co_change_signals.test.ts`

### Medium (Affects Completeness) - PARTIALLY RESOLVED

6. ~~**UC x Method x Scenario Coverage Unvalidated**~~
   - Location: `packages/librarian/src/cli/commands/coverage.ts`
   - **RESOLVED 2026-01-08**: Implemented `librarian coverage --strict` with evidence tracking
   - Evidence: `packages/librarian/src/cli/commands/coverage.ts`, `state/audits/librarian/coverage/uc_method_scenario_matrix.json`
   - Output: `UCMethodScenarioMatrix.v1` with per-UC summaries, evidence sources, and strict mode validation

7. ~~**Knowledge Maps Not Integrated**~~
   - Location: `packages/librarian/src/api/context_assembly.ts`, `packages/librarian/src/knowledge/synthesizer.ts`
   - **RESOLVED 2026-01-08**: Added explicit `mapCodes` and `category` fields to `KnowledgeSourceRef`
   - Evidence: `packages/librarian/src/api/context_assembly.ts:KnowledgeSourceRef`, `packages/librarian/src/knowledge/synthesizer.ts:buildKnowledgeSources`

8. ~~**Cross-Repo Federation Not Implemented**~~
   - Location: `packages/librarian/src/federation/`
   - **RESOLVED 2026-01-08**: Implemented federation protocol with:
     - `FederationRegistry` for managing multiple repositories
     - `FederatedQueryExecutor` for cross-repo queries
     - Provenance tracking and trust levels
     - Safe query boundaries and timeout handling
   - Evidence: `packages/librarian/src/federation/types.ts`, `packages/librarian/src/federation/registry.ts`, `packages/librarian/src/federation/query.ts`, `packages/librarian/src/__tests__/federation.test.ts`

## Required Evidence Types

| Type | Format | Location |
|------|--------|----------|
| Code path | `src/path/file.ts:symbol` or `:L42-L56` | Source files |
| Test assertion | `test/path/file.test.ts:testName` | Test files |
| Audit artifact | `state/audits/path/Artifact.v1.json` | Audit directory |
| Provider trace | `state/audits/librarian/provider/*.json` | Provider audit |
| Doc reference | `docs/path/file.md#section` | Documentation |

## Verification Checklist

Before marking any component as `live-verified`:

- [ ] Code exists and compiles (`npm run build`)
- [ ] Tests exist and pass (`npm test`)
- [ ] Agentic review passes (`npm run test:agentic-review`)
- [ ] Live bootstrap completes (`npm run librarian -- bootstrap --scope librarian --mode fast --llm-provider codex --llm-model gpt-5.1-codex-mini`)
- [ ] Audit artifacts generated in `state/audits/`
- [ ] Provider traces show real LLM calls (not mocked)

## Document History

| Date | Version | Changes |
|------|---------|---------|
| 2026-01-18 | 1.4.0 | Added lazy cascade re-indexing to file watcher (CascadeReindexQueue with rate limiting, retry logic, graceful shutdown). Added incremental index CLI command. Documented async resource patterns. |
| 2026-01-09 | 1.3.0 | Added MCP server (7 tools, 6 resources, 183 tests), security module (sanitization, rate limiting, error boundaries, 83 tests), evaluation harness (metrics, grading, 33 tests), enhanced retrieval (graph, multi-vector, reranking, 25 tests). Total new tests: 324 |
| 2026-01-08 | 1.2.0 | Resolved all 6 high/medium gaps: method pack evidence, multi-vector verification, co-change bootstrap, coverage audit, knowledge maps integration, cross-repo federation |
| 2026-01-04 | 1.1.0 | Added verification depth levels, structured tables, gap prioritization |
| 2026-01-04 | 1.0.0 | Initial status tracking created |

---

*This document is authoritative for Librarian implementation status.*
