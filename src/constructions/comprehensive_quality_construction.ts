/**
 * @fileoverview Comprehensive Quality Construction
 *
 * A meta-construction that composes all quality constructions into a unified assessment.
 * Combines:
 * - Code Quality Reporter for quality metrics and issues
 * - Architecture Verifier for structural compliance
 * - Security Audit Helper for vulnerability detection
 *
 * Produces:
 * - Unified excellence tier rating (good, great, world_class, legendary)
 * - Aggregated dimension scores
 * - Prioritized improvement recommendations
 * - Properly propagated confidence using D3 rule (parallel-all)
 *
 * @packageDocumentation
 */

import type { Librarian } from '../api/librarian.js';
import type { ConfidenceValue } from '../epistemics/confidence.js';
import { parallelAllConfidence, getNumericValue, absent } from '../epistemics/confidence.js';
import { CodeQualityReporter, type QualityReport, type QualityQuery, type QualityRecommendation } from './code_quality_reporter.js';
import { ArchitectureVerifier, type VerificationReport, type ArchitectureSpec, type ArchitectureViolation } from './architecture_verifier.js';
import { SecurityAuditHelper, type SecurityReport, type AuditScope, type SecurityFinding } from './security_audit_helper.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Excellence tier representing overall quality level.
 * - good: Acceptable quality, some improvements needed
 * - great: High quality, few issues
 * - world_class: Exceptional quality, minimal issues
 * - legendary: Near-perfect quality, exemplary codebase
 */
export type ExcellenceTier = 'good' | 'great' | 'world_class' | 'legendary';

/**
 * Priority level for improvement recommendations.
 */
export type PriorityLevel = 'critical' | 'high' | 'medium' | 'low';

/**
 * Scope for comprehensive quality assessment.
 */
export interface AssessmentScope {
  /** Files to analyze for code quality */
  files: string[];
  /** Architecture specification to verify against */
  architectureSpec: ArchitectureSpec;
  /** Security audit scope configuration */
  securityScope: AuditScope;
}

/**
 * Unified issue from any quality dimension.
 */
export interface Issue {
  /** Unique issue identifier */
  id: string;
  /** Source dimension */
  dimension: 'code_quality' | 'architecture' | 'security';
  /** Issue severity */
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  /** Affected file */
  file: string;
  /** Line number if applicable */
  line?: number;
  /** Issue title/summary */
  title: string;
  /** Detailed description */
  description: string;
  /** Suggested fix */
  suggestion?: string;
  /** Individual confidence in this finding */
  confidence: number;
}

/**
 * Actionable recommendation for improvement.
 */
export interface Recommendation {
  /** Unique recommendation identifier */
  id: string;
  /** Priority level */
  priority: PriorityLevel;
  /** Recommendation title */
  title: string;
  /** Detailed description */
  description: string;
  /** Affected dimensions */
  dimensions: Array<'code_quality' | 'architecture' | 'security'>;
  /** Affected files */
  affectedFiles: string[];
  /** Estimated effort to implement */
  effort: 'trivial' | 'small' | 'medium' | 'large';
  /** Expected impact on quality score */
  expectedImpact: number;
}

/**
 * Prioritized improvement item.
 */
export interface Priority {
  /** Unique priority identifier */
  id: string;
  /** Rank (1 = highest priority) */
  rank: number;
  /** Associated issue or recommendation */
  issueId?: string;
  recommendationId?: string;
  /** Priority reason */
  reason: string;
  /** Score impact if addressed */
  scoreImpact: number;
}

/**
 * Comprehensive quality assessment report.
 */
export interface ComprehensiveQualityReport {
  // Individual assessments
  /** Code quality analysis report */
  codeQuality: QualityReport;
  /** Architecture verification report */
  architecture: VerificationReport;
  /** Security audit report */
  security: SecurityReport;

  // Aggregated results
  /** Overall quality score (0-100) */
  overallScore: number;
  /** Excellence tier based on overall score */
  excellenceTier: ExcellenceTier;
  /** Scores by dimension */
  dimensionScores: Map<string, number>;

  // Confidence (propagated from components using D3 rule)
  /** Combined confidence using parallel-all propagation */
  confidence: ConfidenceValue;
  /** Evidence trail from all components */
  evidenceRefs: string[];

  // Actionable output
  /** Top issues sorted by severity and impact */
  topIssues: Issue[];
  /** Prioritized recommendations for improvement */
  recommendations: Recommendation[];
  /** Improvement priorities ranked by impact */
  improvementPriorities: Priority[];

  /** Total analysis time in milliseconds */
  analysisTimeMs: number;
}

// ============================================================================
// CONSTANTS
// ============================================================================

/** Weights for dimension scoring */
const DIMENSION_WEIGHTS = {
  codeQuality: 0.35,
  architecture: 0.30,
  security: 0.35,
} as const;

/** Tier thresholds */
const TIER_THRESHOLDS = {
  legendary: 99,
  world_class: 95,
  great: 85,
  good: 0,
} as const;

/** Severity scores for issue prioritization */
const SEVERITY_SCORES: Record<string, number> = {
  critical: 100,
  high: 75,
  medium: 50,
  low: 25,
  info: 10,
  error: 75,
  warning: 50,
};

function normalizeAssessmentScope(scope: AssessmentScope): AssessmentScope {
  const candidate = (scope && typeof scope === 'object' ? scope : {}) as Partial<AssessmentScope>;
  const files = Array.isArray(candidate.files)
    ? candidate.files.filter((file): file is string => typeof file === 'string')
    : [];

  const architecture = (candidate.architectureSpec && typeof candidate.architectureSpec === 'object'
    ? candidate.architectureSpec
    : {}) as Partial<ArchitectureSpec>;

  const security = (candidate.securityScope && typeof candidate.securityScope === 'object'
    ? candidate.securityScope
    : {}) as Partial<AuditScope>;

  const normalizedSecurityFiles = Array.isArray(security.files)
    ? security.files.filter((file): file is string => typeof file === 'string')
    : files;
  const normalizedSecurityCheckTypes = Array.isArray(security.checkTypes)
    ? security.checkTypes.filter(
      (checkType): checkType is AuditScope['checkTypes'][number] => typeof checkType === 'string',
    )
    : [];

  const securityScope: AuditScope = {
    files: normalizedSecurityFiles,
    checkTypes: normalizedSecurityCheckTypes,
  };
  if (typeof security.workspace === 'string') {
    securityScope.workspace = security.workspace;
  }

  return {
    files,
    architectureSpec: {
      layers: Array.isArray(architecture.layers) ? architecture.layers : [],
      boundaries: Array.isArray(architecture.boundaries) ? architecture.boundaries : [],
      rules: Array.isArray(architecture.rules) ? architecture.rules : [],
    },
    securityScope,
  };
}

// ============================================================================
// CONSTRUCTION
// ============================================================================

/**
 * ComprehensiveQualityConstruction composes all quality constructions
 * into a unified assessment with proper confidence propagation.
 */
export class ComprehensiveQualityConstruction {
  static readonly CONSTRUCTION_ID = 'ComprehensiveQualityConstruction';

  private codeQuality: CodeQualityReporter;
  private architecture: ArchitectureVerifier;
  private security: SecurityAuditHelper;

  constructor(librarian: Librarian) {
    this.codeQuality = new CodeQualityReporter(librarian);
    this.architecture = new ArchitectureVerifier(librarian);
    this.security = new SecurityAuditHelper(librarian);
  }

  /**
   * Perform comprehensive quality assessment.
   *
   * Runs all quality assessments in parallel and aggregates results
   * with proper confidence propagation using D3 rule.
   *
   * @param scope - Assessment scope defining what to analyze
   * @returns Comprehensive quality report with unified results
   */
  async assess(scope: AssessmentScope): Promise<ComprehensiveQualityReport> {
    const normalizedScope = normalizeAssessmentScope(scope);
    const startTime = Date.now();
    const evidenceRefs: string[] = [];

    // Run all assessments in parallel for efficiency
    const [codeResult, archResult, secResult] = await Promise.all([
      this.codeQuality.analyze({
        files: normalizedScope.files,
        aspects: ['complexity', 'duplication', 'testability'],
      }),
      this.architecture.verify(normalizedScope.architectureSpec),
      this.security.audit(normalizedScope.securityScope),
    ]);

    // Collect evidence from all components
    evidenceRefs.push(...codeResult.evidenceRefs.map(e => `code_quality:${e}`));
    evidenceRefs.push(...archResult.evidenceRefs.map(e => `architecture:${e}`));
    evidenceRefs.push(...secResult.evidenceRefs.map(e => `security:${e}`));

    // Aggregate with proper confidence propagation (D3 - parallel all)
    const confidence = this.propagateConfidence([
      codeResult.confidence,
      archResult.confidence,
      secResult.confidence,
    ]);
    evidenceRefs.push(`confidence_propagation:D3_parallel_all`);

    // Compute dimension scores
    const dimensionScores = this.computeDimensionScores(codeResult, archResult, secResult);

    // Compute overall score
    const overallScore = this.computeOverallScore(dimensionScores);
    evidenceRefs.push(`overall_score:${overallScore.toFixed(1)}`);

    // Determine excellence tier
    const excellenceTier = this.determineTier(overallScore);
    evidenceRefs.push(`excellence_tier:${excellenceTier}`);

    // Synthesize actionable output
    const { issues, recommendations, priorities } = this.synthesizeActions(
      codeResult,
      archResult,
      secResult,
      dimensionScores
    );
    evidenceRefs.push(`issues:${issues.length}`);
    evidenceRefs.push(`recommendations:${recommendations.length}`);

    return {
      codeQuality: codeResult,
      architecture: archResult,
      security: secResult,
      overallScore,
      excellenceTier,
      dimensionScores,
      confidence,
      evidenceRefs,
      topIssues: issues,
      recommendations,
      improvementPriorities: priorities,
      analysisTimeMs: Date.now() - startTime,
    };
  }

  /**
   * Propagate confidence from component assessments using D3 rule.
   *
   * D3 (parallel-all) uses product of confidences for independent parallel operations.
   * This represents the probability that ALL assessments are correct.
   *
   * @param confidences - Confidence values from each component
   * @returns Combined confidence using product formula
   */
  private propagateConfidence(confidences: ConfidenceValue[]): ConfidenceValue {
    // Filter out any absent values - can't combine with unknowns
    const presentConfidences = confidences.filter(c => c.type !== 'absent');

    if (presentConfidences.length === 0) {
      return absent('insufficient_data');
    }

    // Use D3 rule: parallel-all composition = product(branches)
    // This is appropriate because all three assessments run independently
    // and we need ALL of them to be correct for the combined result to be valid
    return parallelAllConfidence(presentConfidences);
  }

  /**
   * Compute individual dimension scores.
   *
   * @param codeResult - Code quality analysis result
   * @param archResult - Architecture verification result
   * @param secResult - Security audit result
   * @returns Map of dimension name to score (0-100)
   */
  private computeDimensionScores(
    codeResult: QualityReport,
    archResult: VerificationReport,
    secResult: SecurityReport
  ): Map<string, number> {
    const scores = new Map<string, number>();

    // Code quality score: based on metrics.overallScore (0-1)
    const codeScore = Math.round(codeResult.metrics.overallScore * 100);
    scores.set('code_quality', codeScore);

    // Architecture score: based on compliance.overall (0-100)
    scores.set('architecture', archResult.compliance.overall);

    // Security score: inverse of risk score (0-100)
    // riskScore is 0-100 where higher is worse, so invert it
    const securityScore = Math.max(0, 100 - secResult.riskScore);
    scores.set('security', securityScore);

    // Sub-dimension scores for code quality
    scores.set('complexity', Math.round((1 - codeResult.metrics.averageComplexity) * 100));
    scores.set('duplication', Math.round((1 - codeResult.metrics.duplicationRatio) * 100));
    scores.set('testability', Math.round(codeResult.metrics.testabilityScore * 100));

    return scores;
  }

  /**
   * Compute overall weighted score from dimension scores.
   *
   * @param dimensionScores - Individual dimension scores
   * @returns Overall score (0-100)
   */
  private computeOverallScore(dimensionScores: Map<string, number>): number {
    const codeScore = dimensionScores.get('code_quality') ?? 0;
    const archScore = dimensionScores.get('architecture') ?? 0;
    const secScore = dimensionScores.get('security') ?? 0;

    const weighted =
      codeScore * DIMENSION_WEIGHTS.codeQuality +
      archScore * DIMENSION_WEIGHTS.architecture +
      secScore * DIMENSION_WEIGHTS.security;

    return Math.round(weighted * 10) / 10;
  }

  /**
   * Determine excellence tier from overall score.
   *
   * @param score - Overall quality score (0-100)
   * @returns Excellence tier
   */
  private determineTier(score: number): ExcellenceTier {
    if (score >= TIER_THRESHOLDS.legendary) return 'legendary';
    if (score >= TIER_THRESHOLDS.world_class) return 'world_class';
    if (score >= TIER_THRESHOLDS.great) return 'great';
    return 'good';
  }

  /**
   * Synthesize actionable output from all assessment results.
   *
   * @param codeResult - Code quality result
   * @param archResult - Architecture result
   * @param secResult - Security result
   * @param dimensionScores - Computed dimension scores
   * @returns Issues, recommendations, and priorities
   */
  private synthesizeActions(
    codeResult: QualityReport,
    archResult: VerificationReport,
    secResult: SecurityReport,
    dimensionScores: Map<string, number>
  ): {
    issues: Issue[];
    recommendations: Recommendation[];
    priorities: Priority[];
  } {
    // Collect and normalize all issues
    const issues = this.collectIssues(codeResult, archResult, secResult);

    // Sort by severity and confidence
    issues.sort((a, b) => {
      const severityDiff = (SEVERITY_SCORES[b.severity] ?? 0) - (SEVERITY_SCORES[a.severity] ?? 0);
      if (severityDiff !== 0) return severityDiff;
      return b.confidence - a.confidence;
    });

    // Limit to top issues
    const topIssues = issues.slice(0, 20);

    // Generate recommendations from issues and scores
    const recommendations = this.generateRecommendations(
      codeResult,
      archResult,
      secResult,
      dimensionScores,
      topIssues
    );

    // Compute improvement priorities
    const priorities = this.computePriorities(topIssues, recommendations, dimensionScores);

    return { issues: topIssues, recommendations, priorities };
  }

  /**
   * Collect and normalize issues from all assessment results.
   */
  private collectIssues(
    codeResult: QualityReport,
    archResult: VerificationReport,
    secResult: SecurityReport
  ): Issue[] {
    const issues: Issue[] = [];
    let issueCounter = 0;

    // Collect code quality issues
    for (const issue of codeResult.issues) {
      issues.push({
        id: `issue_${++issueCounter}`,
        dimension: 'code_quality',
        severity: this.mapSeverity(issue.severity),
        file: issue.file,
        line: issue.line,
        title: `[${issue.type}] ${issue.description.slice(0, 50)}`,
        description: issue.description,
        suggestion: issue.suggestion,
        confidence: issue.confidence,
      });
    }

    // Collect architecture violations
    for (const violation of archResult.violations) {
      issues.push({
        id: `issue_${++issueCounter}`,
        dimension: 'architecture',
        severity: this.mapSeverity(violation.rule.severity),
        file: violation.file,
        line: violation.line,
        title: `[${violation.rule.type}] ${violation.rule.description.slice(0, 50)}`,
        description: violation.description,
        suggestion: violation.suggestion,
        confidence: 0.8, // Architecture violations are generally high confidence
      });
    }

    // Collect security findings
    for (const finding of secResult.findings) {
      issues.push({
        id: `issue_${++issueCounter}`,
        dimension: 'security',
        severity: finding.severity,
        file: finding.file,
        line: finding.line,
        title: finding.title,
        description: finding.description,
        suggestion: finding.remediation,
        confidence: finding.confidence,
      });
    }

    return issues;
  }

  /**
   * Map various severity strings to unified severity levels.
   */
  private mapSeverity(severity: string): 'critical' | 'high' | 'medium' | 'low' | 'info' {
    switch (severity) {
      case 'critical':
        return 'critical';
      case 'high':
      case 'error':
        return 'high';
      case 'medium':
      case 'warning':
        return 'medium';
      case 'low':
        return 'low';
      default:
        return 'info';
    }
  }

  /**
   * Generate prioritized recommendations from assessment results.
   */
  private generateRecommendations(
    codeResult: QualityReport,
    archResult: VerificationReport,
    secResult: SecurityReport,
    dimensionScores: Map<string, number>,
    issues: Issue[]
  ): Recommendation[] {
    const recommendations: Recommendation[] = [];
    let recCounter = 0;

    // Recommendations from code quality reporter
    for (const rec of codeResult.recommendations) {
      recommendations.push({
        id: `rec_${++recCounter}`,
        priority: this.mapPriority(rec.priority),
        title: rec.text.slice(0, 80),
        description: rec.text,
        dimensions: ['code_quality'],
        affectedFiles: rec.affectedFiles,
        effort: rec.effort,
        expectedImpact: this.estimateImpact('code_quality', rec.priority, dimensionScores),
      });
    }

    // Generate security recommendations from findings
    const securityIssuesByFile = this.groupIssuesByFile(
      issues.filter(i => i.dimension === 'security')
    );

    for (const [file, fileIssues] of securityIssuesByFile) {
      const criticalCount = fileIssues.filter(i => i.severity === 'critical').length;
      const highCount = fileIssues.filter(i => i.severity === 'high').length;

      if (criticalCount > 0 || highCount > 0) {
        recommendations.push({
          id: `rec_${++recCounter}`,
          priority: criticalCount > 0 ? 'critical' : 'high',
          title: `Address security vulnerabilities in ${file}`,
          description: `Found ${criticalCount} critical and ${highCount} high severity security issues. Immediate attention required.`,
          dimensions: ['security'],
          affectedFiles: [file],
          effort: fileIssues.length > 3 ? 'large' : 'medium',
          expectedImpact: this.estimateImpact('security', criticalCount > 0 ? 'critical' : 'high', dimensionScores),
        });
      }
    }

    // Generate architecture recommendations from violations
    const archViolationCount = archResult.violations.length;
    if (archViolationCount > 0) {
      const affectedFiles = [...new Set(archResult.violations.map(v => v.file))];
      const hasLayerViolations = archResult.violations.some(v => v.rule.type === 'layer-dependency');
      const hasCircularViolations = archResult.violations.some(v => v.rule.type === 'no-circular');

      if (hasCircularViolations) {
        recommendations.push({
          id: `rec_${++recCounter}`,
          priority: 'high',
          title: 'Resolve circular dependencies',
          description: 'Circular dependencies detected. Break cycles by extracting shared code or using dependency injection.',
          dimensions: ['architecture'],
          affectedFiles,
          effort: archViolationCount > 5 ? 'large' : 'medium',
          expectedImpact: this.estimateImpact('architecture', 'high', dimensionScores),
        });
      }

      if (hasLayerViolations) {
        recommendations.push({
          id: `rec_${++recCounter}`,
          priority: 'medium',
          title: 'Fix layer dependency violations',
          description: 'Some modules are importing from disallowed layers. Review and refactor to respect architectural boundaries.',
          dimensions: ['architecture'],
          affectedFiles,
          effort: 'medium',
          expectedImpact: this.estimateImpact('architecture', 'medium', dimensionScores),
        });
      }
    }

    // Cross-dimensional recommendations
    const lowestDimension = this.findLowestDimension(dimensionScores);
    if (lowestDimension && (dimensionScores.get(lowestDimension) ?? 100) < 70) {
      recommendations.push({
        id: `rec_${++recCounter}`,
        priority: 'high',
        title: `Focus on improving ${lowestDimension.replace('_', ' ')}`,
        description: `The ${lowestDimension.replace('_', ' ')} dimension has the lowest score and should be prioritized for improvement.`,
        dimensions: [lowestDimension as 'code_quality' | 'architecture' | 'security'],
        affectedFiles: issues.filter(i => i.dimension === lowestDimension).map(i => i.file).slice(0, 10),
        effort: 'medium',
        expectedImpact: 15, // Significant impact on overall score
      });
    }

    // Sort by priority and expected impact
    recommendations.sort((a, b) => {
      const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (priorityDiff !== 0) return priorityDiff;
      return b.expectedImpact - a.expectedImpact;
    });

    return recommendations;
  }

  /**
   * Compute improvement priorities ranking.
   */
  private computePriorities(
    issues: Issue[],
    recommendations: Recommendation[],
    dimensionScores: Map<string, number>
  ): Priority[] {
    const priorities: Priority[] = [];
    let rank = 0;

    // Critical security issues get top priority
    const criticalSecurity = issues.filter(
      i => i.dimension === 'security' && i.severity === 'critical'
    );
    for (const issue of criticalSecurity.slice(0, 3)) {
      priorities.push({
        id: `priority_${++rank}`,
        rank,
        issueId: issue.id,
        reason: `Critical security vulnerability: ${issue.title}`,
        scoreImpact: this.estimateIssueImpact(issue, dimensionScores),
      });
    }

    // Critical recommendations
    const criticalRecs = recommendations.filter(r => r.priority === 'critical');
    for (const rec of criticalRecs.slice(0, 2)) {
      priorities.push({
        id: `priority_${++rank}`,
        rank,
        recommendationId: rec.id,
        reason: rec.title,
        scoreImpact: rec.expectedImpact,
      });
    }

    // High priority items
    const highIssues = issues.filter(i => i.severity === 'high').slice(0, 3);
    for (const issue of highIssues) {
      priorities.push({
        id: `priority_${++rank}`,
        rank,
        issueId: issue.id,
        reason: `High severity issue: ${issue.title}`,
        scoreImpact: this.estimateIssueImpact(issue, dimensionScores),
      });
    }

    const highRecs = recommendations.filter(r => r.priority === 'high').slice(0, 2);
    for (const rec of highRecs) {
      if (!priorities.some(p => p.recommendationId === rec.id)) {
        priorities.push({
          id: `priority_${++rank}`,
          rank,
          recommendationId: rec.id,
          reason: rec.title,
          scoreImpact: rec.expectedImpact,
        });
      }
    }

    return priorities.slice(0, 10); // Top 10 priorities
  }

  /**
   * Group issues by file for analysis.
   */
  private groupIssuesByFile(issues: Issue[]): Map<string, Issue[]> {
    const grouped = new Map<string, Issue[]>();
    for (const issue of issues) {
      if (!grouped.has(issue.file)) {
        grouped.set(issue.file, []);
      }
      grouped.get(issue.file)!.push(issue);
    }
    return grouped;
  }

  /**
   * Map priority strings to unified levels.
   */
  private mapPriority(priority: string): PriorityLevel {
    switch (priority) {
      case 'high':
        return 'high';
      case 'medium':
        return 'medium';
      default:
        return 'low';
    }
  }

  /**
   * Find the dimension with the lowest score.
   */
  private findLowestDimension(dimensionScores: Map<string, number>): string | null {
    let lowest: string | null = null;
    let lowestScore = 101;

    for (const [dimension, score] of dimensionScores) {
      // Only consider main dimensions
      if (['code_quality', 'architecture', 'security'].includes(dimension)) {
        if (score < lowestScore) {
          lowestScore = score;
          lowest = dimension;
        }
      }
    }

    return lowest;
  }

  /**
   * Estimate the score impact of addressing a recommendation.
   */
  private estimateImpact(
    dimension: string,
    priority: string,
    dimensionScores: Map<string, number>
  ): number {
    const currentScore = dimensionScores.get(dimension) ?? 50;
    const potentialGain = 100 - currentScore;

    // Higher priority = more impact
    const priorityMultiplier = {
      critical: 0.4,
      high: 0.25,
      medium: 0.15,
      low: 0.1,
    }[priority] ?? 0.1;

    // Weight by dimension weight
    const dimensionWeight = {
      code_quality: DIMENSION_WEIGHTS.codeQuality,
      architecture: DIMENSION_WEIGHTS.architecture,
      security: DIMENSION_WEIGHTS.security,
    }[dimension] ?? 0.33;

    return Math.round(potentialGain * priorityMultiplier * dimensionWeight * 100) / 100;
  }

  /**
   * Estimate the score impact of fixing an issue.
   */
  private estimateIssueImpact(issue: Issue, dimensionScores: Map<string, number>): number {
    const severityImpact = {
      critical: 5,
      high: 3,
      medium: 2,
      low: 1,
      info: 0.5,
    }[issue.severity] ?? 1;

    const confidenceWeight = issue.confidence;
    return Math.round(severityImpact * confidenceWeight * 10) / 10;
  }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create a new ComprehensiveQualityConstruction instance.
 *
 * @param librarian - Librarian instance for querying codebase knowledge
 * @returns Configured ComprehensiveQualityConstruction
 */
export function createComprehensiveQualityConstruction(
  librarian: Librarian
): ComprehensiveQualityConstruction {
  return new ComprehensiveQualityConstruction(librarian);
}
