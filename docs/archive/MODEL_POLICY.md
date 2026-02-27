# LiBrainian Model Policy (Daily Selection)

Status: authoritative
Scope: Daily model selection, provider checks, escalation rules, and cost control.
Last Verified: 2026-01-04
Owner: librarianship
Version: 1.1.0
Evidence: docs only (implementation evidence lives in STATUS.md)

## Related Documents

| Document | Relationship |
|----------|-------------|
| `SCHEMAS.md` | Type definitions for Trace, ProviderTrace |
| `STATUS.md` | Implementation tracking for provider integration |
| `SYSTEM_ARCHITECTURE.md` | Provider architecture section |
| `UNDERSTANDING_LAYER.md` | LLM mandate for semantic understanding |

## Goal

Use the cheapest models that are still state of the art on the current date,
without sacrificing semantic fidelity or tool support.

## Non-Negotiables

1. **CLI Authentication Only**: No API keys in environment variables
2. **Provider Verification**: Verify via `checkAllProviders()` before any operation
3. **Fail Closed**: If providers unavailable, return `unverified_by_trace(provider_unavailable)`
4. **Default Cheap**: Use Haiku-class for LiBrainian unless capability gap proven
5. **Audit Trail**: Record all model selections in `state/audits/model_selection/`

## Daily Selection Procedure (Required)

1. Fetch local date (UTC) via `date -u`
2. Fetch provider model pages for Claude and Codex (live each day, via HTTP)
3. Identify models that are SOTA for the day
4. Select the cheapest SOTA model per provider
5. Record model name, context window, tool support, and rationale
6. Store raw provider doc snapshots alongside the audit record
7. Update LiBrainian model registry and audit log

## Required Provider Sources

| Provider | Source | Refresh |
|----------|--------|---------|
| Claude | Official docs page | Daily |
| Codex | Official docs page | Daily |

Record URL and access timestamp for each fetch.

## Selection Template

```json
{
  "kind": "ModelSelectionRecord.v1",
  "schemaVersion": 1,
  "date": "YYYY-MM-DD",
  "provider": "claude|codex",
  "chosenModel": "model-name",
  "contextWindow": 128000,
  "toolSupport": true,
  "rationale": "Cheapest SOTA for today",
  "docsUrl": "https://...",
  "docsSnapshot": "path/to/snapshot",
  "fetchedAt": "ISO8601",
  "tier": "haiku|sonnet|opus"
}
```

## Model Tiers

| Tier | Capability | Use Case | Cost (Relative) |
|------|------------|----------|-----------------|
| Haiku | Fast, cheap, good for simple tasks | Default LiBrainian operations | 1x |
| Sonnet | Balanced, better reasoning | Complex synthesis, escalation | 5x |
| Opus | Best reasoning, highest quality | Critical decisions, disputes | 25x |

## LiBrainian Defaults

- **Primary**: Haiku-class model (latest generation) for all LiBrainian workloads
- **Fallback**: Cheapest SOTA coding-capable Codex model
- **Escalation**: Higher tiers only when documented capability gap exists

## Escalation Rules (Required)

### When to Escalate

Escalate from Haiku to Sonnet when:

1. **Confidence Below Threshold**: Output confidence < 0.4 after Haiku attempt
2. **Complex Synthesis Required**: Multi-file architectural analysis
3. **Conflict Resolution**: Contradicting claims requiring adjudication
4. **Security Analysis**: Threat modeling or vulnerability assessment
5. **Cross-Language Integration**: Analyzing interfaces across 3+ languages

Escalate from Sonnet to Opus when:

1. **Critical Decision**: Blast radius > 50 files or production-facing change
2. **Repeated Failures**: 2+ Sonnet attempts with confidence < 0.5
3. **Human Override**: User explicitly requests higher quality
4. **Audit/Compliance**: Regulatory or compliance-related analysis

### Escalation Procedure

```typescript
interface EscalationDecision {
  currentTier: 'haiku' | 'sonnet' | 'opus';
  targetTier: 'sonnet' | 'opus';
  reason: EscalationReason;
  confidence: number;
  attempt: number;
  approved: boolean;
  costMultiplier: number;
}

type EscalationReason =
  | 'low_confidence'
  | 'complex_synthesis'
  | 'conflict_resolution'
  | 'security_analysis'
  | 'cross_language'
  | 'critical_decision'
  | 'repeated_failure'
  | 'user_override'
  | 'compliance';

function shouldEscalate(
  result: KnowledgeResult,
  context: QueryContext
): EscalationDecision | null {
  // Check confidence threshold
  if (result.confidence.overall < 0.4 && context.currentTier === 'haiku') {
    return {
      currentTier: 'haiku',
      targetTier: 'sonnet',
      reason: 'low_confidence',
      confidence: result.confidence.overall,
      attempt: context.attempt,
      approved: true,  // Auto-approve for confidence
      costMultiplier: 5
    };
  }

  // Check complexity signals
  if (context.fileCount > 10 && context.currentTier === 'haiku') {
    return {
      currentTier: 'haiku',
      targetTier: 'sonnet',
      reason: 'complex_synthesis',
      confidence: result.confidence.overall,
      attempt: context.attempt,
      approved: true,
      costMultiplier: 5
    };
  }

  // ... additional rules
  return null;
}
```

### Escalation Limits

| Metric | Limit | Action on Exceed |
|--------|-------|------------------|
| Escalations per query | 2 | Stop, return best result |
| Cost multiplier per query | 50x | Require human approval |
| Opus uses per hour | 10 | Queue remaining requests |
| Daily Opus budget | 100 calls | Block until next day |

### Escalation Audit

Every escalation is logged:

```json
{
  "kind": "EscalationAuditRecord.v1",
  "queryId": "uuid",
  "timestamp": "ISO8601",
  "fromTier": "haiku",
  "toTier": "sonnet",
  "reason": "low_confidence",
  "inputConfidence": 0.35,
  "outputConfidence": 0.72,
  "costMultiplier": 5,
  "success": true
}
```

## De-escalation Rules

After successful operation, consider de-escalating:

1. **Confidence Restored**: If confidence > 0.7 consistently for 5 queries
2. **Simple Follow-up**: Subsequent queries in same scope can use lower tier
3. **Cache Hit**: Previously synthesized knowledge doesn't need re-synthesis

## Artifacts and Storage

- Selection records: `state/audits/model_selection/YYYY-MM-DD.json`
- Escalation records: `state/audits/model_selection/escalations/YYYY-MM-DD.json`
- Provider snapshots: `state/audits/model_selection/snapshots/`
- Model registry: `src/models/model_registry.ts`

## Runtime Enforcement

1. **On Boot**: Run provider checks
2. **If Checks Fail**: Stop with `unverified_by_trace(provider_unavailable)`
3. **Model Registry**: Update only after successful provider checks
4. **Escalation Gate**: Check budget before escalating

## Automation Hook

- Daily job runs before any LiBrainian bootstrap or query
- If daily record missing, run selection before proceeding
- If provider docs cannot be fetched, return `unverified_by_trace(provider_unavailable)`

## Integration Points

| Component | Path | Purpose |
|-----------|------|---------|
| Provider checks | `src/LiBrainian/api/provider_check.ts` | Verify availability |
| Model registry | `src/models/model_registry.ts` | Store selections |
| Orchestrator routing | `src/orchestrator/model_router.ts` | Route to provider |
| Daily selection | `src/models/model_policy.ts` | Execute selection |
| Escalation logic | `src/models/escalation.ts` | Handle tier changes |

## Failure Modes

| Failure | Response |
|---------|----------|
| Provider outage | Hard fail with `unverified_by_trace(provider_unavailable)` |
| Model removed/renamed | Fall back to next cheapest SOTA, log explicitly |
| Missing tool support | Do not select for workflows requiring tools |
| Escalation budget exceeded | Return best result with warning |
| All tiers fail | Return `unverified_by_trace(all_tiers_failed)` |

---

## Escalation ROI Measurement

Escalation decisions must be measured for cost-effectiveness. Track whether escalations actually improve outcomes.

### Escalation Metrics

| Metric | Definition | Target |
|--------|------------|--------|
| **Escalation Success Rate** | % of escalations that improved confidence by ≥ 0.2 | ≥ 80% |
| **Unnecessary Escalation Rate** | % where Haiku would have sufficed | ≤ 20% |
| **Cost per Confidence Point** | Cost / (confidence_after - confidence_before) | Minimize |
| **Escalation ROI** | Value delivered / cost incurred | ≥ 2.0 |

### Measurement Procedure

```typescript
interface EscalationROIRecord {
  kind: 'EscalationROIRecord.v1';
  schemaVersion: 1;

  // Identity
  queryId: string;
  escalationId: string;
  timestamp: string;          // ISO 8601

  // Before/After
  before: {
    tier: 'haiku' | 'sonnet';
    confidence: number;
    cost: number;             // Estimated tokens * rate
  };
  after: {
    tier: 'sonnet' | 'opus';
    confidence: number;
    cost: number;
  };

  // ROI Calculation
  roi: {
    confidenceDelta: number;  // after.confidence - before.confidence
    costDelta: number;        // after.cost - before.cost
    wasNecessary: boolean;    // Would Haiku have met threshold?
    valueDelivered: number;   // Estimated value of confidence gain
    roiRatio: number;         // valueDelivered / costDelta
  };
}
```

### Audit Requirements

1. **Weekly ROI Review**: Aggregate escalation ROI across all queries
2. **Threshold Tuning**: Adjust escalation thresholds based on ROI data
3. **Unnecessary Escalation Analysis**: Identify patterns causing waste
4. **Cost Budgeting**: Set tier-specific budgets based on historical ROI

### Model-Aware Semantic Claims

When emitting semantic understanding, the model tier used must be recorded:

```typescript
interface SemanticClaim extends Claim {
  // Standard claim fields...

  // Model provenance (required for semantic claims)
  modelProvenance: {
    tier: 'haiku' | 'sonnet' | 'opus';
    modelId: string;
    wasEscalated: boolean;
    escalationReason?: EscalationReason;
    confidenceBeforeEscalation?: number;
  };
}
```

This enables:
- Tracking which claims came from which tier
- Identifying if higher tiers consistently produce better claims
- Optimizing default tier selection based on claim quality

## Document History

| Date | Version | Changes |
|------|---------|---------|
| 2026-01-08 | 1.2.0 | Added Escalation ROI Measurement section and model-aware semantic claims |
| 2026-01-04 | 1.1.0 | Added escalation rules, de-escalation, tier limits, related docs |
| 2026-01-04 | 1.0.0 | Initial model policy specification |

---

*This document is authoritative for LiBrainian model selection and escalation policy.*
