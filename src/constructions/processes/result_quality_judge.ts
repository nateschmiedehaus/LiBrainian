import type { Construction } from '../types.js';
import { ConstructionError } from '../base/construction_base.js';

export interface ResultQualityThresholdSeed {
  relevanceFloor?: number;
  completenessFloor?: number;
  actionabilityFloor?: number;
  accuracyFloor?: number;
  unitPatrolPassRateFloor?: number;
}

export interface ResultQualityThresholds {
  relevance: number;
  completeness: number;
  actionability: number;
  accuracy: number;
}

export interface ResultQualityJudgeInput {
  query: string;
  expectedFiles?: string[];
  topFiles: string[];
  confidenceValues?: number[];
  evidenceSnippets?: string[];
  thresholdSeed?: ResultQualityThresholdSeed;
}

export interface ResultQualityJudgeOutput {
  kind: 'ResultQualityJudgment.v1';
  pass: boolean;
  scores: ResultQualityThresholds;
  thresholds: ResultQualityThresholds;
  findings: string[];
}

const DEFAULT_THRESHOLD_SEED: Required<ResultQualityThresholdSeed> = {
  relevanceFloor: 0.4,
  completenessFloor: 0.5,
  actionabilityFloor: 0.6,
  accuracyFloor: 0.7,
  unitPatrolPassRateFloor: 0.67,
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function normalizePath(value: string): string {
  return value.replace(/\\/gu, '/').toLowerCase();
}

function countExpectedMatches(expectedFiles: string[], topFiles: string[]): number {
  if (expectedFiles.length === 0 || topFiles.length === 0) return 0;
  const normalizedTop = topFiles.map(normalizePath);
  return expectedFiles
    .map(normalizePath)
    .filter((expected) =>
      normalizedTop.some((file) => file === expected || file.endsWith(expected)))
    .length;
}

/**
 * Calibrated thresholds are anchored to existing patrol gate floors:
 * - query relevance floor (0.4)
 * - unit patrol reliability floor (0.67)
 * This keeps thresholds explainable and non-arbitrary.
 */
export function deriveResultQualityThresholds(seed: ResultQualityThresholdSeed = {}): ResultQualityThresholds {
  const merged = { ...DEFAULT_THRESHOLD_SEED, ...seed };
  return {
    relevance: clamp01(merged.relevanceFloor),
    completeness: clamp01((merged.relevanceFloor + merged.completenessFloor) / 2),
    actionability: clamp01((merged.actionabilityFloor + merged.unitPatrolPassRateFloor) / 2),
    accuracy: clamp01((merged.accuracyFloor + merged.unitPatrolPassRateFloor) / 2),
  };
}

function scoreRelevance(expectedFiles: string[], topFiles: string[]): number {
  if (expectedFiles.length === 0) {
    return topFiles.length > 0 ? 0.6 : 0;
  }
  const matches = countExpectedMatches(expectedFiles, topFiles);
  return clamp01(matches / expectedFiles.length);
}

function scoreCompleteness(expectedFiles: string[], topFiles: string[], relevance: number): number {
  const coverageSignal = clamp01(topFiles.length / Math.max(3, expectedFiles.length));
  return clamp01((0.7 * relevance) + (0.3 * coverageSignal));
}

function scoreActionability(topFiles: string[], evidenceSnippets: string[], confidenceValues: number[]): number {
  const fileSignal = clamp01(topFiles.length / 3);
  const snippetSignal = clamp01(evidenceSnippets.length / 2);
  const confidenceSignal = confidenceValues.some((value) => Number.isFinite(value) && value > 0)
    ? 1
    : 0;
  return clamp01((0.5 * fileSignal) + (0.3 * snippetSignal) + (0.2 * confidenceSignal));
}

function scoreAccuracy(topFiles: string[], confidenceValues: number[]): number {
  let score = 1;
  if (topFiles.length === 0) score -= 0.4;
  if (topFiles.some((file) => normalizePath(file).includes('/.librarian/'))) score -= 0.3;
  if (confidenceValues.some((value) => !Number.isFinite(value) || value < 0 || value > 1)) score -= 0.2;
  return clamp01(score);
}

export function createResultQualityJudgeConstruction(): Construction<
  ResultQualityJudgeInput,
  ResultQualityJudgeOutput,
  ConstructionError,
  unknown
> {
  return {
    id: 'result-quality-judge',
    name: 'Result Quality Judge',
    description: 'Scores result usefulness for agents across relevance, completeness, actionability, and accuracy.',
    async execute(input: ResultQualityJudgeInput): Promise<ResultQualityJudgeOutput> {
      const expectedFiles = input.expectedFiles ?? [];
      const topFiles = input.topFiles ?? [];
      const confidenceValues = input.confidenceValues ?? [];
      const evidenceSnippets = input.evidenceSnippets ?? [];
      const thresholds = deriveResultQualityThresholds(input.thresholdSeed);

      const relevance = scoreRelevance(expectedFiles, topFiles);
      const completeness = scoreCompleteness(expectedFiles, topFiles, relevance);
      const actionability = scoreActionability(topFiles, evidenceSnippets, confidenceValues);
      const accuracy = scoreAccuracy(topFiles, confidenceValues);

      const findings: string[] = [];
      if (relevance < thresholds.relevance) {
        findings.push(`relevance ${relevance.toFixed(3)} below threshold ${thresholds.relevance.toFixed(3)}`);
      }
      if (completeness < thresholds.completeness) {
        findings.push(`completeness ${completeness.toFixed(3)} below threshold ${thresholds.completeness.toFixed(3)}`);
      }
      if (actionability < thresholds.actionability) {
        findings.push(`actionability ${actionability.toFixed(3)} below threshold ${thresholds.actionability.toFixed(3)}`);
      }
      if (accuracy < thresholds.accuracy) {
        findings.push(`accuracy ${accuracy.toFixed(3)} below threshold ${thresholds.accuracy.toFixed(3)}`);
      }

      return {
        kind: 'ResultQualityJudgment.v1',
        pass: findings.length === 0,
        scores: {
          relevance,
          completeness,
          actionability,
          accuracy,
        },
        thresholds,
        findings,
      };
    },
  };
}
