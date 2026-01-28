/**
 * @fileoverview Context Precision and Recall Evaluator (WU-EVAL-002)
 *
 * Measures retrieval quality using context precision and recall metrics
 * following the RAGAS approach for RAG system evaluation.
 *
 * - Precision: How much of retrieved context is relevant (fraction of retrieved chunks that are relevant)
 * - Recall: How much of needed context was retrieved (fraction of needed information that was retrieved)
 * - F1: Harmonic mean of precision and recall
 *
 * Reference: RAGAS paper - https://arxiv.org/abs/2309.15217
 *
 * @packageDocumentation
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Result of context quality evaluation
 */
export interface ContextQualityResult {
  /** How much of retrieved context is relevant (0-1) */
  precision: number;
  /** How much of needed context was retrieved (0-1) */
  recall: number;
  /** Harmonic mean of precision and recall (0-1) */
  f1: number;
  /** Number of retrieved chunks that are relevant */
  relevantChunks: number;
  /** Total number of retrieved chunks */
  retrievedChunks: number;
  /** Number of chunks needed (from ground truth or estimated from answer) */
  neededChunks: number;
}

/**
 * Configuration for the context quality evaluator
 */
export interface ContextQualityConfig {
  /** Threshold for considering a chunk relevant (0-1). Default: 0.3 */
  relevanceThreshold?: number;
}

/**
 * Input options for evaluate method
 */
export interface EvaluateOptions {
  /** The question being asked */
  question: string;
  /** The generated answer */
  answer: string;
  /** Retrieved context chunks */
  retrievedContexts: string[];
  /** Ground truth contexts for recall calculation (optional) */
  groundTruthContexts?: string[];
}

/**
 * Context quality evaluator interface
 */
export interface ContextQualityEvaluator {
  /**
   * Evaluate context quality for a retrieval
   */
  evaluate(options: EvaluateOptions): Promise<ContextQualityResult>;

  /**
   * Evaluate the relevance of a single chunk to the question and answer
   */
  evaluateChunkRelevance(chunk: string, question: string, answer: string): Promise<number>;

  /**
   * Get running average metrics across all evaluations
   */
  getAverageMetrics(): { avgPrecision: number; avgRecall: number; avgF1: number };
}

// ============================================================================
// DEFAULT CONFIGURATION
// ============================================================================

const DEFAULT_CONFIG: Required<ContextQualityConfig> = {
  relevanceThreshold: 0.3,
};

// ============================================================================
// CONTEXT QUALITY EVALUATOR CLASS
// ============================================================================

/**
 * Evaluates context precision and recall for RAG systems
 */
class ContextQualityEvaluatorImpl implements ContextQualityEvaluator {
  private readonly config: Required<ContextQualityConfig>;
  private readonly evaluationHistory: ContextQualityResult[] = [];

  constructor(config?: ContextQualityConfig) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
    };
  }

  /**
   * Evaluate context quality for a retrieval
   */
  async evaluate(options: EvaluateOptions): Promise<ContextQualityResult> {
    const { question, answer, retrievedContexts, groundTruthContexts } = options;

    // Handle empty contexts
    if (retrievedContexts.length === 0) {
      const result: ContextQualityResult = {
        precision: 0,
        recall: 0,
        f1: 0,
        relevantChunks: 0,
        retrievedChunks: 0,
        neededChunks: groundTruthContexts?.length || 0,
      };
      this.evaluationHistory.push(result);
      return result;
    }

    // Compute relevance for each retrieved chunk
    const relevanceScores = await Promise.all(
      retrievedContexts.map((chunk) => this.evaluateChunkRelevance(chunk, question, answer))
    );

    // Count relevant chunks based on threshold
    const relevantChunks = relevanceScores.filter(
      (score) => score >= this.config.relevanceThreshold
    ).length;

    // Compute precision: fraction of retrieved that are relevant
    const precision = relevantChunks / retrievedContexts.length;

    // Compute recall
    let recall: number;
    let neededChunks: number;

    if (groundTruthContexts && groundTruthContexts.length > 0) {
      // With ground truth: compute how many ground truth claims are covered
      const { recallScore, totalNeeded } = this.computeRecallWithGroundTruth(
        retrievedContexts,
        groundTruthContexts,
        question
      );
      recall = recallScore;
      neededChunks = totalNeeded;
    } else {
      // Without ground truth: estimate recall from answer coverage
      const { recallScore, estimatedNeeded } = this.estimateRecallFromAnswer(
        retrievedContexts,
        answer,
        question
      );
      recall = recallScore;
      neededChunks = estimatedNeeded;
    }

    // Compute F1 score
    const f1 = precision + recall > 0
      ? (2 * precision * recall) / (precision + recall)
      : 0;

    const result: ContextQualityResult = {
      precision,
      recall,
      f1,
      relevantChunks,
      retrievedChunks: retrievedContexts.length,
      neededChunks,
    };

    this.evaluationHistory.push(result);
    return result;
  }

  /**
   * Evaluate the relevance of a single chunk to the question and answer
   */
  async evaluateChunkRelevance(chunk: string, question: string, answer: string): Promise<number> {
    // Handle empty chunk
    if (!chunk || chunk.trim().length === 0) {
      return 0;
    }

    const chunkLower = chunk.toLowerCase();
    const questionLower = question.toLowerCase();
    const answerLower = answer.toLowerCase();

    // Extract keywords from question and answer
    const questionKeywords = this.extractKeywords(question);
    const answerKeywords = this.extractKeywords(answer);
    const chunkKeywords = this.extractKeywords(chunk);

    // 1. Question keyword overlap
    let questionMatches = 0;
    for (const keyword of questionKeywords) {
      if (chunkLower.includes(keyword.toLowerCase())) {
        questionMatches++;
      }
    }
    const questionScore = questionKeywords.length > 0
      ? questionMatches / questionKeywords.length
      : 0;

    // 2. Answer keyword overlap
    let answerMatches = 0;
    for (const keyword of answerKeywords) {
      if (chunkLower.includes(keyword.toLowerCase())) {
        answerMatches++;
      }
    }
    const answerScore = answerKeywords.length > 0
      ? answerMatches / answerKeywords.length
      : 0;

    // 3. Word overlap with question (stop words filtered)
    const questionWords = this.extractSignificantWords(question);
    let wordMatches = 0;
    const questionWordsArray = Array.from(questionWords);
    for (const word of questionWordsArray) {
      if (chunkLower.includes(word)) {
        wordMatches++;
      }
    }
    const wordScore = questionWords.size > 0
      ? wordMatches / questionWords.size
      : 0;

    // 4. Topic alignment
    const questionTopics = this.extractTopicTerms(questionLower);
    const chunkTopics = this.extractTopicTerms(chunkLower);
    let topicOverlap = 0;
    for (const qt of questionTopics) {
      for (const ct of chunkTopics) {
        if (qt === ct || qt.includes(ct) || ct.includes(qt)) {
          topicOverlap++;
          break;
        }
      }
    }
    const topicScore = questionTopics.length > 0
      ? Math.min(1, topicOverlap / questionTopics.length)
      : 0;

    // 5. Identifier matching (CamelCase, code identifiers)
    const identifiers = this.extractIdentifiers(question + ' ' + answer);
    let idMatches = 0;
    for (const id of identifiers) {
      if (chunk.includes(id) || chunkLower.includes(id.toLowerCase())) {
        idMatches++;
      }
    }
    const identifierScore = identifiers.length > 0
      ? idMatches / identifiers.length
      : 0;

    // 6. Chunk has code-related content that matches question context
    const codeRelevance = this.computeCodeRelevance(chunk, question, answer);

    // Combine scores using maximum of different strategies
    // This allows different types of relevance to be captured
    const combinedScore = Math.max(
      questionScore * 0.6 + answerScore * 0.4,
      wordScore * 0.5 + identifierScore * 0.5,
      topicScore * 0.4 + questionScore * 0.3 + answerScore * 0.3,
      identifierScore * 0.6 + codeRelevance * 0.4,
      codeRelevance * 0.5 + questionScore * 0.25 + answerScore * 0.25
    );

    return Math.min(1, Math.max(0, combinedScore));
  }

  /**
   * Get running average metrics across all evaluations
   */
  getAverageMetrics(): { avgPrecision: number; avgRecall: number; avgF1: number } {
    if (this.evaluationHistory.length === 0) {
      return { avgPrecision: 0, avgRecall: 0, avgF1: 0 };
    }

    const sumPrecision = this.evaluationHistory.reduce((sum, r) => sum + r.precision, 0);
    const sumRecall = this.evaluationHistory.reduce((sum, r) => sum + r.recall, 0);
    const sumF1 = this.evaluationHistory.reduce((sum, r) => sum + r.f1, 0);

    return {
      avgPrecision: sumPrecision / this.evaluationHistory.length,
      avgRecall: sumRecall / this.evaluationHistory.length,
      avgF1: sumF1 / this.evaluationHistory.length,
    };
  }

  // ============================================================================
  // PRIVATE HELPER METHODS
  // ============================================================================

  /**
   * Compute recall with ground truth contexts
   */
  private computeRecallWithGroundTruth(
    retrievedContexts: string[],
    groundTruthContexts: string[],
    question: string
  ): { recallScore: number; totalNeeded: number } {
    if (groundTruthContexts.length === 0) {
      return { recallScore: 1, totalNeeded: 0 };
    }

    const combinedRetrieved = retrievedContexts.join(' ').toLowerCase();
    const retrievedWords = new Set(
      combinedRetrieved.split(/\s+/).filter((w) => w.length > 2 && !this.isStopWord(w))
    );

    // For each ground truth context, check if it's covered by retrieved contexts
    let coveredCount = 0;

    for (const gtContext of groundTruthContexts) {
      const gtLower = gtContext.toLowerCase();
      const gtKeywords = this.extractKeywords(gtContext);
      const gtWords = gtLower.split(/\s+/).filter((w) => w.length > 2 && !this.isStopWord(w));

      // Check keyword coverage
      let keywordMatches = 0;
      for (const keyword of gtKeywords) {
        if (combinedRetrieved.includes(keyword.toLowerCase())) {
          keywordMatches++;
        }
      }
      const keywordCoverage = gtKeywords.length > 0 ? keywordMatches / gtKeywords.length : 0;

      // Check word overlap
      let wordMatches = 0;
      for (const word of gtWords) {
        if (retrievedWords.has(word)) {
          wordMatches++;
        }
      }
      const wordCoverage = gtWords.length > 0 ? wordMatches / gtWords.length : 0;

      // Check for identifier matches
      const gtIdentifiers = this.extractIdentifiers(gtContext);
      let idMatches = 0;
      for (const id of gtIdentifiers) {
        if (combinedRetrieved.includes(id.toLowerCase())) {
          idMatches++;
        }
      }
      const idCoverage = gtIdentifiers.length > 0 ? idMatches / gtIdentifiers.length : 0;

      // Use maximum coverage strategy
      const coverage = Math.max(
        keywordCoverage * 0.6 + wordCoverage * 0.4,
        wordCoverage * 0.5 + idCoverage * 0.5,
        keywordCoverage * 0.4 + idCoverage * 0.6
      );

      // Consider covered if coverage exceeds threshold
      if (coverage >= 0.4) {
        coveredCount++;
      }
    }

    return {
      recallScore: coveredCount / groundTruthContexts.length,
      totalNeeded: groundTruthContexts.length,
    };
  }

  /**
   * Estimate recall from answer when no ground truth is available
   */
  private estimateRecallFromAnswer(
    retrievedContexts: string[],
    answer: string,
    question: string
  ): { recallScore: number; estimatedNeeded: number } {
    if (!answer || answer.trim().length === 0) {
      return { recallScore: 0, estimatedNeeded: 1 };
    }

    // Extract claims from answer to estimate needed information
    const claims = this.extractClaims(answer);
    if (claims.length === 0) {
      return { recallScore: 0, estimatedNeeded: 1 };
    }

    const combinedContext = retrievedContexts.join(' ').toLowerCase();
    const contextWords = new Set(
      combinedContext.split(/\s+/).filter((w) => w.length > 2)
    );

    // Check how many claims are supported by retrieved context
    let supportedClaims = 0;

    for (const claim of claims) {
      const claimLower = claim.toLowerCase();
      const claimWords = claimLower.split(/\s+/).filter((w) => w.length > 2 && !this.isStopWord(w));

      // Check word overlap
      let matches = 0;
      for (const word of claimWords) {
        if (contextWords.has(word)) {
          matches++;
        }
      }
      const coverage = claimWords.length > 0 ? matches / claimWords.length : 0;

      // Check for key phrase matches
      const keyPhrases = this.extractKeyPhrases(claim);
      let phraseMatches = 0;
      for (const phrase of keyPhrases) {
        if (combinedContext.includes(phrase.toLowerCase())) {
          phraseMatches++;
        }
      }
      const phraseCoverage = keyPhrases.length > 0 ? phraseMatches / keyPhrases.length : 0;

      // Check identifier matches
      const identifiers = this.extractIdentifiers(claim);
      let idMatches = 0;
      for (const id of identifiers) {
        if (combinedContext.includes(id.toLowerCase())) {
          idMatches++;
        }
      }
      const idCoverage = identifiers.length > 0 ? idMatches / identifiers.length : 0;

      // Use maximum of different strategies
      const claimCoverage = Math.max(
        coverage * 0.5 + phraseCoverage * 0.5,
        coverage * 0.6 + idCoverage * 0.4,
        idCoverage * 0.7 + phraseCoverage * 0.3
      );

      if (claimCoverage >= 0.3) {
        supportedClaims++;
      }
    }

    return {
      recallScore: supportedClaims / claims.length,
      estimatedNeeded: claims.length,
    };
  }

  /**
   * Extract keywords from text (important nouns, verbs, identifiers)
   */
  private extractKeywords(text: string): string[] {
    const keywords: string[] = [];

    // Extract CamelCase identifiers
    const camelCaseMatches = text.match(/\b[A-Z][a-zA-Z0-9]*\b/g);
    if (camelCaseMatches) {
      keywords.push(...camelCaseMatches);
    }

    // Extract backtick-quoted terms
    const backtickMatches = text.match(/`([^`]+)`/g);
    if (backtickMatches) {
      keywords.push(...backtickMatches.map((m) => m.replace(/`/g, '')));
    }

    // Extract significant words (lowercase, not stop words, > 4 chars)
    const words = text.toLowerCase().split(/\s+/);
    for (const word of words) {
      const clean = word.replace(/[^a-z0-9]/g, '');
      if (clean.length > 4 && !this.isStopWord(clean)) {
        keywords.push(clean);
      }
    }

    return Array.from(new Set(keywords));
  }

  /**
   * Extract significant words (filtering stop words)
   */
  private extractSignificantWords(text: string): Set<string> {
    const words = new Set<string>();
    const textWords = text.toLowerCase().split(/\s+/);

    for (const word of textWords) {
      const clean = word.replace(/[^a-z0-9]/g, '');
      if (clean.length > 2 && !this.isStopWord(clean)) {
        words.add(clean);
      }
    }

    return words;
  }

  /**
   * Extract topic-relevant terms
   */
  private extractTopicTerms(text: string): string[] {
    const terms: string[] = [];
    const lower = text.toLowerCase();

    // Extract code-related terms
    const codeTerms = lower.match(
      /\b(function|method|class|service|handler|controller|module|api|auth|user|login|session|token|database|query|request|response|error|config|log|validation|authentication)\b/gi
    );
    if (codeTerms) {
      terms.push(...codeTerms.map((t) => t.toLowerCase()));
    }

    // Extract significant words
    const words = lower.split(/\s+/).filter((w) => w.length > 4 && !this.isStopWord(w));
    terms.push(...words);

    return Array.from(new Set(terms));
  }

  /**
   * Extract code identifiers (CamelCase, snake_case)
   */
  private extractIdentifiers(text: string): string[] {
    const identifiers: string[] = [];

    // CamelCase
    const camelCase = text.match(/\b[A-Z][a-zA-Z0-9]*\b/g);
    if (camelCase) {
      identifiers.push(...camelCase);
    }

    // Backtick-quoted
    const backtick = text.match(/`([^`]+)`/g);
    if (backtick) {
      identifiers.push(...backtick.map((m) => m.replace(/`/g, '')));
    }

    // snake_case
    const snakeCase = text.match(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g);
    if (snakeCase) {
      identifiers.push(...snakeCase);
    }

    return Array.from(new Set(identifiers));
  }

  /**
   * Extract claims from text (sentences or independent clauses)
   */
  private extractClaims(text: string): string[] {
    const claims: string[] = [];

    // Clean the text
    const cleanedText = text
      .replace(/```[\s\S]*?```/g, '') // Remove code blocks
      .replace(/`[^`]+`/g, (match) => match.replace(/`/g, '')) // Keep content of inline code
      .trim();

    if (cleanedText.length === 0) {
      return [];
    }

    // Split by sentence boundaries
    const sentences = cleanedText.split(/(?<=[.!?])\s+/);

    for (const sentence of sentences) {
      const trimmed = sentence.trim();
      if (trimmed.length >= 10) {
        claims.push(trimmed);
      }
    }

    return claims;
  }

  /**
   * Extract key phrases (2-3 word combinations)
   */
  private extractKeyPhrases(text: string): string[] {
    const phrases: string[] = [];
    const words = text.split(/\s+/);

    // 2-word phrases
    for (let i = 0; i < words.length - 1; i++) {
      const w1 = words[i].replace(/[^a-zA-Z0-9]/g, '');
      const w2 = words[i + 1].replace(/[^a-zA-Z0-9]/g, '');
      if (w1.length > 2 && w2.length > 2 && !this.isStopWord(w1) && !this.isStopWord(w2)) {
        phrases.push(`${w1} ${w2}`);
      }
    }

    return phrases;
  }

  /**
   * Compute code-specific relevance
   */
  private computeCodeRelevance(chunk: string, question: string, answer: string): number {
    // Check if chunk contains code patterns
    const hasCode = /[{};()=]|function\s|class\s|const\s|let\s|var\s|=>/i.test(chunk);
    if (!hasCode) {
      return 0;
    }

    // Extract function/class names from chunk
    const funcMatch = chunk.match(/(?:function|class|const|let|var)\s+(\w+)/gi);
    const methodMatch = chunk.match(/(\w+)\s*\([^)]*\)\s*[:{]/g);

    const chunkIdentifiers = new Set<string>();
    if (funcMatch) {
      for (const m of funcMatch) {
        const name = m.split(/\s+/)[1];
        if (name) chunkIdentifiers.add(name.toLowerCase());
      }
    }
    if (methodMatch) {
      for (const m of methodMatch) {
        const name = m.match(/^(\w+)/)?.[1];
        if (name) chunkIdentifiers.add(name.toLowerCase());
      }
    }

    // Check if any identifiers from question/answer appear in chunk
    const queryIdentifiers = this.extractIdentifiers(question + ' ' + answer);
    let matches = 0;
    for (const id of queryIdentifiers) {
      if (chunkIdentifiers.has(id.toLowerCase()) || chunk.toLowerCase().includes(id.toLowerCase())) {
        matches++;
      }
    }

    return queryIdentifiers.length > 0 ? Math.min(1, matches / queryIdentifiers.length) : 0;
  }

  /**
   * Check if a word is a stop word
   */
  private isStopWord(word: string): boolean {
    const stopWords = new Set([
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
      'of', 'with', 'by', 'from', 'as', 'is', 'are', 'was', 'were', 'be',
      'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
      'would', 'could', 'should', 'may', 'might', 'must', 'shall', 'can',
      'this', 'that', 'these', 'those', 'it', 'its', 'they', 'them', 'their',
      'what', 'which', 'who', 'whom', 'whose', 'where', 'when', 'why', 'how',
      'all', 'each', 'every', 'both', 'few', 'more', 'most', 'other', 'some',
      'such', 'no', 'not', 'only', 'same', 'so', 'than', 'too', 'very', 'just',
    ]);
    return stopWords.has(word.toLowerCase());
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a new ContextQualityEvaluator instance
 */
export function createContextQualityEvaluator(config?: ContextQualityConfig): ContextQualityEvaluator {
  return new ContextQualityEvaluatorImpl(config);
}
