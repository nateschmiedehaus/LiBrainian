# Session Evidence: 2026-02-25 / #833 / Observability Root-Cause (Natural Failure)

- `session_id`: 2026-02-25-s3
- `date_utc`: 2026-02-25
- `issue`: #833
- `task_category`: feature
- `task_summary`: Define minimal internal observability for natural usage measurement.

## Natural Usage Decision

- `used_librarian`: yes
- `why`: High uncertainty on best insertion points for telemetry and decision traces.
- `skip_reason_if_no`: n/a
- `what_would_make_librarian_more_useful_if_skipped`: n/a

## Queries and Outputs

- `query_1`: `npx librainian query "Where should we add minimal internal telemetry events for query/planning/execution to support natural usage metrics?" --offline`
- `output_quality`: not_helpful
- `what_changed_due_to_output`: Output returned low-coherence unrelated packs; switched to direct code inspection (`src/api/query_*observability*`, `src/measurement/observability.ts`, `src/telemetry/logger.ts`).

## Outcome Signals

- `task_outcome`: success
- `time_impact`: slower
- `rework_loops`: 2
- `defect_or_risk_prevented`: Avoided wiring telemetry to irrelevant surfaces by validating against real files.

## Failure/Gap Notes

- `natural_failure`: yes
- `failure_description`: Intent mapping for process/meta telemetry queries was weak; also observed storage lock friction in adjacent runs.
- `follow_up_issue`: #834
