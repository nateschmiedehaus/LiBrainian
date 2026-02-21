import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { __testing } from '../bootstrap.js';

describe('bootstrap recovery fingerprint', () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librainian-fp-'));
  });

  afterEach(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });

  it('changes when file list changes', async () => {
    await fs.writeFile(path.join(workspace, 'a.txt'), 'alpha');
    const first = await __testing.computeWorkspaceFingerprint({
      workspace,
      include: ['**/*'],
      exclude: [],
    });

    await fs.writeFile(path.join(workspace, 'b.txt'), 'beta');
    const second = await __testing.computeWorkspaceFingerprint({
      workspace,
      include: ['**/*'],
      exclude: [],
    });

    expect(second.file_count).toBe(first.file_count + 1);
    expect(second.file_list_hash).not.toBe(first.file_list_hash);
    expect(__testing.fingerprintsMatch(second, first)).toBe(false);
  });

  it('matches identical snapshots', async () => {
    await fs.writeFile(path.join(workspace, 'a.txt'), 'alpha');
    const first = await __testing.computeWorkspaceFingerprint({
      workspace,
      include: ['**/*'],
      exclude: [],
    });
    const second = await __testing.computeWorkspaceFingerprint({
      workspace,
      include: ['**/*'],
      exclude: [],
    });

    expect(__testing.fingerprintsMatch(first, second)).toBe(true);
  });
});
