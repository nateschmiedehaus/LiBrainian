/**
 * @fileoverview Consistency Checker (WU-805)
 *
 * Detects when Librarian gives contradictory answers to semantically equivalent
 * questions. This is a hallucination detection mechanism that works by querying
 * the same information in different ways and checking if the answers are consistent.
 *
 * @packageDocumentation
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * A variant of a query (paraphrase)
 */
export interface QueryVariant {
  /** Unique identifier for this variant */
  id: string;
  /** The query text */
  query: string;
  /** Whether this is the canonical (base) question */
  isCanonical: boolean;
}

/**
 * A set of semantically equivalent queries
 */
export interface QuerySet {
  /** The canonical (base) query */
  canonicalQuery: string;
  /** All variants including the canonical query */
  variants: QueryVariant[];
  /** What the questions are about */
  topic: string;
}

/**
 * An answer to a consistency check query
 */
export interface ConsistencyAnswer {
  /** ID of the query this answers */
  queryId: string;
  /** The query text */
  query: string;
  /** The full answer text */
  answer: string;
  /** Key facts extracted from the answer */
  extractedFacts: string[];
}

/**
 * A detected consistency violation
 */
export interface ConsistencyViolation {
  /** Topic of the query set */
  querySetTopic: string;
  /** The canonical query that was asked */
  canonicalQuery: string;
  /** The answers that conflict */
  conflictingAnswers: ConsistencyAnswer[];
  /** Type of conflict detected */
  conflictType: 'direct_contradiction' | 'partial_conflict' | 'missing_fact' | 'extra_fact';
  /** How severe the conflict is */
  severity: 'high' | 'medium' | 'low';
  /** Human-readable explanation of the conflict */
  explanation: string;
}

/**
 * Report from running consistency checks
 */
export interface ConsistencyReport {
  /** Total number of query sets checked */
  totalQuerySets: number;
  /** Number of query sets with consistent answers */
  consistentSets: number;
  /** Number of query sets with inconsistent answers */
  inconsistentSets: number;
  /** Consistency rate (consistentSets / totalQuerySets) */
  consistencyRate: number;
  /** All detected violations */
  violations: ConsistencyViolation[];
  /** Summary statistics */
  summary: {
    directContradictions: number;
    partialConflicts: number;
    missingFacts: number;
    extraFacts: number;
  };
}

// ============================================================================
// QUERY VARIANT TEMPLATES
// ============================================================================

interface QueryTemplate {
  pattern: RegExp;
  variants: ((match: RegExpMatchArray) => string)[];
}

const PARAMETER_TEMPLATES: QueryTemplate = {
  pattern: /what\s+(?:parameters?|arguments?)\s+does\s+(?:function\s+)?(\w+)\s+(?:accept|take)/i,
  variants: [
    (m) => `What are the arguments to function ${m[1]}?`,
    (m) => `What inputs does ${m[1]} take?`,
    (m) => `Describe the parameters of ${m[1]}`,
    (m) => `List function ${m[1]}'s parameters`,
    (m) => `What does ${m[1]} accept as parameters?`,
  ],
};

const RETURN_TYPE_TEMPLATES: QueryTemplate = {
  pattern: /what\s+does\s+(?:function\s+)?(\w+)\s+return/i,
  variants: [
    (m) => `What is the return type of ${m[1]}?`,
    (m) => `What does ${m[1]} give back?`,
    (m) => `Describe what ${m[1]} returns`,
    (m) => `What type does ${m[1]} return?`,
  ],
};

const DEFINITION_TEMPLATES: QueryTemplate = {
  pattern: /where\s+is\s+(?:function\s+)?(\w+)\s+defined/i,
  variants: [
    (m) => `In which file is ${m[1]} located?`,
    (m) => `Where can I find the definition of ${m[1]}?`,
    (m) => `What file contains ${m[1]}?`,
    (m) => `Where is ${m[1]} implemented?`,
  ],
};

const PURPOSE_TEMPLATES: QueryTemplate = {
  pattern: /what\s+does\s+(?:the\s+)?(\w+)\s+(?:class\s+)?do/i,
  variants: [
    (m) => `What is the purpose of ${m[1]}?`,
    (m) => `Describe what ${m[1]} does`,
    (m) => `Explain the functionality of ${m[1]}`,
    (m) => `What is ${m[1]} responsible for?`,
  ],
};

const METHOD_TEMPLATES: QueryTemplate = {
  pattern: /what\s+methods?\s+does\s+(?:the\s+)?(\w+)\s+(?:class\s+)?have/i,
  variants: [
    (m) => `List the methods of ${m[1]}`,
    (m) => `What functions does ${m[1]} provide?`,
    (m) => `Describe the methods in ${m[1]}`,
    (m) => `What can you call on ${m[1]}?`,
  ],
};

const ALL_TEMPLATES: QueryTemplate[] = [
  PARAMETER_TEMPLATES,
  RETURN_TYPE_TEMPLATES,
  DEFINITION_TEMPLATES,
  PURPOSE_TEMPLATES,
  METHOD_TEMPLATES,
];

// ============================================================================
// FACT EXTRACTION PATTERNS
// ============================================================================

const FACT_PATTERNS = [
  // Parameter patterns
  /(?:accepts?|takes?|has)\s+(\d+|one|two|three|four|five)\s+(?:parameters?|arguments?)/gi,
  /parameter\s+(\w+)\s+(?:is\s+)?(?:of\s+)?type\s+(\w+)/gi,
  /(\w+)\s+(?:is\s+)?(?:a\s+)?(\w+)\s+parameter/gi,

  // Return type patterns
  /returns?\s+(?:a\s+)?(?:the\s+)?(\w+(?:<[^>]+>)?)/gi,
  /return\s+type\s+(?:is\s+)?(\w+(?:<[^>]+>)?)/gi,

  // Location patterns
  /(?:defined|located|found|implemented)\s+in\s+([^\s,]+\.tsx?)/gi,
  /(?:in\s+)?([^\s]+\.tsx?)\s+(?:at\s+)?line\s+(\d+)/gi,
  /line\s+(\d+)/gi,

  // Type patterns
  /(?:type|interface)\s+(\w+)/gi,
  /(\w+)\s+(?:is\s+)?(?:of\s+)?type\s+(\w+)/gi,

  // List extraction
  /(?:parameters?|arguments?):\s*([^.]+)/gi,
  /(?:methods?|functions?):\s*([^.]+)/gi,
];

// Numeric word to digit mapping
const NUMERIC_WORDS: Record<string, string> = {
  zero: '0',
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
  ten: '10',
};

// Synonym groups for semantic equivalence
const SYNONYM_GROUPS: string[][] = [
  ['parameter', 'parameters', 'argument', 'arguments', 'arg', 'args', 'param', 'params', 'input', 'inputs'],
  ['accepts', 'accept', 'takes', 'take', 'receives', 'receive', 'has'],
  ['returns', 'return', 'gives', 'give', 'outputs', 'output', 'produces', 'produce'],
  ['defined', 'located', 'found', 'implemented', 'declared'],
  ['function', 'method', 'func'],
  ['class', 'type', 'interface'],
];

// ============================================================================
// CONSISTENCY CHECKER CLASS
// ============================================================================

/**
 * Checks consistency of answers to semantically equivalent questions
 */
export class ConsistencyChecker {
  private variantIdCounter = 0;

  /**
   * Generate query variants (paraphrases) for a base question
   */
  generateVariants(baseQuery: string, topic: string): QuerySet {
    const variants: QueryVariant[] = [];

    // Add the canonical query
    variants.push({
      id: this.nextVariantId(),
      query: baseQuery,
      isCanonical: true,
    });

    // Try to match against templates
    for (const template of ALL_TEMPLATES) {
      const match = baseQuery.match(template.pattern);
      if (match) {
        for (const variantFn of template.variants) {
          const variantQuery = variantFn(match);
          // Avoid duplicates
          if (!variants.some((v) => v.query.toLowerCase() === variantQuery.toLowerCase())) {
            variants.push({
              id: this.nextVariantId(),
              query: variantQuery,
              isCanonical: false,
            });
          }
        }
        break; // Only use first matching template
      }
    }

    // If no templates matched, generate generic variants
    if (variants.length === 1) {
      const genericVariants = this.generateGenericVariants(baseQuery);
      for (const query of genericVariants) {
        if (!variants.some((v) => v.query.toLowerCase() === query.toLowerCase())) {
          variants.push({
            id: this.nextVariantId(),
            query,
            isCanonical: false,
          });
        }
      }
    }

    return {
      canonicalQuery: baseQuery,
      variants,
      topic,
    };
  }

  /**
   * Extract key facts from an answer for comparison
   */
  extractFacts(answer: string): string[] {
    if (!answer || answer.trim().length === 0) {
      return [];
    }

    const facts: string[] = [];
    const normalizedAnswer = this.normalizeText(answer);

    // Extract facts using patterns
    for (const pattern of FACT_PATTERNS) {
      // Reset lastIndex for global patterns
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(normalizedAnswer)) !== null) {
        const fact = this.normalizeFact(match[0]);
        if (fact && !facts.includes(fact)) {
          facts.push(fact);
        }
      }
    }

    // Extract sentence-level facts if pattern extraction yields nothing
    if (facts.length === 0) {
      const sentences = normalizedAnswer.split(/[.!?]+/).filter((s) => s.trim().length > 5);
      for (const sentence of sentences.slice(0, 3)) {
        const fact = this.normalizeFact(sentence);
        if (fact && !facts.includes(fact)) {
          facts.push(fact);
        }
      }
    }

    return facts;
  }

  /**
   * Check consistency between a set of answers
   */
  checkConsistency(answers: ConsistencyAnswer[]): ConsistencyViolation | null {
    if (answers.length < 2) {
      return null;
    }

    // Collect all facts
    const answerFacts = answers.map((a) => ({
      answer: a,
      facts: new Set(a.extractedFacts.map((f) => this.normalizeFact(f))),
    }));

    // Handle empty facts case
    const allEmpty = answerFacts.every((af) => af.facts.size === 0);
    if (allEmpty) {
      return null;
    }

    // Check for direct contradictions
    const contradiction = this.findDirectContradiction(answerFacts);
    if (contradiction) {
      return {
        querySetTopic: '',
        canonicalQuery: '',
        conflictingAnswers: [contradiction.answer1.answer, contradiction.answer2.answer],
        conflictType: 'direct_contradiction',
        severity: 'high',
        explanation: contradiction.explanation,
      };
    }

    // Check for partial conflicts (e.g., different counts)
    const partialConflict = this.findPartialConflict(answerFacts);
    if (partialConflict) {
      return {
        querySetTopic: '',
        canonicalQuery: '',
        conflictingAnswers: [partialConflict.answer1.answer, partialConflict.answer2.answer],
        conflictType: 'partial_conflict',
        severity: 'medium',
        explanation: partialConflict.explanation,
      };
    }

    // Check for missing/extra facts
    const factDiff = this.findFactDifference(answerFacts);
    if (factDiff) {
      return {
        querySetTopic: '',
        canonicalQuery: '',
        conflictingAnswers: [factDiff.answer1.answer, factDiff.answer2.answer],
        conflictType: factDiff.type,
        severity: 'low',
        explanation: factDiff.explanation,
      };
    }

    return null;
  }

  /**
   * Run full consistency check across multiple query sets
   */
  async runConsistencyCheck(
    querySets: QuerySet[],
    answerProvider: (query: string) => Promise<string>
  ): Promise<ConsistencyReport> {
    if (querySets.length === 0) {
      return {
        totalQuerySets: 0,
        consistentSets: 0,
        inconsistentSets: 0,
        consistencyRate: 1,
        violations: [],
        summary: {
          directContradictions: 0,
          partialConflicts: 0,
          missingFacts: 0,
          extraFacts: 0,
        },
      };
    }

    const violations: ConsistencyViolation[] = [];
    let consistentSets = 0;

    for (const querySet of querySets) {
      const answers: ConsistencyAnswer[] = [];

      // Get answers for all variants
      for (const variant of querySet.variants) {
        try {
          const answer = await answerProvider(variant.query);
          const extractedFacts = this.extractFacts(answer);
          answers.push({
            queryId: variant.id,
            query: variant.query,
            answer,
            extractedFacts,
          });
        } catch {
          // Skip failed queries but continue with others
          continue;
        }
      }

      // Check consistency
      if (answers.length >= 2) {
        const violation = this.checkConsistency(answers);
        if (violation) {
          violation.querySetTopic = querySet.topic;
          violation.canonicalQuery = querySet.canonicalQuery;
          violations.push(violation);
        } else {
          consistentSets++;
        }
      } else {
        // Not enough answers to compare, consider consistent
        consistentSets++;
      }
    }

    const inconsistentSets = querySets.length - consistentSets;

    // Count violation types
    const summary = {
      directContradictions: violations.filter((v) => v.conflictType === 'direct_contradiction').length,
      partialConflicts: violations.filter((v) => v.conflictType === 'partial_conflict').length,
      missingFacts: violations.filter((v) => v.conflictType === 'missing_fact').length,
      extraFacts: violations.filter((v) => v.conflictType === 'extra_fact').length,
    };

    return {
      totalQuerySets: querySets.length,
      consistentSets,
      inconsistentSets,
      consistencyRate: consistentSets / querySets.length,
      violations,
      summary,
    };
  }

  // ============================================================================
  // PRIVATE HELPER METHODS
  // ============================================================================

  private nextVariantId(): string {
    return `variant-${++this.variantIdCounter}`;
  }

  /**
   * Generate generic variants when no specific template matches
   */
  private generateGenericVariants(baseQuery: string): string[] {
    const variants: string[] = [];

    // Simple rephrasing transformations
    if (baseQuery.toLowerCase().startsWith('what ')) {
      variants.push(baseQuery.replace(/^what /i, 'Describe '));
      variants.push(baseQuery.replace(/^what /i, 'Explain '));
    }

    if (baseQuery.toLowerCase().startsWith('how ')) {
      variants.push(baseQuery.replace(/^how /i, 'In what way '));
    }

    if (baseQuery.includes('?')) {
      // Remove question mark and rephrase as statement request
      const statement = baseQuery.replace(/\?$/, '');
      variants.push(`Tell me about ${statement.toLowerCase()}`);
    }

    return variants;
  }

  /**
   * Normalize text for comparison
   */
  private normalizeText(text: string): string {
    return text
      .toLowerCase()
      .replace(/```[\s\S]*?```/g, '') // Remove code blocks
      .replace(/`[^`]+`/g, (match) => match.slice(1, -1)) // Remove backticks but keep content
      .replace(/[^\w\s<>/.:-]/g, ' ') // Keep alphanumeric, angle brackets, slashes, colons
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Normalize a single fact for comparison
   */
  private normalizeFact(fact: string): string {
    let normalized = fact
      .toLowerCase()
      .replace(/[^\w\s<>/.:-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // Convert numeric words to digits
    for (const [word, digit] of Object.entries(NUMERIC_WORDS)) {
      normalized = normalized.replace(new RegExp(`\\b${word}\\b`, 'g'), digit);
    }

    // Remove articles ONLY when they appear before nouns, not at end of phrase
    // "a string" -> "string", but "parameter a" stays as "parameter a"
    normalized = normalized.replace(/\b(a|an|the)\s+(?=\w)/g, '').replace(/\s+/g, ' ').trim();

    // Replace synonyms with canonical forms (first word in each group)
    for (const group of SYNONYM_GROUPS) {
      const canonical = group[0];
      for (let i = 1; i < group.length; i++) {
        normalized = normalized.replace(new RegExp(`\\b${group[i]}\\b`, 'g'), canonical);
      }
    }

    // Clean up multiple spaces after replacements
    normalized = normalized.replace(/\s+/g, ' ').trim();

    return normalized;
  }

  /**
   * Find direct contradictions between answers
   */
  private findDirectContradiction(
    answerFacts: Array<{ answer: ConsistencyAnswer; facts: Set<string> }>
  ): { answer1: typeof answerFacts[0]; answer2: typeof answerFacts[0]; explanation: string } | null {
    for (let i = 0; i < answerFacts.length; i++) {
      for (let j = i + 1; j < answerFacts.length; j++) {
        const facts1 = answerFacts[i].facts;
        const facts2 = answerFacts[j].facts;

        // Check for contradictory return types
        const returnType1 = this.extractReturnType(facts1);
        const returnType2 = this.extractReturnType(facts2);
        if (returnType1 && returnType2 && returnType1 !== returnType2) {
          return {
            answer1: answerFacts[i],
            answer2: answerFacts[j],
            explanation: `Contradictory return types: "${returnType1}" vs "${returnType2}"`,
          };
        }

        // Check for contradictory counts
        const count1 = this.extractCount(facts1);
        const count2 = this.extractCount(facts2);
        if (count1 !== null && count2 !== null && count1 !== count2) {
          return {
            answer1: answerFacts[i],
            answer2: answerFacts[j],
            explanation: `Contradictory counts: ${count1} vs ${count2}`,
          };
        }

        // Check for contradictory file locations
        const location1 = this.extractFileLocation(facts1);
        const location2 = this.extractFileLocation(facts2);
        if (location1 && location2 && !this.locationsMatch(location1, location2)) {
          return {
            answer1: answerFacts[i],
            answer2: answerFacts[j],
            explanation: `Contradictory file locations: "${location1}" vs "${location2}"`,
          };
        }
      }
    }
    return null;
  }

  /**
   * Find partial conflicts between answers
   */
  private findPartialConflict(
    answerFacts: Array<{ answer: ConsistencyAnswer; facts: Set<string> }>
  ): { answer1: typeof answerFacts[0]; answer2: typeof answerFacts[0]; explanation: string } | null {
    for (let i = 0; i < answerFacts.length; i++) {
      for (let j = i + 1; j < answerFacts.length; j++) {
        const facts1 = Array.from(answerFacts[i].facts);
        const facts2 = Array.from(answerFacts[j].facts);

        // Normalize facts for comparison
        const normalizedFacts1 = facts1.map((f) => this.normalizeFact(f));
        const normalizedFacts2 = facts2.map((f) => this.normalizeFact(f));

        // Extract counts from both fact sets
        const count1 = this.extractCountFromFacts(normalizedFacts1);
        const count2 = this.extractCountFromFacts(normalizedFacts2);

        // Check for count mismatches in parameter/argument statements
        if (count1 !== null && count2 !== null && count1 !== count2) {
          return {
            answer1: answerFacts[i],
            answer2: answerFacts[j],
            explanation: `Different parameter/item counts: ${count1} vs ${count2}`,
          };
        }

        // Check if one answer lists items while the other gives a count
        const params1 = this.extractParameters(normalizedFacts1);
        const params2 = this.extractParameters(normalizedFacts2);

        // If one specifies a count and the other lists a different number of params
        if (count1 !== null && params2.length > 0 && count1 !== params2.length) {
          return {
            answer1: answerFacts[i],
            answer2: answerFacts[j],
            explanation: `Count mismatch: stated ${count1} but listed ${params2.length} items`,
          };
        }
        if (count2 !== null && params1.length > 0 && count2 !== params1.length) {
          return {
            answer1: answerFacts[i],
            answer2: answerFacts[j],
            explanation: `Count mismatch: stated ${count2} but listed ${params1.length} items`,
          };
        }

        // Check if both list parameters but with different names
        if (params1.length > 0 && params2.length > 0) {
          // Different number of parameters when both list them
          if (params1.length !== params2.length) {
            return {
              answer1: answerFacts[i],
              answer2: answerFacts[j],
              explanation: `Different parameter counts: ${params1.length} vs ${params2.length} parameters`,
            };
          }

          // Same count but different names (potential partial conflict)
          const commonParams = params1.filter((p) =>
            params2.some((p2) => p.toLowerCase() === p2.toLowerCase())
          );
          if (commonParams.length < params1.length * 0.5) {
            return {
              answer1: answerFacts[i],
              answer2: answerFacts[j],
              explanation: `Different parameter names: [${params1.join(', ')}] vs [${params2.join(', ')}]`,
            };
          }
        }
      }
    }
    return null;
  }

  /**
   * Extract a count from normalized facts (looks for "N parameter" patterns)
   */
  private extractCountFromFacts(facts: string[]): number | null {
    for (const fact of facts) {
      // Match patterns like "3 parameter" or "has 3 parameter"
      const match = fact.match(/(?:has\s+)?(\d+)\s+parameter/i);
      if (match) {
        return parseInt(match[1], 10);
      }
    }
    return null;
  }

  /**
   * Find missing/extra fact differences
   */
  private findFactDifference(
    answerFacts: Array<{ answer: ConsistencyAnswer; facts: Set<string> }>
  ): {
    answer1: typeof answerFacts[0];
    answer2: typeof answerFacts[0];
    type: 'missing_fact' | 'extra_fact';
    explanation: string;
  } | null {
    // Compare first two answers for significant fact differences
    if (answerFacts.length < 2) return null;

    const facts1 = answerFacts[0].facts;
    const facts2 = answerFacts[1].facts;

    // Skip if either has no facts
    if (facts1.size === 0 || facts2.size === 0) return null;

    // Find facts in one but not the other (using normalized comparison)
    const onlyIn1 = Array.from(facts1).filter((f) => !this.hasMatchingFact(f, facts2));
    const onlyIn2 = Array.from(facts2).filter((f) => !this.hasMatchingFact(f, facts1));

    // Calculate total unique facts and the larger set size
    const largerSetSize = Math.max(facts1.size, facts2.size);
    const smallerSetSize = Math.min(facts1.size, facts2.size);

    // Detect missing facts when one answer has significantly more information
    // If one set has at least 2 extra unique facts and it's significantly larger
    if (onlyIn1.length >= 2 && facts1.size > facts2.size * 1.5) {
      return {
        answer1: answerFacts[0],
        answer2: answerFacts[1],
        type: 'extra_fact',
        explanation: `First answer has extra details: ${onlyIn1.slice(0, 2).join(', ')}`,
      };
    }

    if (onlyIn2.length >= 2 && facts2.size > facts1.size * 1.5) {
      return {
        answer1: answerFacts[0],
        answer2: answerFacts[1],
        type: 'missing_fact',
        explanation: `First answer missing details: ${onlyIn2.slice(0, 2).join(', ')}`,
      };
    }

    // Also flag if total diff is significant (for equal-sized fact sets)
    const diffCount = onlyIn1.length + onlyIn2.length;
    if (diffCount > largerSetSize * 0.6 && diffCount >= 3) {
      if (onlyIn1.length > onlyIn2.length) {
        return {
          answer1: answerFacts[0],
          answer2: answerFacts[1],
          type: 'extra_fact',
          explanation: `First answer has extra facts not in second: ${onlyIn1.slice(0, 2).join(', ')}`,
        };
      } else {
        return {
          answer1: answerFacts[0],
          answer2: answerFacts[1],
          type: 'missing_fact',
          explanation: `First answer missing facts from second: ${onlyIn2.slice(0, 2).join(', ')}`,
        };
      }
    }

    return null;
  }

  /**
   * Check if a fact has a matching fact in a set (fuzzy matching)
   */
  private hasMatchingFact(fact: string, factSet: Set<string>): boolean {
    // Normalize the fact for comparison
    const normalizedFact = this.normalizeFact(fact);

    for (const otherFact of factSet) {
      const normalizedOther = this.normalizeFact(otherFact);

      // Exact match after normalization
      if (normalizedFact === normalizedOther) return true;

      // Check for substring matches
      if (normalizedFact.includes(normalizedOther) || normalizedOther.includes(normalizedFact)) {
        return true;
      }

      // Check word overlap with relaxed threshold
      const words1 = new Set(normalizedFact.split(' ').filter((w) => w.length > 2));
      const words2 = new Set(normalizedOther.split(' ').filter((w) => w.length > 2));

      if (words1.size > 0 && words2.size > 0) {
        const overlap = Array.from(words1).filter((w) => words2.has(w)).length;
        const overlapRatio = overlap / Math.min(words1.size, words2.size);
        // Lower threshold for semantic similarity (0.5 instead of 0.7)
        if (overlapRatio >= 0.5) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Extract return type from facts
   */
  private extractReturnType(facts: Set<string>): string | null {
    for (const fact of facts) {
      const match = fact.match(/returns?\s+(\w+(?:<[^>]+>)?)/i);
      if (match) {
        return match[1].toLowerCase();
      }
    }
    return null;
  }

  /**
   * Extract numeric count from facts
   */
  private extractCount(facts: Set<string>): number | null {
    for (const fact of facts) {
      const match = fact.match(/(\d+)\s+(?:parameters?|arguments?|methods?)/i);
      if (match) {
        return parseInt(match[1], 10);
      }
    }
    return null;
  }

  /**
   * Extract file location from facts
   */
  private extractFileLocation(facts: Set<string>): string | null {
    for (const fact of facts) {
      const match = fact.match(/([^\s]+\.tsx?)/i);
      if (match) {
        return match[1].toLowerCase();
      }
    }
    return null;
  }

  /**
   * Check if two file locations refer to the same file
   */
  private locationsMatch(loc1: string, loc2: string): boolean {
    // Normalize paths
    const norm1 = loc1.replace(/\\/g, '/').split('/').pop() || loc1;
    const norm2 = loc2.replace(/\\/g, '/').split('/').pop() || loc2;

    return norm1 === norm2;
  }

  /**
   * Extract parameter names from facts
   * Note: Facts are already normalized, so synonyms are replaced with canonical forms
   */
  private extractParameters(facts: string[]): string[] {
    const params: string[] = [];

    for (const fact of facts) {
      // Look for parameter/argument lists (using canonical "parameter")
      const listMatch = fact.match(/parameter.*?:\s*([^.]+)/i);
      if (listMatch) {
        const items = listMatch[1].split(/[,\s]+/).filter((s) => s.match(/^\w+$/));
        params.push(...items);
      }

      // Look for individual parameter mentions: "parameter X" at end of fact
      // After normalization: "processdata accepts parameter a" -> should extract "a"
      const paramMatch = fact.match(/parameter\s+(\w+)$/i);
      if (paramMatch && !params.includes(paramMatch[1])) {
        params.push(paramMatch[1]);
      }

      // Look for "accepts parameter X" pattern (after synonym normalization)
      const acceptsMatch = fact.match(/accepts\s+parameter\s+(\w+)/i);
      if (acceptsMatch && !params.includes(acceptsMatch[1])) {
        params.push(acceptsMatch[1]);
      }

      // Look for patterns like "X is parameter" or "X is argument"
      const isParamMatch = fact.match(/(\w+)\s+is\s+(?:parameter|argument)/i);
      if (isParamMatch && !params.includes(isParamMatch[1])) {
        params.push(isParamMatch[1]);
      }
    }

    return params;
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a new ConsistencyChecker instance
 */
export function createConsistencyChecker(): ConsistencyChecker {
  return new ConsistencyChecker();
}
