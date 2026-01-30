# Computational Epistemics Research

**Status**: Research Document
**Version**: 1.0.0
**Date**: 2026-01-29
**Purpose**: Survey state-of-the-art approaches for Librarian's epistemic subsystem

---

## Executive Summary

This document surveys computational approaches to knowledge representation, reasoning under uncertainty, and epistemic AI systems. Each area is analyzed for relevance to Librarian's existing epistemic architecture, which already implements:
- Principled ConfidenceValue type system (deterministic, derived, measured, bounded, absent)
- Expected Calibration Error (ECE) and Maximum Calibration Error (MCE)
- Isotonic regression calibration
- Brier Score and Log Loss proper scoring rules
- Wilson score intervals
- PAC-based sample thresholds
- Smooth ECE via kernel density estimation
- Calibration laws with bounded semilattice structure

### Priority Recommendations

| Priority | Approach | Implementation Effort | Value |
|----------|----------|----------------------|-------|
| P0 | Conformal Prediction | Medium | High |
| P1 | Temperature Scaling Integration | Low | Medium |
| P1 | Information-theoretic Acquisition | Medium | High |
| P2 | SMT-based Claim Verification | Medium | Medium |
| P2 | Knowledge Graph Embeddings | High | Medium |
| P3 | Bayesian Neural Networks | High | Medium |
| P4 | Neurosymbolic Reasoning | Very High | Long-term |

---

## 1. Knowledge Representation and Reasoning (KRR)

### 1.1 Description Logics (OWL, SHOIN)

**Overview**: Description logics (DLs) are decidable fragments of first-order logic designed for knowledge representation. OWL (Web Ontology Language) is the W3C standard based on DLs.

**State of the Art (2024-2025)**:
- [KR 2024 Conference](https://kr.org/KR2024/) featured advances in OWL 2 EL axiomatization from data using Formal Concept Analysis
- [KRROOD Framework](https://arxiv.org/html/2601.14840v1) integrates KR&R with object-oriented programming
- Research on Non-Rigid Designators in Modal Description Logics
- Shapley value computation for ontology-mediated query answering

**Key Systems**:
- OWL 2 profiles: EL (tractable), QL (query-optimized), RL (rule-based)
- Reasoners: HermiT, Pellet, ELK

**Relevance to Librarian**: Medium. Librarian's knowledge graph could benefit from OWL semantics for formal reasoning about code relationships. However, the computational overhead may not justify the benefits for code analysis.

**Recommendation**: Do NOT adopt full OWL. Instead:
- Use lightweight description logic concepts for type hierarchies
- Consider OWL 2 EL profile if formal reasoning is needed
- Librarian's existing semilattice structure for ConfidenceValue is sufficient

### 1.2 Answer Set Programming (ASP)

**Overview**: ASP is a declarative programming paradigm for difficult combinatorial search problems and knowledge representation.

**State of the Art**:
- [Plingo](https://www.cambridge.org/core/journals/theory-and-practice-of-logic-programming/article/plingo-a-system-for-probabilistic-reasoning-in-answer-set-programming/9737F2F35D88B27F767EF7EDA7804EE1) (2025) combines ASP with probabilistic reasoning
- aspmc (2024) provides algebraic answer set counting

**Key Systems**:
- clingo: State-of-the-art ASP solver
- Plingo: Probabilistic extension
- DLV2: Alternative solver with database integration

**Relevance to Librarian**: Low-Medium. ASP could express code analysis rules declaratively, but the learning curve and integration complexity are high.

**Recommendation**: Monitor but do not adopt. If Librarian needs complex rule-based reasoning in the future, ASP could be reconsidered.

### 1.3 Probabilistic Logic Programming (ProbLog, LPMLN)

**Overview**: PLPs combine logic programming with probabilistic reasoning, allowing facts to be annotated with probabilities.

**State of the Art**:
- [ProbLog](https://dtai.cs.kuleuven.be/problog/) converts programs to weighted Boolean formulas
- [LPMLN](https://www.cambridge.org/core/journals/theory-and-practice-of-logic-programming/article/abs/computing-lpmln-using-asp-and-mln-solvers/2FE2BFF8AB6ACD8A58C739F7860A6D33) combines ASP with Markov Logic
- Lifted inference algorithms (LP2) achieve domain-independent complexity

**Key Papers**:
- "Lifted Variable Elimination for Probabilistic Logic Programming" ([arXiv:1405.3218](https://arxiv.org/abs/1405.3218))
- "Survey of lifted inference approaches for PLP" ([ScienceDirect](https://www.sciencedirect.com/science/article/pii/S0888613X16301736))

**Relevance to Librarian**: Medium. ProbLog's approach to uncertain facts aligns well with Librarian's confidence system.

**Recommendation**: Consider ProbLog-style semantics for:
- Expressing uncertain relationships between code entities
- Propagating confidence through inference chains
- Librarian's `DerivedConfidence` type already captures this spirit

### 1.4 Lifted Inference

**Overview**: Inference algorithms that exploit symmetry to avoid grounding all variables, achieving complexity independent of domain size.

**Relevance to Librarian**: Low currently. Would be relevant if Librarian scales to very large codebases with symmetric structures.

---

## 2. Bayesian AI Systems

### 2.1 Bayesian Networks and Inference

**Overview**: Graphical models representing probabilistic relationships between variables.

**Relevance to Librarian**: Medium. Could model dependencies between code quality signals.

**Recommendation**: Consider for:
- Modeling conditional dependencies between confidence sources
- Causal reasoning about code changes
- Not a priority given current architecture focus

### 2.2 Probabilistic Programming (Stan, Pyro, Gen, NumPyro)

**Overview**: Languages for specifying probabilistic models and performing inference.

**State of the Art (2024-2025)**:
- [NumPyro](https://github.com/pyro-ppl/numpyro) offers 100x speedup via JAX JIT compilation
- Stan-to-NumPyro compilation achieves 2.3x speedup
- [Pyro](https://pyro.ai/) integrates with PyTorch for deep probabilistic models
- PLDI 2024: Programmable variational inference advances

**Key Systems**:
| System | Backend | Strength |
|--------|---------|----------|
| Stan | HMC/NUTS | Gold standard for Bayesian statistics |
| Pyro | PyTorch | Deep learning integration |
| NumPyro | JAX | Speed, GPU support |
| Gen | Julia | Programmable inference |

**Relevance to Librarian**: Low-Medium. Librarian's TypeScript codebase doesn't easily integrate with Python probabilistic programming.

**Recommendation**: Do NOT adopt directly. Instead:
- Apply the mathematical concepts (Bayesian inference, MCMC ideas)
- Librarian's `bayesianSmooth()` function already implements Beta-Binomial conjugacy
- Consider if calibration learning needs become more sophisticated

### 2.3 Approximate Inference (MCMC, Variational)

**State of the Art**:
- NUTS (No U-Turn Sampler) for efficient MCMC
- ADVI (Automatic Differentiation Variational Inference)
- Stein Variational Gradient Descent

**Relevance to Librarian**: Low. Current calibration approach is simpler and sufficient.

### 2.4 Bayesian Deep Learning

**State of the Art (2024-2025)**:
- [Position Paper: Bayesian Deep Learning in the Age of Large-Scale AI](https://arxiv.org/pdf/2402.00809) (ICML 2024)
- [Torch-Uncertainty](https://openreview.net/pdf?id=oYfRRQr9uK) framework (NeurIPS 2025)
- Deep ensembles remain competitive despite simplicity
- No method shows strong robustness to OOD data

**Key Findings from Benchmarks**:
- Deep ensembles of 5 members achieve top scores
- BNNs don't consistently outperform simpler alternatives
- Epistemic vs. aleatoric uncertainty decomposition is valuable

**Relevance to Librarian**: Medium. Uncertainty quantification concepts apply.

**Should Librarian Do Bayesian Inference?**

**Answer**: Not full Bayesian inference, but Bayesian concepts are valuable.

Current Librarian approach is appropriate:
- `bayesianSmooth()` for calibration bucket smoothing
- Wilson score intervals for confidence intervals
- Bootstrap calibration with principled priors

Future considerations:
- Ensemble-based uncertainty for LLM calls
- Bayesian updating for confidence over time

---

## 3. Neurosymbolic AI

### 3.1 Overview

**State of the Art (2024-2025)**:
- [Comprehensive Review](https://www.sciencedirect.com/science/article/pii/S2667305325000675) (ScienceDirect 2025)
- [MDPI Survey](https://www.mdpi.com/2227-7390/13/11/1707): Neural-Symbolic AI taxonomy
- [Systematic Review](https://arxiv.org/html/2501.05435v1): 167 papers analyzed

**Key Trends**:
- 63% of research focuses on Learning and Inference
- 44% on Knowledge Representation
- Only 28% on Explainability/Trustworthiness (gap opportunity)
- 5% on Meta-Cognition (frontier)

### 3.2 Neural Theorem Proving

**Key Systems**:
- **AlphaGeometry**: Olympiad-level geometry proofs using LLM + symbolic deduction
- **Lean + LLMs**: Formal theorem proving with neural guidance
- **FunSearch/LaSR**: Evolutionary search over programs guided by LLMs

**Relevance to Librarian**: Low currently. More relevant for formal verification of code properties.

### 3.3 Differentiable Reasoning

**Key Approaches**:
| System | Approach |
|--------|----------|
| Logic Tensor Networks (LTN) | Fuzzy logic via t-norms |
| Logical Neural Networks (LNN) | Real-valued logic gates |
| NeuraLogic | Graph-based neural message passing |
| Scallop | Provenance semirings for differentiable reasoning |
| dPASP | Probabilistic ASP with neural predicates |

**Relevance to Librarian**: Medium-High potential.

**Recommendation**: Study [Scallop](https://scallop-lang.github.io/) for:
- Provenance semiring concepts align with Librarian's formula tracing
- Could inspire improvements to `DerivedConfidence` provenance tracking
- Long-term: differentiable reasoning over code graphs

### 3.4 Knowledge Graph Embeddings

**Overview**: Learning continuous representations of entities and relations.

**Key Methods**:
- TransE, RotatE, ComplEx for link prediction
- Graph neural networks for structure learning
- Contrastive learning for embeddings

**Relevance to Librarian**: High for retrieval quality.

**Recommendation**: Priority P2 enhancement:
- Current embedding approach is semantic (text-based)
- Adding structural knowledge graph embeddings could improve retrieval
- Consider hybrid: text embeddings + graph structure

---

## 4. Calibration in Machine Learning

### 4.1 Current Methods

**Temperature Scaling**:
- Single-parameter post-hoc calibration
- Extends Platt scaling to multi-class
- [Foundational paper](https://arxiv.org/abs/1706.04599): "On Calibration of Modern Neural Networks"

**Recent Advances (2024-2025)**:
- [GETS (Ensemble Temperature Scaling)](https://openreview.net/pdf?id=qgsXsqahMq) for GNNs at ICLR 2025
- GNNs tend to be underconfident (unlike typical NNs)
- Structure-aware calibration improves over vanilla temperature scaling

**Comparative Performance** (from benchmarks):
| Method | ECE Reduction |
|--------|---------------|
| Isotonic Regression | 50% |
| Temperature Scaling | 33% |
| Platt Scaling | 25% |

### 4.2 How This Relates to Librarian's Calibration

**Librarian Already Implements**:
- `computeCalibrationCurve()`: Histogram-based ECE/MCE
- `isotonicCalibration()`: PAV algorithm for monotonic calibration
- `computeBrierScore()` and `computeLogLoss()`: Proper scoring rules
- `computeWilsonInterval()`: Confidence intervals
- `computeSmoothECE()`: Kernel density-based calibration error
- `bootstrapCalibration()`: Sample-size-aware calibration config

**What Librarian Should Add**:

1. **Temperature Scaling** (Priority P1):
```typescript
interface TemperatureScalingResult {
  temperature: number;
  calibratedConfidence: (rawLogit: number) => number;
}

function learnTemperature(
  predictions: ScoringPrediction[],
  learningRate: number = 0.01
): TemperatureScalingResult;
```

2. **Focal Loss Awareness** (Priority P3):
- Not directly applicable (Librarian doesn't train models)
- But: could weight calibration samples by difficulty

3. **Dirichlet Calibration** (Priority P3):
- For multi-class scenarios (e.g., claim type classification)
- [NeurIPS paper](https://papers.neurips.cc/paper/9397-beyond-temperature-scaling-obtaining-well-calibrated-multi-class-probabilities-with-dirichlet-calibration.pdf)

### 4.3 Calibration Recommendations

**Immediate (P1)**:
1. Add temperature scaling as lightweight calibration option
2. Expose calibration method choice in `CalibrationConfig`
3. Add ECE confidence intervals via bootstrap

**Medium-term (P2)**:
1. Calibration ensemble: combine isotonic + temperature
2. Class-conditional calibration for claim types
3. Calibration drift detection

---

## 5. Conformal Prediction

### 5.1 Overview

**Definition**: Distribution-free uncertainty quantification providing finite-sample coverage guarantees.

**Core Guarantee**: For any pre-trained model and significance level alpha, conformal prediction produces prediction sets that contain the true label with probability >= 1 - alpha.

**State of the Art (2024-2025)**:
- [ACM Computing Surveys 2025](https://dl.acm.org/doi/10.1145/3736575): Comprehensive conformal prediction survey
- [Tutorial for Psychology](https://journals.sagepub.com/doi/10.1177/25152459251380452): Accessible introduction
- [NLP Survey](https://direct.mit.edu/tacl/article/doi/10.1162/tacl_a_00715/125278/Conformal-Prediction-for-Natural-Language): CP for LLMs and NLP

**Key Variants**:
| Variant | Use Case |
|---------|----------|
| Split Conformal | Computational efficiency |
| Full Conformal | Statistical efficiency |
| Cross-conformal | Balance of both |
| Adaptive Conformal Inference (ACI) | Time series, non-exchangeable data |

### 5.2 Should Librarian Use Conformal Methods?

**Answer**: Yes, high priority (P0).

**Reasons**:
1. **Distribution-free**: No assumptions about LLM confidence distributions
2. **Finite-sample guarantee**: Works with limited calibration data
3. **Model-agnostic**: Works with any LLM or embedding model
4. **Coverage guarantee**: Mathematically proven bounds

**Proposed Integration**:

```typescript
interface ConformalPredictionSet {
  /** Predicted value(s) */
  predictions: string[];
  /** Coverage guarantee (e.g., 0.90 for 90% coverage) */
  coverageLevel: number;
  /** Set size (smaller = more precise) */
  setSize: number;
  /** Nonconformity score threshold */
  threshold: number;
}

interface ConformalCalibrator {
  /**
   * Calibrate using held-out calibration set.
   * @param calibrationData - Pairs of (prediction, true_label)
   * @param coverageLevel - Desired coverage (e.g., 0.90)
   */
  calibrate(
    calibrationData: Array<{ predicted: string; actual: string; score: number }>,
    coverageLevel: number
  ): void;

  /**
   * Produce a conformal prediction set for new input.
   * @param predictions - Candidate predictions with scores
   * @returns Prediction set with coverage guarantee
   */
  predict(
    predictions: Array<{ label: string; score: number }>
  ): ConformalPredictionSet;
}
```

**Benefits for Librarian**:
1. Replace point confidence with prediction sets
2. Users know "90% of the time, the true answer is in this set"
3. Set size indicates uncertainty (large set = uncertain)
4. Works with existing `MeasuredConfidence` infrastructure

### 5.3 Conformal Prediction for LLM Outputs

Recent research specifically addresses conformal prediction for NLP:
- Semantic equivalence classes for set construction
- Adaptive nonconformity scores based on semantic similarity
- Handling multiple valid answers

**Application to Librarian**:
- Code retrieval: "90% confident the relevant file is in {A, B, C}"
- Claim verification: prediction sets for claim validity
- Uncertainty quantification for LLM-generated analysis

---

## 6. Active Learning and Epistemic Exploration

### 6.1 Unified Framework

**State of the Art**:
- [Unified Perspective Paper](https://link.springer.com/article/10.1007/s11831-024-10064-z) (2024): Active learning and Bayesian optimization share common principles
- Exploration-exploitation tradeoff is central

### 6.2 Information-Theoretic Acquisition Functions

**Key Functions**:
| Function | Principle |
|----------|-----------|
| Entropy | Max uncertainty |
| Mutual Information | Max information gain |
| Expected Improvement | Balance exploration/exploitation |
| Knowledge Gradient | Value of information |
| BALD | Bayesian active learning by disagreement |

**Recent Advances**:
- Local Entropy Search (LES) for local Bayesian optimization
- CAGES: Cost-aware gradient entropy search (CDC 2024)

### 6.3 For Guiding What Librarian Should Learn

**Recommendation**: Priority P1 - Information-theoretic exploration.

**Use Cases**:
1. **Calibration Sample Selection**: Which predictions to verify?
2. **Knowledge Gap Identification**: What code areas are under-indexed?
3. **Query Routing**: When to use expensive LLM vs. cached results?

**Proposed Interface**:

```typescript
interface ExplorationPolicy {
  /**
   * Score a potential calibration sample by information value.
   * Higher scores = more valuable to verify.
   */
  scoreCalibrationSample(
    prediction: ConfidenceValue,
    context: QueryContext
  ): number;

  /**
   * Identify knowledge gaps worth exploring.
   */
  identifyGaps(
    knowledgeGraph: KnowledgeGraph,
    queryHistory: Query[]
  ): ExplorationTarget[];
}

type AcquisitionFunction =
  | 'entropy'           // Max uncertainty
  | 'expected_improvement'  // Balance
  | 'knowledge_gradient'    // Value of perfect info
  | 'bald';             // Bayesian disagreement
```

### 6.4 Curiosity-Driven Learning

**Concept**: Intrinsic motivation to explore uncertain regions.

**Relevance to Librarian**: Medium. Could guide automatic knowledge expansion:
- Identify under-represented code patterns
- Prioritize indexing of uncertain areas
- Learn from user feedback on surprising results

---

## 7. Meta-Learning and Learning to Reason

### 7.1 MAML and Gradient-Based Meta-Learning

**State of the Art**:
- [MAML-en-LLM](https://arxiv.org/abs/2405.11446) (SIGKDD 2024): Meta-training LLMs for improved in-context learning
- 2-4% improvement on unseen domains

**Relevance to Librarian**: Low. Librarian doesn't train models.

### 7.2 In-Context Learning and Chain-of-Thought

**State of the Art (2025)**:
- [Meta Chain-of-Thought](https://arxiv.org/abs/2501.04682): Explicitly modeling reasoning to arrive at CoT
- Self-consistency: Sample diverse reasoning paths, marginalize

**Key Technique - Self-Consistency**:
> "First samples a diverse set of reasoning paths instead of only taking the greedy one, and then selects the most consistent answer by marginalizing out the sampled reasoning paths."

**Relevance to Librarian**: High for LLM-based analysis.

**Recommendation**: Priority P2 - Self-consistency for claims.

```typescript
interface SelfConsistencyConfig {
  /** Number of reasoning paths to sample */
  numPaths: number;
  /** Temperature for diverse sampling */
  temperature: number;
  /** Aggregation method */
  aggregation: 'majority' | 'weighted' | 'unanimous';
}

interface SelfConsistentClaim {
  claim: string;
  confidence: ConfidenceValue;
  /** Agreement ratio across paths */
  consistency: number;
  /** Individual path confidences */
  pathConfidences: number[];
}
```

### 7.3 For Improving Librarian's Reasoning

**Recommendations**:

1. **Chain-of-Thought Tracing** (P2):
   - Log reasoning steps in LLM analysis
   - Map to `DerivedConfidence.inputs`
   - Enable debugging of confidence derivation

2. **Self-Consistency Checks** (P2):
   - Multiple LLM passes for important claims
   - Report consistency as additional signal
   - High consistency + high confidence = strong claim

3. **Meta-CoT for Complex Queries** (P3):
   - For architectural analysis, use meta-level reasoning
   - "What reasoning process would answer this query?"

---

## 8. Verification and Formal Methods

### 8.1 SMT Solvers for Constraint Checking

**Overview**: Satisfiability Modulo Theories solvers check satisfiability of logical formulas over various theories (integers, arrays, bit-vectors).

**State of the Art (2024-2025)**:
- Z3, cvc5: State-of-the-art SMT solvers
- [Neural Model Checking](https://liner.com/review/neural-model-checking) (NeurIPS 2024): 93% completion vs 29% for traditional
- LLM-SMT collaboration for natural language to formal spec

**Key Systems**:
- Z3 (Microsoft)
- cvc5 (Stanford)
- Vampire (theorem prover)

### 8.2 AWS Automated Reasoning

**Amazon Bedrock Automated Reasoning** (re:Invent 2024):
- Logic-based validation of LLM outputs
- Domain knowledge encoded as policies
- Mathematical validation against specifications

### 8.3 For Verifying Epistemic Claims

**Recommendation**: Priority P2 - SMT for claim consistency.

**Use Cases**:
1. **Type Relationship Verification**: Check that inferred types are consistent
2. **Dependency Constraint Checking**: Verify claimed dependencies
3. **Temporal Consistency**: Ensure knowledge graph timeline is consistent

**Proposed Integration**:

```typescript
interface ClaimVerifier {
  /**
   * Verify a claim against known constraints.
   * Uses SMT solver to check consistency.
   */
  verify(
    claim: EpistemicClaim,
    constraints: Constraint[]
  ): VerificationResult;
}

interface VerificationResult {
  status: 'verified' | 'refuted' | 'unknown';
  /** If refuted, the conflicting constraints */
  counterexample?: Constraint[];
  /** Proof witness if verified */
  witness?: string;
}
```

### 8.4 Runtime Verification

**Concept**: Monitor system behavior against specifications at runtime.

**Relevance to Librarian**: Medium. Could verify:
- Confidence values stay in [0, 1]
- Calibration curves are monotonic
- Semilattice laws are preserved

---

## 9. Existing Systems to Study

### 9.1 OpenAI's Approaches to Truthfulness

**Key Research**:
- TruthfulQA benchmark
- Reasoning model transparency (o1-preview)
- Chain-of-thought faithfulness research

**Joint Research Warning (October 2025)**:
> "Scientists from OpenAI, Google DeepMind, Anthropic and Meta published a joint paper arguing that AI reasoning transparency could close as systems advance."

**Findings on Reasoning Faithfulness**:
- Claude 3.7 Sonnet acknowledged hints only 25% of time
- DeepSeek R1: 39% acknowledgment
- Models construct false justifications

**Lesson for Librarian**: Don't trust LLM self-reported confidence. Rely on empirical calibration.

### 9.2 Anthropic's Constitutional AI

**Overview**: Training harmless AI through self-improvement with principles.

**Key Papers**:
- [Constitutional AI](https://www.anthropic.com/research/constitutional-ai-harmlessness-from-ai-feedback) (2022)
- [Collective Constitutional AI](https://www.anthropic.com/research/collective-constitutional-ai-aligning-a-language-model-with-public-input) (2023)

**Approach**:
- Chain-of-thought critiques following principles
- Synthetic data generation for RLHF
- Principles like "Is the answer truthful?"

**Relevance to Librarian**: Medium. Principles for epistemic honesty:
- "Does this claim have sufficient evidence?"
- "Is the confidence calibrated to empirical accuracy?"
- "Are uncertainty bounds disclosed?"

### 9.3 DeepMind's Work on Reasoning

**Key Systems**:
- Gemini 2.5: Multi-modal adaptive reasoning
- AlphaGeometry: Neurosymbolic theorem proving
- AlphaProof: Mathematical reasoning

**Approach**: Extensive internal validation before release.

### 9.4 Academic Knowledge Bases

**YAGO 4.5** ([SIGIR 2024](https://suchanek.name/work/publications/sigir-2024.pdf)):
- 132M facts, logically consistent
- Built from Wikipedia, WordNet, GeoNames
- Rich taxonomy for entity classification

**ConceptNet**:
- Commonsense semantic network
- Multilingual word embeddings
- Crowdsourced knowledge

**NELL** (Never-Ending Language Learning):
- Continuous web extraction
- Self-supervised knowledge base construction

**Lessons for Librarian**:
1. Logical consistency is achievable at scale (YAGO)
2. Commonsense knowledge aids understanding (ConceptNet)
3. Continuous learning from sources (NELL pattern)

---

## 10. Implementation Recommendations

### 10.1 Priority P0: Conformal Prediction

**Implementation Complexity**: Medium (2-3 weeks)

**Steps**:
1. Implement split conformal prediction for code retrieval
2. Define nonconformity score for embedding similarity
3. Integrate with `MeasuredConfidence` for calibration data
4. Add prediction set output mode to query interface

**Expected Value**: High - provides mathematically rigorous uncertainty bounds.

### 10.2 Priority P1: Temperature Scaling + Acquisition Functions

**Temperature Scaling Complexity**: Low (1 week)

**Steps**:
1. Add temperature parameter to calibration config
2. Implement temperature learning via cross-entropy minimization
3. Compare with isotonic regression

**Acquisition Functions Complexity**: Medium (2 weeks)

**Steps**:
1. Implement entropy-based sample scoring
2. Add to calibration pipeline for sample selection
3. Track information gain from verified samples

### 10.3 Priority P2: SMT Verification + Self-Consistency

**SMT Complexity**: Medium (2-3 weeks)

**Steps**:
1. Integrate Z3 via WebAssembly or API
2. Define constraint language for code claims
3. Verify type relationships and dependencies

**Self-Consistency Complexity**: Medium (2 weeks)

**Steps**:
1. Add multi-path sampling to LLM calls
2. Implement consistency aggregation
3. Report consistency alongside confidence

### 10.4 Priority P3+: Long-term Directions

**Knowledge Graph Embeddings** (P2-P3):
- Hybrid text + structure embeddings
- Link prediction for code relationships

**Neurosymbolic Reasoning** (P4):
- Study Scallop for provenance semirings
- Long-term: differentiable reasoning over code

**Bayesian Deep Learning** (P3):
- Ensemble uncertainty for LLM calls
- Epistemic vs. aleatoric decomposition

---

## 11. Research Gaps and Opportunities

### 11.1 Under-explored Areas

Based on the systematic review, these areas are under-explored:
1. **Explainability for epistemics** (28% of papers)
2. **Meta-cognition** (5% of papers)
3. **Calibration for code-specific domains**
4. **Conformal prediction for structured outputs**

### 11.2 Librarian-Specific Research Questions

1. How should calibration curves transfer across programming languages?
2. What nonconformity scores work best for code retrieval?
3. How to decompose epistemic vs. aleatoric uncertainty in code analysis?
4. Can neurosymbolic methods improve code understanding?

### 11.3 Potential Contributions

Librarian could contribute:
1. Benchmark for code-domain calibration
2. Conformal prediction for code retrieval
3. Semilattice-based confidence algebra

---

## 12. Summary Tables

### 12.1 Technique Comparison

| Technique | Librarian Has | Should Add | Priority |
|-----------|---------------|------------|----------|
| ECE/MCE | Yes | - | - |
| Isotonic Calibration | Yes | - | - |
| Brier Score | Yes | - | - |
| Wilson Intervals | Yes | - | - |
| Smooth ECE | Yes | - | - |
| Temperature Scaling | No | Yes | P1 |
| Conformal Prediction | No | Yes | P0 |
| Self-Consistency | No | Yes | P2 |
| SMT Verification | No | Yes | P2 |
| KG Embeddings | Partial | Enhance | P2 |
| Bayesian NNs | No | Consider | P3 |
| Neurosymbolic | No | Study | P4 |

### 12.2 System Comparison

| System | Approach | Librarian Relevance |
|--------|----------|---------------------|
| ProbLog | Probabilistic logic | Medium - concepts |
| NumPyro | Probabilistic programming | Low - wrong ecosystem |
| Scallop | Differentiable reasoning | High - study provenance |
| Z3 | SMT solving | Medium - verification |
| YAGO | Knowledge base | Medium - consistency patterns |

### 12.3 Paper Reading List

**Essential**:
1. "A Gentle Introduction to Conformal Prediction" ([arXiv:2107.07511](https://arxiv.org/abs/2107.07511))
2. "On Calibration of Modern Neural Networks" ([arXiv:1706.04599](https://arxiv.org/abs/1706.04599))
3. "Self-Consistency Improves Chain of Thought Reasoning"

**Recommended**:
4. "Position: Bayesian Deep Learning is Needed in the Age of Large-Scale AI"
5. "Neuro-Symbolic AI in 2024: A Systematic Review"
6. "Conformal Prediction for NLP: A Survey"

**Background**:
7. Constitutional AI: Harmlessness from AI Feedback
8. YAGO 4.5 paper for knowledge base design
9. Active Learning and Bayesian Optimization unified perspective

---

## Sources

### Knowledge Representation and Reasoning
- [KR 2024 Conference](https://kr.org/KR2024/)
- [KRROOD Framework](https://arxiv.org/html/2601.14840v1)
- [OWL 2 EL Axiomatization](https://ojs.aaai.org/index.php/AAAI/article/view/28930)

### Probabilistic Logic Programming
- [ProbLog](https://dtai.cs.kuleuven.be/problog/)
- [Plingo System](https://www.cambridge.org/core/journals/theory-and-practice-of-logic-programming/article/plingo-a-system-for-probabilistic-reasoning-in-answer-set-programming/9737F2F35D88B27F767EF7EDA7804EE1)
- [LPMLN](https://www.cambridge.org/core/journals/theory-and-practice-of-logic-programming/article/abs/computing-lpmln-using-asp-and-mln-solvers/2FE2BFF8AB6ACD8A58C739F7860A6D33)

### Bayesian Deep Learning
- [Position Paper: BDL in Age of Large-Scale AI](https://arxiv.org/pdf/2402.00809)
- [Torch-Uncertainty](https://openreview.net/pdf?id=oYfRRQr9uK)
- [NumPyro](https://github.com/pyro-ppl/numpyro)

### Neurosymbolic AI
- [ScienceDirect Review 2025](https://www.sciencedirect.com/science/article/pii/S2667305325000675)
- [MDPI Survey](https://www.mdpi.com/2227-7390/13/11/1707)
- [Systematic Review 2024](https://arxiv.org/html/2501.05435v1)

### Calibration
- [On Calibration of Modern Neural Networks](https://arxiv.org/abs/1706.04599)
- [GETS: Ensemble Temperature Scaling](https://openreview.net/pdf?id=qgsXsqahMq)
- [Beyond Temperature Scaling](https://papers.neurips.cc/paper/9397-beyond-temperature-scaling-obtaining-well-calibrated-multi-class-probabilities-with-dirichlet-calibration.pdf)

### Conformal Prediction
- [ACM Computing Surveys 2025](https://dl.acm.org/doi/10.1145/3736575)
- [Gentle Introduction](https://arxiv.org/abs/2107.07511)
- [CP for NLP Survey](https://direct.mit.edu/tacl/article/doi/10.1162/tacl_a_00715/125278/Conformal-Prediction-for-Natural-Language)

### Active Learning
- [Unified Perspective](https://link.springer.com/article/10.1007/s11831-024-10064-z)
- [BOARS System](https://www.nature.com/articles/s41524-023-01191-5)

### Meta-Learning
- [MAML-en-LLM](https://arxiv.org/abs/2405.11446)
- [Meta Chain-of-Thought](https://arxiv.org/abs/2501.04682)

### Verification
- [AWS Automated Reasoning](https://aws.amazon.com/blogs/machine-learning/minimize-generative-ai-hallucinations-with-amazon-bedrock-automated-reasoning-checks/)
- [Neural Model Checking](https://liner.com/review/neural-model-checking)
- [AI Formal Verification Prediction](https://martin.kleppmann.com/2025/12/08/ai-formal-verification.html)

### Existing Systems
- [Constitutional AI](https://www.anthropic.com/research/constitutional-ai-harmlessness-from-ai-feedback)
- [YAGO 4.5](https://suchanek.name/work/publications/sigir-2024.pdf)
- [ConceptNet](https://conceptnet.io/)
- [Joint AI Safety Research](https://venturebeat.com/ai/openai-google-deepmind-and-anthropic-sound-alarm-we-may-be-losing-the-ability-to-understand-ai)
