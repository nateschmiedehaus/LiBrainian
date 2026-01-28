/**
 * @fileoverview Atomic Claim Decomposition (WU-CAL-001)
 *
 * Breaks responses into atomic facts per FActScore/SAFE approach for calibration.
 * This enables more precise evaluation of claim accuracy by ensuring each claim
 * contains exactly one verifiable statement.
 *
 * Atomic claim characteristics:
 * - Contains exactly one verifiable statement
 * - Cannot be split further without losing meaning
 * - Has clear truth conditions
 *
 * @packageDocumentation
 */

import { randomUUID } from 'crypto';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Type of claim based on its nature
 */
export type ClaimType = 'factual' | 'procedural' | 'evaluative' | 'definitional';

/**
 * An atomic claim that cannot be further decomposed
 */
export interface AtomicClaim {
  /** Unique identifier for this claim */
  id: string;
  /** The content of the atomic claim */
  content: string;
  /** Parent claim ID if this was split from a compound claim */
  parentClaimId?: string;
  /** Type of claim */
  type: ClaimType;
  /** Confidence that this is a valid atomic claim (0-1) */
  confidence: number;
  /** Source span in original text */
  sourceSpan: { start: number; end: number };
}

/**
 * Statistics about decomposition
 */
export interface DecompositionStats {
  /** Total claims processed */
  total: number;
  /** Number of atomic claims (not split) */
  atomic: number;
  /** Number of composite claims (were split) */
  composite: number;
}

/**
 * Configuration for the claim decomposer
 */
export interface ClaimDecomposerConfig {
  /** Maximum length for an atomic claim */
  maxClaimLength: number;
  /** Minimum length for a valid claim */
  minClaimLength: number;
  /** Whether to split on conjunctions (and, but, also) */
  splitOnConjunctions: boolean;
  /** Whether to split causal chains (because, therefore, since) */
  splitCausalChains: boolean;
}

/**
 * Interface for the claim decomposer
 */
export interface ClaimDecomposer {
  /**
   * Decompose text into atomic claims
   * @param text - The text to decompose
   * @returns Array of atomic claims
   */
  decompose(text: string): Promise<AtomicClaim[]>;

  /**
   * Decompose a code response with explanation into atomic claims
   * @param code - The code snippet
   * @param explanation - The explanation text
   * @returns Array of atomic claims
   */
  decomposeCodeResponse(code: string, explanation: string): Promise<AtomicClaim[]>;

  /**
   * Check if a claim is atomic (cannot be further split)
   * @param claim - The claim text to check
   * @returns True if the claim is atomic
   */
  isAtomic(claim: string): boolean;

  /**
   * Get statistics about decomposition operations
   * @returns Decomposition statistics
   */
  getDecompositionStats(): DecompositionStats;
}

// ============================================================================
// DEFAULT CONFIGURATION
// ============================================================================

/**
 * Default configuration for claim decomposition
 */
export const DEFAULT_DECOMPOSER_CONFIG: ClaimDecomposerConfig = {
  maxClaimLength: 150,
  minClaimLength: 5,
  splitOnConjunctions: true,
  splitCausalChains: true,
};

// ============================================================================
// PATTERNS FOR DECOMPOSITION
// ============================================================================

/**
 * Compound nouns that should NOT be split
 */
const COMPOUND_NOUNS = [
  'input and output',
  'read and write',
  'request and response',
  'get and set',
  'push and pull',
  'lock and unlock',
  'open and close',
  'start and stop',
  'begin and end',
  'create and delete',
  'add and remove',
  'show and hide',
  'enable and disable',
  'encode and decode',
  'encrypt and decrypt',
  'serialize and deserialize',
  'load and save',
  'import and export',
  'client and server',
  'source and destination',
  'before and after',
  'true and false',
  'yes and no',
  'pro and con',
];

/**
 * Conjunction patterns for splitting compound claims
 */
const CONJUNCTION_PATTERNS = [
  { pattern: /\s+and\s+(?:also\s+)?/i, type: 'and' as const },
  { pattern: /\s+but\s+(?:also\s+)?/i, type: 'but' as const },
  { pattern: /\.\s*(?:It\s+)?also\s+/i, type: 'also' as const },
  { pattern: /\s+as\s+well\s+as\s+/i, type: 'as_well_as' as const },
  { pattern: /,\s+and\s+/i, type: 'comma_and' as const },
];

/**
 * Causal chain patterns for splitting
 */
const CAUSAL_PATTERNS = [
  { pattern: /\s+because\s+/i, type: 'because' as const },
  { pattern: /,?\s+therefore\s+/i, type: 'therefore' as const },
  { pattern: /^since\s+/i, type: 'since' as const },
  { pattern: /,?\s+since\s+/i, type: 'since_mid' as const },
  { pattern: /\s+so\s+that\s+/i, type: 'so_that' as const },
  { pattern: /,?\s+which\s+causes?\s+/i, type: 'which_causes' as const },
  { pattern: /,?\s+resulting\s+in\s+/i, type: 'resulting_in' as const },
];

/**
 * Procedural indicators
 */
const PROCEDURAL_INDICATORS = [
  'first',
  'then',
  'next',
  'after',
  'before',
  'finally',
  'subsequently',
  'step',
  'when',
  'while',
  'during',
];

/**
 * Evaluative indicators (subjective claims)
 */
const EVALUATIVE_INDICATORS = [
  'good',
  'bad',
  'best',
  'worst',
  'better',
  'efficient',
  'inefficient',
  'well-designed',
  'poorly-designed',
  'elegant',
  'clean',
  'messy',
  'simple',
  'complex',
  'easy',
  'difficult',
  'fast',
  'slow',
  'optimal',
  'recommended',
  'preferred',
  'should',
  'ought',
];

/**
 * Definitional indicators
 */
const DEFINITIONAL_INDICATORS = ['is a', 'is an', 'is the', 'are', 'defines', 'represents', 'means', 'refers to'];

// ============================================================================
// CLAIM DECOMPOSER IMPLEMENTATION
// ============================================================================

/**
 * Implementation of the ClaimDecomposer interface
 */
class ClaimDecomposerImpl implements ClaimDecomposer {
  private config: ClaimDecomposerConfig;
  private stats: DecompositionStats;

  constructor(config?: Partial<ClaimDecomposerConfig>) {
    this.config = { ...DEFAULT_DECOMPOSER_CONFIG, ...config };
    this.stats = { total: 0, atomic: 0, composite: 0 };
  }

  async decompose(text: string): Promise<AtomicClaim[]> {
    if (!text || text.trim().length === 0) {
      return [];
    }

    const claims: AtomicClaim[] = [];

    // Step 1: Split into sentences/segments
    const segments = this.splitIntoSegments(text);

    // Step 2: Process each segment
    for (const segment of segments) {
      const segmentClaims = this.decomposeSegment(segment.text, segment.start, undefined);
      claims.push(...segmentClaims);
    }

    // Update stats
    this.stats.total += claims.length;
    for (const claim of claims) {
      if (this.isAtomic(claim.content)) {
        this.stats.atomic++;
      } else {
        this.stats.composite++;
      }
    }

    return claims;
  }

  async decomposeCodeResponse(code: string, explanation: string): Promise<AtomicClaim[]> {
    const claims: AtomicClaim[] = [];

    // Decompose the explanation text
    if (explanation && explanation.trim().length > 0) {
      const explanationClaims = await this.decompose(explanation);
      claims.push(...explanationClaims);
    }

    // Extract claims from code structure (if code is provided)
    if (code && code.trim().length > 0) {
      const codeClaims = this.extractCodeClaims(code);
      claims.push(...codeClaims);
    }

    return claims;
  }

  isAtomic(claim: string): boolean {
    if (!claim || claim.trim().length === 0) {
      return false;
    }

    const trimmed = claim.trim();

    // Too long claims are not atomic
    if (trimmed.length > this.config.maxClaimLength) {
      return false;
    }

    // Check for compound nouns (these should NOT cause splitting)
    const lowerClaim = trimmed.toLowerCase();
    for (const compound of COMPOUND_NOUNS) {
      if (lowerClaim.includes(compound)) {
        // This conjunction is part of a compound noun, so it's still atomic
        // unless there are OTHER conjunctions
        const withoutCompound = lowerClaim.replace(compound, '___COMPOUND___');
        if (!this.hasConjunctions(withoutCompound) && !this.hasCausalPatterns(withoutCompound)) {
          return true;
        }
      }
    }

    // Check for conjunction patterns
    if (this.config.splitOnConjunctions && this.hasConjunctions(lowerClaim)) {
      return false;
    }

    // Check for causal patterns
    if (this.config.splitCausalChains && this.hasCausalPatterns(lowerClaim)) {
      return false;
    }

    return true;
  }

  getDecompositionStats(): DecompositionStats {
    return { ...this.stats };
  }

  // ============================================================================
  // PRIVATE HELPER METHODS
  // ============================================================================

  private hasConjunctions(text: string): boolean {
    for (const conj of CONJUNCTION_PATTERNS) {
      if (conj.pattern.test(text)) {
        return true;
      }
    }
    return false;
  }

  private hasCausalPatterns(text: string): boolean {
    for (const causal of CAUSAL_PATTERNS) {
      if (causal.pattern.test(text)) {
        return true;
      }
    }
    return false;
  }

  private splitIntoSegments(text: string): Array<{ text: string; start: number }> {
    const segments: Array<{ text: string; start: number }> = [];

    // First, handle bullet points and numbered lists
    const listPattern = /(?:^|\n)\s*(?:[-*]|\d+\.)\s+([^\n]+)/g;
    let listMatch;
    const listItems: Array<{ text: string; start: number; end: number }> = [];

    while ((listMatch = listPattern.exec(text)) !== null) {
      listItems.push({
        text: listMatch[1].trim(),
        start: listMatch.index,
        end: listMatch.index + listMatch[0].length,
      });
    }

    // If we found list items, process them separately
    if (listItems.length > 0) {
      let lastEnd = 0;

      for (const item of listItems) {
        // Process text before this list item as regular text
        if (item.start > lastEnd) {
          const beforeText = text.slice(lastEnd, item.start);
          const beforeSegments = this.splitIntoSentences(beforeText, lastEnd);
          segments.push(...beforeSegments);
        }

        // Add the list item as a segment
        segments.push({
          text: item.text,
          start: item.start,
        });

        lastEnd = item.end;
      }

      // Process remaining text
      if (lastEnd < text.length) {
        const afterText = text.slice(lastEnd);
        const afterSegments = this.splitIntoSentences(afterText, lastEnd);
        segments.push(...afterSegments);
      }

      return segments;
    }

    // No list items, split by sentences
    return this.splitIntoSentences(text, 0);
  }

  private splitIntoSentences(text: string, baseOffset: number): Array<{ text: string; start: number }> {
    const segments: Array<{ text: string; start: number }> = [];

    // Split on sentence boundaries
    const sentencePattern = /[^.!?]+[.!?]+/g;
    let match;
    let lastIndex = 0;

    while ((match = sentencePattern.exec(text)) !== null) {
      const sentence = match[0].trim();
      if (sentence.length >= this.config.minClaimLength) {
        segments.push({
          text: sentence,
          start: baseOffset + match.index,
        });
      }
      lastIndex = match.index + match[0].length;
    }

    // Handle remaining text without sentence ending
    const remaining = text.slice(lastIndex).trim();
    if (remaining.length >= this.config.minClaimLength) {
      segments.push({
        text: remaining,
        start: baseOffset + lastIndex,
      });
    }

    return segments;
  }

  private decomposeSegment(text: string, startOffset: number, parentId: string | undefined): AtomicClaim[] {
    const claims: AtomicClaim[] = [];
    const trimmed = text.trim();

    if (trimmed.length < this.config.minClaimLength) {
      return claims;
    }

    // Check if already atomic
    if (this.isAtomic(trimmed)) {
      claims.push(this.createClaim(trimmed, startOffset, parentId));
      return claims;
    }

    // Try splitting on conjunctions first
    if (this.config.splitOnConjunctions) {
      const conjSplit = this.splitOnConjunction(trimmed, startOffset, parentId);
      if (conjSplit.length > 1) {
        return conjSplit;
      }
    }

    // Try splitting on causal patterns
    if (this.config.splitCausalChains) {
      const causalSplit = this.splitOnCausal(trimmed, startOffset, parentId);
      if (causalSplit.length > 1) {
        return causalSplit;
      }
    }

    // If we couldn't split, return as a single (potentially non-atomic) claim
    claims.push(this.createClaim(trimmed, startOffset, parentId));
    return claims;
  }

  private splitOnConjunction(text: string, startOffset: number, parentId: string | undefined): AtomicClaim[] {
    const lowerText = text.toLowerCase();

    // Check for compound nouns first
    for (const compound of COMPOUND_NOUNS) {
      if (lowerText.includes(compound)) {
        // Don't split this conjunction
        return [this.createClaim(text, startOffset, parentId)];
      }
    }

    // Try each conjunction pattern
    for (const conj of CONJUNCTION_PATTERNS) {
      const match = text.match(conj.pattern);
      if (match && match.index !== undefined) {
        const before = text.slice(0, match.index).trim();
        const after = text.slice(match.index + match[0].length).trim();

        if (before.length >= this.config.minClaimLength && after.length >= this.config.minClaimLength) {
          const parentClaim = this.createClaim(text, startOffset, parentId);
          const claims: AtomicClaim[] = [];

          // Process the "before" part
          const beforeClaims = this.decomposeSegment(before, startOffset, parentClaim.id);
          claims.push(...beforeClaims);

          // Process the "after" part - may need to add subject
          let afterWithSubject = after;
          const subject = this.extractSubject(before);
          if (subject && !this.startsWithSubject(after)) {
            afterWithSubject = `${subject} ${after}`;
          }

          const afterOffset = startOffset + match.index + match[0].length;
          const afterClaims = this.decomposeSegment(afterWithSubject, afterOffset, parentClaim.id);
          claims.push(...afterClaims);

          return claims;
        }
      }
    }

    return [this.createClaim(text, startOffset, parentId)];
  }

  private splitOnCausal(text: string, startOffset: number, parentId: string | undefined): AtomicClaim[] {
    for (const causal of CAUSAL_PATTERNS) {
      const match = text.match(causal.pattern);
      if (match && match.index !== undefined) {
        const before = text.slice(0, match.index).trim();
        let after = text.slice(match.index + match[0].length).trim();

        // For "since" at the start, the structure is reversed
        if (causal.type === 'since') {
          // "Since X, Y" -> claim about X and claim about Y
          const commaIndex = after.indexOf(',');
          if (commaIndex > 0) {
            const cause = after.slice(0, commaIndex).trim();
            const effect = after.slice(commaIndex + 1).trim();

            if (cause.length >= this.config.minClaimLength && effect.length >= this.config.minClaimLength) {
              const parentClaim = this.createClaim(text, startOffset, parentId);
              const claims: AtomicClaim[] = [];

              claims.push(...this.decomposeSegment(cause, startOffset, parentClaim.id));
              claims.push(...this.decomposeSegment(effect, startOffset + commaIndex + 1, parentClaim.id));

              return claims;
            }
          }
        } else if (before.length >= this.config.minClaimLength && after.length >= this.config.minClaimLength) {
          const parentClaim = this.createClaim(text, startOffset, parentId);
          const claims: AtomicClaim[] = [];

          claims.push(...this.decomposeSegment(before, startOffset, parentClaim.id));
          claims.push(...this.decomposeSegment(after, startOffset + match.index + match[0].length, parentClaim.id));

          return claims;
        }
      }
    }

    return [this.createClaim(text, startOffset, parentId)];
  }

  private extractSubject(sentence: string): string | null {
    // Try to extract "The X" or "X" subject
    const subjectMatch = sentence.match(/^(The\s+)?([`']?\w+[`']?)(?:\s+(?:function|class|method|interface|type))?/i);
    if (subjectMatch) {
      return subjectMatch[0];
    }
    return null;
  }

  private startsWithSubject(text: string): boolean {
    // Check if text starts with a pronoun, article, or capitalized word
    return /^(The|A|An|It|This|That|These|Those|[A-Z])/i.test(text.trim());
  }

  private createClaim(content: string, startOffset: number, parentId: string | undefined): AtomicClaim {
    const cleanContent = this.cleanClaimContent(content);
    const type = this.classifyClaimType(cleanContent);
    const confidence = this.calculateConfidence(cleanContent);

    return {
      id: randomUUID(),
      content: cleanContent,
      parentClaimId: parentId,
      type,
      confidence,
      sourceSpan: {
        start: startOffset,
        end: startOffset + content.length,
      },
    };
  }

  private cleanClaimContent(content: string): string {
    // Remove markdown formatting but preserve content
    let cleaned = content
      .replace(/```[^`]*```/g, '') // Remove code blocks
      .replace(/`([^`]+)`/g, '$1') // Remove inline code markers but keep content
      .replace(/\*\*([^*]+)\*\*/g, '$1') // Remove bold markers
      .replace(/_([^_]+)_/g, '$1') // Remove italic markers
      .replace(/^\s*[-*]\s+/, '') // Remove leading bullet points
      .replace(/^\s*\d+\.\s+/, '') // Remove leading numbers
      .trim();

    // Ensure proper sentence ending
    if (cleaned.length > 0 && !/[.!?]$/.test(cleaned)) {
      cleaned += '.';
    }

    return cleaned;
  }

  private classifyClaimType(content: string): ClaimType {
    const lowerContent = content.toLowerCase();

    // Check for definitional claims
    for (const indicator of DEFINITIONAL_INDICATORS) {
      if (lowerContent.includes(indicator)) {
        return 'definitional';
      }
    }

    // Check for evaluative claims
    for (const indicator of EVALUATIVE_INDICATORS) {
      if (lowerContent.includes(indicator)) {
        return 'evaluative';
      }
    }

    // Check for procedural claims
    for (const indicator of PROCEDURAL_INDICATORS) {
      if (lowerContent.includes(indicator)) {
        return 'procedural';
      }
    }

    // Default to factual
    return 'factual';
  }

  private calculateConfidence(content: string): number {
    let confidence = 0.8; // Base confidence

    // Reduce confidence for very short claims
    if (content.length < 20) {
      confidence -= 0.1;
    }

    // Reduce confidence for evaluative claims (subjective)
    const lowerContent = content.toLowerCase();
    for (const indicator of EVALUATIVE_INDICATORS) {
      if (lowerContent.includes(indicator)) {
        confidence -= 0.2;
        break;
      }
    }

    // Increase confidence for structural claims
    const structuralIndicators = ['returns', 'takes', 'parameter', 'extends', 'implements', 'is async', 'is a'];
    for (const indicator of structuralIndicators) {
      if (lowerContent.includes(indicator)) {
        confidence += 0.1;
        break;
      }
    }

    return Math.max(0, Math.min(1, confidence));
  }

  private extractCodeClaims(code: string): AtomicClaim[] {
    const claims: AtomicClaim[] = [];

    // Extract function signatures
    const funcPattern = /(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)(?:\s*:\s*([^\s{]+))?/g;
    let match;

    while ((match = funcPattern.exec(code)) !== null) {
      const funcName = match[1];
      const params = match[2];
      const returnType = match[3];

      // Claim about function existence
      claims.push(
        this.createClaim(`The function ${funcName} exists.`, match.index, undefined)
      );

      // Claim about parameters if any
      if (params.trim()) {
        const paramList = params.split(',').map((p) => p.trim());
        for (const param of paramList) {
          const paramMatch = param.match(/(\w+)(?:\s*:\s*(\w+))?/);
          if (paramMatch) {
            claims.push(
              this.createClaim(
                `The function ${funcName} has parameter ${paramMatch[1]}.`,
                match.index,
                undefined
              )
            );
          }
        }
      }

      // Claim about return type if specified
      if (returnType) {
        claims.push(
          this.createClaim(`The function ${funcName} returns ${returnType}.`, match.index, undefined)
        );
      }
    }

    // Extract class definitions
    const classPattern = /class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([\w,\s]+))?/g;

    while ((match = classPattern.exec(code)) !== null) {
      const className = match[1];
      const extendsClass = match[2];
      const implementsList = match[3];

      claims.push(
        this.createClaim(`The class ${className} exists.`, match.index, undefined)
      );

      if (extendsClass) {
        claims.push(
          this.createClaim(`The class ${className} extends ${extendsClass}.`, match.index, undefined)
        );
      }

      if (implementsList) {
        const interfaces = implementsList.split(',').map((i) => i.trim());
        for (const iface of interfaces) {
          claims.push(
            this.createClaim(`The class ${className} implements ${iface}.`, match.index, undefined)
          );
        }
      }
    }

    return claims;
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a new ClaimDecomposer instance
 * @param config - Optional configuration options
 * @returns A ClaimDecomposer instance
 */
export function createClaimDecomposer(config?: Partial<ClaimDecomposerConfig>): ClaimDecomposer {
  return new ClaimDecomposerImpl(config);
}
