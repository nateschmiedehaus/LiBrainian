# Foundations (Parts I–V) — Interface Extraction Scaffold

> **Status**: DRAFT (extraction scaffold)
> **Created**: 2026-01-25
>
> **Source**: `docs/LiBrainian/THEORETICAL_CRITIQUE.md` Parts I–V
>
> **Goal**: Convert foundational theory into explicit *interfaces + invariants* that are implementable, testable, and linkable from the track specs.
>
> **Non-theater rule**: This file is intentionally incomplete until the theory sections are extracted with concrete contracts. Do not mark “complete” without linking anchored theory sections and adding executable evidence hooks.

---

## 0. What This File Is (and Isn’t)

- This is the canonical *landing zone* for foundational interfaces the tracks depend on.
- It is not a replacement for Track specs; it provides shared primitives and invariants.
- Until extraction is complete, missing pieces MUST be marked explicitly as `unverified_by_trace(extraction_missing)`.

---

## 1. Technique Semantics (Part I) — `unverified_by_trace(extraction_missing)`

### 1.1 Required Interfaces

- `TechniqueSemantics`
  - Defines how a primitive/composition maps inputs → outputs and what “correctness” means.
- Retrieval miss-rate semantics
  - Defines false negatives/false positives in retrieval and how they surface as defeaters/coverage gaps.

### 1.2 Required Invariants (to be extracted)

- Semantics must be falsifiable via evidence ledger + outcomes (no ungrounded “seems right”).
- Retrieval must produce a coverage report when adequacy is insufficient.

---

## 2. Epistemic State & Belief Revision (Part II) — `unverified_by_trace(extraction_missing)`

### 2.1 Required Interfaces

- `EpistemicState`
  - The agent’s current belief state, including defeaters and confidence boundary.
- `BeliefRevision`
  - How new evidence updates claims, defeaters, and confidence.

### 2.2 Required Invariants (to be extracted)

- Claim confidence MUST be `ConfidenceValue` (see `confidence-boundary.md`).
- Revisions must be logged to the evidence ledger (append-only).

---

## 3. Architectural Constraints (Part III) — `unverified_by_trace(extraction_missing)`

### 3.1 Required Interfaces

- `ArchitecturalConstraints`
  - Non-negotiable integration rules (provider honesty, no fake embeddings, fail-closed).

### 3.2 Required Invariants (to be extracted)

- “CLI auth only” as a hard constraint for all provider interactions.
- “No theater” constraints for tests and gates.

---

## 4. Propagating Impact (Part IV) — `unverified_by_trace(extraction_missing)`

### 4.1 Required Interfaces

- `PropagatingImpact`
  - Given a change, compute likely blast radius + required verifications.

### 4.2 Required Invariants (to be extracted)

- Impact claims must be backed by evidence (graph edges, tests, ownership, commits).

---

## 5. API Review / Validation Interfaces (Part V) — `unverified_by_trace(extraction_missing)`

### 5.1 Required Interfaces

- Validation interfaces for “spec compliance”
  - What does it mean for an implementation to satisfy a spec artifact?

### 5.2 Required Invariants (to be extracted)

- Every validation interface must map to an executable check (Tier‑0 test / gate / audit artifact).

