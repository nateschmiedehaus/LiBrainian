# LiBrainian Work Plan

Status: partial
Scope: phases, dependencies, acceptance criteria, and evidence gates.
Last Verified: 2026-01-04
Owner: librarianship
Evidence: docs only (implementation evidence lives in STATUS.md)

## Guiding Rules
- No MVP shortcuts. Every phase has evidence gates.
- Provider checks are mandatory for live semantic behavior.
- Every claim must link to tests, traces, or audits.
- Doc updates precede implementation changes.
- Implementation sequencing follows `docs/LiBrainian/IMPLEMENTATION_INTEGRATION_PLAN.md`.

## Phase 0: Documentation Canon (Now)
Goal: single source of truth, coherent doc architecture, and complete research consolidation.
Acceptance:
- Canonical doc set exists with required headers and ownership boundaries.
- Directory architecture (docs + code) documented and aligned.
- Scenario taxonomy and understanding layer are defined and cross-linked.
- Use-case matrix (250+ needs) is authored with dependencies and citations.
- Problem-solving method catalog (200+) is authored and integrated into USE_CASE_MATRIX.md.
- Packaging/onboarding guide exists for injection into any repo.
- Legacy research integrated into canonical docs or archived with pointers.
- Full wiring inventory documented in PIPELINES_AND_WIRING.md.
- Retrieval method stack documented in UNDERSTANDING_LAYER.md.
- Language onboarding policy documented (immediate support).
- Open-source extension points documented.
Evidence:
- `docs/LiBrainian/DOCS_ARCHITECTURE.md`
- `docs/LiBrainian/SYSTEM_ARCHITECTURE.md`
- `docs/LiBrainian/UNDERSTANDING_LAYER.md`
- `docs/LiBrainian/scenarios.md`
- `docs/LiBrainian/USE_CASE_MATRIX.md`
- `docs/LiBrainian/PACKAGING_AND_ONBOARDING.md`

## Phase 1: Model Policy + Provider Gating
Goal: daily model selection and enforced provider readiness.
Dependencies: Phase 0.
Acceptance:
- Model policy documented and wired to runtime (daily fetch + audit).
- Provider check blocks runs when unavailable.
- LiBrainian defaults to cheapest SOTA tier (Haiku-class) unless proven insufficient.
- Provider unavailability errors include `unverified_by_trace(provider_unavailable)` and fail closed.
- Waiting is the default: no timeouts for required LLM operations unless explicitly configured.
Evidence gates:
- `docs/LiBrainian/MODEL_POLICY.md`
- `ensureDailyModelSelection()` writes audits in `state/audits/model_selection/`
- `checkAllProviders()` enforced before bootstrap and queries

## Phase 2: Core Pipelines + Event Wiring
Goal: single end-to-end wiring path with shared primitives and event bus.
Dependencies: Phase 1.
Acceptance:
- One query pipeline (normalize -> freshness -> lock -> execute -> confidence).
- One ingestion pipeline with shared primitives and event emission.
- Embedding pipeline uses EmbeddingService only (no mocks).
- Retrieval pipeline wires multi-vector, co-change, and rerank signals end-to-end.
- Multi-vector representations are persisted with vector-kind metadata and query-time weights.
- Storage schema supports understanding + maps + audits.
- Language onboarding pipeline wired (detect -> adapter -> fallback -> reindex).
- Parser registry provides fallback extraction for unknown languages (no hard fail; GapReport emitted).
- LLM-only parsing fallback for unknown languages (functions + dependencies; no regex).
- Co-change edges computed during bootstrap (not only via Wave0 integration).
- Engine toolkit results (relevance/constraints/meta) included in query responses.
- Persistent query cache wired (L2 + SQLite) and verified.
- Workspace-aware dependency resolution (monorepo aliases + package boundaries) wired into ingest and graph edges.
- Edge-case ingestion handled (symlinks, binary, vendor, partial clones).
Evidence gates:
- `docs/LiBrainian/PIPELINES_AND_WIRING.md`
- Wiring tests for event bus and query pipeline
- Storage migrations verified

## Phase 3: Agent + Orchestrator Integration
Goal: context assembly, scheduling, and multi-agent coordination are LiBrainian-driven.
Dependencies: Phase 2.
Acceptance:
- Context assembly uses LiBrainian queries with evidence and confidence.
- Scheduler uses semantic signals and expertise matching.
- File watcher triggers incremental reindex and context invalidation.
- Locks prevent multi-agent conflicts and stale writes.
Evidence gates:
- Integration tests for `preOrchestrationHook` and `enrichTaskContext`
- Agent pool/scheduler wiring verified against LiBrainian signals

## Phase 4: Knowledge Construction + Scenario Coverage
Goal: knowledge mappings and scenario responses are complete and tested.
Dependencies: Phase 3.
Acceptance:
- Knowledge mappings exist for all domains in UNDERSTANDING_LAYER.
- Understanding synthesis generates purpose/mechanism/contract with evidence.
- Scenario taxonomy has working query paths for high-priority cases.
- Use-case matrix rows map to scenarios or explicit planned coverage.
- Method hints are generated and attached for relevant UC requirements.
- Method pack cache and preloading are implemented for frequent methods.
- Knowledge gaps are surfaced with explicit next actions.
- LLM-backed rationale and security extraction used for semantic knowledge; heuristic-only outputs flagged partial.
- File and directory semantic extraction uses LLM (no heuristic-only fallbacks).
- New-language scenarios produce usable outputs with explicit gaps.
- Knowledge map outputs are included in context packs or knowledge sources.
- Knowledge-source summaries are LLM-synthesized and include evidence + map-code references.
Evidence gates:
- Scenario tests for onboarding, change impact, security, refactor, CI failures
- Understanding schema validation with evidence traces

## Phase 5: Validation + Operations
Goal: prove system correctness with deterministic and agentic tests and run reliably daily.
Dependencies: Phase 4.
Acceptance:
- Tier-0 deterministic gate passes.
- Agentic audits produce evidence or fail with unverified_by_trace.
- Daily model selection runs with logs.
- Staleness, locking, and recovery validated.
- Bootstrap timeout handling and recovery state validated (wait by default).
- Open-source governance published (extension points + contribution gates).
- Usability readiness: CLI errors and progress are actionable and consistent.
- Coverage audit emits UC x Method x Scenario matrix with explicit PASS/FAIL.
- Scenario output baselines include expected-vs-actual diff reports and stress-test traces.
Evidence gates:
- `docs/LiBrainian/validation.md`
- `docs/LiBrainian/AUDIT.md`
- Run logs in `state/audits/`
- Reliability metrics documented

## Failure Modes + Usability Risk Register (Required)
All high-risk failure modes must be mitigated in the phase listed. This table
is the authoritative "what can go wrong" register for implementation work.

| ID | Failure mode | Detection | Mitigation | Phase |
| --- | --- | --- | --- | --- |
| FM-01 | Provider auth miswired | Provider checks fail in live runs | Use `checkAllProviders()` and fail closed | 1 |
| FM-02 | Daily model selection missing | No audit record for date | Block bootstrap/query until selection | 1 |
| FM-03 | Mock/heuristic embeddings used | EmbeddingService bypass detected | Enforce EmbeddingService only | 2 |
| FM-04 | Partial index treated as complete | Index state incomplete | Wait by default, mark partial with gaps | 2 |
| FM-05 | New language hard-fails | Adapter registry miss | Fallback extraction + adapter queue | 2 |
| FM-06 | Query pipeline bypass | Direct storage access | Enforce single query pipeline | 2 |
| FM-07 | Event bus bypass | Missing event traces | Require event emission for mutations | 2 |
| FM-08 | Staleness undetected | Freshness checks missing | File watcher + invalidation | 2 |
| FM-09 | LLM output without evidence | Missing trace in response | Require evidence + defeaters | 3 |
| FM-10 | Engine results missing from responses | Empty engine payloads | Wire engine toolkit into query results | 2 |
| FM-11 | Method hints absent | UC requirement not satisfied | Method pack cache + hint injection | 4 |
| FM-12 | Confidence uncalibrated | False positives/negatives | Outcome-based calibration | 4 |
| FM-13 | Large repo timeout | Slow bootstrap/query | Batching + caches + progressive index | 5 |
| FM-14 | Generated/vendor noise | Index pollution | Exclude patterns + metadata-only ingest | 2 |
| FM-15 | External repo onboarding fails | Missing config + assumptions | Packaging/onboarding contract | 0 |
| FM-16 | Workflow mismatch as Wave0 evolves | Hardcoded workflow steps | UCRequirementSet + dynamic workflows | 3 |
| FM-17 | Ambiguous CLI errors | Non-actionable output | Actionable error contracts + runbooks | 5 |
| FM-18 | Evidence artifacts missing | No audit packs | Audit hooks + mandatory artifacts | 5 |
| FM-19 | Scenario expectations drift | No expected vs actual comparison | Scenario baselines + diff reports | 5 |
| FM-20 | Adaptive system regressions | No feedback loop | Outcome ingestion + confidence updates | 4 |
| FM-21 | LLM semantic extraction falls back to heuristics | LLM errors hidden | Fail closed with unverified_by_trace + GapReport | 4 |
| FM-22 | Unknown language indexing yields zero functions | Parser unavailable | LLM fallback parsing + onboarding queue | 2 |
| FM-23 | Co-change signals never computed | No temporal graph | Compute during bootstrap + audit | 2 |
| FM-24 | Method guidance lacks evidence | Static hints only | LLM method packs + cache | 4 |
| FM-25 | Knowledge maps missing from responses | Query lacks map outputs | Inject knowledge sources into responses | 4 |
| FM-26 | Waiting policy violated by timeouts | Premature aborts | Default no-timeout for LLM ops | 1 |
| FM-27 | Multi-vector embeddings unused | Retrieval scores ignore vectors | Persist + integrate multi-vector weights | 2 |
| FM-28 | Knowledge sources lack evidence | Summaries missing trace | Require LLM summary with evidence refs | 4 |
| FM-29 | Method pack cache thrash | Repeated LLM generation | Preload + TTL cache + budget gating | 4 |
| FM-30 | Monorepo aliases unresolved | Missing internal deps | Workspace-aware resolver in ingest | 2 |
| FM-31 | Coverage audit not enforced | PASS reported with FAIL rows | Strict coverage audit + CI gate | 5 |
| FM-32 | Knowledge sources bloat context | Token budget exceeded | Deduplicate + budget enforcement | 4 |
| FM-33 | Provider docs fetch stale | Daily selection uses old data | Snapshot provider docs daily + fail closed | 1 |
| FM-34 | LLM knowledge summary invalid | JSON parse failures | Strict JSON parsing + fail closed | 4 |
| FM-35 | Retrieval quality unmeasured | No recall@k metrics | Implement RetrievalQualityReport.v1 + test corpus | 5 |
| FM-36 | Confidence miscalibrated | Stated != empirical accuracy | Implement CalibrationReport.v1 + golden set | 5 |
| FM-37 | Non-deterministic indexing | Different results same input | Implement DeterminismProvenance.v1 + replay tests | 2 |
| FM-38 | Measurement infrastructure missing | No continuous quality tracking | Implement PerformanceReport.v1 + SLO dashboards | 5 |

## Gap Inventory (Legacy IDs -> Phases)
Legacy gap IDs are tracked here and mapped to phases. Status lives in STATUS.md.

| ID | Theme | Target Phase |
| --- | --- | --- |
| G1-G4 | Provider gating + auth wiring | Phase 1 |
| G5-G9 | Embedding pipeline + retrieval | Phase 2 |
| G10-G12 | Event bus + query pipeline | Phase 2 |
| G13-G17 | Knowledge maps + understanding synthesis | Phase 4 |
| G18-G21 | Agent integration + context assembly | Phase 3 |
| G22-G25 | Validation + audits | Phase 5 |
| R0-R3 | Auth wiring + batch embeddings + cache | Phase 1-2 |
| R4-R6 | Complexity + hierarchical memory | Phase 4-5 |
| R7-R10 | Multi-language AST + edge cases | Phase 4-5 |

## Cross-Phase Deliverables
- No fake embeddings; no bypass of provider gates.
- All knowledge claims trace to evidence.
- Consistent directory architecture aligned with SYSTEM_ARCHITECTURE.
- Daily model policy enforced before any bootstrap or query.
