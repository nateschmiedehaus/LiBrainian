import { describe, it, expect } from 'vitest';
import { createStorageSlices, __testing } from '../slices.js';
import type { LiBrainianStorage } from '../types.js';

describe('createStorageSlices', () => {
  it('returns shared storage references for slices', async () => {
    const calls: string[] = [];
    const storage = {
      getMetadata: async () => {
        calls.push('getMetadata');
        return null;
      },
    } as unknown as LiBrainianStorage;

    const slices = createStorageSlices(storage, { strict: false });

    await slices.metadata.getMetadata();

    expect(calls).toEqual(['getMetadata']);
    expect(slices.raw).toBe(storage);
  });

  it('builds each slice with its declared method list', () => {
    const storage = {} as LiBrainianStorage;
    const slices =
      createStorageSlices(storage, { strict: false }) as unknown as Record<string, Record<string, unknown>>;

    for (const [sliceName, methods] of Object.entries(__testing.sliceMethods)) {
      const slice = slices[sliceName];
      const expected = (methods ?? []).slice().sort();
      const actual = Object.keys(slice ?? {}).slice().sort();
      expect(actual).toEqual(expected);
    }
  });
});
