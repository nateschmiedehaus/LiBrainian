# Pearl's Do-Calculus for Code Specification

> **Version**: 1.0.0
> **Status**: DRAFT
> **Last Updated**: 2026-01-23
>
> **Theory Reference**: Judea Pearl's Structural Causal Models (SCMs) applied to code.

---

## Executive Summary

**Current analysis**: "What files are affected?" (transitive closure)
**Do-Calculus**: "What will ACTUALLY break with what probability?"

Traditional dependency analysis shows what *could* be affected. Do-calculus shows what *will* be affected when we intervene (make a change), accounting for how the system actually behaves causally.

---

## 1. From Association to Intervention

### 1.1 The Difference

```
Question: "What happens if I change function X?"

Traditional (observational):
- "Files A, B, C import X" (transitive dependencies)
- All 100 files in the dependency chain are "affected"

Do-calculus (interventional):
- "If we do(change X), then:"
  - A will definitely break (direct caller)
  - B has 70% probability of breaking (conditional on A's behavior)
  - C is unaffected (uses X's return value, not the changed part)
  - 97 of the 100 files are actually unaffected
```

### 1.2 Pearl's Key Insight

The distribution of outcomes **after intervention** P(Y | do(X)) is different from the **observed correlation** P(Y | X).

- **P(Y | X)**: What we observe when X happens
- **P(Y | do(X))**: What happens when we MAKE X happen

For code: watching what happens vs. actively changing something.

---

## 2. Structural Causal Model for Code

### 2.1 Core Types

```typescript
/**
 * A Structural Causal Model for a codebase.
 *
 * INVARIANT: DAG structure (no cycles in causal graph)
 * INVARIANT: Each node has a structural equation
 */
interface CodeSCM {
  /** Unique identifier */
  id: SCMId;

  /** Nodes in the causal graph */
  nodes: Map<NodeId, CausalNode>;

  /** Edges (direct causal relationships) */
  edges: CausalEdge[];

  /** Structural equations for each node */
  equations: Map<NodeId, StructuralEquation>;

  /** Exogenous factors (external inputs) */
  exogenous: ExogenousFactor[];

  /** Model metadata */
  metadata: SCMMetadata;
}

type SCMId = string & { readonly __brand: 'SCMId' };
type NodeId = string & { readonly __brand: 'NodeId' };
```

### 2.2 Causal Nodes

```typescript
/**
 * A node in the causal graph representing a code entity.
 */
interface CausalNode {
  id: NodeId;

  /** Entity type */
  type: EntityType;

  /** Human-readable name */
  name: string;

  /** Code location */
  location: CodeLocation;

  /** Current state (if observable) */
  state?: EntityState;

  /** Parents (direct causes) */
  parents: NodeId[];

  /** Children (direct effects) */
  children: NodeId[];
}

type EntityType =
  | 'function'
  | 'class'
  | 'module'
  | 'type'
  | 'state'
  | 'config'
  | 'test';

interface EntityState {
  /** State values (e.g., return type, signature) */
  values: Record<string, unknown>;

  /** Last observed timestamp */
  observedAt: Date;
}
```

### 2.3 Structural Equations

```typescript
/**
 * A structural equation defines how a node's value is determined by its parents.
 *
 * X_i = f_i(PA_i, U_i)
 * where PA_i are parents and U_i is exogenous noise
 */
interface StructuralEquation {
  /** Node this equation defines */
  node: NodeId;

  /** Parent nodes in the equation */
  parents: NodeId[];

  /** The functional form */
  form: EquationForm;

  /** Exogenous factor affecting this node */
  noise?: ExogenousFactor;
}

type EquationForm =
  | { type: 'deterministic'; logic: string }      // Purely determined by parents
  | { type: 'probabilistic'; distribution: string } // Probability distribution
  | { type: 'code_defined'; function: string };    // Defined by actual code
```

### 2.4 Causal Edges

```typescript
/**
 * An edge representing a direct causal relationship.
 */
interface CausalEdge {
  from: NodeId;
  to: NodeId;

  /** Type of causal mechanism */
  mechanism: CausalMechanism;

  /** Strength of the causal effect */
  strength: number;

  /** Is this a stable relationship? */
  stability: 'stable' | 'conditional' | 'fragile';

  /** Evidence for this edge */
  evidence: string;
}

type CausalMechanism =
  | 'direct_call'       // A calls B
  | 'data_dependency'   // A uses data from B
  | 'type_inheritance'  // A extends B
  | 'shared_state'      // A and B access same state
  | 'config_dependency' // A's behavior depends on config B
  | 'test_coverage';    // Test A covers code B
```

---

## 3. Do-Calculus Operations

### 3.1 Intervention

```typescript
/**
 * Represents an intervention (forcing a variable to a value).
 * do(X = x) sets X to x, breaking all incoming causal arrows to X.
 */
interface Intervention {
  /** Target node being intervened on */
  target: NodeId;

  /** The intervention (what we're changing) */
  change: CodeChange;

  /** Expected direct effects */
  directEffects: DirectEffect[];
}

interface CodeChange {
  type: 'signature_change' | 'behavior_change' | 'removal' | 'addition';
  description: string;
  details: Record<string, unknown>;
}

interface DirectEffect {
  node: NodeId;
  effect: EffectType;
  probability: number;
  confidence: ConfidenceValue;
}

type EffectType =
  | 'compile_error'
  | 'runtime_error'
  | 'behavior_change'
  | 'performance_change'
  | 'no_effect';
```

### 3.2 Do-Intervention Engine

```typescript
/**
 * Performs do-calculus interventions on code.
 */
interface IDoCalculusEngine {
  /**
   * Compute the effect of an intervention.
   *
   * P(Y | do(X))
   */
  doIntervention(
    scm: CodeSCM,
    intervention: Intervention
  ): Promise<InterventionResult>;

  /**
   * Compute counterfactual: what would have happened?
   *
   * P(Y_x' | X = x, evidence)
   */
  counterfactual(
    scm: CodeSCM,
    observation: Observation,
    hypothetical: Intervention
  ): Promise<CounterfactualResult>;

  /**
   * Attribute responsibility for an outcome.
   *
   * Which nodes caused the observed outcome?
   */
  attributeResponsibility(
    scm: CodeSCM,
    outcome: Observation,
    candidates: NodeId[]
  ): Promise<ResponsibilityAttribution>;

  /**
   * Identify the causal effect of X on Y.
   *
   * Uses do-calculus rules to determine if effect is identifiable.
   */
  identifyCausalEffect(
    scm: CodeSCM,
    treatment: NodeId,
    outcome: NodeId
  ): Promise<CausalEffectIdentification>;
}
```

### 3.3 Intervention Results

```typescript
interface InterventionResult {
  /** The intervention performed */
  intervention: Intervention;

  /** Effects on each downstream node */
  effects: Map<NodeId, NodeEffect>;

  /** Total affected nodes */
  totalAffected: number;

  /** Critical paths (most likely to cause problems) */
  criticalPaths: CausalPath[];

  /** Confidence in this analysis */
  confidence: ConfidenceValue;
}

interface NodeEffect {
  node: NodeId;

  /** Probability of each effect type */
  effects: Map<EffectType, number>;

  /** Most likely effect */
  mostLikelyEffect: EffectType;

  /** Path from intervention to this node */
  causalPath: CausalPath;
}

interface CausalPath {
  nodes: NodeId[];
  edges: CausalEdge[];
  strength: number;  // Product of edge strengths
}
```

### 3.4 Counterfactual Results

```typescript
interface CounterfactualResult {
  /** The observation we're conditioning on */
  observation: Observation;

  /** The hypothetical intervention */
  hypothetical: Intervention;

  /** What would have happened */
  outcome: {
    wouldHaveHappened: boolean;
    probability: number;
    explanation: string;
  };

  /** Key causal factors */
  causalFactors: CausalFactor[];

  /** Confidence */
  confidence: ConfidenceValue;
}

interface Observation {
  node: NodeId;
  observedValue: unknown;
  timestamp: Date;
}

interface CausalFactor {
  node: NodeId;
  contribution: number;  // How much did this node contribute?
  mechanism: string;
}
```

### 3.5 Responsibility Attribution

```typescript
interface ResponsibilityAttribution {
  /** The outcome being explained */
  outcome: Observation;

  /** Responsibility scores for candidate nodes */
  responsibilities: Map<NodeId, ResponsibilityScore>;

  /** Ranked list of responsible nodes */
  ranked: NodeId[];

  /** Explanation of the attribution */
  explanation: string;

  /** Confidence */
  confidence: ConfidenceValue;
}

interface ResponsibilityScore {
  /** Actual causation score (but-for test) */
  actualCausation: number;

  /** Sufficient causation score */
  sufficiency: number;

  /** Necessary causation score */
  necessity: number;

  /** Combined responsibility */
  combined: number;
}
```

---

## 4. The Three Rules of Do-Calculus

Pearl's three rules for manipulating causal expressions:

### Rule 1: Insertion/deletion of observations

```
P(Y | do(X), Z, W) = P(Y | do(X), W)  if (Y ⊥ Z | X, W)_G_X̄
```

If Y and Z are d-separated given X and W in the manipulated graph, we can ignore Z.

### Rule 2: Action/observation exchange

```
P(Y | do(X), do(Z), W) = P(Y | do(X), Z, W)  if (Y ⊥ Z | X, W)_G_X̄Z̲
```

We can replace do(Z) with observation Z under certain conditions.

### Rule 3: Insertion/deletion of actions

```
P(Y | do(X), do(Z), W) = P(Y | do(X), W)  if (Y ⊥ Z | X, W)_G_X̄Z(W)̲
```

We can delete do(Z) under certain conditions.

---

## 5. SCM Construction from Code

### 5.1 Construction Algorithm

```
ALGORITHM BuildCodeSCM(codebase):
  1. EXTRACT all entities (functions, classes, modules, types)
     → Create nodes

  2. FOR each entity pair (A, B):
     ANALYZE relationship:
     - A calls B → edge(A, B, direct_call)
     - A uses type from B → edge(A, B, type_inheritance)
     - A reads/writes state B → edge(A, B, shared_state)
     - etc.

  3. FOR each node:
     INFER structural equation:
     - Deterministic: A's output fully determined by code logic
     - Probabilistic: A depends on external factors

  4. IDENTIFY exogenous factors:
     - User input
     - Configuration
     - External APIs
     - Time/environment

  5. VALIDATE DAG structure:
     - Detect and resolve cycles
     - Ensure causal coherence

  RETURN scm
```

### 5.2 Example SCM

```
CodeSCM for a simple cart system:

Nodes:
  - calculateTotal (function)
  - CartItem (type)
  - items (state)
  - formatPrice (function)
  - displayTotal (function)

Edges:
  - items → calculateTotal (data_dependency)
  - CartItem → items (type_inheritance)
  - calculateTotal → formatPrice (direct_call)
  - formatPrice → displayTotal (direct_call)

Equations:
  - calculateTotal = f(items, U_tax) where U_tax ~ config
  - formatPrice = g(amount) deterministic
  - displayTotal = h(formatPrice(calculateTotal(items)))
```

---

## 6. TDD Test Specifications

### 6.1 Tier-0 Tests (Deterministic)

| Test Case | Input | Expected Output |
|-----------|-------|-----------------|
| `scm_construction` | Simple module | Valid SCM graph |
| `intervention_direct` | Change node A | Effects on children of A |
| `intervention_transitive` | Change root node | Effects propagate |
| `counterfactual_basic` | Observation + hypothetical | Valid counterfactual |
| `responsibility_single_cause` | One obvious cause | That cause ranked first |
| `dag_validation` | Graph with cycle | Error thrown |

### 6.2 Tier-1 Tests (Integration)

| Test Case | Scenario | Acceptance Criteria |
|-----------|----------|---------------------|
| `real_codebase_scm` | packages/LiBrainian | Valid SCM constructed |
| `intervention_on_real` | Change real function | Plausible effects |
| `compare_to_transitive` | Same change | Do-calculus more precise |

### 6.3 Tier-2 Tests (Live)

| Test Case | Scenario | Acceptance Criteria |
|-----------|----------|---------------------|
| `predict_breakage` | 50 real changes | 80%+ prediction accuracy |
| `attribution_accuracy` | Known bugs | Cause identified in top 3 |

### 6.4 BDD Scenarios

```gherkin
Feature: Do-Calculus for Code
  As a LiBrainian system
  I want to use causal inference
  So that I can predict what will actually break

  Scenario: Intervention analysis
    Given I have an SCM for the cart module
    And calculateTotal has 10 transitive dependents
    When I intervene do(change calculateTotal signature)
    Then only 3 nodes are predicted to break
    And the prediction includes probabilities
    And the critical path is identified

  Scenario: Counterfactual reasoning
    Given a bug was observed in displayTotal
    And I observe that formatPrice returned "undefined"
    When I ask "what if formatPrice had returned '0'?"
    Then the counterfactual shows displayTotal would succeed
    And responsibility is attributed to formatPrice

  Scenario: Responsibility attribution
    Given a test failure in module X
    And there were 5 recent changes
    When I attribute responsibility
    Then changes are ranked by causal contribution
    And the ranking uses necessity and sufficiency scores
```

---

## 7. Integration Points

| Component | Integration | Direction |
|-----------|-------------|-----------|
| Evidence Ledger | Records causal analyses | Writes |
| Constructive Proofs | Uses causal chains as evidence | Reads |
| Query Engine | Provides causal answers | Reads |
| Defeater Calculus | Causal effects as defeaters | Reads |

---

## 8. Implementation Status

- [ ] Spec complete
- [ ] Tests written (Tier-0)
- [ ] Tests written (Tier-1)
- [ ] Tests written (Tier-2)
- [ ] SCM construction implemented
- [ ] Intervention engine implemented
- [ ] Counterfactual engine implemented
- [ ] Gate passed

---

## Changelog

| Date | Change |
|------|--------|
| 2026-01-23 | Initial specification |
