import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { unwrapConstructionExecutionResult } from '../../types.js';
import { createDiffSemanticSummarizerConstruction } from '../diff_semantic_summarizer.js';

const execFileAsync = promisify(execFile);

async function withTempGitRepo(fn: (repoDir: string) => Promise<void>): Promise<void> {
  const repoDir = await mkdtemp(path.join(os.tmpdir(), 'diff-semantic-summarizer-'));
  try {
    await runGit(repoDir, ['init']);
    await runGit(repoDir, ['config', 'user.name', 'LiBrainian Test']);
    await runGit(repoDir, ['config', 'user.email', 'test@example.com']);
    await fn(repoDir);
  } finally {
    await rm(repoDir, { recursive: true, force: true });
  }
}

async function runGit(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    maxBuffer: 16 * 1024 * 1024,
  });
  return String(stdout).trim();
}

async function writeRepoFile(repoDir: string, relativePath: string, content: string): Promise<void> {
  const absolutePath = path.join(repoDir, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content, 'utf8');
}

async function commitAll(repoDir: string, message: string): Promise<string> {
  await runGit(repoDir, ['add', '.']);
  await runGit(repoDir, ['commit', '-m', message, '--no-gpg-sign']);
  return runGit(repoDir, ['rev-parse', 'HEAD']);
}

describe('createDiffSemanticSummarizerConstruction', () => {
  it('reports renamed when behavior/contract are preserved', async () => {
    await withTempGitRepo(async (repoDir) => {
      await writeRepoFile(
        repoDir,
        'src/payments.ts',
        [
          'export function submitPayment(total: number): number {',
          '  return Math.round(total * 100) / 100;',
          '}',
        ].join('\n'),
      );
      const baseSha = await commitAll(repoDir, 'base');

      await writeRepoFile(
        repoDir,
        'src/payments.ts',
        [
          'export function submitPaymentWithRetry(total: number): number {',
          '  return Math.round(total * 100) / 100;',
          '}',
        ].join('\n'),
      );
      const headSha = await commitAll(repoDir, 'rename');

      const construction = createDiffSemanticSummarizerConstruction();
      const output = unwrapConstructionExecutionResult(
        await construction.execute({
          baseSha,
          headSha,
          workspaceRoot: repoDir,
        }),
      );

      const renamed = output.deltas.find((delta) => delta.changeKind === 'renamed');
      expect(renamed).toBeDefined();
      expect(renamed?.contractChanges.weakenedPostconditions).toHaveLength(0);
      expect(renamed?.contractChanges.newPreconditions).toHaveLength(0);
      expect(renamed?.contractChanges.removedGuarantees).toHaveLength(0);
      expect(output.agentBriefing.split(/\s+/).length).toBeLessThan(2000);
    });
  });

  it('reports weakened return-null contract as high risk and includes blast radius callers', async () => {
    await withTempGitRepo(async (repoDir) => {
      await writeRepoFile(
        repoDir,
        'src/user.ts',
        [
          'export function getLabel(user?: string): string {',
          "  if (!user) return 'anonymous';",
          '  return user;',
          '}',
          '',
          'export function callerOne(user?: string): string {',
          '  return getLabel(user);',
          '}',
          '',
          'export function callerTwo(user?: string): string {',
          '  return callerOne(user);',
          '}',
        ].join('\n'),
      );
      const baseSha = await commitAll(repoDir, 'base');

      await writeRepoFile(
        repoDir,
        'src/user.ts',
        [
          'export function getLabel(user?: string): string | null {',
          '  if (!user) return null;',
          '  return user;',
          '}',
          '',
          'export function callerOne(user?: string): string | null {',
          '  return getLabel(user);',
          '}',
          '',
          'export function callerTwo(user?: string): string | null {',
          '  return callerOne(user);',
          '}',
        ].join('\n'),
      );
      const headSha = await commitAll(repoDir, 'weaken contract');

      const construction = createDiffSemanticSummarizerConstruction();
      const output = unwrapConstructionExecutionResult(
        await construction.execute({
          baseSha,
          headSha,
          workspaceRoot: repoDir,
        }),
      );

      const modified = output.deltas.find((delta) => delta.name === 'getLabel');
      expect(modified).toBeDefined();
      expect(modified?.contractChanges.weakenedPostconditions).toContain('return value is never null');
      expect(modified?.riskLevel).toBe('high');
      expect(output.blastRadius.directCallers).toBeGreaterThanOrEqual(1);
      expect(output.blastRadius.transitiveCallers).toBeGreaterThanOrEqual(1);
    });
  });

  it('reports extracted helper and validates extraction faithfulness', async () => {
    await withTempGitRepo(async (repoDir) => {
      await writeRepoFile(
        repoDir,
        'src/order.ts',
        [
          'export function createOrder(items: number[]): number {',
          '  const subtotal = items.reduce((sum, item) => sum + item, 0);',
          '  const taxed = subtotal * 1.1;',
          '  return Math.round(taxed);',
          '}',
        ].join('\n'),
      );
      const baseSha = await commitAll(repoDir, 'base');

      await writeRepoFile(
        repoDir,
        'src/order.ts',
        [
          'function calculateSubtotal(items: number[]): number {',
          '  return items.reduce((sum, item) => sum + item, 0);',
          '}',
          '',
          'export function createOrder(items: number[]): number {',
          '  const subtotal = calculateSubtotal(items);',
          '  const taxed = subtotal * 1.1;',
          '  return Math.round(taxed);',
          '}',
        ].join('\n'),
      );
      const headSha = await commitAll(repoDir, 'extract helper');

      const construction = createDiffSemanticSummarizerConstruction();
      const output = unwrapConstructionExecutionResult(
        await construction.execute({
          baseSha,
          headSha,
          workspaceRoot: repoDir,
        }),
      );

      const extracted = output.deltas.find((delta) => delta.changeKind === 'extracted');
      expect(extracted).toBeDefined();
      expect(extracted?.behaviorAfter ?? '').toMatch(/faithful=(yes|no)/i);
      expect(output.reviewerSummary).toMatch(/faithfulness/i);
    });
  });

  it('runs under 5 seconds for diffs touching fewer than 20 functions', async () => {
    await withTempGitRepo(async (repoDir) => {
      const functionsBefore: string[] = [];
      for (let i = 0; i < 12; i += 1) {
        functionsBefore.push(
          [
            `export function fn${i}(input: number): number {`,
            `  return input + ${i};`,
            '}',
          ].join('\n'),
        );
      }

      await writeRepoFile(repoDir, 'src/math.ts', functionsBefore.join('\n\n'));
      const baseSha = await commitAll(repoDir, 'base');

      const functionsAfter = [...functionsBefore];
      functionsAfter[5] = [
        'export function fn5(input: number): number | null {',
        '  if (input < 0) return null;',
        '  return input + 5;',
        '}',
      ].join('\n');
      await writeRepoFile(repoDir, 'src/math.ts', functionsAfter.join('\n\n'));
      const headSha = await commitAll(repoDir, 'modify one function');

      const construction = createDiffSemanticSummarizerConstruction();
      const started = performance.now();
      const output = unwrapConstructionExecutionResult(
        await construction.execute({
          baseSha,
          headSha,
          workspaceRoot: repoDir,
        }),
      );
      const durationMs = performance.now() - started;

      expect(output.deltas.length).toBeGreaterThan(0);
      expect(durationMs).toBeLessThan(5000);
      expect(output.agentBriefing.split(/\s+/).length).toBeLessThan(2000);
    });
  });
});
