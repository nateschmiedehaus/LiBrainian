# LiBrainian Package Extraction Plan (Priority 0)

## Goal

Extract LiBrainian into a standalone package (`LiBrainian`) that can be used in **any agentic coding repository**, not just wave0-autopilot.

This is a **stop-the-line** priority. If extraction is incomplete, do not grow Wave0’s internal LiBrainian shim; implement changes in the LiBrainian package boundary.

Spec-system policy source:
- `docs/LiBrainian/specs/INTEGRATION_CHANGE_LIST.md` (Priority 0 section)
- `docs/LiBrainian/GATES.json` (`layer1.*` extraction gates)

## Package Structure

```
LiBrainian/
├── package.json               # Standalone package
├── tsconfig.json
├── README.md
├── AGENTS.md                  # How agents should use LiBrainian
│
├── src/
│   ├── index.ts               # Main entry point
│   │
│   ├── core/                  # Core abstractions
│   │   ├── types.ts           # Shared types
│   │   ├── storage.ts         # Storage interface
│   │   ├── config.ts          # Configuration
│   │   └── events.ts          # Event system
│   │
│   ├── api/                   # Public API
│   │   ├── LiBrainian.ts       # Main LiBrainian class
│   │   ├── query.ts           # Query interface
│   │   ├── bootstrap.ts       # Initialization
│   │   └── context.ts         # Context assembly
│   │
│   ├── adapters/              # Provider / tool adapters (CLI-only for LLM)
│   │   ├── cli_llm_service.ts # Claude/Codex CLI adapter (Wave0 policy)
│   │   ├── llm_service.ts     # Adapter interface + resolver
│   │   └── tool_adapters/     # MCP/tool bridges (filesystem/git/etc.)
│   │
│   ├── indexing/              # Code indexing
│   │   ├── ast_indexer.ts     # AST parsing
│   │   ├── semantic_indexer.ts # Semantic analysis
│   │   ├── test_indexer.ts    # Test mapping
│   │   └── file_watcher.ts    # Incremental updates
│   │
│   ├── knowledge/             # Knowledge extraction
│   │   ├── extractors/        # Domain extractors
│   │   ├── universal_types.ts # Universal knowledge schema
│   │   └── generator.ts       # Knowledge generation
│   │
│   ├── quality/               # Quality analysis
│   │   ├── issue_registry.ts  # Issue tracking
│   │   ├── issue_detector.ts  # Detection algorithms
│   │   ├── world_class.ts     # World-class standards
│   │   └── component_research.ts # Best practices
│   │
│   ├── graphs/                # Graph analysis
│   │   ├── metrics.ts         # PageRank, centrality
│   │   ├── call_graph.ts      # Call relationships
│   │   └── dependency_graph.ts # Module dependencies
│   │
│   ├── storage/               # Storage backends
│   │   ├── sqlite.ts          # SQLite implementation
│   │   ├── memory.ts          # In-memory for tests
│   │   └── migrations/        # Schema migrations
│   │
│   ├── integration/           # External integrations
│   │   ├── agent_protocol.ts  # Agent feedback
│   │   ├── mcp_server.ts      # MCP integration
│   │   └── hooks.ts           # Pre/post hooks
│   │
│   └── cli/                   # CLI commands
│       ├── index.ts           # CLI entry
│       ├── bootstrap.ts       # LiBrainian bootstrap
│       ├── query.ts           # LiBrainian query
│       └── quality.ts         # LiBrainian quality
│
├── test/
│   ├── fixtures/              # Test repos
│   └── *.test.ts
│
└── state/                     # Default state directory
    └── .gitkeep
```

## What Stays in LiBrainian (Standalone)

Everything that's **universally useful** for any codebase:

| Module | Purpose | Standalone? |
|--------|---------|-------------|
| Core types & storage | Foundation | ✅ Yes |
| AST indexing | Code parsing | ✅ Yes |
| Knowledge extraction | Understanding | ✅ Yes |
| Quality detection | Issue finding | ✅ Yes |
| Graph analysis | Importance | ✅ Yes |
| LLM adapter (CLI-only) | Intelligence | ✅ Yes |
| Embedding service (real models) | Semantic vectors | ✅ Yes |
| CLI | User interface | ✅ Yes |
| MCP server | IDE integration | ✅ Yes |

Wave0 policy reminder:
- LLM access is via authenticated CLIs (`claude`, `codex`) and the provider gate (`checkAllProviders()` / `requireProviders()`).
- Do not add API key / env key discovery to LiBrainian.

## What Stays in Wave0 (Integration Layer)

Wave0-specific integrations that use LiBrainian:

| Module | Purpose | Location |
|--------|---------|----------|
| Orchestrator integration | Task context | wave0 |
| Agent coordinator hooks | Pre/post task | wave0 |
| SCAS integration | Quality reporting | wave0 |
| Autopilot integration | End-to-end | wave0 |
| Wave0-specific config | Custom settings | wave0 |

## Shared Dependencies (Avoid New Packages Unless Proven Necessary)

Default rule: **do not introduce a new shared package** (e.g. `@wave0/core`) just to make extraction “clean”.

Prefer:
- keeping LiBrainian self-contained (duplicate tiny types if needed),
- using Wave0→LiBrainian adapter layers at the package boundary,
- extracting shared utilities only when duplication is demonstrably worse (and with Tier‑0 gates proving the boundary stays stable).

## Package.json

```json
{
  "name": "LiBrainian",
  "version": "0.1.0",
  "description": "Best-in-world code understanding for agentic software development",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "bin": {
    "LiBrainian": "dist/cli/index.js"
  },
  "exports": {
    ".": "./dist/index.js",
    "./api": "./dist/api/index.js",
    "./quality": "./dist/quality/index.js",
    "./storage": "./dist/storage/index.js",
    "./cli": "./dist/cli/index.js"
  },
  "scripts": {
    "build": "tsc",
    "test": "vitest",
    "lint": "eslint src/",
    "typecheck": "tsc --noEmit"
  },
  "peerDependencies": {
    "better-sqlite3": "^11.0.0"
  },
  "peerDependenciesMeta": {
    "better-sqlite3": { "optional": true }
  },
  "dependencies": {
    "ts-morph": "^24.0.0",
    "tree-sitter": "^0.21.0",
    "glob": "^11.0.0",
    "@xenova/transformers": "^2.17.0"
  }
}
```

## Usage After Extraction

### In Any Repository

```bash
# Install
npm install librainian

# Bootstrap
npx librainian bootstrap .

# Query
npx librainian query "Where is authentication handled?"

# Quality check
npx librainian quality --check=all
```

### As a Library

```typescript
import { createLibrarian, requireProviders } from 'librainian';

// Ensure live providers are available (Wave0 policy: CLI auth only, no API keys).
// If providers are unavailable, this MUST fail honestly.
await requireProviders({ llm: true, embedding: true });

// Initialize
const lib = await createLibrarian({
  workspace: process.cwd(),
});

// Bootstrap (first time or after major changes)
await lib.bootstrap({ mode: 'full' });

// Query
const result = await lib.query({
  intent: 'Where is authentication handled?',
  depth: 'L2',
});

// Get quality issues
const issues = await lib.getQualityIssues({
  statuses: ['open'],
  severities: ['critical', 'major'],
  limit: 20,
});

// Get research for a file
const research = await lib.getComponentResearch('src/auth/handler.ts');
```

### For Agents (via MCP)

```typescript
// MCP tools exposed by LiBrainian
const tools = [
  'librarian_query',           // Query for context
  'librarian_get_issues',      // Get quality issues
  'librarian_claim_issue',     // Claim issue to work on
  'librarian_resolve_issue',   // Mark issue resolved
  'librarian_get_research',    // Get best practices
  'librarian_submit_feedback', // Report query quality
];
```

## Migration Steps

### Phase 0: Make the boundary true (now)

Wave0 currently contains `packages/LiBrainian/`. The immediate goal is to make the package boundary *real* and stable before any major feature work.

Required evidence gates (must be green and kept green):
- `layer1.noWave0Imports`
- `layer1.noDirectImports`
- `layer1.standaloneTests`

### Phase 1: Extract to a standalone repo (mechanical move, no refactors)

1. Create the standalone repository with `packages/LiBrainian/**` as the root contents.
2. Keep the public API stable (`src/index.ts` exports) so Wave0 can consume it unchanged.
3. Ensure Tier‑0 and Tier‑2 behavior remains honest:
   - CLI auth only (no API keys)
   - no fake embeddings
   - provider-required behavior must fail closed with `unverified_by_trace(provider_unavailable)`
4. Add CI in the standalone repo that runs deterministic Tier‑0 (`npm test -- --run`) and any non-provider gates that apply.

### Phase 2: Wave0 becomes a consumer only (no internal LiBrainian logic)

1. Replace any internal Wave0 imports of LiBrainian internals with package API calls.
2. Keep `src/LiBrainian/**` as a compatibility shim only; do not add product logic there.
3. All new LiBrainian functionality is implemented in the standalone LiBrainian repo first.

## Backwards Compatibility

For wave0-autopilot, maintain compatibility:

```typescript
// wave0-autopilot/src/LiBrainian/index.ts
// Re-export everything from the package for backwards compatibility
export * from 'librainian';
export * from 'LiBrainian/api';
export * from 'LiBrainian/quality';

// Add wave0-specific extensions
export { ensureLibrarianReadyForOrchestrator } from './wave0_integration.js';
```

## Success Criteria

1. **Standalone**: `npm install librainian && npx librainian bootstrap .` works on any TypeScript repo
2. **Zero wave0 deps**: LiBrainian has no imports from wave0-autopilot
3. **Full functionality**: All current LiBrainian features work
4. **Easy adoption**: Single command to add to any repo
5. **Agent-ready**: MCP server works out of the box

## Timeline

| Phase | Work | Duration |
|-------|------|----------|
| 1. Prepare | Copy, organize, test | 1-2 sessions |
| 2. Decouple | Remove wave0 deps | 1-2 sessions |
| 3. Publish | CI/CD, npm publish | 1 session |

## Open Questions

1. **Monorepo or separate repo?**
   - Option A: `wave0-autopilot/packages/LiBrainian/` (monorepo)
   - Option B: `wave0/LiBrainian/` (separate repo)
   - Recommendation: Start with monorepo, extract later if needed

2. **LLM provider handling?**
   - Option A: Bundle providers (larger package)
   - Option B: Peer dependencies (user installs what they need)
   - Recommendation: Peer dependencies, works without LLM

3. **Storage backend?**
   - Option A: SQLite only (simpler)
   - Option B: Pluggable (SQLite, PostgreSQL, memory)
   - Recommendation: SQLite + memory, add others later
