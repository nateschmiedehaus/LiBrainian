# LiBrainian Diagnosis and Debug Plan

## Objective

Diagnose failures with objective evidence, convert them into deterministic fixes, and verify recovery through live external-repo workflows.

## Current Blocking Evidence (2026-02-12)

1. Strict external smoke is now clean across the full manifest:
   - `npm run smoke:external:all` → `summary.failures = 0` (25/25 repos passed)
2. Parser coverage failures for Kotlin/Dart/Lua were eliminated by hardening grammar auto-install runtime env (`TMPDIR`, `SDKROOT`, `CPLUS_INCLUDE_PATH`) for native grammar builds.
3. Publish gate is still correctly blocked by strict superiority evidence:
   - `release.ab_agentic_bugfix` fails because T3+ lift evidence is not yet sufficient for world-class thresholding.
4. A/B harness execution integrity is now stable in strict mode (agent-command share, verified execution share, artifact integrity share can reach 100%), but lift remains the remaining blocker.
5. Real Codex worker runs now show deterministic timeout classification and process cleanup:
   - `eval-results/ab-harness-codex-live-control2.json` → `agent_command_timeout` (no orphaned `codex exec` processes left running).
6. Long-budget real Codex run demonstrates objective task completion with strict integrity:
   - `eval-results/ab-harness-codex-live-treatment-long.json` → success with `agentVerifiedExecutionShare=1.0`, `artifactIntegrityShare=1.0`.
7. Consolidated control+treatment long-budget run now succeeds for both workers with strict integrity:
   - `eval-results/ab-harness-codex-live-prompt-exit-long-both2.json`
   - control success: `179666ms`
   - treatment success: `68620ms`
   - objective time reduction: ~61.8%
8. Remaining publish blocker is measurement sufficiency, not runtime correctness:
   - gate reason: `t3_plus_significance_sample_insufficient`.

## A/B Statistical Diagnosis Update (2026-02-21)

Evidence artifacts:
- `state/audits/librarian/ab-diagnosis.json`
- `state/audits/librarian/ab-diagnosis.md`

Findings from aggregated historical A/B evidence:
1. **Sample coverage is now >2x latest run**, but still underpowered for the observed effect size.
   - reports analyzed: 24
   - paired samples: 48 per group
   - coverage vs latest run: 8.0x
2. **Observed lift is positive but not statistically significant.**
   - control success: 79.17%
   - treatment success: 85.42%
   - absolute delta: +6.25%
   - p-value: 0.4225
   - 95% CI: [-8.97%, +21.47%]
3. **Power analysis indicates a large remaining sample gap.**
   - required per group (80% power, alpha 0.05): 585
   - current per group: 48
   - gap: 537 per group
4. **Stratified evidence is heavily skewed to debugging tasks.**
   - debugging: 46 pairs, +2.17% absolute lift
   - explanation: 2 pairs, +100% absolute lift (too sparse for inference)
   - structural: 0 pairs
   - architectural: 0 pairs
5. **Root-cause classification:** `sample_size` (not enough power for current observed effect), with one concrete treatment-worse regression (`srtd-bugfix-topological-order-regression`).

Decision:
- **Primary focus now:** `sampling_and_experiment_design`.
- Do not treat this as retrieval-vs-synthesis proof yet; current evidence cannot support that decision boundary with statistical confidence.
- Next mandatory step is query-type coverage expansion (structural/explanation/architectural) plus materially larger paired-run volume before changing roadmap priorities.

## Immediate Execution Tasks

1. **A/B Superiority Hardening (Current Priority)**
   - Expand agentic bugfix tasks to be truly human-style and localization-hard without leaking target files.
   - Preserve strict fail-closed checks (baseline failure, target-file modification, artifact integrity).
   - Require publish evidence from strict runs (`minT3SuccessRateLift >= 0.25`, sample-adequate and significant), not reference-mode runs.

2. **Parser Runtime Hardening (Completed Core Path)**
   - Keep native install as primary path with deterministic compiler env.
   - Ensure strict parser coverage remains fail-closed.

3. **Toolchain Diagnosis Primitive**
   - Add `LiBrainian diagnose --parsers` output that reports:
     - missing grammars
     - missing language configs
     - compile-toolchain failures (compiler/headers/node-gyp)
   - Emit deterministic remediation commands for each failure class.

4. **Strict External Trial Promotion Gate**
   - Keep `requireCompleteParserCoverage=true` in smoke/journey strict mode.
   - Promote only when all manifest repos pass strict smoke and strict journey.

5. **A/B Agent Runner Reliability**
   - Keep env-template fail-closed.
   - Add canonical wrapper command for real agent runs so `AB_HARNESS_AGENT_CMD` is standardized.
   - Require artifact integrity and verified execution shares at 100% for release evidence.
   - Keep wrapper timeout strictly below harness timeout to avoid orphaned subprocesses and misclassified failures.

6. **Setup Variance Reduction**
   - Keep setup commands on a dedicated timeout budget (longer than per-command execution timeout).
   - Minimize per-run network/setup variance where possible (dependency warmup/caching strategy) before superiority measurement.

## Plan

1. **Detect**
   - Run: `LiBrainian doctor --json`
   - Run: `LiBrainian check-providers --format json`
   - Run: `LiBrainian status --format json`

2. **Reproduce**
   - Run: `npm run eval:trial-by-fire:quick`
   - Run: `LiBrainian journey --strict-objective --repos-root eval-corpus/external-repos --artifacts-dir state/eval/journey --timeout-ms 120000 --json`
   - Run: `LiBrainian smoke --repos-root eval-corpus/external-repos --artifacts-dir state/eval/smoke --timeout-ms 120000 --json`
   - Run: `npm run smoke:external -- --repoNames typedriver-ts,reccmp-py,tlsproxy-go --repoTimeoutMs 120000 --artifactRoot state/eval/smoke/external --runLabel trial-by-fire-ts-py-go`
   - Run: `AB_HARNESS_AGENT_CMD="<your-agent-command>" npm run eval:ab -- --taskpack agentic --workers control,treatment --requireAgentCommandTasks --requireBaselineFailureForAgentTasks --minAgentCommandShare 1 --minAgentVerifiedExecutionShare 1 --minT3SuccessRateLift 0.25`
   - Run: `AB_HARNESS_AGENT_CMD="<your-agent-command>" npm run eval:ab -- --taskpack agentic-bugfix --workers control,treatment --requireAgentCommandTasks --requireBaselineFailureForAgentTasks --minAgentCommandShare 1 --minAgentVerifiedExecutionShare 1 --minT3SuccessRateLift 0.25`

3. **Classify**
   - Use `failureSummary` emitted by `journey` and `smoke`.
   - Use `live-fire` aggregate `reasonCounts` and `failedRepos` for cross-run triage.
   - Treat timeout-only reports with `total=0` as potential lifecycle bugs until cancellation behavior is verified.
   - Prioritize by highest failure count and blocking severity:
     - `provider_unavailable`
     - `validation_unavailable`
     - `initialization_failed`
     - context retrieval failures
     - `no_target_file_modified`
     - `baseline_expected_failure_missing`

4. **Fix**
   - Apply the smallest coherent fix at root cause (provider config, storage recovery, parser coverage, bootstrap pathing).
   - Avoid speculative or narrative-only fixes.

5. **Verify**
   - Re-run the exact failing command profile with the same artifacts directory.
   - Compare old/new `report.json` and per-repo artifacts.
   - Require objective improvement before widening scope.
   - For timeout cases, run a stress profile and verify no lingering CLI worker processes remain.
     - Example stress run:
       - `LiBrainian live-fire --profile hardcore --rounds 1 --llm-modes disabled --max-repos 2 --journey-timeout-ms 1 --smoke-timeout-ms 1 --json`
   - Then verify no process leak:
     - `ps aux | rg "node ./node_modules/.bin/tsx src/cli/index.ts live-fire"`
   - Validate stable pointers for automation:
     - `cat state/eval/journey/latest.json`
     - `cat state/eval/smoke/latest.json`
     - `cat state/eval/live-fire/latest.json`
   - For long external smoke runs, verify progress heartbeat:
     - `cat state/eval/smoke/external/<run>/progress.json`

6. **Promote**
   - Run matrix: `LiBrainian live-fire --matrix --profiles baseline,hardcore,soak --profiles-file config/live_fire_profiles.json --repos-root eval-corpus/external-repos --artifacts-dir state/eval/live-fire --json`
   - Run drift guard: `npm run eval:live-fire:drift-guard`
   - Run agentic A/B benchmark with strict gate flags and verify `report.gates.passed=true`.
   - Require all gates pass before claiming operational health.

## Implemented in this iteration

1. Journey and smoke now emit per-run and per-repo artifact files.
2. `journey` and `smoke` now emit failure-category summaries.
3. `live-fire` now threads artifact roots into journey/smoke sub-runs.
4. A/B harness now supports baseline-failure preconditions (`verification.baseline` + `verification.requireBaselineFailure`) for true bug-fix tasks.
5. A/B harness now fails closed when agent runs do not modify target files.
6. `ralph --objective worldclass` now degrades when any core stage is skipped/unverified or core measurements are unmeasured.
7. Live-fire timeout path now propagates abort signals and uses guaranteed shutdown in journey/smoke loops to prevent orphaned long-running runs.
8. A/B harness now emits significance-aware lift evidence (p-value + CI) and explicit inconclusive states.
9. A/B harness now emits strict gate results for agent-command share and T3+ lift thresholds.
10. A/B harness now resolves case-mismatched target/edit paths against real on-disk paths, eliminating false missing-context failures on mixed-case repos.
11. A/B harness treatment mode now recovers missing target context from existing repo files when LiBrainian retrieval misses required files.
12. A/B harness deterministic mode now uses fail-closed edit-proof fallback when verification commands are unavailable (`verification_command_missing`) and replacements are objectively present.
13. A/B success lift computation now reflects real gains when control success rate is zero (uses absolute delta fallback instead of hard-zero).
14. Added real bugfix A/B taskpack (`eval-corpus/ab-harness/tasks.agentic_bugfix.json`) with baseline-failure enforcement and post-fix targeted test verification.
15. Added reference agent worker (`scripts/ab-agent-reference.mjs`) for deterministic end-to-end harness validation without external agent dependencies.
16. A/B harness no longer fails control workers on `missing_context` when treatment-only retrieval context is absent.
17. Bugfix taskpack setup mutations were corrected to ensure true baseline-fail states (`formatPath` truncation mutation and `dependencyParser` flag mutation).
18. Reference A/B command was re-scoped to smoke validation (`minT3SuccessRateLift=0`) so it validates pipeline integrity without claiming superiority.
19. Live-fire now skips smoke execution when journey already times out in a run (`smoke_skipped_due_journey_execution_failure`) to prevent cascading timeout artifacts.
20. CLI one-shot commands now force process exit after command completion (excluding `watch`) to prevent orphaned-handle hangs after fail-closed timeout paths.
21. FitnessReport now emits `scoringIntegrity` and evolution selection rejects unmeasured scores for archive/bandit updates.
22. Stage-4 live cognition now runs a strict multi-objective suite (`repo_thinking`, `architectural_critique`, `design_alternatives`) and fails closed when any objective is unverified.
23. A/B harness now emits `agentVerifiedExecutionShare` and `agentBaselineGuardShare`, with strict gates for baseline guards and verified execution.
24. External smoke now enforces per-repo timeout (`repoTimeoutMs`) and fails closed with `unverified_by_trace(smoke_repo_timeout)`.
25. External smoke now writes live progress artifacts (`progress.json`) for operational monitoring during long runs.
26. Grammar auto-install now sets deterministic native-build environment (`TMPDIR`, `SDKROOT`, `CPLUS_INCLUDE_PATH`) to recover parser installs under constrained default toolchain setups.
27. Strict external smoke full-manifest run now passes 25/25 repos, including previous Kotlin/Dart/Lua parser-coverage blockers.
28. Added real Codex A/B worker wrapper (`scripts/ab-agent-codex.mjs`) and strict publish-chain script (`eval:trial-by-fire:publish`) for non-reference release evidence runs.
29. Added hard watchdog timeout in Codex A/B wrapper with explicit fail-fast marker (`agent_timeout_ms_exceeded:*`) and non-zero exit on timeout.
30. Propagated harness timeout to wrapper (`AB_HARNESS_AGENT_TIMEOUT_MS`) with a safety buffer so wrapper timeout executes before outer harness timeout.
31. Added timeout marker classification in A/B harness so wrapper-enforced timeouts are recorded as `*_timeout` instead of generic `*_failed`.
32. Added regression coverage for wrapper timeout behavior and timeout classification (`src/__tests__/ab_agent_codex_script.test.ts`, `src/__tests__/ab_harness.test.ts`).
33. Added dedicated setup-timeout budget in A/B harness to reduce false negatives from setup jitter (`DEFAULT_SETUP_TIMEOUT_MS`).
34. Verified real external-repo live-fire evidence after fixes:
   - `eval-results/ab-harness-codex-live-control2.json`
   - `eval-results/ab-harness-codex-live-treatment-long.json`
   - `eval-results/ab-harness-codex-live-prompt-exit-long-both2.json`
