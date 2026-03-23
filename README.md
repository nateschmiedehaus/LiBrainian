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

<img src="https://raw.githubusercontent.com/nateschmiedehaus/LiBrainian/main/docs/assets/librainian-repo-artwork.png" alt="LiBrainian character artwork" width="320" />

**Fast local onboarding. Cited code context. Honest health checks.**

[Quick Start](#quick-start) · [CLI](#cli-command-map) · [Examples](#examples) · [Docs](https://github.com/nateschmiedehaus/LiBrainian/blob/main/docs/README.md) · [Contributing](https://github.com/nateschmiedehaus/LiBrainian/blob/main/CONTRIBUTING.md)

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

LiBrainian is a codebase intelligence tool for coding agents and developers. It indexes a repository, builds structural and semantic context, and answers questions with ranked files, evidence, and explicit health signals.

Use it when you want a better first pass than grep alone, but still want answers you can inspect and debug.

Core outcomes:
- Faster orientation in unfamiliar codebases
- Better refactor and blast-radius planning
- Better retrieval than plain grep or naive vector search
- More honest failure and freshness reporting than "works until it doesn't"

## Installation

```bash
npm install librainian
```

CLI binaries:
- `librainian` (primary)
- `librarian` (compatibility alias)

From a GitHub source checkout, build before running the CLI:

```bash
npm install
npm run build
```

## Recommended Path Today

| Surface | Maturity | Recommended for |
| --- | --- | --- |
| CLI | Stable | First run, CI, local debugging, fallback path |
| MCP | Stable | Claude Code, Cursor, Windsurf, VS Code, Gemini CLI |
| TypeScript API | Beta | Node-based agents and custom automation |
| Adapter previews (REST / UTCP / A2A / Python) | Source-only | Deferred from the first public release |

If you are new to LiBrainian, start with the CLI first. It is the most direct way to verify that indexing, retrieval, and diagnostics are healthy in your workspace.

## Requirements And Modes

- Node.js `18+`
- npm `9+`
- A repository you want to index
- Provider API keys are optional:
  - without keys, LiBrainian still supports indexing, repo maps, structural retrieval, and diagnostics
  - with keys, queries can use richer synthesis and provider-backed ranking paths
- Local-only modes:
  - `--offline` disables remote provider calls
  - `--local-only` forces fully local behavior

Healthy first-run signs:
- `quickstart` finishes without bootstrap failure
- `query` returns a summary, ranked files, and confidence metadata
- `status` and `doctor` agree on workspace state

If the workspace is stale or partially indexed, prefer fixing that first with `librainian doctor` or `librainian bootstrap --force --mode fast`.

## Quick Start

This is the recommended first-run path:

```bash
# 1) Build an index and repair obvious setup problems
npx librainian quickstart

# 2) Ask a real repo question
npx librainian query "What are the core modules and how do they connect?"

# 3) Inspect readiness and diagnostics
npx librainian status --json
npx librainian doctor --json
```

Healthy output includes:
- a non-empty answer or summary
- relevant file paths
- confidence or quality metadata
- no contradiction between `status` and `doctor`

More guided onboarding:
- [Start Here](https://github.com/nateschmiedehaus/LiBrainian/blob/main/docs/START_HERE.md)
- [Documentation Index](https://github.com/nateschmiedehaus/LiBrainian/blob/main/docs/README.md)
- [MCP Setup](https://github.com/nateschmiedehaus/LiBrainian/blob/main/docs/mcp-setup.md)

## MCP (Recommended Agent Integration)

For Claude Code, Cursor, Windsurf, VS Code, or Gemini CLI:

```bash
npx librainian mcp --print-config
```

Then follow the client-specific guide in [docs/mcp-setup.md](docs/mcp-setup.md).

Recommended MCP flow:
1. Run `quickstart` in the target repo first.
2. Confirm `status` or `doctor` is healthy.
3. Register the MCP server with your client.
4. Use `query`, `get_context_pack`, `find_symbol`, and `find_usages` as the default tool path.

## Source Checkout Workflows

Contributor-only validation, dogfood, and release scripts live in a source
checkout. They are not part of the shipped npm package contract.

Use [CONTRIBUTING.md](https://github.com/nateschmiedehaus/LiBrainian/blob/main/CONTRIBUTING.md)
for contributor setup, maintainer validation, and release qualification.

## Programmatic (Node / TypeScript)

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
import { initializeLibrarian } from 'librainian';

const session = await initializeLibrarian(process.cwd());
const result = await session.query('Explain the deployment pipeline');
```

## Integration Decision Tree

Choose the path that matches your runtime:

- MCP-compatible IDE/client (Claude Code, Cursor, Windsurf, Cline, Gemini CLI)
  - `docs/integrations/mcp.md`
- Shell automation or CI/CD
  - `docs/integrations/cli.md`
- Node / TypeScript application code
  - import from `librainian`

Recommended integration docs:
- [Universal integration guide](https://github.com/nateschmiedehaus/LiBrainian/blob/main/docs/integrations/README.md)
- [CLI integration guide](https://github.com/nateschmiedehaus/LiBrainian/blob/main/docs/integrations/cli.md)
- [MCP integration guide](https://github.com/nateschmiedehaus/LiBrainian/blob/main/docs/integrations/mcp.md)

Preview adapter notes remain in the GitHub source tree, but they are not part of the shipped npm surface for the first public release.

## Why LiBrainian

| Problem | Typical agent flow | LiBrainian flow |
|---|---|---|
| Context assembly | ad-hoc file search | semantic + structural + graph retrieval |
| Confidence handling | implicit certainty | explicit calibrated confidence + uncertainty |
| Architectural reasoning | scattered inferences | linked imports/calls/docs/tests evidence |
| Release discipline | mostly manual | strict evidence-backed qualification |
| Onboarding new repos | repeated setup friction | quickstart with self-healing bootstrap |

## What You Get From `query(...)`

- Summarized answer for the current intent
- Relevant files and pack IDs
- Confidence score and uncertainty metadata
- Evidence anchors for auditability
- Context suitable for downstream planning/edit loops

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

Maintainer-only performance diagnostics remain available in a source checkout, but they are not part of the first public CLI surface.

SLA reference:
- `https://github.com/nateschmiedehaus/LiBrainian/blob/main/docs/performance-sla.md`

## MCP Tool Trigger Compliance

LiBrainian ships an explicit tool-trigger compliance gate for MCP descriptions.

- Test: `src/mcp/__tests__/tool_triggering_compliance.test.ts`
- Method: baseline (tool name only) vs treatment (tool name + description)
- Coverage: all core MCP tools, 5 natural-language prompt variants per tool

Current CI pass criteria:
- Overall treatment compliance `>= 70%`
- Treatment must be `>=` baseline compliance
- At least 5 tools must each score `>= 70%` treatment compliance

Run locally:

```bash
npm test -- --run src/mcp/__tests__/tool_triggering_compliance.test.ts
```

## CLI Command Map

```bash
# Day 0 / onboarding
npx librainian quickstart
npx librainian bootstrap --mode fast
npx librainian uninstall --dry-run
npx librainian doctor --heal
npx librainian check-providers --json

# Day 1 / normal work
npx librainian query "How is auth wired across API and middleware?"
npx librainian status
npx librainian index --force --incremental
npx librainian repo-map --json
```

## Editing Experience (Contributor Loop)

If you are working from a source checkout, follow the contributor loop in
[CONTRIBUTING.md](https://github.com/nateschmiedehaus/LiBrainian/blob/main/CONTRIBUTING.md).
The shipped package supports runtime usage; contributor validation and release
qualification remain source-checkout workflows.

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

- name: Run health diagnostics
  run: npx librainian doctor --json --quiet | jq -e '.summary.status != "ERROR"'
```

## Pre-Commit Hook Integration

LiBrainian supports staged-file incremental indexing for commit-time freshness:

```bash
# index only staged files
npx librainian index --force --staged

# index explicit changed files (lint-staged style)
npx librainian index --force src/api/query.ts src/cli/index.ts
```

Built-in integration options:

- `lint-staged` (already configured in `package.json`): runs `librainian index --force --staged` with staged filenames
- `lefthook` (already configured in `lefthook.yml`): runs `librainian index --force --staged {staged_files}`
- Python `pre-commit` users: use the repo-level `.pre-commit-hooks.yaml` hook `librainian-update-staged`

These hook integrations are best-effort and non-blocking for known setup failures (for example, repo not bootstrapped yet).

## Development and Validation

Development and release validation commands are intentionally documented in the
source-checkout contributor guide, not as part of the runtime package contract.

- Contributor setup and local validation:
  [CONTRIBUTING.md](https://github.com/nateschmiedehaus/LiBrainian/blob/main/CONTRIBUTING.md)
- Package-shipped runtime docs:
  [docs/START_HERE.md](https://github.com/nateschmiedehaus/LiBrainian/blob/main/docs/START_HERE.md)

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

Public runtime trust surfaces:
- `npx librainian status --json` includes provenance and readiness summaries
- `npx librainian doctor --json` is the supported public diagnostic surface

Publish provenance checks, tagged releases, and strict qualification remain
maintainer-only source-checkout workflows documented in
[CONTRIBUTING.md](https://github.com/nateschmiedehaus/LiBrainian/blob/main/CONTRIBUTING.md).

## Examples

Examples are GitHub-only source references, not part of the published npm tarball:

- `https://github.com/nateschmiedehaus/LiBrainian/blob/main/examples/quickstart_programmatic.ts`
- `https://github.com/nateschmiedehaus/LiBrainian/blob/main/examples/agentic_task_loop.ts`
- `https://github.com/nateschmiedehaus/LiBrainian/blob/main/examples/feedback_loop_example.ts`

## Documentation Map

- Fast onboarding: `docs/START_HERE.md`
- Docs index: `docs/README.md`
- Core docs (GitHub/source checkout): `docs/librarian/README.md`
- Milestone brief (GitHub/source checkout): `docs/librarian/MILESTONE_BRIEF.md`
- Universal integration guide: `docs/integrations/README.md`
- MCP setup: `docs/mcp-setup.md`
- MCP design principles: `docs/mcp-design-principles.md`
- Package-shipped docs: `docs/START_HERE.md`, `docs/README.md`, `docs/mcp-setup.md`, `docs/mcp-design-principles.md`, `docs/integrations/README.md`, `docs/integrations/cli.md`, `docs/integrations/mcp.md`
- GitHub-only deep reference: `https://github.com/nateschmiedehaus/LiBrainian/tree/main/docs/librarian`
- Architecture notes: `https://github.com/nateschmiedehaus/LiBrainian/blob/main/ARCHITECTURE.md`
- Contribution workflow: `https://github.com/nateschmiedehaus/LiBrainian/blob/main/CONTRIBUTING.md`
- Troubleshooting and health checks: `https://github.com/nateschmiedehaus/LiBrainian/blob/main/docs/CRASH_DIAGNOSIS.md`

## Support and Feedback

- Usage questions: [GitHub Discussions](https://github.com/nateschmiedehaus/LiBrainian/discussions)
- Bugs: [GitHub Issues](https://github.com/nateschmiedehaus/LiBrainian/issues)
- Security reports: [Security Advisories](https://github.com/nateschmiedehaus/LiBrainian/security/advisories/new)

## Community Standards

- [Code of Conduct](https://github.com/nateschmiedehaus/LiBrainian/blob/main/CODE_OF_CONDUCT.md)
- [Security Policy](https://github.com/nateschmiedehaus/LiBrainian/blob/main/SECURITY.md)
- [Security Threat Model](https://github.com/nateschmiedehaus/LiBrainian/blob/main/docs/security.md)
- [Contributing Guide](https://github.com/nateschmiedehaus/LiBrainian/blob/main/CONTRIBUTING.md)

## Roadmap Focus

- Public-release doc and help consistency
- Stronger query/result trust for first-run dogfooding
- Clearer separation of public surface vs maintainer-only workflows
- Continued UX improvements for CLI and npm onboarding

## License

MIT License — see [LICENSE](LICENSE).
