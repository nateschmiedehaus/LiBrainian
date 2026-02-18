<div align="center">

# LiBrainian

### The plug-in intelligence layer for serious coding agents

[![CI](https://github.com/nateschmiedehaus/LiBrainian/actions/workflows/ci.yml/badge.svg)](https://github.com/nateschmiedehaus/LiBrainian/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/librainian.svg)](https://www.npmjs.com/package/librainian)
[![npm downloads](https://img.shields.io/npm/dm/librainian.svg)](https://www.npmjs.com/package/librainian)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6+-3178c6.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933.svg)](https://nodejs.org/)

**Auto-bootstrap. Auto-heal. Auto-query. Zero setup for day-one usefulness.**

[Quick Start](#quick-start) · [CLI](#cli-command-map) · [Examples](#examples) · [Docs](#documentation-map) · [Contributing](CONTRIBUTING.md)

</div>

```text
            .-""""-.
          .'  .--.  '.
         /   /_  _\   \
        |   (o)(o)    |
        |   / __ \    |   LiBrainian
         \  \____/   /    codebase brain for agents
          '._`--`_.'
             /||\
            /_||_\
```

## Overview

LiBrainian is a codebase intelligence system for coding agents and agent operators. It combines AST extraction, embeddings, graph signals, and provider-assisted synthesis to return context that is actionable, cited, and confidence-calibrated.

Core outcomes:
- Better retrieval than plain grep/vector search
- Better planning via architectural and dependency context
- Better execution through explicit confidence and evidence trails
- Better reliability with strict publish/eval gates

## Installation

```bash
npm install librainian
```

CLI binaries:
- `librainian` (primary)
- `librarian` (compatibility alias)

## Dogfood (Safe Sandbox)

Run the packaged CLI in an isolated temp sandbox (no self-install into this repo):

```bash
# default command: status --format json
npm run dogfood

# pass any CLI command after --
npm run dogfood -- query "Where is auth enforced?"
```

## GitHub → First Win (2-Minute Flow)

```bash
git clone https://github.com/nateschmiedehaus/LiBrainian.git
cd LiBrainian
npm install
npx librainian quickstart
npx librainian query "What are the core modules and how do they connect?"
```

If this query returns a summary + files + confidence, your install is healthy.

## Quick Start

### CLI (fastest path)

```bash
# 1) Bootstrap + heal + baseline in one pass
npx librainian quickstart

# 2) Ask for context
npx librainian query "Where is authentication enforced?"

# 3) Verify health/readiness
npx librainian status --format json
npx librainian health --format json
```

### MCP (agent clients)

For Claude Code/Cursor/VS Code/Windsurf/Gemini client wiring, run:

```bash
npx librainian mcp --print-config
```

Then follow the full setup guide at `docs/mcp-setup.md`.

### Programmatic (recommended for agents)

```typescript
import { initializeLibrarian } from 'librainian';

const session = await initializeLibrarian(process.cwd());
const context = await session.query('Add request-id tracing to API handlers');

console.log(context.summary);
console.log(context.relatedFiles);
console.log(context.confidence);
```

Compatibility API:

```typescript
import { createLibrarian } from 'librainian';

const librarian = await createLibrarian({ workspace: process.cwd() });
const result = await librarian.query({ intent: 'Explain the deployment pipeline' });
```

## Why LiBrainian

| Problem | Typical agent flow | LiBrainian flow |
|---|---|---|
| Context assembly | ad-hoc file search | semantic + structural + graph retrieval |
| Confidence handling | implicit certainty | explicit calibrated confidence + uncertainty |
| Architectural reasoning | scattered inferences | linked imports/calls/docs/tests evidence |
| Release discipline | mostly manual | strict publish-gate + evidence workflows |
| Onboarding new repos | repeated setup friction | quickstart with self-healing bootstrap |

## What You Get From `query(...)`

- Summarized answer for the current intent
- Relevant files and pack IDs
- Confidence score and uncertainty metadata
- Evidence anchors for auditability
- Context suitable for downstream planning/edit loops

## Constructables and Composition

LiBrainian supports composable reasoning/build blocks for agent workflows (investigation, planning, dependency tracing, performance analysis, release checks).

```bash
npx librainian compose "Plan a safe refactor of auth token refresh"
npx librainian compose "Debug flaky tests in CI" --include-primitives
```

This enables reusable patterns instead of one-off prompting.

## Language Coverage

Built-in parsers and extraction paths cover major ecosystems, including:

- TypeScript / JavaScript / TSX / JSX
- Python, Go, Rust, Java, C/C++, C#
- Ruby, PHP, Kotlin, Swift, Dart, Scala, Lua
- SQL, JSON, YAML, Bash, CSS, HTML

LiBrainian auto-detects what is present and indexes only what is available in the workspace.

## CLI Command Map

```bash
# Day 0 / onboarding
npx librainian quickstart
npx librainian bootstrap .
npx librainian doctor --heal

# Day 1 / normal work
npx librainian query "How is auth wired across API and middleware?"
npx librainian status
npx librainian watch
npx librainian compose "Create rollout plan for feature flags"

# Hard mode / reliability and evaluation
npx librainian smoke --json
npx librainian journey --strict-objective --json
npx librainian live-fire --profile baseline --json
npx librainian publish-gate --profile release --json
```

## Editing Experience (Contributor Loop)

```bash
# day-to-day loop (changed files + public-surface checks)
npm run validate:fast

# optional focused test while iterating
npm test -- --run src/path/to/changed.test.ts

# before merge (deterministic full gate)
npm run validate:full

# release qualification (real-agent strict gate)
npm run test:agentic:strict
```

`validate:fast` is the default developer path and CI path for pull requests.
`validate:full` and `test:agentic:strict` are required for release-grade confidence.

## Development and Validation

```bash
npm install
npm run build

# PR and everyday edits
npm run validate:fast

# full deterministic validation
npm run validate:full

# strict publish qualification
npm run test:agentic:strict
npm run eval:publish-gate -- --json
```

Equivalent explicit full deterministic command chain:

```bash
npm test -- --run
npm run typecheck
npm run repo:audit
npm run package:assert-identity
npm run package:install-smoke
```

PR process is in `CONTRIBUTING.md`.

## Examples

Live examples are in `/examples`:

- `examples/quickstart_programmatic.ts`
- `examples/agentic_task_loop.ts`
- `examples/feedback_loop_example.ts`

Run locally:

```bash
npx tsx examples/quickstart_programmatic.ts
npx tsx examples/agentic_task_loop.ts
npx tsx examples/feedback_loop_example.ts
```

## Documentation Map

- Fast onboarding: `docs/START_HERE.md`
- Docs index: `docs/README.md`
- Core docs: `docs/librarian/README.md`
- MCP setup: `docs/mcp-setup.md`
- MCP design principles: `docs/mcp-design-principles.md`
- Query guide: `docs/librarian/query-guide.md`
- Specifications: `docs/librarian/specs/README.md`
- Architecture notes: `ARCHITECTURE.md`
- Contribution workflow: `CONTRIBUTING.md`
- Troubleshooting and health checks: `docs/CRASH_DIAGNOSIS.md`

## Support and Feedback

- Usage questions: [GitHub Discussions](https://github.com/nateschmiedehaus/LiBrainian/discussions)
- Bugs: [GitHub Issues](https://github.com/nateschmiedehaus/LiBrainian/issues)
- Security reports: [Security Advisories](https://github.com/nateschmiedehaus/LiBrainian/security/advisories/new)

## Community Standards

- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Security Policy](SECURITY.md)
- [Contributing Guide](CONTRIBUTING.md)

## Roadmap Focus

- Hardened live-fire evaluation on real external repos
- Improved provider orchestration for deep-cognition tasks
- Stronger composition utility scoring for constructable selection
- Continued UX improvements for CLI and npm onboarding

## License

MIT License — see [LICENSE](LICENSE).
