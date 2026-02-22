# Issue Triage Rubric

This rubric keeps intake lightweight while protecting execution velocity on critical reliability work.

## Required labels

Every actionable issue must carry one label from each family:

- `severity:*` (`critical`, `high`, `medium`, `low`)
- `area:*` (`cli`, `mcp`, `indexing`, `retrieval`, `bootstrap`, `docs`, `ci-release`, `evaluation`, `security`, `process`)
- `evidence-needed:*` (`repro-required`, `traces-required`, `benchmark-required`)
- `user-impact:*` (`blocker`, `degraded`, `minor`, `request`)

If intake fields are incomplete, the issue is labeled `triage/missing-essentials`.

Additionally, every actionable issue must be categorized as one of:

- `ship-blocking`
- `post-ship`

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
5. Run automated hygiene pass with strict thresholds:
   - `ship-blocking` vs `post-ship` classification is required.
   - Issues missing essentials auto-close after 14 days from creation.
   - Issues with no meaningful activity auto-close after 90 days.
   - If >100 open issues remain, close oldest `post-ship` issues until count is below cap.
   - Ensure top 10 `ship-blocking` issues are pinned.
   - Noise-only comments (`bump`, `ping`, short acknowledgements, and checklist reminders) do not count as meaningful activity.

## Active sprint admission rule

An issue enters active sprint only if:

- It is `triage/ready`.
- It has all required label families.
- Acceptance criteria are implementation-testable.
- No unresolved blocker dependency exists.

## Backlog hygiene rule

Issues older than 90 days without meaningful activity and without `triage/ready` should be either:

- Updated with missing essentials, or
- Closed with reason (`needs-more-evidence`, `duplicate`, `out-of-scope`).
