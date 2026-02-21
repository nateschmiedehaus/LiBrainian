/**
 * @fileoverview Agent Feedback Loop Integration
 *
 * PHILOSOPHICAL ALIGNMENT (CONTROL_LOOP.md §Feedback Loop Integration):
 * The agent provides feedback to improve librarian accuracy.
 *
 * FEEDBACK FLOW:
 * 1. Agent receives query results with context packs
 * 2. Agent evaluates relevance during task execution
 * 3. Agent reports relevance ratings and missing context
 * 4. Librarian adjusts confidence and logs retrieval gaps
 *
 * This creates a closed loop where agent experience improves retrieval quality.
 */

import type { LibrarianStorage } from '../storage/types.js';
import { recordAgenticFeedbackEvent } from './agentic_metrics_store.js';

// ============================================================================
// TYPES (per CONTROL_LOOP.md)
// ============================================================================

/**
 * Agent feedback for a query result.
 */
export interface AgentFeedback {
  /** Query ID that generated the results */
  queryId: string;
  /** Relevance ratings for each pack */
  relevanceRatings: RelevanceRating[];
  /** Context that was missing but needed */
  missingContext?: string;
  /** When feedback was generated */
  timestamp: string;
  /** Agent that provided feedback */
  agentId?: string;
  /** Task context for this feedback */
  taskContext?: {
    taskType: string;
    intent: string;
    outcome: 'success' | 'failure' | 'partial';
  };
}

export interface RelevanceRating {
  /** Pack ID that was rated */
  packId: string;
  /** Was this pack relevant to the task? */
  relevant: boolean;
  /** How useful was it (0-1)? Only if relevant */
  usefulness?: number;
  /** Why was it relevant or not? */
  reason?: string;
}

/**
 * Retrieval gap - missing context that should have been retrieved.
 */
export interface RetrievalGap {
  /** Query that missed this context */
  queryId: string;
  /** Description of what was missing */
  description: string;
  /** Suggested entity types that should have matched */
  suggestedTypes?: string[];
  /** Keywords that should have matched */
  suggestedKeywords?: string[];
  /** When gap was logged */
  timestamp: string;
  /** Has this gap been addressed? */
  addressed: boolean;
  /** How was it addressed? */
  resolution?: string;
}

/**
 * Confidence adjustment record.
 */
export interface ConfidenceAdjustment {
  packId: string;
  previousConfidence: number;
  adjustment: number;
  newConfidence: number;
  reason: string;
  timestamp: string;
  feedbackSource: string;
}

// ============================================================================
// FEEDBACK PROCESSING
// ============================================================================

/**
 * Process agent feedback to improve librarian accuracy.
 *
 * Per CONTROL_LOOP.md:
 * - Decrease confidence for irrelevant results (-0.1)
 * - Increase confidence for relevant results (+0.05)
 * - Log missing context for future improvement
 */
export async function processAgentFeedback(
  feedback: AgentFeedback,
  storage: LibrarianStorage
): Promise<FeedbackProcessingResult> {
  const adjustments: ConfidenceAdjustment[] = [];
  const gaps: RetrievalGap[] = [];
  const now = new Date().toISOString();

  // Process relevance ratings
  for (const rating of feedback.relevanceRatings) {
    const pack = await storage.getContextPack(rating.packId);
    if (!pack) continue;

    const previousConfidence = pack.confidence ?? 0.5;
    let adjustment: number;

    if (!rating.relevant) {
      // Decrease confidence for irrelevant results
      adjustment = -0.1;
    } else {
      // Increase confidence for relevant results
      // Scale by usefulness if provided
      const usefulnessMultiplier = rating.usefulness ?? 1.0;
      adjustment = 0.05 * usefulnessMultiplier;
    }

    const newConfidence = Math.max(0.1, Math.min(0.95, previousConfidence + adjustment));

    // Record adjustment
    adjustments.push({
      packId: rating.packId,
      previousConfidence,
      adjustment,
      newConfidence,
      reason: rating.reason ?? (rating.relevant ? 'Agent rated as relevant' : 'Agent rated as not relevant'),
      timestamp: now,
      feedbackSource: feedback.agentId ?? 'unknown',
    });

    // Update pack confidence in storage
    await storage.upsertContextPack({
      ...pack,
      confidence: newConfidence,
    });

    // Record outcome for pack with success/failure indicator
    const outcome = rating.relevant ? 'success' : 'failure';
    await storage.recordContextPackAccess?.(rating.packId, outcome);
  }

  // Log missing context as retrieval gap
  if (feedback.missingContext) {
    const gap: RetrievalGap = {
      queryId: feedback.queryId,
      description: feedback.missingContext,
      timestamp: now,
      addressed: false,
    };
    gaps.push(gap);

    // Store gap for future analysis
    await logRetrievalGap(gap, storage);
  }

  // Persist compact feedback telemetry for agentic utility scoring.
  const totalRatings = feedback.relevanceRatings.length;
  const irrelevantRatings = feedback.relevanceRatings.filter((rating) => !rating.relevant).length;
  const usefulnessMean = totalRatings > 0
    ? feedback.relevanceRatings.reduce((sum, rating) => {
      const score = typeof rating.usefulness === 'number'
        ? rating.usefulness
        : rating.relevant
          ? 1
          : 0;
      return sum + score;
    }, 0) / totalRatings
    : 0;
  try {
    await recordAgenticFeedbackEvent(storage, {
      queryId: feedback.queryId,
      timestamp: now,
      usefulnessMean,
      totalRatings,
      irrelevantRatings,
      missingContext: Boolean(feedback.missingContext),
      agentId: feedback.agentId,
    });
  } catch {
    // Feedback telemetry is best-effort and must not block normal feedback processing.
  }

  return {
    feedbackId: `feedback-${Date.now()}`,
    processedAt: now,
    adjustmentsApplied: adjustments.length,
    gapsLogged: gaps.length,
    adjustments,
    gaps,
  };
}

export interface FeedbackProcessingResult {
  feedbackId: string;
  processedAt: string;
  adjustmentsApplied: number;
  gapsLogged: number;
  adjustments: ConfidenceAdjustment[];
  gaps: RetrievalGap[];
}

// ============================================================================
// RETRIEVAL GAP LOGGING
// ============================================================================

/**
 * Log a retrieval gap for future improvement.
 */
export async function logRetrievalGap(
  gap: RetrievalGap,
  storage: LibrarianStorage
): Promise<void> {
  // Store gap in state for analysis
  const existingGaps = await getRetrievalGaps(storage);
  existingGaps.push(gap);

  // Keep only recent gaps (last 100)
  const recentGaps = existingGaps.slice(-100);

  await storage.setState('retrievalGaps', JSON.stringify(recentGaps));
}

/**
 * Get logged retrieval gaps.
 */
export async function getRetrievalGaps(
  storage: LibrarianStorage
): Promise<RetrievalGap[]> {
  const gapsJson = await storage.getState('retrievalGaps');
  if (!gapsJson) return [];

  try {
    return JSON.parse(gapsJson) as RetrievalGap[];
  } catch {
    return [];
  }
}

/**
 * Mark a retrieval gap as addressed.
 */
export async function addressRetrievalGap(
  queryId: string,
  resolution: string,
  storage: LibrarianStorage
): Promise<boolean> {
  const gaps = await getRetrievalGaps(storage);
  const gapIndex = gaps.findIndex(g => g.queryId === queryId && !g.addressed);

  if (gapIndex === -1) return false;

  gaps[gapIndex] = {
    ...gaps[gapIndex],
    addressed: true,
    resolution,
  };

  await storage.setState('retrievalGaps', JSON.stringify(gaps));
  return true;
}

// ============================================================================
// FEEDBACK ANALYSIS
// ============================================================================

/**
 * Analyze feedback trends to identify systemic issues.
 */
export async function analyzeFeedbackTrends(
  storage: LibrarianStorage
): Promise<FeedbackAnalysis> {
  const gaps = await getRetrievalGaps(storage);

  // Count unaddressed gaps
  const unaddressedGaps = gaps.filter(g => !g.addressed);

  // Analyze gap patterns
  const patternCounts = new Map<string, number>();
  for (const gap of gaps) {
    // Simple keyword extraction for pattern detection
    const words = gap.description.toLowerCase().split(/\s+/);
    for (const word of words) {
      if (word.length > 4) {
        patternCounts.set(word, (patternCounts.get(word) ?? 0) + 1);
      }
    }
  }

  // Find common patterns (words appearing 3+ times)
  const commonPatterns = Array.from(patternCounts.entries())
    .filter(([, count]) => count >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([pattern, count]) => ({ pattern, count }));

  return {
    totalGaps: gaps.length,
    unaddressedGaps: unaddressedGaps.length,
    addressedGaps: gaps.length - unaddressedGaps.length,
    commonPatterns,
    recommendations: generateRecommendations(commonPatterns, unaddressedGaps.length),
  };
}

export interface FeedbackAnalysis {
  totalGaps: number;
  unaddressedGaps: number;
  addressedGaps: number;
  commonPatterns: Array<{ pattern: string; count: number }>;
  recommendations: string[];
}

function generateRecommendations(
  patterns: Array<{ pattern: string; count: number }>,
  unaddressedCount: number
): string[] {
  const recommendations: string[] = [];

  if (unaddressedCount > 10) {
    recommendations.push(
      `High number of unaddressed gaps (${unaddressedCount}). Consider reviewing indexing coverage.`
    );
  }

  if (patterns.length > 0) {
    const topPattern = patterns[0];
    recommendations.push(
      `Common gap pattern: "${topPattern.pattern}" (${topPattern.count} occurrences). Consider improving indexing for this domain.`
    );
  }

  if (recommendations.length === 0) {
    recommendations.push('No significant issues detected. Continue monitoring feedback.');
  }

  return recommendations;
}

// ============================================================================
// BATCH FEEDBACK
// ============================================================================

/**
 * Create feedback from task outcome for a batch of queries.
 */
export function createTaskOutcomeFeedback(
  queryId: string,
  packIds: string[],
  outcome: 'success' | 'failure' | 'partial',
  agentId?: string
): AgentFeedback {
  // Infer relevance from outcome
  const relevanceRatings: RelevanceRating[] = packIds.map(packId => ({
    packId,
    relevant: outcome !== 'failure',
    usefulness: outcome === 'success' ? 1.0 : outcome === 'partial' ? 0.5 : 0.0,
    reason: `Task outcome: ${outcome}`,
  }));

  return {
    queryId,
    relevanceRatings,
    timestamp: new Date().toISOString(),
    agentId,
    taskContext: {
      taskType: 'unknown',
      intent: 'Task execution',
      outcome,
    },
  };
}
