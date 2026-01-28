/**
 * @fileoverview Causal Reasoning Module - Graph Traversal for Dependency Analysis
 *
 * IMPORTANT THEORETICAL DISCLAIMER:
 * =================================
 * This module provides GRAPH TRAVERSAL functions that operate on dependency/relationship
 * graphs. Despite the naming ("causal"), these functions perform LEVEL 1 (Association)
 * analysis in Pearl's Ladder of Causation, NOT Level 2 (Intervention) or Level 3
 * (Counterfactual) inference.
 *
 * What this module DOES:
 * - Traverses edges in a directed graph to find connected nodes
 * - Identifies paths between nodes based on declared relationships
 * - Computes reachability and path properties
 *
 * What this module DOES NOT do:
 * - True causal inference (would require interventions/experiments)
 * - Counterfactual reasoning ("what would have happened if...")
 * - Confound adjustment or causal identification
 * - Statistical causal discovery from observational data
 *
 * The "causal" terminology is used because:
 * 1. The edges often represent declared causal relationships (e.g., "A calls B")
 * 2. The traversal answers questions like "what depends on X?"
 * 3. In code analysis, call graphs do represent causal chains of execution
 *
 * However, finding that A is connected to B in the graph only means there is a
 * DECLARED relationship, not that we have established true causation through
 * intervention or controlled experiment.
 *
 * Pearl's Ladder of Causation:
 * - Level 1 (Association): P(Y|X) - "What is Y if I observe X?" [THIS MODULE]
 * - Level 2 (Intervention): P(Y|do(X)) - "What is Y if I do X?"
 * - Level 3 (Counterfactual): P(Y_x|X', Y') - "What would Y be if X had been x?"
 *
 * Key Features:
 * - Graph representation (nodes and edges with relationship types)
 * - Graph construction from AST facts and runtime events
 * - Backward traversal (finding upstream dependencies)
 * - Forward traversal (finding downstream dependents)
 * - Path enumeration between nodes
 *
 * References:
 * - Pearl, J. (2009) "Causality: Models, Reasoning, and Inference"
 * - Spirtes et al. (2000) "Causation, Prediction, and Search"
 *
 * @packageDocumentation
 */

import type { ConfidenceValue } from './confidence.js';
import { absent, deterministic, isConfidenceValue } from './confidence.js';
import type { ASTFact } from '../evaluation/ast_fact_extractor.js';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Types of causal nodes that can exist in the graph
 */
export type CausalNodeType = 'event' | 'state' | 'action' | 'condition';

/**
 * Types of causal relationships between nodes
 */
export type CausalEdgeType = 'causes' | 'enables' | 'prevents' | 'correlates';

/**
 * Evidence supporting a causal relationship
 */
export interface EvidenceRef {
  /** Type of evidence (e.g., 'ast', 'test', 'log', 'trace') */
  type: string;
  /** Reference to the evidence (e.g., file:line, test name) */
  reference: string;
  /** Optional confidence in this evidence */
  confidence?: ConfidenceValue;
}

/**
 * A node in the causal graph representing an event, state, action, or condition
 */
export interface CausalNode {
  /** Unique identifier for this node */
  id: string;
  /** Type of causal node */
  type: CausalNodeType;
  /** Human-readable description of what this node represents */
  description: string;
  /** Optional timestamp when this event/state occurred */
  timestamp?: number;
  /** Confidence in this node's existence/observation */
  confidence: ConfidenceValue;
  /** Optional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * An edge in the causal graph representing a causal relationship
 */
export interface CausalEdge {
  /** ID of the cause node */
  from: string;
  /** ID of the effect node */
  to: string;
  /** Type of causal relationship */
  type: CausalEdgeType;
  /** Strength of the causal relationship (0-1) */
  strength: number;
  /** Evidence supporting this causal relationship */
  evidence: EvidenceRef[];
}

/**
 * Metadata about the causal graph
 */
export interface CausalGraphMeta {
  /** When the graph was created */
  createdAt: string;
  /** When the graph was last updated */
  updatedAt?: string;
  /** Total number of nodes */
  nodeCount?: number;
  /** Total number of edges */
  edgeCount?: number;
}

/**
 * The complete causal graph
 */
export interface CausalGraph {
  /** Graph identifier */
  id: string;
  /** Nodes indexed by ID */
  nodes: Map<string, CausalNode>;
  /** All causal edges */
  edges: CausalEdge[];
  /** Graph metadata */
  meta: CausalGraphMeta;
}

/**
 * A path through the causal graph explaining causation
 */
export interface CausalPath {
  /** Nodes along the path (in order from cause to effect) */
  nodes: CausalNode[];
  /** Edges along the path */
  edges: CausalEdge[];
  /** Combined strength of the path (product of edge strengths) */
  totalStrength: number;
}

/**
 * Event that can be incorporated into causal reasoning
 */
export interface CausalEvent {
  /** Event ID */
  id: string;
  /** Event type */
  type: 'error' | 'warning' | 'info' | 'success' | 'failure';
  /** Description of what happened */
  description: string;
  /** When the event occurred */
  timestamp: number;
  /** Source (e.g., function name) that generated this event */
  source?: string;
  /** ID of the event that caused this one */
  cause?: string;
}

/**
 * Options for finding causes/effects (graph traversal).
 *
 * Note: These options control GRAPH TRAVERSAL, not causal inference.
 * See module documentation for theoretical context.
 */
export interface TraversalOptions {
  /** Maximum depth to traverse */
  maxDepth?: number;
  /**
   * Only follow edges of these types.
   *
   * For cause-finding (backward traversal), 'correlates' edges are excluded
   * by default because correlation does not imply causation. Set this explicitly
   * to include correlations if desired.
   *
   * For effect-finding (forward traversal), all edge types are included by default.
   */
  edgeTypes?: CausalEdgeType[];
  /** Minimum edge strength to follow */
  minStrength?: number;
  /**
   * Whether to include 'correlates' edges in traversal.
   * Defaults to false for findCauses (correlation != causation),
   * true for findEffects (showing all connected nodes).
   */
  includeCorrelations?: boolean;
}

// ============================================================================
// TYPE GUARDS
// ============================================================================

const VALID_NODE_TYPES: CausalNodeType[] = ['event', 'state', 'action', 'condition'];
const VALID_EDGE_TYPES: CausalEdgeType[] = ['causes', 'enables', 'prevents', 'correlates'];

/**
 * Type guard for CausalNode
 */
export function isCausalNode(value: unknown): value is CausalNode {
  if (!value || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.id === 'string' &&
    typeof obj.type === 'string' &&
    VALID_NODE_TYPES.includes(obj.type as CausalNodeType) &&
    typeof obj.description === 'string' &&
    isConfidenceValue(obj.confidence)
  );
}

/**
 * Type guard for CausalEdge
 */
export function isCausalEdge(value: unknown): value is CausalEdge {
  if (!value || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.from === 'string' &&
    typeof obj.to === 'string' &&
    typeof obj.type === 'string' &&
    VALID_EDGE_TYPES.includes(obj.type as CausalEdgeType) &&
    typeof obj.strength === 'number' &&
    Array.isArray(obj.evidence)
  );
}

/**
 * Type guard for CausalGraph
 */
export function isCausalGraph(value: unknown): value is CausalGraph {
  if (!value || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.id === 'string' &&
    obj.nodes instanceof Map &&
    Array.isArray(obj.edges) &&
    typeof obj.meta === 'object' && obj.meta !== null
  );
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Create a new causal node
 */
export function createCausalNode(
  props: Omit<CausalNode, 'confidence'> & { confidence?: ConfidenceValue }
): CausalNode {
  return {
    id: props.id,
    type: props.type,
    description: props.description,
    timestamp: props.timestamp,
    confidence: props.confidence ?? absent('uncalibrated'),
    metadata: props.metadata,
  };
}

/**
 * Create a new causal edge
 */
export function createCausalEdge(
  props: Omit<CausalEdge, 'strength' | 'evidence'> & {
    strength?: number;
    evidence?: EvidenceRef[];
  }
): CausalEdge {
  // Clamp strength to [0, 1]
  const strength = props.strength ?? 1.0;
  const clampedStrength = Math.max(0, Math.min(1, strength));

  return {
    from: props.from,
    to: props.to,
    type: props.type,
    strength: clampedStrength,
    evidence: props.evidence ?? [],
  };
}

/**
 * Create an empty causal graph
 */
export function createEmptyCausalGraph(id: string): CausalGraph {
  return {
    id,
    nodes: new Map(),
    edges: [],
    meta: {
      createdAt: new Date().toISOString(),
    },
  };
}

// ============================================================================
// GRAPH MANIPULATION
// ============================================================================

/**
 * Add a node to the graph (returns a new graph)
 */
export function addNodeToGraph(graph: CausalGraph, node: CausalNode): CausalGraph {
  const newNodes = new Map(graph.nodes);
  newNodes.set(node.id, node);

  return {
    ...graph,
    nodes: newNodes,
    meta: {
      ...graph.meta,
      updatedAt: new Date().toISOString(),
      nodeCount: newNodes.size,
    },
  };
}

/**
 * Add an edge to the graph (returns a new graph)
 * @throws Error if either endpoint node doesn't exist
 */
export function addEdgeToGraph(graph: CausalGraph, edge: CausalEdge): CausalGraph {
  if (!graph.nodes.has(edge.from)) {
    throw new Error(`Cannot add edge: source node '${edge.from}' does not exist in graph`);
  }
  if (!graph.nodes.has(edge.to)) {
    throw new Error(`Cannot add edge: target node '${edge.to}' does not exist in graph`);
  }

  return {
    ...graph,
    edges: [...graph.edges, edge],
    meta: {
      ...graph.meta,
      updatedAt: new Date().toISOString(),
      edgeCount: graph.edges.length + 1,
    },
  };
}

// ============================================================================
// GRAPH BUILDING FROM FACTS AND EVENTS
// ============================================================================

/**
 * Build a causal graph from AST facts and runtime events
 */
export function buildCausalGraphFromFacts(
  facts: ASTFact[],
  events: CausalEvent[]
): CausalGraph {
  let graph = createEmptyCausalGraph(`causal-${Date.now()}`);

  // Process function call facts to create call-chain causality
  for (const fact of facts) {
    if (fact.type === 'call') {
      const details = fact.details as { caller: string; callee: string };
      const callerId = details.caller;
      const calleeId = details.callee;

      // Ensure caller node exists
      if (!graph.nodes.has(callerId)) {
        const callerNode = createCausalNode({
          id: callerId,
          type: 'action',
          description: `Function ${callerId} execution`,
          confidence: deterministic(true, 'ast_call_extraction'),
        });
        graph = addNodeToGraph(graph, callerNode);
      }

      // Ensure callee node exists
      if (!graph.nodes.has(calleeId)) {
        const calleeNode = createCausalNode({
          id: calleeId,
          type: 'action',
          description: `Function ${calleeId} execution`,
          confidence: deterministic(true, 'ast_call_extraction'),
        });
        graph = addNodeToGraph(graph, calleeNode);
      }

      // Create causal edge: caller causes callee to execute
      const edge = createCausalEdge({
        from: callerId,
        to: calleeId,
        type: 'causes',
        strength: 1.0,
        evidence: [
          {
            type: 'ast',
            reference: `${fact.file}:${fact.line}`,
            confidence: deterministic(true, 'ast_extraction'),
          },
        ],
      });
      graph = addEdgeToGraph(graph, edge);
    }

    // Process function definitions to create nodes
    if (fact.type === 'function_def') {
      const funcId = fact.identifier;
      if (!graph.nodes.has(funcId)) {
        const funcNode = createCausalNode({
          id: funcId,
          type: 'action',
          description: `Function ${funcId} defined at ${fact.file}:${fact.line}`,
          confidence: deterministic(true, 'ast_function_extraction'),
          metadata: fact.details,
        });
        graph = addNodeToGraph(graph, funcNode);
      }
    }
  }

  // Process events to add event nodes and causal links
  for (const event of events) {
    const eventNode = createCausalNode({
      id: event.id,
      type: 'event',
      description: event.description,
      timestamp: event.timestamp,
      confidence: deterministic(true, 'event_observed'),
      metadata: { eventType: event.type, source: event.source },
    });
    graph = addNodeToGraph(graph, eventNode);

    // If this event has a specified cause, create edge
    if (event.cause && graph.nodes.has(event.cause)) {
      const edge = createCausalEdge({
        from: event.cause,
        to: event.id,
        type: 'causes',
        strength: 1.0,
        evidence: [
          {
            type: 'trace',
            reference: `event:${event.cause}->event:${event.id}`,
          },
        ],
      });
      graph = addEdgeToGraph(graph, edge);
    }

    // If event has a source function, link to it
    if (event.source && graph.nodes.has(event.source)) {
      const edge = createCausalEdge({
        from: event.source,
        to: event.id,
        type: 'causes',
        strength: 0.9, // High but not certain
        evidence: [
          {
            type: 'trace',
            reference: `function:${event.source}->event:${event.id}`,
          },
        ],
      });
      graph = addEdgeToGraph(graph, edge);
    }
  }

  return graph;
}

// ============================================================================
// CAUSE FINDING (BACKWARD TRAVERSAL)
// ============================================================================

/**
 * Find all upstream dependencies of a given node (backward graph traversal).
 *
 * THEORETICAL NOTE: This is graph traversal (Level 1 - Association), NOT causal inference.
 * The function finds nodes that have declared relationships pointing TO the target node.
 * This represents "what is upstream in the dependency graph" rather than
 * "what causally determines the target through intervention."
 *
 * By default, 'correlates' edges are EXCLUDED because correlation does not imply
 * causation. A correlation edge (A correlates B) does not establish that A causes B,
 * so including it in "cause" finding would be epistemically misleading.
 *
 * To include correlations, explicitly set `options.includeCorrelations = true` or
 * include 'correlates' in `options.edgeTypes`.
 *
 * @param graph - The causal graph to traverse
 * @param effectId - The target node to find causes for
 * @param options - Traversal options (depth, edge types, strength threshold)
 * @returns Array of nodes that have edges pointing to the target (directly or transitively)
 *
 * @example
 * ```typescript
 * // Find all declared causes (excludes correlations by default)
 * const causes = findCauses(graph, 'errorOccurred');
 *
 * // Explicitly include correlations
 * const allUpstream = findCauses(graph, 'errorOccurred', { includeCorrelations: true });
 *
 * // Only follow 'causes' edges (strictest interpretation)
 * const directCauses = findCauses(graph, 'errorOccurred', { edgeTypes: ['causes'] });
 * ```
 */
export function findCauses(
  graph: CausalGraph,
  effectId: string,
  options: TraversalOptions = {}
): CausalNode[] {
  const { maxDepth = Infinity, minStrength = 0, includeCorrelations = false } = options;

  // Determine which edge types to follow
  let edgeTypes = options.edgeTypes;
  if (!edgeTypes) {
    // Default: all causal edge types, but exclude 'correlates' unless explicitly requested
    edgeTypes = includeCorrelations
      ? ['causes', 'enables', 'prevents', 'correlates']
      : ['causes', 'enables', 'prevents'];
  }

  if (!graph.nodes.has(effectId)) {
    return [];
  }

  const visited = new Set<string>();
  const causes: CausalNode[] = [];

  // Use BFS with depth tracking for proper depth limiting
  const queue: Array<{ nodeId: string; depth: number }> = [{ nodeId: effectId, depth: 0 }];
  visited.add(effectId);

  while (queue.length > 0) {
    const { nodeId, depth } = queue.shift()!;

    // Find all incoming edges to this node
    const incomingEdges = graph.edges.filter(
      (e) =>
        e.to === nodeId &&
        e.strength >= minStrength &&
        edgeTypes!.includes(e.type)
    );

    for (const edge of incomingEdges) {
      const causeNode = graph.nodes.get(edge.from);
      if (causeNode && !visited.has(edge.from)) {
        visited.add(edge.from);
        causes.push(causeNode);

        // Only continue traversal if within depth limit
        if (depth + 1 < maxDepth) {
          queue.push({ nodeId: edge.from, depth: depth + 1 });
        }
      }
    }
  }

  return causes;
}

/**
 * Get only direct (immediate) upstream dependencies.
 *
 * This is a convenience wrapper for findCauses with maxDepth=1.
 * See findCauses for theoretical context.
 */
export function getDirectCauses(graph: CausalGraph, effectId: string): CausalNode[] {
  return findCauses(graph, effectId, { maxDepth: 1 });
}

/**
 * Find root dependencies (upstream nodes with no further upstream dependencies).
 *
 * In a code call graph, these would be entry points that triggered the chain.
 * Note: This finds nodes with no incoming edges, which may represent:
 * - True initiating causes (e.g., user action, external event)
 * - Incomplete graph (the real cause wasn't captured)
 * - Confounders or common causes
 *
 * THEORETICAL NOTE: "Root cause" in software debugging typically means
 * "the earliest point in the captured trace we can identify." True causal
 * identification would require understanding the full causal structure and
 * potentially running interventions.
 */
export function findRootCauses(
  graph: CausalGraph,
  effectId: string,
  options: TraversalOptions = {}
): CausalNode[] {
  const allCauses = findCauses(graph, effectId, options);

  return allCauses.filter((cause) => {
    // A root cause has no incoming edges
    const hasUpstreamCauses = graph.edges.some((e) => e.to === cause.id);
    return !hasUpstreamCauses;
  });
}

// ============================================================================
// EFFECT FINDING (FORWARD TRAVERSAL)
// ============================================================================

/**
 * Find all downstream dependencies of a given node (forward graph traversal).
 *
 * THEORETICAL NOTE: This is graph traversal (Level 1 - Association), NOT causal inference.
 * The function finds nodes that the source node has declared relationships pointing TO.
 * This represents "what is downstream in the dependency graph" rather than
 * "what will be causally affected if we intervene on the source."
 *
 * Unlike findCauses, this function includes 'correlates' edges by default because:
 * 1. When asking "what might be affected?", correlations are useful signals
 * 2. Excluding correlations from impact analysis could miss important connections
 *
 * To exclude correlations, set `options.includeCorrelations = false` or
 * explicitly specify `options.edgeTypes`.
 *
 * @param graph - The causal graph to traverse
 * @param causeId - The source node to find effects for
 * @param options - Traversal options (depth, edge types, strength threshold)
 * @returns Array of nodes that the source has edges pointing to (directly or transitively)
 *
 * @example
 * ```typescript
 * // Find all downstream dependencies (includes correlations)
 * const effects = findEffects(graph, 'configChange');
 *
 * // Exclude correlations for stricter causal interpretation
 * const causalEffects = findEffects(graph, 'configChange', { includeCorrelations: false });
 * ```
 */
export function findEffects(
  graph: CausalGraph,
  causeId: string,
  options: TraversalOptions = {}
): CausalNode[] {
  const { maxDepth = Infinity, minStrength = 0, includeCorrelations = true } = options;

  // Determine which edge types to follow
  let edgeTypes = options.edgeTypes;
  if (!edgeTypes) {
    // Default for effects: include all types (correlations included by default)
    edgeTypes = includeCorrelations
      ? ['causes', 'enables', 'prevents', 'correlates']
      : ['causes', 'enables', 'prevents'];
  }

  if (!graph.nodes.has(causeId)) {
    return [];
  }

  const visited = new Set<string>();
  const effects: CausalNode[] = [];

  // Use BFS with depth tracking for proper depth limiting
  const queue: Array<{ nodeId: string; depth: number }> = [{ nodeId: causeId, depth: 0 }];
  visited.add(causeId);

  while (queue.length > 0) {
    const { nodeId, depth } = queue.shift()!;

    // Find all outgoing edges from this node
    const outgoingEdges = graph.edges.filter(
      (e) =>
        e.from === nodeId &&
        e.strength >= minStrength &&
        edgeTypes!.includes(e.type)
    );

    for (const edge of outgoingEdges) {
      const effectNode = graph.nodes.get(edge.to);
      if (effectNode && !visited.has(edge.to)) {
        visited.add(edge.to);
        effects.push(effectNode);

        // Only continue traversal if within depth limit
        if (depth + 1 < maxDepth) {
          queue.push({ nodeId: edge.to, depth: depth + 1 });
        }
      }
    }
  }

  return effects;
}

/**
 * Get only direct (immediate) downstream dependencies.
 *
 * This is a convenience wrapper for findEffects with maxDepth=1.
 * See findEffects for theoretical context.
 */
export function getDirectEffects(graph: CausalGraph, causeId: string): CausalNode[] {
  return findEffects(graph, causeId, { maxDepth: 1 });
}

/**
 * Find terminal effects (downstream nodes with no further downstream dependencies).
 *
 * In a code call graph, these would be leaf operations (I/O, side effects, etc.).
 * Note: This finds nodes with no outgoing edges, which may represent:
 * - True terminal effects (e.g., database write, HTTP response)
 * - Incomplete graph (downstream effects weren't captured)
 * - External system boundaries
 */
export function findTerminalEffects(
  graph: CausalGraph,
  causeId: string,
  options: TraversalOptions = {}
): CausalNode[] {
  const allEffects = findEffects(graph, causeId, options);

  return allEffects.filter((effect) => {
    // A terminal effect has no outgoing edges
    const hasDownstreamEffects = graph.edges.some((e) => e.from === effect.id);
    return !hasDownstreamEffects;
  });
}

// ============================================================================
// PATH EXPLANATION
// ============================================================================

/**
 * Find all causal paths between a cause and an effect
 */
export function explainCausation(
  graph: CausalGraph,
  causeId: string,
  effectId: string
): CausalPath[] {
  if (!graph.nodes.has(causeId) || !graph.nodes.has(effectId)) {
    return [];
  }

  const paths: CausalPath[] = [];

  function findPaths(
    currentId: string,
    targetId: string,
    visited: Set<string>,
    pathNodes: CausalNode[],
    pathEdges: CausalEdge[]
  ): void {
    if (currentId === targetId) {
      // Found a path
      const totalStrength = pathEdges.reduce((acc, e) => acc * e.strength, 1);
      paths.push({
        nodes: [...pathNodes],
        edges: [...pathEdges],
        totalStrength,
      });
      return;
    }

    visited.add(currentId);

    // Find outgoing edges
    const outgoing = graph.edges.filter((e) => e.from === currentId && !visited.has(e.to));

    for (const edge of outgoing) {
      const nextNode = graph.nodes.get(edge.to);
      if (nextNode) {
        findPaths(
          edge.to,
          targetId,
          new Set(visited),
          [...pathNodes, nextNode],
          [...pathEdges, edge]
        );
      }
    }
  }

  const startNode = graph.nodes.get(causeId);
  if (startNode) {
    findPaths(causeId, effectId, new Set(), [startNode], []);
  }

  return paths;
}

/**
 * Check if a path exists between two nodes
 */
export function hasPath(graph: CausalGraph, fromId: string, toId: string): boolean {
  if (!graph.nodes.has(fromId) || !graph.nodes.has(toId)) {
    return false;
  }

  if (fromId === toId) {
    return true;
  }

  const visited = new Set<string>();
  const queue = [fromId];

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    if (currentId === toId) {
      return true;
    }

    if (visited.has(currentId)) {
      continue;
    }
    visited.add(currentId);

    const outgoing = graph.edges.filter((e) => e.from === currentId);
    for (const edge of outgoing) {
      if (!visited.has(edge.to)) {
        queue.push(edge.to);
      }
    }
  }

  return false;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Get the depth of the causal chain between two nodes
 * Returns -1 if no path exists
 */
export function getCausalChainDepth(graph: CausalGraph, fromId: string, toId: string): number {
  if (!graph.nodes.has(fromId) || !graph.nodes.has(toId)) {
    return -1;
  }

  if (fromId === toId) {
    return 0;
  }

  const visited = new Set<string>();
  const queue: Array<{ id: string; depth: number }> = [{ id: fromId, depth: 0 }];

  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;

    if (id === toId) {
      return depth;
    }

    if (visited.has(id)) {
      continue;
    }
    visited.add(id);

    const outgoing = graph.edges.filter((e) => e.from === id);
    for (const edge of outgoing) {
      if (!visited.has(edge.to)) {
        queue.push({ id: edge.to, depth: depth + 1 });
      }
    }
  }

  return -1;
}

/**
 * Detect cycles in the causal graph and return nodes involved in cycles
 */
export function getCycleNodes(graph: CausalGraph): string[] {
  const cycleNodes = new Set<string>();
  const visited = new Set<string>();
  const recStack = new Set<string>();

  function dfs(nodeId: string, ancestors: Set<string>): boolean {
    visited.add(nodeId);
    recStack.add(nodeId);

    const outgoing = graph.edges.filter((e) => e.from === nodeId);

    for (const edge of outgoing) {
      if (!visited.has(edge.to)) {
        if (dfs(edge.to, new Set([...ancestors, nodeId]))) {
          // Part of cycle path
          cycleNodes.add(nodeId);
          return true;
        }
      } else if (recStack.has(edge.to)) {
        // Found a cycle
        cycleNodes.add(nodeId);
        cycleNodes.add(edge.to);
        // Mark all ancestors that are part of this cycle
        for (const ancestorId of ancestors) {
          cycleNodes.add(ancestorId);
        }
        return true;
      }
    }

    recStack.delete(nodeId);
    return false;
  }

  for (const nodeId of graph.nodes.keys()) {
    if (!visited.has(nodeId)) {
      dfs(nodeId, new Set());
    }
  }

  return Array.from(cycleNodes);
}

// ============================================================================
// LEVEL 2 CAUSAL INFERENCE: INTERVENTIONS (WU-THIMPL-110)
// ============================================================================

/**
 * Intervention value to set on a node during graph surgery.
 *
 * When we "do" an intervention, we set the node to a specific value,
 * breaking it free from its natural causes.
 */
export interface InterventionValue {
  /** The value we're setting the node to */
  value: unknown;
  /** Description of the intervention */
  description?: string;
}

/**
 * Performs graph surgery for Pearl's do-operator: do(X = x).
 *
 * This implements Level 2 (Intervention) queries in Pearl's Ladder of Causation.
 * Unlike Level 1 (Association) which asks "What is Y if I observe X?",
 * Level 2 asks "What is Y if I DO X?" - a fundamentally different question.
 *
 * The key insight is that interventions break the natural causal structure:
 * when we SET X to a value (do(X=x)), we sever all causal arrows pointing INTO X.
 * X no longer depends on its usual causes - WE are now the cause.
 *
 * This function performs "graph surgery" by:
 * 1. Removing all incoming edges to the intervention node
 * 2. Preserving all outgoing edges (the node can still cause other effects)
 * 3. Optionally recording the intervention value in node metadata
 *
 * The resulting "mutilated graph" can then be used to compute P(Y|do(X=x))
 * by standard probability propagation, which gives the causal effect of X on Y.
 *
 * Pearl's Ladder of Causation:
 * - Level 1 (Association): P(Y|X) - "What is Y if I observe X?" [findCauses, findEffects]
 * - Level 2 (Intervention): P(Y|do(X)) - "What is Y if I do X?" [THIS FUNCTION]
 * - Level 3 (Counterfactual): P(Y_x|X', Y') - "What would Y be if X had been x?"
 *
 * @param graph - The original causal graph
 * @param nodeId - ID of the node to intervene on
 * @param intervention - The intervention value and optional description
 * @returns A new graph with incoming edges to nodeId removed (graph surgery)
 * @throws Error if the node doesn't exist in the graph
 *
 * @example
 * ```typescript
 * // Original: Temperature -> IceCream Sales <- Season
 * // We want: What happens to sales if we SET temperature to 90F?
 * const mutilatedGraph = doIntervention(graph, 'temperature', { value: 90 });
 * // Now we can compute P(sales | do(temperature = 90))
 * // by propagating through the mutilated graph
 * ```
 *
 * @see Pearl, J. (2009) "Causality: Models, Reasoning, and Inference" Ch. 3
 * @see https://en.wikipedia.org/wiki/Do_calculus
 */
export function doIntervention(
  graph: CausalGraph,
  nodeId: string,
  intervention: InterventionValue
): CausalGraph {
  // Verify the node exists
  if (!graph.nodes.has(nodeId)) {
    throw new Error(
      `Cannot intervene on node '${nodeId}': node does not exist in graph`
    );
  }

  // Get the original node
  const originalNode = graph.nodes.get(nodeId)!;

  // Create a new node with intervention metadata
  const interventionNode: CausalNode = {
    ...originalNode,
    metadata: {
      ...originalNode.metadata,
      intervention: {
        value: intervention.value,
        description: intervention.description ?? `do(${nodeId})`,
        timestamp: Date.now(),
      },
    },
    // After intervention, we are certain about this node's value
    confidence: deterministic(true, `intervention_do(${nodeId})`),
  };

  // Create new nodes map with the intervention node
  const newNodes = new Map(graph.nodes);
  newNodes.set(nodeId, interventionNode);

  // Filter out all incoming edges to the intervention node (graph surgery)
  // Keep all outgoing edges - the intervention can still cause effects
  const newEdges = graph.edges.filter((edge) => edge.to !== nodeId);

  return {
    id: graph.id,
    nodes: newNodes,
    edges: newEdges,
    meta: {
      ...graph.meta,
      updatedAt: new Date().toISOString(),
      edgeCount: newEdges.length,
    },
  };
}

/**
 * Perform multiple simultaneous interventions.
 *
 * This is useful for complex experimental designs where we want to
 * control multiple variables at once.
 *
 * @param graph - The original causal graph
 * @param interventions - Map of nodeId to intervention value
 * @returns A new graph with all interventions applied
 */
export function doMultipleInterventions(
  graph: CausalGraph,
  interventions: Map<string, InterventionValue>
): CausalGraph {
  let result = graph;
  for (const [nodeId, value] of interventions) {
    result = doIntervention(result, nodeId, value);
  }
  return result;
}

// ============================================================================
// D-SEPARATION (WU-THIMPL-111)
// ============================================================================

/**
 * Tests if X and Y are d-separated given conditioning set Z.
 *
 * D-separation (directional separation) is the graphical criterion for
 * conditional independence in causal graphs. If X and Y are d-separated
 * given Z, then X ⊥ Y | Z (X is conditionally independent of Y given Z).
 *
 * The algorithm checks all paths between X and Y. A path is "blocked" by Z if:
 * 1. It contains a chain (A → B → C) where B is in Z
 * 2. It contains a fork (A ← B → C) where B is in Z
 * 3. It contains a collider (A → B ← C) where B and all descendants of B are NOT in Z
 *
 * If ALL paths are blocked, X and Y are d-separated given Z.
 *
 * This is essential for:
 * - Determining which variables to control for in causal inference
 * - Identifying confounders
 * - Validating causal models against data
 *
 * @param graph - The causal graph
 * @param x - ID of the first node
 * @param y - ID of the second node
 * @param z - Array of node IDs in the conditioning set
 * @returns true if X and Y are d-separated given Z (conditionally independent)
 *
 * @example
 * ```typescript
 * // Graph: Smoking → Tar → Cancer, Smoking → Cancer
 * // Is Tar independent of Cancer given Smoking?
 * const independent = isDSeparated(graph, 'tar', 'cancer', ['smoking']);
 * // false - there's still the direct path Smoking → Cancer
 * ```
 *
 * @see Pearl, J. (2009) "Causality" Section 1.2.3
 * @see https://en.wikipedia.org/wiki/D-separation
 */
export function isDSeparated(
  graph: CausalGraph,
  x: string,
  y: string,
  z: string[]
): boolean {
  // Validate inputs
  if (!graph.nodes.has(x)) {
    throw new Error(`Node '${x}' does not exist in graph`);
  }
  if (!graph.nodes.has(y)) {
    throw new Error(`Node '${y}' does not exist in graph`);
  }
  for (const zNode of z) {
    if (!graph.nodes.has(zNode)) {
      throw new Error(`Conditioning node '${zNode}' does not exist in graph`);
    }
  }

  // Same node is not d-separated from itself (trivially dependent)
  if (x === y) {
    return false;
  }

  // Build the conditioning set and its ancestors (for collider handling)
  const conditioningSet = new Set(z);
  const conditioningAncestors = getAncestors(graph, z);

  // Use Bayes-Ball algorithm variant for d-separation
  // We'll track reachable nodes with direction of entry
  type Direction = 'up' | 'down';
  type VisitState = { nodeId: string; direction: Direction };

  const visited = new Set<string>();
  const queue: VisitState[] = [{ nodeId: x, direction: 'up' }];

  while (queue.length > 0) {
    const { nodeId, direction } = queue.shift()!;
    const stateKey = `${nodeId}:${direction}`;

    if (visited.has(stateKey)) {
      continue;
    }
    visited.add(stateKey);

    // If we reached y, there's an active path - not d-separated
    if (nodeId === y) {
      return false;
    }

    const isConditioned = conditioningSet.has(nodeId);
    const hasConditionedDescendant = conditioningAncestors.has(nodeId);

    if (direction === 'up') {
      // Coming from a child, going up toward parents

      if (!isConditioned) {
        // If not conditioned, can continue up to parents (chain/fork unblocked)
        const parents = getParents(graph, nodeId);
        for (const parent of parents) {
          queue.push({ nodeId: parent, direction: 'up' });
        }

        // Can also go down to other children (fork case)
        const children = getChildren(graph, nodeId);
        for (const child of children) {
          queue.push({ nodeId: child, direction: 'down' });
        }
      }
      // If conditioned, the path is blocked here (chain/fork blocked)

    } else {
      // direction === 'down': Coming from a parent, going down toward children

      if (!isConditioned) {
        // If not conditioned, can continue down to children
        const children = getChildren(graph, nodeId);
        for (const child of children) {
          queue.push({ nodeId: child, direction: 'down' });
        }
      }

      // Collider case: if this node OR any descendant is conditioned,
      // the path becomes active through the collider
      if (isConditioned || hasConditionedDescendant) {
        // Can go up to parents (collider opened)
        const parents = getParents(graph, nodeId);
        for (const parent of parents) {
          queue.push({ nodeId: parent, direction: 'up' });
        }
      }
    }
  }

  // No active path found - d-separated
  return true;
}

/**
 * Get all parent nodes (nodes with edges pointing to this node).
 */
function getParents(graph: CausalGraph, nodeId: string): string[] {
  return graph.edges.filter((e) => e.to === nodeId).map((e) => e.from);
}

/**
 * Get all child nodes (nodes this node has edges pointing to).
 */
function getChildren(graph: CausalGraph, nodeId: string): string[] {
  return graph.edges.filter((e) => e.from === nodeId).map((e) => e.to);
}

/**
 * Get all ancestors of a set of nodes (for collider detection).
 */
function getAncestors(graph: CausalGraph, nodeIds: string[]): Set<string> {
  const ancestors = new Set<string>();
  const queue = [...nodeIds];

  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    const parents = getParents(graph, nodeId);

    for (const parent of parents) {
      if (!ancestors.has(parent)) {
        ancestors.add(parent);
        queue.push(parent);
      }
    }
  }

  return ancestors;
}

/**
 * Find the minimal conditioning set that d-separates X from Y.
 *
 * This finds the smallest set of variables that, when conditioned on,
 * makes X and Y conditionally independent. Useful for identifying
 * sufficient adjustment sets in causal inference.
 *
 * @param graph - The causal graph
 * @param x - ID of the first node
 * @param y - ID of the second node
 * @returns Minimal conditioning set, or null if X and Y cannot be d-separated
 */
export function findMinimalSeparatingSet(
  graph: CausalGraph,
  x: string,
  y: string
): string[] | null {
  // Get all possible conditioning candidates (all nodes except x and y)
  const candidates = Array.from(graph.nodes.keys()).filter(
    (id) => id !== x && id !== y
  );

  // Try empty set first
  if (isDSeparated(graph, x, y, [])) {
    return [];
  }

  // Try single-element sets
  for (const c of candidates) {
    if (isDSeparated(graph, x, y, [c])) {
      return [c];
    }
  }

  // Try pairs
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const pair = [candidates[i], candidates[j]];
      if (isDSeparated(graph, x, y, pair)) {
        return pair;
      }
    }
  }

  // Try triples (for larger graphs, might need more sophisticated algorithm)
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      for (let k = j + 1; k < candidates.length; k++) {
        const triple = [candidates[i], candidates[j], candidates[k]];
        if (isDSeparated(graph, x, y, triple)) {
          return triple;
        }
      }
    }
  }

  // For larger sets, try the full candidate set
  if (isDSeparated(graph, x, y, candidates)) {
    return candidates;
  }

  // Cannot be d-separated (likely direct path or very connected)
  return null;
}
