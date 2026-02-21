/**
 * @fileoverview Testing Strategy Construction
 *
 * Construction wrapper for the testing_strategy strategic module.
 * Assesses testing practices against comprehensive testing standards.
 *
 * @packageDocumentation
 */

import type { LiBrainian } from '../../api/librainian.js';
import type { ConfidenceValue } from '../../epistemics/confidence.js';
import { bounded } from '../../epistemics/confidence.js';
import type { CalibratedConstruction, ConstructionCalibrationTracker, VerificationMethod } from '../calibration_tracker.js';
import { generatePredictionId } from '../calibration_tracker.js';
import * as testingStrategy from '../../strategic/testing_strategy.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Input for testing strategy assessment.
 */
export interface TestingStrategyAssessmentInput {
  /** Files to analyze (source and test files) */
  files: string[];
  /** Testing strategy to assess against (defaults to BALANCED_PRESET) */
  strategy?: testingStrategy.TestingStrategy;
  /** Current test metrics if available */
  metrics?: Partial<testingStrategy.TestQualityMetrics>;
  /** Focus on specific test types */
  focus?: Array<'unit' | 'integration' | 'e2e' | 'specialized'>;
}

/**
 * Options for assessment execution.
 */
export interface AssessmentOptions {
  /** Depth of analysis */
  depth?: 'shallow' | 'standard' | 'deep';
}

/**
 * Result for testing strategy assessment.
 */
export interface TestingStrategyAssessmentOutput {
  /** Overall score (0-100) */
  score: number;
  /** Letter grade */
  grade: string;
  /** Breakdown of score components */
  breakdown: Record<string, number>;
  /** Recommendations for improvement */
  recommendations: string[];
  /** Validation result */
  validation: testingStrategy.StrategyValidationResult;
  /** Coverage gaps identified */
  coverageGaps: testingStrategy.CoverageGapAnalysis;
  /** Quality report */
  qualityReport: testingStrategy.TestQualityReport;
  /** Strategy used for assessment */
  strategyUsed: string;
  /** Confidence in this result */
  confidence: ConfidenceValue;
  /** Evidence references */
  evidenceRefs: string[];
  /** Analysis time in milliseconds */
  analysisTimeMs: number;
  /** Prediction ID for calibration tracking */
  predictionId?: string;
}

// ============================================================================
// CONSTRUCTION
// ============================================================================

/**
 * Construction for assessing testing practices against strategy.
 *
 * Uses the testing_strategy strategic module to validate testing
 * coverage, quality, and infrastructure against configurable strategies.
 *
 * @example
 * ```typescript
 * const construction = new TestingStrategyConstruction(librainian);
 * const result = await construction.assess({
 *   files: ['src/**', 'tests/**'],
 *   metrics: { coverage: 0.75, mutationScore: 0.6 },
 * });
 * console.log(`Testing Grade: ${result.grade}`);
 * ```
 */
export class TestingStrategyConstruction implements CalibratedConstruction {
  static readonly CONSTRUCTION_ID = 'TestingStrategyConstruction';
  readonly CONSTRUCTION_ID = TestingStrategyConstruction.CONSTRUCTION_ID;

  private librainian: LiBrainian;
  private calibrationTracker?: ConstructionCalibrationTracker;

  constructor(librainian: LiBrainian) {
    this.librainian = librainian;
  }

  /**
   * Get the construction ID for calibration tracking.
   */
  getConstructionId(): string {
    return TestingStrategyConstruction.CONSTRUCTION_ID;
  }

  /**
   * Set the calibration tracker to use.
   */
  setCalibrationTracker(tracker: ConstructionCalibrationTracker): void {
    this.calibrationTracker = tracker;
  }

  /**
   * Record that a prediction was correct or incorrect.
   */
  recordOutcome(
    predictionId: string,
    wasCorrect: boolean,
    verificationMethod: VerificationMethod = 'user_feedback'
  ): void {
    if (this.calibrationTracker) {
      this.calibrationTracker.recordOutcome(predictionId, wasCorrect, verificationMethod);
    }
  }

  /**
   * Get the default strategy (BALANCED_PRESET-based).
   */
  getStandard(): testingStrategy.TestingStrategy {
    return testingStrategy.createTestingStrategy({
      id: 'default-testing-strategy',
      name: 'Default Testing Strategy',
      description: 'Balanced testing strategy for general use',
      preset: 'balanced',
    });
  }

  /**
   * Assess testing practices against strategy.
   *
   * @param input - Files and optional strategy
   * @param options - Assessment options
   * @returns Testing strategy assessment
   */
  async assess(
    input: TestingStrategyAssessmentInput,
    options?: AssessmentOptions
  ): Promise<TestingStrategyAssessmentOutput> {
    const startTime = Date.now();
    const evidenceRefs: string[] = [];

    // Use librainian to understand testing context
    const queryResult = await this.librainian.queryOptional({
      intent: 'Analyze testing practices including test coverage, test quality, and testing infrastructure',
      affectedFiles: input.files,
      depth: options?.depth === 'deep' ? 'L3' : 'L2',
    });
    evidenceRefs.push(`librainian:testing_analysis:${queryResult.packs?.length || 0}_packs`);

    // Select strategy
    const strategy = input.strategy || this.getStandard();
    evidenceRefs.push(`strategy:${strategy.id}`);

    // Extract current metrics
    const currentMetrics = this.extractMetrics(input.metrics, queryResult);
    evidenceRefs.push(`metrics:extracted`);

    // Validate strategy
    const validation = testingStrategy.validateStrategy(strategy);
    evidenceRefs.push(`validation:${validation.issues.length}_issues`);

    // Analyze coverage gaps
    const coverageGaps = testingStrategy.analyzeCoverageGaps(strategy, currentMetrics);
    evidenceRefs.push(`gaps:${coverageGaps.gaps.length}`);

    // Generate quality report
    const qualityReport = testingStrategy.generateQualityReport(strategy, currentMetrics);
    evidenceRefs.push(`report:generated`);

    // Compute breakdown
    const breakdown: Record<string, number> = {
      unitTesting: this.computeUnitScore(currentMetrics, strategy),
      integrationTesting: this.computeIntegrationScore(currentMetrics, strategy),
      e2eTesting: this.computeE2EScore(currentMetrics, strategy),
      testQuality: this.computeQualityScore(currentMetrics, strategy),
      infrastructure: this.computeInfrastructureScore(strategy),
    };

    // Overall score
    const score = Math.round(coverageGaps.overallScore * 100);

    // Generate recommendations
    const recommendations = [
      ...coverageGaps.prioritizedActions.map(
        (a) => `[${a.impact.toUpperCase()}] ${a.action}`
      ),
      ...qualityReport.recommendations.map(
        (r) => `[${r.priority.toUpperCase()}] ${r.title}: ${r.description}`
      ),
    ].slice(0, 10);

    // Compute confidence
    const confidence = this.computeConfidence(queryResult, { score });

    // Record prediction for calibration
    const predictionId = this.recordPrediction(
      `Testing strategy assessment: ${score}/100 with ${coverageGaps.gaps.length} gaps`,
      confidence
    );

    return {
      score,
      grade: this.computeGrade(score),
      breakdown,
      recommendations,
      validation,
      coverageGaps,
      qualityReport,
      strategyUsed: strategy.id,
      confidence,
      evidenceRefs,
      analysisTimeMs: Date.now() - startTime,
      predictionId,
    };
  }

  /**
   * Record a prediction for calibration tracking.
   */
  private recordPrediction(claim: string, confidence: ConfidenceValue): string {
    const predictionId = generatePredictionId(this.CONSTRUCTION_ID);
    if (this.calibrationTracker) {
      this.calibrationTracker.recordPrediction(
        this.CONSTRUCTION_ID,
        predictionId,
        confidence,
        claim
      );
    }
    return predictionId;
  }

  /**
   * Compute a letter grade from a numeric score.
   */
  private computeGrade(score: number): string {
    if (score >= 97) return 'A+';
    if (score >= 93) return 'A';
    if (score >= 90) return 'A-';
    if (score >= 87) return 'B+';
    if (score >= 83) return 'B';
    if (score >= 80) return 'B-';
    if (score >= 77) return 'C+';
    if (score >= 73) return 'C';
    if (score >= 70) return 'C-';
    if (score >= 67) return 'D+';
    if (score >= 63) return 'D';
    if (score >= 60) return 'D-';
    return 'F';
  }

  /**
   * Extract metrics from input and query results.
   */
  private extractMetrics(
    inputMetrics: Partial<testingStrategy.TestQualityMetrics> | undefined,
    queryResult: Awaited<ReturnType<LiBrainian['queryOptional']>>
  ): testingStrategy.TestQualityMetrics {
    const packs = queryResult.packs || [];

    // Count test-related packs
    const testPacks = packs.filter(
      (p) =>
        p.summary?.toLowerCase().includes('test') ||
        p.relatedFiles?.some((f) => f.includes('test') || f.includes('spec'))
    );

    return {
      coverage: inputMetrics?.coverage ?? 0.7,
      mutationScore: inputMetrics?.mutationScore ?? 0.5,
      flakyRate: inputMetrics?.flakyRate ?? 0.02,
      executionTime: inputMetrics?.executionTime ?? {
        p50: 100,
        p99: 500,
      },
      maintenanceBurden: inputMetrics?.maintenanceBurden ?? 0.3,
      testToCodeRatio: testPacks.length / Math.max(1, packs.length - testPacks.length),
    };
  }

  /**
   * Compute unit testing score.
   */
  private computeUnitScore(
    metrics: testingStrategy.TestQualityMetrics,
    strategy: testingStrategy.TestingStrategy
  ): number {
    const target = strategy.pyramid.unit.coverageTarget;
    const ratio = Math.min(1, metrics.coverage / target);
    return Math.round(ratio * 100);
  }

  /**
   * Compute integration testing score.
   */
  private computeIntegrationScore(
    metrics: testingStrategy.TestQualityMetrics,
    strategy: testingStrategy.TestingStrategy
  ): number {
    const target = strategy.pyramid.integration.coverageTarget;
    // Use overall coverage as proxy
    const ratio = Math.min(1, metrics.coverage / target);
    return Math.round(ratio * 90); // Slightly lower weight
  }

  /**
   * Compute E2E testing score.
   */
  private computeE2EScore(
    metrics: testingStrategy.TestQualityMetrics,
    strategy: testingStrategy.TestingStrategy
  ): number {
    // E2E coverage is typically lower
    const target = strategy.pyramid.e2e.criticalPathCoverage;
    const estimated = Math.min(metrics.coverage * 0.5, target);
    return Math.round((estimated / target) * 100);
  }

  /**
   * Compute test quality score.
   */
  private computeQualityScore(
    metrics: testingStrategy.TestQualityMetrics,
    strategy: testingStrategy.TestingStrategy
  ): number {
    let score = 100;

    // Penalize for mutation score below target
    const mutationTarget = strategy.pyramid.specialized.mutation.scoreTarget;
    if (metrics.mutationScore < mutationTarget) {
      score -= (mutationTarget - metrics.mutationScore) * 50;
    }

    // Penalize for high flaky rate
    if (metrics.flakyRate > 0.05) {
      score -= (metrics.flakyRate - 0.05) * 200;
    }

    // Penalize for high maintenance burden
    if (metrics.maintenanceBurden > 0.3) {
      score -= (metrics.maintenanceBurden - 0.3) * 50;
    }

    return Math.max(0, Math.round(score));
  }

  /**
   * Compute infrastructure score.
   */
  private computeInfrastructureScore(strategy: testingStrategy.TestingStrategy): number {
    let score = 70; // Baseline

    const infra = strategy.infrastructure;

    if (infra.ciIntegration.parallelExecutionEnabled) score += 10;
    if (infra.ciIntegration.cacheEnabled) score += 5;
    if (infra.flakyTestManagement.detectionEnabled) score += 10;
    if (infra.analyticsEnabled) score += 5;

    return Math.min(100, score);
  }

  /**
   * Compute confidence based on query results and assessment data.
   */
  private computeConfidence(
    queryResult: Awaited<ReturnType<LiBrainian['queryOptional']>>,
    data: { score: number }
  ): ConfidenceValue {
    const packCount = queryResult.packs?.length || 0;

    // More packs = more evidence = higher confidence
    const baseConfidence = 0.6;
    const packBonus = Math.min(0.15, packCount * 0.03);
    const scoreClarity = data.score > 50 ? 0.1 : 0.05;

    const low = Math.min(0.9, baseConfidence + packBonus);
    const high = Math.min(0.95, low + scoreClarity + 0.1);

    return bounded(low, high, 'theoretical', 'Testing strategy validation based on metrics and configuration');
  }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create a new testing strategy construction.
 *
 * @param librainian - The librainian instance
 * @returns A new TestingStrategyConstruction
 */
export function createTestingStrategyConstruction(
  librainian: LiBrainian
): TestingStrategyConstruction {
  return new TestingStrategyConstruction(librainian);
}
