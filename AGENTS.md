# Agent Instructions for LiBrainian

LiBrainian is a codebase knowledge system for AI coding agents. It indexes
source code and provides semantic search, context packs, and relationship
graphs so agents can make better decisions without reading every file.

## Key Directories

- `src/api/` — query pipeline, intent classification, synthesis
- `src/adapters/` — LLM and embedding provider adapters
- `src/constructions/` — constructable context patterns (registry, processes)
- `src/storage/` — SQLite storage, migrations, recovery
- `src/cli/` — CLI commands (bootstrap, query, status, doctor)
- `src/epistemics/` — evidence ledger

## Build and Test Commands

```bash
npm run build          # compile TypeScript → dist/
npm test               # T0 unit tests (no live providers required)
npm run test:tier0     # same as npm test --run (CI gate)
npm run test:integration   # T1 integration tests (providers optional)
npx tsc --noEmit       # type-check only
npm run lint           # ESLint
```

For publish-grade qualification:
```bash
npm run test:agentic:strict   # T2 full agentic qualification (live providers required)
```

## Testing Tiers

- **T0** — pure unit tests, no providers; must always pass
- **T1** — integration tests; skip provider-dependent assertions when unavailable
- **T2** — full agentic/e2e qualification with live providers; required for release

## Release Non-Negotiables

1. `REAL_AGENT_REAL_LIBRARIAN_ONLY` — release evidence must come from real agents on real repos
2. `NO_RETRY_NO_FALLBACK` — any fallback/degraded/unverified marker in release evidence is a hard failure
3. `100%` strict pass required — no "pass with caveats"
4. Run `test:agentic:strict` for publish-grade qualification
5. Update `docs/LiBrainian/CONVERSATION_INSIGHTS.md` before release-gate runs

## PR Rules

Use conventional commits (`feat/fix/test/docs/refactor/chore`). Do not force-push or rebase without explicit instruction.

## What NOT to Do

- Do not write `docs/LiBrainian/STATUS.md` manually — evidence must come from real runs
- Do not skip smoke tests and claim success
- Do not treat fallback/degraded mode output as release evidence
- Do not add runtime dependencies not justified by a spec
- Do not publish to npm without explicit instruction

## Using LiBrainian (Mandatory for Non-Trivial Tasks)

LiBrainian is available as an MCP server. Agents auto-discover it via
`.mcp.json` (Claude Code) or `.codex/config.toml` (Codex).

### When to Query LiBrainian First

**BEFORE** any of these, call the `query` MCP tool:
- Modifying code in an unfamiliar module
- Debugging cross-file issues
- Planning a refactor that touches 3+ files
- Writing tests for code you didn't write
- Assessing blast radius of a change

Example tool calls:
- `query({ intent: "How does the bootstrap quality gate work?" })`
- `query({ intent: "What breaks if I change the scoring pipeline?" })`
- `get_context_pack({ intent: "debug embedding fallback", taskType: "bug_fix" })`
- `find_callers({ symbolName: "rankContextPacks" })`

### When NOT to Use

- Trivial edits: typos, renames, single-line constant changes
- Files you already have open and understand
- Pure formatting or documentation-only changes

### Subagent and CLI Fallback

Subagents spawned via the Task tool cannot access MCP servers (platform
limitation). When spawning subagents for non-trivial tasks, include CLI
usage instructions in their prompt.

Quick reference for subagent prompts:

```bash
# Semantic query (plain text output)
./ask "How does the bootstrap quality gate work?"

# Structured JSON output
./ask --json "What calls rankContextPacks?"

# Status and diagnostics
node dist/cli/index.js status
node dist/cli/index.js doctor
```

When spawning a Task agent, include this in the prompt:
> "This repo has a codebase knowledge tool. Before modifying code you
> don't understand, run `./ask "your question"` via Bash to get relevant
> context. Use Grep only for exact literal string matching."

CLI-to-MCP equivalence:

| MCP tool | CLI equivalent |
|----------|---------------|
| `query({ intent: "..." })` | `./ask "..."` |
| `query({ intent: "...", json: true })` | `./ask --json "..."` |
| `status()` | `node dist/cli/index.js status` |
| `doctor()` | `node dist/cli/index.js doctor` |

---

## Milestone Proof Protocol

Milestones (M0, M1, etc.) are only "passed" when structural proof validates product
quality, not just plumbing. This protocol exists because we falsely declared M0
passed by testing exit codes instead of actual query quality.

### Rules

1. **Proof tests BEFORE fixes.** Write the proof test (with specific expected outputs)
   before implementing the fix. The test must fail first, then pass after the fix.
2. **Structural validation required.** Before any milestone is declared passed, run:
   ```bash
   node scripts/proof-review-gate.mjs state/<milestone>/self-dev-proof.json
   ```
   This script checks for red flags: file dominance, low diversity, missing quality
   metrics, suspiciously broad patterns, and inconsistent pass/fail states.
3. **Test rigor validation.** Proof test source code must pass adversarial review:
   ```bash
   node scripts/adversarial-proof-validator.mjs src/__tests__/<proof_test>.test.ts
   ```
   This catches gameable tests: short patterns, missing assertions, silent skips.
4. **quality_issues must be empty AND structural checks must pass.** A proof artifact
   with `all_passed: true` but missing `quality_issues`, `cross_query_metrics`, or
   `mustIncludeMatched` fields is a structural failure regardless of `all_passed`.
5. **Include gate output in evidence.** Any agent declaring a milestone "passed" must
   paste the full output of `proof-review-gate.mjs` into their evidence. A clean bill
   of health from this script is the minimum bar.
6. **Pre-push enforcement.** The `lefthook.yml` pre-push hook runs `proof-review-gate.mjs`
   on any proof artifacts in `state/`. You cannot push a false-pass.

### What the proof-review-gate checks

- Fewer than 6 distinct files across all query results
- Any single file appearing in >50% of result sets (dominance)
- Missing `quality_issues` array or non-empty quality issues
- Missing `cross_query_metrics` (Jaccard pairs, dominant files)
- Missing `mustIncludeMatched` on individual results
- Jaccard similarity >0.5 between any pair of result sets
- Result sets with <3 unique base files
- `all_passed: true` with non-empty quality issues (inconsistent)

### What the adversarial-proof-validator checks

- mustInclude/expectFiles patterns shorter than 8 characters
- Missing anti-dominance assertions in test code
- Missing Jaccard diversity assertions in test code
- Missing minimum file count assertions
- Unconditional skip() calls that silently pass
- Soft assertions (warnings without expect/assert)
- Fewer than 3 distinct query intents

---

## Per-Issue Quality Analysis

Deterministic gates catch structural problems. Per-issue quality analysis catches
"technically passing but actually useless" results. **Agent judgment analyzing
actual outputs is the primary quality signal.**

### Rules

1. **Any issue touching retrieval, query, embedding, scoring, indexing, or user-facing
   behavior MUST have `scripts/issue-quality-analysis.mjs` run before the PR is merged.**
   ```bash
   node scripts/issue-quality-analysis.mjs <issue_number> --description "what changed"
   ```

2. **The analysis output must be included in the PR description or as a PR comment.**
   Copy the structured summary from `state/issue-analyses/issue-{number}-analysis.json`
   or paste the console output.

3. **The agent assessment is the primary quality evidence — not just test pass/fail.**
   A PR with all tests green but no agent quality assessment of actual query results
   is incomplete for quality-sensitive changes.

4. **Agents implementing issues must run real queries and READ THE ACTUAL RESULTS
   before declaring the issue fixed.** The script runs 2-3 queries automatically.
   Review the returned files. Ask: "Would a user get useful answers from this?"

5. **This is more valuable than deterministic gates because it catches the gap between
   "tests pass" and "the product actually works."** Deterministic gates catch structural
   regressions. Agent analysis catches semantic regressions — results that are technically
   valid but useless.

### Workflow

```bash
# After implementing the fix, run the analysis
node scripts/issue-quality-analysis.mjs 42 --description "improved embedding fallback"

# Review the output — read the actual query results
# Then re-run with your judgment
node scripts/issue-quality-analysis.mjs 42 \
  --description "improved embedding fallback" \
  --verdict improved \
  --assessment "Query results now include correct auth files. Python repo handling is better." \
  --concerns "Rust repos still show low file counts"

# For batch analysis of recent commits
node scripts/batch-quality-analysis.mjs --since "7 days ago"
```

### When to skip

If the change is purely internal (CI scripts, documentation, type-only refactors,
test infrastructure) and does not touch any code path that affects query results,
the analysis can be skipped. The script auto-detects this — if it says "not
quality-sensitive", you can trust that.

---

## Milestone Execution Contract

Use this contract for autonomous issue implementation:

> You are implementing issues for LiBrainian in strict milestone order.
>
> Rules:
> 1) Work only on milestone `<ACTIVE_MILESTONE>` until all its open issues are resolved and verified.
> 2) Before touching code for any issue, ingest all open issues in the active milestone and produce a concise milestone context map (dependencies, shared modules, conflict risks).
> 3) Never bypass non-deterministic tests. If a test is flaky, fix determinism/root cause or formally evolve thresholds with evidence and rationale.
> 4) For retrieval/query/indexing/scoring/user-facing behavior changes, run `node scripts/issue-quality-analysis.mjs <issue> --description "..."` and include verdict + assessment.
> 5) Follow proof protocol: write failing proof test first, then fix, then run structural proof validators where required.
> 6) Keep changes minimal per issue; preserve behavior outside scope.
> 7) After each issue: run typecheck + relevant tests, summarize what changed, why it is correct, and residual risk.
> 8) Do not start next milestone until current milestone has green evidence and explicit go/no-go approval.

Reference docs:

- `docs/LiBrainian/MILESTONE_BRIEF.md`
- `docs/LiBrainian/GATING_POLICY.md`

---

## Do Not
1. Create more spec files, npm scripts, or docs — reduce, don't add
2. Work on M2/M3/M4 — the product doesn't work at M0
3. Close issues based on unit tests alone — require reality verification per `docs/LiBrainian/REALITY_VERIFICATION.md`
4. Mock LLM/embedding calls in integration tests — use `PredeterminedLlmService` or real providers
5. Modify evaluation infrastructure — keep scorer separate from scored

See `docs/archive/AGENTS_v1.md` for the full historical version of this file.
