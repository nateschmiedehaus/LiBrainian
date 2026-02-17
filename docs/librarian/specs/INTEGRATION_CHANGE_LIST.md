# Spec-System Integration Change List (Reality → World-Class)

This file lists the **required integration changes** to make the LiBrainian spec system executable, evidence-gated, and aligned with Wave0’s non-negotiable rules (provider honesty, no fake embeddings, tiered testing).

It is intentionally concrete: each item should be implementable with TDD (Tier‑0 first, then Tier‑1/2 where providers are required).

---

## 0. Non-Negotiables (Must Stay True)

- **No fake/deterministic embeddings**: no hash vectors, no “simulate semantic”, no bypass flags.
- **CLI-only auth**: no API-key checks; provider availability must come from the provider gate (`checkAllProviders()` / `requireProviders()`).
- **No silent degradation**: if a capability/provider is required and missing, fail-closed with `unverified_by_trace(...)` (or skip explicitly in Tier‑1).

---

## 0.1 Priority 0: Full LiBrainian Extraction From Wave0 (Do This First)

This is a **stop-the-line priority**. Historically, “we’ll extract later” caused:
- unbounded drift between Wave0 and LiBrainian surfaces,
- tests that exercised internal code paths instead of the real package boundary,
- architecture mismatch (spec describes a standalone knowledge tool, but implementation remains entangled).

**Non-negotiable:** do not implement “LiBrainian essentials” inside Wave0 while extraction is incomplete. If an “essential” is needed, it should be implemented in the extracted LiBrainian package (or as a minimal shim that preserves the boundary).

### Definition of “fully extracted”

“Extracted” means:
- LiBrainian is a standalone repository (`LiBrainian`) with its own CI and docs.
- Wave0 consumes LiBrainian strictly via its public package API (no direct imports of LiBrainian internals).
- `src/LiBrainian/**` in Wave0 is a **thin compatibility shim only** (no new product logic).

### Evidence gates (required)

These must be green **before** major feature work proceeds:
- `docs/LiBrainian/GATES.json`:
  - `layer1.noWave0Imports`
  - `layer1.noDirectImports`
  - `layer1.standaloneTests`
  - `layer1.extractionPrereqs`
  - `layer1.repoExtraction` (tracks the cutover; remains `not_started` until the standalone repo exists)

### TDD sequencing for extraction (do not guess)

1. Add/extend Tier‑0 “package boundary” characterization tests for any surface you are moving.
2. Move code by preserving behavior first (no refactors while extracting).
3. Re-run `layer1.*` gates after each slice; fix boundary breaks immediately.
4. Only after the boundary is stable: begin deeper architectural refactors and feature work.

### Hard stop conditions (honest failure)

If extraction would require any of the following, stop and disclose explicitly (do not improvise):
- introducing a second parallel “method system” / “watch system” / “provider gate”,
- adding API-key or env-key auth fallbacks,
- adding fake embeddings or “semantic simulation” of any kind.

---

## 0.2 Full Build Charter (spec-system requirements, not optional)

The “full build” definition is part of the spec system and must drive implementation sequencing and evidence:
- Canonical: `docs/LiBrainian/specs/README.md` (“Full Build Charter (Council of 30)”)

Hard requirements implied by the charter:
- **Output envelope invariant** must be enforced by façade-level tests (Tier‑2).
- **UC scale without bespoke creep** must be mechanical:
  - UC domains must map to ≥1 construction template.
  - Template budget ≤ 12 must be maintained.
  - Deterministic enforcement exists (Tier‑0) and must be kept green:
    - `packages/LiBrainian/src/__tests__/use_case_matrix_validation.test.ts`
- **≥ 30 Tier‑2 scenario families** are required for any “world-class/full build” claim:
  - see `docs/LiBrainian/specs/core/testing-architecture.md` and the SF‑01…SF‑30 set in the spec manual.

Rule: if any of the above is missing, the corresponding capabilities remain `design`/`unverified_by_trace(...)` until the runnable hooks and artifacts exist.

---

## 1. Spec ↔ Gate Drift (Fix Immediately)

1. **Confidence system naming**
   - Target: Track D uses **`ConfidenceValue`**, not `QuantifiedValue`, and forbids labeled-guess wrappers.
   - Required: `docs/LiBrainian/GATES.json` and `docs/LiBrainian/AGENT_INSTRUCTIONS.md` must not instruct implementers to build placeholder-style wrappers.

2. **Evidence schema canonicalization**
   - Target: canonical v0 evidence entry matches `packages/LiBrainian/src/epistemics/evidence_ledger.ts`.
   - Required: glossary/specs must not define incompatible `EvidenceEntry` shapes that can’t be implemented without translation layers.
   - Guardrail: `src/LiBrainian/__tests__/librarian_spec_drift_guards.test.ts` prevents reintroducing a competing V1 ledger schema into `docs/LiBrainian/specs/layer2-infrastructure.md`.

3. **Doc evidence links must point to real code paths**
   - Target: `docs/LiBrainian/STATUS.md` evidence links must point at `packages/LiBrainian/src/**` (not the `src/LiBrainian/**` shim).

4. **Numeric confidence surfaces must not masquerade as epistemic confidence**
   - Target: semantic/claim confidence is `ConfidenceValue` (Track D), not `number`.
   - Required migrations (high priority):
     - `packages/LiBrainian/src/types.ts` response surfaces (`ContextPack.confidence`, `GraphEdge.confidence`, etc.) must stop using raw numbers for claim confidence.
     - `packages/LiBrainian/src/api/confidence_calibration.ts` must not “calibrate” guessed numbers; calibration can only produce `MeasuredConfidence` when backed by outcome datasets.
   - Transitional rule (until migration completes):
     - numeric scores MAY exist for ranking/heuristics, but MUST be named as such (`score`, `rank`, `signal`) and MUST NOT be presented as calibrated claim confidence.
     - any semantic claim confidence returned to an agent MUST be `absent('uncalibrated')` unless measured data exists.
   - Guardrails:
     - add/extend Tier‑0 tests that fail if public response types expose `confidence: number` as “claim confidence”.
     - update integration docs (`docs/LiBrainian/AGENT_INTEGRATION.md`) to avoid teaching raw-number confidence as a stable contract.

---

## 2. Layer‑2 Infrastructure Wiring (World-Class Foundation)

1. **Evidence ledger wiring (highest leverage)**
   - Required wiring points:
     - Provider discovery → ledger (provider probes, selection, failures)
     - Query pipeline → ledger (stage start/end, retrieval inputs/outputs)
     - MCP tool calls → ledger (tool name, params digest, result digest, duration)
     - Technique execution → ledger (operator events + coverage gaps)
   - Tier‑0 tests:
     - deterministic tests assert “when subsystem emits event, ledger receives entry with stable correlation/session id”.

   **Current status (2026-01-24):**
   - Provider gate emits `tool_call` evidence when a ledger is provided (Tier‑0 test: `packages/LiBrainian/src/__tests__/provider_gate.test.ts`).
   - MCP server tool calls emit `tool_call` evidence to the workspace ledger (Tier‑0 test: `packages/LiBrainian/src/mcp/__tests__/tool_adapter_bridge.test.ts`).
   - Query pipeline + technique execution wiring remains incomplete.

2. **Capability negotiation becomes real**
   - Current v0 exists (`api/capability_contracts.ts`), but it must be wired:
     - operations declare `required` + `optional`
     - outputs disclose `degradedMode` when optional is missing
     - fail-closed with `unverified_by_trace(capability_missing)` when required missing
   - Tier‑0 tests:
     - deterministic tests assert missing required capability blocks execution and surfaces disclosure (not silent).

3. **LLM adapter is the only LLM surface**
   - Required: no direct instantiation outside adapters/tests (enforced by `rg "new LLMService\\(" ...`).
   - Tier‑0 tests:
     - adapter surface is exercised in unit tests without providers (must fail fast, not simulate success).

4. **Knowledge construction registry + evidence-source adapters**
   - Goal: make “anything an agent wants to know” buildable via a small number of canonical knowledge objects (facts/maps/claims/packs).
   - Required:
     - define a `KnowledgeObjectRegistry` (one registry) that lists all required map/fact/claim constructors and their invalidation rules.
      - include a token-budgeted repo-structure `Map` output (`RepoMap` / `SymbolMap`) so large repos can be summarized without context overflow (no “search-only” dependency).
     - define a `ConstructionTemplateRegistry` (one registry) so UC coverage stays elegant:
       - every UC (UC‑001…UC‑310) maps to ≥1 template,
       - templates compile to knowledge objects + adapter requirements + adequacy constraints,
       - adding a UC should rarely require new pipeline code (usually just mapping to existing templates).
     - spec anchors:
       - `docs/LiBrainian/specs/core/knowledge-construction.md`
       - `docs/LiBrainian/specs/core/construction-templates.md`
     - define an `EvidenceSourceAdapter` contract for non-code sources (git/CI/issues/obs), tiered and fail-closed when unavailable.
     - the query pipeline must compile intent → ConstructionPlan (required objects + methods) and must emit adequacy/coverage disclosures.
   - Spec anchor: `docs/LiBrainian/specs/core/knowledge-construction.md`
   - Verification (planned):
     - Tier‑0: deterministic registry completeness test (no “string count” theater).
      - Tier‑2: scenario-driven construction suites over fixture repos covering a wide swath of the “100 things”.

---

## 3. World-Class TDD Sequencing (No Theater)

1. **Characterization tests before extraction**
   - When refactoring pipeline internals, add characterization tests around existing behavior before introducing new seams.

2. **Tier discipline**
   - Tier‑0: deterministic infra + pure logic + failure modes.
   - Tier‑1: integration that may *skip* if providers unavailable (real skip, not early return).
   - Tier‑2: live-provider qualification; fails honestly with `unverified_by_trace(provider_unavailable)` if missing.

3. **Every spec change must map to evidence**
   - New spec requirement ⇒ new/updated test OR new gate OR new audit artifact.
   - No “✅ implemented” without a runnable command + traceable file evidence.

4. **Enforce tier boundaries mechanically (no mixed-tier drift)**
   - Provider-dependent tests MUST live in `*.integration.test.ts` (provider-optional) or `*.system.test.ts` (provider-required).
   - Tier‑0 must not “skip” by returning early; use `ctx.skip(...)` for Tier‑1 or fail fast for Tier‑2.
   - Guardrail test prevents provider checks in plain `*.test.ts`:
     - `packages/LiBrainian/src/__tests__/test_tiering_guard.test.ts`

---

## 4. Extraction Completeness (Spec System Coverage)

The extracted spec set is not complete relative to `THEORETICAL_CRITIQUE.md`. The canonical accounting is in:
- `docs/LiBrainian/specs/EXTRACTION_GAP_REPORT.md`

Any “complete”/“final” claims must be treated as unverified unless backed by that accounting.

---

## 5. Behavior Completeness (Spec System Must Describe Real Use)

1. **Every spec file must have a behavioral contract entry**
   - Requirement: every `docs/LiBrainian/specs/**/*.md` file MUST have an entry in:
     - `docs/LiBrainian/specs/BEHAVIOR_INDEX.md`
   - That entry MUST include `Status`, `Used for`, `Behavior`, and (if executable) `Verification`.
   - Non-negotiable vocabulary for scenarios/loads/outages comes from:
     - `docs/LiBrainian/specs/core/operational-profiles.md`

2. **Mechanical enforcement (Tier‑0)**
   - Guardrail: `src/LiBrainian/__tests__/librarian_spec_behavior_index.test.ts`
     - fails if a spec file is missing from the index
     - fails if an executable entry lacks a runnable verification hook

3. **No “behavior implied by interface”**
   - Interfaces alone are not behavior.
   - Every executable spec must explicitly say what happens under D0–D3, S0–S2, and at least the relevant edge cases (E1–E8), either inline or via its Behavior Index entry.

4. **Explicit foundation use-case verification (UC‑001…UC‑030)**
   - Canonical catalog: `docs/LiBrainian/USE_CASE_MATRIX.md` (L0 = UC‑001…UC‑030).
   - Required: a Tier‑2 suite that executes UC‑001…UC‑030 end‑to‑end against a controlled fixture repo, and fails honestly when providers are unavailable.
   - Non‑negotiable: do not replace this with “coverage %” metrics without a live-provider audit artifact (no theater).
