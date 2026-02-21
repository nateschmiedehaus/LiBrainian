import type { LiBrainianStorage } from '../storage/types.js';
import type { ContextPack, ConfidenceCalibrationSummary, UncertaintyMetrics } from '../types.js';
import { clamp01 } from '../utils/math.js';
import { configurable, resolveQuantifiedValue } from '../epistemics/quantification.js';

export interface CalibrationBucket {
  bucket: number;
  minConfidence: number;
  maxConfidence: number;
  avgConfidence: number;
  observedSuccess: number;
  sampleCount: number;
}

export interface CalibrationReport {
  buckets: CalibrationBucket[];
  expectedCalibrationError: number;
  maxCalibrationError: number;
  sampleCount: number;
  updatedAt: string;
}

export interface CalibrationOptions {
  bucketCount?: number;
  ttlMs?: number;
  minSamplesForFullWeight?: number;
}

const MIN_BUCKETS = 3;
const DEFAULT_BUCKETS = configurable(10, [MIN_BUCKETS, 50], 'Calibration bucket count for confidence curves.');
const DEFAULT_TTL_MS = configurable(5 * 60 * 1000, [60_000, 3_600_000], 'Cache TTL for calibration reports.');
const DEFAULT_MIN_SAMPLES = configurable(20, [1, 1_000], 'Sample floor before fully weighting calibration.');

type CalibrationCacheEntry = { report: CalibrationReport; expiresAt: number };
const calibrationCache = new WeakMap<LiBrainianStorage, Map<string, CalibrationCacheEntry>>();

export async function getConfidenceCalibration(
  storage: LiBrainianStorage,
  options: CalibrationOptions = {}
): Promise<CalibrationReport> {
  const bucketCount = Math.max(
    MIN_BUCKETS,
    resolveQuantifiedValue(options.bucketCount ?? DEFAULT_BUCKETS)
  );
  const ttlMs = resolveQuantifiedValue(options.ttlMs ?? DEFAULT_TTL_MS);
  const cacheKey = `${bucketCount}`;
  const cache = getCache(storage);
  const now = Date.now();
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.report;

  const report = await computeCalibrationReport(storage, bucketCount);
  cache.set(cacheKey, { report, expiresAt: now + ttlMs });
  return report;
}

export function summarizeCalibration(report: CalibrationReport): ConfidenceCalibrationSummary {
  return {
    bucketCount: report.buckets.length,
    sampleCount: report.sampleCount,
    expectedCalibrationError: report.expectedCalibrationError,
    maxCalibrationError: report.maxCalibrationError,
    updatedAt: report.updatedAt,
  };
}

export function applyCalibrationToPacks(
  packs: ContextPack[],
  report: CalibrationReport,
  options: CalibrationOptions = {}
): ContextPack[] {
  const minSamples = resolveQuantifiedValue(options.minSamplesForFullWeight ?? DEFAULT_MIN_SAMPLES);
  return packs.map((pack) => {
    const calibrated = calibrateConfidence(pack.confidence, report, minSamples);
    const uncertainty = computeUncertaintyMetrics(calibrated);
    return {
      ...pack,
      rawConfidence: pack.confidence,
      calibratedConfidence: calibrated,
      confidence: calibrated,
      uncertainty: uncertainty.entropy,
    };
  });
}

export function computeUncertaintyMetrics(confidence: number): UncertaintyMetrics {
  const clamped = clamp01(confidence);
  const epsilon = 1e-6;
  const p = Math.min(1 - epsilon, Math.max(epsilon, clamped));
  const entropy = -p * Math.log2(p) - (1 - p) * Math.log2(1 - p);
  const variance = p * (1 - p);
  return { confidence: clamped, entropy, variance };
}

function getCache(storage: LiBrainianStorage): Map<string, CalibrationCacheEntry> {
  const existing = calibrationCache.get(storage);
  if (existing) return existing;
  const fresh = new Map<string, CalibrationCacheEntry>();
  calibrationCache.set(storage, fresh);
  return fresh;
}

async function computeCalibrationReport(storage: LiBrainianStorage, bucketCount: number): Promise<CalibrationReport> {
  const packs = await storage.getContextPacks({ includeInvalidated: false });
  const bucketSize = 1 / bucketCount;
  const accumulators = Array.from({ length: bucketCount }, (_, index) => ({
    bucket: index,
    min: index * bucketSize,
    max: index === bucketCount - 1 ? 1 : (index + 1) * bucketSize,
    sumConfidence: 0,
    sumSuccess: 0,
    sampleCount: 0,
  }));

  let totalSamples = 0;
  for (const pack of packs) {
    const successes = pack.successCount ?? 0;
    const failures = pack.failureCount ?? 0;
    const count = successes + failures;
    if (count <= 0) continue;
    const confidence = clamp01(pack.confidence);
    const bucketIndex = Math.min(bucketCount - 1, Math.floor(confidence / bucketSize));
    const bucket = accumulators[bucketIndex]!;
    bucket.sumConfidence += confidence * count;
    bucket.sumSuccess += successes;
    bucket.sampleCount += count;
    totalSamples += count;
  }

  let ece = 0;
  let mce = 0;
  const buckets: CalibrationBucket[] = accumulators.map((bucket) => {
    if (bucket.sampleCount === 0) {
      return {
        bucket: bucket.bucket,
        minConfidence: bucket.min,
        maxConfidence: bucket.max,
        avgConfidence: (bucket.min + bucket.max) / 2,
        observedSuccess: (bucket.min + bucket.max) / 2,
        sampleCount: 0,
      };
    }
    const avgConfidence = bucket.sumConfidence / bucket.sampleCount;
    const observedSuccess = bucket.sumSuccess / bucket.sampleCount;
    const gap = Math.abs(avgConfidence - observedSuccess);
    const weight = totalSamples > 0 ? bucket.sampleCount / totalSamples : 0;
    ece += weight * gap;
    mce = Math.max(mce, gap);
    return {
      bucket: bucket.bucket,
      minConfidence: bucket.min,
      maxConfidence: bucket.max,
      avgConfidence,
      observedSuccess,
      sampleCount: bucket.sampleCount,
    };
  });

  return {
    buckets,
    expectedCalibrationError: ece,
    maxCalibrationError: mce,
    sampleCount: totalSamples,
    updatedAt: new Date().toISOString(),
  };
}

function calibrateConfidence(confidence: number, report: CalibrationReport, minSamplesForFullWeight: number): number {
  const bucketCount = report.buckets.length;
  if (bucketCount === 0) return clamp01(confidence);
  const bucketSize = 1 / bucketCount;
  const clamped = clamp01(confidence);
  const bucketIndex = Math.min(bucketCount - 1, Math.floor(clamped / bucketSize));
  const bucket = report.buckets[bucketIndex];
  if (!bucket || bucket.sampleCount <= 0) return clamped;
  const weight = Math.min(1, bucket.sampleCount / minSamplesForFullWeight);
  return clamp01(bucket.observedSuccess * weight + clamped * (1 - weight));
}
