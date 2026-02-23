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

async function setPathAge(targetPath: string, ageMs: number): Promise<void> {
  const mtime = new Date(Date.now() - ageMs);
  await fs.utimes(targetPath, mtime, mtime);
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

  it('enforces bounded growth on repeated-run transient artifacts', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librainian-retention-bounded-'));
    try {
      await fs.mkdir(path.join(workspace, '.git'), { recursive: true });

      for (let index = 0; index < 15; index += 1) {
        const sandbox = path.join(workspace, '.patrol-tmp', `sandbox-${String(index).padStart(2, '0')}`);
        await fs.mkdir(sandbox, { recursive: true });
        const time = new Date(Date.now() - (15 - index) * 1000);
        await fs.utimes(sandbox, time, time);
      }

      for (let index = 0; index < 8; index += 1) {
        const tgz = path.join(workspace, `librainian-${index}.tgz`);
        await writeFileAt(tgz, (8 - index) * 1000);
      }

      const applied = await runArtifactRetention({
        workspaceRoot: workspace,
        context: 'repo',
        dryRun: false,
      });

      const sandboxEntries = await fs.readdir(path.join(workspace, '.patrol-tmp'));
      const tgzEntries = (await fs.readdir(workspace)).filter((entry) => /^librainian-.*\.tgz$/u.test(entry));

      expect(sandboxEntries.length).toBeLessThanOrEqual(10);
      expect(tgzEntries.length).toBeLessThanOrEqual(4);
      expect(existsSync(path.join(workspace, '.patrol-tmp', 'sandbox-14'))).toBe(true);
      expect(existsSync(path.join(workspace, '.patrol-tmp', 'sandbox-00'))).toBe(false);
      expect(existsSync(path.join(workspace, 'librainian-7.tgz'))).toBe(true);
      expect(existsSync(path.join(workspace, 'librainian-0.tgz'))).toBe(false);
      expect(applied.audit.summary.deleted).toBeGreaterThanOrEqual(9);
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  it('prunes external clean clones from configured roots while preserving recent activity', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librainian-retention-ext-clones-'));
    const externalRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'librainian-retention-ext-root-'));
    try {
      await fs.mkdir(path.join(workspace, '.git'), { recursive: true });
      await fs.writeFile(
        path.join(workspace, '.librainian-retention.json'),
        JSON.stringify({
          classes: {
            externalCleanClones: {
              searchRoots: [externalRoot],
              maxAgeDays: 0.01,
              maxCount: 1,
            },
          },
        }),
        'utf8',
      );

      const oldByAge = path.join(externalRoot, 'librarian-clean-clone-old-age');
      const oldByCount = path.join(externalRoot, 'librainian-clean-clone-old-count');
      const recent = path.join(externalRoot, 'librainian-clean-clone-recent');
      await fs.mkdir(oldByAge, { recursive: true });
      await fs.mkdir(oldByCount, { recursive: true });
      await fs.mkdir(recent, { recursive: true });

      await setPathAge(oldByAge, 10 * DAY_MS);
      await setPathAge(oldByCount, 5 * DAY_MS);
      await setPathAge(recent, 1 * 60 * 60 * 1000);

      const applied = await runArtifactRetention({
        workspaceRoot: workspace,
        context: 'repo',
        dryRun: false,
      });

      expect(existsSync(oldByAge)).toBe(false);
      expect(existsSync(oldByCount)).toBe(false);
      expect(existsSync(recent)).toBe(true);

      const cloneDecisions = applied.audit.decisions.filter(
        (decision) => decision.classId === 'externalCleanClones',
      );
      expect(cloneDecisions.length).toBe(3);
      const recentDecision = cloneDecisions.find((decision) => decision.path.endsWith('librainian-clean-clone-recent'));
      expect(recentDecision?.action).toBe('keep');
      expect(recentDecision?.reason).toBe('recent_activity_guard');
      expect(applied.policy.classes.externalCleanClones.searchRoots).toContain(externalRoot);
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
      await fs.rm(externalRoot, { recursive: true, force: true });
    }
  });

  it('prunes external AB harness artifacts from configured roots', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librainian-retention-ext-harness-'));
    const externalRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'librainian-retention-ext-root-'));
    try {
      await fs.mkdir(path.join(workspace, '.git'), { recursive: true });
      await fs.writeFile(
        path.join(workspace, '.librainian-retention.json'),
        JSON.stringify({
          classes: {
            externalHarnessArtifacts: {
              searchRoots: [externalRoot],
              maxAgeDays: 7,
              maxCount: 10,
            },
          },
        }),
        'utf8',
      );

      const harnessRoot = path.join(externalRoot, 'librainian', '.ab-harness-artifacts');
      const oldRun = path.join(harnessRoot, 'run-old');
      const recentRun = path.join(harnessRoot, 'run-recent');
      await fs.mkdir(oldRun, { recursive: true });
      await fs.mkdir(recentRun, { recursive: true });
      await setPathAge(oldRun, 10 * DAY_MS);
      await setPathAge(recentRun, 2 * DAY_MS);

      const applied = await runArtifactRetention({
        workspaceRoot: workspace,
        context: 'repo',
        dryRun: false,
      });

      expect(existsSync(oldRun)).toBe(false);
      expect(existsSync(recentRun)).toBe(true);

      const harnessDecisions = applied.audit.decisions.filter(
        (decision) => decision.classId === 'externalHarnessArtifacts',
      );
      expect(harnessDecisions.length).toBe(2);
      const oldDecision = harnessDecisions.find((decision) => decision.path.endsWith(path.join('.ab-harness-artifacts', 'run-old')));
      expect(oldDecision?.action).toBe('delete');
      expect(oldDecision?.reason).toBe('age_limit');
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
      await fs.rm(externalRoot, { recursive: true, force: true });
    }
  });
});
