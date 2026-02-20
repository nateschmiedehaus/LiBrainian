import { describe, expect, it } from 'vitest';
import {
  RETRIEVAL_STRATEGY_ARMS,
  selectRetrievalStrategyArm,
  type RetrievalStrategyRewardSnapshot,
} from '../retrieval_strategy_bandit.js';

function createSeededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function updateReward(
  rewards: Map<string, { successCount: number; failureCount: number }>,
  intentType: string,
  strategyId: string,
  success: boolean
): void {
  const key = `${intentType}::${strategyId}`;
  const current = rewards.get(key) ?? { successCount: 0, failureCount: 0 };
  if (success) {
    current.successCount += 1;
  } else {
    current.failureCount += 1;
  }
  rewards.set(key, current);
}

function toSnapshots(
  rewards: Map<string, { successCount: number; failureCount: number }>
): RetrievalStrategyRewardSnapshot[] {
  const snapshots: RetrievalStrategyRewardSnapshot[] = [];
  for (const [key, value] of rewards.entries()) {
    const [intentType, strategyId] = key.split('::');
    if (!intentType || !strategyId) continue;
    if (!RETRIEVAL_STRATEGY_ARMS.includes(strategyId as (typeof RETRIEVAL_STRATEGY_ARMS)[number])) continue;
    snapshots.push({
      intentType,
      strategyId: strategyId as (typeof RETRIEVAL_STRATEGY_ARMS)[number],
      successCount: value.successCount,
      failureCount: value.failureCount,
    });
  }
  return snapshots;
}

describe('retrieval strategy bandit', () => {
  it('prefers high-success arms when priors are skewed', () => {
    const rng = createSeededRng(42);
    const snapshots: RetrievalStrategyRewardSnapshot[] = [
      { intentType: 'debug', strategyId: 'hybrid', successCount: 30, failureCount: 4 },
      { intentType: 'debug', strategyId: 'bm25_only', successCount: 2, failureCount: 14 },
      { intentType: 'debug', strategyId: 'vector_only', successCount: 6, failureCount: 12 },
      { intentType: 'debug', strategyId: 'graph_traversal_first', successCount: 3, failureCount: 15 },
      { intentType: 'debug', strategyId: 'context_pack_direct', successCount: 4, failureCount: 11 },
    ];

    const selection = selectRetrievalStrategyArm('debug', snapshots, rng);
    expect(selection.strategyId).toBe('hybrid');
    expect(selection.sampledScores.hybrid).toBeGreaterThan(selection.sampledScores.bm25_only);
  });

  it('converges to the winning arm after 50 feedback events', () => {
    const rng = createSeededRng(1337);
    const rewards = new Map<string, { successCount: number; failureCount: number }>();
    const intentType = 'understand';
    const trueSuccessRate: Record<string, number> = {
      bm25_only: 0.35,
      vector_only: 0.45,
      hybrid: 0.82,
      graph_traversal_first: 0.4,
      context_pack_direct: 0.38,
    };
    let hybridSelections = 0;

    for (let i = 0; i < 50; i += 1) {
      const selection = selectRetrievalStrategyArm(intentType, toSnapshots(rewards), rng);
      if (selection.strategyId === 'hybrid') {
        hybridSelections += 1;
      }
      const success = rng() < trueSuccessRate[selection.strategyId];
      updateReward(rewards, intentType, selection.strategyId, success);
    }

    expect(hybridSelections).toBeGreaterThanOrEqual(30);
  });

  it('keeps strategy selection overhead well below 5ms p99', () => {
    const rng = createSeededRng(7);
    const snapshots: RetrievalStrategyRewardSnapshot[] = [
      { intentType: 'general', strategyId: 'hybrid', successCount: 10, failureCount: 5 },
      { intentType: 'general', strategyId: 'bm25_only', successCount: 4, failureCount: 9 },
      { intentType: 'general', strategyId: 'vector_only', successCount: 8, failureCount: 8 },
      { intentType: 'general', strategyId: 'graph_traversal_first', successCount: 6, failureCount: 10 },
      { intentType: 'general', strategyId: 'context_pack_direct', successCount: 5, failureCount: 9 },
    ];

    const durationsMs: number[] = [];
    for (let i = 0; i < 1000; i += 1) {
      const start = process.hrtime.bigint();
      selectRetrievalStrategyArm('general', snapshots, rng);
      const end = process.hrtime.bigint();
      durationsMs.push(Number(end - start) / 1_000_000);
    }
    durationsMs.sort((a, b) => a - b);
    const p99 = durationsMs[Math.floor(durationsMs.length * 0.99)];
    expect(p99).toBeLessThan(5);
  });
});
