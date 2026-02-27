# Critical Usability Problems and Solutions

> **Source**: THEORETICAL_CRITIQUE.md Part VII (lines 4321-5086)
> **Purpose**: Address the most severe usability problems blocking real-world adoption
> **Status**: These are CRITICAL - they must be addressed for the system to be usable
>
> **LiBrainian Story**: These problems explain WHY chapters 2-7 are necessary. Each problem maps to a specific track.

---

## How Critical Problems Map to the LiBrainian Story

| Problem | Chapter | Track | Status |
|---------|---------|-------|--------|
| **A: Execution** | 3 (Pipeline) | Track A (P1) | Code exists, needs verification |
| **B: Learning Loop** | 7 (Completion) | Track C (P13) | Exists (unverified end-to-end) |
| **B.1: Memory** | 7 (Completion) | Track C (P13) | Exists (unverified end-to-end) |
| **C: Customization** | 3 (Pipeline) | Track A (P7) | Exists (trace/evidence validation pending) |
| **D: Checkpointing** | 3 (Pipeline) | Track A (P1) | Specified; implementation incomplete |
| **E: Context Assembly** | 2+7 (Foundation+Completion) | Layer 2.2 + Track C (P15) | Specified; wiring + evidence incomplete |

**Read these problems to understand WHY the tracks exist.** The tracks are the HOW.

---

## Table of Contents

1. [Critical Problem A: Execution Engine Not Verified End-to-End](#critical-problem-a-execution-engine-not-verified-end-to-end)
2. [Critical Problem B: No Learning Loop Closure](#critical-problem-b-no-learning-loop-closure)
3. [Critical Problem B.1: Memory Not Prediction-Oriented](#critical-problem-b1-memory-not-prediction-oriented)
4. [Critical Problem C: No Composition Customization](#critical-problem-c-no-composition-customization)
5. [Critical Problem D: No Partial Execution / Checkpointing](#critical-problem-d-no-partial-execution--checkpointing)
6. [Critical Problem E: No Progressive Context Assembly](#critical-problem-e-no-progressive-context-assembly)
7. [Implementation Status](#implementation-status)

---

## Critical Problem A: Execution Engine Not Verified End-to-End

> **Theory Reference**: THEORETICAL_CRITIQUE.md Part VII, Critical Problem A
>
> **Why This Design**: Without execution verification, plans are theoretical, episodes can't be recorded, verification can't happen, and learning is impossible.

### The Issue

LiBrainian has an execution engine (`TechniqueExecutionEngine`) plus operator registry/interpreters, but **end-to-end execution is not yet verified with real traces and evidence**. Many primitives still rely on missing handlers, and some operator types are still no-op or partial.

**Severity**: Critical

### Technical Specification

```typescript
interface ExecutionEngine {
  /** Execute a primitive with given inputs */
  execute(
    primitive: TechniquePrimitive,
    inputs: Record<string, unknown>,
    context: ExecutionContext
  ): Promise<ExecutionResult>;

  /** Execute a full composition */
  executeComposition(
    composition: TechniqueComposition,
    inputs: Record<string, unknown>,
    context: ExecutionContext
  ): AsyncIterable<StepResult>;

  /** Resume execution from checkpoint */
  resume(
    checkpointId: string,
    context: ExecutionContext
  ): AsyncIterable<StepResult>;
}

interface ExecutionContext {
  /** Available tools */
  tools: ToolRegistry;

  /** Current knowledge from LiBrainian */
  knowledge: LibrarianResponse;

  /** LLM for interpretation */
  llm: LlmProvider;

  /** Resource budget */
  budget: ResourceBudget;

  /** Progress callback */
  onProgress?: (progress: ExecutionProgress) => void;
}

interface ExecutionResult {
  /** Did the primitive succeed? */
  status: 'success' | 'partial' | 'failed';

  /** Outputs produced */
  outputs: Record<string, unknown>;

  /** Verification results */
  verification: VerificationResult;

  /** Resources consumed */
  resources: ResourceUsage;

  /** Evidence of execution */
  evidence: ExecutionEvidence;
}
```

### Example: Execute tp_clarify_goal

```typescript
async function executeClarifyGoal(
  inputs: { vagueRequest: string },
  context: ExecutionContext
): Promise<ExecutionResult> {
  const prompt = `
    Given this vague request: "${inputs.vagueRequest}"
    And this context: ${JSON.stringify(context.knowledge.synthesis)}

    Produce:
    1. A clarified goal statement
    2. Success criteria (at least 2)
    3. Assumptions being made
    4. Open questions that need answers
  `;

  const response = await context.llm.complete(prompt);
  const parsed = parseStructuredOutput(response);

  const verification = verifyPostconditions(parsed, tp_clarify_goal.postconditions);

  return {
    status: verification.allPassed ? 'success' : 'partial',
    outputs: parsed,
    verification,
    resources: { tokens: response.usage.total_tokens },
    evidence: { prompt, response: response.text },
  };
}
```

### Non-Negotiable Upgrades

1. Every built-in operator either executes with real semantics or fails closed with an explicit coverage gap
2. At least one real primitive handler path (non-LLM) and one LLM-backed handler path with evidence logging
3. Minimal evidence ledger sink for operator events + primitive execution outcomes
4. End-to-end execution test that produces a replayable trace

### Propagating Impact

| Without Execution | With Execution |
|-------------------|----------------|
| Plans are theoretical | Full cycle: plan → execute → verify → learn |
| Episodes can't be recorded | Episodes capture real execution traces |
| Verification can't happen | Verification validates actual work |
| Learning is impossible | Primitives become reusable automation |

### Acceptance Criteria

- [ ] `TechniqueExecutionEngine.execute()` runs at least 5 primitives with real handlers
- [ ] Evidence ledger captures all operator events
- [ ] At least one composition can be run end-to-end with trace output
- [ ] Test: `packages/LiBrainian/src/api/__tests__/execution_engine_e2e.test.ts`

---

## Critical Problem B: No Learning Loop Closure

> **Theory Reference**: THEORETICAL_CRITIQUE.md Part VII, Critical Problem B
>
> **Why This Design**: Without closed-loop learning, the system never improves from experience. Episodes are recorded but not used, confidence is calibrated but not used for prioritization, feedback is collected but not used for tuning.

### The Issue

The system records episodes and tracks confidence, but there's **no closed loop** between outcomes and improvement:

- Episodes are recorded but not used to improve primitive selection
- Confidence is calibrated but not used to prioritize retrieval
- Feedback is collected but not used to tune scoring weights

**Severity**: High

### Technical Specification

```typescript
interface LearningLoop {
  /** Record outcome and update models */
  recordOutcome(
    episode: Episode,
    outcome: Outcome
  ): Promise<LearningUpdate>;

  /** Get learned recommendations */
  getRecommendations(
    intent: string,
    context: QueryContext
  ): Promise<LearnedRecommendations>;
}

interface LearningUpdate {
  /** What was learned */
  insights: LearningInsight[];

  /** Model updates applied */
  modelUpdates: ModelUpdate[];

  /** New recommendations generated */
  recommendations: Recommendation[];
}

interface LearnedRecommendations {
  /** Compositions that worked for similar intents */
  suggestedCompositions: CompositionSuggestion[];

  /** Primitives that helped in similar situations */
  effectivePrimitives: PrimitiveSuggestion[];

  /** Context packs that were useful */
  reliableContextSources: ContextSourceSuggestion[];

  /** Warnings from past failures */
  warningsFromHistory: HistoricalWarning[];
}
```

### ClosedLoopLearner Implementation

```typescript
class ClosedLoopLearner implements LearningLoop {
  async recordOutcome(episode: Episode, outcome: Outcome): Promise<LearningUpdate> {
    const insights: LearningInsight[] = [];
    const updates: ModelUpdate[] = [];

    // 1. Update composition effectiveness
    if (episode.compositionUsed) {
      const delta = outcome.success ? +0.1 : -0.15;
      await this.updateCompositionScore(episode.compositionUsed, episode.intent, delta);
      insights.push({
        type: 'composition_effectiveness',
        composition: episode.compositionUsed,
        delta,
        newScore: await this.getCompositionScore(episode.compositionUsed, episode.intent),
      });
    }

    // 2. Update primitive effectiveness (credit assignment)
    for (const step of episode.stepsExecuted) {
      const primitiveOutcome = step.succeeded ? 'success' : 'failure';
      await this.updatePrimitiveScore(step.primitiveId, primitiveOutcome);
    }

    // 3. Update context source reliability
    for (const pack of episode.contextUsed) {
      const wasHelpful = outcome.contextFeedback?.[pack.id] ?? outcome.success;
      await this.updateContextSourceScore(pack.source, wasHelpful);
    }

    return { insights, modelUpdates: updates, recommendations: [] };
  }

  async getRecommendations(intent: string, context: QueryContext): Promise<LearnedRecommendations> {
    const similarEpisodes = await this.findSimilarEpisodes(intent);

    return {
      suggestedCompositions: this.rankCompositionsByHistory(similarEpisodes),
      effectivePrimitives: this.rankPrimitivesByHistory(similarEpisodes),
      reliableContextSources: this.rankSourcesByHistory(similarEpisodes),
      warningsFromHistory: this.extractWarnings(similarEpisodes),
    };
  }
}
```

### Acceptance Criteria

- [ ] `ClosedLoopLearner.recordOutcome()` updates composition, primitive, and context source scores
- [ ] `ClosedLoopLearner.getRecommendations()` returns ranked suggestions based on history
- [ ] Composition selector uses learned scores in selection
- [ ] Test: `packages/LiBrainian/src/api/__tests__/learning_loop.test.ts`

---

## Critical Problem B.1: Memory Not Prediction-Oriented

> **Theory Reference**: THEORETICAL_CRITIQUE.md Part VII, Critical Problem B.1
>
> **Why This Design**: Memory should prioritize patterns that predict future outcomes, not just store everything. Surprise (unexpected outcomes) is more informative than confirmation.

### The Issue

Current memory is storage-oriented (store everything, retrieve by similarity). It should be **prediction-oriented** (store patterns that help predict outcomes, retrieve by predictive value).

**Severity**: High

### Technical Specification

#### 1. Outcome-Weighted Retrieval

```typescript
interface StoredPattern {
  embedding: Float32Array;
  successRate: number;       // 0-1, updated on each outcome
  sampleCount: number;
  ageInDays: number;
  wasUnexpected: boolean;    // True if outcome contradicted prediction
  isAntiPattern: boolean;    // True if consistently fails (successRate < 0.2, sampleCount > 5)
}

interface OutcomeWeightedRetrieval {
  /** Base similarity score */
  similarity: number;
  /** Historical success rate for this pattern in similar contexts */
  outcomeWeight: number;
  /** Final score */
  score: number;  // similarity * (1 + outcomeWeight)
}

function computeRetrievalScore(
  query: Query,
  candidate: StoredPattern
): number {
  const similarity = cosineSimilarity(query.embedding, candidate.embedding);
  const recency = Math.exp(-candidate.ageInDays / 30);
  const outcomeWeight = candidate.successRate - 0.5;  // Range: -0.5 to +0.5

  // Prediction error priority: surprises are more informative than confirmations
  const surprise = candidate.wasUnexpected ? 1.3 : 1.0;

  // Anti-patterns: return negative score (triggers warning, not recommendation)
  if (candidate.isAntiPattern) {
    return -similarity * 0.5;  // Negative = warning
  }

  return similarity * recency * (1 + outcomeWeight) * surprise;
}
```

#### 2. Periodic Consolidation

```typescript
interface ConsolidationResult {
  merged: number;      // Patterns merged due to similarity
  pruned: number;      // Patterns pruned due to low predictive value
  strengthened: number; // High-value patterns reinforced
}

class ClosedLoopLearner {
  async consolidate(options?: {
    minSampleCount?: number;
    minPredictiveValue?: number;
  }): Promise<ConsolidationResult> {
    const patterns = await this.getAllPatterns();

    // 1. Merge similar patterns (within similarity threshold)
    const merged = this.mergeSimilarPatterns(patterns, 0.95);

    // 2. Prune low-value patterns
    const pruned = merged.filter(p =>
      p.sampleCount >= (options?.minSampleCount ?? 5) &&
      Math.abs(p.successRate - 0.5) >= (options?.minPredictiveValue ?? 0.1)
    );

    // 3. Update storage
    await this.replacePatterns(pruned);

    return {
      merged: patterns.length - merged.length,
      pruned: merged.length - pruned.length,
      strengthened: pruned.filter(p => p.successRate > 0.7).length,
    };
  }
}
```

#### 3. Hierarchical Temporal Organization

```typescript
type PatternTier = 'working' | 'recent' | 'learned' | 'invariant';

interface TieredPattern extends StoredPattern {
  tier: PatternTier;
  promotedAt?: string;  // When moved to higher tier
}

// Tier semantics:
// - working: Current task only (cleared on task end)
// - recent: Last N sessions (ring buffer, auto-expires)
// - learned: Consolidated patterns (survives consolidation)
// - invariant: High-confidence patterns (success rate > 0.9, sample count > 20)

// Promotion rules:
// - working → recent: on task completion
// - recent → learned: survives consolidation with predictive value
// - learned → invariant: high confidence + high sample count
```

#### 4. Distribution Shift Detection

```typescript
interface CodebaseStats {
  embeddingMean: Float32Array;
  embeddingVariance: Float32Array;
  sampleCount: number;
}

function detectDistributionShift(
  learned: CodebaseStats,
  current: CodebaseStats
): { shifted: boolean; magnitude: number } {
  // Simplified KL divergence approximation
  const kl = learned.embeddingMean.reduce((sum, mean, i) => {
    const diff = mean - current.embeddingMean[i];
    return sum + (diff * diff) / (learned.embeddingVariance[i] + 1e-8);
  }, 0) / learned.embeddingMean.length;

  return { shifted: kl > 0.5, magnitude: kl };
}

// Usage in getRecommendations():
const shift = detectDistributionShift(this.learnedStats, currentCodebaseStats);
if (shift.shifted) {
  recommendations.confidence *= Math.exp(-shift.magnitude);
  recommendations.warnings.push('Distribution shift detected; patterns may not apply');
}
```

### Integration Points

| Existing Component | Enhancement |
|--------------------|-------------|
| `ClosedLoopLearner.recordOutcome()` | Tag patterns with tier, track outcome |
| `ClosedLoopLearner.getRecommendations()` | Weight by `computeRetrievalScore()` |
| `SemanticCompositionSelector.select()` | Include outcome history in scoring |
| `EmbeddingService` queries | Apply outcome weighting to results |

### Acceptance Criteria

- [ ] `StoredPattern` includes `successRate`, `wasUnexpected`, `isAntiPattern`
- [ ] `computeRetrievalScore()` incorporates outcome weighting and surprise
- [ ] `consolidate()` merges and prunes patterns periodically
- [ ] `TieredPattern` with promotion logic implemented
- [ ] Distribution shift detection warns when transferring patterns

---

## Critical Problem C: No Composition Customization

> **Theory Reference**: THEORETICAL_CRITIQUE.md Part VII, Critical Problem C
>
> **Why This Design**: Fixed compositions don't fit all projects. Users need to add/remove primitives, combine compositions, and create custom workflows.

### The Issue

The 14 default compositions are fixed. Users cannot:
- Add primitives to existing compositions
- Remove primitives they don't need
- Combine compositions
- Create new compositions easily

**Severity**: Medium-High

### Technical Specification

```typescript
interface CompositionBuilder {
  /** Start from existing composition */
  from(compositionId: string): CompositionBuilder;

  /** Add a primitive */
  add(primitiveId: string, options?: AddOptions): CompositionBuilder;

  /** Remove a primitive */
  remove(primitiveId: string): CompositionBuilder;

  /** Add an operator */
  withOperator(operator: Operator): CompositionBuilder;

  /** Merge with another composition */
  merge(other: CompositionBuilder): CompositionBuilder;

  /** Set relationship between primitives */
  relate(from: string, relation: RelationType, to: string): CompositionBuilder;

  /** Validate and build */
  build(): TechniqueComposition | ValidationError[];
}
```

### Example Usage

```typescript
// Customize existing composition
const customReview = compositionBuilder
  .from('tc_agentic_review_v1')
  .remove('tp_accessibility_review')  // Not needed for this project
  .add('tp_performance_profile')      // Add performance check
  .withOperator({
    id: 'op_perf_gate',
    type: 'gate',
    inputs: ['tp_performance_profile'],
    conditions: ['performance regression detected'],
  })
  .build();

// Create from scratch
const securityAudit = compositionBuilder
  .add('tp_threat_model')
  .add('tp_secret_scan')
  .add('tp_prompt_injection_scan')
  .add('tp_path_containment')
  .relate('tp_threat_model', 'enables', 'tp_secret_scan')
  .withOperator({
    id: 'op_security_gate',
    type: 'gate',
    inputs: ['tp_secret_scan', 'tp_prompt_injection_scan'],
    conditions: ['any security issue found'],
  })
  .build();
```

### Propagating Impact

Composition customization enables:
- Tailoring workflows to project needs
- Evolving compositions over time
- Sharing compositions across teams
- Experimentation with different approaches

### Acceptance Criteria

- [ ] `CompositionBuilder` implemented with `from()`, `add()`, `remove()`, `merge()`, `relate()`
- [ ] `build()` validates composition before returning
- [ ] At least 3 example customizations documented
- [ ] Test: `packages/LiBrainian/src/api/__tests__/composition_builder.test.ts`

---

## Critical Problem D: No Partial Execution / Checkpointing

> **Theory Reference**: THEORETICAL_CRITIQUE.md Part VII, Critical Problem D
>
> **Why This Design**: Long-running executions fail. Without checkpointing, all progress is lost, costs are wasted, and users can't debug at failure points.

### The Issue

Compositions are all-or-nothing. If execution fails midway:
- No checkpoint to resume from
- All progress is lost
- Can't skip already-completed steps
- No way to save intermediate state

**Severity**: Medium-High

### Technical Specification

```typescript
interface CheckpointedExecution {
  /** Start or resume execution */
  execute(
    composition: TechniqueComposition,
    checkpoint?: CheckpointId
  ): AsyncIterable<ExecutionEvent>;

  /** Save checkpoint */
  checkpoint(executionId: string): Promise<CheckpointId>;

  /** List available checkpoints */
  listCheckpoints(executionId: string): Promise<Checkpoint[]>;

  /** Resume from checkpoint */
  resume(checkpointId: CheckpointId): AsyncIterable<ExecutionEvent>;
}

interface Checkpoint {
  id: CheckpointId;
  executionId: string;

  /** Which primitives have completed */
  completedPrimitives: string[];

  /** Current state */
  state: ExecutionState;

  /** Outputs from completed primitives */
  intermediateOutputs: Record<string, unknown>;

  /** When checkpoint was created */
  timestamp: Date;

  /** Why checkpoint was created */
  reason: 'manual' | 'operator' | 'failure' | 'timeout';
}

interface ExecutionState {
  /** Current primitive being executed */
  currentPrimitive?: string;

  /** Pending primitives */
  pendingPrimitives: string[];

  /** Resources consumed so far */
  resourcesConsumed: ResourceUsage;

  /** Accumulated context */
  accumulatedContext: unknown;
}
```

### Example Usage

```typescript
const execution = new CheckpointedExecution();

try {
  for await (const event of execution.execute(composition)) {
    console.log(`Step: ${event.primitive}, Status: ${event.status}`);

    // Auto-checkpoint on significant progress
    if (event.status === 'completed' && event.isSignificant) {
      await execution.checkpoint(event.executionId);
    }
  }
} catch (error) {
  // Execution failed - can resume later
  const checkpoints = await execution.listCheckpoints(executionId);
  console.log(`Can resume from: ${checkpoints.map(c => c.id)}`);
}

// Later: resume from last checkpoint
const lastCheckpoint = checkpoints[checkpoints.length - 1];
for await (const event of execution.resume(lastCheckpoint.id)) {
  // Continues from where we left off
}
```

### Propagating Impact

Checkpointing enables:
- Resilient long-running executions
- Cost control (stop and resume)
- Debugging at failure point
- Human-in-the-loop at checkpoints

### Acceptance Criteria

- [ ] `CheckpointedExecution` implemented with `execute()`, `checkpoint()`, `resume()`
- [ ] Checkpoints stored persistently (survive process restart)
- [ ] Resume correctly skips completed primitives
- [ ] Test: `packages/LiBrainian/src/api/__tests__/checkpointed_execution.test.ts`

---

## Critical Problem E: No Progressive Context Assembly

> **Theory Reference**: THEORETICAL_CRITIQUE.md Part VII, Critical Problem E
>
> **Why This Design**: Real exploration is iterative. Users start with overview, drill into specifics, ask follow-ups. One-shot retrieval doesn't support this workflow.

### The Issue

Current context assembly is one-shot: query once, get all context. But real work often needs:
- Start with high-level overview
- Drill into specific areas
- Ask follow-up questions
- Maintain conversation context

**Severity**: Medium

### Technical Specification

```typescript
interface ContextSession {
  sessionId: string;

  /** Initial query that started the session */
  initialQuery: LibrarianQuery;

  /** Accumulated context */
  context: AccumulatedContext;

  /** Conversation history */
  history: ConversationTurn[];
}

interface ContextAssemblySession {
  /** Start a new session */
  start(query: LibrarianQuery): Promise<ContextSession>;

  /** Ask follow-up question within session */
  followUp(
    sessionId: string,
    question: string
  ): Promise<FollowUpResponse>;

  /** Drill into specific entity */
  drillDown(
    sessionId: string,
    entityId: string
  ): Promise<DrillDownResponse>;

  /** Get summary of accumulated context */
  summarize(sessionId: string): Promise<ContextSummary>;

  /** Close session */
  close(sessionId: string): Promise<void>;
}

interface AccumulatedContext {
  /** All packs retrieved in this session */
  packs: ContextPack[];

  /** Entities explored */
  exploredEntities: EntityId[];

  /** Questions asked and answered */
  qaHistory: QAPair[];

  /** Current focus area */
  focusArea?: FocusArea;
}

interface FollowUpResponse {
  /** Answer to the follow-up */
  answer: string;

  /** New packs retrieved for this follow-up */
  newPacks: ContextPack[];

  /** Suggested next questions */
  suggestedFollowUps: string[];

  /** Entities that might be worth exploring */
  drillDownSuggestions: EntityId[];
}
```

### Example Usage

```typescript
const session = await contextAssembly.start({
  intent: 'How does authentication work?',
  depth: 'L1',
});

// Get initial overview
console.log(session.context.packs);

// Drill into specific module
const authModule = await contextAssembly.drillDown(session.sessionId, 'auth/oauth.ts');

// Ask follow-up
const followUp = await contextAssembly.followUp(
  session.sessionId,
  'How does token refresh work?'
);

// Get summary of everything learned
const summary = await contextAssembly.summarize(session.sessionId);
```

### Propagating Impact

Conversational context enables:
- Natural exploration workflow
- Building understanding progressively
- Maintaining focus without losing context
- More efficient token usage (don't re-retrieve)

### Acceptance Criteria

- [ ] `ContextAssemblySession` implemented with `start()`, `followUp()`, `drillDown()`, `summarize()`
- [ ] Sessions persist accumulated context across queries
- [ ] Follow-ups build on previous context (don't re-retrieve)
- [ ] Test: `packages/LiBrainian/src/api/__tests__/context_sessions.test.ts`

---

## Implementation Status

| Problem | Feature ID | Status | Test Path |
|---------|------------|--------|-----------|
| Critical A | P1 (partial) | Implemented (not verified E2E) | `operator_interpreters.test.ts` |
| Critical B | P13 (partial) | Implemented | `learning_loop.test.ts` |
| Critical B.1 | P13 | Implemented | `learning_loop.test.ts` |
| Critical C | P7 (partial) | `TechniqueCompositionBuilder` exists | `composition_builder.test.ts` |
| Critical D | P1 (partial) | `InMemoryExecutionCheckpointStore` exists | `technique_execution.test.ts` |
| Critical E | (new) | `ContextAssemblySessionManager` exists | `context_sessions.test.ts` |

### Related Specs

- Critical A, D → [`track-a-core-pipeline.md`](./track-a-core-pipeline.md) (P1)
- Critical B, B.1 → [`track-c-extended.md`](./track-c-extended.md) (P13)
- Critical C → [`track-a-core-pipeline.md`](./track-a-core-pipeline.md) (P7)
