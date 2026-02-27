# Planned Sequence — T11

- task_label: search_ranking_weights

## Ordered Stages
1. smoke
- rationale: Fast, high-signal smoke checks first to detect immediate breakage in impacted surfaces.
- confidence: 0.910
- tests/unit/ranking_weights_smoke.test.ts
- tests/unit/ranking_weights.test.ts
2. targeted
- rationale: Impact-matched tests for changed files, symbols, and intent-driven coverage.
- confidence: 0.910
- tests/integration/ranking_weights.integration.test.ts
- tests/regression/ranking_weights.regression.test.ts

## Planner skipped tests (2)
- tests/e2e/ranking_weights.e2e.test.ts
- tests/unit/unrelated_math_utils.test.ts

## Escalation
- enabled: false
- reason: failure

## Runtime
- baseline_runtime_sec: 650.0
- planner_runtime_sec: 375.0
- runtime_reduction_pct: 42.31
