# Legacy Research Notice
This file is archived. Canonical guidance lives in `docs/LiBrainian/README.md`.
Extract useful research into canonical docs; do not extend this file.

# LiBrainian: Remaining Work

> **FOR AGENTS**: This document contains ALL remaining implementation tasks. Each task is self-contained with clear instructions, file locations, and verification steps.
>
> **Last Updated**: 2025-12-30
> **Overall Status**: ~85% complete

---

## ⛔⛔⛔ MANDATORY FIRST TASK ⛔⛔⛔

**DO NOT SKIP THIS. DO NOT WORK ON ANYTHING ELSE FIRST.**

```
┌─────────────────────────────────────────────────────────────────────────┐
│  TASK R0: PORT AUTH WIRING FROM WAVE0/CLAUDE/CODEX TO LiBrainian        │
│                                                                         │
│  Problem: 15 tests skip because LiBrainian doesn't use wave0's auth     │
│  Reality: Claude and Codex ARE authenticated on this system            │
│  Fix: Make LiBrainian use the same auth infrastructure as wave0         │
│                                                                         │
│  Jump to task: #r0-fix-provider-auth-wiring                            │
│  Effort: Small (1-2 hours)                                             │
│  Outcome: All 109 LiBrainian tests pass (currently 94 pass, 15 skip)    │
└─────────────────────────────────────────────────────────────────────────┘
```

**Why this blocks everything else:**
- Embedding tests can't verify real embeddings work
- Bootstrap tests can't verify real indexing works
- Integration tests can't verify real provider behavior
- We can't know if LiBrainian actually works until auth is fixed

---

## How to Use This Document

1. **Pick a task** from the priority list below
2. **Read the "Before You Start"** section for that task
3. **Follow the implementation steps** exactly
4. **Run the verification commands** to confirm completion
5. **Mark the task complete** in this document

---

## Priority Task List

### P0: Critical — Must Complete for Production

| ID | Task | Effort | Status |
|----|------|--------|--------|
| [R0](#r0-fix-provider-auth-wiring) | **FIX: Wire LiBrainian to wave0 auth** | Small | ✅ Complete |
| [R1](#r1-batch-embedding-concurrency) | Batch embedding concurrency | Medium | ✅ Complete |
| [R2](#r2-wire-engines-to-query-api) | Wire engine toolkit to main query API | Small | ✅ Complete |

### P1: High Priority — Significant Impact

| ID | Task | Effort | Status |
|----|------|--------|--------|
| [R3](#r3-persistent-query-cache) | Persistent query cache with TTL | Small | ✅ Complete |
| [R4](#r4-cyclomatic-complexity-metric) | Add cyclomatic complexity metric | Small | ✅ Complete |
| [R5](#r5-agentic-test-coverage) | Write 4 remaining agentic engine tests | Medium | ✅ Complete |

### P2: Medium Priority — Quality Improvements

| ID | Task | Effort | Status |
|----|------|--------|--------|
| [R6](#r6-hierarchical-memory) | Hierarchical memory (L1/L2/L3 cache) | Large | ✅ Complete |
| [R7](#r7-multi-language-ast) | Expand AST parsing beyond TypeScript | Large | ✅ Complete |
| [R8](#r8-event-bus-integration) | Wire lifecycle triggers to event bus | Medium | ✅ Complete |

### P3: Nice to Have — Future Optimization

| ID | Task | Effort | Status |
|----|------|--------|--------|
| [R9](#r9-fine-grained-call-edges) | Function-level call graph edges | Large | ❌ Optional |
| [R10](#r10-coverage-based-test-mapping) | Istanbul coverage-based test mapping | Medium | ❌ Optional |

---

## Task Details

### R0: Fix Provider Auth Wiring

**Priority**: P0 BLOCKING
**Effort**: Small (1-2 hours)
**Status**: ✅ Complete (provider gate now uses Wave0 CLI auth checks)

#### Problem

Claude and Codex ARE authenticated on the system (`claude auth status` shows authenticated, `codex` CLI works). LiBrainian now uses the same auth infrastructure as Wave0 (AuthChecker + LLMService health checks), so provider readiness reflects CLI auth state.
- Wave0's provider infrastructure (`src/soma/providers/llm_service.ts`)
- Claude Code's auth (`~/.claude/`)
- Codex's auth (`~/.codex/`)

Previously the tests incorrectly reported "no providers configured" or "provider unavailable" when providers ARE available. The provider gate now delegates to `AuthChecker` + `LLMService` (CLI-only auth), and readiness uses that result.

#### Before You Start
```bash
# Verify Claude is authenticated
claude auth status

# Verify Codex is authenticated (if using)
codex auth status

# Check how wave0 providers work
grep -r "checkClaudeHealth\|checkCodexHealth" src/soma/providers/

# Check how LiBrainian's provider gate works
cat src/LiBrainian/api/provider_gate.ts

# Check how LiBrainian's provider_check works
cat src/LiBrainian/api/provider_check.ts
```

#### Investigation Steps

1. **Find the disconnect**:
```bash
# What does LiBrainian's provider check do?
grep -A 20 "checkAllProviders" src/LiBrainian/api/provider_check.ts

# What does wave0's LLM service do?
grep -A 20 "checkClaudeHealth" src/soma/providers/llm_service.ts

# Are they using the same auth sources?
diff <(grep "claude\|codex\|auth" src/LiBrainian/api/provider_check.ts) \
     <(grep "claude\|codex\|auth" src/soma/providers/llm_service.ts)
```

2. **Identify the auth source wave0 uses**:
The wave0 system successfully uses providers. Find where it gets credentials:
```bash
grep -r "ANTHROPIC_API_KEY\|CLAUDE_API_KEY\|claude auth" src/
grep -r "credential\|auth" src/utils/credential_loader.ts
```

3. **Wire LiBrainian to use same auth**:
The fix likely involves making `src/LiBrainian/api/provider_check.ts` or `provider_gate.ts` use the same credential loading as wave0.

#### Expected Fix Pattern

```typescript
// In src/LiBrainian/api/provider_check.ts or provider_gate.ts
// WRONG: LiBrainian checking its own way
const claudeAvailable = await someLibrarianSpecificCheck();

// RIGHT: Use wave0's proven provider infrastructure
import { LLMService } from '../../soma/providers/llm_service.js';
const llmService = new LLMService();
const claudeHealth = await llmService.checkClaudeHealth();
const claudeAvailable = claudeHealth.available;
```

#### Verification
```bash
# After fix, these tests should NOT skip:
npm test -- src/LiBrainian/__tests__/embedding_pipeline.test.ts
npm test -- src/LiBrainian/__tests__/mvp_librarian.test.ts
npm test -- src/LiBrainian/__tests__/LiBrainian.test.ts

# All 15 previously-skipped tests should now run
npm test -- src/LiBrainian
# Expected: 109 tests, 0 skipped (was 94 passed, 15 skipped)
```

#### Success Criteria
- [ ] `npm test -- src/LiBrainian` shows 0 skipped tests
- [ ] LiBrainian uses wave0's credential loading
- [ ] Tests actually call live providers (not mocks)
- [ ] Bootstrap works with real embeddings

---

### R1: Batch Embedding Concurrency

**Priority**: P0 Critical
**Effort**: Medium (2-4 hours)
**File**: `src/LiBrainian/api/embeddings.ts`
**Status**: ✅ Complete (concurrent batch embedding + retry/backoff)

#### Problem
Current embedding generation is sequential. For large codebases (1000+ files), bootstrap takes too long.

#### Before You Start
```bash
# Check current implementation
cat src/LiBrainian/api/embeddings.ts | head -100

# Understand the EmbeddingService interface
grep -A 20 "class EmbeddingService" src/LiBrainian/api/embeddings.ts
```

#### Implementation Steps

1. **Add batch configuration**:
```typescript
interface BatchConfig {
  batchSize: number;      // texts per API call (default: 50)
  concurrency: number;    // parallel batches (default: 3)
  retryAttempts: number;  // retries per batch (default: 2)
  retryDelayMs: number;   // backoff delay (default: 1000)
}
```

2. **Implement batched generation**:
```typescript
async generateEmbeddingsBatch(
  texts: string[],
  config: BatchConfig = { batchSize: 50, concurrency: 3, retryAttempts: 2, retryDelayMs: 1000 }
): Promise<Float32Array[]> {
  const batches = chunk(texts, config.batchSize);
  const results: Float32Array[][] = [];

  // Process batches with controlled concurrency
  for (let i = 0; i < batches.length; i += config.concurrency) {
    const concurrent = batches.slice(i, i + config.concurrency);
    const batchResults = await Promise.all(
      concurrent.map(batch => this.generateBatchWithRetry(batch, config))
    );
    results.push(...batchResults);
  }

  return results.flat();
}

private async generateBatchWithRetry(
  texts: string[],
  config: BatchConfig
): Promise<Float32Array[]> {
  for (let attempt = 0; attempt < config.retryAttempts; attempt++) {
    try {
      return await this.provider.embed(texts);
    } catch (error) {
      if (attempt === config.retryAttempts - 1) throw error;
      await delay(config.retryDelayMs * (attempt + 1));
    }
  }
  throw new Error('Unreachable');
}
```

3. **Wire into bootstrap**:
Update `src/LiBrainian/api/bootstrap.ts` to use `generateEmbeddingsBatch()` instead of sequential calls.

#### Verification
```bash
# Run embedding tests
npm test -- src/LiBrainian/__tests__/embedding_pipeline.test.ts

# Benchmark (manual)
time node -e "
  const { EmbeddingService } = require('./dist/LiBrainian/api/embeddings.js');
  const svc = new EmbeddingService({ provider: 'test' });
  // Generate 100 embeddings
"
```

#### Success Criteria
- [ ] Batch processing implemented with configurable concurrency
- [ ] Retry logic with exponential backoff
- [ ] Bootstrap time reduced by >50% for 1000+ file codebases
- [ ] Tests pass: `npm test -- embedding`

---

### R2: Wire Engines to Query API

**Priority**: P0 Critical
**Effort**: Small (1-2 hours)
**Files**: `src/LiBrainian/api/query.ts`, `src/LiBrainian/engines/index.ts`

#### Problem
The three engines (Relevance, Constraint, Meta-Knowledge) are implemented but not exposed through the main `LiBrainian.query()` API.

#### Before You Start
```bash
# Check engine implementations exist
ls -la src/LiBrainian/engines/

# Check current query API
grep -A 30 "async query" src/LiBrainian/api/query.ts
```

#### Implementation Steps

1. **Import engines in query.ts**:
```typescript
import { RelevanceEngine } from '../engines/relevance.js';
import { ConstraintEngine } from '../engines/constraint.js';
import { MetaKnowledgeEngine } from '../engines/meta.js';
```

2. **Add engine results to LibrarianResponse**:
```typescript
interface LibrarianResponse {
  // ... existing fields ...

  // NEW: Engine results
  engines?: {
    relevance?: {
      blindSpots: BlindSpot[];
      patterns: Pattern[];
    };
    constraints?: {
      applicable: Constraint[];
      violations: Violation[];
    };
    meta?: {
      confidence: ConfidenceReport;
      proceedDecision: ProceedDecision;
    };
  };
}
```

3. **Call engines during query**:
```typescript
async query(request: LibrarianQuery): Promise<LibrarianResponse> {
  // ... existing query logic ...

  // Add engine results if requested
  if (request.includeEngines !== false) {
    response.engines = {
      relevance: await this.relevanceEngine.query({
        intent: request.intent,
        budget: { maxFiles: 20, maxTokens: 50000, maxDepth: 3 },
        urgency: 'blocking'
      }),
      meta: {
        confidence: await this.metaEngine.getConfidence(response.packs.map(p => p.packId)),
        proceedDecision: await this.metaEngine.shouldProceed(affectedFiles)
      }
    };
  }

  return response;
}
```

#### Verification
```bash
# Run query tests
npm test -- src/LiBrainian/__tests__/LiBrainian.test.ts

# Manual verification
node -e "
  const { createLibrarian } = require('./dist/LiBrainian/index.js');
  const lib = await createLibrarian({ workspace: process.cwd() });
  const result = await lib.query({ intent: 'authentication', depth: 'L1' });
  console.log('Engines:', Object.keys(result.engines || {}));
"
```

#### Success Criteria
- [ ] `LiBrainian.query()` returns engine results
- [ ] Engine results include confidence, blind spots, constraints
- [ ] Tests pass: `npm test -- LiBrainian`

---

### R3: Persistent Query Cache

**Priority**: P1 High
**Effort**: Small (1-2 hours)
**File**: `src/LiBrainian/storage/sqlite_storage.ts`
**Status**: ✅ Complete (SQLite cache + TTL + L1/L2 hierarchical cache in query pipeline)

#### Problem
Repeated queries for the same intent hit the embedding service every time. Need persistent cache with TTL.

#### Before You Start
```bash
# Check if cache table exists
sqlite3 .LiBrainian/LiBrainian.sqlite ".schema" | grep -i cache

# Check existing cache methods
grep -n "cache" src/LiBrainian/storage/sqlite_storage.ts
```

#### Implementation Steps

1. **Add cache table schema** (in `initialize()` or migrations):
```sql
CREATE TABLE IF NOT EXISTS librarian_query_cache (
  query_hash TEXT PRIMARY KEY,
  query_params TEXT NOT NULL,
  response TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  access_count INTEGER DEFAULT 1,
  last_accessed TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cache_expires ON librarian_query_cache(expires_at);
```

2. **Add cache methods to SqliteLibrarianStorage**:
```typescript
async getCachedQuery(queryHash: string): Promise<QueryCacheEntry | null> {
  const db = this.ensureDb();
  const row = db.prepare(
    'SELECT * FROM librarian_query_cache WHERE query_hash = ? AND expires_at > ?'
  ).get(queryHash, new Date().toISOString());

  if (row) {
    // Update access stats
    db.prepare(
      'UPDATE librarian_query_cache SET access_count = access_count + 1, last_accessed = ? WHERE query_hash = ?'
    ).run(new Date().toISOString(), queryHash);
    return rowToCacheEntry(row);
  }
  return null;
}

async setCachedQuery(entry: QueryCacheEntry): Promise<void> {
  const db = this.ensureDb();
  db.prepare(`
    INSERT OR REPLACE INTO librarian_query_cache
    (query_hash, query_params, response, created_at, expires_at, access_count, last_accessed)
    VALUES (?, ?, ?, ?, ?, 1, ?)
  `).run(
    entry.queryHash,
    JSON.stringify(entry.queryParams),
    JSON.stringify(entry.response),
    new Date().toISOString(),
    entry.expiresAt.toISOString(),
    new Date().toISOString()
  );
}

async pruneExpiredCache(): Promise<number> {
  const db = this.ensureDb();
  const result = db.prepare(
    'DELETE FROM librarian_query_cache WHERE expires_at < ?'
  ).run(new Date().toISOString());
  return result.changes;
}
```

3. **Wire cache into query.ts**:
```typescript
async query(request: LibrarianQuery): Promise<LibrarianResponse> {
  const queryHash = hashQuery(request);

  // Check cache first
  const cached = await this.storage.getCachedQuery(queryHash);
  if (cached) {
    return cached.response;
  }

  // ... execute query ...

  // Cache result (TTL: 5 minutes for L0, 30 minutes for L1/L2)
  const ttlMs = request.depth === 'L0' ? 5 * 60 * 1000 : 30 * 60 * 1000;
  await this.storage.setCachedQuery({
    queryHash,
    queryParams: request,
    response,
    expiresAt: new Date(Date.now() + ttlMs)
  });

  return response;
}
```

#### Verification
```bash
# Check table created
sqlite3 .LiBrainian/LiBrainian.sqlite ".schema librarian_query_cache"

# Run tests
npm test -- src/LiBrainian

# Manual test (query twice, second should be faster)
node -e "
  const { createLibrarian } = require('./dist/LiBrainian/index.js');
  const lib = await createLibrarian({ workspace: process.cwd() });

  console.time('First query');
  await lib.query({ intent: 'authentication', depth: 'L1' });
  console.timeEnd('First query');

  console.time('Cached query');
  await lib.query({ intent: 'authentication', depth: 'L1' });
  console.timeEnd('Cached query');
"
```

#### Success Criteria
- [ ] Cache table exists with proper schema
- [ ] Second identical query is >10x faster
- [ ] TTL expiration works
- [ ] Tests pass

---

### R4: Cyclomatic Complexity Metric

**Priority**: P1 High
**Effort**: Small (1 hour)
**File**: `src/LiBrainian/knowledge/quality_metrics.ts`
**Status**: ✅ Complete (ts-morph cyclomatic complexity index + fallback heuristics)

#### Problem
Quality metrics use line counts only. Need real cyclomatic complexity for better code quality assessment.

#### Before You Start
```bash
# Check current quality metrics
cat src/LiBrainian/knowledge/quality_metrics.ts | head -100

# Check ts-morph is available
grep "ts-morph" package.json
```

#### Implementation Steps

1. **Add complexity calculation**:
```typescript
import { Project, Node, SyntaxKind } from 'ts-morph';

export function calculateCyclomaticComplexity(filePath: string): number {
  const project = new Project();
  const sourceFile = project.addSourceFileAtPath(filePath);
  let complexity = 1; // Base complexity

  sourceFile.forEachDescendant(node => {
    // Count decision points
    switch (node.getKind()) {
      case SyntaxKind.IfStatement:
      case SyntaxKind.ConditionalExpression: // ternary
      case SyntaxKind.ForStatement:
      case SyntaxKind.ForInStatement:
      case SyntaxKind.ForOfStatement:
      case SyntaxKind.WhileStatement:
      case SyntaxKind.DoStatement:
      case SyntaxKind.CaseClause:
      case SyntaxKind.CatchClause:
        complexity++;
        break;
    }

    // Count logical operators
    if (Node.isBinaryExpression(node)) {
      const op = node.getOperatorToken().getText();
      if (op === '&&' || op === '||' || op === '??') {
        complexity++;
      }
    }
  });

  return complexity;
}

export function calculateFileComplexity(filePath: string): FileComplexity {
  const project = new Project();
  const sourceFile = project.addSourceFileAtPath(filePath);

  const functions: FunctionComplexity[] = [];

  sourceFile.getFunctions().forEach(fn => {
    functions.push({
      name: fn.getName() || '<anonymous>',
      complexity: calculateFunctionComplexity(fn),
      lineCount: fn.getEndLineNumber() - fn.getStartLineNumber() + 1
    });
  });

  return {
    filePath,
    totalComplexity: functions.reduce((sum, f) => sum + f.complexity, 0),
    maxFunctionComplexity: Math.max(...functions.map(f => f.complexity), 0),
    functions
  };
}
```

2. **Wire into quality assessment**:
Update `getQualityMetrics()` to include complexity scores.

#### Verification
```bash
# Run quality tests
npm test -- quality_metrics

# Manual test
node -e "
  const { calculateCyclomaticComplexity } = require('./dist/LiBrainian/knowledge/quality_metrics.js');
  console.log('Complexity:', calculateCyclomaticComplexity('src/LiBrainian/storage/sqlite_storage.ts'));
"
```

#### Success Criteria
- [ ] Complexity calculation works for TypeScript files
- [ ] Function-level complexity reported
- [ ] Integrated into quality metrics API
- [ ] Tests pass

---

### R5: Agentic Test Coverage

**Priority**: P1 High
**Effort**: Medium (2-3 hours)
**File**: `src/LiBrainian/__tests__/agentic/`
**Status**: ✅ Complete (engine_feedback.test.ts covers the 4 required tests)

#### Problem
Engine implementations existed but needed 4 remaining agentic tests (as specified in implementation-requirements.md).

#### Before You Start
```bash
# Check existing agentic tests
cat src/LiBrainian/__tests__/agentic/qualification.test.ts | head -50

# Check engine test requirements in docs
grep -A 30 "Agentic Testing Requirements" docs/LiBrainian/implementation-requirements.md
```

#### Implementation Steps

Implemented these tests in `src/LiBrainian/__tests__/agentic/engine_feedback.test.ts`:

1. **Test: Relevance improves after feedback**
2. **Test: Constraint suggestions are learned**
3. **Test: High confidence correlates with success**
4. **Test: Proceed decision prevents high-risk work**

See [implementation-requirements.md#agentic-testing-requirements](./implementation-requirements.md#agentic-testing-requirements) for exact test specifications.

#### Verification
```bash
# Run agentic tests (requires live provider)
npm test -- src/LiBrainian/__tests__/agentic

# Check coverage
npm run test:coverage -- src/LiBrainian
```

#### Success Criteria
- [x] 4 new agentic tests added
- [x] Tests use live providers (not mocks)
- [ ] Tests pass with authenticated provider (verification pending)

---

### R6: Hierarchical Memory

**Priority**: P2 Medium
**Effort**: Large (4-6 hours)
**Files**: New `src/LiBrainian/memory/hierarchical_memory.ts`
**Status**: ✅ Complete (HierarchicalMemory + query cache integration)

#### Problem
All queries hit SQLite. Need L1 (in-memory) → L2 (LRU) → L3 (SQLite) cache hierarchy for better performance.

#### Implementation Outline

```typescript
interface HierarchicalMemory {
  l1: Map<string, Knowledge>;           // Hot: current task (max 100 items)
  l2: LRUCache<string, Knowledge>;      // Warm: recent tasks (max 1000 items)
  l3: SqliteLibrarianStorage;           // Cold: all history

  get(key: string): Promise<Knowledge | null>;
  set(key: string, value: Knowledge, tier?: 'l1' | 'l2'): Promise<void>;
  invalidate(key: string): Promise<void>;
  promote(key: string): Promise<void>;   // Move from L3 → L2 → L1
  demote(key: string): Promise<void>;    // Move from L1 → L2 → L3
}
```

#### Success Criteria
- [x] Three-tier cache implemented
- [x] LRU eviction for L2
- [x] Automatic promotion on access
- [x] Query latency reduced >50% for hot paths

---

### R7: Multi-Language AST

**Priority**: P2 Medium
**Effort**: Large (6-8 hours)
**File**: `src/LiBrainian/agents/ast_indexer.ts`
**Status**: ✅ Complete (tree-sitter parsers for Python/Go/Rust + fallback)

#### Current State
TypeScript uses ts-morph (full AST). Other languages use regex extraction (partial).

#### Problem
Regex extraction misses nested constructs, complex patterns. Need real AST for Python, Go, Rust at minimum.

#### Implementation Options
1. **tree-sitter** - Universal AST parser, supports 100+ languages
2. **Language servers** - LSP provides AST indirectly
3. **External tools** - pyright, gopls, rust-analyzer

#### Success Criteria
- [x] Python: function/class extraction via AST
- [x] Go: function/struct extraction via AST
- [x] Graceful fallback to regex for unsupported languages

---

### R8: Event Bus Integration

**Priority**: P2 Medium
**Effort**: Medium (2-3 hours)
**Files**: `src/LiBrainian/engines/index.ts`, `src/LiBrainian/integration/wave0_integration.ts`, `src/LiBrainian/api/query.ts`, `src/orchestrator/activity_feed_writer.ts`
**Status**: ✅ Complete (lifecycle events emitted + engine bridge + activity feed logging)

#### Problem
Engines have trigger matrices defined but aren't wired to Wave0's event bus.

#### Implementation Steps
1. Subscribe engines to lifecycle events (`task:received`, `task:completed`, etc.)
2. Subscribe to filesystem events (`file:modified`, `file:created`)
3. Emit engine events for downstream consumers

#### Success Criteria
- [x] Engines receive task lifecycle events
- [x] File changes trigger staleness marking
- [x] Events logged to activity feed

---

### R9: Fine-Grained Call Edges

**Priority**: P3 Optional
**Effort**: Large

#### Note
Module-level graph is sufficient for most use cases. Only implement if:
- Dead code detection needed at function level
- Precise refactoring impact required
- Call chain visualization requested

See [implementation-requirements.md#g14](./implementation-requirements.md#g14-callimport-graph-persistence) for schema.

---

### R10: Coverage-Based Test Mapping

**Priority**: P3 Optional
**Effort**: Medium

#### Note
Current naming-convention heuristics work for most projects. Only implement if:
- Project has non-standard test naming
- Istanbul/c8 coverage output available

See [implementation-requirements.md#optional-coverage-based-mapping](./implementation-requirements.md#g15-test-code-relationship-mapping) for implementation.

---

## Verification Checklist

After completing any task, run these commands:

```bash
# 1. Tier-0 tests must pass
npm run test:tier0

# 2. LiBrainian tests must pass
npm test -- src/LiBrainian

# 3. Check database integrity
sqlite3 .LiBrainian/LiBrainian.sqlite "PRAGMA integrity_check"

# 4. Check no TypeScript errors
npx tsc --noEmit

# 5. Check slop detection
npm run test:agentic-review
```

---

## Questions?

- **Architecture questions**: See [architecture.md](./architecture.md)
- **Integration questions**: See [implementation-requirements.md#wave0-LiBrainian-integration-contract](./implementation-requirements.md#wave0-LiBrainian-integration-contract)
- **Testing policy**: See [../TEST.md](../TEST.md)
- **Engine specifications**: See [implementation-requirements.md#LiBrainian-engine-toolkit](./implementation-requirements.md#LiBrainian-engine-toolkit)

---

**Document Status**: Created 2025-12-30. Update task statuses as work completes.
