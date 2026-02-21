import { describe, it, expect } from 'vitest';
import { LiBrainian } from '../librainian.js';
import type { LiBrainianStorage } from '../../storage/types.js';

type StorageStub = Pick<LiBrainianStorage, 'getMetadata' | 'setMetadata'>;

class MockStorage implements StorageStub {
  private metadata: Record<string, unknown> | null = null;

  async getMetadata(): Promise<Record<string, unknown> | null> {
    return this.metadata;
  }

  async setMetadata(metadata: Record<string, unknown>): Promise<void> {
    this.metadata = metadata;
  }
}

describe('LiBrainian storage slices', () => {
  it('exposes storage slices when initialized', async () => {
    const librainian = new LiBrainian({
      workspace: '/tmp/workspace',
      autoBootstrap: false,
      autoWatch: false,
    });
    const storage = new MockStorage();
    (librainian as unknown as { storage: LiBrainianStorage }).storage = storage as unknown as LiBrainianStorage;

    const slices = librainian.getStorageSlices({ strict: false });
    await slices.metadata.setMetadata({ version: 'test' });

    const stored = await slices.metadata.getMetadata();
    expect(stored).toEqual({ version: 'test' });
  });
});
