import { describe, it, expect } from 'vitest';
import { Librarian } from '../librarian.js';
import { createVerificationPlan } from '../../strategic/verification_plan.js';
import { createEpisode } from '../../strategic/episodes.js';
import type { LibrarianStorage } from '../../storage/types.js';

type StorageStub = Pick<LibrarianStorage, 'getState' | 'setState'>;

class MockStorage implements StorageStub {
  private state = new Map<string, string>();

  async getState(key: string): Promise<string | null> {
    return this.state.get(key) ?? null;
  }

  async setState(key: string, value: string): Promise<void> {
    this.state.set(key, value);
  }
}

describe('Librarian memory helpers', () => {
  it('stores and lists verification plans', async () => {
    const librarian = new Librarian({
      workspace: '/tmp/workspace',
      autoBootstrap: false,
      autoWatch: false,
    });
    const storage = new MockStorage();
    (librarian as unknown as { storage: LibrarianStorage }).storage = storage as unknown as LibrarianStorage;

    const plan = createVerificationPlan({
      id: 'vp-1',
      target: 'claim-1',
      methods: [],
      expectedObservations: [],
    });

    await librarian.saveVerificationPlan(plan);
    const list = await librarian.listVerificationPlans();
    expect(list).toHaveLength(1);
  });

  it('records and lists episodes', async () => {
    const librarian = new Librarian({
      workspace: '/tmp/workspace',
      autoBootstrap: false,
      autoWatch: false,
    });
    const storage = new MockStorage();
    (librarian as unknown as { storage: LibrarianStorage }).storage = storage as unknown as LibrarianStorage;

    const episode = createEpisode({
      id: 'ep-1',
      type: 'task_execution',
      context: { environment: 'test', state: {} },
      outcome: { success: true, duration: 5 },
    });

    await librarian.recordEpisode(episode);
    const list = await librarian.listEpisodes();
    expect(list).toHaveLength(1);
  });
});
