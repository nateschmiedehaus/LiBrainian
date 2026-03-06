import { describe, expect, it } from 'vitest';
import { generateArchitectureOverview } from '../architecture_overview.js';
import type { LibrarianVersion } from '../../types.js';
import type { LibrarianStorage } from '../../storage/types.js';

const TEST_VERSION: LibrarianVersion = {
  major: 1,
  minor: 0,
  patch: 0,
  string: '1.0.0-test',
  qualityTier: 'full',
  indexedAt: new Date('2026-03-01T00:00:00.000Z'),
  indexerVersion: 'test',
  features: [],
};

describe('architecture_overview', () => {
  it('falls back to the filesystem when directory knowledge is missing', async () => {
    const storage = {
      getDirectories: async () => [],
      getGraphEdges: async () => [],
    } as unknown as LibrarianStorage;

    const pack = await generateArchitectureOverview(storage, process.cwd(), TEST_VERSION);

    expect(pack.summary).toContain('Architecture has');
    expect(pack.keyFacts.some((fact) => fact.includes('api/'))).toBe(true);
    expect(pack.relatedFiles.some((file) => file === 'src/api')).toBe(true);
  });
});
