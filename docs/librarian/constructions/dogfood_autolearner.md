# Dogfood AutoLearner

`dogfood-autolearner` reads dogfood evidence artifacts and emits ranked interventions with explicit restraint.

## Purpose

Turn repeated manual diagnosis into a deterministic loop that proposes high-value actions first while avoiding forced ritual usage.

## Input Artifacts

- `natural_usage_metrics.csv`
- `ablation_replay.csv`
- `error_taxonomy.csv` (optional, but recommended)
- `tasks/*/decision_trace.md`

You can point the construction at a run directory and it will resolve default paths.

## Reproducible Command

```bash
npx librainian constructions run librainian:dogfood-autolearner \
  --input '{"runDir":"docs/librarian/evals/dogfood/m0_qualitative_runs/20260225-193500Z"}'
```

## Output

Returns deterministic JSON plus a Markdown plan:

- `topInterventions` (ranked)
- `applyNow` and `observeOnly`
- `healthBand`
- `noOpReason` when metrics are healthy
- `markdownPlan` for issue-ready action planning

## Recommendation Semantics

- `apply_now`: high-confidence, high-impact intervention.
- `observe_only`: monitor/instrument first.
- `no_op`: explicitly keep current behavior when metrics are healthy.

## Notes

- Known failure classes (lock, timeout/no-output) are mapped to corresponding fix directions.
- Model-policy fallback signals (`model policy provider not registered`) are treated as intervention-worthy for strict dogfood/release evidence quality.
- When the system is healthy, the construction emits no-op guidance to preserve restraint.
