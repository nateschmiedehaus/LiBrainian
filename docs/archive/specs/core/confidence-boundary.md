# Confidence Boundary Specification

> **Version**: 1.0.0
> **Status**: DRAFT
> **Last Updated**: 2026-01-24
>
> **Theory Reference**: Implements Track D quantification principles. See [track-d-quantification.md](../track-d-quantification.md).

---

## Executive Summary

The Confidence Boundary enforces **type-level safety** for LiBrainian’s **epistemic claim confidence**. In user-facing outputs and persisted claim objects, raw numeric confidence values are not permitted — claim confidence must flow through the `ConfidenceValue` type system, ensuring:

- **Provenance**: Every confidence value knows how it was derived
- **Calibration**: All confidence can be tracked for calibration
- **Honesty**: Uncertainty is explicit, not hidden behind numbers
- **Composability**: Confidence values combine predictably

**Important scope note**: LiBrainian currently uses many numeric 0–1 values for *ranking/scoring* (e.g. relevance scores, heuristics). Those must not be presented as “calibrated confidence”. The long-term migration is to rename these fields to `score`/`signalStrength` or wrap them in explicit “heuristic score” types — but the Confidence Boundary applies to **epistemic claims** first.

---

## 1. The D7 Rule

**D7: No raw numeric confidence values in any *epistemic claim* interface or persisted claim confidence.**

This is the fundamental invariant. Any code that uses `number` for **claim confidence** is in violation.

### 1.1 Violations

```typescript
// VIOLATION: Raw numeric confidence
interface BadClaim {
  text: string;
  confidence: number;  // ❌ FORBIDDEN
}

// VIOLATION: Inline numeric confidence
function badAnalysis() {
  return { confidence: 0.75 };  // ❌ FORBIDDEN
}
```

### 1.2 Correct Usage

```typescript
// CORRECT: Using ConfidenceValue type
interface GoodClaim {
  text: string;
  confidence: ConfidenceValue;  // ✓ REQUIRED
}

// CORRECT: Explicit derivation
function goodAnalysis(): ConfidenceValue {
  // Before calibration exists, be honest.
  return absent('uncalibrated');
}
```

---

## 2. ConfidenceValue Type System

**Canonical definition**: `packages/LiBrainian/src/epistemics/confidence.ts` and `docs/LiBrainian/specs/track-d-quantification.md`.

This document must **not** redefine incompatible variants (e.g. `"present"`/`"deferred"`), because that creates spec-code divergence and breaks the D7 boundary.

```typescript
/**
 * Summary only. Treat the code + Track D spec as authoritative.
 */
type ConfidenceValue =
  | { type: 'deterministic'; value: 1.0 | 0.0; reason: string }
  | { type: 'derived'; value: number; formula: string; inputs: Array<{ name: string; confidence: ConfidenceValue }> }
  | { type: 'measured'; value: number; measurement: { datasetId: string; sampleSize: number; accuracy: number; confidenceInterval: [number, number]; measuredAt: string } }
  | { type: 'bounded'; low: number; high: number; basis: 'theoretical' | 'literature' | 'formal_analysis'; citation: string }
  | { type: 'absent'; reason: 'uncalibrated' | 'insufficient_data' | 'not_applicable' };
```

---

## 3. Confidence Constructors

### 3.1 Absent (Uncalibrated)

```typescript
/**
 * Create an honest "unknown" confidence value.
 *
 * USE: When you do not have calibration data yet.
 * REQUIREMENT: Use one of the canonical absent reasons (do not invent numbers).
 */
function absent(reason: 'uncalibrated' | 'insufficient_data' | 'not_applicable'): ConfidenceValue {
  return { type: 'absent', reason };
}

// Usage
const claim: Claim = {
  text: 'Function handles nulls correctly',
  confidence: absent('uncalibrated'),
};
```

### 3.2 Deterministic

```typescript
/**
 * Create a logically-certain confidence value.
 */
function deterministic(success: boolean, reason: string): ConfidenceValue {
  return { type: 'deterministic', value: success ? 1.0 : 0.0, reason };
}
```

### 3.3 Bounded (Theoretical / Literature)

```typescript
/**
 * Create a bounded confidence value.
 */
function bounded(
  low: number,
  high: number,
  basis: 'theoretical' | 'literature' | 'formal_analysis',
  citation: string
): ConfidenceValue {
  return { type: 'bounded', low, high, basis, citation };
}
```

### 3.4 Measured (Outcome-Calibrated)

```typescript
/**
 * Create a measured confidence value from real outcomes.
 */
function measuredConfidence(data: {
  datasetId: string;
  sampleSize: number;
  accuracy: number;
  ci95: [number, number];
}): ConfidenceValue {
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

---

## 4. Confidence Operations

All operations that “need a number” must go through safe extraction helpers:

```typescript
/**
 * Get the numeric value for computation, or null if absent.
 */
function getNumericValue(confidence: ConfidenceValue): number | null

/**
 * Conservative extraction for decisions (absent => 0, bounded => low).
 */
function getEffectiveConfidence(confidence: ConfidenceValue): number

function meetsThreshold(confidence: ConfidenceValue, threshold: number): boolean
```

### 4.1 Composition

```typescript
/**
 * Combine weighted inputs.
 */
function combinedConfidence(inputs: Array<{ name: string; confidence: ConfidenceValue; weight: number }>): ConfidenceValue

function andConfidence(a: ConfidenceValue, b: ConfidenceValue): ConfidenceValue
function orConfidence(a: ConfidenceValue, b: ConfidenceValue): ConfidenceValue
```

### 4.2 Temporal Decay

```typescript
/**
 * Apply temporal decay (staleness).
 */
function applyDecay(confidence: ConfidenceValue, ageMs: number, halfLifeMs: number): ConfidenceValue
```

---

## 5. Migration Guide

### 5.1 Before (Violations)

```typescript
// Old code with raw numbers
interface OldClaim {
  text: string;
  confidence: number;
}

function oldGetConfidence(): number {
  return 0.85;
}
```

### 5.2 After (Correct)

```typescript
// New code with ConfidenceValue
interface NewClaim {
  text: string;
  confidence: ConfidenceValue;
}

function newGetConfidence(): ConfidenceValue {
  return absent('uncalibrated');
}
```

### 5.3 Migration Checklist

- [ ] Identify **claim objects** and user-facing outputs that use `confidence: number` → migrate to `confidence: ConfidenceValue`.
- [ ] For places that are actually **ranking/signal scores** (not epistemic confidence), rename to `score`/`signalStrength` and document the semantics.
- [ ] Where a decision needs a numeric threshold, use `getEffectiveConfidence()` / `meetsThreshold()` and disclose degradation when confidence is absent/bounded.
- [ ] Replace confidence arithmetic with D7-compliant composition functions (`combinedConfidence`, `andConfidence`, `orConfidence`, `applyDecay`).
- [ ] Optional hardening: add lint/grep gates to prevent reintroducing raw claim confidence.

---

## 6. TDD Test Specifications

### 6.1 Tier-0 Tests (Deterministic)

| Test Case | Input | Expected Output |
|-----------|-------|-----------------|
| `absent_round_trips_reason` | `absent('uncalibrated')` | `{ type: 'absent', reason: 'uncalibrated' }` |
| `deterministic_true_is_one` | `deterministic(true, 'x')` | `{ type: 'deterministic', value: 1.0 }` |
| `deterministic_false_is_zero` | `deterministic(false, 'x')` | `{ type: 'deterministic', value: 0.0 }` |
| `bounded_rejects_inverted` | `bounded(0.9, 0.1, ...)` | throws |
| `combinedConfidence_absent_on_empty` | `[]` | `{ type: 'absent', reason: 'insufficient_data' }` |
| `combinedConfidence_absent_on_all_absent` | all `absent(...)` | `{ type: 'absent' }` |
| `applyDecay_keeps_absent` | `absent(...)` | unchanged |
| `andConfidence_returns_min` | two non-absent confidences | derived min |
| `orConfidence_returns_max` | two non-absent confidences | derived max |
| `meetsThreshold_uses_effective` | absent vs threshold | conservative result |

### 6.2 Tier-1 Tests (Integration)

| Test Case | Scenario | Acceptance Criteria |
|-----------|----------|---------------------|
| `storage_round_trip` | Store and retrieve | All fields preserved |
| `serialization_complete` | JSON serialize/deserialize | Type information intact |
| `derivation_chain` | Multi-step derivation | Derived formula + inputs preserved |

### 6.3 BDD Scenarios

```gherkin
Feature: Confidence Boundary Enforcement
  As a LiBrainian developer
  I want all confidence to use ConfidenceValue
  So that confidence is always honest and traceable

  Scenario: Creating calibrated confidence
    Given I have a calibration dataset "cal_2026"
    When I create confidence for a claim with value 0.75
    Then the confidence has type 'measured'
    And the confidence references "cal_2026"
    And the confidence records a measuredAt timestamp

  Scenario: Combining confidence from multiple sources
    Given I have extraction confidence { type: 'deterministic', value: 1.0 }
    And I have retrieval confidence { type: 'bounded', low: 0.7, high: 0.9 }
    When I combine them with equal weights
    Then the result is derived confidence with formula 'weighted_average'

  Scenario: Handling absent confidence
    Given I have a new domain with no calibration data
    When I try to create confidence
    Then I get absent confidence with reason 'uncalibrated'
    And operations that require a value use explicit fallbacks
```

---

## 7. ESLint Rule

**Optional**: TypeScript types are the primary enforcement mechanism. A linter can be added later as a defense-in-depth measure, but it must not replace type-level boundaries.

```javascript
// eslint-plugin-LiBrainian/rules/no-raw-confidence.js
module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow raw numeric confidence values',
    },
    messages: {
      noRawConfidence: 'Use ConfidenceValue type instead of raw number for confidence',
    },
  },
  create(context) {
    return {
      TSPropertySignature(node) {
        if (
          node.key.name === 'confidence' &&
          node.typeAnnotation?.typeAnnotation?.type === 'TSNumberKeyword'
        ) {
          context.report({ node, messageId: 'noRawConfidence' });
        }
      },
    };
  },
};
```

---

## 8. Implementation Status

- [ ] Spec complete
- [ ] Tests written (Tier-0)
- [ ] Tests written (Tier-1)
- [ ] ESLint rule implemented
- [ ] Migration complete
- [ ] Gate passed

---

## Changelog

| Date | Change |
|------|--------|
| 2026-01-23 | Initial specification |
| 2026-01-24 | Align ConfidenceValue definition + TDD section with Track D and `packages/LiBrainian/src/epistemics/confidence.ts` |
