# Dogfood Bootstrap Stall Detection and Recovery

This document defines operator-facing behavior for clean-clone dogfood runs when bootstrap loses forward progress.

## Detection Policy

- Command: `scripts/dogfood-ci-gate.mjs`
- Hard timeout: `--bootstrap-timeout-ms` (default from `DOGFOOD_CI_BOOTSTRAP_TIMEOUT_MS`)
- Stall timeout: `--bootstrap-stall-timeout-ms` (default from `DOGFOOD_CI_BOOTSTRAP_STALL_TIMEOUT_MS`)
- Stall condition:
  - no new stdout/stderr activity for the configured stall timeout window
  - process still alive
- Failure message:
  - `stall_detected: bootstrap produced no output for <N>ms`

## Recovery Safety Policy

- Recovery scope is strictly limited to the stalled process group launched by dogfood CI.
- The runner never executes blind global termination (no wildcard `pkill` policy).
- Recovery audit records:
  - root pid
  - descendant pids targeted for termination
  - pre/post process snapshots
  - signals issued and outcomes
  - pids still alive after termination attempts

## Artifact Diagnostics

`state/dogfood/clean-clone-self-hosting*.json` includes:

- `timeouts.bootstrapStallTimeoutMs`
- per command:
  - `stalled`
  - `timedOut`
  - `terminationReason`
  - `heartbeatTimeline`
  - `stageTimeline`
  - `recoveryAudit`

## Usage by Context

## Local development

- Use a lower stall timeout while iterating:
  - `node scripts/dogfood-ci-gate.mjs --bootstrap-stall-timeout-ms 45000`
- Keep sandbox for post-mortem:
  - add `--keep-sandbox`

## CI

- Keep conservative timeout defaults for large runs.
- Treat `stall_detected` as a hard gate failure.
- Always upload the artifact for diagnostics.

## Installed-user external projects

- Same stall policy applies.
- Recovery remains scoped to the process tree started by the run, avoiding unrelated user processes.
