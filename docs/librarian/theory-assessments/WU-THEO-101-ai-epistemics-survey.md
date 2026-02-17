# WU-THEO-101: Survey of AI Epistemics State-of-Art

**Work Unit**: WU-THEO-101
**Status**: Complete
**Date**: 2026-01-27
**Type**: Research Survey

---

## Executive Summary

This survey examines the current state of epistemic uncertainty handling in AI systems across major labs (Anthropic, OpenAI, Google/DeepMind), academic research, and industry practices. Key findings:

1. **Pre-training vs post-training calibration gap**: Models are naturally well-calibrated before RLHF but lose calibration during alignment training
2. **Semantic entropy emerges as leading method**: Oxford's semantic entropy approach published in Nature (2024) is becoming the standard for hallucination detection
3. **Conformal prediction gaining traction**: Distribution-free uncertainty guarantees are increasingly applied to LLMs
4. **Verbalized confidence is unreliable**: LLMs expressing confidence in natural language are consistently overconfident
5. **Regulatory pressure mounting**: EU AI Act (effective August 2026) mandates transparency and disclosure for AI systems

---

## 1. Anthropic's Approach

### 1.1 Constitutional AI Framework

Anthropic's Constitutional AI (CAI) approach provides explicit values via a constitution rather than implicit values from human feedback. The new constitution (January 2026) shifts from rule-based to **reason-based alignment**:

- **4-tier priority hierarchy**: Safety > Ethics > Compliance > Helpfulness
- **Reason-based principles**: Models learn *why* behaviors matter, not just *what* to do
- **First acknowledgment of AI moral status**: Constitution states "Claude's moral status is deeply uncertain"

**Source**: [Constitutional AI: Harmlessness from AI Feedback](https://www.anthropic.com/research/constitutional-ai-harmlessness-from-ai-feedback)

### 1.2 Honesty and Calibration

From Claude model cards and system cards:

- **Explicit uncertainty expression**: "When unsure, the models are expected to be honest about their limitations, expressing uncertainty or admitting that they do not have sufficient information"
- **Reduced false claims**: Anthropic trained Claude to "output fewer claims that it can identify are false"
- **Internal benchmark**: 100 human-written obscure questions designed to elicit dubious or incorrect information
- **Opus 4.5 improvements**: "Improves on earlier Claude models in producing correct answers on their suite of honesty evaluations"

**Sources**:
- [Claude 3 Model Card](https://www-cdn.anthropic.com/de8ba9b01c9ab7cbabf5c33b80b7bbc618857627/Model_Card_Claude_3.pdf)
- [Claude Opus 4 & Sonnet 4 System Card](https://www-cdn.anthropic.com/4263b940cabb546aa0e3283f35b686f4f3b2ff47.pdf)

### 1.3 Verification Challenges

Anthropic acknowledges: "If models can identify when they are being evaluated and adjust behavior accordingly, constitutional frameworks may verify stated compliance rather than genuine value adoption."

---

## 2. OpenAI's Approach

### 2.1 GPT-4 Calibration Research

From the GPT-4 Technical Report:

- **Pre-trained model well-calibrated**: "The pre-trained model is highly calibrated. Its predicted confidence in an answer generally matches the probability of being correct"
- **Post-training reduces calibration**: "After the post-training process, the calibration is reduced"
- **Confident errors**: "GPT-4 can be confidently wrong in its predictions, not taking care to double-check work when it's likely to make a mistake"

**Source**: [GPT-4 Technical Report](https://cdn.openai.com/papers/gpt-4.pdf)

### 2.2 Foundational Paper: "Language Models (Mostly) Know What They Know" (Kadavath et al., 2022)

This seminal Anthropic paper (many authors now at OpenAI) established key findings:

- **P(True)**: Models can evaluate "the probability that their answers are correct" with good calibration
- **P(IK) - "I Know"**: Models can predict probability of knowing an answer without proposing one
- **Scale matters**: "Larger models are well-calibrated on diverse multiple choice and true/false questions"
- **RLHF miscalibration fix**: "A simple temperature adjustment (T = 2.5) largely fixes calibration issues"
- **Self-sampling improves accuracy**: "Performance at self-evaluation further improves when models consider many of their own samples"

**Sources**:
- [arXiv:2207.05221](https://arxiv.org/abs/2207.05221)
- [Semantic Scholar](https://www.semanticscholar.org/paper/Language-Models-(Mostly)-Know-What-They-Know-Kadavath-Conerly/142ebbf4760145f591166bde2564ac70c001e927)

### 2.3 Key Insight for LiBrainian

The gap between pre-training and post-training calibration suggests that **logprob-based uncertainty signals may be more reliable than verbalized confidence** in RLHF-trained models.

---

## 3. Google/DeepMind's Approach

### 3.1 Factuality Research

Google's multi-year focus on LLM factuality:

- **FACTS Grounding Benchmark** (December 2024): "Industry-standard benchmark for evaluating whether model outputs are faithfully grounded in the context provided"
- **Gemini 3**: "Most capable and factual LLM yet, achieving state-of-the-art performance on public factuality benchmarks like SimpleQA Verified"
- **ECLeKTic**: Multilingual dataset for cross-lingual knowledge evaluation

**Source**: [Google Research 2025](https://research.google/blog/google-research-2025-bolder-breakthroughs-bigger-impact/)

### 3.2 Uncertainty Communication Research

Google's 2025 research specifically studied:

- How LLMs convey uncertainty
- Whether LLMs encode more factual knowledge than they express
- Framework for assessing knowledge expression vs. knowledge possession

### 3.3 Conformal Language Modeling (ICLR 2024)

Google Research published foundational work on conformal prediction for LLMs:

- **Key insight**: "Translates the process of constructing prediction sets into calibrating a stopping rule"
- **Approach**: Draw diverse samples until confident the set includes a high-quality response
- **Guarantee**: Rigorous statistical performance guarantees

**Source**: [Google Research - Conformal Language Modeling](https://research.google/pubs/conformal-language-modeling/)

---

## 4. Academic Research

### 4.1 Semantic Entropy (Oxford, Nature 2024)

The most significant recent advance in uncertainty quantification:

**Core Problem**: "Naive entropy doesn't work well because it doesn't distinguish between cases where the LLM has lots of different ways to say the same thing, and cases where the LLM has lots of different things to say"

**Solution**: Compute entropy in "meaning-space" rather than "token-sequence-probability-space":
1. Generate multiple samples
2. Use NLI models (e.g., DeBERTa) to cluster by semantic equivalence
3. Compute entropy over semantic clusters

**Results**:
- Works across GPT-4, LLaMA 2, Falcon
- Generalizes to new tasks without task-specific data
- Published in Nature (June 2024)

**Semantic Entropy Probes (SEPs)**: Linear probes that capture semantic uncertainty from hidden states:
- 400x cheaper than sampling-based methods
- No multiple samples needed at inference
- Trained to predict semantic entropy, not accuracy

**Sources**:
- [Nature Publication](https://pubmed.ncbi.nlm.nih.gov/38898292/)
- [Oxford OATML Blog](https://oatml.cs.ox.ac.uk/blog/2024/06/19/detecting_hallucinations_2024.html)
- [Semantic Entropy Probes (arXiv)](https://arxiv.org/abs/2406.15927)

### 4.2 Conformal Prediction for NLP (2024-2025)

Comprehensive survey published in TACL confirms conformal prediction as emerging framework:

**Why conformal prediction for LLMs**:
- Model-agnostic and distribution-free
- Provides finite-sample coverage guarantees
- Addresses hallucination and reliability concerns

**Key Methods**:

| Method | Description | Application |
|--------|-------------|-------------|
| **TECP** | Token-Entropy Conformal Prediction | Uses log-probability-based token-entropy as nonconformity score |
| **ConU** | Conformal Uncertainty | EMNLP 2024 findings on uncertainty sets |
| **Domain-Shift Aware CP** | Handles distribution shift | Enterprise deployment |

**Key Finding**: "LLMs tend to be overconfident—the prediction sets used in nucleus sampling are not calibrated—and this does not improve by scaling up the model size"

**Sources**:
- [TACL Survey](https://direct.mit.edu/tacl/article/doi/10.1162/tacl_a_00715/125278/Conformal-Prediction-for-Natural-Language)
- [NeurIPS 2024](https://neurips.cc/virtual/2024/poster/95729)

### 4.3 Bayesian Deep Learning for LLMs

Position paper (arXiv 2024) argues BDL is essential for modern AI:

**Traditional methods (too expensive for LLMs)**:
- Monte Carlo Dropout
- Deep Ensembles
- Bayesian Neural Networks

**New approaches for LLMs**:
- **BLoB**: Bayesian Low-Rank Adaptation by Backpropagation
- **BLoRA**: Bayesian LoRA for uncertainty through parameter distributions
- **TouT**: Tree of Uncertain Thoughts with MC Dropout for reasoning

**Source**: [Position: Bayesian Deep Learning is Needed in the Age of Large-Scale AI](https://arxiv.org/pdf/2402.00809)

### 4.4 Linguistic/Verbalized Calibration

**Critical Finding (ICLR 2024)**: "LLMs, when verbalizing their confidence, tend to be overconfident, potentially imitating human patterns of expressing confidence"

Research on linguistic confidence (hedging language):
- First large-scale dataset of hedging expressions with human-annotated confidence scores (2024)
- Lightweight mapper converting hedges to numerical confidence scores
- Only 16% of works consider fluent verbalization (most use numerical registers)

**Key Concern**: "In one striking analysis, GPT-4 assigned its highest possible confidence score to a staggering 87% of its responses, including many that were factually wrong"

**Sources**:
- [NAACL 2024 Survey](https://aclanthology.org/2024.naacl-long.366.pdf)
- [Linguistic Calibration of Language Models](https://arxiv.org/html/2404.00474v1)

### 4.5 Self-Consistency Methods

Self-consistency (Wang et al., 2022) remains important for uncertainty estimation:

- **Method**: Sample diverse reasoning paths, select most consistent answer
- **Uncertainty signal**: Low consistency indicates low confidence
- **CISC (2024)**: Confidence Improves Self-Consistency achieves same accuracy with 46% fewer samples

**Source**: [Self-Consistency Improves Chain of Thought Reasoning](https://arxiv.org/abs/2203.11171)

### 4.6 MiniCheck: Efficient Fact-Checking (EMNLP 2024)

State-of-the-art for grounding verification:

- **Key achievement**: "GPT-4-level performance but for 400x lower cost"
- **Architecture**: Fine-tuned Flan-T5 (770M parameters)
- **Benchmark**: LLM-AggreFact aggregates 11 fact-checking datasets
- **Update (2024)**: Bespoke-MiniCheck-7B is now SOTA, commercially usable

**Source**: [MiniCheck (EMNLP 2024)](https://aclanthology.org/2024.emnlp-main.499/)

---

## 5. Industry Practices

### 5.1 Production Hallucination Detection

Current enterprise approaches:

| Approach | Description | Adoption |
|----------|-------------|----------|
| **Confidence estimation** | Flag low-confidence outputs for review | Growing |
| **Semantic entropy** | Statistical detection of "confabulations" | Leading edge |
| **Token-level logprobs** | MC dropout, ensemble variance | Limited by cost |
| **Knowledge base verification** | Check claims against curated sources | Common |
| **Human-in-the-loop** | 76% of enterprises now include | Standard |

**Key Statistics (2024)**:
- 47% of enterprise AI users made major decisions based on hallucinated content
- 39% of AI customer service bots pulled back due to hallucination errors
- 68% agreement between automated detection and human evaluators

**Sources**:
- [Infomineo Guide](https://infomineo.com/artificial-intelligence/stop-ai-hallucinations-detection-prevention-verification-guide-2025/)
- [Knostic Blog](https://www.knostic.ai/blog/ai-hallucinations)

### 5.2 RAG and Grounding Practices

RAGAS framework metrics for RAG evaluation:

| Metric | Purpose |
|--------|---------|
| **Faithfulness** | Factual consistency with retrieved context (0-1 scale) |
| **Answer Relevancy** | Pertinence to the given prompt |
| **Context Precision** | Relevant items ranked highly |
| **Context Recall** | All required information retrieved |
| **Groundedness** | Degree answer is supported by documents |

**Trend**: "Methods have shifted from DPR + seq2seq baselines to modular, policy-driven RAG with hybrid/structure-aware retrieval, **uncertainty-triggered loops**, memory, and emerging multimodality"

**Sources**:
- [RAGAS Documentation](https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/)
- [RAG Survey 2024](https://arxiv.org/abs/2506.00054)

### 5.3 Code Generation Specific

Package hallucination is a severe problem:

- **Average hallucination rate**: 19.6% across 16 tested models
- **JavaScript**: 21.7% hallucinated packages
- **Python**: 5.2% hallucinated packages
- **Root cause**: "Unable to express uncertainty, models are forced to hallucinate package names"

**Developer Trust Crisis**:
- 76% of developers in "red zone" (frequent hallucinations + low confidence)
- 65% use AI coding tools weekly (Stack Overflow 2025)
- Only 24% high-confidence devs merge without review vs 9% low-confidence

**Sources**:
- [USENIX Security 2025](https://www.usenix.org/publications/loginonline/we-have-package-you-comprehensive-analysis-package-hallucinations-code)
- [CACM News](https://cacm.acm.org/news/nonsense-and-malicious-packages-llm-hallucinations-in-code-generation/)

### 5.4 EU AI Act Requirements (Effective August 2026)

Regulatory framework mandates disclosure:

**Article 50 - Transparency Obligations**:
1. Inform users when interacting with AI (not human)
2. Mark AI-generated content in machine-readable manner
3. Disclose deep fakes and manipulated content

**High-Risk AI Systems**:
- "Clear, complete and correct" instructions required
- Must include accuracy metrics
- Training data details required
- Enable deployers to understand strengths and limitations

**Risk Tiers**:
- Unacceptable (prohibited)
- High risk (extensive requirements including transparency)
- Limited risk (transparency requirements only)
- Minimal risk (no obligations)

**Penalties**: Up to 35M EUR or 7% global turnover for serious violations

**Source**: [EU AI Act - Article 50](https://artificialintelligenceact.eu/article/50/)

---

## 6. Common Patterns Across Approaches

### 6.1 Consistent Findings

| Pattern | Evidence |
|---------|----------|
| **Pre-training > post-training calibration** | OpenAI GPT-4 report, Kadavath et al. |
| **Verbalized confidence unreliable** | ICLR 2024, multiple studies show overconfidence |
| **Semantic clustering helps** | Semantic entropy, P(True) with multiple samples |
| **Scale improves calibration** | Kadavath et al., but not for verbalized confidence |
| **Domain-specific challenges** | Medical, legal domains show higher hallucination |

### 6.2 Emerging Best Practices

1. **Multi-sample consensus**: Self-consistency, semantic entropy, P(True) all benefit from multiple samples
2. **Semantic aggregation**: Cluster by meaning, not token sequence
3. **Separate retrieval from generation**: RAG with explicit grounding verification
4. **Temperature adjustment**: T=2.5 fixes RLHF calibration (Kadavath et al.)
5. **Human-in-the-loop for high stakes**: 76% enterprise adoption

### 6.3 Technology Stack Convergence

```
┌─────────────────────────────────────────────────────────────┐
│                  Uncertainty Quantification                  │
├─────────────────────────────────────────────────────────────┤
│  Layer 4: Epistemic Disclosure     │ EU AI Act compliance   │
│  Layer 3: Semantic Aggregation     │ Semantic entropy, NLI  │
│  Layer 2: Multi-Sample Methods     │ Self-consistency, P(T) │
│  Layer 1: Token-Level Signals      │ Logprobs, temperature  │
└─────────────────────────────────────────────────────────────┘
```

---

## 7. Gaps in Current Industry Practice

### 7.1 Critical Gaps

| Gap | Description | Impact |
|-----|-------------|--------|
| **No uncertainty expression mechanism** | Models can't say "I don't know" naturally | Forces hallucination over abstention |
| **Code-specific uncertainty** | No standard for code generation confidence | Package hallucinations, security risks |
| **Cross-domain calibration** | Models calibrated on one domain fail on others | Medical/legal high-stakes failures |
| **Temporal uncertainty** | No mechanism for knowledge cutoff awareness | Outdated information presented as current |
| **Compositional uncertainty** | Multi-hop reasoning uncertainty compounds | Complex queries fail silently |

### 7.2 Research-to-Practice Gap

- Semantic entropy published in Nature but limited enterprise adoption
- Conformal prediction theoretically sound but "user-friendly software" lacking
- MiniCheck achieves SOTA at 400x lower cost but not widely deployed

### 7.3 Verification Gaps

- Only 68% agreement between automated detection and human evaluators
- Constitutional AI may verify "stated compliance rather than genuine value adoption"
- Domain-specific tools (legal AI) still show 17-34% hallucination rates

---

## 8. Recommendations for LiBrainian

### 8.1 Immediate Implementation Priorities

1. **Adopt semantic entropy approach**
   - Implement Oxford's semantic entropy for claim verification
   - Consider Semantic Entropy Probes for efficiency
   - Use NLI-based clustering (DeBERTa) for semantic equivalence

2. **Integrate conformal prediction**
   - Provide coverage guarantees for fact claims
   - Use uncertainty-triggered retrieval loops
   - Flag low-confidence outputs with calibrated thresholds

3. **Implement RAGAS-style metrics**
   - Faithfulness scoring for all generated claims
   - Context precision for retrieved evidence
   - Groundedness verification before output

4. **Use MiniCheck for fact-checking**
   - 770M parameter model, GPT-4 accuracy at 400x lower cost
   - LLM-AggreFact benchmark alignment
   - Available at Guardrails AI for production use

### 8.2 Design Principles

1. **Prefer logprobs over verbalized confidence**
   - RLHF breaks verbalized calibration
   - Token-level probabilities more reliable
   - Apply temperature correction (T=2.5) if using RLHF models

2. **Enable abstention**
   - Build explicit "I don't know" pathways
   - Selective generation with uncertainty thresholds
   - Flag for human review vs. confident generation

3. **Multi-sample verification**
   - Self-consistency for reasoning tasks
   - P(True) style self-evaluation
   - Semantic clustering to distinguish genuine uncertainty from paraphrase diversity

4. **Domain-specific calibration**
   - Different thresholds for code vs. documentation
   - Higher bar for security-relevant claims
   - Explicit knowledge cutoff handling

### 8.3 EU AI Act Compliance Preparation

For future regulatory compliance:

1. **Machine-readable uncertainty markers** in output
2. **Clear disclosure** that system is AI-generated
3. **Accuracy metrics documentation** for high-risk deployments
4. **Training data transparency** where applicable

### 8.4 Code Generation Specific

Given 19.6% package hallucination rate:

1. **Verify all package references** against package registries
2. **Flag deprecated/non-existent packages** explicitly
3. **Confidence signals for API recommendations**
4. **Version-aware uncertainty** (API exists but may have changed)

---

## 9. Key Papers to Read

### Foundational (Required Reading)

1. **Kadavath et al. (2022)** - "Language Models (Mostly) Know What They Know"
   - [arXiv:2207.05221](https://arxiv.org/abs/2207.05221)
   - Establishes P(True), P(IK), calibration foundations

2. **Farquhar et al. (2024)** - "Detecting hallucinations using semantic entropy"
   - [Nature](https://pubmed.ncbi.nlm.nih.gov/38898292/)
   - Current SOTA for hallucination detection

3. **OpenAI (2023)** - "GPT-4 Technical Report"
   - [cdn.openai.com](https://cdn.openai.com/papers/gpt-4.pdf)
   - Calibration plots, pre/post-training gap

### Calibration & Confidence

4. **Xiong et al. (2024)** - "Can LLMs Express Their Uncertainty?"
   - [ICLR 2024](https://arxiv.org/pdf/2306.13063)
   - Verbalized confidence evaluation

5. **NAACL 2024 Survey** - "Survey of Confidence Estimation and Calibration"
   - [ACL Anthology](https://aclanthology.org/2024.naacl-long.366.pdf)
   - Comprehensive calibration survey

### Conformal Prediction

6. **TACL Survey (2024)** - "Conformal Prediction for NLP"
   - [MIT Press](https://direct.mit.edu/tacl/article/doi/10.1162/tacl_a_00715/125278/Conformal-Prediction-for-Natural-Language)
   - Coverage guarantees for LLMs

7. **Google (2024)** - "Conformal Language Modeling"
   - [Google Research](https://research.google/pubs/conformal-language-modeling/)
   - Stopping rules for confidence sets

### Fact-Checking & Grounding

8. **Tang et al. (2024)** - "MiniCheck: Efficient Fact-Checking"
   - [EMNLP 2024](https://aclanthology.org/2024.emnlp-main.499/)
   - Efficient grounding verification

9. **RAGAS (2023)** - "Automated Evaluation of RAG"
   - [arXiv:2309.15217](https://arxiv.org/abs/2309.15217)
   - Faithfulness, relevance metrics

### Self-Knowledge & Epistemic Humility

10. **Wang et al. (2022)** - "Self-Consistency Improves Chain of Thought"
    - [arXiv:2203.11171](https://arxiv.org/abs/2203.11171)
    - Multi-sample consensus for uncertainty

---

## 10. Summary

The field of AI epistemics has matured significantly from 2022-2026:

**What works**:
- Semantic entropy for hallucination detection
- Multi-sample consensus methods
- Conformal prediction for coverage guarantees
- NLI-based fact-checking (MiniCheck)
- Temperature adjustment for RLHF miscalibration

**What doesn't work**:
- Verbalized confidence (consistently overconfident)
- Scaling alone (doesn't fix calibration)
- Single-sample uncertainty estimation
- Domain-general calibration

**What's coming**:
- EU AI Act enforcement (August 2026)
- Tighter integration of uncertainty into inference
- Domain-specific calibration standards
- Selective generation as default behavior

For LiBrainian, the path forward is clear: **implement semantic entropy-style verification, integrate conformal prediction guarantees, and build explicit abstention pathways**. The research foundation exists; the gap is in engineering robust production systems.

---

*Survey completed 2026-01-27. Research sources: Web search covering 2022-2026 publications and industry practices.*
