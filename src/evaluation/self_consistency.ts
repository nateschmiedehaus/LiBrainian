/**
 * @fileoverview Self-Consistency Sampling (WU-CONTRA-004)
 *
 * Implements self-consistency sampling for hallucination detection.
 *
 * Self-consistency sampling generates multiple responses to the same query
 * and compares them for consistency. Contradictions between samples indicate
 * potential hallucinations or uncertain information.
 *
 * Key features:
 * - Multiple response generation with temperature variation
 * - Claim extraction and pairwise comparison
 * - Majority voting for final answer
 * - Contradiction detection with severity classification
 * - Target: AUROC >= 0.75 for inconsistency detection
 *
 * @packageDocumentation
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Configuration for sample generation
 */
export interface SamplingConfig {
  /** Number of samples to generate */
  numSamples: number;
  /** Base temperature for generation */
  temperature: number;
  /** Maximum tokens per response */
  maxTokens: number;
  /** Weight for diversity in temperature variation (0-1) */
  diversityWeight: number;
}

/**
 * A single generated response sample
 */
export interface ResponseSample {
  /** Unique identifier for this sample */
  id: string;
  /** The generated response text */
  response: string;
  /** Confidence score for this response (0-1) */
  confidence: number;
  /** Parameters used during generation */
  generationParams: Record<string, unknown>;
}

/**
 * Result of checking consistency across samples
 */
export interface ConsistencyResult {
  /** All samples that were compared */
  samples: ResponseSample[];
  /** Overall consistency score (0-1) */
  consistencyScore: number;
  /** Claims that multiple samples agreed on */
  agreements: Agreement[];
  /** Contradictions detected between samples */
  contradictions: Contradiction[];
  /** The most common answer (if determinable) */
  majorityAnswer?: string;
}

/**
 * An agreement between multiple samples on a claim
 */
export interface Agreement {
  /** IDs of samples that agree on this claim */
  sampleIds: string[];
  /** The claim text that samples agree on */
  claim: string;
  /** Confidence in this agreement (0-1) */
  confidence: number;
}

/**
 * A contradiction between two samples
 */
export interface Contradiction {
  /** ID of the first sample */
  sample1Id: string;
  /** ID of the second sample */
  sample2Id: string;
  /** The claim from the first sample */
  claim1: string;
  /** The claim from the second sample */
  claim2: string;
  /** Severity of the contradiction */
  severity: 'minor' | 'major' | 'critical';
}

/**
 * Result of inconsistency detection
 */
export interface InconsistencyDetectionResult {
  /** Whether significant inconsistency was detected */
  isInconsistent: boolean;
  /** Score indicating level of inconsistency (0-1) */
  inconsistencyScore: number;
  /** AUROC score if available */
  auroc?: number;
  /** List of detected contradictions */
  detectedContradictions: Contradiction[];
  /** Recommendation for handling the inconsistency */
  recommendation: string;
}

// ============================================================================
// DEFAULT CONFIGURATION
// ============================================================================

/**
 * Default configuration for self-consistency sampling
 */
export const DEFAULT_SAMPLING_CONFIG: SamplingConfig = {
  numSamples: 5,
  temperature: 0.7,
  maxTokens: 1000,
  diversityWeight: 0.3,
};

// ============================================================================
// CLAIM EXTRACTION PATTERNS
// ============================================================================

interface ClaimPattern {
  pattern: RegExp;
  type: 'numeric' | 'type' | 'boolean' | 'location' | 'general';
}

const CLAIM_PATTERNS: ClaimPattern[] = [
  // Numeric claims
  {
    pattern: /(?:has|have|contains?)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(\w+)/gi,
    type: 'numeric',
  },
  // Return type claims
  {
    pattern: /returns?\s+(?:a\s+)?([A-Za-z][A-Za-z0-9<>\[\],\s]*)/gi,
    type: 'type',
  },
  // Is/are type claims
  {
    pattern: /is\s+(?:a|an)\s+(\w+)/gi,
    type: 'type',
  },
  // Boolean claims
  {
    pattern: /(?:is|are)\s+(not\s+)?(\w+)/gi,
    type: 'boolean',
  },
  // Existence claims
  {
    pattern: /(?:does|do)\s+(not\s+)?(?:have|exist|contain)/gi,
    type: 'boolean',
  },
  // Location claims
  {
    pattern: /(?:defined|located|found)\s+in\s+([^\s.]+)/gi,
    type: 'location',
  },
  // Parameter/argument claims
  {
    pattern: /(?:accepts?|takes?)\s+(\d+|one|two|three|four|five)\s+(?:parameters?|arguments?)/gi,
    type: 'numeric',
  },
  // Answer is X pattern
  {
    pattern: /(?:answer|value|result)\s+is\s+(\w+)/gi,
    type: 'general',
  },
];

// Numeric word mapping
const NUMERIC_WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

// Synonyms for semantic similarity
const SYNONYM_GROUPS: string[][] = [
  ['string', 'text', 'str'],
  ['number', 'integer', 'int', 'numeric', 'float', 'double'],
  ['boolean', 'bool', 'true', 'false'],
  ['array', 'list', 'collection'],
  ['object', 'map', 'dictionary', 'dict', 'record'],
  ['parameter', 'argument', 'arg', 'param', 'input'],
  ['return', 'give', 'output', 'produce'],
  ['method', 'function', 'func'],
  ['class', 'type', 'interface'],
  ['yes', 'true', 'correct', 'right'],
  ['no', 'false', 'incorrect', 'wrong'],
];

// ============================================================================
// SELF-CONSISTENCY CHECKER CLASS
// ============================================================================

/**
 * Generator function type for creating responses
 */
export type ResponseGenerator = (
  query: string,
  params: { temperature: number; maxTokens: number }
) => Promise<string>;

/**
 * Self-Consistency Checker for hallucination detection
 *
 * Generates multiple responses to the same query and compares them
 * for consistency, detecting contradictions and inconsistencies.
 */
export class SelfConsistencyChecker {
  private config: SamplingConfig;
  private sampleIdCounter = 0;

  constructor(config?: Partial<SamplingConfig>) {
    this.config = { ...DEFAULT_SAMPLING_CONFIG, ...config };
  }

  /**
   * Generate multiple response samples for a query
   */
  async generateSamples(
    query: string,
    config: SamplingConfig,
    generator: ResponseGenerator
  ): Promise<ResponseSample[]> {
    const samples: ResponseSample[] = [];
    const { numSamples, temperature, maxTokens, diversityWeight } = config;

    for (let i = 0; i < numSamples; i++) {
      try {
        // Vary temperature for diversity
        const tempVariation = diversityWeight * (Math.random() - 0.5) * 0.4;
        const adjustedTemp = Math.max(0, Math.min(2, temperature + tempVariation));

        const params = { temperature: adjustedTemp, maxTokens };
        const response = await generator(query, params);

        samples.push({
          id: this.generateSampleId(),
          response,
          confidence: this.estimateConfidence(response),
          generationParams: { temperature: adjustedTemp, maxTokens },
        });
      } catch (error) {
        // Continue with other samples on error
        continue;
      }
    }

    return samples;
  }

  /**
   * Extract claims from a response
   */
  extractClaims(response: string): string[] {
    if (!response || response.trim().length === 0) {
      return [];
    }

    const claims: string[] = [];
    const normalizedResponse = response.toLowerCase();

    // Extract claims using patterns
    for (const claimPattern of CLAIM_PATTERNS) {
      const regex = new RegExp(claimPattern.pattern.source, claimPattern.pattern.flags);
      let match: RegExpExecArray | null;

      while ((match = regex.exec(normalizedResponse)) !== null) {
        const claim = this.normalizeClaim(match[0]);
        if (claim && !claims.includes(claim)) {
          claims.push(claim);
        }
      }
    }

    // Also extract sentence-level claims if pattern extraction is sparse
    if (claims.length < 2) {
      const sentences = normalizedResponse
        .split(/[.!?]+/)
        .filter((s) => s.trim().length > 10);

      for (const sentence of sentences.slice(0, 5)) {
        const claim = this.normalizeClaim(sentence);
        if (claim && !claims.includes(claim)) {
          claims.push(claim);
        }
      }
    }

    return claims;
  }

  /**
   * Compare two claims and determine their relationship
   */
  compareClaims(claim1: string, claim2: string): 'agree' | 'contradict' | 'neutral' {
    if (!claim1 || !claim2) {
      return 'neutral';
    }

    const norm1 = this.normalizeClaim(claim1);
    const norm2 = this.normalizeClaim(claim2);

    if (!norm1 || !norm2) {
      return 'neutral';
    }

    // Exact match
    if (norm1 === norm2) {
      return 'agree';
    }

    // Check for numeric contradiction
    const num1 = this.extractNumber(norm1);
    const num2 = this.extractNumber(norm2);
    const hasNumericContext1 = this.hasNumericContext(norm1);
    const hasNumericContext2 = this.hasNumericContext(norm2);

    if (num1 !== null && num2 !== null && hasNumericContext1 && hasNumericContext2) {
      // Both have numbers in similar context
      const context1 = this.getNumericContext(norm1);
      const context2 = this.getNumericContext(norm2);

      if (this.contextsMatch(context1, context2)) {
        return num1 === num2 ? 'agree' : 'contradict';
      }
    }

    // Check for "answer/value is X" pattern specifically
    const answerMatch1 = norm1.match(/(?:answer|value|result)\s+is\s+(\w+)/i);
    const answerMatch2 = norm2.match(/(?:answer|value|result)\s+is\s+(\w+)/i);

    if (answerMatch1 && answerMatch2) {
      const val1 = answerMatch1[1].toLowerCase();
      const val2 = answerMatch2[1].toLowerCase();
      // Try to parse as numbers
      const numVal1 = parseInt(val1, 10);
      const numVal2 = parseInt(val2, 10);
      if (!isNaN(numVal1) && !isNaN(numVal2)) {
        return numVal1 === numVal2 ? 'agree' : 'contradict';
      }
      // Compare as strings
      return val1 === val2 ? 'agree' : 'contradict';
    }

    // Check for type contradictions
    const type1 = this.extractReturnType(norm1);
    const type2 = this.extractReturnType(norm2);

    if (type1 && type2) {
      if (this.typesMatch(type1, type2)) {
        return 'agree';
      }
      // Both specify a return type but different ones
      return 'contradict';
    }

    // Check for boolean/negation contradiction
    if (this.hasBooleanContradiction(norm1, norm2)) {
      return 'contradict';
    }

    // Check for semantic similarity (agreement)
    const similarity = this.computeSemanticSimilarity(norm1, norm2);
    if (similarity > 0.7) {
      return 'agree';
    }

    // Check if they're about the same topic but saying different things
    const topicOverlap = this.computeTopicOverlap(norm1, norm2);
    if (topicOverlap > 0.5 && similarity < 0.4) {
      // Same topic, low similarity - potential contradiction
      return 'contradict';
    }

    return 'neutral';
  }

  /**
   * Check consistency across multiple response samples
   */
  checkConsistency(samples: ResponseSample[]): ConsistencyResult {
    if (samples.length === 0) {
      return {
        samples: [],
        consistencyScore: 1,
        agreements: [],
        contradictions: [],
        majorityAnswer: undefined,
      };
    }

    if (samples.length === 1) {
      return {
        samples,
        consistencyScore: 1,
        agreements: [],
        contradictions: [],
        majorityAnswer: samples[0].response,
      };
    }

    // Extract claims from all samples
    const sampleClaims = samples.map((s) => ({
      sample: s,
      claims: this.extractClaims(s.response),
    }));

    const agreements: Agreement[] = [];
    const contradictions: Contradiction[] = [];
    const processedPairs = new Set<string>();

    // Pairwise comparison
    for (let i = 0; i < sampleClaims.length; i++) {
      for (let j = i + 1; j < sampleClaims.length; j++) {
        const sample1 = sampleClaims[i];
        const sample2 = sampleClaims[j];
        const pairKey = [sample1.sample.id, sample2.sample.id].sort().join('-');

        if (processedPairs.has(pairKey)) {
          continue;
        }
        processedPairs.add(pairKey);

        // Compare claims between the two samples
        for (const claim1 of sample1.claims) {
          for (const claim2 of sample2.claims) {
            const comparison = this.compareClaims(claim1, claim2);

            if (comparison === 'agree') {
              // Check if this agreement already exists
              const existingAgreement = agreements.find(
                (a) => this.normalizeClaim(a.claim) === this.normalizeClaim(claim1)
              );

              if (existingAgreement) {
                if (!existingAgreement.sampleIds.includes(sample1.sample.id)) {
                  existingAgreement.sampleIds.push(sample1.sample.id);
                }
                if (!existingAgreement.sampleIds.includes(sample2.sample.id)) {
                  existingAgreement.sampleIds.push(sample2.sample.id);
                }
              } else {
                agreements.push({
                  sampleIds: [sample1.sample.id, sample2.sample.id],
                  claim: claim1,
                  confidence: (sample1.sample.confidence + sample2.sample.confidence) / 2,
                });
              }
            } else if (comparison === 'contradict') {
              contradictions.push({
                sample1Id: sample1.sample.id,
                sample2Id: sample2.sample.id,
                claim1,
                claim2,
                severity: this.classifySeverity(claim1, claim2),
              });
            }
          }
        }

        // Also compare full responses for high-level consistency
        const responseComparison = this.compareClaims(
          sample1.sample.response,
          sample2.sample.response
        );

        if (responseComparison === 'contradict' && contradictions.length === 0) {
          // High-level contradiction detected
          contradictions.push({
            sample1Id: sample1.sample.id,
            sample2Id: sample2.sample.id,
            claim1: this.summarizeResponse(sample1.sample.response),
            claim2: this.summarizeResponse(sample2.sample.response),
            severity: 'major',
          });
        }
      }
    }

    // Calculate consistency score
    const totalComparisons = (samples.length * (samples.length - 1)) / 2;
    const consistencyScore = this.calculateConsistencyScore(
      agreements.length,
      contradictions.length,
      totalComparisons
    );

    // Determine majority answer
    const majorityAnswer = this.determineMajorityAnswer(samples);

    return {
      samples,
      consistencyScore,
      agreements,
      contradictions,
      majorityAnswer,
    };
  }

  /**
   * Detect inconsistencies from a consistency result
   */
  detectInconsistencies(result: ConsistencyResult): InconsistencyDetectionResult {
    const hasContradictions = result.contradictions.length > 0;
    const inconsistencyScore = 1 - result.consistencyScore;

    // Threshold for determining significant inconsistency
    const inconsistencyThreshold = 0.3;
    const isInconsistent = inconsistencyScore > inconsistencyThreshold || hasContradictions;

    // Generate recommendation
    let recommendation: string;
    if (!isInconsistent) {
      recommendation = 'Responses are consistent. High confidence in the answer.';
    } else if (result.contradictions.some((c) => c.severity === 'critical')) {
      recommendation = 'Critical contradictions detected. Exercise extreme caution and verify with authoritative sources.';
    } else if (result.contradictions.some((c) => c.severity === 'major')) {
      recommendation = 'Major contradictions detected. Recommend verification before use.';
    } else {
      recommendation = 'Minor inconsistencies detected. Consider rephrasing query for clarification.';
    }

    return {
      isInconsistent,
      inconsistencyScore,
      detectedContradictions: result.contradictions,
      recommendation,
    };
  }

  // ============================================================================
  // PRIVATE HELPER METHODS
  // ============================================================================

  private generateSampleId(): string {
    return `sample-${++this.sampleIdCounter}-${Date.now().toString(36)}`;
  }

  private estimateConfidence(response: string): number {
    // Simple heuristic-based confidence estimation
    let confidence = 0.7;

    // Reduce for hedging language
    const hedgingPatterns = /\b(may|might|possibly|perhaps|unclear|uncertain|not sure)\b/gi;
    const hedgingCount = (response.match(hedgingPatterns) || []).length;
    confidence -= hedgingCount * 0.05;

    // Increase for confident language
    const confidentPatterns = /\b(definitely|certainly|always|never|exactly)\b/gi;
    const confidentCount = (response.match(confidentPatterns) || []).length;
    confidence += confidentCount * 0.03;

    // Clamp to valid range
    return Math.max(0.1, Math.min(0.95, confidence));
  }

  private normalizeClaim(claim: string): string {
    let normalized = claim
      .toLowerCase()
      .replace(/[^\w\s<>[\],.-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // Convert numeric words to digits
    for (const [word, digit] of Object.entries(NUMERIC_WORDS)) {
      normalized = normalized.replace(new RegExp(`\\b${word}\\b`, 'g'), String(digit));
    }

    return normalized;
  }

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

  private hasNumericContext(text: string): boolean {
    const numericContextPatterns = [
      /\d+\s+\w+/,
      /has\s+\d+/,
      /contains?\s+\d+/,
      /\d+\s+method/,
      /\d+\s+parameter/,
      /\d+\s+argument/,
      /\d+\s+propert/,
    ];

    return numericContextPatterns.some((p) => p.test(text));
  }

  private getNumericContext(text: string): string {
    // Extract words around the number
    const match = text.match(/(\w+\s+)?(\d+)\s+(\w+)/);
    if (match) {
      return match[3].toLowerCase();
    }
    return '';
  }

  private contextsMatch(context1: string, context2: string): boolean {
    if (context1 === context2) {
      return true;
    }

    // Check synonyms
    for (const group of SYNONYM_GROUPS) {
      const c1InGroup = group.some((w) => context1.includes(w));
      const c2InGroup = group.some((w) => context2.includes(w));
      if (c1InGroup && c2InGroup) {
        return true;
      }
    }

    return false;
  }

  private extractReturnType(text: string): string | null {
    const patterns = [
      /returns?\s+(?:a|an)\s+(\w+(?:<[^>]+>)?)/i,
      /returns?\s+(\w+(?:<[^>]+>)?)/i,
      /return\s+type\s+(?:is\s+)?(\w+)/i,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        const type = match[1].toLowerCase();
        // Normalize synonyms to canonical form
        for (const group of SYNONYM_GROUPS) {
          if (group.includes(type)) {
            return group[0]; // Return canonical form (first in group)
          }
        }
        return type;
      }
    }

    return null;
  }

  private typesMatch(type1: string, type2: string): boolean {
    if (type1 === type2) {
      return true;
    }

    // Check synonyms
    for (const group of SYNONYM_GROUPS) {
      const t1InGroup = group.includes(type1);
      const t2InGroup = group.includes(type2);
      if (t1InGroup && t2InGroup) {
        return true;
      }
    }

    return false;
  }

  private hasBooleanContradiction(claim1: string, claim2: string): boolean {
    // Check for explicit negation patterns where one says "is X" and other says "is not X"
    // Pattern: "is <word>" vs "is not <word>"
    const isMatch1 = claim1.match(/\bis\s+(not\s+)?(\w+)\b/i);
    const isMatch2 = claim2.match(/\bis\s+(not\s+)?(\w+)\b/i);

    if (isMatch1 && isMatch2) {
      const word1 = isMatch1[2].toLowerCase();
      const word2 = isMatch2[2].toLowerCase();
      const negated1 = !!isMatch1[1];
      const negated2 = !!isMatch2[1];

      // Same word, different negation = contradiction
      if (word1 === word2 && negated1 !== negated2) {
        return true;
      }
    }

    // Check for "does/do not exist" vs "exists"
    const exists1 = /\bexists?\b/i.test(claim1) && !/\bnot\s+exist/i.test(claim1);
    const notExists1 = /\b(?:does\s+)?not\s+exist/i.test(claim1);
    const exists2 = /\bexists?\b/i.test(claim2) && !/\bnot\s+exist/i.test(claim2);
    const notExists2 = /\b(?:does\s+)?not\s+exist/i.test(claim2);

    if ((exists1 && notExists2) || (notExists1 && exists2)) {
      return true;
    }

    // Check for "has" vs "does not have"
    const has1 = /\bhas\s+/i.test(claim1) && !/\bnot\s+have/i.test(claim1);
    const notHas1 = /\b(?:does\s+)?not\s+have/i.test(claim1);
    const has2 = /\bhas\s+/i.test(claim2) && !/\bnot\s+have/i.test(claim2);
    const notHas2 = /\b(?:does\s+)?not\s+have/i.test(claim2);

    if ((has1 && notHas2) || (notHas1 && has2)) {
      return true;
    }

    // Check for yes/no contradiction
    const yes1 = /\b(yes|true|correct)\b/i.test(claim1);
    const no1 = /\b(no|false|incorrect)\b/i.test(claim1);
    const yes2 = /\b(yes|true|correct)\b/i.test(claim2);
    const no2 = /\b(no|false|incorrect)\b/i.test(claim2);

    if ((yes1 && no2) || (no1 && yes2)) {
      return true;
    }

    return false;
  }

  private computeSemanticSimilarity(text1: string, text2: string): number {
    // Simple word overlap-based similarity with synonym expansion
    const words1 = new Set(text1.split(/\s+/).filter((w) => w.length > 2));
    const words2 = new Set(text2.split(/\s+/).filter((w) => w.length > 2));

    if (words1.size === 0 || words2.size === 0) {
      return 0;
    }

    // Expand with synonyms
    const expandedWords1 = this.expandWithSynonyms(words1);
    const expandedWords2 = this.expandWithSynonyms(words2);

    // Calculate Jaccard similarity
    const intersection = new Set(Array.from(expandedWords1).filter((w) => expandedWords2.has(w)));
    const union = new Set([...Array.from(expandedWords1), ...Array.from(expandedWords2)]);

    return intersection.size / union.size;
  }

  private expandWithSynonyms(words: Set<string>): Set<string> {
    const expanded = new Set(words);

    for (const word of Array.from(words)) {
      for (const group of SYNONYM_GROUPS) {
        if (group.includes(word)) {
          for (const synonym of group) {
            expanded.add(synonym);
          }
        }
      }
    }

    return expanded;
  }

  private computeTopicOverlap(text1: string, text2: string): number {
    // Extract key terms (nouns, verbs)
    const keyTerms1 = this.extractKeyTerms(text1);
    const keyTerms2 = this.extractKeyTerms(text2);

    if (keyTerms1.size === 0 || keyTerms2.size === 0) {
      return 0;
    }

    const intersection = new Set(Array.from(keyTerms1).filter((t) => keyTerms2.has(t)));
    return intersection.size / Math.min(keyTerms1.size, keyTerms2.size);
  }

  private extractKeyTerms(text: string): Set<string> {
    const stopWords = new Set([
      'the', 'a', 'an', 'is', 'are', 'was', 'were', 'has', 'have', 'had',
      'does', 'do', 'did', 'what', 'how', 'many', 'which', 'that', 'this',
      'it', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with',
    ]);

    return new Set(
      text
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 2 && !stopWords.has(w))
    );
  }

  private classifySeverity(claim1: string, claim2: string): 'minor' | 'major' | 'critical' {
    // Type contradictions are major or critical
    const type1 = this.extractReturnType(claim1);
    const type2 = this.extractReturnType(claim2);
    if (type1 && type2 && type1 !== type2) {
      return 'major';
    }

    // Existence contradictions are major
    if (this.hasBooleanContradiction(claim1, claim2)) {
      return 'major';
    }

    // Large numeric differences are critical
    const num1 = this.extractNumber(claim1);
    const num2 = this.extractNumber(claim2);
    if (num1 !== null && num2 !== null) {
      const diff = Math.abs(num1 - num2);
      const maxNum = Math.max(num1, num2);
      if (maxNum > 0 && diff / maxNum > 0.5) {
        return 'critical';
      }
      if (diff > 0) {
        return 'major';
      }
    }

    return 'minor';
  }

  private summarizeResponse(response: string): string {
    // Return first sentence or first 100 characters
    const firstSentence = response.split(/[.!?]/)[0];
    if (firstSentence.length <= 100) {
      return firstSentence.trim();
    }
    return response.slice(0, 100).trim() + '...';
  }

  private calculateConsistencyScore(
    agreementCount: number,
    contradictionCount: number,
    totalComparisons: number
  ): number {
    if (totalComparisons === 0) {
      return 1;
    }

    // Weight contradictions more heavily
    const contradictionWeight = 2;
    const effectiveContradictions = contradictionCount * contradictionWeight;

    // Score based on ratio of agreements to total considering contradictions
    const positiveSignals = agreementCount;
    const negativeSignals = effectiveContradictions;
    const totalSignals = positiveSignals + negativeSignals;

    if (totalSignals === 0) {
      return 0.5; // Neutral when no signals
    }

    return positiveSignals / totalSignals;
  }

  private determineMajorityAnswer(samples: ResponseSample[]): string | undefined {
    if (samples.length === 0) {
      return undefined;
    }

    if (samples.length === 1) {
      return samples[0].response;
    }

    // Group similar responses
    const groups: { representative: string; samples: ResponseSample[]; totalConfidence: number }[] = [];

    for (const sample of samples) {
      let foundGroup = false;

      for (const group of groups) {
        const similarity = this.computeSemanticSimilarity(
          this.normalizeClaim(sample.response),
          this.normalizeClaim(group.representative)
        );

        if (similarity > 0.6) {
          group.samples.push(sample);
          group.totalConfidence += sample.confidence;
          foundGroup = true;
          break;
        }
      }

      if (!foundGroup) {
        groups.push({
          representative: sample.response,
          samples: [sample],
          totalConfidence: sample.confidence,
        });
      }
    }

    // Find the group with most samples (and highest confidence as tiebreaker)
    groups.sort((a, b) => {
      if (b.samples.length !== a.samples.length) {
        return b.samples.length - a.samples.length;
      }
      return b.totalConfidence - a.totalConfidence;
    });

    return groups[0]?.representative;
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a new SelfConsistencyChecker instance
 */
export function createSelfConsistencyChecker(
  config?: Partial<SamplingConfig>
): SelfConsistencyChecker {
  return new SelfConsistencyChecker(config);
}
