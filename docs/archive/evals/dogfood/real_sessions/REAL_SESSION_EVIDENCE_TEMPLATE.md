# Real Session Evidence Template (Issue #833)

- `session_id`: <id>
- `date_utc`: <YYYY-MM-DD>
- `issue`: <#number>
- `task_category`: `bug` | `feature` | `refactor` | `test-impact`
- `task_summary`: <one-line summary>

## Natural Usage Decision

- `used_librarian`: yes|no
- `why`: <why it was used or skipped>
- `skip_reason_if_no`: `low_uncertainty` | `deterministic_edit` | `already_resolved` | `other`
- `what_would_make_librarian_more_useful_if_skipped`: <short, generalizable note>

## Queries and Outputs

- `query_1`: <query text>
- `output_quality`: helpful|partial|not_helpful
- `what_changed_due_to_output`: <decision change, if any>

## Outcome Signals

- `task_outcome`: success|partial|failed
- `time_impact`: faster|neutral|slower
- `rework_loops`: <integer>
- `defect_or_risk_prevented`: <short note>

## Failure/Gap Notes

- `natural_failure`: yes|no
- `failure_description`: <if yes>
- `follow_up_issue`: <#number if created>
