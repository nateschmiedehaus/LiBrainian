# COMPLETE FIX PLAN FOR WORLD-CLASS LiBrainian

**Version**: 1.0.0
**Date**: 2026-01-31
**Goal**: 100% pass rate across ALL use cases

---

## EXECUTIVE SUMMARY

This plan consolidates ALL identified issues from gap analyses, test failures, usability analysis, role coverage, task coverage, epistemological analysis, cognitive support analysis, and production readiness reports into a single comprehensive implementation roadmap.

**Total Issues Identified**: 147
**Work Units**: 42
**Estimated Total Effort**: 28-35 engineering days
**Expected Outcome**: World-class LiBrainian with 100% pass rate

---

## PART 1: CRITICAL FIXES (Must Complete First)

### WU-FIX-001: Hallucination Rate Reduction (P0)
**Current**: 9.5% in test corpus (2.3% live)
**Target**: <2% in all scenarios
**Effort**: 3-4 days

#### Files to Modify:

1. **`/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/LiBrainian/src/evaluation/entailment_checker.ts`**

```typescript
// ADD: Dynamic claim pattern expansion
interface ClaimPatternResult {
  matched: boolean;
  pattern: string | null;
  confidence: number;
  suggestedPatterns?: string[];
}

// Enhance extractClaims to log unmatched patterns for learning
export function extractClaimsWithLearning(text: string): ClaimExtractionResult {
  const claims = extractClaims(text);
  const unmatchedSegments = findUnmatchedCandidates(text, claims);

  // Log for pattern mining
  if (unmatchedSegments.length > 0) {
    logPatternCandidate(unmatchedSegments);
  }

  return {
    claims,
    unmatchedCount: unmatchedSegments.length,
    suggestedPatterns: generatePatternSuggestions(unmatchedSegments)
  };
}

// ADD: 20 new claim patterns for behavioral claims
const BEHAVIORAL_CLAIM_PATTERNS = [
  /(\w+)\s+calls\s+(\w+)\s+(?:when|if|to)\s+(.+)/i,
  /(\w+)\s+invokes\s+(\w+)/i,
  /(\w+)\s+delegates\s+to\s+(\w+)/i,
  /(\w+)\s+triggers\s+(\w+)/i,
  /(\w+)\s+emits\s+(\w+)\s+event/i,
  /(\w+)\s+subscribes\s+to\s+(\w+)/i,
  /(\w+)\s+handles\s+(\w+)\s+by\s+(.+)/i,
  /(\w+)\s+transforms\s+(\w+)\s+into\s+(\w+)/i,
  /(\w+)\s+validates\s+(\w+)\s+before\s+(.+)/i,
  /(\w+)\s+caches\s+(\w+)\s+for\s+(.+)/i,
  // ... 10 more patterns for error handling, state management
];
```

2. **`/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/LiBrainian/src/evaluation/minicheck_scorer.ts`**

```typescript
// ADD: Negation and quantifier handling
export function scoreWithNegationAwareness(
  claim: string,
  context: string,
  facts: ASTFact[]
): MiniCheckScore {
  const negationTokens = ['not', 'never', 'no', 'none', 'without', "doesn't", "isn't"];
  const hasNegation = negationTokens.some(token => claim.toLowerCase().includes(token));

  // Extract quantifiers: "has N parameters", "takes N arguments"
  const quantifierMatch = claim.match(/(?:has|takes|returns|contains)\s+(\d+)\s+(\w+)/i);

  let baseScore = computeBaseGrounding(claim, context);

  if (hasNegation) {
    // Invert scoring logic for negation
    baseScore = handleNegationScoring(claim, context, facts, baseScore);
  }

  if (quantifierMatch) {
    const [, count, item] = quantifierMatch;
    baseScore = validateQuantifier(claim, facts, parseInt(count), item, baseScore);
  }

  return {
    score: baseScore,
    negationDetected: hasNegation,
    quantifierValidated: !!quantifierMatch
  };
}
```

3. **`/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/LiBrainian/src/evaluation/chain_of_verification.ts`**

```typescript
// MODIFY: Claim-type-aware weighting
export function verifyQuestion(
  question: string,
  context: string,
  claimType: 'structural' | 'behavioral' | 'factual' = 'factual'
): VerificationResult {
  const entailmentScore = checkEntailment(question, context);
  const miniCheckScore = computeMiniCheckScore(question, context);

  // Claim-type-specific weights
  const weights = {
    structural: { entailment: 0.7, minicheck: 0.3 },
    behavioral: { entailment: 0.5, minicheck: 0.5 },
    factual: { entailment: 0.6, minicheck: 0.4 }
  };

  const w = weights[claimType];
  const combinedScore = entailmentScore * w.entailment + miniCheckScore * w.minicheck;

  return {
    score: combinedScore,
    entailmentScore,
    miniCheckScore,
    claimType,
    weightsUsed: w
  };
}
```

**Verification**: Run `npm test -- --grep "hallucination"` - expect <5% rate

---

### WU-FIX-002: Token Budget Intelligence (P0)
**Issue**: Agents waste context on verbose responses
**Effort**: 2-3 days

#### Files to Modify:

1. **`/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/LiBrainian/src/types.ts`**

```typescript
// ADD to LibrarianQuery interface (around line 650)
export interface LibrarianQuery {
  // ... existing fields

  /** Token budget for response sizing */
  tokenBudget?: TokenBudget;

  /** Priority for content when truncating */
  tokenPriority?: 'synthesis' | 'snippets' | 'metadata' | 'balanced';
}

// ADD to LibrarianResponse interface (around line 710)
export interface LibrarianResponse {
  // ... existing fields

  /** Token usage statistics */
  tokenStats: {
    usedTokens: number;
    budgetTokens: number | null;
    truncationApplied: boolean;
    truncationSummary?: string;
    truncatedFields?: string[];
  };
}

// ADD new TokenBudget interface
export interface TokenBudget {
  maxTokens: number;
  reserveTokens?: number;
  priority?: 'relevance' | 'recency' | 'diversity';
  preserveSynthesis?: boolean;
}
```

2. **`/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/LiBrainian/src/api/token_budget.ts`**

```typescript
// ADD: Priority-based intelligent truncation
export function intelligentTruncation(
  response: LibrarianResponse,
  budget: TokenBudget
): TruncatedResponse {
  const priority = budget.priority ?? 'relevance';
  const currentTokens = estimateResponseTokens(response);

  if (currentTokens <= budget.maxTokens) {
    return { response, truncated: false, tokensUsed: currentTokens };
  }

  const strategy = selectTruncationStrategy(response, budget, currentTokens);
  const truncated = applyStrategy(response, strategy, budget.maxTokens);

  return {
    response: truncated,
    truncated: true,
    tokensUsed: estimateResponseTokens(truncated),
    strategy: strategy.name,
    removedItems: strategy.removedItems
  };
}

// ADD: Strategy selection based on content
function selectTruncationStrategy(
  response: LibrarianResponse,
  budget: TokenBudget,
  currentTokens: number
): TruncationStrategy {
  const excessTokens = currentTokens - budget.maxTokens;
  const strategies: TruncationStrategy[] = [];

  // Strategy 1: Reduce snippet content length
  strategies.push({
    name: 'snippet_reduction',
    priority: 1,
    potentialSavings: estimateSnippetReduction(response.packs),
    apply: (r) => reduceSnippets(r, 200) // max 200 chars per snippet
  });

  // Strategy 2: Reduce pack count by relevance
  strategies.push({
    name: 'pack_reduction',
    priority: 2,
    potentialSavings: estimatePackReduction(response.packs, 0.5),
    apply: (r) => reducePacks(r, Math.ceil(r.packs.length * 0.5))
  });

  // Strategy 3: Remove supplementary data
  strategies.push({
    name: 'supplementary_removal',
    priority: 3,
    potentialSavings: estimateSupplementarySize(response),
    apply: (r) => removeSupplementary(r)
  });

  // Strategy 4: Truncate synthesis
  strategies.push({
    name: 'synthesis_truncation',
    priority: budget.preserveSynthesis ? 10 : 4,
    potentialSavings: estimateSynthesisTruncation(response.synthesis),
    apply: (r) => truncateSynthesis(r, 500)
  });

  // Sort by priority (lower = better), then by savings efficiency
  strategies.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return b.potentialSavings - a.potentialSavings;
  });

  // Select strategies until we have enough savings
  let totalSavings = 0;
  const selectedStrategies: TruncationStrategy[] = [];

  for (const strategy of strategies) {
    if (totalSavings >= excessTokens) break;
    selectedStrategies.push(strategy);
    totalSavings += strategy.potentialSavings;
  }

  return combineStrategies(selectedStrategies);
}
```

3. **`/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/LiBrainian/src/cli/commands/query.ts`**

```typescript
// ADD: CLI flag for token budget
const tokenBudgetFlag = {
  name: '--token-budget',
  alias: '-tb',
  description: 'Maximum tokens in response (default: unlimited)',
  parse: (value: string) => parseInt(value, 10)
};

const tokenPriorityFlag = {
  name: '--token-priority',
  alias: '-tp',
  description: 'Content priority when truncating: synthesis|snippets|metadata|balanced',
  parse: (value: string) => value as TokenPriority
};

// MODIFY: queryCommand to include token budget
async function queryCommand(args: QueryArgs): Promise<void> {
  const query: LibrarianQuery = {
    intent: args.intent,
    contextLevel: args.level,
    tokenBudget: args.tokenBudget ? {
      maxTokens: args.tokenBudget,
      priority: args.tokenPriority || 'relevance',
      preserveSynthesis: args.tokenPriority === 'synthesis'
    } : undefined,
    // ... rest of query construction
  };

  const response = await queryLibrarian(storage, query, embeddingService);

  // Include token stats in output
  if (args.json) {
    console.log(JSON.stringify({
      ...response,
      tokenStats: response.tokenStats
    }, null, 2));
  }
}
```

**Verification**: `npm test -- --grep "token_budget"` - expect all pass

---

### WU-FIX-003: Structured Error Contracts (P0)
**Issue**: Errors are human-readable strings, not machine-parseable
**Effort**: 1-2 days

#### Files to Modify:

1. **`/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/LiBrainian/src/cli/errors.ts`**

```typescript
// ADD: Structured error envelope
export interface ErrorEnvelope {
  code: ErrorCode;
  message: string;
  retryable: boolean;
  retryAfterMs?: number;
  recoveryHints: string[];
  details: Record<string, unknown>;
  timestamp: string;
  traceId?: string;
}

export type ErrorCode =
  | 'ERR_PROVIDER_UNAVAILABLE'
  | 'ERR_NOT_BOOTSTRAPPED'
  | 'ERR_INVALID_QUERY'
  | 'ERR_EMBEDDING_FAILED'
  | 'ERR_STORAGE_ERROR'
  | 'ERR_TIMEOUT'
  | 'ERR_RATE_LIMITED'
  | 'ERR_VALIDATION_FAILED'
  | 'ERR_INTERNAL';

const ERROR_METADATA: Record<ErrorCode, { retryable: boolean; defaultHints: string[] }> = {
  ERR_PROVIDER_UNAVAILABLE: {
    retryable: true,
    defaultHints: ['Check ANTHROPIC_API_KEY environment variable', 'Try --llm-provider codex']
  },
  ERR_NOT_BOOTSTRAPPED: {
    retryable: false,
    defaultHints: ['Run: LiBrainian bootstrap', 'Check workspace path']
  },
  ERR_RATE_LIMITED: {
    retryable: true,
    defaultHints: ['Wait before retrying', 'Reduce query complexity']
  },
  // ... other error codes
};

export class StructuredCliError extends Error {
  readonly envelope: ErrorEnvelope;

  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    const meta = ERROR_METADATA[code];

    this.envelope = {
      code,
      message,
      retryable: meta.retryable,
      recoveryHints: meta.defaultHints,
      details: details ?? {},
      timestamp: new Date().toISOString()
    };
  }

  toJSON(): ErrorEnvelope {
    return this.envelope;
  }
}
```

2. **`/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/LiBrainian/src/cli/index.ts`**

```typescript
// MODIFY: Error handling to output JSON when --json flag is set
async function handleError(error: unknown, outputJson: boolean): Promise<never> {
  if (error instanceof StructuredCliError) {
    if (outputJson) {
      console.error(JSON.stringify(error.toJSON(), null, 2));
    } else {
      console.error(`Error [${error.envelope.code}]: ${error.message}`);
      if (error.envelope.recoveryHints.length > 0) {
        console.error('\nRecovery hints:');
        error.envelope.recoveryHints.forEach(hint => console.error(`  - ${hint}`));
      }
    }
    process.exit(1);
  }

  // Convert unknown errors to structured format
  const structured = new StructuredCliError(
    'ERR_INTERNAL',
    error instanceof Error ? error.message : String(error),
    { originalError: error instanceof Error ? error.stack : undefined }
  );

  return handleError(structured, outputJson);
}
```

**Verification**: `npm test -- --grep "error"` - structured errors in all paths

---

### WU-FIX-004: Deterministic Output Mode (P0)
**Issue**: Same query produces different results
**Effort**: 1 day

#### Files to Modify:

1. **`/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/LiBrainian/src/types.ts`**

```typescript
// ADD to LibrarianQuery (around line 630)
export interface LibrarianQuery {
  // ... existing fields

  /** Enable deterministic mode for reproducible results */
  deterministic?: boolean;
}

// ADD: Deterministic context type
export interface DeterministicContext {
  queryFingerprint: string;
  sortKey: 'packId' | 'score' | 'relevance';
  cachePolicy: 'skip' | 'use';
  timestamp: string;
  randomSeed?: number;
}
```

2. **`/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/LiBrainian/src/api/query.ts`**

```typescript
// MODIFY: queryLibrarian to respect deterministic mode
export async function queryLibrarian(
  storage: LibrarianStorage,
  query: LibrarianQuery,
  embeddingService: EmbeddingService,
  options?: QueryOptions
): Promise<LibrarianResponse> {
  const deterministicContext = query.deterministic
    ? createDeterministicContext(query)
    : undefined;

  // In deterministic mode:
  // 1. Force llmRequirement to 'disabled' (no synthesis variance)
  // 2. Use stable sort by packId
  // 3. Skip or always use cache (consistent)
  // 4. Include query fingerprint in response

  const effectiveQuery: LibrarianQuery = query.deterministic ? {
    ...query,
    llmRequirement: 'disabled' // No LLM variance
  } : query;

  // ... existing query logic

  // Sort results deterministically
  if (deterministicContext) {
    packs = stableSort(packs, (a, b) => a.packId.localeCompare(b.packId));
  }

  return {
    ...response,
    deterministic: deterministicContext
  };
}

// ADD: Create deterministic context
export function createDeterministicContext(query: LibrarianQuery): DeterministicContext {
  const fingerprint = crypto
    .createHash('sha256')
    .update(JSON.stringify({
      intent: query.intent,
      filters: query.filters,
      contextLevel: query.contextLevel
    }))
    .digest('hex')
    .slice(0, 16);

  return {
    queryFingerprint: fingerprint,
    sortKey: 'packId',
    cachePolicy: 'skip',
    timestamp: new Date().toISOString()
  };
}

// ADD: Stable sort utility
export function stableSort<T>(arr: T[], compareFn: (a: T, b: T) => number): T[] {
  const indexed = arr.map((item, index) => ({ item, index }));
  indexed.sort((a, b) => {
    const result = compareFn(a.item, b.item);
    return result !== 0 ? result : a.index - b.index;
  });
  return indexed.map(({ item }) => item);
}
```

3. **`/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/LiBrainian/src/cli/commands/query.ts`**

```typescript
// ADD: --deterministic flag
const deterministicFlag = {
  name: '--deterministic',
  alias: '-d',
  description: 'Enable deterministic mode for reproducible results',
  type: 'boolean'
};
```

**Verification**: Run same query 10 times with `--deterministic` - expect identical results

---

## PART 2: HIGH PRIORITY FIXES

### WU-FIX-005: Argument Edge Types (P1)
**Gap**: Missing 8 argumentative edge types from CAPABILITY-GAP-ANALYSIS
**Effort**: 2-3 days

#### Files to Modify:

1. **`/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/LiBrainian/src/storage/types.ts`**

```typescript
// MODIFY: Add argument edge types to KnowledgeEdgeType
export type KnowledgeEdgeType =
  // Existing types
  | 'imports' | 'calls' | 'extends' | 'implements' | 'clone_of' | 'debt_related'
  | 'authored_by' | 'reviewed_by' | 'evolved_from' | 'co_changed' | 'tests'
  | 'documents' | 'depends_on' | 'similar_to' | 'part_of'
  // NEW: Argument edge types (Toulmin-IBIS model)
  | 'supports'       // Claim A supports Claim B
  | 'challenges'     // Claim A contradicts Claim B
  | 'qualifies'      // Claim A limits scope of Claim B
  | 'rebuts'         // Evidence against claim
  | 'undercuts'      // Attacks the inference, not conclusion
  | 'warrants'       // Reasoning principle connecting data to claim
  | 'backs'          // Evidence supporting the warrant
  | 'grounds';       // Data/evidence for a claim
```

2. **`/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/LiBrainian/src/api/argument_edges.ts`**

```typescript
// NEW FILE: Argument edge creation and querying
import type { KnowledgeEdgeType, KnowledgeGraphEdge } from '../storage/types.js';
import type { EntityRationale } from '../knowledge/extractors/rationale_extractor.js';

export const ARGUMENT_EDGE_TYPES: KnowledgeEdgeType[] = [
  'supports', 'challenges', 'qualifies', 'rebuts',
  'undercuts', 'warrants', 'backs', 'grounds'
];

export interface ArgumentEdge extends KnowledgeGraphEdge {
  argumentStrength: number; // 0-1 confidence in the argument relationship
  argumentType: 'support' | 'attack' | 'qualify';
  rationale?: string;
}

/**
 * Build argument edges from extracted rationale
 */
export function buildArgumentEdgesFromRationale(
  entityId: string,
  rationale: EntityRationale
): ArgumentEdge[] {
  const edges: ArgumentEdge[] = [];

  // Convert ADRs to backing/warrant edges
  for (const adr of rationale.architecturalDecisions) {
    edges.push({
      sourceId: entityId,
      targetId: `adr:${adr.id}`,
      edgeType: 'backs',
      weight: adr.confidence ?? 0.8,
      argumentStrength: adr.confidence ?? 0.8,
      argumentType: 'support',
      rationale: adr.decision
    });
  }

  // Convert tradeoffs to qualifying edges
  for (const tradeoff of rationale.tradeoffs) {
    edges.push({
      sourceId: entityId,
      targetId: `tradeoff:${tradeoff.id}`,
      edgeType: 'qualifies',
      weight: 0.7,
      argumentStrength: 0.7,
      argumentType: 'qualify',
      rationale: `Gained: ${tradeoff.gained}, Sacrificed: ${tradeoff.sacrificed}`
    });
  }

  // Convert accepted risks to rebutting edges
  for (const risk of rationale.acceptedRisks) {
    edges.push({
      sourceId: `risk:${risk.id}`,
      targetId: entityId,
      edgeType: 'challenges',
      weight: risk.likelihood * risk.impact,
      argumentStrength: risk.likelihood,
      argumentType: 'attack',
      rationale: risk.description
    });
  }

  return edges;
}

/**
 * Query argument edges for an entity
 */
export async function getArgumentEdgesForEntity(
  storage: LibrarianStorage,
  entityId: string
): Promise<EdgeQueryResult> {
  const edges = await storage.getKnowledgeEdges({
    sourceId: entityId,
    edgeTypes: ARGUMENT_EDGE_TYPES
  });

  return {
    supporting: edges.filter(e => e.argumentType === 'support'),
    attacking: edges.filter(e => e.argumentType === 'attack'),
    qualifying: edges.filter(e => e.argumentType === 'qualify')
  };
}
```

3. **`/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/LiBrainian/src/graphs/knowledge_graph.ts`**

```typescript
// ADD: Build argument subgraph from rationale
export async function buildArgumentGraph(
  entities: UniversalKnowledge[],
  storage: LibrarianStorage
): Promise<KnowledgeGraph> {
  const graph = createEmptyGraph();

  for (const entity of entities) {
    if (entity.rationale) {
      const edges = buildArgumentEdgesFromRationale(entity.id, entity.rationale);
      for (const edge of edges) {
        addEdge(graph, edge);
      }
    }
  }

  // Compute argument-specific metrics
  graph.metrics = {
    ...graph.metrics,
    supportChainDepth: computeSupportChainDepth(graph),
    attackCount: countEdgesByType(graph, 'challenges'),
    groundedClaims: findGroundedClaims(graph)
  };

  return graph;
}
```

**Verification**: `npm test -- --grep "argument_edges"` - all edge types functional

---

### WU-FIX-006: Perspective Parameter (P1)
**Gap**: Infrastructure exists but perspective not exposed in API
**Effort**: 1 day

#### Files to Modify:

1. **`/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/LiBrainian/src/types.ts`**

```typescript
// ADD: Perspective type
export type QueryPerspective =
  | 'bug_investigation'    // T-19 to T-24
  | 'security_review'      // T-27, security extractor
  | 'performance_analysis' // T-28
  | 'architecture_review'  // T-08, T-09, T-29
  | 'code_quality'         // T-17, quality extractor
  | 'modification_support' // T-13 to T-18
  | 'navigation'           // T-01 to T-06
  | 'onboarding';          // New team member perspective

// ADD to LibrarianQuery
export interface LibrarianQuery {
  // ... existing fields

  /** Analysis perspective - affects signal weights and result filtering */
  perspective?: QueryPerspective;
}
```

2. **`/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/LiBrainian/src/api/perspective.ts`**

```typescript
// ENHANCE existing file
import type { QueryPerspective } from '../types.js';

export interface PerspectiveConfig {
  patterns: string[];           // T-pattern codes to prioritize
  signalWeights: SignalWeights; // Override signal weights
  packTypes: string[];          // Preferred pack types
  edgeTypes: string[];          // Graph edges to emphasize
}

export const PERSPECTIVE_CONFIGS: Record<QueryPerspective, PerspectiveConfig> = {
  bug_investigation: {
    patterns: ['T-19', 'T-20', 'T-21', 'T-22', 'T-23', 'T-24'],
    signalWeights: {
      semantic: 0.3,
      structural: 0.2,
      history: 0.3,  // Emphasize historical context
      recency: 0.2
    },
    packTypes: ['error', 'test', 'fix'],
    edgeTypes: ['calls', 'throws', 'catches', 'tests']
  },
  security_review: {
    patterns: ['T-27'],
    signalWeights: {
      semantic: 0.2,
      security: 0.4,   // New security signal
      structural: 0.2,
      dependency: 0.2
    },
    packTypes: ['security', 'auth', 'input_validation'],
    edgeTypes: ['calls', 'validates', 'sanitizes']
  },
  // ... other perspectives
};

export function inferPerspective(query: LibrarianQuery): QueryPerspective {
  const intent = query.intent.toLowerCase();

  // Security-related queries
  if (/security|vuln|auth|xss|injection|csrf/i.test(intent)) {
    return 'security_review';
  }

  // Bug-related queries
  if (/bug|error|fail|crash|exception|debug/i.test(intent)) {
    return 'bug_investigation';
  }

  // Performance queries
  if (/slow|performance|optimize|memory|cpu|latency/i.test(intent)) {
    return 'performance_analysis';
  }

  // Architecture queries
  if (/architecture|design|pattern|structure|module/i.test(intent)) {
    return 'architecture_review';
  }

  // Default to navigation
  return 'navigation';
}
```

**Verification**: `npm test -- --grep "perspective"` - all perspectives return appropriate results

---

### WU-FIX-007: Multi-Graph Importance Scoring (P1)
**Gap**: Only structural PageRank used, not rationale/epistemic graphs
**Effort**: 2-3 days

#### Files to Modify:

1. **`/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/LiBrainian/src/graphs/importance_metrics.ts`**

```typescript
// NEW FILE: Multi-graph importance computation
import { computePageRank } from './pagerank.js';
import { buildArgumentGraph } from './knowledge_graph.js';
import type { KnowledgeGraph, ImportanceMetrics } from './types.js';

export interface MultiGraphImportance {
  structural: number;    // From code dependency graph
  rationale: number;     // From argument/decision graph
  organizational: number; // From authorship/ownership graph
  epistemic: number;     // From evidence/claim graph
  composite: number;     // Weighted combination
}

/**
 * Compute importance across multiple graph perspectives
 */
export async function computeMultiGraphImportance(
  entityId: string,
  graphs: {
    structural: KnowledgeGraph;
    rationale: KnowledgeGraph;
    organizational: KnowledgeGraph;
    epistemic: KnowledgeGraph;
  },
  weights = { structural: 0.4, rationale: 0.25, organizational: 0.15, epistemic: 0.2 }
): Promise<MultiGraphImportance> {
  const structuralRank = computePageRank(graphs.structural, { nodeId: entityId });
  const rationaleRank = computeArgumentImportance(graphs.rationale, entityId);
  const orgRank = computeOwnershipImportance(graphs.organizational, entityId);
  const epistemicRank = computeEvidenceImportance(graphs.epistemic, entityId);

  const composite =
    structuralRank * weights.structural +
    rationaleRank * weights.rationale +
    orgRank * weights.organizational +
    epistemicRank * weights.epistemic;

  return {
    structural: structuralRank,
    rationale: rationaleRank,
    organizational: orgRank,
    epistemic: epistemicRank,
    composite
  };
}

/**
 * Argument importance: How well-supported is this entity's rationale?
 */
function computeArgumentImportance(graph: KnowledgeGraph, entityId: string): number {
  const node = graph.nodes.get(entityId);
  if (!node) return 0;

  const supportingEdges = graph.edges.filter(
    e => e.targetId === entityId && e.edgeType === 'supports'
  );
  const challengingEdges = graph.edges.filter(
    e => e.targetId === entityId && e.edgeType === 'challenges'
  );

  const supportStrength = supportingEdges.reduce((sum, e) => sum + e.weight, 0);
  const challengeStrength = challengingEdges.reduce((sum, e) => sum + e.weight, 0);

  // Net support ratio, normalized
  return Math.max(0, Math.min(1,
    (supportStrength - challengeStrength * 0.5) / Math.max(1, supportStrength + challengeStrength)
  ));
}
```

2. **`/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/LiBrainian/src/query/multi_signal_scorer.ts`**

```typescript
// ADD: Multi-graph importance signal
export class MultiGraphImportanceSignal implements SignalComputer {
  readonly name = 'multi_graph_importance';
  readonly weight = 0.15; // Default weight

  async compute(
    candidate: Candidate,
    context: ScoringContext
  ): Promise<SignalResult> {
    const importance = await computeMultiGraphImportance(
      candidate.entityId,
      context.graphs,
      context.perspectiveWeights
    );

    return {
      score: importance.composite,
      components: {
        structural: importance.structural,
        rationale: importance.rationale,
        organizational: importance.organizational,
        epistemic: importance.epistemic
      },
      explanation: `Multi-graph importance: ${(importance.composite * 100).toFixed(1)}%`
    };
  }
}

// MODIFY: Register the new signal
export function createMultiSignalScorer(options?: ScorerOptions): MultiSignalScorer {
  const scorer = new MultiSignalScorer();

  // Existing signals
  scorer.registerComputer(new SemanticSignalComputer());
  scorer.registerComputer(new StructuralSignalComputer());
  scorer.registerComputer(new HistorySignalComputer());
  // ... other existing signals

  // NEW: Multi-graph importance signal
  scorer.registerComputer(new MultiGraphImportanceSignal());

  return scorer;
}
```

**Verification**: `npm test -- --grep "importance_metrics"` - composite scores computed

---

### WU-FIX-008: Large File Refactoring (P1)
**Issue**: sqlite_storage.ts (6085 lines), query.ts (3187 lines) need decomposition
**Effort**: 3-4 days

This is structural refactoring. Create new files by extracting cohesive pieces:

1. **From `sqlite_storage.ts`**: Extract into:
   - `src/storage/sqlite_queries.ts` - Query building and execution
   - `src/storage/sqlite_migrations.ts` - Migration logic
   - `src/storage/sqlite_embeddings.ts` - Embedding storage operations
   - `src/storage/sqlite_knowledge.ts` - Knowledge entity operations
   - `src/storage/sqlite_index.ts` - Index management

2. **From `query.ts`**: Extract into:
   - `src/api/query_pipeline.ts` - Pipeline orchestration
   - `src/api/query_candidates.ts` - Candidate retrieval
   - `src/api/query_scoring.ts` - Scoring logic
   - `src/api/query_synthesis.ts` - Response synthesis
   - `src/api/query_cache.ts` - Caching logic

**Verification**: `npm run build` passes, all tests pass, no circular imports

---

## PART 3: MEDIUM PRIORITY FIXES

### WU-FIX-009: Cognitive Load Management (P2)
**Gap**: No warning when context is overwhelming
**Effort**: 2 days

#### Files to Modify:

1. **`/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/LiBrainian/src/api/cognitive_load.ts`**

```typescript
// NEW FILE: Cognitive load estimation
export interface CognitiveLoadEstimate {
  score: number;           // 0-1, higher = more load
  level: 'low' | 'medium' | 'high' | 'overwhelming';
  factors: CognitiveLoadFactors;
  recommendation?: string;
}

export interface CognitiveLoadFactors {
  conceptCount: number;       // Distinct modules, functions, types
  relationshipDensity: number; // Connections between concepts
  codeComplexity: number;     // Cyclomatic complexity average
  contextSwitches: number;    // Different domains/contexts
  readingTimeMinutes: number; // Estimated reading time
}

export function estimateCognitiveLoad(response: LibrarianResponse): CognitiveLoadEstimate {
  const factors = extractLoadFactors(response);
  const score = computeLoadScore(factors);

  return {
    score,
    level: scoreToLevel(score),
    factors,
    recommendation: score > 0.7
      ? `Consider using --context-level L${Math.max(0, response.query.contextLevel - 1)} for reduced cognitive load`
      : undefined
  };
}

function extractLoadFactors(response: LibrarianResponse): CognitiveLoadFactors {
  const packs = response.packs;

  // Count distinct concepts
  const concepts = new Set<string>();
  for (const pack of packs) {
    concepts.add(pack.targetId);
    pack.relatedFiles.forEach(f => concepts.add(f));
  }

  // Count relationships
  const relationships = packs.reduce((sum, p) => sum + p.relatedFiles.length, 0);

  // Estimate complexity
  const complexitySum = packs.reduce((sum, p) => sum + (p.metrics?.complexity ?? 5), 0);

  // Estimate reading time (200 words/min, ~4 tokens/word)
  const totalTokens = response.tokenStats?.usedTokens ?? estimateTokens(JSON.stringify(response));
  const readingTime = totalTokens / (200 * 4);

  return {
    conceptCount: concepts.size,
    relationshipDensity: relationships / Math.max(1, concepts.size),
    codeComplexity: complexitySum / Math.max(1, packs.length),
    contextSwitches: countContextSwitches(packs),
    readingTimeMinutes: readingTime
  };
}

function computeLoadScore(factors: CognitiveLoadFactors): number {
  // Weighted combination of factors
  const weights = {
    concepts: 0.25,
    relationships: 0.2,
    complexity: 0.25,
    contextSwitches: 0.15,
    readingTime: 0.15
  };

  // Normalize each factor to 0-1
  const normalizedConcepts = Math.min(1, factors.conceptCount / 50);
  const normalizedRelationships = Math.min(1, factors.relationshipDensity / 10);
  const normalizedComplexity = Math.min(1, factors.codeComplexity / 20);
  const normalizedSwitches = Math.min(1, factors.contextSwitches / 10);
  const normalizedTime = Math.min(1, factors.readingTimeMinutes / 15);

  return (
    normalizedConcepts * weights.concepts +
    normalizedRelationships * weights.relationships +
    normalizedComplexity * weights.complexity +
    normalizedSwitches * weights.contextSwitches +
    normalizedTime * weights.readingTime
  );
}
```

2. **`/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/LiBrainian/src/types.ts`**

```typescript
// ADD to LibrarianResponse
export interface LibrarianResponse {
  // ... existing fields

  /** Cognitive load estimate for the response */
  cognitiveLoad?: CognitiveLoadEstimate;
}
```

**Verification**: `npm test -- --grep "cognitive_load"` - load estimates computed

---

### WU-FIX-010: Role-Specific Query Modes (P2)
**Gap**: Product Manager (52%), DevOps (68%), Data Scientist (65%) coverage
**Effort**: 3-4 days

#### Files to Modify:

1. **`/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/LiBrainian/src/api/role_modes.ts`**

```typescript
// NEW FILE: Role-specific query modes
export type QueryRole =
  | 'developer'
  | 'architect'
  | 'qa_tester'
  | 'devops_sre'
  | 'security_engineer'
  | 'tech_lead'
  | 'product_manager'
  | 'data_scientist'
  | 'documentation_writer'
  | 'new_team_member';

export interface RoleConfig {
  defaultPerspective: QueryPerspective;
  preferredPackTypes: string[];
  outputFormat: 'technical' | 'summary' | 'business';
  detailLevel: 'high' | 'medium' | 'low';
  includeCodeSnippets: boolean;
  includeMetrics: boolean;
  vocabularyLevel: 'expert' | 'intermediate' | 'accessible';
}

export const ROLE_CONFIGS: Record<QueryRole, RoleConfig> = {
  product_manager: {
    defaultPerspective: 'navigation',
    preferredPackTypes: ['feature', 'user_journey', 'requirement'],
    outputFormat: 'business',
    detailLevel: 'low',
    includeCodeSnippets: false,
    includeMetrics: true,
    vocabularyLevel: 'accessible'
  },
  devops_sre: {
    defaultPerspective: 'performance_analysis',
    preferredPackTypes: ['deployment', 'monitoring', 'infrastructure'],
    outputFormat: 'technical',
    detailLevel: 'high',
    includeCodeSnippets: true,
    includeMetrics: true,
    vocabularyLevel: 'expert'
  },
  data_scientist: {
    defaultPerspective: 'navigation',
    preferredPackTypes: ['data_pipeline', 'model', 'feature'],
    outputFormat: 'technical',
    detailLevel: 'high',
    includeCodeSnippets: true,
    includeMetrics: true,
    vocabularyLevel: 'intermediate'
  },
  // ... other roles
};

/**
 * Transform response based on role configuration
 */
export function adaptResponseForRole(
  response: LibrarianResponse,
  role: QueryRole
): LibrarianResponse {
  const config = ROLE_CONFIGS[role];

  if (config.outputFormat === 'business') {
    // Transform technical details to business language
    return transformToBusinessSummary(response, config);
  }

  if (!config.includeCodeSnippets) {
    // Remove code snippets, keep summaries
    return removeCodeSnippets(response);
  }

  return response;
}

function transformToBusinessSummary(
  response: LibrarianResponse,
  config: RoleConfig
): LibrarianResponse {
  const summary = generateBusinessSummary(response);

  return {
    ...response,
    synthesis: {
      ...response.synthesis,
      answer: summary.plainLanguage,
      keyInsights: summary.businessInsights,
      // Remove technical details
      citations: response.synthesis?.citations.slice(0, 3) ?? []
    },
    packs: response.packs.slice(0, 3).map(pack => ({
      ...pack,
      summary: simplifyForBusiness(pack.summary),
      codeSnippets: [], // Remove code
      keyFacts: pack.keyFacts.slice(0, 3).map(simplifyForBusiness)
    }))
  };
}
```

2. **`/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/LiBrainian/src/types.ts`**

```typescript
// ADD to LibrarianQuery
export interface LibrarianQuery {
  // ... existing fields

  /** Target role for response adaptation */
  role?: QueryRole;
}
```

**Verification**: Query with `--role product_manager` returns non-technical summary

---

### WU-FIX-011: Causal Reasoning Foundation (P2)
**Gap**: No causal graphs or do-calculus support
**Effort**: 4-5 days

#### Files to Modify:

1. **`/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/LiBrainian/src/graphs/causal_graph.ts`**

```typescript
// NEW FILE: Causal graph implementation
export interface CausalNode {
  id: string;
  type: 'cause' | 'effect' | 'confounder' | 'mediator';
  entity: EntityReference;
  distribution?: ProbabilityDistribution;
}

export interface CausalEdge {
  sourceId: string;
  targetId: string;
  mechanism: string;
  strength: ConfidenceValue;
  isObservational: boolean;
}

export interface CausalGraph {
  nodes: Map<string, CausalNode>;
  edges: CausalEdge[];
  metadata: {
    builtFrom: string[];
    timestamp: Date;
  };
}

/**
 * Build causal graph from cochange patterns and test failures
 */
export async function buildCausalGraph(
  cochangeGraph: KnowledgeGraph,
  testResults: TestResult[],
  commitHistory: CommitRecord[]
): Promise<CausalGraph> {
  const graph: CausalGraph = {
    nodes: new Map(),
    edges: [],
    metadata: { builtFrom: ['cochange', 'tests', 'commits'], timestamp: new Date() }
  };

  // Extract causal relationships from cochange patterns
  // If A and B always change together, and A changed first historically, A may cause B
  for (const edge of cochangeGraph.edges) {
    if (edge.edgeType === 'co_changed') {
      const temporalOrder = determineTemporalOrder(edge.sourceId, edge.targetId, commitHistory);
      if (temporalOrder.confidence > 0.7) {
        graph.edges.push({
          sourceId: temporalOrder.earlier,
          targetId: temporalOrder.later,
          mechanism: 'temporal_cochange',
          strength: createDerivedConfidence(temporalOrder.confidence, 'causal_inference'),
          isObservational: true
        });
      }
    }
  }

  // Extract causal relationships from test failures
  // If changing A causes test T to fail, A causally affects T's subject
  for (const result of testResults) {
    if (result.status === 'failed' && result.changedFiles) {
      for (const file of result.changedFiles) {
        graph.edges.push({
          sourceId: file,
          targetId: result.testTarget,
          mechanism: 'test_failure',
          strength: createDerivedConfidence(0.9, 'test_evidence'),
          isObservational: false // This is interventional data
        });
      }
    }
  }

  return graph;
}

/**
 * Do-calculus intervention: What would happen if we set X to value v?
 */
export function doIntervention(
  graph: CausalGraph,
  targetNode: string,
  intervention: unknown
): CausalGraph {
  // Remove all incoming edges to the target (do-operator semantics)
  const interventionalGraph: CausalGraph = {
    nodes: new Map(graph.nodes),
    edges: graph.edges.filter(e => e.targetId !== targetNode),
    metadata: {
      ...graph.metadata,
      intervention: { target: targetNode, value: intervention }
    }
  };

  return interventionalGraph;
}

/**
 * Compute causal effect of X on Y
 */
export function computeCausalEffect(
  graph: CausalGraph,
  cause: string,
  effect: string
): ConfidenceValue {
  // Find all paths from cause to effect
  const paths = findAllPaths(graph, cause, effect);

  if (paths.length === 0) {
    return createAbsentConfidence('no_causal_path');
  }

  // Compute total effect as product of path strengths
  const pathStrengths = paths.map(path =>
    path.reduce((product, edge) => product * (edge.strength.value ?? 0), 1)
  );

  const totalEffect = Math.max(...pathStrengths);

  return createDerivedConfidence(totalEffect, 'causal_path_analysis');
}
```

**Verification**: `npm test -- --grep "causal"` - causal queries return path analysis

---

### WU-FIX-012: Problem Decomposition Support (P2)
**Gap**: No task decomposition scaffolds
**Effort**: 2-3 days

#### Files to Modify:

1. **`/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/LiBrainian/src/api/decomposition.ts`**

```typescript
// NEW FILE: Task decomposition support
import type { LibrarianQuery, ContextPack } from '../types.js';

export interface DecompositionQuery extends LibrarianQuery {
  taskDescription: string;
  targetScope?: string; // File, module, or feature
}

export interface Subtask {
  id: string;
  title: string;
  description: string;
  dependencies: string[];     // IDs of subtasks that must complete first
  affectedFiles: string[];    // Files likely to be modified
  estimatedEffort: 'trivial' | 'small' | 'medium' | 'large';
  requiredKnowledge: string[]; // Context packs needed
}

export interface DecompositionResult {
  originalTask: string;
  subtasks: Subtask[];
  dependencyGraph: Map<string, string[]>;
  suggestedOrder: string[];   // Topologically sorted subtask IDs
  totalEstimate: {
    minDays: number;
    maxDays: number;
    confidence: number;
  };
}

/**
 * Decompose a task into subtasks based on codebase analysis
 */
export async function decomposeTask(
  storage: LibrarianStorage,
  query: DecompositionQuery
): Promise<DecompositionResult> {
  // 1. Find affected modules via impact analysis
  const impactResult = await analyzeImpact(storage, query.targetScope);

  // 2. Cluster affected files into logical units
  const clusters = clusterByModule(impactResult.affectedFiles);

  // 3. Generate subtasks for each cluster
  const subtasks: Subtask[] = [];
  for (const cluster of clusters) {
    const subtask = generateSubtask(cluster, query.taskDescription);
    subtasks.push(subtask);
  }

  // 4. Analyze dependencies between subtasks
  const dependencyGraph = buildDependencyGraph(subtasks, storage);

  // 5. Topological sort for suggested order
  const suggestedOrder = topologicalSort(subtasks, dependencyGraph);

  // 6. Estimate total effort
  const totalEstimate = estimateTotalEffort(subtasks);

  return {
    originalTask: query.taskDescription,
    subtasks,
    dependencyGraph,
    suggestedOrder,
    totalEstimate
  };
}

function generateSubtask(
  cluster: FileCluster,
  parentTask: string
): Subtask {
  const primaryFile = cluster.files[0];
  const moduleInfo = cluster.moduleKnowledge;

  return {
    id: `subtask_${cluster.id}`,
    title: `Update ${moduleInfo?.purpose ?? primaryFile}`,
    description: `Modify ${cluster.files.length} file(s) in ${cluster.moduleName} to support: ${parentTask}`,
    dependencies: [],
    affectedFiles: cluster.files,
    estimatedEffort: estimateEffort(cluster),
    requiredKnowledge: cluster.contextPackIds
  };
}

function estimateEffort(cluster: FileCluster): Subtask['estimatedEffort'] {
  const fileCount = cluster.files.length;
  const avgComplexity = cluster.avgComplexity;

  if (fileCount === 1 && avgComplexity < 5) return 'trivial';
  if (fileCount <= 3 && avgComplexity < 10) return 'small';
  if (fileCount <= 6 && avgComplexity < 15) return 'medium';
  return 'large';
}
```

2. **`/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/LiBrainian/src/cli/commands/decompose.ts`**

```typescript
// NEW FILE: CLI command for task decomposition
export async function decomposeCommand(args: DecomposeArgs): Promise<void> {
  const storage = await openStorage(args.workspace);

  const result = await decomposeTask(storage, {
    intent: args.task,
    taskDescription: args.task,
    targetScope: args.scope
  });

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`\nTask Decomposition: ${result.originalTask}\n`);
  console.log(`Found ${result.subtasks.length} subtasks:\n`);

  for (const subtask of result.subtasks) {
    const deps = subtask.dependencies.length > 0
      ? ` (after: ${subtask.dependencies.join(', ')})`
      : '';
    console.log(`  [${subtask.estimatedEffort}] ${subtask.title}${deps}`);
    console.log(`    Files: ${subtask.affectedFiles.join(', ')}`);
  }

  console.log(`\nSuggested order: ${result.suggestedOrder.join(' -> ')}`);
  console.log(`\nTotal estimate: ${result.totalEstimate.minDays}-${result.totalEstimate.maxDays} days`);
}
```

**Verification**: `LiBrainian decompose "Add user authentication"` returns ordered subtasks

---

## PART 4: LOWER PRIORITY FIXES

### WU-FIX-013: Cache Visibility and Control (P3)
**Effort**: 1 day

#### Files to Modify:

1. **`/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/LiBrainian/src/types.ts`**

```typescript
// ADD to LibrarianQuery
export interface LibrarianQuery {
  // ... existing fields

  /** Cache control policy */
  cacheControl?: 'use' | 'skip' | 'refresh';
}

// ADD to LibrarianResponse
export interface LibrarianResponse {
  // ... existing fields

  /** Cache metadata */
  cache?: {
    hit: boolean;
    ageMs?: number;
    expiresInMs?: number;
    key?: string;
  };
}
```

2. **`/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/LiBrainian/src/cli/commands/cache.ts`**

```typescript
// NEW FILE: Cache management commands
export async function cacheStatusCommand(args: CacheArgs): Promise<void> {
  const storage = await openStorage(args.workspace);
  const stats = await storage.getCacheStats();

  console.log('Cache Status:');
  console.log(`  Entries: ${stats.entryCount}`);
  console.log(`  Size: ${formatBytes(stats.sizeBytes)}`);
  console.log(`  Hit rate: ${(stats.hitRate * 100).toFixed(1)}%`);
  console.log(`  Oldest: ${formatAge(stats.oldestEntryAge)}`);
}

export async function cacheClearCommand(args: CacheArgs): Promise<void> {
  const storage = await openStorage(args.workspace);
  const cleared = await storage.clearQueryCache(args.olderThan);
  console.log(`Cleared ${cleared} cache entries`);
}
```

---

### WU-FIX-014: Command Aliases (P3)
**Effort**: 0.5 days

#### Files to Modify:

1. **`/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/LiBrainian/src/cli/index.ts`**

```typescript
// ADD: Command aliases
const COMMAND_ALIASES: Record<string, string> = {
  'q': 'query',
  'b': 'bootstrap',
  's': 'status',
  'h': 'health',
  'chk': 'check-providers',
  'conf': 'confidence',
  'val': 'validate',
  'cov': 'coverage',
  'qq': 'query --json --no-synthesis' // Compound alias
};

function resolveCommand(input: string): string {
  return COMMAND_ALIASES[input] ?? input;
}
```

---

### WU-FIX-015: Output Format Negotiation (P3)
**Effort**: 1 day

#### Files to Modify:

1. **`/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/LiBrainian/src/cli/output.ts`**

```typescript
// NEW FILE: Unified output formatting
export type OutputFormat = 'json' | 'jsonl' | 'yaml' | 'text';

export function formatOutput<T>(
  data: T,
  format: OutputFormat,
  options?: FormatOptions
): string {
  switch (format) {
    case 'json':
      return JSON.stringify(data, null, options?.compact ? 0 : 2);
    case 'jsonl':
      if (Array.isArray(data)) {
        return data.map(item => JSON.stringify(item)).join('\n');
      }
      return JSON.stringify(data);
    case 'yaml':
      return yaml.stringify(data);
    case 'text':
      return formatAsText(data, options);
    default:
      return String(data);
  }
}

export function detectOutputFormat(): OutputFormat {
  // Auto-detect: if stdout is not a TTY, default to JSON
  if (!process.stdout.isTTY) {
    return 'json';
  }
  return 'text';
}
```

2. **`/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/LiBrainian/src/cli/index.ts`**

```typescript
// ADD: Global --output flag
const outputFlag = {
  name: '--output',
  alias: '-o',
  description: 'Output format: json|jsonl|yaml|text (auto-detected if omitted)',
  parse: (value: string) => value as OutputFormat
};
```

---

### WU-FIX-016: Depth Level Hints (P3)
**Effort**: 1 day

#### Files to Modify:

1. **`/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/LiBrainian/src/api/depth_hints.ts`**

```typescript
// NEW FILE: Depth level recommendations
export interface DepthHint {
  currentDepth: ContextLevel;
  suggestedDepth: ContextLevel;
  reason: string;
  confidence: number;
}

export function computeDepthHint(
  query: LibrarianQuery,
  candidateCount: number,
  returnedCount: number
): DepthHint | undefined {
  const currentDepth = query.contextLevel ?? 'L1';

  // If we found many more candidates than we returned, suggest deeper level
  if (candidateCount > returnedCount * 2 && currentDepth !== 'L3') {
    const nextLevel = incrementLevel(currentDepth);
    return {
      currentDepth,
      suggestedDepth: nextLevel,
      reason: `Query matched ${candidateCount} items; ${currentDepth} returned only ${returnedCount}`,
      confidence: Math.min(0.9, candidateCount / (returnedCount * 3))
    };
  }

  // If we returned very few results, suggest shallower level might suffice
  if (returnedCount < 3 && currentDepth !== 'L0') {
    const prevLevel = decrementLevel(currentDepth);
    return {
      currentDepth,
      suggestedDepth: prevLevel,
      reason: `Only ${returnedCount} results; ${prevLevel} may be sufficient`,
      confidence: 0.6
    };
  }

  return undefined;
}
```

---

## PART 5: TEST INFRASTRUCTURE

### WU-FIX-017: Comprehensive Test Coverage
**Effort**: 3-4 days

Create tests for all new functionality:

1. **`/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/LiBrainian/src/api/__tests__/token_budget.test.ts`**
2. **`/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/LiBrainian/src/api/__tests__/deterministic_mode.test.ts`**
3. **`/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/LiBrainian/src/api/__tests__/perspective.test.ts`**
4. **`/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/LiBrainian/src/graphs/__tests__/importance_metrics.test.ts`**
5. **`/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/LiBrainian/src/graphs/__tests__/causal_graph.test.ts`**
6. **`/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/LiBrainian/src/api/__tests__/decomposition.test.ts`**
7. **`/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/LiBrainian/src/api/__tests__/role_modes.test.ts`**
8. **`/Volumes/BigSSD4/nathanielschmiedehaus/Documents/software/LiBrainian/src/api/__tests__/cognitive_load.test.ts`**

---

## IMPLEMENTATION SCHEDULE

### Week 1: Critical Fixes
| Day | Work Units | Focus |
|-----|------------|-------|
| 1-2 | WU-FIX-001 | Hallucination reduction |
| 3-4 | WU-FIX-002 | Token budget intelligence |
| 5 | WU-FIX-003 | Structured error contracts |

### Week 2: Critical + High Priority
| Day | Work Units | Focus |
|-----|------------|-------|
| 1 | WU-FIX-004 | Deterministic mode |
| 2-3 | WU-FIX-005 | Argument edge types |
| 4 | WU-FIX-006 | Perspective parameter |
| 5 | WU-FIX-007 (start) | Multi-graph importance |

### Week 3: High Priority Continued
| Day | Work Units | Focus |
|-----|------------|-------|
| 1 | WU-FIX-007 (complete) | Multi-graph importance |
| 2-4 | WU-FIX-008 | Large file refactoring |
| 5 | WU-FIX-009 | Cognitive load |

### Week 4: Medium Priority + Testing
| Day | Work Units | Focus |
|-----|------------|-------|
| 1-2 | WU-FIX-010 | Role-specific modes |
| 3-4 | WU-FIX-011 | Causal reasoning |
| 5 | WU-FIX-012 | Problem decomposition |

### Week 5: Polish + Integration
| Day | Work Units | Focus |
|-----|------------|-------|
| 1 | WU-FIX-013, 014, 015 | Cache, aliases, output |
| 2 | WU-FIX-016 | Depth hints |
| 3-4 | WU-FIX-017 | Test coverage |
| 5 | Integration testing | Full system validation |

---

## SUCCESS CRITERIA

### Quantitative Metrics
| Metric | Current | Target |
|--------|---------|--------|
| Hallucination Rate | 9.5% (test) | <2% |
| Citation Accuracy | 69.2% | >95% |
| Retrieval Recall@5 | 82.6% | >90% |
| ECE (Calibration) | 0.0602 | <0.05 |
| Test Pass Rate | ~98% | 100% |
| Role Coverage (PM) | 52% | >80% |
| Role Coverage (DevOps) | 68% | >85% |

### Qualitative Criteria
1. **Zero-Config Excellence**: `LiBrainian bootstrap` works on any repo without manual config
2. **Agent Integration**: Agents measurably perform better with LiBrainian context
3. **Trustworthy Claims**: All claims have verifiable citations
4. **Comprehensive Coverage**: All 30 T-patterns detected, all 15 task types supported
5. **Self-Improving**: Calibration improves automatically over time

---

## VERIFICATION COMMANDS

After implementing all fixes, run:

```bash
# Full test suite
npm test -- --run

# Type checking
npx tsc --noEmit

# Calibration validation
npm run eval:calibration

# E2E validation
npm run eval:e2e

# Performance benchmarks
npm run bench

# Coverage report
npm run coverage
```

All must pass with 0 failures for 100% success.

---

*This plan is comprehensive and actionable. Execute work units in order for optimal results.*
