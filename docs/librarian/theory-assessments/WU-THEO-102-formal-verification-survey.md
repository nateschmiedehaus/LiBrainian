# WU-THEO-102: Survey of Formal Verification for LLM Claims

**Work Unit**: WU-THEO-102
**Status**: Complete
**Date**: 2026-01-27
**Type**: Research Survey

---

## Executive Summary

This survey examines the application of formal verification techniques to LLM outputs and claims. Key findings:

1. **Neural network verification is fundamentally different from LLM output verification**: Most formal methods research targets the neural network itself (weights, activations), not the semantic content of outputs
2. **LLM-assisted theorem proving is maturing rapidly**: LLMs can generate proof scripts that are formally verified by proof assistants, achieving near-gold-medal performance on mathematical olympiads
3. **Practical verification focuses on generated code, not natural language**: Type checking, static analysis, and test generation are feasible; verifying arbitrary natural language claims is not
4. **Proof-carrying code concepts apply to AI**: LLM outputs accompanied by machine-checkable proofs offer a path to verified generation
5. **Undecidability limits what can be verified**: Many properties of LLM outputs are provably undecidable; approximation methods are necessary

---

## 1. Formal Methods for AI: Fundamental Distinctions

### 1.1 What "Verification" Means in Different Contexts

| Context | What's Verified | Approach | Feasibility |
|---------|-----------------|----------|-------------|
| **Neural Network Verification** | Network behavior (robustness, safety) | SMT solvers, abstract interpretation | Scalability-limited |
| **LLM Output Verification** | Semantic correctness of generated text | Runtime checking, fact verification | Partial feasibility |
| **Generated Code Verification** | Code correctness against specification | Type systems, formal proofs | Increasingly feasible |
| **Proof Verification** | Mathematical correctness | Proof assistants (Lean, Coq) | Fully feasible |

### 1.2 Can LLM Outputs Be Formally Verified?

**The fundamental challenge**: LLM outputs are natural language (or code), not formal objects. Formal verification requires:

1. **Formal specification** of what "correct" means
2. **Formal representation** of the output
3. **Decision procedure** to check correctness

**What's possible**:
- **Syntactic properties**: Outputs can be constrained to grammars (JSON schema, regex)
- **Type correctness**: Generated code can be type-checked
- **Logical consistency**: Formal proofs can be verified by proof assistants
- **Factual grounding**: Claims can be checked against knowledge bases (but this is NLI, not formal verification)

**What's fundamentally impossible**:
- Verifying arbitrary semantic correctness of natural language
- Proving an LLM "understands" anything
- Guaranteeing factual accuracy for open-domain claims

### 1.3 Verifiable vs. Undecidable Properties

| Property | Status | Notes |
|----------|--------|-------|
| Syntactic validity (parseable) | Decidable | Constrained decoding guarantees this |
| Type correctness | Decidable | Standard type checking |
| Termination | Undecidable | Halting problem |
| Semantic equivalence | Undecidable | Rice's theorem |
| Factual accuracy | Not formally decidable | Requires external knowledge + NLI |
| Logical consistency | Semi-decidable | Can prove inconsistency, not consistency |
| Safety (no harmful content) | Undecidable | Requires semantic understanding |

**Source**: [Limitations on Formal Verification for AI Safety](https://www.alignmentforum.org/posts/B2bg677TaS4cmDPzL/limitations-on-formal-verification-for-ai-safety)

---

## 2. Neural Network Verification (The Traditional Approach)

### 2.1 SMT-Based Verification

**Reluplex and Marabou** are the foundational tools:

- **Approach**: Encode neural network behavior as SMT formulas
- **Target**: Verify properties like robustness (small input perturbations don't change output)
- **Limitation**: Scales poorly beyond small networks (hundreds of neurons)

> "Marabou is a state-of-the-art DNN verifier which encodes verification queries as satisfiability problems, utilizing satisfiability modulo theories (SMT) solving and linear programming (LP) to analyze properties of interest."

**Key Tools**:
- [Marabou](https://github.com/NeuralNetworkVerification/Marabou) - SMT-based verifier
- [Reluplex](https://www.semanticscholar.org/paper/Reluplex:-An-Efficient-SMT-Solver-for-Verifying-Katz-Barrett/b0dc598adda48acab590f95a5985fcc7abf2aca9) - Simplex method extended for ReLU

**Sources**:
- [Challenging SMT solvers to verify neural networks](https://www.researchgate.net/publication/236943114_Challenging_SMT_solvers_to_verify_neural_networks)
- [Scalable Neural Network Verification with Branch-and-bound Inferred Cutting Planes](https://openreview.net/forum?id=FwhM1Zpyft)

### 2.2 Abstract Interpretation

**AI2 Analyzer** (ETH Zurich) pioneered abstract interpretation for DNNs:

> "AI2 is the first sound and scalable analyzer for deep neural networks. The key insight is to phrase reasoning about safety and robustness of neural networks in terms of classic abstract interpretation."

**PyRAT** is a current production tool:
- Based on abstract interpretation
- Second place at VNN-Comp 2024
- Used for safety guarantees in industrial applications

**Key limitation**: Over-approximation means sound but incomplete - can prove properties hold but may fail to verify correct networks.

**Sources**:
- [AI2: Safety and Robustness Certification of Neural Networks](https://ieeexplore.ieee.org/document/8418593/)
- [Neural Network Verification Tutorial](https://neural-network-verification.com/)
- [Verified Deep Learning Book](https://verifieddeeplearning.com/)

### 2.3 Certified Robustness

**Formally verified robustness certifiers** now exist:

> "We present a formally verified robustness certifier that works in two stages: the first stage verifiably pre-computes Lipschitz upper bounds, while the second stage is executed for each model output to verifiably check its robustness. Both stages have been formally verified in the industrial program verifier Dafny."

**Key advancement**: Code-level guarantees rule out both design- and implementation-level flaws.

**Sources**:
- [A Formally Verified Robustness Certifier for Neural Networks](https://arxiv.org/abs/2505.06958)
- [Robustness Certificates for Neural Networks against Adversarial Attacks](https://arxiv.org/abs/2512.20865)

---

## 3. Verification of LLM-Generated Code

### 3.1 Static Analysis Integration

Research shows static analysis can significantly improve LLM-generated code quality:

> "Researchers have introduced an iterative static analysis-driven prompting algorithm that leverages Bandit and Pylint to identify and resolve code quality issues. Experiments with GPT-4o show substantial improvements: security issues reduced from >40% to 13%, readability violations from >80% to 11%, and reliability warnings from >50% to 11% within ten iterations."

**CORE Tool** demonstrates:
- Iterative refinement using static check descriptions
- 59.2% success rate in resolving security vulnerabilities
- 25.8% reduction in false positives

**Sources**:
- [Static Analysis as a Feedback Loop](https://arxiv.org/abs/2508.14419)
- [Towards Formal Verification of LLM-Generated Code from Natural Language Prompts](https://arxiv.org/html/2507.13290v1)

### 3.2 Type Checking and Formal Verification

**Key finding**: LLMs can generate formally verified code when given specifications.

> "Given a formal specification, LLMs can produce assertions, invariants, and auxiliary lemmas to construct a formal proof. LLMs significantly reduce the manual burden of formal verification, making them powerful tools for both improving the reliability of AI-generated code."

**Current capabilities**:
- Dafny code generation with proofs
- C verification through VST and Frama-C
- Rust verification using Verus

**Sources**:
- [Dissect-and-Restore: AI-based Code Verification](https://arxiv.org/html/2510.25406v2)
- [A Benchmark for Vericoding: Formally Verified Program Synthesis](https://arxiv.org/pdf/2509.22908)

### 3.3 Test Generation from Specifications

**TiCoder** workflow demonstrates test-driven interactive code generation:
- LLM generates tests from specifications
- Tests serve as partial formalization of user intent
- Iterative refinement based on test results

**NVIDIA's HEPH System** (production deployment):
- Multi-agent system for test generation
- Teams report saving up to 10 weeks of development time
- Generates both positive and negative test specifications

**Sources**:
- [LLM-based Test-driven Interactive Code Generation](https://www.seas.upenn.edu/~asnaik/assets/papers/tse24_ticoder.pdf)
- [Building AI Agents to Automate Software Test Case Creation](https://developer.nvidia.com/blog/building-ai-agents-to-automate-software-test-case-creation/)

---

## 4. Proof-Carrying Code and LLM Proofs

### 4.1 The Proof-Carrying Code Paradigm

**Original concept** (Necula & Lee, 1996):
- Code accompanied by machine-checkable proof
- Host verifies proof before execution
- No trust required in code producer

**Application to LLM outputs**:

> "Writing proof scripts is one of the best applications for LLMs. It doesn't matter if they hallucinate nonsense, because the proof checker will reject any invalid proof and force the AI agent to retry. The proof checker is a small amount of code that is itself verified, making it virtually impossible to sneak an invalid proof past the checker."

**Key insight**: Proof verification is decidable even when proof generation is hard.

**Sources**:
- [Prediction: AI will make formal verification go mainstream](https://martin.kleppmann.com/2025/12/08/ai-formal-verification.html)
- [Vision Paper: Proof-Carrying Code Completions](https://web.cs.ucdavis.edu/~cdstanford/doc/2024/ASEW24b.pdf)

### 4.2 LLM-Based Theorem Provers

**State of the art** (2024-2025):

| System | Achievement | Benchmark |
|--------|-------------|-----------|
| **BFS-Prover-V2** | 95.08% pass rate | miniF2F |
| **AlphaProof** | Near gold medal | IMO 2024 |
| **Lean Copilot** | 74.2% steps automated | General Lean proofs |
| **PALM** | 1270 additional theorems | Beyond existing approaches |

> "LLM-based theorem provers are neural or neuro-symbolic systems that employ LLMs to generate, verify, refine, and guide the construction of formal mathematical proofs. They now set new state-of-the-art results on canonical formal reasoning benchmarks."

**Sources**:
- [LLM-Based Theorem Provers](https://www.emergentmind.com/topics/llm-based-theorem-provers)
- [Lean Copilot: Large Language Models as Copilots for Theorem Proving](https://arxiv.org/abs/2404.12534)
- [PROOFWALA: Multilingual Proof Data Synthesis](https://arxiv.org/pdf/2502.04671)

### 4.3 Key Tools for Formal Verification

**Proof Assistants**:
- **Lean 4**: Growing ecosystem, mathlib4, used by AlphaProof
- **Coq**: CoqPilot integration, CoqHammer for automation
- **Isabelle**: Archive of Formal Proofs, Sledgehammer

**LLM Integration Tools**:
- **Lean Copilot**: Suggests proof steps, completes goals, selects premises
- **CoqPilot**: LLM integration for Coq
- **PALM**: Generate-then-repair pipeline combining LLMs with symbolic methods

**Sources**:
- [Survey on Deep Learning for Theorem Proving](https://github.com/zhaoyu-li/DL4TP)
- [Proof Automation with Large Language Models](https://arxiv.org/html/2409.14274v1)

---

## 5. Constrained Decoding for Guaranteed Output Structure

### 5.1 Grammar-Constrained Decoding (GCD)

> "GCD can guarantee that LLM outputs match such rules by masking out tokens that will provably lead to outputs that do not belong to a specified context-free grammar (CFG)."

**This is true formal verification**: The output is guaranteed to parse correctly.

**Key approaches**:
- **Grammar-Aligned Decoding (GAD)**: Provably matches conditional probability given grammar
- **Domino Algorithm**: Minimal overhead, sometimes increases throughput
- **XGrammar**: Efficient preprocessing for production use

**Sources**:
- [Grammar-Aligned Decoding](https://arxiv.org/abs/2405.21047)
- [Flexible and Efficient Grammar-Constrained Decoding](https://arxiv.org/pdf/2502.05111)
- [Awesome-LLM-Constrained-Decoding](https://github.com/Saibo-creator/Awesome-LLM-Constrained-Decoding)

### 5.2 What GCD Can Guarantee

| Property | Can Guarantee | Notes |
|----------|---------------|-------|
| Valid JSON | Yes | JSON schema as grammar |
| Matches regex | Yes | Regex patterns enforceable |
| Type-correct code | Partial | Requires type system encoding |
| Semantically correct | No | Grammar is syntax, not semantics |

---

## 6. Runtime Monitoring and Assertion Checking

### 6.1 LLM Testing Frameworks

**DeepEval** brings unit testing paradigm to LLMs:
- Pytest-like interface for LLM outputs
- Metrics: G-Eval, task completion, answer relevancy, hallucination
- CI/CD integration via GitHub Actions

**Runtime monitoring approaches**:
1. **Trace and monitor**: Real-time production alerts
2. **Regression testing**: Pre-built test datasets
3. **LLM-as-judge**: Models evaluate model outputs

**Sources**:
- [DeepEval: The LLM Evaluation Framework](https://github.com/confident-ai/deepeval)
- [LLM Testing: Top Methods and Strategies](https://www.confident-ai.com/blog/llm-testing-in-2024-top-methods-and-strategies)

### 6.2 Runtime Verification from Natural Language

**LLM-synthesized monitors**:

> "Research has demonstrated how LLMs can be harnessed to synthesize runtime verification monitors from natural language specifications. A natural language description is translated into code that performs runtime verification for the described property."

This bridges the gap between informal specifications and formal monitoring.

**Source**: [End-to-End AI Generated Runtime Verification from Natural Language Specification](https://link.springer.com/chapter/10.1007/978-3-031-73741-1_23)

---

## 7. Fact-Checking as Approximate Verification

### 7.1 MiniCheck: Efficient Fact-Checking

> "The researchers show how to build small fact-checking models that have GPT-4-level performance but for 400x lower cost."

**MiniCheck** (EMNLP 2024):
- 770M parameter model (Flan-T5-Large)
- GPT-4 accuracy on LLM-AggreFact benchmark
- Commercially usable (Bespoke-MiniCheck-7B)

**Not formal verification** but practical approximate verification for grounded claims.

**Sources**:
- [MiniCheck: Efficient Fact-Checking of LLMs on Grounding Documents](https://arxiv.org/abs/2404.10774)
- [MiniCheck GitHub](https://github.com/Liyan06/MiniCheck)

### 7.2 Hallucination Detection

**Token-level approaches**:

> "HaluGate is a conditional, token-level hallucination detection pipeline that catches unsupported claims before they reach users. It uses no LLM-as-judge, no Python runtime--just fast, explainable verification at the point of delivery."

**Methods**:
- Semantic entropy (Nature 2024)
- Attention pattern analysis
- Hidden state probes
- External knowledge base checking

**Sources**:
- [Token-Level Truth: Real-Time Hallucination Detection](https://blog.vllm.ai/2025/12/14/halugate.html)
- [Hallucination Detection and Evaluation of Large Language Model](https://www.arxiv.org/pdf/2512.22416)

---

## 8. Fundamental Limitations

### 8.1 Scalability Challenges

**Neural network verification**:
- Current tools handle networks with hundreds to thousands of neurons
- LLMs have billions of parameters
- Direct verification of LLM internals is computationally infeasible

> "Due to the poor scalability of MIP solvers, large neural networks cannot benefit from these cutting planes."

**Source**: [Scalable Neural Network Verification](https://proceedings.neurips.cc/paper_files/paper/2024/file/33d93e4dc57453e7667b20f62e7c0681-Paper-Conference.pdf)

### 8.2 Undecidability Results

From research on limitations of AI safety verification:

> "Unlike Godel's proof of incompleteness theorems and Turing's proof of the undecidability of the halting problem (which are in the context of axiomatic systems), their argument applies to AI systems that need to solve task instances like program verification or planning."

**Key implications**:
- Cannot verify arbitrary AI behavior is "safe"
- Cannot prove LLM outputs are "correct" in general
- Can only verify specific, well-defined properties

**Source**: [Limitations on Safe, Trusted, Artificial General Intelligence](https://arxiv.org/pdf/2509.21654)

### 8.3 Symbolic Execution Limitations

> "AutoSpec, the state-of-the-art LLM-based approach, integrates static analysis, LLMs, and formal verification to decompose programs and generate specifications bottom-up. However, its performance degrades for programs involving data structures such as structs and linked lists."

**Challenges**:
- Unbounded loops and recursion
- Complex control flow
- Heap-allocated data structures
- LLMs as "approximate oracles" that sometimes give wrong answers

**Sources**:
- [Large Language Model Powered Symbolic Execution](https://arxiv.org/abs/2505.13452)
- [Can Large Language Models Solve Path Constraints in Symbolic Execution?](https://arxiv.org/html/2511.18288)

---

## 9. Recommendations for LiBrainian

### 9.1 What CAN Be Formally Verified

| Property | Technique | Implementation Path |
|----------|-----------|---------------------|
| **Output structure** | Constrained decoding | Use Outlines/XGrammar for JSON/schema |
| **Code compiles** | Type checker as verifier | Run compiler/type checker |
| **Code passes tests** | Test execution | Generate and run tests |
| **Formal proofs valid** | Proof assistant | Lean4/Coq verification |
| **Grammar correctness** | Parser | Standard parsers as verifiers |

### 9.2 What CANNOT Be Formally Verified (But Can Be Approximated)

| Property | Approximation Technique | Tool |
|----------|------------------------|------|
| **Factual accuracy** | NLI/fact-checking | MiniCheck |
| **Semantic correctness** | Semantic entropy | Self-consistency |
| **No hallucination** | Grounding verification | RAG + faithfulness |
| **Code correctness** | Static analysis + tests | Bandit, Pylint, pytest |
| **Safety** | Constitutional AI + monitoring | Runtime checks |

### 9.3 Recommended Verification Strategy for LiBrainian

**Tier 1: Formal Verification (Guaranteed)**
1. **Constrained decoding** for structured outputs (JSON, code syntax)
2. **Type checking** for generated code
3. **Test execution** for functional correctness
4. **Proof verification** for any formal claims

**Tier 2: Strong Approximate Verification**
1. **Static analysis** (security, reliability, maintainability)
2. **MiniCheck/NLI** for factual grounding
3. **Semantic entropy** for uncertainty detection
4. **Self-consistency** for reasoning validation

**Tier 3: Heuristic Verification**
1. **LLM-as-judge** for quality assessment
2. **Regression testing** against known-good outputs
3. **Human review** for high-stakes decisions

### 9.4 Specific Implementation Recommendations

**For code generation**:
1. Generate code with formal specifications (pre/post conditions)
2. Use Dafny/Verus for verification when specifications exist
3. Fall back to type checking + static analysis + tests
4. Track verification confidence level per claim

**For factual claims**:
1. Decompose claims into atomic facts
2. Use MiniCheck for grounding verification
3. Apply semantic entropy for uncertainty
4. Flag unverifiable claims explicitly

**For documentation**:
1. Constrain output to valid markdown/schema
2. Cross-reference claims against codebase
3. Version-aware verification (API changes)
4. Explicit confidence signals for all claims

### 9.5 Honest Limitations to Document

LiBrainian's verification strategy should explicitly acknowledge:

1. **No guarantee of semantic correctness** for natural language
2. **Approximate, not formal, fact-checking** for most claims
3. **Undecidability of general safety properties**
4. **Scalability limits** prevent verifying internal model behavior
5. **Hallucination detection is probabilistic**, not certain

---

## 10. Key Papers and Tools

### Foundational Papers

1. **Reluplex: An Efficient SMT Solver for Verifying DNNs** (Katz et al., 2017)
   - [Semantic Scholar](https://www.semanticscholar.org/paper/Reluplex:-An-Efficient-SMT-Solver-for-Verifying-Katz-Barrett/b0dc598adda48acab590f95a5985fcc7abf2aca9)
   - Foundation of SMT-based neural network verification

2. **AI2: Safety and Robustness Certification with Abstract Interpretation** (Gehr et al., 2018)
   - [IEEE Xplore](https://ieeexplore.ieee.org/document/8418593/)
   - Abstract interpretation for DNNs

3. **Proof-Carrying Code** (Necula & Lee, 1996)
   - Original PCC paradigm

### LLM Verification Papers (2024-2025)

4. **MiniCheck: Efficient Fact-Checking of LLMs** (Tang et al., EMNLP 2024)
   - [ACL Anthology](https://aclanthology.org/2024.emnlp-main.499/)
   - State-of-the-art fact verification

5. **A Formally Verified Robustness Certifier for Neural Networks** (2025)
   - [arXiv](https://arxiv.org/abs/2505.06958)
   - Dafny-verified robustness certification

6. **Static Analysis as a Feedback Loop** (2025)
   - [arXiv](https://arxiv.org/abs/2508.14419)
   - Iterative static analysis for LLM code

7. **Lean Copilot** (2024)
   - [arXiv](https://arxiv.org/abs/2404.12534)
   - LLM-assisted theorem proving

8. **Grammar-Aligned Decoding** (NeurIPS 2024)
   - [arXiv](https://arxiv.org/abs/2405.21047)
   - Provable grammar constraints

### Tools

| Tool | Purpose | Link |
|------|---------|------|
| **Marabou** | SMT-based DNN verification | [GitHub](https://github.com/NeuralNetworkVerification/Marabou) |
| **PyRAT** | Abstract interpretation for DNNs | VNN-Comp 2024 |
| **Lean4** | Proof assistant | [Lean](https://lean-lang.org/) |
| **Lean Copilot** | LLM + Lean integration | [GitHub](https://github.com/lean-dojo/LeanCopilot) |
| **DeepEval** | LLM testing framework | [GitHub](https://github.com/confident-ai/deepeval) |
| **MiniCheck** | Fact-checking | [GitHub](https://github.com/Liyan06/MiniCheck) |
| **Outlines** | Constrained decoding | [GitHub](https://github.com/outlines-dev/outlines) |
| **XGrammar** | Efficient grammar constraints | Production use |

---

## 11. Summary

### What's Feasible Today

1. **Formal verification of output structure** via constrained decoding
2. **Type checking and static analysis** of generated code
3. **Test-based verification** of functional correctness
4. **Proof verification** when LLMs generate formal proofs
5. **Approximate fact-checking** via NLI models (MiniCheck)

### What's Theoretical or Limited

1. **Verifying semantic correctness** of natural language
2. **Direct verification of LLM internals** (scalability barrier)
3. **General safety guarantees** (undecidable)
4. **Complete hallucination prevention** (requires world knowledge)

### What's Promising for Near-Term

1. **LLM-assisted theorem proving** (rapidly maturing)
2. **Proof-carrying code generation** (AI generates code + proof)
3. **Hybrid symbolic-neural verification** (LLM + SMT solver)
4. **Runtime monitoring from specifications** (LLM-synthesized monitors)

### Recommendation for LiBrainian

**Adopt a tiered verification strategy**:
- **Tier 1**: Use formal methods where possible (structure, types, proofs)
- **Tier 2**: Use strong approximations where formal methods fail (MiniCheck, semantic entropy)
- **Tier 3**: Use heuristics and human review for remaining uncertainty
- **Always**: Be explicit about what level of verification each claim has

The key insight from this survey: **LLM outputs cannot be formally verified in general, but specific properties can be**. Design LiBrainian to maximize the proportion of outputs that fall into verifiable categories, and be honest about the rest.

---

*Survey completed 2026-01-27. Research sources: Web search covering 2024-2026 publications on formal verification, neural network verification, and LLM output verification.*
