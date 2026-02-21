/**
 * @fileoverview Technical Debt Analysis and Prediction
 *
 * Aggregates multiple signals to compute technical debt metrics.
 * Uses Bayesian confidence tracking for uncertainty quantification.
 *
 * Debt categories (based on 2025-2026 research):
 * - Complexity: Cyclomatic/cognitive complexity above thresholds
 * - Duplication: From clone analysis
 * - Coupling: High instability + high concreteness (zone of pain)
 * - Coverage: Low test coverage
 * - Architecture: Layer violations, circular dependencies
 * - Churn: High change frequency + low stability
 * - Documentation: Missing/stale documentation
 * - Security: Unpatched vulnerabilities, unsafe patterns
 *
 * Research basis:
 * - Social Network Analysis metrics improve prediction
 * - Code churn at ~7% correlates with defect density
 * - Design flaws + code churn predict vulnerabilities
 */

import { createHash, randomUUID } from 'crypto';
import type {
  LiBrainianStorage,
  DebtMetrics,
  DebtHotspot,
  FunctionKnowledge,
  FileKnowledge,
  CloneEntry,
  SCCEntry,
  BayesianConfidence,
} from '../storage/types.js';

// ============================================================================
// TYPES
// ============================================================================

export interface DebtAnalysisOptions {
  storage: LiBrainianStorage;
  entityType?: DebtMetrics['entityType'];
  forceRecalculate?: boolean;
  includeRecommendations?: boolean;
}

export interface DebtAnalysisResult {
  entitiesAnalyzed: number;
  metricsComputed: number;
  hotspotCount: number;
  avgDebt: number;
  maxDebt: number;
  errors: string[];
  durationMs: number;
}

export interface DebtSignals {
  complexity: { score: number; details: string[] };
  duplication: { score: number; details: string[] };
  coupling: { score: number; details: string[] };
  coverage: { score: number; details: string[] };
  architecture: { score: number; details: string[] };
  churn: { score: number; details: string[] };
  documentation: { score: number; details: string[] };
  security: { score: number; details: string[] };
}

// ============================================================================
// THRESHOLDS AND WEIGHTS
// ============================================================================

/**
 * Complexity thresholds based on industry standards.
 */
export const COMPLEXITY_THRESHOLDS = {
  cyclomatic: {
    low: 5,
    medium: 10,
    high: 20,
    critical: 50,
  },
  cognitive: {
    low: 8,
    medium: 15,
    high: 30,
    critical: 60,
  },
  lines: {
    low: 50,
    medium: 150,
    high: 300,
    critical: 500,
  },
};

/**
 * Weights for combining debt signals.
 */
export const DEBT_WEIGHTS = {
  complexity: 0.15,
  duplication: 0.15,
  coupling: 0.15,
  coverage: 0.15,
  architecture: 0.15,
  churn: 0.10,
  documentation: 0.05,
  security: 0.10,
};

/**
 * Priority thresholds for total debt score.
 */
export const PRIORITY_THRESHOLDS = {
  critical: 80,
  high: 60,
  medium: 40,
  low: 0,
};

// ============================================================================
// SIGNAL CALCULATORS
// ============================================================================

/**
 * Calculate complexity debt for a function.
 */
export function calculateComplexityDebt(
  lineCount: number,
  functionCount: number,
  cyclomaticComplexity?: number,
  cognitiveComplexity?: string
): { score: number; details: string[] } {
  const details: string[] = [];
  let score = 0;

  // Line count analysis
  const avgLinesPerFunction = functionCount > 0 ? lineCount / functionCount : lineCount;
  if (avgLinesPerFunction > COMPLEXITY_THRESHOLDS.lines.critical) {
    score += 30;
    details.push(`Very high average function size (${avgLinesPerFunction.toFixed(0)} lines)`);
  } else if (avgLinesPerFunction > COMPLEXITY_THRESHOLDS.lines.high) {
    score += 20;
    details.push(`High average function size (${avgLinesPerFunction.toFixed(0)} lines)`);
  } else if (avgLinesPerFunction > COMPLEXITY_THRESHOLDS.lines.medium) {
    score += 10;
    details.push(`Moderate average function size (${avgLinesPerFunction.toFixed(0)} lines)`);
  }

  // Cyclomatic complexity
  if (cyclomaticComplexity !== undefined) {
    if (cyclomaticComplexity > COMPLEXITY_THRESHOLDS.cyclomatic.critical) {
      score += 35;
      details.push(`Critical cyclomatic complexity (${cyclomaticComplexity})`);
    } else if (cyclomaticComplexity > COMPLEXITY_THRESHOLDS.cyclomatic.high) {
      score += 25;
      details.push(`High cyclomatic complexity (${cyclomaticComplexity})`);
    } else if (cyclomaticComplexity > COMPLEXITY_THRESHOLDS.cyclomatic.medium) {
      score += 15;
      details.push(`Moderate cyclomatic complexity (${cyclomaticComplexity})`);
    }
  }

  // Parse and analyze cognitive complexity
  if (cognitiveComplexity && cognitiveComplexity !== 'unknown') {
    const cognitive = parseInt(cognitiveComplexity, 10);
    if (!isNaN(cognitive)) {
      if (cognitive > COMPLEXITY_THRESHOLDS.cognitive.critical) {
        score += 35;
        details.push(`Critical cognitive complexity (${cognitive})`);
      } else if (cognitive > COMPLEXITY_THRESHOLDS.cognitive.high) {
        score += 25;
        details.push(`High cognitive complexity (${cognitive})`);
      } else if (cognitive > COMPLEXITY_THRESHOLDS.cognitive.medium) {
        score += 15;
        details.push(`Moderate cognitive complexity (${cognitive})`);
      }
    }
  }

  return { score: Math.min(100, score), details };
}

/**
 * Calculate duplication debt from clone data.
 */
export async function calculateDuplicationDebt(
  storage: LiBrainianStorage,
  entityId: string
): Promise<{ score: number; details: string[] }> {
  const details: string[] = [];
  let score = 0;

  const clones = await storage.getClonesByEntity(entityId);

  if (clones.length === 0) {
    return { score: 0, details: ['No code clones detected'] };
  }

  // Count by type
  const typeCounts: Record<CloneEntry['cloneType'], number> = {
    exact: 0, type1: 0, type2: 0, type3: 0, semantic: 0,
  };

  let totalSharedLines = 0;
  let maxSimilarity = 0;

  for (const clone of clones) {
    typeCounts[clone.cloneType]++;
    totalSharedLines += clone.sharedLines || 0;
    maxSimilarity = Math.max(maxSimilarity, clone.similarity);
  }

  // Exact and Type-1 clones are most concerning
  if (typeCounts.exact > 0 || typeCounts.type1 > 0) {
    score += 40;
    details.push(`${typeCounts.exact + typeCounts.type1} exact/near-exact clones`);
  }

  // Type-2 clones indicate refactoring opportunity
  if (typeCounts.type2 > 0) {
    score += 25;
    details.push(`${typeCounts.type2} renamed clones (refactoring opportunity)`);
  }

  // Type-3 clones
  if (typeCounts.type3 > 0) {
    score += 15;
    details.push(`${typeCounts.type3} similar clones`);
  }

  // Semantic clones
  if (typeCounts.semantic > 0) {
    score += 10;
    details.push(`${typeCounts.semantic} semantic clones`);
  }

  // Adjust for volume
  if (totalSharedLines > 200) {
    score += 10;
    details.push(`${totalSharedLines} total duplicated lines`);
  }

  return { score: Math.min(100, score), details };
}

/**
 * Calculate coupling debt from graph metrics.
 */
export async function calculateCouplingDebt(
  storage: LiBrainianStorage,
  entityId: string
): Promise<{ score: number; details: string[] }> {
  const details: string[] = [];
  let score = 0;

  // Get graph edges for this entity
  const outgoingEdges = await storage.getGraphEdges({ fromIds: [entityId] });
  const incomingEdges = await storage.getGraphEdges({ toIds: [entityId] });

  const afferentCoupling = incomingEdges.length;  // Incoming dependencies
  const efferentCoupling = outgoingEdges.length;  // Outgoing dependencies
  const totalCoupling = afferentCoupling + efferentCoupling;

  // Calculate instability: I = Ce / (Ca + Ce)
  const instability = totalCoupling > 0 ? efferentCoupling / totalCoupling : 0;

  // High efferent coupling = many dependencies
  if (efferentCoupling > 20) {
    score += 30;
    details.push(`High efferent coupling (${efferentCoupling} dependencies)`);
  } else if (efferentCoupling > 10) {
    score += 15;
    details.push(`Moderate efferent coupling (${efferentCoupling} dependencies)`);
  }

  // Instability in the "zone of pain" (low instability + high coupling)
  if (instability < 0.3 && afferentCoupling > 10) {
    score += 25;
    details.push('In zone of pain: low instability with many dependents');
  }

  // Very high instability (fragile)
  if (instability > 0.8 && efferentCoupling > 5) {
    score += 20;
    details.push(`High instability (${(instability * 100).toFixed(0)}%): fragile component`);
  }

  return { score: Math.min(100, score), details };
}

/**
 * Calculate architecture debt from SCC analysis.
 */
export async function calculateArchitectureDebt(
  storage: LiBrainianStorage,
  entityId: string
): Promise<{ score: number; details: string[] }> {
  const details: string[] = [];
  let score = 0;

  // Check for circular dependencies (SCC membership)
  const scc = await storage.getSCCByEntity(entityId, 'function');

  if (scc && scc.componentSize > 1) {
    // Part of a circular dependency cycle
    score += 40;
    details.push(`Part of circular dependency (${scc.componentSize} entities in cycle)`);

    if (scc.isRoot) {
      score += 10;
      details.push('Root of circular dependency cycle');
    }
  }

  // Check for feedback loops
  const feedbackLoops = await storage.getFeedbackLoops({ unresolvedOnly: true });
  const relevantLoops = feedbackLoops.filter(loop => loop.entities.includes(entityId));

  if (relevantLoops.length > 0) {
    for (const loop of relevantLoops) {
      switch (loop.severity) {
        case 'critical':
          score += 30;
          break;
        case 'high':
          score += 20;
          break;
        case 'medium':
          score += 10;
          break;
        case 'low':
          score += 5;
          break;
      }
      details.push(`${loop.loopType} feedback loop (${loop.severity})`);
    }
  }

  return { score: Math.min(100, score), details };
}

/**
 * Calculate churn debt from diff history.
 */
export async function calculateChurnDebt(
  storage: LiBrainianStorage,
  filePath: string
): Promise<{ score: number; details: string[] }> {
  const details: string[] = [];
  let score = 0;

  // Get diff records for the file
  const diffs = await storage.getDiffRecords({ filePath, limit: 100 });

  if (diffs.length === 0) {
    return { score: 0, details: ['No change history available'] };
  }

  // Calculate change frequency
  const uniqueCommits = new Set(diffs.map(d => d.commitHash));
  const changeCount = uniqueCommits.size;

  // Calculate average complexity of changes
  const avgComplexity = diffs.reduce((sum, d) => sum + d.complexity, 0) / diffs.length;

  // High change frequency
  if (changeCount > 50) {
    score += 30;
    details.push(`Very high change frequency (${changeCount} commits)`);
  } else if (changeCount > 20) {
    score += 20;
    details.push(`High change frequency (${changeCount} commits)`);
  } else if (changeCount > 10) {
    score += 10;
    details.push(`Moderate change frequency (${changeCount} commits)`);
  }

  // High change complexity
  if (avgComplexity > 0.7) {
    score += 25;
    details.push(`Complex changes (avg complexity: ${(avgComplexity * 100).toFixed(0)}%)`);
  } else if (avgComplexity > 0.5) {
    score += 15;
    details.push(`Moderately complex changes (avg complexity: ${(avgComplexity * 100).toFixed(0)}%)`);
  }

  // Check for many structural changes
  const structuralChanges = diffs.filter(d => d.changeCategory === 'structural');
  if (structuralChanges.length > changeCount * 0.3) {
    score += 15;
    details.push(`High structural change ratio (${((structuralChanges.length / changeCount) * 100).toFixed(0)}%)`);
  }

  return { score: Math.min(100, score), details };
}

/**
 * Calculate coverage debt.
 */
export function calculateCoverageDebt(
  coverage?: number,
  hasTests?: boolean
): { score: number; details: string[] } {
  const details: string[] = [];
  let score = 0;

  if (!hasTests) {
    score += 50;
    details.push('No associated tests found');
    return { score, details };
  }

  if (coverage === undefined) {
    score += 25;
    details.push('Test coverage unknown');
    return { score, details };
  }

  if (coverage < 0.2) {
    score += 50;
    details.push(`Critical low coverage (${(coverage * 100).toFixed(0)}%)`);
  } else if (coverage < 0.4) {
    score += 35;
    details.push(`Low coverage (${(coverage * 100).toFixed(0)}%)`);
  } else if (coverage < 0.6) {
    score += 20;
    details.push(`Moderate coverage (${(coverage * 100).toFixed(0)}%)`);
  } else if (coverage < 0.8) {
    score += 10;
    details.push(`Acceptable coverage (${(coverage * 100).toFixed(0)}%)`);
  } else {
    details.push(`Good coverage (${(coverage * 100).toFixed(0)}%)`);
  }

  return { score: Math.min(100, score), details };
}

/**
 * Calculate documentation debt.
 */
export function calculateDocumentationDebt(
  purpose?: string,
  summary?: string
): { score: number; details: string[] } {
  const details: string[] = [];
  let score = 0;

  if (!purpose || purpose.length < 10) {
    score += 30;
    details.push('Missing or inadequate purpose documentation');
  }

  if (!summary || summary.length < 20) {
    score += 20;
    details.push('Missing or inadequate summary');
  }

  if (score === 0) {
    details.push('Documentation appears adequate');
  }

  return { score: Math.min(100, score), details };
}

/**
 * Calculate security debt.
 */
export function calculateSecurityDebt(
  riskScore?: number
): { score: number; details: string[] } {
  const details: string[] = [];
  let score = 0;

  if (riskScore === undefined) {
    return { score: 0, details: ['Security analysis not available'] };
  }

  // Risk score is typically 0-100
  if (riskScore > 80) {
    score += 50;
    details.push(`Critical security risk (${riskScore})`);
  } else if (riskScore > 60) {
    score += 35;
    details.push(`High security risk (${riskScore})`);
  } else if (riskScore > 40) {
    score += 20;
    details.push(`Moderate security risk (${riskScore})`);
  } else if (riskScore > 20) {
    score += 10;
    details.push(`Low security risk (${riskScore})`);
  } else {
    details.push(`Minimal security risk (${riskScore})`);
  }

  return { score: Math.min(100, score), details };
}

// ============================================================================
// DEBT AGGREGATION
// ============================================================================

/**
 * Aggregate all debt signals into a total debt score.
 */
export function aggregateDebt(signals: DebtSignals): {
  totalDebt: number;
  priority: DebtMetrics['priority'];
  recommendations: string[];
} {
  let totalDebt = 0;
  const recommendations: string[] = [];

  // Weighted sum
  for (const [category, weight] of Object.entries(DEBT_WEIGHTS)) {
    const signal = signals[category as keyof DebtSignals];
    totalDebt += signal.score * weight;

    // Generate recommendations for high-scoring categories
    if (signal.score > 50) {
      recommendations.push(`[${category.toUpperCase()}] ${signal.details[0] || 'Needs attention'}`);
    }
  }

  totalDebt = Math.min(100, totalDebt);

  // Determine priority
  let priority: DebtMetrics['priority'];
  if (totalDebt >= PRIORITY_THRESHOLDS.critical) {
    priority = 'critical';
  } else if (totalDebt >= PRIORITY_THRESHOLDS.high) {
    priority = 'high';
  } else if (totalDebt >= PRIORITY_THRESHOLDS.medium) {
    priority = 'medium';
  } else {
    priority = 'low';
  }

  return { totalDebt, priority, recommendations };
}

/**
 * Estimate fix hours based on debt characteristics.
 */
export function estimateFixHours(signals: DebtSignals, totalDebt: number): number {
  // Base estimate from total debt
  let hours = totalDebt / 10;

  // Add extra time for specific issues
  if (signals.architecture.score > 50) hours += 8;  // Architecture issues take time
  if (signals.complexity.score > 70) hours += 4;    // High complexity
  if (signals.duplication.score > 50) hours += 2;   // Deduplication
  if (signals.security.score > 50) hours += 6;      // Security fixes

  return Math.round(hours * 10) / 10;
}

// ============================================================================
// MAIN ANALYSIS
// ============================================================================

/**
 * Analyze technical debt for entities in the codebase.
 */
export async function analyzeDebt(options: DebtAnalysisOptions): Promise<DebtAnalysisResult> {
  const startTime = Date.now();
  const {
    storage,
    entityType = 'file',
    includeRecommendations = true,
  } = options;

  const result: DebtAnalysisResult = {
    entitiesAnalyzed: 0,
    metricsComputed: 0,
    hotspotCount: 0,
    avgDebt: 0,
    maxDebt: 0,
    errors: [],
    durationMs: 0,
  };

  try {
    // Get entities to analyze based on type
    let entities: Array<{ id: string; path: string; data: Partial<FileKnowledge> }> = [];

    if (entityType === 'file') {
      const files = await storage.getFiles({ limit: 1000 });
      entities = files.map(f => ({
        id: f.id,
        path: f.path,
        data: f,
      }));
    } else if (entityType === 'function') {
      const functions = await storage.getFunctions({ limit: 5000 });
      entities = functions.map(f => ({
        id: f.id,
        path: f.filePath,
        data: {
          lineCount: f.endLine - f.startLine + 1,
          functionCount: 1,
          purpose: f.purpose,
        } as Partial<FileKnowledge>,
      }));
    }

    result.entitiesAnalyzed = entities.length;

    const debtMetricsList: DebtMetrics[] = [];
    let totalDebtSum = 0;

    for (const entity of entities) {
      try {
        // Calculate all debt signals
        const complexity = calculateComplexityDebt(
          entity.data.lineCount || 0,
          entity.data.functionCount || 1,
          entity.data.testCoverage ? undefined : undefined, // Would need actual cyclomatic
          undefined
        );

        const duplication = await calculateDuplicationDebt(storage, entity.id);
        const coupling = await calculateCouplingDebt(storage, entity.id);
        const architecture = await calculateArchitectureDebt(storage, entity.id);
        const churn = await calculateChurnDebt(storage, entity.path);
        const coverage = calculateCoverageDebt(entity.data.testCoverage, entity.data.hasTests);
        const documentation = calculateDocumentationDebt(entity.data.purpose, entity.data.summary);
        const security = calculateSecurityDebt(undefined); // Would need risk score

        const signals: DebtSignals = {
          complexity,
          duplication,
          coupling,
          coverage,
          architecture,
          churn,
          documentation,
          security,
        };

        const { totalDebt, priority, recommendations } = aggregateDebt(signals);
        const estimatedFixHours = estimateFixHours(signals, totalDebt);

        // Get or create Bayesian confidence
        const bayesian = await storage.getBayesianConfidence(entity.id, entityType as BayesianConfidence['entityType']);
        const confidenceAlpha = bayesian?.posteriorAlpha ?? 1;
        const confidenceBeta = bayesian?.posteriorBeta ?? 1;

        const metrics: DebtMetrics = {
          entityId: entity.id,
          entityType,
          totalDebt,
          complexityDebt: complexity.score,
          duplicationDebt: duplication.score,
          couplingDebt: coupling.score,
          coverageDebt: coverage.score,
          architectureDebt: architecture.score,
          churnDebt: churn.score,
          documentationDebt: documentation.score,
          securityDebt: security.score,
          trend: 'stable', // Would need historical comparison
          trendDelta: 0,
          velocityPerDay: 0,
          estimatedFixHours,
          priority,
          recommendations: includeRecommendations ? recommendations : [],
          confidenceAlpha,
          confidenceBeta,
          computedAt: new Date().toISOString(),
        };

        debtMetricsList.push(metrics);
        totalDebtSum += totalDebt;
        result.maxDebt = Math.max(result.maxDebt, totalDebt);

        if (priority === 'critical' || priority === 'high') {
          result.hotspotCount++;
        }
      } catch (error) {
        result.errors.push(`Failed to analyze ${entity.id}: ${error}`);
      }
    }

    // Store metrics
    if (debtMetricsList.length > 0) {
      await storage.upsertDebtMetrics(debtMetricsList);
      result.metricsComputed = debtMetricsList.length;
      result.avgDebt = totalDebtSum / debtMetricsList.length;
    }
  } catch (error) {
    result.errors.push(`Debt analysis failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  result.durationMs = Date.now() - startTime;
  return result;
}

// ============================================================================
// QUERY HELPERS
// ============================================================================

/**
 * Get debt hotspots (high-debt entities).
 */
export async function getDebtHotspots(
  storage: LiBrainianStorage,
  limit: number = 20
): Promise<DebtHotspot[]> {
  return storage.getDebtHotspots(limit);
}

/**
 * Get entities with degrading debt trends.
 */
export async function getDegradingEntities(
  storage: LiBrainianStorage,
  limit: number = 20
): Promise<DebtMetrics[]> {
  return storage.getDebtMetrics({
    trend: 'degrading',
    limit,
    orderBy: 'total_debt',
    orderDirection: 'desc',
  });
}

/**
 * Get entities by priority.
 */
export async function getEntitiesByPriority(
  storage: LiBrainianStorage,
  priority: DebtMetrics['priority'],
  limit: number = 50
): Promise<DebtMetrics[]> {
  return storage.getDebtMetrics({
    priority,
    limit,
    orderBy: 'total_debt',
    orderDirection: 'desc',
  });
}

/**
 * Calculate overall codebase debt health.
 */
export async function calculateCodebaseHealth(
  storage: LiBrainianStorage
): Promise<{
  overallDebt: number;
  entityCount: number;
  healthGrade: 'A' | 'B' | 'C' | 'D' | 'F';
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  topIssues: string[];
}> {
  const metrics = await storage.getDebtMetrics({ limit: 10000 });

  if (metrics.length === 0) {
    return {
      overallDebt: 0,
      entityCount: 0,
      healthGrade: 'A',
      criticalCount: 0,
      highCount: 0,
      mediumCount: 0,
      lowCount: 0,
      topIssues: [],
    };
  }

  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  let totalDebt = 0;

  for (const m of metrics) {
    counts[m.priority]++;
    totalDebt += m.totalDebt;
  }

  const overallDebt = totalDebt / metrics.length;

  // Determine health grade
  let healthGrade: 'A' | 'B' | 'C' | 'D' | 'F';
  if (overallDebt < 20 && counts.critical === 0) {
    healthGrade = 'A';
  } else if (overallDebt < 35 && counts.critical < 3) {
    healthGrade = 'B';
  } else if (overallDebt < 50 && counts.critical < 10) {
    healthGrade = 'C';
  } else if (overallDebt < 70) {
    healthGrade = 'D';
  } else {
    healthGrade = 'F';
  }

  // Get top issues from critical entities
  const criticalMetrics = metrics
    .filter(m => m.priority === 'critical')
    .slice(0, 5);
  const topIssues = criticalMetrics.flatMap(m => m.recommendations.slice(0, 1));

  return {
    overallDebt,
    entityCount: metrics.length,
    healthGrade,
    criticalCount: counts.critical,
    highCount: counts.high,
    mediumCount: counts.medium,
    lowCount: counts.low,
    topIssues,
  };
}
