# Decision Trace: issue_838_impl

Date: 2026-02-25
Issue: #838

## Task intent
Implement a practical M1 `ImpactAwareTestSequencePlanner` construction that ranks tests by change impact and intent, with explicit fallback escalation.

## Dogfood decision
- Uncertainty: high (new construction API + registry wiring + smoke-gate compatibility).
- Action: attempted `npx librainian status` and `npx librainian query` before and after implementation.

## Natural usage observation
- `status`: now reports both full-tier upgrade requirement and watch catch-up requirement (`Needs Catch-up: true`), returning non-zero in this session.
- `query` attempt sequence:
  - first retry failed with `ENOINDEX` after stale lock recovery;
  - bootstrap process deadlocked workspace storage lock (`lock_active` PID loops);
  - doctor reported active lock holders and cross-DB inconsistency warnings;
  - final query succeeded only in degraded semantic mode with critical coherence warning (`16%`), low confidence (`0.264`), and low-actionability context.
- Decision impact: shifted from “query-guided acceptance completion” to deterministic harness-driven implementation for matrix generation and artifact validation.

## Why this changed implementation decisions
- Added fallback-only output path when no intent/change signal exists to satisfy smoke-gate robustness.
- Added explicit escalation policy fields in output so failure modes are machine-readable.
- Added registry-level schema wiring and smoke-gate verification early to avoid integration regressions.
- Added deterministic evaluation generator (`scripts/eval-impact-aware-test-sequence.ts`) to produce the required `>=15` task matrix and per-task artifacts without depending on unstable query relevance.
- Added artifact contract tests to fail closed when matrix size, median runtime reduction, or escalation/safety evidence regress.

## What would have made LiBrainian more useful in this context
- Reliable bounded-latency `query` completion for repository-scale prompts.
- Higher precision retrieval for registry-wiring intents (file-level registration paths and test coverage locations).
- Explicit timeout + partial-result mode for long-running query paths.
- Recovery flow that exits cleanly from stuck bootstrap/index lock-holder processes without manual PID intervention.

## Verification commands
- `npm run eval:test-sequence:impact-aware`
- `npm test -- --run src/__tests__/impact_aware_test_sequence_eval_docs.test.ts`
- `npm run build`
- `npm test -- --run src/constructions/processes/__tests__/impact_aware_test_sequence_planner.test.ts src/constructions/__tests__/registry.test.ts`
- `npm test -- --run src/constructions/__tests__/construction_smoke_gate.test.ts`
- `npm test -- --run`
