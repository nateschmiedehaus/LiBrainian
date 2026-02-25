import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { unwrapConstructionExecutionResult } from '../../types.js';
import { createSlopPatternAuditorConstruction } from '../slop_pattern_auditor.js';

async function withTempDir(fn: (tmpDir: string) => Promise<void>): Promise<void> {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'slop-pattern-auditor-'));
  try {
    await fn(tmpDir);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

describe('createSlopPatternAuditorConstruction', () => {
  it('detects try/catch mismatch in a Result<T,E>-oriented codebase with empirical examples', async () => {
    await withTempDir(async (tmpDir) => {
      const srcDir = path.join(tmpDir, 'src');
      await mkdir(srcDir, { recursive: true });
      await writeFile(
        path.join(srcDir, 'billing.ts'),
        [
          'export function computeTotal(amount: number): Result<number, Error> {',
          '  if (amount < 0) return err(new Error("invalid"));',
          '  return ok(amount);',
          '}',
          'export function createInvoice(id: string): Result<string, Error> {',
          '  return ok(id);',
          '}',
        ].join('\n'),
        'utf8',
      );

      const construction = createSlopPatternAuditorConstruction();
      const output = unwrapConstructionExecutionResult(
        await construction.execute({
          workspaceRoot: tmpDir,
          filePath: 'src/generated.ts',
          code: [
            'export function runCycle() {',
            '  try {',
            '    return 1;',
            '  } catch (error) {',
            '    return undefined;',
            '  }',
            '}',
          ].join('\n'),
          checks: ['error_handling_mismatch'],
        }),
      );

      expect(output.violations.some((violation) => violation.violationType === 'error_handling_mismatch')).toBe(true);
      const mismatch = output.violations.find((violation) => violation.violationType === 'error_handling_mismatch');
      expect((mismatch?.conventionExamples.length ?? 0)).toBeGreaterThan(0);
      expect(mismatch?.codepbaseConvention).toContain('Result');
    });
  });

  it('detects retry wrapper abstraction mismatch when conventions favor HTTP-layer retries', async () => {
    await withTempDir(async (tmpDir) => {
      const srcDir = path.join(tmpDir, 'src/http');
      await mkdir(srcDir, { recursive: true });
      await writeFile(
        path.join(srcDir, 'client.ts'),
        [
          'export async function fetchWithRetry(url: string): Promise<string> {',
          '  const response = await httpClient(url, { retryPolicy: "standard" });',
          '  return response.body;',
          '}',
        ].join('\n'),
        'utf8',
      );

      const construction = createSlopPatternAuditorConstruction();
      const output = unwrapConstructionExecutionResult(
        await construction.execute({
          workspaceRoot: tmpDir,
          filePath: 'src/generated.ts',
          code: [
            'class RetryableOperation<T> {',
            '  run(task: () => Promise<T>): Promise<T> {',
            '    return withRetry(task);',
            '  }',
            '}',
          ].join('\n'),
          checks: ['abstraction_mismatch'],
        }),
      );

      expect(output.violations.some((violation) => violation.violationType === 'abstraction_mismatch')).toBe(true);
    });
  });

  it('scores high structural fit when generated code aligns with inferred conventions', async () => {
    await withTempDir(async (tmpDir) => {
      const srcDir = path.join(tmpDir, 'src');
      await mkdir(srcDir, { recursive: true });
      await writeFile(
        path.join(srcDir, 'conventions.ts'),
        [
          'export function mapOrder(id: string): Result<string, Error> {',
          '  return ok(id);',
          '}',
          'export function loadOrder(id: string): Result<string, Error> {',
          '  return ok(id);',
          '}',
        ].join('\n'),
        'utf8',
      );

      const construction = createSlopPatternAuditorConstruction();
      const output = unwrapConstructionExecutionResult(
        await construction.execute({
          workspaceRoot: tmpDir,
          filePath: 'src/generated.ts',
          code: [
            'export function saveOrder(orderId: string): Result<string, Error> {',
            '  return ok(orderId);',
            '}',
          ].join('\n'),
          checks: ['error_handling_mismatch', 'abstraction_mismatch', 'naming_convention_drift', 'comment_template_slop'],
        }),
      );

      expect(output.structuralFitScore).toBeGreaterThan(0.85);
    });
  });

  it('derives conventions empirically and shifts with the codebase pattern profile', async () => {
    await withTempDir(async (tmpDir) => {
      const resultRoot = path.join(tmpDir, 'result-style');
      const tryRoot = path.join(tmpDir, 'try-style');
      await mkdir(path.join(resultRoot, 'src'), { recursive: true });
      await mkdir(path.join(tryRoot, 'src'), { recursive: true });

      await writeFile(
        path.join(resultRoot, 'src', 'errors.ts'),
        [
          'export function one(): Result<number, Error> { return ok(1); }',
          'export function two(): Result<number, Error> { return ok(2); }',
        ].join('\n'),
        'utf8',
      );
      await writeFile(
        path.join(tryRoot, 'src', 'errors.ts'),
        [
          'export function one(): number { try { return 1; } catch { return 0; } }',
          'export function two(): number { try { return 2; } catch { return 0; } }',
        ].join('\n'),
        'utf8',
      );

      const construction = createSlopPatternAuditorConstruction();
      const resultProfile = unwrapConstructionExecutionResult(
        await construction.execute({
          workspaceRoot: resultRoot,
          filePath: 'src/generated.ts',
          code: 'export function noop() { return 1; }',
          checks: [],
        }),
      );
      const tryProfile = unwrapConstructionExecutionResult(
        await construction.execute({
          workspaceRoot: tryRoot,
          filePath: 'src/generated.ts',
          code: 'export function noop() { return 1; }',
          checks: [],
        }),
      );

      const resultConvention = resultProfile.inferredConventions.find((entry) => entry.pattern === 'error_handling');
      const tryConvention = tryProfile.inferredConventions.find((entry) => entry.pattern === 'error_handling');
      expect(resultConvention?.prevalence).toContain('preferred=result');
      expect(tryConvention?.prevalence).toContain('preferred=try-catch');
    });
  });

  it('runs in under 3 seconds for a 50-file workspace', async () => {
    await withTempDir(async (tmpDir) => {
      const srcDir = path.join(tmpDir, 'src');
      await mkdir(srcDir, { recursive: true });
      for (let i = 0; i < 50; i += 1) {
        await writeFile(
          path.join(srcDir, `module_${i}.ts`),
          `export function function${i}(value: number): Result<number, Error> { return ok(value + ${i}); }\n`,
          'utf8',
        );
      }

      const construction = createSlopPatternAuditorConstruction();
      const start = performance.now();
      const output = unwrapConstructionExecutionResult(
        await construction.execute({
          workspaceRoot: tmpDir,
          filePath: 'src/generated.ts',
          code: 'export function exampleName(value: number): Result<number, Error> { return ok(value); }',
          checks: ['error_handling_mismatch', 'naming_convention_drift'],
        }),
      );
      const durationMs = performance.now() - start;

      expect(output.violations).toHaveLength(0);
      expect(durationMs).toBeLessThan(3000);
    });
  });
});
