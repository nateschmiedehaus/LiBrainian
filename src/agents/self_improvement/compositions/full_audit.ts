/**
 * @fileoverview Full Self-Audit Composition (tc_self_audit_full)
 *
 * Complete audit of Librarian health, theoretical soundness, and consistency.
 * Orchestrates multiple primitives to provide a comprehensive health assessment.
 *
 * Based on self-improvement-primitives.md specification.
 *
 * Flow:
 * selfBootstrap -> analyzeArchitecture -> analyzeConsistency ->
 * verifyCalibration -> generateRecommendations -> AUDIT_REPORT
 */

import type { LibrarianStorage } from '../../../storage/types.js';
import type { Recommendation, ConfidenceValue } from '../types.js';
import { selfBootstrap, type SelfBootstrapResult } from '../self_bootstrap.js';
import { analyzeArchitecture, type ArchitectureAnalysisResult } from '../analyze_architecture.js';
import { analyzeConsistency, type ConsistencyAnalysisResult } from '../analyze_consistency.js';
import { verifyCalibration, type CalibrationVerificationResult } from '../verify_calibration.js';
import { generateRecommendations, type RecommendationResult, type ImprovementRoadmap } from '../generate_recommendations.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Health score with breakdown by category.
 */
export interface HealthScore {
  /** Overall health score (0.0-1.0) */
  overall: number;
  /** Architecture health (0.0-1.0) */
  architecture: number;
  /** Consistency health (0.0-1.0) */
  consistency: number;
  /** Calibration health (0.0-1.0) */
  calibration: number;
  /** Status indicator */
  status: 'healthy' | 'needs_attention' | 'degraded' | 'critical';
  /** Confidence in this health assessment */
  confidence: ConfidenceValue;
}

/**
 * Result of a full self-audit operation.
 */
export interface FullAuditResult {
  /** Bootstrap operation result */
  bootstrapResult: SelfBootstrapResult;
  /** Architecture analysis result */
  architectureAnalysis: ArchitectureAnalysisResult;
  /** Consistency analysis result */
  consistencyAnalysis: ConsistencyAnalysisResult;
  /** Calibration verification result */
  calibrationVerification: CalibrationVerificationResult;
  /** Generated recommendations */
  recommendations: RecommendationResult;
  /** Overall health score with breakdown */
  overallHealth: HealthScore;
  /** Total duration of the audit in milliseconds */
  duration: number;
  /** Any errors encountered during the audit */
  errors: string[];
  /** Timestamp when audit was performed */
  timestamp: Date;
  /** Summary of the audit */
  summary: string;
}

/**
 * Options for the full self-audit operation.
 */
export interface FullAuditOptions {
  /** Root directory of the codebase to audit */
  rootDir: string;
  /** Storage instance to use */
  storage: LibrarianStorage;
  /** Skip bootstrap if already done recently */
  skipBootstrap?: boolean;
  /** Focus analysis on specific areas */
  focusAreas?: Array<'architecture' | 'consistency' | 'calibration'>;
  /** Expected architectural layers */
  expectedLayers?: string[];
  /** Minimum coverage threshold for bootstrap (0.0-1.0) */
  minBootstrapCoverage?: number;
  /** Enable verbose logging */
  verbose?: boolean;
  /** Optional progress callback */
  onProgress?: (stage: string, progress: number) => void;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_MIN_BOOTSTRAP_COVERAGE = 0.5;
const DEFAULT_EXPECTED_LAYERS = ['agents', 'storage', 'epistemics', 'evaluation', 'utils'];

// ============================================================================
// HEALTH SCORE CALCULATION
// ============================================================================

/**
 * Calculate the overall health score from analysis results.
 */
function calculateHealthScore(
  architectureAnalysis: ArchitectureAnalysisResult,
  consistencyAnalysis: ConsistencyAnalysisResult,
  calibrationVerification: CalibrationVerificationResult
): HealthScore {
  // Architecture score: penalize for cycles and violations
  const archCyclesPenalty = Math.min(0.5, architectureAnalysis.cycles.length * 0.1);
  const archViolationsPenalty = Math.min(0.5, architectureAnalysis.layerViolations.length * 0.05);
  const architectureScore = Math.max(0, 1 - archCyclesPenalty - archViolationsPenalty);

  // Consistency score: use the overall score from analysis
  const consistencyScore = consistencyAnalysis.overallScore;

  // Calibration score: use ECE to compute (lower ECE = higher score)
  const calibrationScore = Math.max(0, 1 - calibrationVerification.ece * 5);

  // Overall score: weighted average
  const weights = {
    architecture: 0.35,
    consistency: 0.4,
    calibration: 0.25,
  };

  const overallScore =
    architectureScore * weights.architecture +
    consistencyScore * weights.consistency +
    calibrationScore * weights.calibration;

  // Determine status
  let status: 'healthy' | 'needs_attention' | 'degraded' | 'critical';
  if (overallScore >= 0.8) {
    status = 'healthy';
  } else if (overallScore >= 0.6) {
    status = 'needs_attention';
  } else if (overallScore >= 0.4) {
    status = 'degraded';
  } else {
    status = 'critical';
  }

  // Calculate confidence in this assessment
  const sampleSizes = [
    architectureAnalysis.modules.length,
    consistencyAnalysis.codeTestMismatches.length + consistencyAnalysis.untestedClaims.length,
    calibrationVerification.sampleComplexityAnalysis.currentSampleSize,
  ];
  const totalSamples = sampleSizes.reduce((sum, s) => sum + s, 0);
  const confidenceScore = Math.min(1, totalSamples / 200);

  return {
    overall: overallScore,
    architecture: architectureScore,
    consistency: consistencyScore,
    calibration: calibrationScore,
    status,
    confidence: {
      score: confidenceScore,
      tier: confidenceScore >= 0.7 ? 'high' : confidenceScore >= 0.4 ? 'medium' : 'low',
      source: 'measured',
      sampleSize: totalSamples,
    },
  };
}

/**
 * Generate a summary of the audit.
 */
function generateSummary(
  healthScore: HealthScore,
  architectureAnalysis: ArchitectureAnalysisResult,
  consistencyAnalysis: ConsistencyAnalysisResult,
  calibrationVerification: CalibrationVerificationResult,
  recommendations: RecommendationResult
): string {
  const parts: string[] = [];

  // Overall status
  parts.push(`Overall health: ${(healthScore.overall * 100).toFixed(1)}% (${healthScore.status})`);

  // Architecture
  if (architectureAnalysis.cycles.length > 0) {
    parts.push(`Architecture: ${architectureAnalysis.cycles.length} circular dependencies detected`);
  } else {
    parts.push(`Architecture: No circular dependencies`);
  }

  // Consistency
  const totalInconsistencies =
    consistencyAnalysis.codeTestMismatches.length +
    consistencyAnalysis.codeDocMismatches.length +
    consistencyAnalysis.phantomClaims.length;
  if (totalInconsistencies > 0) {
    parts.push(`Consistency: ${totalInconsistencies} inconsistencies found`);
  } else {
    parts.push(`Consistency: No major inconsistencies`);
  }

  // Calibration
  if (calibrationVerification.isWellCalibrated) {
    parts.push(`Calibration: Well-calibrated (ECE: ${calibrationVerification.ece.toFixed(3)})`);
  } else {
    parts.push(`Calibration: Needs improvement (ECE: ${calibrationVerification.ece.toFixed(3)})`);
  }

  // Recommendations
  const criticalRecs = recommendations.recommendations.filter((r) => r.severity === 'critical');
  const highRecs = recommendations.recommendations.filter((r) => r.severity === 'high');
  if (criticalRecs.length > 0) {
    parts.push(`Critical issues: ${criticalRecs.length}`);
  }
  if (highRecs.length > 0) {
    parts.push(`High priority recommendations: ${highRecs.length}`);
  }

  return parts.join('. ') + '.';
}

// ============================================================================
// MAIN AUDIT FUNCTION
// ============================================================================

/**
 * Perform a full self-audit of the codebase.
 *
 * This composition orchestrates:
 * 1. selfBootstrap - Index the codebase (optional skip)
 * 2. analyzeArchitecture - Check for circular deps, coupling, etc.
 * 3. analyzeConsistency - Check code/test/doc alignment
 * 4. verifyCalibration - Verify confidence calibration
 * 5. generateRecommendations - Create prioritized improvement plan
 *
 * @param options - Audit configuration options
 * @returns Full audit result with health assessment
 *
 * @example
 * ```typescript
 * const result = await fullSelfAudit({
 *   rootDir: '/path/to/librarian',
 *   storage: myStorage,
 * });
 * console.log(`Health: ${result.overallHealth.overall * 100}%`);
 * console.log(`Status: ${result.overallHealth.status}`);
 * ```
 */
export async function fullSelfAudit(
  options: FullAuditOptions
): Promise<FullAuditResult> {
  const startTime = Date.now();
  const errors: string[] = [];
  const timestamp = new Date();

  const {
    rootDir,
    storage,
    skipBootstrap = false,
    focusAreas,
    expectedLayers = DEFAULT_EXPECTED_LAYERS,
    minBootstrapCoverage = DEFAULT_MIN_BOOTSTRAP_COVERAGE,
    verbose = false,
    onProgress,
  } = options;

  // Validate inputs
  if (!rootDir) {
    throw new Error('rootDir is required for fullSelfAudit');
  }
  if (!storage) {
    throw new Error('storage is required for fullSelfAudit');
  }

  // Determine which analyses to run
  const runArchitecture = !focusAreas || focusAreas.includes('architecture');
  const runConsistency = !focusAreas || focusAreas.includes('consistency');
  const runCalibration = !focusAreas || focusAreas.includes('calibration');

  // Stage 1: Bootstrap
  if (verbose) {
    console.log('[fullSelfAudit] Stage 1: Bootstrap');
  }
  onProgress?.('bootstrap', 0);

  let bootstrapResult: SelfBootstrapResult;
  if (skipBootstrap) {
    // Create a mock bootstrap result when skipped
    bootstrapResult = {
      indexedFiles: 0,
      extractedSymbols: 0,
      graphNodes: 0,
      graphEdges: 0,
      duration: 0,
      errors: [],
      isSelfReferential: false,
      coverage: { functions: 1, classes: 1, modules: 1, relationships: 1 },
    };
    if (verbose) {
      console.log('[fullSelfAudit] Bootstrap skipped');
    }
  } else {
    try {
      bootstrapResult = await selfBootstrap({
        rootDir,
        storage,
        verbose,
      });

      // Check bootstrap coverage gate
      const avgCoverage =
        (bootstrapResult.coverage.functions +
          bootstrapResult.coverage.modules +
          bootstrapResult.coverage.relationships) / 3;

      if (avgCoverage < minBootstrapCoverage) {
        errors.push(
          `Bootstrap coverage (${(avgCoverage * 100).toFixed(1)}%) below threshold (${(minBootstrapCoverage * 100).toFixed(1)}%)`
        );
      }
    } catch (error) {
      errors.push(`Bootstrap failed: ${error instanceof Error ? error.message : String(error)}`);
      bootstrapResult = {
        indexedFiles: 0,
        extractedSymbols: 0,
        graphNodes: 0,
        graphEdges: 0,
        duration: 0,
        errors: [String(error)],
        isSelfReferential: false,
        coverage: { functions: 0, classes: 0, modules: 0, relationships: 0 },
      };
    }
  }
  onProgress?.('bootstrap', 100);

  // Stage 2: Parallel Analysis
  if (verbose) {
    console.log('[fullSelfAudit] Stage 2: Analysis');
  }
  onProgress?.('analysis', 0);

  // Run analyses (could be parallelized in production)
  let architectureAnalysis: ArchitectureAnalysisResult;
  let consistencyAnalysis: ConsistencyAnalysisResult;
  let calibrationVerification: CalibrationVerificationResult;

  // Architecture analysis
  if (runArchitecture) {
    try {
      architectureAnalysis = await analyzeArchitecture({
        rootDir,
        storage,
        expectedLayers,
        verbose,
      });
    } catch (error) {
      errors.push(`Architecture analysis failed: ${error instanceof Error ? error.message : String(error)}`);
      architectureAnalysis = {
        modules: [],
        dependencies: [],
        cycles: [],
        layerViolations: [],
        couplingMetrics: {
          averageAfferentCoupling: 0,
          averageEfferentCoupling: 0,
          averageInstability: 0,
          highCouplingCount: 0,
          mostCoupled: [],
        },
        duration: 0,
        errors: [String(error)],
        suggestions: [],
      };
    }
  } else {
    architectureAnalysis = {
      modules: [],
      dependencies: [],
      cycles: [],
      layerViolations: [],
      couplingMetrics: {
        averageAfferentCoupling: 0,
        averageEfferentCoupling: 0,
        averageInstability: 0,
        highCouplingCount: 0,
        mostCoupled: [],
      },
      duration: 0,
      errors: [],
      suggestions: [],
    };
  }
  onProgress?.('analysis', 33);

  // Consistency analysis
  if (runConsistency) {
    try {
      consistencyAnalysis = await analyzeConsistency({
        rootDir,
        storage,
        verbose,
      });
    } catch (error) {
      errors.push(`Consistency analysis failed: ${error instanceof Error ? error.message : String(error)}`);
      consistencyAnalysis = {
        codeTestMismatches: [],
        codeDocMismatches: [],
        unreferencedCode: [],
        staleDocs: [],
        overallScore: 0,
        phantomClaims: [],
        untestedClaims: [],
        docDrift: [],
        duration: 0,
        errors: [String(error)],
      };
    }
  } else {
    consistencyAnalysis = {
      codeTestMismatches: [],
      codeDocMismatches: [],
      unreferencedCode: [],
      staleDocs: [],
      overallScore: 1,
      phantomClaims: [],
      untestedClaims: [],
      docDrift: [],
      duration: 0,
      errors: [],
    };
  }
  onProgress?.('analysis', 66);

  // Calibration verification
  if (runCalibration) {
    try {
      calibrationVerification = await verifyCalibration({
        storage,
        verbose,
      });
    } catch (error) {
      errors.push(`Calibration verification failed: ${error instanceof Error ? error.message : String(error)}`);
      calibrationVerification = {
        ece: 0.5,
        mce: 0.5,
        brierScore: 0.25,
        isWellCalibrated: false,
        recommendations: [],
        calibrationStatus: 'insufficient_data',
        reliabilityDiagram: { bins: [], perfectCalibrationLine: [[0, 0], [1, 1]] },
        sampleComplexityAnalysis: {
          currentSampleSize: 0,
          requiredSamplesForEpsilon: 500,
          currentEpsilon: 1,
          confidenceInterval: [0, 1],
          powerAnalysis: { currentPower: 0, detectableEffectSize: 1, samplesForPower80: 500 },
        },
        confidence: { score: 0, tier: 'uncertain', source: 'default' },
        duration: 0,
        errors: [String(error)],
      };
    }
  } else {
    calibrationVerification = {
      ece: 0,
      mce: 0,
      brierScore: 0,
      isWellCalibrated: true,
      recommendations: [],
      calibrationStatus: 'well_calibrated',
      reliabilityDiagram: { bins: [], perfectCalibrationLine: [[0, 0], [1, 1]] },
      sampleComplexityAnalysis: {
        currentSampleSize: 0,
        requiredSamplesForEpsilon: 0,
        currentEpsilon: 0,
        confidenceInterval: [0, 0],
        powerAnalysis: { currentPower: 1, detectableEffectSize: 0, samplesForPower80: 0 },
      },
      confidence: { score: 1, tier: 'high', source: 'default' },
      duration: 0,
      errors: [],
    };
  }
  onProgress?.('analysis', 100);

  // Stage 3: Generate Recommendations
  if (verbose) {
    console.log('[fullSelfAudit] Stage 3: Recommendations');
  }
  onProgress?.('recommendations', 0);

  let recommendations: RecommendationResult;
  try {
    recommendations = await generateRecommendations(
      {
        architecture: architectureAnalysis,
        consistency: consistencyAnalysis,
        calibration: calibrationVerification,
      },
      { verbose }
    );
  } catch (error) {
    errors.push(`Recommendation generation failed: ${error instanceof Error ? error.message : String(error)}`);
    recommendations = {
      recommendations: [],
      prioritizedActions: [],
      estimatedImpact: {
        qualityImprovement: 0,
        debtReduction: 0,
        maintainabilityImprovement: 0,
        riskReduction: 0,
        totalEffortHours: { min: 0, max: 0 },
        confidence: { score: 0, tier: 'uncertain', source: 'default' },
      },
      roadmap: { phases: [], totalEstimatedEffort: '0 days', criticalPath: [] },
      dependencies: [],
      duration: 0,
      errors: [String(error)],
    };
  }
  onProgress?.('recommendations', 100);

  // Stage 4: Calculate Health Score
  if (verbose) {
    console.log('[fullSelfAudit] Stage 4: Health Score');
  }

  const overallHealth = calculateHealthScore(
    architectureAnalysis,
    consistencyAnalysis,
    calibrationVerification
  );

  // Generate summary
  const summary = generateSummary(
    overallHealth,
    architectureAnalysis,
    consistencyAnalysis,
    calibrationVerification,
    recommendations
  );

  const duration = Date.now() - startTime;

  if (verbose) {
    console.log(`[fullSelfAudit] Complete. Health: ${(overallHealth.overall * 100).toFixed(1)}%`);
  }

  return {
    bootstrapResult,
    architectureAnalysis,
    consistencyAnalysis,
    calibrationVerification,
    recommendations,
    overallHealth,
    duration,
    errors,
    timestamp,
    summary,
  };
}
