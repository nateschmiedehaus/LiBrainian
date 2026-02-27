# GitHub Agentic Tool Review (2026-02-25)

Status: active reference for issue #833
Scope: natural-usage encouragement patterns for LiBrainian dogfooding
Method date: February 25, 2026

## Method

- Source: GitHub repository metadata + README docs.
- Query windows:
  - All-time (star-dominant, agentic coding tools)
  - Last month (`pushed:>=2026-01-26`)
  - Last week (`pushed:>=2026-02-18`)
- Because broad GitHub search returns noisy "awesome" lists, this review uses a curated set of high-adoption coding agents and agent-support systems.

## Curated Repo Snapshot

| Repo | Stars | Pushed At (UTC) | Notes |
| --- | ---: | --- | --- |
| `google-gemini/gemini-cli` | 95,657 | 2026-02-25T16:51:24Z | Terminal agent; scripted + interactive modes |
| `anthropics/claude-code` | 70,054 | 2026-02-25T14:37:12Z | Terminal-first coding agent |
| `OpenHands/OpenHands` | 68,175 | 2026-02-25T16:48:14Z | SDK + CLI + GUI surfaces |
| `openai/codex` | 61,874 | 2026-02-25T16:46:40Z | Lightweight CLI agent |
| `obra/superpowers` | 61,349 | 2026-02-25T16:51:48Z | Skill-based workflow layer for coding agents |
| `cline/cline` | 58,372 | 2026-02-25T08:09:15Z | IDE agent with explicit approvals |
| `Aider-AI/aider` | 40,944 | 2026-02-25T14:19:03Z | Terminal pair programming with git/test loops |
| `continuedev/continue` | 31,516 | 2026-02-25T09:34:57Z | Source-controlled AI checks and CI integration |
| `openai/skills` | 9,744 | 2026-02-21T04:07:45Z | Reusable skill catalog for Codex |

## Week/Month/All-Time Read

- All curated repos above are active in both the last month and last week windows.
- Week and month windows are currently dominated by the same top set because these projects push frequently.
- Practical implication for LiBrainian: adoption patterns should be compared against current top operators, not stale historical leaders.

## Natural-Usage Patterns Observed

1. Shortest-path onboarding
- Most repos present one install command plus one first-run command.
- Pattern to copy: one obvious entry path, no ceremony.

2. Natural-language first examples
- Getting-started examples are task-like (debug, explain architecture, run tests), not internal implementation terms.
- Pattern to copy: prompts in user language map to strong output contracts.

3. In-flow optional structure (not forced wrappers)
- Strong tools provide optional modes/checkpoints but do not require ritual command wrappers for every task.
- Pattern to copy: uncertainty-triggered nudges, not mandatory loops.

4. Evidence and CI coupling
- Top tools increasingly bind behavior to CI checks/artifacts.
- Pattern to copy: natural-usage and causal-lift metrics tied to gates.

5. Restraint and safety controls
- Common controls: read-only/planning modes, explicit approval for high-risk actions, and clear skip paths.
- Pattern to copy: measure and reward correct "do not use now" decisions.

## LiBrainian Gaps to Close

- Dogfood protocol lacked explicit spontaneous-adoption/causal/restraint thresholds.
- Existing run artifacts lacked ablation replay and per-task decision-change traces.
- Guidance emphasized "just query" but did not define when to skip querying.

## File-Level Actions

- Added thresholded matrix to: `docs/librarian/evals/dogfood/m0_qualitative_protocol.md`
- Added matrix status to: `docs/librarian/evals/dogfood/m0_qualitative_summary.md`
- Added artifact requirements to: `docs/librarian/evals/dogfood/m0_qualitative_runs/README.md`
- Added issue-closure evidence fields to: `docs/librarian/templates/ISSUE_CLOSURE_EVIDENCE_TEMPLATE.md`
- Added natural-usage heuristics to: `AGENTS.md`
