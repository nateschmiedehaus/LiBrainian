import { describe, expect, it } from 'vitest';
import type { ContextPack, LibrarianQuery, LibrarianVersion } from '../../types.js';
import type { CalibrationReport } from '../confidence_calibration.js';
import { buildShortCircuitCachedResponse, geometricMeanConfidence } from '../query_short_circuit_response.js';

const VERSION: LibrarianVersion = {
  major: 1,
  minor: 0,
  patch: 0,
  indexedAt: new Date('2026-02-01T00:00:00.000Z'),
};

const QUERY: LibrarianQuery = {
  intent: 'test intent',
  depth: 'L1',
};

const CALIBRATION: CalibrationReport = {
  buckets: [
    {
      bucket: 0,
      minConfidence: 0,
      maxConfidence: 1,
      avgConfidence: 0.5,
      observedSuccess: 0.5,
      sampleCount: 100,
    },
  ],
  expectedCalibrationError: 0.1,
  maxCalibrationError: 0.1,
  sampleCount: 100,
  updatedAt: '2026-02-01T00:00:00.000Z',
};

const VERSIONED_PACK = {
  packType: 'related_function' as const,
  keyFacts: [],
  codeSnippets: [],
  createdAt: new Date('2026-02-01T00:00:00.000Z'),
  accessCount: 0,
  lastOutcome: 'unknown' as const,
  successCount: 0,
  failureCount: 0,
  version: VERSION,
};

const PACK_A: ContextPack = {
  ...VERSIONED_PACK,
  packId: 'pack-a',
  targetId: 'fn:a',
  summary: 'A',
  relatedFiles: ['src/a.ts'],
  confidence: 0.81,
  invalidationTriggers: ['src/a.ts'],
};

const PACK_B: ContextPack = {
  ...VERSIONED_PACK,
  packId: 'pack-b',
  targetId: 'fn:b',
  summary: 'B',
  relatedFiles: ['src/b.ts'],
  confidence: 0.36,
  invalidationTriggers: ['src/b.ts'],
};

describe('query_short_circuit_response', () => {
  it('computes geometric mean confidence with clamped floor', () => {
    const value = geometricMeanConfidence([PACK_A, PACK_B]);
    expect(value).toBeCloseTo(0.54, 6);
    expect(geometricMeanConfidence([])).toBe(0);
  });

  it('builds a calibrated short-circuit cached response with defaults', () => {
    const response = buildShortCircuitCachedResponse({
      query: QUERY,
      packs: [PACK_A, PACK_B],
      disclosures: ['d1'],
      traceId: 'trace-1',
      constructionPlan: {
        templateId: 'template.default',
        confidence: 0.5,
        focusAreas: [],
        evidenceRequired: false,
      },
      calibration: CALIBRATION,
      explanation: 'short-circuit',
      latencyMs: 12,
      version: VERSION,
    });

    expect(response.query).toEqual(QUERY);
    expect(response.packs).toHaveLength(2);
    expect(response.totalConfidence).toBeCloseTo(0.54, 6);
    expect(response.calibration.bucketCount).toBe(1);
    expect(response.cacheHit).toBe(false);
    expect(response.drillDownHints).toEqual([]);
    expect(response.coverageGaps).toEqual([]);
  });

  it('honors explicit total confidence and drill-down hints', () => {
    const response = buildShortCircuitCachedResponse({
      query: QUERY,
      packs: [PACK_A],
      disclosures: [],
      traceId: 'trace-2',
      constructionPlan: {
        templateId: 'template.default',
        confidence: 0.5,
        focusAreas: [],
        evidenceRequired: false,
      },
      calibration: CALIBRATION,
      explanation: 'override',
      latencyMs: 7,
      version: VERSION,
      totalConfidence: 0.9,
      drillDownHints: ['hint'],
      coverageGaps: ['gap'],
    });

    expect(response.totalConfidence).toBe(0.9);
    expect(response.drillDownHints).toEqual(['hint']);
    expect(response.coverageGaps).toEqual(['gap']);
  });
});
