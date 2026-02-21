/**
 * @fileoverview Feedback API for LiBrainian
 *
 * Provides endpoints for agents to submit feedback on query results.
 * This feedback improves pack confidence and identifies retrieval gaps.
 *
 * USAGE:
 * ```typescript
 * import { submitQueryFeedback } from './feedback.js';
 *
 * // After a task using librainian results:
 * await submitQueryFeedback(storage, {
 *   queryId: synthesisResult.queryId,
 *   packIds: result.citations.map(c => c.packId),
 *   outcome: 'success', // or 'failure' or 'partial'
 *   agentId: 'claude-code',
 *   missingContext: 'Documentation about error handling was missing',
 * });
 * ```
 */

import type { LiBrainianStorage } from '../storage/types.js';
import {
  processAgentFeedback,
  createTaskOutcomeFeedback,
  type AgentFeedback,
  type FeedbackProcessingResult,
} from '../integration/agent_feedback.js';

export interface QueryFeedbackInput {
  /** Query ID from the synthesis response */
  queryId: string;

  /** Pack IDs that were used in the response */
  packIds: string[];

  /** Task outcome */
  outcome: 'success' | 'failure' | 'partial';

  /** Agent providing the feedback */
  agentId?: string;

  /** Description of missing context that would have helped */
  missingContext?: string;
}

export interface DetailedFeedbackInput {
  /** Query ID from the synthesis response */
  queryId: string;

  /** Per-pack relevance ratings */
  ratings: Array<{
    packId: string;
    relevant: boolean;
    usefulness?: number;
    reason?: string;
  }>;

  /** Agent providing the feedback */
  agentId?: string;

  /** Description of missing context that would have helped */
  missingContext?: string;

  /** Task context */
  taskContext?: {
    taskType: string;
    intent: string;
    outcome: 'success' | 'failure' | 'partial';
  };
}

/**
 * Submit simple feedback based on task outcome.
 * Use this when you have a clear success/failure signal but don't need
 * per-pack relevance ratings.
 */
export async function submitQueryFeedback(
  storage: LiBrainianStorage,
  input: QueryFeedbackInput
): Promise<FeedbackProcessingResult> {
  const feedback = createTaskOutcomeFeedback(
    input.queryId,
    input.packIds,
    input.outcome,
    input.agentId
  );

  if (input.missingContext) {
    feedback.missingContext = input.missingContext;
  }

  return processAgentFeedback(feedback, storage);
}

/**
 * Submit detailed feedback with per-pack relevance ratings.
 * Use this when you can evaluate each pack's usefulness individually.
 */
export async function submitDetailedFeedback(
  storage: LiBrainianStorage,
  input: DetailedFeedbackInput
): Promise<FeedbackProcessingResult> {
  const feedback: AgentFeedback = {
    queryId: input.queryId,
    relevanceRatings: input.ratings.map(r => ({
      packId: r.packId,
      relevant: r.relevant,
      usefulness: r.usefulness,
      reason: r.reason,
    })),
    timestamp: new Date().toISOString(),
    agentId: input.agentId,
    missingContext: input.missingContext,
    taskContext: input.taskContext,
  };

  return processAgentFeedback(feedback, storage);
}

/**
 * Helper to extract pack IDs from a synthesis result for feedback.
 */
export function extractPackIdsFromCitations(
  citations: Array<{ packId: string }>
): string[] {
  return [...new Set(citations.map(c => c.packId))];
}
