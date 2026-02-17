<div align="center">

<img src="https://raw.githubusercontent.com/nateschmiedehaus/LiBrainian/main/assets/LiBrainian-logo.svg" alt="LiBrainian" width="120" />

# LiBrainian

### The Epistemic Knowledge Layer for Agentic Software Development

[![CI](https://github.com/nateschmiedehaus/LiBrainian/actions/workflows/ci.yml/badge.svg)](https://github.com/nateschmiedehaus/LiBrainian/actions/workflows/ci.yml)
[![Coverage](https://img.shields.io/badge/coverage-95%25-brightgreen.svg)](https://github.com/nateschmiedehaus/LiBrainian)
[![npm version](https://img.shields.io/npm/v/librainian.svg)](https://www.npmjs.com/package/librainian)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6+-3178c6.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933.svg)](https://nodejs.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

**LiBrainian gives AI coding agents calibrated, evidence-backed understanding of any codebase.**

[Quick Start](#quick-start) | [Examples](#examples) | [Why LiBrainian](#why-LiBrainian) | [Features](#features) | [Documentation](docs/) | [Contributing](CONTRIBUTING.md)

</div>

---

## Quick Start

Get semantic codebase understanding in 30 seconds:

```bash
# Install
npm install librainian

# Smooth onboarding (auto-heal + bootstrap + baseline)
npx librainian quickstart

# Or, run a full bootstrap explicitly
npx librainian bootstrap . --emit-baseline

# Query for context
npx librainian query "Where is authentication handled?"

# Check index health
npx librainian status
```

### Use in Your Agent

```typescript
import { createLibrarian } from 'librainian';

const LiBrainian = await createLibrarian({
  workspace: process.cwd(),
});

// Get context for a task with calibrated confidence
const context = await LiBrainian.query({
  intent: 'Add rate limiting to the API',
  depth: 'L2',
});

console.log(context.summary);
// "Rate limiting should be added to src/api/middleware.ts.
//  The existing auth middleware at line 45 shows the pattern.
//  Confidence: 0.87 (high) - based on 3 evidence sources."

// Get quality issues ranked by ROI
const issues = await LiBrainian.getIssues({
  status: 'open',
  orderBy: 'roi',
  limit: 10
});
```

## Examples

Practical examples live in `/examples`:

- `examples/quickstart_programmatic.ts`
- `examples/agentic_task_loop.ts`
- `examples/feedback_loop_example.ts`

Run them with:

```bash
npx tsx examples/quickstart_programmatic.ts
npx tsx examples/agentic_task_loop.ts
```

---

## Why LiBrainian?

AI coding agents are powerful but often **overconfident** and **context-blind**. They hallucinate file locations, miss architectural patterns, and treat all code equally.

**LiBrainian solves this through epistemic grounding:**

| Challenge | Without LiBrainian | With LiBrainian |
|-----------|-------------------|----------------|
| **Finding code** | Grep/search, miss context | Semantic search with PageRank importance |
| **Understanding purpose** | Guess and hallucinate | Evidence-backed explanations with citations |
| **Confidence calibration** | Always claims certainty | Calibrated confidence with uncertainty bounds |
| **Code quality** | Manual review | Automated detection with ROI-ranked fixes |
| **Best practices** | Generic advice | Domain-specific research (auth, API, DB) |

### Key Differentiators

**vs. Raw LLM Context**
- LiBrainian provides *structured* knowledge graphs, not just text dumps
- Confidence scores tell your agent when to ask for help vs. proceed
- Evidence chains let agents verify their understanding

**vs. Vector Search Tools**
- Semantic search enhanced with code-aware ranking (PageRank, centrality)
- Quality issue detection and tracking built-in
- Agent feedback loop improves results over time

**vs. Static Analysis**
- Goes beyond syntax to understand *purpose* and *importance*
- Integrates LLM capabilities for semantic understanding
- Designed for agent consumption, not human dashboards

---

## Features

### Semantic Code Understanding

Build a rich knowledge graph of your codebase with importance signals:

```
                    LiBrainian KNOWLEDGE GRAPH
+---------------------------------------------------------------+
|                                                               |
|  +-----------+    calls    +-----------+   imports  +-------+ |
|  | Function  |------------>| Function  |----------->| Module| |
|  | Purpose   |             | Purpose   |            | API   | |
|  | Importance|             | Importance|            |       | |
|  +-----------+             +-----------+            +-------+ |
|       |                         |                       |     |
|       | tested_by               | documented_in         |     |
|       v                         v                       v     |
|  +-----------+             +-----------+            +-------+ |
|  |   Test    |             |    Doc    |            | Config| |
|  |  Coverage |             |  Section  |            |  Keys | |
|  +-----------+             +-----------+            +-------+ |
|                                                               |
+---------------------------------------------------------------+
```

### Epistemics Layer

LiBrainian features a sophisticated epistemic framework that treats confidence as a first-class primitive with proper semantics:

**Core Modules:**
- **Confidence System** - Calibrated confidence with Bayesian updates, proper algebraic laws (semilattice operations), and typed formulas
- **Evidence Ledger** - Append-only audit trail tracking all epistemic events with W3C PROV export
- **Defeater Calculus** - Formal system for tracking what undermines claims, with grounded semantics
- **Calibration Curves** - Isotonic calibration, PAC-based sample thresholds, and proper scoring rules

**Advanced Modules:**
- **Conative Attitudes** - Action-directed reasoning with intentions, preferences, goals, and BDI agent states
- **Temporal Grounding** - Decay functions, validity periods, and automatic staleness detection
- **Intuitive Grounding** - Pattern recognition with articulability scoring and upgrade paths to formal justification
- **Inference Auditing** - Fallacy detection (circular reasoning, hasty generalization, etc.) with suggested fixes
- **Quality Gates** - Course correction system for maintaining epistemic standards during agent operations
- **Universal Coherence** - Framework for evaluating belief consistency across abstraction levels

**Theoretical Foundations:**
- **Belief Functions** - Dempster-Shafer theory for imprecise probability
- **AGM Belief Revision** - Formal belief update with entrenchment and postulate verification
- **Credal Sets** - Interval arithmetic for uncertainty propagation
- **Multi-Agent Epistemology** - Social epistemics with testimony evaluation and group consensus

### Calibrated Confidence

Every response includes calibrated confidence scores:

```typescript
const result = await LiBrainian.query({ intent: 'Find the payment processor' });

console.log(result.confidence);     // 0.92 (high confidence)
console.log(result.uncertainties);  // ['Multiple payment providers exist', 'Stripe vs PayPal unclear']
console.log(result.evidence);       // ['src/payments/stripe.ts:L45', 'config/payments.json']
```

### Quality Issue Detection

Automatically detect and track code quality issues with ROI-based prioritization:

```bash
$ npx librainian quality

  CODE QUALITY REPORT
+------------------------------------------------------------------+
|  Critical: 2   Major: 8   Minor: 31   Info: 15                   |
|  Total Technical Debt: ~12 hours                                 |
+------------------------------------------------------------------+
|                                                                  |
|  TOP ISSUES BY ROI:                                              |
|                                                                  |
|  1. [CRITICAL] Long method: processOrder (312 lines)             |
|     src/orders/processor.ts:45                                   |
|     Fix: Extract into smaller functions                          |
|     Effort: 45min | Impact: High | ROI: 4.2                      |
|                                                                  |
|  2. [MAJOR] Missing error handling in API handler                |
|     src/api/users.ts:89                                          |
|     Fix: Add try/catch with proper error responses               |
|     Effort: 15min | Impact: High | ROI: 3.8                      |
|                                                                  |
+------------------------------------------------------------------+
```

### Best Practices Database

Built-in research for common domains with world-class standards:

```typescript
const practices = await LiBrainian.getBestPractices('authentication');

// Returns:
// Essential:
//   - Use bcrypt/Argon2 for password hashing
//   - Implement rate limiting on login endpoints
//   - Store sessions securely (httpOnly, secure, sameSite)
// Recommended:
//   - Use short-lived tokens with refresh
//   - Implement MFA support
//   - Add brute-force protection
```

### Agent Feedback Loop

LiBrainian learns from agent interactions to improve over time:

```typescript
await LiBrainian.submitFeedback({
  queryId: result.feedbackToken,
  helpful: ['src/auth/handler.ts', 'src/utils/crypto.ts'],
  missing: 'Could not find password reset flow',
  rating: 4,
});
```

---

## Architecture

```
+--------------------------------------------------------------------+
|                         YOUR CODEBASE                               |
+--------------------------------+-----------------------------------+
                                 |
                                 v
+--------------------------------------------------------------------+
|                          LiBrainian                                  |
|  +----------------+  +----------------+  +------------------------+ |
|  |    Indexing    |  |   Knowledge    |  |        Quality         | |
|  |                |  |                |  |                        | |
|  | - AST Parse    |  | - Extractors   |  | - Issue Detection      | |
|  | - Semantic     |  | - Synthesis    |  | - ROI Ranking          | |
|  | - Incremental  |  | - Evidence     |  | - Best Practices       | |
|  +----------------+  +----------------+  +------------------------+ |
|  +----------------+  +----------------+  +------------------------+ |
|  |     Graphs     |  |    Storage     |  |      Integration       | |
|  |                |  |                |  |                        | |
|  | - Call Graph   |  | - SQLite       |  | - MCP Server           | |
|  | - PageRank     |  | - In-Memory    |  | - Agent Protocol       | |
|  | - Centrality   |  | - Migrations   |  | - IDE Plugins          | |
|  +----------------+  +----------------+  +------------------------+ |
|  +----------------------------------------------------------------+ |
|  |                     Epistemics Layer                           | |
|  |                                                                | |
|  |  Core:                                                         | |
|  |  - Calibrated Confidence   - Evidence Ledger (PROV export)     | |
|  |  - Defeater Calculus       - Calibration Curves                | |
|  |                                                                | |
|  |  Advanced:                                                     | |
|  |  - Conative Attitudes      - Inference Auditing                | |
|  |  - Temporal Grounding      - Quality Gates                     | |
|  |  - Intuitive Grounding     - Universal Coherence               | |
|  |                                                                | |
|  |  Foundations:                                                  | |
|  |  - Belief Functions        - AGM Belief Revision               | |
|  |  - Credal Sets             - Multi-Agent Epistemics            | |
|  +----------------------------------------------------------------+ |
|  +----------------------------------------------------------------+ |
|  |                     Evaluation Layer                           | |
|  |                                                                | |
|  |  Verification:                                                 | |
|  |  - AST Fact Extraction     - Citation Verification             | |
|  |  - Chain-of-Verification   - Adversarial Patterns              | |
|  |                                                                | |
|  |  Analysis:                                                     | |
|  |  - Data Flow Analysis      - Code Property Graphs              | |
|  |  - Dead Code Detection     - Reachability Analysis             | |
|  +----------------------------------------------------------------+ |
|  +----------------------------------------------------------------+ |
|  |                   Resource Management                          | |
|  |  - Resource Monitoring     - Adaptive Pools                    | |
|  |  - Memory Tracking         - Throttling & Backpressure         | |
|  +----------------------------------------------------------------+ |
+--------------------------------------------------------------------+
                                 |
                                 v
+--------------------------------------------------------------------+
|                        AI CODING AGENTS                             |
|         Claude Code - Cursor - Windsurf - Custom Agents             |
+--------------------------------------------------------------------+
```

---

## Package Entry Points

LiBrainian exports multiple entry points for different use cases:

```typescript
// Main API
import { createLibrarian } from 'librainian';

// Query API
import { queryLibrarian } from 'LiBrainian/api';

// Quality detection
import { detectAllIssues } from 'LiBrainian/quality';

// Storage layer
import { createStorageSlices } from 'LiBrainian/storage';

// LLM providers
import { createProvider } from 'LiBrainian/providers';
```

---

## CLI Reference

```bash
librainian <command> [options]

Commands:
  quickstart           Smooth onboarding (heal + bootstrap + baseline)
  bootstrap [path]     Index a codebase (first-time or full refresh)
  query <intent>       Query for relevant context
  status               Show indexing status and health
  check-providers      Check provider availability
  watch                Watch for file changes and auto-reindex
  diagnose             Diagnose self-knowledge drift
  doctor               Run diagnostics and config heal
  health               Show system health (EvolutionOps)
  analyze              Run static analysis (dead code, complexity)
  coverage             UC × method × scenario audit
  smoke                Run external repo smoke harness
  journey              Run agentic journey simulations

Options:
  --help, -h           Show help
  --version, -v        Show version
  --verbose            Verbose output
  --format text|json   Output format (command-dependent)
  --json               Alias for --format json

Tip: run `librainian help` for the full, up-to-date command list.
Legacy alias: `LiBrainian` is still supported.

Examples:
  librainian bootstrap .
  librainian query "How does the payment flow work?"
  librainian status --format json
  librainian check-providers --json
```

---

### Available MCP Tools

| Tool | Description |
|------|-------------|
| `librarian_query` | Query for relevant context with confidence |
| `librarian_get_issues` | Get quality issues ranked by ROI |
| `librarian_claim_issue` | Claim an issue to work on |
| `librarian_resolve_issue` | Mark issue as resolved |
| `librarian_get_research` | Get best practices for a domain |
| `librarian_submit_feedback` | Report query quality for learning |

---

## Configuration

Create `LiBrainian.config.ts` in your project root:

```typescript
import { defineConfig } from 'librainian';

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

  // Component research mapping
  components: [
    {
      id: 'auth',
      paths: ['src/auth/**'],
      research: 'authentication',
    },
  ],
});
```

---

## Performance

| Operation | Time | Memory |
|-----------|------|--------|
| Bootstrap (10k files) | ~3 min | ~500MB |
| Incremental update | ~100ms | ~50MB |
| Query (p50) | ~150ms | ~20MB |
| Query (p99) | ~800ms | ~50MB |

LiBrainian uses incremental indexing - after initial bootstrap, updates are near-instant.

---

## Testing

LiBrainian has **4,280+ tests** covering all functionality (including 780 tests for new epistemics and evaluation modules):

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Run by category
npm run test:unit          # Unit tests only
npm run test:integration   # Integration tests
npm run test:system        # Full system tests

# Watch mode
npm run test:watch
```

---

## Contributing

We welcome contributions! LiBrainian is designed for extensibility:

- **Add language support** - Extend the parser layer
- **New quality detectors** - Add issue detection rules
- **Best practices research** - Contribute domain knowledge
- **Documentation** - Help others get started

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

```bash
# Development setup
git clone https://github.com/nateschmiedehaus/LiBrainian.git
cd LiBrainian
npm install
npm run build
npm test
```

---

## Community Standards

- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Security Policy](SECURITY.md)
- [Contributing Guide](CONTRIBUTING.md)

---

## Roadmap

### Completed
- [x] Core indexing and semantic query
- [x] Quality issue detection with ROI ranking
- [x] Best practices database
- [x] MCP server for IDE integration
- [x] Epistemic confidence framework (calibrated confidence, evidence ledger, defeaters)
- [x] Conative attitudes (intentions, preferences, goals, BDI agents)
- [x] Temporal grounding (decay functions, validity periods)
- [x] Intuitive grounding (pattern recognition, articulability)
- [x] Inference auditing (fallacy detection, course correction)
- [x] Quality gates (epistemic standards enforcement)
- [x] Universal coherence framework
- [x] Resource monitoring and adaptive pools
- [x] TypeScript strict mode enabled
- [x] Adversarial pattern detection
- [x] AST-based fact extraction
- [x] Enhanced citation verification
- [x] Chain-of-Verification (CoVe) implementation
- [x] Data flow analysis primitives

### In Progress
- [ ] VS Code extension
- [ ] Multi-language support (Python, Go, Rust)

### Planned
- [ ] Federated mode (multi-repo)
- [ ] Cloud-hosted option
- [ ] Neural entailment integration (replace heuristic checking)

---

## License

MIT License - see [LICENSE](LICENSE) for details.

---

## Acknowledgments

Built by [Nate Schmiedehaus](https://github.com/LiBrainian-ai) to advance the state of AI-assisted software development.

Special thanks to all [contributors](https://github.com/nateschmiedehaus/LiBrainian/graphs/contributors).

---

<div align="center">

**[Documentation](docs/)** | **[Examples](examples/)** | **[Discord](https://discord.gg/LiBrainian)** | **[Twitter](https://twitter.com/librarian_ai)**

Made with care for the AI-assisted development community

</div>
