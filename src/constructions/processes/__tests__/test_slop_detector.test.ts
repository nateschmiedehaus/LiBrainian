import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { unwrapConstructionExecutionResult } from '../../types.js';
import { createTestSlopDetectorConstruction } from '../test_slop_detector.js';

async function withTempDir(fn: (tmpDir: string) => Promise<void>): Promise<void> {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'test-slop-detector-'));
  try {
    await fn(tmpDir);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

describe('createTestSlopDetectorConstruction', () => {
  it('reports tautological assertions as critical violations', async () => {
    await withTempDir(async (tmpDir) => {
      const srcDir = path.join(tmpDir, 'src');
      const testDir = path.join(tmpDir, 'tests');
      await mkdir(srcDir, { recursive: true });
      await mkdir(testDir, { recursive: true });

      await writeFile(
        path.join(srcDir, 'order.ts'),
        [
          'export function processOrder(total: number) {',
          '  return { total };',
          '}',
        ].join('\n'),
        'utf8',
      );

      await writeFile(
        path.join(testDir, 'order.test.ts'),
        [
          "import { processOrder } from '../src/order';",
          "it('has tautology', () => {",
          '  const result = processOrder(100);',
          '  expect(result.total).toBe(result.total);',
          '});',
        ].join('\n'),
        'utf8',
      );

      const construction = createTestSlopDetectorConstruction();
      const output = unwrapConstructionExecutionResult(
        await construction.execute({
          testPaths: [testDir],
          sourcePaths: [srcDir],
          checks: ['tautological_assertions'],
        }),
      );

      const match = output.violations.find((v) => v.violationType === 'tautological_assertions');
      expect(match).toBeDefined();
      expect(match?.severity).toBe('critical');
    });
  });

  it('reports mock passthrough and includes undetected discount condition', async () => {
    await withTempDir(async (tmpDir) => {
      const srcDir = path.join(tmpDir, 'src');
      const testDir = path.join(tmpDir, 'tests');
      await mkdir(srcDir, { recursive: true });
      await mkdir(testDir, { recursive: true });

      await writeFile(
        path.join(srcDir, 'discounts.ts'),
        [
          'export function calculateDiscount(): number {',
          '  return 0;',
          '}',
        ].join('\n'),
        'utf8',
      );

      await writeFile(
        path.join(srcDir, 'order.ts'),
        [
          "import { calculateDiscount } from './discounts';",
          '',
          'export function processOrder(total: number) {',
          '  const discount = calculateDiscount();',
          '  return { discount, total: total - discount };',
          '}',
        ].join('\n'),
        'utf8',
      );

      await writeFile(
        path.join(testDir, 'order.test.ts'),
        [
          "import * as discounts from '../src/discounts';",
          "import { processOrder } from '../src/order';",
          '',
          "it('checks discount but not transformed output', () => {",
          "  vi.spyOn(discounts, 'calculateDiscount').mockReturnValue(15);",
          '  const result = processOrder(100);',
          '  expect(result.discount).toBe(15);',
          '});',
        ].join('\n'),
        'utf8',
      );

      const construction = createTestSlopDetectorConstruction();
      const output = unwrapConstructionExecutionResult(
        await construction.execute({
          testPaths: [testDir],
          sourcePaths: [srcDir],
          checks: ['mock_passthrough'],
        }),
      );

      const match = output.violations.find((v) => v.violationType === 'mock_passthrough');
      expect(match).toBeDefined();
      expect(match?.undetectedConditions).toContain('discount code not applied to total');
    });
  });

  it('reports undefined_behavior when async work is not awaited', async () => {
    await withTempDir(async (tmpDir) => {
      const srcDir = path.join(tmpDir, 'src');
      const testDir = path.join(tmpDir, 'tests');
      await mkdir(srcDir, { recursive: true });
      await mkdir(testDir, { recursive: true });

      await writeFile(
        path.join(srcDir, 'order.ts'),
        [
          'export async function processOrderAsync(): Promise<number> {',
          '  return 42;',
          '}',
        ].join('\n'),
        'utf8',
      );

      await writeFile(
        path.join(testDir, 'order.test.ts'),
        [
          "import { processOrderAsync } from '../src/order';",
          "it('does not await async work', () => {",
          '  processOrderAsync();',
          '  expect(1 + 1).toBe(2);',
          '});',
        ].join('\n'),
        'utf8',
      );

      const construction = createTestSlopDetectorConstruction();
      const output = unwrapConstructionExecutionResult(
        await construction.execute({
          testPaths: [testDir],
          sourcePaths: [srcDir],
          checks: ['undefined_behavior'],
        }),
      );

      expect(output.violations.some((v) => v.violationType === 'undefined_behavior')).toBe(true);
    });
  });

  it('reports no violations for meaningful transformed-output assertions', async () => {
    await withTempDir(async (tmpDir) => {
      const srcDir = path.join(tmpDir, 'src');
      const testDir = path.join(tmpDir, 'tests');
      await mkdir(srcDir, { recursive: true });
      await mkdir(testDir, { recursive: true });

      await writeFile(
        path.join(srcDir, 'math.ts'),
        [
          'export function applyDiscount(total: number, discount: number): number {',
          '  return total - discount;',
          '}',
        ].join('\n'),
        'utf8',
      );

      await writeFile(
        path.join(testDir, 'math.test.ts'),
        [
          "import { applyDiscount } from '../src/math';",
          "it('applies discount to total', () => {",
          '  const result = applyDiscount(100, 15);',
          '  expect(result).toBe(85);',
          '});',
        ].join('\n'),
        'utf8',
      );

      const construction = createTestSlopDetectorConstruction();
      const output = unwrapConstructionExecutionResult(
        await construction.execute({
          testPaths: [testDir],
          sourcePaths: [srcDir],
        }),
      );

      expect(output.violations).toHaveLength(0);
    });
  });

  it('marks functions as effectively untested when all covering tests are slop', async () => {
    await withTempDir(async (tmpDir) => {
      const srcDir = path.join(tmpDir, 'src');
      const testDir = path.join(tmpDir, 'tests');
      await mkdir(srcDir, { recursive: true });
      await mkdir(testDir, { recursive: true });

      await writeFile(
        path.join(srcDir, 'logic.ts'),
        [
          'export function processOrder(total: number): number {',
          '  return total;',
          '}',
          '',
          'export function computeTax(total: number): number {',
          '  return total * 0.1;',
          '}',
        ].join('\n'),
        'utf8',
      );

      await writeFile(
        path.join(testDir, 'logic.test.ts'),
        [
          "import { processOrder, computeTax } from '../src/logic';",
          '',
          "it('sloppy processOrder test', () => {",
          '  const result = processOrder(100);',
          '  expect(result).toBe(result);',
          '});',
          '',
          "it('meaningful computeTax test', () => {",
          '  const result = computeTax(200);',
          '  expect(result).toBe(20);',
          '});',
        ].join('\n'),
        'utf8',
      );

      const construction = createTestSlopDetectorConstruction();
      const output = unwrapConstructionExecutionResult(
        await construction.execute({
          testPaths: [testDir],
          sourcePaths: [srcDir],
          checks: ['tautological_assertions'],
        }),
      );

      expect(output.effectivelyUntested.some((id) => id.includes(':processOrder'))).toBe(true);
      expect(output.effectivelyUntested.some((id) => id.includes(':computeTax'))).toBe(false);
    });
  });

  it('completes under 3 seconds for 50 test files', async () => {
    await withTempDir(async (tmpDir) => {
      const srcDir = path.join(tmpDir, 'src');
      const testDir = path.join(tmpDir, 'tests');
      await mkdir(srcDir, { recursive: true });
      await mkdir(testDir, { recursive: true });

      await writeFile(
        path.join(srcDir, 'value.ts'),
        [
          'export function makeValue(input: number): number {',
          '  return input + 1;',
          '}',
        ].join('\n'),
        'utf8',
      );

      const testTemplate = [
        "import { makeValue } from '../src/value';",
        "it('meaningful assertion', () => {",
        '  const result = makeValue(41);',
        '  expect(result).toBe(42);',
        '});',
      ].join('\n');

      for (let i = 0; i < 50; i += 1) {
        await writeFile(path.join(testDir, `value-${i}.test.ts`), testTemplate, 'utf8');
      }

      const construction = createTestSlopDetectorConstruction();
      const started = performance.now();
      const output = unwrapConstructionExecutionResult(
        await construction.execute({
          testPaths: [testDir],
          sourcePaths: [srcDir],
        }),
      );
      const durationMs = performance.now() - started;

      expect(output.violations).toHaveLength(0);
      expect(durationMs).toBeLessThan(3000);
    });
  });
});
