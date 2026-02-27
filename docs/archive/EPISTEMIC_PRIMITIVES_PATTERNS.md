# Epistemic Primitives: A Pattern Language for AI Systems with Provenance

**Version**: 1.0.0
**Status**: Published
**Authors**: LiBrainian Project

---

## Abstract

Modern AI systems routinely make claims about code, documents, and the world without tracking how those claims were derived or what could invalidate them. When an AI assistant says "this function handles errors correctly" with 85% confidence, what does that number actually mean? Where did it come from? What evidence supports it? What could defeat it?

This paper presents four composable epistemic primitives that address these questions:

1. **ConfidenceValue** - A typed confidence system that eliminates arbitrary numbers
2. **Evidence Ledger** - An append-only log of all epistemic events
3. **Defeater** - A mechanism for tracking what could invalidate claims
4. **Causal Graph** - A structure for reasoning about cause and effect

These patterns emerged from building LiBrainian, a system for AI-assisted code understanding. They are language-agnostic and applicable to any system that needs to make claims with provenance.

The core insight: **confidence without provenance is theater**. A system that outputs "0.85 confidence" without explaining how that number was derived provides false precision. These patterns force honesty about what we know and what could prove us wrong.

---

## 1. The ConfidenceValue Pattern

### Problem

AI systems commonly output confidence scores as raw floating-point numbers:

```python
# Anti-pattern: Raw numeric confidence
def analyze_code(source: str) -> dict:
    return {
        "claim": "Function handles edge cases",
        "confidence": 0.87  # Where does this come from?
    }
```

These numbers create an illusion of precision while hiding uncertainty. Questions that cannot be answered:
- Was this measured empirically or guessed?
- What dataset was used for calibration?
- Is this a logical certainty or a statistical estimate?
- How should downstream systems combine multiple such values?

### Solution

Replace raw numbers with a discriminated union of five typed confidence categories:

```typescript
type ConfidenceValue =
  | DeterministicConfidence   // Logically certain: 0.0 or 1.0
  | MeasuredConfidence        // Empirically calibrated
  | DerivedConfidence         // Computed from other confidences
  | BoundedConfidence         // Range with theoretical basis
  | AbsentConfidence;         // Honestly unknown
```

Each category has mandatory provenance fields that prevent guessing:

#### 1.1 Deterministic Confidence

For operations that are logically certain:

```typescript
interface DeterministicConfidence {
  readonly type: 'deterministic';
  readonly value: 1.0 | 0.0;
  readonly reason: string;
}
```

**Use when**: Syntactic operations, parse success/failure, exact string matches, file existence checks.

**Example**:
```typescript
const astParseResult: ConfidenceValue = {
  type: 'deterministic',
  value: 1.0,
  reason: 'typescript_ast_parse_succeeded'
};
```

**Rule**: If an operation is deterministic, its confidence MUST be 1.0 or 0.0. There is no uncertainty in whether a parse succeeded.

#### 1.2 Measured Confidence

For values derived from empirical calibration:

```typescript
interface MeasuredConfidence {
  readonly type: 'measured';
  readonly value: number;
  readonly measurement: {
    readonly datasetId: string;
    readonly sampleSize: number;
    readonly accuracy: number;
    readonly confidenceInterval: readonly [number, number];
    readonly measuredAt: string;
  };
}
```

**Use when**: LLM operations after calibration, any operation with outcome tracking data.

**Example**:
```typescript
const llmClassificationConfidence: ConfidenceValue = {
  type: 'measured',
  value: 0.82,
  measurement: {
    datasetId: 'code-classification-v3',
    sampleSize: 1247,
    accuracy: 0.82,
    confidenceInterval: [0.79, 0.85],
    measuredAt: '2026-01-15T10:30:00Z'
  }
};
```

**Rule**: You must have actual measurement data. If you do not have calibration data, use `absent`.

#### 1.3 Derived Confidence

For values computed from other confidence values:

```typescript
interface DerivedConfidence {
  readonly type: 'derived';
  readonly value: number;
  readonly formula: string;
  readonly inputs: ReadonlyArray<{
    name: string;
    confidence: ConfidenceValue;
  }>;
}
```

**Use when**: Composing operations, pipelines, aggregations.

**Example**:
```typescript
// Sequential pipeline: confidence = minimum of steps
const pipelineConfidence: ConfidenceValue = {
  type: 'derived',
  value: 0.75,
  formula: 'min(parse, extract, classify)',
  inputs: [
    { name: 'parse', confidence: parseConf },
    { name: 'extract', confidence: extractConf },
    { name: 'classify', confidence: classifyConf }
  ]
};
```

**Rule**: All inputs must themselves be `ConfidenceValue` (not raw numbers). The formula must be mathematically valid.

#### 1.4 Bounded Confidence

For theoretical ranges without empirical data:

```typescript
interface BoundedConfidence {
  readonly type: 'bounded';
  readonly low: number;
  readonly high: number;
  readonly basis: 'theoretical' | 'literature' | 'formal_analysis';
  readonly citation: string;
}
```

**Use when**: Operations with principled bounds but no empirical calibration yet.

**Example**:
```typescript
const retrievalBound: ConfidenceValue = {
  type: 'bounded',
  low: 0.6,
  high: 0.9,
  basis: 'literature',
  citation: 'Karpukhin et al. 2020, DPR retrieval accuracy range'
};
```

**Rule**: Must have a citation or principled derivation. No guessing allowed.

#### 1.5 Absent Confidence

For genuinely unknown values:

```typescript
interface AbsentConfidence {
  readonly type: 'absent';
  readonly reason: 'uncalibrated' | 'insufficient_data' | 'not_applicable';
}
```

**Use when**: Before calibration, new primitives, operations where confidence does not apply.

**Example**:
```typescript
const newOperationConfidence: ConfidenceValue = {
  type: 'absent',
  reason: 'uncalibrated'
};
```

**Rule**: This is the honest state. Systems must handle operations without confidence values gracefully.

### Derivation Rules

Standard rules for computing derived confidence:

| Rule | Formula | Use Case |
|------|---------|----------|
| D1: Syntactic | deterministic(success) | Parse, match, file read |
| D2: Sequential | min(steps) | Pipeline (weakest link) |
| D3: Parallel-All | product(branches) | All must succeed (AND) |
| D4: Parallel-Any | 1 - product(1 - branches) | Any can succeed (OR) |
| D5: Uncalibrated | absent('uncalibrated') | Before measurement |
| D6: Measured | measured(calibrationData) | After calibration |

### Degradation Handling

When confidence is absent, systems have three options:

**Option A: Equal Weighting** - Treat all options as equally viable
```typescript
function selectBestWithDegradation(items: Item[]): Item {
  const withConfidence = items.filter(i => i.confidence.type !== 'absent');
  if (withConfidence.length === 0) {
    // All absent - use deterministic fallback (e.g., alphabetical)
    return items.sort((a, b) => a.id.localeCompare(b.id))[0];
  }
  return maxBy(withConfidence, i => getEffectiveConfidence(i.confidence));
}
```

**Option B: Conservative Lower Bound** - Use zero for absent values
```typescript
function getEffectiveConfidence(conf: ConfidenceValue): number {
  switch (conf.type) {
    case 'deterministic':
    case 'derived':
    case 'measured':
      return conf.value;
    case 'bounded':
      return conf.low;  // Conservative: use lower bound
    case 'absent':
      return 0.0;       // Most conservative
  }
}
```

**Option C: Block Operations** - Refuse to proceed without confidence
```typescript
function requireConfidence(conf: ConfidenceValue, threshold: number): void {
  if (conf.type === 'absent') {
    throw new Error('Operation requires calibrated confidence');
  }
  if (getEffectiveConfidence(conf) < threshold) {
    throw new Error(`Confidence ${getEffectiveConfidence(conf)} below ${threshold}`);
  }
}
```

---

## 2. The Evidence Ledger Pattern

### Problem

AI systems make claims, but the provenance disappears:

```python
# Anti-pattern: Claim without trace
def get_function_summary(func_name: str) -> str:
    # Where did this come from? How was it verified?
    return "This function validates user input"
```

When claims conflict, there is no way to determine which is more trustworthy. When systems need recalibration, there is no historical data. When users ask "why did you say that?", there is no answer.

### Solution

Maintain an append-only log of all epistemic events:

```typescript
interface IEvidenceLedger {
  append(entry: Omit<EvidenceEntry, 'id' | 'timestamp'>): Promise<EvidenceEntry>;
  query(criteria: EvidenceQuery): Promise<EvidenceEntry[]>;
  getChain(claimId: EvidenceId): Promise<EvidenceChain>;
}
```

Every observation, retrieval, synthesis, and claim is recorded with full provenance.

### Evidence Entry Structure

```typescript
interface EvidenceEntry {
  id: EvidenceId;                    // Unique identifier
  timestamp: Date;                   // When appended to ledger
  kind: EvidenceKind;                // Type of evidence
  payload: EvidencePayload;          // The actual evidence
  provenance: EvidenceProvenance;    // Where it came from
  confidence?: ConfidenceValue;      // Associated confidence
  relatedEntries: EvidenceId[];      // Links to supporting evidence
  sessionId?: SessionId;             // Query/session context
}
```

### Evidence Kinds

The ledger supports eleven evidence categories:

| Kind | Description | Example |
|------|-------------|---------|
| `extraction` | AST/semantic extraction from source | Function signature parsed |
| `retrieval` | Vector/semantic search results | Top 10 similar functions |
| `synthesis` | LLM-generated content | Summary of module |
| `claim` | Assertion about codebase | "Function X calls Y" |
| `verification` | Verification of a claim | Test passed/failed |
| `contradiction` | Conflict between claims | Claim A says X, Claim B says not-X |
| `feedback` | User or agent feedback | User marked answer helpful |
| `outcome` | Observed outcome of prediction | Prediction was correct/incorrect |
| `tool_call` | External tool invocation | MCP tool executed |
| `episode` | Complete query episode | Full question-answer trace |
| `calibration` | Calibration measurement | ECE computed at 0.05 |

### Provenance Tracking

Every entry records its origin:

```typescript
interface EvidenceProvenance {
  source: 'ast_parser' | 'llm_synthesis' | 'embedding_search' |
          'user_input' | 'tool_output' | 'system_observation';
  method: string;
  agent?: {
    type: 'llm' | 'embedding' | 'ast' | 'human' | 'tool';
    identifier: string;
    version?: string;
  };
  inputHash?: string;  // For reproducibility
  config?: Record<string, unknown>;
}
```

### Evidence Chains

Claims reference their supporting evidence, forming directed acyclic graphs:

```typescript
interface EvidenceChain {
  root: EvidenceEntry;                           // The claim being examined
  evidence: EvidenceEntry[];                     // All supporting evidence
  graph: Map<EvidenceId, EvidenceId[]>;          // Dependency structure
  chainConfidence: ConfidenceValue;              // Combined confidence
  contradictions: ContradictionEvidence[];       // Any conflicts found
}
```

Chain confidence is computed as the minimum of component confidences (weakest link):

```typescript
function computeChainConfidence(entries: EvidenceEntry[]): ConfidenceValue {
  const confidences = entries.filter(e => e.confidence).map(e => e.confidence!);

  if (confidences.some(c => c.type === 'absent')) {
    return { type: 'absent', reason: 'uncalibrated' };
  }

  const values = confidences.map(getNumericValue);
  const minValue = Math.min(...values);

  return {
    type: 'derived',
    value: minValue,
    formula: 'min(chain_entries)',
    inputs: entries.map(e => ({ name: e.id, confidence: e.confidence! }))
  };
}
```

### Usage Example

Recording a complete reasoning trace:

```typescript
// 1. Record extraction
const extractionEntry = await ledger.append({
  kind: 'extraction',
  payload: {
    filePath: 'src/auth/validate.ts',
    extractionType: 'function',
    entity: {
      name: 'validateToken',
      kind: 'function',
      signature: '(token: string) => boolean',
      location: { file: 'src/auth/validate.ts', startLine: 45 }
    },
    quality: 'ast_verified'
  },
  provenance: {
    source: 'ast_parser',
    method: 'typescript_compiler_api',
    agent: { type: 'ast', identifier: 'typescript', version: '5.3' }
  },
  confidence: { type: 'deterministic', value: 1.0, reason: 'ast_parse_succeeded' },
  relatedEntries: []
});

// 2. Record retrieval
const retrievalEntry = await ledger.append({
  kind: 'retrieval',
  payload: {
    query: 'token validation functions',
    method: 'vector',
    results: [
      { entityId: 'validateToken', score: 0.92, snippet: '...' },
      { entityId: 'checkJWT', score: 0.87, snippet: '...' }
    ],
    candidatesConsidered: 150,
    latencyMs: 45
  },
  provenance: {
    source: 'embedding_search',
    method: 'cosine_similarity',
    agent: { type: 'embedding', identifier: 'text-embedding-3-large' }
  },
  relatedEntries: [extractionEntry.id]
});

// 3. Record claim with supporting evidence
const claimEntry = await ledger.append({
  kind: 'claim',
  payload: {
    claim: 'validateToken handles expired tokens correctly',
    category: 'behavior',
    subject: { type: 'function', identifier: 'validateToken' },
    supportingEvidence: [extractionEntry.id, retrievalEntry.id],
    knownDefeaters: [],
    confidence: {
      type: 'derived',
      value: 0.87,
      formula: 'min(extraction, retrieval)',
      inputs: [
        { name: 'extraction', confidence: extractionEntry.confidence! },
        { name: 'retrieval', confidence: retrievalEntry.confidence! }
      ]
    }
  },
  provenance: {
    source: 'llm_synthesis',
    method: 'gpt4_analysis',
    agent: { type: 'llm', identifier: 'gpt-4-turbo', version: '2024-01' }
  },
  confidence: claimConfidence,
  relatedEntries: [extractionEntry.id, retrievalEntry.id]
});
```

### Invariants

The ledger maintains strict invariants:

1. **Append-only**: Entries are never modified or deleted
2. **Atomic appends**: Batch operations succeed or fail atomically
3. **Unique IDs**: Each entry has a globally unique identifier
4. **Timestamped**: Timestamps reflect ledger append time, not observation time

---

## 3. The Defeater Pattern

### Problem

Claims can become invalid for many reasons:
- The underlying code changed
- A test that supported the claim now fails
- New information contradicts the claim
- The claim is too old to be trusted

Traditional systems either ignore invalidation (claims persist forever) or require manual maintenance (humans must track dependencies).

### Solution

Implement a defeater calculus based on Pollock's epistemology. Defeaters are explicit records of what could invalidate a claim:

```typescript
type ExtendedDefeaterType =
  | 'code_change'           // Source code was modified
  | 'test_failure'          // Supporting test now fails
  | 'hash_mismatch'         // Content hash changed
  | 'staleness'             // Claim is too old
  | 'contradiction'         // Conflicts with another claim
  | 'new_info'              // New information undermines claim
  | 'coverage_gap'          // Insufficient evidence
  | 'tool_failure'          // Tool that verified claim failed
  | 'provider_unavailable'  // External service unavailable
  | 'sandbox_mismatch';     // Environment differs from claimed
```

### Defeater Structure

```typescript
interface ExtendedDefeater {
  id: string;
  type: ExtendedDefeaterType;
  description: string;
  severity: 'full' | 'partial' | 'warning';
  affectedClaimIds: ClaimId[];
  confidenceReduction: number;  // 0.0 to 1.0
  autoResolvable: boolean;
  resolutionAction?: 'revalidate' | 'reindex' | 'retry_provider';
  evidence: string;
  status: 'pending' | 'active' | 'resolved';
  createdAt: string;
  resolvedAt?: string;
}
```

### Defeater Categories

Following Pollock's taxonomy:

**Rebutting Defeaters** - Direct contradiction
```typescript
// Claim A: "Function X never throws"
// Defeater: Test shows function X threw an exception
const rebutterDefeater: ExtendedDefeater = {
  type: 'test_failure',
  severity: 'full',
  confidenceReduction: 1.0,  // Complete defeat
  description: 'Test demonstrates function throws on invalid input'
};
```

**Undercutting Defeaters** - Attack the justification
```typescript
// Claim supported by code in file F
// Defeater: File F was modified
const undercutterDefeater: ExtendedDefeater = {
  type: 'code_change',
  severity: 'partial',
  confidenceReduction: 0.5,
  description: 'Supporting code was modified, claim may be stale'
};
```

**Undermining Defeaters** - Reduce confidence without full defeat
```typescript
// Claim made 30 days ago
// Defeater: Staleness warning
const underminerDefeater: ExtendedDefeater = {
  type: 'staleness',
  severity: 'warning',
  confidenceReduction: 0.2,
  description: 'Claim is 30 days old, recommend revalidation'
};
```

### Detection and Application

Defeaters are detected through context monitoring:

```typescript
interface DetectionContext {
  changedFiles?: string[];              // Files modified in codebase
  failedTests?: string[];               // Tests that now fail
  newClaims?: Claim[];                  // New claims to check for contradictions
  timestamp?: string;                   // For staleness checks
  hashMismatches?: Array<{              // Content hash changes
    claimId: ClaimId;
    expected: string;
    actual: string;
  }>;
  providerStatus?: Record<string, boolean>;  // External service availability
}

async function detectDefeaters(
  storage: EvidenceGraphStorage,
  context: DetectionContext
): Promise<DetectionResult> {
  const defeaters: ExtendedDefeater[] = [];

  // Check for staleness
  if (context.timestamp) {
    defeaters.push(...await detectStalenessDefeaters(storage, context.timestamp));
  }

  // Check for code changes
  if (context.changedFiles?.length) {
    defeaters.push(...await detectCodeChangeDefeaters(storage, context.changedFiles));
  }

  // Check for test failures
  if (context.failedTests?.length) {
    defeaters.push(...await detectTestFailureDefeaters(storage, context.failedTests));
  }

  // Check for contradictions
  if (context.newClaims?.length) {
    const contradictions = await detectContradictions(storage, context.newClaims);
    // Contradictions affect both claims
  }

  return { defeaters, contradictions, affectedClaimIds };
}
```

### Signal Strength Reduction

When defeaters are applied, claim signal strength is reduced based on defeater type:

```typescript
function applySignalStrengthReduction(
  signalStrength: ClaimSignalStrength,
  reduction: number,
  defeaterType: ExtendedDefeaterType
): ClaimSignalStrength {
  const newStrength = { ...signalStrength };

  switch (defeaterType) {
    case 'code_change':
    case 'hash_mismatch':
      // Affects structural and recency
      newStrength.structural = Math.max(0, signalStrength.structural - reduction);
      newStrength.recency = Math.max(0, signalStrength.recency - reduction);
      break;

    case 'test_failure':
      // Primarily affects test execution signal
      newStrength.testExecution = Math.max(0, signalStrength.testExecution - reduction);
      break;

    case 'staleness':
      // Primarily affects recency
      newStrength.recency = Math.max(0, signalStrength.recency - reduction);
      break;

    case 'contradiction':
    case 'new_info':
      // Affects semantic signal
      newStrength.semantic = Math.max(0, signalStrength.semantic - reduction);
      break;
  }

  // Recompute overall strength
  newStrength.overall = computeOverallSignalStrength(newStrength);
  return newStrength;
}
```

### Graph Health Assessment

The defeater system enables health monitoring of the entire knowledge graph:

```typescript
interface GraphHealthAssessment {
  overallHealth: number;                      // 0-1 score
  activeClaimCount: number;
  defeatedClaimCount: number;
  staleClaimCount: number;
  activeDefeaterCount: number;
  unresolvedContradictionCount: number;
  averageSignalStrength: number;
  topIssues: Array<{
    type: 'defeater' | 'contradiction' | 'low_signal_strength' | 'staleness';
    description: string;
    severity: 'high' | 'medium' | 'low';
    affectedClaims: number;
  }>;
  recommendations: string[];
}
```

### Key Insight

**Contradictions remain visible**. The system never silently reconciles conflicting claims. Instead, both claims are marked as `contradicted`, and the contradiction is recorded with full provenance. This ensures:

1. Users can see when the system is uncertain
2. Resolution can be human-guided when needed
3. The history of conflicts is preserved for learning

---

## 4. The Causal Reasoning Pattern

### Problem

When something goes wrong, users ask "why did this happen?" Traditional systems provide logs and traces, but not causal explanations:

```
ERROR: validateToken returned false
TRACE: validateToken <- checkExpiry <- processRequest <- handleAuth
```

This shows the call stack, but not causation. Did `checkExpiry` cause the failure? Or was it an upstream issue?

### Solution

Build explicit causal graphs that distinguish between different types of causal relationships:

```typescript
type CausalEdgeType =
  | 'causes'      // X directly causes Y
  | 'enables'     // X makes Y possible
  | 'prevents'    // X blocks Y
  | 'correlates'; // X and Y co-occur (not necessarily causal)
```

### Causal Graph Structure

```typescript
interface CausalGraph {
  id: string;
  nodes: Map<string, CausalNode>;
  edges: CausalEdge[];
  meta: CausalGraphMeta;
}

interface CausalNode {
  id: string;
  type: 'event' | 'state' | 'action' | 'condition';
  description: string;
  timestamp?: number;
  confidence: ConfidenceValue;
  metadata?: Record<string, unknown>;
}

interface CausalEdge {
  from: string;              // Cause node ID
  to: string;                // Effect node ID
  type: CausalEdgeType;
  strength: number;          // 0-1, how strongly X causes Y
  evidence: EvidenceRef[];   // What supports this edge
}
```

### Building Causal Graphs

Graphs are constructed from AST facts and runtime events:

```typescript
function buildCausalGraphFromFacts(
  facts: ASTFact[],
  events: CausalEvent[]
): CausalGraph {
  let graph = createEmptyCausalGraph(`causal-${Date.now()}`);

  // Process function calls - caller causes callee to execute
  for (const fact of facts) {
    if (fact.type === 'call') {
      const { caller, callee } = fact.details;

      // Ensure nodes exist
      if (!graph.nodes.has(caller)) {
        graph = addNodeToGraph(graph, createCausalNode({
          id: caller,
          type: 'action',
          description: `Function ${caller} execution`,
          confidence: deterministic(true, 'ast_call_extraction')
        }));
      }

      // Create causal edge
      graph = addEdgeToGraph(graph, createCausalEdge({
        from: caller,
        to: callee,
        type: 'causes',
        strength: 1.0,
        evidence: [{
          type: 'ast',
          reference: `${fact.file}:${fact.line}`,
          confidence: deterministic(true, 'ast_extraction')
        }]
      }));
    }
  }

  // Process runtime events
  for (const event of events) {
    graph = addNodeToGraph(graph, createCausalNode({
      id: event.id,
      type: 'event',
      description: event.description,
      timestamp: event.timestamp,
      confidence: deterministic(true, 'event_observed')
    }));

    // Link to specified cause
    if (event.cause && graph.nodes.has(event.cause)) {
      graph = addEdgeToGraph(graph, createCausalEdge({
        from: event.cause,
        to: event.id,
        type: 'causes',
        strength: 1.0
      }));
    }
  }

  return graph;
}
```

### Backward Traversal (Finding Causes)

```typescript
function findCauses(
  graph: CausalGraph,
  effectId: string,
  options: TraversalOptions = {}
): CausalNode[] {
  const { maxDepth = Infinity, edgeTypes, minStrength = 0 } = options;

  if (!graph.nodes.has(effectId)) return [];

  const visited = new Set<string>();
  const causes: CausalNode[] = [];
  const queue: Array<{ nodeId: string; depth: number }> = [
    { nodeId: effectId, depth: 0 }
  ];

  visited.add(effectId);

  while (queue.length > 0) {
    const { nodeId, depth } = queue.shift()!;

    // Find incoming edges (things that cause this node)
    const incomingEdges = graph.edges.filter(e =>
      e.to === nodeId &&
      e.strength >= minStrength &&
      (!edgeTypes || edgeTypes.includes(e.type))
    );

    for (const edge of incomingEdges) {
      const causeNode = graph.nodes.get(edge.from);
      if (causeNode && !visited.has(edge.from)) {
        visited.add(edge.from);
        causes.push(causeNode);

        if (depth + 1 < maxDepth) {
          queue.push({ nodeId: edge.from, depth: depth + 1 });
        }
      }
    }
  }

  return causes;
}
```

### Forward Traversal (Finding Effects)

```typescript
function findEffects(
  graph: CausalGraph,
  causeId: string,
  options: TraversalOptions = {}
): CausalNode[] {
  // Symmetric to findCauses, but follows outgoing edges
  const { maxDepth = Infinity, edgeTypes, minStrength = 0 } = options;

  if (!graph.nodes.has(causeId)) return [];

  const visited = new Set<string>();
  const effects: CausalNode[] = [];
  const queue = [{ nodeId: causeId, depth: 0 }];

  visited.add(causeId);

  while (queue.length > 0) {
    const { nodeId, depth } = queue.shift()!;

    const outgoingEdges = graph.edges.filter(e =>
      e.from === nodeId &&
      e.strength >= minStrength &&
      (!edgeTypes || edgeTypes.includes(e.type))
    );

    for (const edge of outgoingEdges) {
      const effectNode = graph.nodes.get(edge.to);
      if (effectNode && !visited.has(edge.to)) {
        visited.add(edge.to);
        effects.push(effectNode);

        if (depth + 1 < maxDepth) {
          queue.push({ nodeId: edge.to, depth: depth + 1 });
        }
      }
    }
  }

  return effects;
}
```

### Path Explanation

Finding all causal paths between two nodes:

```typescript
function explainCausation(
  graph: CausalGraph,
  causeId: string,
  effectId: string
): CausalPath[] {
  if (!graph.nodes.has(causeId) || !graph.nodes.has(effectId)) {
    return [];
  }

  const paths: CausalPath[] = [];

  function findPaths(
    currentId: string,
    targetId: string,
    visited: Set<string>,
    pathNodes: CausalNode[],
    pathEdges: CausalEdge[]
  ): void {
    if (currentId === targetId) {
      // Found a complete path
      const totalStrength = pathEdges.reduce((acc, e) => acc * e.strength, 1);
      paths.push({ nodes: [...pathNodes], edges: [...pathEdges], totalStrength });
      return;
    }

    visited.add(currentId);

    const outgoing = graph.edges.filter(e =>
      e.from === currentId && !visited.has(e.to)
    );

    for (const edge of outgoing) {
      const nextNode = graph.nodes.get(edge.to);
      if (nextNode) {
        findPaths(
          edge.to,
          targetId,
          new Set(visited),
          [...pathNodes, nextNode],
          [...pathEdges, edge]
        );
      }
    }
  }

  const startNode = graph.nodes.get(causeId);
  if (startNode) {
    findPaths(causeId, effectId, new Set(), [startNode], []);
  }

  return paths;
}
```

### Special Traversals

```typescript
// Find root causes (nodes with no incoming causal edges)
function findRootCauses(graph: CausalGraph, effectId: string): CausalNode[] {
  const allCauses = findCauses(graph, effectId);
  return allCauses.filter(cause => {
    const hasUpstreamCauses = graph.edges.some(e => e.to === cause.id);
    return !hasUpstreamCauses;
  });
}

// Find terminal effects (nodes with no outgoing causal edges)
function findTerminalEffects(graph: CausalGraph, causeId: string): CausalNode[] {
  const allEffects = findEffects(graph, causeId);
  return allEffects.filter(effect => {
    const hasDownstreamEffects = graph.edges.some(e => e.from === effect.id);
    return !hasDownstreamEffects;
  });
}

// Detect cycles (feedback loops)
function getCycleNodes(graph: CausalGraph): string[] {
  // Standard cycle detection using DFS with recursion stack
  // Returns all nodes participating in cycles
}
```

---

## 5. Composition: How Patterns Work Together

The four patterns compose to form a complete epistemic framework:

### Flow: From Observation to Claim

```
┌─────────────────────────────────────────────────────────────┐
│                      OBSERVATION                             │
│  (AST parse, embedding search, LLM synthesis)               │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    EVIDENCE LEDGER                           │
│  Record with provenance, assign ConfidenceValue              │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                         CLAIM                                │
│  Derived confidence from evidence chain                      │
│  Linked to supporting evidence IDs                           │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                     DEFEATER WATCH                           │
│  Monitor for code changes, test failures, staleness          │
│  Apply signal strength reductions                            │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    CAUSAL GRAPH                              │
│  "Why did this happen?" traversals                           │
│  Root cause analysis                                         │
└─────────────────────────────────────────────────────────────┘
```

### Example: Complete Reasoning Trace

```typescript
// 1. Extract function from AST
const extractionEvidence = await ledger.append({
  kind: 'extraction',
  payload: { /* function details */ },
  confidence: deterministic(true, 'ast_parse_succeeded'),
  provenance: { source: 'ast_parser', method: 'typescript_compiler_api' }
});

// 2. Retrieve similar functions
const retrievalEvidence = await ledger.append({
  kind: 'retrieval',
  payload: { /* search results */ },
  confidence: measured(calibrationData),
  provenance: { source: 'embedding_search', method: 'cosine_similarity' },
  relatedEntries: [extractionEvidence.id]
});

// 3. Synthesize claim
const claimEvidence = await ledger.append({
  kind: 'claim',
  payload: {
    claim: 'validateToken correctly rejects expired tokens',
    supportingEvidence: [extractionEvidence.id, retrievalEvidence.id],
    confidence: {
      type: 'derived',
      value: 0.82,
      formula: 'min(extraction, retrieval)',
      inputs: [
        { name: 'extraction', confidence: extractionEvidence.confidence! },
        { name: 'retrieval', confidence: retrievalEvidence.confidence! }
      ]
    }
  },
  relatedEntries: [extractionEvidence.id, retrievalEvidence.id]
});

// 4. Add to causal graph
causalGraph = addNodeToGraph(causalGraph, {
  id: claimEvidence.id,
  type: 'action',
  description: 'validateToken behavior claim',
  confidence: claimEvidence.confidence!
});

// 5. Register for defeater monitoring
await defeaterWatcher.register(claimEvidence.id, {
  watchFiles: ['src/auth/validate.ts'],
  watchTests: ['test/auth/validate.test.ts']
});

// Later: Code change detected
const defeaters = await detectDefeaters(storage, {
  changedFiles: ['src/auth/validate.ts']
});
// Defeater created, claim signal strength reduced
```

### Query Example

```typescript
// User asks: "Why is validateToken claim marked as uncertain?"

// 1. Get the evidence chain
const chain = await ledger.getChain(claimEvidenceId);
// Returns: extraction -> retrieval -> claim, all with confidence

// 2. Find active defeaters
const defeaters = await storage.getDefeatersForClaim(claimEvidenceId);
// Returns: code_change defeater from yesterday

// 3. Explain causally
const causes = findCauses(causalGraph, claimEvidenceId);
// Returns: The extraction and retrieval that supported this claim

// 4. Format response
response = {
  claim: "validateToken correctly rejects expired tokens",
  currentConfidence: 0.62,  // Reduced from 0.82
  reason: "Code in src/auth/validate.ts was modified after this claim was made",
  supportingEvidence: chain.evidence.map(formatEvidence),
  defeaters: defeaters.map(formatDefeater),
  recommendation: "Revalidate claim by re-analyzing the modified code"
};
```

---

## 6. Implementation Notes

### Lessons Learned from LiBrainian

**1. Start with absent confidence everywhere**

When building a new system, every operation should start with `{ type: 'absent', reason: 'uncalibrated' }`. This forces you to:
- Build calibration infrastructure before claiming confidence
- Handle the "we don't know" case gracefully
- Avoid false precision from day one

**2. Make the ledger the source of truth**

Every epistemic operation should go through the ledger. If it's not logged, it didn't happen. This enables:
- Complete reproducibility of reasoning
- Debugging of incorrect claims
- Training data for calibration

**3. Defeaters are not failures**

A claim with active defeaters is not a system failure. It's the system being honest about uncertainty. The UI should surface defeaters as "things you should know about this claim" rather than hiding them.

**4. Causal graphs get big fast**

In a real codebase, the causal graph can grow to millions of nodes. Practical systems need:
- Incremental graph construction (don't rebuild from scratch)
- Efficient traversal with depth limits
- Pruning of low-confidence edges
- Lazy loading of distant ancestors/descendants

**5. Type-level enforcement matters**

The TypeScript type system can prevent many confidence errors at compile time:

```typescript
// This is a compile error - you can't pass a raw number
function recordClaim(confidence: ConfidenceValue): void;
recordClaim(0.85);  // Error: number is not assignable to ConfidenceValue

// You must use the proper constructors
recordClaim(deterministic(true, 'test_passed'));  // OK
recordClaim(absent('uncalibrated'));               // OK
```

**6. Calibration is never "done"**

Distribution shift happens. Code changes. LLM behavior drifts. Build continuous calibration monitoring into the system from the start, not as an afterthought.

### Performance Considerations

**Evidence Ledger**:
- Use WAL mode for SQLite (concurrent reads during writes)
- Index on `(kind, timestamp)` for common queries
- Batch appends for high-throughput scenarios
- Consider time-based partitioning for large ledgers

**Defeater Detection**:
- File system watchers for code change detection
- Batch defeater checks during idle time
- Priority queue for high-severity defeaters
- Debounce rapid file changes

**Causal Graph**:
- Adjacency list representation for sparse graphs
- Memoize traversal results with TTL
- Limit depth by default (most queries want immediate causes)
- Consider graph databases for very large codebases

---

## Conclusion

These four patterns - ConfidenceValue, Evidence Ledger, Defeater, and Causal Graph - provide a foundation for building AI systems that are honest about what they know.

The key principles:

1. **No arbitrary numbers**: Every confidence value must explain its provenance
2. **Append-only evidence**: All epistemic events are recorded immutably
3. **Explicit defeaters**: Track what could invalidate claims
4. **Causal structure**: Enable "why did this happen" queries

These patterns do not solve AI hallucination or guarantee correctness. They do provide the infrastructure for users to understand how claims were derived and what could prove them wrong.

Confidence without provenance is theater. These patterns make the epistemic process visible.

---

## References

1. Pollock, J. L. (1987). "Defeasible Reasoning." Cognitive Science.
2. Pearl, J. (2009). "Causality: Models, Reasoning, and Inference."
3. Guo, C. et al. (2017). "On Calibration of Modern Neural Networks." ICML.
4. Spirtes, P. et al. (2000). "Causation, Prediction, and Search."
5. Naeini, M. P. et al. (2015). "Obtaining Well Calibrated Probabilities Using Bayesian Binning." AAAI.

---

## Appendix A: Type Definitions Summary

```typescript
// ConfidenceValue
type ConfidenceValue =
  | { type: 'deterministic'; value: 0.0 | 1.0; reason: string }
  | { type: 'measured'; value: number; measurement: MeasurementData }
  | { type: 'derived'; value: number; formula: string; inputs: Input[] }
  | { type: 'bounded'; low: number; high: number; basis: string; citation: string }
  | { type: 'absent'; reason: 'uncalibrated' | 'insufficient_data' | 'not_applicable' };

// Evidence Entry
interface EvidenceEntry {
  id: EvidenceId;
  timestamp: Date;
  kind: EvidenceKind;
  payload: EvidencePayload;
  provenance: EvidenceProvenance;
  confidence?: ConfidenceValue;
  relatedEntries: EvidenceId[];
  sessionId?: SessionId;
}

// Defeater
interface ExtendedDefeater {
  id: string;
  type: ExtendedDefeaterType;
  description: string;
  severity: 'full' | 'partial' | 'warning';
  affectedClaimIds: ClaimId[];
  confidenceReduction: number;
  autoResolvable: boolean;
  resolutionAction?: string;
  evidence: string;
  status: 'pending' | 'active' | 'resolved';
}

// Causal Graph
interface CausalGraph {
  id: string;
  nodes: Map<string, CausalNode>;
  edges: CausalEdge[];
  meta: CausalGraphMeta;
}

interface CausalEdge {
  from: string;
  to: string;
  type: 'causes' | 'enables' | 'prevents' | 'correlates';
  strength: number;
  evidence: EvidenceRef[];
}
```

---

## Appendix B: Decision Matrix

| Situation | Pattern to Use | Why |
|-----------|---------------|-----|
| AST parse succeeded | Deterministic(1.0) | Logically certain |
| LLM made a claim | Absent('uncalibrated') | No measurement data yet |
| After 1000 calibration samples | Measured | Have empirical accuracy |
| Pipeline of 3 steps | Derived(min) | Weakest link determines overall |
| Literature says 60-90% accuracy | Bounded | Theoretical basis, no local data |
| File was modified | Defeater(code_change) | Evidence may be stale |
| User asks "why?" | Causal traversal | Find root causes |
| Claims contradict | Defeater(contradiction) | Mark both, don't reconcile |
