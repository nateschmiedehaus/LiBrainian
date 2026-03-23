import type {
  ConstructionPlan,
  StageReport,
} from '../types.js';
import type { IEvidenceLedger, SessionId } from '../epistemics/evidence_ledger.js';

export type QueryEvidenceEvent = 'query_start' | 'query_complete' | 'query_cache_hit' | 'query_error';

export async function appendQueryEvidence(
  ledger: IEvidenceLedger,
  sessionId: SessionId,
  event: QueryEvidenceEvent,
  payload: Record<string, unknown>
): Promise<void> {
  try {
    await ledger.append({
      kind: 'tool_call',
      payload: {
        toolName: `librarian_query_${event}`,
        arguments: payload,
        result: event === 'query_error' ? null : payload,
        success: event !== 'query_error',
        durationMs: 0,
        errorMessage: event === 'query_error' ? String(payload.errorMessage ?? 'unverified_by_trace(query_failed)') : undefined,
      },
      provenance: {
        source: 'system_observation',
        method: 'librarian_query',
        agent: { type: 'tool', identifier: 'librarian' },
      },
      relatedEntries: [],
      sessionId,
    });
  } catch {
    // Evidence ledger failures must not break queries.
  }
}

export async function appendStageEvidence(
  ledger: IEvidenceLedger,
  sessionId: SessionId,
  report: StageReport
): Promise<void> {
  try {
    await ledger.append({
      kind: 'tool_call',
      payload: {
        toolName: 'librarian_query_stage',
        arguments: { stage: report.stage, status: report.status },
        result: report,
        success: report.status === 'success',
        durationMs: report.durationMs ?? 0,
        errorMessage: report.status === 'failed' ? report.issues.map((issue) => issue.message).join('; ') : undefined,
      },
      provenance: {
        source: 'system_observation',
        method: 'query_stage',
        agent: { type: 'tool', identifier: 'librarian' },
      },
      relatedEntries: [],
      sessionId,
    });
  } catch {
    // Non-fatal.
  }
}

export async function appendConstructionPlanEvidence(
  ledger: IEvidenceLedger,
  sessionId: SessionId,
  plan: ConstructionPlan
): Promise<void> {
  try {
    await ledger.append({
      kind: 'tool_call',
      payload: {
        toolName: 'construction_plan',
        arguments: {
          planId: plan.id,
          templateId: plan.templateId,
          ucIds: plan.ucIds,
          domain: plan.domain ?? null,
          source: plan.source,
          selectionReason: plan.selectionReason ?? null,
          requiredMaps: plan.requiredMaps ?? [],
          requiredCapabilities: plan.requiredCapabilities ?? [],
          requiredArtifacts: plan.requiredArtifacts ?? [],
          rankedCandidates: (plan.rankedCandidates ?? []).map((candidate) => ({
            templateId: candidate.templateId,
            score: candidate.score,
            source: candidate.source,
          })),
        },
        result: plan,
        success: true,
        durationMs: 0,
      },
      provenance: {
        source: 'system_observation',
        method: 'construction_plan',
        agent: { type: 'tool', identifier: 'librarian' },
      },
      relatedEntries: [],
      sessionId,
    });
  } catch {
    // Non-fatal.
  }
}
