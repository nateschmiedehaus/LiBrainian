# Impact-Aware Test Sequence Evaluation Methodology

Issue: #838  
Updated: 2026-02-26

## Goal

Provide a reproducible M1 evaluation for:

- `>=15` representative tasks,
- median runtime reduction target `>=30%` against a baseline full-sequence policy,
- regression-safety checks with explicit known-failure coverage,
- at least one under-selection scenario that escalates to broader fallback.

## Harness

Generation command:

```bash
npm run eval:test-sequence:impact-aware
```

This script:

1. Executes `impact-aware-test-sequence-planner` on 15 scenario tasks.
2. Computes baseline runtime as running every candidate test in the task catalog.
3. Computes planner runtime as selected tests plus fallback runtime when escalation triggers.
4. Validates known-failure detection:
   - pass if known failing tests are selected directly, or fallback is triggered.
5. Emits:
   - `docs/librarian/evals/test_sequence/impact_aware_baseline_vs_planner.csv`
   - `docs/librarian/evals/test_sequence/tasks/Txx/decision_trace.md`
   - `docs/librarian/evals/test_sequence/tasks/Txx/planned_sequence.md`

## Baseline and Runtime Model

- Baseline policy for each task: run all available tests (`smoke + targeted + regression + e2e + unrelated`).
- Planner policy: run only selected tests; add fallback broad-suite cost when escalation is enabled.
- Runtime values are deterministic per test type for stable comparison:
  - smoke: 35s
  - unit: 60s
  - integration: 130s
  - regression/contract: 150s
  - e2e: 220s
  - unrelated unit: 55s

## Under-Selection Escalation Case

Task `T15` intentionally uses low-match changed-file signals and high fallback threshold, forcing under-selection + escalation. This verifies safety behavior when planner confidence is insufficient.

## Caveats

- This M1 harness uses deterministic runtime weights rather than host-variant wall-clock execution of each task matrix.
- Purpose is relative policy comparison and safety behavior validation in a stable, reproducible path.
- Future phases should add live timed command execution over sampled real repos as a stricter runtime benchmark.
