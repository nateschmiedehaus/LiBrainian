# Confidence System Redesign

> **Purpose**: Replace arbitrary confidence values with a principled system
> **Problem**: `confidence: 0.7` and even “labeled guess” wrappers are "wishes, not measurements" (Dijkstra)
> **Solution**: Epistemic **claim confidence** must be **derived**, **measured**, or **absent** - never arbitrary

---

## The Problem with the Current Design

### What We Had (Wrong)
```typescript
// Raw arbitrary value
confidence: 0.7  // Where did 0.7 come from? A guess.
```

### What We "Fixed" (Still Wrong)
```typescript
// Labeled arbitrary value
confidence: { kind: 'labeled_guess', value: 0.7, trackingId: 'tp_artifact_trace_confidence' }
// The 0.7 is still a guess - we just labeled our ignorance
```

### Why This Is Theater

	The “labeled guess” wrapper provides:
- ✅ Tracking that a value needs calibration
- ✅ A path to future improvement
- ❌ Actual epistemic honesty
- ❌ A principled initial value

**A labeled guess is still a guess.**

---

## The Principled Redesign

### Core Principle: No Arbitrary Numbers

Every **epistemic claim confidence** value in LiBrainian must be one of:

| Type | Definition | Example |
|------|------------|---------|
| **Deterministic** | Logically certain (1.0 or 0.0) | AST parse succeeded |
| **Derived** | Computed from other confidences via formula | `min(a.confidence, b.confidence)` |
| **Measured** | Empirically calibrated from outcomes | 73% accuracy over 1000 samples |
| **Bounded** | Range with explicit basis | [0.3, 0.9] based on literature |
| **Absent** | Unknown, system must handle missing | `{ type: 'absent', reason: 'uncalibrated' }` |

**What's NOT allowed**: A raw number like 0.7 with no derivation.

### Scope Note: Scores vs Claim Confidence

LiBrainian currently uses many numeric 0–1 values for ranking and heuristics (relevance scores, similarity scores, internal “confidence” fields that are not calibrated). Those should not be presented as calibrated confidence in claims. Track D’s `ConfidenceValue` boundary applies to **claim confidence** first; ranking values should be named `score` / `signalStrength` (or wrapped in explicit score types).

---

## New Type System

### ConfidenceValue (Replaces QuantifiedValue)

```typescript
/**
 * A confidence value with mandatory provenance.
 * Raw numbers are NOT allowed - every value must explain its origin.
 */
type ConfidenceValue =
  | DeterministicConfidence
  | DerivedConfidence
  | MeasuredConfidence
  | BoundedConfidence
  | AbsentConfidence;

/**
 * Logically certain: 1.0 (definitely true) or 0.0 (definitely false)
 * Use for: syntactic operations, parse success/failure, exact matches
 */
interface DeterministicConfidence {
  type: 'deterministic';
  value: 1.0 | 0.0;
  reason: string;  // "AST parse succeeded" / "exact string match"
}

/**
 * Computed from other confidence values via explicit formula.
 * Use for: composed operations, pipelines, aggregations
 */
interface DerivedConfidence {
  type: 'derived';
  value: number;  // 0.0 to 1.0
  formula: string;  // e.g., "min(step1, step2)" or "step1 * step2"
  inputs: { name: string; value: ConfidenceValue }[];
}

/**
 * Empirically measured from historical outcomes.
 * Use for: LLM operations after calibration, any operation with outcome data
 */
interface MeasuredConfidence {
  type: 'measured';
  value: number;
  measurement: {
    datasetId: string;
    sampleSize: number;
    accuracy: number;      // What we actually measured
    confidenceInterval: [number, number];  // 95% CI
    measuredAt: Date;
  };
}

/**
 * Range estimate with explicit basis.
 * Use for: operations with theoretical bounds but no empirical data
 */
interface BoundedConfidence {
  type: 'bounded';
  low: number;
  high: number;
  basis: 'theoretical' | 'literature' | 'expert_estimate';
  citation?: string;  // Paper, doc, or rationale
}

/**
 * Confidence is genuinely unknown.
 * System must handle operations without confidence values.
 */
interface AbsentConfidence {
  type: 'absent';
  reason: 'uncalibrated' | 'insufficient_data' | 'not_applicable';
}
```

---

## Confidence Derivation Rules

### For Syntactic Operations (Tier 1)

```typescript
// AST parsing, regex matching, file reading
function syntacticConfidence(success: boolean): ConfidenceValue {
  return {
    type: 'deterministic',
    value: success ? 1.0 : 0.0,
    reason: success ? 'syntactic_operation_succeeded' : 'syntactic_operation_failed'
  };
}
```

**These are ALWAYS 1.0 or 0.0** - there's no uncertainty in whether a parse succeeded.

### For Composed Operations

```typescript
// Sequential composition: confidence = minimum of steps
function sequenceConfidence(steps: ConfidenceValue[]): ConfidenceValue {
  const minValue = Math.min(...steps.map(getNumericValue));
  return {
    type: 'derived',
    value: minValue,
    formula: 'min(steps)',
    inputs: steps.map((s, i) => ({ name: `step_${i}`, value: s }))
  };
}

// Parallel composition (all must succeed): confidence = product
function parallelAllConfidence(branches: ConfidenceValue[]): ConfidenceValue {
  const product = branches.map(getNumericValue).reduce((a, b) => a * b, 1);
  return {
    type: 'derived',
    value: product,
    formula: 'product(branches)',
    inputs: branches.map((b, i) => ({ name: `branch_${i}`, value: b }))
  };
}

// Parallel composition (any can succeed): confidence = 1 - product of failures
function parallelAnyConfidence(branches: ConfidenceValue[]): ConfidenceValue {
  const failureProduct = branches.map(b => 1 - getNumericValue(b)).reduce((a, b) => a * b, 1);
  return {
    type: 'derived',
    value: 1 - failureProduct,
    formula: '1 - product(1 - branches)',
    inputs: branches.map((b, i) => ({ name: `branch_${i}`, value: b }))
  };
}
```

### For LLM Operations (Before Calibration)

```typescript
// BEFORE any calibration data exists
function uncalibratedLlmConfidence(): ConfidenceValue {
  return {
    type: 'absent',
    reason: 'uncalibrated'
  };
}

// AFTER calibration with real outcome data
function calibratedLlmConfidence(calibrationData: CalibrationResult): ConfidenceValue {
  return {
    type: 'measured',
    value: calibrationData.accuracy,
    measurement: {
      datasetId: calibrationData.datasetId,
      sampleSize: calibrationData.n,
      accuracy: calibrationData.accuracy,
      confidenceInterval: calibrationData.ci95,
      measuredAt: new Date()
    }
  };
}
```

---

## What This Means for Existing Code

### Before (Wrong)
```typescript
const primitive: TechniquePrimitive = {
  id: 'artifact_trace',
  confidence: 0.7,  // ARBITRARY - where did this come from?
  // ...
};
```

### After (Principled)
```typescript
const primitive: TechniquePrimitive = {
  id: 'artifact_trace',
  confidence: {
    type: 'absent',
    reason: 'uncalibrated'
  },
  // System knows it doesn't have confidence data
  // Features requiring confidence will degrade gracefully
};

// OR, if we have theoretical bounds from literature:
const primitive: TechniquePrimitive = {
  id: 'artifact_trace',
  confidence: {
    type: 'bounded',
    low: 0.4,
    high: 0.8,
    basis: 'literature',
    citation: 'Smith et al. 2024 - Artifact tracing accuracy ranges 40-80%'
  },
};

// OR, after calibration:
const primitive: TechniquePrimitive = {
  id: 'artifact_trace',
  confidence: {
    type: 'measured',
    value: 0.73,
    measurement: {
      datasetId: 'librarian_calibration_2026_01',
      sampleSize: 847,
      accuracy: 0.73,
      confidenceInterval: [0.70, 0.76],
      measuredAt: new Date('2026-01-15')
    }
  },
};
```

---

## System Behavior with Absent Confidence

When confidence is `absent`, the system must:

### Option A: Degrade Gracefully
```typescript
function selectBestComposition(compositions: Composition[]): Composition {
  const withConfidence = compositions.filter(c => c.confidence.type !== 'absent');

  if (withConfidence.length === 0) {
    // No confidence data - return all as equally viable
    return compositions[0]; // Or random, or alphabetical
  }

  // Sort by confidence
  return withConfidence.sort((a, b) =>
    getNumericValue(b.confidence) - getNumericValue(a.confidence)
  )[0];
}
```

### Option B: Require Explicit User Acceptance
```typescript
function executeWithUncalibratedConfidence(
  primitive: TechniquePrimitive,
  userAcceptedRisk: boolean
): Result {
  if (primitive.confidence.type === 'absent' && !userAcceptedRisk) {
    return {
      status: 'blocked',
      reason: 'Confidence unknown - user must acknowledge risk',
      mitigation: 'Run calibration suite or pass userAcceptedRisk: true'
    };
  }
  // Proceed with execution
}
```

### Option C: Use Bounded Fallback
```typescript
function getEffectiveConfidence(conf: ConfidenceValue): number {
  switch (conf.type) {
    case 'deterministic':
    case 'derived':
    case 'measured':
      return conf.value;
    case 'bounded':
      return conf.low;  // Conservative: use lower bound
    case 'absent':
      return 0.0;  // Most conservative: assume no confidence
  }
}
```

---

## Migration Path

### Phase 1: Type System (No Code Changes)
1. Define new `ConfidenceValue` type
2. Add type guards and helpers
3. Keep old `number` type working via union

### Phase 2: Mark All Current Values as Bounded/Absent
1. Grep for `confidence:` assignments
2. Replace raw numbers with `bounded` (if we have theoretical basis) or `absent`
3. Document the basis for any bounds

### Phase 3: Add Calibration Infrastructure
1. Implement outcome tracking
2. Build calibration pipeline
3. Start collecting real data

### Phase 4: Upgrade to Measured
1. As calibration data accumulates, upgrade `bounded` → `measured`
2. Remove `absent` values as we get data

---

## Comparison with Old Approach

| Aspect | Old (`placeholder()`) | New (Principled) |
|--------|----------------------|------------------|
| Arbitrary values | ✅ Allowed (labeled) | ❌ Not allowed |
| Tracking needed | ✅ Yes | ✅ Yes (via type) |
| System behavior | Uses arbitrary value | Degrades gracefully |
| User transparency | "This is uncalibrated" | "We don't know - here's why" |
| Path to improvement | Replace placeholder | Collect data, upgrade type |
| Honesty | Partial | Full |

---

## Integration with Track D and Track F

### Track D (Quantification) Becomes:
- Q1: Define `ConfidenceValue` type (this document)
- Q2: Define derivation rules for compositions
- Q3: Implement `getEffectiveConfidence()` with degradation
- Q4: Migrate existing code to new type system

### Track F (Calibration) Becomes:
- C1: Implement outcome tracking
- C2: Build calibration pipeline
- C3: Upgrade `absent` → `measured` as data accumulates
- C4: Dashboard showing calibration status

---

## Why This Is Better

1. **No lies**: We never claim to know something we don't
2. **Degradation**: System works even without confidence data
3. **Transparency**: Users know exactly what's known vs. unknown
4. **Improvement path**: Clear upgrade from absent → bounded → measured
5. **Auditability**: Every confidence value explains its origin

---

## Summary

**The old approach**: "Here's 0.7, we'll calibrate it later" (a labeled guess)

**The new approach**: "We don't know yet. Here's what we'll do about it." (honest uncertainty)

This is the difference between **documentation theater** and **epistemic integrity**.
