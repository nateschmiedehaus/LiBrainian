# LiBrainian Architecture Diagram

## System Overview

LiBrainian is an epistemic knowledge layer for AI coding agents. It provides calibrated, evidence-backed understanding of any codebase through a sophisticated multi-layered architecture.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           USER CODEBASE                                       │
│                        (Any project structure)                                │
└──────────────────────────────┬──────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      LiBrainian SYSTEM (CORE)                                  │
│                                                                               │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                    CLI LAYER (Developer UX)                            │ │
│  │  ┌──────────┬────────┬───────────┬────────┬──────────┬─────────────┐  │ │
│  │  │ status   │ query  │ bootstrap │ inspect│confidence│ visualize   │  │ │
│  │  │ analyze  │ heal   │ evolve    │ health │ diagnose │ config heal │  │ │
│  │  └──────────┴────────┴───────────┴────────┴──────────┴─────────────┘  │ │
│  │                          src/cli/                                      │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                   │                                           │
│                                   ▼                                           │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │               ORCHESTRATOR LAYER (Session Management)                  │ │
│  │                                                                        │ │
│  │  initializeLibrarian()  ──────┐                                        │ │
│  │                               ├──> LibrarianSession                    │ │
│  │  - Auto-bootstrap             │    - query()                          │ │
│  │  - Auto-configure             │    - recordOutcome()                  │ │
│  │  - Optimal tier selection      │    - health()                        │ │
│  │  - Background watching         └────────────────────────────────────  │ │
│  │                          src/orchestrator/                            │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                   │                                           │
│                                   ▼                                           │
│  ┌─────────────────────────────────┬─────────────────────────────────────┐ │
│  │                                 │                                     │ │
│  │ ┌──────────────────────────┐   │   ┌────────────────────────────┐   │ │
│  │ │   INDEXING LAYER         │   │   │  STORAGE LAYER             │   │ │
│  │ │                          │   │   │                            │   │ │
│  │ │ • AST Parsing            │   │   │ SQLite Database            │   │ │
│  │ │ • Semantic Embedding     │   │   │ • Function Index           │   │ │
│  │ │ • Incremental Updates    │   │   │ • Import Graph            │   │ │
│  │ │ • Symbol Extraction      │   │   │ • Call Graph              │   │ │
│  │ │ • Relationship Discovery │   │   │ • Vector Index            │   │ │
│  │ │                          │   │   │ • Context Cache           │   │ │
│  │ │      src/bootstrap/      │   │   │ • Evidence Ledger         │   │ │
│  │ │      src/ingest/         │   │   │ • Confidence Storage      │   │ │
│  │ └──────────────────────────┘   │   │      src/storage/         │   │ │
│  │                                 │   └────────────────────────────┘   │ │
│  └─────────────────────────────────┴─────────────────────────────────────┘ │
│                                   │                                           │
│                                   ▼                                           │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │            EPISTEMICS LAYER (Knowledge Backbone) ★★★                   │ │
│  │                                                                        │ │
│  │  CORE MODULES:                                                        │ │
│  │  ┌─────────────────────┐  ┌─────────────────────┐                     │ │
│  │  │ Confidence System   │  │ Evidence Ledger     │                     │ │
│  │  │ - Deterministic     │  │ - Append-only       │                     │ │
│  │  │ - Bounded           │  │ - W3C PROV export   │                     │ │
│  │  │ - Absent            │  │ - Event tracking    │                     │ │
│  │  │ - Bayesian updates  │  │ - Provenance graph  │                     │ │
│  │  └─────────────────────┘  └─────────────────────┘                     │ │
│  │  ┌─────────────────────┐  ┌─────────────────────┐                     │ │
│  │  │ Defeater Calculus   │  │ Calibration System  │                     │ │
│  │  │ - Formal defeaters  │  │ - Isotonic curve    │                     │ │
│  │  │ - Undermining       │  │ - PAC thresholds    │                     │ │
│  │  │ - Rebuttals         │  │ - ECE scoring       │                     │ │
│  │  │ - Detection engine  │  │ - Calibration laws  │                     │ │
│  │  └─────────────────────┘  └─────────────────────┘                     │ │
│  │                                                                        │ │
│  │  ADVANCED MODULES:                                                    │ │
│  │  ┌─────────────────────┐  ┌─────────────────────┐                     │ │
│  │  │ Conative Attitudes  │  │ Temporal Grounding  │                     │ │
│  │  │ - Intentions        │  │ - Decay functions   │                     │ │
│  │  │ - Preferences       │  │ - Validity periods  │                     │ │
│  │  │ - Goals             │  │ - Staleness detect  │                     │ │
│  │  │ - BDI agent states  │  │ - TTL tracking      │                     │ │
│  │  └─────────────────────┘  └─────────────────────┘                     │ │
│  │  ┌─────────────────────┐  ┌─────────────────────┐                     │ │
│  │  │ Intuitive Grounding │  │ Inference Auditing  │                     │ │
│  │  │ - Patterns          │  │ - Fallacy detection │                     │ │
│  │  │ - Articulation      │  │ - Circular reason   │                     │ │
│  │  │ - Upgrade paths     │  │ - Hasty general     │                     │ │
│  │  └─────────────────────┘  └─────────────────────┘                     │ │
│  │  ┌─────────────────────┐  ┌─────────────────────┐                     │ │
│  │  │ Quality Gates       │  │ Universal Coherence │                     │ │
│  │  │ - Standards check   │  │ - Cross-level eval  │                     │ │
│  │  │ - Course correct    │  │ - Consistency check │                     │ │
│  │  │ - Epistemic guards  │  │ - Belief integrity  │                     │ │
│  │  └─────────────────────┘  └─────────────────────┘                     │ │
│  │                                                                        │ │
│  │  THEORETICAL FOUNDATIONS:                                             │ │
│  │  ┌─────────────────────┐  ┌─────────────────────┐                     │ │
│  │  │ Belief Functions    │  │ AGM Belief Revision │                     │ │
│  │  │ - Dempster-Shafer   │  │ - Belief update     │                     │ │
│  │  │ - Imprecise prob    │  │ - Entrenchment      │                     │ │
│  │  └─────────────────────┘  └─────────────────────┘                     │ │
│  │  ┌─────────────────────┐  ┌─────────────────────┐                     │ │
│  │  │ Credal Sets         │  │ Multi-Agent Epist   │                     │ │
│  │  │ - Interval arith    │  │ - Social epist      │                     │ │
│  │  │ - Uncertainty prop  │  │ - Testimony eval    │                     │ │
│  │  └─────────────────────┘  └─────────────────────┘                     │ │
│  │                                                                        │ │
│  │                      src/epistemics/                                  │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                   │                                           │
│                                   ▼                                           │
│  ┌─────────────────────────────────┬─────────────────────────────────────┐ │
│  │                                 │                                     │ │
│  │ ┌──────────────────────────┐   │   ┌────────────────────────────┐   │ │
│  │ │   KNOWLEDGE LAYER        │   │   │  QUERY & API LAYER         │   │ │
│  │ │                          │   │   │                            │   │ │
│  │ │ • Context Packs          │   │   │ Query Pipeline             │   │ │
│  │ │ • Function Knowledge     │   │   │ - Parsing                  │   │ │
│  │ │ • Module Knowledge       │   │   │ - Domain classification    │   │ │
│  │ │ • Pattern Detection      │   │   │ - Composition selection    │   │ │
│  │ │ • Hierarchical Summaries │   │   │ - Retrieval               │   │ │
│  │ │ • Cross-project Learning │   │   │ - Synthesis                │   │ │
│  │ │                          │   │   │ - Ranking                  │   │ │
│  │ │      src/knowledge/      │   │   │                            │   │ │
│  │ └──────────────────────────┘   │   │ API Surface                │   │ │
│  │                                 │   │ - queryLibrarian()         │   │ │
│  │                                 │   │ - LiBrainian class          │   │ │
│  │                                 │   │ - Perspective support      │   │ │
│  │                                 │   │                            │   │ │
│  │                                 │   │      src/api/              │   │ │
│  │                                 │   │      src/query/            │   │ │
│  │                                 │   └────────────────────────────┘   │ │
│  └─────────────────────────────────┴─────────────────────────────────────┘ │
│                                   │                                           │
│                                   ▼                                           │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │            QUALITY & RECOMMENDATIONS LAYER                             │ │
│  │                                                                        │ │
│  │ • Issue Detection & Ranking                                           │ │
│  │ • ROI-based Prioritization                                            │ │
│  │ • Refactoring Advice                                                  │ │
│  │ • Architecture Analysis                                               │ │
│  │ • Difficulty Detection                                                │ │
│  │ • Best Practices Database                                             │ │
│  │                                                                        │ │
│  │      src/quality/                                                     │ │
│  │      src/recommendations/                                             │ │
│  │      src/api/difficulty_detectors.ts                                  │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                   │                                           │
│                                   ▼                                           │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │            MEASUREMENT & OBSERVABILITY LAYER                           │ │
│  │                                                                        │ │
│  │ • Calibration Tracking (ECE, MCE, Brier Score)                       │ │
│  │ • Freshness Monitoring                                                │ │
│  │ • Query Performance Metrics                                           │ │
│  │ • Code Graph Health                                                   │ │
│  │ • Recovery State Machine                                              │ │
│  │ • Prometheus Export                                                   │ │
│  │ • SLO Tracking                                                        │ │
│  │                                                                        │ │
│  │      src/measurement/                                                 │ │
│  │      src/observability/                                               │ │
│  │      src/telemetry/                                                   │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                   │                                           │
│                                   ▼                                           │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │            INTEGRATION & CONTROL LOOP LAYER                            │ │
│  │                                                                        │ │
│  │ • Agent Feedback Loop                                                 │ │
│  │ • Closed-loop Recovery System                                         │ │
│  │ • File Watcher                                                        │ │
│  │ • Outcome Recording                                                   │ │
│  │ • Wave0 Integration Hooks                                             │ │
│  │ • MCP Server                                                          │ │
│  │ • Agent Protocol                                                      │ │
│  │ • Compliance Reporting                                                │ │
│  │ • Read Policy Registry                                                │ │
│  │                                                                        │ │
│  │      src/integration/                                                 │ │
│  │      src/mcp/                                                         │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                   │                                           │
│                                   ▼                                           │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │            EVOLUTIONARY & STRATEGIC LAYER                              │ │
│  │                                                                        │ │
│  │ • Homeostatic Healing (daemon)                                        │ │
│  │ • Evolutionary Improvement Loop                                       │ │
│  │ • Strategic Planning                                                  │ │
│  │ • Cascading Impact Analysis                                           │ │
│  │ • Cross-graph Propagation                                             │ │
│  │ • Importance Metrics                                                  │ │
│  │ • Self-improvement Loop                                               │ │
│  │                                                                        │ │
│  │      src/homeostasis/                                                 │ │
│  │      src/evolution/                                                   │ │
│  │      src/strategic/                                                   │ │
│  │      src/graphs/                                                      │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                   │                                           │
│                                   ▼                                           │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │            ANALYSIS & VISUALIZATION LAYER                              │ │
│  │                                                                        │ │
│  │ • Mermaid Diagram Generation                                          │ │
│  │ • ASCII Tree Visualization                                            │ │
│  │ • Health Summary Rendering                                            │ │
│  │ • Dependency Graphs                                                   │ │
│  │ • Persona Views                                                       │ │
│  │ • Trajectory Analysis                                                 │ │
│  │                                                                        │ │
│  │      src/visualization/                                               │ │
│  │      src/analysis/                                                    │ │
│  │      src/views/                                                       │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                   │                                           │
│                                   ▼                                           │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │            DEBUG & TRACING LAYER (G10)                                 │ │
│  │                                                                        │ │
│  │ • LibrarianTracer (distributed tracing)                               │ │
│  │ • LibrarianInspector (introspection)                                  │ │
│  │ • Tracing Bridge                                                      │ │
│  │ • Formatted Trace Tree                                                │ │
│  │ • Module/Function/Query inspection                                    │ │
│  │                                                                        │ │
│  │      src/debug/                                                       │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                               │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │            PROVIDER ADAPTERS & CONFIG LAYER                            │ │
│  │                                                                        │ │
│  │ • LLM Service Adapters (Claude, etc.)                                 │ │
│  │ • Embedding Providers (Xenova, etc.)                                  │ │
│  │ • Model Policy Registry                                               │ │
│  │ • Provider Health Checks                                              │ │
│  │ • Config Healing                                                      │ │
│  │ • Preflight Checks                                                    │ │
│  │                                                                        │ │
│  │      src/adapters/                                                    │ │
│  │      src/providers/                                                   │ │
│  │      src/preflight/                                                   │ │
│  │      src/config/                                                      │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                               │
└─────────────────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        AI CODING AGENTS                                       │
│           Claude Code • Cursor • Windsurf • Custom Agents                    │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Core Subsystems Detail

### 1. Epistemics Layer (Heart of LiBrainian)

The epistemics layer is the most sophisticated component, providing formal epistemological foundations for confidence and belief management.

```
EPISTEMICS LAYER
├── Core Foundations
│   ├── Confidence System
│   │   ├── Deterministic (certain facts)
│   │   ├── Bounded [low, high] (uncertain ranges)
│   │   ├── Absent (unknown)
│   │   └── Bayesian Updates (prior→posterior)
│   │
│   ├── Evidence Ledger (Append-only Audit Trail)
│   │   ├── Claim Evidence
│   │   ├── Verification Evidence
│   │   ├── Contradiction Evidence
│   │   ├── Outcome Evidence
│   │   └── W3C PROV Export
│   │
│   ├── Defeater Calculus (What undermines claims)
│   │   ├── Rebutting Defeaters (counter-evidence)
│   │   ├── Undercutting Defeaters (challenge reasoning)
│   │   ├── Relevance Defeaters (irrelevant data)
│   │   └── Detection/Application Engine
│   │
│   └── Calibration System
│       ├── Isotonic Regression Curve
│       ├── PAC-based Thresholds
│       ├── Proper Scoring Rules
│       └── Expected Calibration Error (ECE)
│
├── Advanced Reasoning
│   ├── Conative Attitudes (Action-directed)
│   │   ├── Intentions
│   │   ├── Preferences
│   │   ├── Goals
│   │   └── BDI Agent States
│   │
│   ├── Temporal Grounding
│   │   ├── Decay Functions
│   │   ├── Validity Periods (TTL)
│   │   ├── Automatic Staleness Detection
│   │   └── Timestamp Tracking
│   │
│   ├── Intuitive Grounding
│   │   ├── Pattern Recognition
│   │   ├── Articulability Scoring
│   │   └── Upgrade Paths to Formal Justification
│   │
│   ├── Inference Auditing
│   │   ├── Fallacy Detection (circular, hasty, etc.)
│   │   ├── Suggested Fixes
│   │   └── Coherence Checking
│   │
│   ├── Quality Gates
│   │   ├── Standard Enforcement
│   │   ├── Course Correction
│   │   └── Epistemic Guards
│   │
│   └── Universal Coherence
│       ├── Cross-level Evaluation
│       ├── Consistency Checking
│       └── Belief Integrity
│
└── Mathematical Foundations
    ├── Belief Functions
    │   └── Dempster-Shafer Theory
    │
    ├── Credal Sets
    │   └── Interval Arithmetic
    │
    ├── AGM Belief Revision
    │   ├── Entrenchment
    │   └── Postulate Verification
    │
    └── Multi-Agent Epistemology
        ├── Social Epistemics
        ├── Testimony Evaluation
        └── Group Consensus
```

### 2. Query Pipeline (How Queries are Processed)

```
Query Input
    │
    ├─ Stage 1: Intent Classification
    │   └─> Identify domain (auth, API, DB, etc.)
    │
    ├─ Stage 2: Composition Selection
    │   └─> Choose relevant construction patterns
    │
    ├─ Stage 3: Domain Support Planning
    │   └─> Decompose to fundamental aspects
    │
    ├─ Stage 4: Semantic Retrieval
    │   ├─> Vector search
    │   └─> PageRank-enhanced ranking
    │
    ├─ Stage 5: Context Assembly
    │   ├─> Function signatures
    │   ├─> Call relationships
    │   └─> Documentation
    │
    ├─ Stage 6: Confidence Calibration
    │   └─> Apply Bayesian updates
    │
    ├─ Stage 7: Defeater Detection
    │   └─> Check what undermines claims
    │
    ├─ Stage 8: Temporal Validation
    │   └─> Check staleness/validity
    │
    ├─ Stage 9: Synthesis (LLM)
    │   └─> Generate natural language
    │
    └─ Output: Context + Evidence + Confidence + Uncertainties
```

### 3. Storage Architecture

```
SQLite Database
├── Tables
│   ├── functions (AST symbols)
│   ├── imports (module dependencies)
│   ├── calls (function relationships)
│   ├── tests (test coverage)
│   ├── context_packs (pre-computed context)
│   ├── embeddings (semantic vectors)
│   └── [epistemics tables]
│       ├── claims
│       ├── evidence
│       ├── defeaters
│       ├── contradictions
│       ├── calibration
│       └── evidence_ledger
│
├── Indices
│   ├── Vector index (all-MiniLM-L6-v2)
│   ├── Embeddings HNSW
│   └── Graph indices
│
└── WAL (Write-Ahead Log) for durability
```

### 4. Bootstrap Phases

```
Bootstrap Process (src/api/bootstrap.ts)
│
├─ Preflight Checks
│  ├─ Environment variables
│  ├─ LLM provider availability
│  ├─ Embedding provider availability
│  ├─ Workspace accessibility
│  ├─ Disk space
│  ├─ Database access
│  └─ Memory availability
│
├─ Phase 1: Structural Scan
│  └─> Find all source files, build initial graph
│
├─ Phase 2: Symbol Extraction
│  └─> Parse AST, extract functions, imports, classes
│
├─ Phase 3: Relationship Discovery
│  └─> Build call graph, import graph, test associations
│
├─ Phase 4: Embedding Generation
│  └─> Semantic embeddings for code snippets
│
├─ Phase 5: Knowledge Synthesis
│  └─> LLM-generated summaries and purposes
│
├─ Phase 6: Context Pack Generation
│  └─> Pre-compute context for common intents
│
├─ Phase 7: Calibration Initialization
│  └─> Initialize confidence and evidence system
│
└─ Phase 8: Verification
   └─> Validate all data integrity
```

## Data Flow Diagrams

### Query Data Flow

```
Agent Query Request
    │
    ▼
CLI/API Entry Point (src/cli/index.ts or src/index.ts)
    │
    ▼
Orchestrator (src/orchestrator/unified_init.ts)
    │ Auto-bootstrap if needed
    ▼
Query Pipeline (src/api/query.ts)
    │
    ├─ Intent Classification (domain_support.ts)
    │  └─> Decompose to aspects
    │
    ├─ Semantic Search (embeddings.ts)
    │  └─> Vector similarity search
    │
    ├─ Graph Ranking (knowledge/index.ts)
    │  └─> PageRank + centrality
    │
    ├─ Assembly (context_assembly.ts)
    │  └─> Collect related code
    │
    ├─ Epistemics Engine (epistemics/index.ts)
    │  ├─ Confidence computation (computed_confidence.ts)
    │  ├─ Defeater detection (defeaters.ts)
    │  ├─ Calibration (calibration.ts)
    │  └─ Evidence ledger (evidence_ledger.ts)
    │
    ├─ Synthesis (api/LiBrainian.ts)
    │  └─> Format for agent consumption
    │
    └─ Response with:
       ├─ Context packs (code + docs)
       ├─ Function signatures
       ├─ Call relationships
       ├─ Evidence citations
       ├─ Confidence scores
       └─ Uncertainty bounds
```

### Bootstrap Data Flow

```
$ LiBrainian bootstrap
    │
    ▼
CLI Bootstrap Command (src/cli/commands/bootstrap.ts)
    │
    ▼
Preflight Checks (src/preflight/)
    │
    ▼
Tiered Bootstrap (src/bootstrap/index.ts)
    │
    ├─ Structural Scan (file discovery)
    │   └─> src/ingest/docs_indexer.ts
    │
    ├─ Symbol Extraction (AST parsing)
    │   └─> TypeScript parser
    │
    ├─ Relationship Discovery (graph building)
    │   └─> Call/import graph construction
    │
    ├─ Embedding Generation
    │   └─> src/api/embeddings.ts
    │
    ├─ Knowledge Synthesis
    │   └─> src/knowledge/generator.ts
    │
    ├─ Context Pack Generation
    │   └─> src/knowledge/index.ts
    │
    ├─ Confidence Initialization
    │   └─> src/epistemics/calibration.ts
    │
    └─ Storage (src/storage/sqlite_storage.ts)
        └─> Persist all indexed data
```

## Integration Points

### Pre-Agent Hook

```typescript
// Before agent starts working on a task
await preOrchestrationHook(workspace);
// - Ensures LiBrainian is bootstrapped
// - Checks providers are available
// - Sets up file watching
```

### In-Task Integration

```typescript
// During agent work
const context = await LiBrainian.query(intent);
// - Semantic search
// - Confidence-aware results
// - Evidence citations
```

### Post-Task Feedback Loop

```typescript
// After agent completes a task
await recordTaskOutcome({
  success: true,
  packIds: context.packIds,
  fixedIssues: [...],
  newIssues: [...],
});
// - Calibration updates
// - Feedback loop
// - Outcome tracking
```

## Key File Organization

```
src/
├── api/                    # Query API, bootstrap, embeddings
│   ├── LiBrainian.ts       # Main LiBrainian class
│   ├── query.ts           # Query execution
│   ├── bootstrap.ts       # Bootstrap orchestration
│   ├── embeddings.ts      # Semantic embeddings
│   ├── domain_support.ts  # Domain decomposition
│   └── ...
│
├── epistemics/             # Epistemic framework (★ CORE)
│   ├── confidence.ts      # Confidence types & operations
│   ├── evidence_ledger.ts # Append-only audit trail
│   ├── defeaters.ts       # Defeater detection/application
│   ├── calibration.ts     # Calibration curves
│   ├── conative_attitudes.ts
│   ├── temporal_grounding.ts
│   └── ...
│
├── storage/               # Data persistence
│   ├── sqlite_storage.ts  # Main database
│   ├── types.ts           # Storage schema
│   ├── vector_index.ts    # Embedding index
│   └── content_cache.ts   # Query result cache
│
├── bootstrap/             # Indexing phases
│   └── index.ts           # Tiered bootstrap
│
├── knowledge/             # Code knowledge
│   ├── generator.ts       # Knowledge synthesis
│   ├── patterns.ts        # Pattern detection
│   └── extractors/        # Pattern/security extractors
│
├── query/                 # Query ranking
│   ├── scoring.ts         # Relevance scoring
│   └── multi_signal_scorer.ts
│
├── integration/           # Agent integration
│   ├── wave0_integration.ts
│   ├── feedback_loop.ts
│   ├── file_watcher.ts
│   └── ...
│
├── measurement/           # Metrics & observability
│   ├── calibration_ledger.ts
│   ├── index.ts
│   └── ...
│
├── homeostasis/           # Self-healing
│   ├── daemon.ts
│   └── index.ts
│
├── evolution/             # Self-improvement
│   └── ...
│
├── strategic/             # Strategic analysis
│   ├── prioritization.ts
│   └── ...
│
├── graphs/                # Graph analysis
│   ├── cascading_impact.ts
│   ├── cross_graph_propagation.ts
│   └── importance_metrics.ts
│
├── cli/                   # Developer UX
│   ├── index.ts           # CLI entry point
│   └── commands/          # All commands
│
├── orchestrator/          # Session management
│   └── unified_init.ts    # initializeLibrarian()
│
├── visualization/         # Diagram generation
│   └── mermaid_generator.ts
│
└── debug/                 # Tracing & inspection
    └── index.ts
```

## Configuration & Quality Tiers

### Quality Tiers

```
MVP (Tier 1)
├─ Basic indexing
├─ Function-level context packs
└─ Simple scoring

Enhanced (Tier 2)
├─ Pattern detection
├─ Decision tracking
└─ Improved ranking

Full (Tier 3) ← LiBrainian USES THIS
├─ Hierarchical summaries
├─ Cross-project learning
├─ Epistemics framework
├─ Evidence ledger
├─ Defeater calculus
└─ Calibration system
```

### Configuration Sources

```
1. LiBrainian.json (workspace config)
2. Environment variables
3. Provider registry (LLM, embeddings)
4. Auto-detection (language, patterns)
5. Tier selector (auto-selects 'full')
```

## Version & Upgrade Path

```
LiBrainian Version
├─ Major: Breaking changes requiring full re-index
├─ Minor: Backward-compatible additions
└─ Patch: Bug fixes

Current: 2.0.0
├─ Minimum compatible: 1.0.0
└─ Features:
   ├─ basic_indexing
   ├─ confidence_tracking
   ├─ context_packs
   ├─ embeddings (REQUIRED)
   ├─ pattern_detection
   ├─ hierarchical_summaries
   └─ cross_project_learning
```

## Deployment Scenarios

### 1. Standalone Agent Use
```
Agent Code
  ↓
import { initializeLibrarian } from 'librainian'
  ↓
const session = await initializeLibrarian(workspace)
  ↓
const context = await session.query(intent)
```

### 2. CLI Interface
```
$ LiBrainian bootstrap
$ LiBrainian query "intent"
$ LiBrainian status
```

### 3. MCP Server (IDE Integration)
```
IDE (VS Code, etc.)
  ↓
LiBrainian serve
  ↓
MCP Server
  ↓
Tools: librarian_query, librarian_get_issues, etc.
```

### 4. Custom Integration
```
Custom Tool
  ↓
import { queryLibrarian, LiBrainian } from 'librainian'
  ↓
Direct API access
```

## Performance Characteristics

| Operation | Time | Memory |
|-----------|------|--------|
| Bootstrap (10k files) | ~3 min | ~500MB |
| Incremental update | ~100ms | ~50MB |
| Query (p50) | ~150ms | ~20MB |
| Query (p99) | ~800ms | ~50MB |
| Refresh index | ~30s | ~100MB |

## Notable Design Decisions

1. **SQLite for Storage**: Durable, queryable, no external dependencies
2. **Epistemics-First**: Confidence is first-class, not afterthought
3. **Evidence Ledger**: Append-only audit trail for all claims
4. **Defeater Calculus**: Formal system for what undermines beliefs
5. **Calibration**: Proper scoring rules, ECE tracking
6. **Multi-Agent Support**: Social epistemics and testimony evaluation
7. **Auto-Bootstrap**: Agents don't need to manually initialize
8. **Incremental Indexing**: Changes update instantly, not full re-index
9. **Query Pipeline**: Modular stages, observable, traceable
10. **Resource Management**: Adaptive pools, backpressure, throttling

## Testing Architecture

```
4,280+ Tests
├─ Tier-0: Pure (no providers, no network)
├─ Tier-1: Providers available (LLM, embeddings)
├─ Tier-2: External services (real APIs)
└─ Tier-3: System/integration tests

Coverage: 95%+
```

---

## Quick Reference: Main Entry Points

| Use Case | Entry Point | File |
|----------|------------|------|
| Agent embedding | `import { initializeLibrarian }` | src/orchestrator/index.ts |
| Direct query API | `import { queryLibrarian }` | src/api/query.ts |
| CLI usage | `npx librainian <cmd>` | src/cli/index.ts |
| Storage access | `import { createSqliteStorage }` | src/storage/sqlite_storage.ts |
| Epistemics | `import { computeConfidence, ... }` | src/epistemics/index.ts |
| Integration hooks | `import { preOrchestrationHook, ... }` | src/integration/wave0_integration.ts |

