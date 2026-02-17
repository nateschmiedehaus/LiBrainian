# LiBrainian Diagnosis + Recovery Plan (Bootstrap + Effectiveness)

Status: active
Scope: diagnose why LiBrainian is currently inefficient/fragile vs its own docs, and provide a recovery plan with evidence gates.
Last Verified: 2026-01-11
Owner: librarianship
Evidence: code + local runs (Tier-0 + LiBrainian bootstrap/status)

## Executive Summary (What’s Broken / Risky)

1. **Bootstrap reliability is gated on live provider availability**.
   - If providers are rate/usage limited, bootstrap must fail fast with `unverified_by_trace(provider_unavailable)` (no “slow death” runs).
   - This repo’s `--scope LiBrainian` bootstrap has been completed successfully using a mini model (`gpt-5.1-codex-mini`).

2. **Bootstrap is structurally too expensive** for the performance SLOs in `docs/LiBrainian/validation.md`.
   - **Full** bootstrap mode is inherently expensive (LLM work across file knowledge, directory knowledge, context packs, and universal knowledge).
   - **Fast** bootstrap mode exists specifically to meet SLOs: avoid per-entity LLM enrichment while still producing usable semantic index + packs.

3. **Provider gating must be bootstrap-grade** (probe usability, not just authentication).
   - Bootstrap now uses a forced probe to catch rate/usage/model incompatibilities early.

4. **Resumability must cover every LLM-heavy loop** to avoid repeated quota burn.
   - Universal knowledge, file knowledge, directory knowledge, and context pack generation now support “skip unchanged / skip un-invalidated”.

## Non-Negotiables (From Canon)

These constraints come directly from canonical docs:
- **No fake embeddings** and no bypass of semantic layers (`AGENTS.md`, `docs/LIVE_PROVIDERS_PLAYBOOK.md`).
- **Fail closed** when providers are unavailable (`docs/LiBrainian/README.md`, `docs/LiBrainian/validation.md`).
- **Waiting by default** for required LLM operations unless explicitly configured (`docs/LiBrainian/README.md`).
- **No theater**: any “pass” must observe real behavior (`docs/LiBrainian/validation.md`).

## Concrete Diagnosis (Root Causes)

### D1) Unbounded LLM Work in Bootstrap
- `src/LiBrainian/api/bootstrap.ts` runs:
  - file knowledge extraction for all discovered files (LLM per readable file)
  - directory knowledge extraction for all directories (LLM per directory)
  - context pack generation (LLM)
  - universal knowledge generation for all functions + modules (`src/LiBrainian/knowledge/generator.ts`)
- This is incompatible with realistic subscription quotas for medium/large repos **unless explicitly run in `--mode full`**.

### D2) Weak “resume” story (rework on restart)
- Without “skip if unchanged”, retries burn the same work again.
- This is especially fatal when a provider limit hits mid-phase.

### D3) Provider readiness checks were not “bootstrap-grade”
- “Provider authenticated” is not equivalent to “provider usable now”.
- Usage limit and rate limit need to be treated as **provider_unavailable** for bootstrap, with fast failure and remediation.

### D4) Model/preset mismatch footguns
- Codex accounts can reject certain models (`unverified_by_trace(provider_unavailable)` / 400 errors).
- Some reasoning presets are invalid for certain models (e.g., `minimal` rejected by `gpt-5-codex`).

### D5) Docs drift / broken pointers
- Some doc sets referenced `docs/LiBrainian/overview.md` (missing), breaking navigation.
- Fixed by adding `docs/LiBrainian/overview.md` as a compatibility entrypoint.

### D6) Status / observability drift (misleading operator view)
- `LiBrainian status` previously relied on in-memory bootstrap state, which resets per process and can misreport reality.
- Some “SLO-ish” metrics (e.g. cache hit rate) exist in code but are not meaningfully reported across runs unless recorded explicitly.

## Recovery Plan (Actionable, Evidence-Gated)

### P0 (Immediate unblock): Finish bootstrap once providers reset
- Run: `npm run LiBrainian -- bootstrap --scope LiBrainian --mode fast --llm-provider codex --llm-model gpt-5.1-codex-mini`
- Evidence gate: produces a successful `BootstrapReport` in `.LiBrainian` DB and `LiBrainian status` shows “not required”.
- Stop condition: if providers still limited, fail with `unverified_by_trace(provider_unavailable)` and do not claim readiness.
 - Status: completed (this repo, 2026-01-11)

### P1 (Make bootstrap resumable by default)
- Add checksum/hash-based “skip unchanged” to every LLM-heavy unit:
  - Universal knowledge records (function/module) should skip when stored `hash` matches.
  - File knowledge records should skip when stored `checksum` matches.
  - Directory knowledge should gain a stable fingerprint (e.g., hash of child file checksums) to enable skipping.
- Evidence gate: two consecutive bootstraps on same commit show near-zero LLM calls and near-identical DB deltas.
 - Status: mostly complete (universal/file skip; directory fingerprint; context packs skip unless invalidated/forced)

### P2 (Make provider gate bootstrap-grade)
- Add a strict/forced probe option used only by bootstrap to detect:
  - usage limits
  - rate limits
  - model incompatibilities
- Evidence gate: starting bootstrap while usage-limited fails within seconds with `unverified_by_trace(provider_unavailable)` and actionable remediation.
 - Status: complete (bootstrap preflight + bootstrap itself use forced probe)

### P3 (Reduce “LLM calls per entity”)
- Consolidate per-entity LLM extraction (semantics/security/rationale) into **one** prompt per entity where possible.
- Introduce an explicit “bootstrap budget” and cap:
  - number of entities per run (prioritize high-centrality / entrypoints / hot paths)
  - token budget per phase (already partially present via governor)
- Evidence gate: bootstrap on `--scope LiBrainian` completes under the `docs/LiBrainian/validation.md` latency SLO targets on a normal subscription.
 - Status: complete for MVP path (default `--mode fast` disables per-entity LLM enrichment; `--mode full` remains intentionally expensive)

### P4 (Fix doc navigation drift)
- Repair doc index references and add a short “Reality vs Docs” section in `docs/LiBrainian/STATUS.md` for any known mismatches.
- Evidence gate: every link in `docs/LiBrainian/README.md` resolves to an existing file.
 - Status: in progress (compat overview added; remaining doc link audits pending)

### P5 (Make status reporting truthy)
- `LiBrainian status` should surface “last successful run” from persistent storage (bootstrap history + metadata), not volatile process state.
- Evidence gate: `LiBrainian status` shows last bootstrap outcome and timestamps immediately after a new process starts.

## Ralph Wiggum Loop (8 Rounds)

Goal: iteratively sharpen the plan to be (a) more accurate to what’s actually failing, and (b) more effective at producing a working LiBrainian under real constraints.

### Round 1
- Ralph thought: “Just run bootstrap again. It’ll work this time.”
- Reality check: providers can be *authenticated but unusable* (usage limit).
- Plan change: add **P2 bootstrap-grade gate** and an explicit stop condition.

### Round 2
- Ralph thought: “If it fails, rerun it from scratch.”
- Reality check: reruns re-burn quota and time.
- Plan change: prioritize **P1 resumability** (skip unchanged) before anything else.

### Round 3
- Ralph thought: “Universal knowledge must cover every function immediately.”
- Reality check: unbounded coverage violates performance SLOs and provider realities.
- Plan change: add **P3 budgeted coverage** (prioritize and cap) with explicit gaps.

### Round 4
- Ralph thought: “Provider gate = login status.”
- Reality check: bootstrap needs “can execute model calls now”.
- Plan change: enforce “probe only for bootstrap” and treat usage/rate as provider_unavailable.

### Round 5
- Ralph thought: “A model string is a model string.”
- Reality check: some models/presets are rejected by the account or by the CLI’s API contract.
- Plan change: add “model/preset compatibility” checks and safe defaults (`gpt-5.1-codex-mini`).

### Round 6
- Ralph thought: “Docs are always right.”
- Reality check: broken doc pointers cause mis-implementation and wasted time.
- Plan change: add **P4 doc navigation repair** as a required deliverable.

### Round 7
- Ralph thought: “Performance will improve later.”
- Reality check: performance is correctness for an onboarder; slow/stale = wrong.
- Plan change: require concrete SLO measurement artifacts (bootstrap time, LLM call count, cache hit rate).

### Round 8 (Final tightening)
- Ralph thought: “If bootstrap completes once, we’re done.”
- Reality check: LiBrainian is a *system*; correctness is statistical + operational.
- Plan change: require (a) repeatability (two consecutive runs), (b) explicit `unverified_by_trace` on gaps, (c) Tier-0 gates still pass.

## Final Output of the Loop: The “Do This Next” Checklist

1. Wait until at least one provider is usable (not rate/usage limited).
2. Run `npm run LiBrainian -- bootstrap --scope LiBrainian --mode fast --llm-provider codex --llm-model gpt-5.1-codex-mini`.
3. Confirm `LiBrainian status` shows bootstrapped (fast/mvp) and `LiBrainian query "…" ` returns packs with evidence.
4. Add Tier-0 coverage for “skip unchanged” behavior and provider-gate strict mode.
5. Only then claim “working efficiently and effectively”, backed by an audit pack in `state/audits/`.
