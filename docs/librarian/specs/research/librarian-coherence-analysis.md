# Librarian Epistemological Coherence Analysis

**Status:** Research Analysis
**Date:** 2026-01-29
**Scope:** Analysis of existing coherence mechanisms in the Librarian epistemics module

---

## Executive Summary

Librarian has built a sophisticated epistemic infrastructure with strong **horizontal coherence** (claims at the same abstraction level support/contradict each other) but lacks explicit **vertical coherence** mechanisms (tracing implementation details to architectural principles). The system can track that "function X calls function Y" but cannot currently express or enforce that "this button color derives from the project's minimalist design philosophy."

**Key Finding:** The epistemics module provides the *primitives* for coherence but not the *structure* for cross-level reasoning.

---

## 1. Current Chain Structures

### 1.1 Evidence Ledger Chains

The `EvidenceLedger` (`src/epistemics/evidence_ledger.ts`) provides append-only provenance tracking:

```typescript
// From evidence_ledger.ts lines 348-367
export interface EvidenceEntry {
  id: EvidenceId;
  timestamp: Date;
  kind: EvidenceKind;
  payload: EvidencePayload;
  provenance: EvidenceProvenance;
  confidence?: ConfidenceValue;
  relatedEntries: EvidenceId[] | EvidenceRelation[];
  sessionId?: SessionId;
}
```

**Chain Depth Analysis:**
- Entries can reference other entries via `relatedEntries`
- The `getChain()` method (lines 898-951) performs BFS traversal to build evidence chains
- Chain confidence is computed via configurable propagation rules (min, max, product, weighted_average, noisy_or)

**Where Chains Typically End:**
1. **Source observations** (`ast_parser`, `system_observation`) - these are grounding facts
2. **User inputs** - assertions taken as given
3. **Synthesis outputs** - LLM-generated conclusions with their own provenance

```typescript
// From evidence_ledger.ts lines 174-181
export type ProvenanceSource =
  | 'ast_parser'       // Chain ends at AST extraction
  | 'llm_synthesis'    // LLM output (requires agent attribution)
  | 'embedding_search' // Vector retrieval result
  | 'user_input'       // User assertion (taken as given)
  | 'tool_output'      // External tool result
  | 'system_observation'; // Runtime observation
```

### 1.2 Evidence Graph Edges (Claim Support Relationships)

The `EvidenceGraph` (`src/epistemics/types.ts`) models claim relationships:

```typescript
// From types.ts lines 218-229
export type EdgeType =
  | 'supports'     // Source provides evidence FOR target
  | 'opposes'      // Source provides counter-evidence
  | 'assumes'      // Source assumes target is true
  | 'defeats'      // Source is a defeater for target
  | 'rebuts'       // Source directly contradicts target
  | 'undercuts'    // Source attacks justification, not claim
  | 'undermines'   // Source reduces confidence
  | 'supersedes'   // Source replaces target
  | 'depends_on'   // Source requires target
  | 'co_occurs';   // Correlation (not causation)
```

**Key Observation:** These edge types model *epistemic* relationships between claims at the **same level of abstraction**. A claim about a function's behavior `supports` a claim about module correctness, but both are at the "code behavior" level.

### 1.3 Causal Graph for Dependency Traversal

The `CausalGraph` (`src/epistemics/causal_reasoning.ts`) provides dependency analysis:

```typescript
// From causal_reasoning.ts lines 66-67
export type CausalEdgeType = 'causes' | 'enables' | 'prevents' | 'correlates';
```

**Important Theoretical Caveat** (from the file's own documentation, lines 7-35):
> This module provides GRAPH TRAVERSAL functions (Level 1 - Association) NOT causal inference.
> Finding that A is connected to B only means there is a DECLARED relationship.

This is honest self-assessment: the causal graph tracks *declared dependencies*, not *derived principles*.

---

## 2. Hierarchical Levels Present

### 2.1 Claim Types (All At Implementation Level)

From `types.ts` lines 79-89:
```typescript
export type ClaimType =
  | 'semantic'      // What code does/means
  | 'structural'    // How code is organized
  | 'behavioral'    // Runtime behavior
  | 'quality'       // Code quality metrics
  | 'security'      // Security properties
  | 'contractual'   // API contracts
  | 'relational'    // Relationships between entities
  | 'temporal'      // Time-based properties
  | 'ownership'     // Who owns/maintains code
  | 'provenance';   // Where knowledge came from
```

**Critical Observation:** All these claim types describe *properties of code artifacts*. There is **no claim type for**:
- Architectural principles
- Design rationale
- Project values
- Strategic decisions
- User experience goals

### 2.2 Claim Subjects (Code-Centric Hierarchy)

From `types.ts` lines 91-108:
```typescript
export interface ClaimSubject {
  type: 'entity' | 'file' | 'function' | 'module' | 'directory' | 'repo';
  id: string;
  name: string;
  location?: { file: string; startLine?: number; endLine?: number };
}
```

This represents a **spatial hierarchy** (function < file < module < directory < repo) but not an **conceptual hierarchy** (implementation detail < design pattern < architectural style < project philosophy).

### 2.3 Confidence Decomposition (Signal Domains, Not Abstraction Levels)

From `types.ts` lines 142-166:
```typescript
export interface ClaimSignalStrength {
  overall: number;
  retrieval: number;    // Retrieval accuracy
  structural: number;   // Structural analysis
  semantic: number;     // Semantic understanding
  testExecution: number; // Test evidence
  recency: number;      // Freshness
  aggregationMethod: 'geometric_mean' | 'weighted_average' | 'minimum' | 'product';
}
```

These are **orthogonal signal dimensions**, not abstraction levels. A claim about a button's color could have high `structural` confidence (AST says it's blue) but this doesn't connect to confidence about "project philosophy."

---

## 3. Cross-Level Constraints

### 3.1 What Exists: Defeater Propagation

The `propagateDefeat()` function (`src/epistemics/defeaters.ts` lines 1030-1136) provides **transitive defeat**:

```typescript
// From defeaters.ts lines 1030-1034
export async function propagateDefeat(
  storage: EvidenceGraphStorage,
  defeatedClaimId: ClaimId,
  maxDepth: number = 10
): Promise<AffectedClaim[]> {
```

When a claim is defeated, claims that `depends_on` or `assumes` it are marked for re-evaluation. This is **horizontal propagation** (claim-to-claim at similar levels).

### 3.2 What Exists: Contradiction Detection

From `defeaters.ts` lines 312-394, the `detectContradictions()` function checks:
- Same subject + same type = potential conflict
- Negation patterns in propositions
- Temporal vs. scope conflicts

But contradiction detection is **proposition-based**, not **principle-based**. It can detect "X does Y" vs "X does not Y" but not "this implementation contradicts our stated design goal."

### 3.3 What's Missing: Vertical Constraints

**Gap 1: No Principle Claims**
There's no way to express:
```typescript
// HYPOTHETICAL - Does not exist
type PrincipleClaim = {
  type: 'principle';
  level: 'project_philosophy' | 'architectural_style' | 'design_pattern' | 'implementation';
  derivedFrom?: ClaimId[];  // Higher-level principles this derives from
  constrains?: ClaimId[];   // Lower-level claims this constrains
};
```

**Gap 2: No Derivation Validation**
No mechanism to check:
```
IF principle P constrains claim C
AND implementation I claims to implement C
THEN I should be consistent with P
```

**Gap 3: No Abstraction Level Tags**
Claims lack:
```typescript
// HYPOTHETICAL - Does not exist
interface AbstractionLevel {
  level: number;  // 0=philosophy, 1=architecture, 2=design, 3=implementation
  derivesFrom: ClaimId[];  // Must trace to higher levels
}
```

### 3.4 Existing Mechanism That Could Support Vertical Coherence

The `TaskEpistemicValidator` (`src/epistemics/task_validation.ts`) comes closest to cross-level reasoning:

```typescript
// From task_validation.ts lines 219-268
export interface TaskEpistemicGrounding {
  problemIdentification: { /* ... */ };
  alternativesConsidered: { /* ... */ };
  counterAnalysis: { /* ... */ };
  methodWarrant: { /* ... */ };
}
```

This validates that a **task** (specific action) has sufficient justification, including:
- Evidence it's the right problem (could connect to principles)
- Alternatives considered (could validate against constraints)
- Counter-analysis (could check for principle violations)

But the `TaskClaim` doesn't explicitly link to higher-level architectural or philosophical constraints.

---

## 4. Gap Analysis: Button Color to Project Philosophy

### 4.1 The Challenge

Can we currently trace: `"Button color is #007AFF"` to `"Our project follows iOS Human Interface Guidelines"`?

**Current capability:** NO

**Why not:**
1. `"Button color is #007AFF"` would be a claim of type `'structural'` or `'semantic'` about subject type `'entity'` or `'function'`
2. `"Our project follows iOS HIG"` has no claim type - it's not about code properties
3. No edge type explicitly represents "derives from principle" or "constrained by guideline"
4. No validation mechanism checks if an implementation claim satisfies a principle claim

### 4.2 What Would Be Needed

**Level 0: Principle Registration**
```typescript
// New claim types needed
type PhilosophicalClaim = {
  type: 'principle';
  scope: 'project' | 'module' | 'component';
  imperative: string;  // "Use platform-native UI patterns"
  rationale: string;   // "Reduces cognitive load for users"
};
```

**Level 1: Architectural Constraints**
```typescript
type ArchitecturalConstraint = {
  type: 'constraint';
  derivedFrom: ClaimId;  // Links to principle
  scope: SubjectRef;     // What it constrains
  rule: string;          // "iOS components must follow HIG"
};
```

**Level 2: Design Decisions**
```typescript
type DesignDecision = {
  type: 'decision';
  satisfies: ClaimId[];  // Links to constraints
  implementation: string; // "Use SF Symbols for icons"
};
```

**Level 3: Implementation Claims (existing)**
```typescript
// Current claims about code artifacts
type ImplementationClaim = Claim;  // Already exists
```

**Level 4: Cross-Level Edges**
```typescript
type DerivedFromEdge = {
  type: 'derived_from_principle';
  from: ClaimId;  // Lower-level claim
  to: ClaimId;    // Higher-level principle
  justification: string;
  confidence: ConfidenceValue;
};
```

**Level 5: Validation Rules**
```typescript
interface CoherenceValidator {
  validateDerivation(
    implementation: Claim,
    principle: PhilosophicalClaim
  ): ValidationResult;

  detectPrincipleViolation(
    change: CodeChange,
    principles: PhilosophicalClaim[]
  ): Violation[];
}
```

### 4.3 The Core Missing Primitive

The fundamental gap is the **absence of typed abstraction levels** in the claim structure. Currently:

```
Claim = (subject, proposition, type, confidence, ...)
```

Needed:

```
Claim = (subject, proposition, type, confidence, abstractionLevel, derivesFrom, constrains, ...)
```

Where `derivesFrom` and `constrains` create a DAG (Directed Acyclic Graph) from philosophy down to implementation.

---

## 5. Bootstrap Status: Has Librarian Been Bootstrapped on Itself?

### 5.1 Configuration Evidence

From `.librarian.json`:
```json
{
  "projectName": "librarian",
  "epistemicValidation": {
    "enabled": true,
    "preset": "standard"
  }
}
```

Librarian *configures itself* to use epistemic validation, but this is **meta-configuration**, not a knowledge graph.

### 5.2 What "Bootstrapped" Would Mean

A fully bootstrapped Librarian would have:

1. **Self-Knowledge Graph**
   - Claims about every function, module, pattern in its own codebase
   - Evidence chains tracing decisions back to design principles
   - Contradictions explicitly documented (there are several in the spec)

2. **Principle Registry**
   - "Confidence must have provenance" (expressed as verifiable claim)
   - "Contradictions are never silently reconciled" (principle claim)
   - "All claims must have typed confidence" (constraint claim)

3. **Derivation Chains**
   - `confidence.ts` implements `D1-D7 derivation rules` BECAUSE OF `"principled confidence" principle`
   - `defeaters.ts` tracks `higher-order defeat` BECAUSE OF `"Pollock's argumentation theory" philosophical commitment`

4. **Self-Validation**
   - On every commit, verify own claims against own principles
   - Detect when new code violates stated architectural constraints
   - Generate warnings when implementation diverges from philosophy

### 5.3 Current State: Partial Bootstrap

**What exists:**
- Extensive documentation in `/docs/librarian/specs/` describing principles
- Code comments referencing theoretical foundations (e.g., `// Based on Pollock's defeaters`)
- Config file enabling epistemic validation

**What's missing:**
- No evidence graph populated with Librarian's own claims
- No principle claims registered as first-class knowledge entities
- No derivation chains connecting code decisions to philosophical commitments
- No automated coherence checking of own codebase

**Evidence of non-bootstrap:** The research documents in `/docs/librarian/specs/research/` describe principles *textually* but don't register them as machine-verifiable claims in the epistemic system.

### 5.4 What Self-Bootstrap Would Look Like

```typescript
// Hypothetical self-bootstrap initialization
async function bootstrapLibrarian(storage: EvidenceGraphStorage, ledger: IEvidenceLedger) {
  // Register foundational principles
  const p1 = await registerPrinciple({
    id: 'PRINCIPLE-001',
    statement: 'All confidence values must have explicit provenance',
    rationale: 'Prevents "magic numbers" that erode trust',
    source: { type: 'human', id: 'architecture-decision' }
  });

  // Register derived constraints
  const c1 = await registerConstraint({
    id: 'CONSTRAINT-001',
    derivedFrom: p1.id,
    statement: 'ConfidenceValue must be deterministic|derived|measured|bounded|absent',
    scope: { type: 'module', name: 'epistemics' }
  });

  // Verify implementation satisfies constraint
  const verification = await verifyImplementation({
    constraint: c1.id,
    implementation: 'src/epistemics/confidence.ts',
    method: 'type_analysis',
    result: 'SATISFIES'
  });

  // Create derivation edge
  await createDerivationEdge({
    from: verification.claimId,
    to: c1.id,
    justification: 'TypeScript union type ensures all values have provenance'
  });
}
```

---

## 6. Summary of Findings

### 6.1 Strengths of Current System

| Capability | Implementation | Status |
|-----------|---------------|--------|
| Claim storage | `SqliteEvidenceGraphStorage` | Complete |
| Evidence chains | `getChain()` with configurable propagation | Complete |
| Defeater calculus | Higher-order defeat, grounded semantics | Complete |
| Contradiction tracking | Never silently reconciled | Complete |
| Causal reasoning | D-separation, do-calculus foundations | Complete |
| Task validation | Epistemic grounding for tasks | Complete |
| Confidence provenance | 5-variant ConfidenceValue type | Complete |
| Multi-agent epistemics | Belief aggregation, testimony evaluation | Complete |

### 6.2 Gaps for Cross-Level Coherence

| Gap | Description | Impact |
|-----|-------------|--------|
| No principle claims | Can't express "our project values X" | Can't validate implementations against values |
| No abstraction levels | All claims are "flat" | Can't distinguish button color from architecture |
| No derivation edges | No "derived_from_principle" relationship | Can't trace decisions to rationale |
| No constraint validation | No mechanism to check principle satisfaction | Coherence violations go undetected |
| No self-bootstrap | Librarian doesn't have knowledge of itself | Can't demonstrate own coherence |

### 6.3 Recommended Next Steps

1. **Extend ClaimType** to include `'principle'`, `'constraint'`, `'decision'`
2. **Add AbstractionLevel** field to Claim with explicit level numbers
3. **Create new EdgeType** `'derived_from'` and `'constrains'`
4. **Implement CoherenceValidator** that traverses derivation chains
5. **Bootstrap Librarian** by populating its own knowledge graph
6. **Add principle violation detection** to the defeater detection cycle

---

## 7. Code References

| File | Lines | Description |
|------|-------|-------------|
| `src/epistemics/types.ts` | 1-670 | Core type definitions (claims, edges, defeaters) |
| `src/epistemics/evidence_ledger.ts` | 1-1752 | Append-only evidence storage |
| `src/epistemics/defeaters.ts` | 1-2497 | Defeater detection and propagation |
| `src/epistemics/storage.ts` | 1-1133 | SQLite evidence graph storage |
| `src/epistemics/task_validation.ts` | 1-1591 | Epistemic grounding for tasks |
| `src/epistemics/causal_reasoning.ts` | 1-1286 | Causal graph and traversal |
| `src/epistemics/confidence.ts` | (not shown) | ConfidenceValue 5-variant type |
| `.librarian.json` | 1-18 | Project epistemic configuration |

---

## 8. Conclusion

Librarian has built an impressive epistemic foundation with sophisticated mechanisms for:
- Tracking claim provenance and confidence
- Detecting and handling defeaters
- Managing contradictions explicitly
- Validating task justifications

However, the system operates **within a single abstraction level** (code properties). To achieve true epistemological coherence across abstraction levels, Librarian needs:

1. **Typed abstraction levels** for claims
2. **Derivation relationships** connecting levels
3. **Validation mechanisms** that enforce cross-level coherence
4. **Self-application** (bootstrapping) to demonstrate the system's own coherence

The primitives are in place; the structure for vertical coherence is not.

---

*Analysis performed by examining source code in `/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/librarian/src/epistemics/`*
