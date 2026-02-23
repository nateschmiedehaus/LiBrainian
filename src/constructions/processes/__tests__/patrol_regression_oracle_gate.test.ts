import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ConstructionOutcome } from '../../types.js';
import { ConstructionError } from '../../base/construction_base.js';
import { createPatrolRegressionOracleGateConstruction } from '../patrol_regression_oracle_gate.js';

function expectOkValue<T>(outcome: ConstructionOutcome<T, ConstructionError>): T {
  expect(outcome.ok).toBe(true);
  if (!outcome.ok) {
    throw outcome.error;
  }
  return outcome.value;
}

describe('Patrol Regression Oracle Gate', () => {
  it('auto-generates minimal regression tests and enforces pre-fix fail + current pass behavior', async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), 'patrol-regression-oracle-gate-'));
    try {
      const gate = createPatrolRegressionOracleGateConstruction();
      const result = expectOkValue(await gate.execute({
        outputDir,
        minGeneratedTests: 3,
        runGeneratedTests: true,
        testTimeoutMs: 60_000,
      }));

      expect(result.kind).toBe('PatrolRegressionOracleGateResult.v1');
      expect(result.generatedTestCount).toBeGreaterThanOrEqual(3);
      expect(result.passingGeneratedTestCount).toBe(result.generatedTestCount);
      expect(result.results.every((entry) => entry.minimal)).toBe(true);
      expect(result.results.every((entry) => entry.preFixFails)).toBe(true);
      expect(result.results.every((entry) => entry.generatedTestPasses)).toBe(true);
      expect(result.findings).toHaveLength(0);
      expect(result.pass).toBe(true);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  }, 300_000);
});
