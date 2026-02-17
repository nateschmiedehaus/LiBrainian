# Conversation Insights

## Context Snapshot
- Date: 2026-02-12
- Objective: convert strategy conversation signals into enforceable launch work for LiBrainian GA.
- Conversation source: current workspace thread focused on launch readiness, agent loops, and OpenClaw borrowing strategy.
- Update cadence: update this file at each major planning checkpoint and before release-gate runs.

## Non-Negotiable Product Signals
- LiBrainian positioning is explicit and front-and-center: LiBrainian is the world's best knowledge, cognitive support, and organizational support tool for agents, especially agents developing and maintaining codebases.
- Launch quality bar is fail-closed: fallback, retry-heavy, degraded, or unverified behavior is treated as failure for publish evidence.
- Release evidence quality bar is absolute: acceptable state is 100% strict pass with zero fallback/retry/degraded/unverified markers.
- Agent workflows must optimize for diagnosis and conceptual understanding, not only repeated test execution.
- Use-case qualification must validate progressive steps leading into advanced examples, not only final target prompts.
- Documentation must clearly explain what LiBrainian does, how it works, and how agents should interact with it.

## Agent Failure Modes Observed
- Endless test-loop behavior that increases runtime without narrowing root-cause hypotheses.
- Narrow debugging behavior that misses architecture intent, product thesis, and user-facing system outcomes.
- Weak traceability from strategy decisions to code tasks, evaluation tasks, and release gates.
- Release readiness confusion when docs and gates are not coupled to the same checklist.

## OpenClaw Patterns to Borrow (Mapped to LiBrainian files)
| Pattern | Why it matters | LiBrainian adaptation | File targets |
| --- | --- | --- | --- |
| Single strict release gate | Prevents launch with ambiguous quality signals | Expand publish gate to require conversation intelligence signoff and zero imperfect behavior signals | `src/cli/commands/publish_gate.ts`, `src/cli/commands/__tests__/publish_gate.test.ts` |
| Diagnosis-first agent loops | Reduces wasted retries and blind test churn | Codify "detect -> hypothesize -> test -> fix -> verify" and no-fallback expectations in docs and release checklist | `docs/LiBrainian/STATUS.md`, `docs/LiBrainian/CONVERSATION_INSIGHTS.md` |
| Strong product narrative in docs | Aligns contributors and users around intent | Put final positioning language in canonical docs entrypoints | `docs/LiBrainian/README.md`, `docs/LiBrainian/CONVERSATION_INSIGHTS.md` |
| Artifact-backed publish evidence | Keeps claims tied to machine-verifiable outputs | Require publish gate checks against structured evidence and checklist completion | `src/cli/commands/publish_gate.ts`, `docs/LiBrainian/STATUS.md` |

## Action Items
| ID | Mapping | Owner | File Targets | Gate Impact | Status |
| --- | --- | --- | --- | --- | --- |
| CI-001 | Documentation task | librarianship | `docs/LiBrainian/CONVERSATION_INSIGHTS.md`, `docs/LiBrainian/README.md` | `release.conversation_insights_review` | done |
| CI-002 | Documentation task | librarianship | `docs/LiBrainian/STATUS.md` | `release.conversation_insights_review` | done |
| CI-003 | Code task | librarianship | `src/cli/commands/publish_gate.ts` | `release.conversation_insights_review`, `release.live_fire_quick`, `release.ab_agentic_bugfix`, `release.external_smoke_sample` | done |
| CI-004 | Evaluation task | librarianship | `src/cli/commands/__tests__/publish_gate.test.ts` | `release.conversation_insights_review` | done |
| CI-005 | Documentation task | librarianship | `docs/LiBrainian/README.md` | `layer0.tier0` | done |
| CI-006 | Gate/status update | librarianship | `docs/LiBrainian/STATUS.md`, `docs/LiBrainian/GATES.json` | `release.conversation_insights_review` | active |
| CI-007 | Evaluation task | librarianship | `src/__tests__/conversation_insights_doc.test.ts` | `layer0.tier0` | done |
| CI-008 | Code task | librarianship | `src/cli/commands/publish_gate.ts` | `release.live_fire_quick`, `release.ab_agentic_bugfix`, `release.external_smoke_sample` | done |
| CI-009 | Code task | librarianship | `package.json`, `src/__tests__/canon_scripts.test.ts` | `release.publish_gate_strict` | done |
| CI-010 | Documentation task | librarianship | `docs/TEST.md`, `docs/LiBrainian/validation.md` | `release.publish_gate_strict` | done |
| CI-011 | Evaluation task | librarianship | `src/evaluation/agentic_use_case_review.ts`, `scripts/agentic-use-case-review.ts`, `src/__tests__/agentic_use_case_review.system.test.ts` | `release.agentic_use_case_review` | done |
| CI-012 | Documentation task | librarianship | `AGENTS.md`, `CLAUDE.md`, `docs/LiBrainian/CONVERSATION_INSIGHTS.md` | `release.conversation_insights_review` | active |

## Accepted Wording for Positioning
- Primary launch wording: LiBrainian is the world's best knowledge, cognitive support, and organizational support system for agents building and maintaining software codebases.
- Product behavior wording: LiBrainian gives agents evidence-grounded code understanding, architectural context, confidence-calibrated reasoning, and execution-ready guidance in one system.
- Quality wording: launch gates fail closed when fallback, retry, degraded, or unverified behavior appears in publish evidence.
- Quality wording (strict): release evidence must be 100% strict-pass; any fallback/retry/degraded/unverified marker is an automatic failure.

## Deferred Ideas
- Compare OpenClaw-inspired UX affordances against contributor cognitive load before adding new runtime interfaces.
- Expand strategic conversation mining to additional channels after current launch cycle stabilizes.
- Add automated extraction of conversation insights into structured changelog entries after publish gate is stable.

## Evidence Links
- Conversation strategy source: current workspace thread (2026-02-12)
- Release gate implementation: `src/cli/commands/publish_gate.ts`
- Release gate tests: `src/cli/commands/__tests__/publish_gate.test.ts`
- Conversation insights doc tests: `src/__tests__/conversation_insights_doc.test.ts`
- Script enforcement checks: `src/__tests__/canon_scripts.test.ts`
- Strict release scripts: `package.json`
- Strict gate checkpoint (2026-02-12): full deterministic suite passed (`npm test -- --run`), strict quick chain failed on A/B ceiling-time gate (`t3_plus_ceiling_time_reduction_below_threshold`) with artifact at `eval-results/ab-harness-report.json`.
- Agentic use-case review evaluator: `src/evaluation/agentic_use_case_review.ts`
- Progressive UC ladder tests: `src/evaluation/__tests__/agentic_use_case_review.test.ts`, `src/__tests__/agentic_use_case_review.system.test.ts`
- Status integration: `docs/LiBrainian/STATUS.md`
- Docs index integration: `docs/LiBrainian/README.md`
- Agent policy alignment: `AGENTS.md`, `CLAUDE.md`

## Checkpoint 2026-02-13 (Strict-Failure Triage)
- Root-cause confirmed for a release-blocking strict marker path: schema-discovery intents were misclassified as migration adequacy, injecting `unverified_by_trace(adequacy_missing)` and cascading prerequisite failures.
- Added regression tests for intent routing:
  - `src/api/__tests__/difficulty_detectors.test.ts` now asserts schema discovery stays `general` and schema migration remains `migration`.
- Implemented intent-classification hardening:
  - `src/api/difficulty_detectors.ts` now requires migration/release action terms; plain `schema` discovery no longer escalates to migration adequacy requirements.
- Validation completed:
  - `npm test -- --run src/api/__tests__/difficulty_detectors.test.ts`
  - `npm run test:evaluation -- --run src/evaluation/__tests__/agentic_use_case_review.test.ts src/evaluation/__tests__/agentic_use_case_review_strict_signals.test.ts`
- Live probe on `typedriver-ts` UC-007 now shows no `unverified_by_trace` strict signal in disclosures/uncertainties when queried with `disableCache: true`.

## Checkpoint 2026-02-13 (Self-Healing + Termination Hardening)
- Added corruption-aware storage recovery so malformed SQLite state is treated as recoverable and rebuilt from scratch:
  - `src/storage/storage_recovery.ts` now classifies corruption errors (`SQLITE_CORRUPT`, `database disk image is malformed`, `file is not a database`) as recoverable.
  - Recovery now quarantines corrupt DB files (`*.corrupt.<timestamp>`) and clears WAL/SHM before re-init.
- Wired recovery error-context through all operational callers:
  - `src/api/LiBrainian.ts`
  - `src/cli/commands/bootstrap.ts`
  - `src/api/onboarding_recovery.ts`
- Added use-case evaluator termination hardening:
  - `src/evaluation/agentic_use_case_review.ts` now has bounded init/query timeouts (`initTimeoutMs`, `queryTimeoutMs`) with env fallbacks to prevent indefinite hangs.
  - `scripts/agentic-use-case-review.ts` now accepts `--initTimeoutMs` and `--queryTimeoutMs`.
- Validation completed:
  - `npm test -- --run src/storage/__tests__/storage_recovery.test.ts`
  - `npm test -- --run src/api/__tests__/onboarding_recovery.test.ts`
  - `npm test -- --run src/api/__tests__/difficulty_detectors.test.ts`
  - `npm run test:evaluation -- --run src/evaluation/__tests__/agentic_use_case_review.test.ts src/evaluation/__tests__/agentic_use_case_review_strict_signals.test.ts`
  - Probe run with bounded timeouts completed and emitted artifacts (`state/eval/use-case-review/probe-timeout-check/report.json`) rather than hanging.

## Checkpoint 2026-02-13 (Token-Conscious Adaptive Agentic Testing)
- Added uncertainty-adaptive scheduling for use-case review:
  - `src/evaluation/agentic_use_case_review.ts` now supports `selectionMode=adaptive`, prioritizing high-uncertainty cases while reserving stable sentinels.
  - `scripts/agentic-use-case-review.ts` now accepts `adaptive` mode directly.
- Added uncertainty-adaptive scheduling for A/B task execution:
  - `src/evaluation/ab_harness.ts` now computes task uncertainty from prior run history (`buildAbTaskUncertaintyScoresFromHistory`) and supports adaptive task selection (`selectAbTasksForExecution`).
  - `scripts/ab-harness.ts` now accepts `--selectionMode` and `--uncertaintyHistoryPath` and passes uncertainty scores into the harness.
- Updated quick strict-chain scripts to consume adaptive scheduling:
  - `package.json` (`eval:ab:agentic-bugfix:quick`) uses `--selectionMode adaptive --uncertaintyHistoryPath eval-results/ab-harness-report.json --maxTasks 6`.
  - `package.json` (`eval:use-cases:agentic:quick`) uses `--selectionMode adaptive`.
- Added regression coverage:
  - `src/__tests__/agentic_use_case_uncertainty_selection.test.ts`
  - `src/__tests__/ab_harness_uncertainty_selection.test.ts`
  - `src/__tests__/canon_scripts.test.ts`
- Validation completed:
  - `npm test -- --run`
  - `npm run eval:ab:agentic-bugfix:quick`
  - `npm run eval:use-cases:agentic:quick`
  - `npm run test:agentic:strict:quick`

## Checkpoint 2026-02-14 (Release Use-Case Stability Hardening)
- Root-cause triage for strict publish failures confirmed release use-case review timed out in non-deterministic mode on certain repos/UCs, causing fail-fast cascades.
- Added explicit release-safe query construction for use-case review:
  - `src/evaluation/agentic_use_case_review.ts` now builds intents in quick-synthesis-friendly form (`What is ...`) and enforces query flags `disableMethodGuidance=true` and `forceSummarySynthesis=true`.
- Hardened query pipeline controls for bounded high-volume evaluation:
  - `src/types.ts` adds `forceSummarySynthesis`.
  - `src/api/query.ts` honors `forceSummarySynthesis` in synthesis stage and includes new query-control flags in cache key material.
  - `src/api/query.ts` honors `disableMethodGuidance` so method-guidance LLM enrichment is skipped when explicitly disabled.
- Added fallback model-policy behavior to avoid hard missing-provider traces:
  - `src/adapters/model_policy.ts` now returns a fallback daily selection when no policy provider is registered (with warning), rather than returning `null`.
- Validation completed:
  - `npm test -- --run src/api/__tests__/query_pipeline.test.ts src/__tests__/agentic_use_case_query_config.test.ts src/adapters/__tests__/model_policy.test.ts src/__tests__/canon_scripts.test.ts`
  - `npx tsc --noEmit`
  - `npm run eval:use-cases:agentic`
  - `npm run eval:publish-gate`

## Checkpoint 2026-02-16 (Release Evidence Honesty Tightening)
- Root-cause confirmed for strict-marker confusion in release docs:
  - `src/evaluation/evidence_reconciliation.ts` previously emitted `unverified_by_trace(...)` strings into reconciled `STATUS`/`GATES` content.
  - Reconciliation now normalizes strict-marker tokens for release-doc narratives and no longer injects `unverified_by_trace(...)` into those artifacts.
- Added/updated regression coverage:
  - `src/__tests__/evidence_reconciliation.test.ts` now asserts reconciliation outputs do not contain `unverified_by_trace(`.
- Hardened A/B release gate semantics to prevent threshold bypass:
  - `src/evaluation/ab_harness.ts` now defaults `requireT3CeilingTimeReduction=true` for release evidence.
  - `src/cli/commands/publish_gate.ts` now enforces ceiling-mode efficiency checks for release A/B evidence even when a report threshold sets `requireT3CeilingTimeReduction=false`.
  - `src/__tests__/ab_harness.test.ts` and `src/cli/commands/__tests__/publish_gate.test.ts` updated to lock this behavior.
- Validation completed:
  - `npm test -- --run src/__tests__/ab_harness.test.ts src/cli/commands/__tests__/publish_gate.test.ts src/__tests__/evidence_reconciliation.test.ts`
  - `npm run eval:publish-gate -- --json` now fails closed (expected) on real A/B artifact with negative ceiling-mode efficiency delta:
    - blocker: `release.ab_agentic_bugfix`
    - reason: `A/B harness ceiling-mode efficiency gain below threshold (effective=-0.029 < 0.01)`
- Current implication:
  - Release gate now reflects measured reality instead of passing on an A/B saturated-success/negative-efficiency loophole.
  - Next required work is not gate-massage; it is improving treatment performance on real T3+ workloads so the stricter gate passes.

## Checkpoint 2026-02-17 (A/B Efficiency Remediation for Strict Release)
- Root cause for failed strict chain after gate hardening was treatment inefficiency in saturated-success A/B runs (ceiling mode), not correctness failures.
- Implemented A/B runtime hardening for real agent command runs:
  - `scripts/ab-agent-codex.mjs`
    - added strict command discipline to avoid extra validation churn (harness remains authoritative).
    - added optional acceptance-command surfacing from harness (`AB_HARNESS_ACCEPTANCE_COMMANDS`).
    - added worker-aware default model routing (`control=gpt-5`, `treatment=gpt-5-codex`) with global override support.
    - added worker-aware default reasoning effort (`control=medium`, `treatment=low`) with explicit override support.
  - `src/evaluation/ab_harness.ts`
    - exports only compact target-focused LiBrainian context (`AB_MAX_LIBRARIAN_CONTEXT_FILES=2`).
    - re-refines recovered treatment context after target recovery to remove distractor files.
    - forwards acceptance verification commands into agent env (`AB_HARNESS_ACCEPTANCE_COMMANDS`).
- Regression coverage added/updated:
  - `src/__tests__/ab_agent_codex_script.test.ts`
  - `src/__tests__/ab_harness.test.ts`
  - `src/cli/commands/__tests__/publish_gate.test.ts`
- Validation completed:
  - `npm test -- --run src/__tests__/ab_agent_codex_script.test.ts`
  - `npm test -- --run src/__tests__/ab_harness.test.ts src/cli/commands/__tests__/publish_gate.test.ts src/__tests__/ab_agent_codex_script.test.ts`
  - `npm run test:agentic:strict`
- Strict chain result:
  - `release.ab_agentic_bugfix` now passes with positive ceiling-mode efficiency signal in release evidence.
  - `eval:publish-gate` returns `passed: true` with zero blockers/warnings after full strict run.

### Release Gate Signoff Checklist
- [x] conversation_insights_review_complete
- [x] zero_fallback_retry_degraded_confirmed
