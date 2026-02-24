import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

import { getGitCommitRelation } from '../git.js';

function runGit(repoDir: string, args: string[]): string {
  const result = spawnSync('git', args, {
    cwd: repoDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if ((result.status ?? 1) !== 0) {
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim();
    throw new Error(`git ${args.join(' ')} failed${output ? `: ${output}` : ''}`);
  }
  return (result.stdout ?? '').trim();
}

async function createBaseRepo(): Promise<{ repoDir: string; commitA: string; commitB: string }> {
  const repoDir = await fs.mkdtemp(path.join(os.tmpdir(), 'librarian-git-relation-'));
  runGit(repoDir, ['init']);
  runGit(repoDir, ['checkout', '-B', 'main']);
  runGit(repoDir, ['config', 'user.email', 'tests@librainian.invalid']);
  runGit(repoDir, ['config', 'user.name', 'LiBrainian Tests']);

  const trackedFile = path.join(repoDir, 'app.ts');
  await fs.writeFile(trackedFile, 'export const value = 1;\n', 'utf8');
  runGit(repoDir, ['add', '.']);
  runGit(repoDir, ['commit', '--no-gpg-sign', '-m', 'commit A']);
  const commitA = runGit(repoDir, ['rev-parse', 'HEAD']);

  await fs.writeFile(trackedFile, 'export const value = 2;\n', 'utf8');
  runGit(repoDir, ['add', '.']);
  runGit(repoDir, ['commit', '--no-gpg-sign', '-m', 'commit B']);
  const commitB = runGit(repoDir, ['rev-parse', 'HEAD']);

  return { repoDir, commitA, commitB };
}

describe('getGitCommitRelation deterministic history scenarios', () => {
  it('detects branch-switch drift as diverged when switching to alternate lineage', async () => {
    const { repoDir, commitA, commitB } = await createBaseRepo();
    try {
      runGit(repoDir, ['checkout', '-B', 'feature', commitA]);
      const trackedFile = path.join(repoDir, 'feature.ts');
      await fs.writeFile(trackedFile, 'export const feature = true;\n', 'utf8');
      runGit(repoDir, ['add', '.']);
      runGit(repoDir, ['commit', '--no-gpg-sign', '-m', 'feature commit']);
      const featureHead = runGit(repoDir, ['rev-parse', 'HEAD']);

      expect(getGitCommitRelation(repoDir, commitB, featureHead)).toBe('diverged');
    } finally {
      await fs.rm(repoDir, { recursive: true, force: true });
    }
  });

  it('detects history rewrite/reset as head_ancestor', async () => {
    const { repoDir, commitA, commitB } = await createBaseRepo();
    try {
      runGit(repoDir, ['reset', '--hard', commitA]);
      const headAfterReset = runGit(repoDir, ['rev-parse', 'HEAD']);

      expect(headAfterReset).toBe(commitA);
      expect(getGitCommitRelation(repoDir, commitB, headAfterReset)).toBe('head_ancestor');
    } finally {
      await fs.rm(repoDir, { recursive: true, force: true });
    }
  });

  it('detects rebase replay as indexed_ancestor', async () => {
    const { repoDir, commitA, commitB } = await createBaseRepo();
    try {
      runGit(repoDir, ['checkout', '-B', 'feature', commitA]);
      const trackedFile = path.join(repoDir, 'feature.ts');
      await fs.writeFile(trackedFile, 'export const feature = true;\n', 'utf8');
      runGit(repoDir, ['add', '.']);
      runGit(repoDir, ['commit', '--no-gpg-sign', '-m', 'feature pre-rebase']);
      runGit(repoDir, ['rebase', 'main']);
      const featureRebasedHead = runGit(repoDir, ['rev-parse', 'HEAD']);

      expect(getGitCommitRelation(repoDir, commitB, featureRebasedHead)).toBe('indexed_ancestor');
    } finally {
      await fs.rm(repoDir, { recursive: true, force: true });
    }
  });
});
