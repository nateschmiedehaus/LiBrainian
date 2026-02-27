# Legacy Research Notice
This file is archived. Canonical guidance lives in `docs/LiBrainian/README.md`.
Extract useful research into canonical docs; do not extend this file.

# LiBrainian Implementation Requirements

> **FOR AGENTS**: This is the primary implementation reference. Use the table of contents below to jump to your section.
> **Navigation**: [README.md](./README.md) | [architecture.md](./architecture.md) | [overview.md](./overview.md) | [scenarios.md](./scenarios.md) | [Back to docs](../)
>
> **See Also**: [scenarios.md](./scenarios.md) - 30 real-world scenarios showing what actually happens vs what should happen, with elegant solutions

**Updated**: 2025-12-30

---

## ⛔ STOP — MANDATORY FIRST TASK

```
┌─────────────────────────────────────────────────────────────────────────┐
│  BEFORE IMPLEMENTING ANYTHING IN THIS DOC:                              │
│  Port auth wiring from wave0/Claude/Codex to LiBrainian                 │
│                                                                         │
│  See: REMAINING_WORK.md#r0-fix-provider-auth-wiring                    │
│  Problem: 15 tests skip (auth exists but LiBrainian doesn't use it)     │
│  DO NOT proceed with other tasks until this is fixed                   │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Table of Contents

### Quick Jump: Most Important Sections

| Section | What It Contains | State | Jump Link |
|---------|------------------|-------|-----------|
| **Real-World Scenarios** | 30 scenarios showing actual behavior | 📋 REFERENCE | [scenarios.md](./scenarios.md) |
| **Engine Toolkit** | Three core engines with full specs | ✅ IMPLEMENTED | [#LiBrainian-engine-toolkit](#LiBrainian-engine-toolkit) |
| **Wave0 Integration** | How Wave0 uses LiBrainian | ✅ IMPLEMENTED | [#wave0-LiBrainian-integration-contract](#wave0-LiBrainian-integration-contract) |
| **Agent Guide** | Priority order, checklists | 📋 REFERENCE | [#agent-implementation-guide](#agent-implementation-guide) |

### State Legend

| Indicator | Meaning | Agent Action |
|-----------|---------|--------------|
| ✅ IMPLEMENTED | Code exists and works | Read existing code, don't rewrite |
| ⚠️ PARTIAL | Foundation exists, needs completion | Read existing code, extend it |
| ❌ NOT STARTED | No code exists | Implement from spec |
| 🔄 NEEDS UPGRADE | Code exists but needs improvement | Read existing, refactor |
| 📋 REFERENCE | Documentation only, no code to write | Use as guide |

### Full Table of Contents (with Implementation State)

1. [Implementation Status Summary](#implementation-status-summary) 📋
2. [Executive Summary](#executive-summary) 📋
3. **Gap Implementations**
   - [G13: Knowledge Query Implementations](#g13-complete-knowledge-query-implementations) ✅ 85% done
   - [G14: Call/Import Graph Persistence](#g14-callimport-graph-persistence) ✅ Module-level done
   - [G15: Test-Code Relationship Mapping](#g15-test-code-relationship-mapping) ✅ Implemented
   - [G16: Incremental Indexing](#g16-incremental-indexing) ✅ Implemented
   - [G17: Commit Indexer](#g17-commit-indexer-git-history-semantics) ✅ Implemented
   - [G18: Ownership Matrix](#g18-ownership-matrix-blame-indexer) ✅ Implemented
   - [G21: Task Failure Attribution](#g21-task-failure-attribution) ✅ Implemented
4. **Integration & Quality**
   - [Cross-Cutting Concerns](#cross-cutting-concerns) 📋
   - [Testing Verification Matrix](#testing-verification-matrix) 📋
5. **Wave0 Integration**
   - [Wave0-LiBrainian Integration Contract](#wave0-LiBrainian-integration-contract) ✅ Wired
6. **Engine Toolkit** (NEW - Specs ready for implementation)
   - [LiBrainian Engine Toolkit](#LiBrainian-engine-toolkit) ✅ Implemented
   - [Engine 1: Relevance Engine](#engine-1-relevance-engine) ✅ Implemented
   - [Engine 2: Constraint Engine](#engine-2-constraint-engine) ✅ Implemented
   - [Engine 3: Meta-Knowledge Engine](#engine-3-meta-knowledge-engine) ✅ Implemented
   - [Unified Agent Interface](#unified-agent-interface) ✅ Implemented
   - [Universal Project Support](#universal-project-support) ✅ Multi-language regex + ts-morph
   - [Edge Cases and Error Handling](#edge-cases-and-error-handling) 📋
7. **Implementation Guide**
   - [Agent Implementation Guide](#agent-implementation-guide) 📋
   - [Phase 1 vs Phase 2 Features](#phase-1-vs-phase-2-features) 📋
   - [Verification Commands](#verification-commands) 📋

---

## Implementation Status Summary

**AUDIT RESULT**: The LiBrainian is more complete than the gap analysis suggested. Here's the actual state:

| Gap | Claimed State | Actual State | Work Needed |
|-----|---------------|--------------|-------------|
| **G13** | 40% complete | **90% complete** | Cyclomatic metrics added; minor wiring remains |
| **G14** | Not persisted | **Graph edges persisted** | Optional: Expand fine-grained edges |
| **G15** | Empty testMapping | **Implemented** | Test mappings ingested + context wiring |
| **G16** | No incremental | **Implemented** | Checksums + dependency invalidation + debounced watcher |
| **G17** | Not created | **Implemented** | Commit indexer + semantic summaries |
| **G18** | Not created | **Implemented** | Ownership matrix from git history |
| **G21** | Hardcoded strings | **Implemented** | SBFL attribution + suspicious pack scoring |

### Available Dependencies (already in package.json)
- `ts-morph` v22.0.0 - Full TypeScript AST manipulation
- `better-sqlite3` v11.0.0 - Synchronous SQLite operations
- `execa` v8.0.1 - Running git commands
- `proper-lockfile` v4.1.2 - File locking for concurrent access

### Files with Real Implementations (Read Before Implementing)
```
src/LiBrainian/knowledge/architecture.ts    # 585 lines - dependency analysis, cycles, coupling
src/LiBrainian/knowledge/impact.ts          # 489 lines - blast radius, test impact, risk
src/LiBrainian/knowledge/module_graph.ts    # Graph building from module data
src/LiBrainian/graphs/pagerank.ts           # PageRank computation
src/LiBrainian/graphs/centrality.ts         # Betweenness centrality
src/LiBrainian/graphs/temporal_graph.ts     # Co-change edge computation
src/LiBrainian/storage/sqlite_storage.ts    # 1500+ lines - all storage operations
```

---

## Executive Summary

This document translates research on code intelligence systems into specific implementation requirements for Wave0's LiBrainian. Each section covers:
- **Algorithm to use** (proven, researched)
- **Data structures required** (with schemas)
- **Integration points** (where in Wave0)
- **Testing strategy** (how to verify correctness)
- **Pitfalls to avoid** (from research on failures)

---

## G13: Complete Knowledge Query Implementations

### ✅ MOSTLY IMPLEMENTED - See Existing Code

**Actual State**: 85% complete. `architecture.ts` and `impact.ts` have real implementations.

### What Already Works (in `src/LiBrainian/knowledge/architecture.ts`)

```typescript
// EXISTING: Tarjan's SCC algorithm for cycle detection (lines 299-369)
private async detectCycles(): Promise<ArchitectureResult> {
  // Uses real Tarjan's algorithm with index, lowlink, stack
  // Returns DependencyCycle[] with severity and suggestions
}

// EXISTING: Full dependency traversal (lines 120-171)
private async analyzeDependencies(target, maxDepth): Promise<ArchitectureResult> {
  // Traverses module graph to depth N
  // Returns DependencyNode[] with direct/transitive types
}

// EXISTING: Coupling metrics (lines 372-419)
private async analyzeCoupling(): Promise<ArchitectureResult> {
  // Computes afferent/efferent coupling, instability index
  // Uses estimateAbstractness() for Martin metrics
}

// EXISTING: Core module identification (lines 422-469)
private async identifyCoreModules(): Promise<ArchitectureResult> {
  // Uses PageRank + betweenness centrality
  // Returns risk level (low/medium/high/critical)
}
```

### What Already Works (in `src/LiBrainian/knowledge/impact.ts`)

```typescript
// EXISTING: Blast radius analysis (lines 145-205)
private async analyzeBlastRadius(query): Promise<ImpactResult> {
  // Computes blast percentage, direct/transitive counts
  // Returns RiskAssessment with factors and mitigations
}

// EXISTING: Test impact by naming convention (lines 207-286)
private async analyzeTestImpact(query): Promise<ImpactResult> {
  // Finds tests by pattern matching (.test., .spec., __tests__)
  // Returns TestImpact[] with priority (must_run/should_run/optional)
}

// EXISTING: Risk assessment (lines 288-382)
private async assessRisk(query): Promise<ImpactResult> {
  // Combines blast radius, test coverage, centrality
  // Returns score 0-100 with factor breakdown
}
```

### Remaining Work (Minor)

**1. Add cyclomatic complexity to quality.ts**

Current `quality_metrics.ts` uses line counts. Add real complexity:

```typescript
// In src/LiBrainian/knowledge/quality_metrics.ts
import { Project } from 'ts-morph';

export function calculateCyclomaticComplexity(filePath: string): number {
  const project = new Project();
  const sourceFile = project.addSourceFileAtPath(filePath);
  let complexity = 1; // Base complexity

  sourceFile.forEachDescendant(node => {
    // Count decision points
    if (Node.isIfStatement(node) ||
        Node.isConditionalExpression(node) ||
        Node.isForStatement(node) ||
        Node.isWhileStatement(node) ||
        Node.isDoStatement(node) ||
        Node.isCaseClause(node) ||
        Node.isCatchClause(node)) {
      complexity++;
    }
    // Count logical operators
    if (Node.isBinaryExpression(node)) {
      const op = node.getOperatorToken().getText();
      if (op === '&&' || op === '||') complexity++;
    }
  });

  return complexity;
}
```

**2. Expose knowledge modules in main query API**

Wire `ArchitectureKnowledge` and `ImpactKnowledge` into the main `LiBrainian.query()` response.

### Testing Strategy

```bash
# Unit tests already exist
npm test -- src/LiBrainian/__tests__/LiBrainian.test.ts

# Verify architecture queries work
node -e "
  import { ArchitectureKnowledge } from './src/LiBrainian/knowledge/architecture.js';
  // Test with real storage
"
```

### No Additional Schema Needed

The existing `librarian_modules` table with `dependencies` JSON column provides the graph. Fine-grained `call_edges` table is OPTIONAL for future optimization.

---

## G14: Call/Import Graph Persistence

### ✅ MODULE-LEVEL ALREADY IMPLEMENTED

**Actual State**: Module-level graph is persisted in `librarian_modules.dependencies` column as JSON array.

### What Already Works

```sql
-- Existing schema in sqlite_storage.ts
CREATE TABLE librarian_modules (
  id TEXT PRIMARY KEY,
  path TEXT UNIQUE NOT NULL,
  purpose TEXT,
  exports TEXT,       -- JSON array of exported symbols
  dependencies TEXT,  -- JSON array of imported module paths ← THIS IS THE GRAPH
  confidence REAL
);
```

The `buildModuleGraphs()` function in `module_graph.ts` builds bidirectional adjacency maps from this data:

```typescript
// EXISTING in src/LiBrainian/knowledge/module_graph.ts
export function buildModuleGraphs(modules: ModuleKnowledge[]): {
  graph: Map<string, Set<string>>;    // Forward edges (what X depends on)
  reverse: Map<string, Set<string>>;  // Reverse edges (what depends on X)
}
```

### OPTIONAL: Fine-Grained Call Edges

For function-level call tracking (beyond module imports), add this table:

```sql
-- OPTIONAL: Only needed for function-level granularity
CREATE TABLE librarian_call_edges (
  caller_id TEXT NOT NULL,
  callee_id TEXT NOT NULL,
  edge_type TEXT NOT NULL,  -- 'calls' | 'extends' | 'implements'
  call_site_line INTEGER,
  confidence REAL DEFAULT 1.0,
  computed_at TEXT NOT NULL,
  PRIMARY KEY (caller_id, callee_id, edge_type)
);
```

**Implementation using ts-morph** (if function-level needed):

```typescript
import { Project, SyntaxKind } from 'ts-morph';

export function extractCallEdges(filePath: string): CallEdge[] {
  const project = new Project();
  const sourceFile = project.addSourceFileAtPath(filePath);
  const edges: CallEdge[] = [];

  // Find all call expressions
  sourceFile.forEachDescendant(node => {
    if (node.getKind() === SyntaxKind.CallExpression) {
      const callExpr = node.asKind(SyntaxKind.CallExpression);
      const callee = callExpr?.getExpression().getText();
      const caller = node.getFirstAncestorByKind(SyntaxKind.FunctionDeclaration)
        ?.getName();

      if (caller && callee) {
        edges.push({
          callerId: `${filePath}:${caller}`,
          calleeId: callee, // May need resolution
          edgeType: 'calls',
          callSiteLine: node.getStartLineNumber(),
          confidence: 1.0,
        });
      }
    }
  });

  return edges;
}
```

### Recommendation

**For most use cases, module-level graph is sufficient.** The existing implementation:
- Supports dependency traversal
- Enables cycle detection
- Powers blast radius analysis
- Feeds PageRank/centrality calculations

Only implement fine-grained `call_edges` if you need:
- Dead code detection at function level
- Precise refactoring impact (which functions, not just files)
- Call chain visualization

---

## G15: Test-Code Relationship Mapping
**Status**: Implemented (test ingestion persisted to SQLite; context assembly surfaces mappings).

### ⚠️ HEURISTIC EXISTS - Needs Persistence

**Actual State**: `impact.ts:analyzeTestImpact()` finds tests by naming convention but doesn't persist results.

### What Already Works (in `src/LiBrainian/knowledge/impact.ts` lines 207-286)

```typescript
// EXISTING: Heuristic test finding
private async analyzeTestImpact(query: ImpactQuery): Promise<ImpactResult> {
  const tests: TestImpact[] = [];

  // Finds tests by name matching:
  // - Files containing .test. or .spec.
  // - Files in __tests__ directories
  // - Files whose name matches source file name

  // Returns priority: 'must_run' | 'should_run' | 'optional'
}
```

### Required Enhancement: Persist Test Mappings

**Schema Addition**:
```sql
CREATE TABLE librarian_test_mapping (
  source_file TEXT NOT NULL,
  test_file TEXT NOT NULL,
  mapping_type TEXT NOT NULL,  -- 'naming_convention' | 'import' | 'coverage'
  confidence REAL DEFAULT 1.0,
  last_verified TEXT,
  PRIMARY KEY (source_file, test_file)
);

CREATE INDEX idx_test_mapping_source ON librarian_test_mapping(source_file);
```

**Implementation** (add to `sqlite_storage.ts`):

```typescript
// Add to SqliteLibrarianStorage class

async getTestsForSource(sourcePath: string): Promise<TestMapping[]> {
  const db = this.ensureDb();
  const rows = db.prepare(
    'SELECT * FROM librarian_test_mapping WHERE source_file = ?'
  ).all(sourcePath) as TestMappingRow[];
  return rows.map(rowToTestMapping);
}

async upsertTestMapping(mapping: TestMapping): Promise<void> {
  const db = this.ensureDb();
  db.prepare(`
    INSERT INTO librarian_test_mapping (source_file, test_file, mapping_type, confidence, last_verified)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(source_file, test_file) DO UPDATE SET
      mapping_type = excluded.mapping_type,
      confidence = excluded.confidence,
      last_verified = excluded.last_verified
  `).run(mapping.sourceFile, mapping.testFile, mapping.mappingType, mapping.confidence, new Date().toISOString());
}

async getUntestedFiles(): Promise<string[]> {
  const db = this.ensureDb();
  // Find source files with no test mappings
  return db.prepare(`
    SELECT m.path FROM librarian_modules m
    WHERE NOT EXISTS (
      SELECT 1 FROM librarian_test_mapping t WHERE t.source_file = m.path
    )
    AND m.path NOT LIKE '%test%'
    AND m.path NOT LIKE '%spec%'
  `).all().map(r => r.path);
}
```

**Indexer** (create `src/LiBrainian/ingest/test_mapping_indexer.ts`):

```typescript
import * as fs from 'fs';
import * as path from 'path';
import type { LibrarianStorage } from '../storage/types.js';

export async function indexTestMappings(
  storage: LibrarianStorage,
  workspaceRoot: string
): Promise<{ mapped: number; unmapped: number }> {
  const modules = await storage.getModules();
  let mapped = 0, unmapped = 0;

  for (const mod of modules) {
    if (mod.path.includes('.test.') || mod.path.includes('__tests__')) continue;

    const testPatterns = [
      mod.path.replace(/^src\//, 'test/').replace(/\.ts$/, '.test.ts'),
      mod.path.replace(/\/([^/]+)\.ts$/, '/__tests__/$1.test.ts'),
      mod.path.replace(/\.ts$/, '.spec.ts'),
    ];

    let found = false;
    for (const pattern of testPatterns) {
      const fullPath = path.join(workspaceRoot, pattern);
      if (fs.existsSync(fullPath)) {
        await storage.upsertTestMapping({
          sourceFile: mod.path,
          testFile: pattern,
          mappingType: 'naming_convention',
          confidence: 0.9,
        });
        mapped++;
        found = true;
      }
    }
    if (!found) unmapped++;
  }

  return { mapped, unmapped };
}
```

### Optional: Coverage-Based Mapping

If you have Istanbul/c8 coverage output:

```typescript
async function indexCoverageMapping(coverageDir: string): Promise<TestMapping[]> {
  const mappings: TestMapping[] = [];
  const files = await fs.promises.readdir(coverageDir);

  for (const file of files.filter(f => f.endsWith('.json'))) {
    const data = JSON.parse(await fs.promises.readFile(path.join(coverageDir, file), 'utf8'));
    // Istanbul format: { [filePath]: { s: {1: 5, 2: 0}, ... } }
    for (const [sourcePath, coverage] of Object.entries(data)) {
      if (coverage.s && Object.values(coverage.s).some(v => v > 0)) {
        mappings.push({
          sourceFile: sourcePath,
          testFile: file.replace('.json', ''),
          mappingType: 'coverage',
          confidence: 1.0,
        });
      }
    }
  }
  return mappings;
}
```

### Testing Strategy

```bash
# Verify table exists after migration
sqlite3 .LiBrainian/LiBrainian.db ".schema librarian_test_mapping"

# Verify mappings populated
sqlite3 .LiBrainian/LiBrainian.db "SELECT COUNT(*) FROM librarian_test_mapping"

# Test untested file detection
node -e "
  const untested = await storage.getUntestedFiles();
  console.log('Files without tests:', untested.length);
"
```

---

## G16: Incremental Indexing
**Status**: Implemented (checksums + dependency invalidation + debounced file watcher).

### ✅ IMPLEMENTED - Wired

**Actual State**: File checksum tracking exists. Context pack invalidation exists. Debounced file watcher triggers incremental reindexing.

### What Already Works (in `sqlite_storage.ts`)

```typescript
// EXISTING: File checksum table and methods
async getFileChecksum(filePath: string): Promise<string | null>
async setFileChecksum(filePath: string, checksum: string): Promise<void>
async isFileIndexed(filePath: string): Promise<boolean>

// EXISTING: Context pack invalidation (lines 718-731)
async invalidateContextPacks(triggerPath: string): Promise<number> {
  // Uses LIKE query on invalidation_triggers JSON
  // Returns count of invalidated packs
}

// EXISTING: Concurrent access control via proper-lockfile
```

### Implementation Notes: File Watcher with Debouncing

**Implemented in `src/LiBrainian/integration/file_watcher.ts`**:

```typescript
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { LibrarianStorage } from '../storage/types.js';

export class IncrementalIndexer {
  private pendingChanges = new Map<string, NodeJS.Timeout>();
  private watcher: fs.FSWatcher | null = null;

  constructor(
    private storage: LibrarianStorage,
    private workspaceRoot: string,
    private debounceMs: number = 200
  ) {}

  start(): void {
    this.watcher = fs.watch(
      this.workspaceRoot,
      { recursive: true },
      (event, filename) => {
        if (!filename || !filename.endsWith('.ts')) return;
        this.scheduleReindex(filename);
      }
    );
  }

  stop(): void {
    this.watcher?.close();
    for (const timeout of this.pendingChanges.values()) {
      clearTimeout(timeout);
    }
    this.pendingChanges.clear();
  }

  private scheduleReindex(filePath: string): void {
    clearTimeout(this.pendingChanges.get(filePath));

    this.pendingChanges.set(filePath, setTimeout(async () => {
      this.pendingChanges.delete(filePath);
      await this.reindexFile(filePath);
    }, this.debounceMs));
  }

  async reindexFile(relativePath: string): Promise<boolean> {
    const fullPath = path.join(this.workspaceRoot, relativePath);

    // Check if file still exists
    if (!fs.existsSync(fullPath)) {
      await this.handleFileDeleted(relativePath);
      return true;
    }

    // Compute content hash
    const content = await fs.promises.readFile(fullPath, 'utf8');
    const newHash = crypto.createHash('sha256').update(content).digest('hex');
    const oldHash = await this.storage.getFileChecksum(relativePath);

    if (newHash === oldHash) {
      return false; // No actual change
    }

    // Update checksum
    await this.storage.setFileChecksum(relativePath, newHash);

    // Invalidate context packs that depend on this file
    const invalidated = await this.storage.invalidateContextPacks(relativePath);

    // Delete existing functions for this file
    await this.storage.deleteFunctionsByPath(relativePath);

    // Re-index the file (call your existing indexer)
    // await indexFile(this.storage, fullPath);

    console.log(`Reindexed ${relativePath}, invalidated ${invalidated} context packs`);
    return true;
  }

  private async handleFileDeleted(relativePath: string): Promise<void> {
    await this.storage.deleteFileChecksum(relativePath);
    await this.storage.deleteFunctionsByPath(relativePath);
    await this.storage.invalidateContextPacks(relativePath);
    console.log(`Cleaned up deleted file: ${relativePath}`);
  }
}
```

### Integration with Bootstrap

Modify `scripts/bootstrap_librarian.mjs` to support incremental mode:

```javascript
// Add --incremental flag handling
if (args.includes('--incremental')) {
  const modules = await storage.getModules();
  let reindexed = 0;

  for (const mod of modules) {
    const fullPath = path.join(workspaceRoot, mod.path);
    if (!fs.existsSync(fullPath)) {
      await storage.deleteModule(mod.id);
      continue;
    }

    const content = fs.readFileSync(fullPath, 'utf8');
    const newHash = crypto.createHash('sha256').update(content).digest('hex');
    const oldHash = await storage.getFileChecksum(mod.path);

    if (newHash !== oldHash) {
      // Reindex this file
      reindexed++;
    }
  }

  console.log(`Incremental: ${reindexed} files need reindexing`);
}
```

### Testing Strategy

```bash
# Benchmark full vs incremental
time node scripts/bootstrap_librarian.mjs --workspace .
# Record T1

echo "// comment" >> src/LiBrainian/index.ts
time node scripts/bootstrap_librarian.mjs --workspace . --incremental
# Record T2

# T2 should be <10% of T1 for unchanged files
```

### Already Handled

- **Race conditions**: `proper-lockfile` already used in `sqlite_storage.ts`
- **Concurrent access**: WAL mode enabled, busy timeout set

---

## G17: Commit Indexer (Git History Semantics)
**Status**: Implemented (git log ingestion + semantic summaries).

### Research Findings

From Git mining research and SZZ algorithm:
- **Semantic commit analysis**: NLP on commit messages (V-DO pattern 47% common)
- **Bug-introducing commits**: SZZ algorithm traces fixes back to introductions
- **Kamei's 14 metrics**: Diffusion, size, purpose, history, experience

### Required Algorithm: SZZ + Kamei Metrics

### Implementation Requirements

**Schema Addition**:
```sql
CREATE TABLE librarian_commits (
  commit_hash TEXT PRIMARY KEY,
  author_email TEXT NOT NULL,
  author_name TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  message TEXT NOT NULL,
  files_changed TEXT,  -- JSON array

  -- Kamei metrics
  lines_added INTEGER,
  lines_deleted INTEGER,
  subsystems_touched INTEGER,
  directories_touched INTEGER,
  files_touched INTEGER,
  is_fix BOOLEAN DEFAULT FALSE,
  is_refactor BOOLEAN DEFAULT FALSE,

  -- Computed
  semantic_category TEXT,  -- 'feature' | 'fix' | 'refactor' | 'docs' | 'test'
  risk_score REAL,

  indexed_at TEXT NOT NULL
);

CREATE TABLE librarian_file_commits (
  file_path TEXT NOT NULL,
  commit_hash TEXT NOT NULL,
  lines_added INTEGER,
  lines_deleted INTEGER,
  PRIMARY KEY (file_path, commit_hash)
);

CREATE INDEX idx_commits_timestamp ON librarian_commits(timestamp DESC);
CREATE INDEX idx_file_commits_file ON librarian_file_commits(file_path);
```

**Commit Classification** (from research):
```typescript
function classifyCommit(message: string): SemanticCategory {
  const lower = message.toLowerCase();

  // Pattern matching (47% follow V-DO pattern)
  if (/\b(fix|bug|issue|error|crash|patch)\b/.test(lower)) return 'fix';
  if (/\b(refactor|clean|reorganize|restructure)\b/.test(lower)) return 'refactor';
  if (/\b(doc|readme|comment|typo)\b/.test(lower)) return 'docs';
  if (/\b(test|spec|coverage)\b/.test(lower)) return 'test';
  if (/\b(add|implement|feature|new)\b/.test(lower)) return 'feature';

  return 'other';
}

function calculateRiskScore(commit: CommitData): number {
  // Based on Kamei's research
  let risk = 0;

  risk += Math.min(commit.linesAdded / 100, 0.3);  // Large changes = risky
  risk += Math.min(commit.filesChanged.length / 10, 0.3);  // Many files = risky
  risk += commit.isFix ? 0 : 0.1;  // New code riskier than fixes
  risk += Math.min(commit.subsystemsTouched / 3, 0.2);  // Cross-cutting = risky

  return Math.min(risk, 1.0);
}
```

### Testing Strategy

```bash
# Index recent commits
node scripts/bootstrap_librarian.mjs --index-git-history --depth 100

# Verify commit data
sqlite3 .LiBrainian/LiBrainian.db "SELECT semantic_category, COUNT(*) FROM librarian_commits GROUP BY semantic_category"

# Query recent changes for a file
node -e "
  const changes = await lib.getRecentChanges('src/auth/login.ts', { limit: 5 });
  assert(changes.length > 0);
  assert(changes[0].semanticCategory !== undefined);
"
```

### Pitfalls to Avoid

1. **Large history**: Limit initial index to recent N commits (configurable).
2. **Merge commits**: Handle specially (may touch many files but are consolidations).
3. **Commit amends**: Track by content, not just hash.

---

## G18: Ownership Matrix (Blame Indexer)
**Status**: Implemented (ownership from git history; blame optional).

### Research Findings

From Google OWNERS and DOA/DOE research:
- **Degree of Authorship (DOA)**: Creator + frequency - decay from others' edits
- **File-level ownership**: Simpler and sufficient for most use cases
- **Expertise scores**: Weight by lines authored and recency

### Required Algorithm: DOA with Recency Weighting

### Implementation Requirements

**Schema Addition**:
```sql
CREATE TABLE librarian_ownership (
  file_path TEXT NOT NULL,
  author_email TEXT NOT NULL,

  -- Metrics
  lines_authored INTEGER DEFAULT 0,
  total_commits INTEGER DEFAULT 0,
  is_creator BOOLEAN DEFAULT FALSE,
  first_commit TEXT,
  last_commit TEXT,

  -- Computed scores
  ownership_score REAL,  -- 0-1
  expertise_score REAL,  -- 0-1 with recency decay

  PRIMARY KEY (file_path, author_email)
);

CREATE INDEX idx_ownership_file ON librarian_ownership(file_path);
CREATE INDEX idx_ownership_author ON librarian_ownership(author_email);
```

**DOA Algorithm** (from Fritz et al.):
```typescript
async function computeOwnershipScores(filePath: string): Promise<OwnershipScore[]> {
  const blameData = await gitBlame(filePath);
  const totalLines = blameData.length;

  const authorStats = new Map<string, AuthorStats>();

  for (const line of blameData) {
    const stats = authorStats.get(line.author) || {
      lines: 0,
      commits: new Set(),
      isCreator: false,
      firstCommit: line.timestamp,
      lastCommit: line.timestamp,
    };

    stats.lines++;
    stats.commits.add(line.commitHash);
    stats.lastCommit = max(stats.lastCommit, line.timestamp);
    stats.firstCommit = min(stats.firstCommit, line.timestamp);

    authorStats.set(line.author, stats);
  }

  // Determine creator (first commit to file)
  const creator = findCreator(authorStats);
  if (creator) authorStats.get(creator)!.isCreator = true;

  // Compute scores
  const scores: OwnershipScore[] = [];
  for (const [author, stats] of authorStats) {
    const baseOwnership = stats.lines / totalLines;
    const creatorBonus = stats.isCreator ? 0.2 : 0;
    const recencyWeight = computeRecencyWeight(stats.lastCommit);

    scores.push({
      author,
      ownershipScore: Math.min(baseOwnership + creatorBonus, 1.0),
      expertiseScore: baseOwnership * recencyWeight,
      isCreator: stats.isCreator,
      linesAuthored: stats.lines,
      totalCommits: stats.commits.size,
    });
  }

  return scores.sort((a, b) => b.ownershipScore - a.ownershipScore);
}

function computeRecencyWeight(lastCommit: Date): number {
  const daysSinceLastCommit = (Date.now() - lastCommit.getTime()) / (1000 * 60 * 60 * 24);
  // Exponential decay: half-life of 180 days
  return Math.exp(-daysSinceLastCommit / 180 * Math.LN2);
}
```

### Testing Strategy

```bash
# Index ownership
node scripts/bootstrap_librarian.mjs --index-ownership

# Verify primary owners match git blame
git blame --line-porcelain src/auth/login.ts | grep "author " | sort | uniq -c | sort -rn | head -1
node -e "
  const owners = await lib.getOwners('src/auth/login.ts');
  console.log('Primary owner:', owners[0].author);
"
```

### Pitfalls to Avoid

1. **Bot commits**: Filter out automated commits (renovate, dependabot).
2. **Bulk refactors**: One person touching many files shouldn't become "owner".
3. **Recency bias**: Balance with total contribution.

---

## G21: Task Failure Attribution

### ✅ IMPLEMENTED - SBFL Attribution

**Actual State**: Ochiai-based SBFL implemented in `src/LiBrainian/integration/causal_attribution.ts` with
success/failure counts per context pack and suspicious pack scoring.

### Implementation (SBFL Overview)

**1. Add success/failure tracking to context packs**

Schema addition (in `sqlite_storage.ts:ensureConfidenceColumns()`):

```sql
-- Add to context_packs table
ALTER TABLE librarian_context_packs ADD COLUMN success_count INTEGER DEFAULT 0;
ALTER TABLE librarian_context_packs ADD COLUMN failure_count INTEGER DEFAULT 0;
```

**2. Replace `causal_attribution.ts` with real SBFL**

```typescript
// src/LiBrainian/integration/causal_attribution.ts

import type { LibrarianStorage } from '../storage/types.js';

export interface TaskOutcomeSummary {
  success: boolean;
  failureReason?: string;
  failureType?: string;
}

export interface AgentKnowledgeContext {
  packIds: string[];
  affectedEntities: string[];
}

export interface CausalAttribution {
  knowledgeCaused: boolean;
  confidence: number;
  evidence: string;
  affectedEntities: string[];
  suspiciousPacks: Array<{ packId: string; score: number }>;
  recommendation: string;
}

/**
 * Ochiai formula - proven best SBFL metric (research validated)
 */
function computeOchiaiScore(
  packSuccesses: number,
  packFailures: number,
  totalFailures: number
): number {
  if (totalFailures === 0 || packFailures === 0) return 0;

  const totalPackUses = packSuccesses + packFailures;
  if (totalPackUses === 0) return 0;

  // Ochiai: ef / sqrt(totalFail * (ef + ep))
  // ef = failures involving this pack
  // ep = successes involving this pack
  return packFailures / Math.sqrt(totalFailures * totalPackUses);
}

export async function attributeFailure(
  storage: LibrarianStorage,
  outcome: TaskOutcomeSummary,
  context: AgentKnowledgeContext
): Promise<CausalAttribution> {
  // Quick exit for successes
  if (outcome.success) {
    return {
      knowledgeCaused: false,
      confidence: 0.2,
      evidence: 'Task succeeded; no failure attribution required.',
      affectedEntities: context.affectedEntities,
      suspiciousPacks: [],
      recommendation: 'None',
    };
  }

  // Get global stats
  const allPacks = await storage.getContextPacks({ includeInvalidated: false });
  const totalFailures = allPacks.reduce((sum, p) => sum + (p.failureCount ?? 0), 0);

  // Compute suspiciousness for each pack used in this task
  const packScores: Array<{ packId: string; score: number }> = [];

  for (const packId of context.packIds) {
    const pack = await storage.getContextPack(packId);
    if (!pack) continue;

    const score = computeOchiaiScore(
      pack.successCount ?? 0,
      pack.failureCount ?? 0,
      totalFailures
    );

    packScores.push({ packId, score });
  }

  // Sort by suspiciousness descending
  packScores.sort((a, b) => b.score - a.score);

  // Determine if knowledge is likely cause
  const topScore = packScores[0]?.score ?? 0;
  const knowledgeCaused = topScore > 0.4;

  // Build recommendation
  let recommendation = 'Investigate agent behavior - no pack correlation found.';
  if (knowledgeCaused && packScores[0]) {
    recommendation = `Reindex pack ${packScores[0].packId} (Ochiai score: ${topScore.toFixed(2)})`;
  }

  return {
    knowledgeCaused,
    confidence: Math.min(topScore * 1.2, 0.95), // Scale to confidence
    evidence: `SBFL analysis: ${packScores.length} packs analyzed, top score ${topScore.toFixed(2)}`,
    affectedEntities: context.affectedEntities,
    suspiciousPacks: packScores.filter(p => p.score > 0.2),
    recommendation,
  };
}

/**
 * Update pack statistics after task completion
 */
export async function recordPackOutcome(
  storage: LibrarianStorage,
  packId: string,
  success: boolean
): Promise<void> {
  const pack = await storage.getContextPack(packId);
  if (!pack) return;

  // Update in-place (this requires adding a method to storage)
  const db = (storage as any).ensureDb();
  if (success) {
    db.prepare('UPDATE librarian_context_packs SET success_count = success_count + 1 WHERE pack_id = ?').run(packId);
  } else {
    db.prepare('UPDATE librarian_context_packs SET failure_count = failure_count + 1 WHERE pack_id = ?').run(packId);
  }
}
```

**3. Wire into `wave0_integration.ts:recordTaskOutcome()`**

```typescript
// In recordTaskOutcome(), add:
import { attributeFailure, recordPackOutcome } from './causal_attribution.js';

// After recording the outcome:
for (const packId of context.packIds) {
  await recordPackOutcome(storage, packId, outcome.success);
}

if (!outcome.success) {
  const attribution = await attributeFailure(storage, outcome, context);
  // Log or act on attribution
}
```

### Confidence Updates (Already Exists)

The existing `storage.updateConfidence()` method already does Bayesian-style updates with clamping. Just ensure it's called after attribution:

```typescript
// In recordTaskOutcome:
if (attribution.knowledgeCaused) {
  for (const { packId, score } of attribution.suspiciousPacks) {
    const delta = -0.1 * score; // Negative delta proportional to suspicion
    await storage.updateConfidence(packId, 'context_pack', delta, 'SBFL attribution');
  }
}
```

### Testing Strategy

```bash
# Create test fixture with known failure pattern
node -e "
  // Simulate: Pack A used in 10 tasks, 8 failed
  // Simulate: Pack B used in 10 tasks, 2 failed
  // Verify Pack A has higher Ochiai score
"
```

### Cold Start Handling

For new packs with no history, return neutral score:

```typescript
if (pack.successCount + pack.failureCount < 3) {
  // Not enough data - return neutral
  return 0.5;
}
```

---

## G22-G25: Remaining Gaps

### G22: Semantic Task Batching

**Algorithm**: K-means clustering on task embeddings
**Integration**: `scheduler.ts:chooseNextTaskBatch()`
**Testing**: Verify related tasks grouped together

### G23: Expertise Matching

**Algorithm**: Cosine similarity between task embeddings and agent capability embeddings
**Integration**: `scheduler.ts` + agent registry
**Testing**: Verify AST task assigned to TypeScript-skilled agent

### G24: Persistent Query Cache

**Schema**:
```sql
CREATE TABLE librarian_query_cache (
  query_hash TEXT PRIMARY KEY,
  query_params TEXT,
  response TEXT,
  created_at TEXT,
  last_accessed TEXT,
  access_count INTEGER DEFAULT 1
);
```

### G25: Batch Embedding Generation

**Algorithm**: Batch 50 texts per API call, parallel batches with rate limiting
**Integration**: `embedding_service.ts:generateEmbeddingsBatch()`

---

## Cross-Cutting Requirements

### 1. Stable Identifiers

All entity IDs must be **content-addressed**, not positional:
```typescript
// WRONG: Position-based (breaks on any edit)
const id = `${filePath}:${lineNumber}`;

// RIGHT: Content-based (stable across edits)
const id = `${filePath}:${functionName}:${signatureHash}`;
```

### 2. Transaction Safety

All multi-step operations must be atomic:
```typescript
await storage.transaction(async (tx) => {
  await tx.deleteEdgesForFile(filePath);
  await tx.upsertEdges(newEdges);
  await tx.invalidateContextPacks(filePath);
}); // All or nothing
```

### 3. Graceful Degradation

If any subsystem fails, return partial results with confidence marker:
```typescript
try {
  const callGraph = await buildCallGraph();
} catch (e) {
  return { callGraph: null, confidence: 0, warning: 'Call graph unavailable' };
}
```

### 4. Observability

All operations should emit metrics:
```typescript
metrics.increment('LiBrainian.query.count');
metrics.timing('LiBrainian.query.latency', duration);
metrics.gauge('LiBrainian.cache.size', cache.size);
```

---

## Testing Verification Matrix

| Gap | Unit Test | Integration Test | E2E Test |
|-----|-----------|------------------|----------|
| G13 | Query returns structured data | Data flows to context | Agent uses knowledge |
| G14 | Edges stored correctly | Graph traversal works | Blast radius accurate |
| G15 | Mappings detected | Context includes tests | Agent warns about untested |
| G16 | Hash comparison works | Incremental faster | Results match full |
| G17 | Commit parsed correctly | History queryable | Risk scores accurate |
| G18 | Blame parsed correctly | Ownership queryable | Expert assignment works |
| G21 | SBFL computed correctly | Confidence updates | Failures attributed |

---

## Sources

- [Rust Incremental Compilation](https://rustc-dev-guide.rust-lang.org/queries/incremental-compilation-in-detail.html)
- [Salsa Framework](https://salsa-rs.github.io/salsa/overview.html)
- [Bazel Skyframe](https://bazel.build/reference/skyframe)
- [Kythe Storage Model](https://kythe.io/docs/kythe-storage.html)
- [Glean Architecture](https://engineering.fb.com/2024/12/19/developer-tools/glean-open-source-code-indexing/)
- [SBFL Survey](https://arxiv.org/abs/1607.04347)
- [Kamei JIT Defect Prediction](https://damevski.github.io/files/report_CSUR_2022.pdf)
- [DOA Model - Fritz et al.](https://www.semanticscholar.org/paper/A-degree-of-knowledge-model-to-capture-source-code-Fritz-Ou/ee81a50eae3a2d1b62ee5951aeb20f9118ae962e)
- [Microsoft Test Impact Analysis](https://learn.microsoft.com/en-us/azure/devops/pipelines/test/test-impact-analysis)
- [CodeQL Data Flow](https://codeql.github.com/docs/codeql-language-guides/analyzing-data-flow-in-javascript-and-typescript/)

---

**This document should be updated as implementations are completed.**

---

## Wave0-LiBrainian Integration Contract

> **Principle**: LiBrainian is the primary reference for codebase knowledge. Wave0 orchestration should NEVER duplicate analysis that LiBrainian provides.

### The Golden Rule

```
IF Wave0 needs to know something about the codebase
THEN it MUST ask LiBrainian
NEVER implement parallel analysis
```

### Current Integration Points (Working)

| Wave0 Component | LiBrainian API | Purpose |
|-----------------|---------------|---------|
| `context_assembler.ts` | `enrichTaskContext()` | Get semantic context for tasks |
| `scheduler.ts` | `LiBrainian.query()` | Rank tasks by semantic similarity |
| `unified_orchestrator.ts` | `preOrchestrationHook()` | Ensure LiBrainian ready before work |
| `unified_orchestrator.ts` | `postOrchestrationHook()` | Record outcomes, update confidence |
| `unified_orchestrator.ts` | `validateAgentOutput()` | Check agent work against knowledge |

### Duplication to REMOVE from Wave0

These Wave0 implementations duplicate LiBrainian capabilities and should be replaced:

| Wave0 Code | Location | Replace With |
|------------|----------|--------------|
| `inferFilesToRead()` | `context_assembler.ts:1246-1306` | `LiBrainian.query({ intent }).relatedFiles` |
| `CodeSearchIndex` | `utils/code_search.ts` | `LiBrainian.findSimilarByEmbedding()` |
| `calculateRelevance()` | `context_assembler.ts:1414-1437` | LiBrainian's multi-signal ranking |
| `getQualityIssuesInArea()` | `context_assembler.ts:1139-1165` | `knowledge.coverage.gaps` |

### Integration Gaps to FILL

Wave0 should start using these LiBrainian capabilities:

#### 1. Change Impact Before Execution

**Current**: Wave0 tracks consequences AFTER execution via `ConsequenceRingBuffer`
**Should**: Ask LiBrainian for blast radius BEFORE assigning task

```typescript
// In task assignment logic
const impact = await LiBrainian.query({
  type: 'change_impact',
  target: task.affectedFiles[0],
});

if (impact.risk.level === 'critical') {
  // Require senior agent or human review
}
```

#### 2. Test Coverage for Quality Gates

**Current**: Wave0 quality gates don't know if changed code has tests
**Should**: Check test mapping before marking task complete

```typescript
// In quality gate validation
const testMapping = await LiBrainian.getTestsForSource(changedFile);
if (testMapping.length === 0) {
  return {
    passed: false,
    reason: 'No tests cover modified file',
    suggestion: 'Add tests or flag as tech debt'
  };
}
```

#### 3. Ownership for Agent Assignment

**Current**: Agent assignment ignores code ownership
**Should**: Prefer agents with history in owned files

```typescript
// In expertise_matcher.ts
const owners = await LiBrainian.getOwners(task.affectedFiles[0]);
const ownerExpertise = owners.find(o => o.author === agent.id);
if (ownerExpertise?.expertiseScore > 0.7) {
  score += 0.2; // Boost for ownership
}
```

#### 4. Failure Attribution Feedback Loop

**Current**: Task failures don't update LiBrainian confidence
**Should**: Feed failure data back to improve knowledge quality

```typescript
// In postOrchestrationHook or task completion
if (!task.success) {
  const attribution = await LiBrainian.attributeFailure(outcome, context);

  if (attribution.knowledgeCaused) {
    // Trigger reindexing of suspicious packs
    for (const pack of attribution.suspiciousPacks) {
      await LiBrainian.invalidateContextPack(pack.packId);
    }
  }
}
```

### Decision Matrix: When to Use LiBrainian

| Question | Answer | Action |
|----------|--------|--------|
| "What files are related to this task?" | Always LiBrainian | `enrichTaskContext()` |
| "What depends on this file?" | Always LiBrainian | `architecture.query({ type: 'dependents' })` |
| "Is this change risky?" | Always LiBrainian | `impact.query({ type: 'risk_assessment' })` |
| "Who owns this code?" | Always LiBrainian | `getOwners()` (after G18 implemented) |
| "What tests cover this?" | Always LiBrainian | `getTestsForSource()` (after G15 implemented) |
| "Why did this task fail?" | Always LiBrainian | `attributeFailure()` (after G21 implemented) |
| "What's the semantic similarity?" | Always LiBrainian | `findSimilarByEmbedding()` |
| "What patterns apply here?" | Always LiBrainian | `patterns.query()` |

### Anti-Patterns to Avoid

```typescript
// ❌ WRONG: Implementing file search in Wave0
function inferFilesToRead(task: Task): string[] {
  // Manual regex/heuristic search
  const matches = task.description.match(/\b\w+\.(ts|js)\b/g);
  return matches || [];
}

// ✅ RIGHT: Delegate to LiBrainian
async function getRelevantFiles(task: Task): Promise<string[]> {
  const context = await LiBrainian.enrichTaskContext(workspace, {
    intent: task.description,
    affectedFiles: task.knownFiles,
  });
  return context.relatedFiles;
}
```

```typescript
// ❌ WRONG: Maintaining separate code index
class CodeSearchIndex {
  private index: Map<string, FileEntry>;
  // ... duplicates LiBrainian's indexing
}

// ✅ RIGHT: Use LiBrainian's semantic search
async function searchCode(query: string): Promise<SearchResult[]> {
  const embedding = await LiBrainian.getQueryEmbedding(query);
  return LiBrainian.findSimilarByEmbedding(embedding, { limit: 10 });
}
```

### Integration Checklist for New Wave0 Features

When building new Wave0 features, ask:

- [ ] Does this need codebase knowledge? → Use LiBrainian
- [ ] Does this analyze file relationships? → Use LiBrainian's graph
- [ ] Does this assess risk/impact? → Use LiBrainian's impact analysis
- [ ] Does this track outcomes? → Feed back to LiBrainian confidence
- [ ] Does this search code? → Use LiBrainian's semantic search
- [ ] Am I about to write file-matching regexes? → STOP, use LiBrainian

### LiBrainian API Quick Reference

```typescript
// Context for a task
const ctx = await LiBrainian.enrichTaskContext(workspace, { intent, affectedFiles });
// Returns: { summary, keyFacts, relatedFiles, codeSnippets, confidence }

// Architecture queries
const deps = await architecture.query({ type: 'dependencies', target: filePath });
const cycles = await architecture.query({ type: 'cycles' });
const core = await architecture.query({ type: 'core_modules' });

// Impact queries
const blast = await impact.query({ type: 'blast_radius', target: filePath });
const risk = await impact.query({ type: 'risk_assessment', target: filePath });
const tests = await impact.query({ type: 'test_impact', target: filePath });

// Semantic search
const similar = await LiBrainian.findSimilarByEmbedding(queryEmbedding, { limit: 10 });

// Confidence updates (after task completion)
await LiBrainian.recordTaskOutcome(packIds, success);
await LiBrainian.updateConfidence(entityId, entityType, delta, reason);
```

---

## LiBrainian Engine Toolkit

> **Purpose**: Three core engines that transform LiBrainian from a knowledge store into a reasoning system for autonomous agents.
> **Design Principle**: Agents are not passive - they actively query engines for reasoning support.

**Implementation**:
- `src/LiBrainian/engines/relevance.ts`
- `src/LiBrainian/engines/constraint.ts`
- `src/LiBrainian/engines/meta.ts`
- `src/LiBrainian/engines/agent_interface.ts`
- `src/LiBrainian/engines/index.ts`

### Overview: Three Engines + One Foundation

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         LiBrainian ENGINE TOOLKIT                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌───────────────┐   ┌───────────────────┐   ┌───────────────────────┐  │
│  │   RELEVANCE   │   │    CONSTRAINT     │   │    META-KNOWLEDGE     │  │
│  │    ENGINE     │   │      ENGINE       │   │       ENGINE          │  │
│  │               │   │                   │   │                       │  │
│  │ "What matters │   │ "What rules       │   │ "How confident        │  │
│  │  for this?"   │   │  apply here?"     │   │  should I be?"        │  │
│  └───────┬───────┘   └─────────┬─────────┘   └───────────┬───────────┘  │
│          │                     │                         │              │
│          └─────────────────────┴─────────────────────────┘              │
│                                │                                         │
│                    ┌───────────▼───────────┐                            │
│                    │   KNOWLEDGE LAYER     │                            │
│                    │   (entities, graphs,  │                            │
│                    │   embeddings, history)│                            │
│                    └───────────────────────┘                            │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Trigger Taxonomy

Engines respond to two interaction modes:

| Mode | Direction | Latency | Use Case |
|------|-----------|---------|----------|
| **Event-driven** | System → Engine → Agent | <200ms | Automatic context injection |
| **Agent-initiated** | Agent → Engine → Agent | <100ms | Active reasoning queries |

#### Event Trigger Matrix

```typescript
interface TriggerMatrix {
  // LIFECYCLE TRIGGERS (wave0 orchestration events)
  lifecycle: {
    'task:received': ['relevance.query', 'meta.checkFreshness'],
    'task:planning': ['constraint.getApplicable', 'relevance.getBlindSpots'],
    'task:executing': ['constraint.validateLive'],
    'task:completed': ['meta.recordOutcome', 'relevance.learn'],
    'task:failed': ['meta.attributeFailure', 'meta.updateReliability'],
  };

  // FILE SYSTEM TRIGGERS
  filesystem: {
    'file:modified': ['meta.markStale', 'background.scheduleReindex'],
    'file:created': ['background.scheduleIndex'],
    'file:deleted': ['meta.removeEntity', 'constraint.checkOrphans'],
  };

  // GIT TRIGGERS
  git: {
    'post-commit': ['meta.recordCommit', 'constraint.snapshotState'],
    'post-merge': ['background.fullReindex', 'constraint.detectDrift'],
    'branch:switch': ['meta.loadBranchState'],
  };

  // THRESHOLD TRIGGERS
  threshold: {
    'confidence:below:0.5': ['advisory.warnLowConfidence'],
    'staleness:above:0.7': ['background.prioritizeReindex'],
    'failures:above:3': ['advisory.suggestInvestigation'],
  };

  // SCHEDULED TRIGGERS
  scheduled: {
    'every:5m': ['meta.decayConfidence'],
    'every:1h': ['background.incrementalReindex'],
    'every:24h': ['report.generateHealthReport'],
  };
}
```

---

### Engine 1: Relevance Engine

**Question answered**: "Given intent X, what knowledge matters?"

#### Interface

```typescript
interface RelevanceEngine {
  // === SYNCHRONOUS (called during task planning, <200ms) ===

  /**
   * Primary query: Get context for a task
   */
  query(request: RelevanceRequest): Promise<RelevanceResult>;

  /**
   * Find patterns matching an intent
   */
  findPatterns(intent: string): Promise<Pattern[]>;

  /**
   * Find similar code examples
   */
  findExamples(query: string, options?: { limit?: number }): Promise<Example[]>;

  /**
   * Get blast radius for proposed changes
   */
  getBlastRadius(files: string[]): Promise<BlastRadius>;

  /**
   * Get tests that cover given files
   */
  getTestCoverage(files: string[]): Promise<TestMapping[]>;

  /**
   * Expand scope to related files
   */
  expandScope(files: string[]): Promise<string[]>;

  // === BACKGROUND (learning, not blocking) ===

  /**
   * Record what context was actually useful
   */
  recordOutcome(taskId: string, outcome: Outcome, contextUsed: string[]): void;

  /**
   * Learn negative signal (what was missing)
   */
  learnNegative(taskId: string, missingContext: string[]): void;
}

interface RelevanceRequest {
  intent: string;
  hints?: string[];              // Files agent already knows about
  budget: ContextBudget;
  urgency: 'blocking' | 'background';
}

interface ContextBudget {
  maxFiles: number;              // Agent attention limit (default: 20)
  maxTokens: number;             // LLM context limit (default: 50000)
  maxDepth: number;              // Dependency traversal depth (default: 3)
}

interface RelevanceResult {
  // Tiered by necessity, not just similarity
  tiers: {
    essential: KnowledgeItem[];  // Must read before starting
    contextual: KnowledgeItem[]; // Helpful background
    reference: KnowledgeItem[];  // Available if needed
  };

  // WHY each item is relevant
  explanations: Map<string, string>;

  // What we DON'T know but probably should
  blindSpots: BlindSpot[];

  // Overall confidence in this result
  confidence: number;
}

interface BlindSpot {
  area: string;                  // "redirect configuration"
  reason: string;                // "No indexed knowledge in src/config/"
  risk: 'low' | 'medium' | 'high';
  suggestion: string;            // "Consider reading src/config/routes.ts"
}
```

#### Agent Query Examples

```typescript
// Agent: "What do I need to know for this task?"
const context = await relevance.query({
  intent: "Add rate limiting to API endpoints",
  budget: { maxFiles: 15, maxTokens: 40000, maxDepth: 2 },
  urgency: 'blocking'
});

// Agent: "Are there patterns for this?"
const patterns = await relevance.findPatterns("rate limiting");
// Returns: [{ file: 'src/middleware/throttle.ts', type: 'middleware', usageCount: 7 }]

// Agent: "What would break if I change this?"
const blast = await relevance.getBlastRadius(['src/api/users.ts']);
// Returns: { directDependents: 5, transitiveDependents: 23, riskLevel: 'medium' }
```

#### Failure Modes

| Failure | Detection | Recovery |
|---------|-----------|----------|
| No relevant code found | `result.tiers.essential.length === 0` | Return blindSpots with suggestions |
| Too much relevant code | `totalTokens > budget.maxTokens` | Truncate by relevance score |
| Stale relevance data | `meta.freshness < 0.5` for results | Flag in result, suggest reindex |
| Wrong relevance | Historical success rate < 0.5 | Lower confidence, expand tiers |
| Timeout on large codebase | Query takes > 200ms | Return partial with warning |
| Embedding service down | API error | Fall back to keyword matching |

#### Agentic Testing Requirements

```typescript
// TEST 1: Relevance returns useful context
test('relevance.query returns context that leads to task success', async () => {
  const task = { intent: 'fix login redirect bug', files: ['src/auth/login.ts'] };
  const context = await relevance.query({ intent: task.intent, budget: DEFAULT_BUDGET, urgency: 'blocking' });

  // Execute task with context
  const outcome = await executeTaskWithContext(task, context);

  // Record outcome
  await relevance.recordOutcome(task.id, outcome, context.tiers.essential.map(k => k.id));

  // Assert: task succeeded more often with good context
  expect(outcome.success).toBe(true);
});

// TEST 2: Blind spots are accurate
test('relevance.query identifies real blind spots', async () => {
  const context = await relevance.query({
    intent: 'modify payment processing',
    budget: { maxFiles: 10, maxTokens: 20000, maxDepth: 2 },
    urgency: 'blocking'
  });

  // If there are blind spots, verify they're real gaps
  for (const blindSpot of context.blindSpots) {
    const indexed = await storage.isIndexed(blindSpot.area);
    expect(indexed).toBe(false); // Blind spot should be genuinely unindexed
  }
});

// TEST 3: Learning improves future queries
test('relevance improves after feedback', async () => {
  const intent = 'add caching to user service';

  // Query 1
  const context1 = await relevance.query({ intent, budget: DEFAULT_BUDGET, urgency: 'blocking' });

  // Simulate: agent found 'src/cache/redis.ts' was essential but not returned
  await relevance.learnNegative('task-1', ['src/cache/redis.ts']);

  // Query 2 (same intent)
  const context2 = await relevance.query({ intent, budget: DEFAULT_BUDGET, urgency: 'blocking' });

  // Assert: learned file now appears
  expect(context2.tiers.essential.some(k => k.path === 'src/cache/redis.ts')).toBe(true);
});
```

---

### Engine 2: Constraint Engine

**Question answered**: "What rules exist here, and am I breaking them?"

#### Interface

```typescript
interface ConstraintEngine {
  // === SYNCHRONOUS (validation during execution, <50ms per file) ===

  /**
   * Get constraints applicable to a scope
   */
  getApplicableConstraints(scope: string[]): Promise<Constraint[]>;

  /**
   * Preview a change before committing
   */
  previewChange(change: ProposedChange): Promise<ValidationResult>;

  /**
   * Validate a single file change (called per file during execution)
   */
  validateChange(file: string, before: string, after: string): Promise<ValidationResult>;

  /**
   * Batch validation with full explanations
   */
  validateBatch(changes: FileChange[]): Promise<BatchValidationResult>;

  /**
   * Explain why a constraint exists
   */
  explainConstraint(constraintId: string): Promise<Explanation>;

  /**
   * Request exception to a constraint
   */
  requestException(violation: Violation, reason: string): Promise<ExceptionResult>;

  /**
   * Get architectural boundaries for a file
   */
  getBoundaries(file: string): Promise<Boundary[]>;

  // === BACKGROUND ===

  /**
   * Infer constraints from codebase patterns
   */
  inferConstraints(): Promise<InferredConstraint[]>;

  /**
   * Detect drift from baseline
   */
  detectDrift(baseline: string): Promise<DriftReport>;

  /**
   * Suggest a new constraint (agent discovered pattern)
   */
  suggestConstraint(suggestion: ConstraintSuggestion): void;
}

interface Constraint {
  id: string;
  type: 'explicit' | 'inferred' | 'historical';
  rule: string;
  severity: 'error' | 'warning' | 'info';
  scope: string[];                // Which files this applies to
  confidence: number;             // How sure we are this is a real rule
  source: ConstraintSource;
}

interface ConstraintSource {
  type: 'adr' | 'eslint' | 'tsconfig' | 'pattern' | 'boundary';
  location?: string;              // File path if explicit
  evidence?: {                    // For inferred constraints
    conforming: number;
    violating: number;
  };
}

interface ValidationResult {
  violations: Violation[];
  warnings: Warning[];

  // Critical: should we block or warn?
  blocking: boolean;

  // If not blocking, why is it okay to proceed?
  proceedReason?: string;
}

interface Violation {
  constraint: Constraint;
  location: { file: string; line?: number };
  explanation: string;

  // Confidence in this being a real violation
  confidence: number;

  // For agents: concrete fix suggestion
  suggestion?: string;

  // Can this be auto-fixed?
  autoFixable: boolean;
  autoFix?: () => FileChange;
}
```

#### Constraint Sources

```typescript
interface ConstraintSources {
  // Source 1: Explicit config (works for any project)
  explicit: {
    file: '.LiBrainian/constraints.yaml',
    schema: `
      constraints:
        - rule: "Controllers don't import other controllers"
          scope: ["src/controllers/**"]
          severity: error
        - rule: "No console.log in production code"
          scope: ["src/**", "!src/**/*.test.*"]
          severity: warning
    `,
  };

  // Source 2: Existing linter configs (language-specific)
  linters: {
    eslint: '.eslintrc*',
    pylint: '.pylintrc',
    rustfmt: 'rustfmt.toml',
    golint: '.golangci.yml',
  };

  // Source 3: Inferred from patterns (language-agnostic)
  inferred: {
    importBoundaries: true,      // "A never imports B"
    namingPatterns: true,        // "Files in X follow pattern Y"
    structuralPatterns: true,    // "Directories have consistent structure"
  };

  // Source 4: Historical boundaries (what's never been done)
  historical: {
    // "src/api/ has never imported from src/cli/"
    // Confidence based on: how many opportunities existed to violate?
  };
}
```

#### Agent Query Examples

```typescript
// Agent: "What rules apply before I start?"
const constraints = await constraint.getApplicableConstraints(['src/controllers/']);
// Returns: [{ rule: "Controllers don't import other controllers", confidence: 0.95 }]

// Agent: "Would this change be okay?"
const validation = await constraint.previewChange({
  file: 'src/controllers/OrderController.ts',
  addImport: 'src/controllers/UserController.ts'
});
// Returns: { blocking: true, violations: [{ rule: '...', suggestion: 'Use service instead' }] }

// Agent: "Why does this rule exist?"
const explanation = await constraint.explainConstraint('no-controller-imports');
// Returns: { reason: 'Prevents circular dependencies', adr: 'docs/adr/002-...' }

// Agent: "I found a pattern, system should know"
await constraint.suggestConstraint({
  rule: "All API routes validate input with Zod",
  evidence: ['src/api/users.ts:12', 'src/api/orders.ts:8', 'src/api/products.ts:15'],
  confidence: 0.9
});
```

#### Failure Modes

| Failure | Detection | Recovery |
|---------|-----------|----------|
| False positive | Valid code flagged | Lower confidence, allow override |
| False negative | Violation not caught | Learn from post-hoc failures |
| Conflicting constraints | Two rules contradict | Surface conflict, require resolution |
| Stale inferred constraint | Pattern changed | Re-infer on schedule |
| Over-constraining | Blocks valid innovation | Provide exception mechanism |
| Slow validation | >50ms per file | Skip low-confidence constraints |
| Unknown file type | No parser available | Skip AST checks, use text patterns |

#### Agentic Testing Requirements

```typescript
// TEST 1: Constraints prevent known-bad patterns
test('constraint.validateChange catches known violations', async () => {
  const badChange = {
    file: 'src/controllers/OrderController.ts',
    before: 'import { UserService } from "../services/user";',
    after: 'import { UserController } from "./UserController";' // BAD
  };

  const result = await constraint.validateChange(badChange.file, badChange.before, badChange.after);

  expect(result.violations.length).toBeGreaterThan(0);
  expect(result.blocking).toBe(true);
});

// TEST 2: Inferred constraints have evidence
test('inferred constraints are statistically significant', async () => {
  const inferred = await constraint.inferConstraints();

  for (const c of inferred) {
    if (c.type === 'inferred') {
      // Must have evidence
      expect(c.source.evidence).toBeDefined();
      // Must have sufficient sample size
      expect(c.source.evidence.conforming).toBeGreaterThan(5);
      // Must have high conformance rate
      const rate = c.source.evidence.conforming /
        (c.source.evidence.conforming + c.source.evidence.violating);
      expect(rate).toBeGreaterThan(0.9);
    }
  }
});

// TEST 3: Exception mechanism works
test('agent can request exception with justification', async () => {
  const violation = {
    constraint: { id: 'no-console-log', rule: 'No console.log' },
    location: { file: 'src/debug/logger.ts', line: 42 }
  };

  const exception = await constraint.requestException(
    violation,
    'Debug utility - intentional logging'
  );

  expect(exception.granted).toBe(true);
  expect(exception.expiresAt).toBeDefined(); // Exceptions aren't permanent
});

// TEST 4: Constraint suggestions improve detection
test('suggested constraints are learned', async () => {
  // Agent discovers pattern
  await constraint.suggestConstraint({
    rule: "Database calls use transaction wrapper",
    evidence: ['src/db/users.ts:20', 'src/db/orders.ts:15'],
    confidence: 0.85
  });

  // Future validation catches violations
  const result = await constraint.validateChange(
    'src/db/products.ts',
    '',
    'await db.query("INSERT INTO products...")' // Missing transaction
  );

  expect(result.warnings.some(w => w.constraint.rule.includes('transaction'))).toBe(true);
});
```

---

### Engine 3: Meta-Knowledge Engine

**Question answered**: "How confident should I be in this knowledge?"

#### Interface

```typescript
interface MetaKnowledgeEngine {
  // === SYNCHRONOUS (qualify knowledge before use, <10ms) ===

  /**
   * Qualify knowledge items with confidence
   */
  qualify(entityIds: string[]): Promise<QualifiedKnowledge[]>;

  /**
   * Should agent proceed or wait?
   */
  shouldProceed(scope: string[]): Promise<ProceedDecision>;

  /**
   * Get confidence report for an area
   */
  getConfidence(scope: string[]): Promise<ConfidenceReport>;

  /**
   * Assess risk of working in an area
   */
  assessRisk(scope: string[]): Promise<RiskAssessment>;

  /**
   * Get blind spots in knowledge
   */
  getBlindSpots(scope: string[]): Promise<BlindSpot[]>;

  /**
   * Get past failures for similar intents
   */
  getPastFailures(intent: string): Promise<FailureHistory>;

  /**
   * Get experts for an area
   */
  getExperts(scope: string[]): Promise<Expert[]>;

  // === BACKGROUND (tracking and learning) ===

  /**
   * Record task outcome for learning
   */
  recordOutcome(outcome: TaskOutcome): void;

  /**
   * Attribute failure to causes
   */
  attributeFailure(failure: TaskFailure): Promise<Attribution>;

  /**
   * Mark entities as stale
   */
  markStale(entityIds: string[]): void;

  /**
   * Apply time-based confidence decay
   */
  applyTimeDecay(): void;

  /**
   * Request reindexing of stale areas
   */
  requestReindex(scope: string[]): Promise<{ jobId: string }>;

  /**
   * Check if thresholds crossed
   */
  checkThresholds(): Promise<ThresholdAlert[]>;
}

interface QualifiedKnowledge {
  entityId: string;

  // Three dimensions of meta-knowledge
  freshness: {
    indexedAt: Date;
    modifiedSince: boolean;
    commitsBehind: number;
    score: number;               // 0-1, higher = fresher
  };

  coverage: {
    hasEntities: boolean;
    hasRelationships: boolean;
    hasTestMapping: boolean;
    hasOwnership: boolean;
    score: number;               // 0-1, higher = more complete
  };

  reliability: {
    usageCount: number;
    successRate: number;
    lastFailure?: Date;
    trend: 'improving' | 'stable' | 'degrading';
    score: number;               // 0-1, higher = more reliable
  };

  // Combined confidence: f(freshness, coverage, reliability)
  confidence: number;
}

interface ProceedDecision {
  proceed: boolean;

  // If not proceeding, what needs to happen first?
  blockers?: Array<{
    reason: string;
    resolution: 'reindex' | 'wait' | 'manual';
    estimatedTime?: number;      // ms
  }>;

  // If proceeding with caveats
  warnings?: string[];

  // Confidence level for proceeding
  confidence: number;
}

interface ConfidenceReport {
  overall: number;               // 0-1
  dimensions: {
    freshness: number;
    coverage: number;
    reliability: number;
  };
  breakdown: Array<{
    file: string;
    confidence: number;
    issues: string[];
  }>;
  recommendations: string[];
}
```

#### Agent Query Examples

```typescript
// Agent: "How confident should I be about this area?"
const confidence = await meta.getConfidence(['src/payments/']);
// Returns: { overall: 0.4, dimensions: { freshness: 0.3, coverage: 0.5, reliability: 0.4 } }

// Agent: "Should I proceed or wait?"
const decision = await meta.shouldProceed(['src/payments/']);
// Returns: { proceed: false, blockers: [{ reason: 'Stale data', resolution: 'reindex' }] }

// Agent: "What went wrong before with similar tasks?"
const history = await meta.getPastFailures('payment processing');
// Returns: { failures: [{ task: '...', reason: 'Missing test coverage context', learnings: [...] }] }

// Agent: "I need fresher data"
const job = await meta.requestReindex(['src/payments/']);
// Agent can poll for completion or proceed with warnings
```

#### Confidence Calculation

```typescript
function calculateConfidence(entity: QualifiedKnowledge): number {
  // Weights based on empirical importance
  const WEIGHTS = {
    freshness: 0.4,    // Stale data is dangerous
    coverage: 0.3,     // Incomplete data is risky
    reliability: 0.3,  // Past failures predict future failures
  };

  return (
    entity.freshness.score * WEIGHTS.freshness +
    entity.coverage.score * WEIGHTS.coverage +
    entity.reliability.score * WEIGHTS.reliability
  );
}

function calculateFreshnessScore(entity: Entity): number {
  if (entity.modifiedSince) {
    // File changed since indexing - immediate staleness
    return 0.2;
  }

  const daysSinceIndex = (Date.now() - entity.indexedAt.getTime()) / (1000 * 60 * 60 * 24);

  // Exponential decay: half-life of 7 days
  return Math.exp(-daysSinceIndex / 7 * Math.LN2);
}

function calculateReliabilityScore(entity: Entity): number {
  if (entity.usageCount < 5) {
    // Not enough data - uncertain
    return 0.5;
  }

  // Base on success rate with recency weighting
  const recentSuccessRate = entity.recentSuccessRate;  // Last 10 uses
  const overallSuccessRate = entity.successRate;       // All time

  // Weight recent more heavily
  return 0.7 * recentSuccessRate + 0.3 * overallSuccessRate;
}
```

#### Failure Modes

| Failure | Detection | Recovery |
|---------|-----------|----------|
| Confidence miscalibration | Success rate != predicted | Recalibrate weights |
| Stale data not detected | File modified without event | Periodic full scan |
| Attribution to wrong cause | Manual review shows error | Decay attribution confidence |
| Infinite reindex loop | Same files keep reindexing | Circuit breaker (max 3/hour) |
| Race conditions | Concurrent updates | SQLite transactions + locks |
| Memory issues | History too large | Prune old data (>90 days) |
| Clock skew | Timestamps inconsistent | Use monotonic counters |

#### Agentic Testing Requirements

```typescript
// TEST 1: Confidence predicts success
test('high confidence correlates with task success', async () => {
  const tasks = await getRecentTasks(100);

  const highConfidence = tasks.filter(t => t.preConfidence > 0.8);
  const lowConfidence = tasks.filter(t => t.preConfidence < 0.4);

  const highSuccessRate = highConfidence.filter(t => t.success).length / highConfidence.length;
  const lowSuccessRate = lowConfidence.filter(t => t.success).length / lowConfidence.length;

  // High confidence should predict higher success
  expect(highSuccessRate).toBeGreaterThan(lowSuccessRate);
  expect(highSuccessRate).toBeGreaterThan(0.7);
});

// TEST 2: Staleness is accurately detected
test('meta detects file changes since indexing', async () => {
  // Index a file
  await indexFile('src/test.ts');

  // Modify file
  await writeFile('src/test.ts', '// modified');

  // Check staleness
  const qualified = await meta.qualify(['src/test.ts']);

  expect(qualified[0].freshness.modifiedSince).toBe(true);
  expect(qualified[0].freshness.score).toBeLessThan(0.5);
});

// TEST 3: Attribution uses SBFL correctly
test('failure attribution identifies suspicious packs', async () => {
  // Create pack that's used in failures
  const packId = 'pack-suspicious';
  await recordOutcome({ packId, success: false });
  await recordOutcome({ packId, success: false });
  await recordOutcome({ packId, success: false });

  // Create pack that's used in successes
  const goodPackId = 'pack-good';
  await recordOutcome({ packId: goodPackId, success: true });
  await recordOutcome({ packId: goodPackId, success: true });

  // Attribute a failure
  const attribution = await meta.attributeFailure({
    packsUsed: [packId, goodPackId],
    failureReason: 'incorrect_context'
  });

  // Should identify suspicious pack
  expect(attribution.suspiciousPacks[0].packId).toBe(packId);
  expect(attribution.suspiciousPacks[0].score).toBeGreaterThan(0.5);
});

// TEST 4: Proceed decision prevents high-risk work
test('shouldProceed blocks when knowledge is stale', async () => {
  // Mark area as stale
  await meta.markStale(['src/critical/']);

  const decision = await meta.shouldProceed(['src/critical/']);

  expect(decision.proceed).toBe(false);
  expect(decision.blockers).toContainEqual(
    expect.objectContaining({ resolution: 'reindex' })
  );
});
```

---

### Unified Agent Interface

All three engines exposed through a single, agent-friendly interface:

```typescript
interface LibrarianAgent {
  // High-level queries (agent-friendly)
  ask(question: AgentQuestion): Promise<AgentAnswer>;

  // Trigger actions
  trigger(action: AgentAction): Promise<ActionResult>;
}

type AgentQuestion =
  | { type: 'context'; intent: string; scope?: string[] }
  | { type: 'patterns'; for: string }
  | { type: 'examples'; of: string }
  | { type: 'impact'; of: string[] }
  | { type: 'allowed'; action: ProposedAction }
  | { type: 'confidence'; in: string[] }
  | { type: 'risks'; in: string[] }
  | { type: 'experts'; for: string[] }
  | { type: 'history'; similar_to: string }
  | { type: 'tests'; for: string[] }
  | { type: 'explain'; constraint: string };

type AgentAction =
  | { type: 'reindex'; scope: string[] }
  | { type: 'suggest_constraint'; rule: string; evidence: string[] }
  | { type: 'report_confusion'; area: string; details: string }
  | { type: 'request_exception'; violation: Violation; reason: string };

interface AgentAnswer {
  answer: unknown;
  confidence: number;
  reasoning: string;
  caveats: string[];
  followUp?: AgentQuestion[];
}
```

---

### Universal Project Support

Engines must work across any software project. The current implementation uses a
ParserRegistry that combines full AST parsing for TypeScript/JavaScript with
regex-based extraction for other languages.

#### Current Implementation (ParserRegistry)

```typescript
const registry = ParserRegistry.getInstance();
const result = registry.parseFile(filePath, content);

// result.parser === 'ts-morph' for TS/JS
// result.parser === 'regex' for other languages
```

**Regex coverage (implemented)**:
- Python, Go, Rust, Java/Kotlin/Scala, C/C++/C#, Ruby, PHP, Swift, shell
- Extracts function signatures + import/dependency hints
- Coverage gaps are tracked when falling back to regex

#### Graceful Degradation Matrix

| Capability | Full Support | Partial Support | Minimal Support |
|------------|--------------|-----------------|-----------------|
| **Relevance** | Call-graph aware (TS/JS AST) | Import-graph aware (regex) | Embedding-only |
| **Constraints** | AST-level rules | File-level rules | Name-based rules |
| **Meta-Knowledge** | Entity-level tracking | File-level tracking | Directory-level |

```typescript
function getCapabilityLevel(file: string): 'full' | 'partial' | 'minimal' {
  const adapter = findAdapter(file);

  if (adapter.capabilities.ast && adapter.capabilities.calls) {
    return 'full';
  } else if (adapter.capabilities.imports) {
    return 'partial';
  } else {
    return 'minimal';
  }
}
```

#### Scale Considerations

```typescript
interface ScaleProfile {
  tiny: {                        // < 100 files
    strategy: 'full index on every change',
    expectedLatency: '< 1s full reindex',
  };

  small: {                       // 100 - 1,000 files
    strategy: 'incremental index, full graph in memory',
    expectedLatency: '< 5s full, < 100ms incremental',
  };

  medium: {                      // 1,000 - 10,000 files
    strategy: 'incremental index, graph in SQLite',
    expectedLatency: '< 30s full, < 500ms incremental',
  };

  large: {                       // 10,000 - 100,000 files
    strategy: 'distributed index, query-time graph traversal',
    expectedLatency: '< 5m full, < 1s incremental',
  };

  massive: {                     // > 100,000 files
    strategy: 'partial index (hot paths only), sampling',
    expectedLatency: 'background continuous, priority-based',
  };
}
```

---

### Edge Cases and Error Handling

#### Bootstrap Edge Cases

| Situation | Behavior |
|-----------|----------|
| Empty repository | Return empty results, suggest initialization |
| Single file project | Full support, minimal graph |
| No recognized languages | Use GenericAdapter, embedding-only |
| Binary files only | Skip indexing, warn user |
| Massive single file (>1MB) | Truncate for embedding, warn |
| Circular symlinks | Detect and skip with warning |
| Git submodules | Index separately, link references |
| Monorepo | Detect packages, index in parallel |

#### Runtime Edge Cases

| Situation | Behavior |
|-----------|----------|
| File deleted during query | Return stale data with warning |
| Concurrent modifications | SQLite WAL handles, return latest |
| Embedding service timeout | Fall back to keyword matching |
| Database corruption | Rebuild from scratch, log incident |
| Out of memory | Stream processing, reduce batch size |
| Disk full | Fail gracefully, suggest cleanup |

#### Recovery Procedures

```typescript
interface RecoveryProcedure {
  // Database corruption
  rebuildDatabase(): Promise<void>;

  // Stale index
  forceFullReindex(): Promise<void>;

  // Confidence drift
  recalibrateConfidence(): Promise<void>;

  // Constraint conflicts
  resolveConflicts(): Promise<ConflictResolution[]>;
}
```

---

### Implementation Checklist for Engines

#### Phase 1: Relevance Engine

```markdown
- [ ] Implement `RelevanceEngine.query()` with tiered results
- [ ] Wire to existing `enrichTaskContext()`
- [ ] Add blind spot detection
- [ ] Implement pattern finding from module data
- [ ] Add outcome recording for learning
- [x] Write agentic tests (4 required)
```

#### Phase 2: Constraint Engine

```markdown
- [ ] Implement `.LiBrainian/constraints.yaml` parser
- [ ] Add inferred constraint detection
- [ ] Implement `previewChange()` validation
- [ ] Add historical boundary tracking
- [ ] Implement exception mechanism
- [ ] Add `suggestConstraint()` for agent discovery
- [ ] Write agentic tests (4 required)
```

#### Phase 3: Meta-Knowledge Engine

```markdown
- [x] Implement `qualify()` with three dimensions
- [x] Add `shouldProceed()` decision logic
- [x] Implement SBFL `attributeFailure()`
- [x] Add time-based confidence decay
- [x] Implement threshold alerts
- [x] Add reindex request queue
- [ ] Write agentic tests (4 required)
```

#### Phase 4: Unified Interface

```markdown
- [x] Implement `LibrarianAgent.ask()` router
- [x] Implement `LibrarianAgent.trigger()` actions
- [ ] Add event bus integration
- [ ] Wire lifecycle triggers
- [x] Add file system watchers
- [ ] Write integration tests
```

---

## Agent Implementation Guide

### Priority Order for Opus 4.5 / Codex Agents

This section provides a clear, prioritized checklist for AI agents implementing these features.

### Phase A: Quick Wins (Can implement in 1-2 tasks each)

| Task | File to Modify | Effort | Test Command |
|------|----------------|--------|--------------|
| **A1**: Add cyclomatic complexity | `knowledge/quality_metrics.ts` | Small | `npm test -- quality_metrics` |
| **A2**: Add test_mapping table | `storage/sqlite_storage.ts` | Small | `sqlite3 .LiBrainian/*.db ".tables"` |
| **A3**: Add test mapping indexer | Create `ingest/test_mapping_indexer.ts` | Small | `npm test -- test_mapping` |
| **A4**: Wire knowledge modules to query | `api/query.ts` | Small | `npm test -- query` |

### Phase B: Moderate Work (2-4 tasks each)

| Task | File to Modify | Effort | Test Command |
|------|----------------|--------|--------------|
| **B1**: Real SBFL attribution | Replace `integration/causal_attribution.ts` | Medium | `npm test -- causal` |
| **B2**: Add pack success/failure tracking | `storage/sqlite_storage.ts` | Medium | `sqlite3 .LiBrainian/*.db "SELECT * FROM librarian_context_packs"` |
| **B3**: Incremental indexer with debouncing | Create `integration/file_watcher.ts` | Medium | Manual test with file changes |
| **B4**: Commit indexer | Create `ingest/commit_indexer.ts` | Medium | `sqlite3 .LiBrainian/*.db "SELECT * FROM librarian_commits"` |

### Phase C: Larger Features (5+ tasks each)

| Task | Files | Effort | Test Command |
|------|-------|--------|--------------|
| **C1**: Ownership matrix | `ingest/ownership_indexer.ts` + storage | Large | `sqlite3 .LiBrainian/*.db "SELECT * FROM librarian_ownership"` |
| **C2**: Batch embedding generation | `graphs/embeddings.ts` | Large | Benchmark embedding time |

### Implementation Checklist Template

For each task, agents should:

```markdown
## [Task ID]: [Task Name]

### Pre-Implementation
- [ ] Read existing file(s) mentioned in the task
- [ ] Identify integration points
- [ ] Check for existing similar code to follow patterns

### Implementation
- [ ] Add schema changes (if needed) to sqlite_storage.ts
- [ ] Implement core logic
- [ ] Add to storage interface types.ts if adding new methods
- [ ] Wire into existing code (query.ts, wave0_integration.ts, etc.)

### Verification
- [ ] Run `npm run test:tier0` - must pass
- [ ] Run specific test for this feature
- [ ] Manual verification with SQLite query or script
```

### Dependencies Graph

```
G13 (queries) ← already 85% done
    └── Just wire knowledge modules

G15 (test mapping) ← prerequisite for G21
    └── G21 (failure attribution) can use test coverage data

G16 (incremental) ← standalone
    └── Improves all other features (faster reindexing)

G17 (commits) ← prerequisite for G18
    └── G18 (ownership) needs commit history

G21 (attribution) ← critical path
    └── Improves confidence system quality
```

### Phase 1 vs Phase 2 Features

Some features are correct optimizations for scale but aren't needed yet. Implement simple versions first, add complexity when measurements justify it.

#### Phase 1: Implement Now (Simple)

| Feature | Simple Approach | Why It's Sufficient |
|---------|-----------------|---------------------|
| Blast radius | On-demand BFS traversal | <10ms for depth-5 on 1000 files |
| Task batching | Jaccard similarity on file sets | File overlap is strong signal |
| Failure attribution | Ochiai SBFL formula | Research-proven, no tuning needed |
| Query caching | SQLite + simple in-memory LRU | WAL mode handles typical loads |

#### Phase 2: Add When Triggered (Advanced)

| Feature | Advanced Approach | **Trigger to Implement** |
|---------|-------------------|--------------------------|
| Transitive closure | Pre-computed table | Query latency >100ms at p95 |
| Semantic batching | Cosine similarity on embeddings | Tasks with no file overlap need grouping |
| Attribution learning | Bayesian updating with priors | >1000 task outcomes to learn from |
| Multi-layer cache | L1 memory → L2 SQLite | Cache hit rate <80% under load |

#### Phase 2 Schemas (Keep for Future)

**Transitive closure** (implement when blast radius queries slow down):
```sql
CREATE TABLE librarian_transitive_deps (
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  distance INTEGER NOT NULL,
  PRIMARY KEY (source_id, target_id)
);
-- Rebuild on schema version change, not per-file change
-- Use background job, not blocking indexing
```

**Semantic task similarity** (implement when file-based batching insufficient):
```typescript
// Don't use K-means - just cosine similarity on intent embeddings
async function findRelatedTasks(task: Task, candidates: Task[]): Promise<Task[]> {
  const taskEmbedding = await getEmbedding(task.intent);
  return candidates
    .map(c => ({ task: c, sim: cosineSimilarity(taskEmbedding, c.embedding) }))
    .filter(x => x.sim > 0.7)
    .sort((a, b) => b.sim - a.sim)
    .map(x => x.task);
}
```

#### What to Actually Skip

Only these are genuinely wrong approaches:

1. **TD(λ) eligibility traces** - Solves sequential decision problems, not fault localization. Ochiai is the correct algorithm.
2. **Full K-means clustering** - Choosing K is arbitrary, high-dimensional embeddings degrade cluster quality. Use pairwise similarity instead.

### Verification Commands

After implementing any feature:

```bash
# Tier-0 (must pass)
npm run test:tier0

# Check database schema
sqlite3 .LiBrainian/LiBrainian.db ".schema"

# Check data populated
sqlite3 .LiBrainian/LiBrainian.db "SELECT COUNT(*) FROM librarian_modules"
sqlite3 .LiBrainian/LiBrainian.db "SELECT COUNT(*) FROM librarian_functions"
sqlite3 .LiBrainian/LiBrainian.db "SELECT COUNT(*) FROM librarian_context_packs"

# Run LiBrainian tests
npm test -- src/LiBrainian
```
