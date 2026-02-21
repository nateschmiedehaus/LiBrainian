import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  evaluatePatrolRegressionOracle,
  materializePatrolRegressionOracleTests,
} from '../patrol_regression_oracle.js';

describe('patrol_regression_oracle', () => {
  it('materializes at least three minimal vitest regression tests from patrol findings', async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), 'patrol-regression-oracle-tests-'));
    try {
      const artifact = await materializePatrolRegressionOracleTests({
        outputDir,
      });

      expect(artifact.schema).toBe('PatrolRegressionOracle.v1');
      expect(artifact.testCount).toBeGreaterThanOrEqual(3);
      expect(artifact.tests).toHaveLength(artifact.testCount);
      expect(artifact.tests.every((test) => test.generatedTestPath.endsWith('.test.ts'))).toBe(true);

      for (const test of artifact.tests) {
        await access(test.generatedTestPath);
        const content = await readFile(test.generatedTestPath, 'utf8');
        expect(content.includes('describe(')).toBe(true);
        expect(content.includes('it(')).toBe(true);
      }
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  }, 120_000);

  it('verifies generated tests are minimal, fail pre-fix, and pass on current code', async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), 'patrol-regression-oracle-eval-'));
    try {
      const result = await evaluatePatrolRegressionOracle({
        outputDir,
        runGeneratedTests: true,
        testTimeoutMs: 60_000,
      });

      expect(result.kind).toBe('PatrolRegressionOracleEvaluation.v1');
      expect(result.testCount).toBeGreaterThanOrEqual(3);
      expect(result.passCount).toBe(result.testCount);
      expect(result.pass).toBe(true);
      expect(result.results.every((entry) => entry.minimal)).toBe(true);
      expect(result.results.every((entry) => entry.preFixFails)).toBe(true);
      expect(result.results.every((entry) => entry.generatedTestPasses)).toBe(true);
      expect(result.findings).toHaveLength(0);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  }, 240_000);
});
