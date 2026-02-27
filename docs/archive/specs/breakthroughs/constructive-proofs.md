# Constructive Proofs Specification

> **Version**: 1.0.0
> **Status**: DRAFT
> **Last Updated**: 2026-01-23
>
> **Theory Reference**: Novel approach - no existing system implements this for code understanding.

---

## Executive Summary

**Current RAG systems**: "Here's answer X. [cites A, B, C]"
**Constructive Proofs**: "Here's answer X with verifiable logical chain."

Instead of citation-style evidence, LiBrainian produces **proofs**: structured arguments where each step can be independently verified. This transforms LiBrainian from "retrieval and synthesis" to "understanding and justification."

---

## 1. The Problem with Citations

### 1.1 Citations Don't Prove

Traditional RAG systems cite sources:
> "The function `calculateTotal` handles edge cases [src/utils.ts:42]"

This tells you *where* the evidence is, not *why* the claim follows from it.

### 1.2 What We Need

A constructive proof shows:
1. **Premises**: What facts are we starting from?
2. **Inferences**: What logical steps connect premises to conclusion?
3. **Defeaters**: What could invalidate this proof?
4. **Verification**: How can each step be independently checked?

---

## 2. Proof Structure

### 2.1 Core Types

```typescript
/**
 * A constructive proof for a claim about code.
 *
 * INVARIANT: All premises trace to verifiable sources
 * INVARIANT: All inferences use explicit rules
 * INVARIANT: Proof is self-contained (no external dependencies)
 */
interface ConstructiveProof {
  /** Unique identifier */
  id: ProofId;

  /** The claim being proven */
  claim: ProofClaim;

  /** Premises the proof is built on */
  premises: Premise[];

  /** Inference steps from premises to claim */
  inferences: InferenceStep[];

  /** Known defeaters (attacks on the proof) */
  defeaters: Defeater[];

  /** Overall proof status */
  status: ProofStatus;

  /** Confidence in the proof */
  confidence: ConfidenceValue;

  /** When was this proof constructed */
  constructedAt: Date;

  /** Proof metadata */
  metadata: ProofMetadata;
}

type ProofId = string & { readonly __brand: 'ProofId' };
```

### 2.2 Claims

```typescript
/**
 * A claim that can be proven or refuted.
 */
interface ProofClaim {
  /** Human-readable statement */
  statement: string;

  /** Formal representation (if available) */
  formal?: FormalClaim;

  /** Claim category */
  category: ClaimCategory;

  /** Subject of the claim */
  subject: ClaimSubject;

  /** Scope limitations */
  scope: ClaimScope;
}

type ClaimCategory =
  | 'existence'      // "Function X exists"
  | 'relationship'   // "X calls Y"
  | 'behavior'       // "X handles null inputs"
  | 'quality'        // "X has O(n) complexity"
  | 'equivalence'    // "X is equivalent to Y"
  | 'absence';       // "X does not exist"

interface ClaimSubject {
  type: 'function' | 'class' | 'file' | 'pattern' | 'system';
  identifier: string;
  location?: CodeLocation;
}

interface ClaimScope {
  /** What version/commit is this claim about? */
  version?: string;

  /** What conditions must hold for claim to apply? */
  conditions: string[];

  /** Known limitations */
  limitations: string[];
}
```

### 2.3 Premises

```typescript
/**
 * A premise is a foundational fact the proof builds on.
 */
interface Premise {
  /** Unique identifier within proof */
  id: PremiseId;

  /** The assertion */
  assertion: string;

  /** How was this established? */
  source: PremiseSource;

  /** Confidence in this premise */
  confidence: ConfidenceValue;

  /** How can this be verified? */
  verificationMethod: VerificationMethod;

  /** Current verification status */
  verificationStatus: VerificationStatus;
}

type PremiseId = string & { readonly __brand: 'PremiseId' };

type PremiseSource =
  | { type: 'ast'; location: CodeLocation; astNode: string }
  | { type: 'llm'; prompt: string; model: string }
  | { type: 'test'; testFile: string; testName: string }
  | { type: 'documentation'; docPath: string }
  | { type: 'axiom'; justification: string };

type VerificationMethod =
  | { type: 'ast_check'; query: string }
  | { type: 'test_execution'; testId: string }
  | { type: 'llm_verification'; prompt: string }
  | { type: 'manual'; description: string }
  | { type: 'unverifiable'; reason: string };

type VerificationStatus = 'verified' | 'unverified' | 'failed' | 'pending';
```

### 2.4 Inferences

```typescript
/**
 * An inference step connects premises to conclusions.
 */
interface InferenceStep {
  /** Unique identifier within proof */
  id: InferenceId;

  /** The inference rule applied */
  rule: InferenceRule;

  /** Input premise IDs */
  from: PremiseId[];

  /** Output (intermediate conclusion or final claim) */
  to: PremiseId | 'claim';

  /** Justification for this inference */
  justification: string;

  /** Confidence contribution */
  confidence: ConfidenceValue;
}

type InferenceId = string & { readonly __brand: 'InferenceId' };

type InferenceRule =
  | 'modus_ponens'        // If P and P→Q, then Q
  | 'modus_tollens'       // If ¬Q and P→Q, then ¬P
  | 'syllogism'           // If P→Q and Q→R, then P→R
  | 'conjunction'         // If P and Q, then P∧Q
  | 'disjunction_elim'    // If P∨Q and ¬P, then Q
  | 'universal_elim'      // If ∀x.P(x), then P(a)
  | 'existential_intro'   // If P(a), then ∃x.P(x)
  | 'code_structure'      // Domain-specific structural inference
  | 'semantic_implication' // LLM-backed semantic inference
  | 'analogy';            // By analogy to similar code
```

### 2.5 Defeaters

```typescript
/**
 * A defeater attacks the proof or its premises.
 */
interface Defeater {
  /** Unique identifier */
  id: DefeaterId;

  /** What is being attacked */
  target: PremiseId | InferenceId | 'claim';

  /** Source of the defeating evidence */
  source: DefeaterSource;

  /** Strength of the attack */
  strength: DefeatStrength;

  /** Current status */
  status: DefeaterStatus;

  /** How to resolve this defeater */
  resolution?: DefeaterResolution;
}

type DefeaterId = string & { readonly __brand: 'DefeaterId' };

interface DefeaterSource {
  type: 'contradicting_evidence' | 'failed_verification' | 'scope_violation' | 'outdated';
  evidence: string;
  location?: CodeLocation;
}

type DefeatStrength = 'weak' | 'moderate' | 'strong' | 'definitive';

type DefeaterStatus =
  | 'active'       // Currently defeats the proof
  | 'addressed'    // Resolved (proof updated)
  | 'dismissed'    // Determined to be invalid
  | 'uncertain';   // Needs investigation

interface DefeaterResolution {
  method: 'scope_narrowing' | 'premise_update' | 'inference_correction' | 'dismissal';
  explanation: string;
  evidence?: string;
}
```

---

## 3. Proof Construction

### 3.1 Proof Builder Interface

```typescript
/**
 * Constructs proofs from claims and evidence.
 */
interface IProofBuilder {
  /**
   * Build a proof for a claim.
   */
  buildProof(claim: ProofClaim, context: ProofContext): Promise<ConstructiveProof>;

  /**
   * Add a premise to an existing proof.
   */
  addPremise(proofId: ProofId, premise: Omit<Premise, 'id'>): Promise<Premise>;

  /**
   * Add an inference step.
   */
  addInference(proofId: ProofId, inference: Omit<InferenceStep, 'id'>): Promise<InferenceStep>;

  /**
   * Check for defeaters.
   */
  findDefeaters(proofId: ProofId): Promise<Defeater[]>;

  /**
   * Verify a proof.
   */
  verify(proofId: ProofId): Promise<ProofVerification>;
}

interface ProofContext {
  /** Available evidence sources */
  sources: EvidenceSource[];

  /** Maximum proof depth */
  maxDepth: number;

  /** Time budget */
  timeoutMs: number;

  /** Required confidence threshold */
  minConfidence: number;
}
```

### 3.2 Proof Construction Algorithm

```
ALGORITHM BuildProof(claim, context):
  1. IDENTIFY candidate premises from evidence sources
  2. FILTER premises by relevance to claim
  3. FOR each premise candidate:
       a. VERIFY premise using verification method
       b. IF verified, ADD to proof
  4. CONSTRUCT inference chain from premises to claim
  5. FOR each inference step:
       a. VALIDATE rule application
       b. COMPUTE confidence contribution
  6. SEARCH for potential defeaters
  7. FOR each defeater found:
       a. ASSESS strength
       b. ATTEMPT resolution if possible
  8. COMPUTE overall proof confidence
  9. SET proof status based on verification
  RETURN proof
```

---

## 4. Proof Verification

### 4.1 Verification Interface

```typescript
/**
 * Verifies a constructive proof.
 */
interface IProofVerifier {
  /**
   * Verify the entire proof.
   */
  verify(proof: ConstructiveProof): Promise<ProofVerification>;

  /**
   * Verify a single premise.
   */
  verifyPremise(premise: Premise): Promise<PremiseVerification>;

  /**
   * Verify an inference step.
   */
  verifyInference(inference: InferenceStep, proof: ConstructiveProof): Promise<InferenceVerification>;
}

interface ProofVerification {
  /** Overall verification result */
  result: 'valid' | 'invalid' | 'partial' | 'unknown';

  /** Individual premise verifications */
  premises: Map<PremiseId, PremiseVerification>;

  /** Individual inference verifications */
  inferences: Map<InferenceId, InferenceVerification>;

  /** Active defeaters */
  activeDefeaters: Defeater[];

  /** Overall confidence after verification */
  confidence: ConfidenceValue;

  /** Verification metadata */
  metadata: {
    verifiedAt: Date;
    duration: number;
    method: string;
  };
}

interface PremiseVerification {
  premiseId: PremiseId;
  result: 'verified' | 'failed' | 'unverifiable';
  evidence?: string;
  confidence: ConfidenceValue;
}

interface InferenceVerification {
  inferenceId: InferenceId;
  result: 'valid' | 'invalid' | 'uncertain';
  reason?: string;
  confidence: ConfidenceValue;
}
```

---

## 5. Proof Display

### 5.1 Human-Readable Format

```typescript
/**
 * Render a proof for human consumption.
 */
function renderProof(proof: ConstructiveProof): string {
  const lines: string[] = [];

  lines.push(`## Proof: ${proof.claim.statement}`);
  lines.push('');

  lines.push('### Premises');
  for (const premise of proof.premises) {
    const status = premise.verificationStatus === 'verified' ? '✓' : '?';
    lines.push(`${status} [P${premise.id}] ${premise.assertion}`);
    lines.push(`   Source: ${formatSource(premise.source)}`);
  }
  lines.push('');

  lines.push('### Inference Chain');
  for (const inf of proof.inferences) {
    const from = inf.from.map(id => `P${id}`).join(', ');
    const to = inf.to === 'claim' ? 'Claim' : `P${inf.to}`;
    lines.push(`[${inf.rule}] ${from} → ${to}`);
    lines.push(`   ${inf.justification}`);
  }
  lines.push('');

  if (proof.defeaters.length > 0) {
    lines.push('### Defeaters');
    for (const d of proof.defeaters) {
      lines.push(`⚠️ [${d.strength}] ${d.source.evidence}`);
      if (d.resolution) {
        lines.push(`   Resolved: ${d.resolution.explanation}`);
      }
    }
  }

  lines.push('');
  lines.push(`**Status**: ${proof.status}`);
  lines.push(`**Confidence**: ${formatConfidence(proof.confidence)}`);

  return lines.join('\n');
}
```

### 5.2 Example Output

```markdown
## Proof: calculateTotal handles null inputs

### Premises
✓ [P1] calculateTotal function exists in src/cart.ts:42-58
   Source: AST extraction
✓ [P2] calculateTotal has parameter validation at line 43
   Source: AST node: IfStatement checking 'items === null'
✓ [P3] Null check returns empty result (0) instead of throwing
   Source: AST node: ReturnStatement with value 0
? [P4] Similar functions in codebase follow same pattern
   Source: LLM semantic analysis

### Inference Chain
[code_structure] P1, P2 → P5 (function has defensive guard)
   Function contains explicit null check as first operation
[semantic_implication] P3, P5 → Claim
   Defensive guard returns safe value, therefore handles null inputs

### Defeaters
⚠️ [moderate] Unit test test/cart.test.ts:89 expects TypeError on null
   Resolved: Test is outdated (last modified before null handling added)

**Status**: verified_with_caveats
**Confidence**: { type: 'absent', reason: 'uncalibrated' }
```

---

## 6. TDD Test Specifications

### 6.1 Tier-0 Tests (Deterministic)

| Test Case | Input | Expected Output |
|-----------|-------|-----------------|
| `build_simple_proof` | Claim + 2 premises | Valid proof with inferences |
| `premise_verification_ast` | AST-verifiable premise | Verified status |
| `inference_modus_ponens` | P, P→Q | Q derived |
| `defeater_detection` | Contradicting evidence | Defeater created |
| `confidence_propagation` | Chain of inferences | Combined confidence |
| `proof_status_with_active_defeaters` | Unresolved defeater | Status: partial |
| `render_proof_markdown` | Complete proof | Formatted string |

### 6.2 Tier-1 Tests (Integration)

| Test Case | Scenario | Acceptance Criteria |
|-----------|----------|---------------------|
| `build_proof_from_codebase` | Real function | Premises from AST |
| `llm_inference_verification` | Semantic claim | LLM verifies step |
| `defeater_from_failing_test` | Test contradicts | Defeater linked |
| `proof_persistence` | Save and load | All fields preserved |

### 6.3 Tier-2 Tests (Live)

| Test Case | Scenario | Acceptance Criteria |
|-----------|----------|---------------------|
| `80%_verifiable` | 100 random claims | 80+ proofs verifiable |
| `no_false_positives` | Invalid claims | Not proven with high confidence |

### 6.4 BDD Scenarios

```gherkin
Feature: Constructive Proofs
  As a LiBrainian system
  I want to produce proofs, not just citations
  So that claims can be independently verified

  Scenario: Building a proof for function behavior
    Given I have a function "calculateTotal" in the codebase
    And the function has a null check at line 43
    When I claim "calculateTotal handles null inputs"
    Then a proof is constructed with:
      | Premise | Source |
      | Function exists | AST extraction |
      | Null check present | AST analysis |
    And the inference chain connects premises to claim
    And the proof status is "verified"

  Scenario: Detecting defeaters
    Given I have a proof for "functionX is thread-safe"
    And a new code review reveals a race condition
    When I refresh the proof
    Then a defeater is added with strength "strong"
    And the proof status changes to "partial"
    And the confidence decreases

  Scenario: Resolving defeaters through scope narrowing
    Given I have a proof with an active defeater
    And the defeater only applies to edge case A
    When I narrow the claim scope to exclude case A
    Then the defeater status changes to "addressed"
    And the proof status returns to "verified"
```

---

## 7. Integration Points

| Component | Integration | Direction |
|-----------|-------------|-----------|
| Evidence Ledger | Records proof construction events | Writes |
| Query Engine | Uses proofs for answer confidence | Reads |
| Calibration | Tracks proof accuracy over time | Both |
| SMT Verification | Verifies formal claims | Calls |
| Defeater Calculus | Manages proof attacks | Calls |

---

## 8. Implementation Status

- [ ] Spec complete
- [ ] Tests written (Tier-0)
- [ ] Tests written (Tier-1)
- [ ] Tests written (Tier-2)
- [ ] Proof builder implemented
- [ ] Proof verifier implemented
- [ ] Gate passed

---

## Changelog

| Date | Change |
|------|--------|
| 2026-01-23 | Initial specification |
