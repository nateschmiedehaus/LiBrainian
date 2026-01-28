/**
 * @fileoverview Self-Improvement Report Generator (WU-META-003)
 *
 * Generates comprehensive self-improvement reports for Librarian by:
 * - Using self-analysis primitives to identify issues
 * - Generating actionable improvement recommendations
 * - Prioritizing issues by impact and effort
 * - Producing structured reports in multiple formats
 */

import type { LibrarianStorage } from '../../storage/types.js';
import { analyzeArchitecture, type ArchitectureAnalysisResult } from './analyze_architecture.js';
import { analyzeConsistency, type ConsistencyAnalysisResult } from './analyze_consistency.js';
import { verifyCalibration, type CalibrationVerificationResult } from './verify_calibration.js';
import { getErrorMessage } from '../../utils/errors.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Categories of issues that can be detected.
 */
export type IssueCategory = 'architecture' | 'consistency' | 'calibration' | 'coverage' | 'performance';

/**
 * Severity levels for issues.
 */
export type IssueSeverity = 'low' | 'medium' | 'high' | 'critical';

/**
 * Effort levels for recommendations.
 */
export type EffortLevel = 'trivial' | 'small' | 'medium' | 'large';

/**
 * Impact levels for recommendations.
 */
export type ImpactLevel = 'low' | 'medium' | 'high';

/**
 * An issue detected in the codebase.
 */
export interface Issue {
  /** Unique identifier */
  id: string;
  /** Category of the issue */
  category: IssueCategory;
  /** Severity of the issue */
  severity: IssueSeverity;
  /** Short title */
  title: string;
  /** Detailed description */
  description: string;
  /** Files affected by this issue */
  affectedFiles: string[];
  /** Evidence supporting this issue */
  evidence: string[];
}

/**
 * A recommendation to address an issue.
 */
export interface Recommendation {
  /** ID of the issue this recommendation addresses */
  issueId: string;
  /** Recommended action */
  action: string;
  /** Estimated effort */
  effort: EffortLevel;
  /** Expected impact */
  impact: ImpactLevel;
  /** Priority score (0-100, higher = more important) */
  priority: number;
  /** Hints for implementing this recommendation */
  implementationHints: string[];
}

/**
 * Scope of the analysis performed.
 */
export interface AnalysisScope {
  /** Number of files analyzed */
  filesAnalyzed: number;
  /** Number of tests run */
  testsRun: number;
  /** Metrics that were collected */
  metricsCollected: string[];
}

/**
 * Summary of codebase health.
 */
export interface HealthSummary {
  /** Overall health score (0-1) */
  overallScore: number;
  /** Calibration health score (0-1) */
  calibrationScore: number;
  /** Consistency health score (0-1) */
  consistencyScore: number;
  /** Coverage health score (0-1) */
  coverageScore: number;
}

/**
 * Complete self-improvement report.
 */
export interface SelfImprovementReport {
  /** When the report was generated */
  generatedAt: Date;
  /** Version of Librarian used */
  librarianVersion: string;
  /** Scope of the analysis */
  analysisScope: AnalysisScope;
  /** Health summary */
  healthSummary: HealthSummary;
  /** Issues found */
  issues: Issue[];
  /** Recommendations */
  recommendations: Recommendation[];
  /** Suggested next steps */
  nextSteps: string[];
}

/**
 * Report export format.
 */
export type ReportFormat = 'json' | 'markdown';

// ============================================================================
// CONSTANTS
// ============================================================================

const SEVERITY_SCORES: Record<IssueSeverity, number> = {
  critical: 100,
  high: 75,
  medium: 50,
  low: 25,
};

const EFFORT_SCORES: Record<EffortLevel, number> = {
  trivial: 1.0,
  small: 0.8,
  medium: 0.5,
  large: 0.2,
};

const IMPACT_SCORES: Record<ImpactLevel, number> = {
  high: 1.0,
  medium: 0.6,
  low: 0.3,
};

// ============================================================================
// SELF-IMPROVEMENT REPORT GENERATOR
// ============================================================================

/**
 * Generator for self-improvement reports.
 *
 * Uses self-analysis primitives to identify Librarian's own issues,
 * generates actionable recommendations, and produces structured reports.
 *
 * @example
 * ```typescript
 * const generator = new SelfImprovementReportGenerator(storage);
 * const report = await generator.generateReport('/path/to/repo');
 * const markdown = generator.exportReport(report, 'markdown');
 * ```
 */
export class SelfImprovementReportGenerator {
  private storage: LibrarianStorage;
  private errors: string[] = [];

  /**
   * Create a new report generator.
   *
   * @param storage - Storage instance to use for analysis
   */
  constructor(storage: LibrarianStorage) {
    if (!storage) {
      throw new Error('storage is required for SelfImprovementReportGenerator');
    }
    this.storage = storage;
  }

  // ==========================================================================
  // CODEBASE ANALYSIS
  // ==========================================================================

  /**
   * Analyze the codebase for issues.
   *
   * This method runs multiple analysis primitives:
   * - Architecture analysis (circular deps, coupling, layer violations)
   * - Consistency analysis (test coverage, documentation alignment)
   * - Calibration verification (confidence score accuracy)
   *
   * @param rootDir - Root directory to analyze
   * @returns Array of detected issues
   */
  async analyzeCodebase(rootDir: string): Promise<Issue[]> {
    this.errors = [];
    const issues: Issue[] = [];
    let issueCounter = 0;

    // Run architecture analysis
    try {
      const archResult = await this.runArchitectureAnalysis(rootDir);
      issues.push(...this.extractArchitectureIssues(archResult, () => `arch-${++issueCounter}`));
    } catch (error) {
      this.errors.push(`Architecture analysis failed: ${getErrorMessage(error)}`);
    }

    // Run consistency analysis
    try {
      const consResult = await this.runConsistencyAnalysis(rootDir);
      issues.push(...this.extractConsistencyIssues(consResult, () => `cons-${++issueCounter}`));
    } catch (error) {
      this.errors.push(`Consistency analysis failed: ${getErrorMessage(error)}`);
    }

    // Run calibration verification
    try {
      const calResult = await this.runCalibrationVerification();
      issues.push(...this.extractCalibrationIssues(calResult, () => `cal-${++issueCounter}`));
    } catch (error) {
      this.errors.push(`Calibration verification failed: ${getErrorMessage(error)}`);
    }

    // Run coverage analysis
    try {
      const coverageIssues = await this.runCoverageAnalysis(rootDir);
      issues.push(...coverageIssues.map((i) => ({ ...i, id: `cov-${++issueCounter}` })));
    } catch (error) {
      this.errors.push(`Coverage analysis failed: ${getErrorMessage(error)}`);
    }

    return issues;
  }

  // ==========================================================================
  // PRIMITIVE WRAPPERS
  // ==========================================================================

  /**
   * Run architecture analysis.
   */
  private async runArchitectureAnalysis(rootDir: string): Promise<ArchitectureAnalysisResult> {
    return analyzeArchitecture({
      rootDir,
      storage: this.storage,
      expectedLayers: ['api', 'core', 'storage', 'utils', 'agents', 'cli'],
      checks: ['circular_deps', 'large_interfaces', 'coupling_analysis', 'layer_violations'],
    });
  }

  /**
   * Run consistency analysis.
   */
  private async runConsistencyAnalysis(rootDir: string): Promise<ConsistencyAnalysisResult> {
    return analyzeConsistency({
      rootDir,
      storage: this.storage,
      checkTests: true,
      checkDocs: true,
    });
  }

  /**
   * Run calibration verification.
   */
  private async runCalibrationVerification(): Promise<CalibrationVerificationResult> {
    return verifyCalibration({
      storage: this.storage,
      minSamples: 20,
      targetEce: 0.05,
    });
  }

  /**
   * Run coverage analysis.
   */
  private async runCoverageAnalysis(rootDir: string): Promise<Omit<Issue, 'id'>[]> {
    const issues: Omit<Issue, 'id'>[] = [];

    try {
      const modules = await this.storage.getModules();
      const functions = await this.storage.getFunctions();

      // Check for modules without tests
      const modulesWithoutTests = modules.filter((m) => {
        // Skip test files and type files
        if (m.path.includes('__tests__') || m.path.includes('.test.') || m.path.endsWith('.d.ts')) {
          return false;
        }
        // Check if there's a corresponding test file
        const baseName = m.path.replace(/\.ts$/, '');
        const hasTest = modules.some((other) =>
          other.path.includes(`${baseName}.test.ts`) ||
          other.path.includes(`__tests__/${baseName.split('/').pop()}.test.ts`)
        );
        return !hasTest && m.exports.length > 0;
      });

      if (modulesWithoutTests.length > 5) {
        issues.push({
          category: 'coverage',
          severity: 'medium',
          title: `${modulesWithoutTests.length} modules without test coverage`,
          description: `Multiple modules lack corresponding test files. This may indicate gaps in test coverage.`,
          affectedFiles: modulesWithoutTests.slice(0, 10).map((m) => m.path),
          evidence: modulesWithoutTests.slice(0, 5).map((m) => `${m.path}: ${m.exports.length} exports untested`),
        });
      }

      // Check for low-confidence functions
      const lowConfidenceFunctions = functions.filter((f) => f.confidence < 0.5);
      if (lowConfidenceFunctions.length > 10) {
        issues.push({
          category: 'coverage',
          severity: 'low',
          title: `${lowConfidenceFunctions.length} functions with low confidence`,
          description: `Multiple functions have confidence scores below 0.5, indicating incomplete analysis.`,
          affectedFiles: [...new Set(lowConfidenceFunctions.slice(0, 10).map((f) => f.filePath))],
          evidence: lowConfidenceFunctions.slice(0, 5).map((f) => `${f.name}: confidence ${f.confidence.toFixed(2)}`),
        });
      }
    } catch (error) {
      this.errors.push(`Coverage analysis storage query failed: ${getErrorMessage(error)}`);
    }

    return issues;
  }

  // ==========================================================================
  // ISSUE EXTRACTION
  // ==========================================================================

  /**
   * Extract issues from architecture analysis result.
   */
  private extractArchitectureIssues(
    result: ArchitectureAnalysisResult,
    generateId: () => string
  ): Issue[] {
    const issues: Issue[] = [];

    // Extract cycle issues
    for (const cycle of result.cycles) {
      issues.push({
        id: generateId(),
        category: 'architecture',
        severity: cycle.severity,
        title: `Circular dependency: ${cycle.modules.length} modules`,
        description: `Circular dependency detected between modules: ${cycle.modules.map((m) => m.split('/').pop()).join(' -> ')}`,
        affectedFiles: cycle.modules,
        evidence: [
          `Cycle length: ${cycle.length}`,
          cycle.suggestedBreakPoint ? `Suggested break point: ${cycle.suggestedBreakPoint}` : 'No break point suggested',
        ],
      });
    }

    // Extract layer violations
    for (const violation of result.layerViolations) {
      issues.push({
        id: generateId(),
        category: 'architecture',
        severity: violation.severity,
        title: `Layer violation: ${violation.type}`,
        description: violation.description,
        affectedFiles: violation.affectedEntities,
        evidence: [violation.suggestion],
      });
    }

    // Extract coupling issues
    if (result.couplingMetrics.highCouplingCount > 3) {
      issues.push({
        id: generateId(),
        category: 'architecture',
        severity: 'medium',
        title: `High coupling detected: ${result.couplingMetrics.highCouplingCount} modules`,
        description: `Multiple modules have high coupling. Average instability: ${result.couplingMetrics.averageInstability.toFixed(2)}`,
        affectedFiles: result.couplingMetrics.mostCoupled.slice(0, 5).map((m) => m.module),
        evidence: result.couplingMetrics.mostCoupled.slice(0, 3).map(
          (m) => `${m.module.split('/').pop()}: ${m.afferent} in, ${m.efferent} out`
        ),
      });
    }

    // Add suggestions as issues
    for (const suggestion of result.suggestions.filter((s) => s.priority >= 70)) {
      issues.push({
        id: generateId(),
        category: 'architecture',
        severity: suggestion.priority >= 90 ? 'high' : 'medium',
        title: suggestion.title,
        description: suggestion.description,
        affectedFiles: suggestion.affectedFiles,
        evidence: [`Priority: ${suggestion.priority}`, `Effort: ${suggestion.effort}`],
      });
    }

    return issues;
  }

  /**
   * Extract issues from consistency analysis result.
   */
  private extractConsistencyIssues(
    result: ConsistencyAnalysisResult,
    generateId: () => string
  ): Issue[] {
    const issues: Issue[] = [];

    // Extract code-test mismatches
    for (const mismatch of result.codeTestMismatches) {
      issues.push({
        id: generateId(),
        category: 'consistency',
        severity: mismatch.severity === 'error' ? 'high' : mismatch.severity === 'warning' ? 'medium' : 'low',
        title: `Code-test mismatch: ${mismatch.type}`,
        description: `${mismatch.claimed} does not match ${mismatch.actual}`,
        affectedFiles: [mismatch.location],
        evidence: [mismatch.suggestedResolution],
      });
    }

    // Extract doc mismatches
    for (const mismatch of result.codeDocMismatches) {
      issues.push({
        id: generateId(),
        category: 'consistency',
        severity: 'low',
        title: `Documentation mismatch: ${mismatch.type}`,
        description: `Documentation does not match code: ${mismatch.claimed} vs ${mismatch.actual}`,
        affectedFiles: [mismatch.location],
        evidence: [mismatch.suggestedResolution],
      });
    }

    // Extract untested claims (batch)
    if (result.untestedClaims.length > 5) {
      issues.push({
        id: generateId(),
        category: 'consistency',
        severity: 'medium',
        title: `${result.untestedClaims.length} untested claims`,
        description: `Multiple functions lack test coverage for their documented behavior.`,
        affectedFiles: result.untestedClaims.slice(0, 10).map((c) => c.entityPath),
        evidence: result.untestedClaims.slice(0, 5).map((c) => `${c.claim} (${c.entityPath})`),
      });
    }

    // Extract unreferenced code
    if (result.unreferencedCode.length > 0) {
      issues.push({
        id: generateId(),
        category: 'consistency',
        severity: result.unreferencedCode.length > 10 ? 'medium' : 'low',
        title: `${result.unreferencedCode.length} unreferenced code entities`,
        description: `Dead code detected that may be candidates for removal.`,
        affectedFiles: result.unreferencedCode.slice(0, 10),
        evidence: result.unreferencedCode.slice(0, 5),
      });
    }

    // Extract stale docs
    if (result.staleDocs.length > 0) {
      issues.push({
        id: generateId(),
        category: 'consistency',
        severity: 'low',
        title: `${result.staleDocs.length} stale documentation files`,
        description: `Documentation appears outdated and may need updating.`,
        affectedFiles: result.staleDocs.slice(0, 10),
        evidence: result.staleDocs.slice(0, 5),
      });
    }

    return issues;
  }

  /**
   * Extract issues from calibration verification result.
   */
  private extractCalibrationIssues(
    result: CalibrationVerificationResult,
    generateId: () => string
  ): Issue[] {
    const issues: Issue[] = [];

    // Check overall calibration
    if (!result.isWellCalibrated) {
      issues.push({
        id: generateId(),
        category: 'calibration',
        severity: result.ece > 0.15 ? 'high' : result.ece > 0.08 ? 'medium' : 'low',
        title: `Calibration issue: ECE = ${result.ece.toFixed(3)}`,
        description: `Confidence scores are miscalibrated. ${result.calibrationStatus}`,
        affectedFiles: [],
        evidence: [
          `ECE: ${result.ece.toFixed(3)}`,
          `MCE: ${result.mce.toFixed(3)}`,
          `Brier: ${result.brierScore.toFixed(3)}`,
          ...result.recommendations.slice(0, 3),
        ],
      });
    }

    // Check sample size
    if (result.sampleComplexityAnalysis.currentSampleSize < 50) {
      issues.push({
        id: generateId(),
        category: 'calibration',
        severity: 'low',
        title: `Insufficient calibration data: ${result.sampleComplexityAnalysis.currentSampleSize} samples`,
        description: `More data needed for reliable calibration assessment.`,
        affectedFiles: [],
        evidence: [
          `Current samples: ${result.sampleComplexityAnalysis.currentSampleSize}`,
          `Required for target precision: ${result.sampleComplexityAnalysis.requiredSamplesForEpsilon}`,
        ],
      });
    }

    return issues;
  }

  // ==========================================================================
  // RECOMMENDATION GENERATION
  // ==========================================================================

  /**
   * Generate recommendations for the given issues.
   *
   * @param issues - Issues to generate recommendations for
   * @returns Array of recommendations
   */
  generateRecommendations(issues: Issue[]): Recommendation[] {
    if (issues.length === 0) {
      return [];
    }

    const recommendations: Recommendation[] = [];

    for (const issue of issues) {
      const rec = this.generateRecommendationForIssue(issue);
      recommendations.push(rec);
    }

    return recommendations;
  }

  /**
   * Generate a recommendation for a single issue.
   */
  private generateRecommendationForIssue(issue: Issue): Recommendation {
    // Determine action based on category and issue content
    const { action, hints } = this.determineActionAndHints(issue);

    // Determine effort based on affected files and category
    const effort = this.estimateEffort(issue);

    // Determine impact based on severity and category
    const impact = this.estimateImpact(issue);

    // Calculate initial priority based on severity
    const basePriority = SEVERITY_SCORES[issue.severity];

    return {
      issueId: issue.id,
      action,
      effort,
      impact,
      priority: basePriority,
      implementationHints: hints,
    };
  }

  /**
   * Determine action and implementation hints for an issue.
   */
  private determineActionAndHints(issue: Issue): { action: string; hints: string[] } {
    switch (issue.category) {
      case 'architecture':
        return this.getArchitectureActionAndHints(issue);
      case 'consistency':
        return this.getConsistencyActionAndHints(issue);
      case 'calibration':
        return this.getCalibrationActionAndHints(issue);
      case 'coverage':
        return this.getCoverageActionAndHints(issue);
      case 'performance':
        return this.getPerformanceActionAndHints(issue);
      default:
        return {
          action: `Address: ${issue.title}`,
          hints: ['Review the issue details', 'Create a plan to address'],
        };
    }
  }

  private getArchitectureActionAndHints(issue: Issue): { action: string; hints: string[] } {
    if (issue.title.includes('Circular dependency')) {
      return {
        action: 'Break the circular dependency by extracting shared abstractions',
        hints: [
          'Identify the root cause of the cycle',
          'Extract shared interfaces to a common module',
          'Consider dependency injection to invert dependencies',
          'Use the suggested break point if available',
        ],
      };
    }
    if (issue.title.includes('Layer violation')) {
      return {
        action: 'Fix the layer violation by moving code to appropriate layer',
        hints: [
          'Higher layers should depend on lower layers only',
          'Extract interfaces for cross-layer communication',
          'Consider using events or callbacks for upward communication',
        ],
      };
    }
    if (issue.title.includes('coupling')) {
      return {
        action: 'Reduce coupling by introducing interfaces and facades',
        hints: [
          'Identify modules with highest coupling',
          'Extract common interfaces',
          'Consider using dependency injection',
          'Split large modules into smaller, focused ones',
        ],
      };
    }
    return {
      action: `Address architecture issue: ${issue.title}`,
      hints: ['Review affected modules', 'Plan refactoring approach', 'Test after changes'],
    };
  }

  private getConsistencyActionAndHints(issue: Issue): { action: string; hints: string[] } {
    if (issue.title.includes('untested')) {
      return {
        action: 'Add tests for untested functions',
        hints: [
          'Start with most critical functions',
          'Use TDD for new tests',
          'Focus on edge cases and error handling',
          'Aim for 80% coverage minimum',
        ],
      };
    }
    if (issue.title.includes('unreferenced')) {
      return {
        action: 'Review and remove dead code',
        hints: [
          'Verify code is truly unused',
          'Check for dynamic references',
          'Remove in small, tested commits',
          'Update documentation if needed',
        ],
      };
    }
    if (issue.title.includes('mismatch')) {
      return {
        action: 'Synchronize code and documentation',
        hints: [
          'Review both code and documentation',
          'Determine which is correct',
          'Update the incorrect artifact',
          'Add tests to prevent drift',
        ],
      };
    }
    return {
      action: `Fix consistency issue: ${issue.title}`,
      hints: ['Review affected files', 'Align code, tests, and docs'],
    };
  }

  private getCalibrationActionAndHints(issue: Issue): { action: string; hints: string[] } {
    if (issue.title.includes('ECE')) {
      return {
        action: 'Recalibrate confidence scores',
        hints: [
          'Analyze reliability diagram bins',
          'Adjust confidence estimates for overconfident ranges',
          'Consider implementing Platt scaling or isotonic regression',
          'Collect more calibration data',
        ],
      };
    }
    if (issue.title.includes('Insufficient')) {
      return {
        action: 'Collect more calibration data',
        hints: [
          'Log prediction outcomes',
          'Track confidence score accuracy',
          'Wait for more data before making calibration decisions',
        ],
      };
    }
    return {
      action: `Address calibration issue: ${issue.title}`,
      hints: ['Review calibration metrics', 'Adjust confidence estimation'],
    };
  }

  private getCoverageActionAndHints(issue: Issue): { action: string; hints: string[] } {
    return {
      action: 'Improve test coverage',
      hints: [
        'Add test files for modules without tests',
        'Focus on public API functions',
        'Test edge cases and error paths',
        'Use coverage tools to identify gaps',
      ],
    };
  }

  private getPerformanceActionAndHints(issue: Issue): { action: string; hints: string[] } {
    return {
      action: 'Optimize performance',
      hints: [
        'Profile to identify bottlenecks',
        'Consider caching strategies',
        'Optimize database queries',
        'Review algorithm complexity',
      ],
    };
  }

  /**
   * Estimate effort for addressing an issue.
   */
  private estimateEffort(issue: Issue): EffortLevel {
    const fileCount = issue.affectedFiles.length;

    // Category-based adjustments
    switch (issue.category) {
      case 'architecture':
        if (issue.title.includes('Circular') || issue.title.includes('coupling')) {
          return fileCount > 5 ? 'large' : 'medium';
        }
        return 'medium';

      case 'consistency':
        if (issue.title.includes('untested')) {
          return fileCount > 10 ? 'large' : 'medium';
        }
        return fileCount > 5 ? 'medium' : 'small';

      case 'calibration':
        return 'medium';

      case 'coverage':
        return fileCount > 10 ? 'large' : 'medium';

      case 'performance':
        return 'medium';

      default:
        return 'medium';
    }
  }

  /**
   * Estimate impact of addressing an issue.
   */
  private estimateImpact(issue: Issue): ImpactLevel {
    // Severity-based impact
    if (issue.severity === 'critical') return 'high';
    if (issue.severity === 'high') return 'high';
    if (issue.severity === 'medium') return 'medium';
    return 'low';
  }

  // ==========================================================================
  // PRIORITIZATION
  // ==========================================================================

  /**
   * Prioritize recommendations by impact and effort.
   *
   * Higher priority = higher impact + lower effort.
   *
   * @param recommendations - Recommendations to prioritize
   * @returns Sorted recommendations with updated priorities
   */
  prioritizeRecommendations(recommendations: Recommendation[]): Recommendation[] {
    // Calculate composite priority for each recommendation
    const prioritized = recommendations.map((rec) => {
      const effortScore = EFFORT_SCORES[rec.effort];
      const impactScore = IMPACT_SCORES[rec.impact];

      // Priority = base priority * impact * effort_multiplier
      const compositePriority = Math.round(
        rec.priority * 0.5 + // 50% from severity
        impactScore * 30 + // 30% from impact
        effortScore * 20 // 20% from effort (inverted - easier is better)
      );

      return {
        ...rec,
        priority: Math.min(100, Math.max(0, compositePriority)),
      };
    });

    // Sort by priority descending
    return prioritized.sort((a, b) => b.priority - a.priority);
  }

  // ==========================================================================
  // REPORT GENERATION
  // ==========================================================================

  /**
   * Generate a complete self-improvement report.
   *
   * @param rootDir - Root directory to analyze
   * @returns Complete report
   */
  async generateReport(rootDir: string): Promise<SelfImprovementReport> {
    const generatedAt = new Date();

    // Get version info
    let librarianVersion = '0.1.0';
    try {
      const version = await this.storage.getVersion();
      if (version) {
        librarianVersion = version.string;
      }
    } catch {
      // Use default version
    }

    // Analyze codebase
    const issues = await this.analyzeCodebase(rootDir);

    // Generate and prioritize recommendations
    const rawRecommendations = this.generateRecommendations(issues);
    const recommendations = this.prioritizeRecommendations(rawRecommendations);

    // Calculate health summary
    const healthSummary = await this.calculateHealthSummary(rootDir, issues);

    // Get analysis scope
    const analysisScope = await this.getAnalysisScope();

    // Generate next steps
    const nextSteps = this.generateNextSteps(issues, recommendations);

    return {
      generatedAt,
      librarianVersion,
      analysisScope,
      healthSummary,
      issues,
      recommendations,
      nextSteps,
    };
  }

  /**
   * Calculate health summary scores.
   */
  private async calculateHealthSummary(rootDir: string, issues: Issue[]): Promise<HealthSummary> {
    // Calculate scores based on issue categories
    const archIssues = issues.filter((i) => i.category === 'architecture');
    const consIssues = issues.filter((i) => i.category === 'consistency');
    const calIssues = issues.filter((i) => i.category === 'calibration');
    const covIssues = issues.filter((i) => i.category === 'coverage');

    // Penalty per issue based on severity
    const calculatePenalty = (categoryIssues: Issue[]): number => {
      let penalty = 0;
      for (const issue of categoryIssues) {
        switch (issue.severity) {
          case 'critical':
            penalty += 0.3;
            break;
          case 'high':
            penalty += 0.2;
            break;
          case 'medium':
            penalty += 0.1;
            break;
          case 'low':
            penalty += 0.05;
            break;
        }
      }
      return Math.min(1, penalty);
    };

    const archPenalty = calculatePenalty(archIssues);
    const consPenalty = calculatePenalty(consIssues);
    const calPenalty = calculatePenalty(calIssues);
    const covPenalty = calculatePenalty(covIssues);

    const consistencyScore = Math.max(0, 1 - consPenalty);
    const calibrationScore = Math.max(0, 1 - calPenalty);
    const coverageScore = Math.max(0, 1 - covPenalty);

    // Overall score is weighted average
    const overallScore = Math.max(0, Math.min(1,
      (1 - archPenalty) * 0.3 +
      consistencyScore * 0.3 +
      calibrationScore * 0.2 +
      coverageScore * 0.2
    ));

    return {
      overallScore,
      calibrationScore,
      consistencyScore,
      coverageScore,
    };
  }

  /**
   * Get analysis scope metrics.
   */
  private async getAnalysisScope(): Promise<AnalysisScope> {
    let filesAnalyzed = 0;
    let testsRun = 0;

    try {
      const modules = await this.storage.getModules();
      filesAnalyzed = modules.length;

      // Count test files
      testsRun = modules.filter((m) =>
        m.path.includes('.test.') ||
        m.path.includes('__tests__')
      ).length;
    } catch {
      // Use defaults
    }

    return {
      filesAnalyzed,
      testsRun,
      metricsCollected: [
        'architecture_violations',
        'consistency_score',
        'calibration_ece',
        'coverage_gaps',
        'coupling_metrics',
      ],
    };
  }

  /**
   * Generate next steps based on issues and recommendations.
   */
  private generateNextSteps(issues: Issue[], recommendations: Recommendation[]): string[] {
    const nextSteps: string[] = [];

    if (issues.length === 0) {
      nextSteps.push('No critical issues found. Continue monitoring for drift.');
      return nextSteps;
    }

    // Add step for top priority recommendations
    const topRecs = recommendations.slice(0, 3);
    for (const rec of topRecs) {
      nextSteps.push(`Priority ${rec.priority}: ${rec.action}`);
    }

    // Add category-specific next steps
    const hasArchIssues = issues.some((i) => i.category === 'architecture');
    const hasConsIssues = issues.some((i) => i.category === 'consistency');
    const hasCalIssues = issues.some((i) => i.category === 'calibration');

    if (hasArchIssues) {
      nextSteps.push('Review architecture violations and plan refactoring sprint');
    }
    if (hasConsIssues) {
      nextSteps.push('Improve test coverage and synchronize documentation');
    }
    if (hasCalIssues) {
      nextSteps.push('Collect more calibration data and adjust confidence estimation');
    }

    return nextSteps;
  }

  // ==========================================================================
  // EXPORT
  // ==========================================================================

  /**
   * Export report to specified format.
   *
   * @param report - Report to export
   * @param format - Export format ('json' or 'markdown')
   * @returns Formatted report string
   */
  exportReport(report: SelfImprovementReport, format: ReportFormat): string {
    switch (format) {
      case 'json':
        return this.exportAsJson(report);
      case 'markdown':
        return this.exportAsMarkdown(report);
      default:
        throw new Error(`Unsupported format: ${format}`);
    }
  }

  /**
   * Export report as JSON.
   */
  private exportAsJson(report: SelfImprovementReport): string {
    return JSON.stringify(report, null, 2);
  }

  /**
   * Export report as Markdown.
   */
  private exportAsMarkdown(report: SelfImprovementReport): string {
    const lines: string[] = [];

    // Header
    lines.push('# Self-Improvement Report');
    lines.push('');
    lines.push(`**Generated:** ${report.generatedAt.toISOString()}`);
    lines.push(`**Librarian Version:** ${report.librarianVersion}`);
    lines.push('');

    // Health Summary
    lines.push('## Health Summary');
    lines.push('');
    lines.push(`| Metric | Score |`);
    lines.push(`|--------|-------|`);
    lines.push(`| Overall | ${(report.healthSummary.overallScore * 100).toFixed(1)}% |`);
    lines.push(`| Calibration | ${(report.healthSummary.calibrationScore * 100).toFixed(1)}% |`);
    lines.push(`| Consistency | ${(report.healthSummary.consistencyScore * 100).toFixed(1)}% |`);
    lines.push(`| Coverage | ${(report.healthSummary.coverageScore * 100).toFixed(1)}% |`);
    lines.push('');

    // Analysis Scope
    lines.push('## Analysis Scope');
    lines.push('');
    lines.push(`- Files analyzed: ${report.analysisScope.filesAnalyzed}`);
    lines.push(`- Tests run: ${report.analysisScope.testsRun}`);
    lines.push(`- Metrics collected: ${report.analysisScope.metricsCollected.join(', ')}`);
    lines.push('');

    // Issues
    lines.push('## Issues');
    lines.push('');

    if (report.issues.length === 0) {
      lines.push('No issues found.');
    } else {
      // Group by category
      const categories = ['architecture', 'consistency', 'calibration', 'coverage', 'performance'] as const;
      for (const category of categories) {
        const categoryIssues = report.issues.filter((i) => i.category === category);
        if (categoryIssues.length > 0) {
          lines.push(`### ${category.charAt(0).toUpperCase() + category.slice(1)} Issues`);
          lines.push('');
          for (const issue of categoryIssues) {
            lines.push(`#### ${issue.severity.toUpperCase()}: ${issue.title}`);
            lines.push('');
            lines.push(issue.description);
            lines.push('');
            if (issue.affectedFiles.length > 0) {
              lines.push('**Affected files:**');
              for (const file of issue.affectedFiles.slice(0, 5)) {
                lines.push(`- ${file}`);
              }
              if (issue.affectedFiles.length > 5) {
                lines.push(`- ... and ${issue.affectedFiles.length - 5} more`);
              }
              lines.push('');
            }
            if (issue.evidence.length > 0) {
              lines.push('**Evidence:**');
              for (const ev of issue.evidence.slice(0, 3)) {
                lines.push(`- ${ev}`);
              }
              lines.push('');
            }
          }
        }
      }
    }

    // Recommendations
    lines.push('## Recommendations');
    lines.push('');

    if (report.recommendations.length === 0) {
      lines.push('No recommendations at this time.');
    } else {
      lines.push('| Priority | Action | Effort | Impact |');
      lines.push('|----------|--------|--------|--------|');
      for (const rec of report.recommendations.slice(0, 10)) {
        lines.push(`| ${rec.priority} | ${rec.action} | ${rec.effort} | ${rec.impact} |`);
      }
      if (report.recommendations.length > 10) {
        lines.push(`| ... | ${report.recommendations.length - 10} more recommendations | ... | ... |`);
      }
      lines.push('');

      // Top recommendations with hints
      lines.push('### Top Recommendations');
      lines.push('');
      for (const rec of report.recommendations.slice(0, 3)) {
        lines.push(`**${rec.action}**`);
        lines.push('');
        if (rec.implementationHints.length > 0) {
          for (const hint of rec.implementationHints) {
            lines.push(`- ${hint}`);
          }
        }
        lines.push('');
      }
    }

    // Next Steps
    lines.push('## Next Steps');
    lines.push('');
    if (report.nextSteps.length === 0) {
      lines.push('No specific next steps recommended.');
    } else {
      for (let i = 0; i < report.nextSteps.length; i++) {
        lines.push(`${i + 1}. ${report.nextSteps[i]}`);
      }
    }
    lines.push('');

    return lines.join('\n');
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a self-improvement report generator.
 *
 * @param storage - Storage instance to use
 * @returns New generator instance
 */
export function createSelfImprovementReportGenerator(
  storage: LibrarianStorage
): SelfImprovementReportGenerator {
  return new SelfImprovementReportGenerator(storage);
}
