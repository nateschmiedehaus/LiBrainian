# Librarian Facade Decomposition Decision

Date: 2026-02-18
Status: Accepted

## Problem
`src/api/librarian.ts` had become a broad orchestrator with many directly-owned subsystem constructions. This made isolated testing and controlled composition harder than necessary.

## Most Important Decision (Options Considered)
1. Full immediate split into many top-level services.
- Pros: strongest SRP separation.
- Cons: highest churn and migration risk in one step.

2. Keep monolith and document responsibilities only.
- Pros: lowest implementation risk.
- Cons: does not improve test seams or dependency control.

3. Introduce explicit dependency-injection seams while keeping the facade API stable.
- Pros: immediate testability gains, incremental migration path, low behavior risk.
- Cons: class remains a facade with broad method surface in the near term.

## Decision
Choose option 3 as the best risk-adjusted path.

## Implemented Direction
- Added `LibrarianDependencyOverrides` in `src/api/librarian.ts`.
- `Librarian` initialization now supports override factories for:
  - embedding service
  - storage
  - knowledge / synthesizer
  - engines
  - views delegate
  - indexer
  - context session manager
- Visualization type coupling was shifted to the views layer type exports (`src/api/librarian_views.ts`) rather than direct visualization module type imports.
- Added validation test for override seams in `src/__tests__/librarian.test.ts`.

## Follow-on Work
- Continue extracting domain-specific facades (query/session/presentation) behind the stable `Librarian` API.
- Migrate additional unit tests to dependency overrides to reduce full-stack initialization requirements.
