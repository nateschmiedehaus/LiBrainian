# Formal Methods Integration Specification

> **Version**: 1.0.0
> **Status**: FRONTIER
> **Last Updated**: 2026-01-23
>
> **Theory Reference**: SMT-based program verification (Z3, CVC5). See de Moura & Bjorner (2008), Barrett et al. (2011).

---

## Executive Summary

**Current LiBrainian**: Claims are supported by evidence with calibrated confidence.
**Formal Methods Integration**: Claims are mechanically verified by SMT solvers.

Instead of probabilistic confidence, LiBrainian can produce **formal proofs**: machine-checked verification that a claim is proven, refuted with counterexample, or undecidable within the theory. This transforms certain claim categories from "high confidence" to "mathematically certain."

**Target**: 80%+ of verifiable claims resolved by SMT within reasonable time bounds.

---

## 1. The Problem with Probabilistic Confidence

### 1.1 Confidence Is Not Certainty

Even 99% confidence means 1-in-100 failure rate:
> "Function `validateInput` never returns null" [confidence: 0.95]

This leaves doubt. For safety-critical claims, we need certainty.

### 1.2 What Formal Methods Provide

SMT solvers can definitively answer:
1. **Proven**: The claim holds for ALL possible inputs
2. **Refuted**: Here is a concrete counterexample
3. **Unknown**: The claim is outside decidable theories or timed out

No probability - just logical certainty within the encoded theory.

---

## 2. SMT Solver Integration

### 2.1 Supported Solvers

```typescript
/**
 * Supported SMT solver backends.
 *
 * INVARIANT: All solvers implement SMT-LIB 2.6 standard
 * INVARIANT: Solver selection is based on theory requirements
 */
type SMTSolver =
  | 'z3'      // General purpose, excellent for bitvectors and arrays
  | 'cvc5'    // Strong for quantifiers and strings
  | 'auto';   // Automatic selection based on claim type

interface SMTSolverConfig {
  /** Which solver to use */
  solver: SMTSolver;

  /** Timeout in milliseconds */
  timeoutMs: number;

  /** Memory limit in MB */
  memoryLimitMb: number;

  /** Whether to generate models/counterexamples */
  produceModels: boolean;

  /** Whether to generate unsat cores for debugging */
  produceUnsatCores: boolean;

  /** Solver-specific options */
  options: Record<string, string>;
}

const DEFAULT_SMT_CONFIG: SMTSolverConfig = {
  solver: 'auto',
  timeoutMs: 30_000,
  memoryLimitMb: 2048,
  produceModels: true,
  produceUnsatCores: true,
  options: {},
};
```

### 2.2 Theory Selection

```typescript
/**
 * SMT theories used for different verification domains.
 */
type SMTTheory =
  | 'QF_LIA'    // Quantifier-free linear integer arithmetic
  | 'QF_LRA'    // Quantifier-free linear real arithmetic
  | 'QF_BV'     // Quantifier-free bitvectors (for overflow checks)
  | 'QF_AUFLIA' // Arrays + uninterpreted functions + linear int
  | 'QF_S'      // Strings (for string validation)
  | 'ALL';      // Combined theories

interface TheoryRequirements {
  /** Primary theory needed */
  primary: SMTTheory;

  /** Additional features required */
  features: Set<'quantifiers' | 'arrays' | 'strings' | 'bitvectors'>;

  /** Estimated decidability */
  decidability: 'decidable' | 'semi-decidable' | 'undecidable';
}

/**
 * Select appropriate theory based on claim type.
 */
function selectTheory(claim: FormalClaim): TheoryRequirements {
  switch (claim.category) {
    case 'null_safety':
    case 'bounds_check':
      return {
        primary: 'QF_LIA',
        features: new Set(),
        decidability: 'decidable',
      };
    case 'overflow':
      return {
        primary: 'QF_BV',
        features: new Set(['bitvectors']),
        decidability: 'decidable',
      };
    case 'array_bounds':
      return {
        primary: 'QF_AUFLIA',
        features: new Set(['arrays']),
        decidability: 'decidable',
      };
    case 'string_validation':
      return {
        primary: 'QF_S',
        features: new Set(['strings']),
        decidability: 'semi-decidable',
      };
    default:
      return {
        primary: 'ALL',
        features: new Set(['quantifiers']),
        decidability: 'semi-decidable',
      };
  }
}
```

---

## 3. Core Types

### 3.1 Verification Result

```typescript
/**
 * Result of SMT verification for a claim.
 *
 * INVARIANT: If status is 'proven', claim holds for ALL inputs
 * INVARIANT: If status is 'refuted', counterexample is provided
 * INVARIANT: If status is 'unknown', reason explains why
 */
interface SMTVerificationResult {
  /** Unique verification ID */
  id: VerificationId;

  /** The claim that was verified */
  claim: FormalClaim;

  /** Verification status */
  status: SMTStatus;

  /** Counterexample if refuted */
  counterexample?: Counterexample;

  /** Reason if unknown */
  unknownReason?: UnknownReason;

  /** Verification metadata */
  metadata: SMTVerificationMetadata;
}

type VerificationId = string & { readonly __brand: 'VerificationId' };

type SMTStatus =
  | 'proven'    // Claim is mathematically verified
  | 'refuted'   // Claim is false; counterexample provided
  | 'unknown';  // Could not determine (timeout, theory limits)

interface SMTVerificationMetadata {
  /** Solver used */
  solver: SMTSolver;

  /** Theory/logic used */
  theory: SMTTheory;

  /** Time spent in milliseconds */
  durationMs: number;

  /** Memory used in MB */
  memoryUsedMb: number;

  /** SMT-LIB script (for reproducibility) */
  smtLibScript: string;

  /** Verification timestamp */
  verifiedAt: Date;
}
```

### 3.2 Formal Claims

```typescript
/**
 * A claim that can be encoded for SMT verification.
 */
interface FormalClaim {
  /** Human-readable description */
  description: string;

  /** Claim category (determines encoding strategy) */
  category: FormalClaimCategory;

  /** The logical formula (in intermediate representation) */
  formula: LogicalFormula;

  /** Variables in the formula */
  variables: Variable[];

  /** Constraints/preconditions */
  preconditions: LogicalFormula[];

  /** Source location in code */
  sourceLocation: CodeLocation;
}

type FormalClaimCategory =
  | 'null_safety'        // Variable is never null
  | 'bounds_check'       // Index is within array bounds
  | 'overflow'           // Arithmetic never overflows
  | 'type_invariant'     // Type invariant holds
  | 'postcondition'      // Function postcondition
  | 'loop_invariant'     // Loop invariant maintained
  | 'assertion'          // Inline assertion
  | 'equivalence'        // Two expressions are equivalent
  | 'string_validation'; // String matches pattern

interface Variable {
  name: string;
  type: VariableType;
  constraints?: LogicalFormula;
}

type VariableType =
  | { kind: 'int'; bitwidth?: number }
  | { kind: 'real' }
  | { kind: 'bool' }
  | { kind: 'string' }
  | { kind: 'array'; elementType: VariableType; indexType: VariableType }
  | { kind: 'bitvector'; width: number };
```

### 3.3 Logical Formulas

```typescript
/**
 * Intermediate representation for logical formulas.
 * Translated to SMT-LIB for solver input.
 */
type LogicalFormula =
  | { type: 'const'; value: boolean | number | string }
  | { type: 'var'; name: string }
  | { type: 'not'; operand: LogicalFormula }
  | { type: 'and'; operands: LogicalFormula[] }
  | { type: 'or'; operands: LogicalFormula[] }
  | { type: 'implies'; left: LogicalFormula; right: LogicalFormula }
  | { type: 'iff'; left: LogicalFormula; right: LogicalFormula }
  | { type: 'eq'; left: LogicalFormula; right: LogicalFormula }
  | { type: 'neq'; left: LogicalFormula; right: LogicalFormula }
  | { type: 'lt'; left: LogicalFormula; right: LogicalFormula }
  | { type: 'le'; left: LogicalFormula; right: LogicalFormula }
  | { type: 'gt'; left: LogicalFormula; right: LogicalFormula }
  | { type: 'ge'; left: LogicalFormula; right: LogicalFormula }
  | { type: 'add'; operands: LogicalFormula[] }
  | { type: 'sub'; left: LogicalFormula; right: LogicalFormula }
  | { type: 'mul'; operands: LogicalFormula[] }
  | { type: 'div'; left: LogicalFormula; right: LogicalFormula }
  | { type: 'mod'; left: LogicalFormula; right: LogicalFormula }
  | { type: 'ite'; cond: LogicalFormula; then: LogicalFormula; else: LogicalFormula }
  | { type: 'forall'; vars: Variable[]; body: LogicalFormula }
  | { type: 'exists'; vars: Variable[]; body: LogicalFormula }
  | { type: 'select'; array: LogicalFormula; index: LogicalFormula }
  | { type: 'store'; array: LogicalFormula; index: LogicalFormula; value: LogicalFormula };
```

### 3.4 Counterexamples

```typescript
/**
 * A concrete counterexample showing claim violation.
 */
interface Counterexample {
  /** Variable assignments that violate the claim */
  assignments: VariableAssignment[];

  /** Execution trace leading to violation (if available) */
  trace?: ExecutionStep[];

  /** Human-readable explanation */
  explanation: string;

  /** Code location where violation occurs */
  violationLocation: CodeLocation;
}

interface VariableAssignment {
  /** Variable name */
  name: string;

  /** Concrete value */
  value: ConcreteValue;

  /** Type of the variable */
  type: VariableType;
}

type ConcreteValue =
  | { kind: 'int'; value: bigint }
  | { kind: 'real'; value: number }
  | { kind: 'bool'; value: boolean }
  | { kind: 'string'; value: string }
  | { kind: 'array'; elements: Map<ConcreteValue, ConcreteValue> }
  | { kind: 'bitvector'; bits: string };

interface ExecutionStep {
  /** Step number */
  step: number;

  /** Code location */
  location: CodeLocation;

  /** Statement executed */
  statement: string;

  /** Variable state after execution */
  state: Map<string, ConcreteValue>;
}
```

### 3.5 Unknown Reasons

```typescript
/**
 * Reasons why SMT verification returned 'unknown'.
 */
interface UnknownReason {
  /** Category of the reason */
  category: UnknownCategory;

  /** Detailed explanation */
  explanation: string;

  /** Suggested remediation */
  remediation?: string;
}

type UnknownCategory =
  | 'timeout'             // Solver ran out of time
  | 'memout'              // Solver ran out of memory
  | 'theory_incomplete'   // Theory is not complete for this formula
  | 'quantifier_depth'    // Too many nested quantifiers
  | 'non_linear'          // Non-linear arithmetic (undecidable)
  | 'external_call'       // Depends on external function
  | 'loop_unbounded'      // Unbounded loop (needs invariant)
  | 'encoding_failure';   // Could not encode to SMT-LIB
```

---

## 4. SMT Encoding Strategies

### 4.1 Null Safety Encoding

```typescript
/**
 * Encode null safety claim to SMT-LIB.
 *
 * Strategy: Track nullability as boolean shadow variables.
 * Prove: For all paths, variable is not null when dereferenced.
 */
function encodeNullSafety(claim: FormalClaim): string {
  // Example for: "variable x is never null when accessed"
  //
  // (declare-const x_value Int)
  // (declare-const x_is_null Bool)
  // (declare-const accessed Bool)
  //
  // ; Preconditions from path analysis
  // (assert (=> accessed (not x_is_null)))
  //
  // ; Check if there's an assignment where accessed AND null
  // (assert accessed)
  // (assert x_is_null)
  // (check-sat)
  //
  // If UNSAT: proven safe
  // If SAT: counterexample shows null access path

  const { variables, preconditions, formula } = claim;

  const declarations = variables.map(v =>
    `(declare-const ${v.name}_is_null Bool)`
  ).join('\n');

  const preconds = preconditions.map(p =>
    `(assert ${formulaToSMTLib(p)})`
  ).join('\n');

  const negatedClaim = `(assert (not ${formulaToSMTLib(formula)}))`;

  return `
; Null safety verification for ${claim.description}
${declarations}
${preconds}
${negatedClaim}
(check-sat)
(get-model)
`.trim();
}
```

### 4.2 Bounds Check Encoding

```typescript
/**
 * Encode array bounds check to SMT-LIB.
 *
 * Strategy: Model array length and index as integers.
 * Prove: 0 <= index < length for all accesses.
 */
function encodeBoundsCheck(
  arrayName: string,
  indexExpr: LogicalFormula,
  lengthExpr: LogicalFormula,
  preconditions: LogicalFormula[]
): string {
  return `
; Bounds check for ${arrayName}[index]
(declare-const array_length Int)
(declare-const index Int)

; Array length is non-negative
(assert (>= array_length 0))

; Preconditions
${preconditions.map(p => `(assert ${formulaToSMTLib(p)})`).join('\n')}

; Length constraint
(assert (= array_length ${formulaToSMTLib(lengthExpr)}))

; Index expression
(assert (= index ${formulaToSMTLib(indexExpr)}))

; Check if bounds can be violated
; If this is SAT, we have a counterexample
(assert (or (< index 0) (>= index array_length)))
(check-sat)
(get-model)
`.trim();
}
```

### 4.3 Type Invariant Encoding

```typescript
/**
 * Encode type invariant to SMT-LIB.
 *
 * Strategy: Represent invariant as predicate over fields.
 * Prove: Invariant holds after every mutation.
 */
interface TypeInvariant {
  /** Type name */
  typeName: string;

  /** Fields and their types */
  fields: Array<{ name: string; type: VariableType }>;

  /** Invariant formula */
  invariant: LogicalFormula;

  /** Mutations that must preserve invariant */
  mutations: Mutation[];
}

interface Mutation {
  /** Mutation name (method/function) */
  name: string;

  /** Precondition */
  precondition: LogicalFormula;

  /** Effect on fields (as assignments) */
  effects: Map<string, LogicalFormula>;
}

function encodeTypeInvariant(inv: TypeInvariant): string {
  const fieldDecls = inv.fields.map(f =>
    `(declare-const ${f.name} ${typeToSMT(f.type)})`
  ).join('\n');

  const fieldDeclsPrime = inv.fields.map(f =>
    `(declare-const ${f.name}_prime ${typeToSMT(f.type)})`
  ).join('\n');

  const scripts: string[] = [];

  for (const mutation of inv.mutations) {
    const effects = inv.fields.map(f => {
      const newValue = mutation.effects.get(f.name);
      if (newValue) {
        return `(assert (= ${f.name}_prime ${formulaToSMTLib(newValue)}))`;
      }
      return `(assert (= ${f.name}_prime ${f.name}))`;
    }).join('\n');

    scripts.push(`
; Invariant preservation for ${mutation.name}
${fieldDecls}
${fieldDeclsPrime}

; Invariant holds before mutation
(assert ${formulaToSMTLib(inv.invariant)})

; Mutation precondition
(assert ${formulaToSMTLib(mutation.precondition)})

; Mutation effects
${effects}

; Check if invariant can be violated after mutation
(assert (not ${formulaToSMTLib(substituteFields(inv.invariant, '_prime'))}))
(check-sat)
(get-model)
`);
  }

  return scripts.join('\n\n; ---\n\n');
}
```

### 4.4 Formal Specification Extraction

```typescript
/**
 * Extract formal specifications from code constructs.
 */
interface SpecificationExtractor {
  /**
   * Extract from TypeScript type guards.
   */
  extractFromTypeGuard(node: TypeGuardNode): FormalClaim | null;

  /**
   * Extract from assertion statements.
   */
  extractFromAssertion(node: AssertNode): FormalClaim | null;

  /**
   * Extract from JSDoc @invariant tags.
   */
  extractFromJSDoc(node: JSDocNode): FormalClaim[];

  /**
   * Extract from branded types (nominal typing).
   */
  extractFromBrandedType(node: TypeNode): TypeInvariant | null;

  /**
   * Extract from Zod/io-ts schemas.
   */
  extractFromValidationSchema(node: CallNode): FormalClaim[];
}

/**
 * Supported specification sources.
 */
type SpecificationSource =
  | { type: 'type_guard'; function: string; location: CodeLocation }
  | { type: 'assertion'; expression: string; location: CodeLocation }
  | { type: 'jsdoc_invariant'; tag: string; location: CodeLocation }
  | { type: 'branded_type'; brand: string; location: CodeLocation }
  | { type: 'validation_schema'; library: 'zod' | 'io-ts' | 'yup'; location: CodeLocation }
  | { type: 'manual'; specification: string };
```

---

## 5. Verification Interface

### 5.1 Verifier Contract

```typescript
/**
 * Interface for SMT-based claim verification.
 */
interface ISMTVerifier {
  /**
   * Verify a single formal claim.
   */
  verify(claim: FormalClaim, config?: Partial<SMTSolverConfig>): Promise<SMTVerificationResult>;

  /**
   * Verify multiple claims (batched for efficiency).
   */
  verifyBatch(claims: FormalClaim[], config?: Partial<SMTSolverConfig>): Promise<SMTVerificationResult[]>;

  /**
   * Extract and verify all specifications from a code file.
   */
  verifyFile(filePath: string, config?: Partial<SMTSolverConfig>): Promise<FileVerificationReport>;

  /**
   * Verify a type invariant across all mutations.
   */
  verifyTypeInvariant(invariant: TypeInvariant, config?: Partial<SMTSolverConfig>): Promise<InvariantVerificationResult>;

  /**
   * Check if a claim is encodable to SMT.
   */
  canEncode(claim: FormalClaim): EncodabilityResult;
}

interface FileVerificationReport {
  filePath: string;
  claims: FormalClaim[];
  results: SMTVerificationResult[];
  summary: {
    proven: number;
    refuted: number;
    unknown: number;
    notEncodable: number;
  };
  duration: number;
}

interface InvariantVerificationResult {
  invariant: TypeInvariant;
  mutationResults: Map<string, SMTVerificationResult>;
  allPreserved: boolean;
  violatingMutations: string[];
}

interface EncodabilityResult {
  encodable: boolean;
  theory: SMTTheory | null;
  reason?: string;
  suggestions?: string[];
}
```

### 5.2 Integration with Constructive Proofs

```typescript
/**
 * Bridge between SMT verification and LiBrainian's proof system.
 */
interface ISMTProofBridge {
  /**
   * Convert SMT verification result to a constructive proof premise.
   */
  toProofPremise(result: SMTVerificationResult): Premise;

  /**
   * Add SMT verification as an inference step in a proof.
   */
  addSMTInference(proof: ConstructiveProof, result: SMTVerificationResult): InferenceStep;

  /**
   * Convert counterexample to a defeater.
   */
  counterexampleToDefeater(counterexample: Counterexample, claim: ProofClaim): Defeater;
}

/**
 * SMT verification as a proof source.
 */
const SMT_PREMISE_SOURCE: PremiseSource = {
  type: 'smt_verification' as any,
  verificationId: 'to-be-filled',
  solver: 'z3',
  theory: 'QF_LIA',
};

/**
 * SMT inference rule.
 */
const SMT_INFERENCE_RULE: InferenceRule = 'smt_verification' as any;
```

---

## 6. TDD Test Specifications

### 6.1 Tier-0 Tests (Deterministic)

| Test Case | Input | Expected Output |
|-----------|-------|-----------------|
| `encode_null_safety` | Null check claim | Valid SMT-LIB script |
| `encode_bounds_check` | Array access claim | Valid SMT-LIB script |
| `encode_type_invariant` | Type with invariant | Valid SMT-LIB script per mutation |
| `parse_sat_result` | "sat" + model | Refuted status + counterexample |
| `parse_unsat_result` | "unsat" | Proven status |
| `parse_unknown_result` | "unknown" + reason | Unknown status + reason |
| `extract_from_type_guard` | TypeScript type guard | FormalClaim |
| `extract_from_assertion` | Assert statement | FormalClaim |
| `formula_to_smtlib` | LogicalFormula | SMT-LIB string |
| `select_theory_null_safety` | Null safety claim | QF_LIA |
| `select_theory_overflow` | Overflow claim | QF_BV |
| `counterexample_to_assignment` | SMT model | VariableAssignment[] |

### 6.2 Tier-1 Tests (Integration with Solver)

| Test Case | Scenario | Acceptance Criteria |
|-----------|----------|---------------------|
| `z3_null_safety_proven` | Safe null check | Status: proven |
| `z3_null_safety_refuted` | Missing null check | Status: refuted + counterexample |
| `z3_bounds_check_proven` | Valid array access | Status: proven |
| `z3_bounds_check_refuted` | Off-by-one error | Status: refuted + concrete index |
| `cvc5_string_validation` | Regex constraint | Status: proven or refuted |
| `timeout_handling` | Complex formula | Status: unknown, category: timeout |
| `invariant_preserved` | Valid mutation | All mutations pass |
| `invariant_violated` | Invalid mutation | Specific mutation fails |
| `specification_extraction` | Annotated TypeScript file | Claims extracted |
| `batch_verification` | 10 claims | All results returned |

### 6.3 Tier-2 Tests (Live System)

| Test Case | Scenario | Acceptance Criteria |
|-----------|----------|---------------------|
| `80%_verifiable` | 100 claims from real codebase | 80+ resolved (proven/refuted) |
| `no_false_proofs` | Deliberately buggy code | All bugs found (refuted) |
| `no_false_refutations` | Verified correct code | All pass (proven) |
| `counterexample_reproducible` | Refuted claims | Counterexample causes actual failure |
| `performance_acceptable` | Typical claim | < 5s average verification time |
| `memory_bounded` | Complex formula | < 2GB memory usage |

---

## 7. BDD Scenarios

```gherkin
Feature: SMT-Based Claim Verification
  As a LiBrainian system
  I want to verify claims using SMT solvers
  So that certain claims have mathematical certainty

  Scenario: Proving null safety
    Given a function "getUser" that checks for null before access
    And I extract the null safety claim
    When I verify the claim with Z3
    Then the result status is "proven"
    And no counterexample is provided
    And the verification metadata includes the SMT-LIB script

  Scenario: Refuting null safety with counterexample
    Given a function "processData" that may access null
    And I extract the null safety claim
    When I verify the claim with Z3
    Then the result status is "refuted"
    And a counterexample is provided showing:
      | Variable | Value |
      | input    | null  |
    And the counterexample explanation describes the violation path

  Scenario: Verifying array bounds
    Given a loop that iterates "for (let i = 0; i < arr.length; i++)"
    And I extract the bounds check claim
    When I verify the claim with Z3
    Then the result status is "proven"

  Scenario: Detecting off-by-one error
    Given a loop that iterates "for (let i = 0; i <= arr.length; i++)"
    And I extract the bounds check claim
    When I verify the claim with Z3
    Then the result status is "refuted"
    And the counterexample shows index equals array length

  Scenario: Type invariant preservation
    Given a class "BankAccount" with invariant "balance >= 0"
    And methods "deposit" and "withdraw"
    When I verify the type invariant
    Then the result shows:
      | Method   | Status  |
      | deposit  | proven  |
      | withdraw | refuted |
    And the "withdraw" counterexample shows negative balance

  Scenario: Handling verification timeout
    Given a claim with deeply nested quantifiers
    And a solver timeout of 1 second
    When I verify the claim
    Then the result status is "unknown"
    And the unknown reason category is "timeout"
    And suggested remediation is provided

  Scenario: Extracting specifications from TypeScript
    Given a TypeScript file with type guards and assertions
    When I extract formal specifications
    Then claims are extracted from:
      | Source | Count |
      | type guards | 3 |
      | assertions | 2 |
      | JSDoc invariants | 1 |

  Scenario: Converting verification to constructive proof
    Given a verified null safety claim with status "proven"
    When I convert to a constructive proof premise
    Then the premise source type is "smt_verification"
    And the premise verification status is "verified"
    And confidence is 1.0 (certain)
```

---

## 8. Integration Points

| Component | Integration | Direction |
|-----------|-------------|-----------|
| Constructive Proofs | Provides verified premises | Writes |
| Evidence Ledger | Records verification events | Writes |
| Specification Extractor | Provides claims to verify | Reads |
| Counterexample DB | Stores counterexamples for regression | Writes |
| Confidence System | Upgrades probabilistic to certain | Writes |
| Query Engine | Uses verification for claim answers | Reads |
| Type System Analyzer | Provides type invariants | Reads |

---

## 9. Implementation Status

- [ ] Spec complete
- [ ] Core types implemented
- [ ] SMT-LIB encoder implemented
- [ ] Z3 integration
- [ ] CVC5 integration
- [ ] Counterexample parser
- [ ] Specification extractor
- [ ] Type invariant verifier
- [ ] Constructive proof bridge
- [ ] Tests written (Tier-0)
- [ ] Tests written (Tier-1)
- [ ] Tests written (Tier-2)
- [ ] 80% verifiable gate passed

---

## 10. Performance Considerations

### 10.1 Solver Selection Heuristics

```typescript
/**
 * Select optimal solver based on claim characteristics.
 */
function selectSolver(claim: FormalClaim): SMTSolver {
  const theory = selectTheory(claim);

  // Z3 excels at bitvectors and quantifier-free theories
  if (theory.primary === 'QF_BV' || !theory.features.has('quantifiers')) {
    return 'z3';
  }

  // CVC5 excels at strings and quantifier handling
  if (theory.primary === 'QF_S' || theory.features.has('quantifiers')) {
    return 'cvc5';
  }

  return 'z3'; // Default
}
```

### 10.2 Caching Strategy

```typescript
/**
 * Cache verification results by formula hash.
 */
interface VerificationCache {
  /** Get cached result if formula unchanged */
  get(formulaHash: string): SMTVerificationResult | null;

  /** Store result with formula hash */
  set(formulaHash: string, result: SMTVerificationResult): void;

  /** Invalidate when code changes */
  invalidate(filePath: string): void;
}
```

### 10.3 Incremental Verification

For large codebases:
1. Only verify changed functions
2. Track claim dependencies
3. Re-verify dependents on signature change
4. Parallelize independent verifications

---

## Changelog

| Date | Change |
|------|--------|
| 2026-01-23 | Initial frontier specification |
