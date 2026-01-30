# Legacy Research Notice
This file is archived. Canonical guidance lives in `docs/librarian/README.md` and `docs/librarian/MASTER.md`.
This legacy spec is a historical snapshot and is not authoritative.

# WAVE0 + LIBRARIAN: Historical FULL Tier Specification (Archived)

> **VERSION**: 2.0.0 FULL (December 2025)
> **PURPOSE**: Historical research snapshot for Librarian; not an authoritative spec.

---

## PART 1: THE THEORY

### 1.1 The Problem We're Solving

Traditional software development tools are **passive** - they wait for human direction. They don't learn from outcomes, don't understand context, don't adapt to codebases, and don't improve over time. Each task starts from zero.

**Wave0** is different. It's an **autonomous, self-improving software development system** that:
- Understands codebases semantically (not just syntactically)
- Learns from every outcome (success and failure)
- Adapts its strategies based on evidence
- Maintains honest confidence signals about its knowledge
- Operates with genuine autonomy (self-healing, not blocking)

### 1.2 The SCAS Framework

Wave0 is a **Successful Complex Adaptive System (SCAS)** - not just any CAS, but one designed to succeed. The 12 SCAS principles govern everything:

| Principle | How Wave0 Implements It |
|-----------|------------------------|
| **P1: Diverse Agents** | Multiple specialized agents (executor, critic, planner) |
| **P2: Self-Organization** | Agents coordinate without central control |
| **P3: Adaptability** | Librarian confidence signals drive behavior changes |
| **P4: Emergence** | System-level intelligence from simple agent interactions |
| **P5: Feedback Loops** | Every outcome updates knowledge and confidence |
| **P6: Edge of Chaos** | Balanced exploration/exploitation via fitness landscape |
| **P7: Path Dependence** | Episodic memory informs future decisions |
| **P8: Learning** | Librarian records ALL outcomes, learns from failures |
| **P9: Homeostasis** | Quality gates and constraints maintain system health |
| **P10: Via Negativa** | Anti-pattern detection prevents known failures |
| **P11: Fitness Landscape** | Bench harness measures progress toward optima |
| **P12: Multi-Level Intelligence** | Individual + team + system-level optimization |

### 1.3 The Fundamental Insight

> **Code understanding should be a first-class, persistent, learned system - not a side effect of execution.**

This insight drives the entire architecture. Rather than having agents re-analyze code every time, we build a knowledge system that:
- **Persists** understanding across sessions
- **Learns** from outcomes
- **Provides honest confidence** about what it knows and doesn't know
- **Improves continuously** through feedback loops

---

## PART 2: THE CONCEPT

### 2.1 What is Librarian?

**Librarian** is wave0's knowledge backbone - the system that understands code and provides that understanding to agents. It answers fundamental questions:

| Question | Librarian Capability | Implementation |
|----------|---------------------|----------------|
| "What does this code do?" | Semantic indexing (embeddings + AST) | `EmbeddingService`, `ast_indexer.ts` |
| "How does this code connect?" | Dependency graphs, call graphs | `call_edge_extractor.ts`, `module_graph.ts` |
| "What would be affected by this change?" | Impact analysis, blast radius | `knowledge/impact.ts` (489 LOC) |
| "What rules apply here?" | Constraint engine (explicit + learned) | `engines/constraint_engine.ts` (482 LOC) |
| "How confident should I be?" | Multi-dimensional confidence | `engines/meta_engine.ts` (390 LOC) |
| "What went wrong last time?" | SBFL attribution, failure patterns | `integration/causal_attribution.ts` |
| "Who knows about this code?" | Ownership matrix, expertise matching | `ingest/ownership_indexer.ts` |
| "What tests cover this?" | Test-to-code mapping | `ingest/test_indexer.ts` |

### 2.2 The Three Engines

Librarian's intelligence is organized into three production-ready engines:

#### RELEVANCE ENGINE (`src/librarian/engines/relevance_engine.ts` - 297 LOC)

```
"What do I need to know for this task?"

METHODS:
├── query(intent, options)          Routes intent with budget constraints
├── findPatterns(target)            Pattern discovery in codebase
├── findExamples(pattern)           Semantic search (similarity >0.35)
├── getBlastRadius(files)           Multi-file impact analysis
├── getTestCoverage(files)          Test mapping for affected files
├── expandScope(files, depth)       Transitive dependency expansion
├── recordOutcome(packId, success)  Learning from results
└── learnNegative(packId, reason)   Learn from failures
```

#### CONSTRAINT ENGINE (`src/librarian/engines/constraint_engine.ts` - 482 LOC)

```
"What rules apply and am I breaking them?"

METHODS:
├── getApplicableConstraints(files)     Explicit + inferred constraints
├── previewChange(file, content)        Hypothetical validation
├── validateChange(file, before, after) Full validation with diff
├── validateBatch(changes)              Multi-file validation
├── explainConstraint(id)               User-facing rationale
├── requestException(id, reason)        7-day temporary bypass
├── getBoundaries(file)                 Layer boundary information
├── inferConstraints(patterns)          Auto-discovery from code
├── detectDrift(file)                   Definition change detection
└── suggestConstraint(pattern)          Learning from successful patterns
```

#### META-KNOWLEDGE ENGINE (`src/librarian/engines/meta_engine.ts` - 390 LOC)

```
"How confident should I be?"

METHODS:
├── qualify(entityId, type)             Per-entity confidence scoring
├── shouldProceed(confidence)           Confidence gate (threshold ≥0.4)
├── assessRisk(files)                   Risk = 1 - overall confidence
├── getBlindSpots()                     Coverage gap identification
├── getExperts(file)                    Ownership → expertise mapping
└── attributeFailure(outcome, context)  SBFL Ochiai scoring

CONFIDENCE MODEL:
├── Freshness: exp(-(daysSinceIndex/7) * ln(2))   7-day half-life
├── Coverage: (entities + relationships + tests + ownership) / 4
├── Reliability: usageCount * successRate * trendFactor
└── Overall: cbrt(freshness * coverage * reliability)  Geometric mean
```

### 2.3 The Six Knowledge Domains

Each domain provides specialized queries:

#### ARCHITECTURE KNOWLEDGE (`src/librarian/knowledge/architecture.ts` - 585 LOC)

```typescript
interface ArchitectureQuery {
  type:
    | 'dependencies'      // Direct + transitive dependency traversal
    | 'dependents'        // Reverse dependency analysis
    | 'layers'            // Inferred from directory structure
    | 'cycles'            // Tarjan's SCC algorithm
    | 'coupling'          // Afferent/efferent + instability index
    | 'core_modules'      // PageRank + betweenness centrality
    | 'boundaries'        // Layer constraint validation
    | 'violations';       // Aggregated constraint violations
}
```

#### IMPACT KNOWLEDGE (`src/librarian/knowledge/impact.ts` - 489 LOC)

```typescript
interface ImpactQuery {
  type:
    | 'change_impact'     // BFS affected module discovery
    | 'blast_radius'      // Comprehensive percentage calculation
    | 'test_impact'       // Test-to-code mapping
    | 'risk_assessment'   // 7-factor risk scoring
    | 'safe_changes'      // Leaf module identification
    | 'breaking_changes'; // API compatibility analysis
}
```

#### QUALITY KNOWLEDGE (`src/librarian/knowledge/quality.ts` - 450 LOC)

```typescript
interface QualityQuery {
  type:
    | 'complexity'        // Cyclomatic via ts-morph AST
    | 'smells'            // Long Method, God Module, Dependency Magnet, Too Many Params
    | 'debt'              // Technical debt estimation
    | 'improvements'      // Impact/effort ratio recommendations
    | 'refactoring'       // Candidate generation
    | 'hotspots'          // High-churn + high-complexity
    | 'maintainability'   // Overall scoring
    | 'test_coverage';    // Gap analysis
}
```

#### PATTERNS KNOWLEDGE (`src/librarian/knowledge/patterns.ts` - 449 LOC)

```typescript
interface PatternsQuery {
  type:
    | 'design_patterns'   // Factory, Singleton detection
    | 'anti_patterns'     // Common anti-pattern detection
    | 'naming'            // Convention analysis
    | 'team_style'        // Coding style inference
    | 'error_handling'    // Error pattern analysis
    | 'async_patterns'    // Async/await detection
    | 'testing_patterns'; // Testing approach identification
}
```

#### EVOLUTION KNOWLEDGE (`src/librarian/knowledge/evolution.ts` - 500 LOC)

```typescript
interface EvolutionQuery {
  type:
    | 'fitness'           // Agent/policy fitness metrics
    | 'learning'          // Task outcome insights
    | 'optimization'      // Opportunity identification
    | 'trends'            // Performance direction detection
    | 'performance'       // Current metrics
    | 'patterns'          // Successful patterns
    | 'failures'          // Failure patterns
    | 'recommendations';  // System suggestions
}
```

#### STRUCTURE KNOWLEDGE (`src/librarian/knowledge/structure.ts` - 423 LOC)

```typescript
interface StructureQuery {
  type:
    | 'organization'      // Style inference (layered/feature/hybrid/flat)
    | 'directories'       // Structure analysis
    | 'modules'           // Relationship analysis
    | 'entry_points'      // bin/, index.ts, main detection
    | 'exports'           // Export structure analysis
    | 'file_types'        // Distribution by extension/category
    | 'depth';            // Nesting depth analysis
}
```

### 2.4 The Golden Rule

> **IF wave0 needs to know something about the codebase, THEN it MUST ask librarian. NEVER implement parallel analysis.**

This rule prevents:
- Duplicated analysis logic scattered across agents
- Inconsistent understanding of the same code
- Lost learning opportunities
- Fragmented knowledge

### 2.5 The Self-Healing Principle

> **Wave0 is autonomous. It does NOT block on issues it can fix itself.**

The agentic review system exemplifies this:
1. Multiple perspectives review code (Ship It, Break It, Maintain It)
2. Issues are identified with severity and fix recommendations
3. **Auto-fix loop** attempts to resolve issues automatically
4. Only truly unfixable issues require human intervention
5. The system learns from what worked and what didn't

---

## PART 3: THE ARCHITECTURE

### 3.1 File Structure (Actual Paths)

```
src/librarian/
├── agents/                           # Indexing agents (6 modules)
│   ├── index_librarian.ts            # Core file/function indexing (main agent)
│   ├── swarm_runner.ts               # Parallel worker pool orchestration
│   ├── swarm_scheduler.ts            # File prioritization and scheduling
│   ├── ast_indexer.ts                # AST-based code analysis
│   ├── call_edge_extractor.ts        # Call graph extraction
│   ├── parser_registry.ts            # Language parser management
│   └── types.ts                      # Agent type definitions
│
├── api/                              # Public API surface (24 modules)
│   ├── librarian.ts                  # Main entry point (createLibrarian)
│   ├── query.ts                      # Query execution (queryLibrarian)
│   ├── bootstrap.ts                  # Initialization (bootstrapProject)
│   ├── embeddings.ts                 # EmbeddingService implementation
│   ├── governors.ts                  # Budget enforcement (73 LOC)
│   ├── governor_context.ts           # Governor context tracking
│   ├── packs.ts                      # Context pack generation
│   ├── versioning.ts                 # Version management
│   ├── reporting.ts                  # Report generation
│   ├── confidence_calibration.ts     # Confidence calibration
│   └── empty_values.ts               # Empty value utilities
│
├── engines/                          # Core reasoning (5 modules)
│   ├── relevance_engine.ts           # 297 LOC - Context assembly
│   ├── constraint_engine.ts          # 482 LOC - Rule validation
│   ├── meta_engine.ts                # 390 LOC - Confidence & attribution
│   ├── types.ts                      # Engine type definitions (47+ types)
│   └── index.ts                      # Engine exports
│
├── graphs/                           # Graph algorithms (5 modules)
│   ├── pagerank.ts                   # PageRank implementation
│   ├── centrality.ts                 # Betweenness centrality
│   ├── communities.ts                # Community detection
│   ├── metrics.ts                    # Graph metrics computation
│   └── temporal_graph.ts             # Co-change analysis
│
├── ingest/                           # Data ingestion (16 sources)
│   ├── docs_indexer.ts               # Markdown with LLM summarization
│   ├── commit_indexer.ts             # Git history with semantic analysis
│   ├── ownership_indexer.ts          # CODEOWNERS parsing
│   ├── test_indexer.ts               # Test-to-code mapping
│   ├── deps_indexer.ts               # Package dependencies
│   ├── config_indexer.ts             # JSON/YAML/TOML configs
│   ├── ci_indexer.ts                 # GitHub Actions/GitLab CI
│   ├── security_indexer.ts           # Security policies
│   ├── schema_indexer.ts             # OpenAPI/GraphQL/DB schemas
│   ├── api_indexer.ts                # Endpoint extraction
│   ├── domain_indexer.ts             # Business logic categorization
│   ├── process_indexer.ts            # Workflow definitions
│   ├── team_indexer.ts               # Team structure
│   ├── adr_indexer.ts                # Architecture Decision Records
│   ├── framework.ts                  # Ingestion orchestration
│   └── types.ts                      # Ingestion type definitions
│
├── integration/                      # Wave0 integration (12 modules)
│   ├── wave0_integration.ts          # Main hooks (430 LOC)
│   ├── first_run_gate.ts             # Bootstrap gating
│   ├── causal_attribution.ts         # SBFL Ochiai scoring
│   ├── file_watcher.ts               # Incremental file watching
│   ├── emergency_mode.ts             # Emergency mode handling
│   └── ...
│
├── knowledge/                        # Semantic queries (10 modules)
│   ├── architecture.ts               # 585 LOC
│   ├── impact.ts                     # 489 LOC
│   ├── quality.ts                    # 450 LOC
│   ├── patterns.ts                   # 449 LOC
│   ├── evolution.ts                  # 500 LOC
│   ├── structure.ts                  # 423 LOC
│   ├── evolution_metrics.ts          # Evolution metric calculations
│   ├── module_graph.ts               # Module graph building
│   ├── quality_metrics.ts            # Quality metric calculations
│   └── index.ts                      # Knowledge exports
│
├── storage/                          # Persistence (4 modules)
│   ├── sqlite_storage.ts             # ~2,000 LOC - Main storage
│   ├── types.ts                      # Storage type definitions
│   └── ...
│
├── types.ts                          # Core types (366 LOC)
├── events.ts                         # Event system
├── universal_patterns.ts             # File patterns
└── index.ts                          # Public exports (254 LOC)
```

### 3.2 Storage Schema (SQLite)

Complete table definitions:

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `librarian_modules` | Files, exports, dependencies | path, exports, dependencies, checksum |
| `librarian_functions` | Functions with signatures | name, filePath, signature, complexity, embedding |
| `librarian_graph_edges` | Module-level call/import graph | caller, callee, edgeType, weight |
| `librarian_test_mapping` | Test-to-code relationships | testPath, sourcePath, confidence |
| `librarian_commits` | Git history with categorization | sha, message, author, category, filesChanged |
| `librarian_ownership` | DOA scores with recency | filePath, author, score, lastModified |
| `librarian_context_packs` | Bundled context + metrics | packId, targetId, summary, keyFacts, successCount, failureCount |
| `librarian_embeddings` | Semantic embeddings | entityId, entityType, vector, model |
| `librarian_query_cache` | Persistent cache with TTL | queryHash, result, createdAt, expiresAt |
| `librarian_ingested_items` | Ingestion tracking | itemType, itemId, ingestedAt, checksum |
| `librarian_evolution_outcomes` | Task outcomes for learning | taskId, success, durationMs, qualityScore |
| `librarian_learned_missing` | Missing knowledge tracking | entityId, entityType, learnedAt |
| `librarian_cochange` | Co-change relationships | fileA, fileB, cochangeCount |
| `librarian_confidence_events` | Confidence history | entityId, entityType, delta, reason, createdAt |

### 3.3 Key Algorithms

| Algorithm | Purpose | Location | Status |
|-----------|---------|----------|--------|
| **Tarjan's SCC** | Cycle detection | `knowledge/architecture.ts:299-370` | FULL |
| **PageRank** | Module importance | `graphs/pagerank.ts` | FULL |
| **Betweenness Centrality** | Bridge identification | `graphs/centrality.ts` | FULL |
| **Cyclomatic Complexity** | Code complexity | `knowledge/quality_metrics.ts` | FULL |
| **BFS/DFS** | Graph traversal | `knowledge/impact.ts:109-127` | FULL |
| **Ochiai Score (SBFL)** | Fault localization | `integration/causal_attribution.ts` | FULL |
| **Cosine Similarity** | Embedding search | `storage/sqlite_storage.ts` | FULL |
| **Martin Metrics** | Coupling/cohesion | `knowledge/architecture.ts` | FULL |
| **DOA** | Ownership scoring | `ingest/ownership_indexer.ts` | FULL |
| **Community Detection** | Module clustering | `graphs/communities.ts` | FULL |

### 3.4 Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                         INGESTION (16 Sources)                   │
│  Files → AST Indexer → Embeddings → Storage (SQLite WAL)         │
│        → Test Indexer → Test Mappings →                          │
│        → Commit Indexer → History + Semantic Categories →        │
│        → Docs Indexer → LLM Summaries →                          │
│        → Ownership Indexer → DOA Scores →                        │
│        → Config/CI/Schema/API/Domain Indexers →                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                       KNOWLEDGE LAYER (6 Domains)                │
│  architecture.ts: Cycles, coupling, core modules, layers        │
│  impact.ts: Blast radius, test coverage, risk assessment        │
│  quality.ts: Complexity, smells, debt, hotspots                 │
│  patterns.ts: Design patterns, anti-patterns, naming            │
│  evolution.ts: Fitness, learning, optimization, trends          │
│  structure.ts: Organization, directories, entry points          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      ENGINE LAYER (3 Engines)                    │
│  RelevanceEngine: Context assembly, pattern finding, blast rad  │
│  ConstraintEngine: Rule validation, boundary checking, drift    │
│  MetaEngine: Confidence, attribution, recommendations           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     WAVE0 INTEGRATION                            │
│  preOrchestrationHook(): Bootstrap gating + file watcher        │
│  enrichTaskContext(): Inject knowledge into agent prompts       │
│  recordTaskOutcome(): Learn from success/failure (SBFL)         │
│  notifyFileChange(): Incremental reindexing                     │
│  postOrchestrationHook(): Cleanup + file watcher stop           │
└─────────────────────────────────────────────────────────────────┘
```

### 3.5 Confidence Model

Confidence is **multi-dimensional**, never a single number:

```typescript
interface ConfidenceModel {
  freshness: number;    // 0-1: exp(-(daysSinceIndex/7) * ln(2)) - 7-day half-life
  coverage: number;     // 0-1: (entities + relationships + tests + ownership) / 4
  reliability: number;  // 0-1: usageCount * successRate * trendFactor
  overall: number;      // cbrt(freshness * coverage * reliability) - geometric mean
  signals: string[];    // What contributed to this confidence
  caveats: string[];    // What's uncertain or missing
}

// One bad dimension tanks everything (geometric mean)
// This prevents gaming by excelling in one area while neglecting others
```

---

## PART 4: THE QUERY SYSTEM

### 4.1 Query Depths

| Level | Description | Pack Count | Embeddings | Use Case |
|-------|-------------|------------|------------|----------|
| **L0** | Fastest | 2-3 packs | Skipped | Quick lookups |
| **L1** | Default | 5-8 packs | Used | Standard tasks |
| **L2** | Deep | 10-15 packs | Full scan | Complex refactoring |

### 4.2 Scoring Weights

```typescript
const SCORING_WEIGHTS = {
  semantic: 0.40,      // Embedding similarity
  pagerank: 0.20,      // Module importance
  confidence: 0.20,    // Knowledge confidence
  centrality: 0.10,    // Bridge module detection
  recency: 0.10,       // Recent changes prioritized
};
```

### 4.3 Budget System

```typescript
interface QueryBudget {
  maxFiles: number;        // Maximum files to return
  maxTokens: number;       // Maximum tokens in response
  maxDepth: number;        // Maximum dependency traversal depth
  timeoutMs: number;       // Query timeout
  waitForIndexMs?: number; // Wait for pending indexing
}
```

### 4.4 Tiered Results

```typescript
// Results are categorized by importance:
interface QueryResponse {
  essential: ContextPack[];    // 40% - Must-have context
  contextual: ContextPack[];   // 40% - Nice-to-have context
  reference: ContextPack[];    // 20% - Background reference
}
```

---

## PART 5: THE INTEGRATION LAYER

### 5.1 Wave0 Integration Hooks

From `src/librarian/integration/wave0_integration.ts` (430 LOC):

```typescript
// 1. Bootstrap gating (called at startup)
async function preOrchestrationHook(
  workspace: string,
  options?: {
    onProgress?: (phase: string, progress: number, message: string) => void;
    timeoutMs?: number;
  }
): Promise<void>

// 2. Context injection (before each task)
async function enrichTaskContext(
  workspace: string,
  query: {
    intent: string;
    affectedFiles?: string[];
    taskType?: string;
    waitForIndexMs?: number;
    taskId?: string;
  }
): Promise<LibrarianContext>

// 3. Learning loop (after each task)
async function recordTaskOutcome(
  workspace: string,
  outcome: {
    packIds: string[];
    success: boolean;
    filesModified?: string[];
    failureReason?: string;
    failureType?: string;
    taskId?: string;
    intent?: string;
  }
): Promise<void>

// 4. Incremental updates (on file changes)
async function notifyFileChange(workspace: string, filePath: string): Promise<void>
async function notifyFileChanges(workspace: string, filePaths: string[]): Promise<void>

// 5. Cleanup (at shutdown)
async function postOrchestrationHook(workspace: string): Promise<void>
```

### 5.2 SBFL Attribution

From `src/librarian/integration/causal_attribution.ts`:

```typescript
interface AttributionResult {
  knowledgeCaused: boolean;
  suspiciousPacks: Array<{
    packId: string;
    score: number;  // Ochiai score: passed/(passed+failed)^0.5 * failed
  }>;
  confidence: number;
}

// Called automatically on task failure to identify suspicious context packs
async function attributeFailure(
  storage: LibrarianStorage,
  outcome: TaskOutcomeSummary,
  context: AgentKnowledgeContext
): Promise<AttributionResult>
```

### 5.3 Event System

From `src/librarian/events.ts`:

```typescript
type LibrarianEventType =
  | 'bootstrap_started'
  | 'bootstrap_completed'
  | 'file_modified'
  | 'context_packs_invalidated'
  | 'task_received'
  | 'task_completed'
  | 'task_failed'
  | 'confidence_updated'
  | 'indexing_started'
  | 'indexing_completed';

// Global event bus for system-wide coordination
export const globalEventBus: LibrarianEventBus;
```

---

## PART 6: THE GOVERNOR SYSTEM

### 6.1 Budget Configuration

From `src/librarian/api/governors.ts` (73 LOC):

```typescript
interface GovernorConfig {
  maxTokensPerFile: 50_000;       // Token limit per file
  maxTokensPerPhase: 500_000;     // Token limit per bootstrap phase
  maxTokensPerRun: 2_000_000;     // Token limit per full run
  maxFilesPerPhase: 0;            // 0 = unlimited (large codebases need flexibility)
  maxWallTimeMs: 0;               // 0 = unlimited (bootstrap can take as long as needed)
  maxRetries: 3;                  // Retry limit for transient failures
  maxConcurrentWorkers: 4;        // Parallel worker limit
  maxEmbeddingsPerBatch: 10;      // Embedding batch size
}
```

### 6.2 Budget Reporting

```typescript
interface GovernorBudgetReportV1 {
  kind: 'GovernorBudgetReport.v1';
  schema_version: 1;
  created_at: string;
  canon: CanonRef;                // Reproducibility reference
  environment: EnvironmentRef;    // System environment
  phase: string;                  // Current phase
  budget_limits: GovernorConfig;  // Applied limits
  usage: GovernorUsage;           // Actual usage
  outcome: GovernorBudgetOutcome; // success | unverified_by_trace
}
```

---

## PART 7: OPERATIONS

### 7.1 Bootstrap Command

```bash
# Bootstrap librarian (EMBEDDINGS REQUIRED)
npx ts-node scripts/bootstrap_librarian.ts --provider claude

# Provider options:
# --provider claude     (Claude API - recommended)
# --provider openai     (OpenAI API)
# --provider local      (Local Ollama)

# NOTE: --skip-embeddings is NOT SUPPORTED
# Embeddings are REQUIRED for FULL tier functionality
```

### 7.2 Verification Commands

```bash
# Check librarian database status
sqlite3 state/librarian/librarian.sqlite "
  SELECT
    (SELECT COUNT(*) FROM librarian_modules) as modules,
    (SELECT COUNT(*) FROM librarian_functions) as functions,
    (SELECT COUNT(*) FROM librarian_embeddings) as embeddings,
    (SELECT COUNT(*) FROM librarian_context_packs) as packs;
"

# Run librarian qualification tests
npm run test:librarian

# Run agentic librarian review
node scripts/agentic_librarian_review.mjs
```

### 7.3 Integration Example

```typescript
import {
  preOrchestrationHook,
  enrichTaskContext,
  recordTaskOutcome,
} from 'librarian';

// At startup (HARD FAILS if librarian unavailable)
await preOrchestrationHook(workspace);

// Before each task
const context = await enrichTaskContext(workspace, {
  intent: "implement feature X",
  affectedFiles: ["src/foo.ts"]
});
// context.summary, context.keyFacts, context.relatedFiles now available

// After EVERY task (success or failure)
await recordTaskOutcome(workspace, {
  packIds: context.packIds,
  success: taskSucceeded,
  filesModified: changedFiles,
  failureReason: taskSucceeded ? undefined : "Tests failed",
});
// This updates confidence, feeds SBFL, enables learning
```

---

## PART 8: QUALITY REQUIREMENTS (FULL TIER)

### 8.1 Non-Negotiable Requirements

| Requirement | Status | Enforcement |
|-------------|--------|-------------|
| Embeddings | **REQUIRED** | Bootstrap fails without provider |
| LLM Provider | **REQUIRED** | No non-agentic fallback |
| Pattern Detection | **REQUIRED** | Active in all knowledge queries |
| All 6 Knowledge Domains | **REQUIRED** | All must be functional |
| All 3 Engines | **REQUIRED** | All must be functional |
| Confidence Tracking | **REQUIRED** | Every entity tracked |
| SBFL Attribution | **REQUIRED** | Every failure analyzed |

### 8.2 Coverage Targets

| Metric | Required Target |
|--------|-----------------|
| File Coverage | 100% of source files indexed |
| Function Coverage | 100% of functions with embeddings |
| Dependency Coverage | All module dependencies mapped |
| Test Coverage Map | All tests linked to source files |
| Context Packs | LLM-generated summaries for all modules |
| Confidence Freshness | > 0.9 (data less than 7 days old) |
| Confidence Reliability | > 0.8 (> 80% historical success rate) |

### 8.3 What is NOT Allowed

- **No MVP mode**: FULL tier is the only mode
- **No skip-embeddings**: Embeddings are mandatory
- **No non-agentic fallback**: LLM providers are required
- **No confidence gaming**: Geometric mean prevents single-dimension optimization
- **No silent failures**: All failures must be logged and attributed
- **No fake embeddings**: LLM-generated "embeddings" are NOT real embeddings - use proper embedding models

### 8.4 Speed & Timing Policy

> **SPEED DOES NOT MATTER. CORRECTNESS AND COMPLETENESS ARE EVERYTHING.**

| Constraint | Policy |
|------------|--------|
| **Timeouts** | **NONE** - Operations take as long as they need |
| **Rate Limits** | Respect provider limits, but wait indefinitely for availability |
| **Bootstrap Time** | No limit - full codebase indexing can take hours |
| **Query Time** | No limit - complete answers over fast wrong answers |
| **Retry Limits** | **NONE** - Retry until success or unrecoverable error |

**Rationale**: This is a knowledge system for AI agents. Agents have infinite patience. An incomplete or wrong answer is infinitely worse than a slow correct answer. The system must:
- Wait indefinitely for LLM providers to become available
- Retry failed operations without arbitrary limits
- Complete full semantic analysis even on large codebases
- Never sacrifice quality for speed

**Implementation**:
- No `timeout` parameters on LLM calls
- No `maxRetries` that cause silent failure
- Progress callbacks for visibility, not deadlines
- Graceful handling of rate limits with exponential backoff (no cap)

### 8.5 Embedding Policy

> **EMBEDDINGS MUST BE REAL SEMANTIC VECTORS FROM DEDICATED EMBEDDING MODELS.**

| Requirement | Implementation |
|-------------|----------------|
| **Primary Provider** | `@xenova/transformers` (all-MiniLM-L6-v2, 384-dim) |
| **Fallback Provider** | `sentence-transformers` via Python subprocess |
| **Emergency Fallback** | Ollama with `nomic-embed-text` model |
| **FORBIDDEN** | LLM-generated "embeddings" (these are hallucinated numbers, not real vectors) |

**Why LLM embeddings don't work**:
- LLMs are not trained to produce embedding vectors
- When asked for embeddings, they hallucinate plausible-looking numbers
- These don't have proper semantic properties for similarity search
- Dimension mismatches and parsing failures are symptoms of this fundamental flaw

**Real embedding models**:
- Are specifically trained to map text → dense vectors
- Guarantee consistent dimensions
- Produce vectors where cosine similarity correlates with semantic similarity
- Are fast, reliable, and deterministic

---

## PART 9: VERSION HISTORY

### 9.1 Current Version

```typescript
export const LIBRARIAN_VERSION = {
  major: 2,
  minor: 0,
  patch: 0,
  string: '2.0.0',
  minCompatible: '1.0.0',
  features: [
    'basic_indexing',
    'confidence_tracking',
    'context_packs',
    'embeddings',           // REQUIRED
    'pattern_detection',    // REQUIRED
    'hierarchical_summaries',
    'cross_project_learning',
  ],
};
```

### 9.2 Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2025-12-25 | Initial MVP release |
| 2.0.0 | 2025-12-31 | FULL tier - no MVP shortcuts, embeddings required |

### 9.3 Quality Tiers

```typescript
export const QUALITY_TIERS = {
  full: {
    level: 3,
    description: 'Full: All features required, no shortcuts',
    supersedes: ['mvp', 'enhanced'],
  },
};

// MVP and Enhanced tiers are DEPRECATED
// Only FULL tier is supported
```

---

## PART 10: IMPLEMENTATION STATUS

### 10.1 Component Completion

| Component | LOC | Status | Notes |
|-----------|-----|--------|-------|
| SQLite Storage | ~2,000 | 100% | WAL, locking, transactions |
| Architecture Knowledge | 585 | 100% | Tarjan's, PageRank, Martin Metrics |
| Impact Knowledge | 489 | 100% | Blast radius, risk assessment |
| Quality Knowledge | 450 | 100% | Complexity, smells, debt |
| Patterns Knowledge | 449 | 95% | Design patterns, anti-patterns |
| Evolution Knowledge | 500 | 100% | Fitness, learning, trends |
| Structure Knowledge | 423 | 100% | Organization, entry points |
| Relevance Engine | 297 | 100% | Context assembly, patterns |
| Constraint Engine | 482 | 100% | Validation, boundaries |
| Meta-Knowledge Engine | 390 | 100% | Confidence, attribution |
| Wave0 Integration | 430 | 100% | All 5 hooks functional |
| 16 Ingestion Sources | ~3,000 | 95% | All indexers implemented |

### 10.2 Algorithm Status

| Algorithm | Status | Evidence |
|-----------|--------|----------|
| Tarjan's SCC | FULL | Cycle detection working |
| PageRank | FULL | Core module ranking working |
| Betweenness Centrality | FULL | Bridge identification working |
| Cyclomatic Complexity | FULL | ts-morph AST analysis working |
| SBFL Ochiai | FULL | Failure attribution working |
| DOA Ownership | FULL | Recency-weighted ownership working |
| Cosine Similarity | FULL | Embedding search working |
| Community Detection | FULL | Module clustering working |

---

## PART 11: REFERENCE

### 11.1 Document Map

| Document | Purpose | Read When |
|----------|---------|-----------|
| **VISION.md** (this) | Authoritative FULL specification | First |
| **README.md** | Navigation + quick status | Finding specific docs |
| **overview.md** | Problem matrix, gap status | Understanding current state |
| **architecture.md** | Technical architecture | Before implementing |
| **implementation-requirements.md** | Detailed specs | During implementation |
| **scenarios.md** | 30 real-world scenarios | Understanding behavior |
| **validation.md** | Verification checklists | After implementing |

### 11.2 Key Exports

From `src/librarian/index.ts`:

```typescript
// Core
export { Librarian, createLibrarian, createLibrarianSync } from './api/librarian.js';

// Query
export { queryLibrarian, createFunctionQuery, createFileQuery } from './api/query.js';

// Bootstrap
export { bootstrapProject, isBootstrapRequired, getBootstrapStatus } from './api/bootstrap.js';

// Version
export { detectLibrarianVersion, upgradeRequired, runUpgrade } from './api/versioning.js';

// Storage
export { createSqliteStorage, createStorageFromBackend } from './storage/sqlite_storage.js';

// Integration
export { ensureLibrarianReady, getLibrarian, resetGate } from './integration/first_run_gate.js';
export { preOrchestrationHook, enrichTaskContext, recordTaskOutcome } from './integration/wave0_integration.js';

// Knowledge
export { Knowledge } from './knowledge/index.js';

// Engines
export { RelevanceEngine, ConstraintEngine, MetaKnowledgeEngine } from './engines/index.js';

// Events
export { LibrarianEventBus, globalEventBus } from './events.js';
```

### 11.3 Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `ANTHROPIC_API_KEY` | - | Claude API key (required for claude provider) |
| `OPENAI_API_KEY` | - | OpenAI API key (required for openai provider) |
| `WVO_DETERMINISTIC` | `0` | Set to `1` to skip librarian in tests |
| `WAVE0_TEST_MODE` | `false` | Set to `true` for deterministic test mode |
| `WVO_LIBRARIAN_WAIT_INDEX_MS` | - | Wait for pending indexing (ms) |
| `WVO_LIBRARIAN_WATCH_DEBOUNCE_MS` | `500` | File watcher debounce (ms) |

---

## CONCLUSION

Librarian v2.0.0 FULL tier represents the complete, production-ready knowledge system for Wave0:

1. **122+ TypeScript files** implementing comprehensive functionality
2. **3 Engines** (Relevance, Constraint, Meta-Knowledge) providing intelligent reasoning
3. **6 Knowledge Domains** (Architecture, Impact, Quality, Patterns, Evolution, Structure)
4. **16 Ingestion Sources** for comprehensive codebase understanding
5. **Multi-dimensional Confidence** preventing gaming via geometric mean
6. **SBFL Attribution** learning from every failure
7. **Full Wave0 Integration** with 5 hooks and event system

**There is no degraded mode. This is FULL functionality or nothing.**

---

**Navigation**: [README.md](./README.md) | [overview.md](./overview.md) | [architecture.md](./architecture.md) | [Back to docs root](../)
