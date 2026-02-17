# Legacy Research Notice
This file is archived. Canonical guidance lives in `docs/LiBrainian/README.md`.
Extract useful research into canonical docs; do not extend this file.

# LiBrainian Universal Knowledge Layer: Comprehensive System Audit

> **Audit Scope**: Complete evaluation of the LiBrainian system against documented vision, architecture, and implementation specifications.
> **Version**: 2.0.0 (FULL tier - no MVP shortcuts)
> **Generated**: 2026-01-01

---

## Executive Summary & Audit Objectives

You are tasked with conducting the most thorough audit possible of the **LiBrainian Universal Knowledge Layer** - a semantic code understanding system designed to provide AI agents with rich, confidence-rated context about codebases. This audit must evaluate whether reality matches intention across every documented dimension.

### Core Questions This Audit Must Answer

1. **Does LiBrainian deliver on its VISION.md promises?**
2. **Is the documented architecture actually implemented?**
3. **Are the 25 world-class knowledge gaps (G1-G25) truly addressed?**
4. **Do the three core engines (Relevance, Constraint, Meta-Knowledge) actually function?**
5. **Is Wave0 integration real or theoretical?**
6. **What is exported but never called? What is called but broken?**

---

## Phase 1: Core Documentation Review

Read these documents IN ORDER to establish the baseline of what SHOULD exist:

### 1.1 Vision & Philosophy

| Document | Purpose | Key Questions to Answer |
|----------|---------|------------------------|
| `docs/LiBrainian/VISION.md` | Aspirational goals | What was promised? What's the "north star"? |
| `docs/LiBrainian/UNDERSTANDING_LAYER.md` | Universal understanding philosophy | How should code understanding flow? |
| `docs/LiBrainian/overview.md` | Implementation summary | What's the claimed status? |

### 1.2 Architecture & Design

| Document | Purpose | Key Questions to Answer |
|----------|---------|------------------------|
| `docs/LiBrainian/architecture.md` | Unified architecture spec | Are shared primitives (Entity, Confidence, Scope) actually used? |
| `docs/LiBrainian/implementation-requirements.md` | Detailed specs | Are the 2,500+ lines of specs implemented? |
| `docs/LiBrainian/world-class-gaps.md` | G13-G25 deep dive | What's the real status vs claimed? |
| `docs/LiBrainian/REMAINING_WORK.md` | Actionable tasks (R0-R10) | Are "complete" items actually complete? |

### 1.3 Integration & Validation

| Document | Purpose | Key Questions to Answer |
|----------|---------|------------------------|
| `docs/LiBrainian/validation.md` | Verification checklists | Do the validation tests actually pass? |
| `docs/LiBrainian/scenarios.md` | 30 real-world scenarios | Can LiBrainian handle these cases? |
| `docs/policies/MODEL_SELECTION_POLICY.md` | LLM provider requirements | Is Opus 4.5 actually being used? |
| `docs/CLAUDE.md` | Project-wide context | How does LiBrainian fit? |

---

## Phase 2: Complete Implementation Mapping

### 2.1 Public API Surface Audit

**File**: `src/LiBrainian/index.ts`

Trace every export and determine:

```typescript
// For EACH export in index.ts:
{
  exportName: string;
  exportType: 'function' | 'class' | 'type' | 'constant';
  sourceFile: string;
  hasTests: boolean;
  hasProductionCallers: boolean;  // Outside of tests
  callerCount: number;
  integrationWired: boolean;      // Connected to Wave0
  actuallyWorks: 'yes' | 'partial' | 'no' | 'unknown';
}
```

### Expected Exports to Audit (from index.ts)

| Category | Exports | Critical Questions |
|----------|---------|-------------------|
| **Core Interface** | `LiBrainian`, `createLibrarian`, `createLibrarianSync` | Does `createLibrarian()` actually initialize a working system? |
| **Query System** | `queryLibrarian`, `createFunctionQuery`, `createFileQuery`, `createRelatedQuery` | Do queries return meaningful results? |
| **Bootstrap** | `bootstrapProject`, `isBootstrapRequired`, `getBootstrapStatus` | Does bootstrap complete all 5 phases? |
| **Versioning** | `detectLibrarianVersion`, `upgradeRequired`, `runUpgrade` | Does version detection work? |
| **Storage** | `createSqliteStorage`, `createStorageFromBackend` | Is SQLite actually storing data? |
| **Engines** | `LibrarianEngineToolkit`, `RelevanceEngine`, `ConstraintEngine`, `MetaKnowledgeEngine` | Do engines actually influence query results? |
| **Events** | `LibrarianEventBus`, `globalEventBus`, `onLibrarianEvent` | Are events being emitted? Are there listeners? |
| **Integration** | `preOrchestrationHook`, `enrichTaskContext`, `recordTaskOutcome` | Is Wave0 calling these? |
| **Knowledge** | `Knowledge`, `bayesianUpdate`, `checkDefeaters` | Is confidence actually updated? Are defeaters checked? |
| **Views** | `projectForPersona`, `generateGlanceCard` | Do persona views work? |
| **Visualization** | `generateMermaidDiagram`, `generateASCIITree` | Do diagrams generate? |
| **Recommendations** | `generateRefactoringRecommendations`, `analyzeArchitecture` | Do recommendations work? |
| **Debug** | `LibrarianTracer`, `LibrarianInspector` | Does tracing capture data? |

### 2.2 Storage Layer Deep Dive

**Files**: `src/LiBrainian/storage/sqlite_storage.ts`, `src/LiBrainian/storage/types.ts`

Run these diagnostic queries against `.LiBrainian/LiBrainian.db`:

```sql
-- 1. Schema inventory
SELECT name, sql FROM sqlite_master WHERE type='table' ORDER BY name;

-- 2. Table row counts
SELECT
  'librarian_modules' as tbl, COUNT(*) as cnt FROM librarian_modules
  UNION ALL SELECT 'librarian_functions', COUNT(*) FROM librarian_functions
  UNION ALL SELECT 'librarian_context_packs', COUNT(*) FROM librarian_context_packs
  UNION ALL SELECT 'librarian_graph_edges', COUNT(*) FROM librarian_graph_edges
  UNION ALL SELECT 'librarian_query_cache', COUNT(*) FROM librarian_query_cache
  UNION ALL SELECT 'librarian_confidence_history', COUNT(*) FROM librarian_confidence_history
  UNION ALL SELECT 'librarian_embeddings', COUNT(*) FROM librarian_embeddings
  UNION ALL SELECT 'librarian_test_mappings', COUNT(*) FROM librarian_test_mappings
  UNION ALL SELECT 'librarian_ownership', COUNT(*) FROM librarian_ownership
  UNION ALL SELECT 'librarian_commits', COUNT(*) FROM librarian_commits
  UNION ALL SELECT 'librarian_adrs', COUNT(*) FROM librarian_adrs;

-- 3. Graph edge types
SELECT edge_type, COUNT(*) as cnt
FROM librarian_graph_edges
GROUP BY edge_type
ORDER BY cnt DESC;

-- 4. Context pack types
SELECT type, COUNT(*) as cnt
FROM librarian_context_packs
GROUP BY type
ORDER BY cnt DESC;

-- 5. Confidence distribution
SELECT
  CASE
    WHEN confidence >= 0.9 THEN 'high (0.9-1.0)'
    WHEN confidence >= 0.7 THEN 'medium (0.7-0.9)'
    WHEN confidence >= 0.5 THEN 'low (0.5-0.7)'
    ELSE 'very_low (<0.5)'
  END as tier,
  COUNT(*) as cnt
FROM librarian_context_packs
GROUP BY tier;

-- 6. Embedding coverage
SELECT
  (SELECT COUNT(*) FROM librarian_modules) as total_modules,
  (SELECT COUNT(DISTINCT entity_id) FROM librarian_embeddings WHERE entity_type='module') as modules_with_embeddings,
  (SELECT COUNT(*) FROM librarian_functions) as total_functions,
  (SELECT COUNT(DISTINCT entity_id) FROM librarian_embeddings WHERE entity_type='function') as functions_with_embeddings;

-- 7. Cache effectiveness
SELECT
  COUNT(*) as total_cached,
  SUM(access_count) as total_hits,
  AVG(access_count) as avg_hits_per_query,
  COUNT(CASE WHEN expires_at < datetime('now') THEN 1 END) as expired
FROM librarian_query_cache;

-- 8. Staleness check (tables that might be empty)
SELECT name,
  (SELECT COUNT(*) FROM pragma_table_info(name)) as column_count
FROM sqlite_master
WHERE type='table'
  AND name LIKE 'librarian_%'
  AND NOT EXISTS (SELECT 1 FROM sqlite_master WHERE sql LIKE '%' || name || '%' LIMIT 1);
```

### 2.3 Ingestion Pipeline Audit

**Directory**: `src/LiBrainian/ingest/`

There are 16 documented indexers. For EACH indexer:

| Indexer | File | Data Source | Output Table | Status to Verify |
|---------|------|-------------|--------------|------------------|
| **AST Indexer** | `ast_indexer.ts` | Source files | `librarian_functions`, `librarian_modules` | Does ts-morph parse all TS/JS? |
| **Call Edge Extractor** | `call_edge_extractor.ts` | AST | `librarian_graph_edges` | Are imports/calls captured? |
| **Test Indexer** | `test_indexer.ts` | Test files | `librarian_test_mappings` | Is test-to-code mapping complete? |
| **Commit Indexer** | `commit_indexer.ts` | Git history | `librarian_commits` | Are semantic summaries generated? |
| **Ownership Indexer** | `ownership_indexer.ts` | Git blame | `librarian_ownership` | Is ownership matrix populated? |
| **ADR Indexer** | `adr_indexer.ts` | `docs/adr/` | `librarian_adrs` | Are ADRs indexed? |
| **Docs Indexer** | `docs_indexer.ts` | Markdown files | `librarian_docs` | Are docs linked to code? |
| **Config Indexer** | `config_indexer.ts` | Config files | `librarian_config` | Is config awareness present? |
| **Schema Indexer** | `schema_indexer.ts` | Database schemas | `librarian_schemas` | Are DB schemas indexed? |
| **API Indexer** | `api_indexer.ts` | API routes | `librarian_apis` | Are endpoints discovered? |
| **CI Indexer** | `ci_indexer.ts` | CI configs | `librarian_ci` | Is CI context available? |
| **Security Indexer** | `security_indexer.ts` | Security patterns | `librarian_security` | Are vulnerabilities flagged? |
| **Domain Indexer** | `domain_indexer.ts` | Domain concepts | `librarian_domains` | Is domain knowledge extracted? |
| **Team Indexer** | `team_indexer.ts` | Team structure | `librarian_teams` | Is team context available? |
| **Process Indexer** | `process_indexer.ts` | Business processes | `librarian_processes` | Are processes documented? |
| **Deps Indexer** | `deps_indexer.ts` | package.json | `librarian_dependencies` | Are dependencies tracked? |

**Verification Commands**:

```bash
# Check which indexers actually run during bootstrap
grep -r "registerIndexer\|addIndexer" src/LiBrainian/ingest/

# Check bootstrap phases
grep -A 50 "BOOTSTRAP_PHASES" src/LiBrainian/types.ts

# Verify indexer output
sqlite3 .LiBrainian/LiBrainian.db "SELECT COUNT(*) FROM librarian_test_mappings"
```

### 2.4 Engine Toolkit Audit

**Directory**: `src/LiBrainian/engines/`

The documentation claims three core engines with specific capabilities:

#### Engine 1: Relevance Engine

**File**: `src/LiBrainian/engines/relevance_engine.ts`

| Claimed Feature | Method | Verify |
|-----------------|--------|--------|
| Context retrieval | `query(intent, budget, urgency)` | Returns meaningful packs? |
| Blind spot detection | `getBlindSpots()` | Actually detects gaps? |
| Pattern recognition | `findPatterns(scope)` | Finds real patterns? |
| Blast radius | `getBlastRadius(files)` | Accurate impact analysis? |

#### Engine 2: Constraint Engine

**File**: `src/LiBrainian/engines/constraint_engine.ts`

| Claimed Feature | Method | Verify |
|-----------------|--------|--------|
| Change preview | `previewChange(files)` | Shows affected constraints? |
| Validation | `validateChange(diff)` | Catches violations? |
| Constraint learning | `suggestConstraint(pattern)` | Learns from outcomes? |
| Get constraints | `getConstraints(scope)` | Returns real constraints? |

#### Engine 3: Meta-Knowledge Engine

**File**: `src/LiBrainian/engines/meta_engine.ts`

| Claimed Feature | Method | Verify |
|-----------------|--------|--------|
| Pack qualification | `qualify(packIds)` | Returns confidence reports? |
| Proceed decision | `shouldProceed(files, action)` | Makes sensible decisions? |
| Failure attribution | `attributeFailure(outcome)` | Uses SBFL algorithm? |
| Confidence tracking | `getConfidence(entityId)` | Returns calibrated confidence? |

**Engine Integration Test**:

```typescript
// Run this test to verify engines actually influence results:
const toolkit = createLibrarianEngineToolkit({ workspace: '.' });

// 1. Query with and without engines
const withEngines = await LiBrainian.query({ intent: 'auth', includeEngines: true });
const withoutEngines = await LiBrainian.query({ intent: 'auth', includeEngines: false });

// 2. Verify engine data is present
assert(withEngines.engines?.relevance?.blindSpots !== undefined);
assert(withEngines.engines?.constraints?.applicable !== undefined);
assert(withEngines.engines?.meta?.confidence !== undefined);

// 3. Verify proceed decision is sensible
const proceed = await toolkit.meta.shouldProceed(['src/critical.ts'], 'refactor');
assert(['proceed', 'caution', 'block'].includes(proceed.decision));
```

### 2.5 Wave0 Integration Audit

**Files**:
- `src/LiBrainian/integration/wave0_integration.ts`
- `src/orchestrator/context_assembler.ts`
- `src/orchestrator/unified_orchestrator.ts`

Trace the ACTUAL integration points:

```
┌─────────────────────────────────────────────────────────────────┐
│                     CLAIMED INTEGRATION FLOW                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. preOrchestrationHook()                                      │
│     └── CALLED BY: UnifiedOrchestrator.initialize()?            │
│     └── EVIDENCE: grep -r "preOrchestrationHook" src/           │
│                                                                 │
│  2. enrichTaskContext()                                         │
│     └── CALLED BY: context_assembler.ts?                        │
│     └── EVIDENCE: grep -r "enrichTaskContext" src/              │
│                                                                 │
│  3. recordTaskOutcome()                                         │
│     └── CALLED BY: task completion handler?                     │
│     └── EVIDENCE: grep -r "recordTaskOutcome" src/              │
│                                                                 │
│  4. notifyFileChange()                                          │
│     └── CALLED BY: file watcher?                                │
│     └── EVIDENCE: grep -r "notifyFileChange" src/               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Critical Integration Questions**:

1. **Is LiBrainian context making it into agent prompts?**
   - Find where agent prompts are assembled
   - Verify LiBrainian data is included
   - Check if confidence scores are surfaced

2. **Are task outcomes feeding back to update confidence?**
   - Find where task results are processed
   - Verify `recordTaskOutcome()` is called
   - Check if confidence actually changes in DB

3. **Is the file watcher connected?**
   - Find where `startFileWatcher()` is called
   - Verify events trigger reindexing
   - Check debounce behavior

### 2.6 Event Bus Audit

**File**: `src/LiBrainian/events.ts`

List ALL event types and find their listeners:

| Event Type | Emitter Location | Listener Location | Purpose |
|------------|------------------|-------------------|---------|
| `bootstrap:started` | bootstrap.ts | ? | Track bootstrap start |
| `bootstrap:phase:complete` | bootstrap.ts | ? | Track phase completion |
| `bootstrap:complete` | bootstrap.ts | ? | Signal ready state |
| `bootstrap:error` | bootstrap.ts | ? | Handle failures |
| `query:start` | query.ts | ? | Track query latency |
| `query:result` | query.ts | ? | Log query results |
| `query:error` | query.ts | ? | Handle query failures |
| `index:file` | indexers | ? | Track indexing progress |
| `index:function` | indexers | ? | Track function discovery |
| `index:complete` | indexers | ? | Signal indexing done |
| `engine:relevance` | relevance_engine.ts | ? | Relevance decisions |
| `engine:constraint` | constraint_engine.ts | ? | Constraint checks |
| `engine:confidence` | meta_engine.ts | ? | Confidence updates |
| `integration:context` | wave0_integration.ts | ? | Context assembly |
| `integration:outcome` | wave0_integration.ts | ? | Task outcomes |

**Verification**:

```bash
# Find all event emissions
grep -rn "emit\|\.emit(" src/LiBrainian/ --include="*.ts"

# Find all event listeners
grep -rn "on\|subscribe\|addEventListener" src/LiBrainian/ --include="*.ts"

# Check if activity feed captures events
grep -r "LibrarianEvent" src/orchestrator/
```

---

## Phase 3: Gap Analysis (G1-G25)

### 3.1 Phase 9 Gaps (G1-G12): Core Capabilities

| Gap | Claimed Status | Verification Method | Real Status |
|-----|----------------|---------------------|-------------|
| **G1: HTN Planner** | Done | Check `src/planning/htn_planner.ts` exists and integrates | ? |
| **G2: Episodic Memory** | Done | Check `src/memory/episodic_memory.ts` and SQLite tables | ? |
| **G3: Bench Harness** | Done | Check `scripts/bench/` and scoreboard | ? |
| **G4: Confidence Calibration** | Done | Check `confidence_calibration.ts` and tests | ? |
| **G5-G12: Advanced** | Pending | Document says pending - verify nothing partial | ? |

### 3.2 Phase 10 Gaps (G13-G25): World-Class Knowledge

| Gap | Claimed Status | Table/Feature | Verification |
|-----|----------------|---------------|--------------|
| **G13: Query Implementations** | 85% Done | Architecture + impact queries | Do queries return graph data? |
| **G14: Graph Persistence** | Module-level done | `librarian_graph_edges` | Are edges populated? Edge types? |
| **G15: Test Mapping** | Implemented | `librarian_test_mappings` | Are tests linked to code? |
| **G16: Incremental Indexing** | Implemented | File checksums | Does partial reindex work? |
| **G17: Commit Indexer** | Implemented | `librarian_commits` | Semantic summaries present? |
| **G18: Ownership Matrix** | Implemented | `librarian_ownership` | Is git blame integrated? |
| **G19: ADR System** | Implemented | `librarian_adrs` | Are ADRs indexed? |
| **G20: Refactoring Context** | Mostly done | `refactoring_advisor.ts` | Does blast radius work? |
| **G21: Failure Attribution** | Implemented | SBFL in causal_attribution.ts | Does confidence drop on failure? |
| **G22: Task Batching** | Implemented | Scheduler clustering | Are related tasks grouped? |
| **G23: Expertise Matching** | Implemented | Agent registry | Are agents matched to tasks? |
| **G24: Query Cache** | Implemented | `librarian_query_cache` | Is cache being hit? |
| **G25: Batch Embeddings** | Implemented | `embeddings.ts` | Are embeddings batched? |

### 3.3 Remaining Work (R0-R10)

All items marked "Complete" in REMAINING_WORK.md. Verify each:

| Task | Claimed Status | Verification |
|------|----------------|--------------|
| **R0: Provider Auth** | Complete | Run: `npm test -- src/LiBrainian`, expect 0 skipped |
| **R1: Batch Embedding Concurrency** | Complete | Check `generateEmbeddingsBatch()` exists with retry logic |
| **R2: Engine-Query Wiring** | Complete | Check `query()` returns `engines` object |
| **R3: Persistent Query Cache** | Complete | Check `librarian_query_cache` table has data |
| **R4: Cyclomatic Complexity** | Complete | Check `calculateCyclomaticComplexity()` uses ts-morph |
| **R5: Agentic Engine Tests** | Complete | Check `engine_feedback.test.ts` exists with 4 tests |
| **R6: Hierarchical Memory** | Complete | Check `hierarchical_memory.ts` with L1/L2/L3 |
| **R7: Multi-Language AST** | Complete | Check `parser_registry.ts` for Python/Go/Rust |
| **R8: Event Bus Integration** | Complete | Check engines emit events |
| **R9: Fine-Grained Call Edges** | Optional | Skip unless needed |
| **R10: Coverage-Based Test Mapping** | Optional | Skip unless needed |

---

## Phase 4: Critical Path Verification

### 4.1 Bootstrap Verification

Run bootstrap and verify ALL 5 phases complete:

```bash
# Run bootstrap
node scripts/bootstrap_librarian.ts --workspace . --verbose

# Expected phases:
# Phase 1: Schema initialization
# Phase 2: File discovery and AST parsing
# Phase 3: Embedding generation
# Phase 4: Graph construction
# Phase 5: Index optimization

# Verify completion
sqlite3 .LiBrainian/LiBrainian.db "SELECT * FROM librarian_bootstrap_history ORDER BY completed_at DESC LIMIT 1"
```

### 4.2 Query Path Verification

Trace a query from API to response:

```typescript
// Test query
const response = await LiBrainian.query({
  intent: 'How does authentication work?',
  depth: 'L1',
  affectedFiles: ['src/auth/'],
  includeEngines: true,
});

// Verify response structure
console.log({
  hasPacks: response.packs.length > 0,
  hasRelevance: response.engines?.relevance !== undefined,
  hasConstraints: response.engines?.constraints !== undefined,
  hasMeta: response.engines?.meta !== undefined,
  confidence: response.confidence,
  blindSpots: response.engines?.relevance?.blindSpots,
});
```

### 4.3 Confidence Update Path

Verify confidence updates on task outcomes:

```typescript
// Get initial confidence
const before = await LiBrainian.storage.getEntityConfidence('src/auth/login.ts');

// Record a failure outcome
await recordTaskOutcome('task-123', {
  success: false,
  errorType: 'runtime',
  affectedFiles: ['src/auth/login.ts'],
  packsUsed: ['pack-abc'],
});

// Get updated confidence
const after = await LiBrainian.storage.getEntityConfidence('src/auth/login.ts');

// Verify confidence decreased
assert(after.confidence < before.confidence, 'Confidence should decrease on failure');
```

### 4.4 Defeater System Verification

Verify defeaters actually filter stale knowledge:

```typescript
// Create a defeater scenario
const context = {
  entityId: 'src/old-module.ts',
  lastIndexed: new Date('2024-01-01'),
  currentDate: new Date(),
  recentCommits: ['abc123', 'def456'],
};

// Check defeaters
const result = await checkDefeaters(context);

// Verify staleness detection
assert(result.triggered.some(d => d.type === 'staleness'),
  'Should trigger staleness defeater for old index');
```

---

## Phase 5: Dead Code Analysis

### 5.1 Export Analysis

For every export in `src/LiBrainian/index.ts`, find callers:

```bash
# Create caller report
for export in $(grep "^export " src/LiBrainian/index.ts | sed 's/.*{\([^}]*\)}.*/\1/' | tr ',' '\n'); do
  count=$(grep -r "$export" src/ --include="*.ts" | grep -v "index.ts" | grep -v "\.test\.ts" | wc -l)
  echo "$export: $count production callers"
done
```

### 5.2 Module Island Detection

Find modules with no integration:

```bash
# Find files with no imports from outside their directory
for file in src/LiBrainian/**/*.ts; do
  dir=$(dirname $file)
  importers=$(grep -r "$(basename $file .ts)" src/ --include="*.ts" | grep -v "$dir" | wc -l)
  if [ $importers -eq 0 ]; then
    echo "ISLAND: $file"
  fi
done
```

### 5.3 Recommendation Matrix

For dead code, recommend action:

| Export | Callers | Recommendation | Reason |
|--------|---------|----------------|--------|
| (fill in) | 0 | WIRE / DELETE / DEFER | (reason) |

---

## Phase 6: Produce Comprehensive Audit Report

### 6.1 Executive Summary Template

```markdown
## Executive Summary

### Overall Assessment
- [ ] LiBrainian achieves its VISION.md promises: YES / PARTIAL / NO
- [ ] Architecture is implemented as documented: YES / PARTIAL / NO
- [ ] Wave0 integration is functional: YES / PARTIAL / NO
- [ ] Engine toolkit is operational: YES / PARTIAL / NO

### Critical Gaps (Blocking)
1. (list issues that prevent basic functionality)

### Major Gaps (Significant Impact)
1. (list issues that reduce effectiveness significantly)

### Minor Gaps (Polish)
1. (list issues that are nice-to-have fixes)

### Unexpected Findings
1. (list anything surprising, good or bad)
```

### 6.2 Feature Matrix Template

| Feature (from VISION.md) | Documented Status | Real Status | Evidence | Gap ID | Notes |
|--------------------------|-------------------|-------------|----------|--------|-------|
| Semantic code understanding | Claimed | ? | | G13 | |
| Context pack generation | Claimed | ? | | | |
| Confidence-based ranking | Claimed | ? | | G4 | |
| Defeater-based staleness | Claimed | ? | | | |
| Agent context enrichment | Claimed | ? | | | |
| Relevance Engine | Complete | ? | | R2 | |
| Constraint Engine | Complete | ? | | R2 | |
| Meta-Knowledge Engine | Complete | ? | | R2 | |
| Hierarchical memory (L1/L2/L3) | Complete | ? | | R6 | |
| Multi-language AST | Complete | ? | | R7 | |
| Batch embeddings | Complete | ? | | R1, G25 | |
| Query cache | Complete | ? | | R3, G24 | |
| Incremental indexing | Implemented | ? | | G16 | |
| Test-code mapping | Implemented | ? | | G15 | |
| Git history indexing | Implemented | ? | | G17 | |
| Ownership matrix | Implemented | ? | | G18 | |
| ADR system | Implemented | ? | | G19 | |
| Failure attribution | Implemented | ? | | G21 | |
| Task batching | Implemented | ? | | G22 | |
| Expertise matching | Implemented | ? | | G23 | |
| Persona views | Exported | ? | | | |
| Mermaid diagrams | Exported | ? | | | |
| ASCII diagrams | Exported | ? | | | |
| Refactoring recommendations | Exported | ? | | | |
| Architecture analysis | Exported | ? | | | |
| Debug tracing | Exported | ? | | G10 | |
| Event bus observability | Wired | ? | | R8 | |

### 6.3 Integration Gap Analysis Template

For each integration point:

```markdown
#### Integration Point: [NAME]

**Expected Flow**:
- Trigger: [when should it be called]
- Data In: [what data flows in]
- Data Out: [what data flows out]
- Consumer: [who uses the output]

**Actual Flow**:
- Trigger: [when is it actually called, or NOT called]
- Data In: [what actually flows in]
- Data Out: [what actually comes out]
- Consumer: [who actually uses it]

**Gap Analysis**:
- Missing: [what's not implemented]
- Broken: [what's implemented but doesn't work]
- Unused: [what's implemented but not called]

**Recommendation**: [WIRE / FIX / DELETE / DEFER]
```

### 6.4 Database Reality Report Template

```markdown
## Database Reality Report

### Tables with Data
| Table | Row Count | Sample Data | Assessment |
|-------|-----------|-------------|------------|
| (fill in) | | | |

### Tables Without Data (Possible Gaps)
| Table | Expected Data | Why Empty | Impact |
|-------|---------------|-----------|--------|
| (fill in) | | | |

### Missing Tables (vs Schema Spec)
| Expected Table | Purpose | Impact |
|----------------|---------|--------|
| (fill in) | | |
```

### 6.5 Prioritized Recommendations Template

```markdown
## Recommendations

### P0: Critical (System doesn't work without)
1. [Issue]: [Impact] - [Fix]

### P1: High (Major functionality gaps)
1. [Issue]: [Impact] - [Fix]

### P2: Medium (Integration improvements)
1. [Issue]: [Impact] - [Fix]

### P3: Low (Polish and cleanup)
1. [Issue]: [Impact] - [Fix]

### Dead Code Actions
| Export | Action | Reason |
|--------|--------|--------|
| (fill in) | WIRE / DELETE / DEFER | |
```

---

## Audit Constraints & Guidelines

### Be Brutally Honest
- Praise what works with evidence
- Criticize what doesn't with evidence
- Distinguish between "not implemented" vs "implemented but not wired" vs "wired but broken"

### Provide Evidence
- File paths with line numbers: `src/LiBrainian/api/query.ts:42`
- Database query results
- Test output
- grep/find command results

### Focus on Production Paths
- Ignore test-only code unless relevant to test coverage
- Trace actual execution paths, not theoretical ones
- Check git blame for code that might be abandoned

### Verify "Complete" Claims
- Every item marked "Complete" in docs needs verification
- Run the verification commands specified in REMAINING_WORK.md
- Check if tests actually pass

### Check Auth Wiring First
- Per REMAINING_WORK.md, auth wiring is the prerequisite
- Run `npm test -- src/LiBrainian` and count skipped tests
- If >0 skipped, auth wiring is still broken

---

## Appendix A: Quick Diagnostic Commands

```bash
# A1. Check LiBrainian directory exists and has content
ls -la .LiBrainian/
du -sh .LiBrainian/

# A2. Check database schema
sqlite3 .LiBrainian/LiBrainian.db ".schema" | head -100

# A3. Check database stats
sqlite3 .LiBrainian/LiBrainian.db "SELECT name, (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=m.name) FROM sqlite_master m WHERE type='table' AND name LIKE 'librarian_%'"

# A4. Run LiBrainian tests
npm test -- src/LiBrainian --reporter=verbose 2>&1 | tail -50

# A5. Check for skipped tests
npm test -- src/LiBrainian 2>&1 | grep -E "skip|SKIP"

# A6. Check exports have callers
grep -r "from.*LiBrainian" src/ --include="*.ts" | grep -v test | wc -l

# A7. Check engine files exist and have content
wc -l src/LiBrainian/engines/*.ts

# A8. Check event listeners
grep -rn "globalEventBus\|onLibrarianEvent" src/ --include="*.ts"

# A9. Check Wave0 integration calls
grep -rn "enrichTaskContext\|recordTaskOutcome\|preOrchestrationHook" src/ --include="*.ts" | grep -v LiBrainian/

# A10. Check model usage
grep -r "claude-opus-4-5\|claude-sonnet-4-5" src/LiBrainian/ --include="*.ts"
```

---

## Appendix B: Key File Locations

| Component | Primary File | Secondary Files |
|-----------|--------------|-----------------|
| **Public API** | `src/LiBrainian/index.ts` | |
| **Core LiBrainian** | `src/LiBrainian/api/LiBrainian.ts` | `api/query.ts`, `api/bootstrap.ts` |
| **Storage** | `src/LiBrainian/storage/sqlite_storage.ts` | `storage/types.ts` |
| **Engines** | `src/LiBrainian/engines/index.ts` | `relevance_engine.ts`, `constraint_engine.ts`, `meta_engine.ts` |
| **Integration** | `src/LiBrainian/integration/wave0_integration.ts` | `first_run_gate.ts`, `file_watcher.ts` |
| **Events** | `src/LiBrainian/events.ts` | |
| **Knowledge** | `src/LiBrainian/knowledge/index.ts` | `architecture.ts`, `impact.ts`, `confidence_updater.ts` |
| **Indexers** | `src/LiBrainian/ingest/framework.ts` | All `*_indexer.ts` files |
| **Memory** | `src/LiBrainian/memory/hierarchical_memory.ts` | |
| **Debug** | `src/LiBrainian/debug/tracer.ts` | `inspector.ts` |
| **Views** | `src/LiBrainian/views/persona_views.ts` | |
| **Visualization** | `src/LiBrainian/visualization/mermaid_generator.ts` | `ascii_diagrams.ts` |
| **Recommendations** | `src/LiBrainian/recommendations/refactoring_advisor.ts` | `architecture_advisor.ts` |
| **CLI** | `src/LiBrainian/cli/` | All CLI command files |

---

## Appendix C: Test File Mapping

| Component | Test File | Test Count | Status |
|-----------|-----------|------------|--------|
| LiBrainian Core | `__tests__/LiBrainian.test.ts` | ? | ? |
| MVP LiBrainian | `__tests__/mvp_librarian.test.ts` | ? | ? |
| Embedding Pipeline | `__tests__/embedding_pipeline.test.ts` | ? | ? |
| Graph Metrics | `__tests__/graph_metrics.test.ts` | ? | ? |
| Ingestion Framework | `__tests__/ingestion_framework.test.ts` | ? | ? |
| Provider Gate | `__tests__/provider_gate.test.ts` | ? | ? |
| Confidence Calibration | `__tests__/confidence_calibration.test.ts` | ? | ? |
| Call Edge Extractor | `__tests__/call_edge_extractor.test.ts` | ? | ? |
| Agentic Qualification | `__tests__/agentic/qualification.test.ts` | ? | ? |
| Engine Feedback | `__tests__/agentic/engine_feedback.test.ts` | 4 | ? |
| G23-G25 Gaps | `__tests__/g23_g25_gaps.test.ts` | ? | ? |

---

**Document Status**: Comprehensive audit prompt ready for execution. This prompt should enable a thorough evaluation of whether the LiBrainian Universal Knowledge Layer matches its documented vision and specifications.

---

> **AGENT INSTRUCTION**: Execute this audit systematically. Do not skip phases. Provide evidence for every claim. Be honest about what works and what doesn't.
