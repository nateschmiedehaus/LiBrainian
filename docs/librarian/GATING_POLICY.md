# Milestone Gating Policy

Last updated: 2026-03-01

## 1) Ordering Policy

Within an active milestone, order issues using these rules:

1. Ship-blocking/critical labels first.
2. Resolve upstream dependencies before downstream consumers.
3. Prefer issues that unblock multiple queued issues.
4. Keep batch size small: one active issue unless two issues are provably independent.

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

## 6) Evidence Discipline

- Do not close issues on unit tests alone when behavior is user-facing.
- Do not use fallback/degraded/unverified output as release evidence.
- Keep a direct trace from issue -> commit -> tests -> quality analysis -> closure comment.

