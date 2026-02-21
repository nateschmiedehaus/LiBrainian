import { describe, it, expect } from 'vitest';
import type { LiBrainianMetadata, LiBrainianVersion } from '../../types.js';
import { buildSystemContract } from '../system_contract.js';

describe('buildSystemContract', () => {
  const version: LiBrainianVersion = {
    major: 2,
    minor: 0,
    patch: 0,
    string: '2.0.0',
    qualityTier: 'full',
    indexedAt: new Date('2026-01-19T00:00:00.000Z'),
    indexerVersion: '2.0.0',
    features: ['watch'],
  };

  it('includes provenance and invariants', () => {
    const metadata: LiBrainianMetadata = {
      version,
      workspace: '/tmp/workspace',
      lastBootstrap: new Date('2026-01-18T00:00:00.000Z'),
      lastIndexing: new Date('2026-01-19T00:00:00.000Z'),
      totalFiles: 10,
      totalFunctions: 20,
      totalContextPacks: 5,
      qualityTier: 'full',
    };

    const contract = buildSystemContract({
      workspace: '/tmp/workspace',
      version,
      metadata,
      headSha: 'abc123',
      watchState: { schema_version: 1, workspace_root: '/tmp/workspace' },
      watchHealth: { suspectedDead: false, heartbeatAgeMs: 100, eventAgeMs: 200, reindexAgeMs: 300, stalenessMs: 300 },
    });

    expect(contract.version).toEqual(version);
    expect(contract.invariants.providerGatingRequired).toBe(true);
    expect(contract.indexProvenance.workspaceHeadSha).toBe('abc123');
    expect(contract.watchProvenance.state?.workspace_root).toBe('/tmp/workspace');
    expect(contract.watchProvenance.health?.suspectedDead).toBe(false);
  });

  it('handles missing metadata', () => {
    const contract = buildSystemContract({
      workspace: '/tmp/workspace',
      version,
      metadata: null,
      headSha: null,
      watchState: null,
      watchHealth: null,
    });

    expect(contract.indexProvenance.lastIndexing).toBeNull();
    expect(contract.indexProvenance.totalFiles).toBeNull();
  });
});
