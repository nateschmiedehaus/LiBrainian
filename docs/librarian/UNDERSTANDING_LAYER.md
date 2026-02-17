# LiBrainian Understanding Layer

Status: authoritative
Scope: Knowledge ontology, mappings, constructions, methods, and schemas for LiBrainian understanding.
Last Verified: 2026-01-04
Owner: librarianship
Version: 1.1.0
Evidence: docs only (implementation evidence lives in STATUS.md)

## Related Documents

| Document | Relationship |
|----------|-------------|
| `SCHEMAS.md` | Authoritative type definitions for Evidence, Claim, Confidence, Defeater |
| `STATUS.md` | Implementation tracking for knowledge components |
| `SYSTEM_ARCHITECTURE.md` | System layers and component model |
| `USE_CASE_MATRIX.md` | UC-to-method mapping and coverage |
| `MODEL_POLICY.md` | Provider selection for LLM synthesis |

## Why this layer exists

Embeddings answer: "What is similar to X?"
Understanding answers: "What is X? Why does it exist? What does it mean? What happens if it changes?"

Current (insufficient):
```
Code -> AST -> Embeddings -> Similarity Search
```

Target:
```
Code -> AST -> Understanding -> Knowledge -> Dialogue
              |
              +-> Purpose, intent, rationale, consequences
```

## Knowledge Research Foundations

### What is understanding?
Understanding is the ability to:
1) Explain why something exists and how it works
2) Predict consequences of changes
3) Recommend actions given constraints
4) Teach a new developer quickly
5) Answer unseen questions with evidence

### Knowledge primitives
These are the atomic objects the system stores and composes:
- Entity: a thing in the codebase (file, function, module, workflow)
- Relation: a typed link between entities (calls, depends_on, owned_by)
- Evidence: a trace to source reality (code span, test, commit, doc)
- Claim: a statement about an entity ("module enforces auth")
- Confidence: calibrated belief in a claim (0..1 + factors)
- Defeater: a counter-claim that reduces confidence
- Hypothesis: a claim awaiting evidence
- Trace: exact pointers that allow verification and reproduction

### Language-Agnostic Knowledge (Required)
Understanding must survive language boundaries. Every entity includes:
- Language identity (language, dialect, runtime).
- Parser provenance (adapter, fallback, LSP, or manual).
- Evidence-level limitations when parsing is partial.

Language invariants:
- New languages are supported immediately with explicit gaps.
- Knowledge primitives remain identical across languages.
- Cross-language relationships are first-class (API calls, data flows).

### Universal knowledge schema (composed domains)
The knowledge object is a composition of domain-specific records.

```typescript
interface UniversalKnowledge {
  identity: IdentityKnowledge;
  semantics: SemanticKnowledge;
  structure: StructuralKnowledge;
  relationships: RelationshipKnowledge;
  history: HistoryKnowledge;
  ownership: OwnershipKnowledge;
  risk: RiskKnowledge;
  testing: TestingKnowledge;
  security: SecurityKnowledge;
  rationale: RationaleKnowledge;
  tribal: TribalKnowledge;
  quality: QualityKnowledge;
}
```

### Evidence and defeaters
Evidence types (minimum set):
- Code: file spans, signatures, AST nodes
- Tests: assertions, fixtures, coverage
- Docs: ADRs, READMEs, RFCs
- Git: commits, blame, co-change
- Runtime: logs, traces, metrics (when available)

Defeater types:
- Staleness: evidence older than source change
- Contradiction: mutually exclusive claims
- Coverage gap: missing tests or ownership
- Failure attribution: repeated failures tied to a claim

### Five dimensions of code understanding
| Dimension | Question | Required output |
| --- | --- | --- |
| Purpose | Why does this exist? | Summarized intent + use case |
| Mechanism | How does it work? | Stepwise explanation + algorithm |
| Contract | Inputs/outputs/invariants | Preconditions, postconditions, failure modes |
| Dependencies | What does it need/provide? | Dependency and collaboration map |
| Consequences | What breaks if it changes? | Impact narrative + risk map |

## Knowledge Ontology (Domains)
The system maintains a universal ontology that applies to any codebase.

| Domain | Purpose | Example attributes |
| --- | --- | --- |
| Identity | What is this? | name, path, type, language, framework |
| Semantics | What does it do? | purpose, behavior, side effects |
| Structure | How is it organized? | complexity, patterns, size |
| Relationships | How does it connect? | dependencies, dependents, data flows |
| History | How did it evolve? | age, churn, authors |
| Ownership | Who is responsible? | team, experts, reviewers, SLA |
| Risk | What could go wrong? | change risk, security risk |
| Testing | How is it verified? | coverage, test strategy |
| Security | What are threats? | attack surface, auth boundaries |
| Rationale | Why this design? | decisions, constraints, tradeoffs |
| Tribal | What is undocumented? | conventions, gotchas, tips |
| Quality | How healthy? | tech debt, smells, refactor notes |

## Freshness and Staleness

Knowledge is time-sensitive; stale knowledge is a defeater.

### Staleness Thresholds

| Domain | Max Staleness | Half-Life | Refresh Trigger |
|--------|---------------|-----------|-----------------|
| Identity | 0 (always fresh) | N/A | file system change |
| Structure | 0 (always fresh) | N/A | file content change |
| Relationships | 1 minute | 30 seconds | import/export change |
| Semantics | 1 hour | 30 minutes | significant code change |
| History | 5 minutes | 2.5 minutes | new commit |
| Testing | 10 minutes | 5 minutes | test file change |
| Risk | 1 hour | 30 minutes | dependency/code change |
| Quality | 1 day | 12 hours | periodic reassessment |
| Tribal | 1 week | 3.5 days | manual/inferred update |

### Freshness Decay Formula

Freshness decays exponentially based on the domain's half-life:

```typescript
function computeFreshness(
  generatedAt: Date,
  now: Date,
  halfLifeMs: number
): number {
  const ageMs = now.getTime() - generatedAt.getTime();

  // Exponential decay: f(t) = 0.5^(t/halfLife)
  const freshness = Math.pow(0.5, ageMs / halfLifeMs);

  // Clamp to [0, 1]
  return Math.max(0, Math.min(1, freshness));
}

// Example: Semantics with 30-minute half-life
// After 30 min: 50% fresh
// After 60 min: 25% fresh
// After 90 min: 12.5% fresh
```

### Staleness Detection Rules

1. **Absolute Staleness**: If `now - generatedAt > maxStaleness`, mark as stale
2. **Relative Staleness**: If source file `mtime > generatedAt`, mark as stale
3. **Dependency Staleness**: If any dependency is stale, propagate with penalty

### Staleness Defeaters

When knowledge becomes stale, a defeater is activated:

```typescript
const stalenessDefeater: Defeater = {
  id: uuid(),
  kind: 'stale_data',
  description: `Knowledge generated ${formatDuration(age)} ago exceeds ${domain} threshold`,
  severity: age > maxStaleness * 2 ? 'high' : 'medium',
  active: true,
  activatedAt: now.toISOString(),
  evidence: {
    sources: [{ kind: 'git', ref: latestCommitSha }],
    method: 'freshness_check',
    timestamp: now.toISOString(),
    confidence: 1.0
  }
};
```

### Refresh Priority Queue

When multiple items need refresh, prioritize by:
1. Active query dependency (blocking)
2. Staleness severity (most stale first)
3. Access frequency (hot paths first)
4. Confidence impact (low confidence first)

## Entity Taxonomy
The system recognizes explicit, structural, and emergent entities.

Explicit (from code):
- file, function, class, method, interface, type

Structural (from filesystem and build):
- directory, module, package, workspace

Emergent (discovered):
- component, subsystem, system, layer, domain, feature, workflow,
  boundary, contract, hotspot, debt_cluster, data_flow, pipeline

## Emergent Entity Discovery
Discovery methods (ordered by cost and reliability):
1) Directory structure and config (packages, services, modules)
2) Naming conventions and file patterns
3) Import and call clustering
4) Co-change and ownership clustering
5) Embedding similarity clusters
6) LLM synthesis for architectural roles

Discovery method tiers:

| Method | LLM required | Discovers |
| --- | --- | --- |
| Directory + config | No | modules, packages, services |
| Naming conventions | No | controllers, repositories, layers |
| Import/call clustering | No | components, subsystems |
| Co-change + ownership | No | hotspots, team boundaries |
| Embedding clusters | Yes (embeddings) | semantically related code |
| LLM synthesis | Yes (LLM) | features, workflows, rationale |

Discovery pipeline rules:
- Each discoverer emits entities with evidence and confidence.
- Conflicting entities are merged with defeaters attached.
- Emergent entities are aggregated from children and re-evaluated on change.

## Confidence Model
Confidence is multi-dimensional; a single high score cannot hide a weak axis.

Core dimensions:
- Freshness: decays over time (half-life tuned per domain).
- Coverage: how much of the entity is indexed and tested.
- Reliability: historical success rate of decisions tied to this knowledge.

Confidence sources:
- AST (highest), git history, user-provided, LLM consensus, single LLM, embeddings, inferred, aggregated.

Rules:
- Confidence is the geometric mean of evidence dimensions.
- Defeaters are tracked separately from confidence and surfaced in responses.
- Aggregated confidence uses child evidence with uncertainty propagation.

Computation (canonical):
```
freshness = weightedAverage(freshnessSignals)
coverage = weightedAverage(coverageSignals)
reliability = weightedAverage(reliabilitySignals)
overall = (freshness * coverage * reliability) ** (1/3)

// Defeaters don't modify raw confidence - they're tracked separately.
// When defeaters exist, the knowledge is valid but conditionally so.
// Display logic should show: "confidence: X (with Y active defeaters)"
effectiveConfidence = overall  // Defeaters tracked in metadata, not multiplied
```

**Defeater Integration Note**: Defeaters (e.g., staleness, file changes, test failures) are stored in `meta.defeaters[]` and checked via `checkDefeaters()`. They represent conditions that could invalidate the claim but don't automatically reduce the raw confidence score. Consumers should use `validateKnowledge()` to get the current defeater status before acting on high-confidence claims.

## Knowledge Aggregation Rules

Parent entities (modules, subsystems) inherit knowledge from children according to
explicit aggregation rules. These rules ensure consistent rollup and prevent
silent knowledge loss.

### Aggregation Functions

| Domain | Function | Formula |
|--------|----------|---------|
| Purpose | Synthesis | LLM summarizes child purposes with weighting by importance |
| Risk | Maximum + Coupling | `max(child_risks) + coupling_penalty * num_edges` |
| Quality | Weighted Average | `Σ(child_quality * child_loc) / Σ(child_loc)` |
| Ownership | Mode + Recency | Most frequent owners weighted by commit recency |
| Coverage | Aggregated Ratio | `covered_children / total_children` |
| Confidence | Minimum + Propagation | `min(child_confidence) * propagation_factor` |

### Aggregation Implementation

```typescript
interface AggregationConfig {
  domain: string;
  function: 'min' | 'max' | 'avg' | 'weighted_avg' | 'sum' | 'mode' | 'synthesis';
  weights?: Record<string, number>;  // For weighted operations
  propagationFactor?: number;        // Confidence decay (default: 0.95)
  synthesisPrompt?: string;          // For LLM synthesis
}

function aggregateKnowledge(
  parent: Entity,
  children: Entity[],
  config: AggregationConfig
): AggregatedKnowledge {
  switch (config.function) {
    case 'min':
      return { value: Math.min(...children.map(c => c[config.domain])) };

    case 'max':
      return { value: Math.max(...children.map(c => c[config.domain])) };

    case 'weighted_avg':
      const totalWeight = children.reduce((sum, c) => sum + (config.weights?.[c.id] ?? c.loc), 0);
      const weightedSum = children.reduce((sum, c) =>
        sum + c[config.domain] * (config.weights?.[c.id] ?? c.loc), 0);
      return { value: weightedSum / totalWeight };

    case 'synthesis':
      return synthesizeWithLLM(parent, children, config.synthesisPrompt);

    // ... other cases
  }
}
```

### Confidence Propagation

When aggregating, confidence propagates with uncertainty:

```typescript
function propagateConfidence(
  childConfidences: number[],
  propagationFactor: number = 0.95
): number {
  // Minimum child confidence with propagation penalty
  const minConfidence = Math.min(...childConfidences);

  // Apply propagation factor per aggregation level
  return minConfidence * propagationFactor;
}

// Example: 3-level hierarchy with child confidence 0.8
// Level 1 (direct): 0.8 * 0.95 = 0.76
// Level 2 (module): 0.76 * 0.95 = 0.72
// Level 3 (subsystem): 0.72 * 0.95 = 0.68
```

### Defeater Inheritance

Defeaters propagate upward with severity escalation:

1. **Critical defeaters**: Always propagate to parent
2. **High defeaters**: Propagate if affects > 50% of children
3. **Medium defeaters**: Aggregate count in parent metadata
4. **Low defeaters**: Only recorded in child entities

```typescript
function propagateDefeaters(
  children: Entity[]
): Defeater[] {
  const criticalDefeaters = children.flatMap(c =>
    c.defeaters.filter(d => d.severity === 'critical' && d.active)
  );

  const highDefeaters = children.flatMap(c =>
    c.defeaters.filter(d => d.severity === 'high' && d.active)
  );

  const highThreshold = children.length * 0.5;
  const propagatedHigh = highDefeaters.length > highThreshold
    ? [createAggregatedDefeater('high', highDefeaters)]
    : [];

  return [...criticalDefeaters, ...propagatedHigh];
}
```

### Aggregation Triggers

Aggregation is triggered by:
1. **Child change**: Any child knowledge update
2. **Child add/remove**: Entity hierarchy modification
3. **Staleness**: Parent knowledge exceeds threshold
4. **Query demand**: Lazy aggregation on access

### Aggregation Caching

- Aggregated values are cached with TTL based on domain
- Cache invalidated on any child change
- Background refresh for frequently accessed parents

## Knowledge Mappings
Mappings are structured views of knowledge that answer specific questions.

| Map | Primary use | Required evidence |
| --- | --- | --- |
| Identity map | What exists | file system, manifests, adapters |
| Structure map | How code is organized | directories, modules, build config |
| Architecture map | How subsystems fit | module boundaries, flows, interfaces |
| Dependency map | What depends on what | imports, call graph, package graph |
| Data flow map | Where does data move | AST, tracing, IO points |
| Contract map | What are guarantees | tests, types, runtime checks |
| Ownership map | Who owns this | CODEOWNERS, docs, commits |
| Risk map | Where are hazards | churn, complexity, vuln signals |
| Test coverage map | What is verified | test index + coverage |
| Change impact map | What breaks if changed | call graph + test impact |
| Security map | Attack surface + trust boundaries | code, deps, config, tests |
| Compliance map | Policy adherence | data flow, policy docs, tests |
| Quality map | Debt and maintainability | static analysis + history |
| Evolution map | Churn, hotspots, trajectories | git history, releases |
| Rationale map | Decisions and alternatives | ADRs, PRs, docs |
| Release readiness map | Ship checklist | tests, risk, ownership |
| Configuration map | Config sources and overrides | config files, envs, docs |
| Build and CI map | Build/test pipelines | build scripts, CI configs |
| Runtime behavior map | Runtime and operational behavior | logs, traces, runtime config |
| Observability map | Metrics and monitoring coverage | metrics, traces, alerts |
| API and interface map | Public surface + contracts | routes, schemas, clients |
| Data model map | Schema and storage structure | schemas, migrations, ORM |
| Performance map | Hotspots and cost | profiling, benchmarks, metrics |
| Documentation map | Docs coverage and links | docs index, ADRs, references |
| Product map | Requirements to code | product docs, tests, code paths |
| Project planning map | Roadmaps and milestones | issues, roadmaps, plans |
| Language coverage map | Language support status | detection, adapters, fallback |
| Agent coordination map | Task + workflow coordination | task graphs, locks, workflows |
| Knowledge coverage map | Confidence + gaps | confidence ledger, gap reports |

Mapping rules:
- Every map declares evidence sources and freshness thresholds.
- Maps emit explicit confidence and defeaters, not just scores.
- Maps are composable; scenarios combine multiple maps into one response.
Map codes for use-case coverage live in `docs/LiBrainian/USE_CASE_MATRIX.md`.

## Knowledge Constructions (How knowledge is built)

Signals (sources of evidence):
- Code: AST, types, comments, signatures
- Tests: assertions, fixtures, mocks
- Docs: ADRs, READMEs, RFCs
- Git: commit history, blame, PRs
- Config: build, CI, deployment, env
- Runtime: logs, traces, metrics (if available)

Construction pipeline:
1) Observe: collect signals per entity
2) Extract: derive structured facts (imports, calls, types)
3) Infer: produce candidate claims (LLM + rules)
4) Validate: attach evidence, resolve contradictions
5) Synthesize: build narratives and maps
6) Serve: answer queries with confidence and trace

Conflict handling:
- Competing claims are both stored as hypotheses with defeaters
- Confidence is updated by evidence quality and recency
- Claims without trace are labeled unverified

## Knowledge Delivery (Agent-Optimized)
Responses are shaped for agent decisions, not just retrieval:
- Decision support: can/should proceed, required tests, constraints.
- Autonomy guidance: confidence thresholds, when to ask for review.
- Proactive guidance: likely next steps and common mistakes.
- Progressive disclosure: summary first, deep dives on demand.
- Autonomy gates: block or defer actions below confidence thresholds.
- Higher‑order cognition (semantic synthesis/claims, reasoning, critique, decision support) requires live LLM agents; deterministic stand‑ins are invalid for semantic behavior. Structural outputs must be labeled as non‑semantic when LLMs are unavailable.

### Method Knowledge Packs (Required)
- For each method in `docs/LiBrainian/USE_CASE_MATRIX.md`, LiBrainian builds
  a method pack: steps, prerequisites, evidence sources, pitfalls, and
  completion criteria.
- Method packs are provided as hints when UC requirements imply their use.
- Method packs are cached and preloaded when cheap and frequently used.
- UCRequirementSet drives method selection and preloading.
- Hints must be evidence-backed and updated when knowledge changes.
- If packs are incomplete, LiBrainian emits a GapReport with required inputs.

### Understanding Mandate (LLM-Required)
When a response requires semantic understanding (purpose, mechanism, contract,
rationale, consequences, analysis, or guidance), it must be produced by LLM
synthesis grounded in evidence. Non-LLM shortcuts may be used only for
structural facts (counts, static relationships, file locations) and must never
be presented as understanding.

**Mandate Audit Procedure**: To verify compliance with this mandate:
1. Every semantic understanding output must include in its evidence pack:
   - `provider`: the LLM provider used (e.g., "claude", "codex")
   - `modelId`: the specific model ID (e.g., "claude-haiku-4.5")
   - `timestamp`: when the LLM call was made (ISO 8601)
   - `promptDigest`: SHA-256 of the prompt sent (for reproducibility)
2. If an LLM call fails or is unavailable, the output must be marked as
   `unverified_by_trace(llm_unavailable)` rather than substituting heuristics.
3. Audit scripts (`scripts/audit_llm_mandate.mjs`) should periodically check:
   - All knowledge records with semantic content have provider evidence
   - No semantic fields exist without corresponding LLM evidence
   - Heuristic-only outputs are correctly marked as structural, not semantic
4. Violations surface as `SlopReviewReport.v1` entries with `reason: llm_mandate_violation`.

**Current Gap**: Any semantic extractor entrypoint that can return semantic content
without LLM evidence is a mandate violation. See `docs/LiBrainian/STATUS.md` for tracking.

## Method Catalog (How we infer knowledge)

Static analysis:
- AST parsing, type inference, dependency graphs
- Adapter or LSP-backed extraction when available

Semantic analysis:
- Embeddings for similarity, retrieval, clustering
- Cross-encoder reranking for precision

Behavioral analysis:
- Test-derived behavior and invariants
- Runtime traces when available

Historical analysis:
- Git evolution, co-change, author signals

LLM synthesis:
- Purpose, rationale, contract, and narrative generation
- Consensus and self-check for higher confidence
- Language bootstrapping when adapters are missing (with caveats)

Coverage requirement:
- LLM synthesis must support the full scenario taxonomy, not a subset.

## Retrieval Method Stack (Required)
Status for each element lives in `docs/LiBrainian/STATUS.md`.
- [planned] Function-level chunking for precise semantic units.
- [planned] Multi-vector embeddings (semantic, structural, dependency, usage).
- [planned] Co-change signals from git history for behavioral similarity.
- [planned] Graph-augmented scoring to reduce false positives.
- [planned] Cross-encoder reranking for final precision.
- [planned] LLM purpose extraction when embeddings are insufficient.

## Research Anchors
Evidence-backed methods referenced in design:
- SBFL (Ochiai) for failure attribution
- DOA/ownership models for expertise
- Tarjan SCC, PageRank, centrality for graph reasoning
- Kythe/Glean storage patterns for durable indexing

## Applied Knowledge Methods (Operational)
These are the concrete, evidence-backed techniques the understanding layer uses.
- Graph reasoning: PageRank, centrality, SCC, community detection for impact.
- Ownership inference: DOA with recency + co-change weighting.
- Failure attribution: SBFL on task outcomes and test failures.
- Test impact: test-to-code mapping + coverage and co-change hints.
- Change impact: call graph + dependency + data flow aggregation.
- Pattern inference: naming + import clustering + embeddings + LLM synthesis.
## Layered Architecture

```
Layer 4: Dialogue
- Natural language Q and A
- "Why does validateUser check timestamps?"
- "What would break if I remove the cache?"

Layer 3: Synthesis
- Cross-entity narratives
- System flows, recommendations, mental models

Layer 2: Annotation
- Per-entity understanding
- Purpose, mechanism, contract, rationale

Layer 1: Extraction
- AST parsing, embeddings, graphs
```

## Layer 2: Annotation Schema

```typescript
interface EntityUnderstanding {
  entityId: string;
  entityType: 'function' | 'module' | 'class' | 'type';

  // Core understanding
  purpose: Purpose;
  mechanism: Mechanism;
  contract: Contract;

  // Contextual understanding
  rationale: Rationale;
  assumptions: Assumption[];
  limitations: Limitation[];

  // Relational understanding
  collaborators: Collaborator[];
  dependents: Dependent[];
  alternatives: Alternative[];

  // Epistemic metadata
  confidence: UnderstandingConfidence;
  evidence: Evidence[];
  generatedAt: string;
  validUntil: string; // invalidated on code change
}
```

Purpose (why does this exist?):
```typescript
interface Purpose {
  summary: string;
  motivation: string;
  valueProposition: string;
  primaryUseCase: string;
  derivedFrom: ('code' | 'comments' | 'tests' | 'usage' | 'commits' | 'docs')[];
}
```

Mechanism (how does it work?):
```typescript
interface Mechanism {
  explanation: string;
  steps?: string[];
  approach: string;
  designRationale: string;
  complexity: {
    time: string;
    space: string;
    cognitive: 'simple' | 'moderate' | 'complex';
  };
}
```

Contract (what are the guarantees?):
```typescript
interface Contract {
  preconditions: Condition[];
  postconditions: Condition[];
  invariants: Condition[];
  exceptions: ExceptionSpec[];
  sideEffects: SideEffect[];
}
```

Rationale (why these decisions?):
```typescript
interface Rationale {
  history: HistoricalContext[];
  constraints: Constraint[];
  alternatives: ConsideredAlternative[];
  tradeoffs: Tradeoff[];
}
```

## Layer 3: Synthesis Schema

Module narrative:
```typescript
interface ModuleNarrative {
  moduleId: string;
  overview: string;
  mentalModel: string;
  concepts: Concept[];
  architecture: ArchitectureDescription;
  howTo: HowToGuide[];
  gotchas: Gotcha[];
  trajectory: {
    past: string;
    present: string;
    future: string;
  };
}
```

Cross-cutting narrative:
```typescript
interface CrossCuttingNarrative {
  topic: string;
  participants: EntityReference[];
  narrative: string;
  flow: FlowStep[];
  principles: string[];
  startHere: EntityReference[];
}
```

## Layer 4: Dialogue Interface

Query types:
```typescript
type UnderstandingQuery =
  | WhyQuery
  | HowQuery
  | WhatIfQuery
  | WhereQuery
  | WhenQuery
  | WhoQuery
  | RecommendQuery;
```

Response structure:
```typescript
interface UnderstandingResponse {
  answer: string;
  confidence: {
    level: number;
    factors: string[];
    caveats: string[];
  };
  evidence: Evidence[];
  seeAlso: EntityReference[];
  clarifyingQuestions?: string[];
  suggestions?: Suggestion[];
}
```

## Generation Pipeline

When to generate:
1) On bootstrap for core entities
2) On demand during queries
3) After code change invalidation

Pipeline:
```
Code change -> AST re-parse -> invalidate -> queue -> generate -> validate -> store
```

Prompt strategy:
- Provide full code, local context, usage, tests, history, docs
- Require explicit uncertainty and citations
- Reject claims without trace

## Storage Schema (design intent)

```sql
CREATE TABLE librarian_understanding (
  entity_id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  purpose JSON NOT NULL,
  mechanism JSON NOT NULL,
  contract JSON NOT NULL,
  rationale JSON,
  assumptions JSON,
  limitations JSON,
  confidence REAL NOT NULL,
  evidence JSON NOT NULL,
  generated_at TEXT NOT NULL,
  valid_until TEXT,
  generation_model TEXT NOT NULL
);

CREATE TABLE librarian_narratives (
  narrative_id TEXT PRIMARY KEY,
  narrative_type TEXT NOT NULL,
  subject_id TEXT,
  topic TEXT,
  overview TEXT NOT NULL,
  mental_model TEXT,
  content JSON NOT NULL,
  entities JSON NOT NULL,
  confidence REAL NOT NULL,
  generated_at TEXT NOT NULL,
  valid_until TEXT
);

CREATE TABLE librarian_dialogue (
  query_id TEXT PRIMARY KEY,
  query_type TEXT NOT NULL,
  query_text TEXT NOT NULL,
  query_parsed JSON NOT NULL,
  response_text TEXT NOT NULL,
  response_confidence REAL NOT NULL,
  response_evidence JSON,
  user_rating INTEGER,
  user_correction TEXT,
  asked_at TEXT NOT NULL,
  response_time_ms INTEGER
);
```

## Epistemic Controls

Confidence sources (examples):
- ast: parsed from code, high confidence
- git: from history, high confidence
- embedding: semantic inference, medium confidence
- llm_single: single model extraction, medium confidence
- llm_consensus: multiple model agreement, higher confidence
- user: human verified, high confidence

Rules:
- Claims without trace are labeled unverified
- Conflicting claims store defeaters with weighted evidence
- Confidence must be calibrated against observed error rates

## Understanding Measurement Matrix (Required)

Every entity should reach minimum measurement thresholds before agents act autonomously.
Measurement replaces binary verification for semantic quality.

| Measurement Axis | Minimum for Autonomy | Metric | Notes |
| --- | --- | --- | --- |
| Evidence | Code + tests or docs | Coverage % | Missing tests lowers confidence |
| Freshness | Within domain SLA | Staleness (hours) | Stale evidence is a defeater |
| Ownership | Known owner or reviewer | Owner confidence | Required for escalation |
| Contract | Preconditions + postconditions | Contract coverage % | Required for refactors |
| Retrieval Quality | Top-5 results contain relevant entity | Recall@5 ≥ 0.7 | Measured over test corpus |
| Semantic Fidelity | LLM synthesis matches code behavior | Accuracy % | Requires golden set |

### Key Retrieval Metrics

| Metric | What It Measures | Target |
|--------|------------------|--------|
| **Fix-localization Recall@5** | Bug-relevant file in top 5 | ≥ 70% |
| **Change-impact Recall@10** | Affected call sites in top 10 | ≥ 60% |
| **Convention Recall@5** | Project ADRs/style guides retrieved | ≥ 50% |
| **Precision@5** | Relevant fraction of top 5 | ≥ 40% |
| **nDCG** | Ranking quality | ≥ 0.6 |

---

## Quality Testing vs. Epistemic Verification

> **Verification** asks: "Did it pass?" (binary)
> **Measurement** asks: "How well did it perform?" (continuous)

The understanding layer must distinguish between these two modes:

### Verification (Binary)
- Build passes: yes/no
- Tests pass: yes/no
- Provider available: yes/no
- Schema valid: yes/no

### Measurement (Continuous)
- Retrieval quality: recall@k, precision@k, nDCG
- Confidence calibration: stated vs empirical accuracy
- Latency: p50, p99 distribution
- Coverage: % of entities indexed
- Semantic accuracy: LLM output vs ground truth

### When to Use Each

| Situation | Mode | Rationale |
|-----------|------|-----------|
| CI gate | Verification | Must pass/fail quickly |
| Quality tracking | Measurement | Need trends over time |
| Autonomy gating | Measurement | Confidence thresholds matter |
| Provider checks | Verification | Available or not |
| Retrieval tuning | Measurement | Optimize recall@k |

---

## Confidence Calibration Testing

Confidence scores must be calibrated against empirical accuracy. A claim with 80% confidence should be correct ~80% of the time.

### Calibration Methodology

```typescript
interface CalibrationTest {
  // Input
  claims: Claim[];           // Claims with confidence scores
  groundTruth: boolean[];    // Human-verified correctness

  // Output
  calibrationError: number;  // |stated - empirical|
  buckets: CalibrationBucket[];
  overconfidentBuckets: string[];
  underconfidentBuckets: string[];
}

interface CalibrationBucket {
  confidenceRange: [number, number];  // e.g., [0.7, 0.8]
  statedConfidence: number;           // Mean stated confidence
  empiricalAccuracy: number;          // Actual accuracy
  sampleSize: number;
}
```

### Calibration Targets

| Confidence Range | Max Calibration Error |
|-----------------|----------------------|
| 0.9 - 1.0 | ≤ 5% |
| 0.7 - 0.9 | ≤ 10% |
| 0.5 - 0.7 | ≤ 15% |
| 0.0 - 0.5 | N/A (low confidence acceptable) |

### Recalibration Triggers

1. **Calibration drift detected**: Error exceeds threshold for 3+ consecutive audits
2. **Model change**: New LLM provider or model version
3. **Significant codebase change**: >30% of indexed entities modified
4. **Domain shift**: New language or framework introduced

---

## Determinism Requirements

Indexing operations must be deterministic for reproducible measurements and debugging.

### Deterministic Invariants

| Operation | Determinism Requirement |
|-----------|------------------------|
| AST parsing | Fully deterministic |
| Entity extraction | Fully deterministic |
| Relation extraction | Fully deterministic |
| Embedding generation | Deterministic given same model + seed |
| Chunk boundary | Deterministic (fixed algorithm) |
| Tie-breaking in ranking | Deterministic (stable sort + secondary key) |

### Non-Deterministic Operations (Must Be Recorded)

| Operation | Record For Replay |
|-----------|-------------------|
| LLM synthesis | Full prompt + response + model ID |
| Cross-encoder reranking | Input order + scores |
| Model selection | Selected model + timestamp |
| Provider calls | Request hash + response hash |

### Replay Requirements

For any indexed entity, given the same:
- Source file content (SHA-256)
- Chunking configuration
- Model ID and seed

The following must be identical:
- Entity ID
- Extracted relations
- Chunk boundaries
- Embedding vector (within floating-point tolerance)

## Success Criteria

The understanding layer is complete when:
1) Every function has a purpose a new developer can trust
2) Every module has a narrative explaining its role
3) "Why" and "what if" questions produce evidence-backed answers
4) Change impact returns concrete, testable consequences
5) Confidence and defeaters are visible and actionable

## Legacy Research Sources (Integrated)
- `docs/LiBrainian/legacy/architecture.md`
- `docs/LiBrainian/legacy/WORLD_CLASS_LIBRARIAN_PLAN.md`
- `docs/LiBrainian/legacy/implementation-requirements.md`
- `docs/LiBrainian/legacy/EMBEDDING_ROADMAP.md`
- `docs/LiBrainian/legacy/VISION.md`

## Commitment

Code is knowledge for humans, not just machines. LiBrainian must preserve,
transfer, and evolve that knowledge with traceable evidence and calibrated
confidence.

## Document History

| Date | Version | Changes |
|------|---------|---------|
| 2026-01-08 | 1.2.0 | Added Understanding Measurement Matrix, Quality Testing vs Epistemic Verification, Confidence Calibration Testing, Determinism Requirements |
| 2026-01-04 | 1.1.0 | Added freshness decay formulas, aggregation rules, related docs |
| 2026-01-04 | 1.0.0 | Initial understanding layer specification |

---

*This document is authoritative for LiBrainian knowledge ontology and understanding semantics.*
