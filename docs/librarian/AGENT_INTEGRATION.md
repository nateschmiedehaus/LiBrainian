# Agent Integration Guide

> **CONTROL_LOOP.md Alignment**: This document describes how agents consume Librarian services
> using the Control Theory Model where Librarian = Perception, Agent = Controller, Tools = Actuators.

Status: design (integration contract; API names may drift until fully extracted/wired)
Truth source for “what runs today”: `docs/librarian/STATUS.md` and `packages/librarian/src/**`

## Control Theory Model

```
┌─────────────────────────────────────────────────────────────────────┐
│                        CONTROL LOOP                                  │
│                                                                      │
│   ┌──────────────┐     ┌──────────────┐     ┌──────────────┐       │
│   │   LIBRARIAN  │────▶│    AGENT     │────▶│    TOOLS     │       │
│   │  (Perception)│     │ (Controller) │     │  (Actuators) │       │
│   └──────────────┘     └──────────────┘     └──────────────┘       │
│          │                    │                    │                │
│          │                    │                    │                │
│          │    ┌───────────────┘                    │                │
│          │    │ Feedback                           │                │
│          │    ▼                                    │                │
│          │  ┌──────────────┐                       │                │
│          └──│  CODEBASE    │◀──────────────────────┘                │
│             │  (Plant)     │                                        │
│             └──────────────┘                                        │
└─────────────────────────────────────────────────────────────────────┘
```

### Role Definitions

| Component | Role | Responsibilities |
|-----------|------|------------------|
| **Librarian** | Perception + State Estimation | Index code, answer queries, track confidence |
| **Agent** | Controller | Make decisions, plan actions, evaluate results |
| **Tools** | Actuators | Execute file changes, run tests, call APIs |
| **Codebase** | Plant | The system being controlled |

## Integration Points

### 1. Pre-Orchestration Hook

Before any agent work begins, ensure Librarian is ready:

```typescript
import { preOrchestrationHook, ensureLibrarianReady } from 'librarian';

// Option 1: Simple hook (blocks until ready)
await preOrchestrationHook(workspace);

// Option 2: With options
const { librarian, wasBootstrapped, report } = await ensureLibrarianReady({
  workspace,
  maxWaitMs: 300_000,  // 5 minutes max
  onProgress: (phase, progress) => console.log(`${phase}: ${progress}%`),
});
```

### 2. Context Enrichment

When assembling task context for an agent:

```typescript
import { enrichTaskContext, formatLibrarianContext } from 'librarian';

// Get librarian context for a task
const librarianContext = await enrichTaskContext(workspace, {
  intent: task.description,
  affectedFiles: task.fileHints,
  depth: 'L2',  // L0=identifiers, L1=signatures, L2=implementations, L3=cross-file
});

// Format for agent consumption
const formattedContext = formatLibrarianContext(librarianContext);
```

### 3. Query Interface

Direct queries to the librarian:

```typescript
import { queryLibrarian, createFunctionQuery, createRelatedQuery } from 'librarian';

// Intent-based query
const results = await queryLibrarian(librarian, {
  intent: 'How does authentication work?',
  depth: 'L2',
  maxPacks: 5,
});

// Function-specific query
const fnContext = await createFunctionQuery(librarian, {
  functionId: 'src/auth/login.ts:validateCredentials',
  includeCallees: true,
  includeCallers: true,
});

// Related code query
const related = await createRelatedQuery(librarian, {
  filePath: 'src/api/users.ts',
  relationTypes: ['imports', 'exports', 'calls'],
});
```

## Agent Feedback Loop

Per CONTROL_LOOP.md §Feedback Loop Integration, agents should provide feedback
to improve librarian accuracy over time.

### Feedback Interface

```typescript
import {
  processAgentFeedback,
  createTaskOutcomeFeedback,
  type AgentFeedback,
  type RelevanceRating
} from 'librarian';

// Create feedback from task outcome
const feedback: AgentFeedback = {
  queryId: 'query-12345',
  relevanceRatings: [
    {
      packId: 'pack-abc',
      relevant: true,
      usefulness: 0.9,
      reason: 'Directly answered the question about auth flow',
    },
    {
      packId: 'pack-def',
      relevant: false,
      reason: 'Unrelated to authentication',
    },
  ],
  missingContext: 'Needed OAuth2 token refresh logic, not found in results',
  timestamp: new Date().toISOString(),
  agentId: 'claude-opus-4',
  taskContext: {
    taskType: 'bug_fix',
    intent: 'Fix authentication timeout issue',
    outcome: 'success',
  },
};

// Process feedback (records evidence; may activate defeaters; calibration happens offline)
const result = await processAgentFeedback(feedback, storage);
console.log(result); // should include ledger entry IDs + any defeaters activated
```

### Automatic Feedback from Task Outcomes

```typescript
import { createTaskOutcomeFeedback, processAgentFeedback } from 'librarian';

// After task completion, create feedback automatically
const feedback = createTaskOutcomeFeedback(
  queryId,
  packIds,           // IDs of packs that were used
  'success',         // 'success' | 'failure' | 'partial'
  'claude-opus-4'    // agent ID
);

await processAgentFeedback(feedback, storage);
```

### Feedback → Confidence (Non-Theater Rule)

Feedback MUST NOT directly “bump” claim confidence via arbitrary numeric deltas.
Instead:
- Feedback is appended as evidence (and/or defeaters) into the epistemics ledgers.
- Only calibrated pipelines may produce `MeasuredConfidence` over time.
- Until calibration exists, confidence SHOULD be `absent('uncalibrated')` for semantic claims.

## Knowledge Pack Delivery

### Progressive Disclosure Levels

```typescript
type QueryDepth = 'L0' | 'L1' | 'L2' | 'L3';
```

| Level | Content | Use Case |
|-------|---------|----------|
| **L0** | Identifiers only | Quick navigation |
| **L1** | + Signatures, types | Interface understanding |
| **L2** | + Implementation snippets | Code comprehension |
| **L3** | + Cross-file context | Full system understanding |

### Context Pack Structure

```typescript
import type { ConfidenceValue } from 'librarian';

interface ContextPack {
  packId: string;
  packType: ContextPackType;      // 'function_context' | 'module_context' | etc.
  targetId: string;               // Entity this pack describes
  summary: string;                // Human-readable summary
  keyFacts: string[];             // Bullet points
  codeSnippets: CodeSnippet[];    // Relevant code
  relatedFiles: string[];         // Associated files
  confidence: ConfidenceValue;    // Provenanced confidence (no raw numbers)
  defeaters?: string[];           // Active defeaters (e.g., 'stale_index', 'partial_corpus')
  traceId?: string;               // Evidence trace / replay anchor when available
}
```

Note: the current implementation still uses raw numeric `confidence` on some response types. The spec-system target is `ConfidenceValue` for epistemic/claim confidence; numeric scores are allowed only as ranking signals. See `docs/librarian/specs/INTEGRATION_CHANGE_LIST.md`.

### Confidence Calibration

Query results may include calibrated confidence only when there is measured data.
Otherwise, semantic confidence should be `absent('uncalibrated')` and the response should
attach a VerificationPlan (how to prove/verify claims in this repo).

```typescript
import { applyCalibrationToPacks, summarizeCalibration } from 'librarian';

// Apply calibration to raw confidence scores
const calibratedPacks = await applyCalibrationToPacks(packs, storage);

// Get calibration summary for transparency
const summary = await summarizeCalibration(storage);
console.log(`Calibration error: ${summary.overallError}%`);
```

## Health and Recovery

### Health Check

```typescript
import { generateStateReport, assessHealth } from 'librarian';

const report = await generateStateReport(storage);
const health = assessHealth(report);

console.log(`Status: ${health.status}`);  // 'healthy' | 'degraded' | 'recovering' | 'unhealthy'
console.log(`Checks:`, health.checks);
```

### Recovery Triggering

When the agent detects degradation, it can trigger recovery:

```typescript
import {
  executeRecovery,
  getRecoveryStatus,
  DEFAULT_RECOVERY_BUDGET
} from 'librarian';

// Check recovery status
const status = getRecoveryStatus();
if (status.cooldownRemainingMs === 0 && !status.inProgress) {
  // Execute recovery with budget limits
  const result = await executeRecovery(storage, DEFAULT_RECOVERY_BUDGET);
  console.log(`Recovery ${result.success ? 'succeeded' : 'failed'}`);
  console.log(`Actions: ${result.actionsExecuted.join(', ')}`);
}
```

### Recovery Budget

Per CONTROL_LOOP.md, recovery has resource limits:

| Resource | Limit | Per |
|----------|-------|-----|
| Tokens | 100,000 | Hour |
| Embeddings | 1,000 | Hour |
| Files reindexed | 100 | Hour |
| Cooldown | 15 | Minutes |

## Observable State Variables

Agents can monitor librarian health via observable state:

```typescript
import {
  collectCodeGraphHealth,
  collectIndexFreshness,
  collectConfidenceState,
  collectQueryPerformance,
  SLO_THRESHOLDS
} from 'librarian';

// Code graph health
const graphHealth = await collectCodeGraphHealth(storage);
console.log(`Entities: ${graphHealth.entityCount}`);
console.log(`Coverage: ${graphHealth.coverageRatio}`);

// Index freshness
const freshness = await collectIndexFreshness(storage);
console.log(`Staleness: ${freshness.stalenessMs}ms`);
console.log(`Pending changes: ${freshness.pendingChanges}`);

// Confidence state
const confidence = await collectConfidenceState(storage);
console.log(`Mean confidence: ${confidence.geometricMeanConfidence}`);
console.log(`Defeaters: ${confidence.defeaterCount}`);

// Query performance
const performance = collectQueryPerformance();
console.log(`P50 latency: ${performance.queryLatencyP50}ms`);
console.log(`P99 latency: ${performance.queryLatencyP99}ms`);
```

### SLO Thresholds

| Metric | Threshold | Action if Exceeded |
|--------|-----------|-------------------|
| Index freshness | 5 min | Trigger incremental reindex |
| Query p50 | 500ms | Cache warmup |
| Query p99 | 2s | Query optimization |
| Confidence mean | 0.7 | Re-embedding |
| Defeater count | 10 | Defeater resolution |
| Coverage ratio | 0.9 | Full rescan |

## File Change Notifications

When the agent modifies files, notify the librarian:

```typescript
import { notifyFileChange, notifyFileChanges } from 'librarian';

// Single file change
await notifyFileChange(librarian, '/path/to/modified/file.ts');

// Multiple file changes
await notifyFileChanges(librarian, [
  '/path/to/file1.ts',
  '/path/to/file2.ts',
]);
```

## Post-Orchestration Hook

After agent work completes:

```typescript
import { postOrchestrationHook, recordTaskOutcome } from 'librarian';

// Record task outcome for learning
await recordTaskOutcome(librarian, {
  taskId: 'task-123',
  outcome: 'success',
  filesModified: ['src/auth.ts', 'src/api.ts'],
  packIdsUsed: ['pack-abc', 'pack-def'],
});

// Run post-orchestration cleanup
await postOrchestrationHook(workspace);
```

## Error Handling

All librarian operations follow the `unverified_by_trace` pattern:

```typescript
try {
  const result = await queryLibrarian(librarian, query);
  // Use result
} catch (error) {
  if (error.code === 'PROVIDER_UNAVAILABLE') {
    // LLM provider not available - cannot proceed
    throw new Error('unverified_by_trace(provider_unavailable)');
  }
  if (error.code === 'INDEX_STALE') {
    // Index too stale - trigger recovery
    await executeRecovery(storage);
    // Retry query
  }
  throw error;
}
```

## Best Practices

### 1. Always Check Health Before Critical Operations

```typescript
const report = await generateStateReport(storage);
if (report.health === 'unhealthy') {
  console.warn('Librarian unhealthy, results may be degraded');
}
```

### 2. Provide Feedback for All Queries

```typescript
// After using query results, always provide feedback
const feedback = createTaskOutcomeFeedback(queryId, packIds, outcome);
await processAgentFeedback(feedback, storage);
```

### 3. Use Appropriate Query Depth

```typescript
// Start with L1 for quick overview
const overview = await queryLibrarian(lib, { ...query, depth: 'L1' });

// Drill down to L2/L3 only if needed
if (needsMoreContext) {
  const detailed = await queryLibrarian(lib, { ...query, depth: 'L3' });
}
```

### 4. Monitor SLOs

```typescript
// Periodically check SLO compliance
const report = await generateStateReport(storage);
if (report.queryPerformance.queryLatencyP99 > SLO_THRESHOLDS.queryLatencyP99Ms) {
  console.warn('Query latency SLO exceeded');
}
```

## Document History

| Date | Version | Changes |
|------|---------|---------|
| 2026-01-08 | 1.0.0 | Initial agent integration guide |

---

*This document is authoritative for agent-librarian integration patterns.*
