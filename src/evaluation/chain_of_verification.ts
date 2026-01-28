/**
 * @fileoverview Chain-of-Verification Implementation (WU-HALU-004)
 *
 * Implements the 4-step Chain-of-Verification (CoVe) process for hallucination reduction:
 *
 * 1. Generate Baseline Response - Create initial response from query and context
 * 2. Plan Verification Questions - Extract verifiable claims and generate questions
 * 3. Answer Verification Questions - Independently verify each question against context
 * 4. Generate Final Response - Synthesize verified response with corrections
 *
 * Research basis: Chain-of-Verification technique reduces hallucinations by ~23%
 * through systematic self-verification of claims.
 *
 * @packageDocumentation
 */

import { type ConfidenceValue, absent, type DerivedConfidence } from '../epistemics/confidence.js';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Input for the verification process
 */
export interface VerificationInput {
  /** The original query to answer */
  query: string;
  /** Context documents/snippets to use for answering */
  context: string[];
  /** Optional pre-generated baseline response to verify */
  baselineResponse?: string;
}

/**
 * A verification question generated from a claim in the baseline response
 */
export interface VerificationQuestion {
  /** Unique identifier for the question */
  id: string;
  /** The verification question text */
  question: string;
  /** The claim from the baseline that this question targets */
  targetClaim: string;
  /** Expected type of answer */
  expectedAnswerType: 'factual' | 'boolean' | 'numeric';
}

/**
 * Answer to a verification question
 */
export interface VerificationAnswer {
  /** ID of the question this answers */
  questionId: string;
  /** The answer text */
  answer: string;
  /** Confidence in this answer (0-1) */
  confidence: number;
  /** Citation from context if available */
  sourceCitation?: string;
  /** Whether this answer is consistent with the baseline claim */
  consistentWithBaseline: boolean;
}

/**
 * An inconsistency detected between baseline and verification
 */
export interface Inconsistency {
  /** ID of the question that revealed this inconsistency */
  questionId: string;
  /** The original claim from baseline */
  baselineClaim: string;
  /** The verified claim from independent verification */
  verifiedClaim: string;
  /** How the inconsistency was resolved */
  resolution: 'revised' | 'kept_original' | 'removed';
}

/**
 * Complete result of the verification process
 */
export interface VerificationResult {
  /** The original query */
  originalQuery: string;
  /** The baseline response (generated or provided) */
  baselineResponse: string;
  /** Questions generated for verification */
  verificationQuestions: VerificationQuestion[];
  /** Answers to verification questions */
  verificationAnswers: VerificationAnswer[];
  /** Detected inconsistencies */
  inconsistencies: Inconsistency[];
  /** Final verified response */
  finalResponse: string;
  /** Metrics about the verification improvement */
  improvementMetrics: {
    /** Number of claims that were verified */
    claimsVerified: number;
    /** Number of claims that were revised */
    claimsRevised: number;
    /** Overall confidence improvement (-1 to 1) */
    confidenceImprovement: number;
  };
  /** Overall confidence in the final response */
  confidence: ConfidenceValue;
}

/**
 * Configuration for Chain-of-Verification
 */
export interface ChainOfVerificationConfig {
  /** Maximum number of verification questions to generate */
  maxVerificationQuestions: number;
  /** Minimum confidence threshold to keep a claim */
  minConfidenceThreshold: number;
  /** Whether to add hedging language for low-confidence claims */
  addHedgingForLowConfidence: boolean;
  /** Confidence threshold below which hedging is added */
  hedgingThreshold: number;
}

// ============================================================================
// DEFAULT CONFIGURATION
// ============================================================================

/**
 * Default configuration for Chain-of-Verification
 */
export const DEFAULT_CHAIN_OF_VERIFICATION_CONFIG: ChainOfVerificationConfig = {
  maxVerificationQuestions: 10,
  minConfidenceThreshold: 0.5,
  addHedgingForLowConfidence: true,
  hedgingThreshold: 0.6,
};

// ============================================================================
// CLAIM EXTRACTION PATTERNS
// ============================================================================

interface ClaimPattern {
  pattern: RegExp;
  type: 'factual' | 'boolean' | 'numeric';
  questionTemplate: (match: RegExpMatchArray) => string;
}

const CLAIM_PATTERNS: ClaimPattern[] = [
  // Numeric claims: "has N methods/parameters/etc"
  {
    pattern: /(\w+)\s+has\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(\w+)/gi,
    type: 'numeric',
    questionTemplate: (m) => `How many ${m[3]} does ${m[1]} have?`,
  },
  // Return type claims
  {
    pattern: /(\w+)\s+returns?\s+([A-Z][a-zA-Z<>[\]]+|\w+)/gi,
    type: 'factual',
    questionTemplate: (m) => `What does ${m[1]} return?`,
  },
  // Is/are type claims
  {
    pattern: /(\w+)\s+is\s+(a|an)\s+(\w+)/gi,
    type: 'boolean',
    questionTemplate: (m) => `Is ${m[1]} ${m[2]} ${m[3]}?`,
  },
  // Existence claims
  {
    pattern: /(?:has|have)\s+(?:a\s+)?method\s+(?:called\s+)?(\w+)/gi,
    type: 'boolean',
    questionTemplate: (m) => `Does it have a method called ${m[1]}?`,
  },
  // Location claims
  {
    pattern: /(?:defined|located)\s+in\s+([^\s.]+)/gi,
    type: 'factual',
    questionTemplate: (m) => `Where is it defined?`,
  },
  // Accepts/takes parameter claims
  {
    pattern: /(?:accepts?|takes?)\s+(?:a\s+)?(\w+)\s+(?:parameter|argument)/gi,
    type: 'factual',
    questionTemplate: (m) => `What parameter does it accept?`,
  },
  // Extends/implements claims
  {
    pattern: /(\w+)\s+(?:extends?|implements?)\s+(\w+)/gi,
    type: 'boolean',
    questionTemplate: (m) => `Does ${m[1]} extend/implement ${m[2]}?`,
  },
  // Property/attribute claims
  {
    pattern: /has\s+(?:a\s+)?(?:property|attribute)\s+(?:called\s+)?(\w+)/gi,
    type: 'boolean',
    questionTemplate: (m) => `Does it have a property called ${m[1]}?`,
  },
];

// Numeric word mapping
const NUMERIC_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

// ============================================================================
// HEDGING LANGUAGE
// ============================================================================

const HEDGING_PHRASES = [
  'may',
  'might',
  'possibly',
  'appears to',
  'seems to',
  'likely',
];

// ============================================================================
// CHAIN-OF-VERIFICATION CLASS
// ============================================================================

/**
 * Implements the Chain-of-Verification process for hallucination reduction.
 *
 * The 4-step process:
 * 1. Generate baseline response from query and context
 * 2. Plan verification questions by extracting claims
 * 3. Answer each verification question independently
 * 4. Synthesize final response, revising inconsistent claims
 */
export class ChainOfVerification {
  private config: ChainOfVerificationConfig;
  private questionIdCounter: number = 0;

  constructor(config?: Partial<ChainOfVerificationConfig>) {
    this.config = { ...DEFAULT_CHAIN_OF_VERIFICATION_CONFIG, ...config };
  }

  /**
   * Run the complete verification process
   */
  async verify(input: VerificationInput): Promise<VerificationResult> {
    const { query, context, baselineResponse: providedBaseline } = input;

    // Step 1: Generate or use provided baseline
    const baselineResponse = providedBaseline || await this.generateBaseline(query, context);

    // Step 2: Plan verification questions
    const verificationQuestions = this.planVerificationQuestions(baselineResponse);

    // Step 3: Answer verification questions independently
    const verificationAnswers = await this.answerVerificationQuestions(
      verificationQuestions,
      context
    );

    // Step 4: Detect inconsistencies and synthesize final response
    const inconsistencies = this.detectInconsistencies(baselineResponse, verificationAnswers);
    const finalResponse = this.synthesizeFinalResponse(baselineResponse, verificationAnswers);

    // Calculate improvement metrics
    const improvementMetrics = this.calculateImprovementMetrics(
      verificationQuestions,
      verificationAnswers,
      inconsistencies
    );

    // Calculate overall confidence
    const confidence = this.calculateOverallConfidence(verificationAnswers, context.length);

    return {
      originalQuery: query,
      baselineResponse,
      verificationQuestions,
      verificationAnswers,
      inconsistencies,
      finalResponse,
      improvementMetrics,
      confidence,
    };
  }

  /**
   * Step 1: Generate baseline response from query and context
   */
  async generateBaseline(query: string, context: string[]): Promise<string> {
    if (!query && context.length === 0) {
      return '';
    }

    if (context.length === 0) {
      return `Based on the query "${query}", no specific information is available.`;
    }

    // Extract key information from context
    const relevantInfo: string[] = [];
    const queryLower = query.toLowerCase();

    // Find context lines relevant to the query
    for (const line of context) {
      const lineLower = line.toLowerCase();
      // Check for keyword overlap
      const queryWords = queryLower.split(/\s+/).filter(w => w.length > 3);
      const hasOverlap = queryWords.some(word => lineLower.includes(word));
      if (hasOverlap) {
        relevantInfo.push(line);
      }
    }

    // If no relevant info found, use all context
    if (relevantInfo.length === 0) {
      relevantInfo.push(...context.slice(0, 5));
    }

    // Synthesize baseline response
    if (relevantInfo.length === 1) {
      return relevantInfo[0];
    }

    return relevantInfo.join(' ');
  }

  /**
   * Step 2: Plan verification questions based on claims in the response
   */
  planVerificationQuestions(response: string): VerificationQuestion[] {
    const questions: VerificationQuestion[] = [];
    const seenClaims = new Set<string>();

    for (const claimPattern of CLAIM_PATTERNS) {
      const regex = new RegExp(claimPattern.pattern.source, claimPattern.pattern.flags);
      let match: RegExpExecArray | null;

      while ((match = regex.exec(response)) !== null) {
        const targetClaim = match[0];
        const normalizedClaim = targetClaim.toLowerCase().trim();

        // Skip duplicate claims
        if (seenClaims.has(normalizedClaim)) {
          continue;
        }
        seenClaims.add(normalizedClaim);

        const question: VerificationQuestion = {
          id: this.generateQuestionId(),
          question: claimPattern.questionTemplate(match),
          targetClaim,
          expectedAnswerType: claimPattern.type,
        };

        questions.push(question);

        // Respect max questions limit
        if (questions.length >= this.config.maxVerificationQuestions) {
          return questions;
        }
      }
    }

    return questions;
  }

  /**
   * Step 3: Answer verification questions independently against context
   */
  async answerVerificationQuestions(
    questions: VerificationQuestion[],
    context: string[]
  ): Promise<VerificationAnswer[]> {
    const answers: VerificationAnswer[] = [];

    for (const question of questions) {
      const answer = await this.answerSingleQuestion(question, context);
      answers.push(answer);
    }

    return answers;
  }

  /**
   * Answer a single verification question
   */
  private async answerSingleQuestion(
    question: VerificationQuestion,
    context: string[]
  ): Promise<VerificationAnswer> {
    if (context.length === 0) {
      return {
        questionId: question.id,
        answer: 'Unable to verify - no context available',
        confidence: 0.1,
        consistentWithBaseline: false,
      };
    }

    // Search context for relevant information
    const relevantContext = this.findRelevantContext(question, context);

    if (relevantContext.length === 0) {
      return {
        questionId: question.id,
        answer: 'No supporting evidence found in context',
        confidence: 0.2,
        consistentWithBaseline: false,
      };
    }

    // Extract answer from context
    const { answer, citation, confidence } = this.extractAnswerFromContext(
      question,
      relevantContext
    );

    // Check consistency with the original claim
    const consistentWithBaseline = this.checkConsistency(question.targetClaim, answer);

    return {
      questionId: question.id,
      answer,
      confidence,
      sourceCitation: citation,
      consistentWithBaseline,
    };
  }

  /**
   * Find context lines relevant to a question
   */
  private findRelevantContext(question: VerificationQuestion, context: string[]): string[] {
    const relevant: string[] = [];
    const questionLower = question.question.toLowerCase();
    const claimLower = question.targetClaim.toLowerCase();

    // Extract key terms from question and claim
    const keyTerms = this.extractKeyTerms(questionLower + ' ' + claimLower);

    for (const line of context) {
      const lineLower = line.toLowerCase();
      const matchCount = keyTerms.filter(term => lineLower.includes(term)).length;

      if (matchCount >= 1) {
        relevant.push(line);
      }
    }

    return relevant;
  }

  /**
   * Extract key terms from text
   */
  private extractKeyTerms(text: string): string[] {
    const stopWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'has', 'have', 'had',
      'does', 'do', 'did', 'what', 'how', 'many', 'which', 'that', 'this', 'it']);

    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 2 && !stopWords.has(word));
  }

  /**
   * Extract answer from relevant context
   */
  private extractAnswerFromContext(
    question: VerificationQuestion,
    relevantContext: string[]
  ): { answer: string; citation: string | undefined; confidence: number } {
    // Join relevant context
    const combinedContext = relevantContext.join(' ');
    const citation = relevantContext[0];

    let answer: string;
    let confidence: number;

    switch (question.expectedAnswerType) {
      case 'numeric':
        const numericAnswer = this.extractNumericAnswer(combinedContext, question);
        answer = numericAnswer.answer;
        confidence = numericAnswer.confidence;
        break;

      case 'boolean':
        const booleanAnswer = this.extractBooleanAnswer(combinedContext, question);
        answer = booleanAnswer.answer;
        confidence = booleanAnswer.confidence;
        break;

      case 'factual':
      default:
        answer = this.extractFactualAnswer(combinedContext, question);
        confidence = relevantContext.length > 0 ? 0.7 : 0.3;
    }

    return { answer, citation, confidence };
  }

  /**
   * Extract numeric answer from context
   */
  private extractNumericAnswer(
    context: string,
    question: VerificationQuestion
  ): { answer: string; confidence: number } {
    // Look for numbers in context
    const numberMatch = context.match(/(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+\w+/gi);

    if (numberMatch) {
      // Extract the number
      const match = numberMatch[0];
      const numWord = match.split(/\s+/)[0].toLowerCase();
      const num = NUMERIC_WORDS[numWord] ?? parseInt(numWord, 10);

      return {
        answer: `${num}`,
        confidence: 0.8,
      };
    }

    return {
      answer: 'Unable to determine count',
      confidence: 0.3,
    };
  }

  /**
   * Extract boolean answer from context
   */
  private extractBooleanAnswer(
    context: string,
    question: VerificationQuestion
  ): { answer: string; confidence: number } {
    const claimLower = question.targetClaim.toLowerCase();
    const contextLower = context.toLowerCase();

    // Check if context supports the claim
    const keyTerms = this.extractKeyTerms(claimLower);
    const matchCount = keyTerms.filter(term => contextLower.includes(term)).length;
    const matchRatio = matchCount / keyTerms.length;

    if (matchRatio >= 0.5) {
      return {
        answer: 'Yes, confirmed by context',
        confidence: Math.min(0.9, 0.5 + matchRatio * 0.4),
      };
    }

    return {
      answer: 'Not confirmed by context',
      confidence: 0.4,
    };
  }

  /**
   * Extract factual answer from context
   */
  private extractFactualAnswer(context: string, question: VerificationQuestion): string {
    // For factual questions, return the most relevant portion of context
    const sentences = context.split(/[.!?]+/).filter(s => s.trim().length > 0);

    if (sentences.length === 0) {
      return 'No factual information found';
    }

    // Find most relevant sentence
    const questionTerms = this.extractKeyTerms(question.question);
    let bestSentence = sentences[0];
    let bestScore = 0;

    for (const sentence of sentences) {
      const sentenceLower = sentence.toLowerCase();
      const score = questionTerms.filter(term => sentenceLower.includes(term)).length;
      if (score > bestScore) {
        bestScore = score;
        bestSentence = sentence;
      }
    }

    return bestSentence.trim();
  }

  /**
   * Check if answer is consistent with the original claim
   */
  private checkConsistency(claim: string, answer: string): boolean {
    const claimLower = claim.toLowerCase();
    const answerLower = answer.toLowerCase();

    // Extract key terms from both
    const claimTerms = this.extractKeyTerms(claimLower);
    const answerTerms = this.extractKeyTerms(answerLower);

    // Check for contradictory indicators
    const contradictionIndicators = [
      'not confirmed',
      'unable to',
      'no supporting',
      'not found',
      'no information',
    ];

    for (const indicator of contradictionIndicators) {
      if (answerLower.includes(indicator)) {
        return false;
      }
    }

    // Check for numeric consistency
    const claimNumber = this.extractNumber(claimLower);
    const answerNumber = this.extractNumber(answerLower);

    if (claimNumber !== null && answerNumber !== null && claimNumber !== answerNumber) {
      return false;
    }

    // Check for term overlap
    const overlap = claimTerms.filter(term => answerTerms.includes(term));
    return overlap.length >= Math.min(2, claimTerms.length * 0.3);
  }

  /**
   * Extract number from text
   */
  private extractNumber(text: string): number | null {
    // Try numeric words first
    for (const [word, num] of Object.entries(NUMERIC_WORDS)) {
      if (text.includes(word)) {
        return num;
      }
    }

    // Try digits
    const match = text.match(/\b(\d+)\b/);
    if (match) {
      return parseInt(match[1], 10);
    }

    return null;
  }

  /**
   * Detect inconsistencies between baseline and verification answers
   */
  detectInconsistencies(baseline: string, answers: VerificationAnswer[]): Inconsistency[] {
    const inconsistencies: Inconsistency[] = [];

    for (const answer of answers) {
      if (!answer.consistentWithBaseline) {
        // Find the claim this answer relates to
        const baselineClaim = this.findClaimInBaseline(baseline, answer);

        // Determine resolution based on confidence
        let resolution: Inconsistency['resolution'];
        if (answer.confidence >= 0.7) {
          resolution = 'revised';
        } else if (answer.confidence >= 0.4) {
          resolution = 'kept_original';
        } else {
          resolution = 'removed';
        }

        inconsistencies.push({
          questionId: answer.questionId,
          baselineClaim,
          verifiedClaim: answer.answer,
          resolution,
        });
      }
    }

    return inconsistencies;
  }

  /**
   * Find the claim in baseline that relates to an answer
   */
  private findClaimInBaseline(baseline: string, answer: VerificationAnswer): string {
    // Try to find a sentence containing key terms from the answer
    const sentences = baseline.split(/[.!?]+/).filter(s => s.trim().length > 0);
    const answerTerms = this.extractKeyTerms(answer.answer);

    for (const sentence of sentences) {
      const sentenceLower = sentence.toLowerCase();
      const matchCount = answerTerms.filter(term => sentenceLower.includes(term)).length;
      if (matchCount >= 1) {
        return sentence.trim();
      }
    }

    return sentences[0]?.trim() || baseline.slice(0, 100);
  }

  /**
   * Step 4: Synthesize final response from baseline and verification answers
   */
  synthesizeFinalResponse(baseline: string, answers: VerificationAnswer[]): string {
    if (answers.length === 0) {
      return baseline;
    }

    let response = baseline;

    // Group answers by consistency
    const inconsistentAnswers = answers.filter(a => !a.consistentWithBaseline);

    if (inconsistentAnswers.length === 0) {
      return baseline;
    }

    // Process inconsistencies
    for (const answer of inconsistentAnswers) {
      if (answer.confidence >= 0.7) {
        // High confidence contradiction - revise
        response = this.reviseResponse(response, answer);
      } else if (answer.confidence >= 0.4 && this.config.addHedgingForLowConfidence) {
        // Medium confidence - add hedging
        response = this.addHedging(response, answer);
      }
      // Low confidence - keep original or remove (handled by not modifying)
    }

    return response;
  }

  /**
   * Revise response based on high-confidence correction
   */
  private reviseResponse(response: string, answer: VerificationAnswer): string {
    // If the answer contains a number correction
    const answerNumber = this.extractNumber(answer.answer);
    if (answerNumber !== null) {
      // Find and replace number in response
      const sentences = response.split(/([.!?]+)/);
      const updatedSentences = sentences.map(sentence => {
        const sentenceNumber = this.extractNumber(sentence.toLowerCase());
        if (sentenceNumber !== null && sentenceNumber !== answerNumber) {
          // Replace the number
          return sentence.replace(
            new RegExp(`\\b(${sentenceNumber}|${this.numberToWord(sentenceNumber)})\\b`, 'gi'),
            String(answerNumber)
          );
        }
        return sentence;
      });
      return updatedSentences.join('');
    }

    // For non-numeric corrections, append correction note
    const answerSummary = answer.answer.slice(0, 100);
    return `${response} [Verified: ${answerSummary}]`;
  }

  /**
   * Convert number to word
   */
  private numberToWord(num: number): string {
    const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
    return words[num] || String(num);
  }

  /**
   * Add hedging language for low-confidence claims
   */
  private addHedging(response: string, answer: VerificationAnswer): string {
    const hedgePhrase = HEDGING_PHRASES[Math.floor(answer.confidence * HEDGING_PHRASES.length)];

    // Find claim-related sentence and add hedging
    const sentences = response.split(/([.!?]+)/);
    const answerTerms = this.extractKeyTerms(answer.answer);

    const updatedSentences = sentences.map(sentence => {
      const sentenceLower = sentence.toLowerCase();
      const matchCount = answerTerms.filter(term => sentenceLower.includes(term)).length;

      if (matchCount >= 1 && !this.hasHedging(sentence)) {
        // Add hedging to this sentence
        const trimmed = sentence.trim();
        if (trimmed.length > 0) {
          return ` ${hedgePhrase} ${trimmed.charAt(0).toLowerCase()}${trimmed.slice(1)}`;
        }
      }
      return sentence;
    });

    return updatedSentences.join('').trim();
  }

  /**
   * Check if sentence already has hedging
   */
  private hasHedging(sentence: string): boolean {
    const sentenceLower = sentence.toLowerCase();
    return HEDGING_PHRASES.some(phrase => sentenceLower.includes(phrase));
  }

  /**
   * Calculate improvement metrics
   */
  private calculateImprovementMetrics(
    questions: VerificationQuestion[],
    answers: VerificationAnswer[],
    inconsistencies: Inconsistency[]
  ): VerificationResult['improvementMetrics'] {
    const claimsVerified = answers.filter(a => a.consistentWithBaseline).length;
    const claimsRevised = inconsistencies.filter(i => i.resolution === 'revised').length;

    // Calculate confidence improvement
    const avgAnswerConfidence = answers.length > 0
      ? answers.reduce((sum, a) => sum + a.confidence, 0) / answers.length
      : 0.5;

    // Baseline confidence is assumed to be lower (unverified)
    const baselineConfidence = 0.5;
    const confidenceImprovement = avgAnswerConfidence - baselineConfidence;

    return {
      claimsVerified,
      claimsRevised,
      confidenceImprovement,
    };
  }

  /**
   * Calculate overall confidence for the verification result
   */
  private calculateOverallConfidence(
    answers: VerificationAnswer[],
    contextLength: number
  ): ConfidenceValue {
    if (answers.length === 0) {
      if (contextLength === 0) {
        return absent('insufficient_data');
      }
      return {
        type: 'derived',
        value: 0.3,
        formula: 'no_verification_questions',
        inputs: [],
      } as DerivedConfidence;
    }

    // Calculate weighted average based on individual answer confidences
    const avgConfidence = answers.reduce((sum, a) => sum + a.confidence, 0) / answers.length;
    const consistencyRate = answers.filter(a => a.consistentWithBaseline).length / answers.length;

    // Combine average confidence with consistency rate
    const combinedConfidence = avgConfidence * 0.6 + consistencyRate * 0.4;

    // Adjust for context availability
    const contextFactor = contextLength > 0 ? Math.min(1, contextLength / 5) : 0.2;
    const finalConfidence = combinedConfidence * contextFactor;

    return {
      type: 'derived',
      value: Math.max(0, Math.min(1, finalConfidence)),
      formula: 'avg_confidence * 0.6 + consistency_rate * 0.4 * context_factor',
      inputs: answers.map((a, i) => ({
        name: `answer_${i}_confidence`,
        confidence: {
          type: 'derived',
          value: a.confidence,
          formula: 'context_match_score',
          inputs: [],
        } as DerivedConfidence,
      })),
    } as DerivedConfidence;
  }

  /**
   * Generate unique question ID
   */
  private generateQuestionId(): string {
    return `vq-${++this.questionIdCounter}-${Date.now().toString(36)}`;
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a new ChainOfVerification instance
 */
export function createChainOfVerification(
  config?: Partial<ChainOfVerificationConfig>
): ChainOfVerification {
  return new ChainOfVerification(config);
}
