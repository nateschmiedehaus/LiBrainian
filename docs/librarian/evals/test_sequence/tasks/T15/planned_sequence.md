# Planned Sequence — T15

- task_label: under_select_escalation_case

## Ordered Stages
1. targeted
- rationale: Impact-matched tests for changed files, symbols, and intent-driven coverage.
- confidence: 0.350
- tests/regression/generic_pipeline.regression.test.ts
- tests/integration/generic_pipeline.integration.test.ts
2. fallback
- rationale: Escalate to broader suite because confidence is low or targeted coverage is sparse.
- confidence: 0.350
- escalation_trigger: confidence 0.35 below threshold 0.95
- npm test -- --run

## Planner skipped tests (4)
- tests/unit/core_math_smoke.test.ts
- tests/unit/core_math.test.ts
- tests/e2e/generic_flow.e2e.test.ts
- tests/unit/unrelated_math_utils.test.ts

## Escalation
- enabled: true
- reason: low_confidence

## Runtime
- baseline_runtime_sec: 650.0
- planner_runtime_sec: 930.0
- runtime_reduction_pct: -43.08
