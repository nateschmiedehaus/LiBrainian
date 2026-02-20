# E2E Reality Policy

## Purpose
This policy enforces black-box package reality checks so releases cannot pass on in-repo tests alone.

## Scope
- npm package shape and runtime behavior
- External workspace install/use paths (CLI + programmatic API)
- Outcome-level control-vs-treatment evidence with disconfirmation criteria
- CI cadence and release gating

## Required Gates
1. PR/verify gate:
   - Run strict outcome diagnostics (`npm run test:e2e:outcome`).
   - Run strict tarball-based black-box E2E before publish (`npm run test:e2e:reality:tarball`).
2. Release gate:
   - `npm-publish` verify must pass strict outcome diagnostics and strict tarball black-box E2E.
   - Publish auth must fail closed with actionable remediation if token/trusted publishing is misconfigured.
3. Cadence gate:
   - Scheduled `e2e-cadence` runs:
     - strict outcome diagnostics
     - npm freshness check (`policy:npm:fresh`)
     - strict latest-published black-box E2E
     - strict tarball black-box E2E
     - acceptance E2E

## Artifact Contract
Reality gate scripts must emit JSON artifacts under `state/e2e/`:
- `E2EOutcomeReport.v1`
- `RealityGateReport.v1`
- `ExternalBlackboxE2EReport.v1`

Each artifact includes:
- `schema_version`
- `kind`
- `status` (`passed|failed|skipped`)
- `source` (`latest|tarball`)
- `createdAt`
- optional `error` and `skipReason`

`E2EOutcomeReport.v1` must include:
- natural-task coverage and repo diversity
- paired control-vs-treatment deltas
- confidence interval + disconfirmation reasons
- evidence-linked wins/regressions
- freshness checks for source artifacts

## Skip Policy
- Skips require explicit reason code via `LIBRARIAN_E2E_SKIP_REASON`.
- Strict mode (`--strict`) disallows skips and fails immediately.
- Release/verify and cadence jobs must run strict mode.

## Freshness Policy
- `npm latest` must match `package.json` version on release-intended `main` before strict published-package E2E.
- Drift is a release-trust failure and must be fixed by publish/remediation, not waived.
- Outcome evidence must be fresh (`maxAgeHours` threshold) and fail closed when stale, skipped, or missing.

## Remediation Rules
- Auth failures:
  - Provide valid `NPM_TOKEN`/`NODE_AUTH_TOKEN`, or
  - explicitly allow trusted fallback only after npm trusted publishing is configured.
- Trusted publish failures must return actionable CI error text, not silent fallback behavior.
