# Decision Trace: issue_838_impl

Date: 2026-02-25
Issue: #838

## Task intent
Implement a practical M1 `ImpactAwareTestSequencePlanner` construction that ranks tests by change impact and intent, with explicit fallback escalation.

## Dogfood decision
- Uncertainty: high (new construction API + registry wiring + smoke-gate compatibility).
- Action: attempted `npx librainian status` and `npx librainian query` before and after implementation.

## Natural usage observation
- `status`: returned with non-zero exit because full-tier bootstrap upgrade is still required (`mvp -> full` quality tier), despite index availability.
- `query`: recovered stale lock artifacts, emitted `Model policy provider not registered; using fallback model selection`, took ~130s, and returned low-confidence/low-relevance packs for this task.
- Decision impact: shifted to deterministic code-level implementation and direct test-first validation for registry wiring.

## Why this changed implementation decisions
- Added fallback-only output path when no intent/change signal exists to satisfy smoke-gate robustness.
- Added explicit escalation policy fields in output so failure modes are machine-readable.
- Added registry-level schema wiring and smoke-gate verification early to avoid integration regressions.

## What would have made LiBrainian more useful in this context
- Reliable bounded-latency `query` completion for repository-scale prompts.
- Higher precision retrieval for registry-wiring intents (file-level registration paths and test coverage locations).
- Explicit timeout + partial-result mode for long-running query paths.

## Verification commands
- `npm run build`
- `npm test -- --run src/constructions/processes/__tests__/impact_aware_test_sequence_planner.test.ts src/constructions/__tests__/registry.test.ts`
- `npm test -- --run src/constructions/__tests__/construction_smoke_gate.test.ts`
- `npm test -- --run`
