<div align="center">

# Librarian

### The Knowledge Layer for Agentic Software Development

[![npm version](https://img.shields.io/npm/v/@wave0/librarian.svg?style=flat-square)](https://www.npmjs.com/package/@wave0/librarian)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg?style=flat-square)](https://www.typescriptlang.org/)
[![Tests](https://img.shields.io/badge/tests-3500+-passing-brightgreen.svg?style=flat-square)](#testing)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat-square)](CONTRIBUTING.md)

**Librarian** gives AI coding agents deep, evidence-backed understanding of any codebase.

> **Status**: Core infrastructure complete with 3,500+ tests passing. Validation phases in progress.
> See [CODEX_ORCHESTRATOR.md](CODEX_ORCHESTRATOR.md) for development roadmap.

[Quick Start](#quick-start) · [Documentation](docs/) · [Examples](examples/) · [API Reference](docs/api/) · [Contributing](CONTRIBUTING.md)

</div>

---

## Why Librarian?

AI coding agents are powerful, but they struggle with:

| Problem | Without Librarian | With Librarian |
|---------|-------------------|----------------|
| **Finding relevant code** | Grep/search, miss context | Semantic search with ranked results |
| **Understanding purpose** | Read and guess | Evidence-backed explanations |
| **Knowing what matters** | Treat all code equally | Importance signals (PageRank, centrality) |
| **Avoiding mistakes** | Learn from errors | Best practices & anti-patterns database |
| **Tracking quality** | Manual review | Automated issue detection & tracking |

Librarian is the **knowledge layer** that makes agents dramatically more effective.

---

## Quick Start

### Installation

```bash
npm install @wave0/librarian
```

### Bootstrap Your Codebase

```bash
# Index your codebase (run once, updates incrementally)
npx librarian bootstrap .

# Query for context
npx librarian query "Where is authentication handled?"

# Check code quality
npx librarian quality
```

### Use in Your Agent

```typescript
import { createLibrarian } from '@wave0/librarian';

const librarian = await createLibrarian({
  workspace: process.cwd(),
});

// Get context for a task
const context = await librarian.query({
  intent: 'Add rate limiting to the API',
  depth: 'L2',
});

console.log(context.summary);
// "Rate limiting should be added to src/api/middleware.ts.
//  The existing auth middleware at line 45 shows the pattern.
//  Consider using the token-bucket algorithm (see best practices)."

// Get quality issues to fix
const issues = await librarian.getIssues({ status: 'open', limit: 10 });
```

---

## Package Entry Points

Librarian is published as `@wave0/librarian` with explicit subpath exports:

```typescript
import { createLibrarian } from '@wave0/librarian';
import { queryLibrarian } from '@wave0/librarian/api';
import { detectAllIssues } from '@wave0/librarian/quality';
import { createStorageSlices } from '@wave0/librarian/storage';
```

CLI entry point:

```bash
npx librarian --help
```

---

## Features

### Semantic Code Understanding

Librarian builds a rich knowledge graph of your codebase:

```
┌─────────────────────────────────────────────────────────────────┐
│                     LIBRARIAN KNOWLEDGE GRAPH                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────┐    calls    ┌──────────┐    imports   ┌────────┐  │
│  │ Function │────────────▶│ Function │─────────────▶│ Module │  │
│  │ Purpose  │             │ Purpose  │              │ Purpose│  │
│  │ Quality  │             │ Quality  │              │ API    │  │
│  └──────────┘             └──────────┘              └────────┘  │
│       │                        │                         │      │
│       │ tested_by              │ documented_in           │      │
│       ▼                        ▼                         ▼      │
│  ┌──────────┐             ┌──────────┐              ┌────────┐  │
│  │   Test   │             │   Doc    │              │ Config │  │
│  │ Coverage │             │ Section  │              │  Keys  │  │
│  └──────────┘             └──────────┘              └────────┘  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Quality Issue Detection

Automatically detect and track code quality issues:

```bash
$ npx librarian quality

╔══════════════════════════════════════════════════════════════════╗
║                     CODE QUALITY REPORT                          ║
╠══════════════════════════════════════════════════════════════════╣
║  Critical: 3   Major: 12   Minor: 45   Info: 23                  ║
║  Total Technical Debt: ~18 hours                                 ║
╠══════════════════════════════════════════════════════════════════╣
║                                                                  ║
║  TOP ISSUES BY ROI:                                              ║
║                                                                  ║
║  1. [CRITICAL] Long method: processOrder (312 lines)             ║
║     └─ src/orders/processor.ts:45                                ║
║     └─ Fix: Extract into smaller functions                       ║
║     └─ Effort: 45min | Impact: High | ROI: 4.2                   ║
║                                                                  ║
║  2. [MAJOR] Missing error handling in API handler                ║
║     └─ src/api/users.ts:89                                       ║
║     └─ Fix: Add try/catch with proper error responses            ║
║     └─ Effort: 15min | Impact: High | ROI: 3.8                   ║
║                                                                  ║
╚══════════════════════════════════════════════════════════════════╝
```

### Best Practices Database

Built-in research and patterns for common domains:

```typescript
// Get best practices for what you're working on
const practices = await librarian.getBestPractices('authentication');

// Returns:
// - Use bcrypt/Argon2 for password hashing (essential)
// - Implement rate limiting on login (essential)
// - Use short-lived tokens with refresh (recommended)
// - Add MFA support (recommended)
```

### Agent Feedback Loop

Librarian learns from agent interactions:

```typescript
// After completing a task, report what was helpful
await librarian.submitFeedback({
  queryId: result.feedbackToken,
  helpful: ['src/auth/handler.ts', 'src/utils/crypto.ts'],
  missing: 'Could not find password reset flow',
});

// Librarian adjusts confidence and fills knowledge gaps
```

---

## Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│                         YOUR CODEBASE                              │
└─────────────────────────────────┬──────────────────────────────────┘
                                  │
                                  ▼
┌────────────────────────────────────────────────────────────────────┐
│                          LIBRARIAN                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │
│  │   Indexing   │  │   Knowledge  │  │        Quality           │  │
│  │              │  │              │  │                          │  │
│  │ • AST Parse  │  │ • Extractors │  │ • Issue Detection        │  │
│  │ • Semantic   │  │ • Synthesis  │  │ • World-Class Standards  │  │
│  │ • Incremental│  │ • Evidence   │  │ • Component Research     │  │
│  └──────────────┘  └──────────────┘  └──────────────────────────┘  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │
│  │    Graphs    │  │   Storage    │  │       Integration        │  │
│  │              │  │              │  │                          │  │
│  │ • Call Graph │  │ • SQLite     │  │ • MCP Server             │  │
│  │ • PageRank   │  │ • In-Memory  │  │ • Agent Protocol         │  │
│  │ • Centrality │  │ • Migrations │  │ • IDE Plugins            │  │
│  └──────────────┘  └──────────────┘  └──────────────────────────┘  │
└────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌────────────────────────────────────────────────────────────────────┐
│                        AI CODING AGENTS                            │
│         Claude Code · Cursor · Windsurf · Custom Agents            │
└────────────────────────────────────────────────────────────────────┘
```

---

## CLI Reference

```bash
librarian <command> [options]

Commands:
  bootstrap [path]     Index a codebase (first-time or full refresh)
  query <intent>       Query for relevant context
  quality              Analyze code quality
  issues               List and manage quality issues
  research <domain>    Get best practices for a domain
  status               Show indexing status
  serve                Start MCP server for IDE integration

Options:
  --help, -h           Show help
  --version, -v        Show version
  --verbose            Verbose output
  --json               Output as JSON

Examples:
  librarian bootstrap .
  librarian query "How does the payment flow work?"
  librarian quality --severity=critical,major
  librarian issues --status=open --claim
  librarian research authentication
```

---

## API Reference

### createLibrarian(options)

Create a Librarian instance.

```typescript
const librarian = await createLibrarian({
  workspace: string,           // Path to codebase
  storage?: 'sqlite' | 'memory', // Storage backend (default: sqlite)
  providers?: {
    llm?: 'anthropic' | 'openai' | 'ollama',
    apiKey?: string,
  },
  config?: {
    excludePaths?: string[],   // Paths to ignore
    languages?: string[],      // Languages to index
  },
});
```

### librarian.query(options)

Query for relevant context.

```typescript
const result = await librarian.query({
  intent: string,              // What you're trying to do
  depth?: 'L0' | 'L1' | 'L2' | 'L3', // Context depth
  files?: string[],            // Limit to specific files
});

// Returns:
{
  summary: string,             // Synthesized answer
  packs: ContextPack[],        // Relevant code contexts
  confidence: number,          // 0-1 confidence
  feedbackToken: string,       // For feedback submission
}
```

### librarian.getIssues(query)

Get quality issues.

```typescript
const issues = await librarian.getIssues({
  status?: ('open' | 'claimed' | 'resolved')[],
  severity?: ('critical' | 'major' | 'minor' | 'info')[],
  category?: string[],
  file?: string,
  limit?: number,
  orderBy?: 'roi' | 'severity' | 'effort',
});
```

### librarian.claimIssue(issueId)

Claim an issue to work on.

```typescript
const claim = await librarian.claimIssue(issueId, {
  agentId: 'my-agent',
  expectedMinutes: 30,
});
```

### librarian.resolveIssue(issueId)

Mark an issue as resolved.

```typescript
await librarian.resolveIssue(issueId, {
  agentId: 'my-agent',
  note: 'Fixed by extracting into smaller functions',
});
```

---

## Configuration

Create `librarian.config.ts` in your project root:

```typescript
import { defineConfig } from '@wave0/librarian';

export default defineConfig({
  // Paths to exclude from indexing
  exclude: [
    'node_modules',
    'dist',
    '*.test.ts',
    'fixtures/',
  ],

  // Languages to index (auto-detected if not specified)
  languages: ['typescript', 'javascript', 'python'],

  // Quality thresholds
  quality: {
    maxFunctionLines: 100,
    maxFileLines: 500,
    maxComplexity: 15,
    maxParameters: 5,
  },

  // LLM provider for semantic analysis
  providers: {
    llm: 'anthropic',
    model: 'claude-sonnet-4-20250514',
  },

  // Component definitions for research context
  components: [
    {
      id: 'auth',
      paths: ['src/auth/**'],
      research: 'authentication',
    },
    {
      id: 'api',
      paths: ['src/api/**'],
      research: 'api_design',
    },
  ],
});
```

---

## MCP Server

Librarian can run as an MCP server for IDE integration:

```bash
librarian serve --port 3000
```

### Available Tools

| Tool | Description |
|------|-------------|
| `librarian_query` | Query for relevant context |
| `librarian_get_issues` | Get quality issues |
| `librarian_claim_issue` | Claim an issue to work on |
| `librarian_resolve_issue` | Mark issue as resolved |
| `librarian_get_research` | Get best practices for a domain |
| `librarian_submit_feedback` | Report query quality |

### Claude Desktop Integration

Add to `~/.config/claude/mcp.json`:

```json
{
  "servers": {
    "librarian": {
      "command": "npx",
      "args": ["@wave0/librarian", "serve"],
      "cwd": "/path/to/your/project"
    }
  }
}
```

---

## Performance

| Operation | Time | Memory |
|-----------|------|--------|
| Bootstrap (10k files) | ~3 min | ~500MB |
| Incremental update | ~100ms | ~50MB |
| Query (p50) | ~150ms | ~20MB |
| Query (p99) | ~800ms | ~50MB |

Librarian uses incremental indexing - after initial bootstrap, updates are near-instant.

---

## Testing

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Run specific test file
npm test -- src/quality/issue_detector.test.ts
```

---

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

### Development Setup

```bash
git clone https://github.com/wave0-ai/librarian.git
cd librarian
npm install
npm run build
npm test
```

### Code of Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). Please read it before contributing.

---

## Roadmap

- [x] Core indexing and query
- [x] Quality issue detection
- [x] Best practices database
- [x] MCP server
- [ ] VS Code extension
- [ ] Multi-language support (Python, Go, Rust)
- [ ] Federated mode (multi-repo)
- [ ] Cloud-hosted option

See [ROADMAP.md](ROADMAP.md) for details.

---

## License

MIT License - see [LICENSE](LICENSE) for details.

---

## Acknowledgments

Librarian is built by [Nate Schmiedehaus](https://github.com/wave0-ai) to advance the state of AI-assisted software development.

Special thanks to all [contributors](https://github.com/wave0-ai/librarian/graphs/contributors).

---

<div align="center">

**[Documentation](docs/)** · **[Examples](examples/)** · **[Discord](https://discord.gg/wave0)** · **[Twitter](https://twitter.com/wave0ai)**

Made with care by Nate Schmiedehaus & the Wave0 community

</div>
