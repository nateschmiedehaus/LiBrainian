# Implementation Failure RCA (Spec System) + Non-Repeatable Mechanics

> **Status**: Canonical for “why we failed before” + “mechanics to prevent recurrence”
> **Last Updated**: 2026-01-25
>
> **Scope**: This document is about *implementation failure modes* when implementing the LiBrainian spec system (not product/user failures in downstream agent runs).

---

## Executive Summary

Previous attempts to “implement the spec system” failed primarily due to:

1. **Drift**: docs/specs, code, and gates diverged (tools claimed but unreachable; auth guidance wrong; confidence semantics mismatched).
2. **Theater**: “green” indicators without real observation (fake embeddings; non-skipping tests; string-count gates; “partial/pass” without evidence).
3. **Non-executable core**: large bodies of spec/typework without end-to-end execution + replayable traces (a.k.a. “documentation theater”).

This repo now enforces several *mechanical* anti-repeat guardrails (tests + gates). Remaining gaps are explicitly listed in `docs/LiBrainian/specs/INTEGRATION_CHANGE_LIST.md`.

---

## Evidence Sources Used For This RCA (Repo-Local)

- “Documentation theater” warning and execution-first prescription: `docs/LiBrainian/THEORETICAL_CRITIQUE.md`
- Failure mode register (FM‑01…FM‑38): `docs/LiBrainian/WORKPLAN.md`
- Reality ledger of what is verified vs unverified: `docs/LiBrainian/STATUS.md`
- Wave0 integration assessment of concrete breakages: `docs/LIBRARIAN_WAVE0_FULL_INTEGRATION_ASSESSMENT.md`
- Implementation drift tracking: `docs/LiBrainian/specs/IMPLEMENTATION_STATUS.md`

---

## Root Causes (What Actually Broke) + Mechanistic Fixes

### RC‑1: Tool surface drift (declared ≠ callable)

**Observed failure**
- MCP server exposed tools in `getAvailableTools()` but schema validation rejected some tool names, making them unreachable through the actual MCP `callTool` path.
- Tests masked this by calling internal methods directly (bypassing the public tool entrypoint).

**Why it happened**
- Tools were defined in multiple places (server tool list, schema registry, type guards, tests) with no “single registry” or consistency gate.

**Mechanics added (prevents recurrence)**
- Schema registry now includes the tools that the server advertises (example: `status`, `system_contract`, `diagnose_self`).
- Tier‑0 tests now enforce registry consistency and exercise the real `callTool` path:
  - `packages/LiBrainian/src/mcp/__tests__/tool_registry_consistency.test.ts`
  - `packages/LiBrainian/src/mcp/__tests__/system_contract.test.ts`
  - `packages/LiBrainian/src/mcp/__tests__/diagnose_self.test.ts`

**Non-repeat rule**
- No test may claim MCP tool coverage unless it traverses `callTool()` (schema + auth + execution).

---

### RC‑2: “Gate theater” (green without evidence)

**Observed failure**
- Gates that “pass” based on string-count heuristics or that mark “partial/pass” with no run metadata are indistinguishable from theater.
- This produces false confidence and actively blocks root-cause isolation.

**Why it happened**
- Gates were treated as documentation, not as executable contracts.

**Mechanics added (prevents recurrence)**
- Tier‑0 guardrail test enforces anti-theater invariants on `docs/LiBrainian/GATES.json`:
  - forbids `rg … | wc -l` subshell gates
  - requires `lastRun` + `evidence` for `pass`/`partial`/`skip_when_unavailable`
  - `src/LiBrainian/__tests__/librarian_gate_theater.test.ts`

**Non-repeat rule**
- Any gate with status `pass|partial|skip_when_unavailable` MUST have `lastRun` and a human-readable evidence string.

---

### RC‑3: Provider/auth drift (wrong commands, hanging probes, env-key fallbacks)

**Observed failure**
- “Auth check” guidance and probes drifted away from real CLI behavior (including commands that hang).
- Some flows attempted API-key/env fallback, violating “CLI auth only”.

**Mechanics already in place**
- Provider readiness is routed through the provider gate and CLI probes only; env/API-key discovery is forbidden and will fail with `unverified_by_trace(env_auth_forbidden)`.
- Tiered testing rules prevent simulated provider success.

**Remaining hard requirement**
- Provider checks must be reachable only through `checkAllProviders()` / `requireProviders()` with explicit failure disclosure.

---

### RC‑4: Confidence category error (ranking scores treated as epistemic confidence)

**Observed failure**
- Numeric “confidence” values were used across surfaces where the spec requires epistemically honest `ConfidenceValue`.

**Why it happened**
- Lack of an explicit “claim boundary” contract and migration plan caused semantic drift.

**Mechanics in progress**
- Track D is scoped to claim boundaries; raw numeric scores remain allowed for ranking/heuristics but MUST NOT masquerade as calibrated confidence.
- `docs/LiBrainian/GATES.json` keeps Q4–Q7 “not implemented” until migration is real.

---

### RC‑5: Non-executable primitives / missing traces (plans without executions)

**Observed failure**
- “Planner theater”: plans/compositions existed without verified execution, replay, and evidence linkage.

**Mechanics direction (next required slice)**
- Unify query, execution, and provider events into the evidence ledger with stable session IDs.
- Require at least one end-to-end “run → trace → replay” gate before marking execution-related tracks verified.

See: `docs/LiBrainian/specs/INTEGRATION_CHANGE_LIST.md`.

---

### RC‑6: Tier confusion + “skip theater” in tests (passed without observation)

**Observed failure**
- Provider-required tests lived in plain `*.test.ts` and “skipped” by `return`ing early, which Vitest reports as **pass**.
- Mixed-tier files hid provider requirements behind local env logic, producing green runs that did not validate semantic behavior.

**Why it happened**
- Tiering was treated as “naming convention” instead of an enforced contract.

**Mechanics added (prevents recurrence)**
- Provider-required suites were moved to explicit system-tier files (example: `mvp_librarian.system.test.ts`, `embedding_use_cases.system.test.ts`).
- Live-provider suites were separated out of deterministic suites (example: `librarian_live.system.test.ts`).
- Tier‑0 guardrail test now fails if `checkAllProviders`/`requireProviders` appear in plain `*.test.ts`:
  - `packages/LiBrainian/src/__tests__/test_tiering_guard.test.ts`

**Non-repeat rule**
- If a test calls providers (directly or via provider gate), it MUST be `*.integration.test.ts` (skip) or `*.system.test.ts` (require).
- Never “skip” by returning from a test; use `ctx.skip(...)` (Tier‑1) or fail fast (Tier‑2).

---

### RC‑7: “Interface-only specs” (behavior missing under real conditions)

**Observed failure**
- Specs defined interfaces/types and “happy path” narratives, but did not consistently specify:
  - behavior under outages (providers/storage)
  - behavior under load (batch/watch/multi-agent)
  - behavior under repo shape (monorepo, polyglot, multi-repo)
  - edge cases (empty input, partial corpora, stale evidence, contradictions)
- Implementations drifted because “what should happen” was not mechanically checkable, and implementers filled gaps with ad-hoc defaults.

**Why it happened**
- No canonical, shared scenario vocabulary.
- No completeness gate ensuring every spec had an explicit behavioral contract.

**Mechanics added (prevents recurrence)**
- Canonical profile vocabulary: `docs/LiBrainian/specs/core/operational-profiles.md`
- Canonical per-spec behavioral contracts: `docs/LiBrainian/specs/BEHAVIOR_INDEX.md`
- Tier‑0 enforcement: `src/LiBrainian/__tests__/librarian_spec_behavior_index.test.ts`
  - fails if any spec file is missing its behavior entry
  - fails if any `executable` entry lacks a runnable verification hook

**Non-repeat rule**
- No spec is considered `executable` unless its behavior is specified under real conditions and linked to runnable verification.

---

### RC‑8: Extraction procrastination (the “we’ll split later” trap)

**Observed failure**
- Implementations accumulated inside Wave0 while LiBrainian remained entangled with Wave0 internals.
- Agents optimized for “ship an essential feature” rather than “stabilize the boundary”, so extraction never completed.
- The spec describes a standalone knowledge tool, but reality drifted into a monolith where public/package surfaces were optional.

**Why it happened**
- Extraction was framed as “Layer 5 / after verification”, so it was always downstream of “more urgent” work.
- No stop-the-line rule prevented building new feature logic on the wrong side of the boundary.

**Mechanics required (prevents recurrence)**
- Treat full package extraction as **Priority 0** (stop-the-line) in the spec system:
  - `docs/LiBrainian/specs/INTEGRATION_CHANGE_LIST.md` (Priority 0 section)
- Make extraction gates explicit and non-optional:
  - `docs/LiBrainian/GATES.json` (`layer1.*`)
- Enforce a single boundary rule in practice:
  - Wave0 must consume LiBrainian via the package public API; `src/LiBrainian/**` is compatibility shim only.

**Non-repeat rule**
- If extraction gates are not green, do not implement “LiBrainian essentials” inside Wave0. Implement them in the LiBrainian package or stop with an explicit boundary-blocking reason.

## Implementation Protocol (So We Can’t Fail Again)

### 1) One registry, one entrypoint, one gate

For any “surface” (MCP tools, provider gate, query pipeline):
- define once (registry)
- route calls through the single entrypoint
- add a deterministic test that fails if drift occurs

### 2) Tier discipline (no simulated success)

- Tier‑0: deterministic logic only; mocks may fail fast and may stub adapters for wiring-only assertions, but must not claim semantic correctness.
- Tier‑1: uses real providers or `ctx.skip(...)` honestly.
- Tier‑2: requires live providers; fails fast with `unverified_by_trace(provider_unavailable)`.

### 3) “No theater” acceptance criteria

Every new spec requirement must map to at least one of:
- a Tier‑0 test, or
- a new gate task with a runnable command, or
- a new audit artifact path with a runnable generator command

If not, the requirement remains *non-executable intent* and must be labeled as such.

---

## Next High-Leverage Non-Repeat Work (Queued)

1. Query pipeline → evidence ledger wiring (stage start/end + retrieval + synthesis evidence).
2. Technique execution → evidence ledger wiring (operator events + outputs + coverage gaps).
3. Add a “ledger correlation id” contract so all subsystems can be replayed/debugged.
