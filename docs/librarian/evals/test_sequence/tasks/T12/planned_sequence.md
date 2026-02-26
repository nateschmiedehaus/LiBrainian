# Planned Sequence — T12

- task_label: watcher_recovery_path

## Ordered Stages
1. smoke
- rationale: Fast, high-signal smoke checks first to detect immediate breakage in impacted surfaces.
- confidence: 0.930
- tests/unit/file_watcher_recovery_smoke.test.ts
- tests/unit/file_watcher_recovery.test.ts
2. targeted
- rationale: Impact-matched tests for changed files, symbols, and intent-driven coverage.
- confidence: 0.930
- tests/e2e/file_watcher_recovery.e2e.test.ts
- tests/integration/file_watcher_recovery.integration.test.ts
3. regression
- rationale: Regression/contract checks for bug-risk and behavior-drift containment.
- confidence: 0.930
- tests/regression/file_watcher_recovery.regression.test.ts

## Planner skipped tests (1)
- tests/unit/unrelated_math_utils.test.ts

## Escalation
- enabled: false
- reason: failure

## Runtime
- baseline_runtime_sec: 650.0
- planner_runtime_sec: 595.0
- runtime_reduction_pct: 8.46
