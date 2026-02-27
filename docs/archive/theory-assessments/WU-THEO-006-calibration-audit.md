# WU-THEO-006: Calibration Theory Alignment Assessment

**Work Unit**: WU-THEO-006
**Date**: 2026-01-27
**Auditor**: Claude Opus 4.5
**Status**: Complete
**Priority**: HIGH - Foundation for epistemic honesty

---

## Executive Summary

The LiBrainian calibration system implements a **reasonable but incomplete** approach to confidence calibration. The core ECE/MCE computation is mathematically correct, and the bucket-based calibration curve methodology follows standard practices. However, the implementation has significant gaps when assessed against proper scoring rule theory, modern ECE alternatives, and calibration best practices.

**Overall Assessment**: PARTIAL ALIGNMENT with SIGNIFICANT GAPS

| Category | Rating | Notes |
|----------|--------|-------|
| Proper Scoring Rules | MISSING | No Brier score or log loss implemented |
| ECE Implementation | CORRECT | Standard equal-width binning, correct formula |
| ECE Alternatives | MISSING | No SmoothECE, Adaptive ECE, or reliability diagrams |
| Calibration Adjustment | HEURISTIC | Linear interpolation, not Platt/Temperature/Isotonic |
| Cold Start Handling | PARTIAL | Weight-based blending, no principled prior |

---

## 1. Scoring Rule Properness Assessment

### 1.1 Theoretical Background

A **proper scoring rule** S(p, y) is one where the expected score E[S(p, y)] is maximized (for reward-based rules) or minimized (for loss-based rules) when the forecaster reports their true beliefs. This prevents gaming and ensures honest probability reporting.

**Key Proper Scoring Rules**:

| Rule | Formula | Properties |
|------|---------|------------|
| **Brier Score** | BS = (1/n) * sum((p_i - y_i)^2) | Proper, bounded [0,1], squared error |
| **Log Loss** | LL = -(1/n) * sum(y_i * log(p_i) + (1-y_i) * log(1-p_i)) | Strictly proper, unbounded, information-theoretic |
| **Spherical Score** | SS = p_y / sqrt(sum(p_i^2)) | Proper, range [0,1] |

**Improper scoring rules** (like accuracy alone) can be gamed by reporting extreme probabilities.

### 1.2 Implementation Analysis

**File**: `/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/LiBrainian/src/epistemics/calibration.ts`

**Current Metrics Computed**:
```typescript
// Lines 135-173: ECE and MCE computation
eceSum += bucket.count * calibrationError;
mce = Math.max(mce, calibrationError);
// ...
const ece = totalSamples > 0 ? eceSum / totalSamples : 0;
```

**Finding**: **NO PROPER SCORING RULES IMPLEMENTED**

The implementation computes:
- Expected Calibration Error (ECE) - NOT a proper scoring rule
- Maximum Calibration Error (MCE) - NOT a proper scoring rule
- Overconfidence Ratio - NOT a proper scoring rule

**Problem**: ECE measures calibration but NOT resolution. A forecaster who always predicts the base rate achieves perfect calibration (ECE=0) but provides no useful discrimination. Proper scoring rules reward both calibration AND resolution.

### 1.3 Risk of Gaming

| Metric | Gaming Risk | Explanation |
|--------|-------------|-------------|
| ECE alone | MEDIUM | Predicting base rate in each bin achieves ECE=0 |
| MCE alone | LOW | Worst-case focus, harder to game |
| Overconfidence ratio | HIGH | Can be minimized by always predicting <50% |
| Brier Score | LOW | Proper - optimal at true probability |
| Log Loss | LOW | Strictly proper - unique optimum |

**Assessment**: RISK EXISTS

Without Brier score or log loss, the system incentivizes matching the bin-level accuracy rather than predicting true probabilities. This is a subtle but real gaming risk.

---

## 2. ECE Implementation Review

### 2.1 Standard ECE Formula

The standard ECE formula is:
```
ECE = sum_{b=1}^{B} (n_b / N) * |acc(b) - conf(b)|
```

Where:
- B = number of bins
- n_b = samples in bin b
- N = total samples
- acc(b) = empirical accuracy in bin b
- conf(b) = average stated confidence in bin b

### 2.2 Implementation Correctness

**File**: `/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/LiBrainian/src/epistemics/calibration.ts`

```typescript
// Lines 155-159: Bucket-level calibration error
const calibrationError = Math.abs(statedMean - empiricalAccuracy);
eceSum += bucket.count * calibrationError;

// Lines 172: Final ECE
const ece = totalSamples > 0 ? eceSum / totalSamples : 0;
```

**Assessment**: CORRECT

The ECE computation follows the standard formula exactly:
1. For each bucket, compute |statedMean - empiricalAccuracy|
2. Weight by bucket.count
3. Divide by total samples

### 2.3 Bin Configuration

```typescript
// Lines 88-111: Bucket configuration
const bucketCount = options.bucketCount ?? 10;
const width = (maxConfidence - minConfidence) / bucketCount;
// Equal-width bins: [0, 0.1), [0.1, 0.2), ..., [0.9, 1.0]
```

**Bin Handling**:
- Default: 10 equal-width bins
- Configurable via `bucketCount` option
- Last bin inclusive on upper bound (line 100-102)

**Assessment**: STANDARD APPROACH

Equal-width binning is the most common approach. Limitations are well-documented in literature.

### 2.4 Known ECE Issues (Not Addressed)

| Issue | Status in Implementation | Impact |
|-------|-------------------------|--------|
| **Bin boundary sensitivity** | NOT ADDRESSED | Small changes to bin edges can change ECE significantly |
| **Empty bins** | HANDLED (line 139-149) | Empty bins contribute 0 to ECE |
| **Small sample bins** | NOT ADDRESSED | High variance in small bins inflates ECE uncertainty |
| **Uniform binning bias** | NOT ADDRESSED | Equal-width bins may have very unequal sample counts |

---

## 3. ECE Alternatives Assessment

### 3.1 SmoothECE (Kernel Density Estimation)

**Theory**: Instead of hard bin boundaries, use kernel smoothing to estimate calibration error as a continuous function.

```
SmoothECE = integral_0^1 |accuracy(p) - p| * density(p) dp
```

**Implementation Status**: NOT IMPLEMENTED

**Recommendation**: Consider for future enhancement, especially when sample sizes are moderate (100-1000).

### 3.2 Adaptive Calibration Error (ACE)

**Theory**: Use equal-mass bins instead of equal-width bins. Each bin contains approximately N/B samples.

**Implementation Status**: NOT IMPLEMENTED

**Current Impact**: With unbalanced confidence distributions (many predictions in 0.6-0.9 range), some bins may be nearly empty while others are overcrowded.

### 3.3 Maximum Calibration Error (MCE)

**Theory**: Report the worst-case calibration error across bins.

```
MCE = max_b |acc(b) - conf(b)|
```

**Implementation Status**: IMPLEMENTED CORRECTLY

```typescript
// Line 159
mce = Math.max(mce, calibrationError);
```

**Assessment**: GOOD - MCE is computed and reported alongside ECE.

### 3.4 Reliability Diagrams

**Theory**: Visual representation of calibration curve (accuracy vs. confidence).

**Implementation Status**: PARTIAL

The `CalibrationBucket` structure (lines 13-28) contains all necessary data for plotting:
- `confidenceBucket`: x-axis
- `empiricalAccuracy`: y-axis
- `sampleSize`: for confidence intervals
- `standardError`: for error bars

However, no actual visualization or diagram generation is implemented.

---

## 4. Calibration Adjustment Method Evaluation

### 4.1 Theoretical Background

**Standard Calibration Methods**:

| Method | Approach | When to Use |
|--------|----------|-------------|
| **Platt Scaling** | Logistic regression on logits | Binary classification, small sample |
| **Temperature Scaling** | Single T parameter: p' = softmax(logit(p)/T) | Multi-class, preserves ranking |
| **Isotonic Regression** | Non-parametric monotonic mapping | Large samples, flexible |
| **Beta Calibration** | Beta distribution fitting | Binary, more flexible than Platt |
| **Histogram Binning** | Map to bin-level accuracy | Simple, interpretable |

### 4.2 Current Implementation

**File**: `/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/LiBrainian/src/epistemics/calibration.ts`

```typescript
// Lines 260-290: adjustConfidenceScore function
export function adjustConfidenceScore(
  rawConfidence: number,
  report: CalibrationReport,
  options: CalibrationAdjustmentOptions = {}
): CalibrationAdjustmentResult {
  // ... bucket lookup

  const weight = Math.min(1, bucket.sampleSize / minSamplesForFullWeight);
  const calibrated = clamp(
    bucket.empiricalAccuracy * weight + clamped * (1 - weight),
    clampBounds[0],
    clampBounds[1]
  );

  return { raw: clamped, calibrated, weight, bucket };
}
```

**Method Used**: HISTOGRAM BINNING WITH LINEAR BLENDING

The adjustment method:
1. Find the bucket containing the raw confidence
2. Compute weight based on sample size
3. Blend: `calibrated = empirical * weight + raw * (1 - weight)`

### 4.3 Method Assessment

| Criterion | Assessment | Notes |
|-----------|------------|-------|
| **Simplicity** | GOOD | Easy to understand and debug |
| **Monotonicity** | NOT GUARANTEED | Could violate monotonicity across bins |
| **Sample efficiency** | POOR | Needs many samples per bin |
| **Domain appropriateness** | MODERATE | Reasonable for code claim verification |
| **Theoretical grounding** | WEAK | Not Platt, Temperature, or Isotonic |

**Problem: Monotonicity Violation**

The current method can produce non-monotonic calibrated probabilities. Consider:
- Bin [0.4, 0.5): empirical accuracy 0.6
- Bin [0.5, 0.6): empirical accuracy 0.4

A raw confidence of 0.49 would calibrate to ~0.6, while 0.51 would calibrate to ~0.4. This violates the expected monotonic relationship between stated confidence and calibrated probability.

**Specification vs Implementation Gap**:

The spec (`track-f-calibration.md`) mentions:
- Platt scaling for sparse data (< 100 samples)
- Beta calibration for medium data (100-1000 samples)
- Isotonic regression for well-sampled data (> 1000 samples)

**None of these are implemented.** The current implementation uses only histogram binning with linear blending.

### 4.4 Weight-Based Blending Analysis

```typescript
const weight = Math.min(1, bucket.sampleSize / minSamplesForFullWeight);
const calibrated = bucket.empiricalAccuracy * weight + clamped * (1 - weight);
```

**Default Parameters** (from options):
- `minSamplesForAdjustment`: 3
- `minSamplesForFullWeight`: 20

**Interpretation**:
- 0-2 samples: No adjustment (weight = 0)
- 3 samples: 15% empirical, 85% raw
- 10 samples: 50% empirical, 50% raw
- 20+ samples: 100% empirical

**Assessment**: REASONABLE HEURISTIC

The blending approach is a sensible heuristic for handling uncertainty when sample sizes are small. It degrades gracefully to the raw confidence when data is limited.

**Gap**: The threshold values (3, 20) are arbitrary. No statistical justification is provided.

---

## 5. Cold Start Problem Analysis

### 5.1 Theoretical Framework

The cold start problem in calibration:
1. **Bootstrap paradox**: Cannot calibrate without historical data, but need calibration from the start
2. **Prior selection**: What confidence to use before any calibration data exists?
3. **Transition criteria**: When is there "enough" data to trust calibration?

### 5.2 Current Implementation

**File**: `/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/LiBrainian/src/epistemics/confidence.ts`

```typescript
// Lines 255-260: Uncalibrated confidence
export function uncalibratedConfidence(): AbsentConfidence {
  return {
    type: 'absent',
    reason: 'uncalibrated',
  };
}
```

**File**: `/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/LiBrainian/src/epistemics/calibration.ts`

```typescript
// Lines 267-279: Bucket with insufficient samples
const minSamplesForAdjustment = options.minSamplesForAdjustment ?? 3;
if (bucket.sampleSize < minSamplesForAdjustment) {
  return { raw: clamped, calibrated: clamped, weight: 0, bucket };
}
```

### 5.3 Cold Start Handling Assessment

| Aspect | Implementation | Assessment |
|--------|----------------|------------|
| **No data state** | Returns `absent('uncalibrated')` | GOOD - honest |
| **Insufficient bucket data** | Falls back to raw confidence | GOOD - conservative |
| **Principled prior** | NOT IMPLEMENTED | GAP |
| **Bootstrap mode** | SPECIFIED but NOT IMPLEMENTED | GAP |

**Spec vs Implementation**:

The spec (`track-f-calibration.md`, lines 555-612) specifies a `SystemMode` with three states:
- `bootstrap`: Conservative defaults, maxEffectiveConfidence: 0.6
- `calibrating`: Accumulating data, wider intervals
- `calibrated`: Sufficient data, full calibration

**This is NOT implemented.** The current system only has:
- Absent (no data)
- Partial weight (some data)
- Full weight (enough data per bucket)

### 5.4 Sample Complexity Analysis

**Spec mentions** (lines 473-484):
```typescript
// From PAC learning: m >= (1/2*epsilon^2) * ln(2/delta) for (epsilon, delta)-calibration
function requiredSamplesForCalibration(
  epsilon: number,  // calibration error tolerance
  delta: number     // failure probability
): number {
  return Math.ceil((1 / (2 * epsilon * epsilon)) * Math.log(2 / delta));
}
// Example: for epsilon=0.05, delta=0.05, need m >= 738 samples
```

**Implementation Status**: NOT IMPLEMENTED

The `minSamplesForFullWeight: 20` default is far below the ~738 samples needed for (0.05, 0.05)-calibration according to PAC learning theory.

---

## 6. Integration with ConfidenceValue Type System

### 6.1 Type System Integration

The calibration system integrates with the ConfidenceValue type system (from WU-THEO-001):

```typescript
// confidence.ts lines 301-334
export function adjustConfidenceValue(
  confidence: ConfidenceValue,
  report: CalibrationReport,
  options: CalibrationAdjustmentOptions = {}
): ConfidenceAdjustmentResult {
  // Produces DerivedConfidence from calibration
  const adjusted: ConfidenceValue = {
    type: 'derived',
    value: adjustment.calibrated,
    formula: `calibration_curve:${report.datasetId}`,
    inputs: [{ name: 'raw_confidence', confidence }],
  };
}
```

**Assessment**: GOOD INTEGRATION

Calibrated confidence produces `DerivedConfidence` with:
- Provenance tracing back to raw input
- Formula identifying the calibration dataset
- Explicit relationship to original value

### 6.2 MeasuredConfidence Gap

The spec expects calibration to produce `MeasuredConfidence`:
```typescript
interface MeasuredConfidence {
  readonly type: 'measured';
  readonly value: number;
  readonly measurement: {
    readonly datasetId: string;
    readonly sampleSize: number;
    readonly accuracy: number;
    readonly confidenceInterval: readonly [number, number];
    readonly measuredAt: string;
  };
}
```

**Current Implementation**: Produces `DerivedConfidence` instead of `MeasuredConfidence`.

**Gap**: Calibrated confidences should arguably be `MeasuredConfidence` when based on sufficient empirical data, not `DerivedConfidence`.

---

## 7. Identified Gaps Summary

### 7.1 Critical Gaps (P0)

| Gap | Impact | Recommendation |
|-----|--------|----------------|
| **No Brier Score** | Cannot assess calibration quality properly | Implement immediately |
| **No Log Loss** | Missing information-theoretic assessment | Implement immediately |
| **Non-monotonic adjustment** | Calibrated probabilities can violate ordering | Implement isotonic regression |

### 7.2 High Priority Gaps (P1)

| Gap | Impact | Recommendation |
|-----|--------|----------------|
| **No Platt/Temperature scaling** | Suboptimal for small samples | Implement per spec |
| **No bootstrap mode** | No principled cold-start behavior | Implement SystemMode |
| **Arbitrary thresholds** | 3, 20 sample thresholds unjustified | Derive from PAC bounds |

### 7.3 Medium Priority Gaps (P2)

| Gap | Impact | Recommendation |
|-----|--------|----------------|
| **No SmoothECE** | Bin boundary sensitivity | Consider for robustness |
| **No Adaptive ECE** | Uneven bin sample sizes | Consider for unbalanced data |
| **No Wilson interval for CI** | Inaccurate small-sample CIs | Implement proper intervals |
| **No reliability diagrams** | Missing visualization | Implement for dashboard |

### 7.4 Low Priority Gaps (P3)

| Gap | Impact | Recommendation |
|-----|--------|----------------|
| **No type-stratified calibration** | Single curve for all claim types | Implement per-type curves |
| **No temporal drift detection** | Calibration staleness undetected | Add drift monitoring |
| **No recalibration triggers** | Manual recalibration required | Automate based on thresholds |

---

## 8. Recommended Methodology

### 8.1 Immediate Changes (No Implementation)

1. **Document current limitations** in calibration.ts header
2. **Warn users** that ECE alone is insufficient for quality assessment
3. **Note** that adjustment method is histogram binning, not Platt/isotonic

### 8.2 Near-Term Implementation

```typescript
// Add to CalibrationCurve interface
interface CalibrationCurve {
  buckets: CalibrationBucket[];
  ece: number;
  mce: number;
  brierScore: number;        // ADD: proper scoring
  logLoss: number;           // ADD: proper scoring
  overconfidenceRatio: number;
  sampleSize: number;
}

// Add Brier score computation
function computeBrierScore(samples: CalibrationSample[]): number {
  if (samples.length === 0) return 0;
  const sumSquaredError = samples.reduce(
    (sum, s) => sum + Math.pow(s.confidence - s.outcome, 2),
    0
  );
  return sumSquaredError / samples.length;
}

// Add log loss computation
function computeLogLoss(samples: CalibrationSample[]): number {
  if (samples.length === 0) return 0;
  const epsilon = 1e-15; // Prevent log(0)
  const sumLogLoss = samples.reduce((sum, s) => {
    const p = Math.max(epsilon, Math.min(1 - epsilon, s.confidence));
    const loss = s.outcome === 1
      ? -Math.log(p)
      : -Math.log(1 - p);
    return sum + loss;
  }, 0);
  return sumLogLoss / samples.length;
}
```

### 8.3 Medium-Term Implementation

1. **Isotonic Regression for Adjustment**:
   - Guarantees monotonicity
   - Non-parametric (no distribution assumptions)
   - Standard in scikit-learn, easy to port

2. **Wilson Confidence Intervals**:
   ```typescript
   function wilsonInterval(successes: number, n: number, z: number = 1.96): [number, number] {
     const p = successes / n;
     const denominator = 1 + z*z/n;
     const center = (p + z*z/(2*n)) / denominator;
     const margin = (z / denominator) * Math.sqrt(p*(1-p)/n + z*z/(4*n*n));
     return [Math.max(0, center - margin), Math.min(1, center + margin)];
   }
   ```

3. **Bootstrap Mode Implementation**:
   ```typescript
   type CalibrationMode = 'bootstrap' | 'calibrating' | 'calibrated';

   function determineCalibrationMode(sampleSize: number): CalibrationMode {
     const BOOTSTRAP_THRESHOLD = 30;    // Statistical minimum
     const CALIBRATED_THRESHOLD = 738;  // PAC bound for (0.05, 0.05)

     if (sampleSize < BOOTSTRAP_THRESHOLD) return 'bootstrap';
     if (sampleSize < CALIBRATED_THRESHOLD) return 'calibrating';
     return 'calibrated';
   }
   ```

---

## 9. Priority Rating

| Item | Priority | Effort | Impact | Rationale |
|------|----------|--------|--------|-----------|
| Add Brier Score | P0 | Low | High | Essential for proper scoring |
| Add Log Loss | P0 | Low | High | Essential for information-theoretic assessment |
| Document limitations | P0 | Low | Medium | User awareness |
| Isotonic regression | P1 | Medium | High | Fixes monotonicity violation |
| Bootstrap mode | P1 | Medium | High | Principled cold start |
| Wilson intervals | P1 | Low | Medium | Accurate small-sample CIs |
| PAC-based thresholds | P2 | Low | Medium | Justified sample requirements |
| SmoothECE | P2 | Medium | Low | Robustness improvement |
| Type-stratified calibration | P3 | High | Medium | Domain specificity |

---

## 10. Conclusion

The LiBrainian calibration system has a **correct ECE implementation** but lacks **proper scoring rules** and uses **suboptimal adjustment methods**. The gap between the detailed spec (track-f-calibration.md) and actual implementation is significant.

**Strengths**:
- ECE formula correctly implemented
- MCE computed alongside ECE
- Weight-based blending for small samples
- Good integration with ConfidenceValue type system
- Standard error computed per bucket

**Critical Weaknesses**:
- No Brier score or log loss (proper scoring rules)
- Histogram binning adjustment, not Platt/isotonic (spec mismatch)
- Non-monotonic calibrated probabilities possible
- Bootstrap mode specified but not implemented
- Arbitrary sample thresholds (3, 20) without PAC justification

**Verdict**: The implementation is a **reasonable first version** but requires enhancement before it can claim theoretical soundness. The most urgent need is adding proper scoring rules (Brier, log loss) and replacing histogram binning with isotonic regression to guarantee monotonicity.

---

## References

1. Naeini, M. P., Cooper, G. F., & Hauskrecht, M. (2015). Obtaining Well Calibrated Probabilities Using Bayesian Binning. AAAI.
2. Guo, C., Pleiss, G., Sun, Y., & Weinberger, K. Q. (2017). On Calibration of Modern Neural Networks. ICML.
3. Brier, G. W. (1950). Verification of forecasts expressed in terms of probability. Monthly Weather Review.
4. Platt, J. (1999). Probabilistic Outputs for Support Vector Machines. Advances in Large Margin Classifiers.
5. Zadrozny, B., & Elkan, C. (2002). Transforming classifier scores into accurate multiclass probability estimates. KDD.
6. Nixon, J., Dusenberry, M. W., Zhang, L., Jerfel, G., & Tran, D. (2019). Measuring Calibration in Deep Learning. CVPR Workshops.
7. Kumar, A., Liang, P., & Ma, T. (2019). Verified Uncertainty Calibration. NeurIPS.
8. Wilson, E. B. (1927). Probable Inference, the Law of Succession, and Statistical Inference. JASA.

---

*This audit is research/assessment only. No implementation files were modified.*
