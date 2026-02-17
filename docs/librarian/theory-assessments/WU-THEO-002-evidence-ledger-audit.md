# WU-THEO-002: Evidence Ledger Epistemology Review

**Work Unit**: WU-THEO-002
**Type**: Theoretical Assessment
**Status**: COMPLETE
**Date**: 2026-01-27
**Assessor**: Claude Opus 4.5

---

## Executive Summary

This assessment evaluates the Evidence Ledger implementation against AGM belief revision theory, W3C PROV provenance standards, and broader epistemic foundations. The analysis reveals a **philosophically coherent but epistemically incomplete** design.

**Key Finding**: The append-only architecture is not a limitation but a deliberate choice that sidesteps AGM contraction complexity in favor of temporal truth models. However, this creates obligations that are not fully met.

**Overall Assessment**: 7/10 - Sound architectural choices with addressable gaps.

| Criterion | Rating | Notes |
|-----------|--------|-------|
| AGM Alignment | 6/10 | Non-standard but coherent; revision model unclear |
| Provenance Completeness | 7/10 | Good structure, missing W3C PROV concepts |
| Epistemic Properties | 8/10 | Strong immutability guarantees |
| Chain Integrity | 6/10 | Minimum-based confidence is simplistic |

**Priority**: HIGH - The ledger is foundational; gaps propagate to all dependent systems.

---

## 1. AGM Belief Revision Analysis

### 1.1 Background: The AGM Framework

The AGM framework (Alchourrón, Gärdenfors, Makinson, 1985) provides the canonical theory for rational belief change with three operations:

- **Expansion (K + p)**: Adding a belief p to knowledge base K
- **Contraction (K - p)**: Removing belief p from K
- **Revision (K * p)**: Adding belief p that may contradict existing beliefs

AGM postulates ensure rationality:
1. **Success**: The new belief is included after expansion/revision
2. **Inclusion**: Expansion only adds, does not remove
3. **Vacuity**: If p is consistent with K, revision equals expansion
4. **Consistency**: If p is consistent, K * p is consistent
5. **Extensionality**: Logically equivalent beliefs produce same results
6. **Recovery**: (K - p) + p recovers K (controversial)

### 1.2 Assessment: Append-Only vs. AGM

**Finding**: The Evidence Ledger explicitly rejects AGM contraction.

From the implementation:
```typescript
/**
 * INVARIANT: No entry can be deleted or modified after append
 */
interface IEvidenceLedger {
  append(entry: Omit<EvidenceEntry, 'id' | 'timestamp'>): Promise<EvidenceEntry>;
  // Note: No delete(), no update(), no contract()
}
```

This is a **deliberate architectural choice**, not an oversight. The ledger implements a **temporal epistemology** rather than classical AGM:

| AGM Concept | Ledger Implementation | Epistemological Interpretation |
|-------------|----------------------|-------------------------------|
| Contraction | Not implemented | Beliefs are never removed; they become "superseded" or "defeated" |
| Revision | Append + contradiction record | New beliefs coexist with old; contradiction is recorded |
| Expansion | `append()` | Standard belief addition |

**Philosophical Position**: The ledger adopts a **bitemporal truth model**:
- **Valid time**: When the claim was true in the world
- **Transaction time**: When we learned it (timestamp in ledger)

This means:
- Old beliefs remain in the record forever (audit trail)
- New contradicting beliefs are added, not substituted
- Contradictions are explicitly surfaced via `ContradictionEvidence`

### 1.3 AGM Postulate Assessment

| Postulate | Status | Evidence |
|-----------|--------|----------|
| Success | SATISFIED | `append()` always returns the created entry |
| Inclusion | SATISFIED | Append-only by design |
| Vacuity | N/A | No revision operation defined |
| Consistency | PARTIALLY SATISFIED | Contradictions recorded but not resolved |
| Extensionality | UNTESTED | No mechanism to detect logical equivalence |
| Recovery | N/A | No contraction to recover from |

### 1.4 Contradiction Handling Gap

**Critical Issue**: AGM requires consistency, but the ledger allows contradictions to persist.

From `evidence_ledger.ts`:
```typescript
export interface ContradictionEvidence {
  claimA: EvidenceId;
  claimB: EvidenceId;
  contradictionType: 'direct' | 'implicational' | 'temporal' | 'scope';
  explanation: string;
  severity: 'blocking' | 'significant' | 'minor';
}
```

The ledger **detects** contradictions but does not **resolve** them. This is philosophically defensible (non-monotonic reasoning allows contradictions) but creates operational issues:

- **Problem**: Downstream systems receive both claims with no guidance on which to believe
- **Problem**: Chain confidence computation includes both contradicting claims
- **Problem**: No explicit "prefer A over B" resolution record

**Recommendation**: Implement `ContradictionResolution` records (defined in `types.ts` but not used in ledger):
```typescript
interface ContradictionResolution {
  method: 'prefer_a' | 'prefer_b' | 'merge' | 'both_valid' | 'neither_valid' | 'context_dependent';
  explanation: string;
  resolver: string;
  resolvedAt: string;
  tradeoff: string;  // Explicit documentation of decision
}
```

### 1.5 Implicit Belief Revision

**Observation**: The ledger performs implicit revision through:

1. **ClaimStatus changes**: Claims can be marked `defeated`, `superseded`, `stale`
2. **Defeater activation**: Active defeaters reduce effective confidence
3. **Evidence linking**: New claims reference old claims via `relatedEntries`

This is a form of **paraconsistent logic** where contradictions are tolerated but tracked. The system implements "soft revision" through confidence degradation rather than "hard revision" through deletion.

**Assessment**: This is a valid epistemological stance, but it should be explicit:
- Document that the ledger implements temporal paraconsistent epistemology, not AGM
- Clarify that "current belief" is computed dynamically from active, non-defeated, non-contradicted claims

---

## 2. W3C PROV Standard Assessment

### 2.1 Background: PROV-DM Model

W3C PROV defines a provenance data model with three core concepts:

- **Entity**: A thing (data, document, artifact)
- **Activity**: Something that happens over time
- **Agent**: Something that bears responsibility

Key relationships:
- `wasGeneratedBy(entity, activity)`: Entity was produced by activity
- `used(activity, entity)`: Activity used entity as input
- `wasAttributedTo(entity, agent)`: Entity was created by agent
- `wasDerivedFrom(entity, entity)`: Entity was derived from another
- `wasAssociatedWith(activity, agent)`: Agent was involved in activity
- `actedOnBehalfOf(agent, agent)`: Delegation relationship

### 2.2 PROV Mapping Assessment

| PROV Concept | Ledger Implementation | Completeness |
|--------------|----------------------|--------------|
| Entity | `EvidenceEntry` | GOOD |
| Activity | Implicit in `EvidenceKind` | PARTIAL |
| Agent | `EvidenceProvenance.agent` | PARTIAL |
| wasGeneratedBy | `EvidenceEntry.timestamp` + `provenance` | IMPLICIT |
| used | `relatedEntries` | PARTIAL |
| wasAttributedTo | `provenance.agent` | GOOD |
| wasDerivedFrom | `relatedEntries` | PARTIAL |
| wasAssociatedWith | Not explicitly modeled | MISSING |
| actedOnBehalfOf | Not modeled | MISSING |

### 2.3 Provenance Structure Analysis

The `EvidenceProvenance` interface:
```typescript
export interface EvidenceProvenance {
  source: ProvenanceSource;
  method: string;
  agent?: {
    type: 'llm' | 'embedding' | 'ast' | 'human' | 'tool';
    identifier: string;
    version?: string;
  };
  inputHash?: string;
  config?: Record<string, unknown>;
}
```

**Strengths**:
- Agent typing with version
- Input hash for reproducibility
- Configuration capture

**Gaps**:

1. **Missing Activity Model**: PROV separates "what happened" (Activity) from "what was produced" (Entity). The ledger conflates these - `EvidenceKind` partially represents activity types but is mixed with entity types.

2. **No Delegation Chain**: When an LLM acts on behalf of a user, there's no way to record:
   ```
   userAgent --actedOnBehalfOf--> llmAgent --generated--> evidence
   ```

3. **Missing Temporal Activity Bounds**: PROV Activities have start/end times. The ledger only captures `timestamp` (creation time), not activity duration except in specific payloads (`RetrievalEvidence.latencyMs`).

4. **No Invalidation Records**: PROV supports `wasInvalidatedBy(entity, activity)`. The ledger has no direct equivalent - defeaters are separate from invalidation provenance.

### 2.4 Derivation Chain Reconstruction

**Question**: Can full derivation chains be reconstructed?

**Answer**: Partially.

The `getChain()` method implements BFS traversal:
```typescript
async getChain(claimId: EvidenceId): Promise<EvidenceChain> {
  // BFS to collect all related evidence
  const queue: EvidenceId[] = [claimId];
  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const entry = await this.get(currentId);
    // ...traverse relatedEntries
  }
}
```

**Strengths**:
- Complete transitive closure of `relatedEntries`
- Contradiction collection during traversal
- Graph structure returned

**Gaps**:
1. **Relationship types not preserved**: `relatedEntries` is an untyped list. We lose the distinction between "supports", "opposes", "derived_from", etc. (This is available in `types.ts` EdgeType but not in the ledger's `relatedEntries`.)

2. **No temporal ordering in chain**: The BFS doesn't order by timestamp, so causal ordering is lost.

3. **Circular reference handling**: The implementation handles cycles (`visited` set) but doesn't report them as potential issues.

**Recommendation**: Add relationship typing to `relatedEntries`:
```typescript
interface EvidenceRelation {
  targetId: EvidenceId;
  relationType: 'supports' | 'derived_from' | 'contradicts' | 'supersedes' | 'used_by';
}
```

### 2.5 Agent Attribution Completeness

**Question**: Is there agent attribution for all evidence?

**Answer**: Optional, not enforced.

```typescript
export interface EvidenceProvenance {
  // ...
  agent?: {  // NOTE: Optional
    type: 'llm' | 'embedding' | 'ast' | 'human' | 'tool';
    identifier: string;
    version?: string;
  };
}
```

**Concern**: Without mandatory agent attribution, provenance chains can have attribution gaps.

**Recommendation**:
- Make `agent` required for certain `ProvenanceSource` values
- Add validation in `append()` to enforce attribution requirements

---

## 3. Epistemic Properties Assessment

### 3.1 Immutability Guarantee

**Claim**: The ledger is truly append-only.

**Assessment**: STRONG

Evidence:
1. No `update()` or `delete()` methods on `IEvidenceLedger`
2. SQLite schema has no mechanisms for modification
3. No SQL UPDATE or DELETE statements in implementation
4. WAL mode provides crash recovery without mutation

**Remaining Risk**: Direct SQL access could bypass the interface.

**Recommendation**: Consider adding SQLite triggers to prevent modifications:
```sql
CREATE TRIGGER prevent_ledger_update BEFORE UPDATE ON evidence_ledger
BEGIN
  SELECT RAISE(ABORT, 'Evidence ledger is append-only');
END;

CREATE TRIGGER prevent_ledger_delete BEFORE DELETE ON evidence_ledger
BEGIN
  SELECT RAISE(ABORT, 'Evidence ledger is append-only');
END;
```

### 3.2 Replay Determinism

**Question**: Can replays produce deterministic results?

**Answer**: Partial support.

Supporting evidence:
- `inputHash` in provenance enables input verification
- `sessionId` groups related entries
- Timestamps are recorded

**Issues**:

1. **Non-deterministic IDs**:
   ```typescript
   const id = createEvidenceId();  // randomUUID()
   ```
   Replays generate different IDs, breaking referential integrity.

2. **Timestamp variation**:
   ```typescript
   const timestamp = new Date();  // Current time
   ```
   Replays cannot recreate original timestamps.

3. **LLM non-determinism**: LLM-generated evidence is inherently non-deterministic even with same inputs.

**Recommendation for replay support**:
```typescript
interface ReplayOptions {
  preserveIds?: boolean;      // Use original IDs
  preserveTimestamps?: boolean; // Use original timestamps
  seedRng?: number;           // For deterministic randomness
}

async appendWithReplay(
  entry: Omit<EvidenceEntry, 'id' | 'timestamp'>,
  original?: { id: EvidenceId; timestamp: Date },
  options?: ReplayOptions
): Promise<EvidenceEntry>;
```

### 3.3 Evidence Staleness Handling

**Question**: How is evidence staleness handled?

**Answer**: Externally, via defeaters.

The ledger itself has no staleness concept. Staleness is handled through the defeater system (see `types.ts`):
```typescript
type ExtendedDefeaterType =
  | 'staleness'             // Knowledge is too old
  // ...
```

**Assessment**: This is architecturally clean (separation of concerns) but creates a gap:

- The ledger has no intrinsic staleness checking
- Staleness defeaters must be created by external systems
- No built-in TTL or expiration mechanism

**Observation**: This is appropriate for an audit log but creates dependency on the defeater detection system being operational.

---

## 4. Chain Integrity Assessment

### 4.1 EvidenceChain Computation Soundness

The `getChain()` method constructs an `EvidenceChain`:

```typescript
export interface EvidenceChain {
  root: EvidenceEntry;
  evidence: EvidenceEntry[];
  graph: Map<EvidenceId, EvidenceId[]>;
  chainConfidence: ConfidenceValue;
  contradictions: ContradictionEvidence[];
}
```

**Soundness Analysis**:

1. **Graph construction**: Correct BFS traversal with cycle prevention
2. **Contradiction collection**: Properly identifies contradiction entries during traversal
3. **Graph structure**: Adjacency list correctly captures `relatedEntries`

**Issue**: The `evidence` array is not topologically sorted despite the spec claiming "topologically sorted". The BFS order is level-order, not topological.

### 4.2 Chain Confidence Derivation

The `computeChainConfidence` implementation:

```typescript
private computeChainConfidence(entries: EvidenceEntry[]): ConfidenceValue {
  const confidences = entries
    .filter((e) => e.confidence)
    .map((e) => e.confidence!);

  if (confidences.length === 0) {
    return { type: 'absent', reason: 'insufficient_data' };
  }

  // If any confidence is absent, chain is absent
  if (confidences.some((c) => c.type === 'absent')) {
    return { type: 'absent', reason: 'uncalibrated' };
  }

  // Compute minimum for derived chain
  const values = confidences.map((c) => {
    switch (c.type) {
      case 'deterministic':
      case 'derived':
      case 'measured':
        return c.value;
      case 'bounded':
        return c.low;  // Uses lower bound
      default:
        return 0;
    }
  });

  const minValue = Math.min(...values);

  return {
    type: 'derived',
    value: minValue,
    formula: 'min(chain_entries)',
    inputs: entries
      .filter((e) => e.confidence)
      .map((e) => ({
        name: e.id,
        confidence: e.confidence!,
      })),
  };
}
```

**Assessment**: Epistemically questionable.

**Problem 1: Minimum is too conservative**

The minimum function treats all evidence as a serial chain where the weakest link determines overall strength. This is appropriate for:
- Sequential dependencies (A requires B requires C)

But inappropriate for:
- Parallel supporting evidence (A and B both support C independently)
- Weighted evidence (some sources more reliable than others)
- Redundant evidence (multiple independent confirmations)

**Example of failure**:
```
Evidence 1: AST extraction (confidence: 1.0, deterministic)
Evidence 2: AST extraction (confidence: 1.0, deterministic)
Evidence 3: LLM summary (confidence: 0.3, uncalibrated)
Claim: "Function X does Y"

Chain confidence = min(1.0, 1.0, 0.3) = 0.3
```

The two deterministic AST extractions should dominate, but the uncalibrated LLM summary pulls everything down.

**Problem 2: Contradictions not factored in**

```typescript
return {
  // ...
  chainConfidence,  // Does not account for contradictions
  contradictions,   // Present but not used in confidence
};
```

A chain with blocking contradictions should have reduced confidence, but the current implementation ignores this.

**Problem 3: No edge weight consideration**

The `relatedEntries` are untyped. A "supports" relationship should contribute positively; an "opposes" relationship should contribute negatively.

**Recommendations**:

1. **Implement proper propagation rules**:
   ```typescript
   type PropagationRule =
     | 'min'        // Serial chain (current)
     | 'max'        // Best evidence wins
     | 'product'    // Independence assumption (P(A and B) = P(A) * P(B))
     | 'noisy_or'   // Parallel supporting (P(not A and not B))
     | 'weighted';  // Explicit weights
   ```

2. **Factor in contradictions**:
   ```typescript
   if (contradictions.some(c => c.severity === 'blocking')) {
     return { type: 'absent', reason: 'blocking_contradiction' };
   }
   ```

3. **Add relationship-aware propagation**:
   ```typescript
   interface EvidenceChainOptions {
     propagationRule: PropagationRule;
     contradictionPolicy: 'ignore' | 'reduce' | 'block';
     edgeWeights?: Map<EvidenceId, number>;
   }
   ```

---

## 5. Identified Gaps Summary

### 5.1 Critical Gaps (Must Fix)

| Gap | Impact | Recommendation |
|-----|--------|----------------|
| Chain confidence uses naive minimum | Over-conservative estimates | Implement configurable propagation rules |
| Contradictions ignored in confidence | False confidence in contradicted claims | Factor contradictions into chain confidence |
| `relatedEntries` is untyped | Lost relationship semantics | Add relationship typing |

### 5.2 Important Gaps (Should Fix)

| Gap | Impact | Recommendation |
|-----|--------|----------------|
| Agent attribution optional | Incomplete provenance | Make required for certain sources |
| No activity model | PROV incompatibility | Separate activity/entity concerns |
| No delegation chain | Cannot track "on behalf of" | Add delegation relationships |
| Evidence array not topologically sorted | Spec violation | Fix BFS to produce topological order |

### 5.3 Minor Gaps (Could Fix)

| Gap | Impact | Recommendation |
|-----|--------|----------------|
| No SQLite triggers for immutability | Direct SQL bypass possible | Add prevention triggers |
| Non-deterministic replay | Testing difficulty | Add replay mode options |
| No built-in staleness | Dependency on defeaters | Consider optional TTL metadata |

---

## 6. Theoretical Recommendations

### 6.1 Document the Epistemological Stance

The ledger implements temporal paraconsistent epistemology, not AGM. This should be explicitly documented:

```markdown
## Epistemological Foundation

The Evidence Ledger adopts a **temporal paraconsistent epistemology**:

1. **Temporal**: Truth is indexed by time. A claim can be true at t1 and false at t2.
2. **Paraconsistent**: Contradictions are tolerated and recorded, not eliminated.
3. **Non-monotonic**: New evidence can defeat old claims without deletion.

This differs from AGM belief revision:
- AGM contraction is replaced by defeater activation
- AGM revision is replaced by append + contradiction record
- AGM consistency is replaced by contradiction detection + explicit resolution
```

### 6.2 Formalize the Belief State Function

Add a function that computes "current beliefs" from the ledger:

```typescript
interface BeliefState {
  activeClaims: Claim[];           // Non-defeated, non-contradicted
  defeatedClaims: Claim[];         // Defeated but preserved
  contradictedClaims: Claim[];     // In contradiction pairs
  unresolvedContradictions: Contradiction[];
  effectiveConfidence: Map<ClaimId, ConfidenceValue>;
}

function computeBeliefState(ledger: IEvidenceLedger, asOf?: Date): Promise<BeliefState>;
```

### 6.3 Add W3C PROV Export

For provenance interoperability:

```typescript
interface PROVExporter {
  toProvJson(chain: EvidenceChain): object;     // PROV-JSON format
  toProvN(chain: EvidenceChain): string;        // PROV-N notation
  toProvXml(chain: EvidenceChain): string;      // PROV-XML
}
```

### 6.4 Implement Graded Confidence Propagation

Replace naive minimum with epistemologically sound propagation:

```typescript
type ConfidencePropagationStrategy = {
  serial: (confidences: ConfidenceValue[]) => ConfidenceValue;      // min
  parallel: (confidences: ConfidenceValue[]) => ConfidenceValue;    // noisy-OR
  weighted: (inputs: WeightedInput[]) => ConfidenceValue;
  withContradictions: (
    base: ConfidenceValue,
    contradictions: ContradictionEvidence[]
  ) => ConfidenceValue;
};
```

---

## 7. Priority Actions

### Immediate (P0)

1. **Fix chain confidence to handle contradictions** - Currently blocking contradictions are ignored
2. **Add relationship typing to `relatedEntries`** - Required for correct propagation

### Short-term (P1)

3. **Document epistemological stance** - Clarify AGM non-compliance is intentional
4. **Implement configurable propagation rules** - Allow domain-appropriate strategies
5. **Make agent attribution required for LLM/tool sources** - Ensure provenance completeness

### Medium-term (P2)

6. **Add W3C PROV compatibility layer** - Export for interoperability
7. **Implement proper topological sort in `getChain()`** - Meet spec requirement
8. **Add replay mode support** - Enable deterministic testing

---

## 8. Conclusion

The Evidence Ledger makes defensible architectural choices that diverge from classical AGM belief revision in favor of a temporal, paraconsistent model that prioritizes auditability over logical consistency. This is appropriate for an AI system where:

- Contradictions are informative (not just errors)
- Historical reasoning traces enable debugging
- Confidence calibration requires preserved prediction/outcome pairs

However, the implementation has gaps:
- Chain confidence computation is epistemically naive
- Relationship semantics are lost in untyped `relatedEntries`
- Contradictions are detected but not factored into confidence
- PROV compatibility is partial

These gaps are addressable without architectural changes. The append-only foundation is sound; the confidence propagation and relationship modeling need refinement.

**Verdict**: The Evidence Ledger is a philosophically coherent but epistemically incomplete implementation. With the recommended changes, it can serve as a robust foundation for the LiBrainian's epistemic operations.

---

## References

1. Alchourrón, C.E., Gärdenfors, P., Makinson, D. (1985). "On the Logic of Theory Change: Partial Meet Contraction and Revision Functions." Journal of Symbolic Logic.

2. W3C PROV-DM. (2013). "PROV-DM: The PROV Data Model." https://www.w3.org/TR/prov-dm/

3. Priest, G. (2006). "In Contradiction: A Study of the Transconsistent." Oxford University Press.

4. Makinson, D. (2005). "Bridges from Classical to Nonmonotonic Logic." College Publications.

5. Pearl, J. (2009). "Causality: Models, Reasoning, and Inference." Cambridge University Press.

6. Snodgrass, R.T. (1999). "Developing Time-Oriented Database Applications in SQL." Morgan Kaufmann.

---

## Appendix A: AGM Postulate Formal Definitions

For reference, the AGM postulates in formal notation:

**Expansion Postulates (K + p)**:
1. K + p is a belief set (closure)
2. p ∈ K + p (success)
3. K ⊆ K + p (inclusion)
4. If p ∈ K, then K + p = K (vacuity)
5. If K ⊆ K', then K + p ⊆ K' + p (monotonicity)
6. K + p is the smallest set satisfying 1-5 (minimality)

**Contraction Postulates (K - p)**:
1. K - p is a belief set (closure)
2. K - p ⊆ K (inclusion)
3. If p ∉ K, then K - p = K (vacuity)
4. If p ∉ Cn(∅), then p ∉ K - p (success)
5. K ⊆ (K - p) + p (recovery)
6. If Cn(p) = Cn(q), then K - p = K - q (extensionality)

**Revision Postulates (K * p)** (via Levi identity):
K * p = (K - ¬p) + p

---

## Appendix B: W3C PROV Core Concepts Mapping

```
PROV Concept          | Ledger Equivalent           | Status
----------------------|----------------------------|--------
prov:Entity           | EvidenceEntry               | MAPPED
prov:Activity         | (implicit in EvidenceKind)  | PARTIAL
prov:Agent            | EvidenceProvenance.agent    | PARTIAL
prov:wasGeneratedBy   | provenance + timestamp      | IMPLICIT
prov:used             | relatedEntries              | PARTIAL
prov:wasAttributedTo  | provenance.agent            | MAPPED
prov:wasDerivedFrom   | relatedEntries              | PARTIAL
prov:wasAssociatedWith| (not modeled)               | MISSING
prov:actedOnBehalfOf  | (not modeled)               | MISSING
prov:wasInvalidatedBy | (defeaters, indirectly)     | INDIRECT
prov:hadMember        | (not applicable)            | N/A
prov:alternateOf      | (not modeled)               | MISSING
prov:specializationOf | (not modeled)               | MISSING
```
