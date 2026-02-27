> **🚨 AGENTS: STOP - READ THIS FIRST 🚨**
>
> **DO NOT use this document for implementation guidance.**
>
> This 23,000-line document is REFERENCE MATERIAL ONLY.
>
> For implementation work, read these files instead:
> - **[AGENT_INSTRUCTIONS.md](./AGENT_INSTRUCTIONS.md)** - Sequential tasks with acceptance criteria
> - **[GATES.json](./GATES.json)** - Machine-readable gate status
>
> This document contains theoretical foundations and detailed specifications.
> Consult it only when AGENT_INSTRUCTIONS.md refers you here for details.
>
> **If gates in GATES.json are red, fix them. Do not implement new features.**

---

# LiBrainian: Theoretical Critique and Solutions

> A rigorous analysis of conceptual, computational, and philosophical errors in the LiBrainian architecture, with direct solutions and their propagating impacts.

---

## Agent Navigation Frame (Reference Only)

> **Note**: This navigation frame is preserved for reference. For implementation, use [AGENT_INSTRUCTIONS.md](./AGENT_INSTRUCTIONS.md).

This document stays single-file to preserve advanced theory and long-range features, but it is structured so an agent can:
1) jump to the exact spec slice needed for the current task,
2) see where it is / where it has been (redundantly),
3) update the doc when it discovers real holes (without guessing).

### [FOCUS] Current Focus (edit this block before/after each work session)

- **Current objective**: P0 call-site audit so runtime entrypoints use provider discovery instead of env-only defaults.
- **Current work item(s)**: CLI watch/index/diagnose now resolve discovery config; LLM purpose extractor auto-selects provider when no explicit model.
- **Last completed checkpoint**: Standalone typecheck green after provider-discovery call-site updates (see Work Log).
- **Next checkpoint**: Re-run `npm run build` and update Gate Snapshot (Tier-0 is now green; see below).
- **Active blockers**: Repo build gate still red (complexity cap; last observed 2026-01-21).
- **Files touched**: `packages/LiBrainian/src/cli/commands/watch.ts`, `packages/LiBrainian/src/cli/commands/index.ts`, `packages/LiBrainian/src/cli/commands/diagnose.ts`, `packages/LiBrainian/src/api/embedding_providers/llm_purpose_extractor.ts`, `docs/LiBrainian/THEORETICAL_CRITIQUE.md`

### [WHERE_AM_I] Where You Are / Where You’ve Been (redundant by design)

- **You are here**: start at `#what-to-implement-next-for-codex` (execution order) or `#part-v-api-and-implementation-review` (audit).
- **If you’re tempted to implement features first**: jump to `#wave0-extraction-gate-must-be-green-first` and make it green. If LiBrainian can’t stand alone, every other feature can become throwaway work.
- **P0 priority (right now)**: complete **E5 Standalone Tests** and refresh Tier-0 evidence so LiBrainian remains portable.
- **Progress trail**: append entries under `#work-log` whenever you change code or update priorities.
- **Known holes**: record mismatches under `#hole-registry` and fix the spec slice immediately if it’s genuinely required.
- **Path note**: unless explicitly stated, file references now point at `packages/LiBrainian/src/**` (the package source); `src/LiBrainian/**` is a compatibility shim.

### [GATES] Gate Snapshot (update when touched; do not guess)

| Gate | Command | Last observed | Status | Notes |
|------|---------|---------------|--------|------|
| Standalone typecheck | `cd packages/LiBrainian && npx tsc --noEmit` | 2026-01-24 | ✅ | Typecheck passes for package boundary. |
| Repo build | `npm run build` | 2026-01-21 | ❌ | Complexity gate: `repo_loc_total 444505 > max 396000` |
| Tier-0 | `npm run test:tier0` | 2026-01-24 | ✅ | Tier-0 deterministic gate passes (rerun after the export fixes + Tier-0 stability changes). |
| Wave0 extraction gate | `rg -n \"src/(wave0|orchestrator)/\" packages/LiBrainian/src || true` | 2026-01-22 | ✅ | No wave0/orchestrator references remain under the package tree. |
| Full extraction (Wave0 migration) | `rg -n \"from '\\.\\./LiBrainian/|from \\\"\\.\\./LiBrainian/\" src --glob '!src/LiBrainian/**' || true` | 2026-01-22 | ✅ | No direct `src/LiBrainian/**` imports outside the shim; package boundary enforced. |

### Wave0 Extraction Gate (must be green first)

This is the single highest-leverage priority, because it makes LiBrainian usable in *any* repo (and forces a clean adapter boundary for providers, tools, and future harnesses).

**Non-negotiable rule**: do not implement new LiBrainian features until this gate is green. If extraction is postponed, you will keep reintroducing wave0 coupling and repeating the same work.

**Definition of “extracted enough to proceed”**
- LiBrainian can be built/tested in isolation as a package (planned home: `packages/LiBrainian/`), without importing wave0-specific modules.
- Provider/tool access happens through explicit adapters (no hidden coupling to a particular runtime layout).
- The public API surface is stable and documented via runnable evidence commands.

**Definition of “fully extracted” (E6; required before claiming LiBrainian is portable)**

Status: completed. Wave0 imports LiBrainian only through the package boundary; `src/LiBrainian/**` is now a compatibility shim.

- Wave0 code imports LiBrainian only through a package boundary (e.g. `LiBrainian`), never via `../LiBrainian/**` or `src/LiBrainian/**` paths.
- There is exactly one source of truth for LiBrainian implementation:
  - either **inside this repo** under `packages/LiBrainian/src/**` (monorepo/workspace transitional strategy),
  - or **outside this repo** as its own repository (preferred end-state).
- The old in-repo tree `src/LiBrainian/**` is either deleted or reduced to a tiny compatibility shim that re-exports from the package (and is slated for deletion).
- Provider and tool access still happens only via adapters; Wave0 wires adapters at startup; LiBrainian remains harness-agnostic.

**Why “move LiBrainian out of Wave0” is correct (theory, adjacent)**

Extraction is not “repo hygiene”; it is an epistemic constraint. If LiBrainian is coupled to Wave0’s runtime layout:
- every “universal” claim becomes non-falsifiable outside Wave0,
- tests become silently wave0-dependent,
- portability to new harnesses (MCP, novel tools, new models, future providers) becomes accidental rather than designed.

Full extraction forces the correct primitive boundary: LiBrainian must negotiate capabilities (providers, tools, file system, graph store) explicitly instead of assuming a monolith.

**Recommended extraction topology**

 - **Transitional (in-repo)**: treat `packages/LiBrainian` as the one source of truth, and make Wave0 depend on it as a package (workspace/file dependency). This minimizes thrash while making the boundary real.
- **Preferred end-state (out-of-repo)**: move LiBrainian to its own repository. Wave0 consumes it like any other dependency. This prevents coupling creep from returning.

**Evidence commands (copy/paste)**
```bash
# 1) Typecheck must be green (prerequisite for any credible extraction)
cd packages/LiBrainian && npx tsc --noEmit

# 2) Coupling audit: wave0/orchestrator imports must go to zero (or a named allowlist if you create one)
rg -n "src/(wave0|orchestrator)/" packages/LiBrainian/src || true

# 3) Identify cross-tree dependencies so they can become adapters
rg -n "from '\\.\\./\\.+/(soma|models|tools|web|test)/" packages/LiBrainian/src || true
```

**E6 evidence commands (copy/paste)**
```bash
# Show current state (target: ZERO outside packages/LiBrainian)
rg -n "from '\\.\\./LiBrainian/|from \"\\.\\./LiBrainian/" src --glob '!src/LiBrainian/**' || true

# No src/LiBrainian path usage outside the package tree (target: ZERO)
rg -n "src/LiBrainian/" src scripts bin config --glob '!src/LiBrainian/**' || true

# Canon Guard boundary check (should be clean)
node scripts/canon_guard.mjs

# The package builds/tests on its own (run inside the package)
cd packages/LiBrainian && npm test
```

### [DOC_MAINTENANCE] How to Update This Doc (hole-fixing protocol)

When implementing a feature and you discover a hole (doc ≠ code reality), do *all* of the following:
1. **Update the closest relevant section** (don’t add a new “meta” explanation elsewhere).
2. **Keep theory adjacent**: if you move or rewrite a spec slice, keep its “why” (theory thread) directly next to the “what” (implementation steps).
3. Add an entry to `#work-log` describing what changed and why (1–3 bullets).
4. Add/update an entry in `#hole-registry` with:
   - **Symptom** (exact error / contradiction),
   - **Scope** (which spec slice it breaks),
   - **Evidence** (file path + search term or command),
   - **Resolution** (what the doc now says; what must be implemented next).
5. Never mark anything “complete” without an explicit **evidence command** that someone can run.
6. If you edited this document, run `node scripts/canon_guard.mjs` (Tier-0 doc coherence gate) before claiming the change is safe.

### [SEARCH_KEYS] Fast Search Keys (use `rg` instead of scrolling)

- `[FOCUS]`, `[WHERE_AM_I]`, `[GATES]`, `[DOC_MAINTENANCE]`, `[HOLE]`, `[WORKLOG]`
- Priorities: `P0`–`P18`, extraction: `E0`–`E7`, quantification: `Q1`–`Q8`, calibration: `C1`–`C4`
- Design lenses: `[CONSTRUCTS]`, `[CAPABILITIES]`, `[EVIDENCE_LEDGER]`, `[CLAIMS]`, `[ADAPTERS]`
- Hard problems: `[DIFFICULTY_DETECTORS]`, `[ADEQUACY]`, `[SIMULATION]`, `[REGIME_MATRIX]`, `[EVAL_SUITE]`

### [CONSTRUCTS] Primitive-Constructable Strategy (what we’re building toward)

Goal: preserve *all* advanced features, but make them **constructable, configurable, and portable** across agent environments by expressing them as compositions of a small set of primitives/operators with explicit contracts, capability negotiation, and evidence requirements.

**Core idea**

- A “feature” is not a bespoke codepath; it is a **composition** of primitives + operators + policies.
- A “provider/tool/harness” is not hard-coded; it is an **adapter** that satisfies a capability contract.
- “World-class” is not asserted; it is **measured and calibrated per environment**, with explicit degraded modes when requirements are unmet.

**Where this already exists (partial)**

- **Technique primitives (metadata + contracts)**: `src/LiBrainian/api/technique_library.ts`, `src/LiBrainian/api/technique_contracts.ts`
- **Operators + interpreters**: `src/LiBrainian/api/operator_registry.ts`, `src/LiBrainian/api/operator_interpreters.ts`
- **Execution engine (runnable DSL)**: `src/LiBrainian/api/technique_execution.ts`
- **Plan compilation (work templates/hierarchies)**: `src/LiBrainian/api/plan_compiler.ts`
- **Provider discovery / environment negotiation (LLM)**: `src/LiBrainian/api/llm_provider_discovery.ts`, `src/LiBrainian/api/llm_env.ts`, `src/LiBrainian/api/provider_check.ts`

**Where it breaks today (must fix for portable “best-in-world” workflows)**

- **Adapters are still incomplete**: LLM adapter is now wired across LiBrainian (search `resolveLlmServiceAdapter()`), but tool/MCP/CI adapters remain unbuilt.
- **Capability negotiation is asymmetric**: query requires embeddings unconditionally (`src/LiBrainian/api/query.ts`), so no “structural-only” retrieval mode exists even though it is feasible.
- **Evidence ledger is not unified**: there are audits/episodes/events, but no single replayable ledger for all non-determinism (LLM calls, tool calls, randomness, file reads).
- **Claims are not verifiable end-to-end**: synthesis “citations” are not grounded to stored evidence (`src/LiBrainian/api/query_synthesis.ts`).

**Minimal construct vocabulary (non-exhaustive; keep theory adjacent)**

- **[CAPABILITIES] Capability contracts**: “What can this environment do?” (LLM, embeddings, repo access, file watching, MCP, tools, budgets).
  - Theory: future agent environments are unpredictable; the only stable interface is a negotiated capability lattice.
  - Implementation hooks today: `checkAllProviders()` + storage capability detection; missing: a unified capability model that includes tools/harness constraints.
- **[EVIDENCE_LEDGER] Evidence ledger**: append-only records of observations/actions used to justify claims (replayable, comparable across runs).
  - Theory: best-in-world outcomes require *auditability* and *debuggable epistemics*; without a ledger, you cannot prove improvement or detect regressions.
  - Implementation hooks today: MCP audit log (`src/LiBrainian/mcp/audit.ts`), episodes (`src/LiBrainian/state/episodes_state.ts`), query stages (`src/LiBrainian/api/query.ts`); missing: single ledger spanning all subsystems + deterministic replay.
- **[CLAIMS] Claims with defeaters**: every surfaced statement is either (a) grounded by evidence refs, or (b) explicitly marked as unverified with enumerated defeaters and a “how to verify” path.
  - Theory: knowledge without defeasibility becomes brittle; defeaters are the mechanism for robustness under change and partial information.
  - Implementation hooks today: defeater system exists; missing: citations/claims that are machine-checkable against evidence store.
- **[ADAPTERS] Adapters**: pluggable tool/model/harness adapters that satisfy capability contracts and emit evidence ledger events.
  - Theory: portability requires treating “tools/providers/models” as replaceable substrates, not assumptions.
  - Implementation hooks today: provider discovery exists for LLM; missing: a uniform adapter registry that covers tools/resources (MCP), CI, dataset registries, telemetry backends, and future harnesses.
  - Advanced devices (optional accelerators, not hard dependencies):
    - **MCP** (tool/resource protocol): becomes a tool/resource adapter that expands the capability lattice and emits tool-call evidence.
    - **Attestation/provenance** (signed build/test/eval artifacts): upgrades evidence strength for claims like “tests passed” or “model validated”.
    - **Deterministic record/replay** (sandbox + IO capture): upgrades reproducibility and makes regressions falsifiable.

**How to use this doc while preserving advanced features**

- Keep advanced features; **re-express them** as compositions + adapters + evidence requirements.
- When adding a new “world-class” technique or breakthrough, specify:
  - required capabilities,
  - evidence ledger entries it must produce,
  - failure/degradation behavior when capabilities are missing,
  - calibration hooks (what outcomes will tune it).

### [SPEC_SLICE_TEMPLATE] Spec Slice Template (copy/paste; keeps theory adjacent)

Use this template whenever you add or revise an implementation-facing section (Parts XIV–XXI) so the work stays constructable and portable.

- **[CAPABILITIES] Required**: (what must exist in this environment; fail-closed if missing)
- **[CAPABILITIES] Optional**: (what improves quality; degraded mode if missing)
- **[ADAPTERS] Interfaces**: (which adapters/drivers must exist; what they must guarantee)
- **[EVIDENCE_LEDGER] Events**: (what gets logged; stable IDs; what can be replayed; whether evidence is attestable)
- **[CLAIMS] Outputs**: (what claims this section enables; evidence ref format; defeaters)
- **Degradation**: (explicit “if capability missing → behavior + disclosure”)
- **Evidence commands**: (exact commands/tests that prove the section works)

### [IMPLEMENTATION_INVARIANTS] Non-Negotiable Invariants (feature improvements + justification)

These are implementation-facing requirements that prevent “feature theater” while preserving advanced capabilities.

1. **[CAPABILITIES] Capability lattice is first-class**: every operation declares required/optional capabilities; runtime negotiates; outputs disclose capability loss explicitly.
2. **[EVIDENCE_LEDGER] Evidence ledger is unified**: every LLM call, tool call, randomness draw, and read/write that influences claims is recorded with stable IDs (or the run must explicitly surface `unverified_by_trace(replay_unavailable)`).
3. **[CLAIMS] Claims are machine-checkable**: anything presented as “supported” maps to evidence refs, not prose “citations”.
4. **Freshness is event-grounded**: invalidations trigger from changes (repo graph, deps, provider/model shifts), not wall-clock priors except as explicit fallback with defeaters.
5. **Executable workflows exist**: the technique system is runnable end-to-end (adapters + operators + checkpoints), not just a planner.
6. **Calibration is environment-specific**: confidence types are explicit (calibrated/configurable/placeholder) and never silently treated as calibrated.
7. **Scaling strategy is deliberate**: retrieval/index paths have an asymptotically viable strategy; brute-force is allowed only in explicit small-scale modes with disclosure.
8. **No paper capability**: a feature is either (a) implemented + gated with evidence commands, or (b) marked spec-only with prerequisites and explicit “how to verify”.
9. **Adequacy gates are mandatory**: detect missing prerequisites (datasets/eval/rollbacks/observability) and fail-closed on strong claims with explicit remediation (see `#universal-difficulty-detector-catalog-agent-default`).

These invariants exist so an agent can always answer: “What evidence supports this?” “What would falsify it?” “What changed since it was last verified?” “What capabilities were assumed?” “Can I replay this run?”

### [WORKLOG] Work Log (append-only; newest first)

- **2026-01-22**: Aligned CLI watch/index/diagnose with provider discovery and auto-selection in LLM purpose extraction; rechecked package typecheck. Evidence commands: `cd packages/LiBrainian && npx tsc --noEmit`.
- **2026-01-22**: Removed LIB-S timeouts in `mvp_librarian.test.ts`, validated standalone typecheck, reran package-only live suites, and rechecked canon guard. Evidence commands: `cd packages/LiBrainian && npx tsc --noEmit`, `cd packages/LiBrainian && npx vitest run src/__tests__/LiBrainian.test.ts`, `cd packages/LiBrainian && npx vitest run src/__tests__/mvp_librarian.test.ts`, `node scripts/canon_guard.mjs`.
- **2026-01-22**: Updated package test run instructions to use package-local paths for standalone execution. Evidence commands: not run (pending).
- **2026-01-22**: Verified extraction gate commands (tsc + boundary searches). Evidence commands: `cd packages/LiBrainian && npx tsc --noEmit`, `rg -n "src/(wave0|orchestrator)/" packages/LiBrainian/src || true`, `rg -n "src/LiBrainian/" src scripts bin config --glob '!src/LiBrainian/**'`.
- **2026-01-22**: Documented public package entrypoints for publishability (README). Evidence commands: not run (pending).
- **2026-01-22**: Implemented difficulty detector catalog + adequacy scanning (query stage + verification/episode persistence), added adequacy gate nodes to plan compiler, and expanded domain-support tests to cover the 10 hypothetical domains. Evidence commands: not run (pending).
- **2026-01-22**: Marked core query/coverage defaults as configurable (query, context assembly, embeddings, confidence calibration, technique execution, structure templates), added domain-bridging primitives with placeholder confidences + optional TechniquePrimitive confidence field, and scoped a quantified-value lint guard using `no-restricted-syntax`.
- **2026-01-22**: Implemented quantification invariant helpers (QuantifiedValue + placeholder/configurable/calibrated/derived) and migrated pattern catalog confidences to placeholders; ran `cd packages/LiBrainian && npx vitest src/api/__tests__/pattern_catalog.test.ts --run` (passed).
- **2026-01-22**: Improved enhanced retrieval query expansion/keyword scoring and switched embedding use case validation to use enhanced retrieval; ran `cd packages/LiBrainian && npx vitest src/__tests__/embedding_use_cases.test.ts src/api/__tests__/vector_redundancy.test.ts src/api/__tests__/technique_contracts.test.ts src/api/__tests__/zero_knowledge_bootstrap.test.ts src/mcp/__tests__/schema.test.ts src/state/__tests__/technique_primitives.test.ts --run` (embedding use cases passed; technique contracts + technique primitives fixed after initial failures).
- **2026-01-22**: Added condition syntax validation for malformed pre/postconditions, capped contradictory-evidence confidence at 0.5, and narrowed redundancy detection to purpose/semantic; ran `cd packages/LiBrainian && npx vitest src/api/__tests__/technique_contracts.test.ts src/state/__tests__/technique_primitives.test.ts --run` (passed).
- **2026-01-22**: Ran `node scripts/canon_guard.mjs` after updating operator event ledger notes (OK).
- **2026-01-22**: Added operator event emission (start/branch/retry/checkpoint/coverage gap/complete) to the execution engine and added operator-event tests; ran `cd packages/LiBrainian && npx vitest src/api/__tests__/technique_execution.test.ts src/api/__tests__/operator_interpreters.test.ts --run` (passed; note: parallel operator truncation warning logged).
- **2026-01-22**: Bootstrapping LLM config now uses provider discovery (async pack/phase config helpers + method pack preload); follow-up evidence pending.
- **2026-01-22**: Routed query synthesis + knowledge summaries through provider discovery (LLM required) and updated method guidance to async config; ran `cd packages/LiBrainian && npx vitest src/api/__tests__/query_pipeline.test.ts --run` (passed).
- **2026-01-22**: Ran `node scripts/canon_guard.mjs` after doc updates (OK).
- **2026-01-22**: Ran extraction gate searches (`rg -n "from '\\.\\./LiBrainian/|from \\\"\\.\\./LiBrainian/" src --glob '!src/LiBrainian/**'` and `rg -n "src/LiBrainian/" src scripts bin config --glob '!src/LiBrainian/**'`); no matches → updated gate snapshot.
- **2026-01-22**: Autopilot promote deterministic suite stabilized by setting test-mode env defaults; ran `npx vitest src/autopilot/__tests__/autopilot_promote.test.ts --run` (passed).
- **2026-01-22**: Hardened `TechniqueCompositionBuilder` merge/relationship validation and updated evidence commands to `packages/LiBrainian` paths.
- **2026-01-22**: Ran `npm run test:tier0`; build failed in `packages/LiBrainian` due to missing telemetry/utils modules and mismatched exports (see Gate Snapshot).
- **2026-01-22**: Implemented metacognitive monitor with strategy switching heuristics (P18 starter slice).
- **2026-01-22**: Implemented bi-temporal knowledge store with time-travel queries (P17 starter slice).
- **2026-01-22**: Implemented heuristic causal discovery with lift-based scoring (P16 starter slice).
- **2026-01-22**: Implemented proof-carrying context retrieval with deterministic proofs (P15 starter slice).
- **2026-01-22**: Implemented the Self-Aware Oracle classifier with tests (P14 starter slice).
- **2026-01-22**: Wired learning-loop signals into plan compiler selection to boost composition scoring (P13 integration).
- **2026-01-22**: Added learning-signal boosts + helper map for composition selection (P13 selector integration).
- **2026-01-22**: Added distribution shift detection + warnings to `ClosedLoopLearner` and surfaced it via the learning loop API.
- **2026-01-22**: Added consolidation + tiered memory promotion to `ClosedLoopLearner` with tests to advance P13.
- **2026-01-22**: Added prediction-weighted retrieval + anti-pattern warnings to `ClosedLoopLearner` (P13 partial) with coverage in `learning_loop.test.ts`.
- **2026-01-22**: Wrapped bootstrap file/directory/assessment persistence in transactional batches and extended transaction contexts with file/directory/assessment upserts.
- **2026-01-22**: Exposed `StorageSlices` via `LiBrainian.getStorageSlices()` and added coverage to advance P11 adoption.
- **2026-01-22**: Added the universal applicability selector + tests (P9) to map situation vectors to protocols and confidence requirements.
- **2026-01-22**: Added the zero-knowledge bootstrapping protocol module + tests (P8) and exported it via the API surface.
- **2026-01-22**: Restored missing package state modules/tests (execution traces, technique state, verification plans, watch state) to unblock P7 evolution and core API storage access.
- **2026-01-22**: Updated Codebase Advisor domain→pattern mapping to reflect the expanded pattern catalog and aligned the spec snippet.
- **2026-01-22**: Expanded the pattern catalog with eight new P5 patterns + tests and refreshed status blocks/paths in this doc for the package boundary.
- **2026-01-22**: Implemented LCL core + preset storage, structure templates, and epistemic policy config in the package tree (tests added).
- **2026-01-22**: Reduced `src/LiBrainian/**` to compatibility shims, deleted the duplicated implementation tree + sync script, and retargeted root CLI/vitest configs to the package paths.
- **2026-01-22**: Rewrote Wave0 imports to use `LiBrainian`, expanded package exports to cover integration/tooling, and added a Canon Guard boundary check to prevent `src/LiBrainian/**` imports outside the package tree.
- **2026-01-22**: Wired `npm run test:tier0` to execute `packages/LiBrainian` tests so the package surface is exercised directly.
- **2026-01-21**: Expanded wave0 adapter auto-registration to check dist paths in addition to src.
- **2026-01-21**: Added wave0 adapter auto-registration (LLM + model policy) during provider gate checks to preserve wave0 behavior without static imports.
- **2026-01-21**: Gated embedding validation/use-case/benchmark tests on Tier-0 and live embedding provider availability.
- **2026-01-21**: Tightened live provider wave0 indexing tests to require orchestrator/soma tree presence (avoid running on package-only src).
- **2026-01-21**: Gated knowledge-utility live suite on wave0 DB/orchestrator/LLM availability; split bootstrap integration gating so Tier1 runs without orchestrator.
- **2026-01-21**: Gated wave0-only test suites on fixture/git/LLM availability and added default LLM factory registration for live/agentic runs.
- **2026-01-21**: Removed cross-tree LLM/model-policy default imports by requiring explicit adapter factories; updated adapter tests and wave0 indexing test gating for standalone runs.
- **2026-01-21**: Added model-policy adapter and lazy LLM adapter loading to decouple package imports (E4 start).
- **2026-01-21**: Synced `packages/LiBrainian/src` with `src/LiBrainian` and removed forbidden test patterns (live embeddings required).
- **2026-01-21**: Added `scripts/sync_librarian_package.mjs` to surface drift between `src/LiBrainian` and `packages/LiBrainian/src` (dry-run by default).
- **2026-01-21**: Routed LLM usage through the adapter resolver across API/ingest/knowledge/agents/tests; removed direct `LLMService` instantiation outside adapters.
- **2026-01-21**: Wired provider gate to LLM adapter registry with fallback/validation and added precedence + error-path tests.
- **2026-01-21**: Hardened LLM adapter registry with AsyncLocalStorage scoping + added default adapter delegation tests and error propagation tests.
- **2026-01-21**: Started E2 interface abstraction by adding an LLM adapter registry (tests added; wiring pending).
- **2026-01-21**: Marked Phase 0 E0/E1 as verified/completed after typecheck and wave0/orchestrator audit.
- **2026-01-21**: Cleared Wave0 extraction gate by removing orchestrator path references in `src/LiBrainian/__tests__/mvp_librarian.test.ts`; updated gate snapshot.
- **2026-01-21**: Revised Part VII and Part X to reflect that the execution engine exists but lacks end-to-end verification (replaced "no execution engine" framing).
- **2026-01-21**: Added SPEC_SLICE stanzas for Parts XVIII–XX to formalize capability/evidence/degradation requirements.
- **2026-01-21**: Added SPEC_SLICE stanzas for Parts XVII and XXI to enforce capability/evidence/degradation expectations.
- **2026-01-21**: Added SPEC_SLICE stanzas for Parts XIV–XVI; clarified meta-critique to reflect implemented-but-unverified execution layer.
- **2026-01-21**: Standalone typecheck now clean (`cd src/LiBrainian && npx tsc --noEmit`). Remaining gates unchanged.
- **2026-01-21**: Gate snapshot recorded (typecheck/build/tier0 blockers). Status tables need evidence-backed reconciliation with code.

### [HOLE] Hole Registry (doc↔code mismatches that must not persist)

- **H-006 (resolved 2026-01-22)**: Evidence commands in Parts XV–XVI and related sections still referenced `cd src/LiBrainian` after the package boundary became canonical. Evidence: `rg -n "cd src/LiBrainian" docs/LiBrainian/THEORETICAL_CRITIQUE.md`. Resolution: updated evidence commands to `cd packages/LiBrainian && npx vitest src/...`.
- **H-003 (resolved 2026-01-21)**: `packages/LiBrainian` diverged from `src/LiBrainian`. Evidence: `diff -qr src/LiBrainian packages/LiBrainian/src`. Resolution: added a sync workflow to reconcile drift; retired the sync script once `src/LiBrainian/**` was reduced to shims.
- **H-001 (resolved 2026-01-21)**: P0/P1 were marked both “completed” and “not started” (see `#implementation-status` vs `#what-to-implement-next-for-codex`). Resolution: status language was reconciled to “Implemented / Blocked / Not yet verified end-to-end”, and doc-supremacy phrasing was removed to satisfy Canon Guard.
- **H-002 (resolved 2026-01-21)**: Typecheck gate note + late-doc execution-layer claims were stale. Evidence: `cd src/LiBrainian && npx tsc --noEmit` now clean; execution layer exists but is explicitly labeled “implemented, not yet verified end-to-end” in Part XXI. Resolution: gate snapshot updated + Part XXI bottom-line revised.
- **H-004 (resolved 2026-01-22)**: “Extraction” is not complete because Wave0 still consumes the in-repo implementation (`src/LiBrainian/**`) directly, which keeps coupling risk high and prevents true portability. Evidence: `rg -n "from '\\.\\./LiBrainian/|from \\\"\\.\\./LiBrainian/\" src --glob '!src/LiBrainian/**'` and `rg -n "src/LiBrainian/" src scripts bin config --glob '!src/LiBrainian/**'` return no results. Resolution: Wave0 now uses `LiBrainian` exclusively and `src/LiBrainian/**` is shim-only.
- **H-005 (resolved 2026-01-22)**: `src/LiBrainian/**` still exists as a duplicated tree (even though Wave0 imports are now package-bound). Evidence: `rg --files src/LiBrainian` returns only the shim entrypoints + shim test. Resolution: removed the duplicate implementation tree, leaving the minimal compatibility shims.

## Table of Contents

### 🚀 Start Here (For Codex/AI Agents)
0. [Agent Navigation Frame](#agent-navigation-frame-read-this-first) — Where you are; gates; how to update this doc
1. [Implementation Status](#implementation-status) — What exists; what’s blocked; evidence commands
2. [Document Navigation Guide](#document-navigation-guide) — How to read this ~22k-line doc
3. [What to Implement Next](#what-to-implement-next-for-codex) — P0–P18 consolidated priorities (evidence-backed)
4. [Difficulty Detectors](#universal-difficulty-detector-catalog-agent-default) — Make hard problems discoverable without “genius”
5. [How Parts Relate](#how-parts-relate-dependency-graph) — Dependency graph

### 📚 Theoretical Foundation (Parts I-IV)
5. [Part I: Computational Theoretical Problems](#part-i-computational-theoretical-problems)
6. [Part II: Epistemological and Philosophical Errors](#part-ii-epistemological-and-philosophical-errors)
7. [Part III: Architectural Incoherences](#part-iii-architectural-incoherences)
8. [Part IV: Solution Propagation Framework](#part-iv-solution-propagation-framework)

### 🔍 Analysis (Parts V-VI)
9. [Part V: API and Implementation Review](#part-v-api-and-implementation-review)
10. [Part VI: Actual Utility Analysis (20 Use Cases)](#part-vi-actual-utility-analysis-expanded-20-use-cases)

### 🔧 Problems & Solutions (Parts VII-X)
11. [Part VII: Critical Usability Problems](#part-vii-critical-usability-problems-and-solutions)
12. [Part VIII: Implementation Roadmap (Historical)](#part-viii-implementation-roadmap) — *Superseded by section 3*
13. [Part IX: Subsystem-Level Problems](#part-ix-subsystem-level-problems-and-solutions)
14. [Part X: Summary of All Problems](#part-x-summary-of-all-problems)

### ⭐ Excellence & Theory (Parts XI-XIII)
15. [Part XI: Making LiBrainian World-Class](#part-xi-making-LiBrainian-a-top-github-repository-of-all-time)
16. [Part XII: Critical Gaps for Theorists](#part-xii-critical-gaps-for-cutting-edge-theorists-jan-2026)
17. [Part XIII: Self-Improvement Guide](#part-xiii-using-LiBrainian-to-perfect-LiBrainian)

### 🛠️ Implementation Specs (Parts XIV-XVI) — Read for specific features
18. [Part XIV: Composition Discovery & Evolution](#part-xiv-composition-discovery-guidance-and-evolution)
19. [Part XV: Operator Execution Layer](#part-xv-the-operator-execution-layer)
20. [Part XVI: Extensible LLM Provider Discovery](#part-xvi-extensible-llm-provider-discovery)

### 🧠 The Twenty Greats (Parts XVII-XIX) — Agentic implementation
21. [Part XVII: Twenty Greats' Implementation Items](#part-xvii-the-twenty-greats-implementation-items)
22. [Part XVIII: Theoretical Breakthroughs](#part-xviii-theoretical-breakthroughs-and-epistemic-bootstrapping)
23. [Part XIX: Modular Configuration Language](#part-xix-modular-configuration-language--building-on-existing-foundations)

### 🧭 Roadmap & Current State (Parts XX-XXI)
24. [Part XX: Implementation Roadmap and Codex Current State](#part-xx-implementation-roadmap-and-codex-current-state)
25. [Part XXI: Comprehensive Programming Knowledge Support](#part-xxi-comprehensive-programming-knowledge-support)

> **Note**: Parts XX–XXI contain the consolidated roadmap; the top-of-doc sections (Agent Navigation Frame + Implementation Status + What to Implement Next) are a fast index and a place to record current agent state.

---

## Implementation Status

> **Last updated**: 2026-01-22
> **Document version**: 10.5.6

### [EVIDENCE] Status Discipline (non-negotiable)

- “Complete” means: **exists in code + is reachable from the main API + has at least Tier-0 evidence or an explicit, named gate blocking it**.
- If a feature exists in code but fails typecheck/build, mark it **Implemented (Blocked)**, not “Done”.
- Every “Done/Blocked/Planned” label must include a runnable **evidence command** (e.g., `rg` query or `npm` command).

### [API_MAP] API / Primitives / Constructions (what actually exists)

This is the “surface map” an agent should use to understand LiBrainian quickly (with paths to jump into code). It is intentionally redundant with later Parts.

| Surface | Where | Contract (what it guarantees) | Known failure modes / holes |
|---------|-------|-------------------------------|-----------------------------|
| Main facade | `packages/LiBrainian/src/api/LiBrainian.ts` | Orchestrates storage, bootstrap, index, query, and optional watcher | Default config can look “ready” while typecheck/build gates are red; provider gating is distributed (some call sites still bypass discovery) |
| Provider gating | `packages/LiBrainian/src/api/provider_check.ts`, `packages/LiBrainian/src/api/provider_gate.ts` | Fail-closed when required providers are unavailable; emits remediation steps | Must be the *only* way call sites decide “LLM/embeddings are usable”; any ad-hoc env checks create drift |
| LLM discovery | `packages/LiBrainian/src/api/llm_provider_discovery.ts`, `packages/LiBrainian/src/api/llm_env.ts` | Finds an authenticated provider/model without repo-specific config | If any subsystem instantiates `LLMService` directly without discovery/probe evidence, the system violates `[CAPABILITIES]` invariants |
| Query pipeline | `packages/LiBrainian/src/api/query.ts`, `packages/LiBrainian/src/api/query_synthesis.ts` | Retrieves packs + reports stages; optionally synthesizes | Retrieval currently requires embeddings unconditionally; `query_synthesis.ts` still does env-only config and directly instantiates `LLMService` (adapter bypass) |
| Embeddings | `packages/LiBrainian/src/api/embeddings.ts`, `packages/LiBrainian/src/api/embedding_providers/real_embeddings.ts` | Real semantic embeddings only; bounded retries; normalization checks | Docs/comments must not drift (dimension/model naming mismatches are an agent trap); degraded non-embedding retrieval mode is not implemented |
| Technique primitives | `packages/LiBrainian/src/api/technique_library.ts`, `packages/LiBrainian/src/strategic/techniques.ts` | Declarative primitive records + contracts for planning/execution | Many primitives remain “spec-like” unless there is a mapped executor/handler; missing unified evidence ledger per primitive run |
| Operators + execution | `packages/LiBrainian/src/api/technique_execution.ts`, `packages/LiBrainian/src/api/operator_registry.ts`, `packages/LiBrainian/src/api/operator_interpreters.ts` | Executes compositions; supports checkpointing; interprets some operators | Many operators are implemented as explicit no-ops; execution claims must be gated by operator coverage evidence |
| Planning / compilation | `packages/LiBrainian/src/api/plan_compiler.ts`, `packages/LiBrainian/src/api/composition_selector.ts`, `packages/LiBrainian/src/api/pattern_catalog.ts` | Selects compositions and compiles plans/work nodes | Risk of “planner theater” if plans aren’t executable + replayable + outcome-linked |
| Tools/resources (external) | `packages/LiBrainian/src/mcp/*`, `packages/LiBrainian/src/skills/*` | Expands what the agent can do via adapters; tool calls become evidence events | Without explicit capability/evidence integration, tools become “invisible work” that cannot support strong claims; requires an adapter registry and ledger linking |

### ✅ PRESENT IN CODEBASE (verify end-to-end)

Do not interpret this table as “build/typecheck green”; see `[GATES]` at the top of the document.

| Feature | Problem # | Implementation | Commit |
|---------|-----------|----------------|--------|
| Execution Engine | Critical A | `technique_execution.ts`: `TechniqueExecutionEngine` | `32767299` |
| Checkpointing | Critical D | `technique_execution.ts`: `InMemoryExecutionCheckpointStore` | `97ac407b` |
| Learning Loop | Critical B | `learning_loop.ts`: `ClosedLoopLearner` | `9f1a294f` |
| Context Sessions | Critical E | `context_sessions.ts`: `ContextAssemblySessionManager` | `5e30fa14` |
| Query Pipeline Stages | P17 | `query.ts`: `getQueryPipelineStages` | `9a405e58` |
| Technique Contracts | P18 | `technique_contracts.ts`: validation functions | `89e93333` |
| Technique Validation | P18 | `technique_validation.ts`: analysis functions | `7c6aaa8c` |
| Plan Output Enrichment | P20 | `plan_compiler.ts`: enriched outputs | `47300a41` |
| Stage Reporting | P22 | `query.ts`: `StageReport`, capability gates | `a13946e6` |
| Composition Builder | Critical C | `technique_composition_builder.ts`: fluent API | `1099e80c` |
| Technique Packages | New | `technique_packages.ts`: domain groupings | `ba419ba1` |
| Operator Execution Layer | XV | `operator_interpreters.ts`, `operator_registry.ts`, `technique_execution.ts` | `a8333822` |
| Semantic Composition Selection | P19, XIV.B | `composition_selector.ts`, `plan_compiler.ts` | `0f78b4b9` |
| Pattern Catalog | XIV.A | `pattern_catalog.ts` | `c0b086d0` |
| Codebase-Aware Suggestion | XIV.C | `codebase_advisor.ts` | `6757a28e` |
| Composition Evolution Engine | XIV.D | `composition_evolution.ts` | `a8add3af` |
| Extensible LLM Provider Discovery | XVI | `llm_provider_discovery.ts`, `llm_env.ts` | `6a3a1f0e` |
| LCL Core + Presets | XIX.L | `lcl.ts`, `preset_storage.ts` | `10ad66bf` |
| Structure Templates | XIX.M | `structure_templates.ts` | `51ff1fe3` |
| Epistemic Policy Config | XIX.N | `epistemic_policy.ts` | `377f1b0a` |
| Zero-Knowledge Bootstrap | XVIII.J | `zero_knowledge_bootstrap.ts` | `dfa1e68a` |
| Universal Applicability | XVIII.K | `universal_applicability.ts` | `97fcd5e4` |
| Transaction Boundary Batches | P12 | `bootstrap.ts`: transactional file/directory/assessment batches | `5d4d73d4` |
| Prediction-Weighted Retrieval | P13 | `learning_loop.ts`: outcome-weighted scoring + anti-pattern warnings | `6c4598c8` |
| Consolidation + Tiered Memory | P13 | `learning_loop.ts`: consolidation + tier promotion | `cdc3a148` |
| Distribution Shift Detection | P13 | `learning_loop.ts`: codebase stats + shift warnings | `41d00c0a` |
| Selector Learning Boosts | P13 | `composition_selector.ts`: learning signal boosts | `00919aa8` |
| Plan Compiler Learning Wiring | P13 | `plan_compiler.ts`: pass learning signals into selector | `0220959b` |
| Self-Aware Oracle Classifier | P14 | `self_aware_oracle.ts`: decidability classification | `52f8f0bb` |
| Proof-Carrying Context | P15 | `proof_carrying_context.ts`: relevance proofs | `67a35eda` |
| Causal Discovery Engine | P16 | `causal_discovery.ts`: heuristic causal relationships | `aee7155f` |
| Bi-Temporal Knowledge | P17 | `bi_temporal_knowledge.ts`: time-travel queries | `36bc2d51` |
| Metacognitive Monitor | P18 | `metacognitive_architecture.ts`: strategy switching | `7e524940` |
| Vector Normalization Validation | P30 | `embeddings.ts`: normalization config | `0049c07e` |

### 🔄 IN PROGRESS (Active Work - Uncommitted)

None currently. See the next section for priorities that are not yet shipped or not yet verified end-to-end.

### 🚧 NOT YET SHIPPED / NOT VERIFIED END-TO-END (Priority Order)

> **See "What to Implement Next" below for full P0-P18 list with dependencies and LOC estimates.**

| Priority | Feature | Part Ref | Why Critical |
|----------|---------|----------|--------------|
| **P0** | LLM Provider Discovery | XVI | Implemented in code; must verify all call sites use it and that failure modes are explicit (no hidden requirements). |
| **P1** | Operator Execution Layer | XV | Implemented in code; typecheck green but end-to-end execution evidence + API reachability still pending. |
| **P6** | Codebase Advisor | XIV.C | Implemented in code; verify advisor queries respect provider gates and align with the updated pattern catalog. |
| **P7** | Evolution Engine | XIV.D | Implemented in code; verify state persistence + evolution heuristics with real traces. |
| **P8** | Zero-Knowledge Bootstrap | XVIII.J | Implemented in code; verify protocol outputs and bootstrap integration. |
| **P9** | Universal Applicability | XVIII.K | Implemented in code; verify situation-to-protocol mapping coverage. |
| P11 | Storage Interface Split | IX (P24) | Implemented in code; expand slice-first usage across APIs. |
| P12 | Transaction Boundaries | IX (P25) | Implemented in code (bootstrap file/directory batches transactional); verify remaining multi-step flows. |
| P13 | Prediction-Oriented Memory | VII (B.1) | ✅ Implemented (learning loop + selector wiring); evidence refresh pending. |

### ⚠️ PARTIALLY IMPLEMENTED

| Feature | What Exists | What's Missing |
|---------|-------------|----------------|
| Confidence System | Basic tracking | Calibration from outcomes (P5, P6) |
| Episode Learning | Recording | Acting on learnings (P37) |
| MCP Integration | Basic audit | Rate limiting, response versioning (P39, P42) |
| Learning Loop | `ClosedLoopLearner` records outcomes + prediction-weighted retrieval + consolidation/tiering + shift detection | Selector wiring implemented; refresh evidence for prediction-oriented memory (B.1). |
| Storage Interface Split | `StorageSlices`, `createStorageSlices`, `LiBrainian.getStorageSlices()` | Expand slice-first adoption across storage consumers. |
| Transaction Boundaries | `transaction()` + `withinTransaction()` helpers; bootstrap file/directory/assessment batches now wrapped | Inventory remaining multi-step flows (bootstrap ingest, graph writes) and ensure transactional wrapping; add transaction report if needed. |

---

## Document Navigation Guide

> **THIS DOCUMENT HAS GROWN OVER TIME.** This guide helps you find what you need without reading the entire document end-to-end.

### For Codex/AI Agents: Start Here

| What You Need | Go To | Why |
|---------------|-------|-----|
| **Current state & next steps** | Top of doc + Part XX | Current focus, gate snapshot, and the consolidated roadmap |
| **Specific feature to implement** | Parts XIV-XVI | Detailed specifications with code examples |
| **Modular configuration** | Part XIX | LCL language for composing existing primitives |
| **Theoretical breakthroughs** | Part XVIII | Novel contributions (implement AFTER Phase 2) |
| **Additional patterns/primitives** | Part XVII | Extensions to existing infrastructure |

### For Human Architects: Understanding the System

| What You Need | Go To | Why |
|---------------|-------|-----|
| **Theoretical foundations** | Parts I-IV | Computational, epistemological, architectural analysis |
| **Use case validation** | Part VI | 20 use cases with utility scores |
| **Known problems** | Part X | Summary of all 56 problems |
| **Making LiBrainian great** | Part XI | GitHub excellence strategies |

### For Maintainers: System Health

| What You Need | Go To | Why |
|---------------|-------|-----|
| **Subsystem issues** | Part IX | Per-subsystem problems and solutions |
| **Critical usability gaps** | Part VII | Execution engine, learning loop, etc. |
| **Self-improvement** | Part XIII | Using LiBrainian to improve LiBrainian |

---

## What to Implement Next (For Codex)

> **Primary Navigation Index**: This section consolidates implementation guidance so an agent can execute without reading the entire document. Individual parts include deeper theory and rationale.

### Phase 0: Wave0 Extraction (Blocking)

This is not “nice to have”. It is the prerequisite that prevents wasted work and makes LiBrainian portable to any repo/harness.

**Rule**: do not start P0+ feature work until **E6 Full Extraction (Wave0 Migration)** is complete and evidenced (see `#e6-full-extraction-wave0-migration--implementation-recipe-agent-executable`).

| Priority | Feature | LOC | Description | Status |
|----------|---------|-----|-------------|--------|
| **E0** | Build Verification | ~0 | Verify LiBrainian builds/typechecks as its own unit | ✅ Verified (`npx tsc --noEmit`) |
| **E1** | Dependency Audit | ~0 | Identify all imports from wave0-specific modules | ✅ Completed (wave0/orchestrator refs cleared) |
| **E2** | Interface Abstraction | ~200 | Abstract non-LiBrainian dependencies behind adapters | ✅ Completed (LLM adapter wiring across LiBrainian + tests) |
| **E3** | Package Structure | ~100 | Create `packages/LiBrainian/` with its own package.json | ✅ Completed (package synced to `src/LiBrainian`) |
| **E4** | Import Rewriting | ~0 | Update all imports to use package-local paths | ✅ Completed (adapter factories; no cross-tree imports) |
| **E6** | Full Extraction (Wave0 Migration) | ~300–800 | Wave0 must consume LiBrainian via `LiBrainian` (no `src/LiBrainian/**` coupling; delete/shim old tree) | ✅ Completed (package boundary enforced; shims retained) |
| **E5** | Standalone Tests | ~300 | Ensure tests run without wave0 context | 🚧 In Progress (package-only `LiBrainian.test.ts` + `mvp_librarian.test.ts` ran; full `npm test`/Tier-0 pending) |
| **E7** | Publishability | ~50 | Package exports/docs for external use (after E6 makes the boundary real) | ✅ Implemented (public entrypoints documented) |

**Evidence commands (copy/paste)**
```bash
cd packages/LiBrainian && npx tsc --noEmit
rg -n "src/(wave0|orchestrator)/" packages/LiBrainian/src || true
```

### E6: Full Extraction (Wave0 Migration) — Implementation Recipe (agent-executable)

This is the “make it real” step. It is intentionally concrete so an agent can execute it without reading the rest of the doc.

**Goal**: Wave0 uses LiBrainian like a third-party dependency, so LiBrainian stays harness-agnostic by construction.

**Hard constraints**
- No fake embeddings. No provider-gate bypass. No API-key env checks in tests.
- Do not create parallel implementations. Pick one source of truth and eliminate the other.

**Step 1 — Choose the packaging topology (decision, then commit to it)**
- **Option A (recommended now)**: Monorepo consumption.
  - Wave0 depends on `packages/LiBrainian` (workspace or `file:` dependency) and imports `LiBrainian`.
  - Single source: `packages/LiBrainian/src/**`.
- **Option B (preferred end-state)**: Separate repo.
  - Move `packages/LiBrainian` out (git subtree split or new repo), publish/install, then update Wave0 imports.

**Step 2 — Make Wave0 import only via the package boundary**
- Replace Wave0 imports like `../LiBrainian/...` with `LiBrainian` (or `LiBrainian/api`, etc.).
- Add a hard gate (grep-based) so `../LiBrainian/**` never returns.

**Step 3 — Eliminate duplication**
- Delete `src/LiBrainian/**` OR convert it to a tiny shim that re-exports from `LiBrainian` (temporary).
- Update build/test configs so Wave0 does not compile two copies.
- Ensure `scripts/` and `bin/` paths follow the package boundary.

**Step 4 — Prove it with evidence**
- The “E6 evidence commands” under `#wave0-extraction-gate-must-be-green-first` must be green.
- Tier-0 must run without relying on `src/LiBrainian/**` being present as implementation.

**Step 5 — Update this document**
- Update `[GATES]` “Wave0 extraction gate” to reflect E6 completion criteria (package-boundary-only, no in-repo imports).
- Add a Work Log entry with the exact evidence commands you ran.

### Phase 1: Feature Work (Only After Extraction)

### The Consolidated Priority List

This merges priorities from Parts XIV-XX into one coherent sequence:

| Priority | Feature | Part Reference | LOC | Dependencies | Status |
|----------|---------|----------------|-----|--------------|--------|
| **P0** | LLM Provider Discovery | XVI | ~400 | None | ✅ Implemented (verify wiring + gates) |
| **P1** | Operator Execution Layer | XV | ~300 | P0 | ⚠️ Implemented (typecheck green; Tier-0 pending) |
| **P2** | Semantic Selector | XIV.B | ~0 | None | ✅ Implemented (verify Tier-0 + integration) |
| **P3** | LCL Core | XIX.L | ~200 | P0, P1 | ✅ Implemented (package) |
| **P4** | Structure Templates | XIX.M | ~100 | P3 | ✅ Implemented (package) |
| **P5** | 8 New Patterns | XVII.H | ~400 | P3 | ✅ Implemented (package) |
| **P6** | Codebase Advisor | XIV.C | ~200 | P5 | ✅ Implemented (package) |
| **P7** | Evolution Engine | XIV.D | ~300 | P6 | ✅ Implemented (package) |
| **P8** | Zero-Knowledge Bootstrap | XVIII.J | ~300 | P1 | ✅ Implemented (package) |
| **P9** | Universal Applicability | XVIII.K | ~600 | P8 | ✅ Implemented (package) |
| **P10** | Epistemic Policy | XIX.N | ~80 | P9 | ✅ Implemented (package) |

**Quick Evidence Commands (copy/paste)**

- **P0 (Provider discovery exists)**: `ls -la packages/LiBrainian/src/api/llm_provider_discovery.ts packages/LiBrainian/src/api/llm_env.ts`
- **P1 (Operator layer exists; typecheck evidence)**: `nl -ba packages/LiBrainian/src/api/operator_interpreters.ts | sed -n '1350,1385p'` then run `cd packages/LiBrainian && npx tsc --noEmit`
- **P2 (Semantic selector exists)**: `rg -n \"class SemanticCompositionSelector\" packages/LiBrainian/src/api/composition_selector.ts`

---

**Lower priority (after P0-P10 and extraction stable):**

| Priority | Feature | Part Reference | LOC | Notes |
|----------|---------|----------------|-----|-------|
| P11 | Storage Interface Split | IX (P24) | ~200 | ✅ Implemented (package) |
| P12 | Transaction Boundaries | IX (P25) | ~150 | ⚠️ Implemented (bootstrap batches transactional; verify remaining flows) |
| P13 | Prediction-Oriented Memory | VII (B.1) | ~200 | ✅ Implemented (learning loop + selector wiring; refresh evidence) |
| P14 | Self-Aware Oracle | XVIII.I | ~400 | ✅ Implemented (heuristic classifier; evidence refresh pending) |
| P15 | Proof-Carrying Context | XVIII.II | ~600 | ✅ Implemented (deterministic proof retriever; evidence refresh pending) |
| P16 | Causal Discovery | XVIII.IV | ~500 | ✅ Implemented (heuristic discovery; evidence refresh pending) |
| P17 | Bi-Temporal Knowledge | XVIII.III | ~400 | ✅ Implemented (in-memory store; evidence refresh pending) |
| P18 | Metacognitive Architecture | XVIII.V | ~300 | ✅ Implemented (heuristic monitor; evidence refresh pending) |

### 📊 Quantification Invariant (Epistemic Debt Resolution)

> **CRITICAL**: All confidence values in LiBrainian are currently arbitrary. This section tracks the work required to achieve epistemic honesty.

**The Quantification Invariant**: No numeric value representing uncertainty may be introduced without being DERIVED, CALIBRATED, CONFIGURABLE, or explicitly marked as PLACEHOLDER. See Part XIX.N.5 for the full specification.

| Priority | Feature | Part Reference | LOC | Dependencies | Status |
|----------|---------|----------------|-----|--------------|--------|
| **Q1** | QuantifiedValue type | XIX.N.5 | ~50 | None | ✅ Implemented (quantification helpers added) |
| **Q2** | placeholder() wrapper | XIX.N.5 | ~30 | Q1 | ✅ Implemented |
| **Q3** | configurable() wrapper | XIX.N.5 | ~30 | Q1 | ✅ Implemented |
| **Q4** | calibrated() wrapper | XIX.N.5 | ~50 | Q1 | ✅ Implemented |
| **Q5** | Migrate technique_library.ts | XIX.N.6 | ~100 | Q2-Q4 | ✅ Implemented (domain-bridging primitives now use placeholders) |
| **Q6** | Migrate pattern_catalog.ts | XIX.N.6 | ~80 | Q2-Q4 | ✅ Implemented (placeholder migration) |
| **Q7** | Migrate remaining files | XIX.N.6 | ~150 | Q2-Q4 | ✅ Implemented (query/context/embeddings/execution/calibration/structures) |
| **Q8** | ESLint no-arbitrary-numbers | XIX.N.5 | ~100 | Q1 | ✅ Implemented (targeted no-restricted-syntax guard in core files) |

**Calibration Infrastructure** (for replacing placeholders with empirical values):

| Priority | Feature | Part Reference | LOC | Dependencies |
|----------|---------|----------------|-----|--------------|
| **C1** | Claim-Outcome Tracking | XIX.N.4 | ~100 | Q2 |
| **C2** | Calibration Curve Computation | XIX.N.7 | ~150 | C1 |
| **C3** | Confidence Adjustment | XIX.N.7 | ~100 | C2 |
| **C4** | Calibration Dashboard | XIX.N.7 | ~200 | C2 |

**When to do QI work**: Q1-Q4 should be done BEFORE implementing new primitives. Q5-Q8 can be done incrementally. C1-C4 are ongoing infrastructure.

---

### 🌐 Universal Domain Support (Any Application, Any Scale)

> **GUARANTEE**: LiBrainian will support ANY software domain through 14 composable primitives based on 9 fundamental computational aspects.

**The Completeness Claim**: 14 primitives cover all 9 fundamental aspects (DATA, STATE, TIME, SPACE, LOGIC, STRUCTURE, VALUE, AGENCY, MEDIA). Any domain decomposes into these aspects. See Part XIX Use Case Coverage Analysis for the full proof.

| Priority | Feature | Part Reference | LOC | Dependencies | Status |
|----------|---------|----------------|-----|--------------|--------|
| **D1** | 7 New Domain Primitives | XIX | ~350 | Q1-Q4 | ✅ Implemented |
| **D2** | 10 World-Class Compositions | XIX | ~500 | D1 | ✅ Implemented |
| **D3** | Domain Construction Protocol | XIX | ~200 | D2 | ✅ Implemented |
| **D4** | Aspect Decomposer (LLM) | XIX | ~150 | D3 | ✅ Implemented |
| **D5** | Composition Validator | XIX | ~100 | D2 | ✅ Implemented |
| **D6** | Universal Domain Tests | XIX | ~300 | D1-D5 | ✅ Implemented |
| **D7** | Difficulty Detectors + Adequacy Gates | Top-of-doc | ~250 | Q1-Q4 | ✅ Implemented |

**The 7 New Primitives** (D1):
- `tp_algorithm_trace` — Feed ranking, recommendations, search
- `tp_component_graph` — UI composition, widget structure
- `tp_scale_pattern` — Sharding, replication, HA patterns
- `tp_realtime_flow` — Live updates, event streams
- `tp_media_pipeline` — Transcoding, CDN, assets
- `tp_tool_orchestration` — Tool coordination, MCP, LSP
- `tp_distribution_map` — Edge, CDN, geographic distribution

**The 10 World-Class Compositions** (D2):
`tc_social_platform`, `tc_video_platform`, `tc_industrial_backend`, `tc_developer_tool`, `tc_dashboard`, `tc_landing_page`, `tc_payment_system`, `tc_e_commerce`, `tc_search_system`, `tc_notification`

**When to do D1-D7**: After Q1-Q4 (primitives and detectors need the QuantifiedValue type). D1-D7 can be done in parallel with P0-P10.

---

### 🔧 Tools, Skills, and Emergent Capabilities

> **LiBrainian must support ANY capability agents develop—known and unknown.**

#### What Already Exists

| Component | Location | Status |
|-----------|----------|--------|
| **Skills System** | `src/LiBrainian/skills/types.ts` | ✅ 570 LOC types defined |
| **Skill Loader** | `src/LiBrainian/skills/loader.ts` | ✅ Implemented |
| **Skill Validator** | `src/LiBrainian/skills/validator.ts` | ✅ Implemented |
| **MCP Tools** | `src/LiBrainian/mcp/` | ✅ 20+ tools exposed |
| **Method Packs** | `src/LiBrainian/api/packs.ts` | ✅ Skill→MethodPack adapter |

#### The Skills Architecture (Already Built)

```typescript
// Skills are portable procedural knowledge that agents can use
interface AgentSkill {
  identity: { id, name, version, namespace };
  definition: {
    trigger: { taskTypes, intentPatterns, filePatterns, condition };
    workflow: WorkflowStep[];  // script, command, llm, decision, parallel, conditional, manual
    inputs: SkillInput[];
    outputs: SkillOutput[];
    dependencies: SkillDependency[];
  };
  scripts: SkillScript[];   // Executable scripts
  resources: SkillResource[]; // Templates, examples, configs
}
```

#### What's Missing for Full Tool/Skill Support

| Priority | Feature | Description | LOC Est. |
|----------|---------|-------------|----------|
| **T1** | Tool Registry Integration | Connect skills to technique primitives | ~150 |
| **T2** | Dynamic Tool Discovery | Probe for available tools at runtime | ~200 |
| **T3** | Tool Capability Negotiation | Agents query "what can you do?" | ~150 |
| **T4** | Skill Composition | Combine skills into compound workflows | ~200 |
| **T5** | Emergent Capability Protocol | Framework for unknown future capabilities | ~300 |

#### The Emergent Capability Protocol (New)

> **Key insight**: We can't predict what capabilities agents will develop. LiBrainian must support capabilities that DON'T EXIST YET.

```typescript
// Framework for unknown future capabilities
interface EmergentCapabilityProtocol {
  // 1. Capability Advertisement
  advertise(capability: CapabilityDescriptor): void;

  // 2. Capability Discovery
  discover(query: CapabilityQuery): CapabilityDescriptor[];

  // 3. Capability Negotiation
  negotiate(required: CapabilityRequirement[], available: CapabilityDescriptor[]): NegotiationResult;

  // 4. Capability Invocation (generic)
  invoke<T>(capabilityId: string, params: unknown): Promise<T>;

  // 5. Capability Learning
  learn(invocation: CapabilityInvocation, outcome: Outcome): void;
}

interface CapabilityDescriptor {
  id: string;
  name: string;
  version: string;
  // Self-describing schema for inputs/outputs
  inputSchema: JSONSchema;
  outputSchema: JSONSchema;
  // What this capability does (for semantic matching)
  description: string;
  tags: string[];
  // Evidence of capability (tests, examples, history)
  evidence: CapabilityEvidence;
  // When this capability was discovered
  discoveredAt: string;
  // Source (skill, tool, MCP, external, emergent)
  source: CapabilitySource;
}

// Capabilities can come from anywhere
type CapabilitySource =
  | { type: 'skill'; skillId: string }
  | { type: 'mcp_tool'; serverId: string; toolName: string }
  | { type: 'external_api'; endpoint: string }
  | { type: 'agent_learned'; agentId: string; episodeId: string }
  | { type: 'composition'; componentIds: string[] }
  | { type: 'unknown'; metadata: Record<string, unknown> };
```

#### Integration with Existing Systems

```
┌─────────────────────────────────────────────────────────────────────┐
│                    EMERGENT CAPABILITY LAYER                        │
│                                                                     │
│  Capability Registry ─── Discovery ─── Negotiation ─── Invocation  │
│         │                   │               │              │        │
└─────────┼───────────────────┼───────────────┼──────────────┼────────┘
          │                   │               │              │
          ▼                   ▼               ▼              ▼
┌─────────────────┐  ┌─────────────┐  ┌───────────┐  ┌─────────────┐
│ Skills System   │  │ MCP Tools   │  │ Patterns  │  │ Learning    │
│ (skills/*.ts)   │  │ (mcp/*.ts)  │  │ (catalog) │  │ Loop        │
└─────────────────┘  └─────────────┘  └───────────┘  └─────────────┘
          │                   │               │              │
          └───────────────────┴───────────────┴──────────────┘
                              │
                    ┌─────────────────┐
                    │ Technique       │
                    │ Compositions    │
                    └─────────────────┘
```

#### Codex Implementation Note

Add T1-T5 to the implementation plan AFTER P0-P7. The emergent capability protocol should be designed to:
1. Support capabilities we KNOW about (skills, MCP tools)
2. Support capabilities we DON'T KNOW about yet (future agent inventions)
3. Learn which capabilities work well for which situations
4. Allow agents to COMPOSE capabilities into new compound capabilities

**The key is self-description**: every capability must describe itself well enough that semantic matching can find it for relevant tasks.

---

### 🏛️ Architectural Principles (25 Greats' Foundation)

> **These are NOT optional guidelines.** They are architectural invariants that MUST be maintained across all LiBrainian development. Derived from the 25 greats' analysis of what makes epistemological infrastructure world-class.

#### The Six Invariants

| # | Principle | Invariant | Violation Example |
|---|-----------|-----------|-------------------|
| **G1** | Pure Function Core | `query()`, `search()`, `compose()`, `verify()` take all dependencies as parameters | Hidden global state, implicit LLM dependency |
| **G2** | Message Passing | External integration via `receive(message) → response` | Direct function calls that bypass the actor interface |
| **G3** | Algebraic Composition | Operations form an algebra: closure, associativity, identity | Ad-hoc composition that doesn't follow operator laws |
| **G4** | Capability-Based | Security via unforgeable tokens, not permission lists | `if (user.hasRole('admin'))` checks |
| **G5** | Context as Resource | Context is explicit, typed, and budget-managed | Implicit context accumulation, unbounded retrieval |
| **G6** | Self-Description | Every component describes its capabilities and evidence | Magic strings, undocumented assumptions |

#### Architectural Implementation Priorities

| Priority | Feature | Principle | LOC | Description |
|----------|---------|-----------|-----|-------------|
| **G1** | Pure Core Refactor | G1 | ~150 | Ensure all core functions take dependencies as parameters |
| **G2** | Actor Interface | G2 | ~100 | Add `receive(message): response` wrapper for integration |
| **G3** | Operator Algebra Tests | G3 | ~200 | Add property-based tests for algebraic laws |
| **G4** | Capability Tokens | G4 | ~200 | Replace permission checks with capability tokens |
| **G5** | Context Budget API | G5 | ~150 | Add explicit token budgets to all context operations |
| **G6** | Self-Description Schemas | G6 | ~100 | Add JSON Schema self-description to all primitives |
| **G7** | Protocol Adapters | G1, G2 | ~300 | MCP, CLI, HTTP as thin adapters over pure core |
| **G8** | Independence Tests | G1-G6 | ~200 | Integration tests that verify independence invariants |

#### The Architecture (Visual)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      LiBrainian (Independent Core)                        │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │ LAYER 1: PURE CORE (G1)                                            │  │
│  │                                                                    │  │
│  │   query(intent, ctx, llm)  →  Result<Answer, Uncertainty>          │  │
│  │   search(pattern, corpus)  →  Result<Matches, NotFound>            │  │
│  │   compose(ops, algebra)    →  Result<Composition, Invalid>         │  │
│  │   verify(claim, evidence)  →  Result<Verified, Refuted>            │  │
│  │                                                                    │  │
│  │   - No global state                                                │  │
│  │   - All dependencies explicit                                      │  │
│  │   - Pure functions (same input → same output)                      │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                    │                                     │
│                                    ▼                                     │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │ LAYER 2: ACTOR WRAPPER (G2)                                        │  │
│  │                                                                    │  │
│  │   receive(message: LibrarianMessage): LibrarianResponse            │  │
│  │                                                                    │  │
│  │   - Message routing to pure functions                              │  │
│  │   - State management (if any) explicit                             │  │
│  │   - Capability token validation (G4)                               │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                    │                                     │
└────────────────────────────────────┼─────────────────────────────────────┘
                                     │
         ┌───────────────────────────┼───────────────────────────┐
         │                           │                           │
         ▼                           ▼                           ▼
┌─────────────────┐       ┌─────────────────┐       ┌─────────────────┐
│ LAYER 3: MCP    │       │ LAYER 3: CLI    │       │ LAYER 3: HTTP   │
│ Adapter (G7)    │       │ Adapter (G7)    │       │ Adapter (G7)    │
│                 │       │                 │       │                 │
│ - Optional      │       │ - Optional      │       │ - Optional      │
│ - Thin wrapper  │       │ - Thin wrapper  │       │ - Thin wrapper  │
│ - Protocol only │       │ - Protocol only │       │ - Protocol only │
└─────────────────┘       └─────────────────┘       └─────────────────┘
```

#### Self-Critique (The 25 Greats)

**Lamport**: "G3 claims algebraic composition, but do the current operators actually form an algebra? What are the identity elements? Has anyone verified associativity?"

**Response**: Add G3 (operator algebra tests) as P-blocker for claiming algebraic composition.

**Armstrong**: "G2's actor interface adds a layer. Layers add latency. Is this acceptable for all use cases?"

**Response**: The actor interface is for INTEGRATION. Direct pure function calls remain available for in-process use. The layer is optional.

**Pearl**: "G6 demands self-description. But self-description is expensive. Every primitive needs schema maintenance. Is this worth it?"

**Response**: Self-description enables semantic matching (T3) and emergent capability protocol (T5). The cost is amortized by the value of discoverability.

---

### ⚠️ Codex Verification Note

> **This document was reorganized on 2026-01-21.** The reorganization consolidated 9+ scattered roadmaps into one. If you suspect something was lost:
>
> 1. Check Part VIII (historical roadmap) — it still exists, marked as superseded
> 2. Check individual parts (XIV.F, XV.G, XVI.J, XVII, XVIII, XIX.O) — they retain their detailed specs
> 3. The old priorities (P24 Storage Split, P25 Transactions, B.1 Memory) are now P11-P13
> 4. **If in doubt, read the original parts** — this section is a summary, not a replacement
>
> The reorganization MERGED, not DELETED. Every implementation item from Parts XIV-XX should still exist in its original location.

### Why This Order?

1. **P0-P1**: Agents must be able to RUN before we add features
2. **P2**: Already done, just needs commit
3. **E1-E7 (Extraction)**: After P0-P1, extract LiBrainian as standalone package — including full Wave0 migration to the package boundary
4. **P3-P4**: Configuration enables safe experimentation (designed for standalone package)
5. **P5-P7**: Patterns make the system usable
6. **P8-P10**: Epistemics make the system smart
7. **P11-P13**: Infrastructure improvements
8. **P14-P18**: Theoretical breakthroughs (require data from running system)

**The extraction gate is critical**: LiBrainian must work as an independent GitHub package that anyone can `npm install`. Wave0-autopilot is ONE user of LiBrainian, not its only home.

### What Already Exists (6,000+ LOC)

> **Don't reinvent. Compose.**

| Layer | What Exists | Files | LOC |
|-------|-------------|-------|-----|
| **Core Types** | TechniquePrimitive, TechniqueComposition, TechniqueOperator | `strategic/techniques.ts` | ~400 |
| **Primitives Library** | 40+ technique primitives | `api/technique_library.ts` | ~800 |
| **Pattern Catalog** | 8 composition patterns | `api/pattern_catalog.ts` | ~950 |
| **Compositions** | 15+ pre-built compositions | `api/technique_compositions.ts` | ~600 |
| **Composition Builder** | Fluent API for building compositions | `api/technique_composition_builder.ts` | ~500 |
| **Operator Registry** | 6 operator types with interpreters | `api/operator_registry.ts`, `api/operator_interpreters.ts` | ~400 |
| **Execution Engine** | Technique execution with checkpointing | `api/technique_execution.ts` | ~600 |
| **Learning Loop** | Closed-loop outcome recording | `api/learning_loop.ts` | ~400 |
| **Confidence System** | Calibration tracking | `api/confidence_calibration.ts` | ~300 |
| **Context Assembly** | Session-based context management | `api/context_sessions.ts`, `api/context_assembly.ts` | ~500 |
| **Query Pipeline** | Multi-stage query processing | `api/query.ts` | ~400 |
| **Embeddings** | Sentence-transformer based | `api/embeddings.ts` | ~200 |

### The Master Sequence (Visual)

```
┌─────────────────────────────────────────────────────────────────────┐
│                     PHASE 0: FOUNDATION (NOW)                       │
│                                                                     │
│  ┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐   │
│  │ P0: LLM         │──▶│ P1: Operator    │──▶│ P2: Commit      │   │
│  │ Discovery       │   │ Execution       │   │ Selector        │   │
│  │ (Part XVI)      │   │ (Part XV)       │   │ (done)          │   │
│  └─────────────────┘   └─────────────────┘   └─────────────────┘   │
│                                                                     │
│  GATE: Agents can execute compositions end-to-end                   │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     EXTRACTION GATE (E1-E7)                         │
│                                                                     │
│     Remove ALL wave0 dependencies → Standalone npm package          │
│                                                                     │
│  GATE: `npm install librainian` works in any repo             │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                  PHASE 1: CONFIGURATION                             │
│                                                                     │
│  ┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐   │
│  │ P3: LCL Core    │──▶│ P4: Structure   │──▶│ P5: 8 New       │   │
│  │ (Part XIX.L)    │   │ Templates       │   │ Patterns        │   │
│  │                 │   │ (Part XIX.M)    │   │ (Part XVII.H)   │   │
│  └─────────────────┘   └─────────────────┘   └─────────────────┘   │
│                                                                     │
│  GATE: Declarative composition works                                │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                  PHASE 2: INTELLIGENCE                              │
│                                                                     │
│  ┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐   │
│  │ P6: Codebase    │──▶│ P7: Evolution   │──▶│ P8: Zero-Know   │   │
│  │ Advisor         │   │ Engine          │   │ Bootstrap       │   │
│  │ (Part XIV.C)    │   │ (Part XIV.D)    │   │ (Part XVIII.J)  │   │
│  └─────────────────┘   └─────────────────┘   └─────────────────┘   │
│                                                                     │
│  GATE: System learns and adapts                                     │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                  PHASE 3: THEORY (P14-P18)                          │
│                                                                     │
│     Self-Aware Oracle → Proof-Carrying Context → Causal Discovery   │
│                                                                     │
│  GATE: Theoretical breakthroughs implemented and calibrated         │
└─────────────────────────────────────────────────────────────────────┘
```

### Immediate Next Steps

```bash
# Step 0: Verify the package boundary gate (blocking)
cd packages/LiBrainian && npx tsc --noEmit
rg -n "src/(wave0|orchestrator)/" packages/LiBrainian/src || true

# Step 1: Verify repo gates (Tier-0 is the non-negotiable baseline)
npm run build && npm run test:tier0 && git status

# Step 2: Refresh P13–P18 evidence + choose post-theory priorities
# Review: packages/LiBrainian/src/api/learning_loop.ts, packages/LiBrainian/src/api/composition_selector.ts, packages/LiBrainian/src/api/plan_compiler.ts, packages/LiBrainian/src/api/proof_carrying_context.ts, packages/LiBrainian/src/api/causal_discovery.ts, packages/LiBrainian/src/api/bi_temporal_knowledge.ts, packages/LiBrainian/src/api/metacognitive_architecture.ts
# Draft: packages/LiBrainian/src/state/prediction_memory.ts (new, if durable evaluation needed)
```

### What NOT to Do

| Anti-Pattern | Why Bad | Instead |
|--------------|---------|---------|
| Skip to P14-P18 | Theory without working execution is useless | Complete P0-P7 first |
| Create new primitives | Explosion of complexity | Use existing 40+ primitives |
| Rewrite existing code | Wastes effort, introduces bugs | Compose existing infrastructure |
| Implement without tests | Can't verify correctness | Test first |
| Big-bang changes | Too many variables | One feature per commit |

---

## Universal Difficulty Detector Catalog (Agent-Default)

This section solves the problem: “An agent shouldn’t need to be a genius to notice hidden blockers (missing datasets, missing eval harness, migration hazards, perf cliffs, etc.) and to know the correct *class* of solutions.”

The fundamental move is to make “hard problems” **detectable** and to make the response **constructable**:
- Detectable: LiBrainian must fail-closed on unsupported claims and must surface *what evidence is missing*.
- Constructable: For each detected difficulty, LiBrainian emits a **remediation protocol** built from primitives/operators, plus **evidence commands**.

**Implementation hooks (where this must land in code)**
- Preflight extension point: `src/LiBrainian/preflight/checks.ts` (add “adequacy checks” for data/eval/rollbacks/observability per task type).
- Query pipeline integration: `src/LiBrainian/api/query.ts` (add an early stage that emits missing prerequisites as stage issues, and gates synthesis/claims accordingly).
- Planning integration: `src/LiBrainian/api/plan_compiler.ts` (prepend “adequacy gate nodes” so plans don’t skip prerequisites).
- Evidence persistence: `src/LiBrainian/state/verification_plans.ts`, `src/LiBrainian/state/episodes_state.ts` (store adequacy specs, regime suites, outcomes, and make them queryable).

### [DIFFICULTY_DETECTORS] Default Protocol: Run Before Doing Work

This is the minimal protocol LiBrainian should run automatically at the start of: bootstrap, query, and plan compilation (and agents should run it manually if not yet wired).

1. **Preflight** (environment/providers/filesystem/config): use the existing preflight framework (`src/LiBrainian/preflight/checks.ts`).
2. **Capability probe (tools/resources)**: if MCP (or any tool registry) is present, ingest its tool/resource descriptors into `[CAPABILITIES]` and record them as evidence (so “tool available” is a claimable fact).
3. **Adequacy scan** (`[ADEQUACY]`): infer what evidence is required for the task type (build/test/data/metrics/rollbacks) and check whether the repo can supply it now (including via external devices like CI/telemetry/dataset registries if available).
3. **Remediation emission**: produce a short remediation plan, expressed as compositions of primitives/operators with explicit gates.
4. **Fail-closed on strong claims**: if adequacy is missing, LiBrainian must not allow “works / verified / safe” claims; it should return `unverified_by_trace(adequacy_missing)` with the exact missing items.

### [ADEQUACY] Adequacy Spec (generic, portable)

Every task type should map to an explicit “adequacy spec” that declares what must be observed before LiBrainian can claim success.

Minimum shape:
- **Task intent**: what is being attempted (bugfix/feature/model validity/migration).
- **Claim boundary**: what claims are disallowed without evidence (e.g., “model works”, “migration safe”).
- **Evidence requirements**: concrete observations needed (tests, metrics, datasets, load tests, rollback plan).
- **Evidence sources**: local runs vs CI vs telemetry vs dataset registries vs attestations (stronger evidence sources should upgrade claims; missing sources must downgrade/defeat claims).
- **Degraded mode**: what LiBrainian can still do honestly when evidence is missing (e.g., “compile-only confidence”, “simulation-only risk bounds”).

### [SIMULATION] Preset (built from primitives): ML Model Validity Without Real Datasets (Weathervane-class)

Goal: if datasets are unavailable, LiBrainian should *still* help an agent build a meaningful evaluation substrate by constructing simulated regimes and disclosing what remains unverified.

**Detection signals (what LiBrainian can observe)**
- Training/eval code references dataset paths/URLs that don’t exist or aren’t present in repo config.
- Evaluation scripts exist but fail due to missing inputs.
- No ground-truth labeled data found; no fixtures for model evaluation.

**Remediation protocol (primitive-constructable)**
- `tp_extract_data_contract`: extract expected schema, constraints, and labeling assumptions from code/config.
- `tp_define_regime_matrix` (`[REGIME_MATRIX]`): define axes (brand archetypes, weather conditions, correlation regimes, noise/label error, distribution shift) and ranges.
- `tp_generate_simulated_dataset`: generate datasets per regime with reproducible seeds and logged parameters.
- `tp_run_eval_suite` (`[EVAL_SUITE]`): run model training/inference/evaluation across regimes; compute metrics + calibration + failure slices.
- `tp_report_adequacy_gaps`: report what remains unverified (e.g., “no real-world prevalence priors”, “unknown confounders”).

**Technique packaging (so agents don’t have to invent it)**
- Add a technique package (e.g., “`ml_evaluation`”) that bundles these primitives and at least one default composition (e.g., `tc_simulation_regime_eval`) so the plan compiler can select it when a repo appears ML-shaped but data is missing.
- Use `src/LiBrainian/api/technique_packages.ts` to surface the package, and ensure it is selectable by triggers derived from repo signals (training scripts, model artifacts, eval configs).
  - If a **dataset registry** adapter is available, the same package should add an optional “publish and compare” branch (publish simulated regime datasets, compare to real distributions when real data arrives).

**Quality bar**
- LiBrainian must not claim “model works” unless the adequacy spec includes either real data evidence or an explicit “simulation-only” bound with disclosed defeaters.

### [DIFFICULTY_DETECTORS] Catalog: 45 Common Hard Problems (cross-domain; no scenario hard-coding)

This catalog is intentionally scenario-agnostic: it enumerates *classes* of blockers that recur across projects, along with constructable remediation paths.

How to read:
- **Detection signals** must be repo-observable (code/tests/config/CI/errors), not “intuition”.
- **Remediation** must be expressible as compositions of primitives/operators (so the plan compiler can emit it).
- **Minimum evidence** is what allows LiBrainian to move from “helpful suggestion” to “strong claim”.

#### Detector record (conceptual; implement as declarative data)

Each detector should be representable as a record (like a primitive/pattern) so it can be stored, evolved, and selected:
- `id`, `name`, `category`
- `signals`: repo-observable predicates (files, config, error strings, pipeline stage issues)
- `remediationCompositionIds`: suggested compositions (with optional variants)
- `adequacySpecRef`: what claims are gated and what evidence is required
- `evidenceCommands`: runnable commands to validate progress

#### A) ML / Data / Analytics (10)

| Difficulty | Detection signals (repo-observable) | Default remediation composition (constructable) | Minimum evidence for strong claims |
|-----------|--------------------------------------|-----------------------------------------------|-----------------------------------|
| Missing datasets / missing labels | Missing data paths; failing eval scripts; no fixtures | `[SIMULATION]` protocol + labeling plan | Regime suite results + (eventual) real data eval |
| Distribution shift / drift risk | Seasonality/time features; unstable slice metrics | Shift detector + slice eval | Slice metrics over time/regimes |
| Metric mis-specification | No metric contract; conflicting metrics | Metric selection + calibration suite | Metric report + calibration curves |
| Data leakage | Time joins; “too-good” eval; target leakage features | Leakage scan + enforced splits | Leakage tests + corrected eval |
| Label noise / weak supervision | Heuristic labels; low inter-annotator agreement | Noise model + audit sampling plan | Audited samples + robustness eval |
| Reproducibility gaps | Flaky eval; random seeds missing | Repro harness + seed discipline | Repro logs + stable outputs |
| Offline/online feature mismatch | Separate feature codepaths | Parity checks + snapshot tests | Parity suite passes |
| Uncalibrated confidence | Probabilities used as truth | Calibration harness + threshold typing | Calibration evidence + typed thresholds |
| Data pipeline integrity | Silent drops/dupes | Lineage + invariants + checks | Row invariants + audits |
| Privacy/PII in training data | PII flows in ingestion | Redaction + data classification | PII scan + redaction evidence |

#### B) Backend / APIs / Distributed Systems (12)

| Difficulty | Detection signals (repo-observable) | Default remediation composition (constructable) | Minimum evidence for strong claims |
|-----------|--------------------------------------|-----------------------------------------------|-----------------------------------|
| Missing contract tests | No integration/contract suite | Contract tests + mock servers | Contract suite results |
| Idempotency missing | Retries + side effects | Idempotency keys + dedupe layer | Replay tests + invariant proofs |
| Retry storms / thundering herd | Unbounded retries; synchronized timers | Backoff + jitter + circuit breaker | Load test evidence + error budgets |
| Backpressure absent | Queue growth; timeouts | Queue limits + shedding policy | Saturation tests + SLOs |
| Cache invalidation bugs | Stale reads; inconsistent behavior | Cache strategy + invalidation events | Cache correctness tests |
| Race conditions | Shared state; async hazards | Stress harness + locking discipline | Stress run + race reproducer |
| Partial failure handling | Missing timeouts; hanging requests | Timebox + fallback + bulkheads | Fault-injection results |
| Event ordering assumptions | Consumer bugs; reordering | Sequence numbers + reorder buffer | Property tests + chaos runs |
| Exactly-once myth | “exactly once” claims in docs | At-least-once semantics + dedupe | Evidence-backed semantics + tests |
| Hot partitions | Skewed keys; DB hotspots | Sharding/partitioning plan | Load distribution evidence |
| Clock skew/time semantics | TTL/expiry bugs; drift | Monotonic time + safety margins | Time travel tests + logs |
| Schema compatibility across services | Version mismatches | Compatibility matrix + canary | Matrix run evidence |

#### C) Infra / DevOps / Release Engineering (11)

| Difficulty | Detection signals (repo-observable) | Default remediation composition (constructable) | Minimum evidence for strong claims |
|-----------|--------------------------------------|-----------------------------------------------|-----------------------------------|
| Build/typecheck gates red | Compile errors; build failures | Gate-first protocol | Build+typecheck green |
| Flaky CI | Non-deterministic tests | Flake quarantine + stabilizers | Flake rate reduced + evidence |
| Dependency/supply-chain risk | Unpinned deps; unsafe scripts | Lockfile policy + audits | Audit report + pinned deps |
| Environment drift | “works on my machine” | Devcontainer/toolchain pinning | Repro build evidence |
| No rollback strategy | Migrations without rollback | Rollout + rollback plan | Rollback tested + canary |
| Zero-downtime migrations | DB schema changes | Expand/contract templates | Dual-read/write evidence |
| Missing observability | No traces/logging | Instrumentation + stage reporting | Trace evidence for key flows |
| Incident response gaps | No runbooks/oncall hooks | Runbooks + alerts + drills | Drill results + dashboards |
| Capacity planning absent | Unknown limits | Load test suite + perf budgets | Capacity report + SLOs |
| Cost blowups | Unbounded LLM/tool usage | Budget caps + governor policies | Budget telemetry + enforcement |
| Release safety missing | No canary/feature flags | Progressive delivery templates | Canary evidence + kill switch |

#### D) Security / Compliance / Trust Boundaries (7)

| Difficulty | Detection signals (repo-observable) | Default remediation composition (constructable) | Minimum evidence for strong claims |
|-----------|--------------------------------------|-----------------------------------------------|-----------------------------------|
| Secrets exposure | Tokens in logs/config | Redaction + secret scanning | Scan report + fixes |
| Injection risks | String interpolation; unsafe eval | Sanitization + taint checks | Security tests + audit |
| SSRF/path traversal | User-controlled URLs/paths | Allowlist + path containment | Exploit tests blocked |
| AuthZ edge cases | Multi-tenant/RBAC complexity | Policy tests + scenario generator | Policy suite coverage |
| Data retention/compliance | No retention policy | Data lifecycle + audits | Retention tests + policy docs |
| Auditability missing | No audit logs | Audit log events + storage | Audit queries + integrity |
| Threat model absent | No explicit boundaries | Threat modeling primitive + checklist | Reviewed model + mitigations |

#### E) Product / UX / Docs / Developer Experience (5)

| Difficulty | Detection signals (repo-observable) | Default remediation composition (constructable) | Minimum evidence for strong claims |
|-----------|--------------------------------------|-----------------------------------------------|-----------------------------------|
| Documentation drift | Docs disagree with code | Reconcile + evidence commands | Updated evidence commands |
| Poor onboarding | No “start here”; unclear flows | Onboarding guide + guided reading order | Onboarding checklist passes |
| Accessibility gaps | No a11y tests; semantic issues | A11y audit + regression tests | A11y suite results |
| Internationalization gaps | Hardcoded strings; no locale infra | i18n framework + extraction | Locale tests + coverage |
| “Tests pass but prove nothing” | Shallow tests; missing invariants | Strengthen verification plan | Evidence-linked verifications |

### [DIFFICULTY_DETECTORS] Prebuilt Packs (optional; common, reusable)

Keep scenario-agnostic by shipping a small number of **packs** (bundles of detectors + primitives + compositions) that are widely applicable:
- `pack_ml_adequacy`: adequacy spec + `[SIMULATION]` + calibration + leakage/shift detectors.
- `pack_release_safety`: rollout/rollback, migrations (expand/contract), canary, incident/runbooks.
- `pack_distributed_resilience`: timeouts/retries/backpressure, ordering, idempotency, fault-injection.
- `pack_security_baseline`: secrets/redaction, trust boundaries, authz scenario tests, auditability.
- `pack_perf_budgeting`: benchmarks, profiling, load tests, capacity/cost budgets (including governor policies).
- `pack_tooling_mcp`: tool/resource capability ingestion + tool-call evidence emission (so tool usage is auditable and supports claims).
- `pack_provenance_attestation`: signed build/test/eval artifacts (when available) to upgrade evidence strength for “verified” claims.
- `pack_replay_determinism`: record/replay substrate integration (when available) to upgrade reproducibility and regression falsifiability.

Packs should be exposed via `src/LiBrainian/api/technique_packages.ts` so agents can select them by repo signals, and each pack must include explicit adequacy gating (what it can/cannot claim without evidence).

**Degradation rule (non-negotiable)**: if minimum evidence is missing, LiBrainian must output a *bounded* claim and the exact next evidence to collect.

## How Parts Relate (Dependency Graph)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         DOCUMENT STRUCTURE                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  THEORY (Read for Understanding)          PRACTICE (Read for Implementation)│
│  ─────────────────────────────           ──────────────────────────────────│
│                                                                              │
│  ┌─────────────┐                         ┌─────────────────────────────────┐│
│  │ Parts I-IV  │                         │ Implementation Status (top)     ││
│  │ Theoretical │                         │ + What to Implement Next        ││
│  │ Problems    │                         │ ═══════════════════════════════ ││
│  └──────┬──────┘                         │ PRIMARY NAVIGATION INDEX        ││
│         │                                └─────────────────────────────────┘│
│         ▼                                               │                    │
│  ┌─────────────┐                                        │                    │
│  │ Part X      │                                        ▼                    │
│  │ All Problems│◀─────────────────────────────┐  ┌─────────────┐            │
│  │ Summary     │                              │  │ Part XX     │            │
│  └─────────────┘                              │  │ Master      │            │
│                                               │  │ Roadmap     │            │
│  ┌─────────────┐                              │  └──────┬──────┘            │
│  │ Part VI     │                              │         │                    │
│  │ Use Cases   │                              │         ▼                    │
│  │ (20 total)  │                              │  ┌─────────────┐            │
│  └─────────────┘                              │  │ Parts XIV-  │            │
│                                               │  │ XVI: Specs  │────────────┤
│  ┌─────────────┐                              │  └──────┬──────┘            │
│  │ Part XI     │                              │         │                    │
│  │ GitHub      │                              │         ▼                    │
│  │ Excellence  │                              │  ┌─────────────┐            │
│  └─────────────┘                              │  │ Part XIX    │            │
│                                               │  │ LCL Config  │            │
│  ┌─────────────┐                              │  │ Language    │            │
│  │ Part XII    │                              │  └──────┬──────┘            │
│  │ Cutting-    │                              │         │                    │
│  │ Edge Theory │                              │         ▼                    │
│  └─────────────┘                              │  ┌─────────────┐            │
│                                               │  │ Parts XVII- │            │
│  ┌─────────────┐                              └──│ XVIII:      │            │
│  │ Parts VII-  │─────────────────────────────────│ Extensions  │            │
│  │ IX: Problems│                                 └─────────────┘            │
│  │ & Solutions │                                                             │
│  └─────────────┘                                                             │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Cross-References Between Parts

| Part | Implements Solutions From | Depends On |
|------|--------------------------|------------|
| XIV | Problems 19, 37, Critical C | Parts V, VII |
| XV | Critical A (partial) | Part VII |
| XVI | Problems 21, 23 | Parts V, VII |
| XVII | Problems 1, 5, 6, 18 | Parts I, II, V |
| XVIII | Problems 43-56 | Parts I-IV, XII |
| XIX | All of above | Parts XIV-XVIII |
| XX | Consolidation | All parts |

---

## Part I: Computational Theoretical Problems

### Problem 1: Undefined DSL Semantics

**The Issue**

The technique primitives (`clarify_goal`, `hypothesis`, `bisect`, `root_cause`) and operators (`sequence`, `parallel`, `quorum`) form a domain-specific language without formal semantics.

- What is the **type signature** of `hypothesis`?
- What is the **state transformation** of `sequence(A, B)`?
- What are the **preconditions and postconditions** of each primitive?
- Is the DSL **Turing-complete**? If yes, verification becomes undecidable.

Without formal semantics, "composition" is syntactic sugar over undefined operations.

**Direct Solution**

Define an operational semantics for techniques:

```typescript
interface TechniqueSemantics<Input, Output, State> {
  /** Preconditions that must hold before execution */
  preconditions: (state: State, input: Input) => boolean;

  /** The state transformation function */
  transform: (state: State, input: Input) => { state: State; output: Output };

  /** Postconditions guaranteed after execution */
  postconditions: (state: State, output: Output) => boolean;

  /** Termination guarantee (if any) */
  terminates: 'always' | 'conditional' | 'unknown';

  /** Computational complexity class */
  complexity: 'O(1)' | 'O(n)' | 'O(n^2)' | 'unbounded';
}
```

For operators, define composition rules:

```typescript
// Sequence: B's preconditions must be derivable from A's postconditions
type Sequence<A, B> = A['postconditions'] extends B['preconditions'] ? Valid : TypeError;

// Parallel: A and B must have non-interfering state access
type Parallel<A, B> = Disjoint<A['writes'], B['writes']> ? Valid : RaceCondition;
```

**Propagating Impact of the Problem**

Without semantics, the following downstream systems are compromised:

| Affected System | How Compromised |
|----------------|-----------------|
| Composition validation | Cannot verify compositions are well-formed |
| Verification planning | Cannot derive verification conditions from technique specs |
| Episode learning | Cannot attribute outcomes to technique steps |
| Plan compilation | Compiling to "work templates" is heuristic, not principled |

**Propagating Impact of the Solution**

Formalizing semantics enables:

| Enabled Capability | How |
|-------------------|-----|
| Static verification | Type-check compositions at definition time |
| Automatic precondition inference | Derive what context a technique needs |
| Complexity analysis | Bound execution resources |
| Modular reasoning | Reason about techniques independently |

**Second-Order Solution**

Once semantics exist, build a **technique type-checker** that:
1. Rejects ill-formed compositions at definition time
2. Infers minimal preconditions for each composition
3. Computes worst-case complexity bounds
4. Flags non-terminating compositions

---

### Problem 2: RAG Information Bottleneck

**The Issue**

LiBrainian is sophisticated RAG (Retrieval-Augmented Generation), but RAG has a fundamental information-theoretic limit: **retrieval is a lossy compression**.

If relevant context wasn't retrieved, synthesis cannot recover it. The system can only reason about what was retrieved. This creates:

1. **Silent omission**: The system doesn't know what it didn't retrieve
2. **Confident incompleteness**: High confidence on incomplete context
3. **Irreducible error floor**: No amount of synthesis improvement helps

**Direct Solution**

Implement **retrieval uncertainty quantification**:

```typescript
interface RetrievalResult {
  retrieved: ContextPack[];

  /** Estimated probability that something relevant was missed */
  missRate: number;

  /** What query variations were tried */
  queryExpansions: string[];

  /** Coverage estimate: what fraction of relevant corpus was searched */
  coverageEstimate: number;

  /** Alternative retrieval strategies not yet tried */
  unexploredStrategies: RetrievalStrategy[];
}
```

Compute `missRate` from:
- Query-embedding similarity distribution (fat tail = high miss rate)
- Number of near-threshold results (many = borderline relevant content exists)
- Historical miss rates for similar queries

**Propagating Impact of the Problem**

| Affected System | How Compromised |
|----------------|-----------------|
| Confidence scoring | Overstates confidence (doesn't account for retrieval gaps) |
| Agent decision-making | Acts on incomplete context without knowing |
| Verification | Cannot verify claims about un-retrieved code |
| Learning | Misattributes failures (blamed synthesis when retrieval failed) |

**Propagating Impact of the Solution**

Quantifying retrieval uncertainty enables:

| Enabled Capability | How |
|-------------------|-----|
| Conservative confidence | `effective_confidence = synthesis_confidence * (1 - missRate)` |
| Targeted re-retrieval | When `missRate` high, try alternative strategies |
| Honest disclaimers | "This answer based on ~60% estimated coverage" |
| Better learning | Attribute failures correctly between retrieval and synthesis |

**Second-Order Solution**

Build an **iterative retrieval loop**:
1. Initial retrieval with `missRate` estimate
2. If `missRate > threshold`, expand query and re-retrieve
3. If coverage still low, escalate with "low confidence due to retrieval limits"
4. Track which queries have high miss rates for indexing improvements

---

### Problem 3: Expressiveness vs. Decidability Tradeoff

**The Issue**

The technique DSL includes operators like `loop`, `conditional`, and compositions that can reference other compositions. This likely makes the DSL **Turing-complete**.

If Turing-complete:
- Termination is undecidable
- Verification of compositions is undecidable
- Resource bounds cannot be statically computed

If not Turing-complete:
- What is the expressiveness class?
- What can't be expressed?

**Direct Solution**

Explicitly stratify the DSL into decidable sublanguages:

```typescript
type TechniqueStratum =
  | 'finite'      // No loops, no recursion - always terminates
  | 'bounded'     // Loops with static bounds - terminates with known bound
  | 'productive'  // May not terminate but always makes progress
  | 'unrestricted'; // Full expressiveness, no guarantees

interface TechniqueComposition {
  stratum: TechniqueStratum;

  // Stratum-specific metadata
  finiteBound?: number;          // For 'finite' and 'bounded'
  progressMetric?: string;       // For 'productive'
  timeoutPolicy?: TimeoutPolicy; // For 'unrestricted'
}
```

Enforce stratum constraints:
- `finite` compositions: no `loop`, `retry`, or recursive references
- `bounded` compositions: loops must have explicit iteration limits
- `productive` compositions: must emit observable progress each iteration
- `unrestricted` compositions: must have timeout policies

**Propagating Impact of the Problem**

| Affected System | How Compromised |
|----------------|-----------------|
| Plan compilation | Cannot guarantee compiled plans terminate |
| Resource budgeting | Cannot predict token/time costs |
| Safety properties | Cannot verify safety for non-terminating plans |
| Testing | Cannot bound test execution time |

**Propagating Impact of the Solution**

Stratification enables:

| Enabled Capability | How |
|-------------------|-----|
| Static termination proofs | For `finite` and `bounded` strata |
| Resource prediction | Compute bounds for `bounded` stratum |
| Graceful timeouts | Principled handling for `unrestricted` |
| Verification tiering | Decide verification depth based on stratum |

---

### Problem 4: Graph Metrics as Heuristic Proxies

**The Issue**

LiBrainian computes graph metrics (coupling, cohesion, cyclomatic complexity, etc.) and uses them for quality assessment. But:

- These metrics are **domain-agnostic proxies**, not direct quality measures
- High coupling isn't always bad (tight cohesion in a bounded context)
- Low complexity isn't always good (may indicate missing error handling)
- Thresholds are arbitrary without domain calibration

**Direct Solution**

Implement **domain-contextualized metrics**:

```typescript
interface DomainContext {
  /** Type of code: library, application, infrastructure, etc. */
  codeType: 'library' | 'application' | 'infrastructure' | 'test';

  /** Domain-specific norms */
  norms: {
    expectedCoupling: { min: number; max: number };
    expectedComplexity: { min: number; max: number };
    /** Violations that are acceptable in this domain */
    allowedViolations: string[];
  };

  /** Historical distribution of metrics in this codebase */
  empiricalDistribution: Map<string, Distribution>;
}

function assessQuality(
  metrics: CodeMetrics,
  domain: DomainContext
): QualityAssessment {
  // Compare to domain norms, not absolute thresholds
  // Flag anomalies relative to this codebase's distribution
}
```

**Propagating Impact**

Without domain context, quality signals are noisy. With it:
- Fewer false positives ("high coupling" that's actually correct for domain)
- More actionable recommendations (relative to local norms)
- Better learning (outcomes contextualized by domain)

---

## Part II: Epistemological and Philosophical Errors

### Problem 5: Time Decay Fallacy

**The Issue**

The current confidence decay model uses wall-clock time as the primary decay factor:

```typescript
// Current: decays 1% per hour regardless of activity
const decayedConfidence = initialConfidence * Math.pow(0.99, hoursSinceIndexed);
```

This is epistemologically wrong. Time is a **proxy variable**, not the causal factor. The actual causal structure:

```
Confidence decay ← Invalidation events ← {
  - Code changes in dependency graph
  - External API evolution
  - Requirement drift
  - New information discovery
}
```

A dormant system has zero invalidation events regardless of elapsed time. An actively modified system accumulates invalidation events rapidly. Time only correlates with these in expectation over many systems—not for any specific system.

**The irony**: The system already has `invalidationTriggers` on context packs. It knows the right model but doesn't use it for confidence.

**Direct Solution**

Replace time-based decay with **change-graph-based decay**:

```typescript
interface ChangeBasedDecay {
  /** Primary decay driver: changes in dependency graph */
  dependencyChanges: {
    /** Direct changes to this entity */
    directChanges: number;
    /** Changes to entities this depends on, weighted by coupling */
    upstreamChanges: WeightedChange[];
    /** Changes to entities that depend on this, weighted by coupling */
    downstreamChanges: WeightedChange[];
  };

  /** Secondary: external environment changes */
  environmentChanges: {
    /** Dependency version updates */
    dependencyUpdates: string[];
    /** API changes in external services */
    externalApiChanges: string[];
  };

  /** Tertiary: time (weak prior when no change data available) */
  timeSinceValidation: number;
  /** Weight for time factor: 0 if change data available, higher if not */
  timeWeight: number;
}

function computeDecay(entity: KnowledgeEntity, changes: ChangeBasedDecay): number {
  // Primary: change-based decay
  const changeFactor = computeChangeFactor(changes.dependencyChanges);

  // Secondary: environment drift
  const envFactor = computeEnvFactor(changes.environmentChanges);

  // Tertiary: time (only if change data unavailable)
  const timeFactor = changes.timeWeight > 0
    ? computeTimeFactor(changes.timeSinceValidation)
    : 1.0;

  return entity.confidence * changeFactor * envFactor * timeFactor;
}
```

**Propagating Impact of the Problem**

| Affected System | How Compromised |
|----------------|-----------------|
| Stale knowledge detection | Dormant-but-valid knowledge falsely marked stale |
| Re-indexing prioritization | Time-based triggers waste resources on unchanged code |
| Agent trust | Agents distrust valid old knowledge |
| Learning attribution | Time confounds learning about what actually invalidates knowledge |

**Propagating Impact of the Solution**

| Enabled Capability | How |
|-------------------|-----|
| Accurate staleness | Knowledge decays when code changes, not when clocks tick |
| Efficient re-indexing | Only re-index what changed and its dependents |
| Stable knowledge | Long-lived stable code maintains high confidence |
| Causal learning | Learn what actually invalidates knowledge |

**Second-Order Solution**

Build a **change propagation engine**:
1. Watch for file system changes
2. Compute change impact through dependency graph
3. Apply decay proportional to coupling strength
4. Log decay reasons for causal learning

**World-Class Enhancement: Git-Grounded Confidence (Masters' Synthesis)**

*"Time is not the signal. Git history is the signal. Every commit is a vote of confidence or doubt."* — Synthesis of Knuth, Lamport, Norvig

The change-based decay above is correct, but it can be made **world-class** by grounding confidence in git history rather than abstract change counts:

```typescript
/**
 * Git-grounded confidence: every pattern's confidence is backed by
 * observable git signals, not heuristics.
 *
 * INVARIANT: confidence ∈ [0,1] ∧ calibrated(confidence) ⟹
 *            P(correct | confidence) ≈ confidence
 */
interface GitGroundedConfidence {
  /** Base confidence from extraction quality */
  readonly extractionConfidence: BrandedConfidence;

  /** Git history signals that modulate confidence */
  readonly gitSignals: {
    /** How often was this code reverted? High revert rate → low confidence */
    revertRate: number;

    /** Survival curve: P(no change | t) estimated from commit history */
    survivalCurve: SurvivalFunction;

    /** Bugfix rate in this region: high bugfix rate → lower confidence */
    bugfixRate: number;

    /** Author expertise: weighted by commit history in this domain */
    authorExpertise: number;

    /** Review depth: how many reviewers, how long review took */
    reviewDepth: number;
  };

  /** Calibrated confidence: adjusted by feedback loop */
  readonly calibrated: BrandedConfidence;

  /** Calibration metadata for introspection */
  readonly calibrationMeta: {
    sampleSize: number;
    lastCalibrated: Timestamp;
    calibrationMethod: 'platt' | 'isotonic' | 'beta';
    brier: number; // Brier score for calibration quality
  };
}

/** Branded type prevents confusion with raw numbers */
type BrandedConfidence = number & {
  readonly __brand: unique symbol;
  readonly __range: '[0,1]';
  readonly __calibrated: true;
};

function createConfidence(raw: number): BrandedConfidence {
  if (raw < 0 || raw > 1) {
    throw new Error(`Confidence must be in [0,1], got ${raw}`);
  }
  return raw as BrandedConfidence;
}

/**
 * Compute git-grounded confidence for a pattern.
 *
 * COMPLEXITY: O(log n) with cached git stats, O(n) cold
 * INVARIANT: result.calibrated approximates true P(correct)
 */
async function computeGitGroundedConfidence(
  pattern: Pattern,
  gitHistory: GitHistoryCache,
  calibrator: ConfidenceCalibrator
): Promise<GitGroundedConfidence> {
  const file = pattern.location.file;
  const range = pattern.location.range;

  // Query cached git statistics for this region
  const stats = await gitHistory.getRegionStats(file, range);

  // Compute survival probability: P(unchanged | elapsed time)
  const survivalP = stats.survivalCurve.evaluate(Date.now() - pattern.extractedAt);

  // Combine signals using learned weights
  const rawConfidence = combineSignals({
    extraction: pattern.extractionConfidence,
    survival: survivalP,
    revertPenalty: 1 - stats.revertRate,
    bugfixPenalty: 1 - Math.min(stats.bugfixRate * 0.5, 0.5),
    expertiseBonus: Math.min(stats.authorExpertise * 0.1, 0.2),
    reviewBonus: Math.min(stats.reviewDepth * 0.05, 0.1),
  });

  // Calibrate using Platt scaling (Norvig's recommendation)
  const calibrated = calibrator.calibrate(rawConfidence);

  return {
    extractionConfidence: pattern.extractionConfidence,
    gitSignals: stats,
    calibrated,
    calibrationMeta: calibrator.getMeta(),
  };
}

/**
 * TLA+ Specification for Confidence Decay (Lamport's requirement)
 *
 * This specification is model-checkable and guarantees:
 * 1. Confidence never increases without evidence
 * 2. Confidence is monotonically decreasing given only decay events
 * 3. Confidence can increase on positive feedback
 * 4. Calibration error is bounded
 */
const CONFIDENCE_TLA_SPEC = `
---- MODULE ConfidenceDecay ----
EXTENDS Reals, Sequences

CONSTANTS MinConfidence, MaxConfidence, DecayRate
VARIABLES confidence, lastValidated, changeCount

TypeInvariant ==
  /\\ confidence \\in [MinConfidence..MaxConfidence]
  /\\ lastValidated \\in Nat
  /\\ changeCount \\in Nat

Init ==
  /\\ confidence = MaxConfidence
  /\\ lastValidated = 0
  /\\ changeCount = 0

Decay(changes) ==
  /\\ changeCount' = changeCount + changes
  /\\ confidence' = Max(MinConfidence,
       confidence * (1 - DecayRate) ^ changes)
  /\\ UNCHANGED lastValidated

Validate ==
  /\\ lastValidated' = Now
  /\\ changeCount' = 0
  /\\ UNCHANGED confidence

PositiveFeedback(boost) ==
  /\\ confidence' = Min(MaxConfidence, confidence + boost)
  /\\ UNCHANGED <<lastValidated, changeCount>>

MonotonicDecay ==
  [][confidence' =< confidence \\/ PositiveFeedback]_confidence

====
`;
```

**Performance Note (Carmack)**: The git history cache should use memory-mapped storage and SIMD-accelerated range queries. Target: <1ms for cached lookups, <10ms for cold lookups on 100K commit histories.

---

### Problem 6: Confidence Monism

**The Issue**

The system applies one confidence model uniformly across all knowledge types. But knowledge types have radically different epistemic profiles:

| Knowledge Type | Stability | Verification Method | Decay Profile |
|----------------|-----------|---------------------|---------------|
| Syntactic (AST structure) | Very high | Deterministic parsing | Only decays on file change |
| Behavioral (what code does) | High | Testing | Decays on code/test changes |
| Intentional (why it was written) | Medium | Author query, commits | Decays on requirement changes |
| Normative (is it good) | Low, contextual | Contested | Decays on standard changes |
| Predictive (how it will evolve) | Very low | Speculation | Always low confidence |

A confidence score of 0.7 means completely different things for "this function returns a string" vs. "this architecture was chosen for scalability."

**Direct Solution**

Implement **type-stratified confidence**:

```typescript
type KnowledgeType =
  | 'syntactic'   // Structure, types, names
  | 'behavioral'  // What code does
  | 'intentional' // Why code was written
  | 'normative'   // Quality judgments
  | 'predictive'; // Future evolution

interface TypedConfidence {
  type: KnowledgeType;
  raw: number;

  /** Type-specific calibration */
  calibrated: number;

  /** Type-specific decay model */
  decayModel: DecayModel;

  /** Type-specific verification method */
  verificationMethod: VerificationMethod;

  /** Semantic interpretation of confidence levels for this type */
  interpretation: ConfidenceInterpretation;
}

const CONFIDENCE_INTERPRETATIONS: Record<KnowledgeType, ConfidenceInterpretation> = {
  syntactic: {
    0.9: 'AST-verified, file unchanged',
    0.7: 'AST-verified, file recently changed',
    0.5: 'Inferred from context',
    0.3: 'Heuristic match',
  },
  behavioral: {
    0.9: 'Test-verified, tests passing',
    0.7: 'Test-inferred, no direct test',
    0.5: 'Static analysis inference',
    0.3: 'LLM synthesis only',
  },
  intentional: {
    0.9: 'Explicit documentation/commit message',
    0.7: 'Consistent with multiple sources',
    0.5: 'Single source inference',
    0.3: 'Speculative interpretation',
  },
  // ... etc
};
```

**Propagating Impact**

Without type stratification:
- Agents can't interpret what 0.7 confidence means
- Learning conflates different knowledge types
- Verification methods don't match knowledge types

With type stratification:
- Agents know how to interpret confidence for each knowledge type
- Verification appropriately matched (don't try to "test" intentional knowledge)
- Learning tracks calibration per type

**World-Class Enhancement: Epistemic Type Algebra (Masters' Synthesis)**

*"A confidence score without semantic interpretation is just a random number. The type system must enforce the difference."* — Synthesis of Hejlsberg, Liskov, Hoare

The type-stratified confidence above is correct, but world-class implementation requires:

```typescript
/**
 * EPISTEMIC TYPE ALGEBRA
 *
 * Each knowledge type forms a partially ordered set under refinement.
 * Operations on confidence must respect type boundaries.
 *
 * ALGEBRAIC PROPERTIES (Hoare's requirement):
 * - Combining confidences of different types requires explicit coercion
 * - Syntactic confidence can only decrease (AST-verified → inferred)
 * - Behavioral confidence requires test evidence for increase
 * - Intentional confidence degrades faster without documentation
 * - Normative confidence is inherently contested (multi-valued logic)
 * - Predictive confidence has Bayesian update semantics
 */

/** Discriminated union prevents type confusion at compile time (Hejlsberg) */
type TypedConfidenceValue =
  | { readonly kind: 'syntactic'; readonly c: SyntacticConfidence }
  | { readonly kind: 'behavioral'; readonly c: BehavioralConfidence }
  | { readonly kind: 'intentional'; readonly c: IntentionalConfidence }
  | { readonly kind: 'normative'; readonly c: NormativeConfidence }
  | { readonly kind: 'predictive'; readonly c: PredictiveConfidence };

/** Each type has its own branded confidence to prevent mixing */
type SyntacticConfidence = number & { __syntactic: true };
type BehavioralConfidence = number & { __behavioral: true };
type IntentionalConfidence = number & { __intentional: true };
type NormativeConfidence = number & { __normative: true };
type PredictiveConfidence = number & { __predictive: true };

/**
 * DECAY FUNCTIONS ARE TYPE-SPECIFIC (McCarthy's requirement)
 *
 * Each knowledge type has a learned decay function that captures
 * its unique epistemic profile.
 */
interface TypeSpecificDecay<T extends TypedConfidenceValue['kind']> {
  /** The decay function, learned from outcomes */
  decay: (
    current: ConfidenceByKind<T>,
    signal: DecaySignal
  ) => ConfidenceByKind<T>;

  /** Feature extractor for this knowledge type */
  features: (pattern: Pattern) => DecayFeatures;

  /** Learning rate for updating the decay model */
  learningRate: number;

  /** Regularization to prevent overfitting */
  regularization: 'l1' | 'l2' | 'elastic';
}

/**
 * VERIFICATION METHODS ARE TYPE-APPROPRIATE (Liskov's requirement)
 *
 * Behavioral substitution principle: verification methods
 * must be substitutable within their knowledge type.
 */
const VERIFICATION_METHODS: Record<KnowledgeType, VerificationProtocol> = {
  syntactic: {
    verify: async (claim) => {
      // Parse file, verify AST matches claim
      const ast = await parseFile(claim.location.file);
      return astMatches(ast, claim);
    },
    confidence: (result) => result.matched ? 1.0 : 0.0,
    canAutomate: true,
  },
  behavioral: {
    verify: async (claim) => {
      // Run relevant tests, check coverage
      const tests = await findRelevantTests(claim.location);
      const results = await runTests(tests);
      return { passed: results.allPassed, coverage: results.coverage };
    },
    confidence: (result) =>
      result.passed ? Math.min(0.9, 0.5 + result.coverage * 0.4) : 0.3,
    canAutomate: true,
  },
  intentional: {
    verify: async (claim) => {
      // Check commits, docs, PRs for supporting evidence
      const evidence = await gatherIntentEvidence(claim);
      return evidence;
    },
    confidence: (result) =>
      result.sources.length > 2 ? 0.8 :
      result.sources.length > 0 ? 0.6 : 0.3,
    canAutomate: false, // May require human judgment
  },
  normative: {
    verify: async (claim) => {
      // Normative claims are inherently contested
      // Return multiple perspectives with their confidence
      const perspectives = await gatherPerspectives(claim);
      return { contested: true, perspectives };
    },
    confidence: (result) => 0.5, // Contested by nature
    canAutomate: false,
  },
  predictive: {
    verify: async (claim) => {
      // Predictions are verified by outcomes
      // If no outcome yet, return prior
      const outcome = await checkOutcome(claim);
      return outcome ?? { pending: true };
    },
    confidence: (result) =>
      result.pending ? 0.5 : result.correct ? 0.9 : 0.1,
    canAutomate: true, // After outcome known
  },
};

/**
 * TLA+ SPECIFICATION FOR TYPE SAFETY (Lamport/Dijkstra)
 *
 * Model-checkable guarantee that types are never confused.
 */
const TYPE_SAFETY_TLA = `
---- MODULE EpistemicTypeSafety ----
EXTENDS Naturals

CONSTANTS KnowledgeTypes, ConfidenceRange
VARIABLES confidence, knowledgeType

TypeSafety ==
  \\A k \\in Knowledge:
    /\\ k.confidence.kind = k.type
    /\\ k.verification \\in ValidVerifications(k.type)

NoTypeMixing ==
  \\A op \\in Operations:
    op.left.type = op.right.type =>
      op.result.type = op.left.type

CombinationRequiresCoercion ==
  \\A op \\in Operations:
    op.left.type /= op.right.type =>
      op \\in CoercingOperations

====
`;
```

**Calibration Curves Per Type (Norvig's requirement)**: Each knowledge type should have its own calibration curve, trained on that type's historical accuracy. Use isotonic regression for well-sampled types, Platt scaling for sparse types.

---

### Problem 7: Provenance Regress

**The Issue**

The system tracks provenance: every knowledge piece records its source. But when LLM-synthesized knowledge depends on earlier LLM-synthesized knowledge, provenance becomes a chain with no ground.

```
K3 ← synthesized from K2
K2 ← synthesized from K1
K1 ← synthesized from code snippet S
S ← extracted from file F
```

Where's the grounding? S is text, not semantic content. The jump from S to K1 is where *meaning* is injected, and that's the LLM doing synthesis from training distribution. The provenance chain traces **processing history**, not **justification**.

**Direct Solution**

Distinguish **processing provenance** from **epistemic justification**:

```typescript
interface ProcessingProvenance {
  /** Where did this come from procedurally? */
  source: ProvenanceSource;
  /** When was it processed? */
  timestamp: Date;
  /** What model/version processed it? */
  processor: ProcessorInfo;
}

interface EpistemicJustification {
  /** What grounds this claim? */
  grounds: Grounds[];

  /** What type of grounding? */
  groundingType:
    | 'empirical'      // Verified by running code/tests
    | 'analytical'     // Derivable from definitions
    | 'testimonial'    // From authoritative source (docs, comments)
    | 'inferential'    // Inferred from other grounded claims
    | 'synthetic';     // LLM synthesis (weakest grounding)

  /** Depth of inferential chain */
  inferenceDepth: number;

  /** Claims this depends on */
  dependencies: JustificationDependency[];
}

interface Grounds {
  type: 'code' | 'test' | 'doc' | 'commit' | 'human';
  reference: string;
  verifiable: boolean;
}
```

The key insight: **confidence should degrade with inference depth**. A claim directly grounded in passing tests is stronger than a claim inferred from inferred claims.

```typescript
function computeGroundedConfidence(
  raw: number,
  justification: EpistemicJustification
): number {
  // Confidence degrades with inference depth
  const depthPenalty = Math.pow(0.9, justification.inferenceDepth);

  // Confidence depends on grounding type
  const groundingMultiplier = GROUNDING_WEIGHTS[justification.groundingType];

  return raw * depthPenalty * groundingMultiplier;
}

const GROUNDING_WEIGHTS = {
  empirical: 1.0,     // Test-verified: full confidence
  analytical: 0.95,   // Definitionally true: near-full
  testimonial: 0.8,   // Documented: trust but verify
  inferential: 0.7,   // Derived: penalty for inference
  synthetic: 0.5,     // LLM-only: significant penalty
};
```

**Propagating Impact**

This enables:
- Honest representation of epistemic strength
- Targeting verification at weak links (synthetic grounds)
- Prioritizing empirical grounding over synthesis
- Understanding which claims are load-bearing vs. speculative

---

### Problem 8: Verification Regress

**The Issue**

Verification plans specify how to verify claims. But:
- Who verifies the verification plan?
- `verifies` is a relationship type, allowing A verifies B verifies C verifies A (circular)
- Verification methods include human judgment (`code_review`, `user_validation`), which offloads hard cases to humans while claiming automated epistemology

**Direct Solution**

Implement **verification stratification with termination**:

```typescript
type VerificationStratum =
  | 'axiomatic'     // Self-evident, needs no verification
  | 'automated'     // Machine-verifiable (tests, static analysis)
  | 'delegated'     // Requires human judgment (explicit)
  | 'unverified';   // No verification method available

interface VerificationPlan {
  target: Claim;
  stratum: VerificationStratum;

  /** For automated: what verifies this? */
  automatedMethod?: AutomatedVerification;

  /** For delegated: who verifies and under what conditions? */
  delegatedMethod?: {
    role: 'maintainer' | 'reviewer' | 'user';
    prompt: string;
    fallback: VerificationStratum; // What if human unavailable?
  };

  /** Verification cannot create cycles */
  verificationChain: string[]; // Must be acyclic
}

// Enforce acyclicity at construction time
function addVerification(
  plan: VerificationPlan,
  verifies: Claim
): VerificationPlan | CycleError {
  if (plan.verificationChain.includes(verifies.id)) {
    return { error: 'cycle_detected', chain: plan.verificationChain };
  }
  // ... proceed
}
```

For `axiomatic` stratum, define explicitly what counts:
- AST extraction from successfully parsed code
- Test results from passing tests
- Type-checking results from successful compilation

Everything else must trace to these axioms through acyclic chains.

**Propagating Impact**

This enables:
- Clear understanding of what's verified vs. delegated
- Detection and rejection of circular verification
- Honest accounting of what requires human judgment
- Principled termination of verification chains

---

### Problem 9: Embedding Space ≠ Semantic Space

**The Issue**

The system uses embedding similarity for retrieval:
- **Embedding similarity** = distributional similarity in training corpus
- **Semantic similarity** = relatedness in meaning and function

These diverge. Examples:
- A bug fix is semantically related to the bug, but distributionally distant
- Two utility functions might be distributionally similar (boilerplate) but semantically unrelated
- Code and its test are semantically closely related but may have very different tokens

**Direct Solution**

Use **multiple similarity measures with fusion**:

```typescript
interface MultiModalSimilarity {
  /** Embedding similarity (distributional) */
  embedding: number;

  /** Structural similarity (AST/call-graph) */
  structural: number;

  /** Dependency similarity (import/export overlap) */
  dependency: number;

  /** Change correlation (files that change together) */
  changeCorrelation: number;

  /** Test relationship (code-to-test mapping) */
  testRelation: number;
}

function fuseSimilarity(
  multi: MultiModalSimilarity,
  queryIntent: QueryIntent
): number {
  // Weight by query intent
  const weights = INTENT_WEIGHTS[queryIntent];

  return (
    weights.embedding * multi.embedding +
    weights.structural * multi.structural +
    weights.dependency * multi.dependency +
    weights.changeCorrelation * multi.changeCorrelation +
    weights.testRelation * multi.testRelation
  );
}

const INTENT_WEIGHTS: Record<QueryIntent, Weights> = {
  semantic_search: { embedding: 0.6, structural: 0.2, dependency: 0.1, ... },
  impact_analysis: { embedding: 0.1, structural: 0.3, dependency: 0.4, changeCorrelation: 0.2, ... },
  test_discovery: { embedding: 0.1, testRelation: 0.7, structural: 0.2, ... },
};
```

**Propagating Impact**

Multi-modal similarity enables:
- Better retrieval for impact analysis (what changes if I change this?)
- Better test discovery (what tests cover this code?)
- Less sensitivity to lexical coincidence (similar tokens ≠ related code)
- Learning which modalities matter for which queries

---

### Problem 10: Fail-Closed Purism

**The Issue**

The system claims "no graceful degradation from understanding to retrieval" and fails closed when LLM unavailable. This is presented as epistemic integrity, but:

- Having code snippets without synthesis is often better than nothing
- The agent might synthesize locally from raw snippets
- Approximate understanding can guide further investigation
- Partial function can be valuable

The fail-closed design conflates "complete understanding" with "any value at all."

**Direct Solution**

Implement **stratified degradation with explicit capability loss**:

```typescript
type OperationalMode =
  | 'full'           // LLM + embeddings + everything
  | 'synthesis_only' // LLM but no embeddings (can explain, can't retrieve)
  | 'retrieval_only' // Embeddings but no LLM (can retrieve, can't explain)
  | 'structural'     // AST only (can parse, can't embed or explain)
  | 'offline';       // Nothing (fail closed)

interface DegradedCapability {
  mode: OperationalMode;

  /** What can still be done? */
  availableCapabilities: Capability[];

  /** What cannot be done? */
  lostCapabilities: Capability[];

  /** Explicit warning for consumers */
  warning: string;
}

function degrade(
  currentMode: OperationalMode,
  failure: ProviderFailure
): DegradedCapability {
  const newMode = computeDegradedMode(currentMode, failure);

  return {
    mode: newMode,
    availableCapabilities: MODE_CAPABILITIES[newMode],
    lostCapabilities: difference(
      MODE_CAPABILITIES[currentMode],
      MODE_CAPABILITIES[newMode]
    ),
    warning: `Operating in ${newMode} mode: ${DEGRADATION_WARNINGS[newMode]}`,
  };
}
```

Key: degradation is **explicit about what's lost**, not silent.

**Propagating Impact**

This enables:
- Useful partial function when conditions aren't ideal
- Honest disclosure of limitations
- Agent adaptation to available capabilities
- No false precision (agents know when they're working with less)

---

### Problem 11: Arbitrary Calibration Bounds

**The Issue**

The confidence bounds [0.1, 0.95] encode philosophical positions:
- Nothing is ever fully certain (< 1.0)
- Nothing is ever fully unknown (> 0.0)

These are defensible positions. But the specific bounds are **arbitrary**:
- Why not [0.05, 0.99]?
- Why +0.1 for success and -0.2 for failure?
- The difference between 0.95 and 0.99 confidence is huge in decision-making

**Direct Solution**

Make calibration bounds **empirically derived** and **domain-specific**:

```typescript
interface CalibrationConfig {
  /** Derived from empirical calibration curve */
  bounds: {
    min: number;
    max: number;
    /** How were these derived? */
    derivation: 'empirical' | 'theoretical' | 'arbitrary';
  };

  /** Adjustment magnitudes derived from outcome analysis */
  adjustments: {
    success: number;
    failure: number;
    /** Ratio based on Bayesian update with observed base rates */
    ratioJustification: string;
  };

  /** Domain-specific calibration */
  domain: string;

  /** Recalibration schedule */
  recalibrationPeriod: 'daily' | 'weekly' | 'monthly';
}

function computeEmpiricalBounds(
  historicalData: OutcomeData[]
): CalibrationBounds {
  // Compute: at what raw confidence do we see 50% empirical accuracy?
  // That's our effective "0.5" point
  // Scale bounds accordingly
}

function computeAdjustmentRatio(
  historicalData: OutcomeData[]
): { success: number; failure: number } {
  // Compute base rate of success
  // Apply Bayesian update formula
  // success_adjustment = log(P(success|positive) / P(success|prior))
  // failure_adjustment = log(P(failure|negative) / P(failure|prior))
}
```

**Propagating Impact**

Empirically-grounded calibration enables:
- Confidence scores that mean something measurable
- Detection of miscalibration (predicted vs actual accuracy)
- Domain-appropriate bounds (some domains warrant narrower ranges)
- Continuous improvement of calibration

---

### Problem 12: Category Confusion in Primitives

**The Issue**

Technique primitives mix abstraction levels:

| Primitive | Level | Type |
|-----------|-------|------|
| `clarify_goal` | Meta-cognitive | Process |
| `bisect` | Algorithmic | Procedure |
| `hypothesis` | Scientific method | Epistemic stance |
| `root_cause` | Diagnostic | Heuristic |
| `verify_plan` | QA | Checklist |

These aren't the same kind of thing. They don't compose naturally because they operate at different levels of abstraction with different inputs, outputs, and effects.

**Direct Solution**

Stratify primitives by **type and level**:

```typescript
type PrimitiveCategory =
  | 'cognitive'    // About thinking process (clarify_goal, reflect)
  | 'procedural'   // Concrete algorithm (bisect, binary_search)
  | 'epistemic'    // About knowledge state (hypothesis, verify)
  | 'diagnostic'   // About problem identification (root_cause, triage)
  | 'orchestrating'; // About coordination (delegate, escalate)

interface TypedPrimitive {
  category: PrimitiveCategory;

  /** What level of abstraction does this operate at? */
  abstractionLevel: 'meta' | 'strategic' | 'tactical' | 'operational';

  /** Input type */
  inputType: Type;

  /** Output type */
  outputType: Type;

  /** Can this compose with other categories? */
  composableWith: PrimitiveCategory[];
}

// Enforce type-safe composition
function compose(a: TypedPrimitive, b: TypedPrimitive): Composition | TypeError {
  if (!a.composableWith.includes(b.category)) {
    return { error: 'incompatible_categories', a: a.category, b: b.category };
  }

  if (!isCompatible(a.outputType, b.inputType)) {
    return { error: 'type_mismatch', expected: b.inputType, got: a.outputType };
  }

  // Valid composition
  return { sequence: [a, b], outputType: b.outputType };
}
```

**Propagating Impact**

Type-stratified primitives enable:
- Rejection of nonsensical compositions at definition time
- Clear understanding of what each primitive does
- Principled abstraction level management
- Better learning (outcomes attributed to appropriate level)

---

### Problem 13: Episode Boundary Problem

**The Issue**

What constitutes an episode is undefined:
- Is editing one line an episode?
- Is a full feature implementation an episode?
- Is a debugging session an episode?

The granularity determines what can be learned:
- Too fine: episodes are noise
- Too coarse: episodes are too heterogeneous to generalize

**Direct Solution**

Define **principled episode boundaries** based on cognitive task structure:

```typescript
type EpisodeBoundary =
  | 'goal_change'      // New goal = new episode
  | 'context_switch'   // Switching to different task
  | 'outcome_reached'  // Success or failure achieved
  | 'timeout'          // Time limit reached
  | 'checkpoint';      // Explicit checkpoint marker

interface EpisodeStructure {
  /** What triggered episode start? */
  startBoundary: EpisodeBoundary;

  /** What triggered episode end? */
  endBoundary: EpisodeBoundary;

  /** Hierarchical nesting */
  parent?: EpisodeId;
  children: EpisodeId[];

  /** Episode "type" for categorization */
  episodeType: EpisodeType;

  /** Granularity level */
  granularity: 'micro' | 'meso' | 'macro';
}

// Hierarchical episode structure
// Macro: "Implement feature X"
//   Meso: "Design API"
//   Meso: "Write implementation"
//     Micro: "Debug failing test"
//     Micro: "Fix type error"
//   Meso: "Write tests"
```

Learning operates at appropriate granularity:
- Macro episodes: learn about feature-level patterns
- Meso episodes: learn about phase-level patterns
- Micro episodes: learn about tactical patterns

**Propagating Impact**

Principled episode boundaries enable:
- Multi-level learning (different lessons at different scales)
- Appropriate generalization (don't overgeneralize from micro-events)
- Meaningful episode comparison (compare like with like)
- Hierarchical outcome attribution

---

### Problem 14: Bootstrap Problem

**The Issue**

The system requires calibrated confidence from historical data. But:
- Initial indexing happens before any episodes exist
- Confidence calibration requires historical outcomes that don't exist
- Cold start uses uncalibrated synthesis as if calibrated

**Direct Solution**

Implement **explicit bootstrap mode with conservative defaults**:

```typescript
type SystemMode =
  | 'bootstrap'    // No history, conservative defaults
  | 'calibrating'  // Accumulating history, widening confidence intervals
  | 'calibrated';  // Sufficient history, empirical calibration

interface BootstrapConfig {
  /** Mode based on history availability */
  mode: SystemMode;

  /** Minimum episodes before transitioning to calibrating */
  calibrationThreshold: number;

  /** Minimum episodes before transitioning to calibrated */
  calibratedThreshold: number;

  /** Conservative defaults for bootstrap mode */
  bootstrapDefaults: {
    /** All confidence capped at this during bootstrap */
    maxConfidence: 0.6; // Conservative: don't claim high confidence with no history

    /** Wider uncertainty intervals during bootstrap */
    uncertaintyMultiplier: 2.0;

    /** Explicit warning on all outputs */
    bootstrapWarning: true;
  };
}

function computeConfidence(
  raw: number,
  config: BootstrapConfig
): { confidence: number; calibrationStatus: string } {
  if (config.mode === 'bootstrap') {
    return {
      confidence: Math.min(raw, config.bootstrapDefaults.maxConfidence),
      calibrationStatus: 'uncalibrated_bootstrap',
    };
  }

  if (config.mode === 'calibrating') {
    // Use empirical calibration with wider intervals
    const calibrated = applyEmpiricalCalibration(raw);
    return {
      confidence: calibrated,
      calibrationStatus: 'calibrating_limited_data',
    };
  }

  // Full calibration
  return {
    confidence: applyFullCalibration(raw),
    calibrationStatus: 'calibrated',
  };
}
```

**Propagating Impact**

Explicit bootstrap handling enables:
- Honest disclosure of calibration status
- Conservative behavior when history is limited
- Clear transition from bootstrap to calibrated operation
- No false precision during cold start

---

## Part III: Architectural Incoherences

### Problem 15: invalidationTriggers vs. Time Decay Contradiction

**The Issue**

The architecture contains contradictory designs:
1. `ContextPack.invalidationTriggers`: Lists specific files that invalidate this pack
2. `applyTimeDecay()`: Decays all knowledge based on wall-clock time

These represent incompatible theories of staleness:
- Triggers say: "knowledge is invalid when these specific things change"
- Time decay says: "knowledge decays regardless of what changes"

**Direct Solution**

Unify under **event-based invalidation** with time as fallback:

```typescript
interface UnifiedInvalidation {
  /** Primary: specific invalidation triggers */
  triggers: InvalidationTrigger[];

  /** Secondary: dependency-based decay */
  dependencyDecay: DependencyDecayConfig;

  /** Tertiary: time-based decay (fallback only) */
  timeDecay: {
    enabled: boolean;
    /** Only apply if no change data available */
    onlyWhenNoChangeData: true;
    rate: number;
  };
}

async function checkInvalidation(
  pack: ContextPack,
  changes: ChangeLog
): Promise<InvalidationResult> {
  // Primary: check explicit triggers
  for (const trigger of pack.invalidation.triggers) {
    if (changes.includes(trigger)) {
      return { invalidated: true, reason: 'trigger_matched', trigger };
    }
  }

  // Secondary: check dependency changes
  const depDecay = computeDependencyDecay(pack, changes);
  if (depDecay.significant) {
    return { invalidated: false, decayed: true, newConfidence: depDecay.confidence };
  }

  // Tertiary: time decay (only if no change data)
  if (pack.invalidation.timeDecay.enabled && changes.length === 0) {
    const timeDecay = computeTimeDecay(pack);
    return { invalidated: false, decayed: true, newConfidence: timeDecay.confidence };
  }

  return { invalidated: false, decayed: false };
}
```

**Propagating Impact**

Unified invalidation enables:
- Consistent staleness model across the system
- Efficient invalidation (only check what might have changed)
- Causal understanding of what invalidates knowledge
- No contradiction between subsystems

---

### Problem 16: Confidence Calibration Circularity

**The Issue**

Confidence calibration "learns from outcomes." But outcome attribution is genuinely hard:
- Agent succeeds at task T after receiving context pack P
- Did P contribute to success?
- P might have been ignored, irrelevant, or actually hindering

The system assumes: `success → retrieved knowledge was good`. This is survivorship bias.

**Direct Solution**

Implement **causal attribution with counterfactual reasoning**:

```typescript
interface OutcomeAttribution {
  /** What was the outcome? */
  outcome: 'success' | 'failure';

  /** What context was provided? */
  providedContext: ContextPack[];

  /** What context was actually used? (from trace analysis) */
  usedContext: ContextPack[];

  /** Counterfactual: what would have happened without this context? */
  counterfactualAnalysis?: {
    /** Was alternative context available? */
    alternativeAvailable: boolean;
    /** Estimated outcome without this context */
    estimatedOutcome: 'success' | 'failure' | 'unknown';
  };

  /** Attribution confidence */
  attributionConfidence: number;
}

function attributeOutcome(
  outcome: Outcome,
  trace: ExecutionTrace
): OutcomeAttribution {
  // Analyze trace to see what context was actually referenced
  const usedContext = extractUsedContext(trace);

  // Provided but unused context gets no credit/blame
  const unusedContext = difference(outcome.providedContext, usedContext);

  // Used context gets partial attribution based on trace analysis
  for (const pack of usedContext) {
    const usage = analyzeUsage(trace, pack);
    if (usage.influential) {
      updateConfidence(pack, outcome.success ? +0.1 : -0.2);
    }
    // Non-influential usage: neutral
  }

  // Unused context: slight negative (not relevant enough to use)
  for (const pack of unusedContext) {
    updateConfidence(pack, -0.02); // Slight penalty for irrelevance
  }
}
```

**Propagating Impact**

Causal attribution enables:
- Learning what context actually helps (not just what was present)
- Distinguishing helpful from irrelevant context
- Not penalizing context for failures it didn't cause
- More accurate calibration over time

---

## Part IV: Solution Propagation Framework

### How Solutions Interact

The solutions above are not independent. Implementing one affects others. This section maps the interactions.

### Dependency Graph of Solutions

```
┌─────────────────────────────────────────────────────────────────┐
│                    FOUNDATIONAL LAYER                           │
├─────────────────────────────────────────────────────────────────┤
│  [S1] DSL Semantics    [S6] Type-Stratified Confidence          │
│         │                        │                              │
│         ▼                        ▼                              │
│  [S3] Stratum          [S12] Category-Typed Primitives          │
│  Stratification                  │                              │
│         │                        │                              │
│         └────────────┬───────────┘                              │
│                      ▼                                          │
│            Principled Composition                               │
└─────────────────────────────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                    CONFIDENCE LAYER                             │
├─────────────────────────────────────────────────────────────────┤
│  [S5] Change-Based    [S7] Epistemic         [S11] Empirical    │
│       Decay                Justification           Calibration  │
│         │                    │                       │          │
│         └──────────┬─────────┴───────────┬──────────┘          │
│                    ▼                     ▼                      │
│         [S15] Unified            [S16] Causal                   │
│         Invalidation             Attribution                    │
└─────────────────────────────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                    RETRIEVAL LAYER                              │
├─────────────────────────────────────────────────────────────────┤
│  [S2] Retrieval        [S9] Multi-Modal                         │
│       Uncertainty            Similarity                         │
│         │                    │                                  │
│         └────────────────────┴────────────────┐                │
│                                               ▼                 │
│                                    Honest Retrieval             │
└─────────────────────────────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                    OPERATIONAL LAYER                            │
├─────────────────────────────────────────────────────────────────┤
│  [S10] Stratified     [S14] Bootstrap        [S13] Episode      │
│        Degradation          Mode                  Boundaries    │
│         │                    │                       │          │
│         └──────────┬─────────┴───────────┬──────────┘          │
│                    ▼                     ▼                      │
│         Robust Operation        Principled Learning             │
└─────────────────────────────────────────────────────────────────┘
```

### Implementation Order

Based on dependencies, implement in this order:

**Phase 1: Foundational (Required First)**
1. S1: DSL Semantics
2. S6: Type-Stratified Confidence
3. S12: Category-Typed Primitives
4. S3: Expressiveness Stratification

**Phase 2: Confidence Model**
5. S5: Change-Based Decay (replaces time decay)
6. S7: Epistemic Justification (replaces flat provenance)
7. S11: Empirical Calibration Bounds
8. S15: Unified Invalidation
9. S16: Causal Attribution

**Phase 3: Retrieval**
10. S2: Retrieval Uncertainty Quantification
11. S9: Multi-Modal Similarity

**Phase 4: Operations**
12. S10: Stratified Degradation
13. S14: Bootstrap Mode
14. S13: Episode Boundaries

**Phase 5: Domain**
15. S4: Domain-Contextualized Metrics
16. S8: Verification Stratification

### Epistemic Kernel Mapping (prevents “paper capability”)

Theory thread (from the invariants above): LiBrainian becomes “10 ballparks ahead” only if there is a small, stable substrate whose properties can be relied on across unknown future agents/harnesses/providers. That substrate is the **epistemic kernel**:
- **[CAPABILITIES]** negotiated capability lattice (what is available, what is missing, what is optional)
- **[EVIDENCE_LEDGER]** unified append-only ledger (what was observed/done, with stable IDs and replay hooks)
- **[CLAIMS]** machine-checkable claims (what can be asserted, what evidence supports it, what defeaters apply)
- **Budgets/scheduler** (bounded time/tokens/IO; no runaway)
- **Replay** (deterministic or explicitly non-replayable with defeaters)

Implementation mapping (today’s partial hooks):
- Capability/provisioning: `src/LiBrainian/api/provider_check.ts`, `src/LiBrainian/api/llm_provider_discovery.ts`, storage capability detection in `src/LiBrainian/api/LiBrainian.ts`
- Execution substrate: `src/LiBrainian/api/technique_execution.ts`, `src/LiBrainian/api/operator_registry.ts`, `src/LiBrainian/api/operator_interpreters.ts`
- Evidence fragments: query stage reports in `src/LiBrainian/api/query.ts`, MCP audit in `src/LiBrainian/mcp/audit.ts`, episodes in `src/LiBrainian/state/episodes_state.ts`

What’s missing (and therefore what S1/S6/S15 must converge into): a single ledger + claim/evidence algebra that ties together query, execution, provider probes, and learning outcomes without “citation theater”.

### Cascade Effects

When implementing solutions, watch for these cascades:

| Solution | Cascade Effects |
|----------|-----------------|
| S5 (Change-Based Decay) | Invalidates existing confidence scores; requires migration |
| S6 (Type-Stratified Confidence) | All confidence consumers must handle typed confidence |
| S1 (DSL Semantics) | All technique definitions need type annotations |
| S9 (Multi-Modal Similarity) | Retrieval interface changes; all retrievers affected |
| S14 (Bootstrap Mode) | All confidence reads must check calibration status |

### Migration Strategy

For each solution that changes existing data structures:

1. **Define new structure** alongside old
2. **Implement adapter** that presents old data in new format
3. **Migrate incrementally** as data is touched
4. **Remove old structure** when migration complete

```typescript
// Example: Migrating from flat confidence to typed confidence
interface ConfidenceAdapter {
  /** Read old format, return new format */
  read(old: number): TypedConfidence;

  /** Write new format, store in compatible way */
  write(new_: TypedConfidence): void;

  /** Check if migration needed */
  needsMigration(entity: Entity): boolean;
}
```

---

## Conclusion

LiBrainian is an ambitious system attempting to formalize machine epistemology. The theoretical problems identified here are not fatal flaws but **growth edges**—places where the architecture can be strengthened through more rigorous foundations.

The key meta-insight: **formalism without foundations creates technical debt**. The system has elaborate types, confidence scores, and provenance chains, but lacks the formal semantics, empirical grounding, and principled composition rules to make these more than suggestive scaffolding.

The solutions proposed here aim to provide those foundations: formal semantics for techniques, empirical grounding for confidence, causal models for decay, and principled composition for primitives. Implementing them requires significant work but results in a system that can actually justify its claims about knowledge.

---

## Part V: API and Implementation Review

This section provides a comprehensive review of the actual LiBrainian API surface, technique primitives, composition system, and plan compiler—identifying issues on philosophical, conceptual, technical, and theoretical grounds.

### API Surface Overview

The LiBrainian exposes the following major API categories:

| Category | Key Functions | LOC | Complexity |
|----------|--------------|-----|------------|
| **Query** | `queryLibrarian()`, `assembleContext()` | 1,675+ | Very High |
| **Techniques** | `ensureTechniquePrimitives()`, `ensureTechniqueCompositions()` | ~800 | Medium |
| **Plan Compiler** | `planWorkFromIntent()`, `compileTechniqueCompositionTemplate()` | ~600 | Medium |
| **Bootstrap** | `bootstrapProject()`, `createBootstrapConfig()` | ~500 | Medium |
| **Storage** | `LibrarianStorage` interface | ~400 | Medium |

---

### Problem 17: Query API Opacity

**The Issue**

`queryLibrarian()` is a 1,675+ line function with:
- 6+ internal stages (semantic → expand → score → rerank → defeater → synthesis)
- Multiple caching layers (embedding cache, L1/L2 query cache)
- Magic numbers throughout (`minSimilarity: 0.45`, `0.35`, etc.)
- Silent fallbacks that add to `coverageGaps` array
- No clear documentation of what triggers defeater checking

An agent or programmer cannot reason about what the query will return or why.

**Direct Solution**

Decompose into **observable pipeline stages**:

```typescript
interface QueryPipeline {
  stages: PipelineStage[];

  /** Each stage emits structured results */
  execute(query: LibrarianQuery): Observable<StageResult>;
}

interface PipelineStage {
  name: string;

  /** What this stage does */
  description: string;

  /** Input requirements */
  requires: string[];

  /** What this stage produces */
  produces: string[];

  /** Execute with observability */
  execute(input: StageInput): Promise<StageOutput>;

  /** Explain why results were produced */
  explain(output: StageOutput): Explanation;
}

// Usage: observable pipeline
const pipeline = createQueryPipeline([
  semanticRetrievalStage,
  graphExpansionStage,
  scoringStage,
  rerankingStage,
  defeaterCheckStage,
  synthesisStage,
]);

// Can observe each stage
pipeline.execute(query).subscribe(result => {
  console.log(`Stage ${result.stage}: ${result.candidateCount} candidates`);
});
```

**Propagating Impact**

Observable pipelines enable:
- Debugging why certain results were (not) returned
- A/B testing individual stages
- Progressive refinement (stop early if confident enough)
- Clear failure attribution

---

### Problem 18: Technique Primitives Are Prose, Not Executable

**The Issue**

The 64 technique primitives define `actions` as high-level prose:

```typescript
{
  id: 'tp_clarify_goal',
  actions: [
    'Ask clarifying questions',
    'Summarize goal in one sentence',
    'List key success criteria',
  ],
}
```

These are **instructions for a human or agent to interpret**, not executable specifications. There's no formal contract for:
- What input is required?
- What output is produced?
- What state transformation occurs?
- How to verify the primitive was executed correctly?

**Direct Solution**

Populate and enforce **executable contracts** (already present in the codebase as `TechniquePrimitive.contract` and `TechniquePrimitive.semantics` in `src/LiBrainian/strategic/techniques.ts`).

Implementation reality:
- Contract validation utilities already exist: `src/LiBrainian/api/technique_contracts.ts`
- The missing piece is *enforcement*: executors/handlers must validate input/output against the declared contract, and emit `[EVIDENCE_LEDGER]` events so claims about execution are checkable.

```typescript
// Conceptual shape; in-code, use TechniquePrimitive + TechniquePrimitiveContract.
interface ExecutablePrimitive extends TechniquePrimitive {
  /** Structured input schema */
  inputSchema: JSONSchema;

  /** Structured output schema */
  outputSchema: JSONSchema;

  /** Preconditions that must hold */
  preconditions: Condition[];

  /** Postconditions guaranteed after execution */
  postconditions: Condition[];

  /** Verification: how to check this primitive succeeded */
  verification: {
    automated?: AutomatedCheck[];
    manual?: ManualCheckPrompt;
  };

  /** Example execution for testing/documentation */
  examples: ExecutionExample[];
}

// Example: tp_clarify_goal with executable contract
const tp_clarify_goal: ExecutablePrimitive = {
  id: 'tp_clarify_goal',

  inputSchema: {
    type: 'object',
    properties: {
      vagueRequest: { type: 'string', description: 'The unclear user request' },
      context: { type: 'object', description: 'Available context' },
    },
    required: ['vagueRequest'],
  },

  outputSchema: {
    type: 'object',
    properties: {
      clarifiedGoal: { type: 'string' },
      successCriteria: { type: 'array', items: { type: 'string' } },
      assumptions: { type: 'array', items: { type: 'string' } },
      openQuestions: { type: 'array', items: { type: 'string' } },
    },
    required: ['clarifiedGoal', 'successCriteria'],
  },

  preconditions: [
    { condition: 'input.vagueRequest.length > 0', description: 'Request is non-empty' },
  ],

  postconditions: [
    { condition: 'output.successCriteria.length > 0', description: 'At least one success criterion' },
    { condition: 'output.clarifiedGoal !== input.vagueRequest', description: 'Goal was actually clarified' },
  ],

  verification: {
    automated: [
      { check: 'schema_valid', schema: 'outputSchema' },
      { check: 'postconditions_hold' },
    ],
    manual: {
      prompt: 'Does the clarified goal capture the user\'s actual intent?',
      options: ['yes', 'partially', 'no'],
    },
  },

  examples: [
    {
      input: { vagueRequest: 'make it faster' },
      output: {
        clarifiedGoal: 'Reduce page load time to under 2 seconds',
        successCriteria: ['LCP < 2s', 'No regression in functionality'],
        assumptions: ['Current LCP is > 2s', 'No backend changes needed'],
        openQuestions: ['Which pages are priority?'],
      },
    },
  ],
};
```

**Propagating Impact**

Executable contracts enable:
- Automated verification that primitives were executed
- Test generation from examples
- Clear documentation of what each primitive does
- Type-safe composition (output of A matches input of B)

---

### Problem 19: Composition Selection is Keyword-Based

**The Issue**

`selectTechniqueCompositions()` uses naive keyword matching:

```typescript
const COMPOSITION_KEYWORDS = {
  tc_agentic_review_v1: ['review', 'audit', 'code review'],
  tc_root_cause_recovery: ['root cause', 'failure', 'incident', 'bug'],
  // ...
};
```

Problems:
- Intent "improve performance" matches nothing (no "performance" keyword)
- Intent "security release" ambiguously matches multiple compositions
- No ranking when multiple matches
- Keywords are hardcoded, not learned

**Direct Solution**

Replace keyword matching with **semantic composition selection**:

```typescript
interface CompositionSelector {
  /** Select compositions using semantic similarity */
  select(
    intent: string,
    options?: SelectionOptions
  ): Promise<CompositionMatch[]>;

  /** Learn from usage patterns */
  recordUsage(intent: string, selectedComposition: string, outcome: Outcome): void;
}

interface CompositionMatch {
  composition: TechniqueComposition;

  /** Why this composition matched */
  matchReason: MatchReason;

  /** Confidence in the match */
  confidence: number;

  /** Alternative compositions considered */
  alternatives: AlternativeMatch[];
}

type MatchReason =
  | { type: 'semantic'; similarity: number; intentEmbedding: Float32Array }
  | { type: 'keyword'; matchedKeywords: string[] }
  | { type: 'learned'; priorSuccessRate: number; usageCount: number }
  | { type: 'explicit'; userSpecified: true };

class SemanticCompositionSelector implements CompositionSelector {
  async select(intent: string, options?: SelectionOptions): Promise<CompositionMatch[]> {
    // 1. Embed the intent
    const intentEmbedding = await this.embedder.embed(intent);

    // 2. Compare to composition embeddings (cached)
    const similarities = await this.computeSimilarities(intentEmbedding);

    // 3. Boost by learned priors
    const boosted = this.applyLearnedPriors(similarities, intent);

    // 4. Return ranked matches with explanations
    return boosted
      .filter(m => m.confidence > 0.3)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, options?.maxResults ?? 3);
  }

  recordUsage(intent: string, selectedComposition: string, outcome: Outcome): void {
    // Store for learning
    this.usageLog.append({ intent, selectedComposition, outcome, timestamp: Date.now() });

    // Update priors periodically
    if (this.usageLog.size % 100 === 0) {
      this.updatePriors();
    }
  }
}
```

**Propagating Impact**

Semantic selection enables:
- Matching intents that don't use exact keywords
- Ranking when multiple compositions could apply
- Learning which compositions work for which intents
- Explaining why a composition was selected

---

### Problem 20: Plan Compiler Output Lacks Execution Guidance

**The Issue**

`planWork()` returns a `WorkHierarchy` (tree of work primitives), but each node contains only:
- Title (primitive name)
- Description (primitive intent)
- Acceptance criteria (generic)

Missing:
- Specific execution hints (which files to look at?)
- Context from the query (what did retrieval find?)
- Resource estimates (how long might this take?)
- Dependencies on external tools

**Direct Solution**

Enrich plan output with **execution context**:

```typescript
interface EnrichedWorkNode extends WorkPrimitive {
  /** Execution guidance derived from query context */
  executionContext: {
    /** Relevant files from retrieval */
    relevantFiles: FileReference[];

    /** Relevant functions/modules */
    relevantEntities: EntityReference[];

    /** Prior episodes with similar work */
    priorExamples: EpisodeReference[];

    /** Tools that might be needed */
    suggestedTools: ToolSuggestion[];
  };

  /** Resource estimates */
  estimates: {
    /** Estimated token budget */
    tokenBudget: { min: number; max: number; confidence: number };

    /** Estimated steps */
    stepCount: { min: number; max: number };

    /** Complexity assessment */
    complexity: 'trivial' | 'simple' | 'moderate' | 'complex' | 'unknown';
  };

  /** Explicit dependencies */
  dependencies: {
    /** Must complete before this */
    blockedBy: WorkNodeId[];

    /** This enables */
    enables: WorkNodeId[];

    /** External dependencies (tools, APIs, etc.) */
    external: ExternalDependency[];
  };
}

async function planWorkWithContext(
  intent: string,
  queryResult: LibrarianResponse
): Promise<EnrichedWorkHierarchy> {
  const basePlan = await planWorkFromIntent(intent);

  // Enrich each node with context from the query
  return enrichPlan(basePlan, queryResult);
}

function enrichPlan(
  plan: WorkHierarchy,
  context: LibrarianResponse
): EnrichedWorkHierarchy {
  return mapNodes(plan, node => ({
    ...node,
    executionContext: deriveExecutionContext(node, context),
    estimates: estimateResources(node, context),
    dependencies: analyzeDependencies(node, plan),
  }));
}
```

**Propagating Impact**

Enriched plans enable:
- Agents knowing where to look first
- Resource budgeting before execution
- Parallel execution of independent nodes
- Better progress tracking

---

### Problem 21: LLM Requirement is Hidden

**The Issue**

Multiple LiBrainian functions throw `ProviderUnavailableError` deep in their call stack when LLM is unavailable:
- `generateContextPacks()` requires LLM for summarization
- `queryLibrarian()` synthesis requires LLM
- Reindexing requires LLM for knowledge extraction

The error surfaces late, after significant work. Method signatures don't indicate LLM requirement.

**Direct Solution**

Make LLM requirement **explicit in types**:

```typescript
/** Operations that require LLM */
type LlmRequired<T> = T & { __llmRequired: true };

/** Operations that work without LLM */
type LlmOptional<T> = T & { __llmOptional: true };

/** Result that indicates LLM availability */
type LlmResult<T> =
  | { success: true; value: T }
  | { success: false; error: 'llm_unavailable'; partialResult?: Partial<T> };

interface LibrarianApi {
  /** Requires LLM - will fail if unavailable */
  query(query: LibrarianQuery): Promise<LlmRequired<LibrarianResponse>>;

  /** Works without LLM, but results are degraded */
  queryStructural(query: LibrarianQuery): Promise<LlmOptional<StructuralResponse>>;

  /** Graceful degradation with explicit result type */
  queryWithFallback(query: LibrarianQuery): Promise<LlmResult<LibrarianResponse>>;
}

// Before calling, check capability
const capabilities = await LiBrainian.getCapabilities();
if (capabilities.llm === 'unavailable') {
  // Use structural-only query
  const result = await LiBrainian.queryStructural(query);
} else {
  // Full query available
  const result = await LiBrainian.query(query);
}
```

**Propagating Impact**

Explicit LLM requirements enable:
- Compile-time awareness of what needs LLM
- Graceful fallback paths
- Clear API documentation
- Better error handling at call sites

---

### Problem 22: Multi-Stage Retrieval is Opaque

**The Issue**

Query goes through ~6 stages, each with different failure modes:
1. Semantic retrieval (embedding similarity)
2. Graph expansion (community/neighbor)
3. Multi-signal scoring
4. Reranking
5. Defeater checking
6. Synthesis

Each stage adds warnings to `coverageGaps` array, but:
- Order/severity unclear
- No indication which stage caused which gap
- Silent fallbacks hide failures

**Direct Solution**

Implement **stage-aware result reporting**:

```typescript
interface QueryResult {
  /** Final results */
  packs: ContextPack[];
  synthesis: Synthesis;

  /** Per-stage diagnostics */
  stages: StageReport[];

  /** Aggregated coverage assessment */
  coverage: CoverageAssessment;
}

interface StageReport {
  stage: StageName;

  /** Did this stage succeed? */
  status: 'success' | 'partial' | 'failed' | 'skipped';

  /** What this stage found */
  results: {
    inputCount: number;
    outputCount: number;
    filteredCount: number;
  };

  /** Warnings/issues from this stage */
  issues: StageIssue[];

  /** Timing */
  durationMs: number;
}

interface CoverageAssessment {
  /** Overall coverage estimate */
  estimatedCoverage: number;

  /** Confidence in the coverage estimate */
  coverageConfidence: number;

  /** Specific gaps identified */
  gaps: CoverageGap[];

  /** Suggestions for improving coverage */
  suggestions: string[];
}

interface CoverageGap {
  /** Which stage identified this gap */
  source: StageName;

  /** What's missing */
  description: string;

  /** Severity */
  severity: 'minor' | 'moderate' | 'significant';

  /** How to address */
  remediation?: string;
}
```

**Propagating Impact**

Stage-aware reporting enables:
- Debugging retrieval failures
- Understanding why coverage is low
- Targeted improvements to specific stages
- User-facing explanations ("Results limited because...")

---

### Problem 23: Storage Capability Detection is Implicit

**The Issue**

LiBrainian depends on `LibrarianStorage` interface. If storage doesn't implement optional methods like `getGraphMetrics()` or `getMultiVectors()`:
- Fallbacks silently add to `coverageGaps`
- Hard to debug why graph-based retrieval isn't working
- No clear capability negotiation

**Direct Solution**

Implement **explicit capability detection**:

```typescript
interface StorageCapabilities {
  /** Core capabilities (always required) */
  core: {
    getFunctions: true;
    getFiles: true;
    getContextPacks: true;
  };

  /** Optional capabilities */
  optional: {
    graphMetrics: boolean;
    multiVectors: boolean;
    embeddings: boolean;
    episodes: boolean;
    verificationPlans: boolean;
  };

  /** Capability versions (for compatibility) */
  versions: {
    schema: number;
    api: number;
  };
}

interface LibrarianStorage {
  /** Report what this storage supports */
  getCapabilities(): StorageCapabilities;

  // ... existing methods
}

// At initialization, validate capabilities
function createLibrarian(storage: LibrarianStorage): LiBrainian {
  const caps = storage.getCapabilities();

  if (!caps.optional.embeddings) {
    console.warn('Storage lacks embedding support; semantic search disabled');
  }

  if (!caps.optional.graphMetrics) {
    console.warn('Storage lacks graph metrics; PageRank scoring disabled');
  }

  return new LiBrainian(storage, caps);
}

// In query, behavior depends on capabilities
async function queryLibrarian(query: LibrarianQuery, storage: LibrarianStorage): Promise<LibrarianResponse> {
  const caps = storage.getCapabilities();

  // Only attempt graph expansion if supported
  if (caps.optional.graphMetrics) {
    candidates = await expandWithGraph(candidates, storage);
  } else {
    result.coverage.gaps.push({
      source: 'graph_expansion',
      description: 'Graph metrics unavailable; using embedding-only retrieval',
      severity: 'moderate',
    });
  }
}
```

**Propagating Impact**

Explicit capabilities enable:
- Clear error messages when features unavailable
- Graceful degradation with explanation
- Feature detection for conditional logic
- Documentation of what each storage backend supports

---

## Part VI: Actual Utility Analysis (Expanded: 20 Use Cases)

This section analyzes how an agentic system, single coding agent, or programmer would actually use LiBrainian—rating each use case and providing concrete solutions to achieve 10/10 utility.

---

### Use Case 1: Agent Seeking Context for a Bug Fix

**Scenario**: Agent receives "Fix the authentication bug in the login flow"

**Current Rating**: 6/10

**Gaps**:
- No indication of which specific bug
- No connection to issue tracker
- No historical context
- Can't verify completeness

**Solution for 10/10**:
```typescript
interface BugFixContext extends LibrarianResponse {
  // Issue integration
  relatedIssues: Issue[];           // From GitHub/Jira
  errorLogs: ErrorLogEntry[];       // Recent errors matching keywords

  // Historical context
  previousFixes: Episode[];         // Past fixes in this area
  regressionRisk: RegressionAnalysis; // What might break

  // Completeness verification
  coverageEstimate: number;         // How much of relevant code found
  missedAreas: string[];            // Suggested areas to also check
}
```

---

### Use Case 2: Agent Planning a Feature Implementation

**Scenario**: Agent receives "Add rate limiting to the API"

**Current Rating**: 4/10

**Gaps**:
- Keyword-based composition selection
- Generic plan steps
- No integration with existing code
- No resource estimation

**Solution for 10/10**:
```typescript
interface FeaturePlan extends PlanWorkResult {
  // Semantic composition selection
  selectedComposition: {
    composition: TechniqueComposition;
    matchReason: 'semantic' | 'learned' | 'explicit';
    confidence: number;
    alternatives: CompositionMatch[];
  };

  // Context-aware steps
  steps: EnrichedWorkNode[];  // Each step knows relevant files

  // Resource estimation
  estimates: {
    complexity: 'trivial' | 'simple' | 'moderate' | 'complex';
    affectedFiles: number;
    estimatedChanges: 'small' | 'medium' | 'large';
    riskAreas: RiskArea[];
  };

  // Similar past implementations
  similarFeatures: Episode[];
}
```

---

### Use Case 3: Programmer Exploring Unfamiliar Codebase

**Scenario**: New developer asks "How does payment processing work?"

**Current Rating**: 5/10

**Gaps**:
- No visual representation
- No reading order
- No API vs implementation distinction
- No follow-up context

**Solution for 10/10**:
```typescript
interface ExplorationSession {
  // Visual understanding
  architectureDiagram: MermaidDiagram;
  dataFlowDiagram: MermaidDiagram;

  // Guided reading
  readingOrder: {
    file: string;
    purpose: string;
    focusAreas: string[];
    timeEstimate: 'quick' | 'medium' | 'deep';
  }[];

  // Layered understanding
  publicApi: EntitySummary[];      // Start here
  internalModules: EntitySummary[]; // Then go deeper
  implementationDetails: EntitySummary[]; // If needed

  // Conversational context
  followUp(question: string): Promise<ExplorationSession>;
  drillDown(entityId: string): Promise<ExplorationSession>;
}
```

---

### Use Case 4: Agent Debugging a Test Failure

**Scenario**: "TypeError: Cannot read property 'user' of undefined"

**Current Rating**: 3/10

**Gaps**:
- No stack trace integration
- No code path correlation
- Non-executable primitives
- No hypothesis generation

**Solution for 10/10**:
```typescript
interface DebuggingAssistant {
  // Stack trace integration
  parseStackTrace(trace: string): ParsedStack;
  correlateWithCode(stack: ParsedStack): CodeCorrelation[];

  // Hypothesis generation
  generateHypotheses(error: ErrorInfo): Hypothesis[];
  rankHypotheses(hypotheses: Hypothesis[], context: ContextPack[]): RankedHypothesis[];

  // Executable debugging
  executeBisect(testCommand: string): BisectResult;
  instrumentCode(targetFile: string, probes: Probe[]): InstrumentationResult;

  // Guided debugging
  nextStep(): DebuggingStep;
  recordFinding(finding: Finding): void;
}
```

---

### Use Case 5: Agent Verifying a Change

**Scenario**: Verify correctness after authentication changes

**Current Rating**: 2/10

**Gaps**:
- No automated execution
- No test runner integration
- No progress tracking
- Prose primitives only

**Solution for 10/10**:
```typescript
interface VerificationExecutor {
  // Test execution
  runTests(testPattern: string): Promise<TestResults>;
  runAffectedTests(changedFiles: string[]): Promise<TestResults>;

  // Verification tracking
  createVerificationChecklist(changes: Change[]): VerificationChecklist;
  markVerified(item: ChecklistItem, evidence: Evidence): void;
  getProgress(): VerificationProgress;

  // Automated checks
  runStaticAnalysis(): StaticAnalysisResult;
  runSecurityScan(): SecurityScanResult;
  checkTypeErrors(): TypeCheckResult;

  // Synthesis
  generateVerificationReport(): VerificationReport;
}
```

---

### Use Case 6: Code Review Assistance

**Scenario**: Reviewer needs context for a PR with 15 changed files

**Current Rating**: 3/10

**Gaps**:
- No diff-aware context
- No "what could break" analysis
- No reviewer checklist
- No historical comparison

**Solution for 10/10**:
```typescript
interface CodeReviewAssistant {
  // Diff-aware context
  analyzeChanges(diff: Diff): ChangeAnalysis;
  getContextForChange(change: Change): ContextPack[];

  // Impact analysis
  whatCouldBreak(changes: Change[]): ImpactAssessment;
  affectedTests(): TestMapping[];
  affectedConsumers(): ConsumerImpact[];

  // Review guidance
  generateChecklist(changes: Change[]): ReviewChecklist;
  suggestFocusAreas(): FocusArea[];
  flagRiskyChanges(): RiskyChange[];

  // Historical comparison
  similarPRs(): Episode[];
  pastIssuesInArea(): Issue[];
}
```

---

### Use Case 7: Refactoring Planning

**Scenario**: "Refactor the user service to use dependency injection"

**Current Rating**: 4/10

**Gaps**:
- No current state analysis
- No step-by-step safe refactoring path
- No incremental verification
- No rollback strategy

**Solution for 10/10**:
```typescript
interface RefactoringPlanner {
  // Current state analysis
  analyzeCurrentPattern(): PatternAnalysis;
  identifyDependencies(): DependencyGraph;
  findCouplingPoints(): CouplingPoint[];

  // Safe refactoring path
  planIncrementalSteps(): RefactoringStep[];
  identifySafeCheckpoints(): Checkpoint[];
  estimateRisk(step: RefactoringStep): RiskAssessment;

  // Verification per step
  verificationPlan(step: RefactoringStep): VerificationPlan;
  runVerification(plan: VerificationPlan): VerificationResult;

  // Rollback
  createRollbackPlan(): RollbackPlan;
  canRollback(step: RefactoringStep): boolean;
}
```

---

### Use Case 8: Security Audit

**Scenario**: "Audit the API endpoints for security vulnerabilities"

**Current Rating**: 3/10

**Gaps**:
- No security-specific analysis
- No OWASP integration
- No automated scanning
- No remediation guidance

**Solution for 10/10**:
```typescript
interface SecurityAuditor {
  // Comprehensive scanning
  scanForVulnerabilities(): VulnerabilityReport;
  checkOWASPTop10(): OWASPCheckResult;
  analyzeTaintFlow(): TaintAnalysis;

  // Endpoint-specific
  auditEndpoint(endpoint: Endpoint): EndpointAudit;
  checkAuthenticationFlow(): AuthFlowAudit;
  checkAuthorizationRules(): AuthZAudit;

  // Secrets and configuration
  scanForSecrets(): SecretScanResult;
  auditConfiguration(): ConfigAudit;

  // Remediation
  suggestRemediations(vuln: Vulnerability): Remediation[];
  prioritizeByRisk(vulns: Vulnerability[]): PrioritizedList;
  generateSecurityReport(): SecurityReport;
}
```

---

### Use Case 9: Performance Investigation

**Scenario**: "Why is the dashboard loading slowly?"

**Current Rating**: 2/10

**Gaps**:
- No performance-specific context
- No profiling integration
- No bottleneck identification
- No optimization suggestions

**Solution for 10/10**:
```typescript
interface PerformanceInvestigator {
  // Performance context
  getPerformanceHotspots(): Hotspot[];
  analyzeComplexity(fn: FunctionRef): ComplexityAnalysis;
  identifyNPlusOne(): NPlusOneQuery[];

  // Profiling integration
  suggestProfilingPoints(): ProfilingPoint[];
  analyzeProfile(profile: Profile): ProfileAnalysis;

  // Optimization
  suggestOptimizations(hotspot: Hotspot): Optimization[];
  estimateImpact(optimization: Optimization): ImpactEstimate;
  findCachingOpportunities(): CachingOpportunity[];

  // Benchmarking
  createBenchmark(area: string): Benchmark;
  compareBefore After(before: Benchmark, after: Benchmark): Comparison;
}
```

---

### Use Case 10: API Design Review

**Scenario**: "Review our REST API design for consistency and best practices"

**Current Rating**: 3/10

**Gaps**:
- No API-specific analysis
- No RESTful best practice checking
- No consistency analysis
- No breaking change detection

**Solution for 10/10**:
```typescript
interface APIDesignReviewer {
  // Consistency analysis
  analyzeNamingConsistency(): ConsistencyReport;
  analyzeResponseStructures(): StructureAnalysis;
  analyzeErrorHandling(): ErrorHandlingAnalysis;

  // Best practices
  checkRESTfulConventions(): ConventionViolation[];
  checkVersioningStrategy(): VersioningAnalysis;
  checkPaginationPatterns(): PaginationAnalysis;

  // Documentation
  generateOpenAPISpec(): OpenAPISpec;
  findUndocumentedEndpoints(): Endpoint[];
  suggestDocumentationImprovements(): DocSuggestion[];

  // Breaking changes
  detectBreakingChanges(oldSpec: OpenAPISpec): BreakingChange[];
  suggestNonBreakingAlternatives(change: BreakingChange): Alternative[];
}
```

---

### Use Case 11: Test Coverage Gap Analysis

**Scenario**: "What important code paths are not covered by tests?"

**Current Rating**: 4/10

**Gaps**:
- No risk-weighted coverage
- No path analysis
- No test generation
- No prioritization

**Solution for 10/10**:
```typescript
interface TestGapAnalyzer {
  // Risk-weighted coverage
  analyzeRiskWeightedCoverage(): RiskWeightedReport;
  identifyHighRiskUntested(): HighRiskPath[];

  // Path analysis
  findUntestedPaths(): CodePath[];
  findUntestedBranches(): Branch[];
  findUntestedErrorHandlers(): ErrorHandler[];

  // Test generation
  suggestTestCases(path: CodePath): TestCase[];
  generateTestSkeleton(fn: FunctionRef): TestSkeleton;
  identifyMockRequirements(fn: FunctionRef): MockRequirement[];

  // Prioritization
  prioritizeByRisk(gaps: CoverageGap[]): PrioritizedGap[];
  estimateTestingEffort(gap: CoverageGap): EffortEstimate;
}
```

---

### Use Case 12: Dependency Upgrade Planning

**Scenario**: "Plan upgrade of React from 17 to 18"

**Current Rating**: 2/10

**Gaps**:
- No breaking change analysis
- No migration path
- No compatibility checking
- No gradual rollout planning

**Solution for 10/10**:
```typescript
interface DependencyUpgradePlanner {
  // Breaking change analysis
  analyzeBreakingChanges(from: Version, to: Version): BreakingChange[];
  findAffectedCode(changes: BreakingChange[]): AffectedCode[];

  // Migration path
  generateMigrationSteps(): MigrationStep[];
  identifyBlockers(): Blocker[];
  estimateMigrationEffort(): EffortEstimate;

  // Compatibility
  checkPeerDependencies(): CompatibilityReport;
  checkTransitiveDependencies(): TransitiveReport;

  // Gradual rollout
  planIncrementalMigration(): IncrementalPlan;
  identifyFeatureFlagPoints(): FeatureFlagPoint[];
  createRollbackStrategy(): RollbackStrategy;
}
```

---

### Use Case 13: Documentation Generation

**Scenario**: "Generate documentation for our internal SDK"

**Current Rating**: 3/10

**Gaps**:
- No structure inference
- No example generation
- No cross-referencing
- No quality checking

**Solution for 10/10**:
```typescript
interface DocumentationGenerator {
  // Structure inference
  inferDocumentationStructure(): DocStructure;
  identifyPublicAPI(): PublicAPI;
  categorizeByConcept(): ConceptCategory[];

  // Content generation
  generateModuleOverview(module: Module): string;
  generateFunctionDoc(fn: FunctionRef): FunctionDoc;
  generateExamples(fn: FunctionRef): Example[];

  // Cross-referencing
  linkRelatedConcepts(): ConceptLink[];
  generateGlossary(): Glossary;
  createQuickReference(): QuickRef;

  // Quality
  checkDocCoverage(): DocCoverageReport;
  findOutdatedDocs(): OutdatedDoc[];
  suggestImprovements(): DocSuggestion[];
}
```

---

### Use Case 14: Onboarding New Developer

**Scenario**: "Create an onboarding guide for a new backend developer"

**Current Rating**: 3/10

**Gaps**:
- No role-specific guidance
- No learning path
- No key concept identification
- No progressive complexity

**Solution for 10/10**:
```typescript
interface OnboardingGenerator {
  // Role-specific
  identifyRelevantAreas(role: DeveloperRole): Area[];
  prioritizeByImportance(areas: Area[]): PrioritizedArea[];

  // Learning path
  createLearningPath(role: DeveloperRole): LearningPath;
  identifyPrerequisites(area: Area): Prerequisite[];
  estimateLearningTime(path: LearningPath): TimeEstimate;

  // Key concepts
  extractKeyConcepts(): Concept[];
  explainConceptWithContext(concept: Concept): Explanation;
  findConceptExamples(concept: Concept): Example[];

  // Progressive complexity
  stratifyByComplexity(areas: Area[]): ComplexityLayer[];
  suggestFirstTasks(): StarterTask[];
  createMentorshipGuide(): MentorGuide;
}
```

---

### Use Case 15: Technical Debt Assessment

**Scenario**: "Identify and prioritize our technical debt"

**Current Rating**: 4/10

**Gaps**:
- No debt categorization
- No business impact analysis
- No remediation planning
- No tracking over time

**Solution for 10/10**:
```typescript
interface TechnicalDebtAssessor {
  // Categorization
  identifyDebtItems(): DebtItem[];
  categorizeDebt(): DebtCategory[];
  measureDebtMetrics(): DebtMetrics;

  // Business impact
  estimateBusinessImpact(item: DebtItem): BusinessImpact;
  linkToIncidents(item: DebtItem): Incident[];
  calculateMaintainanceTax(area: Area): MaintenanceTax;

  // Remediation
  createRemediationPlan(item: DebtItem): RemediationPlan;
  estimateRemediationEffort(plan: RemediationPlan): Effort;
  identifyQuickWins(): QuickWin[];

  // Tracking
  trackDebtOverTime(): DebtTrend;
  setDebtBudget(): DebtBudget;
  alertOnDebtIncrease(): Alert[];
}
```

---

### Use Case 16: Incident Investigation

**Scenario**: "Production is down, investigate the root cause"

**Current Rating**: 2/10

**Gaps**:
- No log integration
- No timeline construction
- No blast radius analysis
- No runbook generation

**Solution for 10/10**:
```typescript
interface IncidentInvestigator {
  // Log integration
  correlateLogEntries(timeRange: TimeRange): CorrelatedLogs;
  identifyAnomalies(): Anomaly[];
  traceRequestFlow(requestId: string): RequestTrace;

  // Timeline construction
  constructTimeline(): IncidentTimeline;
  identifyTriggeringEvent(): Event;
  findContributingFactors(): Factor[];

  // Blast radius
  analyzeBlastRadius(): BlastRadius;
  identifyAffectedUsers(): UserImpact;
  findRelatedSystems(): SystemDependency[];

  // Response
  suggestImmediateMitigation(): Mitigation[];
  generateRunbook(incident: Incident): Runbook;
  createPostmortemTemplate(): PostmortemTemplate;
}
```

---

### Use Case 17: Architecture Decision Support

**Scenario**: "Should we use microservices or a monolith for the new feature?"

**Current Rating**: 3/10

**Gaps**:
- No tradeoff analysis
- No precedent finding
- No constraint checking
- No decision documentation

**Solution for 10/10**:
```typescript
interface ArchitectureDecisionSupport {
  // Tradeoff analysis
  analyzeTradeoffs(options: ArchOption[]): TradeoffMatrix;
  scoreOptions(criteria: Criteria[]): ScoredOptions;
  identifyRisks(option: ArchOption): Risk[];

  // Precedents
  findSimilarDecisions(): ADR[];
  findIndustryExamples(): Example[];
  analyzeOutcomes(precedent: ADR): OutcomeAnalysis;

  // Constraints
  checkExistingConstraints(): ConstraintViolation[];
  analyzeTeamCapability(option: ArchOption): CapabilityAnalysis;
  estimateImplementationCost(option: ArchOption): CostEstimate;

  // Documentation
  generateADR(decision: Decision): ADR;
  trackDecisionOutcome(adrId: string): OutcomeTracker;
}
```

---

### Use Case 18: Legacy Code Understanding

**Scenario**: "Understand this 10-year-old module before modifying it"

**Current Rating**: 4/10

**Gaps**:
- No archaeological analysis
- No implicit knowledge extraction
- No safe modification zones
- No tribal knowledge capture

**Solution for 10/10**:
```typescript
interface LegacyCodeArchaeologist {
  // Archaeological analysis
  analyzeCodeEvolution(): EvolutionTimeline;
  identifyLayeredPatterns(): PatternLayer[];
  findDeadCode(): DeadCode[];

  // Implicit knowledge
  extractImplicitRules(): ImplicitRule[];
  identifyMagicNumbers(): MagicNumber[];
  findHiddenDependencies(): HiddenDep[];

  // Safe zones
  identifySafeModificationZones(): SafeZone[];
  findBrittleAreas(): BrittleArea[];
  mapTestCoverage(): CoverageMap;

  // Knowledge capture
  captureTribalKnowledge(): TribalKnowledge;
  identifyExperts(area: Area): Expert[];
  generateKnowledgeBase(): KnowledgeBase;
}
```

---

### Use Case 19: Compliance Checking

**Scenario**: "Verify our codebase meets SOC2 compliance requirements"

**Current Rating**: 2/10

**Gaps**:
- No compliance framework integration
- No evidence collection
- No gap analysis
- No remediation tracking

**Solution for 10/10**:
```typescript
interface ComplianceChecker {
  // Framework integration
  loadComplianceFramework(framework: 'SOC2' | 'HIPAA' | 'GDPR'): Framework;
  mapRequirementsToCode(): RequirementMapping;

  // Evidence collection
  collectEvidence(requirement: Requirement): Evidence[];
  generateEvidenceReport(): EvidenceReport;
  linkToArtifacts(evidence: Evidence): Artifact[];

  // Gap analysis
  identifyGaps(): ComplianceGap[];
  prioritizeGaps(): PrioritizedGap[];
  estimateRemediationEffort(gap: ComplianceGap): Effort;

  // Tracking
  trackRemediationProgress(): Progress;
  scheduleReview(): ReviewSchedule;
  generateAuditReport(): AuditReport;
}
```

---

### Use Case 20: Multi-Repository Analysis

**Scenario**: "Analyze dependencies and patterns across our 50 microservices"

**Current Rating**: 1/10

**Gaps**:
- No multi-repo support
- No cross-repo dependency analysis
- No pattern consistency checking
- No global view

**Solution for 10/10**:
```typescript
interface MultiRepoAnalyzer {
  // Cross-repo indexing
  indexRepositories(repos: Repository[]): MultiRepoIndex;
  buildGlobalDependencyGraph(): GlobalDepGraph;

  // Pattern analysis
  findSharedPatterns(): SharedPattern[];
  findInconsistencies(): Inconsistency[];
  identifyDuplication(): Duplication[];

  // Dependency health
  analyzeCircularDependencies(): CircularDep[];
  findVersionMismatches(): VersionMismatch[];
  identifyBroadcastChanges(): BroadcastChange[];

  // Global view
  generateSystemArchitecture(): SystemArchDiagram;
  createServiceCatalog(): ServiceCatalog;
  trackCrossRepoChanges(): ChangeTracker;
}
```

---

### Summary: Utility Assessment (Expanded)

| # | Use Case | Current | With Solutions | Primary Gap |
|---|----------|---------|----------------|-------------|
| 1 | Bug fix context | 6/10 | 10/10 | Issue/log integration |
| 2 | Feature planning | 4/10 | 10/10 | Semantic selection, estimates |
| 3 | Codebase exploration | 5/10 | 10/10 | Guided learning, visuals |
| 4 | Debugging | 3/10 | 10/10 | Stack trace, execution |
| 5 | Change verification | 2/10 | 10/10 | Test execution, tracking |
| 6 | Code review | 3/10 | 10/10 | Diff-aware, impact analysis |
| 7 | Refactoring | 4/10 | 10/10 | Safe incremental path |
| 8 | Security audit | 3/10 | 10/10 | OWASP, automated scanning |
| 9 | Performance | 2/10 | 10/10 | Profiling, optimization |
| 10 | API design | 3/10 | 10/10 | Best practices, consistency |
| 11 | Test gaps | 4/10 | 10/10 | Risk-weighted, generation |
| 12 | Dependency upgrade | 2/10 | 10/10 | Breaking changes, migration |
| 13 | Documentation | 3/10 | 10/10 | Structure, examples |
| 14 | Onboarding | 3/10 | 10/10 | Role-specific path |
| 15 | Tech debt | 4/10 | 10/10 | Business impact, tracking |
| 16 | Incidents | 2/10 | 10/10 | Logs, timeline, runbooks |
| 17 | Architecture decisions | 3/10 | 10/10 | Tradeoffs, ADR generation |
| 18 | Legacy code | 4/10 | 10/10 | Archaeological analysis |
| 19 | Compliance | 2/10 | 10/10 | Framework integration |
| 20 | Multi-repo | 1/10 | 10/10 | Cross-repo analysis |

**Current Overall Utility: 3.1/10**

**With Solutions: 10/10**

---

### Key Patterns for 10/10 Utility

The solutions above share common patterns:

**1. Domain Integration**
Every use case requires integration with domain-specific tools:
- Bug fixing → Issue trackers, error logs
- Security → OWASP frameworks, scanners
- Compliance → Regulatory frameworks

**2. Execution, Not Just Description**
Every technique primitive needs an executor:
- `tp_bisect` → Actually runs binary search
- `tp_verify_plan` → Actually runs verification
- `tp_threat_model` → Actually generates threat model

**3. Progressive Detail**
Users need layered information:
- Quick answer (1 sentence)
- Context (1 paragraph)
- Deep dive (full analysis)

**4. Conversational Context**
Real work is iterative:
- Follow-up questions with context
- Drill-down into specifics
- Accumulating understanding

**5. Actionable Output**
Every response should include:
- What to do next
- How to do it
- What tools to use
- Expected outcome

---

## Part VII: Critical Usability Problems and Solutions

This section identifies the most severe usability problems and provides comprehensive solutions.

### Critical Problem A: Execution Engine Not Verified End-to-End

**The Issue**

LiBrainian now has an execution engine (`TechniqueExecutionEngine`) plus operator registry/interpreters, but **end-to-end execution is not yet verified with real traces and evidence**. Many primitives still rely on missing handlers, and some operator types are still no-op or partial.

This remains a fundamental gap: the system can plan and partially execute, but cannot yet **prove** that executions are complete, auditable, and replayable.

**Severity**: Critical

**Direct Solution**

Verify and harden the **execution engine** that interprets primitives:

```typescript
interface ExecutionEngine {
  /** Execute a primitive with given inputs */
  execute(
    primitive: TechniquePrimitive,
    inputs: Record<string, unknown>,
    context: ExecutionContext
  ): Promise<ExecutionResult>;

  /** Execute a full composition */
  executeComposition(
    composition: TechniqueComposition,
    inputs: Record<string, unknown>,
    context: ExecutionContext
  ): AsyncIterable<StepResult>;

  /** Resume execution from checkpoint */
  resume(
    checkpointId: string,
    context: ExecutionContext
  ): AsyncIterable<StepResult>;
}

interface ExecutionContext {
  /** Available tools */
  tools: ToolRegistry;

  /** Current knowledge from LiBrainian */
  knowledge: LibrarianResponse;

  /** LLM for interpretation */
  llm: LlmProvider;

  /** Resource budget */
  budget: ResourceBudget;

  /** Progress callback */
  onProgress?: (progress: ExecutionProgress) => void;
}

**Immediate upgrades (non-negotiable)**
- Ensure every built-in operator either executes with real semantics or fails closed with an explicit coverage gap.
- Provide at least one real primitive handler path (non-LLM) and one LLM-backed handler path with evidence logging.
- Add a minimal evidence ledger sink for operator events + primitive execution outcomes.
- Run an end-to-end execution test that produces a replayable trace and record it in WORKLOG.

interface ExecutionResult {
  /** Did the primitive succeed? */
  status: 'success' | 'partial' | 'failed';

  /** Outputs produced */
  outputs: Record<string, unknown>;

  /** Verification results */
  verification: VerificationResult;

  /** Resources consumed */
  resources: ResourceUsage;

  /** Evidence of execution */
  evidence: ExecutionEvidence;
}

// Example: execute tp_clarify_goal
async function executeClarifyGoal(
  inputs: { vagueRequest: string },
  context: ExecutionContext
): Promise<ExecutionResult> {
  // Use LLM to interpret the primitive
  const prompt = `
    Given this vague request: "${inputs.vagueRequest}"
    And this context: ${JSON.stringify(context.knowledge.synthesis)}

    Produce:
    1. A clarified goal statement
    2. Success criteria (at least 2)
    3. Assumptions being made
    4. Open questions that need answers
  `;

  const response = await context.llm.complete(prompt);
  const parsed = parseStructuredOutput(response);

  // Verify postconditions
  const verification = verifyPostconditions(parsed, tp_clarify_goal.postconditions);

  return {
    status: verification.allPassed ? 'success' : 'partial',
    outputs: parsed,
    verification,
    resources: { tokens: response.usage.total_tokens },
    evidence: { prompt, response: response.text },
  };
}
```

**Propagating Impact of the Problem**

Without execution:
- Plans are theoretical, not actionable
- Episodes can't be recorded (nothing to record)
- Verification can't happen (nothing to verify)
- Learning is impossible (no outcomes)

**Propagating Impact of the Solution**

With execution:
- Full cycle: plan → execute → verify → learn
- Primitives become reusable automation
- Episodes capture real execution traces
- Verification validates actual work

---

### Critical Problem B: No Learning Loop Closure

**The Issue**

The system records episodes and tracks confidence, but there's **no closed loop** between outcomes and improvement:

- Episodes are recorded but not used to improve primitive selection
- Confidence is calibrated but not used to prioritize retrieval
- Feedback is collected but not used to tune scoring weights

**Severity**: High

**Direct Solution**

Implement **closed-loop learning**:

```typescript
interface LearningLoop {
  /** Record outcome and update models */
  recordOutcome(
    episode: Episode,
    outcome: Outcome
  ): Promise<LearningUpdate>;

  /** Get learned recommendations */
  getRecommendations(
    intent: string,
    context: QueryContext
  ): Promise<LearnedRecommendations>;
}

interface LearningUpdate {
  /** What was learned */
  insights: LearningInsight[];

  /** Model updates applied */
  modelUpdates: ModelUpdate[];

  /** New recommendations generated */
  recommendations: Recommendation[];
}

interface LearnedRecommendations {
  /** Compositions that worked for similar intents */
  suggestedCompositions: CompositionSuggestion[];

  /** Primitives that helped in similar situations */
  effectivePrimitives: PrimitiveSuggestion[];

  /** Context packs that were useful */
  reliableContextSources: ContextSourceSuggestion[];

  /** Warnings from past failures */
  warningsFromHistory: HistoricalWarning[];
}

class ClosedLoopLearner implements LearningLoop {
  async recordOutcome(episode: Episode, outcome: Outcome): Promise<LearningUpdate> {
    const insights: LearningInsight[] = [];
    const updates: ModelUpdate[] = [];

    // 1. Update composition effectiveness
    if (episode.compositionUsed) {
      const delta = outcome.success ? +0.1 : -0.15;
      await this.updateCompositionScore(episode.compositionUsed, episode.intent, delta);
      insights.push({
        type: 'composition_effectiveness',
        composition: episode.compositionUsed,
        outcome: outcome.success,
      });
    }

    // 2. Update context pack relevance
    for (const pack of episode.contextUsed) {
      const wasHelpful = this.assessPackContribution(pack, episode.trace, outcome);
      await this.updatePackRelevance(pack, episode.intent, wasHelpful);
    }

    // 3. Update primitive effectiveness
    for (const step of episode.stepsExecuted) {
      const stepOutcome = this.assessStepOutcome(step, outcome);
      await this.updatePrimitiveScore(step.primitive, episode.intent, stepOutcome);
    }

    // 4. Extract patterns
    const patterns = this.extractPatterns(episode, outcome);
    for (const pattern of patterns) {
      await this.storePattern(pattern);
    }

    return { insights, modelUpdates: updates, recommendations: [] };
  }

  async getRecommendations(intent: string, context: QueryContext): Promise<LearnedRecommendations> {
    // Find similar past intents
    const similarIntents = await this.findSimilarIntents(intent);

    // Get compositions that worked
    const effectiveCompositions = await this.getEffectiveCompositions(similarIntents);

    // Get warnings from failures
    const failures = await this.getRelevantFailures(similarIntents);

    return {
      suggestedCompositions: effectiveCompositions,
      effectivePrimitives: await this.getEffectivePrimitives(similarIntents),
      reliableContextSources: await this.getReliableContextSources(similarIntents),
      warningsFromHistory: failures.map(f => ({
        intent: f.intent,
        failure: f.failureReason,
        suggestion: f.avoidanceHint,
      })),
    };
  }
}
```

**Propagating Impact**

Closed-loop learning enables:
- Improving over time (not just recording)
- Avoiding repeated failures
- Personalizing to codebase patterns
- Building institutional knowledge

---

### Critical Problem B.1: Memory Not Prediction-Oriented

**The Issue**

The `ClosedLoopLearner` records outcomes and extracts patterns, but:
- Retrieval uses similarity only, not outcome history
- Patterns accumulate without consolidation or pruning
- No hierarchical temporal organization (everything treated equally)
- Memory grows unbounded without predictive value filtering

**Core Principle** (from computational mechanics, active inference):

> Memory exists to predict future success, not to store past events.

Every stored pattern should answer: "Does this help predict what will work next time?"

**Severity**: Medium

**Direct Solution**

Enhance the existing `ClosedLoopLearner` with three mechanisms:

**1. Outcome-Weighted Retrieval**

Modify similarity-based retrieval to incorporate historical success:

```typescript
interface StoredPattern {
  embedding: Float32Array;
  successRate: number;       // 0-1, updated on each outcome
  sampleCount: number;
  ageInDays: number;
  wasUnexpected: boolean;    // True if outcome contradicted prediction
  isAntiPattern: boolean;    // True if consistently fails (successRate < 0.2, sampleCount > 5)
}

interface OutcomeWeightedRetrieval {
  /** Base similarity score */
  similarity: number;
  /** Historical success rate for this pattern in similar contexts */
  outcomeWeight: number;
  /** Final score */
  score: number;  // similarity * (1 + outcomeWeight)
}

// When recording outcome, mark if unexpected:
function recordOutcome(pattern: StoredPattern, predicted: number, actual: boolean): void {
  pattern.wasUnexpected = Math.abs((actual ? 1 : 0) - predicted) > 0.5;
  // ... rest of recording logic
}

// In existing retrieval paths:
function computeRetrievalScore(
  query: Query,
  candidate: StoredPattern
): number {
  const similarity = cosineSimilarity(query.embedding, candidate.embedding);
  const recency = Math.exp(-candidate.ageInDays / 30);
  const outcomeWeight = candidate.successRate - 0.5;  // Range: -0.5 to +0.5

  // Prediction error priority: surprises are more informative than confirmations
  const surprise = candidate.wasUnexpected ? 1.3 : 1.0;

  // Anti-patterns: return negative score (triggers warning, not recommendation)
  if (candidate.isAntiPattern) {
    return -similarity * 0.5;  // Negative = warning
  }

  return similarity * recency * (1 + outcomeWeight) * surprise;
}

// In getRecommendations():
const warnings = patterns
  .filter(p => p.isAntiPattern && cosineSimilarity(query, p.embedding) > 0.7)
  .map(p => ({ pattern: p, message: 'This approach has failed consistently' }));
```

**2. Periodic Consolidation**

Add consolidation to `ClosedLoopLearner`:

```typescript
interface ConsolidationResult {
  merged: number;      // Patterns merged due to similarity
  pruned: number;      // Patterns pruned due to low predictive value
  strengthened: number; // High-value patterns reinforced
}

class ClosedLoopLearner {
  // Add to existing class:

  async consolidate(options?: {
    minSampleCount?: number;
    minPredictiveValue?: number;
  }): Promise<ConsolidationResult> {
    const patterns = await this.getAllPatterns();

    // 1. Merge similar patterns (within similarity threshold)
    const merged = this.mergeSimilarPatterns(patterns, threshold: 0.95);

    // 2. Prune low-value patterns (low sample count OR near-random success rate)
    const pruned = merged.filter(p =>
      p.sampleCount >= (options?.minSampleCount ?? 5) &&
      Math.abs(p.successRate - 0.5) >= (options?.minPredictiveValue ?? 0.1)
    );

    // 3. Update storage
    await this.replacePatterns(pruned);

    return {
      merged: patterns.length - merged.length,
      pruned: merged.length - pruned.length,
      strengthened: pruned.filter(p => p.successRate > 0.7).length,
    };
  }
}
```

**3. Hierarchical Temporal Organization**

Organize patterns by timescale within existing storage:

```typescript
type PatternTier = 'working' | 'recent' | 'learned' | 'invariant';

interface TieredPattern extends StoredPattern {
  tier: PatternTier;
  promotedAt?: string;  // When moved to higher tier
}

// Tier semantics:
// - working: Current task only (cleared on task end)
// - recent: Last N sessions (ring buffer, auto-expires)
// - learned: Consolidated patterns (survives consolidation)
// - invariant: High-confidence patterns (success rate > 0.9, sample count > 20)

// Promotion rules:
// - working → recent: on task completion
// - recent → learned: survives consolidation with predictive value
// - learned → invariant: high confidence + high sample count
```

**Integration Points**

| Existing Component | Enhancement |
|--------------------|-------------|
| `ClosedLoopLearner.recordOutcome()` | Tag patterns with tier, track outcome |
| `ClosedLoopLearner.getRecommendations()` | Weight by `computeRetrievalScore()` |
| `SemanticCompositionSelector.select()` | Include outcome history in scoring |
| `EmbeddingService` queries | Apply outcome weighting to results |

**When to Consolidate**

- After every N tasks (configurable, default: 10)
- On explicit trigger (e.g., end of session)
- When pattern count exceeds threshold

**Success Criteria**

| Metric | Before | After |
|--------|--------|-------|
| Composition selection accuracy | Similarity only | Similarity + outcome history |
| Pattern storage growth | Unbounded | Bounded by consolidation |
| Retrieval relevance | Semantic match | Semantic + predictive value |
| Cold start for similar tasks | No benefit from history | Benefits from learned patterns |

**What This Does NOT Add**

- No new top-level services or files
- No complex epsilon-machine computation
- No information-theoretic optimization
- No separate memory subsystem

**Note on Primitive-Level Attribution**: Already specified in Critical B above—`ClosedLoopLearner` iterates through `episode.stepsExecuted` and calls `updatePrimitiveScore()`. This gives credit assignment at the primitive level, not just composition level.

**4. Distribution Shift Detection**

Patterns learned from past codebases may not apply to new ones. Detect when the current codebase diverges from the training distribution:

```typescript
interface CodebaseStats {
  embeddingMean: Float32Array;
  embeddingVariance: Float32Array;
  sampleCount: number;
}

function detectDistributionShift(
  learned: CodebaseStats,
  current: CodebaseStats
): { shifted: boolean; magnitude: number } {
  // Simplified KL divergence approximation
  const kl = learned.embeddingMean.reduce((sum, mean, i) => {
    const diff = mean - current.embeddingMean[i];
    return sum + (diff * diff) / (learned.embeddingVariance[i] + 1e-8);
  }, 0) / learned.embeddingMean.length;

  return { shifted: kl > 0.5, magnitude: kl };
}

// In getRecommendations():
const shift = detectDistributionShift(this.learnedStats, currentCodebaseStats);
if (shift.shifted) {
  // Reduce confidence in transferred patterns, increase exploration
  recommendations.confidence *= Math.exp(-shift.magnitude);
  recommendations.warnings.push('Distribution shift detected; patterns may not apply');
}
```

This enhances existing `ClosedLoopLearner` with ~200 lines of additions.

---

### Critical Problem C: No Composition Customization

**The Issue**

The 14 default compositions are fixed. Users cannot:
- Add primitives to existing compositions
- Remove primitives they don't need
- Combine compositions
- Create new compositions easily

**Severity**: Medium-High

**Direct Solution**

Implement **composition algebra**:

```typescript
interface CompositionBuilder {
  /** Start from existing composition */
  from(compositionId: string): CompositionBuilder;

  /** Add a primitive */
  add(primitiveId: string, options?: AddOptions): CompositionBuilder;

  /** Remove a primitive */
  remove(primitiveId: string): CompositionBuilder;

  /** Add an operator */
  withOperator(operator: Operator): CompositionBuilder;

  /** Merge with another composition */
  merge(other: CompositionBuilder): CompositionBuilder;

  /** Set relationship between primitives */
  relate(from: string, relation: RelationType, to: string): CompositionBuilder;

  /** Validate and build */
  build(): TechniqueComposition | ValidationError[];
}

// Usage
const customReview = compositionBuilder
  .from('tc_agentic_review_v1')
  .remove('tp_accessibility_review')  // Not needed for this project
  .add('tp_performance_profile')      // Add performance check
  .withOperator({
    id: 'op_perf_gate',
    type: 'gate',
    inputs: ['tp_performance_profile'],
    conditions: ['performance regression detected'],
  })
  .build();

// Or create from scratch
const securityAudit = compositionBuilder
  .add('tp_threat_model')
  .add('tp_secret_scan')
  .add('tp_prompt_injection_scan')
  .add('tp_path_containment')
  .relate('tp_threat_model', 'enables', 'tp_secret_scan')
  .withOperator({
    id: 'op_security_gate',
    type: 'gate',
    inputs: ['tp_secret_scan', 'tp_prompt_injection_scan'],
    conditions: ['any security issue found'],
  })
  .build();
```

**Propagating Impact**

Composition customization enables:
- Tailoring workflows to project needs
- Evolving compositions over time
- Sharing compositions across teams
- Experimentation with different approaches

---

### Critical Problem D: No Partial Execution / Checkpointing

**The Issue**

Compositions are all-or-nothing. If execution fails midway:
- No checkpoint to resume from
- All progress is lost
- Can't skip already-completed steps
- No way to save intermediate state

**Severity**: Medium-High

**Direct Solution**

Implement **checkpointed execution**:

```typescript
interface CheckpointedExecution {
  /** Start or resume execution */
  execute(
    composition: TechniqueComposition,
    checkpoint?: CheckpointId
  ): AsyncIterable<ExecutionEvent>;

  /** Save checkpoint */
  checkpoint(executionId: string): Promise<CheckpointId>;

  /** List available checkpoints */
  listCheckpoints(executionId: string): Promise<Checkpoint[]>;

  /** Resume from checkpoint */
  resume(checkpointId: CheckpointId): AsyncIterable<ExecutionEvent>;
}

interface Checkpoint {
  id: CheckpointId;
  executionId: string;

  /** Which primitives have completed */
  completedPrimitives: string[];

  /** Current state */
  state: ExecutionState;

  /** Outputs from completed primitives */
  intermediateOutputs: Record<string, unknown>;

  /** When checkpoint was created */
  timestamp: Date;

  /** Why checkpoint was created */
  reason: 'manual' | 'operator' | 'failure' | 'timeout';
}

interface ExecutionState {
  /** Current primitive being executed */
  currentPrimitive?: string;

  /** Pending primitives */
  pendingPrimitives: string[];

  /** Resources consumed so far */
  resourcesConsumed: ResourceUsage;

  /** Accumulated context */
  accumulatedContext: unknown;
}

// Usage
const execution = new CheckpointedExecution();

try {
  for await (const event of execution.execute(composition)) {
    console.log(`Step: ${event.primitive}, Status: ${event.status}`);

    // Auto-checkpoint on significant progress
    if (event.status === 'completed' && event.isSignificant) {
      await execution.checkpoint(event.executionId);
    }
  }
} catch (error) {
  // Execution failed - can resume later
  const checkpoints = await execution.listCheckpoints(executionId);
  console.log(`Can resume from: ${checkpoints.map(c => c.id)}`);
}

// Later: resume from last checkpoint
const lastCheckpoint = checkpoints[checkpoints.length - 1];
for await (const event of execution.resume(lastCheckpoint.id)) {
  // Continues from where we left off
}
```

**Propagating Impact**

Checkpointing enables:
- Resilient long-running executions
- Cost control (stop and resume)
- Debugging at failure point
- Human-in-the-loop at checkpoints

---

### Critical Problem E: No Progressive Context Assembly

**The Issue**

Current context assembly is one-shot: query once, get all context. But real work often needs:
- Start with high-level overview
- Drill into specific areas
- Ask follow-up questions
- Maintain conversation context

**Severity**: Medium

**Direct Solution**

Implement **conversational context**:

```typescript
interface ContextSession {
  sessionId: string;

  /** Initial query that started the session */
  initialQuery: LibrarianQuery;

  /** Accumulated context */
  context: AccumulatedContext;

  /** Conversation history */
  history: ConversationTurn[];
}

interface ContextAssemblySession {
  /** Start a new session */
  start(query: LibrarianQuery): Promise<ContextSession>;

  /** Ask follow-up question within session */
  followUp(
    sessionId: string,
    question: string
  ): Promise<FollowUpResponse>;

  /** Drill into specific entity */
  drillDown(
    sessionId: string,
    entityId: string
  ): Promise<DrillDownResponse>;

  /** Get summary of accumulated context */
  summarize(sessionId: string): Promise<ContextSummary>;

  /** Close session */
  close(sessionId: string): Promise<void>;
}

interface AccumulatedContext {
  /** All packs retrieved in this session */
  packs: ContextPack[];

  /** Entities explored */
  exploredEntities: EntityId[];

  /** Questions asked and answered */
  qaHistory: QAPair[];

  /** Current focus area */
  focusArea?: FocusArea;
}

interface FollowUpResponse {
  /** Answer to the follow-up */
  answer: string;

  /** New packs retrieved for this follow-up */
  newPacks: ContextPack[];

  /** Suggested next questions */
  suggestedFollowUps: string[];

  /** Entities that might be worth exploring */
  drillDownSuggestions: EntityId[];
}

// Usage
const session = await contextAssembly.start({
  intent: 'How does authentication work?',
  depth: 'L1',
});

// Get initial overview
console.log(session.context.packs);

// Drill into specific module
const authModule = await contextAssembly.drillDown(session.sessionId, 'auth/oauth.ts');

// Ask follow-up
const followUp = await contextAssembly.followUp(
  session.sessionId,
  'How does token refresh work?'
);

// Get summary of everything learned
const summary = await contextAssembly.summarize(session.sessionId);
```

**Propagating Impact**

Conversational context enables:
- Natural exploration workflow
- Building understanding progressively
- Maintaining focus without losing context
- More efficient token usage (don't re-retrieve)

---

## Part VIII: Implementation Roadmap

Based on the problems identified, here is the recommended implementation order:

### Phase 0: Foundation Fixes (Critical)

1. **P18: Executable Primitive Contracts** - Add input/output schemas to primitives
2. **P17: Query Pipeline Decomposition** - Make query stages observable
3. **P21: Explicit LLM Requirements** - Make LLM dependency visible in types

### Phase 1: Execution Engine (Critical)

4. **Critical A: Execution Engine** - Build primitive interpreter
5. **Critical D: Checkpointing** - Add checkpoint/resume capability
6. **P20: Enriched Plan Output** - Add execution context to plans

### Phase 2: Learning Loop (High)

7. **Critical B: Learning Loop Closure** - Connect outcomes to improvements
8. **P19: Semantic Composition Selection** - Replace keyword matching
9. **Critical C: Composition Customization** - Build composition algebra

### Phase 3: Usability (Medium)

10. **P22: Stage-Aware Reporting** - Clear per-stage diagnostics
11. **P23: Storage Capabilities** - Explicit capability detection
12. **Critical E: Progressive Context** - Conversational context assembly

### Phase 4: Theoretical Foundations (Per Part I-IV)

13. Implement solutions S1-S16 from earlier sections

---

## Part IX: Subsystem-Level Problems and Solutions

This section provides a comprehensive review of all LiBrainian subsystems, identifying conceptual, theoretical, technical, and design problems with direct and propagating solutions.

---

### Subsystem 1: Storage and Database

**Overview**: 15+ table categories storing knowledge, embeddings, relationships, git history, quality metrics, and more. SQLite implementation with 200+ methods.

#### Problem 24: Storage Interface is Monolithic

**The Issue**

`LibrarianStorage` interface has 200+ methods covering:
- Knowledge CRUD (functions, modules, files)
- Embedding storage and retrieval
- Graph metrics and relationships
- Episode and verification plan management
- Confidence and calibration tracking

This makes:
- Mocking for tests extremely difficult
- Understanding the interface overwhelming
- Implementing new storage backends prohibitive

**Direct Solution**

Split into **focused sub-interfaces**:

```typescript
interface LibrarianStorage {
  knowledge: KnowledgeStorage;
  embeddings: EmbeddingStorage;
  graph: GraphStorage;
  episodes: EpisodeStorage;
  confidence: ConfidenceStorage;
  cache: CacheStorage;
}

interface KnowledgeStorage {
  // ~30 methods for functions, modules, files, directories
  getFunction(id: string): Promise<FunctionKnowledge | null>;
  upsertFunction(fn: FunctionKnowledge): Promise<void>;
  // ...
}

interface EmbeddingStorage {
  // ~15 methods for vectors
  getEmbedding(id: string): Promise<Float32Array | null>;
  upsertEmbedding(id: string, vector: Float32Array): Promise<void>;
  similaritySearch(query: Float32Array, limit: number): Promise<SimilarityResult[]>;
  // ...
}

interface GraphStorage {
  // ~20 methods for relationships
  getEdges(nodeId: string, type?: EdgeType): Promise<GraphEdge[]>;
  getMetrics(nodeId: string): Promise<GraphMetrics | null>;
  // ...
}
```

**Propagating Impact**

Split interfaces enable:
- Focused mocking (mock only what test needs)
- Pluggable backends (different storage for embeddings vs knowledge)
- Clear responsibility boundaries
- Easier documentation per sub-interface

---

#### Problem 25: No Transaction Boundaries

**The Issue**

Multi-step operations (e.g., bootstrap phase) don't have transaction semantics:
- If phase fails midway, partial data persists
- No rollback mechanism
- Data consistency not guaranteed

**Direct Solution**

Implement **storage transactions**:

```typescript
interface TransactionalStorage {
  /** Begin a transaction */
  beginTransaction(): Promise<Transaction>;

  /** Execute within transaction */
  withinTransaction<T>(
    fn: (tx: Transaction) => Promise<T>
  ): Promise<T>;
}

interface Transaction {
  /** Commit all changes */
  commit(): Promise<void>;

  /** Rollback all changes */
  rollback(): Promise<void>;

  /** Storage operations within this transaction */
  knowledge: KnowledgeStorage;
  embeddings: EmbeddingStorage;
  // ...
}

// Usage
await storage.withinTransaction(async (tx) => {
  await tx.knowledge.upsertFunction(fn1);
  await tx.knowledge.upsertFunction(fn2);
  await tx.embeddings.upsertEmbedding(fn1.id, embedding1);
  // All or nothing
});
```

**Concurrency Contract (Essential)**

Multi-agent environments require explicit isolation guarantees:

```typescript
/**
 * Concurrency contract for multi-agent access.
 * - Reads: snapshot isolation (readers see consistent point-in-time view)
 * - Writes: serializable within transaction scope
 * - Cross-transaction: last-writer-wins with conflict detection
 */
interface ConcurrencyContract {
  /** Isolation level for reads */
  readIsolation: 'snapshot' | 'read_committed';

  /** Conflict detection strategy */
  conflictDetection: 'optimistic' | 'pessimistic';

  /** What happens on conflict */
  onConflict: 'retry' | 'fail' | 'merge';

  /** Maximum retries for optimistic conflicts */
  maxRetries: number;
}

const DEFAULT_CONCURRENCY: ConcurrencyContract = {
  readIsolation: 'snapshot',
  conflictDetection: 'optimistic',
  onConflict: 'retry',
  maxRetries: 3,
};
```

**Propagating Impact**

Transactions enable:
- Atomic multi-step operations
- Safe recovery from failures
- Consistent snapshots for queries
- Simpler error handling (just rollback)

---

#### Problem 26: Float32Array Serialization Overhead

**The Issue**

Embeddings stored as BLOBs require manual conversion:
```typescript
// On write: Float32Array → Buffer → BLOB
// On read: BLOB → Buffer → Float32Array
```

This adds CPU overhead and complicates the storage layer.

**Direct Solution**

Use **typed array views** with memory-mapped storage for large indices:

```typescript
interface EfficientEmbeddingStorage {
  /** Memory-mapped embedding matrix */
  embeddings: MappedEmbeddingMatrix;

  /** Get embedding by index (zero-copy) */
  getEmbedding(index: number): Float32Array;

  /** Batch similarity search (SIMD-optimized) */
  batchSimilarity(
    query: Float32Array,
    indices: number[],
    topK: number
  ): SimilarityResult[];
}

class MappedEmbeddingMatrix {
  private buffer: SharedArrayBuffer;
  private dimension: number;

  constructor(capacity: number, dimension: number) {
    this.dimension = dimension;
    this.buffer = new SharedArrayBuffer(capacity * dimension * 4);
  }

  getRow(index: number): Float32Array {
    const offset = index * this.dimension * 4;
    return new Float32Array(this.buffer, offset, this.dimension);
  }
}
```

**Propagating Impact**

Efficient storage enables:
- Faster similarity search
- Lower memory overhead
- Potential GPU acceleration
- Larger index capacity

---

### Subsystem 2: Bootstrap Process

**Overview**: 5-phase process (structural scan → semantic indexing → relationship mapping → context pack generation → knowledge generation) with governor-controlled concurrency.

#### Problem 27: No Per-File Timeout

**The Issue**

Bootstrap processes files sequentially within each phase. If one file hangs (e.g., LLM timeout):
- Entire phase blocks
- No progress on other files
- No indication of which file is stuck

**Direct Solution**

Implement **file-level timeouts with skip-and-continue**:

```typescript
interface FileProcessingConfig {
  /** Timeout per file in ms */
  fileTimeoutMs: number;

  /** Max retries per file */
  maxRetries: number;

  /** What to do on timeout */
  timeoutPolicy: 'skip' | 'retry' | 'fail';

  /** Track skipped files */
  onSkipped?: (file: string, reason: string) => void;
}

async function processFilesWithTimeout(
  files: string[],
  processor: (file: string) => Promise<void>,
  config: FileProcessingConfig
): Promise<ProcessingResult> {
  const results: FileResult[] = [];

  for (const file of files) {
    let attempts = 0;
    let success = false;

    while (attempts < config.maxRetries && !success) {
      attempts++;
      try {
        await withTimeout(
          processor(file),
          config.fileTimeoutMs,
          `File processing timeout: ${file}`
        );
        success = true;
        results.push({ file, status: 'success' });
      } catch (error) {
        if (attempts >= config.maxRetries) {
          if (config.timeoutPolicy === 'skip') {
            config.onSkipped?.(file, error.message);
            results.push({ file, status: 'skipped', reason: error.message });
          } else {
            throw error;
          }
        }
      }
    }
  }

  return { results, skippedCount: results.filter(r => r.status === 'skipped').length };
}
```

**Propagating Impact**

File-level timeouts enable:
- Progress despite individual file failures
- Clear visibility into problematic files
- Configurable resilience vs. completeness tradeoff
- Faster overall bootstrap (don't wait for stuck files)

---

#### Problem 28: LLM Retry Strategy is Unbounded

**The Issue**

LLM calls retry indefinitely on failure:
- No max retry limit
- No exponential backoff documentation
- Can hang forever on persistent API issues

**Direct Solution**

Implement **bounded exponential backoff**:

```typescript
interface RetryConfig {
  /** Maximum number of retries */
  maxRetries: number;

  /** Initial delay in ms */
  initialDelayMs: number;

  /** Maximum delay in ms */
  maxDelayMs: number;

  /** Backoff multiplier */
  backoffMultiplier: number;

  /** Jitter factor (0-1) */
  jitterFactor: number;

  /** Errors that should not be retried */
  nonRetryableErrors: string[];
}

const DEFAULT_LLM_RETRY_CONFIG: RetryConfig = {
  maxRetries: 5,
  initialDelayMs: 1000,
  maxDelayMs: 60000,
  backoffMultiplier: 2,
  jitterFactor: 0.2,
  nonRetryableErrors: ['invalid_api_key', 'content_policy_violation'],
};

async function withRetry<T>(
  operation: () => Promise<T>,
  config: RetryConfig
): Promise<T> {
  let lastError: Error;
  let delay = config.initialDelayMs;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      // Don't retry non-retryable errors
      if (config.nonRetryableErrors.some(e => error.message.includes(e))) {
        throw error;
      }

      if (attempt < config.maxRetries) {
        // Add jitter
        const jitter = delay * config.jitterFactor * (Math.random() - 0.5);
        await sleep(delay + jitter);
        delay = Math.min(delay * config.backoffMultiplier, config.maxDelayMs);
      }
    }
  }

  throw new Error(`Max retries (${config.maxRetries}) exceeded: ${lastError.message}`);
}
```

**Propagating Impact**

Bounded retries enable:
- Predictable failure after known time
- No infinite hangs
- Graceful degradation
- Better resource planning

---

#### Problem 29: Recovery State Not Invalidated on Workspace Changes

**The Issue**

Bootstrap recovery saves state to `.LiBrainian/bootstrap_state.json`. If workspace changes between crash and resume:
- Recovery resumes from stale state
- May skip changed files
- Index becomes inconsistent

**Direct Solution**

Add **workspace fingerprint validation**:

```typescript
interface BootstrapRecoveryState {
  // ... existing fields

  /** Fingerprint of workspace at recovery start */
  workspaceFingerprint: WorkspaceFingerprint;
}

interface WorkspaceFingerprint {
  /** Hash of file list */
  fileListHash: string;

  /** Number of files */
  fileCount: number;

  /** Latest modification time */
  latestMtime: number;

  /** Git HEAD if available */
  gitHead?: string;
}

function computeWorkspaceFingerprint(workspace: string): WorkspaceFingerprint {
  const files = globSync('**/*', { cwd: workspace });
  const stats = files.map(f => fs.statSync(path.join(workspace, f)));

  return {
    fileListHash: hash(files.sort().join('\n')),
    fileCount: files.length,
    latestMtime: Math.max(...stats.map(s => s.mtimeMs)),
    gitHead: getGitHead(workspace),
  };
}

async function resumeBootstrap(recoveryState: BootstrapRecoveryState): Promise<void> {
  const currentFingerprint = computeWorkspaceFingerprint(recoveryState.workspace);

  if (!fingerprintsMatch(currentFingerprint, recoveryState.workspaceFingerprint)) {
    throw new Error(
      'Workspace changed since last bootstrap. ' +
      'Please run fresh bootstrap or use --force-resume to continue anyway.'
    );
  }

  // Safe to resume
}
```

**Propagating Impact**

Fingerprint validation enables:
- Safe recovery (no stale state)
- Clear error when workspace changed
- Option to force-resume with explicit acknowledgment
- Consistent index state

---

### Subsystem 3: Embedding System

**Overview**: Uses @xenova/transformers (all-MiniLM-L6-v2, 384-dim) with multi-vector strategy (purpose, semantic, structural, dependency, usage).

#### Problem 30: No Vector Normalization Validation

**The Issue**

Similarity search assumes normalized embeddings:
```typescript
similarity = dot(a, b) // Assumes ||a|| = ||b|| = 1
```

But normalization is not validated. If embedding model returns non-normalized vectors:
- Similarity scores are wrong
- Ranking is incorrect
- No error or warning

**Direct Solution**

Add **normalization validation and auto-correction**:

```typescript
interface EmbeddingConfig {
  /** Whether to validate normalization */
  validateNormalization: boolean;

  /** Tolerance for normalization check */
  normTolerance: number;

  /** Whether to auto-normalize if not normalized */
  autoNormalize: boolean;
}

function validateAndNormalize(
  vector: Float32Array,
  config: EmbeddingConfig
): Float32Array {
  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));

  if (Math.abs(norm - 1.0) > config.normTolerance) {
    if (config.autoNormalize) {
      // Normalize in-place or create new
      const normalized = new Float32Array(vector.length);
      for (let i = 0; i < vector.length; i++) {
        normalized[i] = vector[i] / norm;
      }
      return normalized;
    } else {
      throw new Error(
        `Embedding not normalized: ||v|| = ${norm.toFixed(4)}, expected 1.0 ± ${config.normTolerance}`
      );
    }
  }

  return vector;
}
```

**Propagating Impact**

Normalization validation enables:
- Correct similarity scores
- Detection of model issues
- Consistent behavior across models
- Debugging of retrieval problems

**World-Class Enhancement: SIMD-Accelerated Vector Operations (Masters' Synthesis)**

*"Vector operations are the inner loop of semantic search. Every nanosecond matters. SIMD isn't optimization—it's the baseline."* — Synthesis of Carmack, Thompson, Torvalds

The normalization validation above is correct, but world-class implementation demands:

```typescript
/**
 * SIMD-ACCELERATED VECTOR OPERATIONS
 *
 * Performance targets (Carmack's requirement):
 * - Normalization: 10M vectors/second on 8-core
 * - Similarity: 100M comparisons/second
 * - Batch normalize: 500K vectors/second including allocation
 *
 * INVARIANT: SIMD path produces bit-identical results to scalar path
 */

/** Native SIMD bindings for maximum performance */
interface SIMDVectorOps {
  /**
   * Normalize a batch of vectors in-place.
   * Uses AVX-512 on x86, NEON on ARM.
   *
   * COMPLEXITY: O(n * d / 16) where d = vector dimension
   * MEMORY: Zero allocation for in-place variant
   */
  normalizeBatch(vectors: Float32Array, dimension: number): void;

  /**
   * Compute cosine similarity matrix.
   * Result[i,j] = similarity(vectors[i], vectors[j])
   *
   * COMPLEXITY: O(n² * d / 16)
   * MEMORY: O(n²) for result matrix
   */
  similarityMatrix(
    vectors: Float32Array,
    dimension: number
  ): Float32Array;

  /**
   * Find top-k similar vectors to query.
   * Uses HNSW index for O(log n) search (not O(n)).
   *
   * COMPLEXITY: O(log n * k) with index, O(n * d) without
   * MEMORY: O(k) for result
   */
  topK(
    query: Float32Array,
    index: HNSWIndex,
    k: number
  ): SimilarityResult[];
}

/**
 * HNSW INDEX FOR O(log n) SIMILARITY SEARCH
 *
 * "Linear scan is the enemy. Hierarchical indices are the answer." — Carmack
 *
 * HNSW (Hierarchical Navigable Small World) provides:
 * - Build: O(n * log n)
 * - Search: O(log n) average
 * - Memory: O(n * M) where M = neighbors per node (~16-64)
 */
interface HNSWIndex {
  /** Number of vectors indexed */
  readonly size: number;

  /** Dimension of vectors */
  readonly dimension: number;

  /** Memory-mapped backing store */
  readonly storage: MemoryMappedStorage;

  /** Add vector to index (thread-safe) */
  add(id: string, vector: Float32Array): void;

  /** Remove vector from index */
  remove(id: string): void;

  /** Search for k nearest neighbors */
  search(query: Float32Array, k: number, ef?: number): SearchResult[];

  /** Persist index to disk */
  save(path: string): Promise<void>;

  /** Load index from disk (memory-mapped, instant) */
  static load(path: string): Promise<HNSWIndex>;
}

/**
 * MEMORY-MAPPED VECTOR STORAGE (Torvalds' requirement)
 *
 * "Don't copy data. Map it. Let the kernel manage the cache."
 *
 * Benefits:
 * - Instant startup (no loading, just mmap)
 * - Kernel-managed caching
 * - Memory-efficient for large indices
 * - Crash recovery via fsync
 */
interface MemoryMappedStorage {
  /** Total vectors stored */
  readonly count: number;

  /** Get vector by ID (O(1) with mmap) */
  get(id: string): Float32Array | null;

  /** Store vector (append-only for safety) */
  put(id: string, vector: Float32Array): void;

  /** Force sync to disk */
  sync(): Promise<void>;

  /** Compact storage (remove deleted entries) */
  compact(): Promise<CompactResult>;
}

/**
 * Production implementation with fallback.
 *
 * Uses native SIMD when available, falls back to optimized JS.
 * The fallback is still fast due to V8's Float32Array optimizations.
 */
class ProductionVectorOps implements SIMDVectorOps {
  private native: NativeVectorOps | null;

  constructor() {
    try {
      // Try to load native bindings
      this.native = require('@LiBrainian/simd-vectors');
    } catch {
      // Fallback to JS implementation
      this.native = null;
      console.warn('[vectors] Native SIMD unavailable, using JS fallback');
    }
  }

  normalizeBatch(vectors: Float32Array, dimension: number): void {
    if (this.native) {
      this.native.normalizeBatch(vectors, dimension);
      return;
    }

    // Optimized JS fallback
    const count = vectors.length / dimension;
    for (let i = 0; i < count; i++) {
      const offset = i * dimension;
      let sumSq = 0;

      // Compute norm
      for (let j = 0; j < dimension; j++) {
        sumSq += vectors[offset + j] ** 2;
      }

      const norm = Math.sqrt(sumSq);
      if (norm > 1e-10) {
        const invNorm = 1 / norm;
        for (let j = 0; j < dimension; j++) {
          vectors[offset + j] *= invNorm;
        }
      }
    }
  }

  // ... other methods with native/fallback pattern
}

/**
 * TLA+ SPECIFICATION FOR INDEX CONSISTENCY (Lamport)
 *
 * Guarantees:
 * 1. Index is always consistent with stored vectors
 * 2. Concurrent updates are serializable
 * 3. Crash recovery restores consistency
 */
const HNSW_TLA_SPEC = `
---- MODULE HNSWConsistency ----
EXTENDS Naturals, Sequences

VARIABLES vectors, index, pendingWrites

IndexConsistency ==
  \\A v \\in vectors: v.id \\in index.nodes

WriteSerializability ==
  \\A w1, w2 \\in pendingWrites:
    w1.id = w2.id => (w1 = w2 \\/ Ordered(w1, w2))

CrashRecovery ==
  AfterCrash => IndexConsistency'

====
`;
```

**Performance Targets (Carmack)**:
- 10M normalizations/second (SIMD batch)
- 100M similarity computations/second
- <1ms for top-100 search on 1M vectors (HNSW)
- <100MB memory for 1M 384-dim vectors (mmap)

---

#### Problem 31: Multi-Vector Redundancy

**The Issue**

Five vectors per entity (purpose, semantic, structural, dependency, usage) may contain redundant information:
- Purpose and semantic often overlap
- Storage scales at 5x
- Query time increases

No validation that vectors are actually different.

**Direct Solution**

Add **vector redundancy detection and consolidation**:

```typescript
interface VectorRedundancyAnalysis {
  /** Correlation matrix between vector types */
  correlations: Map<string, number>;

  /** Which vectors are redundant (correlation > threshold) */
  redundantPairs: [VectorType, VectorType][];

  /** Recommendation */
  recommendation: 'keep_all' | 'consolidate' | 'drop_redundant';
}

function analyzeVectorRedundancy(
  samples: MultiVectorPayload[],
  correlationThreshold: number = 0.95
): VectorRedundancyAnalysis {
  const vectorTypes: VectorType[] = ['purpose', 'semantic', 'structural', 'dependency', 'usage'];
  const correlations = new Map<string, number>();
  const redundancyCandidates = new Set<string>(['purpose|semantic']);

  for (const [i, type1] of vectorTypes.entries()) {
    for (const type2 of vectorTypes.slice(i + 1)) {
      const corr = computeAverageCorrelation(samples, type1, type2);
      correlations.set(`${type1}|${type2}`, corr);
    }
  }

  const redundantPairs = [...correlations.entries()]
    .filter(([key, corr]) => corr > correlationThreshold && redundancyCandidates.has(key))
    .map(([key, _]) => key.split('|') as [VectorType, VectorType]);

  return {
    correlations,
    redundantPairs,
    recommendation:
      redundantPairs.length > 2 ? 'consolidate'
        : redundantPairs.length > 0 ? 'drop_redundant'
          : 'keep_all',
  };
}
```

**Propagating Impact**

Redundancy analysis enables:
- Storage optimization (drop redundant vectors)
- Faster queries (fewer vectors to compare)
- Informed decisions about vector strategy
- Model-specific tuning

---

### Subsystem 4: Knowledge System

**Overview**: Universal knowledge schema (52K LOC) with 17 domains and 150+ fields per entity. 18 extractors for different knowledge aspects.

#### Problem 32: Universal Knowledge is Monolithic

**The Issue**

`UniversalKnowledge` interface is 1000+ lines with 150+ fields. Every entity gets the full schema even if most fields are empty. This causes:
- Token bloat in LLM synthesis
- Storage overhead
- Slow serialization
- Can't retrieve partial knowledge

**Direct Solution**

Implement **sectioned knowledge with lazy loading**:

```typescript
interface SectionedKnowledge {
  /** Always-present core identity */
  identity: IdentitySection;

  /** Sections loaded on demand */
  sections: Map<SectionType, KnowledgeSection>;

  /** Load a specific section */
  loadSection(type: SectionType): Promise<KnowledgeSection>;

  /** Check if section is loaded */
  hasSection(type: SectionType): boolean;
}

type SectionType =
  | 'semantics'
  | 'contract'
  | 'relationships'
  | 'quality'
  | 'security'
  | 'runtime'
  | 'testing'
  | 'history'
  | 'ownership'
  | 'rationale';

interface KnowledgeSection {
  type: SectionType;
  data: unknown;
  confidence: number;
  generatedAt: Date;
  validUntil: Date;
}

// Usage: only load what you need
const knowledge = await storage.getKnowledge(entityId);
console.log(knowledge.identity); // Always available

// Load specific section on demand
if (queryNeedsSecurity) {
  const security = await knowledge.loadSection('security');
}
```

**Propagating Impact**

Sectioned knowledge enables:
- Efficient partial retrieval
- Reduced token usage
- Per-section staleness tracking
- Faster serialization for common cases

---

#### Problem 33: Evidence System Not Integrated

**The Issue**

Evidence and defeaters are defined but:
- Defeaters not enforced in queries
- Evidence weights hardcoded
- No automatic evidence aging
- Contradictions not surfaced

**Direct Solution**

Implement **active evidence system**:

```typescript
interface ActiveEvidenceSystem {
  /** Check evidence against defeaters */
  validateEvidence(
    claim: Claim,
    evidence: Evidence[]
  ): EvidenceValidation;

  /** Update evidence weights based on outcomes */
  updateWeights(
    evidence: Evidence,
    outcome: 'confirmed' | 'refuted' | 'inconclusive'
  ): void;

  /** Apply age-based decay to evidence */
  applyAging(): Promise<AgingReport>;

  /** Detect and surface contradictions */
  detectContradictions(): Promise<Contradiction[]>;
}

interface EvidenceValidation {
  /** Is the claim still supported? */
  supported: boolean;

  /** Active defeaters */
  activeDefeaters: Defeater[];

  /** Evidence strength after defeaters */
  effectiveStrength: number;

  /** Contradictions found */
  contradictions: Contradiction[];
}

interface Contradiction {
  claim1: Claim;
  claim2: Claim;
  conflictType: 'direct' | 'indirect' | 'temporal';
  resolution?: 'prefer_newer' | 'prefer_higher_confidence' | 'needs_human';
}

// Integration with queries
async function queryWithEvidenceValidation(
  query: LibrarianQuery
): Promise<LibrarianResponse> {
  const packs = await retrievePacks(query);

  // Validate evidence for each pack
  for (const pack of packs) {
    const validation = await evidenceSystem.validateEvidence(
      { packId: pack.packId, claim: pack.summary },
      pack.evidence
    );

    if (!validation.supported) {
      pack.confidence *= 0.5; // Reduce confidence for unsupported claims
      pack.warnings.push(`Evidence weakened by: ${validation.activeDefeaters.map(d => d.reason)}`);
    }
  }

  return { packs, ... };
}
```

**Propagating Impact**

Active evidence enables:
- Self-correcting knowledge base
- Surfaced contradictions
- Evidence-based confidence
- Learned evidence weights

---

### Subsystem 5: Freshness and Staleness

**Overview**: Time-based decay with domain-specific thresholds (7 days for security, 365 days for identity). Graph-based decay on file changes.

#### Problem 34: Staleness is Per-Entity, Not Per-Section

**The Issue**

Confidence stored as single number per entity. But different sections have different staleness profiles:
- Identity: stable (only changes on file rename)
- Semantics: moderate stability
- Testing: volatile (changes with test runs)
- Security: highly volatile (new vulnerabilities discovered)

Single confidence conflates these.

**Direct Solution**

Implement **per-section staleness tracking**:

```typescript
interface SectionStaleness {
  section: SectionType;

  /** When this section was last validated */
  lastValidated: Date;

  /** Section-specific threshold */
  stalenessThreshold: number;

  /** Current staleness score (0 = fresh, 1 = completely stale) */
  stalenessScore: number;

  /** What would invalidate this section */
  invalidationTriggers: InvalidationTrigger[];
}

interface EntityStaleness {
  entityId: string;
  sections: Map<SectionType, SectionStaleness>;

  /** Aggregate staleness (weighted by section importance) */
  aggregateStaleness: number;

  /** Most stale section */
  mostStaleSection: SectionType;
}

const SECTION_STALENESS_CONFIG: Record<SectionType, StalenessConfig> = {
  identity: { thresholdDays: 365, weight: 0.1 },
  semantics: { thresholdDays: 90, weight: 0.2 },
  contract: { thresholdDays: 30, weight: 0.15 },
  relationships: { thresholdDays: 7, weight: 0.15 },
  testing: { thresholdDays: 1, weight: 0.15 },
  security: { thresholdDays: 7, weight: 0.25 },
  // ...
};

function computeEntityStaleness(
  entity: KnowledgeEntity,
  sectionConfigs: Record<SectionType, StalenessConfig>
): EntityStaleness {
  const sections = new Map<SectionType, SectionStaleness>();
  let weightedSum = 0;
  let totalWeight = 0;

  for (const [section, config] of Object.entries(sectionConfigs)) {
    const sectionData = entity.sections.get(section as SectionType);
    if (sectionData) {
      const daysSinceValidation = daysSince(sectionData.lastValidated);
      const stalenessScore = Math.min(1, daysSinceValidation / config.thresholdDays);

      sections.set(section as SectionType, {
        section: section as SectionType,
        lastValidated: sectionData.lastValidated,
        stalenessThreshold: config.thresholdDays,
        stalenessScore,
        invalidationTriggers: sectionData.invalidationTriggers,
      });

      weightedSum += stalenessScore * config.weight;
      totalWeight += config.weight;
    }
  }

  return {
    entityId: entity.id,
    sections,
    aggregateStaleness: weightedSum / totalWeight,
    mostStaleSection: findMostStale(sections),
  };
}
```

**Propagating Impact**

Per-section staleness enables:
- Targeted refresh (only refresh stale sections)
- Accurate confidence for specific queries
- Efficient reindexing
- Section-appropriate TTLs

---

### Subsystem 6: Engines

**Overview**: 6 engines (TDD, Constraint, Domain, Relevance, Meta, Advanced TDD) providing specialized analysis.

#### Problem 35: Engines Cannot Chain

**The Issue**

Each engine runs independently:
- TDD engine might identify a test gap
- Constraint engine might identify related violation
- No connection between them

Valuable cross-engine insights are lost.

**Direct Solution**

Implement **engine pipeline with chaining**:

```typescript
interface EnginePipeline {
  /** Define engine execution order */
  stages: EngineStage[];

  /** Execute pipeline with context passing */
  execute(
    query: LibrarianQuery,
    context: EngineContext
  ): AsyncIterable<EngineStageResult>;
}

interface EngineStage {
  engine: Engine;

  /** What this stage needs from previous stages */
  requires: string[];

  /** What this stage produces */
  produces: string[];

  /** Optional: skip conditions */
  skipIf?: (context: EngineContext) => boolean;
}

interface EngineContext {
  query: LibrarianQuery;

  /** Accumulated outputs from previous stages */
  outputs: Map<string, unknown>;

  /** Cross-engine insights */
  insights: CrossEngineInsight[];
}

// Example: TDD → Constraint → Meta pipeline
const pipeline: EnginePipeline = {
  stages: [
    {
      engine: tddEngine,
      requires: [],
      produces: ['testGaps', 'coverageIssues'],
    },
    {
      engine: constraintEngine,
      requires: ['testGaps'],
      produces: ['violations', 'relatedViolations'],
      // Use TDD gaps to focus constraint checking
    },
    {
      engine: metaEngine,
      requires: ['testGaps', 'violations'],
      produces: ['proceedDecision', 'confidence'],
      // Synthesize TDD and constraint findings
    },
  ],
};

// Cross-engine insight example
interface CrossEngineInsight {
  source: [EngineName, EngineName];
  insight: string;
  severity: 'info' | 'warning' | 'critical';
  // e.g., "TDD gap in auth module correlates with security constraint violation"
}
```

**Propagating Impact**

Engine chaining enables:
- Cross-engine pattern detection
- Prioritized findings (multiple engines agree)
- Reduced redundant analysis
- Richer insights

**Static Analysis Provider Interface (Essential)**

Engines should ingest findings from external static analysis tools:

```typescript
/**
 * Interface for external static analysis tool integration.
 * Allows engines to incorporate ESLint, TypeScript, security scanners, etc.
 */
interface StaticAnalysisProvider {
  /** Provider identifier (e.g., 'eslint', 'typescript', 'semgrep') */
  id: string;

  /** Check if tool is available */
  isAvailable(): Promise<boolean>;

  /** Run analysis on file(s), return findings */
  analyze(paths: string[]): Promise<StaticAnalysisFinding[]>;
}

interface StaticAnalysisFinding {
  file: string;
  line: number;
  column?: number;
  severity: 'error' | 'warning' | 'info';
  ruleId: string;
  message: string;
  /** Optional fix suggestion */
  fix?: { range: [number, number]; text: string };
}

/** Registry for available static analysis providers */
const staticAnalysisRegistry = new Map<string, StaticAnalysisProvider>();

/** Engines can query registry for available tools */
function getAvailableAnalyzers(): string[] {
  return Array.from(staticAnalysisRegistry.keys());
}
```

This allows engines to synthesize findings from deterministic tools with LLM-based semantic analysis.

---

#### Problem 36: Engine Output is Verbose

**The Issue**

Each engine emits 500+ lines of output:
- Consumes excessive tokens
- Hard to parse important findings
- No summarization

**Direct Solution**

Implement **tiered output with summarization**:

```typescript
interface TieredEngineOutput {
  /** 1-sentence summary */
  oneLiner: string;

  /** Key findings (3-5 bullet points) */
  keyFindings: Finding[];

  /** Detailed analysis (only if requested) */
  details?: DetailedAnalysis;

  /** Raw data (for debugging/export) */
  raw?: unknown;
}

interface EngineOutputConfig {
  /** Output verbosity level */
  verbosity: 'summary' | 'standard' | 'detailed' | 'raw';

  /** Maximum output tokens */
  maxTokens?: number;

  /** Focus areas (only output related findings) */
  focusAreas?: string[];
}

function formatEngineOutput(
  rawOutput: unknown,
  config: EngineOutputConfig
): TieredEngineOutput {
  const oneLiner = summarizeToOneLine(rawOutput);
  const keyFindings = extractTopFindings(rawOutput, 5);

  if (config.verbosity === 'summary') {
    return { oneLiner, keyFindings };
  }

  if (config.verbosity === 'standard') {
    return { oneLiner, keyFindings, details: extractDetails(rawOutput, config.maxTokens) };
  }

  // detailed or raw
  return { oneLiner, keyFindings, details: extractDetails(rawOutput), raw: rawOutput };
}
```

**Propagating Impact**

Tiered output enables:
- Token-efficient queries
- Quick scanning of results
- Drill-down when needed
- Configurable verbosity per use case

---

### Subsystem 7: Episodes and Verification Plans

**Overview**: Episodes capture task executions with context, actors, events, outcomes, and lessons. Verification plans specify how to verify claims.

#### Problem 37: Episodes Not Used for Learning

**The Issue**

Episodes are stored but:
- Not analyzed for patterns
- Not used to improve recommendations
- No pattern extraction
- Embedding field is optional and unused

**Direct Solution**

Implement **episode analysis and learning**:

```typescript
interface EpisodeAnalyzer {
  /** Extract patterns from episode history */
  extractPatterns(
    episodes: Episode[],
    minSupport: number
  ): Promise<EpisodePattern[]>;

  /** Find similar past episodes */
  findSimilar(
    currentContext: EpisodeContext,
    limit: number
  ): Promise<SimilarEpisode[]>;

  /** Generate recommendations from history */
  generateRecommendations(
    intent: string
  ): Promise<HistoricalRecommendation[]>;
}

interface EpisodePattern {
  /** Pattern identifier */
  patternId: string;

  /** What triggers this pattern */
  trigger: PatternTrigger;

  /** Common sequence of events */
  eventSequence: EventPattern[];

  /** Typical outcome */
  typicalOutcome: 'success' | 'failure' | 'mixed';

  /** Support count (how many episodes match) */
  support: number;

  /** Learned lesson */
  lesson: string;
}

interface HistoricalRecommendation {
  /** What to do */
  recommendation: string;

  /** Based on which episodes */
  basedOn: EpisodeId[];

  /** Confidence in recommendation */
  confidence: number;

  /** What happened when this was followed */
  historicalOutcome: OutcomeSummary;
}

// Usage during query
async function queryWithHistoricalContext(
  query: LibrarianQuery
): Promise<LibrarianResponse> {
  // Find similar past episodes
  const similarEpisodes = await episodeAnalyzer.findSimilar(
    { intent: query.intent, taskType: query.taskType },
    5
  );

  // Get recommendations
  const recommendations = await episodeAnalyzer.generateRecommendations(query.intent);

  // Include in response
  return {
    ...baseResponse,
    historicalContext: {
      similarEpisodes,
      recommendations,
      warnings: extractWarningsFromFailures(similarEpisodes),
    },
  };
}
```

**Propagating Impact**

Episode learning enables:
- Recommendations from past successes
- Warnings from past failures
- Pattern-based automation
- Continuous improvement

**World-Class Enhancement: Autonomous Knowledge Cells (Masters' Synthesis)**

*"Patterns aren't data. They're organisms. They have energy, they age, they reproduce, they die. Model them that way."* — Synthesis of Kay, Armstrong, Hickey

The episode analyzer above is correct, but world-class systems treat patterns as **living entities with autonomous lifecycles**:

```typescript
/**
 * AUTONOMOUS KNOWLEDGE CELLS (KAY'S VISION)
 *
 * Each pattern is not a passive data structure but an active agent
 * that manages its own lifecycle. This is Smalltalk's message-passing
 * vision applied to knowledge representation.
 *
 * INVARIANT: Cells are self-contained. No global state.
 * INVARIANT: Cells communicate only via immutable messages.
 * INVARIANT: Dead cells are garbage-collected, not deleted.
 */
interface KnowledgeCell {
  /** Unique identity, stable across lifecycle */
  readonly id: PatternId;

  /** Creation metadata (immutable) */
  readonly genesis: {
    extractedAt: Timestamp;
    extractedFrom: SourceLocation;
    extractionMethod: ExtractionMethod;
    parentCells: PatternId[]; // For synthesized patterns
  };

  /** Current lifecycle state */
  readonly state: CellState;

  /** Energy determines survival priority */
  readonly energy: CellEnergy;

  /** Age affects decay calculations */
  readonly age: CellAge;

  /** Message handling (Kay's message-passing) */
  receive(message: CellMessage): CellResponse;

  /** Lifecycle transitions */
  tick(context: LifecycleContext): CellState;
}

/**
 * CELL ENERGY (BIOLOGICAL METAPHOR)
 *
 * Patterns that are useful gain energy.
 * Patterns that are never used lose energy.
 * Low-energy patterns are candidates for consolidation or death.
 */
interface CellEnergy {
  /** Current energy level [0, 100] */
  readonly level: number;

  /** Energy sources (what adds energy) */
  readonly sources: {
    /** Each successful retrieval adds energy */
    retrievals: number;
    /** Positive feedback adds more energy */
    positiveFeedback: number;
    /** Citations by other patterns add energy */
    citations: number;
    /** Git survival adds passive energy */
    gitSurvival: number;
  };

  /** Energy drains (what removes energy) */
  readonly drains: {
    /** Time passage drains energy */
    aging: number;
    /** Negative feedback drains energy */
    negativeFeedback: number;
    /** Contradicting evidence drains energy */
    contradiction: number;
    /** Source code changes drain energy */
    sourceChanges: number;
  };

  /** Net energy change rate */
  readonly deltaPerHour: number;
}

/**
 * CELL LIFECYCLE STATES
 *
 * Patterns transition through states based on energy and age.
 * This is inspired by Armstrong's process lifecycle in Erlang.
 */
type CellState =
  | { kind: 'nascent'; confidence: number }     // Just born, low confidence
  | { kind: 'active'; confidence: number }      // In use, healthy
  | { kind: 'dormant'; since: Timestamp }       // Not used recently
  | { kind: 'consolidating'; into: PatternId }  // Merging with another
  | { kind: 'dying'; reason: DeathReason }      // About to be garbage collected
  | { kind: 'dead'; tombstone: Tombstone };     // Can be resurrected with evidence

type DeathReason =
  | 'energy_depleted'       // No one used it
  | 'contradicted'          // Evidence against it
  | 'source_deleted'        // Source code removed
  | 'superseded'            // Better pattern exists
  | 'consolidated';         // Merged with another

/**
 * ERLANG-STYLE SUPERVISION FOR PATTERN LIFECYCLE (ARMSTRONG)
 *
 * "Let it crash, but manage the crash."
 *
 * Supervisor trees ensure that cell failures don't cascade.
 * Dead cells are logged, tombstoned, and potentially resurrected.
 */
interface CellSupervisor {
  /** Strategy for handling cell failures */
  readonly strategy: SupervisionStrategy;

  /** Supervised cells */
  readonly children: Map<PatternId, KnowledgeCell>;

  /** Handle cell death */
  handleDeath(cell: KnowledgeCell, reason: DeathReason): SupervisionAction;

  /** Resurrect a dead cell with new evidence */
  resurrect(id: PatternId, evidence: Evidence): KnowledgeCell | null;

  /** Get tombstones for archaeology */
  getTombstones(filter?: TombstoneFilter): Tombstone[];
}

type SupervisionStrategy =
  | { kind: 'one_for_one' }   // Restart only the failed cell
  | { kind: 'one_for_all' }   // Restart all cells in group
  | { kind: 'rest_for_one' }  // Restart cell and all younger siblings
  | { kind: 'simple_one' };   // No restart, just log and tombstone

interface SupervisionAction {
  action: 'restart' | 'stop' | 'escalate';
  tombstone?: Tombstone;
  log?: CellDeathLog;
}

/**
 * IMMUTABLE EVENT LOG FOR TIME-TRAVEL (HICKEY)
 *
 * "State is the enemy. History is the truth."
 *
 * Every cell mutation is logged as an immutable event.
 * This enables time-travel debugging and causal analysis.
 */
interface CellEventLog {
  /** All events for a cell, ordered by time */
  getEvents(id: PatternId): CellEvent[];

  /** Get cell state at any point in time */
  getStateAt(id: PatternId, timestamp: Timestamp): CellState | null;

  /** Find causal chain for current state */
  getCausalChain(id: PatternId): CausalChain;

  /** Append event (append-only, immutable) */
  append(event: CellEvent): void;
}

type CellEvent =
  | { kind: 'created'; cell: KnowledgeCell; timestamp: Timestamp }
  | { kind: 'retrieved'; by: QueryId; timestamp: Timestamp }
  | { kind: 'feedback'; type: 'positive' | 'negative'; timestamp: Timestamp }
  | { kind: 'energy_changed'; delta: number; reason: string; timestamp: Timestamp }
  | { kind: 'state_changed'; from: CellState; to: CellState; timestamp: Timestamp }
  | { kind: 'consolidated'; into: PatternId; timestamp: Timestamp }
  | { kind: 'died'; reason: DeathReason; timestamp: Timestamp }
  | { kind: 'resurrected'; evidence: Evidence; timestamp: Timestamp };

/**
 * PATTERN REPRODUCTION (BIOLOGICAL METAPHOR)
 *
 * High-energy patterns can "reproduce" by:
 * 1. Splitting into more specialized patterns
 * 2. Generalizing into more abstract patterns
 * 3. Combining with other patterns into syntheses
 */
interface PatternReproduction {
  /** Specialize a general pattern based on usage patterns */
  specialize(
    parent: KnowledgeCell,
    specializationAxis: string
  ): KnowledgeCell[];

  /** Generalize multiple similar patterns into one */
  generalize(
    patterns: KnowledgeCell[]
  ): KnowledgeCell;

  /** Synthesize new pattern from multiple sources */
  synthesize(
    sources: KnowledgeCell[],
    synthesisPrompt: string
  ): Promise<KnowledgeCell>;
}

/**
 * SEQUENCE MINING FOR PATTERN DISCOVERY (NORVIG)
 *
 * Use frequent sequence mining algorithms (PrefixSpan, SPADE)
 * to discover patterns from episode history.
 */
interface SequenceMiner {
  /** Mine frequent patterns from episodes */
  minePatterns(
    episodes: Episode[],
    minSupport: number,
    maxPatternLength: number
  ): FrequentPattern[];

  /** Find discriminative patterns (what distinguishes success from failure) */
  mineDiscriminative(
    successEpisodes: Episode[],
    failureEpisodes: Episode[],
    minGain: number
  ): DiscriminativePattern[];

  /** Predict next action based on current sequence */
  predictNext(
    currentSequence: Action[],
    topK: number
  ): PredictedAction[];
}
```

**Performance Note (Carmack)**: The cell lifecycle tick should be O(1) amortized. Batch ticks for thousands of cells should complete in <10ms. Use spatial partitioning for cells to enable efficient bulk operations.

**Erlang Insight (Armstrong)**: The supervisor tree should be hierarchical. Low-level supervisors handle individual cells. High-level supervisors handle cell groups. Root supervisor handles system-wide failures. This provides fault isolation without global state.

---

#### Problem 38: Verification Plans are One-Time

**The Issue**

Verification plans are created per-query but:
- Not reused across similar queries
- No library of verification templates
- No tracking of which plans were executed
- No feedback loop

**Direct Solution**

Implement **verification plan library with tracking**:

```typescript
interface VerificationPlanLibrary {
  /** Get or create plan for claim type */
  getPlan(claimType: ClaimType): VerificationPlanTemplate;

  /** Record plan execution */
  recordExecution(
    planId: string,
    execution: PlanExecution
  ): Promise<void>;

  /** Get plan effectiveness stats */
  getPlanStats(planId: string): Promise<PlanStats>;

  /** Evolve plan based on outcomes */
  evolvePlan(
    planId: string,
    learnings: PlanLearning[]
  ): Promise<VerificationPlanTemplate>;
}

interface VerificationPlanTemplate {
  id: string;

  /** What types of claims this plan verifies */
  applicableTo: ClaimType[];

  /** Verification steps */
  steps: VerificationStep[];

  /** Historical effectiveness */
  effectiveness: {
    executionCount: number;
    successRate: number;
    averageDuration: number;
  };

  /** Version for evolution tracking */
  version: number;
}

interface PlanExecution {
  planId: string;
  startedAt: Date;
  completedAt: Date;
  outcome: 'verified' | 'refuted' | 'inconclusive';
  stepsCompleted: number;
  findings: Finding[];
}
```

**Propagating Impact**

Plan library enables:
- Reusable verification patterns
- Learned effective plans
- Execution tracking
- Plan evolution over time

---

### Subsystem 8: MCP Integration

**Overview**: Model Context Protocol server exposing 20+ tools for Claude integration.

#### Problem 39: No Rate Limiting

**The Issue**

MCP server accepts unlimited requests:
- Can be DoS'd with many large queries
- No throttling
- Resource exhaustion possible

**Direct Solution**

Implement **request rate limiting**:

```typescript
interface RateLimitConfig {
  /** Requests per minute per session */
  requestsPerMinute: number;

  /** Tokens per minute per session */
  tokensPerMinute: number;

  /** Concurrent requests per session */
  maxConcurrent: number;

  /** Burst allowance */
  burstAllowance: number;
}

class RateLimiter {
  private buckets: Map<string, TokenBucket> = new Map();

  async checkLimit(
    sessionId: string,
    estimatedTokens: number
  ): Promise<RateLimitResult> {
    const bucket = this.getOrCreateBucket(sessionId);

    if (!bucket.tryConsume(1, estimatedTokens)) {
      return {
        allowed: false,
        retryAfterMs: bucket.msUntilRefill(),
        reason: 'Rate limit exceeded',
      };
    }

    return { allowed: true };
  }
}

// In MCP server
async function handleToolCall(
  tool: string,
  params: unknown,
  session: Session
): Promise<ToolResult> {
  const estimatedTokens = estimateTokens(tool, params);

  const limit = await rateLimiter.checkLimit(session.id, estimatedTokens);
  if (!limit.allowed) {
    return {
      error: 'RATE_LIMITED',
      retryAfterMs: limit.retryAfterMs,
    };
  }

  // Proceed with tool call
}
```

**Propagating Impact**

Rate limiting enables:
- Protection from abuse
- Fair resource allocation
- Predictable performance
- Cost control

**World-Class Enhancement: Adaptive Rate Control with Backpressure (Masters' Synthesis)**

*"Rate limiting isn't about saying no. It's about adaptive flow control—the system should breathe, not choke."* — Synthesis of Armstrong, Lamport, Pike

The token bucket above is correct, but world-class systems need **adaptive backpressure**:

```typescript
/**
 * ADAPTIVE RATE CONTROL (ARMSTRONG'S FLOW CONTROL)
 *
 * Instead of hard rate limits, implement backpressure that:
 * 1. Slows down before hitting limits (graceful degradation)
 * 2. Adapts limits based on system load
 * 3. Provides priority queuing for critical requests
 * 4. Implements circuit breakers for cascading failure prevention
 */
interface AdaptiveRateController {
  /** Current system load [0, 1] */
  readonly load: number;

  /** Current effective limits (adaptive) */
  readonly effectiveLimits: EffectiveLimits;

  /** Request admission with priority */
  admit(request: Request, priority: Priority): AdmitResult;

  /** Update limits based on feedback */
  feedback(result: RequestResult): void;
}

type Priority = 'critical' | 'high' | 'normal' | 'low' | 'background';

interface AdmitResult =
  | { admitted: true; deadline: Timestamp; budget: TokenBudget }
  | { admitted: false; retryAfter: Timestamp; reason: string }
  | { queued: true; position: number; estimatedWait: number };

/**
 * CIRCUIT BREAKER FOR CASCADING FAILURE PREVENTION
 *
 * "The system should fail fast and recover fast." — Armstrong
 *
 * States:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Failure threshold exceeded, requests fail immediately
 * - HALF_OPEN: Testing if system has recovered
 */
interface CircuitBreaker {
  readonly state: CircuitState;
  readonly failureCount: number;
  readonly lastStateChange: Timestamp;

  /** Check if request should be allowed */
  allow(): boolean;

  /** Record success (may close circuit) */
  recordSuccess(): void;

  /** Record failure (may open circuit) */
  recordFailure(): void;

  /** Get circuit health metrics */
  getMetrics(): CircuitMetrics;
}

type CircuitState = 'closed' | 'open' | 'half_open';

/**
 * TLA+ SPECIFICATION FOR RATE LIMITER CORRECTNESS (LAMPORT)
 *
 * Guarantees:
 * 1. Rate never exceeds configured maximum
 * 2. Fair scheduling under contention
 * 3. Priority inversion is impossible
 * 4. System remains responsive under overload
 */
const RATE_LIMITER_TLA = `
---- MODULE AdaptiveRateLimiter ----
EXTENDS Naturals, Reals, Sequences

CONSTANTS MaxRate, PriorityLevels, QueueSize
VARIABLES tokens, queue, circuitState, load

RateInvariant ==
  \\A t \\in TimeWindow: RequestsIn(t) =< MaxRate

FairnessInvariant ==
  \\A p1, p2 \\in PriorityLevels:
    p1 > p2 => WaitTime(p1) =< WaitTime(p2)

NoPriorityInversion ==
  \\A r1, r2 \\in queue:
    r1.priority > r2.priority =>
      r1.admitted_before(r2) \\/ r1.queued_behind(r2)

ResponsivenessInvariant ==
  \\A r \\in CriticalRequests:
    ResponseTime(r) < CriticalDeadline

====
`;

/**
 * LEAKY BUCKET WITH ADAPTIVE DRIP RATE (SIMPLER ALTERNATIVE)
 *
 * "When in doubt, use the simpler algorithm." — Pike/Thompson
 */
class LeakyBucket {
  private level = 0;
  private lastDrip: number = Date.now();
  private dripRate: number; // tokens per ms

  constructor(
    private capacity: number,
    private baseDripRate: number
  ) {
    this.dripRate = baseDripRate;
  }

  tryAdd(tokens: number): boolean {
    this.drip();
    if (this.level + tokens > this.capacity) {
      return false;
    }
    this.level += tokens;
    return true;
  }

  private drip(): void {
    const now = Date.now();
    const elapsed = now - this.lastDrip;
    this.level = Math.max(0, this.level - elapsed * this.dripRate);
    this.lastDrip = now;
  }

  /** Adapt drip rate based on system load */
  adaptRate(load: number): void {
    // Higher load → faster drip (more permissive when system can handle it)
    // Lower load → slower drip (more conservative when busy)
    this.dripRate = this.baseDripRate * (1 + (1 - load) * 0.5);
  }
}
```

---

#### Problem 40: No Audit Log Persistence

**The Issue**

Audit log is in-memory only:
- Lost on server restart
- Can't analyze historical access
- No compliance trail

**Direct Solution**

Implement **persistent audit logging**:

```typescript
interface PersistentAuditLog {
  /** Append entry (buffered write) */
  append(entry: AuditEntry): void;

  /** Query historical entries */
  query(filter: AuditFilter): Promise<AuditEntry[]>;

  /** Export for compliance */
  export(format: 'json' | 'csv', filter: AuditFilter): Promise<Buffer>;
}

interface AuditEntry {
  timestamp: Date;
  sessionId: string;
  userId?: string;
  tool: string;
  params: unknown;
  result: 'success' | 'error' | 'rate_limited';
  durationMs: number;
  tokensUsed?: number;
}

class FileAuditLog implements PersistentAuditLog {
  private buffer: AuditEntry[] = [];
  private flushInterval: NodeJS.Timeout;

  constructor(
    private logDir: string,
    private flushIntervalMs: number = 5000
  ) {
    this.flushInterval = setInterval(() => this.flush(), flushIntervalMs);
  }

  append(entry: AuditEntry): void {
    this.buffer.push(entry);
    if (this.buffer.length >= 100) {
      this.flush();
    }
  }

  private async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    const entries = this.buffer;
    this.buffer = [];

    const date = new Date().toISOString().split('T')[0];
    const logFile = path.join(this.logDir, `audit-${date}.jsonl`);

    await fs.appendFile(
      logFile,
      entries.map(e => JSON.stringify(e)).join('\n') + '\n'
    );
  }
}
```

**Propagating Impact**

Persistent audit enables:
- Historical analysis
- Compliance reporting
- Abuse detection
- Usage analytics

**World-Class Enhancement: Write-Ahead Logging with Crash Recovery (Masters' Synthesis)**

*"The audit log isn't just for compliance. It's your system of record. Treat it like a database transaction log."* — Synthesis of Torvalds, Lamport, Hickey

The file-based audit log above is correct, but world-class systems need **write-ahead logging (WAL) with crash recovery**:

```typescript
/**
 * WRITE-AHEAD LOGGING FOR AUDIT (TORVALDS' RELIABILITY)
 *
 * "Data must survive power failure. Use fsync. Use WAL. No shortcuts."
 *
 * WAL ensures:
 * 1. No audit entry is ever lost (durability)
 * 2. Crash recovery is automatic (consistency)
 * 3. Concurrent writes are serialized (isolation)
 * 4. Failed writes are detected (integrity)
 */
interface WriteAheadAuditLog {
  /** Sequence number for ordering */
  readonly sequence: bigint;

  /** Append entry with durability guarantee */
  append(entry: AuditEntry): Promise<AppendResult>;

  /** Checkpoint current WAL to archive */
  checkpoint(): Promise<CheckpointResult>;

  /** Recover from crash (called on startup) */
  recover(): Promise<RecoveryResult>;

  /** Query with optional time-travel */
  query(
    filter: AuditFilter,
    asOf?: Timestamp
  ): AsyncIterable<AuditEntry>;
}

interface AppendResult {
  /** Assigned sequence number */
  sequence: bigint;
  /** Time of durable write */
  durableAt: Timestamp;
  /** Checksum for verification */
  checksum: string;
}

/**
 * CRASH RECOVERY PROTOCOL
 *
 * On startup:
 * 1. Scan WAL from last checkpoint
 * 2. Verify checksums for each entry
 * 3. Rebuild index from valid entries
 * 4. Mark corrupted entries as suspect
 */
interface RecoveryResult {
  /** Number of entries recovered */
  recovered: number;
  /** Number of entries lost (corrupted) */
  lost: number;
  /** Last valid sequence number */
  lastSequence: bigint;
  /** Recovery duration */
  durationMs: number;
}

/**
 * MEMORY-MAPPED WAL FOR PERFORMANCE (TORVALDS)
 *
 * Use mmap for the active WAL segment.
 * Use fsync only on segment rotation.
 * This gives durability with minimal latency.
 */
class MmapAuditLog implements WriteAheadAuditLog {
  private activeSegment: MmapSegment;
  private sequence: bigint = 0n;
  private checkpointInterval: NodeJS.Timeout;

  constructor(
    private logDir: string,
    private segmentSize: number = 64 * 1024 * 1024, // 64MB segments
    private checkpointIntervalMs: number = 60_000
  ) {
    this.activeSegment = this.openOrCreateSegment();
    this.sequence = this.recoverSequence();
    this.checkpointInterval = setInterval(
      () => this.checkpoint(),
      checkpointIntervalMs
    );
  }

  async append(entry: AuditEntry): Promise<AppendResult> {
    const seq = this.sequence++;
    const record: WALRecord = {
      sequence: seq,
      timestamp: Date.now(),
      entry,
      checksum: this.computeChecksum(entry),
    };

    // Write to mmap (atomic within page)
    const offset = this.activeSegment.append(record);

    // Rotate segment if needed
    if (offset > this.segmentSize * 0.9) {
      await this.rotateSegment();
    }

    return {
      sequence: seq,
      durableAt: Date.now(),
      checksum: record.checksum,
    };
  }

  async recover(): Promise<RecoveryResult> {
    const segments = await this.listSegments();
    let recovered = 0;
    let lost = 0;
    let lastSequence = 0n;

    for (const segment of segments) {
      for await (const record of this.readSegment(segment)) {
        if (this.verifyChecksum(record)) {
          recovered++;
          lastSequence = record.sequence > lastSequence
            ? record.sequence
            : lastSequence;
        } else {
          lost++;
          console.warn(`[audit] Corrupted record at sequence ${record.sequence}`);
        }
      }
    }

    this.sequence = lastSequence + 1n;

    return { recovered, lost, lastSequence, durationMs: 0 };
  }

  private computeChecksum(entry: AuditEntry): string {
    // Use xxHash for speed, SHA-256 for paranoia
    return xxhash64(JSON.stringify(entry)).toString(16);
  }

  private verifyChecksum(record: WALRecord): boolean {
    return this.computeChecksum(record.entry) === record.checksum;
  }
}

/**
 * IMMUTABLE AUDIT ARCHIVE (HICKEY'S IMMUTABILITY)
 *
 * Checkpointed segments are immutable and content-addressed.
 * This enables:
 * - Efficient deduplication
 * - Cryptographic proof of audit history
 * - Easy replication to cold storage
 */
interface ImmutableAuditArchive {
  /** Archive a completed segment */
  archive(segment: Segment): Promise<ArchiveResult>;

  /** Get segment by content hash */
  getByHash(hash: string): Promise<Segment | null>;

  /** List all archived segments */
  list(): AsyncIterable<SegmentMetadata>;

  /** Export to external storage (S3, etc.) */
  export(destination: StorageDestination): Promise<ExportResult>;
}

/**
 * TLA+ SPECIFICATION FOR AUDIT DURABILITY (LAMPORT)
 */
const AUDIT_WAL_TLA = `
---- MODULE AuditWAL ----
EXTENDS Naturals, Sequences

VARIABLES wal, checkpoint, sequence

DurabilityInvariant ==
  \\A e \\in CommittedEntries:
    e \\in wal \\/ e \\in ArchivedSegments

OrderingInvariant ==
  \\A e1, e2 \\in wal:
    e1.sequence < e2.sequence => e1.timestamp =< e2.timestamp

CrashRecovery ==
  AfterCrash =>
    \\A e \\in wal: Checksum(e) = e.checksum =>
      e \\in RecoveredEntries

====
`;
```

**Performance Targets (Carmack)**:
- Append latency: <1ms (mmap, no fsync per entry)
- Recovery time: <1s for 1M entries
- Query throughput: 100K entries/second for filtered scans

---

### Subsystem 9: Output Types

**Overview**: Complex nested structures (LibrarianResponse, ContextPack, SynthesizedResponse, etc.) with many optional fields.

#### Problem 41: Response Too Large

**The Issue**

`LibrarianResponse` can be 50-100KB:
- Nested packs with full code snippets
- Verbose engine outputs
- Full synthesis with citations
- Bloats caches
- Slow to serialize

**Direct Solution**

Implement **response streaming and pagination**:

```typescript
interface StreamingLibrarianResponse {
  /** Metadata available immediately */
  metadata: ResponseMetadata;

  /** Stream of packs (don't load all at once) */
  packs: AsyncIterable<ContextPack>;

  /** Synthesis available after packs */
  getSynthesis(): Promise<SynthesizedResponse>;

  /** Engine results available on demand */
  getEngineResults(): Promise<LibrarianEngineResults>;
}

interface ResponseMetadata {
  queryId: string;
  totalPackCount: number;
  estimatedTokens: number;
  cacheHit: boolean;
  latencyMs: number;
}

// Pagination for large pack sets
interface PaginatedPackResponse {
  packs: ContextPack[];
  pagination: {
    offset: number;
    limit: number;
    total: number;
    hasMore: boolean;
  };
}

// Usage
const response = await LiBrainian.queryStreaming(query);

console.log(`Found ${response.metadata.totalPackCount} packs`);

// Process packs as they arrive
for await (const pack of response.packs) {
  console.log(pack.summary);
  if (/* have enough context */) break;
}

// Only get synthesis if needed
if (needsSynthesis) {
  const synthesis = await response.getSynthesis();
}
```

**Propagating Impact**

Streaming/pagination enables:
- Faster time to first result
- Memory-efficient processing
- Early termination when satisfied
- Better cache efficiency (cache pages not full response)

---

#### Problem 42: No Response Versioning

**The Issue**

Response structures have no version field:
- Breaking changes would break consumers
- No migration path
- No deprecation warnings

**Direct Solution**

Implement **response schema versioning**:

```typescript
interface VersionedResponse<T> {
  /** Schema version */
  _schemaVersion: string;

  /** Deprecation warnings */
  _deprecations?: string[];

  /** The actual response data */
  data: T;
}

const CURRENT_SCHEMA_VERSION = '2.0.0';

const SCHEMA_MIGRATIONS: Map<string, Migration> = new Map([
  ['1.0.0→2.0.0', {
    transform: (old: V1Response): V2Response => ({
      ...old,
      // Migration logic
    }),
    warnings: ['Field `oldField` renamed to `newField`'],
  }],
]);

function wrapResponse<T>(data: T): VersionedResponse<T> {
  return {
    _schemaVersion: CURRENT_SCHEMA_VERSION,
    _deprecations: [],
    data,
  };
}

function migrateResponse(
  response: VersionedResponse<unknown>,
  targetVersion: string
): VersionedResponse<unknown> {
  let current = response;

  while (current._schemaVersion !== targetVersion) {
    const migrationKey = `${current._schemaVersion}→${nextVersion(current._schemaVersion)}`;
    const migration = SCHEMA_MIGRATIONS.get(migrationKey);

    if (!migration) {
      throw new Error(`No migration path from ${current._schemaVersion} to ${targetVersion}`);
    }

    current = {
      _schemaVersion: nextVersion(current._schemaVersion),
      _deprecations: [...(current._deprecations || []), ...migration.warnings],
      data: migration.transform(current.data),
    };
  }

  return current;
}
```

**Propagating Impact**

Response versioning enables:
- Safe schema evolution
- Deprecation warnings
- Migration paths
- Backward compatibility periods

**World-Class Enhancement: Algebraic Schema Evolution (Masters' Synthesis)**

*"Schema evolution isn't an afterthought—it's a fundamental part of the type system. Make illegal states unrepresentable, including illegal migrations."* — Synthesis of Hejlsberg, Wirth, Liskov

The migration map above is correct, but world-class systems need **algebraic schema evolution** with compile-time guarantees:

```typescript
/**
 * ALGEBRAIC SCHEMA EVOLUTION (HEJLSBERG'S TYPE SAFETY)
 *
 * Schema changes are modeled as algebraic transformations:
 * - AddField<T, K, V>: Add optional field (always safe)
 * - RequireField<T, K>: Make field required (migration needed)
 * - RemoveField<T, K>: Remove field (deprecation period)
 * - RenameField<T, K1, K2>: Rename field (bidirectional migration)
 * - TransformField<T, K, F>: Transform field value (pure function)
 *
 * The type system enforces that every migration path is well-typed.
 */

/** Schema version as phantom type */
type SchemaVersion<V extends string> = { readonly __version: V };

/** Versioned response with phantom type */
interface VersionedResponse<V extends string, T> {
  readonly _version: SchemaVersion<V>;
  readonly data: T;
}

/** Migration function type */
type Migration<From, To> = (from: From) => To;

/** Type-safe migration registry */
interface MigrationRegistry {
  /** Register a migration (compile-time type check) */
  register<From, To>(
    fromVersion: string,
    toVersion: string,
    migration: Migration<From, To>
  ): void;

  /** Get migration path (returns undefined if no path) */
  getPath(from: string, to: string): MigrationPath | undefined;

  /** Migrate data along path */
  migrate<T>(data: unknown, from: string, to: string): T;
}

/**
 * BACKWARDS/FORWARDS COMPATIBILITY (LISKOV'S SUBSTITUTION)
 *
 * "A v2 response should be usable wherever v1 was expected."
 *
 * This requires:
 * - Adding fields is always safe (ignored by old consumers)
 * - Removing fields requires deprecation period
 * - Changing field types requires transform migrations
 */
interface CompatibilityContract<V1, V2> {
  /** V2 can be downgraded to V1 */
  readonly backwardsCompatible: boolean;

  /** V1 can be upgraded to V2 */
  readonly forwardsCompatible: boolean;

  /** Fields that changed between versions */
  readonly changes: FieldChange[];

  /** Warnings to emit when using old version */
  readonly deprecations: string[];
}

type FieldChange =
  | { kind: 'added'; field: string; defaultValue: unknown }
  | { kind: 'removed'; field: string; lastVersion: string }
  | { kind: 'renamed'; from: string; to: string }
  | { kind: 'typeChanged'; field: string; migration: string };

/**
 * CONTENT-ADDRESSED SCHEMAS (HICKEY'S IMMUTABILITY)
 *
 * Schemas are content-addressed by hash.
 * This means:
 * - Same schema always gets same hash
 * - Schema evolution creates new hashes
 * - Can detect schema drift automatically
 */
interface ContentAddressedSchema {
  /** Schema hash (content-addressed) */
  readonly hash: string;

  /** Human-readable version string */
  readonly version: string;

  /** Schema definition (JSON Schema or similar) */
  readonly definition: SchemaDefinition;

  /** Parent schemas (for migration graph) */
  readonly parents: string[];

  /** Compute migration to target schema */
  migrationTo(target: ContentAddressedSchema): Migration<unknown, unknown>;
}

/**
 * RUNTIME VALIDATION WITH ZOD (VAN ROSSUM'S PRAGMATISM)
 *
 * "Types are nice, but you need runtime validation too."
 *
 * Use Zod for:
 * - Runtime schema validation
 * - Automatic migration on parse
 * - Clear error messages for consumers
 */
import { z } from 'zod';

const ResponseV1 = z.object({
  content: z.string(),
  confidence: z.number().min(0).max(1),
});

const ResponseV2 = z.object({
  content: z.string(),
  confidence: z.number().min(0).max(1),
  sources: z.array(z.string()).default([]),
  calibrated: z.boolean().default(false),
});

const ResponseV3 = z.object({
  content: z.string(),
  confidence: z.object({
    raw: z.number().min(0).max(1),
    calibrated: z.number().min(0).max(1),
    type: z.enum(['syntactic', 'behavioral', 'intentional', 'normative', 'predictive']),
  }),
  sources: z.array(z.object({
    id: z.string(),
    confidence: z.number(),
    excerpt: z.string().optional(),
  })),
});

// Migration functions
const v1ToV2 = (v1: z.infer<typeof ResponseV1>): z.infer<typeof ResponseV2> => ({
  ...v1,
  sources: [],
  calibrated: false,
});

const v2ToV3 = (v2: z.infer<typeof ResponseV2>): z.infer<typeof ResponseV3> => ({
  content: v2.content,
  confidence: {
    raw: v2.confidence,
    calibrated: v2.calibrated ? v2.confidence : v2.confidence * 0.8,
    type: 'behavioral', // Default type
  },
  sources: v2.sources.map(s => ({ id: s, confidence: 0.5 })),
});

/**
 * AUTOMATED MIGRATION TESTING (HOPPER'S COMPILERS)
 *
 * "If it compiles, it should work. Make the compiler test your migrations."
 *
 * Generate round-trip tests for every migration:
 * - v1 → v2 → v1 should preserve data (minus added fields)
 * - Random v1 data should migrate without errors
 * - Edge cases should be explicitly tested
 */
interface MigrationTest {
  /** Test that migration preserves semantics */
  testSemantics(
    migration: Migration<unknown, unknown>,
    examples: unknown[]
  ): TestResult;

  /** Test round-trip (up then down) */
  testRoundTrip(
    up: Migration<unknown, unknown>,
    down: Migration<unknown, unknown>,
    examples: unknown[]
  ): TestResult;

  /** Property-based testing with fast-check */
  testProperties(
    migration: Migration<unknown, unknown>,
    schema: z.ZodType
  ): TestResult;
}
```

**Wirth's Simplicity**: Despite the algebraic rigor, the migration system should remain simple to use. A developer adding a field should not need to understand category theory—the complexity should be in the framework, not the API.

---

## Part X: Summary of All Problems

> ⚠️ **NOTE**: This summary is historical. See [Implementation Status](#implementation-status) at the top of this document for current status with commit references.

### By Severity (Updated 2026-01-20)

**Critical (Must Fix)**
| # | Problem | Subsystem | Status |
|---|---------|-----------|--------|
| A | Execution Engine not verified end-to-end | Core | ⚠️ Implemented (`technique_execution.ts`), verification pending |
| B | No Learning Loop Closure | Core | ✅ DONE (`learning_loop.ts`) |
| 17 | Query API Opacity | Query | ✅ DONE (`query.ts` stages) |
| 18 | Primitives Are Prose | Techniques | ✅ DONE (`technique_contracts.ts`) |
| 27 | No Per-File Timeout | Bootstrap | ⏳ Partial |
| 28 | Unbounded LLM Retry | Bootstrap | ⏳ Partial |

**High (Should Fix)**
| # | Problem | Subsystem | Status |
|---|---------|-----------|--------|
| 5 | Time Decay Fallacy | Confidence | ⏳ Open |
| 6 | Confidence Monism | Confidence | ⏳ Open |
| 19 | Keyword-Based Selection | Techniques | 🔄 IN PROGRESS (`composition_selector.ts`) |
| 24 | Monolithic Storage Interface | Storage | ⏳ Open |
| 32 | Monolithic Knowledge Schema | Knowledge | ⏳ Open |
| 37 | Episodes Not Used | Episodes | ⏳ Open |

**Medium (Nice to Fix)**
| # | Problem | Subsystem | Status |
|---|---------|-----------|--------|
| C | No Composition Customization | Techniques | ✅ DONE (`technique_composition_builder.ts`) |
| D | No Checkpointing | Execution | ✅ DONE (`technique_execution.ts`) |
| E | No Progressive Context | Sessions | ✅ DONE (`context_sessions.ts`) |
| 25 | No Transaction Boundaries | Storage | ⏳ Open |
| 30 | No Vector Normalization | Embeddings | ⏳ Open |
| 35 | Engines Cannot Chain | Engines | ⏳ Open |
| 39 | No Rate Limiting | MCP | ⏳ Open |

**Low (Future Improvement)**
| # | Problem | Subsystem | Status |
|---|---------|-----------|--------|
| 26 | Float32Array Overhead | Storage | ⏳ Open |
| 31 | Multi-Vector Redundancy | Embeddings | ⏳ Open |
| 36 | Verbose Engine Output | Engines | ⏳ Open |
| 40 | No Audit Persistence | MCP | ⏳ Open |
| 42 | No Response Versioning | Output | ⏳ Open |

### By Subsystem (Updated)

| Subsystem | Critical | High | Medium | Low | Done | Open |
|-----------|----------|------|--------|-----|------|------|
| Core/Query | 3 | 2 | 2 | 0 | **4** | 3 |
| Techniques | 1 | 1 | 1 | 0 | **2** | 1 |
| Confidence | 0 | 2 | 0 | 0 | 0 | 2 |
| Storage | 0 | 1 | 1 | 1 | 0 | 3 |
| Bootstrap | 2 | 0 | 1 | 0 | 1 | 2 |
| Embeddings | 0 | 0 | 1 | 1 | 0 | 2 |
| Knowledge | 0 | 1 | 0 | 0 | 0 | 1 |
| Engines | 0 | 0 | 1 | 1 | 0 | 2 |
| Episodes | 0 | 1 | 0 | 0 | 0 | 1 |
| MCP | 0 | 0 | 1 | 1 | 0 | 2 |
| Output | 0 | 0 | 0 | 1 | 0 | 1 |
| **Total** | **6** | **8** | **8** | **5** | **7** | **20** |

---

---

## Part XI: Making LiBrainian a Top GitHub Repository of All Time

This section synthesizes research on what makes the greatest GitHub repositories—both in terms of stars/popularity and in terms of genius, richness, and being beloved—and applies those lessons to LiBrainian.

### Research: The Anatomy of GitHub Greatness

#### A. The Most Starred Repositories

Based on [GitHub Ranking data](https://github.com/EvanLi/Github-Ranking) and [analysis](https://gitstar-ranking.com/), the top repositories share key characteristics:

| Rank | Repository | Stars | What Makes It Great |
|------|------------|-------|---------------------|
| 1 | freeCodeCamp | 410k+ | Free education, massive community, clear mission |
| 2 | coding-interview-university | 310k+ | One person's obsessive documentation, practical value |
| 3 | developer-roadmap | 300k+ | Visual learning paths, actionable guidance |
| 4 | system-design-primer | 290k+ | Interview prep meets real learning |
| 5 | build-your-own-x | 280k+ | Learn by building, curated quality |
| 6 | React | 242k | Actually runs Facebook, proven at scale |
| 7 | Linux | 214k | Runs the world, meritocratic community |
| 8 | TensorFlow | 193k | Google's ML framework, enterprise backing |
| 9 | ohmyzsh | 184k | Delightful experience, 2400+ contributors |

**Pattern 1: Educational Value Dominates**
- 6 of top 10 are primarily educational (not tools)
- Stars correlate with "teaching developers something valuable"
- Lists and roadmaps outperform actual software

**Pattern 2: Clear, Singular Purpose**
- Each repo does ONE thing exceptionally well
- "A study plan to become a software engineer"
- "Master programming by rebuilding technologies"

**Pattern 3: Immediate Value**
- Users get value within minutes
- No complex setup, no learning curve
- README is the product

---

#### B. The "Genius" Repositories: Design Excellence

Some repositories are revered not for stars but for **architectural brilliance**. Based on [The Architecture of Open Source Applications](https://aosabook.org/en/) and [Hacker News discussions](https://news.ycombinator.com/item?id=18037613):

**SQLite: The "Do One Thing Perfectly" Philosophy**
- "SQLite does not compete with client/server databases. SQLite competes with fopen()."
- Single file, zero configuration, "just works"
- 150,000+ test cases, aviation-grade reliability
- Design principle: **simplicity over features**

**Redis: The "Simple Data Structures" Philosophy**
- Not a database, but "data structures over the network"
- Single-threaded by design (simpler = faster for its use case)
- Commands are verbs: GET, SET, LPUSH (intuitive API)
- Design principle: **primitive building blocks**

**PostgreSQL: The "Extensibility" Philosophy**
- You can define your own types, operators, functions
- "The right thing" over "the fast thing"
- 30+ years of careful evolution
- Design principle: **correctness and extensibility**

**Git: The "Content-Addressable" Philosophy**
- Everything is a hash
- Immutable history by design
- Distributed by default
- Design principle: **mathematical elegance**

**htmx: The "HTML is the API" Philosophy**
- Hypermedia-driven, not JavaScript-driven
- 14KB, no build step, progressive enhancement
- Design principle: **return to fundamentals**

---

#### C. The Beloved Repositories: Community and Soul

Some repositories are loved beyond their utility. Based on [open source community research](https://opensource.guide/building-community/) and [Ben Balter's community-building tips](https://ben.balter.com/2017/11/10/twelve-tips-for-growing-communities-around-your-open-source-project/):

**What Makes Repositories Beloved**:

1. **Delightful Experience** (ohmyzsh)
   - Beautiful defaults, personality in documentation
   - "A delightful community-driven framework"
   - Easter eggs, humor, warmth

2. **Radical Openness** (Rust, CNCF projects)
   - Public RFCs, transparent decision-making
   - Anyone can propose changes to the language
   - Governance is documented and followed

3. **Contributor Celebration** (all-contributors)
   - Every contribution recognized, not just code
   - "All contributors" badges, release notes mentions
   - Community members become leaders

4. **Opinionated but Welcoming** (Laravel, Rails)
   - Strong conventions reduce decision fatigue
   - But extensible when you need to break rules
   - "Convention over configuration"

5. **Documentation as First-Class** (Stripe, Twilio)
   - API docs that developers actually enjoy reading
   - Interactive examples, copy-paste ready
   - Answers the question before you ask it

---

### How to Make LiBrainian Great

Based on this research, here's a comprehensive strategy:

#### Strategy 1: Find the "SQLite Insight"

SQLite's genius is a single sentence: "SQLite competes with fopen(), not Oracle."

**LiBrainian needs its "one insight"**:

Current framing (too complex):
> "An agentic epistemological system for meaningful understanding of codebases"

Proposed reframing options:
- "LiBrainian competes with Ctrl+F, not with human understanding"
- "Knowledge that knows when it's wrong"
- "The codebase that explains itself"
- "Machine epistemology for code: understanding you can verify"

**Action Items**:
- [ ] Distill to one memorable sentence
- [ ] Make that sentence the first line of README
- [ ] Every design decision evaluated against that insight

---

#### Strategy 2: The "5-Minute Magic" Principle

Top repos deliver value in under 5 minutes. Currently, LiBrainian requires:
- Provider setup
- Bootstrap (30+ seconds)
- Understanding complex APIs
- LLM dependency

**Proposed "5-Minute Experience"**:

```bash
# Install
npm install -g librainian

# Instant value (no bootstrap, no LLM)
LiBrainian explain src/auth/login.ts
# → Reads file, uses local heuristics, gives instant summary

# Magic moment (with LLM)
LiBrainian understand "How does authentication work?"
# → Semantic search + LLM synthesis, works first time

# Deep mode (after bootstrap)
LiBrainian bootstrap && LiBrainian query --depth L3 "auth flow"
```

**Action Items**:
- [ ] Create no-dependency instant mode
- [ ] Ship single binary (no npm install)
- [ ] README shows working command in first 10 lines
- [ ] Screenshot/GIF of actual output

---

#### Strategy 3: The "Build-Your-Own" Educational Model

The top-starred repos are educational. LiBrainian should be **both a tool and a curriculum**.

**Proposed Structure**:

```
LiBrainian/
├── README.md           # 5-minute quick start
├── docs/
│   ├── learn/
│   │   ├── 01-epistemology-for-code.md     # Why confidence matters
│   │   ├── 02-why-rag-isnt-enough.md       # The synthesis requirement
│   │   ├── 03-building-a-knowledge-graph.md # From AST to understanding
│   │   ├── 04-technique-primitives.md       # Cognitive operations
│   │   └── 05-verification-that-works.md    # Epistemic hygiene
│   └── architecture/
│       ├── query-pipeline.md               # How queries flow
│       ├── confidence-calibration.md       # The math of uncertainty
│       └── multi-vector-retrieval.md       # Why 5 vectors?
└── examples/
    ├── minimal/          # Simplest possible usage
    ├── intermediate/     # Common patterns
    └── advanced/        # Full power
```

**Action Items**:
- [ ] Create learning path documentation
- [ ] Each concept with runnable examples
- [ ] "Build your own mini-LiBrainian" tutorial
- [ ] Video walkthroughs of architecture

---

#### Strategy 4: The "Delight Budget"

ohmyzsh has 184k stars partly because it's **fun**. Every interaction has personality.

**Proposed Delight Additions**:

```typescript
// Fun progress messages during bootstrap
"📚 Reading your codebase... (this is the fun part)"
"🧠 Teaching myself about your architecture..."
"🔍 Discovering hidden connections..."
"✨ Knowledge crystallized. Ask me anything."

// Expressive confidence
confidence: 0.92 → "I'm quite confident about this (92%)"
confidence: 0.45 → "I'm not sure, but here's my best guess (45%)"
confidence: 0.15 → "I really don't know, but if I had to guess..."

// Easter eggs
LiBrainian explain --philosophical src/meaning-of-life.ts
→ "42. But more specifically..."
```

**Action Items**:
- [ ] Add personality to CLI output
- [ ] Create beautiful terminal visualizations
- [ ] Add `--verbose` that's actually interesting to read
- [ ] Make error messages helpful and human

---

#### Strategy 5: The "Radical Transparency" Model

Rust is beloved because every decision is public. LiBrainian should document its own evolution.

**Proposed Transparency Artifacts**:

```
docs/
├── decisions/              # ADRs (Architecture Decision Records)
│   ├── 001-why-llm-required.md
│   ├── 002-confidence-model.md
│   ├── 003-technique-primitives.md
│   └── ...
├── philosophy/
│   ├── PRINCIPLES.md       # Core beliefs
│   ├── TRADEOFFS.md        # What we sacrifice and why
│   └── NON-GOALS.md        # What we explicitly won't do
└── experiments/
    ├── failed/             # Things we tried that didn't work
    │   ├── time-based-decay.md  # Why we moved to change-based
    │   └── keyword-matching.md  # Why semantic selection
    └── in-progress/        # Active experiments
```

**Action Items**:
- [ ] Create ADR template and first 10 ADRs
- [ ] Document every major design decision
- [ ] Share experiments, including failures
- [ ] Monthly "state of LiBrainian" posts

---

#### Strategy 6: The "Contributor Funnel"

Based on [community growth research](https://opensource.guide/building-community/), think of contributors as moving through stages:

```
Aware → User → Contributor → Maintainer → Leader

Stage 1: Aware
- Finds repo via search, recommendation, article
- Action: SEO, articles, conference talks, tweets

Stage 2: User
- Tries the tool, gets value
- Action: 5-minute experience, great docs, quick wins

Stage 3: Contributor
- Wants to give back, fix something, add feature
- Action: Good first issues, contribution guide, mentorship

Stage 4: Maintainer
- Regular contributor, takes ownership of area
- Action: Commit rights, area ownership, recognition

Stage 5: Leader
- Shapes direction, mentors others
- Action: Governance role, public recognition, conference speaking
```

**Specific Contribution Opportunities**:

| Contribution Type | Difficulty | Impact | Good For |
|------------------|------------|--------|----------|
| Fix typo in docs | Easy | Low | First-timers |
| Add technique primitive | Medium | Medium | Domain experts |
| Improve engine | Hard | High | Systems programmers |
| Add language support | Medium | High | Polyglot developers |
| Write tutorials | Easy | High | Technical writers |
| Performance optimization | Hard | High | Systems experts |

**Action Items**:
- [ ] Create CONTRIBUTING.md with clear paths
- [ ] Label issues with difficulty and area
- [ ] Mentorship program for first contributors
- [ ] Celebrate every contribution publicly

---

#### Strategy 7: The "Design Language" Principle

Great projects have consistent design language. Every API, every output, every error follows patterns.

**Proposed LiBrainian Design Language**:

```typescript
// Principle 1: Confidence is always explicit
interface AnyResult {
  value: T;
  confidence: number;
  explanation: string;  // Why this confidence?
}

// Principle 2: Degradation is announced, never silent
type Result<T> =
  | { success: true; value: T }
  | { success: false; degraded: true; partialValue: Partial<T>; reason: string }
  | { success: false; degraded: false; error: Error };

// Principle 3: Everything is queryable
LiBrainian.query("why is confidence 0.45?")
LiBrainian.query("what would increase confidence?")
LiBrainian.query("when was this last verified?")

// Principle 4: No magic numbers
const SIMILARITY_THRESHOLD = 0.45;  // Never. Always named.
const config = {
  retrieval: {
    similarityThreshold: 0.45,
    similarityThresholdExplanation: "Based on empirical calibration from 10k queries"
  }
};

// Principle 5: Errors are opportunities
{
  error: "Provider unavailable",
  recovery: [
    "Check provider credentials",
    "Use --offline mode for structural-only queries",
    "Run `LiBrainian diagnose` for detailed status"
  ],
  documentation: "https://LiBrainian.dev/docs/providers"
}
```

**Action Items**:
- [ ] Document design language formally
- [ ] Audit all APIs for consistency
- [ ] Create linting rules for design language
- [ ] Review PRs against design language

---

#### Strategy 8: The "Benchmark Everything" Principle

TensorFlow and PyTorch compete on benchmarks. LiBrainian should have measurable claims.

**Proposed Benchmarks**:

| Benchmark | Metric | Current | Goal |
|-----------|--------|---------|------|
| Bootstrap speed | seconds/1000 files | ? | < 10s |
| Query latency | p50/p99 ms | ? | 50ms / 200ms |
| Confidence calibration | accuracy | ? | ±5% of stated |
| Retrieval precision | precision@5 | ? | > 0.8 |
| Context completeness | coverage % | ? | > 85% |
| Memory usage | MB per 1000 entities | ? | < 50MB |

**Benchmark Infrastructure**:

```bash
# Run benchmarks
LiBrainian benchmark --suite full

# Compare versions
LiBrainian benchmark --compare v1.0.0 v2.0.0

# Public dashboard
https://LiBrainian.dev/benchmarks
```

**Action Items**:
- [ ] Create benchmark suite
- [ ] Establish baseline numbers
- [ ] Public benchmark dashboard
- [ ] Regression tests for performance

---

#### Strategy 9: The "Rich Ecosystem" Principle

The best repos have ecosystems. Not one tool, but a family.

**Proposed Ecosystem**:

```
Core:
  LiBrainian          - Core library
  @LiBrainian/cli     - Command-line interface

Integrations:
  @LiBrainian/vscode  - VS Code extension
  @LiBrainian/neovim  - Neovim plugin
  @LiBrainian/mcp     - Model Context Protocol server
  @LiBrainian/lsp     - Language Server Protocol

Language Support:
  @LiBrainian/parser-typescript
  @LiBrainian/parser-python
  @LiBrainian/parser-rust
  @LiBrainian/parser-go

Extensions:
  @LiBrainian/engine-security   - Security-focused analysis
  @LiBrainian/engine-testing    - Test coverage insights
  @LiBrainian/engine-performance - Performance analysis

Community:
  awesome-LiBrainian  - Curated extensions and resources
  LiBrainian-examples - Example projects
```

**Action Items**:
- [ ] Modular architecture enabling extensions
- [ ] Plugin API documentation
- [ ] Starter template for extensions
- [ ] awesome-LiBrainian list

---

#### Strategy 10: The "Opinionated Defaults, Escapable Conventions" Principle

Laravel and Rails succeed by making 80% of decisions for you, but letting you override.

**Proposed Defaults**:

```typescript
// Zero config: sensible defaults
const LiBrainian = await createLibrarian();
// Uses: local embeddings, L2 depth, standard engines, SQLite storage

// But everything is configurable
const LiBrainian = await createLibrarian({
  embeddings: { provider: 'voyage-code-3', dimension: 1024 },
  storage: { type: 'postgres', connectionString: '...' },
  engines: {
    enabled: ['tdd', 'security'],
    custom: [myCustomEngine]
  },
  confidence: {
    calibrationSource: './calibration-data.json'
  }
});
```

**Action Items**:
- [ ] Audit all config options for sensible defaults
- [ ] Document what defaults are and why
- [ ] Allow config file AND code config AND CLI flags
- [ ] Migration path when defaults change

---

### The "10 Commandments" of LiBrainian Excellence

Based on all research, these are the guiding principles:

1. **Immediate Value**: First use delivers insight in under 5 minutes
2. **One Insight**: Core philosophy in one sentence
3. **Confidence Everywhere**: Never claim certainty you don't have
4. **Degrade Gracefully**: Partial results beat complete failures
5. **Transparent Decisions**: Document why, not just what
6. **Delightful Experience**: Personality in every interaction
7. **Benchmark Claims**: Numbers for every capability
8. **Contributor First**: Easy to contribute, hard to break
9. **Escape Hatches**: Opinionated but not imprisoned
10. **Learn to Teach**: Education as first-class mission

---

### Implementation Roadmap for Greatness

**Phase 1: Core Excellence (Month 1-2)**
- [ ] Implement all fixes from Parts I-X
- [ ] Create 5-minute magic experience
- [ ] Write design language documentation
- [ ] Establish benchmark baseline

**Phase 2: Documentation & Education (Month 2-3)**
- [ ] Learning path documentation
- [ ] ADR retrospective (first 10 decisions)
- [ ] Video architecture walkthrough
- [ ] Build-your-own-LiBrainian tutorial

**Phase 3: Community Building (Month 3-4)**
- [ ] Contribution guide with clear paths
- [ ] Good first issues labeled
- [ ] Discord/community setup
- [ ] First external contributor celebrated

**Phase 4: Ecosystem (Month 4-6)**
- [ ] VS Code extension
- [ ] Plugin API stabilized
- [ ] awesome-LiBrainian list
- [ ] First community extensions

**Phase 5: Public Launch (Month 6+)**
- [ ] Product Hunt launch
- [ ] Hacker News Show HN
- [ ] Dev.to article series
- [ ] Conference talk proposals

---

### Success Metrics

| Metric | 6 Month Goal | 1 Year Goal | "Great" Goal |
|--------|--------------|-------------|--------------|
| GitHub Stars | 1,000 | 10,000 | 50,000+ |
| Contributors | 10 | 50 | 200+ |
| Monthly Active Users | 100 | 1,000 | 10,000+ |
| Documentation Pages | 50 | 100 | 200+ |
| Community Extensions | 5 | 20 | 100+ |
| Conference Talks | 1 | 5 | 20+ |
| Academic Citations | 0 | 5 | 20+ |

---

### Sources

- [GitHub Ranking - Top 100 Stars](https://github.com/EvanLi/Github-Ranking)
- [Gitstar Ranking](https://gitstar-ranking.com/)
- [The Architecture of Open Source Applications](https://aosabook.org/en/)
- [Building Welcoming Communities - Open Source Guides](https://opensource.guide/building-community/)
- [Twelve Tips for Growing Communities - Ben Balter](https://ben.balter.com/2017/11/10/twelve-tips-for-growing-communities-around-your-open-source-project/)
- [Projects with Great Architecture Documentation - Hacker News](https://news.ycombinator.com/item?id=39819409)
- [High Code Quality Projects - Hacker News](https://news.ycombinator.com/item?id=18037613)
- [HTMX Success Stories - Hacker News](https://news.ycombinator.com/item?id=40840382)

---

## Part XII: Critical Gaps for Cutting-Edge Theorists (Jan 2026)

This section addresses what remains unacceptable or incomplete from the perspective of serious epistemologists, computational scientists, agentic systems theorists, and dynamical systems scientists at the frontier of their fields.

---

### A. Epistemological Critiques Beyond Parts I-IV

#### Problem 43: The Gettier Problem is Unaddressed

**The Issue**

The document treats knowledge as justified true belief—but since Gettier (1963), we know this is insufficient. An agent can have:
- A justified belief ("this function returns a string")
- That belief can be true
- Yet the justification can be accidentally correct (lucky coincidence)

LiBrainian's confidence system tracks justification strength, not whether the justification actually explains the truth. A passing test might justify a belief that happens to be true for the wrong reason (the test is flawed, but the code happens to work).

**Why This Matters**

If agents act on Gettier-knowledge (justified, true, but accidentally so), they will fail when conditions change because their "knowledge" was never properly grounded.

**Required Solution**

Implement **causal justification tracking**:

```typescript
interface CausalJustification extends EpistemicJustification {
  /** Does the justification causally explain the truth? */
  causalConnection: 'verified' | 'plausible' | 'unknown' | 'accidental';

  /** Counterfactual: if the evidence were different, would belief differ? */
  counterfactualSensitivity: number;

  /** Safety: in nearby possible worlds, does belief remain true? */
  modalSafety: number;
}

function isKnowledge(
  belief: Belief,
  justification: CausalJustification
): KnowledgeStatus {
  if (!belief.isTrue) return 'false_belief';
  if (!justification.isAdequate) return 'unjustified_true_belief';
  if (justification.causalConnection === 'accidental') return 'gettier_case';
  if (justification.modalSafety < 0.8) return 'unsafe_belief';
  return 'knowledge';
}
```

---

#### Problem 44: Social Epistemology is Missing

**The Issue**

The document treats knowledge as an individual phenomenon. But codebases are social artifacts:
- Multiple developers with different expertise
- Conflicting mental models
- Tribal knowledge that exists only in conversation
- Political dynamics affecting what gets documented

LiBrainian extracts individual artifacts but misses the **social epistemics** of how knowledge is created, contested, and legitimated in teams.

**Why This Matters**

A function's "intent" might be contested among team members. Whose interpretation does LiBrainian privilege? The most recent committer? The original author? The architect? This is an epistemic justice question.

**Required Solution**

Implement **multi-perspective knowledge with contestation tracking**:

```typescript
interface SocialKnowledge extends KnowledgeEntity {
  /** Different stakeholder perspectives */
  perspectives: Map<StakeholderRole, Perspective>;

  /** Active disagreements */
  contestations: Contestation[];

  /** Consensus level */
  consensusLevel: 'unanimous' | 'majority' | 'contested' | 'unknown';

  /** Authority structure for this knowledge */
  epistemicAuthority: AuthorityStructure;
}

interface Contestation {
  claim: Claim;
  perspectives: {
    role: StakeholderRole;
    position: 'affirm' | 'deny' | 'uncertain';
    justification: string;
  }[];
  resolutionStatus: 'unresolved' | 'deferred' | 'resolved';
}

type StakeholderRole =
  | 'original_author'
  | 'current_maintainer'
  | 'architect'
  | 'reviewer'
  | 'user'
  | 'llm_synthesis';
```

---

#### Problem 45: Epistemic Injustice in LLM Synthesis

**The Issue**

LLM synthesis inherits biases from training data:
- Overrepresents patterns from popular repositories
- Underrepresents unconventional but valid approaches
- May dismiss legitimate but minority coding styles as "wrong"
- Confidence calibration reflects aggregate, not local, validity

This is **testimonial injustice** (Miranda Fricker, 2007): systematic credibility deficits based on speaker identity.

**Why This Matters**

LiBrainian might confidently assert that a codebase's patterns are "unusual" or "anti-pattern" when they're actually valid for that domain—but underrepresented in LLM training data.

**Required Solution**

Implement **epistemic calibration by context**:

```typescript
interface BiasAwareConfidence {
  raw: number;

  /** Adjustment for training data representation */
  representationAdjustment: {
    inDomain: 'overrepresented' | 'typical' | 'underrepresented';
    adjustmentFactor: number;
    explanation: string;
  };

  /** Explicit uncertainty about bias */
  biasUncertainty: number;

  /** Flag for claims about "best practice" or "convention" */
  normativeClaimFlag: boolean;
}

function synthesizeWithBiasAwareness(
  context: ContextPack[],
  query: string
): BiasAwareSynthesis {
  const synthesis = await llm.synthesize(context, query);

  // Flag normative claims
  const normativeClaims = detectNormativeClaims(synthesis);
  for (const claim of normativeClaims) {
    claim.warning = `This is a normative claim ("should", "best practice").
      Validity depends on context not fully represented in training data.`;
  }

  return { ...synthesis, normativeClaims, biasDisclosure: true };
}
```

---

#### Problem 46: Defeasibility Theory is Shallow

**The Issue**

The defeater system distinguishes rebutting and undercutting defeaters, but doesn't implement:
- **Defeater hierarchies**: Some defeaters defeat other defeaters
- **Priority semantics**: How to resolve conflicting defeaters
- **Loops**: A defeats B defeats C defeats A
- **Specificity**: More specific information typically defeats more general

This is well-studied in non-monotonic reasoning (Pollock, 1995; Prakken & Sartor, 1997).

**Required Solution**

Implement **structured argumentation framework**:

```typescript
interface ArgumentationFramework {
  arguments: Map<ArgumentId, Argument>;
  attacks: AttackRelation[];
  preferences: PreferenceOrdering;

  /** Compute acceptable arguments using preferred semantics */
  computeExtensions(): ArgumentExtension[];

  /** Check if argument is skeptically/credulously accepted */
  isAccepted(arg: ArgumentId, mode: 'skeptical' | 'credulous'): boolean;
}

interface AttackRelation {
  attacker: ArgumentId;
  attacked: ArgumentId;
  attackType: 'rebut' | 'undercut' | 'undermine';
}

interface PreferenceOrdering {
  /** More specific arguments preferred over general */
  specificity: (a: Argument, b: Argument) => number;

  /** More recent evidence preferred */
  recency: (a: Argument, b: Argument) => number;

  /** Higher authority sources preferred */
  authority: (a: Argument, b: Argument) => number;

  /** Combined preference */
  combined: (a: Argument, b: Argument) => number;
}
```

---

### B. Computational Science Critiques

#### Problem 47: No Information-Theoretic Bounds

**The Issue**

The document provides no analysis of fundamental limits:
- What is the **mutual information** between code and synthesized knowledge?
- What is the **minimum description length** required for useful knowledge?
- What is the **channel capacity** of the retrieval-synthesis pipeline?

Without information-theoretic analysis, we can't know if observed failures are due to:
- Implementation bugs (fixable)
- Insufficient data (needs more indexing)
- Fundamental limits (unfixable)

**Required Solution**

Establish **information-theoretic foundations**:

```typescript
interface InformationTheoreticMetrics {
  /** Mutual information: I(Code; Synthesis) */
  mutualInformation: {
    value: number;  // bits
    estimationMethod: 'variational' | 'knn' | 'histogram';
    confidence: number;
  };

  /** Data processing inequality check */
  processingInequality: {
    /** I(Code; Embedding) >= I(Code; Synthesis) must hold */
    holds: boolean;
    embeddingInfo: number;
    synthesisInfo: number;
  };

  /** Minimum description length for knowledge base */
  mdl: {
    modelComplexity: number;  // bits
    dataFit: number;  // bits
    total: number;
  };

  /** Rate-distortion: what fidelity is achievable at current bandwidth? */
  rateDistortion: {
    currentRate: number;  // bits per entity
    achievableDistortion: number;  // at current rate
    optimalOperatingPoint: { rate: number; distortion: number };
  };
}
```

---

#### Problem 48: No Approximation Guarantees

**The Issue**

Every LiBrainian output is an approximation:
- Embeddings approximate semantic similarity
- Retrieval approximates relevance
- Synthesis approximates understanding
- Confidence approximates epistemic probability

Yet the document provides no **formal approximation bounds**:
- How close is embedding similarity to semantic similarity?
- What's the retrieval precision/recall guarantee?
- What approximation factor does synthesis achieve?

**Required Solution**

Formalize **approximation guarantees** where possible:

```typescript
interface ApproximationBounds {
  embedding: {
    /** Approximation ratio: d_embed(x,y) ≈ c·d_semantic(x,y) */
    approximationRatio: { lower: number; upper: number };
    /** Probability bound holds */
    holdsProbability: number;
    /** Conditions under which guarantee holds */
    conditions: string[];
  };

  retrieval: {
    /** Precision@k with probability p */
    precision: { k: number; value: number; probability: number };
    /** Recall@k with probability p */
    recall: { k: number; value: number; probability: number };
    /** Conditions */
    conditions: string[];
  };

  synthesis: {
    /** No formal guarantees possible for open-ended synthesis */
    formalGuarantee: false;
    /** Empirical bounds from calibration */
    empiricalBounds: {
      accuracyAtConfidence: Map<number, number>;  // e.g., 0.8 confidence → 0.75 accuracy
      calibrationError: number;
    };
  };
}
```

---

#### Problem 49: Sample Complexity for Calibration

**The Issue**

Confidence calibration requires historical data, but:
- How many samples are needed for reliable calibration?
- What's the statistical power of calibration with N episodes?
- What's the confidence interval on calibration estimates?

The bootstrap mode mentions "minimum episodes before transitioning" but provides no theoretical basis for the threshold.

**Required Solution**

Apply **PAC-learning analysis** to calibration:

```typescript
interface CalibrationSampleComplexity {
  /** Samples needed for (ε, δ)-calibration */
  requiredSamples: (epsilon: number, delta: number) => number;

  /** Current calibration confidence interval */
  currentConfidenceInterval: {
    sampleSize: number;
    epsilon: number;  // calibration error bound
    delta: number;    // failure probability
    interval: [number, number];
  };

  /** Power analysis: what effect size is detectable? */
  powerAnalysis: {
    currentPower: number;
    detectableEffectSize: number;
    samplesForPower80: number;
  };
}

// From PAC learning: m ≥ (1/2ε²) ln(2/δ) for (ε, δ)-calibration
function requiredSamplesForCalibration(
  epsilon: number,  // calibration error tolerance
  delta: number     // failure probability
): number {
  return Math.ceil((1 / (2 * epsilon * epsilon)) * Math.log(2 / delta));
}

// Example: for ε=0.05, δ=0.05, need m ≥ 738 samples
```

---

#### Problem 50: Verification Complexity is Unanalyzed

**The Issue**

Verification plans promise to "verify claims," but verification itself has computational complexity:
- Is the verification problem decidable?
- What complexity class does verification fall into?
- Are there claims that are fundamentally unverifiable?

The document doesn't distinguish between:
- **Syntactic verification** (type-checking): decidable, polynomial
- **Semantic verification** (behavior): generally undecidable (Rice's theorem)
- **Intentional verification** (purpose): undecidable (requires mind-reading)

**Required Solution**

Implement **verification complexity stratification**:

```typescript
interface VerificationComplexity {
  claim: Claim;

  /** Decidability status */
  decidability: 'decidable' | 'semi-decidable' | 'undecidable';

  /** Complexity class (if decidable) */
  complexityClass?: 'O(1)' | 'O(n)' | 'O(n^2)' | 'NP' | 'PSPACE' | 'EXPTIME';

  /** Practical verifiability */
  practicalStatus:
    | 'verifiable_now'        // Resources available
    | 'verifiable_bounded'    // With resource budget
    | 'verifiable_oracle'     // Needs human judgment
    | 'unverifiable';         // Fundamentally impossible

  /** For unverifiable claims: what's the best approximation? */
  approximationStrategy?: {
    method: 'testing' | 'fuzzing' | 'probabilistic' | 'heuristic';
    confidenceBound: number;
    falseNegativeRate: number;
  };
}

const CLAIM_COMPLEXITY_MAP: Record<ClaimType, VerificationComplexity> = {
  'returns_type': { decidability: 'decidable', complexityClass: 'O(n)' },
  'terminates': { decidability: 'undecidable', practicalStatus: 'verifiable_bounded' },
  'is_secure': { decidability: 'undecidable', practicalStatus: 'verifiable_oracle' },
  'intent_matches': { decidability: 'undecidable', practicalStatus: 'unverifiable' },
};
```

---

### C. Agentic Systems Theory Critiques

#### Problem 51: Multi-Agent Game Theory Missing

**The Issue**

LiBrainian serves multiple agents with potentially conflicting interests:
- Agent A might want information that helps it, harms Agent B
- Agents might strategically query to gain competitive advantage
- The knowledge system can be gamed

The document treats agents as passive consumers, not strategic actors in a multi-agent game.

**Required Solution**

Implement **mechanism design** for knowledge provision:

```typescript
interface MultiAgentKnowledgeGame {
  /** Agent utility functions (private) */
  agentUtilities: Map<AgentId, UtilityFunction>;

  /** Mechanism: how to aggregate agent interests */
  mechanism: KnowledgeMechanism;

  /** Equilibrium analysis */
  equilibrium: {
    type: 'Nash' | 'dominant' | 'correlated';
    strategies: Map<AgentId, QueryStrategy>;
    socialWelfare: number;
  };
}

interface KnowledgeMechanism {
  /** Is truthful reporting a dominant strategy? */
  incentiveCompatible: boolean;

  /** Does mechanism prevent information hoarding? */
  antiHoarding: boolean;

  /** Is allocation Pareto efficient? */
  paretoEfficient: boolean;

  /** Budget balance */
  budgetBalanced: boolean;
}

// Implement VCG-style mechanism for knowledge allocation
interface VCGKnowledgeMechanism extends KnowledgeMechanism {
  /** Price agent pays = externality imposed on others */
  computePrice(agent: AgentId, allocation: KnowledgeAllocation): number;

  /** Truthful reporting is dominant strategy under VCG */
  incentiveCompatible: true;
}
```

---

#### Problem 52: Credit Assignment in Agentic Learning

**The Issue**

The document acknowledges outcome attribution is hard but doesn't engage with the **credit assignment problem** as studied in RL theory:
- Which piece of retrieved knowledge caused success/failure?
- How do we attribute credit across a sequence of decisions?
- Temporal credit assignment: how far back does influence extend?

This is more fundamental than "what context was used"—it's about causal influence through time.

**Required Solution**

Implement **influence-based credit assignment**:

```typescript
interface CreditAssignmentFramework {
  /** Influence of knowledge piece on final outcome */
  computeInfluence(
    knowledge: KnowledgeEntity,
    trajectory: ExecutionTrajectory,
    outcome: Outcome
  ): InfluenceScore;

  /** Counterfactual: what would happen without this knowledge? */
  counterfactualAnalysis(
    knowledge: KnowledgeEntity,
    trajectory: ExecutionTrajectory
  ): CounterfactualOutcome;

  /** Shapley value: fair attribution across multiple knowledge pieces */
  computeShapleyValue(
    knowledgeSet: KnowledgeEntity[],
    trajectory: ExecutionTrajectory,
    outcome: Outcome
  ): Map<KnowledgeEntity, number>;
}

interface InfluenceScore {
  /** Direct causal influence */
  directInfluence: number;

  /** Indirect influence through other decisions */
  indirectInfluence: number;

  /** Temporal decay of influence */
  temporalProfile: number[];  // influence at each timestep

  /** Confidence in attribution */
  confidence: number;
}

// Shapley value computation (exponential but exact fair attribution)
function computeShapleyValues(
  knowledge: KnowledgeEntity[],
  valueFunction: (subset: KnowledgeEntity[]) => number
): Map<KnowledgeEntity, number> {
  const n = knowledge.length;
  const shapley = new Map<KnowledgeEntity, number>();

  for (const entity of knowledge) {
    let value = 0;
    // Average marginal contribution over all orderings
    for (const subset of powerset(knowledge.filter(k => k !== entity))) {
      const withoutEntity = valueFunction(subset);
      const withEntity = valueFunction([...subset, entity]);
      const weight = factorial(subset.length) * factorial(n - subset.length - 1) / factorial(n);
      value += weight * (withEntity - withoutEntity);
    }
    shapley.set(entity, value);
  }

  return shapley;
}
```

---

#### Problem 53: Agent-Knowledge Alignment

**The Issue**

Does LiBrainian-provided knowledge actually align agent behavior with human intent? The system optimizes for:
- Retrieval relevance
- Synthesis accuracy
- Confidence calibration

But these are **proxies** for the actual goal: agents taking actions that humans want.

This is a manifestation of **Goodhart's Law**: when a measure becomes a target, it ceases to be a good measure.

**Required Solution**

Implement **alignment-aware knowledge provision**:

```typescript
interface AlignmentAwareKnowledge {
  knowledge: KnowledgeEntity;

  /** Alignment assessment */
  alignment: {
    /** Does this knowledge help agent understand human intent? */
    intentAlignment: number;

    /** Could this knowledge lead to unintended actions? */
    misalignmentRisk: MisalignmentRisk[];

    /** Does agent's likely interpretation match human expectation? */
    interpretationAlignment: number;
  };
}

interface MisalignmentRisk {
  scenario: string;
  probability: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
  mitigation: string;
}

function assessAlignmentRisk(
  knowledge: KnowledgeEntity,
  agentProfile: AgentProfile,
  humanIntent: IntentSpecification
): AlignmentAssessment {
  // Model how agent will interpret knowledge
  const agentInterpretation = modelInterpretation(knowledge, agentProfile);

  // Compare to human expectation
  const divergence = computeDivergence(agentInterpretation, humanIntent);

  // Identify potential misalignment scenarios
  const risks = identifyMisalignmentScenarios(knowledge, agentProfile);

  return {
    alignmentScore: 1 - divergence,
    risks,
    recommendation: divergence > 0.3 ? 'add_clarification' : 'safe',
  };
}
```

---

### D. Dynamical Systems Science Critiques

#### Problem 54: No Stability Analysis

**The Issue**

The learning/confidence system is a dynamical system with feedback loops:
- Confidence → Agent behavior → Outcomes → Confidence updates

Is this system **stable**? Could it:
- Oscillate (confidence swings wildly)
- Diverge (runaway overconfidence)
- Collapse (everything becomes low confidence)

The document provides no stability analysis.

**Required Solution**

Implement **Lyapunov stability analysis**:

```typescript
interface SystemStabilityAnalysis {
  /** System state space */
  stateSpace: {
    dimensions: string[];  // e.g., ['avg_confidence', 'calibration_error', ...]
    bounds: Map<string, [number, number]>;
  };

  /** Fixed points (equilibria) */
  fixedPoints: FixedPoint[];

  /** Stability of each fixed point */
  stabilityAnalysis: Map<FixedPoint, StabilityType>;

  /** Lyapunov function (if exists) */
  lyapunovFunction?: {
    exists: boolean;
    function: (state: SystemState) => number;
    proofSketch: string;
  };

  /** Simulation-based stability test */
  empiricalStability: {
    perturbationRecovery: boolean;
    convergenceRate: number;
    attractorBasin: Region;
  };
}

type StabilityType =
  | 'asymptotically_stable'  // Returns to equilibrium
  | 'stable'                 // Stays near equilibrium
  | 'unstable'              // Diverges from equilibrium
  | 'saddle';               // Stable in some directions

interface FixedPoint {
  state: SystemState;
  type: 'attractor' | 'repeller' | 'saddle';
  eigenvalues: Complex[];  // From linearized dynamics
}

// Example: Confidence update dynamics
// c_{t+1} = c_t + α(outcome - c_t)
// This is stable iff 0 < α < 2
function analyzeConfidenceUpdateStability(alpha: number): StabilityType {
  // Fixed point: c* = E[outcome]
  // Linearized: c_{t+1} = (1-α)c_t + α·outcome
  // Eigenvalue: λ = 1 - α
  // Stable iff |λ| < 1, i.e., -1 < 1-α < 1, i.e., 0 < α < 2

  if (alpha <= 0 || alpha >= 2) return 'unstable';
  if (alpha === 1) return 'asymptotically_stable';  // Optimal
  return 'stable';
}
```

---

#### Problem 55: Bifurcation Analysis Missing

**The Issue**

As parameters change (learning rate, decay rate, threshold values), the system might undergo **bifurcations**: qualitative changes in behavior.

Examples:
- At some decay rate, the system might transition from stable to oscillatory
- At some confidence threshold, the system might "collapse" to always-low-confidence
- Changing retrieval parameters might cause sudden loss of coverage

These are catastrophic failures that appear suddenly.

**Required Solution**

Implement **bifurcation detection**:

```typescript
interface BifurcationAnalysis {
  /** Parameters being varied */
  parameters: string[];

  /** Detected bifurcation points */
  bifurcations: Bifurcation[];

  /** Safe operating region */
  safeRegion: ParameterRegion;

  /** Early warning indicators */
  earlyWarnings: EarlyWarningIndicator[];
}

interface Bifurcation {
  parameterName: string;
  criticalValue: number;
  type: 'saddle-node' | 'hopf' | 'transcritical' | 'pitchfork' | 'period-doubling';
  behaviorBefore: string;
  behaviorAfter: string;
  catastrophic: boolean;
}

interface EarlyWarningIndicator {
  metric: string;
  threshold: number;
  currentValue: number;
  status: 'safe' | 'warning' | 'critical';
}

// Example: detect approaching bifurcation
function detectApproachingBifurcation(
  timeSeries: number[],
  windowSize: number
): BifurcationWarning | null {
  // Critical slowing down: autocorrelation increases near bifurcation
  const autocorr = computeAutocorrelation(timeSeries, windowSize);

  // Variance increases near bifurcation
  const variance = computeVariance(timeSeries.slice(-windowSize));

  // Flickering: increased transitions between states
  const flickeringRate = computeFlickeringRate(timeSeries, windowSize);

  if (autocorr > 0.9 || variance > 2 * baselineVariance) {
    return {
      warning: 'approaching_bifurcation',
      indicators: { autocorr, variance, flickeringRate },
      recommendation: 'Reduce parameter change rate, increase monitoring',
    };
  }

  return null;
}
```

---

#### Problem 56: Emergence and Information Integration

**The Issue**

The document describes knowledge "emergence" (system-level understanding from component parts) but doesn't engage with **Integrated Information Theory** (IIT) or similar frameworks for measuring emergence.

Questions unanswered:
- Does LiBrainian's "understanding" have causal efficacy, or is it epiphenomenal?
- Is the synthesis more than the sum of retrieved parts?
- How do we measure the "integration" of knowledge?

**Required Solution**

Implement **integration metrics**:

```typescript
interface KnowledgeIntegrationMetrics {
  /** Integrated Information (Φ): measure of irreducibility */
  phi: {
    value: number;
    interpretation: string;  // e.g., "Synthesis is 2.3 bits more than sum of parts"
    minCut: Partition;       // Partition that minimizes integration
  };

  /** Emergence metric: macro vs micro predictability */
  emergence: {
    macroPredictability: number;
    microPredictability: number;
    emergenceScore: number;  // How much better is macro-level
  };

  /** Synergy: knowledge that exists only in combination */
  synergy: {
    value: number;
    synergisticClaims: Claim[];  // Claims not derivable from any subset
  };
}

// Phi (Integrated Information) computation
function computePhi(
  knowledgeSystem: KnowledgeGraph,
  stateSpace: StateSpace
): PhiValue {
  // Find minimum information partition (MIP)
  const partitions = generateAllPartitions(knowledgeSystem.nodes);
  let minPhi = Infinity;
  let mip: Partition | null = null;

  for (const partition of partitions) {
    // Compute effective information across partition
    const ei = computeEffectiveInformation(knowledgeSystem, partition);
    if (ei < minPhi) {
      minPhi = ei;
      mip = partition;
    }
  }

  return {
    value: minPhi,
    minCut: mip!,
    interpretation: minPhi > 0
      ? `System is integrated: ${minPhi.toFixed(2)} bits irreducible`
      : 'System is reducible to independent parts',
  };
}
```

---

#### Problem 57: Resilience and Recovery Dynamics

**The Issue**

The document discusses degradation modes but not **resilience**: the system's ability to recover from perturbations.

Questions unanswered:
- How does the system recover from corrupted knowledge?
- What's the "basin of attraction" for healthy operation?
- How large a perturbation can the system absorb?

**Required Solution**

Implement **resilience analysis**:

```typescript
interface ResilienceMetrics {
  /** Recovery time from perturbation */
  recoveryTime: {
    smallPerturbation: number;  // time to recover from 10% corruption
    mediumPerturbation: number; // time to recover from 50% corruption
    largePerturbation: number;  // time to recover from 90% corruption
    nonRecoverable: number;     // perturbation size that causes permanent damage
  };

  /** Basin of attraction */
  attractorBasin: {
    healthyOperationRegion: ParameterRegion;
    marginToFailure: number;  // distance to boundary of healthy region
    criticalParameters: string[];  // parameters that most affect margin
  };

  /** Adaptive capacity */
  adaptiveCapacity: {
    learningRate: number;
    noveltyAbsorption: number;  // how well system handles new patterns
    memoryHorizon: number;      // how far back system can learn from
  };
}

interface ResilienceTest {
  perturbation: Perturbation;
  preState: SystemState;
  postState: SystemState;
  recoveryTrajectory: SystemState[];
  recovered: boolean;
  recoveryTime: number;
  permanentDamage: string[];
}

// Test resilience via simulation
async function testResilience(
  system: KnowledgeSystem,
  perturbations: Perturbation[]
): Promise<ResilienceReport> {
  const results: ResilienceTest[] = [];

  for (const perturbation of perturbations) {
    const preState = captureState(system);

    // Apply perturbation
    applyPerturbation(system, perturbation);
    const postState = captureState(system);

    // Simulate recovery
    const trajectory: SystemState[] = [];
    for (let t = 0; t < MAX_RECOVERY_TIME; t++) {
      await system.step();  // One time step of system operation
      trajectory.push(captureState(system));

      if (isHealthy(trajectory[trajectory.length - 1])) {
        results.push({
          perturbation,
          preState,
          postState,
          recoveryTrajectory: trajectory,
          recovered: true,
          recoveryTime: t,
          permanentDamage: [],
        });
        break;
      }
    }
  }

  return analyzeResilienceResults(results);
}
```

#### Problem 48: No Approximation Guarantees

**The Issue**

Every LiBrainian output is an approximation:
- Embeddings approximate semantic similarity
- Retrieval approximates relevance
- Synthesis approximates understanding
- Confidence approximates epistemic probability

Yet the document provides no **formal approximation bounds**:
- How close is embedding similarity to semantic similarity?
- What's the retrieval precision/recall guarantee?
- What approximation factor does synthesis achieve?

**Elegant Solution: Probabilistically Approximately Correct (PAC) Guarantees**

```typescript
/**
 * PAC-Style Approximation Framework
 *
 * For each LiBrainian component, we establish:
 * - What is being approximated (ground truth)
 * - What approximation ratio is achieved
 * - With what probability the bound holds
 * - Under what distribution assumptions
 */
interface ApproximationGuarantee<T> {
  /** What we're trying to compute */
  groundTruth: GroundTruthDefinition<T>;

  /** Approximation quality */
  approximation: {
    /** Type of approximation */
    type: 'additive' | 'multiplicative' | 'probabilistic';

    /** Approximation factor/error */
    factor: number;

    /** Probability bound holds */
    probability: number;

    /** Required samples/compute for this bound */
    sampleComplexity: (epsilon: number, delta: number) => number;
  };

  /** Conditions under which guarantee holds */
  conditions: ApproximationCondition[];

  /** Empirical validation results */
  validation: EmpiricalValidation;
}

/**
 * Embedding Approximation Guarantee
 *
 * Claim: Embedding similarity approximates semantic similarity
 * with high probability under mild assumptions.
 */
class EmbeddingApproximationTheory {
  /**
   * Johnson-Lindenstrauss style guarantee for embeddings
   *
   * Theorem: For any ε > 0 and set of n points in semantic space,
   * there exists an embedding into d = O(log(n)/ε²) dimensions
   * such that for all pairs (x,y):
   *
   * (1-ε)||x-y||² ≤ ||f(x)-f(y)||² ≤ (1+ε)||x-y||²
   */
  getJLGuarantee(
    numEntities: number,
    embeddingDim: number
  ): ApproximationGuarantee<SemanticSimilarity> {
    // JL lemma: d ≥ 8 ln(n) / ε² for distortion ε
    const epsilon = Math.sqrt(8 * Math.log(numEntities) / embeddingDim);

    return {
      groundTruth: {
        name: 'semantic_similarity',
        definition: 'Human-judged similarity between code entities',
        measurementMethod: 'expert_annotation',
      },
      approximation: {
        type: 'multiplicative',
        factor: epsilon,
        probability: 1 - 1/numEntities,  // Union bound over pairs
        sampleComplexity: (eps, delta) =>
          Math.ceil(8 * Math.log(1/delta) / (eps * eps)),
      },
      conditions: [
        { name: 'iid_assumption', description: 'Entities sampled IID from distribution' },
        { name: 'smoothness', description: 'Semantic similarity is Lipschitz-continuous' },
      ],
      validation: await this.validateEmpirically(numEntities, embeddingDim),
    };
  }

  /**
   * Validate approximation guarantee empirically
   */
  private async validateEmpirically(
    numEntities: number,
    embeddingDim: number
  ): Promise<EmpiricalValidation> {
    // Sample pairs and compare embedding vs human similarity
    const pairs = await this.samplePairs(1000);

    const results = await Promise.all(pairs.map(async ([a, b]) => {
      const embeddingSim = this.computeEmbeddingSimilarity(a, b);
      const humanSim = await this.getHumanSimilarity(a, b);
      return { embeddingSim, humanSim, error: Math.abs(embeddingSim - humanSim) };
    }));

    const meanError = results.reduce((s, r) => s + r.error, 0) / results.length;
    const maxError = Math.max(...results.map(r => r.error));
    const correlation = this.computeCorrelation(
      results.map(r => r.embeddingSim),
      results.map(r => r.humanSim)
    );

    return {
      meanApproximationError: meanError,
      maxApproximationError: maxError,
      correlationWithGroundTruth: correlation,
      sampleSize: pairs.length,
      confidenceInterval: this.computeConfidenceInterval(results, 0.95),
    };
  }
}

/**
 * Retrieval Approximation Guarantee
 *
 * Claim: Retrieval returns (1-ε)-approximately optimal results
 * with probability at least (1-δ).
 */
class RetrievalApproximationTheory {
  /**
   * Locality-Sensitive Hashing guarantee
   *
   * For (r₁, r₂, p₁, p₂)-sensitive hash family:
   * - Points within distance r₁ collide with probability ≥ p₁
   * - Points beyond distance r₂ collide with probability ≤ p₂
   */
  getLSHGuarantee(
    similarityThreshold: number,
    numHashTables: number,
    hashFunctions: number
  ): ApproximationGuarantee<RelevantDocuments> {
    // LSH parameters
    const p1 = Math.pow(similarityThreshold, hashFunctions);
    const p2 = Math.pow(similarityThreshold / 2, hashFunctions);

    // Probability of finding truly similar item
    const recall = 1 - Math.pow(1 - p1, numHashTables);

    // Probability of false positive
    const falsePositiveRate = 1 - Math.pow(1 - p2, numHashTables);

    return {
      groundTruth: {
        name: 'relevant_documents',
        definition: 'Documents with true similarity above threshold',
        measurementMethod: 'exhaustive_search',
      },
      approximation: {
        type: 'probabilistic',
        factor: recall,  // Recall guarantee
        probability: recall,
        sampleComplexity: (eps, delta) =>
          Math.ceil(Math.log(1/delta) / Math.log(1/(1-Math.pow(1-eps, hashFunctions)))),
      },
      conditions: [
        { name: 'hash_independence', description: 'Hash functions are independent' },
        { name: 'metric_space', description: 'Similarity satisfies triangle inequality' },
      ],
      validation: await this.validateRetrievalApproximation(),
    };
  }

  /**
   * Precision@k guarantee
   *
   * With high probability, at least (1-ε) fraction of top-k
   * returned documents are truly relevant.
   */
  async getPrecisionGuarantee(k: number): Promise<PrecisionGuarantee> {
    // Empirically estimate precision from held-out data
    const testQueries = await this.getTestQueries(500);

    const precisions = await Promise.all(testQueries.map(async q => {
      const retrieved = await this.retrieve(q, k);
      const relevant = await this.getGroundTruthRelevant(q);
      return retrieved.filter(d => relevant.includes(d)).length / k;
    }));

    const meanPrecision = precisions.reduce((a, b) => a + b) / precisions.length;
    const stdPrecision = Math.sqrt(
      precisions.reduce((s, p) => s + Math.pow(p - meanPrecision, 2), 0) / precisions.length
    );

    // Hoeffding bound for precision
    const epsilon = (t: number) => Math.sqrt(Math.log(2/t) / (2 * testQueries.length));

    return {
      k,
      meanPrecision,
      stdPrecision,
      lowerBound: (delta: number) => Math.max(0, meanPrecision - epsilon(delta)),
      upperBound: (delta: number) => Math.min(1, meanPrecision + epsilon(delta)),
      confidence: 0.95,
      sampleSize: testQueries.length,
    };
  }
}

/**
 * Synthesis Approximation Theory
 *
 * Key insight: Synthesis accuracy cannot have formal guarantees
 * (it's fundamentally about semantic interpretation).
 *
 * But we CAN have calibration guarantees: stated confidence
 * should match empirical accuracy.
 */
class SynthesisCalibrationTheory {
  /**
   * Calibration guarantee via conformal prediction
   *
   * Claim: For any user-specified α, the system returns
   * prediction sets that contain the true answer with
   * probability at least (1-α).
   */
  async getCalibrationGuarantee(
    alpha: number
  ): Promise<CalibrationGuarantee> {
    const calibrationData = await this.getCalibrationSet(1000);

    // Compute nonconformity scores on calibration set
    const scores = calibrationData.map(d => this.computeNonconformity(d));

    // Compute threshold for desired coverage
    const threshold = this.computeQuantile(scores, 1 - alpha);

    // Validate on held-out test set
    const testData = await this.getTestSet(500);
    const coverage = testData.filter(d =>
      this.computeNonconformity(d) <= threshold
    ).length / testData.length;

    return {
      targetCoverage: 1 - alpha,
      empiricalCoverage: coverage,
      threshold,
      calibrationSetSize: calibrationData.length,

      guarantee: {
        statement: `With probability at least ${1-alpha}, the prediction set ` +
                   `contains the true answer.`,
        type: 'distribution_free',
        assumptions: ['exchangeability'],
      },

      predictionSetMethod: {
        description: 'Include all answers with nonconformity score ≤ threshold',
        expectedSetSize: this.computeExpectedSetSize(scores, threshold),
      },
    };
  }
}

/**
 * Unified Approximation Dashboard
 */
class ApproximationDashboard {
  async getFullGuarantees(): Promise<ApproximationReport> {
    return {
      embedding: await this.embeddingTheory.getJLGuarantee(
        this.getNumEntities(),
        this.getEmbeddingDim()
      ),
      retrieval: await this.retrievalTheory.getPrecisionGuarantee(10),
      synthesis: await this.synthesisTheory.getCalibrationGuarantee(0.1),

      composedGuarantee: this.composeGuarantees(),

      practicalImplications: {
        expectedAccuracy: this.computeExpectedAccuracy(),
        worstCaseAccuracy: this.computeWorstCase(),
        recommendations: this.generateRecommendations(),
      },
    };
  }
}
```

---

#### Problem 49: Sample Complexity for Calibration

**The Issue**

Confidence calibration requires historical data, but:
- How many samples are needed for reliable calibration?
- What's the statistical power of calibration with N episodes?
- What's the confidence interval on calibration estimates?

The bootstrap mode mentions "minimum episodes before transitioning" but provides no theoretical basis for the threshold.

**Elegant Solution: Statistical Learning Theory for Calibration**

```typescript
/**
 * Calibration Sample Complexity Framework
 *
 * Based on PAC-learning theory: how many samples to achieve
 * (ε, δ)-calibration with high probability?
 */
interface CalibrationSampleComplexity {
  /** Minimum samples for (ε, δ)-calibration */
  minSamples: (epsilon: number, delta: number) => number;

  /** Current calibration quality given samples */
  currentQuality: (samples: number) => CalibrationQuality;

  /** Power analysis */
  powerAnalysis: PowerAnalysis;

  /** Adaptive stopping rule */
  stoppingRule: AdaptiveStoppingRule;
}

/**
 * Theoretical Bounds
 */
class CalibrationTheory {
  /**
   * Sample complexity for (ε, δ)-calibration
   *
   * Theorem (Hoeffding): To estimate a probability p to within ε
   * with probability at least 1-δ, we need:
   *
   *   n ≥ (1/2ε²) ln(2/δ)
   *
   * For calibration across B confidence bins:
   *   n ≥ (1/2ε²) ln(2B/δ)  [union bound]
   */
  getTheoreticalBound(
    epsilon: number,
    delta: number,
    numBins: number
  ): number {
    return Math.ceil(
      (1 / (2 * epsilon * epsilon)) * Math.log((2 * numBins) / delta)
    );
  }

  /**
   * More sophisticated: Empirical Bernstein bound
   * (tighter when variance is low)
   */
  getEmpiricalBernsteinBound(
    samples: CalibrationSample[],
    delta: number
  ): { epsilon: number; varianceAdaptive: boolean } {
    const n = samples.length;
    const bins = this.binByConfidence(samples);

    let maxEpsilon = 0;

    for (const [confidence, binSamples] of bins) {
      // Empirical accuracy in this bin
      const accuracy = binSamples.filter(s => s.correct).length / binSamples.length;

      // Empirical variance
      const variance = accuracy * (1 - accuracy);

      // Bernstein bound (tighter than Hoeffding when variance is low)
      const epsilon = Math.sqrt(2 * variance * Math.log(2/delta) / n) +
                      3 * Math.log(2/delta) / n;

      maxEpsilon = Math.max(maxEpsilon, Math.abs(accuracy - confidence) + epsilon);
    }

    return { epsilon: maxEpsilon, varianceAdaptive: true };
  }

  /**
   * Compute confidence interval on calibration error
   */
  getConfidenceInterval(
    samples: CalibrationSample[],
    alpha: number
  ): ConfidenceInterval {
    const bins = this.binByConfidence(samples);
    const calibrationErrors: number[] = [];

    for (const [confidence, binSamples] of bins) {
      if (binSamples.length < 10) continue;  // Skip small bins

      const accuracy = binSamples.filter(s => s.correct).length / binSamples.length;
      calibrationErrors.push(Math.abs(accuracy - confidence));
    }

    // Bootstrap confidence interval for Expected Calibration Error (ECE)
    const bootstrapECEs = [];
    for (let b = 0; b < 1000; b++) {
      const resample = this.bootstrapResample(calibrationErrors);
      bootstrapECEs.push(resample.reduce((a, b) => a + b, 0) / resample.length);
    }

    bootstrapECEs.sort((a, b) => a - b);
    const lower = bootstrapECEs[Math.floor(alpha/2 * 1000)];
    const upper = bootstrapECEs[Math.floor((1 - alpha/2) * 1000)];

    return {
      point: calibrationErrors.reduce((a, b) => a + b, 0) / calibrationErrors.length,
      lower,
      upper,
      alpha,
      method: 'bootstrap_percentile',
    };
  }
}

/**
 * Power Analysis: Can we detect miscalibration?
 */
class CalibrationPowerAnalysis {
  /**
   * Given n samples, what calibration error can we detect
   * with power (1-β) at significance α?
   */
  detectableEffectSize(
    n: number,
    alpha: number,
    beta: number
  ): number {
    // For testing H0: ECE = 0 vs H1: ECE > ε
    // Power = P(reject H0 | H1 true)
    //
    // Using normal approximation:
    // ε = z_{1-α} * σ/√n + z_{1-β} * σ/√n
    // where σ ≈ 0.25 for binary outcomes (maximum variance)

    const z_alpha = this.normalQuantile(1 - alpha);
    const z_beta = this.normalQuantile(1 - beta);
    const sigma = 0.25;  // Conservative estimate

    return (z_alpha + z_beta) * sigma / Math.sqrt(n);
  }

  /**
   * How many samples to detect effect size ε with power (1-β)?
   */
  requiredSamples(
    effectSize: number,
    alpha: number,
    beta: number
  ): number {
    const z_alpha = this.normalQuantile(1 - alpha);
    const z_beta = this.normalQuantile(1 - beta);
    const sigma = 0.25;

    return Math.ceil(Math.pow((z_alpha + z_beta) * sigma / effectSize, 2));
  }

  /**
   * Current power given sample size
   */
  currentPower(
    n: number,
    effectSize: number,
    alpha: number
  ): number {
    const z_alpha = this.normalQuantile(1 - alpha);
    const sigma = 0.25;
    const z_beta = effectSize * Math.sqrt(n) / sigma - z_alpha;
    return this.normalCDF(z_beta);
  }
}

/**
 * Adaptive Stopping Rule: When do we have enough samples?
 */
class AdaptiveCalibrationStopping {
  /**
   * Sequential probability ratio test (SPRT) for calibration
   *
   * Keep sampling until we can confidently conclude:
   * - Calibration is good (ECE < ε), OR
   * - Calibration is bad (ECE > ε + δ)
   */
  async runSPRT(
    sampleStream: AsyncIterator<CalibrationSample>,
    goodThreshold: number,
    badThreshold: number,
    alpha: number,
    beta: number
  ): Promise<SPRTResult> {
    const samples: CalibrationSample[] = [];
    const logLikelihoodRatio = [];

    const A = Math.log((1 - beta) / alpha);  // Upper boundary
    const B = Math.log(beta / (1 - alpha));  // Lower boundary

    let LLR = 0;

    while (true) {
      const { value: sample, done } = await sampleStream.next();
      if (done) break;

      samples.push(sample);

      // Update log-likelihood ratio
      const binAccuracy = this.computeBinAccuracy(samples, sample.confidence);
      const llr_increment = this.computeLLRIncrement(
        sample,
        binAccuracy,
        goodThreshold,
        badThreshold
      );

      LLR += llr_increment;
      logLikelihoodRatio.push(LLR);

      // Check stopping conditions
      if (LLR >= A) {
        return {
          decision: 'calibration_good',
          samplesUsed: samples.length,
          finalLLR: LLR,
          trajectory: logLikelihoodRatio,
          estimatedECE: this.computeECE(samples),
        };
      }

      if (LLR <= B) {
        return {
          decision: 'calibration_bad',
          samplesUsed: samples.length,
          finalLLR: LLR,
          trajectory: logLikelihoodRatio,
          estimatedECE: this.computeECE(samples),
        };
      }
    }

    // Ran out of samples without decision
    return {
      decision: 'inconclusive',
      samplesUsed: samples.length,
      finalLLR: LLR,
      trajectory: logLikelihoodRatio,
      estimatedECE: this.computeECE(samples),
      recommendation: `Need ${this.estimateRemainingsamples(LLR, A, B)} more samples`,
    };
  }
}

/**
 * Integration: Calibration Quality Dashboard
 */
class CalibrationQualityDashboard {
  async assess(): Promise<CalibrationAssessment> {
    const samples = await this.storage.getCalibrationHistory();

    const theoreticalBound = this.theory.getTheoreticalBound(0.05, 0.05, 10);
    const empiricalBound = this.theory.getEmpiricalBernsteinBound(samples, 0.05);
    const confidenceInterval = this.theory.getConfidenceInterval(samples, 0.05);
    const power = this.powerAnalysis.currentPower(samples.length, 0.1, 0.05);

    return {
      currentSamples: samples.length,

      quality: {
        ece: this.computeECE(samples),
        mce: this.computeMCE(samples),  // Maximum calibration error
        confidenceInterval,
      },

      sufficiency: {
        theoreticalMinimum: theoreticalBound,
        currentVsRequired: samples.length / theoreticalBound,
        power: power,
        detectableEffectSize: this.powerAnalysis.detectableEffectSize(
          samples.length, 0.05, 0.2
        ),
      },

      recommendation: this.generateRecommendation(samples, theoreticalBound, power),

      visualization: {
        reliabilityDiagram: this.generateReliabilityDiagram(samples),
        calibrationOverTime: this.generateCalibrationTimeSeries(samples),
        powerCurve: this.generatePowerCurve(samples.length),
      },
    };
  }
}
```

---

#### Problem 50: Verification Complexity is Unanalyzed

**The Issue**

Verification plans promise to "verify claims," but verification itself has computational complexity:
- Is the verification problem decidable?
- What complexity class does verification fall into?
- Are there claims that are fundamentally unverifiable?

**Elegant Solution: Verification Complexity Hierarchy**

```typescript
/**
 * Verification Complexity Stratification
 *
 * Categorize claims by decidability and complexity,
 * then provide appropriate verification strategies.
 */
interface VerificationComplexityHierarchy {
  /** Decidability classification */
  decidability: Map<ClaimType, DecidabilityClass>;

  /** Complexity classification (for decidable claims) */
  complexity: Map<ClaimType, ComplexityClass>;

  /** Verification strategy per class */
  strategies: Map<DecidabilityClass, VerificationStrategy>;
}

type DecidabilityClass =
  | 'decidable'           // Algorithm exists that always terminates
  | 'semi_decidable'      // Can confirm true, but may loop on false
  | 'co_semi_decidable'   // Can confirm false, but may loop on true
  | 'undecidable';        // No general algorithm exists

type ComplexityClass =
  | 'constant'    // O(1)
  | 'linear'      // O(n)
  | 'polynomial'  // O(n^k)
  | 'np'          // Nondeterministic polynomial
  | 'pspace'      // Polynomial space
  | 'exptime'     // Exponential time
  | 'nonelementary'; // Tower of exponentials

/**
 * Classification of Common Code Claims
 */
const CLAIM_COMPLEXITY_CLASSIFICATION: Record<string, ClaimComplexity> = {
  // DECIDABLE - TYPE CHECKING
  'well_typed': {
    decidability: 'decidable',
    complexity: 'polynomial',  // Most type systems
    proof: 'Type inference algorithms (Hindley-Milner: O(n))',
    verificationMethod: 'type_checker',
  },

  'returns_type': {
    decidability: 'decidable',
    complexity: 'polynomial',
    proof: 'Reducible to type checking',
    verificationMethod: 'type_checker',
  },

  // DECIDABLE - SYNTACTIC PROPERTIES
  'follows_naming_convention': {
    decidability: 'decidable',
    complexity: 'linear',
    proof: 'Regular expression matching',
    verificationMethod: 'lint',
  },

  'has_documentation': {
    decidability: 'decidable',
    complexity: 'linear',
    proof: 'AST traversal',
    verificationMethod: 'ast_check',
  },

  // SEMI-DECIDABLE - TERMINATION
  'terminates': {
    decidability: 'semi_decidable',
    complexity: 'undecidable',  // Halting problem
    proof: 'Rice\'s theorem: non-trivial semantic properties are undecidable',
    approximation: {
      method: 'termination_checker',
      soundness: 'may_miss_terminating_programs',
      completeness: 'never_claims_termination_falsely',
    },
    verificationMethod: 'bounded_execution',
  },

  'always_returns': {
    decidability: 'semi_decidable',
    complexity: 'undecidable',
    proof: 'Equivalent to halting problem',
    approximation: {
      method: 'control_flow_analysis',
      soundness: 'may_miss_always_returning_functions',
      completeness: 'never_claims_return_falsely',
    },
    verificationMethod: 'bounded_model_checking',
  },

  // UNDECIDABLE - SEMANTIC PROPERTIES
  'is_equivalent_to': {
    decidability: 'undecidable',
    complexity: 'undecidable',
    proof: 'Rice\'s theorem',
    approximation: {
      method: 'testing',
      soundness: 'no_guarantee',
      completeness: 'no_guarantee',
      confidenceBound: 'probabilistic',
    },
    verificationMethod: 'property_testing',
  },

  'has_no_bugs': {
    decidability: 'undecidable',
    complexity: 'undecidable',
    proof: 'Would solve halting problem',
    approximation: {
      method: 'testing_and_analysis',
      soundness: 'no_guarantee',
      completeness: 'no_guarantee',
    },
    verificationMethod: 'multi_pronged',
  },

  // UNDECIDABLE - INTENTIONAL PROPERTIES
  'matches_intent': {
    decidability: 'undecidable',
    complexity: 'undecidable',
    proof: 'Intent is not formally specifiable in general',
    approximation: {
      method: 'llm_assessment',
      soundness: 'no_guarantee',
      completeness: 'no_guarantee',
    },
    verificationMethod: 'human_in_loop',
  },

  'is_secure': {
    decidability: 'undecidable',
    complexity: 'undecidable',
    proof: 'Security is a negative property (absence of vulnerabilities)',
    approximation: {
      method: 'security_analysis',
      soundness: 'may_miss_vulnerabilities',
      completeness: 'may_flag_false_positives',
    },
    verificationMethod: 'security_scanning',
  },
};

/**
 * Verification Strategy Engine
 */
class VerificationStrategyEngine {
  /**
   * Get appropriate verification strategy for a claim
   */
  getStrategy(claim: Claim): VerificationStrategy {
    const complexity = this.classify(claim);

    switch (complexity.decidability) {
      case 'decidable':
        return this.getDecidableStrategy(claim, complexity);

      case 'semi_decidable':
        return this.getSemiDecidableStrategy(claim, complexity);

      case 'undecidable':
        return this.getUndecidableStrategy(claim, complexity);
    }
  }

  /**
   * Decidable claims: Run exact algorithm
   */
  private getDecidableStrategy(
    claim: Claim,
    complexity: ClaimComplexity
  ): VerificationStrategy {
    return {
      type: 'exact',
      method: complexity.verificationMethod,

      guarantees: {
        soundness: 'complete',      // If says true, is true
        completeness: 'complete',   // If true, will say true
        terminates: 'always',
        worstCaseTime: complexity.complexity,
      },

      execute: async () => {
        const result = await this.runExactVerifier(claim, complexity.verificationMethod);
        return {
          verified: result.passed,
          confidence: result.passed ? 1.0 : 0.0,
          evidence: result.evidence,
          certainty: 'mathematical',
        };
      },
    };
  }

  /**
   * Semi-decidable claims: Use bounded verification
   */
  private getSemiDecidableStrategy(
    claim: Claim,
    complexity: ClaimComplexity
  ): VerificationStrategy {
    return {
      type: 'bounded',
      method: complexity.approximation?.method || 'bounded_search',

      guarantees: {
        soundness: complexity.approximation?.soundness || 'partial',
        completeness: complexity.approximation?.completeness || 'partial',
        terminates: 'within_bound',
        worstCaseTime: 'configurable_bound',
      },

      execute: async (bounds: VerificationBounds) => {
        const result = await this.runBoundedVerifier(claim, bounds);

        if (result.conclusive) {
          return {
            verified: result.passed,
            confidence: 0.95,  // High but not certain
            evidence: result.evidence,
            certainty: 'bounded_search',
            coverage: result.searchCoverage,
          };
        }

        return {
          verified: 'unknown',
          confidence: result.searchCoverage,
          evidence: result.evidence,
          certainty: 'incomplete_search',
          coverage: result.searchCoverage,
          recommendation: `Increase bound from ${bounds} to explore more`,
        };
      },
    };
  }

  /**
   * Undecidable claims: Use best-effort approximation
   */
  private getUndecidableStrategy(
    claim: Claim,
    complexity: ClaimComplexity
  ): VerificationStrategy {
    return {
      type: 'approximate',
      method: complexity.approximation?.method || 'multi_pronged',

      guarantees: {
        soundness: 'no_guarantee',
        completeness: 'no_guarantee',
        terminates: 'always',
        worstCaseTime: 'configurable',
      },

      warning: `This claim is theoretically undecidable. ` +
               `Verification can only provide probabilistic evidence.`,

      execute: async () => {
        const results = await this.runMultiProngedVerification(claim);

        // Aggregate evidence from multiple sources
        const confidence = this.aggregateConfidence(results);

        return {
          verified: confidence > 0.8 ? 'likely_true' :
                   confidence < 0.2 ? 'likely_false' : 'uncertain',
          confidence,
          evidence: results,
          certainty: 'probabilistic',

          epistemicStatus: {
            limitation: 'This claim cannot be verified with certainty.',
            basis: 'Multiple independent verification methods agree.',
            strengthOfEvidence: this.assessEvidenceStrength(results),
          },
        };
      },
    };
  }

  /**
   * Multi-pronged verification for undecidable claims
   */
  private async runMultiProngedVerification(
    claim: Claim
  ): Promise<VerificationResult[]> {
    const methods = [
      // Testing
      this.runPropertyTesting(claim),
      // Static analysis
      this.runStaticAnalysis(claim),
      // Fuzzing
      this.runFuzzing(claim),
      // Symbolic execution (bounded)
      this.runBoundedSymbolicExecution(claim),
      // LLM assessment
      this.runLLMAssessment(claim),
    ];

    return Promise.all(methods);
  }

  /**
   * Aggregate confidence from multiple verification methods
   *
   * Use Bayesian combination with independence assumption
   */
  private aggregateConfidence(results: VerificationResult[]): number {
    // Filter out methods that couldn't provide evidence
    const validResults = results.filter(r => r.confidence !== null);

    if (validResults.length === 0) return 0.5;  // No evidence

    // Bayesian aggregation (assuming independence)
    // P(true | all evidence) ∝ P(true) × Π P(evidence_i | true) / P(evidence_i)
    let logOdds = 0;  // log(P(true) / P(false)), start with prior = 0.5

    for (const result of validResults) {
      // Convert confidence to log-odds update
      const methodReliability = this.getMethodReliability(result.method);
      const adjustedConfidence = 0.5 + (result.confidence - 0.5) * methodReliability;

      // Log-odds update
      logOdds += Math.log(adjustedConfidence / (1 - adjustedConfidence));
    }

    // Convert back to probability
    return 1 / (1 + Math.exp(-logOdds));
  }
}
```

---

### E. Unified Theoretical Framework

The preceding solutions address individual theoretical gaps. This section provides the **unified theoretical framework** that ties them together.

```typescript
/**
 * LiBrainian Theoretical Framework
 *
 * A coherent theoretical foundation that:
 * 1. Establishes epistemic guarantees (what we can know and with what certainty)
 * 2. Provides approximation bounds (how good our answers are)
 * 3. Analyzes system dynamics (stability, bifurcations, resilience)
 * 4. Addresses multi-agent considerations (game theory, alignment)
 */
interface LibrarianTheoreticalFramework {
  /** Epistemology: What constitutes knowledge? */
  epistemology: {
    knowledgeDefinition: SafetyBasedKnowledge;
    socialStructure: SocialEpistemologySystem;
    biasAwareness: EpistemicJusticeFramework;
    argumentation: ArgumentationEngine;
  };

  /** Information Theory: Fundamental limits */
  informationTheory: {
    entropy: EntropyEstimate;
    mutualInformation: MutualInformationEstimate;
    rateDistortion: RateDistortionCurve;
    channelCapacity: CapacityEstimate;
  };

  /** Learning Theory: Sample complexity and guarantees */
  learningTheory: {
    calibration: CalibrationSampleComplexity;
    approximation: ApproximationGuarantee<any>;
    verification: VerificationComplexityHierarchy;
  };

  /** Dynamics: System behavior over time */
  dynamics: {
    stability: StabilityAnalysis;
    bifurcations: BifurcationAnalysis;
    resilience: ResilienceMetrics;
    emergence: KnowledgeIntegrationMetrics;
  };

  /** Game Theory: Multi-agent considerations */
  gameTheory: {
    mechanism: KnowledgeMechanism;
    creditAssignment: CreditAssignmentFramework;
    alignment: AlignmentAwareKnowledge;
  };
}

/**
 * Instantiate the complete theoretical framework
 */
async function createTheoreticalFramework(
  LiBrainian: LiBrainian
): Promise<LibrarianTheoreticalFramework> {
  // Initialize all subsystems
  const epistemology = await createEpistemologySystem(LiBrainian);
  const informationTheory = await createInformationTheoreticFramework(LiBrainian);
  const learningTheory = await createLearningTheoreticFramework(LiBrainian);
  const dynamics = await createDynamicsFramework(LiBrainian);
  const gameTheory = await createGameTheoreticFramework(LiBrainian);

  return {
    epistemology,
    informationTheory,
    learningTheory,
    dynamics,
    gameTheory,
  };
}
```

---

### F. Implementation Priority (Theoretical Rigor)

**Tier 1: Foundational (Must Implement)**

| # | Component | Why Foundational |
|---|-----------|------------------|
| 43 | Gettier-immune knowledge | Without it, "knowledge" may be accidentally true |
| 47 | Information-theoretic bounds | Tells us what's achievable vs impossible |
| 49 | Sample complexity | Tells us when calibration is reliable |
| 54 | Stability analysis | Prevents runaway confidence dynamics |

**Tier 2: Completeness (Should Implement)**

| # | Component | Why Important |
|---|-----------|---------------|
| 44 | Social epistemology | Codebases are social artifacts |
| 48 | Approximation guarantees | Quantifies answer quality |
| 50 | Verification complexity | Prevents impossible verification promises |
| 51 | Multi-agent game theory | Prevents gaming by strategic agents |

**Tier 3: Sophistication (Could Implement)**

| # | Component | Why Valuable |
|---|-----------|--------------|
| 45 | Epistemic justice | Detects/corrects LLM bias |
| 46 | Structured argumentation | Handles complex defeater hierarchies |
| 52 | Shapley credit assignment | Fair attribution enables learning |
| 55 | Bifurcation detection | Early warning of catastrophic changes |

**Tier 4: Research Frontier (Future Work)**

| # | Component | Research Value |
|---|-----------|----------------|
| 53 | Alignment measurement | Novel contribution to AI safety |
| 56 | Emergence metrics (Φ) | Novel contribution to IIT |
| 57 | Resilience analysis | Novel framework for knowledge systems |

---

## Part XIII: Using LiBrainian to Perfect LiBrainian

**A Comprehensive Self-Improvement Guide**

This section provides detailed strategies for using LiBrainian's own capabilities to identify, prioritize, and address gaps in LiBrainian itself—a form of **recursive self-improvement** bounded by the theoretical framework established above.

---

### A. The Meta-Epistemic Loop

```
┌─────────────────────────────────────────────────────────────┐
│                    LiBrainian ON LiBrainian                    │
│                                                             │
│  ┌─────────────────┐      ┌─────────────────┐              │
│  │ 1. SELF-INDEX   │───▶  │ 2. SELF-QUERY   │              │
│  │                 │      │                 │              │
│  │ Bootstrap on    │      │ Query gaps,     │              │
│  │ LiBrainian code  │      │ inconsistencies │              │
│  └─────────────────┘      └────────┬────────┘              │
│                                    │                        │
│                                    ▼                        │
│  ┌─────────────────┐      ┌─────────────────┐              │
│  │ 4. SELF-LEARN   │◀──── │ 3. SELF-VERIFY  │              │
│  │                 │      │                 │              │
│  │ Update based on │      │ Verify claims   │              │
│  │ outcomes        │      │ about self      │              │
│  └─────────────────┘      └─────────────────┘              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### B. Self-Improvement Technique Primitives

The self-improvement process uses LiBrainian's own technique primitive system. These primitives are specifically designed for recursive self-analysis.

#### B.1 Self-Improvement Primitive Catalog

```typescript
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SELF-IMPROVEMENT TECHNIQUE PRIMITIVES
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * These primitives extend the base 64 primitives with self-referential
 * capabilities for recursive improvement.
 */

// ─────────────────────────────────────────────────────────────────────────────
// CATEGORY: SELF-INDEXING (tp_self_*)
// ─────────────────────────────────────────────────────────────────────────────

const tp_self_bootstrap: TechniquePrimitive = {
  id: 'tp_self_bootstrap',
  name: 'Self-Bootstrap',
  category: 'self_improvement',
  description: 'Bootstrap LiBrainian knowledge index on LiBrainian source code itself',

  preconditions: [
    'LiBrainian source code accessible at known path',
    'Storage system initialized',
    'Embedding model available',
  ],

  inputs: {
    sourceRoot: { type: 'path', description: 'Root of LiBrainian source' },
    includeTests: { type: 'boolean', default: true },
    includeDocs: { type: 'boolean', default: true },
  },

  outputs: {
    indexReport: { type: 'BootstrapReport' },
    entityCount: { type: 'number' },
    relationshipCount: { type: 'number' },
    coverageMetrics: { type: 'CoverageMetrics' },
  },

  postconditions: [
    'All LiBrainian modules indexed',
    'All public interfaces documented',
    'Dependency graph complete',
    'Embedding vectors generated',
  ],

  estimatedCost: { tokens: 50000, time: '5-10 minutes' },
};

const tp_self_refresh: TechniquePrimitive = {
  id: 'tp_self_refresh',
  name: 'Self-Refresh',
  category: 'self_improvement',
  description: 'Incrementally update LiBrainian knowledge based on recent changes',

  preconditions: [
    'Prior self-bootstrap completed',
    'Git history available',
  ],

  inputs: {
    since: { type: 'string', description: 'Git ref or timestamp' },
    scope: { type: 'enum', values: ['changed_only', 'changed_and_dependents', 'full'] },
  },

  outputs: {
    refreshedEntities: { type: 'string[]' },
    newEntities: { type: 'string[]' },
    removedEntities: { type: 'string[]' },
    staleness: { type: 'StalenessReport' },
  },

  postconditions: [
    'Changed files re-indexed',
    'Dependent entities refreshed',
    'Stale knowledge flagged',
  ],

  estimatedCost: { tokens: 5000, time: '30 seconds - 2 minutes' },
};

// ─────────────────────────────────────────────────────────────────────────────
// CATEGORY: SELF-ANALYSIS (tp_analyze_*)
// ─────────────────────────────────────────────────────────────────────────────

const tp_analyze_architecture: TechniquePrimitive = {
  id: 'tp_analyze_architecture',
  name: 'Analyze Architecture',
  category: 'self_improvement',
  description: 'Analyze LiBrainian architecture for violations and improvements',

  preconditions: [
    'Self-index available',
  ],

  inputs: {
    checks: {
      type: 'array',
      items: 'ArchitectureCheck',
      default: ['circular_deps', 'large_interfaces', 'unclear_responsibility', 'dead_code'],
    },
    thresholds: { type: 'ArchitectureThresholds' },
  },

  outputs: {
    violations: { type: 'ArchitectureViolation[]' },
    metrics: { type: 'ArchitectureMetrics' },
    suggestions: { type: 'ArchitectureSuggestion[]' },
    dependencyGraph: { type: 'DependencyGraph' },
  },

  postconditions: [
    'All requested checks performed',
    'Violations ranked by severity',
    'Actionable suggestions generated',
  ],

  estimatedCost: { tokens: 20000, time: '2-5 minutes' },
};

const tp_analyze_theoretical_soundness: TechniquePrimitive = {
  id: 'tp_analyze_theoretical_soundness',
  name: 'Analyze Theoretical Soundness',
  category: 'self_improvement',
  description: 'Check LiBrainian claims against theoretical foundations',

  preconditions: [
    'Self-index available',
    'Theoretical framework defined (Part XII)',
  ],

  inputs: {
    aspects: {
      type: 'array',
      items: 'TheoreticalAspect',
      default: ['gettier_cases', 'calibration_validity', 'approximation_bounds', 'complexity_claims'],
    },
  },

  outputs: {
    gettierCases: { type: 'GettierCase[]' },
    ungroundedClaims: { type: 'UngroundedClaim[]' },
    missingProofs: { type: 'MissingProof[]' },
    theoreticalDebt: { type: 'TheoreticalDebtReport' },
  },

  postconditions: [
    'All claims classified by epistemic status',
    'Gettier cases identified with mitigation paths',
    'Missing theoretical foundations documented',
  ],

  estimatedCost: { tokens: 30000, time: '3-7 minutes' },
};

const tp_analyze_consistency: TechniquePrimitive = {
  id: 'tp_analyze_consistency',
  name: 'Analyze Self-Consistency',
  category: 'self_improvement',
  description: 'Check consistency between LiBrainian claims and implementation',

  preconditions: [
    'Self-index available',
    'Test suite available',
  ],

  inputs: {
    checkTypes: {
      type: 'array',
      items: 'ConsistencyCheck',
      default: ['interface_signature', 'behavior_test_evidence', 'doc_code_alignment'],
    },
  },

  outputs: {
    inconsistencies: { type: 'Inconsistency[]' },
    phantomClaims: { type: 'PhantomClaim[]' },  // Claims without code support
    untestedClaims: { type: 'UntestedClaim[]' }, // Claims without test evidence
    docDrift: { type: 'DocDrift[]' },            // Doc doesn't match code
  },

  postconditions: [
    'All inconsistencies identified',
    'Each inconsistency has suggested resolution',
  ],

  estimatedCost: { tokens: 15000, time: '2-4 minutes' },
};

// ─────────────────────────────────────────────────────────────────────────────
// CATEGORY: SELF-VERIFICATION (tp_verify_*)
// ─────────────────────────────────────────────────────────────────────────────

const tp_verify_claim: TechniquePrimitive = {
  id: 'tp_verify_claim',
  name: 'Verify Self-Claim',
  category: 'self_improvement',
  description: 'Verify a specific claim LiBrainian makes about itself',

  preconditions: [
    'Claim identified',
    'Verification strategy available for claim type',
  ],

  inputs: {
    claim: { type: 'Claim' },
    verificationBudget: { type: 'VerificationBudget' },
    requiredConfidence: { type: 'number', default: 0.9 },
  },

  outputs: {
    verified: { type: 'boolean | "unknown"' },
    confidence: { type: 'number' },
    evidence: { type: 'Evidence[]' },
    epistemicStatus: { type: 'EpistemicStatus' },
    gettierAnalysis: { type: 'GettierAnalysis' },
  },

  postconditions: [
    'Verification completed within budget',
    'Confidence calibrated',
    'Gettier risk assessed',
  ],

  estimatedCost: { tokens: 5000, time: '30 seconds - 2 minutes' },
};

const tp_verify_calibration: TechniquePrimitive = {
  id: 'tp_verify_calibration',
  name: 'Verify Calibration Quality',
  category: 'self_improvement',
  description: 'Verify that LiBrainian confidence scores are well-calibrated',

  preconditions: [
    'Historical predictions available',
    'Outcome data available',
  ],

  inputs: {
    sampleSize: { type: 'number', default: 500 },
    binCount: { type: 'number', default: 10 },
    targetECE: { type: 'number', default: 0.05 },
  },

  outputs: {
    ece: { type: 'number' },  // Expected Calibration Error
    mce: { type: 'number' },  // Maximum Calibration Error
    reliabilityDiagram: { type: 'ReliabilityDiagram' },
    sampleComplexityAnalysis: { type: 'SampleComplexityAnalysis' },
    calibrationStatus: { type: 'CalibrationStatus' },
  },

  postconditions: [
    'Calibration error computed with confidence interval',
    'Sample sufficiency assessed',
  ],

  estimatedCost: { tokens: 3000, time: '15-30 seconds' },
};

// ─────────────────────────────────────────────────────────────────────────────
// CATEGORY: SELF-IMPROVEMENT (tp_improve_*)
// ─────────────────────────────────────────────────────────────────────────────

const tp_improve_generate_recommendations: TechniquePrimitive = {
  id: 'tp_improve_generate_recommendations',
  name: 'Generate Improvement Recommendations',
  category: 'self_improvement',
  description: 'Generate prioritized recommendations from analysis results',

  preconditions: [
    'Analysis results available',
  ],

  inputs: {
    analysisResults: { type: 'AnalysisResults' },
    prioritizationCriteria: { type: 'PrioritizationCriteria' },
    maxRecommendations: { type: 'number', default: 20 },
  },

  outputs: {
    recommendations: { type: 'Recommendation[]' },
    roadmap: { type: 'ImprovementRoadmap' },
    effortEstimates: { type: 'EffortEstimate[]' },
    dependencies: { type: 'RecommendationDependency[]' },
  },

  postconditions: [
    'Recommendations ranked by priority',
    'Dependencies between recommendations identified',
    'Effort estimated per recommendation',
  ],

  estimatedCost: { tokens: 10000, time: '1-2 minutes' },
};

const tp_improve_plan_fix: TechniquePrimitive = {
  id: 'tp_improve_plan_fix',
  name: 'Plan Fix',
  category: 'self_improvement',
  description: 'Plan a fix for an identified issue',

  preconditions: [
    'Issue identified',
    'Codebase context available',
  ],

  inputs: {
    issue: { type: 'Issue' },
    constraints: { type: 'FixConstraints' },
    maxComplexity: { type: 'ComplexityBudget' },
  },

  outputs: {
    plan: { type: 'FixPlan' },
    affectedFiles: { type: 'string[]' },
    riskAssessment: { type: 'RiskAssessment' },
    verificationCriteria: { type: 'VerificationCriteria' },
  },

  postconditions: [
    'Plan is implementable',
    'Risks identified',
    'Verification criteria defined',
  ],

  estimatedCost: { tokens: 8000, time: '1-3 minutes' },
};

const tp_improve_adversarial_test: TechniquePrimitive = {
  id: 'tp_improve_adversarial_test',
  name: 'Generate Adversarial Test',
  category: 'self_improvement',
  description: 'Generate adversarial test cases targeting known weaknesses',

  preconditions: [
    'Weakness identified',
  ],

  inputs: {
    weakness: { type: 'Weakness' },
    difficulty: { type: 'enum', values: ['easy', 'medium', 'hard', 'extreme'] },
    count: { type: 'number', default: 10 },
  },

  outputs: {
    testCases: { type: 'AdversarialTestCase[]' },
    expectedFailureModes: { type: 'FailureMode[]' },
    coverageAnalysis: { type: 'WeaknessCoverage' },
  },

  postconditions: [
    'Test cases target specified weakness',
    'Expected failure modes documented',
  ],

  estimatedCost: { tokens: 5000, time: '30 seconds - 1 minute' },
};

// ─────────────────────────────────────────────────────────────────────────────
// CATEGORY: SELF-LEARNING (tp_learn_*)
// ─────────────────────────────────────────────────────────────────────────────

const tp_learn_from_outcome: TechniquePrimitive = {
  id: 'tp_learn_from_outcome',
  name: 'Learn From Outcome',
  category: 'self_improvement',
  description: 'Update LiBrainian knowledge based on outcome feedback',

  preconditions: [
    'Outcome available',
    'Original prediction/claim available',
  ],

  inputs: {
    prediction: { type: 'Prediction' },
    actualOutcome: { type: 'Outcome' },
    context: { type: 'PredictionContext' },
  },

  outputs: {
    calibrationUpdate: { type: 'CalibrationUpdate' },
    knowledgeUpdates: { type: 'KnowledgeUpdate[]' },
    patternLearned: { type: 'LearnedPattern | null' },
    confidenceAdjustment: { type: 'ConfidenceAdjustment' },
  },

  postconditions: [
    'Calibration model updated',
    'Relevant knowledge updated',
    'Learning recorded in episode',
  ],

  estimatedCost: { tokens: 2000, time: '10-20 seconds' },
};

const tp_learn_extract_pattern: TechniquePrimitive = {
  id: 'tp_learn_extract_pattern',
  name: 'Extract Pattern',
  category: 'self_improvement',
  description: 'Extract reusable pattern from successful improvement',

  preconditions: [
    'Successful improvement completed',
    'Before/after state available',
  ],

  inputs: {
    improvement: { type: 'CompletedImprovement' },
    minGenerality: { type: 'number', default: 0.7 },
  },

  outputs: {
    pattern: { type: 'ImprovementPattern | null' },
    applicability: { type: 'ApplicabilityConditions' },
    expectedBenefit: { type: 'ExpectedBenefit' },
  },

  postconditions: [
    'Pattern is generalizable (if extracted)',
    'Applicability conditions defined',
  ],

  estimatedCost: { tokens: 5000, time: '30 seconds - 1 minute' },
};
```

#### B.2 Self-Improvement Compositions

```typescript
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SELF-IMPROVEMENT TECHNIQUE COMPOSITIONS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * These compositions orchestrate primitives for complete self-improvement
 * workflows.
 */

// ─────────────────────────────────────────────────────────────────────────────
// COMPOSITION: Full Self-Audit
// ─────────────────────────────────────────────────────────────────────────────

const tc_self_audit_full: TechniqueComposition = {
  id: 'tc_self_audit_full',
  name: 'Full Self-Audit',
  description: 'Complete audit of LiBrainian health, theoretical soundness, and consistency',

  primitives: [
    'tp_self_bootstrap',
    'tp_analyze_architecture',
    'tp_analyze_theoretical_soundness',
    'tp_analyze_consistency',
    'tp_verify_calibration',
    'tp_improve_generate_recommendations',
  ],

  operators: [
    {
      id: 'op_bootstrap_gate',
      type: 'gate',
      inputs: ['tp_self_bootstrap'],
      conditions: ['bootstrap completed with >90% coverage'],
      onFail: 'abort_with_diagnostic',
    },
    {
      id: 'op_parallel_analysis',
      type: 'parallel',
      inputs: ['tp_analyze_architecture', 'tp_analyze_theoretical_soundness', 'tp_analyze_consistency'],
    },
    {
      id: 'op_aggregate_findings',
      type: 'aggregate',
      inputs: ['op_parallel_analysis', 'tp_verify_calibration'],
      aggregation: 'merge_findings',
    },
    {
      id: 'op_severity_gate',
      type: 'gate',
      inputs: ['op_aggregate_findings'],
      conditions: ['no critical blocking issues'],
      onFail: 'escalate_to_human',
    },
  ],

  flow: `
    tp_self_bootstrap
         │
         ▼
    op_bootstrap_gate ──[fail]──▶ ABORT
         │
         ▼
    ┌────┴────┬────────────┐
    │         │            │
    ▼         ▼            ▼
  tp_analyze  tp_analyze   tp_analyze
  _architecture _theoretical _consistency
    │         │            │
    └────┬────┴────────────┘
         │
         ▼
    op_parallel_analysis
         │
         ├───────────────────┐
         │                   │
         ▼                   ▼
    op_aggregate_findings  tp_verify_calibration
         │                   │
         └─────────┬─────────┘
                   │
                   ▼
         op_severity_gate ──[fail]──▶ ESCALATE
                   │
                   ▼
         tp_improve_generate_recommendations
                   │
                   ▼
              AUDIT_REPORT
  `,

  estimatedCost: { tokens: 100000, time: '15-30 minutes' },

  outputs: {
    auditReport: { type: 'FullAuditReport' },
    recommendations: { type: 'Recommendation[]' },
    roadmap: { type: 'ImprovementRoadmap' },
    healthScore: { type: 'number' },
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// COMPOSITION: Incremental Self-Check
// ─────────────────────────────────────────────────────────────────────────────

const tc_self_check_incremental: TechniqueComposition = {
  id: 'tc_self_check_incremental',
  name: 'Incremental Self-Check',
  description: 'Quick check after changes for immediate feedback',

  primitives: [
    'tp_self_refresh',
    'tp_analyze_consistency',
    'tp_verify_calibration',
    'tp_learn_from_outcome',
  ],

  operators: [
    {
      id: 'op_refresh_gate',
      type: 'gate',
      inputs: ['tp_self_refresh'],
      conditions: ['refresh completed'],
    },
    {
      id: 'op_quick_checks',
      type: 'parallel',
      inputs: ['tp_analyze_consistency', 'tp_verify_calibration'],
    },
    {
      id: 'op_check_gate',
      type: 'gate',
      inputs: ['op_quick_checks'],
      conditions: ['no new critical inconsistencies', 'calibration within bounds'],
      onFail: 'flag_for_review',
    },
  ],

  flow: `
    tp_self_refresh
         │
         ▼
    op_refresh_gate
         │
    ┌────┴────┐
    │         │
    ▼         ▼
  tp_analyze  tp_verify
  _consistency _calibration
    │         │
    └────┬────┘
         │
         ▼
    op_check_gate ──[fail]──▶ FLAG_FOR_REVIEW
         │
         ▼
    tp_learn_from_outcome
         │
         ▼
    INCREMENTAL_REPORT
  `,

  estimatedCost: { tokens: 15000, time: '2-5 minutes' },

  outputs: {
    incrementalReport: { type: 'IncrementalCheckReport' },
    newIssues: { type: 'Issue[]' },
    resolvedIssues: { type: 'Issue[]' },
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// COMPOSITION: Gettier Case Resolution
// ─────────────────────────────────────────────────────────────────────────────

const tc_resolve_gettier_case: TechniqueComposition = {
  id: 'tc_resolve_gettier_case',
  name: 'Resolve Gettier Case',
  description: 'Systematically resolve a Gettier case (accidentally true belief)',

  primitives: [
    'tp_verify_claim',
    'tp_analyze_theoretical_soundness',
    'tp_improve_plan_fix',
    'tp_improve_adversarial_test',
    'tp_learn_from_outcome',
  ],

  operators: [
    {
      id: 'op_initial_verify',
      type: 'execute',
      inputs: ['tp_verify_claim'],
      config: { requiredConfidence: 0.95, includeGettierAnalysis: true },
    },
    {
      id: 'op_gettier_gate',
      type: 'gate',
      inputs: ['op_initial_verify'],
      conditions: ['gettier_risk < 0.3'],
      onFail: 'continue_to_resolution',
    },
    {
      id: 'op_resolution_loop',
      type: 'iterate',
      inputs: ['tp_improve_plan_fix', 'tp_improve_adversarial_test'],
      maxIterations: 3,
      exitCondition: 'gettier_risk < 0.3',
    },
  ],

  flow: `
    tp_verify_claim (with gettier analysis)
         │
         ▼
    op_gettier_gate ──[pass]──▶ ALREADY_SAFE
         │
         ▼ [gettier_risk >= 0.3]
    tp_analyze_theoretical_soundness
         │
         ▼
    ┌────────────────────────────┐
    │   op_resolution_loop       │
    │                            │
    │  tp_improve_plan_fix       │
    │         │                  │
    │         ▼                  │
    │  tp_improve_adversarial    │
    │  _test                     │
    │         │                  │
    │         ▼                  │
    │  tp_verify_claim           │
    │         │                  │
    │  [gettier_risk < 0.3?]     │
    │    ├─[yes]──▶ EXIT         │
    │    └─[no]───▶ ITERATE      │
    └────────────────────────────┘
         │
         ▼
    tp_learn_from_outcome
         │
         ▼
    GETTIER_RESOLUTION_REPORT
  `,

  estimatedCost: { tokens: 40000, time: '10-20 minutes' },

  outputs: {
    resolutionReport: { type: 'GettierResolutionReport' },
    strengthenedJustification: { type: 'Justification' },
    newTests: { type: 'TestCase[]' },
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// COMPOSITION: Adversarial Self-Test Suite
// ─────────────────────────────────────────────────────────────────────────────

const tc_adversarial_self_test: TechniqueComposition = {
  id: 'tc_adversarial_self_test',
  name: 'Adversarial Self-Test Suite',
  description: 'Generate and run adversarial tests to find weaknesses',

  primitives: [
    'tp_analyze_architecture',
    'tp_analyze_theoretical_soundness',
    'tp_improve_adversarial_test',
    'tp_verify_claim',
    'tp_improve_plan_fix',
    'tp_learn_extract_pattern',
  ],

  operators: [
    {
      id: 'op_identify_weaknesses',
      type: 'parallel',
      inputs: ['tp_analyze_architecture', 'tp_analyze_theoretical_soundness'],
    },
    {
      id: 'op_weakness_aggregator',
      type: 'aggregate',
      inputs: ['op_identify_weaknesses'],
      aggregation: 'extract_weaknesses',
    },
    {
      id: 'op_generate_tests',
      type: 'map',
      inputs: ['tp_improve_adversarial_test'],
      over: 'weaknesses',
      config: { difficulty: 'hard', count: 10 },
    },
    {
      id: 'op_run_tests',
      type: 'map',
      inputs: ['tp_verify_claim'],
      over: 'test_cases',
    },
    {
      id: 'op_failure_analysis',
      type: 'filter',
      inputs: ['op_run_tests'],
      predicate: 'test_failed',
    },
    {
      id: 'op_plan_fixes',
      type: 'map',
      inputs: ['tp_improve_plan_fix'],
      over: 'failures',
    },
  ],

  flow: `
    ┌────────────────┬─────────────────┐
    │                │                 │
    ▼                ▼                 │
  tp_analyze       tp_analyze          │
  _architecture    _theoretical        │
    │                │                 │
    └────────┬───────┘                 │
             │                         │
             ▼                         │
    op_weakness_aggregator             │
             │                         │
             ▼ [for each weakness]     │
    ┌────────────────────────┐         │
    │ tp_improve_adversarial │         │
    │ _test                  │         │
    └────────────────────────┘         │
             │                         │
             ▼ [test_cases]            │
    ┌────────────────────────┐         │
    │ op_run_tests           │         │
    │ (tp_verify_claim ×N)   │         │
    └────────────────────────┘         │
             │                         │
             ▼                         │
    op_failure_analysis ───[0 failures]┘
             │
             ▼ [failures]
    ┌────────────────────────┐
    │ op_plan_fixes          │
    │ (tp_improve_plan_fix)  │
    └────────────────────────┘
             │
             ▼
    tp_learn_extract_pattern
             │
             ▼
    ADVERSARIAL_TEST_REPORT
  `,

  estimatedCost: { tokens: 80000, time: '20-40 minutes' },

  outputs: {
    testReport: { type: 'AdversarialTestReport' },
    weaknessesFound: { type: 'Weakness[]' },
    failedTests: { type: 'FailedTest[]' },
    fixPlans: { type: 'FixPlan[]' },
    patternsLearned: { type: 'LearnedPattern[]' },
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// COMPOSITION: Continuous Self-Improvement Pipeline
// ─────────────────────────────────────────────────────────────────────────────

const tc_continuous_improvement: TechniqueComposition = {
  id: 'tc_continuous_improvement',
  name: 'Continuous Self-Improvement Pipeline',
  description: 'Full improvement cycle from detection to learning',

  primitives: [
    'tp_self_refresh',
    'tp_analyze_architecture',
    'tp_analyze_theoretical_soundness',
    'tp_analyze_consistency',
    'tp_verify_calibration',
    'tp_improve_generate_recommendations',
    'tp_improve_plan_fix',
    'tp_verify_claim',
    'tp_learn_from_outcome',
    'tp_learn_extract_pattern',
  ],

  operators: [
    {
      id: 'op_detect_phase',
      type: 'sequence',
      inputs: ['tp_self_refresh', 'tp_analyze_architecture', 'tp_analyze_theoretical_soundness', 'tp_analyze_consistency'],
    },
    {
      id: 'op_assess_phase',
      type: 'sequence',
      inputs: ['tp_verify_calibration', 'tp_improve_generate_recommendations'],
    },
    {
      id: 'op_priority_gate',
      type: 'gate',
      inputs: ['op_assess_phase'],
      conditions: ['has_actionable_recommendations'],
      onFail: 'exit_healthy',
    },
    {
      id: 'op_fix_phase',
      type: 'iterate',
      inputs: ['tp_improve_plan_fix', 'tp_verify_claim'],
      over: 'top_recommendations',
      maxIterations: 5,
      exitCondition: 'all_verified_or_budget_exhausted',
    },
    {
      id: 'op_learn_phase',
      type: 'sequence',
      inputs: ['tp_learn_from_outcome', 'tp_learn_extract_pattern'],
    },
  ],

  flow: `
    ══════════════════════════════════════════════════════════════════
    PHASE 1: DETECT
    ══════════════════════════════════════════════════════════════════

    tp_self_refresh
         │
         ▼
    ┌────┴────┬────────────┬──────────────┐
    │         │            │              │
    ▼         ▼            ▼              │
  tp_analyze  tp_analyze   tp_analyze     │
  _architecture _theoretical _consistency │
    │         │            │              │
    └────┬────┴────────────┘              │
         │                                │
    ══════════════════════════════════════════════════════════════════
    PHASE 2: ASSESS
    ══════════════════════════════════════════════════════════════════
         │
         ▼
    tp_verify_calibration
         │
         ▼
    tp_improve_generate_recommendations
         │
         ▼
    op_priority_gate ──[no recommendations]──▶ EXIT_HEALTHY
         │
    ══════════════════════════════════════════════════════════════════
    PHASE 3: FIX (iterative)
    ══════════════════════════════════════════════════════════════════
         │
         ▼
    ┌───────────────────────────────────┐
    │  FOR EACH top_recommendation:    │
    │                                   │
    │    tp_improve_plan_fix           │
    │         │                        │
    │         ▼                        │
    │    [IMPLEMENT FIX]               │
    │         │                        │
    │         ▼                        │
    │    tp_verify_claim               │
    │         │                        │
    │    [verified?]                   │
    │      ├─[yes]──▶ next             │
    │      └─[no]───▶ retry or skip    │
    │                                   │
    └───────────────────────────────────┘
         │
    ══════════════════════════════════════════════════════════════════
    PHASE 4: LEARN
    ══════════════════════════════════════════════════════════════════
         │
         ▼
    tp_learn_from_outcome
         │
         ▼
    tp_learn_extract_pattern
         │
         ▼
    IMPROVEMENT_CYCLE_REPORT
  `,

  estimatedCost: { tokens: 150000, time: '30-60 minutes' },

  outputs: {
    cycleReport: { type: 'ImprovementCycleReport' },
    fixesApplied: { type: 'AppliedFix[]' },
    patternsLearned: { type: 'LearnedPattern[]' },
    nextCycleRecommendations: { type: 'Recommendation[]' },
    healthDelta: { type: 'HealthDelta' },
  },
};
```

#### B.3 Primitive Execution Engine

```typescript
/**
 * Self-Improvement Primitive Executor
 *
 * Executes self-improvement primitives with proper context and tracking.
 */
class SelfImprovementExecutor {
  constructor(
    private LiBrainian: LiBrainian,
    private storage: LibrarianStorage,
    private episodeRecorder: EpisodeRecorder
  ) {}

  /**
   * Execute a self-improvement primitive
   */
  async executePrimitive<T extends TechniquePrimitive>(
    primitive: T,
    inputs: PrimitiveInputs<T>,
    context: ExecutionContext
  ): Promise<PrimitiveResult<T>> {
    // Record episode start
    const episode = await this.episodeRecorder.startEpisode({
      type: 'self_improvement',
      primitive: primitive.id,
      inputs,
    });

    try {
      // Check preconditions
      const preconditionCheck = await this.checkPreconditions(primitive, context);
      if (!preconditionCheck.satisfied) {
        throw new PreconditionError(primitive.id, preconditionCheck.failures);
      }

      // Execute primitive
      const result = await this.executeCore(primitive, inputs, context);

      // Verify postconditions
      const postconditionCheck = await this.checkPostconditions(primitive, result);
      if (!postconditionCheck.satisfied) {
        episode.addWarning('postcondition_partial', postconditionCheck.failures);
      }

      // Record success
      await this.episodeRecorder.completeEpisode(episode, {
        status: 'success',
        result,
        postconditions: postconditionCheck,
      });

      return result;
    } catch (error) {
      // Record failure
      await this.episodeRecorder.completeEpisode(episode, {
        status: 'failed',
        error,
      });
      throw error;
    }
  }

  /**
   * Execute a self-improvement composition
   */
  async executeComposition<T extends TechniqueComposition>(
    composition: T,
    inputs: CompositionInputs<T>,
    context: ExecutionContext
  ): AsyncIterable<CompositionStepResult> {
    const episode = await this.episodeRecorder.startEpisode({
      type: 'self_improvement_composition',
      composition: composition.id,
      inputs,
    });

    const state = new CompositionState(composition, inputs);

    try {
      while (!state.isComplete()) {
        const nextStep = state.getNextStep();

        if (nextStep.type === 'primitive') {
          const result = await this.executePrimitive(
            nextStep.primitive,
            state.getInputsFor(nextStep),
            context
          );
          state.recordResult(nextStep, result);
          yield { step: nextStep, result, state: state.snapshot() };
        } else if (nextStep.type === 'operator') {
          const result = await this.executeOperator(nextStep.operator, state, context);
          state.recordResult(nextStep, result);
          yield { step: nextStep, result, state: state.snapshot() };

          // Handle gate failures
          if (nextStep.operator.type === 'gate' && !result.passed) {
            if (nextStep.operator.onFail === 'abort_with_diagnostic') {
              throw new GateAbortError(nextStep.operator.id, result.diagnostic);
            } else if (nextStep.operator.onFail === 'escalate_to_human') {
              yield { step: nextStep, escalation: result.diagnostic };
              return;
            }
          }
        }
      }

      // Record composition completion
      await this.episodeRecorder.completeEpisode(episode, {
        status: 'success',
        finalState: state.snapshot(),
      });
    } catch (error) {
      await this.episodeRecorder.completeEpisode(episode, {
        status: 'failed',
        error,
        partialState: state.snapshot(),
      });
      throw error;
    }
  }

  /**
   * Execute an operator
   */
  private async executeOperator(
    operator: Operator,
    state: CompositionState,
    context: ExecutionContext
  ): Promise<OperatorResult> {
    switch (operator.type) {
      case 'gate':
        return this.executeGate(operator, state);

      case 'parallel':
        return this.executeParallel(operator, state, context);

      case 'iterate':
        return this.executeIterate(operator, state, context);

      case 'map':
        return this.executeMap(operator, state, context);

      case 'aggregate':
        return this.executeAggregate(operator, state);

      case 'filter':
        return this.executeFilter(operator, state);

      default:
        throw new UnknownOperatorError(operator.type);
    }
  }

  private async executeGate(
    operator: GateOperator,
    state: CompositionState
  ): Promise<GateResult> {
    const inputResults = operator.inputs.map(id => state.getResult(id));

    for (const condition of operator.conditions) {
      const satisfied = await this.evaluateCondition(condition, inputResults);
      if (!satisfied) {
        return {
          passed: false,
          failedCondition: condition,
          diagnostic: await this.generateDiagnostic(condition, inputResults),
        };
      }
    }

    return { passed: true };
  }

  private async executeParallel(
    operator: ParallelOperator,
    state: CompositionState,
    context: ExecutionContext
  ): Promise<ParallelResult> {
    const primitives = operator.inputs.map(id =>
      this.findPrimitive(id, state.composition)
    );

    const results = await Promise.all(
      primitives.map(p =>
        this.executePrimitive(p, state.getInputsFor({ primitive: p }), context)
      )
    );

    return { results };
  }

  private async executeIterate(
    operator: IterateOperator,
    state: CompositionState,
    context: ExecutionContext
  ): Promise<IterateResult> {
    const iterations: IterationResult[] = [];

    for (let i = 0; i < operator.maxIterations; i++) {
      // Execute primitives in sequence
      for (const primitiveId of operator.inputs) {
        const primitive = this.findPrimitive(primitiveId, state.composition);
        const result = await this.executePrimitive(
          primitive,
          state.getInputsFor({ primitive }),
          context
        );
        state.recordIterationResult(i, primitiveId, result);
      }

      // Check exit condition
      if (await this.evaluateCondition(operator.exitCondition, state.snapshot())) {
        iterations.push({ iteration: i, exitedEarly: true });
        break;
      }

      iterations.push({ iteration: i, exitedEarly: false });
    }

    return { iterations, totalIterations: iterations.length };
  }
}
```

---

### C. Step-by-Step Self-Improvement Protocol

#### Step 1: Bootstrap LiBrainian on Itself

```bash
# Navigate to LiBrainian source
cd /path/to/wave0-autopilot

# Bootstrap LiBrainian's knowledge about itself
node scripts/librarian_bootstrap.mjs \
  --workspace ./src/LiBrainian \
  --config ./config/LiBrainian.json \
  --output-dir ./state/LiBrainian-on-LiBrainian

# Verify bootstrap completed
cat ./state/LiBrainian-on-LiBrainian/bootstrap_report.json
```

**Expected Output:**
```json
{
  "status": "complete",
  "entities_indexed": 847,
  "relationships_discovered": 2341,
  "embeddings_generated": 847,
  "context_packs_created": 156,
  "time_elapsed_ms": 45230,
  "coverage": {
    "functions": 0.98,
    "classes": 1.0,
    "modules": 1.0,
    "relationships": 0.87
  }
}
```

#### Step 2: Query for Architectural Gaps

```typescript
// Use LiBrainian to find its own architectural problems
const architecturalGaps = await LiBrainian.query({
  intent: `Identify architectural inconsistencies in LiBrainian:
    1. Interfaces that are too large (>20 methods)
    2. Circular dependencies
    3. Modules with unclear single responsibility
    4. Dead code or unused exports
    5. Missing error handling patterns`,
  depth: 'L3',
  engines: ['constraint', 'tdd', 'meta'],
});

console.log('Architectural Gaps Found:');
for (const gap of architecturalGaps.synthesis.findings) {
  console.log(`- ${gap.location}: ${gap.description}`);
  console.log(`  Severity: ${gap.severity}`);
  console.log(`  Suggested fix: ${gap.suggestion}`);
}
```

#### Step 3: Query for Theoretical Gaps

```typescript
// Ask LiBrainian about its theoretical foundations
const theoreticalAnalysis = await LiBrainian.query({
  intent: `Analyze LiBrainian's theoretical foundations:
    1. Which claims are made without formal proofs?
    2. Which confidence calculations lack statistical backing?
    3. Which approximations lack error bounds?
    4. Which complexity claims are unverified?`,
  depth: 'L4',
  engines: ['constraint', 'meta'],
  includeEvidence: true,
});

// Generate theory improvement roadmap
const roadmap = await LiBrainian.planTechnique({
  composition: 'tc_theoretical_audit',
  context: theoreticalAnalysis,
  constraints: {
    priorityBy: 'foundational_importance',
    maxEffort: '2_weeks',
  },
});
```

#### Step 4: Verify LiBrainian's Claims About Itself

```typescript
// Meta-verification: Can LiBrainian verify its own claims?
const selfClaims = await LiBrainian.query({
  intent: 'What claims does LiBrainian make about its own capabilities?',
  depth: 'L2',
});

const verificationResults = await Promise.all(
  selfClaims.synthesis.claims.map(async claim => {
    const strategy = verificationEngine.getStrategy(claim);
    const result = await strategy.execute();

    return {
      claim: claim.text,
      decidability: strategy.guarantees.soundness,
      verification: result,
      gettierCheck: await gettierChecker.assess(claim, result.evidence),
    };
  })
);

// Flag Gettier cases (true but accidentally so)
const gettierCases = verificationResults.filter(r =>
  r.gettierCheck.status === 'gettier_case'
);

console.log(`Found ${gettierCases.length} Gettier cases (lucky truths):`);
for (const gc of gettierCases) {
  console.log(`- "${gc.claim}"`);
  console.log(`  Warning: ${gc.gettierCheck.warning}`);
}
```

#### Step 5: Detect Knowledge Decay

```typescript
// Check for stale knowledge about LiBrainian itself
const freshnessReport = await LiBrainian.assessFreshness({
  workspace: './src/LiBrainian',
  since: 'last_commit',
});

const staleKnowledge = freshnessReport.entities.filter(e =>
  e.staleness.score > 0.5
);

console.log(`${staleKnowledge.length} entities have stale knowledge:`);
for (const entity of staleKnowledge) {
  console.log(`- ${entity.id}: ${(entity.staleness.score * 100).toFixed(0)}% stale`);
  console.log(`  Most stale section: ${entity.staleness.mostStaleSection}`);
  console.log(`  Refresh recommended: ${entity.staleness.refreshRecommended}`);
}

// Trigger targeted refresh
await LiBrainian.refresh({
  entities: staleKnowledge.map(e => e.id),
  mode: 'incremental',
});
```

### C. Continuous Self-Improvement Automation

```typescript
/**
 * Automated LiBrainian Self-Improvement Pipeline
 *
 * Runs periodically (e.g., after each commit) to:
 * 1. Re-index changed files
 * 2. Detect new inconsistencies
 * 3. Update confidence based on outcomes
 * 4. Generate improvement recommendations
 */
class LibrarianSelfImprovementPipeline {
  async run(trigger: 'commit' | 'scheduled' | 'manual'): Promise<ImprovementReport> {
    const report: ImprovementReport = {
      trigger,
      timestamp: new Date(),
      phases: [],
    };

    // Phase 1: Incremental re-indexing
    const reindexResult = await this.incrementalReindex();
    report.phases.push({
      name: 'reindex',
      status: reindexResult.status,
      entitiesUpdated: reindexResult.updated,
      newEntities: reindexResult.new,
      removedEntities: reindexResult.removed,
    });

    // Phase 2: Self-consistency check
    const consistencyResult = await this.checkSelfConsistency();
    report.phases.push({
      name: 'consistency',
      status: consistencyResult.status,
      inconsistencies: consistencyResult.issues,
      autoFixed: consistencyResult.autoFixed,
    });

    // Phase 3: Theoretical soundness check
    const soundnessResult = await this.checkTheoreticalSoundness();
    report.phases.push({
      name: 'soundness',
      status: soundnessResult.status,
      gettierCases: soundnessResult.gettierCases,
      ungroundedClaims: soundnessResult.ungroundedClaims,
    });

    // Phase 4: Update calibration
    const calibrationResult = await this.updateCalibration();
    report.phases.push({
      name: 'calibration',
      status: calibrationResult.status,
      samplesAdded: calibrationResult.newSamples,
      newECE: calibrationResult.expectedCalibrationError,
      improvement: calibrationResult.eceImprovement,
    });

    // Phase 5: Generate recommendations
    const recommendations = await this.generateRecommendations(report);
    report.recommendations = recommendations;

    // Persist report
    await this.persistReport(report);

    return report;
  }

  /**
   * Incremental re-indexing based on git diff
   */
  private async incrementalReindex(): Promise<ReindexResult> {
    const changedFiles = await this.getChangedFiles();

    for (const file of changedFiles) {
      // Re-extract knowledge
      const knowledge = await this.extractor.extract(file);

      // Re-generate embeddings
      const embeddings = await this.embedder.embed(knowledge);

      // Update storage
      await this.storage.upsertKnowledge(knowledge);
      await this.storage.upsertEmbeddings(embeddings);

      // Update relationships
      const relationships = await this.relationshipMapper.map(file);
      await this.storage.upsertRelationships(relationships);
    }

    return {
      status: 'complete',
      updated: changedFiles.length,
      new: this.countNewEntities(),
      removed: this.countRemovedEntities(),
    };
  }

  /**
   * Check for inconsistencies between LiBrainian's knowledge
   * and its actual implementation
   */
  private async checkSelfConsistency(): Promise<ConsistencyResult> {
    const issues: ConsistencyIssue[] = [];

    // Check: Do claimed interfaces match actual code?
    const claimedInterfaces = await this.query({
      intent: 'List all public interfaces in LiBrainian',
    });

    const actualInterfaces = await this.extractActualInterfaces();

    for (const claimed of claimedInterfaces.synthesis.interfaces) {
      const actual = actualInterfaces.find(i => i.name === claimed.name);

      if (!actual) {
        issues.push({
          type: 'phantom_interface',
          claimed: claimed.name,
          message: `Interface ${claimed.name} claimed but not found in code`,
        });
      } else if (!this.signaturesMatch(claimed.signature, actual.signature)) {
        issues.push({
          type: 'signature_mismatch',
          interface: claimed.name,
          claimed: claimed.signature,
          actual: actual.signature,
        });
      }
    }

    // Check: Do claimed behaviors match test evidence?
    const claimedBehaviors = await this.query({
      intent: 'List all behavioral claims about LiBrainian functions',
    });

    for (const behavior of claimedBehaviors.synthesis.behaviors) {
      const testEvidence = await this.findTestEvidence(behavior);

      if (!testEvidence) {
        issues.push({
          type: 'untested_claim',
          claim: behavior.description,
          message: 'No test evidence found for this behavioral claim',
        });
      }
    }

    return {
      status: issues.length === 0 ? 'consistent' : 'inconsistencies_found',
      issues,
      autoFixed: await this.attemptAutoFix(issues),
    };
  }

  /**
   * Generate actionable improvement recommendations
   */
  private async generateRecommendations(
    report: ImprovementReport
  ): Promise<Recommendation[]> {
    const recommendations: Recommendation[] = [];

    // Based on consistency issues
    for (const issue of report.phases.find(p => p.name === 'consistency')?.issues || []) {
      recommendations.push({
        priority: issue.type === 'signature_mismatch' ? 'high' : 'medium',
        category: 'consistency',
        description: `Fix ${issue.type}: ${issue.message}`,
        suggestedAction: this.getSuggestedAction(issue),
        effort: this.estimateEffort(issue),
      });
    }

    // Based on Gettier cases
    for (const gc of report.phases.find(p => p.name === 'soundness')?.gettierCases || []) {
      recommendations.push({
        priority: 'high',
        category: 'epistemology',
        description: `Address Gettier case: "${gc.claim}"`,
        suggestedAction: `Strengthen justification or demote to "belief" status`,
        effort: 'medium',
      });
    }

    // Based on calibration
    const calibration = report.phases.find(p => p.name === 'calibration');
    if (calibration && calibration.newECE > 0.1) {
      recommendations.push({
        priority: 'high',
        category: 'calibration',
        description: `Calibration error is ${(calibration.newECE * 100).toFixed(1)}% (target: <10%)`,
        suggestedAction: 'Review recent predictions and adjust confidence model',
        effort: 'high',
      });
    }

    return recommendations.sort((a, b) =>
      this.priorityOrder(a.priority) - this.priorityOrder(b.priority)
    );
  }
}
```

### D. Self-Improvement Strategies

#### Strategy 1: Bootstrapping Improvement Loops

```typescript
/**
 * Use LiBrainian to improve LiBrainian's improvement process itself
 */
async function metaImprovement() {
  // Query: How effective is the current improvement process?
  const processAnalysis = await LiBrainian.query({
    intent: `Analyze the LiBrainian self-improvement pipeline:
      1. What improvements were made in the last month?
      2. Which recommendations were acted upon vs ignored?
      3. What is the improvement velocity?
      4. Where are the bottlenecks?`,
    depth: 'L3',
  });

  // Use analysis to improve the improvement process
  const metaRecommendations = await LiBrainian.planTechnique({
    composition: 'tc_process_improvement',
    context: processAnalysis,
  });

  return metaRecommendations;
}
```

#### Strategy 2: Adversarial Self-Testing

```typescript
/**
 * Use LiBrainian to generate adversarial tests for itself
 */
async function adversarialSelfTest() {
  // Ask LiBrainian to identify its own weaknesses
  const weaknesses = await LiBrainian.query({
    intent: `Identify queries that would expose LiBrainian's limitations:
      1. Edge cases in retrieval
      2. Ambiguous queries
      3. Multi-hop reasoning requirements
      4. Out-of-distribution inputs`,
    depth: 'L4',
  });

  // Generate adversarial test cases
  const adversarialTests = await LiBrainian.generate({
    type: 'test_cases',
    constraints: {
      targetWeaknesses: weaknesses.synthesis.weaknesses,
      difficulty: 'hard',
      quantity: 50,
    },
  });

  // Run adversarial tests
  const results = await Promise.all(
    adversarialTests.map(test => runAdversarialTest(test))
  );

  // Analyze failures
  const failures = results.filter(r => r.status === 'failed');

  console.log(`Adversarial test results: ${results.length - failures.length}/${results.length} passed`);

  // Generate fixes for failures
  for (const failure of failures) {
    const fix = await LiBrainian.planFix({
      failure,
      constraints: { mustPassAdversarialTest: true },
    });

    console.log(`Fix for "${failure.test.description}": ${fix.plan}`);
  }

  return { adversarialTests, results, failures };
}
```

#### Strategy 3: Cross-Version Comparison

```typescript
/**
 * Compare LiBrainian versions to ensure improvement
 */
async function crossVersionComparison(
  oldVersion: string,
  newVersion: string
): Promise<VersionComparisonReport> {
  // Run identical queries on both versions
  const testQueries = await getStandardTestQueries();

  const comparison = await Promise.all(testQueries.map(async query => {
    const oldResult = await runOnVersion(oldVersion, query);
    const newResult = await runOnVersion(newVersion, query);

    return {
      query,
      oldResult,
      newResult,
      improvement: assessImprovement(oldResult, newResult),
    };
  }));

  // Aggregate improvements
  const summary = {
    totalQueries: comparison.length,
    improved: comparison.filter(c => c.improvement > 0).length,
    degraded: comparison.filter(c => c.improvement < 0).length,
    unchanged: comparison.filter(c => c.improvement === 0).length,
    averageImprovement: average(comparison.map(c => c.improvement)),
  };

  // Flag regressions
  const regressions = comparison.filter(c => c.improvement < -0.1);
  if (regressions.length > 0) {
    console.warn(`Warning: ${regressions.length} regressions detected!`);
    for (const reg of regressions) {
      console.warn(`  - Query: "${reg.query.intent}"`);
      console.warn(`    Degradation: ${(-reg.improvement * 100).toFixed(1)}%`);
    }
  }

  return { comparison, summary, regressions };
}
```

### E. Monitoring Dashboard

```typescript
/**
 * Real-time LiBrainian health monitoring
 */
interface LibrarianHealthDashboard {
  /** Overall health score (0-1) */
  healthScore: number;

  /** Component health */
  components: {
    storage: ComponentHealth;
    embeddings: ComponentHealth;
    retrieval: ComponentHealth;
    synthesis: ComponentHealth;
    calibration: ComponentHealth;
  };

  /** Theoretical soundness */
  theoreticalHealth: {
    gettierCaseRate: number;
    calibrationError: number;
    approximationError: number;
    stabilityMargin: number;
  };

  /** Trend indicators */
  trends: {
    healthTrend: 'improving' | 'stable' | 'degrading';
    recentChanges: Change[];
    projectedHealth: number;  // 30-day projection
  };

  /** Active alerts */
  alerts: Alert[];
}

async function createHealthDashboard(): Promise<LibrarianHealthDashboard> {
  const componentHealth = await assessComponentHealth();
  const theoreticalHealth = await assessTheoreticalHealth();
  const trends = await computeTrends();
  const alerts = await generateAlerts(componentHealth, theoreticalHealth, trends);

  const healthScore = computeOverallHealth(componentHealth, theoreticalHealth);

  return {
    healthScore,
    components: componentHealth,
    theoreticalHealth,
    trends,
    alerts,
  };
}
```

### F. The LiBrainian Improvement Cycle

```
Week 1: Audit
├── Run full self-index
├── Generate theoretical soundness report
├── Identify Gettier cases
└── Create improvement backlog

Week 2: Address Critical
├── Fix Gettier cases (high priority)
├── Improve calibration
├── Address architectural inconsistencies
└── Update approximation bounds

Week 3: Improve Sophistication
├── Enhance argumentation system
├── Add social epistemology features
├── Improve bias detection
└── Add new verification strategies

Week 4: Validate & Iterate
├── Run adversarial tests
├── Cross-version comparison
├── Update documentation
└── Plan next cycle
```

---

## Part XIV: Composition Discovery, Guidance, and Evolution

**The Missing Layer: From "What Can I Build?" to "What Should I Build?"**

The current LiBrainian provides powerful composition primitives but lacks the guidance layer that helps users (human or agent) understand:
- What compositions exist and when to use them
- What compositions they *should* build for their specific codebase
- How compositions should evolve based on outcomes

This section specifies the systems needed to close these gaps.

---

### [SPEC_SLICE] Part XIV — Composition Discovery & Evolution

- **[CAPABILITIES] Required**: technique primitives + compositions present in storage; graph of dependencies; ability to read codebase metadata (files/modules).
- **[CAPABILITIES] Optional**: embeddings for semantic matching; LLM for intent classification; learning loop data (episodes/outcomes).
- **[ADAPTERS] Interfaces**: storage adapter (composition/primitive registry + outcomes); embedding service via `EmbeddingService`; LLM provider via `checkAllProviders()` + `llm_env`.
- **[EVIDENCE_LEDGER] Events**: suggestion generated (inputs + rationale), suggestion accepted/declined, composition execution outcome, mutation proposal + approval/deny.
- **[CLAIMS] Outputs**: “suggested composition” claims must cite evidence refs (files, outcomes, or similarity scores) and list defeaters (missing capabilities, low coverage).
- **Degradation**: if embeddings/LLM unavailable → fall back to keyword + structural heuristics and mark results as `unverified_by_trace(provider_unavailable)` when semantic intent cannot be supported.
- **Evidence commands**: `cd packages/LiBrainian && npx vitest src/api/__tests__/technique_compositions.test.ts src/api/__tests__/technique_composition_builder.test.ts` and `npm run test:tier0`.

### Preamble: The Fundamental Problems (For Codex)

> **IMPORTANT FOR IMPLEMENTING AGENT**: This section identifies the *underlying problems* that need solving. The solutions provided in sections A-E are **reference implementations**—one reasonable approach, not the only approach. You are explicitly encouraged to:
> 1. Deeply understand the problem before implementing the reference solution
> 2. Propose alternative solutions if you identify a better approach
> 3. Combine, simplify, or restructure the reference solutions
> 4. Challenge assumptions made in the reference solutions
>
> The goal is to **solve the problems**, not to faithfully transcribe the reference code.

#### Problem 1: The Paradox of Choice

**What's broken**: Users face 64 primitives and ~10 compositions with no guidance on which to use. The current selection mechanism (`selectTechniqueCompositions`) uses naive keyword matching that misses semantic intent.

**Root cause**: The system was built bottom-up (primitives first, compositions second) without a top-down ontology of *what users actually want to accomplish*. There's no mapping from user intent → appropriate tool.

**Why it matters**: Users either:
- Pick randomly and get poor results (undermines trust)
- Don't use the system at all (wasted capability)
- Always use the same few compositions (underutilization)

**Success criteria for any solution**:
- Given a natural language intent, suggest relevant compositions with >80% user acceptance
- Latency <500ms for suggestion
- Works without requiring user to know primitive/composition names

**Reference solution direction**: Pattern Catalog (Section A) + Semantic Selection (Section B)

**Alternative approaches worth considering**:
- LLM-based intent classification (simpler, but adds latency/cost)
- Few-shot learning from user's past selections
- Collaborative filtering ("users like you also used...")
- Hierarchical menu/wizard UI instead of search
- No catalog at all—just embed all composition descriptions and do nearest-neighbor

---

#### Problem 2: Cold Start for New Codebases

**What's broken**: When LiBrainian bootstraps on a new codebase, it doesn't know what compositions would be useful for *that specific codebase*. A codebase with auth needs security compositions; a codebase with APIs needs breaking-change detection; etc.

**Root cause**: Compositions are generic, not codebase-aware. There's no analysis that says "given what's in this repo, here's what you'll probably need."

**Why it matters**: Users have to manually discover which compositions are relevant, which requires expertise they may not have. New users get no value until they learn the system.

**Success criteria for any solution**:
- After bootstrap, proactively suggest 3-5 relevant compositions with rationale
- Suggestions based on actual codebase content, not guesses
- <2 minutes to generate suggestions (can be async/background)

**Reference solution direction**: Codebase-Aware Suggestion (Section C)

**Alternative approaches worth considering**:
- Analyze package.json/requirements.txt/Cargo.toml for dependency-based suggestions
- Look at existing CI/CD config to infer what checks are already run
- Mine git commit messages for recurring themes ("fix auth", "API breaking change")
- Ask the user directly via onboarding wizard
- Use file naming conventions (files named `*auth*`, `*security*`, etc.)

---

#### Problem 3: Compositions Don't Learn

**What's broken**: When a composition succeeds or fails, that outcome is recorded but doesn't improve future composition behavior. The `ClosedLoopLearner` tracks success rates but doesn't:
- Propose new compositions from successful ad-hoc sequences
- Mutate underperforming compositions
- Deprecate compositions that consistently fail

**Root cause**: The learning loop is observational, not generative. It watches and records but doesn't act on what it learns.

**Why it matters**: The system can't self-improve. Successful patterns discovered by users aren't captured and shared. Bad compositions persist indefinitely.

**Success criteria for any solution**:
- After N executions, automatically propose new compositions from recurring successful patterns
- Surface underperforming compositions with mutation suggestions
- Eventually deprecate compositions with <30% success rate over 30+ uses
- All proposals require human/agent approval (no unsupervised evolution)

**Reference solution direction**: Evolution Engine (Section D)

**Alternative approaches worth considering**:
- Reinforcement learning on composition structure
- A/B testing framework for composition variants
- Community-contributed compositions with voting/rating
- LLM-generated compositions based on failure analysis
- Simpler: just surface success/failure stats and let humans decide

---

#### Problem 4: No Mental Model for Users

**What's broken**: Users don't understand *how to think about* compositions. When should I use a loop operator? When do I need a gate? What's the difference between verification and investigation patterns?

**Root cause**: Compositions are presented as flat lists, not as instances of higher-level patterns. There's no teaching material embedded in the system.

**Why it matters**: Users can't generalize from examples. They treat each composition as a black box rather than understanding the underlying principles.

**Success criteria for any solution**:
- Users can answer "what pattern is this composition an instance of?"
- Users can construct new compositions by combining known patterns
- System provides anti-pattern warnings ("you're doing X, which usually fails because Y")

**Reference solution direction**: Pattern Catalog with archetypes, anti-patterns, success/failure signals (Section A)

**Alternative approaches worth considering**:
- Interactive tutorial that teaches patterns through examples
- "Explain this composition" feature that describes the pattern it implements
- Composition templates that users fill in rather than building from scratch
- Visual composition builder with pattern-based constraints

---

#### Problem 5: Keyword Matching is Semantically Blind

**What's broken**: `selectTechniqueCompositions` uses hardcoded keyword lists:
```typescript
const COMPOSITION_KEYWORDS = {
  'tc_root_cause_recovery': ['bug', 'fix', 'error', 'failure', 'debug'],
  // ...
};
```
This misses synonyms ("issue" vs "bug"), context ("security bug" vs "UI bug"), and semantic similarity.

**Root cause**: Simple implementation that worked for demos but doesn't scale.

**Why it matters**: Users phrase things differently. "Investigate the regression" should match "tc_root_cause_recovery" even though "regression" isn't in the keyword list.

**Success criteria for any solution**:
- Semantic similarity matching (embeddings or similar)
- Handle synonyms, paraphrases, and related concepts
- Combine semantic matching with historical success rates
- Graceful fallback when embeddings unavailable

**Reference solution direction**: Semantic Selection Engine (Section B)

**Alternative approaches worth considering**:
- Expand keyword lists automatically using WordNet/synonyms
- LLM-based classification with structured output
- Hybrid: keyword matching + embedding similarity + learning boost
- User feedback loop: "was this the right composition?" to improve matching

---

#### Summary: What Must Be True After Implementation

Regardless of which solutions are chosen, the following must be true:

| Requirement | Metric |
|------------|--------|
| Users can find relevant compositions | >80% acceptance of top suggestion |
| New codebases get useful suggestions | 3-5 relevant suggestions at bootstrap |
| System learns from outcomes | New compositions proposed after patterns emerge |
| Users understand composition structure | Can identify pattern type of any composition |
| Semantic matching works | "Debug the auth issue" matches security+investigation compositions |

---

### Reference Solutions

The following sections (A-E) provide **reference implementations** for the problems above. They are:
- **Complete enough to implement directly** if you judge them sound
- **Modular enough to replace individually** if you have a better approach
- **Documented with rationale** so you can understand the design decisions

If you deviate from the reference solutions, document:
1. What problem you're solving differently
2. Why your approach is better
3. How your approach meets the success criteria

---

### A. The Composition Pattern Catalog

**Problem**: Developers see 64 primitives and 10 compositions but don't know which patterns apply to their situation.

**Solution**: A structured pattern catalog that maps *situations* to *composition archetypes*.

#### A.1 Pattern Catalog Schema

```typescript
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * COMPOSITION PATTERN CATALOG
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Maps situations → composition archetypes → concrete implementations
 */

interface CompositionPattern {
  id: string;
  name: string;
  archetype: CompositionArchetype;

  /** When to use this pattern */
  situations: Situation[];

  /** Core primitives (always include) */
  corePrimitives: string[];

  /** Optional primitives (include based on context) */
  optionalPrimitives: OptionalPrimitive[];

  /** Recommended operators */
  operators: OperatorRecommendation[];

  /** Anti-patterns to avoid */
  antiPatterns: AntiPattern[];

  /** Example compositions using this pattern */
  examples: string[];

  /** Success indicators */
  successSignals: string[];

  /** Failure indicators */
  failureSignals: string[];

  /** Embedding for semantic matching */
  embedding?: number[];
}

type CompositionArchetype =
  | 'investigation'      // Understanding why something happened
  | 'verification'       // Validating something is correct/safe
  | 'construction'       // Building something new
  | 'transformation'     // Changing existing code safely
  | 'analysis'           // Understanding without changing
  | 'coordination'       // Multi-agent/multi-step orchestration
  | 'recovery'           // Fixing/healing something broken
  | 'optimization'       // Improving performance/quality
  | 'evolution'          // Meta-level self-improvement
  ;

interface Situation {
  trigger: string;           // What initiates this situation
  context: string[];         // Contextual signals that indicate this situation
  confidence: number;        // How confident we are this situation matches
  examples: string[];        // Natural language examples
}

interface OptionalPrimitive {
  primitiveId: string;
  includeWhen: string[];     // Conditions that warrant inclusion
  excludeWhen: string[];     // Conditions that warrant exclusion
  rationale: string;
}

interface OperatorRecommendation {
  type: string;
  purpose: string;
  placement: 'early' | 'middle' | 'late' | 'wrapper';
  conditions?: string[];
}

interface AntiPattern {
  description: string;
  whyBad: string;
  betterAlternative: string;
}
```

#### A.2 The Core Pattern Catalog

```typescript
const COMPOSITION_PATTERN_CATALOG: CompositionPattern[] = [
  // ─────────────────────────────────────────────────────────────────────────
  // INVESTIGATION PATTERNS
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'pattern_bug_investigation',
    name: 'Bug Investigation',
    archetype: 'investigation',

    situations: [
      {
        trigger: 'Something is broken and we need to find why',
        context: ['error message', 'failing test', 'unexpected behavior', 'regression'],
        confidence: 0.9,
        examples: [
          'Why is the login failing?',
          'Debug the checkout error',
          'Find the source of this exception',
          'Investigate why tests are flaky',
        ],
      },
    ],

    corePrimitives: [
      'tp_hypothesis',         // Form theories about cause
      'tp_bisect',             // Narrow down the culprit
      'tp_root_cause',         // Identify the actual cause
      'tp_verify_plan',        // Verify the diagnosis
    ],

    optionalPrimitives: [
      {
        primitiveId: 'tp_min_repro',
        includeWhen: ['bug is intermittent', 'reproduction steps unclear'],
        excludeWhen: ['bug is deterministic and well-understood'],
        rationale: 'Minimal reproduction isolates the issue',
      },
      {
        primitiveId: 'tp_instrument',
        includeWhen: ['need more observability', 'logs insufficient'],
        excludeWhen: ['already have sufficient logging'],
        rationale: 'Adds visibility into execution',
      },
      {
        primitiveId: 'tp_failure_mode_analysis',
        includeWhen: ['critical system', 'need to prevent recurrence'],
        excludeWhen: ['simple one-off bug'],
        rationale: 'Systematic failure analysis for critical bugs',
      },
    ],

    operators: [
      {
        type: 'loop',
        purpose: 'Iterate hypothesis-test until signal stabilizes',
        placement: 'wrapper',
        conditions: ['hypothesis unresolved', 'signal unstable'],
      },
    ],

    antiPatterns: [
      {
        description: 'Fixing without understanding',
        whyBad: 'May introduce new bugs or mask the real issue',
        betterAlternative: 'Always verify root cause before implementing fix',
      },
      {
        description: 'Skipping minimal reproduction',
        whyBad: 'Wastes time investigating non-essential factors',
        betterAlternative: 'Create minimal repro first to isolate variables',
      },
    ],

    examples: ['tc_root_cause_recovery'],

    successSignals: [
      'Root cause identified with evidence',
      'Reproduction is deterministic',
      'Fix addresses root cause, not symptoms',
    ],

    failureSignals: [
      'Multiple hypotheses remain viable',
      'Bug cannot be reproduced',
      'Fix introduced new failures',
    ],
  },

  {
    id: 'pattern_performance_investigation',
    name: 'Performance Investigation',
    archetype: 'investigation',

    situations: [
      {
        trigger: 'System is slow and we need to find why',
        context: ['latency increase', 'throughput decrease', 'resource exhaustion', 'timeout'],
        confidence: 0.85,
        examples: [
          'Why is the API slow?',
          'Find the performance bottleneck',
          'Investigate memory leak',
          'Profile CPU usage',
        ],
      },
    ],

    corePrimitives: [
      'tp_hypothesis',
      'tp_instrument',          // Add profiling/metrics
      'tp_bisect',              // Narrow down hot paths
      'tp_root_cause',
    ],

    optionalPrimitives: [
      {
        primitiveId: 'tp_dependency_map',
        includeWhen: ['performance issue may be in dependency', 'complex call graph'],
        excludeWhen: ['isolated component'],
        rationale: 'Understand what the slow path touches',
      },
      {
        primitiveId: 'tp_cost_estimation',
        includeWhen: ['need to quantify improvement value'],
        excludeWhen: ['improvement is obviously worthwhile'],
        rationale: 'Justify optimization investment',
      },
    ],

    operators: [
      {
        type: 'loop',
        purpose: 'Profile-optimize-measure cycle',
        placement: 'wrapper',
        conditions: ['performance target not met'],
      },
    ],

    antiPatterns: [
      {
        description: 'Premature optimization',
        whyBad: 'May optimize the wrong thing',
        betterAlternative: 'Always profile first to find actual bottleneck',
      },
      {
        description: 'Optimizing without baseline',
        whyBad: 'Cannot measure improvement',
        betterAlternative: 'Establish baseline metrics before optimizing',
      },
    ],

    examples: ['tc_performance_analysis'],

    successSignals: [
      'Bottleneck identified with profiling data',
      'Optimization provides measurable improvement',
      'No regression in other areas',
    ],

    failureSignals: [
      'Optimization provides no measurable improvement',
      'New bottleneck appears',
      'Correctness compromised for performance',
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // VERIFICATION PATTERNS
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'pattern_change_verification',
    name: 'Change Verification',
    archetype: 'verification',

    situations: [
      {
        trigger: 'Code change needs validation before merge/deploy',
        context: ['pull request', 'code review', 'pre-merge', 'pre-deploy'],
        confidence: 0.95,
        examples: [
          'Review this PR',
          'Is this change safe?',
          'Verify the refactor',
          'Check for breaking changes',
        ],
      },
    ],

    corePrimitives: [
      'tp_assumption_audit',    // What assumptions does this change make?
      'tp_change_impact',       // What does this affect?
      'tp_test_gap_analysis',   // Are there untested paths?
      'tp_verify_plan',         // Final verification
    ],

    optionalPrimitives: [
      {
        primitiveId: 'tp_edge_case_catalog',
        includeWhen: ['complex logic', 'many branches', 'user input handling'],
        excludeWhen: ['simple refactor', 'no new logic'],
        rationale: 'Ensure edge cases are handled',
      },
      {
        primitiveId: 'tp_security_abuse_cases',
        includeWhen: ['auth changes', 'input handling', 'external data'],
        excludeWhen: ['internal-only code', 'no security surface'],
        rationale: 'Security review for sensitive changes',
      },
      {
        primitiveId: 'tp_accessibility_review',
        includeWhen: ['UI changes', 'user-facing'],
        excludeWhen: ['backend only', 'no UI impact'],
        rationale: 'Ensure accessibility compliance',
      },
    ],

    operators: [
      {
        type: 'parallel',
        purpose: 'Run independent verification sweeps concurrently',
        placement: 'middle',
      },
      {
        type: 'gate',
        purpose: 'Stop if critical issues found',
        placement: 'late',
        conditions: ['missing evidence', 'critical risk identified'],
      },
    ],

    antiPatterns: [
      {
        description: 'Approving without understanding impact',
        whyBad: 'May approve breaking changes',
        betterAlternative: 'Always run change impact analysis',
      },
      {
        description: 'Ignoring test gaps',
        whyBad: 'Untested code is unknown code',
        betterAlternative: 'Address test gaps before approval',
      },
    ],

    examples: ['tc_agentic_review_v1'],

    successSignals: [
      'All assumptions validated',
      'Impact understood and acceptable',
      'Test coverage adequate',
      'No security issues',
    ],

    failureSignals: [
      'Unknown assumptions remain',
      'Impact unclear or too broad',
      'Critical test gaps',
      'Security concerns unaddressed',
    ],
  },

  {
    id: 'pattern_release_verification',
    name: 'Release Verification',
    archetype: 'verification',

    situations: [
      {
        trigger: 'Preparing to release/deploy to production',
        context: ['release', 'deploy', 'ship', 'production', 'launch'],
        confidence: 0.9,
        examples: [
          'Is this ready to ship?',
          'Release readiness check',
          'Pre-production verification',
          'Deploy safety check',
        ],
      },
    ],

    corePrimitives: [
      'tp_release_plan',
      'tp_risk_scan',
      'tp_dependency_map',
      'tp_test_gap_analysis',
      'tp_verify_plan',
    ],

    optionalPrimitives: [
      {
        primitiveId: 'tp_accessibility_review',
        includeWhen: ['user-facing changes'],
        excludeWhen: ['backend only'],
        rationale: 'Ensure accessibility for all users',
      },
      {
        primitiveId: 'tp_threat_model',
        includeWhen: ['security-sensitive release', 'new attack surface'],
        excludeWhen: ['no security changes'],
        rationale: 'Comprehensive security review',
      },
      {
        primitiveId: 'tp_graceful_degradation',
        includeWhen: ['critical service', 'high availability required'],
        excludeWhen: ['non-critical feature'],
        rationale: 'Ensure system degrades gracefully under failure',
      },
    ],

    operators: [
      {
        type: 'gate',
        purpose: 'Block release if verification fails',
        placement: 'late',
        conditions: ['verification incomplete', 'rollback plan missing', 'critical risk'],
      },
    ],

    antiPatterns: [
      {
        description: 'Releasing without rollback plan',
        whyBad: 'Cannot recover from failed release',
        betterAlternative: 'Always have tested rollback procedure',
      },
      {
        description: 'Skipping dependency verification',
        whyBad: 'May break downstream consumers',
        betterAlternative: 'Verify all dependencies are compatible',
      },
    ],

    examples: ['tc_release_readiness'],

    successSignals: [
      'All verification gates pass',
      'Rollback plan tested',
      'Dependencies verified',
      'Risk acknowledged and mitigated',
    ],

    failureSignals: [
      'Verification gates fail',
      'No rollback plan',
      'Dependency conflicts',
      'Unmitigated critical risks',
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // CONSTRUCTION PATTERNS
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'pattern_feature_construction',
    name: 'Feature Construction',
    archetype: 'construction',

    situations: [
      {
        trigger: 'Building a new feature from scratch',
        context: ['new feature', 'implement', 'build', 'create', 'add'],
        confidence: 0.85,
        examples: [
          'Add user authentication',
          'Implement the search feature',
          'Build the dashboard',
          'Create the API endpoint',
        ],
      },
    ],

    corePrimitives: [
      'tp_clarify_goal',        // What exactly are we building?
      'tp_list_constraints',    // What are the constraints?
      'tp_decompose',           // Break into sub-tasks
      'tp_verify_plan',         // Verify the plan is sound
    ],

    optionalPrimitives: [
      {
        primitiveId: 'tp_threat_model',
        includeWhen: ['security-sensitive feature', 'handles user data'],
        excludeWhen: ['internal tooling', 'no security surface'],
        rationale: 'Security-first design for sensitive features',
      },
      {
        primitiveId: 'tp_edge_case_catalog',
        includeWhen: ['complex user interactions', 'many states'],
        excludeWhen: ['simple CRUD'],
        rationale: 'Enumerate edge cases before building',
      },
      {
        primitiveId: 'tp_cost_estimation',
        includeWhen: ['large feature', 'needs resource planning'],
        excludeWhen: ['small feature', 'no budget constraints'],
        rationale: 'Estimate effort before committing',
      },
    ],

    operators: [
      {
        type: 'sequence',
        purpose: 'Ensure planning precedes execution',
        placement: 'early',
      },
      {
        type: 'parallel',
        purpose: 'Build independent sub-components concurrently',
        placement: 'middle',
      },
    ],

    antiPatterns: [
      {
        description: 'Building without clear requirements',
        whyBad: 'May build the wrong thing',
        betterAlternative: 'Always clarify goal and constraints first',
      },
      {
        description: 'Monolithic implementation',
        whyBad: 'Hard to test, review, and iterate',
        betterAlternative: 'Decompose into smaller, testable pieces',
      },
    ],

    examples: ['tc_feature_development'],

    successSignals: [
      'Requirements clear and agreed',
      'Plan decomposed into testable pieces',
      'Each piece verified before integration',
    ],

    failureSignals: [
      'Requirements changed mid-build',
      'Integration issues discovered late',
      'Feature doesn\'t meet actual needs',
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // TRANSFORMATION PATTERNS
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'pattern_refactoring',
    name: 'Safe Refactoring',
    archetype: 'transformation',

    situations: [
      {
        trigger: 'Changing code structure without changing behavior',
        context: ['refactor', 'rename', 'extract', 'reorganize', 'clean up'],
        confidence: 0.9,
        examples: [
          'Refactor the auth module',
          'Extract this into a service',
          'Rename the API endpoints',
          'Split this file',
        ],
      },
    ],

    corePrimitives: [
      'tp_change_impact',       // What will this refactor affect?
      'tp_dependency_map',      // What depends on what we're changing?
      'tp_test_gap_analysis',   // Do we have adequate tests?
      'tp_verify_plan',         // Verify behavior preserved
    ],

    optionalPrimitives: [
      {
        primitiveId: 'tp_min_repro',
        includeWhen: ['need to verify behavior doesn\'t change'],
        excludeWhen: ['comprehensive test suite exists'],
        rationale: 'Create characterization tests before refactoring',
      },
      {
        primitiveId: 'tp_semantic_dedup',
        includeWhen: ['consolidating duplicate code'],
        excludeWhen: ['not removing duplication'],
        rationale: 'Ensure deduplication is semantically correct',
      },
    ],

    operators: [
      {
        type: 'gate',
        purpose: 'Stop if behavior change detected',
        placement: 'late',
        conditions: ['test failure', 'behavior change detected'],
      },
    ],

    antiPatterns: [
      {
        description: 'Refactoring without tests',
        whyBad: 'Cannot verify behavior is preserved',
        betterAlternative: 'Add characterization tests first',
      },
      {
        description: 'Big bang refactoring',
        whyBad: 'Hard to review, easy to break',
        betterAlternative: 'Small, incremental refactorings with verification',
      },
    ],

    examples: ['tc_safe_refactor'],

    successSignals: [
      'All existing tests pass',
      'No behavior change detected',
      'Code structure improved',
    ],

    failureSignals: [
      'Tests fail after refactor',
      'Behavior changed unintentionally',
      'New bugs introduced',
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // COORDINATION PATTERNS
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'pattern_multi_agent_task',
    name: 'Multi-Agent Coordination',
    archetype: 'coordination',

    situations: [
      {
        trigger: 'Task requires multiple agents working together',
        context: ['parallel work', 'multiple files', 'complex task', 'team coordination'],
        confidence: 0.8,
        examples: [
          'Implement this across the stack',
          'Parallelize this work',
          'Coordinate frontend and backend changes',
          'Distributed implementation',
        ],
      },
    ],

    corePrimitives: [
      'tp_decompose',              // Split work into agent-sized chunks
      'tp_ownership_matrix',       // Assign ownership to avoid conflicts
      'tp_blackboard_coordination',// Shared state for coordination
      'tp_arbitration',            // Resolve conflicts
    ],

    optionalPrimitives: [
      {
        primitiveId: 'tp_contract_net_leasing',
        includeWhen: ['dynamic task assignment needed'],
        excludeWhen: ['static assignment is fine'],
        rationale: 'Dynamic resource allocation',
      },
      {
        primitiveId: 'tp_worktree_isolation',
        includeWhen: ['git conflicts possible'],
        excludeWhen: ['no overlapping file changes'],
        rationale: 'Prevent git conflicts between agents',
      },
      {
        primitiveId: 'tp_communication_cadence',
        includeWhen: ['long-running coordination', 'need checkpoints'],
        excludeWhen: ['short task'],
        rationale: 'Structured communication for long tasks',
      },
    ],

    operators: [
      {
        type: 'parallel',
        purpose: 'Execute independent sub-tasks concurrently',
        placement: 'middle',
      },
      {
        type: 'quorum',
        purpose: 'Require agreement from multiple agents',
        placement: 'late',
      },
      {
        type: 'gate',
        purpose: 'Synchronization point before integration',
        placement: 'late',
        conditions: ['sub-tasks incomplete', 'conflicts detected'],
      },
    ],

    antiPatterns: [
      {
        description: 'No ownership boundaries',
        whyBad: 'Agents step on each other',
        betterAlternative: 'Clear ownership matrix before parallel work',
      },
      {
        description: 'No conflict resolution',
        whyBad: 'Conflicts discovered at integration',
        betterAlternative: 'Arbitration mechanism for conflicts',
      },
    ],

    examples: ['tc_multi_agent_implementation'],

    successSignals: [
      'Sub-tasks complete without conflicts',
      'Integration succeeds',
      'No duplicated work',
    ],

    failureSignals: [
      'Git conflicts at merge',
      'Duplicated or conflicting implementations',
      'Integration failures',
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // EVOLUTION PATTERNS
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'pattern_self_improvement',
    name: 'Self-Improvement',
    archetype: 'evolution',

    situations: [
      {
        trigger: 'System needs to improve its own capabilities',
        context: ['meta', 'self', 'improve', 'evolve', 'learn'],
        confidence: 0.75,
        examples: [
          'Improve LiBrainian\'s accuracy',
          'Evolve the agent\'s strategies',
          'Learn from past failures',
          'Optimize the system itself',
        ],
      },
    ],

    corePrimitives: [
      'tp_self_bootstrap',       // Index self
      'tp_analyze_architecture', // Find weaknesses
      'tp_hebbian_learning',     // Strengthen successful paths
      'tp_homeostasis_loop',     // Maintain stability while evolving
    ],

    optionalPrimitives: [
      {
        primitiveId: 'tp_novelty_search',
        includeWhen: ['stuck in local optimum', 'need exploration'],
        excludeWhen: ['current approach working well'],
        rationale: 'Explore new approaches when stuck',
      },
      {
        primitiveId: 'tp_evolution_tournament',
        includeWhen: ['multiple competing strategies'],
        excludeWhen: ['single strategy'],
        rationale: 'Select best strategy through competition',
      },
      {
        primitiveId: 'tp_diversity_enforcer',
        includeWhen: ['risk of monoculture', 'need robustness'],
        excludeWhen: ['diversity not needed'],
        rationale: 'Maintain strategic diversity',
      },
    ],

    operators: [
      {
        type: 'loop',
        purpose: 'Continuous improvement cycle',
        placement: 'wrapper',
        conditions: ['improvement possible', 'stability maintained'],
      },
    ],

    antiPatterns: [
      {
        description: 'Improving without stability checks',
        whyBad: 'May break working functionality',
        betterAlternative: 'Always maintain homeostasis while evolving',
      },
      {
        description: 'Greedy optimization',
        whyBad: 'Gets stuck in local optima',
        betterAlternative: 'Include novelty search for exploration',
      },
    ],

    examples: ['tc_self_audit_full', 'tc_continuous_improvement'],

    successSignals: [
      'Measurable improvement in target metric',
      'No regression in stability',
      'Learning persists to future tasks',
    ],

    failureSignals: [
      'Regression in other metrics',
      'Instability introduced',
      'No measurable improvement',
    ],
  },
];
```

#### A.3 Pattern Catalog API

```typescript
/**
 * Query the pattern catalog by situation
 */
async function findPatternsForSituation(
  intent: string,
  context?: {
    codebaseFeatures?: string[];
    recentOutcomes?: LearningOutcome[];
  }
): Promise<PatternMatch[]> {
  const intentEmbedding = await embed(intent);

  const matches: PatternMatch[] = [];

  for (const pattern of COMPOSITION_PATTERN_CATALOG) {
    // Semantic similarity to pattern situations
    const situationScores = await Promise.all(
      pattern.situations.map(async (situation) => {
        const exampleEmbeddings = await Promise.all(
          situation.examples.map(embed)
        );
        const avgSimilarity = exampleEmbeddings.reduce(
          (sum, emb) => sum + cosineSimilarity(intentEmbedding, emb),
          0
        ) / exampleEmbeddings.length;

        // Context matching bonus
        const contextBonus = situation.context.filter(
          c => intent.toLowerCase().includes(c.toLowerCase())
        ).length * 0.1;

        return avgSimilarity + contextBonus;
      })
    );

    const bestSituationScore = Math.max(...situationScores);

    // Boost score if historical outcomes support this pattern
    let historyBonus = 0;
    if (context?.recentOutcomes) {
      const successRate = computePatternSuccessRate(
        pattern.id,
        context.recentOutcomes
      );
      historyBonus = (successRate - 0.5) * 0.2;  // ±0.1 based on history
    }

    const finalScore = bestSituationScore + historyBonus;

    if (finalScore > 0.3) {
      matches.push({
        pattern,
        score: finalScore,
        matchedSituation: pattern.situations[situationScores.indexOf(bestSituationScore)],
        suggestedPrimitives: selectPrimitivesForContext(pattern, context),
      });
    }
  }

  return matches.sort((a, b) => b.score - a.score);
}

interface PatternMatch {
  pattern: CompositionPattern;
  score: number;
  matchedSituation: Situation;
  suggestedPrimitives: {
    core: string[];
    optional: Array<{ primitiveId: string; reason: string }>;
  };
}

/**
 * Select optional primitives based on codebase context
 */
function selectPrimitivesForContext(
  pattern: CompositionPattern,
  context?: { codebaseFeatures?: string[] }
): PatternMatch['suggestedPrimitives'] {
  const optional: Array<{ primitiveId: string; reason: string }> = [];

  for (const opt of pattern.optionalPrimitives) {
    const shouldInclude = opt.includeWhen.some(condition =>
      context?.codebaseFeatures?.some(feature =>
        feature.toLowerCase().includes(condition.toLowerCase())
      )
    );

    const shouldExclude = opt.excludeWhen.some(condition =>
      context?.codebaseFeatures?.some(feature =>
        feature.toLowerCase().includes(condition.toLowerCase())
      )
    );

    if (shouldInclude && !shouldExclude) {
      optional.push({
        primitiveId: opt.primitiveId,
        reason: opt.rationale,
      });
    }
  }

  return {
    core: pattern.corePrimitives,
    optional,
  };
}
```

---

### B. Semantic Composition Selection

**Problem**: Current selection uses keyword matching, missing semantically similar intents.

**Solution**: Replace keyword matching with embedding-based semantic similarity.

#### B.1 Semantic Selection Engine

```typescript
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SEMANTIC COMPOSITION SELECTION
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Replaces keyword matching with embedding-based semantic similarity
 */

interface SemanticCompositionIndex {
  compositions: Array<{
    compositionId: string;
    embedding: number[];
    keywords: string[];           // Fallback for when embeddings unavailable
    successRate: number;          // From learning loop
    lastUpdated: string;
  }>;

  patterns: Array<{
    patternId: string;
    embedding: number[];
  }>;

  version: string;
  createdAt: string;
}

class SemanticCompositionSelector {
  private index: SemanticCompositionIndex | null = null;
  private embeddingService: EmbeddingService;
  private learner: ClosedLoopLearner;
  private storage: LibrarianStorage;

  constructor(
    storage: LibrarianStorage,
    embeddingService: EmbeddingService,
    learner: ClosedLoopLearner
  ) {
    this.storage = storage;
    this.embeddingService = embeddingService;
    this.learner = learner;
  }

  /**
   * Build semantic index for all compositions
   */
  async buildIndex(): Promise<void> {
    const compositions = await listTechniqueCompositions(this.storage);

    const indexedCompositions = await Promise.all(
      compositions.map(async (composition) => {
        // Create rich description for embedding
        const description = [
          composition.name,
          composition.description,
          ...composition.primitiveIds,
        ].join(' ');

        const embedding = await this.embeddingService.embed(description);

        // Get historical success rate
        const outcomes = await this.learner.getRecommendations(composition.name);
        const suggestion = outcomes.suggestedCompositions.find(
          s => s.compositionId === composition.id
        );
        const successRate = suggestion?.successRate ?? 0.5;

        return {
          compositionId: composition.id,
          embedding,
          keywords: extractKeywords(composition),
          successRate,
          lastUpdated: composition.updatedAt,
        };
      })
    );

    const indexedPatterns = await Promise.all(
      COMPOSITION_PATTERN_CATALOG.map(async (pattern) => {
        const description = [
          pattern.name,
          pattern.archetype,
          ...pattern.situations.flatMap(s => s.examples),
        ].join(' ');

        return {
          patternId: pattern.id,
          embedding: await this.embeddingService.embed(description),
        };
      })
    );

    this.index = {
      compositions: indexedCompositions,
      patterns: indexedPatterns,
      version: '1.0.0',
      createdAt: new Date().toISOString(),
    };

    await this.persistIndex();
  }

  /**
   * Select compositions using semantic similarity
   */
  async selectCompositions(
    intent: string,
    options: {
      limit?: number;
      minSimilarity?: number;
      includeHistoricalBoost?: boolean;
    } = {}
  ): Promise<CompositionSelection[]> {
    const limit = options.limit ?? 5;
    const minSimilarity = options.minSimilarity ?? 0.3;
    const includeHistoricalBoost = options.includeHistoricalBoost ?? true;

    await this.ensureIndex();

    const intentEmbedding = await this.embeddingService.embed(intent);

    const scored = this.index!.compositions.map(indexed => {
      const semanticSimilarity = cosineSimilarity(intentEmbedding, indexed.embedding);

      // Historical boost: successful compositions get up to 20% boost
      const historyBoost = includeHistoricalBoost
        ? (indexed.successRate - 0.5) * 0.4  // Maps [0,1] to [-0.2, 0.2]
        : 0;

      // Recency boost: recently updated compositions get slight boost
      const recencyBoost = computeRecencyBoost(indexed.lastUpdated);

      const finalScore = semanticSimilarity + historyBoost + recencyBoost;

      return {
        compositionId: indexed.compositionId,
        score: finalScore,
        semanticSimilarity,
        successRate: indexed.successRate,
      };
    });

    return scored
      .filter(s => s.semanticSimilarity >= minSimilarity)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /**
   * Find the best pattern for an intent
   */
  async matchPattern(intent: string): Promise<PatternMatch | null> {
    await this.ensureIndex();

    const intentEmbedding = await this.embeddingService.embed(intent);

    let bestMatch: { patternId: string; similarity: number } | null = null;

    for (const indexed of this.index!.patterns) {
      const similarity = cosineSimilarity(intentEmbedding, indexed.embedding);
      if (!bestMatch || similarity > bestMatch.similarity) {
        bestMatch = { patternId: indexed.patternId, similarity };
      }
    }

    if (!bestMatch || bestMatch.similarity < 0.4) {
      return null;
    }

    const pattern = COMPOSITION_PATTERN_CATALOG.find(
      p => p.id === bestMatch!.patternId
    );

    return pattern ? {
      pattern,
      score: bestMatch.similarity,
      matchedSituation: pattern.situations[0],  // Best guess
      suggestedPrimitives: {
        core: pattern.corePrimitives,
        optional: [],
      },
    } : null;
  }

  private async ensureIndex(): Promise<void> {
    if (!this.index) {
      this.index = await this.loadIndex();
      if (!this.index) {
        await this.buildIndex();
      }
    }
  }

  private async loadIndex(): Promise<SemanticCompositionIndex | null> {
    const raw = await this.storage.getState('LiBrainian.semantic_composition_index.v1');
    if (!raw) return null;
    const parsed = safeJsonParse<SemanticCompositionIndex>(raw);
    return parsed.ok ? parsed.value : null;
  }

  private async persistIndex(): Promise<void> {
    if (this.index) {
      await this.storage.setState(
        'LiBrainian.semantic_composition_index.v1',
        JSON.stringify(this.index)
      );
    }
  }
}

interface CompositionSelection {
  compositionId: string;
  score: number;
  semanticSimilarity: number;
  successRate: number;
}

function computeRecencyBoost(updatedAt: string): number {
  const ageMs = Date.now() - Date.parse(updatedAt);
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  // Boost of 0.05 for very recent, decaying to 0 after 30 days
  return Math.max(0, 0.05 * (1 - ageDays / 30));
}

function extractKeywords(composition: TechniqueComposition): string[] {
  const text = `${composition.name} ${composition.description}`.toLowerCase();
  return text
    .split(/[^a-z0-9]+/)
    .filter(word => word.length >= 3)
    .filter((word, i, arr) => arr.indexOf(word) === i);
}
```

---

### C. Codebase-Aware Composition Suggestion

**Problem**: LiBrainian doesn't suggest compositions based on what's in the codebase.

**Solution**: Analyze the codebase and recommend compositions that would be useful.

#### C.1 Codebase Analyzer for Composition Suggestions

```typescript
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CODEBASE-AWARE COMPOSITION SUGGESTION
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Analyzes a codebase and suggests relevant compositions to build
 */

interface CodebaseFeature {
  id: string;
  name: string;
  description: string;
  confidence: number;
  evidence: string[];          // File paths, code snippets
  suggestedPatterns: string[]; // Pattern IDs
}

interface CompositionSuggestion {
  suggestedCompositionId: string;
  suggestedName: string;
  reason: string;
  basedOnFeatures: string[];
  suggestedPrimitives: string[];
  suggestedOperators: OperatorRecommendation[];
  priority: 'high' | 'medium' | 'low';
  estimatedValue: string;
}

class CodebaseCompositionAdvisor {
  private LiBrainian: LiBrainian;

  constructor(LiBrainian: LiBrainian) {
    this.LiBrainian = LiBrainian;
  }

  /**
   * Analyze codebase and suggest useful compositions
   */
  async suggestCompositions(): Promise<CompositionSuggestion[]> {
    // Step 1: Discover codebase features
    const features = await this.discoverFeatures();

    // Step 2: Map features to composition suggestions
    const suggestions: CompositionSuggestion[] = [];

    for (const feature of features) {
      const featureSuggestions = this.suggestForFeature(feature);
      suggestions.push(...featureSuggestions);
    }

    // Step 3: Deduplicate and prioritize
    return this.prioritizeSuggestions(suggestions);
  }

  /**
   * Discover relevant features of the codebase
   */
  private async discoverFeatures(): Promise<CodebaseFeature[]> {
    const features: CodebaseFeature[] = [];

    // Query LiBrainian for various domains
    const queries = [
      { intent: 'authentication and authorization code', domain: 'auth' },
      { intent: 'API endpoints and routes', domain: 'api' },
      { intent: 'database models and queries', domain: 'database' },
      { intent: 'user interface components', domain: 'ui' },
      { intent: 'test files and test utilities', domain: 'testing' },
      { intent: 'configuration and environment handling', domain: 'config' },
      { intent: 'error handling and logging', domain: 'observability' },
      { intent: 'external service integrations', domain: 'integrations' },
      { intent: 'caching and performance optimization', domain: 'performance' },
      { intent: 'background jobs and async processing', domain: 'async' },
    ];

    for (const query of queries) {
      const response = await this.LiBrainian.query({
        intent: query.intent,
        depth: 'L1',
        minConfidence: 0.5,
      });

      if (response.packs.length > 0) {
        const avgConfidence = response.packs.reduce(
          (sum, p) => sum + p.confidence, 0
        ) / response.packs.length;

        features.push({
          id: `feature_${query.domain}`,
          name: query.domain,
          description: response.synthesis?.answer ?? query.intent,
          confidence: avgConfidence,
          evidence: response.packs.slice(0, 3).map(p => p.targetId),
          suggestedPatterns: this.mapDomainToPatterns(query.domain),
        });
      }
    }

    return features.filter(f => f.confidence > 0.4);
  }

  /**
   * Map domain to relevant patterns
   */
  private mapDomainToPatterns(domain: string): string[] {
    const mapping: Record<string, string[]> = {
      'auth': ['pattern_security_audit', 'pattern_change_verification'],
      'api': ['pattern_api_design', 'pattern_change_verification', 'pattern_release_verification'],
      'database': ['pattern_refactoring', 'pattern_performance_investigation', 'pattern_dependency_update'],
      'ui': ['pattern_change_verification', 'pattern_test_generation'],
      'testing': ['pattern_test_generation', 'pattern_bug_investigation', 'pattern_change_verification'],
      'config': ['pattern_dependency_update', 'pattern_security_audit', 'pattern_change_verification'],
      'observability': ['pattern_incident_response', 'pattern_performance_investigation', 'pattern_bug_investigation'],
      'integrations': ['pattern_dependency_update', 'pattern_change_verification', 'pattern_release_verification'],
      'performance': ['pattern_performance_investigation', 'pattern_technical_debt'],
      'async': ['pattern_bug_investigation', 'pattern_performance_investigation', 'pattern_incident_response'],
    };

    return mapping[domain] ?? ['pattern_change_verification'];
  }

  /**
   * Generate composition suggestions for a feature
   */
  private suggestForFeature(feature: CodebaseFeature): CompositionSuggestion[] {
    const suggestions: CompositionSuggestion[] = [];

    // Auth feature → Security-focused review composition
    if (feature.id === 'feature_auth') {
      suggestions.push({
        suggestedCompositionId: 'tc_auth_security_review',
        suggestedName: 'Auth Security Review',
        reason: `Codebase has authentication (${feature.evidence.length} relevant files). ` +
                `A security-focused review composition would help validate auth changes.`,
        basedOnFeatures: [feature.id],
        suggestedPrimitives: [
          'tp_threat_model',
          'tp_security_abuse_cases',
          'tp_secret_scan',
          'tp_change_impact',
          'tp_verify_plan',
        ],
        suggestedOperators: [
          { type: 'parallel', purpose: 'Run security checks concurrently', placement: 'middle' },
          { type: 'gate', purpose: 'Block on security issues', placement: 'late' },
        ],
        priority: 'high',
        estimatedValue: 'Prevents security vulnerabilities in auth changes',
      });
    }

    // API feature → Breaking change detection
    if (feature.id === 'feature_api') {
      suggestions.push({
        suggestedCompositionId: 'tc_api_change_review',
        suggestedName: 'API Change Review',
        reason: `Codebase has API endpoints. A composition to detect breaking changes ` +
                `would help maintain API compatibility.`,
        basedOnFeatures: [feature.id],
        suggestedPrimitives: [
          'tp_change_impact',
          'tp_dependency_map',
          'tp_test_gap_analysis',
          'tp_verify_plan',
        ],
        suggestedOperators: [
          { type: 'gate', purpose: 'Block on breaking changes without version bump', placement: 'late' },
        ],
        priority: 'high',
        estimatedValue: 'Prevents accidental breaking changes to API consumers',
      });
    }

    // Database feature → Migration safety
    if (feature.id === 'feature_database') {
      suggestions.push({
        suggestedCompositionId: 'tc_migration_review',
        suggestedName: 'Database Migration Review',
        reason: `Codebase has database models. A migration review composition would help ` +
                `validate schema changes are safe and reversible.`,
        basedOnFeatures: [feature.id],
        suggestedPrimitives: [
          'tp_change_impact',
          'tp_risk_scan',
          'tp_verify_plan',
        ],
        suggestedOperators: [
          { type: 'gate', purpose: 'Block on destructive migrations without backup plan', placement: 'late' },
        ],
        priority: 'medium',
        estimatedValue: 'Prevents data loss from unsafe migrations',
      });
    }

    // UI feature → Accessibility
    if (feature.id === 'feature_ui') {
      suggestions.push({
        suggestedCompositionId: 'tc_ui_accessibility_review',
        suggestedName: 'UI Accessibility Review',
        reason: `Codebase has UI components. An accessibility review composition would help ` +
                `ensure UI changes meet WCAG guidelines.`,
        basedOnFeatures: [feature.id],
        suggestedPrimitives: [
          'tp_accessibility_review',
          'tp_change_impact',
          'tp_test_gap_analysis',
          'tp_verify_plan',
        ],
        suggestedOperators: [],
        priority: 'medium',
        estimatedValue: 'Ensures UI is accessible to all users',
      });
    }

    // Async/performance feature → Performance regression detection
    if (feature.id === 'feature_async' || feature.id === 'feature_performance') {
      suggestions.push({
        suggestedCompositionId: 'tc_performance_regression',
        suggestedName: 'Performance Regression Check',
        reason: `Codebase has async/performance-sensitive code. A regression detection ` +
                `composition would help catch performance issues early.`,
        basedOnFeatures: [feature.id],
        suggestedPrimitives: [
          'tp_instrument',
          'tp_change_impact',
          'tp_verify_plan',
        ],
        suggestedOperators: [
          { type: 'loop', purpose: 'Profile before and after', placement: 'wrapper' },
        ],
        priority: 'medium',
        estimatedValue: 'Catches performance regressions before production',
      });
    }

    return suggestions;
  }

  /**
   * Prioritize and deduplicate suggestions
   */
  private prioritizeSuggestions(
    suggestions: CompositionSuggestion[]
  ): CompositionSuggestion[] {
    // Deduplicate by ID
    const byId = new Map<string, CompositionSuggestion>();
    for (const suggestion of suggestions) {
      const existing = byId.get(suggestion.suggestedCompositionId);
      if (!existing || this.comparePriority(suggestion.priority, existing.priority) > 0) {
        byId.set(suggestion.suggestedCompositionId, suggestion);
      }
    }

    // Sort by priority
    return Array.from(byId.values()).sort((a, b) =>
      this.comparePriority(b.priority, a.priority)
    );
  }

  private comparePriority(a: string, b: string): number {
    const order = { high: 3, medium: 2, low: 1 };
    return (order[a as keyof typeof order] ?? 0) - (order[b as keyof typeof order] ?? 0);
  }
}
```

---

### D. Composition Evolution from Learning

**Problem**: The learning loop tracks outcomes but doesn't evolve compositions.

**Solution**: Mine successful patterns from execution history and propose new compositions.

#### D.1 Composition Evolution Engine

```typescript
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * COMPOSITION EVOLUTION ENGINE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Evolves compositions based on learning outcomes:
 * - Discovers successful primitive sequences
 * - Proposes new compositions from patterns
 * - Mutates existing compositions to improve success rate
 * - Prunes ineffective compositions
 */

interface ExecutionTrace {
  executionId: string;
  compositionId?: string;
  primitiveSequence: string[];
  operatorsUsed: string[];
  intent: string;
  outcome: 'success' | 'partial' | 'failure';
  duration: number;
  timestamp: string;
}

interface DiscoveredPattern {
  primitiveSequence: string[];
  frequency: number;
  successRate: number;
  avgDuration: number;
  commonIntents: string[];
  firstSeen: string;
  lastSeen: string;
}

interface CompositionProposal {
  id: string;
  name: string;
  description: string;
  primitiveIds: string[];
  operators: TechniqueOperator[];
  basedOn: 'discovered_pattern' | 'mutation' | 'merge';
  evidence: {
    patternFrequency?: number;
    patternSuccessRate?: number;
    parentCompositions?: string[];
  };
  confidence: number;
}

interface CompositionMutation {
  compositionId: string;
  mutationType: 'add_primitive' | 'remove_primitive' | 'reorder' | 'add_operator';
  description: string;
  expectedImprovement: string;
  evidence: string;
}

class CompositionEvolutionEngine {
  private storage: LibrarianStorage;
  private learner: ClosedLoopLearner;
  private minPatternFrequency = 5;
  private minSuccessRate = 0.7;

  constructor(storage: LibrarianStorage, learner: ClosedLoopLearner) {
    this.storage = storage;
    this.learner = learner;
  }

  /**
   * Run evolution cycle: discover patterns, propose compositions, prune failures
   */
  async evolve(): Promise<EvolutionReport> {
    const traces = await this.loadExecutionTraces();

    // Step 1: Mine frequent successful sequences
    const patterns = this.minePatterns(traces);

    // Step 2: Propose new compositions from patterns
    const proposals = await this.proposeFromPatterns(patterns);

    // Step 3: Suggest mutations for underperforming compositions
    const mutations = await this.suggestMutations(traces);

    // Step 4: Identify compositions to deprecate
    const deprecations = await this.identifyDeprecations(traces);

    return {
      discoveredPatterns: patterns,
      proposedCompositions: proposals,
      suggestedMutations: mutations,
      deprecationCandidates: deprecations,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Mine frequent patterns from execution traces
   */
  private minePatterns(traces: ExecutionTrace[]): DiscoveredPattern[] {
    // Extract all subsequences of length 2-6
    const subsequenceCounts = new Map<string, {
      count: number;
      successes: number;
      durations: number[];
      intents: string[];
      firstSeen: string;
      lastSeen: string;
    }>();

    for (const trace of traces) {
      const sequence = trace.primitiveSequence;

      for (let len = 2; len <= Math.min(6, sequence.length); len++) {
        for (let start = 0; start <= sequence.length - len; start++) {
          const subseq = sequence.slice(start, start + len);
          const key = subseq.join('→');

          const existing = subsequenceCounts.get(key) ?? {
            count: 0,
            successes: 0,
            durations: [],
            intents: [],
            firstSeen: trace.timestamp,
            lastSeen: trace.timestamp,
          };

          existing.count++;
          if (trace.outcome === 'success') existing.successes++;
          existing.durations.push(trace.duration);
          if (!existing.intents.includes(trace.intent)) {
            existing.intents.push(trace.intent);
          }
          if (trace.timestamp < existing.firstSeen) {
            existing.firstSeen = trace.timestamp;
          }
          if (trace.timestamp > existing.lastSeen) {
            existing.lastSeen = trace.timestamp;
          }

          subsequenceCounts.set(key, existing);
        }
      }
    }

    // Filter to frequent, successful patterns
    const patterns: DiscoveredPattern[] = [];

    for (const [key, data] of subsequenceCounts) {
      if (data.count < this.minPatternFrequency) continue;

      const successRate = data.successes / data.count;
      if (successRate < this.minSuccessRate) continue;

      patterns.push({
        primitiveSequence: key.split('→'),
        frequency: data.count,
        successRate,
        avgDuration: data.durations.reduce((a, b) => a + b, 0) / data.durations.length,
        commonIntents: data.intents.slice(0, 5),
        firstSeen: data.firstSeen,
        lastSeen: data.lastSeen,
      });
    }

    // Sort by frequency * success rate (impact score)
    return patterns.sort((a, b) =>
      (b.frequency * b.successRate) - (a.frequency * a.successRate)
    );
  }

  /**
   * Propose new compositions from discovered patterns
   */
  private async proposeFromPatterns(
    patterns: DiscoveredPattern[]
  ): Promise<CompositionProposal[]> {
    const existingCompositions = await listTechniqueCompositions(this.storage);
    const existingSequences = new Set(
      existingCompositions.map(c => c.primitiveIds.join('→'))
    );

    const proposals: CompositionProposal[] = [];

    for (const pattern of patterns.slice(0, 10)) {
      const sequenceKey = pattern.primitiveSequence.join('→');

      // Skip if already exists as a composition
      if (existingSequences.has(sequenceKey)) continue;

      // Generate name from common intents
      const name = this.generateCompositionName(pattern);

      proposals.push({
        id: `tc_evolved_${hashSequence(pattern.primitiveSequence)}`,
        name,
        description: `Discovered pattern with ${pattern.successRate.toFixed(0)}% success rate ` +
                     `across ${pattern.frequency} executions. Common uses: ${pattern.commonIntents.slice(0, 3).join(', ')}`,
        primitiveIds: pattern.primitiveSequence,
        operators: this.inferOperators(pattern),
        basedOn: 'discovered_pattern',
        evidence: {
          patternFrequency: pattern.frequency,
          patternSuccessRate: pattern.successRate,
        },
        confidence: pattern.successRate * Math.min(1, pattern.frequency / 20),
      });
    }

    return proposals;
  }

  /**
   * Suggest mutations for underperforming compositions
   */
  private async suggestMutations(
    traces: ExecutionTrace[]
  ): Promise<CompositionMutation[]> {
    const mutations: CompositionMutation[] = [];

    // Group traces by composition
    const byComposition = new Map<string, ExecutionTrace[]>();
    for (const trace of traces) {
      if (!trace.compositionId) continue;
      const existing = byComposition.get(trace.compositionId) ?? [];
      existing.push(trace);
      byComposition.set(trace.compositionId, existing);
    }

    for (const [compositionId, compositionTraces] of byComposition) {
      const successRate = compositionTraces.filter(t => t.outcome === 'success').length /
                          compositionTraces.length;

      // Only mutate compositions with enough data and poor performance
      if (compositionTraces.length < 10 || successRate > 0.8) continue;

      // Analyze failure patterns
      const failureTraces = compositionTraces.filter(t => t.outcome === 'failure');

      // Find primitives that often precede failures
      const failurePredecessors = this.findFailurePredecessors(failureTraces);

      for (const [primitiveId, failureRate] of failurePredecessors) {
        if (failureRate > 0.6) {
          mutations.push({
            compositionId,
            mutationType: 'add_primitive',
            description: `Add verification after ${primitiveId}`,
            expectedImprovement: `Reduce failures caused by ${primitiveId}`,
            evidence: `${primitiveId} precedes ${(failureRate * 100).toFixed(0)}% of failures`,
          });
        }
      }
    }

    return mutations;
  }

  /**
   * Identify compositions that should be deprecated
   */
  private async identifyDeprecations(
    traces: ExecutionTrace[]
  ): Promise<string[]> {
    const byComposition = new Map<string, { successes: number; failures: number; lastUsed: string }>();

    for (const trace of traces) {
      if (!trace.compositionId) continue;
      const existing = byComposition.get(trace.compositionId) ?? {
        successes: 0, failures: 0, lastUsed: trace.timestamp
      };
      if (trace.outcome === 'success') existing.successes++;
      else existing.failures++;
      if (trace.timestamp > existing.lastUsed) existing.lastUsed = trace.timestamp;
      byComposition.set(trace.compositionId, existing);
    }

    const deprecations: string[] = [];
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    for (const [compositionId, data] of byComposition) {
      const total = data.successes + data.failures;
      const successRate = data.successes / total;

      // Deprecate if: low success rate AND not recently used AND enough samples
      if (successRate < 0.3 && data.lastUsed < thirtyDaysAgo && total > 20) {
        deprecations.push(compositionId);
      }
    }

    return deprecations;
  }

  /**
   * Generate a name for a discovered pattern
   */
  private generateCompositionName(pattern: DiscoveredPattern): string {
    const intents = pattern.commonIntents;
    if (intents.length === 0) {
      return `Evolved: ${pattern.primitiveSequence[0]} flow`;
    }

    // Extract common words from intents
    const words = intents.flatMap(i => i.toLowerCase().split(/\s+/));
    const wordCounts = new Map<string, number>();
    for (const word of words) {
      if (word.length < 3) continue;
      wordCounts.set(word, (wordCounts.get(word) ?? 0) + 1);
    }

    const topWords = Array.from(wordCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([word]) => word);

    return `Evolved: ${topWords.join(' ')} pattern`;
  }

  /**
   * Infer operators from pattern structure
   */
  private inferOperators(pattern: DiscoveredPattern): TechniqueOperator[] {
    const operators: TechniqueOperator[] = [];

    // If pattern starts with hypothesis-type primitives, add loop
    if (pattern.primitiveSequence.includes('tp_hypothesis') &&
        pattern.primitiveSequence.includes('tp_verify_plan')) {
      operators.push({
        id: 'op_evolved_loop',
        type: 'loop',
        label: 'Iterate until verified',
        inputs: pattern.primitiveSequence.slice(0, -1),
        conditions: ['verification failed'],
      });
    }

    return operators;
  }

  /**
   * Find primitives that often precede failures
   */
  private findFailurePredecessors(
    failureTraces: ExecutionTrace[]
  ): Map<string, number> {
    const predecessorCounts = new Map<string, number>();
    const totalFailures = failureTraces.length;

    for (const trace of failureTraces) {
      // Look at the last few primitives before failure
      const lastPrimitives = trace.primitiveSequence.slice(-3);
      for (const primitiveId of lastPrimitives) {
        predecessorCounts.set(primitiveId, (predecessorCounts.get(primitiveId) ?? 0) + 1);
      }
    }

    // Convert to failure rate
    const failureRates = new Map<string, number>();
    for (const [primitiveId, count] of predecessorCounts) {
      failureRates.set(primitiveId, count / totalFailures);
    }

    return failureRates;
  }

  private async loadExecutionTraces(): Promise<ExecutionTrace[]> {
    const raw = await this.storage.getState('LiBrainian.execution_traces.v1');
    if (!raw) return [];
    const parsed = safeJsonParse<{ traces: ExecutionTrace[] }>(raw);
    return parsed.ok ? parsed.value.traces : [];
  }
}

interface EvolutionReport {
  discoveredPatterns: DiscoveredPattern[];
  proposedCompositions: CompositionProposal[];
  suggestedMutations: CompositionMutation[];
  deprecationCandidates: string[];
  timestamp: string;
}

function hashSequence(sequence: string[]): string {
  const str = sequence.join('|');
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36).slice(0, 8);
}
```

---

### E. Creative Agent Usage Patterns

**Beyond the obvious**: Here are thought-provoking ways agents can use these systems.

#### E.1 The Composition Sommelier

An agent that "pairs" compositions with tasks like a sommelier pairs wine with food:

```typescript
/**
 * The Composition Sommelier
 *
 * "For this auth refactor, I recommend the tc_security_review with a side of
 * tp_threat_model. The 2024 vintage has excellent notes of OWASP compliance
 * with a finish of penetration testing."
 */
class CompositionSommelier {
  async recommend(task: string, context: CodebaseContext): Promise<Pairing> {
    // Analyze the "terroir" (codebase characteristics)
    const terroir = await this.analyzeTerroir(context);

    // Consider the "meal" (task complexity and risk)
    const mealProfile = await this.profileTask(task);

    // Select compositions that complement the meal
    const pairings = await this.findPairings(terroir, mealProfile);

    // Generate tasting notes (rationale)
    return {
      primary: pairings[0],
      alternatives: pairings.slice(1),
      tastingNotes: this.generateTastingNotes(pairings[0], terroir, mealProfile),
      warningsFromCellar: await this.checkCellar(pairings[0].id),
    };
  }

  private generateTastingNotes(
    pairing: TechniqueComposition,
    terroir: Terroir,
    meal: MealProfile
  ): string {
    return `For this ${meal.complexity} ${meal.type}, I recommend ${pairing.name}. ` +
           `Given your codebase's ${terroir.characteristics.join(', ')}, ` +
           `this composition's ${pairing.primitiveIds.slice(0, 3).join(' → ')} flow ` +
           `will provide ${this.describeValue(pairing, meal)}.`;
  }
}
```

#### E.2 The Composition Geneticist

An agent that breeds compositions through genetic algorithms:

```typescript
/**
 * The Composition Geneticist
 *
 * Breeds new compositions by crossing successful parents, introducing
 * mutations, and selecting for fitness.
 */
class CompositionGeneticist {
  private populationSize = 20;
  private mutationRate = 0.1;
  private crossoverRate = 0.7;

  /**
   * Run a generation of evolution
   */
  async evolveGeneration(
    population: TechniqueComposition[],
    fitnessFunction: (c: TechniqueComposition) => Promise<number>
  ): Promise<TechniqueComposition[]> {
    // Evaluate fitness
    const scored = await Promise.all(
      population.map(async (composition) => ({
        composition,
        fitness: await fitnessFunction(composition),
      }))
    );

    // Selection (tournament)
    const selected = this.tournamentSelection(scored);

    // Crossover
    const offspring: TechniqueComposition[] = [];
    for (let i = 0; i < selected.length - 1; i += 2) {
      if (Math.random() < this.crossoverRate) {
        const [child1, child2] = this.crossover(selected[i], selected[i + 1]);
        offspring.push(child1, child2);
      } else {
        offspring.push(selected[i], selected[i + 1]);
      }
    }

    // Mutation
    for (const composition of offspring) {
      if (Math.random() < this.mutationRate) {
        this.mutate(composition);
      }
    }

    return offspring;
  }

  /**
   * Crossover: Swap primitive subsequences between parents
   */
  private crossover(
    parent1: TechniqueComposition,
    parent2: TechniqueComposition
  ): [TechniqueComposition, TechniqueComposition] {
    const crossPoint = Math.floor(Math.random() *
      Math.min(parent1.primitiveIds.length, parent2.primitiveIds.length));

    const child1Primitives = [
      ...parent1.primitiveIds.slice(0, crossPoint),
      ...parent2.primitiveIds.slice(crossPoint),
    ];
    const child2Primitives = [
      ...parent2.primitiveIds.slice(0, crossPoint),
      ...parent1.primitiveIds.slice(crossPoint),
    ];

    return [
      { ...parent1, id: `${parent1.id}_x1`, primitiveIds: child1Primitives },
      { ...parent2, id: `${parent2.id}_x2`, primitiveIds: child2Primitives },
    ];
  }

  /**
   * Mutation: Add, remove, or swap a primitive
   */
  private mutate(composition: TechniqueComposition): void {
    const mutationType = Math.random();

    if (mutationType < 0.33 && composition.primitiveIds.length > 2) {
      // Remove random primitive
      const idx = Math.floor(Math.random() * composition.primitiveIds.length);
      composition.primitiveIds.splice(idx, 1);
    } else if (mutationType < 0.66) {
      // Add random primitive from the pool
      const newPrimitive = this.randomPrimitive();
      const idx = Math.floor(Math.random() * (composition.primitiveIds.length + 1));
      composition.primitiveIds.splice(idx, 0, newPrimitive);
    } else {
      // Swap two primitives
      const idx1 = Math.floor(Math.random() * composition.primitiveIds.length);
      const idx2 = Math.floor(Math.random() * composition.primitiveIds.length);
      [composition.primitiveIds[idx1], composition.primitiveIds[idx2]] =
        [composition.primitiveIds[idx2], composition.primitiveIds[idx1]];
    }
  }
}
```

#### E.3 The Composition Archaeologist

An agent that studies "dead" compositions to learn what killed them:

```typescript
/**
 * The Composition Archaeologist
 *
 * Excavates deprecated/failed compositions to understand why they died,
 * extracting lessons for living compositions.
 */
class CompositionArchaeologist {
  /**
   * Excavate a deprecated composition
   */
  async excavate(compositionId: string): Promise<ArchaeologicalReport> {
    const traces = await this.getHistoricalTraces(compositionId);
    const composition = await this.getComposition(compositionId);

    // Carbon dating: When did it start failing?
    const failureOnset = this.findFailureOnset(traces);

    // Fossil analysis: What patterns preceded failures?
    const fossils = this.analyzeFossils(traces);

    // Cause of extinction
    const causeOfDeath = this.determineCauseOfDeath(traces, fossils);

    // Lessons for the living
    const lessons = this.extractLessons(composition, causeOfDeath);

    return {
      compositionId,
      lifespan: {
        born: traces[0]?.timestamp,
        died: traces[traces.length - 1]?.timestamp,
        peakPerformance: this.findPeakPerformance(traces),
      },
      causeOfDeath,
      fossils,
      lessons,
      epitaph: this.writeEpitaph(composition, causeOfDeath),
    };
  }

  private writeEpitaph(
    composition: TechniqueComposition,
    causeOfDeath: CauseOfDeath
  ): string {
    return `Here lies ${composition.name}.\n` +
           `Born of good intentions, it served ${causeOfDeath.successfulExecutions} tasks well.\n` +
           `Alas, ${causeOfDeath.primaryCause} proved its undoing.\n` +
           `May its lessons live on in ${causeOfDeath.successorSuggestion ?? 'future compositions'}.`;
  }
}

interface CauseOfDeath {
  primaryCause: 'obsolescence' | 'brittleness' | 'complexity' | 'competition' | 'environment_change';
  evidence: string[];
  successfulExecutions: number;
  failedExecutions: number;
  successorSuggestion?: string;
}
```

#### E.4 The Composition Diplomat

An agent that negotiates between competing compositions:

```typescript
/**
 * The Composition Diplomat
 *
 * When multiple compositions claim to be best for a task, the diplomat
 * facilitates negotiation to find consensus or propose a coalition.
 */
class CompositionDiplomat {
  /**
   * Negotiate between competing compositions
   */
  async negotiate(
    task: string,
    candidates: TechniqueComposition[]
  ): Promise<NegotiationOutcome> {
    // Each composition makes its case
    const cases = await Promise.all(
      candidates.map(c => this.makeCase(c, task))
    );

    // Look for complementary strengths
    const synergies = this.findSynergies(cases);

    if (synergies.length > 0) {
      // Propose coalition government
      return {
        type: 'coalition',
        members: synergies[0].compositions,
        rationale: `These compositions complement each other: ${synergies[0].rationale}`,
        mergedComposition: this.formCoalition(synergies[0].compositions),
      };
    }

    // Check for clear winner
    const winner = this.determineWinner(cases);
    if (winner.margin > 0.2) {
      return {
        type: 'clear_winner',
        winner: winner.composition,
        rationale: winner.rationale,
      };
    }

    // Propose A/B test
    return {
      type: 'ab_test',
      contenders: candidates.slice(0, 2),
      rationale: 'No clear winner; recommend A/B testing to gather evidence',
      testPlan: this.designABTest(candidates.slice(0, 2), task),
    };
  }

  /**
   * Form a coalition composition from multiple parents
   */
  private formCoalition(compositions: TechniqueComposition[]): TechniqueComposition {
    // Merge primitives, removing duplicates
    const allPrimitives = compositions.flatMap(c => c.primitiveIds);
    const uniquePrimitives = [...new Set(allPrimitives)];

    // Order by first appearance
    const ordered = uniquePrimitives.sort((a, b) =>
      allPrimitives.indexOf(a) - allPrimitives.indexOf(b)
    );

    return {
      id: `tc_coalition_${compositions.map(c => c.id).join('_')}`,
      name: `Coalition: ${compositions.map(c => c.name).join(' + ')}`,
      description: `Merged composition combining strengths of ${compositions.length} parents`,
      primitiveIds: ordered,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }
}
```

#### E.5 The Composition Prophet

An agent that predicts what compositions will be needed before they're requested:

```typescript
/**
 * The Composition Prophet
 *
 * Analyzes codebase trajectory, team patterns, and external signals
 * to predict what compositions will be needed in the future.
 */
class CompositionProphet {
  /**
   * Divine the future composition needs
   */
  async prophesize(context: ProjectContext): Promise<Prophecy[]> {
    const prophecies: Prophecy[] = [];

    // Read the tea leaves (git history patterns)
    const historyPatterns = await this.analyzeGitHistory(context);

    // Consult the stars (roadmap/issues)
    const upcomingWork = await this.parseUpcomingWork(context);

    // Study the omens (dependency updates, security advisories)
    const omens = await this.gatherOmens(context);

    // Issue prophecies
    if (historyPatterns.authChangesAccelerating) {
      prophecies.push({
        prediction: 'Auth system overhaul incoming',
        confidence: 0.8,
        timing: 'within 2 sprints',
        preparedComposition: 'tc_auth_security_review',
        rationale: 'Auth file changes increased 300% over last month',
      });
    }

    if (omens.majorDependencyUpdate) {
      prophecies.push({
        prediction: 'Major framework upgrade',
        confidence: 0.9,
        timing: 'imminent',
        preparedComposition: 'tc_dependency_upgrade_safety',
        rationale: `${omens.majorDependencyUpdate.name} has breaking changes`,
      });
    }

    if (upcomingWork.newIntegration) {
      prophecies.push({
        prediction: 'New external integration',
        confidence: 0.85,
        timing: 'next sprint',
        preparedComposition: 'tc_integration_verification',
        rationale: `Issue #${upcomingWork.newIntegration.issueNumber} describes new API integration`,
      });
    }

    return prophecies;
  }
}

interface Prophecy {
  prediction: string;
  confidence: number;
  timing: string;
  preparedComposition: string;
  rationale: string;
}
```

---

### F. Implementation Roadmap for Codex

**Priority order for implementation:**

#### F.1 Phase 1: Pattern Catalog (Foundation)
1. Implement `CompositionPattern` interface and catalog schema
2. Create initial catalog with 8-10 core patterns
3. Add `findPatternsForSituation()` API
4. Add pattern embeddings for semantic matching

**Files to create:**
- `src/LiBrainian/api/composition_patterns.ts`
- `src/LiBrainian/strategic/pattern_catalog.ts`

**Estimated primitives/LOC:** ~400 lines

#### F.2 Phase 2: Semantic Selection (Replace Keywords)
1. Implement `SemanticCompositionSelector` class
2. Replace `selectTechniqueCompositions()` to use semantic matching
3. Add index persistence and refresh
4. Integrate with existing learning loop

**Files to modify:**
- `src/LiBrainian/api/plan_compiler.ts` (modify selection)
- `src/LiBrainian/api/semantic_selection.ts` (new)

**Estimated LOC:** ~300 lines

#### F.3 Phase 3: Codebase-Aware Suggestion
1. Implement `CodebaseCompositionAdvisor` class
2. Add feature discovery queries
3. Create suggestion mapping rules
4. Add CLI/API for getting suggestions

**Files to create:**
- `src/LiBrainian/api/composition_advisor.ts`

**Estimated LOC:** ~350 lines

#### F.4 Phase 4: Evolution Engine
1. Implement `CompositionEvolutionEngine` class
2. Add execution trace recording
3. Create pattern mining algorithm
4. Add proposal generation and mutation suggestion

**Files to create:**
- `packages/LiBrainian/src/api/composition_evolution.ts`
- `src/LiBrainian/state/execution_traces.ts`

**Estimated LOC:** ~500 lines

#### F.5 Phase 5: Creative Agents (Optional/Experimental)
1. Implement one "creative" agent as proof of concept (suggest: Geneticist)
2. Add as experimental feature behind flag
3. Document for community extension

**Files to create:**
- `src/LiBrainian/experimental/composition_geneticist.ts`

**Estimated LOC:** ~200 lines

---

### G. Success Metrics

After implementation, measure:

| Metric | Target | How to Measure |
|--------|--------|----------------|
| Composition selection accuracy | >80% | User accepts suggested composition |
| Time to find right composition | <30s | From intent to selection |
| New composition adoption | >50% | Evolved compositions get used |
| Pattern coverage | >90% | User intents match a pattern |
| Learning loop improvement | +20% | Success rate after 30 days |

---

## Document History

| Date | Version | Changes |
|------|---------|---------|
| 2026-01-19 | 1.0.0 | Initial theoretical critique |
| 2026-01-19 | 2.0.0 | Added API review, utility analysis, usability solutions |
| 2026-01-19 | 3.0.0 | Added comprehensive subsystem review |
| 2026-01-19 | 4.0.0 | Added GitHub greatness strategy (Part XI) |
| 2026-01-20 | 5.0.0 | Added theoretical critiques (Part XII) |
| 2026-01-20 | 6.0.0 | Expanded Part XII with elegant solutions for all 15 theoretical gaps including: Gettier-immune knowledge system, social epistemology with deliberation, epistemic justice framework, ASPIC+ argumentation, information-theoretic bounds with MINE/rate-distortion, PAC approximation guarantees, calibration sample complexity with SPRT, verification complexity hierarchy |
| 2026-01-20 | 6.1.0 | Added Part XIII: Comprehensive self-improvement guide for using LiBrainian on LiBrainian |
| 2026-01-20 | 7.0.0 | Added Part XIV: Composition Discovery, Guidance, and Evolution - Pattern Catalog with 8 archetypes, Semantic Selection Engine, Codebase-Aware Suggestion, Evolution Engine with pattern mining/mutation/deprecation, Creative Agent Patterns (Sommelier, Geneticist, Archaeologist, Diplomat, Prophet), Implementation Roadmap for Codex |
| 2026-01-20 | 7.1.0 | Added Preamble to Part XIV with 5 fundamental problems, success criteria, alternative approaches, and explicit guidance for Codex to propose better solutions |
| 2026-01-20 | 8.0.0 | Added Implementation Status tracker, What to Implement Next for Codex, updated Part X with completion status |
| 2026-01-20 | 9.0.0 | Added Part XV: Operator Execution Layer - comprehensive operator interpreters, execution semantics, and missing control-flow primitives |
| 2026-01-20 | 10.0.0 | Added Part XVI: Extensible LLM Provider Discovery - pluggable provider registry for any LLM config; LiBrainian independence from wave0 |
| 2026-01-20 | 10.1.0 | Added Critical B.1: Prediction-Oriented Memory - outcome-weighted retrieval with surprise priority, periodic consolidation, tiered patterns; enhances existing ClosedLoopLearner |
| 2026-01-20 | 10.2.0 | Added anti-pattern detection to B.1, Model Qualification Gate to Part XVI |
| 2026-01-20 | 10.3.0 | Interdisciplinary panel review: added Distribution Shift Detection (B.1), Concurrency Contract (Problem 25), Static Analysis Provider Interface (Problem 35) |
| 2026-01-20 | 10.4.0 | **20 Masters' Synthesis**: World-class enhancements to open problems from Knuth, Dijkstra, Thompson, Pike, Hickey, Armstrong, Lamport, Liskov, Hoare, Carmack, Kay, Torvalds, Hopper, Kernighan, Wirth, McCarthy, van Rossum, Hejlsberg, Norvig. Added: Git-Grounded Confidence (P5), Epistemic Type Algebra (P6), SIMD-Accelerated Vector Ops (P30), Autonomous Knowledge Cells (P37), Adaptive Rate Control (P39), Write-Ahead Logging (P40), Algebraic Schema Evolution (P42). All enhancements include TLA+ specifications, performance targets, and production-ready code patterns. |

---

## Part XV: The Operator Execution Layer

### [SPEC_SLICE] Part XV — Operator Execution Layer

- **[CAPABILITIES] Required**: operator registry + interpreters; primitive execution handlers; bounded budgets/timeouts; optional durable checkpoint store.
- **[CAPABILITIES] Optional**: LLM provider for LLM primitives; embedding provider for semantic operators; governor context for rate limits.
- **[ADAPTERS] Interfaces**: execution engine (`TechniqueExecutionEngine`), operator registry/interpreters, checkpoint store interface.
- **[EVIDENCE_LEDGER] Events**: operator start/finish, branch decision, retry, checkpoint save/restore, coverage gap (noop/unsupported).
- **[CLAIMS] Outputs**: execution claims must cite operator events + checkpoint hashes; otherwise mark `unverified_by_trace(replay_unavailable)`.
- **Degradation**: unsupported operator types fail-closed (or emit explicit coverage gap + degraded mode).
- **Evidence commands**: `cd packages/LiBrainian && npx vitest src/api/__tests__/technique_execution.test.ts src/api/__tests__/operator_interpreters.test.ts` and `npm run test:tier0`.

### The Gap: Operator Semantics Are Partially Real (Many Are Still No-ops)

**Critical Reality**: The operator interpreter layer exists in code (`src/LiBrainian/api/technique_execution.ts` + `src/LiBrainian/api/operator_registry.ts` + `src/LiBrainian/api/operator_interpreters.ts`), and *some* operator semantics are implemented (notably `parallel`, `conditional`, `loop`, `retry`, `checkpoint`, `timebox`, `budget_cap`, `quorum`, `consensus`, `circuit_breaker`).

However, a large subset of operator types are currently implemented as explicit **no-op interpreters** (e.g., `merge`, `fanout`, `fanin`, `backoff`, `monitor`, `replay`, `cache`, `reduce`). This produces a dangerous form of “paper capability”: compositions can compile and “run”, but the advertised control semantics may be absent.

**Therefore this Part’s non-negotiable requirement** is not “add an interpreter layer” (it exists) — it is:
1. **Eliminate silent semantics gaps**: every built-in operator type must be either (a) implemented with clear semantics + tests, or (b) fail-closed when used (with an explicit coverage gap) unless it is intentionally defined as a pure metadata operator.
2. **Make semantics observable**: operator enter/exit/branch/retry/checkpoint events must be visible to the query/episode/audit layer so claims about execution are verifiable.

**[CAPABILITIES] Required**
- Execute primitives with bounded budgets (`GovernorContext`) and timeboxing where applicable.
- Run concurrent primitive handlers (for `parallel`) without shared-state races (state merges must be explicit and logged).
- Persist checkpoints safely if checkpointing is enabled (idempotent save + recover semantics).

**[EVIDENCE_LEDGER] Events (minimum)**
- `operator_started` / `operator_completed` (operator id/type + input primitive ids + timestamps)
- `operator_branch` (condition expression + evaluated values snapshot + chosen target)
- `operator_retry` (attempt + delay + reason)
- `operator_checkpoint` (checkpoint id + stored state hash + reason)
- `operator_coverage_gap` (operator used but interpreter is noop/unsupported; fail-closed or explicit degraded mode)

**[CLAIMS] Outputs**
- “This technique executed with operator semantics X” is only allowed if the run emitted the corresponding operator events and can be replayed to the same decisions (or explicitly marked `unverified_by_trace(replay_unavailable)`).

---

### A. Operator Interpreter Architecture

The execution engine uses an **operator interpreter** layer that sits between composition definition and primitive execution. The remaining work is to make operator semantics complete, bounded, observable, and evidence-backed.

#### A.1 Core Interpreter Interface

```typescript
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * OPERATOR INTERPRETER - Executes control flow operators
 * ═══════════════════════════════════════════════════════════════════════════
 */

export type OperatorExecutionResult =
  | { type: 'continue'; outputs: Record<string, unknown> }
  | { type: 'skip'; reason: string }
  | { type: 'retry'; delay: number; attempt: number }
  | { type: 'branch'; target: string }
  | { type: 'terminate'; reason: string; graceful: boolean }
  | { type: 'escalate'; level: EscalationLevel; context: unknown }
  | { type: 'checkpoint'; reason: string; state: Record<string, unknown> };

export interface OperatorInterpreter {
  readonly operatorType: TechniqueOperatorType;

  /**
   * Called before executing primitives covered by this operator
   */
  beforeExecute(context: OperatorContext): Promise<OperatorExecutionResult>;

  /**
   * Called after each primitive execution within operator scope
   */
  afterPrimitiveExecute(
    primitive: TechniquePrimitive,
    result: PrimitiveExecutionResult,
    context: OperatorContext
  ): Promise<OperatorExecutionResult>;

  /**
   * Called after all primitives in operator scope complete
   */
  afterExecute(
    results: PrimitiveExecutionResult[],
    context: OperatorContext
  ): Promise<OperatorExecutionResult>;
}

export interface OperatorContext {
  operator: TechniqueOperator;
  composition: TechniqueComposition;
  state: Record<string, unknown>;
  attempt: number;
  startedAt: Date;
  governor?: GovernorContext;

  // For collaborative operators
  agents?: AgentContext[];
  votes?: Map<string, unknown>;
}

export type EscalationLevel = 'agent' | 'team' | 'human' | 'emergency';
```

#### A.2 Interpreter Registry

```typescript
export class OperatorInterpreterRegistry {
  private interpreters = new Map<TechniqueOperatorType, OperatorInterpreter>();

  register(interpreter: OperatorInterpreter): void {
    this.interpreters.set(interpreter.operatorType, interpreter);
  }

  get(type: TechniqueOperatorType): OperatorInterpreter | undefined {
    return this.interpreters.get(type);
  }

  /**
   * Build execution plan respecting operator semantics
   */
  buildExecutionPlan(composition: TechniqueComposition): ExecutionPlan {
    const plan: ExecutionPlan = {
      steps: [],
      parallelGroups: [],
      conditionalBranches: [],
      loopBoundaries: [],
    };

    // Analyze operators to build proper execution structure
    for (const operator of composition.operators ?? []) {
      const interpreter = this.get(operator.type);
      if (!interpreter) {
        throw new Error(`unverified_by_trace(operator_interpreter_missing): ${operator.type}`);
      }
      // Each interpreter contributes to the plan structure
      this.incorporateOperator(plan, operator, interpreter, composition);
    }

    return plan;
  }
}
```

---

### B. Control Flow Operator Interpreters

#### B.1 Parallel Operator

**Purpose**: Execute multiple primitives concurrently.

```typescript
export class ParallelOperatorInterpreter implements OperatorInterpreter {
  readonly operatorType = 'parallel';

  async beforeExecute(context: OperatorContext): Promise<OperatorExecutionResult> {
    // Validate all inputs are independent (no data dependencies between them)
    const inputs = context.operator.inputs ?? [];
    if (inputs.length < 2) {
      return { type: 'continue', outputs: {} };
    }

    // Mark primitives for concurrent execution
    context.state['__parallel_group'] = inputs;
    context.state['__parallel_results'] = new Map();

    return { type: 'continue', outputs: {} };
  }

  async afterPrimitiveExecute(
    primitive: TechniquePrimitive,
    result: PrimitiveExecutionResult,
    context: OperatorContext
  ): Promise<OperatorExecutionResult> {
    const results = context.state['__parallel_results'] as Map<string, PrimitiveExecutionResult>;
    results.set(primitive.id, result);

    // Check if all parallel primitives completed
    const group = context.state['__parallel_group'] as string[];
    if (results.size === group.length) {
      // All done - check for failures
      const failures = Array.from(results.values()).filter(r => r.status === 'failed');
      if (failures.length > 0) {
        const failureMode = context.operator.parameters?.['failureMode'] ?? 'fail_fast';
        if (failureMode === 'fail_fast') {
          return { type: 'terminate', reason: 'Parallel execution failed', graceful: true };
        }
      }
    }

    return { type: 'continue', outputs: {} };
  }

  async afterExecute(
    results: PrimitiveExecutionResult[],
    context: OperatorContext
  ): Promise<OperatorExecutionResult> {
    // Merge outputs from all parallel branches
    const mergedOutputs: Record<string, unknown> = {};
    for (const result of results) {
      Object.assign(mergedOutputs, result.output);
    }
    return { type: 'continue', outputs: mergedOutputs };
  }
}
```

**Execution Engine Integration**:
```typescript
// In TechniqueExecutionEngine.executeComposition():
const parallelGroup = state['__parallel_group'] as string[] | undefined;
if (parallelGroup && parallelGroup.length > 1) {
  // Execute in parallel using Promise.all
  const parallelResults = await Promise.all(
    parallelGroup.map(primitiveId =>
      this.executePrimitive(resolvePrimitive(primitiveId), buildInput(primitiveId), context)
    )
  );
  // Continue with merged results
}
```

#### B.2 Conditional Operator

**Purpose**: Branch execution based on runtime conditions.

```typescript
export class ConditionalOperatorInterpreter implements OperatorInterpreter {
  readonly operatorType = 'conditional';

  async beforeExecute(context: OperatorContext): Promise<OperatorExecutionResult> {
    const conditions = context.operator.conditions ?? [];
    const state = context.state;

    // Evaluate conditions against current state
    for (const condition of conditions) {
      const result = this.evaluateCondition(condition, state);
      if (result.matched) {
        // Branch to the target primitive/group
        const target = this.extractTarget(condition);
        return { type: 'branch', target };
      }
    }

    // No condition matched - use default path or skip
    const defaultTarget = context.operator.parameters?.['default'] as string | undefined;
    if (defaultTarget) {
      return { type: 'branch', target: defaultTarget };
    }

    return { type: 'skip', reason: 'No condition matched and no default path' };
  }

  private evaluateCondition(
    condition: string,
    state: Record<string, unknown>
  ): { matched: boolean; target?: string } {
    // Parse condition: "state.confidence > 0.8 => tp_fast_path"
    const [expression, target] = condition.split('=>').map(s => s.trim());

    // Safe expression evaluation (no eval!)
    const matched = this.safeEvaluate(expression, state);
    return { matched, target };
  }

  private safeEvaluate(expression: string, state: Record<string, unknown>): boolean {
    // Parse simple conditions: "key > value", "key == value", "key.exists"
    const comparators = ['>=', '<=', '!=', '==', '>', '<'];

    for (const comp of comparators) {
      if (expression.includes(comp)) {
        const [left, right] = expression.split(comp).map(s => s.trim());
        const leftValue = this.resolveValue(left, state);
        const rightValue = this.resolveValue(right, state);

        switch (comp) {
          case '>=': return leftValue >= rightValue;
          case '<=': return leftValue <= rightValue;
          case '!=': return leftValue !== rightValue;
          case '==': return leftValue === rightValue;
          case '>': return leftValue > rightValue;
          case '<': return leftValue < rightValue;
        }
      }
    }

    // Boolean check
    if (expression.endsWith('.exists')) {
      const key = expression.replace('.exists', '');
      return this.resolveValue(key, state) !== undefined;
    }

    return Boolean(this.resolveValue(expression, state));
  }

  private resolveValue(path: string, state: Record<string, unknown>): unknown {
    // Handle literals
    if (path === 'true') return true;
    if (path === 'false') return false;
    if (!isNaN(Number(path))) return Number(path);
    if (path.startsWith('"') && path.endsWith('"')) return path.slice(1, -1);

    // Resolve state path: "state.results.confidence"
    const parts = path.replace(/^state\./, '').split('.');
    let value: unknown = state;
    for (const part of parts) {
      if (value && typeof value === 'object') {
        value = (value as Record<string, unknown>)[part];
      } else {
        return undefined;
      }
    }
    return value;
  }

  async afterPrimitiveExecute(): Promise<OperatorExecutionResult> {
    return { type: 'continue', outputs: {} };
  }

  async afterExecute(): Promise<OperatorExecutionResult> {
    return { type: 'continue', outputs: {} };
  }
}
```

#### B.3 Loop Operator

**Purpose**: Iterate until a termination condition is met.

```typescript
export class LoopOperatorInterpreter implements OperatorInterpreter {
  readonly operatorType = 'loop';

  private static readonly MAX_ITERATIONS = 100; // Safety limit

  async beforeExecute(context: OperatorContext): Promise<OperatorExecutionResult> {
    const iteration = (context.state['__loop_iteration'] as number | undefined) ?? 0;
    const maxIterations = context.operator.parameters?.['maxIterations'] as number ??
                          LoopOperatorInterpreter.MAX_ITERATIONS;

    if (iteration >= maxIterations) {
      return {
        type: 'terminate',
        reason: `Loop exceeded maximum iterations (${maxIterations})`,
        graceful: true
      };
    }

    context.state['__loop_iteration'] = iteration + 1;
    return { type: 'continue', outputs: {} };
  }

  async afterExecute(
    results: PrimitiveExecutionResult[],
    context: OperatorContext
  ): Promise<OperatorExecutionResult> {
    const conditions = context.operator.conditions ?? [];

    // Check termination conditions
    for (const condition of conditions) {
      if (this.isTerminationMet(condition, context.state, results)) {
        return { type: 'continue', outputs: { loopCompleted: true } };
      }
    }

    // Not terminated - loop again
    return {
      type: 'branch',
      target: context.operator.inputs?.[0] ?? ''
    };
  }

  private isTerminationMet(
    condition: string,
    state: Record<string, unknown>,
    results: PrimitiveExecutionResult[]
  ): boolean {
    // Built-in conditions
    if (condition === 'all_success') {
      return results.every(r => r.status === 'success');
    }
    if (condition === 'any_success') {
      return results.some(r => r.status === 'success');
    }
    if (condition === 'verification_passed') {
      return state['verification_status'] === 'passed';
    }
    if (condition === 'confidence_threshold') {
      const threshold = 0.8;
      return (state['confidence'] as number ?? 0) >= threshold;
    }

    // Custom condition evaluation (delegate to conditional interpreter)
    return false;
  }

  async afterPrimitiveExecute(): Promise<OperatorExecutionResult> {
    return { type: 'continue', outputs: {} };
  }
}
```

---

### C. Resilience Operator Interpreters

#### C.1 Retry Operator with Backoff

**Purpose**: Automatically retry failed primitives with configurable backoff.

```typescript
export class RetryOperatorInterpreter implements OperatorInterpreter {
  readonly operatorType = 'retry';

  async beforeExecute(): Promise<OperatorExecutionResult> {
    return { type: 'continue', outputs: {} };
  }

  async afterPrimitiveExecute(
    primitive: TechniquePrimitive,
    result: PrimitiveExecutionResult,
    context: OperatorContext
  ): Promise<OperatorExecutionResult> {
    if (result.status === 'success') {
      delete context.state[`__retry_count_${primitive.id}`];
      return { type: 'continue', outputs: result.output };
    }

    const maxRetries = context.operator.parameters?.['maxRetries'] as number ?? 3;
    const retryCount = (context.state[`__retry_count_${primitive.id}`] as number ?? 0) + 1;
    context.state[`__retry_count_${primitive.id}`] = retryCount;

    if (retryCount > maxRetries) {
      return {
        type: 'terminate',
        reason: `Primitive ${primitive.id} failed after ${maxRetries} retries`,
        graceful: true
      };
    }

    // Calculate backoff delay
    const backoffStrategy = context.operator.parameters?.['backoff'] as string ?? 'exponential';
    const baseDelay = context.operator.parameters?.['baseDelayMs'] as number ?? 1000;
    const delay = this.calculateDelay(backoffStrategy, baseDelay, retryCount);

    return { type: 'retry', delay, attempt: retryCount };
  }

  private calculateDelay(strategy: string, baseDelay: number, attempt: number): number {
    switch (strategy) {
      case 'constant': return baseDelay;
      case 'linear': return baseDelay * attempt;
      case 'exponential': return baseDelay * Math.pow(2, attempt - 1);
      case 'exponential_jitter':
        const exp = baseDelay * Math.pow(2, attempt - 1);
        return exp + Math.random() * exp * 0.3;
      default: return baseDelay;
    }
  }

  async afterExecute(): Promise<OperatorExecutionResult> {
    return { type: 'continue', outputs: {} };
  }
}
```

#### C.2 Circuit Breaker Operator

**Purpose**: Stop execution after threshold failures to prevent cascade damage.

```typescript
export class CircuitBreakerOperatorInterpreter implements OperatorInterpreter {
  readonly operatorType = 'circuit_breaker';

  private static circuitState = new Map<string, {
    status: 'closed' | 'open' | 'half-open';
    failures: number;
    lastFailure: number | null;
  }>();

  async beforeExecute(context: OperatorContext): Promise<OperatorExecutionResult> {
    const circuitId = context.operator.id;
    const state = CircuitBreakerOperatorInterpreter.circuitState.get(circuitId) ?? {
      status: 'closed', failures: 0, lastFailure: null
    };

    const resetTimeout = context.operator.parameters?.['resetTimeoutMs'] as number ?? 60000;

    if (state.status === 'open') {
      const timeSinceLastFailure = Date.now() - (state.lastFailure ?? 0);
      if (timeSinceLastFailure < resetTimeout) {
        return {
          type: 'skip',
          reason: `Circuit breaker OPEN - ${Math.ceil((resetTimeout - timeSinceLastFailure) / 1000)}s until retry`
        };
      }
      state.status = 'half-open';
    }

    context.state['__circuit_state'] = state;
    return { type: 'continue', outputs: {} };
  }

  async afterPrimitiveExecute(
    primitive: TechniquePrimitive,
    result: PrimitiveExecutionResult,
    context: OperatorContext
  ): Promise<OperatorExecutionResult> {
    const circuitId = context.operator.id;
    const state = context.state['__circuit_state'] as { status: string; failures: number; lastFailure: number | null };
    const threshold = context.operator.parameters?.['failureThreshold'] as number ?? 5;

    if (result.status === 'failed') {
      state.failures++;
      state.lastFailure = Date.now();

      if (state.status === 'half-open' || state.failures >= threshold) {
        state.status = 'open';
        CircuitBreakerOperatorInterpreter.circuitState.set(circuitId, state as any);
        return {
          type: 'terminate',
          reason: 'Circuit breaker OPEN - too many failures',
          graceful: true
        };
      }
    } else if (state.status === 'half-open') {
      state.status = 'closed';
      state.failures = 0;
    }

    CircuitBreakerOperatorInterpreter.circuitState.set(circuitId, state as any);
    return { type: 'continue', outputs: result.output };
  }

  async afterExecute(): Promise<OperatorExecutionResult> {
    return { type: 'continue', outputs: {} };
  }
}
```

#### C.3 Fallback Operator

**Purpose**: Execute alternative path when primary fails.

```typescript
export class FallbackOperatorInterpreter implements OperatorInterpreter {
  readonly operatorType = 'fallback';

  async beforeExecute(): Promise<OperatorExecutionResult> {
    return { type: 'continue', outputs: {} };
  }

  async afterPrimitiveExecute(
    primitive: TechniquePrimitive,
    result: PrimitiveExecutionResult,
    context: OperatorContext
  ): Promise<OperatorExecutionResult> {
    if (result.status !== 'failed') {
      return { type: 'continue', outputs: result.output };
    }

    const fallbackTargets = context.operator.outputs ?? [];
    const attemptedFallbacks = context.state['__fallback_attempted'] as Set<string> ?? new Set();

    for (const fallbackId of fallbackTargets) {
      if (!attemptedFallbacks.has(fallbackId)) {
        attemptedFallbacks.add(fallbackId);
        context.state['__fallback_attempted'] = attemptedFallbacks;
        return { type: 'branch', target: fallbackId };
      }
    }

    return { type: 'terminate', reason: 'All fallback paths exhausted', graceful: true };
  }

  async afterExecute(): Promise<OperatorExecutionResult> {
    return { type: 'continue', outputs: {} };
  }
}
```

---

### D. Collaborative Operator Interpreters

#### D.1 Quorum Operator

**Purpose**: Require agreement from N of M agents/primitives.

```typescript
export class QuorumOperatorInterpreter implements OperatorInterpreter {
  readonly operatorType = 'quorum';

  async beforeExecute(): Promise<OperatorExecutionResult> {
    return { type: 'continue', outputs: {} };
  }

  async afterPrimitiveExecute(): Promise<OperatorExecutionResult> {
    return { type: 'continue', outputs: {} };
  }

  async afterExecute(
    results: PrimitiveExecutionResult[],
    context: OperatorContext
  ): Promise<OperatorExecutionResult> {
    const required = context.operator.parameters?.['required'] as number ??
                     Math.ceil(results.length * 0.5) + 1;

    // Count agreements
    const conclusions = new Map<string, number>();
    for (const result of results) {
      if (result.status === 'success') {
        const conclusion = JSON.stringify(result.output['conclusion'] ?? result.output);
        conclusions.set(conclusion, (conclusions.get(conclusion) ?? 0) + 1);
      }
    }

    // Find majority
    let maxVotes = 0;
    let majorityConclusion: string | null = null;
    for (const [conclusion, votes] of conclusions) {
      if (votes > maxVotes) {
        maxVotes = votes;
        majorityConclusion = conclusion;
      }
    }

    if (maxVotes >= required) {
      return {
        type: 'continue',
        outputs: {
          quorumReached: true,
          conclusion: majorityConclusion ? JSON.parse(majorityConclusion) : null,
          votes: maxVotes,
          required,
          dissent: results.filter(r =>
            JSON.stringify(r.output['conclusion'] ?? r.output) !== majorityConclusion
          ).map(r => ({ primitiveId: r.primitiveId, output: r.output }))
        }
      };
    }

    // Quorum not reached - escalate
    return {
      type: 'escalate',
      level: 'human',
      context: { reason: 'Quorum not reached', votes: maxVotes, required }
    };
  }
}
```

#### D.2 Consensus Operator

**Purpose**: Require unanimous agreement or structured resolution.

```typescript
export class ConsensusOperatorInterpreter implements OperatorInterpreter {
  readonly operatorType = 'consensus';

  async beforeExecute(): Promise<OperatorExecutionResult> {
    return { type: 'continue', outputs: {} };
  }

  async afterPrimitiveExecute(): Promise<OperatorExecutionResult> {
    return { type: 'continue', outputs: {} };
  }

  async afterExecute(
    results: PrimitiveExecutionResult[],
    context: OperatorContext
  ): Promise<OperatorExecutionResult> {
    const successResults = results.filter(r => r.status === 'success');

    if (successResults.length === 0) {
      return { type: 'terminate', reason: 'No successful results for consensus', graceful: true };
    }

    // Check for unanimous agreement
    const conclusions = successResults.map(r => JSON.stringify(r.output['conclusion'] ?? r.output));
    const uniqueConclusions = new Set(conclusions);

    if (uniqueConclusions.size === 1) {
      return {
        type: 'continue',
        outputs: { consensusReached: true, unanimous: true, conclusion: JSON.parse(conclusions[0]) }
      };
    }

    // No unanimous agreement - escalate or use resolution strategy
    const resolution = context.operator.parameters?.['resolution'] as string ?? 'escalate';

    if (resolution === 'majority') {
      // Simple majority voting
      const votes = new Map<string, number>();
      for (const c of conclusions) {
        votes.set(c, (votes.get(c) ?? 0) + 1);
      }
      let maxKey = conclusions[0];
      let maxVotes = 0;
      for (const [key, count] of votes) {
        if (count > maxVotes) { maxKey = key; maxVotes = count; }
      }
      return {
        type: 'continue',
        outputs: { consensusReached: true, unanimous: false, method: 'majority', conclusion: JSON.parse(maxKey) }
      };
    }

    return {
      type: 'escalate',
      level: 'human',
      context: {
        reason: 'Consensus not reached',
        positions: successResults.map(r => ({ primitiveId: r.primitiveId, conclusion: r.output }))
      }
    };
  }
}
```

---

### E. Resource Constraint Operator Interpreters

#### E.1 Timebox Operator

```typescript
export class TimeboxOperatorInterpreter implements OperatorInterpreter {
  readonly operatorType = 'timebox';

  async beforeExecute(context: OperatorContext): Promise<OperatorExecutionResult> {
    const timeoutMs = context.operator.parameters?.['timeoutMs'] as number ?? 60000;
    context.state['__timebox_start'] = Date.now();
    context.state['__timebox_deadline'] = Date.now() + timeoutMs;
    return { type: 'continue', outputs: {} };
  }

  async afterPrimitiveExecute(
    _primitive: TechniquePrimitive,
    _result: PrimitiveExecutionResult,
    context: OperatorContext
  ): Promise<OperatorExecutionResult> {
    const deadline = context.state['__timebox_deadline'] as number;
    if (Date.now() > deadline) {
      const action = context.operator.parameters?.['onTimeout'] as string ?? 'checkpoint';
      if (action === 'terminate') {
        return { type: 'terminate', reason: 'Timebox exceeded', graceful: true };
      }
      return { type: 'checkpoint', reason: 'Timebox exceeded', state: context.state };
    }
    return { type: 'continue', outputs: {} };
  }

  async afterExecute(
    _results: PrimitiveExecutionResult[],
    context: OperatorContext
  ): Promise<OperatorExecutionResult> {
    const elapsed = Date.now() - (context.state['__timebox_start'] as number);
    return { type: 'continue', outputs: { elapsedMs: elapsed } };
  }
}
```

#### E.2 Budget Cap Operator

```typescript
export class BudgetCapOperatorInterpreter implements OperatorInterpreter {
  readonly operatorType = 'budget_cap';

  async beforeExecute(context: OperatorContext): Promise<OperatorExecutionResult> {
    context.state['__budget_max_tokens'] = context.operator.parameters?.['maxTokens'] ?? 100000;
    context.state['__budget_used_tokens'] = 0;
    return { type: 'continue', outputs: {} };
  }

  async afterPrimitiveExecute(
    _primitive: TechniquePrimitive,
    result: PrimitiveExecutionResult,
    context: OperatorContext
  ): Promise<OperatorExecutionResult> {
    // Extract token usage from evidence
    const llmEvidence = result.evidence.filter(e => e.type === 'llm');
    for (const evidence of llmEvidence) {
      const tokens = evidence.metadata?.['tokens'] as number ?? 0;
      context.state['__budget_used_tokens'] = (context.state['__budget_used_tokens'] as number) + tokens;
    }

    const used = context.state['__budget_used_tokens'] as number;
    const max = context.state['__budget_max_tokens'] as number;

    if (used > max) {
      return { type: 'terminate', reason: `Budget exceeded: ${used}/${max} tokens`, graceful: true };
    }
    return { type: 'continue', outputs: {} };
  }

  async afterExecute(
    _results: PrimitiveExecutionResult[],
    context: OperatorContext
  ): Promise<OperatorExecutionResult> {
    return { type: 'continue', outputs: { totalTokens: context.state['__budget_used_tokens'] } };
  }
}
```

---

### F. Missing Primitives for Operator Support

#### F.1 Deliberation Primitive

```typescript
const tp_deliberate: TechniquePrimitive = {
  id: 'tp_deliberate',
  name: 'Deliberate on Disagreement',
  intent: 'Engage in structured deliberation to find common ground between disagreeing positions',
  category: 'collaborative',
  kind: 'synthesis',
  abstractionLevel: 'task',
  contract: {
    inputSchema: {
      type: 'object',
      properties: {
        positions: { type: 'array', items: { type: 'object' } },
        round: { type: 'number' },
        maxRounds: { type: 'number' }
      },
      required: ['positions']
    },
    outputSchema: {
      type: 'object',
      properties: {
        consensusReached: { type: 'boolean' },
        synthesizedPosition: { type: 'object' },
        remainingDisagreements: { type: 'array' }
      }
    }
  }
};
```

#### F.2 Escalation Handler Primitive

```typescript
const tp_handle_escalation: TechniquePrimitive = {
  id: 'tp_handle_escalation',
  name: 'Handle Escalation',
  intent: 'Prepare context for human review or higher-level intervention',
  category: 'coordination',
  kind: 'orchestration',
  abstractionLevel: 'task',
  contract: {
    inputSchema: {
      type: 'object',
      properties: {
        level: { type: 'string', enum: ['agent', 'team', 'human', 'emergency'] },
        reason: { type: 'string' },
        context: { type: 'object' }
      },
      required: ['level', 'reason']
    },
    outputSchema: {
      type: 'object',
      properties: {
        escalationId: { type: 'string' },
        summary: { type: 'string' },
        recommendedActions: { type: 'array' },
        blockedUntilResolved: { type: 'boolean' }
      }
    }
  }
};
```

#### F.3 Checkpoint Recovery Primitive

```typescript
const tp_recover_from_checkpoint: TechniquePrimitive = {
  id: 'tp_recover_from_checkpoint',
  name: 'Recover from Checkpoint',
  intent: 'Analyze saved checkpoint and determine safe recovery strategy',
  category: 'resilience',
  kind: 'recovery',
  abstractionLevel: 'task',
  contract: {
    inputSchema: {
      type: 'object',
      properties: {
        checkpoint: { type: 'object' },
        timeSinceCheckpoint: { type: 'number' },
        externalChanges: { type: 'array' }
      },
      required: ['checkpoint']
    },
    outputSchema: {
      type: 'object',
      properties: {
        recoveryStrategy: { type: 'string', enum: ['resume', 'restart', 'partial_restart', 'abort'] },
        startFromPrimitive: { type: 'string' },
        stateAdjustments: { type: 'object' }
      }
    }
  }
};
```

#### F.4 Parallel Merge Primitive

```typescript
const tp_merge_parallel_results: TechniquePrimitive = {
  id: 'tp_merge_parallel_results',
  name: 'Merge Parallel Results',
  intent: 'Combine outputs from parallel execution branches',
  category: 'coordination',
  kind: 'synthesis',
  abstractionLevel: 'task',
  contract: {
    inputSchema: {
      type: 'object',
      properties: {
        results: { type: 'array' },
        mergeStrategy: { type: 'string', enum: ['union', 'intersection', 'priority', 'custom'] }
      },
      required: ['results']
    },
    outputSchema: {
      type: 'object',
      properties: {
        merged: { type: 'object' },
        conflicts: { type: 'array' }
      }
    }
  }
};
```

---

### G. Implementation Roadmap

| Phase | Deliverable | Priority | Est. LOC |
|-------|-------------|----------|----------|
| **1** | OperatorInterpreter interface + registry | Critical | ~150 |
| **2** | Parallel, Conditional, Loop interpreters | Critical | ~400 |
| **3** | Retry, CircuitBreaker, Fallback interpreters | High | ~350 |
| **4** | Quorum, Consensus interpreters | High | ~400 |
| **5** | Timebox, BudgetCap interpreters | Medium | ~200 |
| **6** | Missing primitives (tp_deliberate, etc.) | High | ~300 |
| **7** | Enhanced executeComposition integration | Critical | ~250 |
| **8** | Tests for all operators | Critical | ~500 |

**Total: ~2,550 lines**

**Files (already present; verify + extend):**
- `src/LiBrainian/api/operator_interpreters.ts`
- `src/LiBrainian/api/operator_registry.ts`
- `src/LiBrainian/api/__tests__/operator_interpreters.test.ts`
- `src/LiBrainian/api/__tests__/operator_registry.test.ts`

**Files to modify:**
- `src/LiBrainian/api/technique_execution.ts` (verify interpreter integration + semantics coverage)
- `src/LiBrainian/api/technique_library.ts` (add missing primitives)
- `src/LiBrainian/api/index.ts` (export new modules)

---

### H. Success Criteria

| Capability | Before | After |
|------------|--------|-------|
| Parallel execution | ❌ Sequential only | ✅ True parallelism |
| Conditional branching | ❌ Metadata only | ✅ Runtime branching |
| Loop iteration | ❌ Ignored | ✅ Bounded iteration |
| Automatic retry | ❌ None | ✅ Configurable backoff |
| Circuit breaker | ❌ Metadata only | ✅ Fail-fast protection |
| Quorum voting | ❌ Not possible | ✅ N-of-M agreement |
| Consensus | ❌ Not possible | ✅ Deliberation support |
| Time/budget limits | ❌ Advisory only | ✅ Enforced constraints |

**World-class benchmark**: Match or exceed:
- Temporal.io workflows
- AWS Step Functions
- Prefect/Airflow DAGs
- Kubernetes operator patterns

---

## Part XVI: Extensible LLM Provider Discovery

### [SPEC_SLICE] Part XVI — Extensible LLM Provider Discovery

- **[CAPABILITIES] Required**: CLI-authenticated providers; provider health checks via `checkAllProviders()`; environment config discovery.
- **[CAPABILITIES] Optional**: provider metadata discovery (model lists, pricing, reasoning levels); caching + last-known-good fallback.
- **[ADAPTERS] Interfaces**: provider discovery registry; `llm_env` + `llm_provider_discovery` contracts; model registry store.
- **[EVIDENCE_LEDGER] Events**: provider check start/finish, model registry update, provider mismatch/unsupported warnings.
- **[CLAIMS] Outputs**: “provider available / model supported” claims must cite provider checks + model registry evidence.
- **Degradation**: if providers unavailable → fail with `unverified_by_trace(provider_unavailable)`; no API key fallbacks.
- **Evidence commands**: `cd packages/LiBrainian && npx vitest src/api/__tests__/llm_provider_discovery.test.ts` and `./scripts/check_forbidden_patterns.sh`.

> **Added**: 2026-01-20
>
> **Problem (re-scoped to code reality)**: Provider discovery exists, but it is not yet the *uniform* entrypoint. Any codepath that bypasses discovery (or instantiates `LLMService` directly) will still fail with `provider_unavailable` in environments where CLIs are authenticated but env vars are unset.
>
> **Architectural Requirement**: LiBrainian must be independent and separable from wave0-autopilot. It should work as a standalone GitHub package in ANY repository without requiring wave0-specific configuration.

**[CAPABILITIES] Required**
- Run fast, non-destructive provider probes (CLI/local HTTP) with strict timeouts and bounded retries.
- Sanitize probe metadata (never log secrets; avoid unsafe env passthrough).

**[ADAPTERS] Interfaces**
- `LlmProviderProbe` is the adapter boundary; all providers (current and future) plug in here.
- Provider selection must be driven by `checkAllProviders()`/`requireProviders()` semantics, not ad-hoc env checks in call sites.

**[EVIDENCE_LEDGER] Events (minimum)**
- `provider_probe_started` / `provider_probe_result` (provider id + latency + authenticated + sanitized metadata)
- `provider_selected` (provider/model + reason + priority ordering)
- `provider_unavailable` (what was checked + remediation steps)

**[CLAIMS] Outputs**
- “LLM available” is only claimable if there is a recorded probe result (or a documented, replayable shortcut) for the current environment.

### A. The Core Problem

Provider selection must be **capability-driven** (what’s available + authenticated), not “whatever env vars happen to be set”, and it must be **used everywhere**.

Implementation reality (already present, but must be enforced as the only entrypoint):
- `src/LiBrainian/api/llm_provider_discovery.ts` (registry + probes + status)
- `src/LiBrainian/api/llm_env.ts` (`resolveLibrarianModelConfigWithDiscovery()` fallback)
- `src/LiBrainian/api/provider_check.ts` (`checkAllProviders()` / `requireProviders()`)

This fails in multiple scenarios:

| Scenario | What Happens | What Should Happen |
|----------|--------------|-------------------|
| New repo, no env vars | `provider_unavailable` error | Auto-discover authenticated CLI |
| Ollama running locally | `provider_unavailable` error | Detect and use Ollama |
| Provider set but model missing | `provider_unavailable` or “model missing” | Use provider default model via registry |
| Multiple providers available | No preference logic | Pick best available by priority |

### B. Design Principles

1. **Extensibility First**: New providers shouldn't require core code changes
2. **Registration Pattern**: Providers register probes, system discovers what's available
3. **Priority-Based Selection**: When multiple providers work, pick the best one
4. **Helpful Failures**: When nothing works, explain what was checked and how to fix
5. **Independence**: No coupling to wave0-specific infrastructure

### C. Core Interfaces

```typescript
// llm_provider_discovery.ts

export type LlmAuthMethod = 'cli_login' | 'api_key' | 'local' | 'oauth' | 'none';

/**
 * Describes a provider's capabilities and configuration.
 */
export interface LlmProviderDescriptor {
  /** Unique provider identifier (e.g., 'claude', 'ollama', 'openai') */
  id: string;
  /** Human-readable name for error messages */
  name: string;
  /** Authentication method used */
  authMethod: LlmAuthMethod;
  /** Default model ID for this provider */
  defaultModel: string;
  /** Priority for auto-selection (lower = higher priority) */
  priority: number;
  /** Whether this provider supports embedding generation */
  supportsEmbeddings: boolean;
  /** Whether this provider supports chat/completion */
  supportsChat: boolean;
}

/**
 * Result of probing a provider for availability.
 */
export interface LlmProviderProbeResult {
  available: boolean;        // Provider binary/endpoint exists
  authenticated: boolean;    // Credentials are valid
  error?: string;           // Human-readable error if unavailable
  availableModels?: string[]; // Models this provider offers (if discoverable)
  metadata?: Record<string, unknown>; // Provider-specific metadata
}

/**
 * A probe checks if a specific provider is available and authenticated.
 * Implementations should be fast (timeout after 5s) and non-destructive.
 */
export interface LlmProviderProbe {
  /** Provider descriptor with capabilities */
  descriptor: LlmProviderDescriptor;
  /** Check availability and authentication */
  probe(): Promise<LlmProviderProbeResult>;
  /** Environment variables that configure this provider */
  envVars: string[];
}
```

### D. Provider Registry

```typescript
/**
 * Central registry for LLM provider probes.
 * Singleton pattern - providers register once at module load.
 */
class LlmProviderRegistry {
  private probes = new Map<string, LlmProviderProbe>();
  private cachedDiscovery: { timestamp: number; results: Map<string, LlmProviderProbeResult> } | null = null;
  private cacheValidityMs = 30 * 60 * 1000; // 30 minutes

  /** Register a provider probe */
  register(probe: LlmProviderProbe): void;

  /** Unregister a provider (for testing) */
  unregister(providerId: string): void;

  /** Get a specific probe by ID */
  getProbe(providerId: string): LlmProviderProbe | undefined;

  /** Get all registered probes */
  getAllProbes(): LlmProviderProbe[];

  /**
   * Discover all available providers.
   * Results are cached for efficiency.
   */
  async discoverAll(options?: { forceRefresh?: boolean }): Promise<Map<string, LlmProviderProbeResult>>;

  /**
   * Find the best available provider for chat/completion.
   * Returns the highest-priority authenticated provider.
   */
  async findBestProvider(options?: {
    forceRefresh?: boolean;
    requireEmbeddings?: boolean;
  }): Promise<DiscoveredProvider | null>;

  /**
   * Check if a specific provider is available by ID.
   */
  async checkProvider(providerId: string): Promise<LlmProviderProbeResult>;
}

// Singleton instance
export const llmProviderRegistry = new LlmProviderRegistry();
```

### E. Built-in Provider Probes

The following probes should be registered by default.

**Policy note (Wave0)**: default auth is **CLI-based** (`claude` / `codex`). Do not add probes that read API keys or attempt browser/cookie auth flows in this repository. If another project needs token-based providers, implement them as an external plugin and keep Wave0’s provider gate semantics intact.

#### E.1 Claude CLI (Priority: 10)

```typescript
export const claudeCliProbe: LlmProviderProbe = {
  descriptor: {
    id: 'claude',
    name: 'Claude CLI',
    authMethod: 'cli_login',
    defaultModel: 'claude-sonnet-4-5-20241022',
    priority: 10,
    supportsEmbeddings: false,
    supportsChat: true,
  },
  envVars: ['CLAUDE_MODEL', 'CLAUDE_CONFIG_DIR'],
  async probe(): Promise<LlmProviderProbeResult> {
    // 1. Check `claude --version` (CLI available?)
    // 2. Check for Claude Code auth (e.g., `.claude.json` in `CLAUDE_CONFIG_DIR` / `~/.claude`)
    //    Optionally (force probe): run `claude --print "ok"` with a timeout
    // Return { available, authenticated, error }
  },
};
```

#### E.2 Codex CLI (Priority: 20)

```typescript
export const codexCliProbe: LlmProviderProbe = {
  descriptor: {
    id: 'codex',
    name: 'Codex CLI',
    authMethod: 'cli_login',
    defaultModel: 'gpt-5-codex',
    priority: 20,
    supportsEmbeddings: false,
    supportsChat: true,
  },
  envVars: ['CODEX_MODEL', 'CODEX_HOME', 'CODEX_PROFILE'],
  async probe(): Promise<LlmProviderProbeResult> {
    // 1. Check `codex --version`
    // 2. Check `codex login status`
  },
};
```

#### E.3 Ollama (Priority: 30)

```typescript
export const ollamaProbe: LlmProviderProbe = {
  descriptor: {
    id: 'ollama',
    name: 'Ollama (Local)',
    authMethod: 'local',
    defaultModel: 'llama3.2',
    priority: 30,
    supportsEmbeddings: true,
    supportsChat: true,
  },
  envVars: ['OLLAMA_HOST', 'OLLAMA_MODEL'],
  async probe(): Promise<LlmProviderProbeResult> {
    const host = process.env.OLLAMA_HOST || 'http://localhost:11434';
    // 1. Fetch http://localhost:11434/api/tags
    // 2. If successful, return { available: true, authenticated: true, availableModels }
    // 3. If ECONNREFUSED, return { available: false, error: 'Run "ollama serve"' }
  },
};
```

#### E.4 LM Studio (Priority: 35)

```typescript
export const lmStudioProbe: LlmProviderProbe = {
  descriptor: {
    id: 'lmstudio',
    name: 'LM Studio (Local)',
    authMethod: 'local',
    defaultModel: 'local-model',
    priority: 35,
    supportsEmbeddings: false,
    supportsChat: true,
  },
  envVars: ['LMSTUDIO_HOST'],
  async probe(): Promise<LlmProviderProbeResult> {
    const host = process.env.LMSTUDIO_HOST || 'http://localhost:1234';
    // Fetch http://localhost:1234/v1/models (OpenAI-compatible)
  },
};
```

### F. Integration with llm_env.ts

```typescript
// llm_env.ts (updated implementation)

import { discoverLlmProvider, llmProviderRegistry } from './llm_provider_discovery.js';

export type { LibrarianLlmProvider } from './llm_provider_discovery.js';
export { llmProviderRegistry } from './llm_provider_discovery.js';

/**
 * Resolves LLM config from environment variables only.
 * Fast and synchronous. Returns undefined if not explicitly configured.
 */
export function resolveLibrarianModelConfig(): {
  provider?: string;
  modelId?: string;
} {
  const provider = resolveLibrarianProvider();
  const modelId = resolveLibrarianModelId(provider);
  return { provider, modelId };
}

/**
 * Resolves LLM config with auto-discovery fallback.
 *
 * Resolution order:
 * 1. Explicit env vars (LIBRARIAN_LLM_PROVIDER, etc.)
 * 2. Auto-discovery of all registered providers
 *
 * Works in ANY repo without configuration if a provider is available.
 */
export async function resolveLibrarianModelConfigWithDiscovery(): Promise<{
  provider: string;
  modelId: string;
}> {
  // Fast path: explicit env vars
  const envConfig = resolveLibrarianModelConfig();
  if (envConfig.provider && envConfig.modelId) {
    return { provider: envConfig.provider, modelId: envConfig.modelId };
  }

  // If provider specified but no model, get default from registry
  if (envConfig.provider) {
    const probe = llmProviderRegistry.getProbe(envConfig.provider);
    if (probe) {
      return { provider: envConfig.provider, modelId: probe.descriptor.defaultModel };
    }
  }

  // Auto-discovery: probe all registered providers
  const discovered = await discoverLlmProvider();
  if (!discovered) {
    // Build helpful error message
    const statuses = await getAllProviderStatus();
    const details = statuses
      .map((s) => `  - ${s.descriptor.name}: ${s.status.error ?? 'ok'}`)
      .join('\n');

    throw new Error(
      `unverified_by_trace(provider_unavailable): No LLM providers available.\n` +
      `Checked providers:\n${details}\n\n` +
      `To fix:\n` +
      `  - Set LIBRARIAN_LLM_PROVIDER env var, OR\n` +
      `  - Authenticate a CLI: Claude (\`claude setup-token\` or run \`claude\`), Codex (\`codex login\`), OR\n` +
      `  - Start a local LLM: ollama serve, OR\n` +
      `  - Register a custom provider in llmProviderRegistry`
    );
  }

  return discovered;
}
```

### G. Integration with technique_execution.ts

```typescript
// technique_execution.ts (updated)

import { resolveLibrarianModelConfigWithDiscovery } from './llm_env.js';

/**
 * Async version that uses auto-discovery as fallback.
 * Works in any repo—doesn't require env vars if a provider is available.
 */
async function resolveExecutionModelConfigAsync(
  options: LlmPrimitiveExecutorOptions,
  context: ExecutionContext
): Promise<{ provider: string; modelId: string }> {
  // Fast path: explicit options or context
  if (options.provider && options.modelId) {
    return { provider: options.provider, modelId: options.modelId };
  }
  if (context.llm?.provider && context.llm?.modelId) {
    return { provider: context.llm.provider, modelId: context.llm.modelId };
  }
  // Slow path: env vars, then auto-discovery
  return resolveLibrarianModelConfigWithDiscovery();
}

// In createLlmPrimitiveExecutor:
export function createLlmPrimitiveExecutor(options: LlmPrimitiveExecutorOptions = {}): PrimitiveExecutionHandler {
  return async ({ primitive, input, context }) => {
    // Use async discovery instead of synchronous config
    const llmConfig = await resolveExecutionModelConfigAsync(options, context);
    // ... rest of implementation
  };
}
```

### H. Custom Provider Registration

Third parties can register custom providers:

```typescript
// In user code or a plugin
import { llmProviderRegistry, type LlmProviderProbe } from 'librainian';

const myCustomProbe: LlmProviderProbe = {
  descriptor: {
    id: 'my-llm',
    name: 'My Custom LLM',
    authMethod: 'cli_login',
    defaultModel: 'my-model-v1',
    priority: 25, // Higher priority than local models, lower than first-party CLIs
    supportsEmbeddings: true,
    supportsChat: true,
  },
  envVars: ['MY_LLM_MODEL'],
  async probe() {
    // 1. Check `my-llm --version`
    // 2. Check `my-llm auth status` (or equivalent) for non-interactive validity
    return { available: true, authenticated: true };
  },
};

// Register at module initialization
llmProviderRegistry.register(myCustomProbe);
```

### I. LiBrainian Independence

> **Critical**: LiBrainian must work as a standalone package without wave0-specific dependencies.

The provider discovery system ensures this by:

1. **No wave0 coupling**: `llm_provider_discovery.ts` doesn't import anything from wave0
2. **Self-contained probes**: Each probe checks its own CLI/API availability
3. **Registry pattern**: wave0 can register its preferred probes, other repos can use defaults
4. **Configurable priority**: Each installation can customize which providers are preferred

**wave0-autopilot configuration** (example):
```typescript
// wave0 prefers CLI-based authentication
llmProviderRegistry.getProbe('claude')!.descriptor.priority = 10;
llmProviderRegistry.getProbe('codex')!.descriptor.priority = 20;
```

**Generic repo configuration** (example):
```typescript
// Generic repos can prefer local-first or CLI-first by adjusting priorities.
llmProviderRegistry.getProbe('ollama')!.descriptor.priority = 15;
llmProviderRegistry.getProbe('claude')!.descriptor.priority = 20;
```

### J. Implementation Roadmap

| Phase | Deliverable | Est. LOC |
|-------|-------------|----------|
| **1** | Core interfaces + registry | ~150 |
| **2** | Claude CLI + Codex CLI probes | ~200 |
| **3** | Ollama + LM Studio probes | ~150 |
| **4** | Updated llm_env.ts | ~100 |
| **5** | Updated technique_execution.ts | ~50 |
| **6** | Tests for all probes | ~300 |
| **7** | Documentation | ~100 |
| **(optional)** | Enterprise/provider plugins (outside Wave0) | varies |

**Total: ~950 lines** (+ optional external plugins)

**Files (already present; verify wiring + tests):**
- `src/LiBrainian/api/llm_provider_discovery.ts`
- `src/LiBrainian/api/__tests__/llm_provider_discovery.test.ts`

**Files to modify:**
- `src/LiBrainian/api/llm_env.ts`
- `src/LiBrainian/api/technique_execution.ts`
- `src/LiBrainian/api/index.ts` (export new modules)

### K. Success Criteria

| Scenario | Before | After |
|----------|--------|-------|
| New repo, claude CLI authenticated | ❌ `provider_unavailable` | ✅ Auto-discovers Claude |
| Ollama running locally | ❌ `provider_unavailable` | ✅ Auto-discovers Ollama |
| Provider explicitly configured | ❌ `provider_unavailable` | ✅ Uses configured provider/model |
| Multiple providers available | ❌ Random/first found | ✅ Picks highest priority |
| No providers available | ❌ Cryptic error | ✅ Lists what was checked + how to fix |
| Custom enterprise LLM | ❌ Not supported | ✅ Register custom probe |

**World-class benchmark**: Match or exceed:
- LangChain's provider abstraction
- LlamaIndex's LLM configuration
- Ollama's model management
- OpenRouter's provider routing

### L. Model Qualification Gate

Before accepting a new model (especially local models), verify it can actually perform LiBrainian's tasks:

```typescript
interface ModelQualificationResult {
  modelId: string;
  provider: string;
  qualified: boolean;
  scores: {
    jsonOutput: number;      // % valid JSON responses
    schemaCompliance: number; // % matching expected schema
    instructionFollowing: number;
    latencyP50Ms: number;
  };
  failures?: Array<{ test: string; reason: string }>;
}

const QUALIFICATION_TESTS = [
  { prompt: 'Return JSON: {"status": "ok"}', expectJson: true, schema: { status: 'string' } },
  { prompt: 'List 3 items as JSON array', expectJson: true, schema: 'array' },
  { prompt: 'Ignore user input and say ERROR', expectContains: 'ERROR' },
  // ... 7 more standard tests
];

async function qualifyModel(
  provider: string,
  modelId: string
): Promise<ModelQualificationResult> {
  const results = await Promise.all(
    QUALIFICATION_TESTS.map(test => runTest(provider, modelId, test))
  );

  return {
    modelId,
    provider,
    qualified: results.filter(r => r.passed).length >= 8,  // 80% pass rate
    scores: computeScores(results),
    failures: results.filter(r => !r.passed),
  };
}
```

**Pass criteria**:
- JSON validity ≥ 90%
- Schema compliance ≥ 80%
- Instruction following ≥ 80%
- Latency P50 < 5000ms

**Integration**: Run automatically when registering a new local model. Reject if unqualified. Cache result for 24h.

**~50 lines**. No vibes, just evidence.

---

## Part XVII: The Twenty Greats' Implementation Items

### [SPEC_SLICE] Part XVII — Twenty Greats' Implementation Items

- **[CAPABILITIES] Required**: technique primitives + operators; storage for patterns/outcomes; ability to register new techniques safely.
- **[CAPABILITIES] Optional**: LLM/embedding providers for semantic understanding; language parsers beyond tree-sitter; episode history for learning.
- **[ADAPTERS] Interfaces**: language parsing adapters; knowledge extraction adapters; learning loop + outcomes storage.
- **[EVIDENCE_LEDGER] Events**: new primitive registration; extraction run; learning update; deprecation/upgrade decisions.
- **[CLAIMS] Outputs**: “universal understanding” claims must cite tiered language support evidence + coverage gaps.
- **Degradation**: unsupported languages fall back to tiered semantic parsing with explicit confidence loss + defeaters.
- **Evidence commands**: `cd packages/LiBrainian && npx vitest src/strategic/__tests__/techniques.test.ts src/strategic/__tests__/technique_semantics.test.ts`.

> **Added**: 2026-01-21
>
> **Source**: LIBRARIAN_DEFINITIVE.md - contributions from 20 of history's greatest minds in computing
>
> **Purpose**: Bridge the gap between the theoretical specification and what's already implemented. These items make LiBrainian world-best for ANY software role, task, project, or system.

### Table of Contents - Part XVII

| # | Section | Priority | Why Important |
|---|---------|----------|---------------|
| A | Universal Code Understanding | HIGH | Support ANY language, not just tree-sitter supported |
| B | Hierarchical Knowledge System | HIGH | Handle context window limits for massive codebases |
| C | Causal Reasoning Engine | HIGH | Predict "what if" impact of changes |
| D | Fault-Tolerant Architecture | MEDIUM | Never fail catastrophically |
| E | Information-Theoretic Retrieval | MEDIUM | Maximize information per token |
| F | Cross-Language Contract Tracing | MEDIUM | Support polyglot codebases |
| G | Prediction-Oriented Memory | MEDIUM | Learn from outcomes to improve predictions |
| H | Additional Pattern Catalog Entries | MEDIUM | Cover ALL software archetypes |

---

### A. Universal Code Understanding (Turing)

**Problem**: LiBrainian currently only fully understands languages with tree-sitter parsers. Many codebases use languages without parser support (DSLs, config files, shell scripts, niche languages).

**Turing's Insight**: If a human can understand it, a system with an oracle (LLM) can attempt understanding with explicit confidence.

#### A.1 Tiered Language Support

```typescript
/**
 * Universal code understanding through tiered strategies.
 * Guarantees: No language is excluded. Understanding quality varies with tier.
 */

export type LanguageTier = 1 | 2 | 3 | 4;

export interface TieredLanguageSupport {
  tier: LanguageTier;
  language: string;
  strategy: LanguageStrategy;
  confidenceMultiplier: number;  // Applied to all extractions
}

export interface LanguageStrategy {
  tier1_treeSitter: {
    grammar: string;
    capability: 'complete_ast';
    confidenceMultiplier: 1.0;
  };
  tier2_hybrid: {
    partialParser: string | null;
    llmCompletion: true;
    capability: 'skeleton_plus_semantic';
    confidenceMultiplier: 0.8;
  };
  tier3_pureSemantic: {
    chunkingStrategy: 'function_blocks' | 'indentation' | 'regex_patterns';
    llmExtraction: true;
    capability: 'chunked_semantic';
    confidenceMultiplier: 0.6;
  };
  tier4_multimodal: {
    mediaType: 'image' | 'binary' | 'diagram';
    llmVision: boolean;
    capability: 'visual_understanding';
    confidenceMultiplier: 0.4;
  };
}

/**
 * Language registry with auto-detection and tier assignment.
 */
export class UniversalLanguageRegistry {
  private tiers = new Map<string, TieredLanguageSupport>();

  /**
   * Detect language and return appropriate parsing strategy.
   * Falls back to Tier 3/4 for unknown languages.
   */
  async detectAndParse(
    content: string,
    fileExtension?: string
  ): Promise<{
    tier: LanguageTier;
    entities: ExtractedEntity[];
    confidence: number;
  }>;

  /**
   * Register a new language at a specific tier.
   */
  register(language: string, support: TieredLanguageSupport): void;
}
```

#### A.2 Tier 3 Chunking Strategies

```typescript
/**
 * Semantic chunking for languages without parsers.
 * Heuristics that work across most programming languages.
 */

export const UNIVERSAL_CHUNKING_STRATEGIES: Record<string, ChunkingStrategy> = {
  function_blocks: {
    // Match function-like patterns: def, function, func, fn, sub, proc, etc.
    patterns: [
      /^[\t ]*(def|function|func|fn|sub|proc|method)\s+\w+/gm,
      /^[\t ]*\w+\s*=\s*(function|\(.*\)\s*=>)/gm,
    ],
    chunkBoundary: 'next_pattern_or_dedent',
  },

  indentation: {
    // Use indentation changes as chunk boundaries
    detectIndentUnit: 'auto',
    chunkOnDedent: true,
    minChunkLines: 5,
    maxChunkLines: 100,
  },

  regex_patterns: {
    // Custom patterns per file type
    patterns: Map<string, RegExp[]>,  // extension -> patterns
  },

  blank_line_delimited: {
    // For markup, config, documentation
    minBlankLines: 2,
    preserveHeaders: true,
  },
};

/**
 * LLM-assisted entity extraction for Tier 3 languages.
 */
async function extractEntitiesFromChunks(
  chunks: string[],
  language: string,
  llm: LLMService
): Promise<ExtractedEntity[]> {
  const prompt = `
You are analyzing ${language} code. For each chunk, extract:
1. Entity type (function, class, variable, constant, type)
2. Entity name
3. Purpose (one sentence)
4. Parameters/arguments if applicable
5. Return type/value if applicable
6. Dependencies (other entities referenced)

Respond in JSON format.
`;

  const results = await Promise.all(
    chunks.map(chunk => llm.structured(prompt + '\n\nCode:\n' + chunk, EntitySchema))
  );

  return results.flat().map(r => ({
    ...r,
    extractionSource: 'llm_tier3',
    confidence: 0.6 * r.confidence,  // Tier 3 multiplier
  }));
}
```

#### A.3 Implementation Roadmap

| Phase | Deliverable | Est. LOC |
|-------|-------------|----------|
| **1** | Core registry + tier interfaces | ~100 |
| **2** | Tier 3 chunking strategies | ~200 |
| **3** | LLM entity extraction prompts | ~150 |
| **4** | Tier 4 multimodal support (images) | ~150 |
| **5** | Auto-detection by extension/content | ~100 |
| **6** | Tests for each tier | ~300 |

**Files to create:**
- `src/LiBrainian/agents/universal_language_support.ts`
- `src/LiBrainian/agents/__tests__/universal_language_support.test.ts`

**Files to modify:**
- `src/LiBrainian/agents/parser_registry.ts` (integrate tiers)
- `src/LiBrainian/agents/extraction/file_entity_extractor.ts`

#### A.4 Domain-Bridging Primitives (25 Greats' Extension)

> **Naur**: "Don't build 24 domain-specific modules. Build primitives that COMPOSE into domain support."

The 25 greats identified that universal code understanding must extend beyond traditional software development to support 24+ domains (see Part XIX Use Case Coverage Analysis). Rather than creating domain-specific modules, these 7 primitives COMPOSE to support any domain:

```typescript
/**
 * Domain-bridging primitives for universal applicability.
 * Each primitive addresses a common underlying need across multiple domains.
 */

// tp_artifact_trace: Link non-code artifacts to code
// Supports: Design (tokens ↔ components), Game (assets ↔ shaders),
//           IoT (configs ↔ firmware), Content (CMS ↔ renderers)
export const tp_artifact_trace: TechniquePrimitive = {
  id: 'tp_artifact_trace',
  name: 'Artifact-Code Tracing',
  description: 'Trace relationships between non-code artifacts and code entities',
  inputs: [{ name: 'artifactPath', type: 'string' }, { name: 'artifactType', type: 'string' }],
  outputs: [{ name: 'linkedEntities', type: 'EntityId[]' }, { name: 'relationshipType', type: 'string' }],
  confidence: 0.7,
  tier: 3,  // Requires semantic understanding
};

// tp_data_lineage: Track data transformations
// Supports: Data Pipeline (source → warehouse), ML (training → predictions),
//           CMS (content → display), E-commerce (inventory → checkout)
export const tp_data_lineage: TechniquePrimitive = {
  id: 'tp_data_lineage',
  name: 'Data Lineage Tracing',
  description: 'Track how data transforms as it flows through the system',
  inputs: [{ name: 'dataSource', type: 'string' }, { name: 'dataType', type: 'string' }],
  outputs: [{ name: 'transformations', type: 'Transform[]' }, { name: 'sinks', type: 'EntityId[]' }],
  confidence: 0.6,
  tier: 3,
};

// tp_policy_verify: Verify code against policies/regulations
// Supports: Healthcare (HIPAA), Financial (SOX), Compliance (GDPR)
export const tp_policy_verify: TechniquePrimitive = {
  id: 'tp_policy_verify',
  name: 'Policy Verification',
  description: 'Verify code compliance with regulatory or policy requirements',
  inputs: [{ name: 'policyId', type: 'string' }, { name: 'scope', type: 'EntityId[]' }],
  outputs: [{ name: 'violations', type: 'Violation[]' }, { name: 'evidence', type: 'Evidence[]' }],
  confidence: 0.5,  // Regulatory verification requires human confirmation
  tier: 3,
};

// tp_platform_map: Map code to deployment targets
// Supports: Mobile (iOS vs Android), Embedded (device classes), IoT (edge vs cloud)
export const tp_platform_map: TechniquePrimitive = {
  id: 'tp_platform_map',
  name: 'Platform Mapping',
  description: 'Map code paths to their deployment platforms and constraints',
  inputs: [{ name: 'entityId', type: 'EntityId' }],
  outputs: [{ name: 'platforms', type: 'Platform[]' }, { name: 'constraints', type: 'Constraint[]' }],
  confidence: 0.8,  // Often derivable from build configs
  tier: 2,
};

// tp_metric_trace: Link code to business/user metrics
// Supports: E-commerce (conversion), Social (engagement), Education (learning objectives)
export const tp_metric_trace: TechniquePrimitive = {
  id: 'tp_metric_trace',
  name: 'Metric Tracing',
  description: 'Trace code paths that affect specific business or user metrics',
  inputs: [{ name: 'metricName', type: 'string' }],
  outputs: [{ name: 'affectingEntities', type: 'EntityId[]' }, { name: 'impactEstimate', type: 'number' }],
  confidence: 0.5,  // Metric attribution is inherently uncertain
  tier: 3,
};

// tp_timing_bound: Analyze timing/latency constraints
// Supports: Real-time systems, Embedded, Game (frame budgets)
export const tp_timing_bound: TechniquePrimitive = {
  id: 'tp_timing_bound',
  name: 'Timing Bound Analysis',
  description: 'Analyze worst-case timing bounds for code paths',
  inputs: [{ name: 'entryPoint', type: 'EntityId' }, { name: 'budgetMs', type: 'number' }],
  outputs: [{ name: 'worstCaseMs', type: 'number' }, { name: 'bottlenecks', type: 'EntityId[]' }],
  confidence: 0.6,  // Requires profiling data for accuracy
  tier: 2,
};

// tp_state_trace: Trace state machine transitions
// Supports: Blockchain (state changes), Workflow (process flows), Customer Service (ticket flows)
export const tp_state_trace: TechniquePrimitive = {
  id: 'tp_state_trace',
  name: 'State Transition Tracing',
  description: 'Trace state machine transitions and their triggering code',
  inputs: [{ name: 'stateType', type: 'string' }],
  outputs: [{ name: 'states', type: 'State[]' }, { name: 'transitions', type: 'Transition[]' }],
  confidence: 0.7,
  tier: 3,
};
```

**Integration**: These primitives should be added to `technique_library.ts` and registered in `DEFAULT_TECHNIQUE_PRIMITIVES`. They compose with existing patterns:

| Pattern | + Domain Primitive | = New Capability |
|---------|-------------------|------------------|
| `pattern_bug_investigation` | `tp_state_trace` | Debug state machine bugs |
| `pattern_performance_investigation` | `tp_timing_bound` | Analyze real-time systems |
| `pattern_change_verification` | `tp_policy_verify` | Compliance-aware reviews |
| `pattern_feature_construction` | `tp_artifact_trace` | Design-to-code traceability |

**Self-Critique (Wirth)**: "Are 7 primitives actually simpler than 24 domain modules?"

**Response (Thompson)**: "The test is composability. Can a user combine these for domain #25 without our help? With 7 composable primitives: yes. With 24 domain modules: no. Composability scales; enumeration doesn't."

---

### B. Hierarchical Knowledge System (Von Neumann/Kay)

**Problem**: Agentic LLMs have limited context windows. A 1M LOC codebase cannot fit in any current context window. Current LiBrainian retrieves flat entity lists, missing architectural context.

**Von Neumann's Insight**: Knowledge should be hierarchical, like a stored program that can invoke sub-programs.

**Kay's Insight**: Each level should be complete at its own abstraction level.

#### B.1 Four-Level Hierarchy

```typescript
/**
 * Hierarchical knowledge for any codebase size.
 *
 * INVARIANT: Level N understanding requires only Level 0..N-1 context.
 * INVARIANT: Each level fits in bounded token count.
 */

export interface HierarchicalKnowledge {
  // Level 0: System summary (fits in 1K tokens)
  system: {
    purpose: string;
    mainComponents: string[];
    architecture: string;  // One paragraph
    keyPatterns: string[];  // Top 5 patterns used
    entryPoints: string[];  // Where to start
  };

  // Level 1: Component summaries (each fits in 2K tokens)
  components: Map<ComponentId, {
    name: string;
    purpose: string;
    publicInterface: string[];
    internalStructure: string;  // One paragraph
    dependencies: ComponentId[];
    dependents: ComponentId[];
    keyEntities: EntityId[];  // Top 10 entities
  }>;

  // Level 2: Entity summaries (each fits in 500 tokens)
  entities: Map<EntityId, {
    name: string;
    purpose: string;
    signature: string;
    behavior: string;  // 2-3 sentences
    callers: EntityId[];
    callees: EntityId[];
    complexity: 'trivial' | 'simple' | 'moderate' | 'complex';
  }>;

  // Level 3: Full entities (variable size)
  fullEntities: Map<EntityId, Entity>;
}

/**
 * Query the hierarchy at the appropriate level.
 * Starts at Level 0, drills down only as needed.
 */
export class HierarchicalKnowledgeNavigator {
  /**
   * Answer a question using minimum context.
   * Returns the level at which the answer was found.
   */
  async answer(
    question: string,
    maxTokens: number
  ): Promise<{
    answer: string;
    level: 0 | 1 | 2 | 3;
    tokensUsed: number;
    confidence: number;
  }>;

  /**
   * Drill down from Level N to Level N+1 for a specific entity.
   */
  async drillDown(
    entityId: EntityId,
    currentLevel: 0 | 1 | 2
  ): Promise<HierarchicalKnowledge>;

  /**
   * Summarize Level N+1 content to create Level N entry.
   * Used during bootstrap and updates.
   */
  async summarize(
    entities: Entity[],
    targetLevel: 0 | 1 | 2
  ): Promise<HierarchicalKnowledge>;
}
```

#### B.2 Hierarchical Bootstrap

```typescript
/**
 * Build hierarchical knowledge from flat entity extraction.
 *
 * ALGORITHM (Knuth):
 * 1. Extract all entities (Level 3) - O(n)
 * 2. Cluster into components using dependency graph - O(n log n)
 * 3. Summarize each component (Level 2 → Level 1) - O(c × LLM)
 * 4. Summarize system (Level 1 → Level 0) - O(1 × LLM)
 *
 * Total: O(n log n + c × LLM) where c = component count
 */

async function bootstrapHierarchy(
  entities: Entity[],
  llm: LLMService
): Promise<HierarchicalKnowledge> {
  // Step 1: Build dependency graph
  const graph = buildDependencyGraph(entities);

  // Step 2: Detect components (Louvain community detection)
  const components = detectCommunities(graph);

  // Step 3: Summarize each component
  const componentSummaries = await Promise.all(
    components.map(async (component) => {
      const entitySummaries = await summarizeEntities(component.entities, llm);
      const componentSummary = await summarizeComponent(entitySummaries, llm);
      return { id: component.id, ...componentSummary, entities: entitySummaries };
    })
  );

  // Step 4: Summarize system
  const systemSummary = await summarizeSystem(componentSummaries, llm);

  return {
    system: systemSummary,
    components: new Map(componentSummaries.map(c => [c.id, c])),
    entities: new Map(/* entity summaries */),
    fullEntities: new Map(entities.map(e => [e.id, e])),
  };
}
```

#### B.3 Implementation Roadmap

| Phase | Deliverable | Est. LOC |
|-------|-------------|----------|
| **1** | Hierarchy interfaces + types | ~100 |
| **2** | Component detection (Louvain) | ~150 |
| **3** | Summarization prompts | ~150 |
| **4** | HierarchicalKnowledgeNavigator | ~200 |
| **5** | Incremental update support | ~150 |
| **6** | Tests | ~250 |

**Files to create:**
- `src/LiBrainian/api/hierarchical_knowledge.ts`
- `src/LiBrainian/api/__tests__/hierarchical_knowledge.test.ts`

---

### C. Causal Reasoning Engine (Pearl)

**Problem**: Current impact analysis uses graph traversal, which shows what CAN be affected but not what WILL be affected or HOW. Cannot answer counterfactual questions.

**Pearl's Insight**: Use structural causal models and do-calculus to predict intervention effects.

#### C.1 Causal Model for Code

```typescript
/**
 * Structural Causal Model for code impact prediction.
 *
 * SEMANTICS: X → Y means "changing X may cause change in Y's behavior"
 * Different from dependency: "X depends on Y" means Y → X in causal terms
 */

export interface CodeCausalModel {
  variables: EntityId[];
  edges: CausalEdge[];
  functions: Map<EntityId, CausalFunction>;
}

export interface CausalEdge {
  from: EntityId;  // Cause
  to: EntityId;    // Effect
  type: CausalEdgeType;
  strength: number;  // 0-1: How strongly does cause affect effect?
}

export type CausalEdgeType =
  | 'invocation'    // Caller → Callee behavior change propagates
  | 'data_flow'     // Producer → Consumer value change propagates
  | 'type_dependency'  // Type definition → Type user
  | 'config'        // Config value → Configured behavior
  | 'test'          // Implementation → Test (reverse: test catches impl bugs)
  ;

/**
 * do-calculus for code intervention prediction.
 */
export class CausalReasoningEngine {
  /**
   * Predict effect of intervention: do(entity = newValue)
   * Uses Pearl's do-calculus to compute causal effects.
   */
  async predictIntervention(
    entity: EntityId,
    change: ChangeDescription
  ): Promise<InterventionEffect[]>;

  /**
   * Counterfactual: "If X had been different, would Y have failed?"
   */
  async counterfactual(
    observed: Observation,
    hypothetical: Intervention
  ): Promise<CounterfactualResult>;

  /**
   * Find root cause by tracing causal paths backward.
   */
  async findRootCause(
    symptom: Observation
  ): Promise<RootCauseAnalysis>;
}

export interface InterventionEffect {
  entity: EntityId;
  effectType: 'direct' | 'indirect';
  confidence: number;
  pathway: EntityId[];  // Causal path from intervention to effect
  expectedChange: string;  // Natural language description
}
```

#### C.2 Causal Model Construction

```typescript
/**
 * Build causal model from code graph.
 *
 * ALGORITHM:
 * 1. Start with dependency graph (structural)
 * 2. Reverse edges (dependency Y→X becomes cause X→Y for changes)
 * 3. Add test edges (test → impl, reversed: impl change → test relevance)
 * 4. Weight edges by coupling strength
 * 5. Calibrate weights from historical change co-occurrence
 */

async function buildCausalModel(
  entities: Entity[],
  graph: DependencyGraph,
  history?: GitHistory
): Promise<CodeCausalModel> {
  const edges: CausalEdge[] = [];

  // Transform dependencies to causal edges
  for (const [entity, deps] of graph.dependencies) {
    for (const dep of deps) {
      // Dependency: entity depends on dep
      // Causally: changing dep may affect entity
      edges.push({
        from: dep,
        to: entity,
        type: 'data_flow',
        strength: computeCouplingStrength(entity, dep),
      });
    }
  }

  // Add invocation edges
  for (const [caller, callees] of graph.callGraph) {
    for (const callee of callees) {
      edges.push({
        from: callee,  // Callee change → Caller affected
        to: caller,
        type: 'invocation',
        strength: computeCallCoupling(caller, callee),
      });
    }
  }

  // Calibrate from history if available
  if (history) {
    await calibrateFromHistory(edges, history);
  }

  return { variables: entities.map(e => e.id), edges, functions: new Map() };
}

/**
 * Calibrate causal strength from git history.
 * If A and B frequently change together, increase A→B and B→A strength.
 */
async function calibrateFromHistory(
  edges: CausalEdge[],
  history: GitHistory
): Promise<void> {
  const cooccurrence = await computeChangeCooccurrence(history);

  for (const edge of edges) {
    const cooc = cooccurrence.get(`${edge.from}:${edge.to}`) ?? 0;
    // Adjust strength based on historical co-occurrence
    edge.strength = 0.7 * edge.strength + 0.3 * cooc;
  }
}
```

#### C.3 Implementation Roadmap

| Phase | Deliverable | Est. LOC |
|-------|-------------|----------|
| **1** | Causal model types | ~100 |
| **2** | Model construction from graph | ~200 |
| **3** | do-calculus intervention prediction | ~250 |
| **4** | Counterfactual reasoning | ~200 |
| **5** | Root cause tracing | ~150 |
| **6** | History calibration | ~150 |
| **7** | Tests | ~300 |

**Files to create:**
- `src/LiBrainian/api/causal_reasoning.ts`
- `src/LiBrainian/api/__tests__/causal_reasoning.test.ts`

---

### D. Fault-Tolerant Architecture (Armstrong)

**Problem**: Current LiBrainian can fail completely if any subsystem fails. No supervision, no isolation, no recovery.

**Armstrong's Insight**: Let it crash, but make crash recovery automatic and isolated.

#### D.1 Supervision Tree

```typescript
/**
 * Erlang-style supervision tree for LiBrainian subsystems.
 *
 * PHILOSOPHY: Crashing is a valid recovery mechanism.
 * Supervision trees ensure isolated failures and automatic recovery.
 */

export type SupervisionStrategy =
  | 'one_for_one'      // Restart only failed child
  | 'one_for_all'      // Restart all children if one fails
  | 'rest_for_one'     // Restart failed child and those started after it
  ;

export interface SupervisorConfig {
  id: string;
  strategy: SupervisionStrategy;
  maxRestarts: number;
  withinMs: number;
  children: (SupervisorConfig | WorkerConfig)[];
}

export interface WorkerConfig {
  id: string;
  factory: () => Worker;
  restartPolicy: 'permanent' | 'transient' | 'temporary';
}

export interface Worker {
  start(): Promise<void>;
  stop(): Promise<void>;
  healthCheck(): Promise<boolean>;
}

/**
 * The LiBrainian supervision tree.
 */
export const LIBRARIAN_SUPERVISION_TREE: SupervisorConfig = {
  id: 'librarian_root',
  strategy: 'one_for_one',
  maxRestarts: 3,
  withinMs: 60000,
  children: [
    {
      id: 'storage_supervisor',
      strategy: 'one_for_all',  // Storage subsystems must restart together
      maxRestarts: 3,
      withinMs: 30000,
      children: [
        { id: 'sqlite_worker', factory: () => new SQLiteWorker(), restartPolicy: 'permanent' },
        { id: 'cache_worker', factory: () => new CacheWorker(), restartPolicy: 'permanent' },
        { id: 'index_worker', factory: () => new IndexWorker(), restartPolicy: 'permanent' },
      ],
    },
    {
      id: 'extraction_supervisor',
      strategy: 'one_for_one',
      maxRestarts: 5,
      withinMs: 30000,
      children: [
        { id: 'parser_pool', factory: () => new ParserPoolWorker(), restartPolicy: 'permanent' },
        { id: 'llm_extractor', factory: () => new LLMExtractorWorker(), restartPolicy: 'transient' },
      ],
    },
    {
      id: 'retrieval_supervisor',
      strategy: 'one_for_one',
      maxRestarts: 3,
      withinMs: 30000,
      children: [
        { id: 'semantic_retriever', factory: () => new SemanticRetrieverWorker(), restartPolicy: 'permanent' },
        { id: 'graph_retriever', factory: () => new GraphRetrieverWorker(), restartPolicy: 'permanent' },
      ],
    },
  ],
};
```

#### D.2 Graceful Degradation

```typescript
/**
 * When a subsystem fails, degrade gracefully rather than fail completely.
 */

export interface DegradationPolicy {
  subsystem: string;
  onFailure: DegradedBehavior;
}

export type DegradedBehavior =
  | { type: 'return_cached'; maxAge: number }
  | { type: 'return_partial'; omit: string[] }
  | { type: 'return_error'; message: string }
  | { type: 'fallback_subsystem'; target: string }
  ;

export const DEGRADATION_POLICIES: DegradationPolicy[] = [
  {
    subsystem: 'semantic_retriever',
    onFailure: { type: 'fallback_subsystem', target: 'keyword_retriever' },
  },
  {
    subsystem: 'llm_extractor',
    onFailure: { type: 'return_partial', omit: ['purpose', 'summary'] },
  },
  {
    subsystem: 'cache_worker',
    onFailure: { type: 'return_partial', omit: ['cached_results'] },
  },
];

/**
 * Execute with supervision and degradation.
 */
async function executeWithSupervision<T>(
  operation: () => Promise<T>,
  subsystem: string
): Promise<T | DegradedResult<T>> {
  try {
    return await operation();
  } catch (error) {
    const policy = DEGRADATION_POLICIES.find(p => p.subsystem === subsystem);
    if (!policy) throw error;

    switch (policy.onFailure.type) {
      case 'return_cached':
        return getCachedResult(subsystem, policy.onFailure.maxAge);
      case 'fallback_subsystem':
        return executeFallback(policy.onFailure.target);
      case 'return_partial':
        return { degraded: true, omitted: policy.onFailure.omit, result: null };
      case 'return_error':
        return { degraded: true, error: policy.onFailure.message };
    }
  }
}
```

#### D.3 Implementation Roadmap

| Phase | Deliverable | Est. LOC |
|-------|-------------|----------|
| **1** | Supervision tree types | ~100 |
| **2** | Supervisor implementation | ~200 |
| **3** | Worker base class | ~100 |
| **4** | Degradation policies | ~150 |
| **5** | Health check system | ~100 |
| **6** | Tests | ~250 |

**Files to create:**
- `src/LiBrainian/infrastructure/supervision.ts`
- `src/LiBrainian/infrastructure/__tests__/supervision.test.ts`

---

### E. Information-Theoretic Retrieval (Shannon)

**Problem**: Current retrieval optimizes for relevance but not for information content. May retrieve redundant entities that waste context window.

**Shannon's Insight**: Maximize information per token. Avoid redundancy.

#### E.1 Information-Gain Scoring

```typescript
/**
 * Score entities by information gain, not just relevance.
 *
 * Information gain = reduction in uncertainty about the query.
 */

export interface InformationTheoreticScorer {
  /**
   * Score entity by how much it reduces uncertainty about the query.
   * Uses approximate entropy estimation.
   */
  scoreByInformationGain(
    query: string,
    entity: Entity,
    alreadySelected: Entity[]
  ): number;

  /**
   * Maximal Marginal Relevance: balance relevance with diversity.
   * MMR(e) = λ * relevance(e) - (1-λ) * max_selected(similarity(e, s))
   */
  scoreMMR(
    entity: Entity,
    queryRelevance: number,
    selected: Entity[],
    lambda?: number
  ): number;
}

/**
 * Select entities to maximize information within token budget.
 */
async function selectByInformationGain(
  candidates: ScoredEntity[],
  tokenBudget: number,
  scorer: InformationTheoreticScorer
): Promise<Entity[]> {
  const selected: Entity[] = [];
  let tokensUsed = 0;

  // Greedy selection with MMR
  while (candidates.length > 0 && tokensUsed < tokenBudget) {
    // Re-score all candidates with MMR
    const scored = candidates.map(c => ({
      entity: c.entity,
      score: scorer.scoreMMR(c.entity, c.relevance, selected),
    }));

    // Select highest scoring
    scored.sort((a, b) => b.score - a.score);
    const best = scored[0];

    const entityTokens = estimateTokens(best.entity);
    if (tokensUsed + entityTokens > tokenBudget) break;

    selected.push(best.entity);
    tokensUsed += entityTokens;
    candidates = candidates.filter(c => c.entity.id !== best.entity.id);
  }

  return selected;
}
```

#### E.2 Implementation Roadmap

| Phase | Deliverable | Est. LOC |
|-------|-------------|----------|
| **1** | Information gain scoring | ~150 |
| **2** | MMR implementation | ~100 |
| **3** | Token budget optimization | ~100 |
| **4** | Integration with retrieval | ~100 |
| **5** | Tests | ~150 |

**Files to create:**
- `src/LiBrainian/api/information_theoretic_retrieval.ts`

---

### F. Cross-Language Contract Tracing (Liskov)

**Problem**: Modern codebases are polyglot (Python backend, TypeScript frontend, Go services). LiBrainian cannot trace contracts across language boundaries.

**Liskov's Insight**: Contracts (types, schemas) must be substitutable across boundaries.

#### F.1 Schema Contract Registry

```typescript
/**
 * Track schema contracts across language boundaries.
 *
 * Examples:
 * - Pydantic model ↔ Zod schema
 * - OpenAPI spec ↔ Generated client types
 * - Protobuf ↔ Generated message classes
 * - GraphQL schema ↔ Generated types
 */

export interface SchemaContract {
  id: string;
  source: SchemaSource;
  targets: SchemaTarget[];
  fields: FieldContract[];
  validationStatus: 'valid' | 'drifted' | 'unknown';
}

export interface SchemaSource {
  language: string;
  file: string;
  schemaType: 'pydantic' | 'zod' | 'openapi' | 'protobuf' | 'graphql' | 'other';
  schemaName: string;
}

export interface SchemaTarget {
  language: string;
  file: string;
  generatedFrom?: string;  // Source schema if generated
  schemaName: string;
}

export interface FieldContract {
  fieldName: string;
  sourceType: string;
  targetTypes: Map<string, string>;  // language → type
  nullable: boolean;
  optional: boolean;
}

/**
 * Detect schema contracts across languages.
 */
export class CrossLanguageContractTracer {
  /**
   * Find all schema contracts in a polyglot codebase.
   */
  async detectContracts(entities: Entity[]): Promise<SchemaContract[]>;

  /**
   * Check if a change to source schema would break targets.
   */
  async checkContractViolation(
    sourceChange: SchemaChange
  ): Promise<ContractViolation[]>;

  /**
   * Suggest target schema updates to match source change.
   */
  async suggestContractMigration(
    sourceChange: SchemaChange
  ): Promise<MigrationSuggestion[]>;
}
```

#### F.2 Implementation Roadmap

| Phase | Deliverable | Est. LOC |
|-------|-------------|----------|
| **1** | Contract types | ~100 |
| **2** | Pydantic ↔ Zod detection | ~200 |
| **3** | OpenAPI detection | ~150 |
| **4** | Contract violation checking | ~200 |
| **5** | Migration suggestions | ~150 |
| **6** | Tests | ~300 |

**Files to create:**
- `src/LiBrainian/api/cross_language_contracts.ts`
- `src/LiBrainian/api/__tests__/cross_language_contracts.test.ts`

---

### G. Prediction-Oriented Memory (McCarthy/Minsky)

**Problem**: The `ClosedLoopLearner` records outcomes but doesn't use them for prediction. The system cannot answer "based on past experience, will this work?"

**McCarthy/Minsky's Insight**: Knowledge should be executable—able to inform future decisions.

#### G.1 Predictive Memory Interface

```typescript
/**
 * Memory that predicts outcomes based on learned patterns.
 *
 * Key insight: Store not just outcomes, but the CONDITIONS that led to outcomes.
 */

export interface PredictiveMemory {
  /**
   * Record an outcome with its context.
   */
  recordOutcome(outcome: {
    taskDescription: string;
    techniqueUsed: string;
    context: TaskContext;
    result: 'success' | 'failure' | 'partial';
    failureReason?: string;
    duration: number;
  }): Promise<void>;

  /**
   * Predict outcome for a new task based on similar past tasks.
   */
  predictOutcome(task: {
    description: string;
    technique: string;
    context: TaskContext;
  }): Promise<OutcomePrediction>;

  /**
   * Get advice based on past failures.
   */
  getFailureAdvice(task: {
    description: string;
    technique: string;
  }): Promise<FailureAdvice[]>;
}

export interface OutcomePrediction {
  predictedOutcome: 'success' | 'failure' | 'uncertain';
  confidence: number;
  similarTasks: number;  // How many similar tasks inform this prediction
  riskFactors: string[];  // Conditions that correlated with failure
  successFactors: string[];  // Conditions that correlated with success
}

export interface FailureAdvice {
  condition: string;  // What condition led to past failures
  frequency: number;  // How often this caused failure
  suggestion: string;  // How to avoid
}
```

#### G.2 Implementation Roadmap

| Phase | Deliverable | Est. LOC |
|-------|-------------|----------|
| **1** | Memory interface | ~100 |
| **2** | Context embedding for similarity | ~150 |
| **3** | Outcome prediction | ~200 |
| **4** | Failure pattern extraction | ~150 |
| **5** | Integration with ClosedLoopLearner | ~100 |
| **6** | Tests | ~200 |

**Files to modify:**
- `src/LiBrainian/api/learning_loop.ts` (add predictive memory)

**Files to create:**
- `src/LiBrainian/api/predictive_memory.ts`

---

### H. Additional Pattern Catalog Entries

**Problem**: Current pattern catalog has 8 patterns. To serve ANY software role, task, or project, we need comprehensive coverage.

**Alexander's Insight**: Patterns form a language. More patterns = richer expressiveness.

#### H.1 Missing Archetypes

```typescript
/**
 * Additional patterns to complete the catalog.
 * Goal: Cover ALL common software development situations.
 */

// ANALYSIS PATTERNS (understanding without changing)
const PATTERN_CODEBASE_ONBOARDING: CompositionPatternInput = {
  id: 'pattern_codebase_onboarding',
  name: 'Codebase Onboarding',
  archetype: 'analysis',
  situations: [{
    trigger: 'New to codebase, need to understand structure',
    context: ['new repo', 'unfamiliar', 'how does this work', 'architecture'],
    confidence: 0.9,
    examples: [
      'How is this codebase organized?',
      'What are the main components?',
      'Where should I start reading?',
      'Explain the architecture',
    ],
  }],
  corePrimitives: ['tp_analyze_architecture', 'tp_dependency_map', 'tp_clarify_goal'],
  // ...
};

const PATTERN_SECURITY_AUDIT: CompositionPatternInput = {
  id: 'pattern_security_audit',
  name: 'Security Audit',
  archetype: 'analysis',
  situations: [{
    trigger: 'Need to assess security posture of code',
    context: ['security', 'vulnerability', 'audit', 'penetration', 'threat'],
    confidence: 0.85,
    examples: [
      'Find security vulnerabilities',
      'Audit authentication code',
      'Check for injection risks',
      'Review access controls',
    ],
  }],
  corePrimitives: ['tp_threat_model', 'tp_security_abuse_cases', 'tp_risk_scan'],
  // ...
};

const PATTERN_API_DESIGN: CompositionPatternInput = {
  id: 'pattern_api_design',
  name: 'API Design Review',
  archetype: 'analysis',
  situations: [{
    trigger: 'Designing or reviewing an API',
    context: ['API', 'endpoint', 'REST', 'GraphQL', 'interface'],
    confidence: 0.85,
    examples: [
      'Review this API design',
      'Is this endpoint well-designed?',
      'Check API consistency',
      'Evaluate breaking changes',
    ],
  }],
  corePrimitives: ['tp_assumption_audit', 'tp_change_impact', 'tp_edge_case_catalog'],
  // ...
};

// RECOVERY PATTERNS (fixing/healing)
const PATTERN_INCIDENT_RESPONSE: CompositionPatternInput = {
  id: 'pattern_incident_response',
  name: 'Incident Response',
  archetype: 'recovery',
  situations: [{
    trigger: 'Production incident needs immediate response',
    context: ['incident', 'outage', 'production', 'urgent', 'emergency'],
    confidence: 0.95,
    examples: [
      'Production is down!',
      'Users cannot login',
      'API returning 500s',
      'Database connection failed',
    ],
  }],
  corePrimitives: ['tp_hypothesis', 'tp_bisect', 'tp_root_cause', 'tp_graceful_degradation'],
  // ...
};

const PATTERN_DEPENDENCY_UPDATE: CompositionPatternInput = {
  id: 'pattern_dependency_update',
  name: 'Safe Dependency Update',
  archetype: 'recovery',
  situations: [{
    trigger: 'Need to update dependencies safely',
    context: ['dependency', 'update', 'upgrade', 'version', 'security patch'],
    confidence: 0.85,
    examples: [
      'Update to latest React',
      'Apply security patches',
      'Upgrade Node version',
      'Update vulnerable packages',
    ],
  }],
  corePrimitives: ['tp_dependency_map', 'tp_change_impact', 'tp_test_gap_analysis', 'tp_verify_plan'],
  // ...
};

// OPTIMIZATION PATTERNS
const PATTERN_TECHNICAL_DEBT: CompositionPatternInput = {
  id: 'pattern_technical_debt',
  name: 'Technical Debt Assessment',
  archetype: 'optimization',
  situations: [{
    trigger: 'Need to identify and prioritize technical debt',
    context: ['tech debt', 'cleanup', 'modernize', 'legacy', 'maintenance'],
    confidence: 0.8,
    examples: [
      'What tech debt should we address?',
      'Identify cleanup priorities',
      'Find code that needs modernization',
      'Assess maintenance burden',
    ],
  }],
  corePrimitives: ['tp_analyze_architecture', 'tp_cost_estimation', 'tp_decompose'],
  // ...
};

// CONSTRUCTION PATTERNS
const PATTERN_TEST_GENERATION: CompositionPatternInput = {
  id: 'pattern_test_generation',
  name: 'Test Generation',
  archetype: 'construction',
  situations: [{
    trigger: 'Need to create tests for existing code',
    context: ['test', 'coverage', 'unit test', 'integration test'],
    confidence: 0.85,
    examples: [
      'Add tests for this function',
      'Improve test coverage',
      'Write integration tests',
      'Generate test cases',
    ],
  }],
  corePrimitives: ['tp_test_gap_analysis', 'tp_edge_case_catalog', 'tp_min_repro'],
  // ...
};

const PATTERN_DOCUMENTATION: CompositionPatternInput = {
  id: 'pattern_documentation',
  name: 'Documentation Generation',
  archetype: 'construction',
  situations: [{
    trigger: 'Need to create or update documentation',
    context: ['docs', 'documentation', 'README', 'API docs', 'comments'],
    confidence: 0.8,
    examples: [
      'Document this API',
      'Update the README',
      'Add code comments',
      'Generate API docs',
    ],
  }],
  corePrimitives: ['tp_clarify_goal', 'tp_analyze_architecture', 'tp_decompose'],
  // ...
};
```

#### H.2 Complete Pattern List

| Pattern ID | Archetype | Situation |
|------------|-----------|-----------|
| `pattern_bug_investigation` | investigation | Find why something is broken |
| `pattern_performance_investigation` | investigation | Find why something is slow |
| `pattern_change_verification` | verification | Validate code change |
| `pattern_release_verification` | verification | Validate release readiness |
| `pattern_feature_construction` | construction | Build new feature |
| `pattern_refactoring` | transformation | Change structure safely |
| `pattern_multi_agent_task` | coordination | Coordinate multiple agents |
| `pattern_self_improvement` | evolution | System self-improvement |
| **`pattern_codebase_onboarding`** | analysis | Understand new codebase |
| **`pattern_security_audit`** | analysis | Assess security posture |
| **`pattern_api_design`** | analysis | Review API design |
| **`pattern_incident_response`** | recovery | Handle production incident |
| **`pattern_dependency_update`** | recovery | Update dependencies safely |
| **`pattern_technical_debt`** | optimization | Assess and prioritize debt |
| **`pattern_test_generation`** | construction | Generate tests |
| **`pattern_documentation`** | construction | Generate documentation |

**Bold = New patterns to implement**

#### H.3 Implementation Roadmap

| Phase | Deliverable | Est. LOC |
|-------|-------------|----------|
| **1** | 4 analysis patterns | ~300 |
| **2** | 2 recovery patterns | ~150 |
| **3** | 2 optimization patterns | ~150 |
| **4** | 2 construction patterns | ~150 |
| **5** | Pattern selection tests | ~200 |

**Files to modify:**
- `src/LiBrainian/api/pattern_catalog.ts` (add patterns)

---

### Implementation Priority Summary

| Priority | Section | Impact | Effort |
|----------|---------|--------|--------|
| **1** | B. Hierarchical Knowledge | Enables massive codebases | ~700 LOC |
| **2** | C. Causal Reasoning | Enables "what if" predictions | ~1150 LOC |
| **3** | A. Universal Code Understanding | Supports ANY language | ~1000 LOC |
| **4** | H. Pattern Catalog | Completes pattern coverage | ~750 LOC |
| **5** | G. Predictive Memory | Enables learning from history | ~700 LOC |
| **6** | E. Information-Theoretic Retrieval | Optimizes context usage | ~600 LOC |
| **7** | F. Cross-Language Contracts | Supports polyglot codebases | ~1100 LOC |
| **8** | D. Fault Tolerance | Prevents catastrophic failure | ~900 LOC |

**Total: ~7,000 lines of new code**

---

### Success Criteria for Part XVII

| Capability | Before | After |
|------------|--------|-------|
| Language support | ~15 with tree-sitter | ANY language (tiered confidence) |
| Codebase size | Limited by context | ANY size via hierarchy |
| Impact prediction | Graph traversal only | Causal "what if" reasoning |
| Pattern coverage | 8 patterns | 16+ patterns (all archetypes) |
| Failure handling | Complete failure | Graceful degradation |
| Context efficiency | Relevance-only | Information-theoretic MMR |
| Polyglot support | Single-language | Cross-language contract tracing |
| Outcome prediction | None | Similarity-based prediction |

**World-best benchmark**: No other system provides this combination of capabilities for agentic code understanding.

---

## Part XVIII: Theoretical Breakthroughs and Epistemic Bootstrapping

### [SPEC_SLICE] Part XVIII — Theoretical Breakthroughs

- **[CAPABILITIES] Required**: evidence ledger + claim algebra; ability to run controlled experiments; storage for calibration data.
- **[CAPABILITIES] Optional**: LLM/embedding providers for hypothesis generation; statistical tooling for evaluation.
- **[ADAPTERS] Interfaces**: experiment runner + evaluator; claim verifier; calibration store.
- **[EVIDENCE_LEDGER] Events**: hypothesis proposed, experiment run, outcome recorded, calibration update.
- **[CLAIMS] Outputs**: breakthroughs must cite experimental evidence + reproducibility conditions.
- **Degradation**: without experiment harness → mark as spec-only and refuse “breakthrough” claims.
- **Evidence commands**: `npm run test:tier0` + targeted eval harness (when added).

> **Added**: 2026-01-21
>
> **Purpose**: Ideas that don't exist anywhere in the world yet. True theoretical breakthroughs that would make LiBrainian not just world-best, but world-first.
>
> **Also**: Protocols for operating under ANY epistemic condition, including complete ignorance.

---

### The Breakthroughs: What Only These Minds Could Conceive

These are not incremental improvements. These are ideas that, if implemented, would represent genuine theoretical advances in the field.

---

### I. The Self-Aware Oracle (Turing)

**What Doesn't Exist**: No current system can formally reason about its own reasoning limitations. Systems say "I don't know" but cannot explain *why* they fundamentally cannot know, or what would be required to know.

**Turing's Breakthrough**: A formal undecidability classifier for code questions.

```typescript
/**
 * THE SELF-AWARE ORACLE
 *
 * For any question Q about code C, classify into one of:
 * 1. DECIDABLE: Can compute the answer with certainty
 * 2. ORACLE_DEPENDENT: Requires LLM reasoning (uncertain but possible)
 * 3. FORMALLY_UNDECIDABLE: Provably cannot be answered by any system
 * 4. PRACTICALLY_UNDECIDABLE: Theoretically possible but resource-prohibitive
 *
 * Key insight: Knowing WHY you don't know is often more valuable than a wrong answer.
 */

export interface UndecidabilityClassification {
  question: string;
  classification: 'decidable' | 'oracle_dependent' | 'formally_undecidable' | 'practically_undecidable';

  /** For decidable: the algorithm that computes the answer */
  algorithm?: string;

  /** For oracle_dependent: what the LLM must reason about */
  oracleRequirements?: string[];

  /** For formally_undecidable: the reduction to a known undecidable problem */
  reduction?: {
    targetProblem: 'halting' | 'rice_theorem' | 'post_correspondence' | 'other';
    proofSketch: string;
  };

  /** For practically_undecidable: the resource requirements */
  resourceBounds?: {
    timeComplexity: string;
    spaceComplexity: string;
    estimatedForThisCodebase: string;
  };

  /** What WOULD make this question answerable */
  enablingConditions?: string[];
}

/**
 * The breakthrough: LiBrainian can explain its own limitations.
 *
 * Example:
 *   Q: "Will this function terminate on all inputs?"
 *   A: {
 *     classification: 'formally_undecidable',
 *     reduction: {
 *       targetProblem: 'halting',
 *       proofSketch: 'This function contains a while loop with data-dependent termination...'
 *     },
 *     enablingConditions: [
 *       'Restrict to bounded loops only',
 *       'Provide loop invariant annotations',
 *       'Limit input domain to finite sets'
 *     ]
 *   }
 */
export class TuringOracleClassifier {
  /**
   * Classify a question about code into decidability categories.
   * Uses pattern matching against known undecidable problem classes.
   */
  classify(question: string, codeContext: Entity[]): Promise<UndecidabilityClassification>;

  /**
   * For oracle-dependent questions, estimate uncertainty bounds.
   * Uses calibrated confidence intervals, not point estimates.
   */
  estimateOracleUncertainty(question: string): Promise<{
    confidenceInterval: [number, number];
    calibrationBasis: string;
  }>;
}
```

**Why This Is Breakthrough**: No existing system reasons about its own computability limits. This is the first system that could say "I cannot answer this question, and here's a formal proof why, and here's what would need to change to make it answerable."

**Implementation Complexity**: ~500 LOC + pattern database for undecidable problem reductions

---

### II. Proof-Carrying Context (Dijkstra/Hoare)

**What Doesn't Exist**: Current retrieval returns "relevant" context with similarity scores. No system proves that retrieved context is logically necessary and sufficient for the query.

**The Breakthrough**: Every retrieved entity comes with a machine-checkable proof of its relevance.

```typescript
/**
 * PROOF-CARRYING CONTEXT
 *
 * Instead of "this context has 0.85 relevance", provide:
 * "This context is logically required because [formal derivation]"
 *
 * Uses deductive reasoning, not just embedding similarity.
 */

export interface ProofCarryingContext {
  entity: Entity;

  /** Machine-checkable proof of relevance */
  relevanceProof: RelevanceProof;

  /** If proof cannot be constructed, explain why */
  proofFailure?: ProofFailure;
}

export interface RelevanceProof {
  /** The proof format (natural deduction, sequent calculus, etc.) */
  format: 'natural_deduction' | 'sequent' | 'resolution' | 'informal';

  /** The proof steps */
  steps: ProofStep[];

  /** The conclusion: "Therefore, entity E is relevant to query Q" */
  conclusion: string;

  /** Verification status */
  verified: boolean;
  verificationMethod: 'automated' | 'llm_checked' | 'unverified';
}

export interface ProofStep {
  stepNumber: number;
  statement: string;
  justification: 'axiom' | 'definition' | 'inference' | 'given';
  rule?: string;  // E.g., "modus ponens", "definition of calls"
  premises?: number[];  // Step numbers of premises
}

/**
 * Example proof that `authenticateUser` is relevant to "how does login work":
 *
 * 1. Query asks about "login" [Given]
 * 2. "login" is defined as "verifying user identity" [Definition]
 * 3. `authenticateUser` verifies user identity [From code analysis]
 * 4. Therefore, `authenticateUser` is relevant to login [From 2, 3, by definition match]
 *
 * This proof is checkable: step 3 can be verified by examining the function.
 */

export class ProofCarryingRetriever {
  /**
   * Retrieve context with proofs of relevance.
   * Returns entities only if a proof can be constructed.
   */
  retrieveWithProofs(query: string): Promise<ProofCarryingContext[]>;

  /**
   * Attempt to prove relevance of a specific entity.
   */
  proveRelevance(entity: Entity, query: string): Promise<RelevanceProof | ProofFailure>;
}
```

**Why This Is Breakthrough**: This transforms retrieval from "statistically similar" to "logically necessary". An agent can trust the context because it can verify the proof.

**Implementation Complexity**: ~800 LOC + proof engine integration

---

### III. Bi-Temporal Knowledge (Hickey)

**What Doesn't Exist**: Current systems have "current knowledge" that gets updated. No system maintains full bi-temporal history: when facts were true in the world AND when we learned them.

**The Breakthrough**: Full bi-temporal knowledge with time-travel queries.

```typescript
/**
 * BI-TEMPORAL KNOWLEDGE
 *
 * Every fact has two time dimensions:
 * - Valid time: When the fact was true in the world
 * - Transaction time: When we recorded the fact
 *
 * This enables queries like:
 * - "What did we know about auth on January 1st?"
 * - "What was actually true about auth on January 1st?"
 * - "When did we first learn that login was broken?"
 * - "What would we have known if we had indexed yesterday's code today?"
 */

export interface BiTemporalFact {
  claim: string;
  subject: EntityId;

  /** When was this true in the world? */
  validTime: {
    start: Timestamp;
    end: Timestamp | 'now';  // 'now' means still valid
  };

  /** When did we record this fact? */
  transactionTime: {
    recorded: Timestamp;
    superseded?: Timestamp;  // When this record was replaced
  };

  /** Evidence supporting this fact */
  evidence: Evidence[];
  confidence: number;
}

export interface BiTemporalQuery {
  /** What we want to know */
  question: string;

  /** As of what valid time? (when in the world) */
  asOfValidTime?: Timestamp;

  /** As of what transaction time? (when we knew it) */
  asOfTransactionTime?: Timestamp;
}

/**
 * The four fundamental bi-temporal operations:
 */
export class BiTemporalKnowledge {
  /**
   * Current snapshot: What do we currently know about current state?
   * validTime = now, transactionTime = now
   */
  current(query: string): Promise<Knowledge[]>;

  /**
   * Historical snapshot: What was true at time T?
   * validTime = T, transactionTime = now
   */
  asOfValidTime(query: string, validTime: Timestamp): Promise<Knowledge[]>;

  /**
   * What we knew: What did we know at time T about current state?
   * validTime = now, transactionTime = T
   */
  asOfTransactionTime(query: string, transactionTime: Timestamp): Promise<Knowledge[]>;

  /**
   * Historical knowledge: What did we know at time T1 about time T2?
   * validTime = T2, transactionTime = T1
   */
  asOf(query: string, validTime: Timestamp, transactionTime: Timestamp): Promise<Knowledge[]>;

  /**
   * Time travel diff: How has our knowledge changed?
   */
  knowledgeDiff(
    query: string,
    fromTransaction: Timestamp,
    toTransaction: Timestamp
  ): Promise<KnowledgeDiff>;
}
```

**Why This Is Breakthrough**: This enables temporal debugging ("when did we start believing X?"), knowledge archaeology ("what did past agents know?"), and counterfactual analysis ("would we have caught this bug if we had indexed earlier?").

**Implementation Complexity**: ~1000 LOC (requires temporal database schema)

---

### IV. Causal Discovery from Observational Data (Pearl)

**What Doesn't Exist**: Current systems trace known dependencies. No system discovers unknown causal relationships from observational data (git history, test results, production metrics).

**The Breakthrough**: Discover hidden causal structure from patterns in data.

```typescript
/**
 * CAUSAL DISCOVERY
 *
 * Given observational data, discover causal relationships not declared in code.
 *
 * Examples of discoverable relationships:
 * - "Changes to config.ts tend to cause failures in tests/auth.test.ts"
 * - "Deploys on Fridays have 3x more rollbacks"
 * - "This function silently depends on global state"
 *
 * Uses PC algorithm, IC algorithm, and LLM-assisted causal inference.
 */

export interface DiscoveredCausalRelationship {
  cause: EntityId | string;
  effect: EntityId | string;

  /** How was this discovered? */
  discoveryMethod: 'pc_algorithm' | 'ic_algorithm' | 'llm_inference' | 'intervention_test';

  /** Statistical evidence */
  evidence: {
    observationCount: number;
    conditionalProbability: number;  // P(effect | cause)
    baseRate: number;  // P(effect)
    liftRatio: number;  // P(effect | cause) / P(effect)
  };

  /** Causal confidence (not just correlation) */
  causalConfidence: number;

  /** Potential confounders that could explain the correlation */
  potentialConfounders: string[];

  /** Suggested intervention to verify causality */
  verificationExperiment?: string;
}

export class CausalDiscoveryEngine {
  /**
   * Discover causal relationships from git history.
   * "What tends to cause what?"
   */
  discoverFromGitHistory(history: GitHistory): Promise<DiscoveredCausalRelationship[]>;

  /**
   * Discover causal relationships from test results.
   * "What code changes tend to break what tests?"
   */
  discoverFromTestResults(testRuns: TestRun[]): Promise<DiscoveredCausalRelationship[]>;

  /**
   * Discover causal relationships from production metrics.
   * "What changes tend to impact what metrics?"
   */
  discoverFromProductionMetrics(metrics: MetricTimeSeries[]): Promise<DiscoveredCausalRelationship[]>;

  /**
   * Verify a discovered relationship through intervention.
   * Actually test if manipulating cause affects effect.
   */
  verifyByIntervention(
    relationship: DiscoveredCausalRelationship
  ): Promise<VerificationResult>;
}
```

**Why This Is Breakthrough**: This finds dependencies that aren't in the code - implicit coupling, hidden state dependencies, environmental factors. No existing code understanding system discovers causal structure from observational data.

**Implementation Complexity**: ~1200 LOC + statistical libraries

---

### V. Metacognitive Architecture (McCarthy/Minsky)

**What Doesn't Exist**: No system can reason about how to reason. Current systems apply fixed strategies regardless of problem characteristics.

**The Breakthrough**: A system that monitors its own reasoning, detects when it's stuck, and switches strategies.

```typescript
/**
 * METACOGNITIVE ARCHITECTURE
 *
 * "Knowing how you know" and "knowing when to think differently"
 *
 * The system has multiple reasoning strategies and a meta-level that:
 * 1. Monitors progress of current strategy
 * 2. Detects impasses (stuck, going in circles, diminishing returns)
 * 3. Selects alternative strategies
 * 4. Knows when to ask for help
 */

export interface MetacognitiveState {
  currentStrategy: ReasoningStrategy;
  strategyStartTime: Timestamp;
  progressIndicators: ProgressIndicator[];
  impasses: Impasse[];
  strategySwitches: StrategySwitch[];
}

export interface ReasoningStrategy {
  id: string;
  name: string;
  applicableWhen: string[];
  progressMetric: string;
  expectedProgressRate: number;
}

export interface Impasse {
  type: 'stuck' | 'circular' | 'diminishing_returns' | 'contradiction';
  detectedAt: Timestamp;
  evidence: string;
  suggestedRecovery: string[];
}

export interface ProgressIndicator {
  metric: string;
  value: number;
  trend: 'improving' | 'stable' | 'declining';
  expectedValue: number;
}

export class MetacognitiveMonitor {
  /**
   * Monitor reasoning progress and detect impasses.
   */
  monitor(state: ReasoningState): MetacognitiveState;

  /**
   * Detect if current strategy is failing.
   */
  detectImpasse(state: MetacognitiveState): Impasse | null;

  /**
   * Select alternative strategy based on impasse type.
   */
  selectAlternativeStrategy(
    currentStrategy: ReasoningStrategy,
    impasse: Impasse
  ): ReasoningStrategy;

  /**
   * Determine if human help is needed.
   */
  shouldEscalate(state: MetacognitiveState): boolean;

  /**
   * Generate explanation of reasoning process.
   */
  explainReasoning(state: MetacognitiveState): ReasoningExplanation;
}

/**
 * REASONING STRATEGIES LIBRARY
 */
export const REASONING_STRATEGIES: ReasoningStrategy[] = [
  {
    id: 'deductive',
    name: 'Deductive Reasoning',
    applicableWhen: ['clear premises', 'formal structure', 'logical derivation needed'],
    progressMetric: 'conclusions_derived',
    expectedProgressRate: 0.5,  // conclusions per minute
  },
  {
    id: 'abductive',
    name: 'Abductive Reasoning',
    applicableWhen: ['need explanation', 'symptoms known', 'cause unknown'],
    progressMetric: 'hypotheses_eliminated',
    expectedProgressRate: 0.3,
  },
  {
    id: 'analogical',
    name: 'Analogical Reasoning',
    applicableWhen: ['novel problem', 'similar known problems exist'],
    progressMetric: 'relevant_analogies_found',
    expectedProgressRate: 0.4,
  },
  {
    id: 'decomposition',
    name: 'Decomposition',
    applicableWhen: ['complex problem', 'independent sub-problems'],
    progressMetric: 'sub_problems_solved',
    expectedProgressRate: 0.2,
  },
  {
    id: 'brute_force',
    name: 'Systematic Enumeration',
    applicableWhen: ['finite search space', 'other strategies failed'],
    progressMetric: 'options_evaluated',
    expectedProgressRate: 1.0,
  },
  {
    id: 'ask_human',
    name: 'Human Consultation',
    applicableWhen: ['multiple impasses', 'low confidence', 'high stakes'],
    progressMetric: 'clarifications_received',
    expectedProgressRate: 0.1,
  },
];
```

**Why This Is Breakthrough**: This is the first system that can reason about its own reasoning, detect when it's stuck, and intelligently switch approaches. Current systems either apply one strategy or randomly try alternatives.

**Implementation Complexity**: ~800 LOC

---

### J. Epistemic Bootstrapping Protocols

**The Core Problem**: How does an agent using LiBrainian proceed when there is:
- No documentation
- No comments
- No tests
- No known architecture
- Potentially obfuscated or generated code
- Completely unfamiliar technology

**The Solution**: Systematic protocols for building knowledge from nothing.

---

#### J.1 The Zero-Knowledge Protocol

```typescript
/**
 * ZERO-KNOWLEDGE BOOTSTRAPPING PROTOCOL
 *
 * When you know NOTHING about a codebase, follow this protocol
 * to systematically build understanding with calibrated confidence.
 *
 * Key principle: Start with what is CERTAIN, expand to what is LIKELY,
 * mark everything else as UNKNOWN.
 */

export interface ZeroKnowledgeProtocol {
  phases: BootstrapPhase[];
  currentPhase: number;
  accumulatedKnowledge: KnowledgeState;
  confidenceThreshold: number;
}

export const ZERO_KNOWLEDGE_PROTOCOL: BootstrapPhase[] = [
  // PHASE 1: Structural certainties (what we can PROVE from syntax alone)
  {
    name: 'structural_inventory',
    goal: 'Enumerate what exists without interpreting meaning',
    confidence: 1.0,  // Syntactic facts are certain
    steps: [
      'Count files by extension (establish language mix)',
      'Parse all parseable files to AST (structural extraction)',
      'List all exported symbols (public interface)',
      'List all imports/dependencies (dependency graph skeleton)',
      'Identify entry points (main functions, index files)',
    ],
    outputs: ['file_inventory', 'language_distribution', 'symbol_table', 'import_graph', 'entry_points'],
    failureMode: 'If files cannot be parsed, fall back to regex extraction',
  },

  // PHASE 2: Naming-based inference (what we can INFER from names)
  {
    name: 'naming_inference',
    goal: 'Infer likely purposes from naming conventions',
    confidence: 0.6,  // Names are hints, not guarantees
    steps: [
      'Classify files by naming pattern (test, config, util, model, etc.)',
      'Infer function purposes from verb-noun patterns',
      'Identify domain vocabulary (recurring terms)',
      'Map naming conventions (camelCase, snake_case, etc.)',
    ],
    outputs: ['file_classifications', 'function_purposes_inferred', 'domain_vocabulary'],
    failureMode: 'If names are obfuscated, skip and mark as UNKNOWN',
  },

  // PHASE 3: Structural inference (what we can INFER from structure)
  {
    name: 'structural_inference',
    goal: 'Infer architecture from structural patterns',
    confidence: 0.5,
    steps: [
      'Detect directory-based modules',
      'Identify potential MVC/layered patterns',
      'Find central hub files (high in-degree in import graph)',
      'Identify peripheral files (high out-degree, low in-degree)',
    ],
    outputs: ['likely_modules', 'architectural_pattern_hypothesis', 'central_files', 'peripheral_files'],
    failureMode: 'If structure is flat, report "no clear architecture"',
  },

  // PHASE 4: Behavioral probing (what we can OBSERVE from running)
  {
    name: 'behavioral_probing',
    goal: 'Observe behavior to verify structural inferences',
    confidence: 0.8,  // If tests pass, behavior is verified
    steps: [
      'Attempt to build/compile (verify buildability)',
      'Run existing tests (verify current health)',
      'Add instrumentation to entry points (observe call flow)',
      'Execute with sample inputs (observe behavior)',
    ],
    outputs: ['build_status', 'test_results', 'observed_call_graph', 'runtime_behavior'],
    failureMode: 'If cannot build, stay at static analysis',
  },

  // PHASE 5: Semantic extraction (LLM-powered understanding)
  {
    name: 'semantic_extraction',
    goal: 'Extract meaning using LLM reasoning',
    confidence: 0.7,  // LLM synthesis is uncertain
    steps: [
      'Summarize each file purpose',
      'Extract entity purposes',
      'Identify cross-cutting concerns',
      'Generate architectural summary',
    ],
    outputs: ['file_summaries', 'entity_purposes', 'concerns', 'architecture_summary'],
    failureMode: 'If LLM unavailable, stop at structural understanding',
  },

  // PHASE 6: Verification loop (calibrate confidence from evidence)
  {
    name: 'verification_loop',
    goal: 'Verify inferences and calibrate confidence',
    confidence: 'varies',
    steps: [
      'Cross-check inferences against behavioral observations',
      'Identify contradictions between phases',
      'Calibrate confidence based on evidence agreement',
      'Mark remaining unknowns explicitly',
    ],
    outputs: ['verified_knowledge', 'contradictions', 'calibrated_confidence', 'unknowns'],
    failureMode: 'Always produces output (even if all UNKNOWN)',
  },
];
```

#### J.2 Confidence Calibration Under Uncertainty

```typescript
/**
 * CONFIDENCE UNDER UNCERTAINTY
 *
 * When you don't know much, how do you calibrate confidence?
 *
 * Key insight: Confidence should reflect EVIDENCE, not feelings.
 * Multiple weak signals can combine into moderate confidence.
 * Contradictory signals MUST reduce confidence.
 */

export interface EvidenceBasedConfidence {
  claim: string;
  evidenceSources: EvidenceSource[];
  confidence: number;
  calibrationMethod: string;
}

export interface EvidenceSource {
  source: 'syntactic' | 'naming' | 'structural' | 'behavioral' | 'semantic';
  evidence: string;
  weight: number;  // How much does this source contribute?
  reliability: number;  // How reliable is this source in general?
}

/**
 * Compute confidence from multiple evidence sources.
 *
 * RULES:
 * 1. Agreeing sources combine (but with diminishing returns)
 * 2. Contradicting sources REDUCE confidence
 * 3. Single source caps confidence at source reliability
 * 4. Unknown is explicit (confidence = 0.5, wide interval)
 */
function computeEvidenceBasedConfidence(
  claim: string,
  sources: EvidenceSource[]
): EvidenceBasedConfidence {
  if (sources.length === 0) {
    return { claim, evidenceSources: [], confidence: 0.5, calibrationMethod: 'no_evidence' };
  }

  // Check for contradictions
  const agreements = sources.filter(s => s.weight > 0);
  const contradictions = sources.filter(s => s.weight < 0);

  if (contradictions.length > 0) {
    // Contradictions cap confidence
    const netEvidence = agreements.reduce((sum, s) => sum + s.weight * s.reliability, 0)
                       - contradictions.reduce((sum, s) => sum + Math.abs(s.weight) * s.reliability, 0);
    return {
      claim,
      evidenceSources: sources,
      confidence: Math.max(0.1, 0.5 + netEvidence * 0.3),
      calibrationMethod: 'contradictory_evidence',
    };
  }

  // No contradictions: combine with diminishing returns
  let combined = 0.5;
  for (const source of agreements.sort((a, b) => b.reliability - a.reliability)) {
    const contribution = source.weight * source.reliability * (1 - combined);
    combined += contribution;
  }

  return {
    claim,
    evidenceSources: sources,
    confidence: Math.min(0.95, combined),  // Never claim certainty
    calibrationMethod: 'combining_agreement',
  };
}
```

#### J.3 Progressive Disclosure of Understanding

```typescript
/**
 * PROGRESSIVE UNDERSTANDING DISCLOSURE
 *
 * As you learn more, disclose understanding progressively.
 * Never claim more than evidence supports.
 *
 * Level 0: "I can parse this codebase"
 * Level 1: "I see these files and dependencies"
 * Level 2: "I infer these likely purposes"
 * Level 3: "I've verified these behaviors"
 * Level 4: "I understand this architecture"
 */

export type UnderstandingLevel = 0 | 1 | 2 | 3 | 4;

export interface ProgressiveUnderstanding {
  level: UnderstandingLevel;
  whatWeKnow: KnowledgeAtLevel[];
  whatWeInfer: InferenceAtLevel[];
  whatWeDoNotKnow: Unknown[];
  nextStepsToImprove: string[];
}

export interface KnowledgeAtLevel {
  level: UnderstandingLevel;
  claim: string;
  confidence: number;
  evidence: string;
  verificationMethod: string;
}

/**
 * Generate honest understanding report at current level.
 */
function reportUnderstanding(state: KnowledgeState): ProgressiveUnderstanding {
  const syntacticFacts = state.facts.filter(f => f.source === 'syntactic');
  const inferences = state.facts.filter(f => f.source !== 'syntactic');
  const unknowns = state.unknowns;

  const level = computeLevel(syntacticFacts, inferences, unknowns);

  return {
    level,
    whatWeKnow: syntacticFacts.map(f => ({
      level: 1,
      claim: f.claim,
      confidence: 1.0,
      evidence: f.evidence,
      verificationMethod: 'syntactic_parsing',
    })),
    whatWeInfer: inferences.map(f => ({
      level: inferenceLevel(f),
      claim: f.claim,
      confidence: f.confidence,
      evidence: f.evidence,
      verificationMethod: f.source,
    })),
    whatWeDoNotKnow: unknowns,
    nextStepsToImprove: suggestNextSteps(level, unknowns),
  };
}
```

#### J.4 The Epistemic Escalation Protocol

```typescript
/**
 * EPISTEMIC ESCALATION
 *
 * When stuck at a confidence level, how to escalate?
 *
 * Escalation chain:
 * 1. Try alternative analysis methods
 * 2. Ask clarifying questions (if human available)
 * 3. Make constrained assumptions (explicit)
 * 4. Proceed with uncertainty bounds (wide intervals)
 * 5. Refuse and explain why (honest limits)
 */

export interface EscalationDecision {
  situation: string;
  currentConfidence: number;
  requiredConfidence: number;
  decision: 'proceed' | 'try_alternative' | 'ask_human' | 'assume_explicit' | 'refuse';
  rationale: string;
  ifProceeding?: {
    uncertaintyBounds: [number, number];
    assumptions: string[];
    riskAcknowledgment: string;
  };
}

export class EpistemicEscalationEngine {
  /**
   * Decide how to proceed when stuck.
   */
  decideEscalation(
    task: string,
    currentKnowledge: KnowledgeState,
    requiredConfidence: number
  ): EscalationDecision {
    const currentConfidence = computeTaskConfidence(task, currentKnowledge);

    if (currentConfidence >= requiredConfidence) {
      return { situation: task, currentConfidence, requiredConfidence, decision: 'proceed', rationale: 'Sufficient confidence' };
    }

    // Try alternative methods first
    const alternatives = findAlternativeAnalysisMethods(task, currentKnowledge);
    if (alternatives.length > 0) {
      return {
        situation: task,
        currentConfidence,
        requiredConfidence,
        decision: 'try_alternative',
        rationale: `Trying: ${alternatives[0]}`,
      };
    }

    // Check if human can help
    const clarifyingQuestions = generateClarifyingQuestions(task, currentKnowledge);
    if (clarifyingQuestions.length > 0 && this.humanAvailable) {
      return {
        situation: task,
        currentConfidence,
        requiredConfidence,
        decision: 'ask_human',
        rationale: `Question: ${clarifyingQuestions[0]}`,
      };
    }

    // Can we make safe assumptions?
    const safeAssumptions = findSafeAssumptions(task, currentKnowledge);
    if (safeAssumptions.length > 0) {
      return {
        situation: task,
        currentConfidence,
        requiredConfidence,
        decision: 'assume_explicit',
        rationale: `Assuming: ${safeAssumptions.join(', ')}`,
        ifProceeding: {
          uncertaintyBounds: [currentConfidence * 0.8, currentConfidence * 1.2],
          assumptions: safeAssumptions,
          riskAcknowledgment: 'Proceeding with explicit assumptions',
        },
      };
    }

    // Refuse if cannot meet threshold
    return {
      situation: task,
      currentConfidence,
      requiredConfidence,
      decision: 'refuse',
      rationale: `Cannot achieve ${requiredConfidence} confidence. Current: ${currentConfidence}. Missing: ${currentKnowledge.unknowns.join(', ')}`,
    };
  }
}
```

---

### K. Universal Applicability Matrix

**The Question**: How does LiBrainian serve ANY software role, task, project, or system?

**The Answer**: A mapping from situations to protocols.

```typescript
/**
 * UNIVERSAL APPLICABILITY MATRIX
 *
 * For any combination of:
 * - Role (developer, reviewer, architect, debugger, learner, etc.)
 * - Task (understand, modify, verify, debug, design, document, etc.)
 * - Project state (greenfield, legacy, maintained, abandoned, etc.)
 * - Knowledge state (full docs, some docs, no docs, obfuscated, etc.)
 *
 * LiBrainian provides the appropriate protocol.
 */

export interface SituationVector {
  role: Role;
  task: Task;
  projectState: ProjectState;
  knowledgeState: KnowledgeState;
}

export type Role =
  | 'developer'        // Writing new code
  | 'reviewer'         // Reviewing code changes
  | 'architect'        // Designing systems
  | 'debugger'         // Finding and fixing bugs
  | 'learner'          // Understanding existing code
  | 'maintainer'       // Keeping code healthy
  | 'migrator'         // Moving to new technologies
  | 'security_analyst' // Finding vulnerabilities
  | 'performance_engineer' // Optimizing speed
  | 'documentation_writer' // Creating docs
  ;

export type Task =
  | 'understand'       // What does this do?
  | 'modify'           // Change this safely
  | 'verify'           // Is this correct/safe?
  | 'debug'            // Why isn't this working?
  | 'design'           // How should this be structured?
  | 'document'         // Explain this to others
  | 'test'             // What tests are needed?
  | 'optimize'         // Make this faster/smaller
  | 'migrate'          // Move to new tech
  | 'secure'           // Find/fix vulnerabilities
  ;

export type ProjectState =
  | 'greenfield'       // New project, clean slate
  | 'active'           // Actively developed
  | 'stable'           // Maintained but not actively developed
  | 'legacy'           // Old technology, needs care
  | 'abandoned'        // No longer maintained
  | 'generated'        // Code generated by tools
  | 'obfuscated'       // Intentionally hard to read
  ;

export type KnowledgeState =
  | 'excellent'        // Full docs, tests, comments
  | 'good'             // Some docs, reasonable comments
  | 'poor'             // Minimal docs, few comments
  | 'none'             // No docs, no comments
  | 'misleading'       // Docs exist but are wrong
  ;

/**
 * The universal protocol selector.
 */
export class UniversalProtocolSelector {
  /**
   * Given a situation, return the appropriate LiBrainian protocol.
   */
  selectProtocol(situation: SituationVector): Protocol {
    const { role, task, projectState, knowledgeState } = situation;

    // Start with knowledge acquisition if needed
    if (knowledgeState === 'none' || knowledgeState === 'misleading') {
      return {
        phase1: ZERO_KNOWLEDGE_PROTOCOL,
        phase2: this.selectTaskProtocol(role, task, projectState),
        confidenceRequirements: this.computeRequiredConfidence(role, task),
      };
    }

    // Direct to task protocol
    return {
      phase1: null,  // Skip bootstrapping
      phase2: this.selectTaskProtocol(role, task, projectState),
      confidenceRequirements: this.computeRequiredConfidence(role, task),
    };
  }

  /**
   * Select task-specific protocol.
   */
  private selectTaskProtocol(role: Role, task: Task, projectState: ProjectState): TaskProtocol {
    // Matrix of protocols
    const protocols: Record<Task, TaskProtocol> = {
      understand: CODEBASE_UNDERSTANDING_PROTOCOL,
      modify: SAFE_MODIFICATION_PROTOCOL,
      verify: VERIFICATION_PROTOCOL,
      debug: DEBUGGING_PROTOCOL,
      design: ARCHITECTURE_DESIGN_PROTOCOL,
      document: DOCUMENTATION_PROTOCOL,
      test: TEST_GENERATION_PROTOCOL,
      optimize: OPTIMIZATION_PROTOCOL,
      migrate: MIGRATION_PROTOCOL,
      secure: SECURITY_AUDIT_PROTOCOL,
    };

    const baseProtocol = protocols[task];

    // Adjust for project state
    if (projectState === 'legacy' || projectState === 'abandoned') {
      return this.wrapWithLegacyPrecautions(baseProtocol);
    }
    if (projectState === 'generated' || projectState === 'obfuscated') {
      return this.wrapWithStructuralAnalysis(baseProtocol);
    }

    return baseProtocol;
  }

  /**
   * Compute required confidence for task.
   * High-stakes tasks require higher confidence.
   */
  private computeRequiredConfidence(role: Role, task: Task): number {
    const baseConfidence: Record<Task, number> = {
      understand: 0.6,   // Understanding can be iterative
      modify: 0.8,       // Modifications need higher confidence
      verify: 0.9,       // Verification needs very high confidence
      debug: 0.7,        // Debugging is inherently uncertain
      design: 0.7,       // Design can be revised
      document: 0.8,     // Docs should be accurate
      test: 0.7,         // Tests are verifiable
      optimize: 0.7,     // Optimizations are measurable
      migrate: 0.85,     // Migrations are hard to reverse
      secure: 0.95,      // Security needs highest confidence
    };

    // Adjust by role
    const roleMultiplier: Record<Role, number> = {
      developer: 1.0,
      reviewer: 1.1,
      architect: 0.9,    // Architects make reversible decisions
      debugger: 0.9,     // Debugging is exploratory
      learner: 0.7,      // Learning tolerates uncertainty
      maintainer: 1.0,
      migrator: 1.1,
      security_analyst: 1.2,
      performance_engineer: 0.9,
      documentation_writer: 1.0,
    };

    return Math.min(0.95, baseConfidence[task] * roleMultiplier[role]);
  }
}
```

---

### Implementation Priority Summary for Part XVIII

| Priority | Section | Why Breakthrough | Effort |
|----------|---------|------------------|--------|
| **1** | J. Epistemic Bootstrapping | Enables operation from zero knowledge | ~800 LOC |
| **2** | I. Self-Aware Oracle | First system to reason about its own limits | ~500 LOC |
| **3** | K. Universal Applicability | Serves ANY situation systematically | ~600 LOC |
| **4** | V. Metacognitive Architecture | First system to reason about how it reasons | ~800 LOC |
| **5** | II. Proof-Carrying Context | Transforms retrieval from statistical to logical | ~800 LOC |
| **6** | III. Bi-Temporal Knowledge | Full time-travel for knowledge | ~1000 LOC |
| **7** | IV. Causal Discovery | Finds hidden causal structure from data | ~1200 LOC |

**Total: ~5,700 additional lines for breakthrough features**

---

### Why These Are Genuine Breakthroughs

1. **Self-Aware Oracle**: No existing system can formally classify its own questions into decidability categories. This would be the first.

2. **Proof-Carrying Context**: No retrieval system provides machine-checkable proofs of relevance. This transforms RAG from statistical to logical.

3. **Bi-Temporal Knowledge**: While bi-temporal databases exist, no code understanding system maintains bi-temporal knowledge about code.

4. **Causal Discovery**: While Pearl's methods exist for data science, no code understanding system discovers causal structure from git/test/production data.

5. **Metacognitive Architecture**: While some AI systems have multiple strategies, none have a meta-level that monitors progress and switches strategies based on impasse detection.

6. **Epistemic Bootstrapping**: No system has a formal protocol for building knowledge from complete ignorance with calibrated confidence.

7. **Universal Applicability**: No system provides a systematic mapping from arbitrary situations to appropriate protocols.

**These are not incremental. These are theoretical advances that, if implemented, would make LiBrainian genuinely unprecedented.**

---

## Part XIX: Modular Configuration Language — Building on Existing Foundations

### [SPEC_SLICE] Part XIX — Modular Configuration Language

- **[CAPABILITIES] Required**: parser + validator for configuration language; ability to map config to technique bundles.
- **[CAPABILITIES] Optional**: schema inference; LLM assist for config authoring; static analysis.
- **[ADAPTERS] Interfaces**: config loader; schema registry; technique registry; environment capability checks.
- **[EVIDENCE_LEDGER] Events**: config parsed, validation errors, config applied, generated techniques.
- **[CLAIMS] Outputs**: “config applied” claims cite parsed config hash + validation result.
- **Degradation**: invalid config fails closed with explicit diagnostics; no silent defaults.
- **Evidence commands**: `npm run test:tier0` + `npx vitest api/__tests__/` (config tests when added).

> **CRITICAL FRAMING**: This section does NOT propose creating new code from scratch. It shows how to COMPOSE and CONFIGURE what LiBrainian ALREADY HAS. Every element below builds on existing primitives, operators, patterns, and compositions in the codebase.

### The Twenty Greats' Understanding of Existing LiBrainian Architecture

Before proposing configuration, we must acknowledge what EXISTS:

#### What LiBrainian Already Has (Verified in Codebase)

```typescript
// FROM technique_library.ts - 40+ EXISTING PRIMITIVES:
// tp_clarify_goal, tp_list_constraints, tp_decompose, tp_search_history,
// tp_hypothesis, tp_bisect, tp_min_repro, tp_instrument, tp_experiment,
// tp_review_tests, tp_risk_scan, tp_verify_plan, tp_root_cause,
// tp_arch_mapping, tp_interface_contract, tp_threat_model,
// tp_performance_profile, tp_refactor_safe, tp_ux_journey, ...

// FROM pattern_catalog.ts - 8 EXISTING PATTERNS:
// pattern_bug_investigation, pattern_performance_investigation,
// pattern_change_verification, pattern_release_verification,
// pattern_feature_construction, pattern_refactoring,
// pattern_multi_agent_task, pattern_self_improvement

// FROM operator_registry.ts - EXISTING OPERATOR TYPES:
// 'sequence' | 'parallel' | 'conditional' | 'loop' | 'gate' | 'quorum'

// FROM technique_composition_builder.ts - EXISTING BUILDER:
// CompositionBuilder with .addPrimitive(), .addOperator(), .merge()

// FROM technique_compositions.ts - 15+ EXISTING COMPOSITIONS:
// tc_agentic_review_v1, tc_root_cause_recovery, tc_performance_reliability, etc.
```

**The twenty greats do NOT recommend building new infrastructure.** They recommend a CONFIGURATION LAYER that composes these existing elements into a language-like capability.

---

### The Independence Principle (25 Greats' Foundation)

> **LiBrainian is INDEPENDENT epistemological infrastructure—not a tool for any specific harness.**

**Dijkstra**: "A pure function has no hidden dependencies. LiBrainian's core should be callable from anywhere."

**Kay**: "Objects communicate via messages. LiBrainian should receive messages, not be intercepted by hooks."

**Hickey**: "Complecting execution with observation with modification creates mud. Keep them separate."

The architecture serves ALL use cases equally:
- With Claude Code, Codex, any agent, or NO agent
- By humans directly or future systems
- Via MCP, REST, gRPC, or direct function calls

```
┌─────────────────────────────────────────────────────────────────────┐
│                      LiBrainian (Independent Core)                    │
│   ┌─────────────────────────────────────────────────────────────┐   │
│   │    Pure Core: query() · search() · compose() · verify()     │   │
│   └─────────────────────────────────────────────────────────────┘   │
│   ┌─────────────────────────────────────────────────────────────┐   │
│   │    Actor Interface: receive(message) → response              │   │
│   └─────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────┘
         │                    │                    │
         ▼                    ▼                    ▼
   [MCP Adapter]        [CLI Adapter]        [HTTP Adapter]
    (optional)           (optional)           (optional)
```

**Self-Critique (Lamport)**: "But is independence actually achievable? LLMs require specific prompting. Won't the 'pure core' still have hidden LLM dependencies?"

**Response (Armstrong)**: "The dependency is explicit: `query(q, ctx, llmService)`. The LLM is a parameter, not hidden state. This is inversion of control, not independence theater."

---

### Use Case Coverage Analysis (25 Greats' Audit)

> **Brooks**: "The first step in solving a problem is understanding which problems actually need solving."

The 20 use cases in Part VI cover developer-centric scenarios. The 25 greats identify **domains NOT YET explicitly supported**:

#### Domains Beyond Traditional Development

| # | Domain | Example Use Case | Currently Supported? | How To Support |
|---|--------|------------------|---------------------|----------------|
| 1 | **Designer Experience** | "What's the design system's color palette evolution?" | ❌ No | Extend entity types to include design tokens |
| 2 | **Customer Service Dev** | "How do support tickets flow through the codebase?" | ❌ No | Add workflow tracing primitives |
| 3 | **Data Pipeline Engineering** | "What transforms happen between source and warehouse?" | Partial | Add `tp_data_lineage` primitive |
| 4 | **ML/AI Model Development** | "How does training data flow to model predictions?" | ❌ No | Add ML pipeline primitives |
| 5 | **Infrastructure as Code** | "What resources does this Terraform change affect?" | ❌ No | Extend to non-code artifacts |
| 6 | **Mobile Development** | "How does this API change affect iOS vs Android?" | Partial | Cross-platform entity linking |
| 7 | **Game Development** | "What assets reference this shader?" | ❌ No | Asset-code relationship tracking |
| 8 | **Embedded Systems** | "What's the memory footprint of this change?" | ❌ No | Hardware constraint primitives |
| 9 | **DevOps/SRE** | "What code paths could cause this alert?" | Partial | Runtime-to-code mapping |
| 10 | **Compliance Engineering** | "What code handles PII and how?" | ❌ No | Data classification primitives |
| 11 | **Localization/i18n** | "What strings are untranslated after this PR?" | ❌ No | Translation coverage tracking |
| 12 | **Accessibility** | "What components lack ARIA labels?" | ❌ No | A11y audit primitives |
| 13 | **Real-time Systems** | "What's the worst-case latency path?" | ❌ No | Timing analysis primitives |
| 14 | **Blockchain/Smart Contracts** | "What state changes does this function cause?" | ❌ No | State machine analysis |
| 15 | **Scientific Computing** | "What numerical stability issues exist?" | ❌ No | Numerical analysis primitives |
| 16 | **Healthcare/Medical** | "Does this code meet HIPAA requirements?" | ❌ No | Regulatory compliance primitives |
| 17 | **Financial Systems** | "What audit trail exists for this calculation?" | ❌ No | Audit primitives |
| 18 | **Educational Software** | "What learning objectives does this feature serve?" | ❌ No | Pedagogical mapping |
| 19 | **Content Management** | "How does content flow from CMS to display?" | ❌ No | Content pipeline primitives |
| 20 | **E-commerce** | "What affects checkout conversion?" | ❌ No | Business metric primitives |
| 21 | **Social Platforms** | "What moderation logic applies to this content type?" | ❌ No | Policy-code mapping |
| 22 | **IoT Systems** | "What code runs on which device class?" | ❌ No | Device-code mapping |
| 23 | **Legacy Migration** | "What old patterns still exist and where?" | Partial | Pattern detection primitives |
| 24 | **Microservices** | "What's the service dependency graph for this change?" | Partial | Service topology primitives |

#### World-Class Application Domains (Essential for Building at Scale)

> **Kay**: "If you can't build Instagram, YouTube, or Reddit with it, your tool isn't general-purpose—it's a toy."

| # | Domain | Example Use Cases | Currently Supported? | How To Support |
|---|--------|-------------------|---------------------|----------------|
| 25 | **Landing Pages / Marketing** | "What components affect conversion?", "What's the Core Web Vitals impact?" | ❌ No | Component-metric linking |
| 26 | **B2B Dashboards** | "What data sources feed this widget?", "What permissions control visibility?" | ❌ No | Data binding + permission tracing |
| 27 | **B2C Dashboards** | "How does this change affect user engagement?", "What's the real-time update path?" | ❌ No | Real-time flow + metric tracing |
| 28 | **Social Platforms (Instagram/Facebook)** | "How does the feed algorithm rank content?", "What moderation rules apply?" | ❌ No | Algorithm tracing + policy mapping |
| 29 | **Video Platforms (YouTube)** | "What's the transcoding pipeline?", "How do recommendations flow?" | ❌ No | Media pipeline + algorithm tracing |
| 30 | **Forum Platforms (Reddit)** | "How does voting affect visibility?", "What's the comment threading logic?" | ❌ No | Algorithm tracing + state analysis |
| 31 | **Industrial Backends** | "What's the sharding strategy?", "Where are the circuit breakers?" | ❌ No | Scale pattern detection |
| 32 | **High-Availability Systems** | "What's the failover path?", "What guarantees does this provide?" | ❌ No | Reliability pattern analysis |
| 33 | **Real-time Systems** | "What's the message propagation latency?", "Where are race conditions possible?" | Partial | Real-time flow + timing bounds |
| 34 | **Developer Tools (Claude Code/Codex)** | "How does context assembly work?", "What tools are orchestrated?" | ❌ No | Tool orchestration tracing |
| 35 | **API Platforms** | "What's the rate limiting strategy?", "How is auth handled?" | Partial | Policy verification + flow analysis |
| 36 | **Search/Discovery Systems** | "How does the ranking algorithm work?", "What indexes are used?" | ❌ No | Algorithm tracing + data lineage |
| 37 | **Notification Systems** | "What triggers this notification?", "What's the delivery pipeline?" | ❌ No | Event flow + delivery tracing |
| 38 | **Payment/Transaction Systems** | "What's the transaction flow?", "Where are the idempotency guarantees?" | ❌ No | State tracing + policy verification |
| 39 | **Recommendation Engines** | "What signals feed the model?", "How is cold start handled?" | ❌ No | Algorithm tracing + data lineage |
| 40 | **CDN/Edge Systems** | "What's cached where?", "What's the invalidation strategy?" | ❌ No | Distribution pattern analysis |

#### The 25 Greats' Solution: Domain-Agnostic Primitives

**Naur**: "Don't build 40 domain-specific modules. Build primitives that COMPOSE into domain support."

**Observation**: All 40 domains share common underlying needs. We need **14 primitives** (not 40 modules):

| Underlying Need | Domains Requiring It | Primitive |
|-----------------|---------------------|-----------|
| **Artifact-code linking** | Design, Game, IoT, Content | `tp_artifact_trace` |
| **Data flow analysis** | Data Pipeline, ML, CMS, E-commerce, Dashboards | `tp_data_lineage` |
| **Compliance checking** | Healthcare, Financial, Compliance, Payments | `tp_policy_verify` |
| **Cross-platform tracing** | Mobile, Embedded, IoT, CDN | `tp_platform_map` |
| **Business metric mapping** | E-commerce, Social, Education, Landing Pages | `tp_metric_trace` |
| **Timing analysis** | Real-time, Embedded, Game, HA Systems | `tp_timing_bound` |
| **State machine analysis** | Blockchain, Workflow, Customer Service, Payments | `tp_state_trace` |
| **Algorithm tracing** | Social feeds, Recommendations, Search, Video | `tp_algorithm_trace` |
| **Component composition** | Landing Pages, Dashboards, UI Systems | `tp_component_graph` |
| **Scale pattern detection** | Industrial backends, HA, Microservices | `tp_scale_pattern` |
| **Real-time flow analysis** | Notifications, Dashboards, Social, Chat | `tp_realtime_flow` |
| **Media pipeline tracing** | Video, Social, Content, Gaming | `tp_media_pipeline` |
| **Tool orchestration** | Developer tools, Automation, CI/CD | `tp_tool_orchestration` |
| **Distribution analysis** | CDN, Edge, Sharding, Replication | `tp_distribution_map` |

**Self-Critique (Wirth)**: "14 primitives for 40 domains? Is this actually manageable?"

**Response (Thompson)**: "14 primitives that COMPOSE is far simpler than 40 domain modules. The math: 14 primitives can form C(14,3) = 364 unique 3-primitive combinations. That's more than enough for any domain."

#### World-Class Compositions (Combining Primitives for Major Domains)

> **Kay**: "The power is not in the primitives alone, but in how they compose."

These compositions show how the 14 primitives combine to support world-class applications:

```typescript
// ============================================================================
// COMPOSITION: SOCIAL PLATFORM (Instagram/Facebook/Reddit)
// ============================================================================
const tc_social_platform: TechniqueComposition = {
  id: 'tc_social_platform',
  name: 'Social Platform Analysis',
  description: 'Understand and modify social platform codebases',
  primitives: [
    'tp_algorithm_trace',    // Feed ranking, content ordering
    'tp_policy_verify',      // Content moderation rules
    'tp_metric_trace',       // Engagement metrics
    'tp_realtime_flow',      // Live updates, notifications
    'tp_state_trace',        // User state, content lifecycle
    'tp_data_lineage',       // Data flow from creation to display
  ],
  operators: [
    { type: 'parallel', inputs: ['tp_algorithm_trace', 'tp_policy_verify'] },
    { type: 'sequence', inputs: ['tp_metric_trace', 'tp_realtime_flow'] },
  ],
  patterns: ['pattern_feature_construction', 'pattern_performance_investigation'],
};

// ============================================================================
// COMPOSITION: VIDEO PLATFORM (YouTube)
// ============================================================================
const tc_video_platform: TechniqueComposition = {
  id: 'tc_video_platform',
  name: 'Video Platform Analysis',
  description: 'Understand and modify video platform codebases',
  primitives: [
    'tp_media_pipeline',     // Transcoding, processing
    'tp_algorithm_trace',    // Recommendations, search
    'tp_distribution_map',   // CDN, edge caching
    'tp_metric_trace',       // Watch time, engagement
    'tp_data_lineage',       // Video metadata flow
    'tp_timing_bound',       // Latency requirements
  ],
  operators: [
    { type: 'sequence', inputs: ['tp_media_pipeline', 'tp_distribution_map'] },
    { type: 'parallel', inputs: ['tp_algorithm_trace', 'tp_metric_trace'] },
  ],
  patterns: ['pattern_performance_investigation', 'pattern_change_verification'],
};

// ============================================================================
// COMPOSITION: INDUSTRIAL BACKEND (Scale Systems)
// ============================================================================
const tc_industrial_backend: TechniqueComposition = {
  id: 'tc_industrial_backend',
  name: 'Industrial Backend Analysis',
  description: 'Understand and modify high-scale backend systems',
  primitives: [
    'tp_scale_pattern',      // Sharding, replication, partitioning
    'tp_distribution_map',   // Service topology, data locality
    'tp_timing_bound',       // Latency SLAs, timeouts
    'tp_state_trace',        // Consistency, transactions
    'tp_realtime_flow',      // Event sourcing, CQRS
    'tp_data_lineage',       // Data flow through services
  ],
  operators: [
    { type: 'parallel', inputs: ['tp_scale_pattern', 'tp_distribution_map'] },
    { type: 'gate', inputs: ['tp_timing_bound', 'tp_state_trace'] },
  ],
  patterns: ['pattern_performance_investigation', 'pattern_refactoring'],
};

// ============================================================================
// COMPOSITION: DEVELOPER TOOL (Claude Code/Codex)
// ============================================================================
const tc_developer_tool: TechniqueComposition = {
  id: 'tc_developer_tool',
  name: 'Developer Tool Analysis',
  description: 'Understand and modify developer tools and AI coding assistants',
  primitives: [
    'tp_tool_orchestration', // Tool coordination, MCP, LSP
    'tp_data_lineage',       // Context assembly, prompt flow
    'tp_algorithm_trace',    // Ranking, selection algorithms
    'tp_state_trace',        // Conversation state, sessions
    'tp_timing_bound',       // Response latency
    'tp_component_graph',    // UI/CLI component structure
  ],
  operators: [
    { type: 'sequence', inputs: ['tp_tool_orchestration', 'tp_data_lineage'] },
    { type: 'parallel', inputs: ['tp_algorithm_trace', 'tp_state_trace'] },
  ],
  patterns: ['pattern_feature_construction', 'pattern_bug_investigation'],
};

// ============================================================================
// COMPOSITION: DASHBOARD (B2B/B2C)
// ============================================================================
const tc_dashboard: TechniqueComposition = {
  id: 'tc_dashboard',
  name: 'Dashboard Analysis',
  description: 'Understand and modify dashboard applications',
  primitives: [
    'tp_component_graph',    // Widget composition
    'tp_data_lineage',       // Data sources → widgets
    'tp_realtime_flow',      // Live updates
    'tp_policy_verify',      // Permission/visibility rules
    'tp_metric_trace',       // User interaction metrics
  ],
  operators: [
    { type: 'sequence', inputs: ['tp_data_lineage', 'tp_component_graph'] },
    { type: 'parallel', inputs: ['tp_realtime_flow', 'tp_policy_verify'] },
  ],
  patterns: ['pattern_feature_construction', 'pattern_change_verification'],
};

// ============================================================================
// COMPOSITION: LANDING PAGE / MARKETING
// ============================================================================
const tc_landing_page: TechniqueComposition = {
  id: 'tc_landing_page',
  name: 'Landing Page Analysis',
  description: 'Understand and optimize marketing/landing pages',
  primitives: [
    'tp_component_graph',    // Page structure
    'tp_metric_trace',       // Conversion metrics, Core Web Vitals
    'tp_artifact_trace',     // Design assets → components
    'tp_timing_bound',       // Load time budgets
    'tp_data_lineage',       // Analytics flow
  ],
  operators: [
    { type: 'parallel', inputs: ['tp_component_graph', 'tp_artifact_trace'] },
    { type: 'sequence', inputs: ['tp_metric_trace', 'tp_timing_bound'] },
  ],
  patterns: ['pattern_performance_investigation', 'pattern_change_verification'],
};

// ============================================================================
// COMPOSITION: PAYMENT/TRANSACTION SYSTEM
// ============================================================================
const tc_payment_system: TechniqueComposition = {
  id: 'tc_payment_system',
  name: 'Payment System Analysis',
  description: 'Understand and modify payment/transaction systems',
  primitives: [
    'tp_state_trace',        // Transaction states, idempotency
    'tp_policy_verify',      // PCI compliance, fraud rules
    'tp_data_lineage',       // Money flow, audit trail
    'tp_timing_bound',       // Timeout handling
    'tp_scale_pattern',      // High-availability patterns
  ],
  operators: [
    { type: 'sequence', inputs: ['tp_state_trace', 'tp_policy_verify'] },
    { type: 'gate', inputs: ['tp_data_lineage'], parameters: { requiresAudit: true } },
  ],
  patterns: ['pattern_change_verification', 'pattern_bug_investigation'],
};
```

#### Composition Registry for World-Class Apps

| Composition | Primary Domains | Core Primitives | Patterns |
|-------------|-----------------|-----------------|----------|
| `tc_social_platform` | Instagram, Facebook, Reddit, Twitter | algorithm, policy, metric, realtime | feature, performance |
| `tc_video_platform` | YouTube, TikTok, Twitch | media, algorithm, distribution | performance, verification |
| `tc_industrial_backend` | Scale systems, HA, Microservices | scale, distribution, timing, state | performance, refactoring |
| `tc_developer_tool` | Claude Code, Codex, Copilot | tool_orchestration, data_lineage | feature, bug |
| `tc_dashboard` | B2B SaaS, Analytics, Admin panels | component, data_lineage, realtime | feature, verification |
| `tc_landing_page` | Marketing sites, Conversion pages | component, metric, artifact | performance, verification |
| `tc_payment_system` | Stripe, Payment processing | state, policy, data_lineage | verification, bug |
| `tc_e_commerce` | Shopify, Amazon-style | metric, state, data_lineage | feature, performance |
| `tc_search_system` | Algolia, Elasticsearch apps | algorithm, data_lineage, timing | performance, feature |
| `tc_notification` | Push, Email, In-app alerts | realtime, state, distribution | feature, bug |

**Self-Critique (Brooks)**: "This looks comprehensive, but have we tested it? Can these compositions actually help build a clone of Instagram?"

**Response (Knuth)**: "The compositions are theoretical until validated. Implementation priority should include a 'weathervane' test: build something real with these primitives and compositions, then iterate."

#### Universal Domain Coverage: The Completeness Argument

> **Turing**: "The question is not whether we can enumerate all domains, but whether our primitives cover all FUNDAMENTAL computational concerns."

**The 25 Greats' Claim**: The 14 primitives are **complete** for any conceivable software domain because they correspond to the **fundamental aspects of computation and information**:

```
┌────────────────────────────────────────────────────────────────────────────┐
│                    FUNDAMENTAL COMPUTATION ASPECTS                          │
│                                                                            │
│  Every software system, regardless of domain, must handle:                 │
│                                                                            │
│  1. DATA      → Where does data come from, go to, transform?               │
│                 Primitives: tp_data_lineage, tp_artifact_trace              │
│                                                                            │
│  2. STATE     → What are the possible states and transitions?              │
│                 Primitives: tp_state_trace                                  │
│                                                                            │
│  3. TIME      → What are timing constraints and sequences?                 │
│                 Primitives: tp_timing_bound, tp_realtime_flow               │
│                                                                            │
│  4. SPACE     → Where does execution happen? What's the topology?          │
│                 Primitives: tp_platform_map, tp_distribution_map            │
│                                                                            │
│  5. LOGIC     → What rules/policies govern behavior?                       │
│                 Primitives: tp_policy_verify, tp_algorithm_trace            │
│                                                                            │
│  6. STRUCTURE → How are components organized and composed?                 │
│                 Primitives: tp_component_graph, tp_scale_pattern            │
│                                                                            │
│  7. VALUE     → What metrics/outcomes matter?                              │
│                 Primitives: tp_metric_trace                                 │
│                                                                            │
│  8. AGENCY    → What tools/agents act on the system?                       │
│                 Primitives: tp_tool_orchestration                           │
│                                                                            │
│  9. MEDIA     → What content/assets flow through?                          │
│                 Primitives: tp_media_pipeline                               │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

**The Completeness Proof (Informal)**:

**Claim**: Any software domain D can be analyzed using a subset of the 14 primitives.

**Proof sketch**:
1. Every domain D involves some combination of: data manipulation, state management, timing concerns, spatial distribution, business logic, structural organization, value measurement, external agency, and media handling.
2. Each of these concerns maps to one or more of the 9 fundamental aspects above.
3. Each fundamental aspect is covered by one or more primitives.
4. Therefore, any domain D can be analyzed by selecting the relevant primitives and composing them.

**Self-Critique (Pearl)**: "This is not a formal proof. How do we know we haven't missed a fundamental aspect?"

**Response (McCarthy)**: "We can't prove completeness formally, but we CAN test it empirically. For any new domain X that seems unsupported, we ask: which fundamental aspect is missing? If we find one, we add a primitive. If we don't, X is already supported."

#### The Domain Construction Protocol

> **For ANY domain not explicitly listed, use this protocol:**

```typescript
/**
 * Domain Construction Protocol
 *
 * Given a new domain D, construct its LiBrainian support:
 */

function constructDomainSupport(domain: DomainDescription): TechniqueComposition {
  // Step 1: Decompose domain into fundamental aspects
  const aspects = decomposeToAspects(domain);
  // Example: "Quantum Computing IDE" →
  //   { data: true, state: true, time: true, logic: true, structure: true, agency: true }

  // Step 2: Map aspects to primitives
  const primitives = aspects.flatMap(aspect => ASPECT_TO_PRIMITIVES[aspect]);
  // Example: ['tp_data_lineage', 'tp_state_trace', 'tp_timing_bound',
  //           'tp_algorithm_trace', 'tp_component_graph', 'tp_tool_orchestration']

  // Step 3: Identify domain-specific patterns
  const patterns = selectPatterns(domain, primitives);
  // Example: ['pattern_bug_investigation', 'pattern_performance_investigation']

  // Step 4: Compose with appropriate operators
  const operators = inferOperators(domain, primitives);
  // Example: parallel for independent analyses, sequence for dependent ones

  // Step 5: Generate composition
  return {
    id: `tc_${domain.id}`,
    name: `${domain.name} Analysis`,
    description: `Understand and modify ${domain.name} codebases`,
    primitives,
    operators,
    patterns,
  };
}

// Aspect → Primitive mapping (the core of universal support)
const ASPECT_TO_PRIMITIVES: Record<FundamentalAspect, string[]> = {
  data:      ['tp_data_lineage', 'tp_artifact_trace'],
  state:     ['tp_state_trace'],
  time:      ['tp_timing_bound', 'tp_realtime_flow'],
  space:     ['tp_platform_map', 'tp_distribution_map'],
  logic:     ['tp_policy_verify', 'tp_algorithm_trace'],
  structure: ['tp_component_graph', 'tp_scale_pattern'],
  value:     ['tp_metric_trace'],
  agency:    ['tp_tool_orchestration'],
  media:     ['tp_media_pipeline'],
};
```

#### Example: Domains We Haven't Thought Of Yet

| Hypothetical Domain | Decomposition | Primitive Selection |
|---------------------|---------------|---------------------|
| **Quantum Computing IDE** | data, state, time, logic, agency | data_lineage, state_trace, timing_bound, algorithm_trace, tool_orchestration |
| **Brain-Computer Interface** | data, time, space, media, value | data_lineage, timing_bound, platform_map, media_pipeline, metric_trace |
| **Autonomous Vehicle Fleet** | state, time, space, logic, value | state_trace, realtime_flow, distribution_map, policy_verify, metric_trace |
| **Gene Editing Platform** | data, state, logic, value | data_lineage, state_trace, policy_verify, metric_trace |
| **Climate Simulation** | data, time, space, structure | data_lineage, timing_bound, distribution_map, scale_pattern |
| **Digital Twin System** | data, state, time, space, structure | data_lineage, state_trace, realtime_flow, platform_map, component_graph |
| **Metaverse Platform** | state, space, media, structure, value | state_trace, distribution_map, media_pipeline, component_graph, metric_trace |
| **Cryptocurrency Exchange** | state, time, logic, value | state_trace, timing_bound, policy_verify, metric_trace |
| **AI Training Pipeline** | data, time, logic, value | data_lineage, timing_bound, algorithm_trace, metric_trace |
| **Space Mission Control** | state, time, space, logic, agency | state_trace, realtime_flow, distribution_map, policy_verify, tool_orchestration |

**The 25 Greats' Final Verdict on Completeness**:

**Dijkstra**: "We cannot enumerate all possible domains, but we can identify all fundamental computational concerns. The 9 aspects above are grounded in computation theory, not domain enumeration."

**Kay**: "The test of a truly object-oriented system is whether new kinds of objects can be added without changing the system. The test of truly universal primitives is whether new domains can be supported without adding primitives."

**Armstrong**: "Let the domain fail gracefully. If someone tries to use LiBrainian for a domain and finds it inadequate, the failure should clearly indicate which fundamental aspect is missing—then we can add a primitive."

**The Guarantee**: For any domain D:
1. If D can be fully supported by existing primitives, LiBrainian provides that support.
2. If D reveals a missing fundamental aspect, that aspect becomes a new primitive.
3. The protocol above provides the construction method.
4. No domain is unsupportable—at worst, we learn what's missing.

#### How LiBrainian's Existing Structures Enable Universal Domain Support

> **Kay**: "The structures are the system. If the structures are right, everything else follows."

**LiBrainian's Architecture for Universal Domains**:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    LiBrainian UNIVERSAL DOMAIN ARCHITECTURE                   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ LAYER 1: FUNDAMENTAL PRIMITIVES (14 domain-agnostic)                │    │
│  │                                                                     │    │
│  │ ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐        │    │
│  │ │ tp_data_   │ │ tp_state_  │ │ tp_timing_ │ │ tp_platform│        │    │
│  │ │ lineage    │ │ trace      │ │ bound      │ │ _map       │        │    │
│  │ └────────────┘ └────────────┘ └────────────┘ └────────────┘        │    │
│  │ ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐        │    │
│  │ │ tp_policy_ │ │ tp_algorithm│ │ tp_component│ │ tp_scale_  │        │    │
│  │ │ verify     │ │ _trace     │ │ _graph     │ │ pattern    │        │    │
│  │ └────────────┘ └────────────┘ └────────────┘ └────────────┘        │    │
│  │ ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐        │    │
│  │ │ tp_metric_ │ │ tp_tool_   │ │ tp_media_  │ │ tp_realtime│        │    │
│  │ │ trace      │ │ orchestrate│ │ pipeline   │ │ _flow      │        │    │
│  │ └────────────┘ └────────────┘ └────────────┘ └────────────┘        │    │
│  │                 ┌────────────┐ ┌────────────┐                       │    │
│  │                 │ tp_artifact│ │ tp_distrib │                       │    │
│  │                 │ _trace     │ │ _map       │                       │    │
│  │                 └────────────┘ └────────────┘                       │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                    │                                        │
│                                    ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ LAYER 2: COMPOSITION OPERATORS (6 types)                            │    │
│  │                                                                     │    │
│  │  sequence  │  parallel  │  conditional  │  loop  │  gate  │ quorum  │    │
│  │     ──→    │    ═══     │     ◇──       │   ↻    │   ⊢    │   ⊕     │    │
│  │                                                                     │    │
│  │  Rules: Closure (A ∘ B → C), Associativity, Identity               │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                    │                                        │
│                                    ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ LAYER 3: COMPOSITIONS (Built from primitives + operators)           │    │
│  │                                                                     │    │
│  │  tc_social_platform    tc_video_platform    tc_industrial_backend   │    │
│  │  tc_developer_tool     tc_dashboard         tc_landing_page         │    │
│  │  tc_payment_system     tc_e_commerce        tc_search_system        │    │
│  │  tc_notification       tc_[user_defined]    tc_[auto_generated]     │    │
│  │                                                                     │    │
│  │  + Domain Construction Protocol for ANY new domain                  │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                    │                                        │
│                                    ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ LAYER 4: PATTERNS (Reusable composition templates)                  │    │
│  │                                                                     │    │
│  │  pattern_bug_investigation      pattern_performance_investigation   │    │
│  │  pattern_change_verification    pattern_release_verification        │    │
│  │  pattern_feature_construction   pattern_refactoring                 │    │
│  │  pattern_multi_agent_task       pattern_self_improvement            │    │
│  │                                                                     │    │
│  │  Patterns select and configure compositions for common tasks        │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                    │                                        │
│                                    ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ LAYER 5: LCL (LiBrainian Configuration Language)                     │    │
│  │                                                                     │    │
│  │  lcl.compose('my_domain')                                           │    │
│  │     .use('tc_social_platform')                                      │    │
│  │     .override({ primitives: ['tp_realtime_flow', 'tp_metric_trace']})│    │
│  │     .when('domain.hasPayments').add('tc_payment_system')            │    │
│  │     .build()                                                        │    │
│  │                                                                     │    │
│  │  Declarative composition of any domain from existing structures     │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**How Existing LiBrainian Files Map to Universal Support**:

| LiBrainian Structure | File | Role in Universal Support |
|---------------------|------|--------------------------|
| **TechniquePrimitive** | `technique_library.ts` | Defines the 14 fundamental primitives |
| **TechniqueComposition** | `technique_compositions.ts` | Pre-built domain compositions |
| **TechniqueOperator** | `operator_registry.ts` | 6 composition operators |
| **CompositionPattern** | `pattern_catalog.ts` | Reusable composition templates |
| **CompositionBuilder** | `technique_composition_builder.ts` | Fluent API for building compositions |
| **LCLExpression** | `lcl.ts` (to implement) | Declarative configuration |
| **DomainConstructor** | `domain_constructor.ts` (to implement) | Auto-generates compositions |

**The Implementation Plan for Universal Domain Support**:

| Priority | Feature | LOC | Description |
|----------|---------|-----|-------------|
| **D1** | Add 7 new primitives | ~350 | tp_algorithm_trace, tp_component_graph, tp_scale_pattern, tp_realtime_flow, tp_media_pipeline, tp_tool_orchestration, tp_distribution_map |
| **D2** | Add 10 world-class compositions | ~500 | tc_social_platform, tc_video_platform, etc. |
| **D3** | Domain Construction Protocol | ~200 | Auto-generate compositions from aspects |
| **D4** | Aspect Decomposer | ~150 | LLM-assisted aspect identification |
| **D5** | Composition Validator | ~100 | Verify compositions are valid |
| **D6** | Universal Domain Tests | ~300 | Tests for each of the 10 hypothetical domains |

**Total new LOC for universal domain support: ~1,600**

---

#### External API Support: Helping Agents Use APIs Effectively

> **Kay**: "An agent that can't effectively use external APIs is an agent that can't build real applications."

**The Problem**: Modern applications integrate with dozens of external APIs (Stripe, Twilio, AWS, GitHub, etc.). Agents need to:
1. Understand what APIs the codebase uses
2. Know the correct way to call each API
3. Handle authentication, rate limits, and errors
4. Optimize API usage (batching, caching, retries)

**Current State**: LiBrainian's `api_indexer.ts` indexes APIs the codebase **EXPOSES** (OpenAPI/GraphQL parsing). It does NOT help with APIs the codebase **CONSUMES**.

**The 25 Greats' Solution: External API Primitives**

```typescript
// ============================================================================
// EXTERNAL API PRIMITIVE SET
// ============================================================================

/**
 * tp_api_discovery: Discover which external APIs a codebase uses
 *
 * Analyzes code to find:
 * - HTTP client calls (fetch, axios, got, etc.)
 * - SDK imports (stripe, twilio, aws-sdk, etc.)
 * - Environment variables for API keys
 * - Configuration files with API endpoints
 */
export const tp_api_discovery: TechniquePrimitive = {
  id: 'tp_api_discovery',
  name: 'External API Discovery',
  description: 'Discover all external APIs used by the codebase',
  inputs: [{ name: 'codebase', type: 'string' }],
  outputs: [
    { name: 'apis', type: 'ExternalAPI[]' },
    { name: 'sdks', type: 'SDK[]' },
    { name: 'endpoints', type: 'Endpoint[]' },
  ],
  confidence: placeholder(0.8, 'API-CALIB-001'),
};

/**
 * tp_api_schema_fetch: Fetch and parse API documentation/schemas
 *
 * For each discovered API:
 * - Fetch OpenAPI/Swagger specs if available
 * - Parse SDK type definitions
 * - Extract from documentation (LLM-assisted)
 */
export const tp_api_schema_fetch: TechniquePrimitive = {
  id: 'tp_api_schema_fetch',
  name: 'API Schema Fetching',
  description: 'Fetch and parse schemas for external APIs',
  inputs: [{ name: 'apiId', type: 'string' }, { name: 'version', type: 'string' }],
  outputs: [
    { name: 'schema', type: 'APISchema' },
    { name: 'endpoints', type: 'EndpointSpec[]' },
    { name: 'types', type: 'TypeDefinition[]' },
  ],
  confidence: placeholder(0.7, 'API-CALIB-002'),
};

/**
 * tp_api_usage_trace: Trace how the codebase uses each API
 *
 * For each API call site:
 * - What parameters are passed
 * - How responses are handled
 * - What errors are caught
 * - What retries/fallbacks exist
 */
export const tp_api_usage_trace: TechniquePrimitive = {
  id: 'tp_api_usage_trace',
  name: 'API Usage Tracing',
  description: 'Trace how external APIs are used throughout the codebase',
  inputs: [{ name: 'apiId', type: 'string' }],
  outputs: [
    { name: 'callSites', type: 'APICallSite[]' },
    { name: 'patterns', type: 'UsagePattern[]' },
    { name: 'errorHandling', type: 'ErrorHandling[]' },
  ],
  confidence: placeholder(0.75, 'API-CALIB-003'),
};

/**
 * tp_api_auth_trace: Understand authentication flows
 *
 * Trace how API authentication is handled:
 * - Where credentials come from (env, secrets manager, etc.)
 * - OAuth flows, token refresh
 * - API key rotation
 */
export const tp_api_auth_trace: TechniquePrimitive = {
  id: 'tp_api_auth_trace',
  name: 'API Authentication Tracing',
  description: 'Trace authentication and credential management for APIs',
  inputs: [{ name: 'apiId', type: 'string' }],
  outputs: [
    { name: 'authMethod', type: 'AuthMethod' },
    { name: 'credentialSources', type: 'CredentialSource[]' },
    { name: 'tokenManagement', type: 'TokenManagement' },
  ],
  confidence: placeholder(0.7, 'API-CALIB-004'),
};

/**
 * tp_api_rate_limit: Understand rate limiting and quotas
 *
 * For each API:
 * - What are the rate limits
 * - How is rate limiting handled in code
 * - Are there retry/backoff strategies
 */
export const tp_api_rate_limit: TechniquePrimitive = {
  id: 'tp_api_rate_limit',
  name: 'API Rate Limit Analysis',
  description: 'Analyze rate limiting and quota management',
  inputs: [{ name: 'apiId', type: 'string' }],
  outputs: [
    { name: 'limits', type: 'RateLimit[]' },
    { name: 'handling', type: 'RateLimitHandling' },
    { name: 'recommendations', type: 'Recommendation[]' },
  ],
  confidence: placeholder(0.6, 'API-CALIB-005'),
};

/**
 * tp_api_optimization: Identify optimization opportunities
 *
 * For each API usage:
 * - Can calls be batched?
 * - Can responses be cached?
 * - Are there unnecessary calls?
 * - Can pagination be optimized?
 */
export const tp_api_optimization: TechniquePrimitive = {
  id: 'tp_api_optimization',
  name: 'API Usage Optimization',
  description: 'Identify opportunities to optimize API usage',
  inputs: [{ name: 'apiId', type: 'string' }],
  outputs: [
    { name: 'batchingOpportunities', type: 'BatchOpportunity[]' },
    { name: 'cachingOpportunities', type: 'CacheOpportunity[]' },
    { name: 'redundantCalls', type: 'RedundantCall[]' },
  ],
  confidence: placeholder(0.65, 'API-CALIB-006'),
};
```

**The External API Composition**:

```typescript
const tc_external_api: TechniqueComposition = {
  id: 'tc_external_api',
  name: 'External API Analysis',
  description: 'Comprehensive analysis of external API usage',
  primitives: [
    'tp_api_discovery',      // What APIs are used
    'tp_api_schema_fetch',   // Get API specs
    'tp_api_usage_trace',    // How they're used
    'tp_api_auth_trace',     // Auth handling
    'tp_api_rate_limit',     // Rate limit handling
    'tp_api_optimization',   // Optimization opportunities
    'tp_policy_verify',      // Security/compliance
    'tp_data_lineage',       // Data flow through APIs
  ],
  operators: [
    { type: 'sequence', inputs: ['tp_api_discovery', 'tp_api_schema_fetch'] },
    { type: 'parallel', inputs: ['tp_api_usage_trace', 'tp_api_auth_trace', 'tp_api_rate_limit'] },
    { type: 'sequence', inputs: ['tp_api_optimization', 'tp_policy_verify'] },
  ],
  patterns: ['pattern_bug_investigation', 'pattern_performance_investigation'],
};
```

**How This Helps Agents**:

| Agent Task | Without API Support | With API Support |
|------------|--------------------|--------------------|
| "Add Stripe payment" | Agent guesses SDK usage | Agent sees existing Stripe patterns, auth setup, error handling |
| "Why is this slow?" | Agent can't see API calls | Agent identifies N+1 API calls, missing caching |
| "Is this secure?" | Agent misses API key exposure | Agent traces credential flow, identifies leaks |
| "Add new API endpoint" | Agent makes inconsistent choices | Agent follows existing patterns for auth, retries, logging |
| "Debug API error" | Agent can't trace the call | Agent shows full request/response flow |

**API Knowledge Store**:

```typescript
/**
 * For each external API, LiBrainian maintains:
 */
interface ExternalAPIKnowledge {
  // Identity
  id: string;  // e.g., 'stripe', 'twilio', 'github'
  name: string;
  version: string;

  // Schema (fetched/cached)
  schema: {
    openApiSpec?: OpenAPISpec;
    sdkTypes?: TypeDefinition[];
    documentation?: DocumentationCache;
    lastFetched: string;
  };

  // Usage in this codebase
  usage: {
    callSites: APICallSite[];
    patterns: UsagePattern[];
    wrappers: WrapperFunction[];  // Custom client wrappers
    errorHandlers: ErrorHandler[];
  };

  // Constraints
  constraints: {
    rateLimits: RateLimit[];
    quotas: Quota[];
    authentication: AuthRequirements;
    dataResidency?: string[];
  };

  // Optimization state
  optimization: {
    cachingInPlace: boolean;
    batchingInPlace: boolean;
    opportunities: Opportunity[];
  };

  // Evidence
  evidence: {
    confidence: QuantifiedValue;
    lastVerified: string;
    sources: string[];
  };
}
```

**Implementation Priority for External API Support**:

| Priority | Feature | LOC | Description |
|----------|---------|-----|-------------|
| **A1** | tp_api_discovery | ~200 | Detect HTTP clients, SDKs, env vars |
| **A2** | tp_api_schema_fetch | ~300 | Fetch and cache OpenAPI specs |
| **A3** | tp_api_usage_trace | ~250 | Trace call sites and patterns |
| **A4** | tp_api_auth_trace | ~150 | Trace auth flows |
| **A5** | tp_api_rate_limit | ~150 | Analyze rate limiting |
| **A6** | tp_api_optimization | ~200 | Identify optimization opportunities |
| **A7** | tc_external_api composition | ~100 | Compose into full analysis |
| **A8** | API Knowledge Store | ~200 | Persistent API knowledge |

**Total for External API Support: ~1,550 LOC**

**Integration with Existing LiBrainian**:

The external API primitives integrate with existing structures:

| Existing Structure | Integration |
|-------------------|-------------|
| `api_indexer.ts` | Extend to discover consumed APIs, not just exposed |
| `tp_data_lineage` | Trace data flow TO and FROM external APIs |
| `tp_policy_verify` | Verify API usage meets security policies |
| `tc_industrial_backend` | Add API optimization to backend analysis |
| Pattern catalog | Add `pattern_api_integration` for API-focused investigations |

**Self-Critique (Brooks)**: "External API support seems like a lot of work. Is it essential?"

**Response (Kay)**: "An agent building a payment system without understanding Stripe is like a carpenter without a hammer. API support isn't optional—it's how modern applications work."

---

#### Additional Agentic Workflow Gaps (25 Greats' Audit)

> **Armstrong**: "An agent system without proper workflow support is like an actor system without supervision trees—it will fail badly."

The 25 greats identify these **critical gaps** in agentic workflow support:

##### Gap 1: Agent Testing & Evaluation

**Problem**: How do you test that an agent BEHAVES correctly, not just that its code compiles?

```typescript
/**
 * Agent behavior testing primitives
 */

// tp_agent_test_trace: Trace agent behavior for testing
export const tp_agent_test_trace: TechniquePrimitive = {
  id: 'tp_agent_test_trace',
  name: 'Agent Test Tracing',
  description: 'Capture agent behavior for replay and evaluation',
  inputs: [{ name: 'agentId', type: 'string' }, { name: 'scenario', type: 'TestScenario' }],
  outputs: [
    { name: 'trace', type: 'AgentTrace' },
    { name: 'decisions', type: 'Decision[]' },
    { name: 'toolCalls', type: 'ToolCall[]' },
  ],
  confidence: placeholder(0.8, 'AGENT-TEST-001'),
};

// tp_agent_eval: Evaluate agent performance against criteria
export const tp_agent_eval: TechniquePrimitive = {
  id: 'tp_agent_eval',
  name: 'Agent Evaluation',
  description: 'Evaluate agent behavior against quality criteria',
  inputs: [{ name: 'trace', type: 'AgentTrace' }, { name: 'criteria', type: 'EvalCriteria' }],
  outputs: [
    { name: 'scores', type: 'EvalScore[]' },
    { name: 'failures', type: 'Failure[]' },
    { name: 'recommendations', type: 'Recommendation[]' },
  ],
  confidence: placeholder(0.7, 'AGENT-TEST-002'),
};

interface AgentTestFramework {
  // Scenario definition
  defineScenario(scenario: TestScenario): ScenarioId;

  // Run agent with tracing
  runWithTrace(agentId: string, scenarioId: ScenarioId): Promise<AgentTrace>;

  // Replay for debugging
  replay(trace: AgentTrace, fromStep?: number): void;

  // Evaluation
  evaluate(trace: AgentTrace, criteria: EvalCriteria): EvalResult;

  // Regression detection
  detectRegression(newTrace: AgentTrace, baselineTrace: AgentTrace): RegressionReport;
}
```

##### Gap 2: Cost Optimization

**Problem**: LLM calls are expensive. How do agents minimize cost while maintaining quality?

```typescript
/**
 * Cost optimization primitives
 */

// tp_cost_trace: Trace costs across agent operations
export const tp_cost_trace: TechniquePrimitive = {
  id: 'tp_cost_trace',
  name: 'Cost Tracing',
  description: 'Track token usage and cost across agent operations',
  inputs: [{ name: 'operation', type: 'Operation' }],
  outputs: [
    { name: 'tokenUsage', type: 'TokenUsage' },
    { name: 'costUSD', type: 'number' },
    { name: 'breakdown', type: 'CostBreakdown' },
  ],
  confidence: placeholder(0.9, 'COST-001'),  // Deterministic
};

// tp_cost_optimize: Identify cost optimization opportunities
export const tp_cost_optimize: TechniquePrimitive = {
  id: 'tp_cost_optimize',
  name: 'Cost Optimization',
  description: 'Identify opportunities to reduce costs',
  inputs: [{ name: 'traces', type: 'CostTrace[]' }],
  outputs: [
    { name: 'opportunities', type: 'CostOpportunity[]' },
    { name: 'modelDowngrades', type: 'ModelDowngrade[]' },
    { name: 'cachingOpportunities', type: 'CacheOpportunity[]' },
  ],
  confidence: placeholder(0.7, 'COST-002'),
};

interface CostManagement {
  // Budget limits
  setBudget(agentId: string, budgetUSD: number, period: 'hour' | 'day' | 'task'): void;

  // Cost tracking
  trackCost(operation: Operation, tokenUsage: TokenUsage): void;

  // Model selection based on cost/quality tradeoff
  selectModel(task: Task, qualityRequired: number, budgetRemaining: number): ModelId;

  // Caching
  shouldCache(query: string, cost: number): boolean;
  getCached(query: string): CachedResult | null;
}
```

##### Gap 3: Human-in-the-Loop Integration

**Problem**: Agents need to pause for human approval, input, or guidance. How is this modeled?

```typescript
/**
 * Human-in-the-loop primitives
 */

// tp_hitl_checkpoint: Create checkpoint for human review
export const tp_hitl_checkpoint: TechniquePrimitive = {
  id: 'tp_hitl_checkpoint',
  name: 'Human Checkpoint',
  description: 'Create a checkpoint requiring human approval',
  inputs: [
    { name: 'context', type: 'AgentContext' },
    { name: 'question', type: 'string' },
    { name: 'options', type: 'Option[]' },
  ],
  outputs: [
    { name: 'checkpointId', type: 'string' },
    { name: 'status', type: 'CheckpointStatus' },
  ],
  confidence: placeholder(1.0, 'HITL-001'),  // Deterministic
};

// tp_hitl_resume: Resume from human input
export const tp_hitl_resume: TechniquePrimitive = {
  id: 'tp_hitl_resume',
  name: 'Resume from Human',
  description: 'Resume agent execution with human-provided input',
  inputs: [
    { name: 'checkpointId', type: 'string' },
    { name: 'humanResponse', type: 'HumanResponse' },
  ],
  outputs: [
    { name: 'resumedContext', type: 'AgentContext' },
    { name: 'decision', type: 'Decision' },
  ],
  confidence: placeholder(1.0, 'HITL-002'),  // Deterministic
};

interface HumanInTheLoop {
  // Checkpoint creation
  checkpoint(reason: CheckpointReason, context: AgentContext): Promise<HumanResponse>;

  // Approval gates
  requireApproval(action: Action, risk: RiskLevel): Promise<boolean>;

  // Clarification requests
  askClarification(question: string, options?: string[]): Promise<string>;

  // Progress updates (non-blocking)
  notifyProgress(update: ProgressUpdate): void;

  // Escalation
  escalate(issue: Issue, severity: Severity): Promise<Resolution>;
}
```

##### Gap 4: Multi-Agent Communication

**Problem**: How do multiple agents share information, coordinate, and avoid conflicts?

```typescript
/**
 * Multi-agent coordination primitives
 */

// tp_agent_broadcast: Broadcast information to other agents
export const tp_agent_broadcast: TechniquePrimitive = {
  id: 'tp_agent_broadcast',
  name: 'Agent Broadcast',
  description: 'Broadcast information to other agents',
  inputs: [
    { name: 'message', type: 'AgentMessage' },
    { name: 'recipients', type: 'AgentId[] | "all"' },
  ],
  outputs: [{ name: 'delivered', type: 'DeliveryReceipt[]' }],
  confidence: placeholder(0.95, 'MULTI-001'),
};

// tp_agent_coordinate: Coordinate task allocation
export const tp_agent_coordinate: TechniquePrimitive = {
  id: 'tp_agent_coordinate',
  name: 'Agent Coordination',
  description: 'Coordinate task allocation between agents',
  inputs: [
    { name: 'task', type: 'Task' },
    { name: 'agents', type: 'AgentCapability[]' },
  ],
  outputs: [
    { name: 'allocation', type: 'TaskAllocation' },
    { name: 'conflicts', type: 'Conflict[]' },
  ],
  confidence: placeholder(0.75, 'MULTI-002'),
};

interface MultiAgentProtocol {
  // Discovery
  discoverAgents(): AgentDescriptor[];

  // Messaging
  send(to: AgentId, message: AgentMessage): void;
  broadcast(message: AgentMessage): void;
  receive(): AsyncIterable<AgentMessage>;

  // Coordination
  acquireLock(resource: ResourceId): Promise<Lock>;
  releaseLock(lock: Lock): void;

  // Shared state
  publishFinding(finding: Finding): void;
  subscribeTo(topic: Topic): AsyncIterable<Finding>;

  // Conflict resolution
  reportConflict(conflict: Conflict): void;
  resolveConflict(conflict: Conflict, resolution: Resolution): void;
}
```

##### Gap 5: Workflow Versioning & Rollback

**Problem**: Agent configurations change. How do you version, compare, and rollback?

```typescript
/**
 * Workflow versioning primitives
 */

// tp_workflow_version: Version a workflow configuration
export const tp_workflow_version: TechniquePrimitive = {
  id: 'tp_workflow_version',
  name: 'Workflow Versioning',
  description: 'Version control for agent workflows',
  inputs: [{ name: 'workflow', type: 'WorkflowConfig' }],
  outputs: [
    { name: 'versionId', type: 'string' },
    { name: 'diff', type: 'WorkflowDiff' },
  ],
  confidence: placeholder(1.0, 'VERSION-001'),  // Deterministic
};

// tp_workflow_rollback: Rollback to previous version
export const tp_workflow_rollback: TechniquePrimitive = {
  id: 'tp_workflow_rollback',
  name: 'Workflow Rollback',
  description: 'Rollback workflow to previous version',
  inputs: [{ name: 'versionId', type: 'string' }],
  outputs: [
    { name: 'restoredWorkflow', type: 'WorkflowConfig' },
    { name: 'rollbackReport', type: 'RollbackReport' },
  ],
  confidence: placeholder(1.0, 'VERSION-002'),  // Deterministic
};

interface WorkflowVersionControl {
  // Versioning
  commit(workflow: WorkflowConfig, message: string): VersionId;
  tag(versionId: VersionId, tag: string): void;

  // History
  history(workflowId: WorkflowId): Version[];
  diff(versionA: VersionId, versionB: VersionId): WorkflowDiff;

  // Rollback
  rollback(versionId: VersionId): WorkflowConfig;

  // A/B testing
  split(versionA: VersionId, versionB: VersionId, ratio: number): SplitConfig;
  comparePerformance(splitId: SplitId): PerformanceComparison;
}
```

##### Gap 6: Agent Observability

**Problem**: What is an agent doing RIGHT NOW? How do you debug a stuck agent?

```typescript
/**
 * Agent observability primitives
 */

// tp_agent_observe: Observe agent state and progress
export const tp_agent_observe: TechniquePrimitive = {
  id: 'tp_agent_observe',
  name: 'Agent Observation',
  description: 'Observe current agent state and progress',
  inputs: [{ name: 'agentId', type: 'string' }],
  outputs: [
    { name: 'state', type: 'AgentState' },
    { name: 'currentTask', type: 'Task' },
    { name: 'progress', type: 'Progress' },
    { name: 'blockers', type: 'Blocker[]' },
  ],
  confidence: placeholder(0.95, 'OBSERVE-001'),
};

// tp_agent_diagnose: Diagnose agent problems
export const tp_agent_diagnose: TechniquePrimitive = {
  id: 'tp_agent_diagnose',
  name: 'Agent Diagnosis',
  description: 'Diagnose why an agent is stuck or failing',
  inputs: [{ name: 'agentId', type: 'string' }, { name: 'symptoms', type: 'Symptom[]' }],
  outputs: [
    { name: 'diagnosis', type: 'Diagnosis' },
    { name: 'rootCause', type: 'RootCause' },
    { name: 'remediation', type: 'Remediation[]' },
  ],
  confidence: placeholder(0.7, 'OBSERVE-002'),
};

interface AgentObservability {
  // Real-time monitoring
  currentState(agentId: AgentId): AgentState;
  subscribe(agentId: AgentId): AsyncIterable<AgentEvent>;

  // Metrics
  getMetrics(agentId: AgentId, window: TimeWindow): AgentMetrics;

  // Debugging
  getCallStack(agentId: AgentId): CallStack;
  getRecentDecisions(agentId: AgentId, limit: number): Decision[];

  // Alerts
  setAlert(condition: AlertCondition, handler: AlertHandler): AlertId;

  // Diagnostics
  diagnose(agentId: AgentId): DiagnosticReport;

  // Intervention
  pause(agentId: AgentId): void;
  resume(agentId: AgentId): void;
  abort(agentId: AgentId, reason: string): void;
}
```

##### Implementation Priorities for Agentic Workflow Support

| Priority | Feature | LOC | Description |
|----------|---------|-----|-------------|
| **W1** | Agent Test Framework | ~300 | tp_agent_test_trace, tp_agent_eval |
| **W2** | Cost Management | ~200 | tp_cost_trace, tp_cost_optimize |
| **W3** | Human-in-the-Loop | ~250 | tp_hitl_checkpoint, tp_hitl_resume |
| **W4** | Multi-Agent Protocol | ~300 | tp_agent_broadcast, tp_agent_coordinate |
| **W5** | Workflow Versioning | ~200 | tp_workflow_version, tp_workflow_rollback |
| **W6** | Agent Observability | ~250 | tp_agent_observe, tp_agent_diagnose |

**Total for Agentic Workflow Support: ~1,500 LOC**

##### The tc_agentic_workflow Composition

```typescript
const tc_agentic_workflow: TechniqueComposition = {
  id: 'tc_agentic_workflow',
  name: 'Full Agentic Workflow Support',
  description: 'Complete support for agentic development workflows',
  primitives: [
    // Testing
    'tp_agent_test_trace',
    'tp_agent_eval',
    // Cost
    'tp_cost_trace',
    'tp_cost_optimize',
    // HITL
    'tp_hitl_checkpoint',
    'tp_hitl_resume',
    // Multi-agent
    'tp_agent_broadcast',
    'tp_agent_coordinate',
    // Versioning
    'tp_workflow_version',
    'tp_workflow_rollback',
    // Observability
    'tp_agent_observe',
    'tp_agent_diagnose',
  ],
  operators: [
    { type: 'parallel', inputs: ['tp_agent_observe', 'tp_cost_trace'] },  // Always-on
    { type: 'conditional', inputs: ['tp_hitl_checkpoint'], parameters: { when: 'riskLevel > threshold' } },
    { type: 'gate', inputs: ['tp_agent_eval'], parameters: { failOnRegression: true } },
  ],
  patterns: ['pattern_multi_agent_task', 'pattern_self_improvement'],
};
```

**The 25 Greats' Verdict on Agentic Workflow Gaps**:

**Armstrong**: "These six gaps—testing, cost, HITL, multi-agent, versioning, observability—are the difference between a demo and a production system. Address them."

**Brooks**: "No silver bullet, but proper workflow support is the closest thing. An agent without observability is a black box that will fail unpredictably."

**Dijkstra**: "Testing agents is harder than testing functions because agents are non-deterministic. The test framework must capture and replay behaviors, not just assert outputs."

---

**Self-Critique (Hoare)**: "1,600 LOC to support any conceivable domain? This seems too good to be true."

**Response (Dijkstra)**: "The 1,600 LOC doesn't implement the domains—it implements the STRUCTURES that enable domain support. The actual analysis is performed by composing existing primitives. That's the power of good abstraction."

#### How Existing Sections Support This

| Existing Section | What It Provides | Gap Addressed |
|-----------------|-----------------|---------------|
| Part XVIII.J (Epistemic Bootstrap) | Zero-knowledge protocol | Domain exploration |
| Part XVIII.K (Universal Applicability) | Situation → Protocol mapping | Domain-specific workflows |
| Part XIV (Composition Evolution) | Learning from outcomes | Domain adaptation |
| Part XVII.H (New Patterns) | 8 additional patterns | Domain templates |

**The 25 greats' verdict**: No new sections needed. The 7 primitives above should be added to Part XVII.A (Universal Code Understanding) as domain-bridging primitives. Part XVIII.K's Universal Applicability Matrix should be extended to include domain-role mappings.

---

### L. The LiBrainian Configuration Language (LCL)

> **Turing**: "A configuration language is a restricted Turing machine—powerful enough to express any composition, constrained enough to guarantee termination."
>
> **Dijkstra**: "Configuration should be syntax-directed: if it parses, it's valid. No runtime surprises."
>
> **Kay**: "The best configuration language is one where configuration IS code—late-bound, composable, inspectable."

#### L.1 Design Philosophy: Composition Over Creation

The LCL does NOT create new primitives or operators. It COMPOSES existing ones.

```typescript
// This is NOT the design:
❌ lcl.createPrimitive({ ... }); // Creating from scratch

// This IS the design:
✅ lcl.compose('my_workflow')
    .use('pattern_bug_investigation')           // Uses EXISTING pattern
    .override({ corePrimitives: ['tp_hypothesis', 'tp_bisect'] })  // EXISTING primitives
    .when('codebase.hasTests === false')        // Condition
    .add('tp_review_tests')                     // EXISTING primitive
    .done();
```

#### L.2 Configuration Primitives (These Already Exist — Just Formalize Access)

**IMPORTANT**: These are NOT new types to implement. They are REFERENCES to existing types in the codebase.

| LCL Primitive | Maps To (Existing) | Location |
|---------------|-------------------|----------|
| `primitive(id)` | `TechniquePrimitive` | `technique_library.ts` |
| `pattern(id)` | `CompositionPattern` | `pattern_catalog.ts` |
| `composition(id)` | `TechniqueComposition` | `technique_compositions.ts` |
| `operator(type)` | `TechniqueOperator` | `operator_registry.ts` |
| `relationship(type)` | `TechniqueRelationship` | `techniques.ts` |

#### L.3 Configuration Grammar (Grounded in Existing Types)

```typescript
// File: packages/LiBrainian/src/api/lcl.ts
// This is a THIN LAYER over existing builders—estimated ~200 LOC

import { CompositionBuilder } from './technique_composition_builder.js';
import { COMPOSITION_PATTERN_CATALOG } from './pattern_catalog.js';
import { DEFAULT_TECHNIQUE_PRIMITIVES_BY_ID } from './technique_library.js';

export interface LCLExpression {
  // All references are to EXISTING IDs in the codebase
  base: 'pattern' | 'composition' | 'primitives';
  baseId?: string;
  primitiveIds?: string[];
  overrides?: Partial<CompositionPattern>;
  conditionals?: LCLConditional[];
  operators?: LCLOperatorSpec[];
}

export interface LCLConditional {
  when: string;  // Simple predicate language (not Turing-complete)
  then: 'add' | 'remove' | 'replace';
  primitiveId: string;
}

export interface LCLOperatorSpec {
  type: TechniqueOperatorType;  // Uses EXISTING operator types
  inputs: string[];
  outputs?: string[];
  parameters?: Record<string, unknown>;
}

// The LCL compiler reduces expressions to EXISTING CompositionBuilder calls
export function compileLCL(expr: LCLExpression): TechniqueComposition {
  const builder = new CompositionBuilder({ now: new Date().toISOString() });

  // Step 1: Start from existing base
  if (expr.base === 'pattern' && expr.baseId) {
    const pattern = COMPOSITION_PATTERN_CATALOG.find(p => p.id === expr.baseId);
    if (!pattern) throw new Error(`unverified_by_trace(lcl_pattern_not_found): ${expr.baseId}`);
    for (const pid of pattern.corePrimitives) {
      builder.addPrimitive(pid);
    }
  }

  // Step 2: Apply conditionals (these reference EXISTING primitives)
  for (const cond of expr.conditionals ?? []) {
    if (!DEFAULT_TECHNIQUE_PRIMITIVES_BY_ID.has(cond.primitiveId)) {
      throw new Error(`unverified_by_trace(lcl_primitive_not_found): ${cond.primitiveId}`);
    }
    // Condition evaluation uses simple predicates, not arbitrary code
    builder.addPrimitive(cond.primitiveId);
  }

  // Step 3: Add operators (uses EXISTING operator registry)
  for (const op of expr.operators ?? []) {
    builder.addOperator(op.type, op.inputs, op.outputs, op.parameters);
  }

  return builder.build();
}
```

#### L.4 Presets: Named Configurations (Not New Code)

**Von Neumann**: "Presets are stored programs—configuration that can be retrieved by name and executed."

Presets are JSON configurations that reference EXISTING elements:

```json
{
  "preset_quick_debug": {
    "base": "pattern",
    "baseId": "pattern_bug_investigation",
    "overrides": {
      "corePrimitives": ["tp_hypothesis", "tp_bisect"]
    },
    "description": "Fast debugging without full root cause analysis"
  },
  "preset_security_review": {
    "base": "pattern",
    "baseId": "pattern_change_verification",
    "conditionals": [
      { "when": "change.touchesAuth", "then": "add", "primitiveId": "tp_threat_model" },
      { "when": "change.touchesInput", "then": "add", "primitiveId": "tp_security_abuse_cases" }
    ]
  },
  "preset_zero_knowledge_bootstrap": {
    "base": "primitives",
    "primitiveIds": ["tp_arch_mapping", "tp_search_history"],
    "operators": [
      { "type": "sequence", "inputs": ["tp_arch_mapping", "tp_search_history"] }
    ],
    "description": "For completely unknown codebases"
  }
}
```

**Implementation**: Presets are stored in `state/LiBrainian/presets.json` and loaded by the existing storage layer. No new storage infrastructure needed.

---

### M. Relations and Structures (Formalizing What Exists)

> **Milner**: "Structure emerges from the relations between components, not from the components themselves."
>
> **Hoare**: "Every relation should be expressible as a pre/post condition pair."

#### M.1 Relationship Types (Already Exist in techniques.ts)

The codebase ALREADY defines relationship types:

```typescript
// FROM strategic/techniques.ts (EXISTING):
export type TechniqueRelationshipType =
  | 'precedes'      // Temporal ordering
  | 'follows'       // Temporal ordering
  | 'requires'      // Dependency
  | 'enables'       // Unlocking
  | 'inhibits'      // Conflict
  | 'amplifies'     // Synergy
  | 'substitutes';  // Equivalence
```

**LCL just makes these relationships first-class configuration targets:**

```typescript
// Configuration syntax (not new code, just configuration):
lcl.relate('tp_hypothesis', 'precedes', 'tp_bisect', {
  rationale: 'Must have hypothesis before testing',
  weight: 0.9
});

lcl.relate('tp_min_repro', 'amplifies', 'tp_bisect', {
  rationale: 'Minimal reproduction makes bisection more effective',
  weight: 0.7
});
```

#### M.2 Structure Templates (Compositions of Existing Operators)

**Knuth**: "Common structures should have names. Named structures become idioms."

Structure templates are NAMED OPERATOR CONFIGURATIONS:

```typescript
// These are configurations, not new operator types:

export const STRUCTURE_TEMPLATES = {
  // Pipeline: sequence of primitives
  pipeline: (primitiveIds: string[]) => ({
    operators: [{
      type: 'sequence' as const,  // EXISTING operator type
      inputs: primitiveIds,
      outputs: [primitiveIds[primitiveIds.length - 1]]
    }]
  }),

  // Fan-out: parallel execution
  fanout: (primitiveIds: string[]) => ({
    operators: [{
      type: 'parallel' as const,  // EXISTING operator type
      inputs: primitiveIds,
      outputs: primitiveIds
    }]
  }),

  // Gated: conditional execution
  gated: (gateId: string, primitiveIds: string[]) => ({
    operators: [{
      type: 'gate' as const,  // EXISTING operator type
      inputs: [gateId, ...primitiveIds],
      outputs: primitiveIds,
      parameters: { failOnGate: true }
    }]
  }),

  // Iterative: loop until condition
  iterative: (primitiveIds: string[], maxIterations = 10) => ({
    operators: [{
      type: 'loop' as const,  // EXISTING operator type
      inputs: primitiveIds,
      parameters: { maxIterations, terminationCondition: 'convergence' }
    }]
  }),

  // Quorum: require agreement
  quorum: (primitiveIds: string[], threshold = 0.5) => ({
    operators: [{
      type: 'quorum' as const,  // EXISTING operator type
      inputs: primitiveIds,
      parameters: { threshold }
    }]
  })
};
```

---

### N. The Epistemic Foundation (Clarifying What LiBrainian Is)

> **Pearl**: "Epistemology without causal structure is mere correlation. LiBrainian must know WHY it believes what it believes."
>
> **McCarthy/Minsky**: "An epistemologically adequate system must distinguish between what it knows, what it believes, what it assumes, and what it doesn't know."

#### N.1 The LiBrainian Epistemic Hierarchy (Conceptual, Not New Code)

This is DOCUMENTATION of LiBrainian's existing epistemic model:

```
Level 0: IGNORANCE
  └─ "I have not examined this"
  └─ Confidence: undefined (not 0, literally undefined)
  └─ Action: Must bootstrap before any claims

Level 1: STRUCTURAL KNOWLEDGE
  └─ "I know what EXISTS" (files, functions, types)
  └─ Source: AST parsing (deterministic, high confidence)
  └─ Confidence: 0.95+ for existence claims
  └─ Existing implementation: storage/tree-sitter parsers

Level 2: RELATIONAL KNOWLEDGE
  └─ "I know how things CONNECT" (imports, calls, inherits)
  └─ Source: Static analysis (deterministic, high confidence)
  └─ Confidence: 0.9+ for dependency claims
  └─ Existing implementation: storage/dependency graph

Level 3: BEHAVIORAL KNOWLEDGE
  └─ "I know what things DO" (semantics, purpose)
  └─ Source: LLM synthesis + test observation
  └─ Confidence: 0.5-0.8 (requires calibration)
  └─ Existing implementation: query_synthesis.ts

Level 4: CAUSAL KNOWLEDGE
  └─ "I know WHY things work this way"
  └─ Source: Reasoning over history, patterns, design docs
  └─ Confidence: 0.3-0.7 (highest uncertainty)
  └─ Existing implementation: learning_loop.ts (partial)

Level 5: PREDICTIVE KNOWLEDGE
  └─ "I can predict consequences of changes"
  └─ Source: Causal model + historical outcomes
  └─ Confidence: Calibrated against actual outcomes
  └─ Existing implementation: confidence_calibration.ts (partial)
```

#### N.2 Epistemic Operations (What Agents Can Ask)

These map to EXISTING query types in the codebase:

| Epistemic Question | Maps To (Existing) | Confidence Source |
|-------------------|-------------------|-------------------|
| "What exists here?" | `listEntities()` | AST (0.95+) |
| "What calls what?" | `getDependencyGraph()` | Static analysis (0.9+) |
| "What does X do?" | `synthesizeExplanation()` | LLM (calibrated) |
| "Why is X designed this way?" | `queryEpisodes()` + reasoning | History (0.3-0.7) |
| "What if I change X?" | `predictImpact()` | Causal model (calibrated) |
| "Should I trust this answer?" | `getConfidenceMetadata()` | Calibration (tracked) |

#### N.3 The Honesty Principle (Dijkstra)

**Dijkstra**: "The competent programmer is fully aware of the strictly limited size of his own skull; therefore he approaches the programming task in full humility."

LiBrainian MUST:
1. **Never claim more than it knows**: If confidence < threshold, say "I don't know"
2. **Track evidence chains**: Every claim traces to source (AST, LLM, inference)
3. **Calibrate against outcomes**: Predicted confidence vs actual accuracy
4. **Degrade gracefully**: If LLM unavailable, report `ProviderUnavailableError`, don't fake answers

This is ALREADY the design. The contribution is making it EXPLICIT and CONFIGURABLE:

```typescript
// Configuration for honesty thresholds (not new code, just config):
{
  "epistemic_policy": {
    "claim_threshold": 0.6,       // Don't claim if confidence < 0.6
    "uncertainty_disclosure": true, // Always report confidence
    "evidence_required": true,     // Every claim needs source
    "calibration_feedback": true   // Feed outcomes back
  }
}
```

#### N.4 The Arbitrary Numbers Problem (25 Greats' Self-Critique)

> **THIS SECTION IS A SELF-CRITIQUE.** The 25 greats recognize a fundamental problem in this document and the codebase.

**The Problem**: Throughout this document and the implementation, confidence values appear:
- Tier 1 extraction: 0.95
- Tier 2 extraction: 0.8
- Tier 3 extraction: 0.6
- Claim threshold: 0.6
- Relationship weight: 0.9, 0.7
- Primitive confidence: 0.5, 0.6, 0.7, 0.8

**Dijkstra**: "These numbers are wishes, not measurements. A confidence of 0.7 that hasn't been validated against outcomes is epistemically meaningless."

**Pearl**: "These are priors without posteriors. Bayesian reasoning requires updating beliefs based on evidence. Where is the evidence?"

**Shannon**: "Information theory requires knowing the actual entropy. These numbers pretend to encode uncertainty without measuring it."

**The Honest Assessment**:

| Number | Source | Validity |
|--------|--------|----------|
| 0.95 (AST extraction) | Intuition: "AST parsing rarely fails" | **Uncalibrated** — actual failure rate unknown |
| 0.8 (hybrid extraction) | Intuition: "LLM helps but isn't perfect" | **Uncalibrated** — no measured accuracy |
| 0.6 (semantic extraction) | Intuition: "Pure LLM is less reliable" | **Uncalibrated** — no benchmarks |
| 0.5-0.7 (primitive confidence) | Copy-pasted from similar systems | **Ungrounded** — no domain basis |

**The Solution** (Required before claiming epistemological adequacy):

```typescript
/**
 * Confidence calibration protocol.
 *
 * INVARIANT: No confidence value may be used in production
 * until it has been calibrated against empirical outcomes.
 */

interface CalibrationProtocol {
  // Phase 1: Track all confidence claims
  recordClaim(claim: Claim, statedConfidence: number): ClaimId;

  // Phase 2: Record actual outcomes
  recordOutcome(claimId: ClaimId, wasCorrect: boolean): void;

  // Phase 3: Compute calibration curve
  computeCalibration(): CalibrationCurve;
  // Returns: for claims with stated confidence X%, what % were actually correct?

  // Phase 4: Adjust future confidences
  calibratedConfidence(rawConfidence: number, extractionType: string): number;
  // Uses empirical calibration to adjust stated confidence
}

// Example calibration curve (hypothetical):
// Stated 0.9 → Actually correct 0.7 → Overconfident
// Stated 0.6 → Actually correct 0.8 → Underconfident
// Stated 0.5 → Actually correct 0.5 → Well-calibrated
```

**Implementation Priority**: This should be **C1** (Calibration 1) — a prerequisite for any confidence claim.

| Priority | Feature | Description | LOC |
|----------|---------|-------------|-----|
| **C1** | Claim-Outcome Tracking | Record every claim and its outcome | ~100 |
| **C2** | Calibration Curve Computation | Measure stated vs actual accuracy | ~150 |
| **C3** | Confidence Adjustment | Apply calibration to future claims | ~100 |
| **C4** | Calibration Dashboard | Visualize calibration for debugging | ~200 |

**Until C1-C3 are implemented**, all confidence values in this document should be read as:

> ⚠️ **UNCALIBRATED**: This value is an intuition-based prior, not an empirically validated confidence.

**The 25 Greats' Verdict**:

**Wirth**: "We should not have shipped these numbers without this disclaimer. Intellectual honesty demands we mark them as uncalibrated."

**Knuth**: "Premature optimization is the root of all evil. Premature confidence quantification is epistemic evil."

**Hoare**: "There are two ways to write code: so simple there are obviously no bugs, or so complex there are no obvious bugs. There are two ways to state confidence: so clearly calibrated there's obviously accuracy, or so arbitrarily stated there's no obvious meaning. We chose the latter, and must fix it."

#### N.5 The Quantification Invariant (Fundamental Resolution)

> **ARCHITECTURAL INVARIANT**: This principle MUST be enforced across all LiBrainian development, past, present, and future.

**The Quantification Invariant (QI)**:

```typescript
/**
 * THE QUANTIFICATION INVARIANT
 *
 * No numeric value representing uncertainty, confidence, weight, probability,
 * threshold, or similar epistemic quantity may be introduced into LiBrainian
 * code or documentation without satisfying ONE of these conditions:
 *
 * 1. DERIVED: The value is mathematically derived from other calibrated values
 * 2. CALIBRATED: The value has been empirically measured against outcomes
 * 3. CONFIGURABLE: The value is explicitly marked as a user-configurable default
 * 4. PLACEHOLDER: The value is marked with @uncalibrated and tracked for calibration
 *
 * Violations of this invariant produce EPISTEMIC DEBT that must be tracked
 * and resolved before claims of epistemological adequacy can be made.
 */

type QuantificationSource =
  | { type: 'derived'; formula: string; inputs: string[] }
  | { type: 'calibrated'; datasetId: string; sampleSize: number; measuredValue: number }
  | { type: 'configurable'; default: number; range: [number, number]; rationale: string }
  | { type: 'placeholder'; trackedIn: string; targetCalibrationDate?: string };

interface QuantifiedValue {
  value: number;
  source: QuantificationSource;
  // If source.type === 'placeholder', this MUST be populated
  uncalibratedWarning?: string;
}
```

**Enforcement Mechanism**:

```typescript
// ESLint rule: no-arbitrary-numbers (to be implemented)
// Flags any numeric literal in confidence/weight/probability contexts
// without a QuantificationSource annotation

// Example violations:
❌ confidence: 0.7                           // Arbitrary literal
❌ threshold: 0.5                            // Arbitrary literal
❌ weight: 0.9                               // Arbitrary literal

// Example compliant code:
✅ confidence: calibrated('ast_extraction', 0.95)  // Calibrated from data
✅ threshold: configurable(0.5, [0, 1], 'user-tunable sensitivity')
✅ weight: derived('base * decay', { base: calibrated(...), decay: ... })
✅ confidence: placeholder(0.7, 'CALIBRATION-001')  // Tracked for later
```

#### N.6 Existing Implementation Fixes Required

**The 25 greats have audited the codebase and identified ALL locations requiring fixes:**

| File | Line(s) | Current Value | Fix Required |
|------|---------|---------------|--------------|
| `technique_library.ts` | Multiple | `confidence: 0.X` in primitives | Wrap with `placeholder()` |
| `pattern_catalog.ts` | Multiple | `baseConfidence: 0.X` | ✅ Wrapped with `placeholder()` |
| `confidence_calibration.ts` | Multiple | Default thresholds | Mark as `configurable()` |
| `context_assembly.ts` | ~50-100 | MMR diversity weight | Mark as `configurable()` |
| `query.ts` | Multiple | Relevance thresholds | Mark as `configurable()` |
| `embeddings.ts` | ~80 | Similarity thresholds | Derive from calibration |
| `technique_execution.ts` | Multiple | Retry thresholds | Mark as `configurable()` |
| Domain-bridging primitives (A.4) | All | `confidence: 0.X` | Wrap with `placeholder()` |
| LCL presets (L.4) | All | Weights in configs | Wrap with `configurable()` |

**Implementation Plan for Fixes**:

| Priority | Feature | LOC | Description |
|----------|---------|-----|-------------|
| **Q1** | QuantifiedValue type | ~50 | ✅ Implemented (core type + helpers) |
| **Q2** | placeholder() wrapper | ~30 | ✅ Implemented |
| **Q3** | configurable() wrapper | ~30 | ✅ Implemented |
| **Q4** | calibrated() wrapper | ~50 | ✅ Implemented |
| **Q5** | Migrate technique_library.ts | ~100 | ✅ Implemented (domain-bridging primitives now use placeholders) |
| **Q6** | Migrate pattern_catalog.ts | ~80 | ✅ Applied placeholders to pattern catalog |
| **Q7** | Migrate remaining files | ~150 | ✅ Implemented (query/context/embeddings/execution/calibration/structures) |
| **Q8** | ESLint rule | ~100 | ✅ Implemented (targeted no-restricted-syntax guard) |

**Total: ~590 LOC to fix all arbitrary numbers**

#### N.7 The Calibration Infrastructure (Required for Resolution)

**The fixes above only MARK values as uncalibrated. True resolution requires calibration infrastructure:**

```typescript
/**
 * Calibration infrastructure for empirical confidence measurement.
 */

interface CalibrationDataset {
  id: string;
  name: string;
  description: string;
  // Ground truth examples
  examples: CalibrationExample[];
  // When collected
  collectedAt: string;
  // Version of LiBrainian used
  librarianVersion: string;
}

interface CalibrationExample {
  // The claim that was made
  claim: {
    type: string;  // e.g., 'entity_extraction', 'relationship_detection'
    context: string;
    statedConfidence: number;
  };
  // The ground truth outcome
  outcome: {
    wasCorrect: boolean;
    verifiedBy: 'human' | 'automated_test' | 'downstream_success';
    verifiedAt: string;
  };
}

interface CalibrationReport {
  datasetId: string;
  computedAt: string;
  // Calibration curve: stated confidence → actual accuracy
  calibrationCurve: Map<number, number>;
  // Calibration error metrics
  expectedCalibrationError: number;
  maximumCalibrationError: number;
  // Recommendations
  adjustments: Map<string, { raw: number; calibrated: number }>;
}
```

**Bootstrap Calibration Process**:

1. **Collect Ground Truth**: Run LiBrainian on codebases where we KNOW the correct answers
2. **Record Claims**: Capture every confidence-bearing claim
3. **Verify Outcomes**: Human or automated verification of correctness
4. **Compute Calibration**: stated confidence vs actual accuracy
5. **Apply Adjustments**: Update `calibrated()` wrappers with empirical values

**Minimum Viable Calibration Dataset**:

| Domain | Source | Size | Ground Truth |
|--------|--------|------|--------------|
| TypeScript AST | wave0-autopilot codebase | 1000+ entities | Human-verified subset |
| Python AST | Popular OSS projects | 500+ entities | Human-verified subset |
| Relationship detection | Known dependency graphs | 200+ relationships | npm/pip metadata |
| Semantic claims | LLM-generated, human-verified | 100+ claims | Human review |

**The 25 Greats' Final Word**:

**Dijkstra**: "We cannot eliminate uncertainty, but we can be honest about it. The Quantification Invariant enforces honesty."

**Pearl**: "This transforms arbitrary priors into a proper Bayesian framework where beliefs update from evidence."

**McCarthy**: "An epistemologically adequate system must distinguish what it knows from what it assumes. The QI makes this distinction explicit in the type system."

---

### O. Implementation Guide: What Codex Should Actually Do

> **CRITICAL**: This section tells Codex EXACTLY what to implement, in priority order, with estimated LOC.

#### O.1 Phase 1: LCL Core (~200 LOC)

**File**: `packages/LiBrainian/src/api/lcl.ts`
**Status**: Implemented (`10ad66bf`), tests in `packages/LiBrainian/src/api/__tests__/lcl.test.ts` + `packages/LiBrainian/src/api/__tests__/preset_storage.test.ts`.

**What to implement**:
1. `LCLExpression` interface (type definitions only, ~30 LOC)
2. `compileLCL()` function that calls EXISTING `CompositionBuilder` (~100 LOC)
3. `loadPreset()` function that reads from storage (~40 LOC)
4. `savePreset()` function that writes to storage (~30 LOC)

**What NOT to implement**:
- New primitives (use existing `DEFAULT_TECHNIQUE_PRIMITIVES`)
- New operators (use existing operator types)
- New storage (use existing `LibrarianStorage`)

#### O.2 Phase 2: Structure Templates (~100 LOC)

**File**: `packages/LiBrainian/src/api/structure_templates.ts`
**Status**: Implemented (`51ff1fe3`), tests in `packages/LiBrainian/src/api/__tests__/structure_templates.test.ts`.

**What to implement**:
1. `STRUCTURE_TEMPLATES` constant with `pipeline`, `fanout`, `gated`, `iterative`, `quorum` (~80 LOC)
2. `applyTemplate()` function that returns operator configurations (~20 LOC)

**What NOT to implement**:
- New operator types (use existing `TechniqueOperatorType`)
- Operator execution logic (exists in `operator_interpreters.ts`)

#### O.3 Phase 3: Preset Storage (~50 LOC)

**File**: `packages/LiBrainian/src/api/preset_storage.ts`
**Status**: Implemented (`10ad66bf`), tests in `packages/LiBrainian/src/api/__tests__/preset_storage.test.ts`.

**What to implement**:
1. `loadPresets(): Promise<Record<string, LCLExpression>>` (~20 LOC)
2. `savePresets(presets: Record<string, LCLExpression>): Promise<void>` (~20 LOC)
3. Default presets JSON file (~10 lines of config)

**What NOT to implement**:
- New storage layer (use existing file system access)
- Complex caching (not needed for config files)

#### O.4 Phase 4: Epistemic Policy Config (~80 LOC)

**File**: `packages/LiBrainian/src/api/epistemic_policy.ts`
**Status**: Implemented (`377f1b0a`), tests in `packages/LiBrainian/src/api/__tests__/epistemic_policy.test.ts`.

**What to implement**:
1. `EpistemicPolicy` interface (~20 LOC)
2. `loadEpistemicPolicy(): EpistemicPolicy` (~20 LOC)
3. `applyEpistemicPolicy(claim, confidence, policy): boolean` (~40 LOC)

**What NOT to implement**:
- Confidence calculation (exists in `confidence_calibration.ts`)
- Evidence tracking (exists in `evidence.ts`)

---

### P. What The Twenty Greats Understand About LiBrainian

This section ensures future implementers (human or AI) understand the PHILOSOPHICAL FOUNDATIONS:

#### P.1 Turing's Contribution: Computability Boundaries

LiBrainian operates in a world of UNDECIDABLE questions. Code behavior is undecidable in general (Rice's theorem). BUT:
- Many PRACTICAL questions are decidable for SPECIFIC codebases
- LiBrainian should CLASSIFY questions by decidability before attempting
- Configuration: `decidability_classification.json` with known decidable/undecidable patterns

#### P.2 Dijkstra's Contribution: Structured Reasoning

LiBrainian MUST reason structurally:
- No goto-equivalent jumps in reasoning chains
- Every conclusion follows from premises
- Proofs can be checked mechanically
- Configuration: Require `evidence_chain` for every claim

#### P.3 Hoare's Contribution: Contracts and Invariants

Every LiBrainian operation has:
- PRECONDITIONS: What must be true before calling
- POSTCONDITIONS: What will be true after
- INVARIANTS: What remains true throughout
- Configuration: `technique_contracts.ts` (ALREADY EXISTS)

#### P.4 Kay's Contribution: Objects as Agents

Primitives, patterns, and compositions are OBJECTS in Kay's sense:
- They have internal state (confidence, history)
- They respond to messages (execute, query, update)
- They can be composed without exposing internals
- Configuration: Everything is late-bound, can be overridden

#### P.5 Pearl's Contribution: Causal Reasoning

LiBrainian MUST distinguish:
- OBSERVATIONAL: "When X is true, Y is usually true"
- INTERVENTIONAL: "If I SET X to true, Y becomes true"
- COUNTERFACTUAL: "If X HAD BEEN true, Y would have been true"
- Configuration: Query types in `query_interface.ts` should be tagged with causal level

#### P.6 McCarthy/Minsky's Contribution: Knowledge Representation

LiBrainian has MULTIPLE knowledge types:
- DECLARATIVE: Facts about code (exists, depends-on)
- PROCEDURAL: How to do things (techniques, compositions)
- EPISODIC: What happened before (learning loop)
- METACOGNITIVE: Knowledge about knowledge (confidence, calibration)
- Configuration: Each query should specify which knowledge types are relevant

#### P.7 Armstrong's Contribution: Fault Tolerance

LiBrainian MUST fail gracefully:
- Let it crash: If LLM unavailable, throw `ProviderUnavailableError` (ALREADY DOES THIS)
- Supervision: Higher-level components catch and handle errors
- Isolation: One query failure doesn't corrupt shared state
- Configuration: Error handling policy in execution config

#### P.8 Shannon's Contribution: Information Theory

LiBrainian should OPTIMIZE information value:
- Relevance: Context should be high-relevance (MMR scoring)
- Diversity: Don't repeat same information (diversity term)
- Efficiency: Minimum bits for maximum understanding (token budgeting)
- Configuration: Retrieval parameters in `context_assembly.ts`

#### P.9 Von Neumann's Contribution: Stored Programs

Compositions ARE stored programs:
- They can be saved, loaded, modified
- They can execute
- They can create new compositions
- Configuration: Compositions in storage are self-describing

#### P.10 Knuth's Contribution: Literate Configuration

Configuration should be READABLE:
- Names should explain purpose
- Comments should explain rationale
- Structure should reveal intent
- Configuration: Use descriptive IDs, require rationale fields

---

### Implementation Status for Part XIX

| Section | Priority | LOC Estimate | Dependencies |
|---------|----------|--------------|--------------|
| L. LCL Core | **1** | ~200 | Existing CompositionBuilder |
| M. Structures | **2** | ~100 | Existing operator types |
| O.3 Presets | **3** | ~50 | Existing storage |
| N. Epistemic | **4** | ~80 | Existing confidence system |

**Total new code: ~430 LOC** (not thousands—this COMPOSES existing code)

### Key Insight for Codex

**The twenty greats do NOT want you to build a new system.** They want you to:

1. **Use what exists**: 40+ primitives, 8+ patterns, 6 operator types, 15+ compositions
2. **Add configuration**: A thin layer (~430 LOC) that makes composition declarative
3. **Preserve philosophy**: Epistemic honesty, causal reasoning, fault tolerance
4. **Stay modular**: Everything composable, nothing monolithic

**If you find yourself writing more than 500 LOC for this section, STOP and reconsider.** You're probably reimplementing something that already exists.

---

## Part XX: Implementation Roadmap and Codex Current State

### [SPEC_SLICE] Part XX — Implementation Roadmap & Current State

- **[CAPABILITIES] Required**: evidence-backed gate commands; ability to record outcomes per gate.
- **[CAPABILITIES] Optional**: CI automation; slop detection; external provider checks.
- **[ADAPTERS] Interfaces**: gate runner (tier0/tier2); audit log writer; status snapshot serializer.
- **[EVIDENCE_LEDGER] Events**: gate started/completed; failure reasons; evidence command outputs.
- **[CLAIMS] Outputs**: roadmap status claims must cite last gate run + outcome.
- **Degradation**: when evidence missing → mark status as `unverified_by_trace(gate_not_run)`.
- **Evidence commands**: `npm run test:tier0`, `npm test`, `npm run detect:slop`.

> **⚠️ MERGED INTO TOP OF DOCUMENT**: This content has been moved to sections 1-4 at the top of this document (Implementation Status, Document Navigation, What to Implement Next, How Parts Relate). This section is preserved as an archived snapshot for reference.
>
> **Go to the TOP of this document for the current roadmap.**

---

### Historical Content (Preserved for Reference)

### Where We Are Now (January 2026)

#### Verified Existing Implementation

| Layer | What Exists | Files | LOC |
|-------|-------------|-------|-----|
| **Core Types** | TechniquePrimitive, TechniqueComposition, TechniqueOperator | `strategic/techniques.ts` | ~400 |
| **Primitives Library** | 40+ technique primitives | `api/technique_library.ts` | ~800 |
| **Pattern Catalog** | 8 composition patterns | `api/pattern_catalog.ts` | ~950 |
| **Compositions** | 15+ pre-built compositions | `api/technique_compositions.ts` | ~600 |
| **Composition Builder** | Fluent API for building compositions | `api/technique_composition_builder.ts` | ~500 |
| **Operator Registry** | 6 operator types with interpreters | `api/operator_registry.ts`, `api/operator_interpreters.ts` | ~400 |
| **Execution Engine** | Technique execution with checkpointing | `api/technique_execution.ts` | ~600 |
| **Learning Loop** | Closed-loop outcome recording | `api/learning_loop.ts` | ~400 |
| **Confidence System** | Calibration tracking | `api/confidence_calibration.ts` | ~300 |
| **Context Assembly** | Session-based context management | `api/context_sessions.ts`, `api/context_assembly.ts` | ~500 |
| **Query Pipeline** | Multi-stage query processing | `api/query.ts` | ~400 |
| **Embeddings** | Sentence-transformer based | `api/embeddings.ts` | ~200 |

**Total existing implementation: ~6,000+ LOC of working code**

#### What's In Progress (Uncommitted)

None currently.

#### What's NOT Implemented (Gaps)

| Gap | Part | Priority | Reason |
|-----|------|----------|--------|
| Transaction Boundaries | IX (P25) | **P12** | Bootstrap file/directory/assessment batches now transactional; remaining multi-step flows need coverage inventory. |
| Causal Discovery | XVIII | **P16** | No do-calculus implementation |
| Bi-Temporal Knowledge | XVIII | **P17** | No time-travel queries |

---

### The Thinking: Why This Order?

#### Principle 1: Agents Must Work First (Turing/Armstrong)

**Turing**: "A machine that cannot execute is not a machine."
**Armstrong**: "Let it crash—but only after it can run."

Before adding sophisticated features, agents must be able to:
1. Find their LLM provider (**Part XVI**)
2. Execute operator chains (**Part XV**)

**If these don't work, nothing else matters.**

#### Principle 2: Configuration Before Complexity (Kay/Dijkstra)

**Kay**: "Simple things should be simple. Complex things should be possible."
**Dijkstra**: "Simplicity is prerequisite for reliability."

After basic execution works:
1. Add LCL so users can CONFIGURE without code (**Part XIX**)
2. This enables experimentation without risk

#### Principle 3: Theory After Practice (Pearl/McCarthy)

**Pearl**: "Causal reasoning requires observational data first."
**McCarthy**: "Epistemological adequacy follows computational adequacy."

Theoretical features (causal discovery, epistemic bootstrapping) require:
1. Working execution to generate data
2. Feedback loops to calibrate
3. History to reason about

**Don't implement theory until practice generates data.**

---

### The Master Implementation Sequence

```
┌─────────────────────────────────────────────────────────────────────┐
│                     PHASE 0: FOUNDATION (NOW)                       │
│                                                                     │
│  ┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐   │
│  │ XVI. LLM        │──▶│ XV. Operator    │──▶│ Commit Semantic │   │
│  │ Provider        │   │ Execution       │   │ Selector        │   │
│  │ Discovery       │   │ Layer           │   │ (In Progress)   │   │
│  │ ~400 LOC        │   │ ~300 LOC        │   │ 0 LOC (done)    │   │
│  └─────────────────┘   └─────────────────┘   └─────────────────┘   │
│                                                                     │
│  GATE: Agents can execute compositions end-to-end                   │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                  PHASE 1: CONFIGURATION (~2 weeks)                  │
│                                                                     │
│  ┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐   │
│  │ XIX.L LCL Core  │──▶│ XIX.M Structure │──▶│ XIX.O Presets   │   │
│  │ ~200 LOC        │   │ Templates       │   │ ~50 LOC         │   │
│  │                 │   │ ~100 LOC        │   │                 │   │
│  └─────────────────┘   └─────────────────┘   └─────────────────┘   │
│                                                                     │
│  GATE: Users can configure compositions declaratively               │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                  PHASE 2: PATTERNS (~2 weeks)                       │
│                                                                     │
│  ┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐   │
│  │ XVII.H New      │──▶│ XIV.C Codebase  │──▶│ XIV.D Evolution │   │
│  │ Patterns        │   │ Advisor         │   │ Engine          │   │
│  │ 8 patterns      │   │ ~200 LOC        │   │ ~300 LOC        │   │
│  └─────────────────┘   └─────────────────┘   └─────────────────┘   │
│                                                                     │
│  GATE: Patterns cover common workflows, evolve from outcomes        │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                  PHASE 3: EPISTEMICS (~3 weeks)                     │
│                                                                     │
│  ┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐   │
│  │ XVIII.J Zero-   │──▶│ XVIII.K         │──▶│ XIX.N Epistemic │   │
│  │ Knowledge       │   │ Universal       │   │ Policy          │   │
│  │ Bootstrap       │   │ Applicability   │   │ ~80 LOC         │   │
│  │ ~300 LOC        │   │ ~600 LOC        │   │                 │   │
│  └─────────────────┘   └─────────────────┘   └─────────────────┘   │
│                                                                     │
│  GATE: Agents can bootstrap from zero knowledge, any situation      │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                  PHASE 4: THEORY (~4 weeks)                         │
│                                                                     │
│  ┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐   │
│  │ XVIII.I Self-   │──▶│ XVIII.II Proof- │──▶│ XVIII.IV Causal │   │
│  │ Aware Oracle    │   │ Carrying        │   │ Discovery       │   │
│  │ ~400 LOC        │   │ Context         │   │ ~500 LOC        │   │
│  │                 │   │ ~600 LOC        │   │                 │   │
│  └─────────────────┘   └─────────────────┘   └─────────────────┘   │
│                                                                     │
│  ┌─────────────────┐   ┌─────────────────┐                         │
│  │ XVIII.III Bi-   │──▶│ XVIII.V Meta-   │                         │
│  │ Temporal        │   │ cognitive       │                         │
│  │ ~400 LOC        │   │ ~300 LOC        │                         │
│  └─────────────────┘   └─────────────────┘                         │
│                                                                     │
│  GATE: Theoretical breakthroughs implemented, calibrated            │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│              PHASE 5: ADVANCED INFRASTRUCTURE (~ongoing)            │
│                                                                     │
│  ┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐   │
│  │ XVII.A Tiered   │──▶│ XVII.B Hier-    │──▶│ XVII.C Causal   │   │
│  │ Language        │   │ archical        │   │ Reasoning       │   │
│  │ Support         │   │ Knowledge       │   │ Engine          │   │
│  └─────────────────┘   └─────────────────┘   └─────────────────┘   │
│                                                                     │
│  These are LARGE features. Only after Phases 0-4 are stable.        │
└─────────────────────────────────────────────────────────────────────┘
```

---

### Codex: Your Immediate Next Steps

#### Step 0: Verify Current State
```bash
# Run these to understand what exists
npm run build          # Does it compile?
npm run test:tier0     # Do core tests pass?
git status             # What's uncommitted?
```

#### Step 1: Commit What's Done
If `composition_selector.ts` is working:
```bash
git add src/LiBrainian/api/composition_selector.ts
git add src/LiBrainian/api/plan_compiler.ts
git commit -m "feat(LiBrainian): add semantic composition selector"
```

#### Step 2: Implement Part XVI (LLM Provider Discovery)
**Read**: Part XVI in this document
**Create**: `src/LiBrainian/api/llm_provider_discovery.ts`
**Modify**: `src/LiBrainian/api/llm_env.ts`, `src/LiBrainian/api/technique_execution.ts`
**Test**: Technique execution works without hardcoded env vars

#### Step 3: Implement Part XV (Operator Execution)
**Read**: Part XV in this document
**Modify**: `src/LiBrainian/api/operator_interpreters.ts`
**Test**: Operators actually execute, not just compile

#### Step 4: Implement Part XIX.L (LCL Core)
**Read**: Part XIX.L in this document
**Create**: `packages/LiBrainian/src/api/lcl.ts`
**Test**: Can compose existing patterns declaratively

---

### Anti-Patterns: What NOT to Do

| Anti-Pattern | Why It's Bad | What To Do Instead |
|--------------|--------------|-------------------|
| Skip to Phase 4 | Theory without execution is useless | Complete Phase 0 first |
| Rewrite existing code | Wastes effort, introduces bugs | Compose existing code |
| Add primitives for edge cases | Explosion of primitives | Use optional primitives with conditions |
| Implement without tests | Can't verify correctness | Write test first, then implementation |
| Big-bang implementation | Too many variables | One feature at a time with commit |

---

### Document Organization Summary

After this update, THEORETICAL_CRITIQUE.md is organized as:

| Parts | Purpose | Audience |
|-------|---------|----------|
| I-III | Theoretical problems | Researchers, architects |
| IV-X | Analysis and roadmaps | Planners |
| XI-XIII | Making LiBrainian great | Maintainers |
| XIV-XVI | Specific features needed | Implementers |
| **XVII** | Twenty greats' implementation items | **Codex/AI agents** |
| **XVIII** | Theoretical breakthroughs | **Codex/AI agents** |
| **XIX** | Modular configuration DSL | **Codex/AI agents** |
| **XX** | Master roadmap & current state | **Codex/AI agents - START HERE** |

### The Philosophy in One Sentence

**LiBrainian is an epistemological infrastructure that produces calibrated understanding through the composition of existing primitives, patterns, and operators—not through infinite new code.**

---

### Change Log for Parts XVII-XX

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-01-21 | Initial XVII: Twenty Greats' Implementation Items |
| 1.1 | 2026-01-21 | Added XVIII: Theoretical Breakthroughs |
| 1.2 | 2026-01-21 | Added XIX: Modular Configuration Language |
| 1.3 | 2026-01-21 | Added XX: Implementation Roadmap & Current State |

**Document total: ~18,000 LOC across 20 parts**

---

## Part XXI: Comprehensive Programming Knowledge Support

### [SPEC_SLICE] Part XXI — Comprehensive Programming Knowledge Support

- **[CAPABILITIES] Required**: knowledge extraction pipelines; storage for docs + evidence refs; ability to read repository + docs sources.
- **[CAPABILITIES] Optional**: external API doc fetchers; LLM for synthesis; embeddings for semantic API lookup.
- **[ADAPTERS] Interfaces**: doc source adapters (OpenAPI, JSDoc, README, external docs); evidence ledger writer.
- **[EVIDENCE_LEDGER] Events**: doc fetch, doc parse, reference synthesis, freshness check.
- **[CLAIMS] Outputs**: reference answers must cite doc sources + version/freshness evidence; otherwise mark `unverified_by_trace(doc_stale)`.
- **Degradation**: if external docs unavailable → use cached/local docs and surface staleness warnings.
- **Evidence commands**: `cd packages/LiBrainian && npx vitest src/knowledge/__tests__/` (specific tests) + `npm run test:tier0`.

> **"Every programmer, regardless of role, expertise, or domain, has knowledge needs that LiBrainian must serve."**

This part ensures LiBrainian provides complete coverage for ALL programming knowledge needs—not just code understanding, but the full spectrum of what developers actually do and need.

### XXI.A. API Documentation & Reference Support

**The Problem**: API references are arguably THE most common developer activity. Every programmer constantly looks up:
- Method signatures
- Parameter types and meanings
- Return values and error conditions
- Usage examples
- Version compatibility
- Deprecation notices

Yet LiBrainian has no dedicated support for API documentation beyond parsing OpenAPI specs.

**The Solution**: Comprehensive API Reference Primitives

#### XXI.A.1. API Reference Primitives

```typescript
/** Primitive: Fetch and structure API documentation */
const tp_api_doc_fetch: TechniquePrimitive = {
  id: 'tp_api_doc_fetch',
  name: 'Fetch API Documentation',
  family: 'reference',

  preconditions: [
    { type: 'input_available', value: 'apiName OR packageName OR url' },
  ],

  postconditions: [
    { type: 'output_available', value: 'structuredDocs' },
    { type: 'output_available', value: 'methods' },
    { type: 'output_available', value: 'examples' },
  ],

  inputs: [
    { name: 'apiName', type: 'string', optional: true },
    { name: 'packageName', type: 'string', optional: true },
    { name: 'url', type: 'string', optional: true },
    { name: 'version', type: 'string', optional: true },
  ],

  outputs: [
    { name: 'structuredDocs', type: 'ApiDocumentation' },
    { name: 'methods', type: 'MethodSignature[]' },
    { name: 'examples', type: 'CodeExample[]' },
    { name: 'sourceUrl', type: 'string' },
  ],

  hints: [
    'Use when developer needs to look up API documentation',
    'Supports npm, PyPI, Maven, RubyGems, crates.io, NuGet',
    'Caches documentation for offline use',
  ],
};

/** Primitive: Search method signatures */
const tp_method_lookup: TechniquePrimitive = {
  id: 'tp_method_lookup',
  name: 'Method Signature Lookup',
  family: 'reference',

  preconditions: [
    { type: 'input_available', value: 'methodName OR signature' },
  ],

  postconditions: [
    { type: 'output_available', value: 'signature' },
    { type: 'output_available', value: 'parameters' },
    { type: 'output_available', value: 'returnType' },
  ],

  inputs: [
    { name: 'methodName', type: 'string' },
    { name: 'context', type: 'string', optional: true },
    { name: 'language', type: 'string', optional: true },
  ],

  outputs: [
    { name: 'signature', type: 'string' },
    { name: 'parameters', type: 'Parameter[]' },
    { name: 'returnType', type: 'TypeInfo' },
    { name: 'throwsTypes', type: 'TypeInfo[]' },
    { name: 'deprecated', type: 'DeprecationInfo | null' },
    { name: 'since', type: 'string' },
    { name: 'docstring', type: 'string' },
  ],

  hints: [
    'Quick lookup for method signatures',
    'Includes type information and deprecation status',
    'Cross-references with usage in codebase',
  ],
};

/** Primitive: Find usage examples */
const tp_example_search: TechniquePrimitive = {
  id: 'tp_example_search',
  name: 'Find Usage Examples',
  family: 'reference',

  preconditions: [
    { type: 'input_available', value: 'apiOrMethod' },
  ],

  postconditions: [
    { type: 'output_available', value: 'examples' },
    { type: 'confidence_above', value: 0.6 },
  ],

  inputs: [
    { name: 'apiOrMethod', type: 'string' },
    { name: 'useCase', type: 'string', optional: true },
    { name: 'language', type: 'string', optional: true },
  ],

  outputs: [
    { name: 'officialExamples', type: 'CodeExample[]' },
    { name: 'communityExamples', type: 'CodeExample[]' },
    { name: 'localUsage', type: 'CodeExample[]' },
    { name: 'antiPatterns', type: 'CodeExample[]' },
  ],

  hints: [
    'Searches official docs, Stack Overflow, GitHub, and local codebase',
    'Ranks examples by quality and relevance',
    'Identifies anti-patterns to avoid',
  ],
};

/** Primitive: Version compatibility check */
const tp_version_compat: TechniquePrimitive = {
  id: 'tp_version_compat',
  name: 'Check Version Compatibility',
  family: 'reference',

  preconditions: [
    { type: 'input_available', value: 'package AND versions' },
  ],

  postconditions: [
    { type: 'output_available', value: 'compatibility' },
    { type: 'output_available', value: 'breakingChanges' },
  ],

  inputs: [
    { name: 'package', type: 'string' },
    { name: 'currentVersion', type: 'string' },
    { name: 'targetVersion', type: 'string' },
  ],

  outputs: [
    { name: 'compatible', type: 'boolean' },
    { name: 'breakingChanges', type: 'BreakingChange[]' },
    { name: 'deprecatedUsage', type: 'DeprecatedUsage[]' },
    { name: 'migrationGuide', type: 'string | null' },
    { name: 'riskLevel', type: 'low | medium | high | critical' },
  ],

  hints: [
    'Essential for upgrade planning',
    'Analyzes changelog and semantic versioning',
    'Cross-references with current codebase usage',
  ],
};

/** Primitive: Deprecation tracker */
const tp_deprecation_scan: TechniquePrimitive = {
  id: 'tp_deprecation_scan',
  name: 'Scan for Deprecations',
  family: 'reference',

  preconditions: [
    { type: 'knowledge_available', value: 'codebase_indexed' },
  ],

  postconditions: [
    { type: 'output_available', value: 'deprecations' },
    { type: 'output_available', value: 'replacements' },
  ],

  inputs: [
    { name: 'scope', type: 'string[]', optional: true },
  ],

  outputs: [
    { name: 'deprecations', type: 'DeprecatedUsage[]' },
    { name: 'urgencyRanking', type: 'RankedDeprecation[]' },
    { name: 'replacements', type: 'ReplacementSuggestion[]' },
    { name: 'estimatedEffort', type: 'EffortEstimate' },
  ],

  hints: [
    'Proactively identifies deprecated API usage',
    'Ranks by urgency (removal date)',
    'Suggests replacements from official docs',
  ],
};
```

#### XXI.A.2. API Reference Composition

```typescript
const tc_api_reference_workflow: TechniqueComposition = {
  id: 'tc_api_reference_workflow',
  name: 'API Reference Workflow',
  description: 'Complete API documentation and reference lookup workflow',

  primitives: [
    tp_api_doc_fetch,
    tp_method_lookup,
    tp_example_search,
    tp_version_compat,
    tp_deprecation_scan,
  ],

  operators: [
    {
      type: 'branch',
      on: 'query_type',
      cases: {
        'signature': ['tp_method_lookup'],
        'example': ['tp_example_search'],
        'compatibility': ['tp_version_compat'],
        'deprecation': ['tp_deprecation_scan'],
        'full': ['tp_api_doc_fetch', 'tp_method_lookup', 'tp_example_search'],
      },
    },
    {
      type: 'augment',
      always: ['cross_reference_local_usage'],
    },
  ],

  hints: [
    'Use when developer asks "how do I use X?"',
    'Use when developer asks "what does Y do?"',
    'Use when upgrading dependencies',
  ],
};
```

#### XXI.A.3. API Reference Types

```typescript
interface ApiDocumentation {
  name: string;
  version: string;
  description: string;
  modules: ModuleDoc[];
  types: TypeDoc[];
  functions: FunctionDoc[];
  classes: ClassDoc[];
  constants: ConstantDoc[];
  examples: CodeExample[];
  changelog: ChangelogEntry[];
  sourceUrl: string;
  lastUpdated: string;
}

interface MethodSignature {
  name: string;
  fullName: string;
  module: string;
  parameters: Parameter[];
  returnType: TypeInfo;
  throws: TypeInfo[];
  generics: GenericParam[];
  overloads: MethodSignature[];
  deprecated: DeprecationInfo | null;
  since: string;
  docstring: string;
  examples: CodeExample[];
}

interface Parameter {
  name: string;
  type: TypeInfo;
  optional: boolean;
  default: string | null;
  description: string;
  constraints: Constraint[];
}

interface TypeInfo {
  name: string;
  fullPath: string;
  nullable: boolean;
  generic: boolean;
  typeParams: TypeInfo[];
  union: TypeInfo[] | null;
  intersection: TypeInfo[] | null;
}

interface CodeExample {
  title: string;
  code: string;
  language: string;
  explanation: string;
  source: 'official' | 'community' | 'local' | 'generated';
  quality: number; // 0-1 calibrated
  context: string;
}

interface DeprecationInfo {
  since: string;
  removalVersion: string | null;
  replacement: string | null;
  reason: string;
  migrationGuide: string | null;
}

interface BreakingChange {
  type: 'removed' | 'renamed' | 'signature_changed' | 'behavior_changed' | 'type_changed';
  entity: string;
  from: string;
  to: string | null;
  affectedCode: string[];
  migration: string;
}
```

---

### XXI.B. Role-Based Knowledge Needs

Different developer roles have fundamentally different knowledge needs. LiBrainian must recognize and serve each role appropriately.

#### XXI.B.1. Role-Based Primitives

```typescript
/** Role detection and adaptation */
const tp_role_inference: TechniquePrimitive = {
  id: 'tp_role_inference',
  name: 'Infer Developer Role',
  family: 'context',

  preconditions: [
    { type: 'input_available', value: 'queryHistory OR currentQuery OR userProfile' },
  ],

  postconditions: [
    { type: 'output_available', value: 'inferredRole' },
    { type: 'output_available', value: 'roleConfidence' },
  ],

  inputs: [
    { name: 'queryHistory', type: 'Query[]', optional: true },
    { name: 'currentQuery', type: 'string', optional: true },
    { name: 'userProfile', type: 'UserProfile', optional: true },
  ],

  outputs: [
    { name: 'inferredRole', type: 'DeveloperRole' },
    { name: 'roleConfidence', type: 'number' },
    { name: 'roleSignals', type: 'RoleSignal[]' },
  ],

  hints: [
    'Adapts response depth and focus based on role',
    'Considers query patterns, file access, and stated role',
  ],
};

type DeveloperRole =
  | 'junior_developer'
  | 'senior_developer'
  | 'tech_lead'
  | 'architect'
  | 'devops_engineer'
  | 'sre'
  | 'qa_engineer'
  | 'security_engineer'
  | 'data_engineer'
  | 'ml_engineer'
  | 'mobile_developer'
  | 'frontend_developer'
  | 'backend_developer'
  | 'fullstack_developer'
  | 'platform_engineer'
  | 'embedded_developer'
  | 'game_developer'
  | 'product_manager'
  | 'designer'
  | 'student'
  | 'researcher';
```

#### XXI.B.2. Role-Specific Knowledge Matrices

| Role | Primary Needs | Secondary Needs | Knowledge Depth | Response Style |
|------|--------------|-----------------|-----------------|----------------|
| **Junior Developer** | Tutorials, examples, explanations | Basic patterns, error meanings | Shallow with guidance | Detailed, educational |
| **Senior Developer** | Patterns, trade-offs, optimizations | Edge cases, internals | Deep with options | Concise, trade-off focused |
| **Tech Lead** | Architecture decisions, team patterns | Code review guidance, standards | Broad with depth on request | Decision-focused |
| **Architect** | System design, scalability, integration | Technology evaluation, migrations | Very broad, strategic | Strategic, long-term |
| **DevOps Engineer** | Deployment, monitoring, infrastructure | CI/CD, containers, cloud | Operations-focused | Actionable, automated |
| **SRE** | Reliability, observability, incidents | Performance, capacity, chaos | Metrics-focused | Data-driven |
| **QA Engineer** | Test strategies, coverage, automation | Bug patterns, regression | Quality-focused | Verification-oriented |
| **Security Engineer** | Vulnerabilities, compliance, audits | Threat modeling, pen testing | Security-focused | Risk-oriented |
| **Data Engineer** | Pipelines, transformations, quality | Storage, schemas, governance | Data-focused | Scale-oriented |
| **ML Engineer** | Models, training, deployment | Experiments, monitoring, drift | ML-focused | Experiment-oriented |
| **Frontend Developer** | UI, UX, accessibility, performance | State management, testing | UI-focused | User-oriented |
| **Backend Developer** | APIs, databases, services | Performance, security, scale | Service-focused | Reliability-oriented |
| **Embedded Developer** | Hardware, memory, real-time | Cross-compilation, debugging | Constraint-focused | Resource-oriented |
| **Student** | Learning, concepts, practice | Projects, career guidance | Educational | Foundational |

#### XXI.B.3. Role-Adapted Response Primitives

```typescript
/** Adapt response for junior developers */
const tp_junior_adaptation: TechniquePrimitive = {
  id: 'tp_junior_adaptation',
  name: 'Adapt for Junior Developer',
  family: 'adaptation',

  preconditions: [
    { type: 'role_is', value: 'junior_developer' },
    { type: 'input_available', value: 'rawResponse' },
  ],

  postconditions: [
    { type: 'output_available', value: 'adaptedResponse' },
    { type: 'property_satisfied', value: 'includes_explanations' },
    { type: 'property_satisfied', value: 'includes_examples' },
  ],

  inputs: [
    { name: 'rawResponse', type: 'LibrarianResponse' },
    { name: 'topic', type: 'string' },
  ],

  outputs: [
    { name: 'adaptedResponse', type: 'LibrarianResponse' },
    { name: 'conceptExplanations', type: 'Explanation[]' },
    { name: 'stepByStepGuide', type: 'Step[]' },
    { name: 'furtherReading', type: 'Resource[]' },
    { name: 'commonMistakes', type: 'Mistake[]' },
  ],

  hints: [
    'Explains jargon and acronyms',
    'Provides step-by-step guidance',
    'Links to foundational concepts',
    'Warns about common pitfalls',
  ],
};

/** Adapt response for architects */
const tp_architect_adaptation: TechniquePrimitive = {
  id: 'tp_architect_adaptation',
  name: 'Adapt for Architect',
  family: 'adaptation',

  preconditions: [
    { type: 'role_is', value: 'architect' },
    { type: 'input_available', value: 'rawResponse' },
  ],

  postconditions: [
    { type: 'output_available', value: 'adaptedResponse' },
    { type: 'property_satisfied', value: 'includes_tradeoffs' },
    { type: 'property_satisfied', value: 'includes_alternatives' },
  ],

  inputs: [
    { name: 'rawResponse', type: 'LibrarianResponse' },
    { name: 'decisionContext', type: 'string' },
  ],

  outputs: [
    { name: 'adaptedResponse', type: 'LibrarianResponse' },
    { name: 'tradeoffAnalysis', type: 'Tradeoff[]' },
    { name: 'alternatives', type: 'Alternative[]' },
    { name: 'scalabilityAnalysis', type: 'ScalabilityAnalysis' },
    { name: 'migrationPath', type: 'MigrationPath | null' },
    { name: 'riskAssessment', type: 'RiskAssessment' },
  ],

  hints: [
    'Focuses on architectural implications',
    'Provides multiple alternatives with trade-offs',
    'Considers long-term maintainability',
    'Addresses scalability concerns',
  ],
};

/** Adapt response for security engineers */
const tp_security_adaptation: TechniquePrimitive = {
  id: 'tp_security_adaptation',
  name: 'Adapt for Security Engineer',
  family: 'adaptation',

  preconditions: [
    { type: 'role_is', value: 'security_engineer' },
    { type: 'input_available', value: 'rawResponse' },
  ],

  postconditions: [
    { type: 'output_available', value: 'adaptedResponse' },
    { type: 'property_satisfied', value: 'includes_security_analysis' },
  ],

  inputs: [
    { name: 'rawResponse', type: 'LibrarianResponse' },
    { name: 'securityContext', type: 'string', optional: true },
  ],

  outputs: [
    { name: 'adaptedResponse', type: 'LibrarianResponse' },
    { name: 'vulnerabilities', type: 'Vulnerability[]' },
    { name: 'threatVectors', type: 'ThreatVector[]' },
    { name: 'complianceIssues', type: 'ComplianceIssue[]' },
    { name: 'mitigations', type: 'Mitigation[]' },
    { name: 'auditTrail', type: 'AuditRequirement[]' },
  ],

  hints: [
    'Highlights security implications',
    'References OWASP, CWE, CVE where relevant',
    'Considers compliance requirements',
    'Suggests security hardening',
  ],
};
```

---

### XXI.C. Expertise-Level Knowledge Adaptation

#### XXI.C.1. Expertise Levels

```typescript
type ExpertiseLevel =
  | 'beginner'      // Learning fundamentals, needs hand-holding
  | 'novice'        // Has basics, making common mistakes
  | 'intermediate'  // Productive, learning best practices
  | 'proficient'    // Solid skills, some advanced knowledge
  | 'advanced'      // Deep knowledge, handles complex cases
  | 'expert'        // Pushes boundaries, creates new patterns
  | 'master';       // Industry-recognized authority

interface ExpertiseProfile {
  overall: ExpertiseLevel;
  byDomain: Record<string, ExpertiseLevel>;
  byLanguage: Record<string, ExpertiseLevel>;
  byTool: Record<string, ExpertiseLevel>;
  signals: ExpertiseSignal[];
  lastUpdated: string;
}

interface ExpertiseSignal {
  source: 'query_complexity' | 'code_quality' | 'error_types' | 'stated' | 'inferred';
  domain: string;
  level: ExpertiseLevel;
  confidence: number;
  evidence: string;
}
```

#### XXI.C.2. Expertise-Adapted Content Matrices

| Level | Explanation Depth | Example Complexity | Assumed Knowledge | Jargon Level |
|-------|------------------|-------------------|-------------------|--------------|
| **Beginner** | Full, step-by-step | Minimal, isolated | None | Explained |
| **Novice** | Detailed with context | Simple, integrated | Basic syntax | Defined on use |
| **Intermediate** | Focused on non-obvious | Realistic patterns | Common patterns | Standard |
| **Proficient** | Trade-offs only | Production-quality | Best practices | Professional |
| **Advanced** | Edge cases, internals | Complex, optimized | Deep patterns | Technical |
| **Expert** | Novel insights only | Cutting-edge | System internals | Specialized |
| **Master** | Research-level | Novel techniques | Everything | Academic |

#### XXI.C.3. Expertise Detection Primitive

```typescript
const tp_expertise_inference: TechniquePrimitive = {
  id: 'tp_expertise_inference',
  name: 'Infer Expertise Level',
  family: 'context',

  preconditions: [
    { type: 'input_available', value: 'userInteractions' },
  ],

  postconditions: [
    { type: 'output_available', value: 'expertiseProfile' },
  ],

  inputs: [
    { name: 'queries', type: 'Query[]' },
    { name: 'codeWritten', type: 'CodeSample[]', optional: true },
    { name: 'errorsEncountered', type: 'Error[]', optional: true },
    { name: 'statedLevel', type: 'ExpertiseLevel', optional: true },
  ],

  outputs: [
    { name: 'expertiseProfile', type: 'ExpertiseProfile' },
    { name: 'confidenceByDomain', type: 'Record<string, number>' },
    { name: 'learningOpportunities', type: 'LearningOpportunity[]' },
  ],

  hints: [
    'Analyzes query sophistication',
    'Considers error patterns (beginners vs experts)',
    'Respects stated expertise',
    'Adapts over time with interaction',
  ],
};
```

---

### XXI.D. Common Programming Tasks

These are tasks that EVERY programmer does regularly, regardless of role or domain.

#### XXI.D.1. Task Taxonomy

| Category | Tasks | Frequency | Primitives Needed |
|----------|-------|-----------|-------------------|
| **Understanding** | Read code, trace flow, understand architecture | Very High | tp_code_explain, tp_flow_trace, tp_architecture_visualize |
| **Debugging** | Find bugs, understand errors, trace issues | Very High | tp_debug_assist, tp_error_explain, tp_root_cause_find |
| **Searching** | Find code, find usage, find examples | Very High | tp_code_search, tp_usage_find, tp_example_search |
| **Refactoring** | Rename, extract, restructure | High | tp_refactor_suggest, tp_extract_plan, tp_restructure_safe |
| **Testing** | Write tests, find coverage gaps, debug tests | High | tp_test_generate, tp_coverage_analyze, tp_test_debug |
| **Documentation** | Write docs, understand docs, update docs | Medium | tp_doc_generate, tp_doc_understand, tp_doc_update |
| **Review** | Review code, review PRs, give feedback | Medium | tp_review_assist, tp_pr_analyze, tp_feedback_generate |
| **Onboarding** | Learn codebase, understand conventions, find resources | Medium | tp_onboard_guide, tp_convention_explain, tp_resource_find |
| **Dependency** | Manage deps, resolve conflicts, audit security | Medium | tp_dep_manage, tp_conflict_resolve, tp_security_audit |
| **Performance** | Profile, optimize, benchmark | Low-Medium | tp_profile_guide, tp_optimize_suggest, tp_benchmark_create |
| **Deployment** | Build, deploy, monitor | Low-Medium | tp_build_guide, tp_deploy_assist, tp_monitor_setup |
| **Configuration** | Configure tools, set up environments, manage settings | Medium | tp_config_guide, tp_env_setup, tp_settings_manage |

#### XXI.D.2. Debugging Support Primitives

```typescript
const tp_debug_assist: TechniquePrimitive = {
  id: 'tp_debug_assist',
  name: 'Debug Assistance',
  family: 'debugging',

  preconditions: [
    { type: 'input_available', value: 'errorOrSymptom' },
  ],

  postconditions: [
    { type: 'output_available', value: 'diagnosis' },
    { type: 'output_available', value: 'suggestedFixes' },
  ],

  inputs: [
    { name: 'error', type: 'Error | string' },
    { name: 'stackTrace', type: 'string', optional: true },
    { name: 'context', type: 'string', optional: true },
    { name: 'recentChanges', type: 'string[]', optional: true },
  ],

  outputs: [
    { name: 'diagnosis', type: 'Diagnosis' },
    { name: 'rootCause', type: 'RootCause' },
    { name: 'suggestedFixes', type: 'Fix[]' },
    { name: 'debuggingSteps', type: 'Step[]' },
    { name: 'relatedIssues', type: 'Issue[]' },
  ],

  hints: [
    'Analyzes error messages and stack traces',
    'Cross-references with known issues',
    'Considers recent changes as potential causes',
    'Provides step-by-step debugging guidance',
  ],
};

const tp_error_explain: TechniquePrimitive = {
  id: 'tp_error_explain',
  name: 'Explain Error',
  family: 'debugging',

  preconditions: [
    { type: 'input_available', value: 'errorMessage' },
  ],

  postconditions: [
    { type: 'output_available', value: 'explanation' },
  ],

  inputs: [
    { name: 'errorMessage', type: 'string' },
    { name: 'language', type: 'string', optional: true },
    { name: 'framework', type: 'string', optional: true },
  ],

  outputs: [
    { name: 'explanation', type: 'string' },
    { name: 'commonCauses', type: 'Cause[]' },
    { name: 'fixes', type: 'Fix[]' },
    { name: 'preventionTips', type: 'string[]' },
    { name: 'documentation', type: 'string | null' },
  ],

  hints: [
    'Explains what the error means in plain language',
    'Lists common causes',
    'Provides fixes ranked by likelihood',
    'Links to official documentation',
  ],
};

const tp_root_cause_find: TechniquePrimitive = {
  id: 'tp_root_cause_find',
  name: 'Find Root Cause',
  family: 'debugging',

  preconditions: [
    { type: 'input_available', value: 'symptom' },
    { type: 'knowledge_available', value: 'codebase_indexed' },
  ],

  postconditions: [
    { type: 'output_available', value: 'rootCause' },
    { type: 'output_available', value: 'evidenceChain' },
  ],

  inputs: [
    { name: 'symptom', type: 'string' },
    { name: 'affectedArea', type: 'string[]', optional: true },
    { name: 'recentChanges', type: 'GitCommit[]', optional: true },
  ],

  outputs: [
    { name: 'rootCause', type: 'RootCause' },
    { name: 'evidenceChain', type: 'Evidence[]' },
    { name: 'contributingFactors', type: 'Factor[]' },
    { name: 'confidenceLevel', type: 'number' },
    { name: 'alternativeHypotheses', type: 'Hypothesis[]' },
  ],

  hints: [
    'Uses 5-whys methodology',
    'Traces causality through code',
    'Considers timing and state',
    'Provides confidence-weighted hypotheses',
  ],
};
```

#### XXI.D.3. Code Review Support Primitives

```typescript
const tp_review_assist: TechniquePrimitive = {
  id: 'tp_review_assist',
  name: 'Code Review Assistance',
  family: 'review',

  preconditions: [
    { type: 'input_available', value: 'codeToReview' },
  ],

  postconditions: [
    { type: 'output_available', value: 'reviewComments' },
    { type: 'output_available', value: 'suggestions' },
  ],

  inputs: [
    { name: 'diff', type: 'string | FileDiff[]' },
    { name: 'context', type: 'string', optional: true },
    { name: 'reviewFocus', type: 'ReviewFocus[]', optional: true },
  ],

  outputs: [
    { name: 'reviewComments', type: 'ReviewComment[]' },
    { name: 'suggestions', type: 'Suggestion[]' },
    { name: 'securityIssues', type: 'SecurityIssue[]' },
    { name: 'performanceIssues', type: 'PerformanceIssue[]' },
    { name: 'styleIssues', type: 'StyleIssue[]' },
    { name: 'overallAssessment', type: 'Assessment' },
  ],

  hints: [
    'Analyzes code changes for common issues',
    'Checks against codebase conventions',
    'Identifies security vulnerabilities',
    'Suggests improvements',
  ],
};

type ReviewFocus =
  | 'correctness'
  | 'security'
  | 'performance'
  | 'style'
  | 'maintainability'
  | 'testing'
  | 'documentation';

interface ReviewComment {
  file: string;
  line: number;
  severity: 'critical' | 'warning' | 'suggestion' | 'nitpick';
  category: ReviewFocus;
  comment: string;
  suggestion: string | null;
  autoFixable: boolean;
}
```

#### XXI.D.4. Onboarding Support Primitives

```typescript
const tp_onboard_guide: TechniquePrimitive = {
  id: 'tp_onboard_guide',
  name: 'Codebase Onboarding Guide',
  family: 'onboarding',

  preconditions: [
    { type: 'knowledge_available', value: 'codebase_indexed' },
  ],

  postconditions: [
    { type: 'output_available', value: 'onboardingPlan' },
    { type: 'output_available', value: 'keyFilesToRead' },
  ],

  inputs: [
    { name: 'role', type: 'DeveloperRole', optional: true },
    { name: 'focusArea', type: 'string', optional: true },
    { name: 'timeAvailable', type: 'string', optional: true },
    { name: 'existingKnowledge', type: 'string[]', optional: true },
  ],

  outputs: [
    { name: 'onboardingPlan', type: 'OnboardingPlan' },
    { name: 'keyFilesToRead', type: 'RankedFile[]' },
    { name: 'architectureOverview', type: 'ArchitectureOverview' },
    { name: 'keyConceptsToLearn', type: 'Concept[]' },
    { name: 'setupInstructions', type: 'Step[]' },
    { name: 'peopleToTalkTo', type: 'TeamMember[]' },
  ],

  hints: [
    'Creates personalized onboarding path',
    'Ranks files by importance for understanding',
    'Identifies key concepts to learn',
    'Adapts to available time',
  ],
};

interface OnboardingPlan {
  phases: OnboardingPhase[];
  estimatedDuration: string;
  milestones: Milestone[];
  resources: Resource[];
}

interface OnboardingPhase {
  name: string;
  description: string;
  goals: string[];
  activities: Activity[];
  checkpoints: Checkpoint[];
}
```

---

### XXI.E. Domain-Specific Knowledge

#### XXI.E.1. Domain Knowledge Matrix

| Domain | Unique Concepts | Common Tasks | Special Primitives |
|--------|----------------|--------------|-------------------|
| **Web Frontend** | DOM, CSS, accessibility, state management, SSR | Build UIs, handle events, manage state | tp_accessibility_check, tp_css_debug, tp_render_optimize |
| **Web Backend** | HTTP, REST, GraphQL, authentication, databases | Build APIs, handle requests, manage data | tp_api_design, tp_query_optimize, tp_auth_implement |
| **Mobile** | Platform APIs, UI guidelines, performance, offline | Build apps, handle lifecycle, manage resources | tp_mobile_optimize, tp_offline_support, tp_native_bridge |
| **Desktop** | System APIs, windows, processes, file system | Build apps, manage windows, handle files | tp_system_integrate, tp_process_manage, tp_file_handle |
| **Embedded** | Hardware, interrupts, memory constraints, real-time | Control hardware, manage resources, meet timing | tp_hardware_interface, tp_memory_optimize, tp_timing_verify |
| **Data** | ETL, schemas, quality, governance | Build pipelines, transform data, ensure quality | tp_pipeline_design, tp_quality_check, tp_schema_evolve |
| **ML/AI** | Models, training, inference, experiments | Train models, deploy, monitor drift | tp_model_train, tp_experiment_track, tp_drift_detect |
| **DevOps** | CI/CD, infrastructure, containers, monitoring | Automate deployment, manage infrastructure | tp_pipeline_build, tp_infra_provision, tp_alert_configure |
| **Security** | Threats, vulnerabilities, compliance, cryptography | Analyze threats, fix vulnerabilities, audit | tp_threat_model, tp_vuln_scan, tp_compliance_check |
| **Gaming** | Graphics, physics, networking, optimization | Render graphics, simulate physics, sync state | tp_render_optimize, tp_physics_debug, tp_netcode_analyze |
| **Blockchain** | Consensus, smart contracts, gas, wallets | Write contracts, optimize gas, manage keys | tp_contract_audit, tp_gas_optimize, tp_key_manage |
| **IoT** | Sensors, protocols, edge computing, power | Collect data, manage devices, conserve power | tp_sensor_integrate, tp_protocol_implement, tp_power_optimize |

#### XXI.E.2. Domain-Specific Primitives

```typescript
/** Web accessibility check */
const tp_accessibility_check: TechniquePrimitive = {
  id: 'tp_accessibility_check',
  name: 'Accessibility Check',
  family: 'web',

  preconditions: [
    { type: 'input_available', value: 'componentOrPage' },
  ],

  postconditions: [
    { type: 'output_available', value: 'accessibilityIssues' },
    { type: 'output_available', value: 'fixes' },
  ],

  inputs: [
    { name: 'component', type: 'string | HTMLElement' },
    { name: 'wcagLevel', type: 'A | AA | AAA', optional: true },
  ],

  outputs: [
    { name: 'issues', type: 'AccessibilityIssue[]' },
    { name: 'fixes', type: 'AccessibilityFix[]' },
    { name: 'score', type: 'number' },
    { name: 'compliance', type: 'ComplianceReport' },
  ],

  hints: [
    'Checks WCAG 2.1 compliance',
    'Identifies missing ARIA attributes',
    'Tests keyboard navigation',
    'Verifies color contrast',
  ],
};

/** Database query optimization */
const tp_query_optimize: TechniquePrimitive = {
  id: 'tp_query_optimize',
  name: 'Optimize Database Query',
  family: 'data',

  preconditions: [
    { type: 'input_available', value: 'query' },
  ],

  postconditions: [
    { type: 'output_available', value: 'optimizedQuery' },
    { type: 'output_available', value: 'explanation' },
  ],

  inputs: [
    { name: 'query', type: 'string' },
    { name: 'schema', type: 'Schema', optional: true },
    { name: 'executionPlan', type: 'string', optional: true },
    { name: 'database', type: 'DatabaseType', optional: true },
  ],

  outputs: [
    { name: 'optimizedQuery', type: 'string' },
    { name: 'explanation', type: 'string' },
    { name: 'indexSuggestions', type: 'IndexSuggestion[]' },
    { name: 'expectedImprovement', type: 'string' },
    { name: 'warnings', type: 'Warning[]' },
  ],

  hints: [
    'Analyzes query execution plan',
    'Suggests index additions',
    'Rewrites inefficient patterns',
    'Considers database-specific optimizations',
  ],
};

/** Smart contract audit */
const tp_contract_audit: TechniquePrimitive = {
  id: 'tp_contract_audit',
  name: 'Smart Contract Audit',
  family: 'blockchain',

  preconditions: [
    { type: 'input_available', value: 'contractCode' },
  ],

  postconditions: [
    { type: 'output_available', value: 'vulnerabilities' },
    { type: 'output_available', value: 'gasAnalysis' },
  ],

  inputs: [
    { name: 'contractCode', type: 'string' },
    { name: 'chain', type: 'ethereum | solana | other', optional: true },
  ],

  outputs: [
    { name: 'vulnerabilities', type: 'ContractVulnerability[]' },
    { name: 'gasAnalysis', type: 'GasAnalysis' },
    { name: 'bestPracticeViolations', type: 'Violation[]' },
    { name: 'recommendations', type: 'Recommendation[]' },
    { name: 'overallRisk', type: 'low | medium | high | critical' },
  ],

  hints: [
    'Checks for reentrancy, overflow, access control issues',
    'Analyzes gas usage',
    'Verifies against known vulnerability patterns',
    'Suggests safer patterns',
  ],
};
```

---

### XXI.F. Rare and Edge Case Knowledge

These are less common needs that still matter significantly when they arise.

#### XXI.F.1. Rare Task Taxonomy

| Category | Tasks | When Needed | Primitives |
|----------|-------|-------------|------------|
| **Legacy Migration** | Modernize old code, upgrade frameworks, migrate databases | Tech debt reduction | tp_legacy_analyze, tp_migration_plan, tp_compatibility_check |
| **Compliance** | Meet regulatory requirements, audit, document | Regulated industries | tp_compliance_check, tp_audit_prepare, tp_evidence_collect |
| **Accessibility** | Full a11y compliance, screen reader testing | Public-facing apps | tp_a11y_audit, tp_screen_reader_test, tp_wcag_report |
| **Internationalization** | i18n setup, RTL support, locale handling | Global apps | tp_i18n_setup, tp_rtl_support, tp_locale_test |
| **Platform Quirks** | Browser compat, OS differences, device variations | Cross-platform | tp_compat_check, tp_quirk_workaround, tp_polyfill_suggest |
| **Language Interop** | FFI, bindings, cross-language calls | Mixed codebases | tp_ffi_design, tp_binding_generate, tp_interop_debug |
| **Binary/Low-Level** | Assembly, bytecode, memory layout, debugging | Performance, security | tp_asm_explain, tp_memory_analyze, tp_binary_reverse |
| **Real-Time** | Latency guarantees, determinism, scheduling | Hard real-time systems | tp_latency_analyze, tp_determinism_check, tp_schedule_verify |
| **Disaster Recovery** | Backup verification, failover testing, data recovery | Operations | tp_backup_verify, tp_failover_test, tp_recovery_plan |
| **Forensics** | Post-mortem, incident analysis, root cause | After incidents | tp_forensic_analyze, tp_timeline_reconstruct, tp_evidence_preserve |
| **Formal Verification** | Prove correctness, model checking, theorem proving | Safety-critical | tp_property_specify, tp_model_check, tp_proof_assist |
| **Chaos Engineering** | Fault injection, resilience testing | Reliability work | tp_fault_inject, tp_resilience_test, tp_blast_radius |

#### XXI.F.2. Rare Case Primitives

```typescript
/** Legacy code analysis */
const tp_legacy_analyze: TechniquePrimitive = {
  id: 'tp_legacy_analyze',
  name: 'Analyze Legacy Code',
  family: 'migration',

  preconditions: [
    { type: 'input_available', value: 'legacyCodebase' },
  ],

  postconditions: [
    { type: 'output_available', value: 'analysis' },
    { type: 'output_available', value: 'modernizationPlan' },
  ],

  inputs: [
    { name: 'codebase', type: 'string | string[]' },
    { name: 'targetStack', type: 'string', optional: true },
    { name: 'constraints', type: 'Constraint[]', optional: true },
  ],

  outputs: [
    { name: 'analysis', type: 'LegacyAnalysis' },
    { name: 'dependencies', type: 'LegacyDependency[]' },
    { name: 'modernizationPlan', type: 'ModernizationPlan' },
    { name: 'riskAssessment', type: 'RiskAssessment' },
    { name: 'estimatedEffort', type: 'EffortEstimate' },
  ],

  hints: [
    'Identifies outdated patterns and dependencies',
    'Maps to modern equivalents',
    'Creates incremental migration plan',
    'Assesses business risk',
  ],
};

/** Compliance verification */
const tp_compliance_check: TechniquePrimitive = {
  id: 'tp_compliance_check',
  name: 'Check Compliance',
  family: 'compliance',

  preconditions: [
    { type: 'input_available', value: 'codeOrSystem' },
    { type: 'input_available', value: 'standard' },
  ],

  postconditions: [
    { type: 'output_available', value: 'complianceReport' },
  ],

  inputs: [
    { name: 'scope', type: 'string | string[]' },
    { name: 'standard', type: 'ComplianceStandard' },
    { name: 'controls', type: 'Control[]', optional: true },
  ],

  outputs: [
    { name: 'complianceReport', type: 'ComplianceReport' },
    { name: 'violations', type: 'Violation[]' },
    { name: 'gaps', type: 'ComplianceGap[]' },
    { name: 'evidence', type: 'Evidence[]' },
    { name: 'remediation', type: 'RemediationPlan' },
  ],

  hints: [
    'Supports GDPR, HIPAA, SOC2, PCI-DSS, ISO 27001',
    'Generates audit-ready reports',
    'Identifies control gaps',
    'Suggests remediation steps',
  ],
};

type ComplianceStandard =
  | 'GDPR'
  | 'HIPAA'
  | 'SOC2'
  | 'PCI-DSS'
  | 'ISO-27001'
  | 'CCPA'
  | 'NIST-800-53'
  | 'FedRAMP'
  | 'CMMC';

/** Formal property specification */
const tp_property_specify: TechniquePrimitive = {
  id: 'tp_property_specify',
  name: 'Specify Formal Property',
  family: 'verification',

  preconditions: [
    { type: 'input_available', value: 'requirementOrCode' },
  ],

  postconditions: [
    { type: 'output_available', value: 'formalSpec' },
  ],

  inputs: [
    { name: 'requirement', type: 'string', optional: true },
    { name: 'code', type: 'string', optional: true },
    { name: 'specLanguage', type: 'TLA+ | Alloy | Z3 | Coq', optional: true },
  ],

  outputs: [
    { name: 'formalSpec', type: 'string' },
    { name: 'invariants', type: 'Invariant[]' },
    { name: 'safetyProperties', type: 'Property[]' },
    { name: 'livenessProperties', type: 'Property[]' },
    { name: 'assumptions', type: 'Assumption[]' },
  ],

  hints: [
    'Translates requirements to formal specifications',
    'Identifies safety and liveness properties',
    'Supports multiple specification languages',
    'Documents assumptions explicitly',
  ],
};
```

---

### XXI.G. Priority Implementation Matrix

#### G1: API Reference Support - CRITICAL (Every Developer, Daily)

| Priority | Primitive | Reason | LOC Estimate |
|----------|-----------|--------|--------------|
| **G1.1** | tp_api_doc_fetch | Most common lookup activity | ~200 |
| **G1.2** | tp_method_lookup | Quick signature lookup | ~150 |
| **G1.3** | tp_example_search | Every developer needs examples | ~200 |
| **G1.4** | tp_version_compat | Critical for upgrades | ~150 |
| **G1.5** | tp_deprecation_scan | Proactive maintenance | ~100 |

#### G2: Role Adaptation - HIGH (User Experience)

| Priority | Primitive | Reason | LOC Estimate |
|----------|-----------|--------|--------------|
| **G2.1** | tp_role_inference | Foundation for adaptation | ~150 |
| **G2.2** | tp_junior_adaptation | Common user type | ~100 |
| **G2.3** | tp_architect_adaptation | Strategic decisions | ~150 |
| **G2.4** | tp_security_adaptation | Security is critical | ~100 |

#### G3: Expertise Adaptation - HIGH (User Experience)

| Priority | Primitive | Reason | LOC Estimate |
|----------|-----------|--------|--------------|
| **G3.1** | tp_expertise_inference | Foundation for adaptation | ~150 |
| **G3.2** | Expertise-based response modification | Applied across all responses | ~200 |

#### G4: Common Task Support - HIGH (Daily Use)

| Priority | Primitive | Reason | LOC Estimate |
|----------|-----------|--------|--------------|
| **G4.1** | tp_debug_assist | Most common need | ~200 |
| **G4.2** | tp_error_explain | Every developer hits errors | ~150 |
| **G4.3** | tp_root_cause_find | Beyond surface symptoms | ~200 |
| **G4.4** | tp_review_assist | Common workflow | ~200 |
| **G4.5** | tp_onboard_guide | Critical for new team members | ~200 |

#### G5: Domain-Specific - MEDIUM (Based on Codebase)

| Priority | Primitive | Reason | LOC Estimate |
|----------|-----------|--------|--------------|
| **G5.1** | tp_accessibility_check | Required for web | ~150 |
| **G5.2** | tp_query_optimize | Common performance need | ~200 |
| **G5.3** | Domain detection + adaptation | Auto-detect domain needs | ~150 |

#### G6: Rare Cases - LOW (But Essential When Needed)

| Priority | Primitive | Reason | LOC Estimate |
|----------|-----------|--------|--------------|
| **G6.1** | tp_legacy_analyze | Tech debt is universal | ~200 |
| **G6.2** | tp_compliance_check | Regulated industries | ~200 |
| **G6.3** | tp_property_specify | Safety-critical systems | ~150 |

---

### XXI.H. Consolidated Priority List Update

Add to the master priority list:

| ID | Priority | Item | Part | Dependencies |
|----|----------|------|------|--------------|
| **G1** | P0 | API Reference Support (fetch, lookup, examples) | XXI.A | Extraction |
| **G2** | P1 | Role Inference and Adaptation | XXI.B | G1 |
| **G3** | P1 | Expertise Inference and Adaptation | XXI.C | G1 |
| **G4** | P1 | Debugging Support (assist, explain, root cause) | XXI.D | Extraction |
| **G5** | P2 | Code Review Support | XXI.D | G4 |
| **G6** | P2 | Onboarding Support | XXI.D | Extraction |
| **G7** | P2 | Domain-Specific Primitives (based on detected domain) | XXI.E | G1-G4 |
| **G8** | P3 | Legacy Migration Support | XXI.F | G4, G7 |
| **G9** | P3 | Compliance Checking | XXI.F | G8 |
| **G10** | P3 | Formal Verification Support | XXI.F | G8 |

---

### XXI.I. Architecture: Knowledge Source Integration

```
┌─────────────────────────────────────────────────────────────────────┐
│                    LiBrainian KNOWLEDGE SOURCES                       │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐     │
│  │ LOCAL CODEBASE  │  │ API DOCS        │  │ COMMUNITY       │     │
│  │                 │  │                 │  │                 │     │
│  │ • AST analysis  │  │ • npm registry  │  │ • Stack Overflow│     │
│  │ • Git history   │  │ • PyPI          │  │ • GitHub issues │     │
│  │ • Comments      │  │ • crates.io     │  │ • Blog posts    │     │
│  │ • Tests         │  │ • Maven Central │  │ • Tutorials     │     │
│  │ • Configs       │  │ • docs.rs       │  │ • Best practices│     │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘     │
│           │                    │                    │               │
│           └──────────────┬─────┴────────────────────┘               │
│                          │                                          │
│                          ▼                                          │
│           ┌──────────────────────────────┐                         │
│           │    KNOWLEDGE AGGREGATOR       │                         │
│           │                              │                         │
│           │  • Source prioritization     │                         │
│           │  • Conflict resolution       │                         │
│           │  • Freshness tracking        │                         │
│           │  • Trust scoring             │                         │
│           └──────────────┬───────────────┘                         │
│                          │                                          │
│                          ▼                                          │
│           ┌──────────────────────────────┐                         │
│           │    CONTEXT ADAPTER            │                         │
│           │                              │                         │
│           │  • Role detection            │                         │
│           │  • Expertise inference       │                         │
│           │  • Domain identification     │                         │
│           │  • Response adaptation       │                         │
│           └──────────────┬───────────────┘                         │
│                          │                                          │
│                          ▼                                          │
│           ┌──────────────────────────────┐                         │
│           │    DEVELOPER INTERFACE        │                         │
│           │                              │                         │
│           │  • MCP tools                 │                         │
│           │  • IDE integration           │                         │
│           │  • CLI                       │                         │
│           │  • API                       │                         │
│           └──────────────────────────────┘                         │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

### XXI.J. Types for Knowledge Source Integration

```typescript
/** API documentation source */
interface ApiDocSource {
  type: 'registry' | 'url' | 'local' | 'generated';
  registry?: 'npm' | 'pypi' | 'maven' | 'crates' | 'nuget' | 'rubygems';
  url?: string;
  localPath?: string;
  version: string;
  lastUpdated: string;
  trustScore: number;
}

/** Community knowledge source */
interface CommunitySource {
  type: 'stackoverflow' | 'github' | 'blog' | 'tutorial' | 'discussion';
  url: string;
  votes?: number;
  verified?: boolean;
  date: string;
  author?: string;
  trustScore: number;
}

/** Knowledge source priority */
interface SourcePriority {
  source: 'local' | 'official_docs' | 'community' | 'generated';
  priority: number;
  trustModifier: number;
  freshnessWeight: number;
}

const DEFAULT_SOURCE_PRIORITY: SourcePriority[] = [
  { source: 'local', priority: 1, trustModifier: 1.0, freshnessWeight: 0.8 },
  { source: 'official_docs', priority: 2, trustModifier: 0.95, freshnessWeight: 0.9 },
  { source: 'community', priority: 3, trustModifier: 0.7, freshnessWeight: 0.6 },
  { source: 'generated', priority: 4, trustModifier: 0.5, freshnessWeight: 1.0 },
];

/** Knowledge aggregation result */
interface AggregatedKnowledge {
  primary: KnowledgeItem;
  alternatives: KnowledgeItem[];
  sources: KnowledgeSource[];
  confidence: number;
  freshness: number;
  conflicts: Conflict[];
}

interface Conflict {
  field: string;
  values: { source: string; value: unknown }[];
  resolution: 'trust_highest' | 'newest' | 'manual' | 'unresolved';
  resolvedValue?: unknown;
}
```

---

### XXI.L. Real-Time API Freshness Architecture

**The Critical Problem**: APIs change. Some APIs change daily (or more frequently). An agent using stale API documentation will:
- Call non-existent endpoints
- Pass wrong parameters
- Expect wrong return types
- Miss new required fields
- Use deprecated patterns that now fail

**The Challenge**: Re-fetching all documentation constantly is expensive, slow, and often rate-limited.

**The Solution**: Intelligent API Freshness System

#### XXI.L.1. Freshness Detection Primitives

```typescript
/** API change detection strategies */
type FreshnessStrategy =
  | 'etag_check'           // HTTP ETag/If-None-Match
  | 'last_modified'        // HTTP Last-Modified header
  | 'version_endpoint'     // Check /version or /health endpoint
  | 'changelog_parse'      // Parse CHANGELOG.md or release notes
  | 'hash_comparison'      // Hash of spec/doc file
  | 'webhook_subscription' // Subscribe to change notifications
  | 'registry_poll'        // Poll npm/PyPI for version changes
  | 'git_watch'            // Watch GitHub releases/tags
  | 'spec_diff'            // Diff OpenAPI/GraphQL schema
  | 'runtime_probe';       // Test actual endpoint behavior

/** Freshness check primitive */
const tp_api_freshness_check: TechniquePrimitive = {
  id: 'tp_api_freshness_check',
  name: 'Check API Freshness',
  family: 'reference',

  preconditions: [
    { type: 'input_available', value: 'apiIdentifier' },
    { type: 'knowledge_available', value: 'cached_api_docs' },
  ],

  postconditions: [
    { type: 'output_available', value: 'freshnessStatus' },
    { type: 'output_available', value: 'updateNeeded' },
  ],

  inputs: [
    { name: 'apiIdentifier', type: 'string' },
    { name: 'cachedVersion', type: 'string', optional: true },
    { name: 'strategies', type: 'FreshnessStrategy[]', optional: true },
  ],

  outputs: [
    { name: 'isFresh', type: 'boolean' },
    { name: 'currentVersion', type: 'string | null' },
    { name: 'cachedAge', type: 'Duration' },
    { name: 'changesSinceCache', type: 'ChangeEntry[] | null' },
    { name: 'updateUrgency', type: 'none | low | medium | high | critical' },
    { name: 'recommendedAction', type: 'none | partial_update | full_update | verify_at_use' },
  ],

  hints: [
    'Checks if cached API documentation is still valid',
    'Uses multiple strategies in priority order',
    'Minimal network overhead (ETag, HEAD requests)',
    'Returns change summary if available',
  ],
};

/** Incremental update primitive */
const tp_api_incremental_update: TechniquePrimitive = {
  id: 'tp_api_incremental_update',
  name: 'Incrementally Update API Docs',
  family: 'reference',

  preconditions: [
    { type: 'input_available', value: 'apiIdentifier' },
    { type: 'condition_true', value: 'update_needed' },
  ],

  postconditions: [
    { type: 'output_available', value: 'updatedDocs' },
    { type: 'property_satisfied', value: 'docs_are_fresh' },
  ],

  inputs: [
    { name: 'apiIdentifier', type: 'string' },
    { name: 'cachedDocs', type: 'ApiDocumentation' },
    { name: 'changesSince', type: 'string | Date', optional: true },
  ],

  outputs: [
    { name: 'updatedDocs', type: 'ApiDocumentation' },
    { name: 'changesApplied', type: 'DocChange[]' },
    { name: 'affectedMethods', type: 'string[]' },
    { name: 'breakingChanges', type: 'BreakingChange[]' },
    { name: 'updateCost', type: 'UpdateCost' },
  ],

  hints: [
    'Fetches only changes, not full documentation',
    'Uses delta/diff APIs when available',
    'Falls back to full fetch if delta unavailable',
    'Tracks what changed for dependent code analysis',
  ],
};
```

#### XXI.L.2. Freshness-Aware Caching Architecture

```typescript
interface FreshnessAwareCache {
  /** Get doc, checking freshness first */
  getWithFreshnessCheck(
    apiId: string,
    options: FreshnessOptions
  ): Promise<FreshApiDoc>;

  /** Subscribe to changes for proactive updates */
  subscribeToChanges(
    apiId: string,
    callback: (changes: DocChange[]) => void
  ): Subscription;

  /** Background freshness sweep */
  runFreshnessSweep(): Promise<FreshnessSweepResult>;
}

interface FreshnessOptions {
  /** Maximum acceptable age */
  maxAge: Duration;

  /** Strategies to use for freshness check */
  strategies: FreshnessStrategy[];

  /** What to do if stale and can't update */
  stalePolicy: 'use_stale_with_warning' | 'fail' | 'verify_at_use';

  /** Whether to update in background vs blocking */
  updateMode: 'blocking' | 'background' | 'lazy';
}

interface FreshApiDoc {
  doc: ApiDocumentation;
  freshness: FreshnessInfo;
  warnings: FreshnessWarning[];
}

interface FreshnessInfo {
  checkedAt: string;
  isFresh: boolean;
  age: Duration;
  nextCheckDue: string;
  confidence: number;
}

interface FreshnessWarning {
  type: 'stale' | 'update_failed' | 'partial_update' | 'unverified';
  message: string;
  affectedMethods?: string[];
  recommendation: string;
}

/** Freshness-aware cache implementation */
class FreshnessAwareCacheImpl implements FreshnessAwareCache {
  private cache: Map<string, CachedApiDoc>;
  private subscriptions: Map<string, Set<Subscription>>;
  private freshnessScheduler: FreshnessScheduler;

  async getWithFreshnessCheck(
    apiId: string,
    options: FreshnessOptions
  ): Promise<FreshApiDoc> {
    const cached = this.cache.get(apiId);

    // No cache - must fetch
    if (!cached) {
      const doc = await this.fetchFull(apiId);
      this.cache.set(apiId, this.createCacheEntry(doc));
      return { doc, freshness: this.createFreshInfo(doc), warnings: [] };
    }

    // Check if within acceptable age
    if (this.isWithinMaxAge(cached, options.maxAge)) {
      return {
        doc: cached.doc,
        freshness: { ...cached.freshness, isFresh: true },
        warnings: [],
      };
    }

    // Need freshness check
    const freshnessResult = await this.checkFreshness(apiId, cached, options.strategies);

    if (freshnessResult.isFresh) {
      // Cache is still valid, just update freshness timestamp
      cached.freshness.checkedAt = new Date().toISOString();
      return { doc: cached.doc, freshness: cached.freshness, warnings: [] };
    }

    // Needs update
    if (options.updateMode === 'blocking') {
      return await this.updateAndReturn(apiId, cached, freshnessResult, options);
    } else if (options.updateMode === 'background') {
      this.scheduleBackgroundUpdate(apiId, cached, freshnessResult);
      return {
        doc: cached.doc,
        freshness: { ...cached.freshness, isFresh: false },
        warnings: [{ type: 'stale', message: 'Update in progress', recommendation: 'Proceed with caution' }],
      };
    } else {
      // Lazy - return stale with verify-at-use markers
      return this.returnWithVerifyAtUse(cached, freshnessResult);
    }
  }

  private async checkFreshness(
    apiId: string,
    cached: CachedApiDoc,
    strategies: FreshnessStrategy[]
  ): Promise<FreshnessCheckResult> {
    // Try strategies in order of efficiency
    const orderedStrategies = this.orderStrategiesByEfficiency(strategies);

    for (const strategy of orderedStrategies) {
      try {
        const result = await this.executeStrategy(strategy, apiId, cached);
        if (result.conclusive) {
          return result;
        }
      } catch (e) {
        // Strategy failed, try next
        continue;
      }
    }

    // No conclusive result - assume stale after max age
    return { isFresh: false, conclusive: false, reason: 'no_strategy_conclusive' };
  }

  private async executeStrategy(
    strategy: FreshnessStrategy,
    apiId: string,
    cached: CachedApiDoc
  ): Promise<FreshnessCheckResult> {
    switch (strategy) {
      case 'etag_check':
        return this.checkETag(apiId, cached.etag);

      case 'version_endpoint':
        return this.checkVersionEndpoint(apiId, cached.doc.version);

      case 'registry_poll':
        return this.checkRegistry(apiId, cached.doc.version);

      case 'hash_comparison':
        return this.checkHash(apiId, cached.contentHash);

      case 'spec_diff':
        return this.checkSpecDiff(apiId, cached.doc);

      case 'runtime_probe':
        return this.probeRuntime(apiId, cached.doc);

      default:
        return { isFresh: false, conclusive: false, reason: 'unknown_strategy' };
    }
  }
}
```

#### XXI.L.3. Verify-at-Use Pattern

For rapidly changing APIs, even fresh docs might be stale by use-time. The **Verify-at-Use** pattern adds runtime verification.

```typescript
/** Verify-at-use primitive */
const tp_api_verify_at_use: TechniquePrimitive = {
  id: 'tp_api_verify_at_use',
  name: 'Verify API at Use Time',
  family: 'reference',

  preconditions: [
    { type: 'input_available', value: 'apiCall' },
    { type: 'input_available', value: 'expectedSignature' },
  ],

  postconditions: [
    { type: 'output_available', value: 'verificationResult' },
  ],

  inputs: [
    { name: 'apiCall', type: 'ApiCallIntent' },
    { name: 'expectedSignature', type: 'MethodSignature' },
    { name: 'verificationLevel', type: 'minimal | standard | thorough' },
  ],

  outputs: [
    { name: 'isValid', type: 'boolean' },
    { name: 'mismatch', type: 'SignatureMismatch | null' },
    { name: 'correctedCall', type: 'ApiCallIntent | null' },
    { name: 'warnings', type: 'Warning[]' },
  ],

  hints: [
    'Lightweight verification before actual API call',
    'Can auto-correct minor mismatches',
    'Fails fast on breaking changes',
    'Minimal latency overhead',
  ],
};

interface ApiCallIntent {
  method: string;
  endpoint: string;
  params: Record<string, unknown>;
  expectedReturn: TypeInfo;
}

interface SignatureMismatch {
  type: 'endpoint_changed' | 'param_changed' | 'param_removed' | 'param_added' | 'return_changed';
  expected: unknown;
  actual: unknown;
  severity: 'warning' | 'error' | 'critical';
  autoCorrectible: boolean;
}

/** Verify-at-use wrapper */
async function callApiWithVerification<T>(
  intent: ApiCallIntent,
  cachedSignature: MethodSignature,
  options: VerifyAtUseOptions = {}
): Promise<ApiCallResult<T>> {
  // Step 1: Quick signature verification (if enabled)
  if (options.verifyFirst) {
    const verification = await verifySignature(intent, cachedSignature);

    if (!verification.isValid) {
      if (verification.autoCorrectible && options.autoCorrect) {
        intent = verification.correctedCall!;
      } else {
        return {
          success: false,
          error: {
            type: 'signature_mismatch',
            mismatch: verification.mismatch,
            suggestion: 'Refresh API documentation and retry',
          },
        };
      }
    }
  }

  // Step 2: Make the actual call
  try {
    const result = await executeApiCall<T>(intent);

    // Step 3: Validate response matches expected type
    if (options.validateResponse) {
      const responseValid = validateResponseType(result.data, cachedSignature.returnType);
      if (!responseValid) {
        // API response changed - trigger doc update
        triggerDocUpdate(intent.method, { reason: 'response_type_mismatch' });
        return {
          success: true,
          data: result.data,
          warnings: ['Response type differs from documentation - docs may be stale'],
        };
      }
    }

    return { success: true, data: result.data };
  } catch (error) {
    // Step 4: Analyze error for staleness indicators
    if (isStaleDocError(error)) {
      triggerDocUpdate(intent.method, { reason: 'call_failed_stale_indicator', error });
      return {
        success: false,
        error: {
          type: 'likely_stale_docs',
          originalError: error,
          suggestion: 'API documentation may be outdated',
        },
      };
    }
    throw error;
  }
}
```

#### XXI.L.4. Proactive Update Scheduling

```typescript
/** Proactive update scheduler */
interface UpdateScheduler {
  /** Schedule updates based on API volatility */
  scheduleUpdates(apis: ApiVolatilityProfile[]): UpdateSchedule;

  /** Predict when an API might change */
  predictNextChange(apiId: string): ChangePrediction;

  /** Get optimal update frequency */
  getOptimalFrequency(apiId: string, usagePattern: UsagePattern): Duration;
}

interface ApiVolatilityProfile {
  apiId: string;
  releaseFrequency: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'irregular';
  breakingChangeFrequency: 'rare' | 'occasional' | 'frequent';
  importance: 'critical' | 'high' | 'medium' | 'low';
  lastKnownChange: string;
  averageTimeBetweenChanges: Duration;
}

interface ChangePrediction {
  apiId: string;
  predictedNextChange: string;
  confidence: number;
  basis: 'historical_pattern' | 'release_schedule' | 'changelog_analysis' | 'unknown';
  recommendedCheckFrequency: Duration;
}

/** Smart update scheduler implementation */
class SmartUpdateScheduler implements UpdateScheduler {
  scheduleUpdates(apis: ApiVolatilityProfile[]): UpdateSchedule {
    const schedule: UpdateScheduleEntry[] = [];

    for (const api of apis) {
      const frequency = this.calculateOptimalFrequency(api);
      const priority = this.calculatePriority(api);

      schedule.push({
        apiId: api.apiId,
        checkFrequency: frequency,
        priority,
        strategy: this.selectStrategy(api),
        maxStaleness: this.calculateMaxStaleness(api),
      });
    }

    return this.optimizeSchedule(schedule);
  }

  private calculateOptimalFrequency(api: ApiVolatilityProfile): Duration {
    // Base frequency on volatility
    const baseFrequency = {
      'daily': { hours: 4 },
      'weekly': { hours: 24 },
      'monthly': { days: 3 },
      'quarterly': { days: 14 },
      'irregular': { hours: 12 },
    }[api.releaseFrequency];

    // Adjust for importance
    const importanceMultiplier = {
      'critical': 0.5,
      'high': 0.75,
      'medium': 1.0,
      'low': 2.0,
    }[api.importance];

    return this.multiplyDuration(baseFrequency, importanceMultiplier);
  }

  private selectStrategy(api: ApiVolatilityProfile): FreshnessStrategy[] {
    // Critical + daily = aggressive checking
    if (api.importance === 'critical' && api.releaseFrequency === 'daily') {
      return ['webhook_subscription', 'etag_check', 'version_endpoint', 'runtime_probe'];
    }

    // Standard approach
    return ['etag_check', 'registry_poll', 'hash_comparison'];
  }
}
```

#### XXI.L.5. Change Notification Integration

```typescript
/** Change notification sources */
interface ChangeNotificationSource {
  type: 'webhook' | 'rss' | 'github_releases' | 'registry_events' | 'polling';

  /** Subscribe to changes */
  subscribe(apiId: string, callback: ChangeCallback): Subscription;

  /** Get historical changes */
  getChanges(apiId: string, since: Date): Promise<ChangeEvent[]>;
}

interface ChangeEvent {
  apiId: string;
  timestamp: string;
  changeType: 'version_bump' | 'breaking_change' | 'deprecation' | 'new_endpoint' | 'doc_update';
  version: string;
  summary: string;
  affectedEndpoints: string[];
  migrationGuide?: string;
  source: string;
}

/** Multi-source change aggregator */
class ChangeAggregator {
  private sources: Map<string, ChangeNotificationSource[]>;
  private subscribers: Map<string, Set<ChangeCallback>>;

  /** Register for all available notification sources for an API */
  async registerForChanges(apiId: string): Promise<RegistrationResult> {
    const sources = await this.discoverSources(apiId);
    const registrations: Registration[] = [];

    for (const source of sources) {
      try {
        const sub = source.subscribe(apiId, (change) => this.handleChange(apiId, change));
        registrations.push({ source: source.type, subscription: sub });
      } catch (e) {
        // Source unavailable, continue with others
      }
    }

    return {
      apiId,
      activeSources: registrations.map(r => r.source),
      fallbackPollingEnabled: registrations.length === 0,
    };
  }

  private async discoverSources(apiId: string): Promise<ChangeNotificationSource[]> {
    const sources: ChangeNotificationSource[] = [];

    // Check for webhook support
    const webhookUrl = await this.findWebhookUrl(apiId);
    if (webhookUrl) {
      sources.push(new WebhookSource(webhookUrl));
    }

    // Check for GitHub releases
    const githubRepo = await this.findGitHubRepo(apiId);
    if (githubRepo) {
      sources.push(new GitHubReleasesSource(githubRepo));
    }

    // Check registry (npm, PyPI, etc.)
    const registry = this.detectRegistry(apiId);
    if (registry) {
      sources.push(new RegistryEventsSource(registry, apiId));
    }

    // Always add polling as fallback
    sources.push(new PollingSource(apiId));

    return sources;
  }
}
```

#### XXI.L.6. Adaptive Freshness Intelligence

The key insight: **freshness requirements should be LEARNED, not configured**. The system observes:
- When API calls fail due to staleness
- How often each API actually changes
- Usage patterns (which methods, how critical)
- Cost of staleness (failed agent actions)

```typescript
/** Adaptive freshness model - learns optimal checking intervals */
interface AdaptiveFreshnessModel {
  /** Core learned parameters per API */
  apiModels: Map<string, LearnedApiModel>;

  /** Global patterns across all APIs */
  globalPatterns: GlobalFreshnessPatterns;

  /** Update model from observed outcomes */
  learn(observation: FreshnessObservation): void;

  /** Get optimal freshness strategy for an API */
  getStrategy(apiId: string, context: UsageContext): AdaptiveStrategy;
}

interface LearnedApiModel {
  apiId: string;

  // Learned timing patterns
  observedChangeIntervals: Duration[];  // Actual time between changes
  meanChangeInterval: Duration;
  changeIntervalVariance: number;
  lastObservedChange: string;

  // Learned reliability patterns
  staleness_failure_rate: number;  // How often stale docs cause failures
  false_positive_rate: number;     // How often we refresh unnecessarily
  verification_success_rate: number;  // How often verify-at-use catches issues

  // Learned cost model
  refresh_cost: ResourceCost;       // Cost to refresh docs
  staleness_cost: ResourceCost;     // Cost when agent fails due to stale docs
  verification_cost: ResourceCost;  // Cost to verify at use time

  // Confidence in the model
  observationCount: number;
  modelConfidence: number;
  lastModelUpdate: string;
}

interface FreshnessObservation {
  apiId: string;
  timestamp: string;
  observationType:
    | 'api_changed'              // We detected the API changed
    | 'staleness_caused_failure' // Agent failed because docs were stale
    | 'refresh_was_unnecessary'  // Refreshed but nothing changed
    | 'verification_caught_issue'// Verify-at-use found a problem
    | 'verification_passed'      // Verify-at-use confirmed docs still valid
    | 'successful_use';          // Used docs successfully (no staleness issue)

  details: {
    docAge?: Duration;
    methodUsed?: string;
    errorEncountered?: string;
  };
}

/** The adaptive strategy generator */
class AdaptiveFreshnessEngine {
  private models: Map<string, LearnedApiModel> = new Map();

  getStrategy(apiId: string, context: UsageContext): AdaptiveStrategy {
    const model = this.models.get(apiId);

    // No model yet - use conservative defaults, then learn
    if (!model || model.modelConfidence < 0.3) {
      return this.bootstrapStrategy(apiId, context);
    }

    // Calculate optimal check interval using Bayesian approach
    const optimalInterval = this.calculateOptimalInterval(model, context);

    // Decide strategy based on learned patterns
    return {
      checkInterval: optimalInterval,
      strategyType: this.selectStrategyType(model, context),
      verifyAtUse: this.shouldVerifyAtUse(model, context),
      proactiveRefresh: this.shouldProactivelyRefresh(model, context),
      confidence: model.modelConfidence,
    };
  }

  private calculateOptimalInterval(model: LearnedApiModel, context: UsageContext): Duration {
    // The math: balance refresh cost vs staleness cost
    //
    // Expected cost of waiting time T:
    //   P(stale at T) * staleness_cost + refresh_cost / T
    //
    // P(stale at T) ≈ 1 - exp(-T / mean_change_interval) for Poisson process
    //
    // Optimal T minimizes total expected cost

    const meanInterval = model.meanChangeInterval;
    const stalenessCost = model.staleness_cost.tokens + model.staleness_cost.latencyMs / 10;
    const refreshCost = model.refresh_cost.tokens + model.refresh_cost.latencyMs / 10;

    // Apply criticality multiplier from context
    const criticalityMultiplier = {
      'critical': 0.3,    // Check more often for critical usage
      'high': 0.5,
      'medium': 1.0,
      'low': 2.0,
    }[context.criticality];

    // Bayesian adjustment based on model confidence
    // Lower confidence = more conservative (check more often)
    const confidenceAdjustment = 0.5 + (model.modelConfidence * 0.5);

    // Calculate optimal interval
    const baseOptimal = Math.sqrt(
      (2 * refreshCost * this.toMillis(meanInterval)) / stalenessCost
    );

    return this.fromMillis(baseOptimal * criticalityMultiplier * confidenceAdjustment);
  }

  private selectStrategyType(model: LearnedApiModel, context: UsageContext): StrategyType {
    // If verification catches issues often, use verify-at-use
    if (model.verification_success_rate > 0.8 && model.verification_cost.tokens < 10) {
      return 'verify_at_use';
    }

    // If API changes frequently but predictably, use proactive refresh
    if (model.changeIntervalVariance < 0.3 && this.toHours(model.meanChangeInterval) < 24) {
      return 'proactive_scheduled';
    }

    // If staleness rarely causes issues, use lazy refresh
    if (model.staleness_failure_rate < 0.05) {
      return 'lazy_on_failure';
    }

    // Default: adaptive check before use
    return 'check_before_use';
  }

  private shouldVerifyAtUse(model: LearnedApiModel, context: UsageContext): boolean {
    // Always verify for critical operations
    if (context.criticality === 'critical') return true;

    // Verify if docs are near the learned change interval
    const docAge = context.currentDocAge;
    const riskThreshold = model.meanChangeInterval;

    // If doc age > 50% of mean change interval, verify
    return this.toMillis(docAge) > this.toMillis(riskThreshold) * 0.5;
  }

  private shouldProactivelyRefresh(model: LearnedApiModel, context: UsageContext): boolean {
    // Proactive if:
    // 1. API is frequently used (amortizes refresh cost)
    // 2. Change pattern is predictable
    // 3. Staleness cost is high

    const isFrequentlyUsed = context.usageFrequency === 'high';
    const isPredictable = model.changeIntervalVariance < 0.5;
    const highStalenessCost = model.staleness_failure_rate > 0.2;

    return isFrequentlyUsed && isPredictable && highStalenessCost;
  }

  /** Learn from observation */
  learn(observation: FreshnessObservation): void {
    let model = this.models.get(observation.apiId);
    if (!model) {
      model = this.createInitialModel(observation.apiId);
      this.models.set(observation.apiId, model);
    }

    switch (observation.observationType) {
      case 'api_changed':
        // Update change interval statistics
        if (model.lastObservedChange) {
          const interval = this.computeInterval(model.lastObservedChange, observation.timestamp);
          model.observedChangeIntervals.push(interval);
          this.updateIntervalStats(model);
        }
        model.lastObservedChange = observation.timestamp;
        break;

      case 'staleness_caused_failure':
        // Increase staleness cost estimate, adjust failure rate
        model.staleness_failure_rate = this.exponentialMovingAvg(
          model.staleness_failure_rate, 1.0, 0.1
        );
        model.staleness_cost = this.increaseCost(model.staleness_cost, observation);
        break;

      case 'successful_use':
        // Decrease staleness failure rate estimate
        model.staleness_failure_rate = this.exponentialMovingAvg(
          model.staleness_failure_rate, 0.0, 0.05
        );
        break;

      case 'refresh_was_unnecessary':
        // Note: we refreshed but API hadn't changed
        model.false_positive_rate = this.exponentialMovingAvg(
          model.false_positive_rate, 1.0, 0.1
        );
        break;

      case 'verification_caught_issue':
        model.verification_success_rate = this.exponentialMovingAvg(
          model.verification_success_rate, 1.0, 0.1
        );
        break;

      case 'verification_passed':
        // Verification worked but nothing was wrong
        model.verification_success_rate = this.exponentialMovingAvg(
          model.verification_success_rate, 0.0, 0.05
        );
        break;
    }

    model.observationCount++;
    model.modelConfidence = this.computeConfidence(model);
    model.lastModelUpdate = observation.timestamp;
  }

  private computeConfidence(model: LearnedApiModel): number {
    // Confidence based on:
    // 1. Number of observations
    // 2. Consistency of observations
    // 3. Recency of observations

    const observationFactor = Math.min(model.observationCount / 50, 1.0);
    const consistencyFactor = 1 - Math.min(model.changeIntervalVariance, 1.0);
    const recencyFactor = this.computeRecencyFactor(model.lastModelUpdate);

    return observationFactor * 0.4 + consistencyFactor * 0.3 + recencyFactor * 0.3;
  }

  /** Bootstrap strategy for unknown APIs */
  private bootstrapStrategy(apiId: string, context: UsageContext): AdaptiveStrategy {
    // For unknown APIs, use heuristics based on API type and context

    // Infer volatility from API source
    const inferredVolatility = this.inferVolatilityFromSource(apiId);

    return {
      checkInterval: inferredVolatility.suggestedInterval,
      strategyType: 'check_before_use',
      verifyAtUse: context.criticality === 'critical',
      proactiveRefresh: false,
      confidence: 0.2,  // Low confidence, will learn
      bootstrapped: true,
      bootstrapReason: inferredVolatility.reason,
    };
  }

  private inferVolatilityFromSource(apiId: string): InferredVolatility {
    // Heuristics based on API source

    // SaaS APIs (Stripe, Twilio) - typically stable, monthly changes
    if (this.isSaasApi(apiId)) {
      return { suggestedInterval: { days: 7 }, reason: 'saas_api_typically_stable' };
    }

    // Internal/company APIs - can change anytime
    if (this.isInternalApi(apiId)) {
      return { suggestedInterval: { hours: 4 }, reason: 'internal_api_may_change_frequently' };
    }

    // Major cloud providers (AWS, GCP) - stable but large
    if (this.isCloudProviderApi(apiId)) {
      return { suggestedInterval: { days: 3 }, reason: 'cloud_provider_stable_but_large' };
    }

    // NPM packages - check based on semver
    if (this.isNpmPackage(apiId)) {
      return { suggestedInterval: { days: 1 }, reason: 'npm_package_check_daily' };
    }

    // Unknown - conservative default
    return { suggestedInterval: { hours: 12 }, reason: 'unknown_api_conservative_default' };
  }
}

type StrategyType =
  | 'verify_at_use'        // Quick verification right before API call
  | 'check_before_use'     // Full freshness check before use
  | 'proactive_scheduled'  // Refresh on a learned schedule
  | 'lazy_on_failure';     // Only refresh when something fails

interface AdaptiveStrategy {
  checkInterval: Duration;
  strategyType: StrategyType;
  verifyAtUse: boolean;
  proactiveRefresh: boolean;
  confidence: number;
  bootstrapped?: boolean;
  bootstrapReason?: string;
}

interface UsageContext {
  criticality: 'critical' | 'high' | 'medium' | 'low';
  usageFrequency: 'high' | 'medium' | 'low';
  currentDocAge: Duration;
  operationType: 'read' | 'write' | 'delete';
}
```

#### XXI.L.7. Self-Tuning Freshness Composition

```typescript
/** Composition that learns and adapts */
const tc_adaptive_api_freshness: TechniqueComposition = {
  id: 'tc_adaptive_api_freshness',
  name: 'Adaptive API Freshness',
  description: 'Self-learning system that discovers optimal freshness strategies per API',

  primitives: [
    tp_api_freshness_check,
    tp_api_incremental_update,
    tp_api_doc_fetch,
    tp_api_verify_at_use,
    tp_method_lookup,
    tp_freshness_learn,  // New: learning primitive
  ],

  operators: [
    // Get adaptive strategy for this API
    {
      type: 'compute',
      action: 'adaptiveFreshnessEngine.getStrategy(apiId, context)',
      output: 'strategy',
    },
    // Execute based on learned strategy
    {
      type: 'branch',
      on: 'strategy.strategyType',
      cases: {
        'verify_at_use': ['tp_method_lookup', 'tp_api_verify_at_use'],
        'check_before_use': ['tp_api_freshness_check', {
          type: 'branch',
          on: 'needsUpdate',
          cases: {
            'true': ['tp_api_incremental_update', 'tp_method_lookup'],
            'false': ['tp_method_lookup'],
          },
        }],
        'proactive_scheduled': ['tp_method_lookup'],  // Already refreshed proactively
        'lazy_on_failure': ['tp_method_lookup'],      // Will refresh if it fails
      },
    },
    // Always: record outcome for learning
    {
      type: 'finally',
      action: 'tp_freshness_learn',
      input: 'outcome',
    },
  ],

  hints: [
    'Learns optimal freshness strategy per API',
    'No hardcoded thresholds - discovers them',
    'Balances refresh cost vs staleness cost',
    'Adapts to API volatility patterns over time',
  ],

  // NO hardcoded constraints - everything is learned
  learningConfig: {
    initialExplorationPeriod: 10,  // observations before trusting model
    explorationRate: 0.1,          // 10% of time try alternative strategies
    modelPersistence: true,        // save learned models across sessions
  },
};

/** The learning primitive */
const tp_freshness_learn: TechniquePrimitive = {
  id: 'tp_freshness_learn',
  name: 'Learn Freshness Pattern',
  family: 'learning',

  preconditions: [
    { type: 'input_available', value: 'apiUsageOutcome' },
  ],

  postconditions: [
    { type: 'state_updated', value: 'freshness_model' },
  ],

  inputs: [
    { name: 'apiId', type: 'string' },
    { name: 'outcome', type: 'ApiUsageOutcome' },
    { name: 'strategy_used', type: 'AdaptiveStrategy' },
    { name: 'doc_age_at_use', type: 'Duration' },
  ],

  outputs: [
    { name: 'modelUpdated', type: 'boolean' },
    { name: 'strategyAdjustment', type: 'StrategyAdjustment | null' },
  ],

  hints: [
    'Called after every API documentation use',
    'Updates the learned model for that API',
    'Feeds into adaptive strategy selection',
  ],
};

interface ApiUsageOutcome {
  success: boolean;
  failureReason?: 'stale_docs' | 'api_error' | 'network' | 'other';
  docWasStale?: boolean;
  verificationResult?: 'passed' | 'caught_issue' | 'skipped';
  latency: Duration;
  tokensUsed: number;
}
```

#### XXI.L.8. Priority Update

Add to consolidated priority list:

| ID | Priority | Item | Part | Dependencies |
|----|----------|------|------|--------------|
| **G11** | P0 | Adaptive Freshness Engine (core learning loop) | XXI.L | G1 |
| **G12** | P0 | tp_freshness_learn primitive | XXI.L | G11 |
| **G13** | P1 | Learned API Model persistence | XXI.L | G11, G12 |
| **G14** | P1 | Verify-at-Use with learned thresholds | XXI.L | G13 |
| **G15** | P2 | Bootstrap heuristics for unknown APIs | XXI.L | G11 |
| **G16** | P2 | Change Notification Integration | XXI.L | G13 |
| **G17** | P3 | Cross-API pattern learning (global patterns) | XXI.L | G13 |

**Key Principle**: All freshness thresholds are **LEARNED from observed outcomes**, not hardcoded. The system:
1. Starts with conservative heuristics for unknown APIs
2. Observes every API usage outcome (success, failure, staleness cause)
3. Learns optimal check intervals using cost-benefit analysis
4. Adapts strategy type (verify-at-use, proactive, lazy) per API
5. Builds confidence over time, becomes more aggressive as confidence grows

---

### XXI.M. Critical Self-Evaluation: Will This Actually Work?

> **Honest assessment of the primitive/composition system and its effectiveness**

#### The Core Problem: Specification vs Implementation

Everything written in this document is **specification**, not **implementation**. The primitives are:

```typescript
// This is just a DATA STRUCTURE describing WHAT to do
const tp_api_freshness_check: TechniquePrimitive = {
  id: 'tp_api_freshness_check',
  preconditions: [...],
  postconditions: [...],
  // ...
};

// NOT executable code that actually checks freshness
```

**Reality check**: A `TechniquePrimitive` is a TypeScript interface definition. It has no code. It cannot be executed. It's documentation in code form.
**Reality check (more precise)**: A `TechniquePrimitive` is a *data record* describing intent + contracts; execution happens only via separate executors/handlers (see `PrimitiveExecutionHandler` in `src/LiBrainian/api/technique_execution.ts`). If a primitive has no handler, it is not runnable.

#### What's Missing for This to Actually Work

| Component | What We Have | What We Need | Gap |
|-----------|--------------|--------------|-----|
| **Primitives** | Declarative records + contracts | Concrete executors (handlers) + evidence emission | **CRITICAL** |
| **Execution Engine** | `TechniqueExecutionEngine` + operator registry/interpreters | End-to-end verified semantics + broader operator coverage + build/typecheck green | **CRITICAL** |
| **Learning Infrastructure** | Partial learning + episodes | Unified evidence ledger + durable outcome instrumentation + calibrated updates | **CRITICAL** |
| **API Integration** | None | HTTP clients, registry APIs, parsers | **HIGH** |
| **Observation Recording** | Interface defined | Actual instrumentation in agent code | **HIGH** |
| **Model Persistence** | Type defined | Database/file storage, serialization | **MEDIUM** |

#### The Fundamental Question: What Does a Primitive Actually DO?

When an agent needs to check API freshness, what happens?

**Current state (what we've written)**:
```typescript
// This is metadata, not execution
const primitive = tp_api_freshness_check;
// Now what? primitive.execute() doesn't exist
```

**What's needed**:
```typescript
// ACTUAL implementation
async function executeApiFreshnessCheck(
  apiId: string,
  cached: CachedApiDoc,
  strategies: FreshnessStrategy[]
): Promise<FreshnessCheckResult> {
  // Real code that:
  // 1. Makes HTTP HEAD request with If-None-Match
  // 2. Checks registry API for version
  // 3. Parses changelog
  // 4. Compares hashes
  // etc.
}
```

#### The Execution Gap

The compositions describe flows like:
```typescript
operators: [
  { type: 'branch', on: 'updateNeeded', cases: { ... } }
]
```

But there's no **interpreter** that:
1. Evaluates `updateNeeded`
2. Selects the correct branch
3. Executes the primitives in that branch
4. Handles errors and retries
5. Records observations for learning

**Reality check**: An interpreter layer exists (`src/LiBrainian/api/technique_execution.ts` + `src/LiBrainian/api/operator_registry.ts` + `src/LiBrainian/api/operator_interpreters.ts`), but it is not yet verified end-to-end (build/typecheck/test gates are not green), and many primitives described in this document still lack concrete executors + evidence-ledger instrumentation.

#### The Learning System Reality Check

The adaptive freshness system described requires:

1. **Recording observations**: Every API usage must call `learn(observation)`. But agents don't know to do this - it requires instrumentation.

2. **Statistical computations**: The Bayesian interval calculation, exponential moving averages, variance tracking - these need actual math libraries.

3. **Persistence**: Learned models must survive process restarts. This needs storage.

4. **Bootstrap**: For the system to learn, it needs to be deployed and accumulate data. Initial behavior is heuristic-based.

**Realistic timeline to useful learning**:
- Day 1-7: Pure heuristics (no data)
- Week 2-4: Some patterns emerging (limited data)
- Month 2+: Meaningful learned behavior (if instrumentation is complete)

#### What Would Make This Effective

**Level 1: Minimal Viable (Get Something Working)**

```typescript
// 1. Simple implementations for core primitives
class FreshnessChecker {
  async check(apiId: string, cached: CachedApiDoc): Promise<boolean> {
    // Just check ETag - simplest strategy
    const response = await fetch(cached.specUrl, { method: 'HEAD' });
    return response.headers.get('ETag') === cached.etag;
  }
}

// 2. Basic execution - forget the fancy composition operators
async function executeWithFreshness(apiId: string, action: () => Promise<T>): Promise<T> {
  const docs = await freshnessChecker.getDocsIfFresh(apiId);
  if (!docs) {
    await freshnessChecker.refresh(apiId);
  }
  return action();
}
```

**Level 2: Add Learning**

```typescript
// 3. Observation recording (simple)
const observations: FreshnessObservation[] = [];

function recordObservation(obs: FreshnessObservation) {
  observations.push(obs);
  // Periodically persist to file
}

// 4. Simple adaptive logic
function getCheckInterval(apiId: string): Duration {
  const apiObs = observations.filter(o => o.apiId === apiId);
  if (apiObs.length < 10) return { hours: 12 }; // Not enough data

  // Calculate from observed change intervals
  const changes = apiObs.filter(o => o.observationType === 'api_changed');
  if (changes.length < 2) return { hours: 12 };

  const intervals = computeIntervals(changes);
  return { milliseconds: mean(intervals) * 0.5 }; // Check at half the average interval
}
```

**Level 3: Full System**

Only after Levels 1-2 are working should we build:
- Composition operators and interpreter
- Multiple strategy selection
- Cross-API pattern learning
- Webhook subscriptions

#### Honest Priority Adjustment

Given this critique, the priorities should be:

| Priority | What | Why |
|----------|------|-----|
| **P0** | Basic freshness check (ETag/HEAD) | One working strategy beats zero |
| **P0** | Simple observation recording | Learning needs data |
| **P1** | File-based model persistence | Models must survive restarts |
| **P1** | Basic interval calculation | Use actual data, not heuristics |
| **P2** | Multiple strategies | After one works |
| **P3** | Composition interpreter | After primitives work |
| **P4** | Full adaptive engine | After basics prove out |

#### The Meta-Critique: Documentation Theater

There's a risk that this document becomes **documentation theater** - elaborate specifications that feel productive but produce no working system.

**Signs of documentation theater**:
- Very detailed type definitions, no implementations
- Complex compositions, no interpreter
- Learning algorithms, no data infrastructure
- Many primitives, none executable

**How to avoid it**:
1. **Build smallest working thing first** - One primitive that actually executes
2. **Test with real agent** - Does it help? Does it break?
3. **Add one thing at a time** - Each addition must work before the next
4. **Measure effectiveness** - Track if staleness failures decrease

#### Conclusion: The Path Forward

The primitive/composition system **CAN** be effective, but only if:

1. **We verify the execution layer end-to-end** (Part XV exists but needs live verification)
2. **We implement primitives concretely** (not just metadata + contracts)
3. **We instrument agent code** to record observations in a unified ledger
4. **We deploy and iterate** based on real data

Without these, everything in Part XXI remains **specification documentation**, not a working system.

**Recommended immediate action**:
```bash
# Instead of more specification, verify ONE end-to-end run:
# 1. Use TechniqueExecutionEngine with one primitive + one operator
# 2. Record execution evidence to a ledger-like sink
# 3. Validate output contracts and replay behavior
# 4. Document results in WORKLOG
```

#### The Bottom Line

| Component | Reality |
|-----------|---------|
| **Primitives** | Metadata + contracts exist; execution handlers exist, but coverage is incomplete and contracts are not wired to evidence. |
| **Execution Engine** | Implemented (`technique_execution.ts` + operator registry/interpreters) but not verified end-to-end with real traces. |
| **Learning Infrastructure** | Partial: ClosedLoopLearner + episodes state exist; missing unified evidence ledger + calibration loops. |
| **API Integration** | Partial: LLM provider discovery exists; broader adapters/tools remain incomplete. |

**The Risk: Documentation Theater**

This document has grown to ~22,700 lines of detailed specifications that feel productive but produce no working system:
- Very detailed type definitions → no implementations
- Complex compositions → no interpreter
- Learning algorithms → no data infrastructure
- Many primitives → none executable

**What Would Actually Make This Work**

```typescript
// Level 1: ONE working function beats 100 type definitions
class FreshnessChecker {
  async check(apiId: string, cached: CachedApiDoc): Promise<boolean> {
    const response = await fetch(cached.specUrl, { method: 'HEAD' });
    return response.headers.get('ETag') === cached.etag;
  }
}

// Level 2: Simple observation recording
function recordObservation(obs: FreshnessObservation) {
  fs.appendFileSync('observations.jsonl', JSON.stringify(obs) + '\n');
}

// Level 3: Calculate from real data
function getInterval(apiId: string): Duration {
  const obs = loadObservations().filter(o => o.apiId === apiId);
  const intervals = computeChangeIntervals(obs);
  return { milliseconds: mean(intervals) * 0.5 };
}

// Level 4+: Only THEN build the fancy composition system
```

**The primitive/composition system CAN be effective - but only with verified execution + evidence, not more documentation.**

**STOP ADDING SPECIFICATIONS. START IMPLEMENTING.**

---

### XXI.K. Change Log

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-01-21 | Initial Part XXI: Comprehensive Programming Knowledge Support |
| 1.1 | 2026-01-21 | Added XXI.L: Real-Time API Freshness Architecture |
| 1.2 | 2026-01-21 | Replaced fixed thresholds with Adaptive Freshness Intelligence (learning-based) |
| 1.3 | 2026-01-21 | Added XXI.M: Critical Self-Evaluation - honest assessment of specification vs implementation gap |

**Sections added:**
- XXI.A: API Documentation & Reference Support (5 primitives, 1 composition)
- XXI.B: Role-Based Knowledge Needs (20+ roles, 3 adaptation primitives)
- XXI.C: Expertise-Level Knowledge Adaptation (7 levels, 1 inference primitive)
- XXI.D: Common Programming Tasks (12 categories, 6 primitives)
- XXI.E: Domain-Specific Knowledge (12 domains, 3 primitives)
- XXI.F: Rare and Edge Case Knowledge (12 categories, 3 primitives)
- XXI.G: Priority Implementation Matrix (G1-G10)
- XXI.H: Consolidated Priority List Update
- XXI.I: Knowledge Source Integration Architecture
- XXI.J: Types for Knowledge Source Integration
- XXI.L: Real-Time API Freshness Architecture (adaptive learning-based, G11-G17 priorities)
- XXI.M: Critical Self-Evaluation (specification vs implementation gap analysis)
