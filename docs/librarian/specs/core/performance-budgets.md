# Performance Budgets (Targets)

> **Status**: Design (targets; requires measurement)
> **Created**: 2026-01-25
>
> **Purpose**: Define explicit performance/resource budgets so “behavior under load” is specified, observable, and testable (Tier‑2), instead of being implicit or guessed.
>
> **Shared vocabulary**: `docs/LiBrainian/specs/core/operational-profiles.md` (R*/W*/D*/S* + E1–E8).
>
> **Non-theater rule**: Budgets are *requirements*, but any claim that a budget is “met” must be backed by a runnable measurement hook (system test + audit artifact).

---

## 0) What budgets are for

Budgets exist to force the system to behave predictably in real use:
- **Interactive queries (W0)**: bounded time to first useful output, bounded total time, explicit partial-result disclosure when timeboxed.
- **Batch bootstrap (W1)**: bounded per-file work; “one file can’t block a phase”; predictable throughput targets.
- **Watch mode (W2)**: bounded “change → index reflects change” latency; stable under bursty change.
- **Multi-agent (W3)**: bounded lock contention; stable correlation IDs; no ambiguous interleaving.

Budgets are not only “speed”; they are also:
- memory pressure (token budgets, pack budgets)
- storage contention (S1) behavior
- provider outage/timeouts (D3/E7) behavior

---

## 1) Budget semantics (what must happen)

### 1.1 Timeboxing vs failing closed

- **Capability missing** (D1/D2/D3): fail closed with `unverified_by_trace(provider_unavailable|embedding_unavailable|llm_required)`; do not pretend to answer.
- **Time budget exceeded** (E7-like): return **partial results** *only if*:
  - the partial results are explicitly labeled as partial,
  - the missing stages are enumerated as gaps, and
  - the response includes `unverified_by_trace(timeout_budget_exceeded)` with stage-level timing evidence.

Rule: timeboxing must never convert “required semantic stage” into a silent keyword-only answer.

### 1.2 Stage visibility

Any user-facing query must expose:
- stage start/end timestamps or durations,
- which stages ran vs were skipped,
- why stages skipped (capability missing vs timebox vs empty inputs),
- a minimal adequacy/coverage disclosure.

---

## 2) Target budgets by workload + repo profile

These are initial targets for V1 behavior. Exact values may be revised, but the *presence* of explicit budgets and the *measurement hooks* are non-negotiable.

### 2.1 W0 (Interactive query) targets

Applies to: R1–R4 (primary), S0/S1, D0–D2.

- **Time to first useful output** (TTFU):
  - R1/R2: ≤ 2s
  - R3/R4: ≤ 5s
  - Definition: response must include a stage report + at least one concrete, source-linked lead (file/entity hint) OR a clarification question.
- **Time to full response (when providers available, D0)**:
  - R1/R2: ≤ 45s
  - R3/R4: ≤ 120s
- **Max packs returned** (unless explicitly requested deeper):
  - default ≤ 30 packs; must include a coverage assessment when capped.

### 2.2 W1 (Batch bootstrap / reindex) targets

Applies to: R1–R4, S0/S1, D0–D3 (phased).

- **Per-file timeout budget**:
  - any single file’s analysis stage must be bounded (default 30s) and must not block the phase.
- **Resumability**:
  - progress checkpoints must be written at least every N files (default 100) or every T minutes (default 5), whichever comes first.
- **Throughput targets** (S0, local embeddings):
  - R1: complete within 2 minutes
  - R2: complete within 15 minutes
  - R3: complete within 60 minutes (incremental allowed; must disclose partial coverage)

### 2.3 W2 (Watch) targets

Applies to: R1–R4, S0/S1.

- **Change reflection latency** (“save → query sees it”):
  - R1/R2: ≤ 3s
  - R3/R4: ≤ 10s (incremental; must avoid full reindex)
- **Burst stability**:
  - under a burst of 100 file changes, the system must not deadlock (S1) and must emit a single consolidated “index updated” event after debounce.

### 2.4 W3 (Multi-agent concurrency) targets

Applies to: R2–R4, S1.

- **Storage lock handling**:
  - bounded retries with backoff (no infinite loops), then fail closed with remediation guidance.
- **Correlation requirements**:
  - every concurrent run must have stable session/correlation IDs recorded in the evidence ledger.

---

## 3) Measurement hooks (how to prove budgets are met)

### 3.1 Required audit artifact (Tier‑2)

Add a Tier‑2 system test suite that:
- runs representative scenarios per profile (R1/R2/R3 at minimum),
- records stage durations and resource usage,
- writes `state/audits/LiBrainian/performance/PerformanceReport.v1.json`.

### 3.2 Gate integration

`docs/LiBrainian/GATES.json` must include a Tier‑2 “performance budgets” task once the suite exists.

Status rule:
- `pass|partial` requires `lastRun` + evidence summary (p50/p95/p99) and the report path.
- `requires_providers` is acceptable until the suite is wired.

---

## 4) Edge-case requirements (E1–E8)

- **E1 (empty input)**: treat as clarification flow; do not spin expensive stages.
- **E2 (oversized inputs)**: enforce token/file budgets; truncate with explicit disclosure.
- **E4 (partial corpora)**: surface coverage gaps; do not report completeness.
- **E6 (stale evidence)**: show recency and apply decay/defeaters where applicable.
- **E7 (provider outages/timeouts)**: fail closed for semantic claims; timebox only produces partial results with explicit unverified markers.
- **E8 (storage contention)**: bounded retries/backoff; never silently drop writes.

