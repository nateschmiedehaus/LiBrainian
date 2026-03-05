# Milestone Gating Policy

Last updated: 2026-03-01

## 1) Ordering Policy

Within an active milestone, order issues using these rules:

1. Ship-blocking/critical labels first.
2. Resolve upstream dependencies before downstream consumers.
3. Prefer issues that unblock multiple queued issues.
4. Keep batch size small: one active issue unless two issues are provably independent.

Milestone accounting rules:

- `total` = every open issue assigned to the milestone
- `executable_source` = open issues that are not management/meta, tracking, frozen, or post-ship
- `execution_ready` = executable source issues minus `triage/missing-essentials`
- Milestone completion is based on `executable_source`, not raw milestone totals

Workspace integrity rules:

- Dirty worktree state is part of run control and must be assessed before implementation work.
- Pre-existing dirty files are foreign state until proven otherwise.
- Salvage commits may include only agent-owned delta created after the run baseline snapshot.
- If agent work overlaps with pre-existing dirty files, the run must surface that explicitly and avoid implicit salvage.

Cross-milestone rule:

- Only one active milestone at a time.
- `M0 -> M1` only until explicit unfreeze decision.

## 2) Definition of Done (Per Issue)

An issue is "done" only when all applicable checks pass:

1. Typecheck: `npx tsc --noEmit`
2. Targeted tests covering changed behavior
3. Required quality analysis for quality-sensitive changes:
   - `node scripts/issue-quality-analysis.mjs <issue_number> --description "..."`
4. No unresolved regressions introduced in adjacent critical flows
5. Evidence posted in PR/issue comment (what changed, tests, risks)

## 3) Non-Deterministic Test Policy

- Never bypass flaky/expensive tests as a closure strategy.
- Stabilize tests by fixing root cause, timing contracts, fixtures, or deterministic bounds.
- If thresholds evolve, include explicit rationale and before/after evidence.

## 4) Milestone Transition Go/No-Go Template

Use this template before starting the next milestone:

- Milestone: `<Mx>`
- Open count at review: `<N>`
- Executable source count: `<N>`
- Execution-ready count: `<N>`
- Ship-blocking issues remaining: `<list>`
- Evidence summary:
  - typecheck status
  - required issue-quality-analysis coverage
  - reality/patrol artifacts
- Risks and residual unknowns
- Decision: `GO` or `NO-GO`
- Approver: `<human>`
- Timestamp: `<ISO-8601>`

## 5) Blocked-Issue Escalation

If an issue is blocked:

1. Mark blocked reason explicitly (dependency/tooling/external/API/auth/data).
2. Post unblock options with tradeoffs.
3. Move to next dependency-independent issue in the same milestone.
4. Revisit blocked issue in the next wave; do not silently skip.

For M0 specifically:

- tracking/umbrella parents do not block milestone completion directly
- post-ship issues do not block milestone completion
- management/meta tickets do not block milestone completion
- only the true executable M0 source set counts toward M0 pass/fail

## 6) Evidence Discipline

- Do not close issues on unit tests alone when behavior is user-facing.
- Do not use fallback/degraded/unverified output as release evidence.
- Keep a direct trace from issue -> commit -> tests -> quality analysis -> closure comment.
