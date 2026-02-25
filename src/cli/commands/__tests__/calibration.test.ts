import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../utils/evaluation_loader.js', () => ({
  loadEvaluationModule: vi.fn(),
}));

describe('calibrationCommand', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  const dashboard = {
    patrolDir: '/tmp/workspace/state/patrol',
    runCount: 2,
    sampleCount: 200,
    minimumSamples: 50,
    pointBreakdown: { explicit: 120, derived: 80 },
    expectedCalibrationError: 0.11,
    maximumCalibrationError: 0.23,
    overconfidenceRatio: 0.19,
    enoughSamples: true,
    buckets: [
      {
        range: [0.0, 0.1] as [number, number],
        sampleSize: 10,
        statedMean: 0.07,
        empiricalAccuracy: 0.1,
        calibrationError: 0.03,
      },
    ],
    perRun: [
      {
        createdAt: '2026-02-25T00:00:00.000Z',
        repo: 'repo-a',
        sampleCount: 100,
        expectedCalibrationError: 0.12,
        maximumCalibrationError: 0.24,
      },
    ],
    trend: {
      firstEce: 0.19,
      lastEce: 0.11,
      deltaEce: -0.08,
    },
    recommendations: ['Track high-confidence false positives.'],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('loads calibration module through evaluation loader and emits JSON output', async () => {
    const { loadEvaluationModule } = await import('../../../utils/evaluation_loader.js');
    vi.mocked(loadEvaluationModule).mockResolvedValue({
      evaluatePatrolCalibrationDirectory: vi.fn().mockResolvedValue(dashboard),
    });

    const { calibrationCommand } = await import('../calibration.js');
    await calibrationCommand({
      workspace: '/tmp/workspace',
      args: [],
      rawArgs: ['calibration', '--json'],
    });

    expect(loadEvaluationModule).toHaveBeenCalledWith(
      'librarian calibration',
      expect.any(Function),
      expect.any(Function),
    );

    const jsonLine = logSpy.mock.calls.map((call) => String(call[0])).find((line) => line.startsWith('{'));
    expect(jsonLine).toBeDefined();
    const parsed = JSON.parse(jsonLine ?? '{}') as { runCount?: number };
    expect(parsed.runCount).toBe(2);
  });

  it('prints text dashboard in non-json mode', async () => {
    const { loadEvaluationModule } = await import('../../../utils/evaluation_loader.js');
    vi.mocked(loadEvaluationModule).mockResolvedValue({
      evaluatePatrolCalibrationDirectory: vi.fn().mockResolvedValue(dashboard),
    });

    const { calibrationCommand } = await import('../calibration.js');
    await calibrationCommand({
      workspace: '/tmp/workspace',
      args: [],
      rawArgs: ['calibration'],
    });

    const output = logSpy.mock.calls.map((call) => String(call[0]));
    expect(output.some((line) => line.includes('LiBrainian Patrol Calibration'))).toBe(true);
    expect(output.some((line) => line.includes('Recommendations:'))).toBe(true);
    expect(output.some((line) => line.includes('Track high-confidence false positives.'))).toBe(true);
  });
});
