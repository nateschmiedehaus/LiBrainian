# LiBrainian Enhancement Implementation Plan

> **Status**: APPROVED FOR IMPLEMENTATION
> **Version**: 1.0
> **Date**: 2026-01-30
> **Author**: Synthesized from Research Documents

---

## Executive Summary

This implementation plan synthesizes findings from seven research documents into a concrete, phased roadmap for enhancing LiBrainian. The plan prioritizes high-impact, low-effort improvements that leverage existing infrastructure.

**Key Insight**: LiBrainian is 60-70% ready. Most enhancements are integration work, not greenfield development.

### Research Documents Synthesized

| Document | Key Contribution |
|----------|------------------|
| Argumentation Structures | 8 argument edge types (Toulmin-IBIS hybrid) |
| Usage-Weighted Prioritization | Hotspot scoring formula, existing foundations strong |
| Multi-Graph Importance | Cross-graph importance propagation |
| Multi-Perspective Views | 7 perspectives with query-time filters |
| Cascading Impact Propagation | Spreading activation with threshold pruning |
| Capability Gap Analysis | 60-70% infrastructure exists |
| Usability Analysis | Token budgeting, error contracts, deterministic mode |

---

## Implementation Phases Overview

```
Phase 1: Quick Wins (Week 1-2)
├── Perspective parameter
├── Hotspot scoring
├── Token budgeting
└── Structured errors

Phase 2: Edge Infrastructure (Week 3-4)
├── Argument edge types
├── Rationale-to-edge conversion
└── Edge-type filtering

Phase 3: Multi-Graph Importance (Week 5-6)
├── Per-graph importance metrics
├── Cross-graph propagation
└── Unified importance score

Phase 4: Cascading Impact (Week 7-8)
├── Spreading activation algorithm
├── Benefit quantification API
└── Blast radius visualization

Phase 5: Full Integration (Week 9-10)
├── Multi-perspective synthesis
├── Deterministic mode
└── API versioning
```

---

## Phase 1: Quick Wins (Week 1-2)

**Goal**: Deliver immediate value with minimal risk. All changes leverage existing infrastructure.

### 1.1 Perspective Parameter

**Impact**: HIGH | **Effort**: LOW | **Risk**: LOW

Add explicit perspective filtering to queries.

#### Files to Modify

| File | Change |
|------|--------|
| `src/types.ts` | Add `perspective?: Perspective` to `LibrarianQuery` |
| `src/api/query.ts` | Add perspective inference from taskType |
| `src/knowledge/t_patterns.ts` | Export T-pattern to perspective mapping |
| `src/cli/commands/query.ts` | Add `--perspective` flag |

#### Type Definitions

```typescript
// Add to src/types.ts

export type Perspective =
  | 'debugging'      // T-19 to T-24: Bug investigation
  | 'security'       // T-27: Security patterns
  | 'performance'    // T-28: Performance anti-patterns
  | 'architecture'   // T-08, T-09, T-29: Design patterns, circular deps
  | 'modification'   // T-13 to T-18: Feature location, breaking changes
  | 'testing'        // T-06, T-17: Test mapping, coverage gaps
  | 'understanding'; // T-07, T-08: Purpose, module architecture

export interface PerspectiveConfig {
  id: Perspective;
  entityTypeWeights: Record<EmbeddableEntityType, number>;
  tPatternCategories: string[];
  signalBoosts: Record<string, number>;
  focusPrompt: string;
}

// Extend LibrarianQuery
export interface LibrarianQuery {
  // ... existing fields ...
  perspective?: Perspective;
  perspectives?: Perspective[];  // For multi-perspective queries
}
```

#### Implementation

```typescript
// Add to src/api/query.ts

const TASK_TYPE_TO_PERSPECTIVE: Record<string, Perspective> = {
  'security_audit': 'security',
  'debugging': 'debugging',
  'performance_audit': 'performance',
  'architecture_review': 'architecture',
  'code_review': 'modification',
  'test_coverage': 'testing',
  'premortem': 'architecture',
  'complexity_audit': 'architecture',
  'integration_risk': 'modification',
};

function inferPerspective(query: LibrarianQuery): Perspective | undefined {
  if (query.perspective) return query.perspective;
  if (query.taskType && query.taskType in TASK_TYPE_TO_PERSPECTIVE) {
    return TASK_TYPE_TO_PERSPECTIVE[query.taskType];
  }
  return undefined;
}
```

#### Success Criteria

- [ ] `LiBrainian query "auth flow" --perspective=security` returns security-focused results
- [ ] Perspective inference from taskType works for all 10 task types
- [ ] Multi-perspective queries combine results correctly

---

### 1.2 Hotspot Scoring

**Impact**: HIGH | **Effort**: LOW | **Risk**: LOW

Add churn * complexity hotspot signal to multi-signal scorer.

#### Files to Modify

| File | Change |
|------|--------|
| `src/graphs/metrics.ts` | Add `computeHotspotScore()` function |
| `src/query/multi_signal_scorer.ts` | Register `HotspotSignalComputer` |
| `src/api/query.ts` | Include hotspot in SCORE_WEIGHTS |

#### Implementation

```typescript
// Add to src/graphs/metrics.ts

export interface HotspotScore {
  entityId: string;
  churn: number;           // From ChangeChurn.changeCount
  complexity: number;      // From QualityComplexity.cyclomatic
  hotspotScore: number;    // Computed score
}

export function computeHotspotScore(
  churn: number,
  complexity: number,
  options: { churnExponent?: number; complexityExponent?: number } = {}
): number {
  const { churnExponent = 0.7, complexityExponent = 0.5 } = options;
  // Damped formula to prevent outliers from dominating
  return Math.pow(Math.max(0, churn), churnExponent) *
         Math.pow(Math.max(1, complexity), complexityExponent);
}
```

```typescript
// Add to src/query/multi_signal_scorer.ts

export class HotspotSignalComputer implements SignalComputer {
  name = 'hotspot';

  async compute(context: SignalContext): Promise<SignalResult> {
    const churn = context.entity.changeChurn?.changeCount ?? 0;
    const complexity = context.entity.quality?.complexity?.cyclomatic ?? 1;
    const score = computeHotspotScore(churn, complexity);
    return {
      score: Math.min(1, score / 100), // Normalize to 0-1
      confidence: 0.8,
      explanation: `Hotspot: churn=${churn}, complexity=${complexity}`
    };
  }
}
```

#### Updated Score Weights

```typescript
// In src/api/query.ts - update SCORE_WEIGHTS
const SCORE_WEIGHTS = {
  semantic: 0.30,      // Reduced from 0.35
  pagerank: 0.18,      // Reduced from 0.20
  centrality: 0.08,    // Reduced from 0.10
  confidence: 0.18,    // Reduced from 0.20
  recency: 0.08,       // Reduced from 0.10
  cochange: 0.08,      // Increased from 0.05
  hotspot: 0.10,       // NEW
};
```

#### Success Criteria

- [ ] Hotspot scores computed for all functions/modules
- [ ] High-churn, high-complexity entities rank higher in relevant queries
- [ ] Score weights sum to 1.0

---

### 1.3 Token-Aware Response Budgeting

**Impact**: HIGH | **Effort**: MEDIUM | **Risk**: LOW

Enable agents to control response size for context window efficiency.

#### Files to Modify

| File | Change |
|------|--------|
| `src/types.ts` | Add `tokenBudget`, `tokenPriority` to `LibrarianQuery` |
| `src/types.ts` | Add `usedTokens`, `truncationApplied` to `LibrarianResponse` |
| `src/api/token_budget.ts` | Implement intelligent truncation |
| `src/cli/commands/query.ts` | Add `--token-budget` flag |

#### Type Definitions

```typescript
// Add to src/types.ts (LibrarianQuery)
export interface LibrarianQuery {
  // ... existing fields ...

  /** Target response size in tokens */
  tokenBudget?: number;

  /** What to preserve when truncating */
  tokenPriority?: 'synthesis' | 'snippets' | 'metadata';
}

// Add to src/types.ts (LibrarianResponse)
export interface LibrarianResponse {
  // ... existing fields ...

  /** Actual tokens used in response */
  usedTokens: number;

  /** Whether truncation was applied */
  truncationApplied: boolean;

  /** Summary of truncation actions */
  truncationSummary?: string;
}
```

#### Implementation

```typescript
// Enhance src/api/token_budget.ts

export interface TruncationConfig {
  budget: number;
  priority: 'synthesis' | 'snippets' | 'metadata';
}

export function intelligentTruncation(
  response: LibrarianResponse,
  config: TruncationConfig
): LibrarianResponse {
  const currentTokens = estimateTokens(response);
  if (currentTokens <= config.budget) {
    return { ...response, usedTokens: currentTokens, truncationApplied: false };
  }

  const truncationSteps: string[] = [];
  let truncated = { ...response };

  // Priority-based truncation
  if (config.priority !== 'metadata') {
    truncated = removeVerboseMetadata(truncated);
    truncationSteps.push('reduced_metadata');
  }

  if (config.priority !== 'snippets' && estimateTokens(truncated) > config.budget) {
    truncated = limitSnippetLength(truncated, 500);
    truncationSteps.push('trimmed_snippets');
  }

  if (estimateTokens(truncated) > config.budget) {
    truncated = limitPackCount(truncated, Math.floor(config.budget / 1000));
    truncationSteps.push('limited_packs');
  }

  return {
    ...truncated,
    usedTokens: estimateTokens(truncated),
    truncationApplied: true,
    truncationSummary: `Applied: ${truncationSteps.join(', ')}`
  };
}
```

#### Success Criteria

- [ ] `--token-budget 2000` produces responses under 2000 tokens
- [ ] Token count appears in all responses
- [ ] Truncation preserves priority content

---

### 1.4 Structured Error Contracts

**Impact**: HIGH | **Effort**: LOW | **Risk**: LOW

Standardize error output for agent parsing.

#### Files to Modify

| File | Change |
|------|--------|
| `src/cli/errors.ts` | Add `ErrorEnvelope` type |
| `src/cli/index.ts` | Output JSON errors when `--json` set |
| `src/core/errors.ts` | Ensure all errors include structured fields |

#### Type Definitions

```typescript
// Add to src/cli/errors.ts

export interface ErrorEnvelope {
  code: string;              // "ERR_PROVIDER_UNAVAILABLE"
  message: string;           // Human-readable
  retryable: boolean;        // Can agent retry?
  retryAfterMs?: number;     // Suggested wait time
  recoveryHints: string[];   // Machine-actionable suggestions
  details: Record<string, unknown>;
}

export const ERROR_METADATA: Record<string, Partial<ErrorEnvelope>> = {
  'ERR_NOT_BOOTSTRAPPED': {
    retryable: true,
    retryAfterMs: 0,
    recoveryHints: ['Run LiBrainian bootstrap first']
  },
  'ERR_PROVIDER_UNAVAILABLE': {
    retryable: true,
    retryAfterMs: 5000,
    recoveryHints: ['Check provider configuration', 'Verify network connectivity']
  },
  'ERR_TIMEOUT': {
    retryable: true,
    retryAfterMs: 1000,
    recoveryHints: ['Increase timeout with --timeout flag', 'Use lower depth level']
  },
  // ... etc
};
```

#### Success Criteria

- [ ] All errors include `code`, `retryable`, `recoveryHints`
- [ ] JSON error output matches `ErrorEnvelope` schema
- [ ] Agents can programmatically decide retry behavior

---

## Phase 2: Edge Infrastructure (Week 3-4)

**Goal**: Extend the knowledge graph with argument/reasoning edges.

### 2.1 Argument Edge Types

**Impact**: HIGH | **Effort**: MEDIUM | **Risk**: MEDIUM

Add 8 new edge types for argumentative relationships.

#### Files to Modify

| File | Change |
|------|--------|
| `src/storage/types.ts` | Extend `KnowledgeEdgeType` union |
| `src/storage/sqlite_storage.ts` | Update storage queries |
| `src/api/evidence.ts` | Link evidence to argument edges |

#### Type Extension

```typescript
// Extend in src/storage/types.ts

export type KnowledgeEdgeType =
  // Existing (15 types)
  | 'imports' | 'calls' | 'extends' | 'implements' | 'clone_of'
  | 'debt_related' | 'authored_by' | 'reviewed_by' | 'evolved_from'
  | 'co_changed' | 'tests' | 'documents' | 'depends_on' | 'similar_to' | 'part_of'

  // NEW: Argument edges (8 types from Toulmin-IBIS research)
  | 'supports'            // A provides evidence for B
  | 'warrants'            // A provides reasoning principle for B
  | 'qualifies'           // A limits scope/confidence of B
  | 'contradicts'         // A conflicts with B
  | 'undermines'          // A weakens premise of B
  | 'rebuts'              // A provides defeating condition for B
  | 'supersedes'          // A replaces B as accepted decision
  | 'depends_on_decision'; // A requires decision B

// Argument-specific entity types
export type ArgumentEntityType =
  | 'decision'      // ADR or architectural decision
  | 'constraint'    // Technical/business constraint
  | 'assumption'    // Validated or unvalidated assumption
  | 'alternative'   // Considered but rejected approach
  | 'tradeoff'      // Gained/sacrificed pair
  | 'risk'          // Accepted risk
  | 'evidence'      // Supporting evidence
  | 'principle';    // Design principle or pattern
```

#### Storage Schema Migration

```sql
-- Migration for argument edges
-- Note: Uses existing knowledge_edges table, just new edge_type values

-- Add index for argument edge queries
CREATE INDEX IF NOT EXISTS idx_knowledge_edges_argument
ON knowledge_edges(edge_type)
WHERE edge_type IN (
  'supports', 'warrants', 'qualifies', 'contradicts',
  'undermines', 'rebuts', 'supersedes', 'depends_on_decision'
);

-- Add argument_metadata column for Toulmin components
ALTER TABLE knowledge_edges ADD COLUMN argument_metadata TEXT;
```

#### Success Criteria

- [ ] All 8 argument edge types persist to storage
- [ ] `getKnowledgeEdges({ edgeType: 'supports' })` returns correct results
- [ ] Argument metadata (warrant, qualifier, rebuttal) stored correctly

---

### 2.2 Rationale-to-Edge Conversion

**Impact**: HIGH | **Effort**: MEDIUM | **Risk**: MEDIUM

Convert existing `EntityRationale` node properties to graph edges.

#### Files to Modify

| File | Change |
|------|--------|
| `src/knowledge/extractors/rationale_extractor.ts` | Add edge production |
| `src/graphs/knowledge_graph.ts` | Add `buildArgumentEdges()` |

#### New Function

```typescript
// Add to src/graphs/knowledge_graph.ts

export interface ArgumentEdgeBuilder {
  buildFromRationale(rationale: EntityRationale, entityId: string): KnowledgeGraphEdge[];
}

export function buildArgumentEdges(
  rationale: EntityRationale,
  entityId: string
): KnowledgeGraphEdge[] {
  const edges: KnowledgeGraphEdge[] = [];
  const now = new Date().toISOString();

  // Decisions -> depends_on_decision edges
  for (const decision of rationale.architecturalDecisions ?? []) {
    if (decision.supersededBy) {
      edges.push({
        id: `arg:${decision.id}:superseded:${decision.supersededBy}`,
        sourceId: decision.supersededBy,
        targetId: decision.id,
        sourceType: 'decision',
        targetType: 'decision',
        edgeType: 'supersedes',
        weight: 1.0,
        confidence: 0.9,
        metadata: { reason: 'ADR evolution' },
        computedAt: now,
      });
    }
  }

  // Constraints -> supports edges
  for (const constraint of rationale.constraints ?? []) {
    edges.push({
      id: `arg:constraint:${constraint.id}:supports:${entityId}`,
      sourceId: `constraint:${constraint.id}`,
      targetId: entityId,
      sourceType: 'constraint',
      targetType: 'function',
      edgeType: 'supports',
      weight: constraint.type === 'regulatory' ? 1.0 : 0.8,
      confidence: 0.8,
      metadata: { constraintType: constraint.type },
      computedAt: now,
    });
  }

  // Alternatives -> contradicts edges
  for (const alt of rationale.consideredAlternatives ?? []) {
    edges.push({
      id: `arg:alt:${alt.id}:contradicts:${entityId}`,
      sourceId: `alternative:${alt.id}`,
      targetId: entityId,
      sourceType: 'alternative',
      targetType: 'decision',
      edgeType: 'contradicts',
      weight: 1.0,
      confidence: 0.85,
      metadata: { whyRejected: alt.whyRejected },
      computedAt: now,
    });
  }

  // Assumptions -> qualifies edges
  for (const assumption of rationale.assumptions ?? []) {
    edges.push({
      id: `arg:assume:${assumption.id}:qualifies:${entityId}`,
      sourceId: `assumption:${assumption.id}`,
      targetId: entityId,
      sourceType: 'assumption',
      targetType: 'function',
      edgeType: 'qualifies',
      weight: assumption.validated ? 0.9 : 0.6,
      confidence: assumption.validated ? 0.9 : 0.5,
      metadata: { validated: assumption.validated },
      computedAt: now,
    });
  }

  return edges;
}
```

#### Success Criteria

- [ ] Rationale extractor produces argument edges
- [ ] Edges persisted to knowledge graph storage
- [ ] Graph queries can traverse argument edges

---

### 2.3 Edge-Type Filtering in Queries

**Impact**: MEDIUM | **Effort**: LOW | **Risk**: LOW

Enable filtering graph traversal by edge type.

#### Files to Modify

| File | Change |
|------|--------|
| `src/storage/types.ts` | Extend `KnowledgeEdgeQueryOptions` |
| `src/api/query.ts` | Use edge type filters in context assembly |

#### Implementation

```typescript
// Extend in src/storage/types.ts

export interface KnowledgeEdgeQueryOptions {
  // ... existing fields ...

  /** Filter to specific edge types */
  edgeTypes?: KnowledgeEdgeType[];

  /** Exclude these edge types */
  excludeEdgeTypes?: KnowledgeEdgeType[];

  /** Include argument edges */
  includeArgumentEdges?: boolean;
}
```

#### Success Criteria

- [ ] `getKnowledgeEdges({ edgeTypes: ['supports', 'warrants'] })` works
- [ ] Argument edges can be excluded from structural queries

---

## Phase 3: Multi-Graph Importance (Week 5-6)

**Goal**: Compute importance across code, rationale, epistemic, and organizational graphs.

### 3.1 Per-Graph Importance Metrics

**Impact**: HIGH | **Effort**: MEDIUM | **Risk**: MEDIUM

Implement importance calculations for each graph type.

#### New Files to Create

| File | Purpose |
|------|---------|
| `src/graphs/importance_types.ts` | Type definitions for all importance metrics |
| `src/graphs/rationale_importance.ts` | Foundationality, activity, constraint load |
| `src/graphs/epistemic_importance.ts` | Epistemic load, evidence depth, vulnerability |
| `src/graphs/org_importance.ts` | Truck factor, expertise depth |

#### Type Definitions

```typescript
// New file: src/graphs/importance_types.ts

export interface CodeImportance {
  pageRank: number;
  betweenness: number;
  closeness: number;
  cochangeStrength: number;
  hotspot: number;
}

export interface RationaleImportance {
  foundationalityScore: number;  // How many decisions depend on this
  activityScore: number;         // 0 if superseded, 1 if accepted
  tradeoffCentrality: number;    // How many concerns balanced
  constraintLoad: number;        // How many constraints created
}

export interface EpistemicImportance {
  epistemicLoad: number;         // How many claims depend on this
  evidenceDepth: number;         // Layers of supporting evidence
  vulnerability: number;         // Susceptibility to defeat
  contradictionCentrality: number;
}

export interface OrgImportance {
  ownershipConcentration: number; // Truck factor risk (1 = high risk)
  expertiseDepth: number;
  reviewCoverage: number;
}

export interface ImportanceProfile {
  entityId: string;
  code: CodeImportance;
  rationale: RationaleImportance;
  epistemic: EpistemicImportance;
  org: OrgImportance;
  unified: number;              // Weighted combination
  crossGraphInfluence: number;  // Impact across graph boundaries

  // Interpretive flags
  isLoadBearing: boolean;       // High epistemic load
  isFoundational: boolean;      // High rationale foundationality
  isAtRisk: boolean;            // High truck factor or vulnerability
  needsValidation: boolean;     // High importance + low confidence
}
```

#### Rationale Importance Implementation

```typescript
// New file: src/graphs/rationale_importance.ts

export function computeFoundationalityScore(
  decision: ArchitecturalDecision,
  edges: KnowledgeGraphEdge[],
  storage: LibrarianStorage
): number {
  // Count decisions that cite this one
  const supportsCount = edges.filter(
    e => e.edgeType === 'depends_on_decision' && e.targetId === decision.id
  ).length;

  // Count code entities referencing this decision
  const codeRefs = edges.filter(
    e => e.edgeType === 'documents' && e.sourceId === decision.id
  ).length;

  // Transitive reach (BFS depth-weighted)
  const transitiveReach = computeTransitiveReach(decision.id, edges, 3);

  return 0.4 * normalize(supportsCount) +
         0.4 * normalize(codeRefs) +
         0.2 * normalize(transitiveReach);
}

export function computeActivityScore(decision: ArchitecturalDecision): number {
  switch (decision.status) {
    case 'superseded': return 0.0;
    case 'deprecated': return 0.3;
    case 'accepted': return 1.0;
    case 'proposed': return 0.5;
    default: return 0.5;
  }
}
```

#### Success Criteria

- [ ] Per-graph importance computed for all entities
- [ ] Importance profiles accessible via API
- [ ] Load-bearing entities identified automatically

---

### 3.2 Cross-Graph Importance Propagation

**Impact**: HIGH | **Effort**: HIGH | **Risk**: MEDIUM

Propagate importance across graph boundaries.

#### Files to Modify

| File | Change |
|------|--------|
| `src/graphs/importance_types.ts` | Add cross-graph edge types |
| New: `src/graphs/cross_graph_propagation.ts` | Propagation algorithm |

#### Cross-Graph Edge Types

```typescript
// Add to src/graphs/importance_types.ts

export type CrossGraphEdgeType =
  | 'documented_by_decision'   // Code -> Rationale
  | 'constrained_by_decision'  // Code -> Rationale
  | 'justified_by_claim'       // Rationale -> Epistemic
  | 'assumes_claim'            // Rationale -> Epistemic
  | 'verified_by_test'         // Epistemic -> Code
  | 'evidenced_by_code'        // Epistemic -> Code
  | 'owned_by_expert'          // Any -> Org
  | 'decided_by';              // Rationale -> Org

export const CROSS_GRAPH_DAMPING: Record<CrossGraphEdgeType, number> = {
  'documented_by_decision': 0.8,
  'constrained_by_decision': 0.7,
  'justified_by_claim': 0.7,
  'assumes_claim': 0.5,
  'verified_by_test': 0.9,
  'evidenced_by_code': 0.7,
  'owned_by_expert': 0.3,
  'decided_by': 0.5,
};
```

#### Propagation Algorithm

```typescript
// New file: src/graphs/cross_graph_propagation.ts

export async function propagateCrossGraphImportance(
  storage: LibrarianStorage,
  entityId: string,
  alpha: number = 0.3  // Local vs propagated weight
): Promise<number> {
  const visited = new Set<string>();
  const cache = new Map<string, number>();

  async function recurse(id: string): Promise<number> {
    if (cache.has(id)) return cache.get(id)!;
    if (visited.has(id)) return 0;
    visited.add(id);

    // Get local importance
    const local = await getLocalImportance(storage, id);

    // Get cross-graph edges
    const edges = await storage.getKnowledgeEdgesFrom(id);
    const crossEdges = edges.filter(e => isCrossGraphEdge(e.edgeType));

    // Accumulate incoming importance
    let incoming = 0;
    for (const edge of crossEdges) {
      const sourceImportance = await recurse(edge.sourceId);
      const damping = CROSS_GRAPH_DAMPING[edge.edgeType as CrossGraphEdgeType] ?? 0.5;
      incoming += sourceImportance * damping * edge.weight;
    }

    const combined = alpha * local + (1 - alpha) * incoming;
    cache.set(id, combined);
    return combined;
  }

  return recurse(entityId);
}
```

#### Success Criteria

- [ ] Importance propagates from code to rationale to epistemic
- [ ] Bidirectional propagation works correctly
- [ ] No infinite loops on cyclic graphs

---

### 3.3 Unified Importance Score

**Impact**: MEDIUM | **Effort**: LOW | **Risk**: LOW

Combine per-graph scores into unified importance.

#### Implementation

```typescript
// Add to src/graphs/importance_types.ts

export interface UnifiedImportanceWeights {
  code: number;       // Default: 0.30
  rationale: number;  // Default: 0.20
  epistemic: number;  // Default: 0.25
  org: number;        // Default: 0.10
  crossGraph: number; // Default: 0.15
}

export const DEFAULT_IMPORTANCE_WEIGHTS: UnifiedImportanceWeights = {
  code: 0.30,
  rationale: 0.20,
  epistemic: 0.25,
  org: 0.10,
  crossGraph: 0.15,
};

export function computeUnifiedImportance(
  profile: Omit<ImportanceProfile, 'unified' | 'crossGraphInfluence'>,
  weights: UnifiedImportanceWeights = DEFAULT_IMPORTANCE_WEIGHTS
): number {
  return (
    weights.code * normalizeCodeImportance(profile.code) +
    weights.rationale * normalizeRationaleImportance(profile.rationale) +
    weights.epistemic * normalizeEpistemicImportance(profile.epistemic) +
    weights.org * normalizeOrgImportance(profile.org)
  );
}
```

#### Success Criteria

- [ ] Unified score between 0 and 1
- [ ] Weights are configurable
- [ ] Score influences query ranking

---

## Phase 4: Cascading Impact (Week 7-8)

**Goal**: Quantify how changes propagate through the system.

### 4.1 Spreading Activation Algorithm

**Impact**: HIGH | **Effort**: HIGH | **Risk**: MEDIUM

Implement threshold-pruned spreading activation for impact analysis.

#### New Files to Create

| File | Purpose |
|------|---------|
| `src/cascade/types.ts` | CascadeQuery, CascadeResult types |
| `src/cascade/spreading_activation.ts` | Core algorithm |
| `src/cascade/propagation_factors.ts` | Edge-type specific factors |

#### Type Definitions

```typescript
// New file: src/cascade/types.ts

export interface CascadeQuery {
  sourceId: string;
  sourceGraph: 'code' | 'rationale' | 'epistemic' | 'org';
  direction: 'benefit' | 'risk';
  changeType?: 'optimize' | 'break' | 'modify' | 'remove';
  changeContext?: {
    description: string;
    usageCount?: number;
    performanceImprovement?: number;
    breakingSeverity?: 'minor' | 'major' | 'critical';
  };
}

export interface CascadeConfig {
  maxDepth: number;          // Default: 10
  threshold: number;         // Default: 0.01
  maxNodes: number;          // Default: 1000
  includeCrossGraph: boolean; // Default: true
}

export interface CascadeResult {
  source: CascadeNode;
  direction: 'benefit' | 'risk';
  totalImpactScore: number;
  maxImpactScore: number;
  nodesAffected: number;
  graphsAffected: string[];
  impactByGraph: Record<string, CascadeNode[]>;
  criticalPaths: CascadePath[];
  recommendations: Recommendation[];
  visualization: CascadeVisualization;
}

export interface CascadeNode {
  id: string;
  graph: 'code' | 'rationale' | 'epistemic' | 'org';
  type: string;
  label: string;
  impactScore: number;
  depth: number;
  pathFromSource: string[];
  impactReason: string;
  contributingEdges: Array<{
    fromId: string;
    edgeType: string;
    contribution: number;
  }>;
}
```

#### Spreading Activation Implementation

```typescript
// New file: src/cascade/spreading_activation.ts

export async function spreadingActivation(
  storage: LibrarianStorage,
  source: string,
  direction: 'benefit' | 'risk',
  config: CascadeConfig
): Promise<Map<string, CascadeNode>> {
  const impact = new Map<string, CascadeNode>();
  const factors = direction === 'risk' ? RISK_FACTORS : BENEFIT_FACTORS;

  // Initialize source
  impact.set(source, {
    id: source,
    graph: 'code',
    type: 'function',
    label: source,
    impactScore: 1.0,
    depth: 0,
    pathFromSource: [source],
    impactReason: 'Source of change',
    contributingEdges: [],
  });

  let frontier = new Set([source]);

  while (frontier.size > 0 && impact.size < config.maxNodes) {
    const nextFrontier = new Set<string>();

    for (const nodeId of frontier) {
      const node = impact.get(nodeId)!;
      if (node.impactScore < config.threshold) continue;
      if (node.depth >= config.maxDepth) continue;

      // Get outgoing edges (for benefit: callers, for risk: also callers)
      const edges = await storage.getKnowledgeEdgesTo(nodeId);

      for (const edge of edges) {
        const factor = factors[edge.edgeType] ?? 0.5;
        const propagatedImpact = node.impactScore * factor * edge.weight;

        if (propagatedImpact < config.threshold) continue;

        const existing = impact.get(edge.sourceId);
        if (!existing || propagatedImpact > existing.impactScore) {
          impact.set(edge.sourceId, {
            id: edge.sourceId,
            graph: determineGraph(edge.sourceType),
            type: edge.sourceType,
            label: edge.sourceId,
            impactScore: propagatedImpact,
            depth: node.depth + 1,
            pathFromSource: [...node.pathFromSource, edge.sourceId],
            impactReason: `${edge.edgeType} from ${nodeId}`,
            contributingEdges: [{
              fromId: nodeId,
              edgeType: edge.edgeType,
              contribution: propagatedImpact,
            }],
          });
          nextFrontier.add(edge.sourceId);
        }
      }
    }

    frontier = nextFrontier;
  }

  return impact;
}
```

#### Propagation Factors

```typescript
// New file: src/cascade/propagation_factors.ts

export const RISK_FACTORS: Record<string, number> = {
  imports: 0.9,
  calls: 0.85,
  extends: 0.95,
  implements: 0.7,
  clone_of: 0.3,
  co_changed: 0.5,
  tests: 0.8,
  documents: 0.1,
  part_of: 0.7,
  // Cross-graph
  documented_by_decision: 0.7,
  constrained_by_decision: 0.8,
  justified_by_claim: 0.6,
  assumes_claim: 0.9,
  verified_by_test: 0.4,
  owned_by: 0.3,
};

export const BENEFIT_FACTORS: Record<string, number> = {
  imports: 0.3,
  calls: 0.6,
  extends: 0.4,
  implements: 0.2,
  clone_of: 0.1,
  co_changed: 0.3,
  tests: 0.1,
  documents: 0.05,
  part_of: 0.5,
  // Cross-graph
  documented_by_decision: 0.3,
  constrained_by_decision: 0.4,
  justified_by_claim: 0.2,
  assumes_claim: 0.3,
  verified_by_test: 0.6,
  owned_by: 0.1,
};
```

#### Success Criteria

- [ ] Spreading activation terminates in < 500ms for typical graphs
- [ ] Threshold pruning limits result set size
- [ ] Cross-graph propagation works correctly

---

### 4.2 Benefit Quantification API

**Impact**: MEDIUM | **Effort**: MEDIUM | **Risk**: LOW

Estimate value of optimizing an entity.

#### New File

```typescript
// New file: src/cascade/benefit.ts

export interface BenefitEstimate {
  sourceEntity: {
    id: string;
    name: string;
    usagePerDay: number;
    performanceImprovement: number;
  };
  directBenefit: {
    timeSavedPerDay: number;
    callsAffected: number;
  };
  cascadingBenefit: {
    upstreamCallersAffected: number;
    totalTimeSavedPerDay: number;
    topBeneficiaries: Array<{
      id: string;
      name: string;
      benefitShare: number;
    }>;
  };
  totalBenefit: {
    timeSavedPerDay: number;
    annualTimeSaved: number;
    fteEquivalent: number;
  };
  confidence: number;
  assumptions: string[];
}

export async function estimateBenefitOfOptimizing(
  storage: LibrarianStorage,
  entityId: string,
  msImprovement: number,
  dailyUsage: number
): Promise<BenefitEstimate> {
  // Get cascade impact
  const impact = await spreadingActivation(storage, entityId, 'benefit', {
    maxDepth: 5,
    threshold: 0.01,
    maxNodes: 500,
    includeCrossGraph: false,
  });

  // Calculate direct benefit
  const directSaved = dailyUsage * msImprovement;

  // Calculate cascading benefit
  let totalCascading = 0;
  const beneficiaries: BenefitEstimate['cascadingBenefit']['topBeneficiaries'] = [];

  for (const [id, node] of impact) {
    if (id === entityId) continue;
    const callerUsage = await getUsageEstimate(storage, id);
    const benefit = callerUsage * msImprovement * node.impactScore;
    totalCascading += benefit;
    beneficiaries.push({ id, name: id, benefitShare: benefit / (directSaved + totalCascading) });
  }

  const totalDaily = directSaved + totalCascading;
  const annual = totalDaily * 365;
  const fteHours = annual / (1000 * 60 * 60 * 2000); // ms -> hours -> FTE

  return {
    sourceEntity: { id: entityId, name: entityId, usagePerDay: dailyUsage, performanceImprovement: msImprovement },
    directBenefit: { timeSavedPerDay: directSaved, callsAffected: dailyUsage },
    cascadingBenefit: {
      upstreamCallersAffected: impact.size - 1,
      totalTimeSavedPerDay: totalCascading,
      topBeneficiaries: beneficiaries.slice(0, 10),
    },
    totalBenefit: { timeSavedPerDay: totalDaily, annualTimeSaved: annual, fteEquivalent: fteHours },
    confidence: 0.7,
    assumptions: ['Usage estimates based on call graph centrality', 'Linear scaling assumed'],
  };
}
```

#### Success Criteria

- [ ] Benefit estimates returned for any entity
- [ ] Cascading benefits account for graph structure
- [ ] Results include confidence and assumptions

---

### 4.3 Blast Radius Visualization

**Impact**: MEDIUM | **Effort**: LOW | **Risk**: LOW

Generate text and diagram visualizations of impact.

#### New File

```typescript
// New file: src/cascade/visualization.ts

export function generateTextVisualization(result: CascadeResult): string {
  const lines: string[] = [
    `CASCADING IMPACT ANALYSIS: ${result.direction.toUpperCase()} on ${result.source.label}`,
    '='.repeat(60),
    '',
    `Source: ${result.source.id}`,
    `Direction: ${result.direction.toUpperCase()}`,
    `Total Nodes Affected: ${result.nodesAffected}`,
    `Graphs Affected: ${result.graphsAffected.join(', ')}`,
    '',
    'IMPACT BY DEPTH:',
  ];

  const byDepth = new Map<number, CascadeNode[]>();
  for (const nodes of Object.values(result.impactByGraph)) {
    for (const node of nodes) {
      const depth = node.depth;
      if (!byDepth.has(depth)) byDepth.set(depth, []);
      byDepth.get(depth)!.push(node);
    }
  }

  for (const [depth, nodes] of [...byDepth.entries()].sort((a, b) => a[0] - b[0])) {
    const maxImpact = Math.max(...nodes.map(n => n.impactScore));
    lines.push(`  Depth ${depth}: ${nodes.length} nodes, max impact ${maxImpact.toFixed(2)}`);
    for (const node of nodes.slice(0, 3)) {
      lines.push(`    - ${node.label} (${node.impactScore.toFixed(2)})`);
    }
    if (nodes.length > 3) lines.push(`    ... and ${nodes.length - 3} more`);
  }

  lines.push('', 'RECOMMENDATIONS:');
  for (const rec of result.recommendations) {
    lines.push(`  [${rec.priority.toUpperCase()}] ${rec.message}`);
  }

  return lines.join('\n');
}

export function generateMermaidDiagram(result: CascadeResult, maxNodes: number = 20): string {
  const lines: string[] = ['graph TD'];
  const topNodes = [...Object.values(result.impactByGraph)]
    .flat()
    .sort((a, b) => b.impactScore - a.impactScore)
    .slice(0, maxNodes);

  for (const node of topNodes) {
    const style = node.impactScore > 0.7 ? 'critical' :
                  node.impactScore > 0.4 ? 'high' :
                  node.impactScore > 0.2 ? 'medium' : 'low';
    lines.push(`  ${sanitizeId(node.id)}["${node.label}"]:::${style}`);
  }

  for (const node of topNodes) {
    for (const edge of node.contributingEdges.slice(0, 2)) {
      if (topNodes.some(n => n.id === edge.fromId)) {
        lines.push(`  ${sanitizeId(edge.fromId)} -->|${edge.edgeType}| ${sanitizeId(node.id)}`);
      }
    }
  }

  lines.push('  classDef critical fill:#ff6b6b');
  lines.push('  classDef high fill:#ffd93d');
  lines.push('  classDef medium fill:#6bcb77');
  lines.push('  classDef low fill:#4d96ff');

  return lines.join('\n');
}
```

#### Success Criteria

- [ ] Text visualization fits in terminal
- [ ] Mermaid diagram renders correctly
- [ ] Top impacted nodes visible at a glance

---

## Phase 5: Full Integration (Week 9-10)

**Goal**: Complete the enhancement suite with remaining features.

### 5.1 Multi-Perspective Synthesis

**Impact**: MEDIUM | **Effort**: HIGH | **Risk**: MEDIUM

Combine multiple perspectives in single query response.

#### Files to Modify

| File | Change |
|------|--------|
| `src/api/query.ts` | Handle `perspectives[]` parameter |
| `src/api/query_synthesis.ts` | Multi-perspective synthesis prompt |

#### Implementation Sketch

```typescript
// Add to src/api/query.ts

async function handleMultiPerspectiveQuery(
  query: LibrarianQuery,
  perspectives: Perspective[]
): Promise<LibrarianResponse> {
  // Run retrieval for each perspective
  const perspectiveResults = await Promise.all(
    perspectives.map(p => runSinglePerspectiveRetrieval(query, p))
  );

  // Merge and deduplicate
  const merged = mergeContextPacks(perspectiveResults);

  // Synthesize with perspective-aware prompt
  const synthesis = await synthesizeMultiPerspective(merged, perspectives);

  return {
    ...baseResponse,
    packs: merged,
    synthesis,
    metadata: {
      ...baseMetadata,
      perspectives,
    },
  };
}
```

#### Success Criteria

- [ ] `--perspectives=security,architecture` works
- [ ] Response shows per-perspective findings
- [ ] Conflicts between perspectives identified

---

### 5.2 Deterministic Output Mode

**Impact**: MEDIUM | **Effort**: LOW | **Risk**: LOW

Enable reproducible outputs for testing.

#### Files to Modify

| File | Change |
|------|--------|
| `src/types.ts` | Add `deterministic?: boolean` to LibrarianQuery |
| `src/api/query.ts` | Implement deterministic behavior |
| `src/cli/commands/query.ts` | Add `--deterministic` flag |

#### Implementation

```typescript
// Add to src/api/query.ts

function applyDeterministicMode(query: LibrarianQuery, response: LibrarianResponse): LibrarianResponse {
  if (!query.deterministic) return response;

  // Sort packs by stable key
  const sortedPacks = [...response.packs].sort((a, b) => a.packId.localeCompare(b.packId));

  // Remove LLM synthesis (non-deterministic)
  const synthesis = undefined;

  // Add fingerprint for verification
  const queryFingerprint = hashQuery(query);

  return {
    ...response,
    packs: sortedPacks,
    synthesis,
    metadata: {
      ...response.metadata,
      deterministic: true,
      queryFingerprint,
    },
  };
}
```

#### Success Criteria

- [ ] Same query produces same output when `--deterministic`
- [ ] No LLM synthesis in deterministic mode
- [ ] Query fingerprint enables verification

---

### 5.3 Response Schema Versioning

**Impact**: LOW | **Effort**: LOW | **Risk**: LOW

Add schema version to responses.

#### Implementation

```typescript
// Add to src/types.ts

export interface LibrarianResponse {
  /** Schema identifier */
  $schema: 'LiBrainian-response/v1';

  /** Current response version */
  $version: string;

  /** Deprecated fields (warning) */
  $deprecated?: string[];

  // ... existing fields ...
}
```

#### Success Criteria

- [ ] All responses include `$schema` and `$version`
- [ ] Breaking changes increment version appropriately

---

## Risk Mitigation

### Technical Risks

| Risk | Mitigation |
|------|------------|
| Performance degradation from new signals | Profile before/after; add signal computation budget |
| Storage schema migration issues | Use additive changes only; no column removals |
| Cross-graph cycles causing infinite loops | Track visited nodes globally; add depth limit |
| Large cascade results exceeding memory | Enforce maxNodes limit; use streaming for large graphs |

### Process Risks

| Risk | Mitigation |
|------|------------|
| Scope creep | Each phase has clear success criteria; defer nice-to-haves |
| Integration conflicts | Feature branches; CI testing before merge |
| LLM dependency for extraction | Graceful fallback when LLM unavailable |

### Rollback Plan

Each phase should be independently deployable. If a phase causes issues:

1. **Phase 1**: Revert SCORE_WEIGHTS to previous values
2. **Phase 2**: Edge types are additive; ignore new types in queries
3. **Phase 3**: Disable cross-graph propagation via config
4. **Phase 4**: Cascade analysis is standalone; disable endpoint
5. **Phase 5**: New query parameters have defaults; old behavior preserved

---

## Success Metrics

### Phase 1 (Quick Wins)

- [ ] Query latency unchanged (+/- 5%)
- [ ] Perspective filtering reduces irrelevant results by 30%+
- [ ] Token budgeting reduces average response size by 20%+
- [ ] Error recovery time reduced by 50%+

### Phase 2 (Edge Infrastructure)

- [ ] Argument edges extracted for 80%+ of entities with rationale
- [ ] Graph queries support all 8 new edge types
- [ ] No storage performance regression

### Phase 3 (Multi-Graph Importance)

- [ ] Importance profiles available for all entities
- [ ] Load-bearing detection accuracy > 80%
- [ ] Cross-graph propagation completes in < 200ms

### Phase 4 (Cascading Impact)

- [ ] Cascade analysis completes in < 500ms for typical codebases
- [ ] Benefit estimates correlate with actual optimization impact (validation needed)
- [ ] Visualization renders correctly in all tested terminals

### Phase 5 (Full Integration)

- [ ] Multi-perspective queries work for all 7 perspectives
- [ ] Deterministic mode produces identical results
- [ ] Schema versioning prevents breaking changes

---

## Timeline Summary

| Week | Phase | Key Deliverables |
|------|-------|------------------|
| 1-2 | Phase 1 | Perspective param, hotspot scoring, token budget, errors |
| 3-4 | Phase 2 | Argument edges, rationale-to-edge, edge filtering |
| 5-6 | Phase 3 | Per-graph importance, cross-graph propagation, unified score |
| 7-8 | Phase 4 | Spreading activation, benefit API, visualization |
| 9-10 | Phase 5 | Multi-perspective, deterministic mode, versioning |

**Total Estimated Effort**: 10 weeks with 1-2 engineers

---

## Appendix: File Reference

### Files to Modify (by phase)

**Phase 1**
- `src/types.ts`
- `src/api/query.ts`
- `src/api/token_budget.ts`
- `src/query/multi_signal_scorer.ts`
- `src/graphs/metrics.ts`
- `src/knowledge/t_patterns.ts`
- `src/cli/commands/query.ts`
- `src/cli/errors.ts`
- `src/cli/index.ts`

**Phase 2**
- `src/storage/types.ts`
- `src/storage/sqlite_storage.ts`
- `src/graphs/knowledge_graph.ts`
- `src/knowledge/extractors/rationale_extractor.ts`
- `src/api/evidence.ts`

**Phase 3**
- New: `src/graphs/importance_types.ts`
- New: `src/graphs/rationale_importance.ts`
- New: `src/graphs/epistemic_importance.ts`
- New: `src/graphs/org_importance.ts`
- New: `src/graphs/cross_graph_propagation.ts`

**Phase 4**
- New: `src/cascade/types.ts`
- New: `src/cascade/spreading_activation.ts`
- New: `src/cascade/propagation_factors.ts`
- New: `src/cascade/benefit.ts`
- New: `src/cascade/visualization.ts`
- `src/knowledge/impact.ts`

**Phase 5**
- `src/api/query.ts`
- `src/api/query_synthesis.ts`
- `src/types.ts`

---

*Implementation Plan synthesized from research documents by Claude Opus 4.5*
