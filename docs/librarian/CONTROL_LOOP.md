# LiBrainian Control Loop: The Perception Subsystem

> **LiBrainian = Perception + State Estimation**
> **Agent = Controller + Actuator**

This document defines the LiBrainian's role in the Wave0 cybernetic control loop.

---

## The Control Theory Model

```
┌─────────────────────────────────────────────────────────────────┐
│                        THE WORLD (Codebase)                     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼ observations (file changes, git events)
┌─────────────────────────────────────────────────────────────────┐
│                     LiBrainian (Perception)                      │
│                                                                 │
│  ┌───────────┐    ┌───────────┐    ┌───────────┐              │
│  │ AST Parse │ →  │ Embedding │ →  │  Graph    │              │
│  │           │    │  Index    │    │ Analysis  │              │
│  └───────────┘    └───────────┘    └───────────┘              │
│                              │                                  │
│                              ▼                                  │
│                    ┌─────────────────┐                         │
│                    │  State Estimate │                         │
│                    │  (Code Graph +  │                         │
│                    │   Confidence)   │                         │
│                    └─────────────────┘                         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼ state estimate (knowledge packs)
┌─────────────────────────────────────────────────────────────────┐
│                     AGENT (Controller)                          │
│                                                                 │
│  • Planning: What to do next?                                   │
│  • Reasoning: How to do it?                                     │
│  • Decision: Which action to take?                              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼ commands (tool calls)
┌─────────────────────────────────────────────────────────────────┐
│                     TOOLS (Actuators)                           │
│                                                                 │
│  • File edits: Apply patches                                    │
│  • Commands: Build, test, deploy                                │
│  • Git: Commit, push, PR                                        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼ effects (file changes, test results)
                        [Back to THE WORLD]
```

---

## Observable State Variables

The LiBrainian maintains a state estimate with these observable variables:

### 1. Code Graph Health

| Variable | Description | Measurement |
|----------|-------------|-------------|
| `entityCount` | Total indexed entities | Count |
| `relationCount` | Total indexed relations | Count |
| `coverageRatio` | Files indexed / total files | Percentage |
| `orphanEntities` | Entities with no relations | Count |
| `cycleCount` | Circular dependencies | Count |

### 2. Index Freshness

| Variable | Description | Measurement |
|----------|-------------|-------------|
| `lastIndexTime` | When index was last updated | Timestamp |
| `staleness` | Time since last update | Duration |
| `pendingChanges` | Files changed but not indexed | Count |
| `indexVersion` | Current index schema version | Semver |

### 3. Confidence State

| Variable | Description | Measurement |
|----------|-------------|-------------|
| `meanConfidence` | Average confidence across claims | [0, 1] |
| `lowConfidenceCount` | Claims below threshold | Count |
| `defeaterCount` | Active defeaters | Count |
| `calibrationError` | Stated vs empirical accuracy | Percentage |

### 4. Query Performance

| Variable | Description | Measurement |
|----------|-------------|-------------|
| `queryLatencyP50` | Median query time | Milliseconds |
| `queryLatencyP99` | 99th percentile query time | Milliseconds |
| `cacheHitRate` | Cache hits / total queries | Percentage |
| `retrievalRecall` | Relevant results retrieved | Percentage |

---

## Confidence Decay Model

Confidence in LiBrainian knowledge decays over time and events:

### Decay Triggers

| Trigger | Decay Rate | Rationale |
|---------|------------|-----------|
| Time passage | -1% / hour | Stale knowledge |
| File change (indexed) | -10% for file | Direct impact |
| File change (related) | -5% for related | Indirect impact |
| Dependency change | -20% for dependents | Cascading effect |
| Model upgrade | -50% global | Semantic drift |

### Decay Formula

```typescript
confidence(t) = confidence(t0) * decay_factor^(time_elapsed)

where:
  decay_factor = 0.99  // per hour base decay
  time_elapsed = hours since last verification
```

### Confidence Recovery

Confidence is restored through:

| Action | Recovery | Condition |
|--------|----------|-----------|
| Re-index file | +50% | File unchanged |
| Re-embed file | +30% | Embeddings regenerated |
| Manual verification | +100% | Human confirms |
| Cross-reference match | +20% | Multiple sources agree |

---

## Defeater Triggering Rules

Defeaters are activated when confidence drops or contradictions arise:

### Automatic Defeater Triggers

```typescript
interface DefeaterTrigger {
  condition: string;
  threshold: number;
  defeaterType: DefeaterType;
  action: 'flag' | 'invalidate' | 'require_verification';
}

const DEFEATER_TRIGGERS: DefeaterTrigger[] = [
  {
    condition: 'confidence < 0.3',
    threshold: 0.3,
    defeaterType: 'low_confidence',
    action: 'flag'
  },
  {
    condition: 'staleness > 24h',
    threshold: 24 * 60 * 60 * 1000,
    defeaterType: 'stale_knowledge',
    action: 'flag'
  },
  {
    condition: 'contradiction_detected',
    threshold: 1,
    defeaterType: 'contradiction',
    action: 'require_verification'
  },
  {
    condition: 'source_deleted',
    threshold: 1,
    defeaterType: 'source_unavailable',
    action: 'invalidate'
  },
  {
    condition: 'calibration_error > 20%',
    threshold: 0.2,
    defeaterType: 'calibration_drift',
    action: 'flag'
  }
];
```

### Defeater Resolution

| Defeater Type | Resolution Path |
|---------------|-----------------|
| `low_confidence` | Re-index + re-embed |
| `stale_knowledge` | Incremental update |
| `contradiction` | Human review or source priority |
| `source_unavailable` | Remove or mark unverified |
| `calibration_drift` | Recalibrate confidence model |

---

## Closed-Loop Recovery Semantics

When the perception subsystem detects degradation, it initiates recovery:

### Recovery Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    RECOVERY STATE MACHINE                       │
│                                                                 │
│   HEALTHY ──(degradation detected)──► DEGRADED                  │
│      │                                    │                     │
│      │                                    ▼                     │
│      │                              DIAGNOSING                  │
│      │                                    │                     │
│      │                                    ▼                     │
│      │                              RECOVERING                  │
│      │                                    │                     │
│      │         (recovery complete)        │                     │
│      ◄────────────────────────────────────┘                     │
│      │                                    │                     │
│      │         (recovery failed)          │                     │
│      │                                    ▼                     │
│      │                              DEGRADED_STABLE             │
│      │                                    │                     │
│      │         (manual intervention)      │                     │
│      ◄────────────────────────────────────┘                     │
└─────────────────────────────────────────────────────────────────┘
```

### Recovery Actions by Degradation Type

| Degradation | Detection | Recovery Action |
|-------------|-----------|-----------------|
| Stale index | `staleness > threshold` | Incremental re-index |
| Low confidence | `meanConfidence < 0.5` | Targeted re-embedding |
| High defeater count | `defeaterCount > 10` | Defeater resolution batch |
| Query slowdown | `latencyP99 > 2s` | Cache warm-up |
| Coverage drop | `coverageRatio < 0.9` | Full re-scan |

### Recovery Budget

Recovery operations are budgeted to avoid resource exhaustion:

```typescript
interface RecoveryBudget {
  maxTokensPerHour: number;     // LLM token limit
  maxEmbeddingsPerHour: number; // Embedding calls
  maxReindexFilesPerHour: number;
  cooldownAfterRecovery: number; // Minutes
}

const DEFAULT_RECOVERY_BUDGET: RecoveryBudget = {
  maxTokensPerHour: 100_000,
  maxEmbeddingsPerHour: 1_000,
  maxReindexFilesPerHour: 100,
  cooldownAfterRecovery: 15
};
```

---

## Feedback Loop Integration

### Agent → LiBrainian Feedback

The agent provides feedback to improve LiBrainian accuracy:

```typescript
interface AgentFeedback {
  queryId: string;
  relevanceRatings: {
    packId: string;
    relevant: boolean;
    reason?: string;
  }[];
  missingContext?: string;
  timestamp: string;
}
```

### Feedback Processing

```typescript
async function processAgentFeedback(feedback: AgentFeedback): Promise<void> {
  // Update relevance model
  for (const rating of feedback.relevanceRatings) {
    if (!rating.relevant) {
      // Decrease confidence in irrelevant results
      await adjustConfidence(rating.packId, -0.1);
    } else {
      // Increase confidence in relevant results
      await adjustConfidence(rating.packId, +0.05);
    }
  }

  // Log missing context for future improvement
  if (feedback.missingContext) {
    await logRetrievalGap(feedback.queryId, feedback.missingContext);
  }
}
```

---

## Observability

### Metrics Export

The LiBrainian exports metrics for monitoring:

```typescript
// Prometheus-style metrics
librarian_entity_count{type="function"} 1234
librarian_entity_count{type="class"} 567
librarian_staleness_seconds 3600
librarian_confidence_mean 0.85
librarian_defeater_count{type="low_confidence"} 3
librarian_query_latency_seconds{quantile="0.5"} 0.1
librarian_query_latency_seconds{quantile="0.99"} 0.8
librarian_recovery_state{state="healthy"} 1
```

### Health Check Endpoint

```typescript
interface LibrarianHealth {
  status: 'healthy' | 'degraded' | 'recovering' | 'unhealthy';
  checks: {
    indexFresh: boolean;
    confidenceAcceptable: boolean;
    defeatersLow: boolean;
    latencyAcceptable: boolean;
  };
  lastRecovery?: string;
  nextScheduledMaintenance?: string;
}
```

---

## SLOs

| SLO | Target | Measurement |
|-----|--------|-------------|
| Index freshness | < 5 minutes after commit | Staleness metric |
| Query latency p50 | < 500ms | Histogram |
| Query latency p99 | < 2s | Histogram |
| Confidence mean | > 0.7 | Gauge |
| Recovery time | < 15 minutes | Duration |
| Availability | > 99.5% | Uptime |

---

## Validation Requirements (MANDATORY)

Tests are NOT optional. Implementation is NOT complete until all validation gates pass:

| Gate | Command | Requirement |
|------|---------|-------------|
| **Tier-0 CI** | `npm run test:tier0` | MUST PASS - deterministic, provider-free |
| **Agentic Tests** | `npm test` | MUST PASS - includes agentic review |
| **Evidence Pack** | `node scripts/dogfood_full_system_pack.mjs` | MUST GENERATE valid DogfoodEvidencePack.v1.json |

### Failure Modes

- **Provider unavailable**: System fails with `unverified_by_trace(provider_unavailable)` - this is CORRECT behavior
- **Test failures**: Block merges until resolved - no exceptions
- **SLO violations**: Trigger recovery actions per §Closed-Loop Recovery Semantics

### Anti-Patterns (FORBIDDEN)

- Skipping tests to "ship faster"
- Marking tests as "optional" or "nice to have"
- Mocking LLMs in agentic tests (mocks test assumptions, not reality)
- Claiming "works in dev" without evidence artifacts

---

## References

- `docs/LiBrainian/VISION.md` - Control theory model overview
- `docs/LiBrainian/validation.md` - Validation and testing
- `docs/LiBrainian/HANDOFF_CLAUDE_OPUS.md` - LiBrainian testing philosophy
- `docs/TEST.md` - Testing policy (AUTHORITATIVE)
