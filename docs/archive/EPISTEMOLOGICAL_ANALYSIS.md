# LiBrainian Epistemological Analysis

**Status:** Research Report
**Date:** 2026-01-27
**Scope:** Analysis of knowledge representation and reasoning completeness for software understanding

---

## Executive Summary

LiBrainian implements a sophisticated epistemological framework grounded in academic research (Pollock's defeaters, Dung's argumentation theory, KDD 2025 UQ survey). The system provides strong coverage for **propositional knowledge**, **uncertainty handling**, and **provenance tracking**, but has significant gaps in **counterfactual reasoning**, **causal reasoning**, and **analogical reasoning**. This analysis maps the ten epistemological dimensions against LiBrainian's current implementation and identifies research-backed improvements.

---

## 1. Epistemological Coverage Matrix

| Dimension | Representation | Reasoning | Coverage | Gap Severity |
|-----------|---------------|-----------|----------|--------------|
| **Propositional Knowledge** | UniversalKnowledge schema (150+ fields) | Evidence graph claims | **Strong** | Low |
| **Procedural Knowledge** | SemanticMechanism, steps[], approach | LLM synthesis for mechanism | **Moderate** | Medium |
| **Declarative Knowledge** | ContractBehavior (pre/post/invariants) | Contract verification | **Moderate** | Medium |
| **Tacit Knowledge** | TribalKnowledge, Gotcha, Tip types | Manual + LLM synthesis | **Weak** | High |
| **Uncertainty Handling** | ConfidenceValue (5 types), calibration | Principled derivation rules D1-D7 | **Strong** | Low |
| **Provenance Tracking** | EvidenceLedger (append-only), chains | Full audit trail | **Strong** | Low |
| **Temporal Knowledge** | EntityHistory, commits, evolution | Freshness decay, staleness | **Moderate** | Medium |
| **Counterfactual Reasoning** | ImpactKnowledge (blast radius) | Static dependency analysis | **Weak** | High |
| **Causal Reasoning** | (Not implemented) | (Not implemented) | **Absent** | Critical |
| **Analogical Reasoning** | similar[] via embeddings | Cosine similarity only | **Weak** | High |

---

## 2. Detailed Analysis by Dimension

### 2.1 Propositional Knowledge (Facts about code - what IS)

**How LiBrainian Represents This:**
- `UniversalKnowledge` interface with 150+ structured fields organized into 13 domains:
  - Identity, Semantics, Contract, Relationships, Quality, Security, Runtime, Testing, History, Ownership, Rationale, Context, Traceability
- Claims (`Claim` type) with typed propositions: semantic, structural, behavioral, quality, security, contractual, relational, temporal, ownership, provenance
- `KNOWLEDGE_QUESTION_MAP` explicitly maps questions to answering fields

**How LiBrainian Reasons About This:**
- Evidence graph with supports/opposes/assumes edges
- Claims validated via AST parsing, test results, git history, LLM synthesis
- Contradictions tracked explicitly (never silently reconciled)

**Gaps:**
- No representation for *negative facts* (what code explicitly does NOT do)
- Limited support for *countable facts* (e.g., "exactly N instances of pattern X")

**Research Support:**
- Kythe/Glean storage patterns for durable indexing (referenced in UNDERSTANDING_LAYER.md)
- ISO 25010 Software Quality Model for quality domains

### 2.2 Procedural Knowledge (How things work - HOW)

**How LiBrainian Represents This:**
```typescript
interface SemanticMechanism {
  explanation: string;        // Plain English how it works
  algorithm?: string;         // Named algorithm if applicable
  steps?: string[];           // Step-by-step breakdown
  approach: string;           // High-level implementation approach
  approachRationale: string;  // Why this approach
  patterns: string[];         // Design patterns used
  dataStructures: string[];   // Key data structures
  stateManagement?: string;   // How state is managed
}
```

**How LiBrainian Reasons About This:**
- LLM synthesis with evidence grounding (mandated for semantic content)
- Pattern detection via `PatternKnowledge.queryWithLLM()`
- Algorithm complexity analysis (time/space Big-O)

**Gaps:**
- No execution trace integration (static analysis only)
- Cannot simulate or step through procedures
- No representation for alternative execution paths (conditional branches)

**Research Support:**
- Program slicing research (Weiser 1984) could inform execution path tracking
- Symbolic execution for path enumeration

### 2.3 Declarative Knowledge (Rules and constraints - MUST/SHOULD)

**How LiBrainian Represents This:**
```typescript
interface ContractBehavior {
  preconditions: Condition[];   // Must be true before call
  postconditions: Condition[];  // Will be true after call
  invariants: Condition[];      // Always true
  sideEffects: SideEffect[];    // External state changes
}

interface PrimitiveContract {
  preconditions: Precondition[];
  postconditions: Postcondition[];
  invariants: Invariant[];
  errorSpec: ErrorSpec;
  performanceBounds: PerformanceBounds;
}
```

**How LiBrainian Reasons About This:**
- Design-by-contract execution via `ContractExecutor`
- Precondition/postcondition verification
- ContractViolation exceptions with detailed context

**Gaps:**
- No formal verification (SMT solving)
- Cannot derive implied constraints from multiple rules
- No constraint propagation across call boundaries
- SHOULD vs MUST distinction not formalized (all treated as invariants)

**Research Support:**
- Hoare Logic for pre/post-condition reasoning
- Z3 SMT solver integration for formal verification
- JML/Spec# for specification languages

### 2.4 Tacit Knowledge (Implicit conventions - ASSUMED)

**How LiBrainian Represents This:**
```typescript
interface TribalKnowledgeInfo {
  tribal: TribalKnowledge[];
  gotchas: Gotcha[];
  tips: Tip[];
  learningPath: LearningStep[];
}

interface Gotcha {
  description: string;
  consequence: string;
  prevention: string;
}
```

**How LiBrainian Reasons About This:**
- Manual entry with importance classification (critical/important/nice-to-know)
- LLM synthesis for discovering undocumented conventions
- NamingConvention analysis for implicit style rules

**Gaps:**
- No automated discovery of tacit knowledge from behavior patterns
- Cannot learn from code review feedback
- No representation for "unwritten rules" that span multiple files
- Missing: organizational knowledge about "who to ask"

**Research Support:**
- Knowledge elicitation techniques from expert systems
- Mining implicit knowledge from developer forums (MSR research)
- Learning from code review comments (ICSE papers on mining software repositories)

### 2.5 Uncertainty Handling (Confidence and calibration)

**How LiBrainian Represents This:**
```typescript
type ConfidenceValue =
  | DeterministicConfidence  // 1.0 or 0.0 (certain)
  | DerivedConfidence        // Computed via formula
  | MeasuredConfidence       // Empirically calibrated
  | BoundedConfidence        // Range with citation
  | AbsentConfidence;        // Honest "don't know"

interface UncertaintyProfile {
  aleatoric: number;   // Inherent randomness (irreducible)
  epistemic: number;   // Model's lack of knowledge (reducible)
  reasoning?: number;  // Divergence in reasoning paths
  calibration?: CalibrationMetrics;
  reducibleBy?: UncertaintyReducer[];
}
```

**How LiBrainian Reasons About This:**
- Derivation rules D1-D7:
  - D1: Syntactic operations -> Deterministic (1.0 or 0.0)
  - D2: Sequential composition -> min(steps)
  - D3: Parallel-all -> product(branches)
  - D4: Parallel-any -> 1 - product(1-branches)
  - D5: LLM before calibration -> Absent
  - D6: LLM after calibration -> Measured
  - D7: Boundary enforcement utilities
- Calibration curves with ECE/MCE metrics
- Raw numbers forbidden - provenance required for all confidence values

**Gaps:**
- No second-order uncertainty (confidence in confidence estimates)
- Limited Bayesian updating capability
- No ensemble disagreement tracking for epistemic vs aleatoric decomposition

**Research Support:**
- "Uncertainty Quantification and Confidence Calibration in LLMs" (KDD 2025)
- "From Aleatoric to Epistemic" (arXiv 2501.03282)
- Expected Calibration Error (ECE) metric standard

### 2.6 Provenance Tracking (Source of knowledge)

**How LiBrainian Represents This:**
```typescript
interface EvidenceEntry {
  id: EvidenceId;
  timestamp: Date;
  kind: EvidenceKind;
  payload: EvidencePayload;
  provenance: EvidenceProvenance;
  confidence?: ConfidenceValue;
  relatedEntries: EvidenceId[];
  sessionId?: SessionId;
}

interface EvidenceProvenance {
  source: ProvenanceSource; // ast_parser | llm_synthesis | embedding_search | user_input | tool_output
  method: string;
  agent?: { type: string; identifier: string; version?: string };
  inputHash?: string;
  config?: Record<string, unknown>;
}
```

**How LiBrainian Reasons About This:**
- Append-only evidence ledger (never modified or deleted)
- Evidence chains for any claim
- LLM mandate audit: all semantic outputs require provider/modelId/promptDigest/timestamp
- Session tracking for reproducibility

**Gaps:**
- No provenance compression for long chains
- Cannot easily diff two provenance chains
- No visualization of provenance graphs

**Research Support:**
- PROV-O ontology for provenance
- Kythe for cross-language indexing with provenance

### 2.7 Temporal Knowledge (Changes over time)

**How LiBrainian Represents This:**
```typescript
interface EntityHistory {
  created: HistoryEvent;
  lastModified: HistoryEvent;
  commits: CommitSummary[];
  evolution: EvolutionInfo;
  plannedChanges: PlannedChange[];
}

// Freshness decay formula
function computeFreshness(generatedAt, now, halfLifeMs) {
  const ageMs = now - generatedAt;
  return Math.pow(0.5, ageMs / halfLifeMs);
}
```

**How LiBrainian Reasons About This:**
- Staleness thresholds per domain (Identity: 0, Relationships: 1min, Semantics: 1hr, Quality: 1day)
- Freshness decay with exponential half-life
- Staleness defeaters auto-activated
- Cochange analysis for temporal relationships

**Gaps:**
- No temporal reasoning about "when X happened relative to Y"
- Cannot answer "what was the state at time T"
- No trend projection (only current state + history)
- Missing: version-aware queries (git ref binding)

**Research Support:**
- Temporal logic (LTL/CTL) for reasoning about sequences
- Git mining research (Mockus, Nagappan)
- Software evolution analysis

### 2.8 Counterfactual Reasoning (What-if analysis)

**How LiBrainian Represents This:**
```typescript
interface ImpactQuery {
  type: 'change_impact' | 'blast_radius' | 'test_impact' | 'risk_assessment' | 'safe_changes' | 'breaking_changes';
  target: string;
  changeType?: 'modify' | 'delete' | 'rename' | 'move';
  depth?: number;
}
```

**How LiBrainian Reasons About This:**
- Static dependency traversal (BFS through import graph)
- Blast radius calculation (% of codebase affected)
- Risk factors aggregation (centrality, test coverage, exports)
- Test impact inference from file relationships

**Gaps:**
- **Cannot simulate actual changes** (static analysis only)
- No "what if I changed this signature" analysis
- Cannot predict behavioral changes from modifications
- No mutation testing integration
- Missing: hypothetical scenario modeling

**Research Support:**
- Change impact analysis (Arnold & Bohner)
- Mutation testing for behavioral simulation
- Slicing techniques for scope determination
- Counterfactual explanations in ML (Wachter et al.)

### 2.9 Causal Reasoning (Why things happen)

**How LiBrainian Represents This:**
- **Not explicitly implemented**
- Partial support through:
  - SBFL (Ochiai) mentioned for failure attribution
  - `Rationale` type with decisions/constraints/tradeoffs
  - Commit messages for "why" of changes

**How LiBrainian Reasons About This:**
- LLM synthesis for rationale extraction (opportunistic)
- Manual ADR linking
- No systematic causal model

**Gaps:**
- **No causal graphs or Bayesian networks**
- Cannot distinguish correlation from causation in cochange patterns
- No root cause analysis framework
- Cannot answer "why did this bug occur" with causal chain
- Missing: do-calculus for interventional queries

**Research Support:**
- Pearl's Causal Inference (do-calculus, DAGs)
- SBFL for fault localization (Ochiai, Tarantula)
- Causal debugging research (Cleve & Zeller)
- "Why did my program fail?" literature

### 2.10 Analogical Reasoning (Pattern matching across domains)

**How LiBrainian Represents This:**
```typescript
interface SimilarEntity extends Reference {
  similarity: number;  // Cosine similarity 0-1
  reason: string;
}

// Embedding-based similarity
embedding?: Float32Array;  // Semantic vector (384-dim)
```

**How LiBrainian Reasons About This:**
- Cosine similarity via embeddings
- Pattern detection (Factory, Singleton, Observer, etc.)
- Community detection in dependency graphs

**Gaps:**
- **Similarity is structural, not functional**
- Cannot identify "code X solves same problem as code Y"
- No cross-repository pattern matching
- No analogy explanation ("X is like Y because...")
- Missing: case-based reasoning
- Missing: design pattern instantiation recognition

**Research Support:**
- Structure mapping theory (Gentner)
- Case-based reasoning (Kolodner)
- Code clone detection research
- Cross-project learning (Naturalize, BigCode)

---

## 3. Knowledge Representation Gaps

### 3.1 Missing Types

| Gap | Description | Suggested Type |
|-----|-------------|----------------|
| **Negative Knowledge** | What code explicitly does NOT do | `Exclusion { behavior: string; evidence: string[] }` |
| **Hypothetical Knowledge** | Unverified possibilities | `Hypothesis { scenario: string; likelihood: number }` |
| **Conditional Knowledge** | Knowledge valid under conditions | `Conditional<T> { value: T; when: Condition[] }` |
| **Conflicting Knowledge** | Multiple valid interpretations | Already have `Contradiction` but not for valid alternatives |
| **Procedural Memory** | Learned sequences of actions | `Procedure { steps: Action[]; learned_from: EvidenceId[] }` |
| **Causal Knowledge** | Cause-effect relationships | `CausalLink { cause: EntityId; effect: EntityId; mechanism: string }` |

### 3.2 Missing Relationships

| Gap | Description | Current Nearest |
|-----|-------------|-----------------|
| **causes** | Direct causal relationship | calls, depends_on (structural, not causal) |
| **prevents** | Prevents condition/behavior | (none) |
| **enables** | Makes something possible | (none) |
| **substitutes_for** | Can replace in context | alternatives (weak) |
| **evolved_from** | Historical lineage | history.commits (weak) |
| **contradicts_at_scale** | Works in isolation, fails at scale | (none) |

### 3.3 Schema Completeness Assessment

```
UniversalKnowledge Coverage:
  Identity:      95% (missing: aliases, canonical imports)
  Semantics:     85% (missing: negative cases, failure modes)
  Contract:      80% (missing: formal specs, SMT integration)
  Relationships: 70% (missing: causal, conditional, temporal ordering)
  Quality:       90% (good coverage)
  Security:      85% (good coverage)
  Runtime:       60% (missing: actual runtime data integration)
  Testing:       75% (missing: mutation scores, property tests)
  History:       70% (missing: temporal queries, state reconstruction)
  Ownership:     80% (good coverage)
  Rationale:     65% (missing: causal chains, decision impact)
  Context:       75% (missing: deployment-specific variants)
  Traceability:  80% (good coverage)
```

---

## 4. Reasoning Capability Gaps

### 4.1 Critical Missing Capabilities

| Capability | Impact | Research Solution |
|------------|--------|-------------------|
| **Causal Inference** | Cannot explain bugs | Pearl's do-calculus, Bayesian networks |
| **Counterfactual Simulation** | Cannot predict change impact accurately | Symbolic execution, mutation testing |
| **Abductive Reasoning** | Cannot generate hypotheses | Explanation-based reasoning |
| **Temporal Logic** | Cannot reason about sequences | LTL/CTL model checking |
| **Constraint Solving** | Cannot derive implied constraints | SMT solvers (Z3) |

### 4.2 Partially Implemented Capabilities

| Capability | Current State | Enhancement Path |
|------------|---------------|------------------|
| **Analogical Matching** | Embedding similarity | Structure mapping, functional similarity |
| **Rule Inference** | Pattern detection | Inductive logic programming |
| **Uncertainty Propagation** | Derivation rules D1-D7 | Full Bayesian network |
| **Temporal Analysis** | Staleness tracking | Temporal logic queries |

### 4.3 Reasoning Chain Depth

Current maximum reasoning depth:
- Dependency chains: Unlimited (BFS traversal)
- Evidence chains: Unlimited (graph traversal)
- Causal chains: **0** (not implemented)
- Counterfactual chains: **1** (static impact only)
- Temporal chains: **2** (current + history, no projection)

---

## 5. Research-Backed Improvements

### 5.1 Priority 1: Causal Reasoning Framework

**Problem:** Cannot answer "why did X happen" with causal chain.

**Solution:** Implement causal DAGs with intervention support.

```typescript
interface CausalGraph {
  nodes: Map<EntityId, CausalNode>;
  edges: CausalEdge[];
}

interface CausalNode {
  entity: EntityId;
  type: 'cause' | 'effect' | 'confounder';
  distribution?: ProbabilityDistribution;
}

interface CausalEdge {
  from: EntityId;
  to: EntityId;
  mechanism: string;
  strength: ConfidenceValue;
  isObservational: boolean;  // vs interventional
}

// Do-calculus operations
function doIntervention(graph: CausalGraph, node: EntityId, value: unknown): CausalGraph;
function computeEffect(graph: CausalGraph, cause: EntityId, effect: EntityId): ConfidenceValue;
```

**Research:** Pearl (2009) "Causality", Spirtes et al. "Causation, Prediction, and Search"

### 5.2 Priority 2: Counterfactual Simulation Engine

**Problem:** Cannot accurately predict change impact beyond static dependencies.

**Solution:** Integrate mutation testing and symbolic execution.

```typescript
interface CounterfactualQuery {
  type: 'mutation' | 'deletion' | 'signature_change' | 'behavior_change';
  target: EntityId;
  hypotheticalChange: Change;
  scope: 'unit' | 'integration' | 'system';
}

interface CounterfactualResult {
  query: CounterfactualQuery;
  simulationMethod: 'symbolic' | 'mutation' | 'static' | 'llm';
  affectedTests: TestId[];
  predictedFailures: Failure[];
  behaviorChanges: BehaviorDelta[];
  confidence: ConfidenceValue;
}
```

**Research:** Mutation testing (Jia & Harman), Symbolic execution (KLEE, SAGE)

### 5.3 Priority 3: Analogical Reasoning System

**Problem:** Cannot identify functionally similar code across different structures.

**Solution:** Structure mapping + functional similarity embeddings.

```typescript
interface AnalogyQuery {
  source: EntityId;
  domain: 'structure' | 'function' | 'behavior' | 'pattern';
  scope: 'file' | 'module' | 'repo' | 'external';
}

interface Analogy {
  source: EntityId;
  target: EntityId;
  mappings: StructureMapping[];  // Gentner's structure mapping
  functionalSimilarity: number;
  explanation: string;  // "X is like Y because..."
  confidence: ConfidenceValue;
}
```

**Research:** Gentner (1983) "Structure Mapping", Case-based reasoning (Kolodner)

### 5.4 Priority 4: Temporal Logic Integration

**Problem:** Cannot answer queries about event sequences or future states.

**Solution:** Integrate temporal logic query engine.

```typescript
interface TemporalQuery {
  pattern: LTLFormula | CTLFormula;
  scope: TimeRange;
  entities: EntityId[];
}

// Example queries:
// "Eventually(testPasses) after Modified(function)"
// "Always(coverage > 0.8) since(v2.0)"
// "Before(deprecated) implies Exists(migration)"
```

**Research:** Clarke et al. "Model Checking", Temporal logic in SE (Dwyer patterns)

### 5.5 Priority 5: Tacit Knowledge Mining

**Problem:** Undocumented conventions not discovered automatically.

**Solution:** Mine patterns from code reviews, commits, and developer behavior.

```typescript
interface TacitKnowledgeMiner {
  sources: ['code_review', 'commit_messages', 'revert_patterns', 'fix_commits'];
  extraction: {
    unwrittenRules: UnwrittenRule[];
    commonMistakes: MistakePattern[];
    expertPreferences: Preference[];
  };
}
```

**Research:** Mining software repositories (MSR), Learning from code reviews

---

## 6. Implementation Roadmap

### Phase 1: Foundation (Q1 2026)
- [ ] Add `CausalLink` type to relationships
- [ ] Implement basic do-calculus operations
- [ ] Extend `ImpactKnowledge` with mutation testing hooks
- [ ] Add temporal query syntax

### Phase 2: Reasoning Engines (Q2 2026)
- [ ] Build causal graph construction from cochange + test failures
- [ ] Integrate Z3 for constraint solving
- [ ] Implement structure mapping for analogies
- [ ] Add LTL/CTL query evaluation

### Phase 3: Learning (Q3 2026)
- [ ] Tacit knowledge mining from code reviews
- [ ] Bayesian network for uncertainty propagation
- [ ] Cross-project analogy matching
- [ ] Causal discovery from observational data

### Phase 4: Integration (Q4 2026)
- [ ] Unified query language for all reasoning types
- [ ] Explanation generation for all inferences
- [ ] Confidence calibration for new reasoning types
- [ ] Performance optimization for large graphs

---

## 7. Conclusion

LiBrainian's epistemological foundation is strong for **propositional knowledge**, **uncertainty handling**, and **provenance tracking**, with principled approaches rooted in academic research (Pollock, Dung, KDD 2025). However, the system lacks capabilities for **causal reasoning**, **counterfactual simulation**, and **analogical reasoning** that are essential for advanced software understanding.

The recommended improvements follow established research in:
- Causal inference (Pearl's do-calculus)
- Mutation testing and symbolic execution
- Structure mapping theory
- Temporal logic verification
- Mining software repositories

Implementing these capabilities would elevate LiBrainian from a knowledge repository to a true reasoning system capable of answering "why", "what-if", and "what's similar" questions with calibrated confidence.

---

## References

1. Pollock, J.L. (1987). "Defeasible Reasoning." Cognitive Science.
2. Dung, P.M. (1995). "On the Acceptability of Arguments." Artificial Intelligence.
3. Pearl, J. (2009). "Causality: Models, Reasoning, and Inference." Cambridge.
4. Gentner, D. (1983). "Structure Mapping: A Theoretical Framework for Analogy." Cognitive Science.
5. KDD 2025. "Uncertainty Quantification and Confidence Calibration in LLMs."
6. arXiv 2501.03282. "From Aleatoric to Epistemic."
7. Clarke, E.M. et al. "Model Checking." MIT Press.
8. Jia, Y. & Harman, M. (2011). "An Analysis and Survey of the Development of Mutation Testing." IEEE TSE.

---

*This document is a research analysis. Implementation decisions should be validated against project priorities and resource constraints.*
