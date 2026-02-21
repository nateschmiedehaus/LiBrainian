/**
 * @fileoverview Confidence command - Show confidence scores for an entity
 */

import { parseArgs } from 'node:util';
import { createSqliteStorage } from '../../storage/sqlite_storage.js';
import { resolveDbPath } from '../db_path.js';
import { isBootstrapRequired } from '../../api/bootstrap.js';
import { getConfidenceCalibration, summarizeCalibration, computeUncertaintyMetrics } from '../../api/confidence_calibration.js';
import { DEFAULT_CONFIDENCE_MODEL } from '../../types.js';
import { createError } from '../errors.js';
import { printKeyValue, formatTimestamp, printTable } from '../progress.js';

export interface ConfidenceCommandOptions {
  workspace: string;
  args: string[];
}

export async function confidenceCommand(options: ConfidenceCommandOptions): Promise<void> {
  const { workspace, args } = options;

  // Parse command-specific options
  const { values, positionals } = parseArgs({
    args,
    options: {
      history: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
    },
    allowPositionals: true,
    strict: false,
  });

  const entityId = positionals.join(' ');
  if (!entityId) {
    throw createError('INVALID_ARGUMENT', 'Entity ID is required. Usage: librainian confidence <entity-id>');
  }

  const showHistory = values.history as boolean;
  const outputJson = values.json as boolean;

  // Initialize storage (with migration from .db to .sqlite if needed)
  const dbPath = await resolveDbPath(workspace);
  const storage = createSqliteStorage(dbPath, workspace);
  await storage.initialize();

  try {
    // Check if bootstrapped
    const bootstrapCheck = await isBootstrapRequired(workspace, storage);
    if (bootstrapCheck.required) {
      throw createError('NOT_BOOTSTRAPPED', bootstrapCheck.reason);
    }

    // Try to find the entity
    let entityType: 'function' | 'module' | 'context_pack' | null = null;
    let entity: { confidence: number; accessCount?: number; lastAccessed?: Date | null; outcomeHistory?: { successes: number; failures: number } } | null = null;
    let entityName = entityId;

    // Try function first
    const fn = await storage.getFunction(entityId);
    if (fn) {
      entityType = 'function';
      entity = fn;
      entityName = fn.name;
    }

    // Try module
    if (!entity) {
      const mod = await storage.getModule(entityId);
      if (mod) {
        entityType = 'module';
        entity = mod;
        entityName = mod.path;
      }
    }

    // Try context pack
    if (!entity) {
      const pack = await storage.getContextPack(entityId);
      if (pack) {
        entityType = 'context_pack';
        entity = {
          confidence: pack.confidence,
          accessCount: pack.accessCount,
          lastAccessed: pack.createdAt,
          outcomeHistory: { successes: pack.successCount, failures: pack.failureCount },
        };
        entityName = pack.targetId;
      }
    }

    // Try to find by name in functions
    if (!entity) {
      const functions = await storage.getFunctions({ limit: 1000 });
      const foundFn = functions.find((f) => f.name === entityId || f.id.includes(entityId));
      if (foundFn) {
        entityType = 'function';
        entity = foundFn;
        entityName = foundFn.name;
      }
    }

    if (!entity || !entityType) {
      throw createError('ENTITY_NOT_FOUND', `No entity found with ID: ${entityId}`);
    }

    // Get calibration data
    const calibration = await getConfidenceCalibration(storage);
    const calibrationSummary = summarizeCalibration(calibration);
    const uncertainty = computeUncertaintyMetrics(entity.confidence);

    // Calculate adjusted confidence based on calibration
    const rawConfidence = entity.confidence;
    const calibratedConfidence = applyCalibration(rawConfidence, calibration);

    // Output
    if (outputJson) {
      console.log(JSON.stringify({
        entityId,
        entityType,
        entityName,
        rawConfidence,
        calibratedConfidence,
        uncertainty,
        calibration: calibrationSummary,
        accessCount: entity.accessCount,
        lastAccessed: entity.lastAccessed,
        outcomeHistory: entity.outcomeHistory,
        model: DEFAULT_CONFIDENCE_MODEL,
      }, null, 2));
      return;
    }

    console.log('Confidence Analysis');
    console.log('===================\n');

    printKeyValue([
      { key: 'Entity ID', value: entityId },
      { key: 'Entity Type', value: entityType },
      { key: 'Entity Name', value: entityName },
    ]);
    console.log();

    console.log('Confidence Scores:');
    printKeyValue([
      { key: 'Raw Confidence', value: rawConfidence.toFixed(4) },
      { key: 'Calibrated Confidence', value: calibratedConfidence.toFixed(4) },
      { key: 'Confidence Level', value: getConfidenceLevel(calibratedConfidence) },
    ]);
    console.log();

    console.log('Uncertainty Metrics:');
    printKeyValue([
      { key: 'Entropy', value: uncertainty.entropy.toFixed(4) },
      { key: 'Variance', value: uncertainty.variance.toFixed(4) },
    ]);
    console.log();

    if (entity.outcomeHistory) {
      console.log('Outcome History:');
      printKeyValue([
        { key: 'Successes', value: entity.outcomeHistory.successes },
        { key: 'Failures', value: entity.outcomeHistory.failures },
        { key: 'Success Rate', value: calculateSuccessRate(entity.outcomeHistory) },
      ]);
      console.log();
    }

    console.log('Access Statistics:');
    printKeyValue([
      { key: 'Access Count', value: entity.accessCount ?? 0 },
      { key: 'Last Accessed', value: formatTimestamp(entity.lastAccessed ?? null) },
    ]);
    console.log();

    console.log('Calibration Info:');
    printKeyValue([
      { key: 'Buckets', value: calibrationSummary.bucketCount },
      { key: 'Samples', value: calibrationSummary.sampleCount },
      { key: 'Expected Calibration Error', value: calibrationSummary.expectedCalibrationError.toFixed(4) },
      { key: 'Max Calibration Error', value: calibrationSummary.maxCalibrationError.toFixed(4) },
    ]);
    console.log();

    console.log('Confidence Model Parameters:');
    printKeyValue([
      { key: 'Base Confidence', value: DEFAULT_CONFIDENCE_MODEL.baseConfidence },
      { key: 'Reinforcement Delta', value: `+${DEFAULT_CONFIDENCE_MODEL.reinforcementDelta}` },
      { key: 'Decay Delta', value: `-${DEFAULT_CONFIDENCE_MODEL.decayDelta}` },
      { key: 'Time Decay Rate', value: `-${DEFAULT_CONFIDENCE_MODEL.timeDecayRate}/day` },
      { key: 'Min Confidence', value: DEFAULT_CONFIDENCE_MODEL.minConfidence },
      { key: 'Max Confidence', value: DEFAULT_CONFIDENCE_MODEL.maxConfidence },
    ]);
    console.log();

    // Confidence level interpretation
    console.log('Interpretation:');
    console.log(getConfidenceInterpretation(calibratedConfidence));
    console.log();

    // Show history if requested
    if (showHistory) {
      const qualityHistory = await storage.getQualityScoreHistory(20);
      if (qualityHistory.length > 0) {
        console.log('\nQuality Score History:');
        printTable(
          ['Date', 'Overall', 'Maintainability', 'Testability', 'Readability'],
          qualityHistory.map((h) => [
            formatTimestamp(h.recordedAt),
            h.overall.toFixed(2),
            h.maintainability.toFixed(2),
            h.testability.toFixed(2),
            h.readability.toFixed(2),
          ]),
        );
      } else {
        console.log('\nNo quality score history available.');
      }
    }

  } finally {
    await storage.close();
  }
}

function getConfidenceLevel(confidence: number): string {
  if (confidence >= 0.9) return 'High (validated)';
  if (confidence >= 0.7) return 'Good (some validation)';
  if (confidence >= 0.5) return 'Moderate (needs validation)';
  return 'Low (treat with caution)';
}

function getConfidenceInterpretation(confidence: number): string {
  if (confidence >= 0.9) {
    return '  This entity has high confidence, validated by successful outcomes.\n  You can rely on this knowledge with high certainty.';
  }
  if (confidence >= 0.7) {
    return '  This entity has good confidence with some validation.\n  Consider verifying critical decisions based on this knowledge.';
  }
  if (confidence >= 0.5) {
    return '  This entity has moderate confidence and needs more validation.\n  Use this knowledge as a starting point but verify independently.';
  }
  return '  This entity has low confidence.\n  Treat this knowledge with caution and verify before relying on it.';
}

function calculateSuccessRate(history: { successes: number; failures: number }): string {
  const total = history.successes + history.failures;
  if (total === 0) return 'N/A';
  return `${((history.successes / total) * 100).toFixed(1)}%`;
}

import type { CalibrationReport } from '../../api/confidence_calibration.js';

function applyCalibration(rawConfidence: number, calibration: CalibrationReport): number {
  // Find the bucket for this confidence level
  const bucket = calibration.buckets.find(
    (b) => rawConfidence >= b.minConfidence && rawConfidence < b.maxConfidence,
  );

  if (!bucket || bucket.sampleCount < 5) {
    // Not enough data to calibrate, return raw
    return rawConfidence;
  }

  // Adjust confidence based on calibration error
  // avgConfidence is the predicted accuracy, observedSuccess is actual accuracy
  const calibrationError = bucket.avgConfidence - bucket.observedSuccess;
  const adjusted = rawConfidence - calibrationError;

  // Clamp to valid range
  return Math.max(0.1, Math.min(0.95, adjusted));
}
