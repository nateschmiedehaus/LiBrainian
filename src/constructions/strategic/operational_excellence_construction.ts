/**
 * @fileoverview Operational Excellence Construction
 *
 * Construction wrapper for the operational_excellence strategic module.
 * Assesses operational practices against enterprise standards.
 *
 * @packageDocumentation
 */

import type { LiBrainian } from '../../api/librainian.js';
import type { ConfidenceValue } from '../../epistemics/confidence.js';
import { bounded } from '../../epistemics/confidence.js';
import type { CalibratedConstruction, ConstructionCalibrationTracker, VerificationMethod } from '../calibration_tracker.js';
import { generatePredictionId } from '../calibration_tracker.js';
import * as opEx from '../../strategic/operational_excellence.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Input for operational excellence assessment.
 */
export interface OperationalExcellenceAssessmentInput {
  /** Files to analyze (config, infrastructure, observability) */
  files: string[];
  /** Configuration to assess against (defaults to STARTUP_CONFIG) */
  config?: opEx.OperationalExcellenceConfig;
  /** Focus areas for assessment */
  focus?: Array<'observability' | 'reliability' | 'deployment' | 'security'>;
}

/**
 * Options for assessment execution.
 */
export interface AssessmentOptions {
  /** Depth of analysis */
  depth?: 'shallow' | 'standard' | 'deep';
}

/**
 * Result for operational excellence assessment.
 */
export interface OperationalExcellenceAssessmentOutput {
  /** Overall score (0-100) */
  score: number;
  /** Letter grade */
  grade: string;
  /** Breakdown of score components */
  breakdown: Record<string, number>;
  /** Recommendations for improvement */
  recommendations: string[];
  /** Compliance check results */
  compliance: opEx.ComplianceCheckResult;
  /** Health score results */
  healthScore: opEx.HealthScoreResult;
  /** Generated runbook templates */
  runbooks: opEx.RunbookTemplate[];
  /** Configuration used */
  configUsed: string;
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
 * Construction for assessing operational excellence.
 *
 * Uses the operational_excellence strategic module to evaluate
 * observability, reliability, deployment, and security operations.
 *
 * @example
 * ```typescript
 * const construction = new OperationalExcellenceConstruction(librainian);
 * const result = await construction.assess({
 *   files: ['docker-compose.yml', 'k8s/**', 'monitoring/**'],
 *   focus: ['observability', 'reliability'],
 * });
 * console.log(`OpEx Health: ${result.healthScore.overallScore}`);
 * ```
 */
export class OperationalExcellenceConstruction implements CalibratedConstruction {
  static readonly CONSTRUCTION_ID = 'OperationalExcellenceConstruction';
  readonly CONSTRUCTION_ID = OperationalExcellenceConstruction.CONSTRUCTION_ID;

  private librainian: LiBrainian;
  private calibrationTracker?: ConstructionCalibrationTracker;

  constructor(librainian: LiBrainian) {
    this.librainian = librainian;
  }

  /**
   * Get the construction ID for calibration tracking.
   */
  getConstructionId(): string {
    return OperationalExcellenceConstruction.CONSTRUCTION_ID;
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
   * Get the default configuration (STARTUP_CONFIG).
   */
  getStandard(): opEx.OperationalExcellenceConfig {
    return opEx.STARTUP_CONFIG;
  }

  /**
   * Assess operational practices against standards.
   *
   * @param input - Files and optional configuration
   * @param options - Assessment options
   * @returns Operational excellence assessment
   */
  async assess(
    input: OperationalExcellenceAssessmentInput,
    options?: AssessmentOptions
  ): Promise<OperationalExcellenceAssessmentOutput> {
    const startTime = Date.now();
    const evidenceRefs: string[] = [];

    // Use librainian to understand operational context
    const queryResult = await this.librainian.queryOptional({
      intent: 'Analyze operational practices including observability, reliability, deployment pipelines, and security operations',
      affectedFiles: input.files,
      depth: options?.depth === 'deep' ? 'L3' : 'L2',
    });
    evidenceRefs.push(`librainian:opex_analysis:${queryResult.packs?.length || 0}_packs`);

    // Select configuration
    const config = input.config || this.getStandard();
    evidenceRefs.push(`config:${config.metadata?.name || 'default'}`);

    // Check compliance
    const compliance = opEx.checkCompliance(config);
    evidenceRefs.push(`compliance:${compliance.overallScore}%`);

    // Calculate health score
    const healthScore = opEx.calculateHealthScore(config);
    evidenceRefs.push(`health:${healthScore.overallScore}`);

    // Generate runbooks based on configuration
    const runbooks = this.generateRunbooks(config, queryResult);
    evidenceRefs.push(`runbooks:${runbooks.length}`);

    // Compute breakdown
    const breakdown: Record<string, number> = {
      observability: this.computeObservabilityScore(config, queryResult),
      reliability: this.computeReliabilityScore(config, queryResult),
      deployment: this.computeDeploymentScore(config, queryResult),
      security: this.computeSecurityScore(config, queryResult),
    };

    // Filter breakdown based on focus
    const focus = input.focus || ['observability', 'reliability', 'deployment', 'security'];
    const filteredBreakdown = Object.fromEntries(
      Object.entries(breakdown).filter(([key]) => focus.includes(key as typeof focus[number]))
    );

    // Overall score
    const values = Object.values(filteredBreakdown);
    const score = values.length > 0 ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : 0;

    // Generate recommendations
    const recommendations = [
      ...healthScore.recommendations.map(
        (r) => `[${r.priority.toUpperCase()}] ${r.category}: ${r.recommendation}`
      ),
      ...compliance.criticalIssues.map(
        (i) => `[${i.severity.toUpperCase()}] ${i.category}: ${i.message}`
      ),
      ...compliance.warnings.map(
        (i) => `[${i.severity.toUpperCase()}] ${i.category}: ${i.message}`
      ),
    ].slice(0, 10);

    // Compute confidence
    const confidence = this.computeConfidence(queryResult, { score });

    // Record prediction for calibration
    const predictionId = this.recordPrediction(
      `OpEx assessment: ${score}/100`,
      confidence
    );

    return {
      score,
      grade: this.computeGrade(score),
      breakdown: filteredBreakdown,
      recommendations,
      compliance,
      healthScore,
      runbooks,
      configUsed: config.metadata?.name || 'default',
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
   * Generate runbooks based on configuration.
   */
  private generateRunbooks(
    config: opEx.OperationalExcellenceConfig,
    queryResult: Awaited<ReturnType<LiBrainian['queryOptional']>>
  ): opEx.RunbookTemplate[] {
    const runbooks: opEx.RunbookTemplate[] = [];
    const serviceName = config.metadata?.name || 'service';

    // Generate incident response runbook
    if (config.reliability?.incidentResponse) {
      runbooks.push(
        opEx.generateRunbookTemplate('incident', { serviceName, description: 'Incident response runbook' })
      );
    }

    // Generate deployment runbook
    if (config.deployment) {
      runbooks.push(
        opEx.generateRunbookTemplate('deployment', { serviceName, description: 'Deployment runbook' })
      );
    }

    return runbooks;
  }

  /**
   * Compute observability score.
   */
  private computeObservabilityScore(
    config: opEx.OperationalExcellenceConfig,
    queryResult: Awaited<ReturnType<LiBrainian['queryOptional']>>
  ): number {
    let score = 50; // Baseline

    const obs = config.observability;
    if (!obs) return score;

    // Logging
    if (obs.logging?.format === 'structured') score += 10;
    if (obs.logging?.retentionDays && obs.logging.retentionDays >= 30) score += 5;
    if (obs.logging?.piiHandling === 'redact') score += 5;

    // Metrics
    if (obs.metrics?.slis && obs.metrics.slis.length > 0) score += 10;
    if (obs.metrics?.slos && obs.metrics.slos.length > 0) score += 10;
    if (obs.metrics?.dashboardRequired) score += 5;

    // Tracing
    if (obs.tracing?.enabled) score += 5;

    return Math.min(100, score);
  }

  /**
   * Compute reliability score.
   */
  private computeReliabilityScore(
    config: opEx.OperationalExcellenceConfig,
    queryResult: Awaited<ReturnType<LiBrainian['queryOptional']>>
  ): number {
    let score = 50;

    const rel = config.reliability;
    if (!rel) return score;

    // Incident response
    if (rel.incidentResponse?.severityLevels?.length) score += 10;
    if (rel.incidentResponse?.runbookRequired) score += 10;
    if (rel.incidentResponse?.communicationChannels?.length) score += 5;

    // Post-mortems
    if (rel.postMortemTemplate?.blameless) score += 10;
    if (rel.postMortemTemplate?.sections?.length >= 5) score += 5;

    // Disaster recovery - check if backup verification is enabled
    if (rel.disasterRecovery?.backupConfig?.verification?.enabled) score += 10;

    return Math.min(100, score);
  }

  /**
   * Compute deployment score.
   */
  private computeDeploymentScore(
    config: opEx.OperationalExcellenceConfig,
    queryResult: Awaited<ReturnType<LiBrainian['queryOptional']>>
  ): number {
    let score = 50;

    const deploy = config.deployment;
    if (!deploy) return score;

    // Strategy
    if (deploy.strategy === 'canary' || deploy.strategy === 'blue_green') score += 15;
    else if (deploy.strategy === 'rolling') score += 10;

    // Pipeline
    if (deploy.pipeline?.stages?.length >= 3) score += 10;

    // Feature flags - check if provider is configured
    if (deploy.featureFlags?.provider) score += 10;

    // Rollback - check if automatic rollback is enabled
    if (deploy.rollback?.automatic) score += 10;
    if (deploy.rollback?.triggers?.length) score += 5;

    return Math.min(100, score);
  }

  /**
   * Compute security operations score.
   */
  private computeSecurityScore(
    config: opEx.OperationalExcellenceConfig,
    queryResult: Awaited<ReturnType<LiBrainian['queryOptional']>>
  ): number {
    let score = 50;

    const sec = config.secOps;
    if (!sec) return score;

    // Vulnerability management
    if (sec.vulnerabilityManagement?.scanning?.scanTypes?.length) score += 10;
    if (sec.vulnerabilityManagement?.remediationSLA) score += 5;

    // Secrets management
    if (sec.secretsManagement?.rotationPolicy?.enabled) score += 10;
    if (sec.secretsManagement?.accessPolicy) score += 5;

    // Access control
    if (sec.accessControl?.authentication?.methods?.length) score += 10;
    if (sec.accessControl?.authentication?.mfaPolicy?.required) score += 10;

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
    const packBonus = Math.min(0.2, packCount * 0.04);

    const low = Math.min(0.85, baseConfidence + packBonus);
    const high = Math.min(0.95, low + 0.1);

    return bounded(low, high, 'theoretical', 'Operational excellence assessment based on configuration analysis');
  }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create a new operational excellence construction.
 *
 * @param librainian - The librainian instance
 * @returns A new OperationalExcellenceConstruction
 */
export function createOperationalExcellenceConstruction(
  librainian: LiBrainian
): OperationalExcellenceConstruction {
  return new OperationalExcellenceConstruction(librainian);
}
