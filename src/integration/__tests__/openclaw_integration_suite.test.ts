import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runOpenclawIntegrationSuite } from '../openclaw_integration_suite.js';

describe('OpenClaw integration suite', () => {
  it('evaluates six quantitative scenarios and reports machine-readable results', async () => {
    const fixtureRoot = path.join(process.cwd(), 'test', 'fixtures', 'openclaw');
    const result = await runOpenclawIntegrationSuite({
      workspaceRoot: process.cwd(),
      fixtureRoot,
    });

    expect(result.kind).toBe('OpenclawIntegrationSuite.v1');
    expect(result.summary.total).toBe(6);
    expect(result.scenarios).toHaveLength(6);
    expect(result.summary.failing).toBe(0);

    expect(result.scenarios.map((scenario) => scenario.id)).toEqual([
      'scenario_1_cold_start_context_efficiency',
      'scenario_2_memory_staleness_detection',
      'scenario_3_semantic_navigation_accuracy',
      'scenario_4_context_exhaustion_prevention',
      'scenario_5_malicious_skill_detection',
      'scenario_6_calibration_convergence',
    ]);

    const scenario5 = result.scenarios.find((scenario) => scenario.id === 'scenario_5_malicious_skill_detection');
    expect(scenario5?.passed).toBe(true);
    expect(scenario5?.measurements.maliciousDetected).toBeGreaterThanOrEqual(4);
    expect(scenario5?.measurements.cleanFalsePositives).toBe(0);
  });
});
