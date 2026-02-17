# Neurosymbolic Fusion Specification

> **Version**: 1.0.0
> **Status**: DRAFT
> **Last Updated**: 2026-01-23
>
> **Theory Reference**: Based on neurosymbolic AI principles combining symbolic reasoning (logic, type theory, program analysis) with neural representations (embeddings, transformers).

---

## Executive Summary

**Current approaches**: Either symbolic (AST analysis, type checking) OR neural (embeddings, LLM)
**Neurosymbolic fusion**: Combine both, using each to strengthen the other

The key insight: **symbolic constraints bound neural predictions, and neural predictions fill symbolic gaps**. When both agree, confidence increases. When they disagree, we have a signal to investigate further.

**Target verification**: Neurosymbolic accuracy +10% over neural-only baseline.

---

## 1. The Problem: Two Complementary Worldviews

### 1.1 Symbolic Strengths and Weaknesses

Symbolic analysis (AST, type systems, call graphs) provides:
- **Precision**: Type `string` is exactly `string`, not "probably string"
- **Completeness**: Call graph captures all static call sites
- **Explainability**: "X calls Y because line 42 contains `Y()`"

But suffers from:
- **Brittleness**: Dynamic dispatch, reflection, metaprogramming
- **Surface-only**: Cannot infer intent, purpose, or semantic meaning
- **Language-specific**: Each language needs separate implementation

### 1.2 Neural Strengths and Weaknesses

Neural analysis (embeddings, LLM synthesis) provides:
- **Semantic understanding**: "This function validates user input"
- **Cross-language**: Embeddings work across programming languages
- **Intent inference**: "The developer likely meant to handle null here"

But suffers from:
- **Hallucination**: May claim relationships that don't exist
- **Non-determinism**: Same query may produce different results
- **Uncalibrated confidence**: "Confident" answers may be wrong

### 1.3 The Fusion Opportunity

```
Symbolic: "Function X has parameter of type `User | null`"
Neural: "Function X appears to validate user authentication"

Fused insight: "X is an authentication validator that accepts nullable User"
           + Confidence boost: Both sources agree on authentication role
           + Type constraint: Must handle null case (symbolic enforces)
```

---

## 2. Core Types

### 2.1 Symbolic Constraints

```typescript
/**
 * A constraint derived from symbolic analysis (AST, types, call graphs).
 *
 * INVARIANT: All symbolic constraints are deterministically derivable
 * INVARIANT: Constraints include source location for verification
 */
interface SymbolicConstraint {
  /** Unique identifier */
  id: SymbolicConstraintId;

  /** Type of constraint */
  type: SymbolicConstraintType;

  /** The constraint itself */
  constraint: ConstraintValue;

  /** Source in code */
  source: CodeLocation;

  /** Confidence (usually 1.0 for verified AST facts) */
  confidence: ConfidenceValue;

  /** How was this derived? */
  derivation: SymbolicDerivation;
}

type SymbolicConstraintId = string & { readonly __brand: 'SymbolicConstraintId' };

type SymbolicConstraintType =
  | 'type_annotation'      // Explicit type: `x: string`
  | 'inferred_type'        // Type inference: `const x = "hello"` => string
  | 'call_relationship'    // X calls Y
  | 'import_dependency'    // X imports Y
  | 'inheritance'          // X extends Y
  | 'interface_impl'       // X implements Y
  | 'parameter_constraint' // Function requires specific parameter types
  | 'return_constraint'    // Function returns specific type
  | 'control_flow'         // Conditional, loop, or branch structure
  | 'null_check'           // Explicit null/undefined handling
  | 'error_handling';      // Try/catch, error propagation

interface ConstraintValue {
  /** Machine-readable constraint representation */
  formal: string;

  /** Human-readable description */
  description: string;

  /** Entities involved */
  entities: ConstraintEntity[];
}

interface ConstraintEntity {
  type: 'function' | 'class' | 'variable' | 'type' | 'module';
  name: string;
  location: CodeLocation;
}

interface SymbolicDerivation {
  method: 'ast_parse' | 'type_checker' | 'call_graph' | 'data_flow' | 'import_resolution';
  tool: string;
  timestamp: Date;
}
```

### 2.2 Neural Predictions

```typescript
/**
 * A prediction derived from neural analysis (embeddings, LLM).
 *
 * INVARIANT: Neural predictions include uncertainty estimates
 * INVARIANT: Predictions trace to their model and prompt
 */
interface NeuralPrediction {
  /** Unique identifier */
  id: NeuralPredictionId;

  /** Type of prediction */
  type: NeuralPredictionType;

  /** The prediction itself */
  prediction: PredictionValue;

  /** Confidence from neural model */
  confidence: ConfidenceValue;

  /** How was this derived? */
  derivation: NeuralDerivation;

  /** Alternative predictions considered */
  alternatives: AlternativePrediction[];
}

type NeuralPredictionId = string & { readonly __brand: 'NeuralPredictionId' };

type NeuralPredictionType =
  | 'semantic_similarity'   // "A is similar to B"
  | 'intent_classification' // "Function purpose is validation"
  | 'relationship_inference'// "A likely calls B" (not in call graph)
  | 'type_inference'        // "Variable is probably a User object"
  | 'purpose_summary'       // "This module handles authentication"
  | 'risk_assessment'       // "This code may have security issues"
  | 'pattern_recognition';  // "This follows the Factory pattern"

interface PredictionValue {
  /** The predicted claim */
  claim: string;

  /** Structured prediction (if available) */
  structured?: Record<string, unknown>;

  /** Embedding vector (if applicable) */
  embedding?: number[];

  /** Similarity score (if applicable) */
  similarity?: number;
}

interface NeuralDerivation {
  method: 'embedding_similarity' | 'llm_classification' | 'llm_synthesis' | 'llm_inference';
  model: string;
  promptDigest?: string;
  temperature?: number;
  timestamp: Date;
}

interface AlternativePrediction {
  prediction: PredictionValue;
  confidence: ConfidenceValue;
  reason: string;
}
```

### 2.3 Fused Knowledge

```typescript
/**
 * Knowledge derived from fusing symbolic constraints and neural predictions.
 *
 * INVARIANT: Fused knowledge records both contributing sources
 * INVARIANT: Disagreements are captured and tracked
 */
interface FusedKnowledge {
  /** Unique identifier */
  id: FusedKnowledgeId;

  /** The fused claim */
  claim: FusedClaim;

  /** Symbolic constraints that contributed */
  symbolicSources: SymbolicConstraint[];

  /** Neural predictions that contributed */
  neuralSources: NeuralPrediction[];

  /** Agreement status */
  agreement: AgreementStatus;

  /** Final fused confidence */
  confidence: ConfidenceValue;

  /** How was fusion performed? */
  fusionMethod: FusionMethod;

  /** Disagreements found (if any) */
  disagreements: Disagreement[];

  /** Actions taken to resolve disagreements */
  resolutions: DisagreementResolution[];
}

type FusedKnowledgeId = string & { readonly __brand: 'FusedKnowledgeId' };

interface FusedClaim {
  /** Human-readable statement */
  statement: string;

  /** Claim category */
  category: FusedClaimCategory;

  /** Subject entities */
  subjects: ConstraintEntity[];

  /** Scope and limitations */
  scope: ClaimScope;
}

type FusedClaimCategory =
  | 'type_assertion'        // "X has type T"
  | 'relationship'          // "X relates to Y"
  | 'behavior'              // "X does Z"
  | 'purpose'               // "X is for Y"
  | 'quality'               // "X has property P"
  | 'risk';                 // "X may cause problem P"

type AgreementStatus =
  | 'full_agreement'        // Symbolic and neural agree
  | 'partial_agreement'     // Agree on some aspects
  | 'neural_only'           // Only neural evidence (no symbolic)
  | 'symbolic_only'         // Only symbolic evidence (no neural)
  | 'disagreement'          // Sources conflict
  | 'complementary';        // Sources provide different aspects

type FusionMethod =
  | 'confidence_weighted'   // Weight by source confidence
  | 'symbolic_priority'     // Symbolic wins on conflict
  | 'neural_fallback'       // Use neural when symbolic unavailable
  | 'ensemble_vote'         // Majority voting
  | 'learned_weights';      // ML-optimized fusion weights
```

### 2.4 Disagreements

```typescript
/**
 * A disagreement between symbolic and neural sources.
 */
interface Disagreement {
  /** Unique identifier */
  id: DisagreementId;

  /** What the symbolic analysis says */
  symbolicClaim: SymbolicConstraint;

  /** What the neural analysis says */
  neuralClaim: NeuralPrediction;

  /** Nature of the disagreement */
  conflictType: ConflictType;

  /** Severity of the disagreement */
  severity: DisagreementSeverity;

  /** Investigation status */
  status: DisagreementStatus;

  /** Root cause (if determined) */
  rootCause?: DisagreementRootCause;
}

type DisagreementId = string & { readonly __brand: 'DisagreementId' };

type ConflictType =
  | 'type_mismatch'         // Symbolic says type A, neural says type B
  | 'relationship_conflict' // Symbolic says no relationship, neural says yes
  | 'presence_conflict'     // One says exists, other says doesn't
  | 'confidence_conflict'   // Both agree but with very different confidence
  | 'scope_conflict';       // Disagree on where/when claim applies

type DisagreementSeverity = 'critical' | 'significant' | 'minor' | 'informational';

type DisagreementStatus = 'detected' | 'investigating' | 'resolved' | 'accepted';

type DisagreementRootCause =
  | { type: 'symbolic_incomplete'; reason: string }  // Dynamic dispatch, reflection
  | { type: 'neural_hallucination'; reason: string } // Model made up relationship
  | { type: 'stale_analysis'; reason: string }       // Code changed since analysis
  | { type: 'ambiguous_code'; reason: string }       // Code is genuinely ambiguous
  | { type: 'unknown'; reason: string };

interface DisagreementResolution {
  disagreementId: DisagreementId;
  resolution: ResolutionType;
  explanation: string;
  evidence?: string;
  timestamp: Date;
}

type ResolutionType =
  | 'symbolic_wins'         // Symbolic analysis is correct
  | 'neural_wins'           // Neural prediction is correct
  | 'both_partial'          // Both are partially correct
  | 'scope_narrowed'        // Claim scope reduced to avoid conflict
  | 'flagged_for_human';    // Human review needed
```

---

## 3. Fusion Algorithms

### 3.1 Fusion Engine Interface

```typescript
/**
 * Engine for fusing symbolic and neural knowledge.
 */
interface INeurosymbolicFusionEngine {
  /**
   * Fuse symbolic constraints and neural predictions.
   */
  fuse(
    symbolic: SymbolicConstraint[],
    neural: NeuralPrediction[],
    options: FusionOptions
  ): Promise<FusedKnowledge[]>;

  /**
   * Check if symbolic and neural agree on a claim.
   */
  checkAgreement(
    claim: string,
    symbolic: SymbolicConstraint[],
    neural: NeuralPrediction[]
  ): Promise<AgreementAssessment>;

  /**
   * Investigate a disagreement.
   */
  investigateDisagreement(
    disagreement: Disagreement
  ): Promise<DisagreementAnalysis>;

  /**
   * Compute fused confidence.
   */
  computeFusedConfidence(
    symbolic: ConfidenceValue | null,
    neural: ConfidenceValue | null,
    agreement: AgreementStatus
  ): ConfidenceValue;
}

interface FusionOptions {
  /** Minimum confidence for inclusion */
  minConfidence: number;

  /** Fusion strategy */
  strategy: FusionMethod;

  /** Whether to investigate disagreements */
  investigateDisagreements: boolean;

  /** Maximum disagreements to investigate */
  maxDisagreementInvestigations: number;
}

interface AgreementAssessment {
  status: AgreementStatus;
  symbolicEvidence: SymbolicConstraint[];
  neuralEvidence: NeuralPrediction[];
  conflictingPoints: string[];
  confidenceBoost: number;
}

interface DisagreementAnalysis {
  disagreement: Disagreement;
  likelyCause: DisagreementRootCause;
  suggestedResolution: ResolutionType;
  additionalEvidence: string[];
  confidenceInAnalysis: ConfidenceValue;
}
```

### 3.2 Confidence Fusion Algorithm

```typescript
/**
 * Compute fused confidence from symbolic and neural sources.
 *
 * Key principles:
 * - Agreement boosts confidence (both say same thing = more certain)
 * - Disagreement caps confidence (conflict = uncertainty)
 * - Symbolic constraints provide hard bounds
 * - Neural predictions fill gaps but with discount
 */
function computeFusedConfidence(
  symbolic: ConfidenceValue | null,
  neural: ConfidenceValue | null,
  agreement: AgreementStatus
): ConfidenceValue {
  // Case 1: No evidence at all
  if (!symbolic && !neural) {
    return { type: 'absent', reason: 'insufficient_data' };
  }

  const symbolicValue = symbolic ? getNumericValue(symbolic) : null;
  const neuralValue = neural ? getNumericValue(neural) : null;

  // Case 2: Only symbolic evidence
  if (symbolic && !neural && symbolicValue !== null) {
    return {
      type: 'derived',
      value: symbolicValue,
      formula: 'symbolic_only',
      inputs: [{ name: 'symbolic', confidence: symbolic }],
    };
  }

  // Case 3: Only neural evidence (discounted)
  if (!symbolic && neural && neuralValue !== null) {
    const NEURAL_ONLY_DISCOUNT = 0.15;
    return {
      type: 'derived',
      value: Math.max(0, neuralValue - NEURAL_ONLY_DISCOUNT),
      formula: 'neural_only_discounted',
      inputs: [{ name: 'neural', confidence: neural }],
    };
  }

  // Case 4: Both sources available
  if (!symbolic || !neural || symbolicValue === null || neuralValue === null) {
    return { type: 'absent', reason: 'insufficient_data' };
  }

  switch (agreement) {
    case 'full_agreement': {
      // Agreement boost: sqrt(s * n) + bonus
      const AGREEMENT_BONUS = 0.1;
      const combined = Math.sqrt(symbolicValue * neuralValue);
      return {
        type: 'derived',
        value: Math.min(0.99, combined + AGREEMENT_BONUS),
        formula: 'agreement_boost',
        inputs: [
          { name: 'symbolic', confidence: symbolic },
          { name: 'neural', confidence: neural },
        ],
      };
    }

    case 'partial_agreement': {
      // Weighted average with small bonus
      const PARTIAL_BONUS = 0.05;
      const weighted = (symbolicValue * 0.6 + neuralValue * 0.4);
      return {
        type: 'derived',
        value: Math.min(0.95, weighted + PARTIAL_BONUS),
        formula: 'partial_agreement',
        inputs: [
          { name: 'symbolic', confidence: symbolic },
          { name: 'neural', confidence: neural },
        ],
      };
    }

    case 'disagreement': {
      // Cap at lower confidence, apply penalty
      const DISAGREEMENT_PENALTY = 0.2;
      const lower = Math.min(symbolicValue, neuralValue);
      return {
        type: 'derived',
        value: Math.max(0.1, lower - DISAGREEMENT_PENALTY),
        formula: 'disagreement_penalty',
        inputs: [
          { name: 'symbolic', confidence: symbolic },
          { name: 'neural', confidence: neural },
        ],
      };
    }

    case 'complementary': {
      // Sources provide different info - combine without penalty
      const weighted = (symbolicValue * 0.5 + neuralValue * 0.5);
      return {
        type: 'derived',
        value: weighted,
        formula: 'complementary_combination',
        inputs: [
          { name: 'symbolic', confidence: symbolic },
          { name: 'neural', confidence: neural },
        ],
      };
    }

    default: {
      // Conservative fallback
      return {
        type: 'derived',
        value: Math.min(symbolicValue, neuralValue),
        formula: 'conservative_min',
        inputs: [
          { name: 'symbolic', confidence: symbolic },
          { name: 'neural', confidence: neural },
        ],
      };
    }
  }
}
```

### 3.3 Disagreement Investigation Algorithm

```
ALGORITHM InvestigateDisagreement(disagreement):
  1. CATEGORIZE conflict type:
     - Type mismatch: Check for dynamic typing, generics, union types
     - Relationship conflict: Check for dynamic dispatch, reflection, callbacks
     - Presence conflict: Check for conditional compilation, dead code
     - Confidence conflict: Check for edge cases, rare paths

  2. GATHER additional evidence:
     a. Re-run symbolic analysis with deeper settings
     b. Query LLM with specific counter-examples
     c. Look for test cases that exercise the disputed code
     d. Check git history for recent changes

  3. DETERMINE root cause:
     IF symbolic missed dynamic behavior:
       root_cause = 'symbolic_incomplete'
     ELSE IF neural has no supporting evidence:
       root_cause = 'neural_hallucination'
     ELSE IF code changed recently:
       root_cause = 'stale_analysis'
     ELSE:
       root_cause = 'ambiguous_code'

  4. SUGGEST resolution:
     IF root_cause is 'symbolic_incomplete':
       resolution = 'neural_wins' (with caveat)
     ELSE IF root_cause is 'neural_hallucination':
       resolution = 'symbolic_wins'
     ELSE:
       resolution = 'flagged_for_human'

  5. RETURN analysis with confidence
```

---

## 4. Type Inference Fusion

### 4.1 Combining Symbolic and Neural Type Inference

```typescript
/**
 * Fused type inference combining symbolic constraints and neural predictions.
 */
interface IFusedTypeInference {
  /**
   * Infer type for an expression.
   */
  inferType(
    expression: CodeLocation,
    context: TypeInferenceContext
  ): Promise<FusedTypeInference>;

  /**
   * Validate a type annotation against actual usage.
   */
  validateAnnotation(
    annotation: TypeAnnotation,
    usages: CodeLocation[]
  ): Promise<TypeValidation>;
}

interface TypeInferenceContext {
  /** Symbolic type constraints available */
  symbolicConstraints: SymbolicConstraint[];

  /** File context for neural inference */
  fileContext: string;

  /** Related type definitions */
  typeDefinitions: TypeDefinition[];
}

interface FusedTypeInference {
  /** The inferred type */
  type: InferredType;

  /** Symbolic contribution */
  symbolicEvidence: {
    type: string | null;
    constraints: SymbolicConstraint[];
    confidence: ConfidenceValue;
  };

  /** Neural contribution */
  neuralEvidence: {
    type: string | null;
    prediction: NeuralPrediction | null;
    confidence: ConfidenceValue;
  };

  /** Agreement status */
  agreement: AgreementStatus;

  /** Final confidence */
  confidence: ConfidenceValue;

  /** If disagreement, details */
  disagreement?: TypeDisagreement;
}

interface InferredType {
  /** Type representation */
  type: string;

  /** Is this exact or approximate? */
  precision: 'exact' | 'bounded' | 'approximate';

  /** Nullable? */
  nullable: boolean;

  /** Generic parameters (if applicable) */
  typeParameters?: string[];
}

interface TypeDisagreement {
  symbolicType: string;
  neuralType: string;
  likelyReason: string;
  suggestedResolution: string;
}
```

### 4.2 Type Fusion Algorithm

```typescript
/**
 * Fuse symbolic type constraints with neural type predictions.
 */
async function fuseTypeInference(
  expression: CodeLocation,
  symbolic: SymbolicConstraint[],
  neural: NeuralPrediction[],
  llm: ILLMProvider
): Promise<FusedTypeInference> {
  // Extract symbolic type constraints
  const typeConstraints = symbolic.filter(
    c => c.type === 'type_annotation' || c.type === 'inferred_type'
  );

  // Extract neural type predictions
  const typePredictions = neural.filter(
    p => p.type === 'type_inference'
  );

  // Case: Symbolic provides exact type
  if (typeConstraints.length > 0 && typeConstraints[0].confidence.value > 0.95) {
    const symbolicType = typeConstraints[0].constraint.formal;

    // Check if neural agrees
    const neuralAgrees = typePredictions.some(
      p => normalizeType(p.prediction.claim) === normalizeType(symbolicType)
    );

    return {
      type: parseType(symbolicType),
      symbolicEvidence: {
        type: symbolicType,
        constraints: typeConstraints,
        confidence: typeConstraints[0].confidence,
      },
      neuralEvidence: {
        type: typePredictions[0]?.prediction.claim ?? null,
        prediction: typePredictions[0] ?? null,
        confidence: typePredictions[0]?.confidence ?? { type: 'absent', reason: 'no_neural' },
      },
      agreement: neuralAgrees ? 'full_agreement' : 'symbolic_only',
      confidence: computeFusedConfidence(
        typeConstraints[0].confidence,
        typePredictions[0]?.confidence ?? null,
        neuralAgrees ? 'full_agreement' : 'symbolic_only'
      ),
    };
  }

  // Case: No symbolic type, use neural with discount
  if (typeConstraints.length === 0 && typePredictions.length > 0) {
    return {
      type: parseType(typePredictions[0].prediction.claim),
      symbolicEvidence: {
        type: null,
        constraints: [],
        confidence: { type: 'absent', reason: 'no_symbolic' },
      },
      neuralEvidence: {
        type: typePredictions[0].prediction.claim,
        prediction: typePredictions[0],
        confidence: typePredictions[0].confidence,
      },
      agreement: 'neural_only',
      confidence: computeFusedConfidence(
        null,
        typePredictions[0].confidence,
        'neural_only'
      ),
    };
  }

  // Case: Both sources disagree
  if (typeConstraints.length > 0 && typePredictions.length > 0) {
    const symbolicType = typeConstraints[0].constraint.formal;
    const neuralType = typePredictions[0].prediction.claim;

    if (normalizeType(symbolicType) !== normalizeType(neuralType)) {
      // Investigate the disagreement
      const investigation = await llm.complete({
        prompt: `
          Symbolic analysis says the type is: ${symbolicType}
          Neural prediction says the type is: ${neuralType}

          Which is more likely correct and why?
          Consider: dynamic typing, generics, type narrowing, union types.
        `,
      });

      return {
        type: parseType(symbolicType), // Symbolic wins by default
        symbolicEvidence: {
          type: symbolicType,
          constraints: typeConstraints,
          confidence: typeConstraints[0].confidence,
        },
        neuralEvidence: {
          type: neuralType,
          prediction: typePredictions[0],
          confidence: typePredictions[0].confidence,
        },
        agreement: 'disagreement',
        confidence: computeFusedConfidence(
          typeConstraints[0].confidence,
          typePredictions[0].confidence,
          'disagreement'
        ),
        disagreement: {
          symbolicType,
          neuralType,
          likelyReason: investigation.text,
          suggestedResolution: 'Symbolic type used; neural may reflect runtime behavior',
        },
      };
    }
  }

  // Fallback: insufficient evidence
  return {
    type: { type: 'unknown', precision: 'approximate', nullable: true },
    symbolicEvidence: {
      type: null,
      constraints: [],
      confidence: { type: 'absent', reason: 'insufficient_data' },
    },
    neuralEvidence: {
      type: null,
      prediction: null,
      confidence: { type: 'absent', reason: 'insufficient_data' },
    },
    agreement: 'neural_only',
    confidence: { type: 'absent', reason: 'insufficient_data' },
  };
}
```

---

## 5. TDD Test Specifications

### 5.1 Tier-0 Tests (Deterministic)

| Test Case | Input | Expected Output |
|-----------|-------|-----------------|
| `symbolic_constraint_creation` | AST type annotation | Valid SymbolicConstraint |
| `neural_prediction_creation` | LLM classification result | Valid NeuralPrediction |
| `confidence_fusion_agreement` | Both sources agree | Boosted confidence |
| `confidence_fusion_disagreement` | Sources conflict | Capped/penalized confidence |
| `confidence_fusion_symbolic_only` | Only symbolic evidence | Symbolic confidence unchanged |
| `confidence_fusion_neural_only` | Only neural evidence | Discounted confidence |
| `disagreement_detection` | Conflicting claims | Disagreement created |
| `fused_knowledge_creation` | Symbolic + Neural | Valid FusedKnowledge |
| `type_normalization` | Various type formats | Normalized strings match |

### 5.2 Tier-1 Tests (Integration)

| Test Case | Scenario | Acceptance Criteria |
|-----------|----------|---------------------|
| `ast_to_symbolic_constraints` | Parse TypeScript file | Extracts type annotations |
| `embedding_to_neural_predictions` | Compute similarity | Returns valid predictions |
| `full_fusion_pipeline` | File with types and semantics | Fused knowledge produced |
| `disagreement_investigation` | Conflicting type analysis | Root cause identified |
| `type_inference_fusion` | Variable without annotation | Type inferred with confidence |

### 5.3 Tier-2 Tests (Live Validation)

| Test Case | Scenario | Acceptance Criteria |
|-----------|----------|---------------------|
| `neurosymbolic_vs_neural_accuracy` | 100 type inference tasks | Neurosymbolic +10% accuracy |
| `neurosymbolic_vs_symbolic_coverage` | Dynamic code patterns | Better coverage than symbolic alone |
| `disagreement_resolution_quality` | 50 conflicts | 80%+ correctly resolved |
| `real_codebase_fusion` | Large TypeScript repo | Meaningful fused knowledge |

---

## 6. BDD Scenarios

```gherkin
Feature: Neurosymbolic Fusion
  As a LiBrainian system
  I want to combine symbolic constraints with neural predictions
  So that I can produce more accurate and robust knowledge

  Scenario: Agreement boosts confidence
    Given I have a function with explicit type annotation "User"
    And neural embedding classifies it as "user entity handling"
    When I fuse symbolic and neural evidence
    Then the agreement status is "full_agreement"
    And the fused confidence is higher than either source alone

  Scenario: Disagreement triggers investigation
    Given symbolic analysis says function returns "string"
    And neural prediction says function returns "number"
    When I fuse the evidence
    Then a disagreement is detected with type "type_mismatch"
    And an investigation is triggered
    And the fused confidence is capped with penalty

  Scenario: Neural fills gaps in symbolic analysis
    Given I have a dynamically-typed JavaScript function
    And symbolic analysis cannot determine the type
    And neural prediction says the type is "Promise<User>"
    When I fuse the evidence
    Then the fused type is "Promise<User>" with discounted confidence
    And the agreement status is "neural_only"

  Scenario: Type inference fusion
    Given a variable `result` is assigned from `fetchUser(id)`
    And `fetchUser` has return type annotation `Promise<User | null>`
    And neural analysis predicts "async user fetch with error handling"
    When I infer the type of `result`
    Then the inferred type is "Promise<User | null>"
    And confidence is boosted due to neural agreement on purpose

  Scenario: Investigating symbolic incompleteness
    Given symbolic analysis says "function A does not call function B"
    And neural analysis says "A likely invokes B"
    And code inspection reveals A calls B through dynamic dispatch
    When I investigate the disagreement
    Then root cause is "symbolic_incomplete"
    And resolution suggests "neural_wins" with caveat about dynamic behavior

  Scenario: Detecting neural hallucination
    Given neural analysis claims "function X handles authentication"
    And symbolic analysis shows X only does string formatting
    And no security-related imports or patterns exist
    When I investigate the disagreement
    Then root cause is "neural_hallucination"
    And resolution is "symbolic_wins"
```

---

## 7. Integration Points

| Component | Integration | Direction |
|-----------|-------------|-----------|
| AST Parser | Provides symbolic constraints from code | Reads |
| Type Checker | Provides type annotations and inferences | Reads |
| Call Graph Builder | Provides relationship constraints | Reads |
| Embedding Service | Provides neural similarity predictions | Reads |
| LLM Provider | Provides semantic classifications | Reads |
| Evidence Ledger | Records fused knowledge | Writes |
| Query Engine | Uses fused knowledge for answers | Reads |
| Calibration System | Tracks fusion accuracy over time | Both |
| Disagreement Tracker | Manages and learns from conflicts | Both |

---

## 8. Implementation Status

- [ ] Spec complete
- [ ] Core types implemented
- [ ] Tests written (Tier-0)
- [ ] Tests written (Tier-1)
- [ ] Tests written (Tier-2)
- [ ] Symbolic constraint extraction
- [ ] Neural prediction extraction
- [ ] Confidence fusion algorithm
- [ ] Disagreement detection
- [ ] Disagreement investigation
- [ ] Type inference fusion
- [ ] Integration with Evidence Ledger
- [ ] Gate passed: +10% accuracy over neural-only

---

## 9. Research Frontiers

### 9.1 Learned Fusion Weights

Currently, fusion weights are hand-tuned (e.g., 0.6 symbolic, 0.4 neural). Future work:
- Train fusion weights from labeled examples
- Adapt weights per domain (type inference vs. semantic classification)
- Online learning from disagreement outcomes

### 9.2 Bidirectional Constraint Propagation

Symbolic constraints can bound neural predictions, but neural predictions could also:
- Suggest where symbolic analysis is incomplete
- Propose type annotations for untyped code
- Identify likely dead code for verification

### 9.3 Multi-Modal Fusion

Extend beyond code text to include:
- Documentation (comments, READMEs)
- Test cases (behavioral contracts)
- Runtime traces (dynamic behavior)
- Git history (change patterns)

---

## Changelog

| Date | Change |
|------|--------|
| 2026-01-23 | Initial specification |
