/**
 * @fileoverview Tests for quality dashboard builder.
 */

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_EVAL_CONFIG,
  type AggregateMetric,
  type EvaluationReport,
  type MetricType,
} from '../harness.js';
import { buildQualityDashboard } from '../dashboard.js';
import type { BlindSpotCoverageDashboard } from '../blind_spot_coverage.js';

const aggregateMetric: AggregateMetric = {
  mean: 0.82,
  median: 0.82,
  std: 0.01,
  min: 0.8,
  max: 0.85,
  percentiles: {
    p50: 0.82,
    p90: 0.84,
    p95: 0.845,
    p99: 0.85,
  },
};

const aggregateMetrics: Record<MetricType, AggregateMetric> = {
  precision: aggregateMetric,
  recall: aggregateMetric,
  f1: aggregateMetric,
  ndcg: aggregateMetric,
  mrr: aggregateMetric,
  map: aggregateMetric,
  latency: aggregateMetric,
  throughput: aggregateMetric,
  confidence_calibration: aggregateMetric,
};

const queryMetrics: Record<MetricType, number> = {
  precision: 0.8,
  recall: 0.9,
  f1: 0.85,
  ndcg: 0.88,
  mrr: 0.91,
  map: 0.89,
  latency: 120,
  throughput: 42,
  confidence_calibration: 0.95,
};

describe('buildQualityDashboard', () => {
  it('builds summary counts and markdown', () => {
    const report: EvaluationReport = {
      id: 'report_1',
      timestamp: '2026-01-26T00:00:00.000Z',
      config: DEFAULT_EVAL_CONFIG,
      queryCount: 2,
      aggregateMetrics,
      queryResults: [
        {
          queryId: 'q1',
          retrievedDocs: ['doc_a'],
          metrics: queryMetrics,
          latencyMs: 120,
        },
        {
          queryId: 'q2',
          retrievedDocs: ['doc_b'],
          metrics: queryMetrics,
          latencyMs: 140,
        },
      ],
      byTag: {
        smoke: aggregateMetrics,
        regression: aggregateMetrics,
      },
      summary: {
        qualityGrade: 'B',
        qualityScore: 82,
        findings: ['Stable performance'],
        recommendations: ['Increase coverage'],
        passed: true,
      },
    };

    const dashboard = buildQualityDashboard(report, { includeMarkdown: true });

    expect(dashboard.summary.totalCases).toBe(2);
    expect(dashboard.summary.suiteCount).toBe(2);
    expect(dashboard.markdown).toContain('# Quality Dashboard');
    expect(dashboard.markdown).toContain('## Summary');
  });

  it('renders blind spot coverage when provided', () => {
    const report: EvaluationReport = {
      id: 'report_2',
      timestamp: '2026-01-26T00:00:00.000Z',
      config: DEFAULT_EVAL_CONFIG,
      queryCount: 1,
      aggregateMetrics,
      queryResults: [
        {
          queryId: 'q1',
          retrievedDocs: ['doc_a'],
          metrics: queryMetrics,
          latencyMs: 99,
        },
      ],
      byTag: {},
      summary: {
        qualityGrade: 'A',
        qualityScore: 90,
        passed: true,
      },
    };

    const blindSpotCoverage: BlindSpotCoverageDashboard = {
      kind: 'LiBrainianDogfoodBlindSpotCoverage.v1',
      generatedAt: '2026-02-21T00:00:00.000Z',
      summary: {
        supplementaryCorporaCount: 6,
        minimumSupplementaryCorpora: 5,
        coveredBlindSpots: 10,
        totalBlindSpots: 10,
        requiredCoverageMet: true,
        strictGateCoverageMet: true,
        releaseClaimAnnotationsMet: true,
        findings: [],
      },
      blindSpots: [],
      strictGate: {
        expectedMinimumNonLiBrainianCorpora: 2,
        nonLiBrainianStrictCorporaCount: 4,
        strictScriptHasUseCases: true,
        strictScriptHasSmokeExternal: true,
        useCasesTargetsExternalCorpus: true,
        useCasesMaxRepos: 8,
        externalManifestRepoCount: 20,
      },
      releaseClaimAnnotations: {
        totalClaims: 7,
        annotatedClaims: 7,
        missingClaims: [],
      },
    };

    const dashboard = buildQualityDashboard(report, {
      includeMarkdown: true,
      blindSpotCoverage,
    });

    expect(dashboard.markdown).toContain('## Dogfood Blind Spot Coverage');
    expect(dashboard.markdown).toContain('Required category coverage: PASS');
  });
});
