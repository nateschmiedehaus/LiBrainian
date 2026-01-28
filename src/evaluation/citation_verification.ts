/**
 * @fileoverview Citation Verification Pipeline (WU-PROV-003)
 *
 * Integrates MiniCheck-style verification for claim grounding, supporting
 * multiple verification methods:
 * - Exact match: Literal text matching
 * - Entailment: Logical deduction from evidence
 * - Semantic similarity: Term overlap and pattern matching
 *
 * Target: >= 77% grounding accuracy (matching MiniCheck research baseline)
 *
 * @packageDocumentation
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * A citation linking a claim to a source document span
 */
export interface Citation {
  /** Unique identifier for the citation */
  id: string;
  /** The claim being made */
  claim: string;
  /** The source document name/path */
  sourceDocument: string;
  /** Character span in the source document */
  sourceSpan: { start: number; end: number };
  /** Confidence in the citation (0.0 to 1.0) */
  confidence: number;
}

/**
 * Result of verifying a single citation
 */
export interface VerificationResult {
  /** The original citation that was verified */
  citation: Citation;
  /** Whether the claim is grounded in the source */
  isGrounded: boolean;
  /** Grounding score from 0.0 to 1.0 */
  groundingScore: number;
  /** Evidence strings that support or contradict the claim */
  evidence: string[];
  /** The verification method that produced this result */
  method: 'exact_match' | 'entailment' | 'semantic_similarity';
}

/**
 * Verification method types
 */
export type VerificationMethod = 'exact_match' | 'entailment' | 'semantic_similarity';

/**
 * Configuration for the citation verification pipeline
 */
export interface CitationVerificationConfig {
  /** Threshold for considering a claim grounded (default: 0.6) */
  groundingThreshold: number;
  /** Preferred verification method (default: 'semantic_similarity') */
  preferredMethod: VerificationMethod;
  /** Enable fallback to other methods if preferred fails (default: true) */
  enableFallback: boolean;
  /** Weight for exact match vs semantic similarity (default: 0.7) */
  exactMatchWeight: number;
}

/**
 * Grounding statistics
 */
export interface GroundingStats {
  /** Total number of citations verified */
  total: number;
  /** Number of grounded citations */
  grounded: number;
  /** Grounding accuracy (grounded / total) */
  accuracy: number;
}

/**
 * Citation Verification Pipeline interface
 */
export interface CitationVerificationPipeline {
  /** Verify a single citation against a source document */
  verify(citation: Citation, sourceDocument: string): Promise<VerificationResult>;
  /** Verify multiple citations against a source document */
  verifyBatch(citations: Citation[], sourceDocument: string): Promise<VerificationResult[]>;
  /** Get accumulated grounding statistics */
  getGroundingStats(): GroundingStats;
}

// ============================================================================
// DEFAULT CONFIGURATION
// ============================================================================

/**
 * Default configuration for the citation verification pipeline
 */
export const DEFAULT_CITATION_VERIFICATION_CONFIG: CitationVerificationConfig = {
  groundingThreshold: 0.6,
  preferredMethod: 'semantic_similarity',
  enableFallback: true,
  exactMatchWeight: 0.7,
};

// ============================================================================
// RELATIONSHIP PATTERNS
// ============================================================================

/**
 * Patterns for detecting structural relationships in claims and evidence
 */
interface RelationshipPattern {
  name: string;
  keywords: string[];
  bonus: number;
}

const RELATIONSHIP_PATTERNS: RelationshipPattern[] = [
  { name: 'extends', keywords: ['extends', 'inherits from', 'subclass of'], bonus: 0.15 },
  { name: 'implements', keywords: ['implements'], bonus: 0.15 },
  { name: 'returns', keywords: ['returns', 'return type'], bonus: 0.12 },
  { name: 'hasMethod', keywords: ['has method', 'has a method', 'method'], bonus: 0.10 },
  { name: 'parameter', keywords: ['takes parameter', 'has parameter', 'parameter', 'takes', 'accepts'], bonus: 0.10 },
  { name: 'async', keywords: ['is async', 'async'], bonus: 0.10 },
  { name: 'import', keywords: ['imported from', 'import', 'from'], bonus: 0.10 },
  { name: 'type', keywords: ['is an interface', 'interface', 'is a type', 'type alias'], bonus: 0.08 },
  { name: 'class', keywords: ['is a class', 'class'], bonus: 0.08 },
  { name: 'function', keywords: ['is a function', 'function'], bonus: 0.08 },
];

// ============================================================================
// CITATION VERIFICATION PIPELINE IMPLEMENTATION
// ============================================================================

/**
 * Implementation of the Citation Verification Pipeline
 */
class CitationVerificationPipelineImpl implements CitationVerificationPipeline {
  private config: CitationVerificationConfig;
  private stats: { total: number; grounded: number };

  constructor(config?: Partial<CitationVerificationConfig>) {
    this.config = { ...DEFAULT_CITATION_VERIFICATION_CONFIG, ...config };
    this.stats = { total: 0, grounded: 0 };
  }

  /**
   * Verify a single citation against a source document
   */
  async verify(citation: Citation, sourceDocument: string): Promise<VerificationResult> {
    // Handle empty or whitespace-only document
    if (!sourceDocument || sourceDocument.trim().length === 0) {
      return this.createResult(citation, false, 0, [], this.config.preferredMethod);
    }

    // Handle empty or whitespace-only claim
    if (!citation.claim || citation.claim.trim().length === 0) {
      return this.createResult(citation, false, 0, [], this.config.preferredMethod);
    }

    // Extract relevant portion of document based on source span
    const relevantText = this.extractRelevantText(sourceDocument, citation.sourceSpan);

    // Perform verification based on preferred method
    let result = await this.verifyWithMethod(citation, relevantText, sourceDocument, this.config.preferredMethod);

    // Fallback to other methods if enabled and initial method fails
    if (this.config.enableFallback && !result.isGrounded && result.groundingScore < this.config.groundingThreshold) {
      const methods: VerificationMethod[] = ['exact_match', 'entailment', 'semantic_similarity'];
      for (const method of methods) {
        if (method !== this.config.preferredMethod) {
          const fallbackResult = await this.verifyWithMethod(citation, relevantText, sourceDocument, method);
          if (fallbackResult.groundingScore > result.groundingScore) {
            result = fallbackResult;
          }
          if (result.isGrounded) break;
        }
      }
    }

    // Update stats
    this.stats.total++;
    if (result.isGrounded) {
      this.stats.grounded++;
    }

    return result;
  }

  /**
   * Verify multiple citations against a source document
   */
  async verifyBatch(citations: Citation[], sourceDocument: string): Promise<VerificationResult[]> {
    const results: VerificationResult[] = [];
    for (const citation of citations) {
      const result = await this.verify(citation, sourceDocument);
      results.push(result);
    }
    return results;
  }

  /**
   * Get accumulated grounding statistics
   */
  getGroundingStats(): GroundingStats {
    return {
      total: this.stats.total,
      grounded: this.stats.grounded,
      accuracy: this.stats.total > 0 ? this.stats.grounded / this.stats.total : 0,
    };
  }

  // ============================================================================
  // PRIVATE HELPER METHODS
  // ============================================================================

  /**
   * Extract relevant text from document based on source span
   */
  private extractRelevantText(document: string, span: { start: number; end: number }): string {
    // Handle invalid span
    if (span.start < 0 || span.end < 0 || span.start > span.end) {
      return document;
    }

    // Handle span beyond document length
    if (span.start >= document.length) {
      return document;
    }

    const end = Math.min(span.end, document.length);
    return document.slice(span.start, end);
  }

  /**
   * Perform verification with a specific method
   */
  private async verifyWithMethod(
    citation: Citation,
    relevantText: string,
    fullDocument: string,
    method: VerificationMethod
  ): Promise<VerificationResult> {
    switch (method) {
      case 'exact_match':
        return this.verifyExactMatch(citation, relevantText, fullDocument);
      case 'entailment':
        return this.verifyEntailment(citation, relevantText, fullDocument);
      case 'semantic_similarity':
        return this.verifySemanticSimilarity(citation, relevantText, fullDocument);
      default:
        return this.verifySemanticSimilarity(citation, relevantText, fullDocument);
    }
  }

  /**
   * Verify using exact text matching
   */
  private verifyExactMatch(
    citation: Citation,
    relevantText: string,
    fullDocument: string
  ): VerificationResult {
    const claim = citation.claim.toLowerCase().trim();
    const textLower = fullDocument.toLowerCase();
    const relevantLower = relevantText.toLowerCase();

    const evidence: string[] = [];
    let score = 0;

    // Check for exact substring match
    if (textLower.includes(claim)) {
      score = 1.0;
      evidence.push(`Exact match found: "${claim.slice(0, 100)}..."`);
    } else {
      // Check for significant word overlap
      const claimWords = this.extractSignificantWords(claim);
      let matchedWords = 0;

      for (const word of claimWords) {
        if (textLower.includes(word) || relevantLower.includes(word)) {
          matchedWords++;
          evidence.push(`Word match: "${word}"`);
        }
      }

      if (claimWords.length > 0) {
        score = matchedWords / claimWords.length;
      }
    }

    const isGrounded = score >= this.config.groundingThreshold;
    return this.createResult(citation, isGrounded, score, evidence, 'exact_match');
  }

  /**
   * Verify using entailment (logical deduction)
   */
  private verifyEntailment(
    citation: Citation,
    relevantText: string,
    fullDocument: string
  ): VerificationResult {
    const claim = citation.claim.toLowerCase();
    const textLower = fullDocument.toLowerCase();
    const relevantLower = relevantText.toLowerCase();

    const evidence: string[] = [];
    let score = 0;
    let hasContradiction = false;

    // Extract identifiers and relationships from claim
    const identifiers = this.extractIdentifiers(citation.claim);
    const relationships = this.detectRelationships(claim);

    // Check if identifiers exist in document
    let identifierScore = 0;
    for (const id of identifiers) {
      if (textLower.includes(id.toLowerCase())) {
        identifierScore += 1;
        evidence.push(`Found identifier: "${id}"`);
      }
    }
    if (identifiers.length > 0) {
      identifierScore = identifierScore / identifiers.length;
    }

    // Check for relationship patterns and contradictions
    let relationshipScore = 0;
    for (const rel of relationships) {
      const pattern = RELATIONSHIP_PATTERNS.find((p) => p.name === rel.type);
      if (pattern) {
        // Check if the exact relationship exists in the document
        const relationshipMatch = this.checkExactRelationship(rel, textLower, relevantLower);
        if (relationshipMatch.matches) {
          relationshipScore += pattern.bonus;
          evidence.push(`Relationship found: ${rel.subject} ${rel.type} ${rel.object}`);
        } else if (relationshipMatch.contradicts) {
          // Found a contradicting relationship (e.g., extends different class)
          hasContradiction = true;
          evidence.push(`Contradiction: ${rel.subject} ${rel.type} ${relationshipMatch.actualObject} (not ${rel.object})`);
        }
      }
    }

    // If there's a contradiction, significantly reduce the score
    if (hasContradiction) {
      score = Math.min(0.3, identifierScore * 0.3);
    } else {
      // Combine scores
      score = Math.min(1.0, identifierScore * 0.6 + relationshipScore + 0.2);

      // Boost score if multiple key terms are found together
      if (identifierScore > 0.5 && relationshipScore > 0.1) {
        score = Math.min(1.0, score + 0.15);
      }
    }

    const isGrounded = score >= this.config.groundingThreshold;
    return this.createResult(citation, isGrounded, score, evidence, 'entailment');
  }

  /**
   * Verify using semantic similarity
   */
  private verifySemanticSimilarity(
    citation: Citation,
    relevantText: string,
    fullDocument: string
  ): VerificationResult {
    const claim = citation.claim.toLowerCase();
    const textLower = fullDocument.toLowerCase();
    const relevantLower = relevantText.toLowerCase();

    const evidence: string[] = [];
    let hasContradiction = false;

    // Extract terms from claim
    const claimTerms = this.extractTerms(citation.claim);

    if (claimTerms.length === 0) {
      return this.createResult(citation, false, 0, evidence, 'semantic_similarity');
    }

    // Check for relationship contradictions first
    const relationships = this.detectRelationships(claim);
    for (const rel of relationships) {
      const relationshipMatch = this.checkExactRelationship(rel, textLower, relevantLower);
      if (relationshipMatch.contradicts) {
        hasContradiction = true;
        evidence.push(`Contradiction: ${rel.subject} ${rel.type} ${relationshipMatch.actualObject} (not ${rel.object})`);
      } else if (relationshipMatch.matches) {
        evidence.push(`Relationship verified: ${rel.subject} ${rel.type} ${rel.object}`);
      }
    }

    // If contradiction found, return low score immediately
    if (hasContradiction) {
      return this.createResult(citation, false, 0.2, evidence, 'semantic_similarity');
    }

    // Calculate term overlap
    let matchedTerms = 0;
    let exactMatches = 0;
    const combinedText = textLower + ' ' + relevantLower;

    for (const term of claimTerms) {
      const termLower = term.toLowerCase();

      if (combinedText.includes(termLower)) {
        matchedTerms++;
        // Check for exact word boundary match
        const wordBoundaryRegex = new RegExp(`\\b${this.escapeRegex(termLower)}\\b`, 'i');
        if (wordBoundaryRegex.test(combinedText)) {
          exactMatches++;
          evidence.push(`Exact term match: "${term}"`);
        } else {
          evidence.push(`Partial term match: "${term}"`);
        }
      }
    }

    // Calculate base overlap score
    const overlapScore = matchedTerms / claimTerms.length;
    const exactRatio = exactMatches / claimTerms.length;

    // Apply exact match weight
    let weightedScore =
      overlapScore * (1 - this.config.exactMatchWeight) +
      exactRatio * this.config.exactMatchWeight +
      overlapScore * this.config.exactMatchWeight * 0.3;

    // Check for relationship pattern bonuses
    let patternBonus = 0;
    for (const pattern of RELATIONSHIP_PATTERNS) {
      const claimHasPattern = pattern.keywords.some((kw) => claim.includes(kw));
      const textHasPattern = pattern.keywords.some((kw) => combinedText.includes(kw));

      if (claimHasPattern && textHasPattern) {
        patternBonus += pattern.bonus;
      }
    }

    // Combine scores
    let finalScore = Math.min(1.0, weightedScore + patternBonus);

    // Boost for high term overlap with relationship match
    if (overlapScore > 0.6 && patternBonus > 0.1) {
      finalScore = Math.min(1.0, finalScore + 0.1);
    }

    const isGrounded = finalScore >= this.config.groundingThreshold;
    return this.createResult(citation, isGrounded, finalScore, evidence, 'semantic_similarity');
  }

  /**
   * Create a verification result
   */
  private createResult(
    citation: Citation,
    isGrounded: boolean,
    groundingScore: number,
    evidence: string[],
    method: VerificationMethod
  ): VerificationResult {
    return {
      citation,
      isGrounded,
      groundingScore,
      evidence,
      method,
    };
  }

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
      'the', 'that', 'this', 'with', 'from', 'have', 'has', 'had',
      'will', 'would', 'could', 'should', 'been', 'being', 'were',
      'which', 'their', 'about', 'into', 'does', 'function', 'class',
      'method', 'parameter', 'returns', 'takes', 'type', 'interface',
      'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'her',
      'was', 'one', 'our', 'out', 'day', 'get', 'him', 'his', 'how',
      'its', 'may', 'new', 'now', 'old', 'see', 'way', 'who', 'any',
    ]);

    const wordMatches = text.matchAll(/\b([a-zA-Z][a-zA-Z0-9]{3,})\b/gi);
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
   * Extract identifiers from text (CamelCase, snake_case, backtick-quoted)
   */
  private extractIdentifiers(text: string): string[] {
    const identifiers: string[] = [];
    const seen = new Set<string>();

    // Backtick-quoted identifiers
    const backtickMatches = text.matchAll(/[`'](\w+)[`']/g);
    for (const match of backtickMatches) {
      if (!seen.has(match[1].toLowerCase())) {
        identifiers.push(match[1]);
        seen.add(match[1].toLowerCase());
      }
    }

    // CamelCase identifiers
    const camelCaseMatches = text.matchAll(/\b([A-Z][a-zA-Z0-9]*)\b/g);
    for (const match of camelCaseMatches) {
      if (!seen.has(match[1].toLowerCase())) {
        identifiers.push(match[1]);
        seen.add(match[1].toLowerCase());
      }
    }

    // lowerCamelCase identifiers
    const lowerCamelMatches = text.matchAll(/\b([a-z]+[A-Z][a-zA-Z0-9]*)\b/g);
    for (const match of lowerCamelMatches) {
      if (!seen.has(match[1].toLowerCase())) {
        identifiers.push(match[1]);
        seen.add(match[1].toLowerCase());
      }
    }

    // snake_case identifiers
    const snakeCaseMatches = text.matchAll(/\b([a-z][a-z0-9]*(?:_[a-z0-9]+)+)\b/g);
    for (const match of snakeCaseMatches) {
      if (!seen.has(match[1].toLowerCase())) {
        identifiers.push(match[1]);
        seen.add(match[1].toLowerCase());
      }
    }

    return identifiers;
  }

  /**
   * Extract significant words from text (4+ chars, not common words)
   */
  private extractSignificantWords(text: string): string[] {
    const commonWords = new Set([
      'the', 'that', 'this', 'with', 'from', 'have', 'been', 'being',
      'which', 'their', 'about', 'into', 'does', 'class', 'method',
      'function', 'parameter', 'returns', 'takes', 'type', 'interface',
    ]);

    const words = text.toLowerCase().match(/\b[a-z]{4,}\b/g) || [];
    return words.filter((w) => !commonWords.has(w));
  }

  /**
   * Detect relationships in claim text
   */
  private detectRelationships(claim: string): Array<{ type: string; subject: string; object: string }> {
    const relationships: Array<{ type: string; subject: string; object: string }> = [];
    const claimLower = claim.toLowerCase();

    // Check for "X extends Y" pattern
    const extendsMatch = claimLower.match(/(\w+)\s+(?:extends|inherits\s+from)\s+(\w+)/i);
    if (extendsMatch) {
      relationships.push({
        type: 'extends',
        subject: extendsMatch[1],
        object: extendsMatch[2],
      });
    }

    // Check for "X implements Y" pattern
    const implementsMatch = claimLower.match(/(\w+)\s+implements\s+(\w+)/i);
    if (implementsMatch) {
      relationships.push({
        type: 'implements',
        subject: implementsMatch[1],
        object: implementsMatch[2],
      });
    }

    // Check for "X returns Y" pattern
    const returnsMatch = claimLower.match(/(\w+)\s+(?:returns|return\s+type)\s+([^\s,]+)/i);
    if (returnsMatch) {
      relationships.push({
        type: 'returns',
        subject: returnsMatch[1],
        object: returnsMatch[2],
      });
    }

    // Check for "X has method Y" pattern
    const methodMatch = claimLower.match(/(\w+)\s+has\s+(?:a\s+)?method\s+(\w+)/i);
    if (methodMatch) {
      relationships.push({
        type: 'hasMethod',
        subject: methodMatch[1],
        object: methodMatch[2],
      });
    }

    // Check for "X takes/has parameter Y" pattern
    const paramMatch = claimLower.match(/(\w+)\s+(?:takes|has|accepts)\s+(?:a\s+)?(\w+)\s+parameter/i);
    if (paramMatch) {
      relationships.push({
        type: 'parameter',
        subject: paramMatch[1],
        object: paramMatch[2],
      });
    }

    // Check for "X is async" pattern
    const asyncMatch = claimLower.match(/(\w+)\s+is\s+async/i);
    if (asyncMatch) {
      relationships.push({
        type: 'async',
        subject: asyncMatch[1],
        object: 'async',
      });
    }

    return relationships;
  }

  /**
   * Check if a relationship exists in text
   */
  private checkRelationshipInText(
    relationship: { type: string; subject: string; object: string },
    text: string
  ): boolean {
    const { type, subject, object } = relationship;
    const subjectLower = subject.toLowerCase();
    const objectLower = object.toLowerCase();

    // Check if both subject and object exist in text
    if (!text.includes(subjectLower) && !text.includes(objectLower)) {
      return false;
    }

    // Check for relationship keywords
    const pattern = RELATIONSHIP_PATTERNS.find((p) => p.name === type);
    if (pattern) {
      for (const keyword of pattern.keywords) {
        if (text.includes(keyword)) {
          // Check if subject and object are near the keyword
          const keywordIndex = text.indexOf(keyword);
          const subjectIndex = text.indexOf(subjectLower);
          const objectIndex = text.indexOf(objectLower);

          // Allow for some distance between keyword and entities
          const maxDistance = 100;
          if (
            (subjectIndex >= 0 && Math.abs(subjectIndex - keywordIndex) < maxDistance) ||
            (objectIndex >= 0 && Math.abs(objectIndex - keywordIndex) < maxDistance)
          ) {
            return true;
          }
        }
      }
    }

    // Fallback: check if subject and object appear close together
    const subjectIndex = text.indexOf(subjectLower);
    const objectIndex = text.indexOf(objectLower);
    if (subjectIndex >= 0 && objectIndex >= 0) {
      return Math.abs(subjectIndex - objectIndex) < 150;
    }

    return false;
  }

  /**
   * Check if a specific relationship exists in text with exact matching
   * Returns whether it matches, contradicts, or is neutral
   */
  private checkExactRelationship(
    relationship: { type: string; subject: string; object: string },
    textLower: string,
    relevantLower: string
  ): { matches: boolean; contradicts: boolean; actualObject: string | null } {
    const { type, subject, object } = relationship;
    const subjectLower = subject.toLowerCase();
    const objectLower = object.toLowerCase();
    const combinedText = textLower + ' ' + relevantLower;

    // Check if the subject exists in the text
    if (!combinedText.includes(subjectLower)) {
      return { matches: false, contradicts: false, actualObject: null };
    }

    // Handle different relationship types
    if (type === 'extends') {
      // Look for "class Subject extends ActualParent" pattern
      const extendsRegex = new RegExp(
        `class\\s+${this.escapeRegex(subjectLower)}\\s+extends\\s+(\\w+)`,
        'i'
      );
      const match = combinedText.match(extendsRegex);
      if (match) {
        const actualParent = match[1].toLowerCase();
        if (actualParent === objectLower) {
          return { matches: true, contradicts: false, actualObject: null };
        } else {
          // Subject extends a different class
          return { matches: false, contradicts: true, actualObject: match[1] };
        }
      }
    }

    if (type === 'implements') {
      // Look for "class Subject ... implements ActualInterface" pattern
      const implementsRegex = new RegExp(
        `class\\s+${this.escapeRegex(subjectLower)}[^{]*implements\\s+([\\w,\\s]+)`,
        'i'
      );
      const match = combinedText.match(implementsRegex);
      if (match) {
        const interfaces = match[1].toLowerCase().split(/\s*,\s*/);
        if (interfaces.some((i) => i.trim() === objectLower)) {
          return { matches: true, contradicts: false, actualObject: null };
        } else {
          // Subject implements different interface(s)
          return { matches: false, contradicts: true, actualObject: match[1] };
        }
      }
    }

    if (type === 'hasMethod') {
      // Look for method definition in class
      const methodRegex = new RegExp(
        `(?:async\\s+)?${this.escapeRegex(objectLower)}\\s*\\(`,
        'i'
      );
      if (methodRegex.test(combinedText)) {
        return { matches: true, contradicts: false, actualObject: null };
      }
      // If subject exists but method doesn't, it could be a false claim about method existence
      if (combinedText.includes(subjectLower)) {
        return { matches: false, contradicts: true, actualObject: 'method not found' };
      }
    }

    // For other relationship types, fall back to simpler check
    if (combinedText.includes(objectLower)) {
      return { matches: true, contradicts: false, actualObject: null };
    }

    return { matches: false, contradicts: false, actualObject: null };
  }

  /**
   * Escape special regex characters
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a new Citation Verification Pipeline instance
 *
 * @param config - Optional configuration overrides
 * @returns New CitationVerificationPipeline instance
 */
export function createCitationVerificationPipeline(
  config?: Partial<CitationVerificationConfig>
): CitationVerificationPipeline {
  return new CitationVerificationPipelineImpl(config);
}
