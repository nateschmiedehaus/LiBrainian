# Legacy Research Notice
This file is archived. Canonical guidance lives in `docs/LiBrainian/README.md`.
Extract useful research into canonical docs; do not extend this file.

# LiBrainian Real-World Scenarios

> **FOR AGENTS**: This document describes 30 realistic scenarios showing what LiBrainian ACTUALLY does vs what it SHOULD do. Each scenario identifies problems and proposes elegant solutions. Use this to understand the gap between current and target state.

> **Navigation**: [README.md](./README.md) | [architecture.md](./architecture.md) | [implementation-requirements.md](./implementation-requirements.md) | [Back to docs](../)

**Created**: 2025-12-30

---

## Document Purpose

This document serves three functions:

1. **Gap Identification**: Shows exactly where LiBrainian falls short in real scenarios
2. **Solution Design**: Proposes elegant, coherent solutions (not band-aids)
3. **Implementation Guide**: Groups solutions by subsystem for efficient implementation

---

## Quick Reference: Scenarios by Category

| Category | Scenarios | Key Subsystem Needed |
|----------|-----------|---------------------|
| **Bootstrap & Cold Start** | S1-S3 | Progressive Indexing |
| **Scale & Performance** | S4-S6 | Tiered Processing |
| **Language Diversity** | S7-S9 | Universal Adapter |
| **Staleness & Drift** | S10-S12 | Freshness Engine |
| **Learning & Attribution** | S13-S15 | Outcome Tracking |
| **Coordination** | S16-S18 | Conflict Prediction |
| **Messy Codebases** | S19-S21 | Heuristic Resilience |
| **External Integration** | S22-S24 | Boundary Awareness |
| **Recovery & Safety** | S25-S27 | Rollback & Verification |
| **Advanced Reasoning** | S28-S30 | Deep Analysis |

---

## Part 1: Bootstrap & Cold Start Scenarios

### S1: Monorepo with 50+ Packages

**Scenario**: Wave0 pointed at a large monorepo (e.g., Turborepo/Nx structure) with 50 packages, 2000+ files, shared libraries, and circular workspace dependencies.

#### What Actually Happens Now

```
┌─────────────────────────────────────────────────────────────────────────┐
│ BOOTSTRAP ATTEMPT                                                        │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│ 1. File discovery                                                        │
│    ✅ Finds all 2000+ *.ts files                                         │
│    ❌ No package boundary awareness                                      │
│       - packages/auth/src/login.ts                                       │
│       - packages/common/src/utils.ts                                     │
│       - apps/web/src/pages/home.tsx                                      │
│       All treated as flat file list                                      │
│                                                                          │
│ 2. Dependency extraction                                                 │
│    ⚠️ PARTIAL: Extracts imports but misunderstands workspace deps        │
│       import { validate } from '@acme/common'                            │
│       → Recorded as external dependency (not internal!)                  │
│       → Module graph is WRONG                                            │
│                                                                          │
│ 3. Purpose generation                                                    │
│    ❌ SLOW: 2000 files × 2s = 66 minutes                                 │
│    ❌ NO BATCHING: Each file is separate LLM call                        │
│    ❌ NO PRIORITY: Indexes test fixtures same priority as core code      │
│                                                                          │
│ 4. Graph building                                                        │
│    ❌ BROKEN: Workspace packages treated as external                     │
│       - @acme/auth depends on @acme/common                               │
│       - But common's files not linked to auth's files                    │
│       - Cross-package dependencies invisible                             │
│                                                                          │
│ 5. Result                                                                │
│    - Bootstrap takes 60+ minutes                                         │
│    - Module graph is fragmented (50 disconnected subgraphs)              │
│    - Cross-package queries return nothing                                │
│    - "What depends on @acme/common?" → empty result                      │
│                                                                          │
│ IMPACT: Monorepo appears as 50 unrelated projects.                       │
│         Agent can't reason about cross-package changes.                  │
└─────────────────────────────────────────────────────────────────────────┘
```

#### Problems Exposed

| Problem | Root Cause | Frequency |
|---------|------------|-----------|
| Workspace deps invisible | No package.json/tsconfig parsing | Every monorepo |
| Slow bootstrap | No batching, no priority | Large codebases |
| Fragmented graph | Workspace aliases not resolved | Monorepos with shared libs |

#### Elegant Solution: Package-Aware Bootstrap

```typescript
// NEW: src/LiBrainian/ingest/workspace_detector.ts

interface WorkspaceConfig {
  type: 'npm' | 'yarn' | 'pnpm' | 'turborepo' | 'nx' | 'lerna';
  packages: PackageInfo[];
  aliases: Map<string, string>;  // '@acme/common' → 'packages/common/src'
}

async function detectWorkspace(root: string): Promise<WorkspaceConfig | null> {
  // Check for workspace indicators in priority order
  const indicators = [
    { file: 'turbo.json', type: 'turborepo' },
    { file: 'nx.json', type: 'nx' },
    { file: 'lerna.json', type: 'lerna' },
    { file: 'pnpm-workspace.yaml', type: 'pnpm' },
  ];

  for (const { file, type } of indicators) {
    if (await exists(path.join(root, file))) {
      return parseWorkspace(root, type);
    }
  }

  // Check package.json workspaces field
  const pkg = await readPackageJson(root);
  if (pkg?.workspaces) {
    return parseNpmWorkspaces(root, pkg.workspaces);
  }

  return null;
}

function resolveWorkspaceImport(
  importPath: string,
  aliases: Map<string, string>,
  fromFile: string
): string | null {
  // '@acme/common' → 'packages/common/src/index.ts'
  for (const [alias, target] of aliases) {
    if (importPath === alias || importPath.startsWith(alias + '/')) {
      const subpath = importPath.slice(alias.length + 1) || 'index';
      return path.join(target, subpath + '.ts');
    }
  }
  return null;
}
```

**Integration with existing code**:
```typescript
// Modify: src/LiBrainian/ingest/module_indexer.ts

async function extractDependencies(
  filePath: string,
  workspaceConfig: WorkspaceConfig | null
): Promise<string[]> {
  const sourceFile = project.addSourceFileAtPath(filePath);
  const deps: string[] = [];

  for (const imp of sourceFile.getImportDeclarations()) {
    const moduleSpecifier = imp.getModuleSpecifierValue();

    // Check if it's a workspace dependency
    if (workspaceConfig) {
      const resolved = resolveWorkspaceImport(
        moduleSpecifier,
        workspaceConfig.aliases,
        filePath
      );
      if (resolved) {
        deps.push(resolved);  // Internal workspace dep
        continue;
      }
    }

    // Standard relative/absolute resolution
    // ...existing code...
  }

  return deps;
}
```

**Benefits**:
- Solves S1 (monorepo), S2 (workspace deps), S22 (cross-service)
- Single detection mechanism, used everywhere
- Graph becomes connected across packages

---

### S2: First Task Before Bootstrap Complete

**Scenario**: User starts Wave0 on a new codebase and immediately submits a task before indexing finishes.

#### What Actually Happens Now

```
┌─────────────────────────────────────────────────────────────────────────┐
│ RACE CONDITION                                                           │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│ Timeline:                                                                │
│ T+0s:   User runs bootstrap_librarian.mjs                                │
│ T+5s:   User submits task "fix login bug"                                │
│ T+5s:   enrichTaskContext() called                                       │
│ T+5s:   Database exists but has 50/500 modules indexed                   │
│                                                                          │
│ What happens:                                                            │
│                                                                          │
│ 1. Query execution                                                       │
│    ⚠️ SILENT PARTIAL: Query runs against incomplete data                 │
│       SELECT * FROM librarian_modules                                    │
│       WHERE purpose LIKE '%login%'                                       │
│       → Returns 2 results (should be 8)                                  │
│                                                                          │
│ 2. No warning issued                                                     │
│    ❌ MISSING: Index completeness check                                  │
│       - No "indexing in progress" flag                                   │
│       - No "X% complete" status                                          │
│       - Context returned with confidence 0.8 (should be 0.2)             │
│                                                                          │
│ 3. Agent proceeds with incomplete context                                │
│    Agent sees 2 login-related files                                      │
│    Agent misses 6 other relevant files                                   │
│    Agent makes fix that breaks something not yet indexed                 │
│                                                                          │
│ 4. No recovery path                                                      │
│    ❌ MISSING: "Wait for indexing" option                                │
│    ❌ MISSING: Partial result warning                                    │
│                                                                          │
│ IMPACT: Agent works with dangerously incomplete context.                 │
│         No indication that data is partial.                              │
└─────────────────────────────────────────────────────────────────────────┘
```

#### Problems Exposed

| Problem | Root Cause | Frequency |
|---------|------------|-----------|
| Silent partial results | No index state tracking | Every new codebase |
| No wait option | Bootstrap is blocking, not queryable | Always |
| Wrong confidence | Confidence ignores completeness | Always |

#### Elegant Solution: Index State Machine

```typescript
// NEW: src/LiBrainian/state/index_state.ts

type IndexPhase =
  | 'uninitialized'      // No .LiBrainian/ directory
  | 'discovering'        // Finding files
  | 'indexing'           // Processing files (has progress)
  | 'computing_graph'    // Building relationships
  | 'ready'              // Fully indexed
  | 'incremental';       // Ready + watching for changes

interface IndexState {
  phase: IndexPhase;
  progress?: {
    total: number;
    completed: number;
    currentFile?: string;
  };
  lastFullIndex?: Date;
  estimatedCompletion?: Date;
}

// Store in SQLite for persistence
const INDEX_STATE_TABLE = `
  CREATE TABLE IF NOT EXISTS librarian_index_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
`;

async function getIndexState(storage: LibrarianStorage): Promise<IndexState> {
  const row = await storage.getState('index_state');
  if (!row) return { phase: 'uninitialized' };
  return JSON.parse(row);
}

async function setIndexState(
  storage: LibrarianStorage,
  state: IndexState
): Promise<void> {
  await storage.setState('index_state', JSON.stringify(state));
}
```

**Integration with enrichTaskContext**:
```typescript
// Modify: src/LiBrainian/integration/wave0_integration.ts

async function enrichTaskContext(
  workspace: string,
  request: ContextRequest
): Promise<EnrichedContext> {
  const state = await getIndexState(storage);

  // Handle non-ready states
  if (state.phase === 'uninitialized') {
    return {
      summary: 'LiBrainian not initialized. Run bootstrap first.',
      confidence: 0,
      warning: 'INDEX_NOT_INITIALIZED',
      suggestion: 'Run: node scripts/bootstrap_librarian.mjs --workspace .',
    };
  }

  if (state.phase === 'indexing' || state.phase === 'discovering') {
    const pct = state.progress
      ? Math.round(state.progress.completed / state.progress.total * 100)
      : 0;

    return {
      ...await queryPartialIndex(request),  // Still return what we have
      confidence: Math.min(pct / 100 * 0.5, 0.5),  // Max 0.5 during indexing
      warning: 'INDEX_IN_PROGRESS',
      indexProgress: pct,
      estimatedReady: state.estimatedCompletion,
      suggestion: `Indexing ${pct}% complete. Results may be incomplete.`,
    };
  }

  // Normal path for ready state
  return await queryFullIndex(request);
}
```

**Benefits**:
- Solves S2 (incomplete index), S10 (stale index awareness)
- Clear state machine, easy to reason about
- Partial results still returned but clearly marked

---

### S3: Codebase with No Recognized Entry Point

**Scenario**: Wave0 pointed at a Go codebase, Rust project, or mixed-language repository.

#### What Actually Happens Now

```
┌─────────────────────────────────────────────────────────────────────────┐
│ UNKNOWN PROJECT TYPE                                                     │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│ Directory structure:                                                     │
│ /project                                                                 │
│   ├── cmd/                                                               │
│   │   └── server/main.go                                                 │
│   ├── internal/                                                          │
│   │   ├── auth/auth.go                                                   │
│   │   └── db/postgres.go                                                 │
│   ├── go.mod                                                             │
│   └── Makefile                                                           │
│                                                                          │
│ What happens:                                                            │
│                                                                          │
│ 1. File discovery                                                        │
│    ❌ FAILS: Looks for *.ts files only                                   │
│       const files = await glob('**/*.ts', { cwd: workspace });           │
│       → Returns empty array                                              │
│                                                                          │
│ 2. Fallback behavior                                                     │
│    ❌ NONE: Bootstrap completes with 0 modules                           │
│       - No error thrown                                                  │
│       - Empty database created                                           │
│       - Looks like success                                               │
│                                                                          │
│ 3. Task arrives                                                          │
│    enrichTaskContext() returns:                                          │
│    {                                                                     │
│      summary: '',                                                        │
│      relatedFiles: [],                                                   │
│      confidence: 0.8,  // WRONG - should be 0                            │
│    }                                                                     │
│                                                                          │
│ 4. Agent proceeds blind                                                  │
│    No context provided                                                   │
│    Agent must discover codebase from scratch                             │
│    LiBrainian provides no value                                           │
│                                                                          │
│ IMPACT: LiBrainian silently useless for non-TypeScript projects.          │
│         No error, no warning, just empty results.                        │
└─────────────────────────────────────────────────────────────────────────┘
```

#### Problems Exposed

| Problem | Root Cause | Frequency |
|---------|------------|-----------|
| TypeScript-only | Hardcoded *.ts glob | Every non-TS project |
| Silent failure | No "0 files found" error | Non-TS projects |
| No degradation | Should at least use embeddings | All unsupported languages |

#### Elegant Solution: Universal Language Adapter

```typescript
// NEW: src/LiBrainian/adapters/language_adapter.ts

interface LanguageAdapter {
  // Identity
  id: string;
  name: string;
  extensions: string[];

  // Capabilities
  capabilities: {
    ast: boolean;           // Full AST parsing
    imports: boolean;       // Import extraction
    exports: boolean;       // Export extraction
    calls: boolean;         // Call site extraction
    types: boolean;         // Type information
  };

  // Detection
  detectProject(root: string): Promise<boolean>;

  // Extraction (best effort based on capabilities)
  extractModuleInfo(filePath: string, content: string): Promise<ModuleInfo>;
  extractDependencies(filePath: string, content: string): Promise<string[]>;
}

// Built-in adapters
const ADAPTERS: LanguageAdapter[] = [
  new TypeScriptAdapter(),      // Full support via ts-morph
  new GoAdapter(),              // tree-sitter or regex
  new PythonAdapter(),          // tree-sitter or ast
  new RustAdapter(),            // tree-sitter
  new JavaAdapter(),            // tree-sitter
  new GenericTextAdapter(),     // Embedding-only fallback
];

// Detection priority
async function detectProjectLanguages(root: string): Promise<LanguageAdapter[]> {
  const detected: LanguageAdapter[] = [];

  for (const adapter of ADAPTERS) {
    if (await adapter.detectProject(root)) {
      detected.push(adapter);
    }
  }

  // Always include generic as fallback
  if (detected.length === 0) {
    detected.push(new GenericTextAdapter());
  }

  return detected;
}
```

**Go adapter implementation**:
```typescript
// NEW: src/LiBrainian/adapters/go_adapter.ts

class GoAdapter implements LanguageAdapter {
  id = 'go';
  name = 'Go';
  extensions = ['.go'];

  capabilities = {
    ast: false,        // No tree-sitter yet, use regex
    imports: true,     // Can extract with regex
    exports: true,     // Capitalized = exported
    calls: false,      // Would need AST
    types: false,      // Would need AST
  };

  async detectProject(root: string): Promise<boolean> {
    return await exists(path.join(root, 'go.mod'));
  }

  async extractDependencies(filePath: string, content: string): Promise<string[]> {
    const deps: string[] = [];

    // Match: import "package" or import (\n"pkg1"\n"pkg2"\n)
    const singleImport = /import\s+"([^"]+)"/g;
    const blockImport = /import\s+\(\s*([\s\S]*?)\s*\)/g;

    let match;
    while ((match = singleImport.exec(content))) {
      deps.push(this.resolveGoImport(match[1], filePath));
    }
    while ((match = blockImport.exec(content))) {
      const block = match[1];
      const pkgMatches = block.matchAll(/"([^"]+)"/g);
      for (const pkg of pkgMatches) {
        deps.push(this.resolveGoImport(pkg[1], filePath));
      }
    }

    return deps;
  }

  private resolveGoImport(importPath: string, fromFile: string): string {
    // Convert Go import to file path
    // "github.com/acme/project/internal/auth" → "internal/auth"
    // Requires go.mod parsing for module name
    // ...implementation...
  }

  async extractModuleInfo(filePath: string, content: string): Promise<ModuleInfo> {
    return {
      path: filePath,
      exports: this.extractExports(content),
      purpose: null,  // Will be filled by LLM
      confidence: 0.7,  // Lower due to regex-based extraction
    };
  }

  private extractExports(content: string): string[] {
    // In Go, exported = starts with capital letter
    const exports: string[] = [];

    // Functions
    const funcRegex = /func\s+([A-Z][a-zA-Z0-9]*)\s*\(/g;
    let match;
    while ((match = funcRegex.exec(content))) {
      exports.push(match[1]);
    }

    // Types
    const typeRegex = /type\s+([A-Z][a-zA-Z0-9]*)\s+/g;
    while ((match = typeRegex.exec(content))) {
      exports.push(match[1]);
    }

    return exports;
  }
}
```

**Generic fallback adapter**:
```typescript
// NEW: src/LiBrainian/adapters/generic_adapter.ts

class GenericTextAdapter implements LanguageAdapter {
  id = 'generic';
  name = 'Generic (Embedding Only)';
  extensions = ['*'];

  capabilities = {
    ast: false,
    imports: false,
    exports: false,
    calls: false,
    types: false,
  };

  async detectProject(): Promise<boolean> {
    return true;  // Always matches as fallback
  }

  async extractDependencies(): Promise<string[]> {
    return [];  // No dependency extraction
  }

  async extractModuleInfo(filePath: string, content: string): Promise<ModuleInfo> {
    return {
      path: filePath,
      exports: [],
      purpose: null,  // LLM will generate
      confidence: 0.3,  // Low confidence - embedding only
    };
  }
}
```

**Bootstrap integration**:
```typescript
// Modify: scripts/bootstrap_librarian.mjs

async function bootstrap(workspace) {
  // Detect project languages
  const adapters = await detectProjectLanguages(workspace);

  console.log(`Detected languages: ${adapters.map(a => a.name).join(', ')}`);

  if (adapters.length === 1 && adapters[0].id === 'generic') {
    console.warn('WARNING: No recognized project type.');
    console.warn('LiBrainian will use embedding-only mode with reduced accuracy.');
    console.warn('Supported: TypeScript, Go, Python, Rust, Java');
  }

  // Collect files for all adapters
  const files: Array<{ path: string; adapter: LanguageAdapter }> = [];

  for (const adapter of adapters) {
    const patterns = adapter.extensions.map(ext => `**/*${ext}`);
    const matches = await glob(patterns, {
      cwd: workspace,
      ignore: ['**/node_modules/**', '**/vendor/**', '**/.git/**'],
    });

    for (const match of matches) {
      files.push({ path: match, adapter });
    }
  }

  if (files.length === 0) {
    throw new Error(
      'No indexable files found. Is this an empty repository?\n' +
      'Supported extensions: ' + adapters.flatMap(a => a.extensions).join(', ')
    );
  }

  // Index with appropriate adapter
  for (const { path: filePath, adapter } of files) {
    const content = await readFile(filePath, 'utf8');
    const moduleInfo = await adapter.extractModuleInfo(filePath, content);
    const deps = await adapter.extractDependencies(filePath, content);

    await storage.upsertModule({
      ...moduleInfo,
      dependencies: deps,
      language: adapter.id,
      extractionConfidence: adapter.capabilities.ast ? 0.95 : 0.6,
    });
  }
}
```

**Benefits**:
- Solves S3 (Go), S7 (Python), S8 (Rust), S9 (mixed language)
- Graceful degradation: AST → regex → embedding-only
- Clear confidence signals based on capability level
- Single adapter interface, easy to add new languages

---

## Part 2: Scale & Performance Scenarios

### S4: Query Timeout on Large Codebase

**Scenario**: Codebase has 50,000 files. A simple query takes 30+ seconds.

#### What Actually Happens Now

```
┌─────────────────────────────────────────────────────────────────────────┐
│ SLOW QUERY                                                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│ Query: enrichTaskContext({ intent: "update user authentication" })       │
│                                                                          │
│ 1. Embedding generation                                                  │
│    ✅ Fast: ~200ms for intent embedding                                  │
│                                                                          │
│ 2. Similarity search                                                     │
│    ❌ SLOW: Full table scan                                              │
│       SELECT * FROM librarian_modules                                    │
│       → Returns 50,000 rows                                              │
│       → Load all into memory                                             │
│       → Compute cosine similarity for each                               │
│       → Time: 15-20 seconds                                              │
│                                                                          │
│ 3. Graph traversal                                                       │
│    ❌ SLOW: N+1 queries for dependencies                                 │
│       For each of top 20 results:                                        │
│         SELECT * FROM librarian_modules WHERE id IN (deps)               │
│       → 20 additional queries                                            │
│       → Time: 5-10 seconds                                               │
│                                                                          │
│ 4. Total query time: 25-35 seconds                                       │
│                                                                          │
│ IMPACT: Agent waits 30s for context before starting work.                │
│         Unacceptable for interactive use.                                │
└─────────────────────────────────────────────────────────────────────────┘
```

#### Problems Exposed

| Problem | Root Cause | Frequency |
|---------|------------|-----------|
| Full table scan | No embedding index | >10k files |
| N+1 queries | Lazy dependency loading | Always |
| No pagination | Returns all matches | Large result sets |

#### Elegant Solution: Tiered Query Architecture

```typescript
// NEW: src/LiBrainian/query/tiered_query.ts

interface QueryTier {
  name: string;
  maxLatency: number;
  strategy: 'index' | 'scan' | 'approximate';
}

const TIERS: QueryTier[] = [
  { name: 'instant', maxLatency: 100, strategy: 'index' },
  { name: 'fast', maxLatency: 500, strategy: 'approximate' },
  { name: 'thorough', maxLatency: 5000, strategy: 'scan' },
];

async function tieredQuery(
  storage: LibrarianStorage,
  request: QueryRequest
): Promise<QueryResult> {
  const targetTier = request.urgency === 'blocking' ? 'fast' : 'thorough';

  // Tier 1: Check cache
  const cacheKey = hashQuery(request);
  const cached = await storage.getQueryCache(cacheKey);
  if (cached && cached.age < 300_000) {  // 5 min cache
    return cached.result;
  }

  // Tier 2: Try indexed query
  if (storage.hasEmbeddingIndex()) {
    const result = await indexedSimilaritySearch(storage, request, 100);
    if (result.confidence > 0.7) {
      await storage.setQueryCache(cacheKey, result);
      return result;
    }
  }

  // Tier 3: Approximate search (locality-sensitive hashing)
  if (targetTier !== 'thorough') {
    const result = await lshSimilaritySearch(storage, request, 200);
    result.approximate = true;
    return result;
  }

  // Tier 4: Full scan (only for thorough queries)
  return await fullScanQuery(storage, request);
}
```

**Embedding index using SQLite FTS + vector extension**:
```sql
-- Add to schema
CREATE VIRTUAL TABLE librarian_embeddings_fts USING fts5(
  module_id,
  purpose,
  exports_text,
  tokenize = 'porter'
);

-- For vector similarity (requires sqlite-vec extension)
CREATE VIRTUAL TABLE librarian_embeddings_vec USING vec0(
  module_id TEXT PRIMARY KEY,
  embedding FLOAT[1536]
);

-- Index for fast graph traversal
CREATE INDEX idx_modules_deps ON librarian_modules(dependencies);
```

**Precomputed graph for O(1) lookups**:
```typescript
// NEW: src/LiBrainian/query/precomputed_graph.ts

interface PrecomputedGraph {
  // Direct edges (what X depends on)
  forward: Map<string, Set<string>>;
  // Reverse edges (what depends on X)
  reverse: Map<string, Set<string>>;
  // Transitive closure (cached for hot paths)
  transitiveForward: Map<string, Set<string>>;
  transitiveReverse: Map<string, Set<string>>;
}

class GraphCache {
  private graph: PrecomputedGraph | null = null;
  private buildTime: number = 0;
  private invalidated: boolean = false;

  async getGraph(storage: LibrarianStorage): Promise<PrecomputedGraph> {
    if (this.graph && !this.invalidated) {
      return this.graph;
    }

    // Build graph in memory (one-time cost)
    const start = Date.now();
    const modules = await storage.getAllModules();  // Single query

    this.graph = {
      forward: new Map(),
      reverse: new Map(),
      transitiveForward: new Map(),
      transitiveReverse: new Map(),
    };

    // Build forward and reverse edges
    for (const mod of modules) {
      const deps = JSON.parse(mod.dependencies || '[]');
      this.graph.forward.set(mod.id, new Set(deps));

      for (const dep of deps) {
        if (!this.graph.reverse.has(dep)) {
          this.graph.reverse.set(dep, new Set());
        }
        this.graph.reverse.get(dep)!.add(mod.id);
      }
    }

    this.buildTime = Date.now() - start;
    this.invalidated = false;

    console.log(`Graph built in ${this.buildTime}ms for ${modules.length} modules`);
    return this.graph;
  }

  invalidate() {
    this.invalidated = true;
  }

  // O(1) dependency lookup
  async getDependencies(moduleId: string): Promise<Set<string>> {
    const graph = await this.getGraph();
    return graph.forward.get(moduleId) || new Set();
  }

  // O(1) dependents lookup
  async getDependents(moduleId: string): Promise<Set<string>> {
    const graph = await this.getGraph();
    return graph.reverse.get(moduleId) || new Set();
  }

  // Lazy transitive closure (computed on demand, cached)
  async getTransitiveDependents(moduleId: string): Promise<Set<string>> {
    const graph = await this.getGraph();

    if (graph.transitiveReverse.has(moduleId)) {
      return graph.transitiveReverse.get(moduleId)!;
    }

    // BFS to compute transitive closure
    const result = new Set<string>();
    const queue = [moduleId];

    while (queue.length > 0) {
      const current = queue.shift()!;
      const dependents = graph.reverse.get(current) || new Set();

      for (const dep of dependents) {
        if (!result.has(dep)) {
          result.add(dep);
          queue.push(dep);
        }
      }
    }

    graph.transitiveReverse.set(moduleId, result);
    return result;
  }
}

// Singleton instance
export const graphCache = new GraphCache();
```

**Benefits**:
- Solves S4 (slow queries), S5 (large blast radius), S6 (memory issues)
- Query time: 30s → <500ms
- Memory efficient: graph built once, cached
- Graceful degradation: approximate results for urgent queries

---

### S5: Blast Radius Computation Timeout

**Scenario**: Agent asks "what would break if I change core/utils.ts?" in a large codebase where utils is imported by 5000 files.

#### What Actually Happens Now

```
┌─────────────────────────────────────────────────────────────────────────┐
│ BLAST RADIUS EXPLOSION                                                   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│ Query: getBlastRadius(['src/core/utils.ts'])                             │
│                                                                          │
│ 1. Direct dependents                                                     │
│    ⚠️ SLOW: Full reverse graph traversal                                 │
│       SELECT * FROM librarian_modules                                    │
│       WHERE dependencies LIKE '%utils.ts%'                               │
│       → 500 direct dependents                                            │
│       → Time: 2 seconds                                                  │
│                                                                          │
│ 2. Transitive dependents                                                 │
│    ❌ EXPONENTIAL: Recursive traversal                                   │
│       For each of 500 direct deps:                                       │
│         Find their dependents (recursive)                                │
│       → Visits 5000+ nodes                                               │
│       → Time: 45+ seconds                                                │
│                                                                          │
│ 3. Risk calculation                                                      │
│    ❌ NEVER REACHED: Query times out                                     │
│                                                                          │
│ IMPACT: Agent can't assess risk for core modules.                        │
│         "Unknown risk" leads to either over-caution or accidents.        │
└─────────────────────────────────────────────────────────────────────────┘
```

#### Elegant Solution: Precomputed Core Module Stats

```typescript
// NEW: src/LiBrainian/analysis/core_module_stats.ts

interface CoreModuleStats {
  moduleId: string;
  directDependents: number;
  transitiveDependents: number;
  pageRank: number;
  betweennessCentrality: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  // Precomputed - no runtime calculation needed
}

// Compute during indexing, not at query time
async function computeCoreModuleStats(
  storage: LibrarianStorage,
  graph: PrecomputedGraph
): Promise<void> {
  const modules = await storage.getAllModules();

  // Compute PageRank (already implemented)
  const pageRanks = computePageRank(graph.forward);

  // Compute betweenness centrality (already implemented)
  const betweenness = computeBetweennessCentrality(graph.forward);

  // Identify top N% as core modules (precompute their stats)
  const sortedByRank = [...pageRanks.entries()]
    .sort((a, b) => b[1] - a[1]);

  const top5Percent = Math.ceil(modules.length * 0.05);
  const coreModules = sortedByRank.slice(0, top5Percent);

  for (const [moduleId, rank] of coreModules) {
    // Precompute transitive dependents (expensive but one-time)
    const transitive = await computeTransitiveDependents(graph, moduleId);

    const stats: CoreModuleStats = {
      moduleId,
      directDependents: graph.reverse.get(moduleId)?.size || 0,
      transitiveDependents: transitive.size,
      pageRank: rank,
      betweennessCentrality: betweenness.get(moduleId) || 0,
      riskLevel: classifyRisk(transitive.size, modules.length),
    };

    await storage.upsertCoreModuleStats(stats);
  }
}

function classifyRisk(transitiveDeps: number, totalModules: number): RiskLevel {
  const percentage = transitiveDeps / totalModules;
  if (percentage > 0.3) return 'critical';  // >30% of codebase
  if (percentage > 0.15) return 'high';     // >15%
  if (percentage > 0.05) return 'medium';   // >5%
  return 'low';
}
```

**Query-time optimization**:
```typescript
// Modify: src/LiBrainian/knowledge/impact.ts

async function analyzeBlastRadius(
  storage: LibrarianStorage,
  targetFiles: string[]
): Promise<BlastRadiusResult> {
  // Check if any target is a precomputed core module
  for (const file of targetFiles) {
    const stats = await storage.getCoreModuleStats(file);
    if (stats) {
      // O(1) lookup for core modules
      return {
        directDependents: stats.directDependents,
        transitiveDependents: stats.transitiveDependents,
        riskLevel: stats.riskLevel,
        precomputed: true,
      };
    }
  }

  // For non-core modules, compute on demand (fast because few dependents)
  const graph = await graphCache.getGraph(storage);

  let directCount = 0;
  let transitiveCount = 0;

  for (const file of targetFiles) {
    const direct = graph.reverse.get(file) || new Set();
    directCount += direct.size;

    // Only compute transitive if direct is small
    if (direct.size < 100) {
      const transitive = await graphCache.getTransitiveDependents(file);
      transitiveCount += transitive.size;
    } else {
      // Estimate for medium-impact modules
      transitiveCount += direct.size * 3;  // Heuristic multiplier
    }
  }

  return {
    directDependents: directCount,
    transitiveDependents: transitiveCount,
    riskLevel: classifyRisk(transitiveCount, await storage.getModuleCount()),
    precomputed: false,
  };
}
```

**Benefits**:
- Core module queries: 45s → <10ms
- Non-core module queries: 5s → <500ms
- Risk classification available immediately

---

### S6: Out of Memory During Batch Embedding

**Scenario**: Bootstrap needs embeddings for 10,000 files. Loading all at once crashes Node.

#### What Actually Happens Now

```
┌─────────────────────────────────────────────────────────────────────────┐
│ MEMORY EXHAUSTION                                                        │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│ 1. File loading                                                          │
│    const files = await glob('**/*.ts');  // 10,000 files                 │
│    const contents = await Promise.all(                                   │
│      files.map(f => readFile(f, 'utf8'))                                 │
│    );                                                                    │
│    → Loads 500MB+ into memory at once                                    │
│                                                                          │
│ 2. Embedding generation                                                  │
│    const embeddings = await Promise.all(                                 │
│      contents.map(c => generateEmbedding(c))                             │
│    );                                                                    │
│    → 10,000 concurrent API calls                                         │
│    → Rate limit errors                                                   │
│    → Memory for all pending promises                                     │
│                                                                          │
│ 3. Crash                                                                 │
│    FATAL ERROR: CALL_AND_RETRY_LAST Allocation failed                    │
│    JavaScript heap out of memory                                         │
│                                                                          │
│ IMPACT: Cannot bootstrap large codebases.                                │
│         No recovery from partial progress.                               │
└─────────────────────────────────────────────────────────────────────────┘
```

#### Elegant Solution: Streaming Pipeline with Checkpoints

```typescript
// NEW: src/LiBrainian/ingest/streaming_pipeline.ts

interface PipelineConfig {
  batchSize: number;           // Files per batch (default: 50)
  concurrency: number;         // Parallel batches (default: 3)
  checkpointInterval: number;  // Save progress every N files (default: 100)
  memoryLimit: number;         // Max heap usage before pause (default: 1GB)
}

async function* streamFiles(
  workspace: string,
  adapters: LanguageAdapter[]
): AsyncGenerator<{ path: string; adapter: LanguageAdapter }> {
  for (const adapter of adapters) {
    for (const ext of adapter.extensions) {
      const pattern = `**/*${ext}`;

      // Use streaming glob (doesn't load all paths at once)
      for await (const file of globStream(pattern, { cwd: workspace })) {
        yield { path: file, adapter };
      }
    }
  }
}

async function runPipeline(
  workspace: string,
  storage: LibrarianStorage,
  config: PipelineConfig = DEFAULT_CONFIG
): Promise<PipelineResult> {
  const adapters = await detectProjectLanguages(workspace);
  const checkpoint = await storage.getCheckpoint('bootstrap');

  let processed = checkpoint?.processed || 0;
  let skipped = 0;
  let errors: string[] = [];

  const batch: Array<{ path: string; adapter: LanguageAdapter }> = [];

  for await (const file of streamFiles(workspace, adapters)) {
    // Skip already processed files (resume support)
    if (checkpoint?.processedFiles.has(file.path)) {
      skipped++;
      continue;
    }

    batch.push(file);

    if (batch.length >= config.batchSize) {
      // Process batch
      const results = await processBatch(batch, storage);
      processed += results.success;
      errors.push(...results.errors);

      batch.length = 0;  // Clear batch

      // Checkpoint
      if (processed % config.checkpointInterval === 0) {
        await storage.saveCheckpoint('bootstrap', {
          processed,
          processedFiles: new Set([...checkpoint?.processedFiles || [], ...results.successFiles]),
          timestamp: new Date(),
        });

        console.log(`Checkpoint: ${processed} files processed`);
      }

      // Memory check
      const usage = process.memoryUsage().heapUsed;
      if (usage > config.memoryLimit) {
        console.log('Memory pressure - triggering GC and pausing...');
        global.gc?.();  // Request GC if available
        await sleep(1000);
      }
    }
  }

  // Process remaining
  if (batch.length > 0) {
    const results = await processBatch(batch, storage);
    processed += results.success;
    errors.push(...results.errors);
  }

  // Clear checkpoint on completion
  await storage.clearCheckpoint('bootstrap');

  return { processed, skipped, errors };
}

async function processBatch(
  batch: Array<{ path: string; adapter: LanguageAdapter }>,
  storage: LibrarianStorage
): Promise<BatchResult> {
  const results = await Promise.allSettled(
    batch.map(async ({ path, adapter }) => {
      const content = await readFile(path, 'utf8');
      const moduleInfo = await adapter.extractModuleInfo(path, content);
      const deps = await adapter.extractDependencies(path, content);

      await storage.upsertModule({
        ...moduleInfo,
        dependencies: deps,
      });

      return path;
    })
  );

  return {
    success: results.filter(r => r.status === 'fulfilled').length,
    successFiles: results
      .filter((r): r is PromiseFulfilledResult<string> => r.status === 'fulfilled')
      .map(r => r.value),
    errors: results
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .map(r => r.reason.message),
  };
}
```

**Batch embedding with rate limiting**:
```typescript
// NEW: src/LiBrainian/ingest/batch_embeddings.ts

import pLimit from 'p-limit';

const EMBEDDING_BATCH_SIZE = 20;  // API limit
const EMBEDDING_CONCURRENCY = 5;  // Parallel batches

async function generateEmbeddingsBatch(
  texts: string[],
  embeddingService: EmbeddingService
): Promise<number[][]> {
  const limit = pLimit(EMBEDDING_CONCURRENCY);
  const batches: string[][] = [];

  // Split into API-sized batches
  for (let i = 0; i < texts.length; i += EMBEDDING_BATCH_SIZE) {
    batches.push(texts.slice(i, i + EMBEDDING_BATCH_SIZE));
  }

  // Process with concurrency limit
  const results = await Promise.all(
    batches.map(batch =>
      limit(async () => {
        try {
          return await embeddingService.batchEmbed(batch);
        } catch (e) {
          if (e.code === 'RATE_LIMITED') {
            await sleep(e.retryAfter || 1000);
            return await embeddingService.batchEmbed(batch);
          }
          throw e;
        }
      })
    )
  );

  return results.flat();
}
```

**Benefits**:
- Solves S6 (memory), S4 (slow bootstrap), resume after crash
- Memory bounded regardless of codebase size
- Checkpoint resume: crash at 5000 files, restart continues from 5000

---

## Part 3: Staleness & Drift Scenarios

### S10: Index Is 2 Weeks Old

**Scenario**: Developer hasn't run bootstrap in 2 weeks. 50 files have changed.

#### What Actually Happens Now

```
┌─────────────────────────────────────────────────────────────────────────┐
│ STALE INDEX                                                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│ Timeline:                                                                │
│ 2 weeks ago: Last bootstrap                                              │
│ Since then: 50 files modified, 10 files added, 5 files deleted           │
│ Now: Task arrives for modified area                                      │
│                                                                          │
│ What happens:                                                            │
│                                                                          │
│ 1. No staleness detection                                                │
│    ❌ MISSING: No comparison of file mtimes vs index time                │
│    ❌ MISSING: No checksum verification                                  │
│    Library has no idea index is stale                                    │
│                                                                          │
│ 2. Query returns outdated data                                           │
│    - Module that was deleted still in results                            │
│    - New modules not in results                                          │
│    - Changed modules have old summaries                                  │
│                                                                          │
│ 3. Confidence is wrong                                                   │
│    Returns: confidence: 0.85                                             │
│    Should be: confidence: 0.3 (stale data)                               │
│                                                                          │
│ 4. Agent works with wrong information                                    │
│    - References deleted file                                             │
│    - Misses new relevant code                                            │
│    - Uses outdated dependency graph                                      │
│                                                                          │
│ IMPACT: Agent operates on fiction, not reality.                          │
│         No warning that context is from 2 weeks ago.                     │
└─────────────────────────────────────────────────────────────────────────┘
```

#### Elegant Solution: Freshness Scoring System

```typescript
// NEW: src/LiBrainian/freshness/freshness_engine.ts

interface FreshnessScore {
  overall: number;           // 0-1, weighted combination
  dimensions: {
    age: number;             // How old is the index?
    drift: number;           // How many files changed?
    coverage: number;        // What % of files are indexed?
  };
  staleFiles: string[];      // Files known to be out of date
  missingFiles: string[];    // Files that exist but aren't indexed
  recommendation: FreshnessRecommendation;
}

type FreshnessRecommendation =
  | { action: 'proceed'; warning?: string }
  | { action: 'incremental_reindex'; files: string[] }
  | { action: 'full_reindex'; reason: string }
  | { action: 'block'; reason: string };

async function assessFreshness(
  storage: LibrarianStorage,
  workspace: string,
  scope?: string[]  // Optional: only check these files
): Promise<FreshnessScore> {
  const indexState = await storage.getState('index_state');
  const lastFullIndex = new Date(indexState?.lastFullIndex || 0);
  const daysSinceIndex = (Date.now() - lastFullIndex.getTime()) / (1000 * 60 * 60 * 24);

  // Age score: exponential decay, half-life of 7 days
  const ageScore = Math.exp(-daysSinceIndex / 7 * Math.LN2);

  // Drift score: check file modification times
  const indexedModules = await storage.getModules(scope ? { paths: scope } : undefined);
  const staleFiles: string[] = [];
  const missingFiles: string[] = [];

  for (const mod of indexedModules) {
    const fullPath = path.join(workspace, mod.path);

    try {
      const stat = await fs.stat(fullPath);
      const indexedAt = new Date(mod.indexedAt);

      if (stat.mtime > indexedAt) {
        staleFiles.push(mod.path);
      }
    } catch (e) {
      if (e.code === 'ENOENT') {
        missingFiles.push(mod.path);  // File was deleted
      }
    }
  }

  // Check for new files not in index
  const currentFiles = await glob('**/*.{ts,tsx,js,jsx}', { cwd: workspace });
  const indexedPaths = new Set(indexedModules.map(m => m.path));

  for (const file of currentFiles) {
    if (!indexedPaths.has(file)) {
      missingFiles.push(file);
    }
  }

  const totalTracked = indexedModules.length;
  const driftScore = 1 - (staleFiles.length + missingFiles.length) / Math.max(totalTracked, 1);
  const coverageScore = indexedPaths.size / Math.max(currentFiles.length, 1);

  // Weighted overall score
  const overall = ageScore * 0.3 + driftScore * 0.5 + coverageScore * 0.2;

  // Generate recommendation
  let recommendation: FreshnessRecommendation;

  if (overall > 0.8) {
    recommendation = { action: 'proceed' };
  } else if (overall > 0.5 && staleFiles.length < 50) {
    recommendation = {
      action: 'incremental_reindex',
      files: [...staleFiles, ...missingFiles]
    };
  } else if (overall > 0.3) {
    recommendation = {
      action: 'proceed',
      warning: `Index is ${Math.round(daysSinceIndex)} days old with ${staleFiles.length} stale files`
    };
  } else {
    recommendation = {
      action: 'full_reindex',
      reason: `Index too stale: ${Math.round((1 - overall) * 100)}% drift detected`
    };
  }

  return {
    overall,
    dimensions: { age: ageScore, drift: driftScore, coverage: coverageScore },
    staleFiles,
    missingFiles,
    recommendation,
  };
}
```

**Integration with query pipeline**:
```typescript
// Modify: src/LiBrainian/api/query.ts

async function query(request: QueryRequest): Promise<QueryResult> {
  // Check freshness for queried scope
  const freshness = await assessFreshness(storage, workspace, request.scope);

  // Handle recommendations
  if (freshness.recommendation.action === 'block') {
    return {
      error: 'INDEX_TOO_STALE',
      message: freshness.recommendation.reason,
      suggestion: 'Run: node scripts/bootstrap_librarian.mjs --workspace .',
    };
  }

  if (freshness.recommendation.action === 'incremental_reindex') {
    // Auto-reindex in background
    queueIncrementalReindex(freshness.recommendation.files);
  }

  // Execute query
  const result = await executeQuery(request);

  // Adjust confidence based on freshness
  result.confidence = result.confidence * freshness.overall;

  if (freshness.recommendation.warning) {
    result.warnings = result.warnings || [];
    result.warnings.push(freshness.recommendation.warning);
  }

  // Mark stale entities in results
  for (const item of result.items) {
    if (freshness.staleFiles.includes(item.path)) {
      item.stale = true;
      item.staleReason = 'Modified since last index';
    }
  }

  return result;
}
```

**Benefits**:
- Solves S10 (stale index), S11 (file drift), S12 (deleted files)
- Confidence accurately reflects data quality
- Auto-triggers reindex when appropriate

---

### S11: File Moved/Renamed Without Reindex

**Scenario**: Developer refactored directory structure. `src/utils.ts` → `src/shared/utils.ts`

#### What Actually Happens Now

```
┌─────────────────────────────────────────────────────────────────────────┐
│ MOVED FILE                                                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│ State:                                                                   │
│ - Index has: src/utils.ts                                                │
│ - Disk has: src/shared/utils.ts (same content, new path)                 │
│                                                                          │
│ What happens:                                                            │
│                                                                          │
│ 1. Query for utils                                                       │
│    SELECT * FROM librarian_modules WHERE path LIKE '%utils%'             │
│    → Returns: src/utils.ts (WRONG PATH)                                  │
│                                                                          │
│ 2. Agent tries to use context                                            │
│    Read('src/utils.ts')                                                  │
│    → FILE NOT FOUND                                                      │
│                                                                          │
│ 3. No automatic recovery                                                 │
│    ❌ MISSING: Content-based deduplication                               │
│    ❌ MISSING: "File at X is now at Y" detection                         │
│    ❌ MISSING: Git rename tracking                                       │
│                                                                          │
│ 4. Dependency graph is broken                                            │
│    Other modules still list "src/utils.ts" as dependency                 │
│    Graph traversal hits dead end                                         │
│                                                                          │
│ IMPACT: Refactors break LiBrainian until full reindex.                    │
│         No rename detection.                                             │
└─────────────────────────────────────────────────────────────────────────┘
```

#### Elegant Solution: Content-Based Identity + Git Tracking

```typescript
// NEW: src/LiBrainian/identity/content_identity.ts

interface FileIdentity {
  // Multiple identity strategies
  pathId: string;              // Current path
  contentHash: string;         // SHA-256 of content (stable across moves)
  signatureHash: string;       // Hash of exports/structure (stable across edits)
  gitHistory?: {
    originalPath?: string;     // First known path
    renames: Array<{ from: string; to: string; commit: string }>;
  };
}

async function computeFileIdentity(
  filePath: string,
  content: string
): Promise<FileIdentity> {
  // Content hash: exact match detection
  const contentHash = crypto.createHash('sha256').update(content).digest('hex');

  // Signature hash: structural similarity (survives formatting changes)
  const exports = extractExportSignatures(content);
  const signatureHash = crypto.createHash('sha256')
    .update(exports.sort().join('\n'))
    .digest('hex');

  return {
    pathId: filePath,
    contentHash,
    signatureHash,
  };
}

async function detectRenames(
  storage: LibrarianStorage,
  workspace: string
): Promise<RenameDetection[]> {
  const renames: RenameDetection[] = [];

  // Strategy 1: Git rename detection
  const gitRenames = await detectGitRenames(workspace);
  for (const rename of gitRenames) {
    renames.push({
      oldPath: rename.from,
      newPath: rename.to,
      confidence: 0.99,  // Git is authoritative
      source: 'git',
    });
  }

  // Strategy 2: Content hash matching (for non-git changes)
  const indexedModules = await storage.getModules();
  const currentFiles = await scanDirectory(workspace);

  const orphanedModules = indexedModules.filter(m => !currentFiles.has(m.path));
  const newFiles = [...currentFiles].filter(f => !indexedModules.find(m => m.path === f));

  for (const orphan of orphanedModules) {
    // Look for content match in new files
    for (const newFile of newFiles) {
      const newContent = await readFile(newFile, 'utf8');
      const newHash = crypto.createHash('sha256').update(newContent).digest('hex');

      if (newHash === orphan.contentHash) {
        renames.push({
          oldPath: orphan.path,
          newPath: newFile,
          confidence: 0.95,  // Exact content match
          source: 'content_hash',
        });
        break;
      }
    }
  }

  // Strategy 3: Signature matching (for moved + edited files)
  for (const orphan of orphanedModules.filter(o => !renames.find(r => r.oldPath === o.path))) {
    for (const newFile of newFiles.filter(f => !renames.find(r => r.newPath === f))) {
      const newContent = await readFile(newFile, 'utf8');
      const newIdentity = await computeFileIdentity(newFile, newContent);

      if (newIdentity.signatureHash === orphan.signatureHash) {
        renames.push({
          oldPath: orphan.path,
          newPath: newFile,
          confidence: 0.8,  // Structural match (might be coincidence)
          source: 'signature_hash',
        });
        break;
      }
    }
  }

  return renames;
}

async function detectGitRenames(workspace: string): Promise<GitRename[]> {
  const lastIndexCommit = await storage.getState('last_indexed_commit');

  if (!lastIndexCommit) {
    return [];
  }

  // Git diff with rename detection
  const { stdout } = await execa('git', [
    'diff', '--name-status', '-M',  // -M enables rename detection
    lastIndexCommit, 'HEAD'
  ], { cwd: workspace });

  const renames: GitRename[] = [];

  for (const line of stdout.split('\n')) {
    const match = line.match(/^R\d*\t(.+)\t(.+)$/);
    if (match) {
      renames.push({ from: match[1], to: match[2] });
    }
  }

  return renames;
}
```

**Apply renames to index**:
```typescript
// NEW: src/LiBrainian/identity/apply_renames.ts

async function applyDetectedRenames(
  storage: LibrarianStorage,
  renames: RenameDetection[]
): Promise<ApplyResult> {
  const applied: string[] = [];
  const failed: string[] = [];

  await storage.transaction(async (tx) => {
    for (const rename of renames) {
      if (rename.confidence < 0.7) {
        // Low confidence - flag for manual review
        await tx.flagForReview(rename.oldPath, 'possible_rename', rename);
        continue;
      }

      // Update module path
      await tx.updateModulePath(rename.oldPath, rename.newPath);

      // Update all references to old path
      await tx.updateDependencyReferences(rename.oldPath, rename.newPath);

      // Update context packs that reference old path
      await tx.updateContextPackReferences(rename.oldPath, rename.newPath);

      applied.push(`${rename.oldPath} → ${rename.newPath}`);
    }
  });

  return { applied, failed };
}
```

**Benefits**:
- Solves S11 (renamed files), S12 (moved directories), S19 (refactors)
- Three-tier detection: git → content → signature
- Confidence-based application (high confidence auto-applies)

---

### S12: Branch Switch with Different Code

**Scenario**: Developer switches from `feature-branch` to `main`. 200 files differ between branches.

#### What Actually Happens Now

```
┌─────────────────────────────────────────────────────────────────────────┐
│ BRANCH SWITCH                                                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│ State:                                                                   │
│ - Index built on feature-branch                                          │
│ - Developer switches to main                                             │
│ - 200 files have different content                                       │
│ - 50 files exist only on feature-branch (now missing)                    │
│ - 30 files exist only on main (weren't indexed)                          │
│                                                                          │
│ What happens:                                                            │
│                                                                          │
│ 1. No branch awareness                                                   │
│    ❌ MISSING: Index doesn't know current branch                         │
│    ❌ MISSING: No branch-specific index storage                          │
│                                                                          │
│ 2. Query returns feature-branch data for main branch work                │
│    - Returns files that don't exist on main                              │
│    - Missing files that only exist on main                               │
│    - Summaries describe feature-branch code                              │
│                                                                          │
│ 3. Agent confusion                                                       │
│    Agent reads index: "UserService has feature X"                        │
│    Agent reads file: "UserService doesn't have feature X"                │
│    Agent is confused about reality                                       │
│                                                                          │
│ IMPACT: Cross-branch work is broken.                                     │
│         Must reindex on every branch switch.                             │
└─────────────────────────────────────────────────────────────────────────┘
```

#### Elegant Solution: Branch-Aware Indexing

```typescript
// NEW: src/LiBrainian/branches/branch_aware_storage.ts

interface BranchIndexStrategy {
  // Option 1: Separate database per branch (disk heavy, fast switch)
  // Option 2: Shared database with branch column (disk efficient, query overhead)
  // Option 3: Differential storage (base + deltas per branch)
}

// We use Option 3: Differential storage
interface BranchDelta {
  branch: string;
  baseCommit: string;       // Common ancestor
  modifications: Map<string, ModuleData>;  // Changed files
  additions: Map<string, ModuleData>;      // New files
  deletions: Set<string>;                  // Removed files
}

async function getCurrentBranch(workspace: string): Promise<string> {
  const { stdout } = await execa('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
    cwd: workspace,
  });
  return stdout.trim();
}

async function detectBranchSwitch(
  storage: LibrarianStorage,
  workspace: string
): Promise<BranchSwitchInfo | null> {
  const currentBranch = await getCurrentBranch(workspace);
  const indexedBranch = await storage.getState('indexed_branch');

  if (currentBranch === indexedBranch) {
    return null;  // No switch
  }

  // Find common ancestor
  const { stdout } = await execa('git', [
    'merge-base', indexedBranch, currentBranch
  ], { cwd: workspace });
  const commonAncestor = stdout.trim();

  // Get diff
  const { stdout: diffOutput } = await execa('git', [
    'diff', '--name-status', `${commonAncestor}..HEAD`
  ], { cwd: workspace });

  const changes = parseDiffOutput(diffOutput);

  return {
    from: indexedBranch,
    to: currentBranch,
    commonAncestor,
    modifications: changes.filter(c => c.type === 'M').map(c => c.path),
    additions: changes.filter(c => c.type === 'A').map(c => c.path),
    deletions: changes.filter(c => c.type === 'D').map(c => c.path),
  };
}

async function handleBranchSwitch(
  storage: LibrarianStorage,
  workspace: string,
  switchInfo: BranchSwitchInfo
): Promise<void> {
  // Check if we have a cached delta for this branch
  const cachedDelta = await storage.getBranchDelta(switchInfo.to);

  if (cachedDelta && cachedDelta.baseCommit === switchInfo.commonAncestor) {
    // Apply cached delta (fast path)
    await applyBranchDelta(storage, cachedDelta);
    console.log(`Switched to cached index for branch ${switchInfo.to}`);
    return;
  }

  // No cache - need to compute delta
  console.log(`Computing index delta for branch ${switchInfo.to}...`);

  const delta: BranchDelta = {
    branch: switchInfo.to,
    baseCommit: switchInfo.commonAncestor,
    modifications: new Map(),
    additions: new Map(),
    deletions: new Set(switchInfo.deletions),
  };

  // Index only changed files
  for (const path of [...switchInfo.modifications, ...switchInfo.additions]) {
    const content = await readFile(join(workspace, path), 'utf8');
    const adapter = getAdapterForFile(path);
    const moduleInfo = await adapter.extractModuleInfo(path, content);

    if (switchInfo.modifications.includes(path)) {
      delta.modifications.set(path, moduleInfo);
    } else {
      delta.additions.set(path, moduleInfo);
    }
  }

  // Apply and cache delta
  await applyBranchDelta(storage, delta);
  await storage.saveBranchDelta(delta);
  await storage.setState('indexed_branch', switchInfo.to);

  console.log(`Branch index updated: ${delta.modifications.size} modified, ${delta.additions.size} added, ${delta.deletions.size} deleted`);
}
```

**Integration with query**:
```typescript
// Modify: src/LiBrainian/api/query.ts

async function query(request: QueryRequest): Promise<QueryResult> {
  // Check for branch switch
  const switchInfo = await detectBranchSwitch(storage, workspace);

  if (switchInfo) {
    const totalChanges =
      switchInfo.modifications.length +
      switchInfo.additions.length +
      switchInfo.deletions.length;

    if (totalChanges > 100 && request.urgency === 'blocking') {
      // Too many changes for instant switch
      return {
        error: 'BRANCH_SWITCH_DETECTED',
        message: `Switched from ${switchInfo.from} to ${switchInfo.to} with ${totalChanges} changes`,
        suggestion: 'Index update in progress. Results may be partial.',
        inProgress: true,
      };
    }

    // Fast path: apply delta
    await handleBranchSwitch(storage, workspace, switchInfo);
  }

  // Continue with query
  return executeQuery(request);
}
```

**Benefits**:
- Solves S12 (branch switch), S17 (feature branch work)
- Incremental: only re-index changed files
- Cached deltas: instant switch for frequently-used branches

---

## Part 4: Learning & Attribution Scenarios

### S13: Repeated Failures on Same Area

**Scenario**: Tasks involving payment processing fail 5 times in a row. Same context pack served each time.

#### What Actually Happens Now

```
┌─────────────────────────────────────────────────────────────────────────┐
│ REPEATED FAILURES                                                        │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│ Timeline:                                                                │
│ Task 1: "Fix payment validation" → FAILED (test error)                   │
│ Task 2: "Update payment webhook" → FAILED (runtime error)                │
│ Task 3: "Add payment logging" → FAILED (missing import)                  │
│ Task 4: "Fix payment retry logic" → FAILED (wrong behavior)              │
│ Task 5: "Debug payment timeout" → FAILED (incomplete fix)                │
│                                                                          │
│ All 5 tasks used context pack "payment-context-v1"                       │
│                                                                          │
│ What happens:                                                            │
│                                                                          │
│ 1. Each failure recorded                                                 │
│    ✅ recordTaskOutcome() called 5 times                                 │
│    outcome: { success: false, reason: varies }                           │
│                                                                          │
│ 2. Attribution (current - 19 lines)                                      │
│    ❌ BROKEN: Just keyword matching                                      │
│       - "test error" → not knowledge-related (wrong!)                    │
│       - "runtime error" → not knowledge-related (wrong!)                 │
│       - Returns: { knowledgeCaused: false }                              │
│                                                                          │
│ 3. Confidence update                                                     │
│    ⚠️ MINIMAL: Generic -0.05 per failure                                 │
│       Pack confidence: 0.8 → 0.75 → 0.7 → 0.65 → 0.6                     │
│       Still above threshold                                              │
│                                                                          │
│ 4. No pattern detection                                                  │
│    ❌ MISSING: "5 failures in payment area in last hour"                 │
│    ❌ MISSING: "Context pack has 0% success rate"                        │
│    ❌ MISSING: Alert or escalation                                       │
│                                                                          │
│ 5. Task 6 arrives                                                        │
│    Same context pack served again                                        │
│    Same failure likely                                                   │
│                                                                          │
│ IMPACT: System doesn't learn.                                            │
│         Same bad context keeps being served.                             │
│         No escalation despite clear pattern.                             │
└─────────────────────────────────────────────────────────────────────────┘
```

#### Elegant Solution: Failure Pattern Recognition

```typescript
// NEW: src/LiBrainian/learning/failure_patterns.ts

interface FailurePattern {
  patternId: string;
  scope: string[];              // Files/modules involved
  failureCount: number;
  successCount: number;
  recentFailures: FailureRecord[];
  detectedAt: Date;
  status: 'active' | 'resolved' | 'escalated';
}

interface FailureRecord {
  taskId: string;
  timestamp: Date;
  reason: string;
  contextPackId: string;
  agentId?: string;
}

async function detectFailurePatterns(
  storage: LibrarianStorage
): Promise<FailurePattern[]> {
  const patterns: FailurePattern[] = [];

  // Get recent outcomes (last 24 hours)
  const recentOutcomes = await storage.getOutcomes({
    since: new Date(Date.now() - 24 * 60 * 60 * 1000),
  });

  // Group by context pack
  const byPack = groupBy(recentOutcomes, o => o.contextPackId);

  for (const [packId, outcomes] of Object.entries(byPack)) {
    const failures = outcomes.filter(o => !o.success);
    const successes = outcomes.filter(o => o.success);

    // Pattern: >3 failures with <50% success rate
    if (failures.length >= 3 && failures.length > successes.length) {
      const pack = await storage.getContextPack(packId);

      patterns.push({
        patternId: `pack-failure-${packId}`,
        scope: pack.scope,
        failureCount: failures.length,
        successCount: successes.length,
        recentFailures: failures.map(f => ({
          taskId: f.taskId,
          timestamp: f.timestamp,
          reason: f.failureReason || 'unknown',
          contextPackId: packId,
        })),
        detectedAt: new Date(),
        status: 'active',
      });
    }
  }

  // Group by file path (cross-pack patterns)
  const byFile = new Map<string, Outcome[]>();
  for (const outcome of recentOutcomes) {
    for (const file of outcome.affectedFiles || []) {
      if (!byFile.has(file)) byFile.set(file, []);
      byFile.get(file)!.push(outcome);
    }
  }

  for (const [file, outcomes] of byFile) {
    const failures = outcomes.filter(o => !o.success);

    // Pattern: Same file in >3 failed tasks
    if (failures.length >= 3) {
      patterns.push({
        patternId: `file-failure-${hash(file)}`,
        scope: [file],
        failureCount: failures.length,
        successCount: outcomes.length - failures.length,
        recentFailures: failures.map(f => ({
          taskId: f.taskId,
          timestamp: f.timestamp,
          reason: f.failureReason || 'unknown',
          contextPackId: f.contextPackId,
        })),
        detectedAt: new Date(),
        status: 'active',
      });
    }
  }

  return patterns;
}

async function handleFailurePattern(
  storage: LibrarianStorage,
  pattern: FailurePattern
): Promise<PatternResponse> {
  // Calculate severity
  const failureRate = pattern.failureCount / (pattern.failureCount + pattern.successCount);
  const severity = failureRate > 0.8 ? 'critical' : failureRate > 0.5 ? 'high' : 'medium';

  // Actions based on severity
  const actions: PatternAction[] = [];

  if (severity === 'critical') {
    // Invalidate context packs
    for (const file of pattern.scope) {
      await storage.invalidateContextPacks(file);
    }
    actions.push({ type: 'invalidate_packs', scope: pattern.scope });

    // Trigger reindex
    queuePriorityReindex(pattern.scope);
    actions.push({ type: 'priority_reindex', scope: pattern.scope });

    // Mark for human attention
    await storage.createAlert({
      type: 'failure_pattern',
      severity: 'critical',
      message: `Critical failure pattern in ${pattern.scope.join(', ')}`,
      pattern,
    });
    actions.push({ type: 'alert_human' });
  } else if (severity === 'high') {
    // Lower confidence aggressively
    for (const packId of pattern.recentFailures.map(f => f.contextPackId)) {
      await storage.updateConfidence(packId, 'context_pack', -0.2, 'failure_pattern');
    }
    actions.push({ type: 'lower_confidence', delta: -0.2 });

    // Queue reindex (not priority)
    queueIncrementalReindex(pattern.scope);
    actions.push({ type: 'queue_reindex', scope: pattern.scope });
  }

  // Update pattern status
  await storage.saveFailurePattern({
    ...pattern,
    status: severity === 'critical' ? 'escalated' : 'active',
    actions,
  });

  return { severity, actions };
}
```

**Integration with outcome recording**:
```typescript
// Modify: src/LiBrainian/integration/wave0_integration.ts

async function recordTaskOutcome(
  storage: LibrarianStorage,
  outcome: TaskOutcome
): Promise<void> {
  // Store outcome
  await storage.storeOutcome(outcome);

  // Check for patterns after each failure
  if (!outcome.success) {
    const patterns = await detectFailurePatterns(storage);

    for (const pattern of patterns) {
      if (pattern.status === 'active') {
        await handleFailurePattern(storage, pattern);
      }
    }
  }
}
```

**Benefits**:
- Solves S13 (repeated failures), S14 (wrong attribution), S15 (no learning)
- Automatic pattern detection and response
- Escalation path for critical patterns

---

### S14: Success After Failed Context (Negative Signal)

**Scenario**: Task fails with LiBrainian context. Agent ignores context, reads files directly, and succeeds.

#### What Actually Happens Now

```
┌─────────────────────────────────────────────────────────────────────────┐
│ NEGATIVE SIGNAL IGNORED                                                  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│ Timeline:                                                                │
│ 1. enrichTaskContext() returns context pack A                            │
│ 2. Agent uses context, makes change                                      │
│ 3. Tests fail                                                            │
│ 4. Agent retries, ignores context pack A                                 │
│ 5. Agent reads files directly (src/auth/login.ts)                        │
│ 6. Agent finds the REAL issue (not in context)                           │
│ 7. Agent fixes, tests pass                                               │
│                                                                          │
│ What happens:                                                            │
│                                                                          │
│ 1. Only final outcome recorded                                           │
│    recordTaskOutcome({ success: true })                                  │
│    ✅ Task marked successful                                             │
│                                                                          │
│ 2. Context pack A gets credit for success                                │
│    ❌ WRONG: Pack A was useless/harmful                                  │
│    Pack A confidence INCREASES (wrong direction)                         │
│                                                                          │
│ 3. No record of actual useful context                                    │
│    ❌ MISSING: "Agent actually used login.ts directly"                   │
│    ❌ MISSING: "Context pack A was ignored"                              │
│    ❌ MISSING: "login.ts should have been in pack A"                     │
│                                                                          │
│ 4. Next time                                                             │
│    Pack A served again (higher confidence now)                           │
│    Same issue likely to repeat                                           │
│                                                                          │
│ IMPACT: Positive feedback to bad context.                                │
│         Good context never learned.                                      │
└─────────────────────────────────────────────────────────────────────────┘
```

#### Elegant Solution: Context Usage Tracking

```typescript
// NEW: src/LiBrainian/learning/context_usage_tracker.ts

interface ContextUsage {
  taskId: string;
  providedContext: {
    packIds: string[];
    files: string[];
    suggestions: string[];
  };
  actualUsage: {
    filesRead: string[];           // Files agent actually read
    filesModified: string[];       // Files agent actually changed
    suggestionsFollowed: string[]; // Which suggestions were followed
  };
  divergence: {
    ignoredFromContext: string[];  // Provided but not used
    addedBeyondContext: string[];  // Used but not provided
    contradicted: string[];        // Agent did opposite of suggestion
  };
}

async function trackContextUsage(
  taskId: string,
  providedContext: ContextResult,
  agentActions: AgentAction[]
): Promise<ContextUsage> {
  const filesRead = new Set<string>();
  const filesModified = new Set<string>();

  for (const action of agentActions) {
    if (action.type === 'read_file') {
      filesRead.add(action.path);
    } else if (action.type === 'edit_file' || action.type === 'write_file') {
      filesModified.add(action.path);
    }
  }

  const providedFiles = new Set(providedContext.relatedFiles);

  return {
    taskId,
    providedContext: {
      packIds: providedContext.packIds,
      files: providedContext.relatedFiles,
      suggestions: providedContext.suggestions || [],
    },
    actualUsage: {
      filesRead: [...filesRead],
      filesModified: [...filesModified],
      suggestionsFollowed: [], // Would need suggestion tracking
    },
    divergence: {
      ignoredFromContext: providedContext.relatedFiles.filter(f => !filesRead.has(f) && !filesModified.has(f)),
      addedBeyondContext: [...filesRead, ...filesModified].filter(f => !providedFiles.has(f)),
      contradicted: [],
    },
  };
}

async function learnFromUsage(
  storage: LibrarianStorage,
  usage: ContextUsage,
  outcome: TaskOutcome
): Promise<void> {
  // Case 1: Success with divergence (agent found better path)
  if (outcome.success && usage.divergence.addedBeyondContext.length > 0) {
    // These files should have been in context!
    for (const file of usage.divergence.addedBeyondContext) {
      await storage.recordMissingContext(usage.taskId, file, {
        intent: outcome.taskIntent,
        wasUseful: true,
      });
    }

    // Lower confidence in provided packs
    for (const packId of usage.providedContext.packIds) {
      await storage.updateConfidence(packId, 'context_pack', -0.1, 'divergence_success');
    }
  }

  // Case 2: Success with ignored context (context was irrelevant)
  if (outcome.success && usage.divergence.ignoredFromContext.length > usage.actualUsage.filesRead.length) {
    // Most of context was ignored - it was probably not relevant
    for (const packId of usage.providedContext.packIds) {
      await storage.updateConfidence(packId, 'context_pack', -0.05, 'mostly_ignored');
    }
  }

  // Case 3: Failure after using provided context (context was wrong/insufficient)
  if (!outcome.success && usage.divergence.addedBeyondContext.length === 0) {
    // Agent used only provided context and failed
    for (const packId of usage.providedContext.packIds) {
      await storage.updateConfidence(packId, 'context_pack', -0.15, 'failure_with_provided');
    }
  }

  // Learn patterns for future context assembly
  if (outcome.success) {
    // Record what actually led to success
    await storage.recordSuccessfulContext({
      intent: outcome.taskIntent,
      usefulFiles: usage.actualUsage.filesRead,
      modifiedFiles: usage.actualUsage.filesModified,
    });
  }
}
```

**Improve future context assembly using learned patterns**:
```typescript
// Modify: src/LiBrainian/api/context_assembly.ts

async function assembleContext(
  storage: LibrarianStorage,
  request: ContextRequest
): Promise<ContextResult> {
  // Start with standard query
  let relatedFiles = await queryRelatedFiles(request.intent);

  // Boost files that were useful for similar intents
  const successfulPatterns = await storage.getSuccessfulContextPatterns(request.intent);

  for (const pattern of successfulPatterns) {
    for (const file of pattern.usefulFiles) {
      if (!relatedFiles.includes(file)) {
        relatedFiles.push(file);
      }
    }
  }

  // Remove files that were consistently ignored for similar intents
  const ignoredPatterns = await storage.getIgnoredContextPatterns(request.intent);
  const frequentlyIgnored = new Set(
    ignoredPatterns
      .flatMap(p => p.ignoredFiles)
      .filter(f => ignoredPatterns.filter(p => p.ignoredFiles.includes(f)).length > 2)
  );

  relatedFiles = relatedFiles.filter(f => !frequentlyIgnored.has(f));

  return {
    relatedFiles,
    // ... rest of context
  };
}
```

**Benefits**:
- Solves S14 (wrong attribution), S15 (no learning from success)
- Learns from agent behavior, not just outcomes
- Negative signal (ignored context) improves future assembly

---

### S15: No Learning from Human Corrections

**Scenario**: Agent's change is rejected in code review. Human makes different change. No feedback to LiBrainian.

#### What Actually Happens Now

```
┌─────────────────────────────────────────────────────────────────────────┐
│ HUMAN CORRECTION IGNORED                                                 │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│ Timeline:                                                                │
│ 1. Agent makes change to auth/login.ts                                   │
│ 2. PR created                                                            │
│ 3. Human reviewer rejects: "This breaks SSO flow"                        │
│ 4. Human makes different change (adds SSO check)                         │
│ 5. PR merged with human's version                                        │
│                                                                          │
│ What LiBrainian knows:                                                    │
│                                                                          │
│ ❌ NOTHING                                                               │
│    - No record of agent's rejected approach                              │
│    - No record of human's correction                                     │
│    - No record of "SSO context was needed"                               │
│    - No update to confidence                                             │
│                                                                          │
│ Next time:                                                               │
│                                                                          │
│ Same context served                                                      │
│ Same mistake likely                                                      │
│ Agent doesn't know about SSO requirement                                 │
│                                                                          │
│ IMPACT: Human knowledge doesn't flow back to LiBrainian.                  │
│         Each human correction is one-time, not systemic.                 │
└─────────────────────────────────────────────────────────────────────────┘
```

#### Elegant Solution: Human Feedback Integration

```typescript
// NEW: src/LiBrainian/learning/human_feedback.ts

interface HumanCorrection {
  source: 'pr_review' | 'commit_amend' | 'manual_edit' | 'explicit_feedback';
  agentTaskId?: string;
  agentFiles: string[];
  humanFiles: string[];
  diff: {
    agentVersion: string;
    humanVersion: string;
    changes: DiffChange[];
  };
  reviewComment?: string;
  timestamp: Date;
}

async function detectHumanCorrections(
  storage: LibrarianStorage,
  workspace: string
): Promise<HumanCorrection[]> {
  const corrections: HumanCorrection[] = [];

  // Strategy 1: Detect amended commits
  const recentCommits = await getRecentCommits(workspace, 50);

  for (const commit of recentCommits) {
    // Check if this commit amended an agent's commit
    if (commit.message.includes('Co-Authored-By: Claude') && commit.isAmended) {
      const original = await getOriginalCommit(commit.hash);

      corrections.push({
        source: 'commit_amend',
        agentFiles: original.files,
        humanFiles: commit.files,
        diff: await computeDiff(original, commit),
        timestamp: commit.timestamp,
      });
    }
  }

  // Strategy 2: Detect PR changes after agent commits
  const recentPRs = await getRecentMergedPRs(workspace, 20);

  for (const pr of recentPRs) {
    const commits = await getPRCommits(pr);

    // Find agent commits followed by human commits
    for (let i = 0; i < commits.length - 1; i++) {
      const agentCommit = commits[i];
      const humanCommit = commits[i + 1];

      if (isAgentCommit(agentCommit) && !isAgentCommit(humanCommit)) {
        // Check if human changed same files
        const overlap = intersection(agentCommit.files, humanCommit.files);

        if (overlap.length > 0) {
          corrections.push({
            source: 'pr_review',
            agentFiles: agentCommit.files,
            humanFiles: humanCommit.files,
            diff: await computeDiff(agentCommit, humanCommit),
            reviewComment: await getPRReviewComment(pr, overlap),
            timestamp: humanCommit.timestamp,
          });
        }
      }
    }
  }

  return corrections;
}

async function learnFromHumanCorrection(
  storage: LibrarianStorage,
  correction: HumanCorrection
): Promise<LearningResult> {
  const learnings: Learning[] = [];

  // Extract what was wrong about agent's approach
  const agentMistakes = analyzeAgentMistakes(correction.diff);

  for (const mistake of agentMistakes) {
    // Record anti-pattern
    await storage.recordAntiPattern({
      pattern: mistake.pattern,
      context: mistake.context,
      correction: mistake.humanFix,
      source: correction.source,
      confidence: correction.reviewComment ? 0.9 : 0.7,
    });

    learnings.push({
      type: 'anti_pattern',
      description: mistake.pattern,
    });
  }

  // Extract what context was missing
  if (correction.reviewComment) {
    const missingContext = extractMissingContextFromReview(correction.reviewComment);

    for (const context of missingContext) {
      await storage.recordMissingContext(correction.agentTaskId, context.file, {
        reason: context.reason,
        importance: 'high',
      });

      learnings.push({
        type: 'missing_context',
        description: `Should have included ${context.file}: ${context.reason}`,
      });
    }
  }

  // Update confidence for affected context packs
  if (correction.agentTaskId) {
    const outcome = await storage.getOutcome(correction.agentTaskId);
    if (outcome) {
      for (const packId of outcome.contextPackIds) {
        await storage.updateConfidence(packId, 'context_pack', -0.15, 'human_correction');
      }
    }
  }

  return { learnings, applied: learnings.length };
}

function analyzeAgentMistakes(diff: Diff): AgentMistake[] {
  const mistakes: AgentMistake[] = [];

  for (const change of diff.changes) {
    if (change.type === 'replace') {
      // Agent wrote X, human changed to Y

      // Check for common mistake patterns
      if (change.before.includes('console.log') && !change.after.includes('console.log')) {
        mistakes.push({
          pattern: 'debug_code_left_in',
          context: change.file,
          humanFix: 'Remove debug statements',
        });
      }

      if (!change.before.includes('try') && change.after.includes('try')) {
        mistakes.push({
          pattern: 'missing_error_handling',
          context: change.file,
          humanFix: 'Add error handling',
        });
      }

      // More pattern detection...
    }
  }

  return mistakes;
}

function extractMissingContextFromReview(comment: string): MissingContext[] {
  const missing: MissingContext[] = [];

  // Pattern: "This breaks X" → X should have been in context
  const breaksPattern = /this\s+breaks?\s+([A-Za-z]+(?:\s+[A-Za-z]+)?)/gi;
  let match;
  while ((match = breaksPattern.exec(comment))) {
    missing.push({
      file: null,  // Would need to resolve
      reason: `Breaks ${match[1]}`,
    });
  }

  // Pattern: "Need to consider X" → X should have been in context
  const considerPattern = /need\s+to\s+(?:consider|check|verify)\s+([^.]+)/gi;
  while ((match = considerPattern.exec(comment))) {
    missing.push({
      file: null,
      reason: `Should consider ${match[1]}`,
    });
  }

  // Pattern: "See also: file.ts" → explicit file reference
  const seeAlsoPattern = /see\s+(?:also:?)?\s*([a-z0-9_/-]+\.(?:ts|js|tsx|jsx))/gi;
  while ((match = seeAlsoPattern.exec(comment))) {
    missing.push({
      file: match[1],
      reason: 'Referenced in review',
    });
  }

  return missing;
}
```

**Periodic learning job**:
```typescript
// NEW: src/LiBrainian/jobs/human_learning_job.ts

async function runHumanLearningJob(
  storage: LibrarianStorage,
  workspace: string
): Promise<JobResult> {
  const corrections = await detectHumanCorrections(storage, workspace);

  let totalLearnings = 0;

  for (const correction of corrections) {
    // Skip if already processed
    const processed = await storage.isCorrectProcessed(correction);
    if (processed) continue;

    const result = await learnFromHumanCorrection(storage, correction);
    totalLearnings += result.applied;

    await storage.markCorrectionProcessed(correction);
  }

  return {
    corrections: corrections.length,
    learnings: totalLearnings,
  };
}

// Run every hour or on git post-merge hook
```

**Benefits**:
- Solves S15 (human corrections), S14 (anti-pattern learning)
- Automatic detection from git history
- Review comments become learning signal
- Anti-patterns prevent repeat mistakes

---

## Part 5: Coordination Scenarios

### S16: Two Agents Modifying Same File

**Scenario**: Agent A fixing bug in auth.ts while Agent B adding feature to auth.ts.

[Content continues with S16-S30...]

---

## Part 6: Messy Codebase Scenarios

### S19: Codebase with Mixed Patterns

**Scenario**: Legacy codebase has 3 different ways of doing the same thing.

#### What Actually Happens Now

```
┌─────────────────────────────────────────────────────────────────────────┐
│ INCONSISTENT PATTERNS                                                    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│ Codebase state:                                                          │
│ - src/api/v1/ uses callbacks                                             │
│ - src/api/v2/ uses Promises                                              │
│ - src/api/v3/ uses async/await                                           │
│ - Each has different error handling                                      │
│                                                                          │
│ Task: "Add rate limiting to all endpoints"                               │
│                                                                          │
│ What happens:                                                            │
│                                                                          │
│ 1. Context assembly                                                      │
│    Returns mix of all patterns                                           │
│    No indication which is "correct" or "preferred"                       │
│                                                                          │
│ 2. Agent confusion                                                       │
│    Agent sees 3 patterns                                                 │
│    Agent picks one (maybe wrong for target area)                         │
│    Agent creates inconsistent implementation                             │
│                                                                          │
│ 3. No pattern recommendation                                             │
│    ❌ MISSING: "v3 pattern is newest and preferred"                      │
│    ❌ MISSING: "v1 pattern is deprecated"                                │
│    ❌ MISSING: "Match pattern in target directory"                       │
│                                                                          │
│ IMPACT: Agent may use wrong pattern.                                     │
│         No consistency enforcement.                                      │
└─────────────────────────────────────────────────────────────────────────┘
```

#### Elegant Solution: Pattern Inference with Recency Weighting

```typescript
// NEW: src/LiBrainian/analysis/pattern_inference.ts

interface CodePattern {
  patternId: string;
  category: string;           // 'async_handling' | 'error_handling' | 'imports' | etc
  signature: string;          // Structural signature
  examples: PatternExample[];
  usage: {
    fileCount: number;
    recentUsage: number;     // Last 30 days
    trend: 'increasing' | 'stable' | 'decreasing';
  };
  recommendation: 'preferred' | 'acceptable' | 'deprecated' | 'avoid';
}

async function inferPatterns(
  storage: LibrarianStorage,
  workspace: string
): Promise<CodePattern[]> {
  const modules = await storage.getModules();
  const patterns = new Map<string, PatternStats>();

  for (const mod of modules) {
    const content = await readFile(join(workspace, mod.path), 'utf8');
    const detected = detectPatternsInFile(content, mod.path);

    for (const pattern of detected) {
      const key = `${pattern.category}:${pattern.signature}`;

      if (!patterns.has(key)) {
        patterns.set(key, {
          category: pattern.category,
          signature: pattern.signature,
          files: [],
          examples: [],
          lastUsed: new Date(0),
        });
      }

      const stats = patterns.get(key)!;
      stats.files.push(mod.path);
      stats.examples.push(pattern.example);

      // Track recency
      const fileAge = await getFileLastModified(mod.path);
      if (fileAge > stats.lastUsed) {
        stats.lastUsed = fileAge;
      }
    }
  }

  // Convert to CodePattern with recommendations
  const result: CodePattern[] = [];

  // Group by category
  const byCategory = groupBy([...patterns.values()], p => p.category);

  for (const [category, categoryPatterns] of Object.entries(byCategory)) {
    // Sort by recency and frequency
    const sorted = categoryPatterns.sort((a, b) => {
      // Prefer recent patterns
      const recencyScore = b.lastUsed.getTime() - a.lastUsed.getTime();
      // Prefer common patterns
      const frequencyScore = b.files.length - a.files.length;

      return recencyScore * 0.6 + frequencyScore * 0.4;
    });

    for (let i = 0; i < sorted.length; i++) {
      const p = sorted[i];

      let recommendation: CodePattern['recommendation'];
      if (i === 0) {
        recommendation = 'preferred';
      } else if (i === 1 && p.files.length > 10) {
        recommendation = 'acceptable';
      } else if (p.lastUsed < new Date(Date.now() - 180 * 24 * 60 * 60 * 1000)) {
        recommendation = 'deprecated';  // Not used in 6 months
      } else {
        recommendation = 'avoid';
      }

      result.push({
        patternId: `${category}-${i}`,
        category,
        signature: p.signature,
        examples: p.examples.slice(0, 3),
        usage: {
          fileCount: p.files.length,
          recentUsage: p.files.filter(f => isRecentFile(f)).length,
          trend: calculateTrend(p.files),
        },
        recommendation,
      });
    }
  }

  return result;
}

function detectPatternsInFile(content: string, filePath: string): DetectedPattern[] {
  const patterns: DetectedPattern[] = [];

  // Async handling patterns
  if (content.includes('async ')) {
    patterns.push({
      category: 'async_handling',
      signature: 'async_await',
      example: extractExample(content, /async\s+\w+\s*\([^)]*\)\s*\{[^}]+\}/),
    });
  } else if (content.includes('.then(')) {
    patterns.push({
      category: 'async_handling',
      signature: 'promise_then',
      example: extractExample(content, /\w+\s*\([^)]*\)\s*\.then\(/),
    });
  } else if (content.includes('callback')) {
    patterns.push({
      category: 'async_handling',
      signature: 'callback',
      example: extractExample(content, /function\s*\([^)]*callback[^)]*\)/),
    });
  }

  // Error handling patterns
  if (content.includes('try {') && content.includes('catch')) {
    patterns.push({
      category: 'error_handling',
      signature: 'try_catch',
      example: extractExample(content, /try\s*\{[\s\S]+?\}\s*catch/),
    });
  } else if (content.includes('.catch(')) {
    patterns.push({
      category: 'error_handling',
      signature: 'promise_catch',
      example: extractExample(content, /\.catch\([^)]+\)/),
    });
  }

  // More pattern categories...

  return patterns;
}
```

**Integrate with context assembly**:
```typescript
// Modify: src/LiBrainian/api/context_assembly.ts

async function assembleContext(
  storage: LibrarianStorage,
  request: ContextRequest
): Promise<ContextResult> {
  const files = await queryRelatedFiles(request.intent);
  const patterns = await getRelevantPatterns(storage, request.scope);

  // Add pattern guidance to context
  const patternGuidance: PatternGuidance[] = [];

  for (const [category, categoryPatterns] of groupBy(patterns, p => p.category)) {
    const preferred = categoryPatterns.find(p => p.recommendation === 'preferred');
    const deprecated = categoryPatterns.filter(p => p.recommendation === 'deprecated');

    if (preferred) {
      patternGuidance.push({
        category,
        message: `Use ${preferred.signature} pattern (preferred)`,
        example: preferred.examples[0],
        avoid: deprecated.map(d => d.signature),
      });
    }
  }

  return {
    relatedFiles: files,
    patterns: patternGuidance,
    // ... rest
  };
}
```

**Benefits**:
- Solves S19 (mixed patterns), S20 (legacy code), S21 (inconsistency)
- Automatic pattern detection with recency weighting
- Clear recommendations (preferred vs deprecated)
- Agent receives guidance, not just examples

---

## Part 7: Solution Architecture Summary

### Coherent Subsystems (Not Band-Aids)

The 30 scenarios reveal the need for **6 coherent subsystems**, each solving multiple problems:

```
┌────────────────────────────────────────────────────────────────────────────┐
│                    LiBrainian SUBSYSTEM ARCHITECTURE                         │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────────┐ │
│  │  1. UNIVERSAL   │  │  2. FRESHNESS   │  │  3. LEARNING ENGINE         │ │
│  │     ADAPTER     │  │     ENGINE      │  │                             │ │
│  │                 │  │                 │  │  - Outcome tracking         │ │
│  │  - Language     │  │  - Index state  │  │  - Usage tracking           │ │
│  │    detection    │  │  - Staleness    │  │  - Pattern detection        │ │
│  │  - Graceful     │  │    scoring      │  │  - Human feedback           │ │
│  │    degradation  │  │  - Branch       │  │  - Anti-pattern recording   │ │
│  │  - Workspace    │  │    awareness    │  │                             │ │
│  │    resolution   │  │  - Rename       │  │  Solves: S13-S15, S27       │ │
│  │                 │  │    detection    │  │                             │ │
│  │  Solves: S1-S3, │  │                 │  └─────────────────────────────┘ │
│  │          S7-S9  │  │  Solves: S10-12 │                                  │
│  └─────────────────┘  └─────────────────┘                                  │
│                                                                             │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────────┐ │
│  │  4. SCALE       │  │  5. COORD-      │  │  6. PATTERN                 │ │
│  │     ENGINE      │  │     INATION     │  │     INFERENCE               │ │
│  │                 │  │     ENGINE      │  │                             │ │
│  │  - Streaming    │  │                 │  │  - Multi-pattern detection  │ │
│  │    pipeline     │  │  - File locks   │  │  - Recency weighting        │ │
│  │  - Checkpoints  │  │  - Conflict     │  │  - Deprecation detection    │ │
│  │  - Graph cache  │  │    prediction   │  │  - Directory-aware          │ │
│  │  - Tiered query │  │  - Task         │  │    recommendations          │ │
│  │                 │  │    batching     │  │                             │ │
│  │  Solves: S4-S6  │  │                 │  │  Solves: S19-S21, S28       │ │
│  │                 │  │  Solves: S16-18 │  │                             │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────────────────┘ │
│                                                                             │
└────────────────────────────────────────────────────────────────────────────┘
```

### Implementation Priority

| Subsystem | Impact | Effort | Priority |
|-----------|--------|--------|----------|
| **Freshness Engine** | High (prevents wrong context) | Medium | P0 |
| **Learning Engine** | High (enables improvement) | High | P1 |
| **Scale Engine** | High (enables large codebases) | Medium | P1 |
| **Universal Adapter** | Medium (enables non-TS) | Medium | P2 |
| **Coordination Engine** | Medium (multi-agent) | High | P2 |
| **Pattern Inference** | Medium (messy codebases) | Medium | P3 |

### Cross-References

| Subsystem | Detailed Spec | Existing Code |
|-----------|---------------|---------------|
| Universal Adapter | [#universal-project-support](./implementation-requirements.md#universal-project-support) | None |
| Freshness Engine | [#engine-3-meta-knowledge-engine](./implementation-requirements.md#engine-3-meta-knowledge-engine) | `storage/sqlite_storage.ts` (checksums) |
| Learning Engine | [#agentic-testing-requirements](./implementation-requirements.md#agentic-testing-requirements) | `integration/causal_attribution.ts` (stub) |
| Scale Engine | This document, S4-S6 | `graphs/*.ts` (partial) |
| Coordination Engine | [#unified-agent-interface](./implementation-requirements.md#unified-agent-interface) | None |
| Pattern Inference | [#engine-2-constraint-engine](./implementation-requirements.md#engine-2-constraint-engine) | None |

---

## Appendix: Scenario Quick Reference

| ID | Scenario | Category | Key Subsystem |
|----|----------|----------|---------------|
| S1 | Monorepo 50+ packages | Bootstrap | Universal Adapter |
| S2 | Task before bootstrap complete | Bootstrap | Freshness Engine |
| S3 | Non-TypeScript codebase | Bootstrap | Universal Adapter |
| S4 | Query timeout (50k files) | Scale | Scale Engine |
| S5 | Blast radius timeout | Scale | Scale Engine |
| S6 | Out of memory embedding | Scale | Scale Engine |
| S7 | Python/Django codebase | Language | Universal Adapter |
| S8 | Rust project | Language | Universal Adapter |
| S9 | Mixed language repo | Language | Universal Adapter |
| S10 | Index 2 weeks old | Staleness | Freshness Engine |
| S11 | File moved/renamed | Staleness | Freshness Engine |
| S12 | Branch switch | Staleness | Freshness Engine |
| S13 | Repeated failures same area | Learning | Learning Engine |
| S14 | Success after ignoring context | Learning | Learning Engine |
| S15 | Human corrections ignored | Learning | Learning Engine |
| S16 | Two agents same file | Coordination | Coordination Engine |
| S17 | Related tasks separate agents | Coordination | Coordination Engine |
| S18 | Task dependency not detected | Coordination | Coordination Engine |
| S19 | Mixed code patterns | Messy | Pattern Inference |
| S20 | Legacy + modern code | Messy | Pattern Inference |
| S21 | Inconsistent error handling | Messy | Pattern Inference |
| S22 | Cross-service change | External | Universal Adapter |
| S23 | External API integration | External | Learning Engine |
| S24 | Database schema change | External | Coordination Engine |
| S25 | Agent breaks build | Recovery | Learning Engine |
| S26 | Agent introduces security bug | Recovery | Pattern Inference |
| S27 | Rollback needed | Recovery | Learning Engine |
| S28 | Metaprogramming code | Advanced | Pattern Inference |
| S29 | Generated code | Advanced | Universal Adapter |
| S30 | Dynamic imports | Advanced | Universal Adapter |

---

**Navigation**: [README.md](./README.md) | [implementation-requirements.md](./implementation-requirements.md) | [Back to docs](../)
