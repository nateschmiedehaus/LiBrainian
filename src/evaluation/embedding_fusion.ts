/**
 * @fileoverview Hybrid Embedding Fusion Pipeline (WU-EMB-003)
 *
 * Combines multiple embedding types (BM25, dense, graph) using configurable
 * fusion strategies to optimize retrieval quality.
 *
 * @packageDocumentation
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Configuration for an embedding source
 */
export interface EmbeddingSource {
  /** Unique name for this source */
  name: string;
  /** Type of embedding: sparse (BM25), dense (neural), or graph */
  type: 'sparse' | 'dense' | 'graph';
  /** Dimension of the embedding vectors (optional for sparse) */
  dimension?: number;
  /** Whether to normalize embeddings from this source */
  normalize: boolean;
}

/**
 * Strategy for fusing multiple embeddings
 */
export interface FusionStrategy {
  /** Type of fusion to apply */
  type: 'weighted_sum' | 'concatenate' | 'attention' | 'rrf';
  /** Weights for each embedding source (for weighted_sum) */
  weights?: number[];
  /** Whether to use learned/adaptive weights */
  learnedWeights?: boolean;
}

/**
 * Input for the fusion operation
 */
export interface FusionInput {
  /** The query string being processed */
  query: string;
  /** Map from source name to embedding vector */
  embeddings: Map<string, number[]>;
  /** The fusion strategy to use */
  strategy: FusionStrategy;
}

/**
 * Result of fusing multiple embeddings
 */
export interface FusedEmbedding {
  /** The fused embedding vector */
  vector: number[];
  /** Contribution of each source to the final embedding */
  sourceContributions: Map<string, number>;
  /** The strategy used for fusion */
  strategy: string;
  /** Metadata about the fusion */
  metadata: {
    /** Dimension of the fused vector */
    dimension: number;
    /** Whether the result is normalized */
    normalized: boolean;
    /** Time taken to perform fusion (in milliseconds) */
    fusionTime: number;
  };
}

/**
 * Metrics for evaluating fusion quality
 */
export interface FusionMetrics {
  /** Unique identifier for the query */
  queryId: string;
  /** Relevance score (0-1) */
  relevanceScore: number;
  /** Diversity score (0-1) */
  diversityScore: number;
  /** Overall fusion quality (0-1) */
  fusionQuality: number;
  /** Weights assigned to each source */
  sourceWeights: Map<string, number>;
}

// ============================================================================
// EMBEDDING FUSION CLASS
// ============================================================================

/**
 * Hybrid embedding fusion pipeline
 *
 * Combines multiple embedding types using configurable strategies:
 * - weighted_sum: Linear combination with configurable weights
 * - concatenate: Concatenate all embeddings into one vector
 * - attention: Query-aware attention-based fusion
 * - rrf: Reciprocal Rank Fusion for rank-based combination
 */
export class EmbeddingFusion {
  private sources: Map<string, EmbeddingSource> = new Map();
  private learnedWeights: Map<string, number> = new Map();
  private queryCount: number = 0;

  constructor(sources?: EmbeddingSource[]) {
    if (sources) {
      for (const source of sources) {
        this.sources.set(source.name, source);
        // Initialize equal weights
        this.learnedWeights.set(source.name, 1 / sources.length);
      }
    }
  }

  // ============================================================================
  // SOURCE MANAGEMENT
  // ============================================================================

  /**
   * Register a new embedding source
   */
  registerSource(source: EmbeddingSource): void {
    if (this.sources.has(source.name)) {
      throw new Error(`Source '${source.name}' is already registered`);
    }
    this.sources.set(source.name, source);
    this.rebalanceLearnedWeights();
  }

  /**
   * Remove a registered source
   */
  removeSource(name: string): void {
    this.sources.delete(name);
    this.learnedWeights.delete(name);
    this.rebalanceLearnedWeights();
  }

  /**
   * Get all registered sources
   */
  getSources(): EmbeddingSource[] {
    return Array.from(this.sources.values());
  }

  /**
   * Get a source by name
   */
  getSource(name: string): EmbeddingSource | undefined {
    return this.sources.get(name);
  }

  /**
   * Get current learned weights
   */
  getLearnedWeights(): Map<string, number> {
    return new Map(this.learnedWeights);
  }

  /**
   * Rebalance learned weights when sources change
   */
  private rebalanceLearnedWeights(): void {
    const sourceCount = this.sources.size;
    if (sourceCount === 0) return;

    const equalWeight = 1 / sourceCount;
    for (const name of this.sources.keys()) {
      if (!this.learnedWeights.has(name)) {
        this.learnedWeights.set(name, equalWeight);
      }
    }

    // Normalize weights to sum to 1
    this.normalizeLearnedWeights();
  }

  /**
   * Normalize learned weights to sum to 1
   */
  private normalizeLearnedWeights(): void {
    const total = Array.from(this.learnedWeights.values()).reduce((sum, w) => sum + w, 0);
    if (total > 0) {
      for (const [name, weight] of this.learnedWeights) {
        this.learnedWeights.set(name, weight / total);
      }
    }
  }

  // ============================================================================
  // NORMALIZATION
  // ============================================================================

  /**
   * Normalize an embedding to unit length (L2 norm = 1)
   */
  normalize(embedding: number[]): number[] {
    const magnitude = Math.sqrt(
      embedding.reduce((sum, v) => sum + v * v, 0)
    );

    if (magnitude === 0) {
      return embedding.slice(); // Return copy of zero vector
    }

    return embedding.map((v) => v / magnitude);
  }

  // ============================================================================
  // FUSION METHODS
  // ============================================================================

  /**
   * Compute weighted sum of embeddings
   */
  weightedSum(embeddings: number[][], weights: number[]): number[] {
    if (embeddings.length === 0) {
      return [];
    }

    if (embeddings.length !== weights.length) {
      throw new Error(`Mismatched weights count: ${weights.length} weights for ${embeddings.length} embeddings`);
    }

    // Check all embeddings have same dimension
    const dimension = embeddings[0].length;
    for (let i = 1; i < embeddings.length; i++) {
      if (embeddings[i].length !== dimension) {
        throw new Error(
          `Mismatched dimension: embedding ${i} has ${embeddings[i].length} dimensions, expected ${dimension}`
        );
      }
    }

    // Normalize weights if they don't sum to 1
    const weightSum = weights.reduce((sum, w) => sum + w, 0);
    const normalizedWeights = weightSum !== 1
      ? weights.map((w) => w / weightSum)
      : weights;

    // Compute weighted sum
    const result: number[] = new Array(dimension).fill(0);
    for (let i = 0; i < embeddings.length; i++) {
      for (let j = 0; j < dimension; j++) {
        result[j] += embeddings[i][j] * normalizedWeights[i];
      }
    }

    return result;
  }

  /**
   * Concatenate multiple embeddings into one vector
   */
  concatenate(embeddings: number[][]): number[] {
    if (embeddings.length === 0) {
      return [];
    }

    const result: number[] = [];
    for (const embedding of embeddings) {
      result.push(...embedding);
    }
    return result;
  }

  /**
   * Attention-based fusion using query similarity
   */
  attentionFuse(query: string, embeddings: Map<string, number[]>): number[] {
    if (embeddings.size === 0) {
      return [];
    }

    const entries = Array.from(embeddings.entries());
    const dimension = entries[0][1].length;

    // Compute attention scores based on query hash (simplified attention)
    // In a real implementation, this would use learned attention weights
    const queryHash = this.hashQuery(query);
    const attentionScores: number[] = [];

    for (let i = 0; i < entries.length; i++) {
      // Generate pseudo-attention scores based on query and embedding characteristics
      const [name, emb] = entries[i];
      const embMagnitude = Math.sqrt(emb.reduce((sum, v) => sum + v * v, 0));
      const score = Math.abs(Math.sin(queryHash + i + embMagnitude));
      attentionScores.push(score);
    }

    // Softmax normalization of attention scores
    const maxScore = Math.max(...attentionScores);
    const expScores = attentionScores.map((s) => Math.exp(s - maxScore));
    const expSum = expScores.reduce((sum, e) => sum + e, 0);
    const normalizedScores = expScores.map((e) => e / expSum);

    // Weighted combination using attention scores
    const result: number[] = new Array(dimension).fill(0);
    for (let i = 0; i < entries.length; i++) {
      const embedding = entries[i][1];
      for (let j = 0; j < dimension; j++) {
        result[j] += embedding[j] * normalizedScores[i];
      }
    }

    return result;
  }

  /**
   * Reciprocal Rank Fusion (RRF) - produces scores for ranking
   * Note: This produces a pseudo-embedding for consistency
   */
  private rrfFuse(embeddings: Map<string, number[]>, k: number = 60): number[] {
    if (embeddings.size === 0) {
      return [];
    }

    const entries = Array.from(embeddings.entries());
    const dimension = entries[0][1].length;

    // For RRF, we treat each dimension as a separate "document" and rank by value
    // This is a simplified adaptation for embedding space
    const result: number[] = new Array(dimension).fill(0);

    for (let j = 0; j < dimension; j++) {
      // Get values at this dimension from all sources
      const values = entries.map(([_, emb]) => emb[j]);

      // Rank values (higher is better)
      const ranked = values
        .map((v, idx) => ({ value: v, idx }))
        .sort((a, b) => b.value - a.value);

      // Apply RRF formula: sum of 1/(k + rank)
      let rrfScore = 0;
      for (let rank = 0; rank < ranked.length; rank++) {
        rrfScore += 1 / (k + rank + 1);
      }

      // Scale the result by the average value to preserve magnitude information
      const avgValue = values.reduce((sum, v) => sum + v, 0) / values.length;
      result[j] = rrfScore * avgValue;
    }

    return result;
  }

  /**
   * Simple hash function for query strings
   */
  private hashQuery(query: string): number {
    let hash = 0;
    for (let i = 0; i < query.length; i++) {
      const char = query.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }

  // ============================================================================
  // MAIN FUSION METHOD
  // ============================================================================

  /**
   * Fuse multiple embeddings using the specified strategy
   */
  fuse(input: FusionInput): FusedEmbedding {
    const startTime = performance.now();

    // Validate input
    if (input.embeddings.size === 0) {
      throw new Error('No embeddings provided for fusion');
    }

    // Validate embeddings
    this.validateEmbeddings(input.embeddings);

    const sourceNames = Array.from(input.embeddings.keys());
    const embeddingArrays = Array.from(input.embeddings.values());

    // Determine weights
    let weights: number[];
    if (input.strategy.learnedWeights) {
      weights = sourceNames.map((name) => this.learnedWeights.get(name) ?? 1 / sourceNames.length);
    } else if (input.strategy.weights) {
      weights = input.strategy.weights;
    } else {
      weights = new Array(sourceNames.length).fill(1 / sourceNames.length);
    }

    // Normalize weights
    const weightSum = weights.reduce((sum, w) => sum + w, 0);
    weights = weights.map((w) => w / weightSum);

    // Build source contributions map
    const sourceContributions = new Map<string, number>();
    for (let i = 0; i < sourceNames.length; i++) {
      sourceContributions.set(sourceNames[i], weights[i]);
    }

    // Apply fusion strategy
    let vector: number[];
    switch (input.strategy.type) {
      case 'weighted_sum':
        vector = this.weightedSum(embeddingArrays, weights);
        break;

      case 'concatenate':
        vector = this.concatenate(embeddingArrays);
        break;

      case 'attention':
        vector = this.attentionFuse(input.query, input.embeddings);
        // Update contributions based on attention (simplified)
        const attentionContribs = this.computeAttentionContributions(input.query, input.embeddings);
        for (const [name, contrib] of attentionContribs) {
          sourceContributions.set(name, contrib);
        }
        break;

      case 'rrf':
        vector = this.rrfFuse(input.embeddings);
        break;

      default:
        throw new Error(`Unknown fusion strategy: ${input.strategy.type}`);
    }

    // Optionally normalize the result
    const shouldNormalize = input.strategy.type !== 'concatenate';
    if (shouldNormalize) {
      vector = this.normalize(vector);
    }

    const endTime = performance.now();

    return {
      vector,
      sourceContributions,
      strategy: input.strategy.type,
      metadata: {
        dimension: vector.length,
        normalized: shouldNormalize,
        fusionTime: endTime - startTime,
      },
    };
  }

  /**
   * Validate that all embeddings are valid numeric arrays
   */
  private validateEmbeddings(embeddings: Map<string, number[]>): void {
    let expectedDimension: number | null = null;

    for (const [name, emb] of embeddings) {
      if (expectedDimension === null) {
        expectedDimension = emb.length;
      } else if (emb.length !== expectedDimension) {
        throw new Error(
          `Dimension mismatch: '${name}' has ${emb.length} dimensions, expected ${expectedDimension}`
        );
      }

      for (let i = 0; i < emb.length; i++) {
        if (typeof emb[i] !== 'number' || !Number.isFinite(emb[i])) {
          throw new Error(
            `Invalid value in embedding '${name}' at index ${i}: ${emb[i]}`
          );
        }
      }
    }
  }

  /**
   * Compute attention-based contributions for each source
   */
  private computeAttentionContributions(
    query: string,
    embeddings: Map<string, number[]>
  ): Map<string, number> {
    const entries = Array.from(embeddings.entries());
    const queryHash = this.hashQuery(query);

    const scores: number[] = [];
    for (let i = 0; i < entries.length; i++) {
      const [_, emb] = entries[i];
      const embMagnitude = Math.sqrt(emb.reduce((sum, v) => sum + v * v, 0));
      const score = Math.abs(Math.sin(queryHash + i + embMagnitude));
      scores.push(score);
    }

    // Softmax
    const maxScore = Math.max(...scores);
    const expScores = scores.map((s) => Math.exp(s - maxScore));
    const expSum = expScores.reduce((sum, e) => sum + e, 0);

    const contributions = new Map<string, number>();
    for (let i = 0; i < entries.length; i++) {
      contributions.set(entries[i][0], expScores[i] / expSum);
    }

    return contributions;
  }

  // ============================================================================
  // METRICS COMPUTATION
  // ============================================================================

  /**
   * Compute quality metrics for a fused embedding
   */
  computeMetrics(fused: FusedEmbedding, relevantDocs: string[]): FusionMetrics {
    this.queryCount++;

    // Relevance score: based on embedding magnitude and spread
    const magnitude = Math.sqrt(
      fused.vector.reduce((sum, v) => sum + v * v, 0)
    );
    const normalizedMagnitude = Math.min(1, magnitude);

    // Diversity score: based on variance in the embedding
    const mean = fused.vector.reduce((sum, v) => sum + v, 0) / fused.vector.length;
    const variance = fused.vector.reduce((sum, v) => sum + (v - mean) ** 2, 0) / fused.vector.length;
    const normalizedVariance = Math.min(1, Math.sqrt(variance) * 2);

    // Fusion quality: combination of multiple factors
    const contributionBalance = this.computeContributionBalance(fused.sourceContributions);
    const fusionQuality = (normalizedMagnitude + normalizedVariance + contributionBalance) / 3;

    // Adjust based on relevant docs (more docs = slightly higher score)
    const docBonus = Math.min(0.1, relevantDocs.length * 0.02);

    return {
      queryId: `query-${this.queryCount}`,
      relevanceScore: Math.min(1, normalizedMagnitude + docBonus),
      diversityScore: normalizedVariance,
      fusionQuality: Math.min(1, fusionQuality),
      sourceWeights: new Map(fused.sourceContributions),
    };
  }

  /**
   * Compute how balanced the source contributions are (higher = more balanced)
   */
  private computeContributionBalance(contributions: Map<string, number>): number {
    if (contributions.size <= 1) return 1;

    const values = Array.from(contributions.values());
    const idealWeight = 1 / values.length;

    // Compute deviation from ideal equal weights
    const deviation = values.reduce(
      (sum, v) => sum + Math.abs(v - idealWeight),
      0
    ) / values.length;

    // Transform to 0-1 scale where 1 is perfectly balanced
    return Math.max(0, 1 - deviation * 2);
  }

  // ============================================================================
  // WEIGHT LEARNING
  // ============================================================================

  /**
   * Update learned weights based on feedback metrics
   */
  updateWeightsFromFeedback(metrics: FusionMetrics): void {
    // Simple gradient-free weight update based on performance
    const performanceScore = (metrics.relevanceScore + metrics.fusionQuality) / 2;

    // If performance is good, slightly increase weights for sources that contributed more
    // If performance is bad, move toward equal weights
    const learningRate = 0.1;

    if (performanceScore > 0.7) {
      // Good performance: reinforce current weights
      for (const [name, weight] of metrics.sourceWeights) {
        const currentWeight = this.learnedWeights.get(name) ?? 0;
        const newWeight = currentWeight + learningRate * (weight - currentWeight);
        this.learnedWeights.set(name, newWeight);
      }
    } else {
      // Poor performance: move toward equal weights
      const equalWeight = 1 / this.learnedWeights.size;
      for (const [name, weight] of this.learnedWeights) {
        const newWeight = weight + learningRate * (equalWeight - weight);
        this.learnedWeights.set(name, newWeight);
      }
    }

    // Normalize weights
    this.normalizeLearnedWeights();
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a new EmbeddingFusion instance
 */
export function createEmbeddingFusion(sources?: EmbeddingSource[]): EmbeddingFusion {
  return new EmbeddingFusion(sources);
}
