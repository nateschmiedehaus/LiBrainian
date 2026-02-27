# LiBrainian Use-Case Matrix (Canonical)

Status: authoritative
Scope: Exhaustive UC-to-method coverage map for knowledge and understanding needs.
Last Verified: 2026-01-04
Owner: librarianship
Version: 1.1.0
Evidence: docs only (implementation evidence lives in STATUS.md)

## Related Documents

| Document | Relationship |
|----------|-------------|
| `SCHEMAS.md` | Type definitions for GapReport, UCRequirementSet |
| `STATUS.md` | Implementation tracking per UC |
| `UNDERSTANDING_LAYER.md` | Knowledge schema and confidence |
| `validation.md` | Test coverage per scenario |
| `scenarios.md` | Scenario definitions |

## Purpose
Provide a comprehensive, dependency-aware map of knowledge and understanding needs
for any codebase, project, or problem-solving context, and map each need to the
LiBrainian architecture and pipelines that satisfy it. This matrix is a core
contract: every row must be backed by LLM-derived understanding or explicitly
marked as planned.

## Non-Negotiables
- LLM understanding is mandatory for semantic claims; no non-LLM shortcuts.
- Dependencies must be explicit; layered needs reference prerequisite rows.
- Every row must cite architecture or planned architecture sections.
- Status must be accurate (verified, partial, planned) with evidence.
- Language support is immediate: new languages trigger onboarding flow.
- Method catalog is integrated below and must stay aligned with UC coverage.
- LiBrainian must supply method-ready knowledge and hints for all listed methods.
- Each UC inherits domain defaults (maps, methods, evidence, scenarios) unless explicitly overridden.
- UC coverage must be audit-ready against UC x Method x Scenario (see Coverage Audit Checklist).
- **Constructability rule**: each UC must be satisfiable by one or more **construction templates** (not bespoke endpoints). The mapping lives in the construction registry described in `docs/LiBrainian/specs/core/knowledge-construction.md`.

## Dependency Layers (Required)
Use-case coverage is layered. Dependencies flow from lower layers to higher layers.

| Layer | UC Range | Purpose |
| --- | --- | --- |
| L0 (Foundation) | UC-001-030 | Inventory, ownership, baseline structure and glossary |
| L1 (Structure) | UC-031-060 | Navigation, behavior, architectural structure |
| L2 (Change + Risk) | UC-041-170 | Impact, data, build/test, runtime, security, reliability |
| L3 (Coordination + Synthesis) | UC-171-260 | Language, multi-repo, product/project, agentic, synthesis |
| L4 (Context + Execution) | UC-261-310 | Token-budgeted repo maps, executable verification workflows, supply-chain/infra extensions |

## Knowledge Map Codes (Required)
Map codes reference the knowledge mappings in `docs/LiBrainian/UNDERSTANDING_LAYER.md`.

| Code | Map |
| --- | --- |
| MAP.ID | Identity map |
| MAP.STRUCT | Structure map |
| MAP.ARCH | Architecture map |
| MAP.DEP | Dependency map |
| MAP.FLOW | Data flow map |
| MAP.CONTRACT | Contract map |
| MAP.IMPACT | Change impact map |
| MAP.OWNER | Ownership map |
| MAP.RISK | Risk map |
| MAP.TEST | Test coverage map |
| MAP.PERF | Performance map |
| MAP.SEC | Security map |
| MAP.COMP | Compliance map |
| MAP.QUALITY | Quality map |
| MAP.EVOL | Evolution map |
| MAP.RATIONALE | Rationale map |
| MAP.RELEASE | Release readiness map |
| MAP.OBS | Observability map |
| MAP.CONFIG | Configuration map |
| MAP.BUILD | Build and CI map |
| MAP.RUNTIME | Runtime behavior map |
| MAP.DOCS | Documentation map |
| MAP.API | API and interface map |
| MAP.DATA | Data model map |
| MAP.PRODUCT | Product and requirements map |
| MAP.PROJECT | Project planning map |
| MAP.LANG | Language coverage map |
| MAP.AGENT | Agent coordination map |
| MAP.KNOW | Knowledge coverage and confidence map |

## Domain Defaults (Required)
Each UC inherits these defaults unless explicitly overridden in the row's Process column.

| Domain | Default Process | Default Maps | Default Method Families | Default Scenario Families |
| --- | --- | --- | --- | --- |
| Orientation | Discover -> ingest -> extract -> LLM synth -> context pack | MAP.ID, MAP.STRUCT, MAP.DEP | MF-01, MF-03, MF-10 | Bootstrap, onboarding |
| Architecture | Ingest -> graph -> infer -> LLM synth -> architecture map | MAP.ARCH, MAP.DEP, MAP.FLOW, MAP.CONTRACT | MF-03, MF-05, MF-04 | Architecture, drift |
| Ownership | Git ingest -> ownership infer -> LLM synth -> owner map | MAP.OWNER, MAP.EVOL | MF-10, MF-11, MF-01 | Ownership, escalation |
| Navigation | Query -> retrieve -> rerank -> LLM explain -> evidence pack | MAP.DEP, MAP.FLOW, MAP.STRUCT | MF-03, MF-04, MF-02 | Navigation, search |
| Impact | Graph + tests -> impact model -> LLM synth -> risk pack | MAP.IMPACT, MAP.TEST, MAP.RISK | MF-03, MF-04, MF-07 | Change impact |
| Behavior | Retrieve -> interpret -> LLM behavior -> contract map | MAP.CONTRACT, MAP.FLOW, MAP.RISK | MF-02, MF-04, MF-05 | Behavior, bugs |
| Data | Schema ingest -> flow map -> LLM synth -> data pack | MAP.DATA, MAP.FLOW, MAP.CONTRACT | MF-06, MF-04, MF-08 | Data changes |
| Build/Test | CI ingest -> test map -> LLM synth -> validation pack | MAP.BUILD, MAP.TEST | MF-09, MF-04 | Build, CI |
| Runtime | Observability ingest -> flow -> LLM synth -> runtime pack | MAP.RUNTIME, MAP.OBS | MF-07, MF-04, MF-10 | Runtime, ops |
| Performance | Perf signals -> model -> LLM synth -> perf pack | MAP.PERF, MAP.FLOW, MAP.RISK | MF-07, MF-04 | Performance |
| Security | Threat modeling -> LLM synth -> security pack | MAP.SEC, MAP.CONTRACT, MAP.RISK | MF-08, MF-04 | Security review |
| Compliance | Policy ingest -> flow map -> LLM synth -> compliance pack | MAP.COMP, MAP.SEC, MAP.FLOW | MF-08, MF-04, MF-09 | Compliance |
| Config | Config ingest -> resolution -> LLM synth -> config pack | MAP.CONFIG, MAP.RUNTIME | MF-10, MF-04, MF-09 | Config drift |
| Refactor | Impact + contract -> LLM plan -> refactor pack | MAP.CONTRACT, MAP.DEP, MAP.TEST | MF-05, MF-04, MF-01 | Refactor safety |
| API | Interface analysis -> LLM synth -> API pack | MAP.API, MAP.CONTRACT, MAP.DEP | MF-05, MF-03, MF-04 | API changes |
| Release | Release map -> LLM synth -> readiness pack | MAP.RELEASE, MAP.TEST, MAP.RISK | MF-09, MF-04 | Release planning |
| Reliability | Resilience signals -> LLM synth -> reliability pack | MAP.RISK, MAP.RUNTIME, MAP.OBS | MF-12, MF-07, MF-04 | Reliability |
| Language | Detect -> fallback -> LLM synth -> language pack | MAP.LANG, MAP.STRUCT | MF-03, MF-10, MF-01 | Language onboarding |
| Multi-Repo | Cross-repo ingest -> graph -> LLM synth | MAP.DEP, MAP.OWNER, MAP.API | MF-03, MF-05, MF-10 | Cross-repo |
| Product | Requirements -> flow map -> LLM synth -> product pack | MAP.PRODUCT, MAP.FLOW, MAP.RISK | MF-01, MF-10, MF-04 | Product mapping |
| Project | Dependency plan -> LLM synth -> project pack | MAP.PROJECT, MAP.DEP, MAP.RISK | MF-11, MF-01, MF-04 | Project planning |
| Agentic | Context -> policy -> LLM synth -> agent pack | MAP.AGENT, MAP.KNOW, MAP.RISK | MF-11, MF-10, MF-04 | Coordination |
| Documentation | Docs ingest -> compare -> LLM synth -> docs pack | MAP.DOCS, MAP.RATIONALE | MF-10, MF-04 | Docs recovery |
| Knowledge | Confidence -> coverage -> LLM synth -> audit pack | MAP.KNOW, MAP.EVOL | MF-10, MF-04 | Knowledge quality |
| Edge | Multi-signal -> LLM synth -> edge pack | MAP.RISK, MAP.TEST, MAP.OBS | MF-02, MF-04, MF-12 | Edge cases |
| Synthesis | Multi-map -> LLM synth -> synthesis pack | MAP.ARCH, MAP.RATIONALE, MAP.PRODUCT | MF-01, MF-05, MF-10, MF-04 | Advanced reasoning |

## Reference Legend (Architecture Citations)
Use these short codes in the matrix under the "Mechanisms" column.

- SYS.A = docs/LiBrainian/SYSTEM_ARCHITECTURE.md#System-Boundaries
- SYS.B = docs/LiBrainian/SYSTEM_ARCHITECTURE.md#Subsystem-Ownership-Map-Implementation-Targets
- SYS.C = docs/LiBrainian/SYSTEM_ARCHITECTURE.md#Language-Support-Architecture-Target
- SYS.D = docs/LiBrainian/SYSTEM_ARCHITECTURE.md#Engine-Toolkit-Canonical
- SYS.E = docs/LiBrainian/SYSTEM_ARCHITECTURE.md#Directory-Architecture-Current---Target
- PIPE.A = docs/LiBrainian/PIPELINES_AND_WIRING.md#1-ingestion-pipeline
- PIPE.B = docs/LiBrainian/PIPELINES_AND_WIRING.md#2-understanding-pipeline
- PIPE.C = docs/LiBrainian/PIPELINES_AND_WIRING.md#3-query-pipeline
- PIPE.D = docs/LiBrainian/PIPELINES_AND_WIRING.md#4-feedback-and-learning-pipeline
- UNDER.A = docs/LiBrainian/UNDERSTANDING_LAYER.md#universal-knowledge-schema-composed-domains
- UNDER.B = docs/LiBrainian/UNDERSTANDING_LAYER.md#understanding-mandate-llm-required
- UNDER.C = docs/LiBrainian/UNDERSTANDING_LAYER.md#evidence-and-defeaters
- SCEN.A = docs/LiBrainian/scenarios.md#scenario-card-schema-required
- VALID.A = docs/LiBrainian/validation.md#evidence-gates
- MODEL.A = docs/LiBrainian/MODEL_POLICY.md#daily-selection-procedure-required
- WORK.A = docs/LiBrainian/WORKPLAN.md#cross-phase-deliverables
- STATUS.A = docs/LiBrainian/STATUS.md#status

## Matrix Columns
- ID: Stable identifier (UC-###).
- Domain: Use-case domain.
- Need: The knowledge/understanding requirement.
- Dependencies: Other UC IDs required first.
- Process: How LiBrainian produces the knowledge (LLM + signals). Domain defaults apply.
- Mechanisms: Architecture references (legend codes).
- Status: verified | partial | planned.

## Use-Case Matrix
| ID | Domain | Need | Dependencies | Process | Mechanisms | Status |
| --- | --- | --- | --- | --- | --- | --- |
| UC-001 | Orientation | Inventory files, languages, build tools | none | LLM classifies indexed files and confirms language/tooling inventory | SYS.A PIPE.A UNDER.B | planned |
| UC-002 | Orientation | Identify repo entry points and main commands | UC-001 | LLM scans configs and scripts; synthesizes entrypoint map | SYS.A PIPE.A UNDER.A | planned |
| UC-003 | Orientation | Produce domain glossary from code and docs | UC-001 | LLM extracts terms and definitions with citations | PIPE.B UNDER.A UNDER.B | planned |
| UC-004 | Orientation | Detect primary runtime environments and targets | UC-001 | LLM infers runtime targets from configs and deploy files | SYS.A PIPE.A UNDER.B | planned |
| UC-005 | Orientation | Enumerate external services and dependencies | UC-001 | LLM derives service map from configs, clients, and infra | SYS.B PIPE.A UNDER.B | planned |
| UC-006 | Orientation | Map build/test entrypoints and scripts | UC-001 | LLM interprets package scripts and build pipelines | PIPE.A UNDER.B | planned |
| UC-007 | Orientation | Identify data stores and schema locations | UC-001 | LLM extracts storage systems and schema sources | SYS.E PIPE.A UNDER.A | planned |
| UC-008 | Orientation | Locate configuration sources and overrides | UC-001 | LLM traces config files, envs, and precedence rules | SYS.B PIPE.A UNDER.B | planned |
| UC-009 | Orientation | Detect critical paths and business flows | UC-002, UC-003 | LLM synthesizes from entrypoints and domain terms | SYS.D PIPE.B UNDER.B | planned |
| UC-010 | Orientation | Summarize repository purpose and scope | UC-003 | LLM generates high-level system summary with evidence | UNDER.A UNDER.C VALID.A | planned |
| UC-011 | Architecture | Produce component/module map | UC-001 | LLM clusters files into components with evidence | SYS.B SYS.D PIPE.B | planned |
| UC-012 | Architecture | Generate call graph and dependency graph | UC-001 | LLM aligns static analysis with semantic relations | SYS.D PIPE.B UNDER.B | planned |
| UC-013 | Architecture | Identify cross-cutting concerns (auth, logging) | UC-011 | LLM detects shared patterns and boundary layers | SYS.B PIPE.B UNDER.B | planned |
| UC-014 | Architecture | Map dataflow across components | UC-011, UC-012 | LLM infers dataflow and payload transitions | SYS.D PIPE.B UNDER.A | planned |
| UC-015 | Architecture | Document system boundaries and interfaces | UC-011 | LLM delineates internal vs external boundaries | SYS.A SYS.B UNDER.B | planned |
| UC-016 | Architecture | Classify architectural styles and constraints | UC-011 | LLM evaluates patterns (mono, micro, event) | UNDER.B VALID.A | planned |
| UC-017 | Architecture | Identify architectural risks and debt | UC-011 | LLM reviews coupling and drift signals | SYS.B PIPE.B UNDER.C | planned |
| UC-018 | Architecture | Map runtime topology (services, queues, jobs) | UC-005, UC-011 | LLM synthesizes infra configs and code usage | SYS.B PIPE.A UNDER.B | planned |
| UC-019 | Architecture | Align code structure to domain model | UC-003, UC-011 | LLM links domain glossary to components | SYS.D UNDER.A UNDER.B | planned |
| UC-020 | Architecture | Provide architecture decision history | UC-011 | LLM recovers ADRs and code evidence | PIPE.B UNDER.B VALID.A | planned |
| UC-021 | Ownership | Identify code owners and maintainers | UC-001 | LLM parses ownership files and commit history | PIPE.A UNDER.B | planned |
| UC-022 | Ownership | Map teams to components and domains | UC-021, UC-011 | LLM aligns ownership with component map | SYS.B UNDER.B | planned |
| UC-023 | Ownership | Detect orphaned or unowned areas | UC-021 | LLM flags missing ownership with evidence | UNDER.C VALID.A | planned |
| UC-024 | Ownership | Identify review paths and approval rules | UC-021 | LLM extracts review config and policy docs | PIPE.A UNDER.B | planned |
| UC-025 | Ownership | Map on-call and escalation paths | UC-021 | LLM extracts runbooks and pager policies | PIPE.B UNDER.B | planned |
| UC-026 | Ownership | Track expertise hotspots (subject matter) | UC-021, UC-003 | LLM infers expertise from docs and changes | UNDER.B UNDER.C | planned |
| UC-027 | Ownership | Identify code stewardship risks | UC-022 | LLM analyzes bus factor and churn | UNDER.C VALID.A | planned |
| UC-028 | Ownership | Determine compliance ownership boundaries | UC-022 | LLM maps compliance controls to teams | UNDER.B VALID.A | planned |
| UC-029 | Ownership | Map vendor and third-party ownership | UC-005 | LLM links external services to owners | SYS.B UNDER.B | planned |
| UC-030 | Ownership | Establish ownership change history | UC-021 | LLM synthesizes timeline from commits and docs | PIPE.B UNDER.C | planned |
| UC-031 | Navigation | Find canonical entrypoint for a feature | UC-002 | LLM traces feature references to entrypoints | PIPE.C UNDER.B | planned |
| UC-032 | Navigation | Locate definition and usage of a symbol | UC-001 | LLM combines index + semantics to find references | PIPE.C UNDER.B | planned |
| UC-033 | Navigation | Discover where config is consumed | UC-008 | LLM traces config keys to code usage | PIPE.C UNDER.B | planned |
| UC-034 | Navigation | Identify which files implement a behavior | UC-031 | LLM extracts behavior flow and cites files | PIPE.C UNDER.B | planned |
| UC-035 | Navigation | Locate tests covering a behavior | UC-034 | LLM maps behavior to test artifacts | PIPE.C UNDER.B | planned |
| UC-036 | Navigation | Surface cross-language integrations | UC-001, UC-005 | LLM traces interfaces across language boundaries | SYS.B PIPE.C | planned |
| UC-037 | Navigation | Find where errors are handled for a flow | UC-034 | LLM traces error paths and handlers | PIPE.C UNDER.B | planned |
| UC-038 | Navigation | Identify key extension points or plugins | UC-011 | LLM locates registries and extension interfaces | SYS.D PIPE.C | planned |
| UC-039 | Navigation | Map feature flags to code paths | UC-008 | LLM traces flags to guarded code | PIPE.C UNDER.B | planned |
| UC-040 | Navigation | Locate performance hotspots in code | UC-034 | LLM correlates metrics with code regions | PIPE.C UNDER.B | planned |
| UC-041 | Impact | Determine files impacted by a change | UC-012 | LLM uses dependency graph + semantics | PIPE.C UNDER.B | planned |
| UC-042 | Impact | Predict test impact of a code change | UC-041, UC-035 | LLM maps change to tests and risk | PIPE.C UNDER.C | planned |
| UC-043 | Impact | Identify downstream services impacted | UC-018 | LLM follows service graph and API usage | SYS.B PIPE.C | planned |
| UC-044 | Impact | Estimate API contract breakage risk | UC-012 | LLM compares schema/usage and flags risk | UNDER.C VALID.A | planned |
| UC-045 | Impact | Determine data migration requirements | UC-061 | LLM inspects schema evolution and usage | PIPE.C UNDER.B | planned |
| UC-046 | Impact | Identify security impact of changes | UC-101 | LLM maps change to threat surface | UNDER.C VALID.A | planned |
| UC-047 | Impact | Estimate performance impact of change | UC-091 | LLM maps code change to performance model | UNDER.C VALID.A | planned |
| UC-048 | Impact | Determine observability updates needed | UC-081 | LLM maps change to metrics/tracing | PIPE.C UNDER.B | planned |
| UC-049 | Impact | Identify user-facing behavior changes | UC-034 | LLM extracts functional deltas from code | UNDER.B UNDER.C | planned |
| UC-050 | Impact | Determine rollback strategy dependencies | UC-151 | LLM maps changes to deploy/rollback controls | PIPE.C UNDER.B | planned |
| UC-051 | Behavior | Explain a function or module behavior | UC-032 | LLM reads code and produces behavior summary | PIPE.C UNDER.B | planned |
| UC-052 | Behavior | Explain complex control flow and branches | UC-051 | LLM traces paths and conditions | PIPE.C UNDER.B | planned |
| UC-053 | Behavior | Identify invariants and preconditions | UC-051 | LLM infers invariants from code and tests | UNDER.B UNDER.C | planned |
| UC-054 | Behavior | Explain error handling strategy | UC-037 | LLM synthesizes error paths and policies | UNDER.B VALID.A | planned |
| UC-055 | Behavior | Explain concurrency model and locking | UC-051 | LLM analyzes threading/async patterns | PIPE.C UNDER.B | planned |
| UC-056 | Behavior | Summarize state transitions for a feature | UC-051 | LLM extracts state machine from code | UNDER.A PIPE.C | planned |
| UC-057 | Behavior | Identify side effects and external calls | UC-051 | LLM traces side effects and I/O | PIPE.C UNDER.B | planned |
| UC-058 | Behavior | Clarify failure modes and fallbacks | UC-051 | LLM enumerates failures from code paths | UNDER.C VALID.A | planned |
| UC-059 | Behavior | Explain integration behavior across modules | UC-012 | LLM aligns module interactions with behavior | PIPE.C UNDER.B | planned |
| UC-060 | Behavior | Explain behavior at runtime vs build time | UC-002 | LLM compares build and runtime flows | PIPE.C UNDER.B | planned |
| UC-061 | Data | Identify schema sources and versions | UC-007 | LLM enumerates schema files and versions | SYS.E PIPE.A | planned |
| UC-062 | Data | Explain data model entities and relations | UC-061 | LLM derives entity relationships | UNDER.A PIPE.B | planned |
| UC-063 | Data | Map data ownership and stewardship | UC-021, UC-061 | LLM aligns entities with owners | UNDER.B | planned |
| UC-064 | Data | Identify data lineage across pipeline | UC-062 | LLM traces data transformations | PIPE.B UNDER.B | planned |
| UC-065 | Data | Determine data validation rules | UC-061 | LLM extracts validation constraints | PIPE.B UNDER.B | planned |
| UC-066 | Data | Identify data retention and deletion rules | UC-061 | LLM inspects retention policies and code | UNDER.B VALID.A | planned |
| UC-067 | Data | Explain migration strategy and backfill | UC-061 | LLM synthesizes migrations and scripts | PIPE.B UNDER.B | planned |
| UC-068 | Data | Identify data quality risks | UC-064 | LLM evaluates checks and gaps | UNDER.C VALID.A | planned |
| UC-069 | Data | Map analytics and reporting outputs | UC-064 | LLM traces analytics pipelines | PIPE.B UNDER.B | planned |
| UC-070 | Data | Identify PII/PHI locations and handling | UC-061 | LLM classifies sensitive fields and usage | UNDER.C VALID.A | planned |
| UC-071 | Build/Test | Identify build steps and artifacts | UC-006 | LLM interprets build config and outputs | PIPE.A UNDER.B | planned |
| UC-072 | Build/Test | Map test suites to components | UC-035 | LLM aligns tests to module map | PIPE.C UNDER.B | planned |
| UC-073 | Build/Test | Identify test gaps by coverage and risk | UC-072 | LLM compares behavior map to tests | UNDER.C VALID.A | planned |
| UC-074 | Build/Test | Explain CI pipeline stages | UC-071 | LLM parses CI config and dependencies | PIPE.A UNDER.B | planned |
| UC-075 | Build/Test | Identify flaky tests and causes | UC-072 | LLM analyzes test history and patterns | UNDER.C VALID.A | planned |
| UC-076 | Build/Test | Recommend test additions for changes | UC-042 | LLM proposes tests based on impact | UNDER.B VALID.A | planned |
| UC-077 | Build/Test | Map build caches and invalidation rules | UC-071 | LLM inspects cache config and usage | PIPE.A UNDER.B | planned |
| UC-078 | Build/Test | Identify build reproducibility risks | UC-071 | LLM checks for nondeterminism | UNDER.C VALID.A | planned |
| UC-079 | Build/Test | Explain test data management | UC-072 | LLM traces fixtures and factories | PIPE.B UNDER.B | planned |
| UC-080 | Build/Test | Identify E2E test coverage for scenarios | UC-035 | LLM maps scenarios to E2E suites | SCEN.A VALID.A | planned |
| UC-081 | Runtime | Identify logging, metrics, and tracing coverage | UC-011, UC-018 | LLM inventories instrumentation and links to components | SYS.B PIPE.C UNDER.B | planned |
| UC-082 | Runtime | Map SLOs, SLIs, and health checks | UC-081 | LLM extracts SLO definitions and check wiring | PIPE.A UNDER.B | planned |
| UC-083 | Runtime | Locate dashboards and observability views | UC-081 | LLM discovers dashboards and maps to services | PIPE.B UNDER.B | planned |
| UC-084 | Runtime | Explain alert routing and escalation | UC-082, UC-025 | LLM traces alert configs to on-call paths | UNDER.B VALID.A | planned |
| UC-085 | Runtime | Link runtime errors to code owners | UC-081, UC-021 | LLM correlates error signatures to code and owners | PIPE.C UNDER.B | planned |
| UC-086 | Runtime | Determine resource usage by component | UC-081 | LLM links metrics to components and flows | PIPE.C UNDER.B | planned |
| UC-087 | Runtime | Trace request flow end-to-end | UC-018, UC-031 | LLM traces calls across services and layers | PIPE.C UNDER.B | planned |
| UC-088 | Runtime | Identify background jobs and schedules | UC-018 | LLM extracts cron and worker schedules | PIPE.A UNDER.B | planned |
| UC-089 | Runtime | Map feature usage analytics | UC-064 | LLM ties analytics events to features | PIPE.B UNDER.B | planned |
| UC-090 | Runtime | Detect observability coverage gaps | UC-081 | LLM compares expected vs actual signals | UNDER.C VALID.A | planned |
| UC-091 | Performance | Identify performance budgets and targets | UC-082 | LLM extracts targets from docs and configs | UNDER.B VALID.A | planned |
| UC-092 | Performance | Locate bottlenecks in critical paths | UC-087 | LLM correlates traces, code, and profiles | PIPE.C UNDER.B | planned |
| UC-093 | Performance | Explain memory usage drivers | UC-086 | LLM links memory metrics to code paths | PIPE.C UNDER.B | planned |
| UC-094 | Performance | Explain latency distribution and variance | UC-087 | LLM summarizes latency sources | UNDER.B UNDER.C | planned |
| UC-095 | Performance | Determine throughput limits and ceilings | UC-091 | LLM analyzes queues and resource ceilings | PIPE.C UNDER.B | planned |
| UC-096 | Performance | Document caching strategy and layers | UC-011 | LLM identifies cache usage and scope | PIPE.C UNDER.B | planned |
| UC-097 | Performance | Identify query optimization targets | UC-062 | LLM finds expensive queries and indexes | PIPE.C UNDER.B | planned |
| UC-098 | Performance | Explain concurrency and scaling constraints | UC-055, UC-018 | LLM maps locking/async to throughput | UNDER.B UNDER.C | planned |
| UC-099 | Performance | Map load test scenarios to system paths | UC-080 | LLM aligns load tests to critical flows | SCEN.A VALID.A | planned |
| UC-100 | Performance | Predict regression risk for performance | UC-047 | LLM projects changes onto budgets | UNDER.C VALID.A | planned |
| UC-101 | Security | Produce a threat model by component | UC-011, UC-018 | LLM identifies attack surfaces and assets | UNDER.B VALID.A | planned |
| UC-102 | Security | Explain authentication and authorization flow | UC-011 | LLM traces authn/authz path across layers | PIPE.C UNDER.B | planned |
| UC-103 | Security | Identify secrets storage and access paths | UC-008 | LLM tracks secrets from config to runtime | PIPE.C UNDER.B | planned |
| UC-104 | Security | Map input validation boundaries | UC-034 | LLM identifies validation points and gaps | PIPE.C UNDER.B | planned |
| UC-105 | Security | Identify dependency vulnerabilities | UC-001 | LLM aligns dependencies to CVE data | PIPE.B UNDER.B | planned |
| UC-106 | Security | Document encryption at rest and in transit | UC-061 | LLM verifies encryption usage in code/config | UNDER.B VALID.A | planned |
| UC-107 | Security | Assess audit logging coverage | UC-081 | LLM maps sensitive actions to audit logs | UNDER.C VALID.A | planned |
| UC-108 | Security | Map least privilege boundaries | UC-102 | LLM enumerates role permissions and scope | UNDER.B UNDER.C | planned |
| UC-109 | Security | Identify security testing gaps | UC-101, UC-072 | LLM compares tests to threat model | VALID.A UNDER.C | planned |
| UC-110 | Security | Prepare security incident response playbook | UC-101, UC-084 | LLM synthesizes runbooks and escalation | PIPE.B UNDER.B | planned |
| UC-111 | Compliance | Map compliance requirements to code areas | UC-011 | LLM links controls to components and data | UNDER.B VALID.A | planned |
| UC-112 | Compliance | Identify data residency and locality rules | UC-061 | LLM maps storage to region constraints | UNDER.B VALID.A | planned |
| UC-113 | Compliance | Map data retention and records policies | UC-066 | LLM aligns retention rules with storage | UNDER.B VALID.A | planned |
| UC-114 | Compliance | Verify open-source license obligations | UC-001 | LLM scans licenses and obligations | PIPE.A UNDER.B | planned |
| UC-115 | Compliance | Identify policy enforcement mechanisms | UC-111 | LLM maps controls to enforcement code | PIPE.C UNDER.B | planned |
| UC-116 | Compliance | Explain access review and approvals | UC-108 | LLM extracts approval flows and audit trails | UNDER.B VALID.A | planned |
| UC-117 | Compliance | Determine change management gates | UC-074 | LLM maps CI gating to compliance policy | PIPE.A UNDER.B | planned |
| UC-118 | Compliance | Perform privacy impact assessment | UC-070 | LLM synthesizes data use and privacy risks | UNDER.C VALID.A | planned |
| UC-119 | Compliance | Gather regulatory audit evidence | UC-111 | LLM collects evidence links for controls | VALID.A UNDER.C | planned |
| UC-120 | Compliance | Maintain governance risk register | UC-117 | LLM synthesizes risk list with owners | UNDER.C VALID.A | planned |
| UC-121 | Config | Explain config precedence rules | UC-008 | LLM infers override order and sources | PIPE.A UNDER.B | planned |
| UC-122 | Config | Map feature flag lifecycle states | UC-039 | LLM identifies flag states and owners | PIPE.C UNDER.B | planned |
| UC-123 | Config | Detect stale or dead flags | UC-122 | LLM identifies flags unused in code | PIPE.C UNDER.B | planned |
| UC-124 | Config | Identify config drift across environments | UC-008 | LLM compares environment configs | UNDER.C VALID.A | planned |
| UC-125 | Config | Separate secrets vs config responsibilities | UC-103 | LLM validates secret handling boundaries | UNDER.B VALID.A | planned |
| UC-126 | Config | Identify performance tuning knobs | UC-121 | LLM maps configs to performance behavior | PIPE.C UNDER.B | planned |
| UC-127 | Config | Determine safe defaults and fallbacks | UC-121 | LLM extracts defaults and documents rationale | UNDER.B UNDER.C | planned |
| UC-128 | Config | Detect runtime reload capabilities | UC-121 | LLM finds hot-reload paths and limitations | PIPE.C UNDER.B | planned |
| UC-129 | Config | Map rollout strategies to flag usage | UC-155 | LLM connects flag usage to rollout controls | PIPE.C UNDER.B | planned |
| UC-130 | Config | Identify config validation tests | UC-072 | LLM links config rules to tests | PIPE.C UNDER.B | planned |
| UC-131 | Refactor | Identify legacy hotspots and risk areas | UC-017 | LLM scores hotspots from change and complexity | UNDER.C VALID.A | planned |
| UC-132 | Refactor | Propose modularization seams | UC-012 | LLM infers seams from dependency graph | UNDER.B WORK.A | planned |
| UC-133 | Refactor | Identify deprecated or unused APIs | UC-141 | LLM tracks usage and deprecation markers | PIPE.C UNDER.B | planned |
| UC-134 | Refactor | Plan framework or library upgrades | UC-001 | LLM maps upgrade surface and blockers | WORK.A UNDER.B | planned |
| UC-135 | Refactor | Generate safe rename plan with tests | UC-041, UC-072 | LLM predicts impacts and tests | UNDER.C VALID.A | planned |
| UC-136 | Refactor | Reduce coupling between modules | UC-012 | LLM identifies tight coupling and proposals | UNDER.B WORK.A | planned |
| UC-137 | Refactor | Simplify complex logic and branches | UC-052 | LLM identifies complexity and alternatives | UNDER.B WORK.A | planned |
| UC-138 | Refactor | Improve testability of critical areas | UC-073 | LLM proposes seams and test hooks | UNDER.B WORK.A | planned |
| UC-139 | Refactor | Establish tech debt payoff order | UC-131 | LLM ranks debt by impact and risk | UNDER.C WORK.A | planned |
| UC-140 | Refactor | Provide modernization roadmap | UC-139 | LLM synthesizes phased plan | WORK.A VALID.A | planned |
| UC-141 | API | Inventory public endpoints and contracts | UC-011 | LLM extracts API definitions and schemas | PIPE.B UNDER.A | planned |
| UC-142 | API | Map internal API usage and consumers | UC-141 | LLM traces service-to-service calls | PIPE.C UNDER.B | planned |
| UC-143 | API | Identify backward compatibility constraints | UC-141 | LLM compares versions and usage | UNDER.C VALID.A | planned |
| UC-144 | API | Document error codes and semantics | UC-141 | LLM extracts error definitions and usage | PIPE.B UNDER.B | planned |
| UC-145 | API | Locate external integration points | UC-005 | LLM maps outbound integrations and contracts | PIPE.C UNDER.B | planned |
| UC-146 | API | Identify API versioning strategy | UC-141 | LLM determines versioning practices | UNDER.B VALID.A | planned |
| UC-147 | API | Map schema evolution and migrations | UC-141, UC-061 | LLM aligns API schema changes to data | PIPE.C UNDER.B | planned |
| UC-148 | API | Detect rate limits and quotas | UC-141 | LLM extracts rate limit logic | PIPE.C UNDER.B | planned |
| UC-149 | API | Identify client SDKs and usage | UC-145 | LLM maps SDK repos and usage | PIPE.B UNDER.B | planned |
| UC-150 | API | Identify API integration testing gaps | UC-141, UC-072 | LLM compares integrations to tests | VALID.A UNDER.C | planned |
| UC-151 | Release | Explain deployment pipeline | UC-074 | LLM parses deploy configs and stages | PIPE.A UNDER.B | planned |
| UC-152 | Release | Describe rollback strategies and triggers | UC-151 | LLM identifies rollback procedures and hooks | PIPE.A UNDER.B | planned |
| UC-153 | Release | Map environment promotion rules | UC-151 | LLM extracts promotion gates and dependencies | PIPE.A UNDER.B | planned |
| UC-154 | Release | Generate release notes from changes | UC-041 | LLM summarizes changes and impacts | PIPE.B UNDER.B | planned |
| UC-155 | Release | Identify feature rollout controls | UC-129 | LLM maps flags and rollout config | PIPE.C UNDER.B | planned |
| UC-156 | Release | Determine migration sequencing constraints | UC-067, UC-151 | LLM orders migrations with deploy steps | UNDER.B UNDER.C | planned |
| UC-157 | Release | Assess deployment risk per change | UC-041 | LLM combines impact, tests, and history | UNDER.C VALID.A | planned |
| UC-158 | Release | Identify canary or blue-green strategies | UC-151 | LLM extracts rollout patterns | PIPE.A UNDER.B | planned |
| UC-159 | Release | Map infrastructure-as-code to services | UC-018 | LLM links IaC definitions to services | PIPE.B UNDER.B | planned |
| UC-160 | Release | Document disaster recovery procedures | UC-151 | LLM compiles DR steps and dependencies | UNDER.B VALID.A | planned |
| UC-161 | Reliability | Identify failure domains and blast radius | UC-018 | LLM maps failure domains to service topology | SYS.B PIPE.C UNDER.B | planned |
| UC-162 | Reliability | Map retry, backoff, and timeout policies | UC-087 | LLM extracts retry logic and timeouts | PIPE.C UNDER.B | planned |
| UC-163 | Reliability | Identify circuit breakers and fallbacks | UC-058 | LLM detects breaker patterns and fallback paths | PIPE.C UNDER.B | planned |
| UC-164 | Reliability | Document error budgets and reliability targets | UC-082 | LLM extracts SLOs and budgets | UNDER.B VALID.A | planned |
| UC-165 | Reliability | Explain incident triage workflow | UC-084 | LLM synthesizes incident response steps | PIPE.B UNDER.B | planned |
| UC-166 | Reliability | Perform root cause analysis tracing | UC-087, UC-085 | LLM traces error to code and evidence | PIPE.C UNDER.B | planned |
| UC-167 | Reliability | Identify recovery checkpoints and backups | UC-160 | LLM maps backup/restore paths | PIPE.B UNDER.B | planned |
| UC-168 | Reliability | Identify chaos and resilience testing gaps | UC-164, UC-080 | LLM compares reliability needs to tests | VALID.A UNDER.C | planned |
| UC-169 | Reliability | Predict reliability regression risk | UC-166, UC-047 | LLM estimates risk from change + incidents | UNDER.C VALID.A | planned |
| UC-170 | Reliability | Explain degraded modes and feature sheds | UC-163 | LLM maps degraded behaviors and triggers | PIPE.C UNDER.B | planned |
| UC-171 | Language | Detect new language presence | UC-001 | LLM detects unfamiliar language files | SYS.C PIPE.A UNDER.B | planned |
| UC-172 | Language | Bootstrap parsing and indexing for new language | UC-171 | LLM selects tooling and schema adapters | SYS.C PIPE.A WORK.A | planned |
| UC-173 | Language | Extract language-specific semantics and AST | UC-172 | LLM integrates AST parsing with indexing | SYS.C PIPE.A UNDER.A | planned |
| UC-174 | Language | Map build/test tools for new language | UC-172 | LLM discovers language-specific build tools | SYS.C PIPE.A UNDER.B | planned |
| UC-175 | Language | Add language-specific lint and style rules | UC-172 | LLM derives or imports lint rules | SYS.C WORK.A | planned |
| UC-176 | Language | Integrate runtime/package manager metadata | UC-172 | LLM maps runtime and package managers | SYS.C PIPE.A UNDER.B | planned |
| UC-177 | Language | Map cross-language interfaces and types | UC-173, UC-036 | LLM aligns interface boundaries | SYS.C PIPE.C UNDER.B | planned |
| UC-178 | Language | Document language idioms used in codebase | UC-173 | LLM extracts idioms and common patterns | UNDER.B UNDER.C | planned |
| UC-179 | Language | Identify language-specific security risks | UC-173 | LLM maps known risk patterns | UNDER.C VALID.A | planned |
| UC-180 | Language | Validate language onboarding completeness | UC-173, UC-174 | LLM checks coverage vs language footprint | VALID.A UNDER.C | planned |
| UC-181 | Multi-Repo | Map dependencies across repositories | UC-005 | LLM builds cross-repo dependency graph | SYS.B PIPE.A UNDER.B | planned |
| UC-182 | Multi-Repo | Identify shared libraries and versions | UC-181 | LLM maps shared libs and versions | PIPE.A UNDER.B | planned |
| UC-183 | Multi-Repo | Track breaking changes across repos | UC-182 | LLM aligns version changes to consumers | PIPE.C UNDER.B | planned |
| UC-184 | Multi-Repo | Align API contracts across repos | UC-141, UC-181 | LLM compares API schemas and usage | PIPE.C UNDER.B | planned |
| UC-185 | Multi-Repo | Identify schema source of truth | UC-181, UC-061 | LLM finds canonical schema sources | UNDER.B UNDER.C | planned |
| UC-186 | Multi-Repo | Map build pipeline dependencies across repos | UC-181, UC-074 | LLM correlates CI pipelines | PIPE.A UNDER.B | planned |
| UC-187 | Multi-Repo | Detect duplicated functionality across repos | UC-181, UC-011 | LLM compares component purposes | UNDER.B UNDER.C | planned |
| UC-188 | Multi-Repo | Determine migration impact across repos | UC-183 | LLM estimates impact from dependency graph | PIPE.C UNDER.B | planned |
| UC-189 | Multi-Repo | Discover external specs or standards used | UC-181 | LLM extracts referenced specs/docs | PIPE.B UNDER.B | planned |
| UC-190 | Multi-Repo | Identify vendor lock-in and portability risk | UC-181, UC-005 | LLM evaluates external dependency risk | UNDER.C VALID.A | planned |
| UC-191 | Product | Map user stories to code paths | UC-003, UC-034 | LLM links requirements to code flows | PIPE.B UNDER.B | planned |
| UC-192 | Product | Identify missing requirement coverage | UC-191 | LLM compares requirements to code/test | UNDER.C VALID.A | planned |
| UC-193 | Product | Trace business metrics to implementation | UC-089 | LLM links metrics to code and flows | PIPE.C UNDER.B | planned |
| UC-194 | Product | Identify critical user journeys | UC-191 | LLM extracts key flows and dependencies | UNDER.B UNDER.C | planned |
| UC-195 | Product | Recover design constraints and assumptions | UC-020 | LLM synthesizes constraints from code/docs | PIPE.B UNDER.B | planned |
| UC-196 | Product | Determine SLA/SLO requirements by feature | UC-082, UC-191 | LLM maps SLOs to features | UNDER.B VALID.A | planned |
| UC-197 | Product | Identify UX expectations and behaviors | UC-191 | LLM interprets UI behavior and docs | PIPE.B UNDER.B | planned |
| UC-198 | Product | Map analytics events to requirements | UC-089, UC-191 | LLM aligns events to requirements | PIPE.C UNDER.B | planned |
| UC-199 | Product | Identify compliance requirements by feature | UC-111, UC-191 | LLM maps controls to features | UNDER.B VALID.A | planned |
| UC-200 | Product | Evaluate product risk for proposed change | UC-041, UC-191 | LLM estimates user impact and risk | UNDER.C VALID.A | planned |
| UC-201 | Project | Create milestone plan from dependencies | UC-140, UC-202 | LLM sequences work using dependency graph | WORK.A UNDER.C | planned |
| UC-202 | Project | Estimate effort and scope for change | UC-041 | LLM estimates based on complexity and history | UNDER.B UNDER.C | planned |
| UC-203 | Project | Identify blockers and prerequisites | UC-201 | LLM extracts blockers from dependency map | WORK.A UNDER.B | planned |
| UC-204 | Project | Sequence work for parallel teams | UC-201 | LLM decomposes work by ownership and deps | WORK.A UNDER.B | planned |
| UC-205 | Project | Map release train schedule and cutoffs | UC-151 | LLM aligns release cadence and constraints | WORK.A UNDER.B | planned |
| UC-206 | Project | Track progress vs roadmap | UC-140 | LLM compares actual progress to plan | WORK.A STATUS.A | planned |
| UC-207 | Project | Identify staffing and skill gaps | UC-022 | LLM maps required skills to ownership | UNDER.B WORK.A | planned |
| UC-208 | Project | Evaluate scope creep risk | UC-201 | LLM compares new work to roadmap scope | UNDER.C WORK.A | planned |
| UC-209 | Project | Build risk register for project plan | UC-201 | LLM consolidates risks and mitigations | UNDER.C WORK.A | planned |
| UC-210 | Project | Generate work breakdown structure | UC-201 | LLM expands milestones into tasks | WORK.A UNDER.B | planned |
| UC-211 | Agentic | Compose agent task context packs | UC-034, UC-010 | LLM assembles context pack with evidence | SYS.D PIPE.C UNDER.B | planned |
| UC-212 | Agentic | Determine tool permissions and guardrails | UC-211 | LLM maps task risk to tool policy | UNDER.C VALID.A | planned |
| UC-213 | Agentic | Route tasks to specialized agents | UC-211 | LLM matches tasks to agent skill profiles | SYS.D UNDER.B | planned |
| UC-214 | Agentic | Maintain shared memory across agents | UC-211 | LLM updates shared knowledge artifacts | SYS.D PIPE.D | planned |
| UC-215 | Agentic | Detect agent conflicts and overlap | UC-214 | LLM compares task graphs for conflicts | UNDER.C VALID.A | planned |
| UC-216 | Agentic | Verify agent outputs with evidence | UC-211 | LLM checks outputs against citations | VALID.A UNDER.C | planned |
| UC-217 | Agentic | Coordinate multi-step plans with dependencies | UC-211 | LLM manages plan graph and checkpoints | WORK.A UNDER.B | planned |
| UC-218 | Agentic | Ensure human-in-the-loop checkpoints | UC-212 | LLM enforces HITL gating | VALID.A WORK.A | planned |
| UC-219 | Agentic | Capture decisions and reasoning traces | UC-211 | LLM writes decision logs with evidence | PIPE.D UNDER.C | planned |
| UC-220 | Agentic | Evaluate agent performance and reliability | UC-216 | LLM summarizes performance metrics | UNDER.C VALID.A | planned |
| UC-221 | Documentation | Recover missing docs from code | UC-051 | LLM synthesizes docs from behavior | PIPE.B UNDER.B | planned |
| UC-222 | Documentation | Align documentation with implementation | UC-221 | LLM compares docs to code reality | UNDER.C VALID.A | planned |
| UC-223 | Documentation | Identify conflicting or redundant docs | UC-221 | LLM detects contradictions and overlaps | UNDER.C VALID.A | planned |
| UC-224 | Documentation | Document architecture decisions | UC-020 | LLM summarizes decisions with evidence | PIPE.B UNDER.B | planned |
| UC-225 | Documentation | Generate onboarding guide for new engineers | UC-010 | LLM composes guide from maps and flows | PIPE.B UNDER.B | planned |
| UC-226 | Documentation | Maintain canonical glossary and terms | UC-003 | LLM updates glossary with traceability | PIPE.B UNDER.C | planned |
| UC-227 | Documentation | Identify obsolete docs and references | UC-223 | LLM flags outdated docs vs code | UNDER.C VALID.A | planned |
| UC-228 | Documentation | Generate diagrams from code and flows | UC-012, UC-014 | LLM produces diagrams from maps | PIPE.B UNDER.B | planned |
| UC-229 | Documentation | Document integration contracts and SLAs | UC-145, UC-196 | LLM extracts contract details | PIPE.B UNDER.B | planned |
| UC-230 | Documentation | Explain rationale for tests and coverage | UC-072 | LLM ties tests to requirements | PIPE.B UNDER.B | planned |
| UC-231 | Knowledge | Capture feedback and update knowledge | UC-216, UC-238 | LLM ingests feedback and adjusts knowledge | PIPE.D UNDER.C | planned |
| UC-232 | Knowledge | Update knowledge after code changes | UC-041 | LLM re-indexes and revises knowledge | PIPE.D UNDER.B | planned |
| UC-233 | Knowledge | Version knowledge artifacts and traces | UC-231 | LLM snapshots knowledge versions | PIPE.D UNDER.C | planned |
| UC-234 | Knowledge | Detect stale knowledge items | UC-233 | LLM flags stale artifacts vs code | UNDER.C VALID.A | planned |
| UC-235 | Knowledge | Resolve conflicting knowledge claims | UC-234 | LLM adjudicates conflicts with evidence | UNDER.C VALID.A | planned |
| UC-236 | Knowledge | Track confidence shifts over time | UC-233 | LLM updates confidence metrics | UNDER.C VALID.A | planned |
| UC-237 | Knowledge | Integrate new data sources and signals | UC-231 | LLM ingests new sources into indexes | PIPE.A PIPE.D | planned |
| UC-238 | Knowledge | Evaluate knowledge quality and coverage | UC-234 | LLM scores coverage vs use cases | UNDER.C VALID.A | planned |
| UC-239 | Knowledge | Trigger re-index on drift detection | UC-234 | LLM initiates re-index for drift | PIPE.D VALID.A | planned |
| UC-240 | Knowledge | Run agentic audits and evidence packs | UC-238 | LLM generates audit artifacts | VALID.A UNDER.C | planned |
| UC-241 | Edge | Identify nondeterminism sources | UC-071, UC-162 | LLM locates nondeterministic code paths | UNDER.C VALID.A | planned |
| UC-242 | Edge | Map time-based behavior and timezone risks | UC-088 | LLM traces time usage and scheduling | PIPE.C UNDER.B | planned |
| UC-243 | Edge | Explain behavior under partial outages | UC-161, UC-170 | LLM simulates degraded paths | UNDER.B UNDER.C | planned |
| UC-244 | Edge | Detect configuration poisoning or invalid states | UC-121 | LLM validates config and guards | UNDER.C VALID.A | planned |
| UC-245 | Edge | Identify deprecated runtime or platform versions | UC-004 | LLM matches runtime versions to support policy | UNDER.B VALID.A | planned |
| UC-246 | Edge | Assess data corruption and integrity risks | UC-064, UC-068 | LLM analyzes validation and storage risks | UNDER.C VALID.A | planned |
| UC-247 | Edge | Evaluate third-party SLA failure impact | UC-005, UC-190 | LLM estimates impact of vendor outages | UNDER.C VALID.A | planned |
| UC-248 | Edge | Identify race conditions and concurrency hazards | UC-055 | LLM analyzes concurrency patterns | UNDER.B UNDER.C | planned |
| UC-249 | Edge | Locate silent error swallowing and ignored failures | UC-054 | LLM detects swallowed errors | PIPE.C UNDER.B | planned |
| UC-250 | Edge | Detect build/runtime feature drift | UC-060, UC-124 | LLM compares build outputs to runtime behavior | UNDER.C VALID.A | planned |
| UC-251 | Synthesis | Compare alternative architectures for goals | UC-011, UC-140 | LLM synthesizes alternative designs | UNDER.B WORK.A | planned |
| UC-252 | Synthesis | Derive formal invariants and constraints | UC-053 | LLM formalizes invariants for verification | UNDER.A UNDER.C | planned |
| UC-253 | Synthesis | Simulate change impact across scenarios | UC-041, UC-099 | LLM runs scenario-based reasoning | SCEN.A UNDER.B | planned |
| UC-254 | Synthesis | Conduct multi-agent design debate with evidence | UC-213 | LLM coordinates agentic debate with citations | PIPE.D VALID.A | planned |
| UC-255 | Synthesis | Generate analogical solutions from other domains | UC-251 | LLM maps analogies to architecture | UNDER.B UNDER.C | planned |
| UC-256 | Synthesis | Evaluate complexity metrics (coupling, modularity) | UC-012, UC-131 | LLM computes and interprets metrics | UNDER.C VALID.A | planned |
| UC-257 | Synthesis | Optimize retrieval and context assembly policies | UC-211 | LLM tunes retrieval with feedback | PIPE.D UNDER.C | planned |
| UC-258 | Synthesis | Build open-source contribution strategy | UC-140, UC-181 | LLM maps contribution surfaces and roadmap | WORK.A UNDER.B | planned |
| UC-259 | Synthesis | Evaluate model cost/performance tradeoffs | UC-091, UC-257 | LLM compares model policy to task needs | MODEL.A UNDER.C | planned |
| UC-260 | Synthesis | Benchmark LiBrainian against external systems | UC-238 | LLM compares quality metrics and gaps | VALID.A UNDER.C | planned |
| UC-261 | Agentic | Produce token-budgeted RepoMap pack (paths + key symbols) | UC-001, UC-011 | Deterministic structure inventory + token-budgeted map pack; disclose gaps/staleness | PIPE.A PIPE.C UNDER.A UNDER.C | planned |
| UC-262 | Agentic | Produce delta RepoMap since last run (what changed + why it matters) | UC-261, UC-061 | Compare git cursor/index snapshots; summarize deltas with evidence | PIPE.D UNDER.C VALID.A | planned |
| UC-263 | Agentic | Generate minimal edit context for a specific patch (edit-anchored pack) | UC-261, UC-032 | Assemble smallest sufficient context around target symbols + invariants | PIPE.C UNDER.B UNDER.C | planned |
| UC-264 | Agentic | Enforce content safety policy on packs (redaction + deny rules) | UC-070, UC-103 | Apply redaction policy to outbound evidence/packs; disclose blocked content | VALID.A UNDER.C | planned |
| UC-265 | Agentic | Explain “why these packs” (retrieval provenance and scoring disclosure) | UC-231 | Record retrieval trace + reasons; expose provenance to agent | PIPE.D UNDER.C VALID.A | planned |
| UC-266 | Agentic | Provide defeater-first summary for a claim (what could falsify it) | UC-235 | Surface active defeaters + “how to verify” checklist for each claim | UNDER.C VALID.A | planned |
| UC-267 | Agentic | Recommend next-best question to reduce uncertainty fastest | UC-238 | Use adequacy report + gap model to propose uncertainty-reducing queries | UNDER.B UNDER.C | planned |
| UC-268 | Agentic | Build task-memory pack from WorkGraph events (resume after interruption) | UC-217, UC-233 | Compile event stream + artifacts into a resumable context pack | WORK.A PIPE.D UNDER.C | planned |
| UC-269 | Agentic | Generate human review handoff pack (diff + rationale + verification status) | UC-216, UC-151 | Assemble change summary + DoD evidence + open risks for review | VALID.A WORK.A | planned |
| UC-270 | Agentic | Run in offline mode (deterministic-only) with explicit semantic blockers | UC-261 | Serve only deterministic maps/packs; semantic claims fail closed with reasons | UNDER.C VALID.A | planned |
| UC-271 | Agentic | Cache-control and freshness semantics (reuse vs recompute decisions) | UC-234 | Declare freshness window + invalidation rules; disclose reuse decisions | PIPE.D UNDER.C | planned |
| UC-272 | Agentic | Merge multi-agent knowledge updates safely (conflict-aware) | UC-214, UC-235 | Detect conflicting claims/edits; surface conflict objects instead of overwriting | WORK.A UNDER.C VALID.A | planned |
| UC-273 | Agentic | Tool-policy disclosure (what tools are allowed/blocked and why) | UC-212 | Provide a policy report per task (capabilities + constraints + remediation) | VALID.A WORK.A | planned |
| UC-274 | Agentic | Produce stable, replayable compressed context notes (citation-preserving) | UC-233 | Summarize with evidence refs; store as versioned pack; avoid uncited paraphrase claims | PIPE.D UNDER.C VALID.A | planned |
| UC-275 | Agentic | Compile a tool execution plan into WorkGraph tasks (safe actuation) | UC-217, UC-277 | Convert verification plan into work objects with explicit DoD obligations | WORK.A VALID.A | planned |
| UC-276 | Build/Test | Select impacted tests for a change (fast, honest test selection) | UC-072, UC-041 | Use test map + dependency map to propose minimal affected test set; disclose uncertainty | MAP.TEST MAP.DEP UNDER.C VALID.A | planned |
| UC-277 | Build/Test | Generate change-specific verification checklist (Definition of Done) | UC-041, UC-151 | Turn impact/risk map into explicit verifications and evidence obligations | WORK.A VALID.A UNDER.C | planned |
| UC-278 | Reliability | Minimize a failing reproduction (delta debugging for flaky/failing cases) | UC-166, UC-073 | Apply bisection/minimization over inputs/configs/commits; record evidence | PIPE.C VALID.A UNDER.C | planned |
| UC-279 | Reliability | Auto-bisect history to find regression introduction | UC-166, UC-061 | Use `git bisect` strategy + test command; produce replayable bisect report | PIPE.C VALID.A UNDER.C | planned |
| UC-280 | Reliability | Generate instrumentation plan (logs/metrics/traces) for debugging | UC-087, UC-081 | Recommend instrumentation points + expected signals; tie to hypotheses | UNDER.B UNDER.C VALID.A | planned |
| UC-281 | Build/Test | Produce reproducible reproduction script/environment steps | UC-074, UC-060 | Extract env requirements + deterministic steps; store as runnable artifact | PIPE.A VALID.A | planned |
| UC-282 | Build/Test | Detect and triage flaky tests (root causes + mitigations) | UC-071, UC-241 | Identify nondeterminism sources; propose stabilizations and quarantines | UNDER.C VALID.A | planned |
| UC-283 | Build/Test | Coverage-guided gap finding for a changed area | UC-072, UC-041 | Propose missing tests based on coverage and risk map; disclose heuristics | MAP.TEST MAP.RISK UNDER.C | planned |
| UC-284 | Build/Test | Verify change actually exercised (mutation sensitivity expectation) | UC-073 | Ensure tests fail if patched code is reverted; record evidence | VALID.A UNDER.C | planned |
| UC-285 | Performance | Triaging perf regressions with microbench selection and comparison | UC-091, UC-092 | Select representative benchmarks; compare runs; tie to code deltas | MAP.PERF UNDER.C VALID.A | planned |
| UC-286 | Security | Generate SBOM and map dependency usage to code paths | UC-005, UC-101 | Build SBOM + usage map; disclose unknown/proprietary deps | MAP.DEP MAP.SEC UNDER.C VALID.A | planned |
| UC-287 | Security | Detect dependency confusion/typosquatting risk in manifests | UC-005 | Analyze dependency names/registries; flag risk patterns with evidence | MAP.SEC UNDER.C VALID.A | planned |
| UC-288 | Compliance | Validate build provenance/attestations (SLSA-style) when present | UC-151 | Parse CI artifacts/attestations; disclose if unavailable | MAP.COMP UNDER.C VALID.A | planned |
| UC-289 | Compliance | Detect license-incompatible dependency tree for target distribution | UC-114, UC-286 | Combine SBOM + license obligations vs distribution target | MAP.COMP UNDER.C VALID.A | planned |
| UC-290 | Security | Detect secrets in git history and propose rotation + cleanup plan | UC-103, UC-061 | Scan history for secrets; propose remediation steps; record evidence | MAP.SEC VALID.A UNDER.C | planned |
| UC-291 | Product | Map third-party service quotas/SLAs into code constraints | UC-005, UC-247 | Extract quotas from docs/config; identify call sites and rate limiting | UNDER.B UNDER.C | planned |
| UC-292 | Security | Enforce dependency patch policy (outdated/high-risk deps) | UC-005, UC-101 | Compare versions to policy sources; disclose unknown versions | MAP.SEC MAP.RISK UNDER.C VALID.A | planned |
| UC-293 | Security | Generate threat-model pack (diagram + assumptions + coverage gaps) | UC-101, UC-111 | Construct threat model from maps; record assumptions and unknowns | MAP.SEC UNDER.C VALID.A | planned |
| UC-294 | Compliance | Produce audit evidence pack (SOC2-like) from repo artifacts | UC-111, UC-240 | Bundle controls→evidence mappings; disclose missing artifacts | MAP.COMP VALID.A UNDER.C | planned |
| UC-295 | Runtime | Map Kubernetes manifests to code/services (service→deployment→config) | UC-018, UC-121 | Parse k8s manifests; link to components and env config | SYS.B PIPE.A UNDER.B | planned |
| UC-296 | Runtime | Map IaC (Terraform/etc.) resources and blast radius to code ownership | UC-021, UC-295 | Parse IaC graph; link resources to owners and services | MAP.OWNER MAP.RISK UNDER.C | planned |
| UC-297 | Build/Test | Explain container build chain (Dockerfile stages, base image risk) | UC-074, UC-101 | Parse container build; surface supply-chain and caching risks | MAP.SEC MAP.RISK UNDER.C | planned |
| UC-298 | Build/Test | Explain reproducible build systems (Nix/Bazel) and build graph | UC-074 | Parse build configs; extract targets/deps; disclose unsupported tools | PIPE.A UNDER.B UNDER.C | planned |
| UC-299 | Build/Test | Triage CI failures with logs as evidence (when accessible) | UC-074, UC-166 | Ingest CI logs via adapter; map failure to code + remediation plan | PIPE.C UNDER.C VALID.A | planned |
| UC-300 | Config | Detect environment drift across dev/stage/prod configs | UC-008, UC-250 | Compare environment configs; surface drift and risk | MAP.RISK UNDER.C VALID.A | planned |
| UC-301 | Performance | Identify slow SQL queries and index opportunities from code/config | UC-064, UC-091 | Extract queries + schemas; propose indexes; disclose lack of runtime data | MAP.PERF UNDER.C | planned |
| UC-302 | Data | Review DB migration safety (online migration, rollback, backfill) | UC-068, UC-151 | Assess migration steps; propose safe sequence; tie to runbooks | MAP.RISK UNDER.C VALID.A | planned |
| UC-303 | Product | Map ML training/inference pipelines (dataset→model→serving) when present | UC-061, UC-069 | Extract ML pipeline structure; disclose unknown external datasets | UNDER.B UNDER.C | planned |
| UC-304 | Reliability | Map model/data drift monitoring to code and runbooks when present | UC-303, UC-081 | Link drift signals to alerts/runbooks; disclose if absent | MAP.OBS UNDER.C | planned |
| UC-305 | Performance | Analyze frontend bundle/perf risk (routes, dead code, tree-shaking) | UC-197, UC-091 | Parse bundler configs; surface perf risks and affected routes | MAP.PERF UNDER.C | planned |
| UC-306 | Compliance | Map accessibility requirements to UI code patterns and tests | UC-197, UC-230 | Identify a11y patterns + missing checks; disclose limitations | MAP.COMP UNDER.C VALID.A | planned |
| UC-307 | Product | Map i18n/localization keys to usage and missing translations | UC-221, UC-061 | Extract message catalogs and usages; disclose missing locales | UNDER.B UNDER.C | planned |
| UC-308 | API | Detect API contract diffs and consumer breakage risk (schemas, clients) | UC-141, UC-183 | Compare contract versions; map consumers; propose rollout plan | MAP.CONTRACT MAP.IMPACT UNDER.C | planned |
| UC-309 | Runtime | Link alerts/traces to runbooks and remediation steps | UC-082, UC-084 | Map observability signals to runbooks; disclose if no runbooks exist | MAP.OBS UNDER.C VALID.A | planned |
| UC-310 | Reliability | Validate disaster recovery readiness (backups, restore drills, RTO/RPO) | UC-161, UC-151 | Extract DR docs/config; produce verification plan; disclose unknowns | MAP.RISK UNDER.C VALID.A | planned |

## Problem-Solving Method Catalog (Integrated)
The method catalog is part of this file so use-case coverage and methods
remain aligned. Methods use the same mechanism codes as the UC matrix.

### Method Support Contract (Required)
- LiBrainian must provide the knowledge inputs needed to apply each method
  in any relevant scenario (evidence, constraints, risks, alternatives).
- LiBrainian must provide fast method hints and reminders to agents based on
  UC requirements and task context.
- Method hints should be preloaded when cheap and cached dynamically when
  usage frequency or workflow templates indicate value.
- If a method cannot be supported fully, emit a GapReport and mark coverage
  as partial with required inputs.

| ID | Method | Description | LiBrainian Support |
| --- | --- | --- | --- |
| M-001 | Problem framing | Define the problem boundary and desired outcome | UNDER.B PIPE.B |
| M-002 | Goal decomposition | Break objectives into sub-goals | UNDER.A WORK.A |
| M-003 | Constraint analysis | Identify hard and soft constraints | UNDER.B UNDER.C |
| M-004 | Assumption listing | Make implicit assumptions explicit | UNDER.B VALID.A |
| M-005 | Stakeholder mapping | Identify impacted parties and owners | PIPE.B UNDER.B |
| M-006 | System boundary mapping | Define internal vs external interfaces | SYS.A SYS.B |
| M-007 | Input-output tracing | Follow inputs to outputs through the system | PIPE.C UNDER.B |
| M-008 | 5 Whys | Iterative root cause questioning | UNDER.B VALID.A |
| M-009 | Fishbone analysis | Categorize causes by type | UNDER.B VALID.A |
| M-010 | Fault tree analysis | Trace failure paths logically | UNDER.B UNDER.C |
| M-011 | Hypothesis testing | Form, test, and refine hypotheses | UNDER.C VALID.A |
| M-012 | Differential diagnosis | Compare multiple causes in parallel | UNDER.B UNDER.C |
| M-013 | Counterfactual reasoning | Evaluate alternatives and what-ifs | UNDER.B UNDER.C |
| M-014 | Regression isolation | Identify changes that introduced defects | PIPE.C UNDER.B |
| M-015 | Bisection search | Halve the search space iteratively | PIPE.C UNDER.B |
| M-016 | Stack trace analysis | Analyze error stack and call path | PIPE.C UNDER.B |
| M-017 | Log forensics | Correlate logs to runtime behaviors | PIPE.C UNDER.B |
| M-018 | Metric correlation | Correlate metrics with events | PIPE.C UNDER.B |
| M-019 | Timeline reconstruction | Build a sequence of events | PIPE.B UNDER.B |
| M-020 | Change impact analysis | Predict downstream effects of change | PIPE.C UNDER.C |
| M-021 | Dependency tracing | Trace module and service dependencies | PIPE.C UNDER.B |
| M-022 | Graph traversal | Use graph structure to reason about paths | SYS.D PIPE.C |
| M-023 | Risk scoring | Quantify risk based on signals | UNDER.C VALID.A |
| M-024 | Evidence triangulation | Cross-check with multiple sources | UNDER.C VALID.A |
| M-025 | Confidence calibration | Adjust confidence using history | UNDER.C VALID.A |
| M-026 | Edge-case enumeration | Enumerate boundary conditions | UNDER.B UNDER.C |
| M-027 | Invariant discovery | Identify properties that must hold | UNDER.A UNDER.C |
| M-028 | Precondition analysis | Determine required inputs/state | UNDER.B UNDER.C |
| M-029 | Postcondition analysis | Determine expected outputs/state | UNDER.B UNDER.C |
| M-030 | Failure mode enumeration | List failure scenarios | UNDER.C VALID.A |
| M-031 | Replay analysis | Re-run with instrumentation | PIPE.C VALID.A |
| M-032 | Experiment design | Design tests to validate hypotheses | VALID.A UNDER.B |
| M-033 | Test gap analysis | Identify missing test coverage | VALID.A UNDER.C |
| M-034 | Coverage mapping | Map tests to code and behaviors | PIPE.C UNDER.B |
| M-035 | Code path tracing | Follow control flow for a scenario | PIPE.C UNDER.B |
| M-036 | Data lineage tracing | Trace data transformations | PIPE.B UNDER.B |
| M-037 | Schema evolution analysis | Track schema changes over time | PIPE.B UNDER.B |
| M-038 | Interface contract review | Validate API and data contracts | PIPE.B UNDER.B |
| M-039 | Protocol compliance check | Verify adherence to protocol specs | UNDER.B VALID.A |
| M-040 | Performance profiling | Analyze time and resource usage | PIPE.C UNDER.B |
| M-041 | Bottleneck localization | Identify throughput constraints | UNDER.B UNDER.C |
| M-042 | Load modeling | Model expected load and capacity | UNDER.B UNDER.C |
| M-043 | Latency decomposition | Break down latency contributors | PIPE.C UNDER.B |
| M-044 | Memory leak hunting | Identify unbounded memory growth | PIPE.C UNDER.B |
| M-045 | Concurrency hazard detection | Identify race conditions and deadlocks | UNDER.B UNDER.C |
| M-046 | Critical path analysis | Identify the longest execution chain | UNDER.B UNDER.C |
| M-047 | Resource contention analysis | Identify competing resource consumers | UNDER.B UNDER.C |
| M-048 | Cache behavior analysis | Evaluate caching layers and hit rates | PIPE.C UNDER.B |
| M-049 | Query optimization | Improve database/query efficiency | PIPE.C UNDER.B |
| M-050 | Static analysis review | Use static signals for defect discovery | PIPE.A UNDER.B |
| M-051 | Code smell detection | Identify maintainability issues | UNDER.B UNDER.C |
| M-052 | Complexity metric analysis | Evaluate coupling and cyclomatic complexity | UNDER.C VALID.A |
| M-053 | Modularization analysis | Identify boundaries and seams | UNDER.B WORK.A |
| M-054 | Refactor planning | Plan safe refactors with tests | UNDER.B WORK.A |
| M-055 | API versioning review | Assess compatibility and evolution | UNDER.B UNDER.C |
| M-056 | Backward compatibility analysis | Ensure consumers are safe | UNDER.C VALID.A |
| M-057 | Dependency upgrade planning | Plan upgrade paths and risks | UNDER.B WORK.A |
| M-058 | Compatibility matrix | Map versions and supported combos | UNDER.B VALID.A |
| M-059 | Security threat modeling | Identify assets, threats, mitigations | UNDER.B VALID.A |
| M-060 | Privilege boundary review | Evaluate least-privilege boundaries | UNDER.B UNDER.C |
| M-061 | Input validation review | Check validation at trust boundaries | PIPE.C UNDER.B |
| M-062 | Secrets exposure review | Identify secrets and access paths | PIPE.C UNDER.B |
| M-063 | Encryption verification | Verify encryption in transit/at rest | UNDER.B VALID.A |
| M-064 | Audit log coverage review | Ensure sensitive actions are logged | UNDER.C VALID.A |
| M-065 | Compliance mapping | Map controls to code and data | UNDER.B VALID.A |
| M-066 | Data residency mapping | Map storage locations to policy | UNDER.B VALID.A |
| M-067 | Retention policy evaluation | Evaluate retention and deletion | UNDER.B VALID.A |
| M-068 | Vulnerability scanning triage | Prioritize and mitigate vulnerabilities | UNDER.C VALID.A |
| M-069 | Incident postmortem analysis | Derive lessons and corrective actions | UNDER.B VALID.A |
| M-070 | Runbook verification | Validate operational procedures | VALID.A UNDER.B |
| M-071 | Release readiness review | Validate release criteria | UNDER.B VALID.A |
| M-072 | Rollback strategy analysis | Determine safe rollback steps | UNDER.B UNDER.C |
| M-073 | Canary analysis | Evaluate canary deployment strategy | UNDER.B UNDER.C |
| M-074 | Feature flag analysis | Track flag usage and lifecycle | PIPE.C UNDER.B |
| M-075 | Build reproducibility check | Validate deterministic builds | UNDER.C VALID.A |
| M-076 | CI pipeline audit | Verify stages and gating | PIPE.A UNDER.B |
| M-077 | Test data management review | Ensure test data adequacy | PIPE.B UNDER.B |
| M-078 | Flaky test diagnosis | Identify nondeterministic tests | UNDER.C VALID.A |
| M-079 | Integration testing gaps | Identify missing integration tests | UNDER.C VALID.A |
| M-080 | E2E scenario validation | Validate end-to-end flows | SCEN.A VALID.A |
| M-081 | Dependency graph pruning | Reduce scope by pruning irrelevant nodes | PIPE.C UNDER.B |
| M-082 | Ownership triangulation | Determine responsible owners | PIPE.B UNDER.B |
| M-083 | ADR recovery | Extract architecture decisions from records | PIPE.B UNDER.B |
| M-084 | Design rationale extraction | Recover rationale from code and docs | PIPE.B UNDER.B |
| M-085 | Spec extraction | Derive implied specifications | UNDER.B UNDER.C |
| M-086 | Requirements traceability | Map requirements to code and tests | PIPE.B UNDER.B |
| M-087 | Regression risk scoring | Estimate regression risk with signals | UNDER.C VALID.A |
| M-088 | Codebase onboarding | Build a mental model of system | PIPE.B UNDER.B |
| M-089 | Knowledge gap detection | Identify missing knowledge artifacts | UNDER.C VALID.A |
| M-090 | Knowledge staleness detection | Identify stale knowledge items | UNDER.C VALID.A |
| M-091 | Data quality assessment | Evaluate data validity and checks | UNDER.C VALID.A |
| M-092 | Data integrity verification | Verify data consistency and constraints | UNDER.B VALID.A |
| M-093 | Data classification | Classify data sensitivity and type | UNDER.B UNDER.C |
| M-094 | Ownership risk assessment | Assess bus factor and stewardship | UNDER.C VALID.A |
| M-095 | Process bottleneck analysis | Identify slow or blocked processes | UNDER.B UNDER.C |
| M-096 | Workflow dependency mapping | Map task dependencies | WORK.A UNDER.B |
| M-097 | Scheduling optimization | Optimize task order and parallelism | WORK.A UNDER.C |
| M-098 | Decision log synthesis | Summarize key decisions and reasoning | PIPE.B UNDER.B |
| M-099 | Change request triage | Prioritize and scope change requests | UNDER.B UNDER.C |
| M-100 | Tradeoff analysis | Compare alternatives with constraints | UNDER.B UNDER.C |
| M-101 | Scenario planning | Plan for multiple future outcomes | UNDER.B UNDER.C |
| M-102 | Stress testing design | Design stress tests for systems | VALID.A UNDER.B |
| M-103 | Chaos testing | Inject faults to test resilience | VALID.A UNDER.B |
| M-104 | Feature lifecycle analysis | Track feature lifecycle states | PIPE.C UNDER.B |
| M-105 | Deprecation planning | Plan removal of legacy APIs | UNDER.B WORK.A |
| M-106 | Migration sequencing | Order migrations safely | UNDER.B UNDER.C |
| M-107 | Hotfix isolation | Isolate minimal fix for production | UNDER.B UNDER.C |
| M-108 | Minimal reproducible case | Create smallest repro | UNDER.B VALID.A |
| M-109 | Code ownership validation | Confirm ownership and review paths | PIPE.B UNDER.B |
| M-110 | Domain model synthesis | Derive domain entities and relations | UNDER.A PIPE.B |
| M-111 | Business rule extraction | Extract rules from code and tests | PIPE.B UNDER.B |
| M-112 | Test oracle definition | Define expected outcomes | UNDER.B VALID.A |
| M-113 | Operational readiness review | Check runbooks and monitoring | UNDER.B VALID.A |
| M-114 | Dependency provenance | Identify source and purpose of deps | PIPE.A UNDER.B |
| M-115 | License compliance review | Validate license obligations | PIPE.A UNDER.B |
| M-116 | Build artifact tracing | Trace built artifacts to sources | PIPE.A UNDER.B |
| M-117 | Release note generation | Generate release notes from changes | PIPE.B UNDER.B |
| M-118 | Release impact estimation | Estimate user impact of releases | UNDER.B UNDER.C |
| M-119 | Observability gap analysis | Identify missing metrics and traces | UNDER.C VALID.A |
| M-120 | Alert fatigue analysis | Evaluate alert quality and volume | UNDER.B UNDER.C |
| M-121 | Deployment risk analysis | Evaluate deployment risk and rollback | UNDER.C VALID.A |
| M-122 | Configuration drift detection | Detect config differences across envs | UNDER.C VALID.A |
| M-123 | Schema drift detection | Detect schema changes vs expectations | UNDER.C VALID.A |
| M-124 | Behavior drift detection | Detect behavior changes over time | UNDER.C VALID.A |
| M-125 | Model policy compliance | Validate model selection and usage | MODEL.A VALID.A |
| M-126 | Provider reliability analysis | Evaluate provider availability history | VALID.A UNDER.C |
| M-127 | Traceability matrix | Map artifacts to evidence | VALID.A UNDER.C |
| M-128 | Design pattern detection | Identify patterns and anti-patterns | UNDER.B UNDER.C |
| M-129 | Service boundary enforcement | Verify service boundaries | UNDER.B UNDER.C |
| M-130 | Contract testing | Validate contracts between services | VALID.A UNDER.B |
| M-131 | SLA adherence check | Verify SLA compliance | UNDER.B VALID.A |
| M-132 | Backpressure analysis | Evaluate queueing and backpressure | UNDER.B UNDER.C |
| M-133 | Load shedding analysis | Evaluate shed policies | UNDER.B UNDER.C |
| M-134 | Fault injection planning | Plan fault tests and expected outcomes | VALID.A UNDER.B |
| M-135 | Recovery time analysis | Evaluate recovery time objectives | UNDER.B UNDER.C |
| M-136 | Backup integrity verification | Validate backup and restore | VALID.A UNDER.B |
| M-137 | Cost profiling | Analyze infra and compute costs | UNDER.B UNDER.C |
| M-138 | Resource rightsizing | Recommend resource adjustments | UNDER.B UNDER.C |
| M-139 | API surface minimization | Reduce public surface area | UNDER.B UNDER.C |
| M-140 | Interface segregation | Split interfaces for cohesion | UNDER.B UNDER.C |
| M-141 | Cohesion analysis | Evaluate cohesion within modules | UNDER.C VALID.A |
| M-142 | Coupling analysis | Evaluate inter-module coupling | UNDER.C VALID.A |
| M-143 | Knowledge map alignment | Align maps with reality | UNDER.C VALID.A |
| M-144 | Evidence completeness audit | Verify evidence completeness | VALID.A UNDER.C |
| M-145 | Staleness scoring | Score staleness per artifact | UNDER.C VALID.A |
| M-146 | Trust calibration | Calibrate trust in sources | UNDER.C VALID.A |
| M-147 | Cross-language integration analysis | Analyze multi-language interfaces | PIPE.C UNDER.B |
| M-148 | API consumer mapping | Identify API consumers | PIPE.C UNDER.B |
| M-149 | API dependency risk | Evaluate consumer break risk | UNDER.C VALID.A |
| M-150 | Failure domain mapping | Map blast radius and domains | UNDER.B UNDER.C |
| M-151 | Security boundary analysis | Identify security boundaries | UNDER.B UNDER.C |
| M-152 | Threat surface mapping | Identify attack surfaces | UNDER.B UNDER.C |
| M-153 | Supply chain risk analysis | Evaluate third-party dependencies | UNDER.C VALID.A |
| M-154 | Secret rotation planning | Plan secret rotation strategies | UNDER.B UNDER.C |
| M-155 | Test isolation analysis | Evaluate test dependencies | UNDER.B UNDER.C |
| M-156 | Latency budget allocation | Allocate latency budgets to components | UNDER.B UNDER.C |
| M-157 | SLO burn analysis | Analyze burn rates and impact | UNDER.B UNDER.C |
| M-158 | Service degradation plan | Define degraded modes | UNDER.B UNDER.C |
| M-159 | Runtime behavior verification | Verify runtime vs expected behavior | UNDER.B VALID.A |
| M-160 | Parallelization analysis | Identify parallelizable work | UNDER.B UNDER.C |
| M-161 | Bottleneck queue analysis | Analyze queues and saturation points | UNDER.B UNDER.C |
| M-162 | Heuristic evaluation | Evaluate with expert heuristics | UNDER.B UNDER.C |
| M-163 | Cross-checking | Verify results with alternate method | UNDER.C VALID.A |
| M-164 | Red-team review | Adversarial review for flaws | VALID.A UNDER.C |
| M-165 | Falsification testing | Attempt to falsify claims | VALID.A UNDER.C |
| M-166 | Post-condition assertion | Assert expected postconditions | VALID.A UNDER.B |
| M-167 | Pre-flight validation | Validate prerequisites before action | VALID.A UNDER.B |
| M-168 | Resource budget planning | Plan time, memory, token budgets | UNDER.B UNDER.C |
| M-169 | Token budget optimization | Optimize context to fit budgets | UNDER.B UNDER.C |
| M-170 | Context distillation | Reduce context without losing meaning | UNDER.B UNDER.C |
| M-171 | Evidence prioritization | Rank evidence by reliability | UNDER.C VALID.A |
| M-172 | Confidence thresholding | Set thresholds for decision-making | UNDER.C VALID.A |
| M-173 | Mitigation planning | Define mitigations for risks | UNDER.B UNDER.C |
| M-174 | Uncertainty quantification | Quantify uncertainty in outputs | UNDER.C VALID.A |
| M-175 | Decision matrix | Evaluate options across criteria | UNDER.B UNDER.C |
| M-176 | Pareto analysis | Identify high-impact contributors | UNDER.B UNDER.C |
| M-177 | Sensitivity analysis | Test sensitivity to assumptions | UNDER.C VALID.A |
| M-178 | Scenario regression | Re-run scenarios after changes | SCEN.A VALID.A |
| M-179 | Cross-repo dependency analysis | Map dependencies across repos | PIPE.C UNDER.B |
| M-180 | Version skew analysis | Detect incompatible versions | UNDER.C VALID.A |
| M-181 | Build graph analysis | Analyze build graph for dependencies | PIPE.A UNDER.B |
| M-182 | Toolchain verification | Verify toolchain compatibility | UNDER.B UNDER.C |
| M-183 | Packaging audit | Verify packaging structure and metadata | UNDER.B VALID.A |
| M-184 | Installability testing | Validate install and bootstrap paths | VALID.A UNDER.B |
| M-185 | Onboarding UX review | Evaluate onboarding clarity and flow | UNDER.B UNDER.C |
| M-186 | Documentation quality audit | Evaluate doc consistency and coverage | VALID.A UNDER.C |
| M-187 | Trace coverage audit | Verify traceability for claims | VALID.A UNDER.C |
| M-188 | Evidence replay | Recompute evidence for verification | VALID.A UNDER.B |
| M-189 | Component ownership audit | Verify ownership vs code map | UNDER.B VALID.A |
| M-190 | Access control audit | Verify access boundaries and roles | UNDER.B VALID.A |
| M-191 | API schema conformance | Verify API schemas match usage | UNDER.B VALID.A |
| M-192 | Observability cost analysis | Evaluate cost of telemetry | UNDER.B UNDER.C |
| M-193 | Workflow latency analysis | Analyze time per workflow stage | UNDER.B UNDER.C |
| M-194 | External dependency resilience | Evaluate resilience to vendor outages | UNDER.C VALID.A |
| M-195 | Policy compliance audit | Ensure policies are enforced | VALID.A UNDER.C |
| M-196 | Feature parity analysis | Compare implementations across systems | UNDER.B UNDER.C |
| M-197 | Knowledge coverage scoring | Score coverage vs UC requirements | UNDER.C VALID.A |
| M-198 | Retrieval effectiveness analysis | Evaluate retrieval quality | UNDER.C VALID.A |
| M-199 | Rerank quality analysis | Evaluate cross-encoder impact | UNDER.C VALID.A |
| M-200 | Bias detection | Detect systematic bias in outputs | UNDER.C VALID.A |
| M-201 | Robustness testing | Test under perturbations and noise | UNDER.C VALID.A |
| M-202 | Failover simulation | Simulate provider outages | VALID.A UNDER.C |
| M-203 | Cold-start analysis | Evaluate performance with minimal data | UNDER.B UNDER.C |
| M-204 | Knowledge amortization | Reuse knowledge across tasks safely | UNDER.B UNDER.C |
| M-205 | Multi-agent coordination analysis | Evaluate coordination correctness | UNDER.B UNDER.C |
| M-206 | Conflict resolution analysis | Resolve conflicting outputs | UNDER.C VALID.A |
| M-207 | Decision provenance tracking | Track decision sources and lineage | UNDER.C VALID.A |
| M-208 | Explainability audit | Ensure outputs are explainable | UNDER.C VALID.A |
| M-209 | Scope creep detection | Detect expansion beyond planned scope | UNDER.C VALID.A |
| M-210 | Parallel system elimination | Detect redundant systems and retire | UNDER.B UNDER.C |
| M-211 | Process conformance check | Verify workflows follow policies | UNDER.B VALID.A |
| M-212 | Abstraction leakage analysis | Identify abstraction breaks | UNDER.B UNDER.C |
| M-213 | Interface contract drift | Detect drift between contract and code | UNDER.C VALID.A |
| M-214 | Tech debt triage | Prioritize debt items | UNDER.B UNDER.C |
| M-215 | Architectural fitness review | Evaluate alignment to principles | UNDER.B UNDER.C |
| M-216 | Emergent behavior detection | Detect unexpected system behavior | UNDER.C VALID.A |
| M-217 | Knowledge completeness proof | Prove coverage vs UC requirements | UNDER.C VALID.A |
| M-218 | Counterexample search | Find counterexamples to claims | VALID.A UNDER.C |
| M-219 | Knowledge pruning | Remove obsolete knowledge safely | UNDER.B UNDER.C |
| M-220 | Cross-domain analogy | Transfer insights from other domains | UNDER.B UNDER.C |

## Method Families (Mapping Aid)
Method families group related methods so coverage can be audited against
UC clusters without re-listing every method per row.

| Family | Focus | Method IDs |
| --- | --- | --- |
| MF-01 | Framing + planning | M-001-007, M-099-101, M-162, M-175-176 |
| MF-02 | Diagnostics + causality | M-008-020, M-026-031, M-108, M-218 |
| MF-03 | Dependency + graph reasoning | M-021-022, M-081, M-096, M-179-181, M-210 |
| MF-04 | Evidence + validation | M-023-025, M-032-035, M-050, M-080, M-087, M-112, M-127, M-144, M-155, M-159, M-163-167, M-171-174, M-177-178, M-187-188, M-195, M-217 |
| MF-05 | Architecture + design | M-051-058, M-105-107, M-128-142, M-148-149, M-196, M-212-215 |
| MF-06 | Data + schema | M-036-039, M-091-093, M-123, M-191 |
| MF-07 | Performance + scaling | M-040-049, M-131-138, M-156-158, M-161, M-192 |
| MF-08 | Security + compliance | M-059-068, M-151-154, M-190 |
| MF-09 | Delivery + operations | M-069-079, M-104, M-113-121, M-130, M-136, M-151-160, M-182, M-184 |
| MF-10 | Knowledge + trust | M-082-086, M-088-090, M-094, M-109-111, M-119-120, M-122, M-124, M-143-147, M-189-191, M-197-209, M-203-204, M-216, M-219-220 |
| MF-11 | Coordination + workflow | M-095-098, M-160, M-193, M-205-211 |
| MF-12 | Resilience + chaos | M-102-103, M-132-135, M-150, M-194, M-201-202 |
| MF-13 | Packaging + onboarding | M-183-186 |
| MF-14 | Model + provider governance | M-125-126, M-168-170 |

## UC-to-Method Mapping Appendix (Required)
Each UC cluster must map to at least one method family. Every UC inherits
the method families of its cluster unless explicitly overridden.

| UC Cluster | UC IDs | Method Families | Notes |
| --- | --- | --- | --- |
| Orientation | UC-001-010 | MF-01, MF-03, MF-10 | Repo comprehension + framing |
| Architecture | UC-011-020 | MF-03, MF-05, MF-04 | Structure + evidence |
| Ownership | UC-021-030 | MF-10, MF-11, MF-01 | Ownership + coordination |
| Navigation | UC-031-040 | MF-03, MF-04, MF-02 | Trace + validate |
| Impact | UC-041-050 | MF-03, MF-04, MF-07 | Change analysis |
| Behavior | UC-051-060 | MF-02, MF-04, MF-05 | Behavior + constraints |
| Data | UC-061-070 | MF-06, MF-04, MF-08 | Data + policy |
| Build/Test | UC-071-080 | MF-09, MF-04 | CI/test coverage |
| Runtime | UC-081-090 | MF-07, MF-04, MF-10 | Runtime signals |
| Performance | UC-091-100 | MF-07, MF-04 | Perf validation |
| Security | UC-101-110 | MF-08, MF-04 | Threat + evidence |
| Compliance | UC-111-120 | MF-08, MF-04, MF-09 | Policy + audits |
| Config | UC-121-130 | MF-10, MF-04, MF-09 | Config + drift |
| Refactor | UC-131-140 | MF-05, MF-04, MF-01 | Design + planning |
| API | UC-141-150 | MF-05, MF-03, MF-04 | Contracts + deps |
| Release | UC-151-160 | MF-09, MF-04 | Delivery + rollback |
| Reliability | UC-161-170 | MF-12, MF-07, MF-04 | Resilience + evidence |
| Language | UC-171-180 | MF-03, MF-10, MF-01 | Onboarding + semantics |
| Multi-Repo | UC-181-190 | MF-03, MF-05, MF-10 | Cross-repo reasoning |
| Product | UC-191-200 | MF-01, MF-10, MF-04 | Product mapping |
| Project | UC-201-210 | MF-11, MF-01, MF-04 | Scheduling + evidence |
| Agentic | UC-211-220 | MF-11, MF-10, MF-04 | Coordination + trust |
| Documentation | UC-221-230 | MF-10, MF-04 | Doc recovery |
| Knowledge | UC-231-240 | MF-10, MF-04 | Knowledge quality |
| Edge | UC-241-250 | MF-02, MF-04, MF-12 | Extreme cases |
| Synthesis | UC-251-260 | MF-01, MF-05, MF-10, MF-04 | Cross-domain reasoning |

## Coverage Audit Checklist (Required)

Every UC must be covered by at least one method family and one scenario.
This checklist is the human-readable companion to the formal audit in
`docs/LiBrainian/validation.md`.

Checklist:
- UC -> Method coverage exists (UC inherits a method family via its domain).
- UC -> Scenario coverage exists (scenario family mapped or explicit UC override).
- UC -> Evidence sources recorded (evidence pack, traces, provider).
- UC -> Confidence and defeaters surfaced in response.
- UC -> GapReport emitted when coverage is partial or missing.

---

## Measurement Framework per UC Cluster (Required)

Each UC cluster must have defined measurement criteria. Measurement replaces
binary pass/fail with continuous quality metrics.

### Cluster Measurement Targets

| UC Cluster | Primary Metric | Target | Secondary Metrics |
|------------|----------------|--------|-------------------|
| Orientation (UC-001-010) | Bootstrap coverage | ≥ 90% | Entity count, confidence mean |
| Architecture (UC-011-020) | Component accuracy | ≥ 80% | Graph completeness, orphan rate |
| Ownership (UC-021-030) | Owner attribution | ≥ 85% | Coverage %, staleness |
| Navigation (UC-031-040) | Recall@5 | ≥ 70% | Precision@5, nDCG |
| Impact (UC-041-050) | Change-impact Recall@10 | ≥ 60% | False positive rate |
| Behavior (UC-051-060) | Semantic accuracy | ≥ 75% | Contract coverage |
| Data (UC-061-070) | Schema coverage | ≥ 90% | Lineage completeness |
| Build/Test (UC-071-080) | Test mapping accuracy | ≥ 85% | Coverage correlation |
| Runtime (UC-081-090) | Observability coverage | ≥ 80% | Alert mapping accuracy |
| Performance (UC-091-100) | Bottleneck identification | ≥ 70% | Latency correlation |
| Security (UC-101-110) | Threat surface coverage | ≥ 90% | Vulnerability recall |
| Compliance (UC-111-120) | Control mapping | ≥ 95% | Evidence completeness |
| Config (UC-121-130) | Config tracing accuracy | ≥ 85% | Drift detection rate |
| Refactor (UC-131-140) | Safe refactor rate | ≥ 80% | Regression rate |
| API (UC-141-150) | Contract accuracy | ≥ 90% | Consumer mapping |
| Release (UC-151-160) | Deployment risk prediction | ≥ 75% | Rollback success |
| Reliability (UC-161-170) | Failure domain accuracy | ≥ 85% | Recovery prediction |
| Language (UC-171-180) | Onboarding completeness | ≥ 80% | Parser fallback rate |
| Multi-Repo (UC-181-190) | Cross-repo accuracy | ≥ 75% | Dependency mapping |
| Product (UC-191-200) | Requirement tracing | ≥ 70% | Coverage mapping |
| Project (UC-201-210) | Dependency accuracy | ≥ 80% | Effort correlation |
| Agentic (UC-211-220) | Context pack quality | ≥ 75% | Agent success rate |
| Documentation (UC-221-230) | Doc-code alignment | ≥ 80% | Staleness detection |
| Knowledge (UC-231-240) | Confidence calibration | ≤ 10% error | Gap detection rate |
| Edge (UC-241-250) | Edge case coverage | ≥ 70% | False positive rate |
| Synthesis (UC-251-260) | Cross-domain accuracy | ≥ 65% | Novelty score |

### Measurement Procedure per Cluster

```typescript
interface ClusterMeasurement {
  clusterId: string;           // e.g., "Orientation"
  ucRange: [number, number];   // e.g., [1, 10]

  // Primary metric
  primaryMetric: {
    name: string;              // e.g., "Bootstrap coverage"
    target: number;            // e.g., 0.90
    current: number;           // Measured value
    passing: boolean;          // current >= target
  };

  // Secondary metrics
  secondaryMetrics: Array<{
    name: string;
    value: number;
    trend: 'improving' | 'degrading' | 'stable';
  }>;

  // Per-UC breakdown
  ucBreakdown: Array<{
    ucId: string;
    metricValue: number;
    status: 'PASS' | 'FAIL' | 'PARTIAL';
    blockers?: string[];
  }>;

  // Measurement metadata
  measuredAt: string;          // ISO 8601
  sampleSize: number;
  confidence: number;          // 0.0-1.0
}
```

### Measurement Cadence

| Cluster Type | Frequency | Trigger |
|--------------|-----------|---------|
| Foundation (L0) | Every bootstrap | Bootstrap completion |
| Structure (L1) | Daily | Cron job |
| Change/Risk (L2) | On demand | Major changes |
| Synthesis (L3) | Weekly | Scheduled audit |

Audit artifact requirement:
- `state/audits/LiBrainian/coverage/uc_method_scenario_matrix.json`
- PASS/FAIL for every UC x method family x scenario mapping, with evidence links.

## PASS/FAIL Criteria (Required)

Each cell in the UC x Method x Scenario matrix must be evaluated using these criteria.

### PASS Criteria

A UC x Method x Scenario cell is marked PASS when ALL of the following are true:

1. **Knowledge Available**: LiBrainian can produce the knowledge required by the UC
2. **Method Supported**: LiBrainian provides inputs needed to apply the method
3. **Scenario Executed**: The scenario has been executed with real providers
4. **Evidence Captured**: EvidencePack.v1 artifact exists with:
   - `provider` and `modelId` fields populated
   - `promptDigest` and `responseDigest` for reproducibility
   - `timestamp` within freshness threshold (default: 7 days)
5. **Confidence Threshold Met**: Overall confidence >= 0.6
6. **No Active Defeaters**: No defeaters with severity >= "high" are active
7. **No Heuristic-Only**: Output was LLM-backed, not heuristic fallback

### FAIL Criteria

A cell is marked FAIL if ANY of the following are true:

1. **Knowledge Unavailable**: UC cannot be satisfied with current implementation
2. **Method Unsupported**: Required method inputs are missing
3. **Scenario Not Executed**: No evidence of execution
4. **Evidence Missing**: No EvidencePack.v1 or incomplete fields
5. **Low Confidence**: Overall confidence < 0.4
6. **Critical Defeater**: Active defeater with severity = "critical"
7. **Heuristic Only**: Output is heuristic-only, violating LLM mandate

### PARTIAL Criteria

A cell is marked PARTIAL when:

1. Some but not all PASS criteria are met
2. Confidence is between 0.4 and 0.6
3. Active defeaters exist but severity < "high"
4. Evidence exists but is stale (> 7 days)

### Audit Output Schema

```typescript
interface CoverageAuditCell {
  ucId: string;           // e.g., "UC-001"
  methodFamily: string;   // e.g., "MF-01"
  scenarioId: string;     // e.g., "bootstrap_success"
  status: 'PASS' | 'FAIL' | 'PARTIAL';
  evidence?: {
    packPath: string;     // Path to EvidencePack.v1
    confidence: number;
    defeaterCount: number;
    executedAt: string;   // ISO 8601
  };
  failureReasons?: string[];
  notes?: string;
}

interface CoverageAuditReport {
  kind: 'CoverageAuditReport.v1';
  schemaVersion: 1;
  generatedAt: string;
  scope: string;
  cells: CoverageAuditCell[];
  summary: {
    total: number;
    pass: number;
    fail: number;
    partial: number;
    coverage: number;     // pass / total
  };
}
```

## Dependency Validation Rules (Required)

Dependencies between UCs must be validated before execution. These rules ensure
correct ordering and prevent false positives from running UCs without prerequisites.

### Dependency Graph Rules

1. **Acyclicity**: The dependency graph must be acyclic. If A depends on B, B cannot depend on A.
2. **Transitivity**: If A depends on B and B depends on C, A implicitly depends on C.
3. **Layer Ordering**: UCs can only depend on same-layer or lower-layer UCs:
   - L3 can depend on L0, L1, L2, L3
   - L2 can depend on L0, L1, L2
   - L1 can depend on L0, L1
   - L0 can only depend on L0

### Dependency Validation Checks

Before executing a UC, validate:

```typescript
interface DependencyValidation {
  ucId: string;
  dependencies: string[];
  checks: {
    allDependenciesExist: boolean;      // All referenced UC IDs are valid
    noCycles: boolean;                  // No circular dependencies
    layerOrderValid: boolean;           // Dependencies respect layer ordering
    dependenciesSatisfied: boolean;     // All dependencies have PASS status
  };
  canExecute: boolean;                   // True only if all checks pass
  blockedBy?: string[];                  // UC IDs blocking execution
}
```

### Dependency Failure Handling

1. **Missing Dependency**: Emit `GapReport.v1` with `category: 'missing_dependency'`
2. **Cycle Detected**: Abort validation and emit error
3. **Layer Violation**: Warn but allow execution with note
4. **Dependency Not Satisfied**: Block execution, record blocker UCs

### Dependency Satisfaction States

| State | Definition | Action |
|-------|------------|--------|
| `satisfied` | Dependency UC has PASS status | Proceed |
| `partial` | Dependency UC has PARTIAL status | Warn, proceed with confidence penalty |
| `unsatisfied` | Dependency UC has FAIL status | Block, emit GapReport |
| `missing` | Dependency UC does not exist | Block, emit GapReport |

### Layer Integrity Check

Run before any coverage audit:

```bash
# Validate all dependencies respect layer ordering
npm run LiBrainian -- validate-deps --strict

# Output: DependencyValidationReport.v1 in state/audits/
```

## Document History

| Date | Version | Changes |
|------|---------|---------|
| 2026-01-08 | 1.2.0 | Added Measurement Framework per UC Cluster with 26 cluster measurement targets |
| 2026-01-04 | 1.1.0 | Added PASS/FAIL criteria, dependency validation rules, related docs |
| 2026-01-04 | 1.0.0 | Initial UC matrix with 260 UCs and 220 methods |
| 2026-01-25 | 1.2.0 | Expanded UC matrix to 310 UCs (L4: Context + Execution) and added construction-template constructability rule |

---

*This document is authoritative for LiBrainian use-case and method coverage.*
