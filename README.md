<div align="center">

# LiBrainian

### The plug-in intelligence layer for serious coding agents

[![CI](https://github.com/nateschmiedehaus/LiBrainian/actions/workflows/ci.yml/badge.svg)](https://github.com/nateschmiedehaus/LiBrainian/actions/workflows/ci.yml)
[![E2E tests](https://img.shields.io/github/actions/workflow/status/nateschmiedehaus/LiBrainian/ci.yml?branch=main&label=E2E%20tests)](https://github.com/nateschmiedehaus/LiBrainian/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/librainian.svg)](https://www.npmjs.com/package/librainian)
[![npm downloads](https://img.shields.io/npm/dm/librainian.svg)](https://www.npmjs.com/package/librainian)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6+-3178c6.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933.svg)](https://nodejs.org/)

<img src="docs/assets/librainian-repo-artwork.png" alt="LiBrainian character artwork" width="320" />

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
# setup/init aliases (same flow, setup-oriented naming)
npx librainian setup --depth quick

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

## Integration Decision Tree

Choose the path that matches your runtime:

- MCP-compatible IDE/client (Claude Code, Cursor, Windsurf, Cline, Gemini CLI)
  - `docs/integrations/mcp.md`
- Shell automation or CI/CD
  - `docs/integrations/cli.md`
- OpenAPI-aware or raw HTTP toolchains
  - `docs/integrations/rest-api.md`
- UTCP tool bus integrations
  - `docs/integrations/utcp.md`
- A2A orchestration integrations
  - `docs/integrations/a2a.md`
- Python scripts and notebooks
  - `docs/integrations/python-sdk.md`

Universal integration hub:
- `docs/integrations/README.md`

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

## Performance Characteristics

LiBrainian tracks explicit SLA targets for query latency, indexing throughput, and memory budgets.

- Query latency target: `p50 < 500ms`, `p95 < 2000ms`, `p99 < 5000ms`
- Incremental indexing target: `10 changed files < 10s`
- Runtime memory target: `< 512MB RSS`

Run local diagnostics:

```bash
npx librainian benchmark --json --out state/eval/performance/PerformanceSLAReport.v1.json
# compatibility alias
librarian benchmark --json --out state/eval/performance/PerformanceSLAReport.v1.json --fail-on block
```

SLA reference:
- `docs/performance-sla.md`

## CLI Command Map

```bash
# Day 0 / onboarding
npx librainian setup --depth quick
npx librainian quickstart
npx librainian bootstrap .
npx librainian uninstall --dry-run
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

## CI / Non-Interactive Mode

LiBrainian now auto-detects CI/non-interactive runtime when:
- `CI=true` or `GITHUB_ACTIONS=true`
- stdout/stderr is not a TTY
- `--ci` is passed explicitly

In non-interactive mode, LiBrainian automatically:
- disables progress UI
- disables ANSI color output
- assumes non-interactive confirmations (`--yes` behavior)

Useful global flags:

```bash
npx librainian status --json --ci --quiet
npx librainian bootstrap --mode fast --yes --no-progress --no-color
```

GitHub Actions example:

```yaml
- name: Check index freshness (machine-readable)
  run: npx librainian status --json --quiet | jq -e '.freshness.staleFiles == 0 and .freshness.missingFiles == 0'

- name: Refresh index non-interactively
  run: npx librainian index --force --incremental --yes --quiet

- name: Audit redaction totals
  run: npx librainian scan --secrets --json | jq '.redactions'
```

## Pre-Commit Hook Integration

LiBrainian supports staged-file incremental indexing for commit-time freshness:

```bash
# index only staged files
npx librainian update --staged

# index explicit changed files (lint-staged style)
npx librainian update src/api/query.ts src/cli/index.ts
```

Built-in integration options:

- `lint-staged` (already configured in `package.json`): runs `librainian update` with staged filenames
- `lefthook` (already configured in `lefthook.yml`): runs `librainian update {staged_files}`
- Python `pre-commit` users: use the repo-level `.pre-commit-hooks.yaml` hook `librainian-update-staged`

These hook integrations are best-effort and non-blocking for known setup failures (for example, repo not bootstrapped yet).

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

## GitHub Action (CI Index Refresh)

Use the first-party composite action to restore cache, run incremental index refresh, and optionally upload index artifacts:

```yaml
steps:
  - uses: actions/checkout@v4
  - name: Index codebase with LiBrainian
    uses: nateschmiedehaus/LiBrainian/.github/actions/librainian@main
    with:
      workspace-root: ${{ github.workspace }}
      cache-key: librainian-${{ runner.os }}-${{ hashFiles('**/*.ts', '**/*.js', 'package-lock.json') }}
      restore-keys: |
        librainian-${{ runner.os }}-
      upload-artifact: true
      artifact-name: librainian-index
```

This repository dogfoods the action in `.github/workflows/librainian-action-dogfood.yml`.

## Release Provenance

LiBrainian enforces publish provenance before release:

```bash
npm run package:assert-release-provenance
```

This guard verifies:
- `package.json` version is valid semver and newer than npm's latest published version
- matching git tag (`v<version>`) exists locally
- matching git tag points to `HEAD`

Runtime trust/provenance visibility:
- `npx librainian status --format json` includes verification provenance summary fields
- `npx librainian health --format json` includes provenance status for release-evidence readiness
- generated evidence artifacts:
  - `state/audits/LiBrainian/manifest.json`
  - `docs/LiBrainian/STATUS.md`
  - `docs/LiBrainian/GATES.json`

Canonical release sequence:

```bash
npm version <patch|minor|major>
git push --follow-tags
npm publish --provenance --access public
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
- Construction quickstart: `docs/constructions/quickstart.md`
- Construction cookbook: `docs/constructions/cookbook.md`
- Construction operator guide: `docs/constructions/operators.md`
- Construction testing guide: `docs/constructions/testing.md`
- Construction migration guide: `docs/constructions/migration.md`
- Core docs: `docs/librarian/README.md`
- Universal integration guide: `docs/integrations/README.md`
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
- [Security Threat Model](docs/security.md)
- [Contributing Guide](CONTRIBUTING.md)

## Roadmap Focus

- Hardened live-fire evaluation on real external repos
- Improved provider orchestration for deep-cognition tasks
- Stronger composition utility scoring for constructable selection
- Continued UX improvements for CLI and npm onboarding

## License

MIT License — see [LICENSE](LICENSE).
