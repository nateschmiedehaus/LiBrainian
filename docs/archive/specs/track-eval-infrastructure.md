# Evaluation Infrastructure Track

> **Version**: 1.0.0
> **Status**: Design
> **Created**: 2026-01-25
> **Research Sources**: See inline citations

## Purpose

Close the gap between "spec says X" and "implementation reliably does X" by building infrastructure to **measure, verify, and improve quality** against ground truth.

Without evaluation infrastructure, quality claims are unverifiable theater.

---

## Research Context

### Why Traditional Metrics Fail for Code Understanding

Traditional evaluation metrics like BLEU or ROUGE rely heavily on exact word matches and may penalize generated summaries for not being identical to the ground truth, even when they describe the same functionality. Recent research demonstrates that word-overlap metrics, and even embedding-based metrics like BERTScore, capture only one dimension of code summarization quality.

**Source**: [Source Code Summarization in the Era of Large Language Models](https://arxiv.org/pdf/2407.07959)

### State-of-the-Art Code Evaluation

Current gold standard benchmarks:

| Benchmark | Focus | Why It Matters |
|-----------|-------|----------------|
| **SWE-bench Verified** | Real GitHub bug fixing | Tests practical engineering, not toy problems |
| **LiveCodeBench** | Contamination-resistant | Addresses data leakage through continuous updates |
| **CodeXGLUE** | Multi-task suite | Covers search, completion, summarization, translation |
| **DependEval** | Cross-file understanding | Tests repository-level dependency reasoning |
| **SWE-QA** | Repository-level Q&A | Real-world software understanding |

**Source**: [The Ultimate 2025 Guide to Coding LLM Benchmarks](https://www.marktechpost.com/2025/07/31/the-ultimate-2025-guide-to-coding-llm-benchmarks-and-performance-metrics/)

### Hallucination Detection State of Art

Reference-free hallucination detection methods benchmarked in 2025:
- **LLM-as-a-Judge**: General but expensive
- **HHEM (Hughes Hallucination Evaluation Model)**: Cost-effective
- **MiniCheck**: GPT-4-level performance at 400x lower cost
- **FaithJudge**: Uses diverse human-annotated examples

**Source**: [Real-Time Evaluation Models for RAG: Who Detects Hallucinations Best?](https://arxiv.org/abs/2503.21157)

---

## E1: Ground Truth Corpus

### Problem

We cannot evaluate quality without knowing correct answers. "Does it work?" is unanswerable without ground truth.

### Specification

Build a curated set of repositories with known-correct annotations.

#### Corpus Structure

```
/eval-corpus/
├── README.md                           # Corpus documentation
├── schema/
│   └── ground_truth.schema.json        # JSON Schema for annotations
├── repos/
│   ├── small-typescript/               # ~50 files, fully annotated
│   │   ├── src/                        # Actual source code
│   │   └── .LiBrainian-eval/
│   │       ├── manifest.json           # Repo metadata
│   │       ├── ground-truth.json       # Query/answer pairs
│   │       └── annotations/
│   │           ├── architecture.md     # Human-verified architecture
│   │           ├── auth-flow.md        # Human-verified auth flow
│   │           └── impact-matrix.json  # Known file→file impacts
│   ├── medium-python/                  # ~500 files, partially annotated
│   ├── medium-mixed/                   # ~1000 files, multiple languages
│   ├── large-monorepo/                 # ~5000 files, sparse annotations
│   └── adversarial/                    # Deliberately misleading code
└── queries/
    ├── structural.json                 # Dependency, symbol queries
    ├── behavioral.json                 # Function explanation queries
    ├── architectural.json              # Component, boundary queries
    ├── impact.json                     # Change analysis queries
    └── security.json                   # Threat model queries
```

#### Ground Truth Schema

```typescript
interface GroundTruthCorpus {
  version: string;
  repos: RepoManifest[];
  queries: GroundTruthQuery[];
}

interface RepoManifest {
  repoId: string;
  name: string;
  languages: string[];
  fileCount: number;
  annotationLevel: 'full' | 'partial' | 'sparse';
  characteristics: {
    documentationDensity: 'high' | 'medium' | 'low';
    testCoverage: 'high' | 'medium' | 'low';
    architecturalClarity: 'clear' | 'moderate' | 'complex';
    codeQuality: 'clean' | 'average' | 'legacy';
  };
}

interface GroundTruthQuery {
  queryId: string;
  repoId: string;
  intent: string;
  category: 'structural' | 'behavioral' | 'architectural' | 'impact' | 'security';
  difficulty: 'trivial' | 'moderate' | 'hard' | 'research';

  // Correct answer specification
  correctAnswer: {
    summary: string;
    mustIncludeFiles: string[];           // Files that MUST be retrieved
    shouldIncludeFiles: string[];         // Files that SHOULD be retrieved (partial credit)
    mustIncludeFacts: string[];           // Facts that MUST appear in synthesis
    mustNotClaim: string[];               // FALSE statements - if claimed, it's hallucination
    acceptableVariations: string[];       // Alternative phrasings that are also correct
  };

  // Metadata
  lastVerified: string;                   // ISO date
  verifiedBy: string;                     // Human verifier ID
  verificationNotes?: string;
}
```

#### Adversarial Cases

The adversarial repo must include:

| Case | Description | Purpose |
|------|-------------|---------|
| Wrong comments | Comments that contradict code behavior | Test comment/code disagreement detection |
| Dead code | Unreachable functions that look active | Test dead code filtering |
| Misleading names | `saveUser()` that actually deletes | Test semantic vs. lexical understanding |
| Outdated docs | README describes old architecture | Test doc/code consistency |
| Hidden dependencies | Imports via dynamic requires | Test dependency detection completeness |
| Copy-paste variations | Similar code with subtle differences | Test precision in retrieval |

#### Corpus Size Targets

| Metric | Target | Rationale |
|--------|--------|-----------|
| Total repos | ≥ 10 | Cover language/size diversity |
| Query/answer pairs | ≥ 200 | Statistical significance per category |
| Adversarial cases | ≥ 50 | Stress-test hallucination detection |
| Languages covered | ≥ 5 | TypeScript, Python, Go, Java, Rust minimum |
| Codebase types | 4 | Well-documented, sparse-docs, legacy, adversarial |

---

## E2: Automated Evaluation Harness

### Problem

Manual verification doesn't scale. Need automated quality measurement with regression detection.

### Specification

#### Evaluation Runner

```typescript
interface EvalRunner {
  // Run evaluation against corpus
  evaluate(options: EvalOptions): Promise<EvalReport>;

  // Compare two eval runs for regression
  compareRuns(baseline: EvalReport, current: EvalReport): RegressionReport;

  // Run single query for debugging
  evaluateQuery(queryId: string): Promise<QueryEvalResult>;
}

interface EvalOptions {
  corpusPath: string;
  queryFilter?: {
    categories?: string[];
    difficulties?: string[];
    repoIds?: string[];
  };
  parallel?: number;          // Concurrent evaluations
  timeout?: number;           // Per-query timeout
  includeLatency?: boolean;   // Track response times
}
```

#### Metrics (Research-Backed)

Based on state-of-the-art evaluation research:

```typescript
interface EvalMetrics {
  // Retrieval Quality (standard IR metrics)
  retrieval: {
    recallAtK: Record<number, number>;    // Recall@1, @3, @5, @10
    precisionAtK: Record<number, number>; // Precision@1, @3, @5, @10
    mrr: number;                          // Mean Reciprocal Rank
    map: number;                          // Mean Average Precision
    ndcg: number;                         // Normalized Discounted Cumulative Gain
  };

  // Synthesis Quality
  synthesis: {
    factPrecision: number;      // Claimed facts that are correct
    factRecall: number;         // Correct facts that were claimed
    summaryAccuracy: number;    // Overall summary correctness (human-judged proxy)
    consistencyScore: number;   // Self-consistency across related queries
  };

  // Hallucination Detection (per MiniCheck/HHEM research)
  hallucination: {
    hallucinationRate: number;  // Claims in mustNotClaim that appeared
    groundingRate: number;      // Claims with valid evidence citations
    fabricationRate: number;    // Citations to non-existent code
  };

  // Evidence Quality
  evidence: {
    citationAccuracy: number;   // Do citations support claims?
    citationCompleteness: number; // Are all claims cited?
    evidenceRelevance: number;  // Is cited evidence actually relevant?
  };

  // By Category (for targeted improvement)
  byCategory: Record<string, CategoryMetrics>;

  // By Codebase Type (for quality parity)
  byCodebaseType: Record<string, CategoryMetrics>;

  // By Difficulty (sanity check)
  byDifficulty: Record<string, CategoryMetrics>;
}

interface CategoryMetrics {
  accuracy: number;
  sampleSize: number;
  confidenceInterval: [number, number]; // 95% CI
}
```

#### Hallucination Detection Implementation

Based on MiniCheck research (400x cheaper than GPT-4 with comparable accuracy):

```typescript
interface HallucinationDetector {
  // Check if claim is grounded in evidence
  checkGrounding(claim: string, evidence: string[]): GroundingResult;

  // Check against known false statements
  checkFabrication(claims: string[], mustNotClaim: string[]): FabricationResult;

  // Verify citations actually support claims
  verifyCitations(claim: string, citations: Citation[]): CitationVerificationResult;
}

interface GroundingResult {
  isGrounded: boolean;
  confidence: number;
  supportingEvidence: string[];
  contradictingEvidence: string[];
}
```

#### Quality Gates

```typescript
interface QualityGates {
  // Hard gates (must pass)
  retrievalRecallAt5: { target: 0.80, blocking: true };
  hallucinationRate: { target: 0.05, blocking: true };  // < 5%

  // Soft gates (should pass)
  retrievalPrecisionAt5: { target: 0.70, blocking: false };
  synthesisAccuracyStructural: { target: 0.70, blocking: false };
  synthesisAccuracyBehavioral: { target: 0.60, blocking: false };

  // Parity gates (quality across codebase types)
  qualityParity: { maxGap: 0.25, blocking: false };  // Worst within 25% of best
}
```

#### Regression Detection

```typescript
interface RegressionReport {
  hasRegression: boolean;
  regressions: Array<{
    metric: string;
    baseline: number;
    current: number;
    delta: number;
    significance: 'significant' | 'marginal' | 'noise';
  }>;
  improvements: Array<{/* same structure */}>;
  recommendation: 'block' | 'warn' | 'pass';
}
```

---

## E3: Outcome Collection for Calibration

### Problem

Confidence values are meaningless without calibration. Calibration requires knowing what we claimed vs. what actually happened.

### Research Context

From 2025 calibration research:
- Post-RLHF models are significantly miscalibrated (overconfident)
- Traditional post-hoc calibration (temperature scaling) helps but is limited
- **Adaptive Temperature Scaling** achieves 10-50% better calibration than fixed scaling
- Outcome data collection is essential for any calibration approach

**Source**: [A Survey of Confidence Estimation and Calibration in LLMs](https://aclanthology.org/2024.naacl-long.366.pdf)

### Specification

#### Outcome Collection Schema

```typescript
interface OutcomeRecord {
  // Claim identification
  claimId: string;                        // Unique, stable ID
  claim: string;                          // The actual claim text
  claimType: string;                      // Category
  queryId: string;                        // Originating query
  timestamp: string;                      // When claimed

  // Confidence at claim time
  claimedConfidence: number;              // Raw model confidence
  calibratedConfidence?: number;          // Post-calibration (if available)
  confidenceSignals: {
    modelLogProb?: number;
    retrievalScore?: number;
    evidenceCount?: number;
    agreementScore?: number;              // Multi-query consistency
  };

  // Outcome (collected later)
  outcome?: {
    type: 'verified_correct' | 'verified_incorrect' | 'partially_correct' | 'unknown';
    verificationMethod:
      | 'test_passed'           // Automated test verified claim
      | 'test_failed'           // Automated test refuted claim
      | 'human_review'          // Human verified
      | 'agent_feedback'        // Agent reported success/failure
      | 'contradiction_found'   // Later query contradicted
      | 'runtime_observation';  // Observed in production
    evidence: string;
    verifiedAt: string;
    verifiedBy: string;
    confidence: number;                   // How confident in the verification
  };
}
```

#### Collection Points

| Source | Trigger | Data Collected |
|--------|---------|----------------|
| **Test outcomes** | Test run after LiBrainian prediction | Did predicted tests fail? |
| **Agent feedback** | Agent task completion | Did context pack lead to success? |
| **Human corrections** | Human flags error | What was wrong, what's correct? |
| **Contradictions** | Query returns conflicting answer | Which claim is wrong? |
| **Eval harness** | Nightly eval run | Ground truth comparison |

#### Calibration Computation

Based on Expected Calibration Error (ECE) methodology:

```typescript
interface CalibrationComputer {
  // Compute calibration curve from outcomes
  computeCalibration(outcomes: OutcomeRecord[]): CalibrationCurve;

  // Compute ECE (lower is better)
  computeECE(outcomes: OutcomeRecord[]): number;

  // Generate adjustment function
  generateAdjustment(curve: CalibrationCurve): ConfidenceAdjuster;
}

interface CalibrationCurve {
  points: Array<{
    confidenceBucket: number;     // 0.1, 0.2, ..., 1.0
    actualAccuracy: number;       // Empirical accuracy in bucket
    sampleSize: number;
    standardError: number;
  }>;
  ece: number;                    // Expected Calibration Error
  mce: number;                    // Maximum Calibration Error
  overconfidenceRatio: number;    // How often confidence > accuracy
}

// Adjustment based on empirical calibration
type ConfidenceAdjuster = (rawConfidence: number, claimType: string) => {
  adjusted: number;
  interval: [number, number];     // Uncertainty interval
  basis: string;                  // "N=142 similar claims, 68% accurate"
};
```

#### Minimum Viable Calibration

Even before full calibration data:

1. **Report empirical rate**: "N=142 similar claims, 68% were correct"
2. **Flag low-accuracy categories**: Warn when claim type has <50% historical accuracy
3. **Show uncertainty intervals**: `confidence: 0.6-0.8` instead of point estimate
4. **Default to `absent('uncalibrated')`**: Until sufficient data per category

---

## E4: Quality Parity

### Problem

Quality varies wildly by codebase type (84% on clean code, 49% on sparse-docs). Users don't know which category applies to them.

### Specification

#### Codebase Profiler

```typescript
interface CodebaseProfiler {
  profile(workspace: string): Promise<CodebaseProfile>;
}

interface CodebaseProfile {
  // Detectable signals
  metrics: {
    documentationDensity: number;     // Comments + docs per LOC
    testRatio: number;                // Test files / src files
    typeAnnotationRate: number;       // For dynamic languages
    avgFileSize: number;              // Lines per file
    avgFunctionSize: number;          // Lines per function
    cyclomaticComplexity: number;     // Average complexity
    dependencyDepth: number;          // Import chain depth
    namingEntropy: number;            // Descriptive vs cryptic names
    codeAge: number;                  // Average file age (days)
    churnRate: number;                // Changes per file per month
  };

  // Classification
  category:
    | 'well_documented'           // High docs, clear architecture
    | 'sparse_docs_good_tests'    // Low docs, high test coverage
    | 'sparse_docs_few_tests'     // Low docs, low tests
    | 'legacy_complex';           // Old, high complexity

  // Predicted quality
  expectedAccuracy: {
    structural: number;           // Dependency, symbol queries
    behavioral: number;           // Function explanation
    architectural: number;        // Component boundaries
    impact: number;               // Change analysis
  };

  // Recommendations
  recommendations: string[];      // How to improve LiBrainian accuracy
}
```

#### Adaptive Strategy Selection

```typescript
interface AdaptiveStrategy {
  // Select synthesis strategy based on profile
  selectStrategy(profile: CodebaseProfile, queryType: string): SynthesisStrategy;
}

interface SynthesisStrategy {
  confidenceMultiplier: number;       // Scale raw confidence
  maxClaimDepth: 'deep' | 'moderate' | 'shallow' | 'structural_only';
  evidenceRequirement: 'standard' | 'strict' | 'maximum';
  addDefeaters: boolean;              // Add extra caveats
  refuseBehavioralClaims: boolean;    // For very poor codebases
  fallbackToTestAnalysis: boolean;    // Lean on test behavior
  suggestImprovements: boolean;       // Recommend doc/test additions
}

// Strategy lookup
const STRATEGIES: Record<CodebaseCategory, SynthesisStrategy> = {
  'well_documented': {
    confidenceMultiplier: 1.0,
    maxClaimDepth: 'deep',
    evidenceRequirement: 'standard',
    addDefeaters: false,
    refuseBehavioralClaims: false,
    fallbackToTestAnalysis: false,
    suggestImprovements: false,
  },
  'sparse_docs_good_tests': {
    confidenceMultiplier: 0.85,
    maxClaimDepth: 'moderate',
    evidenceRequirement: 'strict',
    addDefeaters: true,
    refuseBehavioralClaims: false,
    fallbackToTestAnalysis: true,
    suggestImprovements: true,
  },
  'sparse_docs_few_tests': {
    confidenceMultiplier: 0.7,
    maxClaimDepth: 'shallow',
    evidenceRequirement: 'strict',
    addDefeaters: true,
    refuseBehavioralClaims: false,
    fallbackToTestAnalysis: false,
    suggestImprovements: true,
  },
  'legacy_complex': {
    confidenceMultiplier: 0.5,
    maxClaimDepth: 'structural_only',
    evidenceRequirement: 'maximum',
    addDefeaters: true,
    refuseBehavioralClaims: true,
    fallbackToTestAnalysis: false,
    suggestImprovements: true,
  },
};
```

#### Quality Disclosure

Every response must include expected quality:

```typescript
interface QualityDisclosure {
  codebaseCategory: string;
  expectedAccuracy: {
    thisQueryType: number;
    basis: string;              // "Based on 847 similar queries on similar codebases"
  };
  limitations: string[];        // Specific limitations for this codebase
  recommendations: string[];    // How user can improve accuracy
}
```

---

## Implementation Checklist

### Phase 8: Ground Truth Corpus
- [ ] Define corpus structure and schema
- [ ] Annotate small-typescript repo (50 files, full annotation)
- [ ] Annotate medium-python repo (500 files, partial annotation)
- [ ] Annotate medium-mixed repo (1000 files, multiple languages)
- [ ] Create adversarial repo with misleading cases
- [ ] Create 200+ query/answer pairs across categories
- [ ] Validate corpus with schema checks

### Phase 9: Evaluation Harness
- [ ] Implement EvalRunner
- [ ] Implement retrieval metrics (Recall@k, Precision@k, MRR, MAP, NDCG)
- [ ] Implement synthesis metrics (fact precision/recall)
- [ ] Implement hallucination detection (MiniCheck-style)
- [ ] Build quality dashboard (JSON + Markdown output)
- [ ] Add regression detection
- [ ] Integrate with CI (nightly runs, quality gates)

### Phase 10: Outcome Collection
- [ ] Add claim ID infrastructure
- [ ] Build outcome collection API
- [ ] Integrate agent feedback
- [ ] Build human correction interface
- [ ] Implement contradiction detection
- [ ] Build calibration curve computation
- [ ] Implement confidence adjustment

### Phase 11: Quality Parity
- [ ] Build codebase profiler
- [ ] Implement quality prediction model
- [ ] Build adaptive strategy selection
- [ ] Add quality disclosure to responses
- [ ] Achieve quality parity target (worst within 25% of best)

---

## Gates

Add to `GATES.json`:

```json
{
  "layer5.evalCorpus": {
    "name": "Ground Truth Corpus",
    "layer": 5,
    "status": "not_started",
    "target": "10 repos, 200+ query/answer pairs",
    "spec": "specs/track-eval-infrastructure.md#e1"
  },
  "layer5.evalHarness": {
    "name": "Evaluation Harness",
    "layer": 5,
    "status": "not_started",
    "target": "Nightly eval with regression detection",
    "spec": "specs/track-eval-infrastructure.md#e2"
  },
  "layer5.retrievalRecall": {
    "name": "Retrieval Recall@5",
    "layer": 5,
    "status": "not_measured",
    "target": ">= 80%",
    "blocking": true,
    "spec": "specs/track-eval-infrastructure.md#e2"
  },
  "layer5.hallucinationRate": {
    "name": "Hallucination Rate",
    "layer": 5,
    "status": "not_measured",
    "target": "< 5%",
    "blocking": true,
    "spec": "specs/track-eval-infrastructure.md#e2"
  },
  "layer5.outcomeCollection": {
    "name": "Outcome Collection Infrastructure",
    "layer": 5,
    "status": "not_started",
    "target": "Collection API + 1000+ outcomes",
    "spec": "specs/track-eval-infrastructure.md#e3"
  },
  "layer5.calibrationCurve": {
    "name": "Calibration Curve Computation",
    "layer": 5,
    "status": "not_started",
    "target": "ECE < 10%",
    "spec": "specs/track-eval-infrastructure.md#e3"
  },
  "layer5.qualityParity": {
    "name": "Quality Parity Across Codebase Types",
    "layer": 5,
    "status": "not_measured",
    "target": "Worst within 25% of best",
    "spec": "specs/track-eval-infrastructure.md#e4"
  }
}
```

---

## References

- [SWE-bench](https://www.swebench.com/) - Real-world code evaluation
- [MiniCheck](https://arxiv.org/abs/2404.10774) - Efficient fact-checking
- [Ragas](https://arxiv.org/pdf/2309.15217) - RAG evaluation framework
- [Calibration Survey](https://aclanthology.org/2024.naacl-long.366.pdf) - LLM calibration techniques
- [DependEval](https://aclanthology.org/2025.findings-acl.373.pdf) - Cross-file understanding benchmark
- [Repository-Level Code Survey](https://arxiv.org/abs/2510.04905) - RACG approaches
