import { describe, it, expect } from 'vitest';
import { LiBrainian } from '../librainian.js';
import { createVerificationPlan } from '../../strategic/verification_plan.js';
import { createEpisode } from '../../strategic/episodes.js';
import type { LiBrainianStorage } from '../../storage/types.js';

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

describe('LiBrainian memory helpers', () => {
  it('stores and lists verification plans', async () => {
    const librainian = new LiBrainian({
      workspace: '/tmp/workspace',
      autoBootstrap: false,
      autoWatch: false,
    });
    const storage = new MockStorage();
    (librainian as unknown as { storage: LiBrainianStorage }).storage = storage as unknown as LiBrainianStorage;

    const plan = createVerificationPlan({
      id: 'vp-1',
      target: 'claim-1',
      methods: [],
      expectedObservations: [],
    });

    await librainian.saveVerificationPlan(plan);
    const list = await librainian.listVerificationPlans();
    expect(list).toHaveLength(1);
  });

  it('records and lists episodes', async () => {
    const librainian = new LiBrainian({
      workspace: '/tmp/workspace',
      autoBootstrap: false,
      autoWatch: false,
    });
    const storage = new MockStorage();
    (librainian as unknown as { storage: LiBrainianStorage }).storage = storage as unknown as LiBrainianStorage;

    const episode = createEpisode({
      id: 'ep-1',
      type: 'task_execution',
      context: { environment: 'test', state: {} },
      outcome: { success: true, duration: 5 },
    });

    await librainian.recordEpisode(episode);
    const list = await librainian.listEpisodes();
    expect(list).toHaveLength(1);
  });
});
