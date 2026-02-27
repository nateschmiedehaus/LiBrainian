# Research-Implementation Mapping Document

> **Generated**: 2026-01-27
> **Purpose**: Validate research findings integration and identify gaps to reduce hallucination rate from 12.5% to <5%

---

## Executive Summary

The LiBrainian project has made significant progress implementing research-backed hallucination detection techniques. However, several high-impact research findings remain unimplemented. This document maps research techniques to current implementation status and prioritizes gaps.

### Key Findings

| Category | Research Coverage | Implementation Gap |
|----------|------------------|-------------------|
| Entailment Checking | Partial | Missing MiniCheck model integration |
| Citation Verification | Good | Missing SAFE search augmentation |
| Iterative Retrieval | Basic | Missing IRCoT/Self-RAG reflection tokens |
| Consistency Checking | Good | Missing SelfCheckGPT multi-sampling |
| Self-Improvement Loop | Excellent | Missing RLVR reward signal integration |

---

## Research Technique Mapping

### WU-CAT-HALLUCINATION: Hallucination Detection & Prevention

#### MiniCheck (EMNLP 2024)

| Aspect | Research Finding | Current Implementation | Status |
|--------|-----------------|----------------------|--------|
| Core Concept | GPT-4 level grounding at 400x lower cost, 77.4% accuracy | `entailment_checker.ts` - Rule-based claim extraction and AST verification | PARTIAL |
| Claim Decomposition | Atomic fact verification | Pattern-based claim extraction (`CLAIM_PATTERNS`) | IMPLEMENTED |
| Model Integration | MiniCheck-7B local model | No LLM integration - uses AST facts only | GAP |
| NLI-based Checking | Natural language inference for entailment | Heuristic-based support checking | GAP |

**File**: `/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/LiBrainian/src/evaluation/entailment_checker.ts`

**Implementation Notes**:
- The `EntailmentChecker` class uses pattern matching to extract claims (lines 109-224)
- Checks claims against AST facts, not actual MiniCheck NLI
- Verdict logic is rule-based: supporting vs contradicting evidence count (lines 289-338)
- **Gap**: No actual neural entailment model - relies on structural AST comparison

#### SAFE (DeepMind NeurIPS 2024)

| Aspect | Research Finding | Current Implementation | Status |
|--------|-----------------|----------------------|--------|
| Core Concept | Search-augmented factuality, 20x cheaper than human annotation | `citation_verifier.ts` - AST-based verification only | PARTIAL |
| Search Augmentation | Use web search to verify facts | No external search integration | GAP |
| Multi-step Verification | Decompose-then-verify pipeline | Single-step verification against AST | GAP |
| Cost Efficiency | Automated at scale | Fully automated local verification | IMPLEMENTED |

**File**: `/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/LiBrainian/src/evaluation/citation_verifier.ts`

**Implementation Notes**:
- `CitationVerifier` extracts citations and verifies against AST facts (lines 107-232)
- Verification is local-only: file existence, line validity, identifier matching
- **Gap**: No search augmentation to verify facts beyond the codebase

#### SelfCheckGPT

| Aspect | Research Finding | Current Implementation | Status |
|--------|-----------------|----------------------|--------|
| Core Concept | Multi-sample consistency verification | `consistency_checker.ts` - Query variant comparison | PARTIAL |
| Multi-Sampling | Generate multiple responses, check consistency | Variant generation for same question | SIMILAR |
| AUROC Target | >= 0.75 for inconsistency detection | Not measured | GAP |
| Fact Extraction | Extract key facts for comparison | Pattern-based fact extraction (lines 166-188) | IMPLEMENTED |

**File**: `/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/LiBrainian/src/evaluation/consistency_checker.ts`

**Implementation Notes**:
- `ConsistencyChecker` generates query variants and compares answers (lines 228-276)
- Detects direct contradictions, partial conflicts, missing/extra facts
- **Gap**: Not multi-sample from LLM - variant-based approach instead

#### Chain-of-Verification (ACL 2024)

| Aspect | Research Finding | Current Implementation | Status |
|--------|-----------------|----------------------|--------|
| Core Concept | 4-step self-verification process, +23% F1 | Not implemented | GAP |
| Verification Steps | Draft -> Plan -> Execute -> Refine | N/A | GAP |

**Status**: NOT IMPLEMENTED - Major gap for hallucination reduction

---

### WU-CAT-RETRIEVAL: Advanced Retrieval Techniques

#### IRCoT (ACL 2023) / Self-RAG (ICLR 2024)

| Aspect | Research Finding | Current Implementation | Status |
|--------|-----------------|----------------------|--------|
| Core Concept | Interleaved retrieval with chain-of-thought | `iterative_retrieval.ts` - Multi-round retrieval | PARTIAL |
| Interleaved Retrieval | Retrieve-reason-retrieve cycles | Term extraction -> query expansion -> re-retrieve | SIMILAR |
| Reflection Tokens | Self-evaluation of retrieval quality | Coverage estimation only | GAP |
| CoT Integration | Chain-of-thought during retrieval | No reasoning chain | GAP |

**File**: `/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/LiBrainian/src/evaluation/iterative_retrieval.ts`

**Implementation Notes**:
- `IterativeRetriever` performs multi-round retrieval (lines 149-262)
- Term expansion and cross-file chasing implemented
- **Gap**: No reflection tokens, no reasoning chain interleaving

#### DRAGIN (ACL 2024)

| Aspect | Research Finding | Current Implementation | Status |
|--------|-----------------|----------------------|--------|
| Core Concept | Dynamic retrieval with attention-based needs detection | Not implemented | GAP |
| Attention Signals | Detect when model needs more information | No attention monitoring | GAP |

**Status**: NOT IMPLEMENTED

---

### WU-CAT-CONTRADICTION: Contradiction & Consistency Detection

#### C4RLLaMA / CARL-CCI

| Aspect | Research Finding | Current Implementation | Status |
|--------|-----------------|----------------------|--------|
| Core Concept | Code comment consistency checking | `comment_code_checker.ts` - Comprehensive checking | EXCELLENT |
| Parameter Mismatch | JSDoc vs actual params | Implemented (lines 272-329) | IMPLEMENTED |
| Return Mismatch | JSDoc vs actual return | Implemented (lines 334-385) | IMPLEMENTED |
| Stale References | References to non-existent code | Implemented (lines 390-460) | IMPLEMENTED |
| Semantic Drift | Comment describes different behavior | Implemented (lines 803-839) | IMPLEMENTED |

**File**: `/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/LiBrainian/src/evaluation/comment_code_checker.ts`

**Status**: WELL IMPLEMENTED - This is a strong implementation matching research goals

---

### WU-CAT-SELFIMPROVE: Scientific Self-Improvement Loop

#### AutoSD / RLVR / SWE-Gym

| Aspect | Research Finding | Current Implementation | Status |
|--------|-----------------|----------------------|--------|
| Core Concept | Hypothesis-driven automated debugging | `loop_orchestrator.ts` + agents | IMPLEMENTED |
| Hypothesis Generation | Generate testable hypotheses | `hypothesis_generator.ts` - Template-based | IMPLEMENTED |
| RLVR Rewards | Binary test pass/fail as reward | `fix_verifier.ts` - Binary reward | IMPLEMENTED |
| Self-Play | Bug injection/solving loops | Not implemented | GAP |

**Files**:
- `/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/LiBrainian/src/agents/loop_orchestrator.ts`
- `/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/LiBrainian/src/agents/hypothesis_generator.ts`

**Implementation Notes**:
- Complete scientific loop with Problem -> Hypothesis -> Test -> Fix -> Verify cycle
- Uses heuristic templates (no LLM) for Tier-0 compatibility
- **Gap**: Self-play bug injection not implemented

---

## Gap Analysis Summary

### Critical Gaps (High Impact on Hallucination Reduction)

| Gap | Research Source | Expected Impact | Implementation Effort |
|-----|----------------|-----------------|----------------------|
| Chain-of-Verification | ACL 2024 | +23% F1 improvement | Medium |
| MiniCheck Model Integration | EMNLP 2024 | 77.4% grounding accuracy | High |
| Self-RAG Reflection Tokens | ICLR 2024 | Self-correction capability | High |
| SAFE Search Augmentation | DeepMind | External fact verification | Medium |

### Moderate Gaps

| Gap | Research Source | Expected Impact | Implementation Effort |
|-----|----------------|-----------------|----------------------|
| DRAGIN Attention Signals | ACL 2024 | Dynamic retrieval needs | High |
| Multi-sample SelfCheckGPT | Research | AUROC >= 0.75 | Medium |
| Self-Play Bug Injection | SWE-Gym | Eval corpus growth | Medium |

### Implemented Strengths

1. **Comment-Code Consistency** - Comprehensive implementation matching C4RLLaMA goals
2. **Scientific Loop** - Full hypothesis-driven debugging pipeline
3. **Citation Validation Pipeline** - End-to-end citation checking with auto-correction
4. **Iterative Retrieval** - Multi-round retrieval with term expansion

---

## Recommendations for Reducing 12.5% Hallucination to <5%

### Priority 1: Chain-of-Verification Integration

**Rationale**: +23% F1 improvement documented in research

**Implementation Path**:
1. Add 4-step verification to response generation:
   - Draft initial response
   - Plan verification questions
   - Execute verification against retrieved context
   - Refine response based on verification
2. Integrate with existing `citation_validation_pipeline.ts`

**Expected Impact**: 3-5% hallucination reduction

### Priority 2: MiniCheck-Style NLI Integration

**Rationale**: Current entailment checking is rule-based; neural NLI provides 77.4% accuracy

**Implementation Path**:
1. Add MiniCheck-7B or equivalent small NLI model
2. Replace/augment heuristic `checkEntailment()` with neural predictions
3. Combine AST facts + NLI confidence for final verdict

**Expected Impact**: 2-4% hallucination reduction

### Priority 3: Self-RAG Reflection Tokens

**Rationale**: Current iterative retrieval lacks self-correction capability

**Implementation Path**:
1. Add reflection step after each retrieval round
2. Evaluate: "Is this context sufficient?" "Is retrieved content relevant?"
3. Trigger additional retrieval or terminate based on reflection

**Expected Impact**: 2-3% hallucination reduction

### Priority 4: Enhanced Consistency Checking

**Rationale**: SelfCheckGPT multi-sampling improves detection

**Implementation Path**:
1. Modify `consistency_checker.ts` to use actual multi-sampling (3-5 responses)
2. Add confidence scoring based on response agreement
3. Flag responses with high variance

**Expected Impact**: 1-2% hallucination reduction

---

## Implementation Roadmap

### Phase A: Quick Wins (1-2 weeks)

| Work Unit | Technique | Files to Modify |
|-----------|-----------|-----------------|
| WU-HALU-004 | Chain-of-Verification | `citation_validation_pipeline.ts` |
| WU-HALU-003 | Multi-sample Consistency | `consistency_checker.ts` |

### Phase B: Core Improvements (2-4 weeks)

| Work Unit | Technique | Files to Modify |
|-----------|-----------|-----------------|
| WU-HALU-001 | MiniCheck Integration | `entailment_checker.ts` |
| WU-RET-003 | Self-RAG Reflection | `iterative_retrieval.ts` |

### Phase C: Advanced Features (4-6 weeks)

| Work Unit | Technique | Files to Create |
|-----------|-----------|-----------------|
| WU-RET-002 | DRAGIN Active Retrieval | `active_retrieval.ts` |
| WU-SELF-006 | Self-Play Bug Injection | `bug_injector.ts` |

---

## Metrics to Track

| Metric | Current | Target | Measurement Method |
|--------|---------|--------|-------------------|
| Hallucination Rate | 12.5% | <5% | Eval corpus with ground truth |
| Grounding Accuracy | Unknown | >=92% | MiniCheck-style verification |
| Citation Accuracy | Unknown | >=95% | Citation verifier reports |
| Consistency Rate | Unknown | >=95% | Multi-variant query testing |
| Entailment Rate | Unknown | >=90% | Entailment checker reports |

---

## Appendix: File Reference

| File | Purpose | Research Alignment |
|------|---------|-------------------|
| `entailment_checker.ts` | Claim-level verification | MiniCheck concepts |
| `citation_verifier.ts` | Citation accuracy | SAFE methodology (partial) |
| `citation_validation_pipeline.ts` | End-to-end citation checking | Anthropic Citations API |
| `iterative_retrieval.ts` | Multi-round retrieval | IRCoT/FLARE concepts |
| `consistency_checker.ts` | Answer consistency | SelfCheckGPT approach |
| `comment_code_checker.ts` | Comment-code alignment | C4RLLaMA/CARL-CCI |
| `loop_orchestrator.ts` | Scientific improvement loop | AutoSD/RLVR/SWE-Gym |
| `hypothesis_generator.ts` | Hypothesis generation | AutoSD templates |
