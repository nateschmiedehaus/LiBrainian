/**
 * @fileoverview HypothesisGenerator for Retrieval Failures
 *
 * WU-SELF-001: Hypothesis Generation
 *
 * This module generates testable hypotheses about retrieval failures that can be
 * verified via code probes. It analyzes failure patterns to identify likely causes
 * and creates specific, actionable hypotheses for investigation.
 *
 * Hypothesis Types:
 * - missing_context: Required information not in the index
 * - wrong_ranking: Correct information ranked too low
 * - stale_data: Indexed data is outdated
 * - embedding_mismatch: Semantic embedding doesn't capture query intent
 * - query_ambiguity: Query is too vague or ambiguous
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * Types of hypotheses that can be generated for retrieval failures.
 */
export type HypothesisType =
  | 'missing_context'
  | 'wrong_ranking'
  | 'stale_data'
  | 'embedding_mismatch'
  | 'query_ambiguity';

/**
 * Types of probes that can test a hypothesis.
 */
export type ProbeType = 'query' | 'assertion' | 'comparison';

/**
 * A probe definition for testing a hypothesis.
 */
export interface HypothesisProbe {
  /** Type of probe to execute */
  type: ProbeType;
  /** Parameters for the probe */
  parameters: Record<string, unknown>;
}

/**
 * A hypothesis about a retrieval failure.
 */
export interface Hypothesis {
  /** Unique identifier for the hypothesis */
  id: string;
  /** Type of hypothesis */
  type: HypothesisType;
  /** Human-readable description of the hypothesis */
  description: string;
  /** Whether this hypothesis can be tested via a probe */
  testable: boolean;
  /** The probe to use for testing */
  probe: HypothesisProbe;
  /** Priority score (0.0 - 1.0), higher = more likely */
  priority: number;
  /** When the hypothesis was created */
  createdAt: Date;
}

/**
 * Input describing a retrieval failure.
 */
export interface RetrievalFailure {
  /** The query that failed to retrieve expected results */
  query: string;
  /** What result was expected (optional) */
  expectedResult?: string;
  /** What result was actually returned */
  actualResult: string;
  /** Contexts that were retrieved (may be empty or irrelevant) */
  retrievedContexts: string[];
}

/**
 * Result of testing a hypothesis.
 */
export interface HypothesisTestResult {
  /** Whether the hypothesis was confirmed */
  confirmed: boolean;
  /** Evidence supporting the conclusion */
  evidence: string;
}

/**
 * Entry in the test history.
 */
export interface TestHistoryEntry {
  /** ID of the hypothesis that was tested */
  hypothesisId: string;
  /** The hypothesis object */
  hypothesis: Hypothesis;
  /** Result of the test */
  result: HypothesisTestResult;
  /** When the test was performed */
  testedAt: Date;
}

/**
 * Configuration for the HypothesisGenerator.
 */
export interface HypothesisGeneratorConfig {
  /** Maximum number of hypotheses to generate per failure (default: 5) */
  maxHypothesesPerFailure?: number;
  /** Minimum priority threshold for including a hypothesis (default: 0.1) */
  minPriority?: number;
}

/**
 * Interface for the HypothesisGenerator.
 */
export interface HypothesisGenerator {
  /**
   * Generate hypotheses from a retrieval failure.
   *
   * @param failure - The retrieval failure to analyze
   * @returns Array of generated hypotheses
   */
  generateFromFailure(failure: RetrievalFailure): Promise<Hypothesis[]>;

  /**
   * Rank hypotheses by priority (descending).
   *
   * @param hypotheses - Array of hypotheses to rank
   * @returns Sorted array of hypotheses (highest priority first)
   */
  rankHypotheses(hypotheses: Hypothesis[]): Hypothesis[];

  /**
   * Get all active (untested) hypotheses.
   *
   * @returns Array of active hypotheses sorted by priority
   */
  getActiveHypotheses(): Hypothesis[];

  /**
   * Mark a hypothesis as tested.
   *
   * @param hypothesisId - ID of the hypothesis to mark
   * @param result - Result of the test
   */
  markTested(hypothesisId: string, result: HypothesisTestResult): void;

  /**
   * Get the test history.
   *
   * @returns Array of test history entries
   */
  getTestHistory(): TestHistoryEntry[];
}

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_CONFIG: Required<HypothesisGeneratorConfig> = {
  maxHypothesesPerFailure: 5,
  minPriority: 0.1,
};

/**
 * Priority weights for different hypothesis types based on common failure patterns.
 */
const TYPE_BASE_PRIORITIES: Record<HypothesisType, number> = {
  missing_context: 0.8,
  wrong_ranking: 0.7,
  stale_data: 0.6,
  embedding_mismatch: 0.5,
  query_ambiguity: 0.4,
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Generate a unique hypothesis ID.
 */
function generateHypothesisId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `hyp_${timestamp}_${random}`;
}

/**
 * Analyze failure characteristics to determine priority adjustments.
 */
function analyzeFailureCharacteristics(failure: RetrievalFailure): {
  hasExpectedResult: boolean;
  emptyContexts: boolean;
  manyContexts: boolean;
  shortQuery: boolean;
  longQuery: boolean;
  hasSpecialChars: boolean;
} {
  return {
    hasExpectedResult: !!failure.expectedResult,
    emptyContexts: failure.retrievedContexts.length === 0,
    manyContexts: failure.retrievedContexts.length > 3,
    shortQuery: failure.query.length < 10,
    longQuery: failure.query.length > 200,
    hasSpecialChars: /[<>{}[\]()&|!@#$%^*]/.test(failure.query),
  };
}

/**
 * Calculate adjusted priority based on failure characteristics.
 */
function calculatePriority(
  baseType: HypothesisType,
  characteristics: ReturnType<typeof analyzeFailureCharacteristics>
): number {
  let priority = TYPE_BASE_PRIORITIES[baseType];

  // Adjust based on characteristics
  switch (baseType) {
    case 'missing_context':
      if (characteristics.emptyContexts) {
        priority += 0.15;
      }
      if (characteristics.hasExpectedResult) {
        priority += 0.05;
      }
      break;

    case 'wrong_ranking':
      if (characteristics.manyContexts) {
        priority += 0.15;
      }
      if (!characteristics.emptyContexts && characteristics.hasExpectedResult) {
        priority += 0.1;
      }
      break;

    case 'stale_data':
      if (characteristics.hasExpectedResult) {
        priority += 0.1;
      }
      break;

    case 'embedding_mismatch':
      if (characteristics.hasSpecialChars) {
        priority += 0.1;
      }
      if (characteristics.longQuery) {
        priority += 0.05;
      }
      break;

    case 'query_ambiguity':
      if (characteristics.shortQuery) {
        priority += 0.3;
      }
      if (characteristics.manyContexts && !characteristics.hasExpectedResult) {
        priority += 0.1;
      }
      break;
  }

  // Clamp to [0, 1]
  return Math.max(0, Math.min(1, priority));
}

/**
 * Generate a probe for a missing_context hypothesis.
 */
function generateMissingContextProbe(failure: RetrievalFailure): HypothesisProbe {
  return {
    type: 'query',
    parameters: {
      searchQuery: failure.query,
      expectedInIndex: failure.expectedResult || 'relevant content',
      checkIndexContains: true,
    },
  };
}

/**
 * Generate a probe for a wrong_ranking hypothesis.
 */
function generateWrongRankingProbe(failure: RetrievalFailure): HypothesisProbe {
  return {
    type: 'comparison',
    parameters: {
      query: failure.query,
      expectedRank: 1,
      actualContexts: failure.retrievedContexts,
      expectedResult: failure.expectedResult,
    },
  };
}

/**
 * Generate a probe for a stale_data hypothesis.
 */
function generateStaleDataProbe(failure: RetrievalFailure): HypothesisProbe {
  return {
    type: 'assertion',
    parameters: {
      query: failure.query,
      freshnessThreshold: 24 * 60 * 60 * 1000, // 24 hours in ms
      checkLastIndexed: true,
      expectedResult: failure.expectedResult,
    },
  };
}

/**
 * Generate a probe for an embedding_mismatch hypothesis.
 */
function generateEmbeddingMismatchProbe(failure: RetrievalFailure): HypothesisProbe {
  // Generate synonym/alternative queries
  const synonymQueries = [
    failure.query,
    failure.query.toLowerCase(),
    failure.query.replace(/[_-]/g, ' '),
  ];

  if (failure.expectedResult) {
    synonymQueries.push(failure.expectedResult);
  }

  return {
    type: 'query',
    parameters: {
      originalQuery: failure.query,
      synonymQueries: [...new Set(synonymQueries)],
      checkSemanticSimilarity: true,
      similarityThreshold: 0.7,
    },
  };
}

/**
 * Generate a probe for a query_ambiguity hypothesis.
 */
function generateQueryAmbiguityProbe(failure: RetrievalFailure): HypothesisProbe {
  return {
    type: 'assertion',
    parameters: {
      query: failure.query,
      minQueryLength: 10,
      maxResultCount: 5,
      checkSpecificity: true,
      currentResultCount: failure.retrievedContexts.length,
    },
  };
}

// ============================================================================
// HYPOTHESIS GENERATOR IMPLEMENTATION
// ============================================================================

/**
 * Implementation of the HypothesisGenerator interface.
 */
class HypothesisGeneratorImpl implements HypothesisGenerator {
  private readonly config: Required<HypothesisGeneratorConfig>;
  private activeHypotheses: Map<string, Hypothesis> = new Map();
  private testHistory: TestHistoryEntry[] = [];

  constructor(config: HypothesisGeneratorConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Generate hypotheses from a retrieval failure.
   */
  async generateFromFailure(failure: RetrievalFailure): Promise<Hypothesis[]> {
    const characteristics = analyzeFailureCharacteristics(failure);
    const hypotheses: Hypothesis[] = [];
    const now = new Date();

    // Generate missing_context hypothesis
    const missingContextPriority = calculatePriority('missing_context', characteristics);
    if (missingContextPriority >= this.config.minPriority) {
      hypotheses.push({
        id: generateHypothesisId(),
        type: 'missing_context',
        description: `The required context for query "${truncate(failure.query, 50)}" may not be present in the index. The expected information might not have been indexed or was excluded during indexing.`,
        testable: true,
        probe: generateMissingContextProbe(failure),
        priority: missingContextPriority,
        createdAt: now,
      });
    }

    // Generate wrong_ranking hypothesis (only if we have retrieved contexts)
    if (failure.retrievedContexts.length > 0) {
      const wrongRankingPriority = calculatePriority('wrong_ranking', characteristics);
      if (wrongRankingPriority >= this.config.minPriority) {
        hypotheses.push({
          id: generateHypothesisId(),
          type: 'wrong_ranking',
          description: `The correct information may exist but is ranked too low in the results for query "${truncate(failure.query, 50)}". The ranking algorithm may not be weighting relevance correctly.`,
          testable: true,
          probe: generateWrongRankingProbe(failure),
          priority: wrongRankingPriority,
          createdAt: now,
        });
      }
    }

    // Generate stale_data hypothesis
    const staleDataPriority = calculatePriority('stale_data', characteristics);
    if (staleDataPriority >= this.config.minPriority) {
      hypotheses.push({
        id: generateHypothesisId(),
        type: 'stale_data',
        description: `The indexed data may be outdated for query "${truncate(failure.query, 50)}". The source files may have been modified since the last indexing.`,
        testable: true,
        probe: generateStaleDataProbe(failure),
        priority: staleDataPriority,
        createdAt: now,
      });
    }

    // Generate embedding_mismatch hypothesis
    const embeddingMismatchPriority = calculatePriority('embedding_mismatch', characteristics);
    if (embeddingMismatchPriority >= this.config.minPriority) {
      hypotheses.push({
        id: generateHypothesisId(),
        type: 'embedding_mismatch',
        description: `The semantic embedding may not capture the intent of query "${truncate(failure.query, 50)}". The embedding model may not recognize domain-specific terminology or syntax.`,
        testable: true,
        probe: generateEmbeddingMismatchProbe(failure),
        priority: embeddingMismatchPriority,
        createdAt: now,
      });
    }

    // Generate query_ambiguity hypothesis
    const queryAmbiguityPriority = calculatePriority('query_ambiguity', characteristics);
    if (queryAmbiguityPriority >= this.config.minPriority) {
      hypotheses.push({
        id: generateHypothesisId(),
        type: 'query_ambiguity',
        description: `The query "${truncate(failure.query, 50)}" may be too vague or ambiguous, leading to irrelevant or scattered results. More specific terms may be needed.`,
        testable: true,
        probe: generateQueryAmbiguityProbe(failure),
        priority: queryAmbiguityPriority,
        createdAt: now,
      });
    }

    // Sort by priority and limit
    const sortedHypotheses = this.rankHypotheses(hypotheses).slice(
      0,
      this.config.maxHypothesesPerFailure
    );

    // Add to active hypotheses
    for (const h of sortedHypotheses) {
      this.activeHypotheses.set(h.id, h);
    }

    return sortedHypotheses;
  }

  /**
   * Rank hypotheses by priority (descending).
   */
  rankHypotheses(hypotheses: Hypothesis[]): Hypothesis[] {
    return [...hypotheses].sort((a, b) => b.priority - a.priority);
  }

  /**
   * Get all active (untested) hypotheses.
   */
  getActiveHypotheses(): Hypothesis[] {
    const active = Array.from(this.activeHypotheses.values());
    return this.rankHypotheses(active);
  }

  /**
   * Mark a hypothesis as tested.
   */
  markTested(hypothesisId: string, result: HypothesisTestResult): void {
    const hypothesis = this.activeHypotheses.get(hypothesisId);

    if (hypothesis) {
      // Add to test history
      this.testHistory.push({
        hypothesisId,
        hypothesis,
        result,
        testedAt: new Date(),
      });

      // Remove from active
      this.activeHypotheses.delete(hypothesisId);
    }
  }

  /**
   * Get the test history.
   */
  getTestHistory(): TestHistoryEntry[] {
    return [...this.testHistory];
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Truncate a string to a maximum length.
 */
function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) {
    return str;
  }
  return str.slice(0, maxLength - 3) + '...';
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a HypothesisGenerator with the specified configuration.
 *
 * @param config - Configuration options
 * @returns A new HypothesisGenerator instance
 */
export function createHypothesisGenerator(
  config?: HypothesisGeneratorConfig
): HypothesisGenerator {
  return new HypothesisGeneratorImpl(config);
}
