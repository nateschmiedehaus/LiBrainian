# Legacy Research Notice
This file is archived. Canonical guidance lives in `docs/LiBrainian/README.md`.
Extract useful research into canonical docs; do not extend this file.

# LiBrainian World-Class Knowledge Gaps

> **FOR AGENTS**: Deep dive into G13-G25. For implementation specs, see [implementation-requirements.md](./implementation-requirements.md).
> **Navigation**: [README.md](./README.md) | [overview.md](./overview.md) | [implementation-requirements.md](./implementation-requirements.md)

**Focus**: Real-world usage scenarios, integration points, and testing strategies.
Each gap is defined by the **process it enables**, not just the data structure.

**Status**: Prioritized by real-world impact
**Updated**: 2025-12-30

---

## Quick Reference: Gaps in This Document

| Gap | Priority | Status | Jump Link |
|-----|----------|--------|-----------|
| G13 | P0 | 85% Done | [#g13-complete-knowledge-query-implementations](#g13-complete-knowledge-query-implementations) |
| G14 | P1 | Module-level done | [#g14-callimport-graph-persistence](#g14-callimport-graph-persistence) |
| G15 | P1 | Implemented | [#g15-test-code-relationship-mapping](#g15-test-code-relationship-mapping) |
| G16 | P0 | Implemented | [#g16-incremental-indexing](#g16-incremental-indexing) |
| G17 | P2 | Implemented | [#g17-commit-indexer-git-history-semantics](#g17-commit-indexer-git-history-semantics) |
| G18 | P3 | Implemented | [#g18-ownership-matrix-blame-indexer](#g18-ownership-matrix-blame-indexer) |
| G19 | P3 | Implemented | [#g19-adr-system-architecture-decision-records](#g19-adr-system-architecture-decision-records) |
| G20 | P2 | Mostly done | [#g20-safe-refactoring-context](#g20-safe-refactoring-context) |
| G21 | P1 | Implemented | [#g21-task-failure-attribution](#g21-task-failure-attribution) |
| G22 | P2 | Implemented | [#g22-semantic-task-batching](#g22-semantic-task-batching) |
| G23 | P3 | Implemented | [#g23-expertise-matching](#g23-expertise-matching) |
| G24 | P4 | Implemented | [#g24-persistent-query-cache](#g24-persistent-query-cache) |
| G25 | P4 | Implemented | [#g25-batch-embedding-generation](#g25-batch-embedding-generation) |

---

## How Knowledge Flows Through Wave0

Before understanding gaps, understand the current integration:

```
┌─────────────────────────────────────────────────────────────────┐
│                     ORCHESTRATION FLOW                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. preOrchestrationHook()                                      │
│     └── ensureLibrarianReady() → bootstrap if first run         │
│     └── ensureTemporalGraph() → build co-change edges           │
│                                                                 │
│  2. chooseNextTask() [scheduler.ts]                             │
│     └── LiBrainian.query(intent) → get related files             │
│     └── scoreSemantic() → Jaccard similarity on file overlap    │
│     └── DECISION: which task to run next                        │
│                                                                 │
│  3. enrichTaskContext() [wave0_integration.ts]                  │
│     └── LiBrainian.query(intent, affectedFiles)                  │
│     └── RETURNS: summary, keyFacts, snippets, relatedFiles      │
│     └── INJECTED INTO: agent prompt as context                  │
│                                                                 │
│  4. TASK EXECUTION (agent runs)                                 │
│                                                                 │
│  5. recordTaskOutcome() [wave0_integration.ts]                  │
│     └── storage.recordContextPackAccess(packId, outcome)        │
│     └── storage.updateConfidence(entityId, delta)               │
│     └── LiBrainian.reindexFiles(filesModified)                   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Current Gaps**: The flow exists, but the knowledge is shallow.

---

## Part 1: Incomplete Implementations (Code Exists, Not Working)

### G13: Complete Knowledge Query Implementations

**Real Process**: When an agent asks "what do I need to know about this function?", the LiBrainian should provide architecture context, not just file contents.

**Current State**: Implemented. Architecture + impact queries return dependency graphs, cycles, blast radius, and fitness context.

**Integration Point**: `enrichTaskContext()` → `LiBrainian.query()` → knowledge modules

**How to Test**:
```bash
# Create a circular dependency in test fixture
# Query LiBrainian for blast radius
# Verify it returns ALL affected files, not just direct imports
node -e "
  const lib = require('./src/LiBrainian');
  const ctx = await lib.enrichTaskContext('.', { intent: 'refactor auth module' });
  assert(ctx.relatedFiles.length > 0, 'Should find related files');
  assert(ctx.keyFacts.some(f => f.includes('dependency')), 'Should mention deps');
"
```

**Why This Matters**: Agents currently make blind changes without knowing what they'll break.

---

### G14: Call/Import Graph Persistence

**Real Process**: Scheduler needs to know "these 3 tasks all touch the same module" to batch them together.

**Current State**: Implemented. Call/import edges persist in SQLite and are used for query expansion and scheduler signals.

**Where It's Used**:
- `scheduler.ts:scoreSemantic()` - currently uses file list overlap
- `wave0_integration.ts:enrichTaskContext()` - returns relatedFiles

**Integration Point**: `sqlite_storage.ts` needs:
```sql
CREATE TABLE call_edges (
  caller_id TEXT NOT NULL,
  callee_id TEXT NOT NULL,
  edge_type TEXT NOT NULL,  -- 'imports' | 'calls' | 'extends'
  confidence REAL DEFAULT 1.0,
  PRIMARY KEY (caller_id, callee_id, edge_type)
);
```

**How to Test**:
```bash
# Index a codebase
# Verify edge count > 0
# Query for function X's callers
# Verify correct callers returned
sqlite3 .LiBrainian/LiBrainian.db "SELECT COUNT(*) FROM call_edges"
```

**Why This Matters**: Without persistent graphs, every query recomputes from scratch (slow) or returns incomplete data.

---

### G15: Test-Code Relationship Mapping

**Real Process**: When `src/auth/login.ts` changes, know that `test/auth/login.test.ts` must run.

**Current State**: Implemented. Test ingestion persists mappings in SQLite; context assembly now surfaces `testMapping`.

**Where It's Used**:
- Quality gates need to know "did tests for modified code pass?"
- Agents need to know "this file has no tests" before modifying

**Integration Point**: `context_assembly.ts` should populate:
```typescript
testMapping: [
  { source: 'src/auth/login.ts', tests: ['test/auth/login.test.ts'] },
  { source: 'src/auth/session.ts', tests: [] } // No tests!
]
```

**How to Test**:
```bash
# Index codebase
# Query context for src/auth/login.ts
# Verify testMapping includes correct test file
# Query for file with no tests
# Verify testMapping shows empty array with warning
```

**Why This Matters**: Agents currently don't know if they're modifying untested code.

---

### G16: Incremental Indexing

**Real Process**: When one file changes, reindex just that file, not the entire codebase.

**Current State**: Implemented. Incremental reindex uses file checksums, dependency invalidation, and debounced file watcher triggers.

**Where It's Used**:
- `recordTaskOutcome()` calls `reindexFiles(filesModified)`
- `notifyFileChange()` calls `reindexFiles([filePath])`

**Integration Point**: `ingest/` indexers need:
1. File hash tracking (only reindex if content changed)
2. Dependency invalidation (if A imports B and B changes, A's cached analysis is stale)
3. Embedding delta updates (don't regenerate all embeddings)

**How to Test**:
```bash
# Full index: 100 files, measure time T1
# Change 1 file
# Incremental index, measure time T2
# Assert T2 << T1 (should be ~100x faster)
time node scripts/bootstrap_librarian.mjs --workspace .
echo "// comment" >> src/auth/login.ts
time node scripts/bootstrap_librarian.mjs --workspace . --incremental
```

**Why This Matters**: 1000-file codebase takes 30+ seconds to reindex. Unacceptable for real-time feedback.

---

## Part 2: Missing Subsystems (Referenced But Not Built)

### G17: Commit Indexer (Git History Semantics)

**Real Process**: Answer "who changed this recently and why?"

**Current State**: Implemented. Commit ingestion indexes git history with semantic summaries and exposes recent changes in context.

**Where It Would Integrate**:
- `enrichTaskContext()` → `recentChanges` field (currently never populated)
- `recordTaskOutcome()` → attribute failures to recent commits

**What It Would Index**:
```typescript
// For each commit touching indexed files:
{
  commitHash: string,
  author: string,
  timestamp: string,
  message: string,
  filesChanged: string[],
  semanticSummary: string,  // LLM-generated: "Added error handling to auth"
  riskScore: number,        // Based on file importance, size of change
}
```

**How to Test**:
```bash
# Index git history
# Query for file X
# Verify recentChanges includes last 5 commits touching X
# Verify semanticSummary is meaningful, not just commit message
git log --oneline -5 -- src/auth/login.ts
node -e "const ctx = await lib.query({file: 'src/auth/login.ts'}); console.log(ctx.recentChanges)"
```

**Why This Matters**: Agents don't know "this code was just refactored yesterday, be careful."

---

### G18: Ownership Matrix (Blame Indexer)

**Real Process**: Answer "who is the expert on this module?"

**Current State**: Implemented. Ownership matrix derived from git history, with CODEOWNERS overlay when present.

**Where It Would Integrate**:
- `scheduler.ts` → assign tasks to agents with relevant expertise
- `enrichTaskContext()` → warn agent "this is Alice's code, follow her patterns"

**What It Would Index**:
```typescript
// For each file/module:
{
  path: string,
  primaryOwner: string,        // Most commits
  contributors: string[],      // Anyone who touched it
  lastTouchedBy: string,
  expertiseScore: Record<string, number>,  // alice: 0.8, bob: 0.2
}
```

**Integration with existing code**:
```typescript
// In scheduler.ts:scoreSemantic()
if (task.required_specialty && ownerMapping[task.affectedFile]?.expertiseScore[agentId] > 0.5) {
  specialtyBonus += 0.2;
}
```

**How to Test**:
```bash
# Index blame data
# Query for module X
# Verify primaryOwner matches git blame majority
git blame --line-porcelain src/auth/login.ts | grep "author " | sort | uniq -c | sort -rn
```

---

### G19: ADR System (Architecture Decision Records)

**Real Process**: Answer "why is it built this way?"

**Current State**: Implemented. ADR ingestion parses markdown and surfaces decision summaries in context.

**Where It Would Integrate**:
- `enrichTaskContext()` → include relevant ADRs in context
- When agent proposes architectural change → check if it contradicts existing ADR

**What It Would Index**:
```markdown
# In docs/adr/001-use-sqlite.md
Status: accepted
Context: Need local storage for LiBrainian index
Decision: Use SQLite over PostgreSQL
Consequences: No multi-user support, but simpler deployment
Related files: src/LiBrainian/storage/sqlite_storage.ts
```

**How to Test**:
```bash
# Create ADR in docs/adr/
# Index ADRs
# Query for sqlite_storage.ts
# Verify ADR appears in context
```

**Why This Matters**: Agents propose changes that violate architectural decisions because they don't know they exist.

---

## Part 3: Knowledge Gaps for Real Scenarios

### G20: Safe Refactoring Context

**Real Scenario**: Agent is asked to "refactor the auth module."

**What Agent Needs to Know** (currently missing):
1. What are all the entry points? (public API surface)
2. What are the side effects? (database calls, external APIs)
3. What tests cover this code? (test gaps)
4. What would break if I change the signature? (consumers)
5. Is there an ADR explaining why it's structured this way?

**Integration Point**: New query type in `LiBrainian.query()`:
```typescript
const ctx = await LiBrainian.query({
  intent: 'refactor auth module',
  queryType: 'refactoring_safety',
  targetFiles: ['src/auth/'],
});

// Returns:
{
  publicAPI: ['login()', 'logout()', 'getSession()'],
  sideEffects: ['writes to sessions table', 'calls OAuth provider'],
  testCoverage: { covered: 80, uncovered: ['errorHandler()'] },
  consumers: ['src/api/routes.ts', 'src/middleware/auth.ts'],
  relatedADRs: ['docs/adr/003-session-management.md'],
  riskScore: 0.7,  // High - many consumers, some untested
}
```

**How to Test**:
```bash
# Query refactoring safety for auth module
# Verify all fields populated
# Manually verify against codebase that data is correct
```

---

### G21: Task Failure Attribution

**Real Scenario**: Task fails. Why? Was it bad context? Bad agent? Bad prompt?

**Current State**: Implemented. SBFL attribution ranks suspicious packs and feeds confidence updates.

**What Should Happen**:
1. Task fails with error message
2. LiBrainian analyzes: which context packs were used?
3. Compare failed task to successful similar tasks
4. Attribute: "Tasks using PackID X fail 70% of the time"
5. Update confidence scores for implicated entities

**Integration Point**: `recordTaskOutcome()` already calls `attributeFailure()`, but it returns hardcoded guesses.

**Real Implementation**:
```typescript
function attributeFailure(outcome: TaskOutcomeSummary, context: AgentKnowledgeContext): Attribution {
  // Query historical outcomes for same packIds
  const packHistory = await storage.getPackOutcomes(context.packIds);
  const packFailureRates = packHistory.map(p => ({
    packId: p.packId,
    failureRate: p.failures / (p.successes + p.failures),
  }));

  // Find packs with unusually high failure rate
  const problematicPacks = packFailureRates.filter(p => p.failureRate > 0.5);

  return {
    knowledgeCaused: problematicPacks.length > 0,
    impliedPacks: problematicPacks.map(p => p.packId),
    confidence: problematicPacks.length > 0 ? 0.8 : 0.3,
    recommendation: problematicPacks.length > 0
      ? `Reindex: ${problematicPacks[0].packId}`
      : 'Unknown cause',
  };
}
```

**How to Test**:
```bash
# Run 10 tasks with same context pack
# 8 fail, 2 succeed
# Verify pack confidence drops
# Verify attribution points to problematic pack
```

---

### G22: Semantic Task Batching

**Real Scenario**: 5 tasks ready, 3 touch `auth/`, 2 touch `api/`. Run auth tasks together.

**Current State**: Implemented. Scheduler batches tasks using semantic embeddings and k-means clustering.

**What Should Happen**:
1. Compute task clusters based on file overlap
2. Run all tasks in a cluster together (agent keeps context warm)
3. Track cluster success rate vs individual task execution

**Integration Point**: `chooseNextTask()` returns single task. Need `chooseNextTaskBatch()`:
```typescript
export async function chooseNextTaskBatch(
  snapshot: WorkGraphSnapshotV1,
  options: ScheduleOptions & { maxBatchSize?: number }
): Promise<{ tasks: WorkGraphTaskV1[]; reason: string }> {
  // Cluster ready tasks by file overlap
  // Return cluster with highest avg confidence
}
```

**How to Test**:
```bash
# Create workgraph with 5 tasks: 3 touch auth/, 2 touch api/
# Call chooseNextTaskBatch()
# Verify returns 3 auth tasks together
```

---

### G23: Expertise Matching

**Real Scenario**: Task requires "TypeScript AST manipulation expertise."

**Current State**: Implemented. Agent registry + expertise matching route tasks to specialized agents.

**Where It Would Integrate**:
- Agent registry (who has what skills)
- `scheduler.ts` → match `required_specialty` to agent capabilities
- `expertise_matcher.ts` exists but needs LiBrainian integration

**What Should Happen**:
```typescript
// In scheduler:
const agents = await agentRegistry.getAvailableAgents();
const taskExpertise = await LiBrainian.inferExpertise(task.intent, task.affectedFiles);
const matchedAgent = agents.find(a =>
  a.capabilities.some(c => taskExpertise.required.includes(c))
);
```

**How to Test**:
```bash
# Task: "Modify AST parsing logic"
# Agent A: [typescript, ast]
# Agent B: [python, api]
# Verify task assigned to Agent A
```

---

## Part 4: Performance & Scalability Gaps

### G24: Persistent Query Cache

**Real Scenario**: Same query runs 10 times in 5 minutes. Should hit cache.

**Current State**: Implemented. Persistent SQLite cache with TTL and LRU pruning.

**What Should Happen**:
- SQLite table for query cache
- Invalidation on file change (not just TTL)
- Warm cache on startup for common queries

**Integration Point**: `sqlite_storage.ts`:
```sql
CREATE TABLE query_cache (
  query_hash TEXT PRIMARY KEY,
  query_params TEXT,
  response TEXT,
  created_at TEXT,
  last_accessed TEXT,
  access_count INTEGER DEFAULT 1,
  invalidated_by TEXT  -- file path that caused invalidation
);
```

---

### G25: Batch Embedding Generation

**Real Scenario**: Indexing 500 new files. Generate embeddings in batches, not one-by-one.

**Current State**: Implemented. Embedding service batches requests with concurrency limits and retries.

**What Should Happen**:
- Batch 50 files per embedding call
- Parallel batches with rate limiting
- Progress reporting

**Integration Point**: `embedding_service.ts`:
```typescript
async function generateEmbeddingsBatch(
  texts: string[],
  options: { batchSize?: number; concurrency?: number }
): Promise<Float32Array[]> {
  // Split into batches
  // Run batches in parallel
  // Return in same order as input
}
```

---

## Part 5: Prioritized by Real-World Impact

| Priority | Gap | Real-World Impact | Blocks |
|----------|-----|-------------------|--------|
| **P0** | G16: Incremental indexing | 30s → 0.5s index time | Everything |
| **P0** | G13: Query implementations | Agents get useful context | Task success |
| **P1** | G14: Graph persistence | Scheduler makes smart choices | Task batching |
| **P1** | G15: Test mapping | Know what's untested | Quality gates |
| **P1** | G21: Failure attribution | Learn from mistakes | Confidence system |
| **P2** | G17: Commit indexer | Know recent changes | Risk assessment |
| **P2** | G20: Refactoring context | Safe code changes | Large refactors |
| **P2** | G22: Task batching | Efficient execution | Throughput |
| **P3** | G18: Ownership matrix | Expert assignment | Team features |
| **P3** | G19: ADR system | Architectural knowledge | Decision tracking |
| **P3** | G23: Expertise matching | Right agent for task | Agent teams |
| **P4** | G24: Persistent cache | Fast queries | Performance |
| **P4** | G25: Batch embeddings | Fast indexing | Bootstrap time |

---

## Testing Strategy

Each gap should have:

1. **Unit test**: Function returns correct data
2. **Integration test**: Data flows through to agent context
3. **End-to-end test**: Agent makes better decision with knowledge

Example for G15 (Test Mapping):
```bash
# Unit: testMapping returns correct mappings
npm test -- src/LiBrainian/__tests__/test_mapping.test.ts

# Integration: enrichTaskContext includes testMapping
npm test -- src/LiBrainian/__tests__/context_assembly.test.ts

# E2E: Agent warned about untested code
node scripts/probe_dogfood_runner.mjs --scenario untested_code_warning
```

---

**This document should be updated as gaps are addressed.**
