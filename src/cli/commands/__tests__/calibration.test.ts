import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { calibrationCommand } from '../calibration.js';

const tempDirs: string[] = [];

async function createWorkspaceWithPatrolData(totalFeatures: number): Promise<string> {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'librainian-calibration-cli-'));
  tempDirs.push(workspace);
  const patrolDir = path.join(workspace, 'state', 'patrol');
  await fs.mkdir(patrolDir, { recursive: true });

  const features = Array.from({ length: totalFeatures }, (_, index) => ({
    feature: `feature-${index}`,
    intent: `intent-${index}`,
    outcome: index % 2 === 0 ? `Returned confidence 0.8 and succeeded` : 'confidence 0.8 and failed',
    quality: index % 2 === 0 ? 'excellent' : 'broken',
    wouldUseAgain: index % 2 === 0,
    notes: `notes-${index}`,
  }));

  const run = {
    kind: 'LiBrainianPatrolRun.v1',
    mode: 'quick',
    createdAt: '2026-02-21T04:00:00.000Z',
    commitSha: 'abcdef01',
    aggregate: {},
    runs: [
      {
        repo: 'repo-calibration',
        task: 'query',
        language: 'typescript',
        observations: {
          sessionSummary: 'Overall health confidence 75% vs 70% SLO.',
          featuresUsed: features,
          constructionsUsed: [
            {
              constructionId: 'librainian:test',
              outputQuality: 'good',
              confidenceReturned: 0.76,
              confidenceAccurate: true,
              useful: true,
            },
          ],
          negativeFindingsMandatory: Array.from({ length: 12 }, (_, index) => ({
            category: `category-${index}`,
            severity: index % 2 === 0 ? 'high' : 'medium',
            title: `title-${index}`,
            detail: `detail-${index}`,
            reproducible: index % 3 !== 0,
            suggestedFix: 'fix',
          })),
          positiveFindings: [
            { feature: 'status', detail: 'status stayed excellent.' },
          ],
        },
        implicitSignals: {
          usedGrepInstead: false,
          commandsFailed: 0,
        },
        timedOut: false,
        durationMs: 9_000,
        agentExitCode: 0,
        rawOutputTruncated: false,
      },
    ],
  };

  await fs.writeFile(
    path.join(patrolDir, 'patrol-run-2026-02-21T04-00-00-000Z.json'),
    JSON.stringify(run, null, 2),
    'utf8'
  );

  return workspace;
}

describe('calibrationCommand', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(async () => {
    logSpy.mockRestore();
    await Promise.all(tempDirs.splice(0, tempDirs.length).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  it('emits machine-readable calibration dashboard JSON', async () => {
    const workspace = await createWorkspaceWithPatrolData(45);

    await calibrationCommand({
      workspace,
      args: [],
      rawArgs: ['calibration', '--json'],
    });

    const payload = logSpy.mock.calls
      .map((call) => String(call[0]))
      .find((line) => line.includes('"LiBrainianPatrolCalibration.v1"'));

    expect(payload).toBeTruthy();
    const parsed = JSON.parse(payload!);
    expect(parsed.kind).toBe('LiBrainianPatrolCalibration.v1');
    expect(parsed.sampleCount).toBeGreaterThanOrEqual(50);
    expect(parsed.enoughSamples).toBe(true);
    expect(parsed.recommendations.length).toBeGreaterThan(0);
  });

  it('prints guidance when minimum sample target is not met', async () => {
    const workspace = await createWorkspaceWithPatrolData(8);

    await calibrationCommand({
      workspace,
      args: [],
      rawArgs: ['calibration', '--min-samples', '200'],
    });

    const output = logSpy.mock.calls.map((call) => String(call[0])).join('\n');
    expect(output).toContain('LiBrainian Patrol Calibration');
    expect(output).toContain('Needs more patrol calibration samples');
  });
});
