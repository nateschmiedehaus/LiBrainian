# Work Objects (WorkGraph + Execution Artifacts)

Status: executable (core contract)
Created: 2026-01-25
Scope: the canonical “work object” model used to turn knowledge into *replayable work* without theater.

This is the *single* spec-system home for “what a work object is” and how it behaves. Other specs should link here rather than redefining competing shapes.

---

## Purpose (why this exists)

LiBrainian becomes the world’s best knowledge tool only if its outputs can be *used to do work* reliably:
- plans must compile into objects with explicit dependencies and acceptance criteria
- execution must emit durable artifacts (not ephemeral summaries)
- failures must be machine-classified (for retry, escalation, or honest stop)
- every “done” claim must be backed by runnable evidence and trace references

Work objects are the bridge between:
- **Perception (LiBrainian)**: evidence-backed packs, defeaters, uncertainty disclosures
- **Control (Agent / Orchestrator)**: decision-making, scheduling, verification
- **Actuation (Tools)**: edits, commands, CI, audits

---

## Canonical work object family (v1)

The canonical schemas live in code (single registry).

Target location (post extraction, required direction):
- `packages/LiBrainian/src/workgraph/artifacts.ts`

Current Wave0 host (temporary; extraction debt):
- `src/workgraph/artifacts.ts`

### Core objects

- `WorkGraphTaskV1` (the unit of work)
  - `task_id`, `title`, `intent`
  - `deps` (explicit DAG edges)
  - `lane` (priority lane; scheduling policy)
  - `execution` (what kind of executor is allowed; `none` is valid)
  - `definition_of_done` (what evidence is required to mark done)
  - `retry_policy` (bounded attempts; no infinite loops)

- `WorkGraphEventV1` (append-only event log)
  - event types include:
    - `task_created`
    - `task_status_changed`
    - `plan_mutation` (explicit, evidence-backed changes to plan)
    - `task_attempt_recorded`
    - `change_requested` (review/quality feedback recorded as an object)

- `WorkGraphHeadV1` (current head pointer + policy)
- `WorkGraphSnapshotV1` (replayed state: tasks/order/change_requests)

### Execution evidence objects

- `TaskExecutionReportV1` (what ran, what happened)
- `WorkGraphTaskContextV1` (durable, inspectable context pack for a task attempt)
- `WorkGraphMemoryIndexV1` (index over task attempts for later retrieval)

All of the above are **artifacts** with envelopes + digests; they are meant to be replayable and audit-friendly.

---

## Behavioral contract (what must happen)

Work objects must define behavior under real conditions using the shared profile vocabulary:
- `docs/LiBrainian/specs/core/operational-profiles.md`

### Determinism + replay (no theater)

- Any “state” view of work must be reconstructible by replaying the append-only event stream.
- Snapshots MUST be derivable from events; snapshots are optimization, not truth.
- Replays MUST be stable (digest-based) so regressions are detectable.

### Evidence obligations

- A task cannot transition to `done` unless its `definition_of_done` obligations are satisfied.
- “Provider-required” checks are Tier‑2 only (never sneak into Tier‑0).
- Any inability to meet obligations must become a machine-readable stop reason (not a silent downgrade).

### Plan mutation semantics

- Plans can change, but only via explicit `plan_mutation` events:
  - who changed it (actor role)
  - why (reason code)
  - what evidence justified it (evidence refs)
- Mutations are part of the work record and must be replayed like any other event.

### Provider outages / missing capabilities

- If a task’s DoD requires provider-backed verification and providers are unavailable:
  - it must not be marked done
  - the run must surface an explicit `unverified_by_trace(provider_unavailable)`-class outcome
  - the system may emit follow-up tasks (e.g., “run Tier‑2 validation when providers return”)

### Contention and concurrency (multi-agent)

Under W3/S1/E8 conditions:
- event append must be bounded and retryable (or fail closed explicitly)
- no silent drops: if an event cannot be recorded, the run must stop and disclose
- two concurrent controllers must not corrupt the chain (digest + prev pointer + policy)

---

## TDD / verification hooks (required)

Tier‑0 deterministic invariants (replay and policy):
- `src/workgraph/__tests__/workgraph_runner.test.ts`
- `src/workgraph/__tests__/workgraph_replay_pack.test.ts`
- `src/workgraph/__tests__/workgraph_policy.test.ts`
- `src/workgraph/__tests__/workgraph_containment.test.ts`

Tiering rule reminder:
- anything provider-required belongs in `*.system.test.ts` (Tier‑2), and must fail honestly if providers are unavailable

---

## Integration points (LiBrainian ↔ work objects)

Work objects are how the agent consumes LiBrainian without “memory theater”:
- tasks reference intents and expected evidence types
- `WorkGraphTaskContextV1` must preserve *inspectable* evidence pointers (paths, snippet refs, trace refs), not just narrative summaries

Until full convergence is complete:
- numeric “confidence” values that exist in task context summaries are *ranking signals*, not epistemic claim confidence; epistemic confidence converges to `ConfidenceValue` elsewhere in LiBrainian (Track D).
