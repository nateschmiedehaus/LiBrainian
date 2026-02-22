import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createPatrolSwebenchGateConstruction } from '../patrol_swebench_gate.js';
import { unwrapConstructionExecutionResult } from '../../types.js';

describe('Patrol SWE-bench Gate', () => {
  it('generates and evaluates at least three FAIL_TO_PASS + PASS_TO_PASS pairs', async () => {
    const artifactRoot = await mkdtemp(path.join(tmpdir(), 'patrol-swebench-gate-'));
    try {
      const gate = createPatrolSwebenchGateConstruction();
      const result = unwrapConstructionExecutionResult(await gate.execute({
        minPairCount: 3,
        executeVerificationCommands: false,
        outputPath: path.join(artifactRoot, 'pairs.generated.json'),
      }));

      expect(result.kind).toBe('PatrolSwebenchGateResult.v1');
      expect(result.pairCount).toBeGreaterThanOrEqual(3);
      expect(result.resolveRate).toBeGreaterThan(0);
      expect(result.harness.kind).toBe('PatrolSwebenchHarnessResult.v1');
      expect(result.pairs.every((pair) => pair.passToPassTests.length > 0)).toBe(true);
      expect(result.pass).toBe(true);
      expect(result.findings).toHaveLength(0);
    } finally {
      await rm(artifactRoot, { recursive: true, force: true });
    }
  }, 120_000);
});
