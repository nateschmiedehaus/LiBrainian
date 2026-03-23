# Claude Agent Instructions for LiBrainian

> This file is for Claude-style coding agents working inside the repository.
> If you are evaluating or contributing as a human, start with `README.md`, `docs/START_HERE.md`, and `CONTRIBUTING.md`.

This file is the Claude-specific entrypoint. It adopts all repository rules from `AGENTS.md` and adds a strict launch-quality override.

## Source of Truth

- Primary operational contract: `AGENTS.md`
- Canonical testing policy: `docs/TEST.md`
- Public product entrypoints: `README.md`, `docs/START_HERE.md`, `docs/mcp-setup.md`
- Release qualification evidence:
  - `eval-results/agentic-use-case-review.json`
  - `state/eval/live-fire/hardcore/latest.json`
  - `state/eval/smoke/external/all-repos/report.json`
  - `state/eval/testing-discipline/report.json`
  - `state/eval/testing-discipline/testing-tracker.json`
- Historical advisory snapshots only: `docs/librarian/STATUS.md`, `docs/librarian/GATES.json`
- Strategy tracker: `docs/librarian/CONVERSATION_INSIGHTS.md`

## MCP Workflow

LiBrainian is registered as a project-scoped MCP server (`.mcp.json`).
It is auto-discovered on session start.

**Before modifying `src/api/`, `src/mcp/`, `src/storage/`, or `src/query/`:**
call `mcp__librainian__query` to understand cross-file impact first.

Key MCP tools:

| Tool | Use for |
|------|---------|
| `mcp__librainian__query` | Architectural understanding, cross-module flow, impact reasoning |
| `mcp__librainian__get_context_pack` | Task-shaped context before multi-file edits |
| `mcp__librainian__find_symbol` / `mcp__librainian__find_usages` | Exact symbol lookup and dependency tracing |
| `mcp__librainian__get_change_impact` | Pre-edit impact estimation |
| `mcp__librainian__get_repo_map` | Fast repo orientation before deeper queries |
| `mcp__librainian__semantic_search` | Find files by meaning when filenames or symbol names are unknown |

Reserve Grep for exact literal string matching only. One
`mcp__librainian__query` call replaces 5 speculative Grep calls. Skip
LiBrainian for trivial edits or files you already understand.

If LiBrainian returns a structured MCP error:
- Retry at most once when `retryable`/`retry_safe` is true.
- Do not retry when `retryable`/`retry_safe` is false; execute `fallback_command` or the suggested `recoverWith` repair path.
- Treat stale/partial index warnings as untrusted retrieval until `librainian bootstrap` repairs the workspace.
- If MCP stays degraded, switch to `rg` and direct file inspection instead of looping on the same tool call.

## Subagent Delegation

When spawning subagents via the Task tool, MCP tools are NOT available
to them. Include CLI fallback instructions in every non-trivial
subagent prompt:

**Template for subagent prompts:**
> "This repo has LiBrainian for codebase knowledge. Before modifying
> unfamiliar code, run `./ask "your question"` via Bash. Use
> `./ask --json "..."` for structured output. Reserve Grep for exact
> literal string matching only."

Do NOT assume subagents can call `mcp__librainian__*` tools.

## Mandatory Launch-Quality Rules

1. `REAL_AGENT_REAL_LIBRARIAN_ONLY`
   - Qualification and publish evidence must come from real agents running on real LiBrainian repos/workspaces.
2. `NO_RETRY_NO_FALLBACK_NO_DEGRADED_FOR_RELEASE`
   - Retry/fallback/degraded/unavailable/unverified evidence states are failures, not warnings.
3. `100% STRICT PASS FOR RELEASE EVIDENCE`
   - Release evidence must pass with zero strict-failure markers.
4. `AGENTIC QUALIFICATION REQUIRED`
   - Run `npm run test:agentic:strict` for publish-grade qualification.
5. `CONVERSATION INTELLIGENCE REQUIRED`
   - Update `docs/librarian/CONVERSATION_INSIGHTS.md` at major planning checkpoints and before release-gate runs.
6. `PROOF_ARTIFACT_GATE_REQUIRED`
   - Never declare a milestone passed without running `node scripts/proof-review-gate.mjs` on the proof artifact and including its full output in the evidence.
   - The gate must exit 0 (zero failures). Warnings are acceptable; failures are not.
   - If the gate fails, the milestone is NOT passed regardless of what `all_passed` says in the artifact.
   - Also run `node scripts/adversarial-proof-validator.mjs` on the proof test source to verify test rigor.

## Disallowed for Release Evidence

- Synthetic or mock-only provider runs
- Reference-harness-only success claims
- Manual fallback artifacts treated as launch proof
- “Pass with caveats” when strict markers exist

## Autonomous Agent Coordination Protocol

LiBrainian uses a GitHub-native autonomous development system.
Three independent workflows coordinate via issue labels:

### Workflows
| Workflow | Schedule | Role |
|----------|----------|------|
| `agent-work.yml` | Every 3h | Finds ready issues, implements, creates PR |
| `agent-verify.yml` | Every 3h (offset) | Independently verifies worker PRs |
| `agent-reality.yml` | On push to main | Post-merge quality snapshot |

### Issue Label State Machine
```
ready + agent:actionable → agent:claimed → verify:pending → verify:pass → merged
                                                          → verify:fail → ready (reopened)
```

### Evidence Protocol
Every agent posts structured evidence as issue comments with hidden metadata:
```html
<!-- agent_evidence = {“v”:1,”issue”:N,”role”:”worker|verifier”,”verdict”:”pass|fail”} -->
```
Downstream agents parse these to assess upstream trust.

### Rules for Agents Working on Issues
1. Read the full issue body and acceptance criteria before starting
2. Make focused, minimal changes — do not refactor surrounding code
3. Run `npm run build` and relevant tests before committing
4. Post evidence with actual command output, not claims
5. The agent that implements NEVER verifies its own work

### Curating the Backlog
Run `node scripts/curate-agent-backlog.mjs` to label actionable issues.
Use `--dry-run` to preview. Use `--milestone M0` to focus on a milestone.
