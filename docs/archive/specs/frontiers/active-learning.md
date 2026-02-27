# Active Learning for Retrieval Specification

> **Version**: 1.0.0
> **Status**: RESEARCH FRONTIER
> **Last Updated**: 2026-01-23
>
> **Theory Reference**: Based on information-theoretic active learning (MacKay, Settles) and Bayesian experimental design.

---

## Executive Summary

**Current retrieval**: "Execute all planned queries, hope for the best"
**Active Learning**: "What single query would most reduce my uncertainty?"

Active learning transforms retrieval from a passive process into an **intelligent exploration strategy**. Instead of executing a fixed set of queries, the system:

1. **Estimates uncertainty** about the answer
2. **Generates candidate queries** that might help
3. **Ranks queries by expected information gain** (minus cost)
4. **Learns from outcomes** to improve future exploration

**Target verification**: Active learning uses **30% fewer queries** to reach the same confidence level as naive retrieval.

---

## 1. The Problem with Passive Retrieval

### 1.1 Query Explosion

```
Question: "Is the authentication system secure?"

Naive retrieval:
1. Search "authentication" → 47 files
2. Search "security" → 83 files
3. Search "password" → 31 files
4. Search "jwt" → 12 files
5. Search "oauth" → 8 files
... 15 more queries ...

Total: 200+ documents retrieved, 80% redundant

Active learning retrieval:
1. "What authentication methods exist?" → auth/strategies/
2. "What validates tokens?" → auth/jwt-validator.ts (HIGH INFO GAIN)
3. "What stores credentials?" → Inference: uses env vars, not DB
4. STOP: Sufficient confidence reached

Total: 3 targeted queries, same answer confidence
```

### 1.2 The Core Questions

Active learning asks at each step:

1. **What do I know?** (current belief state)
2. **What am I uncertain about?** (entropy of beliefs)
3. **What query would most reduce uncertainty?** (expected information gain)
4. **Is the cost worth it?** (cost-adjusted ranking)
5. **Should I explore or exploit?** (exploration vs exploitation tradeoff)

---

## 2. Core Types

### 2.1 Uncertainty State

```typescript
/**
 * Represents the current state of uncertainty about a question.
 *
 * INVARIANT: entropy is computed from belief distribution
 * INVARIANT: 0 <= entropy <= maxEntropy
 */
interface UncertaintyState {
  /** The question being answered */
  question: Question;

  /** Current belief distribution over possible answers */
  beliefDistribution: BeliefDistribution;

  /** Shannon entropy of the belief distribution (bits) */
  entropy: number;

  /** Maximum possible entropy (uniform distribution) */
  maxEntropy: number;

  /** Normalized uncertainty (0 = certain, 1 = maximally uncertain) */
  normalizedUncertainty: number;

  /** Confidence that we have the right answer */
  confidence: ConfidenceValue;

  /** Evidence gathered so far */
  evidenceCollected: Evidence[];

  /** Queries executed so far */
  queryHistory: ExecutedQuery[];
}

interface BeliefDistribution {
  /** Possible answers and their probabilities */
  answers: Map<AnswerId, number>;

  /** "Unknown/other" probability mass */
  unknownMass: number;

  /** Distribution type */
  type: 'categorical' | 'continuous' | 'mixed';
}

type AnswerId = string & { readonly __brand: 'AnswerId' };
```

### 2.2 Candidate Query

```typescript
/**
 * A candidate query that could be executed to gather information.
 */
interface CandidateQuery {
  /** Unique identifier */
  id: QueryId;

  /** The query string or specification */
  query: QuerySpec;

  /** Why this query was generated */
  rationale: string;

  /** What aspect of uncertainty this targets */
  targetUncertainty: UncertaintyTarget;

  /** Estimated retrieval cost */
  estimatedCost: QueryCost;

  /** Expected information gain (before execution) */
  expectedInfoGain: ExpectedInformationGain;

  /** Cost-adjusted score */
  adjustedScore: number;

  /** Generation source */
  source: QueryGenerationSource;
}

type QueryId = string & { readonly __brand: 'QueryId' };

interface QuerySpec {
  /** Query type */
  type: 'semantic' | 'structural' | 'graph' | 'hybrid';

  /** The actual query */
  content: string;

  /** Expected document types */
  expectedDocTypes: DocumentType[];

  /** Search scope */
  scope: SearchScope;
}

interface UncertaintyTarget {
  /** Which aspect of the question this query addresses */
  aspect: string;

  /** Which answers this query could distinguish between */
  distinguishes: AnswerId[];

  /** Current entropy contribution from this aspect */
  aspectEntropy: number;
}
```

### 2.3 Expected Information Gain

```typescript
/**
 * Expected information gain from executing a query.
 *
 * EIG = H(A) - E[H(A | result)]
 * where A = answer distribution, result = query result
 */
interface ExpectedInformationGain {
  /** Current entropy before query */
  currentEntropy: number;

  /** Expected entropy after query (averaging over possible results) */
  expectedEntropyAfter: number;

  /** Expected information gain (bits) */
  expectedGain: number;

  /** Confidence in this estimate */
  confidence: ConfidenceValue;

  /** Breakdown by possible result */
  resultBreakdown: ResultScenario[];
}

interface ResultScenario {
  /** Possible query result */
  result: PredictedResult;

  /** Probability of this result */
  probability: number;

  /** Entropy if this result occurs */
  entropyIfResult: number;

  /** Information gain if this result occurs */
  gainIfResult: number;
}

interface PredictedResult {
  /** Result type */
  type: 'found' | 'not_found' | 'partial' | 'contradictory';

  /** Expected content (if found) */
  expectedContent?: string;

  /** Likelihood ratio for answer update */
  likelihoodRatios: Map<AnswerId, number>;
}
```

### 2.4 Query Cost

```typescript
/**
 * Cost of executing a query.
 */
interface QueryCost {
  /** Time cost (estimated milliseconds) */
  timeCost: number;

  /** Computational cost (e.g., embedding calls) */
  computeCost: number;

  /** Token cost (if LLM involved) */
  tokenCost: number;

  /** Combined normalized cost (0-1) */
  normalizedCost: number;

  /** Cost category */
  category: 'cheap' | 'moderate' | 'expensive' | 'very_expensive';
}

/**
 * Compute cost-adjusted score.
 *
 * score = expectedInfoGain / (1 + lambda * cost)
 * where lambda is the cost sensitivity parameter
 */
function computeAdjustedScore(
  expectedInfoGain: number,
  cost: QueryCost,
  lambda: number = 1.0
): number {
  return expectedInfoGain / (1 + lambda * cost.normalizedCost);
}
```

### 2.5 Executed Query and Outcome

```typescript
/**
 * Record of an executed query and its outcome.
 */
interface ExecutedQuery {
  /** The query that was executed */
  query: CandidateQuery;

  /** Actual result */
  result: QueryResult;

  /** Actual information gain (computed after execution) */
  actualInfoGain: number;

  /** Was the prediction accurate? */
  predictionAccuracy: PredictionAccuracy;

  /** Execution metadata */
  metadata: {
    executedAt: Date;
    durationMs: number;
    actualCost: QueryCost;
  };
}

interface QueryResult {
  /** Documents retrieved */
  documents: ContextPack[];

  /** Result type */
  type: 'found' | 'not_found' | 'partial' | 'contradictory';

  /** Evidence extracted */
  evidence: Evidence[];

  /** Updated belief distribution */
  updatedBeliefs: BeliefDistribution;
}

interface PredictionAccuracy {
  /** Was result type predicted correctly? */
  typeCorrect: boolean;

  /** How close was the info gain prediction? */
  gainPredictionError: number;

  /** How close was the cost prediction? */
  costPredictionError: number;
}
```

---

## 3. Key Algorithms

### 3.1 Expected Information Gain Computation

```typescript
/**
 * Compute expected information gain for a candidate query.
 *
 * EIG(Q) = H(A) - E_{r~P(result|Q)}[H(A | r)]
 *
 * This is the expected reduction in entropy about the answer
 * after observing the query result.
 */
function computeExpectedInformationGain(
  currentState: UncertaintyState,
  candidate: CandidateQuery,
  resultPredictor: IResultPredictor
): ExpectedInformationGain {
  const currentEntropy = currentState.entropy;

  // Predict possible results and their probabilities
  const possibleResults = resultPredictor.predictResults(
    candidate,
    currentState
  );

  // Compute expected entropy after query
  let expectedEntropyAfter = 0;
  const resultBreakdown: ResultScenario[] = [];

  for (const predicted of possibleResults) {
    // Compute posterior beliefs if this result occurs
    const posteriorBeliefs = updateBeliefs(
      currentState.beliefDistribution,
      predicted.result,
      predicted.likelihoodRatios
    );

    // Compute entropy of posterior
    const posteriorEntropy = computeEntropy(posteriorBeliefs);

    // Weight by probability of this result
    expectedEntropyAfter += predicted.probability * posteriorEntropy;

    resultBreakdown.push({
      result: predicted.result,
      probability: predicted.probability,
      entropyIfResult: posteriorEntropy,
      gainIfResult: currentEntropy - posteriorEntropy,
    });
  }

  return {
    currentEntropy,
    expectedEntropyAfter,
    expectedGain: currentEntropy - expectedEntropyAfter,
    confidence: resultPredictor.getConfidence(),
    resultBreakdown,
  };
}

/**
 * Compute Shannon entropy of a belief distribution.
 */
function computeEntropy(beliefs: BeliefDistribution): number {
  let entropy = 0;

  for (const [_, prob] of beliefs.answers) {
    if (prob > 0) {
      entropy -= prob * Math.log2(prob);
    }
  }

  // Include unknown mass
  if (beliefs.unknownMass > 0) {
    entropy -= beliefs.unknownMass * Math.log2(beliefs.unknownMass);
  }

  return entropy;
}
```

### 3.2 Query Ranking Algorithm

```typescript
/**
 * Rank candidate queries by cost-adjusted expected information gain.
 */
function rankQueries(
  candidates: CandidateQuery[],
  currentState: UncertaintyState,
  config: RankingConfig
): RankedQuery[] {
  const ranked: RankedQuery[] = [];

  for (const candidate of candidates) {
    // Compute expected information gain
    const eig = computeExpectedInformationGain(
      currentState,
      candidate,
      config.resultPredictor
    );

    // Compute cost-adjusted score
    const adjustedScore = computeAdjustedScore(
      eig.expectedGain,
      candidate.estimatedCost,
      config.costSensitivity
    );

    // Apply exploration bonus if enabled
    const explorationBonus = config.enableExploration
      ? computeExplorationBonus(candidate, currentState, config)
      : 0;

    ranked.push({
      candidate,
      expectedInfoGain: eig,
      adjustedScore,
      explorationBonus,
      finalScore: adjustedScore + explorationBonus,
    });
  }

  // Sort by final score (descending)
  ranked.sort((a, b) => b.finalScore - a.finalScore);

  return ranked;
}

interface RankingConfig {
  /** Cost sensitivity (lambda) - higher = more cost-averse */
  costSensitivity: number;

  /** Enable exploration bonus for diverse queries */
  enableExploration: boolean;

  /** Exploration weight (epsilon in epsilon-greedy) */
  explorationWeight: number;

  /** Result predictor for EIG computation */
  resultPredictor: IResultPredictor;
}

interface RankedQuery {
  candidate: CandidateQuery;
  expectedInfoGain: ExpectedInformationGain;
  adjustedScore: number;
  explorationBonus: number;
  finalScore: number;
}
```

### 3.3 Exploration vs Exploitation

```typescript
/**
 * Balance exploration (novel queries) vs exploitation (high-EIG queries).
 *
 * Uses UCB (Upper Confidence Bound) style approach:
 * score = exploitation + c * exploration
 */
function computeExplorationBonus(
  candidate: CandidateQuery,
  state: UncertaintyState,
  config: RankingConfig
): number {
  // Novelty: how different is this query from previous queries?
  const novelty = computeQueryNovelty(candidate, state.queryHistory);

  // Uncertainty about the prediction: high uncertainty = more exploration value
  const predictionUncertainty = 1 - candidate.expectedInfoGain.confidence.value;

  // Coverage: does this query explore an under-explored area?
  const coverageBonus = computeCoverageBonus(candidate, state);

  // UCB-style combination
  const explorationBonus =
    config.explorationWeight *
    Math.sqrt(
      (novelty * predictionUncertainty * coverageBonus) /
        (1 + countSimilarQueries(candidate, state.queryHistory))
    );

  return explorationBonus;
}

/**
 * Compute novelty of a query relative to history.
 */
function computeQueryNovelty(
  candidate: CandidateQuery,
  history: ExecutedQuery[]
): number {
  if (history.length === 0) return 1.0;

  // Find most similar previous query
  let maxSimilarity = 0;
  for (const executed of history) {
    const similarity = computeQuerySimilarity(candidate, executed.query);
    maxSimilarity = Math.max(maxSimilarity, similarity);
  }

  return 1 - maxSimilarity;
}

/**
 * Compute coverage bonus for under-explored areas.
 */
function computeCoverageBonus(
  candidate: CandidateQuery,
  state: UncertaintyState
): number {
  const targetAspect = candidate.targetUncertainty.aspect;

  // Count how many queries have targeted this aspect
  const aspectQueryCount = state.queryHistory.filter(
    (q) => q.query.targetUncertainty.aspect === targetAspect
  ).length;

  // Bonus for under-explored aspects
  return 1 / (1 + aspectQueryCount);
}
```

### 3.4 Stopping Criterion

```typescript
/**
 * Determine if enough information has been gathered.
 */
interface IStoppingCriterion {
  /**
   * Should we stop querying?
   */
  shouldStop(state: UncertaintyState, config: StoppingConfig): StoppingDecision;
}

interface StoppingConfig {
  /** Minimum confidence required */
  minConfidence: number;

  /** Maximum queries allowed */
  maxQueries: number;

  /** Maximum cost budget */
  maxCost: number;

  /** Minimum information gain to continue */
  minInfoGainThreshold: number;
}

interface StoppingDecision {
  /** Should we stop? */
  shouldStop: boolean;

  /** Reason for decision */
  reason: StoppingReason;

  /** Metrics at decision time */
  metrics: {
    currentConfidence: number;
    queriesExecuted: number;
    totalCost: number;
    lastInfoGain: number;
  };
}

type StoppingReason =
  | 'confidence_reached'      // Reached target confidence
  | 'max_queries_reached'     // Hit query limit
  | 'budget_exhausted'        // Hit cost limit
  | 'diminishing_returns'     // Info gain below threshold
  | 'no_viable_queries';      // No good queries left

/**
 * Default stopping criterion implementation.
 */
function defaultStoppingCriterion(
  state: UncertaintyState,
  config: StoppingConfig
): StoppingDecision {
  const metrics = {
    currentConfidence: state.confidence.value,
    queriesExecuted: state.queryHistory.length,
    totalCost: state.queryHistory.reduce(
      (sum, q) => sum + q.metadata.actualCost.normalizedCost,
      0
    ),
    lastInfoGain:
      state.queryHistory.length > 0
        ? state.queryHistory[state.queryHistory.length - 1].actualInfoGain
        : 0,
  };

  // Check confidence threshold
  if (metrics.currentConfidence >= config.minConfidence) {
    return { shouldStop: true, reason: 'confidence_reached', metrics };
  }

  // Check query limit
  if (metrics.queriesExecuted >= config.maxQueries) {
    return { shouldStop: true, reason: 'max_queries_reached', metrics };
  }

  // Check cost budget
  if (metrics.totalCost >= config.maxCost) {
    return { shouldStop: true, reason: 'budget_exhausted', metrics };
  }

  // Check diminishing returns (after at least 2 queries)
  if (
    metrics.queriesExecuted >= 2 &&
    metrics.lastInfoGain < config.minInfoGainThreshold
  ) {
    return { shouldStop: true, reason: 'diminishing_returns', metrics };
  }

  return { shouldStop: false, reason: 'confidence_reached', metrics };
}
```

---

## 4. Candidate Query Generation

### 4.1 Generator Interface

```typescript
/**
 * Generates candidate queries to explore.
 */
interface IQueryGenerator {
  /**
   * Generate candidate queries given current uncertainty.
   */
  generate(
    state: UncertaintyState,
    config: GenerationConfig
  ): Promise<CandidateQuery[]>;
}

interface GenerationConfig {
  /** Maximum candidates to generate */
  maxCandidates: number;

  /** Generation strategies to use */
  strategies: QueryGenerationStrategy[];

  /** Diversity requirement */
  diversityWeight: number;
}

type QueryGenerationStrategy =
  | 'uncertainty_targeted'    // Target highest-entropy aspects
  | 'hypothesis_testing'      // Test specific hypotheses
  | 'boundary_probing'        // Probe decision boundaries
  | 'gap_filling'             // Fill knowledge gaps
  | 'contradiction_seeking'   // Look for contradictions
  | 'confirmation_seeking';   // Confirm tentative conclusions
```

### 4.2 Generation Strategies

```typescript
/**
 * Generate queries that target the highest-entropy aspects.
 */
function generateUncertaintyTargetedQueries(
  state: UncertaintyState,
  maxQueries: number
): CandidateQuery[] {
  const candidates: CandidateQuery[] = [];

  // Identify aspects with highest uncertainty
  const aspectEntropies = computeAspectEntropies(state);
  const sortedAspects = [...aspectEntropies.entries()].sort(
    ([, a], [, b]) => b - a
  );

  for (const [aspect, entropy] of sortedAspects.slice(0, maxQueries)) {
    candidates.push({
      id: generateQueryId(),
      query: createQueryForAspect(aspect, state),
      rationale: `Targets highest-uncertainty aspect: ${aspect}`,
      targetUncertainty: {
        aspect,
        distinguishes: getDistinguishableAnswers(aspect, state),
        aspectEntropy: entropy,
      },
      estimatedCost: estimateCost(aspect),
      expectedInfoGain: null!, // Computed later
      adjustedScore: 0,
      source: 'uncertainty_targeted',
    });
  }

  return candidates;
}

/**
 * Generate queries that test specific hypotheses.
 */
function generateHypothesisTestingQueries(
  state: UncertaintyState,
  maxQueries: number
): CandidateQuery[] {
  const candidates: CandidateQuery[] = [];

  // Identify top hypotheses (answers with highest probability)
  const topAnswers = [...state.beliefDistribution.answers.entries()]
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3);

  for (const [answerId, prob] of topAnswers) {
    // Generate query that would confirm this hypothesis
    candidates.push(
      createConfirmationQuery(answerId, state, 'confirmation_seeking')
    );

    // Generate query that would refute this hypothesis
    candidates.push(
      createRefutationQuery(answerId, state, 'hypothesis_testing')
    );
  }

  return candidates.slice(0, maxQueries);
}

/**
 * Generate queries that probe decision boundaries.
 */
function generateBoundaryProbingQueries(
  state: UncertaintyState,
  maxQueries: number
): CandidateQuery[] {
  const candidates: CandidateQuery[] = [];

  // Find answer pairs with similar probabilities (boundaries)
  const answers = [...state.beliefDistribution.answers.entries()];
  const boundaries: [AnswerId, AnswerId, number][] = [];

  for (let i = 0; i < answers.length; i++) {
    for (let j = i + 1; j < answers.length; j++) {
      const probDiff = Math.abs(answers[i][1] - answers[j][1]);
      if (probDiff < 0.2) {
        // Close probabilities = decision boundary
        boundaries.push([answers[i][0], answers[j][0], probDiff]);
      }
    }
  }

  // Sort by closeness (smallest diff = most important boundary)
  boundaries.sort((a, b) => a[2] - b[2]);

  for (const [a1, a2, _] of boundaries.slice(0, maxQueries)) {
    candidates.push(
      createBoundaryQuery(a1, a2, state, 'boundary_probing')
    );
  }

  return candidates;
}
```

---

## 5. Learning from Outcomes

### 5.1 Outcome Learning Interface

```typescript
/**
 * Learns from query outcomes to improve future predictions.
 */
interface IOutcomeLearner {
  /**
   * Record an executed query and its outcome.
   */
  recordOutcome(executed: ExecutedQuery): void;

  /**
   * Get improved predictions based on learned patterns.
   */
  predictResult(
    candidate: CandidateQuery,
    state: UncertaintyState
  ): PredictedResult[];

  /**
   * Get accuracy metrics for predictions.
   */
  getAccuracyMetrics(): PredictionMetrics;
}

interface PredictionMetrics {
  /** Mean absolute error for info gain predictions */
  infoGainMAE: number;

  /** Mean absolute error for cost predictions */
  costMAE: number;

  /** Accuracy of result type predictions */
  resultTypeAccuracy: number;

  /** Total outcomes recorded */
  totalOutcomes: number;

  /** Metrics over time (for improvement tracking) */
  historicalAccuracy: HistoricalAccuracy[];
}

interface HistoricalAccuracy {
  window: string; // e.g., "last_10", "last_100"
  infoGainMAE: number;
  costMAE: number;
  resultTypeAccuracy: number;
}
```

### 5.2 Learning Algorithm

```typescript
/**
 * Update prediction model based on observed outcomes.
 */
function updatePredictionModel(
  model: PredictionModel,
  executed: ExecutedQuery
): PredictionModel {
  const predicted = executed.query.expectedInfoGain;
  const actual = executed.actualInfoGain;

  // Update info gain prediction model
  const updatedInfoGainModel = updateInfoGainPredictor(
    model.infoGainPredictor,
    {
      query: executed.query,
      predicted: predicted.expectedGain,
      actual: actual,
      features: extractQueryFeatures(executed.query),
    }
  );

  // Update cost prediction model
  const updatedCostModel = updateCostPredictor(model.costPredictor, {
    query: executed.query,
    predicted: executed.query.estimatedCost,
    actual: executed.metadata.actualCost,
    features: extractCostFeatures(executed.query),
  });

  // Update result type predictor
  const updatedResultPredictor = updateResultTypePredictor(
    model.resultPredictor,
    {
      query: executed.query,
      predicted: predicted.resultBreakdown.map((r) => r.result.type),
      actual: executed.result.type,
    }
  );

  return {
    ...model,
    infoGainPredictor: updatedInfoGainModel,
    costPredictor: updatedCostModel,
    resultPredictor: updatedResultPredictor,
    updateCount: model.updateCount + 1,
  };
}

/**
 * Extract features from a query for prediction.
 */
function extractQueryFeatures(query: CandidateQuery): QueryFeatures {
  return {
    queryType: query.query.type,
    queryLength: query.query.content.length,
    targetAspect: query.targetUncertainty.aspect,
    numDistinguishes: query.targetUncertainty.distinguishes.length,
    aspectEntropy: query.targetUncertainty.aspectEntropy,
    source: query.source,
    scopeBreadth: computeScopeBreadth(query.query.scope),
  };
}
```

---

## 6. Active Learning Orchestrator

### 6.1 Main Interface

```typescript
/**
 * Orchestrates the active learning retrieval process.
 */
interface IActiveLearningOrchestrator {
  /**
   * Answer a question using active learning retrieval.
   */
  answer(
    question: Question,
    config: ActiveLearningConfig
  ): Promise<ActiveLearningResult>;

  /**
   * Get the current uncertainty state.
   */
  getUncertaintyState(): UncertaintyState;

  /**
   * Manually inject evidence (for testing or warm-start).
   */
  injectEvidence(evidence: Evidence[]): void;
}

interface ActiveLearningConfig {
  /** Target confidence for stopping */
  targetConfidence: number;

  /** Maximum queries to execute */
  maxQueries: number;

  /** Cost budget (normalized) */
  costBudget: number;

  /** Cost sensitivity (lambda) */
  costSensitivity: number;

  /** Enable exploration */
  enableExploration: boolean;

  /** Exploration weight */
  explorationWeight: number;

  /** Query generation strategies */
  generationStrategies: QueryGenerationStrategy[];
}

interface ActiveLearningResult {
  /** The answer derived */
  answer: Answer;

  /** Final confidence */
  confidence: ConfidenceValue;

  /** Trace of the exploration process */
  explorationTrace: ExplorationTrace;

  /** Efficiency metrics */
  metrics: EfficiencyMetrics;
}

interface ExplorationTrace {
  /** Initial uncertainty state */
  initialState: UncertaintyState;

  /** Final uncertainty state */
  finalState: UncertaintyState;

  /** All executed queries */
  queries: ExecutedQuery[];

  /** Entropy reduction at each step */
  entropyPath: number[];

  /** Why exploration stopped */
  stoppingReason: StoppingReason;
}

interface EfficiencyMetrics {
  /** Total queries executed */
  totalQueries: number;

  /** Total cost incurred */
  totalCost: number;

  /** Information gained (bits) */
  totalInfoGain: number;

  /** Efficiency: info gain per query */
  infoGainPerQuery: number;

  /** Efficiency: info gain per unit cost */
  infoGainPerCost: number;

  /** Comparison to naive baseline */
  vsNaiveBaseline: {
    querySavings: number;     // Percentage fewer queries
    costSavings: number;      // Percentage lower cost
    sameConfidence: boolean;  // Reached same confidence?
  };
}
```

### 6.2 Orchestration Algorithm

```
ALGORITHM ActiveLearningRetrieval(question, config):
  1. INITIALIZE uncertainty state:
     - Create uniform belief distribution over possible answers
     - Compute initial entropy
     - Set confidence to low (uncertain)

  2. WHILE NOT shouldStop(state, config):
     a. GENERATE candidate queries:
        - Use all configured strategies
        - Ensure diversity

     b. FOR each candidate:
        - COMPUTE expected information gain
        - ESTIMATE cost
        - COMPUTE cost-adjusted score
        - ADD exploration bonus if enabled

     c. RANK candidates by final score

     d. SELECT top candidate (or sample with softmax for exploration)

     e. EXECUTE selected query

     f. UPDATE state:
        - Update belief distribution with new evidence
        - Recompute entropy and confidence
        - Record query in history

     g. LEARN from outcome:
        - Compare predicted vs actual info gain
        - Update prediction model

  3. DERIVE answer from final belief distribution

  4. COMPUTE efficiency metrics:
     - Compare queries used vs naive baseline
     - TARGET: 30% fewer queries for same confidence

  5. RETURN result with answer, confidence, trace, metrics
```

---

## 7. TDD Test Specifications

### 7.1 Tier-0 Tests (Deterministic)

| Test Case | Input | Expected Output |
|-----------|-------|-----------------|
| `entropy_uniform` | Uniform distribution over 4 answers | Entropy = 2.0 bits |
| `entropy_certain` | One answer with p=1.0 | Entropy = 0.0 bits |
| `entropy_binary` | Two answers with p=0.5 each | Entropy = 1.0 bit |
| `eig_positive` | Informative query | EIG > 0 |
| `eig_zero_redundant` | Redundant query | EIG ≈ 0 |
| `cost_adjusted_ranking` | High-EIG expensive vs low-EIG cheap | Correct ranking based on lambda |
| `exploration_bonus_novel` | Novel query | Bonus > 0 |
| `exploration_bonus_repeated` | Repeated query | Bonus ≈ 0 |
| `stopping_confidence` | Confidence >= threshold | shouldStop = true |
| `stopping_budget` | Cost >= budget | shouldStop = true |
| `belief_update_bayesian` | Evidence + prior | Correct posterior |

### 7.2 Tier-1 Tests (Integration)

| Test Case | Scenario | Acceptance Criteria |
|-----------|----------|---------------------|
| `full_exploration_loop` | Question + mock retrieval | Converges to answer |
| `learning_improves_predictions` | 10 queries | Prediction error decreases |
| `diverse_query_generation` | 5 strategies | All strategies produce candidates |
| `exploration_exploitation_balance` | Low vs high epsilon | Different query selections |
| `cost_sensitivity_effect` | Lambda = 0 vs 10 | Different rankings |

### 7.3 Tier-2 Tests (Live - Target Verification)

| Test Case | Scenario | Acceptance Criteria |
|-----------|----------|---------------------|
| `query_efficiency_30pct` | 50 diverse questions | **30% fewer queries** than naive |
| `same_confidence_reached` | Same 50 questions | Confidence >= naive baseline |
| `real_codebase_exploration` | Wave0 codebase queries | Valid answers with trace |
| `learning_transfer` | Train on A, test on B | Improved efficiency on B |

### 7.4 BDD Scenarios

```gherkin
Feature: Active Learning Retrieval
  As a LiBrainian system
  I want to intelligently explore the codebase
  So that I use fewer queries to reach the same confidence

  Scenario: Basic active learning loop
    Given I have a question "What authentication methods are supported?"
    And the codebase has auth/local.ts, auth/oauth.ts, auth/jwt.ts
    When I run active learning retrieval with target confidence 0.8
    Then I execute queries targeting highest uncertainty aspects
    And each query reduces entropy
    And I stop when confidence reaches 0.8
    And I use fewer queries than naive search would

  Scenario: Exploration vs exploitation tradeoff
    Given I have executed 3 queries with diminishing returns
    And there is a novel but uncertain query candidate
    When exploration weight is high (0.3)
    Then the novel query has exploration bonus
    And it may be selected despite lower EIG

  Scenario: Learning from outcomes
    Given I have executed 10 queries
    And I track predicted vs actual information gain
    When I compute prediction accuracy
    Then prediction error has decreased over the 10 queries
    And cost predictions are within 20% of actual

  Scenario: Cost-adjusted query selection
    Given I have two candidate queries:
      | Query | EIG | Cost |
      | A     | 0.5 | 0.1  |
      | B     | 0.8 | 0.9  |
    And cost sensitivity lambda = 2.0
    When I rank the candidates
    Then A is ranked higher (better cost-adjusted score)

  Scenario: Target verification - 30% query reduction
    Given I have 50 diverse questions about the codebase
    And I run both naive retrieval and active learning
    When I compare query counts at same confidence level
    Then active learning uses at least 30% fewer queries
    And both reach confidence >= 0.75
```

---

## 8. Integration Points

| Component | Integration | Direction |
|-----------|-------------|-----------|
| Query Engine | Executes generated queries | Reads |
| Evidence Ledger | Records exploration traces | Writes |
| Causal Retrieval | Provides relevance signals | Reads |
| Decision-Theoretic Confidence | Uses exploration for improvement paths | Reads |
| Calibration | Calibrates EIG predictions | Reads/Writes |
| Result Predictor | Predicts query outcomes | Reads |

---

## 9. Theoretical Foundation

### 9.1 Information-Theoretic Basis

Active learning is grounded in **Bayesian experimental design** (Lindley 1956, MacKay 1992):

```
Query* = argmax_Q E_{result}[I(Answer; Result | Query)]
```

The optimal query maximizes expected mutual information between the answer and the result.

### 9.2 Exploration-Exploitation Connection

The exploration bonus is inspired by:
- **UCB (Upper Confidence Bound)** from multi-armed bandits
- **Thompson Sampling** for Bayesian exploration
- **Curiosity-driven exploration** from reinforcement learning

### 9.3 Connection to Value of Information

The cost-adjusted score relates to **Value of Information (VOI)**:

```
VOI(Q) = EIG(Q) - Cost(Q)
```

With risk aversion: `VOI(Q) = EIG(Q) / (1 + lambda * Cost(Q))`

---

## 10. Implementation Status

- [ ] Spec complete
- [ ] Tests written (Tier-0)
- [ ] Tests written (Tier-1)
- [ ] Tests written (Tier-2)
- [ ] Uncertainty state implementation
- [ ] EIG computation implementation
- [ ] Query generation implementation
- [ ] Ranking algorithm implementation
- [ ] Stopping criterion implementation
- [ ] Outcome learning implementation
- [ ] Active learning orchestrator implementation
- [ ] Gate passed: 30% fewer queries to same confidence

---

## Changelog

| Date | Change |
|------|--------|
| 2026-01-23 | Initial specification |
