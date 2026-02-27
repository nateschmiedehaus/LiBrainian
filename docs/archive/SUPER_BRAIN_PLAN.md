# LiBrainian Super-Brain Plan (World-Class Agent Memory + Epistemics + Process Engine)

Status: in progress (partial implementation)
Scope: a concrete, evidence-gated roadmap to evolve LiBrainian into a “super brain” for coding agents under adversarial repo conditions and extreme scale.
Last Verified: 2026-01-19
Owner: librarianship
Evidence: design only (no implementation claims)

## Positioning (Important)

This document is **not** a replacement for `docs/LiBrainian/WORKPLAN.md`. It is an
extension roadmap for “Phase 6+” capabilities: cross-domain problem solving,
epistemic rigor as a first-class runtime, and scalable memory/process support
for agents operating with minimal instruction in messy or massive codebases.

Implementation protocol:
- `docs/LiBrainian/SUPER_BRAIN_IMPLEMENTATION_PROTOCOL.md`

Non-negotiables from canon still apply:
- Evidence-first knowledge, explicit confidence, explicit defeaters (`docs/LiBrainian/VISION.md`).
- No fake embeddings, no provider bypass; fail closed on provider unavailability.
- One unified ingest + query pipeline (`docs/LiBrainian/SYSTEM_ARCHITECTURE.md`).

## First Principle: AutoWatch Catch-Up Truth (Read Before Anything Else)

AutoWatch failure is the fastest path to confident wrongness. This plan assumes:
- A persistent watch cursor (git or filesystem) and reconciliation sweep are mandatory.
- A heartbeat must be persisted even with zero file events.
- Any heartbeat gap triggers `needs_catchup` and explicit staleness defeaters.
- If watch goes silent and later resumes, it MUST compute what changed since the cursor and reindex before claiming freshness.

Details and edge cases are in "AutoWatch: Suspected Problems + Failure Modes" below.

## Implementation Updates (Rolling)

2026-01-19:
- AutoWatch: CLI watch attaches storage; CLI status surfaces persistent watch state; MCP status exposes persistent watch state.
- AutoWatch: reconciliation uses git cursor diff/status when available, falls back to fs sweep; cursor persists last indexed git SHA.
- AutoWatch: incremental reindex updates the git cursor; CLI status now prints watch effective config.
- AutoWatch: watch health derivation (heartbeat/event/reindex ages + suspected dead) exposed via API/CLI/MCP.
- AutoWatch: batch window coalesces changes; storm threshold marks catch-up and records `watch_event_storm`.
- AutoWatch: CLI watch defaults a model ID when env config is missing; file watcher stop is idempotent to avoid double-stop errors.
- System contract: added a typed system contract builder and LiBrainian API surface.
- System contract: MCP tool now exposes the contract for agent consumption.
- System contract: CLI command `LiBrainian contract` added for local access.
- Self-diagnosis: added a drift detector (watch health/cursor vs HEAD) for safe self-knowledge.
- Self-diagnosis: MCP tool now exposes the diagnosis for agent use.
- Self-diagnosis: CLI command `LiBrainian diagnose` added for local access.
- VerificationPlan: added a primitive type and creator for proof obligations.
- VerificationPlan: query responses attach and persist verification plans for follow-up validation.
- Technique primitives: added typed TechniquePrimitive/Composition builders for method atoms.
- Technique primitives: seeded a baseline primitive library and exposed list tooling via MCP.
- Technique primitives: expanded seeded library to 52 primitives across planning, assurance, quality, and coordination coverage.
- Technique compositions: added state storage + seeded compositions (agentic review, root cause recovery, release readiness, rehab triage, performance reliability) and MCP list tool.
- Technique compositions: added validation helper to surface missing primitives in composition definitions.
- Plan compiler: added keyword-based technique composition selection to seed `select_methods` behavior.
- MCP: added select technique compositions tool for intent-based recipe selection.
- Plan compiler: added storage-backed composition selection that seeds defaults before selection.
- MCP: selection tool now seeds default compositions before applying intent filters.
- API: exported plan compiler composition selection helpers for direct client use.
- API: added LiBrainian-level composition selection backed by storage seeding.
- Plan compiler: added composition-to-work template compilation helper (exported via API).
- Plan compiler: added storage-backed template compilation helper for seeded compositions.
- MCP: added compile technique composition tool to emit work templates for agentic recipes.
- Plan compiler: added gap-aware template compilation helpers to surface missing primitives.
- MCP: compile technique composition now returns missing primitive IDs when applicable.
- MCP: compile technique composition can include primitive definitions on request.
- API: added LiBrainian bundle compilation for composition templates + primitives.
- Plan compiler: added intent-to-bundle compilation helper for composition workflows.
- API: added LiBrainian intent-to-bundle compilation for composition workflows.
- MCP: added compile intent bundles tool for end-to-end recipe compilation.
- MCP: compile intent bundles supports limit for bounded recipes.
- MCP: compile intent bundles can omit primitive payloads for lightweight responses.
- MCP: compile intent bundles now report total and limited counts.
- API: compile intent bundles can omit primitive payloads for lightweight responses.
- Plan compiler: work templates now include per-primitive acceptance criteria.
- CLI: added compose command to compile intent bundles with optional primitives.
- CLI: compose validates limit inputs via tests.
- Technique compositions: expanded defaults with security review, UX discovery, and scaling readiness recipes.
- Plan compiler: added intent selectors for security, UX, and scaling compositions.
- API: added LiBrainian method to compile technique compositions with missing primitive gaps.
- Plan compiler: added verification plan prototypes for agentic review, root cause, and release readiness.
- Technique compositions: added dynamic operators and relationships (sequence, gates, loops) for graph-aware plans.
- Technique operators: expanded with timebox, budgets, throttles, quorum/consensus, circuit breakers, monitor, persist/replay/cache, reduce.
- Technique relationships: expanded with evidence/causal/context links plus equivalence/alternatives.
- Plan compiler: operators now compile into deterministic WorkHierarchy nodes with verification-gate checkpoints.
- Plan compiler: relationships now compile into deterministic dependency edges on work items.
- Plan compiler: added `selectMethods` alias plus `planWork` compilation to WorkHierarchy + VerificationPlans.
- API: LiBrainian now exposes `planWork` for intent-to-WorkHierarchy planning.
- Agentic review: compiled plan helper (`scripts/agentic_review_plan.ts`) feeds review reports with WorkHierarchy output.
- Agentic review: review output root is configurable (`LIBRARIAN_AGENTIC_REVIEW_OUT_DIR`) and non-TTY defaults fix mode to report.
- Agentic review hooks: hook installer now honors fix-mode/out-dir env and avoids auto-fix by default.
- Episode memory: added an Episode builder for trajectory records.
- Episode memory: state storage helpers for recording/listing episodes.
- Episode memory: queries now record discovery episodes with outcomes.
- Memory APIs: LiBrainian exposes verification plan + episode helpers.
- VerificationPlan: state storage helpers for saving/listing plans.
- MCP: added list tools for verification plans and episodes with unit tests.
- Tests: added unit coverage for watch session startup, watch status reporting, git change parsing, git-cursor reconcile, cursor updates, and watch health derivation.
- Plan doc: elevated AutoWatch catch-up as the top priority and expanded edge cases.
- Plan doc: added a Codex 5.2-friendly implementation protocol summary.
- Plan doc: expanded the universal method library into a primitive catalog.

## Compatibility With the Epistemic Contract (No “MVP Theater”)

This plan uses terms like “usable-first bootstrap” and “progressive enrichment”.
These are **operational scheduling strategies**, not epistemic shortcuts:
- “Usable-first” means: retrieval and structural truth are available quickly, while
  semantic/enrichment coverage is explicitly incomplete and represented as gaps/defeaters.
- At no point should LiBrainian claim semantic understanding without LLM-backed evidence
  (or explicit `unverified_by_trace(...)` plus a VerificationPlan).

The goal is faster convergence to a truthful, useful state, not degraded claims.

## North Star

LiBrainian becomes an agent’s:
- **Perception system** for the codebase (structure, semantics, history, risks).
- **Epistemic engine** that turns “beliefs” into defeasible, provable claims.
- **Process compiler** that turns goals/questions into verifiable work structures.
- **Second brain** that stores and retrieves *trajectories*, not just snippets.

The standard is: agents can deliver world-class results even when:
- The repo is poorly structured, undocumented, or actively misleading.
- The repo is enormous (multi-repo federation; monorepos; 10M LOC scale).
- The agent receives minimal instruction beyond “deliver X”.

## Core Thesis: “Answers” Are Not the Product

The product is a closed-loop system:
1) **Retrieve** evidence
2) **Form claims** (explicit propositions)
3) **Attach proof obligations** (verification plans)
4) **Execute validations** (when possible)
5) **Update confidence** and activate **defeaters**
6) **Generate work structures** (plans, checkpoints, experiments)
7) **Persist trajectory memory** for reuse and calibration

The target output is not “an answer”, but:
- an answer *plus* evidence traces,
- a calibrated confidence decomposition,
- active defeaters (if any),
- and next actions that are *verifiable*.

## Priorities and Optionality (Keep the Plan Necessary)

Not everything in this document is equally necessary. To keep execution
focused, treat these as tiers:

### Non-Optional Core (Super-Brain Minimum)
- **Truthful freshness**: watch health telemetry + catch-up sweep (AW-1).
- **Proof obligations**: `VerificationPlan` as a first-class output primitive.
- **Outcome memory**: `Episode` recording to ground calibration and reuse.
- **Unified epistemics**: semantic outputs expressed as claims with evidence/defeaters.

### High-Leverage Extensions (After Core)
- Technique library v1 (small but real) that compiles into work structures.
- Repo rehabilitation compiler (diagnose → plan → checkpoints) for hostile repos.
- Extreme-scale progressive indexing and enrichment queues.

### Optional / Only If Proven Useful
- A text DSL. Start with an IR; only add syntax if it reduces friction measurably.
- Broad “general creativity” expansions beyond what improves real software outcomes.

## Meta-Knowledge Required to Improve LiBrainian (What Agents Must Know)

To reliably improve LiBrainian (or use LiBrainian to improve any other repo) under
any load/constraint, agents need first-class, queryable knowledge about:

### K1) The “Reality Contract” (What Is Allowed To Be Claimed)
- Which operations require live providers and must fail closed.
- Which outputs are structural/objective vs semantic (LLM-required).
- The exact semantics of `unverified_by_trace(...)` and when to stop vs degrade.

### K2) Canonical Architecture + Ownership Boundaries
- Which modules own which responsibilities (ingest/query/knowledge/epistemics).
- Which layers may call which layers (no bypasses).
- Where extension points are safe (skills, adapters, ingestion sources).

### K3) Storage + Schema + Migration Rules
- What is stored (entities/relations/packs/claims/episodes) and why.
- How versions and quality tiers affect compatibility.
- How to do safe schema evolution without corrupting evidence provenance.

### K4) Provider + Model Governance as a Runtime Dependency
- How provider health is checked and audited.
- What model selection policy is in force (daily selection).
- How to reason about rate limits, usage limits, and “authenticated but unusable”.

### K5) Determinism + Replay Boundaries
- Which steps must be deterministic (AST parsing, extraction, ranking tie-breaks).
- Which steps are non-deterministic but must be recorded (LLM prompts/responses).
- How to generate “replay evidence” and compare runs.

### K6) Freshness + Staleness Semantics
- What “index is fresh” means (repo HEAD vs indexed commit vs mtime).
- How defeaters propagate when files, deps, or tests change.
- What the SLOs are (freshness, latency) and how they’re measured.

### K7) Failure Mode Registry (Operational Truth)
- Known failure classes (provider unavailable, partial index, watcher storms).
- What the system should do on each failure (explicit stop conditions).
- Where evidence artifacts and runbooks live (`state/audits/**`, docs runbooks).

### K8) Self-Knowledge Drift (Critical)

If LiBrainian’s own index is stale, then “LiBrainian analyzing LiBrainian” can
produce confident-but-wrong self-advice. Agents need:
- A way to detect index drift (indexed commit SHA vs workspace HEAD).
- A policy: “reindex required scope before relying on self-analysis”.
- A first-class “self-bootstrap” and “self-watch” posture for LiBrainian itself.

### K9) Library Currency + Coverage
- Whether method/technique libraries are current vs stale relative to the repo.
- Versioning of method packs and how to invalidate or update stale entries.
- Coverage gaps: where the library is thin and should not be trusted.

### K10) Runtime Constraints + Tooling Surface
- Sandbox limits, CLI availability, and provider constraints per environment.
- Watcher capabilities by platform (recursive support, file descriptor caps).
- Which CLI commands are safe to run inside constrained environments.

## Dependencies and Integration With the Existing Roadmap

This “Phase 6+” plan assumes Phases 1–5 are already real (provider gating,
single pipeline, event wiring, validation/audits). Concretely, the Phase 6+
features depend on:
- Provider gates + daily model selection being enforced before semantic work.
- Storage integrity and versioning (so new primitives can be persisted safely).
- Deterministic Tier-0 gates and Tier-2 audit runs (to prevent theater).

If any prerequisite is missing in reality, the correct response is:
`unverified_by_trace(prerequisite_missing)` plus a plan to fix prerequisites first.

## Target Capability Set (Phase 6+)

### C1) Unified Epistemic Substrate (“One Claim Graph”)

Goal: every semantic statement LiBrainian emits can be represented as:
- a `Claim` with `Evidence`,
- linked supports/opposes edges,
- active defeaters and contradictions,
- and a confidence decomposition.

Current reality hint: the repo already has an explicit epistemics engine
(`src/LiBrainian/epistemics/*`) and also “claims/defeaters” elsewhere in the
knowledge layer. The upgrade is **unification**:
- Knowledge generation outputs `Claim` nodes (not just prose summaries).
- Pattern detection, method packs, architecture/rationale outputs produce claims.
- Query responses reference claim IDs + evidence graph traversals.

Acceptance (future, measurable):
- A query response can include `claim_ids` and a compact “argument map” summary.
- Defeater activation on file/test changes marks affected claims stale/defeated.
- No semantic output without either (a) attached evidence/trace or (b) explicit
  `unverified_by_trace(...)` and a generated “how to verify” plan.

### C2) Trajectory / Episodic Memory as Evidence (Not Just Cache)

Goal: store and retrieve agent trajectories as first-class memory:
- context packs used,
- decisions made,
- patches applied,
- commands executed,
- outcomes (tests, runtime signals),
- and downstream impact.

Why: this powers:
- calibration (confidence becomes empirical),
- reuse (successful fixes become reusable procedures),
- and detection of “theater” (plans that never ran).

Acceptance (future, measurable):
- LiBrainian can answer: “Have we solved this class of problem before? With what
  evidence and what outcomes?”
- Confidence updates incorporate trajectory outcomes, not only heuristics.

### C3) A Universal Problem-Solving Method Library (Cross-Domain)

Goal: a comprehensive library of problem-solving techniques that applies to:
- debugging, architecture, refactoring, performance, security,
- research synthesis, UX/design, product thinking,
- formal reasoning and novel math,
- creative generation, divergent thinking, and constraint satisfaction.

Critical requirement: techniques must be **primitives** (composable building
blocks) that agents can instantiate into **real structures** (work primitives,
checkpoints, experiments, acceptance criteria).

This is not “tips”. It is an executable methodology substrate.

### C4) Repo Rehabilitation Engine (“Turn Sucked Repo into World-Class”)

Goal: when a repo is messy/unsafe/unmaintainable, LiBrainian can:
- diagnose the state with evidence,
- propose a staged transformation plan,
- generate the minimal scaffolding needed to bootstrap quality,
- and keep that plan grounded in verification gates.

Acceptance (future, measurable):
- LiBrainian produces a rehaul plan with explicit invariants, risks, and a
  checkpointed rollout that passes Tier-0 gates at each stage.

### C5) Extreme-Scale Operation (10M LOC and Beyond)

Goal: remain useful under scale by shifting from “index everything deeply now”
to **progressive, topology-aware indexing**:
- coarse index everywhere,
- deep semantic enrichment where it matters,
- and demand-driven expansion.

Acceptance (future, measurable):
- Bootstrap to “usable” state is fast and stable.
- Deep enrichment runs as budgeted background work with explicit gaps.
- Query latency and freshness SLOs are observable and enforced.

### C6) Bootstrap + AutoWatch Become “Operationally Correct”

Goal: make cold-start and continuous update robust, truthful, and cost-aware:
- watchers are status-truthy,
- change storms do not DDoS providers,
- and incremental updates degrade gracefully with explicit defeaters.

## AutoWatch: Suspected Problems + Failure Modes (Grounded)

This section is written from the viewpoint of “any agent, any load, any repo”.
It assumes the workspace is adversarial in practice: massive churn, generated
directories, branch switching, and multiple agent processes/instances.

### AW-1) Silent Watch Failure + “Catch-Up” Correctness

If AutoWatch fails silently (no events processed for hours/days) and later
“comes back”, the system must not assume it is fresh. File watching is not an
audit log; it does not tell you what you missed.

Catch-up requires a **cursor** and a **reconciliation algorithm**.

#### Required: Persistent Watch Cursor

AutoWatch should persist a durable cursor in storage (not process memory):
- `watch_started_at`, `watch_last_heartbeat_at` (heartbeat independent of file events)
- `watch_last_event_at` (last time any FS event was processed)
- `watch_last_reindex_ok_at` (last successful incremental update)
- `watch_cursor` (how we know what we’ve indexed)

Cursor options (choose based on repo type):
1) **Git cursor (preferred)**:
   - `last_indexed_commit_sha` (and optionally `last_indexed_tree_hash`)
   - Catch-up = `git diff --name-status <sha>..HEAD` (bounded to include patterns)
2) **Filesystem cursor (fallback)**:
   - `last_reconcile_completed_at` timestamp
   - Catch-up = walk workspace and compare `(mtime,size)` first, checksum second.

The cursor must also record the effective watch config and platform details so
operators can reason about reliability.

#### Required: Reconciliation (“Sweep”) Mode

AutoWatch must include an explicit periodic reconciliation step that can run:
- on startup,
- on watch restart,
- on detected heartbeat gaps,
- or on operator request.

Reconciliation algorithm (high-level):
1) Enumerate current workspace files (include patterns, exclude patterns).
2) Detect **new files** (present on disk, missing in DB) → index them.
3) Detect **deleted files** (present in DB, missing on disk) → cleanup them.
4) Detect **changed files**:
   - fast path: compare `mtime+size` to stored file metadata (if available),
   - slow path: compute checksum and compare to `librarian_file_checksums`.
5) Reindex changed files in bounded batches with backpressure.
6) Emit explicit “catch-up completed” telemetry and update cursor.

Correctness rules:
- If providers are unavailable during catch-up, do not “pretend” to catch up:
  activate freshness defeaters and emit a recovery work item.
- If lock conflicts prevent reindex, requeue with backoff; if still blocked,
  mark affected files stale and surface it via `watch_status`.

#### Required: Watch Health Telemetry (So Failure Is Not “Unnoticed”)

AutoWatch must make silent failure detectable:
- Heartbeat ticks are persisted even if no file changes occur.
- `watch_status` reports:
  - “alive vs suspected dead”,
  - last heartbeat, last event processed,
  - last successful reindex,
  - whether a catch-up sweep is needed/queued/running,
  - and an estimate of possible staleness window.

### AW-2) Instance Coupling Bug (Single Watcher, Multiple Librarians)

The watcher registry is per-process and keyed by `workspaceRoot`. If a process
creates multiple LiBrainian instances for the same workspace, `startFileWatcher`
returns the existing watcher handle, but the watcher continues to call the
*original* LiBrainian instance it captured at construction time.

Failure outcomes:
- “AutoWatch is enabled” but updates are applied through the wrong instance.
- One consumer stops the watcher and silently disables another consumer.
- Status reporting can be inconsistent (“watching” from one instance, dead in another).

Mitigation direction:
- Make watch ownership explicit (workspace-level service/daemon).
- Or support multi-subscriber watchers with an internal stable queue that calls
  reindex through a single canonical workspace service.

### AW-3) Recursive Watch Portability

`fs.watch(..., { recursive: true })` is not portable across all environments.
Agents running on Linux hosts can see “watch started” but receive no events (or throw).

Mitigation direction:
- Provide a robust watcher backend strategy (watchman/chokidar) and/or
  a periodic diff-scan fallback that emits explicit “watch degraded” status.
- Capture and surface FS watcher errors and resource exhaustion:
  - “too many open files”, watcher limits, OS event queue overflow.
  - If the OS can drop events, catch-up sweep becomes mandatory.

### AW-4) “Truthiness” of Watch Status

`isWatching` can become a local handle check rather than a durable statement
about whether the workspace is being watched and whether incremental indexing is
actually succeeding.

Mitigation direction:
- Persist watch telemetry in index state (last event seen, last reindex ok, queue size).
- Expose `watch_status` as a first-class API output.

### AW-5) Storm Control + Provider Backpressure

Under heavy churn (git checkout, npm install, generated outputs), file events can
explode. Even with per-path debouncing, agents can saturate the system with
small reindex requests, causing provider failures and inconsistent partial state.

Mitigation direction:
- Batch window + changeset queue (coalesce into bounded reindex work units).
- Threshold policy: if event volume exceeds X, switch to “incremental stale” and
  run bounded sweeps instead of per-file calls.

### AW-6) “Repo State” Exclusions and Self-Triggering

Directories like `.LiBrainian/**` and runtime artifacts can change frequently and
can be meaningless for code understanding. They can also trigger watch loops.

Mitigation direction:
- Maintain a separate exclusion profile for watching vs indexing.
- Treat “internal state directories” as watch-excluded by default.
- Consider treating `state/audits/**` specially: valuable evidence, but usually
  not part of live code change indexing.

### AW-7) Provider Config Drift in Incremental Reindex

Incremental reindex can require LLM configuration. If watch is enabled but LLM
defaults are missing or stale, the system can repeatedly fail and log warnings,
giving the illusion of “watching” while not updating.

Mitigation direction:
- Resolve incremental defaults from persisted bootstrap defaults + daily model policy.
- On repeated provider failures: activate defeaters + emit a recovery work item.

### AW-8) Configuration Plumbing Mismatch

It is easy for different entrypoints (CLI, MCP server, programmatic API) to
surface an `autoWatch` configuration that is not actually applied to the watcher
(e.g., debounce/cascade knobs reported but not wired into watcher construction).

Mitigation direction:
- Treat watcher configuration as a single typed config object that is passed
  through all surfaces to the underlying watcher manager.
- Make `watch_status` report the *effective* config (not only requested config).

### AW-9) Watcher Created Without Storage (Degraded Mode That Can Stick)

The watcher’s correctness depends on having a storage handle for:
- checksum-based “skip unchanged” decisions,
- deletion cleanup (removing indexed entities),
- cascade (finding dependents via graph edges),
- and index-state updates.

If a watcher is created without storage and later a caller tries to “upgrade” it
by calling `startFileWatcher` again with storage, a naive “return existing”
watcher registry can keep the watcher permanently in degraded mode.

Failure outcomes:
- every file event triggers reindex (no checksum skip),
- deleted files remain in the index (no cleanup),
- dependent cascade never happens,
- watch appears “on” but correctness is degraded and cost can explode.

Mitigation direction:
- Require storage for watcher creation in production paths.
- Or implement “watcher reconfigure” so later calls can attach storage/config.
- Make watch status explicitly report “storage_attached: true/false”.

### AW-10) Lease Conflicts and Missed Updates

Incremental reindex acquires file locks. Under concurrency, watch-triggered
reindex can fail due to lease conflicts and only log a warning. If the file does
not change again, the index can remain stale indefinitely.

Mitigation direction:
- Treat `lease_conflict` as retryable: requeue with backoff and a maximum age.
- If retries exceed threshold, activate staleness defeaters and emit a recovery work item.

### AW-11) Path Canonicalization, Case Sensitivity, and Symlinks

Watch events provide paths that can vary by:
- relative vs absolute formatting,
- path separator differences,
- case differences on case-insensitive filesystems,
- symlinked paths and real paths.

If checksums and entity IDs are keyed by the “wrong” path representation, watch
can thrash (permanent checksum mismatch) or miss invalidations.

Mitigation direction:
- Canonicalize paths at the workspace boundary (normalized separators + absolute).
- Decide and document whether the canonical key is `realpath` (follows symlinks).
- If symlinks can escape the workspace root, treat as untrusted and exclude by default.

### AW-12) Atomic Save / Rename Semantics

Many editors write to a temp file and then rename over the original. `fs.watch`
can emit:
- `rename` events without stable filenames,
- multiple events for a single save,
- transient “file missing” windows.

Mitigation direction:
- Handle rename robustly (treat as delete+create, but with short reconciliation window).
- Debounce across *changesets*, not only per-path.
- Avoid destructive deletion cleanup for transient temp names (require confirm window).

### AW-13) Encoding, Binary-ish Files, and Large Files

Checksum computation and reindexing can behave poorly when:
- files are not UTF-8 decodable,
- files are binary-ish but have a “texty” extension,
- files are very large and get repeatedly read (checksum + indexer read).

Mitigation direction:
- Make watcher checksum read bounded (size threshold) and fall back to mtime+size fingerprint.
- If a file is repeatedly skipped as binary/too-large, mark it as watch-ignored with explicit evidence.
- De-duplicate reads between checksum and reindex when possible (pass content forward).

### AW-14) Git Operations and Massive Churn

Checkout/rebase can touch thousands of files quickly. A per-file watch loop can:
- overload providers,
- create stale partial state,
- and slow down the agent enough to be unusable.

Mitigation direction:
- Detect storm patterns (event rate, breadth, or `.git` activity) and switch modes:
  - pause per-file indexing,
  - mark index “incremental stale”,
  - run a bounded sweep or require a targeted bootstrap refresh.

### AW-15) Git History Rewrite / Shallow Clone Gaps

If the repo rewrites history (force push) or is a shallow clone, the git cursor
can point to a commit that no longer exists or cannot be diffed.

Mitigation direction:
- Detect diff failures and fall back to fs sweep with explicit `needs_catchup`.
- Record the failure as an event and require a fresh baseline cursor.

### AW-16) Time Skew and Non-Monotonic mtimes

Clock skew or tools that preserve timestamps can cause mtime to move backward,
leading to missed changes if only mtime+size is used.

Mitigation direction:
- On any backward-time detection, force checksum validation for that path set.
- Keep a last-seen timestamp to detect regressions.

### AW-17) Networked Filesystems and Virtualized Volumes

Remote mounts and virtualized volumes can drop or delay watch events, and can
report mtimes inaccurately under load.

Mitigation direction:
- Detect networked mounts and force periodic reconciliation sweeps.
- Surface a `watch_degraded` status when events are not reliable.

### AW-18) Include/Exclude Rule Drift

If include/exclude rules change during a watch session, the watcher can have a
partial view of the workspace, leading to false freshness.

Mitigation direction:
- Treat config changes as a forced catch-up sweep.
- Record config hash in watch state and invalidate on change.

### AutoWatch Debug Checklist (Agent-Run, Evidence-First)

When an agent suspects AutoWatch is broken, it should collect a minimal,
reproducible evidence set before making changes:

1) Confirm platform watcher capability (recursive support, file descriptor limits).
2) Confirm watch exclusions include internal/runtime directories (`.LiBrainian/**`, caches, build outputs).
3) Confirm LLM defaults are resolvable for incremental reindex (provider + model).
4) Confirm that file events are actually arriving:
   - edit a known-included source file,
   - observe “file_modified” + “indexing_started/complete” events (or equivalent telemetry),
   - confirm index state transitions to `incremental` and remains healthy.
5) Confirm that the watcher is calling the correct workspace service/instance:
   - if multiple LiBrainian instances exist, verify which instance handles events.
6) Stress test storm handling:
   - simulate many file changes (or checkout),
   - verify batching/backpressure triggers rather than per-file thrash.
7) Verify freshness:
   - query a symbol you just changed and confirm evidence points to the new content.

If any step cannot be verified, the correct response is an explicit failure with
`unverified_by_trace(watch_unreliable)` plus a concrete remediation plan.

## Agents Under Constraints (Operational Posture Matrix)

This is a compact “any agent, any repo, any constraint” posture guide.
It is intentionally conservative: prefer correctness and explicit uncertainty.

### Constraint: Providers unavailable / rate limited
- LiBrainian should fail closed for semantic operations with `unverified_by_trace(provider_unavailable)`.
- Agents should switch to structural-only actions (build/test/grep/AST-only) **only**
  if the output is explicitly marked non-semantic and does not claim understanding.
- LiBrainian should emit a `VerificationPlan` for how to re-run when providers return.

### Constraint: Repo is huge (multi-million LOC)
- Bootstrap should target “usable-first” and defer deep enrichment.
- Watch should default to changeset batching and bounded sweeps.
- Queries should surface “coverage gaps” explicitly and propose targeted enrichment.

### Constraint: Repo is messy / hostile / misleading docs
- Treat documentation as evidence but not truth; contradictions become explicit.
- Prefer behavioral truth from tests/runtime evidence when available.
- Generate a rehabilitation plan with checkpoints before large refactors.

### Constraint: No tests / broken build
- First objective: construct a truthful feedback loop (minimal tests, smoke runs).
- Avoid “theater” scaffolding: verification must observe real behavior.

### Constraint: Multi-agent concurrency
- Locks, watch state, and indexing must be coordinated at workspace scope.
- Work plans should minimize cross-file contention (slices + ownership boundaries).

## Evidence Pack: What To Collect Before Improving LiBrainian (Or Any Repo)

If an agent is about to improve LiBrainian (or use LiBrainian to improve a repo),
the minimum “epistemically responsible” evidence pack includes:
- Current index provenance (indexed commit SHA, last index time, LiBrainian version/quality tier).
- Provider readiness trace (what providers/models are actually usable now).
- Bootstrap report(s) and whether the run was resumed/partial.
- A small task corpus (5–20 real questions) used to measure retrieval usefulness.
- A calibration snapshot (even if coarse): do high-confidence answers actually hold up?
- A watch health snapshot: last event seen, last incremental reindex success, queue backlog.

## New Primitives (Proposed)

These primitives are the minimum “super brain substrate” additions.
They are deliberately typed and composable.

### P1) `VerificationPlan` (Proof Obligations)

Purpose: represent how to verify a claim, answer, or plan step.

Required fields (conceptual):
- `id`
- `target`: claim/work item/entity
- `methods`: commands/tests/reviews/observations
- `expected_observations`: concrete pass/fail signals
- `cost`: time/token/provider budget estimate
- `risk`: safety notes + sandbox requirements
- `artifacts`: where evidence will be recorded

### P2) `Experiment` (Hypothesis → Evidence)

Purpose: encode scientific-method style learning loops for uncertain work:
- hypothesis
- intervention
- measurement
- result
- updated belief (confidence delta + defeaters resolved/activated)

### P3) `TechniquePrimitive` (Universal Method Atoms)

Purpose: the smallest reusable problem-solving unit.

Shape (conceptual):
- `id`, `name`, `intent`
- `triggers`: when to apply
- `inputs_required`: what info must be gathered first
- `actions`: steps (typed; can compile into WorkPrimitives)
- `verification`: how to know it worked (VerificationPlan references)
- `failure_modes`: how it can mislead / be “theater”
- `outputs`: artifacts produced (notes, diffs, metrics, decisions)

### P4) `TechniqueComposition` (Recipes)

Purpose: compose primitives into domain-agnostic strategies:
- diagnostic loop,
- design loop,
- research loop,
- proof loop,
- optimization loop.

### P5) `Episode` (Trajectory Record)

Purpose: persist what happened in the real world (agent run record).

Minimum fields (conceptual):
- `episode_id`, `workspace`, `timestamp`
- `intent` + scope
- context packs used (IDs + confidence)
- actions taken (patches/commands)
- results (exit codes, test outputs, traces)
- outcome label (success/failure/partial)
- extracted lessons (claims with evidence)

## The Universal Method Library (Design)

### Method Library Goals
- Broad cross-domain applicability (aim: any domain, most problem classes).
- Composability (primitives → structures, not prose).
- Evidence discipline (every method has built-in proof obligations).
- Anti-theater design (methods specify failure modes + “cheat patterns”).

### Taxonomy: Families → Primitives → Compositions

The library should be organized into three layers:
1) **Families** (broad intent clusters)
2) **TechniquePrimitives** (small reusable atoms)
3) **Compositions** (recipes that produce work structures)

#### Suggested Families (expand beyond current MF-01..MF-14)

This list is intentionally cross-domain. It can be implemented incrementally.
It should be mapped onto the existing method-pack families (MF-01..MF-14) so
the library has a single integration surface and can be audited consistently.

1) **Framing + Problem Definition**
   - define objective, constraints, success metrics, stakeholders, invariants
2) **Decomposition + Planning**
   - hierarchical breakdown, dependency mapping, checkpoint design
3) **Diagnostics + Causality**
   - hypothesis trees, controlled experiments, fault localization
4) **Evidence + Verification**
   - test design, oracle selection, instrumentation, falsification protocols
5) **Design + Architecture**
   - option generation, tradeoff analysis, boundary design, ADR capture
6) **Research + Synthesis**
   - source triangulation, contradiction handling, summary with citations
7) **Optimization + Search**
   - hill-climbing, Bayesian optimization, constraint solvers, pruning
8) **Formal Reasoning + Proof**
   - invariants, lemmas, counterexample search, proof sketches
9) **Creativity + Ideation**
   - divergent/convergent loops, forced constraints, analogical transfer
10) **UX + Product Problem Solving**
   - user journeys, usability heuristics, prototype tests, qualitative evidence
11) **Risk + Security**
   - threat modeling, attack-surface mapping, mitigations with tests
12) **Performance + Reliability**
   - profiling loops, SLOs, chaos drills, regression prevention
13) **Delivery + Operations**
   - rollout strategies, canaries, observability, incident playbooks
14) **Coordination + Workflow**
   - role assignment, handoffs, interface contracts, integration protocols
15) **Meta-Cognition + Self-Correction**
   - reflection loops, calibration checks, uncertainty surfacing

### “Compile-to-Work” Rule (Required)

Every technique must be compilable into:
- `WorkPrimitive` structures (tasks/steps/checkpoints),
- `AcceptanceCriterion` entries,
- and `VerificationMethod` entries with concrete commands where possible
(`src/LiBrainian/strategic/work_primitives.ts`).

This is how methods become operational rather than motivational.

### Built-in Anti-Theater Patterns (Required)

For each technique primitive, define:
- “Cheat patterns” (how an agent can appear to do it without doing it),
- “Reality checks” (what observable evidence proves it happened),
- “Stop conditions” (when to halt and escalate with unverified_by_trace).

Minimum acceptance for adding a new technique primitive:
- It compiles into at least one concrete `WorkHierarchy` with checkpoints.
- It defines at least one `VerificationPlan` template that can be executed in a real repo.
- It declares at least one known failure mode and an explicit stop condition.

### Technique Primitive Catalog (Draft, Universal Core)

This is the minimum universal library that should exist as real `TechniquePrimitive`
entries. Each line is intended to be a small, composable unit that compiles into
work primitives with verification hooks.

#### Family: Framing + Problem Definition
- Objective crystallization (one-sentence target)
- Success metric definition
- Constraint inventory (hard vs soft)
- Stakeholder map
- Scope boundary definition
- Invariant declaration
- Unknowns log
- Assumption register

#### Family: Decomposition + Planning
- System decomposition map
- Dependency graph build
- Critical path identification
- Work slicing (smallest safe increments)
- Milestone checkpointing
- Rollback planning
- Risk-adjusted sequencing

#### Family: Diagnostics + Causality
- Hypothesis tree build
- Minimal reproduction extraction
- Delta debugging / bisection
- Fault injection test
- Causal graph sketch
- Counterfactual check
- Mechanism tracing (data flow)

#### Family: Evidence + Verification
- Oracle selection (what proves it)
- Test matrix design
- Instrumentation plan
- Observation logging
- Falsification checklist
- Coverage gap declaration

#### Family: Design + Architecture
- Option generation (divergent)
- Tradeoff matrix
- Interface contract draft
- Boundary and ownership design
- ADR capture
- Prototype with exit criteria

#### Family: Research + Synthesis
- Source triangulation
- Contradiction registry
- Quote extraction with citation
- Evidence weighting
- Synthesis with gaps
- Bibliography normalization

#### Family: Optimization + Search
- Baseline measurement
- Bottleneck identification
- Search space definition
- Constraint formulation
- Ablation study
- Regression guardrail creation

#### Family: Formal Reasoning + Proof
- Invariant extraction
- Lemma decomposition
- Counterexample search
- Proof sketching
- Formal model stub (types/logic)
- Equivalence reduction

#### Family: Creativity + Ideation
- Divergent idea burst
- Constraint flipping
- Analogy transfer
- Morphological matrix
- Idea pruning by evidence
- Concept recombination

#### Family: UX + Product Problem Solving
- User journey map
- Task flow inventory
- Usability heuristic check
- Prototype test plan
- Qualitative evidence capture
- Success metric alignment

#### Family: Risk + Security
- Threat model sketch
- Trust boundary mapping
- Abuse case enumeration
- Mitigation mapping
- Security test design
- Residual risk acceptance

#### Family: Performance + Reliability
- Latency budget definition
- Load profile definition
- Profiling plan
- Failure mode injection
- SLO instrumentation
- Regression detection

#### Family: Delivery + Operations
- Rollout strategy (canary/blue-green)
- Monitoring checklist
- Incident response plan
- Rollback rehearsal
- Release checklist
- Postmortem capture

#### Family: Coordination + Workflow
- Ownership matrix (RACI)
- Interface contract with handoffs
- Change approval gate
- WIP limit setting
- Communication cadence
- Integration checkpoint

#### Family: Meta-Cognition + Self-Correction
- Assumption audit
- Calibration check (confidence vs outcomes)
- Bias check (confirmation, anchoring)
- Red-team prompt
- Decision review
- Stop-and-escalate rule

## API and Surface Design Upgrades (Proposed)

### A1) Claim-Centric API (First-Class Epistemics)

Add API surfaces that allow agents to work directly with claims:
- `create_claim`, `link_evidence`, `get_claim_graph`, `verify_claim`,
  `apply_defeaters`, `diff_claim_sets`.

Key property: answers can be expressed as claims, and claims can be verified.

### A2) “Plan Compiler” API

Add an API that compiles intent into work structures:
- `plan_work(intent, scope, constraints) -> WorkHierarchy + VerificationPlans`
- `decompose_work(work_id, options) -> refined hierarchy`
- `select_methods(intent, uc_ids, repo_state) -> TechniqueCompositions`

### A2b) Agentic Review as a Compiled WorkGraph

Agentic review should be a real, composable work structure assembled from
TechniquePrimitives and VerificationPlans, not a one-off prompt flow.

Minimum review composition:
- **Claim extraction** (TechniquePrimitive -> WorkPrimitive "review" tasks)
- **Assumption audit** (tp_assumption_audit)
- **Change impact scan** (tp_change_impact)
- **Test gap analysis** (tp_test_gap_analysis)
- **Evidence plan** (tp_verify_plan)
- **Stop/escalate gates** (tp_stop_escalate on missing evidence)
- **Decision review** (tp_decision_review for high-risk changes)

Operational requirement:
- The review outputs a WorkHierarchy with checkpoints and explicit
  VerificationPlans; Episodes record what ran and what changed.
- The review runner must compile this plan from TechniqueCompositions
  and store it alongside the review report.

### A2c) Operator + Relationship Graph API

To scale to complex systems, compositions must express dynamic structure:
- **Operators**: sequence, parallel, conditional, loop, gate, fallback,
  merge, fanout/fanin, retry, escalate, checkpoint, interrupt, timebox,
  budget_cap, throttle, quorum, consensus, backoff, circuit_breaker,
  monitor, persist, replay, cache, reduce.
- **Relationships**: depends_on, blocks, enables, verifies, produces,
  consumes, refines, supersedes, fallback_for, validates, reinforces,
  conflicts_with, parallel_with, evidence_for, invalidates, derived_from,
  requires_context, affects, causes, mitigates, covers, duplicate_of,
  equivalent_to, alternative_to.

Plan compiler should preserve these edges/operators as graph metadata
so higher-level orchestrators can compile to WorkHierarchy + gates.

### A3) “Evidence Pack” API for Agents

Make it easy for agents to request the *right* evidence for a job:
- `get_context_pack_bundle(intent, scope, depth, budget)`
- `get_verification_plan(target)` (tests/commands to prove a claim)
- `get_rehab_plan(repo_state)` (if the repo is “sucked”)

### A4) Bootstrap as a Progressive Service

Replace “one-shot bootstrap” as the only mental model with:
- `bootstrap(progressive=true, target='usable'|'full', budget=...)`
- “usable” means retrieval works + core entities/graphs exist.
- “full” means enrichment coverage targets met (budgeted, resumable).

### A5) AutoWatch as a Cost-Aware Incremental Pipeline

Expose explicit watch controls:
- `watch_start({ debounceMs, batchWindowMs, maxBatchSize, mode })`
- `watch_status()` returns persistent truth (not only in-memory).
- `watch_stop({ flush=true })`

Operational behavior:
- Batch changes into “ChangeSets” and reindex in bounded work units.
- On provider failures: mark staleness defeaters and queue recovery work.

### A6) System Contract + Provenance API (Self-Describing LiBrainian)

Problem: docs drift and stale indexes mean agents can confidently do the wrong thing.

Add a small “self-describing” API surface that returns machine-readable truth:
- `get_system_contract()`:
  - LiBrainian version + quality tier
  - enforced invariants (provider gating, semantic requirements, fail-closed rules)
  - index provenance (what commit/tree/time was indexed)
  - watch provenance (cursor + last heartbeat/reindex ok)
- `diagnose_self()`:
  - detects obvious drift (workspace HEAD != indexed SHA)
  - detects degraded watch state (no heartbeat, no events, no catch-up)
  - returns `unverified_by_trace(self_drift_detected)` when unsafe to rely on self-knowledge

## Should LiBrainian Have Its Own Language (DSL)?

### Motivation
Agents need a compact way to express:
- scope,
- claims,
- proof obligations,
- and work structures,
with deterministic compilation to typed requests.

### Recommendation: Start with an IR, then (maybe) add a DSL

1) Define a **LiBrainian Intermediate Representation (LIR)**:
   - JSON schemas for `Claim`, `VerificationPlan`, `TechniquePrimitive`,
     `WorkHierarchy`, `Episode`.
2) Add a small **text format** only if it reduces friction measurably.

### What a DSL must do (if created)
- Compile deterministically to LIR.
- Be auditable: generated prompts/queries are recoverable and replayable.
- Make proof obligations explicit (cannot “forget” verification).

### Example DSL Concept (Sketch Only)

```
intent "reduce flaky tests"
scope repo "./"
claims {
  C1: "flakiness caused by shared global state" requires verify { run "npm test -- --runInBand" }
}
plan {
  task "localize flakes" -> checkpoint "repro in CI-like mode"
  task "remove shared state" -> checkpoint "flake rate reduced"
}
```

This is optional; the IR is the real deliverable.

## AutoWatch Redesign (Concrete Improvements)

### W1) Truthy Watcher Status
Problem: “watching” should reflect the actual running watcher, not just a local handle.

Plan:
- Canonicalize workspace roots (absolute, normalized).
- Make watcher lifecycle observable via persistent index state + events.
- `watch_status` should report:
  - last event time,
  - pending queue size,
  - last successful incremental reindex,
  - provider availability and any active defeaters.

### W2) Storm Handling (Batching + Backpressure)
Problem: branch changes can trigger thousands of file events.

Plan:
- Add a batch window (e.g., 250–1000ms) to coalesce changes.
- When change volume crosses a threshold:
  - mark index “incremental stale”,
  - run a bounded incremental sweep,
  - and degrade gracefully if providers unavailable.

### W3) Provider-Aware Degradation
If incremental reindex requires LLM and it’s unavailable:
- emit `unverified_by_trace(provider_unavailable)`,
- activate defeaters for affected claims,
- queue a recovery work item (do not silently spin).

## Bootstrap Redesign (Concrete Improvements)

### B1) “Usable First” Bootstrap
Deliver a minimal, fast “usable” state:
- file inventory + structural graphs + embeddings + basic packs,
- plus explicit gap report for missing enrichment.

Clarification (to prevent “MVP theater”):
- “Usable” must still be truthful: it may be incomplete, but it must not claim
  semantic understanding beyond what evidence supports.
- “Usable” outputs should surface explicit gaps/defeaters and schedule enrichment
  work items rather than hiding missing coverage.

### B2) Priority-Based Enrichment
Enrich in this order:
1) entrypoints and public APIs,
2) high-centrality modules,
3) high-churn hotspots,
4) security/performance critical areas,
5) the rest (budget permitting).

### B3) Background Enrichment as Work
Enrichment becomes queued work primitives with checkpoints:
- produces measurable progress,
- can be paused/resumed,
- and never pretends full coverage when partial.

## Extreme Scale Strategy (10M LOC)

### S1) Progressive Indexing as a First-Class Mode
- coarse scan and indexing everywhere,
- deep enrichment only where demanded by queries or risk.

### S2) Sharding via Federation (and/or Monorepo Partitioning)
Treat a monorepo as federated workspaces when needed:
- query executes across shards with provenance,
- results are merged with confidence penalties for cross-shard gaps.

### S3) Hierarchical Retrieval
Use multiple granularities:
- file/module/function entities,
- plus “emergent entities” (subsystems, workflows),
- plus episodic memory retrieval (similar trajectories).

### S4) Caching + Determinism
Cache must be:
- replayable,
- keyed by explicit provenance (model, prompt digest, inputs),
- and invalidated by defeaters on change.

## Repo Rehabilitation Engine (Design)

### R1) Repo State Diagnosis (Evidence-Backed)
Produce a `RepoHealthReport` with:
- structure map,
- quality risks,
- test posture,
- security posture,
- build reliability,
- and a “minimum necessary uplift plan”.

### R2) Uplift Plan Compiler
Output a staged plan with:
- invariants (“keep behavior identical”, “never break Tier-0”),
- checkpoints (tests, metrics),
- and rollback paths.

### R3) “Scaffolding First” for Broken Repos
When repos are “doc-only”, “no tests”, or “broken build”:
- generate the minimal scaffolding to create a truthful feedback loop
  (without theater).

## Evidence Gates (Non-Bypassable)

For any Phase 6+ feature to be considered real:
- Tier-0 tests cover deterministic parts.
- Tier-2 audits demonstrate live-provider behavior and produce artifacts.
- All semantic claims either:
  - link to evidence traces, or
  - explicitly return `unverified_by_trace(...)` plus a VerificationPlan.

## Codex 5.2 Implementation Protocol (Inline Summary)

This is the short, exact execution protocol for building this plan with TDD.
It is derived from `docs/LiBrainian/SUPER_BRAIN_IMPLEMENTATION_PROTOCOL.md`.

### Step 0: Establish Truth (Evidence Pack)
- Record HEAD SHA, last indexed SHA/time, provider readiness, and watch status.
- If any are unknown or stale: treat self-analysis as `unverified_by_trace(self_drift_detected)`.

### Step 1: TDD Loop for Each Slice
- Write a Tier-0 test that fails for the missing behavior.
- Implement the smallest change to pass.
- Add or update doc evidence in this plan (Implementation Updates).

### Step 2: Run Gates in Order
- `npm run test:tier0`
- `npm test` (for completion proof pack)
- `npm run test:agentic-review` when the slice adds or changes semantic behavior

### Step 3: Commit Discipline (Non-Optional)
- Commit every 100 lines of new code.
- Commit immediately after creating new files.
- Never exceed 200 lines uncommitted.
- If a deletion is needed: commit first, then delete.

### Step 4: Stop Conditions (Fail Closed)
- If providers are unavailable, stop with `unverified_by_trace(provider_unavailable)`.
- If any gate cannot be executed, stop with `unverified_by_trace(implementation_blocked)`.

## Implementation Guardrails (Preempt Bad Implementations)

This section exists to prevent the most common failure pattern in agent-built
systems: building “infrastructure for” a capability instead of the capability,
and then silently shipping theater.

### Non-Negotiable Implementation Rules

1) **No semantic claims without evidence**
   - If the system cannot attach evidence/trace, it must return
     `unverified_by_trace(...)` and include a VerificationPlan.

2) **No silent degradation**
   - “Watch is running” must not be inferred from local handles.
   - “Index is fresh” must not be inferred from “watch started”.
   - Every degradation must be visible via status APIs and defeaters.

3) **No parallel systems**
   - Do not create a second method library, a second claim model, or a second
     watch subsystem. Extend existing primitives and surfaces.
   - If a new representation is introduced (e.g., LIR), define it as an
     intermediate form that compiles into existing primitives.

4) **Make failure modes first-class**
   - Every new subsystem must expose: status, last-success time, backlog size,
     and stop reasons (explicit error taxonomy).

5) **Determinism boundaries are explicit**
   - Deterministic components must be testable without providers.
   - Non-deterministic components must record provenance (provider, model, prompt digest).

6) **Provider gating remains strict**
   - Do not add “fallback semantics” that appear to work without live providers.
   - Do not add any deterministic/fake embedding path (forbidden).

### Forbidden Patterns (Common Bad Implementations)

These are specifically called out because they tend to “feel productive” while
making the system less real.

- **Fake semantics**: heuristic or template outputs presented as understanding.
- **Fake memory**: storing only summaries without replayable traces/outcomes.
- **Unbounded background loops**: “watch” or “enrichment” processes without
  backpressure, budgets, or stop conditions.
- **Implicit global state**: hidden singletons for watcher/queue/model defaults
  that make correctness depend on process history.
- **Status theater**: reporting “healthy” based on configuration flags rather
  than observed behavior (heartbeat, successful reindex, cursor advances).
- **Undeclared drift**: using stale indexes without surfacing freshness defeaters.
- **Un-auditable LLM usage**: LLM calls not recorded with prompt digest/model id.

### Guardrails for Each Major Addition

#### VerificationPlan
- Must be executable in real repos (commands/tests) and specify expected signals.
- Must never claim “verified” unless an execution evidence artifact exists.

#### Episode (trajectory memory)
- Must record “what ran” and “what changed” (commands, patches, exit codes).
- Must not store secrets/tokens; redact by default and preserve provenance safely.

#### Claim graph unification
- Must preserve contradictions (do not “merge away” disagreement).
- Must support defeaters as active runtime entities (not only annotations).

#### Technique primitives / method library
- Must compile into work/checkpoints with verification hooks (anti-theater).
- Must be mapped onto a single integration surface (existing MF families).

#### AutoWatch
- Must implement a durable cursor + reconciliation sweep (catch-up).
- Must be resilient to storms and portable across platforms (or explicitly degrade).
- Must have explicit “suspected dead” detection via heartbeats.

## Implementation Preemption Checklist (Stop Bad Builds Early)

Before shipping any slice, confirm:
- Status truth: new state is persisted and observable via API/CLI/MCP.
- Evidence truth: any semantic output links to evidence or returns `unverified_by_trace(...)`.
- Degradation truth: failures are surfaced as explicit defeaters and stop reasons.
- Determinism truth: deterministic paths have Tier-0 tests, non-deterministic paths record provenance.
- Backpressure truth: any background loop is bounded by budgets and stop conditions.

## Implementation Slices (PR-Sized)

These are ordered to maximize “super brain value” early without creating theater.

1) **Watcher truth + batching**
   - canonical workspace normalization
   - persistent watch status (events + index state)
   - batch + backpressure strategy

2) **VerificationPlan primitive + API**
   - minimal schema + persistence
   - query responses can attach verification plans

3) **Episode recording**
   - record run trajectories with outcomes
   - enable “similar episode” retrieval

4) **Unify claim substrate (bridge knowledge → epistemics)**
   - store semantic outputs as claim nodes with evidence
   - defeater propagation over claims

5) **TechniquePrimitive library v1**
   - start with 30–60 primitives across the families above
   - compile-to-work prototypes for a handful of compositions

6) **Repo rehabilitation v1**
   - produce diagnosis + uplift plan with checkpoints
   - validate against a small suite of intentionally “bad repos”

7) **Scale mode**
   - progressive bootstrap target “usable”
   - priority-based enrichment queue

## Open Design Decisions (Make Explicit Early)

These decisions should be made early because they change architecture, storage,
and operational behavior.

1) **Watcher topology**: in-process watcher vs workspace daemon vs “MCP server owns watch”.
2) **Catch-up cursor default**: git-based cursor vs filesystem sweep baseline for non-git workspaces.
3) **Persistence boundaries**: where Episodes and VerificationPlans live (tables vs versioned state keys).
4) **Incremental modes**: when to do “structural-only update + semantic stale defeaters” vs full semantic reindex.
5) **Method library governance**: contribution gate (required evidence, tests, anti-theater checks).
6) **Scale sharding policy**: when a monorepo becomes federated shards and how queries merge results.

## Out of Scope (For This Doc)
- Detailed schema additions in `docs/LiBrainian/SCHEMAS.md` (should be a follow-up).
- Full API surface changes and migrations (should be broken into slices).
- Any “fake” or deterministic embedding fallback (forbidden by canon).

## Plan Implementation Risk Register (Likely Problems + Mitigations)

This is a “what will go wrong” list for real agents under real constraints.

### RISK-1) Schema Explosion and Migration Debt
Problem: adding claims/episodes/verification plans can create rapid schema churn.
Mitigation:
- Introduce new artifacts via additive schemas and versioned state keys first.
- Only migrate to first-class tables after stable usage patterns exist.
- Build explicit “export/diff” tools for audits before changing formats.

### RISK-2) Non-Determinism Leaks Into the Deterministic Gate
Problem: method packs, claims, and LLM outputs can drift; tests can become theater.
Mitigation:
- Treat LLM outputs as recorded artifacts with prompt digests and model IDs.
- For Tier-0: validate structure/provenance, not semantic “correctness”.
- For Tier-2: validate with live-provider audits and replay comparisons.

### RISK-3) Cost Blowups (Token/Time) During Bootstrap and Watch
Problem: naive “do everything” loops saturate providers and never converge.
Mitigation:
- Default to “usable-first” bootstrap and budgeted progressive enrichment.
- Queue enrichment as work primitives with explicit stop conditions.
- Add storm control and backpressure to watch as a product requirement.

### RISK-4) Confidence Theater (“Numbers That Don’t Mean Anything”)
Problem: confidence scores can be cosmetically precise but epistemically empty.
Mitigation:
- Require confidence decomposition + defeaters, not a single scalar.
- Tie confidence updates to outcomes (episodes), not only heuristics.
- Require calibration reports (empirical) before trusting confidence for automation.

### RISK-5) Prompt/Instruction Injection via Indexed Content
Problem: malicious repo content can steer the agent or the LiBrainian.
Mitigation:
- Treat repo content as untrusted for synthesis; isolate-then-aggregate.
- Attach “untrusted content” defeaters where applicable.
- Prefer structured extraction and explicit evidence linking over free-form synthesis.

### RISK-6) Multi-Process / Multi-Agent Race Conditions
Problem: multiple agents can compete over locks, watch state, and incremental updates.
Mitigation:
- Workspace-level coordination primitives (locks) must extend to watchers and queues.
- Watch becomes a single workspace service with explicit ownership and heartbeats.

### RISK-7) “LiBrainian Not Up To Date” as a Recurring Failure Source
Problem: stale indexes silently degrade answer quality.
Mitigation:
- Index provenance is mandatory: record workspace commit SHA and last indexed time.
- Queries should surface freshness defeaters automatically.
- Agents should be able to request “refresh this scope” as a first-class operation.

### RISK-8) “Catch-Up” Becomes a Full Reindex in Disguise
Problem: naive reconciliation sweeps can turn into expensive full rescans on every restart.
Mitigation:
- Use a cursor (git diff when available) to bound catch-up.
- Prefer incremental fingerprints (mtime+size) before checksums.
- Enforce budgets and batch limits; surface “catch-up incomplete” as a defeater.

### RISK-9) Over-Instrumentation Becomes Its Own Failure Mode
Problem: adding provenance and telemetry can produce huge logs and slow the system.
Mitigation:
- Store compact summaries in primary state; keep full traces in audits with rotation.
- Sample or cap per-run artifacts while keeping “stop reasons” always recorded.

### RISK-10) “Universal Method Library” Turns Into Unmaintainable Prose
Problem: the method library devolves into advice rather than executable primitives.
Mitigation:
- Enforce the “minimum acceptance” gate for each technique primitive.
- Require at least one compilation target + verification plan per technique.
- Keep the first release intentionally small and measured by outcomes.

## Skills + Tools + Structures Agents Likely Need (Beyond Methods)

LiBrainian already has a typed skills system (`src/LiBrainian/skills/*`) designed
to load portable procedural knowledge from `SKILL.md` directories and validate
scripts/resources. To reach “super brain” level, skill ecosystems should be:

### S-1) Skill Packs as First-Class Knowledge Artifacts
- Skills should be queryable by trigger, repo state, constraints, and risk.
- Skills should emit evidence artifacts (what commands ran, what changed).
- Skills should compile into work primitives + verification plans.

### S-2) Skill Trust + Sandbox Semantics
- Skills need explicit “trust tiers” and sandbox requirements.
- Validation must detect dangerous patterns and require explicit operator acknowledgement.
- Skills should be able to declare required providers (LLM/embedding) and fail closed.

### S-3) High-Value Skill Pack Candidates (Missing or Needs Improvement)
- **Autowatch triage**: diagnose watcher failures, platform support, storm states.
- **Bootstrap recovery**: detect partial index, resume phases, prioritize “usable-first”.
- **Repo onboarding (messy/hostile)**: establish build/test truth, generate minimal scaffolding.
- **CI failure investigator**: pull logs, local reproduction, minimal fix loop.
- **Performance triage**: profile plan + regression guardrails.
- **Security hardening**: threat model + mitigations + tests.
- **Large refactor slicer**: produce PR-sized slices with invariants and gates (exists conceptually; keep expanding).
- **UX/design loop**: user-journey diagnosis + prototype checkpoints + evidence capture.
- **Release/ops loop**: canary plans, rollback playbooks, observability verification.

### S-4) “Skill ↔ Method” Integration
Methods are cross-domain strategy; skills are executable procedures.
The integration should allow:
- method compositions to select skills,
- skills to emit claim updates and episodes,
- and validation gates to prevent theater (“skill says it ran X” must match evidence).
