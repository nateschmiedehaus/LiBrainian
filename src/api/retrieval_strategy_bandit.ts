import type {
  LibrarianStorage,
  RetrievalStrategyReward,
  RetrievalStrategySelection,
} from '../storage/types.js';

export const RETRIEVAL_STRATEGY_ARMS = [
  'bm25_only',
  'vector_only',
  'hybrid',
  'graph_traversal_first',
  'context_pack_direct',
] as const;

export type RetrievalStrategyArm = (typeof RETRIEVAL_STRATEGY_ARMS)[number];

export interface RetrievalStrategySelectionResult {
  strategyId: RetrievalStrategyArm;
  sampledScores: Record<RetrievalStrategyArm, number>;
}

export interface RetrievalStrategyRewardSnapshot {
  strategyId: RetrievalStrategyArm;
  intentType: string;
  successCount: number;
  failureCount: number;
}

export function isRetrievalStrategyArm(value: string): value is RetrievalStrategyArm {
  return RETRIEVAL_STRATEGY_ARMS.includes(value as RetrievalStrategyArm);
}

function sampleStandardNormal(rng: () => number): number {
  let u1 = 0;
  let u2 = 0;
  while (u1 <= Number.EPSILON) {
    u1 = rng();
  }
  while (u2 <= Number.EPSILON) {
    u2 = rng();
  }
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function sampleGamma(shape: number, rng: () => number): number {
  if (shape <= 0) return 0;
  if (shape < 1) {
    const u = Math.max(rng(), Number.EPSILON);
    return sampleGamma(shape + 1, rng) * Math.pow(u, 1 / shape);
  }

  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  while (true) {
    const x = sampleStandardNormal(rng);
    const v = 1 + c * x;
    if (v <= 0) continue;
    const v3 = v * v * v;
    const u = rng();
    if (u < 1 - 0.0331 * x * x * x * x) {
      return d * v3;
    }
    if (Math.log(u) < 0.5 * x * x + d * (1 - v3 + Math.log(v3))) {
      return d * v3;
    }
  }
}

export function sampleBeta(alpha: number, beta: number, rng: () => number = Math.random): number {
  const x = sampleGamma(alpha, rng);
  const y = sampleGamma(beta, rng);
  const denom = x + y;
  if (denom <= 0) return 0.5;
  return x / denom;
}

export function selectRetrievalStrategyArm(
  intentType: string,
  rewards: RetrievalStrategyRewardSnapshot[],
  rng: () => number = Math.random
): RetrievalStrategySelectionResult {
  const rewardMap = new Map<string, RetrievalStrategyRewardSnapshot>();
  for (const reward of rewards) {
    rewardMap.set(`${reward.intentType}::${reward.strategyId}`, reward);
  }

  const sampledScores = Object.create(null) as Record<RetrievalStrategyArm, number>;
  let bestArm: RetrievalStrategyArm = 'hybrid';
  let bestScore = -1;

  for (const arm of RETRIEVAL_STRATEGY_ARMS) {
    const reward = rewardMap.get(`${intentType}::${arm}`);
    const successCount = reward?.successCount ?? 0;
    const failureCount = reward?.failureCount ?? 0;
    const sampled = sampleBeta(successCount + 1, failureCount + 1, rng);
    sampledScores[arm] = sampled;
    if (sampled > bestScore) {
      bestScore = sampled;
      bestArm = arm;
    }
  }

  return {
    strategyId: bestArm,
    sampledScores,
  };
}

export async function selectAndRecordRetrievalStrategy(
  storage: LibrarianStorage,
  queryId: string,
  intentType: string,
  createdAt: string,
  rng: () => number = Math.random
): Promise<RetrievalStrategySelectionResult> {
  const rewards = typeof storage.getRetrievalStrategyRewards === 'function'
    ? await storage.getRetrievalStrategyRewards(intentType)
    : [];
  const selection = selectRetrievalStrategyArm(intentType, normalizeRewards(rewards), rng);

  if (typeof storage.recordRetrievalStrategySelection === 'function') {
    const record: RetrievalStrategySelection = {
      queryId,
      strategyId: selection.strategyId,
      intentType,
      createdAt,
    };
    await storage.recordRetrievalStrategySelection(record);
  }

  return selection;
}

export async function applyRetrievalStrategyFeedbackForQuery(
  storage: LibrarianStorage,
  queryId: string,
  wasHelpful: boolean,
  outcome: 'success' | 'failure' | 'partial'
): Promise<RetrievalStrategyReward | null> {
  if (typeof storage.applyRetrievalStrategyFeedback !== 'function') return null;
  return storage.applyRetrievalStrategyFeedback(queryId, wasHelpful, outcome);
}

export async function selectRetrievalStrategyForIntent(
  storage: LibrarianStorage,
  intentType: string,
  rng: () => number = Math.random
): Promise<RetrievalStrategySelectionResult> {
  const rewards = typeof storage.getRetrievalStrategyRewards === 'function'
    ? await storage.getRetrievalStrategyRewards(intentType)
    : [];
  return selectRetrievalStrategyArm(intentType, normalizeRewards(rewards), rng);
}

function normalizeRewards(rewards: RetrievalStrategyReward[]): RetrievalStrategyRewardSnapshot[] {
  const normalized: RetrievalStrategyRewardSnapshot[] = [];
  for (const reward of rewards) {
    if (!isRetrievalStrategyArm(reward.strategyId)) continue;
    normalized.push({
      strategyId: reward.strategyId,
      intentType: reward.intentType,
      successCount: reward.successCount,
      failureCount: reward.failureCount,
    });
  }
  return normalized;
}
