/**
 * @fileoverview Unified Query Intent Classification and Routing
 *
 * This module provides enhanced query intent classification that routes queries
 * to appropriate retrieval strategies based on detected intent type:
 *
 * - 'structural': Graph-based queries (depends on, imports, calls) -> use graph traversal
 * - 'location': Find/locate queries (where is, find) -> use search/index
 * - 'explanation': Understanding queries (what does, how does, why) -> use summaries
 * - 'meta': Project-level queries (what is this project) -> use documentation
 *
 * The classification includes confidence scores and fallback strategies to ensure
 * robust query handling even when the primary strategy doesn't yield results.
 */

import type { EmbeddableEntityType } from '../storage/types.js';
import type { GraphEdgeType } from '../types.js';
import { parseStructuralQueryIntent, type StructuralQueryIntent } from './dependency_query.js';
import { classifyTestQuery, type TestQueryClassification } from './test_file_correlation.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Query intent types that determine retrieval strategy:
 * - 'structural': Graph-based queries (depends on, imports, calls) -> use graph traversal
 * - 'location': Find/locate queries (where is, find) -> use search/index
 * - 'explanation': Understanding queries (what does, how does, why) -> use summaries
 * - 'meta': Project-level queries (what is this project) -> use documentation
 * - 'test': Test file queries (tests for X) -> use test correlation
 */
export type QueryIntentType = 'structural' | 'location' | 'explanation' | 'meta' | 'test';

/**
 * Retrieval strategy that maps to intent type:
 * - 'graph': Use graph traversal for structural relationships
 * - 'search': Use semantic search for location queries
 * - 'summary': Use context packs and summaries for explanations
 * - 'docs': Use documentation for meta queries
 * - 'test_correlation': Use deterministic test file correlation
 * - 'hybrid': Use multiple strategies with blending
 */
export type RetrievalStrategy = 'graph' | 'search' | 'summary' | 'docs' | 'test_correlation' | 'hybrid';

/**
 * Unified query intent classification with confidence and routing information.
 */
export interface UnifiedQueryIntent {
  /** Primary intent type detected */
  intentType: QueryIntentType;

  /** Confidence in the intent classification (0-1) */
  intentConfidence: number;

  /** Primary retrieval strategy to use */
  primaryStrategy: RetrievalStrategy;

  /** Fallback strategies if primary yields insufficient results */
  fallbackStrategies: RetrievalStrategy[];

  /** Entity types to search based on intent */
  entityTypes: EmbeddableEntityType[];

  /** Document bias for ranking (0-1, higher = prefer documents) */
  documentBias: number;

  /** Graph edge types to prioritize for structural queries */
  graphEdgeTypes?: GraphEdgeType[];

  /** Structural query details (if intent is structural) */
  structuralIntent?: StructuralQueryIntent;

  /** Test query details (if intent is test-related) */
  testQueryIntent?: TestQueryClassification;

  /** Explanation of how the intent was classified */
  explanation: string;

  /** Whether exhaustive enumeration is needed (e.g., "all dependents") */
  requiresExhaustive: boolean;
}

// ============================================================================
// INTENT DETECTION PATTERNS
// ============================================================================

/**
 * Patterns for LOCATION queries - should use search/indexing.
 * Examples: "Where is X", "Find X", "Locate X"
 */
const LOCATION_QUERY_PATTERNS = [
  /\bwhere\s+(is|are|can\s+i\s+find)\b/i,
  /\blocate\b/i,
  // Note: "Find the X class/function/etc" - specific entity type lookup
  /\bfind\s+(the|a)\s+\w+\s+(class|function|module|method|interface|type)\b/i,
  /\bfind\s+(the|a)?\s*(file|function|class|module|method|interface|type)\s+\w+/i,
  /\bfind\s+(where|the\s+location)\b/i,
  /\bwhich\s+file\b/i,
  /\bin\s+which\s+(file|module|directory)\b/i,
  /\b(defined|declared|implemented)\s+(in|at|where)\b/i,
  /\bwhere\s+.*\b(defined|declared|implemented)\b/i,
  /\blocation\s+(of|for)\b/i,
  /\bpath\s+(to|of|for)\b/i,
  /\bsearch\s+for\b/i,
  /\blook\s+(for|up)\b/i,
  /\bshow\s+me\s+(the|where)\b/i,
];

/**
 * Patterns for EXPLANATION queries - should use summaries and context packs.
 * Examples: "What does X do", "How does X work", "Why does X"
 */
const EXPLANATION_QUERY_PATTERNS = [
  /\bwhat\s+(does|do|is)\s+\w+\s+(do|doing|for)\b/i,
  /\bwhat\s+does\b/i,
  /\bwhat\s+is\s+the\s+(purpose|role|function|responsibility)\b/i,
  /\bhow\s+(does|do|is)\s+\w+\s+(work|function|operate|handle|process)\b/i,
  /\bhow\s+does\b/i,
  /\bhow\s+is\b.*\b(implemented|done|handled)\b/i,
  /\bwhy\s+(does|do|is|was|are|were)\b/i,
  /\bwhy\s+.*\b(designed|implemented|work|exist)\b/i,
  /\bthe\s+reason\s+(for|why|behind)\b/i,
  /\bexplain\s+(how|what|why|the)\b/i,
  /\bdescribe\s+(how|what|the)\b/i,
  /\bunderstand\s+(how|what|the)\b/i,
  /\bpurpose\s+(of|for)\b/i,
  /\brole\s+(of|in)\b/i,
  /\bresponsibility\s+(of|for)\b/i,
  /\bbehavior\s+(of|when|for)\b/i,
  /\blogic\s+(of|in|behind|for)\b/i,
  /\balgorithm\s+(of|in|for|used)\b/i,
];

/**
 * Patterns for META queries - should use documentation.
 * Examples: "What is this project", "How do I use LiBrainian"
 */
const META_QUERY_PATTERNS = [
  /\bwhat\s+(is|are)\s+(this|the)\s+(project|codebase|repository|repo|system)\b/i,
  /\b(project|codebase|system|repo)\s+(overview|summary|description)\b/i,
  /\babout\s+(this|the)\s+(project|codebase|system)\b/i,
  /\bhow\s+(should|do|does|can|to)\s+(i|we|one|someone|you)\s+(use|integrate|configure|setup|start)\b/i,
  /\bhow\s+to\s+(use|integrate|configure|setup|get\s+started)\b/i,
  /\bgetting\s+started\b/i,
  /\bquick\s*start\b/i,
  /\bguide\s+(to|for|on)\b/i,
  /\btutorial\b/i,
  /\bdocumentation\b/i,
  /\bintroduction\s+(to|for|on)\b/i,
  /\bbest\s+practice(s)?\b/i,
  /\brecommended\s+(approach|way|pattern)\b/i,
  /\bconvention(s)?\b/i,
  /\boverview\s+(of|for|on)\b/i,
  /\barchitecture\s+(overview|summary|description)\b/i,
  /\bhigh[- ]?level\s+(view|overview|summary)\b/i,
  /\bagent\b.*\b(use|integration|interface)\b/i,
  /\blibrainian\b.*\b(use|query|api)\b/i,
];

/**
 * Patterns that indicate exhaustive enumeration is needed.
 *
 * NOTE: "refactor" alone should NOT trigger exhaustive mode.
 * Only refactor queries that imply impact analysis or enumeration need exhaustive mode.
 * - "refactoring opportunities" -> semantic query, NOT exhaustive
 * - "how to refactor this code" -> how-to query, NOT exhaustive
 * - "what would break if I refactor X" -> impact analysis, EXHAUSTIVE
 * - "list all files to refactor" -> enumeration, EXHAUSTIVE
 */
const EXHAUSTIVE_PATTERNS = [
  /\ball\b.*\b(depend|import|use|call)/i,
  /\bevery\b.*\b(depend|import|use|call)/i,
  /\bcomplete\s+list/i,
  /\bfull\s+list/i,
  /\bexhaustive/i,
  /\btransitive/i,
  // Refactor with impact analysis context (break, affect, impact, change)
  /\b(break|affect|impact|change).*\brefactor/i,
  /\brefactor.*\b(break|affect|impact|what\s+would)/i,
  // Refactor with enumeration context (all, list, every, files to)
  /\b(all|list|every)\b.*\brefactor/i,
  /\brefactor.*\b(all|list|every)\b/i,
  /\bbreaking\s+change.*\b(if|when|would)\b/i,  // "what would be breaking changes if..."
  /\bwhat\s+breaks\s+if/i,                       // "what breaks if I change X"
  /\bimpact\s+analysis/i,
  /\btotal\s+count/i,
  /\bhow\s+many\b.*\b(depend|import|use)/i,
];

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Count pattern matches in a query.
 */
function countPatternMatches(intent: string, patterns: RegExp[]): number {
  return patterns.filter(p => p.test(intent)).length;
}

/**
 * Determines the retrieval strategy for an intent type.
 */
function getRetrievalStrategy(intentType: QueryIntentType): RetrievalStrategy {
  switch (intentType) {
    case 'structural':
      return 'graph';
    case 'location':
      return 'search';
    case 'explanation':
      return 'summary';
    case 'meta':
      return 'docs';
    case 'test':
      return 'test_correlation';
    default:
      return 'hybrid';
  }
}

/**
 * Determines fallback strategies based on primary intent.
 */
function getFallbackStrategies(intentType: QueryIntentType): RetrievalStrategy[] {
  switch (intentType) {
    case 'structural':
      // If graph doesn't have enough results, fall back to search then summary
      return ['search', 'summary'];
    case 'location':
      // If search doesn't find it, try graph relationships
      return ['graph', 'summary'];
    case 'explanation':
      // If no good summaries, search for the entity then check docs
      return ['search', 'docs'];
    case 'meta':
      // If docs don't answer, try summaries then general search
      return ['summary', 'search'];
    case 'test':
      // If test correlation fails, try search
      return ['search', 'summary'];
    default:
      return ['search', 'summary', 'docs'];
  }
}

/**
 * Determines entity types to search based on intent.
 */
function getEntityTypesForIntent(intentType: QueryIntentType): EmbeddableEntityType[] {
  switch (intentType) {
    case 'structural':
      // Structural queries focus on code entities with relationships
      return ['function', 'module'];
    case 'location':
      // Location queries search all code entities
      return ['function', 'module'];
    case 'explanation':
      // Explanation queries prefer summaries, which come from function/module packs
      return ['function', 'module', 'document'];
    case 'meta':
      // Meta queries prefer documentation first, then code for context
      return ['document', 'function', 'module'];
    case 'test':
      // Test queries focus on test files which are modules
      return ['module', 'function'];
    default:
      return ['function', 'module', 'document'];
  }
}

/**
 * Calculates document bias based on intent type.
 */
function getDocumentBias(intentType: QueryIntentType, confidence: number): number {
  switch (intentType) {
    case 'structural':
      return 0.1; // Strong code preference
    case 'location':
      return 0.2; // Code preference
    case 'explanation':
      return 0.4; // Slight code preference with docs as supplement
    case 'meta':
      return 0.8 + (confidence * 0.15); // Strong docs preference
    case 'test':
      return 0.1; // Code preference (test files are code)
    default:
      return 0.3; // Neutral
  }
}

// ============================================================================
// MAIN CLASSIFICATION FUNCTION
// ============================================================================

/**
 * Classifies a query intent to determine optimal retrieval strategy.
 *
 * This is the primary entry point for unified query intent classification.
 * It combines multiple specialized classifiers (structural, test) with
 * pattern-based detection for a comprehensive intent analysis.
 *
 * The classification prioritizes in order:
 * 1. Structural queries (graph traversal) - most specific
 * 2. Test queries (test file correlation) - deterministic
 * 3. Location queries (search)
 * 4. Explanation queries (summaries)
 * 5. Meta queries (documentation)
 *
 * @param intent The query string to classify
 * @returns UnifiedQueryIntent with complete routing information
 */
export function classifyUnifiedQueryIntent(intent: string): UnifiedQueryIntent {
  const normalizedIntent = intent.toLowerCase().trim();

  // Check exhaustive mode first
  const requiresExhaustive = EXHAUSTIVE_PATTERNS.some(p => p.test(normalizedIntent));

  // 1. Check for structural queries first (most specific)
  const structuralIntent = parseStructuralQueryIntent(intent);
  if (structuralIntent.isStructural && structuralIntent.confidence >= 0.6) {
    return {
      intentType: 'structural',
      intentConfidence: structuralIntent.confidence,
      primaryStrategy: 'graph',
      fallbackStrategies: ['search', 'summary'],
      entityTypes: ['function', 'module'],
      documentBias: 0.1,
      graphEdgeTypes: structuralIntent.edgeTypes,
      structuralIntent,
      explanation: `Structural query detected: ${structuralIntent.direction} of "${structuralIntent.targetEntity}" via ${structuralIntent.edgeTypes.join('/')} edges.`,
      requiresExhaustive,
    };
  }

  // 2. Check for test queries (deterministic)
  const testIntent = classifyTestQuery(intent);
  if (testIntent.isTestQuery && testIntent.confidence >= 0.7) {
    return {
      intentType: 'test',
      intentConfidence: testIntent.confidence,
      primaryStrategy: 'test_correlation',
      fallbackStrategies: ['search', 'summary'],
      entityTypes: ['module', 'function'],
      documentBias: 0.1,
      testQueryIntent: testIntent,
      explanation: testIntent.explanation,
      requiresExhaustive: false,
    };
  }

  // 3. Pattern-based classification for location/explanation/meta
  const locationMatches = countPatternMatches(normalizedIntent, LOCATION_QUERY_PATTERNS);
  const explanationMatches = countPatternMatches(normalizedIntent, EXPLANATION_QUERY_PATTERNS);
  const metaMatches = countPatternMatches(normalizedIntent, META_QUERY_PATTERNS);

  // Find the best match
  const matchCounts = [
    { type: 'location' as QueryIntentType, count: locationMatches },
    { type: 'explanation' as QueryIntentType, count: explanationMatches },
    { type: 'meta' as QueryIntentType, count: metaMatches },
  ];

  // Sort by match count descending
  matchCounts.sort((a, b) => b.count - a.count);

  const bestMatch = matchCounts[0];
  const totalMatches = matchCounts.reduce((sum, m) => sum + m.count, 0);

  // Determine intent type and confidence
  let intentType: QueryIntentType;
  let intentConfidence: number;
  let explanation: string;

  if (bestMatch.count === 0) {
    // No clear match - default to explanation with low confidence
    intentType = 'explanation';
    intentConfidence = 0.3;
    explanation = 'No strong intent patterns detected. Defaulting to explanation query.';
  } else {
    intentType = bestMatch.type;
    // Confidence based on match count and relative strength
    intentConfidence = Math.min(0.95, 0.5 + (bestMatch.count * 0.1));

    // Adjust confidence based on pattern ambiguity
    if (matchCounts[1].count > 0 && matchCounts[1].count >= bestMatch.count * 0.7) {
      // Second best is close, lower confidence
      intentConfidence *= 0.85;
    }

    explanation = `${intentType.charAt(0).toUpperCase() + intentType.slice(1)} query detected with ${bestMatch.count} matching patterns.`;
  }

  const documentBias = Math.min(1.0, getDocumentBias(intentType, intentConfidence));

  return {
    intentType,
    intentConfidence,
    primaryStrategy: getRetrievalStrategy(intentType),
    fallbackStrategies: getFallbackStrategies(intentType),
    entityTypes: getEntityTypesForIntent(intentType),
    documentBias,
    explanation,
    requiresExhaustive,
  };
}

/**
 * Apply retrieval strategy adjustments based on query classification.
 * This modifies query parameters to optimize for the detected intent.
 */
export function applyRetrievalStrategyAdjustments(
  classification: UnifiedQueryIntent,
  options: {
    similarityThreshold?: number;
    limit?: number;
    graphDepth?: number;
  }
): {
  adjustedThreshold: number;
  adjustedLimit: number;
  adjustedGraphDepth: number;
  useGraphFirst: boolean;
  useDocsFirst: boolean;
  useTestCorrelation: boolean;
  explanation: string;
} {
  const { similarityThreshold = 0.35, limit = 14, graphDepth = 2 } = options;

  let adjustedThreshold = similarityThreshold;
  let adjustedLimit = limit;
  let adjustedGraphDepth = graphDepth;
  let useGraphFirst = false;
  let useDocsFirst = false;
  let useTestCorrelation = false;
  let explanation = '';

  switch (classification.primaryStrategy) {
    case 'graph':
      // For graph queries, increase graph depth and relax similarity
      adjustedThreshold = similarityThreshold * 0.8;
      adjustedGraphDepth = Math.max(graphDepth, 3);
      useGraphFirst = true;
      explanation = `Structural query (${classification.intentConfidence.toFixed(2)} conf). Graph depth: ${adjustedGraphDepth}.`;
      if (classification.graphEdgeTypes && classification.graphEdgeTypes.length > 0) {
        explanation += ` Edge types: ${classification.graphEdgeTypes.join(', ')}.`;
      }
      if (classification.requiresExhaustive) {
        explanation += ' EXHAUSTIVE mode enabled.';
        adjustedLimit = 1000; // Much higher limit for exhaustive
      }
      break;

    case 'search':
      // For location queries, use more results with tighter similarity
      adjustedLimit = Math.min(limit * 1.5, 30);
      explanation = `Location query (${classification.intentConfidence.toFixed(2)} conf). Expanded results: ${adjustedLimit}.`;
      break;

    case 'summary':
      // For explanation queries, prioritize high-confidence summaries
      adjustedThreshold = similarityThreshold * 1.1;
      explanation = `Explanation query (${classification.intentConfidence.toFixed(2)} conf). Prioritizing summaries.`;
      break;

    case 'docs':
      // For meta queries, prioritize documentation
      adjustedThreshold = similarityThreshold * 0.9;
      useDocsFirst = true;
      explanation = `Meta query (${classification.intentConfidence.toFixed(2)} conf). Prioritizing documentation.`;
      break;

    case 'test_correlation':
      // For test queries, use deterministic correlation
      useTestCorrelation = true;
      explanation = `Test query (${classification.intentConfidence.toFixed(2)} conf). Using test file correlation.`;
      break;

    default:
      explanation = `Hybrid query. Using balanced retrieval.`;
  }

  // Add fallback note if confidence is low
  if (classification.intentConfidence < 0.5) {
    explanation += ` Low confidence - fallbacks: ${classification.fallbackStrategies.join(', ')}.`;
  }

  return {
    adjustedThreshold,
    adjustedLimit,
    adjustedGraphDepth,
    useGraphFirst,
    useDocsFirst,
    useTestCorrelation,
    explanation,
  };
}

/**
 * Check if results are insufficient and a fallback strategy should be used.
 */
export function shouldUseFallback(
  classification: UnifiedQueryIntent,
  resultCount: number,
  minResults: number = 3
): boolean {
  if (resultCount >= minResults) {
    return false;
  }

  // For high confidence classifications with few results, try fallback
  if (classification.intentConfidence >= 0.6 && classification.fallbackStrategies.length > 0) {
    return true;
  }

  // For low confidence, always try fallback if results are sparse
  if (classification.intentConfidence < 0.5 && resultCount < 2) {
    return true;
  }

  return false;
}

/**
 * Get the next fallback strategy from the list.
 */
export function getNextFallbackStrategy(
  classification: UnifiedQueryIntent,
  usedStrategies: Set<RetrievalStrategy>
): RetrievalStrategy | null {
  for (const strategy of classification.fallbackStrategies) {
    if (!usedStrategies.has(strategy)) {
      return strategy;
    }
  }
  return null;
}
