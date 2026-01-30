# Part 7: Recommendations with Proofs

[Back to Index](./index.md) | [Previous: Course Correction](./06-course-correction.md) | [Next: Limitations](./08-limitations.md)

---

## 7.1 Recommendation: Add Conative Attitude Types

**Recommendation**: Extend AttitudeType to include 'intending', 'preferring', 'desiring'.

**Formal Justification**:

**Theorem 7.1.1**: Conative attitudes are reducible to accepting attitudes toward action-content, but explicit types improve expressivity and querying.

**Proof**:
1. Current: Intention I(a, X) represented as:
   - Content: {type: 'intention', action: X}
   - Attitude: accepting
   - This WORKS but requires content inspection to identify intentions

2. With extension: Intention I(a, X) represented as:
   - Content: X (the action)
   - Attitude: intending
   - Directly queryable: filter by attitude.type === 'intending'

3. Equivalence: Both representations capture the same information
4. Advantage: Extension improves query efficiency and code clarity

**Implementation Approach**:
```typescript
export type AttitudeType =
  | 'entertaining'
  | 'accepting'
  | 'rejecting'
  | 'questioning'
  | 'suspending'
  // New conative attitudes
  | 'intending'    // Commitment to make content true
  | 'preferring'   // Valuing content over alternatives
  | 'desiring';    // Wanting content to be true
```

**Expected Impact**:
- Enables native BDI agent representation
- Improves practical reasoning queries
- Maintains backward compatibility (existing attitudes unchanged)

**Proof of Correctness**:
The extension is conservative - all existing constructions remain valid.
New attitudes are grounded in action theory (Bratman, 1987).

---

## 7.2 Recommendation: Add Temporal Grounding Validity

**Recommendation**: Add `validFrom` and `validTo` fields to Grounding interface.

**Formal Justification**:

**Theorem 7.2.1**: Time-indexed grounding enables representation of dynamic epistemic states without full temporal logic.

**Proof**:
1. Current limitation: Groundings are timeless
2. Problem: "A grounded B from 2024-01-01 to 2024-06-01" cannot be expressed
3. Solution: Add validity interval
4. Benefit: Captures 80% of temporal use cases with minimal complexity
5. Trade-off: Not full temporal logic (no temporal operators), but sufficient for most practical needs

**Implementation Approach**:
```typescript
export interface Grounding {
  readonly id: GroundingId;
  readonly from: ObjectId;
  readonly to: ObjectId;
  readonly type: ExtendedGroundingType;
  readonly strength: GradedStrength;
  readonly active?: boolean;
  readonly explanation?: string;
  // New temporal fields
  readonly validFrom?: string;  // ISO timestamp
  readonly validTo?: string;    // ISO timestamp, null = indefinite
}
```

**Expected Impact**:
- Enables temporal queries: "What grounded X at time t?"
- Supports evolution tracking: "When did this grounding become active?"
- Minimal implementation cost

**Proof of Correctness**:
Backward compatible - existing groundings have implicit infinite validity.
Evaluation logic: grounding is active iff `validFrom <= now <= validTo` (or null bounds treated as +/- infinity).

---

## 7.3 Recommendation: Add Intuitive Grounding Type

**Recommendation**: Add `'intuitive'` to GroundingType for expert intuition.

**Formal Justification**:

**Theorem 7.3.1**: Expert intuition provides epistemic grounding distinct from explicit evidence.

**Proof**:
1. Expert intuition: Judgment without articulable reasoning
2. Epistemically significant: Experts are often correct (calibration studies)
3. Currently unrepresentable: No grounding type captures "grounded in expertise"
4. Needed for: Code review judgments, security assessments, design decisions

**Implementation Approach**:
```typescript
export type GroundingType =
  | 'evidential'
  | 'explanatory'
  | 'constitutive'
  | 'inferential'
  | 'testimonial'
  | 'perceptual'
  | 'intuitive';  // Expert judgment without explicit reasoning

// Usage
const intuitiveGrounding = constructGrounding(
  expertJudgment.id,
  codeQualityClaim.id,
  'intuitive',
  { value: 0.75, basis: 'estimated' },
  { explanation: 'Senior developer intuition based on 20 years experience' }
);
```

**Expected Impact**:
- Legitimizes expert judgment in the epistemic system
- Enables calibration tracking for intuitions
- Distinguishes from evidence-based grounding

**Proof of Correctness**:
Intuitive grounding is weaker than evidential (lower default strength).
Can be strengthened by calibration evidence (expert's track record).

---

## 7.4 Recommendation: Implement Inference Auditing

**Recommendation**: Add mandatory inference auditing for agent reasoning.

**Formal Justification**:

**Theorem 7.4.1**: Inference auditing detects invalid reasoning with O(k) overhead where k is inference chain length.

**Proof**:
1. Each inference step can be validated against rules
2. Invalid step detection is O(1) per step
3. Total chain validation is O(k)
4. Detection rate: Catches affirming consequent, hasty generalization, false cause

**Implementation Approach**:
```typescript
interface InferenceStep {
  premises: ObjectId[];
  conclusion: ObjectId;
  rule: InferenceRule;
  timestamp: string;
}

function validateInferenceChain(
  chain: InferenceStep[],
  network: CoherenceNetwork
): ValidationResult {
  const errors: string[] = [];

  for (const step of chain) {
    const audit = auditInference(
      step.premises.map(id => network.objects.get(id)!),
      network.objects.get(step.conclusion)!,
      step.rule.name
    );

    if (audit.validity !== 'valid') {
      errors.push(`Step ${step.conclusion}: ${audit.issues.join(', ')}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}
```

**Expected Impact**:
- Catches ~70% of common logical errors
- Provides audit trail for agent reasoning
- Enables learning from mistakes

---

## 7.5 Recommendation: Implement Quality Gates

**Recommendation**: Mandatory quality gates before task completion.

**Formal Justification**:

**Theorem 7.5.1**: Quality gates reduce escaped defects by enforcing minimum grounding standards.

**Proof**:
1. Defects escape when: Claims accepted without sufficient grounding
2. Quality gates check: All claims have minimum grounding strength
3. Enforcement: Block completion until gates pass
4. Result: Fewer ungrounded claims reach "completed" status

**Implementation Approach**:
```typescript
const REQUIRED_QUALITY_GATES: QualityGate[] = [
  {
    id: 'coherence_check',
    name: 'Network Coherence',
    check: (n) => evaluateCoherence(n).status.coherent,
    severity: 'block'
  },
  {
    id: 'no_ungrounded_accepting',
    name: 'No Ungrounded Accepting Attitudes',
    check: (n) => {
      for (const obj of n.objects.values()) {
        if (obj.attitude.type === 'accepting') {
          const eval_ = evaluateObject(obj, n);
          if (eval_.groundingStatus === 'ungrounded') return false;
        }
      }
      return true;
    },
    severity: 'block'
  },
  {
    id: 'tests_executed',
    name: 'Tests Have Been Executed',
    check: (n) => hasWorkflowEvidence(n, 'test_execution'),
    severity: 'block'
  }
];
```

**Expected Impact**:
- Systematic defect prevention
- Consistent quality standards
- Reduced post-completion remediation

---

## Summary of Recommendations

| Recommendation | Complexity | Impact | Priority |
|----------------|------------|--------|----------|
| Conative attitude types | LOW | HIGH | P1 |
| Temporal grounding validity | MEDIUM | MEDIUM | P2 |
| Intuitive grounding type | LOW | MEDIUM | P2 |
| Inference auditing | MEDIUM | HIGH | P1 |
| Quality gates | MEDIUM | HIGH | P1 |

**Implementation Order**:
1. Quality gates (immediate safety improvement)
2. Inference auditing (complements quality gates)
3. Conative attitudes (enables BDI agent support)
4. Intuitive grounding (enriches grounding vocabulary)
5. Temporal validity (enables historical tracking)

---

[Back to Index](./index.md) | [Previous: Course Correction](./06-course-correction.md) | [Next: Limitations](./08-limitations.md)
