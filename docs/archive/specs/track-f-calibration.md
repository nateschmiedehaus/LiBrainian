# Track F: Calibration Infrastructure (C1-C4)

> **Source**: Extracted from THEORETICAL_CRITIQUE.md
> **Part References**: XIX.N.4, XIX.N.5, XIX.N.7, Problems 6, 11, 14, 16, 49
> **Purpose**: Make confidence claims HONEST through empirical calibration
>
> **LiBrainian Story**: Chapter 5 (The Honesty) - Part 2. This upgrades `absent`/uncalibrated confidence to empirically `measured` confidence when outcome data exists.
>
> **Dependency**: Requires Track D (Q1-Q3) to be implemented first. Track D provides `ConfidenceValue` + derivation + conservative handling for `absent`. Track F provides calibration loops that produce `measured` confidence (no arbitrary numbers).

---

## KNOWN IMPLEMENTATION ISSUES

| Issue | Severity | Status |
|-------|----------|--------|
| **C1-C4 incomplete** | HIGH | Partial calibration exists for context packs; claim-level calibration loops are not unified |
| **No calibration data** | HIGH | No historical outcomes exist |
| **Confidence Monism** | MEDIUM | Problem 6 - one model for all knowledge types |
| **Time Decay Fallacy** | MEDIUM | Problem 5 - decay without evidence of change |

**Dependency chain**: Track D (Q1-Q3) → Track F (C1-C4) → features can safely use `measured` confidence where supported (otherwise remain `absent` with explicit disclosure).

---

## Overview

Calibration infrastructure transforms arbitrary confidence values into empirically validated measurements. Without calibration, confidence scores are "wishes, not measurements" (Dijkstra).

### Track F Features

| Priority | Feature | Part Reference | LOC | Dependencies |
|----------|---------|----------------|-----|--------------|
| **C1** | Claim-Outcome Tracking | XIX.N.4 | ~100 | Q2 |
| **C2** | Calibration Curve Computation | XIX.N.7 | ~150 | C1 |
| **C3** | Confidence Adjustment | XIX.N.7 | ~100 | C2 |
| **C4** | Calibration Dashboard | XIX.N.7 | ~200 | C2 |

**When to implement**: C1-C4 are ongoing infrastructure that should be built after Q1-Q3 (ConfidenceValue type, derivation rules, and conservative degradation handlers).

---

## Theoretical Foundation

### The Confidence Calibration Circularity (Problem 16)

**The Core Issue**

Confidence calibration "learns from outcomes." But outcome attribution is genuinely hard:
- Agent succeeds at task T after receiving context pack P
- Did P contribute to success?
- P might have been ignored, irrelevant, or actually hindering

The system assumes: `success -> retrieved knowledge was good`. This is survivorship bias.

**Why This Matters**

Without proper attribution:
- Learning what context actually helps (not just what was present) is impossible
- Helpful context is indistinguishable from irrelevant context
- Context gets penalized for failures it didn't cause
- Calibration accuracy degrades over time

### The Arbitrary Numbers Problem (XIX.N.4)

> **THIS SECTION IS A SELF-CRITIQUE.** The 25 greats recognize a fundamental problem in this document and the codebase.

**The Problem**: Throughout this document and the implementation, confidence values appear:
- Tier 1 extraction: 0.95
- Tier 2 extraction: 0.8
- Tier 3 extraction: 0.6
- Claim threshold: 0.6
- Relationship weight: 0.9, 0.7
- Primitive confidence: 0.5, 0.6, 0.7, 0.8

**Dijkstra**: "These numbers are wishes, not measurements. A confidence of 0.7 that hasn't been validated against outcomes is epistemically meaningless."

**Pearl**: "These are priors without posteriors. Bayesian reasoning requires updating beliefs based on evidence. Where is the evidence?"

**Shannon**: "Information theory requires knowing the actual entropy. These numbers pretend to encode uncertainty without measuring it."

**The Honest Assessment**:

| Number | Source | Validity |
|--------|--------|----------|
| 0.95 (AST extraction) | Intuition: "AST parsing rarely fails" | **Uncalibrated** - actual failure rate unknown |
| 0.8 (hybrid extraction) | Intuition: "LLM helps but isn't perfect" | **Uncalibrated** - no measured accuracy |
| 0.6 (semantic extraction) | Intuition: "Pure LLM is less reliable" | **Uncalibrated** - no benchmarks |
| 0.5-0.7 (primitive confidence) | Copy-pasted from similar systems | **Ungrounded** - no domain basis |

**Until C1-C3 are implemented**, all confidence values in this document should be read as:

> **UNCALIBRATED**: This value is an intuition-based prior, not an empirically validated confidence.

### Confidence Monism (Problem 6)

The system applies one confidence model uniformly across all knowledge types. But knowledge types have radically different epistemic profiles:

| Knowledge Type | Stability | Verification Method | Decay Profile |
|----------------|-----------|---------------------|---------------|
| Syntactic (AST structure) | Very high | Deterministic parsing | Only decays on file change |
| Behavioral (what code does) | High | Testing | Decays on code/test changes |
| Intentional (why it was written) | Medium | Author query, commits | Decays on requirement changes |
| Normative (is it good) | Low, contextual | Contested | Decays on standard changes |
| Predictive (how it will evolve) | Very low | Speculation | Always low confidence |

A confidence score of 0.7 means completely different things for "this function returns a string" vs. "this architecture was chosen for scalability."

**Calibration Curves Per Type (Norvig's requirement)**: Each knowledge type should have its own calibration curve, trained on that type's historical accuracy. Use isotonic regression for well-sampled types, Platt scaling for sparse types.

### Arbitrary Calibration Bounds (Problem 11)

The confidence bounds [0.1, 0.95] encode philosophical positions:
- Nothing is ever fully certain (< 1.0)
- Nothing is ever fully unknown (> 0.0)

These are defensible positions. But the specific bounds are **arbitrary**:
- Why not [0.05, 0.99]?
- Why +0.1 for success and -0.2 for failure?
- The difference between 0.95 and 0.99 confidence is huge in decision-making

### The Bootstrap Problem (Problem 14)

The system requires calibrated confidence from historical data. But:
- Initial indexing happens before any episodes exist
- Confidence calibration requires historical outcomes that don't exist
- Cold start uses uncalibrated synthesis as if calibrated

### Sample Complexity for Calibration (Problem 49)

Confidence calibration requires historical data, but:
- How many samples are needed for reliable calibration?
- What's the statistical power of calibration with N episodes?
- What's the confidence interval on calibration estimates?

The bootstrap mode mentions "minimum episodes before transitioning" but provides no theoretical basis for the threshold.

---

## C1: Claim-Outcome Tracking

### Purpose

Record every confidence-bearing claim and its actual outcome to build the empirical basis for calibration.

### Interface Specification

```typescript
/**
 * Confidence calibration protocol.
 *
 * INVARIANT: No confidence value may be used in production
 * until it has been calibrated against empirical outcomes.
 */

interface CalibrationProtocol {
  // Phase 1: Track all confidence claims
  recordClaim(claim: Claim, statedConfidence: number): ClaimId;

  // Phase 2: Record actual outcomes
  recordOutcome(claimId: ClaimId, wasCorrect: boolean): void;

  // Phase 3: Compute calibration curve
  computeCalibration(): CalibrationCurve;
  // Returns: for claims with stated confidence X%, what % were actually correct?

  // Phase 4: Adjust future confidences
  calibratedConfidence(rawConfidence: number, extractionType: string): number;
  // Uses empirical calibration to adjust stated confidence
}
```

### Causal Attribution Solution

```typescript
interface OutcomeAttribution {
  /** What was the outcome? */
  outcome: 'success' | 'failure';

  /** What context was provided? */
  providedContext: ContextPack[];

  /** What context was actually used? (from trace analysis) */
  usedContext: ContextPack[];

  /** Counterfactual: what would have happened without this context? */
  counterfactualAnalysis?: {
    /** Was alternative context available? */
    alternativeAvailable: boolean;
    /** Estimated outcome without this context */
    estimatedOutcome: 'success' | 'failure' | 'unknown';
  };

  /** Attribution confidence */
  attributionConfidence: number;
}

function attributeOutcome(
  outcome: Outcome,
  trace: ExecutionTrace
): OutcomeAttribution {
  // Analyze trace to see what context was actually referenced
  const usedContext = extractUsedContext(trace);

  // Provided but unused context gets no credit/blame
  const unusedContext = difference(outcome.providedContext, usedContext);

  // Used context gets partial attribution based on trace analysis
  for (const pack of usedContext) {
    const usage = analyzeUsage(trace, pack);
    if (usage.influential) {
      updateConfidence(pack, outcome.success ? +0.1 : -0.2);
    }
    // Non-influential usage: neutral
  }

  // Unused context: slight negative (not relevant enough to use)
  for (const pack of unusedContext) {
    updateConfidence(pack, -0.02); // Slight penalty for irrelevance
  }
}
```

### Propagating Impact

Causal attribution enables:
- Learning what context actually helps (not just what was present)
- Distinguishing helpful from irrelevant context
- Not penalizing context for failures it didn't cause
- More accurate calibration over time

### Data Schema

```typescript
interface CalibrationExample {
  // The claim that was made
  claim: {
    type: string;  // e.g., 'entity_extraction', 'relationship_detection'
    context: string;
    statedConfidence: number;
  };
  // The ground truth outcome
  outcome: {
    wasCorrect: boolean;
    verifiedBy: 'human' | 'automated_test' | 'downstream_success';
    verifiedAt: string;
  };
}

interface CalibrationDataset {
  id: string;
  name: string;
  description: string;
  // Ground truth examples
  examples: CalibrationExample[];
  // When collected
  collectedAt: string;
  // Version of LiBrainian used
  librarianVersion: string;
}
```

### Acceptance Criteria

- [ ] Every confidence-bearing claim is recorded with unique ClaimId
- [ ] Claims include: type, context hash, stated confidence, timestamp
- [ ] Outcomes can be recorded asynchronously after claim creation
- [ ] Attribution distinguishes used vs. unused context
- [ ] Trace analysis identifies influential vs. non-influential usage
- [ ] Storage is append-only for audit trail
- [ ] ~100 LOC budget

---

## C2: Calibration Curve Computation

### Purpose

Compute the mapping from stated confidence to actual accuracy using empirical data.

### Interface Specification

```typescript
interface CalibrationReport {
  datasetId: string;
  computedAt: string;
  // Calibration curve: stated confidence -> actual accuracy
  calibrationCurve: Map<number, number>;
  // Calibration error metrics
  expectedCalibrationError: number;
  maximumCalibrationError: number;
  // Recommendations
  adjustments: Map<string, { raw: number; calibrated: number }>;
}
```

### Calibration Methods

```typescript
interface GitGroundedConfidence {
  /** Base confidence from extraction quality */
  readonly extractionConfidence: BrandedConfidence;

  /** Git history signals that modulate confidence */
  readonly gitSignals: {
    /** How often was this code reverted? High revert rate -> low confidence */
    revertRate: number;

    /** Survival curve: P(no change | t) estimated from commit history */
    survivalCurve: SurvivalFunction;

    /** Bugfix rate in this region: high bugfix rate -> lower confidence */
    bugfixRate: number;

    /** Author expertise: weighted by commit history in this domain */
    authorExpertise: number;

    /** Review depth: how many reviewers, how long review took */
    reviewDepth: number;
  };

  /** Calibrated confidence: adjusted by feedback loop */
  readonly calibrated: BrandedConfidence;

  /** Calibration metadata for introspection */
  readonly calibrationMeta: {
    sampleSize: number;
    lastCalibrated: Timestamp;
    calibrationMethod: 'platt' | 'isotonic' | 'beta';
    brier: number; // Brier score for calibration quality
  };
}

/** Branded type prevents confusion with raw numbers */
type BrandedConfidence = number & {
  readonly __brand: unique symbol;
  readonly __range: '[0,1]';
  readonly __calibrated: true;
};

function createConfidence(raw: number): BrandedConfidence {
  if (raw < 0 || raw > 1) {
    throw new Error(`Confidence must be in [0,1], got ${raw}`);
  }
  return raw as BrandedConfidence;
}
```

### Computation Algorithm

```typescript
/**
 * Compute git-grounded confidence for a pattern.
 *
 * COMPLEXITY: O(log n) with cached git stats, O(n) cold
 * INVARIANT: result.calibrated approximates true P(correct)
 */
async function computeGitGroundedConfidence(
  pattern: Pattern,
  gitHistory: GitHistoryCache,
  calibrator: ConfidenceCalibrator
): Promise<GitGroundedConfidence> {
  const file = pattern.location.file;
  const range = pattern.location.range;

  // Query cached git statistics for this region
  const stats = await gitHistory.getRegionStats(file, range);

  // Compute survival probability: P(unchanged | elapsed time)
  const survivalP = stats.survivalCurve.evaluate(Date.now() - pattern.extractedAt);

  // Combine signals using learned weights
  const rawConfidence = combineSignals({
    extraction: pattern.extractionConfidence,
    survival: survivalP,
    revertPenalty: 1 - stats.revertRate,
    bugfixPenalty: 1 - Math.min(stats.bugfixRate * 0.5, 0.5),
    expertiseBonus: Math.min(stats.authorExpertise * 0.1, 0.2),
    reviewBonus: Math.min(stats.reviewDepth * 0.05, 0.1),
  });

  // Calibrate using Platt scaling (Norvig's recommendation)
  const calibrated = calibrator.calibrate(rawConfidence);

  return {
    extractionConfidence: pattern.extractionConfidence,
    gitSignals: stats,
    calibrated,
    calibrationMeta: calibrator.getMeta(),
  };
}
```

### Calibration Methods by Data Availability

| Data Volume | Recommended Method | Rationale |
|-------------|-------------------|-----------|
| Sparse (< 100 samples) | Platt scaling | Parametric, stable with small samples |
| Medium (100-1000 samples) | Beta calibration | More flexible than Platt |
| Well-sampled (> 1000 samples) | Isotonic regression | Non-parametric, captures complex curves |

### Type-Stratified Calibration

```typescript
type KnowledgeType =
  | 'syntactic'   // Structure, types, names
  | 'behavioral'  // What code does
  | 'intentional' // Why code was written
  | 'normative'   // Quality judgments
  | 'predictive'; // Future evolution

interface TypedConfidence {
  type: KnowledgeType;
  raw: number;

  /** Type-specific calibration */
  calibrated: number;

  /** Type-specific decay model */
  decayModel: DecayModel;

  /** Type-specific verification method */
  verificationMethod: VerificationMethod;

  /** Semantic interpretation of confidence levels for this type */
  interpretation: ConfidenceInterpretation;
}

const CONFIDENCE_INTERPRETATIONS: Record<KnowledgeType, ConfidenceInterpretation> = {
  syntactic: {
    0.9: 'AST-verified, file unchanged',
    0.7: 'AST-verified, file recently changed',
    0.5: 'Inferred from context',
    0.3: 'Heuristic match',
  },
  behavioral: {
    0.9: 'Test-verified, tests passing',
    0.7: 'Test-inferred, no direct test',
    0.5: 'Static analysis inference',
    0.3: 'LLM synthesis only',
  },
  intentional: {
    0.9: 'Explicit documentation/commit message',
    0.7: 'Consistent with multiple sources',
    0.5: 'Single source inference',
    0.3: 'Speculative interpretation',
  },
  // ... etc
};
```

### Sample Complexity Analysis

```typescript
interface CalibrationSampleComplexity {
  /** Samples needed for (epsilon, delta)-calibration */
  requiredSamples: (epsilon: number, delta: number) => number;

  /** Current calibration confidence interval */
  currentConfidenceInterval: {
    sampleSize: number;
    epsilon: number;  // calibration error bound
    delta: number;    // failure probability
    interval: [number, number];
  };

  /** Power analysis: what effect size is detectable? */
  powerAnalysis: {
    currentPower: number;
    detectableEffectSize: number;
    samplesForPower80: number;
  };
}

// From PAC learning: m >= (1/2*epsilon^2) * ln(2/delta) for (epsilon, delta)-calibration
function requiredSamplesForCalibration(
  epsilon: number,  // calibration error tolerance
  delta: number     // failure probability
): number {
  return Math.ceil((1 / (2 * epsilon * epsilon)) * Math.log(2 / delta));
}

// Example: for epsilon=0.05, delta=0.05, need m >= 738 samples
```

### Acceptance Criteria

- [ ] Calibration curve computed for each knowledge type separately
- [ ] Platt scaling implemented for sparse data
- [ ] Isotonic regression implemented for well-sampled data
- [ ] Beta calibration implemented for medium data volumes
- [ ] Expected Calibration Error (ECE) computed
- [ ] Maximum Calibration Error (MCE) computed
- [ ] Brier score computed as quality metric
- [ ] Sample size tracked per type
- [ ] Calibration triggers recomputation when sample count crosses thresholds
- [ ] ~150 LOC budget

---

## C3: Confidence Adjustment

### Purpose

Apply calibration curves to transform raw confidence into calibrated confidence that approximates true P(correct).

### Empirical Bounds Configuration

```typescript
interface CalibrationConfig {
  /** Derived from empirical calibration curve */
  bounds: {
    min: number;
    max: number;
    /** How were these derived? */
    derivation: 'empirical' | 'theoretical' | 'arbitrary';
  };

  /** Adjustment magnitudes derived from outcome analysis */
  adjustments: {
    success: number;
    failure: number;
    /** Ratio based on Bayesian update with observed base rates */
    ratioJustification: string;
  };

  /** Domain-specific calibration */
  domain: string;

  /** Recalibration schedule */
  recalibrationPeriod: 'daily' | 'weekly' | 'monthly';
}

function computeEmpiricalBounds(
  historicalData: OutcomeData[]
): CalibrationBounds {
  // Compute: at what raw confidence do we see 50% empirical accuracy?
  // That's our effective "0.5" point
  // Scale bounds accordingly
}

function computeAdjustmentRatio(
  historicalData: OutcomeData[]
): { success: number; failure: number } {
  // Compute base rate of success
  // Apply Bayesian update formula
  // success_adjustment = log(P(success|positive) / P(success|prior))
  // failure_adjustment = log(P(failure|negative) / P(failure|prior))
}
```

### Bootstrap Mode

```typescript
type SystemMode =
  | 'bootstrap'    // No history, conservative defaults
  | 'calibrating'  // Accumulating history, widening confidence intervals
  | 'calibrated';  // Sufficient history, empirical calibration

interface BootstrapConfig {
  /** Mode based on history availability */
  mode: SystemMode;

  /** Minimum episodes before transitioning to calibrating */
  calibrationThreshold: number;

  /** Minimum episodes before transitioning to calibrated */
  calibratedThreshold: number;

  /** Conservative defaults for bootstrap mode */
  bootstrapDefaults: {
    /**
     * Conservative cap for *effective* confidence used in decisions during bootstrap.
     *
     * NOTE: This is NOT a `ConfidenceValue` and MUST NOT be presented as calibrated confidence.
     * Claim confidence remains `absent(...)` until measured outcomes exist.
     */
    maxEffectiveConfidence: 0.6;

    /** Wider uncertainty intervals during bootstrap */
    uncertaintyMultiplier: 2.0;

    /** Explicit warning on all outputs */
    bootstrapWarning: true;
  };
}

function computeConfidenceValue(
  rawScore: number,
  config: BootstrapConfig
): { confidence: ConfidenceValue; calibrationStatus: string } {
  if (config.mode === 'bootstrap') {
    return {
      confidence: absent('insufficient_data'),
      calibrationStatus: 'uncalibrated_bootstrap',
    };
  }

  if (config.mode === 'calibrating') {
    return {
      // Numeric calibration outputs are internal *scores*; claim confidence must remain a `ConfidenceValue`
      // until it is backed by measured outcome datasets.
      confidence: absent('insufficient_data'),
      calibrationStatus: 'calibrating_limited_data',
    };
  }

  // Calibrated: produce `measured` confidence backed by real outcome datasets.
  // return { confidence: measuredConfidence(...), calibrationStatus: 'calibrated' };
  return { confidence: absent('insufficient_data'), calibrationStatus: 'calibrated' };
}
```

### TLA+ Specification for Confidence Decay

```tla
---- MODULE ConfidenceDecay ----
EXTENDS Reals, Sequences

CONSTANTS MinConfidence, MaxConfidence, DecayRate
VARIABLES confidence, lastValidated, changeCount

TypeInvariant ==
  /\ confidence \in [MinConfidence..MaxConfidence]
  /\ lastValidated \in Nat
  /\ changeCount \in Nat

Init ==
  /\ confidence = MaxConfidence
  /\ lastValidated = 0
  /\ changeCount = 0

Decay(changes) ==
  /\ changeCount' = changeCount + changes
  /\ confidence' = Max(MinConfidence,
       confidence * (1 - DecayRate) ^ changes)
  /\ UNCHANGED lastValidated

Validate ==
  /\ lastValidated' = Now
  /\ changeCount' = 0
  /\ UNCHANGED confidence

PositiveFeedback(boost) ==
  /\ confidence' = Min(MaxConfidence, confidence + boost)
  /\ UNCHANGED <<lastValidated, changeCount>>

MonotonicDecay ==
  [][confidence' =< confidence \/ PositiveFeedback]_confidence

====
```

**Specification guarantees**:
1. Confidence never increases without evidence
2. Confidence is monotonically decreasing given only decay events
3. Confidence can increase on positive feedback
4. Calibration error is bounded

### Propagating Impact

Empirically-grounded calibration enables:
- Confidence scores that mean something measurable
- Detection of miscalibration (predicted vs actual accuracy)
- Domain-appropriate bounds (some domains warrant narrower ranges)
- Continuous improvement of calibration

Explicit bootstrap handling enables:
- Honest disclosure of calibration status
- Conservative behavior when history is limited
- Clear transition from bootstrap to calibrated operation
- No false precision during cold start

### Acceptance Criteria

- [ ] Bootstrap mode caps confidence at 0.6 with explicit warning
- [ ] Calibrating mode applies empirical adjustment with wider intervals
- [ ] Calibrated mode applies full calibration curve
- [ ] Mode transitions based on sample count thresholds
- [ ] Calibration status included in all confidence outputs
- [ ] Decay model enforces monotonic decrease without positive feedback
- [ ] Positive feedback only increases confidence with evidence
- [ ] ~100 LOC budget

---

## C4: Calibration Dashboard

### Purpose

Visualize calibration quality for debugging, monitoring, and continuous improvement.

### Dashboard Components

1. **Calibration Curve Plot**
   - X-axis: Stated confidence (bins: 0.0-0.1, 0.1-0.2, ..., 0.9-1.0)
   - Y-axis: Actual accuracy in that bin
   - Perfect calibration line (y = x) for reference
   - Per-type curves (syntactic, behavioral, intentional, normative, predictive)

2. **Reliability Diagram**
   - Gap between predicted and actual confidence
   - Overconfidence/underconfidence regions highlighted
   - ECE and MCE displayed prominently

3. **Sample Size Monitor**
   - Current sample count per knowledge type
   - Threshold for transitioning calibration modes
   - PAC-learning required samples for target accuracy

4. **Temporal Calibration Drift**
   - Calibration quality over time
   - Detection of distribution shift
   - Recalibration triggers

5. **Attribution Quality**
   - Percentage of outcomes with confident attribution
   - Used vs. unused context ratio
   - Influential vs. non-influential usage breakdown

### API Specification

```typescript
interface CalibrationDashboard {
  /** Get current calibration report */
  getReport(): CalibrationReport;

  /** Get calibration curve data for plotting */
  getCurveData(type: KnowledgeType): {
    bins: number[];
    actualAccuracy: number[];
    sampleCounts: number[];
  };

  /** Get reliability diagram data */
  getReliabilityData(): {
    predictedBins: number[];
    actualBins: number[];
    gapSizes: number[];
  };

  /** Get temporal drift data */
  getDriftData(since: Date): {
    timestamps: Date[];
    ece: number[];
    mce: number[];
    sampleCounts: number[];
  };

  /** Get attribution quality metrics */
  getAttributionMetrics(): {
    totalOutcomes: number;
    confidentAttributions: number;
    usedContextRatio: number;
    influentialUsageRatio: number;
  };

  /** Export data for external visualization */
  exportJSON(): string;
  exportCSV(): string;
}
```

### Minimum Viable Calibration Dataset

| Domain | Source | Size | Ground Truth |
|--------|--------|------|--------------|
| TypeScript AST | wave0-autopilot codebase | 1000+ entities | Human-verified subset |
| Python AST | Popular OSS projects | 500+ entities | Human-verified subset |
| Relationship detection | Known dependency graphs | 200+ relationships | npm/pip metadata |
| Semantic claims | LLM-generated, human-verified | 100+ claims | Human review |

### Bootstrap Calibration Process

1. **Collect Ground Truth**: Run LiBrainian on codebases where we KNOW the correct answers
2. **Record Claims**: Capture every confidence-bearing claim
3. **Verify Outcomes**: Human or automated verification of correctness
4. **Compute Calibration**: stated confidence vs actual accuracy
5. **Apply Adjustments**: Produce `measured` confidence (with datasetId, n, CI) from empirical outcomes

### Acceptance Criteria

- [ ] Calibration curve visualization per knowledge type
- [ ] Reliability diagram with gap highlighting
- [ ] ECE and MCE displayed with clear thresholds
- [ ] Sample size monitoring with mode transition indicators
- [ ] Temporal drift detection and alerting
- [ ] Attribution quality metrics
- [ ] Export to JSON and CSV
- [ ] ~200 LOC budget

---

## The 25 Greats' Verdict

**Wirth**: "We should not have shipped these numbers without this disclaimer. Intellectual honesty demands we mark them as uncalibrated."

**Knuth**: "Premature optimization is the root of all evil. Premature confidence quantification is epistemic evil."

**Hoare**: "There are two ways to write code: so simple there are obviously no bugs, or so complex there are no obvious bugs. There are two ways to state confidence: so clearly calibrated there's obviously accuracy, or so arbitrarily stated there's no obvious meaning. We chose the latter, and must fix it."

**Dijkstra**: "We cannot eliminate uncertainty, but we can be honest about it. The Quantification Invariant enforces honesty."

**Pearl**: "This transforms arbitrary priors into a proper Bayesian framework where beliefs update from evidence."

**McCarthy**: "An epistemologically adequate system must distinguish what it knows from what it assumes. The QI makes this distinction explicit in the type system."

---

## Implementation Dependencies

### Prerequisite: Quantification Invariant (Q1-Q3)

Before implementing C1-C4, ensure these are complete:

| Priority | Feature | Status |
|----------|---------|--------|
| **Q1** | ConfidenceValue type | Implemented |
| **Q2** | Derivation rules | Implemented |
| **Q3** | Degradation handlers | Implemented |

### Related Files

| Component | Location | LOC |
|-----------|----------|-----|
| **Confidence System** | `api/confidence_calibration.ts` | ~300 |
| **Learning Loop** | `api/learning_loop.ts` | ~400 |
| **Execution Engine** | `api/technique_execution.ts` | ~600 |

### Cascade Effects

| Solution | Cascade Effects |
|----------|-----------------|
| S6 (Type-Stratified Confidence) | All confidence consumers must handle typed confidence |
| S11 (Empirical Calibration Bounds) | Bounds become domain-specific |
| S14 (Bootstrap Mode) | All confidence reads must check calibration status |
| S15 (Unified Invalidation) | Single staleness model across system |
| S16 (Causal Attribution) | Outcome attribution feeds calibration |

---

## Summary

Track F Calibration Infrastructure makes confidence claims HONEST by:

1. **C1 (Claim-Outcome Tracking)**: Records every claim and its empirical outcome with causal attribution
2. **C2 (Calibration Curve Computation)**: Computes per-type calibration using appropriate methods (Platt, isotonic, beta)
3. **C3 (Confidence Adjustment)**: Applies calibration with bootstrap-aware mode handling
4. **C4 (Calibration Dashboard)**: Visualizes calibration quality for monitoring and improvement

**Total estimated LOC**: ~550

Without calibration infrastructure, LiBrainian's confidence values are "wishes, not measurements." With it, confidence approximates true P(correct), enabling agents to make informed decisions about uncertainty.
