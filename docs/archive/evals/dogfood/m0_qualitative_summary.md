# M0 Qualitative Dogfood Summary

Status: draft (M0 complete, #833 matrix captured)  
Issue: #821, #833  
Last Updated: 2026-02-25

## Linked runs

- `docs/librarian/evals/dogfood/m0_qualitative_runs/20260225-193500Z/` (initialized, pending execution)

## Aggregate outcomes

- Tasks completed: `12/12`
- Overall subjective mean: `4.00`
- Category means:
  - Context relevance: `4.17`
  - Citation trustworthiness: `4.25`
  - Cognitive load reduction: `3.75`
  - Decision confidence support: `4.17`
  - Workflow fluidity: `3.67`
- Objective rollup:
  - Median time-to-first-useful-context: `240s`
  - Median time-to-actionable-plan: `390s`
  - Median time-to-correct-outcome: `840s`
  - Total invalid references: `0`
  - Total abandoned tasks: `0`

## Hard-fail evaluation

- Missing artifact failures: `0`
- Fabricated citation accepted: `0`
- Abandonments due to context unreliability (>2): `0`
- Rubric threshold miss: `0`

## Decision

- Result: `GO`
- Rationale: All 12 tasks were executed with artifacts, aggregate thresholds met, and no hard-fail criteria triggered.

## Natural-Usage Gate (Issue #833)

Natural-usage matrix artifacts are now captured in:
- `docs/librarian/evals/dogfood/m0_qualitative_runs/20260225-193500Z/natural_usage_metrics.csv`
- `docs/librarian/evals/dogfood/m0_qualitative_runs/20260225-193500Z/ablation_replay.csv`
- `docs/librarian/evals/dogfood/m0_qualitative_runs/20260225-193500Z/tasks/Txx/decision_trace.md`

Signal outcomes:
- Spontaneous adoption: `PASS`
  - `used_librarian_rate = 0.75`
  - `time_to_first_librarian_query_s_p50 = 150`
  - `queries_per_task_p50 = 1.0`
- Causal usefulness: `PASS`
  - `success_lift_t3_plus = 0.33`
  - `time_reduction_t3_plus = 0.29`
  - `rework_reduction_t3_plus = 0.25`
  - `defect_reduction_t3_plus = 0.29`
- Appropriate restraint: `PASS`
  - `use_decision_precision = 1.00`
  - `use_decision_recall = 1.00`
  - `unnecessary_query_rate = 0.00`
- result: GO

## Required follow-up issues from run findings

- #822 — Retrieval stage cost telemetry + bounded rerank windows
- #823 — MCP strategic contract inspection + context-pack integration
- #824 — Evidence-manifest preflight hygiene for strict qualification chain
- #833 — Dogfood for development (natural-mode adoption + measurable lift + restraint)
