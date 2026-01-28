/**
 * @fileoverview RAGAS Metrics Suite (WU-EVAL-001)
 *
 * Implements the standard RAGAS (Retrieval-Augmented Generation Assessment) evaluation framework:
 * - Faithfulness: Are claims grounded in context?
 * - Context Precision: Is retrieved context relevant?
 * - Context Recall: Did we retrieve all needed context?
 * - Answer Relevance: Does answer address the question?
 *
 * Reference: https://arxiv.org/abs/2309.15217
 *
 * @packageDocumentation
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Input for RAGAS evaluation
 */
export interface RAGASInput {
  /** The user's question */
  question: string;
  /** The generated answer */
  answer: string;
  /** Retrieved context documents */
  contexts: string[];
  /** Ground truth answer for recall calculation (optional) */
  groundTruth?: string;
}

/**
 * Analysis of a single claim's support status
 */
export interface ClaimAnalysis {
  /** The claim text */
  claim: string;
  /** Whether the claim is supported by context */
  isSupported: boolean;
  /** The context that supports the claim (if supported) */
  supportingContext?: string;
  /** Confidence in the support assessment (0-1) */
  confidence: number;
}

/**
 * Result of faithfulness computation
 */
export interface FaithfulnessResult {
  /** Faithfulness score (0-1) */
  score: number;
  /** Analysis of each claim */
  claims: ClaimAnalysis[];
  /** List of claims not supported by context */
  unsupportedClaims: string[];
}

/**
 * Relevance info for a single context
 */
export interface ContextRelevanceInfo {
  /** The context string */
  context: string;
  /** Relevance score (0-1) */
  relevance: number;
  /** Position rank (1-indexed) */
  rank: number;
}

/**
 * Result of context precision computation
 */
export interface ContextPrecisionResult {
  /** Context precision score (0-1) */
  score: number;
  /** Relevance assessment for each context */
  contextRelevance: ContextRelevanceInfo[];
  /** Average precision at each k position */
  averagePrecisionAtK: number[];
}

/**
 * Attribution info for a ground truth claim
 */
export interface AttributedClaim {
  /** The claim text */
  claim: string;
  /** Whether the claim is attributed to context */
  attributed: boolean;
  /** The context that attributes the claim (if attributed) */
  context?: string;
}

/**
 * Result of context recall computation
 */
export interface ContextRecallResult {
  /** Context recall score (0-1) */
  score: number;
  /** Claims extracted from ground truth */
  groundTruthClaims: string[];
  /** Attribution status for each claim */
  attributedClaims: AttributedClaim[];
}

/**
 * Result of answer relevance computation
 */
export interface AnswerRelevanceResult {
  /** Answer relevance score (0-1) */
  score: number;
  /** Questions generated from the answer */
  generatedQuestions: string[];
  /** Similarity between original question and each generated question */
  questionSimilarities: number[];
}

/**
 * Complete RAGAS evaluation output
 */
export interface RAGASOutput {
  /** Faithfulness metric result */
  faithfulness: FaithfulnessResult;
  /** Context precision metric result */
  contextPrecision: ContextPrecisionResult;
  /** Context recall metric result */
  contextRecall: ContextRecallResult;
  /** Answer relevance metric result */
  answerRelevance: AnswerRelevanceResult;
  /** Overall weighted score (0-1) */
  overallScore: number;
  /** Human-readable summary of evaluation */
  summary: string;
}

// ============================================================================
// RAGAS METRICS CLASS
// ============================================================================

/**
 * RAGAS Metrics Suite for RAG system evaluation
 */
export class RAGASMetrics {
  /**
   * Weights for computing overall score
   */
  private readonly weights = {
    faithfulness: 0.3,
    contextPrecision: 0.2,
    contextRecall: 0.2,
    answerRelevance: 0.3,
  };

  /**
   * Run full RAGAS evaluation
   */
  async evaluate(input: RAGASInput): Promise<RAGASOutput> {
    // Compute all metrics in parallel
    const [faithfulness, contextPrecision, contextRecall, answerRelevance] = await Promise.all([
      this.computeFaithfulness(input.answer, input.contexts),
      this.computeContextPrecision(input.question, input.contexts),
      this.computeContextRecall(input.groundTruth || '', input.contexts),
      this.computeAnswerRelevance(input.question, input.answer),
    ]);

    // Compute weighted overall score
    const overallScore = this.computeOverallScore(
      faithfulness.score,
      contextPrecision.score,
      contextRecall.score,
      answerRelevance.score,
      !!input.groundTruth
    );

    // Generate summary
    const summary = this.generateSummary(
      faithfulness,
      contextPrecision,
      contextRecall,
      answerRelevance,
      overallScore
    );

    return {
      faithfulness,
      contextPrecision,
      contextRecall,
      answerRelevance,
      overallScore,
      summary,
    };
  }

  /**
   * Compute faithfulness: proportion of claims in answer supported by context
   *
   * Faithfulness measures how factually accurate the answer is with respect
   * to the given context. A high score means all claims can be traced back
   * to the context.
   */
  async computeFaithfulness(answer: string, contexts: string[]): Promise<FaithfulnessResult> {
    // Handle edge cases
    if (!answer || answer.trim().length === 0) {
      return {
        score: 1, // No claims = vacuously true
        claims: [],
        unsupportedClaims: [],
      };
    }

    if (contexts.length === 0) {
      return {
        score: 0, // No context to ground claims
        claims: this.extractClaims(answer).map((claim) => ({
          claim,
          isSupported: false,
          confidence: 0,
        })),
        unsupportedClaims: this.extractClaims(answer),
      };
    }

    // Extract claims from answer
    const claims = this.extractClaims(answer);

    if (claims.length === 0) {
      return {
        score: 1,
        claims: [],
        unsupportedClaims: [],
      };
    }

    // Combine all contexts for matching
    const combinedContext = contexts.join(' ').toLowerCase();
    const contextWords = new Set(combinedContext.split(/\s+/).filter((w) => w.length > 2));

    // Analyze each claim
    const claimAnalyses: ClaimAnalysis[] = [];
    const unsupportedClaims: string[] = [];

    for (const claim of claims) {
      const analysis = this.analyzeClaim(claim, contexts, combinedContext, contextWords);
      claimAnalyses.push(analysis);

      if (!analysis.isSupported) {
        unsupportedClaims.push(claim);
      }
    }

    // Calculate faithfulness score
    const supportedCount = claimAnalyses.filter((c) => c.isSupported).length;
    const score = supportedCount / claims.length;

    return {
      score,
      claims: claimAnalyses,
      unsupportedClaims,
    };
  }

  /**
   * Compute context precision: how relevant are the retrieved contexts?
   *
   * Higher scores indicate that relevant contexts appear earlier in the list.
   * Uses a weighted precision formula where earlier positions have more weight.
   */
  async computeContextPrecision(question: string, contexts: string[]): Promise<ContextPrecisionResult> {
    if (contexts.length === 0) {
      return {
        score: 0,
        contextRelevance: [],
        averagePrecisionAtK: [],
      };
    }

    const questionLower = question.toLowerCase();
    const questionWords = new Set(
      questionLower.split(/\s+/).filter((w) => w.length > 2 && !this.isStopWord(w))
    );
    const questionKeywords = this.extractKeywords(question);

    // Assess relevance of each context
    const contextRelevance: ContextRelevanceInfo[] = contexts.map((context, index) => {
      const relevance = this.computeContextRelevance(context, questionWords, questionKeywords);
      return {
        context,
        relevance,
        rank: index + 1,
      };
    });

    // Compute average precision at each k
    // Use a lower threshold (0.3) to be more inclusive
    const relevanceThreshold = 0.3;
    const averagePrecisionAtK: number[] = [];
    let relevantCount = 0;
    let precisionSum = 0;

    for (let k = 0; k < contexts.length; k++) {
      if (contextRelevance[k].relevance > relevanceThreshold) {
        relevantCount++;
        precisionSum += relevantCount / (k + 1);
      }
      averagePrecisionAtK.push(relevantCount > 0 ? precisionSum / relevantCount : 0);
    }

    // Calculate overall precision score using mean average precision
    const totalRelevant = contextRelevance.filter((c) => c.relevance > relevanceThreshold).length;

    // If no contexts pass threshold, use the average relevance as score
    let score: number;
    if (totalRelevant > 0) {
      score = precisionSum / totalRelevant;
    } else {
      // Fallback: use mean of all relevance scores
      const avgRelevance = contextRelevance.reduce((sum, c) => sum + c.relevance, 0) / contexts.length;
      score = avgRelevance;
    }

    return {
      score,
      contextRelevance,
      averagePrecisionAtK,
    };
  }

  /**
   * Compute context recall: did we retrieve all needed context?
   *
   * Measures how much of the ground truth information can be attributed
   * to the retrieved contexts.
   */
  async computeContextRecall(groundTruth: string, contexts: string[]): Promise<ContextRecallResult> {
    if (!groundTruth || groundTruth.trim().length === 0) {
      return {
        score: 1, // No claims to attribute = perfect recall
        groundTruthClaims: [],
        attributedClaims: [],
      };
    }

    if (contexts.length === 0) {
      return {
        score: 0, // No context to attribute to
        groundTruthClaims: this.extractClaims(groundTruth),
        attributedClaims: this.extractClaims(groundTruth).map((claim) => ({
          claim,
          attributed: false,
        })),
      };
    }

    // Extract claims from ground truth
    const groundTruthClaims = this.extractClaims(groundTruth);

    if (groundTruthClaims.length === 0) {
      return {
        score: 1,
        groundTruthClaims: [],
        attributedClaims: [],
      };
    }

    const combinedContext = contexts.join(' ').toLowerCase();
    const contextWords = new Set(combinedContext.split(/\s+/).filter((w) => w.length > 2));

    // Check attribution for each claim
    const attributedClaims: AttributedClaim[] = groundTruthClaims.map((claim) => {
      const attribution = this.findAttribution(claim, contexts, combinedContext, contextWords);
      return {
        claim,
        attributed: attribution.attributed,
        context: attribution.context,
      };
    });

    // Calculate recall score
    const attributedCount = attributedClaims.filter((c) => c.attributed).length;
    const score = attributedCount / groundTruthClaims.length;

    return {
      score,
      groundTruthClaims,
      attributedClaims,
    };
  }

  /**
   * Compute answer relevance: does the answer address the question?
   *
   * Uses a reverse generation approach: generate questions that the answer
   * could answer, then compare similarity to the original question.
   * Also uses direct keyword overlap as a secondary signal.
   */
  async computeAnswerRelevance(question: string, answer: string): Promise<AnswerRelevanceResult> {
    if (!answer || answer.trim().length === 0) {
      return {
        score: 0,
        generatedQuestions: [],
        questionSimilarities: [],
      };
    }

    if (!question || question.trim().length === 0) {
      return {
        score: 0,
        generatedQuestions: [],
        questionSimilarities: [],
      };
    }

    // Generate questions that could be answered by the answer
    const generatedQuestions = this.generateQuestionsFromAnswer(answer);

    // Compute similarity between original question and each generated question
    const questionSimilarities = generatedQuestions.map((genQ) =>
      this.computeQuestionSimilarity(question, genQ)
    );

    // Also compute direct relevance between question and answer
    const directRelevance = this.computeDirectRelevance(question, answer);

    // Score is maximum of:
    // 1. Average of question similarities (if we have generated questions)
    // 2. Direct relevance score
    let score: number;
    if (questionSimilarities.length > 0) {
      const avgSimilarity = questionSimilarities.reduce((a, b) => a + b, 0) / questionSimilarities.length;
      const maxSimilarity = Math.max(...questionSimilarities);
      score = Math.max(
        avgSimilarity,
        maxSimilarity * 0.9,
        directRelevance
      );
    } else {
      score = directRelevance;
    }

    return {
      score,
      generatedQuestions,
      questionSimilarities,
    };
  }

  /**
   * Compute direct relevance between question and answer based on content overlap
   */
  private computeDirectRelevance(question: string, answer: string): number {
    const questionLower = question.toLowerCase();
    const answerLower = answer.toLowerCase();

    // Extract key terms from question
    const questionTerms = this.extractKeywords(question);
    const questionWords = new Set(
      questionLower.split(/\s+/).filter((w) => w.length > 3 && !this.isStopWord(w))
    );

    // Check how many question terms appear in answer
    let termMatches = 0;
    for (const term of questionTerms) {
      if (answerLower.includes(term.toLowerCase())) {
        termMatches++;
      }
    }
    const termScore = questionTerms.length > 0 ? termMatches / questionTerms.length : 0;

    // Check word overlap
    let wordMatches = 0;
    for (const word of questionWords) {
      if (answerLower.includes(word)) {
        wordMatches++;
      }
    }
    const wordScore = questionWords.size > 0 ? wordMatches / questionWords.size : 0;

    // Check topic alignment
    const questionTopics = this.extractTopicTerms(question);
    const answerTopics = this.extractTopicTerms(answer);
    let topicOverlap = 0;
    for (const qt of questionTopics) {
      for (const at of answerTopics) {
        if (qt === at || qt.includes(at) || at.includes(qt)) {
          topicOverlap++;
          break;
        }
      }
    }
    const topicScore = questionTopics.length > 0 ? topicOverlap / questionTopics.length : 0;

    // Return maximum of different relevance signals
    return Math.max(termScore, wordScore * 0.9, topicScore);
  }

  /**
   * Extract claims from text
   *
   * Breaks text into atomic claims that can be verified independently.
   */
  extractClaims(text: string): string[] {
    if (!text || text.trim().length === 0) {
      return [];
    }

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
      if (trimmed.length < 5) continue;

      // Split compound sentences by conjunctions
      const parts = trimmed.split(/\s*(?:,\s*and|,\s*or|\s+and\s+|\s+or\s+)\s*/i);

      for (const part of parts) {
        const cleanPart = part.trim();
        if (cleanPart.length >= 5 && this.isValidClaim(cleanPart)) {
          claims.push(cleanPart);
        }
      }
    }

    // Deduplicate claims
    return [...new Set(claims)];
  }

  // ============================================================================
  // PRIVATE HELPER METHODS
  // ============================================================================

  /**
   * Compute overall weighted score
   */
  private computeOverallScore(
    faithfulness: number,
    contextPrecision: number,
    contextRecall: number,
    answerRelevance: number,
    hasGroundTruth: boolean
  ): number {
    if (hasGroundTruth) {
      return (
        faithfulness * this.weights.faithfulness +
        contextPrecision * this.weights.contextPrecision +
        contextRecall * this.weights.contextRecall +
        answerRelevance * this.weights.answerRelevance
      );
    } else {
      // Without ground truth, redistribute recall weight
      const adjustedWeights = {
        faithfulness: this.weights.faithfulness + this.weights.contextRecall / 3,
        contextPrecision: this.weights.contextPrecision + this.weights.contextRecall / 3,
        answerRelevance: this.weights.answerRelevance + this.weights.contextRecall / 3,
      };

      return (
        faithfulness * adjustedWeights.faithfulness +
        contextPrecision * adjustedWeights.contextPrecision +
        answerRelevance * adjustedWeights.answerRelevance
      );
    }
  }

  /**
   * Generate human-readable summary
   */
  private generateSummary(
    faithfulness: FaithfulnessResult,
    contextPrecision: ContextPrecisionResult,
    contextRecall: ContextRecallResult,
    answerRelevance: AnswerRelevanceResult,
    overallScore: number
  ): string {
    const parts: string[] = [];

    // Overall score assessment
    if (overallScore >= 0.8) {
      parts.push('Excellent overall quality.');
    } else if (overallScore >= 0.6) {
      parts.push('Good overall quality with some areas for improvement.');
    } else if (overallScore >= 0.4) {
      parts.push('Moderate quality - significant improvements needed.');
    } else {
      parts.push('Poor quality - major issues detected.');
    }

    // Faithfulness
    if (faithfulness.unsupportedClaims.length > 0) {
      parts.push(
        `Faithfulness: ${(faithfulness.score * 100).toFixed(0)}% - ` +
        `${faithfulness.unsupportedClaims.length} unsupported claim(s) detected.`
      );
    } else {
      parts.push(`Faithfulness: ${(faithfulness.score * 100).toFixed(0)}% - All claims grounded.`);
    }

    // Context precision
    const relevantContexts = contextPrecision.contextRelevance.filter((c) => c.relevance > 0.5).length;
    parts.push(
      `Context Precision: ${(contextPrecision.score * 100).toFixed(0)}% - ` +
      `${relevantContexts}/${contextPrecision.contextRelevance.length} contexts relevant.`
    );

    // Context recall
    if (contextRecall.groundTruthClaims.length > 0) {
      const attributed = contextRecall.attributedClaims.filter((c) => c.attributed).length;
      parts.push(
        `Context Recall: ${(contextRecall.score * 100).toFixed(0)}% - ` +
        `${attributed}/${contextRecall.groundTruthClaims.length} ground truth claims covered.`
      );
    }

    // Answer relevance
    parts.push(`Answer Relevance: ${(answerRelevance.score * 100).toFixed(0)}%`);

    return parts.join(' ');
  }

  /**
   * Analyze whether a claim is supported by context
   */
  private analyzeClaim(
    claim: string,
    contexts: string[],
    combinedContext: string,
    contextWords: Set<string>
  ): ClaimAnalysis {
    const claimLower = claim.toLowerCase();
    const claimWords = claimLower.split(/\s+/).filter((w) => w.length > 2 && !this.isStopWord(w));

    // Check word overlap
    const matchingWords = claimWords.filter((w) => contextWords.has(w));
    const overlapRatio = claimWords.length > 0 ? matchingWords.length / claimWords.length : 0;

    // Check for key phrase matches
    const keyPhrases = this.extractKeyPhrases(claim);
    let phraseMatchCount = 0;
    let supportingContext: string | undefined;

    for (const phrase of keyPhrases) {
      if (combinedContext.includes(phrase.toLowerCase())) {
        phraseMatchCount++;
        // Find which context contains the phrase
        if (!supportingContext) {
          for (const ctx of contexts) {
            if (ctx.toLowerCase().includes(phrase.toLowerCase())) {
              supportingContext = ctx;
              break;
            }
          }
        }
      }
    }

    const phraseRatio = keyPhrases.length > 0 ? phraseMatchCount / keyPhrases.length : 0;

    // Check for key identifier matches (CamelCase, specific terms)
    const identifiers = this.extractKeywords(claim);
    let identifierMatchCount = 0;
    for (const id of identifiers) {
      if (combinedContext.toLowerCase().includes(id.toLowerCase())) {
        identifierMatchCount++;
        // Find supporting context
        if (!supportingContext) {
          for (const ctx of contexts) {
            if (ctx.toLowerCase().includes(id.toLowerCase())) {
              supportingContext = ctx;
              break;
            }
          }
        }
      }
    }
    const identifierRatio = identifiers.length > 0 ? identifierMatchCount / identifiers.length : 0;

    // Check for direct substring matches of significant claim portions
    let substringMatch = 0;
    for (const word of claimWords) {
      if (word.length > 4) {
        for (const ctx of contexts) {
          if (ctx.toLowerCase().includes(word)) {
            substringMatch++;
            if (!supportingContext) {
              supportingContext = ctx;
            }
            break;
          }
        }
      }
    }
    const substringRatio = claimWords.length > 0 ? substringMatch / claimWords.length : 0;

    // Combined confidence score - use maximum of different matching strategies
    const confidence = Math.max(
      overlapRatio * 0.6 + phraseRatio * 0.4,
      identifierRatio * 0.8 + overlapRatio * 0.2,
      substringRatio * 0.7 + identifierRatio * 0.3
    );

    // Lower threshold for support - be more generous
    const isSupported = confidence > 0.25;

    return {
      claim,
      isSupported,
      supportingContext: isSupported ? supportingContext : undefined,
      confidence,
    };
  }

  /**
   * Find attribution for a claim in contexts
   */
  private findAttribution(
    claim: string,
    contexts: string[],
    combinedContext: string,
    contextWords: Set<string>
  ): { attributed: boolean; context?: string } {
    const claimLower = claim.toLowerCase();
    const claimWords = claimLower.split(/\s+/).filter((w) => w.length > 2 && !this.isStopWord(w));

    // Check word overlap
    const matchingWords = claimWords.filter((w) => contextWords.has(w));
    const overlapRatio = claimWords.length > 0 ? matchingWords.length / claimWords.length : 0;

    // Check for key phrase matches
    const keyPhrases = this.extractKeyPhrases(claim);
    let bestContext: string | undefined;
    let bestPhraseScore = 0;

    for (const ctx of contexts) {
      const ctxLower = ctx.toLowerCase();
      let score = 0;

      for (const phrase of keyPhrases) {
        if (ctxLower.includes(phrase.toLowerCase())) {
          score += 1;
        }
      }

      // Normalize by phrase count
      const normalizedScore = keyPhrases.length > 0 ? score / keyPhrases.length : 0;

      if (normalizedScore > bestPhraseScore) {
        bestPhraseScore = normalizedScore;
        bestContext = ctx;
      }
    }

    // Also check for identifier matches
    const identifiers = this.extractKeywords(claim);
    let bestIdentifierScore = 0;

    for (const ctx of contexts) {
      const ctxLower = ctx.toLowerCase();
      let idScore = 0;

      for (const id of identifiers) {
        if (ctxLower.includes(id.toLowerCase())) {
          idScore += 1;
        }
      }

      const normalizedIdScore = identifiers.length > 0 ? idScore / identifiers.length : 0;

      if (normalizedIdScore > bestIdentifierScore) {
        bestIdentifierScore = normalizedIdScore;
        if (!bestContext) {
          bestContext = ctx;
        }
      }
    }

    // Check for direct keyword matches
    let keywordMatchScore = 0;
    for (const word of claimWords) {
      if (word.length > 4 && combinedContext.includes(word)) {
        keywordMatchScore += 1;
      }
    }
    const significantWords = claimWords.filter(w => w.length > 4).length;
    const keywordRatio = significantWords > 0 ? keywordMatchScore / significantWords : 0;

    // Use maximum of different strategies
    const combinedScore = Math.max(
      overlapRatio * 0.5 + bestPhraseScore * 0.5,
      bestIdentifierScore * 0.6 + overlapRatio * 0.4,
      keywordRatio * 0.7 + overlapRatio * 0.3
    );

    const attributed = combinedScore > 0.25;

    return {
      attributed,
      context: attributed ? bestContext : undefined,
    };
  }

  /**
   * Compute relevance of a context to a question
   */
  private computeContextRelevance(
    context: string,
    questionWords: Set<string>,
    questionKeywords: string[]
  ): number {
    const contextLower = context.toLowerCase();
    const contextWords = new Set(
      contextLower.split(/\s+/).filter((w) => w.length > 2 && !this.isStopWord(w))
    );

    // Word overlap score
    let wordMatches = 0;
    for (const word of questionWords) {
      if (contextWords.has(word)) {
        wordMatches++;
      }
    }
    const wordScore = questionWords.size > 0 ? wordMatches / questionWords.size : 0;

    // Keyword presence score
    let keywordMatches = 0;
    for (const keyword of questionKeywords) {
      if (contextLower.includes(keyword.toLowerCase())) {
        keywordMatches++;
      }
    }
    const keywordScore = questionKeywords.length > 0 ? keywordMatches / questionKeywords.length : 0;

    // Check for semantic relevance based on topic overlap
    const topicTerms = this.extractTopicTerms(context);
    let topicOverlap = 0;
    for (const term of topicTerms) {
      for (const qWord of questionWords) {
        if (term.includes(qWord) || qWord.includes(term)) {
          topicOverlap++;
          break;
        }
      }
    }
    const topicScore = topicTerms.length > 0 ? topicOverlap / topicTerms.length : 0;

    // Combined relevance using maximum of different strategies
    return Math.max(
      wordScore * 0.5 + keywordScore * 0.5,
      keywordScore * 0.7 + topicScore * 0.3,
      wordScore * 0.6 + topicScore * 0.4
    );
  }

  /**
   * Extract topic-relevant terms from text
   */
  private extractTopicTerms(text: string): string[] {
    const terms: string[] = [];
    const lower = text.toLowerCase();

    // Extract code-related terms
    const codeTerms = lower.match(/\b(function|method|class|service|handler|controller|module|api|auth|user|login|session|token|database|query|request|response|error|config|log)\b/gi);
    if (codeTerms) {
      terms.push(...codeTerms.map(t => t.toLowerCase()));
    }

    // Extract significant words
    const words = lower.split(/\s+/).filter(w => w.length > 4 && !this.isStopWord(w));
    terms.push(...words);

    return [...new Set(terms)];
  }

  /**
   * Generate questions that could be answered by the given answer
   */
  private generateQuestionsFromAnswer(answer: string): string[] {
    const questions: string[] = [];
    const sentences = answer.split(/(?<=[.!?])\s+/);

    for (const sentence of sentences) {
      const trimmed = sentence.trim();
      if (trimmed.length < 10) continue;

      // Extract subject-verb-object patterns and generate questions
      const generatedQ = this.sentenceToQuestion(trimmed);
      if (generatedQ && generatedQ.length > 5) {
        questions.push(generatedQ);
      }
    }

    // Limit to reasonable number of questions
    return questions.slice(0, 5);
  }

  /**
   * Convert a declarative sentence to a question
   */
  private sentenceToQuestion(sentence: string): string | null {
    const sentenceLower = sentence.toLowerCase();

    // Pattern: "X is/are Y" -> "What is X?"
    const isMatch = sentence.match(/^(?:The\s+)?(\w+(?:\s+\w+)?)\s+(?:is|are)\s+/i);
    if (isMatch) {
      return `What is ${isMatch[1]}?`;
    }

    // Pattern: "X has Y" -> "What does X have?"
    const hasMatch = sentence.match(/^(?:The\s+)?(\w+(?:\s+\w+)?)\s+has\s+/i);
    if (hasMatch) {
      return `What does ${hasMatch[1]} have?`;
    }

    // Pattern: "X does/handles/manages Y" -> "What does X do?"
    const verbMatch = sentence.match(
      /^(?:The\s+)?(\w+(?:\s+\w+)?)\s+(handles?|manages?|processes?|does|performs?|creates?|validates?|returns?)\s+/i
    );
    if (verbMatch) {
      return `What does ${verbMatch[1]} do?`;
    }

    // Pattern: Contains "function/method/class" -> Ask about it
    if (sentenceLower.includes('function') || sentenceLower.includes('method')) {
      return 'What does this function/method do?';
    }

    if (sentenceLower.includes('class') || sentenceLower.includes('service')) {
      return 'What is the purpose of this class/service?';
    }

    // Default: extract key noun and ask about it
    const nouns = sentence.match(/\b[A-Z][a-zA-Z]*\b/g);
    if (nouns && nouns.length > 0) {
      return `What is ${nouns[0]}?`;
    }

    return null;
  }

  /**
   * Compute similarity between two questions
   */
  private computeQuestionSimilarity(q1: string, q2: string): number {
    const q1Lower = q1.toLowerCase();
    const q2Lower = q2.toLowerCase();

    // Remove question marks and common question words for comparison
    const clean = (s: string) =>
      s
        .replace(/[?.,!]/g, '')
        .replace(/\b(what|how|why|when|where|who|which|does|do|is|are|the|a|an)\b/gi, '')
        .trim();

    const clean1 = clean(q1Lower);
    const clean2 = clean(q2Lower);

    const words1 = new Set(clean1.split(/\s+/).filter((w) => w.length > 2));
    const words2 = new Set(clean2.split(/\s+/).filter((w) => w.length > 2));

    if (words1.size === 0 || words2.size === 0) {
      return 0;
    }

    // Jaccard similarity
    const intersection = [...words1].filter((w) => words2.has(w)).length;
    const union = new Set([...words1, ...words2]).size;
    const jaccardScore = union > 0 ? intersection / union : 0;

    // Also compute overlap ratio based on smaller set
    const minSize = Math.min(words1.size, words2.size);
    const overlapRatio = minSize > 0 ? intersection / minSize : 0;

    // Check for topic alignment
    const topicWords1 = this.extractTopicTerms(q1);
    const topicWords2 = this.extractTopicTerms(q2);
    let topicOverlap = 0;
    for (const t1 of topicWords1) {
      for (const t2 of topicWords2) {
        if (t1 === t2 || t1.includes(t2) || t2.includes(t1)) {
          topicOverlap++;
          break;
        }
      }
    }
    const topicScore = topicWords1.length > 0 ? topicOverlap / topicWords1.length : 0;

    // Return maximum of different similarity measures
    return Math.max(jaccardScore, overlapRatio * 0.8, topicScore * 0.9);
  }

  /**
   * Extract key phrases from text (2-3 word combinations)
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

    // 3-word phrases
    for (let i = 0; i < words.length - 2; i++) {
      const w1 = words[i].replace(/[^a-zA-Z0-9]/g, '');
      const w2 = words[i + 1].replace(/[^a-zA-Z0-9]/g, '');
      const w3 = words[i + 2].replace(/[^a-zA-Z0-9]/g, '');
      if (w1.length > 2 && w3.length > 2 && !this.isStopWord(w1) && !this.isStopWord(w3)) {
        phrases.push(`${w1} ${w2} ${w3}`);
      }
    }

    return phrases;
  }

  /**
   * Extract keywords from text (important nouns/verbs)
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

    // Extract significant words (lowercase, not stop words)
    const words = text.toLowerCase().split(/\s+/);
    for (const word of words) {
      const clean = word.replace(/[^a-z0-9]/g, '');
      if (clean.length > 4 && !this.isStopWord(clean)) {
        keywords.push(clean);
      }
    }

    return [...new Set(keywords)];
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

  /**
   * Check if text looks like a valid claim
   */
  private isValidClaim(text: string): boolean {
    // Must contain at least one non-stop word
    const words = text.toLowerCase().split(/\s+/);
    const significantWords = words.filter((w) => w.length > 2 && !this.isStopWord(w));
    return significantWords.length >= 1;
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a new RAGASMetrics instance
 */
export function createRAGASMetrics(): RAGASMetrics {
  return new RAGASMetrics();
}
