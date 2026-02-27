# LiBrainian Spec System — Implementation Manual

> **Status**: Canonical (process)
> **Created**: 2026-01-25
>
> **Purpose**: This folder is the executable specification for LiBrainian’s future behavior. It is written so an implementer (human or agent) can implement the system with strict TDD, without guessing missing requirements.

---

## What “spec system” means here

- Specs must define **behavior under real conditions** (repo shape, workloads, outages, edge cases), not only interfaces and types.
- Any claim of “implemented / verified / supported” must be backed by a runnable evidence hook (Tier‑0 test, Tier‑1 skip test, Tier‑2 system test, gate task, or an audit artifact generator).
- If a capability is required and not available, LiBrainian must **fail closed** with an explicit `unverified_by_trace(...)` reason (no silent degradation).

This manual is the “how to implement these specs” page. The per-spec behavioral contracts are in `docs/LiBrainian/specs/BEHAVIOR_INDEX.md`.

---

## Authority & precedence (stop drift)

This folder defines **the intended future behavior** of LiBrainian and how to implement it without guessing.

When documents disagree, resolve the conflict explicitly (do not “average” them):
- **Repo-global precedence** is declared in `config/canon.json` (see `doc_precedence`).
- **Within LiBrainian**:
  - **Current reality**: `docs/LiBrainian/STATUS.md` (what exists and what is verified, with evidence).
  - **Future behavior spec**: `docs/LiBrainian/specs/**` (this folder) + `docs/LiBrainian/USE_CASE_MATRIX.md` (canonical UC inventory).
  - **Tie-break inside the spec system**: `docs/LiBrainian/specs/BEHAVIOR_INDEX.md` + runnable verification hooks are authoritative until corrected.

Important: avoid absolutist guidance like “LiBrainian is non-functional without LLM” unless it is scoped to **higher‑order cognition**. LiBrainian may still provide deterministic maps/packs/adequacy disclosures in provider-degraded modes (see dependency profiles in `docs/LiBrainian/specs/core/operational-profiles.md`).

**Higher‑order cognition (LLM‑required)** means any output that claims understanding, explanation, reasoning, decision support, critique, or synthesis (purpose, mechanism, contract, rationale, consequences). Structural outputs (counts, file locations, dependency lists, AST‑derived facts) are non‑semantic and may run without LLMs **only with explicit disclosure**.

---

## Non-negotiables (Wave0 constraints)

- **No fake embeddings / no deterministic semantic substitutes**
  - If embeddings are required and unavailable, fail closed with `unverified_by_trace(provider_unavailable)` (or Tier‑1 skip).
- **CLI-only auth**
  - Do not add API-key/env key checks; provider readiness must be evaluated via the provider gate (`checkAllProviders()` / `requireProviders()`).
- **No theater**
  - “Green without observation” is forbidden (e.g., returning early instead of a real skip; placeholder confidence; gates that don’t run anything).

## Priority 0: Extract LiBrainian First (Stop-the-line)

The spec system is the *future* LiBrainian: a standalone knowledge tool. To keep reality from drifting away from the spec, **full extraction from Wave0 is the top priority**.

Implement “essentials” inside the extracted LiBrainian package (or as minimal shims that preserve the boundary) rather than entangling Wave0 with LiBrainian internals.

Policy and evidence live in:
- `docs/LiBrainian/specs/INTEGRATION_CHANGE_LIST.md` (Priority 0 section)
- `docs/LiBrainian/GATES.json` (`layer1.*` extraction gates)

Authoritative policy docs (outside this folder):
- `docs/TEST.md`
- `docs/AUTHENTICATION.md`
- `src/EMBEDDING_RULES.md`
- `docs/LIVE_PROVIDERS_PLAYBOOK.md`

---

## Reading order (implementation-first)

1. `docs/LiBrainian/specs/BEHAVIOR_INDEX.md`
2. `docs/LiBrainian/specs/core/operational-profiles.md`
3. `docs/LiBrainian/specs/core/performance-budgets.md`
4. `docs/LiBrainian/specs/core/testing-architecture.md`
5. `docs/LiBrainian/specs/core/work-objects.md`
6. `docs/LiBrainian/specs/core/knowledge-construction.md`
7. `docs/LiBrainian/specs/core/construction-templates.md`
8. `docs/LiBrainian/specs/INTEGRATION_CHANGE_LIST.md` and `docs/LiBrainian/specs/IMPLEMENTATION_FAILURE_RCA.md`
9. Then the specific track/core spec(s) you’re implementing.

Rule: If a spec doc and the Behavior Index disagree about behavior/status, treat the Behavior Index + runnable evidence as authoritative until corrected.

---

## Full Build Charter (Council of 30) — what “done” means (world‑class)

This section is the spec-system’s “world‑class target contract”. It is intentionally strict and evidence-driven.

### Definition of done (full build; not MVP)

LiBrainian is “full build” only when ALL are true:
- **Output envelope invariant**: every query returns:
  - `packs[]`
  - `adequacy`
  - `disclosures[]`
  - `verificationPlan`
  - `traceId` (or explicit `unverified_by_trace(replay_unavailable)`)
- **UC scale without bespoke creep**:
  - UC‑001…UC‑310 are satisfiable **without** “one UC = one endpoint/pipeline”.
  - Every UC domain maps mechanically to ≥1 construction template.
  - Template set is **≤ 12** in v1; templates are reusable programs, not one-offs.
- **Tiers and honesty are real**:
  - Tier‑0 is deterministic and provider-free.
  - Tier‑1 uses real providers or **skips as skipped**.
  - Tier‑2 requires providers and fails honestly when unavailable.
- **Scenario evidence exists**:
  - Tier‑2 scenario suites exist for **≥ 30 scenario families** spanning:
    - repo profiles (R0–R4),
    - workloads (W0–W3),
    - outages/storage modes (D0–D3 / S0–S2),
    - edge cases (E1–E8).
  - Every “works” claim links to a runnable hook + audit artifact.
- **No silent degradation**:
  - provider failures never “fall back” to weaker cognition silently;
  - deterministic maps/packs may still run under degraded modes, but semantic claims must fail closed with explicit `unverified_by_trace(...)`.

### Phase order (full build program; stop-the-line sequencing)

0. **Priority‑0 extraction + boundary lock**
   - Goal: LiBrainian is standalone; Wave0 consumes only public package API; no product logic lives on the wrong side of the boundary.
   - Gates: `docs/LiBrainian/GATES.json` `layer1.*` (especially `layer1.repoExtraction`).

1. **Kernel (unskippable base)**
   - capability negotiation (required/optional + degraded-mode disclosure)
   - provider gate + adapters (CLI auth only; no fake embeddings)
   - evidence ledger (append-only; correlated; stage/tool/provider events)
   - replay anchor (`traceId` and replayable ledger chain semantics)

2. **Knowledge object system (the atlas)**
   - registries: `RepoFacts`, `Maps`, `Claims`, `Packs`, `Episodes/Outcomes`
   - stable IDs, invalidation rules, freshness cursors
   - deterministic ingestion: AST/indexing, manifests/configs, docs, git metadata

3. **Construction compiler + template execution**
   - intent → `ConstructionPlan` (templates + objects + methods + budgets + adequacy requirements)
   - one template registry (single entrypoint)
   - template selection is recorded in evidence ledger

4. **World-class retrieval + synthesis (D0 only)**
   - embeddings-backed retrieval; graph/rerank only if justified by measured outcomes
   - synthesis emits evidence metadata + defeaters
   - strict separation: ranking scores ≠ epistemic claim confidence (`ConfidenceValue` for claims only)

5. **Work objects + verification orchestration**
   - verification plans compile into durable tasks (DoD obligations)
   - tasks and outcomes are replayable/auditable artifacts

6. **Scale modes**
   - W1 batch bootstrap (resumable; per-file timeboxed; no “one file blocks phase”)
   - W2 watch (incremental; freshness always reported)
   - W3 multi-agent concurrency (bounded contention; stable correlation IDs; conflict objects)

7. **External adapters (optional enrichment; never required for truth)**
   - CI/issues/observability adapters enrich evidence
   - missing adapters produce explicit `unverified_by_trace(external_evidence_unavailable:<adapter>)`

8. **Calibration + learning loop**
   - outcomes captured as first-class evidence
   - calibration artifacts produced
   - claim confidence remains `absent('uncalibrated')` until measured

### Council of 30 roles — enforceable mandates (what must be true in the spec system)

Each mandate is tied to a canonical spec home and an enforcement mechanism. If enforcement is “planned”, the spec MUST label the capability `design` until the hook exists.

1) **Chief Architect** — freeze the output envelope; everything compiles to templates.
- Spec homes: `docs/LiBrainian/specs/core/knowledge-construction.md`, `docs/LiBrainian/specs/core/construction-templates.md`
- Enforcement: planned Tier‑0 “envelope shape” tests + Tier‑2 façade scenario suites.

2) **Spec Systems Engineer** — behavior-first, profile-driven specs; Behavior Index is authoritative.
- Spec homes: `docs/LiBrainian/specs/BEHAVIOR_INDEX.md`, `docs/LiBrainian/specs/core/operational-profiles.md`
- Enforcement: `src/LiBrainian/__tests__/librarian_spec_behavior_index.test.ts`

3) **TDD Purist** — Tier‑0 first; if you can’t test the invariant deterministically, you haven’t specified it.
- Spec homes: `docs/LiBrainian/specs/core/testing-architecture.md`
- Enforcement: tiering guards in `packages/LiBrainian/src/__tests__/test_tiering_guard.test.ts` + Tier‑0 gates in `docs/LiBrainian/GATES.json`.

4) **Epistemologist** — no claim without evidence + defeaters; no invented confidence.
- Spec homes: `docs/LiBrainian/specs/core/confidence-boundary.md`, `docs/LiBrainian/specs/track-d-quantification.md`, `docs/LiBrainian/specs/track-f-epistemology.md`
- Enforcement: Track‑D unit tests in `packages/LiBrainian/src/epistemics/__tests__/*`

5) **Provider/Infra Engineer** — one provider gate, CLI auth only, explicit outages.
- Spec homes: `docs/LiBrainian/specs/core/testing-architecture.md`, `docs/LiBrainian/specs/layer2-infrastructure.md`
- Enforcement: provider gate tests in `packages/LiBrainian/src/__tests__/provider_gate.test.ts`

6) **Embeddings Specialist** — embeddings are real or absent; no fake vectors.
- Spec homes: `docs/LiBrainian/specs/core/testing-architecture.md`, `src/EMBEDDING_RULES.md`, `docs/LIVE_PROVIDERS_PLAYBOOK.md`
- Enforcement: forbidden pattern checks + provider gate semantics; Tier‑2 suites required for semantic validation.

7) **Reliability Engineer** — degraded modes are first-class; “non-functional” applies to semantic synthesis only.
- Spec homes: `docs/LiBrainian/specs/core/operational-profiles.md`
- Enforcement: deterministic tests for degraded-mode disclosure (planned) + Tier‑2 outage scenario families (planned).

8) **Data Modeler** — stable knowledge objects with IDs + invalidation + freshness.
- Spec homes: `docs/LiBrainian/specs/core/knowledge-construction.md`
- Enforcement: planned Tier‑0 registry completeness tests.

9) **Storage Engineer** — sqlite default; S1/S2 behavior specified; no silent drops.
- Spec homes: `docs/LiBrainian/specs/core/evidence-ledger.md`, `docs/LiBrainian/specs/core/operational-profiles.md`
- Enforcement: storage/ledger tests under `packages/LiBrainian/src/epistemics/__tests__/` (partial today).

10) **Replay/Tracing Engineer** — append-only ledger with correlation IDs; replay detects regressions.
- Spec homes: `docs/LiBrainian/specs/core/evidence-ledger.md`
- Enforcement: partial tests exist; full replay gate is required before “executable”.

11) **Performance Engineer** — budgets are specs; meeting them requires audit artifacts.
- Spec homes: `docs/LiBrainian/specs/core/performance-budgets.md`
- Enforcement: planned Tier‑2 performance report artifact + gate.

12) **Large-Repo Engineer** — token-budgeted repo maps; no full scan per query (except disclosed W1).
- Spec homes: `docs/LiBrainian/specs/core/construction-templates.md` (RepoMap), `docs/LiBrainian/specs/core/performance-budgets.md`
- Enforcement: planned Tier‑2 R3/R4 scenario families.

13) **Watch Mode Engineer** — W2 is invariant: incremental, debounced, freshness always surfaced.
- Spec homes: `docs/LiBrainian/specs/core/performance-budgets.md`, `docs/LiBrainian/specs/core/operational-profiles.md`
- Enforcement: watch health + incremental tests exist in code; Tier‑2 scenario families required.

14) **Concurrency Engineer** — W3 safe writes; bounded contention; conflict objects.
- Spec homes: `docs/LiBrainian/specs/core/operational-profiles.md`, `docs/LiBrainian/specs/core/work-objects.md`
- Enforcement: contention behavior must be tested deterministically; multi-agent Tier‑2 scenarios required.

15) **Security Engineer** — hostile inputs; injection/poisoning modeled; security failures are disclosures.
- Spec homes: `docs/LiBrainian/specs/track-g-security.md`
- Enforcement: security test suites under `packages/LiBrainian/src/security/**`.

16) **Supply Chain Engineer** — provenance-first SBOM/risk; manifest-only fallback disclosed.
- Spec homes: `docs/LiBrainian/specs/core/construction-templates.md` (SupplyChain)
- Enforcement: planned Tier‑2 scenario families with adapter-missing disclosures.

17) **Compliance Engineer** — never infer compliance; evidence packs only; missing evidence is disclosed.
- Spec homes: `docs/LiBrainian/specs/core/construction-templates.md` (ComplianceEvidence)
- Enforcement: planned Tier‑2 compliance evidence scenarios.

18) **Product Engineer** — one call unblocks: orientation + edit context + next actions.
- Spec homes: `docs/LiBrainian/specs/core/knowledge-construction.md`
- Enforcement: Tier‑2 “agent unblocking” scenario families.

19) **UX for Agents Specialist** — packs are budgeted and prioritized; always show what’s missing and what to do next.
- Spec homes: `docs/LiBrainian/specs/core/performance-budgets.md`, `docs/LiBrainian/specs/core/knowledge-construction.md`
- Enforcement: planned pack adequacy audits + scenario suites.

20) **API Designer** — library API and MCP share pipeline + envelope; one registry + drift test.
- Spec homes: `docs/LiBrainian/specs/layer2-infrastructure.md`
- Enforcement: MCP tool registry tests under `packages/LiBrainian/src/mcp/__tests__/`.

21) **Tooling Engineer** — tools must be callable via real entrypoint; tests must not bypass.
- Spec homes: `docs/LiBrainian/specs/IMPLEMENTATION_FAILURE_RCA.md`
- Enforcement: tool-entrypoint tests + drift guards (present).

22) **Extraction/Modularity Engineer** — extraction is Priority‑0; lock boundary before features.
- Spec homes: `docs/LiBrainian/specs/INTEGRATION_CHANGE_LIST.md`
- Enforcement: `docs/LiBrainian/GATES.json` `layer1.*` gates.

23) **Refactoring Surgeon** — no refactors while extracting; characterization tests first.
- Spec homes: `docs/LiBrainian/specs/INTEGRATION_CHANGE_LIST.md`
- Enforcement: process discipline enforced via gates and review; add characterization test requirement per moved surface.

24) **Quality Gates Engineer** — no green without observation; gates must carry evidence.
- Spec homes: `docs/LiBrainian/specs/core/testing-architecture.md`
- Enforcement: `src/LiBrainian/__tests__/librarian_gate_theater.test.ts`

25) **Evaluation Scientist** — define “world-class” as scenario outcomes and artifacts; measure, don’t assert.
- Spec homes: `docs/LiBrainian/specs/core/performance-budgets.md`
- Enforcement: planned evaluation artifact gates.

26) **Calibration Engineer** — confidence becomes real only with outcomes; until then absent.
- Spec homes: `docs/LiBrainian/specs/track-d-quantification.md`, `docs/LiBrainian/specs/track-f-epistemology.md`
- Enforcement: calibration tests + artifact requirements (partial today).

27) **Knowledge Graph Engineer** — maps are provenance-first graphs with defeaters and staleness decay.
- Spec homes: `docs/LiBrainian/specs/core/knowledge-construction.md`
- Enforcement: planned graph/map correctness suites.

28) **Incident Response Engineer** — runbooks/obs are optional evidence sources; missing produces “create runbook” tasks.
- Spec homes: `docs/LiBrainian/specs/core/construction-templates.md` (ObservabilityRunbooks)
- Enforcement: planned Tier‑2 incident scenario families.

29) **Documentation Engineer** — one canonical home per concept; behavior+usage scenarios required.
- Spec homes: `docs/LiBrainian/specs/README.md`
- Enforcement: drift guards + budget guards in `src/LiBrainian/__tests__/librarian_spec_budget_guards.test.ts`.

30) **Program Manager** — UC scale maps to templates; ≥30 Tier‑2 scenario families required for “full build”.
- Spec homes: this section + `docs/LiBrainian/GATES.json`
- Enforcement: planned Tier‑2 scenario family suite gates + artifact paths.

### 30 historical lenses — how the council forces “world‑best” without theater

These lenses are not “extra philosophy”; they are directives for what the spec system must explicitly state and how we must prove it.

**Lens 01 — Turing (decidability boundaries)**
- Encode: question classes (decidable vs empirical vs probabilistic vs unverifiable) and refusal correctness.
- Spec translation: “semantic claim” is a distinct category requiring providers + evidence + defeaters; deterministic maps are allowed under D2/D3.
- Proof: negative-control suites where the correct behavior is refusal or “map + verification plan”, not narrative.

**Lens 02 — Shannon (context as channel)**
- Encode: pack codecs and token budgets as first-class contracts; “what got dropped” is mandatory output data.
- Spec translation: “pack rendering” is a deterministic transform with a budget allocator; structure-first (maps) before prose.
- Proof: deterministic pack digest tests + Tier‑2 “TTFU and adequacy under budget” audits.

**Lens 03 — von Neumann (one machine / one IR)**
- Encode: one ConstructionPlan IR and one runtime; forbid parallel “special pipelines”.
- Spec translation: templates compile to IR; IR is the only executable path.
- Proof: drift guards that fail if new entrypoints appear; replay topology checks.

**Lens 04 — Knuth (algorithmic clarity + measurement)**
- Encode: complexity expectations and performance budgets; no “fast” claims without a measurement hook.
- Spec translation: indexing, invalidation, and map construction have explicit algorithm contracts.
- Proof: Tier‑2 performance reports gated by budgets; regression artifacts are required.

**Lens 05 — Dijkstra (simplicity + explicit failure)**
- Encode: no silent fallbacks; refusal and disclosure behavior is a correctness requirement.
- Spec translation: every spec must define D*/S*/E* behavior; “best effort” is forbidden unless labeled partial with missing stages listed.
- Proof: must-refuse suites and “no silent stage skipping” tests.

**Lens 06 — Hoare (contracts)**
- Encode: preconditions/postconditions/invariants for stages and templates; violations produce typed stop reasons.
- Spec translation: every template has explicit required outputs (adequacy, disclosures, verification plan).
- Proof: contract tests and violation traces that show the correct stop reason and disclosure.

**Lens 07 — Lamport (temporal correctness)**
- Encode: ordering/atomicity invariants for ledger + storage under concurrency; multi-agent correctness is specified, not assumed.
- Spec translation: replay semantics and conflict objects are first-class outputs.
- Proof: deterministic concurrent fixtures + replay-digest invariants.

**Lens 08 — Liskov (substitutability)**
- Encode: provider/storage/pack interfaces that can be swapped without changing semantics.
- Spec translation: adapters are behind stable interfaces; “capabilities” not “provider names” flow through the pipeline.
- Proof: shared contract test suite across adapters/backends.

**Lens 09 — Parnas (information hiding)**
- Encode: layers aligned to reasons-to-change; forbid dependency inversions that create drift.
- Spec translation: stable core objects/IR vs volatile ingestion/retrieval adapters vs volatile pack UX.
- Proof: dependency gates and “single registry” tests per surface.

**Lens 10 — Brooks (conceptual integrity)**
- Encode: one user story and one envelope; no micro-API stitching for normal work.
- Spec translation: façade contract defines the agent interaction; templates are internal programs.
- Proof: Tier‑2 scenario suites are written against the façade only.

**Lens 11 — Hamilton (hazard-driven safety)**
- Encode: hazards (hallucination, stale evidence, partial corpora, poisoning, concurrency corruption) and mandatory mitigations.
- Spec translation: safety checks gate synthesis; refusal behavior is required under hazards.
- Proof: must-fail suites that prove refusal and correct disclosures under hazards.

**Lens 12 — Hopper (debuggability as product)**
- Encode: diagnostics and trace inspection are mandatory; “why was this answer limited?” must always be answerable.
- Spec translation: stage report + capability report + adequacy report are always present.
- Proof: “operator can root-cause from artifacts” scenario family.

**Lens 13 — Thompson (boundary discipline)**
- Encode: all real behavior goes through public entrypoints; tests must not bypass surfaces.
- Spec translation: tool registry is single-source and callable via the real schema path.
- Proof: entrypoint traversal tests; drift guards for tool listing vs callTool.

**Lens 14 — Ritchie (portability across repos)**
- Encode: repo profile variability; unknown languages must degrade honestly, not fail silently.
- Spec translation: corpus inventory and partial coverage disclosures are mandatory.
- Proof: fixture zoo across R0–R4 with adequacy correctness checks.

**Lens 15 — Kernighan (clarity)**
- Encode: specs must be readable and enforceable; no competing definitions.
- Spec translation: glossary is canonical; spec format is standardized; summary elsewhere must be non-canonical.
- Proof: doc drift and anti-duplication guardrails.

**Lens 16 — Backus (pure compilation)**
- Encode: intent→plan compilation is deterministic and testable; execution is effectful and logged.
- Spec translation: compilation emits plan digest; execution emits stage evidence.
- Proof: golden compilation tests and replayable plan execution traces.

**Lens 17 — Wirth (disciplined data structures)**
- Encode: stable schemas and versioning; migrations are first-class work.
- Spec translation: facts/maps/claims/packs are structured objects, not blobs.
- Proof: migration tests; schema compatibility gates.

**Lens 18 — Milner (types prevent category errors)**
- Encode: claim confidence is `ConfidenceValue`; ranking signals are separate and labeled.
- Spec translation: builders enforce evidence refs/defeaters; illegal states are unrepresentable.
- Proof: Tier‑0 scans and type-level enforcement preventing raw numeric claim confidence.

**Lens 19 — McCarthy (belief revision)**
- Encode: defeaters and contradiction handling; system must retract/condition claims as evidence changes.
- Spec translation: claim revision events are recorded; conflicts are surfaced, not averaged away.
- Proof: E5 conflict scenario families that require explicit contradiction objects.

**Lens 20 — Newell (methods and meta-cognition)**
- Encode: templates are reusable programs that return “how to proceed”, not just retrieved text.
- Spec translation: verification plan + uncertainty reduction are mandatory outputs for uncertain states.
- Proof: “agent unblocking” suites measuring time/steps to verified completion.

**Lens 21 — Codd (relational integrity)**
- Encode: queryable, integrity-checked knowledge store.
- Spec translation: object store constraints (IDs, references) and corruption behavior are specified.
- Proof: integrity tests; “no orphan refs” invariants.

**Lens 22 — Gray (transactions and recovery)**
- Encode: atomicity/idempotency/resumability; interruption does not corrupt knowledge.
- Spec translation: checkpointing and bounded retries are defined under S1/S2/E8.
- Proof: kill-and-resume suites and multiprocess atomicity tests.

**Lens 23 — Stonebraker (workload-driven engines)**
- Encode: choose engines by workload (relational/graph/vector), unified via planning.
- Spec translation: plan compiler selects cheapest adequate path; vector retrieval is enrichment, not a crutch.
- Proof: evaluation harness that shows engine choice improves outcomes.

**Lens 24 — Hennessy (pipeline and backpressure)**
- Encode: staged execution with timeboxes and partial-result semantics.
- Spec translation: stage reporting is mandatory; timeboxing cannot become silent downgrade.
- Proof: performance artifacts + “no silent stage skipping” suites.

**Lens 25 — Patterson (quantify and iterate)**
- Encode: “world-class” is measured; every feature claims a measurable improvement.
- Spec translation: scenario suites and artifacts are the only accepted proof.
- Proof: regression gates on scenario outcomes and adequacy correctness.

**Lens 26 — Hamming (falsification)**
- Encode: negative controls: must-refuse, must-disclose gaps, must-surface conflicts.
- Spec translation: critics block narrative answers when proof is absent.
- Proof: required negative-control scenario families; refusal correctness gates.

**Lens 27 — Kay (maps as UI)**
- Encode: maps and views are primary UI; synthesis is annotation, not replacement.
- Spec translation: repo map and edit context packs are first-class outputs with budgets.
- Proof: orientation/edit workflows verified by Tier‑2 scenario families.

**Lens 28 — Engelbart (durable augmentation)**
- Encode: outputs compile into durable work objects and artifacts; knowledge compounds over time.
- Spec translation: verification plans become DoD tasks; plan mutations are event-sourced.
- Proof: end-to-end “knowledge → work → artifact → replay” suites.

**Lens 29 — Torvalds (integration reality)**
- Encode: extraction-first boundary discipline; public API stability is a stop-the-line constraint.
- Spec translation: gates block feature work when boundary is incomplete.
- Proof: extraction gates and package-only verification suites.

**Lens 30 — Carmack (instrumentation and determinism under load)**
- Encode: profiling, tracing, and deterministic behavior where possible; debuggability under load is a feature.
- Spec translation: every Tier‑2 run must emit trace + performance artifacts; hotspots are optimized based on evidence.
- Proof: perf regression gates + trace replay reports required for pass claims.

### Tier‑2 scenario families (≥ 30) — required for “full build” claims

These are scenario FAMILY definitions (not one-off tests). Each family must:
- declare targeted profiles (R*/W*/D*/S*/E*)
- declare primary templates involved (`T#` identifiers)
- emit audit artifacts (at minimum):
  - `AdequacyReport.v1.json`
  - `TraceReplayReport.v1.json`
  - `PerformanceReport.v1.json` (where the family is performance-sensitive)
- include negative controls (must-refuse / must-disclose) when applicable

**Scenario Families (SF‑01…SF‑30)**

SF‑01 Orientation baseline (R0/R1; W0; D3) — deterministic maps/packs only; semantic stages blocked with disclosure.  
SF‑02 RepoMap at scale (R3; W0/W1; S1) — token-budgeted map; incremental indexing; explicit partial-corpus adequacy.  
SF‑03 Multi-repo correlation (R4; W0; D2/D3) — cross-repo edges labeled stale/unknown; defeaters required.  
SF‑04 EditContext minimality (R2; W0; D0/D2) — smallest sufficient neighborhood; budgeted; explicit exclusions.  
SF‑05 Change delta and risk (R2/R3; W0; D2) — delta map with git optional; missing git disclosed.  
SF‑06 VerificationPlan compilation (R1–R4; W0; D0/D3) — always emits verification plan; provider-required checks labeled Tier‑2 only.  
SF‑07 Impacted tests selection (R2/R3; W0/W1; D2) — uncertainty disclosure when mappings incomplete.  
SF‑08 Repro+bisect workflow (R2; W1; D3) — produces plan/work objects; never pretends it executed.  
SF‑09 Dependency/SBOM provenance (R1–R3; W1; D2) — manifest-only fallback disclosed when scanners absent.  
SF‑10 Infra map extraction (R2/R3; W1; D2/D3) — IaC/k8s detection; missing adapters disclosed.  
SF‑11 Observability/runbook synthesis (R2; W0; D0/D3) — missing runbooks yields “create runbook” work objects.  
SF‑12 Compliance evidence packs (R2; W1; D2/D3) — missing evidence is explicit; no compliance inference.  
SF‑13 Security threat model + findings (R2; W1; D0) — outputs evidence-backed risks + verification tasks.  
SF‑14 Performance investigation (R2; W0/W1; D0/D3) — refuses to claim perf root cause without evidence; suggests measurement plan.  
SF‑15 API surface inventory (R1/R2; W0; D2) — maps exports/endpoints; no semantic claims required.  
SF‑16 Config precedence tracing (R2; W0; D2) — traces config sources; partial corpora disclosed.  
SF‑17 Authn/authz understanding (R2; W0; D0/D2) — if LLM absent, returns map + verification plan only.  
SF‑18 Data model and schema mapping (R2; W0/W1; D2) — maps schema locations; gaps disclosed.  
SF‑19 Ownership and codeowners (R1–R4; W0; D2) — ownership map; missing ownership disclosed.  
SF‑20 Incident timeline reconstruction (R2; W1; D2/D3) — if logs/issues unavailable, produces explicit external evidence gap + plan.  
SF‑21 Refactor planning (R2/R3; W0; D2) — produces safe step plan + tests selection + risk/impact disclosures.  
SF‑22 Release readiness (R2/R3; W0/W1; D2/D3) — verification obligations; refuses to certify without evidence.  
SF‑23 Build/test command discovery (R1–R3; W0; D3) — deterministic extraction; semantics optional.  
SF‑24 Watch freshness drift (R1/R3; W2; S1) — freshness always reported; degraded watch health disclosed.  
SF‑25 Multi-agent conflict merge (R2; W3; S1) — conflict objects surfaced; no silent overwrite.  
SF‑26 Stale evidence decay (R1–R4; W0; E6) — stale evidence becomes defeater; adequacy reflects staleness.  
SF‑27 Conflicting evidence handling (R1–R4; W0; E5) — explicit contradiction objects; no “averaging away.”  
SF‑28 Oversized input handling (R3; W0/W1; E2) — timebox/truncate with explicit disclosure; no silent drops.  
SF‑29 Provider outage semantics (R1–R4; W0; D3/E7) — semantic stages fail closed; deterministic maps still serve.  
SF‑30 Storage contention/corruption semantics (R2; W0/W1/W3; S1/S2/E8) — bounded retries/backoff or fail closed with remediation.

**Note**: These family definitions are binding requirements; implementation details (exact tests, fixtures, artifact paths) are owned by the Tier‑2 suite specs and gates.

---

## Spec budget + anti-duplication rule (stop accretion)

This spec system must not become “endless docs” that drift and can’t be implemented. Treat **coherence** as a first-class requirement.

Rules:
- **One canonical home per concept.** If two docs define the same thing, that’s a spec bug. Pick one canonical file; other docs must link.
- **Inventories live in one place.** Examples:
  - Use cases live in `docs/LiBrainian/USE_CASE_MATRIX.md` (do not copy large UC lists into other specs).
  - Construction template contract + template set live in `docs/LiBrainian/specs/core/construction-templates.md`.
- **Prefer extending over adding.** Adding a new spec file is only justified when it *reduces* ambiguity and prevents drift (e.g., by creating a single canonical home).
- **Template admission is strict.** New construction templates are allowed only if they are broadly reusable (≥3 UCs) or they replace/merge existing templates. Otherwise, add a new map/pack type under an existing template. Canonical policy: `docs/LiBrainian/specs/core/construction-templates.md`.
- **If you must summarize elsewhere, label it as non-canonical.** Provide a pointer to the canonical source and avoid duplicating tables/mappings.

---

## Test tiers (TDD sequencing)

- **Tier‑0 (`*.test.ts`)**: deterministic logic only; no provider calls.
- **Tier‑1 (`*.integration.test.ts`)**: may call real providers; must *skip as skipped* if unavailable (no early-return “pass”).
- **Tier‑2 (`*.system.test.ts`)**: provider-required; must fail honestly if providers unavailable.

This tiering is enforced mechanically (see `docs/LiBrainian/specs/core/testing-architecture.md`).

---

## How to implement a spec (step-by-step)

1. Pick a spec file and read its entry in `docs/LiBrainian/specs/BEHAVIOR_INDEX.md`.
2. Identify the target **operational profiles** (R*/W*/D*/S*) and edge cases (E1–E8) it must cover.
3. Write Tier‑0 tests for:
   - deterministic contracts (types, parsing, schemas, failure modes)
   - “fail-closed” disclosure paths (`unverified_by_trace(...)`)
   - drift prevention (single entrypoint / single registry) where relevant
4. Add Tier‑1/Tier‑2 tests only when the behavior requires real providers.
5. Update gates (if required) in `docs/LiBrainian/GATES.json`:
   - commands must be runnable
   - statuses must not claim `pass`/`partial`/`skip_when_unavailable` without run metadata
6. Update documentation status honestly:
   - “implemented” means runnable + gated; otherwise use `design` or `research_only`.

---

## Changing/adding spec files (mechanical requirements)

When you add or rename a spec file under `docs/LiBrainian/specs/**`:
- Start from `docs/LiBrainian/specs/SPEC_TEMPLATE.md` (recommended).
- Add/update its entry in `docs/LiBrainian/specs/BEHAVIOR_INDEX.md` (required).
- Use `docs/LiBrainian/specs/core/operational-profiles.md` vocabulary for conditions.
- If its `Status:` is `executable`, include at least one runnable verification hook.

Tier‑0 enforcement:
- `src/LiBrainian/__tests__/librarian_spec_behavior_index.test.ts`

---

## Validation commands

Deterministic gate:
- `npm run test:tier0`

LiBrainian-only deterministic tests:
- `npm --prefix packages/LiBrainian test -- --run`

Live-provider gates (Tier‑2) are intentionally separate; see:
- `docs/LiBrainian/GATES.json`

---

## Spec system map (where instructions live)

- `docs/LiBrainian/specs/BEHAVIOR_INDEX.md`
  - The behavioral contract index. Every spec file must have an entry here.
- `docs/LiBrainian/specs/core/operational-profiles.md`
  - Shared vocabulary for repo profiles (R*), workloads (W*), dependencies/storage (D*/S*), edge cases (E1–E8).
- `docs/LiBrainian/specs/core/testing-architecture.md`
  - Tier policy + “no theater” rules.
- `docs/LiBrainian/specs/INTEGRATION_CHANGE_LIST.md`
  - Concrete integration work required for executability (wiring, drift fixes, sequencing).
- `docs/LiBrainian/specs/IMPLEMENTATION_FAILURE_RCA.md`
  - Root-causes and mechanical guardrails (tests/gates) that prevent repeat failure.
- `docs/LiBrainian/specs/IMPLEMENTATION_STATUS.md`
  - “Verified vs unverified” truth table; do not mark “done” without evidence.
- `docs/LiBrainian/specs/GLOSSARY.md`
  - Canonical terminology; avoid competing definitions.
- `docs/LiBrainian/specs/EXTRACTION_INDEX.md` + `docs/LiBrainian/specs/EXTRACTION_GAP_REPORT.md`
  - Accounting for theory→spec extraction gaps (prevents “complete” theater).

---

## Definition of done (per spec status)

### If a spec entry is `executable`

It must be implementable without guesswork and must not lie:
- Behavioral contract covers relevant profiles (R*/W*/D*/S*) and edge cases (E1–E8) via the spec itself and/or its `BEHAVIOR_INDEX` entry.
- At least one runnable verification hook exists and is referenced in `BEHAVIOR_INDEX` (`Verification:` field).
- Tests obey tier rules:
  - Tier‑0 is deterministic only (no providers).
  - Tier‑1 uses real providers and skips honestly when unavailable.
  - Tier‑2 requires providers and fails honestly when unavailable.
- Degradation is explicit:
  - required capability missing ⇒ `unverified_by_trace(...)` (fail closed)
  - optional capability missing ⇒ degraded mode + disclosure (no silent changes)

### If a spec entry is `design`

- It can be incomplete, but it must say what is missing and what the system must do until it is implemented:
  - missing core dependency ⇒ `unverified_by_trace(extraction_missing|replay_unavailable|capability_missing|...)`
- It must not use “Implemented” labels unless there is runnable evidence.

### If a spec entry is `research_only`

- It must be treated as reference material only, never as an implemented capability.

---

## Writing behavior (required content)

When you write or update a spec, ensure behavior is observable under the operational profiles:

- **Repo profile (R0–R4)**: what changes for docs-only vs monorepo vs multi-repo?
- **Workload (W0–W3)**: interactive latency vs batch throughput vs watch stability vs multi-agent concurrency.
- **Dependencies (D0–D3) and storage (S0–S2)**: what fails closed vs what can degrade?
- **Edge cases (E1–E8)**: what happens for empty inputs, oversized inputs, partial corpora, stale/conflicting evidence, outages, storage contention?

Rule: if the spec describes an “answer” or “claim”, it must describe the disclosure behavior:
- what is claimed
- what is not claimed
- what is marked as unknown / unverified

---

## Evidence hooks (how to make specs executable)

Use the smallest honest hook that would catch regressions:

- **Tier‑0**: schemas, type boundaries, deterministic transforms, fail-closed errors, “single entrypoint” drift guards.
- **Tier‑1**: integration with real providers, but skip with `ctx.skip(...)` when unavailable (must show as skipped).
- **Tier‑2**: end-to-end behavior. No mocks. If providers are missing, fail with `unverified_by_trace(provider_unavailable)`.

If you add or change a gate in `docs/LiBrainian/GATES.json`:
- the command must be runnable
- statuses `pass|partial|skip_when_unavailable` must include `lastRun` and `evidence`
- do not add “string count” gates (they’re theater)

---

## Standard `unverified_by_trace(...)` guidance

Use stable, specific reasons so failures are actionable and searchable. Common reasons:
- `provider_unavailable` (no required providers)
- `embedding_unavailable` (embeddings required but missing)
- `llm_required` (LLM required but missing)
- `capability_missing(<capability>)` (capability negotiation blocks operation)
- `replay_unavailable` (evidence/replay chain missing for a claim)
- `extraction_missing` (spec extraction prerequisite not done)

Rule: do not invent “confidence numbers” to paper over missing evidence; use `ConfidenceValue` semantics and disclose absence.

---

## Anti-repeat mechanics (do this, every time)

- One registry / one entrypoint / one deterministic drift test for every public surface (provider gate, MCP tools, query pipeline).
- Never mark “implemented” without runnable evidence.
- Never “skip” by returning early in tests (that’s a pass, and it’s theater).

---

## Worked example (recommended): Evidence-ledger wiring slice

This is the canonical way to turn a “design” spec into verified behavior without guessing.

### Goal

Wire one concrete event source into the unified evidence ledger with stable correlation IDs, using Tier‑0-first TDD.

Recommended spec targets:
- `docs/LiBrainian/specs/core/evidence-ledger.md`
- `docs/LiBrainian/specs/layer2-infrastructure.md`

### Step 0: Define the observable behavior (before coding)

Pick one event source (examples):
- Provider gate “check/require” events
- MCP tool calls
- Query pipeline stage start/end events
- Technique execution operator events

Write behavior statements in one place (either in the spec file or its `BEHAVIOR_INDEX` entry) using the profile vocabulary:
- Under D3 (providers unavailable): the system must still log the outage event and surface `unverified_by_trace(provider_unavailable)` in outputs.
- Under S1 (storage locked/busy): ledger append must retry in a bounded way or fail closed with explicit disclosure (no silent drops).
- Under W3 (multi-agent): events must carry a stable `sessionId`/correlation ID so interleaving is not ambiguous.

### Step 1: Add a Tier‑0 test for the behavior (deterministic)

Create a new Tier‑0 test that:
- constructs the subsystem with a stub/in-memory `IEvidenceLedger`
- triggers the event source deterministically
- asserts that:
  - an entry is appended
  - `kind` is correct (e.g., `tool_call`)
  - `sessionId` (or correlation ID) is present and stable
  - the payload includes enough metadata to debug (duration/result digest/params digest where relevant)

Constraints:
- No provider calls in Tier‑0 tests.
- No stubbing “semantic success” (adapter stubs allowed only for wiring/format assertions).

### Step 2: Implement the smallest wiring seam (single entrypoint)

Implementation rules:
- Add wiring at the actual public entrypoint (not a helper called only by tests).
- Ensure there is only one path to emit the event (avoid “dual logging” drift).
- If you introduce a new correlation ID shape, define it once and thread it through callsites rather than generating per-subsystem IDs.

### Step 3: Add tiered behavior for providers (Tier‑1/2)

If the behavior is provider-dependent:
- Tier‑1 test: use real providers when available; otherwise `ctx.skip(...)` with an `unverified_by_trace(provider_unavailable)` explanation.
- Tier‑2 test: `requireProviders(...)` and fail honestly if missing.

### Step 4: Add a gate or audit artifact (when it matters)

If the behavior is a “system invariant” (e.g., “ledger correlation IDs exist across subsystems”):
- Add a gate task in `docs/LiBrainian/GATES.json` pointing to a runnable command.
- Do not mark `pass|partial|skip_when_unavailable` without `lastRun` and a human-readable `evidence` string.

### Step 5: Update spec bookkeeping honestly

- Update `docs/LiBrainian/specs/BEHAVIOR_INDEX.md`:
  - If the spec is `executable`, include `Verification:` that points to the test/gate you added.
- Update `docs/LiBrainian/specs/IMPLEMENTATION_STATUS.md` (if this moves something from missing → partial → verified).

### Step 6: Validate deterministically

Run:
- `npm run test:tier0`

If Tier‑0 is green, only then proceed to Tier‑1/Tier‑2 runs (if applicable).

---

## Worked example (recommended): Adding a new spec file

1. Copy `docs/LiBrainian/specs/SPEC_TEMPLATE.md` to the new spec path.
2. Fill in the behavioral contract first (profiles + edge cases + degradation policy).
3. Add the new file to `docs/LiBrainian/specs/BEHAVIOR_INDEX.md` (required), including `Verification:` if `executable`.
4. Add/adjust Tier‑0 tests and gates so the behavior is not “paper only”.
5. Validate: `npm run test:tier0`.
