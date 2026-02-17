# Testing Discipline Hardening

This document tracks the ten process weaknesses we addressed and how they are now enforced in code.

1. Agent vs deterministic ambiguity → enforce pure `agent_command`, no unsupported modes, and diagnostics/results mode parity.
2. Missing baseline-to-fix causality → require agent runs, explicit baseline/test verdicts, and baseline-fail + post-fix-pass per run.
3. Treatment-context leakage → enforce treatment context presence and zero control contamination.
4. Incomplete run evidence → require artifact integrity + verification command coverage + explicit verification policy.
5. Fallback tolerance in release paths → fail closed on fallback and strict markers across AB/use-case/live-fire/smoke/composition artifacts.
6. Narrow use-case validation → enforce repo/use-case breadth plus quality-rate floors.
7. Weak live-fire protocol coverage → enforce disabled+optional mode coverage and objective quality floors.
8. Repo-count-only smoke checks → enforce cross-language smoke coverage plus summary/result reconciliation.
9. Composition ranking blind spot → enforce non-empty scenario set, top-1 accuracy, and top-3 recall thresholds.
10. Unproven constructable adaptability → enforce language-diverse constructable auto-selection with zero missing language-pattern mappings.

Primary enforcement entrypoint:

- `npm run eval:testing-discipline`
- `npm run eval:testing-tracker`
- `LiBrainian publish-gate --profile release` (now requires the testing-discipline artifact and all ten checks passing with zero warnings)

Notes:

- `npm run eval:testing-discipline` now loads `state/eval/compositions/CompositionUtilityReport.v1.json` when present; only falls back to computed defaults when the artifact is absent.
- Any failed testing-discipline check now returns non-zero exit for the script.

Artifact produced:

- `state/eval/testing-discipline/report.json`
- `state/eval/testing-discipline/testing-tracker.json`
- `docs/LiBrainian/TESTING_TRACKER.md` (auto-generated snapshot of fixed/open/unknown flaws)
