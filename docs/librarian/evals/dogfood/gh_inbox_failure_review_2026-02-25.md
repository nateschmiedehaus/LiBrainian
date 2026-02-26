# GH Inbox Failure Review (2026-02-25)

Status: active triage input for issue #833
Scope: recurring CI/patrol failures and forward-looking process upgrades

## Reviewed Signals

- `gh api notifications` (CI activity burst on `main`)
- Recent failed runs from:
  - `ci`
  - `e2e-cadence`
  - `Agent Patrol`
  - `eval-corpus`

## Failure Snapshot

| Workflow | Run URL | Failure Point | Root Cause (from failed logs) |
| --- | --- | --- | --- |
| `ci` | `https://github.com/nateschmiedehaus/LiBrainian/actions/runs/22404411049` | `Unit and integration tests` | Three failing tests in CI profile: `evidence_manifest_preflight_script.test.ts`, `dogfood_ci_gate_stall.test.ts`, and a tight perf threshold in `hallucinated_api_detector.test.ts` (`209ms` vs `<200ms`). |
| `eval-corpus` | `https://github.com/nateschmiedehaus/LiBrainian/actions/runs/22404407010` | `Run eval corpus` | Missing artifact input: `ENOENT ... eval-corpus/repos/adversarial-circular-deps/.librarian-eval/manifest.json`. |
| `Agent Patrol` | `https://github.com/nateschmiedehaus/LiBrainian/actions/runs/22404406975` | `Run patrol (quick)` | Packaging/runtime contract break (`dist/evaluation/patrol_calibration.js` missing in installed tarball) plus CLI contract mismatch (`claude --print` with `--output-format stream-json` requires `--verbose`), yielding zero observations. |
| `e2e-cadence` | `https://github.com/nateschmiedehaus/LiBrainian/actions/runs/22404406968` | `Enforce E2E gate outcomes` | Aggregator failure after upstream gate failures (primary external natural-usage gate, diagnostics gate, outcome triage gate, development-truth tarball gate). |

## Forward-Looking Process Upgrades

1. Add packaging completeness gate before patrol/e2e
- Verify required dist files exist in tarball (`dist/evaluation/patrol_calibration.js` and other patrol runtime imports).
- Fail early with actionable file list before running patrol.

2. Add agent CLI invocation compatibility checks
- Preflight each agent command signature (`stream-json` requirements, supported flags).
- Block incompatible invocation before expensive patrol run.

3. Stabilize CI-sensitive assertions
- Replace hard wall-clock micro-thresholds with percentile/bounded-overhead profiles for CI hosts.
- Keep strict correctness checks; move host-noise-prone checks into dedicated perf profile.

4. Enforce eval corpus fixture integrity
- Add fixture-manifest validator that fails with a single actionable summary before `npm run eval:ci`.
- Ensure each repo in `eval-corpus/repos/*` has required `.librarian-eval/manifest.json` when included in strict runs.

5. Split gate outcomes by diagnosis class
- Keep fail-closed semantics, but tag failures as `contract`, `fixture`, `performance`, or `provider-cli` for faster triage and trend tracking.

## Why This Matters for #833

Natural usage credibility requires that patrol/e2e evidence runs are reliable and diagnosis-friendly. If gate failures are dominated by packaging/fixture contract breaks, dogfood metrics become noisy and agents are incentivized to avoid the system rather than rely on it.
