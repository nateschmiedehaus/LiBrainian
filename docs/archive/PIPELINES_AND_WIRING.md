# LiBrainian Pipelines and Wiring

Status: authoritative
Scope: End-to-end wiring for ingestion, understanding, query, and feedback.
Last Verified: 2026-01-04
Owner: librarianship
Version: 1.1.0
Evidence: docs only (implementation evidence lives in STATUS.md)

## Related Documents

| Document | Relationship |
|----------|-------------|
| `SCHEMAS.md` | Type definitions for all pipeline artifacts |
| `STATUS.md` | Implementation tracking per pipeline |
| `SYSTEM_ARCHITECTURE.md` | Component layers and data flow |
| `UNDERSTANDING_LAYER.md` | Knowledge schema and confidence |
| `MODEL_POLICY.md` | Provider selection for LLM synthesis |

## Canonical Pipelines

### 0) Bootstrap + Incremental Update
```
Bootstrap: Discover -> Detect language -> Parse -> Extract -> Persist -> Embed -> Synthesize -> Audit
Incremental: File change -> Invalidate -> Reindex -> Regenerate -> Update maps
```

Responsibilities:
- Bootstrap runs a full ingest + understanding generation for core entities.
- Incremental updates keep knowledge fresh without full reindex.
- Both flows publish event bus topics and write audit traces.
- [planned] Language detection + adapter selection run before parsing.
- Method packs are preloaded after knowledge generation when budgets allow.

### 1) Ingestion Pipeline
```
Discover -> Detect language -> Select adapter -> Parse -> Extract -> Normalize
-> Persist -> Index -> Emit Events
```

Responsibilities:
- Adapters parse code into AST and structure.
- Extractors generate base entities and relations.
- Storage persists entities and raw signals.
- Event bus notifies downstream consumers.
- Incremental indexing recomputes only touched entities.

### 1b) Language Onboarding Pipeline (Required)
```
Detect language -> Check registry -> Fallback extract -> Queue adapter
-> Reindex on upgrade
```

Responsibilities:
- [planned] Detect language from file signatures and manifests.
- [planned] Use adapter registry to route to native parsers.
- [planned] If missing, run fallback extraction with explicit gaps.
- [planned] Emit adapter:missing and adapter:loaded events.

### 2) Understanding Pipeline
```
Collect Evidence -> Generate Claims -> Attach Trace -> Calibrate Confidence
-> Persist Understanding -> Invalidate on Change
```

Responsibilities:
- LLM synthesis produces purpose/mechanism/contract.
- Confidence is explicit, traceable, and defeatable.
- Knowledge aggregation composes child signals into parent entities.
- No non-LLM shortcuts for semantic understanding claims.
- Method packs are generated from the method catalog when UC coverage requires them.
- Method packs are cached and preloaded when UCRequirementSet signals frequent use.

### 3) Query Pipeline
```
Normalize -> Freshness Check -> Acquire Locks -> Execute Engines
-> Compose Results -> Calibrate Confidence -> Render Response
```

Responsibilities:
- Relevance engine assembles candidate knowledge.
- Constraint engine filters by rules and safety.
- Meta engine calibrates confidence and evidence.
- Retrieval pipeline combines embeddings, co-change signals, and reranking.
- Method hints are attached when UC requirements imply specific methods.
- Method pack cache is consulted; missing packs trigger generation or GapReport.
- Knowledge map outputs are summarized via LLM and injected as knowledge sources.

Query depths (L0-L3):
- L0: minimal facts and locations.
- L1: localized understanding + evidence.
- L2: cross-module reasoning + impact.
- L3: full narrative + alternatives + risk.

### 4) Feedback and Learning Pipeline
```
Collect Feedback -> Update Outcomes -> Adjust Confidence -> Reprioritize Work
```

Responsibilities:
- Feedback updates knowledge accuracy.
- Failures create new evidence tasks.
- Outcomes update confidence and mark packs for reindex.

### 5) Embedding Pipeline (Integrated)
```
Chunk -> Embed -> Store -> Retrieve -> Rerank -> Boost (co-change) -> Respond
```

Responsibilities:
- Function-level chunking for coherent units.
- Real embeddings only (EmbeddingService).
- Cross-encoder reranking for precision.

## Wiring Rules
- No component bypasses the query pipeline.
- All subsystems publish and subscribe via the event bus.
- All writes flow through storage interfaces.
- Evidence and confidence are attached at creation time.

## Critical Wiring (Must Exist)
1) Orchestrator -> provider check -> bootstrap gate.
2) Bootstrap -> ingest pipeline -> event bus.
3) Query API -> query pipeline -> engines -> response.
4) Context assembly -> query API -> agent prompt.
5) Task outcome -> learning pipeline -> confidence update.
6) Daily model selection -> provider models -> runtime config.
7) Language detection -> adapter selection -> fallback extraction.

## Wiring Inventory (LiBrainian-Critical)
| ID | Source | Target | Purpose |
| --- | --- | --- | --- |
| W1 | CLI bootstrap | Provider gate | Fail fast if providers unavailable |
| W2 | Provider gate | Model policy | Daily selection + audit record |
| W3 | Bootstrap | Ingest pipeline | Full discovery + index |
| W4 | Ingest | Storage | Persist entities and relations |
| W5 | Ingest | Event bus | entity:created/updated |
| W6 | Event bus | Knowledge generator | Build maps + understanding |
| W7 | Understanding | Storage | Persist claims + evidence |
| W8 | Query API | Query pipeline | Normalize + execute |
| W9 | Query pipeline | Engines | Relevance/constraints/meta |
| W10 | Query pipeline | Storage + vector index | Retrieval + ranking |
| W11 | Context assembly | Query API | Agent-ready context packs |
| W12 | Feedback | Learning engine | Confidence updates |

## Full Wiring Inventory (Target)
This table is the complete wire reference for Wave0 and LiBrainian integration.
Status for each wire is tracked in `docs/LiBrainian/STATUS.md`.

| # | Source | Target | Wire Type | Data | Frequency |
| --- | --- | --- | --- | --- | --- |
| 1 | CLI entry | UnifiedOrchestrator | Init | Config, workspace path | Once/run |
| 2 | UnifiedOrchestrator | requireProviders() | Check | Provider readiness | Once/startup |
| 3 | requireProviders() | LLM providers | Healthcheck | Ping request | Once/startup |
| 4 | UnifiedOrchestrator | preOrchestrationHook() | Init | Workspace, timeout | Once/startup |
| 5 | preOrchestrationHook() | LiBrainian bootstrap | Init | Workspace root | Once/startup |
| 6 | LiBrainian bootstrap | File system | Scan | Directory traversal | Once/bootstrap |
| 7 | LiBrainian bootstrap | Embedding API | Embed | File contents | Per file |
| 8 | LiBrainian bootstrap | SQLite storage | Store | Embeddings, metadata | Per file |
| 9 | WorkGraph | Task source | Intake | New tasks | Per task |
| 10 | WorkGraph | SemanticScheduler | Schedule | Task list | Per batch |
| 11 | SemanticScheduler | LiBrainian similarity | Query | File paths | Per task pair |
| 12 | SemanticScheduler | AgentPool | Assign | Scheduled tasks | Per task |
| 13 | AgentPool | AgentRegistry | Lookup | Capability query | Per assignment |
| 14 | AgentRegistry | Agent instance | Acquire | Agent lock | Per assignment |
| 15 | Agent instance | ContextAssembler | Request | Task + files | Per task |
| 16 | ContextAssembler | LiBrainian assembleContext | Query | Task intent, scope | Per task |
| 17 | LiBrainian | SQLite storage | Query | Embeddings | Per query |
| 18 | LiBrainian | SQLite storage | Query | Call graph | Per query |
| 19 | ContextAssembler | Agent instance | Response | Enriched context | Per task |
| 20 | Agent instance | LLM API | Inference | Prompt + context | Per action |
| 21 | LLM API | Agent instance | Response | Generated text | Per action |
| 22 | Agent instance | PolicyEngine | Check | Proposed action | Per action |
| 23 | PolicyEngine | Agent instance | Decision | Allow/deny | Per action |
| 24 | Agent instance | ExecutionBackend | Execute | Command | Per execution |
| 25 | ExecutionBackend | File system | I/O | File operations | Per execution |
| 26 | ExecutionBackend | Agent instance | Result | Exit code, stdout | Per execution |
| 27 | Agent instance | CheckpointManager | Save | State snapshot | Per phase |
| 28 | CheckpointManager | File system | Write | Checkpoint JSON | Per phase |
| 29 | Agent instance | LiBrainian | Report | Action trajectory | Per task |
| 30 | LiBrainian | EpisodicMemory | Store | Episode record | Per task |
| 31 | Agent instance | QualityGate | Submit | Patch/output | Per task |
| 32 | QualityGate | LLM API | Review | Code for slop check | Per submission |
| 33 | QualityGate | DomainExpertRouter | Route | Approval request | If needed |
| 34 | DomainExpertRouter | File system | Write | HITL request | Per request |
| 35 | File system | DomainExpertRouter | Read | HITL response | Polling |
| 36 | QualityGate | WorkGraph | Feedback | Pass/fail result | Per submission |
| 37 | WorkGraph | EvolutionCoordinator | Report | Task outcome | Per completion |
| 38 | EvolutionCoordinator | PolicyOptimizer | Update | Outcome metrics | Per completion |
| 39 | PolicyOptimizer | Policy weights | Adjust | Weight delta | Per update |
| 40 | EvolutionCoordinator | GenePoolManager | Update | Fitness score | Per completion |
| 41 | GenePoolManager | Agent genomes | Mutate | Selection/crossover | Per generation |
| 42 | AgentPool | AgentRegistry | Release | Agent + metrics | Per completion |
| 43 | AgentRegistry | Agent metrics | Update | Success rate, duration | Per completion |
| 44 | UnifiedOrchestrator | WorkGraph | Monitor | Status query | Continuous |
| 45 | WorkGraph | TUI | Emit | Progress updates | Continuous |

## Event Bus (Core Topics)
- ingest:started / ingest:completed
- entity:created / entity:updated / entity:deleted
- understanding:generated / understanding:invalidated
- query:received / query:completed
- feedback:received / confidence:updated
- language:detected / adapter:missing / adapter:loaded

## Startup Sequence (Minimum)
1) Provider checks (fail fast if unavailable).
2) Daily model selection (recorded in audits).
3) Storage open and migrations.
4) Bootstrap (full or incremental).
5) Event bus subscriptions.
6) Query interface ready.

## Shared Primitives (Required)
- Entity, Relation, Evidence, Claim, Confidence, Defeater, Trace.
- Scope, Event, Result, Error.
- One schema for each across all subsystems.

## Wiring Map (Targets)
| Source | Event | Consumer | Outcome |
| --- | --- | --- | --- |
| Ingest | entity:created | Knowledge constructor | Build maps |
| Ingest | entity:updated | Freshness engine | Invalidate understanding |
| Understanding | understanding:generated | Meta engine | Calibrate confidence |
| Query pipeline | query:completed | Learning engine | Capture outcomes |
| Feedback | feedback:received | Understanding generator | Regenerate low confidence |

## Feedback Loops (Required)
- Technical: bootstrap → ingest → storage → query → response → audits.
- Learning: outcomes → attribution → confidence update → reindex.
- Quality: validation failures → gap tasks → doc/status updates.

## Feedback Loop Catalog (Required)
- Task-level learning: outcomes -> episodic memory -> better context.
- Agent evolution: outcomes -> fitness -> selection -> new agents.
- Policy optimization: decisions -> outcomes -> policy updates.
- Knowledge enrichment: code change -> reindex -> better context.
- Anti-pattern learning: slop -> anti-patterns -> future avoidance.
- Slop detection: output -> review -> rejection -> retry with feedback.
- Complexity budget: change -> budget check -> approve or simplify.

## Locking and Concurrency
- Workspace lock for index mutations.
- Per-entity locks for understanding regeneration.
- Query pipeline uses read locks with freshness checks.

## Storage Interfaces
- Relational store for entities, relations, and understanding.
- Vector index for semantic retrieval.
- Audit log for evidence and provider checks.

## Integration with Orchestrator
- Provider checks are executed before any pipeline starts.
- Query responses are shaped for agent consumption.
- File watcher triggers incremental reindex and context invalidation.

## Failure Handling
- Provider unavailable -> fail with unverified_by_trace.
- Partial ingestion -> mark data as stale, not valid.
- Conflicting claims -> store defeaters, not overrides.
- Default to waiting for long-running steps unless explicitly directed otherwise.

---

## Determinism Guarantees

Pipeline operations must be deterministic where possible for reproducible measurements.

### Deterministic Operations

| Pipeline | Operation | Guarantee |
|----------|-----------|-----------|
| Ingestion | File discovery | Deterministic (sorted order) |
| Ingestion | AST parsing | Fully deterministic |
| Ingestion | Entity extraction | Fully deterministic |
| Ingestion | Relation extraction | Fully deterministic |
| Embedding | Chunking | Deterministic (fixed algorithm) |
| Embedding | Vector generation | Deterministic (same model + seed) |
| Query | Retrieval ranking | Deterministic (stable sort) |
| Query | Tie-breaking | Deterministic (secondary key: entity ID) |

### Non-Deterministic Operations

| Pipeline | Operation | Required Recording |
|----------|-----------|-------------------|
| Understanding | LLM synthesis | Full prompt + response |
| Query | Cross-encoder reranking | Input order + scores |
| Model | Daily selection | Model ID + timestamp |
| Feedback | Confidence update | Before/after values |

### Determinism Verification

```bash
# Verify determinism for bootstrap
LiBrainian bootstrap --scope . --verify-determinism

# Runs bootstrap twice with same inputs
# Compares: entity IDs, relations, chunk boundaries
# Output: DeterminismVerificationReport.v1
```

---

## Instrumentation Points

All pipelines emit structured events for observability and debugging.

### Required Instrumentation

| Pipeline | Event | Data |
|----------|-------|------|
| Ingestion | `ingest:file:start` | `{ path, size, language }` |
| Ingestion | `ingest:file:complete` | `{ path, entities, relations, durationMs }` |
| Ingestion | `ingest:file:error` | `{ path, error, stack }` |
| Understanding | `understand:entity:start` | `{ entityId, type }` |
| Understanding | `understand:entity:complete` | `{ entityId, confidence, durationMs }` |
| Query | `query:receive` | `{ queryId, intent, depth }` |
| Query | `query:retrieve` | `{ queryId, resultCount, durationMs }` |
| Query | `query:rerank` | `{ queryId, rerankCount, durationMs }` |
| Query | `query:complete` | `{ queryId, confidence, totalMs }` |
| Provider | `provider:call:start` | `{ provider, model, operation }` |
| Provider | `provider:call:complete` | `{ provider, tokens, durationMs }` |
| Provider | `provider:call:error` | `{ provider, error, retryable }` |

### Trace Aggregation

Events are aggregated into traces for end-to-end analysis:

```typescript
interface PipelineTrace {
  traceId: string;
  pipeline: 'ingest' | 'understand' | 'query' | 'feedback';
  startedAt: string;        // ISO 8601
  completedAt?: string;     // ISO 8601
  status: 'running' | 'completed' | 'failed';

  // Event timeline
  events: Array<{
    name: string;
    timestamp: string;
    durationMs?: number;
    data: Record<string, unknown>;
  }>;

  // Aggregated metrics
  metrics: {
    totalDurationMs: number;
    providerCalls: number;
    providerTokens: number;
    entitiesProcessed: number;
  };

  // Error (if failed)
  error?: {
    event: string;
    message: string;
    stack?: string;
  };
}
```

### Sampling Strategy

| Environment | Sampling Rate | Retention |
|-------------|---------------|-----------|
| Development | 100% | 7 days |
| CI | 100% | 1 day |
| Production | 10% (errors: 100%) | 30 days |

## Document History

| Date | Version | Changes |
|------|---------|---------|
| 2026-01-08 | 1.2.0 | Added Determinism Guarantees, Instrumentation Points with trace aggregation |
| 2026-01-04 | 1.1.0 | Added related docs section, version header |
| 2026-01-04 | 1.0.0 | Initial pipeline and wiring specification |

---

*This document is authoritative for LiBrainian pipeline architecture and integration wiring.*
