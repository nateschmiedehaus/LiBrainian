/**
 * @fileoverview Argument Edge Query Helpers
 *
 * Provides specialized query functions for traversing argument edges in the
 * knowledge graph. These helpers make it easy to answer questions like:
 * - "What supports this decision?"
 * - "What contradicts this approach?"
 * - "Show me the decision chain for this ADR"
 *
 * Based on the Toulmin-IBIS argumentation framework from Task #15.
 *
 * @see docs/research/ARGUMENTATION-STRUCTURES-FOR-CODE-REASONING.md
 */

import type {
  LiBrainianStorage,
  KnowledgeGraphEdge,
  KnowledgeEdgeType,
  ArgumentEdge,
  ArgumentEdgeType,
  ArgumentEntityType,
  ArgumentEdgeQueryOptions,
  KnowledgeEdgeQueryOptions,
} from '../storage/types.js';
import {
  isArgumentEdge,
  isArgumentEdgeType,
  isSupportEdge,
  isConflictEdge,
  isDecisionChainEdge,
  ARGUMENT_EDGE_TYPES,
} from '../storage/types.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Options for argument edge queries.
 */
export interface ArgumentEdgeFilterOptions {
  /** Minimum weight threshold (0-1) */
  minWeight?: number;
  /** Minimum confidence threshold (0-1) */
  minConfidence?: number;
  /** Maximum number of edges to return */
  limit?: number;
  /** Include only edges extracted from specific sources */
  extractedFrom?: Array<'adr' | 'comment' | 'commit' | 'llm_inference' | 'manual'>;
  /** Order by weight, confidence, or computed time */
  orderBy?: 'weight' | 'confidence' | 'computed_at';
  /** Sort direction */
  orderDirection?: 'asc' | 'desc';
}

/**
 * Result of an argument edge query with metadata.
 */
export interface ArgumentEdgeQueryResult {
  /** The edges matching the query */
  edges: ArgumentEdge[];
  /** Total count before limit was applied */
  totalCount: number;
  /** The entity ID that was queried */
  entityId: string;
  /** The edge types that were searched */
  edgeTypesSearched: ArgumentEdgeType[];
}

/**
 * Decision chain traversal result.
 */
export interface DecisionChainResult {
  /** The root decision being analyzed */
  rootDecisionId: string;
  /** Chain of decisions that this decision supersedes (older decisions) */
  supersedes: ArgumentEdge[];
  /** Chain of decisions that supersede this one (newer decisions) */
  supersededBy: ArgumentEdge[];
  /** Decisions this one depends on */
  dependencies: ArgumentEdge[];
  /** Decisions that depend on this one */
  dependents: ArgumentEdge[];
  /** Full chain depth (how many levels of supersession) */
  chainDepth: number;
}

/**
 * Supporting evidence summary for a decision.
 */
export interface SupportingEvidenceResult {
  /** The decision being analyzed */
  decisionId: string;
  /** Direct supporting edges */
  supports: ArgumentEdge[];
  /** Warrant edges (reasoning principles) */
  warrants: ArgumentEdge[];
  /** Total support strength (average weight of support edges) */
  totalSupportStrength: number;
  /** Confidence in the support assessment */
  confidence: number;
}

/**
 * Contradiction analysis result.
 */
export interface ContradictionResult {
  /** The entity being analyzed */
  entityId: string;
  /** Direct contradiction edges */
  contradictions: ArgumentEdge[];
  /** Undermining edges (attacks on premises) */
  undermines: ArgumentEdge[];
  /** Rebuttal edges (defeating conditions) */
  rebuttals: ArgumentEdge[];
  /** Total conflict count */
  totalConflicts: number;
  /** Severity assessment based on conflict types and weights */
  severity: 'low' | 'medium' | 'high' | 'critical';
}

// ============================================================================
// CORE QUERY FUNCTIONS
// ============================================================================

/**
 * Get argument edges for an entity.
 *
 * Retrieves all argument edges where the entity is either the source or target.
 * Filters by edge type if specified.
 *
 * @param storage - The librainian storage instance
 * @param entityId - The entity ID to query (decision, constraint, etc.)
 * @param options - Query options
 * @returns Array of argument edges
 *
 * @example
 * ```typescript
 * // Get all supporting edges for ADR-001
 * const edges = await getArgumentEdgesForEntity(storage, 'ADR-001', {
 *   edgeTypes: ['supports', 'warrants'],
 * });
 * ```
 */
export async function getArgumentEdgesForEntity(
  storage: LiBrainianStorage,
  entityId: string,
  options?: ArgumentEdgeFilterOptions & { edgeTypes?: ArgumentEdgeType[] }
): Promise<ArgumentEdgeQueryResult> {
  const {
    minWeight = 0,
    minConfidence = 0,
    limit = 100,
    edgeTypes,
    orderBy = 'weight',
    orderDirection = 'desc',
  } = options ?? {};

  // Get edges where entity is source
  const fromEdges = await storage.getKnowledgeEdgesFrom(entityId);

  // Get edges where entity is target
  const toEdges = await storage.getKnowledgeEdgesTo(entityId);

  // Combine and filter to argument edges
  const allEdges = [...fromEdges, ...toEdges];
  let argumentEdges = allEdges
    .filter((edge): edge is KnowledgeGraphEdge & { edgeType: ArgumentEdgeType } => {
      return isArgumentEdgeType(edge.edgeType);
    })
    .map((edge) => knowledgeEdgeToArgumentEdge(edge));

  // Apply edge type filter
  if (edgeTypes && edgeTypes.length > 0) {
    argumentEdges = argumentEdges.filter((edge) => edgeTypes.includes(edge.type));
  }

  // Apply weight and confidence filters
  argumentEdges = argumentEdges.filter(
    (edge) => edge.weight >= minWeight && edge.confidence >= minConfidence
  );

  const totalCount = argumentEdges.length;

  // Sort
  argumentEdges.sort((a, b) => {
    const aVal = orderBy === 'weight' ? a.weight : orderBy === 'confidence' ? a.confidence : new Date(a.computedAt).getTime();
    const bVal = orderBy === 'weight' ? b.weight : orderBy === 'confidence' ? b.confidence : new Date(b.computedAt).getTime();
    return orderDirection === 'desc' ? bVal - aVal : aVal - bVal;
  });

  // Apply limit
  argumentEdges = argumentEdges.slice(0, limit);

  return {
    edges: argumentEdges,
    totalCount,
    entityId,
    edgeTypesSearched: edgeTypes ?? [...ARGUMENT_EDGE_TYPES],
  };
}

/**
 * Get supporting evidence for a decision.
 *
 * Retrieves all edges that support a decision, including:
 * - 'supports' edges (direct evidence)
 * - 'warrants' edges (reasoning principles)
 *
 * @param storage - The librainian storage instance
 * @param decisionId - The decision entity ID
 * @returns Supporting evidence result
 *
 * @example
 * ```typescript
 * // Get all evidence supporting ADR-015-redis-cache
 * const evidence = await getSupportingEvidence(storage, 'adr-015-redis-cache');
 * console.log(`Decision has ${evidence.supports.length} supporting edges`);
 * ```
 */
export async function getSupportingEvidence(
  storage: LiBrainianStorage,
  decisionId: string
): Promise<SupportingEvidenceResult> {
  // Get edges where decision is the target (being supported)
  const toEdges = await storage.getKnowledgeEdgesTo(decisionId);

  // Filter to support-type argument edges
  const argumentEdges = toEdges
    .filter((edge) => isArgumentEdgeType(edge.edgeType))
    .map((edge) => knowledgeEdgeToArgumentEdge(edge));

  const supports = argumentEdges.filter((edge) => edge.type === 'supports');
  const warrants = argumentEdges.filter((edge) => edge.type === 'warrants');

  // Calculate total support strength
  const allSupportEdges = [...supports, ...warrants];
  const totalSupportStrength =
    allSupportEdges.length > 0
      ? allSupportEdges.reduce((sum, edge) => sum + edge.weight, 0) / allSupportEdges.length
      : 0;

  // Calculate confidence based on evidence quantity and quality
  const evidenceCount = allSupportEdges.length;
  const avgConfidence =
    allSupportEdges.length > 0
      ? allSupportEdges.reduce((sum, edge) => sum + edge.confidence, 0) / allSupportEdges.length
      : 0;

  // Confidence increases with more evidence, capped at 0.95
  const confidence = Math.min(0.95, avgConfidence * (1 + Math.log10(evidenceCount + 1) * 0.1));

  return {
    decisionId,
    supports,
    warrants,
    totalSupportStrength,
    confidence,
  };
}

/**
 * Get contradictions and conflicts for an entity.
 *
 * Retrieves all edges that represent conflicts with the entity, including:
 * - 'contradicts' edges (mutual exclusion)
 * - 'undermines' edges (attacks on premises)
 * - 'rebuts' edges (defeating conditions)
 *
 * @param storage - The librainian storage instance
 * @param entityId - The entity ID to analyze
 * @returns Contradiction analysis result
 *
 * @example
 * ```typescript
 * // Find all contradictions to assumption-001
 * const conflicts = await getContradictions(storage, 'assumption-001');
 * if (conflicts.severity === 'high') {
 *   console.warn('This assumption has significant challenges');
 * }
 * ```
 */
export async function getContradictions(
  storage: LiBrainianStorage,
  entityId: string
): Promise<ContradictionResult> {
  // Get edges both from and to the entity
  const fromEdges = await storage.getKnowledgeEdgesFrom(entityId);
  const toEdges = await storage.getKnowledgeEdgesTo(entityId);
  const allEdges = [...fromEdges, ...toEdges];

  // Filter to conflict-type argument edges
  const argumentEdges = allEdges
    .filter((edge) => isArgumentEdgeType(edge.edgeType))
    .map((edge) => knowledgeEdgeToArgumentEdge(edge))
    .filter(isConflictEdge);

  const contradictions = argumentEdges.filter((edge) => edge.type === 'contradicts');
  const undermines = argumentEdges.filter((edge) => edge.type === 'undermines');
  const rebuttals = argumentEdges.filter((edge) => edge.type === 'rebuts');

  const totalConflicts = argumentEdges.length;

  // Assess severity based on conflict types and weights
  let severity: ContradictionResult['severity'] = 'low';
  if (totalConflicts > 0) {
    const avgWeight = argumentEdges.reduce((sum, e) => sum + e.weight, 0) / totalConflicts;
    const hasStrictRebuttals = rebuttals.some((e) => e.metadata?.ruleType === 'strict');

    if (hasStrictRebuttals || (totalConflicts >= 3 && avgWeight >= 0.8)) {
      severity = 'critical';
    } else if (totalConflicts >= 2 || avgWeight >= 0.7) {
      severity = 'high';
    } else if (avgWeight >= 0.5) {
      severity = 'medium';
    }
  }

  return {
    entityId,
    contradictions,
    undermines,
    rebuttals,
    totalConflicts,
    severity,
  };
}

/**
 * Traverse the decision chain for a decision.
 *
 * Retrieves the full chain of decisions related through:
 * - 'supersedes' edges (replacement chain)
 * - 'depends_on_decision' edges (dependency chain)
 *
 * @param storage - The librainian storage instance
 * @param decisionId - The decision ID to start from
 * @param options - Query options
 * @returns Decision chain traversal result
 *
 * @example
 * ```typescript
 * // Get the evolution history of ADR-015
 * const chain = await getDecisionChain(storage, 'ADR-015');
 * console.log(`This decision supersedes ${chain.supersedes.length} older decisions`);
 * console.log(`Chain depth: ${chain.chainDepth}`);
 * ```
 */
export async function getDecisionChain(
  storage: LiBrainianStorage,
  decisionId: string,
  options?: { maxDepth?: number }
): Promise<DecisionChainResult> {
  const { maxDepth = 10 } = options ?? {};

  const supersedes: ArgumentEdge[] = [];
  const supersededBy: ArgumentEdge[] = [];
  const dependencies: ArgumentEdge[] = [];
  const dependents: ArgumentEdge[] = [];

  // Get direct edges
  const fromEdges = await storage.getKnowledgeEdgesFrom(decisionId);
  const toEdges = await storage.getKnowledgeEdgesTo(decisionId);

  // Process edges where this decision is the source
  for (const edge of fromEdges) {
    if (!isArgumentEdgeType(edge.edgeType)) continue;
    const argEdge = knowledgeEdgeToArgumentEdge(edge);
    if (argEdge.type === 'supersedes') {
      supersedes.push(argEdge);
    } else if (argEdge.type === 'depends_on_decision') {
      dependencies.push(argEdge);
    }
  }

  // Process edges where this decision is the target
  for (const edge of toEdges) {
    if (!isArgumentEdgeType(edge.edgeType)) continue;
    const argEdge = knowledgeEdgeToArgumentEdge(edge);
    if (argEdge.type === 'supersedes') {
      supersededBy.push(argEdge);
    } else if (argEdge.type === 'depends_on_decision') {
      dependents.push(argEdge);
    }
  }

  // Calculate chain depth by traversing supersession chain
  let chainDepth = 0;
  const visited = new Set<string>([decisionId]);
  let currentIds = supersedes.map((e) => e.targetId);

  while (currentIds.length > 0 && chainDepth < maxDepth) {
    chainDepth++;
    const nextIds: string[] = [];

    for (const id of currentIds) {
      if (visited.has(id)) continue;
      visited.add(id);

      const edges = await storage.getKnowledgeEdgesFrom(id);
      for (const edge of edges) {
        // Check for supersedes edge type (argument edge type stored in edgeType field)
        if ((edge.edgeType as string) === 'supersedes' && !visited.has(edge.targetId)) {
          nextIds.push(edge.targetId);
        }
      }
    }

    currentIds = nextIds;
  }

  return {
    rootDecisionId: decisionId,
    supersedes,
    supersededBy,
    dependencies,
    dependents,
    chainDepth,
  };
}

// ============================================================================
// EDGE TYPE FILTERING HELPERS
// ============================================================================

/**
 * Filter edges by edge type.
 *
 * Works with both KnowledgeEdgeType and ArgumentEdgeType.
 *
 * @param edges - Array of edges to filter
 * @param edgeTypes - Edge types to include
 * @returns Filtered edges
 */
export function filterEdgesByType<T extends { edgeType?: string; type?: string }>(
  edges: T[],
  edgeTypes: string[]
): T[] {
  if (!edgeTypes.length) return edges;
  return edges.filter((edge) => {
    const type = edge.edgeType ?? edge.type;
    return type && edgeTypes.includes(type);
  });
}

/**
 * Get only support-type edges from an array.
 *
 * @param edges - Array of argument edges
 * @returns Edges that represent support (supports, warrants)
 */
export function filterSupportEdges(edges: ArgumentEdge[]): ArgumentEdge[] {
  return edges.filter(isSupportEdge);
}

/**
 * Get only conflict-type edges from an array.
 *
 * @param edges - Array of argument edges
 * @returns Edges that represent conflicts (contradicts, undermines, rebuts)
 */
export function filterConflictEdges(edges: ArgumentEdge[]): ArgumentEdge[] {
  return edges.filter(isConflictEdge);
}

/**
 * Get only decision chain edges from an array.
 *
 * @param edges - Array of argument edges
 * @returns Edges that represent decision chains (supersedes, depends_on_decision)
 */
export function filterDecisionChainEdges(edges: ArgumentEdge[]): ArgumentEdge[] {
  return edges.filter(isDecisionChainEdge);
}

// ============================================================================
// QUERY EDGE TYPE VALIDATION
// ============================================================================

/**
 * Validate and normalize edge types from a query.
 *
 * Accepts both KnowledgeEdgeType and ArgumentEdgeType values.
 * Returns separate arrays for knowledge and argument edge types.
 *
 * @param edgeTypes - Raw edge type strings from query
 * @returns Validated and categorized edge types
 */
export function validateQueryEdgeTypes(edgeTypes: string[] | undefined): {
  knowledgeEdgeTypes: KnowledgeEdgeType[];
  argumentEdgeTypes: ArgumentEdgeType[];
  allTypes: string[];
} {
  if (!edgeTypes || edgeTypes.length === 0) {
    return {
      knowledgeEdgeTypes: [],
      argumentEdgeTypes: [],
      allTypes: [],
    };
  }

  const knowledgeEdgeTypes: KnowledgeEdgeType[] = [];
  const argumentEdgeTypes: ArgumentEdgeType[] = [];
  const validKnowledgeTypes: KnowledgeEdgeType[] = [
    'imports',
    'calls',
    'extends',
    'implements',
    'clone_of',
    'debt_related',
    'authored_by',
    'reviewed_by',
    'evolved_from',
    'co_changed',
    'tests',
    'documents',
    'depends_on',
    'similar_to',
    'part_of',
  ];

  for (const type of edgeTypes) {
    if (isArgumentEdgeType(type)) {
      argumentEdgeTypes.push(type);
    } else if (validKnowledgeTypes.includes(type as KnowledgeEdgeType)) {
      knowledgeEdgeTypes.push(type as KnowledgeEdgeType);
    }
    // Invalid types are silently ignored
  }

  return {
    knowledgeEdgeTypes,
    argumentEdgeTypes,
    allTypes: [...knowledgeEdgeTypes, ...argumentEdgeTypes],
  };
}

/**
 * Check if query has argument edge type filters.
 *
 * @param edgeTypes - Edge types from query
 * @returns true if any argument edge types are specified
 */
export function hasArgumentEdgeFilter(edgeTypes: string[] | undefined): boolean {
  if (!edgeTypes) return false;
  return edgeTypes.some(isArgumentEdgeType);
}

// ============================================================================
// CONVERSION HELPERS
// ============================================================================

/**
 * Convert a KnowledgeGraphEdge to an ArgumentEdge.
 *
 * @param edge - The knowledge graph edge
 * @returns The edge as an ArgumentEdge
 */
function knowledgeEdgeToArgumentEdge(edge: KnowledgeGraphEdge): ArgumentEdge {
  return {
    id: edge.id,
    sourceId: edge.sourceId,
    targetId: edge.targetId,
    sourceType: edge.sourceType as ArgumentEntityType | KnowledgeGraphEdge['sourceType'],
    targetType: edge.targetType as ArgumentEntityType | KnowledgeGraphEdge['targetType'],
    type: edge.edgeType as ArgumentEdgeType,
    weight: edge.weight,
    confidence: edge.confidence,
    metadata: edge.metadata as ArgumentEdge['metadata'],
    computedAt: edge.computedAt,
    validUntil: edge.validUntil,
  };
}

// ============================================================================
// GRAPH EXPANSION WITH EDGE TYPE FILTERING
// ============================================================================

/**
 * Expand graph traversal with edge type filtering.
 *
 * Used by the query pipeline to filter graph expansion to specific edge types.
 *
 * @param storage - The librainian storage instance
 * @param rootIds - Starting entity IDs
 * @param edgeTypes - Edge types to traverse
 * @param maxDepth - Maximum traversal depth
 * @returns Related entity IDs discovered through filtered edges
 */
export async function expandGraphWithEdgeFilter(
  storage: LiBrainianStorage,
  rootIds: string[],
  edgeTypes: string[],
  maxDepth: number = 2
): Promise<Set<string>> {
  const discovered = new Set<string>(rootIds);
  let frontier = new Set<string>(rootIds);

  for (let depth = 0; depth < maxDepth && frontier.size > 0; depth++) {
    const nextFrontier = new Set<string>();

    for (const entityId of frontier) {
      const fromEdges = await storage.getKnowledgeEdgesFrom(entityId);
      const toEdges = await storage.getKnowledgeEdgesTo(entityId);
      const allEdges = [...fromEdges, ...toEdges];

      // Filter by edge types if specified
      const filteredEdges = edgeTypes.length > 0
        ? allEdges.filter((e) => edgeTypes.includes(e.edgeType))
        : allEdges;

      for (const edge of filteredEdges) {
        const neighborId = edge.sourceId === entityId ? edge.targetId : edge.sourceId;
        if (!discovered.has(neighborId)) {
          discovered.add(neighborId);
          nextFrontier.add(neighborId);
        }
      }
    }

    frontier = nextFrontier;
  }

  return discovered;
}

// ============================================================================
// RESPONSE ENHANCEMENT
// ============================================================================

/**
 * Edge information to include in query results.
 */
export interface QueryEdgeInfo {
  /** Edge type */
  type: string;
  /** Source entity ID */
  sourceId: string;
  /** Target entity ID */
  targetId: string;
  /** Edge weight (0-1) */
  weight: number;
  /** Whether this is an argument edge */
  isArgumentEdge: boolean;
}

/**
 * Extract edge info for query response.
 *
 * Converts edges to a simplified format suitable for including in LiBrainianResponse.
 *
 * @param edges - Array of knowledge graph edges
 * @returns Simplified edge information
 */
export function extractEdgeInfoForResponse(edges: KnowledgeGraphEdge[]): QueryEdgeInfo[] {
  return edges.map((edge) => ({
    type: edge.edgeType,
    sourceId: edge.sourceId,
    targetId: edge.targetId,
    weight: edge.weight,
    isArgumentEdge: isArgumentEdgeType(edge.edgeType),
  }));
}
