# Super-Brain Implementation Protocol (Codex 5.2 Friendly)

Status: planned
Scope: an exact, stepwise implementation protocol for `SUPER_BRAIN_PLAN.md` that is safe under real constraints and aligned with LiBrainian canon.
Last Verified: 2026-01-19
Owner: librarianship
Evidence: design only (no implementation claims)

This protocol is designed for agents (Codex 5.x class) and humans implementing
LiBrainian changes in small, verifiable slices.

## Hard Constraints (Read First)

1) **No fake embeddings / no provider bypass**
   - If providers are unavailable: fail closed with `unverified_by_trace(provider_unavailable)`.
   - Do not introduce deterministic or hash-based embeddings anywhere.

2) **Semantic claims require evidence**
   - If you cannot attach evidence/trace, return `unverified_by_trace(...)` and emit a VerificationPlan.

3) **No parallel systems**
   - Extend existing surfaces: query pipeline, storage, event bus, skills framework, MF method packs.
   - Avoid introducing a second “method system” or “watch system”.

4) **Do not trust LiBrainian’s self-knowledge unless index provenance is current**
   - “LiBrainian analyzing LiBrainian” is unsafe if the index is stale.
   - Always check index provenance first (see Protocol Step 0).

## Protocol Step 0 — Establish Truth (Before Any Code)

Goal: confirm what is true *right now*, so you don’t implement based on drift.

1) Confirm canon and prohibitions:
   - `docs/AGENTS.md`
   - `src/EMBEDDING_RULES.md`
   - `docs/LIVE_PROVIDERS_PLAYBOOK.md`
   - `docs/LiBrainian/VISION.md`

2) Confirm baseline gates:
   - Run Tier-0 gate and note existing failures; do not “fix unrelated”.
   - If provider audits are required for a change, schedule a Tier-2 run.

3) Confirm LiBrainian index provenance:
   - Determine what commit/time the index represents vs workspace HEAD.
   - If stale: treat any self-analysis output as `unverified_by_trace(self_drift_detected)`.

Deliverable:
- A short “Evidence Pack” note containing: HEAD SHA, last indexed SHA/time, provider readiness summary, watch status (if any).

## Implementation Order (PR-Sized, Non-Theatrical)

The “super brain minimum” is:
1) AutoWatch truth + catch-up,
2) VerificationPlan,
3) Episode recording,
4) Claim unification glue.

Everything else is downstream.

## PR-1 — AutoWatch Becomes Truthful (Cursor + Catch-Up + Telemetry)

### Outcome Definition (What “Done” Means)

AutoWatch is “done” when:
- silent failure is detectable (heartbeat),
- catch-up is guaranteed (cursor + sweep),
- and status reports observed behavior, not config flags.

### Implementation Targets (Concrete)

Add a single persisted watch state record:
- Storage key: `LiBrainian.watch_state.v1`
- Shape (minimum):
  - `schema_version`
  - `workspace_root` (canonical)
  - `watch_started_at`
  - `watch_last_heartbeat_at`
  - `watch_last_event_at`
  - `watch_last_reindex_ok_at`
  - `suspected_dead` (boolean)
  - `effective_config` (debounce/batch/cascade + excludes)
  - `cursor`:
    - `kind: 'git'|'fs'`
    - if git: `last_indexed_commit_sha`
    - if fs: `last_reconcile_completed_at`

Make the watch state truthy:
- Heartbeat must update even when no file events occur.
- `watch_status()` must read from storage + include “in-process” indicators (if present).

### Catch-Up Algorithm (Exact)

On watch start, watch restart, and on “heartbeat gap” detection:
1) Determine cursor type:
   - If workspace is a git repo and HEAD is available → git cursor.
   - Else → fs cursor.
2) Compute changed paths:
   - git cursor: `git diff --name-status <lastSha>..HEAD`
   - fs cursor: scan included files; compare `(mtime,size)` first, checksum second.
3) Compute:
   - new files → index
   - deleted files → cleanup
   - changed files → reindex (bounded batches)
4) Update cursor only after successful processing.
5) If provider unavailable:
   - do not claim catch-up; mark staleness defeaters and surface `needs_catchup=true`.

### Backpressure and Storm Handling (Exact)

Introduce a “changeset queue”:
- Coalesce file events within `batchWindowMs`.
- If changeset size exceeds `stormThreshold`:
  - switch to “bounded sweep” mode (treat as catch-up),
  - and stop per-file reindex until the sweep completes or is blocked.

### Critical Edge Cases (Must Handle)
- Multiple LiBrainian instances in one process (watcher instance coupling).
- `fs.watch` portability (no events / errors on some platforms).
- Atomic rename saves (rename storms).
- Lock conflicts (`lease_conflict`) → requeue with backoff, do not drop silently.
- Watch excludes must include internal directories (`.LiBrainian/**`) by default.

### Files You Will Almost Certainly Touch
- `src/LiBrainian/integration/file_watcher.ts` (watch manager behavior)
- `src/LiBrainian/state/index_state.ts` (extend or parallel watch state)
- `src/LiBrainian/api/LiBrainian.ts` (add `watchStatus()` and/or `getSystemContract()`)
- `src/LiBrainian/mcp/server.ts` and/or CLI watch commands (ensure config plumbed)

### Tier-0 Tests (Minimum)
- Watcher persists heartbeat + status in storage.
- Catch-up “git diff” path produces correct reindex list (mock git runner).
- Lease conflict is retried and eventually succeeds (queue/backoff behavior).
- Storm threshold triggers sweep mode (bounded).

Stop conditions:
- If correctness requires a new watcher backend (e.g., chokidar) and it introduces
  platform risk, stop with `unverified_by_trace(watch_backend_unproven)` and add a
  validated fallback sweep first.

## PR-2 — VerificationPlan Primitive (Proof Obligations)

### Outcome Definition

Every semantic answer can produce a structured proof obligation:
- “how to verify this claim in this repo”, including commands and expected signals.

### Implementation Targets (Concrete)

Add a new artifact in storage:
- `LiBrainian.verification_plans.v1` (state key or table)
- `VerificationPlan` includes:
  - target (claim/work/entity)
  - methods (command/test/manual check)
  - expected observations
  - cost + risk notes
  - required artifacts path(s)

Integrate into query rendering:
- If response confidence is below threshold OR defeaters active OR claim is semantic:
  attach a VerificationPlan template rather than free-text “next steps”.

Tier-0 tests:
- Plans are structurally valid, deterministic, and redact-sensitive.

## PR-3 — Episode Recording (Trajectory Memory)

### Outcome Definition

LiBrainian can store “what happened” so confidence becomes empirical:
- inputs (intent/scope)
- evidence used (packs)
- actions taken (patches/commands)
- results (exit codes, test outputs)
- outcome label

### Implementation Targets (Concrete)

Persist:
- `LiBrainian.episodes.v1` (state key or table; start with additive state key)
Ensure:
- redaction by default (no secrets)
- provenance (timestamps, tool versions)

Tier-0 tests:
- episode schema validation + redaction behavior.

## PR-4 — Claim Substrate Unification (Bridge Knowledge → Epistemics)

### Outcome Definition

At least one real semantic output path stores:
- `Claim` nodes,
- evidence edges,
- defeaters,
in the epistemics engine, and query responses can reference claim IDs.

### Implementation Targets (Concrete)

Start with one narrow integration:
- Example: method pack generation OR a small subset of knowledge synthesis.
Store:
- claim propositions + evidence + model provenance (prompt digest).
Expose:
- `get_claim_graph` / `verify_claim` surfaces (internal first; MCP later).

Tier-0 tests:
- claim creation and linking is deterministic
- contradictions remain visible

Stop conditions:
- If you can’t define “what is a claim” without duplicating existing primitives,
  stop and write an explicit mapping spec.

## PR-5 — Technique Library v1 (Small, Real, Measured)

### Outcome Definition

A small set (30–60) of TechniquePrimitives exist and are usable because:
- each compiles to a WorkHierarchy,
- each includes at least one VerificationPlan template,
- each declares failure modes and stop conditions.

### Critical Guardrail

Do not ship a prose library. If a technique cannot compile into work with
verification, it does not exist yet.

## PR-6 — Repo Rehabilitation Compiler v1

Outcome:
- Diagnose → plan → checkpoints → staged uplift.

Must be validated against intentionally broken repos (fixtures) where:
- build fails,
- tests missing,
- docs misleading,
- code is tangled.

## PR-7 — Extreme Scale Mode (Progressive Indexing)

Outcome:
- bootstrap reaches “truthful usable” quickly,
- enrichment is queued and budgeted,
- queries surface coverage gaps with explicit next actions.

## Integration Notes (Make It Codex-Friendly)

### Coding Style
- Prefer small, typed modules over giant refactors.
- Wire through existing primitives and storage interfaces.
- Avoid global mutable state except for explicitly managed workspace-level services.

### Agent Workflow
For each PR:
1) Write or update the relevant doc section (what changed, what is verified).
2) Add Tier-0 tests for deterministic behavior.
3) Run Tier-0 gate.
4) Only then run Tier-2 audits if required (live providers).

### When To Stop
If any step would require “pretend success” (e.g., watcher status without heartbeat,
semantic outputs without evidence), stop and return:
`unverified_by_trace(implementation_blocked)` with the missing prerequisite.

