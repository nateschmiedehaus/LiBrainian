# LiBrainian Roadmap — “Butter-Smooth” World-Class Knowledge, Cognition, Organization

Status: active (living plan)
Scope: end-to-end path from “works sometimes” → “works everywhere, smoothly” with evidence gates
Last Updated: 2026-02-06
Owner: librarianship

---

See: `docs/LiBrainian/TOP10_COMPLETION.md` for the current “final 10” evidence-gated execution plan.

## 0) What “Fully Functioning” Means (Non-Negotiable)

“Fully functioning” is **operational**, not aspirational:

1) **On any repo** (R0–R4), LiBrainian can be “plugged in” and will either:
   - reach a **usable ready state** automatically, or
   - fail closed with an explicit `unverified_by_trace(...)` reason **and** an actionable recovery path.

2) **No constant errors**:
   - No repeated bootstrap loops that burn quota.
   - No “0 files indexed” state if parseable files exist.
   - No “unhealthy” signal for normal non-watch usage (health must be truthful, not punitive).

3) **Provider reality is first-class** (D0–D3):
   - D2 (Embeddings available, LLM unavailable): retrieval + deterministic structure must still work; semantic synthesis/claims must fail closed with disclosure.
   - Quota/rate/timeouts are treated as **provider unavailable**, not “mysteriously broken”.

4) **Output envelope invariant**:
   Every query returns at least:
   - `packs[]`
   - `disclosures[]`
   - `verificationPlan`
   - `adequacy` (or explicit `unverified_by_trace(adequacy_unavailable)`)

5) **No silent degradation**:
   Degraded-mode behavior is allowed only if it is **explicitly disclosed** and does not produce “understanding theater”.

Canonical profile taxonomy: `docs/LiBrainian/specs/core/operational-profiles.md`.

---

## 1) Root Cause Class (Why “LLM Must Not Be A Hard Requirement”)

LLMs are useful for *semantic synthesis* and optional enrichment, but **semantic indexing must not be coupled to LLM availability**:

- “Semantic retrieval” can be powered by embeddings + structural signals.
- LLM unavailability must not prevent:
  - structural scan,
  - AST extraction,
  - embeddings generation (when an embedding provider exists),
  - context packs generation (deterministic templates),
  - graph mapping.

LLM enrichment should be:
- separately budgeted,
- resumable,
- optional by profile (D2),
- and *never* capable of driving the system into an inconsistent “indexed 0 files” state.

---

## 2) Failure-Mode Kill List (Priority 0, Evidence-Gated)

The “butter” experience is achieved by systematically eliminating the most common breakages:

1) **LLM quota/rate-limit causes indexing to produce 0 files**
   - Fix: decouple per-file LLM analysis from AST indexing; make analysis best-effort and disclosed.
   - Evidence: Tier‑0 test that forces `llm_execution_failed` and still indexes files + embeddings.

2) **`doctor --heal` makes things worse**
   - Fix: `doctor --heal` must prefer fast/recoverable modes and must never require LLM by default.
   - Evidence: Tier‑0 test on fresh workspace where LLM is “unavailable” still results in a usable index.

3) **Health is “UNHEALTHY” just because watch isn’t running**
   - Fix: separate “stale vs broken”; provide explicit freshness state + recommended action without failing the whole health contract.
   - Evidence: Tier‑0 test for “healthy-but-stale” classification.

4) **Bootstrap resumability gaps**
   - Fix: every expensive loop has “skip unchanged” + checkpoints.
   - Evidence: two consecutive bootstraps on same commit show near-zero delta and near-zero provider work.

5) **Workspace root mismatch / include patterns match 0 files**
   - Fix: detect likely root; surface include/exclude diagnostics; recovery plan can override patterns automatically.
   - Evidence: validation gate tests already exist; add end-to-end CLI “query on subdir” test.

6) **DB lock / WAL/SHM stale**
   - Fix: storage recovery as the default path before failing.
   - Evidence: Tier‑0 tests for stale locks + recovery (exists); add CLI-path coverage.

7) **Language gaps**
   - Fix: explicit coverage gaps + onboarding events; optional tree-sitter adapters.
   - Evidence: Tier‑0 “language gap ledger” test + doc of extension points.

8) **“Reality vs docs” drift (STATUS/GATES lie without evidence)**
   - Fix: make `npm run evidence:manifest` + `npm run evidence:reconcile` part of the release gate; ensure CLI `status/health/doctor` only report what can be backed by stored artifacts.
   - Evidence: Tier‑0 evidence manifest tests + CI gate that fails if autogen block is stale.

---

## 3) Roadmap v0 (Comprehensive, Not Yet Optimized)

### Stage A — Reliability + Onboarding (Make it Work Everywhere)
- One “golden path” entrypoint used by **API + CLI**:
  - `initializeLibrarian()` / `ensureLibrarianReady()`
  - `LiBrainian query/status/doctor/bootstrap/watch`
- Self-healing:
  - storage recovery
  - watcher recovery
  - bootstrap recovery (include/exclude repair; resume; retry budget)
- Deterministic fallback synthesis when LLM is optional/unavailable.
- Provider gating:
  - quota/rate/timeouts classified as `provider_unavailable`
  - multi-provider fallback policy (optional)

### Stage B — Universal Indexing (Make it Work On Any Repo)
- Language adapters: TS/JS first, then tree-sitter for polyglot coverage.
- Repo-profile-aware discovery defaults (monorepos, vendored dirs, generated outputs).
- Incremental watch for W2 with truthy freshness reporting.

### Stage C — Constructables + Templates (Exponential Dynamic Potential)
- Treat templates as **programs** with:
  - declared inputs/outputs
  - provider requirements
  - failure semantics
  - evidence obligations
- Constructables become:
  - composable modules that emit packs/claims/plans
  - selectable via UC→template mapping + observed repo signals
- Plugin surface:
  - add language adapter
  - add template
  - add constructable
  - add provider backend

### Stage D — Verification, Evaluation, and Scientific Loop (World-Class, Proved)
- Phase 8: machine-verifiable ground truth on **real external repos**
- Phase 9: control vs treatment agent experiments (WITH LiBrainian vs WITHOUT)
- Phase 10: DETECT → HYPOTHESIZE → TEST → FIX → VERIFY → EVOLVE loop (RLVR-style binary reward)

### Stage E — LLM Cognition + Graph-First Reasoning (World-Class, Measurable)
Goal: make higher‑order cognition first‑class while keeping structural reliability and explicit disclosures.

Deliverables:
- **GraphRAG‑style routing**: summarize communities and route queries to relevant subgraphs before expanding.
- **RAPTOR‑style hierarchical summary tree**: file → module → package summaries for coarse‑to‑fine retrieval.
- **Graph‑conditioned retrieval**: fuse semantic similarity with call/import/dependency proximity (rank fusion).
- **Code‑domain rerankers**: add optional code‑specific cross‑encoder and A/B hooks.
- **Memory‑graph cognition (HippoRAG‑style)**: maintain entity‑centric memory edges to stabilize long‑horizon reasoning.
- **LLM structured‑output validation**: schema/tool validation + provenance on any semantic synthesis.

Evidence gates:
- Tier‑0 deterministic routing tests for community selection + graph fusion ordering.
- Tier‑2 answer‑quality evaluation across **CodeRepoQA + SWE‑bench Live** with explicit pass/fail thresholds.
- No regressions on existing IR metrics (Recall@K, nDCG, MRR).

---

## 4) Critique of v0 (Why It Would Fail If Executed Naively)

1) **Too broad without a stop-the-line reliability gate**.
   - Without a strict failure-mode kill list, “universal + world-class” becomes a perpetual refactor with no user-visible stability wins.

2) **Conflates “full quality” with “LLM everywhere”**.
   - Best-in-world systems separate deterministic indexing from optional synthesis/enrichment to avoid provider brittleness.

3) **Missing explicit acceptance tests per operational profile**.
   - “Works on any repo” must be measured against R0–R4, W0–W3, D0–D3, S0–S2, E1–E8.

4) **Doesn’t force UX truthfulness**.
   - A system can pass unit tests while still being unusable because the CLI path mis-handles degraded modes.

5) **Evaluation can become circular** if Phase 8 isn’t strictly machine-verifiable and repo-real.

---

## 5) Final Roadmap (Optimized, Evidence-First, Execution-Ready)

### Step 0 — Full-System Inventory (No Blind Spots)
Goal: every major subsystem is accounted for, and “kept vs cut vs refactor” decisions are explicit.

Deliverables:
- A generated module map covering:
  - CLI (`src/cli/**`)
  - API/query/bootstrap (`src/api/**`)
  - agents/indexing (`src/agents/**`)
  - storage (`src/storage/**`)
  - knowledge + templates (`src/knowledge/**`, `src/constructions/**`)
  - orchestrator/integration (`src/orchestrator/**`, `src/integration/**`)
  - specs/gates/status (`docs/LiBrainian/**`)
- A “dead code / duplicate pipeline” list (merge or delete), starting with onboarding/bootstrapping duplication.

Evidence gates:
- Tier‑0 “module map is complete” test (guards against silent subsystem drift).

### Step 1 — “Butter Onboarding” Contract (Ship This First)
Goal: any repo can run `LiBrainian query "…"`, and it will **not** collapse into fatal bootstrap states.

Deliverables:
- Decouple per-file LLM analysis from semantic indexing:
  - indexing must succeed in D2 without LLM
  - LLM analysis failures become disclosed partial indexing, not fatal
- `doctor --heal`:
  - defaults to **fast + recoverable** mode
  - only attempts full LLM enrichment when explicitly requested or when provider is verified usable
- Deterministic synthesis fallback:
  - if LLM optional and unavailable, emit a structured “pack digest” answer (no narrative claims)
- Truthy operator view:
  - regenerate evidence manifest + reconcile (`npm run evidence:manifest && npm run evidence:reconcile`)
  - tighten `health` semantics: “stale vs broken” and ensure exit codes match intent (CI vs human use)
- CLI/API unification:
  - CLI commands call the same recovery + readiness path as the programmatic API

Evidence gates:
- Tier‑0 failure-matrix tests for:
  - `llm_execution_failed` during indexing does not yield “0 files indexed”
  - `doctor --heal` on fresh workspace without LLM produces a usable index
  - `query` returns envelope even when synthesis fails

### Step 2 — Universality Baseline (R0–R2 First, Then R3/R4)
Deliverables:
- Language coverage + explicit gaps
- Workspace-root detection + pattern auto-repair
- Storage contention handling under W2/W3
- Performance budgets become enforced:
  - fix the failing “memory per 1K LOC” gate (streaming, batching, and model lifecycle control)

Evidence gates:
- Tier‑0 “repo fixtures” for R0/R1/R2
- Tier‑1 skip tests for provider-dependent paths
- Tier‑2 scenario family stubs for R3/R4

### Step 3 — Constructables/Templates as a Real “Programming System”
Deliverables:
- Template interface upgraded to include:
  - provider requirements
  - budget declarations
  - artifacts produced (packs/claims/tasks)
  - verification obligations
- Constructable registry gains:
  - dependency graph
  - compatibility constraints by repo profile
  - versioned schemas

Evidence gates:
- Tier‑0 registry completeness + “≤12 templates” guard
- Tier‑0 determinism tests for template compilation (no provider)

### Step 4 — Phase 8/9/10 (Prove “World’s Best” With Hard Evidence)
Deliverables:
- Phase 8: real repos + AST fact extractor + ground truth + citation verifier + consistency checker
- Phase 9: control/treatment agent eval harness and statistical reporting
- Phase 10: scientific self-improvement loop that only rewards verified fixes

Evidence gates:
- Reproducible eval runs with stored artifacts under `eval-results/` and `state/audits/`

---

## 6) Execution Rule

Do not advance stages until:
- Tier‑0 is green: `npm test -- --run`
- Types are green: `npx tsc --noEmit`
- The new stage’s gates exist (even if Tier‑2 is provider-gated)
