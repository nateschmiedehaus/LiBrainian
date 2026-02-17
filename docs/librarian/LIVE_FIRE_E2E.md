# Live-Fire CLI End-to-End Evaluation

This guide defines the repeatable, agentic, external-repo evaluation loop for LiBrainian.

## Goals

- Exercise LiBrainian through real CLI workflows, not only unit tests.
- Enforce fail-closed gates on objective retrieval quality.
- Produce artifacts that make regression diagnosis fast.

## Release Evidence Policy

- `REAL_AGENT_REAL_LIBRARIAN_ONLY`: release artifacts must come from real agents running on the real LiBrainian codebase.
- `NO_SYNTHETIC_OR_REFERENCE_FOR_RELEASE`: reference/smoke harness runs are diagnostic aids, never release signoff evidence.
- `NO_RETRY_NO_FALLBACK_FOR_RELEASE_EVIDENCE`: any retry/fallback/degraded evidence path is release-blocking.
- `PERFECT_RELEASE_EVIDENCE_ONLY`: release qualification is binary; only full strict pass is acceptable.
- Live-fire artifacts must include a resolvable `reportPath` to a full `LiveFireTrialReport.v1` payload for publish-gate validation.

## One-Command Runs

- List profiles:
  - `npm run eval:live-fire:profiles`
- Fast sanity path (single repo, bounded timeouts):
  - `npm run eval:journey:quick`
  - `npm run eval:smoke:quick`
  - `npm run eval:live-fire:quick`
- One-command quick trial-by-fire chain:
  - `npm run eval:trial-by-fire:quick`
- Publish-grade trial-by-fire chain (strict external smoke + hardcore live-fire + real Codex A/B):
  - `npm run eval:trial-by-fire:publish`
- External-repo smoke sample (cross-language, artifacted):
  - `npm run smoke:external:sample`
- External-repo smoke full set (fail-closed per-repo timeout):
  - `npm run smoke:external:all`
- Baseline profile:
  - `npm run eval:live-fire:baseline`
- Hardcore profile:
  - `npm run eval:live-fire:hardcore`
- Full matrix:
  - `npm run eval:live-fire:matrix`
- Matrix drift guard (fails if key metrics regress versus previous matrix pointer):
  - `npm run eval:live-fire:drift-guard`
- Agentic A/B benchmark taskpack:
  - `AB_HARNESS_AGENT_CMD="<your-agent-command>" npm run eval:ab:agentic`
- Agentic bugfix benchmark taskpack (real baseline-fail -> fix -> verify loop):
  - `AB_HARNESS_AGENT_CMD="<your-agent-command>" npm run eval:ab:agentic-bugfix`
  - Codex wrapper command (no manual env wiring):
    - `npm run eval:ab:agentic-bugfix:codex`
  - Reference harness worker for pipeline smoke proof only (explicitly non-release evidence):
    - `npm run eval:ab:agentic-bugfix:reference`

All commands run through CLI entrypoint (`src/cli/index.ts`) to preserve end-to-end realism.

## Agent Session Invocation (A/B + Live-Fire)

Use these exact steps to run evaluation through real agent sessions.

1. Preflight provider/auth state:
```bash
claude --print "provider check"
codex login status
npm run dev -- check-providers --format json
```

2. Run strict A/B with Codex session wrapper:
```bash
npm run eval:ab:agentic-bugfix:codex
```

3. Run strict A/B with explicit session command wiring (advanced):
```bash
AB_HARNESS_AGENT_CMD="node $(pwd)/scripts/ab-agent-codex.mjs" \
  npm run eval:ab:agentic
```

4. Run real-project progressive UC review:
```bash
npm run eval:use-cases:agentic
```

5. Run publish-grade chain:
```bash
npm run eval:trial-by-fire:publish
```

For full release qualification, run:

```bash
npm run test:agentic:strict
```

### Custom Agent Session Command Contract

When overriding `AB_HARNESS_AGENT_CMD`, the command must:
- Read prompt text from `AB_HARNESS_PROMPT_FILE`.
- Execute in `AB_HARNESS_WORKSPACE_ROOT`.
- Respect `AB_HARNESS_AGENT_TIMEOUT_MS`.
- Exit non-zero on any failure/timeout.
- Never emit simulated success in provider-failure conditions.

Harness session environment passed to commands:
- `AB_HARNESS_PROMPT_FILE`
- `AB_HARNESS_CONTEXT_FILE`
- `AB_HARNESS_TASK_FILE`
- `AB_HARNESS_WORKSPACE_ROOT`
- `AB_HARNESS_WORKER_TYPE`
- `AB_HARNESS_TASK_ID`
- `AB_HARNESS_AGENT_TIMEOUT_MS`

## Direct CLI Usage

- Single profile:
  - `npm run dev -- live-fire --profile baseline --profiles-file config/live_fire_profiles.json --repos-root eval-corpus/external-repos --artifacts-dir state/eval/live-fire --json`
- Matrix run:
  - `npm run dev -- live-fire --matrix --profiles baseline,hardcore,soak --profiles-file config/live_fire_profiles.json --repos-root eval-corpus/external-repos --artifacts-dir state/eval/live-fire --json`
 - Timeout-tuned run:
  - `npm run dev -- live-fire --profile hardcore --journey-timeout-ms 180000 --smoke-timeout-ms 120000 --repos-root eval-corpus/external-repos --json`
- Journey with artifacts + triage:
  - `npm run dev -- journey --repos-root eval-corpus/external-repos --max-repos 5 --strict-objective --artifacts-dir state/eval/journey --json`
  - Add timeout guard: `--timeout-ms 120000`
- Smoke with artifacts + triage:
  - `npm run dev -- smoke --repos-root eval-corpus/external-repos --max-repos 5 --artifacts-dir state/eval/smoke --json`
  - Add timeout guard: `--timeout-ms 120000`
- External smoke with per-repo timeout + progress:
  - `npm run smoke:external -- --repoNames typedriver-ts,reccmp-py,tlsproxy-go --repoTimeoutMs 120000 --artifactRoot state/eval/smoke/external --runLabel trial-by-fire-ts-py-go`

## Artifacts

- Per-profile report: `state/eval/live-fire/<profile>.json`
- Matrix summary: `state/eval/live-fire/matrix_summary.json`
- Previous matrix pointer snapshot for drift checks: `state/eval/live-fire/latest.prev.json`
- Journey artifacts: `state/eval/journey/<run>/report.json` + `repos/*.json`
- Smoke artifacts: `state/eval/smoke/<run>/report.json` + `repos/*.json`
- External smoke artifacts:
  - `state/eval/smoke/external/<run>/report.json`
  - `state/eval/smoke/external/<run>/repos/*.json`
  - `state/eval/smoke/external/<run>/progress.json`
- Stable pointers for automation:
  - Journey: `state/eval/journey/latest.json`
  - Smoke: `state/eval/smoke/latest.json`
  - Live-fire profile: `state/eval/live-fire/<profile>/latest.json`
  - Live-fire matrix: `state/eval/live-fire/latest.json`
- Schemas:
  - `LiveFireTrialReport.v1`
  - `LiveFireMatrixReport.v1`
  - `AgenticJourneyRunArtifact.v1`
  - `AgenticJourneyRepoArtifact.v1`
  - `ExternalRepoSmokeRunArtifact.v1`
  - `ExternalRepoSmokeRepoArtifact.v1`

## Gate Semantics (Fail-Closed)

Profiles gate on:

- Journey pass rate
- Retrieved context rate
- Blocking validation rate
- Optional smoke failure count

If any gate fails, CLI exits non-zero.
If a journey or smoke execution hangs past timeout, it fails closed with `journey_execution_failed:*` or `smoke_execution_failed:*`.
If external smoke exceeds per-repo timeout, it fails closed with `unverified_by_trace(smoke_repo_timeout): <repo> exceeded <ms>`.

## Debugging Workflow

1. Re-run failed profile with JSON output.
2. Identify failing repos in report `runs[].reasons`.
3. Use `aggregate.reasonCounts` to rank failures by frequency.
4. Use `aggregate.failedRepos` to prioritize repo-specific repro loops.
5. Re-run only those repos with `--repo a,b,c`.
6. For long external smoke runs, watch progress in:
   - `state/eval/smoke/external/<run>/progress.json`
7. Compare `journey.retrievedContextRate` and `journey.blockingValidationRate` across runs.
8. Fix and re-run profile before widening scope.
9. Use `failureSummary` from `journey --json` / `smoke --json` to prioritize first-fix categories.
10. Run drift guard against prior matrix pointer:
   - `npm run eval:live-fire:drift-guard`

## A/B Harness Realism Guardrails

- For fix-task realism, define a failing baseline:
  - `verification.baseline`
  - `verification.requireBaselineFailure: true`
- For objective completion, ensure the task modifies intended code:
  - Default fail-closed in `agent_command` mode when target files are unchanged (`no_target_file_modified`).
- For autonomous benchmark realism, enforce agentic execution share:
  - `--requireAgentCommandTasks`
  - `--minAgentCommandShare 1`
- For objective bugfix realism, enforce verified execution and baseline guards:
  - `--minAgentVerifiedExecutionShare 1`
  - `--requireBaselineFailureForAgentTasks`
- For fail-closed benchmark integrity, reject runs with critical prerequisite failures:
  - `--requireNoCriticalFailures` (enabled by default in `scripts/ab-harness.ts`)
- For evidence-backed lift claims, use significance-aware output:
  - `lift.significance.pValue`
  - `lift.significance.statisticallySignificant`
  - `lift.significance.inconclusiveReason`
- For T3+ quality gate claims, require explicit thresholding:
  - `--minT3SuccessRateLift 0.25`
  - `--requireT3Significance` (recommended when sample size is sufficient)

Example strict run:

- `AB_HARNESS_AGENT_CMD="<your-agent-command>" npm run eval:ab -- --taskpack agentic --workers control,treatment --requireAgentCommandTasks --requireBaselineFailureForAgentTasks --minAgentCommandShare 1 --minAgentVerifiedExecutionShare 1 --minT3SuccessRateLift 0.25`

Example strict bugfix run:

- `AB_HARNESS_AGENT_CMD="<your-agent-command>" npm run eval:ab -- --taskpack agentic-bugfix --workers control,treatment --requireAgentCommandTasks --requireBaselineFailureForAgentTasks --minAgentCommandShare 1 --minAgentVerifiedExecutionShare 1 --minT3SuccessRateLift 0.25`
- Taskpack location: `eval-corpus/ab-harness/tasks.agentic_bugfix.json`
- Each task enforces:
  - setup mutation to create a real failing state
  - baseline failure proof
  - post-fix targeted test pass proof
  - target-file modification proof

## Adding Hardcore Future Tests

1. Add/adjust profile in `config/live_fire_profiles.json`.
2. Include stricter thresholds, more rounds, larger `maxRepos`, and both `disabled` + `optional` LLM modes.
3. Run profile directly first; then include in matrix.
4. Add a CLI test under `src/cli/commands/__tests__/live_fire.test.ts` when adding new flags/behavior.

Recommended additions:

- Domain-specific repo slices (e.g., infra-heavy, polyglot-heavy, legacy-heavy).
- Stress profiles with higher rounds and broader repo mix.
- Nightly matrix runs with artifact diffing against prior baseline.

## OpenClaw-Derived Patterns

From the OpenClaw review (`docs/LiBrainian/OPENCLAW_COMPARATIVE_REVIEW.md`):

1. Keep live tests isolated by env mode and explicit config.
2. Default to JSON-first outputs for agent consumption and CI parsing.
3. Always persist run artifacts for failed objective flows.
4. Treat diagnostic commands as actionable repair plans, not just status displays.
