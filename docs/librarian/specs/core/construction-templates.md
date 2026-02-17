# Construction Templates (UC→Program Registry)

Status: design (registry + contracts; implementation pending)
Created: 2026-01-25
Scope: the *elegance mechanism* that prevents “one-off handler creep” by mapping use cases to a small set of reusable construction programs.

This spec exists to make the system implementable “like the best engineers would”: by building a small kernel + a small number of reusable programs, rather than accreting bespoke endpoints for every new use case.

Canonical conceptual parent:
- `docs/LiBrainian/specs/core/knowledge-construction.md`

---

## 0) Non-negotiable goal

The LiBrainian spec system must support UC coverage **without awkwardness** for an agent:
- An agent supplies an intent (plus optional hints).
- LiBrainian compiles it into a `ConstructionPlan` using templates.
- LiBrainian returns packs + adequacy + verification plan + disclosures.

No “micro-API stitching” requirement is allowed for normal work.

---

## 1) Definitions

### Construction template

A **construction template** is a named, reusable “program skeleton” that:
- declares the required knowledge objects (`RepoFacts` / `Maps` / `Claims` / `Packs` / `Episodes`),
- declares required/optional adapters and capabilities,
- declares adequacy requirements (coverage/freshness/semanticStatus),
- and declares how to produce agent-consumable outputs under W0/W1/W2/W3 and D0–D3/S0–S2.

### UC mapping rule (core elegance constraint)

Every UC MUST be satisfiable by one or more construction templates.

This prevents “UC = new bespoke endpoint” and forces implementers to evolve shared mechanisms instead.

---

## 2) Registry contract (required in implementation)

Implementation MUST provide a single registry (one entrypoint) for templates, conceptually:

- `getConstructionTemplate(templateId)`
- `templatesForUc(ucId)`
- `templatesForIntent(intent, hints)`

Mechanical constraints (anti-repeat mechanics):
- One registry only (no parallel “template maps” in multiple subsystems).
- Template selection must be observable via evidence (record `templateId` in plan/trace).
- Adding a UC is normally a mapping change, not a new pipeline.

---

## 3) Required IO envelope (v1)

All templates MUST produce the same outer envelope so agents can rely on it:

### Inputs (minimum)
- `intent: string`
- optional: `workspace`, `affectedFiles`, `depth`, `tokenBudget`, `timeBudgetMs`, `ucHints[]`

### Outputs (minimum; even on failure)
- `constructionPlan` (recorded + returned summary)
- `packs[]` (may be empty if blocked)
- `adequacy` (coverage/freshness/semanticStatus; never omitted)
- `verificationPlan` (required when proof is missing)
- `disclosures[]` (machine-readable stop reasons, including any `unverified_by_trace(...)`)
- `traceId` (or explicit `unverified_by_trace(replay_unavailable)` if replay not yet wired)

Non-theater rule:
- If any field cannot be provided, the output must disclose why (do not omit silently).

---

## 4) Template lifecycle semantics

### W0 (interactive)
- Must return “first useful output” quickly:
  - either a minimal `RepoMap`/`EditContext` pack,
  - or a hard stop disclosure with remediation.
- If deeper enrichment is pending (W1/W2), return partial results only with explicit `adequacy.partial` disclosure.

### W1 (batch)
- Optimize for completeness and durable artifacts:
  - exports, audit artifacts, migration/verification plans,
  - and stable summary packs suitable for downstream agents.

### W2 (watch)
- Must support incremental refresh:
  - invalidate dependent objects deterministically,
  - include freshness in every output if not current.

### W3 (multi-agent)
- Writes must be safe:
  - serialize or bounded retry on S1,
  - never silently drop evidence/events.

---

## 5) Canonical template set (v1)

This set is intentionally small and reusable. It is expected to cover most UC families by composition.

Each template’s behavior must be specified in terms of:
- required knowledge objects,
- required adapters/capabilities,
- and degradation behavior (fail-closed vs degraded-with-disclosure).

### Template budget + admission criteria (anti-accretion)

Templates are the “program layer”. If templates sprawl, the system becomes unimplementable.

Rules:
- **Budget**: keep the canonical template set at **≤ 12** templates in v1 (currently T1–T12).
- **Admission**: adding a new template is allowed only if:
  - it is expected to cover **≥ 3 UCs** (not “one UC = one template”), or it replaces/merges an existing template,
  - it cannot be expressed as “add a map/pack type” under an existing template without making that template incoherent,
  - and it has explicit W0/W1/W2/W3 behavior + adequacy/disclosure requirements.
- **Default alternative**: if you’re tempted to add a template for a single UC, you should instead:
  - add a new **map/pack type** and map the UC to an existing template,
  - or enrich the UC mapping rules (Section 6) without changing pipelines.

### T1: RepoMap (token-budgeted repo-scale orientation)

Purpose:
- Provide a compact “map” of repo structure + key symbols that fits a specified token budget.

Required objects:
- `RepoFacts(CorpusInventory, Build/Test, Owners)`
- `Maps(RepoMap, SymbolMap, ModuleMap)`
- `Packs(RepoMapPack)`

Behavior:
- R3/R4: must disclose partial corpora and language gaps.
- D3: still produces deterministic map; semantic summaries are blocked.

### T2: DeltaMap (what changed since last run and why it matters)

Required objects:
- `RepoFacts(FreshnessCursor)`
- `Maps(ChangeMap)`
- `Episodes(ChangeEpisode)`
- `Packs(DeltaPack)`

Adapters:
- git adapter required for true deltas; otherwise disclose `unverified_by_trace(external_evidence_unavailable:git)`.

### T3: EditContext (smallest sufficient context for a patch)

Required objects:
- `Maps(CallGraph/ImportGraph/TestMap/OwnerMap)` (as available)
- `Packs(EditContextPack)`

Behavior:
- Must minimize context and explicitly show what was excluded due to budget.

### T4: VerificationPlan (Definition-of-Done + work objects)

Required objects:
- `Maps(ImpactMap, RiskMap, TestMap, OwnerMap)`
- `Packs(VerificationPlanPack)`
- `WorkObjects(DoD obligations)`

Behavior:
- Always returns a verification plan; provider-required checks are marked as Tier‑2 only.

### T5: TestSelection (impacted tests + uncertainty disclosure)

Required objects:
- `Maps(TestMap, DepMap, ImpactMap)`
- `Packs(TestSelectionPack)`

Behavior:
- Must disclose uncertainty when mappings are incomplete.

### T6: ReproAndBisect (repro scripts + minimization + regression localization)

Required objects:
- `WorkObjects(ReproTask, BisectTask)`
- `Episodes(ReproEpisode, BisectEpisode)`
- `Packs(ReproPack, BisectReportPack)`

Behavior:
- If execution tools are unavailable, return a plan + disclosures (no pretend run).

### T7: SupplyChain (SBOM + dependency risk + license/provenance evidence)

Required objects:
- `RepoFacts(Manifests/Locks)`
- `Maps(DepMap, SupplyChainMap, LicenseMap)`
- `Packs(SBOMPack, DependencyRiskPack)`

Behavior:
- If external scanners/adapters are missing, disclose and fall back to manifest-only analysis.

### T8: InfraMap (k8s/IaC/container/build graph to services/owners/risk)

Required objects:
- `Maps(InfraMap, OwnerMap, RiskMap)`
- `Packs(InfraPack)`

Adapters:
- optional adapters (k8s, terraform, dockerfile, bazel/nix). Missing adapters must be disclosed.

### T9: ObservabilityRunbooks (signals→runbooks + instrumentation plans)

Required objects:
- `Maps(ObsMap, RunbookMap)`
- `Packs(ObservabilityPack, InstrumentationPlanPack)`

Behavior:
- If no runbooks exist, disclose and produce “create runbook” verification tasks.

### T10: ComplianceEvidence (controls→evidence packs)

Required objects:
- `Maps(ComplianceMap)`
- `Packs(ComplianceEvidencePack)`

Behavior:
- Must be explicit about missing evidence artifacts; never claim compliance by inference.

### T11: MultiAgentState (conflict-aware merge + explicit conflict objects)

Required objects:
- `WorkObjects(ConflictObjects)`
- `Claims(Conflicts/Defeaters)`

Behavior:
- Conflicts are first-class outputs (not overwritten).

### T12: UncertaintyReduction (next-best question and gap closure)

Required objects:
- `AdequacyReport`, `GapModel`, `Defeaters`
- `Packs(NextQuestionPack)`

Behavior:
- Must not optimize for novelty; optimize for uncertainty reduction with explicit rationale.

---

## 6) UC mapping strategy (v1, spec-system-owned)

The full UC inventory is outside this folder (`docs/LiBrainian/USE_CASE_MATRIX.md`), but the *mapping strategy* is part of the spec system.

### 6.1 Domain → default templates (v1, mechanical)

This mapping is the *mechanical* default so every UC is satisfiable by ≥1 template without bespoke pipelines.

Rule:
- A UC is considered “mappable” if its `Domain` (in `docs/LiBrainian/USE_CASE_MATRIX.md`) appears in this table.
- Templates listed here are **minimum defaults**; additional templates may be selected by intent/hints.

Format is intentionally simple for deterministic validation:
- `<Domain>: T#(, T#)*`

- API: T3
- Agentic: T3, T4, T11
- Architecture: T1
- Behavior: T3, T4
- Build/Test: T4, T5
- Compliance: T10, T4
- Config: T3
- Data: T1, T4
- Documentation: T1
- Edge: T12
- Impact: T2, T4, T5
- Knowledge: T1, T12
- Language: T1
- Multi-Repo: T1, T2
- Navigation: T3
- Orientation: T1
- Ownership: T1, T4
- Performance: T4
- Product: T1, T12
- Project: T1, T12
- Refactor: T3, T4
- Release: T2, T4
- Reliability: T4, T9
- Runtime: T1, T8
- Security: T4, T7
- Synthesis: T12

Rules:
- Default mapping is by UC domain:
  - Orientation/Architecture/Ownership/Navigation: always include `T1 RepoMap` early.
  - Change/Risk/Release/Reliability: `T2 DeltaMap` + `T4 VerificationPlan`.
  - Agentic: `T3 EditContext` + `T4 VerificationPlan` + `T11` as needed.
  - Supply-chain/compliance/infra: `T7`/`T8`/`T10`.
- UC families that require execution (bisect, repro) must compile to work objects; if tools unavailable, return plans + disclosures.

Hard requirement:
- UC additions should normally be expressible as:
  1) add/mutate a knowledge object type, or
  2) add/mutate a template, or
  3) adjust mapping rules,
  not “new bespoke pipeline code”.

---

## 7) Verification hooks (planned)

To make this doc `executable` later:
- Tier‑0: a deterministic test that asserts:
  - every UC has ≥1 template mapping (no holes),
  - every template declares required outputs and adequacy fields,
  - template IDs are unique and versioned.
- Tier‑2: scenario suites that exercise representative templates across repo profiles (R0–R4).

Current deterministic enforcement (Tier‑0):
- Domain → template mapping completeness is validated via:
  - `packages/LiBrainian/src/__tests__/use_case_matrix_validation.test.ts`
