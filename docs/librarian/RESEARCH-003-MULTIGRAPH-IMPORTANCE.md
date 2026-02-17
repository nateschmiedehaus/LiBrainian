# RESEARCH-003: Multi-Graph Importance Metrics

> **Status**: RESEARCH COMPLETE
> **Author**: Claude Opus 4.5
> **Date**: 2026-01-30
> **Extends**: RESEARCH-002 (Usage-Weighted PageRank)
> **Related**: Evidence Ledger, Universal Knowledge Types, Epistemic Types

---

## Executive Summary

RESEARCH-002 established that LiBrainian already has strong code-level importance signals (PageRank, betweenness centrality, co-change). This research extends those findings to ALL knowledge objects LiBrainian manages across its four interconnected graphs:

1. **Code Graph**: Functions, classes, modules with calls/imports/extends edges
2. **Rationale Graph**: Decisions, justifications, tradeoffs, ADRs
3. **Epistemic Graph**: Claims, evidence, confidence values, defeaters
4. **Organizational Graph**: Ownership, responsibility, teams

Each graph has its own notion of "importance" or "centrality." A function might be rarely called but its rationale is foundational. An epistemic claim might be low-confidence but supports 10 other claims. A design decision might be old but supersedes nothing (still active).

This document defines importance metrics for each graph type, proposes a cross-graph importance propagation algorithm, and provides integration guidance with LiBrainian's existing PageRank/centrality infrastructure.

---

## Table of Contents

1. [Research Questions](#research-questions)
2. [Existing Infrastructure Analysis](#existing-infrastructure-analysis)
3. [Per-Graph Importance Metrics](#per-graph-importance-metrics)
   - [Code Graph Metrics](#1-code-graph-metrics-existing)
   - [Rationale Graph Metrics](#2-rationale-graph-metrics-new)
   - [Epistemic Graph Metrics](#3-epistemic-graph-metrics-new)
   - [Organizational Graph Metrics](#4-organizational-graph-metrics-new)
4. [Cross-Graph Importance Propagation](#cross-graph-importance-propagation)
5. [Unified Importance Score](#unified-importance-score)
6. [Surfacing Load-Bearing Knowledge](#surfacing-load-bearing-knowledge)
7. [Integration with Existing Infrastructure](#integration-with-existing-infrastructure)
8. [Theoretical Foundations](#theoretical-foundations)
9. [Implementation Roadmap](#implementation-roadmap)

---

## Research Questions

### RQ1: Per-Graph Centrality
How do you compute centrality/importance in non-code graphs?
- **Rationale graph**: What makes a decision "foundational"?
- **Epistemic graph**: What makes a claim "load-bearing"?

### RQ2: Cross-Graph References
How do cross-graph references affect importance?
- If code C depends on decision D which depends on claim E, how does importance flow?

### RQ3: Unified vs Per-Graph
Should importance be computed per-graph or unified across all graphs?

### RQ4: Existing Metrics
What metrics exist for "argumentative centrality" or "epistemic load"?

---

## Existing Infrastructure Analysis

### Code Graph Infrastructure

LiBrainian already implements sophisticated code-level metrics:

**File**: `src/graphs/pagerank.ts`
```typescript
export function computePageRank(graph: Graph, options: PageRankOptions = {}): Map<string, number>
```
- Standard PageRank with configurable damping factor (default 0.85)
- Convergence threshold and max iterations configurable
- Used for identifying "important" code entities

**File**: `src/graphs/centrality.ts`
```typescript
export function computeBetweennessCentrality(graph: Graph): Map<string, number>
export function computeClosenessCentrality(graph: Graph): Map<string, number>
export function computeEigenvectorCentrality(graph: Graph, maxIterations = 100, tolerance = 1e-6): Map<string, number>
```
- Betweenness: Identifies "bridge" entities that connect otherwise separate clusters
- Closeness: Identifies entities that can quickly reach all others
- Eigenvector: Identifies entities connected to other important entities

### Knowledge Graph Edge Types

**File**: `src/storage/types.ts`
```typescript
export type KnowledgeEdgeType =
  | 'imports'           // A imports B
  | 'calls'             // A calls B
  | 'extends'           // A extends B
  | 'implements'        // A implements B
  | 'clone_of'          // A is clone of B
  | 'debt_related'      // A has similar debt to B
  | 'authored_by'       // A authored by B
  | 'reviewed_by'       // A reviewed by B
  | 'evolved_from'      // A evolved from B
  | 'co_changed'        // A and B change together
  | 'tests'             // A tests B
  | 'documents'         // A documents B
  | 'depends_on'        // A depends on B
  | 'similar_to'        // A is semantically similar to B
  | 'part_of';          // A is part of B
```

### Epistemic Graph Edge Types

**File**: `src/epistemics/types.ts`
```typescript
export type EdgeType =
  | 'supports'          // Source provides evidence for target
  | 'opposes'           // Source provides counter-evidence
  | 'assumes'           // Source assumes target is true
  | 'defeats'           // Source is a defeater for target
  | 'rebuts'            // Source directly contradicts target
  | 'undercuts'         // Source attacks the justification, not the claim
  | 'undermines'        // Source reduces confidence without full defeat
  | 'supersedes'        // Source replaces target
  | 'depends_on'        // Source depends on target being true
  | 'co_occurs';        // Source and target tend to appear together
```

### Evidence Ledger Relations

**File**: `src/epistemics/evidence_ledger.ts`
```typescript
export type EvidenceRelationType = 'supports' | 'derived_from' | 'contradicts' | 'supersedes';
```

---

## Per-Graph Importance Metrics

### 1. Code Graph Metrics (Existing)

These metrics are already implemented and used:

| Metric | What It Measures | Implementation |
|--------|------------------|----------------|
| **PageRank** | Recursive importance from incoming edges | `src/graphs/pagerank.ts` |
| **Betweenness Centrality** | Bridge entities connecting clusters | `src/graphs/centrality.ts` |
| **Closeness Centrality** | Entities close to all others | `src/graphs/centrality.ts` |
| **Eigenvector Centrality** | Connected to important entities | `src/graphs/centrality.ts` |
| **Afferent Coupling** | Incoming dependencies | `UniversalKnowledge.relationships.coupling.afferent` |
| **Efferent Coupling** | Outgoing dependencies | `UniversalKnowledge.relationships.coupling.efferent` |
| **Co-change Strength** | Temporal coupling | `src/graphs/temporal_graph.ts` |

### 2. Rationale Graph Metrics (NEW)

The rationale graph tracks WHY code exists and WHY it was designed a particular way. Sources include:
- ADRs (`src/ingest/adr_indexer.ts`)
- Code comments with rationale patterns
- Commit messages explaining decisions
- `EntityRationale` in `UniversalKnowledge`

#### 2.1 Decision Foundationality Score

**Definition**: A decision is "foundational" if many other decisions or code entities depend on it.

**Formula**:
```
FoundationalityScore(D) = α × SupportsCount(D) + β × DirectCodeDeps(D) + γ × TransitiveReach(D)

Where:
- SupportsCount(D) = number of other decisions that cite D as rationale
- DirectCodeDeps(D) = number of code entities that reference D in their rationale
- TransitiveReach(D) = BFS depth-weighted count of entities reachable through decision chains
- α, β, γ = weights (suggested: 0.4, 0.4, 0.2)
```

#### 2.2 Decision Activity Score

**Definition**: Whether a decision is still "active" (not superseded).

**Formula**:
```
ActivityScore(D) = {
  0.0 if status = 'superseded'
  0.3 if status = 'deprecated'
  1.0 if status = 'accepted'
  0.5 if status = 'proposed'
}
```

#### 2.3 Tradeoff Centrality

**Definition**: Measures how many competing concerns a decision balances.

**Formula**:
```
TradeoffCentrality(D) = |Tradeoffs(D)| × AvgTradeoffImpact(D)

Where:
- |Tradeoffs(D)| = count of explicit tradeoffs documented
- AvgTradeoffImpact(D) = average importance of gained vs sacrificed qualities
```

#### 2.4 Constraint Load

**Definition**: How many constraints this decision creates for other parts of the system.

**Formula**:
```
ConstraintLoad(D) = Σ(ConstraintSeverity(c) × AffectedEntities(c))
for each constraint c ∈ D.constraints

Where ConstraintSeverity:
- regulatory = 1.0
- business = 0.8
- technical = 0.6
- resource = 0.4
```

#### 2.5 Combined Rationale Importance

```
RationaleImportance(D) =
  w1 × FoundationalityScore(D) × ActivityScore(D) +
  w2 × TradeoffCentrality(D) +
  w3 × ConstraintLoad(D)

Suggested weights: w1=0.5, w2=0.3, w3=0.2
```

### 3. Epistemic Graph Metrics (NEW)

The epistemic graph tracks WHAT we know and HOW CERTAIN we are. It implements Pollock's defeater theory with explicit claim-evidence-defeater relationships.

#### 3.1 Epistemic Load (Support Fan-Out)

**Definition**: A claim is "load-bearing" if many other claims depend on it being true.

**Formula**:
```
EpistemicLoad(C) = Σ DependentWeight(d)
for each claim d where edge(C, d) ∈ {supports, assumes, depends_on}

Where DependentWeight(d) = 1 + 0.5 × EpistemicLoad(d)  // Recursive with damping
```

**Intuition**: If claim C supports claims D, E, F, and those claims each support other claims, C has high epistemic load.

#### 3.2 Evidence Depth

**Definition**: How many layers of evidence support this claim.

**Formula**:
```
EvidenceDepth(C) = max(ChainLength(path))
for each evidence chain path ending at C

EvidenceChainStrength(C) = Σ (ProductOfConfidences(path) / PathLength(path))
```

**Note**: Deeper chains are less reliable (confidence decays), but multiple deep chains provide robustness.

#### 3.3 Defeater Vulnerability

**Definition**: How vulnerable a claim is to defeat.

**Formula**:
```
DefeaterVulnerability(C) =
  ActiveDefeaterCount(C) × 0.3 +
  PotentialDefeaterCount(C) × 0.1 +
  UncoveredAssumptionCount(C) × 0.2

InverseVulnerability(C) = 1 - min(1, DefeaterVulnerability(C))
```

#### 3.4 Contradiction Centrality

**Definition**: How many contradictions this claim is involved in.

**Formula**:
```
ContradictionCentrality(C) = Σ ContradictionSeverity(x)
for each contradiction x involving C

Where ContradictionSeverity:
- blocking = 1.0
- significant = 0.5
- minor = 0.2
```

**Note**: High contradiction centrality indicates an unstable claim that needs resolution.

#### 3.5 Epistemic Importance

**Definition**: Overall importance in the epistemic graph.

**Formula**:
```
EpistemicImportance(C) =
  (EpistemicLoad(C) × EvidenceChainStrength(C) × InverseVulnerability(C)) /
  (1 + ContradictionCentrality(C))
```

**Key insight**: A claim with high epistemic load but also high vulnerability is a RISK. A claim with high load and high evidence strength is truly foundational.

#### 3.6 PageRank Adaptation for Epistemic Graphs

Standard PageRank can be adapted for epistemic graphs with edge-type-specific damping:

```
EpistemicPageRank(C) = (1-d)/N + d × Σ (EdgeWeight(e) × EpistemicPageRank(s) / OutDegree(s))
for each source s with edge e to C

Where EdgeWeight based on edge type:
- supports: 1.0
- assumes: 0.8
- depends_on: 0.9
- opposes: -0.5 (reduces rank)
- defeats: -1.0 (strongly reduces rank)
- supersedes: 0.0 (old claim transfers rank to new)
```

### 4. Organizational Graph Metrics (NEW)

The organizational graph tracks WHO is responsible for code and their expertise.

#### 4.1 Ownership Concentration (Truck Factor)

**Definition**: Risk metric for knowledge concentration.

**Formula**:
```
OwnershipConcentration(E) =
  1 - (ContributorEntropy(E) / log2(ContributorCount(E)))

ContributorEntropy(E) = -Σ p(c) × log2(p(c))
for each contributor c with ownership percentage p(c)
```

**Interpretation**:
- 1.0 = Single owner (high truck factor risk)
- 0.0 = Evenly distributed (low risk)

#### 4.2 Expertise Depth

**Definition**: How deep the expertise is for an entity.

**Formula**:
```
ExpertiseDepth(E) = Σ (ExpertScore(e) × RecencyWeight(e))
for each expert e associated with E

Where:
- ExpertScore(e) = commits × review_weight × time_in_codebase
- RecencyWeight(e) = exp(-λ × days_since_last_touch)
```

#### 4.3 Review Coverage

**Definition**: How well-reviewed is this entity.

**Formula**:
```
ReviewCoverage(E) = ReviewedCommits(E) / TotalCommits(E)
ReviewQuality(E) = Σ ReviewerExpertise(r) / ReviewCount(E)
```

#### 4.4 Organizational Importance

**Definition**: How important an entity is from an organizational perspective.

**Formula**:
```
OrgImportance(E) =
  α × (1 / OwnershipConcentration(E)) +  // Lower concentration = more important
  β × ExpertiseDepth(E) +
  γ × ReviewCoverage(E) × ReviewQuality(E)
```

---

## Cross-Graph Importance Propagation

### The Cross-Graph Reference Problem

Real knowledge objects span multiple graphs:
- A function (Code Graph) may be documented by a decision (Rationale Graph)
- A decision may be supported by claims (Epistemic Graph)
- An expert may own the function (Organizational Graph)

**Example Chain**:
```
Function: parseConfig()           [Code Graph, PageRank=0.8]
  └── Documented by: ADR-007      [Rationale Graph, Foundationality=0.9]
       └── Justified by: Claim C1 [Epistemic Graph, EpistemicLoad=0.7]
            └── Owned by: Alice    [Org Graph, ExpertiseDepth=0.95]
```

### Cross-Graph Importance Flow Algorithm

#### Phase 1: Compute Per-Graph Metrics

```
for each graph G in [Code, Rationale, Epistemic, Org]:
  compute_local_metrics(G)
  normalize_to_0_1(G.metrics)
```

#### Phase 2: Build Cross-Graph Edges

Identify edges that connect entities across graphs:

| Source Graph | Target Graph | Edge Type | Weight |
|-------------|--------------|-----------|--------|
| Code | Rationale | `documented_by_decision` | 1.0 |
| Code | Rationale | `constrained_by_decision` | 0.9 |
| Rationale | Epistemic | `justified_by_claim` | 0.8 |
| Rationale | Epistemic | `assumes_claim` | 0.6 |
| Epistemic | Code | `verified_by_test` | 0.9 |
| Epistemic | Code | `evidenced_by_code` | 0.7 |
| Code | Org | `owned_by` | 0.5 |
| Rationale | Org | `decided_by` | 0.5 |

#### Phase 3: Propagate Importance

Use a modified PageRank that respects cross-graph edges:

```python
def cross_graph_importance(entity, visited=set()):
    if entity in visited:
        return cached_importance[entity]

    visited.add(entity)

    # Start with local importance
    local = local_importance(entity, entity.graph)

    # Gather incoming cross-graph importance
    incoming = 0.0
    for edge in incoming_cross_graph_edges(entity):
        source_imp = cross_graph_importance(edge.source, visited)
        incoming += edge.weight * source_imp * damping_factor(edge.type)

    # Combine local and incoming
    combined = α × local + (1-α) × incoming

    # Store for memoization
    cached_importance[entity] = combined
    return combined
```

**Damping Factors by Edge Type**:
- `documented_by_decision`: 0.8 (high transfer)
- `justified_by_claim`: 0.7
- `assumes_claim`: 0.5 (assumptions are weaker)
- `verified_by_test`: 0.9 (tests are strong evidence)
- `owned_by`: 0.3 (ownership is contextual)

#### Phase 4: Bidirectional Importance

Importance can flow both ways:
- A foundational decision makes its documented code more important
- Critical code makes its documenting decision more important

```python
def bidirectional_importance(entity):
    forward = cross_graph_importance(entity)

    # Compute reverse importance
    reverse = 0.0
    for edge in outgoing_cross_graph_edges(entity):
        target_imp = cross_graph_importance(edge.target)
        reverse += reverse_weight(edge.type) * target_imp

    return β × forward + (1-β) × reverse
```

---

## Unified Importance Score

### Answer to RQ3: Per-Graph vs Unified

**Recommendation**: Compute BOTH.

1. **Per-Graph Metrics** are useful for graph-specific queries:
   - "What are the most foundational decisions?"
   - "Which claims have the highest epistemic load?"

2. **Unified Importance** is useful for cross-cutting queries:
   - "What knowledge is most critical to this project?"
   - "What should we prioritize validating?"

### Unified Importance Formula

```
UnifiedImportance(E) =
  normalize(
    w_code × CodeImportance(E) +
    w_rationale × RationaleImportance(E) +
    w_epistemic × EpistemicImportance(E) +
    w_org × OrgImportance(E) +
    w_cross × CrossGraphImportance(E)
  )

Default weights: w_code=0.3, w_rationale=0.2, w_epistemic=0.25, w_org=0.1, w_cross=0.15
```

### Importance Profile

Rather than a single number, provide an importance profile:

```typescript
interface ImportanceProfile {
  // Per-graph scores (0-1)
  code: {
    pageRank: number;
    betweenness: number;
    cochange: number;
  };
  rationale: {
    foundationality: number;
    activity: number;
    constraintLoad: number;
  };
  epistemic: {
    epistemicLoad: number;
    evidenceDepth: number;
    vulnerability: number;
  };
  org: {
    truckFactor: number;
    expertiseDepth: number;
    reviewCoverage: number;
  };

  // Unified scores
  unified: number;
  crossGraphInfluence: number;

  // Interpretive flags
  isLoadBearing: boolean;      // High epistemic load
  isFoundational: boolean;     // High rationale foundationality
  isAtRisk: boolean;           // High truck factor or high vulnerability
  needsValidation: boolean;    // High importance + low confidence
}
```

---

## Surfacing Load-Bearing Knowledge

### Agent-Facing Signals

When an agent queries LiBrainian, include importance signals in responses:

```typescript
interface KnowledgeResponse {
  entity: EntityKnowledge;

  // NEW: Importance signals for agent decision-making
  importance: {
    level: 'critical' | 'high' | 'medium' | 'low';
    profile: ImportanceProfile;

    // Plain-language explanations
    whyImportant: string[];  // e.g., "This claim supports 12 other claims"
    risks: string[];         // e.g., "Single owner (truck factor risk)"
    validationNeeded: string[]; // e.g., "Low confidence despite high load"
  };
}
```

### Proactive Warnings

When importance is high but confidence is low, emit warnings:

```typescript
interface LoadBearingWarning {
  entityId: string;
  warningType: 'high_load_low_confidence'
             | 'foundational_unverified'
             | 'high_vulnerability';

  message: string;
  suggestedAction: string;
  affectedEntities: string[];  // Entities that would be impacted
}
```

### Query Augmentation

When retrieving knowledge, boost load-bearing entities:

```python
def retrieve_with_importance(query, k=10):
    candidates = semantic_search(query, k=k*3)

    # Score by relevance AND importance
    for c in candidates:
        c.final_score = (
            0.7 * c.semantic_similarity +
            0.2 * c.importance.unified +
            0.1 * c.importance.crossGraphInfluence
        )

    return sorted(candidates, key=lambda c: c.final_score)[:k]
```

---

## Integration with Existing Infrastructure

### Storage Schema Extensions

Add to `KnowledgeGraphEdge`:

```typescript
interface KnowledgeGraphEdge {
  // Existing fields...

  // NEW: Cross-graph support
  graphType: 'code' | 'rationale' | 'epistemic' | 'org';
  crossGraphEdge: boolean;  // True if connects entities in different graphs
  propagatedImportance: number;  // Importance flowing through this edge
}
```

### New Edge Types for Cross-Graph

Extend `KnowledgeEdgeType`:

```typescript
export type KnowledgeEdgeType =
  // Existing...

  // NEW: Cross-graph edges
  | 'documented_by_decision'    // Code -> Rationale
  | 'constrained_by_decision'   // Code -> Rationale
  | 'justified_by_claim'        // Rationale -> Epistemic
  | 'assumes_claim'             // Rationale -> Epistemic
  | 'verified_by_test'          // Epistemic -> Code
  | 'evidenced_by_code'         // Epistemic -> Code
  | 'owned_by_expert'           // Any -> Org
  | 'decided_by';               // Rationale -> Org
```

### Importance Computation Pipeline

```typescript
interface ImportanceComputationPipeline {
  // Phase 1: Collect graphs
  collectCodeGraph(storage: LibrarianStorage): Promise<Graph>;
  collectRationaleGraph(storage: LibrarianStorage): Promise<Graph>;
  collectEpistemicGraph(evidenceLedger: IEvidenceLedger): Promise<Graph>;
  collectOrgGraph(storage: LibrarianStorage): Promise<Graph>;

  // Phase 2: Compute per-graph metrics
  computeCodeMetrics(graph: Graph): Map<string, CodeImportance>;
  computeRationaleMetrics(graph: Graph): Map<string, RationaleImportance>;
  computeEpistemicMetrics(graph: Graph): Map<string, EpistemicImportance>;
  computeOrgMetrics(graph: Graph): Map<string, OrgImportance>;

  // Phase 3: Cross-graph propagation
  buildCrossGraphEdges(): CrossGraphEdge[];
  propagateImportance(edges: CrossGraphEdge[]): Map<string, CrossGraphImportance>;

  // Phase 4: Unify
  computeUnifiedImportance(): Map<string, UnifiedImportance>;
  computeImportanceProfiles(): Map<string, ImportanceProfile>;
}
```

### Integration with Evidence Ledger

Record importance computations in the evidence ledger:

```typescript
const importanceEvidence: CalibrationEvidence = {
  operationType: 'importance_computation',
  predictions: entities.map(e => ({
    predicted: e.importance.unified,
    actual: e.observedImpact  // From historical data
  })),
  ece: computeECE(predictions),
  brierScore: computeBrier(predictions),
  sampleSize: entities.length
};

await evidenceLedger.append({
  kind: 'calibration',
  payload: importanceEvidence,
  provenance: { source: 'system_observation', method: 'importance_calibration' },
  relatedEntries: []
});
```

---

## Theoretical Foundations

### Argumentation Theory

The epistemic graph metrics draw from:

- **Dung (1995)**: "On the Acceptability of Arguments" - Defines attack relations and acceptability semantics
- **Pollock (1987)**: "Defeasible Reasoning" - Distinguishes rebutting vs undercutting defeaters

### Epistemic Load

The concept of "epistemic load" is analogous to:

- **Load-bearing structures** in architecture: Remove a load-bearing wall and the building collapses
- **Single points of failure** in distributed systems

### Argumentative Centrality

Research on argumentation centrality:

- **Rahwan & Simari (2009)**: Argumentation in AI - Computational models of argument
- **Cayrol & Lagasquie-Schiex (2005)**: Gradual acceptability in argumentation frameworks

### PageRank Variants for Knowledge Graphs

- **ObjectRank** (Balmin et al., 2004): Authority flow in knowledge graphs
- **TrustRank** (Gyöngyi et al., 2004): Trust propagation, relevant for epistemic graphs

---

## Implementation Roadmap

### Phase 1: Foundation (Sprint 1-2)

| Task | Description | Deliverable |
|------|-------------|-------------|
| Define interfaces | TypeScript interfaces for all importance types | `src/graphs/importance_types.ts` |
| Rationale metrics | Implement foundationality, activity, tradeoff centrality | `src/graphs/rationale_importance.ts` |
| Epistemic metrics | Implement epistemic load, evidence depth, vulnerability | `src/graphs/epistemic_importance.ts` |

### Phase 2: Cross-Graph (Sprint 3-4)

| Task | Description | Deliverable |
|------|-------------|-------------|
| Cross-graph edges | Define and extract cross-graph edge types | Schema migration |
| Importance propagation | Implement bidirectional propagation algorithm | `src/graphs/cross_graph_propagation.ts` |
| Unified score | Combine all metrics into unified importance | `src/graphs/unified_importance.ts` |

### Phase 3: Integration (Sprint 5-6)

| Task | Description | Deliverable |
|------|-------------|-------------|
| Query augmentation | Boost retrieval by importance | `src/api/query.ts` changes |
| Agent warnings | Surface load-bearing warnings | `src/api/importance_warnings.ts` |
| Evidence ledger | Record importance calibration | Evidence entries |

### Phase 4: Validation (Sprint 7-8)

| Task | Description | Deliverable |
|------|-------------|-------------|
| Calibration | Validate importance predicts actual impact | Calibration curves |
| Agent testing | Test agent decision-making with importance signals | Integration tests |
| Documentation | Developer and agent-facing documentation | Docs |

---

## Key Insights

### Insight 1: Epistemic Load is the Missing Metric

Code centrality (PageRank) tells us what code is important structurally. But **epistemic load** tells us what knowledge is important for understanding the system. A claim about error handling semantics might have low code centrality but support 10 other claims - making it epistemic load-bearing.

### Insight 2: Cross-Graph Edges are First-Class

The connection between a function and its documenting ADR is as important as the call edge between two functions. Cross-graph edges should be stored and queried with the same infrastructure.

### Insight 3: Importance Profiles, Not Single Scores

Different stakeholders care about different dimensions:
- **Developers**: Code centrality, truck factor
- **Architects**: Decision foundationality, constraint load
- **AI Agents**: Epistemic load, vulnerability, validation needs

Provide the full profile, not just a unified number.

### Insight 4: Load-Bearing + Low Confidence = Risk

The most actionable insight from multi-graph importance is identifying high-importance, low-confidence knowledge. This combination signals:
- Knowledge that the system depends on
- But that hasn't been validated
- And thus represents epistemic risk

---

## Appendix: Example Queries

### "What decisions are foundational?"

```sql
SELECT d.id, d.title,
       computeFoundationality(d) as foundationality,
       computeActivity(d) as activity
FROM decisions d
WHERE computeFoundationality(d) > 0.7
  AND computeActivity(d) > 0.8
ORDER BY foundationality DESC
LIMIT 10;
```

### "What claims are load-bearing but vulnerable?"

```sql
SELECT c.id, c.proposition,
       computeEpistemicLoad(c) as load,
       computeVulnerability(c) as vulnerability
FROM claims c
WHERE computeEpistemicLoad(c) > 0.7
  AND computeVulnerability(c) > 0.5
ORDER BY load * vulnerability DESC
LIMIT 10;
```

### "What code depends on unverified claims?"

```sql
SELECT code.id, code.name,
       claim.id, claim.proposition, claim.confidence
FROM code
JOIN cross_graph_edges cge ON cge.target = code.id
JOIN claims claim ON cge.source = claim.id
WHERE claim.confidence.type = 'absent'
  AND cge.type IN ('verified_by_test', 'evidenced_by_code')
ORDER BY computeCodeImportance(code) DESC;
```

---

## References

1. Dung, P.M. (1995). "On the Acceptability of Arguments and its Fundamental Role in Nonmonotonic Reasoning, Logic Programming and n-Person Games." Artificial Intelligence, 77(2), 321-357.

2. Pollock, J.L. (1987). "Defeasible Reasoning." Cognitive Science, 11(4), 481-518.

3. Page, L., Brin, S., Motwani, R., & Winograd, T. (1999). "The PageRank Citation Ranking: Bringing Order to the Web." Stanford InfoLab.

4. Balmin, A., Hristidis, V., & Papakonstantinou, Y. (2004). "ObjectRank: Authority-Based Keyword Search in Databases." VLDB.

5. Rahwan, I., & Simari, G. R. (Eds.). (2009). "Argumentation in Artificial Intelligence." Springer.

6. Cayrol, C., & Lagasquie-Schiex, M. C. (2005). "On the Acceptability of Arguments in Bipolar Argumentation Frameworks." ECSQARU.

---

## Changelog

- 2026-01-30: Initial research document completed
