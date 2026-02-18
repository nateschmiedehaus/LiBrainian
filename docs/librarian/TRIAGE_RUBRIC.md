# Issue Triage Rubric

This rubric keeps intake lightweight while protecting execution velocity on critical reliability work.

## Required labels

Every actionable issue must carry one label from each family:

- `severity:*` (`critical`, `high`, `medium`, `low`)
- `area:*` (`cli`, `mcp`, `indexing`, `retrieval`, `bootstrap`, `docs`, `ci-release`, `evaluation`, `security`, `process`)
- `evidence-needed:*` (`repro-required`, `traces-required`, `benchmark-required`)
- `user-impact:*` (`blocker`, `degraded`, `minor`, `request`)

If intake fields are incomplete, the issue is labeled `triage/missing-essentials`.

## Intake essentials

Issues are triage-ready only when all three are present:

1. Impact
2. Repro evidence (commands/logs/traces/metrics)
3. Acceptance criteria

Ready issues receive `triage/ready`.

## Weekly triage cadence

Run once per week (recommended: Monday) and review only `triage/ready` issues.

1. Validate label correctness (`severity`, `area`, `evidence-needed`, `user-impact`).
2. Check that acceptance criteria are testable and specific.
3. Move each issue to one of:
   - **Active sprint**: `severity: critical` or `user-impact: blocker`, plus clear repro and bounded scope.
   - **Next-up queue**: `severity: high` with validated impact and low dependency risk.
   - **Backlog**: medium/low severity or missing enabling dependencies.
4. For backlog items, add a short defer reason and dependency notes.

## Active sprint admission rule

An issue enters active sprint only if:

- It is `triage/ready`.
- It has all required label families.
- Acceptance criteria are implementation-testable.
- No unresolved blocker dependency exists.

## Backlog hygiene rule

Issues older than 30 days without `triage/ready` should be either:

- Updated with missing essentials, or
- Closed with reason (`needs-more-evidence`, `duplicate`, `out-of-scope`).
