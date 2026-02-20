/**
 * @fileoverview Agent Protocol for Librarian Integration
 *
 * Defines the protocol that agents must follow when using librarian knowledge.
 * Includes both knowledge usage protocol and modularization enforcement.
 */

import { buildModularizationPrompt } from './modularization_hooks.js';

// ============================================================================
// PROTOCOL CONSTANTS
// ============================================================================

export const AGENT_PROTOCOL_VERSION = 'v1.1';
export const AGENT_PROTOCOL_BEGIN = 'BEGIN_AGENT_PROTOCOL_JSON';
export const AGENT_PROTOCOL_END = 'END_AGENT_PROTOCOL_JSON';

// ============================================================================
// TYPES
// ============================================================================

export type Citation = { file: string; line: number; claim?: string };
export type Inference = { claim: string; basis?: string };
export type GapEncounter = { gap: string; impact?: string };
export type DirectRead = { file: string; reason?: string };
export type QueryRecord = { query: string; response?: string };

export interface AgentKnowledgeUsage {
  protocolVersion?: string;
  citedEvidence: Citation[];
  inferences: Inference[];
  gapsEncountered: GapEncounter[];
  directReads: DirectRead[];
  queriesMade: QueryRecord[];
  compliance: {
    evidenceCoverage: number;
    gapsAcknowledged: boolean;
    prohibitedActionsAttempted: string[];
  };
}

// ============================================================================
// KNOWLEDGE PROTOCOL PROMPT
// ============================================================================

const KNOWLEDGE_PROTOCOL = `## Librarian Knowledge Protocol (${AGENT_PROTOCOL_VERSION})

Rules:
- Query librarian before direct reads outside provided context.
- Cite evidence with file:line references.
- Acknowledge gaps; do not proceed past blocking gaps.
- Direct reads allowed only for:
  - Trivial files (<50 lines, complexity <5)
  - Unindexed files
  - Explicit override with justification
  - Config files (*.json/*.yaml/*.yml <1KB)
- When calling fs_read: include task_id (this task's id) and a reason (>10 chars).

Return JSON only between ${AGENT_PROTOCOL_BEGIN} and ${AGENT_PROTOCOL_END}.
Schema: {
  "protocolVersion": "${AGENT_PROTOCOL_VERSION}",
  "citedEvidence": [{"file": "path", "line": 1, "claim": "..."}],
  "inferences": [{"claim": "...", "basis": "..."}],
  "gapsEncountered": [{"gap": "...", "impact": "..."}],
  "directReads": [{"file": "...", "reason": "..."}],
  "queriesMade": [{"query": "...", "response": "..."}],
  "compliance": {"evidenceCoverage": 0, "gapsAcknowledged": true, "prohibitedActionsAttempted": []}
}`;

// ============================================================================
// PROMPT BUILDER
// ============================================================================

/**
 * Build the complete agent protocol prompt including:
 * 1. Knowledge usage protocol
 * 2. Modularization enforcement
 * 3. Task-specific context
 */
export const buildAgentProtocolPrompt = (taskId?: string): string => {
  const sections: string[] = [];

  // Knowledge protocol
  sections.push(KNOWLEDGE_PROTOCOL);

  // Modularization enforcement
  sections.push(buildModularizationPrompt());

  // Task ID if provided
  if (taskId) {
    sections.push(`Task ID: ${taskId}`);
  }

  return sections.join('\n\n');
};

/**
 * Build only the knowledge protocol prompt (without modularization).
 * Use this when modularization guidance is injected elsewhere.
 */
export const buildKnowledgeProtocolPrompt = (taskId?: string): string => {
  return taskId ? `${KNOWLEDGE_PROTOCOL}\nTask ID: ${taskId}` : KNOWLEDGE_PROTOCOL;
};

// ============================================================================
// FEEDBACK SUBMISSION
// ============================================================================

import type { LibrarianStorage } from '../storage/types.js';
import { processAgentFeedback, createTaskOutcomeFeedback, type AgentFeedback } from './agent_feedback.js';
import { getFeedbackContext } from '../api/query.js';
import { applyRetrievalStrategyFeedbackForQuery } from '../api/retrieval_strategy_bandit.js';

/**
 * Submit feedback for a query result.
 * Agents should call this after task completion to improve future results.
 *
 * @param feedbackToken - Token from query response
 * @param outcome - Task outcome (success/failure/partial)
 * @param storage - Librarian storage
 * @param options - Optional feedback details
 * @returns Processing result
 */
export async function submitQueryFeedback(
  feedbackToken: string,
  outcome: 'success' | 'failure' | 'partial',
  storage: LibrarianStorage,
  options?: {
    agentId?: string;
    missingContext?: string;
    customRatings?: Array<{
      packId: string;
      relevant: boolean;
      usefulness?: number;
      reason?: string;
    }>;
  }
): Promise<{ success: boolean; adjustmentsApplied: number; error?: string }> {
  try {
    // Retrieve the feedback context for this token
    const context = await getFeedbackContext(feedbackToken, storage);

    if (!context) {
      return {
        success: false,
        adjustmentsApplied: 0,
        error: `Unknown feedbackToken: ${feedbackToken}`,
      };
    }

    // Build feedback from outcome or custom ratings
    let feedback: AgentFeedback;

    if (options?.customRatings && options.customRatings.length > 0) {
      // Use custom ratings if provided
      feedback = {
        queryId: feedbackToken,
        relevanceRatings: options.customRatings,
        missingContext: options.missingContext,
        timestamp: new Date().toISOString(),
        agentId: options.agentId,
        taskContext: {
          taskType: 'agent_task',
          intent: context.queryIntent,
          outcome,
        },
      };
    } else {
      // Create feedback from task outcome
      feedback = createTaskOutcomeFeedback(
        feedbackToken,
        context.packIds,
        outcome,
        options?.agentId
      );

      if (options?.missingContext) {
        feedback.missingContext = options.missingContext;
      }
    }

    // Process the feedback
    const result = await processAgentFeedback(feedback, storage);
    const wasHelpful = outcome !== 'failure';
    await applyRetrievalStrategyFeedbackForQuery(
      storage,
      feedbackToken,
      wasHelpful,
      outcome
    ).catch(() => {
      // Retrieval strategy feedback is best-effort and must not fail user feedback.
    });

    return {
      success: true,
      adjustmentsApplied: result.adjustmentsApplied,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      adjustmentsApplied: 0,
      error: message,
    };
  }
}

/**
 * Report that query results were helpful.
 * Shorthand for submitQueryFeedback with success outcome.
 */
export async function reportHelpful(
  feedbackToken: string,
  storage: LibrarianStorage,
  agentId?: string
): Promise<{ success: boolean; adjustmentsApplied: number; error?: string }> {
  return submitQueryFeedback(feedbackToken, 'success', storage, { agentId });
}

/**
 * Report that query results were not helpful.
 * Shorthand for submitQueryFeedback with failure outcome.
 */
export async function reportNotHelpful(
  feedbackToken: string,
  storage: LibrarianStorage,
  options?: { agentId?: string; missingContext?: string }
): Promise<{ success: boolean; adjustmentsApplied: number; error?: string }> {
  return submitQueryFeedback(feedbackToken, 'failure', storage, options);
}
