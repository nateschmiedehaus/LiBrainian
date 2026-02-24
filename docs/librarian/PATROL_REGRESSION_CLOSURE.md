# Patrol Regression Closure Loop

This document defines the required closure loop for every patrol finding in M0 and beyond.

## Non-Negotiable Process

1. Patrol finding is recorded with an issue number and reproducible symptom.
2. A construction-level regression check is added before the fix is merged.
3. The regression check must fail on the unfixed behavior and pass once fixed.
4. The finding issue is closed only after:
   - build passes (`npm run build`)
   - regression construction test passes
   - unit patrol suite passes (`npm run test:unit-patrol`)
5. The issue close comment must include commit hash, test paths, and verification commands.

## Baseline Regression Coverage (Existing Patrol Findings)

The following existing patrol findings are now pinned by construction-level regression checks:

| Issue | Finding | Construction Regression Check | Verification Command |
|---|---|---|---|
| #587 | CLI output/help consistency | `createCliOutputSanityGateConstruction` | `npm test -- --run src/constructions/processes/__tests__/cli_output_sanity_gate.test.ts` |
| #588 | Self-index dogfood gate | `createSelfIndexGateConstruction` | `npm test -- --run src/constructions/processes/__tests__/self_index_gate.test.ts` |
| #589 | Unit patrol merge-blocking guard | `createFixtureSmokeUnitPatrolConstruction` | `npm run test:unit-patrol` |
| #593 | Single-line actionable CLI errors + debug verbosity | `createCliOutputSanityGateConstruction` | `npm test -- --run src/constructions/processes/__tests__/cli_output_sanity_gate.test.ts` |
| #598 | Capability inventory discovery (`capabilities` / `list_capabilities`) | `createCliOutputSanityGateConstruction` and capability inventory checks | `npm test -- --run src/constructions/processes/__tests__/patrol_regression_closure_gate.test.ts` |

## Closure Gate

The canonical closure gate is:

- Construction: `createPatrolRegressionClosureGateConstruction`
- Test: `src/constructions/processes/__tests__/patrol_regression_closure_gate.test.ts`

This gate enforces that at least 5 known patrol findings remain covered and passing.

## Template

Use `docs/librarian/templates/PATROL_REGRESSION_TEST_TEMPLATE.md` for all new patrol findings.
Use `docs/librarian/templates/ISSUE_CLOSURE_EVIDENCE_TEMPLATE.md` for all M0 and ship-blocking issue closures.
