import { existsSync, mkdtempSync } from 'node:fs';
import { mkdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  RUNTIME_ACTIVE_LEASE_DIR,
  pruneRuntimeArtifacts,
} from '../../scripts/prune-runtime-artifacts.mjs';

async function setAgeHours(targetPath: string, hours: number): Promise<void> {
  const stamp = new Date(Date.now() - hours * 60 * 60 * 1000);
  await utimes(targetPath, stamp, stamp);
}

async function createCandidate(root: string, name: string, hoursOld: number): Promise<string> {
  const dir = path.join(root, name);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'artifact.txt'), 'candidate');
  await setAgeHours(dir, hoursOld);
  return dir;
}

describe('prune runtime artifacts active lease protection', () => {
  it('keeps old candidates when root has an active lease', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'prune-runtime-active-'));
    const oldCandidate = await createCandidate(root, 'candidate-old', 8);

    const leaseDir = path.join(root, RUNTIME_ACTIVE_LEASE_DIR);
    await mkdir(leaseDir, { recursive: true });
    const leaseFile = path.join(leaseDir, '12345.lease');
    await writeFile(leaseFile, 'active');
    await setAgeHours(leaseFile, 0.01);

    const result = await pruneRuntimeArtifacts({
      roots: [{ root, include: (name: string) => name.startsWith('candidate-') }],
      maxAgeHours: 1,
      maxEntriesPerRoot: 1,
      enforceSizeBudget: false,
      quiet: true,
    });

    expect(existsSync(oldCandidate)).toBe(true);
    expect(result.roots[0]?.protectedByActiveLease).toBe(true);

    await rm(root, { recursive: true, force: true });
  });

  it('prunes old candidates when lease is stale', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'prune-runtime-stale-'));
    const oldCandidate = await createCandidate(root, 'candidate-old', 8);

    const leaseDir = path.join(root, RUNTIME_ACTIVE_LEASE_DIR);
    await mkdir(leaseDir, { recursive: true });
    const leaseFile = path.join(leaseDir, '99999.lease');
    await writeFile(leaseFile, 'stale');
    await setAgeHours(leaseFile, 8);

    const result = await pruneRuntimeArtifacts({
      roots: [{ root, include: (name: string) => name.startsWith('candidate-') }],
      maxAgeHours: 1,
      maxEntriesPerRoot: 1,
      enforceSizeBudget: false,
      quiet: true,
    });

    expect(existsSync(oldCandidate)).toBe(false);
    expect(result.roots[0]?.protectedByActiveLease).toBe(false);

    await rm(root, { recursive: true, force: true });
  });
});
