# E2E Reality Policy

## Purpose
This policy enforces black-box package reality checks so releases cannot pass on in-repo tests alone.

## Scope
- npm package shape and runtime behavior
- External workspace install/use paths (CLI + programmatic API)
- Outcome-level control-vs-treatment evidence with disconfirmation criteria
- External-agent natural-usage critique evidence
- CI cadence and release gating

## Priority Rule
- Full external natural-usage E2E is authoritative.
- AB control-vs-treatment runs are diagnostic support, not a substitute for full external natural-usage E2E.
- If there is a conflict, prioritize fixing full external natural-usage E2E failures first.

## Truth Lanes
- Development truth lane (current `main`): install from current tarball and run strict reality gate (`test:e2e:dev-truth`).
- Published truth lane (`npm latest`): run freshness guard + strict latest-published reality gate (`test:e2e:reality`).
- Both lanes are required in cadence/release verification; this prevents testing only published state while missing current development regressions.

## Required Gates
1. PR/verify gate:
   - Run primary external natural-usage E2E (`npm run eval:use-cases:agentic:quick` for cadence, `npm run eval:use-cases:agentic` for release verification).
   - Run strict outcome diagnostics (`npm run test:e2e:outcome`).
   - Run diagnosis triage (`npm run test:e2e:triage`) to classify immediate-action vs issue candidates.
   - Run strict development-truth tarball E2E (`npm run test:e2e:dev-truth`).
   - Run strict published-truth E2E with freshness (`npm run test:e2e:reality`).
   - Run AB diagnostics as a secondary signal (`npm run test:e2e:diagnostic:ab:quick` / `npm run test:e2e:diagnostic:ab:release`).
2. Release gate:
   - `npm-publish` verify must pass primary external natural-usage E2E, strict outcome diagnostics, and strict development-truth tarball E2E.
   - Publish auth must fail closed with actionable remediation if token/trusted publishing is misconfigured.
3. Cadence gate:
   - Commit-driven `e2e-cadence` runs (aggressive):
     - on push commits
     - on pull-request commit updates (`opened`, `synchronize`, `reopened`, `ready_for_review`)
     - strict outcome diagnostics
     - strict development-truth tarball E2E
     - strict latest-published black-box E2E (includes freshness check)
     - acceptance E2E

## Artifact Contract
Reality gate scripts must emit JSON artifacts under `state/e2e/`:
- `E2EOutcomeReport.v1`
- `E2EOutcomeTriage.v1`
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
- agent-command critique share for external runs
- open-ended exploratory diagnostics across external repos (observations, concern signals, coverage)
- confidence interval + disconfirmation reasons
- evidence-linked wins/regressions
- freshness checks for source artifacts
- diagnoses + suggested remediation actions

## External Agent Critique Contract
- External agent runs must do real task execution on external repositories before critique.
- Prompt contract must require two outcomes in the same run:
  - natural task execution intended to produce useful work
  - explicit critique/diagnosis of LiBrainian usage quality
- Agent critique payload must be structured and machine-verifiable, including:
  - overall summary
  - work outcome (`failed|partial|successful`)
  - LiBrainian effectiveness rating (`poor|mixed|good|excellent`)
  - confidence (`0..1`)
  - issue list with perspective/severity/diagnosis/recommendation
  - actionable suggestions
- Agent critique payload is emitted between markers:
  - `AB_AGENT_CRITIQUE_JSON_START`
  - `AB_AGENT_CRITIQUE_JSON_END`
- Critique coverage is diagnostic; it must not be the sole strict gate for full E2E.
- Full E2E must always include open-ended exploratory diagnostics so failure discovery is not purely formulaic.
- E2E agent diagnostics must not impose arbitrary word-count caps on critiques/observations.

`E2EOutcomeTriage.v1` must include:
- severity classification for each diagnosis
- immediate actions (critical, fail-closed)
- GH issue candidates (high/medium) with dedupe key

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
- Outcome triage must run even when outcome gate fails.
- Critical triage findings are immediate-action blockers (fail closed).
- High/medium triage findings are accepted by default as issue backlog items and should be auto-created on GitHub when auth is available.
- If GitHub issue creation is unavailable in-session, triage must still record accepted pending items for later publish.
- Cadence must produce a prioritized resolution queue artifact (`state/plans/agent-issue-fix-plan.json`) so failures always generate executable next work, not only red status.
