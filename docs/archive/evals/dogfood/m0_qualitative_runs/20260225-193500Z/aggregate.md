# Aggregate metrics (run: 20260225-193500Z)

Status: complete

## Coverage checks

- Total tasks planned: 12
- Tasks completed: 12
- Bug triage/fix: 3
- Feature extension: 3
- Architecture/navigation: 3
- Test-failure diagnosis: 3
- Unfamiliar tasks planned: 8
- Underspecified prompts planned: 9
- Cross-file tasks planned: 10

## Threshold checks (interim)

- Overall subjective mean >= 4.0: pass (4.03 interim)
- No category mean < 3.5: pass (lowest 3.63 interim)
- Critical trustworthiness incident unresolved: none observed so far
- Hard-fail criteria check: pass so far (no missing artifacts for completed tasks, no fabricated references, no reliability abandonments)

## Interim observation

- Completed tasks: T01, T02, T03, T04, T05, T06, T07, T08, T09, T10, T11, T12
- No invalid references observed in completed tasks.
- Primary friction observed: large retrieval pipeline complexity increases analysis time and cognitive load.

## Natural-usage matrix (Issue #833)

- Spontaneous adoption:
  - `used_librarian_rate = 0.75` (pass, threshold `>=0.70`)
  - `time_to_first_librarian_query_s_p50 = 150` (pass, threshold `<=180`)
  - `queries_per_task_p50 = 1.0` (pass, threshold `>=1 and <=6`)
- Causal usefulness (ablation replay):
  - `success_lift_t3_plus = 0.33` (pass, threshold `>=0.25`)
  - `time_reduction_t3_plus = 0.29` (pass, threshold `>=0.20`)
  - `rework_reduction_t3_plus = 0.25` (pass, threshold `>=0.20`)
  - `defect_reduction_t3_plus = 0.29` (pass, threshold `>=0.20`)
- Appropriate restraint:
  - `use_decision_precision = 1.00` (pass, threshold `>=0.80`)
  - `use_decision_recall = 1.00` (pass, threshold `>=0.75`)
  - `unnecessary_query_rate = 0.00` (pass, threshold `<=0.20`)

Artifacts:
- `natural_usage_metrics.csv`
- `ablation_replay.csv`
- `tasks/Txx/decision_trace.md` (T01..T12)
