# Operational Profiles (Repos, Loads, Modes)

> **Status**: Canonical
> **Created**: 2026-01-25
>
> **Purpose**: Provide shared, concrete “how it behaves in the real world” profiles so every spec can describe behavior without re‑inventing scenario taxonomies.
>
> **Non-theater rule**: If a spec claims it supports a profile, it must name at least one verification hook (Tier‑0 test, Tier‑1 skip test, Tier‑2 system test, gate task, or audit artifact) that would catch regressions for that profile.

---

## 0) Dimension Vocabulary

Every behavior statement should specify **at least**:
- **Repo profile** (size + shape)
- **Workload profile** (interactive vs batch vs continuous)
- **Dependency profile** (providers/storage availability)
- **Degradation policy** (fail-closed vs skip vs degraded-mode-with-disclosure)
- **Budget behavior** (what is timeboxed vs fail-closed; see `docs/LiBrainian/specs/core/performance-budgets.md`)

---

## 1) Repo Profiles

### R0: Empty / Docs-only
- No source code or only `README.md`/docs.
- Expected: indexing should not crash; outputs must disclose `unverified_by_trace(no_code_corpus)` for code questions.

### R1: Small Single-Repo
- ~1–20k LOC, single language (often TS/JS).
- Expected: bootstrap finishes without manual tuning; interactive queries are responsive; watch mode is stable.

### R2: Medium Polyglot Repo
- ~20k–300k LOC; 2–5 languages; mixed build systems; tests present.
- Expected: language gaps must be surfaced as explicit coverage gaps; no “silent green” answers.

### R3: Large Monorepo
- ~300k–3M LOC; multiple packages; heavy dependency graphs.
- Expected: indexing must be incremental and budgeted; query must avoid scanning the whole repo; results must include adequacy/coverage reports.

### R4: Multi-Repo Workspace
- 2+ repos; cross-repo dependencies; shared libraries.
- Expected: cross-repo correlation must be explicitly labeled; stale/unknown cross-repo edges must become defeaters/coverage gaps.

---

## 2) Workload Profiles

### W0: Interactive Query
- One query at a time; user expects fast turnaround.
- Expected: stage-aware reporting; partial results allowed only with explicit disclosure; no hanging probes.

### W1: Batch Bootstrap / Reindex
- Large ingest jobs; throughput matters more than latency.
- Expected: bounded concurrency; resumable progress; “one file can’t block the phase”.

### W2: Continuous Watch
- Ongoing file changes; incremental updates.
- Expected: debounced updates; lock-safe storage operations; drift detection.

### W3: Multi-Agent Concurrency
- Multiple agents/threads issuing queries and indexing.
- Expected: stable correlation IDs; evidence ledger doesn’t interleave ambiguously; storage locking is handled explicitly.

---

## 3) Dependency Profiles (Providers / Storage)

**Higher‑order cognition (LLM‑required)** = any semantic synthesis/claims, reasoning, critique, decision support, or narrative explanation. Structural outputs (AST facts, counts, dependency lists, pack inventories) are non‑semantic and may run without LLMs **only with explicit disclosure**.

### D0: Providers Available (LLM + Embeddings)
- Expected: semantic behaviors are allowed; Tier‑2 validations are meaningful.

### D1: LLM Available, Embeddings Unavailable
- Expected: semantic retrieval is blocked or explicitly degraded with disclosure (`unverified_by_trace(embedding_unavailable)`).

### D2: Embeddings Available, LLM Unavailable
- Expected:
  - **Retrieval-only / deterministic behaviors can run** (maps, packs, adequacy reporting, navigation over indexed corpus).
  - **Any semantic synthesis or semantic claim** MUST fail closed with explicit disclosure (`unverified_by_trace(llm_required)`).
  - Outputs MUST avoid “understanding theater”: return evidence-backed structure + a verification plan, not a narrative answer.

### D3: Providers Unavailable
- Expected: anything requiring cognition fails closed with `unverified_by_trace(provider_unavailable)` (or Tier‑1 skips).

### S0: Storage Healthy
- Expected: evidence + index persistence is durable.

### S1: Storage Locked / Busy
- Expected: bounded retries/backoff OR explicit failure disclosure (never silent drop).

### S2: Storage Corrupt / Disk Full
- Expected: fail closed; produce remediation guidance; do not “continue” with pretend state.

---

## 4) Edge-Case Taxonomy (Used Everywhere)

Every spec that touches user-visible outputs should define behavior for:
- **E1: Empty input** (empty intent/query)
- **E2: Oversized input** (very large files, giant prompts)
- **E3: Binary/unreadable files**
- **E4: Partial corpora** (excluded globs, missing languages)
- **E5: Conflicting evidence** (contradictions)
- **E6: Stale evidence** (recency decay + invalidation)
- **E7: Provider outages/timeouts**
- **E8: Storage contention**
