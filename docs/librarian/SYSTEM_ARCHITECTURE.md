# LiBrainian System Architecture

Status: authoritative
Scope: Canonical system boundaries, components, data flow, and directory layout.
Last Verified: 2026-01-04
Owner: librarianship
Version: 1.1.0

## Goal

Build the world's most advanced codebase knowledge system for agentic and human
workflows, with evidence-backed understanding, calibrated confidence, and
reliable coordination across large, evolving repos.

## Related Documents

| Document | Relationship |
|----------|-------------|
| `SCHEMAS.md` | Authoritative type definitions for all primitives |
| `STATUS.md` | Implementation verification tracking |
| `PIPELINES_AND_WIRING.md` | End-to-end data flow and integration |
| `UNDERSTANDING_LAYER.md` | Knowledge schema and confidence model |
| `MODEL_POLICY.md` | Provider selection and failover rules |

## Status Legend

| Status | Definition |
|--------|------------|
| `[verified]` | Implemented and verified with evidence |
| `[partial]` | Code exists but wiring incomplete |
| `[planned]` | Not yet implemented |
| `[unverified_by_trace]` | Claimed but no evidence trace |

Evidence links live in `docs/LiBrainian/STATUS.md`.

## Architectural Invariants

1. **Single Pipeline**: One unified ingest + query pipeline (no subsystem bypasses).
2. **Shared Primitives**: All components use primitives defined in `SCHEMAS.md`.
3. **Event-Driven**: All mutations flow through storage interfaces and event bus.
4. **Provider-Gated**: Provider checks and model policy enforced before any run.
5. **Real Embeddings**: No fake embeddings; semantic understanding requires real providers.
6. **Fail-Closed**: Provider unavailability returns `unverified_by_trace(provider_unavailable)`.

## Language Coverage Invariants

1. [partial] New languages must be supported on first encounter (no hard fail).
2. [partial] Fallback extraction produces evidence-backed understanding with explicit gaps.
3. [partial] Language onboarding is automatic and queued for adapter upgrades.

Evidence: `src/LiBrainian/agents/ast_indexer.ts`, `src/LiBrainian/events.ts:emitLanguageOnboarding`

## System Boundaries

LiBrainian is a knowledge layer, not the orchestrator.

**LiBrainian owns:**
- Extraction, indexing, storage, knowledge synthesis, and query serving
- Understanding layer and knowledge maps
- Model usage policy and provider readiness gates
- Evidence chain and audit artifact generation

**LiBrainian does not own:**
- Agent scheduling and execution strategy (Wave0 orchestrator)
- CLI auth configuration (uses host CLI auth)
- Task outcome decisions (only provides knowledge)

## Core Outputs (Artifacts)

| Artifact | Schema | Description |
|----------|--------|-------------|
| Entity Index | `Entity[]` | Code, docs, and emergent concepts |
| Relation Index | `Relation[]` | Typed edges between entities |
| Understanding Records | `Claim[]` | Purpose, mechanism, contract, rationale |
| Knowledge Maps | Custom | Dependency, data flow, risk, ownership, tests |
| Context Packs | `ContextPackBundle.v1` | Ranked evidence, confidence, constraints |
| Gap Reports | `GapReport.v1` | Missing knowledge and recommendations |
| Workflow Records | `WorkflowRunRecord.v1` | Execution history and outcomes |
| Audit Logs | `Trace[]` | Evidence traces for reproducibility |

All schemas are defined in `docs/LiBrainian/SCHEMAS.md`.

## Shared Primitives

All type definitions are authoritative in `docs/LiBrainian/SCHEMAS.md`. This section
provides a quick reference.

| Primitive | Purpose | Key Fields |
|-----------|---------|------------|
| `Entity` | Stable identity for code elements | `id`, `kind`, `name`, `qualifiedName`, `location` |
| `Relation` | Typed edge between entities | `fromId`, `toId`, `kind`, `weight`, `evidence` |
| `Evidence` | Trace to source | `sources`, `method`, `timestamp`, `confidence` |
| `Claim` | Statement with evidence | `entityId`, `category`, `statement`, `confidence`, `defeaters` |
| `Confidence` | Multi-dimensional score | `overall`, `byDimension.{freshness,coverage,reliability}`, `source` |
| `Defeater` | Counter-evidence | `kind`, `description`, `severity`, `active` |
| `Trace` | Reproducible operation record | `operation`, `timestamp`, `durationMs`, `provider`, `inputs`, `outputs` |
| `Scope` | Query target boundaries | `kind`, `paths`, `excludes`, `depth` |
| `Result<T>` | Success wrapper | `ok: true`, `value`, `warnings` |
| `ResultError` | Error wrapper | `ok: false`, `error.{code,message,details}` |

## Vector Storage Schema

Vector embeddings are stored using SQLite with sqlite-vss extension.

### Table: `librarian_multi_vectors`

```sql
CREATE TABLE librarian_multi_vectors (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,  -- 'module' | 'function' | 'file'

  -- Vector payloads (JSON-serialized Float32Array)
  semantic_vector BLOB,       -- 384-dim
  structural_vector BLOB,     -- 384-dim
  dependency_vector BLOB,     -- 384-dim
  usage_vector BLOB,          -- 384-dim

  -- Input texts for reproducibility
  semantic_input TEXT,
  structural_input TEXT,
  dependency_input TEXT,
  usage_input TEXT,

  -- Metadata
  model_id TEXT NOT NULL,
  llm_purpose TEXT,           -- LLM-extracted purpose summary
  generated_at TEXT NOT NULL,
  token_count INTEGER
);
```

### Embedding Models

| Model ID | Dimension | Context | Status |
|----------|-----------|---------|--------|
| `all-MiniLM-L6-v2` | 384 | 256 tokens | Default, validated |
| `jina-embeddings-v2-base-en` | 768 | 8192 tokens | Long documents |
| `bge-small-en-v1.5` | 384 | 512 tokens | Balanced |

### Distance Metric

- **Metric**: Cosine similarity for all vector comparisons
- **Score Normalization**: `(1 + cosineSimilarity) / 2` for 0-1 range
- **Multi-Vector Blending**: Weighted combination based on query type

### Multi-Vector Scoring Weights

| Query Type | Semantic | Structural | Dependency | Usage |
|------------|----------|------------|------------|-------|
| Understanding | 0.4 | 0.2 | 0.2 | 0.2 |
| Refactoring | 0.2 | 0.4 | 0.3 | 0.1 |
| Debugging | 0.3 | 0.2 | 0.2 | 0.3 |
| Impact Analysis | 0.2 | 0.2 | 0.4 | 0.2 |

## Component Model (Layered)

### Layer 1: Unified API

- Single entrypoint for queries, actions, and agent-facing responses
- Enforces provider checks, model selection, and budgets
- Entry: `src/LiBrainian/api/LiBrainian.ts`

### Layer 2: Query Pipeline

Canonical flow:
```
normalize -> freshness_check -> acquire_locks -> execute -> enrich ->
compute_confidence -> apply_defeaters -> render_response
```

Entry: `src/LiBrainian/api/query.ts`

### Layer 3: Engines (Compositional)

Three engines compose reasoning support. Full interface contracts in `SCHEMAS.md`.

| Engine | Purpose | Entry Point |
|--------|---------|-------------|
| Relevance | What knowledge is needed | `src/LiBrainian/engines/relevance_engine.ts` |
| Constraint | What rules apply | `src/LiBrainian/engines/constraint_engine.ts` |
| Meta-Knowledge | How confident should we be | `src/LiBrainian/engines/meta_engine.ts` |

### Layer 4: Subsystems (Event-Driven)

| Subsystem | Responsibility | Entry Points |
|-----------|---------------|--------------|
| Freshness | Staleness detection, invalidation | `integration/file_watcher.ts`, `engines/meta_engine.ts` |
| Learning | Outcome tracking, attribution | `integration/causal_attribution.ts`, `knowledge/defeater_activation.ts` |
| Scale | Caching, batching, budgets | `memory/hierarchical_memory.ts`, `api/token_budget.ts` |
| Coordination | Locks, task handoff | `integration/workspace_lock.ts`, `integration/file_lock_manager.ts` |
| Pattern Inference | Convention extraction | `knowledge/patterns.ts`, `knowledge/pattern_behavior.ts` |
| Method Packs | Problem-solving guidance | `methods/method_guidance.ts`, `methods/method_pack_service.ts` |

### Layer 5: Resilient Core

- `Result<T, E>` type (no silent failures)
- Typed error taxonomy (no string errors)
- Health checks with criticality tiers
- Transaction coordinator for multi-table writes

Entry: `src/LiBrainian/core/`

### Layer 6: Knowledge Layer

Domain-specific knowledge objects:
- Architecture: `knowledge/architecture.ts`, `knowledge/module_graph.ts`
- Impact: `knowledge/impact.ts`
- Quality: `knowledge/quality.ts`, `knowledge/quality_metrics.ts`
- Patterns: `knowledge/patterns.ts`, `knowledge/pattern_*`
- Evolution: `knowledge/evolution.ts`, `knowledge/evolution_metrics.ts`

### Layer 7: Storage Layer

| Store | Purpose | Implementation |
|-------|---------|----------------|
| SQLite | Primary entity/relation store | `storage/sqlite_storage.ts` |
| Vector Index | Embedding similarity search | `storage/sqlite_storage.ts` (sqlite-vss) |
| Audit Logs | Evidence traces | `state/audits/` |
| Cache | Query result caching | `memory/hierarchical_memory.ts` |

### Layer 8: Adapter Layer

Language and framework specific extraction.

| Component | Status | Implementation |
|-----------|--------|----------------|
| TypeScript Adapter | [partial] | `agents/ast_indexer.ts` |
| Universal Fallback | [partial] | LLM-based extraction |
| Adapter Registry | [planned] | Plugin system |
| LSP Bridges | [planned] | Language server integration |
| Tree-sitter Fallback | [planned] | Universal AST parsing |

## Engine Interface Contracts

Full TypeScript definitions in `docs/LiBrainian/SCHEMAS.md`. Summary:

### RelevanceEngine

```typescript
interface RelevanceEngine {
  query(options: {
    intent: string;
    hints?: string[];
    budget: { maxFiles: number; maxTokens: number; maxDepth: number };
    urgency: 'blocking' | 'background';
  }): Promise<RelevanceResult>;
}
```

### ConstraintEngine

```typescript
interface ConstraintEngine {
  getApplicableConstraints(paths: string[]): Promise<Constraint[]>;
  validateChange(path: string, before: string, after: string): Promise<ConstraintValidation>;
}
```

### MetaKnowledgeEngine

```typescript
interface MetaKnowledgeEngine {
  getConfidence(paths: string[]): Promise<number>;
  shouldProceed(paths: string[]): Promise<ProceedDecision>;
  getBlastRadius(paths: string[]): Promise<BlastRadiusResult>;
}
```

## Adapter/Plugin Specification

### Plugin Types

| Type | Purpose | Registration |
|------|---------|--------------|
| Language Adapter | AST parsing for new languages | `registerAdapter(languageId, adapter)` |
| Knowledge Mapper | Domain-specific knowledge extraction | `registerMapper(domainId, mapper)` |
| Query Intent | New reasoning modes | `registerIntent(intentId, handler)` |
| Scoring Plugin | Custom relevance signals | `registerScorer(scorerId, scorer)` |
| Method Pack | Problem-solving templates | `registerMethodPack(packId, pack)` |

### Adapter Interface

```typescript
interface LanguageAdapter {
  readonly languageId: string;
  readonly fileExtensions: string[];

  // Core extraction
  parse(content: string, path: string): Promise<ParseResult>;
  extractEntities(ast: ParseResult): Entity[];
  extractRelations(ast: ParseResult): Relation[];

  // Optional capabilities
  getSymbolAtPosition?(ast: ParseResult, line: number, column: number): Entity | null;
  findReferences?(entityId: string): EntityLocation[];
}
```

### Plugin Lifecycle

1. **Discovery**: Plugins in `src/LiBrainian/adapters/` are auto-loaded
2. **Registration**: Call `registerAdapter()` during bootstrap
3. **Validation**: Plugin must implement required interface
4. **Activation**: Plugin used when language/domain matches
5. **Hot-Reload**: [planned] Plugins can be updated without restart

## Wave0 Integration Contract

### Rules

1. If Wave0 needs codebase knowledge, it MUST ask LiBrainian
2. No duplicate analysis in Wave0 that LiBrainian already provides
3. LiBrainian responses MUST include evidence, confidence, and defeaters
4. LiBrainian is the source for: related files, change impact, tests, ownership, similarity, and failure attribution

### Integration Checkpoints

| Checkpoint | Trigger | LiBrainian Action |
|------------|---------|------------------|
| Pre-orchestration | Task start | Bootstrap + provider check |
| Context assembly | Agent needs context | Assemble context pack |
| Outcome feedback | Task complete | Update confidence, record outcome |
| Freshness check | File change | Invalidate stale knowledge |

### Co-Change Integration

Co-change edges are computed via Wave0 integration (not during bootstrap).
Future: Add git-history-based co-change computation at bootstrap.

Evidence: `src/LiBrainian/integration/wave0_integration.ts`

## Provider Architecture

### Authentication

- CLI-authenticated providers only (Claude + Codex)
- No API keys in environment variables
- Uses host CLI auth configuration

### Daily Model Selection

1. Fetch provider capability docs (live)
2. Select cheapest model meeting capability tier
3. Record selection in `state/audits/model_selection/`
4. Default: Haiku-class for daily operations

### Failover Policy

- Failover is full-capability (no degraded semantic mode)
- Claude ↔ Codex swap on outage with same capability tier
- Provider unavailability returns `unverified_by_trace(provider_unavailable)`

### Capability Matrix

| Capability | Required Provider |
|------------|------------------|
| Text understanding | Claude or Codex |
| Code understanding | Claude or Codex |
| Embeddings | EmbeddingService (all-MiniLM-L6-v2) |
| Purpose extraction | Claude or Codex |

## Event Bus

### Contract

- All subsystems emit and subscribe via the event bus
- Events are typed, correlated, and persisted for audits
- No subsystem bypasses event emission for state changes

### Event Categories

| Category | Events |
|----------|--------|
| Lifecycle | `bootstrap:start`, `bootstrap:complete`, `shutdown` |
| Indexing | `index:start`, `index:entity`, `index:complete` |
| Query | `query:start`, `query:complete`, `query:error` |
| Provider | `provider:check`, `provider:available`, `provider:unavailable` |
| Language | `language:detected`, `adapter:missing`, `adapter:loaded` |
| Knowledge | `knowledge:generated`, `knowledge:invalidated` |

Entry: `src/LiBrainian/events.ts`

## Data Flow

```
Source Code
  ↓
Adapters/Extractors (AST parsing, LLM fallback)
  ↓
Indexing/Storage (SQLite + vector index)
  ↓
Knowledge Construction (extractors, synthesizers)
  ↓
Understanding Synthesis (LLM-backed claims)
  ↓
Query Pipeline (relevance, constraints, confidence)
  ↓
Agent/CLI Response (context packs, evidence)
```

## Agent Interface Surfaces

| Method | Purpose | Returns |
|--------|---------|---------|
| `queryLibrarian()` | General knowledge query | Evidence, confidence, defeaters |
| `assembleContext()` | Context pack assembly | Ranked evidence with constraints |
| `recordTaskOutcome()` | Feedback loop | Confidence and freshness updates |
| `bootstrapProject()` | Initialize indexes | Audit records |

## Directory Architecture

```
src/LiBrainian/
  adapters/       [planned] Language adapters and parser plugins
  agents/         Agentic tasks (indexing, audits)
  analysis/       Algorithmic analysis helpers
  api/            Public entrypoints, provider checks
  cli/            CLI commands
  core/           Shared primitives (entity, event, result)
  debug/          Debug and diagnostics
  engines/        Relevance, constraint, meta-knowledge
  events.ts       Global event bus
  graphs/         Graph algorithms
  index.ts        Public exports
  ingest/         Indexers (code, docs, tests)
  integration/    Wave0 hooks, locks, file watcher
  knowledge/      Ontology, extractors, synthesis
  memory/         Caches and episodic recall
  methods/        Method guidance and pack service
  migrations/     Schema migrations
  providers/      LLM and embedding wrappers
  query/          Query planning and execution
  recommendations/ Action plans and suggestions
  state/          Index state, freshness ledger
  storage/        SQLite, vector index, caching
  types.ts        Domain interfaces
  views/          Response shaping
  visualization/  Graph views
```

### Documentation Directory

```
docs/LiBrainian/
  README.md               Entry point
  DOCS_ARCHITECTURE.md    Doc governance
  SCHEMAS.md              Type definitions
  SYSTEM_ARCHITECTURE.md  This document
  UNDERSTANDING_LAYER.md  Knowledge schema
  PIPELINES_AND_WIRING.md Integration map
  STATUS.md               Implementation tracking
  MODEL_POLICY.md         Provider rules
  USE_CASE_MATRIX.md      310 UCs + methods
  WORKPLAN.md             Phase plan + risks
  validation.md           Test coverage
  scenarios.md            Test scenarios
  MASTER.md               Portal
  legacy/                 Archived research
```

## Non-Functional Requirements

| Requirement | Target |
|-------------|--------|
| Correctness | Deterministic for indexing/storage |
| Calibration | Probabilistic but calibrated for synthesis |
| Cold Start | Fast with progressive enrichment |
| Concurrency | Safe with locks and event ordering |
| Scalability | Batch processing for large repos |

## Document History

| Date | Version | Changes |
|------|---------|---------|
| 2026-01-04 | 1.1.0 | Added vector schema, engine contracts, adapter spec, cross-references |
| 2026-01-04 | 1.0.0 | Initial architecture document |

---

*This document is authoritative for LiBrainian system architecture.*
