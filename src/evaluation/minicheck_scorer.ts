/**
 * @fileoverview MiniCheck-style Entailment Scorer (WU-1410)
 *
 * Implements a heuristic version of MiniCheck that uses semantic similarity scoring
 * to improve grounding accuracy beyond regex-only entailment.
 *
 * Research shows MiniCheck achieves 77.4% grounding accuracy. This implementation
 * uses:
 * 1. Key term extraction (function names, class names, identifiers)
 * 2. Term presence checking in evidence
 * 3. Relationship pattern matching (extends, implements, returns, etc.)
 * 4. Weighted scoring based on matches
 * 5. Configurable threshold for grounding determination
 *
 * @packageDocumentation
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Overall grounding score result
 */
export interface MiniCheckScore {
  /** Overall grounding score 0-1 */
  groundingScore: number;
  /** Per-claim scores */
  claimScores: ClaimScore[];
  /** Whether the response is grounded (score > threshold) */
  isGrounded: boolean;
}

/**
 * Score for a single claim
 */
export interface ClaimScore {
  /** The original claim text */
  claim: string;
  /** Grounding score 0-1 */
  score: number;
  /** Best matching evidence or null if no match */
  bestEvidence: string | null;
  /** Whether this claim is grounded (score > threshold) */
  isGrounded: boolean;
}

/**
 * Configuration for MiniCheck scorer
 */
export interface MiniCheckConfig {
  /** Threshold for considering a claim grounded */
  groundingThreshold: number;
  /** Use semantic similarity (if available) - currently heuristics only */
  useSemanticSimilarity: boolean;
  /** Weight for exact match vs semantic similarity (0-1) */
  exactMatchWeight: number;
}

// ============================================================================
// DEFAULT CONFIGURATION
// ============================================================================

/**
 * Default configuration for MiniCheck scorer
 */
export const DEFAULT_MINICHECK_CONFIG: MiniCheckConfig = {
  groundingThreshold: 0.6,
  useSemanticSimilarity: false, // Start with heuristics only
  exactMatchWeight: 0.7,
};

// ============================================================================
// RELATIONSHIP PATTERNS
// ============================================================================

/**
 * Patterns for detecting structural relationships in claims and evidence
 */
interface RelationshipPattern {
  /** Pattern name for debugging */
  name: string;
  /** Keywords that identify this pattern */
  keywords: string[];
  /** Bonus score when pattern matches */
  bonus: number;
}

const RELATIONSHIP_PATTERNS: RelationshipPattern[] = [
  { name: 'extends', keywords: ['extends'], bonus: 0.15 },
  { name: 'implements', keywords: ['implements'], bonus: 0.15 },
  { name: 'returns', keywords: ['returns', 'return'], bonus: 0.12 },
  { name: 'hasMethod', keywords: ['has method', 'has methods', 'method'], bonus: 0.10 },
  { name: 'parameter', keywords: ['takes parameter', 'has parameter', 'parameter', 'takes', 'accepts'], bonus: 0.10 },
  { name: 'async', keywords: ['is async', 'async'], bonus: 0.10 },
  { name: 'import', keywords: ['imported from', 'import', 'from'], bonus: 0.10 },
  { name: 'type', keywords: ['is an interface', 'interface', 'is a type', 'type alias'], bonus: 0.08 },
  { name: 'class', keywords: ['is a class', 'class'], bonus: 0.08 },
  { name: 'function', keywords: ['is a function', 'function'], bonus: 0.08 },
];

// ============================================================================
// MINICHECK SCORER CLASS
// ============================================================================

/**
 * MiniCheck-style scorer for grounding verification
 */
export class MiniCheckScorer {
  private config: MiniCheckConfig;

  constructor(config?: Partial<MiniCheckConfig>) {
    this.config = { ...DEFAULT_MINICHECK_CONFIG, ...config };
  }

  /**
   * Score how well claims are grounded in evidence
   *
   * @param claims - Array of claim strings to verify
   * @param evidence - Array of evidence strings to check against
   * @returns Overall grounding score with per-claim breakdown
   */
  scoreGrounding(claims: string[], evidence: string[]): MiniCheckScore {
    // Handle empty claims - nothing to contradict
    if (claims.length === 0) {
      return {
        groundingScore: 1.0,
        claimScores: [],
        isGrounded: true,
      };
    }

    // Handle empty evidence - nothing to ground claims in
    if (evidence.length === 0) {
      return {
        groundingScore: 0,
        claimScores: claims.map((claim) => ({
          claim,
          score: 0,
          bestEvidence: null,
          isGrounded: false,
        })),
        isGrounded: false,
      };
    }

    // Score each claim
    const claimScores = claims.map((claim) => this.scoreClaimGrounding(claim, evidence));

    // Calculate aggregate score (average)
    const totalScore = claimScores.reduce((sum, cs) => sum + cs.score, 0);
    const groundingScore = totalScore / claimScores.length;

    return {
      groundingScore,
      claimScores,
      isGrounded: groundingScore >= this.config.groundingThreshold,
    };
  }

  /**
   * Score a single claim against evidence
   *
   * @param claim - The claim to verify
   * @param evidence - Array of evidence strings
   * @returns Score for this claim
   */
  scoreClaimGrounding(claim: string, evidence: string[]): ClaimScore {
    // Handle empty or whitespace claim
    if (!claim || claim.trim().length === 0) {
      return {
        claim,
        score: 0,
        bestEvidence: null,
        isGrounded: false,
      };
    }

    // Handle empty evidence
    if (evidence.length === 0) {
      return {
        claim,
        score: 0,
        bestEvidence: null,
        isGrounded: false,
      };
    }

    // Find best matching evidence
    let bestScore = 0;
    let bestEvidence: string | null = null;

    for (const evidenceItem of evidence) {
      const similarity = this.computeSimilarity(claim, evidenceItem);
      if (similarity > bestScore) {
        bestScore = similarity;
        bestEvidence = evidenceItem;
      }
    }

    // Only return bestEvidence if score is meaningful
    if (bestScore < 0.2) {
      bestEvidence = null;
    }

    return {
      claim,
      score: bestScore,
      bestEvidence,
      isGrounded: bestScore >= this.config.groundingThreshold,
    };
  }

  /**
   * Compute similarity between claim and evidence
   * Uses keyword overlap + pattern matching
   *
   * @param claim - The claim text
   * @param evidenceItem - The evidence text to compare against
   * @returns Similarity score 0-1
   */
  private computeSimilarity(claim: string, evidenceItem: string): number {
    const claimLower = claim.toLowerCase();
    const evidenceLower = evidenceItem.toLowerCase();

    // Extract terms from both
    const claimTerms = this.extractTerms(claim);
    const evidenceTerms = this.extractTerms(evidenceItem);

    if (claimTerms.length === 0) {
      return 0;
    }

    // Calculate term overlap score
    let matchedTerms = 0;
    let exactMatches = 0;

    for (const term of claimTerms) {
      const termLower = term.toLowerCase();

      // Check for exact match in evidence terms
      if (evidenceTerms.some((et) => et.toLowerCase() === termLower)) {
        matchedTerms++;
        exactMatches++;
      }
      // Check for substring match in evidence
      else if (evidenceLower.includes(termLower)) {
        matchedTerms += 0.8; // Partial credit for substring match
      }
      // Check if evidence term contains this term or vice versa
      else if (
        evidenceTerms.some(
          (et) =>
            et.toLowerCase().includes(termLower) ||
            termLower.includes(et.toLowerCase())
        )
      ) {
        matchedTerms += 0.6; // Partial credit for partial match
      }
    }

    // Base score from term overlap
    const overlapScore = matchedTerms / claimTerms.length;

    // Apply exact match weight
    const exactRatio = claimTerms.length > 0 ? exactMatches / claimTerms.length : 0;
    const weightedOverlap =
      overlapScore * (1 - this.config.exactMatchWeight) +
      exactRatio * this.config.exactMatchWeight +
      overlapScore * this.config.exactMatchWeight * 0.5; // Blend for smoother scoring

    // Check for relationship pattern bonuses
    let patternBonus = 0;
    for (const pattern of RELATIONSHIP_PATTERNS) {
      const claimHasPattern = pattern.keywords.some((kw) => claimLower.includes(kw));
      const evidenceHasPattern = pattern.keywords.some((kw) => evidenceLower.includes(kw));

      if (claimHasPattern && evidenceHasPattern) {
        patternBonus += pattern.bonus;
      }
    }

    // Combine scores
    let finalScore = Math.min(1.0, weightedOverlap + patternBonus);

    // Boost for high term overlap with relationship match
    if (overlapScore > 0.7 && patternBonus > 0.1) {
      finalScore = Math.min(1.0, finalScore + 0.1);
    }

    // Penalize if key relationship terms don't match
    // e.g., claim says "extends X" but evidence says "extends Y"
    const relationshipPenalty = this.checkRelationshipMismatch(claimLower, evidenceLower, claimTerms, evidenceTerms);
    finalScore = Math.max(0, finalScore - relationshipPenalty);

    return finalScore;
  }

  /**
   * Extract meaningful terms from text
   * Includes CamelCase, snake_case, backtick-quoted, and significant words
   */
  private extractTerms(text: string): string[] {
    const terms: string[] = [];
    const seen = new Set<string>();

    // Extract backtick-quoted identifiers
    const backtickMatches = text.matchAll(/[`']([^`']+)[`']/g);
    for (const match of backtickMatches) {
      const term = match[1].trim();
      if (term && !seen.has(term.toLowerCase())) {
        terms.push(term);
        seen.add(term.toLowerCase());
      }
    }

    // Extract CamelCase identifiers (e.g., ASTFactExtractor, createASTFactExtractor)
    const camelCaseMatches = text.matchAll(/\b([A-Z][a-zA-Z0-9]*(?:[A-Z][a-z0-9]+)*)\b/g);
    for (const match of camelCaseMatches) {
      const term = match[1];
      if (term && term.length > 2 && !seen.has(term.toLowerCase())) {
        terms.push(term);
        seen.add(term.toLowerCase());
      }
    }

    // Extract lowerCamelCase identifiers (e.g., createASTFactExtractor, extractFromFile)
    const lowerCamelMatches = text.matchAll(/\b([a-z][a-zA-Z0-9]*[A-Z][a-zA-Z0-9]*)\b/g);
    for (const match of lowerCamelMatches) {
      const term = match[1];
      if (term && term.length > 2 && !seen.has(term.toLowerCase())) {
        terms.push(term);
        seen.add(term.toLowerCase());
      }
    }

    // Extract snake_case identifiers
    const snakeCaseMatches = text.matchAll(/\b([a-z][a-z0-9]*(?:_[a-z0-9]+)+)\b/g);
    for (const match of snakeCaseMatches) {
      const term = match[1];
      if (term && !seen.has(term.toLowerCase())) {
        terms.push(term);
        seen.add(term.toLowerCase());
      }
    }

    // Extract significant lowercase words (4+ chars, not common words)
    const commonWords = new Set([
      'the', 'that', 'this', 'with', 'from', 'have', 'has', 'had',
      'will', 'would', 'could', 'should', 'been', 'being', 'were',
      'which', 'their', 'about', 'into', 'does', 'function', 'class',
      'method', 'parameter', 'returns', 'takes', 'type', 'interface',
    ]);

    const wordMatches = text.matchAll(/\b([a-z][a-z0-9]{3,})\b/gi);
    for (const match of wordMatches) {
      const term = match[1];
      if (
        term &&
        !commonWords.has(term.toLowerCase()) &&
        !seen.has(term.toLowerCase())
      ) {
        terms.push(term);
        seen.add(term.toLowerCase());
      }
    }

    return terms;
  }

  /**
   * Check for mismatched relationship targets
   * Returns a penalty score if claim and evidence have same relationship but different targets
   */
  private checkRelationshipMismatch(
    claimLower: string,
    evidenceLower: string,
    claimTerms: string[],
    evidenceTerms: string[]
  ): number {
    // Check extends mismatch
    if (claimLower.includes('extends') && evidenceLower.includes('extends')) {
      const claimExtends = this.extractRelationshipTarget(claimLower, 'extends');
      const evidenceExtends = this.extractRelationshipTarget(evidenceLower, 'extends');

      if (
        claimExtends &&
        evidenceExtends &&
        claimExtends.toLowerCase() !== evidenceExtends.toLowerCase()
      ) {
        // Check if the subject is the same
        if (this.hasSameSubject(claimLower, evidenceLower, claimTerms, evidenceTerms)) {
          return 0.3; // Penalty for same subject but different extends target
        }
      }
    }

    // Check implements mismatch
    if (claimLower.includes('implements') && evidenceLower.includes('implements')) {
      const claimImpl = this.extractRelationshipTarget(claimLower, 'implements');
      const evidenceImpl = this.extractRelationshipTarget(evidenceLower, 'implements');

      if (
        claimImpl &&
        evidenceImpl &&
        claimImpl.toLowerCase() !== evidenceImpl.toLowerCase()
      ) {
        if (this.hasSameSubject(claimLower, evidenceLower, claimTerms, evidenceTerms)) {
          return 0.3;
        }
      }
    }

    return 0;
  }

  /**
   * Extract the target of a relationship keyword (word after the keyword)
   */
  private extractRelationshipTarget(text: string, keyword: string): string | null {
    const regex = new RegExp(`${keyword}\\s+([\\w]+)`, 'i');
    const match = text.match(regex);
    return match ? match[1] : null;
  }

  /**
   * Check if claim and evidence seem to be about the same subject
   */
  private hasSameSubject(
    claimLower: string,
    evidenceLower: string,
    claimTerms: string[],
    evidenceTerms: string[]
  ): boolean {
    // Check if first significant term matches
    if (claimTerms.length > 0 && evidenceTerms.length > 0) {
      return evidenceTerms.some(
        (et) => et.toLowerCase() === claimTerms[0].toLowerCase()
      );
    }
    return false;
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a new MiniCheckScorer instance
 *
 * @param config - Optional configuration overrides
 * @returns New MiniCheckScorer instance
 */
export function createMiniCheckScorer(config?: Partial<MiniCheckConfig>): MiniCheckScorer {
  return new MiniCheckScorer(config);
}
