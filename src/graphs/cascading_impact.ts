/**
 * @fileoverview Cascading Impact Analysis for Benefit/Risk Quantification
 *
 * Implements spreading activation with threshold pruning to analyze:
 * - Cascading benefits: "If I optimize X, what improves?"
 * - Cascading risks: "If I break X, what's the blast radius?"
 *
 * Based on RESEARCH-004: Cascading Impact and Benefit Propagation
 * Algorithm: Spreading Activation with edge-type-specific decay factors
 *
 * Key features:
 * - Threshold pruning prevents exponential blowup
 * - Separate propagation factors for benefit vs risk
 * - Critical path identification
 * - Human-readable summaries
 */

import type {
  LiBrainianStorage,
  KnowledgeGraphEdge,
  KnowledgeEdgeType,
} from '../storage/types.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Configuration for cascade analysis.
 */
export interface CascadeConfig {
  /** How far to propagate (default: 5) */
  maxDepth: number;
  /** Stop when impact < threshold (default: 0.01) */
  threshold: number;
  /** Cross into rationale graph (default: false) */
  includeRationale: boolean;
  /** Cross into epistemic graph (default: false) */
  includeEpistemic: boolean;
  /** Maximum nodes to track (default: 1000) */
  maxNodes: number;
}

/**
 * Result of a cascading impact analysis.
 */
export interface CascadeResult {
  /** The entity where the cascade starts */
  sourceEntity: string;
  /** Whether analyzing benefit or risk */
  mode: 'benefit' | 'risk';
  /** Sum of all impact scores */
  totalImpact: number;
  /** All entities affected by the cascade */
  affectedEntities: AffectedEntity[];
  /** Path with highest cumulative impact */
  criticalPath: string[];
  /** Human-readable summary */
  summary: string;
}

/**
 * An entity affected by a cascading change.
 */
export interface AffectedEntity {
  /** Unique identifier of the entity */
  entityId: string;
  /** Type of the entity (function, module, file, etc.) */
  entityType: string;
  /** How strongly this entity is impacted (0-1) */
  impactScore: number;
  /** How many hops from the source */
  depth: number;
  /** Entity IDs from source to this entity */
  pathFromSource: string[];
}

/**
 * Estimate of benefit from optimizing an entity.
 */
export interface BenefitEstimate {
  /** The entity being optimized */
  entityId: string;
  /** How much improvement factor applied (e.g., 2.0 = 2x faster) */
  improvementFactor: number;
  /** Total weighted benefit score */
  totalBenefit: number;
  /** Entities that benefit from the optimization */
  beneficiaries: AffectedEntity[];
  /** Human-readable recommendation */
  recommendation: string;
}

/**
 * Estimate of blast radius from breaking an entity.
 */
export interface BlastRadiusEstimate {
  /** The entity that might break */
  entityId: string;
  /** Overall severity assessment */
  severity: 'minor' | 'major' | 'critical';
  /** Total weighted risk score */
  totalRisk: number;
  /** Number of entities affected */
  affectedCount: number;
  /** IDs of most critical dependents */
  criticalDependents: string[];
  /** Suggested mitigations */
  mitigations: string[];
}

// ============================================================================
// PROPAGATION FACTORS
// ============================================================================

/**
 * Edge-type specific propagation factors for RISK analysis.
 * Higher values mean risk propagates more strongly through this edge type.
 *
 * Based on RESEARCH-004 analysis:
 * - imports: 0.9 (import break is severe)
 * - calls: 0.85 (call failure cascades)
 * - extends: 0.95 (breaking superclass breaks subclasses)
 */
export const RISK_PROPAGATION_FACTORS: Record<string, number> = {
  imports: 0.9,
  calls: 0.85,
  extends: 0.95,
  implements: 0.7,
  clone_of: 0.3,
  co_changed: 0.5,
  tests: 0.8,
  documents: 0.1,
  part_of: 0.7,
  depends_on: 0.8,
  similar_to: 0.2,
  authored_by: 0.1,
  reviewed_by: 0.05,
  evolved_from: 0.4,
  debt_related: 0.2,
};

/**
 * Edge-type specific propagation factors for BENEFIT analysis.
 * Higher values mean benefit propagates more strongly through this edge type.
 *
 * Based on RESEARCH-004 analysis:
 * - imports: 0.3 (import optimization has modest benefit)
 * - calls: 0.6 (optimization benefits compound for callers)
 * - extends: 0.4 (optimization less portable to subclasses)
 */
export const BENEFIT_PROPAGATION_FACTORS: Record<string, number> = {
  imports: 0.3,
  calls: 0.6,
  extends: 0.4,
  implements: 0.2,
  clone_of: 0.1,
  co_changed: 0.3,
  tests: 0.1,
  documents: 0.05,
  part_of: 0.5,
  depends_on: 0.5,
  similar_to: 0.2,
  authored_by: 0.1,
  reviewed_by: 0.05,
  evolved_from: 0.3,
  debt_related: 0.3,
};

/**
 * Default cascade configuration.
 */
export const DEFAULT_CASCADE_CONFIG: CascadeConfig = {
  maxDepth: 5,
  threshold: 0.01,
  includeRationale: false,
  includeEpistemic: false,
  maxNodes: 1000,
};

// ============================================================================
// SPREADING ACTIVATION ALGORITHM
// ============================================================================

/**
 * Internal state for spreading activation.
 */
interface ActivationState {
  /** Current activation level for each entity */
  activations: Map<string, number>;
  /** Depth (hops from source) for each entity */
  depths: Map<string, number>;
  /** Path from source for each entity */
  paths: Map<string, string[]>;
  /** Entity types for each entity */
  entityTypes: Map<string, string>;
  /** Entities in the current frontier */
  frontier: Set<string>;
}

/**
 * Perform spreading activation from a source entity.
 *
 * The algorithm:
 * 1. Start with activation = 1.0 at source
 * 2. For each entity in frontier:
 *    - Get all outgoing edges
 *    - Propagate activation = current * decay_factor
 *    - If propagated > threshold, add to next frontier
 * 3. Stop when frontier is empty or max depth reached
 *
 * @param storage - Storage for retrieving graph edges
 * @param sourceId - Entity to start propagation from
 * @param mode - 'benefit' or 'risk' (determines propagation factors)
 * @param config - Cascade configuration
 * @returns Activation state after propagation completes
 */
async function spreadingActivation(
  storage: LiBrainianStorage,
  sourceId: string,
  mode: 'benefit' | 'risk',
  config: CascadeConfig
): Promise<ActivationState> {
  const factors = mode === 'risk' ? RISK_PROPAGATION_FACTORS : BENEFIT_PROPAGATION_FACTORS;

  const state: ActivationState = {
    activations: new Map([[sourceId, 1.0]]),
    depths: new Map([[sourceId, 0]]),
    paths: new Map([[sourceId, [sourceId]]]),
    entityTypes: new Map(),
    frontier: new Set([sourceId]),
  };

  let currentDepth = 0;

  while (state.frontier.size > 0 && currentDepth < config.maxDepth) {
    const nextFrontier = new Set<string>();
    currentDepth++;

    for (const entityId of state.frontier) {
      const currentActivation = state.activations.get(entityId) ?? 0;
      if (currentActivation < config.threshold) {
        continue;
      }

      // Get outgoing edges (entities that depend on or are affected by this entity)
      // For RISK: we want dependents (who calls/imports this?)
      // For BENEFIT: we want dependents (who benefits from optimization?)
      // Both propagate "upstream" to callers/importers
      const edges = await storage.getKnowledgeEdgesTo(entityId);

      for (const edge of edges) {
        const neighborId = edge.sourceId;
        const edgeType = edge.edgeType;

        // Get propagation factor for this edge type
        const baseFactor = factors[edgeType] ?? 0.5;

        // Apply edge weight and confidence
        const edgeFactor = baseFactor * edge.weight * edge.confidence;

        // Calculate propagated activation
        const propagated = currentActivation * edgeFactor;

        // Prune if below threshold
        if (propagated < config.threshold) {
          continue;
        }

        // Check if we've hit max nodes
        if (state.activations.size >= config.maxNodes && !state.activations.has(neighborId)) {
          continue;
        }

        // Update activation (take max if already visited via different path)
        const existingActivation = state.activations.get(neighborId) ?? 0;
        if (propagated > existingActivation) {
          state.activations.set(neighborId, propagated);
          state.depths.set(neighborId, currentDepth);
          state.paths.set(neighborId, [...(state.paths.get(entityId) ?? []), neighborId]);
          state.entityTypes.set(neighborId, edge.sourceType);
          nextFrontier.add(neighborId);
        }
      }
    }

    state.frontier = nextFrontier;
  }

  return state;
}

/**
 * Find the critical path (highest cumulative impact) from activation state.
 */
function findCriticalPath(state: ActivationState): string[] {
  let maxActivation = 0;
  let criticalPath: string[] = [];

  for (const [entityId, activation] of state.activations) {
    // Only consider leaf nodes (highest depth for their path)
    const depth = state.depths.get(entityId) ?? 0;
    const path = state.paths.get(entityId) ?? [];

    // Weight by both activation and path length
    const pathScore = activation * (1 + depth * 0.1);

    if (pathScore > maxActivation && path.length > 1) {
      maxActivation = pathScore;
      criticalPath = path;
    }
  }

  return criticalPath;
}

/**
 * Generate a human-readable summary of the cascade analysis.
 */
function generateSummary(
  sourceEntity: string,
  mode: 'benefit' | 'risk',
  affectedEntities: AffectedEntity[],
  totalImpact: number,
  criticalPath: string[]
): string {
  const noun = mode === 'risk' ? 'affected' : 'benefited';
  const verb = mode === 'risk' ? 'Breaking' : 'Optimizing';

  const lines: string[] = [];

  lines.push(`${verb} "${sourceEntity}" would ${mode === 'risk' ? 'impact' : 'benefit'} ${affectedEntities.length} entities.`);

  if (affectedEntities.length > 0) {
    // Group by depth
    const byDepth = new Map<number, AffectedEntity[]>();
    for (const entity of affectedEntities) {
      const list = byDepth.get(entity.depth) ?? [];
      list.push(entity);
      byDepth.set(entity.depth, list);
    }

    lines.push('');
    lines.push('Impact by depth:');
    for (const [depth, entities] of [...byDepth.entries()].sort((a, b) => a[0] - b[0])) {
      const maxImpact = Math.max(...entities.map(e => e.impactScore));
      lines.push(`  Depth ${depth}: ${entities.length} entities, max impact ${maxImpact.toFixed(2)}`);
    }
  }

  if (criticalPath.length > 1) {
    lines.push('');
    lines.push(`Critical path: ${criticalPath.join(' -> ')}`);
  }

  lines.push('');
  lines.push(`Total ${mode} score: ${totalImpact.toFixed(2)}`);

  return lines.join('\n');
}

// ============================================================================
// MAIN API FUNCTIONS
// ============================================================================

/**
 * Analyze the cascading impact of a change to an entity.
 *
 * This is the core function for understanding how changes propagate through
 * the codebase. Use 'risk' mode to understand blast radius, 'benefit' mode
 * to understand optimization opportunities.
 *
 * @param storage - Storage for retrieving graph edges
 * @param entityId - The entity to analyze
 * @param options - Configuration options
 * @returns Complete cascade analysis result
 *
 * @example
 * ```typescript
 * // Analyze blast radius of breaking a function
 * const result = await analyzeCascadingImpact(storage, 'parseConfig', {
 *   mode: 'risk',
 *   maxDepth: 5,
 *   threshold: 0.01
 * });
 * console.log(result.summary);
 * ```
 */
export async function analyzeCascadingImpact(
  storage: LiBrainianStorage,
  entityId: string,
  options: Partial<CascadeConfig> & { mode: 'benefit' | 'risk' }
): Promise<CascadeResult> {
  const config: CascadeConfig = {
    ...DEFAULT_CASCADE_CONFIG,
    ...options,
  };

  const mode = options.mode;

  // Run spreading activation
  const state = await spreadingActivation(storage, entityId, mode, config);

  // Convert to affected entities (exclude source)
  const affectedEntities: AffectedEntity[] = [];
  for (const [id, activation] of state.activations) {
    if (id === entityId) continue;

    affectedEntities.push({
      entityId: id,
      entityType: state.entityTypes.get(id) ?? 'unknown',
      impactScore: activation,
      depth: state.depths.get(id) ?? 0,
      pathFromSource: state.paths.get(id) ?? [],
    });
  }

  // Sort by impact score (highest first)
  affectedEntities.sort((a, b) => b.impactScore - a.impactScore);

  // Calculate total impact
  const totalImpact = affectedEntities.reduce((sum, e) => sum + e.impactScore, 0);

  // Find critical path
  const criticalPath = findCriticalPath(state);

  // Generate summary
  const summary = generateSummary(entityId, mode, affectedEntities, totalImpact, criticalPath);

  return {
    sourceEntity: entityId,
    mode,
    totalImpact,
    affectedEntities,
    criticalPath,
    summary,
  };
}

/**
 * Estimate the benefit of optimizing an entity.
 *
 * This function helps answer "If I make X faster/better, what improves?"
 * by propagating benefits through the dependency graph.
 *
 * @param storage - Storage for retrieving graph edges
 * @param entityId - The entity to optimize
 * @param improvementFactor - How much improvement (e.g., 2.0 = 2x faster)
 * @returns Benefit estimate with affected entities and recommendations
 *
 * @example
 * ```typescript
 * // Estimate benefit of 2x speedup on a hot function
 * const benefit = await estimateBenefitOfOptimizing(storage, 'parseJSON', 2.0);
 * console.log(`Total benefit: ${benefit.totalBenefit}`);
 * console.log(benefit.recommendation);
 * ```
 */
export async function estimateBenefitOfOptimizing(
  storage: LiBrainianStorage,
  entityId: string,
  improvementFactor: number
): Promise<BenefitEstimate> {
  const cascadeResult = await analyzeCascadingImpact(storage, entityId, {
    mode: 'benefit',
    maxDepth: 5,
    threshold: 0.01,
  });

  // Scale total impact by improvement factor
  const totalBenefit = cascadeResult.totalImpact * (improvementFactor - 1);

  // Generate recommendation
  let recommendation: string;
  if (totalBenefit < 0.5) {
    recommendation = `Low benefit (${totalBenefit.toFixed(2)}). Consider optimizing higher-impact entities first.`;
  } else if (totalBenefit < 2.0) {
    recommendation = `Moderate benefit (${totalBenefit.toFixed(2)}). Optimization could be worthwhile if changes are straightforward.`;
  } else if (totalBenefit < 5.0) {
    recommendation = `High benefit (${totalBenefit.toFixed(2)}). This optimization would have significant positive impact.`;
  } else {
    recommendation = `Critical benefit (${totalBenefit.toFixed(2)}). Strong candidate for optimization - benefits cascade widely.`;
  }

  return {
    entityId,
    improvementFactor,
    totalBenefit,
    beneficiaries: cascadeResult.affectedEntities,
    recommendation,
  };
}

/**
 * Estimate the blast radius of breaking an entity.
 *
 * This function helps answer "If I break X, what else breaks?"
 * by propagating risk through the dependency graph.
 *
 * @param storage - Storage for retrieving graph edges
 * @param entityId - The entity that might break
 * @param breakingSeverity - How severe the break would be
 * @returns Blast radius estimate with affected entities and mitigations
 *
 * @example
 * ```typescript
 * // Estimate blast radius of breaking database connection
 * const blast = await estimateBlastRadius(storage, 'dbConnection', 'critical');
 * console.log(`Severity: ${blast.severity}`);
 * console.log(`Affected: ${blast.affectedCount} entities`);
 * blast.mitigations.forEach(m => console.log(`- ${m}`));
 * ```
 */
export async function estimateBlastRadius(
  storage: LiBrainianStorage,
  entityId: string,
  breakingSeverity: 'minor' | 'major' | 'critical' = 'major'
): Promise<BlastRadiusEstimate> {
  // Adjust threshold based on severity (more severe = search deeper)
  const thresholds = {
    minor: 0.05,
    major: 0.01,
    critical: 0.005,
  };

  const cascadeResult = await analyzeCascadingImpact(storage, entityId, {
    mode: 'risk',
    maxDepth: breakingSeverity === 'critical' ? 7 : 5,
    threshold: thresholds[breakingSeverity],
  });

  // Scale impact by severity multiplier
  const severityMultipliers = {
    minor: 0.5,
    major: 1.0,
    critical: 2.0,
  };
  const totalRisk = cascadeResult.totalImpact * severityMultipliers[breakingSeverity];

  // Determine overall severity based on affected count and total risk
  let severity: 'minor' | 'major' | 'critical';
  if (totalRisk < 1.0 && cascadeResult.affectedEntities.length < 5) {
    severity = 'minor';
  } else if (totalRisk < 5.0 && cascadeResult.affectedEntities.length < 20) {
    severity = 'major';
  } else {
    severity = 'critical';
  }

  // Identify critical dependents (high impact, low depth)
  const criticalDependents = cascadeResult.affectedEntities
    .filter(e => e.impactScore > 0.5 || e.depth === 1)
    .slice(0, 10)
    .map(e => e.entityId);

  // Generate mitigations based on findings
  const mitigations: string[] = [];

  if (cascadeResult.affectedEntities.length > 10) {
    mitigations.push('Consider incremental migration with feature flags');
  }

  if (criticalDependents.length > 3) {
    mitigations.push(`Add comprehensive tests for critical dependents: ${criticalDependents.slice(0, 3).join(', ')}`);
  }

  if (cascadeResult.criticalPath.length > 3) {
    mitigations.push(`Monitor critical path: ${cascadeResult.criticalPath.slice(0, 3).join(' -> ')}...`);
  }

  if (severity === 'critical') {
    mitigations.push('Implement circuit breaker pattern to isolate failures');
    mitigations.push('Consider backward-compatible changes with deprecation period');
  }

  if (mitigations.length === 0) {
    mitigations.push('Standard testing and code review should be sufficient');
  }

  return {
    entityId,
    severity,
    totalRisk,
    affectedCount: cascadeResult.affectedEntities.length,
    criticalDependents,
    mitigations,
  };
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Compare cascade impact across multiple entities.
 *
 * Useful for prioritizing which entities to optimize or which changes
 * carry the most risk.
 *
 * @param storage - Storage for retrieving graph edges
 * @param entityIds - Entities to compare
 * @param mode - 'benefit' or 'risk'
 * @returns Sorted list of entities with their cascade results
 */
export async function compareCascadeImpact(
  storage: LiBrainianStorage,
  entityIds: string[],
  mode: 'benefit' | 'risk'
): Promise<Array<{ entityId: string; result: CascadeResult }>> {
  const results: Array<{ entityId: string; result: CascadeResult }> = [];

  for (const entityId of entityIds) {
    const result = await analyzeCascadingImpact(storage, entityId, { mode });
    results.push({ entityId, result });
  }

  // Sort by total impact (highest first)
  results.sort((a, b) => b.result.totalImpact - a.result.totalImpact);

  return results;
}

/**
 * Get propagation factor for a specific edge type and mode.
 *
 * @param edgeType - The type of edge
 * @param mode - 'benefit' or 'risk'
 * @returns The propagation factor (0-1)
 */
export function getPropagationFactor(
  edgeType: KnowledgeEdgeType,
  mode: 'benefit' | 'risk'
): number {
  const factors = mode === 'risk' ? RISK_PROPAGATION_FACTORS : BENEFIT_PROPAGATION_FACTORS;
  return factors[edgeType] ?? 0.5;
}

/**
 * Check if an entity is likely to be high-impact based on cascade analysis.
 *
 * @param storage - Storage for retrieving graph edges
 * @param entityId - The entity to check
 * @returns True if the entity has high potential impact
 */
export async function isHighImpactEntity(
  storage: LiBrainianStorage,
  entityId: string
): Promise<boolean> {
  const result = await analyzeCascadingImpact(storage, entityId, { mode: 'risk' });
  return result.totalImpact > 2.0 || result.affectedEntities.length > 10;
}
