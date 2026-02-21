/**
 * @fileoverview Hotspot Scoring for LiBrainian Prioritization
 *
 * Hotspots are code locations with high churn AND high complexity - these are
 * where bugs cluster and where refactoring has the highest ROI.
 *
 * Formula: HotspotScore = Churn × Complexity
 *
 * Based on research by:
 * - Michael Feathers (Working Effectively with Legacy Code)
 * - Adam Tornhill (Your Code as a Crime Scene)
 *
 * This module integrates with:
 * - `src/graphs/temporal_graph.ts` for churn data (commit frequency, cochange)
 * - `src/storage/types.ts` for complexity tracking (DebtMetrics)
 * - `src/strategic/prioritization.ts` for priority computation
 * - `src/query/multi_signal_scorer.ts` for query relevance scoring
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * Hotspot score for an entity (file, function, or module).
 * Used to identify code that needs attention due to high churn combined with
 * high complexity - a strong predictor of future bugs and maintenance burden.
 */
export interface HotspotScore {
  /** Entity identifier (file path, function ID, or module ID) */
  entityId: string;

  /** Entity type for context */
  entityType: 'file' | 'function' | 'module';

  /**
   * Normalized churn score (0-1).
   * Higher values indicate more frequent changes.
   */
  churnScore: number;

  /**
   * Normalized complexity score (0-1).
   * Higher values indicate more complex code.
   */
  complexityScore: number;

  /**
   * Combined hotspot score (0-1).
   * Computed as: churn^churnExponent × complexity^complexityExponent
   * Default exponents dampen outliers: churn^0.7 × complexity^0.5
   */
  hotspotScore: number;

  /**
   * Detailed churn metrics (optional, for transparency).
   */
  churnDetails?: ChurnDetails;

  /**
   * Detailed complexity metrics (optional, for transparency).
   */
  complexityDetails?: ComplexityDetails;

  /** When this score was computed */
  computedAt: string;
}

/**
 * Detailed churn information for transparency and debugging.
 */
export interface ChurnDetails {
  /** Total number of commits touching this entity */
  commitCount: number;

  /** Number of unique authors who modified this entity */
  authorCount: number;

  /** Number of changes in the last 30 days */
  recentChanges: number;

  /** Average cochange strength with other files (0-1) */
  cochangeStrength?: number;

  /** Last modification date */
  lastModified?: string;
}

/**
 * Detailed complexity information for transparency and debugging.
 */
export interface ComplexityDetails {
  /** Cyclomatic complexity (number of decision points) */
  cyclomatic?: number;

  /** Cognitive complexity (how hard to understand) */
  cognitive?: number;

  /** Lines of code */
  linesOfCode?: number;

  /** Nesting depth (max or average) */
  nestingDepth?: number;

  /** Number of parameters (for functions) */
  parameterCount?: number;
}

/**
 * Input data for computing a hotspot score.
 */
export interface HotspotInput {
  entityId: string;
  entityType: 'file' | 'function' | 'module';

  // Churn metrics (at least one required)
  commitCount?: number;
  authorCount?: number;
  recentChanges?: number;
  changeFrequency?: number; // Changes per month
  cochangeStrength?: number;
  lastModified?: string;

  // Complexity metrics (at least one required)
  cyclomaticComplexity?: number;
  cognitiveComplexity?: number;
  linesOfCode?: number;
  nestingDepth?: number;
  parameterCount?: number;
}

/**
 * Configuration for hotspot computation.
 */
export interface HotspotConfig {
  /**
   * Exponent for churn in the hotspot formula.
   * Values < 1 dampen outliers (files changed 100x aren't 100x worse).
   * Default: 0.7
   */
  churnExponent: number;

  /**
   * Exponent for complexity in the hotspot formula.
   * Values < 1 dampen outliers (complexity 1000 isn't 1000x worse).
   * Default: 0.5
   */
  complexityExponent: number;

  /**
   * Weight for recent changes vs historical churn.
   * Higher values prioritize recent activity.
   * Default: 0.3 (30% recent, 70% historical)
   */
  recencyWeight: number;

  /**
   * Maximum commit count for normalization.
   * Files with more commits get capped at 1.0.
   * Default: 100
   */
  maxCommitCount: number;

  /**
   * Maximum cyclomatic complexity for normalization.
   * Default: 50
   */
  maxCyclomaticComplexity: number;

  /**
   * Maximum lines of code for normalization.
   * Default: 1000
   */
  maxLinesOfCode: number;

  /**
   * Threshold above which an entity is considered a "hotspot".
   * Default: 0.5
   */
  hotspotThreshold: number;
}

/**
 * Default configuration for hotspot computation.
 * Based on research recommendations from Adam Tornhill's work.
 */
export const DEFAULT_HOTSPOT_CONFIG: HotspotConfig = {
  churnExponent: 0.7,
  complexityExponent: 0.5,
  recencyWeight: 0.3,
  maxCommitCount: 100,
  maxCyclomaticComplexity: 50,
  maxLinesOfCode: 1000,
  hotspotThreshold: 0.5,
};

// ============================================================================
// COMPUTATION
// ============================================================================

/**
 * Compute the hotspot score for a single entity.
 *
 * The hotspot formula is:
 *   HotspotScore = Churn^churnExponent × Complexity^complexityExponent
 *
 * This dampens outliers while still capturing the multiplicative effect
 * of high churn combined with high complexity.
 *
 * @param input - The entity's churn and complexity metrics
 * @param config - Configuration for the computation
 * @returns The computed hotspot score
 */
export function computeHotspotScore(
  input: HotspotInput,
  config: HotspotConfig = DEFAULT_HOTSPOT_CONFIG
): HotspotScore {
  const churnScore = computeChurnScore(input, config);
  const complexityScore = computeComplexityScore(input, config);

  // Apply the hotspot formula with configurable exponents
  const hotspotScore =
    Math.pow(churnScore, config.churnExponent) *
    Math.pow(complexityScore, config.complexityExponent);

  return {
    entityId: input.entityId,
    entityType: input.entityType,
    churnScore,
    complexityScore,
    hotspotScore,
    churnDetails: extractChurnDetails(input),
    complexityDetails: extractComplexityDetails(input),
    computedAt: new Date().toISOString(),
  };
}

/**
 * Compute the normalized churn score (0-1) from input metrics.
 * Combines commit count, author count, and recent changes.
 */
export function computeChurnScore(
  input: HotspotInput,
  config: HotspotConfig = DEFAULT_HOTSPOT_CONFIG
): number {
  const signals: number[] = [];

  // Commit count signal
  if (input.commitCount !== undefined) {
    const normalized = Math.min(1, input.commitCount / config.maxCommitCount);
    signals.push(normalized);
  }

  // Change frequency signal (changes per month)
  if (input.changeFrequency !== undefined) {
    // Assume 10 changes/month is high
    const normalized = Math.min(1, input.changeFrequency / 10);
    signals.push(normalized);
  }

  // Recent changes signal (weighted higher)
  if (input.recentChanges !== undefined) {
    // Assume 20 changes in 30 days is very high
    const normalized = Math.min(1, input.recentChanges / 20);
    // Apply recency weight
    signals.push(normalized * (1 + config.recencyWeight));
  }

  // Author count signal (many authors = coordination overhead)
  if (input.authorCount !== undefined) {
    // Assume 10+ authors is high
    const normalized = Math.min(1, input.authorCount / 10);
    signals.push(normalized * 0.5); // Lower weight
  }

  // Cochange strength signal
  if (input.cochangeStrength !== undefined) {
    // Already 0-1
    signals.push(input.cochangeStrength * 0.3); // Lower weight
  }

  if (signals.length === 0) {
    // No churn data - return neutral score
    return 0.5;
  }

  // Average the signals, but cap at 1.0
  const sum = signals.reduce((a, b) => a + b, 0);
  const avg = sum / signals.length;
  return Math.min(1, Math.max(0, avg));
}

/**
 * Compute the normalized complexity score (0-1) from input metrics.
 * Combines cyclomatic complexity, cognitive complexity, and LOC.
 */
export function computeComplexityScore(
  input: HotspotInput,
  config: HotspotConfig = DEFAULT_HOTSPOT_CONFIG
): number {
  const signals: number[] = [];

  // Cyclomatic complexity signal (primary)
  if (input.cyclomaticComplexity !== undefined) {
    const normalized = Math.min(1, input.cyclomaticComplexity / config.maxCyclomaticComplexity);
    signals.push(normalized * 1.2); // Highest weight
  }

  // Cognitive complexity signal
  if (input.cognitiveComplexity !== undefined) {
    // Assume cognitive complexity threshold similar to cyclomatic
    const normalized = Math.min(1, input.cognitiveComplexity / config.maxCyclomaticComplexity);
    signals.push(normalized * 1.1);
  }

  // Lines of code signal
  if (input.linesOfCode !== undefined) {
    const normalized = Math.min(1, input.linesOfCode / config.maxLinesOfCode);
    signals.push(normalized * 0.8); // Lower weight than complexity metrics
  }

  // Nesting depth signal
  if (input.nestingDepth !== undefined) {
    // Assume 5+ nesting is bad
    const normalized = Math.min(1, input.nestingDepth / 5);
    signals.push(normalized * 0.5);
  }

  // Parameter count signal (for functions)
  if (input.parameterCount !== undefined) {
    // Assume 7+ parameters is bad (cognitive limit)
    const normalized = Math.min(1, input.parameterCount / 7);
    signals.push(normalized * 0.3);
  }

  if (signals.length === 0) {
    // No complexity data - return neutral score
    return 0.5;
  }

  // Average the signals, but cap at 1.0
  const sum = signals.reduce((a, b) => a + b, 0);
  const avg = sum / signals.length;
  return Math.min(1, Math.max(0, avg));
}

/**
 * Extract churn details from input for transparency.
 */
function extractChurnDetails(input: HotspotInput): ChurnDetails | undefined {
  if (
    input.commitCount === undefined &&
    input.authorCount === undefined &&
    input.recentChanges === undefined
  ) {
    return undefined;
  }

  return {
    commitCount: input.commitCount ?? 0,
    authorCount: input.authorCount ?? 0,
    recentChanges: input.recentChanges ?? 0,
    cochangeStrength: input.cochangeStrength,
    lastModified: input.lastModified,
  };
}

/**
 * Extract complexity details from input for transparency.
 */
function extractComplexityDetails(input: HotspotInput): ComplexityDetails | undefined {
  if (
    input.cyclomaticComplexity === undefined &&
    input.cognitiveComplexity === undefined &&
    input.linesOfCode === undefined
  ) {
    return undefined;
  }

  return {
    cyclomatic: input.cyclomaticComplexity,
    cognitive: input.cognitiveComplexity,
    linesOfCode: input.linesOfCode,
    nestingDepth: input.nestingDepth,
    parameterCount: input.parameterCount,
  };
}

// ============================================================================
// BATCH COMPUTATION
// ============================================================================

/**
 * Compute hotspot scores for multiple entities and rank them.
 *
 * @param inputs - Array of entity inputs
 * @param config - Configuration for computation
 * @returns Hotspot scores sorted by score descending
 */
export function computeHotspotScores(
  inputs: HotspotInput[],
  config: HotspotConfig = DEFAULT_HOTSPOT_CONFIG
): HotspotScore[] {
  const scores = inputs.map(input => computeHotspotScore(input, config));

  // Sort by hotspot score descending
  return scores.sort((a, b) => b.hotspotScore - a.hotspotScore);
}

/**
 * Filter to only entities above the hotspot threshold.
 *
 * @param scores - Array of hotspot scores
 * @param threshold - Minimum score to be considered a hotspot (default from config)
 * @returns Only entities that are hotspots
 */
export function filterHotspots(
  scores: HotspotScore[],
  threshold: number = DEFAULT_HOTSPOT_CONFIG.hotspotThreshold
): HotspotScore[] {
  return scores.filter(s => s.hotspotScore >= threshold);
}

/**
 * Identify the top N hotspots.
 *
 * @param inputs - Array of entity inputs
 * @param topN - Number of top hotspots to return
 * @param config - Configuration for computation
 * @returns Top N hotspots by score
 */
export function getTopHotspots(
  inputs: HotspotInput[],
  topN: number = 10,
  config: HotspotConfig = DEFAULT_HOTSPOT_CONFIG
): HotspotScore[] {
  const scores = computeHotspotScores(inputs, config);
  return scores.slice(0, topN);
}

// ============================================================================
// INTEGRATION HELPERS
// ============================================================================

/**
 * Convert temporal graph data to hotspot input.
 * Bridges the temporal_graph.ts module to hotspot scoring.
 *
 * @param entityId - The entity identifier
 * @param entityType - The entity type
 * @param fileChangeCounts - Map of file -> commit count from temporal graph
 * @param cochangeEdges - Cochange edges for strength calculation
 * @returns HotspotInput for churn metrics
 */
export function fromTemporalGraph(
  entityId: string,
  entityType: 'file' | 'function' | 'module',
  fileChangeCounts: Record<string, number>,
  cochangeEdges?: Array<{ fileA: string; fileB: string; strength: number }>
): Partial<HotspotInput> {
  const commitCount = fileChangeCounts[entityId] ?? 0;

  // Calculate average cochange strength for this entity
  let cochangeStrength: number | undefined;
  if (cochangeEdges && cochangeEdges.length > 0) {
    const relevantEdges = cochangeEdges.filter(
      e => e.fileA === entityId || e.fileB === entityId
    );
    if (relevantEdges.length > 0) {
      const totalStrength = relevantEdges.reduce((sum, e) => sum + e.strength, 0);
      cochangeStrength = totalStrength / relevantEdges.length;
    }
  }

  return {
    entityId,
    entityType,
    commitCount,
    cochangeStrength,
  };
}

/**
 * Convert DebtMetrics to hotspot input.
 * Bridges the storage/types.ts DebtMetrics to hotspot scoring.
 *
 * @param entityId - The entity identifier
 * @param entityType - The entity type
 * @param debtMetrics - Partial debt metrics with complexity info
 * @returns HotspotInput for complexity metrics
 */
export function fromDebtMetrics(
  entityId: string,
  entityType: 'file' | 'function' | 'module',
  debtMetrics: {
    complexityDebt?: number;
    churnDebt?: number;
    totalDebt?: number;
  }
): Partial<HotspotInput> {
  // DebtMetrics uses 0-100 scale, normalize to complexity estimate
  const complexityDebt = debtMetrics.complexityDebt ?? 0;
  const cyclomaticEstimate = (complexityDebt / 100) * 50; // Scale to 0-50 range

  return {
    entityId,
    entityType,
    cyclomaticComplexity: cyclomaticEstimate,
    // churnDebt can inform change frequency
    changeFrequency: debtMetrics.churnDebt ? (debtMetrics.churnDebt / 100) * 10 : undefined,
  };
}

/**
 * Merge multiple partial inputs into a complete HotspotInput.
 *
 * @param base - Base input with entityId and entityType
 * @param partials - Additional partial inputs to merge
 * @returns Combined HotspotInput
 */
export function mergeHotspotInputs(
  base: { entityId: string; entityType: 'file' | 'function' | 'module' },
  ...partials: Partial<HotspotInput>[]
): HotspotInput {
  const result: HotspotInput = {
    entityId: base.entityId,
    entityType: base.entityType,
  };

  for (const partial of partials) {
    // Merge all defined fields, preferring later values
    if (partial.commitCount !== undefined) result.commitCount = partial.commitCount;
    if (partial.authorCount !== undefined) result.authorCount = partial.authorCount;
    if (partial.recentChanges !== undefined) result.recentChanges = partial.recentChanges;
    if (partial.changeFrequency !== undefined) result.changeFrequency = partial.changeFrequency;
    if (partial.cochangeStrength !== undefined) result.cochangeStrength = partial.cochangeStrength;
    if (partial.lastModified !== undefined) result.lastModified = partial.lastModified;
    if (partial.cyclomaticComplexity !== undefined) result.cyclomaticComplexity = partial.cyclomaticComplexity;
    if (partial.cognitiveComplexity !== undefined) result.cognitiveComplexity = partial.cognitiveComplexity;
    if (partial.linesOfCode !== undefined) result.linesOfCode = partial.linesOfCode;
    if (partial.nestingDepth !== undefined) result.nestingDepth = partial.nestingDepth;
    if (partial.parameterCount !== undefined) result.parameterCount = partial.parameterCount;
  }

  return result;
}

// ============================================================================
// PRIORITIZATION INTEGRATION
// ============================================================================

/**
 * Priority factor result for hotspot scoring.
 * Compatible with the prioritization engine's FactorResult interface.
 */
export interface HotspotFactorResult {
  score: number; // 0-100
  evidence: string[];
  dataQuality: 'measured' | 'estimated' | 'inferred' | 'default';
}

/**
 * Calculate hotspot factor for prioritization engine integration.
 * Returns a 0-100 score compatible with other priority factors.
 *
 * @param hotspot - The computed hotspot score
 * @returns Factor result for prioritization
 */
export function calculateHotspotFactor(hotspot: HotspotScore): HotspotFactorResult {
  const evidence: string[] = [];

  // Convert 0-1 hotspot score to 0-100 priority factor
  const score = hotspot.hotspotScore * 100;

  // Build evidence
  if (hotspot.churnDetails) {
    evidence.push(
      `Churn: ${hotspot.churnDetails.commitCount} commits, ` +
      `${hotspot.churnDetails.authorCount} authors`
    );
    if (hotspot.churnDetails.recentChanges > 0) {
      evidence.push(`Recent activity: ${hotspot.churnDetails.recentChanges} changes in 30 days`);
    }
  }

  if (hotspot.complexityDetails) {
    if (hotspot.complexityDetails.cyclomatic !== undefined) {
      evidence.push(`Cyclomatic complexity: ${hotspot.complexityDetails.cyclomatic}`);
    }
    if (hotspot.complexityDetails.linesOfCode !== undefined) {
      evidence.push(`Lines of code: ${hotspot.complexityDetails.linesOfCode}`);
    }
  }

  // Determine data quality
  const hasChurn = hotspot.churnDetails !== undefined;
  const hasComplexity = hotspot.complexityDetails !== undefined;
  let dataQuality: 'measured' | 'estimated' | 'inferred' | 'default';

  if (hasChurn && hasComplexity) {
    dataQuality = 'measured';
  } else if (hasChurn || hasComplexity) {
    dataQuality = 'estimated';
  } else {
    dataQuality = 'default';
    evidence.push('Using default scores - no metrics available');
  }

  // Add interpretation
  if (hotspot.hotspotScore >= 0.7) {
    evidence.push('HIGH PRIORITY: Critical hotspot - high churn AND high complexity');
  } else if (hotspot.hotspotScore >= 0.5) {
    evidence.push('MODERATE: Significant hotspot - consider refactoring');
  } else if (hotspot.hotspotScore >= 0.3) {
    evidence.push('LOW: Minor hotspot - monitor for changes');
  }

  return {
    score,
    evidence,
    dataQuality,
  };
}

// ============================================================================
// MULTI-SIGNAL SCORER INTEGRATION
// ============================================================================

/**
 * Hotspot signal value for multi-signal scorer integration.
 * Compatible with SignalValue interface.
 */
export interface HotspotSignalValue {
  signal: 'hotspot';
  score: number; // 0-1
  confidence: number; // 0-1
  metadata?: {
    churnScore: number;
    complexityScore: number;
    entityType: string;
    isHotspot: boolean;
  };
}

/**
 * Create a hotspot signal value for the multi-signal scorer.
 *
 * @param hotspot - The computed hotspot score
 * @param threshold - Threshold for "is hotspot" determination
 * @returns Signal value for multi-signal scoring
 */
export function toHotspotSignal(
  hotspot: HotspotScore,
  threshold: number = DEFAULT_HOTSPOT_CONFIG.hotspotThreshold
): HotspotSignalValue {
  // Confidence is based on data quality
  const hasChurn = hotspot.churnDetails !== undefined;
  const hasComplexity = hotspot.complexityDetails !== undefined;
  let confidence = 0.5;
  if (hasChurn && hasComplexity) {
    confidence = 0.9;
  } else if (hasChurn || hasComplexity) {
    confidence = 0.7;
  }

  return {
    signal: 'hotspot',
    score: hotspot.hotspotScore,
    confidence,
    metadata: {
      churnScore: hotspot.churnScore,
      complexityScore: hotspot.complexityScore,
      entityType: hotspot.entityType,
      isHotspot: hotspot.hotspotScore >= threshold,
    },
  };
}
