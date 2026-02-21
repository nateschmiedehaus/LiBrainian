import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { evaluatePatrolCalibrationDirectory } from '../patrol_calibration.js';

const tempDirs: string[] = [];

interface PatrolFeatureInput {
  quality: 'excellent' | 'good' | 'poor' | 'broken';
  wouldUseAgain: boolean;
  outcomeText?: string;
}

function createFeature(index: number, input: PatrolFeatureInput): Record<string, unknown> {
  return {
    feature: `feature-${index}`,
    intent: `intent-${index}`,
    outcome: input.outcomeText ?? `feature-${index} executed`,
    quality: input.quality,
    wouldUseAgain: input.wouldUseAgain,
    notes: `notes-${index}`,
  };
}

async function writeRunFile(
  patrolDir: string,
  fileName: string,
  createdAt: string,
  repo: string,
  features: PatrolFeatureInput[],
  negatives: Array<{ severity: 'critical' | 'high' | 'medium' | 'low'; reproducible: boolean }>
): Promise<void> {
  const payload = {
    kind: 'LiBrainianPatrolRun.v1',
    mode: 'quick',
    createdAt,
    commitSha: 'deadbeef',
    aggregate: {},
    runs: [
      {
        repo,
        task: 'diagnose',
        language: 'typescript',
        observations: {
          sessionSummary: 'System health confidence at 72% vs 70% SLO.',
          featuresUsed: features.map((feature, index) => createFeature(index, feature)),
          constructionsUsed: [
            {
              constructionId: 'librainian:feature-location-advisor',
              outputQuality: 'good',
              confidenceReturned: 0.78,
              confidenceAccurate: true,
              useful: true,
            },
            {
              constructionId: 'librainian:security-audit-helper',
              outputQuality: 'broken',
              confidenceReturned: 0.84,
              confidenceAccurate: false,
              useful: false,
            },
          ],
          negativeFindingsMandatory: negatives.map((finding, index) => ({
            category: `category-${index}`,
            severity: finding.severity,
            title: `title-${index}`,
            detail: `detail-${index}`,
            reproducible: finding.reproducible,
            suggestedFix: `fix-${index}`,
          })),
          positiveFindings: [
            { feature: 'inspect', detail: 'Inspect output was excellent and useful.' },
            { feature: 'status', detail: 'Status output stayed good and actionable.' },
          ],
        },
        implicitSignals: {
          usedGrepInstead: false,
          commandsFailed: 0,
        },
        timedOut: false,
        durationMs: 15_000,
        agentExitCode: 0,
        rawOutputTruncated: false,
      },
    ],
  };

  await fs.writeFile(path.join(patrolDir, fileName), JSON.stringify(payload, null, 2), 'utf8');
}

async function createPatrolDir(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'patrol-calibration-'));
  tempDirs.push(root);
  const patrolDir = path.join(root, 'state', 'patrol');
  await fs.mkdir(patrolDir, { recursive: true });
  return patrolDir;
}

describe('patrol_calibration', () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0, tempDirs.length).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  it('builds a dashboard with at least 50 points from patrol artifacts', async () => {
    const patrolDir = await createPatrolDir();

    await writeRunFile(
      patrolDir,
      'patrol-run-2026-02-21T01-00-00-000Z.json',
      '2026-02-21T01:00:00.000Z',
      'repo-a',
      Array.from({ length: 18 }, (_, index) => ({
        quality: index % 4 === 0 ? 'broken' : (index % 3 === 0 ? 'poor' : 'good'),
        wouldUseAgain: index % 4 !== 0,
        outcomeText: index === 0 ? 'Returned confidence 0.34 and then timed out.' : undefined,
      })),
      Array.from({ length: 12 }, (_, index) => ({
        severity: index % 2 === 0 ? 'critical' : 'high',
        reproducible: true,
      }))
    );

    await writeRunFile(
      patrolDir,
      'patrol-run-2026-02-21T02-00-00-000Z.json',
      '2026-02-21T02:00:00.000Z',
      'repo-b',
      Array.from({ length: 16 }, (_, index) => ({
        quality: index % 5 === 0 ? 'excellent' : 'good',
        wouldUseAgain: true,
        outcomeText: index === 1 ? 'Health confidence at 81% exceeded the 70% SLO.' : undefined,
      })),
      Array.from({ length: 10 }, (_, index) => ({
        severity: index % 2 === 0 ? 'medium' : 'low',
        reproducible: index % 3 !== 0,
      }))
    );

    const dashboard = await evaluatePatrolCalibrationDirectory(patrolDir, {
      bucketCount: 10,
      minimumSamples: 50,
    });

    expect(dashboard.kind).toBe('LiBrainianPatrolCalibration.v1');
    expect(dashboard.sampleCount).toBeGreaterThanOrEqual(50);
    expect(dashboard.enoughSamples).toBe(true);
    expect(dashboard.expectedCalibrationError).toBeGreaterThanOrEqual(0);
    expect(dashboard.expectedCalibrationError).toBeLessThanOrEqual(1);
    expect(dashboard.perRun.length).toBe(2);
    expect(dashboard.perRun[0].createdAt <= dashboard.perRun[1].createdAt).toBe(true);
  });

  it('reports trend over time from oldest to newest patrol run', async () => {
    const patrolDir = await createPatrolDir();

    await writeRunFile(
      patrolDir,
      'patrol-run-2026-02-21T01-00-00-000Z.json',
      '2026-02-21T01:00:00.000Z',
      'repo-old',
      Array.from({ length: 12 }, () => ({
        quality: 'broken' as const,
        wouldUseAgain: false,
        outcomeText: 'confidence 0.92 but execution failed',
      })),
      Array.from({ length: 12 }, () => ({
        severity: 'critical' as const,
        reproducible: false,
      }))
    );

    await writeRunFile(
      patrolDir,
      'patrol-run-2026-02-21T03-00-00-000Z.json',
      '2026-02-21T03:00:00.000Z',
      'repo-new',
      Array.from({ length: 12 }, () => ({
        quality: 'excellent' as const,
        wouldUseAgain: true,
        outcomeText: 'confidence 0.88 and command succeeded',
      })),
      Array.from({ length: 12 }, () => ({
        severity: 'low' as const,
        reproducible: true,
      }))
    );

    const dashboard = await evaluatePatrolCalibrationDirectory(patrolDir, {
      bucketCount: 8,
      minimumSamples: 20,
    });

    expect(dashboard.perRun.length).toBe(2);
    expect(dashboard.trend).not.toBeNull();
    expect(dashboard.trend?.firstEce).toBeGreaterThanOrEqual(0);
    expect(dashboard.trend?.lastEce).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(dashboard.trend?.deltaEce)).toBe(true);
  });
});
