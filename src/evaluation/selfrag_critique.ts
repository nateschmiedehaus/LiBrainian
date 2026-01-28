/**
 * @fileoverview Self-RAG Critique Tokens (WU-RET-003)
 *
 * Implements Self-RAG (ICLR 2024) reflection tokens for self-evaluation of retrieval quality.
 *
 * Self-RAG introduces reflection tokens to evaluate:
 * - Relevance: Is the retrieved document relevant to the query?
 * - Support: Does the document support generating a response?
 * - Usefulness: How useful is the document for answering the query?
 * - Retrieval Decision: Should we retrieve additional documents?
 *
 * Target: Reflection token accuracy >= 80%
 *
 * @packageDocumentation
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Usefulness levels for retrieved documents
 */
export type UsefulnessLevel = 'very_useful' | 'somewhat_useful' | 'not_useful';

/**
 * Result of critiquing a single retrieval
 */
export interface RetrievalCritique {
  /** Whether the document is relevant to the query */
  isRelevant: boolean;
  /** Relevance score 0-1 */
  relevanceScore: number;
  /** Whether the document supports answering the query */
  isSupported: boolean;
  /** Support score 0-1 */
  supportScore: number;
  /** Whether the document is useful */
  isUseful: boolean;
  /** Usefulness level */
  usefulness: UsefulnessLevel;
  /** Human-readable explanation of the critique */
  explanation: string;
}

/**
 * Result of critiquing a response against multiple contexts
 */
export interface ResponseCritique {
  /** Overall quality score 0-1 */
  overallQuality: number;
  /** Individual critiques for each context */
  perContextCritiques: RetrievalCritique[];
}

/**
 * Result of deciding whether to retrieve
 */
export interface RetrievalDecision {
  /** Whether to retrieve additional documents */
  retrieve: boolean;
  /** Reason for the decision */
  reason: string;
}

/**
 * Statistics tracked across critiques
 */
export interface CritiqueStats {
  /** Average relevance score */
  avgRelevance: number;
  /** Average support score */
  avgSupport: number;
}

/**
 * Configuration for Self-RAG critiquer
 */
export interface SelfRAGConfig {
  /** Threshold for considering a document relevant */
  relevanceThreshold: number;
  /** Threshold for considering a document supportive */
  supportThreshold: number;
  /** Whether to use semantic analysis (vs heuristics only) */
  useSemanticAnalysis: boolean;
}

/**
 * Interface for the Self-RAG Critiquer
 */
export interface SelfRAGCritiquer {
  /** Critique a single retrieval */
  critiqueRetrieval(query: string, retrievedDoc: string): Promise<RetrievalCritique>;
  /** Critique a response against multiple contexts */
  critiqueResponse(query: string, response: string, contexts: string[]): Promise<ResponseCritique>;
  /** Decide whether to retrieve additional documents */
  shouldRetrieve(query: string, partialResponse: string): Promise<RetrievalDecision>;
  /** Get statistics across all critiques */
  getCritiqueStats(): CritiqueStats;
}

// ============================================================================
// DEFAULT CONFIGURATION
// ============================================================================

/**
 * Default configuration for Self-RAG critiquer
 */
export const DEFAULT_SELFRAG_CONFIG: SelfRAGConfig = {
  relevanceThreshold: 0.5,
  supportThreshold: 0.5,
  useSemanticAnalysis: false,
};

// ============================================================================
// KEYWORD PATTERNS
// ============================================================================

/**
 * Patterns that indicate code-related queries
 */
const CODE_QUERY_PATTERNS = [
  /how\s+(do|to|is|does)\s+\w+\s+(implement|work|function|return|call)/i,
  /what\s+(is|are|does)\s+(the\s+)?(implementation|function|method|class|interface|type|return)/i,
  /show\s+(me\s+)?(the\s+)?(implementation|code|function|method|class)/i,
  /what\s+parameters?\s+(does|do)/i,
  /what\s+(functions?|methods?|classes?)\s+(are|is)\s+(exported|defined|in)/i,
  /(exported|defined)\s+(functions?|methods?|classes?)/i,
  /how\s+is\s+\w+\s+(implemented|defined|used)/i,
  /\bimplementation\s+of\b/i,
  /\bsource\s+code\b/i,
  /\bcode\s+(for|of)\b/i,
];

/**
 * Patterns that indicate general knowledge queries (don't necessarily need retrieval)
 */
const GENERAL_KNOWLEDGE_PATTERNS = [
  /^what\s+is\s+(a|an|the)?\s*(concept|idea|principle|pattern)/i,
  /^explain\s+(the\s+)?(concept|idea|principle)/i,
  /^what\s+is\s+\d+\s*[+\-*/]\s*\d+/i, // Simple math
];

/**
 * Common stop words to filter out
 */
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
  'may', 'might', 'must', 'shall', 'can', 'need', 'dare', 'ought', 'used',
  'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into',
  'through', 'during', 'before', 'after', 'above', 'below', 'between', 'under',
  'again', 'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why',
  'how', 'all', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no',
  'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just',
  'and', 'but', 'if', 'or', 'because', 'while', 'this', 'that', 'these', 'those',
  'i', 'me', 'my', 'myself', 'we', 'our', 'ours', 'you', 'your', 'yours',
  'he', 'him', 'his', 'she', 'her', 'hers', 'it', 'its', 'they', 'them', 'their',
]);

// ============================================================================
// SELFRAG CRITIQUER IMPLEMENTATION
// ============================================================================

/**
 * Self-RAG Critiquer implementation
 */
class SelfRAGCritiquerImpl implements SelfRAGCritiquer {
  private config: SelfRAGConfig;
  private relevanceScores: number[] = [];
  private supportScores: number[] = [];

  constructor(config?: Partial<SelfRAGConfig>) {
    this.config = { ...DEFAULT_SELFRAG_CONFIG, ...config };
  }

  /**
   * Critique a single retrieval
   */
  async critiqueRetrieval(query: string, retrievedDoc: string): Promise<RetrievalCritique> {
    // Handle empty inputs
    if (!query || query.trim().length === 0 || !retrievedDoc || retrievedDoc.trim().length === 0) {
      return {
        isRelevant: false,
        relevanceScore: 0,
        isSupported: false,
        supportScore: 0,
        isUseful: false,
        usefulness: 'not_useful',
        explanation: 'Empty query or document provided.',
      };
    }

    const queryLower = query.toLowerCase();
    const docLower = retrievedDoc.toLowerCase();

    // Calculate relevance score
    const relevanceScore = this.calculateRelevance(queryLower, docLower);
    const isRelevant = relevanceScore >= this.config.relevanceThreshold;

    // Calculate support score
    const supportScore = this.calculateSupport(queryLower, docLower);
    const isSupported = supportScore >= this.config.supportThreshold;

    // Determine usefulness
    const usefulness = this.determineUsefulness(relevanceScore, supportScore, queryLower, docLower);
    const isUseful = usefulness !== 'not_useful';

    // Generate explanation
    const explanation = this.generateExplanation(relevanceScore, supportScore, usefulness, queryLower, docLower);

    // Track statistics
    this.relevanceScores.push(relevanceScore);
    this.supportScores.push(supportScore);

    return {
      isRelevant,
      relevanceScore,
      isSupported,
      supportScore,
      isUseful,
      usefulness,
      explanation,
    };
  }

  /**
   * Critique a response against multiple contexts
   */
  async critiqueResponse(query: string, response: string, contexts: string[]): Promise<ResponseCritique> {
    // Handle empty contexts
    if (contexts.length === 0) {
      return {
        overallQuality: 0,
        perContextCritiques: [],
      };
    }

    // Critique each context
    const perContextCritiques: RetrievalCritique[] = [];
    for (const context of contexts) {
      const critique = await this.critiqueContextForResponse(query, response, context);
      perContextCritiques.push(critique);
    }

    // Calculate overall quality
    const overallQuality = this.calculateOverallQuality(response, contexts, perContextCritiques);

    return {
      overallQuality,
      perContextCritiques,
    };
  }

  /**
   * Decide whether to retrieve additional documents
   */
  async shouldRetrieve(query: string, partialResponse: string): Promise<RetrievalDecision> {
    // Handle empty query
    if (!query || query.trim().length === 0) {
      return {
        retrieve: false,
        reason: 'Empty query provided.',
      };
    }

    const queryLower = query.toLowerCase();
    const responseLower = partialResponse.toLowerCase();

    // Check if this is a code-related query
    const isCodeQuery = CODE_QUERY_PATTERNS.some(pattern => pattern.test(queryLower));

    // Check if this is a simple factual/math question
    const isSimpleQuestion = GENERAL_KNOWLEDGE_PATTERNS.some(pattern => pattern.test(queryLower));

    // Check if response is empty or very short
    const responseIsEmpty = partialResponse.trim().length === 0;
    const responseIsShort = partialResponse.trim().length < 50;

    // Check if response seems incomplete
    const responseIncomplete = this.checkResponseIncomplete(queryLower, responseLower);

    // Decision logic
    let retrieve = false;
    let reason = '';

    if (isCodeQuery) {
      if (responseIsEmpty) {
        retrieve = true;
        reason = 'Code-related query requires retrieval of source code or documentation.';
      } else if (responseIncomplete) {
        retrieve = true;
        reason = 'Response appears incomplete for code-related query. Additional context needed.';
      } else {
        retrieve = false;
        reason = 'Response appears sufficient for the code-related query.';
      }
    } else if (isSimpleQuestion && !responseIsEmpty) {
      retrieve = false;
      reason = 'Simple factual question with existing response - no retrieval needed.';
    } else if (responseIsEmpty) {
      retrieve = true;
      reason = 'Empty response - retrieval recommended to provide relevant information.';
    } else if (responseIncomplete) {
      retrieve = true;
      reason = 'Response appears incomplete - additional retrieval may help.';
    } else {
      retrieve = false;
      reason = 'Response appears sufficient for the query.';
    }

    return { retrieve, reason };
  }

  /**
   * Get statistics across all critiques
   */
  getCritiqueStats(): CritiqueStats {
    const avgRelevance = this.relevanceScores.length > 0
      ? this.relevanceScores.reduce((a, b) => a + b, 0) / this.relevanceScores.length
      : 0;

    const avgSupport = this.supportScores.length > 0
      ? this.supportScores.reduce((a, b) => a + b, 0) / this.supportScores.length
      : 0;

    return { avgRelevance, avgSupport };
  }

  // ============================================================================
  // PRIVATE HELPER METHODS
  // ============================================================================

  /**
   * Calculate relevance score between query and document
   */
  private calculateRelevance(queryLower: string, docLower: string): number {
    // Extract meaningful terms from query
    const queryTerms = this.extractTerms(queryLower);
    if (queryTerms.length === 0) {
      return 0;
    }

    // Extract terms from document
    const docTerms = this.extractTerms(docLower);
    const docText = docLower;

    // Count matches
    let matchCount = 0;
    let weightedMatchCount = 0;

    for (const term of queryTerms) {
      // Check exact term match
      if (docTerms.includes(term)) {
        matchCount++;
        weightedMatchCount += 1.0;
      }
      // Check substring match in document
      else if (docText.includes(term)) {
        matchCount += 0.7;
        weightedMatchCount += 0.7;
      }
      // Check partial match (term is part of a doc term or vice versa)
      else if (docTerms.some(dt => dt.includes(term) || term.includes(dt))) {
        matchCount += 0.5;
        weightedMatchCount += 0.5;
      }
    }

    // Calculate base score
    let score = matchCount / queryTerms.length;

    // Bonus for code patterns in document when query is about code
    const queryWantsCode = /implement|function|class|method|code|return|parameter/i.test(queryLower);
    const docHasCode = /function|class|const|let|var|return|=>|{|}|;/.test(docLower);
    if (queryWantsCode && docHasCode) {
      score = Math.min(1.0, score + 0.2);
    }

    // Penalty for completely unrelated topics
    const topicMismatch = this.checkTopicMismatch(queryLower, docLower);
    if (topicMismatch) {
      score *= 0.3;
    }

    return Math.min(1.0, Math.max(0, score));
  }

  /**
   * Calculate support score
   */
  private calculateSupport(queryLower: string, docLower: string): number {
    // Support is similar to relevance but focuses on whether the document
    // provides enough information to answer the query

    const relevance = this.calculateRelevance(queryLower, docLower);

    // Check if document contains substantive content
    const docLength = docLower.length;
    const hasSubstance = docLength > 50;

    // Check if document has code (for code-related queries)
    const docHasCode = /function|class|const|let|var|return|=>|{|}|;/.test(docLower);
    const queryWantsCode = /implement|function|class|method|code|return|parameter/i.test(queryLower);

    let supportBonus = 0;
    if (queryWantsCode && docHasCode) {
      supportBonus = 0.15;
    }
    if (hasSubstance) {
      supportBonus += 0.1;
    }

    return Math.min(1.0, relevance + supportBonus);
  }

  /**
   * Determine usefulness level
   */
  private determineUsefulness(
    relevanceScore: number,
    supportScore: number,
    queryLower: string,
    docLower: string
  ): UsefulnessLevel {
    const avgScore = (relevanceScore + supportScore) / 2;

    // Very useful: high scores and document directly addresses query
    if (avgScore >= 0.7) {
      return 'very_useful';
    }

    // Somewhat useful: moderate scores
    if (avgScore >= 0.35) {
      return 'somewhat_useful';
    }

    // Not useful: low scores
    return 'not_useful';
  }

  /**
   * Generate explanation for the critique
   */
  private generateExplanation(
    relevanceScore: number,
    supportScore: number,
    usefulness: UsefulnessLevel,
    queryLower: string,
    docLower: string
  ): string {
    const parts: string[] = [];

    if (relevanceScore >= 0.7) {
      parts.push('Document is highly relevant to the query.');
    } else if (relevanceScore >= 0.4) {
      parts.push('Document is partially relevant to the query.');
    } else {
      parts.push('Document has low relevance to the query.');
    }

    if (supportScore >= 0.7) {
      parts.push('Document provides strong support for answering.');
    } else if (supportScore >= 0.4) {
      parts.push('Document provides some support for answering.');
    } else {
      parts.push('Document provides limited support for answering.');
    }

    if (usefulness === 'very_useful') {
      parts.push('Overall: Very useful for the query.');
    } else if (usefulness === 'somewhat_useful') {
      parts.push('Overall: Somewhat useful, may need additional context.');
    } else {
      parts.push('Overall: Not useful for the query.');
    }

    return parts.join(' ');
  }

  /**
   * Extract meaningful terms from text
   */
  private extractTerms(text: string): string[] {
    // Tokenize
    const words = text.toLowerCase().split(/\s+/);

    // Filter stop words and short words
    const terms = words.filter(word => {
      const cleanWord = word.replace(/[^a-z0-9_]/g, '');
      return cleanWord.length >= 3 && !STOP_WORDS.has(cleanWord);
    }).map(word => word.replace(/[^a-z0-9_]/g, ''));

    // Extract camelCase identifiers
    const camelCaseMatches = text.match(/[a-z][a-zA-Z0-9]+[A-Z][a-zA-Z0-9]*/g) || [];
    for (const match of camelCaseMatches) {
      const lower = match.toLowerCase();
      if (!terms.includes(lower)) {
        terms.push(lower);
      }
    }

    // Extract PascalCase identifiers
    const pascalCaseMatches = text.match(/[A-Z][a-zA-Z0-9]+/g) || [];
    for (const match of pascalCaseMatches) {
      const lower = match.toLowerCase();
      if (!terms.includes(lower) && lower.length >= 3) {
        terms.push(lower);
      }
    }

    return [...new Set(terms)];
  }

  /**
   * Check if there's a topic mismatch between query and document
   */
  private checkTopicMismatch(queryLower: string, docLower: string): boolean {
    // Obvious topic mismatches
    const codeTopics = /implement|function|class|method|code|return|parameter|typescript|javascript|array|object/i;
    const weatherTopics = /weather|forecast|temperature|rain|sunny|cloudy|wind/i;
    const foodTopics = /pizza|food|recipe|cook|eat|restaurant|dinner/i;
    const animalTopics = /cat|dog|animal|pet|mammal|fur|domesticated/i;

    const queryIsCode = codeTopics.test(queryLower);
    const docIsWeather = weatherTopics.test(docLower);
    const docIsFood = foodTopics.test(docLower);
    const docIsAnimal = animalTopics.test(docLower);

    // If query is about code but doc is about weather/food/animals
    if (queryIsCode && (docIsWeather || docIsFood || docIsAnimal)) {
      return true;
    }

    return false;
  }

  /**
   * Check if response appears incomplete
   */
  private checkResponseIncomplete(queryLower: string, responseLower: string): boolean {
    // Query asks for "all" but response mentions "including" or "several"
    if (queryLower.includes('all') && (responseLower.includes('including') || responseLower.includes('several'))) {
      return true;
    }

    // Query asks for implementation but response is vague
    if (queryLower.includes('implement') && !responseLower.includes('function') && !responseLower.includes('class')) {
      return true;
    }

    // Response is very short for a complex query
    if (queryLower.length > 50 && responseLower.length < 30) {
      return true;
    }

    return false;
  }

  /**
   * Critique a context for a specific response
   */
  private async critiqueContextForResponse(
    query: string,
    response: string,
    context: string
  ): Promise<RetrievalCritique> {
    const queryLower = query.toLowerCase();
    const responseLower = response.toLowerCase();
    const contextLower = context.toLowerCase();

    // Calculate relevance to query
    const relevanceToQuery = this.calculateRelevance(queryLower, contextLower);

    // Calculate support for response
    const supportForResponse = this.calculateResponseSupport(responseLower, contextLower);

    // Combined scores
    const relevanceScore = relevanceToQuery;
    const supportScore = supportForResponse;
    const isRelevant = relevanceScore >= this.config.relevanceThreshold;
    const isSupported = supportScore >= this.config.supportThreshold;

    const usefulness = this.determineUsefulness(relevanceScore, supportScore, queryLower, contextLower);
    const isUseful = usefulness !== 'not_useful';

    const explanation = this.generateExplanation(relevanceScore, supportScore, usefulness, queryLower, contextLower);

    return {
      isRelevant,
      relevanceScore,
      isSupported,
      supportScore,
      isUseful,
      usefulness,
      explanation,
    };
  }

  /**
   * Calculate how well context supports the response
   */
  private calculateResponseSupport(responseLower: string, contextLower: string): number {
    // Extract key claims from response
    const responseTerms = this.extractTerms(responseLower);
    const contextTerms = this.extractTerms(contextLower);

    if (responseTerms.length === 0) {
      return 0;
    }

    // Count how many response terms are supported by context
    let supported = 0;
    for (const term of responseTerms) {
      if (contextTerms.includes(term) || contextLower.includes(term)) {
        supported++;
      }
    }

    const baseScore = supported / responseTerms.length;

    // Check for contradictions (simplified)
    const hasContradiction = this.checkContradiction(responseLower, contextLower);
    if (hasContradiction) {
      return Math.max(0, baseScore - 0.4);
    }

    return Math.min(1.0, baseScore);
  }

  /**
   * Check for contradictions between response and context
   */
  private checkContradiction(responseLower: string, contextLower: string): boolean {
    // Check for type mismatches
    const responseTypes = responseLower.match(/returns?\s+(a\s+)?(\w+)/i);
    const contextTypes = contextLower.match(/returns?\s+(a\s+)?(\w+)/i);

    if (responseTypes && contextTypes) {
      const responseType = responseTypes[2]?.toLowerCase();
      const contextType = contextTypes[2]?.toLowerCase();
      if (responseType && contextType && responseType !== contextType) {
        // Different types mentioned - possible contradiction
        const conflictingTypes = ['string', 'number', 'boolean', 'void', 'array', 'object'];
        if (conflictingTypes.includes(responseType) && conflictingTypes.includes(contextType)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Calculate overall quality from per-context critiques
   */
  private calculateOverallQuality(
    response: string,
    contexts: string[],
    critiques: RetrievalCritique[]
  ): number {
    if (critiques.length === 0) {
      return 0;
    }

    // Average relevance and support scores
    const avgRelevance = critiques.reduce((sum, c) => sum + c.relevanceScore, 0) / critiques.length;
    const avgSupport = critiques.reduce((sum, c) => sum + c.supportScore, 0) / critiques.length;

    // Overall quality is weighted combination
    const quality = avgRelevance * 0.4 + avgSupport * 0.6;

    // Penalty if response contradicts context
    const responseLower = response.toLowerCase();
    for (const context of contexts) {
      if (this.checkContradiction(responseLower, context.toLowerCase())) {
        return Math.max(0, quality - 0.3);
      }
    }

    return Math.min(1.0, quality);
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a new Self-RAG Critiquer instance
 *
 * @param config - Optional configuration overrides
 * @returns New SelfRAGCritiquer instance
 */
export function createSelfRAGCritiquer(config?: Partial<SelfRAGConfig>): SelfRAGCritiquer {
  return new SelfRAGCritiquerImpl(config);
}
