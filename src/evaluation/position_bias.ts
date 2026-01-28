/**
 * @fileoverview Position Bias Mitigation (WU-CTX-001)
 *
 * Addresses the "lost in the middle" phenomenon in LLM contexts where models
 * tend to pay less attention to information placed in the middle of their context.
 *
 * This module provides strategies for reordering context chunks to optimize
 * information retention by placing important content at the start and end
 * of the context window.
 *
 * Research Reference: Liu et al. (2023) "Lost in the Middle: How Language Models
 * Use Long Contexts"
 *
 * @packageDocumentation
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * A chunk of context that can be positioned within an LLM's context window.
 */
export interface ContextChunk {
  /** Unique identifier for this chunk */
  id: string;
  /** The actual content of the chunk */
  content: string;
  /** Importance score from 0-1 (higher = more important) */
  importance: number;
  /** Type of content for semantic understanding */
  type: 'code' | 'documentation' | 'comment' | 'example';
  /** Number of tokens in this chunk */
  tokens: number;
}

/**
 * Strategy for reordering context chunks to mitigate position bias.
 */
export interface ReorderingStrategy {
  /** Name of the strategy */
  name: 'importance_first' | 'importance_edges' | 'round_robin' | 'custom';
  /** Human-readable description of what the strategy does */
  description: string;
}

/**
 * Result of reordering context chunks.
 */
export interface ReorderedContext {
  /** The reordered chunks */
  chunks: ContextChunk[];
  /** Original order of chunk IDs */
  originalOrder: string[];
  /** New order of chunk IDs after reordering */
  newOrder: string[];
  /** Strategy used for reordering */
  strategy: string;
  /** Position tracking for important chunks */
  importantPositions: { id: string; position: 'start' | 'middle' | 'end' }[];
}

/**
 * Analysis of chunk positions and associated risks.
 */
export interface PositionAnalysis {
  /** Total number of chunks analyzed */
  totalChunks: number;
  /** Count of important chunks (importance >= 0.7) in the middle 60% */
  importantInMiddle: number;
  /** Risk score from 0-1 (higher = more likely to lose information) */
  riskScore: number;
  /** Recommendations for improving information retention */
  recommendations: string[];
}

// ============================================================================
// CONSTANTS
// ============================================================================

/** Threshold for considering a chunk "important" */
const IMPORTANCE_THRESHOLD = 0.7;

/** Percentage of context considered "middle" (prone to lost-in-middle effect) */
const MIDDLE_PERCENTAGE = 0.6;

/** Type weights for query matching (code is typically most relevant) */
const TYPE_WEIGHTS: Record<ContextChunk['type'], number> = {
  code: 0.05,
  example: 0.03,
  documentation: 0.02,
  comment: 0.01,
};

// ============================================================================
// POSITION BIAS MANAGER CLASS
// ============================================================================

/**
 * Manages position bias mitigation for LLM context windows.
 *
 * This class provides methods to analyze and reorder context chunks
 * to minimize the "lost in the middle" phenomenon.
 *
 * @example
 * ```typescript
 * const manager = createPositionBiasManager();
 *
 * // Analyze current chunk positions
 * const analysis = manager.analyzePositions(chunks);
 * console.log(`Risk score: ${analysis.riskScore}`);
 *
 * // Reorder chunks to mitigate position bias
 * const strategy = { name: 'importance_edges', description: 'Place important at edges' };
 * const result = manager.reorder(chunks, strategy);
 * ```
 */
export class PositionBiasManager {
  /**
   * Analyze the positions of chunks and assess risk of information loss.
   *
   * The middle 60% of the context is considered high-risk for the
   * "lost in the middle" phenomenon. This method counts important
   * chunks in that region and calculates a risk score.
   *
   * @param chunks - Array of context chunks to analyze
   * @returns Analysis including risk score and recommendations
   */
  analyzePositions(chunks: ContextChunk[]): PositionAnalysis {
    if (chunks.length === 0) {
      return {
        totalChunks: 0,
        importantInMiddle: 0,
        riskScore: 0,
        recommendations: [],
      };
    }

    if (chunks.length <= 2) {
      return {
        totalChunks: chunks.length,
        importantInMiddle: 0,
        riskScore: 0,
        recommendations: [],
      };
    }

    // Calculate middle region bounds
    const middleStart = Math.floor(chunks.length * (1 - MIDDLE_PERCENTAGE) / 2);
    const middleEnd = Math.ceil(chunks.length * (1 + MIDDLE_PERCENTAGE) / 2);

    // Count important chunks in middle
    let importantInMiddle = 0;
    let totalImportant = 0;

    for (let i = 0; i < chunks.length; i++) {
      if (chunks[i].importance >= IMPORTANCE_THRESHOLD) {
        totalImportant++;
        if (i >= middleStart && i < middleEnd) {
          importantInMiddle++;
        }
      }
    }

    // Calculate risk score
    // Risk is based on: (1) how many important chunks are in the middle
    // (2) what proportion of all important chunks are in the middle
    let riskScore = 0;
    if (totalImportant > 0) {
      const middleRatio = importantInMiddle / totalImportant;
      // Weight by both the ratio and absolute count
      riskScore = middleRatio * 0.6 + Math.min(importantInMiddle / 3, 1) * 0.4;
    }

    // Generate recommendations
    const recommendations: string[] = [];
    if (riskScore > 0.5) {
      recommendations.push('Consider reordering chunks to place important information at the start or end');
      recommendations.push(`Found ${importantInMiddle} important chunk(s) in the middle region that may be overlooked`);
    }
    if (riskScore > 0.7) {
      recommendations.push('High risk of "lost in the middle" effect - strongly recommend using importance_edges strategy');
    }
    if (totalImportant === 0 && chunks.length > 3) {
      recommendations.push('No chunks marked as highly important - consider reviewing importance scores');
    }

    return {
      totalChunks: chunks.length,
      importantInMiddle,
      riskScore,
      recommendations,
    };
  }

  /**
   * Reorder chunks according to the specified strategy.
   *
   * @param chunks - Array of context chunks to reorder
   * @param strategy - Strategy to use for reordering
   * @returns Reordered context with tracking information
   */
  reorder(chunks: ContextChunk[], strategy: ReorderingStrategy): ReorderedContext {
    if (chunks.length === 0) {
      return {
        chunks: [],
        originalOrder: [],
        newOrder: [],
        strategy: strategy.name,
        importantPositions: [],
      };
    }

    const originalOrder = chunks.map((c) => c.id);
    let reorderedChunks: ContextChunk[];

    switch (strategy.name) {
      case 'importance_first':
        reorderedChunks = this.importanceFirst(chunks);
        break;
      case 'importance_edges':
        reorderedChunks = this.importanceToEdges(chunks);
        break;
      case 'round_robin':
        reorderedChunks = this.roundRobinImportant(chunks);
        break;
      case 'custom':
      default:
        // Custom strategy returns chunks as-is (user should override)
        reorderedChunks = [...chunks];
        break;
    }

    const newOrder = reorderedChunks.map((c) => c.id);
    const importantPositions = this.computeImportantPositions(reorderedChunks);

    return {
      chunks: reorderedChunks,
      originalOrder,
      newOrder,
      strategy: strategy.name,
      importantPositions,
    };
  }

  /**
   * Reorder chunks with most important first (descending importance).
   *
   * This strategy is simple but effective: place the most important
   * information at the very beginning where LLMs pay most attention.
   *
   * @param chunks - Array of context chunks to reorder
   * @returns New array sorted by importance descending
   */
  importanceFirst(chunks: ContextChunk[]): ContextChunk[] {
    return [...chunks].sort((a, b) => b.importance - a.importance);
  }

  /**
   * Reorder chunks to place important information at edges.
   *
   * This strategy addresses the "lost in the middle" phenomenon by:
   * 1. Placing the most important chunk at the start
   * 2. Placing the second most important at the end
   * 3. Placing remaining important chunks alternating between near-start and near-end
   * 4. Filling the middle with less important chunks
   *
   * @param chunks - Array of context chunks to reorder
   * @returns New array with important chunks at edges
   */
  importanceToEdges(chunks: ContextChunk[]): ContextChunk[] {
    if (chunks.length <= 2) {
      return [...chunks].sort((a, b) => b.importance - a.importance);
    }

    // Sort by importance
    const sorted = [...chunks].sort((a, b) => b.importance - a.importance);

    // Separate into important and less important
    const important = sorted.filter((c) => c.importance >= IMPORTANCE_THRESHOLD);
    const lessImportant = sorted.filter((c) => c.importance < IMPORTANCE_THRESHOLD);

    // Build result with important at edges
    const result: ContextChunk[] = new Array(chunks.length);
    let startIdx = 0;
    let endIdx = chunks.length - 1;
    let useStart = true;

    // Place important chunks alternating start/end
    for (const chunk of important) {
      if (useStart) {
        result[startIdx++] = chunk;
      } else {
        result[endIdx--] = chunk;
      }
      useStart = !useStart;
    }

    // Fill remaining positions with less important chunks (in middle)
    let middleIdx = startIdx;
    for (const chunk of lessImportant) {
      while (middleIdx <= endIdx && result[middleIdx] !== undefined) {
        middleIdx++;
      }
      if (middleIdx <= endIdx) {
        result[middleIdx++] = chunk;
      }
    }

    return result;
  }

  /**
   * Spread important chunks at regular intervals throughout the context.
   *
   * This strategy ensures important information is distributed evenly,
   * so even if some middle content is ignored, important info appears
   * at multiple points the model is likely to attend to.
   *
   * @param chunks - Array of context chunks to reorder
   * @returns New array with important chunks spread evenly
   */
  roundRobinImportant(chunks: ContextChunk[]): ContextChunk[] {
    if (chunks.length <= 1) {
      return [...chunks];
    }

    // Separate important and less important
    const important = chunks.filter((c) => c.importance >= IMPORTANCE_THRESHOLD);
    const lessImportant = chunks.filter((c) => c.importance < IMPORTANCE_THRESHOLD);

    // If no clearly important chunks, use top third as "important"
    let importantToPlace: ContextChunk[];
    let lessImportantToPlace: ContextChunk[];

    if (important.length === 0) {
      const sorted = [...chunks].sort((a, b) => b.importance - a.importance);
      const topThird = Math.ceil(chunks.length / 3);
      importantToPlace = sorted.slice(0, topThird);
      lessImportantToPlace = sorted.slice(topThird);
    } else {
      // Sort important by importance descending
      importantToPlace = [...important].sort((a, b) => b.importance - a.importance);
      lessImportantToPlace = [...lessImportant];
    }

    if (importantToPlace.length === 0) {
      return [...chunks];
    }

    // Calculate interval for placing important chunks
    const totalSlots = chunks.length;
    const interval = Math.max(1, Math.floor(totalSlots / importantToPlace.length));

    // Build result
    const result: ContextChunk[] = new Array(totalSlots);
    let importantIdx = 0;

    // Place important chunks at regular intervals
    for (let i = 0; i < totalSlots && importantIdx < importantToPlace.length; i += interval) {
      result[i] = importantToPlace[importantIdx++];
    }

    // Fill remaining slots with less important chunks
    let lessIdx = 0;
    for (let i = 0; i < totalSlots; i++) {
      if (result[i] === undefined && lessIdx < lessImportantToPlace.length) {
        result[i] = lessImportantToPlace[lessIdx++];
      }
    }

    // Handle any remaining chunks (edge case with rounding)
    const remaining = [
      ...importantToPlace.slice(importantIdx),
      ...lessImportantToPlace.slice(lessIdx),
    ];
    for (let i = 0; i < totalSlots && remaining.length > 0; i++) {
      if (result[i] === undefined) {
        result[i] = remaining.shift()!;
      }
    }

    return result;
  }

  /**
   * Score the importance of a chunk relative to a query.
   *
   * This method adjusts a chunk's base importance based on how well
   * its content matches the user's query. This helps prioritize
   * query-relevant chunks during reordering.
   *
   * @param chunk - The context chunk to score
   * @param query - The user's query
   * @returns Adjusted importance score (0-1)
   */
  scoreImportance(chunk: ContextChunk, query: string): number {
    if (!query || query.trim().length === 0) {
      return chunk.importance;
    }

    if (!chunk.content || chunk.content.trim().length === 0) {
      return chunk.importance;
    }

    let score = chunk.importance;

    // Normalize for comparison
    const normalizedContent = chunk.content.toLowerCase();
    const normalizedQuery = query.toLowerCase();

    // Extract query terms (words with length >= 3)
    const queryTerms = normalizedQuery
      .split(/\s+/)
      .filter((term) => term.length >= 3)
      .map((term) => term.replace(/[<>]/g, '')); // Remove angle brackets

    // Calculate term match boost
    let matchCount = 0;
    for (const term of queryTerms) {
      if (normalizedContent.includes(term)) {
        matchCount++;
      }
    }

    if (queryTerms.length > 0) {
      const matchRatio = matchCount / queryTerms.length;
      // Boost score based on match ratio (up to 0.3 boost)
      score += matchRatio * 0.3;
    }

    // Add small type-based boost
    score += TYPE_WEIGHTS[chunk.type] || 0;

    // Clamp to [0, 1]
    return Math.max(0, Math.min(1, score));
  }

  // ============================================================================
  // PRIVATE HELPER METHODS
  // ============================================================================

  /**
   * Compute position labels for important chunks in the reordered array.
   *
   * @param chunks - Reordered chunks
   * @returns Array of position labels for important chunks
   */
  private computeImportantPositions(
    chunks: ContextChunk[]
  ): { id: string; position: 'start' | 'middle' | 'end' }[] {
    if (chunks.length === 0) {
      return [];
    }

    const positions: { id: string; position: 'start' | 'middle' | 'end' }[] = [];
    const startBound = Math.floor(chunks.length * 0.2);
    const endBound = Math.ceil(chunks.length * 0.8);

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      if (chunk.importance >= IMPORTANCE_THRESHOLD) {
        let position: 'start' | 'middle' | 'end';
        if (i < startBound) {
          position = 'start';
        } else if (i >= endBound) {
          position = 'end';
        } else {
          position = 'middle';
        }
        positions.push({ id: chunk.id, position });
      }
    }

    return positions;
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a new PositionBiasManager instance.
 *
 * @returns A new PositionBiasManager
 */
export function createPositionBiasManager(): PositionBiasManager {
  return new PositionBiasManager();
}
