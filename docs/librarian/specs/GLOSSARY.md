# LiBrainian Glossary

> **Purpose**: Canonical definitions for all terms used across LiBrainian specifications.
> **Authority**: This file is authoritative. All specs MUST use these definitions.

---

## Core Concepts

### Claim
A statement about code that LiBrainian asserts to be true, with associated evidence and confidence.

```typescript
interface Claim {
  id: string;
  statement: string;          // What is being claimed
  evidence: EvidenceRef[];    // References to supporting evidence
  confidence: ConfidenceValue; // MUST use principled type, not raw number
  source: KnowledgeSource;    // How the claim was derived
  defeaters: Defeater[];      // What could invalidate this claim
}
```

### Confidence
A value representing LiBrainian's degree of belief in a claim. **MUST** use `ConfidenceValue` type - raw numbers are forbidden.

**The Five Valid Types** (no other forms allowed):

| Type | When to Use | Example |
|------|-------------|---------|
| **Deterministic** | Syntactic operations (AST, regex) | 1.0 or 0.0 |
| **Derived** | Composed from other confidences | `min(step1, step2)` |
| **Measured** | Empirically calibrated from outcomes | 0.73 ± 0.03 (n=847) |
| **Bounded** | Theoretical range with citation | [0.4, 0.8] from literature |
| **Absent** | Unknown - system degrades gracefully | `{ type: 'absent' }` |

**FORBIDDEN**: Raw numbers like `0.7` or any “labeled guess” wrapper - these are arbitrary guesses.

See [CONFIDENCE_REDESIGN.md](./CONFIDENCE_REDESIGN.md) for full specification.

### Evidence (CANONICAL DEFINITION)

A record of an observation or action that supports or refutes a claim.

**Authoritative V1 schema/API**:
- Spec: `docs/LiBrainian/specs/core/evidence-ledger.md`
- Code: `packages/LiBrainian/src/epistemics/evidence_ledger.ts`

**Rule**: Don’t define competing “EvidenceEntry” shapes in other specs. If we add sequence/checksums/checkpoints, they must be explicitly versioned extensions layered on top of V1 with a migration plan.

**Evidence is append-only**: Once recorded, evidence cannot be modified. This ensures audit trails are tamper-evident.

### Knowledge
Understanding that LiBrainian has about code, structured as claims with evidence.

```typescript
interface KnowledgeState {
  facts: Claim[];             // High-confidence, verified claims
  inferences: Claim[];        // Lower-confidence, derived claims
  unknowns: string[];         // Explicitly unknown things
  contradictions: Claim[][];  // Sets of conflicting claims
}
```

### Knowledge Source
How a piece of knowledge was derived. **Confidence is NOT inherent to the source type.**

```typescript
type KnowledgeSource =
  | 'syntactic'    // AST-derived, deterministic → DeterministicConfidence (1.0 or 0.0)
  | 'naming'       // From naming conventions → AbsentConfidence until calibrated
  | 'structural'   // From code structure → AbsentConfidence until calibrated
  | 'behavioral'   // From execution observation → AbsentConfidence until calibrated
  | 'semantic';    // LLM-synthesized → AbsentConfidence until calibrated
```

**CRITICAL**: Only `syntactic` has known confidence (1.0 for success, 0.0 for failure).
All other sources have `absent` confidence until calibration data exists.

**FORBIDDEN**: Claiming confidence ~0.6, ~0.8 etc. without calibration data.

---

## Technique System

### Primitive
The atomic unit of technique. A primitive describes a single operation with inputs, outputs, and confidence.

```typescript
interface TechniquePrimitive {
  id: string;
  name: string;
  description: string;
  inputs: PrimitiveIO[];
  outputs: PrimitiveIO[];
  confidence: ConfidenceValue;  // MUST use principled type
  tier: 1 | 2 | 3;              // Extraction tier
  preconditions: string[];
  postconditions: string[];
}
```

### Composition
A combination of primitives and operators that forms a complete technique.

```typescript
interface TechniqueComposition {
  id: string;
  name: string;
  primitives: TechniquePrimitive[];
  operators: TechniqueOperator[];
  expectedConfidence: ConfidenceValue;  // Derived from composition rules
}
```

### Operator
Combines primitives (sequence, parallel, conditional, etc.).

```typescript
type TechniqueOperator =
  | { type: 'sequence'; steps: string[] }
  | { type: 'parallel'; branches: string[] }
  | { type: 'conditional'; condition: string; then: string; else?: string }
  | { type: 'retry'; step: string; maxAttempts: number }
  | { type: 'checkpoint'; step: string; savepoint: string };
```

---

## Confidence System (Principled)

### ConfidenceValue (REPLACES QuantifiedValue)

**All epistemic claim confidence values MUST use this type.**

**Scope note**: LiBrainian currently uses many numeric 0–1 values for *ranking and heuristics* (e.g. relevance scores, similarity scores, internal “confidence” fields that are not calibrated). Those values must not be presented as calibrated confidence. The spec direction is to rename those fields to `score`/`signalStrength` (or wrap them in explicit score types). The `ConfidenceValue` boundary applies to **claim confidence** first.

```typescript
/**
 * A confidence value with MANDATORY provenance.
 * Raw numbers are NOT allowed.
 */
type ConfidenceValue =
  | DeterministicConfidence   // 1.0 or 0.0 for syntactic operations
  | DerivedConfidence         // Computed from other confidences
  | MeasuredConfidence        // Empirically calibrated
  | BoundedConfidence         // Range with citation
  | AbsentConfidence;         // Unknown - system handles gracefully

interface DeterministicConfidence {
  type: 'deterministic';
  value: 1.0 | 0.0;
  reason: string;
}

interface DerivedConfidence {
  type: 'derived';
  value: number;
  formula: string;
  inputs: { name: string; confidence: ConfidenceValue }[];
}

interface MeasuredConfidence {
  type: 'measured';
  value: number;
  measurement: {
    datasetId: string;
    sampleSize: number;
    accuracy: number;
    confidenceInterval: [number, number];
    measuredAt: string;
  };
}

interface BoundedConfidence {
  type: 'bounded';
  low: number;
  high: number;
  basis: 'theoretical' | 'literature' | 'formal_analysis';
  citation: string;
}

interface AbsentConfidence {
  type: 'absent';
  reason: 'uncalibrated' | 'insufficient_data' | 'not_applicable';
}
```

### DEPRECATED: QuantifiedValue and “labeled guess” wrappers

The old `QuantifiedValue` type with a “labeled guess” wrapper is **DEPRECATED for claim confidence**.

Why: it allowed arbitrary numbers. A labeled guess is still a guess.

Migration: all labeled-guess wrappers → `{ type: 'absent', reason: 'uncalibrated' }`

---

## Calibration

### Calibration Curve
A function mapping stated confidence to actual accuracy, computed from historical outcomes.

```typescript
interface CalibrationCurve {
  knowledgeType: KnowledgeSource;
  bins: { statedConfidence: number; actualAccuracy: number; sampleSize: number }[];
  computedAt: Date;
  datasetId: string;
}
```

### Outcome
The result of using a claim in practice.

```typescript
type Outcome = 'correct' | 'incorrect' | 'unknown';
```

---

## Infrastructure

### Capability
Something the environment can do.

```typescript
type Capability =
  | 'llm:chat'
  | 'llm:embedding'
  | 'storage:sqlite'
  | 'storage:vector'
  | 'tool:filesystem'
  | 'tool:git'
  | 'tool:mcp';
```

### Capability Contract
What an operation requires and what's optional.

```typescript
interface CapabilityContract {
  required: Capability[];
  optional: Capability[];
  degradedMode: string;       // What happens if optional missing
}
```

### Evidence Ledger
The unified, append-only log of all observations and actions.

```typescript
interface EvidenceLedger {
  append(entry: Omit<EvidenceEntry, 'id' | 'timestamp'>): string;
  query(filter: Partial<EvidenceEntry>): EvidenceEntry[];
  replay(fromId: string): EvidenceEntry[];
  getChain(claimId: string): EvidenceEntry[];  // Evidence chain for a claim
}
```

---

## Execution

### Execution Context
Everything needed to execute a technique.

```typescript
interface ExecutionContext {
  tools: ToolRegistry;
  knowledge: KnowledgeState;
  llm: LlmProvider;
  budget: ResourceBudget;
  ledger: EvidenceLedger;     // All operations log here
  onProgress?: (progress: ExecutionProgress) => void;
}
```

### Execution Result
The outcome of executing a primitive or composition.

```typescript
interface ExecutionResult {
  status: 'success' | 'partial' | 'failed';
  outputs: Record<string, unknown>;
  verification: VerificationResult;
  resources: ResourceUsage;
  evidenceIds: string[];       // IDs of entries added to ledger
}
```

---

## Use Cases

### Use Case
A specific scenario where an agent uses LiBrainian.

```typescript
interface UseCase {
  id: number;                  // UC 1-20
  name: string;
  scenario: string;            // Natural language description
  currentRating: number;       // 1-10
  targetRating: number;        // Always 10
  primaryGap: string;          // What's missing
  enabledBy: string[];         // Which features enable this
}
```

---

## Cross-References

| Term | Primary Definition | Related Terms |
|------|-------------------|---------------|
| Claim | Core Concepts | Evidence, Confidence, Defeater |
| Confidence | Core Concepts | ConfidenceValue, Calibration |
| Evidence | Core Concepts | EvidenceLedger, EvidenceEntry |
| Knowledge | Core Concepts | KnowledgeState, KnowledgeSource |
| Primitive | Technique System | Composition, Operator |
| ConfidenceValue | Quantification | Derivation, Calibration |
| Calibration | Calibration | CalibrationCurve, Outcome |
| Capability | Infrastructure | CapabilityContract |
| Execution | Execution | ExecutionContext, ExecutionResult |
