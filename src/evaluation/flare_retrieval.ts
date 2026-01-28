/**
 * @fileoverview FLARE-Style Active Retrieval (WU-RET-002)
 *
 * Implements Forward-Looking Active REtrieval (FLARE) per EMNLP 2023.
 * Monitors token-level confidence during generation and triggers retrieval
 * when confidence drops below a configurable threshold.
 *
 * Key Features:
 * - Token-level confidence monitoring
 * - Configurable confidence threshold per domain
 * - Look-ahead window for proactive retrieval
 * - Minimum gap between retrievals to prevent thrashing
 * - Targeted query generation from low-confidence spans
 * - Seamless integration of retrieved content
 *
 * Research reference: "Active Retrieval Augmented Generation"
 * (Jiang et al., EMNLP 2023)
 *
 * @packageDocumentation
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Signal indicating confidence level at a specific token position.
 */
export interface ConfidenceSignal {
  /** Token position in the sequence (0-indexed) */
  position: number;
  /** The token text */
  token: string;
  /** Confidence score for this token (0.0 to 1.0) */
  confidence: number;
  /** Whether this position needs retrieval based on confidence */
  needsRetrieval: boolean;
  /** Position of last retrieval (optional, for gap tracking) */
  lastRetrievalPosition?: number;
}

/**
 * Configuration for active retrieval behavior.
 */
export interface ActiveRetrievalConfig {
  /** Confidence threshold below which retrieval is triggered (default: 0.5) */
  confidenceThreshold: number;
  /** Number of tokens to look ahead for confidence drops (default: 3) */
  windowSize: number;
  /** Minimum tokens between retrieval operations (default: 5) */
  minRetrievalGap: number;
}

/**
 * Default configuration with balanced parameters.
 *
 * - confidenceThreshold: 0.5 is a reasonable middle ground
 * - windowSize: 3 tokens provides moderate look-ahead
 * - minRetrievalGap: 5 tokens prevents retrieval thrashing
 */
export const DEFAULT_ACTIVE_RETRIEVAL_CONFIG: ActiveRetrievalConfig = {
  confidenceThreshold: 0.5,
  windowSize: 3,
  minRetrievalGap: 5,
};

// ============================================================================
// ACTIVE RETRIEVER CLASS
// ============================================================================

/**
 * Implements FLARE-style active retrieval with confidence monitoring.
 *
 * The retriever monitors token-level confidence during generation and
 * triggers retrieval when:
 * 1. Current token confidence drops below threshold
 * 2. Look-ahead window contains low-confidence tokens
 * 3. Minimum gap since last retrieval has been met
 *
 * This enables targeted, just-in-time retrieval that improves generation
 * quality without unnecessary retrieval overhead.
 */
export class ActiveRetriever {
  private readonly config: ActiveRetrievalConfig;

  /** Pattern for extracting identifiers from code */
  private static readonly IDENTIFIER_PATTERN = /\b([A-Z][a-zA-Z0-9_]*)\b/g;

  /** Pattern for extracting function/method names */
  private static readonly FUNCTION_PATTERN = /\b([a-z][a-zA-Z0-9_]*)\s*\(/g;

  /** Common stop words to filter from queries */
  private static readonly STOP_WORDS = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
    'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'that', 'this',
    'these', 'those', 'it', 'its', 'i', 'we', 'you', 'they', 'he', 'she',
  ]);

  /** Maximum query length in characters */
  private static readonly MAX_QUERY_LENGTH = 200;

  /**
   * Create a new ActiveRetriever with the given configuration.
   *
   * @param config - Optional partial configuration (merged with defaults)
   */
  constructor(config?: Partial<ActiveRetrievalConfig>) {
    this.config = { ...DEFAULT_ACTIVE_RETRIEVAL_CONFIG, ...config };
  }

  /**
   * Get the current configuration.
   *
   * @returns The active configuration
   */
  getConfig(): ActiveRetrievalConfig {
    return { ...this.config };
  }

  /**
   * Analyze token-level confidence and identify positions needing retrieval.
   *
   * For each token, determines whether its confidence is below the threshold
   * and marks it as needing retrieval accordingly.
   *
   * @param tokens - Array of token strings
   * @param confidences - Array of confidence values (0.0 to 1.0)
   * @returns Array of ConfidenceSignal objects for each token
   *
   * @example
   * ```typescript
   * const retriever = createActiveRetriever({ confidenceThreshold: 0.5 });
   * const signals = retriever.analyzeConfidence(
   *   ['The', 'function', 'parseConfig'],
   *   [0.95, 0.92, 0.45]
   * );
   * // signals[2].needsRetrieval === true (0.45 < 0.5)
   * ```
   */
  analyzeConfidence(tokens: string[], confidences: number[]): ConfidenceSignal[] {
    const signals: ConfidenceSignal[] = [];
    const length = Math.min(tokens.length, confidences.length);

    for (let i = 0; i < length; i++) {
      const confidence = confidences[i];
      // NaN comparisons are always false, so NaN < threshold is false
      // We want NaN to trigger retrieval, so we check explicitly
      const needsRetrieval = Number.isNaN(confidence) || confidence < this.config.confidenceThreshold;

      signals.push({
        position: i,
        token: tokens[i],
        confidence,
        needsRetrieval,
      });
    }

    return signals;
  }

  /**
   * Determine whether retrieval should be triggered at the current position.
   *
   * Considers:
   * 1. Whether the current position needs retrieval
   * 2. Whether any position in the look-ahead window needs retrieval
   * 3. Whether the minimum gap since last retrieval has been met
   *
   * @param signals - Array of ConfidenceSignal objects
   * @param currentPosition - Current generation position
   * @param lastRetrievalPosition - Position of last retrieval (optional)
   * @returns True if retrieval should be triggered
   *
   * @example
   * ```typescript
   * const signals = retriever.analyzeConfidence(tokens, confidences);
   * if (retriever.shouldRetrieve(signals, 5, 2)) {
   *   // Trigger retrieval at position 5
   * }
   * ```
   */
  shouldRetrieve(
    signals: ConfidenceSignal[],
    currentPosition: number,
    lastRetrievalPosition?: number
  ): boolean {
    // Handle edge cases
    if (signals.length === 0) {
      return false;
    }

    if (currentPosition < 0 || currentPosition >= signals.length) {
      return false;
    }

    // Check minimum gap constraint
    if (lastRetrievalPosition !== undefined) {
      const gap = currentPosition - lastRetrievalPosition;
      if (gap < this.config.minRetrievalGap) {
        return false;
      }
    }

    // Check current position
    if (signals[currentPosition].needsRetrieval) {
      return true;
    }

    // Check look-ahead window
    const windowEnd = Math.min(
      currentPosition + this.config.windowSize + 1,
      signals.length
    );

    for (let i = currentPosition + 1; i < windowEnd; i++) {
      if (signals[i].needsRetrieval) {
        return true;
      }
    }

    return false;
  }

  /**
   * Generate a targeted query for retrieval based on context and low-confidence span.
   *
   * Extracts relevant identifiers, class names, and function names from the
   * context and low-confidence span to form a focused retrieval query.
   *
   * @param context - The preceding text/context
   * @param lowConfidenceSpan - The text span with low confidence
   * @returns A targeted query string for retrieval
   *
   * @example
   * ```typescript
   * const query = retriever.generateQuery(
   *   'class UserService extends',
   *   'BaseRepository implements CrudOperations'
   * );
   * // Returns something like "UserService BaseRepository CrudOperations"
   * ```
   */
  generateQuery(context: string, lowConfidenceSpan: string): string {
    const terms: string[] = [];

    // Extract identifiers from context (PascalCase names)
    const contextIdentifiers = this.extractIdentifiers(context);
    terms.push(...contextIdentifiers);

    // Extract identifiers from low-confidence span
    const spanIdentifiers = this.extractIdentifiers(lowConfidenceSpan);
    terms.push(...spanIdentifiers);

    // Extract function names from context
    const contextFunctions = this.extractFunctionNames(context);
    terms.push(...contextFunctions);

    // Extract function names from low-confidence span
    const spanFunctions = this.extractFunctionNames(lowConfidenceSpan);
    terms.push(...spanFunctions);

    // If no identifiers found, extract keywords
    if (terms.length === 0) {
      const keywords = this.extractKeywords(context + ' ' + lowConfidenceSpan);
      terms.push(...keywords);
    }

    // Deduplicate and join
    const uniqueTerms = [...new Set(terms)];
    let query = uniqueTerms.join(' ');

    // Truncate if too long
    if (query.length > ActiveRetriever.MAX_QUERY_LENGTH) {
      query = query.slice(0, ActiveRetriever.MAX_QUERY_LENGTH);
      // Trim to last complete word
      const lastSpace = query.lastIndexOf(' ');
      if (lastSpace > 0) {
        query = query.slice(0, lastSpace);
      }
    }

    return query.trim();
  }

  /**
   * Integrate retrieved content into the original text at the specified position.
   *
   * Seamlessly inserts the retrieved content at the appropriate position,
   * maintaining readability and flow.
   *
   * @param original - The original text
   * @param retrieved - The retrieved content to integrate
   * @param position - Character position for integration
   * @returns The text with integrated retrieval
   *
   * @example
   * ```typescript
   * const result = retriever.integrateRetrieval(
   *   'The API endpoint',
   *   '/api/v1/users',
   *   16
   * );
   * // Returns "The API endpoint /api/v1/users"
   * ```
   */
  integrateRetrieval(original: string, retrieved: string, position: number): string {
    // Handle empty retrieved content
    if (!retrieved || retrieved.trim().length === 0) {
      return original;
    }

    const trimmedRetrieved = retrieved.trim();

    // Handle empty original
    if (!original || original.length === 0) {
      return trimmedRetrieved;
    }

    // Clamp position to valid range
    const safePosition = Math.max(0, Math.min(position, original.length));

    // Split original at position
    const before = original.slice(0, safePosition);
    const after = original.slice(safePosition);

    // Determine spacing
    const needsSpaceBefore = before.length > 0 && !before.endsWith(' ') && !before.endsWith('\n');
    const needsSpaceAfter = after.length > 0 && !after.startsWith(' ') && !after.startsWith('\n');

    // Build result
    let result = before;
    if (needsSpaceBefore) {
      result += ' ';
    }
    result += trimmedRetrieved;
    if (needsSpaceAfter) {
      result += ' ';
    }
    result += after;

    return result;
  }

  // ============================================================================
  // PRIVATE HELPER METHODS
  // ============================================================================

  /**
   * Extract PascalCase identifiers (class names, type names, etc.).
   */
  private extractIdentifiers(text: string): string[] {
    const identifiers: string[] = [];
    const pattern = new RegExp(ActiveRetriever.IDENTIFIER_PATTERN.source, 'g');
    let match;

    while ((match = pattern.exec(text)) !== null) {
      const identifier = match[1];
      if (!ActiveRetriever.STOP_WORDS.has(identifier.toLowerCase())) {
        identifiers.push(identifier);
      }
    }

    return identifiers;
  }

  /**
   * Extract function/method names (camelCase followed by parenthesis).
   */
  private extractFunctionNames(text: string): string[] {
    const functions: string[] = [];
    const pattern = new RegExp(ActiveRetriever.FUNCTION_PATTERN.source, 'g');
    let match;

    while ((match = pattern.exec(text)) !== null) {
      const funcName = match[1];
      if (!ActiveRetriever.STOP_WORDS.has(funcName.toLowerCase()) && funcName.length > 1) {
        functions.push(funcName);
      }
    }

    return functions;
  }

  /**
   * Extract keywords from text, filtering stop words.
   */
  private extractKeywords(text: string): string[] {
    // Clean text of special characters
    const cleaned = text
      .replace(/[<>{}()\[\]=;"'`]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const words = cleaned.split(' ');
    const keywords: string[] = [];

    for (const word of words) {
      const normalized = word.toLowerCase();
      if (
        word.length > 2 &&
        !ActiveRetriever.STOP_WORDS.has(normalized) &&
        /^[a-zA-Z]/.test(word)
      ) {
        keywords.push(word);
      }
    }

    return keywords.slice(0, 10); // Limit to top 10 keywords
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a new ActiveRetriever instance.
 *
 * @param config - Optional partial configuration (merged with defaults)
 * @returns A new ActiveRetriever instance
 *
 * @example
 * ```typescript
 * // Use default configuration
 * const retriever = createActiveRetriever();
 *
 * // Custom threshold for code domain
 * const codeRetriever = createActiveRetriever({
 *   confidenceThreshold: 0.4,
 *   windowSize: 5,
 * });
 * ```
 */
export function createActiveRetriever(
  config?: Partial<ActiveRetrievalConfig>
): ActiveRetriever {
  return new ActiveRetriever(config);
}
