import { describe, expect, it } from 'vitest';
import { createPatrolRegressionClosureGateConstruction } from '../patrol_regression_closure_gate.js';
import { unwrapConstructionExecutionResult } from '../../types.js';

describe('Patrol Regression Closure Gate', () => {
  it('verifies at least five patrol findings remain covered by construction-level regression checks', async () => {
    const gate = createPatrolRegressionClosureGateConstruction();
    const result = unwrapConstructionExecutionResult(await gate.execute({
      commandTimeoutMs: 20_000,
      maxDurationMs: 240_000,
    }));

    expect(result.kind).toBe('PatrolRegressionClosureResult.v1');
    expect(result.checks.length).toBeGreaterThanOrEqual(5);
    expect(result.pass).toBe(true);
    expect(result.findings).toHaveLength(0);

    const issueNumbers = result.checks.map((check) => check.issueNumber);
    expect(issueNumbers.includes(587)).toBe(true);
    expect(issueNumbers.includes(593)).toBe(true);
    expect(issueNumbers.includes(598)).toBe(true);
    expect(result.checks.every((check) => check.pass)).toBe(true);
  }, 280_000);
});
