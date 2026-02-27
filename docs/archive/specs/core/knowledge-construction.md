# Knowledge Construction System (Repo Knowledge Atlas)

Status: design (compiler + registry contract; wiring in progress)
Created: 2026-01-25
Scope: how LiBrainian constructs “anything an agent could want to know” about a repo with honesty, evidence, and replay.

This doc exists because “we have 310 use cases” is not enough unless the spec system also defines a **construction mechanism** that can reliably build and maintain the required knowledge per project and per agent session.

---

## Goal

Enable an agent working in any repo to obtain accurate, grounded answers about:
- relationships (calls/imports/flows/ownership/blast radius)
- functionality (what it does; where; why; invariants)
- problems (known failures, risks, tech debt, incidents)
- structure (modules, boundaries, configuration, build/CI)
- operations (deployments, runbooks, observability signals)

…with explicit disclosure whenever the system cannot justify a claim.

This is the contract that turns the spec system into “the world’s greatest knowledge tool” rather than a search engine:
- **no silent gaps**
- **no fake certainty**
- **everything replayable and verifiable**

Non‑negotiables (Wave0 constraints):
- **CLI auth only** for LLM access (`claude` / `codex` CLIs via provider gate). No API keys, no browser auth.
- **No fake embeddings**. If semantic vectors are required and unavailable, fail closed with `unverified_by_trace(provider_unavailable)` (or Tier‑1 skip).
- **No theater**. If a requirement is not observed (providers/index/ledger), the system must disclose it as unverified.

---

## Key idea: “100 things” collapse into a small number of canonical knowledge objects

Instead of trying to special-case 100+ questions, LiBrainian constructs and serves a small set of durable knowledge objects that answer those questions by composition.

### Canonical knowledge objects

- **RepoFacts**: stable repo metadata (languages, runtimes, build tools, entrypoints, configs, owners).
- **Maps**: structured relationships (dependency graph, call graph, data-flow sketch, ownership map, test map, risk map).
- **Claims**: atomic propositions (e.g., “service X calls Y”, “auth uses JWT in module Z”) linked to evidence + defeaters.
- **Packs**: delivery units for agents (context packs, task context packs) that include: grounded snippets, related files, defeaters, and verification plans.
- **Episodes/Outcomes**: what happened when an agent tried something (inputs, actions, results) used later for calibration and learning.

Important: most “best-in-class” code assistants ship a *repo map* (compact structural summary) to stay within context budgets.
In LiBrainian terms, that is a **Map** (e.g., `RepoMap` / `SymbolMap`) plus a `Pack` formatter that can emit:
- a *token-budgeted* structural overview (paths + key symbols + signatures),
- a *change-aware* delta summary (what moved since last run),
- and the *disclosure* of what parts are unindexed / stale.

Storage surfaces (intended):
- Project-scoped store (sqlite) for durable objects (facts/maps/claims/packs/episodes).
- Session/task-scoped artifacts for replay (work objects + evidence ledger).

---

## Agent ergonomics contract (non-awkward usage)

The spec system is explicitly **not** “an API surface where the agent must know which subsystem to call”.
Agents have bad memory and tight context budgets; LiBrainian must be usable as a single, reliable perception tool:

- Agent provides **intent** (natural language + optional hints like affected files, depth, token budget).
- LiBrainian returns:
  - the smallest sufficient set of **packs** to proceed,
  - a **repo map** when repo-scale orientation is needed,
  - an **adequacy report** describing coverage/freshness/blocked capabilities,
  - and a **verification plan** when the claim cannot be proven with current evidence.

Non-negotiable: the agent MUST NOT be required to “stitch together” dozens of micro-queries to do normal work.
Instead, LiBrainian compiles the intent into a construction template and executes it.

Canonical template contract:
- `docs/LiBrainian/specs/core/construction-templates.md`

---

## Construction templates (how we support UC scale without bespoke handlers)

Construction templates are the **anti-accretion mechanism**:
- UCs map to templates (reusable programs), not to bespoke endpoints.
- templates compile to canonical knowledge objects + adapter requirements + adequacy rules.
- adding a UC should rarely require new pipeline code; it should usually be a mapping change or a new map/pack type.

The canonical definition of templates, required output envelope, and mapping rules live here:
- `docs/LiBrainian/specs/core/construction-templates.md`

This doc focuses on the *construction model* (objects + adequacy + recording) rather than duplicating template inventories.

---

## Construction compiler (per query / per workflow)

Given a user/agent intent, LiBrainian must compile it into a **ConstructionPlan**:

1. **Interpret intent**
   - Map to UC IDs + scenario family when possible (canonical anchors):
     - `docs/LiBrainian/USE_CASE_MATRIX.md`
     - `docs/LiBrainian/scenarios.md`
2. **Determine required knowledge objects**
   - Which maps/facts are required to answer honestly?
   - Which are optional enrichments?
3. **Select methods and executors**
   - Choose deterministic parsers first (Tier‑0 capable).
   - Escalate to provider-backed synthesis only when needed and only with evidence/defeaters.
4. **Run construction and validate adequacy**
   - Produce an **Adequacy / Coverage** disclosure:
     - what corpus was scanned
     - what was skipped (generated/binary/unknown-language)
     - what is stale or partially indexed
5. **Emit answer + packs**
   - Grounded file/snippet references.
   - Defeaters attached when any precondition is unmet.
   - VerificationPlan attached when claims are not proven.
6. **Record**
   - Evidence ledger entries and (when available) task/work artifacts.
   - Episode/outcome records for later calibration.

This compiler is how the spec system indirectly enables “100 things”: it composes a small set of maps/claims/packs to answer many questions.

### Required outputs (contract)

Every construction run MUST produce (even on failure):
- **ConstructionPlan** (recorded): the compiled plan (required/optional objects, methods, capability requirements).
- **Adequacy report** (recorded + returned): coverage/staleness/limitations of the produced answer.
- **Knowledge object refs** (recorded): IDs/digests of created/updated facts/maps/claims/packs.
- **Disclosure**: any `unverified_by_trace(...)` blockers and how to remediate.

Minimum adequacy fields (v1 intent):
- `indexedCorpus`: include/exclude rules, file counts, language coverage.
- `skipped`: generated/binary/unparseable/timeout buckets.
- `freshness`: lastIndexAt, repoHeadSha (if git available), staleness reason.
- `semanticStatus`: whether semantic stages ran (providers available) or were blocked.

---

## Bootstrap constructor (per project)

On first run (or when stale), LiBrainian constructs a minimal “Repo Knowledge Atlas” baseline:

### L0 baseline (must exist before semantic claims)

- **Corpus inventory**: files, languages, generated/binary detection, excludes.
- **RepoFacts**:
  - package managers + lockfiles
  - build/test commands and CI entrypoints (from config + docs)
  - runtime versions and supported targets
  - ownership signals (CODEOWNERS, maintainers docs)
- **Structure map**: module boundaries + key entrypoints (best-effort, disclosed).

### Enrichment (budgeted, resumable)

- dependency/call graph (language adapters; disclosed gaps for unsupported languages)
- test map (test locations, runners, suites)
- risk map (heuristic signals + recorded incidents/outcomes)
- ops map (deployment manifests, runbooks, dashboards-as-files when present)

Bootstrap must be:
- resumable (one bad file doesn’t block)
- budgeted (scale-safe)
- truthful (marks partial corpora/staleness; no “complete” theater)

### Incremental refresh (required)

Under W2/W3 (watch/multi-agent), construction MUST support incremental refresh:
- detect changes (git diff, mtime scan, or watcher events) and update only affected objects,
- invalidate dependent maps/claims deterministically (no silent reuse of stale objects),
- surface freshness/coverage in every answer when indexing is not current.

---

## Evidence-source adapters (where knowledge comes from)

Many of the 100 questions require sources beyond source code. The spec system must define adapters so the compiler can pull evidence without hardcoding per-product logic.

### EvidenceSourceAdapter contract (intended)

Each adapter declares:
- capabilities required (`tool:git`, `tool:filesystem`, `provider:llm`, etc.)
- how it produces evidence artifacts (files, JSON, trace refs)
- what it can and cannot claim
- invalidation rules

Core adapters (baseline):
- Filesystem + parsers (package manifests, config files, docs, CI configs, infra manifests)
- Git history adapter (commit timeline, blame, change impact hints)

Optional adapters (future; must fail closed when unavailable):
- Issue tracker adapter (GitHub/Jira) → issues, PRs, CODEOWNERS context
- CI adapter → pipeline failures, logs, build artifacts
- Observability adapter → dashboards/log patterns/runbooks (when accessible)

Rule: optional adapters can enrich, but must not create ungrounded certainty. When unavailable, disclose `unverified_by_trace(external_evidence_unavailable:<adapter>)`.

---

## Operational behavior under real conditions

Use `operational-profiles.md` vocabulary.

- **R0/R1 tiny repos**: bootstrap should complete quickly; higher recall expected.
- **R3/R4 huge/multi-repo**: progressive indexing + explicit adequacy reports; answers must include “what might be missing”.
- **D3 provider outage**: semantic stages fail closed; deterministic maps still serve; answers attach verification plans for deferred checks.
- **E6 stale evidence**: surface as defeater; trigger catch-up plan; do not reuse as “current truth”.
- **E4 partial corpora**: answers must be conditional (“within indexed corpus…”).

Additional workload commitments:
- **W0 interactive**: prefer returning a *useful, bounded pack* + “what to do next” within budget; never claim completeness without adequacy evidence.
- **W1 batch**: prefer completeness; emit artifacts (exports/audits) and a stable summary pack (for downstream agents).
- **W2 watch**: stable incremental updates; if the watcher is unhealthy, disclose degraded freshness.
- **W3 multi-agent**: concurrent reads are safe; writes (index updates, claim revisions) must be serialized or use bounded contention handling with explicit stop reasons (never silent drops).

---

## What’s missing today (honest disclosure)

This construction system is only partially wired in code. The spec is executable-as-design, but not fully verified end-to-end until:
- the query pipeline emits complete evidence ledger traces for each stage
- knowledge-map registry + adapters are implemented and tiered
- Tier‑2 suites verify representative scenarios across repo profiles

---

## Verification hooks (current + future)

Current “no drift” enforcement:
- `src/LiBrainian/__tests__/librarian_spec_behavior_index.test.ts` (spec-index completeness)

Planned verification (to make this fully executable):
- Tier‑0: a deterministic registry test ensuring every required knowledge object has a constructor and invalidation rules.
- Tier‑2: scenario-driven end-to-end construction over fixture repos covering a wide swath of “100 things”.

---

## Appendix A: 100 things an agent wants to know (and LiBrainian must support)

This list is intentionally explicit. The construction system must make these answerable **directly** (from RepoFacts/Maps) or **indirectly** (via Claims/Packs + adapters) with adequate disclosure.

1. What is the repo’s purpose (as stated in docs), and where is that stated?
2. What are the main user-visible entrypoints (CLI, server, library exports)?
3. What is the primary runtime (Node/Python/Go/etc.) and its required version(s)?
4. What package manager(s) are used, and which lockfiles are authoritative?
5. What are the canonical build commands for local dev?
6. What are the canonical test commands and test tiers?
7. What are the canonical lint/format/typecheck commands?
8. What CI systems exist, and where are their configs?
9. What are the deploy targets/environments, and where are their configs?
10. Who owns what (CODEOWNERS/maintainers), and how do you contact them?

11. What are the major subsystems/modules, and where are their boundaries?
12. What are the public APIs (exports/endpoints), and which files define them?
13. What are the internal APIs, and which files define them?
14. What are the key data models/schemas (DB, protobuf, OpenAPI), and where?
15. What are the key configuration files and their precedence order?
16. What are the feature flags, and where are they checked?
17. Where is authentication implemented, and which flows are supported?
18. Where is authorization implemented, and what are the roles/permissions?
19. Where is session/token management implemented, and what are invariants?
20. Where are secrets handled, and what redaction/safety rules exist?

21. What are the main processes/services, and how do they communicate?
22. What is the dependency graph between modules/packages?
23. What are the critical “hot paths” (request → response) and their steps?
24. What are the critical background jobs/queues and their handlers?
25. What external APIs are called, and where are those clients implemented?
26. What database(s) are used, and where are the connection settings?
27. What migrations exist, and how are they run safely?
28. What caching layers exist, and what are the cache keys/invalidation rules?
29. What storage layers exist (fs, object store), and what are their paths/buckets?
30. What messaging/event systems exist, and where are topics/handlers defined?

31. What are the main error types and error-handling conventions?
32. What logging library is used, and what is the log schema?
33. What metrics/telemetry exist, and where are they emitted?
34. What tracing exists, and what are the trace propagation rules?
35. What runbooks exist, and where are they kept?
36. What dashboards-as-code exist (if any), and where?
37. What SLO/SLAs exist (if any), and where are they defined?
38. What incident/postmortem docs exist (if any), and where?
39. What “known bad states” are documented, and what mitigations exist?
40. What “kill switches” or safe modes exist, and how are they invoked?

41. What test suites exist, and what do they cover (unit/integration/system)?
42. Where are fixtures/mocks defined, and what are the boundaries of realism?
43. What golden files/snapshots exist, and how are they updated?
44. What flake sources are known, and how are they mitigated?
45. What performance tests/benchmarks exist, and how are they run?
46. What security tests/scans exist, and how are they run?
47. What static analysis exists, and how are rules configured?
48. What code generation exists, and what sources generate what outputs?
49. What is excluded from indexing/testing (generated/binary), and why?
50. What determinism guarantees exist (reproducible builds/tests), and where are they enforced?

51. What are the core invariants that must always hold (business + technical)?
52. What are the critical correctness properties and their verification plans?
53. What are the critical safety properties and their verification plans?
54. What are the critical performance properties and their budgets?
55. What are the critical reliability properties and their budgets?
56. What are the key architectural decisions (ADRs), and where are they recorded?
57. What are the “forbidden patterns” and where are they enforced?
58. What are the dependency upgrade policies and their cadence?
59. What backwards-compatibility guarantees exist, and where are they tested?
60. What data retention/privacy policies exist (if any), and where are they encoded?

61. What is the current git state (branch/HEAD), and what changed recently?
62. What files/modules churn the most (change hotspots)?
63. What code areas are most fragile (correlated with failures/incidents)?
64. What modules are most central (graph centrality) and likely to cause blast radius?
65. What are the likely side effects of changing file/module X?
66. What tests are likely affected by changing file/module X?
67. What deploy artifacts are likely affected by changing file/module X?
68. What owned areas require review for changing file/module X?
69. What commit/PR introduced behavior Y, and why (from history/evidence)?
70. What alternative implementations existed historically, and what tradeoffs were made?

71. What is the minimal set of files needed to understand subsystem X?
72. What is the recommended reading order for subsystem X, and why?
73. What are the key call sites of function/class X (callers/callees)?
74. What are the key data flows into/out of function/class X?
75. What configuration paths affect subsystem X?
76. What feature flags affect subsystem X?
77. What security boundaries affect subsystem X?
78. What failure modes exist for subsystem X, and what detection signals exist?
79. What recovery procedures exist for subsystem X?
80. What “unknowns” remain about subsystem X given current indexed corpus?

81. What exactly must be verified to claim a change is correct?
82. What is the fastest honest verification plan (Tier‑0 first, then Tier‑2 if needed)?
83. What can be proven deterministically vs what requires providers/external evidence?
84. What can be safely done offline vs what requires network access?
85. What is the blast radius estimate, and what makes it uncertain?
86. What are the top risks of the proposed change and their mitigations?
87. What is the rollback plan and its verification?
88. What monitoring should be checked post-deploy?
89. What “done” means for this task (Definition of Done obligations)?
90. What evidence artifacts should be produced (tests, audits, traces, reports)?

91. What is the current LiBrainian index freshness and corpus adequacy for this repo?
92. What did LiBrainian do to answer (plan/trace), and where is the replay anchor?
93. What evidence supports claim C, and what defeaters exist?
94. Which claims are unverified, and what are the remediation steps?
95. What knowledge objects changed since last run (facts/maps/claims/packs)?
96. What new episodes/outcomes were recorded, and what were the results?
97. What are the systematic retrieval gaps (missed areas) and why?
98. What are the systematic synthesis gaps (hallucination risk) and why?
99. What is the recommended next-best question to reduce uncertainty fastest?
100. What workflows should the agent construct next (work objects) to make progress safely?

---

## Appendix B: 50 additional “missing” use cases (now specified as UC-261…UC-310)

These are use cases that were *not explicitly represented* as first-class UC rows before. They are now part of the canonical UC inventory:
- `docs/LiBrainian/USE_CASE_MATRIX.md` (UC‑261…UC‑310)

The design intent is to add them **without exploding bespoke handlers**:
- UC coverage is expressed as UC→template mappings (reusable programs), not new endpoints.
- The canonical UC inventory is the matrix; the canonical template contract is:
  - `docs/LiBrainian/specs/core/construction-templates.md`

Note: adapters marked optional must still obey fail-closed semantics when the UC requires that evidence:
return `unverified_by_trace(external_evidence_unavailable:<adapter>)` rather than guessing.
