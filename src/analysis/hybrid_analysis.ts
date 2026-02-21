/**
 * Hybrid Analysis Module
 *
 * Combines deterministic and probabilistic analysis:
 * - Feedback loop detection in dependency graphs
 * - Control stability metrics
 * - Combined system health assessment
 * - Risk propagation through cycles
 */

import type { LiBrainianStorage, FeedbackLoop } from '../storage/types.js';
import type { ModuleGraph } from '../knowledge/module_graph.js';
import { findSCCs, computeGraphMetrics, type GraphMetrics } from './deterministic_analysis.js';
import {
  computeConfidenceEstimate,
  aggregateConfidence,
  betaMean,
  type ConfidenceEstimate,
} from './probabilistic_analysis.js';

// ============================================================================
// FEEDBACK LOOP DETECTION
// ============================================================================

export interface DetectedLoop {
  entities: string[];
  loopType: FeedbackLoop['loopType'];
  severity: FeedbackLoop['severity'];
  isStable: boolean;
  cycleLength: number;
  impact: string;
}

/**
 * Detect feedback loops in a dependency graph by combining SCC analysis
 * with confidence metrics to determine severity.
 */
export async function detectFeedbackLoops(
  storage: LiBrainianStorage,
  graph: ModuleGraph,
  entityType: 'function' | 'module' | 'file' = 'module'
): Promise<DetectedLoop[]> {
  const sccs = findSCCs(graph);
  const loops: DetectedLoop[] = [];

  // Only cycles (SCCs with size > 1) are feedback loops
  for (const scc of sccs.filter(s => s.length > 1)) {
    // Classify loop type based on structure
    const loopType = classifyLoopType(scc, graph);

    // Get confidence for entities in the loop
    const confidences: ConfidenceEstimate[] = [];
    for (const entityId of scc) {
      const conf = await storage.getBayesianConfidence(entityId, entityType);
      if (conf) {
        confidences.push(computeConfidenceEstimate(conf));
      }
    }

    // Determine severity based on size and confidence
    const severity = determineSeverity(scc.length, confidences);

    // Describe impact
    const impact = describeImpact(scc.length, loopType, severity);

    loops.push({
      entities: scc,
      loopType,
      severity,
      isStable: severity !== 'critical', // Assume stable unless critical
      cycleLength: scc.length,
      impact,
    });
  }

  return loops;
}

function classifyLoopType(
  scc: string[],
  graph: ModuleGraph
): FeedbackLoop['loopType'] {
  // Count edges within the SCC
  const sccSet = new Set(scc);
  let internalEdges = 0;

  for (const entity of scc) {
    const neighbors = graph.get(entity) ?? new Set();
    for (const neighbor of neighbors) {
      if (sccSet.has(neighbor)) {
        internalEdges++;
      }
    }
  }

  // If every node connects to every other, it's a tight cycle
  const maxEdges = scc.length * (scc.length - 1);
  const density = maxEdges > 0 ? internalEdges / maxEdges : 0;

  // Map to the expected enum values: 'circular_import' | 'mutual_recursion' | 'state_cycle' | 'data_flow_cycle'
  if (scc.length === 2) {
    return 'mutual_recursion';
  } else if (density > 0.7) {
    return 'state_cycle';
  } else {
    return 'circular_import';
  }
}

function determineSeverity(
  size: number,
  confidences: ConfidenceEstimate[]
): FeedbackLoop['severity'] {
  // Larger cycles are more severe
  if (size >= 5) {
    return 'critical';
  }

  // Low confidence in cycle members increases severity
  if (confidences.length > 0) {
    const avgConf = confidences.reduce((a, c) => a + c.mean, 0) / confidences.length;
    if (avgConf < 0.4) {
      return size >= 3 ? 'critical' : 'high';
    }
    if (avgConf < 0.6) {
      return size >= 3 ? 'high' : 'medium';
    }
  }

  return size >= 3 ? 'medium' : 'low';
}

function describeImpact(
  size: number,
  loopType: FeedbackLoop['loopType'],
  severity: FeedbackLoop['severity']
): string {
  const descriptions: Record<FeedbackLoop['loopType'], string> = {
    circular_import: 'Circular dependency chain makes refactoring difficult and can cause initialization issues.',
    mutual_recursion: 'Mutual dependency creates coupling that prevents independent testing and deployment.',
    state_cycle: 'Complex interconnected cycle indicates potential architectural problems.',
    data_flow_cycle: 'Data flow cycle may cause feedback instability or infinite loops.',
  };

  const sizeImpact = size > 3
    ? ` The ${size}-entity loop spans a significant portion of the codebase.`
    : '';

  const severityNote = severity === 'critical'
    ? ' Recommend immediate attention.'
    : severity === 'high'
      ? ' Should be addressed in next refactoring cycle.'
      : '';

  return descriptions[loopType] + sizeImpact + severityNote;
}

/**
 * Store detected feedback loops in the database.
 */
export async function storeFeedbackLoops(
  storage: LiBrainianStorage,
  loops: DetectedLoop[]
): Promise<void> {
  const now = new Date().toISOString();

  for (let i = 0; i < loops.length; i++) {
    const loop = loops[i];
    const entry: FeedbackLoop = {
      loopId: `loop-${now}-${i}`,
      entities: loop.entities,
      loopType: loop.loopType,
      severity: loop.severity,
      isStable: loop.isStable,
      cycleLength: loop.cycleLength,
      detectedAt: now,
    };

    await storage.upsertFeedbackLoop(entry);
  }
}

// ============================================================================
// CONTROL STABILITY
// ============================================================================

export interface ControlStabilityMetrics {
  overallStability: number;  // 0-1, higher is more stable
  volatileEntities: string[];
  stableEntities: string[];
  feedbackLoopRisk: number;  // 0-1, higher means more risk from cycles
  changeAmplification: number;  // How much changes propagate
}

/**
 * Compute control stability metrics for a system.
 * Combines graph structure with confidence metrics.
 */
export async function computeControlStability(
  storage: LiBrainianStorage,
  graph: ModuleGraph,
  reverse: ModuleGraph,
  entityType: 'function' | 'module' | 'file' = 'module'
): Promise<ControlStabilityMetrics> {
  const graphMetrics = computeGraphMetrics(graph, reverse);
  const loops = await detectFeedbackLoops(storage, graph, entityType);

  // Get confidence for all entities
  const entityConfidences = new Map<string, ConfidenceEstimate>();
  for (const entityId of graph.keys()) {
    const conf = await storage.getBayesianConfidence(entityId, entityType);
    if (conf) {
      entityConfidences.set(entityId, computeConfidenceEstimate(conf));
    }
  }

  // Get stability metrics for entities
  const volatileEntities: string[] = [];
  const stableEntities: string[] = [];

  for (const entityId of graph.keys()) {
    const stability = await storage.getStabilityMetrics(entityId, entityType);
    if (stability) {
      if (stability.volatility > 0.3) {
        volatileEntities.push(entityId);
      } else if (stability.volatility < 0.1) {
        stableEntities.push(entityId);
      }
    }
  }

  // Compute feedback loop risk
  const totalEntities = graph.size;
  const entitiesInLoops = new Set(loops.flatMap(l => l.entities)).size;
  const feedbackLoopRisk = totalEntities > 0 ? entitiesInLoops / totalEntities : 0;

  // Compute change amplification (based on graph density and fan-out)
  const avgOutDegree = graphMetrics.averageOutDegree;
  const changeAmplification = Math.min(1, avgOutDegree / 10);

  // Overall stability: combines confidence, volatility, and loop risk
  const allConfidences = Array.from(entityConfidences.values());
  const avgConfidence = allConfidences.length > 0
    ? allConfidences.reduce((a, c) => a + c.mean, 0) / allConfidences.length
    : 0.5;

  const volatilityFactor = volatileEntities.length > 0
    ? 1 - (volatileEntities.length / totalEntities)
    : 1;

  const overallStability = avgConfidence * volatilityFactor * (1 - feedbackLoopRisk * 0.5);

  return {
    overallStability: Math.max(0, Math.min(1, overallStability)),
    volatileEntities,
    stableEntities,
    feedbackLoopRisk,
    changeAmplification,
  };
}

// ============================================================================
// SYSTEM HEALTH ASSESSMENT
// ============================================================================

export interface SystemHealthReport {
  score: number;  // 0-100
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  components: {
    structuralHealth: number;
    confidenceHealth: number;
    stabilityHealth: number;
    couplingHealth: number;
  };
  criticalIssues: string[];
  recommendations: string[];
}

/**
 * Generate a comprehensive system health report.
 */
export async function generateSystemHealthReport(
  storage: LiBrainianStorage,
  graph: ModuleGraph,
  reverse: ModuleGraph,
  entityType: 'function' | 'module' | 'file' = 'module'
): Promise<SystemHealthReport> {
  const graphMetrics = computeGraphMetrics(graph, reverse);
  const stability = await computeControlStability(storage, graph, reverse, entityType);
  const loops = await detectFeedbackLoops(storage, graph, entityType);

  // Get confidence metrics
  const confidences: ConfidenceEstimate[] = [];
  for (const entityId of graph.keys()) {
    const conf = await storage.getBayesianConfidence(entityId, entityType);
    if (conf) {
      confidences.push(computeConfidenceEstimate(conf));
    }
  }

  // Structural Health: low density, few isolated nodes, reasonable fan-out
  const densityScore = Math.max(0, 1 - graphMetrics.density);
  const isolationScore = 1 - (graphMetrics.isolatedNodes.length / Math.max(1, graphMetrics.nodeCount));
  const fanOutScore = Math.max(0, 1 - (graphMetrics.averageOutDegree / 20));
  const structuralHealth = (densityScore + isolationScore + fanOutScore) / 3;

  // Confidence Health: average confidence of entities
  const confidenceHealth = confidences.length > 0
    ? aggregateConfidence(confidences).mean
    : 0.5;

  // Stability Health: low volatility, few feedback loops
  const stabilityHealth = stability.overallStability;

  // Coupling Health: low cycle involvement, low change amplification
  const couplingHealth = (1 - stability.feedbackLoopRisk) * (1 - stability.changeAmplification);

  // Overall score (0-100)
  const score = Math.round(
    (structuralHealth * 25 + confidenceHealth * 25 + stabilityHealth * 25 + couplingHealth * 25)
  );

  // Assign grade
  let grade: SystemHealthReport['grade'];
  if (score >= 90) grade = 'A';
  else if (score >= 80) grade = 'B';
  else if (score >= 70) grade = 'C';
  else if (score >= 60) grade = 'D';
  else grade = 'F';

  // Identify critical issues
  const criticalIssues: string[] = [];

  const criticalLoops = loops.filter(l => l.severity === 'critical');
  if (criticalLoops.length > 0) {
    criticalIssues.push(`${criticalLoops.length} critical feedback loop(s) detected`);
  }

  if (stability.volatileEntities.length > graphMetrics.nodeCount * 0.2) {
    criticalIssues.push(`${stability.volatileEntities.length} entities showing high volatility`);
  }

  if (graphMetrics.density > 0.5) {
    criticalIssues.push('High graph density indicates tight coupling');
  }

  const lowConfEntities = confidences.filter(c => c.mean < 0.4);
  if (lowConfEntities.length > confidences.length * 0.3) {
    criticalIssues.push(`${lowConfEntities.length} entities with low confidence scores`);
  }

  // Generate recommendations
  const recommendations: string[] = [];

  if (criticalLoops.length > 0) {
    recommendations.push('Break circular dependencies using dependency injection or interface segregation');
  }

  if (stability.changeAmplification > 0.5) {
    recommendations.push('Consider adding abstraction layers to reduce change amplification');
  }

  if (graphMetrics.isolatedNodes.length > 0) {
    recommendations.push(`Review ${graphMetrics.isolatedNodes.length} isolated module(s) for potential dead code`);
  }

  if (confidenceHealth < 0.6) {
    recommendations.push('Add more tests and observations to improve confidence scores');
  }

  if (recommendations.length === 0) {
    recommendations.push('System is healthy. Continue monitoring for regressions.');
  }

  return {
    score,
    grade,
    components: {
      structuralHealth: Math.round(structuralHealth * 100),
      confidenceHealth: Math.round(confidenceHealth * 100),
      stabilityHealth: Math.round(stabilityHealth * 100),
      couplingHealth: Math.round(couplingHealth * 100),
    },
    criticalIssues,
    recommendations,
  };
}

// ============================================================================
// RISK PROPAGATION
// ============================================================================

export interface RiskPropagationResult {
  entityId: string;
  directRisk: number;
  propagatedRisk: number;
  riskSources: string[];
}

/**
 * Propagate risk through the dependency graph.
 * Entities with low confidence propagate risk to their dependents.
 */
export async function propagateRisk(
  storage: LiBrainianStorage,
  graph: ModuleGraph,
  reverse: ModuleGraph,
  entityType: 'function' | 'module' | 'file' = 'module',
  riskDecay: number = 0.7 // How much risk decreases per hop
): Promise<RiskPropagationResult[]> {
  const results: RiskPropagationResult[] = [];

  // First, compute direct risk for each entity (1 - confidence)
  const directRisks = new Map<string, number>();
  for (const entityId of graph.keys()) {
    const conf = await storage.getBayesianConfidence(entityId, entityType);
    if (conf) {
      directRisks.set(entityId, 1 - betaMean(conf.posteriorAlpha, conf.posteriorBeta));
    } else {
      directRisks.set(entityId, 0.5); // Unknown risk for untracked entities
    }
  }

  // Propagate risk through dependencies (reverse graph = who depends on me)
  for (const entityId of graph.keys()) {
    const directRisk = directRisks.get(entityId) ?? 0.5;
    const riskSources: string[] = [];
    let propagatedRisk = directRisk;

    // Check dependencies and their risks
    const dependencies = graph.get(entityId) ?? new Set();
    for (const depId of dependencies) {
      const depRisk = directRisks.get(depId) ?? 0.5;
      if (depRisk > 0.3) {
        riskSources.push(depId);
        propagatedRisk = Math.max(propagatedRisk, depRisk * riskDecay);
      }
    }

    results.push({
      entityId,
      directRisk,
      propagatedRisk,
      riskSources,
    });
  }

  return results;
}

// ============================================================================
// FULL HYBRID ANALYSIS
// ============================================================================

export interface HybridAnalysisResult {
  feedbackLoops: DetectedLoop[];
  controlStability: ControlStabilityMetrics;
  systemHealth: SystemHealthReport;
  riskPropagation: RiskPropagationResult[];
}

/**
 * Run full hybrid analysis combining deterministic and probabilistic methods.
 */
export async function runHybridAnalysis(
  storage: LiBrainianStorage,
  graph: ModuleGraph,
  reverse: ModuleGraph,
  entityType: 'function' | 'module' | 'file' = 'module'
): Promise<HybridAnalysisResult> {
  const feedbackLoops = await detectFeedbackLoops(storage, graph, entityType);
  await storeFeedbackLoops(storage, feedbackLoops);

  const controlStability = await computeControlStability(storage, graph, reverse, entityType);
  const systemHealth = await generateSystemHealthReport(storage, graph, reverse, entityType);
  const riskPropagation = await propagateRisk(storage, graph, reverse, entityType);

  return {
    feedbackLoops,
    controlStability,
    systemHealth,
    riskPropagation,
  };
}
