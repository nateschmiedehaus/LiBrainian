# Epistemic Infrastructure Inventory

## Overview

This document provides a comprehensive inventory of all epistemic types, classes, primitives, operators, and computational patterns in Librarian's epistemic infrastructure. The epistemics module (`src/epistemics/`) implements a principled approach to tracking confidence, calibration, and evidence provenance.

**Core Design Principle**: No arbitrary numbers. Every confidence value MUST have provenance.

---

## 1. Core Confidence System

### 1.1 ConfidenceValue Union Type

**Location**: `/src/epistemics/confidence.ts`

The fundamental discriminated union representing confidence with mandatory provenance:

```typescript
type ConfidenceValue =
  | DeterministicConfidence
  | DerivedConfidence
  | MeasuredConfidence
  | BoundedConfidence
  | AbsentConfidence;
```

#### 1.1.1 DeterministicConfidence

**Purpose**: Logically certain outcomes (1.0 or 0.0)

**Type Signature**:
```typescript
interface DeterministicConfidence {
  readonly type: 'deterministic';
  readonly value: 1.0 | 0.0;
  readonly reason: string;
}
```

**Use Cases**: AST parsing, regex matching, file reading, exact string matches

**Mathematical Basis**: Boolean logic - operations either succeed or fail with certainty

**Key Operations**:
- `syntacticConfidence(success: boolean): DeterministicConfidence`
- `deterministic(success: boolean, reason: string): DeterministicConfidence`

---

#### 1.1.2 DerivedConfidence

**Purpose**: Computed from other confidence values via explicit formula

**Type Signature**:
```typescript
interface DerivedConfidence {
  readonly type: 'derived';
  readonly value: number;
  readonly formula: string;
  readonly inputs: ReadonlyArray<{ name: string; confidence: ConfidenceValue }>;
  readonly calibrationStatus?: 'preserved' | 'degraded' | 'unknown';
  readonly formulaAst?: FormulaNode;
  readonly provenFormula?: ProvenFormulaNode;
}
```

**Use Cases**: Composed operations, pipelines, aggregations

**Mathematical Basis**: Compositional semantics - confidence flows through operations

**Key Operations**:
- `sequenceConfidence(steps: ConfidenceValue[]): ConfidenceValue` - min(steps)
- `parallelAllConfidence(branches: ConfidenceValue[]): ConfidenceValue` - product(branches)
- `parallelAnyConfidence(branches: ConfidenceValue[]): ConfidenceValue` - 1 - product(1 - branches)
- `andConfidence(a, b): ConfidenceValue` - min(a, b)
- `orConfidence(a, b): ConfidenceValue` - max(a, b)
- `combinedConfidence(inputs with weights): ConfidenceValue` - weighted average

---

#### 1.1.3 MeasuredConfidence

**Purpose**: Empirically measured from historical outcomes

**Type Signature**:
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

**Use Cases**: LLM operations after calibration, any operation with outcome data

**Mathematical Basis**: Frequentist probability - observed success rate with confidence intervals

**Key Operations**:
- `measuredConfidence(data: CalibrationResult): MeasuredConfidence`

---

#### 1.1.4 BoundedConfidence

**Purpose**: Range estimate with explicit theoretical basis

**Type Signature**:
```typescript
interface BoundedConfidence {
  readonly type: 'bounded';
  readonly low: number;
  readonly high: number;
  readonly basis: 'theoretical' | 'literature' | 'formal_analysis';
  readonly citation: string;
}
```

**Use Cases**: Operations with theoretical bounds but no empirical data yet

**Mathematical Basis**: Interval arithmetic, worst-case analysis

**Key Operations**:
- `bounded(low, high, basis, citation): BoundedConfidence`

---

#### 1.1.5 AbsentConfidence

**Purpose**: Honest acknowledgment that confidence is genuinely unknown

**Type Signature**:
```typescript
interface AbsentConfidence {
  readonly type: 'absent';
  readonly reason: 'uncalibrated' | 'insufficient_data' | 'not_applicable';
}
```

**Use Cases**: Operations before calibration, new primitives

**Mathematical Basis**: Three-valued logic - unknown is a valid state

**Key Operations**:
- `absent(reason?): AbsentConfidence`
- `uncalibratedConfidence(): AbsentConfidence`

---

### 1.2 Formula AST System

**Location**: `/src/epistemics/confidence.ts` and `/src/epistemics/formula_ast.ts`

#### 1.2.1 FormulaNode Types

```typescript
type FormulaNode =
  | FormulaValueNode    // Leaf node: { type: 'value', name: string }
  | FormulaMinNode      // { type: 'min', children: FormulaNode[] }
  | FormulaMaxNode      // { type: 'max', children: FormulaNode[] }
  | FormulaProductNode  // { type: 'product', children: FormulaNode[] }
  | FormulaSumNode      // { type: 'sum', children: FormulaNode[] }
  | FormulaScaleNode;   // { type: 'scale', factor: number, child: FormulaNode }
```

**Purpose**: Type-safe formula manipulation, programmatic evaluation, serialization

**Key Operations**:
- `formulaToString(node: FormulaNode): string`
- `evaluateFormula(node: FormulaNode, values: Map<string, number>): number`
- `createFormula(operation, inputNames): FormulaNode`
- `isFormulaNode(value): value is FormulaNode`

#### 1.2.2 ProvenFormulaNode (Type-Safe AST)

**Location**: `/src/epistemics/formula_ast.ts`

Provides a type-safe AST with proof terms that guarantee formula validity by construction.

**Key Operations**:
- `migrateStringFormula(formula: string, inputNames: string[]): ProvenFormulaNode | Error`
- `provenFormulaToString(node: ProvenFormulaNode): string`

---

### 1.3 Derivation Rules (D1-D7)

| Rule | Description | Formula | Factory Function |
|------|-------------|---------|------------------|
| D1 | Syntactic Operations | 1.0 or 0.0 | `syntacticConfidence()` |
| D2 | Sequential Composition | min(steps) | `sequenceConfidence()` |
| D3 | Parallel-All | product(branches) | `parallelAllConfidence()` |
| D4 | Parallel-Any | 1 - product(1 - branches) | `parallelAnyConfidence()` |
| D5 | Uncalibrated LLM | Absent | `uncalibratedConfidence()` |
| D6 | Calibrated LLM | Measured | `measuredConfidence()` |
| D7 | Boundary Enforcement | Type system | `assertConfidenceValue()` |

---

### 1.4 Correlation-Aware Derivation

**Location**: `/src/epistemics/confidence.ts`

**Purpose**: Handle correlated inputs that violate independence assumptions

**Interfaces**:
```typescript
interface CorrelationOptions {
  correlation?: number; // 0-1, where 0=independent, 1=perfectly correlated
}

interface ParallelAnyOptions extends CorrelationOptions {
  absentHandling?: 'strict' | 'relaxed';
}
```

**Key Operations**:
- `deriveParallelAllConfidence(branches, options): ConfidenceValue` - interpolates between product (rho=0) and min (rho=1)
- `deriveParallelAnyConfidence(branches, options): ConfidenceValue` - interpolates between noisy-or (rho=0) and max (rho=1)
- `deriveSequentialConfidence(steps): ConfidenceValue` - with calibration tracking
- `deriveParallelConfidence(branches): ConfidenceValue` - with calibration tracking

**Mathematical Basis**: Linear interpolation based on correlation coefficient

---

### 1.5 Degradation Handlers

**Purpose**: Graceful handling when confidence is absent or insufficient

**Key Operations**:
- `getNumericValue(conf): number | null` - extract numeric value, null for absent
- `getEffectiveConfidence(conf): number` - conservative defaults (lower bound for bounded, 0 for absent)
- `selectWithDegradation<T>(items): T | null` - equal weighting when no confidence data
- `checkConfidenceThreshold(conf, minConfidence): ExecutionBlockResult` - gate operations
- `reportConfidenceStatus(conf): ConfidenceStatusReport` - user-visible explanation

---

## 2. Calibration Laws

### 2.1 Semilattice Structure

**Location**: `/src/epistemics/calibration_laws.ts`

**Mathematical Foundation**: Bounded semilattice where:
- Meet (AND) = min
- Join (OR) = max
- Top = deterministic(1.0)
- Bottom = absent

```typescript
interface Semilattice<T> {
  meet: (a: T, b: T) => T;
  join: (a: T, b: T) => T;
  top: T;
  bottom: T;
  verifyLaws: (samples: T[]) => LawCheckResult[];
}

const ConfidenceSemilattice: Semilattice<ConfidenceValue>;
```

### 2.2 Algebraic Laws

The five fundamental semilattice laws that confidence composition must satisfy:

| Law | Symbol | Description |
|-----|--------|-------------|
| Associativity | (a AND b) AND c = a AND (b AND c) | Grouping doesn't matter |
| Commutativity | a AND b = b AND a | Order doesn't matter |
| Idempotence | a AND a = a | Self-combination yields self |
| Identity | a AND 1 = a | Combining with top yields self |
| Absorption | a AND (a OR b) = a | Meet absorbs join |

**Law Verification Functions**:
- `checkAssociativity<T>(op, values, eq): LawCheckResult`
- `checkCommutativity<T>(op, values, eq): LawCheckResult`
- `checkIdempotence<T>(op, values, eq): LawCheckResult`
- `checkIdentity<T>(op, values, identity, eq): LawCheckResult`
- `checkAbsorption<T>(meet, join, values, eq): LawCheckResult`
- `verifyAllLaws<T>(meet, join, values, meetIdentity, joinIdentity, eq)`

### 2.3 Calibration Rules

**Purpose**: Track how calibration status propagates through composition

```typescript
interface CalibrationRule {
  name: string;
  description: string;
  operation: string;
  apply: (inputs: CalibrationStatus[]) => CalibrationStatus;
}
```

**Rules** (CALIBRATION_RULES array):
- `preserved_through_min`: min of preserved values is preserved
- `preserved_through_max`: max of preserved values is preserved
- `preserved_through_product`: product of preserved values is preserved (assuming independence)
- `preserved_through_noisy_or`: noisy-or of preserved values is preserved

**Principle**: Calibration is only preserved if ALL inputs are preserved

### 2.4 CalibrationTracker

**Purpose**: Trace calibration status through computation pipelines

```typescript
class CalibrationTracker {
  constructor(initialStatus: CalibrationStatus);
  applyOperation(operation: string, inputs: CalibrationStatus[]): CalibrationStatus;
  getStatus(): CalibrationStatus;
  getTrace(): CalibrationTrace[];
  reset(newStatus: CalibrationStatus): void;
}
```

---

## 3. Calibration System

### 3.1 Core Calibration

**Location**: `/src/epistemics/calibration.ts`

#### 3.1.1 Calibration Data Structures

```typescript
interface CalibrationPoint {
  predicted: number;
  actual: boolean;
  timestamp?: number;
  category?: string;
}

interface CalibrationBin {
  predicted: number;
  actual: number;
  count: number;
  low: number;
  high: number;
}

interface CalibrationReport {
  datasetId: string;
  bins: CalibrationBin[];
  expectedCalibrationError: number;
  sampleSize: number;
  brierScore?: number;
  logLoss?: number;
  calibrationCurve?: Array<[number, number]>;
}
```

#### 3.1.2 Calibration Computation

**Key Functions**:
- `computeCalibrationCurve(points, numBins): CalibrationBin[]`
- `computeExpectedCalibrationError(bins): number` - ECE metric
- `computeBrierScore(points): number` - proper scoring rule
- `computeLogLoss(points, epsilon): number` - cross-entropy loss
- `computeWilsonInterval(successes, total, confidence): [number, number]` - confidence intervals

#### 3.1.3 Isotonic Regression Calibration

**Purpose**: Transform raw scores to calibrated probabilities using Pool Adjacent Violators (PAV) algorithm

```typescript
function isotonicCalibration(points: CalibrationPoint[]): CalibrationPoint[]
```

**Mathematical Basis**: Preserves order while ensuring monotonicity

#### 3.1.4 Bootstrap Calibration

**Purpose**: Calibration for cold-start scenarios with limited data

```typescript
interface BootstrapCalibrationOptions {
  priorMean?: number;
  priorStrength?: number;
  minSamples?: number;
  maxSamples?: number;
}

function bootstrapCalibration(
  points: CalibrationPoint[],
  options?: BootstrapCalibrationOptions
): CalibrationReport
```

**Mathematical Basis**: Bayesian shrinkage toward prior

#### 3.1.5 PAC-Based Sample Thresholds

**Purpose**: Determine minimum samples needed for reliable calibration

```typescript
function computeMinSamplesForCalibration(
  epsilon: number,
  delta: number
): number
```

**Mathematical Basis**: Hoeffding's inequality from Valiant's PAC learning framework

Formula: `n >= ln(2/delta) / (2 * epsilon^2)`

#### 3.1.6 Smooth ECE

**Purpose**: Kernel density-based smooth Expected Calibration Error

```typescript
function computeSmoothECE(
  points: CalibrationPoint[],
  bandwidth?: number
): number
```

**Mathematical Basis**: Kernel density estimation avoids binning artifacts

---

## 4. Defeater Calculus

### 4.1 Pollock's Defeater Theory

**Location**: `/src/epistemics/defeaters.ts`

**Philosophical Basis**: John Pollock's work on defeasible reasoning

#### 4.1.1 Defeater Types

```typescript
type DefeaterType = 'rebutting' | 'undercutting' | 'undermining';
```

| Type | Description | Example |
|------|-------------|---------|
| Rebutting | Directly contradicts the claim | "The function does NOT return void" vs "The function returns void" |
| Undercutting | Attacks the inference link | "The log was written before the fix was deployed" |
| Undermining | Questions the evidence quality | "That test file is from a deprecated branch" |

#### 4.1.2 Defeater Status

```typescript
type DefeaterStatus = 'potential' | 'active' | 'defeated' | 'resolved';
```

#### 4.1.3 Defeater Interface

```typescript
interface Defeater {
  id: string;
  type: DefeaterType;
  status: DefeaterStatus;
  targetClaimId: string;
  sourceClaimId?: string;
  description: string;
  strength: number;
  createdAt: Date;
  resolvedAt?: Date;
  resolutionNote?: string;
}
```

#### 4.1.4 DefeatGraph Class

**Purpose**: Manages the graph of claims and defeaters

```typescript
class DefeatGraph {
  addClaim(claim: DefeatClaim): void;
  addDefeater(defeater: Defeater): void;
  getActiveDefeatersFor(claimId: string): Defeater[];
  resolveDefeater(defeaterId: string, note: string): void;
  computeEffectiveConfidence(claimId: string): number;
  getUndefeatedClaims(): DefeatClaim[];
  getRejectedClaims(): DefeatClaim[];
}
```

#### 4.1.5 Priority Calculation

```typescript
interface PriorityFactors {
  specificity: number;   // More specific evidence wins
  recency: number;       // More recent evidence wins
  reliability: number;   // More reliable sources win
}

function calculateDefeaterPriority(defeater: Defeater, factors: PriorityFactors): number
```

---

## 5. Evidence System

### 5.1 Evidence Ledger

**Location**: `/src/epistemics/evidence_ledger.ts`

**Purpose**: Append-only ledger for evidence tracking with full audit trail

#### 5.1.1 Entry Types

```typescript
type EntryKind = 'claim' | 'observation' | 'inference' | 'tool_call' | 'user_feedback' | 'system_event';
```

#### 5.1.2 Ledger Interface

```typescript
interface IEvidenceLedger {
  append(entry: LedgerEntry): Promise<string>;
  query(criteria: LedgerQuery): Promise<LedgerEntry[]>;
  getEntry(entryId: string): Promise<LedgerEntry | null>;
  getSessionEntries(sessionId: string): Promise<LedgerEntry[]>;
}
```

#### 5.1.3 LedgerEntry Structure

```typescript
interface LedgerEntry {
  id: string;
  sessionId: string;
  kind: EntryKind;
  timestamp: Date;
  content: unknown;
  confidence?: ConfidenceValue;
  sources?: string[];
  derivedFrom?: string[];
  metadata?: Record<string, unknown>;
}
```

---

### 5.2 Evidence Graph Types

**Location**: `/src/epistemics/types.ts`

#### 5.2.1 Claim Structure

```typescript
interface Claim {
  id: ClaimId;
  type: ClaimType;
  subject: ClaimSubject;
  predicate: string;
  object?: unknown;
  confidence: ConfidenceValue;
  source: ClaimSource;
  status: ClaimStatus;
  signalStrength?: ClaimSignalStrength;
  createdAt: Date;
  updatedAt: Date;
}

type ClaimType = 'structural' | 'behavioral' | 'factual' | 'semantic';
type ClaimStatus = 'active' | 'defeated' | 'superseded' | 'retracted';
```

#### 5.2.2 Signal Strength Decomposition

```typescript
interface ClaimSignalStrength {
  retrieval: number;      // How well retrieved vs query
  structural: number;     // Type info, AST certainty
  semantic: number;       // Meaning understanding
  testExecution: number;  // Test verification
  recency: number;        // Freshness of evidence
}
```

#### 5.2.3 Evidence Edges

```typescript
type EvidenceEdgeType =
  | 'supports' | 'opposes' | 'assumes' | 'defeats'
  | 'rebuts' | 'undercuts' | 'undermines' | 'supersedes';

interface EvidenceEdge {
  id: string;
  type: EvidenceEdgeType;
  fromClaimId: ClaimId;
  toClaimId: ClaimId;
  strength: number;
  createdAt: Date;
}
```

#### 5.2.4 Higher-Order Defeat

```typescript
interface ExtendedDefeater extends Defeater {
  defeatedBy?: string[];  // IDs of defeaters that defeat this defeater
}
```

#### 5.2.5 Contradiction Tracking

```typescript
interface Contradiction {
  id: string;
  claimIds: [ClaimId, ClaimId];
  type: ContradictionType;
  detectedAt: Date;
  resolvedAt?: Date;
  resolution?: ContradictionResolution;
}

type ContradictionType = 'logical' | 'empirical' | 'temporal';
type ContradictionResolution = 'retraction' | 'supersession' | 'scope_narrowing' | 'evidence_upgrade';
```

---

## 6. Design-by-Contract System

### 6.1 Primitive Contracts

**Location**: `/src/epistemics/contracts.ts`

**Purpose**: Runtime verification of epistemic primitive correctness

#### 6.1.1 Contract Structure

```typescript
interface PrimitiveContract {
  id: ContractId;
  primitiveId: PrimitiveId;
  name: string;
  description: string;
  preconditions: ContractCondition[];
  postconditions: ContractCondition[];
  invariants: ContractCondition[];
  version: string;
}

interface ContractCondition {
  id: string;
  description: string;
  check: (context: ContractContext) => boolean;
  severity: 'error' | 'warning';
}
```

#### 6.1.2 ContractExecutor

```typescript
class ContractExecutor {
  registerContract(contract: PrimitiveContract): void;
  execute<T>(
    primitiveId: PrimitiveId,
    fn: () => T,
    context: ContractContext
  ): ContractExecutionResult<T>;
  getViolations(): ContractViolation[];
}
```

#### 6.1.3 Built-in Contracts

| Contract | Purpose |
|----------|---------|
| `SYNTACTIC_CONFIDENCE_CONTRACT` | Ensures syntactic ops return deterministic confidence |
| `SEQUENCE_CONFIDENCE_CONTRACT` | Validates min formula for sequential composition |
| `PARALLEL_ALL_CONTRACT` | Validates product formula for parallel-all |
| `PARALLEL_ANY_CONTRACT` | Validates noisy-or formula for parallel-any |
| `MEASURED_CONFIDENCE_CONTRACT` | Ensures measurement data integrity |

---

## 7. Computed Confidence

### 7.1 Signal-Based Confidence

**Location**: `/src/epistemics/computed_confidence.ts`

**Purpose**: Replace uniform 0.5 default with computed values based on evidence quality

#### 7.1.1 Signal Components

```typescript
interface ConfidenceSignals {
  structural: {
    typeAnnotationRatio: number;
    hasDocstring: boolean;
    docstringQuality: number;
    isExported: boolean;
    hasPublicAPI: boolean;
    complexity: 'low' | 'medium' | 'high';
    lineCount: number;
  };
  semantic: {
    purposeQuality: number;
    embeddingCohesion: number;
    hasClearResponsibility: boolean;
  };
  historical: {
    retrievalCount: number;
    retrievalSuccessRate: number;
    validationCount: number;
    validationPassRate: number;
    daysSinceLastAccess: number | null;
  };
  crossValidation: {
    extractorAgreementCount: number;
    extractorTotalCount: number;
    disagreements: string[];
  };
}
```

#### 7.1.2 Component Weights

```typescript
const COMPONENT_WEIGHTS = {
  structural: 0.50,
  semantic: 0.30,
  historical: 0.15,
  crossValidation: 0.05,
};
```

#### 7.1.3 Bounds

- **Floor**: 0.15 (never completely clueless)
- **Ceiling**: 0.85 (never completely certain)

#### 7.1.4 Key Operations

- `computeConfidence(signals): ComputedConfidenceResult`
- `extractSignalsFromFunction(fn, options): ConfidenceSignals`
- `extractSignalsFromFile(file, options): ConfidenceSignals`
- `extractSignalsFromContextPack(pack, options): ConfidenceSignals`
- `computeConfidenceBatch(entities): Map<string, ComputedConfidenceResult>`
- `computeConfidenceStats(confidences): StatisticalSummary`

---

## 8. Task Validation

### 8.1 Epistemic Task Validation

**Location**: `/src/epistemics/task_validation.ts`

**Purpose**: Validate task quality based on epistemic criteria

#### 8.1.1 Validation Dimensions

- Claim completeness
- Evidence sufficiency
- Confidence calibration
- Defeater resolution
- Temporal consistency

---

## 9. Verification System

### 9.1 Entailment Checker

**Location**: `/src/evaluation/entailment_checker.ts`

**Purpose**: Verify whether claims about code are entailed by source code (hallucination detection)

#### 9.1.1 Entailment Verdicts

```typescript
type EntailmentVerdict = 'entailed' | 'contradicted' | 'neutral';
```

| Verdict | Meaning |
|---------|---------|
| entailed | Claim is supported by evidence |
| contradicted | Claim conflicts with evidence |
| neutral | Insufficient evidence to verify |

#### 9.1.2 Claim Types

```typescript
type ClaimType = 'structural' | 'behavioral' | 'factual';
```

#### 9.1.3 EntailmentChecker Class

```typescript
class EntailmentChecker {
  extractClaims(response: string): Claim[];
  checkEntailment(claim: Claim, facts: ASTFact[], context: string[]): EntailmentResult;
  findEvidence(claim: Claim, facts: ASTFact[], context: string[]): EntailmentEvidence[];
  checkResponse(response: string, repoPath: string): Promise<EntailmentReport>;
}
```

#### 9.1.4 Claim Extraction Patterns

40+ regex patterns for extracting claims about:
- Function return types
- Parameter counts and types
- Class inheritance/implementation
- Import sources
- Method existence
- Async/static/abstract modifiers
- And more...

### 9.2 Verification Plans

**Location**: `/src/api/verification_plans.ts` and `/src/strategic/verification_plan.ts`

#### 9.2.1 VerificationPlan Structure

```typescript
interface VerificationPlan {
  id: string;
  target: string;
  methods: VerificationMethod[];
  expectedObservations: string[];
  cost?: VerificationPlanCost;
  risk?: string[];
  artifacts?: string[];
  createdAt: string;
  updatedAt: string;
}

interface VerificationMethod {
  type: 'code_review' | 'automated_test' | 'manual_test';
  description: string;
  automatable: boolean;
}
```

---

## 10. Quality Assessment

### 10.1 Quality Issue Registry

**Location**: `/src/quality/issue_registry.ts`

#### 10.1.1 Issue Categories

```typescript
type IssueCategory =
  | 'complexity' | 'size' | 'coupling' | 'dead_code' | 'test_coverage'
  | 'documentation' | 'security' | 'architecture' | 'naming' | 'duplication' | 'debt';
```

#### 10.1.2 Issue Severity and Status

```typescript
type IssueSeverity = 'critical' | 'major' | 'minor' | 'info';
type IssueStatus = 'open' | 'claimed' | 'in_progress' | 'resolved' | 'wont_fix' | 'false_positive';
```

#### 10.1.3 QualityIssueRegistry Class

```typescript
class QualityIssueRegistry {
  registerIssue(issue): Promise<QualityIssue>;
  query(q: IssueQuery): QualityIssue[];
  getActionableIssues(limit): QualityIssue[];
  getQuickWins(maxEffortMinutes, limit): QualityIssue[];
  getCriticalIssues(limit): QualityIssue[];
  claimIssue(issueId, agentId, expectedMinutes?): IssueClaim | null;
  resolveIssue(issueId, agentId, note?): boolean;
}
```

### 10.2 Issue Detector

**Location**: `/src/quality/issue_detector.ts`

**Detectors**:
- Long method detection (>100 lines)
- Too many parameters (>5)
- Low confidence functions (<0.5)
- Missing documentation
- Large files (>500 lines)
- High fan-in/fan-out
- Dead code (unreachable functions)

### 10.3 World-Class Standards

**Location**: `/src/quality/world_class_standards.ts`

**12 Quality Dimensions**:
1. Correctness
2. Reliability
3. Security
4. Performance
5. Readability
6. Testability
7. Modularity
8. Extensibility
9. Observability
10. Resilience
11. Deployability
12. Documentation

**Inspiration Sources**:
- Google's software engineering practices
- NASA's software safety standards
- Microsoft's Security Development Lifecycle
- Netflix's chaos engineering principles
- Stripe's API design guidelines

---

## 11. Composition Patterns

### 11.1 Sequential Composition

**Pattern**: Pipeline of operations where each step depends on previous
**Formula**: min(step_confidences)
**Rationale**: Chain is only as strong as its weakest link

### 11.2 Parallel-All Composition

**Pattern**: Multiple independent operations that ALL must succeed
**Formula**: product(branch_confidences)
**Rationale**: Probability of independent AND (assuming independence)

### 11.3 Parallel-Any Composition

**Pattern**: Multiple independent operations where ANY can succeed
**Formula**: 1 - product(1 - branch_confidences)
**Rationale**: Probability of independent OR (noisy-or model)

### 11.4 Correlation-Adjusted Composition

**Pattern**: Parallel operations with known correlation
**Formula**: Linear interpolation between independent and perfectly correlated cases
**Rationale**: Handles violation of independence assumption

### 11.5 Weighted Combination

**Pattern**: Multiple sources with different reliability weights
**Formula**: weighted_average
**Rationale**: Expert combination, ensemble methods

### 11.6 Temporal Decay

**Pattern**: Confidence decreases over time
**Formula**: original * 0.5^(age/halflife)
**Rationale**: Stale knowledge is less reliable

---

## 12. Identified Gaps

### 12.1 Implementation Gaps

1. **Cross-Module Integration**: Epistemics module is well-structured but integration with main pipeline needs verification
2. **Calibration Data Collection**: Infrastructure exists but calibration dataset collection not fully automated
3. **Higher-Order Defeat Cycles**: ExtendedDefeater supports defeat chains but cycle detection not implemented
4. **Correlation Estimation**: Correlation-aware derivation exists but no automatic correlation detection

### 12.2 Documentation Gaps

1. **Calibration Workflow**: How to run calibration, collect data, update measurements
2. **Contract Debugging**: How to interpret and fix contract violations
3. **Signal Tuning**: How to adjust computed confidence weights for domain-specific use

### 12.3 Testing Gaps

1. **Property-Based Tests**: Semilattice law verification exists but needs more comprehensive property testing
2. **Integration Tests**: End-to-end tests for full epistemic pipeline
3. **Calibration Benchmarks**: Standard benchmarks for calibration quality

---

## 13. Implementation Notes

### 13.1 Branded Types

The system uses branded types for type safety:
- `ClaimId` - Unique claim identifier
- `ContractId` - Contract identifier
- `PrimitiveId` - Primitive operation identifier
- `SessionId` - Evidence ledger session

### 13.2 Immutability

All confidence types use `readonly` modifiers to enforce immutability:
```typescript
readonly type: 'deterministic';
readonly value: 1.0 | 0.0;
```

### 13.3 Proven Formulas

The system is migrating from string-based formulas to proven formula ASTs for type safety:
- String formulas remain for backward compatibility
- `provenFormula` field contains type-safe AST when available
- `migrateStringFormula()` converts string formulas to proven ASTs

### 13.4 Error Handling

- `getNumericValue()` returns `null` for absent confidence
- Derivation functions propagate absent confidence appropriately
- Contract violations produce detailed diagnostic information

### 13.5 Mathematical References

- **Semilattice Theory**: Davey & Priestley, "Introduction to Lattices and Order"
- **Defeater Theory**: John Pollock's work on defeasible reasoning
- **PAC Learning**: Valiant's Probably Approximately Correct framework
- **Proper Scoring Rules**: Brier Score, Log Loss for calibration
- **Isotonic Regression**: Pool Adjacent Violators (PAV) algorithm
- **Confidence Intervals**: Wilson score interval for binomial proportions

---

## Appendix A: File Index

| File | Primary Responsibility |
|------|----------------------|
| `src/epistemics/index.ts` | Module exports (barrel file) |
| `src/epistemics/confidence.ts` | Core confidence types and derivation rules |
| `src/epistemics/calibration.ts` | Calibration computation, ECE, PAC bounds |
| `src/epistemics/calibration_laws.ts` | Semilattice algebra, law verification |
| `src/epistemics/computed_confidence.ts` | Signal-based confidence computation |
| `src/epistemics/contracts.ts` | Design-by-Contract for primitives |
| `src/epistemics/defeaters.ts` | Pollock's defeater theory |
| `src/epistemics/evidence_ledger.ts` | Append-only evidence tracking |
| `src/epistemics/formula_ast.ts` | Proven formula AST types |
| `src/epistemics/task_validation.ts` | Task validation framework |
| `src/epistemics/types.ts` | Evidence graph, claims, edges |
| `src/evaluation/entailment_checker.ts` | Claim entailment verification |
| `src/quality/index.ts` | Quality module exports |
| `src/quality/issue_detector.ts` | Quality issue detection |
| `src/quality/issue_registry.ts` | Issue tracking and management |
| `src/quality/world_class_standards.ts` | Engineering excellence rules |
| `src/api/verification_plans.ts` | Query verification plan creation |
| `src/strategic/verification_plan.ts` | Verification plan structures |

---

*Document generated: 2026-01-29*
*Librarian Epistemic Infrastructure v1.0*
