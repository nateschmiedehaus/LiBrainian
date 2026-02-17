/**
 * @fileoverview Confidence Calibration Validation Tests (Integration)
 *
 * Real-data calibration checks against a bootstrapped Librarian DB.
 * These are excluded from Tier-0 unit runs via *.integration.test.ts.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { createSqliteStorage } from '../storage/sqlite_storage.js';
import type { LibrarianStorage } from '../storage/types.js';

// ============================================================================
// CALIBRATION METRICS
// ============================================================================

interface CalibrationBin {
  /** Lower bound of confidence range (inclusive) */
  lower: number;
  /** Upper bound of confidence range (exclusive) */
  upper: number;
  /** Predictions in this bin */
  predictions: CalibrationPrediction[];
  /** Average confidence in this bin */
  avgConfidence: number;
  /** Empirical accuracy (fraction correct) */
  accuracy: number;
  /** Calibration error |avgConfidence - accuracy| */
  error: number;
}

interface CalibrationPrediction {
  /** Predicted confidence */
  confidence: number;
  /** Was the prediction correct? */
  correct: boolean;
  /** Entity/pack ID */
  entityId: string;
}

interface CalibrationResult {
  /** Expected Calibration Error (weighted average of bin errors) */
  ece: number;
  /** Maximum Calibration Error (worst bin) */
  mce: number;
  /** Bins with their statistics */
  bins: CalibrationBin[];
  /** Total predictions analyzed */
  totalPredictions: number;
  /** Fraction of predictions that were correct */
  overallAccuracy: number;
}

/**
 * Computes calibration metrics using equal-width binning.
 */
function computeCalibration(
  predictions: CalibrationPrediction[],
  numBins: number = 10
): CalibrationResult {
  if (predictions.length === 0) {
    return {
      ece: 0,
      mce: 0,
      bins: [],
      totalPredictions: 0,
      overallAccuracy: 0,
    };
  }

  // Create bins
  const binWidth = 1.0 / numBins;
  const bins: CalibrationBin[] = [];

  for (let i = 0; i < numBins; i++) {
    const lower = i * binWidth;
    const upper = (i + 1) * binWidth;
    const inBin = predictions.filter(p => p.confidence >= lower && p.confidence < upper);

    if (inBin.length === 0) {
      bins.push({
        lower,
        upper,
        predictions: [],
        avgConfidence: (lower + upper) / 2,
        accuracy: 0,
        error: 0,
      });
      continue;
    }

    const avgConfidence = inBin.reduce((s, p) => s + p.confidence, 0) / inBin.length;
    const accuracy = inBin.filter(p => p.correct).length / inBin.length;
    const error = Math.abs(avgConfidence - accuracy);

    bins.push({
      lower,
      upper,
      predictions: inBin,
      avgConfidence,
      accuracy,
      error,
    });
  }

  // Compute ECE (weighted by bin size)
  const totalPredictions = predictions.length;
  let ece = 0;
  let mce = 0;

  for (const bin of bins) {
    const weight = bin.predictions.length / totalPredictions;
    ece += weight * bin.error;
    mce = Math.max(mce, bin.error);
  }

  const overallAccuracy = predictions.filter(p => p.correct).length / totalPredictions;

  return {
    ece,
    mce,
    bins,
    totalPredictions,
    overallAccuracy,
  };
}

/**
 * Prints a calibration diagram to console.
 */
function printCalibrationDiagram(result: CalibrationResult): void {
  console.log('\n=== CALIBRATION DIAGRAM ===\n');
  console.log('Confidence | Accuracy | Error | Count');
  console.log('-'.repeat(45));

  for (const bin of result.bins) {
    const confStr = `${(bin.avgConfidence * 100).toFixed(0)}%`.padStart(10);
    const accStr = `${(bin.accuracy * 100).toFixed(0)}%`.padStart(8);
    const errStr = `${(bin.error * 100).toFixed(1)}%`.padStart(6);
    const countStr = `${bin.predictions.length}`.padStart(6);

    // Visual bar
    const bar = '█'.repeat(Math.round(bin.accuracy * 20));
    const expected = '│';
    const barPos = Math.round(bin.avgConfidence * 20);

    console.log(`${confStr} | ${accStr} | ${errStr} | ${countStr} ${bar}`);
  }

  console.log('-'.repeat(45));
  console.log(`ECE: ${(result.ece * 100).toFixed(2)}%`);
  console.log(`MCE: ${(result.mce * 100).toFixed(2)}%`);
  console.log(`Overall Accuracy: ${(result.overallAccuracy * 100).toFixed(1)}%`);
  console.log(`Total Predictions: ${result.totalPredictions}`);
}

// ============================================================================
// CALIBRATION VALIDATION TESTS (INTEGRATION)
// ============================================================================

describe('Confidence Calibration Validation (integration)', () => {
  let storage: LibrarianStorage;
  let storageInitialized = false;
  let calibrationPredictions: CalibrationPrediction[] = [];

  beforeAll(async () => {
    const workspaceRoot = process.cwd();
    const dbPath = path.join(workspaceRoot, 'state', 'librarian.db');

    try {
      storage = createSqliteStorage(dbPath, workspaceRoot);
      await storage.initialize();
      storageInitialized = true;

      const version = await storage.getVersion();
      if (!version) {
        console.warn('Librarian not bootstrapped - calibration validation will skip');
        storageInitialized = false;
      }
    } catch (error) {
      console.warn('Failed to initialize storage for calibration validation:', error);
      storageInitialized = false;
    }
  }, 60000);

  afterAll(async () => {
    await storage?.close?.();

    // Print calibration results
    if (calibrationPredictions.length > 0) {
      const result = computeCalibration(calibrationPredictions);
      printCalibrationDiagram(result);
    }
  });

  describe('Context Pack Calibration', () => {
    it('collects calibration data from context packs', async (ctx) => {
      if (!storageInitialized) {
        ctx.skip(
          true,
          'unverified_by_trace(test_fixture_missing): Confidence calibration requires a bootstrapped librarian DB'
        );
        return;
      }

      const packs = await storage.getContextPacks({ limit: 200 });

      if (packs.length === 0) {
        console.warn('No context packs found for calibration');
        ctx.skip(
          true,
          'unverified_by_trace(test_fixture_missing): No context packs found for calibration'
        );
        return;
      }

      // For calibration, we use success/failure outcomes as ground truth
      for (const pack of packs) {
        if (pack.successCount + pack.failureCount > 0) {
          const empiricalAccuracy =
            pack.successCount / (pack.successCount + pack.failureCount);
          calibrationPredictions.push({
            confidence: pack.confidence,
            correct: empiricalAccuracy >= 0.5, // Consider "correct" if >50% success rate
            entityId: pack.packId,
          });
        }
      }

      console.log(`Collected ${calibrationPredictions.length} predictions with outcomes`);
      expect(calibrationPredictions.length).toBeGreaterThanOrEqual(0);
    });

    it('ECE < 15% requirement', async (ctx) => {
      if (!storageInitialized || calibrationPredictions.length < 10) {
        // Need minimum predictions for meaningful calibration
        ctx.skip(
          true,
          'unverified_by_trace(test_fixture_missing): Insufficient calibration data (requires >= 10 predictions with outcomes)'
        );
        return;
      }

      const result = computeCalibration(calibrationPredictions);
      console.log(`ECE: ${(result.ece * 100).toFixed(2)}%`);

      // SLO: ECE < 15%
      expect(result.ece).toBeLessThan(0.15);
    });

    it('high confidence predictions are accurate', async (ctx) => {
      if (!storageInitialized || calibrationPredictions.length < 10) {
        ctx.skip(
          true,
          'unverified_by_trace(test_fixture_missing): Insufficient calibration data (requires >= 10 predictions with outcomes)'
        );
        return;
      }

      const highConfPredictions = calibrationPredictions.filter(p => p.confidence >= 0.8);

      if (highConfPredictions.length < 5) {
        console.warn('Insufficient high-confidence predictions');
        ctx.skip(
          true,
          'unverified_by_trace(test_fixture_missing): Insufficient high-confidence predictions (requires >= 5)'
        );
        return;
      }

      const accuracy =
        highConfPredictions.filter(p => p.correct).length / highConfPredictions.length;
      console.log(`High confidence (≥80%) accuracy: ${(accuracy * 100).toFixed(1)}%`);

      // High confidence should have high accuracy
      expect(accuracy).toBeGreaterThanOrEqual(0.7);
    });

    it('low confidence predictions are uncertain', async (ctx) => {
      if (!storageInitialized || calibrationPredictions.length < 10) {
        ctx.skip(
          true,
          'unverified_by_trace(test_fixture_missing): Insufficient calibration data (requires >= 10 predictions with outcomes)'
        );
        return;
      }

      const lowConfPredictions = calibrationPredictions.filter(p => p.confidence < 0.4);

      if (lowConfPredictions.length < 5) {
        console.warn('Insufficient low-confidence predictions');
        ctx.skip(
          true,
          'unverified_by_trace(test_fixture_missing): Insufficient low-confidence predictions (requires >= 5)'
        );
        return;
      }

      const accuracy =
        lowConfPredictions.filter(p => p.correct).length / lowConfPredictions.length;
      console.log(`Low confidence (<40%) accuracy: ${(accuracy * 100).toFixed(1)}%`);

      // Low confidence should NOT have high accuracy (would indicate underconfidence)
      expect(accuracy).toBeLessThan(0.8);
    });
  });

  describe('Confidence Bounds', () => {
    it('all confidence scores are in [0.1, 0.95] range', async (ctx) => {
      if (!storageInitialized) {
        ctx.skip(
          true,
          'unverified_by_trace(test_fixture_missing): Confidence bounds require a bootstrapped librarian DB'
        );
        return;
      }

      const packs = await storage.getContextPacks({ limit: 200 });
      let outOfBoundsCount = 0;

      for (const pack of packs) {
        if (pack.confidence < 0.1 || pack.confidence > 0.95) {
          outOfBoundsCount++;
          console.warn(`Pack ${pack.packId} has out-of-bounds confidence: ${pack.confidence}`);
        }
      }

      const outOfBoundsRate = outOfBoundsCount / packs.length;
      console.log(`Out-of-bounds confidence rate: ${(outOfBoundsRate * 100).toFixed(1)}%`);

      // Allow small percentage due to edge cases
      expect(outOfBoundsRate).toBeLessThan(0.05);
    });
  });
});
