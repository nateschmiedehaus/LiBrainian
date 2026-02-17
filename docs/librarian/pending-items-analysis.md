# Pending Items Analysis Report

**Generated**: 2026-01-29
**Repository**: LiBrainian
**Scope**: TODOs, FIXMEs, unchecked roadmap items, and unimplemented features

---

## Executive Summary

This document catalogs all pending items in the LiBrainian repository, analyzing their relevance against recently implemented features including:

- **Conative attitudes** (intentions, preferences, goals)
- **Temporal grounding** (decay, validity)
- **Intuitive grounding** (pattern recognition)
- **Inference auditing** (fallacy detection)
- **Quality gates** (course correction)
- **Universal coherence framework**
- **Resource monitoring and adaptive pools**

**Summary Statistics**:
| Category | Count | High Priority | Superseded |
|----------|-------|---------------|------------|
| Code TODOs | 12 | 5 | 2 |
| README Roadmap | 4 | 2 | 0 |
| GATES.json Not Implemented | 4 | 1 | 0 |
| Spec Not Implemented | 18 | 8 | 3 |
| Research Gaps | 5 | 3 | 1 |

---

## 1. Code TODOs and FIXMEs

### 1.1 Active TODOs in Source Code

#### TODO-001: Track actual cache hits in review context
- **Location**: `src/integration/review_context_provider.ts:235`
- **Description**: `fromCache: enableCache, // TODO: track actual cache hits`
- **Priority**: Low
- **Still Relevant**: Yes
- **Superseded By**: N/A
- **Notes**: Minor instrumentation improvement for observability

#### TODO-002: Track actual user/agent in strategic storage
- **Location**: `src/strategic/storage.ts.wip:1877` (WIP file)
- **Description**: `'system', // TODO: Track actual user/agent`
- **Priority**: Medium
- **Still Relevant**: Maybe
- **Superseded By**: May be addressed by conative attitudes (agent identity tracking)
- **Notes**: WIP file - may not be in active development

#### TODO-003: Increase retrieval thresholds when full codebase indexed
- **Location**: `src/__tests__/retrieval_benchmark.system.test.ts:472,515,550,564,578`
- **Description**: Multiple TODOs to increase SLO thresholds (70%, 60%, 50%, 40%, 0.6)
- **Priority**: Medium
- **Still Relevant**: Yes
- **Superseded By**: N/A
- **Notes**: Active retrieval tuning work - thresholds deliberately relaxed for initial validation

#### TODO-004: Run actual knowledge generation in governor tests
- **Location**: `src/__tests__/governor_wiring.test.ts:164,184`
- **Description**: Commented-out live provider tests for governor integration
- **Priority**: Medium
- **Still Relevant**: Yes
- **Superseded By**: Resource monitoring may address this via adaptive pools
- **Notes**: Requires live providers - marked as LIVE tests

#### TODO-005: Adversarial pattern stub
- **Location**: `src/evaluation/adversarial_patterns.ts:567`
- **Description**: `// TODO: implement` for adversarial pattern detection
- **Priority**: High
- **Still Relevant**: Yes
- **Superseded By**: Quality gates provide related course correction
- **Notes**: Core adversarial detection incomplete

### 1.2 Contextual TODOs (Detection/Parsing Code)

These are TODOs that exist as part of the codebase's TODO/FIXME detection logic itself:

| File | Purpose | Action Needed |
|------|---------|--------------|
| `src/quality/issue_registry.ts:32` | Issue type definition | None - type definition |
| `src/knowledge/extractors/quality_extractor.ts` | Counts TODOs in analyzed code | None - detection code |
| `src/knowledge/extractors/history_extractor.ts` | Extracts planned changes from TODOs | None - extraction code |
| `src/knowledge/extractors/flash_assessments.ts` | Flags files with many TODOs | None - assessment code |
| `src/evaluation/red_flag_detector.ts` | Detects old dated TODOs | None - detection code |
| `src/evaluation/comment_code_checker.ts` | Detects stale TODOs | None - checker code |

---

## 2. README.md Roadmap Items

**Location**: `/README.md:438-449`

| Item | Status | Priority | Still Relevant | Notes |
|------|--------|----------|----------------|-------|
| VS Code extension | Unchecked | Medium | Yes | IDE integration |
| Multi-language support (Python, Go, Rust) | Unchecked | High | Yes | Core expansion |
| Federated mode (multi-repo) | Unchecked | Medium | Yes | Federation implemented in code but not fully wired |
| Cloud-hosted option | Unchecked | Low | Yes | Future product direction |

---

## 3. GATES.json Not Implemented Items

**Location**: `/docs/LiBrainian/GATES.json`

### Layer 3 (Not Implemented)

| Gate ID | Name | Priority | Still Relevant | Superseded By |
|---------|------|----------|----------------|---------------|
| layer3.Q4 | Migration Script | Medium | Maybe | Manual migration may suffice |
| layer3.C4 | Calibration Dashboard | Low | Yes | UI feature |

### Layer 5 (Not Started)

| Gate ID | Name | Priority | Still Relevant | Notes |
|---------|------|----------|----------------|-------|
| layer5.astFactExtractor | AST Fact Extractor | High | Yes | Critical for machine-verifiable eval |
| layer5.citationVerifier | Citation Verifier | High | Yes | Citation validation pipeline exists but needs enhancement |
| layer5.consistencyChecker | Multi-Query Consistency Checker | Medium | Yes | consistency_checker.ts exists but needs multi-sample |
| layer5.agentHarness | Agent Performance Test Harness | Medium | Yes | Worker A/B testing infrastructure |
| layer5.taskBank | Task Bank (80 tasks) | Medium | Yes | Eval corpus expansion |
| layer5.contextLevels | Context Level System | Low | Yes | 6-level context grading |
| layer5.outcomeCollection | Outcome Collection Infrastructure | Medium | Yes | Calibration data collection |

### Layer 6 (Not Started - Research Features)

| Gate ID | Name | Priority | Still Relevant | Notes |
|---------|------|----------|----------------|-------|
| layer6.deadCodeDetection | Dead Code Detection | Medium | Yes | Filter dead code from retrieval |
| layer6.redFlagDetection | Red Flag Detection | Medium | Yes | Confidence adjustment - partially exists |
| layer6.citationValidation | Citation Validation | High | Yes | citation_validation_pipeline.ts exists |
| layer6.iterativeRetrieval | Iterative Retrieval with Convergence | Medium | Yes | iterative_retrieval.ts exists |
| layer6.commentCodeChecker | Comment/Code Disagreement Detection | Medium | Yes | Implemented in comment_code_checker.ts |
| layer6.entailmentChecker | Entailment-Based Grounding | High | Yes | entailment_checker.ts partial |
| layer6.graphRetrieval | Graph-Based Code Retrieval | Medium | Yes | Graph retrieval implemented |

---

## 4. Spec "Not Implemented" Items

### 4.1 Track D Quantification

| Feature | Status | Priority | Notes |
|---------|--------|----------|-------|
| Q4: Migration Script | Not Implemented | Medium | Auto-migration of legacy confidence values |
| Q5-Q7: Code Migrations | Partial | High | Some code still uses raw numbers |

### 4.2 Track F Calibration

| Feature | Status | Priority | Notes |
|---------|--------|----------|-------|
| Principled prior | Not Implemented | Medium | Gap in bootstrap mode |
| Bootstrap mode | Specified but not implemented | Medium | Cold-start confidence |

### 4.3 Track C Extended (P14-P18)

| Feature | Status | Priority | Still Relevant |
|---------|--------|----------|----------------|
| P14: Self-Aware Oracle | Spec only | Low | Maybe - metacognition |
| P15: Proof-Carrying Context | Spec only | Medium | Yes - formal verification |
| P16: Causal Discovery | Spec only | High | Yes - cause-effect analysis |
| P17: Bi-Temporal Knowledge | Spec only | Medium | Partially addressed by temporal grounding |
| P18: Metacognitive Architecture | Spec only | Medium | Partially addressed by inference auditing |

### 4.4 Use-Case Capability Matrix Gaps

**Location**: `/docs/LiBrainian/specs/use-case-capability-matrix.md`

Major unimplemented capabilities across domains:

| Category | Missing Items | Priority |
|----------|--------------|----------|
| Data flow analysis | tp_data_lineage, tp_state_trace | High |
| API primitives | Full API surface extraction | High |
| Test planning | EnrichedWorkNode, RankedHypothesis | Medium |
| Documentation | DocStructure, DocCoverageReport | Low |
| Performance | Hotspot[], Optimization[], ImpactEstimate | Medium |
| Security | ThreatModel, RiskScore, Remediation[] | High |
| Learning paths | LearningPath, Explanation, TimeEstimate | Low |

---

## 5. Research Implementation Gaps

**Location**: `/docs/LiBrainian/RESEARCH_IMPLEMENTATION_MAPPING.md`

### High Priority Gaps

| Gap | Research Source | Expected Impact | Status |
|-----|----------------|-----------------|--------|
| Chain-of-Verification | ACL 2024 | +23% F1 | Not Implemented |
| MiniCheck Model Integration | EMNLP 2024 | 77.4% accuracy | Partial (rule-based) |
| Self-RAG Reflection Tokens | ICLR 2024 | Self-correction | Not Implemented |
| SAFE Search Augmentation | DeepMind | External fact verification | Not Implemented |
| DRAGIN Attention Signals | ACL 2024 | Dynamic retrieval | Not Implemented |

### Partially Implemented

| Feature | Current State | Gap |
|---------|---------------|-----|
| MiniCheck | Pattern-based claim extraction | No neural NLI |
| IRCoT | Multi-round retrieval | No reflection tokens |
| SelfCheckGPT | Variant comparison | Not multi-sample |

---

## 6. Superseded/Resolved Items

Items that may be addressed by recent implementations:

### 6.1 Addressed by Conative Attitudes
- Agent identity tracking (TODO-002)
- Intention-based reasoning requirements

### 6.2 Addressed by Temporal Grounding
- Bi-temporal knowledge (P17) - partially superseded
- Confidence decay mechanisms

### 6.3 Addressed by Inference Auditing
- Metacognitive architecture (P18) - partially superseded
- Fallacy detection requirements

### 6.4 Addressed by Quality Gates
- Course correction mechanisms
- Adversarial pattern detection (complements TODO-005)

---

## 7. Priority Recommendations

### Immediate Priority (P0)

1. **Increase retrieval thresholds** (TODO-003) - Validate metrics meet production SLOs
2. **Complete adversarial pattern detection** (TODO-005) - Security critical
3. **Implement Chain-of-Verification** - +23% F1 improvement

### High Priority (P1)

1. **Multi-language support** - Expand beyond TypeScript
2. **Neural entailment integration** - Replace heuristic checking
3. **Data flow analysis primitives** - tp_data_lineage, tp_state_trace

### Medium Priority (P2)

1. **Calibration dashboard** (layer3.C4)
2. **Self-RAG reflection tokens**
3. **Multi-sample consistency checking**

### Low Priority (P3)

1. **VS Code extension**
2. **Cloud-hosted option**
3. **Learning path generation**

---

## 8. Validation Checklist

After addressing pending items:

- [ ] All retrieval SLO thresholds at target levels
- [ ] No critical TODOs remain in production code
- [ ] All GATES.json layer 3 items implemented
- [ ] Research gaps under 3 critical items
- [ ] All README roadmap items either completed or documented as planned

---

## Appendix A: Full TODO List by File

```
src/integration/review_context_provider.ts:235 - track actual cache hits
src/strategic/storage.ts.wip:1877 - track actual user/agent
src/__tests__/retrieval_benchmark.system.test.ts:472 - increase to 70%
src/__tests__/retrieval_benchmark.system.test.ts:515 - increase to 60%
src/__tests__/retrieval_benchmark.system.test.ts:550 - increase to 50%
src/__tests__/retrieval_benchmark.system.test.ts:564 - increase to 40%
src/__tests__/retrieval_benchmark.system.test.ts:578 - increase to 0.6
src/__tests__/governor_wiring.test.ts:164 - run actual knowledge generation
src/__tests__/governor_wiring.test.ts:184 - should throw or return partial
src/evaluation/adversarial_patterns.ts:567 - implement
```

---

## Appendix B: Reference Documents

- `/docs/LiBrainian/GATES.json` - Gate status tracking
- `/docs/LiBrainian/STATUS.md` - Implementation status
- `/docs/LiBrainian/specs/IMPLEMENTATION_STATUS.md` - Detailed implementation tracking
- `/docs/LiBrainian/RESEARCH_IMPLEMENTATION_MAPPING.md` - Research gap analysis
- `/docs/LiBrainian/specs/use-case-capability-matrix.md` - Capability gaps
- `/README.md` - Public roadmap

---

*This document should be updated when significant items are completed or new TODOs are identified.*
