/**
 * Token budget enforcement for LiBrainian responses.
 *
 * Agents have finite context windows. This module provides intelligent
 * truncation of responses to fit within specified token budgets while
 * preserving the most relevant results.
 *
 * Two levels of budgeting:
 * 1. Context-level (AgentKnowledgeContext) - used by assembleContext
 * 2. Response-level (LiBrainianResponse) - used by queryLiBrainian
 */
import { estimateTokenCount } from './governor_context.js';
import { resolveContextLevel, type ContextLevel } from './context_levels.js';
import type { AgentKnowledgeContext } from './context_assembly.js';
import type {
  ContextPack,
  TokenBudget,
  TokenBudgetResult as ResponseTokenBudgetResult,
  LiBrainianResponse,
  SynthesizedResponse,
} from '../types.js';

// ============================================================================
// CONTEXT-LEVEL BUDGETING (existing functionality)
// ============================================================================

export interface ContextTokenBudgetResult {
  context: AgentKnowledgeContext;
  usedTokens: number;
  truncated: boolean;
  truncationSteps: string[];
}

// Re-export with old name for backward compatibility
export type TokenBudgetResult = ContextTokenBudgetResult;

function estimateContextTokens(context: AgentKnowledgeContext): number {
  return estimateTokenCount(JSON.stringify(context));
}

function trimSnippets(context: AgentKnowledgeContext, maxSnippetsPerFile: number, maxSnippetChars: number): void {
  for (const file of context.required.targetFiles) {
    if (file.snippets.length > maxSnippetsPerFile) file.snippets = file.snippets.slice(0, maxSnippetsPerFile);
    for (const snippet of file.snippets) {
      if (snippet.content.length > maxSnippetChars) snippet.content = `${snippet.content.slice(0, maxSnippetChars)}...`;
    }
  }
}

export function enforceTokenBudget(
  input: AgentKnowledgeContext,
  level: ContextLevel,
  maxTokensOverride?: number
): ContextTokenBudgetResult {
  const definition = resolveContextLevel(level);
  const maxTokens = maxTokensOverride ?? definition.maxTokens;
  const context: AgentKnowledgeContext = {
    ...input,
    required: {
      ...input.required,
      targetFiles: input.required.targetFiles.map((file) => ({
        ...file,
        keyFacts: [...file.keyFacts],
        snippets: file.snippets.map((snippet) => ({ ...snippet })),
        packIds: [...file.packIds],
      })),
    },
    supplementary: {
      relatedFiles: [...input.supplementary.relatedFiles],
      recentChanges: [...input.supplementary.recentChanges],
      patterns: [...input.supplementary.patterns],
      antiPatterns: [...input.supplementary.antiPatterns],
      similarTasks: [...input.supplementary.similarTasks],
      knowledgeSources: [...input.supplementary.knowledgeSources],
    },
  };

  const truncationSteps: string[] = [];
  let usedTokens = estimateContextTokens(context);
  if (usedTokens <= maxTokens) {
    return { context, usedTokens, truncated: false, truncationSteps };
  }

  context.supplementary = { relatedFiles: [], recentChanges: [], patterns: [], antiPatterns: [], similarTasks: [], knowledgeSources: [] };
  truncationSteps.push('removed_supplementary');
  usedTokens = estimateContextTokens(context);
  if (usedTokens <= maxTokens) {
    return { context, usedTokens, truncated: true, truncationSteps };
  }

  context.required.targetFiles = context.required.targetFiles.slice(0, Math.max(1, Math.floor(definition.packLimit / 2)));
  truncationSteps.push('trimmed_required_files');
  usedTokens = estimateContextTokens(context);
  if (usedTokens <= maxTokens) {
    return { context, usedTokens, truncated: true, truncationSteps };
  }

  trimSnippets(context, 1, 360);
  truncationSteps.push('trimmed_snippets');
  usedTokens = estimateContextTokens(context);
  if (usedTokens <= maxTokens) {
    return { context, usedTokens, truncated: true, truncationSteps };
  }

  throw new Error(`unverified_by_trace(context_token_overflow): context exceeds ${maxTokens} tokens after truncation`);
}

// ============================================================================
// RESPONSE-LEVEL BUDGETING (new functionality)
// ============================================================================

/**
 * Rough token estimation using character count / 4.
 * This is a fast approximation; for more accuracy, use a proper tokenizer.
 * GPT-4 and Claude use roughly similar tokenization ratios.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  // Rough estimate: 1 token ~= 4 characters for English text
  // JSON has more punctuation, so use 3.5 for better accuracy
  return Math.ceil(text.length / 3.5);
}

/**
 * Estimate tokens for a single context pack.
 */
export function estimatePackTokens(pack: ContextPack): number {
  let tokens = 0;
  tokens += estimateTokens(pack.packId);
  tokens += estimateTokens(pack.packType);
  tokens += estimateTokens(pack.targetId);
  tokens += estimateTokens(pack.summary);
  tokens += pack.keyFacts.reduce((sum, fact) => sum + estimateTokens(fact), 0);
  tokens += pack.relatedFiles.reduce((sum, file) => sum + estimateTokens(file), 0);
  for (const snippet of pack.codeSnippets) {
    tokens += estimateTokens(snippet.content);
    tokens += estimateTokens(snippet.filePath);
    tokens += 10; // metadata overhead
  }
  tokens += 50; // Fixed overhead for other fields (confidence, dates, etc.)
  return tokens;
}

/**
 * Estimate tokens for the synthesis portion of a response.
 */
export function estimateSynthesisTokens(synthesis: SynthesizedResponse | undefined): number {
  if (!synthesis) return 0;
  let tokens = 0;
  tokens += estimateTokens(synthesis.answer);
  tokens += synthesis.keyInsights.reduce((sum, insight) => sum + estimateTokens(insight), 0);
  tokens += synthesis.uncertainties.reduce((sum, u) => sum + estimateTokens(u), 0);
  for (const citation of synthesis.citations) {
    tokens += estimateTokens(citation.content);
    tokens += 20; // metadata overhead
  }
  return tokens;
}

/**
 * Estimate tokens for the entire response (excluding packs).
 */
export function estimateResponseOverheadTokens(response: Partial<LiBrainianResponse>): number {
  let tokens = 0;
  // Query object
  if (response.query) {
    tokens += estimateTokens(response.query.intent);
    tokens += 50; // other query fields
  }
  // Disclosures
  if (response.disclosures) {
    tokens += response.disclosures.reduce((sum, d) => sum + estimateTokens(d), 0);
  }
  // Drill-down hints
  if (response.drillDownHints) {
    tokens += response.drillDownHints.reduce((sum, h) => sum + estimateTokens(h), 0);
  }
  // Method hints
  if (response.methodHints) {
    tokens += response.methodHints.reduce((sum, h) => sum + estimateTokens(h), 0);
  }
  // Coverage gaps
  if (response.coverageGaps) {
    tokens += response.coverageGaps.reduce((sum, g) => sum + estimateTokens(g), 0);
  }
  // Explanation
  if (response.explanation) {
    tokens += estimateTokens(response.explanation);
  }
  // Synthesis
  if (response.synthesis) {
    tokens += estimateSynthesisTokens(response.synthesis);
  }
  // Fixed overhead for metadata fields
  tokens += 100;
  return tokens;
}

/**
 * Input for response budget enforcement.
 */
export interface ResponseBudgetInput {
  packs: ContextPack[];
  synthesis?: SynthesizedResponse;
  budget: TokenBudget;
  /** Score map for relevance-based truncation (packId -> score) */
  scoreByPack?: Map<string, number>;
}

/**
 * Output of response budget enforcement.
 */
export interface ResponseBudgetOutput {
  packs: ContextPack[];
  synthesis?: SynthesizedResponse;
  result: ResponseTokenBudgetResult;
}

/**
 * Enforce token budget on a response by truncating packs by relevance.
 *
 * Truncation strategy:
 * 1. Calculate available budget (maxTokens - reserveTokens)
 * 2. Estimate overhead tokens (query, disclosures, synthesis, etc.)
 * 3. Sort packs by relevance score (highest first)
 * 4. Include packs until budget is exhausted
 * 5. If still over budget, trim synthesis or pack snippets
 */
export function enforceResponseTokenBudget(input: ResponseBudgetInput): ResponseBudgetOutput {
  const { packs, synthesis, budget, scoreByPack } = input;
  const reserveTokens = budget.reserveTokens ?? 0;
  const totalAvailable = Math.max(0, budget.maxTokens - reserveTokens);
  const originalPackCount = packs.length;

  // If no budget constraint, return as-is
  if (totalAvailable <= 0) {
    return {
      packs,
      synthesis,
      result: {
        truncated: false,
        tokensUsed: 0,
        totalAvailable: 0,
        truncationStrategy: 'none',
        originalPackCount,
        finalPackCount: packs.length,
      },
    };
  }

  // Estimate synthesis tokens (we try to preserve synthesis)
  const synthesisTokens = estimateSynthesisTokens(synthesis);

  // Reserve some budget for overhead
  const estimatedOverhead = 200; // Conservative estimate
  let availableForPacks = totalAvailable - synthesisTokens - estimatedOverhead;

  // If synthesis alone exceeds budget, we may need to trim it
  let finalSynthesis = synthesis;
  const trimmedFields: string[] = [];

  if (availableForPacks < 100 && synthesisTokens > 0) {
    // Synthesis is too large, try to truncate it
    if (synthesis && synthesis.answer.length > 500) {
      finalSynthesis = {
        ...synthesis,
        answer: synthesis.answer.slice(0, 500) + '... [truncated]',
        keyInsights: synthesis.keyInsights.slice(0, 2),
        uncertainties: synthesis.uncertainties.slice(0, 2),
        citations: synthesis.citations.slice(0, 3),
      };
      trimmedFields.push('synthesis');
      availableForPacks = totalAvailable - estimateSynthesisTokens(finalSynthesis) - estimatedOverhead;
    }
  }

  // Sort packs by relevance score (descending)
  const scoredPacks = packs.map(pack => ({
    pack,
    score: scoreByPack?.get(pack.packId) ?? pack.confidence,
    tokens: estimatePackTokens(pack),
  }));

  // Sort by score based on priority
  const priority = budget.priority ?? 'relevance';
  if (priority === 'relevance') {
    scoredPacks.sort((a, b) => b.score - a.score);
  } else if (priority === 'recency') {
    scoredPacks.sort((a, b) => {
      const aTime = a.pack.createdAt?.getTime() ?? 0;
      const bTime = b.pack.createdAt?.getTime() ?? 0;
      return bTime - aTime;
    });
  } else if (priority === 'diversity') {
    // Diversity: try to include one pack from each pack type
    const byType = new Map<string, typeof scoredPacks>();
    for (const sp of scoredPacks) {
      const list = byType.get(sp.pack.packType) ?? [];
      list.push(sp);
      byType.set(sp.pack.packType, list);
    }
    // Round-robin from each type
    const result: typeof scoredPacks = [];
    let added = true;
    while (added) {
      added = false;
      for (const [, list] of byType) {
        const next = list.shift();
        if (next) {
          result.push(next);
          added = true;
        }
      }
    }
    scoredPacks.length = 0;
    scoredPacks.push(...result);
  }

  // Include packs until budget exhausted
  let usedTokens = synthesisTokens + estimatedOverhead;
  const selectedPacks: ContextPack[] = [];
  let truncatedByRelevance = false;

  for (const { pack, tokens } of scoredPacks) {
    if (usedTokens + tokens <= totalAvailable) {
      selectedPacks.push(pack);
      usedTokens += tokens;
    } else if (selectedPacks.length === 0) {
      // Always include at least one pack, even if over budget
      // But trim its snippets to fit
      const trimmedPack = trimPackToFit(pack, Math.max(100, totalAvailable - usedTokens));
      selectedPacks.push(trimmedPack);
      usedTokens += estimatePackTokens(trimmedPack);
      trimmedFields.push('pack_snippets');
      truncatedByRelevance = true;
      break;
    } else {
      truncatedByRelevance = true;
      // Don't add more packs
    }
  }

  const truncated = truncatedByRelevance || trimmedFields.length > 0;
  const truncationStrategy: ResponseTokenBudgetResult['truncationStrategy'] =
    truncatedByRelevance ? 'relevance' : trimmedFields.length > 0 ? 'count' : 'none';

  return {
    packs: selectedPacks,
    synthesis: finalSynthesis,
    result: {
      truncated,
      tokensUsed: usedTokens,
      totalAvailable,
      truncationStrategy,
      originalPackCount,
      finalPackCount: selectedPacks.length,
      trimmedFields: trimmedFields.length > 0 ? trimmedFields : undefined,
    },
  };
}

/**
 * Trim a pack's snippets to fit within a token budget.
 */
function trimPackToFit(pack: ContextPack, maxTokens: number): ContextPack {
  // Start by estimating current size
  let currentTokens = estimatePackTokens(pack);

  if (currentTokens <= maxTokens) {
    return pack;
  }

  // Clone the pack
  const trimmed: ContextPack = {
    ...pack,
    codeSnippets: [...pack.codeSnippets],
    keyFacts: [...pack.keyFacts],
    relatedFiles: [...pack.relatedFiles],
  };

  // First, trim code snippets
  if (trimmed.codeSnippets.length > 0) {
    // Reduce snippet content length
    const maxSnippetChars = 200;
    trimmed.codeSnippets = trimmed.codeSnippets.slice(0, 1).map(snippet => ({
      ...snippet,
      content: snippet.content.length > maxSnippetChars
        ? snippet.content.slice(0, maxSnippetChars) + '...'
        : snippet.content,
    }));
    currentTokens = estimatePackTokens(trimmed);
  }

  // If still over, trim key facts
  if (currentTokens > maxTokens && trimmed.keyFacts.length > 3) {
    trimmed.keyFacts = trimmed.keyFacts.slice(0, 3);
    currentTokens = estimatePackTokens(trimmed);
  }

  // If still over, trim related files
  if (currentTokens > maxTokens && trimmed.relatedFiles.length > 2) {
    trimmed.relatedFiles = trimmed.relatedFiles.slice(0, 2);
    currentTokens = estimatePackTokens(trimmed);
  }

  // If still over, truncate summary
  if (currentTokens > maxTokens && trimmed.summary.length > 100) {
    trimmed.summary = trimmed.summary.slice(0, 100) + '...';
  }

  return trimmed;
}

/**
 * Check if a token budget is specified and valid.
 */
export function hasValidTokenBudget(budget: TokenBudget | undefined): budget is TokenBudget {
  return budget !== undefined && typeof budget.maxTokens === 'number' && budget.maxTokens > 0;
}

// ============================================================================
// TESTING EXPORTS
// ============================================================================

export const __testing = {
  estimateTokens,
  estimatePackTokens,
  estimateSynthesisTokens,
  estimateResponseOverheadTokens,
  trimPackToFit,
};
