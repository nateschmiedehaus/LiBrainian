# WU-THEO-007: Primitive Composition Semantics Assessment

**Work Unit**: WU-THEO-007
**Date**: 2026-01-27
**Auditor**: Claude Opus 4.5
**Status**: Complete
**Priority**: HIGH - Composition is fundamental to pipeline correctness

---

## Executive Summary

The LiBrainian confidence composition system implements a pragmatic approach to confidence propagation using derivation rules D1-D6. The system forms a **partial algebraic structure** with some desirable properties (identity elements, associativity for certain operations) but lacks a complete, closed algebra. The independence assumptions underlying product-based rules (D3, D4) are the primary theoretical concern, as they may lead to miscalibrated outputs when composing correlated primitives.

**Overall Assessment**: SOUND BUT INCOMPLETE

| Category | Rating | Notes |
|----------|--------|-------|
| Algebraic Coherence | PARTIAL | Forms pseudo-semiring with gaps |
| Formula Justification | CONSERVATIVE | min() is safe; product() assumes independence |
| Edge Case Handling | GOOD | AbsentConfidence propagation well-defined |
| Calibration Preservation | CONDITIONAL | Only under independence |
| Completeness | ADEQUATE | Common patterns covered |

---

## 1. Algebraic Structure Analysis

### 1.1 Confidence Value Domain

The confidence system operates over the domain `C = [0, 1] union {absent}` where:
- `[0, 1]` represents numeric confidence values
- `absent` represents unknown/inapplicable confidence (a special sentinel)

**Observation**: This is not a standard numeric domain. The inclusion of `absent` requires special handling for all operations.

### 1.2 Available Operations

The system provides the following composition operations:

| Operation | Symbol | Implementation | Domain |
|-----------|--------|----------------|--------|
| Sequential min | `min` | `sequenceConfidence()` | C^n -> C |
| Parallel-all product | `*` | `parallelAllConfidence()` | C^n -> C |
| Parallel-any complement | `1-prod(1-x)` | `parallelAnyConfidence()` | C^n -> C |
| Weighted average | `weighted_avg` | `combinedConfidence()` | C^n -> C |
| Binary AND (min) | `and` | `andConfidence()` | C x C -> C |
| Binary OR (max) | `or` | `orConfidence()` | C x C -> C |
| Temporal decay | `decay` | `applyDecay()` | C x R+ x R+ -> C |

### 1.3 Algebraic Properties Assessment

#### 1.3.1 Associativity

**min operation**: `min(min(a, b), c) = min(a, min(b, c))` **HOLDS**

```
Proof: min is associative over [0,1] by standard real number properties.
With absent: If any input is absent, result is absent, which is idempotent.
```

**product operation**: `(a * b) * c = a * (b * c)` **HOLDS**

```
Proof: Multiplication is associative over [0,1].
With absent: Propagates absent transitively.
```

**OR operation (max)**: `max(max(a, b), c) = max(a, max(b, c))` **HOLDS**

```
Proof: max is associative over [0,1].
With absent: Handled asymmetrically - present values are preserved.
```

**weighted_average**: **NOT ASSOCIATIVE**

```
Counter-example:
Let a=0.8, b=0.6, c=0.4 with equal weights.
weighted_avg(weighted_avg(a, b), c) = weighted_avg(0.7, 0.4) = 0.55
weighted_avg(a, weighted_avg(b, c)) = weighted_avg(0.8, 0.5) = 0.65
```

**Assessment**: Most binary operations are associative; weighted_average is not.

#### 1.3.2 Commutativity

| Operation | Commutative? | Notes |
|-----------|--------------|-------|
| min | YES | `min(a,b) = min(b,a)` |
| product | YES | `a*b = b*a` |
| max | YES | `max(a,b) = max(b,a)` |
| weighted_avg | CONDITIONAL | Only with equal weights |

**Assessment**: Core operations are commutative, which is correct for confidence composition (order of evaluation should not matter).

#### 1.3.3 Identity Elements

| Operation | Identity | Verification |
|-----------|----------|--------------|
| min | 1.0 | `min(a, 1.0) = a` |
| product | 1.0 | `a * 1.0 = a` |
| max | 0.0 | `max(a, 0.0) = a` |
| weighted_avg | N/A | No identity exists |

**Code Reference** (`confidence.ts:156-162`):
```typescript
export function syntacticConfidence(success: boolean): DeterministicConfidence {
  return {
    type: 'deterministic',
    value: success ? 1.0 : 0.0,
    reason: success ? 'operation_succeeded' : 'operation_failed',
  };
}
```

**Assessment**: Deterministic confidence (1.0) serves as the identity for min and product, which aligns with the intuition that a certainly-true step does not degrade pipeline confidence.

#### 1.3.4 Idempotence

| Operation | Idempotent? | Formula |
|-----------|-------------|---------|
| min | YES | `min(a, a) = a` |
| max | YES | `max(a, a) = a` |
| product | NO | `a * a = a^2 != a` (except for 0, 1) |
| weighted_avg | NO | Generally not |

**Observation**: Idempotence of min/max is useful for memoization - re-composing the same confidence does not change the result.

#### 1.3.5 Annihilator Elements

| Operation | Annihilator | Verification |
|-----------|-------------|--------------|
| min | 0.0 | `min(a, 0.0) = 0.0` |
| product | 0.0 | `a * 0.0 = 0.0` |
| max | 1.0 | `max(a, 1.0) = 1.0` |
| parallel-any | 1.0 | If any branch has confidence 1.0, result is 1.0 |

**Code Reference** (`confidence.ts:226-248`):
```typescript
export function parallelAnyConfidence(branches: ConfidenceValue[]): ConfidenceValue {
  // ...
  const failureProduct = validValues.map((v) => 1 - v).reduce((a, b) => a * b, 1);
  return {
    type: 'derived',
    value: 1 - failureProduct,
    // ...
  };
}
```

**Assessment**: Annihilator behavior is correct - a definitely-failed step (`0.0`) zeroes out sequential composition.

### 1.4 Algebraic Structure Classification

The confidence composition system forms:

1. **([0,1], min, 1.0)**: A commutative monoid (associative, identity exists)
2. **([0,1], product, 1.0)**: A commutative monoid
3. **([0,1], max, 0.0)**: A commutative monoid

Together, **(([0,1], min, 1.0), ([0,1], product, 1.0))** approximates a **semiring structure** where:
- min acts as "addition" (with identity 1.0, not 0 - unusual)
- product acts as "multiplication"

**However**, this is NOT a true semiring because:
- The "additive" identity (1.0 for min) is the same as the "multiplicative" identity (1.0 for product)
- There is no "additive" annihilator that is a "multiplicative" identity

**Closest Classification**: The structure is a **bounded lattice with multiplication**, also known as an **integral semiring** with the order relation defined by min/max.

### 1.5 Absent Confidence as Bottom Element

The handling of `AbsentConfidence` defines a **partial order** on the type hierarchy:

```
absent < bounded < measured/derived < deterministic
       (least information)    (most information)
```

**Code Reference** (`confidence.ts:169-191`):
```typescript
export function sequenceConfidence(steps: ConfidenceValue[]): ConfidenceValue {
  // ...
  const values = steps.map(getNumericValue);
  if (values.some((v) => v === null)) {
    return {
      type: 'absent',
      reason: 'uncalibrated',
    };
  }
  // ...
}
```

**Assessment**: `absent` propagates "strictly" - any absent input produces absent output. This is **epistemically conservative** but may be overly strict in some contexts. An alternative would be to treat absent as a "don't care" or use the remaining inputs.

---

## 2. Formula Justification Assessment

### 2.1 D2: Sequential Composition -> min(steps)

**Implementation Choice**: `min`
**Mathematical Justification**: Lower bound for dependent events

**Analysis**:

For a sequential pipeline where step B depends on step A:
- P(A AND B) = P(A) * P(B|A)
- If B always fails when A fails: P(B|A_fail) = 0, so P(A AND B) = P(A)
- If B's success is independent of A: P(A AND B) = P(A) * P(B)

The `min` formula assumes **worst-case correlation**: if A fails, B also fails. This gives:
- P(A AND B) >= min(P(A), P(B))

**Validity**: `min` is a **conservative lower bound**. It never overestimates pipeline confidence, which is desirable for safety-critical applications.

**Gap**: The formula does not distinguish between:
1. Perfectly correlated steps (min is exact)
2. Independent steps (product is exact)
3. Anti-correlated steps (could be higher than min)

**Recommendation**: Consider adding an optional `correlation` parameter:
```typescript
function sequenceConfidence(
  steps: ConfidenceValue[],
  options?: { correlation?: 'correlated' | 'independent' | number }
): ConfidenceValue
```

### 2.2 D3: Parallel-All Composition -> product(branches)

**Implementation Choice**: `product`
**Mathematical Justification**: Independence assumption

**Code Reference** (`confidence.ts:198-219`):
```typescript
export function parallelAllConfidence(branches: ConfidenceValue[]): ConfidenceValue {
  // ...
  const product = (values.filter((v): v is number => v !== null)).reduce((a, b) => a * b, 1);
  // ...
}
```

**Analysis**:

For parallel branches that ALL must succeed:
- P(A AND B AND C) = P(A) * P(B|A) * P(C|A,B)
- Under independence: P(A AND B AND C) = P(A) * P(B) * P(C)

**Validity**: `product` is **exact only under independence**.

**Risk Assessment**:

| Correlation | Product Estimate | True Value | Error Direction |
|-------------|------------------|------------|-----------------|
| Positive | Too low | Higher | Underestimate |
| Zero | Exact | Same | None |
| Negative | Too high | Lower | Overestimate |

In software systems, branches often share:
- Same LLM provider (common failure mode)
- Same codebase (correlated complexity)
- Same execution environment

This suggests **positive correlation** is common, meaning `product` **underestimates** true success probability.

**Gap**: Independence assumption is not documented in the code or user-facing API.

### 2.3 D4: Parallel-Any Composition -> 1 - product(1 - branches)

**Implementation Choice**: Noisy-OR / inclusion-exclusion
**Mathematical Justification**: Independence assumption

**Code Reference** (`confidence.ts:226-248`):
```typescript
const failureProduct = validValues.map((v) => 1 - v).reduce((a, b) => a * b, 1);
return {
  type: 'derived',
  value: 1 - failureProduct,
  formula: '1 - product(1 - branches)',
  // ...
};
```

**Analysis**:

This is the classic **Noisy-OR** model from Bayesian networks:
- P(success) = 1 - P(all fail) = 1 - prod(P(each fails)) = 1 - prod(1 - p_i)

**Validity**: Correct under independence. With positive correlation between failure modes, this **overestimates** success probability.

**Example**:
- Branch A: 0.8 confidence
- Branch B: 0.8 confidence (uses same provider as A)
- Independent model: 1 - (0.2 * 0.2) = 0.96
- Correlated reality: If A fails, B likely fails too, so true confidence might be ~0.85

### 2.4 Weighted Average

**Implementation Choice**: Weighted arithmetic mean
**Mathematical Justification**: Linear opinion pooling

**Code Reference** (`confidence.ts:549-580`):
```typescript
export function combinedConfidence(
  inputs: Array<{ confidence: ConfidenceValue; weight: number; name: string }>
): ConfidenceValue {
  // ...
  const weightedValue = presentInputs.reduce((sum, i) => {
    const value = getNumericValue(i.confidence);
    return sum + (value ?? 0) * i.weight;
  }, 0) / totalWeight;
  // ...
}
```

**Analysis**:

Weighted averaging is **not a probabilistic operation** - it's a heuristic for combining opinions. It's appropriate when:
- Inputs represent independent estimates of the same quantity
- Weights reflect reliability or sample size

**Validity**: Reasonable heuristic but not mathematically grounded in probability theory.

**Gap**: Weights are not validated to be positive or sum to 1 (though the implementation normalizes).

### 2.5 Temporal Decay

**Implementation Choice**: Exponential decay with half-life
**Mathematical Justification**: Information staleness model

**Code Reference** (`confidence.ts:587-616`):
```typescript
export function applyDecay(
  confidence: ConfidenceValue,
  ageMs: number,
  halfLifeMs: number
): ConfidenceValue {
  // ...
  const decayFactor = Math.pow(0.5, ageMs / halfLifeMs);
  const decayedValue = currentValue * decayFactor;
  // ...
}
```

**Analysis**:

Exponential decay assumes:
- Confidence degrades continuously over time
- The rate of degradation is proportional to current confidence
- Half-life is constant regardless of initial confidence

**Validity**: Mathematically consistent. Whether the half-life is appropriate depends on the domain (code changes faster than documentation).

---

## 3. Edge Case Handling Evaluation

### 3.1 Composing with AbsentConfidence

**Current Behavior**: Any absent input produces absent output

**Code Reference** (`confidence.ts:169-191`):
```typescript
if (values.some((v) => v === null)) {
  return {
    type: 'absent',
    reason: 'uncalibrated',
  };
}
```

**Assessment**: This is **strict propagation** - the system refuses to produce a numeric confidence when any input is unknown.

**Alternatives Considered**:

| Strategy | Behavior | Pros | Cons |
|----------|----------|------|------|
| Strict (current) | absent -> absent | Honest, safe | May block useful work |
| Skip absent | Use remaining inputs | More permissive | May overestimate confidence |
| Default value | Treat absent as 0.5 | Always produces output | Hides uncertainty |
| Pessimistic | Treat absent as 0.0 | Very conservative | May be too harsh |

**Recommendation**: The current strict approach is appropriate for the system's epistemic honesty goals.

### 3.2 Bounded + Measured Composition

**Question**: What happens when composing `BoundedConfidence` with `MeasuredConfidence`?

**Current Behavior** (`confidence.ts:343-354`):
```typescript
export function getNumericValue(conf: ConfidenceValue): number | null {
  switch (conf.type) {
    // ...
    case 'bounded':
      return (conf.low + conf.high) / 2; // Use midpoint
    // ...
  }
}
```

**Assessment**: Bounded confidence is **collapsed to its midpoint** for composition. This is a reasonable default but:

**Gap**: The uncertainty represented by the range [low, high] is lost in composition. A `BoundedConfidence(0.2, 0.8)` (high uncertainty) is treated identically to `MeasuredConfidence(0.5)` (precise estimate).

**Recommendation**: Consider **interval arithmetic** for bounded composition:
```
min([a, b], [c, d]) = [min(a, c), min(b, d)]
```

This would preserve uncertainty through the composition chain.

### 3.3 Empty Input Arrays

**Current Behavior** (`confidence.ts:169-171`):
```typescript
if (steps.length === 0) {
  return { type: 'absent', reason: 'insufficient_data' };
}
```

**Assessment**: CORRECT. An empty sequence has no meaningful confidence.

### 3.4 Deterministic + Non-Deterministic Composition

**Question**: Does composing with `DeterministicConfidence(1.0)` preserve the other confidence?

**min case**: `min(1.0, 0.7) = 0.7` - YES, identity behavior
**product case**: `1.0 * 0.7 = 0.7` - YES, identity behavior
**max case**: `max(0.0, 0.7) = 0.7` - YES, identity behavior

**Assessment**: CORRECT. Deterministic confidences act as identities as expected.

### 3.5 Mixed-Type Compositions

**Question**: Are all type combinations defined?

| Input Types | Composition | Result Type |
|-------------|-------------|-------------|
| Deterministic + Deterministic | All ops | Derived |
| Measured + Measured | All ops | Derived |
| Bounded + Bounded | All ops | Derived |
| Deterministic + Measured | All ops | Derived |
| Deterministic + Bounded | All ops | Derived |
| Measured + Bounded | All ops | Derived |
| Any + Absent | All ops | Absent |

**Assessment**: All combinations produce valid outputs. The output type is always either `derived` or `absent`.

---

## 4. Calibration Preservation Analysis

### 4.1 Formal Definition

A confidence system is **calibration-preserving** if:
> When all inputs have well-calibrated confidence values, the output is also well-calibrated.

Formally: If `E[outcome | conf(x) = p] = p` for all inputs, then `E[outcome | conf(f(inputs)) = q] = q`.

### 4.2 Analysis by Operation

#### min operation
**Calibration preserved?**: YES (conservative)

If all inputs are calibrated, min gives a lower bound on the joint success probability. The resulting confidence is a **valid lower bound**, though not necessarily tight.

#### product operation
**Calibration preserved?**: CONDITIONAL (only under independence)

If inputs are calibrated AND independent:
- P(all succeed) = product of individual probabilities
- Output is calibrated

If inputs are correlated:
- Product underestimates true probability (positive correlation)
- Product overestimates true probability (negative correlation)
- Output is NOT calibrated

#### Weighted average
**Calibration preserved?**: NO (generally)

Weighted averaging is not a proper Bayesian update. The output may be over- or under-confident depending on whether inputs are estimates of the same or different quantities.

#### Temporal decay
**Calibration preserved?**: NO (by design)

Decay deliberately reduces confidence to reflect information staleness. The output confidence represents "current reliability" which is lower than the original calibrated value.

### 4.3 Systematic Bias Assessment

| Operation | Bias Direction | When Triggered |
|-----------|----------------|----------------|
| min | Under-confident | Independent steps |
| product | Under-confident | Positively correlated inputs |
| product | Over-confident | Negatively correlated inputs |
| Noisy-OR | Over-confident | Positively correlated failures |
| weighted_avg | Unpredictable | Always |
| decay | Under-confident | Always (by design) |

**Conclusion**: The system has a **conservative bias** overall, which is appropriate for safety-critical applications but may underestimate confidence in practice.

---

## 5. Recommended Composition Algebra Specification

### 5.1 Proposed Formal Specification

```
DOMAIN:
  C = { absent } union Bounded([0,1]) union Point([0,1])

  where:
    absent: represents unknown confidence
    Bounded(lo, hi): represents interval uncertainty
    Point(p): represents point estimate (Measured, Deterministic, Derived)

OPERATIONS:

  min: C x C -> C
    absent min _ = absent
    _ min absent = absent
    Bounded(a,b) min Bounded(c,d) = Bounded(min(a,c), min(b,d))
    Point(p) min Point(q) = Point(min(p, q))
    Point(p) min Bounded(lo,hi) = Bounded(min(p,lo), min(p,hi))

  product: C x C -> C (independence assumption documented)
    absent product _ = absent
    _ product absent = absent
    Point(p) product Point(q) = Point(p * q)
    Bounded(a,b) product Bounded(c,d) = Bounded(a*c, b*d)

  or_any: C x C -> C (independence assumption documented)
    absent or_any Point(p) = Point(p)  // different from product!
    Point(p) or_any absent = Point(p)
    absent or_any absent = absent
    Point(p) or_any Point(q) = Point(1 - (1-p)*(1-q))

IDENTITIES:
  min: Point(1.0)
  product: Point(1.0)
  or_any: Point(0.0)

ANNIHILATORS:
  min: Point(0.0)
  product: Point(0.0)
  or_any: Point(1.0)

PROPERTIES:
  All operations are:
    - Associative
    - Commutative
    - Preserve type hierarchy (absent < bounded < point)
```

### 5.2 Key Changes from Current Implementation

1. **Interval arithmetic for Bounded**: Preserve uncertainty ranges through composition
2. **Asymmetric absent handling for OR**: If one alternative is known, use it
3. **Explicit independence documentation**: Add JSDoc warnings about assumptions

### 5.3 Implementation Recommendations

```typescript
// Proposed: Interval-preserving composition
interface IntervalConfidence {
  low: number;
  high: number;
  distribution?: 'uniform' | 'triangular' | 'beta';
}

function minInterval(a: IntervalConfidence, b: IntervalConfidence): IntervalConfidence {
  return {
    low: Math.min(a.low, b.low),
    high: Math.min(a.high, b.high),
  };
}

// Proposed: Correlation-aware product
interface ProductOptions {
  /** Correlation coefficient [-1, 1]. Default 0 (independence). */
  correlation?: number;
}

function productWithCorrelation(
  p: number,
  q: number,
  correlation: number = 0
): number {
  // Frechet bounds adjusted by correlation
  const independent = p * q;
  const perfectPositive = Math.min(p, q);
  const perfectNegative = Math.max(0, p + q - 1);

  if (correlation >= 0) {
    return independent + correlation * (perfectPositive - independent);
  } else {
    return independent + (-correlation) * (perfectNegative - independent);
  }
}
```

---

## 6. Gaps and Recommendations Summary

### 6.1 High Priority

| Gap | Impact | Recommendation |
|-----|--------|----------------|
| Independence assumption undocumented | Misleading confidence | Add JSDoc warnings to D3, D4 |
| Bounded range lost in composition | Information loss | Consider interval arithmetic |
| No correlation parameter | Can't model real pipelines | Add optional correlation param |

### 6.2 Medium Priority

| Gap | Impact | Recommendation |
|-----|--------|----------------|
| Absent propagation too strict | May block useful work | Consider or_any relaxation |
| No calibration status propagation | Can't track calibration | Add calibration tracking |
| Formula as string | No type safety | Consider formula ADT |

### 6.3 Low Priority

| Gap | Impact | Recommendation |
|-----|--------|----------------|
| Weighted average not principled | Minor calibration issues | Document as heuristic |
| No ensemble-specific composition | Missing use case | Add if needed |

---

## 7. Priority Rating

| Issue | Priority | Effort | Impact | Recommendation |
|-------|----------|--------|--------|----------------|
| Document independence assumptions | P0 | LOW | HIGH | Add JSDoc to D3, D4 |
| Test calibration preservation | P1 | MEDIUM | HIGH | Add statistical tests |
| Consider interval arithmetic | P2 | HIGH | MEDIUM | Design spike |
| Add correlation parameter | P2 | MEDIUM | MEDIUM | Optional API extension |
| Relax absent handling for OR | P3 | LOW | LOW | Conditional change |

---

## 8. Conclusion

The LiBrainian primitive composition system provides a **pragmatically sound** approach to confidence propagation. The derivation rules (D1-D6) are mathematically valid under their assumptions, and the algebraic structure - while not a complete semiring - has the key properties needed for correct pipeline composition.

**Strengths**:
1. Conservative bias (min, strict absent propagation) avoids overconfidence
2. Clear identity and annihilator elements for intuitive behavior
3. Associative and commutative operations enable flexible composition
4. Full provenance tracking in DerivedConfidence

**Areas for Improvement**:
1. Independence assumptions should be explicitly documented
2. Interval arithmetic would preserve uncertainty better
3. Correlation parameter would enable more accurate modeling
4. Calibration preservation should be formally tracked

The system successfully achieves its goal of providing **principled confidence composition** while maintaining epistemic honesty about its assumptions.

---

## 9. References

1. Pearl, J. (1988). Probabilistic Reasoning in Intelligent Systems. Chapter 4: Independence and Graphs.
2. Walley, P. (1991). Statistical Reasoning with Imprecise Probabilities. Chapters 5-6: Interval probabilities.
3. Couso, I., & Dubois, D. (2014). Statistical reasoning with set-valued information: Ontic vs. epistemic views. International Journal of Approximate Reasoning.
4. Frechet, M. (1951). Sur les tableaux de correlation dont les marges sont donnees. Annales de l'Universite de Lyon.
5. Nau, R. F. (2001). De Finetti was right: Probability does not exist. Theory and Decision.
6. Gneiting, T., & Raftery, A. E. (2007). Strictly Proper Scoring Rules, Prediction, and Estimation. Journal of the American Statistical Association.

---

*This audit is research/assessment only. No implementation files were modified.*
