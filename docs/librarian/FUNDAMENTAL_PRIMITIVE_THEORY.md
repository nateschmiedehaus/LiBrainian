# Fundamental Primitive Theory Investigation

**Status**: Investigation Complete
**Scope**: First-principles analysis of compositional system improvements
**Last Verified**: 2026-01-28
**Owner**: Architecture Review
**Evidence**: Code analysis of src/epistemics/*.ts, src/api/*.ts, state-of-the-art research survey

## Executive Summary

A truly revolutionary primitive/composition system for agentic coding would unite three currently separate concerns: **epistemic honesty** (knowing what you don't know), **resource awareness** (token/time/cost budgets), and **verifiable composition** (proving properties without execution). LiBrainian already has sophisticated foundations in the first area (ConfidenceValue types, defeaters, evidence ledger), but significant opportunities exist in the latter two.

The ideal system would be a **graded monad with effect tracking**, where:
1. Each primitive carries its uncertainty through dependent types that prevent hallucination at compile time
2. Resource consumption (tokens, API calls, wall-clock time) is tracked as a linear resource that cannot be accidentally duplicated or discarded
3. Compositions form a category where morphisms preserve calibration properties, enabling formal proofs about pipeline behavior

This investigation identifies **7 transformative improvements** ranging from low-complexity type refinements to ambitious effect-system integrations. The highest-impact, lowest-risk improvement is **Improvement 1: Typed Formula AST with Proof Terms**, which would enable static verification that confidence propagation rules are mathematically sound.

## Theoretical Analysis

### Type-Theoretic Perspective

#### Current State

LiBrainian's `ConfidenceValue` type is a discriminated union with five variants:

```typescript
type ConfidenceValue =
  | DeterministicConfidence   // 1.0 or 0.0, logically certain
  | DerivedConfidence         // Computed via formula from inputs
  | MeasuredConfidence        // Empirically calibrated from outcomes
  | BoundedConfidence         // Theoretical range [low, high]
  | AbsentConfidence;         // Honest "don't know"
```

This is already more principled than most systems (which use bare floats), but it has limitations:

1. **Formula strings are untyped**: `DerivedConfidence.formula` is a `string`, enabling malformed expressions
2. **No dependent types for bounds**: Nothing prevents `BoundedConfidence` where `low > high` at compile time
3. **Calibration status is optional**: The `calibrationStatus?: 'preserved' | 'degraded' | 'unknown'` field is easily forgotten
4. **No resource tracking**: Compositions don't know their token cost

#### Dependent Types Opportunity

With dependent types (as in Idris, Agda, or the experimental work in TypeScript 5.x template literals), we could express:

```typescript
// Hypothetical dependent-typed confidence
type BoundedConfidence<Low extends number, High extends number> = {
  type: 'bounded';
  low: Low;
  high: High;
  // Proof that Low <= High
  proof: LessThanOrEqual<Low, High>;
};

// Primitives carry proofs of their properties
type VerifiedPrimitive<
  InputType,
  OutputType,
  MaxTokens extends number,
  ExpectedConfidence extends ConfidenceBound
> = {
  execute: (input: InputType) => Promise<WithConfidence<OutputType, ExpectedConfidence>>;
  tokenBudget: TokenBudget<MaxTokens>;
  preconditions: Proof<Preconditions<InputType>>;
  postconditions: (result: OutputType) => Proof<Postconditions<OutputType>>;
};
```

This would enable:
- Compile-time rejection of compositions that could produce invalid confidence values
- Automatic inference of confidence bounds through composition
- Token budget checking before execution

**Reference**: Dependent types for LLM systems are explored in [LLM-Based Code Translation Needs Formal Compositional Reasoning](https://www2.eecs.berkeley.edu/Pubs/TechRpts/2025/EECS-2025-174.pdf) (UC Berkeley EECS TR, 2025).

#### Linear Types for Resource Management

Context windows and API calls are **linear resources** - they can't be duplicated (calling an LLM twice costs twice as much) and shouldn't be silently discarded (unused context is waste).

Rust's ownership model and languages like [Koka](https://koka-lang.github.io/koka/doc/book.html) demonstrate that linear types can be practical. For LiBrainian:

```typescript
// Hypothetical linear token budget type
type TokenBudget<N extends number> = {
  readonly remaining: N;
  // Consuming tokens produces a smaller budget (linear use)
  spend<K extends number>(amount: K): K <= N ? TokenBudget<Subtract<N, K>> : never;
  // Cannot duplicate - attempting to use budget twice is a type error
  readonly [Symbol.dispose]: () => void;
};

// Primitive that consumes budget
type LinearPrimitive<Input, Output, TokenCost extends number> = {
  execute: <B extends number>(
    input: Input,
    budget: TokenBudget<B>
  ) => B >= TokenCost ? [Output, TokenBudget<Subtract<B, TokenCost>>] : never;
};
```

This would prevent:
- Running primitives without sufficient budget
- Accidentally using the same context window twice
- "Leaking" unused budget without explicit acknowledgment

**Reference**: [Linear types for resource management](https://arxiv.org/pdf/1406.2061) (Koka paper, 2014) and recent POPL 2025 work on [Affect: An Affine Type and Effect System](https://iris-project.org/pdfs/2025-popl-affect.pdf).

#### Effect Systems for Side Effect Tracking

Primitives have different "effects" - some are pure computations, some call LLMs, some access the filesystem. An effect system would make these explicit:

```typescript
// Hypothetical effect-typed primitives
type PurePrimitive<I, O> = (input: I) => O;
type LlmPrimitive<I, O> = (input: I) => Eff<LlmCall, O>;
type FilePrimitive<I, O> = (input: I) => Eff<FileRead | FileWrite, O>;
type ComposedPrimitive<I, O, E1, E2> = (input: I) => Eff<E1 | E2, O>;
```

This enables:
- Static analysis of which primitives can fail due to external dependencies
- Automatic retry/fallback handling based on effect types
- Sandboxing primitives that claim to be pure

**Reference**: [Algebraic Effects for Functional Programming](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/08/algeff-tr-2016-v2.pdf) (Microsoft Research, 2016).

### Categorical Perspective

#### The "Agent Monad" Question

The investigation prompt asks: "Is there an 'agent monad'?" The answer is nuanced.

A monad in programming captures a pattern of computation with effects. Common examples:
- `Maybe` for computations that might fail
- `IO` for computations with side effects
- `State` for computations with mutable state
- `Reader` for computations with configuration

For agentic systems, we might want an "Agent" monad that combines:
1. **Uncertainty** (Maybe/Either-like): Computations might not produce useful results
2. **Evidence accumulation** (Writer-like): Computations accumulate epistemic evidence
3. **Context consumption** (State-like): Computations consume and transform context
4. **External effects** (IO-like): Computations call external services

This is a **monad transformer stack**, not a single monad:

```haskell
-- Hypothetical Agent monad
type Agent a = ReaderT AgentConfig
             (StateT EvidenceLedger
             (ExceptT AgentError
             (ResourceT IO))) a
```

LiBrainian's current architecture implicitly does this, but making it explicit enables:
- Cleaner composition (monad laws guarantee associativity)
- Effect isolation (inner layers don't know about outer effects)
- Principled error handling (ExceptT provides short-circuiting)

**Reference**: [Category Theory in Deep Learning](https://medium.com/@sethuiyer/category-theory-in-deep-learning-a-new-lens-for-abstraction-composition-and-the-nature-of-2806963c677f) and the academic survey [Category-Theoretical and Topos-Theoretical Frameworks in Machine Learning](https://www.mdpi.com/2075-1680/14/3/204) (Axioms, March 2025).

#### Confidence as a Semilattice

LiBrainian's confidence combining operations form algebraic structures:

- `min(a, b)` for sequential composition: This is a **meet** operation on confidence values
- `max(a, b)` for OR composition: This is a **join** operation
- `product(a, b)` for independent AND: This is a monoid operation

Together, these form a **bounded semilattice**:
- Bottom element: `absent` (no confidence)
- Top element: `deterministic(1.0)` (certain true)
- Meet: `andConfidence` (minimum)
- Join: `orConfidence` (maximum)

This structure guarantees:
- Associativity: `(a ∧ b) ∧ c = a ∧ (b ∧ c)`
- Commutativity: `a ∧ b = b ∧ a`
- Idempotence: `a ∧ a = a`

These laws are **implicitly assumed** in LiBrainian but not proven. A proper algebraic treatment would:
- Add property-based tests verifying the laws
- Enable algebraic simplification of compositions
- Prove that confidence propagation is well-founded

**Reference**: [Lattice Theory and Formal Concept Analysis](https://www.researchgate.net/publication/249923336_Formal_specification_and_validation_of_multi-agent_behaviour_using_TLA_and_TLC_model_checker) for formal verification of agent systems.

### Formal Methods Perspective

#### TLA+ for Distributed Agent Verification

[TLA+](https://en.wikipedia.org/wiki/TLA+) is used extensively for distributed systems verification at AWS, Azure, and other cloud providers. It could apply to multi-agent LiBrainian scenarios:

```tla
---- MODULE EvidenceChainVerification ----
VARIABLES claims, defeaters, contradictions

TypeInvariant ==
  /\ claims \subseteq Claim
  /\ defeaters \subseteq Defeater
  /\ contradictions \subseteq Contradiction

SafetyProperty ==
  \A c \in contradictions : c.status \in {"unresolved", "investigating", "resolved", "accepted"}

LivenessProperty ==
  \A c \in contradictions : c.status = "unresolved" ~> c.status \in {"resolved", "accepted"}
====
```

Recent work on ["Genefication" - Generative AI + Formal Verification](https://www.mydistributed.systems/2025/01/genefication.html) shows that LLMs can generate TLA+ specifications from code, enabling verification at scale.

**Key Insight**: [The Coming Need for Formal Specification](https://benjamincongdon.me/blog/2025/12/12/The-Coming-Need-for-Formal-Specification/) argues that as AI generates more code, formal specifications become more important for ensuring correctness.

#### Session Types for Agent Communication

[Session types](https://dl.acm.org/doi/abs/10.1145/3586031) provide a type-theoretic approach to verifying communication protocols. For multi-agent LiBrainian scenarios:

```typescript
// Hypothetical session-typed agent communication
type VerificationSession =
  | Send<'claim', ClaimEvidence> & Receive<'ack' | 'reject'>
  | Send<'defeater', DefeaterEvidence> & End;

// The type system ensures protocol compliance
function verifyAgent(session: VerificationSession): Promise<void> {
  // Type error if protocol is violated
  session.send('claim', evidence);
  const response = await session.receive();
  // ...
}
```

This would enable:
- Compile-time verification of agent communication patterns
- Deadlock freedom guarantees
- Automatic protocol composition

**Reference**: [Hybrid Multiparty Session Types](https://dl.acm.org/doi/abs/10.1145/3586031) (POPL 2023) and the [Agent Communication Protocols Landscape](https://generativeprogrammer.com/p/agent-communication-protocols-landscape).

## State-of-the-Art Analysis

### What DSPy Gets Right (and Wrong)

[DSPy](https://dspy.ai/) (Stanford NLP, 2022-present) pioneered **signature-based programming** for LLMs:

**What DSPy Gets Right**:
1. **Declarative signatures**: `question -> answer` abstracts away prompt engineering
2. **Automatic optimization**: SIMBA, GEPA, and BootstrapFinetune find good prompts algorithmically
3. **Composable modules**: Modules can be nested and combined
4. **Separating what from how**: Signatures specify intent, optimizers handle implementation

**What DSPy Gets Wrong** (from LiBrainian's perspective):
1. **No epistemic tracking**: DSPy doesn't distinguish calibrated from uncalibrated outputs
2. **No defeater awareness**: DSPy can't express "this answer might be wrong because..."
3. **Opaque optimization**: The optimizer's choices aren't auditable
4. **No formal composition laws**: Composing modules doesn't guarantee any properties

**LiBrainian's Advantage**: The evidence ledger and defeater system provide auditability that DSPy lacks. The opportunity is to add DSPy-style optimization while preserving epistemic honesty.

**Reference**: [DSPy: Compiling Declarative Language Model Calls into State-of-the-Art Pipelines](https://hai.stanford.edu/research/dspy-compiling-declarative-language-model-calls-into-state-of-the-art-pipelines) (Stanford HAI).

### What's Missing in Current Agent Frameworks

Analyzing [LangGraph](https://latenode.com/blog/ai-frameworks-technical-infrastructure/langgraph-multi-agent-orchestration/langgraph-multi-agent-orchestration-complete-framework-guide-architecture-analysis-2025), [AutoGen](https://research.aimultiple.com/agentic-orchestration/), [CrewAI](https://www.getmaxim.ai/articles/top-5-ai-agent-frameworks-in-2025-a-practical-guide-for-ai-builders/), and others:

| Gap | Description | LiBrainian Status |
|-----|-------------|------------------|
| **Uncertainty Propagation** | How does confidence flow through agent graphs? | Partial (D2-D4 rules) |
| **Calibration Tracking** | Are output confidences empirically calibrated? | Good (MeasuredConfidence) |
| **Contradiction Detection** | How are conflicting outputs handled? | Excellent (Contradiction type) |
| **Budget Awareness** | Can agents respect token/cost limits? | Missing |
| **Formal Verification** | Can we prove composition properties? | Missing |
| **Learning Integration** | Do agents improve from outcomes? | Good (LearningLoop) |
| **Deterministic Replay** | Can we reproduce agent sessions? | Good (ReplaySession) |

**Key Gap**: No current framework provides **static verification of agent compositions**. You can't prove that a composition never hallucinates without running it.

### Academic Research Frontiers

Papers and ideas not yet productionized:

1. **Conformal Prediction for LLM Uncertainty** (ICML 2024-2025 workshops): Using conformal inference to provide distribution-free uncertainty bounds on LLM outputs. Could replace/augment calibration curves.

2. **Neurosymbolic Verification** (AAAI 2025): Combining neural networks with symbolic reasoning to verify LLM outputs against formal specifications.

3. **Proof-Carrying Code for AI** (emerging 2025): Extending proof-carrying code to AI systems where the "proof" is an evidence chain.

4. **Compositional Semantics for Agents** (FoSSaCS 2025 workshop): Applying denotational semantics to define what agent compositions "mean" mathematically.

5. **Resource-Aware Type Theory** (POPL 2025): Types that track resource usage (tokens, memory, time) through computation.

## Proposed Improvements

### Improvement 1: Typed Formula AST with Proof Terms

**Current State**:
`DerivedConfidence.formula` is a string like `"min(steps)"`. The optional `formulaAst?: FormulaNode` provides structure but isn't required.

**Theoretical Basis**:
Typed ASTs with proof terms (from dependent type theory) can carry evidence of their well-formedness. This prevents malformed formulas and enables automatic verification.

**Proposed Change**:
1. Make `formulaAst` required, not optional
2. Add type-level constraints ensuring formulas reference actual inputs
3. Add proof terms showing formula validity

```typescript
// Enhanced FormulaNode with proof terms
type ProvenFormula = {
  ast: FormulaNode;
  // Names of all inputs used (verified to match actual inputs)
  inputNames: readonly string[];
  // Proof that all input references are valid
  inputValidity: InputValidityProof;
  // Proof that the formula is well-typed
  typeProof: FormulaTypeProof;
};

// DerivedConfidence with proven formula
interface ProvenDerivedConfidence {
  readonly type: 'derived';
  readonly value: number;
  readonly formula: ProvenFormula;
  readonly inputs: ReadonlyArray<{ name: string; confidence: ConfidenceValue }>;
  readonly calibrationStatus: CalibrationStatus; // Required, not optional
}
```

**Expected Impact**:
- **Game-changing** for reliability: Eliminates an entire class of runtime errors
- Enables static analysis of confidence propagation
- Foundation for formal verification of compositions

**Implementation Complexity**: Low-Medium
- Modify existing FormulaNode types
- Add validation at construction time
- Update all DerivedConfidence creation sites

### Improvement 2: Linear Resource Tracking for Token Budgets

**Current State**:
`ExecutionBudget` has `tokensRemaining: number` but this isn't enforced. Primitives can exceed budgets without compile-time detection.

**Theoretical Basis**:
Linear types (from linear logic) ensure resources are used exactly once. This prevents both resource leaks and double-use.

**Proposed Change**:
Create a resource-aware execution context:

```typescript
// Branded type for token budget that can't be accidentally copied
type TokenBudget = number & { readonly __brand: 'TokenBudget'; readonly __linear: unique symbol };

interface LinearExecutionContext {
  // Consuming tokens returns a new context (linear use)
  consumeTokens(amount: number): [TokenBudget, LinearExecutionContext] | BudgetExceededError;

  // Getting remaining budget is read-only
  readonly remaining: TokenBudget;

  // Must be explicitly disposed
  [Symbol.dispose](): void;
}

// Primitive that declares its cost
interface BudgetAwarePrimitive<I, O> {
  readonly estimatedTokens: number;
  readonly maxTokens: number;
  execute(input: I, budget: LinearExecutionContext): Promise<[O, LinearExecutionContext]>;
}
```

**Expected Impact**:
- **Transformative** for cost control: Prevents runaway token usage
- Enables automatic budget allocation across compositions
- Foundation for "fit to context window" guarantees

**Implementation Complexity**: Medium
- New LinearExecutionContext implementation
- Modify all primitive execution signatures
- Add budget estimation to all primitives

### Improvement 3: Effect Tracking for Primitive Side Effects

**Current State**:
Primitives have side effects (LLM calls, file access, network) but these aren't typed. You can't tell from a primitive's type what effects it might have.

**Theoretical Basis**:
Algebraic effect systems (Koka, Frank, Eff) make effects explicit in types, enabling effect-based dispatch and sandboxing.

**Proposed Change**:
Add effect annotations to primitives:

```typescript
// Effect markers
type LlmEffect = { readonly _tag: 'llm'; readonly provider?: string };
type FileEffect = { readonly _tag: 'file'; readonly mode: 'read' | 'write' };
type NetworkEffect = { readonly _tag: 'network'; readonly urls?: string[] };
type PureEffect = { readonly _tag: 'pure' };

type Effect = LlmEffect | FileEffect | NetworkEffect | PureEffect;

// Primitive with explicit effects
interface EffectfulPrimitive<I, O, E extends Effect> {
  readonly effects: readonly E[];
  execute(input: I): Promise<O>;
}

// Composition tracks combined effects
type ComposedEffects<E1 extends Effect, E2 extends Effect> = E1 | E2;
```

**Expected Impact**:
- **Significant** for safety: Know exactly what a composition can do
- Enables sandboxing (run only pure primitives)
- Enables automatic retry strategies (retry LlmEffect, not FileEffect)

**Implementation Complexity**: Medium
- Add effect annotations to all primitives
- Modify composition builder to track effects
- Add effect-based execution strategies

### Improvement 4: Session Types for Multi-Agent Communication

**Current State**:
Multi-agent scenarios in LiBrainian use ad-hoc message passing. There's no protocol verification.

**Theoretical Basis**:
Session types encode communication protocols in types, providing deadlock freedom and protocol compliance guarantees at compile time.

**Proposed Change**:
Define typed agent communication protocols:

```typescript
// Protocol for verification between agents
type VerificationProtocol =
  | { phase: 'claim_submission'; next: 'awaiting_review' }
  | { phase: 'awaiting_review'; next: 'reviewing' | 'timeout' }
  | { phase: 'reviewing'; next: 'accepted' | 'rejected' | 'needs_evidence' }
  | { phase: 'needs_evidence'; next: 'awaiting_review' }
  | { phase: 'accepted' | 'rejected' | 'timeout'; next: never };

// Type-safe channel for protocol
interface ProtocolChannel<P> {
  send<Phase extends P['phase']>(
    message: Extract<P, { phase: Phase }>
  ): ProtocolChannel<Extract<P, { next: P['next'] }>>;

  receive(): Promise<P>;
}
```

**Expected Impact**:
- **Game-changing** for multi-agent: Compile-time protocol verification
- Deadlock freedom guarantees
- Automatic protocol composition and optimization

**Implementation Complexity**: High
- New session type library
- Redesign multi-agent communication
- Integration with existing operator system

### Improvement 5: Calibration-Preserving Composition Laws

**Current State**:
`calibrationStatus` tracks whether derivation preserves calibration, but this is computed ad-hoc. There's no formal treatment of when compositions preserve calibration.

**Theoretical Basis**:
In category theory, functors preserve structure. A "calibration-preserving functor" would be a composition operation that preserves calibration properties.

**Proposed Change**:
Define formal calibration preservation rules:

```typescript
// Calibration categories
type CalibrationCategory = 'measured' | 'derived_from_measured' | 'bounded' | 'uncalibrated';

// Laws for calibration preservation
const CALIBRATION_PRESERVATION_LAWS = {
  // min preserves calibration if all inputs are calibrated
  min: (inputs: CalibrationCategory[]): CalibrationCategory =>
    inputs.every(i => i === 'measured') ? 'derived_from_measured' : 'uncalibrated',

  // product may degrade calibration (independence assumption)
  product: (inputs: CalibrationCategory[]): CalibrationCategory =>
    inputs.every(i => i === 'measured') ? 'bounded' : 'uncalibrated',

  // max preserves calibration
  max: (inputs: CalibrationCategory[]): CalibrationCategory =>
    inputs.every(i => i === 'measured') ? 'derived_from_measured' : 'uncalibrated',
};

// Verify calibration at composition time
function verifyCalibrationPreservation(
  formula: FormulaNode,
  inputCalibrations: Map<string, CalibrationCategory>
): CalibrationVerificationResult {
  // Statically verify that composition preserves calibration
}
```

**Expected Impact**:
- **Significant** for correctness: Know exactly when calibration is preserved
- Foundation for calibration-aware optimization
- Enables automatic calibration warnings

**Implementation Complexity**: Low-Medium
- Formalize existing calibration rules
- Add verification at composition construction
- Property-based tests for calibration laws

### Improvement 6: Verifiable Pre/Post Conditions with SMT Solving

**Current State**:
`PrimitiveContract` has preconditions and postconditions, but verification is runtime-only.

**Theoretical Basis**:
SMT (Satisfiability Modulo Theories) solvers like Z3 can verify logical conditions at compile time. LiquidHaskell demonstrates this for refinement types.

**Proposed Change**:
Add SMT-verifiable conditions:

```typescript
// SMT-compatible condition language
type SMTCondition =
  | { type: 'comparison'; op: '<' | '>' | '<=' | '>=' | '='; left: SMTExpr; right: SMTExpr }
  | { type: 'and'; conditions: SMTCondition[] }
  | { type: 'or'; conditions: SMTCondition[] }
  | { type: 'not'; condition: SMTCondition }
  | { type: 'forall'; variable: string; domain: SMTDomain; body: SMTCondition };

interface VerifiableContract<I, O> {
  preconditions: SMTCondition[];
  postconditions: (input: SMTExpr) => SMTCondition[];

  // Static verification (compile time)
  verify(): SMTVerificationResult;

  // Runtime check (fallback)
  checkAtRuntime(input: I, output: O): boolean;
}
```

**Expected Impact**:
- **Transformative** for correctness: Prove properties without execution
- Catch errors at development time, not runtime
- Enable "proof-carrying primitives"

**Implementation Complexity**: High
- Integrate Z3 or similar SMT solver
- Define SMT-compatible condition language
- Translate contracts to SMT problems

### Improvement 7: DSPy-Style Optimization with Epistemic Constraints

**Current State**:
LiBrainian has `LearningLoop` for outcome-based improvement, but no automatic prompt optimization.

**Theoretical Basis**:
DSPy's optimizers (SIMBA, GEPA, BootstrapFinetune) automatically find good prompts. We can extend this with epistemic constraints.

**Proposed Change**:
Add constrained optimization:

```typescript
interface EpistemicOptimizer {
  // Optimize subject to epistemic constraints
  optimize(
    composition: TechniqueComposition,
    trainingData: OutcomeSample[],
    constraints: EpistemicConstraints
  ): Promise<OptimizedComposition>;
}

interface EpistemicConstraints {
  // Minimum calibration quality
  minCalibrationECE?: number;

  // Maximum overconfidence ratio
  maxOverconfidence?: number;

  // Required defeater detection rate
  minDefeaterRecall?: number;

  // Maximum hallucination rate
  maxHallucinationRate?: number;
}

interface OptimizedComposition {
  composition: TechniqueComposition;

  // Proof that constraints are satisfied
  constraintProofs: Map<string, ConstraintProof>;

  // Expected performance metrics
  expectedMetrics: EpistemicMetrics;
}
```

**Expected Impact**:
- **Game-changing** for usability: Automatic improvement with guarantees
- Combines DSPy's power with LiBrainian's epistemic rigor
- Enables "optimize but stay honest"

**Implementation Complexity**: High
- Significant research required
- Integration with existing learning loop
- Formal constraint verification

## Recommendations

### Tier 1: Foundational Improvements (Must Do)

These improvements would transform the system's reliability and are relatively low-risk:

| Priority | Improvement | Est. Effort | ROI |
|----------|-------------|-------------|-----|
| 1 | **Typed Formula AST with Proof Terms** | 2-3 weeks | Extreme |
| 2 | **Calibration-Preserving Composition Laws** | 1-2 weeks | Very High |

**Rationale**: These improvements harden existing infrastructure without requiring architectural changes. They prevent entire classes of bugs and enable future verification work.

### Tier 2: Significant Improvements (Should Do)

These improvements provide substantial benefits but require more investment:

| Priority | Improvement | Est. Effort | ROI |
|----------|-------------|-------------|-----|
| 3 | **Linear Resource Tracking for Token Budgets** | 3-4 weeks | High |
| 4 | **Effect Tracking for Primitive Side Effects** | 3-4 weeks | High |

**Rationale**: Resource and effect awareness are increasingly important as agent systems scale. These improvements position LiBrainian for production use cases with strict cost and security requirements.

### Tier 3: Nice-to-Haves (Could Do)

These improvements are ambitious and high-reward but also high-effort:

| Priority | Improvement | Est. Effort | ROI |
|----------|-------------|-------------|-----|
| 5 | **Session Types for Multi-Agent Communication** | 6-8 weeks | Medium-High |
| 6 | **Verifiable Pre/Post Conditions with SMT Solving** | 8-12 weeks | High |
| 7 | **DSPy-Style Optimization with Epistemic Constraints** | 12+ weeks | Very High |

**Rationale**: These are research-grade improvements that could differentiate LiBrainian significantly but require substantial investment. Consider as longer-term roadmap items.

## Proposed Work Units

| WU ID | Name | Description | Tier | Dependencies | Est. Effort |
|-------|------|-------------|------|--------------|-------------|
| WU-THEORY-001 | Proven Formula AST | Make formulaAst required; add input validity proofs; add type proofs | 1 | None | 2 weeks |
| WU-THEORY-002 | Formula AST Migration | Update all DerivedConfidence creation sites to use proven formulas | 1 | WU-THEORY-001 | 1 week |
| WU-THEORY-003 | Calibration Laws | Formalize calibration preservation rules; add verification | 1 | None | 1 week |
| WU-THEORY-004 | Calibration Property Tests | Property-based tests for algebraic laws | 1 | WU-THEORY-003 | 1 week |
| WU-THEORY-005 | Linear Execution Context | Implement LinearExecutionContext with token tracking | 2 | None | 2 weeks |
| WU-THEORY-006 | Budget-Aware Primitives | Add token estimation to all primitives; enforce budgets | 2 | WU-THEORY-005 | 2 weeks |
| WU-THEORY-007 | Effect Type Annotations | Add effect markers to all primitives | 2 | None | 2 weeks |
| WU-THEORY-008 | Effect-Based Execution | Modify execution engine for effect-aware dispatch | 2 | WU-THEORY-007 | 2 weeks |
| WU-THEORY-009 | Session Type Library | Implement session type primitives for agent communication | 3 | None | 4 weeks |
| WU-THEORY-010 | Protocol Verification | Compile-time protocol checking for agent interactions | 3 | WU-THEORY-009 | 4 weeks |
| WU-THEORY-011 | SMT Condition Language | Define SMT-compatible condition language | 3 | None | 3 weeks |
| WU-THEORY-012 | Z3 Integration | Integrate Z3 solver for contract verification | 3 | WU-THEORY-011 | 5 weeks |
| WU-THEORY-013 | Epistemic Optimizer Design | Design constrained optimization framework | 3 | None | 4 weeks |
| WU-THEORY-014 | Optimizer Implementation | Implement epistemic-constrained optimization | 3 | WU-THEORY-013 | 8 weeks |

## Conclusion

LiBrainian already has a more principled epistemic foundation than any other agent framework surveyed. The `ConfidenceValue` type system, evidence ledger, and defeater mechanisms represent genuine innovations in agentic reliability.

The proposed improvements build on this foundation to address the remaining gaps:

1. **Static Verification**: Proving properties about compositions without running them
2. **Resource Awareness**: Tracking and enforcing token/cost budgets
3. **Effect Tracking**: Making primitive side effects explicit and controllable
4. **Formal Composition**: Mathematical guarantees about confidence propagation

The recommended path is:
1. **Immediate**: WU-THEORY-001 through WU-THEORY-004 (proven formulas and calibration laws)
2. **Near-term**: WU-THEORY-005 through WU-THEORY-008 (resource and effect tracking)
3. **Longer-term**: WU-THEORY-009 through WU-THEORY-014 (session types, SMT verification, optimization)

These improvements would make LiBrainian the first agentic coding system with **formal correctness guarantees** - a significant competitive advantage as the field matures.

---

## References

### Programming Language Theory
- [DSPy: The framework for programming language models](https://dspy.ai/)
- [The Koka Programming Language](https://koka-lang.github.io/koka/doc/book.html)
- [Affect: An Affine Type and Effect System (POPL 2025)](https://iris-project.org/pdfs/2025-popl-affect.pdf)
- [LiquidHaskell: Refinement Types for Haskell](https://ucsd-progsys.github.io/liquidhaskell-tutorial/book.pdf)

### Category Theory and Machine Learning
- [Category-Theoretical and Topos-Theoretical Frameworks in Machine Learning (Axioms, 2025)](https://www.mdpi.com/2075-1680/14/3/204)
- [Category Theory in Deep Learning](https://medium.com/@sethuiyer/category-theory-in-deep-learning-a-new-lens-for-abstraction-composition-and-the-nature-of-2806963c677f)

### Formal Verification
- [Genefication: Generative AI + Formal Verification](https://www.mydistributed.systems/2025/01/genefication.html)
- [The Coming Need for Formal Specification](https://benjamincongdon.me/blog/2025/12/12/The-Coming-Need-for-Formal-Specification/)
- [Towards Language Model Guided TLA+ Proof Automation](https://www.arxiv.org/pdf/2512.09758)

### Agent Frameworks
- [LangGraph Multi-Agent Orchestration Guide 2025](https://latenode.com/blog/ai-frameworks-technical-infrastructure/langgraph-multi-agent-orchestration/langgraph-multi-agent-orchestration-complete-framework-guide-architecture-analysis-2025)
- [The AI Agent Framework Landscape in 2025](https://medium.com/@hieutrantrung.it/the-ai-agent-framework-landscape-in-2025-what-changed-and-what-matters-3cd9b07ef2c3)
- [Agent Communication Protocols Landscape](https://generativeprogrammer.com/p/agent-communication-protocols-landscape)

### Session Types and Protocol Verification
- [Hybrid Multiparty Session Types (POPL 2023)](https://dl.acm.org/doi/abs/10.1145/3586031)
- [LLM-Based Code Translation Needs Formal Compositional Reasoning](https://www2.eecs.berkeley.edu/Pubs/TechRpts/2025/EECS-2025-174.pdf)
