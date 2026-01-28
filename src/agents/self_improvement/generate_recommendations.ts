/**
 * @fileoverview Recommendation Generation Primitive (tp_improve_generate_recommendations)
 *
 * Generate improvement recommendations from analysis results.
 * Prioritizes actions based on severity, effort, impact, and risk reduction.
 *
 * Based on self-improvement-primitives.md specification.
 */

import type {
  Recommendation,
  EffortEstimate,
  RecommendationCategory,
  RecommendationSeverity,
  ConfidenceValue,
} from './types.js';
import type { ArchitectureAnalysisResult, ViolationInfo, ArchitectureSuggestion } from './analyze_architecture.js';
import type { ConsistencyAnalysisResult, Mismatch, UntestedClaim, PhantomClaim } from './analyze_consistency.js';
import type { CalibrationVerificationResult } from './verify_calibration.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Prioritized action derived from a recommendation.
 */
export interface Action {
  /** Unique identifier */
  id: string;
  /** Action title */
  title: string;
  /** Action description */
  description: string;
  /** Priority score (0-1, higher = more important) */
  priority: number;
  /** Estimated effort */
  effort: EffortEstimate;
  /** Recommendation this action is derived from */
  recommendationId: string;
  /** Files to modify */
  affectedFiles: string[];
  /** Whether this action blocks other actions */
  isBlocking: boolean;
}

/**
 * Impact estimate for a set of recommendations.
 */
export interface ImpactEstimate {
  /** Expected improvement in code quality (0-1) */
  qualityImprovement: number;
  /** Expected reduction in technical debt (0-1) */
  debtReduction: number;
  /** Expected improvement in maintainability (0-1) */
  maintainabilityImprovement: number;
  /** Expected risk reduction (0-1) */
  riskReduction: number;
  /** Total estimated effort in hours */
  totalEffortHours: { min: number; max: number };
  /** Confidence in this estimate */
  confidence: ConfidenceValue;
}

/**
 * Improvement roadmap with phased recommendations.
 */
export interface ImprovementRoadmap {
  /** Phases of the improvement */
  phases: Array<{
    name: string;
    recommendations: string[];
    estimatedDuration: string;
    dependencies: string[];
  }>;
  /** Total estimated effort */
  totalEstimatedEffort: string;
  /** Critical path of recommendations */
  criticalPath: string[];
}

/**
 * Dependency between recommendations.
 */
export interface RecommendationDependency {
  /** Source recommendation ID */
  from: string;
  /** Target recommendation ID */
  to: string;
  /** Type of dependency */
  type: 'blocks' | 'enables' | 'conflicts_with' | 'related_to';
}

/**
 * Result of recommendation generation.
 */
export interface RecommendationResult {
  /** Generated recommendations */
  recommendations: Recommendation[];
  /** Prioritized actions */
  prioritizedActions: Action[];
  /** Estimated impact of all recommendations */
  estimatedImpact: ImpactEstimate;
  /** Improvement roadmap */
  roadmap: ImprovementRoadmap;
  /** Dependencies between recommendations */
  dependencies: RecommendationDependency[];
  /** Duration of generation in milliseconds */
  duration: number;
  /** Any errors encountered */
  errors: string[];
}

/**
 * Analysis results from various primitives.
 */
export interface AnalysisResults {
  /** Architecture analysis result */
  architecture?: ArchitectureAnalysisResult;
  /** Consistency analysis result */
  consistency?: ConsistencyAnalysisResult;
  /** Calibration verification result */
  calibration?: CalibrationVerificationResult;
}

/**
 * Weights for prioritization criteria.
 */
export interface PrioritizationWeights {
  /** Weight for severity */
  severity: number;
  /** Weight for effort (inverse - lower effort = higher priority) */
  effort: number;
  /** Weight for impact */
  impact: number;
  /** Weight for risk reduction */
  riskReduction: number;
}

/**
 * Options for recommendation generation.
 */
export interface GenerateRecommendationsOptions {
  /** Prioritization weights */
  weights?: PrioritizationWeights;
  /** Maximum recommendations to generate */
  maxRecommendations?: number;
  /** Minimum severity to include */
  minSeverity?: RecommendationSeverity;
  /** Categories to include */
  categories?: RecommendationCategory[];
  /** Enable verbose logging */
  verbose?: boolean;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_WEIGHTS: PrioritizationWeights = {
  severity: 0.4,
  effort: 0.2,
  impact: 0.3,
  riskReduction: 0.1,
};

const DEFAULT_MAX_RECOMMENDATIONS = 20;

const SEVERITY_SCORES: Record<RecommendationSeverity, number> = {
  critical: 1.0,
  high: 0.75,
  medium: 0.5,
  low: 0.25,
};

const EFFORT_COMPLEXITY_SCORES: Record<string, number> = {
  trivial: 1.0,
  simple: 0.8,
  moderate: 0.5,
  complex: 0.3,
  very_complex: 0.1,
};

// ============================================================================
// RECOMMENDATION GENERATION FROM ARCHITECTURE
// ============================================================================

/**
 * Generate recommendations from architecture analysis.
 */
function generateArchitectureRecommendations(
  architecture: ArchitectureAnalysisResult
): Recommendation[] {
  const recommendations: Recommendation[] = [];
  let idCounter = 0;

  // Convert violations to recommendations
  for (const violation of [...architecture.layerViolations, ...getViolationsFromCycles(architecture)]) {
    recommendations.push({
      id: `arch-${++idCounter}`,
      title: `Fix ${violation.type}: ${truncate(violation.description, 50)}`,
      description: violation.description,
      category: 'architecture',
      priority: severityToPriority(violation.severity),
      severity: violation.severity,
      effort: estimateEffort(violation.type, violation.affectedEntities.length),
      impact: violation.suggestion,
      affectedFiles: violation.affectedEntities,
      relatedIssues: [],
    });
  }

  // Convert suggestions to recommendations
  for (const suggestion of architecture.suggestions) {
    recommendations.push({
      id: `arch-${++idCounter}`,
      title: suggestion.title,
      description: suggestion.description,
      category: categoryFromSuggestion(suggestion.category),
      priority: suggestion.priority / 100,
      severity: priorityToSeverity(suggestion.priority / 100),
      effort: {
        loc: effortToLoc(suggestion.effort),
        hours: effortToHours(suggestion.effort),
        complexity: suggestion.effort,
        confidence: { score: 0.6, tier: 'medium', source: 'estimated' },
      },
      impact: 'Improves code architecture and maintainability',
      affectedFiles: suggestion.affectedFiles,
      relatedIssues: [],
    });
  }

  // Add coupling recommendations
  if (architecture.couplingMetrics.highCouplingCount > 3) {
    recommendations.push({
      id: `arch-${++idCounter}`,
      title: 'Reduce overall code coupling',
      description: `${architecture.couplingMetrics.highCouplingCount} modules have high coupling. Average instability: ${architecture.couplingMetrics.averageInstability.toFixed(2)}`,
      category: 'architecture',
      priority: 0.7,
      severity: 'medium',
      effort: {
        loc: { min: 100, max: 500 },
        hours: { min: 8, max: 40 },
        complexity: 'complex',
        confidence: { score: 0.5, tier: 'medium', source: 'estimated' },
      },
      impact: 'Reduces coupling and improves modularity',
      affectedFiles: architecture.couplingMetrics.mostCoupled.map((m) => m.module),
      relatedIssues: [],
    });
  }

  return recommendations;
}

/**
 * Extract violations from cycle information.
 */
function getViolationsFromCycles(architecture: ArchitectureAnalysisResult): ViolationInfo[] {
  return architecture.cycles.map((cycle) => ({
    type: 'circular_deps' as const,
    severity: cycle.severity,
    location: cycle.modules[0],
    description: `Circular dependency: ${cycle.modules.join(' -> ')}`,
    suggestion: cycle.suggestedBreakPoint
      ? `Break cycle at ${cycle.suggestedBreakPoint}`
      : 'Extract shared abstractions',
    affectedEntities: cycle.modules,
  }));
}

// ============================================================================
// RECOMMENDATION GENERATION FROM CONSISTENCY
// ============================================================================

/**
 * Generate recommendations from consistency analysis.
 */
function generateConsistencyRecommendations(
  consistency: ConsistencyAnalysisResult
): Recommendation[] {
  const recommendations: Recommendation[] = [];
  let idCounter = 0;

  // Convert mismatches to recommendations
  for (const mismatch of [...consistency.codeTestMismatches, ...consistency.codeDocMismatches]) {
    recommendations.push({
      id: `cons-${++idCounter}`,
      title: `Fix ${mismatch.type} mismatch`,
      description: `${mismatch.claimed} does not match ${mismatch.actual}`,
      category: 'correctness',
      priority: severityToNumeric(mismatch.severity),
      severity: mismatchSeverityToRecommendation(mismatch.severity),
      effort: {
        loc: { min: 5, max: 50 },
        hours: { min: 0.5, max: 2 },
        complexity: 'simple',
        confidence: { score: 0.7, tier: 'high', source: 'estimated' },
      },
      impact: mismatch.suggestedResolution,
      affectedFiles: [mismatch.location],
      relatedIssues: [],
    });
  }

  // Convert untested claims to recommendations
  if (consistency.untestedClaims.length > 5) {
    recommendations.push({
      id: `cons-${++idCounter}`,
      title: `Add tests for ${consistency.untestedClaims.length} untested claims`,
      description: `Multiple functions lack test coverage. Top priority: ${consistency.untestedClaims.slice(0, 3).map((c) => c.entityPath).join(', ')}`,
      category: 'correctness',
      priority: 0.8,
      severity: 'high',
      effort: {
        loc: { min: consistency.untestedClaims.length * 20, max: consistency.untestedClaims.length * 50 },
        hours: { min: consistency.untestedClaims.length * 0.5, max: consistency.untestedClaims.length * 2 },
        complexity: 'moderate',
        confidence: { score: 0.6, tier: 'medium', source: 'estimated' },
      },
      impact: 'Improves test coverage and claim verification',
      affectedFiles: consistency.untestedClaims.map((c) => c.entityPath),
      relatedIssues: [],
    });
  }

  // Handle unreferenced code
  if (consistency.unreferencedCode.length > 0) {
    recommendations.push({
      id: `cons-${++idCounter}`,
      title: `Review ${consistency.unreferencedCode.length} unreferenced code entities`,
      description: `Dead code detected: ${consistency.unreferencedCode.slice(0, 3).join(', ')}${consistency.unreferencedCode.length > 3 ? '...' : ''}`,
      category: 'maintainability',
      priority: 0.5,
      severity: 'medium',
      effort: {
        loc: { min: -50, max: -200 }, // Negative = removing code
        hours: { min: 1, max: 4 },
        complexity: 'simple',
        confidence: { score: 0.5, tier: 'medium', source: 'estimated' },
      },
      impact: 'Reduces codebase size and improves maintainability',
      affectedFiles: consistency.unreferencedCode,
      relatedIssues: [],
    });
  }

  // Handle stale docs
  if (consistency.staleDocs.length > 0) {
    recommendations.push({
      id: `cons-${++idCounter}`,
      title: `Update ${consistency.staleDocs.length} stale documentation files`,
      description: `Documentation appears outdated: ${consistency.staleDocs.slice(0, 3).join(', ')}`,
      category: 'maintainability',
      priority: 0.4,
      severity: 'low',
      effort: {
        loc: { min: 10, max: 100 },
        hours: { min: 1, max: 8 },
        complexity: 'simple',
        confidence: { score: 0.6, tier: 'medium', source: 'estimated' },
      },
      impact: 'Improves documentation accuracy',
      affectedFiles: consistency.staleDocs,
      relatedIssues: [],
    });
  }

  return recommendations;
}

// ============================================================================
// RECOMMENDATION GENERATION FROM CALIBRATION
// ============================================================================

/**
 * Generate recommendations from calibration verification.
 */
function generateCalibrationRecommendations(
  calibration: CalibrationVerificationResult
): Recommendation[] {
  const recommendations: Recommendation[] = [];
  let idCounter = 0;

  // Convert calibration recommendations to formal recommendations
  for (const rec of calibration.recommendations) {
    recommendations.push({
      id: `cal-${++idCounter}`,
      title: truncate(rec, 60),
      description: rec,
      category: 'theoretical',
      priority: calibration.isWellCalibrated ? 0.3 : 0.7,
      severity: calibration.isWellCalibrated ? 'low' : 'medium',
      effort: {
        loc: { min: 10, max: 100 },
        hours: { min: 1, max: 8 },
        complexity: 'moderate',
        confidence: { score: 0.5, tier: 'medium', source: 'estimated' },
      },
      impact: 'Improves confidence calibration accuracy',
      affectedFiles: [],
      relatedIssues: [],
    });
  }

  // Add overall calibration recommendation if miscalibrated
  if (!calibration.isWellCalibrated && calibration.ece > 0.1) {
    recommendations.push({
      id: `cal-${++idCounter}`,
      title: 'Implement calibration recalibration system',
      description: `ECE is ${calibration.ece.toFixed(3)}, significantly above target. Consider implementing Platt scaling or isotonic regression.`,
      category: 'theoretical',
      priority: 0.8,
      severity: 'high',
      effort: {
        loc: { min: 100, max: 300 },
        hours: { min: 8, max: 24 },
        complexity: 'complex',
        confidence: { score: 0.4, tier: 'low', source: 'estimated' },
      },
      impact: 'Significantly improves confidence calibration',
      affectedFiles: [],
      relatedIssues: [],
    });
  }

  return recommendations;
}

// ============================================================================
// PRIORITIZATION AND ACTIONS
// ============================================================================

/**
 * Prioritize recommendations based on weights.
 */
function prioritizeRecommendations(
  recommendations: Recommendation[],
  weights: PrioritizationWeights
): Recommendation[] {
  return recommendations
    .map((rec) => {
      // Calculate composite priority score
      const severityScore = SEVERITY_SCORES[rec.severity] ?? 0.5;
      const effortScore = EFFORT_COMPLEXITY_SCORES[rec.effort.complexity] ?? 0.5;
      const impactScore = rec.priority; // Already 0-1
      const riskScore = rec.severity === 'critical' ? 1.0 : rec.severity === 'high' ? 0.7 : 0.4;

      const compositeScore =
        severityScore * weights.severity +
        effortScore * weights.effort +
        impactScore * weights.impact +
        riskScore * weights.riskReduction;

      return {
        ...rec,
        priority: compositeScore,
      };
    })
    .sort((a, b) => b.priority - a.priority);
}

/**
 * Generate prioritized actions from recommendations.
 */
function generateActions(recommendations: Recommendation[]): Action[] {
  return recommendations.map((rec, index) => ({
    id: `action-${index + 1}`,
    title: rec.title,
    description: rec.description,
    priority: rec.priority,
    effort: rec.effort,
    recommendationId: rec.id,
    affectedFiles: rec.affectedFiles,
    isBlocking: rec.severity === 'critical' || rec.category === 'correctness',
  }));
}

/**
 * Generate dependencies between recommendations.
 */
function generateDependencies(recommendations: Recommendation[]): RecommendationDependency[] {
  const dependencies: RecommendationDependency[] = [];

  // Find recommendations that affect the same files
  for (let i = 0; i < recommendations.length; i++) {
    for (let j = i + 1; j < recommendations.length; j++) {
      const rec1 = recommendations[i];
      const rec2 = recommendations[j];

      // Check for file overlap
      const overlap = rec1.affectedFiles.filter((f) => rec2.affectedFiles.includes(f));
      if (overlap.length > 0) {
        // Higher priority blocks lower priority
        if (rec1.priority > rec2.priority) {
          dependencies.push({
            from: rec1.id,
            to: rec2.id,
            type: 'blocks',
          });
        } else {
          dependencies.push({
            from: rec2.id,
            to: rec1.id,
            type: 'blocks',
          });
        }
      }

      // Architecture before consistency
      if (rec1.category === 'architecture' && rec2.category === 'correctness') {
        dependencies.push({
          from: rec1.id,
          to: rec2.id,
          type: 'enables',
        });
      }
    }
  }

  return dependencies;
}

// ============================================================================
// IMPACT ESTIMATION
// ============================================================================

/**
 * Estimate overall impact of recommendations.
 */
function estimateImpact(recommendations: Recommendation[]): ImpactEstimate {
  if (recommendations.length === 0) {
    return {
      qualityImprovement: 0,
      debtReduction: 0,
      maintainabilityImprovement: 0,
      riskReduction: 0,
      totalEffortHours: { min: 0, max: 0 },
      confidence: { score: 0, tier: 'uncertain', source: 'default' },
    };
  }

  // Calculate category-based improvements
  const archRecs = recommendations.filter((r) => r.category === 'architecture');
  const correctnessRecs = recommendations.filter((r) => r.category === 'correctness');
  const maintRecs = recommendations.filter((r) => r.category === 'maintainability');
  const criticalRecs = recommendations.filter((r) => r.severity === 'critical' || r.severity === 'high');

  const qualityImprovement = Math.min(1, (correctnessRecs.length * 0.1) + (criticalRecs.length * 0.15));
  const debtReduction = Math.min(1, (archRecs.length * 0.1) + (maintRecs.length * 0.05));
  const maintainabilityImprovement = Math.min(1, (maintRecs.length * 0.1) + (archRecs.length * 0.08));
  const riskReduction = Math.min(1, (criticalRecs.length * 0.2) + (correctnessRecs.length * 0.1));

  // Calculate total effort
  const totalEffortHours = recommendations.reduce(
    (acc, rec) => ({
      min: acc.min + rec.effort.hours.min,
      max: acc.max + rec.effort.hours.max,
    }),
    { min: 0, max: 0 }
  );

  return {
    qualityImprovement,
    debtReduction,
    maintainabilityImprovement,
    riskReduction,
    totalEffortHours,
    confidence: {
      score: 0.6,
      tier: 'medium',
      source: 'estimated',
      sampleSize: recommendations.length,
    },
  };
}

// ============================================================================
// ROADMAP GENERATION
// ============================================================================

/**
 * Generate improvement roadmap.
 */
function generateRoadmap(
  recommendations: Recommendation[],
  dependencies: RecommendationDependency[]
): ImprovementRoadmap {
  // Group recommendations into phases
  const critical = recommendations.filter((r) => r.severity === 'critical');
  const high = recommendations.filter((r) => r.severity === 'high' && !critical.includes(r));
  const medium = recommendations.filter((r) => r.severity === 'medium');
  const low = recommendations.filter((r) => r.severity === 'low');

  const phases = [];

  if (critical.length > 0) {
    phases.push({
      name: 'Phase 1: Critical Fixes',
      recommendations: critical.map((r) => r.id),
      estimatedDuration: `${Math.ceil(critical.reduce((sum, r) => sum + r.effort.hours.max, 0) / 8)} days`,
      dependencies: [],
    });
  }

  if (high.length > 0) {
    phases.push({
      name: 'Phase 2: High Priority Improvements',
      recommendations: high.map((r) => r.id),
      estimatedDuration: `${Math.ceil(high.reduce((sum, r) => sum + r.effort.hours.max, 0) / 8)} days`,
      dependencies: critical.length > 0 ? ['Phase 1: Critical Fixes'] : [],
    });
  }

  if (medium.length > 0) {
    phases.push({
      name: 'Phase 3: Medium Priority Improvements',
      recommendations: medium.map((r) => r.id),
      estimatedDuration: `${Math.ceil(medium.reduce((sum, r) => sum + r.effort.hours.max, 0) / 8)} days`,
      dependencies: high.length > 0 ? ['Phase 2: High Priority Improvements'] : critical.length > 0 ? ['Phase 1: Critical Fixes'] : [],
    });
  }

  if (low.length > 0) {
    phases.push({
      name: 'Phase 4: Low Priority Improvements',
      recommendations: low.map((r) => r.id),
      estimatedDuration: `${Math.ceil(low.reduce((sum, r) => sum + r.effort.hours.max, 0) / 8)} days`,
      dependencies: medium.length > 0 ? ['Phase 3: Medium Priority Improvements'] : [],
    });
  }

  // Calculate total effort
  const totalHours = recommendations.reduce((sum, r) => sum + r.effort.hours.max, 0);
  const totalDays = Math.ceil(totalHours / 8);

  // Critical path is the critical and high priority items
  const criticalPath = [...critical, ...high].map((r) => r.id);

  return {
    phases,
    totalEstimatedEffort: `${totalDays} days (${totalHours} hours)`,
    criticalPath,
  };
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
}

function severityToPriority(severity: 'critical' | 'high' | 'medium' | 'low'): number {
  return SEVERITY_SCORES[severity];
}

function priorityToSeverity(priority: number): RecommendationSeverity {
  if (priority >= 0.9) return 'critical';
  if (priority >= 0.7) return 'high';
  if (priority >= 0.4) return 'medium';
  return 'low';
}

function severityToNumeric(severity: 'error' | 'warning' | 'info'): number {
  switch (severity) {
    case 'error': return 0.9;
    case 'warning': return 0.6;
    case 'info': return 0.3;
  }
}

function mismatchSeverityToRecommendation(severity: 'error' | 'warning' | 'info'): RecommendationSeverity {
  switch (severity) {
    case 'error': return 'high';
    case 'warning': return 'medium';
    case 'info': return 'low';
  }
}

function categoryFromSuggestion(category: string): RecommendationCategory {
  switch (category) {
    case 'refactoring':
    case 'decoupling':
    case 'layering':
      return 'architecture';
    case 'cleanup':
      return 'maintainability';
    default:
      return 'architecture';
  }
}

function estimateEffort(violationType: string, entityCount: number): EffortEstimate {
  const baseHours = violationType === 'circular_deps' ? 4 : 2;
  const scaledHours = baseHours * Math.max(1, Math.log2(entityCount + 1));

  return {
    loc: { min: entityCount * 10, max: entityCount * 50 },
    hours: { min: scaledHours, max: scaledHours * 2 },
    complexity: entityCount > 5 ? 'complex' : entityCount > 2 ? 'moderate' : 'simple',
    confidence: { score: 0.5, tier: 'medium', source: 'estimated' },
  };
}

function effortToLoc(effort: 'trivial' | 'simple' | 'moderate' | 'complex'): { min: number; max: number } {
  switch (effort) {
    case 'trivial': return { min: 1, max: 10 };
    case 'simple': return { min: 10, max: 50 };
    case 'moderate': return { min: 50, max: 200 };
    case 'complex': return { min: 200, max: 500 };
  }
}

function effortToHours(effort: 'trivial' | 'simple' | 'moderate' | 'complex'): { min: number; max: number } {
  switch (effort) {
    case 'trivial': return { min: 0.25, max: 1 };
    case 'simple': return { min: 1, max: 4 };
    case 'moderate': return { min: 4, max: 16 };
    case 'complex': return { min: 16, max: 40 };
  }
}

// ============================================================================
// MAIN GENERATION FUNCTION
// ============================================================================

/**
 * Generate improvement recommendations from analysis results.
 *
 * This function:
 * 1. Collects recommendations from all analysis types
 * 2. Prioritizes based on severity, effort, and impact
 * 3. Generates actionable steps
 * 4. Estimates overall impact
 * 5. Creates an improvement roadmap
 *
 * @param analysisResults - Results from various analysis primitives
 * @param options - Generation options
 * @returns Recommendation result with prioritized actions
 *
 * @example
 * ```typescript
 * const result = await generateRecommendations({
 *   architecture: archResult,
 *   consistency: consResult,
 * });
 * console.log(`Generated ${result.recommendations.length} recommendations`);
 * ```
 */
export async function generateRecommendations(
  analysisResults: AnalysisResults,
  options: GenerateRecommendationsOptions = {}
): Promise<RecommendationResult> {
  const startTime = Date.now();
  const errors: string[] = [];

  const {
    weights = DEFAULT_WEIGHTS,
    maxRecommendations = DEFAULT_MAX_RECOMMENDATIONS,
    minSeverity,
    categories,
    verbose = false,
  } = options;

  if (verbose) {
    console.log(`[generateRecommendations] Starting recommendation generation`);
  }

  // Collect recommendations from all sources
  let allRecommendations: Recommendation[] = [];

  if (analysisResults.architecture) {
    try {
      const archRecs = generateArchitectureRecommendations(analysisResults.architecture);
      allRecommendations.push(...archRecs);
      if (verbose) {
        console.log(`[generateRecommendations] Generated ${archRecs.length} architecture recommendations`);
      }
    } catch (error) {
      errors.push(`Architecture recommendations failed: ${error}`);
    }
  }

  if (analysisResults.consistency) {
    try {
      const consRecs = generateConsistencyRecommendations(analysisResults.consistency);
      allRecommendations.push(...consRecs);
      if (verbose) {
        console.log(`[generateRecommendations] Generated ${consRecs.length} consistency recommendations`);
      }
    } catch (error) {
      errors.push(`Consistency recommendations failed: ${error}`);
    }
  }

  if (analysisResults.calibration) {
    try {
      const calRecs = generateCalibrationRecommendations(analysisResults.calibration);
      allRecommendations.push(...calRecs);
      if (verbose) {
        console.log(`[generateRecommendations] Generated ${calRecs.length} calibration recommendations`);
      }
    } catch (error) {
      errors.push(`Calibration recommendations failed: ${error}`);
    }
  }

  // Filter by category if specified
  if (categories && categories.length > 0) {
    allRecommendations = allRecommendations.filter((r) => categories.includes(r.category));
  }

  // Filter by minimum severity if specified
  if (minSeverity) {
    const severityOrder: RecommendationSeverity[] = ['critical', 'high', 'medium', 'low'];
    const minIndex = severityOrder.indexOf(minSeverity);
    allRecommendations = allRecommendations.filter((r) => {
      const index = severityOrder.indexOf(r.severity);
      return index <= minIndex;
    });
  }

  // Prioritize recommendations
  const prioritized = prioritizeRecommendations(allRecommendations, weights);

  // Limit to max recommendations
  const recommendations = prioritized.slice(0, maxRecommendations);

  // Generate actions
  const prioritizedActions = generateActions(recommendations);

  // Generate dependencies
  const dependencies = generateDependencies(recommendations);

  // Estimate impact
  const estimatedImpact = estimateImpact(recommendations);

  // Generate roadmap
  const roadmap = generateRoadmap(recommendations, dependencies);

  if (verbose) {
    console.log(`[generateRecommendations] Generated ${recommendations.length} total recommendations`);
  }

  return {
    recommendations,
    prioritizedActions,
    estimatedImpact,
    roadmap,
    dependencies,
    duration: Date.now() - startTime,
    errors,
  };
}

/**
 * Create a recommendation generation primitive with bound options.
 */
export function createGenerateRecommendations(
  defaultOptions: Partial<GenerateRecommendationsOptions>
): (analysisResults: AnalysisResults, options?: Partial<GenerateRecommendationsOptions>) => Promise<RecommendationResult> {
  return async (analysisResults, options = {}) => {
    return generateRecommendations(analysisResults, {
      ...defaultOptions,
      ...options,
    });
  };
}
