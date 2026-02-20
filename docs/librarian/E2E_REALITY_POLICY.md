# E2E Reality Policy

## Purpose
This policy enforces black-box package reality checks so releases cannot pass on in-repo tests alone.

## Scope
- npm package shape and runtime behavior
- External workspace install/use paths (CLI + programmatic API)
- CI cadence and release gating

## Required Gates
1. PR/verify gate:
   - Run strict tarball-based black-box E2E before publish (`npm run test:e2e:reality:tarball`).
2. Release gate:
   - `npm-publish` verify must pass strict tarball black-box E2E.
   - Publish auth must fail closed with actionable remediation if token/trusted publishing is misconfigured.
3. Cadence gate:
   - Scheduled `e2e-cadence` runs:
     - npm freshness check (`policy:npm:fresh`)
     - strict latest-published black-box E2E
     - strict tarball black-box E2E
     - acceptance E2E

## Artifact Contract
Reality gate scripts must emit JSON artifacts under `state/e2e/`:
- `RealityGateReport.v1`
- `ExternalBlackboxE2EReport.v1`

Each artifact includes:
- `schema_version`
- `kind`
- `status` (`passed|failed|skipped`)
- `source` (`latest|tarball`)
- `createdAt`
- optional `error` and `skipReason`

## Skip Policy
- Skips require explicit reason code via `LIBRARIAN_E2E_SKIP_REASON`.
- Strict mode (`--strict`) disallows skips and fails immediately.
- Release/verify and cadence jobs must run strict mode.

## Freshness Policy
- `npm latest` must match `package.json` version on release-intended `main` before strict published-package E2E.
- Drift is a release-trust failure and must be fixed by publish/remediation, not waived.

## Remediation Rules
- Auth failures:
  - Provide valid `NPM_TOKEN`/`NODE_AUTH_TOKEN`, or
  - explicitly allow trusted fallback only after npm trusted publishing is configured.
- Trusted publish failures must return actionable CI error text, not silent fallback behavior.
