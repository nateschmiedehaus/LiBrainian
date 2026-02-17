import { describe, expect, it } from 'vitest';
import type { LibrarianStateReport } from '../../measurement/observability.js';
import type { RetrievalQualityReport } from '../../measurement/retrieval_quality.js';
import type { StageResult } from '../types.js';
import { computeFitnessReport } from '../fitness.js';
import { computeContinuousOverallScore } from '../continuous_fitness.js';

function createStages(): {
  stage0: StageResult;
  stage1: StageResult;
  stage2: StageResult;
  stage3: StageResult;
  stage4: StageResult;
} {
  return {
    stage0: {
      status: 'passed',
      reason: 'ok',
      metrics: {
        schema_valid: true,
        determinism_verified: true,
        tokens_used: 10,
      },
      durationMs: 10,
      artifacts: [],
    },
    stage1: {
      status: 'passed',
      metrics: {
        tests_passed: 10,
        tests_total: 10,
        tokens_used: 10,
      },
      durationMs: 10,
      artifacts: [],
    },
    stage2: {
      status: 'passed',
      metrics: {
        tests_passed: 5,
        tests_total: 5,
      },
      durationMs: 10,
      artifacts: [],
    },
    stage3: {
      status: 'passed',
      metrics: {
        tests_passed: 2,
        tests_total: 2,
      },
      durationMs: 10,
      artifacts: [],
    },
    stage4: {
      status: 'passed',
      metrics: {
        injection_resistance: 1,
        provenance_labeling: 1,
        fail_closed: true,
      },
      durationMs: 10,
      artifacts: [],
    },
  };
}

function createStateReport(queryCount: number): LibrarianStateReport {
  return {
    kind: 'LibrarianStateReport.v1',
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    codeGraphHealth: {
      entityCount: 100,
      relationCount: 200,
      coverageRatio: 0.9,
      orphanEntities: 0,
      cycleCount: 0,
      entityCountByType: {},
    },
    indexFreshness: {
      lastIndexTime: new Date().toISOString(),
      stalenessMs: 0,
      pendingChanges: 0,
      indexVersion: '1.0.0',
      isFresh: true,
    },
    confidenceState: {
      meanConfidence: 0.8,
      geometricMeanConfidence: 0.8,
      lowConfidenceCount: 1,
      defeaterCount: 2,
      defeatersByType: {},
      calibrationError: 0.1,
    },
    queryPerformance: {
      queryLatencyP50: 125,
      queryLatencyP99: 280,
      cacheHitRate: 0.6,
      retrievalRecall: 0.75,
      queryCount,
    },
    recoveryState: 'healthy',
    lastRecoveryTime: null,
    health: {
      status: 'healthy',
      checks: {
        indexFresh: true,
        confidenceAcceptable: true,
        defeatersLow: true,
        latencyAcceptable: true,
        coverageAcceptable: true,
      },
      degradationReasons: [],
    },
  };
}

function createRetrievalReport(queryCount: number): RetrievalQualityReport {
  return {
    kind: 'RetrievalQualityReport.v1',
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    datasetVersion: 'test',
    queryCount,
    aggregate: {
      meanRecallAtK: { 5: 0.7, 10: 0.8 },
      meanPrecisionAtK: { 5: 0.6, 10: 0.5 },
      meanNdcgAtK: { 5: 0.65, 10: 0.7 },
      meanMrr: 0.55,
      hitRateAtK: { 5: 0.9 },
      meanLatencyMs: 120,
      p99LatencyMs: 250,
    },
    perQuery: [],
    compliance: {
      recallTarget: 0.7,
      recallActual: 0.7,
      meetsRecallTarget: true,
      ndcgTarget: 0.6,
      ndcgActual: 0.65,
      meetsNdcgTarget: true,
      mrrTarget: 0.5,
      mrrActual: 0.55,
      meetsMrrTarget: true,
    },
    evidence: {
      method: 'test',
      config: {},
      workspace: '/tmp/workspace',
    },
  };
}

const scope = {
  repository: 'librarian',
  subsystem: 'evolution',
  commitHash: 'test',
};

describe('computeFitnessReport measurement completeness', () => {
  it('marks scoring integrity as measured when all dimension families are measured', () => {
    const report = computeFitnessReport(
      'variant',
      scope,
      createStages(),
      createRetrievalReport(5),
      createStateReport(5)
    );

    expect(report.scoringIntegrity.status).toBe('measured');
    expect(report.scoringIntegrity.coverageRatio).toBe(1);
    expect(report.scoringIntegrity.reasons).toHaveLength(0);
  });

  it('treats retrieval reports with zero query coverage as unmeasured', () => {
    const report = computeFitnessReport(
      'variant',
      scope,
      createStages(),
      createRetrievalReport(0),
      createStateReport(5)
    );

    expect(report.fitness.retrievalQuality.recallAt5).toBe(-1);
    expect(report.fitness.retrievalQuality.nDCG).toBe(-1);
    expect(report.measurementCompleteness?.retrievalQuality.measured).toBe(false);
    expect(report.measurementCompleteness?.retrievalQuality.reason).toBe('zero_query_coverage');
    expect(report.measurementCompleteness?.retrievalQuality.queryCount).toBe(0);
    expect(report.scoringIntegrity.status).toBe('unverified_by_trace');
    expect(report.scoringIntegrity.reasons).toContain('retrieval_quality_unmeasured:zero_query_coverage');

    const maskedScore = report.fitness.overall;
    const penalizedScore = computeContinuousOverallScore({
      ...report.fitness,
      retrievalQuality: {
        ...report.fitness.retrievalQuality,
        recallAt5: 0,
        nDCG: 0,
      },
    });
    expect(maskedScore).toBeGreaterThan(penalizedScore);
  });

  it('treats operational quality as unmeasured when no query samples exist', () => {
    const report = computeFitnessReport(
      'variant',
      scope,
      createStages(),
      createRetrievalReport(3),
      createStateReport(0)
    );

    expect(report.fitness.operationalQuality.queryLatencyP50Ms).toBe(-1);
    expect(report.fitness.operationalQuality.cacheHitRate).toBe(-1);
    expect(report.measurementCompleteness?.operationalQuality.measured).toBe(false);
    expect(report.measurementCompleteness?.operationalQuality.reason).toBe('zero_query_coverage');
    expect(report.measurementCompleteness?.operationalQuality.queryCount).toBe(0);
    expect(report.scoringIntegrity.status).toBe('unverified_by_trace');
    expect(report.scoringIntegrity.reasons).toContain('operational_quality_unmeasured:zero_query_coverage');
  });

  it('treats retrieval quality as unmeasured when required metrics are missing', () => {
    const incompleteRetrieval = createRetrievalReport(3);
    delete incompleteRetrieval.aggregate.meanNdcgAtK[5];

    const report = computeFitnessReport(
      'variant',
      scope,
      createStages(),
      incompleteRetrieval,
      createStateReport(5)
    );

    expect(report.fitness.retrievalQuality.recallAt5).toBe(-1);
    expect(report.measurementCompleteness?.retrievalQuality.measured).toBe(false);
    expect(report.measurementCompleteness?.retrievalQuality.reason).toBe('missing_metrics');
    expect(report.scoringIntegrity.reasons).toContain('retrieval_quality_unmeasured:missing_metrics');
  });

  it('treats epistemic quality as unmeasured when state metrics are invalid', () => {
    const invalidState = createStateReport(5);
    invalidState.codeGraphHealth.coverageRatio = Number.NaN;

    const report = computeFitnessReport(
      'variant',
      scope,
      createStages(),
      createRetrievalReport(3),
      invalidState
    );

    expect(report.fitness.epistemicQuality.evidenceCoverage).toBe(-1);
    expect(report.measurementCompleteness?.epistemicQuality.measured).toBe(false);
    expect(report.measurementCompleteness?.epistemicQuality.reason).toBe('missing_metrics');
    expect(report.scoringIntegrity.reasons).toContain('epistemic_quality_unmeasured:missing_metrics');
  });

  it('treats operational quality as unmeasured when latency/cache metrics are invalid', () => {
    const invalidState = createStateReport(5);
    invalidState.queryPerformance.queryLatencyP50 = Number.NaN;

    const report = computeFitnessReport(
      'variant',
      scope,
      createStages(),
      createRetrievalReport(3),
      invalidState
    );

    expect(report.fitness.operationalQuality.queryLatencyP50Ms).toBe(-1);
    expect(report.measurementCompleteness?.operationalQuality.measured).toBe(false);
    expect(report.measurementCompleteness?.operationalQuality.reason).toBe('missing_metrics');
    expect(report.scoringIntegrity.reasons).toContain('operational_quality_unmeasured:missing_metrics');
  });

  it('marks epistemic and operational dimensions unmeasured when state report is missing', () => {
    const report = computeFitnessReport(
      'variant',
      scope,
      createStages(),
      createRetrievalReport(3),
      undefined
    );

    expect(report.fitness.epistemicQuality.evidenceCoverage).toBe(-1);
    expect(report.fitness.operationalQuality.queryLatencyP50Ms).toBe(-1);
    expect(report.measurementCompleteness?.epistemicQuality.measured).toBe(false);
    expect(report.measurementCompleteness?.epistemicQuality.reason).toBe('missing_or_budget_skipped');
    expect(report.measurementCompleteness?.operationalQuality.measured).toBe(false);
    expect(report.measurementCompleteness?.operationalQuality.reason).toBe('missing_or_budget_skipped');
    expect(report.scoringIntegrity.status).toBe('unverified_by_trace');
    expect(report.scoringIntegrity.reasons).toContain('epistemic_quality_unmeasured:missing_or_budget_skipped');
    expect(report.scoringIntegrity.reasons).toContain('operational_quality_unmeasured:missing_or_budget_skipped');
  });
});
