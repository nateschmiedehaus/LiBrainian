# Planned Sequence — T01

- task_label: auth_session_idle_logout

## Ordered Stages
1. smoke
- rationale: Fast, high-signal smoke checks first to detect immediate breakage in impacted surfaces.
- confidence: 0.910
- tests/unit/session_refresh_smoke.test.ts
- tests/unit/session_refresh.test.ts
2. targeted
- rationale: Impact-matched tests for changed files, symbols, and intent-driven coverage.
- confidence: 0.910
- tests/integration/session_refresh.integration.test.ts
- tests/regression/session_refresh.regression.test.ts

## Planner skipped tests (2)
- tests/e2e/session_refresh.e2e.test.ts
- tests/unit/unrelated_math_utils.test.ts

## Escalation
- enabled: false
- reason: failure

## Runtime
- baseline_runtime_sec: 650.0
- planner_runtime_sec: 375.0
- runtime_reduction_pct: 42.31
