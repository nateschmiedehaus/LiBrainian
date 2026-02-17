import type { SimilarityResult, EmbeddableEntityType } from './types.js';

export type VectorIndexEntityType = EmbeddableEntityType;
export interface VectorIndexItem { entityId: string; entityType: VectorIndexEntityType; embedding: Float32Array; }

// ============================================================================
// HNSW (Hierarchical Navigable Small World) Index
// Provides O(log n) approximate nearest neighbor search
// ============================================================================

/**
 * Configuration for HNSW index.
 *
 * @param M - Maximum number of connections per node per layer (default: 16)
 *   Higher M = better recall but more memory and slower insertion
 * @param efConstruction - Size of dynamic candidate list during construction (default: 200)
 *   Higher value = better index quality but slower construction
 * @param efSearch - Size of dynamic candidate list during search (default: 50)
 *   Higher value = better recall but slower search
 */
export interface HNSWConfig {
  M: number;
  efConstruction: number;
  efSearch: number;
}

/**
 * Default HNSW configuration tuned for code search.
 * Balances recall, speed, and memory for typical codebase sizes.
 */
export const DEFAULT_HNSW_CONFIG: HNSWConfig = {
  M: 16,
  efConstruction: 200,
  efSearch: 50,
};

/**
 * A node in the HNSW graph.
 */
interface HNSWNode {
  id: string;
  vector: Float32Array;
  entityType: VectorIndexEntityType;
  /** Connections per layer: layer index -> array of connected node IDs */
  connections: Map<number, string[]>;
}

/**
 * HNSW Index for approximate nearest neighbor search.
 *
 * Provides O(log n) search complexity compared to O(n) brute-force.
 * Based on the paper: "Efficient and robust approximate nearest neighbor search
 * using Hierarchical Navigable Small World graphs" (Malkov & Yashunin, 2018)
 *
 * @example
 * ```typescript
 * const hnsw = new HNSWIndex({ M: 16, efConstruction: 200, efSearch: 50 });
 * hnsw.insert('func_1', embedding1, 'function');
 * hnsw.insert('func_2', embedding2, 'function');
 * const results = hnsw.search(queryEmbedding, 10, ['function']);
 * ```
 */
export class HNSWIndex {
  private nodes: Map<string, HNSWNode> = new Map();
  private entryPoint: string | null = null;
  private maxLayer: number = 0;
  private config: HNSWConfig;
  private dimensions: Set<number> = new Set();

  constructor(config: Partial<HNSWConfig> = {}) {
    this.config = {
      M: config.M ?? DEFAULT_HNSW_CONFIG.M,
      efConstruction: config.efConstruction ?? DEFAULT_HNSW_CONFIG.efConstruction,
      efSearch: config.efSearch ?? DEFAULT_HNSW_CONFIG.efSearch,
    };
  }

  /**
   * Get the number of nodes in the index.
   */
  size(): number {
    return this.nodes.size;
  }

  /**
   * Check if the index contains vectors of the given dimension.
   */
  hasDimension(length: number): boolean {
    return this.dimensions.has(length);
  }

  /**
   * Clear all nodes from the index.
   */
  clear(): void {
    this.nodes.clear();
    this.entryPoint = null;
    this.maxLayer = 0;
    this.dimensions.clear();
  }

  /**
   * Calculate the random level for a new node.
   * Uses exponential distribution with mean 1/ln(M).
   */
  private getRandomLevel(): number {
    const ml = 1 / Math.log(this.config.M);
    return Math.floor(-Math.log(Math.random()) * ml);
  }

  /**
   * Insert a new vector into the index.
   *
   * @param id - Unique identifier for the entity
   * @param vector - The embedding vector
   * @param entityType - Type of entity (function, module, document)
   */
  insert(id: string, vector: Float32Array, entityType: VectorIndexEntityType): void {
    // Skip if already exists
    if (this.nodes.has(id)) {
      // Update existing node's vector
      const existing = this.nodes.get(id)!;
      existing.vector = vector;
      return;
    }

    this.dimensions.add(vector.length);
    const level = this.getRandomLevel();
    const node: HNSWNode = {
      id,
      vector,
      entityType,
      connections: new Map(),
    };

    // First node becomes entry point
    if (this.entryPoint === null) {
      this.nodes.set(id, node);
      this.entryPoint = id;
      this.maxLayer = level;
      return;
    }

    let currentNodeId = this.entryPoint;

    // Phase 1: Greedy search from top layer down to level+1
    // Find the closest node at each layer
    for (let l = this.maxLayer; l > level; l--) {
      const searchResult = this.searchLayer(vector, currentNodeId, 1, l);
      if (searchResult.length > 0) {
        currentNodeId = searchResult[0]!.id;
      }
    }

    // Phase 2: Insert at each layer from min(level, maxLayer) down to 0
    for (let l = Math.min(level, this.maxLayer); l >= 0; l--) {
      // Find ef_construction nearest neighbors at this layer
      const neighbors = this.searchLayer(vector, currentNodeId, this.config.efConstruction, l);
      const selectedNeighbors = this.selectNeighbors(neighbors, this.config.M);

      // Connect node to selected neighbors
      node.connections.set(l, selectedNeighbors.map(n => n.id));

      // Connect neighbors back to node (bidirectional links)
      for (const neighbor of selectedNeighbors) {
        const neighborNode = this.nodes.get(neighbor.id);
        if (!neighborNode) continue;

        const existingConns = neighborNode.connections.get(l) ?? [];
        if (existingConns.length < this.config.M * 2) {
          // Allow up to M*2 connections for robustness
          existingConns.push(id);
          neighborNode.connections.set(l, existingConns);
        } else {
          // If at max connections, replace with closer node if beneficial
          const neighborVec = neighborNode.vector;
          const newDist = this.cosineDistance(vector, neighborVec);

          // Find the farthest existing connection
          let farthestDist = -1;
          let farthestIdx = -1;
          for (let i = 0; i < existingConns.length; i++) {
            const connNode = this.nodes.get(existingConns[i]!);
            if (!connNode) continue;
            const dist = this.cosineDistance(connNode.vector, neighborVec);
            if (dist > farthestDist) {
              farthestDist = dist;
              farthestIdx = i;
            }
          }

          // Replace if new node is closer
          if (farthestIdx >= 0 && newDist < farthestDist) {
            existingConns[farthestIdx] = id;
            neighborNode.connections.set(l, existingConns);
          }
        }
      }

      // Use closest neighbor as entry point for next layer
      if (selectedNeighbors.length > 0) {
        currentNodeId = selectedNeighbors[0]!.id;
      }
    }

    this.nodes.set(id, node);

    // Update entry point if this node has a higher level
    if (level > this.maxLayer) {
      this.maxLayer = level;
      this.entryPoint = id;
    }
  }

  /**
   * Search for the k nearest neighbors of a query vector.
   *
   * @param query - The query embedding vector
   * @param k - Number of neighbors to return
   * @param entityTypes - Optional filter by entity types
   * @param minSimilarity - Minimum similarity threshold (default: 0)
   * @returns Array of results sorted by similarity (highest first)
   */
  search(
    query: Float32Array,
    k: number,
    entityTypes?: VectorIndexEntityType[],
    minSimilarity: number = 0
  ): Array<{ id: string; entityType: VectorIndexEntityType; similarity: number }> {
    if (this.entryPoint === null || this.nodes.size === 0) {
      return [];
    }

    let currentNodeId = this.entryPoint;

    // Phase 1: Greedy search from top layer down to layer 1
    for (let l = this.maxLayer; l > 0; l--) {
      const searchResult = this.searchLayer(query, currentNodeId, 1, l);
      if (searchResult.length > 0) {
        currentNodeId = searchResult[0]!.id;
      }
    }

    // Phase 2: Search at layer 0 with efSearch candidates
    const candidates = this.searchLayer(query, currentNodeId, this.config.efSearch, 0);

    // Filter by entity type and minimum similarity
    const typeSet = entityTypes?.length ? new Set(entityTypes) : null;
    const results: Array<{ id: string; entityType: VectorIndexEntityType; similarity: number }> = [];

    for (const candidate of candidates) {
      const node = this.nodes.get(candidate.id);
      if (!node) continue;
      if (typeSet && !typeSet.has(node.entityType)) continue;

      const similarity = 1 - candidate.distance; // Convert distance to similarity
      if (similarity >= minSimilarity) {
        results.push({
          id: candidate.id,
          entityType: node.entityType,
          similarity,
        });
      }
    }

    // Sort by similarity descending and take top k
    results.sort((a, b) => b.similarity - a.similarity);
    return results.slice(0, k);
  }

  /**
   * Search within a single layer using greedy algorithm.
   * Returns candidates sorted by distance (ascending).
   */
  private searchLayer(
    query: Float32Array,
    entryId: string,
    ef: number,
    layer: number
  ): Array<{ id: string; distance: number }> {
    const visited = new Set<string>();
    const candidates: Array<{ id: string; distance: number }> = [];
    const results: Array<{ id: string; distance: number }> = [];

    const entryNode = this.nodes.get(entryId);
    if (!entryNode) return [];

    const entryDist = this.cosineDistance(query, entryNode.vector);
    candidates.push({ id: entryId, distance: entryDist });
    results.push({ id: entryId, distance: entryDist });
    visited.add(entryId);

    while (candidates.length > 0) {
      // Get closest unprocessed candidate
      candidates.sort((a, b) => a.distance - b.distance);
      const current = candidates.shift()!;

      // Get the farthest result
      results.sort((a, b) => a.distance - b.distance);
      const farthest = results[results.length - 1];

      // Stop if current candidate is farther than the farthest result
      // and we have enough results
      if (farthest && current.distance > farthest.distance && results.length >= ef) {
        break;
      }

      const node = this.nodes.get(current.id);
      if (!node) continue;

      const connections = node.connections.get(layer) ?? [];

      for (const connId of connections) {
        if (visited.has(connId)) continue;
        visited.add(connId);

        const connNode = this.nodes.get(connId);
        if (!connNode) continue;

        const dist = this.cosineDistance(query, connNode.vector);
        const resultFarthest = results[results.length - 1];

        // Add to candidates and results if close enough
        if (results.length < ef || (resultFarthest && dist < resultFarthest.distance)) {
          candidates.push({ id: connId, distance: dist });
          results.push({ id: connId, distance: dist });

          // Keep results bounded to ef
          if (results.length > ef) {
            results.sort((a, b) => a.distance - b.distance);
            results.pop();
          }
        }
      }
    }

    return results.sort((a, b) => a.distance - b.distance);
  }

  /**
   * Select M neighbors using simple heuristic (closest by distance).
   * More sophisticated selection could use diversity heuristics.
   */
  private selectNeighbors(
    candidates: Array<{ id: string; distance: number }>,
    M: number
  ): Array<{ id: string; distance: number }> {
    // Sort by distance and take closest M
    const sorted = [...candidates].sort((a, b) => a.distance - b.distance);
    return sorted.slice(0, M);
  }

  /**
   * Compute cosine distance between two vectors.
   * Distance = 1 - similarity (range: 0 to 2)
   */
  private cosineDistance(a: Float32Array, b: Float32Array): number {
    if (a.length !== b.length) return 2; // Maximum distance for dimension mismatch

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      const av = a[i] ?? 0;
      const bv = b[i] ?? 0;
      dotProduct += av * bv;
      normA += av * av;
      normB += bv * bv;
    }

    if (normA === 0 || normB === 0) return 1; // No direction = medium distance

    const similarity = dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    return 1 - similarity;
  }

  /**
   * Get statistics about the index structure.
   */
  getStats(): {
    nodeCount: number;
    maxLayer: number;
    avgConnectionsPerNode: number;
    entryPoint: string | null;
  } {
    let totalConnections = 0;
    for (const node of this.nodes.values()) {
      for (const conns of node.connections.values()) {
        totalConnections += conns.length;
      }
    }

    return {
      nodeCount: this.nodes.size,
      maxLayer: this.maxLayer,
      avgConnectionsPerNode: this.nodes.size > 0 ? totalConnections / this.nodes.size : 0,
      entryPoint: this.entryPoint,
    };
  }

  /**
   * Remove a node from the index.
   * Note: This is a basic implementation that may leave orphaned connections.
   * For production use, consider rebuilding affected layers.
   */
  remove(id: string): boolean {
    const node = this.nodes.get(id);
    if (!node) return false;

    // Remove this node from all neighbors' connection lists
    for (const [layer, connections] of node.connections) {
      for (const connId of connections) {
        const connNode = this.nodes.get(connId);
        if (!connNode) continue;

        const connConns = connNode.connections.get(layer);
        if (connConns) {
          const idx = connConns.indexOf(id);
          if (idx >= 0) {
            connConns.splice(idx, 1);
          }
        }
      }
    }

    this.nodes.delete(id);

    // If we removed the entry point, find a new one
    if (this.entryPoint === id) {
      if (this.nodes.size > 0) {
        // Find node with highest layer
        let maxLevel = -1;
        let newEntry: string | null = null;
        for (const [nodeId, n] of this.nodes) {
          const nodeMaxLayer = Math.max(...Array.from(n.connections.keys()), 0);
          if (nodeMaxLayer > maxLevel) {
            maxLevel = nodeMaxLayer;
            newEntry = nodeId;
          }
        }
        this.entryPoint = newEntry;
        this.maxLayer = maxLevel;
      } else {
        this.entryPoint = null;
        this.maxLayer = 0;
      }
    }

    return true;
  }
}

// ============================================================================
// VectorIndex with Optional HNSW Mode
// ============================================================================

/**
 * Threshold above which HNSW mode is automatically enabled.
 * Below this size, brute-force is fast enough.
 */
// Auto-enable HNSW only for large indexes.
//
// NOTE: HNSW graph construction is expensive in pure TypeScript and can dominate
// cold-start latency (e.g. CLI one-shot queries). For small/medium corpora,
// brute-force cosine similarity is typically fast enough and avoids multi-second
// index build time.
export const HNSW_AUTO_THRESHOLD = 50_000;

export interface VectorIndexConfig {
  /** Use HNSW index for O(log n) search. Auto-enabled when size > HNSW_AUTO_THRESHOLD */
  useHNSW?: boolean | 'auto';
  /** HNSW configuration (only used if useHNSW is true) */
  hnswConfig?: Partial<HNSWConfig>;
  /** Threshold above which HNSW is auto-enabled when useHNSW="auto" */
  hnswAutoThreshold?: number;
}

export class VectorIndex {
  private items: VectorIndexItem[] = [];
  private dimensions = new Set<number>();
  private hnswIndex: HNSWIndex | null = null;
  private config: VectorIndexConfig;
  private useHNSWMode: boolean = false;

  constructor(config: VectorIndexConfig = {}) {
    const hnswAutoThreshold =
      typeof config.hnswAutoThreshold === 'number' && Number.isFinite(config.hnswAutoThreshold) && config.hnswAutoThreshold > 0
        ? config.hnswAutoThreshold
        : HNSW_AUTO_THRESHOLD;
    this.config = {
      useHNSW: config.useHNSW ?? 'auto',
      hnswConfig: config.hnswConfig,
      hnswAutoThreshold,
    };
  }

  /**
   * Load items into the index.
   * If HNSW mode is enabled, builds the HNSW graph.
   */
  load(items: VectorIndexItem[]): void {
    this.items = items;
    this.dimensions = new Set(items.map((item) => item.embedding.length));

    // Determine if we should use HNSW
    if (this.config.useHNSW === true) {
      this.useHNSWMode = true;
    } else if (this.config.useHNSW === 'auto') {
      this.useHNSWMode = items.length >= (this.config.hnswAutoThreshold ?? HNSW_AUTO_THRESHOLD);
    } else {
      this.useHNSWMode = false;
    }

    // Build HNSW index if enabled
    if (this.useHNSWMode) {
      this.hnswIndex = new HNSWIndex(this.config.hnswConfig);
      for (const item of items) {
        this.hnswIndex.insert(item.entityId, item.embedding, item.entityType);
      }
    } else {
      this.hnswIndex = null;
    }
  }

  /**
   * Add a single item to the index.
   * More efficient than reloading for incremental updates.
   */
  add(item: VectorIndexItem): void {
    this.items.push(item);
    this.dimensions.add(item.embedding.length);

    // Check if we should switch to HNSW mode
    if (
      this.config.useHNSW === 'auto' &&
      !this.useHNSWMode &&
      this.items.length >= (this.config.hnswAutoThreshold ?? HNSW_AUTO_THRESHOLD)
    ) {
      // Upgrade to HNSW mode
      this.load(this.items);
      return;
    }

    // Add to HNSW if in HNSW mode
    if (this.useHNSWMode && this.hnswIndex) {
      this.hnswIndex.insert(item.entityId, item.embedding, item.entityType);
    }
  }

  /**
   * Remove an item from the index by entity ID.
   */
  removeById(entityId: string): boolean {
    const idx = this.items.findIndex(item => item.entityId === entityId);
    if (idx < 0) return false;

    this.items.splice(idx, 1);

    if (this.useHNSWMode && this.hnswIndex) {
      this.hnswIndex.remove(entityId);
    }

    return true;
  }

  clear(): void {
    this.items = [];
    this.dimensions.clear();
    if (this.hnswIndex) {
      this.hnswIndex.clear();
    }
  }

  size(): number { return this.items.length; }

  hasDimension(length: number): boolean { return this.dimensions.has(length); }

  /**
   * Check if the index is using HNSW mode.
   */
  isUsingHNSW(): boolean {
    return this.useHNSWMode;
  }

  /**
   * Get HNSW statistics (if in HNSW mode).
   */
  getHNSWStats(): ReturnType<HNSWIndex['getStats']> | null {
    return this.hnswIndex?.getStats() ?? null;
  }

  /**
   * Search for similar vectors.
   * Uses HNSW if enabled (O(log n)), otherwise brute-force (O(n)).
   */
  search(query: Float32Array, options: { limit: number; minSimilarity: number; entityTypes?: VectorIndexEntityType[] }): SimilarityResult[] {
    // Use HNSW if available
    if (this.useHNSWMode && this.hnswIndex) {
      const hnswResults = this.hnswIndex.search(
        query,
        options.limit,
        options.entityTypes,
        options.minSimilarity
      );

      return hnswResults.map(r => ({
        entityId: r.id,
        entityType: r.entityType,
        similarity: r.similarity,
      }));
    }

    // Fall back to brute-force for small indexes or when HNSW is disabled
    const results: SimilarityResult[] = [];
    const typeSet = options.entityTypes?.length ? new Set(options.entityTypes) : null;

    for (const item of this.items) {
      if (typeSet && !typeSet.has(item.entityType)) continue;
      if (item.embedding.length !== query.length) continue;

      const similarity = cosineSimilarity(query, item.embedding);
      if (similarity >= options.minSimilarity) {
        results.push({
          entityId: item.entityId,
          entityType: item.entityType,
          similarity,
        });
      }
    }

    results.sort((a, b) => b.similarity - a.similarity);
    return results.slice(0, options.limit);
  }
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
