# LiBrainian Implementation + Integration Plan (Wave0-Ready)

Status: partial
Scope: meticulous plan for integrating LiBrainian into evolving Wave0 workflows and external projects.
Last Verified: 2026-01-04
Owner: librarianship
Evidence: plan only (implementation evidence must land in STATUS.md)

## Purpose
Define a rigorous, integration-first execution plan that guarantees LiBrainian
can supply all knowledge and understanding needs for Wave0 agents, even as
workflows evolve. This plan is a prerequisite to any implementation changes.

## Non-Negotiables
- LLM understanding is mandatory for semantic knowledge; no heuristic shortcuts.
- Provider gating is fail-closed and enforced before any bootstrap or query.
- Language onboarding is immediate on first encounter; no hard fail allowed.
- Tooling must support dynamic workflows and standardized workflows together.
- Tier-2/3 live-provider tests are embedded in every phase as evidence gates.
- Default to waiting for long-running steps unless explicitly directed otherwise.

## How to Read This Plan
- Each phase lists deliverables, integration hooks, and evidence gates.
- Every dependency is explicit.
- If evidence is missing, the phase is incomplete.

## Work Process Alignment Principles
- Capability-first: LiBrainian is a knowledge service, not a fixed workflow.
- Workflow-agnostic: do not bake in current Wave0 steps; support evolution.
- UC-driven: tasks declare required UC IDs and constraints explicitly.
- Evidence-first: every output is evidence-backed or marked as a gap.
- Waiting default: long-running steps wait unless explicitly interrupted.

## Execution Protocol (Required)
Before any implementation work in a phase:
1) Update canonical docs for the phase and confirm UC coverage.
2) Update WORKPLAN.md with any newly discovered gaps or failure modes.
3) Add or update tests for the phase's acceptance criteria.
4) Run Tier-0 checks before Tier-2/3 live runs.
5) Record evidence artifacts and update STATUS.md.

After any implementation work in a phase:
1) Run the phase's Tier-2/3 live-provider tests.
2) Compare expected vs actual outputs for scenario baselines.
3) Update GapReports, WORKPLAN.md, and STATUS.md.
4) Commit changes with evidence references.

## Critical Gaps + Code-Level Fixes (Required)
- LLM fallbacks in semantic extractors -> remove heuristic fallbacks and fail closed with `unverified_by_trace` (`src/LiBrainian/knowledge/extractors/*.ts`).
- Unknown-language parsing -> LLM fallback parsing in AST indexer + onboarding queue (`src/LiBrainian/agents/ast_indexer.ts`, `src/LiBrainian/agents/parser_registry.ts`).
- Knowledge maps not surfaced -> inject knowledge sources into context assembly (`src/LiBrainian/api/LiBrainian.ts`, `src/LiBrainian/api/context_assembly.ts`).
- Knowledge source summaries not LLM-backed -> add LLM summarizer + evidence map codes (`src/LiBrainian/api/LiBrainian.ts`, `src/LiBrainian/api/llm_env.ts`).
- Method hints are static -> LLM method packs + cache + query wiring (`src/LiBrainian/methods`, `src/LiBrainian/api/query.ts`).
- Method pack preloading missing -> preload method packs during bootstrap (`src/LiBrainian/api/bootstrap.ts`).
- Multi-vector pipeline un-wired -> persist multi-vector signals + query scoring integration (`src/LiBrainian/storage`, `src/LiBrainian/api/embedding_providers`).
- Monorepo alias resolution missing -> workspace detection + alias resolver in ingest (`src/LiBrainian/ingest/workspace_detector.ts`, `src/LiBrainian/ingest/module_indexer.ts`).
- Co-change edges missing in bootstrap -> compute during bootstrap, not only Wave0 integration (`src/LiBrainian/api/bootstrap.ts`).
- Provider unavailability errors lack `unverified_by_trace` -> fail closed in `requireProviders()` (`src/LiBrainian/api/provider_check.ts`).
- Waiting policy not enforced -> default no-timeout for LLM-required steps unless configured (`src/soma/providers/llm_service.ts`, `src/models/model_policy.ts`).

## Implementation Map (File-Level Execution)
Each line is a concrete, code-facing change with explicit wiring targets.

| Area | Primary Files | Required Changes | Evidence |
| --- | --- | --- | --- |
| Knowledge source injection | `src/LiBrainian/api/LiBrainian.ts`, `src/LiBrainian/api/context_assembly.ts` | Build LLM summaries of knowledge-map outputs and inject into context assembly with evidence + map codes | Scenario outputs include knowledgeSources |
| Method pack cache + preload | `src/LiBrainian/methods/method_pack_service.ts`, `src/LiBrainian/api/bootstrap.ts` | Preload top method families during bootstrap; enforce cache TTL and governor budgets | Bootstrap audit includes pack cache |
| Multi-vector retrieval | `src/LiBrainian/storage/sqlite_storage.ts`, `src/LiBrainian/api/embedding_providers/multi_vector_representations.ts`, `src/LiBrainian/api/query.ts` | Store per-entity vector kinds and integrate weighted scoring by intent | Retrieval quality audit |
| Monorepo workspace mapping | `src/LiBrainian/ingest/workspace_detector.ts`, `src/LiBrainian/ingest/module_indexer.ts` | Detect workspace layouts and resolve package aliases into module graphs | Scenario S1/S22 pass |
| Provider/model governance | `src/models/model_policy.ts`, `src/LiBrainian/api/provider_check.ts` | Daily selection snapshots + fail-closed provider checks | Audit artifacts in state/audits |

## Integration Model (Wave0 + External Projects)
LiBrainian must integrate into any work process without assuming fixed steps.
Wave0 workflows will evolve as LiBrainian exposes gaps; integration must be
capability-driven, not process-driven.

### Workflow Integration Contract
- Every agent workflow step can request LiBrainian context packs by intent.
- LiBrainian returns: answer + evidence + confidence + defeaters + next actions.
- Workflows can be standardized (checklists) or dynamic (agent-generated).
- Each workflow step can attach a required UC ID list from the matrix.
- Workflow steps can request evidence thresholds and freshness constraints.

### Integration Artifacts (Required)
- UCRequirementSet: UC IDs + priority + evidence/freshness constraints.
- ContextPackRequest: intent + UCRequirementSet + depth + scope.
- ContextPackBundle: packs + evidence + confidence + defeaters + gaps.
- GapReport: missing UCs + missing signals + required inputs + next steps.
- EvidencePack: citations + traces + provider + model + timestamps.
- WorkflowTemplate: standardized steps each mapped to UCRequirementSets.
- WorkflowRunRecord: inputs/outputs + evidence for audits and regression.

### Knowledge Supply Contract
- All knowledge/understanding needs map to UC IDs in `USE_CASE_MATRIX.md`.
- If LiBrainian cannot satisfy a UC, it must return gaps + required inputs.
- Gaps must be recorded as planning deltas (see Phase 4 and Phase 5).
- Gap reports must be linked to WORKPLAN.md and STATUS.md updates.

### Use-Case Matrix Alignment
- `USE_CASE_MATRIX.md` is the master map of knowledge needs.
- Each UC references architecture via citations (SYS/PIPE/UNDER/etc).
- Scenario coverage in `scenarios.md` must cover high-priority UC clusters.

### Workflow Evolution Loop
- Failed UC coverage or low confidence triggers a GapReport.
- GapReports update `USE_CASE_MATRIX.md`, `WORKPLAN.md`, and `STATUS.md`.
- New workflow templates are generated from clustered UC needs.

### External Project Compatibility
- No repo-specific assumptions; all behaviors are inferred per project.
- Language onboarding triggers on first detection of new syntax or tools.
- Provider and audit policies must apply equally to internal/external repos.

## Phase Plan (Integration-First)

### Phase 0: Canon + Use-Case Matrix
Dependencies: none
Deliverables:
- Canonical docs are coherent and cross-linked.
- Use-case matrix (250+) is complete with dependencies and citations.
Integration hooks:
- UCRequirementSet and GapReport schemas defined in docs.
- Doc map aligns with workflow templates and UC clusters.
Evidence gates:
- Tier-0: doc lint (links + required headers).
- Tier-2: agentic doc audit (live providers) proves no contradictions.

### Phase 1: Model Policy + Provider Gating (Live-Only)
Dependencies: Phase 0
Deliverables:
- Daily model selection via provider docs and recorded audit artifacts.
- Provider checks enforced before any bootstrap, query, or indexing.
- Haiku-class defaults for LiBrainian unless proven insufficient.
Integration hooks:
- Model policy is consumed by CLI, bootstrap, and query.
- Provider gating blocks any workflow step that needs understanding.
Evidence gates:
- Tier-2: `npm run test:agentic-review` (live providers).
- Tier-3: live provider drift test (daily model selection vs policy).

### Phase 2: Ingestion + Language Onboarding
Dependencies: Phase 1
Deliverables:
- Ingestion pipeline wired end-to-end for code, docs, configs, tests.
- Language detection triggers adapter onboarding and reindex.
- Parser registry supports rapid addition of new languages.
Integration hooks:
- File watcher triggers reindex + language onboarding when new files appear.
- Parser registry exposes a stable adapter interface for new languages.
Evidence gates:
- Tier-2: live bootstrap on a mixed-language repo.
- Tier-3: language onboarding stress test (new language mid-run).

### Phase 3: Understanding + Knowledge Construction
Dependencies: Phase 2
Deliverables:
- Understanding synthesis produces purpose/mechanism/contract with evidence.
- Knowledge mappings (ownership, dataflow, risk, tests) stored and queryable.
- Confidence + defeaters enforced; stale knowledge rejected.
Integration hooks:
- Knowledge generation artifacts stored as context packs + evidence packs.
- UCRequirementSet maps to knowledge domains and extraction methods.
Evidence gates:
- Tier-2: scenario suite on onboarding/change/security/refactor.
- Tier-3: adversarial prompts to detect hallucinated knowledge.

### Phase 4: Retrieval + Agent Workflow Integration
Dependencies: Phase 3
Deliverables:
- Query pipeline integrates semantic, graph, co-change, rerank signals.
- Multi-vector and purpose-extraction signals are included in retrieval scoring.
- Context packs assembled with evidence and confidence.
- Agent context assembly uses LiBrainian outputs as primary source.
- Method pack cache and hint injection wired to UCRequirementSet.
Integration hooks:
- Context assembly contract consumed by Wave0 orchestration hooks.
- GapReport emitted when evidence thresholds are not met.
Evidence gates:
- Tier-2: live end-to-end queries from Wave0 tasks.
- Tier-3: multi-agent workflow simulation with conflict detection.

### Phase 5: Validation + Operations + Bootstrap
Dependencies: Phase 4
Deliverables:
- Full bootstrap (live providers) with audit artifacts.
- Expected vs actual output comparisons for core scenarios.
- Operational runbooks for daily model selection and provider checks.
Integration hooks:
- Bootstrap outputs recorded as evidence packs for workflow regressions.
- Validation outputs written to STATUS.md and audit artifacts.
Evidence gates:
- Tier-0: deterministic gate passes.
- Tier-2: live bootstrap for LiBrainian repo.
- Tier-3: stress suite across representative external repos.

## Workflow Tooling Requirements

### Standardized Workflow Support
- Library of canonical workflow templates mapped to UC clusters.
- Each template declares required context packs and evidence thresholds.
- Templates must be versioned and stored as LiBrainian knowledge artifacts.

### Dynamic Workflow Support
- Agents can request ad-hoc context by intent + UC list.
- LiBrainian returns structured context packs aligned to UC dependencies.
- Decisions and rationale are stored as knowledge updates.

### Work Process Integration Hooks
- Pre-task hook: context assembly from LiBrainian.
- Mid-task hook: gap detection and re-query.
- Post-task hook: feedback ingestion and knowledge update.

## Output Comparison and Debugging Loop
- Define expected outputs for each high-priority scenario (SCEN-1..SCEN-30).
- Run live provider queries and compare actual outputs vs expected.
- Record mismatches as gaps tied to UC IDs and architecture references.
- Iterate until outputs align or fail with `unverified_by_trace`.
- Store baselines as JSON artifacts (response schema + evidence refs) and diff them on every run.
- Generate a scenario diff report with missing evidence, confidence drift, and method coverage gaps.

## Failure Modes + Debugging Loop (Required)
When LiBrainian fails to meet UC coverage or scenario expectations:
1) Capture the exact query, context pack, and evidence pack.
2) Identify missing signals (ingest, map, method pack, provider output).
3) Reproduce in a minimal fixture if possible.
4) Run agentic analysis to propose fixes, with evidence references.
5) Update WORKPLAN.md and STATUS.md before implementing fixes.

## Stress Testing (Tier-3)
- Multi-repo, mixed-language, large-repo scale tests.
- Adversarial prompts for hallucination detection.
- Time-bounded runs to validate waiting policy and progress reporting.
- Regression gates for knowledge staleness and confidence drift.

## Planning Deltas (When Gaps Appear)
- Any unsatisfied UC requires a work item in WORKPLAN.md.
- Gaps must be ordered by dependency graph and scenario priority.
- Evidence updates go to STATUS.md with `unverified_by_trace` until verified.

## Operational Requirements
- Daily model selection runs before any LiBrainian execution.
- Provider checks (`checkAllProviders()`) gate bootstrap and query.
- All semantic outputs include evidence + confidence + defeaters.
- All long-running phases default to waiting until completion.

## Usability and Operator Experience (Non-Negotiable)
- CLI outputs are concise, actionable, and consistent across commands.
- Errors include remediation steps and reference relevant docs/commands.
- Progress reporting must be reliable for long runs (bootstrap, reindex).
- Status and readiness are observable without reading logs.
- Evidence and gaps are visible in the primary response, not hidden.
- Documentation tone is professional, technical, and evidence-first (no AI fluff).

## Wave0 Integration Surfaces (Evolving)
- Context assembly: LiBrainian is the primary source of knowledge for agents.
- Orchestrator hooks: pre-task, mid-task, post-task hooks are required.
- Agent registry: tasks can declare needed UC coverage and constraints.
- Workspace lock + file watcher: prevent stale reads and race conditions.

## External Project Support
- Bootstrap must not assume repo layout or language mix.
- Language onboarding pipeline must run on first encounter.
- Evidence and auditing must be portable across repos.

## Open-Source Growth Strategy
- Extension points are documented and stable.
- Contribution guidelines and validation gates are required.
- Community contributions must pass the same Tier-2/3 evidence gates.

## Technical Integration Specifications (Detailed)

### Core Data Contracts (Required)
All workflow integration must use these artifacts. Each artifact is stored
as a LiBrainian knowledge object with evidence and timestamps.

- UCRequirementSet
  - Fields: ucIds[], priority, evidenceThreshold, freshnessMaxDays,
    scopeHint (entity/module/repo/multi-repo), taskType, risks[].
  - Purpose: declare explicit knowledge needs for a workflow step.

- ContextPackRequest
  - Fields: intent, depth, ucRequirements (UCRequirementSet),
    targetRefs[] (paths/symbols), timeBudgetMs, requester, sessionId.
  - Purpose: query LiBrainian with explicit constraints.

- ContextPackBundle
  - Fields: packs[], evidencePackIds[], confidenceSummary, defeaters[],
    coverageGaps[], modelInfo, generatedAt.
  - Purpose: deliver agent-ready context with evidence.

- EvidencePack
  - Fields: citations[], traceIds[], provider, modelId, timestamps,
    extractionMethods[], version.
  - Purpose: make every semantic claim verifiable.

- GapReport
  - Fields: missingUcIds[], missingSignals[], requiredInputs[],
    mitigationSteps[], ownerHint, priority.
  - Purpose: force explicit planning for missing knowledge.

- WorkflowTemplate
  - Fields: id, steps[], ucRequirements[], expectedOutputs,
    evidenceThresholds[], runbookLink.
  - Purpose: standardized workflow reference without locking process.

- WorkflowRunRecord
  - Fields: templateId, inputs, outputs, evidencePackIds[],
    passFail, timestamps, operator.
  - Purpose: regression + audit evidence for workflows.

### Context Pack Schema (Minimum)
- packId, targetId, targetType, summary, evidenceRefs[],
  confidence { overall, bySection }, createdAt, freshness,
  relatedFiles[], defeaters[], provenance.
- Context packs must be versioned and invalidated on file changes.

### Evidence and Traceability Rules
- Every semantic statement must cite evidence refs.
- Evidence refs must include file path + line range + checksum or hash.
- Evidence refs must record provider + model metadata for audits.
- Defeaters must be recorded when evidence conflicts or is stale.

### Provider and Model Policy Integration
- Daily model selection is a preflight step for every run.
- Provider checks are mandatory before any LLM or embedding call.
- If a provider is unavailable, emit `unverified_by_trace(provider_unavailable)`.
- LiBrainian defaults to Haiku-class for cost efficiency unless proven insufficient.

## Pipeline Implementation Details (Required)

### Ingestion Pipeline (Code + Docs + Config)
Sequence:
1) File discovery -> language detection -> scope classification.
2) Parser registry selection (language adapter resolution).
3) Static extraction (symbols, imports, call edges, configs).
4) LLM extraction (purpose, behavior, constraints) where needed.
5) Storage of entities, relations, and evidence.
6) Emit ingestion events + update index state.

Requirements:
- No language assumptions; detection triggers adapter onboarding.
- All extraction steps emit evidence and traceability metadata.
- Failures mark knowledge as stale, not valid.

### Language Onboarding Pipeline (Immediate)
Sequence:
1) Detect unknown language by file signatures.
2) Register adapter stub with minimal parse + file classification.
3) Acquire parsing strategy (tree-sitter/AST/regex baseline) + update registry.
4) Reindex affected files and generate language-specific metadata.
5) Update language coverage ledger (evidence + limitations).

Requirements:
- Must complete within same bootstrap run when possible.
- If parser unavailable, fall back to best-effort extraction with explicit gaps.
- Emit GapReport if full semantic extraction cannot be achieved.

### Understanding Pipeline (LLM-Required)
Sequence:
1) Assemble evidence (code, docs, tests, configs, commits).
2) LLM syntheses: purpose, mechanism, constraints, risks, invariants.
3) Generate knowledge mappings (ownership, dataflow, dependency, risk).
4) Store context packs with confidence + defeaters.
5) Emit understanding events for indexing and audit.

Requirements:
- Semantic understanding must be LLM-generated.
- Confidence must be calibrated and validated.
- Conflicting claims must produce defeaters, not overrides.

### Retrieval + Query Pipeline
Sequence:
1) Resolve intent and UC requirements.
2) Generate query embedding (LLM intents only, embeddings via providers).
3) Candidate search (semantic + graph + co-change signals).
4) Multi-signal scoring + rerank with cross-encoder.
5) Context pack ranking and evidence pack assembly.
6) Gap detection if UC coverage incomplete.

Requirements:
- Query results must include confidence + defeaters + evidence.
- If index not ready, wait or fail with explicit reason.
- Coverage gaps are mandatory when UC requirements are unmet.

### Method Hinting + Preload Pipeline
Sequence:
1) Derive method needs from UC requirements and task context.
2) Build method knowledge packs (evidence, constraints, steps, pitfalls).
3) Generate method hints/checklists for agents.
4) Preload or cache hints when cost-effective (dynamic budgeting).
5) Attach method hints to context packs or return as separate bundles.

Requirements:
- Hints must be grounded in LiBrainian knowledge and evidence.
- Preloading is opportunistic and budget-aware, not fixed.
- Missing method support emits GapReport with required inputs.

### Feedback + Learning Pipeline
Sequence:
1) Capture agent feedback + outcomes.
2) Update knowledge artifacts and confidence.
3) Record evidence of corrections and discrepancies.
4) Trigger reindex if drift or invalidation is detected.

Requirements:
- Feedback must be traceable and attributed to a workflow run.
- No silent overwrites; version knowledge artifacts.

## Work Process Integration (Operational Spec)

### Workflow Hook Contract
- Pre-task: create ContextPackRequest + UCRequirementSet.
- Mid-task: re-query if gaps or contradictions appear.
- Post-task: emit feedback + update knowledge + record WorkflowRunRecord.

### Agent Context Assembly
- Agents must request context via LiBrainian, not ad-hoc search.
- Responses must be evidence-backed; no freeform speculation.
- If UC coverage is partial, agent must surface gaps explicitly.

### Orchestrator Integration
- Orchestrator accepts UC requirements and enforces evidence thresholds.
- Task scheduler uses LiBrainian signals (confidence, risk, freshness).
- Workspace lock + file watcher prevent stale reads and conflicting writes.

### External Project Integration
- Bootstrap + model selection run before any external project query.
- Workspace metadata stored separately per project.
- Provider and audit policies enforced uniformly.

## Testing and Evidence Gates (Implementation-Embedded)

### Tier-0 (Deterministic)
- Schema validation for context packs and evidence packs.
- Pipeline wiring tests for event emissions and storage writes.
- No provider bypass or fake embeddings.

### Tier-2 (Live Providers)
- Live bootstrap for LiBrainian repo (Haiku-class).
- Scenario runs for onboarding, change impact, security, refactor.
- Evidence pack completeness checks for semantic outputs.

### Tier-3 (Stress + Adversarial)
- Mixed-language repo bootstrap with onboarding mid-run.
- Multi-agent workflow simulation with conflict detection.
- Adversarial prompt suite for hallucination detection.

### Evidence Recording
- All Tier-2/3 results must be stored as audit artifacts.
- Failures must be recorded as unverified_by_trace with context.

## Implementation Checklist (Per Phase)
- Update docs first, then code, then tests, then audit artifacts.
- Each phase must update STATUS.md with evidence links.
- Each phase must include a live-provider run (Tier-2 or Tier-3).
- No phase proceeds without evidence artifacts.

## Storage and Indexing Requirements (Operational)
- Knowledge artifacts must be versioned with timestamps and source hashes.
- Index state must include phase, progress, and last successful run.
- Context packs must be invalidated when source files change.
- Evidence packs must be stored alongside context packs for audits.

## Observability and Audit Requirements
- Every pipeline emits events with correlation IDs.
- Audit logs capture provider/model metadata and timestamps.
- Drift detection triggers reindex or GapReport.

## Failure Semantics (Fail-Closed)
- Provider unavailable -> abort with unverified_by_trace.
- Missing evidence -> return GapReport instead of speculative output.
- Stale knowledge -> mark as invalid; force reindex or re-query.

## Failure Modes and Mitigations (Major)
- Provider/auth failures (CLI auth expired, rate limits, model removal) ->
  explicit gate errors + retry guidance + daily model drift checks.
- LLM hallucination or unsupported claims -> evidence-first responses +
  defeaters + adversarial audit prompts.
- Embedding mismatch (dimension/provider drift) -> strict validation + abort
  on non-Float32Array + audit logging.
- Indexing gaps (missing files, ignored paths, symlink loops) -> explicit
  include/exclude rules + loop detection + coverage audit.
- Language onboarding failure -> fallback extraction + GapReport + adapter
  queue + reindex on upgrade.
- Storage corruption or schema mismatch -> migration guard + backup + fail
  closed with recovery steps.
- Concurrency conflicts (multi-agent writes) -> workspace locks + file locks +
  conflict detection + retry scheduling.
- Evidence stale or contradictory -> invalidation + defeater storage +
  forced re-synthesis.
- Privacy/secret leakage -> redaction + evidence filtering + read policy
  enforcement with explicit block reasons.
- Performance/cost blowups -> token budgets + batch limits + dynamic preload
  throttling + partial execution with explicit gaps.
- Workflow bypass (agents skipping LiBrainian) -> enforce pre-task hooks +
  context assembly contract + audit for bypass events.
- Multi-vector drift or unused weights -> persist vector-kind metadata and
  wire weighted scoring by intent with explicit explanations.
- Knowledge summaries without evidence -> LLM summary schema with evidence refs
  and strict JSON parsing.
- Monorepo alias misses -> workspace detection + alias resolution in ingest.
- Method pack cache staleness -> TTL + preloading + cache audit in bootstrap.

## Implementation Blockers (Immediate)
These are known gaps that block full, reliable LiBrainian operation. They must
be resolved in Phase 1-3 before proceeding to scenario coverage claims.

- Knowledge map outputs not surfaced -> inject LLM summaries into context packs
  with evidence refs and map-code anchors.
- Multi-vector pipeline not integrated -> persist vectors + weighted scoring
  in the default query pipeline.
- Method pack preloading missing -> bootstrap preloads frequent families and
  records cache state for audits.
- Monorepo alias resolution missing -> workspace detection + alias resolver in
  ingest to avoid fractured dependency graphs.
- Persistent query cache not fully verified -> validate L2/SQLite cache path
  and add evidence checks to Tier-1.
- Bootstrap duration variability -> strengthen progress reporting and honor
  waiting-default policy while still completing.

## Edge Case Handling (Required)
- Very large monorepos (millions of files) -> staged bootstrap + sampling +
  prioritized indexing + progress checkpoints.
- Partial clones/submodules -> detect missing content + GapReport.
- Generated/vendor directories -> configurable exclude with audit.
- Binary or non-text files -> type detection + metadata-only indexing.
- Notebooks/markdown code blocks -> parse fenced code + track provenance.
- Mixed-language files and build tools -> multi-adapter routing + evidence.
- Repos without tests/docs -> gap surfaced + suggested knowledge tasks.
- Offline or restricted environments -> fail with provider_unavailable and
  explicit remediation steps.

## Implementation Sequencing Notes
- Implement and test provider gating before any pipeline changes.
- Ensure model policy enforcement before bootstrap or queries.
- Language onboarding must be tested before external repo adoption.
- Retrieval integration only after knowledge construction is stable.

## Live Validation Scheduling
- Daily: model selection + provider checks + minimal smoke validation.
- Weekly: full scenario suite + mixed-language bootstrap.
- Monthly: cross-repo stress run + adversarial prompt suite.

## Coverage Assurance (Use Cases + Methods)
- UC coverage baseline: `USE_CASE_MATRIX.md` (310 needs).
- Method coverage baseline: `USE_CASE_MATRIX.md` (integrated method catalog, 220+ methods).
- Each UC must map to at least one method family and pipeline stage.
- Each method must map to at least one UC cluster and scenario family.
- Coverage audits run in Tier-2 with live providers to detect gaps.

## Method Catalog Integration
- Use methods as a taxonomy for workflow templates and agent prompts.
- Methods drive scenario design in `scenarios.md`.
- Method coverage informs retrieval and understanding priorities.
- Method knowledge packs and hints are delivered with context packs.
- Dynamic preloading is enabled for high-frequency method clusters.

## Adaptability and Modularity Requirements
- Language adapters are plug-ins with stable interfaces and versioning.
- Signal providers (graph, co-change, rerank) are pluggable modules.
- Knowledge extractors are modular and independently testable.
- Workflow templates are data-driven and can be swapped without code changes.
- Configuration is centralized; no scattered flags or hidden defaults.

## Packaging and Injection Requirements
- Packaging and onboarding follow `PACKAGING_AND_ONBOARDING.md`.
- LiBrainian must be injectible without altering host repo structure.
- Minimal footprint with clean uninstall and no side effects.
- Onboarding must pass Tier-2 live provider validation.
