# Planned Sequence — T04

- task_label: query_cache_invalidation

## Ordered Stages
1. smoke
- rationale: Fast, high-signal smoke checks first to detect immediate breakage in impacted surfaces.
- confidence: 0.910
- tests/unit/query_cache_smoke.test.ts
- tests/unit/query_cache.test.ts
2. targeted
- rationale: Impact-matched tests for changed files, symbols, and intent-driven coverage.
- confidence: 0.910
- tests/integration/query_cache.integration.test.ts
- tests/regression/query_cache.regression.test.ts

## Planner skipped tests (2)
- tests/e2e/query_cache.e2e.test.ts
- tests/unit/unrelated_math_utils.test.ts

## Escalation
- enabled: false
- reason: failure

## Runtime
- baseline_runtime_sec: 650.0
- planner_runtime_sec: 375.0
- runtime_reduction_pct: 42.31
