/**
 * @fileoverview Chain-of-Verification Implementation (ACL 2024)
 *
 * Implements the Chain-of-Verification (CoVe) technique for hallucination reduction
 * based on the ACL 2024 research paper.
 *
 * The 4-step verification process:
 * 1. Draft initial response (generate baseline)
 * 2. Plan verification questions (decompose into verifiable sub-claims)
 * 3. Execute verification (answer questions independently against context)
 * 4. Revise based on findings (synthesize corrected response)
 *
 * Expected impact: +23% F1 improvement on factual accuracy.
 *
 * References:
 * - docs/librarian/RESEARCH_IMPLEMENTATION_MAPPING.md (CoVe details)
 * - ACL 2024: Chain-of-Verification Reduces Hallucination in Large Language Models
 *
 * @packageDocumentation
 */

import { type ConfidenceValue, absent, type DerivedConfidence, sequenceConfidence, deterministic } from '../epistemics/confidence.js';
import { type Claim, type ClaimSource, createClaim, type ClaimType } from '../epistemics/types.js';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * A single step in the Chain-of-Verification process.
 * Each step represents a verifiable sub-claim extracted from the original claim.
 */
export interface CoVeStep {
  /** The sub-claim being verified */
  claim: string;

  /** The verification question generated for this claim */
  verificationQuestion: string;

  /** The answer obtained from verification */
  answer: string;

  /** Confidence in the verification answer (0-1) */
  confidence: number;

  /** Sources/citations that support the answer */
  sources: string[];
}

/**
 * Result of executing the complete Chain-of-Verification process.
 */
export interface CoVeResult {
  /** The original claim that was verified */
  originalClaim: string;

  /** The chain of verification steps */
  verificationChain: CoVeStep[];

  /** Final verdict based on all verification steps */
  finalVerdict: 'verified' | 'refuted' | 'uncertain';

  /** Overall confidence in the verification result */
  overallConfidence: number;

  /** Revisions made to the original claim based on verification */
  revisions: string[];
}

/**
 * Evidence type for integration with epistemics system.
 */
export interface Evidence {
  /** Unique identifier */
  id: string;

  /** Type of evidence */
  type: 'cove_verification' | 'cove_step' | 'cove_revision';

  /** The claim being supported/opposed */
  claim: string;

  /** Evidence content */
  content: string;

  /** Whether this evidence supports or opposes the claim */
  supports: boolean;

  /** Confidence in this evidence */
  confidence: ConfidenceValue;

  /** Source of the evidence */
  source: ClaimSource;

  /** Timestamp */
  timestamp: string;

  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

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
  /** Enable detailed logging */
  verbose?: boolean;
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
  verbose: false,
};

// ============================================================================
// CLAIM EXTRACTION PATTERNS
// ============================================================================

interface ClaimPattern {
  pattern: RegExp;
  type: 'factual' | 'boolean' | 'numeric';
  questionTemplate: (match: RegExpMatchArray) => string;
  claimType: ClaimType;
}

const CLAIM_PATTERNS: ClaimPattern[] = [
  // Numeric claims: "has N methods/parameters/etc"
  {
    pattern: /(\w+)\s+has\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(\w+)/gi,
    type: 'numeric',
    questionTemplate: (m) => `How many ${m[3]} does ${m[1]} have?`,
    claimType: 'structural',
  },
  // Return type claims
  {
    pattern: /(\w+)\s+returns?\s+([A-Z][a-zA-Z<>[\]]+|\w+)/gi,
    type: 'factual',
    questionTemplate: (m) => `What does ${m[1]} return?`,
    claimType: 'structural',
  },
  // Is/are type claims
  {
    pattern: /(\w+)\s+is\s+(a|an)\s+(\w+)/gi,
    type: 'boolean',
    questionTemplate: (m) => `Is ${m[1]} ${m[2]} ${m[3]}?`,
    claimType: 'structural',
  },
  // Existence claims
  {
    pattern: /(?:has|have)\s+(?:a\s+)?method\s+(?:called\s+)?(\w+)/gi,
    type: 'boolean',
    questionTemplate: (m) => `Does it have a method called ${m[1]}?`,
    claimType: 'structural',
  },
  // Location claims
  {
    pattern: /(?:defined|located)\s+in\s+([^\s.]+)/gi,
    type: 'factual',
    questionTemplate: (_m) => `Where is it defined?`,
    claimType: 'structural',
  },
  // Accepts/takes parameter claims
  {
    pattern: /(?:accepts?|takes?)\s+(?:a\s+)?(\w+)\s+(?:parameter|argument)/gi,
    type: 'factual',
    questionTemplate: (_m) => `What parameter does it accept?`,
    claimType: 'structural',
  },
  // Extends/implements claims
  {
    pattern: /(\w+)\s+(?:extends?|implements?)\s+(\w+)/gi,
    type: 'boolean',
    questionTemplate: (m) => `Does ${m[1]} extend/implement ${m[2]}?`,
    claimType: 'structural',
  },
  // Property/attribute claims
  {
    pattern: /has\s+(?:a\s+)?(?:property|attribute)\s+(?:called\s+)?(\w+)/gi,
    type: 'boolean',
    questionTemplate: (m) => `Does it have a property called ${m[1]}?`,
    claimType: 'structural',
  },
  // Contains/includes claims
  {
    pattern: /(\w+)\s+(?:contains?|includes?)\s+(\w+)/gi,
    type: 'boolean',
    questionTemplate: (m) => `Does ${m[1]} contain ${m[2]}?`,
    claimType: 'structural',
  },
  // Calls/invokes claims
  {
    pattern: /(\w+)\s+(?:calls?|invokes?)\s+(\w+)/gi,
    type: 'boolean',
    questionTemplate: (m) => `Does ${m[1]} call ${m[2]}?`,
    claimType: 'behavioral',
  },
  // Depends on claims
  {
    pattern: /(\w+)\s+(?:depends?\s+on|requires?)\s+(\w+)/gi,
    type: 'boolean',
    questionTemplate: (m) => `Does ${m[1]} depend on ${m[2]}?`,
    claimType: 'relational',
  },
  // Async/sync claims
  {
    pattern: /(\w+)\s+is\s+(async(?:hronous)?|sync(?:hronous)?)/gi,
    type: 'boolean',
    questionTemplate: (m) => `Is ${m[1]} ${m[2]}?`,
    claimType: 'structural',
  },
  // Export claims
  {
    pattern: /(\w+)\s+is\s+(exported|public|private|protected)/gi,
    type: 'boolean',
    questionTemplate: (m) => `Is ${m[1]} ${m[2]}?`,
    claimType: 'structural',
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
// CORE FUNCTIONS
// ============================================================================

/**
 * Generate verification questions from a claim.
 *
 * Breaks down the claim into verifiable sub-claims and generates
 * specific questions that can be independently verified against context.
 *
 * @param claim - The claim to generate verification questions for
 * @returns Array of verification questions
 */
export function generateVerificationQuestions(claim: string): string[] {
  const questions: string[] = [];
  const seenQuestions = new Set<string>();

  for (const patternDef of CLAIM_PATTERNS) {
    const regex = new RegExp(patternDef.pattern.source, patternDef.pattern.flags);
    let match: RegExpExecArray | null;

    while ((match = regex.exec(claim)) !== null) {
      const question = patternDef.questionTemplate(match);
      const normalizedQuestion = question.toLowerCase().trim();

      if (!seenQuestions.has(normalizedQuestion)) {
        seenQuestions.add(normalizedQuestion);
        questions.push(question);
      }
    }
  }

  // If no pattern-based questions, generate general verification questions
  if (questions.length === 0) {
    // Extract key terms for general questions
    const keyTerms = extractKeyTerms(claim);
    if (keyTerms.length > 0) {
      questions.push(`Is the claim "${claim.slice(0, 100)}..." factually accurate?`);
      questions.push(`What evidence supports or contradicts this claim?`);
    }
  }

  return questions;
}

/**
 * Execute the full Chain-of-Verification process.
 *
 * @param claim - The original claim to verify
 * @param context - Context documents to verify against
 * @returns The complete verification result
 */
export function executeVerificationChain(claim: string, context: string): CoVeResult {
  const contextLines = context.split('\n').filter((line) => line.trim().length > 0);

  // Step 1: Generate verification questions
  const questions = generateVerificationQuestions(claim);

  // Step 2: Execute verification for each question
  const verificationChain: CoVeStep[] = questions.map((question) => {
    const { answer, confidence, sources } = answerVerificationQuestion(question, claim, contextLines);
    return {
      claim: extractSubClaim(claim, question),
      verificationQuestion: question,
      answer,
      confidence,
      sources,
    };
  });

  // Step 3: Compute overall verdict
  const { verdict, overallConfidence } = computeVerdict(verificationChain);

  // Step 4: Generate revisions
  const revisions = generateRevisions(claim, verificationChain);

  return {
    originalClaim: claim,
    verificationChain,
    finalVerdict: verdict,
    overallConfidence,
    revisions,
  };
}

/**
 * Revise a claim based on verification findings.
 *
 * @param claim - The original claim
 * @param result - The verification result
 * @returns The revised claim
 */
export function reviseBasedOnVerification(claim: string, result: CoVeResult): string {
  if (result.finalVerdict === 'verified') {
    return claim;
  }

  if (result.finalVerdict === 'refuted') {
    // Return the corrected version based on verification
    if (result.revisions.length > 0) {
      return result.revisions[0];
    }
    return `[Unverified] ${claim}`;
  }

  // Uncertain - add hedging
  const hedgePhrase = HEDGING_PHRASES[Math.floor(result.overallConfidence * HEDGING_PHRASES.length)];
  return `${hedgePhrase} ${claim.charAt(0).toLowerCase()}${claim.slice(1)}`;
}

/**
 * Integrate CoVe result with the epistemics system.
 *
 * Converts a CoVeResult into an Evidence object that can be
 * integrated with the broader epistemic framework.
 *
 * @param result - The CoVe verification result
 * @returns Evidence object for the epistemics system
 */
export function integrateWithEpistemics(result: CoVeResult): Evidence {
  // Build confidence value from verification chain
  const stepConfidences: ConfidenceValue[] = result.verificationChain.map((step) => ({
    type: 'derived' as const,
    value: step.confidence,
    formula: 'context_match_score',
    inputs: [],
  }));

  // Combine step confidences using sequence (min) for chain
  const combinedConfidence = stepConfidences.length > 0
    ? sequenceConfidence(stepConfidences)
    : absent('insufficient_data');

  return {
    id: `cove_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    type: 'cove_verification',
    claim: result.originalClaim,
    content: JSON.stringify({
      verdict: result.finalVerdict,
      overallConfidence: result.overallConfidence,
      verificationSteps: result.verificationChain.length,
      revisions: result.revisions,
    }),
    supports: result.finalVerdict === 'verified',
    confidence: combinedConfidence,
    source: {
      type: 'tool',
      id: 'chain_of_verification',
      version: '1.0.0',
    },
    timestamp: new Date().toISOString(),
    metadata: {
      verificationChain: result.verificationChain,
      revisions: result.revisions,
    },
  };
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Extract key terms from text.
 */
function extractKeyTerms(text: string): string[] {
  const stopWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'has', 'have', 'had',
    'does', 'do', 'did', 'what', 'how', 'many', 'which', 'that', 'this', 'it', 'and', 'or', 'but']);

  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2 && !stopWords.has(word));
}

/**
 * Answer a single verification question against context.
 */
function answerVerificationQuestion(
  question: string,
  originalClaim: string,
  context: string[]
): { answer: string; confidence: number; sources: string[] } {
  if (context.length === 0) {
    return {
      answer: 'Unable to verify - no context available',
      confidence: 0.1,
      sources: [],
    };
  }

  // Find relevant context lines
  const questionTerms = extractKeyTerms(question);
  const claimTerms = extractKeyTerms(originalClaim);
  const allTerms = Array.from(new Set([...questionTerms, ...claimTerms]));

  const relevantLines: Array<{ line: string; score: number }> = [];

  for (const line of context) {
    const lineLower = line.toLowerCase();
    const matchCount = allTerms.filter((term) => lineLower.includes(term)).length;
    if (matchCount > 0) {
      relevantLines.push({ line, score: matchCount / allTerms.length });
    }
  }

  // Sort by relevance
  relevantLines.sort((a, b) => b.score - a.score);

  if (relevantLines.length === 0) {
    return {
      answer: 'No relevant evidence found in context',
      confidence: 0.2,
      sources: [],
    };
  }

  // Build answer from top relevant lines
  const topLines = relevantLines.slice(0, 3);
  const avgScore = topLines.reduce((sum, l) => sum + l.score, 0) / topLines.length;
  const confidence = Math.min(0.95, 0.3 + avgScore * 0.7);

  const answer = determineAnswer(question, originalClaim, topLines.map((l) => l.line));

  return {
    answer,
    confidence,
    sources: topLines.map((l) => l.line.slice(0, 100)),
  };
}

/**
 * Determine the answer based on question type and context.
 */
function determineAnswer(question: string, claim: string, relevantContext: string[]): string {
  const questionLower = question.toLowerCase();
  const contextJoined = relevantContext.join(' ').toLowerCase();
  const claimLower = claim.toLowerCase();

  // Boolean questions
  if (questionLower.startsWith('is ') || questionLower.startsWith('does ')) {
    const claimTerms = extractKeyTerms(claimLower);
    const matchCount = claimTerms.filter((term) => contextJoined.includes(term)).length;
    const matchRatio = matchCount / Math.max(1, claimTerms.length);

    if (matchRatio >= 0.5) {
      return 'Yes, confirmed by context evidence';
    } else if (matchRatio >= 0.25) {
      return 'Partially confirmed - some evidence found';
    } else {
      return 'Not confirmed by available context';
    }
  }

  // Numeric questions
  if (questionLower.includes('how many')) {
    // Look for numbers in context
    const numberMatch = contextJoined.match(/(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+\w+/i);
    if (numberMatch) {
      const numWord = numberMatch[1].toLowerCase();
      const num = NUMERIC_WORDS[numWord] ?? parseInt(numWord, 10);
      if (!isNaN(num)) {
        return `${num} (found in context)`;
      }
    }
    return 'Unable to determine exact count from context';
  }

  // What/factual questions
  if (questionLower.startsWith('what ')) {
    // Return the most relevant context line as the answer
    if (relevantContext.length > 0) {
      return relevantContext[0].trim().slice(0, 200);
    }
    return 'No specific answer found in context';
  }

  // Default: return summary of relevant context
  return relevantContext.length > 0
    ? `Based on context: ${relevantContext[0].slice(0, 150)}...`
    : 'Unable to answer from available context';
}

/**
 * Extract the sub-claim that a question is targeting.
 */
function extractSubClaim(fullClaim: string, question: string): string {
  const questionTerms = extractKeyTerms(question);

  // Find the sentence in the claim that best matches the question
  const sentences = fullClaim.split(/[.!?]+/).filter((s) => s.trim().length > 0);

  let bestSentence = fullClaim;
  let bestScore = 0;

  for (const sentence of sentences) {
    const sentenceLower = sentence.toLowerCase();
    const matchCount = questionTerms.filter((term) => sentenceLower.includes(term)).length;
    if (matchCount > bestScore) {
      bestScore = matchCount;
      bestSentence = sentence.trim();
    }
  }

  return bestSentence;
}

/**
 * Compute the overall verdict from verification steps.
 */
function computeVerdict(chain: CoVeStep[]): { verdict: 'verified' | 'refuted' | 'uncertain'; overallConfidence: number } {
  if (chain.length === 0) {
    return { verdict: 'uncertain', overallConfidence: 0.5 };
  }

  const avgConfidence = chain.reduce((sum, step) => sum + step.confidence, 0) / chain.length;

  // Count how many steps have supporting evidence
  const supportingSteps = chain.filter((step) =>
    step.answer.toLowerCase().includes('yes') ||
    step.answer.toLowerCase().includes('confirmed') ||
    step.answer.toLowerCase().includes('found')
  ).length;

  const supportRatio = supportingSteps / chain.length;

  if (supportRatio >= 0.7 && avgConfidence >= 0.6) {
    return { verdict: 'verified', overallConfidence: avgConfidence };
  } else if (supportRatio <= 0.3 || avgConfidence <= 0.3) {
    return { verdict: 'refuted', overallConfidence: avgConfidence };
  } else {
    return { verdict: 'uncertain', overallConfidence: avgConfidence };
  }
}

/**
 * Generate revisions based on verification findings.
 */
function generateRevisions(originalClaim: string, chain: CoVeStep[]): string[] {
  const revisions: string[] = [];

  // Find steps that indicate corrections needed
  for (const step of chain) {
    if (step.answer.toLowerCase().includes('not confirmed') ||
        step.answer.toLowerCase().includes('no ') ||
        step.confidence < 0.4) {
      // Generate a revision suggestion
      const revision = `[Correction needed for: "${step.claim.slice(0, 50)}..."]`;
      revisions.push(revision);
    }
  }

  // If many corrections needed, suggest full revision
  if (revisions.length >= chain.length * 0.5) {
    revisions.unshift(`[Significant revision required] Original: "${originalClaim.slice(0, 100)}..."`);
  }

  return revisions;
}

// ============================================================================
// CHAIN-OF-VERIFICATION CLASS
// ============================================================================

/**
 * Chain-of-Verification class providing the complete verification pipeline.
 *
 * Implements the 4-step CoVe process:
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
    const baselineResponse = providedBaseline ?? await this.generateBaseline(query, context);

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
      const queryWords = queryLower.split(/\s+/).filter((w) => w.length > 3);
      const hasOverlap = queryWords.some((word) => lineLower.includes(word));
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
    const keyTerms = extractKeyTerms(questionLower + ' ' + claimLower);

    for (const line of context) {
      const lineLower = line.toLowerCase();
      const matchCount = keyTerms.filter((term) => lineLower.includes(term)).length;

      if (matchCount >= 1) {
        relevant.push(line);
      }
    }

    return relevant;
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
    _question: VerificationQuestion
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
    const keyTerms = extractKeyTerms(claimLower);
    const matchCount = keyTerms.filter((term) => contextLower.includes(term)).length;
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
    const sentences = context.split(/[.!?]+/).filter((s) => s.trim().length > 0);

    if (sentences.length === 0) {
      return 'No factual information found';
    }

    // Find most relevant sentence
    const questionTerms = extractKeyTerms(question.question);
    let bestSentence = sentences[0];
    let bestScore = 0;

    for (const sentence of sentences) {
      const sentenceLower = sentence.toLowerCase();
      const score = questionTerms.filter((term) => sentenceLower.includes(term)).length;
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
    const claimTerms = extractKeyTerms(claimLower);
    const answerTerms = extractKeyTerms(answerLower);

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
    const overlap = claimTerms.filter((term) => answerTerms.includes(term));
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
    const sentences = baseline.split(/[.!?]+/).filter((s) => s.trim().length > 0);
    const answerTerms = extractKeyTerms(answer.answer);

    for (const sentence of sentences) {
      const sentenceLower = sentence.toLowerCase();
      const matchCount = answerTerms.filter((term) => sentenceLower.includes(term)).length;
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
    const inconsistentAnswers = answers.filter((a) => !a.consistentWithBaseline);

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
      const updatedSentences = sentences.map((sentence) => {
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
    const answerTerms = extractKeyTerms(answer.answer);

    const updatedSentences = sentences.map((sentence) => {
      const sentenceLower = sentence.toLowerCase();
      const matchCount = answerTerms.filter((term) => sentenceLower.includes(term)).length;

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
    return HEDGING_PHRASES.some((phrase) => sentenceLower.includes(phrase));
  }

  /**
   * Calculate improvement metrics
   */
  private calculateImprovementMetrics(
    questions: VerificationQuestion[],
    answers: VerificationAnswer[],
    inconsistencies: Inconsistency[]
  ): VerificationResult['improvementMetrics'] {
    const claimsVerified = answers.filter((a) => a.consistentWithBaseline).length;
    const claimsRevised = inconsistencies.filter((i) => i.resolution === 'revised').length;

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
    const consistencyRate = answers.filter((a) => a.consistentWithBaseline).length / answers.length;

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

  /**
   * Convert a VerificationResult to a CoVeResult for the simplified API
   */
  toCoVeResult(verificationResult: VerificationResult): CoVeResult {
    const verificationChain: CoVeStep[] = verificationResult.verificationQuestions.map((q, i) => {
      const answer = verificationResult.verificationAnswers[i];
      return {
        claim: q.targetClaim,
        verificationQuestion: q.question,
        answer: answer?.answer ?? 'Unable to verify',
        confidence: answer?.confidence ?? 0.1,
        sources: answer?.sourceCitation ? [answer.sourceCitation] : [],
      };
    });

    const { verdict, overallConfidence } = computeVerdict(verificationChain);

    const revisions = verificationResult.inconsistencies
      .filter((i) => i.resolution === 'revised')
      .map((i) => `Revised: ${i.baselineClaim} -> ${i.verifiedClaim}`);

    return {
      originalClaim: verificationResult.baselineResponse,
      verificationChain,
      finalVerdict: verdict,
      overallConfidence,
      revisions,
    };
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
