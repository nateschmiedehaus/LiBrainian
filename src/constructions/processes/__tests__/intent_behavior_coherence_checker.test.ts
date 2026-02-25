import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { unwrapConstructionExecutionResult } from '../../types.js';
import { createIntentBehaviorCoherenceCheckerConstruction } from '../intent_behavior_coherence_checker.js';

async function withTempWorkspace(fn: (workspaceRoot: string) => Promise<void>): Promise<void> {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'intent-behavior-coherence-'));
  try {
    await fn(workspaceRoot);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

async function writeWorkspaceFile(workspaceRoot: string, relativePath: string, content: string): Promise<void> {
  const absolutePath = path.join(workspaceRoot, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content, 'utf8');
}

describe('createIntentBehaviorCoherenceCheckerConstruction', () => {
  it('reports does_less_than_claimed when permission validator does weaker checks', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      await writeWorkspaceFile(
        workspaceRoot,
        'src/auth.ts',
        [
          '/**',
          ' * Verifies that a user has required permissions for the resource.',
          ' * Returns true only when access is authorized.',
          ' */',
          'export function validatePermissions(token: string, resource: string): boolean {',
          '  const tokenFresh = token.length > 10;',
          "  const allowlisted = resource === 'public';",
          '  return tokenFresh || allowlisted;',
          '}',
        ].join('\n'),
      );

      const construction = createIntentBehaviorCoherenceCheckerConstruction();
      const output = unwrapConstructionExecutionResult(
        await construction.execute({ workspaceRoot }),
      );

      const violation = output.violations.find((entry) => entry.functionName === 'validatePermissions');
      expect(violation).toBeDefined();
      expect(violation?.divergenceType).toBe('does_less_than_claimed');
      expect(violation?.divergenceScore ?? 0).toBeGreaterThan(0.4);
    });
  });

  it('does not flag functions whose intent matches behavior and avoids terse-doc false positives', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      await writeWorkspaceFile(
        workspaceRoot,
        'src/users.ts',
        [
          '/** Fetches user data and returns the fetched payload. */',
          'export async function fetchUserData(userId: string) {',
          '  return fetch(`/users/${userId}`);',
          '}',
          '',
          '/** Gets user. */',
          'export function getUser(userId: string): string {',
          '  return userId.trim();',
          '}',
        ].join('\n'),
      );

      const construction = createIntentBehaviorCoherenceCheckerConstruction();
      const output = unwrapConstructionExecutionResult(
        await construction.execute({ workspaceRoot }),
      );

      expect(output.violations.some((entry) => entry.functionName === 'fetchUserData')).toBe(false);
      expect(output.violations.some((entry) => entry.functionName === 'getUser')).toBe(false);
    });
  });

  it('always promotes auth-path does_less_than_claimed violations to critical', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      await writeWorkspaceFile(
        workspaceRoot,
        'src/auth.ts',
        [
          '/** Verifies user permissions for sensitive actions. */',
          'export function validatePermissions(token: string): boolean {',
          '  return token.length > 10;',
          '}',
          '',
          'export function authMiddleware(token: string): boolean {',
          '  return validatePermissions(token);',
          '}',
        ].join('\n'),
      );

      const construction = createIntentBehaviorCoherenceCheckerConstruction();
      const output = unwrapConstructionExecutionResult(
        await construction.execute({
          workspaceRoot,
          fromEntrypoints: ['src/auth.ts:authMiddleware'],
          divergenceThreshold: 0.95,
        }),
      );

      expect(
        output.criticalViolations.some((entry) => entry.functionName === 'validatePermissions'),
      ).toBe(true);
    });
  });

  it('populates suggestedDocstring for high-divergence violations', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      await writeWorkspaceFile(
        workspaceRoot,
        'src/sort.ts',
        [
          '/** Sorts users alphabetically. */',
          'export function sortUsers(users: string[]): number {',
          '  return users.length;',
          '}',
        ].join('\n'),
      );

      const construction = createIntentBehaviorCoherenceCheckerConstruction();
      const output = unwrapConstructionExecutionResult(
        await construction.execute({ workspaceRoot, divergenceThreshold: 0.1 }),
      );

      const highDivergence = output.violations.find((entry) => entry.divergenceScore > 0.5);
      expect(highDivergence).toBeDefined();
      expect(highDivergence?.suggestedDocstring).toBeDefined();
      expect((highDivergence?.suggestedDocstring ?? '').length).toBeGreaterThan(20);
    });
  });

  it('runs under 2 seconds for 1000 exported functions', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      const lines: string[] = [];
      for (let i = 0; i < 1000; i += 1) {
        lines.push(
          [
            '/** Returns the adjusted numeric value. */',
            `export function fn${i}(input: number): number {`,
            `  return input + ${i};`,
            '}',
          ].join('\n'),
        );
      }
      await writeWorkspaceFile(workspaceRoot, 'src/bulk.ts', lines.join('\n\n'));

      const construction = createIntentBehaviorCoherenceCheckerConstruction();
      const started = performance.now();
      const output = unwrapConstructionExecutionResult(
        await construction.execute({ workspaceRoot }),
      );
      const durationMs = performance.now() - started;

      expect(output.violations.length).toBeGreaterThanOrEqual(0);
      expect(durationMs).toBeLessThan(2000);
    });
  });
});
