# Learning Systems

Date: 2026-02-18

LiBrainian has two distinct learning loops with different scopes.

## 1) Query Learning (`src/api/learning_loop.ts`)
- Purpose: improve retrieval and recommendation quality for query-time decisions.
- Scope: query composition, recommendation ranking, and outcome-driven adaptation.
- Persistence: storage key `librarian.learning_loop.v1`.
- Used by: query planner/selector flows in API layer.

## 2) Recovery Learning (`src/learning/recovery_learner.ts`)
- Purpose: learn which recovery actions work for degradation/failure classes.
- Scope: operational recovery (bootstrap/storage/homeostasis paths), not query ranking.
- Persistence: `.librarian/learner-state.json` via learning persistence helpers.
- Used by: recovery/homeostasis integrations.

## Interaction Model
- They are intentionally independent.
- Query learning does not directly mutate recovery strategy priors.
- Recovery learning does not directly re-rank query results.
- Both can run in the same repository without shared state collisions.

## Reset/Inspect
- Query learning: clear the `librarian.learning_loop.v1` record from storage.
- Recovery learning: remove `.librarian/learner-state.json` (or run recovery reset tooling when available).

## Operational Guidance
- If query quality regresses but recovery behavior is stable, inspect query learning first.
- If lock/bootstrap recovery regresses but retrieval quality is stable, inspect recovery learner first.
