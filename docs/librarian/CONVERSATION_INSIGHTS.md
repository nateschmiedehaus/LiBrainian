# Conversation Insights

<!-- checkpoint
date: 2026-03-22
gates_reconcile_sha: workspace-uncommitted
claimed_status: release-contract-updated-before-release-gate-runs
-->

## Context Snapshot
- Date: 2026-03-22
- Objective: make the first public LiBrainian release honest, narrow, and publish-grade.
- Conversation source: current workspace thread focused on M0/M1 completion, real dogfooding, and public release quality.
- This file records a major planning checkpoint before release qualification.
- This document records the current release-contract checkpoint before the final strict rerun.
- Update rule: refresh this file before release-gate runs whenever the release contract or shipped surface changes.

## Non-Negotiable Product Signals
- LiBrainian must be materially useful for agents developing real code, not merely runnable.
- Release evidence is fail-closed: fallback, retry-heavy, degraded, unavailable, or unverified behavior invalidates publish evidence.
- Public docs and help must describe only the supported first-release surface.
- Dead release lanes must not remain in the active qualification contract.
- The strict release chain must match maintained scripts and maintained source modules.
- Historical artifacts under `state/eval/**` are workspace-local diagnostics unless they are the canonical output paths wired into the current strict chain.

## Agent Failure Modes Observed
- Over-claiming release readiness because a script name exists even when the underlying subsystem was removed.
- Letting stale internal evaluation lanes continue to block release after their source modules were deleted.
- Treating advisory status docs as more authoritative than live CLI behavior and current artifacts.
- Expanding surface area faster than it can be kept honest in docs, tests, and packaging.

## OpenClaw Patterns to Borrow (Mapped to LiBrainian files)
| Pattern | Why it matters | LiBrainian adaptation | File targets |
| --- | --- | --- | --- |
| Narrow front door | Public trust depends on a short, reliable first-run path | Keep help, README, package exports, and MCP surface tighter than the internal repo surface | `README.md`, `src/cli/help.ts`, `src/cli/index.ts`, `package.json` |
| Fail-closed release proof | A launch gate must validate maintained reality, not historical ambition | Remove dead A/B lanes from the active publish contract and keep only maintained evidence generators in the strict chain | `package.json`, `src/cli/commands/publish_gate.ts`, `docs/TEST.md` |
| Honest maturity framing | Preview work should not masquerade as production support | Gate maintainer-only commands and label deferred release evidence explicitly | `src/cli/index.ts`, `docs/README.md`, `docs/TEST.md` |
| Evidence-backed positioning | Product narrative must match live behavior | Keep dogfood proof, strict chain, and public docs aligned around real maintained capabilities | `README.md`, `docs/librarian/MILESTONE_BRIEF.md`, `docs/librarian/CONVERSATION_INSIGHTS.md` |

## Action Items
| ID | Mapping | Owner | File Targets | Gate Impact | Status |
| --- | --- | --- | --- | --- | --- |
| CI-013 | Gate/status update | librarianship | `package.json`, `src/cli/commands/publish_gate.ts`, `src/__tests__/canon_scripts.test.ts`, `src/cli/commands/__tests__/publish_gate.test.ts` | `release.live_fire_quick`, `release.agentic_use_case_review`, `release.external_smoke_sample`, `release.testing_discipline`, `release.testing_tracker`, `release.conversation_insights_review` | in_progress |
| CI-014 | Documentation task | librarianship | `scripts/README.md`, `docs/TEST.md`, active tests and helpers still naming removed A/B lanes | `release.publish_gate_strict` | in_progress |
| CI-015 | Documentation task | librarianship | `README.md`, `docs/README.md`, `docs/START_HERE.md`, `src/cli/help.ts` | `layer0.tier0` | in_progress |
| CI-016 | Evaluation task | librarianship | `status`, `doctor`, `./ask`, canonical strict-run artifacts only | `release.publish_gate_strict` | in_progress |

## Accepted Wording for Positioning
- Primary wording: LiBrainian is a codebase intelligence layer for serious coding agents.
- Product behavior wording: LiBrainian gives agents evidence-grounded code understanding, architectural context, and execution-ready guidance without pretending stale state is healthy.
- Quality wording: the shipped public surface is intentionally narrower than the full source tree and maintainer repo tooling.
- Release wording: strict release evidence is currently based on live-fire, external-repo use-case review, external smoke, testing-discipline, testing-tracker, and conversation-insights signoff.

## Deferred Ideas
- Reintroduce comparative A/B release evidence only after the harness and source modules are rebuilt and tested as a first-class subsystem.
- Reintroduce a final-verification release lane only when a maintained generator exists and is wired into the strict chain.

## Evidence Links
- Public package/release contract: `package.json`
- Strict publish gate: `src/cli/commands/publish_gate.ts`
- Script canon tests: `src/__tests__/canon_scripts.test.ts`
- Package/release surface tests: `src/__tests__/package_release_scripts.test.ts`
- Public docs surface: `README.md`, `docs/README.md`, `docs/START_HERE.md`, `docs/TEST.md`
- Canonical maintained release artifacts for the current strict chain:
  - `state/eval/live-fire/hardcore/latest.json`
  - `eval-results/agentic-use-case-review.json`
  - `state/eval/smoke/external/all-repos/report.json`
  - `docs/librarian/CONVERSATION_INSIGHTS.md`
- Historical run folders under `state/eval/use-case-review/*` are diagnostic history, not current release evidence by themselves.

### Release Gate Signoff Checklist
- [x] conversation_insights_review_complete
- [x] zero_fallback_retry_degraded_confirmed
