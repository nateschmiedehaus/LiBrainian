# LiBrainian Capability Gap Analysis

**Date**: 2026-01-30
**Purpose**: Assess current capabilities vs. planned enhancements
**Status**: Assessment Complete

---

## Executive Summary

LiBrainian has **substantial existing infrastructure** that serves as a strong foundation for the planned enhancements. The gap analysis reveals that most planned features have partial implementations or clear integration points. The largest gaps are in **argumentative edge types** (new concept) and **explicit multi-perspective filtering** (infrastructure exists but not surfaced).

**Overall Assessment**: 60-70% of required infrastructure exists. Remaining work is primarily integration and enhancement, not greenfield development.

---

## 1. Gap Analysis Table

### 1.1 Graph Infrastructure

| Feature | Current State | Needed | Gap Size |
|---------|---------------|--------|----------|
| **PageRank** | Full implementation (`src/graphs/pagerank.ts`) with damping factor, convergence | Ready to use | None |
| **Betweenness Centrality** | Full implementation (`src/graphs/centrality.ts`) | Ready to use | None |
| **Closeness Centrality** | Full implementation | Ready to use | None |
| **Eigenvector Centrality** | Full implementation | Ready to use | None |
| **Community Detection** | Louvain algorithm (`src/graphs/communities.ts`) with modularity optimization | Ready to use | None |
| **Temporal Graph (Co-change)** | Git-based co-change analysis (`src/graphs/temporal_graph.ts`) | Ready to use | None |
| **Knowledge Graph Builder** | Comprehensive (`src/graphs/knowledge_graph.ts`) - builds from imports, calls, clones, co-change, authorship, debt | Ready to use | None |
| **Argument Graph (Toulmin-IBIS)** | Not implemented | 8 edge types: supports, challenges, qualifies, etc. | **Large** |
| **Edge Type: supports** | Not in `KnowledgeEdgeType` | Argumentative support relationship | Medium |
| **Edge Type: challenges** | Not implemented | Argumentative challenge relationship | Medium |
| **Edge Type: qualifies** | Not implemented | Conditional/qualifier relationship | Medium |
| **Impact Propagation** | Basic BFS in `knowledge_graph.ts` and `impact.ts` | Weighted decay, risk scoring | Small |

**Current `KnowledgeEdgeType` (15 types)**:
```typescript
'imports' | 'calls' | 'extends' | 'implements' | 'clone_of' | 'debt_related' |
'authored_by' | 'reviewed_by' | 'evolved_from' | 'co_changed' | 'tests' |
'documents' | 'depends_on' | 'similar_to' | 'part_of'
```

**Needed Argument Edge Types (8 new)**:
- `supports` - Claim A supports Claim B
- `challenges` - Claim A contradicts Claim B
- `qualifies` - Claim A limits scope of Claim B
- `rebuts` - Evidence against claim
- `undercuts` - Attacks the inference, not conclusion
- `warrants` - Reasoning principle connecting data to claim
- `backs` - Evidence supporting the warrant
- `grounds` - Data/evidence for a claim

---

### 1.2 Knowledge Extraction

| Feature | Current State | Needed | Gap Size |
|---------|---------------|--------|----------|
| **Rationale Extractor** | Full LLM-based (`src/knowledge/extractors/rationale_extractor.ts`) - extracts ADRs, constraints, tradeoffs, alternatives, assumptions, risks | Produces rationale nodes | Small |
| **Evidence Collector** | Comprehensive (`evidence_collector.ts`) - collects from all extractors, tracks defeaters | Ready to use | None |
| **Security Extractor** | LLM-enhanced vulnerability detection | Ready to use | None |
| **Quality Extractor** | Complexity metrics, code smells | Ready to use | None |
| **Testing Extractor** | Test linkage, assertions | Ready to use | None |
| **Traceability Extractor** | Requirements, issues, docs linkage | Ready to use | None |
| **Identity Extractor** | Entity identification | Ready to use | None |
| **Semantics Extractor** | Purpose, behavior understanding | Ready to use | None |
| **Argument Edge Production** | Not implemented | Convert rationale to graph edges | **Medium** |
| **Claim-Evidence Linking** | Partial in evidence_collector | Explicit claim-supports-evidence edges | Small |

**Key Finding**: Rationale extractor produces `EntityRationale` with:
- `ArchitecturalDecision[]` - ADRs
- `RationaleConstraint[]` - technical, business, regulatory constraints
- `Tradeoff[]` - gained/sacrificed pairs
- `ConsideredAlternative[]` - rejected approaches
- `Assumption[]` - validated/unvalidated
- `AcceptedRisk[]` - with likelihood, impact

These **exist as node properties, not graph edges**. The gap is converting these to explicit `KnowledgeGraphEdge` instances.

---

### 1.3 Query System

| Feature | Current State | Needed | Gap Size |
|---------|---------------|--------|----------|
| **Multi-Signal Scorer** | 11 signals (`src/query/multi_signal_scorer.ts`): semantic, structural, history, recency, keyword, domain, entity_type, ownership, risk, test, dependency | Ready, extensible | None |
| **Signal Weight Learning** | Feedback-based weight adjustment | Ready to use | None |
| **Query Classification** | Meta/code query detection (`classifyQueryIntent` in query.ts) | Ready to use | None |
| **Document Bias** | Boost for meta-queries | Ready to use | None |
| **Multi-Vector Representations** | Purpose, semantic, structural, dependency, usage vectors | Ready to use | None |
| **Confidence Calibration** | Bayesian calibration, uncertainty metrics | Ready to use | None |
| **Graph-Based Scoring** | PageRank, centrality used in candidate scoring | Ready to use | None |
| **Perspective Filter** | Implicit via task types | Explicit perspective parameter | Small |
| **Importance Weighting by Graph** | Basic PageRank weighting | Multi-graph importance (rationale, epistemic, organizational) | Medium |
| **Query-Time Facets** | Not exposed | Faceted retrieval interface | Small |

**Key Finding**: The `MultiSignalScorer` is highly extensible - adding new signals is straightforward:
```typescript
// To add a new signal:
scorer.registerComputer(new MyCustomSignalComputer());
```

---

### 1.4 Pattern Detection (T-Patterns)

| Feature | Current State | Needed | Gap Size |
|---------|---------------|--------|----------|
| **T-01 to T-06 (Navigation)** | Implemented | Ready to use | None |
| **T-07 to T-12 (Understanding)** | Implemented | Ready to use | None |
| **T-13 to T-18 (Modification)** | Implemented | Ready to use | None |
| **T-19 to T-24 (Bug Investigation)** | Implemented | Ready to use | None |
| **T-25 to T-30 (Hard Scenarios)** | Implemented (metaprogramming, framework, security, performance, circular deps, legacy) | Ready to use | None |
| **7 Perspectives Mapping** | T-pattern categories map to 5 perspectives | Add Security Reviewer (T-27), Architect (T-08) perspectives | Small |

**T-Pattern to Perspective Mapping**:
| Perspective | Primary T-Patterns |
|-------------|-------------------|
| Bug Investigation | T-19 to T-24 |
| Security Reviewer | T-27, security extractor |
| Performance | T-28 |
| Architect | T-08, T-09, T-29 |
| Code Quality | T-17, quality extractor |
| Modification Support | T-13 to T-18 |
| Navigation | T-01 to T-06 |

---

### 1.5 Strategic Analysis

| Feature | Current State | Needed | Gap Size |
|---------|---------------|--------|----------|
| **Prioritization Engine** | Comprehensive (`src/strategic/prioritization.ts`) - 8 weighted factors, rule-based adjustments | Ready to use | None |
| **Impact Knowledge** | Full implementation (`src/knowledge/impact.ts`) - change impact, blast radius, test impact, risk assessment | Ready to use | None |
| **Architecture Decisions** | File exists (`src/strategic/architecture_decisions.ts`) | Check implementation | Unknown |
| **Technical Debt Metrics** | Storage schema exists, debt hotspots in knowledge_graph.ts | Ready to use | None |
| **Work Primitives** | Comprehensive work item tracking | Ready to use | None |
| **Impact Propagation** | Basic BFS traversal | Weighted decay with edge type consideration | Small |

---

### 1.6 Usage Weighting

| Feature | Current State | Needed | Gap Size |
|---------|---------------|--------|----------|
| **Access Tracking** | `recordContextPackAccess()` in storage | Ready to use | None |
| **Query Cache** | `QueryCacheEntry` with access count | Ready to use | None |
| **Confidence Updates** | `updateConfidence()` with delta and reason | Ready to use | None |
| **Evolution Outcomes** | `EvolutionOutcome` for learning | Ready to use | None |
| **Learned Missing Context** | `recordLearnedMissing()` | Ready to use | None |
| **Usage Signal in Scoring** | `RecencySignalComputer` uses `lastAccessed` | Ready to use | None |
| **Historical Usage Weighting** | Implicit in confidence | Explicit usage weight factor | Small |

---

## 2. Integration Points

### 2.1 Where New Features Plug In

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         LiBrainian INTEGRATION MAP                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐     │
│  │ KNOWLEDGE        │     │ GRAPH            │     │ QUERY            │     │
│  │ EXTRACTORS       │────>│ INFRASTRUCTURE   │────>│ SYSTEM           │     │
│  ├──────────────────┤     ├──────────────────┤     ├──────────────────┤     │
│  │ rationale_       │     │ knowledge_graph  │     │ multi_signal_    │     │
│  │ extractor.ts     │     │ .ts              │     │ scorer.ts        │     │
│  │ ├─ EntityRationale     │ ├─ KnowledgeEdge │     │ ├─ SignalComputer│     │
│  │ │  (node props)  │     │ │  (15 types)    │     │ │  (11 signals)  │     │
│  │ │                │     │ │                │     │ │                │     │
│  │ └─[GAP: Convert  │─────┼─>[ADD: Argument  │─────┼─>[ADD: Rationale │     │
│  │    to edges]     │     │   edge types]    │     │   signal]        │     │
│  └──────────────────┘     └──────────────────┘     └──────────────────┘     │
│                                   │                         │               │
│                                   ▼                         ▼               │
│  ┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐     │
│  │ STORAGE          │     │ PATTERNS         │     │ API              │     │
│  │ LAYER            │     │ ANALYSIS         │     │ LAYER            │     │
│  ├──────────────────┤     ├──────────────────┤     ├──────────────────┤     │
│  │ storage/types.ts │     │ patterns.ts      │     │ query.ts         │     │
│  │ ├─ KnowledgeEdge │     │ t_patterns.ts    │     │ ├─ classifyQuery │     │
│  │ │  QueryOptions  │     │ ├─ T-01 to T-30  │     │ │  Intent()      │     │
│  │ │                │     │ │                │     │ │                │     │
│  │ └─[ADD: Argument │     │ └─[MAP: T-pattern│     │ └─[ADD: perspec- │     │
│  │    edge storage] │     │   to perspectives│     │   tive parameter]│     │
│  └──────────────────┘     └──────────────────┘     └──────────────────┘     │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Specific Integration Files

| New Feature | Primary Integration Point | Secondary Files |
|-------------|---------------------------|-----------------|
| **Argument Edges** | `src/storage/types.ts` (add to `KnowledgeEdgeType`) | `knowledge_graph.ts`, `rationale_extractor.ts` |
| **Argument Graph Builder** | `src/graphs/knowledge_graph.ts` (new function) | `rationale_extractor.ts` |
| **Multi-Graph Importance** | `src/query/multi_signal_scorer.ts` (new signal computer) | `scoring.ts` |
| **Perspective Filter** | `src/api/query.ts` (add parameter) | `classifyQueryIntent()` |
| **Faceted Retrieval** | `src/api/query_interface.ts` | `query.ts` |
| **Impact Propagation Decay** | `src/knowledge/impact.ts` | `knowledge_graph.ts` |

---

## 3. Risk Areas

### 3.1 Fragile or Hard to Extend

| Area | Risk Level | Concern | Mitigation |
|------|------------|---------|------------|
| **query.ts** | High | 43K+ tokens, monolithic | File is large but well-organized; consider splitting by concern |
| **Storage Schema Migrations** | Medium | Adding new edge types requires migration | Schema design already supports extension via type union |
| **LLM-Required Extractors** | Medium | Rationale, semantics require LLM - fails without | Already has fallback behavior documented |
| **Confidence Calculation** | Low | Complex geometric mean with defeaters | Well-tested, isolated in `evidence_collector.ts` |
| **T-Pattern Complexity** | Low | 30 patterns, but modular | Each pattern is independent function |

### 3.2 Technical Debt Risks

1. **Large Files**: `query.ts` (43K tokens) could benefit from splitting
2. **Implicit Perspectives**: Task types implicitly define perspectives but not exposed
3. **Edge Type Proliferation**: 15 current + 8 proposed = 23 edge types (manageable but watch complexity)

---

## 4. Quick Wins (80% Done)

### 4.1 Immediate Completions (< 1 day each)

| Feature | Current State | Work Remaining |
|---------|---------------|----------------|
| **Perspective Parameter** | `AnalysisTaskType` exists | Add `perspective` field to `LibrarianQuery`, map to task types |
| **T-Pattern to Perspective** | T-patterns implemented | Create mapping object and filter function |
| **Usage Weight Signal** | `RecencySignalComputer` exists | Enhance with access count from `QueryCacheEntry` |
| **Rationale Signal** | Rationale extracted | Add `RationaleSignalComputer` using `EntityRationale` presence/quality |

### 4.2 Medium Effort (1-3 days each)

| Feature | Current State | Work Remaining |
|---------|---------------|----------------|
| **Argument Edge Types** | Schema designed (research doc) | Add 8 types to `KnowledgeEdgeType`, update storage |
| **Argument Graph Builder** | `buildKnowledgeGraph()` exists | Add `buildFromRationale()` that converts `EntityRationale` to edges |
| **Multi-Graph Importance** | PageRank exists | Create composite score from structural + rationale + organizational graphs |
| **Faceted Query Interface** | `QueryOptions` exists | Add facet specification, expose in API |

### 4.3 Larger Effort (1 week+)

| Feature | Current State | Work Remaining |
|---------|---------------|----------------|
| **Full Toulmin-IBIS Implementation** | Research complete | Implement claim-warrant-backing extraction, undercutter detection |
| **Impact Propagation with Decay** | Basic BFS exists | Add edge-type weights, exponential decay, threshold propagation |
| **Epistemic Graph Metrics** | Basic confidence exists | Add graph-based epistemic metrics (support chains, rebuttal networks) |

---

## 5. Recommended Implementation Order

### Phase 1: Quick Integration (Week 1)
1. Add `perspective` parameter to `LibrarianQuery`
2. Create T-pattern to perspective mapping
3. Add `RationaleSignalComputer` to multi-signal scorer
4. Enhance usage tracking in query scoring

### Phase 2: Edge Infrastructure (Week 2)
1. Add argument edge types to `KnowledgeEdgeType`
2. Implement `buildFromRationale()` in knowledge graph
3. Update storage queries to support new edge types
4. Add edge-type filtering to `getKnowledgeEdges()`

### Phase 3: Multi-Graph Importance (Week 3)
1. Compute separate PageRank for rationale subgraph
2. Create composite importance score
3. Add organizational graph (authorship) importance
4. Integrate into query scoring

### Phase 4: Impact & Epistemic (Week 4+)
1. Implement weighted impact propagation
2. Add epistemic graph metrics
3. Build argumentation semantics (grounded extensions)
4. Integration testing across all perspectives

---

## 6. Conclusion

LiBrainian's codebase is **well-architected for extension**. The planned enhancements align naturally with existing:

- **Graph infrastructure**: Full centrality, community detection, knowledge graph builder
- **Extraction pipeline**: Rationale already captured, just needs edge conversion
- **Query system**: Multi-signal scorer ready for new signals
- **Pattern detection**: T-patterns cover all 7 perspectives
- **Storage**: Schema designed for extension via type unions

**The largest genuine gaps are:**
1. **Argument edge types** (not conceptually present)
2. **Explicit perspective parameter** (infrastructure exists, not exposed)
3. **Rationale-to-edge conversion** (data exists, not graphified)

**Estimated effort for complete implementation**: 4-6 weeks with 1-2 engineers.
