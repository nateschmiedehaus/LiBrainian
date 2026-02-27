# Spec Template (Copy/Paste)

> **Status**: Canonical template
> **Purpose**: Ensure every new spec is behavior-complete and evidence-gated.

> Use this file as the starting point when adding a new spec under `docs/LiBrainian/specs/**`.

---

## 0) Status and scope

- **Status**: `executable` | `design` | `research_only`
- **Used for**: (who uses it, and how: implementers, agents, reviewers)
- **Non-goals**: (explicitly out of scope)
- **Dependencies**: (other specs, packages, tools)
- **Operational profiles**: list the R*/W*/D*/S* profiles this spec must cover.

---

## 1) Behavioral contract (required)

This spec MUST state what happens under real conditions, using:
- `docs/LiBrainian/specs/core/operational-profiles.md` (R*/W*/D*/S* profiles, E1–E8 edge cases)

### 1.0 Agent experience (required)

Describe how an agent uses this capability *without awkward stitching*:
- What single intent does the agent provide?
- What are the primary outputs the agent consumes (packs, maps, verification plans)?
- What is the “time to first useful output” behavior under W0?
- What disclosures appear when evidence/capabilities are missing?

If this spec supports any UC(s), name them explicitly and state whether it is satisfied:
- directly (deterministic facts/maps),
- indirectly (claims/packs via construction templates),
- or blocked (must return `unverified_by_trace(...)` until prerequisites exist).

### 1.1 Operational profile coverage

List the supported profiles and how behavior changes:
- Repo profiles: R?
- Workloads: W?
- Dependencies: D? and storage S?

### 1.2 Degradation policy

For each required dependency/capability:
- What happens when it is missing?
- Required: fail closed with `unverified_by_trace(...)`
- Optional: degraded mode with explicit disclosure (no silent behavior changes)

### 1.3 Edge cases (E1–E8)

At minimum, define behavior for relevant edge cases:
- E1 (empty input)
- E2 (oversized input)
- E3 (binary/unreadable)
- E4 (partial corpora)
- E5 (conflicting evidence)
- E6 (stale evidence)
- E7 (provider outages/timeouts)
- E8 (storage contention)

### 1.4 Performance and resource budgets

Define how it performs under load and how it behaves when budgets are exceeded:
- Use `docs/LiBrainian/specs/core/performance-budgets.md` as the canonical baseline.
- Specify what “time to first useful output” means for this spec (W0).
- Specify what is timeboxed vs fail-closed (required dependencies must remain fail-closed).

### 1.5 Required output shapes (required for user-visible surfaces)

If the spec produces an “answer” or “knowledge”:
- Define the required envelope fields (v1):
  - adequacy/coverage disclosure (indexed corpus, skipped reasons, freshness, semanticStatus)
  - evidence pointers / replay anchors (trace IDs, artifact IDs)
  - defeaters and “what would falsify this”
  - verification plan when proof is missing
- State which fields are *never allowed to be implied* (e.g., completeness, calibration).

---

## 2) Interfaces (only after behavior)

Define types and interfaces only after the behavioral contract is explicit.

---

## 3) Evidence and verification (required for `executable`)

### 3.1 Tier‑0 tests (deterministic)

- What deterministic invariants must be tested?
- What drift guardrails are required (single registry/entrypoint)?

### 3.2 Tier‑1 tests (provider-optional)

- What tests can run with real providers, and *skip as skipped* if unavailable?

### 3.3 Tier‑2 tests (provider-required)

- What end-to-end behavior must be verified with live providers?

### 3.4 Gate tasks / audit artifacts

- What goes into `docs/LiBrainian/GATES.json`?
- What audit artifacts are produced (and how to generate them deterministically)?

---

## 4) Acceptance criteria

Write scenario-based acceptance criteria (not just technical requirements). Example format:
- Given (profile + starting state)
- When (operation)
- Then (observable behavior + disclosures + evidence hooks)

Prefer acceptance criteria that mirror how an agent actually works:
- “agent asks for X, receives packs/maps + adequacy + verification plan”
- “agent continues under outages/staleness without being lied to”

---

## 5) Implementation plan (TDD)

Sequence work:
1. Tier‑0 (deterministic): invariants + failure modes
2. Wire through real entrypoints (no bypasses)
3. Tier‑1: real provider integration with honest skips
4. Tier‑2: system behavior verification

---

## 6) Spec system bookkeeping (required)

- Add/update entry in `docs/LiBrainian/specs/BEHAVIOR_INDEX.md`
- If `Status` is `executable`, ensure the Behavior Index entry includes at least one runnable `Verification:` hook.
- If adding new scenario vocabulary, update `docs/LiBrainian/specs/core/operational-profiles.md` (and add verification hooks)
- If you change statuses (“design” → “executable”), update `docs/LiBrainian/specs/IMPLEMENTATION_STATUS.md` and the relevant gate status/evidence in `docs/LiBrainian/GATES.json`.

If this spec changes UC coverage:
- Update `docs/LiBrainian/USE_CASE_MATRIX.md` (UC rows and/or template mapping).
- Ensure the UC catalog integrity test still passes:
  - `npm --prefix packages/LiBrainian test -- --run src/__tests__/use_case_matrix_validation.test.ts`
