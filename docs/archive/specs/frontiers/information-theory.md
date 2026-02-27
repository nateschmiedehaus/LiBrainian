# Information-Theoretic Retrieval Specification

> **Version**: 1.0.0
> **Status**: FRONTIER
> **Last Updated**: 2026-01-23
>
> **Theory Reference**: Based on Shannon's information theory, rate-distortion theory, and the Information Bottleneck method (Tishby et al., 2000).

---

## Executive Summary

**Current retrieval**: "Retrieve documents that maximize similarity"
**Information-theoretic retrieval**: "Retrieve documents that maximize INFORMATION TRANSFER while minimizing irrelevance"

The Information Bottleneck principle states that optimal retrieval should **compress** the document set to retain only what's relevant to answering the query, while **preserving** the mutual information between documents and the answer. This allows us to:

1. **Detect information gaps**: What information is MISSING from retrieved documents?
2. **Measure retrieval quality**: Is the retrieved set sufficient to answer the query?
3. **Adjust confidence**: Lower confidence when information gaps are detected
4. **Suggest completions**: What additional documents would close the gaps?

**Target Verification**: Information bottleneck correlation with recall r > 0.7

---

## 1. The Information Bottleneck Problem

### 1.1 Why Similarity Is Insufficient

Traditional retrieval maximizes similarity, but similarity is not information.

```
Query: "How does the authentication flow handle token refresh?"

High-similarity retrieval:
1. auth.ts - contains "authentication" (0.92 similarity)
2. token.ts - contains "token" (0.88 similarity)
3. login.ts - mentions "authentication flow" (0.85 similarity)

Information-theoretic retrieval:
1. auth.ts - defines the flow (high mutual information with answer)
2. refresh-handler.ts - implements refresh logic (unique information)
3. token-store.ts - explains token lifecycle (fills gap about expiry)
4. MISSING: error-handler.ts - what happens on refresh failure?

The similar documents tell you ABOUT authentication.
The information-theoretic analysis tells you what you KNOW and DON'T KNOW.
```

### 1.2 The Information Bottleneck Principle

Given:
- **X**: The query
- **Y**: The ideal answer (latent)
- **T**: The retrieved document set (compressed representation)

The Information Bottleneck minimizes:

```
L = I(X; T) - β * I(T; Y)
```

Where:
- `I(X; T)`: Complexity of the retrieval (compression)
- `I(T; Y)`: Relevance to the answer (preservation)
- `β`: Trade-off parameter (higher = more relevance)

**Interpretation**: Retrieve the MINIMAL set of documents that MAXIMALLY preserves information about the answer.

---

## 2. Core Types

### 2.1 Information-Theoretic Assessment

```typescript
/**
 * Information-theoretic assessment of a retrieval result.
 */
interface InformationTheoreticAssessment {
  /** The query being answered */
  query: string;

  /** Retrieved documents with information metrics */
  retrievedDocs: InformationRankedDocument[];

  /** Overall information metrics for the retrieval */
  aggregateMetrics: AggregateInformationMetrics;

  /** Detected information gaps */
  gaps: InformationGap[];

  /** Confidence adjusted for gaps */
  gapAdjustedConfidence: GapAdjustedConfidence;

  /** Suggestions for closing gaps */
  gapClosureSuggestions: GapClosureSuggestion[];
}

/**
 * A document ranked by information contribution.
 */
interface InformationRankedDocument {
  /** The document */
  document: ContextPack;

  /** Mutual information with query */
  queryMutualInformation: number;

  /** Estimated mutual information with answer */
  answerMutualInformation: number;

  /** Redundancy with other retrieved docs */
  redundancy: number;

  /** Unique information contribution */
  uniqueContribution: number;

  /** Compression ratio (information per token) */
  compressionRatio: number;

  /** Information bottleneck score */
  bottleneckScore: number;
}
```

### 2.2 Aggregate Information Metrics

```typescript
/**
 * Aggregate information metrics for a retrieval set.
 */
interface AggregateInformationMetrics {
  /** Total mutual information with query */
  totalQueryMI: number;

  /** Estimated total mutual information with answer */
  totalAnswerMI: number;

  /** Total redundancy across documents */
  totalRedundancy: number;

  /** Information efficiency: unique / total */
  informationEfficiency: number;

  /** Estimated entropy of answer given retrieved docs */
  conditionalAnswerEntropy: number;

  /** Estimated entropy reduction from retrieval */
  entropyReduction: number;

  /** Bottleneck optimality score (0-1) */
  bottleneckOptimality: number;
}

/**
 * Compute aggregate metrics for a retrieval set.
 *
 * The key insight: good retrieval has HIGH answer MI, LOW redundancy.
 */
function computeAggregateMetrics(
  query: string,
  documents: InformationRankedDocument[],
  answerModel: IAnswerModel
): AggregateInformationMetrics {
  const totalQueryMI = documents.reduce(
    (sum, d) => sum + d.queryMutualInformation, 0
  );

  const totalAnswerMI = documents.reduce(
    (sum, d) => sum + d.answerMutualInformation, 0
  );

  // Redundancy is the overlap in information across documents
  const totalRedundancy = documents.reduce(
    (sum, d) => sum + d.redundancy, 0
  );

  const uniqueInformation = documents.reduce(
    (sum, d) => sum + d.uniqueContribution, 0
  );

  const totalInformation = totalAnswerMI;
  const informationEfficiency = totalInformation > 0
    ? uniqueInformation / totalInformation
    : 0;

  // Estimate answer entropy with and without documents
  const baseEntropy = answerModel.estimateAnswerEntropy(query);
  const conditionalEntropy = answerModel.estimateAnswerEntropy(
    query,
    ...documents.map(d => d.document)
  );

  const entropyReduction = baseEntropy - conditionalEntropy;

  // Bottleneck optimality: high answer MI, low redundancy
  const bottleneckOptimality = computeBottleneckOptimality(
    totalAnswerMI,
    totalRedundancy,
    informationEfficiency
  );

  return {
    totalQueryMI,
    totalAnswerMI,
    totalRedundancy,
    informationEfficiency,
    conditionalAnswerEntropy: conditionalEntropy,
    entropyReduction,
    bottleneckOptimality,
  };
}
```

### 2.3 Information Gaps

```typescript
/**
 * A detected gap in the retrieved information.
 */
interface InformationGap {
  /** Unique identifier for this gap */
  id: string;

  /** Type of information gap */
  type: InformationGapType;

  /** Natural language description of the gap */
  description: string;

  /** What question is left unanswered? */
  unansweredQuestion: string;

  /** Estimated entropy of the gap (uncertainty) */
  gapEntropy: number;

  /** How critical is this gap for answering the query? */
  criticality: GapCriticality;

  /** Confidence that this gap exists (not a false positive) */
  detectionConfidence: number;

  /** Potential sources that might fill this gap */
  potentialSources: PotentialGapSource[];
}

type InformationGapType =
  | 'missing_definition'    // Referenced entity not defined
  | 'missing_implementation'// Interface without implementation
  | 'missing_caller'        // Function never called (dead code?)
  | 'missing_dependency'    // Import not found in retrieved set
  | 'missing_error_case'    // Happy path only, no error handling
  | 'missing_edge_case'     // Core logic only, no boundaries
  | 'missing_context'       // Code without surrounding context
  | 'missing_test'          // Implementation without test
  | 'missing_documentation' // Complex code without docs
  | 'temporal_gap'          // Old version, may be stale
  | 'conditional_gap';      // Branch not covered

type GapCriticality = 'critical' | 'high' | 'medium' | 'low';

interface PotentialGapSource {
  /** What kind of source might fill this gap */
  sourceType: 'file' | 'function' | 'class' | 'test' | 'documentation';

  /** Predicted name or path pattern */
  predictedPattern: string;

  /** Estimated probability this source exists */
  existsProbability: number;

  /** Estimated information gain if found */
  estimatedGain: number;
}
```

### 2.4 Gap-Adjusted Confidence

```typescript
/**
 * Confidence adjusted for detected information gaps.
 */
interface GapAdjustedConfidence {
  /** Raw confidence before gap adjustment */
  rawConfidence: number;

  /** Adjusted confidence after gap penalty */
  adjustedConfidence: number;

  /** Total gap penalty applied */
  gapPenalty: number;

  /** Breakdown of penalty by gap */
  penaltyBreakdown: GapPenaltyBreakdown[];

  /** Explanation of adjustment */
  explanation: string;
}

interface GapPenaltyBreakdown {
  /** The gap causing the penalty */
  gapId: string;

  /** Penalty amount (0-1) */
  penalty: number;

  /** Why this penalty was applied */
  reason: string;
}

/**
 * Compute gap-adjusted confidence.
 *
 * The principle: confidence should DECREASE when we know
 * we're missing information needed to answer the query.
 */
function computeGapAdjustedConfidence(
  rawConfidence: number,
  gaps: InformationGap[],
  gapWeights: GapWeightConfig
): GapAdjustedConfidence {
  let totalPenalty = 0;
  const penaltyBreakdown: GapPenaltyBreakdown[] = [];

  for (const gap of gaps) {
    // Penalty = criticality weight * gap entropy * detection confidence
    const criticalityWeight = gapWeights.criticality[gap.criticality];
    const penalty = criticalityWeight * gap.gapEntropy * gap.detectionConfidence;
    const clampedPenalty = Math.min(penalty, gapWeights.maxPenaltyPerGap);

    totalPenalty += clampedPenalty;
    penaltyBreakdown.push({
      gapId: gap.id,
      penalty: clampedPenalty,
      reason: `${gap.type}: ${gap.description}`,
    });
  }

  // Clamp total penalty to maximum
  const clampedTotalPenalty = Math.min(totalPenalty, gapWeights.maxTotalPenalty);

  // Apply penalty as multiplicative factor
  const adjustedConfidence = rawConfidence * (1 - clampedTotalPenalty);

  return {
    rawConfidence,
    adjustedConfidence,
    gapPenalty: clampedTotalPenalty,
    penaltyBreakdown,
    explanation: generateGapExplanation(gaps, clampedTotalPenalty),
  };
}

interface GapWeightConfig {
  criticality: {
    critical: number;  // e.g., 0.3
    high: number;      // e.g., 0.2
    medium: number;    // e.g., 0.1
    low: number;       // e.g., 0.05
  };
  maxPenaltyPerGap: number;   // e.g., 0.25
  maxTotalPenalty: number;    // e.g., 0.6
}
```

### 2.5 Gap Closure Suggestions

```typescript
/**
 * Suggestion for closing an information gap.
 */
interface GapClosureSuggestion {
  /** The gap this suggestion addresses */
  gapId: string;

  /** Type of suggestion */
  type: GapClosureType;

  /** Human-readable suggestion */
  suggestion: string;

  /** Specific query to retrieve gap-closing documents */
  retrievalQuery: string;

  /** Expected information gain if successful */
  expectedGain: number;

  /** Cost estimate (tokens, latency) */
  estimatedCost: RetrievalCost;

  /** Priority for execution */
  priority: number;
}

type GapClosureType =
  | 'additional_retrieval'   // Retrieve more documents
  | 'expand_context'         // Get surrounding code
  | 'follow_reference'       // Chase a reference
  | 'search_tests'           // Find related tests
  | 'search_documentation'   // Find related docs
  | 'temporal_update'        // Get newer version
  | 'ask_for_clarification'; // Need human input

interface RetrievalCost {
  estimatedTokens: number;
  estimatedLatencyMs: number;
  estimatedApiCalls: number;
}
```

---

## 3. Key Algorithms

### 3.1 Entropy-Based Gap Detection

```
ALGORITHM DetectInformationGaps(query, retrievedDocs):
  INPUT:
    - query: The user's question
    - retrievedDocs: Documents already retrieved
  OUTPUT:
    - gaps: List of detected information gaps

  1. PARSE query to identify required information:
     - entities: Functions, classes, files mentioned
     - relations: Calls, imports, inherits
     - properties: Type, behavior, error handling

  2. BUILD information coverage map:
     FOR each required entity/relation/property:
       coverage[item] = scan retrievedDocs for mentions
       IF coverage[item] is empty:
         ADD gap(type='missing_definition', item)
       ELSE IF coverage[item] is partial:
         ESTIMATE entropy of remaining uncertainty
         ADD gap(type='missing_context', entropy)

  3. DETECT structural gaps:
     FOR each function F mentioned:
       IF implementation(F) not in retrievedDocs:
         ADD gap(type='missing_implementation', F)
       IF callers(F) not in retrievedDocs AND query asks "who calls":
         ADD gap(type='missing_caller', F)
       IF error_handling(F) not in retrievedDocs:
         ADD gap(type='missing_error_case', F)

  4. DETECT temporal gaps:
     FOR each doc D in retrievedDocs:
       IF D.lastModified < threshold:
         ADD gap(type='temporal_gap', D, staleness)

  5. COMPUTE gap entropy for each gap:
     FOR each gap G:
       G.gapEntropy = estimateConditionalEntropy(
         query, retrievedDocs, G.unansweredQuestion
       )

  6. ASSIGN criticality based on query intent:
     IF query is "why" question:
       gaps about causation are CRITICAL
     IF query is "how" question:
       gaps about implementation are HIGH
     IF query is "what" question:
       gaps about definition are HIGH

  7. RETURN gaps sorted by criticality * entropy
```

### 3.2 Mutual Information Estimation

```
ALGORITHM EstimateMutualInformation(doc, query, answerModel):
  INPUT:
    - doc: A candidate document
    - query: The user's question
    - answerModel: Model for estimating answer distributions
  OUTPUT:
    - mi: Estimated mutual information I(doc; answer | query)

  1. ESTIMATE answer distribution without document:
     P(A | Q) = answerModel.getAnswerDistribution(query)
     H(A | Q) = entropy(P(A | Q))

  2. ESTIMATE answer distribution with document:
     P(A | Q, D) = answerModel.getAnswerDistribution(query, doc)
     H(A | Q, D) = entropy(P(A | Q, D))

  3. COMPUTE mutual information:
     I(D; A | Q) = H(A | Q) - H(A | Q, D)

  4. NORMALIZE to [0, 1]:
     mi = I(D; A | Q) / H(A | Q)  // Fraction of uncertainty resolved

  5. RETURN mi

NOTE: In practice, we approximate this using:
  - Embedding similarity as proxy for relevance
  - LLM confidence scores as proxy for uncertainty reduction
  - Coverage metrics as proxy for information content
```

### 3.3 Information Bottleneck Optimization

```
ALGORITHM OptimizeInformationBottleneck(candidates, query, budget, beta):
  INPUT:
    - candidates: All candidate documents
    - query: The user's question
    - budget: Maximum documents to retrieve
    - beta: Trade-off parameter (relevance vs compression)
  OUTPUT:
    - selected: Optimal document subset

  1. INITIALIZE:
     selected = []
     remaining = candidates

  2. COMPUTE baseline entropy:
     H_base = estimateAnswerEntropy(query)

  3. GREEDY selection with bottleneck objective:
     WHILE |selected| < budget AND remaining not empty:
       FOR each doc D in remaining:
         // Compute information gain (relevance)
         H_with = estimateAnswerEntropy(query, selected + [D])
         info_gain[D] = currentEntropy - H_with

         // Compute redundancy (compression cost)
         redundancy[D] = computeRedundancyWith(D, selected)

         // Bottleneck score: high gain, low redundancy
         score[D] = beta * info_gain[D] - redundancy[D]

       // Select document with highest bottleneck score
       best = argmax(score)
       IF score[best] <= 0:
         BREAK  // No more useful documents

       selected.add(best)
       remaining.remove(best)
       currentEntropy = H_with[best]

  4. RETURN selected
```

### 3.4 Gap Closure Planning

```
ALGORITHM PlanGapClosure(gaps, budget, retrievalEngine):
  INPUT:
    - gaps: Detected information gaps
    - budget: Maximum additional retrievals
    - retrievalEngine: Engine for retrieval
  OUTPUT:
    - plan: Ordered list of gap closure actions

  1. PRIORITIZE gaps:
     priority[gap] = gap.criticality * gap.gapEntropy * gap.detectionConfidence

  2. FOR each gap in priority order:
     IF budget exhausted:
       BREAK

     // Generate retrieval query for this gap
     query = generateGapClosureQuery(gap)

     // Estimate retrieval cost and gain
     candidates = retrievalEngine.preview(query, limit=3)
     estimatedGain = sum(estimateMI(c, gap.unansweredQuestion) for c in candidates)
     estimatedCost = estimateRetrievalCost(candidates)

     // Add to plan if cost-effective
     IF estimatedGain / estimatedCost.tokens > threshold:
       plan.add(GapClosureSuggestion(
         gapId: gap.id,
         type: 'additional_retrieval',
         query: query,
         expectedGain: estimatedGain,
         estimatedCost: estimatedCost,
         priority: priority[gap]
       ))
       budget -= 1

  3. RETURN plan sorted by priority
```

---

## 4. Rate-Distortion Theory Application

### 4.1 The Rate-Distortion Trade-off

In rate-distortion theory:
- **Rate (R)**: Bits needed to encode the retrieval (number of documents * complexity)
- **Distortion (D)**: Information loss about the answer

The optimal retrieval minimizes:
```
R + λ * D
```

Where λ balances compression against fidelity.

### 4.2 Distortion Metric

```typescript
/**
 * Compute retrieval distortion: how much answer information is lost?
 */
function computeDistortion(
  query: string,
  idealAnswer: Answer,
  retrievedDocs: ContextPack[],
  answerModel: IAnswerModel
): number {
  // Generate answer from retrieved docs
  const generatedAnswer = answerModel.generateAnswer(query, retrievedDocs);

  // Measure semantic distance from ideal
  const semanticDistance = computeSemanticDistance(idealAnswer, generatedAnswer);

  // Measure information loss
  const informationLoss = computeInformationLoss(idealAnswer, generatedAnswer);

  // Combined distortion metric
  return 0.5 * semanticDistance + 0.5 * informationLoss;
}

/**
 * Rate-distortion optimal retrieval.
 */
function rateDistortionRetrieval(
  candidates: ContextPack[],
  query: string,
  lambda: number,
  answerModel: IAnswerModel
): ContextPack[] {
  // Find the subset that minimizes R + lambda * D
  // This is NP-hard in general; we use greedy approximation

  const selected: ContextPack[] = [];
  let currentDistortion = 1.0; // Maximum distortion initially

  while (candidates.length > 0) {
    let bestCandidate: ContextPack | null = null;
    let bestImprovement = 0;

    for (const doc of candidates) {
      const newSet = [...selected, doc];
      const newDistortion = computeDistortion(query, null, newSet, answerModel);
      const distortionReduction = currentDistortion - newDistortion;
      const rateCost = estimateRate(doc);

      // Net improvement: distortion reduction minus rate cost
      const improvement = lambda * distortionReduction - rateCost;

      if (improvement > bestImprovement) {
        bestImprovement = improvement;
        bestCandidate = doc;
      }
    }

    if (bestCandidate === null || bestImprovement <= 0) {
      break; // No more beneficial additions
    }

    selected.push(bestCandidate);
    candidates = candidates.filter(c => c.id !== bestCandidate!.id);
    currentDistortion = computeDistortion(query, null, selected, answerModel);
  }

  return selected;
}
```

---

## 5. TDD Test Specifications

### 5.1 Tier-0 Tests (Deterministic)

| Test Case | Input | Expected Output |
|-----------|-------|-----------------|
| `mutual_information_positive` | Relevant doc + query | MI > 0 |
| `mutual_information_zero` | Irrelevant doc | MI approximately 0 |
| `redundancy_detection` | Two docs with same info | redundancy > 0.8 |
| `unique_contribution_calc` | Doc with unique info | uniqueContribution > redundancy |
| `gap_detection_missing_def` | Query refs undefined entity | gap.type = 'missing_definition' |
| `gap_detection_missing_impl` | Interface without impl | gap.type = 'missing_implementation' |
| `gap_entropy_ordering` | Multiple gaps | Higher criticality = higher entropy impact |
| `gap_penalty_clamp` | Many gaps | penalty <= maxTotalPenalty |
| `confidence_adjustment` | Raw conf + gaps | adjusted < raw |
| `bottleneck_score_calc` | Doc set | 0 <= score <= 1 |

### 5.2 Tier-1 Tests (Integration)

| Test Case | Scenario | Acceptance Criteria |
|-----------|----------|---------------------|
| `detects_missing_error_handling` | Query about function, no error docs | gap.type = 'missing_error_case' |
| `suggests_gap_closure` | Gap detected | suggestion.retrievalQuery is valid |
| `redundancy_reduces_rank` | Two similar docs | Second doc ranked lower |
| `bottleneck_beats_similarity` | Diverse vs redundant set | Bottleneck selects diverse |
| `gap_adjusted_confidence_calibrated` | Known gaps | Adjusted confidence matches empirical accuracy |

### 5.3 Tier-2 Tests (Live Validation)

| Test Case | Scenario | Acceptance Criteria |
|-----------|----------|---------------------|
| `bottleneck_correlates_recall` | 100 queries | Correlation r > 0.7 |
| `gap_detection_precision` | Human-labeled gaps | Precision > 0.8 |
| `gap_closure_improves_answer` | Execute suggestions | Answer quality improves |
| `real_codebase_gaps` | Production repo queries | Meaningful gaps detected |

### 5.4 BDD Scenarios

```gherkin
Feature: Information-Theoretic Retrieval
  As a LiBrainian system
  I want to analyze retrieval through an information-theoretic lens
  So that I can detect gaps, adjust confidence, and suggest improvements

  Scenario: Detecting missing implementation
    Given I have a query "How does UserService.authenticate work?"
    And the retrieval contains:
      | File | Content |
      | user-service.ts | Interface with authenticate() signature |
      | auth-types.ts | AuthResult type definition |
    But the retrieval does NOT contain the implementation
    When I analyze information gaps
    Then I detect a gap of type "missing_implementation"
    And the gap.unansweredQuestion is "What is the implementation of authenticate()?"
    And the gap.criticality is "high"

  Scenario: Gap-adjusted confidence
    Given I have raw confidence of 0.85
    And I detect 2 gaps:
      | Type | Criticality | Entropy |
      | missing_implementation | high | 0.6 |
      | missing_error_case | medium | 0.4 |
    When I compute gap-adjusted confidence
    Then the adjusted confidence is less than 0.85
    And the explanation mentions both gaps
    And the penalty breakdown shows both contributions

  Scenario: Redundancy detection
    Given I retrieve two documents:
      | Doc | Content |
      | auth.ts | function login(user, pass) { ... } |
      | auth-impl.ts | function login(user, pass) { ... } (copy) |
    When I compute mutual information
    Then the second document has high redundancy
    And the second document has low unique contribution
    And the bottleneck score penalizes the redundancy

  Scenario: Gap closure suggestion
    Given I detect a gap:
      | Field | Value |
      | type | missing_error_case |
      | description | No error handling for failed authentication |
      | potentialSources | error-handler.ts, auth-errors.ts |
    When I generate gap closure suggestions
    Then I get a suggestion with type "additional_retrieval"
    And the suggestion.retrievalQuery targets error handling
    And the suggestion.expectedGain is positive

  Scenario: Bottleneck optimization
    Given I have 10 candidate documents
    And some documents are highly redundant
    When I optimize using the information bottleneck
    Then I select a diverse subset
    And the selected set has high information efficiency
    And the selected set has low total redundancy
```

---

## 6. Integration Points

| Component | Integration | Direction |
|-----------|-------------|-----------|
| Evidence Ledger | Records gap detections and confidence adjustments | Writes |
| Query Engine | Receives information-ranked results | Reads |
| Confidence System | Receives gap-adjusted confidence | Provides |
| Retrieval Engine | Executes gap closure suggestions | Triggers |
| Calibration | Measures gap detection accuracy | Reads |
| Causal Retrieval | Combines causal and information metrics | Bidirectional |

---

## 7. Theoretical Foundations

### 7.1 Shannon's Source Coding Theorem

The minimum rate to encode a source with distortion D is given by the rate-distortion function R(D). Our retrieval problem is analogous:

- **Source**: The ideal answer
- **Encoding**: The retrieved document set
- **Distortion**: Information loss about the answer

### 7.2 The Information Bottleneck (Tishby 2000)

The IB method finds a compressed representation T of X that preserves information about Y:

```
min I(X; T) - β * I(T; Y)
```

Applied to retrieval:
- X = query
- T = retrieved documents
- Y = answer

### 7.3 Connection to Active Learning

Gap closure suggestions are a form of active learning: selecting the next "query" (retrieval) to maximize information gain about the answer.

---

## 8. Implementation Status

- [ ] Spec complete
- [ ] Tests written (Tier-0)
- [ ] Tests written (Tier-1)
- [ ] Tests written (Tier-2)
- [ ] Mutual information estimation implemented
- [ ] Gap detection algorithm implemented
- [ ] Gap-adjusted confidence implemented
- [ ] Gap closure suggestions implemented
- [ ] Information bottleneck optimization implemented
- [ ] Rate-distortion retrieval implemented
- [ ] Gate passed: Bottleneck correlates with recall (r > 0.7)

---

## Changelog

| Date | Change |
|------|--------|
| 2026-01-23 | Initial frontier specification |
