# Extraction Gap Report (Current)

> **Generated**: 2026-01-24
> **Source**: `docs/LiBrainian/THEORETICAL_CRITIQUE.md` (23,359 lines)
> **Extracted Spec Set**: `docs/LiBrainian/specs/**` (~60k lines)
>
> **Purpose**: Track what is *still missing* from the theory source that must be extracted or linked for a complete, implementable spec system — without “theater”.

---

## What Changed Since the Initial Report

The initial extraction report (2026-01-22) correctly described early gaps, but it is now obsolete:

- Part VI (Use Cases) is extracted in `docs/LiBrainian/specs/use-case-targets.md`
- Part VII (Critical Problems) is extracted in `docs/LiBrainian/specs/critical-usability.md`
- Part IX (Subsystem Problems) is extracted in `docs/LiBrainian/specs/subsystem-problems.md`

This report now focuses on the remaining extraction and linkage gaps.

---

## Current Remaining Gaps (High Signal)

### 1) Parts I–V “Foundations” Interfaces (Still Not Fully Extracted)

These parts contain conceptual + interface-level foundations that should be present as explicit spec artifacts (or clearly marked as intentionally out-of-scope for v1):

- **Part I**: computational semantics (e.g., `TechniqueSemantics`, retrieval miss-rate semantics)
- **Part II**: epistemic state and belief revision (e.g., `EpistemicState`, `BeliefRevision`)
- **Part III**: architectural constraints (e.g., `ArchitecturalConstraints`)
- **Part IV**: solution propagation and impact (e.g., `PropagatingImpact`)
- **Part V**: API review / validation interfaces

**Action**: Extract these into one or more canonical specs (recommended: `specs/core/foundations.md` plus focused sub-specs where needed).

**Current state**: A foundations extraction scaffold now exists at `docs/LiBrainian/specs/core/foundations.md`, but the extraction is still incomplete and must be filled with anchored theory references + executable contracts.

### 2) Theory Reference Blocks: Coverage and Consistency (Incomplete)

Many specs include theory references, but the spec set is not yet consistently “proof-carrying” in the doc sense:

- Some specs lack an explicit theory reference block.
- Some references point to broad “Parts” instead of concrete anchors (part + topic + why).

**Action**: Add a short theory reference block to each track/core spec (not every subsection), and keep it stable.

### 3) Extraction Verification: No Canonical “What’s Extracted” Index

The system needs a canonical, reviewable inventory of extracted material:

- Which theory sections map to which spec files
- Which are still missing
- Which were intentionally deferred

**Action**: Add (or generate) a `specs/EXTRACTION_INDEX.md` mapping Part/Problem → spec file → status, with no numeric “coverage” claims unless backed by a reproducible script + output artifact.

**Current state**: A draft index now exists at `docs/LiBrainian/specs/EXTRACTION_INDEX.md`. It must be kept updated as extraction proceeds.

---

## Status Matrix (Coarse)

| Theory Region | Status | Primary Spec Artifact |
|---|---|---|
| Parts I–V (Foundations) | **Partial / Missing** | (to be extracted) |
| Part VI (Use Cases) | **Extracted** | `use-case-targets.md` |
| Part VII (Critical Problems) | **Extracted** | `critical-usability.md` |
| Part IX (Subsystem Problems) | **Extracted** | `subsystem-problems.md` |
| Parts XIV–XXI (Priority System) | **Extracted** | Track specs (`track-*.md`) + `core/*.md` |

---

## Non-Theater Rule for This Report

- Do not claim numeric “coverage %” without a reproducible script + committed evidence artifact.
- Do not mark items “complete” unless the spec artifact exists and is referenced from the doc map (`docs/LiBrainian/README.md` / `docs/LiBrainian/STATUS.md`) with runnable gates where applicable.
