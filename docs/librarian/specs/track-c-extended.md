# Track C Extended Features (P11-P18)

> **Extracted from**: `docs/LiBrainian/THEORETICAL_CRITIQUE.md`
> **Source Parts**: Part IX (Subsystem-Level Problems), Part XVII (Twenty Greats' Implementation Items), Part XVIII (Theoretical Breakthroughs and Epistemic Bootstrapping)
>
> **Theory References**:
> - P13 (Prediction Memory) relates to [Critical Problem B, B.1](./critical-usability.md#critical-problem-b-no-learning-loop-closure) (learning loop, prediction-oriented memory)
> - P11-P12 relates to [Subsystem Problems 24-25](./subsystem-problems.md#storage-subsystem) (storage interface, transactions)
> - Use cases supported: UC 11 (Test Gaps), UC 15 (Tech Debt) - see [use-case-targets.md](./use-case-targets.md)

> **Operational status**: `research_only` (reference material). Do not treat any “Implemented” labels inside as verified behavior; see `docs/LiBrainian/specs/BEHAVIOR_INDEX.md` and `docs/LiBrainian/specs/IMPLEMENTATION_STATUS.md`.

This document contains the complete specifications for Track C Extended Features, representing advanced theoretical capabilities that push the boundaries of what a code understanding system can achieve.

---

## Table of Contents

1. [P11: Storage Interface Split](#p11-storage-interface-split)
2. [P12: Transaction Boundaries](#p12-transaction-boundaries)
3. [P13: Prediction-Oriented Memory](#p13-prediction-oriented-memory)
4. [P14: Self-Aware Oracle](#p14-self-aware-oracle)
5. [P15: Proof-Carrying Context](#p15-proof-carrying-context)
6. [P16: Causal Discovery](#p16-causal-discovery)
7. [P17: Bi-Temporal Knowledge](#p17-bi-temporal-knowledge)
8. [P18: Metacognitive Architecture](#p18-metacognitive-architecture)
9. [Dependencies Between Features](#dependencies-between-features)
10. [Implementation Status](#implementation-status)

---

## P11: Storage Interface Split

**Source**: Part IX (Problem 24)

### Theoretical Foundation

The storage layer serves as the epistemological foundation of LiBrainian - all knowledge, embeddings, relationships, and metrics flow through it. A monolithic interface creates several fundamental problems:

1. **Cognitive Overload**: 200+ methods make the interface incomprehensible
2. **Testing Impedance**: Mocking requires implementing all methods even when testing narrow functionality
3. **Backend Lock-in**: Implementing new storage backends (e.g., PostgreSQL, distributed storage) requires implementing ALL methods
4. **Responsibility Diffusion**: No clear boundaries between knowledge types

### Problem Statement

`LibrarianStorage` interface has 200+ methods covering:
- Knowledge CRUD (functions, modules, files)
- Embedding storage and retrieval
- Graph metrics and relationships
- Episode and verification plan management
- Confidence and calibration tracking

This makes:
- Mocking for tests extremely difficult
- Understanding the interface overwhelming
- Implementing new storage backends prohibitive

### Technical Specification

Split into **focused sub-interfaces**:

```typescript
interface LibrarianStorage {
  knowledge: KnowledgeStorage;
  embeddings: EmbeddingStorage;
  graph: GraphStorage;
  episodes: EpisodeStorage;
  confidence: ConfidenceStorage;
  cache: CacheStorage;
}

interface KnowledgeStorage {
  // ~30 methods for functions, modules, files, directories
  getFunction(id: string): Promise<FunctionKnowledge | null>;
  upsertFunction(fn: FunctionKnowledge): Promise<void>;
  // ...
}

interface EmbeddingStorage {
  // ~15 methods for vectors
  getEmbedding(id: string): Promise<Float32Array | null>;
  upsertEmbedding(id: string, vector: Float32Array): Promise<void>;
  similaritySearch(query: Float32Array, limit: number): Promise<SimilarityResult[]>;
  // ...
}

interface GraphStorage {
  // ~20 methods for relationships
  getEdges(nodeId: string, type?: EdgeType): Promise<GraphEdge[]>;
  getMetrics(nodeId: string): Promise<GraphMetrics | null>;
  // ...
}
```

### Interface Definitions

The `StorageSlices` interface provides access to focused storage slices:

```typescript
export interface StorageSlices {
  knowledge: KnowledgeStorage;
  embeddings: EmbeddingStorage;
  graph: GraphStorage;
  episodes: EpisodeStorage;
  confidence: ConfidenceStorage;
  cache: CacheStorage;
}

export function createStorageSlices(storage: LibrarianStorage): StorageSlices;
```

### Propagating Impact

Split interfaces enable:
- **Focused mocking**: Mock only what test needs
- **Pluggable backends**: Different storage for embeddings vs knowledge
- **Clear responsibility boundaries**: Each slice owns its domain
- **Easier documentation**: Per sub-interface docs are digestible

### Implementation Status

- **Status**: Implemented
- **API Surface**: `StorageSlices`, `createStorageSlices`, `LiBrainian.getStorageSlices()`
- **Next Steps**: Expand slice-first adoption across storage consumers

### Estimated LOC

~200 lines

---

## P12: Transaction Boundaries

**Source**: Part IX (Problem 25)

### Theoretical Foundation

Epistemological consistency requires that knowledge updates be atomic. When indexing a function, we must update:
1. The function knowledge record
2. Its embedding vector
3. Graph edges to other entities
4. Confidence scores

If any step fails, we have inconsistent knowledge - the system believes things that contradict each other.

### Problem Statement

Multi-step operations (e.g., bootstrap phase) don't have transaction semantics:
- If phase fails midway, partial data persists
- No rollback mechanism
- Data consistency not guaranteed

### Technical Specification

Implement **storage transactions**:

```typescript
interface TransactionalStorage {
  /** Begin a transaction */
  beginTransaction(): Promise<Transaction>;

  /** Execute within transaction */
  withinTransaction<T>(
    fn: (tx: Transaction) => Promise<T>
  ): Promise<T>;
}

interface Transaction {
  /** Commit all changes */
  commit(): Promise<void>;

  /** Rollback all changes */
  rollback(): Promise<void>;

  /** Storage operations within this transaction */
  knowledge: KnowledgeStorage;
  embeddings: EmbeddingStorage;
  // ...
}

// Usage
await storage.withinTransaction(async (tx) => {
  await tx.knowledge.upsertFunction(fn1);
  await tx.knowledge.upsertFunction(fn2);
  await tx.embeddings.upsertEmbedding(fn1.id, embedding1);
  // All or nothing
});
```

### Concurrency Contract (Essential)

Multi-agent environments require explicit isolation guarantees:

```typescript
/**
 * Concurrency contract for multi-agent access.
 * - Reads: snapshot isolation (readers see consistent point-in-time view)
 * - Writes: serializable within transaction scope
 * - Cross-transaction: last-writer-wins with conflict detection
 */
interface ConcurrencyContract {
  /** Isolation level for reads */
  readIsolation: 'snapshot' | 'read_committed';

  /** Conflict detection strategy */
  conflictDetection: 'optimistic' | 'pessimistic';

  /** What happens on conflict */
  onConflict: 'retry' | 'fail' | 'merge';

  /** Maximum retries for optimistic conflicts */
  maxRetries: number;
}

const DEFAULT_CONCURRENCY: ConcurrencyContract = {
  readIsolation: 'snapshot',
  conflictDetection: 'optimistic',
  onConflict: 'retry',
  maxRetries: 3,
};
```

### Propagating Impact

Transactions enable:
- **Atomic multi-step operations**: All or nothing semantics
- **Safe recovery from failures**: Rollback incomplete work
- **Consistent snapshots for queries**: Read your own writes
- **Simpler error handling**: Just rollback on any failure

### Implementation Status

- **Status**: Implemented (partial)
- **API Surface**: `transaction()` + `withinTransaction()` helpers
- **Current Coverage**: Bootstrap file/directory/assessment batches now wrapped
- **Next Steps**: Inventory remaining multi-step flows (bootstrap ingest, graph writes) and ensure transactional wrapping

### Estimated LOC

~150 lines

---

## P13: Prediction-Oriented Memory

**Source**: Part XVII Section G (McCarthy/Minsky)

> **LiBrainian Story**: Chapter 7 (The Completion) - This closes the learning loop.
>
> **Critical Problems**: This addresses [Critical Problem B](./critical-usability.md#critical-problem-b-no-learning-loop-closure) and [B.1](./critical-usability.md#critical-problem-b1-memory-not-prediction-oriented)

### KNOWN IMPLEMENTATION ISSUES

| Issue | Severity | File | Status |
|-------|----------|------|--------|
| **ClosedLoopLearner exists** | ✅ Done | `learning_loop.ts` | Core implementation complete |
| **Prediction-weighted retrieval** | ✅ Done | `learning_loop.ts` | Works |
| **Evidence refresh** | ❌ Missing | - | B.1 not fully addressed |
| **Selector not wired** | ⚠️ Unverified | - | Learning may not affect selection |
| **No generative learning** | MEDIUM | - | Doesn't propose new compositions |

**To fix**: Wire `ClosedLoopLearner` to `composition_selector.ts` so past outcomes influence selection.

### Theoretical Foundation

**McCarthy/Minsky's Insight**: Knowledge should be executable - able to inform future decisions. The system should not just record what happened, but predict what will happen based on learned patterns.

### Problem Statement

The `ClosedLoopLearner` records outcomes but doesn't use them for prediction. The system cannot answer "based on past experience, will this work?"

### Technical Specification

#### Predictive Memory Interface

```typescript
/**
 * Memory that predicts outcomes based on learned patterns.
 *
 * Key insight: Store not just outcomes, but the CONDITIONS that led to outcomes.
 */

export interface PredictiveMemory {
  /**
   * Record an outcome with its context.
   */
  recordOutcome(outcome: {
    taskDescription: string;
    techniqueUsed: string;
    context: TaskContext;
    result: 'success' | 'failure' | 'partial';
    failureReason?: string;
    duration: number;
  }): Promise<void>;

  /**
   * Predict outcome for a new task based on similar past tasks.
   */
  predictOutcome(task: {
    description: string;
    technique: string;
    context: TaskContext;
  }): Promise<OutcomePrediction>;

  /**
   * Get advice based on past failures.
   */
  getFailureAdvice(task: {
    description: string;
    technique: string;
  }): Promise<FailureAdvice[]>;
}

export interface OutcomePrediction {
  predictedOutcome: 'success' | 'failure' | 'uncertain';
  confidence: number;
  similarTasks: number;  // How many similar tasks inform this prediction
  riskFactors: string[];  // Conditions that correlated with failure
  successFactors: string[];  // Conditions that correlated with success
}

export interface FailureAdvice {
  condition: string;  // What condition led to past failures
  frequency: number;  // How often this caused failure
  suggestion: string;  // How to avoid
}
```

### Implementation Roadmap

| Phase | Deliverable | Est. LOC |
|-------|-------------|----------|
| **1** | Memory interface | ~100 |
| **2** | Context embedding for similarity | ~150 |
| **3** | Outcome prediction | ~200 |
| **4** | Failure pattern extraction | ~150 |
| **5** | Integration with ClosedLoopLearner | ~100 |
| **6** | Tests | ~200 |

### Files

**Files to modify:**
- `src/LiBrainian/api/learning_loop.ts` (add predictive memory)

**Files to create:**
- `src/LiBrainian/api/predictive_memory.ts`

### Implementation Status

- **Status**: Implemented (learning loop + selector wiring)
- **API Surface**: `ClosedLoopLearner` with outcome recording, prediction-weighted retrieval, consolidation/tiering, shift detection
- **Next Steps**: Refresh evidence for prediction-oriented memory

### Estimated LOC

~200 lines

---

## P14: Self-Aware Oracle

**Source**: Part XVIII Section I (Turing)

### Theoretical Foundation

**Turing's Breakthrough**: A formal undecidability classifier for code questions.

**What Doesn't Exist**: No current system can formally reason about its own reasoning limitations. Systems say "I don't know" but cannot explain *why* they fundamentally cannot know, or what would be required to know.

**Key Insight**: Knowing WHY you don't know is often more valuable than a wrong answer.

### Technical Specification

```typescript
/**
 * THE SELF-AWARE ORACLE
 *
 * For any question Q about code C, classify into one of:
 * 1. DECIDABLE: Can compute the answer with certainty
 * 2. ORACLE_DEPENDENT: Requires LLM reasoning (uncertain but possible)
 * 3. FORMALLY_UNDECIDABLE: Provably cannot be answered by any system
 * 4. PRACTICALLY_UNDECIDABLE: Theoretically possible but resource-prohibitive
 *
 * Key insight: Knowing WHY you don't know is often more valuable than a wrong answer.
 */

export interface UndecidabilityClassification {
  question: string;
  classification: 'decidable' | 'oracle_dependent' | 'formally_undecidable' | 'practically_undecidable';

  /** For decidable: the algorithm that computes the answer */
  algorithm?: string;

  /** For oracle_dependent: what the LLM must reason about */
  oracleRequirements?: string[];

  /** For formally_undecidable: the reduction to a known undecidable problem */
  reduction?: {
    targetProblem: 'halting' | 'rice_theorem' | 'post_correspondence' | 'other';
    proofSketch: string;
  };

  /** For practically_undecidable: the resource requirements */
  resourceBounds?: {
    timeComplexity: string;
    spaceComplexity: string;
    estimatedForThisCodebase: string;
  };

  /** What WOULD make this question answerable */
  enablingConditions?: string[];
}
```

### Oracle Classifier Implementation

```typescript
/**
 * The breakthrough: LiBrainian can explain its own limitations.
 *
 * Example:
 *   Q: "Will this function terminate on all inputs?"
 *   A: {
 *     classification: 'formally_undecidable',
 *     reduction: {
 *       targetProblem: 'halting',
 *       proofSketch: 'This function contains a while loop with data-dependent termination...'
 *     },
 *     enablingConditions: [
 *       'Restrict to bounded loops only',
 *       'Provide loop invariant annotations',
 *       'Limit input domain to finite sets'
 *     ]
 *   }
 */
export class TuringOracleClassifier {
  /**
   * Classify a question about code into decidability categories.
   * Uses pattern matching against known undecidable problem classes.
   */
  classify(question: string, codeContext: Entity[]): Promise<UndecidabilityClassification>;

  /**
   * For oracle-dependent questions, estimate uncertainty bounds.
   * Uses calibrated confidence intervals, not point estimates.
   */
  estimateOracleUncertainty(question: string): Promise<{
    confidenceInterval: [number, number];
    calibrationBasis: string;
  }>;
}
```

### Why This Is Breakthrough

No existing system reasons about its own computability limits. This is the first system that could say "I cannot answer this question, and here's a formal proof why, and here's what would need to change to make it answerable."

### Implementation Status

- **Status**: Implemented (heuristic classifier)
- **Next Steps**: Evidence refresh pending

### Estimated LOC

~400-500 LOC + pattern database for undecidable problem reductions

---

## P15: Proof-Carrying Context

**Source**: Part XVIII Section II (Dijkstra/Hoare)

### Theoretical Foundation

**What Doesn't Exist**: Current retrieval returns "relevant" context with similarity scores. No system proves that retrieved context is logically necessary and sufficient for the query.

**The Breakthrough**: Every retrieved entity comes with a machine-checkable proof of its relevance.

### Technical Specification

```typescript
/**
 * PROOF-CARRYING CONTEXT
 *
 * Instead of "this context has 0.85 relevance", provide:
 * "This context is logically required because [formal derivation]"
 *
 * Uses deductive reasoning, not just embedding similarity.
 */

export interface ProofCarryingContext {
  entity: Entity;

  /** Machine-checkable proof of relevance */
  relevanceProof: RelevanceProof;

  /** If proof cannot be constructed, explain why */
  proofFailure?: ProofFailure;
}

export interface RelevanceProof {
  /** The proof format (natural deduction, sequent calculus, etc.) */
  format: 'natural_deduction' | 'sequent' | 'resolution' | 'informal';

  /** The proof steps */
  steps: ProofStep[];

  /** The conclusion: "Therefore, entity E is relevant to query Q" */
  conclusion: string;

  /** Verification status */
  verified: boolean;
  verificationMethod: 'automated' | 'llm_checked' | 'unverified';
}

export interface ProofStep {
  stepNumber: number;
  statement: string;
  justification: 'axiom' | 'definition' | 'inference' | 'given';
  rule?: string;  // E.g., "modus ponens", "definition of calls"
  premises?: number[];  // Step numbers of premises
}
```

### Example Proof

Example proof that `authenticateUser` is relevant to "how does login work":

```
1. Query asks about "login" [Given]
2. "login" is defined as "verifying user identity" [Definition]
3. `authenticateUser` verifies user identity [From code analysis]
4. Therefore, `authenticateUser` is relevant to login [From 2, 3, by definition match]
```

This proof is checkable: step 3 can be verified by examining the function.

### Proof-Carrying Retriever

```typescript
export class ProofCarryingRetriever {
  /**
   * Retrieve context with proofs of relevance.
   * Returns entities only if a proof can be constructed.
   */
  retrieveWithProofs(query: string): Promise<ProofCarryingContext[]>;

  /**
   * Attempt to prove relevance of a specific entity.
   */
  proveRelevance(entity: Entity, query: string): Promise<RelevanceProof | ProofFailure>;
}
```

### Why This Is Breakthrough

This transforms retrieval from "statistically similar" to "logically necessary". An agent can trust the context because it can verify the proof.

### Implementation Status

- **Status**: Implemented (deterministic proof retriever)
- **Next Steps**: Evidence refresh pending

### Estimated LOC

~600-800 LOC + proof engine integration

---

## P16: Causal Discovery

**Source**: Part XVIII Section IV (Pearl)

### Theoretical Foundation

**What Doesn't Exist**: Current systems trace known dependencies. No system discovers unknown causal relationships from observational data (git history, test results, production metrics).

**The Breakthrough**: Discover hidden causal structure from patterns in data.

### Technical Specification

```typescript
/**
 * CAUSAL DISCOVERY
 *
 * Given observational data, discover causal relationships not declared in code.
 *
 * Examples of discoverable relationships:
 * - "Changes to config.ts tend to cause failures in tests/auth.test.ts"
 * - "Deploys on Fridays have 3x more rollbacks"
 * - "This function silently depends on global state"
 *
 * Uses PC algorithm, IC algorithm, and LLM-assisted causal inference.
 */

export interface DiscoveredCausalRelationship {
  cause: EntityId | string;
  effect: EntityId | string;

  /** How was this discovered? */
  discoveryMethod: 'pc_algorithm' | 'ic_algorithm' | 'llm_inference' | 'intervention_test';

  /** Statistical evidence */
  evidence: {
    observationCount: number;
    conditionalProbability: number;  // P(effect | cause)
    baseRate: number;  // P(effect)
    liftRatio: number;  // P(effect | cause) / P(effect)
  };

  /** Causal confidence (not just correlation) */
  causalConfidence: number;

  /** Potential confounders that could explain the correlation */
  potentialConfounders: string[];

  /** Suggested intervention to verify causality */
  verificationExperiment?: string;
}
```

### Causal Discovery Engine

```typescript
export class CausalDiscoveryEngine {
  /**
   * Discover causal relationships from git history.
   * "What tends to cause what?"
   */
  discoverFromGitHistory(history: GitHistory): Promise<DiscoveredCausalRelationship[]>;

  /**
   * Discover causal relationships from test results.
   * "What code changes tend to break what tests?"
   */
  discoverFromTestResults(testRuns: TestRun[]): Promise<DiscoveredCausalRelationship[]>;

  /**
   * Discover causal relationships from production metrics.
   * "What changes tend to impact what metrics?"
   */
  discoverFromProductionMetrics(metrics: MetricTimeSeries[]): Promise<DiscoveredCausalRelationship[]>;

  /**
   * Verify a discovered relationship through intervention.
   * Actually test if manipulating cause affects effect.
   */
  verifyByIntervention(
    relationship: DiscoveredCausalRelationship
  ): Promise<VerificationResult>;
}
```

### Why This Is Breakthrough

This finds dependencies that aren't in the code - implicit coupling, hidden state dependencies, environmental factors. No existing code understanding system discovers causal structure from observational data.

### Implementation Status

- **Status**: Not yet implemented
- **Gap**: No do-calculus implementation

### Estimated LOC

~1200 LOC + statistical libraries

---

## P17: Bi-Temporal Knowledge

**Source**: Part XVIII Section III (Hickey)

### Theoretical Foundation

**What Doesn't Exist**: Current systems have "current knowledge" that gets updated. No system maintains full bi-temporal history: when facts were true in the world AND when we learned them.

**The Breakthrough**: Full bi-temporal knowledge with time-travel queries.

### Technical Specification

```typescript
/**
 * BI-TEMPORAL KNOWLEDGE
 *
 * Every fact has two time dimensions:
 * - Valid time: When the fact was true in the world
 * - Transaction time: When we recorded the fact
 *
 * This enables queries like:
 * - "What did we know about auth on January 1st?"
 * - "What was actually true about auth on January 1st?"
 * - "When did we first learn that login was broken?"
 * - "What would we have known if we had indexed yesterday's code today?"
 */

export interface BiTemporalFact {
  claim: string;
  subject: EntityId;

  /** When was this true in the world? */
  validTime: {
    start: Timestamp;
    end: Timestamp | 'now';  // 'now' means still valid
  };

  /** When did we record this fact? */
  transactionTime: {
    recorded: Timestamp;
    superseded?: Timestamp;  // When this record was replaced
  };

  /** Evidence supporting this fact */
  evidence: Evidence[];
  confidence: number;
}

export interface BiTemporalQuery {
  /** What we want to know */
  question: string;

  /** As of what valid time? (when in the world) */
  asOfValidTime?: Timestamp;

  /** As of what transaction time? (when we knew it) */
  asOfTransactionTime?: Timestamp;
}
```

### Bi-Temporal Operations

```typescript
/**
 * The four fundamental bi-temporal operations:
 */
export class BiTemporalKnowledge {
  /**
   * Current snapshot: What do we currently know about current state?
   * validTime = now, transactionTime = now
   */
  current(query: string): Promise<Knowledge[]>;

  /**
   * Historical snapshot: What was true at time T?
   * validTime = T, transactionTime = now
   */
  asOfValidTime(query: string, validTime: Timestamp): Promise<Knowledge[]>;

  /**
   * What we knew: What did we know at time T about current state?
   * validTime = now, transactionTime = T
   */
  asOfTransactionTime(query: string, transactionTime: Timestamp): Promise<Knowledge[]>;

  /**
   * Historical knowledge: What did we know at time T1 about time T2?
   * validTime = T2, transactionTime = T1
   */
  asOf(query: string, validTime: Timestamp, transactionTime: Timestamp): Promise<Knowledge[]>;

  /**
   * Time travel diff: How has our knowledge changed?
   */
  knowledgeDiff(
    query: string,
    fromTransaction: Timestamp,
    toTransaction: Timestamp
  ): Promise<KnowledgeDiff>;
}
```

### Why This Is Breakthrough

This enables:
- **Temporal debugging**: "When did we start believing X?"
- **Knowledge archaeology**: "What did past agents know?"
- **Counterfactual analysis**: "Would we have caught this bug if we had indexed earlier?"

### Implementation Status

- **Status**: Not yet implemented
- **Gap**: No time-travel queries

### Estimated LOC

~1000 LOC (requires temporal database schema)

---

## P18: Metacognitive Architecture

**Source**: Part XVIII Section V (McCarthy/Minsky)

### Theoretical Foundation

**What Doesn't Exist**: No system can reason about how to reason. Current systems apply fixed strategies regardless of problem characteristics.

**The Breakthrough**: A system that monitors its own reasoning, detects when it's stuck, and switches strategies.

### Technical Specification

```typescript
/**
 * METACOGNITIVE ARCHITECTURE
 *
 * "Knowing how you know" and "knowing when to think differently"
 *
 * The system has multiple reasoning strategies and a meta-level that:
 * 1. Monitors progress of current strategy
 * 2. Detects impasses (stuck, going in circles, diminishing returns)
 * 3. Selects alternative strategies
 * 4. Knows when to ask for help
 */

export interface MetacognitiveState {
  currentStrategy: ReasoningStrategy;
  strategyStartTime: Timestamp;
  progressIndicators: ProgressIndicator[];
  impasses: Impasse[];
  strategySwitches: StrategySwitch[];
}

export interface ReasoningStrategy {
  id: string;
  name: string;
  applicableWhen: string[];
  progressMetric: string;
  expectedProgressRate: number;
}

export interface Impasse {
  type: 'stuck' | 'circular' | 'diminishing_returns' | 'contradiction';
  detectedAt: Timestamp;
  evidence: string;
  suggestedRecovery: string[];
}

export interface ProgressIndicator {
  metric: string;
  value: number;
  trend: 'improving' | 'stable' | 'declining';
  expectedValue: number;
}
```

### Metacognitive Monitor

```typescript
export class MetacognitiveMonitor {
  /**
   * Monitor reasoning progress and detect impasses.
   */
  monitor(state: ReasoningState): MetacognitiveState;

  /**
   * Detect if current strategy is failing.
   */
  detectImpasse(state: MetacognitiveState): Impasse | null;

  /**
   * Select alternative strategy based on impasse type.
   */
  selectAlternativeStrategy(
    currentStrategy: ReasoningStrategy,
    impasse: Impasse
  ): ReasoningStrategy;

  /**
   * Determine if human help is needed.
   */
  shouldEscalate(state: MetacognitiveState): boolean;

  /**
   * Generate explanation of reasoning process.
   */
  explainReasoning(state: MetacognitiveState): ReasoningExplanation;
}
```

### Reasoning Strategies Library

```typescript
/**
 * REASONING STRATEGIES LIBRARY
 */
export const REASONING_STRATEGIES: ReasoningStrategy[] = [
  {
    id: 'deductive',
    name: 'Deductive Reasoning',
    applicableWhen: ['clear premises', 'formal structure', 'logical derivation needed'],
    progressMetric: 'conclusions_derived',
    expectedProgressRate: 0.5,  // conclusions per minute
  },
  {
    id: 'abductive',
    name: 'Abductive Reasoning',
    applicableWhen: ['need explanation', 'symptoms known', 'cause unknown'],
    progressMetric: 'hypotheses_eliminated',
    expectedProgressRate: 0.3,
  },
  {
    id: 'analogical',
    name: 'Analogical Reasoning',
    applicableWhen: ['novel problem', 'similar known problems exist'],
    progressMetric: 'relevant_analogies_found',
    expectedProgressRate: 0.4,
  },
  {
    id: 'decomposition',
    name: 'Decomposition',
    applicableWhen: ['complex problem', 'independent sub-problems'],
    progressMetric: 'sub_problems_solved',
    expectedProgressRate: 0.2,
  },
  {
    id: 'brute_force',
    name: 'Systematic Enumeration',
    applicableWhen: ['finite search space', 'other strategies failed'],
    progressMetric: 'options_evaluated',
    expectedProgressRate: 1.0,
  },
  {
    id: 'ask_human',
    name: 'Human Consultation',
    applicableWhen: ['multiple impasses', 'low confidence', 'high stakes'],
    progressMetric: 'clarifications_received',
    expectedProgressRate: 0.1,
  },
];
```

### Why This Is Breakthrough

This is the first system that can reason about its own reasoning, detect when it's stuck, and intelligently switch approaches. Current systems either apply one strategy or randomly try alternatives.

### Implementation Status

- **Status**: Not yet implemented

### Estimated LOC

~800 LOC

---

## Dependencies Between Features

The Track C Extended Features form a coherent system with interconnected dependencies:

```
P11 (Storage Interface Split) ──────┐
                                    │
P12 (Transaction Boundaries) ───────┼──> Foundation Layer
                                    │
                                    v
P13 (Prediction-Oriented Memory) ───┬──> Learning Layer
                                    │
P14 (Self-Aware Oracle) ────────────┼──> Epistemic Layer (classification)
                                    │
P15 (Proof-Carrying Context) ───────┼──> Epistemic Layer (verification)
                                    │
P16 (Causal Discovery) ─────────────┤
                                    │
P17 (Bi-Temporal Knowledge) ────────┴──> Temporal Layer

P18 (Metacognitive Architecture) ──────> Meta Layer (reasoning about reasoning)
```

### Dependency Graph

| Feature | Depends On | Enables |
|---------|-----------|---------|
| **P11** | None | P12, all storage consumers |
| **P12** | P11 | All multi-step operations |
| **P13** | P11, P12 | P14 (informed predictions) |
| **P14** | P13 (outcome data) | P15 (what CAN be proven), P18 (strategy selection) |
| **P15** | P14 (decidability classification) | Agent trust in context |
| **P16** | P12 (transaction data), P17 (temporal queries) | Hidden dependency discovery |
| **P17** | P11, P12 | P16 (temporal analysis), knowledge archaeology |
| **P18** | P13, P14 | Intelligent strategy switching |

---

## Implementation Status

| Priority | Feature | Part Reference | Est. LOC | Status |
|----------|---------|----------------|----------|--------|
| **P11** | Storage Interface Split | IX (P24) | ~200 | Implemented |
| **P12** | Transaction Boundaries | IX (P25) | ~150 | Partially Implemented |
| **P13** | Prediction-Oriented Memory | VII (B.1) | ~200 | Implemented |
| **P14** | Self-Aware Oracle | XVIII.I | ~400 | Implemented (heuristic) |
| **P15** | Proof-Carrying Context | XVIII.II | ~600 | Implemented |
| **P16** | Causal Discovery | XVIII.IV | ~1200 | Not Implemented |
| **P17** | Bi-Temporal Knowledge | XVIII.III | ~1000 | Not Implemented |
| **P18** | Metacognitive Architecture | XVIII.V | ~800 | Not Implemented |

### Current Implementation Evidence

| Feature | Implementation | Commit |
|---------|---------------|--------|
| P11 | `StorageSlices`, `createStorageSlices`, `LiBrainian.getStorageSlices()` | 2026-01-22 |
| P12 | `transaction()` + `withinTransaction()` helpers; bootstrap file/directory/assessment batches wrapped | `5d4d73d4` |
| P13 | `ClosedLoopLearner` with prediction-weighted retrieval, consolidation/tiering, shift detection | `6c4598c8`, `cdc3a148`, `41d00c0a` |
| P14 | Heuristic classifier | Evidence refresh pending |
| P15 | Deterministic proof retriever | Evidence refresh pending |

### Remaining Gaps

| Feature | Gap | Priority |
|---------|-----|----------|
| P12 | Remaining multi-step flows need coverage inventory | High |
| P13 | Evidence refresh for prediction-oriented memory | Medium |
| P14 | Evidence refresh for heuristic classifier | Medium |
| P15 | Evidence refresh for proof retriever | Medium |
| P16 | No do-calculus implementation | High |
| P17 | No time-travel queries | High |
| P18 | No metacognitive monitoring | Medium |

---

## Acceptance Criteria

### P11: Storage Interface Split
- [ ] All storage consumers use slice-first access
- [ ] Tests can mock individual slices without implementing others
- [ ] New storage backends can implement subsets of functionality

### P12: Transaction Boundaries
- [ ] All multi-step operations use `withinTransaction()`
- [ ] Partial failures result in complete rollback
- [ ] Concurrency contract enforced for multi-agent access

### P13: Prediction-Oriented Memory
- [ ] `predictOutcome()` returns calibrated predictions
- [ ] Predictions improve with more outcome data
- [ ] Failure patterns are extracted and presented as advice

### P14: Self-Aware Oracle
- [ ] All code questions classified into decidability categories
- [ ] Formally undecidable questions include reduction proof
- [ ] Enabling conditions provided for making questions answerable

### P15: Proof-Carrying Context
- [ ] Every retrieved entity includes relevance proof
- [ ] Proofs are machine-verifiable (at least automated or LLM-checked)
- [ ] Proof failures explain why proof couldn't be constructed

### P16: Causal Discovery
- [ ] Causal relationships discovered from git history
- [ ] Discovered relationships distinguish correlation from causation
- [ ] Verification experiments suggested for high-confidence relationships

### P17: Bi-Temporal Knowledge
- [ ] All four bi-temporal operations implemented
- [ ] Knowledge diff shows how understanding evolved
- [ ] Time-travel queries answer "what did we know when"

### P18: Metacognitive Architecture
- [ ] Reasoning strategies available in library
- [ ] Impasses detected automatically
- [ ] Strategy switches recorded and explained
- [ ] Escalation to human triggered appropriately
