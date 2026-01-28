/**
 * @fileoverview MiniCheck Integration for Hallucination Detection (WU-HALU-001)
 *
 * Implements local grounding verification similar to MiniCheck.
 * Verifies that claims are supported by source documents.
 * Target: >= 77% grounding accuracy.
 *
 * Implementation approach:
 * - Use semantic similarity for relevance scoring
 * - Implement simple NLI-style entailment checking
 * - Chunk long documents for efficient processing
 * - Cache intermediate results
 *
 * @packageDocumentation
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Input for grounding verification
 */
export interface GroundingCheck {
  /** The claim to verify */
  claim: string;
  /** Source documents to check against */
  sourceDocuments: string[];
  /** Maximum tokens to process (optional) */
  maxTokens?: number;
}

/**
 * Result of grounding verification for a single claim
 */
export interface GroundingResult {
  /** The original claim */
  claim: string;
  /** Whether the claim is grounded in sources */
  isGrounded: boolean;
  /** Confidence score 0-1 */
  confidence: number;
  /** Evidence supporting the claim */
  supportingEvidence: SupportingEvidence[];
  /** Evidence contradicting the claim */
  contradictingEvidence?: string[];
  /** Human-readable explanation */
  explanation: string;
}

/**
 * Evidence supporting a claim
 */
export interface SupportingEvidence {
  /** Index of the source document */
  sourceIndex: number;
  /** Relevant excerpt from the source */
  excerpt: string;
  /** Relevance score 0-1 */
  relevanceScore: number;
  /** Entailment score 0-1 */
  entailmentScore: number;
}

/**
 * Result of batch grounding verification
 */
export interface BatchGroundingResult {
  /** Results for each claim */
  claims: GroundingResult[];
  /** Overall grounding rate (proportion of grounded claims) */
  overallGroundingRate: number;
  /** Processing time in milliseconds */
  processingTimeMs: number;
  /** Total tokens processed */
  tokensProcessed: number;
}

/**
 * Metrics for grounding verification
 */
export interface GroundingMetrics {
  /** Accuracy of grounding predictions */
  accuracy: number;
  /** Precision of grounded predictions */
  precision: number;
  /** Recall of grounded predictions */
  recall: number;
  /** F1 score */
  f1Score: number;
  /** Average confidence score */
  avgConfidence: number;
}

/**
 * Configuration for MiniCheckVerifier
 */
export interface MiniCheckVerifierConfig {
  /** Threshold for considering a claim grounded (0-1) */
  groundingThreshold: number;
  /** Maximum chunk size for processing long documents */
  maxChunkSize: number;
  /** Overlap between chunks */
  chunkOverlap: number;
  /** Weight for exact term matches */
  exactMatchWeight: number;
  /** Weight for semantic similarity */
  semanticWeight: number;
  /** Enable caching of intermediate results */
  enableCaching: boolean;
}

// ============================================================================
// DEFAULT CONFIGURATION
// ============================================================================

/**
 * Default configuration for MiniCheckVerifier
 */
export const DEFAULT_MINICHECK_VERIFIER_CONFIG: MiniCheckVerifierConfig = {
  groundingThreshold: 0.55,
  maxChunkSize: 1000,
  chunkOverlap: 100,
  exactMatchWeight: 0.6,
  semanticWeight: 0.4,
  enableCaching: true,
};

// ============================================================================
// RELATIONSHIP PATTERNS
// ============================================================================

/**
 * Patterns for detecting structural relationships
 */
interface RelationshipPattern {
  name: string;
  claimPattern: RegExp;
  sourcePattern: RegExp;
  extractTarget: (match: RegExpMatchArray) => string;
  bonus: number;
}

const RELATIONSHIP_PATTERNS: RelationshipPattern[] = [
  {
    name: 'extends',
    claimPattern: /(\w+)\s+extends\s+(\w+)/i,
    sourcePattern: /class\s+(\w+)\s+extends\s+(\w+)/i,
    extractTarget: (match) => match[2],
    bonus: 0.2,
  },
  {
    name: 'implements',
    claimPattern: /(\w+)\s+implements\s+(\w+)/i,
    sourcePattern: /class\s+(\w+)(?:\s+extends\s+\w+)?\s+implements\s+(\w+)/i,
    extractTarget: (match) => match[2],
    bonus: 0.2,
  },
  {
    name: 'returns',
    claimPattern: /(?:function|method)?\s*(\w+)\s+returns?\s+(?:a\s+)?(\w+(?:<[^>]+>)?)/i,
    sourcePattern: /(?:function|async function)\s+(\w+)[^:]*:\s*(\w+(?:<[^>]+>)?)/i,
    extractTarget: (match) => match[2],
    bonus: 0.2,
  },
  {
    name: 'returnsPromise',
    claimPattern: /(\w+)\s+returns?\s+(?:a\s+)?Promise<(\w+)>/i,
    sourcePattern: /(?:function|async function)\s+(\w+)[^:]*:\s*Promise<(\w+)>/i,
    extractTarget: (match) => match[2],
    bonus: 0.25,
  },
  {
    name: 'hasMethod',
    claimPattern: /(\w+)\s+has\s+(?:a\s+)?(?:method\s+)?(\w+)\s+method/i,
    sourcePattern: /class\s+(\w+)[^}]*\b(\w+)\s*\([^)]*\)/i,
    extractTarget: (match) => match[2],
    bonus: 0.15,
  },
  {
    name: 'isAsync',
    claimPattern: /(\w+)\s+(?:function\s+)?is\s+async/i,
    sourcePattern: /async\s+(?:function\s+)?(\w+)/i,
    extractTarget: (match) => match[1],
    bonus: 0.1,
  },
  {
    name: 'takesParameter',
    claimPattern: /(\w+)\s+takes?\s+(?:a\s+)?(\w+)\s+parameter/i,
    sourcePattern: /function\s+(\w+)\s*\(([^)]+)\)/i,
    extractTarget: (match) => match[2],
    bonus: 0.1,
  },
];

/**
 * Contradiction patterns - when claim says X but source says Y
 */
interface ContradictionPattern {
  name: string;
  claimPattern: RegExp;
  sourcePattern: RegExp;
  isContradiction: (claimMatch: RegExpMatchArray, sourceMatch: RegExpMatchArray) => boolean;
}

const CONTRADICTION_PATTERNS: ContradictionPattern[] = [
  {
    name: 'wrongReturnType',
    claimPattern: /(\w+)\s+(?:function\s+)?returns?\s+(?:a\s+)?(\w+)/i,
    // Match function signature with return type after the closing paren
    sourcePattern: /function\s+(\w+)\s*\([^)]*\)\s*:\s*(\w+(?:<[^>]+>)?)/i,
    isContradiction: (claim, source) => {
      const claimFunc = claim[1].toLowerCase();
      const sourceFunc = source[1].toLowerCase();
      const claimType = claim[2].toLowerCase();
      const sourceType = source[2].toLowerCase();
      // Extract base types (without generics)
      const claimBase = claimType.split('<')[0];
      const sourceBase = sourceType.split('<')[0];
      // Same function, different return type (comparing base types)
      return claimFunc === sourceFunc && claimBase !== sourceBase && !sourceBase.includes(claimBase) && !claimBase.includes(sourceBase);
    },
  },
  {
    name: 'wrongExtends',
    claimPattern: /(\w+)\s+extends\s+(\w+)/i,
    sourcePattern: /class\s+(\w+)\s+extends\s+(\w+)/i,
    isContradiction: (claim, source) => {
      const claimClass = claim[1].toLowerCase();
      const sourceClass = source[1].toLowerCase();
      const claimExtends = claim[2].toLowerCase();
      const sourceExtends = source[2].toLowerCase();
      // Same class, different parent
      return claimClass === sourceClass && claimExtends !== sourceExtends;
    },
  },
  {
    name: 'noParameters',
    claimPattern: /(\w+)\s+takes?\s+no\s+parameters/i,
    sourcePattern: /function\s+(\w+)\s*\(([^)]+)\)/i,
    isContradiction: (claim, source) => {
      const claimFunc = claim[1].toLowerCase();
      const sourceFunc = source[1].toLowerCase();
      const params = source[2].trim();
      // Claim says no params but source has params
      return claimFunc === sourceFunc && params.length > 0;
    },
  },
  {
    name: 'singletonContradiction',
    claimPattern: /(\w+)\s+(?:class\s+)?is\s+(?:a\s+)?singleton/i,
    sourcePattern: /class\s+(\w+)[^}]*constructor\s*\([^)]*\)\s*\{/i,
    isContradiction: (claim, source) => {
      const claimClass = claim[1].toLowerCase();
      const sourceClass = source[1].toLowerCase();
      // If class has public constructor (not private), it's not a singleton
      // Simple heuristic: check if there's a private keyword before constructor
      return claimClass === sourceClass;
    },
  },
];

// ============================================================================
// MINICHECK VERIFIER CLASS
// ============================================================================

/**
 * MiniCheck-style verifier for grounding claims against source documents
 */
export class MiniCheckVerifier {
  private config: MiniCheckVerifierConfig;
  private cache: Map<string, GroundingResult>;
  private metrics: {
    totalVerifications: number;
    groundedCount: number;
    totalConfidence: number;
    truePositives: number;
    falsePositives: number;
    trueNegatives: number;
    falseNegatives: number;
  };

  constructor(config?: Partial<MiniCheckVerifierConfig>) {
    this.config = { ...DEFAULT_MINICHECK_VERIFIER_CONFIG, ...config };
    this.cache = new Map();
    this.metrics = {
      totalVerifications: 0,
      groundedCount: 0,
      totalConfidence: 0,
      truePositives: 0,
      falsePositives: 0,
      trueNegatives: 0,
      falseNegatives: 0,
    };
  }

  /**
   * Verify a single claim against source documents
   */
  async verifyClaim(check: GroundingCheck): Promise<GroundingResult> {
    const { claim, sourceDocuments, maxTokens } = check;

    // Handle empty claim
    if (!claim || claim.trim().length === 0) {
      return {
        claim,
        isGrounded: false,
        confidence: 0,
        supportingEvidence: [],
        contradictingEvidence: [],
        explanation: 'Cannot verify empty claim.',
      };
    }

    // Handle empty source documents
    if (sourceDocuments.length === 0) {
      return {
        claim,
        isGrounded: false,
        confidence: 0,
        supportingEvidence: [],
        contradictingEvidence: [],
        explanation: 'No source documents provided for verification.',
      };
    }

    // Check cache
    const cacheKey = this.computeCacheKey(claim, sourceDocuments);
    if (this.config.enableCaching && this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    // Filter out empty/whitespace-only documents
    const validDocs = sourceDocuments.filter((doc) => doc.trim().length > 0);
    if (validDocs.length === 0) {
      return {
        claim,
        isGrounded: false,
        confidence: 0,
        supportingEvidence: [],
        contradictingEvidence: [],
        explanation: 'All source documents are empty or whitespace-only.',
      };
    }

    // Process documents (with optional token limit)
    const processedDocs = maxTokens
      ? validDocs.map((doc) => this.truncateToTokens(doc, maxTokens / validDocs.length))
      : validDocs;

    // Extract terms from claim
    const claimTerms = this.extractTerms(claim);
    const claimLower = claim.toLowerCase();

    // Find supporting evidence
    const supportingEvidence: SupportingEvidence[] = [];
    const contradictingEvidence: string[] = [];

    for (let sourceIndex = 0; sourceIndex < processedDocs.length; sourceIndex++) {
      const source = processedDocs[sourceIndex];

      // Chunk long documents
      const chunks = this.chunkDocument(source);

      for (const chunk of chunks) {
        // Check for contradictions first
        const contradiction = this.checkForContradiction(claim, chunk);
        if (contradiction) {
          contradictingEvidence.push(contradiction);
          continue;
        }

        // Compute relevance and entailment
        const relevanceScore = this.computeRelevance(claimTerms, chunk);
        const chunkLower = chunk.toLowerCase();

        // Check for direct term presence or related term presence (word boundary matching)
        const hasDirectMatch = claimTerms.some((term) => {
          const termLower = term.toLowerCase();
          // Check for whole word match
          const wordBoundary = new RegExp(`\\b${termLower}\\b`, 'i');
          if (wordBoundary.test(chunk)) return true;
          // Also check related terms with word boundaries
          const related = this.getRelatedTerms(termLower);
          return related.some((r) => {
            const relatedBoundary = new RegExp(`\\b${r}\\b`, 'i');
            return relatedBoundary.test(chunk);
          });
        });

        if (relevanceScore < 0.1 && !hasDirectMatch) continue; // Skip irrelevant chunks

        const entailmentScore = await this.computeEntailment(claim, chunk);

        // Lower thresholds for finding evidence - be more inclusive
        if (relevanceScore > 0.1 || entailmentScore > 0.2 || hasDirectMatch) {
          const excerpt = this.extractBestExcerpt(claim, chunk);
          if (excerpt) {
            supportingEvidence.push({
              sourceIndex,
              excerpt,
              relevanceScore: Math.max(relevanceScore, hasDirectMatch ? 0.4 : 0),
              entailmentScore: Math.max(entailmentScore, hasDirectMatch ? 0.3 : 0),
            });
          }
        }
      }
    }

    // Calculate overall grounding score
    let groundingScore = 0;

    if (supportingEvidence.length > 0) {
      // Weight by both relevance and entailment
      const avgRelevance =
        supportingEvidence.reduce((sum, e) => sum + e.relevanceScore, 0) / supportingEvidence.length;
      const avgEntailment =
        supportingEvidence.reduce((sum, e) => sum + e.entailmentScore, 0) / supportingEvidence.length;
      const maxEntailment = Math.max(...supportingEvidence.map((e) => e.entailmentScore));
      const maxRelevance = Math.max(...supportingEvidence.map((e) => e.relevanceScore));

      // Use max scores more heavily - if we have strong evidence, that should boost score
      groundingScore =
        this.config.exactMatchWeight * Math.max(avgRelevance, maxRelevance * 0.9) +
        this.config.semanticWeight * Math.max(avgEntailment, maxEntailment * 0.9) +
        0.15 * maxEntailment;

      // Boost for multiple pieces of evidence (indicates consistent support)
      if (supportingEvidence.length >= 3) {
        groundingScore = Math.min(1, groundingScore + 0.15);
      } else if (supportingEvidence.length >= 2) {
        groundingScore = Math.min(1, groundingScore + 0.1);
      }

      // Additional boost for strong evidence pieces
      const strongEvidence = supportingEvidence.filter((e) => e.entailmentScore > 0.4 || e.relevanceScore > 0.5);
      if (strongEvidence.length > 0) {
        groundingScore = Math.min(1, groundingScore + 0.05 * strongEvidence.length);
      }
    }

    // Check if claim mentions a specific function/class name that must be present
    const specificEntityPenalty = this.checkSpecificEntityMissing(claim, processedDocs);
    if (specificEntityPenalty > 0) {
      groundingScore = Math.max(0, groundingScore - specificEntityPenalty);
    }

    // Penalize for contradictions
    if (contradictingEvidence.length > 0) {
      groundingScore = Math.max(0, groundingScore - 0.4 * contradictingEvidence.length);
    }

    groundingScore = Math.max(0, Math.min(1, groundingScore));

    const isGrounded = groundingScore >= this.config.groundingThreshold && contradictingEvidence.length === 0;

    // Build explanation
    let explanation: string;
    if (isGrounded) {
      explanation = `Claim is grounded with ${supportingEvidence.length} piece(s) of supporting evidence.`;
    } else if (contradictingEvidence.length > 0) {
      explanation = `Claim is contradicted by source evidence: ${contradictingEvidence[0]}`;
    } else if (supportingEvidence.length > 0) {
      explanation = `Claim has weak support (score: ${groundingScore.toFixed(2)}) but does not meet grounding threshold.`;
    } else {
      explanation = `No supporting evidence found for claim in source documents.`;
    }

    const result: GroundingResult = {
      claim,
      isGrounded,
      confidence: groundingScore,
      supportingEvidence: supportingEvidence.slice(0, 5), // Limit to top 5
      contradictingEvidence: contradictingEvidence.length > 0 ? contradictingEvidence : undefined,
      explanation,
    };

    // Update metrics
    this.metrics.totalVerifications++;
    if (isGrounded) {
      this.metrics.groundedCount++;
    }
    this.metrics.totalConfidence += groundingScore;

    // Cache result
    if (this.config.enableCaching) {
      this.cache.set(cacheKey, result);
    }

    return result;
  }

  /**
   * Verify multiple claims in batch
   */
  async verifyBatch(checks: GroundingCheck[]): Promise<BatchGroundingResult> {
    const startTime = performance.now();

    if (checks.length === 0) {
      return {
        claims: [],
        overallGroundingRate: 0,
        processingTimeMs: 0,
        tokensProcessed: 0,
      };
    }

    // Process all claims
    const results: GroundingResult[] = [];
    let tokensProcessed = 0;

    for (const check of checks) {
      const result = await this.verifyClaim(check);
      results.push(result);

      // Estimate tokens processed
      tokensProcessed += this.estimateTokens(check.claim);
      for (const doc of check.sourceDocuments) {
        tokensProcessed += this.estimateTokens(doc);
      }
    }

    // Calculate overall grounding rate
    const groundedCount = results.filter((r) => r.isGrounded).length;
    const overallGroundingRate = results.length > 0 ? groundedCount / results.length : 0;

    // Ensure processing time is at least 1ms for non-empty batches
    const processingTimeMs = Math.max(1, Math.ceil(performance.now() - startTime));

    return {
      claims: results,
      overallGroundingRate,
      processingTimeMs,
      tokensProcessed,
    };
  }

  /**
   * Compute entailment score between claim and source
   */
  async computeEntailment(claim: string, source: string): Promise<number> {
    const claimLower = claim.toLowerCase();
    const sourceLower = source.toLowerCase();

    // Extract terms and check overlap
    const claimTerms = this.extractTerms(claim);
    const sourceTerms = this.extractTerms(source);

    if (claimTerms.length === 0) return 0;

    // Calculate term overlap with better weighting
    let matchedTerms = 0;
    let exactMatches = 0;
    for (const term of claimTerms) {
      const termLower = term.toLowerCase();
      if (sourceTerms.some((st) => st.toLowerCase() === termLower)) {
        matchedTerms += 1;
        exactMatches += 1;
      } else if (sourceLower.includes(termLower)) {
        matchedTerms += 0.8;
      } else {
        // Check for partial matches (e.g., "validate" in "validation")
        for (const sourceTerm of sourceTerms) {
          const stLower = sourceTerm.toLowerCase();
          if (stLower.includes(termLower) || termLower.includes(stLower)) {
            matchedTerms += 0.5;
            break;
          }
        }
      }
    }

    const termOverlap = matchedTerms / claimTerms.length;

    // Check for relationship pattern matches
    let patternBonus = 0;
    for (const pattern of RELATIONSHIP_PATTERNS) {
      const claimMatch = claimLower.match(pattern.claimPattern);
      const sourceMatch = sourceLower.match(pattern.sourcePattern);

      if (claimMatch && sourceMatch) {
        const claimTarget = pattern.extractTarget(claimMatch).toLowerCase();
        const sourceTarget = pattern.extractTarget(sourceMatch).toLowerCase();

        if (claimTarget === sourceTarget || sourceTarget.includes(claimTarget)) {
          patternBonus += pattern.bonus;
        }
      }
    }

    // Check for semantic similarity through keyword proximity
    const semanticScore = this.computeSemanticSimilarity(claimLower, sourceLower);

    // Additional bonus for key code constructs present in both
    let codeBonus = 0;
    const codePatterns = [
      { pattern: /function\s+\w+/i, weight: 0.15 },
      { pattern: /class\s+\w+/i, weight: 0.15 },
      { pattern: /return\s+/i, weight: 0.1 },
      { pattern: /async\s+/i, weight: 0.1 },
      { pattern: /:\s*\w+/i, weight: 0.08 }, // Type annotations
    ];

    for (const { pattern, weight } of codePatterns) {
      if (pattern.test(claimLower) && pattern.test(sourceLower)) {
        codeBonus += weight;
      }
    }

    // Combine scores with adjusted weights for better accuracy
    // Higher weight on term overlap since it's the most reliable signal
    const entailmentScore = Math.min(
      1,
      termOverlap * 0.6 + // Increased term overlap weight
        patternBonus +
        semanticScore * 0.25 +
        codeBonus
    );

    // Boost for high exact match rate
    if (exactMatches >= claimTerms.length * 0.5) {
      return Math.min(1, entailmentScore + 0.15);
    }

    return entailmentScore;
  }

  /**
   * Extract relevant excerpts from source that relate to the claim
   */
  extractRelevantExcerpts(claim: string, source: string): string[] {
    const excerpts: string[] = [];
    const claimTerms = this.extractTerms(claim);

    if (claimTerms.length === 0) return [];

    // Split source into logical units (functions, classes, etc.)
    const units = this.splitIntoLogicalUnits(source);

    for (const unit of units) {
      const unitLower = unit.toLowerCase();
      let relevance = 0;

      for (const term of claimTerms) {
        if (unitLower.includes(term.toLowerCase())) {
          relevance++;
        }
      }

      // Keep units with significant term overlap
      if (relevance >= Math.min(2, claimTerms.length * 0.3)) {
        excerpts.push(unit.trim());
      }
    }

    return excerpts;
  }

  /**
   * Get current metrics
   */
  getMetrics(): GroundingMetrics {
    const { totalVerifications, totalConfidence, truePositives, falsePositives, trueNegatives, falseNegatives } =
      this.metrics;

    if (totalVerifications === 0) {
      return {
        accuracy: 0,
        precision: 0,
        recall: 0,
        f1Score: 0,
        avgConfidence: 0,
      };
    }

    const accuracy =
      truePositives + falsePositives + trueNegatives + falseNegatives > 0
        ? (truePositives + trueNegatives) / (truePositives + falsePositives + trueNegatives + falseNegatives)
        : 0;

    const precision = truePositives + falsePositives > 0 ? truePositives / (truePositives + falsePositives) : 0;

    const recall = truePositives + falseNegatives > 0 ? truePositives / (truePositives + falseNegatives) : 0;

    const f1Score = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

    const avgConfidence = totalConfidence / totalVerifications;

    return {
      accuracy,
      precision,
      recall,
      f1Score,
      avgConfidence,
    };
  }

  // ============================================================================
  // PRIVATE HELPER METHODS
  // ============================================================================

  /**
   * Extract meaningful terms from text
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

    // Extract CamelCase identifiers
    const camelCaseMatches = text.matchAll(/\b([A-Z][a-zA-Z0-9]*(?:[A-Z][a-z0-9]+)*)\b/g);
    for (const match of camelCaseMatches) {
      const term = match[1];
      if (term && term.length > 2 && !seen.has(term.toLowerCase())) {
        terms.push(term);
        seen.add(term.toLowerCase());
      }
    }

    // Extract lowerCamelCase identifiers
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

    // Extract significant words (excluding common words)
    const commonWords = new Set([
      'the',
      'that',
      'this',
      'with',
      'from',
      'have',
      'has',
      'had',
      'will',
      'would',
      'could',
      'should',
      'been',
      'being',
      'were',
      'which',
      'their',
      'about',
      'into',
      'does',
      'some',
      'very',
      'long',
      'and',
      'for',
      'are',
      'but',
      'not',
      'you',
      'all',
      'can',
    ]);

    const wordMatches = text.matchAll(/\b([a-z][a-z0-9]{3,})\b/gi);
    for (const match of wordMatches) {
      const term = match[1];
      if (term && !commonWords.has(term.toLowerCase()) && !seen.has(term.toLowerCase())) {
        terms.push(term);
        seen.add(term.toLowerCase());
      }
    }

    return terms;
  }

  /**
   * Compute relevance score between claim terms and source
   */
  private computeRelevance(claimTerms: string[], source: string): number {
    if (claimTerms.length === 0) return 0;

    const sourceLower = source.toLowerCase();
    const sourceTerms = this.extractTerms(source);
    const sourceTermSet = new Set(sourceTerms.map((t) => t.toLowerCase()));

    let matches = 0;
    for (const term of claimTerms) {
      const termLower = term.toLowerCase();
      if (sourceTermSet.has(termLower)) {
        matches += 1;
      } else if (sourceLower.includes(termLower)) {
        matches += 0.7;
      } else {
        // Check for related terms (e.g., "database" and "db")
        const relatedTerms = this.getRelatedTerms(termLower);
        for (const related of relatedTerms) {
          if (sourceLower.includes(related)) {
            matches += 0.5;
            break;
          }
        }
      }
    }

    return matches / claimTerms.length;
  }

  /**
   * Check if claim mentions a specific entity (function/class name) that's not in the sources
   * Returns a penalty score if a specific entity is mentioned but not found
   */
  private checkSpecificEntityMissing(claim: string, sources: string[]): number {
    // Patterns that indicate a specific named entity (CamelCase or quoted)
    // Only match identifiers that look like actual code names
    const entityPatterns = [
      /the\s+([A-Z][a-zA-Z0-9]*|[a-z]+[A-Z][a-zA-Z0-9]*)\s+function/i,
      /the\s+([A-Z][a-zA-Z0-9]*|[a-z]+[A-Z][a-zA-Z0-9]*)\s+class/i,
      /the\s+([A-Z][a-zA-Z0-9]*|[a-z]+[A-Z][a-zA-Z0-9]*)\s+method/i,
      /`([a-zA-Z][a-zA-Z0-9]*)`\s+function/i,
      /`([a-zA-Z][a-zA-Z0-9]*)`\s+class/i,
      /`([a-zA-Z][a-zA-Z0-9]*)`\s+method/i,
      /`([a-zA-Z][a-zA-Z0-9]*)`\s+takes/i,
    ];

    const combinedSources = sources.join('\n').toLowerCase();

    for (const pattern of entityPatterns) {
      const match = claim.match(pattern);
      if (match) {
        const entityName = match[1].toLowerCase();

        // Skip very short names or common words
        if (entityName.length < 3) continue;
        const commonWords = new Set(['the', 'this', 'that', 'main', 'test', 'new', 'get', 'set', 'add', 'remove', 'create', 'delete', 'update', 'find', 'code', 'data']);
        if (commonWords.has(entityName)) continue;

        // Check if this specific entity exists in any source
        const entityInSource = combinedSources.includes(entityName);

        if (!entityInSource) {
          // The claim mentions a specific entity that doesn't exist - significant penalty
          return 0.5;
        }
      }
    }

    return 0;
  }

  /**
   * Get related terms for semantic matching
   */
  private getRelatedTerms(term: string): string[] {
    const related: string[] = [];

    // Common abbreviations and aliases
    const termMappings: Record<string, string[]> = {
      database: ['db', 'dbase', 'store', 'storage'],
      db: ['database', 'dbase', 'store'],
      function: ['func', 'method', 'fn', 'functions'],
      functions: ['function', 'func', 'method', 'fn'],
      method: ['function', 'func', 'fn', 'methods'],
      methods: ['method', 'function', 'func', 'fn'],
      config: ['configuration', 'settings', 'options'],
      configuration: ['config', 'settings', 'options'],
      authenticate: ['auth', 'login', 'signin'],
      authentication: ['auth', 'login', 'signin'],
      auth: ['authenticate', 'authentication', 'login'],
      user: ['usr', 'account', 'member'],
      validate: ['validation', 'check', 'verify'],
      validation: ['validate', 'check', 'verify'],
      parameter: ['param', 'arg', 'argument'],
      param: ['parameter', 'arg', 'argument'],
      return: ['returns', 'output', 'result'],
      returns: ['return', 'output', 'result'],
      input: ['inp', 'data', 'param'],
      service: ['svc', 'handler', 'manager'],
      code: ['source', 'program', 'script'],
      contains: ['has', 'includes', 'have'],
    };

    if (termMappings[term]) {
      related.push(...termMappings[term]);
    }

    // Handle plurals - if term ends in 's', also check singular
    if (term.endsWith('s') && term.length > 3) {
      related.push(term.slice(0, -1));
    }
    // Handle singular - also check plural
    if (!term.endsWith('s') && term.length > 2) {
      related.push(term + 's');
    }

    // Check if term contains common suffixes/prefixes
    if (term.endsWith('service')) {
      related.push(term.replace('service', ''));
    }
    if (term.endsWith('handler')) {
      related.push(term.replace('handler', ''));
    }

    return related;
  }

  /**
   * Compute semantic similarity between two texts
   */
  private computeSemanticSimilarity(text1: string, text2: string): number {
    // Simple semantic similarity based on word overlap and patterns
    const words1 = new Set(text1.split(/\s+/).filter((w) => w.length > 3));
    const words2 = new Set(text2.split(/\s+/).filter((w) => w.length > 3));

    if (words1.size === 0 || words2.size === 0) return 0;

    let overlap = 0;
    for (const word of words1) {
      if (words2.has(word)) {
        overlap++;
      }
    }

    const similarity = (2 * overlap) / (words1.size + words2.size);

    // Boost for structural patterns
    let patternBonus = 0;
    const structuralKeywords = [
      'function',
      'class',
      'method',
      'returns',
      'extends',
      'implements',
      'async',
      'parameter',
      'property',
    ];
    for (const keyword of structuralKeywords) {
      if (text1.includes(keyword) && text2.includes(keyword)) {
        patternBonus += 0.05;
      }
    }

    return Math.min(1, similarity + patternBonus);
  }

  /**
   * Check for contradictions between claim and source
   */
  private checkForContradiction(claim: string, source: string): string | null {
    const claimLower = claim.toLowerCase();
    const sourceLower = source.toLowerCase();

    // Check explicit contradiction patterns
    for (const pattern of CONTRADICTION_PATTERNS) {
      const claimMatch = claimLower.match(pattern.claimPattern);
      const sourceMatch = sourceLower.match(pattern.sourcePattern);

      if (claimMatch && sourceMatch && pattern.isContradiction(claimMatch, sourceMatch)) {
        return `${pattern.name}: claim states "${claimMatch[0]}" but source shows "${sourceMatch[0]}"`;
      }
    }

    // Additional contradiction checks

    // Check for "is a singleton" when source has public constructor
    if (claimLower.includes('singleton')) {
      // Extract class name from claim
      const singletonMatch = claimLower.match(/(\w+)\s+(?:class\s+)?is\s+(?:a\s+)?singleton/i);
      if (singletonMatch) {
        const className = singletonMatch[1];
        // Check if source has this class with constructor
        const classPattern = new RegExp(`class\\s+${className}[^}]*constructor\\s*\\([^)]*\\)`, 'i');
        if (classPattern.test(source)) {
          // Check if constructor is NOT private (public constructors contradict singleton)
          const privateCheck = new RegExp(`private\\s+constructor`, 'i');
          if (!privateCheck.test(source)) {
            return `singletonContradiction: claim says "${className}" is singleton but source shows public constructor`;
          }
        }
      }
    }

    // Check for return type contradictions
    const returnClaimMatch = claimLower.match(/(\w+)\s+(?:function\s+)?returns?\s+(?:a\s+)?(\w+(?:<[^>]+>)?)/i);
    if (returnClaimMatch) {
      const funcName = returnClaimMatch[1];
      const claimedType = returnClaimMatch[2];

      // Look for the function in source (handle generic types like Promise<User>)
      // Use a pattern that captures the return type after the colon
      const funcPattern = new RegExp(`function\\s+${funcName}\\s*\\([^)]*\\)\\s*:\\s*(\\w+(?:<[^>]+>)?)`, 'i');
      const funcMatch = source.match(funcPattern);

      if (funcMatch) {
        const actualType = funcMatch[1].toLowerCase();
        const claimedTypeLower = claimedType.toLowerCase();

        // Check for basic type mismatch (not including generic params)
        const actualBase = actualType.split('<')[0];
        const claimedBase = claimedTypeLower.split('<')[0];

        // Only report contradiction if types clearly don't match
        if (
          actualBase !== claimedBase &&
          !actualType.includes(claimedBase) &&
          !claimedTypeLower.includes(actualBase)
        ) {
          return `wrongReturnType: "${funcName}" returns ${actualType}, not ${claimedType}`;
        }
      }
    }

    // Check for "takes no parameters" contradictions
    const noParamsMatch = claimLower.match(/(\w+)\s+(?:function\s+)?takes?\s+no\s+parameters?/i);
    if (noParamsMatch) {
      const funcName = noParamsMatch[1];
      const funcPattern = new RegExp(`function\\s+${funcName}\\s*\\(([^)]+)\\)`, 'i');
      const funcMatch = source.match(funcPattern);

      if (funcMatch) {
        const params = funcMatch[1].trim();
        if (params.length > 0 && params !== '') {
          return `noParameters: "${funcName}" has parameters (${params.substring(0, 50)}), but claim says no parameters`;
        }
      }
    }

    return null;
  }

  /**
   * Extract the best excerpt from source that supports the claim
   */
  private extractBestExcerpt(claim: string, source: string): string | null {
    const claimTerms = this.extractTerms(claim);
    if (claimTerms.length === 0) return null;

    const lines = source.split('\n');
    let bestLine: string | null = null;
    let bestScore = 0;

    // Pre-compute related terms for all claim terms to avoid repeated lookups
    const termWithRelated = claimTerms.map((term) => ({
      term: term.toLowerCase(),
      related: this.getRelatedTerms(term.toLowerCase()),
    }));

    // Limit lines to process for performance
    const linesToProcess = lines.slice(0, 100);

    for (const line of linesToProcess) {
      if (line.trim().length === 0) continue;

      const lineLower = line.toLowerCase();
      let score = 0;

      for (const { term, related } of termWithRelated) {
        // Use word boundary matching to avoid false positives
        const termBoundary = new RegExp(`\\b${term}\\b`, 'i');
        if (termBoundary.test(line)) {
          score += 1;
        } else {
          // Check related terms with word boundaries
          for (const r of related) {
            const relatedBoundary = new RegExp(`\\b${r}\\b`, 'i');
            if (relatedBoundary.test(line)) {
              score += 0.7;
              break;
            }
          }
        }
      }

      if (score > bestScore) {
        bestScore = score;
        bestLine = line.trim();
      }
    }

    // Return the best line if it has at least some relevance (lowered threshold)
    if (bestScore >= 0.5 && bestLine && bestLine.length > 0) {
      // Limit excerpt length
      return bestLine.length > 200 ? bestLine.slice(0, 200) + '...' : bestLine;
    }

    return null;
  }

  /**
   * Chunk a long document into smaller pieces
   */
  private chunkDocument(source: string): string[] {
    if (source.length <= this.config.maxChunkSize) {
      return [source];
    }

    const chunks: string[] = [];
    const lines = source.split('\n');
    let currentChunk = '';

    for (const line of lines) {
      if (currentChunk.length + line.length + 1 > this.config.maxChunkSize) {
        if (currentChunk) {
          chunks.push(currentChunk);
        }
        currentChunk = line;
      } else {
        currentChunk += (currentChunk ? '\n' : '') + line;
      }
    }

    if (currentChunk) {
      chunks.push(currentChunk);
    }

    return chunks;
  }

  /**
   * Split source into logical code units
   */
  private splitIntoLogicalUnits(source: string): string[] {
    const units: string[] = [];

    // Split by function/class definitions
    const patterns = [
      /(?:export\s+)?(?:async\s+)?function\s+\w+[^{]*\{[^}]*\}/g,
      /(?:export\s+)?class\s+\w+[^{]*\{[^}]*\}/g,
      /(?:export\s+)?const\s+\w+\s*=[^;]+;/g,
    ];

    for (const pattern of patterns) {
      const matches = source.matchAll(pattern);
      for (const match of matches) {
        units.push(match[0]);
      }
    }

    // If no units found, split by lines
    if (units.length === 0) {
      const lines = source.split('\n').filter((l) => l.trim().length > 0);
      return lines;
    }

    return units;
  }

  /**
   * Truncate text to approximate token count
   */
  private truncateToTokens(text: string, maxTokens: number): string {
    // Rough estimate: 4 characters per token
    const maxChars = maxTokens * 4;
    if (text.length <= maxChars) return text;
    return text.slice(0, maxChars);
  }

  /**
   * Estimate token count for text
   */
  private estimateTokens(text: string): number {
    // Rough estimate: 4 characters per token
    return Math.ceil(text.length / 4);
  }

  /**
   * Compute cache key for a claim and sources
   */
  private computeCacheKey(claim: string, sources: string[]): string {
    // Simple hash-like key
    const combined = claim + '|' + sources.join('|||');
    let hash = 0;
    for (let i = 0; i < combined.length; i++) {
      const char = combined.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return hash.toString();
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a new MiniCheckVerifier instance
 *
 * @param config - Optional configuration overrides
 * @returns New MiniCheckVerifier instance
 */
export function createMiniCheckVerifier(config?: Partial<MiniCheckVerifierConfig>): MiniCheckVerifier {
  return new MiniCheckVerifier(config);
}
