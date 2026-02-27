# Constructions Composition Decision

Date: 2026-02-18
Status: Accepted

## Problem
Constructions were usable as isolated tools, but did not provide a clear composition contract for agent workflows.

## Options Considered
1. Keep isolated constructions and improve docs only.
- Pros: low risk, no runtime changes.
- Cons: does not improve cross-construction reuse or agent orchestration.

2. Hard-code a single construction pipeline in CLI.
- Pros: fast UX win for one workflow.
- Cons: brittle, not reusable across different tasks.

3. Add a composition-oriented contract with shared routing + deterministic selection and expose composition entrypoints.
- Pros: reusable, agent-friendly, supports gradual rollout.
- Cons: medium implementation effort.

## Decision
Choose option 3.

## Implemented Direction
- `librarian compose` defaults to `constructions` mode as the primary composition entrypoint.
- Construction auto-selection now emits availability, confidence caps, and warnings for experimental modules.
- Perspective routing is enforced in core constructions so composition stages get domain-aware retrieval behavior.
- Refactoring safety now prefers exhaustive graph traversal to avoid top-k truncation in composed safety workflows.
- Feedback loop plumbing (`librarian feedback`, MCP `submit_feedback`) closes the agent/report/fix loop.
- Added a concrete Lego-style composition pipeline (`src/constructions/lego_pipeline.ts`) with:
  - shared context (`retrievedPacks`, `priorFindings`, `focusEntity`)
  - standardized outputs (`findings`, `recommendations`, `confidence`, `evidenceRefs`, `asContext()`)
  - cross-brick execution through knowledge → refactoring → security composition.

## Follow-on Work
- Expand standardized output adapters to all remaining constructions.
- Add explicit session-memory-aware composition runs for multi-turn workflows.
