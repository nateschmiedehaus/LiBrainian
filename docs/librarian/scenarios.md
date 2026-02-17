# LiBrainian Scenarios (Use-Case Catalog)

Status: partial
Scope: exhaustive use-case coverage for agentic and human workflows.
Last Verified: 2026-01-04
Owner: librarianship
Evidence: docs only (implementation evidence lives in STATUS.md)

## Purpose
This catalog enumerates the real tasks a knowledge system must solve for any
codebase. Each scenario binds a question pattern to the knowledge mappings,
construction methods, and expected outputs.
Scenario coverage is anchored to `docs/LiBrainian/USE_CASE_MATRIX.md`;
each scenario should map to one or more UC IDs.

## Scenario Construction Model (Combinatorial Coverage)
Scenarios are generated from five axes to cover hundreds of thousands of needs.

Axes:
1) Objective: learn, change, fix, verify, optimize, secure, ship
2) Scope: entity, module, subsystem, repo, multi-repo
3) Constraint: time, risk, performance, security, compliance
4) Evidence: code, tests, docs, commits, runtime
5) Output: narrative, map, checklist, diff plan, risk matrix

Template:
"Given <scope>, help me <objective> under <constraint> using <evidence>, and
return a <output> with confidence and trace."

## Scenario Card Schema (Required)
Each scenario entry includes:
- ID + title
- Prompt template
- Required knowledge maps
- Required methods (static, semantic, historical, behavioral, LLM)
- Freshness thresholds and defeaters
- Output schema (answer + evidence + confidence + next actions)
- Validation hooks (deterministic + agentic)
- LLM mandate when understanding or analysis is required

## Coverage Expansion Dimensions
To reach real-world breadth, scenarios also vary by:
- Scale: tiny repo → monorepo → multi-repo federation.
- Language: single language → polyglot repos → unknown language with no adapter.
- Staleness: fresh index → drifted index → branch switch.
- Coordination: single agent → multi-agent conflict → human-in-loop.
- Messiness: legacy patterns, generated code, mixed conventions.

## Scenario Families (Operational)
| Family | Scenarios | Primary Subsystems |
| --- | --- | --- |
| Bootstrap and cold start | S1-S3 | Ingest, embeddings, model policy |
| Scale and performance | S4-S6 | Caching, batching, budgets |
| Language diversity | S7-S9 | Universal adapters |
| Staleness and drift | S10-S12 | Freshness, invalidation |
| Learning and attribution | S13-S15 | Learning engine, SBFL |
| Coordination | S16-S18 | Locks, workgraph |
| Messy codebases | S19-S21 | Pattern inference |
| External integration | S22-S24 | Boundary awareness |
| Recovery and safety | S25-S27 | Validation, rollback |
| Advanced reasoning | S28-S30 | Deep analysis |

## Core Scenario Categories
Each category includes a prompt template, required knowledge maps, and outputs.

### S-ONBOARD-001: Onboarding and Orientation
Prompt template: "Give me the fastest mental model of <module> and its role."
Required maps: architecture map, dependency map, ownership map
Expected output: module narrative, entry points, key risks

### S-LANG-001: New Language Onboarding
Prompt template: "Index and explain this <language> codebase immediately."
Required maps: identity map, structure map, dependency map
Expected output: adapter status, fallback coverage, explicit gaps, next steps

### S-LANG-002: Mixed-Language Integration
Prompt template: "Explain how <language A> and <language B> integrate."
Required maps: dependency map, data flow map, architecture map
Expected output: cross-language call paths, boundaries, risks

### S-SEARCH-001: Targeted Navigation
Prompt template: "Where is <behavior> implemented, and what calls it?"
Required maps: dependency map, data flow map
Expected output: ranked locations with evidence and call paths

### S-CHANGE-IMPACT-001: Change Impact
Prompt template: "If I change <entity>, what breaks and why?"
Required maps: change impact map, test coverage map
Expected output: impact list with tests, confidence, mitigation steps

### S-REFACTOR-001: Refactor Safety
Prompt template: "How do I refactor <module> without breaking contracts?"
Required maps: contract map, test coverage map, dependency map
Expected output: refactor plan, invariants, required tests

### S-BUG-TRIAGE-001: Bug Triage
Prompt template: "Trace the likely cause of <symptom> in <area>."
Required maps: data flow map, dependency map, history map
Expected output: candidate root causes with evidence and repro steps

### S-PERF-001: Performance Optimization
Prompt template: "Why is <flow> slow and what should I optimize first?"
Required maps: data flow map, structure map, history map
Expected output: bottleneck analysis, high-impact changes

### S-SEC-001: Security Review
Prompt template: "Map the attack surface for <feature>."
Required maps: security map, dependency map
Expected output: risk matrix, sensitive data paths, mitigations

### S-TEST-001: Test Gap Discovery
Prompt template: "What behavior in <module> is untested?"
Required maps: contract map, test coverage map
Expected output: missing tests list, priority, sample assertions

### S-DEP-001: Dependency Upgrade
Prompt template: "What breaks if we upgrade <dependency>?"
Required maps: dependency map, change impact map, history map
Expected output: affected entities, compatibility risks, test plan

### S-ARCH-DRIFT-001: Architecture Drift
Prompt template: "Where does implementation diverge from design?"
Required maps: architecture map, history map
Expected output: drift report with evidence and remediation steps

### S-OWNERSHIP-001: Ownership and Responsibility
Prompt template: "Who owns <module> and who should review changes?"
Required maps: ownership map, history map
Expected output: owners, reviewers, escalation paths

### S-RELEASE-001: Release Planning
Prompt template: "What is needed to ship <feature> safely?"
Required maps: change impact, risk, test coverage
Expected output: checklist, gating tests, risk notes

### S-COMPLIANCE-001: Compliance Readiness
Prompt template: "Does <flow> handle data per policy?"
Required maps: security map, data flow map
Expected output: compliance checklist, violations, fixes

### S-INCIDENT-001: Incident Response
Prompt template: "What recently changed in <area> before the outage?"
Required maps: history map, dependency map
Expected output: change timeline, suspect commits, rollback plan

### S-DOCS-001: Documentation Recovery
Prompt template: "Summarize <module> for a new engineer."
Required maps: architecture map, contract map
Expected output: narrative, examples, gotchas

### S-RATIONALE-001: Design Rationale Recovery
Prompt template: "Why was <design> chosen over alternatives?"
Required maps: rationale map, history map
Expected output: decisions, constraints, alternatives with evidence

### S-DATA-001: Data Model Change
Prompt template: "How will changing <schema> affect downstream?"
Required maps: data flow map, dependency map, test coverage map
Expected output: impact list, migrations, rollback strategy

### S-CI-001: Build and CI Failure
Prompt template: "Why did CI fail after <commit>?"
Required maps: history map, dependency map, test coverage map
Expected output: suspect changes, reproduction steps, fix options

### S-OBS-001: Observability Coverage
Prompt template: "Where do we lack logs or metrics in <flow>?"
Required maps: data flow map, structure map
Expected output: observability gaps, instrumentation plan

### S-MULTI-REPO-001: Cross-Repo Query
Prompt template: "Which repos call <API> and how?"
Required maps: dependency map across repos, ownership map
Expected output: cross-repo usage report, owners, risks

### S-DOMAIN-001: Domain Knowledge Extraction
Prompt template: "What domain concepts exist in <area>?"
Required maps: semantic map, documentation map
Expected output: glossary, concept graph, key rules

### S-RISK-001: Risk Scoring
Prompt template: "Which modules are highest risk and why?"
Required maps: risk map, history map, structure map
Expected output: ranked risk list, drivers, mitigation plan

### S-KNOW-GAP-001: Knowledge Gap Detection
Prompt template: "Where are we missing understanding?"
Required maps: confidence map, evidence map
Expected output: low-confidence zones, missing evidence

### S-COORD-001: Multi-Agent Task Handoff
Prompt template: "Create a task map for agents to implement <goal>."
Required maps: dependency map, ownership map, risk map
Expected output: task graph, sequencing, validation gates

## Representative Scenarios (S1-S30)
These capture the full legacy scenario set as succinct cards.

| ID | Scenario | Failure Mode | Required Subsystems |
| --- | --- | --- | --- |
| S1 | Monorepo workspace deps | Graph treats internal deps as external | Universal adapter, dependency resolver |
| S2 | Task before bootstrap complete | Partial results with high confidence | Freshness engine, index state |
| S3 | Non-TS project | No files indexed | Universal adapter, generic fallback |
| S4 | Query timeout on large repo | Full table scans | Scale engine, cache |
| S5 | Blast radius explosion | Exponential traversal | Graph cache, precompute |
| S6 | OOM during embeddings | Unbounded batch load | Streaming ingest, batching |
| S7 | Python/Django repo | Regex-only extraction | Multi-language AST |
| S8 | Rust project | Missing dependency graph | Multi-language AST |
| S9 | Mixed-language repo | Fragmented understanding | Universal adapter |
| S10 | Index stale by weeks | No staleness detection | Freshness engine |
| S11 | File moved/renamed | Ghost paths in results | Content identity, rename detection |
| S12 | Branch switch | Wrong-branch knowledge | Branch-aware indexing |
| S13 | Repeated failures same area | No learning loop | Learning engine, SBFL |
| S14 | Success after ignoring context | Wrong confidence update | Context usage tracking |
| S15 | Human corrections ignored | No feedback integration | Human feedback ingest |
| S16 | Two agents same file | Conflicting edits | Coordination, locks |
| S17 | Related tasks split | Context thrash | Task batching |
| S18 | Dependency not detected | Wrong task order | Dependency map |
| S19 | Mixed patterns | Inconsistent code | Pattern inference |
| S20 | Legacy + modern code | Bad pattern choice | Pattern inference |
| S21 | Inconsistent error handling | Wrong fixes | Pattern inference |
| S22 | Cross-service change | Hidden blast radius | Multi-repo awareness |
| S23 | External API integration | Missing contract | Contract map |
| S24 | DB schema change | Migration impact missed | Schema map |
| S25 | Agent breaks build | No rollback knowledge | Learning + recovery |
| S26 | Agent introduces security bug | No security signal | Security map |
| S27 | Rollback needed | No rollback plan | History + ops |
| S28 | Metaprogramming | AST gaps | Advanced parsing |
| S29 | Generated code | Noise in embeddings | Generated-code detection |
| S30 | Dynamic imports | Hidden dependencies | Runtime + static blend |

## Use-Case to Knowledge Domain Mapping
Every scenario must map to the knowledge domains in UNDERSTANDING_LAYER:
- At minimum: identity, semantics, relationships
- Usually: testing, risk, history
- Often: rationale, ownership, security, quality

## Scenario to Method Mapping
Each scenario must declare the minimum analysis methods:
- Static: AST + dependency graph (baseline for all)
- Semantic: embeddings + reranking (search and similarity)
- Historical: git + co-change (risk, ownership, incident)
- Behavioral: tests + runtime traces (contracts, reliability)
- LLM synthesis: purpose, rationale, and narrative synthesis

## Scenario Execution Contract
For each scenario category:
1) Required query intent(s) and knowledge maps.
2) Evidence types used and freshness thresholds.
3) Expected response schema (answer + trace + confidence + next actions).
4) Validation: deterministic test + agentic scenario run.

## Output Contract
Each response must include:
- Direct answer
- Evidence traces
- Confidence and caveats
- Next actions and tests

## Relationship to Legacy Scenarios
Detailed narratives and failure cases are archived in `docs/LiBrainian/legacy/scenarios.md`.
