# Track D: Principled Confidence Specification

> **Source**: Extracted from THEORETICAL_CRITIQUE.md, Part XIX.N + CONFIDENCE_REDESIGN.md
>
> **Purpose**: Achieve epistemic honesty by eliminating arbitrary **epistemic claim confidence** values
>
> **Principle**: A labeled guess is still a guess. No arbitrary numbers, period.
>
> **LiBrainian Story**: Chapter 5 (The Honesty) - This is the foundation for calibration.

---

## CRITICAL: Why “Labeled Guess” Confidence Was Wrong

The previous design wrapped arbitrary values with labels (a “labeled guess” escape hatch).

**This was documentation theater, not epistemic honesty.**

| Old Approach | Problem |
|--------------|---------|
| `confidence: 0.7` | Arbitrary number |
| `confidence: <arbitrary>, tracking: <id>` | Same arbitrary number, now with a label |

**A labeled guess is still a guess.** The 0.7 has no basis - it's a wish, not a measurement.

## Scope (Avoiding a Category Error)

LiBrainian currently uses many numeric 0–1 values for *ranking and heuristics* (relevance, similarity, internal scoring). Those values are not necessarily calibrated “degree of belief in a claim”.

Track D applies to **epistemic claim confidence** (the thing we communicate as “this claim is supported/true with confidence X”). Ranking values should be named `score` / `signalStrength` (or wrapped in explicit score types) so the system does not accidentally treat heuristics as calibrated confidence.

---

## The Principled Redesign

### Core Principle: No Arbitrary Numbers

Every confidence value in LiBrainian must be one of:

| Type | Definition | When to Use |
|------|------------|-------------|
| **Deterministic** | Logically certain (1.0 or 0.0) | AST parse, exact match, boolean result |
| **Derived** | Computed from other confidences | Composed operations, pipelines |
| **Measured** | Empirically calibrated from outcomes | After collecting outcome data |
| **Bounded** | Range with explicit citation | Theoretical bounds from literature |
| **Absent** | Unknown - system handles gracefully | Before any calibration data exists |

**What's NOT allowed**: Raw numbers like 0.7 with no derivation.

---

## Type Definitions

### ConfidenceValue (Replaces QuantifiedValue)

```typescript
/**
 * A confidence value with MANDATORY provenance.
 * Raw numbers are NOT allowed - every value must explain its origin.
 *
 * This replaces QuantifiedValue and eliminates the labeled-guess escape hatch.
 */
type ConfidenceValue =
  | DeterministicConfidence
  | DerivedConfidence
  | MeasuredConfidence
  | BoundedConfidence
  | AbsentConfidence;

/**
 * Logically certain: 1.0 (definitely true) or 0.0 (definitely false)
 *
 * Use for: syntactic operations, parse success/failure, exact matches
 *
 * RULE: If an operation is deterministic, its confidence MUST be 1.0 or 0.0.
 * There is no uncertainty in whether a parse succeeded.
 */
interface DeterministicConfidence {
  type: 'deterministic';
  value: 1.0 | 0.0;
  reason: string;  // "ast_parse_succeeded" / "exact_string_match"
}

/**
 * Computed from other confidence values via explicit formula.
 *
 * Use for: composed operations, pipelines, aggregations
 *
 * RULE: The formula must be mathematically valid and all inputs must be
 * ConfidenceValue (not raw numbers).
 */
interface DerivedConfidence {
  type: 'derived';
  value: number;  // 0.0 to 1.0, computed from formula
  formula: string;  // e.g., "min(step1, step2)" or "step1 * step2"
  inputs: { name: string; confidence: ConfidenceValue }[];
}

/**
 * Empirically measured from historical outcomes.
 *
 * Use for: LLM operations after calibration, any operation with outcome data
 *
 * RULE: Must have actual measurement data. If you don't have data, use Absent.
 */
interface MeasuredConfidence {
  type: 'measured';
  value: number;
  measurement: {
    datasetId: string;
    sampleSize: number;
    accuracy: number;
    confidenceInterval: [number, number];  // 95% CI
    measuredAt: string;  // ISO date
  };
}

/**
 * Range estimate with EXPLICIT basis.
 *
 * Use for: operations with theoretical bounds but no empirical data yet
 *
 * RULE: Must have citation or principled derivation. No guessing.
 */
interface BoundedConfidence {
  type: 'bounded';
  low: number;
  high: number;
  basis: 'theoretical' | 'literature' | 'formal_analysis';
  citation: string;  // Paper, formal proof, or explicit reasoning
}

/**
 * Confidence is genuinely unknown.
 *
 * Use for: operations before calibration, new primitives
 *
 * RULE: System must handle operations without confidence values gracefully.
 * This is the HONEST state - we don't know yet.
 */
interface AbsentConfidence {
  type: 'absent';
  reason: 'uncalibrated' | 'insufficient_data' | 'not_applicable';
}
```

---

## Derivation Rules

### Rule D1: Syntactic Operations → Deterministic

```typescript
// AST parsing, regex matching, file reading - ALWAYS 1.0 or 0.0
function syntacticConfidence(success: boolean): ConfidenceValue {
  return {
    type: 'deterministic',
    value: success ? 1.0 : 0.0,
    reason: success ? 'operation_succeeded' : 'operation_failed'
  };
}
```

### Rule D2: Sequential Composition → min(steps)

```typescript
// Sequential pipeline: confidence = minimum of steps (weakest link)
function sequenceConfidence(steps: ConfidenceValue[]): ConfidenceValue {
  const values = steps.map(getNumericValue);
  return {
    type: 'derived',
    value: Math.min(...values),
    formula: 'min(steps)',
    inputs: steps.map((s, i) => ({ name: `step_${i}`, confidence: s }))
  };
}
```

### Rule D3: Parallel-All Composition → product(branches)

```typescript
// All branches must succeed: confidence = product (independent AND)
function parallelAllConfidence(branches: ConfidenceValue[]): ConfidenceValue {
  const values = branches.map(getNumericValue);
  const product = values.reduce((a, b) => a * b, 1);
  return {
    type: 'derived',
    value: product,
    formula: 'product(branches)',
    inputs: branches.map((b, i) => ({ name: `branch_${i}`, confidence: b }))
  };
}
```

### Rule D4: Parallel-Any Composition → 1 - product(1 - branches)

```typescript
// Any branch can succeed: confidence = 1 - product of failures (independent OR)
function parallelAnyConfidence(branches: ConfidenceValue[]): ConfidenceValue {
  const values = branches.map(getNumericValue);
  const failureProduct = values.map(v => 1 - v).reduce((a, b) => a * b, 1);
  return {
    type: 'derived',
    value: 1 - failureProduct,
    formula: '1 - product(1 - branches)',
    inputs: branches.map((b, i) => ({ name: `branch_${i}`, confidence: b }))
  };
}
```

### Rule D5: LLM Operations Before Calibration → Absent

```typescript
// BEFORE any calibration data exists - be honest
function uncalibratedLlmConfidence(): ConfidenceValue {
  return {
    type: 'absent',
    reason: 'uncalibrated'
  };
}
```

### Rule D6: LLM Operations After Calibration → Measured

```typescript
// AFTER calibration with real outcome data
function calibratedLlmConfidence(data: CalibrationResult): ConfidenceValue {
  return {
    type: 'measured',
    value: data.accuracy,
    measurement: {
      datasetId: data.datasetId,
      sampleSize: data.sampleSize,
      accuracy: data.accuracy,
      confidenceInterval: data.ci95,
      measuredAt: new Date().toISOString()
    }
  };
}
```

---

## System Behavior with Absent Confidence

When confidence is `absent`, the system MUST handle it gracefully:

### Option A: Degrade to Equal Weighting

```typescript
function selectBestComposition(compositions: Composition[]): Composition {
  const withConfidence = compositions.filter(c => c.confidence.type !== 'absent');

  if (withConfidence.length === 0) {
    // No confidence data - all options are equally viable
    // Use deterministic selection (alphabetical, first, etc.)
    return compositions.sort((a, b) => a.id.localeCompare(b.id))[0];
  }

  // Sort by confidence (those with data)
  return withConfidence.sort((a, b) =>
    getNumericValue(b.confidence) - getNumericValue(a.confidence)
  )[0];
}
```

### Option B: Use Conservative Lower Bound

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
      return 0.0;  // Most conservative: treat as zero confidence
  }
}
```

### Option C: Block Operations Requiring Confidence

```typescript
function checkConfidenceThreshold(
  confidence: ConfidenceValue,
  minConfidence: number
): { status: 'allowed' | 'blocked'; reason?: string } {
  const effective = getEffectiveConfidence(confidence);
  return effective >= minConfidence
    ? { status: 'allowed' }
    : { status: 'blocked', reason: `Confidence ${effective} below threshold ${minConfidence}` };
}
```

---

## Migration Guide

### What Existing Code Has (Wrong)

```typescript
// Raw number - no provenance
confidence: 0.7
```

### What Code Should Have (Correct)

```typescript
// For syntactic operations (AST, exact match)
confidence: {
  type: 'deterministic',
  value: 1.0,
  reason: 'ast_parse_success'
}

// For operations without calibration data yet (HONEST)
confidence: {
  type: 'absent',
  reason: 'uncalibrated'
}

// For operations with theoretical bounds
confidence: {
  type: 'bounded',
  low: 0.4,
  high: 0.8,
  basis: 'literature',
  citation: 'Based on semantic similarity literature showing 40-80% accuracy for embedding-based retrieval'
}

// For composed operations
confidence: {
  type: 'derived',
  value: 0.64,  // 0.8 * 0.8
  formula: 'product(step1, step2)',
  inputs: [
    { name: 'step1', confidence: step1Conf },
    { name: 'step2', confidence: step2Conf }
  ]
}

// After calibration (the goal state)
confidence: {
  type: 'measured',
  value: 0.73,
  measurement: {
    datasetId: 'librarian_v1_calibration',
    sampleSize: 847,
    accuracy: 0.73,
    confidenceInterval: [0.70, 0.76],
    measuredAt: '2026-01-22'
  }
}
```

---

## Feature Specifications

### Q1: ConfidenceValue Type System (~100 LOC)

**Location**: `packages/LiBrainian/src/epistemics/confidence.ts`

**Deliverable**: Complete type definitions as specified above.

**Acceptance**:
- [ ] All 5 confidence types defined
- [ ] Type guards for each type
- [ ] `getNumericValue()` helper
- [ ] `getEffectiveConfidence()` with conservative defaults
- [ ] No labeled-guess wrapper is used for **claim confidence** (legacy `QuantifiedValue.placeholder()` may remain as a deprecated scoring shim during migration)

### Q2: Derivation Rule Implementations (~150 LOC)

**Location**: `packages/LiBrainian/src/epistemics/confidence.ts`

**Deliverable**: Functions for D1-D6 derivation rules.

**Acceptance**:
- [ ] `syntacticConfidence(success: boolean)`
- [ ] `sequenceConfidence(steps: ConfidenceValue[])`
- [ ] `parallelAllConfidence(branches: ConfidenceValue[])`
- [ ] `parallelAnyConfidence(branches: ConfidenceValue[])`
- [ ] `uncalibratedConfidence()`
- [ ] `measuredConfidence(data: CalibrationResult)`

### Q3: System Degradation Handlers (~100 LOC)

**Location**: `packages/LiBrainian/src/epistemics/confidence.ts`

**Deliverable**: Functions for handling absent confidence gracefully.

**Acceptance**:
- [ ] `selectWithDegradation()` - selects when some have absent confidence
- [ ] `checkConfidenceThreshold()` - blocks below threshold
- [ ] `reportConfidenceStatus()` - tells users what's calibrated vs not

### Q4: Migration Script (~200 LOC)

**Location**: `scripts/migrate_confidence_values.ts`

**Deliverable**: Script to migrate existing code from raw numbers / labeled guesses to new types.

**Migration rules**:
1. **Claim confidence** (`confidence` meaning “degree of belief in a claim”) must become `ConfidenceValue`.
2. Raw numbers or labeled-guess wrappers in claim confidence → `absent('uncalibrated')` (until real calibration exists).
3. For deterministic/syntactic claim results → `deterministic(true|false, reason)`.
4. **Ranking/heuristic** numeric fields should be renamed (`score`, `signalStrength`) rather than forced into `ConfidenceValue` prematurely.

### Q5-Q7: Codebase Migration

| File | Current | Target |
|------|---------|--------|
| `technique_library.ts` | Raw numbers | ConfidenceValue |
| `pattern_catalog.ts` | Raw numbers | ConfidenceValue |
| `track-e-domain.md` | `0.7` examples | ConfidenceValue examples |

### Q8: Type Enforcement

**Primary enforcement**: TypeScript types at the claim boundary.

If a claim type requires `confidence: ConfidenceValue`, TypeScript rejects `confidence: 0.7` because `number` is not assignable to `ConfidenceValue`.

---

## Why This Is Better Than “Labeled Guess” Confidence

| Aspect | Old (labeled guess) | New (Principled) |
|--------|-------------------|------------------|
| Arbitrary values | ✅ Allowed (labeled) | ❌ Not allowed |
| System behavior | Uses arbitrary value | Degrades gracefully |
| User transparency | "This is uncalibrated" | "We don't know - here are options" |
| Escape hatch | Always available | None - must use valid type |
| Honesty | Partial | Full |

### The Key Insight

**A labeled-guess escape hatch allowed lying.**

You could attach a tracking ID to an arbitrary value and the system would still treat the value as real. The label made you *feel* honest without *being* honest.

**AbsentConfidence forces actual honesty.**

When confidence is `absent`, the system MUST handle it differently. It cannot pretend to know something it doesn't. This is true epistemic integrity.

---

## Acceptance Criteria

### Green: Q1-Q4 Complete

- [ ] `ConfidenceValue` type exported from `packages/LiBrainian/src/epistemics/index.ts`
- [ ] Claim confidence does not use labeled-guess wrappers (legacy placeholder may exist only in deprecated scoring shims)
- [ ] All derivation rules implemented
- [ ] Degradation handlers working

### Green: Q5-Q7 Complete

- [ ] `technique_library.ts` uses `ConfidenceValue`
- [ ] `pattern_catalog.ts` uses `ConfidenceValue`
- [ ] Track E spec uses `ConfidenceValue` examples

### Green: Full Migration

```bash
# These should return 0 matches
rg "confidence:\s*0\.\d" packages/LiBrainian/src --glob '*.ts' | wc -l
rg "placeholder\\s*\\(" packages/LiBrainian/src --glob '*.ts' | wc -l
```

---

## Relationship to Track F (Calibration)

Track D defines the type system. Track F provides the calibration infrastructure that upgrades `absent` → `measured`.

```
Track D: Define types (ConfidenceValue)
    ↓
Track F: Collect outcome data
    ↓
Track F: Compute calibration curves
    ↓
Track F: Upgrade absent → measured
```

Without Track D's principled types, Track F has nothing to calibrate. Without Track F's calibration, Track D's types remain `absent`. They are complementary.

---

## Summary

**The old approach**: "Here's 0.7, we labeled it as uncalibrated" (documentation theater)

**The new approach**: "We genuinely don't know - here's how the system handles that" (epistemic integrity)

This is the difference between **looking honest** and **being honest**.
