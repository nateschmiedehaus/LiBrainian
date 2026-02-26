import type { ConstructionPlan, ContextPack, LibrarianQuery, LibrarianVersion } from '../types.js';
import { computeUncertaintyMetrics, summarizeCalibration, type CalibrationReport } from './confidence_calibration.js';
import type { CachedResponse } from './query_cache_response_utils.js';

export interface BuildShortCircuitCachedResponseOptions {
  query: LibrarianQuery;
  packs: ContextPack[];
  disclosures: string[];
  traceId: string;
  constructionPlan: ConstructionPlan;
  calibration: CalibrationReport;
  explanation: string;
  latencyMs: number;
  version: LibrarianVersion;
  totalConfidence?: number;
  drillDownHints?: string[];
  coverageGaps?: string[];
}

export function geometricMeanConfidence(packs: ContextPack[]): number {
  if (packs.length === 0) return 0;
  return Math.exp(packs.reduce((sum, pack) => sum + Math.log(Math.max(0.01, pack.confidence)), 0) / packs.length);
}

export function buildShortCircuitCachedResponse(
  options: BuildShortCircuitCachedResponseOptions
): CachedResponse {
  const totalConfidence = options.totalConfidence ?? geometricMeanConfidence(options.packs);
  return {
    query: options.query,
    packs: options.packs,
    disclosures: options.disclosures,
    traceId: options.traceId,
    constructionPlan: options.constructionPlan,
    totalConfidence,
    calibration: summarizeCalibration(options.calibration),
    uncertainty: computeUncertaintyMetrics(totalConfidence),
    cacheHit: false,
    latencyMs: options.latencyMs,
    version: options.version,
    drillDownHints: options.drillDownHints ?? [],
    explanation: options.explanation,
    coverageGaps: options.coverageGaps ?? [],
  };
}
