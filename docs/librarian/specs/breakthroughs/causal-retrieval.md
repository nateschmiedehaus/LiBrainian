# Causal Retrieval Specification

> **Version**: 1.0.0
> **Status**: DRAFT
> **Last Updated**: 2026-01-23
>
> **Theory Reference**: Based on Pearl's causal inference and information theory.

---

## Executive Summary

**Current retrieval**: "Retrieve documents similar to query"
**Causal retrieval**: "Retrieve documents CAUSALLY RELEVANT to answering query"

Document D is causally relevant if **modifying D would change the answer**. This is fundamentally different from semantic similarity - a document can be similar but causally irrelevant, or dissimilar but causally critical.

---

## 1. The Problem with Similarity-Based Retrieval

### 1.1 Similarity ≠ Relevance

```
Query: "Why does calculateTotal return NaN?"

Traditional retrieval (by similarity):
1. src/cart.ts - contains "calculateTotal" (0.95 similarity)
2. src/utils/math.ts - contains "NaN" and math (0.85 similarity)
3. src/tests/cart.test.ts - mentions calculateTotal (0.80 similarity)
4. docs/api.md - documents calculateTotal (0.75 similarity)

Causal retrieval (by causal relevance):
1. src/cart.ts:45 - The actual cause: missing parseFloat()
2. src/types/item.ts - Price type allows string inputs
3. src/cart.ts:42 - No input validation before calculation

The similar documents tell you ABOUT the problem.
The causally relevant documents tell you WHY the problem exists.
```

### 1.2 Causal Relevance Criterion

Document D is causally relevant to query Q if:
- **Intervention criterion**: Modifying D would change the answer to Q
- **Information criterion**: D contains information that could not be inferred from other retrieved documents
- **Counterfactual criterion**: Had D not existed, the answer would be different

---

## 2. Causal Relevance Model

### 2.1 Core Types

```typescript
/**
 * Causal relevance assessment for a document.
 */
interface CausalRelevance {
  /** The document being assessed */
  document: ContextPack;

  /** Information contribution to answering the query */
  informationContribution: InformationContribution;

  /** Would removing this document change the answer? */
  counterfactualImpact: CounterfactualImpact;

  /** Causal chain from query to this document */
  causalChain: CausalChainLink[];

  /** Overall causal relevance score */
  relevanceScore: number;

  /** Confidence in this assessment */
  confidence: ConfidenceValue;
}
```

### 2.2 Information Contribution

```typescript
/**
 * Information-theoretic measure of document contribution.
 */
interface InformationContribution {
  /** Mutual information between document and answer */
  mutualInformation: number;

  /** Information gain from including this document */
  informationGain: number;

  /** Redundancy with already-retrieved documents */
  redundancy: number;

  /** Unique information not available elsewhere */
  uniqueContribution: number;

  /** Expected answer entropy reduction */
  entropyReduction: number;
}

/**
 * Compute information contribution.
 *
 * I(A; D | Q) = H(A | Q) - H(A | Q, D)
 * where A = answer, D = document, Q = query
 */
function computeInformationContribution(
  document: ContextPack,
  query: string,
  alreadyRetrieved: ContextPack[],
  answerModel: IAnswerModel
): InformationContribution {
  // Entropy of answer given only the query
  const baseEntropy = answerModel.estimateAnswerEntropy(query);

  // Entropy of answer given query and this document
  const withDocEntropy = answerModel.estimateAnswerEntropy(query, document);

  // Entropy of answer given query and all retrieved
  const withAllEntropy = answerModel.estimateAnswerEntropy(query, ...alreadyRetrieved);

  // Entropy of answer given query, all retrieved, and this doc
  const withDocAndAllEntropy = answerModel.estimateAnswerEntropy(
    query,
    document,
    ...alreadyRetrieved
  );

  return {
    mutualInformation: baseEntropy - withDocEntropy,
    informationGain: withAllEntropy - withDocAndAllEntropy,
    redundancy: (baseEntropy - withDocEntropy) - (withAllEntropy - withDocAndAllEntropy),
    uniqueContribution: withAllEntropy - withDocAndAllEntropy,
    entropyReduction: baseEntropy - withDocAndAllEntropy,
  };
}
```

### 2.3 Counterfactual Impact

```typescript
/**
 * Counterfactual impact of a document on the answer.
 */
interface CounterfactualImpact {
  /** Would removing this document change the answer? */
  wouldChangeAnswer: boolean;

  /** Probability that answer would change */
  changeProb: number;

  /** Type of change expected */
  changeType: AnswerChangeType;

  /** Severity of the change */
  changeSeverity: ChangeSeverity;
}

type AnswerChangeType =
  | 'complete_change'    // Different answer entirely
  | 'partial_change'     // Some aspects change
  | 'confidence_change'  // Same answer, different confidence
  | 'no_change';         // Answer unaffected

type ChangeSeverity = 'critical' | 'significant' | 'minor' | 'negligible';

/**
 * Compute counterfactual impact.
 */
async function computeCounterfactualImpact(
  document: ContextPack,
  query: string,
  currentAnswer: Answer,
  answerModel: IAnswerModel
): Promise<CounterfactualImpact> {
  // Generate answer WITHOUT this document
  const answerWithout = await answerModel.generateAnswer(query, {
    exclude: [document.id],
  });

  // Compare answers
  const similarity = computeAnswerSimilarity(currentAnswer, answerWithout);

  return {
    wouldChangeAnswer: similarity < 0.9,
    changeProb: 1 - similarity,
    changeType: classifyChange(currentAnswer, answerWithout, similarity),
    changeSeverity: classifySeverity(1 - similarity),
  };
}
```

### 2.4 Causal Chain

```typescript
/**
 * A link in the causal chain from query to document.
 */
interface CausalChainLink {
  /** Starting point of this link */
  from: CausalNode;

  /** Ending point of this link */
  to: CausalNode;

  /** Type of causal relationship */
  relationship: CausalRelationship;

  /** Strength of the causal link */
  strength: number;

  /** Evidence for this link */
  evidence: string;
}

interface CausalNode {
  type: 'query' | 'concept' | 'entity' | 'document';
  id: string;
  label: string;
}

type CausalRelationship =
  | 'answers'           // Document answers query
  | 'defines'           // Document defines concept in query
  | 'implements'        // Document implements referenced function
  | 'calls'             // Document calls referenced entity
  | 'modifies'          // Document modifies referenced state
  | 'constrains'        // Document constrains possible answers
  | 'contextualizes';   // Document provides context for query
```

---

## 3. Causal Retriever

### 3.1 Interface

```typescript
/**
 * Retrieves documents based on causal relevance, not just similarity.
 */
interface ICausalRetriever {
  /**
   * Retrieve causally relevant documents for a query.
   */
  retrieve(
    query: string,
    options: CausalRetrievalOptions
  ): Promise<CausalRetrievalResult>;

  /**
   * Assess causal relevance of a specific document.
   */
  assessRelevance(
    document: ContextPack,
    query: string,
    context: RetrievalContext
  ): Promise<CausalRelevance>;

  /**
   * Explain why a document was/wasn't retrieved.
   */
  explainRetrieval(
    query: string,
    document: ContextPack,
    wasRetrieved: boolean
  ): Promise<RetrievalExplanation>;
}

interface CausalRetrievalOptions {
  /** Maximum documents to retrieve */
  maxDocs: number;

  /** Minimum causal relevance score */
  minRelevance: number;

  /** Weight for different relevance components */
  weights: {
    informationContribution: number;
    counterfactualImpact: number;
    causalChainStrength: number;
  };

  /** Whether to include explanation for each document */
  includeExplanations: boolean;

  /** Retrieval mode */
  mode: 'balanced' | 'precision' | 'recall';
}

interface CausalRetrievalResult {
  /** Retrieved documents ranked by causal relevance */
  documents: RankedCausalDocument[];

  /** Total documents considered */
  totalConsidered: number;

  /** Retrieval metadata */
  metadata: {
    queryAnalysis: QueryAnalysis;
    retrievalStrategy: string;
    confidenceInCompleteness: ConfidenceValue;
  };
}

interface RankedCausalDocument {
  document: ContextPack;
  relevance: CausalRelevance;
  rank: number;
  explanation?: string;
}
```

### 3.2 Retrieval Algorithm

```
ALGORITHM CausalRetrieve(query, options):
  1. PARSE query to identify:
     - Subject entities (functions, classes, files)
     - Query intent (why, how, what)
     - Expected answer type

  2. BUILD initial candidate set:
     a. Semantic search (broad recall)
     b. Structural search (entity references)
     c. Graph traversal (dependencies)

  3. FOR each candidate document D:
     a. COMPUTE information contribution
        - How much does D reduce answer entropy?
        - How much unique information does D have?
     b. COMPUTE counterfactual impact
        - Would answer change without D?
     c. TRACE causal chain from query to D
     d. COMBINE into causal relevance score

  4. RANK candidates by causal relevance

  5. APPLY diversity filter:
     - Remove redundant documents
     - Ensure coverage of causal factors

  6. RETURN top-k with explanations
```

---

## 4. Comparison to Similarity Retrieval

### 4.1 When Causal Retrieval Wins

| Scenario | Similarity | Causal | Winner |
|----------|------------|--------|--------|
| "Why does X fail?" | Similar error messages | Actual cause | Causal |
| "How does X work?" | API docs | Implementation | Both |
| "What calls X?" | Files mentioning X | Actual callers | Causal |
| "Is X thread-safe?" | Threading docs | X's implementation + deps | Causal |

### 4.2 Performance Expectations

The plan specifies: **Causal retrieval > similarity by 15%+**

Measurement:
- Ground truth answers for 100 queries
- Human-judged relevance of retrieved documents
- Compare MAP@10 (Mean Average Precision)

---

## 5. TDD Test Specifications

### 5.1 Tier-0 Tests (Deterministic)

| Test Case | Input | Expected Output |
|-----------|-------|-----------------|
| `information_gain_positive` | Relevant doc | Gain > 0 |
| `information_gain_zero` | Redundant doc | Gain ≈ 0 |
| `counterfactual_detected` | Causal doc | wouldChangeAnswer: true |
| `causal_chain_built` | Query + doc | Valid chain |
| `ranking_by_relevance` | Multiple docs | Sorted by relevance |
| `diversity_filter_works` | Redundant set | Reduced set |

### 5.2 Tier-1 Tests (Integration)

| Test Case | Scenario | Acceptance Criteria |
|-----------|----------|---------------------|
| `retrieves_cause_not_symptom` | Error query | Cause ranked higher |
| `handles_multi_file_cause` | Distributed bug | All relevant files retrieved |
| `explains_retrieval` | Any query | Clear explanation provided |

### 5.3 Tier-2 Tests (Live)

| Test Case | Scenario | Acceptance Criteria |
|-----------|----------|---------------------|
| `causal_beats_similarity` | 100 queries | MAP@10 15%+ better |
| `real_codebase_retrieval` | Large repo | Relevant docs in top 10 |

### 5.4 BDD Scenarios

```gherkin
Feature: Causal Retrieval
  As a LiBrainian system
  I want to retrieve causally relevant documents
  So that I can answer queries with actual causes, not just similar text

  Scenario: Finding the cause of a bug
    Given I have a query "Why does calculateTotal return NaN?"
    And the codebase has:
      | File | Content |
      | src/cart.ts | Missing parseFloat() at line 45 |
      | docs/api.md | Documentation mentioning calculateTotal |
    When I perform causal retrieval
    Then src/cart.ts:45 is ranked higher than docs/api.md
    And the explanation mentions "missing type conversion"

  Scenario: Avoiding redundant retrieval
    Given I have already retrieved doc A with information X
    And doc B also contains information X
    When I consider doc B for retrieval
    Then doc B has low information gain due to redundancy
    And doc B is filtered out or ranked lower

  Scenario: Building causal chains
    Given a query "What happens when user clicks Submit?"
    When I trace the causal chain
    Then I get a chain:
      | From | To | Relationship |
      | Query | onClick handler | implements |
      | onClick | validateForm | calls |
      | validateForm | submitAPI | calls |
```

---

## 6. Integration Points

| Component | Integration | Direction |
|-----------|-------------|-----------|
| Evidence Ledger | Records retrieval decisions | Writes |
| Query Engine | Provides retrieval results | Reads |
| Causal Model | Provides causal structure | Reads |
| Calibration | Measures retrieval quality | Reads |

---

## 7. Implementation Status

- [ ] Spec complete
- [ ] Tests written (Tier-0)
- [ ] Tests written (Tier-1)
- [ ] Tests written (Tier-2)
- [ ] Information contribution implemented
- [ ] Counterfactual impact implemented
- [ ] Causal chain builder implemented
- [ ] Gate passed: 15%+ improvement over similarity

---

## Changelog

| Date | Change |
|------|--------|
| 2026-01-23 | Initial specification |
