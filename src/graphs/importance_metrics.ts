/**
 * @fileoverview Multi-Graph Importance Metrics for LiBrainian
 *
 * Implements per-graph importance metrics and unified importance scoring
 * across the four interconnected graphs in LiBrainian:
 * - Code Graph: Functions, classes, modules with calls/imports/extends edges
 * - Rationale Graph: Decisions, justifications, tradeoffs, ADRs
 * - Epistemic Graph: Claims, evidence, confidence values, defeaters
 * - Organizational Graph: Ownership, responsibility, teams
 *
 * Each graph has its own notion of "importance" or "centrality." This module
 * computes per-graph metrics and combines them into a unified importance profile
 * with interpretive flags for agent decision-making.
 *
 * Based on RESEARCH-003: Multi-Graph Importance Metrics
 *
 * @packageDocumentation
 */

import { computePageRank, type PageRankOptions } from './pagerank.js';
import {
  computeBetweennessCentrality,
  computeClosenessCentrality,
  computeEigenvectorCentrality,
} from './centrality.js';
import { computeHotspotScore, type HotspotInput, type HotspotScore } from '../strategic/hotspot.js';
import type {
  ArgumentEdge,
  ArgumentEdgeType,
  KnowledgeGraphEdge,
  KnowledgeEdgeType,
  LiBrainianStorage,
} from '../storage/types.js';
import { isArgumentEdge, isSupportEdge, isConflictEdge, isDecisionChainEdge } from '../storage/types.js';
import type { Claim, ClaimId, EvidenceEdge, EdgeType, Contradiction, ExtendedDefeater } from '../epistemics/types.js';
import type { IEvidenceLedger, EvidenceEntry, EvidenceId } from '../epistemics/evidence_ledger.js';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

type Graph = Map<string, Set<string>>;

/**
 * Code graph importance metrics.
 * These metrics identify structurally important code entities.
 */
export interface CodeImportanceMetrics {
  /** PageRank score (recursive importance from incoming edges) */
  pageRank: number;
  /** Betweenness centrality (bridge entities connecting clusters) */
  centrality: number;
  /** Hotspot score (churn x complexity) */
  hotspotScore: number;
  /** Combined code importance (0-1) */
  combined: number;
}

/**
 * Rationale graph importance metrics.
 * These metrics identify foundational decisions and their impact.
 */
export interface RationaleImportanceMetrics {
  /** How many decisions/code entities depend on this decision */
  foundationality: number;
  /** Is it still active (not superseded)? 0 = superseded, 1 = active */
  activityScore: number;
  /** How many competing concerns this decision balances */
  tradeoffCentrality: number;
  /** How many constraints this decision creates */
  constraintLoad: number;
  /** Combined rationale importance (0-1) */
  combined: number;
}

/**
 * Epistemic graph importance metrics.
 * These metrics identify load-bearing claims and their vulnerability.
 */
export interface EpistemicImportanceMetrics {
  /** How many claims depend on this claim being true */
  epistemicLoad: number;
  /** Layers of supporting evidence */
  evidenceDepth: number;
  /** How vulnerable to defeat (inverse = robustness) */
  defeaterVulnerability: number;
  /** Combined epistemic importance (0-1) */
  combined: number;
}

/**
 * Organizational graph importance metrics.
 * These metrics identify ownership concentration and expertise.
 */
export interface OrgImportanceMetrics {
  /** Risk metric for knowledge concentration (0 = distributed, 1 = single owner) */
  ownershipConcentration: number;
  /** How deep the expertise is for this entity */
  expertiseDepth: number;
  /** How well-reviewed is this entity */
  reviewCoverage: number;
  /** Combined organizational importance (0-1) */
  combined: number;
}

/**
 * Complete importance profile for an entity.
 * Provides per-graph metrics, unified score, and interpretive flags.
 */
export interface ImportanceProfile {
  /** Entity identifier */
  entityId: string;
  /** Entity type for context */
  entityType: 'function' | 'module' | 'file' | 'directory' | 'decision' | 'claim';
  /** Code graph importance metrics */
  codeImportance: CodeImportanceMetrics;
  /** Rationale graph importance metrics */
  rationaleImportance: RationaleImportanceMetrics;
  /** Epistemic graph importance metrics */
  epistemicImportance: EpistemicImportanceMetrics;
  /** Organizational graph importance metrics */
  orgImportance: OrgImportanceMetrics;
  /** Unified importance score (0-1) */
  unified: number;
  /** Cross-graph influence score (0-1) */
  crossGraphInfluence: number;
  /** Interpretive flags for agent decision-making */
  flags: ImportanceFlags;
  /** When this profile was computed */
  computedAt: string;
}

/**
 * Interpretive flags for importance-based decision making.
 */
export interface ImportanceFlags {
  /** High importance in any graph */
  isLoadBearing: boolean;
  /** Many things depend on it */
  isFoundational: boolean;
  /** High importance + low confidence */
  isAtRisk: boolean;
  /** Evidence is stale or weak */
  needsValidation: boolean;
  /** Single owner (truck factor risk) */
  hasTruckFactorRisk: boolean;
  /** High churn + high complexity */
  isHotspot: boolean;
}

/**
 * Configuration for importance computation.
 */
export interface ImportanceConfig {
  /** Weights for unified importance calculation */
  weights: {
    code: number;
    rationale: number;
    epistemic: number;
    org: number;
    crossGraph: number;
  };
  /** Thresholds for flag determination */
  thresholds: {
    loadBearing: number;
    foundational: number;
    atRisk: number;
    needsValidation: number;
    truckFactor: number;
    hotspot: number;
  };
  /** PageRank options */
  pageRankOptions: PageRankOptions;
}

/**
 * Default configuration for importance computation.
 */
export const DEFAULT_IMPORTANCE_CONFIG: ImportanceConfig = {
  weights: {
    code: 0.3,
    rationale: 0.2,
    epistemic: 0.25,
    org: 0.1,
    crossGraph: 0.15,
  },
  thresholds: {
    loadBearing: 0.7,
    foundational: 0.7,
    atRisk: 0.6,
    needsValidation: 0.5,
    truckFactor: 0.8,
    hotspot: 0.5,
  },
  pageRankOptions: {
    dampingFactor: 0.85,
    maxIterations: 100,
    convergenceThreshold: 1e-6,
  },
};

// ============================================================================
// INPUT TYPES FOR METRIC COMPUTATION
// ============================================================================

/**
 * Input data for code importance computation.
 */
export interface CodeImportanceInput {
  /** Code graph (entity -> dependencies) */
  graph: Graph;
  /** Hotspot inputs for churn/complexity scoring */
  hotspotInputs?: Map<string, HotspotInput>;
}

/**
 * Input data for rationale importance computation.
 */
export interface RationaleImportanceInput {
  /** Argument edges from the knowledge graph */
  argumentEdges: ArgumentEdge[];
  /** Decision statuses (entityId -> status) */
  decisionStatuses?: Map<string, 'accepted' | 'proposed' | 'deprecated' | 'superseded'>;
  /** Tradeoff counts per decision */
  tradeoffCounts?: Map<string, number>;
  /** Constraint counts per decision */
  constraintCounts?: Map<string, number>;
}

/**
 * Input data for epistemic importance computation.
 */
export interface EpistemicImportanceInput {
  /** Claims in the evidence graph */
  claims: Map<ClaimId, Claim>;
  /** Evidence edges connecting claims */
  evidenceEdges: EvidenceEdge[];
  /** Active defeaters */
  defeaters: ExtendedDefeater[];
  /** Contradictions */
  contradictions: Contradiction[];
}

/**
 * Input data for organizational importance computation.
 */
export interface OrgImportanceInput {
  /** Authorship edges (entity -> author) */
  authorshipEdges: KnowledgeGraphEdge[];
  /** Review edges (entity -> reviewer) */
  reviewEdges?: KnowledgeGraphEdge[];
  /** Expertise scores per author */
  expertiseScores?: Map<string, number>;
}

// ============================================================================
// CODE IMPORTANCE COMPUTATION
// ============================================================================

/**
 * Compute code importance metrics for entities in the code graph.
 *
 * Uses PageRank, betweenness centrality, and hotspot scoring to identify
 * structurally important code entities.
 *
 * @param input - Code graph and hotspot data
 * @param config - Configuration options
 * @returns Map of entity ID to code importance metrics
 */
export function computeCodeImportance(
  input: CodeImportanceInput,
  config: ImportanceConfig = DEFAULT_IMPORTANCE_CONFIG
): Map<string, CodeImportanceMetrics> {
  const results = new Map<string, CodeImportanceMetrics>();
  const { graph, hotspotInputs } = input;

  if (graph.size === 0) {
    return results;
  }

  // Compute PageRank
  const pageRankScores = computePageRank(graph, config.pageRankOptions);

  // Compute betweenness centrality
  const centralityScores = computeBetweennessCentrality(graph);

  // Normalize scores to 0-1 range
  const maxPageRank = Math.max(...Array.from(pageRankScores.values()), 0.001);
  const maxCentrality = Math.max(...Array.from(centralityScores.values()), 0.001);

  // Compute hotspot scores if inputs provided
  const hotspotScores = new Map<string, number>();
  if (hotspotInputs) {
    for (const [entityId, hotspotInput] of hotspotInputs) {
      const score = computeHotspotScore(hotspotInput);
      hotspotScores.set(entityId, score.hotspotScore);
    }
  }

  // Build metrics for each entity
  for (const entityId of graph.keys()) {
    const pageRank = (pageRankScores.get(entityId) ?? 0) / maxPageRank;
    const centrality = (centralityScores.get(entityId) ?? 0) / maxCentrality;
    const hotspotScore = hotspotScores.get(entityId) ?? 0.5;

    // Combined score: weighted average with higher weight on PageRank
    const combined = pageRank * 0.4 + centrality * 0.3 + hotspotScore * 0.3;

    results.set(entityId, {
      pageRank,
      centrality,
      hotspotScore,
      combined: Math.min(1, Math.max(0, combined)),
    });
  }

  return results;
}

// ============================================================================
// RATIONALE IMPORTANCE COMPUTATION
// ============================================================================

/**
 * Compute rationale importance metrics for decisions in the argument graph.
 *
 * Uses argument edge analysis to identify foundational decisions and their
 * impact on the codebase.
 *
 * @param input - Argument edges and decision metadata
 * @param config - Configuration options
 * @returns Map of entity ID to rationale importance metrics
 */
export function computeRationaleImportance(
  input: RationaleImportanceInput,
  config: ImportanceConfig = DEFAULT_IMPORTANCE_CONFIG
): Map<string, RationaleImportanceMetrics> {
  const results = new Map<string, RationaleImportanceMetrics>();
  const { argumentEdges, decisionStatuses, tradeoffCounts, constraintCounts } = input;

  if (argumentEdges.length === 0) {
    return results;
  }

  // Build support graph for foundationality computation
  // Edges: decision -> entities that depend on it
  const supportGraph = new Map<string, Set<string>>();
  const dependencyCount = new Map<string, number>();

  for (const edge of argumentEdges) {
    // Count how many things support/depend on each entity
    if (isSupportEdge(edge) || edge.type === 'depends_on_decision') {
      // edge.sourceId supports edge.targetId
      // So targetId is foundational if many sources support it
      if (!supportGraph.has(edge.targetId)) {
        supportGraph.set(edge.targetId, new Set());
      }
      supportGraph.get(edge.targetId)!.add(edge.sourceId);

      dependencyCount.set(
        edge.targetId,
        (dependencyCount.get(edge.targetId) ?? 0) + 1
      );
    }
  }

  // Compute foundationality using recursive support counting
  const foundationalityScores = computeFoundationality(supportGraph);

  // Normalize foundationality
  const maxFoundationality = Math.max(...Array.from(foundationalityScores.values()), 1);

  // Collect all decision IDs
  const decisionIds = new Set<string>();
  for (const edge of argumentEdges) {
    if (edge.sourceType === 'decision') decisionIds.add(edge.sourceId);
    if (edge.targetType === 'decision') decisionIds.add(edge.targetId);
  }

  // Build metrics for each decision
  for (const decisionId of decisionIds) {
    const foundationality = (foundationalityScores.get(decisionId) ?? 0) / maxFoundationality;

    // Activity score based on status
    const status = decisionStatuses?.get(decisionId) ?? 'accepted';
    const activityScore = {
      accepted: 1.0,
      proposed: 0.5,
      deprecated: 0.3,
      superseded: 0.0,
    }[status];

    // Tradeoff centrality
    const tradeoffs = tradeoffCounts?.get(decisionId) ?? 0;
    const tradeoffCentrality = Math.min(1, tradeoffs / 5); // Normalize: 5+ tradeoffs = 1.0

    // Constraint load
    const constraints = constraintCounts?.get(decisionId) ?? 0;
    const constraintLoad = Math.min(1, constraints / 10); // Normalize: 10+ constraints = 1.0

    // Combined score per RESEARCH-003 formula
    const combined =
      0.5 * foundationality * activityScore +
      0.3 * tradeoffCentrality +
      0.2 * constraintLoad;

    results.set(decisionId, {
      foundationality,
      activityScore,
      tradeoffCentrality,
      constraintLoad,
      combined: Math.min(1, Math.max(0, combined)),
    });
  }

  return results;
}

/**
 * Compute foundationality scores using recursive support counting.
 * A decision is foundational if many other decisions depend on it.
 */
function computeFoundationality(supportGraph: Map<string, Set<string>>): Map<string, number> {
  const scores = new Map<string, number>();
  const visited = new Set<string>();

  function computeScore(entityId: string, depth: number = 0): number {
    if (depth > 10) return 0; // Prevent infinite recursion
    if (scores.has(entityId)) return scores.get(entityId)!;

    visited.add(entityId);

    const supporters = supportGraph.get(entityId) ?? new Set();
    let score = supporters.size;

    // Add recursive scores with damping
    for (const supporter of supporters) {
      if (!visited.has(supporter)) {
        score += 0.5 * computeScore(supporter, depth + 1);
      }
    }

    visited.delete(entityId);
    scores.set(entityId, score);
    return score;
  }

  for (const entityId of supportGraph.keys()) {
    computeScore(entityId);
  }

  return scores;
}

// ============================================================================
// EPISTEMIC IMPORTANCE COMPUTATION
// ============================================================================

/**
 * Compute epistemic importance metrics for claims in the evidence graph.
 *
 * Uses evidence chain analysis to identify load-bearing claims and their
 * vulnerability to defeat.
 *
 * @param input - Claims, evidence edges, defeaters, and contradictions
 * @param config - Configuration options
 * @returns Map of claim ID to epistemic importance metrics
 */
export function computeEpistemicImportance(
  input: EpistemicImportanceInput,
  config: ImportanceConfig = DEFAULT_IMPORTANCE_CONFIG
): Map<string, EpistemicImportanceMetrics> {
  const results = new Map<string, EpistemicImportanceMetrics>();
  const { claims, evidenceEdges, defeaters, contradictions } = input;

  if (claims.size === 0) {
    return results;
  }

  // Build dependency graph for epistemic load computation
  // Edge: claim A supports/assumes claim B
  const dependencyGraph = new Map<string, Set<string>>();
  const supportingClaims = new Map<string, Set<string>>();

  for (const edge of evidenceEdges) {
    const supportTypes: EdgeType[] = ['supports', 'assumes', 'depends_on'];
    if (supportTypes.includes(edge.type)) {
      // fromClaimId supports toClaimId
      if (!dependencyGraph.has(edge.toClaimId)) {
        dependencyGraph.set(edge.toClaimId, new Set());
      }
      dependencyGraph.get(edge.toClaimId)!.add(edge.fromClaimId);

      // Track what supports each claim for evidence depth
      if (!supportingClaims.has(edge.toClaimId)) {
        supportingClaims.set(edge.toClaimId, new Set());
      }
      supportingClaims.get(edge.toClaimId)!.add(edge.fromClaimId);
    }
  }

  // Compute epistemic load (fan-out with damping)
  const epistemicLoadScores = computeEpistemicLoad(dependencyGraph);

  // Compute evidence depth for each claim
  const evidenceDepthScores = computeEvidenceDepth(supportingClaims);

  // Build defeater index for vulnerability computation
  const defeatersByClaim = new Map<string, ExtendedDefeater[]>();
  for (const defeater of defeaters) {
    for (const claimId of defeater.affectedClaimIds) {
      if (!defeatersByClaim.has(claimId)) {
        defeatersByClaim.set(claimId, []);
      }
      defeatersByClaim.get(claimId)!.push(defeater);
    }
  }

  // Build contradiction index
  const contradictionsByClaim = new Map<string, Contradiction[]>();
  for (const contradiction of contradictions) {
    if (!contradictionsByClaim.has(contradiction.claimA)) {
      contradictionsByClaim.set(contradiction.claimA, []);
    }
    if (!contradictionsByClaim.has(contradiction.claimB)) {
      contradictionsByClaim.set(contradiction.claimB, []);
    }
    contradictionsByClaim.get(contradiction.claimA)!.push(contradiction);
    contradictionsByClaim.get(contradiction.claimB)!.push(contradiction);
  }

  // Normalize scores
  const maxLoad = Math.max(...Array.from(epistemicLoadScores.values()), 1);
  const maxDepth = Math.max(...Array.from(evidenceDepthScores.values()), 1);

  // Build metrics for each claim
  for (const [claimId, claim] of claims) {
    const epistemicLoad = (epistemicLoadScores.get(claimId) ?? 0) / maxLoad;
    const evidenceDepth = (evidenceDepthScores.get(claimId) ?? 0) / maxDepth;

    // Compute defeater vulnerability
    const claimDefeaters = defeatersByClaim.get(claimId) ?? [];
    const activeDefeaters = claimDefeaters.filter(d => d.status === 'active');
    const pendingDefeaters = claimDefeaters.filter(d => d.status === 'pending');

    const defeaterVulnerability = Math.min(
      1,
      activeDefeaters.length * 0.3 + pendingDefeaters.length * 0.1
    );

    // Factor in contradictions
    const claimContradictions = contradictionsByClaim.get(claimId) ?? [];
    const blockingContradictions = claimContradictions.filter(c => c.severity === 'blocking');
    const contradictionPenalty = Math.min(1, blockingContradictions.length * 0.5);

    // Combined score per RESEARCH-003 formula
    // High load + high evidence + low vulnerability = high importance
    const inverseVulnerability = 1 - defeaterVulnerability;
    const combined =
      (epistemicLoad * evidenceDepth * inverseVulnerability) /
      (1 + contradictionPenalty);

    results.set(claimId, {
      epistemicLoad,
      evidenceDepth,
      defeaterVulnerability,
      combined: Math.min(1, Math.max(0, combined)),
    });
  }

  return results;
}

/**
 * Compute epistemic load (support fan-out with damping).
 * A claim has high load if many other claims depend on it.
 */
function computeEpistemicLoad(dependencyGraph: Map<string, Set<string>>): Map<string, number> {
  const scores = new Map<string, number>();
  const visited = new Set<string>();

  function computeScore(claimId: string, depth: number = 0): number {
    if (depth > 10) return 0;
    if (scores.has(claimId)) return scores.get(claimId)!;

    visited.add(claimId);

    const dependents = dependencyGraph.get(claimId) ?? new Set();
    let score = dependents.size;

    for (const dependent of dependents) {
      if (!visited.has(dependent)) {
        score += 0.5 * computeScore(dependent, depth + 1); // Damping factor
      }
    }

    visited.delete(claimId);
    scores.set(claimId, score);
    return score;
  }

  for (const claimId of dependencyGraph.keys()) {
    computeScore(claimId);
  }

  return scores;
}

/**
 * Compute evidence depth for each claim.
 * Deeper evidence chains provide more support but also more fragility.
 */
function computeEvidenceDepth(supportingClaims: Map<string, Set<string>>): Map<string, number> {
  const depths = new Map<string, number>();
  const visited = new Set<string>();

  function computeDepth(claimId: string): number {
    if (depths.has(claimId)) return depths.get(claimId)!;
    if (visited.has(claimId)) return 0;

    visited.add(claimId);

    const supporters = supportingClaims.get(claimId) ?? new Set();
    if (supporters.size === 0) {
      depths.set(claimId, 1);
      visited.delete(claimId);
      return 1;
    }

    let maxSupporterDepth = 0;
    for (const supporter of supporters) {
      maxSupporterDepth = Math.max(maxSupporterDepth, computeDepth(supporter));
    }

    const depth = 1 + maxSupporterDepth;
    depths.set(claimId, depth);
    visited.delete(claimId);
    return depth;
  }

  for (const claimId of supportingClaims.keys()) {
    computeDepth(claimId);
  }

  return depths;
}

// ============================================================================
// ORGANIZATIONAL IMPORTANCE COMPUTATION
// ============================================================================

/**
 * Compute organizational importance metrics for code entities.
 *
 * Uses authorship and review data to identify ownership concentration
 * and expertise depth.
 *
 * @param input - Authorship and review edges
 * @param config - Configuration options
 * @returns Map of entity ID to org importance metrics
 */
export function computeOrgImportance(
  input: OrgImportanceInput,
  config: ImportanceConfig = DEFAULT_IMPORTANCE_CONFIG
): Map<string, OrgImportanceMetrics> {
  const results = new Map<string, OrgImportanceMetrics>();
  const { authorshipEdges, reviewEdges, expertiseScores } = input;

  if (authorshipEdges.length === 0) {
    return results;
  }

  // Group authorship by entity
  const authorshipByEntity = new Map<string, Array<{ author: string; weight: number }>>();
  for (const edge of authorshipEdges) {
    if (edge.edgeType !== 'authored_by') continue;

    if (!authorshipByEntity.has(edge.sourceId)) {
      authorshipByEntity.set(edge.sourceId, []);
    }
    authorshipByEntity.get(edge.sourceId)!.push({
      author: edge.targetId,
      weight: edge.weight,
    });
  }

  // Group reviews by entity
  const reviewsByEntity = new Map<string, number>();
  if (reviewEdges) {
    for (const edge of reviewEdges) {
      if (edge.edgeType !== 'reviewed_by') continue;
      reviewsByEntity.set(
        edge.sourceId,
        (reviewsByEntity.get(edge.sourceId) ?? 0) + 1
      );
    }
  }

  // Build metrics for each entity
  for (const [entityId, authors] of authorshipByEntity) {
    // Compute ownership concentration (inverse of entropy)
    const ownershipConcentration = computeOwnershipConcentration(authors);

    // Compute expertise depth
    let expertiseDepth = 0;
    for (const { author, weight } of authors) {
      const authorExpertise = expertiseScores?.get(author) ?? 0.5;
      expertiseDepth += weight * authorExpertise;
    }
    expertiseDepth = Math.min(1, expertiseDepth);

    // Compute review coverage
    const reviewCount = reviewsByEntity.get(entityId) ?? 0;
    const reviewCoverage = Math.min(1, reviewCount / 5); // Normalize: 5+ reviews = 1.0

    // Combined score
    // High expertise + high review coverage + low concentration = high importance
    const inverseConcentration = 1 - ownershipConcentration;
    const combined =
      0.3 * inverseConcentration +
      0.4 * expertiseDepth +
      0.3 * reviewCoverage;

    results.set(entityId, {
      ownershipConcentration,
      expertiseDepth,
      reviewCoverage,
      combined: Math.min(1, Math.max(0, combined)),
    });
  }

  return results;
}

/**
 * Compute ownership concentration using entropy.
 * 0 = evenly distributed, 1 = single owner.
 */
function computeOwnershipConcentration(
  authors: Array<{ author: string; weight: number }>
): number {
  if (authors.length <= 1) return 1.0;

  // Normalize weights
  const totalWeight = authors.reduce((sum, a) => sum + a.weight, 0);
  if (totalWeight === 0) return 1.0;

  const probabilities = authors.map(a => a.weight / totalWeight);

  // Compute entropy
  let entropy = 0;
  for (const p of probabilities) {
    if (p > 0) {
      entropy -= p * Math.log2(p);
    }
  }

  // Maximum entropy for n authors
  const maxEntropy = Math.log2(authors.length);

  // Concentration = 1 - normalized entropy
  return maxEntropy > 0 ? 1 - (entropy / maxEntropy) : 1.0;
}

// ============================================================================
// UNIFIED IMPORTANCE COMPUTATION
// ============================================================================

/**
 * Compute unified importance score from per-graph metrics.
 *
 * @param code - Code importance metrics
 * @param rationale - Rationale importance metrics
 * @param epistemic - Epistemic importance metrics
 * @param org - Organizational importance metrics
 * @param crossGraphInfluence - Cross-graph influence score
 * @param config - Configuration options
 * @returns Unified importance score (0-1)
 */
export function computeUnifiedImportance(
  code: CodeImportanceMetrics,
  rationale: RationaleImportanceMetrics,
  epistemic: EpistemicImportanceMetrics,
  org: OrgImportanceMetrics,
  crossGraphInfluence: number,
  config: ImportanceConfig = DEFAULT_IMPORTANCE_CONFIG
): number {
  const { weights } = config;

  const unified =
    weights.code * code.combined +
    weights.rationale * rationale.combined +
    weights.epistemic * epistemic.combined +
    weights.org * org.combined +
    weights.crossGraph * crossGraphInfluence;

  return Math.min(1, Math.max(0, unified));
}

/**
 * Compute importance flags based on metrics and thresholds.
 *
 * @param code - Code importance metrics
 * @param rationale - Rationale importance metrics
 * @param epistemic - Epistemic importance metrics
 * @param org - Organizational importance metrics
 * @param unified - Unified importance score
 * @param confidence - Entity confidence score (0-1, optional)
 * @param config - Configuration options
 * @returns Interpretive flags
 */
export function computeImportanceFlags(
  code: CodeImportanceMetrics,
  rationale: RationaleImportanceMetrics,
  epistemic: EpistemicImportanceMetrics,
  org: OrgImportanceMetrics,
  unified: number,
  confidence: number = 1.0,
  config: ImportanceConfig = DEFAULT_IMPORTANCE_CONFIG
): ImportanceFlags {
  const { thresholds } = config;

  return {
    // Load-bearing: high importance in any graph
    isLoadBearing:
      code.combined >= thresholds.loadBearing ||
      rationale.combined >= thresholds.loadBearing ||
      epistemic.combined >= thresholds.loadBearing,

    // Foundational: many things depend on it
    isFoundational:
      rationale.foundationality >= thresholds.foundational ||
      epistemic.epistemicLoad >= thresholds.foundational,

    // At risk: high importance + low confidence
    isAtRisk:
      unified >= thresholds.atRisk &&
      confidence < 0.5,

    // Needs validation: evidence is stale or weak
    needsValidation:
      epistemic.defeaterVulnerability >= thresholds.needsValidation ||
      (epistemic.evidenceDepth < 0.3 && epistemic.epistemicLoad >= 0.5),

    // Truck factor risk: single owner
    hasTruckFactorRisk:
      org.ownershipConcentration >= thresholds.truckFactor,

    // Hotspot: high churn + high complexity
    isHotspot:
      code.hotspotScore >= thresholds.hotspot,
  };
}

// ============================================================================
// CROSS-GRAPH IMPORTANCE PROPAGATION
// ============================================================================

/**
 * Compute cross-graph influence for an entity.
 *
 * Cross-graph influence measures how importance flows between graphs:
 * - A function documented by a foundational decision has higher influence
 * - A decision justified by load-bearing claims has higher influence
 *
 * @param entityId - Entity identifier
 * @param codeMetrics - Code importance for all entities
 * @param rationaleMetrics - Rationale importance for all entities
 * @param epistemicMetrics - Epistemic importance for all entities
 * @param crossGraphEdges - Edges connecting graphs
 * @returns Cross-graph influence score (0-1)
 */
export function computeCrossGraphInfluence(
  entityId: string,
  codeMetrics: Map<string, CodeImportanceMetrics>,
  rationaleMetrics: Map<string, RationaleImportanceMetrics>,
  epistemicMetrics: Map<string, EpistemicImportanceMetrics>,
  crossGraphEdges: KnowledgeGraphEdge[]
): number {
  // Find edges connected to this entity
  const incomingEdges = crossGraphEdges.filter(e => e.targetId === entityId);
  const outgoingEdges = crossGraphEdges.filter(e => e.sourceId === entityId);

  if (incomingEdges.length === 0 && outgoingEdges.length === 0) {
    return 0;
  }

  // Damping factors by edge type
  const dampingFactors: Partial<Record<KnowledgeEdgeType, number>> = {
    documents: 0.8,
    depends_on: 0.7,
    tests: 0.9,
    part_of: 0.3,
    similar_to: 0.2,
  };

  let incomingInfluence = 0;
  for (const edge of incomingEdges) {
    const damping = dampingFactors[edge.edgeType] ?? 0.5;

    // Get importance from source based on its graph type
    let sourceImportance = 0;
    if (codeMetrics.has(edge.sourceId)) {
      sourceImportance = codeMetrics.get(edge.sourceId)!.combined;
    } else if (rationaleMetrics.has(edge.sourceId)) {
      sourceImportance = rationaleMetrics.get(edge.sourceId)!.combined;
    } else if (epistemicMetrics.has(edge.sourceId)) {
      sourceImportance = epistemicMetrics.get(edge.sourceId)!.combined;
    }

    incomingInfluence += damping * sourceImportance * edge.weight;
  }

  // Bidirectional: also consider outgoing influence
  let outgoingInfluence = 0;
  for (const edge of outgoingEdges) {
    const reverseDamping = (dampingFactors[edge.edgeType] ?? 0.5) * 0.5; // Lower for reverse

    let targetImportance = 0;
    if (codeMetrics.has(edge.targetId)) {
      targetImportance = codeMetrics.get(edge.targetId)!.combined;
    } else if (rationaleMetrics.has(edge.targetId)) {
      targetImportance = rationaleMetrics.get(edge.targetId)!.combined;
    } else if (epistemicMetrics.has(edge.targetId)) {
      targetImportance = epistemicMetrics.get(edge.targetId)!.combined;
    }

    outgoingInfluence += reverseDamping * targetImportance * edge.weight;
  }

  // Combine with preference for incoming influence
  const totalInfluence = 0.7 * incomingInfluence + 0.3 * outgoingInfluence;

  // Normalize by edge count to avoid unbounded growth
  const edgeCount = incomingEdges.length + outgoingEdges.length;
  return Math.min(1, totalInfluence / Math.max(1, edgeCount * 0.5));
}

// ============================================================================
// COMPLETE IMPORTANCE PROFILE COMPUTATION
// ============================================================================

/**
 * Compute a complete importance profile for an entity.
 *
 * This is the main entry point for computing all importance metrics.
 *
 * @param entityId - Entity identifier
 * @param entityType - Entity type
 * @param codeMetrics - Pre-computed code metrics (or will use defaults)
 * @param rationaleMetrics - Pre-computed rationale metrics (or will use defaults)
 * @param epistemicMetrics - Pre-computed epistemic metrics (or will use defaults)
 * @param orgMetrics - Pre-computed org metrics (or will use defaults)
 * @param crossGraphEdges - Cross-graph edges for influence computation
 * @param confidence - Entity confidence score (0-1, optional)
 * @param config - Configuration options
 * @returns Complete importance profile
 */
export function computeImportanceProfile(
  entityId: string,
  entityType: ImportanceProfile['entityType'],
  codeMetrics: Map<string, CodeImportanceMetrics>,
  rationaleMetrics: Map<string, RationaleImportanceMetrics>,
  epistemicMetrics: Map<string, EpistemicImportanceMetrics>,
  orgMetrics: Map<string, OrgImportanceMetrics>,
  crossGraphEdges: KnowledgeGraphEdge[] = [],
  confidence: number = 1.0,
  config: ImportanceConfig = DEFAULT_IMPORTANCE_CONFIG
): ImportanceProfile {
  // Get per-graph metrics with defaults
  const code = codeMetrics.get(entityId) ?? createDefaultCodeMetrics();
  const rationale = rationaleMetrics.get(entityId) ?? createDefaultRationaleMetrics();
  const epistemic = epistemicMetrics.get(entityId) ?? createDefaultEpistemicMetrics();
  const org = orgMetrics.get(entityId) ?? createDefaultOrgMetrics();

  // Compute cross-graph influence
  const crossGraphInfluence = computeCrossGraphInfluence(
    entityId,
    codeMetrics,
    rationaleMetrics,
    epistemicMetrics,
    crossGraphEdges
  );

  // Compute unified score
  const unified = computeUnifiedImportance(
    code,
    rationale,
    epistemic,
    org,
    crossGraphInfluence,
    config
  );

  // Compute flags
  const flags = computeImportanceFlags(
    code,
    rationale,
    epistemic,
    org,
    unified,
    confidence,
    config
  );

  return {
    entityId,
    entityType,
    codeImportance: code,
    rationaleImportance: rationale,
    epistemicImportance: epistemic,
    orgImportance: org,
    unified,
    crossGraphInfluence,
    flags,
    computedAt: new Date().toISOString(),
  };
}

// ============================================================================
// DEFAULT METRICS FACTORIES
// ============================================================================

/**
 * Create default code importance metrics (neutral state).
 */
export function createDefaultCodeMetrics(): CodeImportanceMetrics {
  return {
    pageRank: 0.5,
    centrality: 0.5,
    hotspotScore: 0.5,
    combined: 0.5,
  };
}

/**
 * Create default rationale importance metrics (neutral state).
 */
export function createDefaultRationaleMetrics(): RationaleImportanceMetrics {
  return {
    foundationality: 0,
    activityScore: 1.0,
    tradeoffCentrality: 0,
    constraintLoad: 0,
    combined: 0.5,
  };
}

/**
 * Create default epistemic importance metrics (neutral state).
 */
export function createDefaultEpistemicMetrics(): EpistemicImportanceMetrics {
  return {
    epistemicLoad: 0,
    evidenceDepth: 0,
    defeaterVulnerability: 0,
    combined: 0.5,
  };
}

/**
 * Create default organizational importance metrics (neutral state).
 */
export function createDefaultOrgMetrics(): OrgImportanceMetrics {
  return {
    ownershipConcentration: 0.5,
    expertiseDepth: 0.5,
    reviewCoverage: 0.5,
    combined: 0.5,
  };
}

// ============================================================================
// BATCH COMPUTATION
// ============================================================================

/**
 * Options for batch importance computation.
 */
export interface BatchImportanceOptions {
  /** Code graph and hotspot data */
  codeInput?: CodeImportanceInput;
  /** Rationale/argument data */
  rationaleInput?: RationaleImportanceInput;
  /** Epistemic/evidence data */
  epistemicInput?: EpistemicImportanceInput;
  /** Organizational data */
  orgInput?: OrgImportanceInput;
  /** Cross-graph edges */
  crossGraphEdges?: KnowledgeGraphEdge[];
  /** Entity confidence scores */
  confidenceScores?: Map<string, number>;
  /** Configuration */
  config?: ImportanceConfig;
}

/**
 * Result of batch importance computation.
 */
export interface BatchImportanceResult {
  /** All computed profiles */
  profiles: Map<string, ImportanceProfile>;
  /** Summary statistics */
  summary: {
    totalEntities: number;
    loadBearingCount: number;
    foundationalCount: number;
    atRiskCount: number;
    needsValidationCount: number;
    hotspotCount: number;
    truckFactorRiskCount: number;
    avgUnifiedScore: number;
  };
  /** When computed */
  computedAt: string;
}

/**
 * Compute importance profiles for all entities in batch.
 *
 * This is the most efficient way to compute profiles for many entities,
 * as it computes per-graph metrics once and reuses them.
 *
 * @param options - Batch computation options
 * @returns Batch computation result
 */
export function computeBatchImportance(options: BatchImportanceOptions): BatchImportanceResult {
  const config = options.config ?? DEFAULT_IMPORTANCE_CONFIG;
  const now = new Date().toISOString();

  // Compute per-graph metrics
  const codeMetrics = options.codeInput
    ? computeCodeImportance(options.codeInput, config)
    : new Map<string, CodeImportanceMetrics>();

  const rationaleMetrics = options.rationaleInput
    ? computeRationaleImportance(options.rationaleInput, config)
    : new Map<string, RationaleImportanceMetrics>();

  const epistemicMetrics = options.epistemicInput
    ? computeEpistemicImportance(options.epistemicInput, config)
    : new Map<string, EpistemicImportanceMetrics>();

  const orgMetrics = options.orgInput
    ? computeOrgImportance(options.orgInput, config)
    : new Map<string, OrgImportanceMetrics>();

  // Collect all entity IDs
  const allEntityIds = new Set<string>([
    ...codeMetrics.keys(),
    ...rationaleMetrics.keys(),
    ...epistemicMetrics.keys(),
    ...orgMetrics.keys(),
  ]);

  // Compute profiles for all entities
  const profiles = new Map<string, ImportanceProfile>();
  const crossGraphEdges = options.crossGraphEdges ?? [];
  const confidenceScores = options.confidenceScores ?? new Map<string, number>();

  // Track summary stats
  let loadBearingCount = 0;
  let foundationalCount = 0;
  let atRiskCount = 0;
  let needsValidationCount = 0;
  let hotspotCount = 0;
  let truckFactorRiskCount = 0;
  let totalUnified = 0;

  for (const entityId of allEntityIds) {
    // Infer entity type from which graph it belongs to
    let entityType: ImportanceProfile['entityType'] = 'function';
    if (rationaleMetrics.has(entityId)) {
      entityType = 'decision';
    } else if (epistemicMetrics.has(entityId)) {
      entityType = 'claim';
    }

    const confidence = confidenceScores.get(entityId) ?? 1.0;

    const profile = computeImportanceProfile(
      entityId,
      entityType,
      codeMetrics,
      rationaleMetrics,
      epistemicMetrics,
      orgMetrics,
      crossGraphEdges,
      confidence,
      config
    );

    profiles.set(entityId, profile);

    // Update summary stats
    if (profile.flags.isLoadBearing) loadBearingCount++;
    if (profile.flags.isFoundational) foundationalCount++;
    if (profile.flags.isAtRisk) atRiskCount++;
    if (profile.flags.needsValidation) needsValidationCount++;
    if (profile.flags.isHotspot) hotspotCount++;
    if (profile.flags.hasTruckFactorRisk) truckFactorRiskCount++;
    totalUnified += profile.unified;
  }

  return {
    profiles,
    summary: {
      totalEntities: allEntityIds.size,
      loadBearingCount,
      foundationalCount,
      atRiskCount,
      needsValidationCount,
      hotspotCount,
      truckFactorRiskCount,
      avgUnifiedScore: allEntityIds.size > 0 ? totalUnified / allEntityIds.size : 0,
    },
    computedAt: now,
  };
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
  // Re-export types that may be useful for consumers
  type PageRankOptions,
  type HotspotInput,
  type HotspotScore,
};
