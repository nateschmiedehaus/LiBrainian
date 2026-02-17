# Extraction Index (Theory → Spec Map)

> **Status**: DRAFT
> **Created**: 2026-01-25
>
> **Purpose**: Provide a canonical, reviewable inventory of what is extracted from `docs/LiBrainian/THEORETICAL_CRITIQUE.md` into `docs/LiBrainian/specs/**`, what is still missing, and what is intentionally deferred.
>
> **Non-theater rule**: This index MUST NOT claim numeric “coverage %” unless backed by a reproducible script + committed artifact output.

---

## Coarse Map

| Theory Region (THEORETICAL_CRITIQUE.md) | Primary Spec Artifact(s) | Status | Notes |
|---|---|---|---|
| Parts I–V (Foundations) | `core/foundations.md` | **Partial** | Stub/spec scaffold exists; full extraction still required. |
| Part VI (Use Cases) | `use-case-targets.md` | Extracted | Use-case definitions and targets. |
| Part VII (Critical Problems) | `critical-usability.md` | Extracted | Critical usability problems and constraints. |
| Part IX (Subsystem Problems) | `subsystem-problems.md` | Extracted | Problem register linked to track specs. |
| Parts XIV–XXI (Tracks) | `track-*.md`, `core/*.md` | Extracted (ongoing) | Track specs encode technique primitives + contracts. |

---

## Required Upkeep (Mechanics)

1. Any new spec file MUST add itself here with:
   - the theory region it implements
   - whether it is extracted vs new synthesis
   - the verification command(s) (tests/gates) that make it executable
   - the behavioral contract entry in `docs/LiBrainian/specs/BEHAVIOR_INDEX.md` (required)
2. Any “extracted” claim MUST have:
   - a stable pointer to theory anchors (chapter/part + topic)
   - at least one executable evidence hook where applicable (Tier‑0 test, gate, or audit artifact)
3. Behavioral completeness is enforced mechanically:
   - `docs/LiBrainian/specs/BEHAVIOR_INDEX.md` must index every spec file (see `src/LiBrainian/__tests__/librarian_spec_behavior_index.test.ts`)
   - use the shared scenarios/load/outage vocabulary in `docs/LiBrainian/specs/core/operational-profiles.md`
