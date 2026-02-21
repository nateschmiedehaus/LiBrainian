import type { LiBrainianStorage } from '../storage/types.js';

export interface TaskOutcomeSummary { success: boolean; failureReason?: string; failureType?: string; }
export interface AgentKnowledgeContext { packIds: string[]; affectedEntities: string[]; }
export interface SuspiciousPack { packId: string; score: number; successCount: number; failureCount: number; }
export interface CausalAttribution { knowledgeCaused: boolean; confidence: number; evidence: string; affectedEntities: string[]; suspiciousPacks: SuspiciousPack[]; recommendation: string; }

const NON_KNOWLEDGE_FAILURES = ['timeout', 'provider_error', 'provider unavailable', 'test_flake'];
const KNOWLEDGE_FAILURES = ['unexpected_behavior', 'knowledge_mismatch', 'incorrect_context', 'hallucination'];
const MIN_SAMPLES = 3;

export async function attributeFailure(
  storage: LiBrainianStorage,
  outcome: TaskOutcomeSummary,
  context: AgentKnowledgeContext
): Promise<CausalAttribution> {
  if (outcome.success) {
    return {
      knowledgeCaused: false,
      confidence: 0.2,
      evidence: 'Task succeeded; no failure attribution required.',
      affectedEntities: context.affectedEntities,
      suspiciousPacks: [],
      recommendation: 'No action needed.',
    };
  }

  const reason = `${outcome.failureType ?? ''} ${outcome.failureReason ?? ''}`.toLowerCase();
  if (NON_KNOWLEDGE_FAILURES.some((token) => reason.includes(token))) {
    return {
      knowledgeCaused: false,
      confidence: 0.6,
      evidence: `Failure attributed to non-knowledge issue: ${reason || 'unspecified'}`,
      affectedEntities: context.affectedEntities,
      suspiciousPacks: [],
      recommendation: 'Investigate non-knowledge failure sources before updating packs.',
    };
  }

  const packs = await Promise.all(context.packIds.map((packId) => storage.getContextPack(packId)));
  const counts = packs.filter((pack): pack is NonNullable<typeof pack> => Boolean(pack));
  const totalFailures = counts.reduce((sum, pack) => sum + (pack.failureCount ?? 0), 0);
  const totalSuccesses = counts.reduce((sum, pack) => sum + (pack.successCount ?? 0), 0);
  const packScores: SuspiciousPack[] = [];

  for (const pack of counts) {
    const successCount = pack.successCount ?? 0;
    const failureCount = pack.failureCount ?? 0;
    const score = computeOchiaiScore(failureCount, successCount, totalFailures);
    packScores.push({ packId: pack.packId, score, successCount, failureCount });
  }

  packScores.sort((a, b) => b.score - a.score);
  const topScore = packScores[0]?.score ?? 0;
  const knowledgeHint = KNOWLEDGE_FAILURES.some((token) => reason.includes(token));
  const knowledgeCaused = knowledgeHint || topScore > 0.4;
  const suspiciousPacks = packScores.filter((pack) => pack.score > 0.2);

  let recommendation = 'Investigate agent behavior - no strong pack correlation found.';
  if (knowledgeCaused && packScores[0]) {
    recommendation = `Reindex pack ${packScores[0].packId} (Ochiai score: ${topScore.toFixed(2)})`;
  }

  return {
    knowledgeCaused,
    confidence: Math.min(topScore * 1.2, 0.95),
    evidence: `SBFL analysis: ${packScores.length} packs analyzed, total failures ${totalFailures}, total successes ${totalSuccesses}`,
    affectedEntities: context.affectedEntities,
    suspiciousPacks,
    recommendation,
  };
}

export async function recordPackOutcome(
  storage: LiBrainianStorage,
  packId: string,
  success: boolean
): Promise<void> {
  await storage.recordContextPackAccess(packId, success ? 'success' : 'failure');
}

function computeOchiaiScore(
  failureCount: number,
  successCount: number,
  totalFailures: number
): number {
  const total = failureCount + successCount;
  if (total < MIN_SAMPLES) return 0.5;
  if (totalFailures <= 0) return 0.0;
  return failureCount / Math.sqrt(totalFailures * total);
}
