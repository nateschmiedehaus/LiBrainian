# Usage-Weighted Prioritization for Code Analysis

## Research Document

**Date**: 2026-01-30
**Context**: LiBrainian code analysis tool prioritization enhancement
**Status**: Research Complete - Ready for Implementation Planning

---

## Executive Summary

Usage-weighted prioritization enables LiBrainian to understand which code matters most based on actual usage patterns. Code called 1000x/day vs 1x/day has vastly different optimization impact. This document provides a taxonomy of usage signals, recommended algorithms, and integration strategies with LiBrainian's existing infrastructure.

---

## 1. Taxonomy of Usage Signals

### 1.1 Static Signals (Always Available)

| Signal | Description | Collection Difficulty | Accuracy | LiBrainian Status |
|--------|-------------|----------------------|----------|------------------|
| **Import Count** | Number of files importing this module | Easy | Medium | Available via `getGraphEdges` |
| **Call Graph In-Degree** | Number of functions calling this function | Easy | Medium | Available via graph edges |
| **Export Count** | Number of public APIs exposed | Easy | Low | Derivable from AST |
| **Test Coverage** | Percentage of code covered by tests | Medium | Medium | Partially available |
| **PageRank** | Importance based on link structure | Easy | High | **Already implemented** in `src/graphs/pagerank.ts` |
| **Betweenness Centrality** | Bridge nodes between communities | Easy | High | **Already implemented** in `src/graphs/centrality.ts` |
| **Cochange Frequency** | Files that change together | Medium | High | **Already implemented** in `src/graphs/temporal_graph.ts` |
| **Dependency Depth** | Distance from entry points | Medium | Medium | Derivable from graph |
| **Public API Surface** | Exported vs internal functions | Easy | Medium | Derivable from AST |

### 1.2 Dynamic Signals (Require Runtime/External Data)

| Signal | Description | Collection Difficulty | Accuracy | Privacy Impact |
|--------|-------------|----------------------|----------|----------------|
| **APM Call Counts** | Actual invocation frequency | Hard | Very High | Low (aggregated) |
| **Error Rates** | Exceptions per function | Hard | Very High | Medium |
| **Latency Percentiles** | p50/p95/p99 response times | Hard | Very High | Low |
| **Log Frequency** | How often code path appears in logs | Medium | Medium | Medium |
| **Profiling Data** | CPU/memory per function | Hard | Very High | Low |
| **User Journey Maps** | Code paths for critical flows | Hard | Very High | High |
| **A/B Test Exposure** | Code involved in experiments | Hard | High | Medium |
| **Feature Flag Coverage** | Code behind feature flags | Medium | Medium | Low |

### 1.3 Hybrid Signals (Combine Static + Dynamic)

| Signal | Description | Implementation |
|--------|-------------|----------------|
| **Hotspot Score** | Churn * Complexity | `changeCount * cyclomaticComplexity` |
| **Risk-Weighted Centrality** | PageRank * Error Rate | Requires APM integration |
| **Usage-Adjusted Coverage** | Coverage * Call Frequency | Requires runtime data |

---

## 2. Hotspot Detection Algorithms

### 2.1 Classic Hotspot Formula (Michael Feathers / Adam Tornhill)

```
Hotspot Score = Churn * Complexity

Where:
- Churn = number of commits touching this file in time window
- Complexity = cyclomatic complexity or lines of code
```

**LiBrainian Already Has**:
- `ChangeChurn.changeCount` in `src/knowledge/universal_types.ts`
- `ChangeChurn.changeFrequency` (changes per month)
- Complexity tracking via `QualityComplexity`

### 2.2 Enhanced Hotspot Formula (Recommended)

```
Enhanced Hotspot = (Churn^0.7) * (Complexity^0.5) * (PageRank^0.3) * (1 + ErrorRate)

Where:
- Churn exponent < 1 to dampen outliers
- Complexity exponent < 1 to prevent large files dominating
- PageRank adds structural importance
- ErrorRate multiplier (if available) amplifies problem areas
```

### 2.3 Integration with Existing Scoring

LiBrainian's current `SCORE_WEIGHTS` in `src/api/query.ts`:

```typescript
const SCORE_WEIGHTS = {
  semantic: 0.35,      // Semantic similarity
  pagerank: 0.2,       // Already usage-weighted!
  centrality: 0.1,     // Structural importance
  confidence: 0.2,     // Knowledge confidence
  recency: 0.1,        // Recently modified
  cochange: 0.05,      // Co-modification signal
};
```

**Recommended Addition**:
```typescript
const SCORE_WEIGHTS = {
  semantic: 0.30,      // Reduced slightly
  pagerank: 0.18,      //
  centrality: 0.08,    //
  confidence: 0.18,    //
  recency: 0.08,       //
  cochange: 0.08,      // Increased - temporal coupling
  hotspot: 0.10,       // NEW: churn * complexity signal
};
```

---

## 3. Decay Functions for Recency Modeling

### 3.1 Decay Function Comparison

| Function | Formula | Use Case | Parameters |
|----------|---------|----------|------------|
| **Exponential** | `e^(-lambda * t)` | Smooth, continuous decay | lambda (half-life) |
| **Linear** | `max(0, 1 - t/T)` | Cliff at cutoff | T (max age) |
| **Step** | `1 if t < T else 0` | Binary fresh/stale | T (threshold) |
| **Power Law** | `1 / (1 + t)^alpha` | Heavy tail, slow decay | alpha (decay rate) |
| **Sigmoid** | `1 / (1 + e^(k(t-T)))` | Smooth transition | k (steepness), T (midpoint) |

### 3.2 Recommended: Change-Based Decay (Already in LiBrainian!)

LiBrainian already implements a superior approach in `src/knowledge/extractors/evidence_collector.ts`:

```typescript
// DESIGN PRINCIPLE: Confidence decays based on GRAPH CHANGES, not calendar time.
// Code doesn't become less reliable because 30 days passed - it becomes less
// reliable when its dependencies, callers, or co-modified files change.

export function calculateChangeBasedDecay(
  baseConfidence: number,
  changes: ChangeContext
): number {
  if (changes.directlyModified) return 0.10;

  let decayFactor = 1.0;

  // Dependency changes: strongest impact (15% per edge)
  for (const dep of changes.changedDependencies) {
    decayFactor *= (1 - dep.edgeConfidence * 0.15);
  }

  // Call graph changes: moderate impact (8% per edge)
  for (const edge of changes.changedCallGraph) {
    decayFactor *= (1 - edge.edgeConfidence * 0.08);
  }

  // Cochange partners: weak but cumulative (5% per edge)
  for (const partner of changes.changedCochangePartners) {
    decayFactor *= (1 - partner.cochangeStrength * 0.05);
  }

  return Math.max(baseConfidence * 0.1, baseConfidence * decayFactor);
}
```

**This is the correct approach** - calendar-based decay is fundamentally flawed because:
1. Stable code doesn't become unreliable with age
2. Graph changes are the actual invalidation events
3. Cochange strength provides usage correlation signal

### 3.3 Hybrid Recency Model (Recommended Enhancement)

For scenarios where runtime data IS available:

```typescript
interface RecencySignals {
  // Graph-based (always available)
  lastModified: Date;
  dependencyChanges: number;
  cochangeChanges: number;

  // Runtime-based (when available)
  lastInvoked?: Date;           // From APM
  invocationCount?: number;     // From APM
  lastErrored?: Date;           // From logs
}

function computeRecencyScore(signals: RecencySignals): number {
  // Base: graph-change decay (always available)
  let score = calculateChangeBasedDecay(1.0, signals);

  // Runtime boost (if available)
  if (signals.lastInvoked) {
    const daysSinceInvoked = daysBetween(signals.lastInvoked, now());
    const invokedRecency = Math.exp(-daysSinceInvoked / 7); // 7-day half-life
    score = score * 0.7 + invokedRecency * 0.3;
  }

  return score;
}
```

---

## 4. Flame Graph and Coverage Report Prioritization Patterns

### 4.1 Flame Graph Prioritization

Flame graphs (Brendan Gregg) prioritize by:
1. **Width** = time/samples (direct usage)
2. **Depth** = call stack depth (indirect usage)
3. **Color** = category (CPU, I/O, lock contention)

**Applicable to LiBrainian**:
- Width analog: Import count + call count
- Depth analog: Distance from entry point
- Color analog: Entity type (function, module, config)

### 4.2 Coverage Report Prioritization

Coverage tools (Istanbul, NYC) prioritize by:
1. **Uncovered lines in hot paths** - High-traffic code without tests
2. **Branch coverage gaps** - Logic paths never exercised
3. **Function coverage** - Entire functions never called in tests

**Applicable to LiBrainian**:
- Cross-reference call graph with test coverage
- High PageRank + low coverage = priority debt
- This is the "risk-weighted coverage" metric

### 4.3 Composite Priority Formula

```typescript
function computeUsageWeightedPriority(entity: Entity): number {
  const staticSignals = {
    pagerank: entity.pagerank,                    // 0-1
    centrality: entity.betweennessCentrality,    // 0-1 normalized
    importCount: normalize(entity.importCount),   // 0-1
    cochangeStrength: entity.maxCochangeStrength, // 0-1
  };

  const qualitySignals = {
    complexity: normalize(entity.cyclomaticComplexity),
    churn: normalize(entity.changeCount),
    testCoverage: entity.testCoverage || 0.5,    // Default if unknown
  };

  // Hotspot = high churn + high complexity
  const hotspot = Math.pow(qualitySignals.churn, 0.7) *
                  Math.pow(qualitySignals.complexity, 0.5);

  // Usage importance = PageRank * centrality blend
  const usageImportance = staticSignals.pagerank * 0.6 +
                          staticSignals.centrality * 0.4;

  // Risk = important code with low coverage
  const risk = usageImportance * (1 - qualitySignals.testCoverage);

  // Final priority
  return (usageImportance * 0.4) + (hotspot * 0.3) + (risk * 0.3);
}
```

---

## 5. Static vs Runtime Telemetry Tradeoffs

### 5.1 Comparison Matrix

| Aspect | Static Analysis | Runtime Telemetry |
|--------|----------------|-------------------|
| **Availability** | Always | Requires instrumentation |
| **Accuracy** | Medium (60-75%) | High (85-95%) |
| **Latency** | Immediate | Delayed (hours/days) |
| **Coverage** | 100% of code | Only executed paths |
| **Cost** | Low (compute only) | Medium (storage, processing) |
| **Privacy** | None | Potential PII in traces |
| **Maintenance** | Low | High (instrumentation drift) |

### 5.2 Recommended Strategy: Progressive Enhancement

**Phase 1: Static Only (Current Capability)**
- Leverage existing PageRank, centrality, cochange
- Add hotspot scoring (churn * complexity)
- Achievable accuracy: ~70%

**Phase 2: External Integration (Optional)**
- Accept coverage reports (lcov, istanbul)
- Accept APM summaries (not raw traces)
- Achievable accuracy: ~80%

**Phase 3: Runtime Correlation (Stretch)**
- OpenTelemetry integration for call counts
- Sampling-based profiling
- Achievable accuracy: ~90%

---

## 6. Integration with Existing LiBrainian Infrastructure

### 6.1 Existing Components to Leverage

| Component | Location | Usage for Prioritization |
|-----------|----------|--------------------------|
| PageRank | `src/graphs/pagerank.ts` | Already computes importance |
| Centrality | `src/graphs/centrality.ts` | Bridge detection |
| Cochange | `src/graphs/temporal_graph.ts` | Temporal coupling |
| Graph Metrics | `src/graphs/metrics.ts` | Unified computation |
| Change-Based Decay | `src/knowledge/extractors/evidence_collector.ts` | Recency model |
| Multi-Signal Scorer | `src/query/multi_signal_scorer.ts` | Extensible signal framework |
| Priority Weights | `src/strategic/prioritization.ts` | Configurable weights |

### 6.2 Data Requirements

**Already Collected**:
```typescript
// From temporal_graph.ts
interface CochangeEdge {
  fileA: string;
  fileB: string;
  changeCount: number;
  totalChanges: number;
  strength: number;  // changeCount / totalChanges
}

// From universal_types.ts
interface ChangeChurn {
  changeCount: number;      // Times changed (30 days)
  changeFrequency: number;  // Changes per month
  lastChanged: string;      // ISO timestamp
  age: number;              // Days since creation
  authors: number;          // Unique authors
}
```

**Needs Collection**:
```typescript
// Proposed addition
interface UsageMetrics {
  // Static (can compute)
  importInDegree: number;      // How many modules import this
  callInDegree: number;        // How many functions call this
  exportCount: number;         // Public API surface
  dependencyDepth: number;     // Hops from entry point

  // External (optional)
  testCoverage?: number;       // From coverage reports
  runtimeCallCount?: number;   // From APM
  errorRate?: number;          // From logs
}
```

### 6.3 Proposed Score Weight Configuration

Add to `src/strategic/prioritization.ts`:

```typescript
export interface UsageWeights {
  // Graph-based (always available)
  pagerank: number;           // Default: 0.20
  centrality: number;         // Default: 0.10
  cochangeStrength: number;   // Default: 0.10
  importInDegree: number;     // Default: 0.10

  // Quality-based (always available)
  hotspot: number;            // Default: 0.15 (churn * complexity)

  // Coverage-based (when available)
  riskScore: number;          // Default: 0.15 (importance * (1 - coverage))

  // Runtime-based (when available)
  callFrequency: number;      // Default: 0.10
  errorCorrelation: number;   // Default: 0.10
}

export const DEFAULT_USAGE_WEIGHTS: UsageWeights = {
  pagerank: 0.20,
  centrality: 0.10,
  cochangeStrength: 0.10,
  importInDegree: 0.10,
  hotspot: 0.15,
  riskScore: 0.15,
  callFrequency: 0.10,
  errorCorrelation: 0.10,
};

// Fallback weights when runtime data unavailable
export const STATIC_ONLY_USAGE_WEIGHTS: UsageWeights = {
  pagerank: 0.30,
  centrality: 0.15,
  cochangeStrength: 0.15,
  importInDegree: 0.15,
  hotspot: 0.25,
  riskScore: 0.00,      // Disabled without coverage
  callFrequency: 0.00,  // Disabled without APM
  errorCorrelation: 0.00,
};
```

---

## 7. Privacy Implications

### 7.1 Data Classification

| Data Type | Sensitivity | Mitigation |
|-----------|-------------|------------|
| Call counts | Low | Aggregate only, no user IDs |
| File paths | Medium | Relative paths, no secrets |
| Error messages | High | Sanitize PII, hash identifiers |
| Stack traces | High | Function names only, no args |
| User journeys | High | Anonymize, sample sparingly |
| Coverage reports | Low | No runtime data |

### 7.2 Recommended Privacy Practices

1. **Aggregation**: Store counts, not individual events
2. **Sampling**: 1-5% sample rate for detailed traces
3. **Hashing**: Hash identifiers before storage
4. **TTL**: Delete raw data after 30 days
5. **Opt-in**: Runtime integration should be explicit

### 7.3 Data Retention Recommendations

```typescript
interface RetentionPolicy {
  // Static analysis data - indefinite
  graphMetrics: 'indefinite';
  cochangeEdges: 'indefinite';

  // Aggregated runtime - 90 days
  callCountAggregates: '90d';
  errorRateAggregates: '90d';

  // Raw traces - 7 days (if collected at all)
  rawSpans: '7d';
  rawLogs: '7d';
}
```

---

## 8. Implementation Recommendations

### 8.1 Phase 1: Hotspot Scoring (Immediate)

**Effort**: 2-3 days
**Prerequisites**: None (uses existing data)

1. Add `computeHotspotScore()` function
2. Integrate into `SCORE_WEIGHTS` with 0.10 weight
3. Add to `GraphMetricsEntry` if useful for caching

```typescript
// In src/graphs/metrics.ts or new src/graphs/hotspot.ts
export function computeHotspotScore(
  churn: number,
  complexity: number,
  options: { churnExponent?: number; complexityExponent?: number } = {}
): number {
  const { churnExponent = 0.7, complexityExponent = 0.5 } = options;
  return Math.pow(churn, churnExponent) * Math.pow(complexity, complexityExponent);
}
```

### 8.2 Phase 2: Import In-Degree (Short-term)

**Effort**: 1-2 days
**Prerequisites**: None

1. Count incoming edges per module in graph metrics
2. Expose as `importInDegree` on entities
3. Add to multi-signal scorer

### 8.3 Phase 3: Coverage Integration (Medium-term)

**Effort**: 3-5 days
**Prerequisites**: External coverage report format

1. Define coverage report ingestion format (lcov, istanbul JSON)
2. Store coverage per-file/function
3. Compute risk score: `pagerank * (1 - coverage)`

### 8.4 Phase 4: APM Integration (Long-term)

**Effort**: 2-3 weeks
**Prerequisites**: User opt-in, OpenTelemetry setup

1. Define accepted span format (call counts only, no PII)
2. Create ingestion endpoint
3. Store aggregated metrics
4. Add runtime signals to multi-signal scorer

---

## 9. References

### Academic
- Feathers, M. (2004). Working Effectively with Legacy Code
- Tornhill, A. (2015). Your Code as a Crime Scene
- Gregg, B. (2016). The Flame Graph paper

### Tools Studied
- CodeScene (hotspot analysis)
- SonarQube (maintainability index)
- Datadog APM (runtime metrics)
- Istanbul/NYC (coverage)

### LiBrainian-Specific
- `src/graphs/pagerank.ts` - PageRank implementation
- `src/graphs/temporal_graph.ts` - Cochange analysis
- `src/knowledge/extractors/evidence_collector.ts` - Change-based decay
- `src/query/multi_signal_scorer.ts` - Extensible scoring framework
- `src/strategic/prioritization.ts` - Priority configuration

---

## 10. Summary

**Key Findings**:
1. LiBrainian already has strong foundations (PageRank, centrality, cochange)
2. Hotspot scoring (churn * complexity) is the highest-value addition
3. Change-based decay is superior to calendar-based decay (already implemented!)
4. Runtime telemetry is a stretch goal with significant privacy considerations

**Recommended Priority Order**:
1. **Hotspot scoring** - immediate, high value, no new data needed
2. **Import in-degree** - quick win, enhances PageRank signal
3. **Coverage integration** - medium effort, external data needed
4. **APM integration** - significant effort, requires user infrastructure

**Key Insight**: The existing change-based decay model in `evidence_collector.ts` is philosophically correct - code relevance should decay based on graph changes, not calendar time. This principle should guide all future recency modeling.
