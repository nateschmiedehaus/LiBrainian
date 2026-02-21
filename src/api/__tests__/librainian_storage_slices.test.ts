import { describe, it, expect } from 'vitest';
import { Librarian } from '../librarian.js';
import type { LibrarianStorage } from '../../storage/types.js';

type StorageStub = Pick<LibrarianStorage, 'getMetadata' | 'setMetadata'>;

class MockStorage implements StorageStub {
  private metadata: Record<string, unknown> | null = null;

  async getMetadata(): Promise<Record<string, unknown> | null> {
    return this.metadata;
  }

  async setMetadata(metadata: Record<string, unknown>): Promise<void> {
    this.metadata = metadata;
  }
}

describe('Librarian storage slices', () => {
  it('exposes storage slices when initialized', async () => {
    const librarian = new Librarian({
      workspace: '/tmp/workspace',
      autoBootstrap: false,
      autoWatch: false,
    });
    const storage = new MockStorage();
    (librarian as unknown as { storage: LibrarianStorage }).storage = storage as unknown as LibrarianStorage;

    const slices = librarian.getStorageSlices({ strict: false });
    await slices.metadata.setMetadata({ version: 'test' });

    const stored = await slices.metadata.getMetadata();
    expect(stored).toEqual({ version: 'test' });
  });
});
