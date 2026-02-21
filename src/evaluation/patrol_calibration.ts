import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  type CalibrationBucket,
  computeCalibrationCurve,
} from '../epistemics/calibration.js';

export interface PatrolCalibrationPoint {
  runId: string;
  createdAt: string;
  repo: string;
  source: 'feature' | 'construction' | 'negative_finding' | 'positive_finding' | 'session_summary';
  confidence: number;
  outcome: number;
  explicitConfidence: boolean;
}

export interface PatrolCalibrationRunSummary {
  runId: string;
  createdAt: string;
  repo: string;
  sampleCount: number;
  expectedCalibrationError: number;
  maximumCalibrationError: number;
  overconfidenceRatio: number;
}

export interface PatrolCalibrationTrend {
  firstRunId: string;
  lastRunId: string;
  firstEce: number;
  lastEce: number;
  deltaEce: number;
}

export interface PatrolCalibrationDashboard {
  kind: 'LiBrainianPatrolCalibration.v1';
  generatedAt: string;
  patrolDir: string;
  runCount: number;
  sampleCount: number;
  minimumSamples: number;
  enoughSamples: boolean;
  bucketCount: number;
  expectedCalibrationError: number;
  maximumCalibrationError: number;
  overconfidenceRatio: number;
  buckets: CalibrationBucket[];
  perRun: PatrolCalibrationRunSummary[];
  trend: PatrolCalibrationTrend | null;
  pointBreakdown: {
    explicit: number;
    derived: number;
  };
  recommendations: string[];
}

export interface PatrolCalibrationEvalOptions {
  bucketCount?: number;
  minimumSamples?: number;
  now?: Date;
}

const PATROL_FILE_PREFIX = 'patrol-run-';
const PATROL_FILE_SUFFIX = '.json';
const DEFAULT_MINIMUM_SAMPLES = 50;
const DEFAULT_BUCKET_COUNT = 10;

const QUALITY_CONFIDENCE: Record<string, number> = {
  excellent: 0.9,
  good: 0.75,
  poor: 0.45,
  broken: 0.2,
};

const SEVERITY_CONFIDENCE: Record<string, number> = {
  critical: 0.9,
  high: 0.8,
  medium: 0.65,
  low: 0.55,
};

const POSITIVE_SIGNAL_WORDS = ['excellent', 'good', 'useful', 'fast', 'clear', 'actionable', 'works', 'healthy'];
const NEGATIVE_SIGNAL_WORDS = ['broken', 'error', 'failed', 'timeout', 'hang', 'degraded', 'poor', 'unusable', 'below'];

export async function evaluatePatrolCalibrationDirectory(
  patrolDir: string,
  options: PatrolCalibrationEvalOptions = {}
): Promise<PatrolCalibrationDashboard> {
  const bucketCount = clampInteger(options.bucketCount, DEFAULT_BUCKET_COUNT, 4, 20);
  const minimumSamples = clampInteger(options.minimumSamples, DEFAULT_MINIMUM_SAMPLES, 1, 10_000);
  const now = options.now ?? new Date();

  const runFiles = await listPatrolRunFiles(patrolDir);
  const runSummaries: PatrolCalibrationRunSummary[] = [];
  const points: PatrolCalibrationPoint[] = [];

  for (const runFile of runFiles) {
    const payload = await safeReadJson(path.join(patrolDir, runFile));
    if (!payload) continue;

    const report = asRecord(payload);
    if (!report) continue;

    const reportCreatedAt = readString(report, 'createdAt') ?? now.toISOString();
    const runs = readArray(report, 'runs');
    for (let index = 0; index < runs.length; index += 1) {
      const run = asRecord(runs[index]);
      if (!run) continue;
      const runId = `${runFile}#${index + 1}`;
      const runPoints = collectPointsFromRun(runId, reportCreatedAt, run);
      points.push(...runPoints);

      const runCurve = computeCalibrationCurve(
        runPoints.map((point) => ({ confidence: point.confidence, outcome: point.outcome })),
        { bucketCount }
      );
      runSummaries.push({
        runId,
        createdAt: runPoints[0]?.createdAt ?? reportCreatedAt,
        repo: runPoints[0]?.repo ?? readString(run, 'repo') ?? 'unknown',
        sampleCount: runCurve.sampleSize,
        expectedCalibrationError: round(runCurve.ece),
        maximumCalibrationError: round(runCurve.mce),
        overconfidenceRatio: round(runCurve.overconfidenceRatio),
      });
    }
  }

  runSummaries.sort((left, right) => left.createdAt.localeCompare(right.createdAt));

  const curve = computeCalibrationCurve(
    points.map((point) => ({ confidence: point.confidence, outcome: point.outcome })),
    { bucketCount }
  );

  const explicitCount = points.filter((point) => point.explicitConfidence).length;
  const trend = buildTrend(runSummaries);
  const dashboard: PatrolCalibrationDashboard = {
    kind: 'LiBrainianPatrolCalibration.v1',
    generatedAt: now.toISOString(),
    patrolDir: path.resolve(patrolDir),
    runCount: runSummaries.length,
    sampleCount: curve.sampleSize,
    minimumSamples,
    enoughSamples: curve.sampleSize >= minimumSamples,
    bucketCount,
    expectedCalibrationError: round(curve.ece),
    maximumCalibrationError: round(curve.mce),
    overconfidenceRatio: round(curve.overconfidenceRatio),
    buckets: curve.buckets.map((bucket) => ({
      ...bucket,
      statedMean: round(bucket.statedMean),
      empiricalAccuracy: round(bucket.empiricalAccuracy),
      standardError: round(bucket.standardError),
      calibrationError: round(bucket.calibrationError),
    })),
    perRun: runSummaries,
    trend,
    pointBreakdown: {
      explicit: explicitCount,
      derived: Math.max(0, curve.sampleSize - explicitCount),
    },
    recommendations: [],
  };
  dashboard.recommendations = buildRecommendations(dashboard);
  return dashboard;
}

async function listPatrolRunFiles(patrolDir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(patrolDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.startsWith(PATROL_FILE_PREFIX) && entry.name.endsWith(PATROL_FILE_SUFFIX))
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right));
  } catch (error) {
    if (isErrnoException(error) && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

function collectPointsFromRun(runId: string, reportCreatedAt: string, run: Record<string, unknown>): PatrolCalibrationPoint[] {
  const repo = readString(run, 'repo') ?? 'unknown';
  const createdAt = readString(run, 'createdAt') ?? reportCreatedAt;
  const observations = asRecord(run.observations);
  if (!observations) return [];

  const points: PatrolCalibrationPoint[] = [];

  const features = readArray(observations, 'featuresUsed');
  for (const rawFeature of features) {
    const feature = asRecord(rawFeature);
    if (!feature) continue;

    const quality = normalizeQuality(readString(feature, 'quality'));
    const outcome = featureOutcome(feature, quality);
    const text = [readString(feature, 'outcome'), readString(feature, 'notes')]
      .filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
      .join(' ');
    const explicit = extractConfidenceMentions(text);
    if (explicit.length > 0) {
      for (const confidence of explicit) {
        points.push({
          runId,
          createdAt,
          repo,
          source: 'feature',
          confidence,
          outcome,
          explicitConfidence: true,
        });
      }
    } else {
      points.push({
        runId,
        createdAt,
        repo,
        source: 'feature',
        confidence: qualityToConfidence(quality),
        outcome,
        explicitConfidence: false,
      });
    }
  }

  const constructions = readArray(observations, 'constructionsUsed');
  for (const rawConstruction of constructions) {
    const construction = asRecord(rawConstruction);
    if (!construction) continue;

    const quality = normalizeQuality(readString(construction, 'outputQuality'));
    const confidenceReturned = normalizeConfidence(readNumber(construction, 'confidenceReturned'));
    const confidenceAccurate = readBoolean(construction, 'confidenceAccurate');
    const useful = readBoolean(construction, 'useful');
    const outcome = confidenceAccurate != null
      ? (confidenceAccurate ? 1 : 0)
      : (useful != null ? (useful ? 1 : 0) : outcomeFromQuality(quality));

    points.push({
      runId,
      createdAt,
      repo,
      source: 'construction',
      confidence: confidenceReturned ?? qualityToConfidence(quality),
      outcome,
      explicitConfidence: confidenceReturned != null,
    });
  }

  const negatives = readArray(observations, 'negativeFindingsMandatory');
  for (const rawFinding of negatives) {
    const finding = asRecord(rawFinding);
    if (!finding) continue;
    const severity = normalizeSeverity(readString(finding, 'severity'));
    const reproducible = readBoolean(finding, 'reproducible');
    const base = severityToConfidence(severity);
    const confidence = clamp(base + (reproducible ? 0.05 : -0.15), 0, 1);
    points.push({
      runId,
      createdAt,
      repo,
      source: 'negative_finding',
      confidence,
      outcome: reproducible ? 1 : 0,
      explicitConfidence: false,
    });
  }

  const positives = readArray(observations, 'positiveFindings');
  for (const rawFinding of positives) {
    const finding = asRecord(rawFinding);
    if (!finding) continue;
    const detail = readString(finding, 'detail') ?? '';
    const sentiment = classifyText(detail);
    points.push({
      runId,
      createdAt,
      repo,
      source: 'positive_finding',
      confidence: sentiment >= 2 ? 0.9 : (sentiment >= 0 ? 0.8 : 0.6),
      outcome: sentiment < 0 ? 0 : 1,
      explicitConfidence: false,
    });
  }

  const sessionSummary = readString(observations, 'sessionSummary');
  if (sessionSummary) {
    const summaryMentions = extractConfidenceMentions(sessionSummary);
    const sloPair = extractSloPair(sessionSummary);
    const defaultOutcome = classifyText(sessionSummary) >= 0 ? 1 : 0;
    for (const confidence of summaryMentions) {
      points.push({
        runId,
        createdAt,
        repo,
        source: 'session_summary',
        confidence,
        outcome: sloPair ? (sloPair.confidence >= sloPair.slo ? 1 : 0) : defaultOutcome,
        explicitConfidence: true,
      });
    }
  }

  return points;
}

function buildTrend(perRun: PatrolCalibrationRunSummary[]): PatrolCalibrationTrend | null {
  if (perRun.length < 2) return null;
  const first = perRun[0];
  const last = perRun[perRun.length - 1];
  return {
    firstRunId: first.runId,
    lastRunId: last.runId,
    firstEce: first.expectedCalibrationError,
    lastEce: last.expectedCalibrationError,
    deltaEce: round(last.expectedCalibrationError - first.expectedCalibrationError),
  };
}

function buildRecommendations(dashboard: PatrolCalibrationDashboard): string[] {
  const recommendations: string[] = [];
  if (dashboard.sampleCount < dashboard.minimumSamples) {
    recommendations.push(
      `Needs more patrol calibration samples: ${dashboard.sampleCount}/${dashboard.minimumSamples}. Run \`npm run patrol:full\` and \`npm run patrol:post-process\`.`
    );
  }

  if (dashboard.sampleCount === 0) {
    recommendations.push('No patrol calibration pairs were extracted. Ensure patrol run artifacts exist under state/patrol.');
    return recommendations;
  }

  if (dashboard.expectedCalibrationError >= 0.15) {
    recommendations.push(
      `ECE is ${dashboard.expectedCalibrationError.toFixed(3)} (high). Tighten confidence assignment for query/construction outputs before claiming high certainty.`
    );
  } else if (dashboard.expectedCalibrationError >= 0.1) {
    recommendations.push(
      `ECE is ${dashboard.expectedCalibrationError.toFixed(3)} (moderate). Prioritize calibration checks in patrol regression gates.`
    );
  } else {
    recommendations.push(`ECE is ${dashboard.expectedCalibrationError.toFixed(3)} (good). Keep tracking this in routine patrol runs.`);
  }

  if (dashboard.overconfidenceRatio > 0.6) {
    recommendations.push(
      `Overconfidence ratio is ${(dashboard.overconfidenceRatio * 100).toFixed(1)}%. Downweight high-confidence claims unless backed by verified outcomes.`
    );
  }

  const worstBucket = dashboard.buckets
    .filter((bucket) => bucket.sampleSize > 0)
    .sort((left, right) => right.calibrationError - left.calibrationError)[0];
  if (worstBucket) {
    recommendations.push(
      `Largest bucket gap is ${(worstBucket.calibrationError * 100).toFixed(1)}% in [${worstBucket.range[0].toFixed(1)}, ${worstBucket.range[1].toFixed(1)}].`
    );
  }

  if (dashboard.trend) {
    const direction = dashboard.trend.deltaEce <= 0 ? 'improved' : 'regressed';
    recommendations.push(
      `Calibration ${direction} by ${Math.abs(dashboard.trend.deltaEce).toFixed(3)} ECE from first to latest run.`
    );
  }

  return recommendations;
}

function extractSloPair(text: string): { confidence: number; slo: number } | null {
  const pattern = /(\d{1,3}(?:\.\d+)?)%\s*confidence[^%]*?(\d{1,3}(?:\.\d+)?)%\s*slo/i;
  const match = pattern.exec(text);
  if (!match) return null;
  const confidence = normalizeConfidence(Number.parseFloat(match[1]));
  const slo = normalizeConfidence(Number.parseFloat(match[2]));
  if (confidence == null || slo == null) return null;
  return { confidence, slo };
}

function extractConfidenceMentions(text: string): number[] {
  if (!text.trim()) return [];
  const matches: number[] = [];
  const patterns = [
    /confidence(?:\s+(?:at|of|score|returned))?\s*[:=]?\s*(-?\d{1,3}(?:\.\d+)?%?)/gi,
    /(-?\d{1,3}(?:\.\d+)?)%\s*confidence/gi,
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null = pattern.exec(text);
    while (match) {
      const normalized = normalizeConfidenceToken(match[1]);
      if (normalized != null) matches.push(normalized);
      match = pattern.exec(text);
    }
  }
  return dedupeNumbers(matches);
}

function normalizeConfidenceToken(token: string): number | null {
  const trimmed = token.trim();
  if (!trimmed) return null;
  const percent = trimmed.endsWith('%');
  const numeric = Number.parseFloat(trimmed.replace('%', ''));
  if (!Number.isFinite(numeric)) return null;
  if (percent) return normalizeConfidence(numeric);
  return normalizeConfidence(numeric);
}

function qualityToConfidence(quality: string): number {
  return QUALITY_CONFIDENCE[quality] ?? 0.6;
}

function severityToConfidence(severity: string): number {
  return SEVERITY_CONFIDENCE[severity] ?? 0.6;
}

function featureOutcome(feature: Record<string, unknown>, quality: string): number {
  const wouldUseAgain = readBoolean(feature, 'wouldUseAgain');
  if (wouldUseAgain != null) return wouldUseAgain ? 1 : 0;
  const outcomeText = readString(feature, 'outcome') ?? '';
  if (outcomeText.length > 0) {
    return classifyText(outcomeText) >= 0 ? 1 : 0;
  }
  return outcomeFromQuality(quality);
}

function outcomeFromQuality(quality: string): number {
  if (quality === 'excellent' || quality === 'good') return 1;
  return 0;
}

function classifyText(text: string): number {
  const normalized = text.toLowerCase();
  let score = 0;
  for (const positive of POSITIVE_SIGNAL_WORDS) {
    if (normalized.includes(positive)) score += 1;
  }
  for (const negative of NEGATIVE_SIGNAL_WORDS) {
    if (normalized.includes(negative)) score -= 1;
  }
  return score;
}

function normalizeQuality(value: string | undefined): string {
  if (!value) return 'good';
  const normalized = value.toLowerCase();
  if (normalized in QUALITY_CONFIDENCE) return normalized;
  return 'good';
}

function normalizeSeverity(value: string | undefined): string {
  if (!value) return 'medium';
  const normalized = value.toLowerCase();
  if (normalized in SEVERITY_CONFIDENCE) return normalized;
  return 'medium';
}

function normalizeConfidence(value: number | null): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  if (value >= 0 && value <= 1) return value;
  if (value > 1 && value <= 100) return value / 100;
  return null;
}

function dedupeNumbers(values: number[]): number[] {
  const seen = new Set<string>();
  const result: number[] = [];
  for (const value of values) {
    const key = value.toFixed(6);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function round(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 10000) / 10000;
}

function clampInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value == null || !Number.isFinite(value)) return fallback;
  const rounded = Math.trunc(value);
  return Math.min(max, Math.max(min, rounded));
}

async function safeReadJson(filePath: string): Promise<unknown | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readArray(record: Record<string, unknown>, key: string): unknown[] {
  const value = record[key];
  return Array.isArray(value) ? value : [];
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

function readNumber(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readBoolean(record: Record<string, unknown>, key: string): boolean | null {
  const value = record[key];
  return typeof value === 'boolean' ? value : null;
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error != null && 'code' in error;
}
