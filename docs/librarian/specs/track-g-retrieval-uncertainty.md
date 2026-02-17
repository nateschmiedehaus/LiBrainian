# Track G: Retrieval Uncertainty Quantification

> **Source**: THEORETICAL_CRITIQUE.md, Problem 2 (RAG Information Bottleneck)
>
> **Purpose**: Address the fundamental information-theoretic limit of RAG: retrieval is lossy compression, and the system must account for what it didn't retrieve.
>
> **Core Problem**: "Retrieval is lossy compression; system doesn't know what it didn't retrieve."
>
> **LiBrainian Story**: Chapter 6 (The Uncertainty) - This acknowledges retrieval's inherent limitations.

---

## Problem Statement

### The Fundamental Limitation

LiBrainian is sophisticated RAG (Retrieval-Augmented Generation), but RAG has a fundamental information-theoretic limit: **retrieval is a lossy compression**.

If relevant context wasn't retrieved, synthesis cannot recover it. The system can only reason about what was retrieved. This creates:

1. **Silent omission**: The system doesn't know what it didn't retrieve
2. **Confident incompleteness**: High confidence on incomplete context
3. **Irreducible error floor**: No amount of synthesis improvement helps

### Why This Matters

| Affected System | How Compromised |
|----------------|-----------------|
| Confidence scoring | Overstates confidence (doesn't account for retrieval gaps) |
| Agent decision-making | Acts on incomplete context without knowing |
| Verification | Cannot verify claims about un-retrieved code |
| Learning | Misattributes failures (blamed synthesis when retrieval failed) |

### The Unknown Unknowns Problem

Traditional confidence only accounts for:
- Quality of retrieved documents
- Confidence in synthesis
- Temporal decay of knowledge

It does NOT account for:
- Documents that exist but weren't retrieved
- Relevant code in unsearched parts of the corpus
- Query formulations that would have found better results
- Semantic gaps between query and relevant content

**This is an epistemological blind spot.** The system is overconfident because it doesn't know what it doesn't know.

---

## Core Interfaces

### RetrievalResult

```typescript
/**
 * Complete retrieval result with uncertainty quantification.
 *
 * INVARIANT: Every retrieval must quantify its own incompleteness.
 * This is the foundation for honest confidence propagation.
 */
interface RetrievalResult {
  /** The documents actually retrieved */
  documents: ContextPack[];

  /** Estimated probability that something relevant was missed */
  missRate: number;

  /** Query variations that were tried */
  queryExpansions: QueryExpansion[];

  /** Estimated fraction of relevant corpus actually searched */
  coverageEstimate: number;

  /** Confidence in the retrieval process itself */
  retrievalConfidence: ConfidenceValue;
}

interface QueryExpansion {
  /** Original query */
  original: string;

  /** Expanded/reformulated query */
  expanded: string;

  /** Expansion strategy used */
  strategy: QueryExpansionStrategy;

  /** Results from this expansion */
  resultCount: number;

  /** Whether this expansion found unique results */
  foundUniqueResults: boolean;
}

type QueryExpansionStrategy =
  | 'synonym'           // WordNet/embedding-based synonym expansion
  | 'hypernym'          // Generalization (e.g., "auth" -> "security")
  | 'hyponym'           // Specialization (e.g., "auth" -> "OAuth")
  | 'related_concept'   // Semantically related (e.g., "auth" -> "session")
  | 'code_pattern'      // Code-specific patterns (e.g., function names)
  | 'negative_sampling' // What ISN'T this? (contrastive)
  | 'reformulation';    // Complete query rewrite
```

### RetrievalUncertainty

```typescript
/**
 * Quantified uncertainty about what was NOT retrieved.
 *
 * This is the key innovation: explicitly modeling the unknown unknowns.
 */
interface RetrievalUncertainty {
  /**
   * Estimated recall: P(retrieved | relevant)
   *
   * Computed from:
   * - Query-embedding similarity distribution (fat tail = low recall)
   * - Number of near-threshold results
   * - Historical recall rates for similar queries
   *
   * CONFIDENCE: { type: 'absent', reason: 'uncalibrated' }
   * Until we have ground-truth recall measurements from human evaluation.
   */
  estimatedRecall: ConfidenceValue;

  /**
   * Query difficulty: How hard is this query to answer?
   *
   * Computed from:
   * - Query embedding dispersion in semantic space
   * - Number of distinct concepts in query
   * - Historical difficulty for similar queries
   *
   * CONFIDENCE: { type: 'absent', reason: 'uncalibrated' }
   */
  queryDifficulty: ConfidenceValue;

  /**
   * Corpus coverage: What fraction of the corpus is searchable?
   *
   * Computed from:
   * - Index freshness (% of files indexed)
   * - Chunking coverage (% of code in chunks)
   * - Embedding quality (% successfully embedded)
   *
   * CONFIDENCE: { type: 'deterministic', value: <computed>, reason: 'index_metadata' }
   * This CAN be deterministic because it's derived from index statistics.
   */
  corpusCoverage: ConfidenceValue;

  /**
   * Semantic gaps: Areas where the query might not match relevant content.
   *
   * Examples:
   * - Query uses "auth" but code uses "authentication"
   * - Query is about concept not explicitly named in code
   * - Query crosses module boundaries not captured by chunking
   */
  semanticGaps: SemanticGap[];
}

interface SemanticGap {
  /** Description of the gap */
  description: string;

  /** Severity: how much might this affect recall? */
  severity: 'low' | 'medium' | 'high';

  /** Mitigation: what expansion strategy could help? */
  mitigation: QueryExpansionStrategy;

  /**
   * Estimated probability that this gap caused a miss.
   *
   * CONFIDENCE: { type: 'absent', reason: 'uncalibrated' }
   */
  missLikelihood: ConfidenceValue;
}
```

---

## Iterative Retrieval Loop

### Algorithm

The iterative retrieval loop expands queries when initial retrieval is insufficient:

```typescript
/**
 * Iterative retrieval with uncertainty-driven expansion.
 *
 * ALGORITHM:
 * 1. Initial retrieval with uncertainty estimation
 * 2. If estimatedRecall below threshold, expand query
 * 3. Merge results, recompute uncertainty
 * 4. Repeat until confidence threshold met OR expansion budget exhausted
 * 5. Return with honest uncertainty bounds
 */
async function iterativeRetrieve(
  query: string,
  options: IterativeRetrievalOptions
): Promise<RetrievalResult> {
  const {
    minRecall = 0.7,
    maxIterations = 3,
    expansionBudget = 5,
    strategies = ['synonym', 'related_concept', 'code_pattern'],
  } = options;

  let currentResult = await initialRetrieve(query);
  let iteration = 0;
  let expansionsUsed = 0;

  while (
    getNumericValue(currentResult.retrievalConfidence) < minRecall &&
    iteration < maxIterations &&
    expansionsUsed < expansionBudget
  ) {
    // Identify highest-impact expansion strategy
    const uncertainty = computeUncertainty(currentResult);
    const bestStrategy = selectExpansionStrategy(uncertainty, strategies);

    if (!bestStrategy) {
      // No viable expansion strategies remain
      break;
    }

    // Expand query using selected strategy
    const expandedQuery = await expandQuery(query, bestStrategy);
    const expansionResult = await retrieveWithExpansion(expandedQuery);

    // Merge results
    currentResult = mergeRetrievalResults(currentResult, expansionResult);

    iteration++;
    expansionsUsed++;
  }

  // Final uncertainty computation
  currentResult.retrievalConfidence = computeFinalConfidence(currentResult);

  return currentResult;
}

interface IterativeRetrievalOptions {
  /** Minimum acceptable estimated recall */
  minRecall?: number;

  /** Maximum retrieval iterations */
  maxIterations?: number;

  /** Maximum query expansions to try */
  expansionBudget?: number;

  /** Strategies to consider */
  strategies?: QueryExpansionStrategy[];
}
```

### Expansion Strategy Selection

```typescript
/**
 * Select the highest-impact expansion strategy based on uncertainty analysis.
 *
 * PRINCIPLE: Target the largest semantic gap first.
 */
function selectExpansionStrategy(
  uncertainty: RetrievalUncertainty,
  available: QueryExpansionStrategy[]
): QueryExpansionStrategy | null {
  // Sort gaps by severity and miss likelihood
  const sortedGaps = [...uncertainty.semanticGaps].sort((a, b) => {
    const severityOrder = { high: 0, medium: 1, low: 2 };
    return severityOrder[a.severity] - severityOrder[b.severity];
  });

  // Find first gap with an available mitigation strategy
  for (const gap of sortedGaps) {
    if (available.includes(gap.mitigation)) {
      return gap.mitigation;
    }
  }

  // No targeted strategy available; use general expansion
  if (available.includes('reformulation')) {
    return 'reformulation';
  }

  return null;
}
```

---

## Conservative Confidence Formula

### The Core Formula

The fundamental insight: **synthesis confidence must be discounted by retrieval uncertainty**.

```typescript
/**
 * Compute final confidence accounting for retrieval uncertainty.
 *
 * FORMULA: final_confidence = synthesis_confidence * (1 - estimatedMissRate)
 *
 * RATIONALE:
 * - If synthesis is 90% confident but we estimate 30% of relevant content was missed,
 *   our final confidence should be 90% * 70% = 63%
 * - This creates honest confidence that accounts for retrieval limitations
 *
 * CONFIDENCE TYPE: { type: 'derived', formula: 'synthesis * (1 - missRate)', inputs: [...] }
 */
function computeFinalConfidence(
  synthesisConfidence: ConfidenceValue,
  retrievalResult: RetrievalResult
): ConfidenceValue {
  const synthValue = getNumericValue(synthesisConfidence);
  const missRate = retrievalResult.missRate;

  const finalValue = synthValue * (1 - missRate);

  return {
    type: 'derived',
    value: finalValue,
    formula: 'synthesis_confidence * (1 - estimated_miss_rate)',
    inputs: [
      { name: 'synthesis_confidence', confidence: synthesisConfidence },
      {
        name: 'retrieval_miss_rate',
        confidence: {
          type: 'absent',
          reason: 'uncalibrated' as const,
        },
      },
    ],
  };
}
```

### Miss Rate Computation

```typescript
/**
 * Estimate the probability that relevant content was missed.
 *
 * SIGNALS:
 * 1. Query-embedding similarity distribution (fat tail = high miss rate)
 * 2. Number of near-threshold results (many = borderline content exists)
 * 3. Historical miss rates for similar queries
 * 4. Semantic gap analysis
 *
 * CONFIDENCE: { type: 'absent', reason: 'uncalibrated' }
 * This is a heuristic estimate until we have ground-truth calibration data.
 */
function estimateMissRate(
  query: string,
  documents: ContextPack[],
  similarityScores: number[],
  historicalData?: MissRateHistory
): number {
  // Signal 1: Fat tail in similarity distribution
  const tailDensity = computeTailDensity(similarityScores);

  // Signal 2: Near-threshold results
  const nearThresholdCount = similarityScores.filter(
    s => s > 0.3 && s < 0.5  // Borderline relevant
  ).length;
  const nearThresholdSignal = Math.min(nearThresholdCount / 10, 0.3);

  // Signal 3: Historical miss rate (if available)
  const historicalSignal = historicalData
    ? historicalData.getMissRateForSimilarQuery(query)
    : 0.3;  // Default assumption: 30% miss rate

  // Signal 4: Query complexity penalty
  const queryComplexity = estimateQueryComplexity(query);
  const complexityPenalty = queryComplexity * 0.1;

  // Combine signals (weights are placeholders - need calibration)
  const combinedMissRate = Math.min(
    0.9,  // Cap at 90% miss rate
    tailDensity * 0.3 +
    nearThresholdSignal +
    historicalSignal * 0.3 +
    complexityPenalty
  );

  return combinedMissRate;
}

/**
 * Compute tail density of similarity distribution.
 *
 * A "fat tail" indicates many documents with moderate similarity,
 * suggesting relevant content may exist just below the threshold.
 */
function computeTailDensity(scores: number[]): number {
  if (scores.length === 0) return 0.5;

  const threshold = 0.5;
  const tailStart = 0.3;

  const tailScores = scores.filter(s => s >= tailStart && s < threshold);
  const tailDensity = tailScores.length / scores.length;

  // Normalize to [0, 0.5] range
  return Math.min(tailDensity, 0.5);
}
```

---

## Query Expansion Strategies

### Strategy Implementations

```typescript
/**
 * Synonym expansion using embedding similarity.
 */
async function expandWithSynonyms(
  query: string,
  embeddingService: EmbeddingService
): Promise<string[]> {
  const queryEmbedding = await embeddingService.embed(query);
  const synonyms = await embeddingService.findSimilarTerms(
    queryEmbedding,
    { limit: 5, minSimilarity: 0.7 }
  );

  return synonyms.map(s =>
    query.replace(new RegExp(`\\b${escapeRegex(s.original)}\\b`, 'gi'), s.synonym)
  );
}

/**
 * Related concept expansion using knowledge graph or LLM.
 */
async function expandWithRelatedConcepts(
  query: string,
  llm: LlmAdapter
): Promise<string[]> {
  const prompt = `Given this code search query: "${query}"

List 3-5 related concepts that might appear in code but use different terminology.
Format: one concept per line, no explanations.`;

  const response = await llm.complete(prompt, { maxTokens: 100 });
  const concepts = response.trim().split('\n').filter(Boolean);

  return concepts.map(concept => `${query} OR ${concept}`);
}

/**
 * Code pattern expansion: function names, class names, common patterns.
 */
function expandWithCodePatterns(query: string): string[] {
  const patterns: string[] = [];

  // Function name patterns
  patterns.push(`function.*${query}`);
  patterns.push(`${query}.*\\(`);

  // Class/type patterns
  const pascalCase = query.charAt(0).toUpperCase() + query.slice(1);
  patterns.push(`class ${pascalCase}`);
  patterns.push(`interface ${pascalCase}`);
  patterns.push(`type ${pascalCase}`);

  // Import patterns
  patterns.push(`import.*${query}`);
  patterns.push(`from.*${query}`);

  return patterns;
}

/**
 * Negative sampling: what is this query NOT about?
 *
 * RATIONALE: Contrastive queries help refine retrieval by excluding
 * false positives, improving precision without sacrificing recall.
 */
async function expandWithNegativeSampling(
  query: string,
  documents: ContextPack[],
  llm: LlmAdapter
): Promise<string> {
  const docSummaries = documents.slice(0, 3).map(d => d.summary).join('\n');

  const prompt = `Query: "${query}"

Retrieved documents contain:
${docSummaries}

What concepts should be EXCLUDED to improve relevance?
List 2-3 exclusion terms.`;

  const response = await llm.complete(prompt, { maxTokens: 50 });
  const exclusions = response.trim().split('\n').filter(Boolean);

  return `${query} NOT (${exclusions.join(' OR ')})`;
}
```

---

## Integration Points

### Integration with Track A: Core Pipeline (Query Stage)

Track G modifies the retrieval stage in the core pipeline (P2: Semantic Composition Selector):

```typescript
// In track-a-core-pipeline.md, P2 section

/**
 * Enhanced retrieval with uncertainty quantification.
 *
 * INTEGRATION: Replaces simple retrieval with iterative loop.
 */
async function retrieveWithUncertainty(
  intent: string,
  options: RetrievalOptions
): Promise<RetrievalResult> {
  // Use iterative retrieval from Track G
  const result = await iterativeRetrieve(intent, {
    minRecall: options.minConfidence ?? 0.7,
    maxIterations: options.maxIterations ?? 3,
    strategies: options.expansionStrategies ?? [
      'synonym',
      'related_concept',
      'code_pattern',
    ],
  });

  // Log retrieval uncertainty for learning
  await recordRetrievalUncertainty(intent, result);

  return result;
}
```

### Integration with Track D: Quantification (Confidence)

Track G provides the `retrievalConfidence` component for Track D's confidence derivation:

```typescript
// Reference: track-d-quantification.md

/**
 * Derive final answer confidence accounting for retrieval uncertainty.
 *
 * FORMULA: answer_confidence = synthesis_confidence * (1 - retrieval_miss_rate)
 *
 * This implements the conservative confidence formula from Track G.
 */
function deriveAnswerConfidence(
  synthesisResult: SynthesisResult,
  retrievalResult: RetrievalResult
): ConfidenceValue {
  // Get synthesis confidence (from Track D rules)
  const synthesisConfidence = synthesisResult.confidence;

  // Apply retrieval uncertainty discount (from Track G)
  return computeFinalConfidence(synthesisConfidence, retrievalResult);
}
```

### Integration with Track F: Calibration

Track G produces data for Track F calibration:

```typescript
// Reference: track-f-calibration.md

/**
 * Record retrieval outcome for calibration.
 *
 * INTEGRATION: Every retrieval contributes to miss rate calibration.
 */
async function recordRetrievalOutcome(
  retrievalId: string,
  outcome: {
    /** Did the agent succeed with this retrieval? */
    agentSuccess: boolean;

    /** Was the answer later found to be incomplete? */
    foundMissingContent: boolean;

    /** If incomplete, what was missed? */
    missedContent?: string;
  }
): Promise<void> {
  // Update miss rate calibration data
  await calibrationStore.recordOutcome({
    type: 'retrieval_miss_rate',
    claimId: retrievalId,
    statedMissRate: /* from original retrieval */,
    actualMiss: outcome.foundMissingContent,
  });
}
```

---

## Implementation Roadmap

### Phase 1: Core Types and Interfaces (~150 LOC)

**Location**: `packages/LiBrainian/src/types/retrieval_uncertainty.ts`

**Deliverables**:
- `RetrievalResult` interface
- `RetrievalUncertainty` interface
- `QueryExpansion` and `SemanticGap` types
- Type guards and helpers

**Acceptance**:
- [ ] All interfaces exported and documented
- [ ] Type guards for each interface
- [ ] Integration with existing `ContextPack` type

### Phase 2: Miss Rate Estimation (~200 LOC)

**Location**: `packages/LiBrainian/src/retrieval/miss_rate.ts`

**Deliverables**:
- `estimateMissRate()` function
- `computeTailDensity()` helper
- `estimateQueryComplexity()` helper
- Historical miss rate storage integration

**Acceptance**:
- [ ] Miss rate computed for every retrieval
- [ ] All signals (tail density, near-threshold, historical) implemented
- [ ] Results logged for calibration
- [ ] Confidence marked as `{ type: 'absent', reason: 'uncalibrated' }`

### Phase 3: Query Expansion Strategies (~250 LOC)

**Location**: `packages/LiBrainian/src/retrieval/query_expansion.ts`

**Deliverables**:
- `expandWithSynonyms()` function
- `expandWithRelatedConcepts()` function
- `expandWithCodePatterns()` function
- `expandWithNegativeSampling()` function
- `selectExpansionStrategy()` function

**Acceptance**:
- [ ] At least 4 expansion strategies implemented
- [ ] Strategy selection based on semantic gap analysis
- [ ] Each expansion logged with results

### Phase 4: Iterative Retrieval Loop (~200 LOC)

**Location**: `packages/LiBrainian/src/retrieval/iterative_retrieval.ts`

**Deliverables**:
- `iterativeRetrieve()` function
- `mergeRetrievalResults()` helper
- `computeFinalConfidence()` function
- Iteration budget enforcement

**Acceptance**:
- [ ] Loop terminates on confidence threshold OR budget exhaustion
- [ ] Results merged without duplicates
- [ ] Final confidence uses conservative formula
- [ ] Iteration history available for debugging

### Phase 5: Pipeline Integration (~150 LOC)

**Location**: Updates to `packages/LiBrainian/src/api/LiBrainian.ts`

**Deliverables**:
- Replace simple retrieval with iterative retrieval
- Update confidence propagation
- Add uncertainty to response types
- Wire calibration recording

**Acceptance**:
- [ ] All LiBrainian queries use iterative retrieval
- [ ] Response includes `retrievalUncertainty` field
- [ ] Confidence accounts for miss rate
- [ ] Integration tests pass

### Phase 6: Tests (~300 LOC)

**Location**: `packages/LiBrainian/src/retrieval/__tests__/`

**Deliverables**:
- Unit tests for miss rate estimation
- Unit tests for query expansion
- Integration tests for iterative loop
- Calibration data recording tests

**Evidence Command**:
```bash
cd packages/LiBrainian && npx vitest src/retrieval/__tests__/
```

---

## Total Implementation Estimates

| Phase | Description | Est. LOC |
|-------|-------------|----------|
| **1** | Core types and interfaces | ~150 |
| **2** | Miss rate estimation | ~200 |
| **3** | Query expansion strategies | ~250 |
| **4** | Iterative retrieval loop | ~200 |
| **5** | Pipeline integration | ~150 |
| **6** | Tests | ~300 |
| **Total** | | **~1,250** |

---

## Confidence Values in This Spec

Per Track D principles, all confidence values in this spec must have explicit provenance:

| Value | Type | Reason |
|-------|------|--------|
| `estimatedRecall` | `{ type: 'absent', reason: 'uncalibrated' }` | No ground-truth recall data exists |
| `queryDifficulty` | `{ type: 'absent', reason: 'uncalibrated' }` | No difficulty calibration data exists |
| `corpusCoverage` | `{ type: 'deterministic', value: <computed>, reason: 'index_metadata' }` | Derived from index statistics |
| `missLikelihood` | `{ type: 'absent', reason: 'uncalibrated' }` | No calibration data exists |
| `retrievalConfidence` | `{ type: 'derived', formula: 'synthesis * (1 - missRate)', inputs: [...] }` | Computed from formula |

**Migration path**: As Track F calibration infrastructure collects outcome data, these `absent` values will be upgraded to `measured` values with empirical calibration.

---

## Success Criteria

| Requirement | Metric |
|-------------|--------|
| Miss rate estimation | Every retrieval includes `missRate` in result |
| Iterative expansion | Queries with low confidence trigger expansion |
| Conservative confidence | Final confidence < synthesis confidence when miss rate > 0 |
| Integration | LiBrainian responses include uncertainty quantification |
| Calibration readiness | Outcome recording wired for Track F |

---

## Relationship to Other Tracks

```
Track A (Core Pipeline) ──── Query stage uses iterative retrieval
       │
       v
Track G (Retrieval Uncertainty) ──── Quantifies retrieval completeness
       │
       v
Track D (Quantification) ──── Derives final confidence with uncertainty discount
       │
       v
Track F (Calibration) ──── Calibrates miss rate estimates from outcomes
```

---

## Summary

Track G addresses the fundamental information bottleneck of RAG systems by:

1. **Acknowledging the problem**: Retrieval is inherently lossy; we can't know what we didn't retrieve
2. **Quantifying uncertainty**: Estimate miss rate from multiple signals
3. **Iterating to improve**: Expand queries when initial retrieval is insufficient
4. **Propagating honestly**: Discount synthesis confidence by retrieval uncertainty
5. **Enabling calibration**: Record outcomes for empirical improvement

Without Track G, LiBrainian's confidence is overconfident - it doesn't account for what it didn't retrieve. With Track G, confidence honestly reflects both synthesis quality AND retrieval completeness.

**The conservative confidence formula is the key insight**: `final_confidence = synthesis_confidence * (1 - estimatedMissRate)`. This ensures that even excellent synthesis cannot compensate for poor retrieval.
