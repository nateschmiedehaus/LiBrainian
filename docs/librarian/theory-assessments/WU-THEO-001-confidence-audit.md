# WU-THEO-001: ConfidenceValue Theoretical Audit

**Work Unit**: WU-THEO-001
**Date**: 2026-01-27
**Auditor**: Claude Opus 4.5
**Status**: Complete
**Priority**: HIGH - Foundation for all epistemic operations

---

## Executive Summary

The LiBrainian ConfidenceValue type system represents a **principled departure from arbitrary confidence scores** toward a provenance-based epistemic framework. The implementation is theoretically sound in its core design, with the five confidence types (`deterministic`, `derived`, `measured`, `bounded`, `absent`) mapping well to established epistemological categories. However, there are gaps in calibration theory alignment and composition soundness that warrant attention.

**Overall Assessment**: SOUND with GAPS

| Category | Rating | Notes |
|----------|--------|-------|
| Theoretical Grounding | STRONG | Well-founded in epistemology |
| Derivation Rules D1-D6 | SOUND | Mathematically valid under independence |
| Calibration Alignment | PARTIAL | Missing proper scoring rule integration |
| Composition Soundness | MIXED | Valid for independent events only |
| Completeness | ADEQUATE | Some scenarios unaddressed |

---

## 1. Theoretical Grounding Assessment

### 1.1 DeterministicConfidence

**Definition** (confidence.ts:43-47):
```typescript
interface DeterministicConfidence {
  readonly type: 'deterministic';
  readonly value: 1.0 | 0.0;
  readonly reason: string;
}
```

**Theoretical Basis**: STRONG

This corresponds to **logical certainty** in classical epistemology. The restriction to exactly 1.0 or 0.0 reflects Frege's principle of bivalence for decidable propositions. For syntactic operations like AST parsing, file existence, and exact string matching, outcomes are indeed binary and deterministic.

**Alignment with Theory**:
- **Kolmogorov Axioms**: P(certain event) = 1, P(impossible event) = 0
- **Propositional Logic**: Decidable predicates have definite truth values
- **Type Theory**: Corresponds to Unit (true) and Void (false) types

**Gap Identified**: None for the intended use case. However, the system correctly identifies that "deterministic" applies to the *operation*, not necessarily the *claim*. A parse succeeding deterministically does not mean the parsed content is semantically correct.

### 1.2 MeasuredConfidence

**Definition** (confidence.ts:71-81):
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

**Theoretical Basis**: STRONG

This aligns with **frequentist probability** - confidence as the long-run accuracy of a process. The mandatory measurement metadata enforces that values come from empirical calibration rather than intuition.

**Alignment with Calibration Theory**:
- Requires actual outcome data (not assumed priors)
- Tracks sample size for statistical validity
- Records 95% confidence interval (standard in frequentist statistics)
- Timestamps enable recalibration detection

**Gap Identified**:
1. **No proper scoring rule metadata**: The implementation does not track Brier score or log loss alongside accuracy. These metrics are essential for assessing calibration quality beyond simple accuracy.
2. **Confidence interval method unspecified**: The 95% CI is stored but the computation method (Wilson, Clopper-Pearson, normal approximation) is not specified, which matters for small samples.

### 1.3 DerivedConfidence

**Definition** (confidence.ts:57-62):
```typescript
interface DerivedConfidence {
  readonly type: 'derived';
  readonly value: number;
  readonly formula: string;
  readonly inputs: ReadonlyArray<{ name: string; confidence: ConfidenceValue }>;
}
```

**Theoretical Basis**: SOUND with CAVEATS

This corresponds to **probability propagation** in Bayesian networks. The key theoretical question is whether the propagation rules preserve calibration.

**Alignment with Probability Theory**:
- **Chain Rule**: P(A and B) = P(A) * P(B|A)
- **Independence**: P(A and B) = P(A) * P(B) when independent
- **Weakest Link**: P(all steps succeed) >= min(step probabilities) is a *lower bound*, not exact

**Gap Identified**:
1. **Independence assumption implicit**: The product rule (D3) and complement rule (D4) assume independent events. Real pipeline steps often have correlated failures (e.g., if parsing fails, extraction also fails).
2. **Formula as string**: The `formula` field is a string, preventing type-safe verification of propagation rules.

### 1.4 BoundedConfidence

**Definition** (confidence.ts:90-96):
```typescript
interface BoundedConfidence {
  readonly type: 'bounded';
  readonly low: number;
  readonly high: number;
  readonly basis: 'theoretical' | 'literature' | 'formal_analysis';
  readonly citation: string;
}
```

**Theoretical Basis**: STRONG

This corresponds to **interval probability** (Dempster-Shafer theory) or **imprecise probabilities** (Walley). It honestly represents uncertainty about the probability itself.

**Alignment with Theory**:
- **Dempster-Shafer**: Lower probability (belief) and upper probability (plausibility)
- **Robust Bayesianism**: Sets of priors when a single prior is not justified
- **PAC Learning**: Probably Approximately Correct bounds from learning theory

**Gap Identified**:
1. **No distribution assumption**: Bounded ranges could represent uniform uncertainty, or concentration toward the midpoint. The midpoint heuristic in `getNumericValue` (line 350) assumes uniform, which may not be appropriate.
2. **Citation enforcement is weak**: The `citation` field is a free-form string with no validation.

### 1.5 AbsentConfidence

**Definition** (confidence.ts:106-109):
```typescript
interface AbsentConfidence {
  readonly type: 'absent';
  readonly reason: 'uncalibrated' | 'insufficient_data' | 'not_applicable';
}
```

**Theoretical Basis**: STRONG

This is the **most epistemically honest** type and represents a significant improvement over arbitrary placeholders. It aligns with:

**Alignment with Bayesian Theory**:
- **Cromwell's Rule**: Never assign probability 0 or 1 to uncertain events
- **Principle of Indifference**: When truly ignorant, do not pretend knowledge
- **Maximum Entropy**: Absent information should not bias decisions

**Bayesian Treatment of "Absent"**:
In strict Bayesianism, there is no "absent" probability - one always has a prior. However, the three reasons map to valid epistemic states:

| Reason | Bayesian Interpretation |
|--------|------------------------|
| `uncalibrated` | Prior exists but not validated against likelihood |
| `insufficient_data` | Posterior has high variance, effectively uninformative |
| `not_applicable` | Event space is undefined (category error) |

**Gap Identified**:
1. **Missing "prior_only" state**: There's a legitimate intermediate state between "absent" and "measured" - having a principled prior (from theory or literature) that hasn't been updated with local data. This is currently forced into `bounded` but semantically distinct.

---

## 2. Derivation Rules Assessment (D1-D6)

### D1: Syntactic Operations -> Deterministic

**Implementation** (confidence.ts:156-162):
```typescript
function syntacticConfidence(success: boolean): DeterministicConfidence {
  return {
    type: 'deterministic',
    value: success ? 1.0 : 0.0,
    reason: success ? 'operation_succeeded' : 'operation_failed',
  };
}
```

**Assessment**: SOUND

This is correct. Syntactic operations (parsing, regex matching, file I/O) have deterministic outcomes. The operation either succeeds or fails with certainty.

### D2: Sequential Composition -> min(steps)

**Implementation** (confidence.ts:169-191):
```typescript
function sequenceConfidence(steps: ConfidenceValue[]): ConfidenceValue {
  // ...
  const minValue = Math.min(...(values.filter((v): v is number => v !== null)));
  return {
    type: 'derived',
    value: minValue,
    formula: 'min(steps)',
    inputs: steps.map((s, i) => ({ name: `step_${i}`, confidence: s })),
  };
}
```

**Assessment**: CONSERVATIVE APPROXIMATION

**Mathematical Analysis**:
- For a sequential pipeline where all steps must succeed:
- P(all succeed) = P(step1) * P(step2|step1) * P(step3|step1,step2) * ...
- Under independence: P(all) = product(steps)
- min(steps) is a *lower bound* when failures are positively correlated

**Justification**: Using `min` is **conservative** - it never overestimates. If step2 always fails when step1 fails (perfect correlation), then P(all) = min. If steps are independent, `product` would be more accurate.

**Gap**: The choice of `min` vs `product` should ideally depend on the correlation structure of failures. The current implementation assumes worst-case (perfect positive correlation).

### D3: Parallel-All Composition -> product(branches)

**Implementation** (confidence.ts:198-219):
```typescript
function parallelAllConfidence(branches: ConfidenceValue[]): ConfidenceValue {
  const product = (values.filter((v): v is number => v !== null)).reduce((a, b) => a * b, 1);
  return {
    type: 'derived',
    value: product,
    formula: 'product(branches)',
    inputs: branches.map((b, i) => ({ name: `branch_${i}`, confidence: b })),
  };
}
```

**Assessment**: CORRECT UNDER INDEPENDENCE

**Mathematical Analysis**:
- P(A AND B) = P(A) * P(B) when A and B are independent
- This is the standard probabilistic AND

**Gap**: Independence is assumed but not verified. If branches share common failure modes (e.g., same LLM provider, same codebase), independence is violated and the product underestimates failure probability.

### D4: Parallel-Any Composition -> 1 - product(1 - branches)

**Implementation** (confidence.ts:226-248):
```typescript
function parallelAnyConfidence(branches: ConfidenceValue[]): ConfidenceValue {
  const failureProduct = validValues.map((v) => 1 - v).reduce((a, b) => a * b, 1);
  return {
    type: 'derived',
    value: 1 - failureProduct,
    formula: '1 - product(1 - branches)',
    inputs: branches.map((b, i) => ({ name: `branch_${i}`, confidence: b })),
  };
}
```

**Assessment**: CORRECT UNDER INDEPENDENCE

**Mathematical Analysis**:
- P(A OR B) = 1 - P(not A AND not B)
- Under independence: P(A OR B) = 1 - (1-P(A)) * (1-P(B))
- This is the inclusion-exclusion principle simplified for independence

**Gap**: Same independence assumption as D3.

### D5: LLM Operations Before Calibration -> Absent

**Implementation** (confidence.ts:255-259):
```typescript
function uncalibratedConfidence(): AbsentConfidence {
  return {
    type: 'absent',
    reason: 'uncalibrated',
  };
}
```

**Assessment**: EPISTEMICALLY CORRECT

This is the most important rule. It enforces honesty: no pretending to know what we don't know.

### D6: LLM Operations After Calibration -> Measured

**Implementation** (confidence.ts:274-286):
```typescript
function measuredConfidence(data: CalibrationResult): MeasuredConfidence {
  return {
    type: 'measured',
    value: data.accuracy,
    measurement: {
      datasetId: data.datasetId,
      sampleSize: data.sampleSize,
      accuracy: data.accuracy,
      confidenceInterval: data.ci95,
      measuredAt: new Date().toISOString(),
    },
  };
}
```

**Assessment**: SOUND

This correctly requires actual calibration data before claiming measured confidence.

---

## 3. Calibration Theory Alignment

### 3.1 Proper Scoring Rules

**Theoretical Background**:
A **proper scoring rule** incentivizes honest probability reporting. The two main proper scoring rules are:

1. **Brier Score**: BS = (1/n) * sum((predicted - actual)^2)
   - Lower is better
   - Penalizes confident wrong predictions heavily

2. **Log Loss**: LL = -(1/n) * sum(actual * log(predicted) + (1-actual) * log(1-predicted))
   - Lower is better
   - Unbounded penalty for extreme confidence in wrong direction

**Current Implementation** (calibration.ts:85-182):
The calibration module computes:
- Expected Calibration Error (ECE)
- Maximum Calibration Error (MCE)
- Overconfidence ratio

**Assessment**: PARTIAL ALIGNMENT

ECE and MCE measure calibration error but are **not proper scoring rules**. They measure how well confidence tracks accuracy on average, but do not penalize resolution (the ability to discriminate between correct and incorrect predictions).

**Gap**: The implementation should compute:
1. **Brier Score** for calibration quality
2. **Log Loss** for information-theoretic assessment
3. **Reliability diagrams** are mentioned in track-f-calibration.md but not implemented in calibration.ts

### 3.2 Confidence Interval Calculation

**Current Implementation** (calibration.ts:151-156):
```typescript
const variance = Math.max(0, meanSquare - empiricalAccuracy * empiricalAccuracy);
const standardError = Math.sqrt(variance / bucket.count);
```

**Assessment**: STATISTICALLY VALID but INCOMPLETE

This computes the standard error correctly for a binomial proportion using the sample variance estimator. However:

**Gap**:
1. **No CI method specified**: The MeasuredConfidence type stores a 95% CI but the computation in calibration.ts only provides standard error. The CI should be explicitly computed (Wilson interval recommended for small samples).
2. **No small-sample adjustment**: For buckets with < 20 samples, the normal approximation is unreliable.

### 3.3 Calibration Preservation Under Derivation

**Theoretical Question**: If input confidences are well-calibrated, is derived confidence also well-calibrated?

**Answer**: NOT NECESSARILY

**Analysis**:
1. **Deterministic inputs**: Trivially preserved (1.0 or 0.0)
2. **min(steps)**: Conservative - if all inputs are calibrated, min is a valid lower bound
3. **product(branches)**: Only calibrated under independence. Correlated inputs break calibration.
4. **Weighted average**: Preserves calibration if weights are fixed (not data-dependent)

**Gap**: The system does not track or verify the calibration status of derived confidences. A derived value from measured inputs could be labeled as "derived" but whether it's calibrated depends on the correlation structure.

---

## 4. Completeness Assessment

### 4.1 Handled Scenarios

| Scenario | Type Used | Assessment |
|----------|-----------|------------|
| Parse success/failure | Deterministic | Correct |
| LLM output before calibration | Absent | Correct |
| LLM output after calibration | Measured | Correct |
| Pipeline composition | Derived | Correct under assumptions |
| Literature-based bounds | Bounded | Correct |
| Aggregated confidences | Derived (weighted) | Correct |
| Temporal decay | Derived (decay formula) | Correct |

### 4.2 Missing Scenarios

| Scenario | Current Handling | Recommended Type |
|----------|-----------------|------------------|
| Expert elicited probability | Forced into Bounded | **New: ExpertConfidence** |
| Ensemble model aggregation | Derived (avg) | **New: EnsembleConfidence** |
| Adversarial evaluation | Bounded | **New: AdversarialConfidence** |
| Prior-only (Bayesian prior, no data) | Bounded or Absent | **New: PriorConfidence** |
| Contextual/conditional confidence | Not supported | **Enhancement needed** |

**Recommendation**: Consider adding:

```typescript
// Expert elicitation with explicit methodology
interface ExpertConfidence {
  type: 'expert';
  value: number;
  elicitation: {
    method: 'SEED' | 'Delphi' | 'structured_interview';
    expertCount: number;
    aggregation: 'geometric_mean' | 'median' | 'linear_pool';
    calibrationScore?: number; // Expert's historical calibration
  };
}

// Ensemble of models
interface EnsembleConfidence {
  type: 'ensemble';
  value: number;
  ensemble: {
    modelCount: number;
    method: 'voting' | 'stacking' | 'bayesian_model_averaging';
    diversity: number; // Measure of model disagreement
    components: Array<{ modelId: string; weight: number; confidence: ConfidenceValue }>;
  };
}
```

---

## 5. Composition Soundness

### 5.1 Pipeline Propagation

**Implementation** (confidence.ts:549-580):
```typescript
function combinedConfidence(
  inputs: Array<{ confidence: ConfidenceValue; weight: number; name: string }>
): ConfidenceValue {
  // ... weighted average implementation
}
```

**Mathematical Validity**: CONDITIONAL

Weighted averaging is **not a proper Bayesian update** but it is a reasonable heuristic when:
1. Inputs are conditionally independent given the true state
2. Weights reflect reliability or sample size

**Gap**: The weights are user-specified with no validation that they sum to 1 or reflect actual reliability.

### 5.2 min/product/weighted Formulas

| Formula | When Valid | When Invalid |
|---------|-----------|--------------|
| min | Conservative lower bound always | Never overestimates, may underestimate |
| product | Independent events | Correlated events (common in pipelines) |
| weighted_average | Reliability-weighted opinions | When weights don't reflect reliability |

**Gap**: The implementation provides no guidance on which formula to use when. This is a documentation issue rather than an implementation bug.

### 5.3 Decay Propagation

**Implementation** (confidence.ts:587-616):
```typescript
function applyDecay(
  confidence: ConfidenceValue,
  ageMs: number,
  halfLifeMs: number
): ConfidenceValue {
  const decayFactor = Math.pow(0.5, ageMs / halfLifeMs);
  const decayedValue = currentValue * decayFactor;
  // ...
}
```

**Assessment**: MATHEMATICALLY SOUND

Exponential decay with half-life is a principled model for information staleness. The formula:
- decay(t) = original * 0.5^(t/halflife)
- Is monotonically decreasing
- Preserves ordering (higher confidence stays higher)
- Has interpretable parameter (halflife)

**Gap**: The half-life should ideally be empirically determined from outcome data, not arbitrarily chosen.

---

## 6. Identified Gaps Summary

### 6.1 High Priority

| Gap | Impact | Recommendation |
|-----|--------|----------------|
| No Brier score tracking | Cannot assess calibration quality | Add to MeasuredConfidence metadata |
| Independence assumption unstated | Misleading derived confidences | Document assumptions; add correlation param |
| Missing CI computation | Incomplete MeasuredConfidence | Implement Wilson interval |

### 6.2 Medium Priority

| Gap | Impact | Recommendation |
|-----|--------|----------------|
| BoundedConfidence midpoint heuristic | May misrepresent uncertainty | Allow distribution parameter |
| No "prior only" confidence type | Forces misuse of Bounded/Absent | Consider adding ExpertConfidence |
| Formula as string | Cannot type-check propagation | Consider formula ADT |
| Calibration preservation not tracked | Derived from calibrated != calibrated | Add calibration status to Derived |

### 6.3 Low Priority

| Gap | Impact | Recommendation |
|-----|--------|----------------|
| No ensemble confidence type | Limits multi-model scenarios | Add EnsembleConfidence |
| Weight validation missing | User error potential | Add weight normalization |
| Decay half-life not empirical | Suboptimal staleness model | Learn half-life from data |

---

## 7. Recommended Changes

### 7.1 Immediate (No Implementation Change)

1. **Document independence assumptions** in EPISTEMIC_PRIMITIVES_PATTERNS.md
2. **Add calibration quality metrics** to MeasuredConfidence documentation
3. **Clarify formula selection guidelines** for DerivedConfidence

### 7.2 Near-Term (Minor Implementation)

1. **Add Brier score to calibration module**:
```typescript
interface CalibrationReport {
  // ... existing fields
  brierScore: number;
  logLoss: number;
}
```

2. **Implement Wilson interval for CI**:
```typescript
function wilsonInterval(successes: number, n: number, z: number = 1.96): [number, number] {
  const p = successes / n;
  const denominator = 1 + z*z/n;
  const center = (p + z*z/(2*n)) / denominator;
  const margin = (z / denominator) * Math.sqrt(p*(1-p)/n + z*z/(4*n*n));
  return [center - margin, center + margin];
}
```

3. **Add calibration status to DerivedConfidence**:
```typescript
interface DerivedConfidence {
  // ... existing fields
  calibrationStatus?: 'calibrated' | 'partially_calibrated' | 'uncalibrated';
}
```

### 7.3 Future (Requires Design Discussion)

1. **Consider typed formula representation**:
```typescript
type ConfidenceFormula =
  | { op: 'min'; inputs: string[] }
  | { op: 'product'; inputs: string[] }
  | { op: 'weighted_sum'; inputs: Array<{ name: string; weight: number }> }
  | { op: 'decay'; input: string; halfLifeMs: number };
```

2. **Consider ExpertConfidence type** for principled prior specification

3. **Consider correlation parameter** for composed confidences:
```typescript
interface CompositionParams {
  correlation?: number; // -1 to 1, default 0 (independence)
}
```

---

## 8. Priority Rating

| Change | Priority | Effort | Impact |
|--------|----------|--------|--------|
| Document independence assumptions | P0 | Low | High |
| Add Brier score to calibration | P1 | Low | Medium |
| Implement Wilson interval | P1 | Low | Medium |
| Add calibration status to Derived | P2 | Medium | Medium |
| Typed formula representation | P3 | High | Low |
| ExpertConfidence type | P3 | Medium | Low |
| Correlation parameter | P3 | High | Medium |

---

## 9. Conclusion

The ConfidenceValue type system is **theoretically well-grounded** and represents a significant improvement over arbitrary numeric confidence. The five types map cleanly to established epistemological categories, and the derivation rules are mathematically sound under their assumptions.

**Strengths**:
- Eliminates "documentation theater" of labeled arbitrary values
- Forces honest representation of uncertainty (AbsentConfidence)
- Maintains full provenance chain
- Correct handling of deterministic operations

**Areas for Improvement**:
- Proper scoring rule metrics (Brier, log loss) not yet integrated
- Independence assumptions should be documented and optionally parameterized
- Calibration preservation through derivation is not tracked

The system achieves its stated goal of "no arbitrary numbers" and provides a solid foundation for epistemic operations in AI systems.

---

## References

1. Guo, C., Pleiss, G., Sun, Y., & Weinberger, K. Q. (2017). On Calibration of Modern Neural Networks. ICML.
2. Brier, G. W. (1950). Verification of forecasts expressed in terms of probability. Monthly Weather Review.
3. Walley, P. (1991). Statistical Reasoning with Imprecise Probabilities. Chapman and Hall.
4. Dempster, A. P. (1968). A generalization of Bayesian inference. Journal of the Royal Statistical Society.
5. Naeini, M. P., Cooper, G. F., & Hauskrecht, M. (2015). Obtaining Well Calibrated Probabilities Using Bayesian Binning. AAAI.
6. Pearl, J. (1988). Probabilistic Reasoning in Intelligent Systems. Morgan Kaufmann.

---

*This audit is research/assessment only. No implementation files were modified.*
