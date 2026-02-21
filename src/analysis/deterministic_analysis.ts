/**
 * Deterministic Analysis Module
 *
 * Implements graph algorithms for codebase structure analysis:
 * - Tarjan's SCC algorithm for cycle detection
 * - Graph adjacency and transitive closure
 * - Control flow graph construction
 * - Integration with storage layer
 */

import type { LiBrainianStorage, SCCEntry, CFGEdge } from '../storage/types.js';
import type { ModuleGraph } from '../knowledge/module_graph.js';

// ============================================================================
// STRONGLY CONNECTED COMPONENTS (Tarjan's Algorithm)
// ============================================================================

interface TarjanState {
  index: number;
  stack: string[];
  indices: Map<string, number>;
  lowlinks: Map<string, number>;
  onStack: Set<string>;
  sccs: string[][];
}

/**
 * Find all strongly connected components in a directed graph using Tarjan's algorithm.
 * SCCs with size > 1 represent circular dependencies.
 */
export function findSCCs(graph: ModuleGraph): string[][] {
  const state: TarjanState = {
    index: 0,
    stack: [],
    indices: new Map(),
    lowlinks: new Map(),
    onStack: new Set(),
    sccs: [],
  };

  for (const node of graph.keys()) {
    if (!state.indices.has(node)) {
      tarjanVisit(node, graph, state);
    }
  }

  return state.sccs;
}

function tarjanVisit(node: string, graph: ModuleGraph, state: TarjanState): void {
  state.indices.set(node, state.index);
  state.lowlinks.set(node, state.index);
  state.index++;
  state.stack.push(node);
  state.onStack.add(node);

  const neighbors = graph.get(node) ?? new Set<string>();
  for (const neighbor of neighbors) {
    if (!state.indices.has(neighbor)) {
      tarjanVisit(neighbor, graph, state);
      state.lowlinks.set(
        node,
        Math.min(state.lowlinks.get(node)!, state.lowlinks.get(neighbor)!)
      );
    } else if (state.onStack.has(neighbor)) {
      state.lowlinks.set(
        node,
        Math.min(state.lowlinks.get(node)!, state.indices.get(neighbor)!)
      );
    }
  }

  // If node is a root of an SCC
  if (state.lowlinks.get(node) === state.indices.get(node)) {
    const scc: string[] = [];
    let w: string | undefined;
    do {
      w = state.stack.pop();
      if (w !== undefined) {
        state.onStack.delete(w);
        scc.push(w);
      }
    } while (w !== node);
    state.sccs.push(scc);
  }
}

/**
 * Store SCC analysis results in the database.
 */
export async function storeSCCAnalysis(
  storage: LiBrainianStorage,
  graph: ModuleGraph,
  entityType: SCCEntry['entityType'] = 'module'
): Promise<{ totalComponents: number; cyclicComponents: number }> {
  const sccs = findSCCs(graph);
  const now = new Date().toISOString();

  let cyclicComponents = 0;
  const entries: SCCEntry[] = [];

  for (let componentId = 0; componentId < sccs.length; componentId++) {
    const component = sccs[componentId];
    if (component.length > 1) {
      cyclicComponents++;
    }

    // First entity is the root (where SCC was detected)
    const root = component[0];

    for (let i = 0; i < component.length; i++) {
      entries.push({
        componentId,
        entityId: component[i],
        entityType,
        isRoot: component[i] === root,
        componentSize: component.length,
        computedAt: now,
      });
    }
  }

  await storage.upsertSCCEntries(entries);

  return {
    totalComponents: sccs.length,
    cyclicComponents,
  };
}

// ============================================================================
// GRAPH ADJACENCY ANALYSIS
// ============================================================================

export interface AdjacencyAnalysis {
  /** Map of node -> [directly connected nodes] */
  directNeighbors: Map<string, Set<string>>;
  /** Map of node -> [transitively reachable nodes] */
  transitiveReach: Map<string, Set<string>>;
  /** Map of node -> in-degree (number of incoming edges) */
  inDegree: Map<string, number>;
  /** Map of node -> out-degree (number of outgoing edges) */
  outDegree: Map<string, number>;
}

/**
 * Compute adjacency analysis for a directed graph.
 */
export function computeAdjacencyAnalysis(
  graph: ModuleGraph,
  reverse: ModuleGraph
): AdjacencyAnalysis {
  const directNeighbors = new Map<string, Set<string>>();
  const transitiveReach = new Map<string, Set<string>>();
  const inDegree = new Map<string, number>();
  const outDegree = new Map<string, number>();

  // Direct neighbors and degrees
  for (const [node, neighbors] of graph) {
    directNeighbors.set(node, new Set(neighbors));
    outDegree.set(node, neighbors.size);
  }

  for (const [node, dependents] of reverse) {
    inDegree.set(node, dependents.size);
  }

  // Ensure all nodes have entries
  for (const node of graph.keys()) {
    if (!inDegree.has(node)) inDegree.set(node, 0);
    if (!outDegree.has(node)) outDegree.set(node, 0);
  }

  // Transitive closure (reachability)
  for (const node of graph.keys()) {
    transitiveReach.set(node, computeTransitiveReach(node, graph));
  }

  return { directNeighbors, transitiveReach, inDegree, outDegree };
}

function computeTransitiveReach(start: string, graph: ModuleGraph): Set<string> {
  const reachable = new Set<string>();
  const visited = new Set<string>();
  const queue = [start];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);

    const neighbors = graph.get(current);
    if (neighbors) {
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          reachable.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
  }

  return reachable;
}

/**
 * Find all shortest paths between two nodes using BFS.
 */
export function findShortestPath(
  graph: ModuleGraph,
  from: string,
  to: string
): string[] | null {
  if (from === to) return [from];

  const visited = new Set<string>();
  const queue: Array<{ node: string; path: string[] }> = [{ node: from, path: [from] }];

  while (queue.length > 0) {
    const { node, path } = queue.shift()!;
    if (visited.has(node)) continue;
    visited.add(node);

    const neighbors = graph.get(node);
    if (!neighbors) continue;

    for (const neighbor of neighbors) {
      if (neighbor === to) {
        return [...path, neighbor];
      }
      if (!visited.has(neighbor)) {
        queue.push({ node: neighbor, path: [...path, neighbor] });
      }
    }
  }

  return null;
}

// ============================================================================
// CONTROL FLOW GRAPH CONSTRUCTION
// ============================================================================

export interface BasicBlock {
  id: string;
  startLine: number;
  endLine: number;
  statements: string[];
  isEntry: boolean;
  isExit: boolean;
}

export interface ControlFlowResult {
  blocks: BasicBlock[];
  edges: CFGEdge[];
}

/**
 * Build a simplified control flow graph from function metadata.
 * This creates basic blocks based on control flow statements.
 */
export function buildControlFlowGraph(
  functionId: string,
  startLine: number,
  endLine: number,
  content: string
): ControlFlowResult {
  const lines = content.split('\n');
  const blocks: BasicBlock[] = [];
  const edges: CFGEdge[] = [];

  let blockId = 0;
  let currentBlockStart = startLine;
  let currentStatements: string[] = [];

  const controlFlowPatterns = [
    /^\s*(if|else\s+if|else|for|while|do|switch|case|default|try|catch|finally|return|throw|break|continue)\b/,
  ];

  // Simplified block detection based on control flow keywords
  for (let lineNum = startLine; lineNum <= endLine && lineNum <= lines.length; lineNum++) {
    const line = lines[lineNum - 1] ?? '';
    const isControlFlow = controlFlowPatterns.some(p => p.test(line));

    if (isControlFlow && currentStatements.length > 0) {
      // End current block, start new one
      blocks.push({
        id: `${functionId}_block_${blockId}`,
        startLine: currentBlockStart,
        endLine: lineNum - 1,
        statements: currentStatements,
        isEntry: blockId === 0,
        isExit: false,
      });

      if (blockId > 0) {
        // Add edge from previous block
        edges.push({
          functionId,
          fromBlock: blockId - 1,
          toBlock: blockId,
          edgeType: 'sequential',
          confidence: 1.0,
        });
      }

      blockId++;
      currentBlockStart = lineNum;
      currentStatements = [line];
    } else {
      currentStatements.push(line);
    }
  }

  // Final block
  if (currentStatements.length > 0) {
    blocks.push({
      id: `${functionId}_block_${blockId}`,
      startLine: currentBlockStart,
      endLine,
      statements: currentStatements,
      isEntry: blockId === 0,
      isExit: true,
    });

    if (blockId > 0) {
      edges.push({
        functionId,
        fromBlock: blockId - 1,
        toBlock: blockId,
        edgeType: 'sequential',
        confidence: 1.0,
      });
    }
  }

  // Mark last block as exit
  if (blocks.length > 0) {
    blocks[blocks.length - 1].isExit = true;
  }

  // Add branch edges for control flow statements
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    for (const stmt of block.statements) {
      if (/^\s*if\b/.test(stmt)) {
        const nextBlockIdx = i + 1;
        if (nextBlockIdx < blocks.length) {
          edges.push({
            functionId,
            fromBlock: i,
            toBlock: nextBlockIdx,
            edgeType: 'branch_true',
            condition: 'true',
            confidence: 0.8,
          });
        }
      } else if (/^\s*(for|while|do)\b/.test(stmt)) {
        // Loop back edge
        edges.push({
          functionId,
          fromBlock: i,
          toBlock: i,
          edgeType: 'loop_back',
          condition: 'loop',
          confidence: 1.0,
        });
      }
    }
  }

  return { blocks, edges };
}

/**
 * Store CFG edges in the database.
 */
export async function storeCFGAnalysis(
  storage: LiBrainianStorage,
  result: ControlFlowResult
): Promise<void> {
  await storage.upsertCFGEdges(result.edges);
}

// ============================================================================
// GRAPH METRICS
// ============================================================================

export interface GraphMetrics {
  nodeCount: number;
  edgeCount: number;
  density: number;
  averageInDegree: number;
  averageOutDegree: number;
  maxInDegree: { node: string; degree: number } | null;
  maxOutDegree: { node: string; degree: number } | null;
  isolatedNodes: string[];
  leafNodes: string[];
  rootNodes: string[];
}

/**
 * Compute various graph metrics.
 */
export function computeGraphMetrics(
  graph: ModuleGraph,
  reverse: ModuleGraph
): GraphMetrics {
  const nodeCount = graph.size;
  let edgeCount = 0;
  let totalInDegree = 0;
  let totalOutDegree = 0;
  let maxInDegree: { node: string; degree: number } | null = null;
  let maxOutDegree: { node: string; degree: number } | null = null;
  const isolatedNodes: string[] = [];
  const leafNodes: string[] = [];
  const rootNodes: string[] = [];

  for (const [node, neighbors] of graph) {
    const outDegree = neighbors.size;
    edgeCount += outDegree;
    totalOutDegree += outDegree;

    if (!maxOutDegree || outDegree > maxOutDegree.degree) {
      maxOutDegree = { node, degree: outDegree };
    }
  }

  for (const [node, dependents] of reverse) {
    const inDegree = dependents.size;
    totalInDegree += inDegree;

    if (!maxInDegree || inDegree > maxInDegree.degree) {
      maxInDegree = { node, degree: inDegree };
    }
  }

  // Find special node types
  for (const node of graph.keys()) {
    const outDegree = graph.get(node)?.size ?? 0;
    const inDegree = reverse.get(node)?.size ?? 0;

    if (outDegree === 0 && inDegree === 0) {
      isolatedNodes.push(node);
    } else if (outDegree === 0 && inDegree > 0) {
      leafNodes.push(node);
    } else if (inDegree === 0 && outDegree > 0) {
      rootNodes.push(node);
    }
  }

  const maxEdges = nodeCount * (nodeCount - 1);
  const density = maxEdges > 0 ? edgeCount / maxEdges : 0;

  return {
    nodeCount,
    edgeCount,
    density,
    averageInDegree: nodeCount > 0 ? totalInDegree / nodeCount : 0,
    averageOutDegree: nodeCount > 0 ? totalOutDegree / nodeCount : 0,
    maxInDegree,
    maxOutDegree,
    isolatedNodes,
    leafNodes,
    rootNodes,
  };
}

// ============================================================================
// FULL DETERMINISTIC ANALYSIS
// ============================================================================

export interface DeterministicAnalysisResult {
  sccs: {
    totalComponents: number;
    cyclicComponents: number;
    largestCycleSize: number;
    cyclicEntities: string[];
  };
  adjacency: AdjacencyAnalysis;
  metrics: GraphMetrics;
}

/**
 * Run full deterministic analysis on a module graph.
 */
export async function runDeterministicAnalysis(
  storage: LiBrainianStorage,
  graph: ModuleGraph,
  reverse: ModuleGraph
): Promise<DeterministicAnalysisResult> {
  // SCC analysis
  const sccs = findSCCs(graph);
  const cyclicSccs = sccs.filter(scc => scc.length > 1);
  const cyclicEntities = cyclicSccs.flat();
  const largestCycleSize = cyclicSccs.reduce((max, scc) => Math.max(max, scc.length), 0);

  // Store SCC results
  const sccResult = await storeSCCAnalysis(storage, graph);

  // Adjacency analysis
  const adjacency = computeAdjacencyAnalysis(graph, reverse);

  // Graph metrics
  const metrics = computeGraphMetrics(graph, reverse);

  return {
    sccs: {
      totalComponents: sccResult.totalComponents,
      cyclicComponents: sccResult.cyclicComponents,
      largestCycleSize,
      cyclicEntities,
    },
    adjacency,
    metrics,
  };
}
