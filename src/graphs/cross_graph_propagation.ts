/**
 * @fileoverview Cross-Graph Importance Propagation
 *
 * Implements bidirectional importance propagation across LiBrainian's four
 * interconnected graphs: Code, Rationale, Epistemic, and Organizational.
 *
 * Key insights from RESEARCH-003:
 * - A foundational decision boosts the code that implements it
 * - Load-bearing code boosts the rationale that justifies it
 * - Evidence supporting critical claims gets boosted
 * - Load-Bearing + Low Confidence = Epistemic Risk
 *
 * Phase 1: Compute per-graph metrics (done by importance_metrics.ts)
 * Phase 2: Build cross-graph edges (link code to decisions, decisions to claims)
 * Phase 3: Propagate importance bidirectionally with damping
 * Phase 4: Compute unified importance with cross-graph influence
 *
 * @packageDocumentation
 */

import type {
  ImportanceProfile,
  CodeImportanceMetrics,
  RationaleImportanceMetrics,
  EpistemicImportanceMetrics,
  OrgImportanceMetrics,
  ImportanceConfig,
} from './importance_metrics.js';
import { DEFAULT_IMPORTANCE_CONFIG } from './importance_metrics.js';
import type { KnowledgeGraphEdge, KnowledgeEdgeType } from '../storage/types.js';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/** Graph types in the LiBrainian knowledge system */
export type GraphType = 'code' | 'rationale' | 'epistemic' | 'org';

/**
 * Cross-graph edge types represent conceptual links between different graphs.
 * These edges enable importance to flow across graph boundaries.
 */
export type CrossGraphEdgeType =
  | 'documented_by_decision'   // Code -> Rationale: code is documented by a decision
  | 'constrained_by_decision'  // Code -> Rationale: code is constrained by a decision
  | 'justified_by_claim'       // Rationale -> Epistemic: decision justified by a claim
  | 'assumes_claim'            // Rationale -> Epistemic: decision assumes a claim
  | 'verified_by_test'         // Epistemic -> Code: claim verified by test code
  | 'evidenced_by_code'        // Epistemic -> Code: claim evidenced by code behavior
  | 'owned_by_expert'          // Any -> Org: entity owned by an expert
  | 'decided_by';              // Rationale -> Org: decision made by a person

/**
 * A cross-graph edge connecting entities in different graphs.
 * These edges enable importance propagation across graph boundaries.
 */
export interface CrossGraphEdge {
  /** Unique identifier for this edge */
  id: string;
  /** Source graph type */
  sourceGraph: GraphType;
  /** Target graph type */
  targetGraph: GraphType;
  /** Source entity identifier */
  sourceEntityId: string;
  /** Target entity identifier */
  targetEntityId: string;
  /** Type of cross-graph relationship */
  edgeType: CrossGraphEdgeType;
  /** Propagation weight (0-1) - how much importance flows through this edge */
  weight: number;
  /** Confidence in this edge's existence (0-1) */
  confidence: number;
  /** When this edge was computed */
  computedAt: string;
  /** Optional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Result of importance propagation for a single entity.
 * Contains original importance, propagated importance, and influence sources.
 */
export interface PropagationResult {
  /** Entity identifier */
  entityId: string;
  /** Graph this entity belongs to */
  graph: GraphType;
  /** Original importance before propagation */
  originalImportance: number;
  /** Importance after cross-graph propagation */
  propagatedImportance: number;
  /** Sources that contributed to this entity's importance */
  influenceSources: InfluenceSource[];
  /** Net change from propagation */
  importanceDelta: number;
}

/**
 * A source of influence on an entity's importance.
 */
export interface InfluenceSource {
  /** Entity that provided the influence */
  entityId: string;
  /** Graph the influencing entity belongs to */
  graph: GraphType;
  /** How much this entity contributed to importance */
  contribution: number;
  /** Edge type through which influence flowed */
  edgeType: CrossGraphEdgeType;
  /** Direction of influence (incoming or outgoing) */
  direction: 'incoming' | 'outgoing';
}

/**
 * An epistemic risk - a high-load claim with low confidence.
 * These represent system vulnerabilities where critical knowledge lacks validation.
 */
export interface EpistemicRisk {
  /** Entity identifier */
  entityId: string;
  /** The claim's proposition (what is being claimed) */
  proposition?: string;
  /** Epistemic load - how many things depend on this claim */
  epistemicLoad: number;
  /** Confidence in this claim (0-1) */
  confidence: number;
  /** Risk score (higher = more risky) */
  riskScore: number;
  /** Risk level category */
  riskLevel: 'critical' | 'high' | 'medium' | 'low';
  /** What would be affected if this claim is wrong */
  affectedEntities: string[];
  /** Suggested action to mitigate risk */
  suggestedAction: string;
  /** When this risk was identified */
  identifiedAt: string;
}

/**
 * A chain of influence showing how importance propagated to an entity.
 */
export interface InfluenceChain {
  /** Entity this chain ends at */
  targetEntityId: string;
  /** Ordered list of links in the chain */
  chain: InfluenceChainLink[];
  /** Total propagation factor across the chain */
  totalPropagationFactor: number;
  /** Length of the chain (number of hops) */
  chainLength: number;
}

/**
 * A single link in an influence chain.
 */
export interface InfluenceChainLink {
  /** Source entity */
  fromEntityId: string;
  /** Source graph */
  fromGraph: GraphType;
  /** Target entity */
  toEntityId: string;
  /** Target graph */
  toGraph: GraphType;
  /** Edge type */
  edgeType: CrossGraphEdgeType;
  /** Importance at this point in the chain */
  importance: number;
  /** Propagation factor applied at this link */
  propagationFactor: number;
}

/**
 * Configuration for cross-graph propagation.
 */
export interface CrossGraphPropagationConfig {
  /** Damping factors by edge type (how much importance transfers) */
  dampingFactors: Record<CrossGraphEdgeType, number>;
  /** Maximum propagation depth to prevent infinite loops */
  maxPropagationDepth: number;
  /** Weight for forward (incoming) vs reverse (outgoing) influence */
  forwardWeight: number;
  /** Minimum importance threshold to propagate */
  minImportanceThreshold: number;
  /** Whether to normalize propagated importance */
  normalizeOutput: boolean;
}

/**
 * Default configuration for cross-graph propagation.
 */
export const DEFAULT_CROSS_GRAPH_CONFIG: CrossGraphPropagationConfig = {
  dampingFactors: {
    documented_by_decision: 0.8,
    constrained_by_decision: 0.9,
    justified_by_claim: 0.7,
    assumes_claim: 0.5,
    verified_by_test: 0.9,
    evidenced_by_code: 0.7,
    owned_by_expert: 0.3,
    decided_by: 0.5,
  },
  maxPropagationDepth: 10,
  forwardWeight: 0.7,
  minImportanceThreshold: 0.01,
  normalizeOutput: true,
};

// ============================================================================
// CROSS-GRAPH EDGE BUILDER
// ============================================================================

/**
 * Input for building cross-graph edges.
 */
export interface CrossGraphEdgeBuilderInput {
  /** Knowledge graph edges from storage */
  knowledgeEdges: KnowledgeGraphEdge[];
  /** Map of entity ID to graph type */
  entityGraphTypes: Map<string, GraphType>;
}

/**
 * Build cross-graph edges from knowledge graph edges.
 *
 * Analyzes edges to determine which ones cross graph boundaries and
 * classifies them by cross-graph edge type.
 *
 * @param input - Knowledge edges and entity type mapping
 * @returns Array of cross-graph edges
 */
export function buildCrossGraphEdges(
  input: CrossGraphEdgeBuilderInput
): CrossGraphEdge[] {
  const { knowledgeEdges, entityGraphTypes } = input;
  const crossGraphEdges: CrossGraphEdge[] = [];
  const now = new Date().toISOString();

  for (const edge of knowledgeEdges) {
    const sourceGraph = entityGraphTypes.get(edge.sourceId);
    const targetGraph = entityGraphTypes.get(edge.targetId);

    // Skip if we don't know the graph types or they're the same
    if (!sourceGraph || !targetGraph || sourceGraph === targetGraph) {
      continue;
    }

    // Classify the cross-graph edge type
    const crossGraphEdgeType = classifyCrossGraphEdge(
      sourceGraph,
      targetGraph,
      edge.edgeType
    );

    if (crossGraphEdgeType) {
      crossGraphEdges.push({
        id: `cross-${edge.id}`,
        sourceGraph,
        targetGraph,
        sourceEntityId: edge.sourceId,
        targetEntityId: edge.targetId,
        edgeType: crossGraphEdgeType,
        weight: edge.weight,
        confidence: edge.confidence,
        computedAt: now,
        metadata: edge.metadata,
      });
    }
  }

  return crossGraphEdges;
}

/**
 * Classify a knowledge edge as a cross-graph edge type.
 *
 * @param sourceGraph - Source entity's graph
 * @param targetGraph - Target entity's graph
 * @param knowledgeEdgeType - Type of knowledge edge
 * @returns Cross-graph edge type, or undefined if not applicable
 */
function classifyCrossGraphEdge(
  sourceGraph: GraphType,
  targetGraph: GraphType,
  knowledgeEdgeType: KnowledgeEdgeType
): CrossGraphEdgeType | undefined {
  // Code -> Rationale
  if (sourceGraph === 'code' && targetGraph === 'rationale') {
    if (knowledgeEdgeType === 'documents' || knowledgeEdgeType === 'part_of') {
      return 'documented_by_decision';
    }
    if (knowledgeEdgeType === 'depends_on') {
      return 'constrained_by_decision';
    }
  }

  // Rationale -> Epistemic
  if (sourceGraph === 'rationale' && targetGraph === 'epistemic') {
    if (knowledgeEdgeType === 'depends_on' || knowledgeEdgeType === 'part_of') {
      return 'justified_by_claim';
    }
    if (knowledgeEdgeType === 'similar_to') {
      return 'assumes_claim';
    }
  }

  // Epistemic -> Code
  if (sourceGraph === 'epistemic' && targetGraph === 'code') {
    if (knowledgeEdgeType === 'tests') {
      return 'verified_by_test';
    }
    if (knowledgeEdgeType === 'documents' || knowledgeEdgeType === 'depends_on') {
      return 'evidenced_by_code';
    }
  }

  // Any -> Org
  if (targetGraph === 'org') {
    if (knowledgeEdgeType === 'authored_by') {
      return 'owned_by_expert';
    }
    if (sourceGraph === 'rationale' && knowledgeEdgeType === 'reviewed_by') {
      return 'decided_by';
    }
  }

  return undefined;
}

// ============================================================================
// IMPORTANCE PROPAGATION ALGORITHM
// ============================================================================

/**
 * Input for importance propagation.
 */
export interface PropagationInput {
  /** Importance profiles from per-graph computation */
  profiles: Map<string, ImportanceProfile>;
  /** Cross-graph edges for propagation */
  crossGraphEdges: CrossGraphEdge[];
  /** Configuration options */
  config?: CrossGraphPropagationConfig;
}

/**
 * Propagate importance across graphs bidirectionally.
 *
 * This implements the cross-graph importance flow algorithm from RESEARCH-003:
 * - Phase 3: Propagate importance bidirectionally with damping
 * - Phase 4: Compute unified importance with cross-graph influence
 *
 * Importance flows:
 * - Forward: From source entities to target entities (weighted by forwardWeight)
 * - Reverse: From target entities back to source entities (weighted by 1-forwardWeight)
 *
 * @param input - Profiles and edges for propagation
 * @returns Array of propagation results for each entity
 */
export function propagateImportance(
  input: PropagationInput
): PropagationResult[] {
  const { profiles, crossGraphEdges } = input;
  const config = input.config ?? DEFAULT_CROSS_GRAPH_CONFIG;

  const results: PropagationResult[] = [];

  // Build adjacency lists for fast lookup
  const incomingEdges = new Map<string, CrossGraphEdge[]>();
  const outgoingEdges = new Map<string, CrossGraphEdge[]>();

  for (const edge of crossGraphEdges) {
    // Incoming edges to target
    if (!incomingEdges.has(edge.targetEntityId)) {
      incomingEdges.set(edge.targetEntityId, []);
    }
    incomingEdges.get(edge.targetEntityId)!.push(edge);

    // Outgoing edges from source
    if (!outgoingEdges.has(edge.sourceEntityId)) {
      outgoingEdges.set(edge.sourceEntityId, []);
    }
    outgoingEdges.get(edge.sourceEntityId)!.push(edge);
  }

  // Compute propagated importance for each entity
  for (const [entityId, profile] of profiles) {
    const originalImportance = profile.unified;
    const influenceSources: InfluenceSource[] = [];

    // Phase 3a: Compute incoming influence (forward propagation)
    let incomingInfluence = 0;
    const entityIncomingEdges = incomingEdges.get(entityId) ?? [];

    for (const edge of entityIncomingEdges) {
      const sourceProfile = profiles.get(edge.sourceEntityId);
      if (!sourceProfile) continue;

      const damping = config.dampingFactors[edge.edgeType];
      const sourceImportance = sourceProfile.unified;

      if (sourceImportance >= config.minImportanceThreshold) {
        const contribution = damping * sourceImportance * edge.weight * edge.confidence;
        incomingInfluence += contribution;

        influenceSources.push({
          entityId: edge.sourceEntityId,
          graph: edge.sourceGraph,
          contribution,
          edgeType: edge.edgeType,
          direction: 'incoming',
        });
      }
    }

    // Phase 3b: Compute outgoing influence (reverse propagation)
    // Important entities that influence others should also be boosted
    let outgoingInfluence = 0;
    const entityOutgoingEdges = outgoingEdges.get(entityId) ?? [];

    for (const edge of entityOutgoingEdges) {
      const targetProfile = profiles.get(edge.targetEntityId);
      if (!targetProfile) continue;

      // Reverse damping is lower (importance flows primarily forward)
      const reverseDamping = config.dampingFactors[edge.edgeType] * 0.5;
      const targetImportance = targetProfile.unified;

      if (targetImportance >= config.minImportanceThreshold) {
        const contribution = reverseDamping * targetImportance * edge.weight * edge.confidence;
        outgoingInfluence += contribution;

        influenceSources.push({
          entityId: edge.targetEntityId,
          graph: edge.targetGraph,
          contribution,
          edgeType: edge.edgeType,
          direction: 'outgoing',
        });
      }
    }

    // Phase 4: Combine local importance with propagated influence
    const totalInfluence =
      config.forwardWeight * incomingInfluence +
      (1 - config.forwardWeight) * outgoingInfluence;

    // Normalize by edge count to prevent unbounded growth
    const edgeCount = entityIncomingEdges.length + entityOutgoingEdges.length;
    const normalizedInfluence = edgeCount > 0
      ? totalInfluence / Math.max(1, edgeCount * 0.5)
      : 0;

    // Blend original importance with propagated influence
    // Original importance still dominates (alpha = 0.7)
    const alpha = 0.7;
    let propagatedImportance = alpha * originalImportance + (1 - alpha) * normalizedInfluence;

    // Clamp to [0, 1]
    propagatedImportance = Math.min(1, Math.max(0, propagatedImportance));

    results.push({
      entityId,
      graph: inferGraphType(profile),
      originalImportance,
      propagatedImportance,
      influenceSources,
      importanceDelta: propagatedImportance - originalImportance,
    });
  }

  // Optional: normalize all propagated importances
  if (config.normalizeOutput && results.length > 0) {
    const maxPropagated = Math.max(...results.map(r => r.propagatedImportance));
    if (maxPropagated > 0) {
      for (const result of results) {
        result.propagatedImportance /= maxPropagated;
        result.importanceDelta = result.propagatedImportance - result.originalImportance;
      }
    }
  }

  return results;
}

/**
 * Infer the graph type from an importance profile.
 */
function inferGraphType(profile: ImportanceProfile): GraphType {
  if (profile.entityType === 'decision') return 'rationale';
  if (profile.entityType === 'claim') return 'epistemic';
  // Default to code for function, module, file, directory
  return 'code';
}

// ============================================================================
// EPISTEMIC RISK IDENTIFICATION
// ============================================================================

/**
 * Find epistemic risks - claims with high load but low confidence.
 *
 * Key insight from RESEARCH-003:
 * **Load-Bearing + Low Confidence = Epistemic Risk**
 *
 * If a claim has high epistemic load but low confidence, it's a system risk.
 * These risks should be surfaced to agents for validation.
 *
 * @param profiles - Importance profiles to analyze
 * @param confidenceScores - Map of entity ID to confidence score (0-1)
 * @param config - Optional configuration
 * @returns Array of epistemic risks, sorted by risk score
 */
export function findEpistemicRisks(
  profiles: Map<string, ImportanceProfile>,
  confidenceScores?: Map<string, number>,
  config?: EpistemicRiskConfig
): EpistemicRisk[] {
  const cfg = config ?? DEFAULT_EPISTEMIC_RISK_CONFIG;
  const risks: EpistemicRisk[] = [];
  const now = new Date().toISOString();

  for (const [entityId, profile] of profiles) {
    // Only analyze claim entities
    if (profile.entityType !== 'claim') continue;

    const epistemicLoad = profile.epistemicImportance.epistemicLoad;
    const confidence = confidenceScores?.get(entityId) ?? 0.5;

    // Calculate risk score: higher load + lower confidence = higher risk
    // Risk = load * (1 - confidence) * vulnerability factor
    const vulnerabilityFactor = 1 + profile.epistemicImportance.defeaterVulnerability;
    const riskScore = epistemicLoad * (1 - confidence) * vulnerabilityFactor;

    // Only report if above threshold
    if (riskScore < cfg.minRiskThreshold) continue;

    // Determine risk level
    let riskLevel: EpistemicRisk['riskLevel'];
    if (riskScore >= cfg.criticalThreshold) {
      riskLevel = 'critical';
    } else if (riskScore >= cfg.highThreshold) {
      riskLevel = 'high';
    } else if (riskScore >= cfg.mediumThreshold) {
      riskLevel = 'medium';
    } else {
      riskLevel = 'low';
    }

    // Find affected entities (entities that depend on this claim)
    const affectedEntities: string[] = [];
    for (const [otherId, otherProfile] of profiles) {
      if (otherId === entityId) continue;
      // Check if other entity has this claim in its cross-graph influence
      if (otherProfile.crossGraphInfluence > 0) {
        // Simplified: any entity with cross-graph influence could be affected
        // In a full implementation, we'd trace the actual dependency graph
        affectedEntities.push(otherId);
      }
    }

    // Generate suggested action based on risk type
    const suggestedAction = generateSuggestedAction(
      epistemicLoad,
      confidence,
      profile.epistemicImportance.defeaterVulnerability
    );

    risks.push({
      entityId,
      epistemicLoad,
      confidence,
      riskScore,
      riskLevel,
      affectedEntities: affectedEntities.slice(0, 10), // Limit to top 10
      suggestedAction,
      identifiedAt: now,
    });
  }

  // Sort by risk score descending
  risks.sort((a, b) => b.riskScore - a.riskScore);

  return risks;
}

/**
 * Configuration for epistemic risk identification.
 */
export interface EpistemicRiskConfig {
  /** Minimum risk score to report */
  minRiskThreshold: number;
  /** Risk score threshold for critical level */
  criticalThreshold: number;
  /** Risk score threshold for high level */
  highThreshold: number;
  /** Risk score threshold for medium level */
  mediumThreshold: number;
}

/**
 * Default configuration for epistemic risk identification.
 */
export const DEFAULT_EPISTEMIC_RISK_CONFIG: EpistemicRiskConfig = {
  minRiskThreshold: 0.3,
  criticalThreshold: 0.8,
  highThreshold: 0.6,
  mediumThreshold: 0.4,
};

/**
 * Generate a suggested action for mitigating an epistemic risk.
 */
function generateSuggestedAction(
  epistemicLoad: number,
  confidence: number,
  vulnerability: number
): string {
  if (confidence < 0.2) {
    return 'URGENT: This load-bearing claim has very low confidence. Gather evidence or run tests to validate.';
  }

  if (vulnerability > 0.7) {
    return 'This claim has active defeaters. Resolve contradicting evidence before relying on this claim.';
  }

  if (epistemicLoad > 0.8) {
    return 'This is a foundational claim. Consider adding multiple independent evidence sources.';
  }

  if (confidence < 0.5) {
    return 'Improve confidence by adding tests, code reviews, or documentation.';
  }

  return 'Monitor this claim for changes. Consider periodic revalidation.';
}

// ============================================================================
// INFLUENCE CHAIN TRACING
// ============================================================================

/**
 * Trace the influence chain for an entity.
 *
 * Shows how importance propagated to reach this entity,
 * useful for understanding why an entity has high/low importance.
 *
 * @param entityId - Entity to trace influence for
 * @param profiles - All importance profiles
 * @param crossGraphEdges - Cross-graph edges
 * @param config - Optional configuration
 * @returns Influence chain showing propagation path
 */
export function getInfluenceChain(
  entityId: string,
  profiles: Map<string, ImportanceProfile>,
  crossGraphEdges: CrossGraphEdge[],
  config?: CrossGraphPropagationConfig
): InfluenceChain {
  const cfg = config ?? DEFAULT_CROSS_GRAPH_CONFIG;
  const chain: InfluenceChainLink[] = [];
  const visited = new Set<string>();
  let totalPropagationFactor = 1.0;

  // Build incoming edge index
  const incomingEdges = new Map<string, CrossGraphEdge[]>();
  for (const edge of crossGraphEdges) {
    if (!incomingEdges.has(edge.targetEntityId)) {
      incomingEdges.set(edge.targetEntityId, []);
    }
    incomingEdges.get(edge.targetEntityId)!.push(edge);
  }

  // BFS to trace influence (most significant paths first)
  const queue: Array<{
    entityId: string;
    depth: number;
    importance: number;
    factor: number;
  }> = [
    {
      entityId,
      depth: 0,
      importance: profiles.get(entityId)?.unified ?? 0,
      factor: 1.0,
    },
  ];

  while (queue.length > 0 && chain.length < cfg.maxPropagationDepth) {
    const current = queue.shift()!;

    if (visited.has(current.entityId)) continue;
    visited.add(current.entityId);

    const edges = incomingEdges.get(current.entityId) ?? [];

    // Sort edges by source importance (most important first)
    edges.sort((a, b) => {
      const impA = profiles.get(a.sourceEntityId)?.unified ?? 0;
      const impB = profiles.get(b.sourceEntityId)?.unified ?? 0;
      return impB - impA;
    });

    for (const edge of edges) {
      if (visited.has(edge.sourceEntityId)) continue;

      const sourceProfile = profiles.get(edge.sourceEntityId);
      if (!sourceProfile) continue;

      const damping = cfg.dampingFactors[edge.edgeType];
      const propagationFactor = damping * edge.weight * edge.confidence;

      chain.push({
        fromEntityId: edge.sourceEntityId,
        fromGraph: edge.sourceGraph,
        toEntityId: edge.targetEntityId,
        toGraph: edge.targetGraph,
        edgeType: edge.edgeType,
        importance: sourceProfile.unified,
        propagationFactor,
      });

      totalPropagationFactor *= propagationFactor;

      queue.push({
        entityId: edge.sourceEntityId,
        depth: current.depth + 1,
        importance: sourceProfile.unified,
        factor: current.factor * propagationFactor,
      });
    }
  }

  return {
    targetEntityId: entityId,
    chain,
    totalPropagationFactor,
    chainLength: chain.length,
  };
}

// ============================================================================
// BATCH CROSS-GRAPH PROPAGATION
// ============================================================================

/**
 * Result of batch cross-graph propagation.
 */
export interface BatchPropagationResult {
  /** Propagation results for each entity */
  results: Map<string, PropagationResult>;
  /** Identified epistemic risks */
  epistemicRisks: EpistemicRisk[];
  /** Summary statistics */
  summary: {
    totalEntities: number;
    entitiesWithInfluence: number;
    avgImportanceDelta: number;
    maxImportanceDelta: number;
    criticalRisks: number;
    highRisks: number;
  };
  /** When computed */
  computedAt: string;
}

/**
 * Input for batch cross-graph propagation.
 */
export interface BatchPropagationInput {
  /** Importance profiles */
  profiles: Map<string, ImportanceProfile>;
  /** Cross-graph edges */
  crossGraphEdges: CrossGraphEdge[];
  /** Optional confidence scores for risk analysis */
  confidenceScores?: Map<string, number>;
  /** Optional propagation config */
  propagationConfig?: CrossGraphPropagationConfig;
  /** Optional risk config */
  riskConfig?: EpistemicRiskConfig;
}

/**
 * Perform batch cross-graph importance propagation.
 *
 * This is the main entry point for cross-graph propagation.
 * It combines:
 * - Bidirectional importance propagation
 * - Epistemic risk identification
 * - Summary statistics
 *
 * @param input - Profiles, edges, and configuration
 * @returns Complete propagation results
 */
export function propagateImportanceBatch(
  input: BatchPropagationInput
): BatchPropagationResult {
  const now = new Date().toISOString();

  // Phase 3-4: Propagate importance
  const propagationResults = propagateImportance({
    profiles: input.profiles,
    crossGraphEdges: input.crossGraphEdges,
    config: input.propagationConfig,
  });

  // Convert to map for easy lookup
  const resultsMap = new Map<string, PropagationResult>();
  for (const result of propagationResults) {
    resultsMap.set(result.entityId, result);
  }

  // Find epistemic risks
  const epistemicRisks = findEpistemicRisks(
    input.profiles,
    input.confidenceScores,
    input.riskConfig
  );

  // Compute summary statistics
  let entitiesWithInfluence = 0;
  let totalDelta = 0;
  let maxDelta = 0;

  for (const result of propagationResults) {
    if (result.influenceSources.length > 0) {
      entitiesWithInfluence++;
    }
    totalDelta += Math.abs(result.importanceDelta);
    maxDelta = Math.max(maxDelta, Math.abs(result.importanceDelta));
  }

  const criticalRisks = epistemicRisks.filter(r => r.riskLevel === 'critical').length;
  const highRisks = epistemicRisks.filter(r => r.riskLevel === 'high').length;

  return {
    results: resultsMap,
    epistemicRisks,
    summary: {
      totalEntities: propagationResults.length,
      entitiesWithInfluence,
      avgImportanceDelta: propagationResults.length > 0
        ? totalDelta / propagationResults.length
        : 0,
      maxImportanceDelta: maxDelta,
      criticalRisks,
      highRisks,
    },
    computedAt: now,
  };
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Create a cross-graph edge.
 *
 * @param props - Edge properties
 * @returns Complete cross-graph edge
 */
export function createCrossGraphEdge(
  props: Omit<CrossGraphEdge, 'id' | 'computedAt' | 'confidence'> & {
    id?: string;
    confidence?: number;
  }
): CrossGraphEdge {
  return {
    id: props.id ?? `cross-${props.sourceEntityId}-${props.targetEntityId}`,
    sourceGraph: props.sourceGraph,
    targetGraph: props.targetGraph,
    sourceEntityId: props.sourceEntityId,
    targetEntityId: props.targetEntityId,
    edgeType: props.edgeType,
    weight: props.weight,
    confidence: props.confidence ?? 1.0,
    computedAt: new Date().toISOString(),
    metadata: props.metadata,
  };
}

/**
 * Filter cross-graph edges by graph pair.
 *
 * @param edges - All cross-graph edges
 * @param sourceGraph - Source graph type
 * @param targetGraph - Target graph type
 * @returns Filtered edges
 */
export function filterEdgesByGraphPair(
  edges: CrossGraphEdge[],
  sourceGraph: GraphType,
  targetGraph: GraphType
): CrossGraphEdge[] {
  return edges.filter(
    e => e.sourceGraph === sourceGraph && e.targetGraph === targetGraph
  );
}

/**
 * Get all entities involved in cross-graph edges.
 *
 * @param edges - Cross-graph edges
 * @returns Set of entity IDs
 */
export function getInvolvedEntities(edges: CrossGraphEdge[]): Set<string> {
  const entities = new Set<string>();
  for (const edge of edges) {
    entities.add(edge.sourceEntityId);
    entities.add(edge.targetEntityId);
  }
  return entities;
}

/**
 * Compute cross-graph edge statistics.
 *
 * @param edges - Cross-graph edges
 * @returns Statistics about the edges
 */
export function computeEdgeStatistics(edges: CrossGraphEdge[]): {
  totalEdges: number;
  byType: Record<CrossGraphEdgeType, number>;
  byGraphPair: Record<string, number>;
  avgWeight: number;
  avgConfidence: number;
} {
  const byType: Record<CrossGraphEdgeType, number> = {
    documented_by_decision: 0,
    constrained_by_decision: 0,
    justified_by_claim: 0,
    assumes_claim: 0,
    verified_by_test: 0,
    evidenced_by_code: 0,
    owned_by_expert: 0,
    decided_by: 0,
  };

  const byGraphPair: Record<string, number> = {};
  let totalWeight = 0;
  let totalConfidence = 0;

  for (const edge of edges) {
    byType[edge.edgeType]++;

    const pairKey = `${edge.sourceGraph}->${edge.targetGraph}`;
    byGraphPair[pairKey] = (byGraphPair[pairKey] ?? 0) + 1;

    totalWeight += edge.weight;
    totalConfidence += edge.confidence;
  }

  return {
    totalEdges: edges.length,
    byType,
    byGraphPair,
    avgWeight: edges.length > 0 ? totalWeight / edges.length : 0,
    avgConfidence: edges.length > 0 ? totalConfidence / edges.length : 0,
  };
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
  // Re-export types from importance_metrics that consumers might need
  type ImportanceProfile,
  type ImportanceConfig,
  DEFAULT_IMPORTANCE_CONFIG,
};
