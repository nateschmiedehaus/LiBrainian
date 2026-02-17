# Agent Integration Guide

> **CONTROL_LOOP.md Alignment**: This document describes how agents consume LiBrainian services
> using the Control Theory Model where LiBrainian = Perception, Agent = Controller, Tools = Actuators.

Status: design (integration contract; API names may drift until fully extracted/wired)
Truth source for “what runs today”: `docs/LiBrainian/STATUS.md` and `packages/LiBrainian/src/**`

## Release Qualification Rule

- `REAL_AGENT_REAL_LIBRARIAN_ONLY`: launch qualification must be produced by real agents executing against the real LiBrainian repository.
- `NO_SYNTHETIC_OR_REFERENCE_FOR_RELEASE`: simulations, mocks, and reference harness workers are for diagnostics, not release proof.
- `NO_RETRY_NO_FALLBACK_FOR_RELEASE_EVIDENCE`: retry/fallback/degraded publish artifacts are treated as failures.
- `PERFECT_RELEASE_EVIDENCE_ONLY`: release qualification only accepts 100% strict pass evidence.
- Rationale: LiBrainian's value claim is agent cognition under real development conditions, so release proof must capture real agent loops (`diagnose -> hypothesize -> act -> verify`) with zero degraded shortcuts.

## Control Theory Model

```
┌─────────────────────────────────────────────────────────────────────┐
│                        CONTROL LOOP                                  │
│                                                                      │
│   ┌──────────────┐     ┌──────────────┐     ┌──────────────┐       │
│   │   LiBrainian  │────▶│    AGENT     │────▶│    TOOLS     │       │
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
| **LiBrainian** | Perception + State Estimation | Index code, answer queries, track confidence |
| **Agent** | Controller | Make decisions, plan actions, evaluate results |
| **Tools** | Actuators | Execute file changes, run tests, call APIs |
| **Codebase** | Plant | The system being controlled |

## Integration Points

### 1. Pre-Orchestration Hook

Before any agent work begins, ensure LiBrainian is ready:

```typescript
import { preOrchestrationHook, ensureLibrarianReady } from 'librainian';

// Option 1: Simple hook (blocks until ready)
await preOrchestrationHook(workspace);

// Option 2: With options
const { LiBrainian, wasBootstrapped, report } = await ensureLibrarianReady({
  workspace,
  maxWaitMs: 300_000,  // 5 minutes max
  onProgress: (phase, progress) => console.log(`${phase}: ${progress}%`),
});
```

### 2. Context Enrichment

When assembling task context for an agent:

```typescript
import { enrichTaskContext, formatLibrarianContext } from 'librainian';

// Get LiBrainian context for a task
const librarianContext = await enrichTaskContext(workspace, {
  intent: task.description,
  affectedFiles: task.fileHints,
  depth: 'L2',  // L0=identifiers, L1=signatures, L2=implementations, L3=cross-file
});

// Format for agent consumption
const formattedContext = formatLibrarianContext(librarianContext);
```

### 3. Query Interface

Direct queries to the LiBrainian:

```typescript
import { queryLibrarian, createFunctionQuery, createRelatedQuery } from 'librainian';

// Intent-based query
const results = await queryLibrarian(LiBrainian, {
  intent: 'How does authentication work?',
  depth: 'L2',
  maxPacks: 5,
});

// Function-specific query
const fnContext = await createFunctionQuery(LiBrainian, {
  functionId: 'src/auth/login.ts:validateCredentials',
  includeCallees: true,
  includeCallers: true,
});

// Related code query
const related = await createRelatedQuery(LiBrainian, {
  filePath: 'src/api/users.ts',
  relationTypes: ['imports', 'exports', 'calls'],
});
```

## Agent Feedback Loop

Per CONTROL_LOOP.md §Feedback Loop Integration, agents should provide feedback
to improve LiBrainian accuracy over time.

### Feedback Interface

```typescript
import {
  processAgentFeedback,
  createTaskOutcomeFeedback,
  type AgentFeedback,
  type RelevanceRating
} from 'librainian';

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
import { createTaskOutcomeFeedback, processAgentFeedback } from 'librainian';

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
import type { ConfidenceValue } from 'librainian';

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

Note: the current implementation still uses raw numeric `confidence` on some response types. The spec-system target is `ConfidenceValue` for epistemic/claim confidence; numeric scores are allowed only as ranking signals. See `docs/LiBrainian/specs/INTEGRATION_CHANGE_LIST.md`.

### Confidence Calibration

Query results may include calibrated confidence only when there is measured data.
Otherwise, semantic confidence should be `absent('uncalibrated')` and the response should
attach a VerificationPlan (how to prove/verify claims in this repo).

```typescript
import { applyCalibrationToPacks, summarizeCalibration } from 'librainian';

// Apply calibration to raw confidence scores
const calibratedPacks = await applyCalibrationToPacks(packs, storage);

// Get calibration summary for transparency
const summary = await summarizeCalibration(storage);
console.log(`Calibration error: ${summary.overallError}%`);
```

## Health and Recovery

### Health Check

```typescript
import { generateStateReport, assessHealth } from 'librainian';

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
} from 'librainian';

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

Agents can monitor LiBrainian health via observable state:

```typescript
import {
  collectCodeGraphHealth,
  collectIndexFreshness,
  collectConfidenceState,
  collectQueryPerformance,
  SLO_THRESHOLDS
} from 'librainian';

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

When the agent modifies files, notify the LiBrainian:

```typescript
import { notifyFileChange, notifyFileChanges } from 'librainian';

// Single file change
await notifyFileChange(LiBrainian, '/path/to/modified/file.ts');

// Multiple file changes
await notifyFileChanges(LiBrainian, [
  '/path/to/file1.ts',
  '/path/to/file2.ts',
]);
```

## Post-Orchestration Hook

After agent work completes:

```typescript
import { postOrchestrationHook, recordTaskOutcome } from 'librainian';

// Record task outcome for learning
await recordTaskOutcome(LiBrainian, {
  taskId: 'task-123',
  outcome: 'success',
  filesModified: ['src/auth.ts', 'src/api.ts'],
  packIdsUsed: ['pack-abc', 'pack-def'],
});

// Run post-orchestration cleanup
await postOrchestrationHook(workspace);
```

## Error Handling

All LiBrainian operations follow the `unverified_by_trace` pattern.
For release qualification, any recovery/retry/fallback episode is evidence of failure, not success.

```typescript
try {
  const result = await queryLibrarian(LiBrainian, query);
  // Use result
} catch (error) {
  if (error.code === 'PROVIDER_UNAVAILABLE') {
    // LLM provider not available - cannot proceed
    throw new Error('unverified_by_trace(provider_unavailable)');
  }
  if (error.code === 'INDEX_STALE') {
    // Index too stale - trigger recovery for diagnostics only
    await executeRecovery(storage);
    throw new Error('unverified_by_trace(index_stale_requires_recovery)');
  }
  throw error;
}
```

## Best Practices

### 1. Always Check Health Before Critical Operations

```typescript
const report = await generateStateReport(storage);
if (report.health === 'unhealthy') {
  console.warn('LiBrainian unhealthy; block release evidence and diagnose before proceeding');
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

*This document is authoritative for agent-LiBrainian integration patterns.*
