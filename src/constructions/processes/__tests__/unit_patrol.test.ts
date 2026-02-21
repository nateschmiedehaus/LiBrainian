import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  UnitPatrolConstruction,
  createFixtureSmokeUnitPatrolConstruction,
  type UnitPatrolInput,
} from '../index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_REPO = path.resolve(__dirname, '../../../../test/fixtures/librarian_usecase');

describe('UnitPatrol', () => {
  it('executes fixture smoke scenario and returns structured UnitPatrolResult', async () => {
    const construction = createFixtureSmokeUnitPatrolConstruction();
    const startedAt = Date.now();

    const result = await construction.execute({
      fixtureRepoPath: FIXTURE_REPO,
      timeoutMs: 120_000,
      budget: { maxDurationMs: 120_000 },
      keepSandbox: false,
    });

    expect(result.kind).toBe('UnitPatrolResult.v1');
    expect(typeof result.pass).toBe('boolean');
    expect(result.passRate).toBeGreaterThanOrEqual(0);
    expect(result.passRate).toBeLessThanOrEqual(1);
    expect(Array.isArray(result.operations)).toBe(true);
    expect(result.operations.length).toBeGreaterThan(0);
    expect(result.operations.some((operation) => operation.operation === 'bootstrap')).toBe(true);
    expect(result.operations.some((operation) => operation.operation === 'query')).toBe(true);
    expect(Array.isArray(result.findings)).toBe(true);
    expect(result.embedding.realProviderExpected).toBe(true);
    expect(result.costSummary.durationMs).toBeLessThanOrEqual(120_000);
    expect(Date.now() - startedAt).toBeLessThan(120_000);
  }, 140_000);

  it('supports direct construction.execute() from vitest with custom UnitPatrol scenario', async () => {
    const construction = new UnitPatrolConstruction(
      'unit-patrol-custom',
      'Unit Patrol Custom',
      'Custom unit patrol scenario for test execution.',
      {
        name: 'unit-patrol-custom-scenario',
        operations: [{ kind: 'bootstrap' }, { kind: 'status' }],
      },
      {
        minPassRate: 1,
        requireBootstrapped: true,
        maxDurationMs: 120_000,
      },
    );

    const input: UnitPatrolInput = {
      fixtureRepoPath: FIXTURE_REPO,
      timeoutMs: 120_000,
      budget: { maxDurationMs: 120_000 },
      keepSandbox: false,
    };
    const result = await construction.execute(input);

    expect(result.scenario).toBe('unit-patrol-custom-scenario');
    expect(result.operations).toHaveLength(2);
    expect(result.operations.every((operation) => operation.operation !== 'query')).toBe(true);
    expect(result.pass).toBe(true);
    expect(result.findings.filter((finding) => finding.severity === 'error')).toHaveLength(0);
  }, 140_000);
});
