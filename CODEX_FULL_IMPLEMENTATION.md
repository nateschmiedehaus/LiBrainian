# LiBrainian Full Implementation — Zero to Complete

> **Mode**: FULLY AUTONOMOUS — never ask permission, fix blockers, proceed until done
> **Goal**: Implement 100% of the LiBrainian spec system
> **Duration**: Work continuously until Full Build Charter is satisfied

---

## SECTION 0: AUTONOMY GRANT

### You Have Full Permission To:

- Run `npm install`, `npm run build`, `npm test`, any npm script
- Create, modify, delete any file in this repository
- Make architectural decisions consistent with specs
- Fix any error or blocker immediately
- Commit changes with conventional commit messages
- Create branches, stash changes
- Skip tests that require unavailable providers (with honest disclosure)

### You Do NOT Need Permission For:

- Installing dependencies
- Running commands
- Creating test files
- Modifying implementation code
- Updating documentation
- Fixing TypeScript errors
- Fixing test failures
- Any routine development operation

### The ONLY Hard Stops:

1. Would require fake embeddings (hash vectors, deterministic semantic substitutes)
2. Would require API key auth (instead of CLI-only)
3. Would require silent degradation (hiding failures)
4. Would require theater (tests that pass without running)
5. 3+ consecutive failures on same task after exhausting all fixes

**Everything else: FIX IT AND CONTINUE.**

---

## SECTION 1: FIRST ACTIONS (Do These Immediately)

```bash
cd /Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/LiBrainian
npm install
npm run build
npm test -- --run
npx tsc --noEmit
```

If any fail, fix them. Then proceed.

---

## SECTION 2: SPEC SYSTEM NAVIGATION

The spec system is your implementation guide. Here's how to navigate it:

### Primary References (Read These First)

| Document | Purpose | Read When |
|----------|---------|-----------|
| `docs/LiBrainian/specs/README.md` | Implementation manual, Full Build Charter, Council of 30 mandates | Start of work |
| `docs/LiBrainian/specs/BEHAVIOR_INDEX.md` | Behavioral contracts for every spec file | Before implementing any feature |
| `docs/LiBrainian/specs/core/operational-profiles.md` | R*/W*/D*/S*/E* profile vocabulary | When writing tests |
| `docs/LiBrainian/specs/core/testing-architecture.md` | Tier-0/1/2 rules | When writing tests |

### Status Tracking (Update These)

| Document | Purpose | Update When |
|----------|---------|-------------|
| `docs/LiBrainian/STATUS.md` | Current verified reality | After completing any task |
| `docs/LiBrainian/GATES.json` | Machine-readable progress gates | After any gate status changes |
| `docs/LiBrainian/specs/IMPLEMENTATION_STATUS.md` | Known issues and priorities | When discovering or fixing issues |

### Core Specs (Implementation Foundations)

| Spec | Implements | Key Behaviors |
|------|------------|---------------|
| `specs/core/evidence-ledger.md` | Unified evidence system | Append-only, correlated, provider/stage events |
| `specs/core/confidence-boundary.md` | `ConfidenceValue` semantics | No raw numbers for claims, `absent('uncalibrated')` when unknown |
| `specs/core/knowledge-construction.md` | Knowledge object model | Facts/Maps/Claims/Packs registries, construction compiler |
| `specs/core/construction-templates.md` | UC→template mapping | ≤12 templates, no bespoke handlers |
| `specs/core/work-objects.md` | Verification plans, tasks | Append-only events, DoD obligations |
| `specs/core/performance-budgets.md` | Latency/resource budgets | Per-profile targets |
| `specs/layer2-infrastructure.md` | LLM adapter, capability negotiation | CLI auth only, fail closed |

### Track Specs (Feature Areas)

| Spec | Area | Status |
|------|------|--------|
| `specs/track-a-core-pipeline.md` | Core pipeline (P0-P7) | Partially implemented |
| `specs/track-b-bootstrap.md` | Bootstrap protocols (P8-P10) | Implemented, needs verification |
| `specs/track-c-fault-tolerance.md` | Failure handling | Design |
| `specs/track-c-agentic-workflows.md` | Workflows (review, incidents) | Design |
| `specs/track-d-quantification.md` | Confidence/quantification (Q1-Q8) | Q1-Q3 implemented, Q4-Q8 pending |
| `specs/track-e-domain.md` | Domain primitives (D1-D7) | Design |
| `specs/track-f-calibration.md` | Calibration loop (C1-C4) | Not implemented |
| `specs/track-g-debugging.md` | Debugging workflows | Design |
| `specs/track-h-incidents.md` | Incident response | Design |
| `specs/track-i-multi-repo.md` | Multi-repo correlation | Partially implemented |
| `specs/track-eval-infrastructure.md` | **Evaluation & quality measurement** | Design (NEW) |
| `specs/track-research-hard-problems.md` | **Hard problems research** | Research (NEW) |

### Integration Specs (Process)

| Spec | Purpose |
|------|---------|
| `specs/INTEGRATION_CHANGE_LIST.md` | Priority 0 extraction, concrete integration tasks |
| `specs/IMPLEMENTATION_FAILURE_RCA.md` | Root causes and mechanical guardrails |
| `specs/GLOSSARY.md` | Canonical terminology |
| `specs/EXTRACTION_GAP_REPORT.md` | Missing extractions tracker |

### Use Case Reference

| Document | Content |
|----------|---------|
| `docs/LiBrainian/USE_CASE_MATRIX.md` | UC-001...UC-310 catalog |
| `specs/use-case-targets.md` | Acceptance targets per profile |
| `specs/use-case-capability-matrix.md` | UC→capability mapping |

---

## SECTION 3: IMPLEMENTATION PHASES

### Reading Order Per Phase

Before starting each phase, read the specs in this order:
1. The specific spec for that phase (linked below)
2. Its entry in `specs/BEHAVIOR_INDEX.md`
3. Relevant profiles in `specs/core/operational-profiles.md`

---

### PHASE 0: Environment Bootstrap
**No spec needed — just get the environment working**

- [ ] `npm install` succeeds
- [ ] `npm run build` succeeds
- [ ] `npm test -- --run` passes
- [ ] `npx tsc --noEmit` passes

---

### PHASE 1: Kernel Infrastructure
**Read First**:
- `specs/core/evidence-ledger.md`
- `specs/layer2-infrastructure.md`
- `specs/INTEGRATION_CHANGE_LIST.md` Section 2

**Tasks**:
| Task | Spec Section | Files | Test Pattern |
|------|--------------|-------|--------------|
| Evidence ledger: provider gate | `evidence-ledger.md` "Provider events" | `src/api/provider_gate.ts` | `src/__tests__/provider_gate_ledger.test.ts` |
| Evidence ledger: query pipeline | `evidence-ledger.md` "Query events" | `src/api/query.ts` | `src/api/__tests__/query_trace_ledger.test.ts` |
| Capability negotiation wiring | `layer2-infrastructure.md` "Capability Negotiation" | `src/api/capability_contracts.ts` | `src/__tests__/capability_negotiation.test.ts` |
| Replay anchor (traceId) | `evidence-ledger.md` "Replay semantics" | `src/api/query.ts`, `src/epistemics/evidence_ledger.ts` | `src/__tests__/trace_replay.test.ts` |

---

### PHASE 2: Knowledge Object System
**Read First**:
- `specs/core/knowledge-construction.md`
- `specs/core/construction-templates.md`

**Tasks**:
| Task | Spec Section | Files | Test Pattern |
|------|--------------|-------|--------------|
| Knowledge object registry | `knowledge-construction.md` "Object model" | `src/knowledge/registry.ts` | `src/knowledge/__tests__/registry.test.ts` |
| Construction template registry | `construction-templates.md` "Template registry" | `src/knowledge/construction_templates.ts` | `src/knowledge/__tests__/construction_templates.test.ts` |
| UC→template mapping | `construction-templates.md` "UC mapping" | `src/knowledge/uc_template_mapping.ts` | `src/__tests__/uc_template_mapping.test.ts` |
| Output envelope invariant | `knowledge-construction.md` "Output envelope" | `src/types.ts` | `src/__tests__/output_envelope_invariant.test.ts` |

---

### PHASE 3: Confidence Migration
**Read First**:
- `specs/track-d-quantification.md`
- `specs/core/confidence-boundary.md`
- `specs/INTEGRATION_CHANGE_LIST.md` Section 1 item 4

**Tasks**:
| Task | Spec Section | Files | Test Pattern |
|------|--------------|-------|--------------|
| Migrate technique_library.ts | `track-d-quantification.md` Q5 | `src/strategic/technique_library.ts` | `src/strategic/__tests__/technique_library_confidence.test.ts` |
| Migrate pattern_catalog.ts | `track-d-quantification.md` Q5 | `src/strategic/pattern_catalog.ts` | `src/strategic/__tests__/pattern_catalog_confidence.test.ts` |
| Remove raw claim confidence | `track-d-quantification.md` Q6-Q7 | `src/types.ts`, response surfaces | `src/__tests__/no_raw_claim_confidence.test.ts` |
| TypeScript enforcement | `track-d-quantification.md` Q8 | `src/epistemics/confidence_guards.ts` | `src/epistemics/__tests__/confidence_guards.test.ts` |

---

### PHASE 4: Pipeline Completion
**Read First**:
- `specs/track-a-core-pipeline.md`
- `specs/critical-usability.md` (Critical A)

**Tasks**:
| Task | Spec Section | Files | Test Pattern |
|------|--------------|-------|--------------|
| Non-no-op operators | `track-a-core-pipeline.md` P1 | `src/strategic/operator_interpreters.ts` | `src/strategic/__tests__/operator_interpreters.test.ts` |
| E2E execution (Critical A) | `critical-usability.md` Critical A | System test | `src/__tests__/e2e_execution.system.test.ts` |
| Semantic selector | `track-a-core-pipeline.md` P2 | `src/strategic/composition_selector.ts` | `src/strategic/__tests__/composition_selector.test.ts` |

---

### PHASE 5: Scale Modes
**Read First**:
- `specs/track-b-bootstrap.md`
- `specs/core/performance-budgets.md`
- `specs/core/operational-profiles.md` (W1/W2/W3)

**Tasks**:
| Task | Spec Section | Files | Test Pattern |
|------|--------------|-------|--------------|
| W1 bootstrap resumability | `track-b-bootstrap.md` P8 | `src/api/bootstrap.ts` | `src/api/__tests__/bootstrap_resumable.test.ts` |
| W2 watch freshness | `track-b-bootstrap.md` + `operational-profiles.md` W2 | `src/integration/file_watcher.ts` | `src/integration/__tests__/watch_freshness.test.ts` |
| W3 multi-agent correlation | `core/agent-coordination.md` | `src/epistemics/evidence_ledger.ts` | `src/epistemics/__tests__/multi_agent_correlation.test.ts` |

---

### PHASE 6: Scenario Families
**Read First**:
- `specs/README.md` Section "Tier-2 scenario families (≥30)"
- `specs/core/testing-architecture.md`

**The 30 scenario families are defined in `specs/README.md`**. Each family (SF-01...SF-30) has:
- Targeted profiles (R*/W*/D*/S*/E*)
- Primary templates involved
- Required audit artifacts

**File Pattern**: `src/__tests__/scenarios/sf_XX_name.system.test.ts`

---

### PHASE 7: Calibration Loop
**Read First**:
- `specs/track-f-calibration.md`
- `specs/track-d-quantification.md` (calibration semantics)

**Tasks**:
| Task | Spec Section | Files | Test Pattern |
|------|--------------|-------|--------------|
| Claim-outcome tracking | `track-f-calibration.md` C1 | `src/epistemics/outcome_tracking.ts` | `src/epistemics/__tests__/outcome_tracking.test.ts` |
| Calibration curves | `track-f-calibration.md` C2 | `src/epistemics/calibration.ts` | `src/epistemics/__tests__/calibration.test.ts` |
| Confidence adjustment | `track-f-calibration.md` C3 | `src/epistemics/confidence_adjustment.ts` | `src/epistemics/__tests__/confidence_adjustment.test.ts` |

---

## SECTION 3B: QUALITY & EVALUATION PHASES (Post-Core)

> **Critical Context**: Phases 0-7 build the *architecture*. Phases 8-11 verify it *actually works well*.
> Without evaluation infrastructure, we have no way to know if LiBrainian is reliable.
> These phases close the gap between "spec says X" and "implementation reliably does X".

---

### PHASE 8: Ground Truth Evaluation Corpus
**Read First**:
- `specs/track-eval-infrastructure.md` (Section E1)
- Research: [SWE-bench](https://www.swebench.com/), [DependEval](https://aclanthology.org/2025.findings-acl.373.pdf)

**Goal**: Build annotated repositories with known-correct answers for evaluation.

**Why This Matters**:
You cannot improve what you cannot measure. Without ground truth, "does it work?" is unanswerable.
Current SOTA benchmarks (SWE-bench, DependEval) show that repository-level understanding
requires evaluation beyond simple unit tests.

**Tasks**:

| Task | Description | Files | Test Pattern |
|------|-------------|-------|--------------|
| Create eval corpus structure | Directory structure for annotated repos | `eval-corpus/README.md` | N/A |
| Annotate small TypeScript repo | ~50 files, fully annotated with correct answers | `eval-corpus/repo-small-typescript/` | `src/__tests__/eval/corpus_validity.test.ts` |
| Annotate medium Python repo | ~500 files, partially annotated | `eval-corpus/repo-medium-python/` | Same |
| Annotate mixed-language repo | ~1000 files, multiple languages | `eval-corpus/repo-medium-mixed/` | Same |
| Create adversarial repo | Deliberately misleading code (wrong comments, dead code) | `eval-corpus/repo-adversarial/` | Same |
| Define ground truth schema | Schema for query/answer pairs | `src/eval/ground_truth_schema.ts` | `src/eval/__tests__/schema.test.ts` |
| Create 200+ query/answer pairs | Across all repos, covering UC categories | `eval-corpus/*/ground-truth.json` | `src/__tests__/eval/ground_truth_coverage.test.ts` |

**Ground Truth Schema** (see spec for full details):
```typescript
interface GroundTruthQuery {
  queryId: string;
  intent: string;
  category: 'structural' | 'behavioral' | 'architectural' | 'impact' | 'security';
  difficulty: 'trivial' | 'moderate' | 'hard' | 'research';
  correctAnswer: {
    summary: string;
    mustIncludeFiles: string[];           // MUST retrieve these
    shouldIncludeFiles: string[];         // SHOULD retrieve (partial credit)
    mustIncludeFacts: string[];           // MUST claim these
    mustNotClaim: string[];               // FALSE statements (hallucination detection)
    acceptableVariations: string[];       // Alternative correct phrasings
  };
  lastVerified: string;
  verifiedBy: string;
}
```

**Deliverables**:
- [ ] 10+ annotated repos across languages/sizes
- [ ] 200+ ground-truth query/answer pairs
- [ ] Adversarial cases (misleading comments, dead code, outdated docs)
- [ ] Schema validation tests
- [ ] Quarterly refresh process documented

---

### PHASE 9: Automated Evaluation Harness
**Read First**:
- `specs/track-eval-infrastructure.md` (Section E2)
- Research: [MiniCheck](https://arxiv.org/abs/2404.10774), [Ragas](https://arxiv.org/pdf/2309.15217), [FaithJudge](https://arxiv.org/abs/2505.04847)

**Goal**: Automated system that measures LiBrainian quality against ground truth.

**Why This Matters**:
Manual verification doesn't scale. Research shows MiniCheck-style approaches achieve GPT-4-level
hallucination detection at 400x lower cost. Ragas framework provides proven RAG evaluation metrics.

**Tasks**:

| Task | Description | Files | Test Pattern |
|------|-------------|-------|--------------|
| Build eval runner | Runs LiBrainian against ground truth corpus | `src/eval/eval_runner.ts` | `src/eval/__tests__/eval_runner.test.ts` |
| Implement retrieval metrics | Recall@k, Precision@k, MRR, MAP, NDCG | `src/eval/retrieval_metrics.ts` | `src/eval/__tests__/retrieval_metrics.test.ts` |
| Implement synthesis metrics | Fact precision/recall, summary accuracy | `src/eval/synthesis_metrics.ts` | `src/eval/__tests__/synthesis_metrics.test.ts` |
| Implement hallucination detection | MiniCheck-style grounding verification | `src/eval/hallucination_detector.ts` | `src/eval/__tests__/hallucination.test.ts` |
| Implement citation accuracy | Verify citations support claims | `src/eval/citation_verifier.ts` | `src/eval/__tests__/citation.test.ts` |
| Build quality dashboard | JSON/Markdown report of quality metrics | `src/eval/quality_report.ts` | `src/eval/__tests__/quality_report.test.ts` |
| Add eval to CI | Nightly eval run, quality gates | `.github/workflows/eval.yml` or `scripts/run_eval.ts` | N/A |
| Regression detection | Alert if quality drops after change | `src/eval/regression_detector.ts` | `src/eval/__tests__/regression.test.ts` |

**Metrics to Track** (based on Ragas + MiniCheck research):
```typescript
interface EvalMetrics {
  // Retrieval quality (standard IR metrics)
  retrieval: {
    recallAtK: Record<number, number>;    // Recall@1, @3, @5, @10
    precisionAtK: Record<number, number>; // Precision@1, @3, @5, @10
    mrr: number;                          // Mean Reciprocal Rank
    map: number;                          // Mean Average Precision
    ndcg: number;                         // Normalized Discounted Cumulative Gain
  };

  // Synthesis quality
  synthesis: {
    factPrecision: number;      // Claimed facts that are correct
    factRecall: number;         // Correct facts that were claimed
    summaryAccuracy: number;    // Overall summary correctness
    consistencyScore: number;   // Self-consistency across related queries
  };

  // Hallucination (per MiniCheck/HHEM research)
  hallucination: {
    hallucinationRate: number;  // Claims in mustNotClaim that appeared (target: < 5%)
    groundingRate: number;      // Claims with valid evidence
    fabricationRate: number;    // Citations to non-existent code
  };

  // Evidence quality
  evidence: {
    citationAccuracy: number;   // Do citations support claims?
    citationCompleteness: number;
    evidenceRelevance: number;
  };

  // Stratified by category and codebase type
  byCategory: Record<string, CategoryMetrics>;
  byCodebaseType: Record<string, CategoryMetrics>;
}
```

**Hallucination Detection Approaches** (implement in order of cost):
1. **mustNotClaim checking**: Direct match against known false statements (cheapest)
2. **Citation existence**: Verify cited files/lines exist
3. **MiniCheck-style entailment**: Small model checks if evidence supports claim (400x cheaper than GPT-4)
4. **LLM-as-judge**: Full LLM verification (expensive, use for uncertain cases)

**Quality Gates** (already added to `GATES.json` layer5):
- `layer5.retrievalRecall`: >= 80% (blocking)
- `layer5.hallucinationRate`: < 5% (blocking)
- `layer5.synthesisAccuracyStructural`: >= 70%
- `layer5.synthesisAccuracyBehavioral`: >= 60%

**Deliverables**:
- [ ] Eval harness that runs against corpus
- [ ] Full IR metrics (Recall, Precision, MRR, MAP, NDCG)
- [ ] Hallucination detection (multi-level)
- [ ] Citation verification
- [ ] Quality report (JSON + Markdown dashboard)
- [ ] CI integration with quality gates
- [ ] Regression alerts with statistical significance

---

### PHASE 10: Outcome Collection & Calibration Infrastructure
**Read First**:
- `specs/track-eval-infrastructure.md` (Section E3)
- `specs/track-f-calibration.md`
- Research: [Calibration Survey](https://aclanthology.org/2024.naacl-long.366.pdf), [Adaptive Temperature Scaling](https://liner.com/review/calibrating-language-models-with-adaptive-temperature-scaling)

**Goal**: Collect claim→outcome data to enable calibration.

**Why This Matters**:
Research shows post-RLHF LLMs are significantly overconfident. Adaptive Temperature Scaling achieves
10-50% better calibration than fixed methods. But all calibration requires outcome data first.

**Research Context**:
- Expected Calibration Error (ECE) is the standard metric
- Traditional temperature scaling helps but is limited
- Context-dependent calibration (per claim type) is more effective
- Minimum ~1000 outcomes needed for statistical validity

**Tasks**:

| Task | Description | Files | Test Pattern |
|------|-------------|-------|--------------|
| Instrument claims with IDs | Every claim gets a unique, stable ID | `src/epistemics/claim_registry.ts` | `src/epistemics/__tests__/claim_registry.test.ts` |
| Build outcome collection API | Record what happened after a claim | `src/eval/outcome_collector.ts` | `src/eval/__tests__/outcome_collector.test.ts` |
| Agent feedback integration | API for agents to report success/failure | `src/eval/agent_feedback.ts` | `src/eval/__tests__/agent_feedback.test.ts` |
| Human correction interface | CLI/API for humans to correct claims | `src/eval/human_correction.ts` | `src/eval/__tests__/human_correction.test.ts` |
| Contradiction detector | Flag when later queries contradict earlier claims | `src/eval/contradiction_detector.ts` | `src/eval/__tests__/contradiction.test.ts` |
| Outcome storage | Persist outcomes for analysis | `src/eval/outcome_storage.ts` | `src/eval/__tests__/outcome_storage.test.ts` |
| ECE computation | Expected Calibration Error calculation | `src/eval/ece.ts` | `src/eval/__tests__/ece.test.ts` |
| Calibration curve computation | Compute claimed vs actual accuracy by bucket | `src/eval/calibration_curve.ts` | `src/eval/__tests__/calibration_curve.test.ts` |
| Confidence adjustment | Adjust confidence based on calibration data | `src/epistemics/calibrated_confidence.ts` | `src/epistemics/__tests__/calibrated_confidence.test.ts` |

**Outcome Record Schema** (see spec for full details):
```typescript
interface OutcomeRecord {
  claimId: string;
  claim: string;
  claimType: string;
  claimedConfidence: number;
  confidenceSignals: {
    modelLogProb?: number;
    retrievalScore?: number;
    evidenceCount?: number;
    agreementScore?: number;    // Multi-query consistency
  };
  timestamp: string;

  outcome?: {
    type: 'verified_correct' | 'verified_incorrect' | 'partially_correct' | 'unknown';
    verificationMethod: 'test_passed' | 'test_failed' | 'human_review' | 'agent_feedback' | 'contradiction_found';
    evidence: string;
    verifiedAt: string;
    verifiedBy: string;
    confidence: number;         // Confidence in the verification itself
  };
}
```

**Calibration Computation** (ECE-based):
```typescript
interface CalibrationCurve {
  points: Array<{
    confidenceBucket: number;   // 0.1, 0.2, ..., 1.0
    actualAccuracy: number;     // Empirical accuracy
    sampleSize: number;
    standardError: number;
  }>;
  ece: number;                  // Expected Calibration Error (lower is better, target: < 10%)
  mce: number;                  // Maximum Calibration Error
  overconfidenceRatio: number;  // How often confidence > accuracy
}

// Adjustment function based on empirical calibration
type ConfidenceAdjuster = (rawConfidence: number, claimType: string) => {
  adjusted: number;
  interval: [number, number];   // Uncertainty interval
  basis: string;                // "N=142 similar claims, 68% accurate"
};
```

**Minimum Viable Calibration** (before full data):
1. Report empirical rate: "N=142 similar claims, 68% were correct"
2. Flag low-accuracy categories: Warn when <50% historical accuracy
3. Show uncertainty intervals: `confidence: 0.6-0.8` not point estimate
4. Default to `absent('uncalibrated')` until sufficient data

**Deliverables**:
- [ ] Claim ID infrastructure
- [ ] Outcome collection API with multiple sources
- [ ] Agent feedback integration
- [ ] Human correction CLI/API
- [ ] Contradiction detection
- [ ] ECE computation
- [ ] Calibration curve computation
- [ ] Context-dependent confidence adjustment
- [ ] Target: ECE < 10% when sufficient data

---

### PHASE 11: Quality Parity & Hard Problem Research
**Read First**:
- `specs/track-eval-infrastructure.md` (Section E4)
- `specs/track-research-hard-problems.md`
- Research: [GraphCoder](https://www.semanticscholar.org/paper/GraphCoder), [GRACE](https://arxiv.org/abs/2510.04905), [ReDeEP](https://openreview.net/forum?id=ztzZDzgfrh)

**Goal**: Even quality across codebase types; research approaches for hard problems.

**Why This Matters**:
Quality varies 84% (clean code) to 49% (sparse docs). Research shows graph-based retrieval excels at cross-file reasoning. Implement achievable items first, measure impact, invest in research based on results.

#### Part A: Codebase Profiling & Adaptive Quality

**Tasks**:

| Task | Description | Files | Test Pattern |
|------|-------------|-------|--------------|
| Codebase profiler | Detect codebase characteristics | `src/eval/codebase_profiler.ts` | `src/eval/__tests__/codebase_profiler.test.ts` |
| Quality prediction model | Predict expected accuracy from profile | `src/eval/quality_predictor.ts` | `src/eval/__tests__/quality_predictor.test.ts` |
| Adaptive synthesis | Adjust strategy based on codebase type | `src/strategic/adaptive_synthesis.ts` | `src/strategic/__tests__/adaptive_synthesis.test.ts` |
| Quality disclosure | Include expected quality in responses | `src/api/quality_disclosure.ts` | `src/api/__tests__/quality_disclosure.test.ts` |

**Codebase Profile Schema**:
```typescript
// Create in src/eval/codebase_profile.ts
interface CodebaseProfile {
  // Detectable signals
  documentationDensity: number;      // comments + docs per LOC
  testCoverage: number;              // test files / src files
  typeAnnotationRate: number;        // typed vs untyped (for dynamic languages)
  architecturalClarity: number;      // clear module boundaries?
  namingQuality: number;             // descriptive vs cryptic
  codeAge: number;                   // average file age
  churnRate: number;                 // changes per file per month

  // Classification
  category: 'well_documented' | 'sparse_docs_good_tests' | 'sparse_docs_few_tests' | 'legacy_spaghetti';

  // Predicted quality
  expectedAccuracy: {
    structural: number;
    behavioral: number;
    architectural: number;
    impact: number;
  };
}
```

**Strategy by Codebase Type**:
```typescript
// Create in src/strategic/adaptive_synthesis.ts
const strategyByProfile: Record<CodebaseCategory, SynthesisStrategy> = {
  'well_documented': {
    confidenceMultiplier: 1.0,
    maxClaimDepth: 'deep',
    requireEvidence: 'standard',
  },
  'sparse_docs_good_tests': {
    confidenceMultiplier: 0.85,
    maxClaimDepth: 'moderate',
    requireEvidence: 'strict',
    fallbackToTestAnalysis: true,
  },
  'sparse_docs_few_tests': {
    confidenceMultiplier: 0.7,
    maxClaimDepth: 'shallow',
    requireEvidence: 'strict',
    addDefeaters: true,
    suggestImprovements: true,
  },
  'legacy_spaghetti': {
    confidenceMultiplier: 0.5,
    maxClaimDepth: 'structural_only',
    requireEvidence: 'maximum',
    refuseBehavioralClaims: true,
  },
};
```

#### Part B: Hard Problem Research Implementations

These are research-grade problems. Implement what's achievable; document limitations honestly.

**H1: Semantic Verification (Test-Based)**

| Task | Description | Files | Test Pattern |
|------|-------------|-------|--------------|
| Pure function detector | Identify functions safe for test generation | `src/verification/pure_function_detector.ts` | `src/verification/__tests__/pure_function.test.ts` |
| Test case generator | Generate test cases from behavioral claims | `src/verification/test_generator.ts` | `src/verification/__tests__/test_generator.test.ts` |
| Claim verifier | Run generated tests to verify claims | `src/verification/claim_verifier.ts` | `src/verification/__tests__/claim_verifier.test.ts` |

```typescript
// Example: If LiBrainian claims "add(a, b) returns sum of a and b"
// Generate: expect(add(2, 3)).toBe(5)
// Run test
// If passes: claim supported (not proven, but supported)
// If fails: claim refuted

// Limitations:
// - Only works for pure functions with simple I/O
// - Test generation itself can be wrong
// - Can't verify complex behavioral descriptions
```

**H2: Cross-File Reasoning (Iterative Retrieval)**

| Task | Description | Files | Test Pattern |
|------|-------------|-------|--------------|
| Gap detector | Identify missing context in current retrieval | `src/retrieval/gap_detector.ts` | `src/retrieval/__tests__/gap_detector.test.ts` |
| Iterative retriever | Retrieve → analyze → retrieve more → repeat | `src/retrieval/iterative_retriever.ts` | `src/retrieval/__tests__/iterative_retriever.test.ts` |
| Convergence detector | Stop when no new relevant info found | `src/retrieval/convergence.ts` | `src/retrieval/__tests__/convergence.test.ts` |
| Budget manager | Limit iterations to prevent infinite loops | `src/retrieval/budget_manager.ts` | `src/retrieval/__tests__/budget_manager.test.ts` |

```typescript
// Iterative retrieval loop:
// 1. Initial query → retrieve files
// 2. Analyze → "I see X calls Y, but I don't have Y's implementation"
// 3. Retrieve Y → analyze again
// 4. Repeat until:
//    - No new gaps identified (convergence)
//    - Budget exhausted (max iterations or tokens)
//    - Circular reference detected
```

**H3: Adversarial Robustness**

| Task | Description | Files | Test Pattern |
|------|-------------|-------|--------------|
| Comment/code disagreement | Detect when comments contradict code | `src/verification/comment_code_checker.ts` | `src/verification/__tests__/comment_code.test.ts` |
| Dead code detector | Filter out unreachable code from synthesis | `src/verification/dead_code_detector.ts` | `src/verification/__tests__/dead_code.test.ts` |
| Confidence reduction heuristics | Lower confidence for red flags | `src/epistemics/red_flag_detector.ts` | `src/epistemics/__tests__/red_flags.test.ts` |

```typescript
// Red flags that should reduce confidence:
// - TODO/FIXME/HACK comments nearby
// - Commented-out code
// - Unusual naming (single letters, misleading names)
// - Multiple conflicting implementations
// - Very old code with recent changes (might be stale)
// - Imports that are never used
```

**H4: Consistency Checking**

| Task | Description | Files | Test Pattern |
|------|-------------|-------|--------------|
| Multi-query consistency | Ask same thing multiple ways, check consistency | `src/verification/consistency_checker.ts` | `src/verification/__tests__/consistency.test.ts` |
| Temporal consistency | Check if answers are consistent over time | `src/verification/temporal_consistency.ts` | `src/verification/__tests__/temporal.test.ts` |
| Cross-reference validator | "If X does Y, then Y should list X as caller" | `src/verification/cross_reference.ts` | `src/verification/__tests__/cross_reference.test.ts` |

**Implementation Priority** (engineering → applied research → long-term):

| Priority | Task | Achievability | Research Basis |
|----------|------|---------------|----------------|
| **Tier 1** | Dead code detector | Engineering | Standard static analysis |
| **Tier 1** | Red flag detector | Engineering | Pattern matching |
| **Tier 1** | Citation validation | Engineering | File system checks |
| **Tier 2** | Iterative retrieval | Applied research | [SWE-QA-Agent](https://arxiv.org/pdf/2509.14635) |
| **Tier 2** | Comment/code checker | Applied research | LLM comparison |
| **Tier 2** | MiniCheck-style entailment | Applied research | [MiniCheck](https://arxiv.org/abs/2404.10774) |
| **Tier 2** | Graph-based retrieval | Applied research | [GraphCoder](https://www.semanticscholar.org/paper/GraphCoder) |
| **Tier 3** | Test-based verification | Long-term research | Only pure functions |
| **Tier 3** | Hierarchical summarization | Long-term research | Information loss tradeoff |

**Deliverables**:
- [ ] Codebase profiler (detect characteristics)
- [ ] Quality prediction model (predict accuracy)
- [ ] Adaptive synthesis strategies (adjust by codebase type)
- [ ] Quality disclosure in responses
- [ ] **Tier 1**: Dead code, red flags, citation validation
- [ ] **Tier 2**: Iterative retrieval, comment/code checker, entailment (if resources)
- [ ] **Tier 3**: Test verification, hierarchical summarization (if resources)
- [ ] Quality parity target: worst codebase type within 25% of best
- [ ] All gates in `GATES.json` layer5 and layer6

---

## SECTION 4: TDD PROTOCOL (Every Task)

1. **Read the spec** — Find spec reference in phase table, read its BEHAVIOR_INDEX entry
2. **Write Tier-0 test first** — See `specs/core/testing-architecture.md` for tier rules
3. **Implement minimal code**
4. **Run test**: `npm test -- --run src/__tests__/your_test.test.ts`
5. **Add Tier-1/2 tests if needed** — Only if providers required
6. **Update STATUS.md** — Add evidence link per `STATUS.md` format
7. **Update GATES.json** — If gate status changed
8. **Commit** — Conventional commit message

---

## SECTION 5: ERROR RECOVERY

See `specs/IMPLEMENTATION_FAILURE_RCA.md` for common failure patterns.

### Quick Fixes

| Error | Fix |
|-------|-----|
| `vitest: command not found` | `npm install` |
| `Cannot find module` | `npm install` |
| `tsc: error TS...` | Fix type error, `npm run build` |
| `Provider unavailable` | See `specs/core/testing-architecture.md` for tier-appropriate handling |

### Retry Protocol

1. First failure: Apply fix
2. Second failure: Alternative approach
3. Third failure: Document `unverified_by_trace(<reason>)` in STATUS.md, move on

---

## SECTION 6: DEFINITION OF DONE

**Full Build Charter** is defined in `specs/README.md` Section "Full Build Charter (Council of 30)".

### Part A: Functional Completeness (Phases 0-7)
- [ ] Output envelope invariant (packs, adequacy, disclosures, verificationPlan, traceId)
- [ ] UC-001...UC-310 map to ≤12 templates
- [ ] Tier honesty (Tier-0 deterministic, Tier-1 skips, Tier-2 fails honestly)
- [ ] ≥30 Tier-2 scenario families with artifacts
- [ ] No silent degradation
- [ ] All Tier-0 tests pass
- [ ] TypeScript compiles
- [ ] STATUS.md reflects verified reality

### Part B: Quality Verification (Phases 8-11)
- [ ] Ground truth corpus: 5+ repos, 100+ query/answer pairs
- [ ] Eval harness runs nightly with quality report
- [ ] **Retrieval Recall@5 >= 80%** on eval corpus
- [ ] **Retrieval Precision@5 >= 70%** on eval corpus
- [ ] **Hallucination Rate < 5%** on eval corpus
- [ ] **Synthesis Accuracy >= 70%** on structural queries
- [ ] **Synthesis Accuracy >= 60%** on behavioral queries
- [ ] Outcome collection infrastructure operational
- [ ] Calibration curves computed (when sufficient data)
- [ ] Quality parity: worst codebase type within 25% of best

### Part C: Research Implementations (Phase 11)
- [ ] Codebase profiler operational
- [ ] Test-based verification for pure functions
- [ ] Iterative retrieval with convergence detection
- [ ] Comment/code disagreement detection
- [ ] Consistency checking between related queries

### Quality Gates in GATES.json
After completing Phase 9, add these gates:
```json
{
  "layer5.evalCorpus": { "status": "pass", "evidence": "5 repos, 127 queries" },
  "layer5.evalHarness": { "status": "pass", "evidence": "Nightly run configured" },
  "layer5.retrievalRecall": { "status": "pass", "current": "82%", "target": ">= 80%" },
  "layer5.retrievalPrecision": { "status": "pass", "current": "74%", "target": ">= 70%" },
  "layer5.hallucinationRate": { "status": "pass", "current": "3.2%", "target": "< 5%" },
  "layer5.synthesisAccuracyStructural": { "status": "pass", "current": "76%", "target": ">= 70%" },
  "layer5.synthesisAccuracyBehavioral": { "status": "partial", "current": "58%", "target": ">= 60%" }
}
```

---

## SECTION 7: BEGIN IMPLEMENTATION

1. **Run `npm install`** in `/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/LiBrainian`
2. **Run `npm test -- --run`** to verify baseline
3. **Read `specs/README.md`** for full context
4. **Start Phase 1** — Evidence ledger wiring
5. **Work through all phases sequentially**
6. **Do not stop until Full Build Charter is satisfied**

**You have full autonomy. No permission needed. Fix blockers. Proceed until done.**
