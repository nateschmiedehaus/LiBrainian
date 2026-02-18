import { describe, expect, it } from 'vitest';
import { computeChecksum16, computeFileChecksum } from '../checksums.js';

describe('checksums', () => {
  it('computes deterministic 128-bit file checksums', () => {
    const first = computeFileChecksum('const value = 1;');
    const second = computeFileChecksum('const value = 1;');
    const different = computeFileChecksum('const value = 2;');

    expect(first).toHaveLength(32);
    expect(second).toBe(first);
    expect(different).not.toBe(first);
  });

  it('keeps legacy checksum helper stable and prefix-compatible', () => {
    const legacy = computeChecksum16('const value = 1;');
    const full = computeFileChecksum('const value = 1;');

    expect(legacy).toHaveLength(16);
    expect(full.startsWith(legacy)).toBe(true);
  });
});
