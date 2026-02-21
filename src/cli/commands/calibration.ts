import * as path from 'node:path';
import { parseArgs } from 'node:util';
import {
  evaluatePatrolCalibrationDirectory,
  type PatrolCalibrationDashboard,
} from '../../evaluation/patrol_calibration.js';

export interface CalibrationCommandOptions {
  workspace: string;
  args: string[];
  rawArgs: string[];
}

export async function calibrationCommand(options: CalibrationCommandOptions): Promise<void> {
  const { workspace, rawArgs } = options;
  const { values } = parseArgs({
    args: rawArgs.slice(1),
    options: {
      json: { type: 'boolean', default: false },
      'patrol-dir': { type: 'string' },
      'bucket-count': { type: 'string' },
      'min-samples': { type: 'string' },
    },
    allowPositionals: true,
    strict: false,
  });

  const workspacePath = path.resolve(workspace);
  const patrolDir = resolvePatrolDir(workspacePath, values['patrol-dir'] as string | undefined);
  const bucketCount = clampInteger(values['bucket-count'] as string | undefined, 10, 4, 20);
  const minimumSamples = clampInteger(values['min-samples'] as string | undefined, 50, 1, 10_000);
  const dashboard = await evaluatePatrolCalibrationDirectory(patrolDir, { bucketCount, minimumSamples });

  if (values.json) {
    console.log(JSON.stringify(dashboard, null, 2));
    return;
  }

  printDashboard(dashboard);
}

function resolvePatrolDir(workspacePath: string, requested: string | undefined): string {
  if (!requested) return path.join(workspacePath, 'state', 'patrol');
  if (path.isAbsolute(requested)) return requested;
  return path.join(workspacePath, requested);
}

function printDashboard(dashboard: PatrolCalibrationDashboard): void {
  console.log('LiBrainian Patrol Calibration');
  console.log('=============================\n');
  console.log(`Patrol artifacts: ${dashboard.patrolDir}`);
  console.log(`Runs analyzed: ${dashboard.runCount}`);
  console.log(`Calibration samples: ${dashboard.sampleCount} (minimum ${dashboard.minimumSamples})`);
  console.log(`Explicit confidence points: ${dashboard.pointBreakdown.explicit}`);
  console.log(`Derived confidence points: ${dashboard.pointBreakdown.derived}`);
  console.log(`ECE: ${dashboard.expectedCalibrationError.toFixed(4)}`);
  console.log(`MCE: ${dashboard.maximumCalibrationError.toFixed(4)}`);
  console.log(`Overconfidence ratio: ${(dashboard.overconfidenceRatio * 100).toFixed(1)}%`);
  if (!dashboard.enoughSamples) {
    console.log(`Needs more patrol calibration samples: ${dashboard.sampleCount}/${dashboard.minimumSamples}`);
  }

  const populatedBuckets = dashboard.buckets.filter((bucket) => bucket.sampleSize > 0);
  console.log('\nReliability buckets:');
  if (populatedBuckets.length === 0) {
    console.log('  - No populated buckets (no confidence samples found).');
  } else {
    for (const bucket of populatedBuckets) {
      const range = `[${bucket.range[0].toFixed(1)}, ${bucket.range[1].toFixed(1)}]`;
      console.log(
        `  - ${range}: n=${bucket.sampleSize}, stated=${bucket.statedMean.toFixed(3)}, actual=${bucket.empiricalAccuracy.toFixed(3)}, gap=${bucket.calibrationError.toFixed(3)}`
      );
    }
  }

  console.log('\nCalibration over time (per patrol run):');
  if (dashboard.perRun.length === 0) {
    console.log('  - No run-level calibration summaries available.');
  } else {
    for (const run of dashboard.perRun) {
      console.log(
        `  - ${run.createdAt} ${run.repo}: n=${run.sampleCount}, ECE=${run.expectedCalibrationError.toFixed(4)}, MCE=${run.maximumCalibrationError.toFixed(4)}`
      );
    }
  }

  if (dashboard.trend) {
    const direction = dashboard.trend.deltaEce <= 0 ? 'improved' : 'regressed';
    console.log(
      `\nTrend: ${direction} (${dashboard.trend.firstEce.toFixed(4)} -> ${dashboard.trend.lastEce.toFixed(4)}, delta ${dashboard.trend.deltaEce.toFixed(4)})`
    );
  }

  console.log('\nRecommendations:');
  for (const recommendation of dashboard.recommendations) {
    console.log(`  - ${recommendation}`);
  }
}

function clampInteger(value: string | undefined, fallback: number, min: number, max: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}
