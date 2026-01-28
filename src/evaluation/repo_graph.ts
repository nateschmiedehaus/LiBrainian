/**
 * @fileoverview RepoGraph Integration
 *
 * Provides repository-wide navigation structure per the RepoGraph (ICLR 2025) approach.
 * Builds a graph representation of the codebase that captures:
 * - File system structure (directories, files)
 * - Code entities (functions, classes, modules)
 * - Cross-file relationships (imports, exports, calls, extends, implements)
 *
 * This enables powerful navigation and exploration of codebases,
 * and integrates with the Code Property Graph (WU-KG-001) for detailed
 * intra-file analysis.
 *
 * @packageDocumentation
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Types of nodes in the repository graph
 */
export type RepoNodeType = 'file' | 'directory' | 'function' | 'class' | 'module';

/**
 * Types of edges in the repository graph
 */
export type RepoEdgeType = 'imports' | 'exports' | 'contains' | 'calls' | 'extends' | 'implements';

/**
 * A node in the repository graph representing a code entity
 */
export interface RepoNode {
  /** Unique identifier for this node */
  id: string;
  /** The type of entity this node represents */
  type: RepoNodeType;
  /** File system path to this entity */
  path: string;
  /** Human-readable name */
  name: string;
  /** Additional metadata (language, size, line numbers, etc.) */
  metadata: Record<string, unknown>;
}

/**
 * An edge in the repository graph representing a relationship
 */
export interface RepoEdge {
  /** Source node ID */
  source: string;
  /** Target node ID */
  target: string;
  /** Type of relationship */
  type: RepoEdgeType;
  /** Weight/importance of this relationship (higher = more important) */
  weight: number;
}

/**
 * Serialized format of the graph for persistence
 */
interface SerializedGraph {
  nodes: RepoNode[];
  edges: RepoEdge[];
}

/**
 * Repository graph interface for navigation and exploration
 */
export interface RepoGraph {
  /**
   * Add a node to the graph
   * @param node - The node to add
   */
  addNode(node: RepoNode): void;

  /**
   * Add an edge to the graph
   * @param edge - The edge to add
   */
  addEdge(edge: RepoEdge): void;

  /**
   * Get a node by its ID
   * @param id - The node ID
   * @returns The node or undefined if not found
   */
  getNode(id: string): RepoNode | undefined;

  /**
   * Get all neighbors of a node, optionally filtered by edge type
   * @param nodeId - The source node ID
   * @param edgeType - Optional edge type filter
   * @returns Array of neighboring nodes
   */
  getNeighbors(nodeId: string, edgeType?: string): RepoNode[];

  /**
   * Find the shortest path between two nodes
   * @param fromId - Starting node ID
   * @param toId - Target node ID
   * @returns Array of nodes forming the path, or empty array if no path exists
   */
  findPath(fromId: string, toId: string): RepoNode[];

  /**
   * Extract a subgraph rooted at a node up to a certain depth
   * @param rootId - Root node ID
   * @param depth - Maximum depth to traverse
   * @returns Object containing nodes and edges in the subgraph
   */
  getSubgraph(rootId: string, depth: number): { nodes: RepoNode[]; edges: RepoEdge[] };

  /**
   * Serialize the graph to a JSON string
   * @returns JSON string representation of the graph
   */
  serialize(): string;

  /**
   * Deserialize a graph from a JSON string
   * @param data - JSON string to deserialize
   */
  deserialize(data: string): void;
}

// ============================================================================
// REPO GRAPH IMPLEMENTATION
// ============================================================================

/**
 * Implementation of the RepoGraph interface
 */
class RepoGraphImpl implements RepoGraph {
  /** Map of node ID to node */
  private nodes: Map<string, RepoNode> = new Map();

  /** Adjacency list: source node ID -> array of edges */
  private adjacency: Map<string, RepoEdge[]> = new Map();

  /**
   * Add a node to the graph
   */
  addNode(node: RepoNode): void {
    this.nodes.set(node.id, node);
    // Initialize adjacency list for this node if not exists
    if (!this.adjacency.has(node.id)) {
      this.adjacency.set(node.id, []);
    }
  }

  /**
   * Add an edge to the graph
   */
  addEdge(edge: RepoEdge): void {
    const edges = this.adjacency.get(edge.source);
    if (edges) {
      edges.push(edge);
    } else {
      this.adjacency.set(edge.source, [edge]);
    }
  }

  /**
   * Get a node by its ID
   */
  getNode(id: string): RepoNode | undefined {
    return this.nodes.get(id);
  }

  /**
   * Get all neighbors of a node, optionally filtered by edge type
   */
  getNeighbors(nodeId: string, edgeType?: string): RepoNode[] {
    const edges = this.adjacency.get(nodeId);
    if (!edges) {
      return [];
    }

    const neighbors: RepoNode[] = [];
    for (const edge of edges) {
      // Filter by edge type if specified
      if (edgeType && edge.type !== edgeType) {
        continue;
      }

      const targetNode = this.nodes.get(edge.target);
      if (targetNode) {
        neighbors.push(targetNode);
      }
    }

    return neighbors;
  }

  /**
   * Find the shortest path between two nodes using BFS
   */
  findPath(fromId: string, toId: string): RepoNode[] {
    const fromNode = this.nodes.get(fromId);
    const toNode = this.nodes.get(toId);

    // Return empty if source or target doesn't exist
    if (!fromNode || !toNode) {
      return [];
    }

    // Same node - return single node path
    if (fromId === toId) {
      return [fromNode];
    }

    // BFS to find shortest path
    const visited = new Set<string>();
    const queue: Array<{ nodeId: string; path: RepoNode[] }> = [];
    const startNode = this.nodes.get(fromId);
    if (!startNode) return [];

    queue.push({ nodeId: fromId, path: [startNode] });
    visited.add(fromId);

    while (queue.length > 0) {
      const current = queue.shift()!;

      const edges = this.adjacency.get(current.nodeId) || [];
      for (const edge of edges) {
        if (visited.has(edge.target)) {
          continue;
        }

        const targetNode = this.nodes.get(edge.target);
        if (!targetNode) {
          continue;
        }

        const newPath = [...current.path, targetNode];

        if (edge.target === toId) {
          return newPath;
        }

        visited.add(edge.target);
        queue.push({ nodeId: edge.target, path: newPath });
      }
    }

    // No path found
    return [];
  }

  /**
   * Extract a subgraph rooted at a node up to a certain depth
   */
  getSubgraph(rootId: string, depth: number): { nodes: RepoNode[]; edges: RepoEdge[] } {
    const rootNode = this.nodes.get(rootId);
    if (!rootNode) {
      return { nodes: [], edges: [] };
    }

    const subgraphNodes: Map<string, RepoNode> = new Map();
    const subgraphEdges: RepoEdge[] = [];
    const visited = new Set<string>();

    // BFS with depth tracking
    const queue: Array<{ nodeId: string; currentDepth: number }> = [];
    queue.push({ nodeId: rootId, currentDepth: 0 });
    subgraphNodes.set(rootId, rootNode);
    visited.add(rootId);

    while (queue.length > 0) {
      const current = queue.shift()!;

      // Don't explore beyond requested depth
      if (current.currentDepth >= depth) {
        continue;
      }

      const edges = this.adjacency.get(current.nodeId) || [];
      for (const edge of edges) {
        const targetNode = this.nodes.get(edge.target);
        if (!targetNode) {
          continue;
        }

        // Add edge to subgraph
        subgraphEdges.push(edge);

        // Only add node and explore if not visited
        if (!visited.has(edge.target)) {
          visited.add(edge.target);
          subgraphNodes.set(edge.target, targetNode);
          queue.push({ nodeId: edge.target, currentDepth: current.currentDepth + 1 });
        }
      }
    }

    return {
      nodes: Array.from(subgraphNodes.values()),
      edges: subgraphEdges,
    };
  }

  /**
   * Serialize the graph to a JSON string
   */
  serialize(): string {
    const allEdges: RepoEdge[] = [];
    const edgeArrays = Array.from(this.adjacency.values());
    for (const edges of edgeArrays) {
      allEdges.push(...edges);
    }

    const serialized: SerializedGraph = {
      nodes: Array.from(this.nodes.values()),
      edges: allEdges,
    };

    return JSON.stringify(serialized);
  }

  /**
   * Deserialize a graph from a JSON string
   */
  deserialize(data: string): void {
    try {
      const parsed = JSON.parse(data) as SerializedGraph;

      // Clear current graph
      this.nodes.clear();
      this.adjacency.clear();

      // Add nodes
      if (Array.isArray(parsed.nodes)) {
        for (const node of parsed.nodes) {
          this.addNode(node);
        }
      }

      // Add edges
      if (Array.isArray(parsed.edges)) {
        for (const edge of parsed.edges) {
          this.addEdge(edge);
        }
      }
    } catch {
      // Invalid JSON - silently ignore, leaving graph unchanged or empty
    }
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a new RepoGraph instance
 * @returns A new RepoGraph
 */
export function createRepoGraph(): RepoGraph {
  return new RepoGraphImpl();
}
