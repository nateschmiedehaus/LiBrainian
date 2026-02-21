import { describe, it, expect } from 'vitest';
import type { LiBrainianStorage, MetadataStorage } from '../../storage/types.js';
import { createEpisode } from '../../strategic/episodes.js';
import { ClosedLoopLearner, __testing } from '../learning_loop.js';

type StorageStub = Pick<LiBrainianStorage, 'getState' | 'setState'>;

class MockStorage implements StorageStub {
  private state = new Map<string, string>();

  async getState(key: string): Promise<string | null> {
    return this.state.get(key) ?? null;
  }

  async setState(key: string, value: string): Promise<void> {
    this.state.set(key, value);
  }
}

async function getLearningState(storage: MockStorage) {
  return __testing.loadLearningState(storage as unknown as MetadataStorage);
}

describe('learning loop', () => {
  it('records outcomes and returns recommendations', async () => {
    const storage = new MockStorage();
    const learner = new ClosedLoopLearner(storage as unknown as LiBrainianStorage);
    const episode = createEpisode({
      id: 'ep_learning_1',
      type: 'learning',
      context: {
        environment: 'librainian.test',
        state: { intent: 'release readiness' },
      },
      outcome: {
        success: true,
        duration: 1200,
      },
      metadata: {},
    });

    const update = await learner.recordOutcome(episode, {
      success: true,
      compositionId: 'tc_release_readiness',
      primitiveIds: ['tp_release_checklist'],
      contextPackIds: ['pack_release_1'],
    });

    expect(update.modelUpdates.length).toBeGreaterThan(0);
    const recommendations = await learner.getRecommendations('release readiness');
    expect(recommendations.suggestedCompositions[0]?.compositionId).toBe('tc_release_readiness');
    expect(recommendations.effectivePrimitives[0]?.primitiveId).toBe('tp_release_checklist');
    expect(recommendations.reliableContextSources[0]?.sourceId).toBe('pack_release_1');
  });

  it('includes warnings from failed outcomes', async () => {
    const storage = new MockStorage();
    const learner = new ClosedLoopLearner(storage as unknown as LiBrainianStorage);
    const episode = createEpisode({
      id: 'ep_learning_2',
      type: 'learning',
      context: {
        environment: 'librainian.test',
        state: { intent: 'audit compliance' },
      },
      outcome: {
        success: false,
        duration: 900,
        error: 'timeout while scanning',
      },
      metadata: {},
    });

    await learner.recordOutcome(episode, {
      success: false,
      compositionId: 'tc_custom_audit',
      error: 'timeout while scanning',
    });

    const recommendations = await learner.getRecommendations('audit compliance');
    expect(recommendations.warningsFromHistory[0]?.failure).toMatch(/timeout while scanning/);
  });

  it('suppresses anti-pattern recommendations and emits warnings', async () => {
    const storage = new MockStorage();
    const learner = new ClosedLoopLearner(storage as unknown as LiBrainianStorage);
    const episode = createEpisode({
      id: 'ep_learning_3',
      type: 'learning',
      context: {
        environment: 'librainian.test',
        state: { intent: 'reliability audit' },
      },
      outcome: {
        success: false,
        duration: 800,
      },
      metadata: {},
    });

    for (let i = 0; i < 5; i += 1) {
      await learner.recordOutcome(episode, {
        success: false,
        compositionId: 'tc_flaky',
        error: 'flaky failure',
      });
    }

    await learner.recordOutcome(episode, {
      success: true,
      compositionId: 'tc_stable',
    });

    const recommendations = await learner.getRecommendations('reliability audit');
    expect(recommendations.suggestedCompositions.some((item) => item.compositionId === 'tc_flaky')).toBe(false);
    expect(recommendations.suggestedCompositions[0]?.compositionId).toBe('tc_stable');
    expect(
      recommendations.warningsFromHistory.some((warning) => warning.failure === 'This approach has failed consistently')
    ).toBe(true);
  });

  it('consolidates patterns and promotes tiers', async () => {
    const storage = new MockStorage();
    const learner = new ClosedLoopLearner(storage as unknown as LiBrainianStorage);
    const episode = createEpisode({
      id: 'ep_learning_4',
      type: 'learning',
      context: {
        environment: 'librainian.test',
        state: { intent: 'release readiness' },
      },
      outcome: {
        success: true,
        duration: 1400,
      },
      metadata: {},
    });

    for (let i = 0; i < 4; i += 1) {
      await learner.recordOutcome(episode, {
        success: true,
        compositionId: 'tc_reliable',
      });
    }

    for (let i = 0; i < 2; i += 1) {
      await learner.recordOutcome(episode, {
        success: true,
        compositionId: 'tc_ambivalent',
      });
      await learner.recordOutcome(episode, {
        success: false,
        compositionId: 'tc_ambivalent',
        error: 'ambivalent failure',
      });
    }

    await learner.consolidate({
      minSampleCount: 4,
      minPredictiveValue: 0.2,
      invariantMinSamples: 4,
      invariantMinSuccessRate: 0.8,
    });

    let state = await getLearningState(storage);
    let record = Object.values(state.intents).find((item) => item.intent === 'release readiness');
    expect(record?.compositions['tc_ambivalent']).toBeUndefined();
    expect(record?.compositions['tc_reliable']?.tier).toBe('recent');

    await learner.consolidate({
      minSampleCount: 4,
      minPredictiveValue: 0.2,
      invariantMinSamples: 4,
      invariantMinSuccessRate: 0.8,
    });
    state = await getLearningState(storage);
    record = Object.values(state.intents).find((item) => item.intent === 'release readiness');
    expect(record?.compositions['tc_reliable']?.tier).toBe('learned');

    await learner.consolidate({
      minSampleCount: 4,
      minPredictiveValue: 0.2,
      invariantMinSamples: 4,
      invariantMinSuccessRate: 0.8,
    });
    state = await getLearningState(storage);
    record = Object.values(state.intents).find((item) => item.intent === 'release readiness');
    expect(record?.compositions['tc_reliable']?.tier).toBe('invariant');
  });

  it('warns when distribution shift is detected', async () => {
    const storage = new MockStorage();
    const learner = new ClosedLoopLearner(storage as unknown as LiBrainianStorage);
    const episode = createEpisode({
      id: 'ep_learning_5',
      type: 'learning',
      context: {
        environment: 'librainian.test',
        state: { intent: 'deploy safety' },
      },
      outcome: {
        success: true,
        duration: 1100,
      },
      metadata: {},
    });

    await learner.recordOutcome(episode, {
      success: true,
      compositionId: 'tc_deploy_safe',
      codebaseStats: {
        embeddingMean: [0, 0],
        embeddingVariance: [1, 1],
        sampleCount: 10,
        collectedAt: new Date().toISOString(),
      },
    });

    const recommendations = await learner.getRecommendations('deploy safety', {
      codebaseStats: {
        embeddingMean: [2, 2],
        embeddingVariance: [1, 1],
        sampleCount: 10,
        collectedAt: new Date().toISOString(),
      },
      requireShiftDetection: true,
    });

    expect(
      recommendations.warningsFromHistory.some((warning) => warning.failure === 'Distribution shift detected; patterns may not apply')
    ).toBe(true);
  });
});
