/**
 * @fileoverview IRCoT (Interleaved Retrieval with Chain-of-Thought) (WU-RET-001)
 *
 * Implements interleaved retrieval with chain-of-thought reasoning for
 * multi-hop question answering. The system interleaves reasoning steps with
 * retrieval steps, dynamically fetching additional context when the reasoning
 * process requires it.
 *
 * Key features:
 * - Dynamic retrieval triggering based on reasoning needs
 * - Chain of thought tracking
 * - Multi-hop reasoning support
 * - Confidence-based stopping
 *
 * Research reference: "Interleaving Retrieval with Chain-of-Thought Reasoning
 * for Knowledge-Intensive Multi-Step Questions" (Trivedi et al., 2023)
 *
 * @packageDocumentation
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  type ConfidenceValue,
  absent,
  sequenceConfidence,
  bounded,
  deterministic,
  getNumericValue,
} from '../epistemics/confidence.js';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Input configuration for IRCoT retrieval
 */
export interface IRCoTInput {
  /** The question to answer */
  question: string;
  /** Optional initial context to start reasoning from */
  initialContext?: string[];
  /** Maximum number of reasoning hops to perform */
  maxHops: number;
  /** Confidence threshold below which retrieval is triggered (0.0 to 1.0) */
  retrievalThreshold: number;
}

/**
 * A single step in the reasoning chain
 */
export interface ReasoningStep {
  /** Step number (1-indexed) */
  stepNumber: number;
  /** The thought/reasoning for this step */
  thought: string;
  /** Whether this step triggered retrieval */
  needsRetrieval: boolean;
  /** The query used for retrieval (if retrieval was triggered) */
  retrievalQuery?: string;
  /** Context retrieved in this step (if any) */
  retrievedContext?: string[];
  /** Conclusion reached in this step (if any) */
  conclusion?: string;
}

/**
 * Output from IRCoT solving
 */
export interface IRCoTOutput {
  /** The original question */
  question: string;
  /** The synthesized answer */
  answer: string;
  /** The full reasoning chain */
  reasoningChain: ReasoningStep[];
  /** Total number of retrieval operations performed */
  totalRetrievals: number;
  /** The accumulated context at the end */
  finalContext: string[];
  /** Confidence in the answer */
  confidence: ConfidenceValue;
  /** Number of reasoning hops used */
  hopsUsed: number;
}

/**
 * Decision about whether to perform retrieval
 */
export interface RetrievalDecision {
  /** Whether to perform retrieval */
  shouldRetrieve: boolean;
  /** Reason for the decision */
  reason: string;
  /** The query to use for retrieval (if shouldRetrieve is true) */
  query?: string;
  /** Expected information gain from retrieval (0.0 to 1.0) */
  expectedInfoGain: number;
}

/**
 * Configuration for IRCoT retrieval
 */
export interface IRCoTConfig {
  /** Maximum number of reasoning hops (default: 5) */
  maxHops: number;
  /** Confidence threshold for triggering retrieval (default: 0.5) */
  retrievalThreshold: number;
  /** Maximum context items to retrieve per step (default: 10) */
  maxRetrievalItems: number;
  /** Repository path for retrieval (default: current working directory) */
  repoPath?: string;
}

/**
 * Default configuration for IRCoT
 */
export const DEFAULT_IRCOT_CONFIG: IRCoTConfig = {
  maxHops: 5,
  retrievalThreshold: 0.5,
  maxRetrievalItems: 10,
};

// ============================================================================
// IRCOT RETRIEVER CLASS
// ============================================================================

/**
 * Implements Interleaved Retrieval with Chain-of-Thought reasoning.
 *
 * The retriever interleaves reasoning steps with retrieval steps:
 * 1. Generate a thought based on the question and current context
 * 2. Decide whether retrieval is needed based on the thought
 * 3. If needed, retrieve additional context
 * 4. Continue reasoning until answer is found or maxHops is reached
 * 5. Synthesize the final answer from the reasoning chain
 */
export class IRCoTRetriever {
  private config: IRCoTConfig;
  private repoPath: string;

  /** Keywords indicating need for more information */
  private static readonly RETRIEVAL_INDICATORS = [
    'need to find',
    'need to know',
    'need more information',
    'where is',
    'what is',
    'how does',
    'unclear',
    'unknown',
    'not sure',
    'cannot determine',
    'looking for',
    'searching for',
    'missing',
    'require',
    'requires',
  ];

  /** Keywords indicating sufficient information */
  private static readonly SUFFICIENT_INDICATORS = [
    'based on the context',
    'according to',
    'clearly',
    'shows that',
    'indicates that',
    'the answer is',
    'we can conclude',
    'therefore',
    'thus',
    'found that',
    'confirms',
  ];

  /** Common code file extensions to search */
  private static readonly CODE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

  constructor(config?: Partial<IRCoTConfig>) {
    this.config = { ...DEFAULT_IRCOT_CONFIG, ...config };
    this.repoPath = this.config.repoPath || process.cwd();
  }

  /**
   * Solve a question using interleaved retrieval and chain-of-thought reasoning.
   *
   * @param input - The IRCoT input configuration
   * @returns The IRCoT output with answer and reasoning chain
   */
  async solve(input: IRCoTInput): Promise<IRCoTOutput> {
    const { question, initialContext = [], maxHops, retrievalThreshold } = input;

    const reasoningChain: ReasoningStep[] = [];
    let currentContext = [...initialContext];
    let totalRetrievals = 0;
    let hopsUsed = 0;

    // Handle edge cases
    if (maxHops <= 0) {
      return this.createOutput(question, currentContext, reasoningChain, totalRetrievals, 0);
    }

    // Handle retrieval threshold of 1 (never retrieve)
    const effectiveThreshold = retrievalThreshold >= 1 ? Infinity : retrievalThreshold;

    // Main reasoning loop
    for (let hop = 0; hop < maxHops; hop++) {
      hopsUsed++;

      // Step 1: Generate a thought
      const thought = await this.generateThought(question, currentContext, reasoningChain);

      // Step 2: Decide whether to retrieve
      const decision = this.decideRetrieval(thought, currentContext);

      // Create reasoning step
      const step: ReasoningStep = {
        stepNumber: hop + 1,
        thought,
        needsRetrieval: decision.shouldRetrieve && decision.expectedInfoGain > effectiveThreshold,
      };

      // Step 3: Execute retrieval if needed
      if (step.needsRetrieval && decision.query) {
        step.retrievalQuery = decision.query;
        const retrievedContext = await this.executeRetrieval(decision.query);
        step.retrievedContext = retrievedContext;
        currentContext = [...currentContext, ...retrievedContext];
        totalRetrievals++;
      }

      // Step 4: Generate conclusion for this step
      step.conclusion = this.generateConclusion(thought, step.retrievedContext);

      reasoningChain.push(step);

      // Check if we can stop early (high confidence in answer)
      if (this.shouldStopEarly(step, currentContext, question)) {
        break;
      }
    }

    return this.createOutput(question, currentContext, reasoningChain, totalRetrievals, hopsUsed);
  }

  /**
   * Generate a thought based on the question, context, and reasoning history.
   *
   * @param question - The question being answered
   * @param context - Current accumulated context
   * @param history - Previous reasoning steps
   * @returns The generated thought
   */
  async generateThought(
    question: string,
    context: string[],
    history: ReasoningStep[]
  ): Promise<string> {
    // Build thought based on available information
    const questionLower = question.toLowerCase();

    // Check if context addresses the question
    const relevantContext = context.filter((c) =>
      this.isContextRelevant(c, question)
    );

    // Generate thought based on context availability
    if (context.length === 0) {
      return this.generateNoContextThought(question);
    }

    if (relevantContext.length === 0) {
      return this.generateIrrelevantContextThought(question, context);
    }

    // Build on previous reasoning if available
    if (history.length > 0) {
      return this.generateContinuationThought(question, relevantContext, history);
    }

    return this.generateInitialThought(question, relevantContext);
  }

  /**
   * Decide whether to perform retrieval based on the current thought and context.
   *
   * @param thought - The current thought
   * @param context - Current accumulated context
   * @returns The retrieval decision
   */
  decideRetrieval(thought: string, context: string[]): RetrievalDecision {
    const thoughtLower = thought.toLowerCase();

    // Check for retrieval indicators
    const hasRetrievalIndicators = IRCoTRetriever.RETRIEVAL_INDICATORS.some((indicator) =>
      thoughtLower.includes(indicator)
    );

    // Check for sufficient indicators
    const hasSufficientIndicators = IRCoTRetriever.SUFFICIENT_INDICATORS.some((indicator) =>
      thoughtLower.includes(indicator)
    );

    // Calculate expected information gain
    let expectedInfoGain = 0.5; // Base expectation

    if (hasRetrievalIndicators && !hasSufficientIndicators) {
      expectedInfoGain = 0.8;
    } else if (hasSufficientIndicators && !hasRetrievalIndicators) {
      expectedInfoGain = 0.2;
    } else if (context.length === 0) {
      expectedInfoGain = 0.9; // High gain expected when no context
    }

    // Extract query from thought
    const query = this.extractQueryFromThought(thought);

    // Decide based on indicators and context
    const shouldRetrieve =
      (hasRetrievalIndicators || context.length === 0) && !hasSufficientIndicators;

    const reason = shouldRetrieve
      ? hasRetrievalIndicators
        ? 'Thought indicates need for additional information'
        : 'No context available, retrieval needed'
      : hasSufficientIndicators
        ? 'Context appears sufficient based on reasoning'
        : 'Current context may be adequate';

    return {
      shouldRetrieve,
      reason,
      query: shouldRetrieve ? query : undefined,
      expectedInfoGain,
    };
  }

  /**
   * Execute retrieval for a given query.
   *
   * @param query - The retrieval query
   * @returns Array of retrieved context strings
   */
  async executeRetrieval(query: string): Promise<string[]> {
    if (!query || query.trim().length === 0) {
      return [];
    }

    const results: string[] = [];
    const terms = this.extractSearchTerms(query);

    if (terms.length === 0) {
      return [];
    }

    try {
      // Search for matching files
      const matchingFiles = await this.searchFiles(terms, this.repoPath);

      // Extract context from matching files
      for (const file of matchingFiles.slice(0, this.config.maxRetrievalItems)) {
        const contextItems = await this.extractContextFromFile(file, terms);
        results.push(...contextItems);
      }
    } catch {
      // Return empty results on error
    }

    return results.slice(0, this.config.maxRetrievalItems);
  }

  /**
   * Synthesize an answer from the reasoning chain.
   *
   * @param chain - The reasoning chain
   * @returns The synthesized answer
   */
  synthesizeAnswer(chain: ReasoningStep[]): string {
    if (chain.length === 0) {
      return 'Unable to answer the question - no reasoning steps were performed.';
    }

    // Collect all conclusions
    const conclusions = chain
      .filter((step) => step.conclusion)
      .map((step) => step.conclusion!);

    if (conclusions.length === 0) {
      // Use the last thought as the answer
      const lastStep = chain[chain.length - 1];
      return lastStep.thought || 'Unable to synthesize an answer from the reasoning chain.';
    }

    // Combine conclusions into an answer
    if (conclusions.length === 1) {
      return conclusions[0];
    }

    // Multiple conclusions - combine them
    return `Based on the analysis: ${conclusions.join('. ')}.`;
  }

  // ============================================================================
  // PRIVATE HELPER METHODS
  // ============================================================================

  /**
   * Create the output structure from the reasoning process.
   */
  private createOutput(
    question: string,
    finalContext: string[],
    reasoningChain: ReasoningStep[],
    totalRetrievals: number,
    hopsUsed: number
  ): IRCoTOutput {
    const answer = this.synthesizeAnswer(reasoningChain);
    const confidence = this.computeConfidence(reasoningChain, finalContext);

    return {
      question,
      answer,
      reasoningChain,
      totalRetrievals,
      finalContext,
      confidence,
      hopsUsed,
    };
  }

  /**
   * Compute confidence based on the reasoning chain and context.
   */
  private computeConfidence(chain: ReasoningStep[], context: string[]): ConfidenceValue {
    if (chain.length === 0) {
      return absent('insufficient_data');
    }

    // Build confidence from multiple factors
    const factors: ConfidenceValue[] = [];

    // Factor 1: Context coverage
    if (context.length > 0) {
      const contextCoverage = Math.min(1, context.length / 10);
      factors.push(
        bounded(
          contextCoverage * 0.5,
          contextCoverage,
          'theoretical',
          'context_coverage_ratio'
        )
      );
    }

    // Factor 2: Reasoning depth
    const depthFactor = Math.min(1, chain.length / 5);
    factors.push(
      bounded(
        depthFactor * 0.3,
        depthFactor,
        'theoretical',
        'reasoning_depth_ratio'
      )
    );

    // Factor 3: Conclusion quality
    const conclusionsCount = chain.filter((s) => s.conclusion).length;
    const conclusionQuality = chain.length > 0 ? conclusionsCount / chain.length : 0;
    factors.push(
      bounded(
        conclusionQuality * 0.4,
        conclusionQuality,
        'theoretical',
        'conclusion_quality_ratio'
      )
    );

    // Factor 4: Retrieval success
    const retrievalSteps = chain.filter((s) => s.needsRetrieval);
    if (retrievalSteps.length > 0) {
      const successfulRetrievals = retrievalSteps.filter(
        (s) => s.retrievedContext && s.retrievedContext.length > 0
      ).length;
      const retrievalSuccess = successfulRetrievals / retrievalSteps.length;
      factors.push(
        bounded(
          retrievalSuccess * 0.5,
          retrievalSuccess,
          'theoretical',
          'retrieval_success_ratio'
        )
      );
    }

    // Combine factors
    if (factors.length === 0) {
      return absent('insufficient_data');
    }

    return sequenceConfidence(factors);
  }

  /**
   * Check if context is relevant to the question.
   */
  private isContextRelevant(context: string, question: string): boolean {
    const contextLower = context.toLowerCase();
    const questionTerms = this.extractSearchTerms(question);

    return questionTerms.some((term) => contextLower.includes(term.toLowerCase()));
  }

  /**
   * Generate thought when no context is available.
   */
  private generateNoContextThought(question: string): string {
    return `To answer the question "${question}", I need to find relevant information. ` +
      'No context is currently available, so I need to search for relevant code and documentation.';
  }

  /**
   * Generate thought when context is not relevant.
   */
  private generateIrrelevantContextThought(question: string, context: string[]): string {
    return `The current context (${context.length} items) does not directly address the question "${question}". ` +
      'I need to find more specific information.';
  }

  /**
   * Generate thought continuing from previous reasoning.
   */
  private generateContinuationThought(
    question: string,
    relevantContext: string[],
    history: ReasoningStep[]
  ): string {
    const lastStep = history[history.length - 1];
    const contextSummary = relevantContext.slice(0, 3).join('; ');

    if (lastStep.conclusion) {
      return `Building on the previous finding that ${lastStep.conclusion}, ` +
        `and considering the context: ${contextSummary}. ` +
        `Now analyzing to answer: ${question}`;
    }

    return `Continuing analysis with ${relevantContext.length} relevant context items. ` +
      `Context: ${contextSummary}. Question: ${question}`;
  }

  /**
   * Generate initial thought with context.
   */
  private generateInitialThought(question: string, relevantContext: string[]): string {
    const contextSummary = relevantContext.slice(0, 3).join('; ');

    return `Based on the available context (${contextSummary}), ` +
      `I am analyzing to answer: ${question}`;
  }

  /**
   * Generate a conclusion from a thought and retrieved context.
   */
  private generateConclusion(thought: string, retrievedContext?: string[]): string {
    // Look for factual statements in the thought
    const factPatterns = [
      /is defined in ([^.]+)/i,
      /has (?:a )?method[s]? (?:called )?([^.]+)/i,
      /extends ([^.]+)/i,
      /implements ([^.]+)/i,
      /returns ([^.]+)/i,
      /contains ([^.]+)/i,
    ];

    for (const pattern of factPatterns) {
      const match = thought.match(pattern);
      if (match) {
        return thought;
      }
    }

    // If retrieved context, summarize finding
    if (retrievedContext && retrievedContext.length > 0) {
      return `Found relevant information: ${retrievedContext[0]}`;
    }

    // Default conclusion from thought
    if (thought.includes('conclude') || thought.includes('therefore') || thought.includes('thus')) {
      return thought;
    }

    return `Analysis step completed: ${thought.slice(0, 100)}...`;
  }

  /**
   * Extract a retrieval query from a thought.
   */
  private extractQueryFromThought(thought: string): string {
    // Look for explicit search targets
    const patterns = [
      /(?:find|looking for|search for|need to know about)\s+(?:the\s+)?([^.]+)/i,
      /where (?:is|are)\s+(?:the\s+)?([^?]+)/i,
      /what (?:is|are|does)\s+(?:the\s+)?([^?]+)/i,
      /how does\s+(?:the\s+)?([^?]+)/i,
    ];

    for (const pattern of patterns) {
      const match = thought.match(pattern);
      if (match) {
        return match[1].trim();
      }
    }

    // Extract key terms from the thought
    const terms = this.extractSearchTerms(thought);
    return terms.slice(0, 5).join(' ');
  }

  /**
   * Extract search terms from a query string.
   */
  private extractSearchTerms(query: string): string[] {
    // Remove special characters and split
    const cleaned = query
      .replace(/[`'"()[\]{}?!@#$%^&*]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const words = cleaned.split(' ').filter((w) => w.length > 1);

    // Filter out stop words
    const stopWords = new Set([
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
      'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
      'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
      'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'find', 'how',
      'what', 'where', 'when', 'why', 'which', 'who', 'that', 'this', 'these',
      'those', 'i', 'we', 'you', 'it', 'they', 'search', 'looking', 'about',
    ]);

    return words.filter((w) => !stopWords.has(w.toLowerCase()));
  }

  /**
   * Search for files matching the given terms.
   */
  private async searchFiles(terms: string[], repoPath: string): Promise<string[]> {
    const matchingFiles: Map<string, number> = new Map();

    const walkDir = (dir: string): void => {
      try {
        if (!fs.existsSync(dir)) {
          return;
        }

        const entries = fs.readdirSync(dir, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);

          // Skip common non-code directories
          if (entry.isDirectory()) {
            if (
              !entry.name.startsWith('.') &&
              entry.name !== 'node_modules' &&
              entry.name !== 'dist' &&
              entry.name !== 'build' &&
              entry.name !== 'coverage'
            ) {
              walkDir(fullPath);
            }
          } else if (entry.isFile() && this.isCodeFile(entry.name)) {
            // Score file based on term matches
            const score = this.scoreFile(fullPath, terms);
            if (score > 0) {
              matchingFiles.set(fullPath, score);
            }
          }
        }
      } catch {
        // Skip directories that can't be accessed
      }
    };

    walkDir(repoPath);

    // Sort by score and return top matches
    return Array.from(matchingFiles.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([file]) => file)
      .slice(0, 20);
  }

  /**
   * Score a file based on term matches.
   */
  private scoreFile(filePath: string, terms: string[]): number {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const contentLower = content.toLowerCase();
      const fileNameLower = path.basename(filePath).toLowerCase();
      let score = 0;

      for (const term of terms) {
        const termLower = term.toLowerCase();

        // Filename match (higher weight)
        if (fileNameLower.includes(termLower)) {
          score += 5;
        }

        // Content match
        const matches = (contentLower.match(new RegExp(this.escapeRegex(termLower), 'g')) || []).length;
        score += Math.min(matches, 10);
      }

      return score;
    } catch {
      return 0;
    }
  }

  /**
   * Extract context from a file based on search terms.
   */
  private async extractContextFromFile(filePath: string, terms: string[]): Promise<string[]> {
    const results: string[] = [];

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      const fileName = path.relative(this.repoPath, filePath);

      // Find lines with term matches
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineLower = line.toLowerCase();

        for (const term of terms) {
          if (lineLower.includes(term.toLowerCase())) {
            // Extract context around the match
            const startLine = Math.max(0, i - 1);
            const endLine = Math.min(lines.length, i + 3);
            const snippet = lines.slice(startLine, endLine).join('\n').trim();

            if (snippet.length > 0) {
              results.push(`[${fileName}:${i + 1}] ${snippet}`);
            }
            break;
          }
        }
      }
    } catch {
      // Skip files that can't be read
    }

    return results.slice(0, 5); // Limit per file
  }

  /**
   * Check if early stopping is appropriate.
   */
  private shouldStopEarly(
    step: ReasoningStep,
    context: string[],
    question: string
  ): boolean {
    // Stop if we have a strong conclusion
    if (step.conclusion) {
      const conclusionLower = step.conclusion.toLowerCase();
      const hasStrongIndicator = IRCoTRetriever.SUFFICIENT_INDICATORS.some((indicator) =>
        conclusionLower.includes(indicator)
      );
      if (hasStrongIndicator && context.length > 0) {
        return true;
      }
    }

    // Stop if we have substantial context and no retrieval needed
    if (!step.needsRetrieval && context.length >= 3) {
      return true;
    }

    // Stop if context directly addresses the question
    if (context.length > 0) {
      const questionTerms = this.extractSearchTerms(question);
      const contextText = context.join(' ').toLowerCase();
      const questionLower = question.toLowerCase();

      // Check if key question terms appear in context
      const matchedTerms = questionTerms.filter(
        (term) => contextText.includes(term.toLowerCase())
      );

      // If most question terms are in context, we likely have the answer
      if (questionTerms.length > 0 && matchedTerms.length >= questionTerms.length * 0.6) {
        // Also check if context seems conclusive
        const thoughtLower = step.thought.toLowerCase();
        const isConclusive =
          thoughtLower.includes('based on') ||
          thoughtLower.includes('analyzing') ||
          thoughtLower.includes('the context') ||
          !step.needsRetrieval;

        if (isConclusive) {
          return true;
        }
      }
    }

    // Stop if no retrieval needed and we already have context
    if (!step.needsRetrieval && context.length >= 1) {
      return true;
    }

    return false;
  }

  /**
   * Check if a filename is a code file.
   */
  private isCodeFile(filename: string): boolean {
    return IRCoTRetriever.CODE_EXTENSIONS.some((ext) => filename.endsWith(ext));
  }

  /**
   * Escape regex special characters.
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a new IRCoTRetriever instance.
 *
 * @param config - Optional configuration overrides
 * @returns A new IRCoTRetriever instance
 */
export function createIRCoTRetriever(config?: Partial<IRCoTConfig>): IRCoTRetriever {
  return new IRCoTRetriever(config);
}
