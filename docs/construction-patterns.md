# Construction Composition Patterns

This document describes the patterns for building "constructions" - higher-level composed primitives that combine LiBrainian capabilities while maintaining epistemic properties.

## Table of Contents

1. [Primitives Inventory](#primitives-inventory)
2. [Confidence Derivation Rules](#confidence-derivation-rules)
3. [Construction Template](#construction-template)
4. [Best Practices](#best-practices)
5. [Anti-patterns to Avoid](#anti-patterns-to-avoid)

---

## Primitives Inventory

### Epistemics Module (`src/epistemics/`)

The epistemics module provides the foundational confidence and evidence tracking system.

#### Core Confidence Types

| Primitive | Purpose | Input | Output | Confidence Semantics |
|-----------|---------|-------|--------|---------------------|
| `deterministic()` | Logically certain results | `boolean, string` | `DeterministicConfidence` | 1.0 or 0.0 only; use for syntactic operations |
| `measuredConfidence()` | Empirically calibrated | `CalibrationResult` | `MeasuredConfidence` | Backed by real outcome data with CI |
| `bounded()` | Theoretical range estimate | `low, high, basis, citation` | `BoundedConfidence` | Range with explicit justification |
| `absent()` | Unknown confidence | `reason` | `AbsentConfidence` | Honest "I don't know" |

#### Derivation Functions

| Primitive | Purpose | Input | Output | Confidence Semantics |
|-----------|---------|-------|--------|---------------------|
| `syntacticConfidence()` | D1: Syntactic ops | `boolean` | `DeterministicConfidence` | Always 1.0 or 0.0 |
| `sequenceConfidence()` | D2: Sequential composition | `ConfidenceValue[]` | `DerivedConfidence` | min(steps) - weakest link |
| `parallelAllConfidence()` | D3: Parallel AND | `ConfidenceValue[]` | `DerivedConfidence` | product(branches) |
| `parallelAnyConfidence()` | D4: Parallel OR | `ConfidenceValue[]` | `DerivedConfidence` | 1 - product(1 - branches) |
| `uncalibratedConfidence()` | D5: Pre-calibration | none | `AbsentConfidence` | Honest uncertainty |
| `measuredConfidence()` | D6: Post-calibration | `CalibrationResult` | `MeasuredConfidence` | Real measurement data |
| `deriveParallelAllConfidence()` | Correlation-aware AND | `ConfidenceValue[], CorrelationOptions` | `DerivedConfidence` | Handles correlated inputs |
| `deriveParallelAnyConfidence()` | Correlation-aware OR | `ConfidenceValue[], ParallelAnyOptions` | `DerivedConfidence` | Handles absent inputs gracefully |

#### Composition Utilities

| Primitive | Purpose | Input | Output | Confidence Semantics |
|-----------|---------|-------|--------|---------------------|
| `andConfidence()` | Logical AND | `a, b: ConfidenceValue` | `DerivedConfidence` | min(a, b) |
| `orConfidence()` | Logical OR | `a, b: ConfidenceValue` | `DerivedConfidence` | max(a, b) |
| `combinedConfidence()` | Weighted average | `{confidence, weight, name}[]` | `DerivedConfidence` | Weighted combination |
| `applyDecay()` | Temporal decay | `confidence, ageMs, halfLifeMs` | `DerivedConfidence` | Time-based degradation |

#### Extraction & Inspection

| Primitive | Purpose | Input | Output | Notes |
|-----------|---------|-------|--------|-------|
| `getNumericValue()` | Extract numeric value | `ConfidenceValue` | `number \| null` | Returns null for absent |
| `getEffectiveConfidence()` | Conservative extraction | `ConfidenceValue` | `number` | Uses lower bound for bounded, 0 for absent |
| `meetsThreshold()` | Threshold check | `confidence, threshold` | `boolean` | Safe threshold comparison |
| `assertConfidenceValue()` | Runtime validation | `unknown, context` | asserts value | D7 enforcement |

#### Evidence Ledger

| Primitive | Purpose | Input | Output | Confidence Semantics |
|-----------|---------|-------|--------|---------------------|
| `SqliteEvidenceLedger.append()` | Record evidence | `EvidenceEntry` | `EvidenceId` | Append-only, immutable |
| `SqliteEvidenceLedger.query()` | Query evidence | `EvidenceQuery` | `EvidenceEntry[]` | Full provenance chain |
| `createExtractionEvidence()` | Bootstrap extraction | `ExtractionResult` | `ExtractionEvidence` | Source: static analysis |
| `createRetrievalEvidence()` | Query stage | `QueryStageOptions` | `RetrievalEvidence` | Source: retrieval system |
| `createToolCallEvidence()` | MCP audit | `ToolCall` | `ToolCallEvidence` | Source: tool execution |

#### Calibration System

| Primitive | Purpose | Input | Output | Confidence Semantics |
|-----------|---------|-------|--------|---------------------|
| `ClaimOutcomeTracker` | Track predictions | claims, outcomes | calibration data | Links predictions to outcomes |
| `computeCalibrationCurve()` | Build curve | samples | `CalibrationCurve` | Maps predicted to actual |
| `adjustConfidenceScore()` | Apply calibration | score, report | adjusted score | Empirical correction |
| `computeBrierScore()` | Proper scoring | predictions | score | Lower is better |

### Engines Module (`src/engines/`)

Engines provide higher-level reasoning over indexed knowledge.

| Primitive | Purpose | Input | Output | Confidence Semantics |
|-----------|---------|-------|--------|---------------------|
| `RelevanceEngine.findRelevant()` | Semantic search | intent, options | `ContextPack[]` | Pack confidence from multi-signal scoring |
| `ConstraintEngine.validate()` | Validate changes | proposed changes | `ValidationResult` | Deterministic constraint checking |
| `MetaKnowledgeEngine.getConfidence()` | Knowledge confidence | pack IDs | `ConfidenceReport` | Aggregated pack confidence |
| `TddEngine.generateTests()` | Test generation | target, config | test cases | Bounded confidence for generated tests |

### Knowledge Module (`src/knowledge/`)

Knowledge provides domain-specific queries and analysis.

| Primitive | Purpose | Input | Output | Confidence Semantics |
|-----------|---------|-------|--------|---------------------|
| `ArchitectureKnowledge.query()` | Architecture analysis | `ArchitectureQuery` | `ArchitectureResult` | Structural confidence |
| `ImpactKnowledge.query()` | Impact analysis | `ImpactQuery` | `ImpactResult` | Bounded risk estimates |
| `QualityKnowledge.query()` | Quality metrics | `QualityQuery` | `QualityResult` | Measured from static analysis |
| `PatternKnowledge.query()` | Pattern detection | `PatternQuery` | `PatternResult` | Heuristic + LLM confidence |
| `UniversalKnowledgeGenerator` | Generate knowledge | entity | `UniversalKnowledge` | Multi-source confidence |

### Strategic Module (`src/strategic/`)

Strategic provides high-level planning and verification.

| Primitive | Purpose | Input | Output | Confidence Semantics |
|-----------|---------|-------|--------|---------------------|
| `WorkPrimitive` | Work item hierarchy | - | Epic/Story/Task/Step | Priority-based ranking |
| `TechniquePrimitive` | Composable techniques | - | technique definition | Calibrated per-technique |
| `VerificationPlan` | Verification planning | criteria | verification steps | Cost-based confidence |
| `Episode` | Learning episode | context, outcome | lesson | Outcome-based calibration |

---

## Confidence Derivation Rules

The confidence system enforces six derivation rules (D1-D6) to ensure principled confidence propagation.

### D1: Syntactic Operations -> Deterministic

AST parsing, regex matching, file I/O - operations with no uncertainty.

```typescript
import { syntacticConfidence, deterministic } from '../epistemics/confidence.js';

// For syntactic operations, use deterministic confidence
const parseResult = parseAST(source);
const confidence = syntacticConfidence(parseResult.success);
// Result: { type: 'deterministic', value: 1.0 or 0.0, reason: 'operation_succeeded' }

// Or with custom reason
const fileExists = await fs.access(path).then(() => true).catch(() => false);
const fileConfidence = deterministic(fileExists, 'file_access_check');
```

**When to use**: Parsing, file operations, exact string matching, schema validation.

### D2: Sequential Composition -> min(steps)

A pipeline is only as strong as its weakest link.

```typescript
import { sequenceConfidence, deriveSequentialConfidence } from '../epistemics/confidence.js';

// For sequential pipelines
const step1Confidence = await doStep1();  // ConfidenceValue
const step2Confidence = await doStep2();  // ConfidenceValue
const step3Confidence = await doStep3();  // ConfidenceValue

// Basic sequential (no calibration tracking)
const pipelineConfidence = sequenceConfidence([
  step1Confidence,
  step2Confidence,
  step3Confidence,
]);

// With calibration status tracking
const trackedConfidence = deriveSequentialConfidence([
  step1Confidence,
  step2Confidence,
  step3Confidence,
]);
```

**When to use**: Multi-step analysis, pipelines, waterfall processes.

### D3: Parallel-All Composition -> product(branches)

All branches must succeed - independent AND operation.

```typescript
import { parallelAllConfidence, deriveParallelAllConfidence } from '../epistemics/confidence.js';

// For independent parallel operations where ALL must succeed
const searchResults = await Promise.all([
  searchByKeyword(),
  searchBySemantic(),
  searchByStructure(),
]);

// Basic (assumes independence)
const allConfidence = parallelAllConfidence(
  searchResults.map(r => r.confidence)
);

// With correlation adjustment (if branches share data sources)
const correlatedConfidence = deriveParallelAllConfidence(
  searchResults.map(r => r.confidence),
  { correlation: 0.5 }  // 0 = independent, 1 = perfectly correlated
);
```

**When to use**: Multiple independent checks that all must pass, parallel validation.

**Independence warning**: If branches share underlying data or LLM calls, they are correlated. Use `deriveParallelAllConfidence` with correlation adjustment.

### D4: Parallel-Any Composition -> 1 - product(1 - branches)

At least one branch must succeed - independent OR operation.

```typescript
import { parallelAnyConfidence, deriveParallelAnyConfidence } from '../epistemics/confidence.js';

// For operations where ANY success is sufficient
const fallbackResults = await Promise.allSettled([
  primarySearch(),
  fallbackSearch(),
  cacheSearch(),
]);

// Basic (assumes independence)
const anyConfidence = parallelAnyConfidence(
  fallbackResults.filter(r => r.status === 'fulfilled').map(r => r.value.confidence)
);

// With relaxed absent handling (useful for OR semantics)
const relaxedConfidence = deriveParallelAnyConfidence(
  results.map(r => r.confidence),
  {
    absentHandling: 'relaxed',  // Compute from non-absent branches only
    correlation: 0.3
  }
);
```

**When to use**: Fallback chains, redundant sources, any-match searches.

### D5: LLM Operations Before Calibration -> Absent

Be honest when you don't have calibration data.

```typescript
import { uncalibratedConfidence, absent } from '../epistemics/confidence.js';

// For new LLM operations without calibration data
const llmResult = await callLLM(prompt);

// If no calibration data exists, be honest
const confidence = uncalibratedConfidence();
// Result: { type: 'absent', reason: 'uncalibrated' }

// Or with more specific reason
const newFeatureConfidence = absent('insufficient_data');
```

**When to use**: New LLM operations, novel analysis types, features without outcome tracking.

### D6: LLM Operations After Calibration -> Measured

Use real measurement data when available.

```typescript
import { measuredConfidence } from '../epistemics/confidence.js';

// After collecting calibration data
const calibrationData = await getCalibrationReport('semantic_search');

const confidence = measuredConfidence({
  datasetId: calibrationData.datasetId,
  sampleSize: calibrationData.sampleSize,
  accuracy: calibrationData.accuracy,
  ci95: calibrationData.confidenceInterval,
});
// Result: MeasuredConfidence with full provenance
```

**When to use**: Any operation with historical outcome data.

---

## Construction Template

Use this template as a starting point for new constructions.

```typescript
/**
 * @fileoverview MyConstruction - Brief description
 *
 * A composed construction that combines:
 * - [Primitive 1] for [purpose]
 * - [Primitive 2] for [purpose]
 * - etc.
 *
 * Composes:
 * - Query API for semantic search
 * - Evidence Ledger for traceability
 * - Confidence System for uncertainty quantification
 */

import type { LiBrainian } from '../api/LiBrainian.js';
import type {
  ConfidenceValue,
  MeasuredConfidence,
  BoundedConfidence,
  AbsentConfidence
} from '../epistemics/confidence.js';
import {
  sequenceConfidence,
  bounded,
  absent,
  getNumericValue,
} from '../epistemics/confidence.js';
import type { ContextPack } from '../types.js';

// ============================================================================
// TYPES
// ============================================================================

export interface MyInput {
  /** Description of field */
  field1: string;
  /** Optional field */
  field2?: number;
}

export interface MyReport {
  /** Original input */
  input: MyInput;

  /** Primary result */
  result: SomeResultType;

  /** Confidence in this analysis */
  confidence: ConfidenceValue;

  /** Evidence trail - ALWAYS include */
  evidenceRefs: string[];

  /** Analysis timing - ALWAYS include */
  analysisTimeMs: number;
}

// ============================================================================
// CONSTRUCTION
// ============================================================================

export class MyConstruction {
  private LiBrainian: LiBrainian;

  constructor(LiBrainian: LiBrainian) {
    this.LiBrainian = LiBrainian;
  }

  /**
   * Main entry point - describe what this does.
   */
  async execute(input: MyInput): Promise<MyReport> {
    const startTime = Date.now();
    const evidenceRefs: string[] = [];

    // Step 1: Query LiBrainian for context
    const queryResult = await this.LiBrainian.queryOptional({
      intent: `Describe what you're looking for: ${input.field1}`,
      depth: 'L2',  // L1 for quick, L2 for thorough, L3 for deep
      taskType: 'understand',  // or 'debug', 'implement', 'review'
    });
    evidenceRefs.push(`query:${input.field1}`);

    // Step 2: Process results
    const processedResults = this.processResults(queryResult.packs || []);
    evidenceRefs.push(`processed:${processedResults.length}_items`);

    // Step 3: Additional analysis with confidence tracking
    const analysisResults: ConfidenceValue[] = [];
    for (const item of processedResults) {
      const stepResult = await this.analyzeItem(item);
      analysisResults.push(stepResult.confidence);
      evidenceRefs.push(`analyze:${item.id}`);
    }

    // Step 4: Compute overall confidence
    const confidence = this.computeConfidence(processedResults, analysisResults);

    // Step 5: Return with evidence trail
    return {
      input,
      result: this.buildResult(processedResults),
      confidence,
      evidenceRefs,
      analysisTimeMs: Date.now() - startTime,
    };
  }

  /**
   * Process context packs into domain objects.
   */
  private processResults(packs: ContextPack[]): ProcessedItem[] {
    // Implementation
    return [];
  }

  /**
   * Analyze a single item with confidence.
   */
  private async analyzeItem(item: ProcessedItem): Promise<{ confidence: ConfidenceValue }> {
    // Implementation with proper confidence
    return {
      confidence: bounded(
        0.6,
        0.9,
        'theoretical',
        'Based on pattern matching accuracy in similar codebases'
      )
    };
  }

  /**
   * Compute overall confidence from component confidences.
   */
  private computeConfidence(
    results: ProcessedItem[],
    stepConfidences: ConfidenceValue[]
  ): ConfidenceValue {
    // No results = absent confidence
    if (results.length === 0) {
      return absent('insufficient_data');
    }

    // If all steps have confidence, derive from them
    if (stepConfidences.length > 0) {
      return sequenceConfidence(stepConfidences);
    }

    // Otherwise, use bounded estimate with justification
    return bounded(
      0.5,
      0.8,
      'theoretical',
      'Based on semantic search accuracy without calibration data'
    );
  }

  /**
   * Build final result from processed items.
   */
  private buildResult(items: ProcessedItem[]): SomeResultType {
    // Implementation
    return {};
  }
}

// ============================================================================
// FACTORY
// ============================================================================

export function createMyConstruction(LiBrainian: LiBrainian): MyConstruction {
  return new MyConstruction(LiBrainian);
}
```

---

## Best Practices

### 1. Always Track Evidence Refs

Every operation that contributes to the result should be recorded in `evidenceRefs`.

```typescript
// Good: Track every step
const evidenceRefs: string[] = [];
evidenceRefs.push(`semantic_search:${query}`);
evidenceRefs.push(`pattern_match:${patterns.length}_found`);
evidenceRefs.push(`call_graph:${depth}_depth`);

// Bad: No tracking
const result = await doAnalysis();
return { result };  // Where did this come from?
```

### 2. Use Bounded Confidence for Uncertain Results

When you have theoretical bounds but no empirical data.

```typescript
// Good: Explicit bounds with citation
const confidence = bounded(
  0.4,
  0.7,
  'theoretical',
  'Async issues are hard to diagnose statically - based on debugging pattern literature'
);

// Bad: Magic number
const confidence = { type: 'measured', value: 0.55, ... };  // Where does 0.55 come from?
```

### 3. Use Absent Confidence for "I Don't Know"

Be honest when you genuinely don't know.

```typescript
// Good: Honest uncertainty
if (stackFrames.length === 0 && hypotheses.length === 0) {
  return absent('insufficient_data');
}

// Bad: Pretending to know
if (stackFrames.length === 0) {
  return { type: 'measured', value: 0.5, ... };  // This is a guess, not a measurement
}
```

### 4. Include Timing Information

Always track how long analysis takes for performance monitoring.

```typescript
const startTime = Date.now();
// ... analysis ...
return {
  result,
  analysisTimeMs: Date.now() - startTime,
};
```

### 5. Use Proper Confidence Derivation Rules

Match the derivation rule to the operation type.

```typescript
// Sequential pipeline: D2 (min)
const pipelineConf = sequenceConfidence([step1, step2, step3]);

// Parallel checks all must pass: D3 (product)
const allPassConf = parallelAllConfidence([check1, check2, check3]);

// Fallback chain any can succeed: D4 (noisy-or)
const anySucceedConf = parallelAnyConfidence([primary, fallback1, fallback2]);
```

### 6. Extract Helper for Numeric Values

Use the provided helpers for safe extraction.

```typescript
import { getNumericValue, getEffectiveConfidence } from '../epistemics/confidence.js';

// Safe extraction (returns null for absent)
const value = getNumericValue(confidence);
if (value === null) {
  // Handle absent case
}

// Conservative extraction (0 for absent, low bound for bounded)
const effective = getEffectiveConfidence(confidence);
```

---

## Anti-patterns to Avoid

### 1. Swallowing Uncertainty (0.5 as Default)

Using 0.5 as a "neutral" confidence is dishonest - it claims measurement where none exists.

```typescript
// BAD: Magic 0.5
const confidence = {
  type: 'measured',
  value: 0.5,  // Where does this come from?
  measurement: { ... }
};

// GOOD: Honest uncertainty
const confidence = absent('uncalibrated');

// GOOD: Bounded estimate with justification
const confidence = bounded(
  0.3,
  0.7,
  'theoretical',
  'No calibration data; range based on similar semantic search tasks'
);
```

### 2. Missing Evidence Refs

Returning results without tracking where they came from.

```typescript
// BAD: No evidence trail
async execute(input: Input): Promise<Report> {
  const results = await this.analyze(input);
  return { results, confidence: ... };
}

// GOOD: Full evidence trail
async execute(input: Input): Promise<Report> {
  const evidenceRefs: string[] = [];

  const step1 = await this.step1(input);
  evidenceRefs.push(`step1:${step1.id}`);

  const step2 = await this.step2(step1);
  evidenceRefs.push(`step2:${step2.count}_results`);

  return { results: step2, confidence: ..., evidenceRefs };
}
```

### 3. Factory Functions for Confidence Instead of Object Literals

Creating confidence values through factories that hide the provenance.

```typescript
// BAD: Hidden factory
function makeConfidence(value: number): ConfidenceValue {
  return { type: 'measured', value, measurement: DEFAULT_MEASUREMENT };
}
const conf = makeConfidence(0.7);  // Where does 0.7 come from?

// GOOD: Explicit object literal with provenance
const conf: MeasuredConfidence = {
  type: 'measured',
  value: 0.7,
  measurement: {
    datasetId: 'error_pattern_matching_v2',
    sampleSize: 500,
    accuracy: 0.7,
    confidenceInterval: [0.65, 0.75],
    measuredAt: new Date().toISOString(),
  },
};
```

### 4. Uncalibrated Confidence Claims

Claiming measured confidence without actual calibration data.

```typescript
// BAD: Fake measurement
const confidence: MeasuredConfidence = {
  type: 'measured',
  value: pack.relevanceScore,  // This isn't calibrated!
  measurement: {
    datasetId: 'made_up',
    sampleSize: 1,
    accuracy: pack.relevanceScore,
    confidenceInterval: [0, 1],
    measuredAt: new Date().toISOString(),
  },
};

// GOOD: Bounded with justification
const confidence: BoundedConfidence = {
  type: 'bounded',
  low: Math.max(0, pack.relevanceScore - 0.2),
  high: Math.min(1, pack.relevanceScore + 0.1),
  basis: 'theoretical',
  citation: 'Relevance scores are heuristic; bounds estimated from query type',
};
```

### 5. Ignoring Absent Inputs in Derivation

Silently treating absent confidence as 0.5 or 1.0.

```typescript
// BAD: Ignoring absent
const values = confidences.map(c => {
  if (c.type === 'absent') return 0.5;  // Why 0.5?
  return getNumericValue(c);
});
return product(values);

// GOOD: Propagate absent
const values = confidences.map(getNumericValue);
if (values.some(v => v === null)) {
  return absent('uncalibrated');  // Or use relaxed OR semantics
}
return parallelAllConfidence(confidences);
```

### 6. Not Tracking Calibration Status

Deriving confidence without tracking whether inputs are calibrated.

```typescript
// BAD: No calibration tracking
const derived = {
  type: 'derived',
  value: minValue,
  formula: 'min(steps)',
  inputs: steps.map((s, i) => ({ name: `step_${i}`, confidence: s })),
};

// GOOD: Track calibration status
import { computeCalibrationStatus } from '../epistemics/confidence.js';

const calibrationStatus = computeCalibrationStatus(steps);
const derived = {
  type: 'derived',
  value: minValue,
  formula: 'min(steps)',
  inputs: steps.map((s, i) => ({ name: `step_${i}`, confidence: s })),
  calibrationStatus,  // 'preserved', 'degraded', or 'unknown'
};
```

---

## Real Examples

See the existing constructions in `src/constructions/` for real-world examples:

- **`RefactoringSafetyChecker`**: Usage analysis + breaking change detection + test coverage
- **`BugInvestigationAssistant`**: Stack parsing + hypothesis generation + similar bug detection
- **`FeatureLocationAdvisor`**: Semantic search + pattern matching + call graph traversal
- **`CodeQualityReporter`**: Quality metrics + issue detection + recommendations
- **`ArchitectureVerifier`**: Rule validation + compliance scoring + violation reporting
- **`SecurityAuditHelper`**: Vulnerability scanning + severity assessment + remediation
- **`ConstructionCalibrationTracker`**: Prediction tracking + outcome recording + calibration reports
