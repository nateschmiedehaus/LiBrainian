import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { __testing } from '../bootstrap.js';

describe('bootstrap resumability', () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librainian-bootstrap-'));
  });

  afterEach(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });

  it('persists progress checkpoints for resume', async () => {
    const writer = __testing.createBootstrapCheckpointWriter({
      workspace,
      version: '1.0.0',
      totalPhases: 5,
      startedAt: '2026-01-01T00:00:00.000Z',
      workspaceFingerprint: {
        file_list_hash: 'hash',
        file_count: 1,
        latest_mtime: 0,
      },
      fileInterval: 2,
      timeIntervalMs: 0,
    });

    await writer.update({
      phaseIndex: 1,
      phaseName: 'semantic_indexing',
      progress: { total: 10, completed: 1, currentFile: 'a.ts' },
    });
    const firstState = await __testing.readBootstrapRecoveryState(workspace);
    expect(firstState).toBeNull();

    await writer.update({
      phaseIndex: 1,
      phaseName: 'semantic_indexing',
      progress: { total: 10, completed: 2, currentFile: 'b.ts' },
    });
    const checkpointed = await __testing.readBootstrapRecoveryState(workspace);
    if (!checkpointed) {
      throw new Error('Expected checkpoint to be persisted');
    }
    expect(checkpointed.phase_index).toBe(1);
    expect(checkpointed.phase_name).toBe('semantic_indexing');
    expect(checkpointed.phase_progress?.completed).toBe(2);
    expect(checkpointed.phase_progress?.total).toBe(10);
    expect(checkpointed.phase_progress?.currentFile).toBe('b.ts');
    expect(checkpointed.workspace_fingerprint?.file_list_hash).toBe('hash');

    const writer2 = __testing.createBootstrapCheckpointWriter({
      workspace,
      version: '1.0.0',
      totalPhases: 5,
      startedAt: '2026-01-01T00:00:00.000Z',
      workspaceFingerprint: {
        file_list_hash: 'hash',
        file_count: 1,
        latest_mtime: 0,
      },
      fileInterval: 1,
      timeIntervalMs: 0,
    });

    await writer2.update({
      phaseIndex: 1,
      phaseName: 'semantic_indexing',
      progress: { total: 10, completed: 3, currentFile: 'c.ts' },
    });
    const resumed = await __testing.readBootstrapRecoveryState(workspace);
    if (!resumed) {
      throw new Error('Expected resumed checkpoint to be persisted');
    }
    expect(resumed.phase_progress?.completed).toBe(3);
    expect(writer2.getSnapshot()?.progress.completed).toBe(3);
  });
});
