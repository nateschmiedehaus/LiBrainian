# WU-THEO-004: Causal Reasoning Foundations Assessment

**Assessment Date**: 2026-01-27
**Assessor**: Claude Opus 4.5
**Status**: Complete
**Priority Rating**: HIGH - Critical gaps in theoretical foundations

---

## Executive Summary

The LiBrainian's causal reasoning module (`src/epistemics/causal_reasoning.ts`) implements a **Level 1 (Association)** system according to Pearl's Causal Hierarchy, with aspirational but semantically incomplete edge types for Levels 2-3. The implementation provides useful graph traversal capabilities for "what happened" queries but **cannot answer true causal questions** ("what would happen if?") or counterfactual reasoning ("what would have happened?").

**Key Finding**: The system conflates correlation with causation. Edge types like `causes`, `enables`, `prevents` are syntactic labels without formal semantics that would enable causal inference.

---

## 1. Pearl's Causal Hierarchy Assessment

### Level 1: Association (Seeing) - P(Y|X)

**Status**: IMPLEMENTED (with limitations)

The implementation fully supports observational queries:

| Capability | Implementation | Assessment |
|------------|----------------|------------|
| Graph construction from observations | `buildCausalGraphFromFacts()` | Implemented |
| Backward traversal (find correlates) | `findCauses()` | Implemented |
| Forward traversal (find correlates) | `findEffects()` | Implemented |
| Path finding | `explainCausation()` | Implemented |
| Conditional queries | Via `TraversalOptions` filtering | Implemented |

**Evidence from code** (lines 440-484 of `causal_reasoning.ts`):
```typescript
export function findCauses(
  graph: CausalGraph,
  effectId: string,
  options: TraversalOptions = {}
): CausalNode[] {
  // ... BFS traversal following incoming edges
}
```

This answers: "What nodes are connected to X via edges?" (Level 1: association)
This does NOT answer: "What would happen if we intervened on X?" (Level 2: intervention)

**Limitation**: The `findCauses()` function finds graph predecessors, not actual causes. A predecessor connected via a `correlates` edge is returned identically to one connected via a `causes` edge. The function name is misleading.

### Level 2: Intervention (Doing) - P(Y|do(X))

**Status**: NOT IMPLEMENTED

The implementation has **no mechanism** for:

1. **do-calculus**: No ability to compute P(Y|do(X)) from observational data
2. **Graph surgery**: No ability to remove incoming edges to simulate intervention
3. **Backdoor criterion**: No identification of confounders or adjustment sets
4. **Front-door criterion**: No identification of mediator-based causal effects
5. **Instrumental variables**: No support for causal effect estimation

**Missing do-operator**: The fundamental operation `do(X=x)` - simulating setting X to value x and observing Y - is absent.

**What would be needed**:
```typescript
// NOT PRESENT - would need something like:
function doCalculus(
  graph: CausalGraph,
  intervention: { node: string; value: unknown },
  outcome: string
): Distribution {
  // 1. Graph surgery: remove all incoming edges to intervention node
  // 2. Identify adjustment set via backdoor criterion
  // 3. Compute P(Y|do(X)) = sum over Z of P(Y|X,Z)P(Z)
}
```

### Level 3: Counterfactual (Imagining) - P(Y_x|X',Y')

**Status**: NOT IMPLEMENTED

The implementation has **no mechanism** for:

1. **Structural Causal Models (SCMs)**: No functional relationships f(pa, u)
2. **Counterfactual queries**: "What would Y have been if X had been different?"
3. **Exogenous variables**: No noise/disturbance term modeling
4. **Abduction-Action-Prediction**: The three-step counterfactual algorithm is absent
5. **Potential outcomes**: No Y(0)/Y(1) framework

**Example of what cannot be computed**:
- "If the config had been correct, would the query have failed?"
- "What would have happened to the build if we had not changed auth-module?"

**What would be needed**:
```typescript
// NOT PRESENT - would need something like:
interface StructuralEquation {
  variable: string;
  parents: string[];
  function: (parentValues: Map<string, unknown>, noise: number) => unknown;
  noiseDistribution: Distribution;
}

function counterfactual(
  scm: StructuralCausalModel,
  evidence: Map<string, unknown>,      // What we observed
  intervention: Map<string, unknown>,  // What we want to change
  query: string                        // What we want to know
): Distribution {
  // 1. Abduction: infer U given evidence
  // 2. Action: modify SCM with intervention
  // 3. Prediction: compute query under modified SCM
}
```

---

## 2. Edge Type Semantics Evaluation

### Current Edge Types

```typescript
type CausalEdgeType = 'causes' | 'enables' | 'prevents' | 'correlates';
```

### Assessment by Edge Type

#### `causes`

**Definition in code**: Used for function call chains (caller -> callee)
**Semantic clarity**: LOW

**Problem**: The code treats `causes` as "X precedes Y in call graph" which is temporal/structural, not causal. True causation requires:
1. Counterfactual dependence: Y would not have occurred without X
2. No common cause (confounder) explaining both
3. The right kind of process connecting X to Y

**Example from code** (line 351-364):
```typescript
// Create causal edge: caller causes callee to execute
const edge = createCausalEdge({
  from: callerId,
  to: calleeId,
  type: 'causes',
  strength: 1.0,
  // ...
});
```

This conflates "X called Y" (structural fact) with "X caused Y" (causal claim). If we refactored the code so X no longer calls Y, the causal claim would be wrong, but the historical call record would still exist.

#### `enables`

**Definition in code**: "X makes Y possible"
**Semantic clarity**: MEDIUM

**Analysis**: This corresponds to Pearl's "enabling condition" - a necessary but insufficient cause. However, the implementation treats it identically to `causes` during traversal:

```typescript
const incomingEdges = graph.edges.filter(
  (e) =>
    e.to === nodeId &&
    // 'enables' treated same as 'causes'
    (!edgeTypes || edgeTypes.includes(e.type))
);
```

**Missing**: The distinction between enabling conditions and triggering causes is not operationalized. In Pearl's framework, enablers modify the structural equation but don't trigger the effect.

#### `prevents`

**Definition in code**: "X blocks Y"
**Semantic clarity**: MEDIUM

**Analysis**: This is the inverse of `causes` - it models inhibition. However:
1. The traversal logic doesn't treat `prevents` specially
2. There's no negative strength or Boolean logic
3. `prevents` edges are followed during `findCauses()` - which is semantically wrong

**Example issue**: If A prevents B, and we call `findCauses(graph, 'B')`, should A be returned? Currently it would be (if the edge exists), but that's misleading - A is a preventer, not a cause.

#### `correlates`

**Definition in code**: "X and Y co-occur (not necessarily causal)"
**Semantic clarity**: HIGH (correctly scoped)

**Analysis**: This is the most honest edge type. It explicitly disclaims causation.

**Problem**: The implementation treats `correlates` edges identically to `causes` during traversal. A node connected via `correlates` will appear in `findCauses()` results, which violates the semantic contract.

### Edge Type Recommendation Matrix

| Edge Type | Current Semantics | Pearl Equivalent | Recommendation |
|-----------|-------------------|------------------|----------------|
| `causes` | Temporal precedence | None (conflation) | Rename to `precedes` or implement actual causal semantics |
| `enables` | Same as causes | Enabling condition | Add special handling for necessary-but-not-sufficient |
| `prevents` | Same as causes | Inhibition | Implement as negative causal strength or Boolean AND-NOT |
| `correlates` | Same as causes | Association only | Exclude from `findCauses()` by default |

---

## 3. Path Strength Computation Analysis

### Current Implementation

```typescript
// From explainCausation() - line 614
const totalStrength = pathEdges.reduce((acc, e) => acc * e.strength, 1);
```

**Formula**: Path strength = product of edge strengths

### Theoretical Assessment

**Assumptions embedded**:
1. **Independence**: Each edge is independent (no confounders)
2. **Transitivity**: Causal strength is transitive (if A causes B with strength 0.8, and B causes C with strength 0.9, then A causes C with strength 0.72)
3. **Monotonicity**: More edges = weaker causation

**Problems**:

#### 1. Confounders Not Handled

A confounder Z causing both X and Y creates a spurious correlation. The multiplicative formula cannot:
- Identify confounders
- Adjust for confounding
- Distinguish X->Y from X<-Z->Y

**Example**:
```
     Z (config change)
    / \
   v   v
  A     B (both fail)
```
The graph might have edges A->B or B->A based on temporal order, but the true causal structure is Z->A and Z->B. Path strength computation is meaningless here.

#### 2. Mediators Not Distinguished

If X->M->Y, the path strength is appropriate. But the formula cannot distinguish:
- Total effect of X on Y
- Direct effect of X on Y (controlling for M)
- Indirect effect through M

These are distinct causal quantities with different interpretations.

#### 3. Colliders Not Handled

If X->C<-Y (C is a collider), conditioning on C creates spurious association between X and Y. The implementation:
- Cannot identify colliders
- Will incorrectly compute path strengths through collider paths
- May return misleading "causal" paths

**Example**:
```
  X         Y
   \       /
    v     v
      C
```
If we observe C, X and Y become correlated (Berkson's paradox). The graph traversal would find no path from X to Y, which is correct - but if someone added a spurious X->Y edge based on this correlation, the system would accept it.

### Recommendation

The multiplicative formula is acceptable for **rough heuristics** but should be documented with caveats:

1. This is **not** a causal strength measure
2. It assumes no confounding (unrealistic)
3. It should be labeled "path connectivity strength" not "causal strength"

For true causal strength, would need:
- Structural causal model with noise terms
- do-calculus for effect identification
- Adjustment formulas for confounding

---

## 4. Missing Capabilities Assessment

### 4.1 Intervention Queries ("What if we do X?")

**Current capability**: NONE

**Use case**: "What will happen if we change the auth module?"

**Current workaround** (from test, lines 773-805):
```typescript
// Query: What will happen if we change auth-module?
const effects = findEffects(graph, 'auth-module');
```

**Why this is insufficient**: `findEffects()` finds graph descendants, not causal effects. It cannot account for:
- Confounders that affect multiple nodes
- Mediators that could be interrupted
- Colliders that create spurious associations

**What would actually happen if we do(change auth-module)**:
1. Need to identify causal path to each effect
2. Need to check for confounders (adjustment sets)
3. Need to compute P(effect|do(change)) not P(effect|observe change)

### 4.2 Counterfactual Queries ("What if X had been different?")

**Current capability**: NONE

**Use case**: "If the config had been correct, would the query have succeeded?"

**What's needed**:
1. Structural equations for each variable
2. Noise/disturbance terms to capture unmodeled factors
3. Abduction step to infer noise given observations
4. Prediction under modified structural equations

### 4.3 Causal Discovery

**Current capability**: NONE

**Use case**: "Given these observations, what is the causal structure?"

**Current approach**: Structure is manually specified (from AST facts and events)

**What's missing**:
- PC algorithm (constraint-based discovery)
- FCI algorithm (for hidden confounders)
- Score-based methods (BIC, MDL)
- Hybrid approaches

**Assessment**: Manual specification is appropriate for code structure (call graphs are known), but causal relationships between runtime events should potentially be discovered.

### 4.4 Sensitivity Analysis

**Current capability**: NONE

**Use case**: "How robust is this causal claim to hidden confounders?"

**What's needed**:
- Bounds on causal effects under unmeasured confounding
- E-value calculation for claim robustness
- Partial identification with instrumental variables

---

## 5. Identified Gaps Summary

| Gap | Pearl Level | Severity | Difficulty to Fix |
|-----|-------------|----------|-------------------|
| No do-calculus | L2 | HIGH | HIGH (requires SCM) |
| No counterfactuals | L3 | HIGH | HIGH (requires SCM + noise) |
| Edge semantics conflated | L1 | MEDIUM | MEDIUM (API redesign) |
| `correlates` treated as `causes` | L1 | MEDIUM | LOW (filter change) |
| Path strength = causal strength | L2 | MEDIUM | MEDIUM (rename + document) |
| No confounder handling | L2 | HIGH | HIGH (requires identification) |
| No collider handling | L1-L2 | MEDIUM | MEDIUM (traversal change) |
| No causal discovery | L2 | LOW | HIGH (new algorithms) |
| No sensitivity analysis | L2 | LOW | MEDIUM |

---

## 6. Recommendations

### 6.1 Short-term (Honesty improvements)

**Priority**: HIGH
**Effort**: LOW-MEDIUM

1. **Rename functions to reflect actual semantics**:
   - `findCauses()` -> `findPredecessors()` or `findUpstreamNodes()`
   - `findEffects()` -> `findSuccessors()` or `findDownstreamNodes()`

2. **Exclude `correlates` from cause-finding by default**:
   ```typescript
   function findPredecessors(graph, nodeId, options = {}) {
     const defaultEdgeTypes = options.edgeTypes ?? ['causes', 'enables'];
     // Don't include 'correlates' or 'prevents' as causes
   }
   ```

3. **Add explicit documentation**:
   - State that this is Level 1 (associational) reasoning
   - Explain that "causal" edges are structural, not causal in Pearl's sense
   - Document the multiplicative path strength assumption

4. **Add edge type filtering presets**:
   ```typescript
   const CAUSAL_EDGES: CausalEdgeType[] = ['causes', 'enables'];
   const INHIBITING_EDGES: CausalEdgeType[] = ['prevents'];
   const CORRELATION_EDGES: CausalEdgeType[] = ['correlates'];
   ```

### 6.2 Medium-term (Basic intervention support)

**Priority**: MEDIUM
**Effort**: MEDIUM-HIGH

1. **Implement graph surgery**:
   ```typescript
   function intervene(graph: CausalGraph, nodeId: string): CausalGraph {
     // Remove all incoming edges to nodeId
     return {
       ...graph,
       edges: graph.edges.filter(e => e.to !== nodeId)
     };
   }
   ```

2. **Add backdoor criterion identification**:
   ```typescript
   function findAdjustmentSet(
     graph: CausalGraph,
     treatment: string,
     outcome: string
   ): string[] | null {
     // Find set Z that blocks all backdoor paths
   }
   ```

3. **Implement d-separation testing**:
   ```typescript
   function isDSeparated(
     graph: CausalGraph,
     x: string,
     y: string,
     z: string[]
   ): boolean {
     // Test if X and Y are d-separated given Z
   }
   ```

### 6.3 Long-term (Full causal modeling)

**Priority**: LOW (research-grade)
**Effort**: HIGH

1. **Structural Causal Models**:
   - Define structural equations for each variable
   - Model noise/disturbance terms
   - Enable counterfactual queries

2. **Causal Discovery**:
   - Implement PC or FCI algorithm
   - Learn structure from observational data
   - Handle hidden confounders

3. **Quantitative Causal Effects**:
   - Average Treatment Effect (ATE)
   - Conditional Average Treatment Effect (CATE)
   - Mediation analysis

---

## 7. Alignment with Pattern Documentation

The `EPISTEMIC_PRIMITIVES_PATTERNS.md` document (Section 4) describes the causal reasoning pattern accurately but **oversells** its capabilities:

**Document claims**:
> "Build explicit causal graphs that distinguish between different types of causal relationships"

**Reality**: The graph distinguishes edge types syntactically but not semantically - all types are treated identically during traversal.

**Document claims**:
> "cause finding (backward traversal)" and "effect finding (forward traversal)"

**Reality**: These find graph predecessors/successors, not causal antecedents/consequences.

**Recommendation**: Update documentation to clearly state:
1. This is associational (Level 1) reasoning
2. Edge types are semantic labels without formal causal semantics
3. "Cause" means "upstream in graph" not "counterfactually responsible"

---

## 8. Conclusion

The LiBrainian's causal reasoning module provides **useful graph traversal** capabilities that can answer "what is connected to what?" but **cannot answer true causal questions**. The implementation is at **Level 1** of Pearl's hierarchy with aspirational but unoperationalized edge types.

**Verdict**: The module is fit for its current purpose (impact analysis, dependency tracing) but its naming and documentation suggest causal capabilities it does not have. This creates **epistemic risk** - users may trust "causal" explanations that are actually just correlation reports.

**Primary recommendation**: Rename and document honestly, then incrementally add true causal capabilities as needed.

---

## Appendix: Pearl's Causal Hierarchy Reference

| Level | Name | Query | Example | Requires |
|-------|------|-------|---------|----------|
| 1 | Association | P(Y\|X) | "What is Y given I see X?" | Observational data |
| 2 | Intervention | P(Y\|do(X)) | "What is Y if I do X?" | Causal graph + do-calculus |
| 3 | Counterfactual | P(Y_x\|X',Y') | "What would Y be if X had been different?" | SCM + noise terms |

---

## References

1. Pearl, J. (2009). *Causality: Models, Reasoning, and Inference*. Cambridge University Press.
2. Pearl, J., Glymour, M., & Jewell, N. P. (2016). *Causal Inference in Statistics: A Primer*. Wiley.
3. Spirtes, P., Glymour, C., & Scheines, R. (2000). *Causation, Prediction, and Search*. MIT Press.
4. Peters, J., Janzing, D., & Scholkopf, B. (2017). *Elements of Causal Inference*. MIT Press.
