# Behavior Index (Spec System)

> **Status**: Canonical index
> **Created**: 2026-01-25
>
> **Goal**: Ensure the spec system describes **behavior under real conditions** (scenarios, edge cases, loads, repo types, dependency outages) — not only technical interfaces.
>
> **How to use**:
> 1. Pick the spec file you’re implementing.
> 2. Read its entry here first (behavioral contract + operational profiles).
> 3. Only then read the technical details in the spec file.
>
> **Profiles**: `docs/LiBrainian/specs/core/operational-profiles.md`
>
> **Non-theater rule**: If a spec is marked `executable`, this index must point to at least one runnable verification hook.

---

## Status Legend

- **executable**: behavior is intended to run in production; must be evidence-gated.
- **design**: intended behavior is specified but not fully wired/verified.
- **research_only**: reference material; MUST NOT be treated as implemented behavior.

## Entry Requirements (Non-Negotiable)

Every spec file under `docs/LiBrainian/specs/**` MUST have exactly one explicit entry in this index (a `###` heading with the file path), **except this file** (`docs/LiBrainian/specs/BEHAVIOR_INDEX.md`) which is the index itself.

Every entry MUST include:
- `Status: ...`
- `Used for: ...` (how it is used by implementers/agents)
- `Behavior: ...` (what it does under conditions, or “reference-only”)

If `Status:` is `executable`, the entry MUST also include:
- `Verification: ...` (at least one runnable hook: Tier‑0 test, Tier‑1 skip test, Tier‑2 system test, gate task, or audit artifact generator)

---

## Core Specs

### `docs/LiBrainian/specs/core/operational-profiles.md`
- Status: executable (spec meta)
- Used for: shared scenario taxonomy across the whole spec system.
- Behavior: defines repo/workload/dependency profiles + universal edge-case taxonomy.
- Verification: `src/LiBrainian/__tests__/librarian_spec_behavior_index.test.ts` (index completeness).

### `docs/LiBrainian/specs/core/performance-budgets.md`
- Status: design (targets)
- Used for: explicit latency/resource budgets by operational profile; prevents “performance implied” theater.
- Behavior (profiles): R0–R4; W0–W3; D0–D3; S0–S2.
- Edge cases: E2 oversized inputs must be budgeted; E7 timeouts must disclose partial results; E8 contention must be bounded/retriable.
- Verification: (design; becomes executable once Tier‑2 performance audit artifacts + gates exist).

### `docs/LiBrainian/specs/core/testing-architecture.md`
- Status: executable
- Used for: tier policy (Tier‑0 deterministic, Tier‑1 provider-optional skip, Tier‑2 provider-required).
- Behavior (profiles): D0–D3; W0–W3.
- Edge cases: “skip theater” forbidden; Tier‑2 must fail fast with `unverified_by_trace(provider_unavailable)`.
- Verification: `docs/LiBrainian/GATES.json` Tier‑0/1/2 tasks; package tests under `packages/LiBrainian`.

### `docs/LiBrainian/specs/core/evidence-ledger.md`
- Status: design (wiring incomplete)
- Used for: recording claim-affecting events across query/tool/provider execution.
- Behavior (profiles): W0/W1/W3; S0–S2; D0–D3.
- Edge cases: E7 provider outage evidence must still be appended; E8 storage contention must retry/backoff or fail closed; E6 stale evidence must be labeled.
- Key behaviors:
  - Append-only: never mutate/delete; batch append preferred under load.
  - Storage contention (S1): bounded retry/backoff OR fail closed with explicit disclosure (no silent drops).
  - Provider outage (D3): still logs the outage event; downstream stages must surface `provider_unavailable`.
- Verification: `packages/LiBrainian/src/epistemics/__tests__/evidence_ledger.test.ts` and `src/LiBrainian/__tests__/librarian_spec_drift_guards.test.ts`.

### `docs/LiBrainian/specs/core/confidence-boundary.md`
- Status: design (migration incomplete)
- Used for: separating epistemic confidence (`ConfidenceValue`) from heuristic scores.
- Behavior (profiles): W0; E5/E6; D0–D3.
- Edge cases: E5 conflicting evidence becomes defeaters (not “averaged away”); E6 stale evidence triggers disclosure/decay; E7 provider outages must not invent confidence.
- Key behaviors:
  - Any **claim** confidence must be `ConfidenceValue`; heuristic ranking must not masquerade as confidence.
  - When calibration is absent: return `absent('uncalibrated')` and disclose uncertainty (no invented numbers).
- Verification: `packages/LiBrainian/src/epistemics/__tests__/confidence.test.ts` and Track D specs.

### `docs/LiBrainian/specs/core/primitive-contracts.md`
- Status: design
- Used for: verifiable pre/postconditions for technique primitives.
- Behavior (profiles): W0/W1; D0–D3.
- Edge cases: E7 provider outages must be tiered (Tier‑1 skip, Tier‑2 fail closed); E1 empty/malformed inputs must fail with contract violations.
- Key behaviors:
  - Preconditions gate execution; postconditions must be validated or surfaced as contract violations.
  - Provider-unavailable semantic checks must be tiered: Tier‑1 skip, Tier‑2 fail closed.
- Verification: technique contract bridge tests under `packages/LiBrainian/src/api/__tests__/technique_contract_bridge.test.ts`.

### `docs/LiBrainian/specs/core/work-objects.md`
- Status: executable
- Used for: defining the canonical “work objects” that compile knowledge into replayable execution (tasks/events/snapshots/context artifacts).
- Behavior (profiles): W0–W3; S0–S2; D0–D3.
- Edge cases: E7 provider outages must block provider-required DoD checks; E8 contention must not drop events; E6 stale evidence must be disclosed in task context.
- Key behaviors:
  - Append-only event stream is truth; snapshots are derived.
  - Plan mutations are explicit events with evidence refs (no silent plan drift).
  - DoD obligations gate “done”; Tier‑2-only provider checks must not appear in Tier‑0.
- Verification: `src/workgraph/__tests__/workgraph_runner.test.ts` and `src/workgraph/__tests__/workgraph_replay_pack.test.ts`.

### `docs/LiBrainian/specs/core/knowledge-construction.md`
- Status: design
- Used for: the construction compiler and knowledge-object model that turns “anything an agent wants to know” into durable maps/claims/packs per project and per agent session.
- Behavior (profiles): R0–R4; W0–W3; D0–D3; S0–S2.
- Edge cases: E4 partial corpora, E6 stale evidence, E7 provider outage, E8 contention must all produce explicit disclosures (no silent degradation).
- Key behaviors:
  - Answers are produced via a recorded `ConstructionPlan` + adequacy report (coverage/freshness/semantic status).
  - Repo-scale context is served via `Maps` (includes token-budgeted `RepoMap`/`SymbolMap` packs).
  - Incremental refresh (W2/W3) invalidates dependent objects deterministically; stale reuse is disclosed.
  - Appendix A contains an explicit “100 things” list; UC‑261…UC‑310 are specified in the UC matrix and covered via construction templates (no bespoke handlers).
- Verification: (design; becomes executable once the registry completeness test + Tier‑2 construction suites are implemented).

### `docs/LiBrainian/specs/core/construction-templates.md`
- Status: design
- Used for: the UC→template registry contract that prevents bespoke handler creep.
- Behavior (profiles): W0–W3; D0–D3; S0–S2.
- Edge cases: E4 partial corpora, E7 provider outage, E8 contention must surface as adequacy/disclosures; templates must never “omit unknowns”.
- Key behaviors:
  - Every UC must map to ≥1 template; template selection must be recorded in plan/trace.
  - Templates share a required output envelope (packs + adequacy + verification plan + disclosures).
- Verification: (design; becomes executable once the deterministic UC→template mapping test exists).

### `docs/LiBrainian/specs/core/foundations.md`
- Status: design (extraction scaffold)
- Used for: foundational interfaces shared across tracks (Parts I–V extraction landing zone).
- Behavior: until extracted, any dependency on these foundations must disclose `unverified_by_trace(extraction_missing)`.
- Verification: `docs/LiBrainian/specs/EXTRACTION_GAP_REPORT.md` and `docs/LiBrainian/specs/EXTRACTION_INDEX.md`.

### `docs/LiBrainian/specs/core/agent-coordination.md`
- Status: design
- Used for: multi-agent coordination semantics; conflict resolution; shared evidence.
- Behavior (profiles): W3; S1; E8.
- Edge cases: E8 storage contention and concurrent writes must not corrupt ledger; E5 conflicting writes must be surfaced (no silent overwrite).
- Key behaviors:
  - Multi-agent writes must be correlated (session/correlation IDs).
  - Conflicts must be surfaced as defeaters or explicit “needs review” items (no silent overwrite).
- Verification: (design; implemented behavior must add Tier‑0 correlation tests once wired).

---

## Infrastructure / Meta Specs

### `docs/LiBrainian/specs/README.md`
- Status: executable (process spec)
- Used for: how to implement the spec system correctly (reading order, tiering, non-negotiables).
- Behavior: defines the implementation workflow so implementers/agents do not “fill in the gaps” ad-hoc.
- Verification: `src/LiBrainian/__tests__/librarian_spec_behavior_index.test.ts`.

### `docs/LiBrainian/specs/SPEC_TEMPLATE.md`
- Status: executable (process template)
- Used for: authoring new spec files with a behavior-first, evidence-gated structure.
- Behavior: provides a copy/paste skeleton so new specs include operational profiles, edge cases, and verification hooks.
- Verification: `src/LiBrainian/__tests__/librarian_spec_behavior_index.test.ts`.

### `docs/LiBrainian/specs/layer2-infrastructure.md`
- Status: design (foundation; partially implemented)
- Used for: the “trustworthy base” (LLM adapter, evidence ledger, capability negotiation, MCP adapter).
- Behavior (profiles): D0–D3; S0–S2; W0–W3; R0–R4.
- Edge cases: E7 provider outages must fail closed with explicit reasons; E8 storage contention must be bounded/retriable; E4 partial corpora must surface coverage gaps; E1 empty inputs must be rejected or clarified.
- Key behaviors:
  - Capability negotiation must be explicit (required/optional; degraded mode disclosure).
  - Without unified evidence, any “supported” claim must downgrade to `unverified_by_trace(replay_unavailable)`.
- Verification: Layer‑2 related tasks in `docs/LiBrainian/GATES.json` + Tier‑0 drift/theater guards.

### `docs/LiBrainian/specs/INTEGRATION_CHANGE_LIST.md`
- Status: executable (process spec)
- Used for: concrete integration steps; anti-repeat mechanics.
- Behavior: every spec change must map to executable evidence; no theater gates; extraction-first policy is a stop-the-line constraint.
- Verification: Tier‑0 drift/theater tests in `src/LiBrainian/__tests__/`.

### `docs/LiBrainian/specs/IMPLEMENTATION_FAILURE_RCA.md`
- Status: executable (process spec)
- Used for: root-cause + non-repeat mechanics when implementing the spec system.
- Behavior: enumerates failure modes; prescribes mechanical guardrails (tests/gates).
- Verification: referenced guard tests and `docs/LiBrainian/GATES.json` invariants.

### `docs/LiBrainian/specs/IMPLEMENTATION_STATUS.md`
- Status: executable (tracking)
- Used for: “what is verified vs unverified”.
- Behavior: prevents “we think it’s done” claims without runnable evidence.
- Verification: gates + Tier‑0 checks.

### `docs/LiBrainian/specs/COHERENCE_ANALYSIS.md`
- Status: executable (analysis)
- Used for: preventing duplication/drift between specs.
- Behavior: changes must eliminate competing definitions (one canonical definition).
- Verification: `src/LiBrainian/__tests__/librarian_spec_drift_guards.test.ts` and `src/LiBrainian/__tests__/librarian_spec_behavior_index.test.ts`.

### `docs/LiBrainian/specs/GLOSSARY.md`
- Status: executable (terminology)
- Used for: canonical terms; prevents semantic drift in the docs and code.
- Behavior: terms must map to code or clearly marked as design-only.
- Verification: `src/LiBrainian/__tests__/librarian_spec_drift_guards.test.ts` and `src/LiBrainian/__tests__/librarian_spec_behavior_index.test.ts`.

### `docs/LiBrainian/specs/CONFIDENCE_REDESIGN.md`
- Status: design
- Used for: future confidence migration planning.
- Behavior: must not be treated as implemented until gated.

### `docs/LiBrainian/specs/implementation-dependencies.md`
- Status: design
- Used for: dependency ordering constraints.
- Behavior: implementers must obey ordering; skipping prerequisites is a fail-closed error.

### `docs/LiBrainian/specs/EXTRACTION_GAP_REPORT.md`
- Status: executable (honesty ledger)
- Used for: tracking missing extractions; prevents fake “complete” claims.
- Behavior: missing extraction must be surfaced as `unverified_by_trace(extraction_missing)`.
- Verification: `src/LiBrainian/__tests__/librarian_spec_behavior_index.test.ts` (tracked + non-empty expectation).

### `docs/LiBrainian/specs/EXTRACTION_INDEX.md`
- Status: design (inventory; in progress)
- Used for: mapping theory regions → spec artifacts.
- Behavior: no numeric coverage claims without reproducible evidence.

---

## Use-Case Specs (Behavior is Primary)

### `docs/LiBrainian/specs/use-case-targets.md`
- Status: executable (requirements)
- Used for: canonical scenarios; acceptance targets across repo profiles.
- Behavior (profiles): R0–R4; W0/W1; D0–D3; S0–S2.
- Edge cases: E1 empty intent must yield clarification; E4 partial corpora must surface coverage gaps; E7 provider outages must fail closed for semantic claims; E8 storage contention must not drop audits.
- Verification:
  - Tier‑0: `packages/LiBrainian/src/__tests__/use_case_matrix_validation.test.ts` (UC catalog invariants; no “coverage %” theater).
  - Tier‑2: `packages/LiBrainian/src/__tests__/use_case_foundation_30.system.test.ts` (explicit UC‑001…UC‑030 execution).
  - Tier‑2 fixture grounding suite: `packages/LiBrainian/src/__tests__/use_case_suite.system.test.ts` (controlled ground-truth fixture checks).

### `docs/LiBrainian/specs/use-case-capability-matrix.md`
- Status: design
- Used for: mapping use cases → primitives/compositions → capability requirements.
- Behavior: missing capabilities must surface as explicit gaps/degraded mode.

### `docs/LiBrainian/specs/critical-usability.md`
- Status: executable (constraints)
- Used for: critical problems that must be solved (UX, correctness, safety).
- Behavior (profiles): R1–R4; W0–W3; D0–D3; S0–S2.
- Edge cases: E7 provider outages must be disclosed (no “best-effort” hallucinations); E6 stale evidence must be marked; E8 storage contention must not corrupt state.
- Verification: `packages/LiBrainian/src/__tests__/mvp_librarian.system.test.ts` and `docs/LiBrainian/GATES.json` (Critical gates).

### `docs/LiBrainian/specs/subsystem-problems.md`
- Status: executable (failure catalog)
- Used for: enumerating known subsystem problems; links to tracks.
- Behavior (profiles): D0–D3; S0–S2; W0–W3; R0–R4.
- Edge cases: E1–E8 are the canonical problem taxonomy; each problem must state mitigation and disclosure behavior.
- Verification: `src/LiBrainian/__tests__/librarian_spec_behavior_index.test.ts` (must be indexed) and Tier‑0 drift guards under `src/LiBrainian/__tests__/`.

---

## Track Specs (Execution Behavior, Under Conditions)

### `docs/LiBrainian/specs/track-a-core-pipeline.md`
- Status: design (some implemented, some pending)
- Used for: core pipeline (provider discovery, execution, retrieval, templates).
- Behavior (profiles): R1–R4; W0–W3; D0–D3.
- Edge cases: E1 empty intent must yield clarification; E4 partial corpora must produce explicit coverage gaps; E6 stale evidence must be disclosed; E7 provider outages must fail closed (no silent keyword-only “semantic”).
- Key behaviors:
  - Provider discovery must not hang; selection must be capability-driven.
  - Retrieval stages must produce adequacy/coverage reports; sparse candidates trigger explicit fallback stages.
  - Pending features must remain labeled as such (no “silent implemented”).
- Verification: relevant package tests + `docs/LiBrainian/GATES.json` Layer‑2/Tier gates.

### `docs/LiBrainian/specs/track-b-bootstrap.md`
- Status: design
- Used for: bootstrap protocols (certainty → inference; resumable indexing).
- Behavior (profiles): W1/W2; R1–R4; E2/E3/E8.
- Edge cases: E2 oversized files must not block phases; E3 unreadable/binary files must be skipped with disclosure; E8 storage locks must retry/backoff; E7 provider outages must fail closed or skip (tiered).
- Key behaviors:
  - One file cannot block a phase; bounded retries; resumable state.
  - Large repos require budget enforcement; outputs disclose partial coverage.

### `docs/LiBrainian/specs/track-c-fault-tolerance.md`
- Status: design
- Used for: failure handling and recovery behaviors.
- Behavior (profiles): D1–D3; S1–S2; W2/W3.
- Edge cases: E7 provider outages must be classified + surfaced; E8 storage contention/corruption must fail closed with remediation guidance; E6 stale state must be invalidated.
- Key behaviors: fail closed on missing required dependencies; recovery produces evidence/audit artifacts.

### `docs/LiBrainian/specs/track-c-agentic-workflows.md`
- Status: design
- Used for: workflows (review, incidents, refactors) as executable compositions.
- Behavior (profiles): W0/W3; R2–R4.
- Edge cases: E5 contradictions produce defeaters; E6 stale context must be flagged; E7 provider outages must fail closed; E1 empty intent must ask clarifying questions.
- Key behaviors: workflows must be reproducible and evidence-linked; partial results must carry defeaters.

### `docs/LiBrainian/specs/track-c-causal-reasoning.md`
- Status: research_only (until wired)
- Used for: causal reasoning concepts; not runtime-critical until implemented.
- Behavior: must not be invoked as “implemented capability”; any use must be labeled `unverified_by_trace(research_only)`.

### `docs/LiBrainian/specs/track-c-extended.md`
- Status: research_only
- Used for: extended ideas beyond current execution path.
- Behavior: reference-only; do not ship claims based on it.

### `docs/LiBrainian/specs/track-c-hierarchical-knowledge.md`
- Status: design
- Used for: hierarchical memory/knowledge structures.
- Behavior (profiles): R3/R4; W0/W1; E6.
- Edge cases: E6 stale knowledge must decay/refresh; E8 concurrent writes must not corrupt indexes.

### `docs/LiBrainian/specs/track-d-quantification.md`
- Status: design
- Used for: quantification + confidence semantics.
- Behavior: prohibits fake confidence; defines calibration/degradation semantics.

### `docs/LiBrainian/specs/track-d-polyglot-contracts.md`
- Status: design
- Used for: polyglot parsing/contracting.
- Behavior (profiles): R2/R3; E4; language gaps must be explicit.
- Edge cases: E4 partial corpora must surface language-level coverage; E3 binary/unreadable files must be handled without crashing; E2 oversized files must be budgeted.

### `docs/LiBrainian/specs/track-e-domain.md`
- Status: design
- Used for: domain knowledge construction and use.
- Behavior: domain claims must trace to evidence; domain gaps must be explicit.

### `docs/LiBrainian/specs/track-f-calibration.md`
- Status: design
- Used for: calibration loop.
- Behavior: calibration claims must be outcome-backed; otherwise `absent('insufficient_data')`.

### `docs/LiBrainian/specs/track-f-epistemology.md`
- Status: design
- Used for: epistemic policies/defeaters.
- Behavior: contradictions produce defeaters; stale knowledge decays and is disclosed.

### `docs/LiBrainian/specs/track-g-debugging.md`
- Status: design
- Used for: debugging workflows.
- Behavior: incident/debug runs must produce replayable evidence chains (or disclose replay unavailable).

### `docs/LiBrainian/specs/track-g-retrieval-uncertainty.md`
- Status: design
- Used for: uncertainty-aware retrieval behaviors.
- Behavior: low adequacy triggers explicit “missing evidence” guidance.

### `docs/LiBrainian/specs/track-h-incidents.md`
- Status: design
- Used for: incident response workflows.
- Behavior (profiles): W0; D3; S1; must degrade honestly under outages.
- Edge cases: E7 provider outages must switch to “triage mode” with explicit unverified markers; E8 storage contention must not drop audit evidence; E5 conflicting signals must be surfaced as hypotheses/defeaters.

### `docs/LiBrainian/specs/track-h-review.md`
- Status: design
- Used for: code review workflows.
- Behavior: review outputs must include evidence refs; uncertainty/disagreements must be explicit.

### `docs/LiBrainian/specs/track-i-multi-repo.md`
- Status: design
- Used for: multi-repo correlation.
- Behavior (profiles): R4; E6; cross-repo staleness must be explicit.
- Edge cases: E6 staleness across repos becomes explicit defeaters; E4 missing repos/partial corpora must surface gaps; E8 concurrent indexing must be serialized or conflict-resolved.

### `docs/LiBrainian/specs/track-j-dynamics.md`
- Status: research_only (until wired)
- Used for: dynamics and integration metrics ideas.
- Behavior: reference-only; do not treat as implemented.

### `docs/LiBrainian/specs/track-k-business-knowledge.md`
- Status: design
- Used for: business/domain evidence integration.
- Behavior: business claims must reference evidence; gaps must be explicit.

### `docs/LiBrainian/specs/track-a-tiered-language-support.md`
- Status: design
- Used for: language support stratification.
- Behavior: missing tiers become explicit coverage gaps; do not silently treat “unsupported” as “empty”.

---

## Technique Specs

### `docs/LiBrainian/specs/technique-contracts.md`
- Status: design
- Used for: turning primitives from prose into executable contracts.
- Behavior (profiles): W0/W1; D0–D3.
- Edge cases: E1 empty/malformed inputs must fail with contract violations; E7 provider outages must be tiered; E5 contradictory postconditions must surface as defeaters.
- Key behaviors:
  - Semantic postconditions are forbidden in Tier‑0 and must be tiered.
  - Contract verification must produce evidence ledger entries (or explicit unverified disclosure).

### `docs/LiBrainian/specs/self-improvement-primitives.md`
- Status: design
- Used for: self-improvement primitives.
- Behavior: improvement claims must be outcome-backed; otherwise `unverified_by_trace(improvement_unverified)`.

---

## Research Frontiers (Reference Only)

### `docs/LiBrainian/specs/frontiers/active-learning.md`
- Status: research_only
- Used for: reference material; future exploration only.
- Behavior: reference-only.

### `docs/LiBrainian/specs/frontiers/formal-methods.md`
- Status: research_only
- Used for: reference material; future exploration only.
- Behavior: reference-only.

### `docs/LiBrainian/specs/frontiers/game-theory.md`
- Status: research_only
- Used for: reference material; future exploration only.
- Behavior: reference-only.

### `docs/LiBrainian/specs/frontiers/information-theory.md`
- Status: research_only
- Used for: reference material; future exploration only.
- Behavior: reference-only.

### `docs/LiBrainian/specs/frontiers/neurosymbolic.md`
- Status: research_only
- Used for: reference material; future exploration only.
- Behavior: reference-only.

### `docs/LiBrainian/specs/frontiers/probabilistic.md`
- Status: research_only
- Used for: reference material; future exploration only.
- Behavior: reference-only.

---

## Breakthrough Notes (Reference Only Until Implemented)

### `docs/LiBrainian/specs/breakthroughs/causal-retrieval.md`
- Status: research_only
- Used for: reference material; future exploration only.
- Behavior: reference-only.

### `docs/LiBrainian/specs/breakthroughs/constructive-proofs.md`
- Status: research_only
- Used for: reference material; future exploration only.
- Behavior: reference-only.

### `docs/LiBrainian/specs/breakthroughs/decision-confidence.md`
- Status: research_only
- Used for: reference material; future exploration only.
- Behavior: reference-only.

### `docs/LiBrainian/specs/breakthroughs/do-calculus.md`
- Status: research_only
- Used for: reference material; future exploration only.
- Behavior: reference-only.

---

## Evaluation & Quality Infrastructure

### `docs/LiBrainian/specs/track-eval-infrastructure.md`
- Status: design (infrastructure not built)
- Used for: measuring and verifying LiBrainian quality against ground truth; enables improvement.
- Behavior (profiles): All profiles; quality must be measured across R0–R4, W0–W3, codebase types.
- Edge cases: E1 empty corpus must fail explicitly; E4 missing annotations must be disclosed; adversarial repos must stress-test hallucination detection.
- Key behaviors:
  - **Ground truth corpus**: Annotated repos with known-correct query/answer pairs.
  - **Evaluation harness**: Automated quality measurement (retrieval recall/precision, hallucination rate, synthesis accuracy).
  - **Outcome collection**: Claim→outcome tracking for calibration data.
  - **Quality parity**: Adaptive strategies to reduce quality variance across codebase types.
- Verification: `src/eval/__tests__/` test suite (when built); nightly eval CI job; quality gates in GATES.json.
- Research sources: SWE-bench, MiniCheck, Ragas, DependEval (see spec for full citations).

### `docs/LiBrainian/specs/track-research-hard-problems.md`
- Status: research (not engineering)
- Used for: addressing genuinely hard problems that require research investment.
- Behavior (profiles): Variable; these are experimental.
- Key behaviors:
  - **H1 Semantic verification**: Test-based verification for pure functions; entailment checking; citation validation.
  - **H2 Cross-file reasoning**: Hierarchical summarization; iterative retrieval with convergence; graph-based retrieval.
  - **H3 Adversarial robustness**: Comment/code disagreement detection; dead code filtering; red flag detection.
  - **H4 Consistency checking**: Multi-query consistency; temporal consistency; cross-reference validation.
- Verification: Research experiments; ablation studies; A/B tests against baseline.
- Honest assessment: Some items achievable (dead code, red flags), some require applied research (entailment), some are long-term (temporal consistency).
- Research sources: MiniCheck, LLM-Cite, GraphCoder, ReDeEP (see spec for full citations).
