import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  resolveRetentionPolicy,
  runArtifactRetention,
} from '../../../scripts/artifact-retention-policy.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;

async function writeFileAt(filePath: string, ageMs: number): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, 'x', 'utf8');
  const mtime = new Date(Date.now() - ageMs);
  await fs.utimes(filePath, mtime, mtime);
}

describe('artifact retention policy', () => {
  it('uses installed defaults when workspace is not a git repo', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librainian-retention-installed-'));
    try {
      const policy = await resolveRetentionPolicy({
        workspaceRoot: workspace,
        context: 'auto',
      });
      expect(policy.context).toBe('installed');
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  it('fails closed if override tries to unprotect release evidence', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librainian-retention-protected-'));
    try {
      await fs.mkdir(path.join(workspace, '.git'), { recursive: true });
      await fs.writeFile(
        path.join(workspace, '.librainian-retention.json'),
        JSON.stringify({
          classes: {
            releaseEvidence: { protected: false },
          },
        }),
        'utf8',
      );

      await expect(
        resolveRetentionPolicy({
          workspaceRoot: workspace,
          context: 'repo',
        }),
      ).rejects.toThrow(/cannot be downgraded/u);
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  it('keeps protected evidence and prunes aged transient artifacts', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librainian-retention-prune-'));
    try {
      await fs.mkdir(path.join(workspace, '.git'), { recursive: true });
      const releaseEvidence = path.join(workspace, 'state', 'dogfood', 'clean-clone-self-hosting.local.json');
      const oldPatrol = path.join(workspace, 'state', 'patrol', 'patrol-run-old.json');
      const oldSandbox = path.join(workspace, '.patrol-tmp', 'sandbox-old');
      const oldTgz = path.join(workspace, 'librainian-old.tgz');

      await writeFileAt(releaseEvidence, 400 * DAY_MS);
      await writeFileAt(oldPatrol, 40 * DAY_MS);
      await fs.mkdir(oldSandbox, { recursive: true });
      await fs.utimes(oldSandbox, new Date(Date.now() - 5 * DAY_MS), new Date(Date.now() - 5 * DAY_MS));
      await writeFileAt(oldTgz, 5 * DAY_MS);

      const dryRun = await runArtifactRetention({
        workspaceRoot: workspace,
        context: 'repo',
        dryRun: true,
      });
      expect(dryRun.audit.summary.deleted).toBeGreaterThanOrEqual(3);
      expect(existsSync(oldPatrol)).toBe(true);
      expect(existsSync(oldTgz)).toBe(true);
      expect(existsSync(releaseEvidence)).toBe(true);

      const applied = await runArtifactRetention({
        workspaceRoot: workspace,
        context: 'repo',
        dryRun: false,
      });
      expect(applied.audit.summary.deleted).toBeGreaterThanOrEqual(3);
      expect(existsSync(oldPatrol)).toBe(false);
      expect(existsSync(oldSandbox)).toBe(false);
      expect(existsSync(oldTgz)).toBe(false);
      expect(existsSync(releaseEvidence)).toBe(true);

      const releaseDecision = applied.audit.decisions.find(
        (decision) => decision.classId === 'releaseEvidence' && decision.path.endsWith('clean-clone-self-hosting.local.json'),
      );
      expect(releaseDecision?.action).toBe('keep');
      expect(releaseDecision?.reason).toBe('protected');
      expect(applied.auditPath).toContain(path.join('state', 'retention'));
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });
});

