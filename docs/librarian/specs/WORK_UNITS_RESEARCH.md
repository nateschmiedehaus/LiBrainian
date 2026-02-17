# LiBrainian Work Units: Research-Backed Improvement Plan

> **Purpose**: Define cutting-edge work units informed by state-of-the-art 2025-2026 research
> **Generated**: 2026-01-27
> **Research Sources**: 20 parallel research agents covering hallucination detection, provenance, calibration, retrieval, embeddings, multi-agent systems, self-improvement loops, and more

---

## Executive Summary

This document synthesizes findings from comprehensive research into actionable work units for LiBrainian improvement. Each work unit is backed by specific research findings, metrics targets, and implementation recommendations from cutting-edge academic and industry work.

---

## WU-CAT-PROVENANCE: LLM Evidence Provenance System

### Research Foundation
- **MiniCheck-7B** (EMNLP 2024): GPT-4 level grounding at 400x lower cost, 77.4% accuracy
- **SAFE** (DeepMind NeurIPS 2024): Search-augmented factuality, 20x cheaper than human annotation
- **Anthropic Citations API**: 15% recall improvement, reduces hallucinations from 10% to 0%
- **W3C PROV + OpenTelemetry GenAI**: Industry-standard provenance tracking

### Work Units

| ID | Title | Description | Acceptance Criteria |
|----|-------|-------------|---------------------|
| WU-PROV-001 | OpenTelemetry GenAI Integration | Adopt OTel GenAI semantic conventions (v1.37+) for all LLM calls | 100% LLM calls instrumented with `gen_ai.*` attributes |
| WU-PROV-002 | Evidence Record Schema | Implement W3C PROV-based evidence schema with cryptographic hashing | Schema validates, SHA-256 hashes on all prompt/response pairs |
| WU-PROV-003 | Citation Verification Pipeline | Integrate MiniCheck-style verification for claim grounding | Grounding accuracy >= 77% on test corpus |
| WU-PROV-004 | Multi-Hop Chain Tracking | Implement PROV-AGENT lineage for derived evidence chains | Full chain traversal with confidence decay |
| WU-PROV-005 | Immutable Audit Logs | Write-once storage for EU AI Act compliance | Audit trail survives for 7 years |

### Key Metrics
- Citation accuracy: >= 92% (hybrid retrieval target)
- Grounding verification latency: < 200ms
- Chain integrity verification: 100% traceable

---

## WU-CAT-CALIBRATION: Confidence Calibration & Outcome Collection

### Research Foundation
- **Atomic Calibration** (AACL-IJCNLP 2025): Claim-level calibration for long-form outputs
- **Adaptive Temperature Scaling** (EMNLP 2024): 10-50% improvement over prior methods
- **SmoothECE**: Kernel smoothing avoids bin artifacts
- **SWE-Gym Verifiers** (ICML 2025): Binary test outcomes as verifiable rewards

### Work Units

| ID | Title | Description | Acceptance Criteria |
|----|-------|-------------|---------------------|
| WU-CAL-001 | Atomic Claim Decomposition | Break responses into atomic facts per FActScore/SAFE | >= 95% of claims atomically decomposed |
| WU-CAL-002 | Adaptive Temperature Scaling | Per-token temperature prediction post-RLHF | ECE improvement >= 10% over baseline |
| WU-CAL-003 | Outcome Collection Pipeline | Track accept/reject, time-to-edit, test pass signals | Implicit + explicit + automated signals collected |
| WU-CAL-004 | SmoothECE Dashboard | Real-time calibration monitoring | ECE < 0.10 (target 0.05) |
| WU-CAL-005 | Brier Score Tracking | Overall probabilistic accuracy metric | Brier Score < 0.15 |
| WU-CAL-006 | Calibration Curve Visualization | Plot reliability diagrams per claim type | Weekly calibration reports |

### Key Metrics
- ECE (Expected Calibration Error): < 0.10
- Brier Score: < 0.15
- Atomic calibration alignment: >= 85%

---

## WU-CAT-MULTILANG: Cross-Language Generalization

### Research Foundation
- **Tree-sitter**: 200+ language grammars, incremental parsing
- **cAST** (CMU 2025): AST-aligned chunking for language-invariant retrieval
- **CodeBERT/GraphCodeBERT/UniXcoder**: Cross-language code embeddings
- **SCIP Protocol**: Language-agnostic semantic code intelligence

### Work Units

| ID | Title | Description | Acceptance Criteria |
|----|-------|-------------|---------------------|
| WU-LANG-001 | Tree-sitter Universal Parser | Integrate tree-sitter for all major languages | 20+ languages supported |
| WU-LANG-002 | AST-Aligned Chunking | Implement cAST-style chunk boundaries | Chunks align with syntactic units |
| WU-LANG-003 | Language-Agnostic Embeddings | Deploy UniXcoder or voyage-code-3 | Single embedding space for all languages |
| WU-LANG-004 | SCIP Integration | Extract semantic symbols via SCIP protocol | Symbol resolution across languages |
| WU-LANG-005 | LoRACode Adapters | Language-specific fine-tuning adapters | +5pp accuracy on low-resource languages |

### Key Metrics
- Language coverage: >= 20 languages
- Cross-language retrieval MRR: >= 0.7
- Symbol resolution accuracy: >= 95%

---

## WU-CAT-STALENESS: Knowledge Staleness Detection

### Research Foundation
- **FSEvents/inotify**: Real-time file change monitoring
- **Bi-temporal Indexing**: Valid-time vs transaction-time tracking
- **Exponential Decay**: W = e^(-λt) freshness weighting
- **CDC (Change Data Capture)**: Database-style incremental updates

### Work Units

| ID | Title | Description | Acceptance Criteria |
|----|-------|-------------|---------------------|
| WU-STALE-001 | File Watcher Integration | FSEvents (macOS) / inotify (Linux) real-time monitoring | < 5s detection latency |
| WU-STALE-002 | Bi-temporal Evidence Store | Track valid-time and transaction-time for all facts | Temporal queries supported |
| WU-STALE-003 | Freshness Decay Model | Exponential decay weighting for retrieval | Stale content deprioritized |
| WU-STALE-004 | Invalidation Cascade | Propagate staleness through dependency graph | Downstream facts marked stale |
| WU-STALE-005 | Staleness Dashboard | Visualize knowledge freshness distribution | Weekly freshness reports |

### Key Metrics
- Change detection latency: < 5 minutes (target < 5s)
- Stale content retrieval rate: < 5%
- Invalidation cascade accuracy: 100%

---

## WU-CAT-CONTRADICTION: Contradiction & Consistency Detection

### Research Foundation
- **C4RLLaMA** (ICSE 2025): Code comment consistency checking
- **CARL-CCI**: Cross-consistency inference for code comments
- **MiniCheck**: NLI-based entailment checking
- **SelfCheckGPT**: Multi-sample consistency verification

### Work Units

| ID | Title | Description | Acceptance Criteria |
|----|-------|-------------|---------------------|
| WU-CONTRA-001 | Comment-Code Consistency | Detect divergence between comments and code | False positive rate < 10% |
| WU-CONTRA-002 | Multi-Source Arbitration | Flag conflicts between multiple sources | All conflicts surfaced, never silently resolved |
| WU-CONTRA-003 | Temporal Consistency | Detect claims inconsistent with version history | Version-aware contradiction detection |
| WU-CONTRA-004 | Self-Consistency Sampling | Multi-sample response comparison | AUROC >= 0.75 for inconsistency detection |
| WU-CONTRA-005 | Conflict Resolution UI | User interface for reviewing contradictions | All conflicts require human arbitration |

### Key Metrics
- Contradiction detection F1: >= 0.80
- False positive rate: < 10%
- Silent arbitration rate: 0%

---

## WU-CAT-RETRIEVAL: Advanced Retrieval Techniques

### Research Foundation
- **FLARE** (EMNLP 2023): Forward-looking active retrieval
- **IRCoT** (ACL 2023): Interleaved retrieval with chain-of-thought
- **Self-RAG** (ICLR 2024): Self-reflective retrieval with critique tokens
- **DRAGIN** (ACL 2024): Dynamic retrieval with attention-based needs detection
- **Stop-RAG** (NeurIPS 2025): Value-based retrieval stopping policy
- **SEAL-RAG** (Dec 2025): Fixed-budget evidence assembly with entity gaps
- **HopRAG** (2025): Logic-aware graph exploration

### Work Units

| ID | Title | Description | Acceptance Criteria |
|----|-------|-------------|---------------------|
| WU-RET-001 | IRCoT Integration | Interleave retrieval with reasoning steps | +15pp on multi-hop questions |
| WU-RET-002 | FLARE-Style Active Retrieval | Retrieve when token confidence drops | Confidence threshold tuned per domain |
| WU-RET-003 | Self-RAG Critique Tokens | Self-evaluation of retrieval quality | Reflection token accuracy >= 80% |
| WU-RET-004 | Stop-RAG Value Controller | Learn when to stop retrieving | Eliminate unnecessary retrieval loops |
| WU-RET-005 | SEAL Entity Gap Tracking | Replace low-value evidence with gap-filling evidence | +13pp answer correctness (HotpotQA target) |
| WU-RET-006 | Graph Traversal Integration | Bidirectional AST graph expansion | Symbol resolution via graph edges |
| WU-RET-007 | Hybrid Retrieval Fusion | BM25 + dense + graph with RRF | MRR >= 0.75 |

### Key Metrics
- Recall@5: >= 80%
- Multi-hop question accuracy: +15pp improvement
- Retrieval efficiency: 50% fewer unnecessary retrievals

---

## WU-CAT-HALLUCINATION: Hallucination Detection & Prevention

### Research Foundation
- **MiniCheck** (EMNLP 2024): 77.4% accuracy, runs on MacBook hardware
- **SAFE** (DeepMind): Search-augmented factuality evaluation
- **FActScore**: Atomic fact decomposition and verification
- **SelfCheckGPT**: Consistency-based hallucination detection
- **CodeHalu** (AAAI 2025): Code-specific hallucination taxonomy
- **REFCHECKER** (Amazon EMNLP 2024): Knowledge triplet extraction
- **Chain-of-Verification** (ACL 2024): +23% F1 improvement

### Work Units

| ID | Title | Description | Acceptance Criteria |
|----|-------|-------------|---------------------|
| WU-HALU-001 | MiniCheck Integration | Local grounding verification model | Grounding accuracy >= 77% |
| WU-HALU-002 | REFCHECKER Triplets | Extract `<subject, predicate, object>` claims | +10pp hallucination detection F1 |
| WU-HALU-003 | Multi-Sample Consistency | SelfCheckGPT-style verification | AUROC >= 0.75 |
| WU-HALU-004 | Chain-of-Verification | 4-step self-verification process | +20% factual claim F1 |
| WU-HALU-005 | Package Existence Check | Verify npm/PyPI package citations | 0% hallucinated packages |
| WU-HALU-006 | Symbol Existence Check | Verify cited functions/classes exist | 100% symbol verification |
| WU-HALU-007 | AST-Based Claim Verification | Line-level citation accuracy | Line number accuracy >= 95% |
| WU-HALU-008 | CodeHalu Taxonomy | Classify hallucinations by type | Mapping/Naming/Resource/Logic categorization |

### Key Metrics
- Hallucination rate: < 5%
- Grounding accuracy: >= 92%
- Package/symbol citation accuracy: 100%

---

## WU-CAT-DEADCODE: Dead Code & Red Flag Detection

### Research Foundation
- **Meta SCARF**: Large-scale dead code removal
- **Google Sensenmann**: Automated dead code detection and removal
- **OWASP 2025**: Security red flag patterns
- **Static Analysis + LLM**: Hybrid detection approaches

### Work Units

| ID | Title | Description | Acceptance Criteria |
|----|-------|-------------|---------------------|
| WU-DEAD-001 | Reachability Analysis | Static call graph analysis for dead code | False positive rate < 5% |
| WU-DEAD-002 | Dynamic Coverage Integration | Runtime coverage to validate dead code claims | Coverage data integrated |
| WU-DEAD-003 | OWASP Red Flag Scanner | Detect common vulnerability patterns | Top 10 OWASP patterns covered |
| WU-DEAD-004 | Deprecated API Detection | Flag usage of deprecated APIs | All deprecated calls surfaced |
| WU-DEAD-005 | Security Smell Detection | LLM-assisted security code review | Zero high-severity misses |

### Key Metrics
- Dead code detection precision: >= 95%
- Security red flag recall: >= 90%
- False positive rate: < 5%

---

## WU-CAT-SELFIMPROVE: Scientific Self-Improvement Loop

### Research Foundation
- **AutoSD**: Hypothesis-driven automated debugging
- **RLVR** (DeepSeek R1, Tulu 3): Binary verifiable rewards
- **SWE-Gym** (ICML 2025): +19% absolute gains with trained agents
- **Self-Play SWE-RL** (Meta FAIR): Bug injection/solving loops
- **Live-SWE-agent**: Runtime self-evolution

### Work Units

| ID | Title | Description | Acceptance Criteria |
|----|-------|-------------|---------------------|
| WU-SELF-001 | Hypothesis Generation | Generate hypotheses about retrieval failures | Hypotheses testable via probes |
| WU-SELF-002 | Automatic Probe Execution | Test hypotheses with code probes | Execution results logged |
| WU-SELF-003 | RLVR Reward Integration | Test pass/fail as binary reward signal | Reward signal drives improvement |
| WU-SELF-004 | Failure Corpus Growth | Capture failures to grow evaluation set | Eval corpus grows weekly |
| WU-SELF-005 | Curriculum Learning | Easy-to-hard training progression | Curriculum complexity adapts |
| WU-SELF-006 | Self-Play Bug Injection | Generate and solve synthetic bugs | Bug injection/solving loop runs |

### Key Metrics
- Hypothesis verification rate: >= 80%
- Evaluation corpus growth: +10% monthly
- Self-improvement gain: measurable recall improvement

---

## WU-CAT-AGENTS: Multi-Agent Integration

### Research Foundation
- **AutoGen v0.4**: Event-driven multi-agent coordination
- **CrewAI**: Role-based agent specialization
- **LangGraph**: State machine agent orchestration
- **MetaGPT**: Hierarchical 2-layer agent architecture
- **Agent-Computer Interface (ACI)**: Optimized tool design for agents

### Work Units

| ID | Title | Description | Acceptance Criteria |
|----|-------|-------------|---------------------|
| WU-AGENT-001 | Hierarchical Orchestration | 2-layer agent hierarchy (planner + workers) | Clear role separation |
| WU-AGENT-002 | Specialized Retrieval Agents | Dedicated agents for different retrieval types | Graph/vector/LSP agents |
| WU-AGENT-003 | Verification Agent | Dedicated agent for claim verification | All claims verified before output |
| WU-AGENT-004 | Event-Driven Coordination | AutoGen-style event streaming | Agents communicate via events |
| WU-AGENT-005 | ACI Tool Design | Optimize tools for agent consumption | Tool success rate >= 90% |

### Key Metrics
- Agent coordination latency: < 500ms
- Task completion rate: >= 85%
- Tool invocation success: >= 90%

---

## WU-CAT-BOOTSTRAP: Self-Hosting & Meta-Analysis

### Research Foundation
- **Self-Hosting**: LiBrainian indexes its own codebase
- **Bootstrap Validation**: Use self-indexed data for testing
- **Meta-Analysis**: LiBrainian evaluates its own outputs
- **Reflexion**: Self-reflection for improvement

### Work Units

| ID | Title | Description | Acceptance Criteria |
|----|-------|-------------|---------------------|
| WU-BOOT-001 | Self-Index Pipeline | LiBrainian indexes LiBrainian codebase | Complete index of own code |
| WU-BOOT-002 | Bootstrap Test Suite | Tests using self-indexed data | >= 50 bootstrap tests |
| WU-BOOT-003 | Meta-Evaluation | LiBrainian evaluates own retrieval quality | Quality scores for own queries |
| WU-BOOT-004 | Reflexion Integration | Self-reflection on retrieval failures | Failure analysis automated |
| WU-BOOT-005 | Dog-fooding Pipeline | Use LiBrainian to develop LiBrainian | Daily dog-fooding runs |

### Key Metrics
- Self-index completeness: 100%
- Bootstrap test coverage: >= 80%
- Meta-evaluation accuracy: >= 90%

---

## WU-CAT-EMBEDDINGS: Code Embedding Improvements

### Research Foundation
- **voyage-code-3**: State-of-the-art code embeddings
- **Qodo-Embed-1-1.5B**: SOTA efficiency for code
- **ColBERT**: Late interaction for fine-grained matching
- **Hybrid BM25+Dense**: Reciprocal Rank Fusion

### Work Units

| ID | Title | Description | Acceptance Criteria |
|----|-------|-------------|---------------------|
| WU-EMB-001 | voyage-code-3 Integration | Deploy state-of-the-art code embeddings | MRR improvement >= 5% |
| WU-EMB-002 | ColBERT Late Interaction | Fine-grained token-level matching | Precision improvement on long queries |
| WU-EMB-003 | Hybrid Fusion Pipeline | BM25 + dense + graph with RRF | All retrieval signals combined |
| WU-EMB-004 | Embedding Cache | Cache embeddings for fast retrieval | Cache hit rate >= 60% |
| WU-EMB-005 | Incremental Re-embedding | Only re-embed changed files | Re-embedding cost < 10% of full |

### Key Metrics
- Embedding MRR: >= 0.75
- Retrieval latency p50: < 100ms
- Cache hit rate: >= 60%

---

## WU-CAT-KNOWLEDGEGRAPH: Code Knowledge Graph

### Research Foundation
- **Code Property Graph (CPG)**: Combined AST + CFG + PDG
- **RepoGraph** (ICLR 2025): Repository-level structure
- **tree-sitter-graph**: DSL for graph construction
- **Microsoft GraphRAG**: Modular graph-based RAG

### Work Units

| ID | Title | Description | Acceptance Criteria |
|----|-------|-------------|---------------------|
| WU-KG-001 | CPG Construction | Build combined AST/CFG/PDG graph | All code elements in graph |
| WU-KG-002 | RepoGraph Integration | Repository-wide navigation structure | Cross-file relationships captured |
| WU-KG-003 | Graph Query Language | Query interface for code graph | Graph queries supported |
| WU-KG-004 | GraphRAG Retrieval | Microsoft GraphRAG patterns | Graph-based retrieval operational |
| WU-KG-005 | Graph Visualization | Interactive graph explorer | UI for graph exploration |

### Key Metrics
- Graph coverage: 100% of code elements
- Graph query latency: < 200ms
- Cross-file resolution accuracy: >= 95%

---

## WU-CAT-EVALUATION: Evaluation Framework Improvements

### Research Foundation
- **RAGAS**: Faithfulness, context precision/recall metrics
- **ARES with PPI**: Prediction-powered inference
- **TruLens RAG Triad**: Groundedness, relevance, coherence
- **GaRAGe** (ACL 2025): Relevance-aware factuality scoring

### Work Units

| ID | Title | Description | Acceptance Criteria |
|----|-------|-------------|---------------------|
| WU-EVAL-001 | RAGAS Metrics Suite | Implement full RAGAS metric set | All RAGAS metrics computed |
| WU-EVAL-002 | Context Precision/Recall | Measure retrieval quality | Context recall >= 80% |
| WU-EVAL-003 | Faithfulness Scoring | Verify answers grounded in context | Faithfulness >= 90% |
| WU-EVAL-004 | A/B Lift Measurement | Statistical significance for changes | A/B framework operational |
| WU-EVAL-005 | Continuous Evaluation | Automated daily evaluation runs | Daily quality reports |

### Key Metrics
- Context recall: >= 80%
- Faithfulness: >= 90%
- Answer relevance: >= 85%

---

## WU-CAT-CONTEXT: Context Window Optimization

### Research Foundation
- **Lost in the Middle**: Position bias in long contexts
- **Sparse RAG** (ICLR 2025): Selective attention to relevant caches
- **FILCO**: Filter irrelevant spans before generation
- **Token Budget Allocation**: Adaptive context allocation

### Work Units

| ID | Title | Description | Acceptance Criteria |
|----|-------|-------------|---------------------|
| WU-CTX-001 | Position Bias Mitigation | Reorder context to avoid middle-loss | Critical info not in middle |
| WU-CTX-002 | Sparse Attention Integration | Attend only to relevant context chunks | Context efficiency improved |
| WU-CTX-003 | FILCO Span Filtering | Remove low-utility spans before generation | Context size reduced 30% |
| WU-CTX-004 | Adaptive Token Budget | Allocate tokens based on query complexity | Complex queries get more context |
| WU-CTX-005 | Context Compression | Summarize verbose context | Compression ratio >= 2x |

### Key Metrics
- Context efficiency: 30% reduction in tokens
- Answer quality: no degradation with compression
- Position bias impact: < 5% accuracy variance

---

## Implementation Priority

### Phase 1: Core Quality (Immediate)
1. WU-HALU-001: MiniCheck Integration (hallucination baseline)
2. WU-CAL-001: Atomic Claim Decomposition (calibration foundation)
3. WU-PROV-002: Evidence Record Schema (audit foundation)
4. WU-EVAL-001: RAGAS Metrics Suite (measurement foundation)

### Phase 2: Retrieval Enhancement
5. WU-RET-001: IRCoT Integration
6. WU-RET-007: Hybrid Retrieval Fusion
7. WU-EMB-001: voyage-code-3 Integration
8. WU-KG-001: CPG Construction

### Phase 3: Self-Improvement
9. WU-SELF-001: Hypothesis Generation
10. WU-SELF-003: RLVR Reward Integration
11. WU-BOOT-001: Self-Index Pipeline
12. WU-SELF-004: Failure Corpus Growth

### Phase 4: Advanced Features
13. WU-AGENT-001: Hierarchical Orchestration
14. WU-RET-004: Stop-RAG Value Controller
15. WU-CTX-002: Sparse Attention Integration
16. WU-CONTRA-002: Multi-Source Arbitration

---

## Success Metrics Summary

| Category | Primary Metric | Target | Current |
|----------|---------------|--------|---------|
| Retrieval | Recall@5 | >= 80% | TBD |
| Hallucination | Hallucination Rate | < 5% | TBD |
| Calibration | ECE | < 0.10 | TBD |
| Grounding | Citation Accuracy | >= 92% | TBD |
| Latency | Query p50 | < 500ms | TBD |
| Coverage | Language Support | >= 20 | TBD |

---

## References

### Primary Research
- MiniCheck: https://github.com/Liyan06/MiniCheck
- SAFE: https://github.com/google-deepmind/long-form-factuality
- SWE-Gym: https://github.com/SWE-Gym/SWE-Gym
- Self-RAG: https://github.com/AkariAsai/self-rag
- IRCoT: https://github.com/StonyBrookNLP/ircot
- DRAGIN: https://github.com/oneal2000/DRAGIN
- GraphRAG: https://microsoft.github.io/graphrag/

### Standards
- OpenTelemetry GenAI: https://opentelemetry.io/blog/2024/llm-observability/
- W3C PROV: https://www.w3.org/2001/sw/wiki/PROV
- RAGAS: https://docs.ragas.io/

### Benchmarks
- LLM-AggreFact: https://github.com/Liyan06/MiniCheck
- GaRAGe: https://github.com/amazon-science/GaRAGe
- SWE-bench: https://www.swebench.com/

---

## WU-CAT-EXTRACTION: Epistemic Primitives Library Extraction (DEFERRED)

> **Status**: DEFERRED - See `docs/LiBrainian/PRIMITIVE_EXTRACTION_FEASIBILITY.md`
> **Prerequisite**: Validate patterns in LiBrainian with real external repos first
> **Rationale**: Premature extraction risks API churn and lost context

### Research Foundation
- LiBrainian's epistemic primitives (ConfidenceValue, Evidence Ledger, Defeaters)
- Design-by-contract patterns (primitive-contracts.md)
- Construction templates (T1-T12) for UC mapping
- Self-improvement loop (11 primitives, 5 compositions)

### Deferred Work Units

| ID | Title | Description | Blocked By |
|----|-------|-------------|------------|
| WU-EXT-001 | Open-source positioning strategy | Evaluate competitive landscape, naming, licensing, target users | Pattern validation in real repos |
| WU-EXT-002 | Design integration architecture | Clean boundaries, dependency direction, test organization, migration path | WU-EXT-001 |
| WU-EXT-003 | Extract minimal kernel | `@wave0/epistemic-kit` with ConfidenceValue, Evidence Ledger, Defeaters | WU-EXT-002 |
| WU-EXT-004 | Publish pattern documentation | Standalone paper/blog describing epistemic primitives pattern language | None (can proceed now) |

### Extraction Criteria (when to unblock)

Before extraction, validate:
- [ ] Construction templates (T1-T12) wired and tested
- [ ] Calibration curves computed on real data
- [ ] 3+ external repos validated with full pipeline
- [ ] No major API changes for 4+ weeks

### Target Package Structure (if/when extracted)

```
@wave0/epistemic-kit/
├── confidence/
│   ├── types.ts          # ConfidenceValue union type
│   ├── guards.ts         # Type guards
│   ├── derivation.ts     # D1-D6 rules
│   └── index.ts
├── evidence/
│   ├── ledger.ts         # IEvidenceLedger interface
│   ├── types.ts          # EvidenceKind, Provenance
│   └── index.ts
├── defeaters/
│   ├── types.ts          # Defeater types
│   └── index.ts
└── index.ts
```

Estimated extractable LOC: ~2,000 (minimal kernel)

---

## WU-CAT-THEORY: Theoretical Grounding Assessment (PREREQUISITE)

> **Status**: NOT STARTED
> **Priority**: BEFORE all implementation work units
> **Purpose**: Validate theoretical soundness of existing primitives before building more

### Rationale

Before implementing 50+ work units of new functionality, we must verify:
1. Existing primitives are theoretically sound (not just "working code")
2. The epistemic foundations are rigorous (not ad-hoc)
3. Any gaps in theory are identified before they become implementation debt
4. New primitives align with established epistemology, not just engineering intuition

### Research Foundation

Key theoretical domains to assess:
- **Epistemology**: Justified true belief, Gettier problems, defeater theory (Pollock)
- **Probability/Calibration**: Bayesian updating, calibration theory, proper scoring rules
- **Causality**: Pearl's causal hierarchy, do-calculus, counterfactual reasoning
- **Logic**: Defeasible reasoning, non-monotonic logic, belief revision (AGM)
- **Information Theory**: Entropy, mutual information, channel capacity for evidence

### Work Units: Assessment Phase

| ID | Title | Scope | Output |
|----|-------|-------|--------|
| WU-THEO-001 | ConfidenceValue Theoretical Audit | Assess 5 confidence types against calibration theory, Bayesian foundations | Gap report + recommended changes |
| WU-THEO-002 | Evidence Ledger Epistemology Review | Assess append-only log against belief revision theory (AGM), provenance standards | Gap report + schema recommendations |
| WU-THEO-003 | Defeater System Rigor Check | Assess against Pollock's defeater taxonomy, defeasible reasoning literature | Completeness report + missing defeater types |
| WU-THEO-004 | Causal Reasoning Foundations | Assess against Pearl's causal hierarchy, do-calculus requirements | Gap report + intervention/counterfactual needs |
| WU-THEO-005 | Self-Improvement Loop Soundness | Assess recursive self-improvement against fixed-point theory, Löbian obstacles | Soundness proof or identified risks |
| WU-THEO-006 | Calibration Theory Alignment | Assess calibration approach against proper scoring rules, ECE theory | Recommended calibration methodology |
| WU-THEO-007 | Primitive Composition Semantics | Assess how primitives compose - is confidence propagation mathematically valid? | Composition algebra specification |

### Work Units: Literature Survey

| ID | Title | Scope | Output |
|----|-------|-------|--------|
| WU-THEO-101 | Survey: AI Epistemics State-of-Art | What do leading AI labs use for epistemic uncertainty? | Competitive landscape report |
| WU-THEO-102 | Survey: Formal Verification for LLM Claims | Academic work on verified LLM outputs | Applicable techniques report |
| WU-THEO-103 | Survey: Calibration in Production Systems | Industry practices for confidence calibration | Best practices synthesis |

### Assessment Criteria

For each primitive, evaluate:

1. **Theoretical Grounding**
   - Is there a cited theoretical basis? (paper, formal system)
   - Is the implementation faithful to the theory?
   - Are deviations from theory justified and documented?

2. **Completeness**
   - Does the primitive cover all cases the theory requires?
   - Are there edge cases the theory handles but implementation doesn't?

3. **Composability**
   - Does composition preserve theoretical properties?
   - Is confidence propagation mathematically sound?

4. **Falsifiability**
   - Can the primitive's claims be empirically tested?
   - Are there defined failure modes?

### Output: Theory Gap Report

WU-THEO-001 through WU-THEO-007 produce a consolidated **Theory Gap Report** containing:

```
For each primitive:
  - Theoretical basis: [cited/uncited/ad-hoc]
  - Grounding quality: [rigorous/partial/weak]
  - Identified gaps: [list]
  - Recommended changes: [list]
  - New primitives needed: [list]
  - Priority: [critical/important/nice-to-have]
```

### Dependent Work Unit: Implementation of Theory Fixes

| ID | Title | Blocked By | Scope |
|----|-------|------------|-------|
| WU-THEO-IMPL | Implement Theory-Required Changes | WU-THEO-001 through WU-THEO-007 | TBD based on gap report |

This work unit is created AFTER the assessment phase completes, with specific sub-tasks determined by the gap report findings. May include:
- New confidence types (if theory requires)
- Additional defeater categories (if Pollock taxonomy incomplete)
- Causal intervention operators (if do-calculus needed)
- Composition algebra formalization
- Calibration methodology changes

### Key References (to consult during assessment)

**Epistemology**
- Pollock, J. (1987). "Defeasible Reasoning" - defeater taxonomy
- Gettier, E. (1963). "Is Justified True Belief Knowledge?" - JTB problems
- Alchourrón, Gärdenfors, Makinson (1985). AGM belief revision

**Causality**
- Pearl, J. (2009). "Causality" - causal hierarchy, do-calculus
- Pearl & Mackenzie (2018). "Book of Why" - accessible causal reasoning

**Calibration**
- Gneiting & Raftery (2007). "Strictly Proper Scoring Rules"
- Platt (1999). Platt scaling for calibration
- Guo et al. (2017). "On Calibration of Modern Neural Networks"

**AI Uncertainty**
- Anthropic (2024). Constitutional AI and uncertainty
- OpenAI (2023). GPT-4 technical report - calibration discussion
- Kadavath et al. (2022). "Language Models (Mostly) Know What They Know"

### Success Criteria

- [ ] All 7 assessment WUs completed with written reports
- [ ] Theory Gap Report consolidated
- [ ] WU-THEO-IMPL scoped with specific sub-tasks
- [ ] No "ad-hoc" primitives remain undocumented
- [ ] Composition algebra specified (even if simple)

---

## WU-CAT-THEO-IMPL: Theory-Required Implementation Changes

> **Status**: SCOPED (from completed audits WU-THEO-001 through WU-THEO-006)
> **Blocked By**: WU-THEO-007 completion
> **Source**: Theory assessment reports in docs/LiBrainian/theory-assessments/

### SHORT-TERM (P0 - Immediate, Low Effort)

| ID | Title | Source | Effort | Description |
|----|-------|--------|--------|-------------|
| WU-THIMPL-001 | Document independence assumptions | THEO-001 | Low | D3/D4 derivation rules assume independence - document explicitly |
| WU-THIMPL-002 | Add Brier Score metric | THEO-001, THEO-006 | Low | Essential proper scoring rule for calibration |
| WU-THIMPL-003 | Add Log Loss metric | THEO-006 | Low | Information-theoretic calibration assessment |
| WU-THIMPL-004 | Wilson interval for CI computation | THEO-001 | Low | Accurate small-sample confidence intervals |
| WU-THIMPL-005 | Fix chain confidence for contradictions | THEO-002 | Low | Blocking contradictions must affect computed confidence |
| WU-THIMPL-006 | Add relationship typing to relatedEntries | THEO-002 | Low | Distinguish "supports", "derived_from", "contradicts" |
| WU-THIMPL-007 | Rename causal functions honestly | THEO-004 | Low | findCauses→findPredecessors, exclude correlates from cause queries |
| WU-THIMPL-008 | Document theoretical limits of self-verify | THEO-005 | Low | Acknowledge Löbian obstacles explicitly |
| WU-THIMPL-009 | Define health score formula formally | THEO-005 | Low | Currently undefined how components combine |
| WU-THIMPL-010 | Document independence assumptions in D3/D4 | THEO-007 | Low | Add JSDoc warnings about independence requirement |

### MEDIUM-TERM (P1 - Next Sprint, Medium Effort)

| ID | Title | Source | Effort | Description |
|----|-------|--------|--------|-------------|
| WU-THIMPL-101 | Calibration status in DerivedConfidence | THEO-001 | Medium | Track whether derived confidence preserves calibration |
| WU-THIMPL-102 | Higher-order defeat support | THEO-003 | Medium | Add defeatedBy field, defeaters can be defeated |
| WU-THIMPL-103 | Transitive defeat propagation | THEO-003 | Medium | When Claim A defeated, re-evaluate dependent claims |
| WU-THIMPL-104 | Defeater-ConfidenceValue integration | THEO-003 | Medium | Update ConfidenceValue provenance when defeaters apply |
| WU-THIMPL-105 | Implement untrusted_content defeater | THEO-003 | Medium | Detect and handle untrusted content sources |
| WU-THIMPL-106 | Implement dependency_drift defeater | THEO-003 | Medium | Detect version/API drift in dependencies |
| WU-THIMPL-107 | Document epistemological stance | THEO-002 | Medium | Temporal paraconsistent model, not AGM |
| WU-THIMPL-108 | Configurable confidence propagation | THEO-002 | Medium | Support min/max/product/noisy-or rules |
| WU-THIMPL-109 | Required agent attribution | THEO-002 | Medium | Make agent attribution mandatory for LLM/tool sources |
| WU-THIMPL-110 | Graph surgery for interventions | THEO-004 | Medium | Basic do-calculus: remove incoming edges to intervention node |
| WU-THIMPL-111 | D-separation testing | THEO-004 | Medium | Test conditional independence in causal graph |
| WU-THIMPL-112 | Isotonic regression calibration | THEO-006 | Medium | Replace histogram binning, fix monotonicity violation |
| WU-THIMPL-113 | Bootstrap calibration mode | THEO-006 | Medium | Principled cold-start behavior |
| WU-THIMPL-114 | Automated rollback mechanism | THEO-005 | Medium | Currently documentation-only, needs automation |
| WU-THIMPL-115 | Clarify escalation thresholds | THEO-005 | Medium | When to escalate to human oversight |
| WU-THIMPL-116 | Calibration preservation tests | THEO-007 | Medium | Statistical verification that composition preserves calibration |
| WU-THIMPL-117 | Optional correlation parameter | THEO-007 | Medium | Model correlated steps in D3/D4 |

### LONG-TERM (P2 - Future, High Effort)

| ID | Title | Source | Effort | Description |
|----|-------|--------|--------|-------------|
| WU-THIMPL-201 | Typed formula representation | THEO-001 | High | AST for formulas instead of strings |
| WU-THIMPL-202 | Bayesian defeat reduction | THEO-003 | High | Replace linear subtraction with Bayesian update |
| WU-THIMPL-203 | W3C PROV export | THEO-002 | High | Standard provenance format export |
| WU-THIMPL-204 | Fix getChain topological sort | THEO-002 | Medium | Currently BFS level-order, should be topo sort |
| WU-THIMPL-205 | Deterministic replay mode | THEO-002 | High | Replay runs from evidence ledger |
| WU-THIMPL-206 | Structural causal models | THEO-004 | High | Full SCM with exogenous variables |
| WU-THIMPL-207 | Counterfactual reasoning | THEO-004 | High | "What would have happened if X?" queries |
| WU-THIMPL-208 | PAC-based sample thresholds | THEO-006 | Medium | Justified minimum samples for calibration |
| WU-THIMPL-209 | Convergence monitoring | THEO-005 | High | Detect oscillation/drift in self-improvement |
| WU-THIMPL-210 | Metric gaming detection | THEO-005 | High | Goodhart's Law protection |
| WU-THIMPL-211 | SmoothECE implementation | THEO-006 | Medium | Kernel density approach to calibration |
| WU-THIMPL-212 | Interval arithmetic for BoundedConfidence | THEO-007 | High | Preserve ranges through composition |
| WU-THIMPL-213 | Relax Absent propagation for OR | THEO-007 | Medium | Absent in OR shouldn't always propagate |

### Implementation Priority

```
Sprint 1: WU-THIMPL-001 through 009 (all P0 items)
Sprint 2: WU-THIMPL-101 through 108 (core P1 items)
Sprint 3: WU-THIMPL-109 through 115 (remaining P1 items)
Sprint 4+: WU-THIMPL-201+ (P2 items as capacity allows)
```

---

## WU-CAT-SELF-IMPROVEMENT: Self-Improvement Loop Implementation

> **Status**: NOT STARTED
> **Spec**: `docs/LiBrainian/specs/self-improvement-primitives.md`
> **Estimated LOC**: ~5,750 (per spec roadmap)

### Research Foundation
- LiBrainian's 11 self-improvement primitives spec
- Meta-epistemic loop design (self-index → self-query → self-verify → self-learn)
- Gettier case detection and resolution
- Bounded recursion with theoretical constraints

### Work Units: Primitives (11)

| ID | Title | Spec Line | Complexity | Blocked By |
|----|-------|-----------|------------|------------|
| WU-SELF-101 | tp_self_bootstrap | 77-153 | large | Storage, Embedding |
| WU-SELF-102 | tp_self_refresh | 157-218 | medium | WU-SELF-101 |
| WU-SELF-103 | tp_analyze_architecture | 223-298 | large | WU-SELF-101 |
| WU-SELF-104 | tp_analyze_consistency | 302-382 | medium | WU-SELF-101 |
| WU-SELF-105 | tp_verify_claim | 387-476 | medium | None |
| WU-SELF-106 | tp_verify_calibration | 480-562 | medium | Calibration infra |
| WU-SELF-107 | tp_improve_generate_recommendations | 566-658 | medium | Analysis primitives |
| WU-SELF-108 | tp_improve_plan_fix | 662-757 | medium | WU-SELF-107 |
| WU-SELF-109 | tp_improve_adversarial_test | 761-841 | medium | WU-SELF-103 |
| WU-SELF-110 | tp_learn_from_outcome | 846-940 | small | Outcome tracking |
| WU-SELF-111 | tp_learn_extract_pattern | 944-1034 | medium | WU-SELF-110 |

### Work Units: Compositions (5)

| ID | Title | Spec Line | Complexity | Blocked By |
|----|-------|-----------|------------|------------|
| WU-SELF-201 | tc_self_audit_full | 1040-1145 | large | WU-SELF-101 through 106 |
| WU-SELF-202 | tc_self_check_incremental | 1150-1233 | medium | WU-SELF-102, 104, 106, 110 |
| WU-SELF-203 | tc_resolve_gettier_case | 1238-1343 | large | WU-SELF-105, 108, 109 |
| WU-SELF-204 | tc_adversarial_self_test | 1347-1478 | large | WU-SELF-103, 109 |
| WU-SELF-205 | tc_continuous_improvement | 1482-1644 | large | Most primitives |

### Work Units: Supporting Infrastructure

| ID | Title | Spec Line | Complexity | Blocked By |
|----|-------|-----------|------------|------------|
| WU-SELF-301 | SelfImprovementExecutor | 1648-2007 | large | Compositions defined |
| WU-SELF-302 | FreshnessDetector | 2017-2119 | medium | None |
| WU-SELF-303 | DistributionShiftDetector | 2124-2234 | medium | Calibration infra |
| WU-SELF-304 | HealthDashboard Interface | 2239-2395 | large | WU-SELF-302, 303 |
| WU-SELF-305 | MetaImprovementLoop | 2399-2563 | large | WU-SELF-301 |

---

## WU-CAT-TEMPLATES: Construction Templates Implementation

> **Status**: PARTIAL (T1,T3-T5,T10-T11 partial; T2,T6-T9,T12 not started)
> **Spec**: `docs/LiBrainian/specs/core/construction-templates.md`

### Research Foundation
- Template-based UC coverage (anti-accretion mechanism)
- 12 canonical templates mapping 310 use cases
- Token-budgeted, disclosure-required output envelope

### Work Units: Missing Templates

| ID | Title | Template | Complexity | Blocked By |
|----|-------|----------|------------|------------|
| WU-TMPL-001 | Template Registry Interface | Section 2 | small | None |
| WU-TMPL-002 | T2 DeltaMap | 140-157 | medium | Git adapter |
| WU-TMPL-006 | T6 ReproAndBisect | 183-192 | large | Execution tools |
| WU-TMPL-007 | T7 SupplyChain | 194-207 | large | SBOM adapters |
| WU-TMPL-008 | T8 InfraMap | 209-217 | large | K8s/IaC adapters |
| WU-TMPL-009 | T9 ObservabilityRunbooks | 219-227 | large | RunbookMap |
| WU-TMPL-012 | T12 UncertaintyReduction | 237-243 | large | GapModel, Defeaters |

### Work Units: Partial Templates Completion

| ID | Title | Template | Gap |
|----|-------|----------|-----|
| WU-TMPL-101 | T1 Token Budgeting | T1 RepoMap | Budget minimization incomplete |
| WU-TMPL-103 | T3 Budget Exclusion Disclosure | T3 EditContext | Show what was excluded |
| WU-TMPL-104 | T4 DoD Integration | T4 VerificationPlan | Full DoD wiring |
| WU-TMPL-105 | T5 Uncertainty Disclosure | T5 TestSelection | Mapping incompleteness disclosure |
| WU-TMPL-111 | T11 Conflict Objects | T11 MultiAgentState | Complete conflict handling |

### Key Metrics
- Template coverage: 12/12 implemented
- UC mapping: 100% of UCs have template path
- Evidence emission: Template selection recorded in evidence ledger

---

## WU-CAT-CONTRACTS: Primitive Contracts System

> **Status**: NOT STARTED
> **Spec**: `docs/LiBrainian/specs/core/primitive-contracts.md`

### Research Foundation
- Design-by-contract for technique primitives
- Preconditions, postconditions, invariants
- Confidence derivation rules
- Runtime verification with ContractExecutor

### Work Units

| ID | Title | Spec Section | Complexity | Blocked By |
|----|-------|--------------|------------|------------|
| WU-CNTR-001 | PrimitiveContract Interface | Section 1 (28-66) | small | None |
| WU-CNTR-002 | Precondition/Postcondition Framework | Section 1.2 (68-130) | medium | WU-CNTR-001 |
| WU-CNTR-003 | ConfidenceDerivation System | Section 2 (170-236) | medium | WU-CNTR-001 |
| WU-CNTR-004 | ErrorSpec & RetryPolicy | Section 3 (240-283) | small | WU-CNTR-001 |
| WU-CNTR-005 | Contract Registry (global) | Section 5 (318-346) | medium | WU-CNTR-001-004 |
| WU-CNTR-006 | ContractExecutor | Section 6 (408-458) | large | WU-CNTR-005 |
| WU-CNTR-007 | ContractViolation error type | Section 6.2 (462-479) | small | WU-CNTR-006 |
| WU-CNTR-008 | Register all existing primitives | N/A | large | WU-CNTR-005 |

### Acceptance Criteria
- All primitives have registered contracts
- Runtime verification on all technique executions
- Contract violations properly surfaced

---

## WU-CAT-LEDGER: Evidence Ledger Unification

> **Status**: PARTIAL (basic structure exists, wiring incomplete)
> **Spec**: `docs/LiBrainian/specs/core/evidence-ledger.md`

### Research Foundation
- Append-only epistemic event log
- 11 evidence kinds with provenance
- Deterministic replay capability
- Calibration data source

### Work Units

| ID | Title | Gap | Complexity | Blocked By |
|----|-------|-----|------------|------------|
| WU-LEDG-001 | MCP Audit → Evidence Ledger | Connect tool_call evidence | medium | None |
| WU-LEDG-002 | Episodes → Evidence Ledger | Connect episode evidence | medium | None |
| WU-LEDG-003 | Query Stages → Evidence Ledger | Connect retrieval evidence | medium | None |
| WU-LEDG-004 | Bootstrap → Evidence Ledger | Connect extraction evidence | medium | None |
| WU-LEDG-005 | Evidence Chain Query | getChain() implementation | medium | WU-LEDG-001-004 |
| WU-LEDG-006 | Deterministic Replay | Replay runs from evidence | large | WU-LEDG-005 |
| WU-LEDG-007 | Stable Entry IDs | Cross-referencing support | small | None |

### Key Metrics
- 100% of epistemic events captured
- Full chain traversal working
- Replay fidelity: deterministic

---

## WU-CAT-CALIBRATION-EXT: Calibration Extensions

> **Status**: C2 implemented, C1/C4 gaps remain
> **Spec**: `docs/LiBrainian/specs/track-f-calibration.md`

### Work Units

| ID | Title | Gap | Complexity | Blocked By |
|----|-------|-----|------------|------------|
| WU-CALX-001 | C1 Causal Attribution | Counterfactual analysis for outcomes | medium | Outcome tracking |
| WU-CALX-002 | C1 Unified Claim-Outcome Index | Relationship indexing | medium | WU-LEDG-005 |
| WU-CALX-003 | C4 Health Score Computation | Aggregate health metrics | medium | WU-SELF-302 |
| WU-CALX-004 | C4 Dashboard Visualization | Real-time calibration monitoring | large | WU-CALX-003 |
| WU-CALX-005 | Confidence Monism Resolution | Per-claim-type calibration | medium | WU-CALX-002 |
| WU-CALX-006 | Time Decay Fallacy Fix | Evidence-based staleness only | small | None |

---

## Implementation Priority: Spec-to-Implementation

### Phase 0: Theoretical Grounding (PREREQUISITE - DO FIRST)

0. **WU-THEO-001-007**: Assess theoretical soundness of all primitives
0. **WU-THEO-101-103**: Literature surveys
0. **WU-THEO-IMPL**: Implement any theory-required changes (scoped by assessment)

### Phase A: Foundation Wiring (AFTER THEORY VALIDATED)

1. **WU-TMPL-001**: Template Registry Interface
2. **WU-LEDG-001-004**: Evidence Ledger Unification (all 4)
3. **WU-CNTR-001**: PrimitiveContract Interface

### Phase B: Contract System (NEXT)

4. **WU-CNTR-002-007**: Full contract system
5. **WU-CNTR-008**: Register all primitives
6. **WU-LEDG-005-006**: Evidence chain & replay

### Phase C: Self-Improvement Core (AFTER VALIDATION)

7. **WU-SELF-101-106**: Core analysis primitives
8. **WU-SELF-107-111**: Improvement primitives
9. **WU-SELF-201-205**: Compositions

### Phase D: Templates & Calibration (ONGOING)

10. **WU-TMPL-002,006-012**: Missing templates
11. **WU-CALX-001-006**: Calibration extensions
12. **WU-SELF-301-305**: Supporting infrastructure

---

## WU-META-BOOTSTRAP: LiBrainian Self-Bootstrapping

> **Status**: READY TO EXECUTE
> **Purpose**: Have LiBrainian index itself - the ultimate dogfooding test
> **Blocked By**: WU-SELF-101 (selfBootstrap primitive) - COMPLETE

### Rationale

LiBrainian should eat its own dogfood by indexing its own codebase. This provides:
1. **Validation**: Tests that the system works on a real, complex TypeScript codebase
2. **Self-awareness**: Enables LiBrainian to answer questions about itself
3. **Calibration data**: Real outcomes for confidence calibration
4. **Improvement signals**: Identifies gaps in its own understanding

### Work Unit

| ID | Title | Description | Blocked By |
|----|-------|-------------|------------|
| WU-META-001 | Execute LiBrainian self-bootstrap | Run selfBootstrap on the LiBrainian codebase itself | WU-SELF-101 |
| WU-META-002 | Validate self-index quality | Query the index and verify accuracy | WU-META-001 |
| WU-META-003 | Generate self-improvement report | Use self-analysis to identify LiBrainian's own issues | WU-META-002 |
| WU-META-004 | Persist self-index | Save the self-index for ongoing use | WU-META-001 |

### Execution Plan

```typescript
// Step 1: Self-bootstrap
const result = await selfBootstrap({
  rootDir: '/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/LiBrainian',
  excludePatterns: [
    'node_modules/**',
    'dist/**',
    '**/*.test.ts',
    'eval-corpus/**'
  ],
  maxFiles: 500  // Start conservative
});

// Step 2: Validate with sample queries
const queries = [
  "What is ConfidenceValue?",
  "How does the evidence ledger work?",
  "What primitives exist for self-improvement?"
];

// Step 3: Generate improvement report
const architectureAnalysis = await analyzeArchitecture({
  rootDir: librarianRoot,
  expectedLayers: ['epistemics', 'agents', 'api', 'cli']
});
```

### Success Criteria

- [ ] Self-bootstrap completes without errors
- [ ] Index contains 80%+ of source files
- [ ] Sample queries return relevant results
- [ ] Architecture analysis identifies real issues
- [ ] Self-improvement recommendations are actionable
