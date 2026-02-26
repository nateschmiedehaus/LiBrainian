import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { __testing } from '../bootstrap.js';

describe('bootstrap stale artifact recovery', () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-bootstrap-artifact-'));
    await fs.mkdir(path.join(workspace, '.librarian'), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });

  async function seedStaleBackup({
    currentContent,
    backupContent,
  }: {
    currentContent: string;
    backupContent: string;
  }): Promise<void> {
    const artifactPath = path.join(workspace, '.librarian', 'librarian.sqlite');
    const backupPath = `${artifactPath}.bak.test`;
    const backupStatePath = __testing.bootstrapArtifactBackupPath(workspace);
    const consistencyPath = __testing.bootstrapConsistencyPath(workspace);
    const timestamp = new Date().toISOString();

    await fs.writeFile(artifactPath, currentContent, 'utf8');
    await fs.writeFile(backupPath, backupContent, 'utf8');
    await fs.writeFile(
      backupStatePath,
      JSON.stringify({
        kind: 'BootstrapArtifactBackupState.v1',
        schema_version: 1,
        workspace,
        generation_id: 'gen-test',
        created_at: timestamp,
        files: [{ original_path: artifactPath, backup_path: backupPath }],
      }),
      'utf8'
    );
    await fs.writeFile(
      consistencyPath,
      JSON.stringify({
        kind: 'BootstrapConsistencyState.v1',
        schema_version: 1,
        workspace,
        generation_id: 'gen-test',
        status: 'in_progress',
        started_at: timestamp,
        updated_at: timestamp,
        artifacts: {
          librarian: { path: artifactPath, exists: true, size_bytes: 1, mtime_ms: Date.now() },
          knowledge: { path: path.join(workspace, '.librarian', 'knowledge.db'), exists: false },
          evidence: { path: path.join(workspace, '.librarian', 'evidence_ledger.db'), exists: false },
        },
      }),
      'utf8'
    );
  }

  it('restores stale backup by default', async () => {
    await seedStaleBackup({ currentContent: 'current', backupContent: 'backup' });

    const consistency = await fs.readFile(__testing.bootstrapConsistencyPath(workspace), 'utf8');
    const result = await __testing.recoverStaleBootstrapArtifactBackup(
      workspace,
      JSON.parse(consistency)
    );

    expect(result).toEqual({ hadBackup: true, restored: true });
    await expect(fs.readFile(path.join(workspace, '.librarian', 'librarian.sqlite'), 'utf8')).resolves.toBe('backup');
    await expect(fs.access(__testing.bootstrapArtifactBackupPath(workspace))).rejects.toThrow();
  });

  it('discards stale backup when restoreArtifacts is false', async () => {
    await seedStaleBackup({ currentContent: 'current', backupContent: 'backup' });

    const consistency = await fs.readFile(__testing.bootstrapConsistencyPath(workspace), 'utf8');
    const result = await __testing.recoverStaleBootstrapArtifactBackup(
      workspace,
      JSON.parse(consistency),
      { restoreArtifacts: false }
    );

    expect(result).toEqual({ hadBackup: true, restored: false });
    await expect(fs.readFile(path.join(workspace, '.librarian', 'librarian.sqlite'), 'utf8')).resolves.toBe('current');
    await expect(fs.access(__testing.bootstrapArtifactBackupPath(workspace))).rejects.toThrow();
  });
});
