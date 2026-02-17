# Confidence Decay Model

> **CONTROL_LOOP.md Alignment**: This document specifies how confidence degrades over time
> and through various events, plus the recovery actions that can restore confidence.

## Overview

Knowledge confidence is not static. It decays through:
1. **Time passage** - Information becomes stale
2. **External events** - File changes, dependency updates, model upgrades
3. **Contradictions** - New information that conflicts with existing claims

The decay model ensures that LiBrainian maintains honest uncertainty about its knowledge.

## Decay Formula

The fundamental decay formula is exponential:

```typescript
confidence(t) = confidence(t0) * decay_factor^(time_elapsed / decay_period)
```

Where:
- `confidence(t)` = confidence at time t
- `confidence(t0)` = initial confidence
- `decay_factor` = per-period decay multiplier
- `time_elapsed` = time since last validation
- `decay_period` = period over which decay_factor applies

### Example: Time-Based Decay

```typescript
// Time decay: -1% per hour (decay_factor = 0.99, decay_period = 1 hour)
const hoursSinceIndexed = (now - indexedAt) / (60 * 60 * 1000);
const decayedConfidence = initialConfidence * Math.pow(0.99, hoursSinceIndexed);

// After 24 hours: 0.8 * 0.99^24 = 0.8 * 0.786 = 0.63
// After 48 hours: 0.8 * 0.99^48 = 0.8 * 0.618 = 0.49
// After 72 hours: 0.8 * 0.99^72 = 0.8 * 0.486 = 0.39
```

## Decay Triggers

### 1. Time Passage

| Domain | Decay Rate | Rationale |
|--------|------------|-----------|
| Identity (names, locations) | 0% | Immutable until file changes |
| Relationships (imports, calls) | -1%/hour | Dependencies may shift |
| Semantics (purpose, behavior) | -0.5%/hour | Meaning evolves slowly |
| Patterns (architecture, style) | -0.2%/hour | Patterns persist longer |

### 2. File Change Events

| Event | Confidence Impact | Scope |
|-------|------------------|-------|
| Direct file modification | -100% (reset) | Single file |
| Dependency file change | -20% | Dependents |
| Related file change | -10% | Same module |
| Distant file change | -5% | Same codebase |

### 3. Model Upgrades

When the LLM or embedding model changes:

| Change Type | Impact | Recovery |
|-------------|--------|----------|
| Embedding model upgrade | -50% | Re-embed all |
| LLM version change | -30% | Re-extract semantics |
| Prompt change | -40% | Re-process affected claims |

### 4. Contradiction Detection

When new information contradicts existing knowledge:

```typescript
type ContradictionSeverity = 'minor' | 'major' | 'critical';

const CONTRADICTION_PENALTIES: Record<ContradictionSeverity, number> = {
  minor: -0.15,    // Small discrepancy
  major: -0.40,    // Significant conflict
  critical: -0.80, // Fundamental contradiction
};
```

## Recovery Actions

Recovery actions restore confidence through re-validation:

### 1. Re-indexing

| Action | Confidence Boost | Cost |
|--------|-----------------|------|
| Full re-index | +50% | High (tokens, time) |
| Incremental re-index | +30% | Medium |
| Metadata refresh | +10% | Low |

```typescript
// After re-indexing a file
const newConfidence = Math.min(
  1.0,
  oldConfidence + 0.5 // +50% from full re-index
);
```

### 2. Re-embedding

| Action | Confidence Boost | Cost |
|--------|-----------------|------|
| Full re-embed | +30% | High |
| Targeted re-embed | +20% | Medium |
| Similarity refresh | +5% | Low |

### 3. Cross-Reference Validation

When multiple sources agree:

```typescript
// Cross-reference boost
const crossRefBoost = 0.20 * (agreementCount / totalSources);
const validatedConfidence = oldConfidence + crossRefBoost;
```

### 4. Manual Verification

When a human confirms the knowledge:

```typescript
// Manual verification resets to high confidence
const verifiedConfidence = Math.max(0.95, oldConfidence);
```

### 5. Agent Feedback

Per CONTROL_LOOP.md §Feedback Loop Integration:

| Feedback | Adjustment | Rationale |
|----------|------------|-----------|
| Relevant + useful | +0.05 | Positive reinforcement |
| Relevant but partial | +0.025 | Partial success |
| Not relevant | -0.10 | Wrong context delivered |
| Missing context | -0.05 | Retrieval gap |

## Implementation

### Decay Application

```typescript
import type { LibrarianStorage } from '../storage/types.js';

export interface DecayConfig {
  /** Hours between decay applications */
  decayIntervalHours: number;
  /** Base decay rate per interval */
  baseDecayRate: number;
  /** Minimum confidence floor */
  confidenceFloor: number;
  /** Maximum confidence ceiling */
  confidenceCeiling: number;
}

export const DEFAULT_DECAY_CONFIG: DecayConfig = {
  decayIntervalHours: 1,
  baseDecayRate: 0.01,  // 1% per hour
  confidenceFloor: 0.1, // Never drop below 10%
  confidenceCeiling: 0.95, // Never exceed 95%
};

/**
 * Apply time-based confidence decay to all knowledge.
 */
export async function applyTimeDecay(
  storage: LibrarianStorage,
  config: DecayConfig = DEFAULT_DECAY_CONFIG
): Promise<{ decayed: number; unchanged: number }> {
  const now = Date.now();
  let decayed = 0;
  let unchanged = 0;

  // Get all functions and apply decay
  const functions = await storage.getFunctions({ limit: 10000 });

  for (const fn of functions) {
    const hoursSinceUpdate = (now - fn.lastValidated.getTime()) / (60 * 60 * 1000);
    const intervals = Math.floor(hoursSinceUpdate / config.decayIntervalHours);

    if (intervals > 0) {
      const decayFactor = Math.pow(1 - config.baseDecayRate, intervals);
      const newConfidence = Math.max(
        config.confidenceFloor,
        fn.confidence * decayFactor
      );

      await storage.upsertFunction({
        ...fn,
        confidence: newConfidence,
      });
      decayed++;
    } else {
      unchanged++;
    }
  }

  return { decayed, unchanged };
}
```

### Event-Based Decay

```typescript
export type DecayEvent =
  | { type: 'file_change'; path: string }
  | { type: 'dependency_change'; paths: string[] }
  | { type: 'model_upgrade'; modelType: 'embedding' | 'llm' }
  | { type: 'contradiction'; severity: 'minor' | 'major' | 'critical' };

const EVENT_PENALTIES: Record<DecayEvent['type'], number> = {
  file_change: 1.0,      // Full reset
  dependency_change: 0.2,
  model_upgrade: 0.5,
  contradiction: 0.4,    // Average of severities
};

/**
 * Apply event-based decay to affected knowledge.
 */
export async function applyEventDecay(
  storage: LibrarianStorage,
  event: DecayEvent
): Promise<void> {
  const penalty = EVENT_PENALTIES[event.type];

  switch (event.type) {
    case 'file_change':
      // Full reset for direct file change
      await storage.invalidateContextPacks(event.path);
      break;

    case 'dependency_change':
      // Partial decay for dependents
      for (const path of event.paths) {
        await storage.applyTimeDecay(penalty);
      }
      break;

    case 'model_upgrade':
      // Global decay for model changes
      await storage.applyTimeDecay(penalty);
      break;

    case 'contradiction':
      // Targeted decay for contradicted claims
      await storage.applyTimeDecay(
        event.severity === 'critical' ? 0.8 :
        event.severity === 'major' ? 0.4 : 0.15
      );
      break;
  }
}
```

## Monitoring

### Confidence Distribution

Track confidence distribution to detect systemic decay:

```typescript
interface ConfidenceDistribution {
  high: number;    // >= 0.7
  medium: number;  // 0.4 - 0.7
  low: number;     // < 0.4
  mean: number;
  stdDev: number;
}

// Alert thresholds
const HEALTHY_DISTRIBUTION = {
  highMin: 0.6,    // At least 60% should be high confidence
  lowMax: 0.1,     // No more than 10% should be low confidence
  meanMin: 0.65,   // Mean should be above 0.65
};
```

### Decay Velocity

Track how fast confidence is decaying:

```typescript
interface DecayVelocity {
  /** Confidence points lost per hour */
  pointsPerHour: number;
  /** Projected time to mean < 0.5 */
  projectedDegradationHours: number;
  /** Current decay trend */
  trend: 'accelerating' | 'stable' | 'recovering';
}
```

## Recovery Triggers

Automatic recovery is triggered when:

| Condition | Action |
|-----------|--------|
| Mean confidence < 0.5 | Full re-index |
| Low confidence % > 20% | Targeted re-embedding |
| Decay velocity > 5%/hr | Emergency re-validation |
| Defeater count > 10 | Defeater resolution batch |

## Integration with Staleness

Confidence decay works alongside the staleness model (UNDERSTANDING_LAYER.md §Freshness):

```typescript
// Combined freshness-confidence score
function computeEffectiveConfidence(
  rawConfidence: number,
  freshnessScore: number // From freshness.ts
): number {
  // Freshness acts as a multiplier on confidence
  return rawConfidence * freshnessScore;
}

// Example: 0.8 confidence * 0.7 freshness = 0.56 effective confidence
```

## Document History

| Date | Version | Changes |
|------|---------|---------|
| 2026-01-08 | 1.0.0 | Initial confidence decay specification |

---

*This document is authoritative for confidence decay semantics in LiBrainian.*
