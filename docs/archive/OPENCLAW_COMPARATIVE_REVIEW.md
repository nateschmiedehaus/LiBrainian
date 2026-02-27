# OpenClaw Comparative Review for LiBrainian Reliability

Date: 2026-02-11  
Source reviewed: `/tmp/openclaw-review-JasKex/openclaw` (cloned from `https://github.com/openclaw/openclaw`)

## Why this comparison matters

OpenClaw is not a LiBrainian-equivalent product, but it is strong at one thing LiBrainian must also excel at: deterministic, operationally trustworthy CLI behavior under stress and failure.

## Top-10 adoptions (prioritized)

1. **Timeout + abort propagation as a contract**
   - Status: adopted in live-fire journey/smoke orchestration.
   - Acceptance: timeout emits fail-closed reason and leaves no long-lived workers.

2. **Mandatory cleanup in all execution paths**
   - Status: adopted for journey/smoke shutdown via `finally`.
   - Acceptance: injected errors still trigger cleanup and artifact emission.

3. **JSON-first operational output**
   - Status: partially adopted (`journey`, `smoke`, `live-fire`, `ab`).
   - Next: enforce schema/version marker on all diagnostic subcommands.

4. **Diagnosis output must include remediation actions**
   - Status: partially adopted.
   - Next: convert doctor diagnostics into machine-actionable fix steps per failure class.

5. **Fail-closed prerequisites at command start**
   - Status: mostly adopted in journey/smoke.
   - Next: align all evaluation commands to block on missing critical prerequisites by default.

6. **Artifact-first debugging workflow**
   - Status: adopted in live-fire/journey/smoke/ab.
   - Acceptance: stable `latest.json` pointers emitted for smoke, journey, and live-fire profile/matrix runs.

7. **Stress-path regression tests for cancellation lifecycle**
   - Status: partially adopted.
   - Next: add explicit process-leak assertions in CI for timeout scenarios.

8. **Tight objective gates with explicit reasons**
   - Status: adopted (gate reasons + severity/category classification in live-fire/ab).
   - Acceptance: gate reasons are emitted with severity/category counters for triage.

9. **Reference execution worker for harness validation**
   - Status: adopted (`scripts/ab-agent-reference.mjs`).
   - Next: keep separate from benchmark claims to avoid conflating harness health with agent quality.

10. **Portable reliability profile for publish readiness**
   - Status: partial.
   - Next: define a single “publish gate” runbook with required commands and pass thresholds.

## Top-5 anti-patterns to avoid

1. **Passing despite missing critical measurements**
   - Risk: false confidence.
   - Guard: fail readiness claims when required dimensions are unmeasured.

2. **Silent fallback that changes semantics**
   - Risk: hidden quality regression.
   - Guard: explicit fallback artifact + labeled reason + strict mode to reject fallback.

3. **Conflating harness health with agent superiority**
   - Risk: invalid benchmark claims.
   - Guard: separate “harness sanity” from “treatment > control lift” reporting.

4. **Using toy edit tasks as proxy for debugging ability**
   - Risk: inflated success rates.
   - Guard: enforce baseline-failing bugfix tasks with objective post-fix verification.

5. **Provider outages treated as acceptable degradation in quality claims**
   - Risk: non-reproducible production behavior.
   - Guard: fail-closed for worldclass/publish gates when critical providers are unavailable.

## Implemented adoptions in this cycle

1. Live-fire timeout path uses abort propagation and fail-closed errors.
2. Journey and smoke guarantee `shutdown()` execution in `finally`.
3. Added objective bugfix A/B taskpack: `eval-corpus/ab-harness/tasks.agentic_bugfix.json`.
4. Added reference worker for deterministic harness verification: `scripts/ab-agent-reference.mjs`.
5. Added timeout guards to direct CLI workflows:
   - `LiBrainian journey --timeout-ms ...`
   - `LiBrainian smoke --timeout-ms ...`
6. Added stable latest pointers:
   - `state/eval/journey/latest.json`
   - `state/eval/smoke/latest.json`
   - `state/eval/live-fire/<profile>/latest.json`
   - `state/eval/live-fire/latest.json`
7. Added external smoke fail-closed per-repo timeout and live progress artifact:
   - `unverified_by_trace(smoke_repo_timeout): <repo> exceeded <ms>`
   - `state/eval/smoke/external/<run>/progress.json`

## Remaining high-impact deltas

1. Add CI assertion that no `journey` or `smoke` child process remains after forced timeout.
2. Add doctor output mode that emits machine-actionable repair steps (`code + command + expected artifact`) per failure class.
3. Add live-fire matrix drift detector comparing current vs previous `latest.json` so regressions fail CI immediately.
