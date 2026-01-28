/**
 * @fileoverview MiniCheck Entailment Checker
 *
 * Verifies whether claims made in Librarian's responses are actually entailed
 * by the source code. This is a hallucination detection mechanism.
 *
 * Entailment logic:
 * - Entailed: Claim is supported by evidence (e.g., "Function X returns string" + AST shows `: string`)
 * - Contradicted: Claim conflicts with evidence (e.g., "Function X takes no parameters" + AST shows params)
 * - Neutral: Insufficient evidence to verify (e.g., "This function is efficient")
 *
 * @packageDocumentation
 */

import { ASTFactExtractor, type ASTFact, type FunctionDefDetails, type ClassDetails, type ImportDetails, type TypeDetails } from './ast_fact_extractor.js';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Types of claims that can be made about code
 */
export type ClaimType = 'structural' | 'behavioral' | 'factual';

/**
 * Possible verdicts for entailment checking
 */
export type EntailmentVerdict = 'entailed' | 'contradicted' | 'neutral';

/**
 * Types of evidence that can support or contradict claims
 */
export type EvidenceType = 'code_match' | 'ast_fact' | 'comment' | 'type_info';

/**
 * A claim extracted from a response about code
 */
export interface Claim {
  /** The text of the claim */
  text: string;
  /** The type of claim (structural, behavioral, factual) */
  type: ClaimType;
  /** Cited source if any (e.g., "src/foo.ts:10") */
  source?: string;
}

/**
 * Evidence for or against a claim
 */
export interface EntailmentEvidence {
  /** The type of evidence */
  type: EvidenceType;
  /** The source of the evidence (e.g., file path, AST node) */
  source: string;
  /** The content of the evidence */
  content: string;
  /** Whether this evidence supports the claim */
  supports: boolean;
}

/**
 * Result of checking a single claim
 */
export interface EntailmentResult {
  /** The claim that was checked */
  claim: Claim;
  /** The verdict (entailed, contradicted, neutral) */
  verdict: EntailmentVerdict;
  /** Confidence in the verdict (0-1) */
  confidence: number;
  /** Evidence for or against the claim */
  evidence: EntailmentEvidence[];
  /** Human-readable explanation */
  explanation: string;
}

/**
 * Report of checking all claims in a response
 */
export interface EntailmentReport {
  /** All claims extracted from the response */
  claims: Claim[];
  /** Results for each claim */
  results: EntailmentResult[];
  /** Summary statistics */
  summary: {
    /** Number of entailed claims */
    entailed: number;
    /** Number of contradicted claims */
    contradicted: number;
    /** Number of neutral claims */
    neutral: number;
    /** Proportion of claims that are entailed */
    entailmentRate: number;
  };
}

// ============================================================================
// CLAIM EXTRACTION PATTERNS
// ============================================================================

interface ClaimPattern {
  pattern: RegExp;
  type: ClaimType;
  extractClaim: (match: RegExpMatchArray) => string;
}

const CLAIM_PATTERNS: ClaimPattern[] = [
  // "function X returns Y" patterns
  {
    pattern: /(?:the\s+)?(?:function|method)\s+[`']?(\w+)[`']?\s+returns\s+(?:a\s+|an\s+)?[`']?([^`.]+)[`']?/gi,
    type: 'structural',
    extractClaim: (match) => match[0],
  },
  // "method X takes/accepts Y" patterns - method first
  {
    pattern: /(?:the\s+)?[`']?(\w+)[`']?\s+method\s+(?:takes|accepts|has)\s+(?:a\s+)?[`']?(\w+)[`']?\s+parameter/gi,
    type: 'structural',
    extractClaim: (match) => match[0],
  },
  // "function X takes/accepts Y" patterns
  {
    pattern: /(?:the\s+)?(?:function|method)\s+[`']?(\w+)[`']?\s+(?:takes|accepts|has)\s+(?:a\s+)?[`']?(\w+)[`']?\s+parameter/gi,
    type: 'structural',
    extractClaim: (match) => match[0],
  },
  // "class X extends Y and implements Z" patterns
  {
    pattern: /(?:the\s+)?[`']?(\w+)[`']?\s+class\s+(?:extends|implements)\s+[`']?(\w+)[`']?/gi,
    type: 'structural',
    extractClaim: (match) => match[0],
  },
  // "class X extends/implements Y" patterns
  {
    pattern: /(?:the\s+)?(?:class)\s+[`']?(\w+)[`']?\s+(?:extends|implements)\s+[`']?(\w+)[`']?/gi,
    type: 'structural',
    extractClaim: (match) => match[0],
  },
  // "file/module imports X" patterns
  {
    pattern: /(?:the\s+)?(?:file|module|code)\s+imports\s+[`']?(\w+)[`']?\s+from\s+[`']?([^`'.\s]+)[`']?/gi,
    type: 'structural',
    extractClaim: (match) => match[0],
  },
  // "X is imported from Y" patterns
  {
    pattern: /[`']?(\w+)[`']?\s+is\s+imported\s+from\s+[`']?([^`'.\s]+)[`']?/gi,
    type: 'structural',
    extractClaim: (match) => match[0],
  },
  // "X is defined in Y" patterns
  {
    pattern: /(?:the\s+)?[`']?(\w+)[`']?\s+(?:class|function|interface|type)?\s*is\s+defined\s+in\s+[`']?([^`'.\s]+)[`']?/gi,
    type: 'factual',
    extractClaim: (match) => match[0],
  },
  // "X calls Y" patterns
  {
    pattern: /(?:the\s+)?(?:function|method)?\s*[`']?(\w+)[`']?\s+(?:function|method)?\s*calls\s+[`']?(\w+)[`']?/gi,
    type: 'behavioral',
    extractClaim: (match) => match[0],
  },
  // "X is async" patterns
  {
    pattern: /(?:the\s+)?(?:function|method)\s+[`']?(\w+)[`']?\s+(?:method|function)?\s*is\s+async/gi,
    type: 'structural',
    extractClaim: (match) => match[0],
  },
  // "function is async" patterns (without name before)
  {
    pattern: /[`']?(\w+)[`']?\s+is\s+async/gi,
    type: 'structural',
    extractClaim: (match) => match[0],
  },
  // "X has N parameters" patterns
  {
    pattern: /(?:the\s+)?(?:function|method)?\s*[`']?(\w+)[`']?\s+(?:function|method)?\s*(?:has|takes)\s+(\d+|zero|one|two|three|four|five|no)\s+parameters?/gi,
    type: 'structural',
    extractClaim: (match) => match[0],
  },
  // "X has a method Y" patterns
  {
    pattern: /[`']?(\w+)[`']?\s+has\s+(?:a\s+)?method\s+[`']?(\w+)[`']?/gi,
    type: 'structural',
    extractClaim: (match) => match[0],
  },
  // "X is a class/function/interface" patterns
  {
    pattern: /[`']?(\w+)[`']?\s+is\s+(?:a\s+)?(class|function|interface|type\s+alias|exported)/gi,
    type: 'structural',
    extractClaim: (match) => match[0],
  },
  // "class is located at line N" patterns
  {
    pattern: /(?:the\s+)?(?:class|function|method|interface)\s+is\s+located\s+at\s+line\s+(\d+)/gi,
    type: 'factual',
    extractClaim: (match) => match[0],
  },
  // "X has properties Y, Z" patterns
  {
    pattern: /(?:the\s+)?[`']?(\w+)[`']?\s+(?:interface|type)?\s*has\s+properties?\s+([^.]+)/gi,
    type: 'structural',
    extractClaim: (match) => match[0],
  },
  // "X has return type Y" patterns
  {
    pattern: /[`']?(\w+)[`']?\s+has\s+return\s+type\s+[`']?([^`'.]+)[`']?/gi,
    type: 'structural',
    extractClaim: (match) => match[0],
  },
  // "X has a parameter named Y" patterns
  {
    pattern: /[`']?(\w+)[`']?\s+has\s+(?:a\s+)?parameter\s+(?:named\s+)?[`']?(\w+)[`']?/gi,
    type: 'structural',
    extractClaim: (match) => match[0],
  },
  // "X is defined as a type alias" patterns
  {
    pattern: /[`']?(\w+)[`']?\s+is\s+defined\s+as\s+(?:a\s+)?(type\s+alias|interface|enum)/gi,
    type: 'structural',
    extractClaim: (match) => match[0],
  },

  // ============================================================================
  // NEW PATTERNS (WU-1408): 20+ additional claim extraction patterns
  // ============================================================================

  // 1. "X implements Y interface" patterns
  {
    pattern: /(?:class|type)\s+[`']?(\w+)[`']?\s+implements\s+[`']?(\w+)[`']?/gi,
    type: 'structural',
    extractClaim: (match) => match[0],
  },
  // 2. "X extends Y" patterns (class inheritance)
  {
    pattern: /(?:class)\s+[`']?(\w+)[`']?\s+extends\s+[`']?(\w+)[`']?/gi,
    type: 'structural',
    extractClaim: (match) => match[0],
  },
  // 3. "X depends on Y" patterns
  {
    pattern: /[`']?(\w+)[`']?\s+depends?\s+on\s+[`']?(\w+)[`']?/gi,
    type: 'structural',
    extractClaim: (match) => match[0],
  },
  // 4. "X is called by Y" patterns
  {
    pattern: /[`']?(\w+)[`']?\s+is\s+called\s+by\s+[`']?(\w+)[`']?/gi,
    type: 'behavioral',
    extractClaim: (match) => match[0],
  },
  // 5. "X has parameter Y of type Z" patterns
  {
    pattern: /[`']?(\w+)[`']?\s+has\s+parameter\s+[`']?(\w+)[`']?\s+of\s+type\s+[`']?(\w+)[`']?/gi,
    type: 'structural',
    extractClaim: (match) => match[0],
  },
  // 6. "X accepts N parameters" patterns
  {
    pattern: /[`']?(\w+)[`']?\s+accepts?\s+(\d+)\s+parameters?/gi,
    type: 'structural',
    extractClaim: (match) => match[0],
  },
  // 7. "X is exported from Y" patterns
  {
    pattern: /[`']?(\w+)[`']?\s+is\s+exported\s+from\s+[`']?([^`']+)[`']?/gi,
    type: 'structural',
    extractClaim: (match) => match[0],
  },
  // 8. "X is imported from Y" patterns (additional variant)
  {
    pattern: /[`']?(\w+)[`']?\s+is\s+imported\s+from\s+[`']?([^`']+)[`']?/gi,
    type: 'structural',
    extractClaim: (match) => match[0],
  },
  // 9. "X is a(n) Y" (type classification) patterns
  {
    pattern: /[`']?(\w+)[`']?\s+is\s+(?:a|an)\s+(\w+(?:\s+\w+)?)/gi,
    type: 'structural',
    extractClaim: (match) => match[0],
  },
  // 9a. "X is the Y" (definite article variant)
  {
    pattern: /[`']?(\w+)[`']?\s+is\s+the\s+(\w+(?:\s+\w+)*)/gi,
    type: 'structural',
    extractClaim: (match) => match[0],
  },
  // 10. "function X is async" patterns (additional variant)
  {
    pattern: /(?:function|method)\s+[`']?(\w+)[`']?\s+is\s+async/gi,
    type: 'structural',
    extractClaim: (match) => match[0],
  },
  // 11. "X has property Y" patterns
  {
    pattern: /[`']?(\w+)[`']?\s+has\s+(?:a\s+)?property\s+[`']?(\w+)[`']?/gi,
    type: 'structural',
    extractClaim: (match) => match[0],
  },
  // 12. "X contains Y" (for modules/classes) patterns
  {
    pattern: /[`']?(\w+)[`']?\s+contains?\s+[`']?(\w+)[`']?/gi,
    type: 'structural',
    extractClaim: (match) => match[0],
  },
  // 13. "X uses Y" patterns
  {
    pattern: /[`']?(\w+)[`']?\s+uses?\s+[`']?(\w+)[`']?/gi,
    type: 'behavioral',
    extractClaim: (match) => match[0],
  },
  // 14. "X provides Y" patterns
  {
    pattern: /[`']?(\w+)[`']?\s+provides?\s+[`']?(\w+)[`']?/gi,
    type: 'structural',
    extractClaim: (match) => match[0],
  },
  // 15. "X is defined in Y" patterns (additional variant for file paths)
  {
    pattern: /[`']?(\w+)[`']?\s+is\s+defined\s+in\s+[`']?([^`']+)[`']?/gi,
    type: 'factual',
    extractClaim: (match) => match[0],
  },
  // 16. "X decorates Y" / "X is decorated with Y" patterns
  {
    pattern: /[`']?(\w+)[`']?\s+(?:decorates?|is\s+decorated\s+with)\s+[`']?(\w+)[`']?/gi,
    type: 'structural',
    extractClaim: (match) => match[0],
  },
  // 17. "X overrides Y" patterns
  {
    pattern: /[`']?(\w+)[`']?\s+overrides?\s+[`']?(\w+)[`']?/gi,
    type: 'structural',
    extractClaim: (match) => match[0],
  },
  // 18. "X handles Y" patterns
  {
    pattern: /[`']?(\w+)[`']?\s+handles?\s+[`']?(\w+)[`']?/gi,
    type: 'behavioral',
    extractClaim: (match) => match[0],
  },
  // 19. "X triggers Y" patterns
  {
    pattern: /[`']?(\w+)[`']?\s+triggers?\s+[`']?(\w+)[`']?/gi,
    type: 'behavioral',
    extractClaim: (match) => match[0],
  },
  // 20. "X validates Y" patterns
  {
    pattern: /[`']?(\w+)[`']?\s+validates?\s+[`']?(\w+)[`']?/gi,
    type: 'behavioral',
    extractClaim: (match) => match[0],
  },
  // 21. "X throws Y" patterns (error handling)
  {
    pattern: /[`']?(\w+)[`']?\s+throws?\s+[`']?(\w+)[`']?/gi,
    type: 'behavioral',
    extractClaim: (match) => match[0],
  },
  // 22. "X emits Y" patterns (event emission)
  {
    pattern: /[`']?(\w+)[`']?\s+emits?\s+[`']?(\w+)[`']?/gi,
    type: 'behavioral',
    extractClaim: (match) => match[0],
  },
  // 23. "X listens for Y" / "X listens to Y" patterns
  {
    pattern: /[`']?(\w+)[`']?\s+listens?\s+(?:for|to)\s+[`']?(\w+)[`']?/gi,
    type: 'behavioral',
    extractClaim: (match) => match[0],
  },
  // 24. "X inherits from Y" patterns
  {
    pattern: /[`']?(\w+)[`']?\s+inherits?\s+from\s+[`']?(\w+)[`']?/gi,
    type: 'structural',
    extractClaim: (match) => match[0],
  },
  // 25. "X wraps Y" patterns
  {
    pattern: /[`']?(\w+)[`']?\s+wraps?\s+[`']?(\w+)[`']?/gi,
    type: 'structural',
    extractClaim: (match) => match[0],
  },
  // 26. "X delegates to Y" patterns
  {
    pattern: /[`']?(\w+)[`']?\s+delegates?\s+to\s+[`']?(\w+)[`']?/gi,
    type: 'behavioral',
    extractClaim: (match) => match[0],
  },
  // 27. "X composes Y" / "X is composed of Y" patterns
  {
    pattern: /[`']?(\w+)[`']?\s+(?:composes?|is\s+composed\s+of)\s+[`']?(\w+)[`']?/gi,
    type: 'structural',
    extractClaim: (match) => match[0],
  },
  // 28. "X creates Y" / "X instantiates Y" patterns
  {
    pattern: /[`']?(\w+)[`']?\s+(?:creates?|instantiates?)\s+[`']?(\w+)[`']?/gi,
    type: 'behavioral',
    extractClaim: (match) => match[0],
  },
  // 29. "X returns Y when Z" conditional return patterns
  {
    pattern: /[`']?(\w+)[`']?\s+returns?\s+[`']?(\w+)[`']?\s+when\s+/gi,
    type: 'behavioral',
    extractClaim: (match) => match[0],
  },
  // 30. "X is deprecated" / "X is marked as deprecated" patterns
  {
    pattern: /[`']?(\w+)[`']?\s+is\s+(?:marked\s+as\s+)?deprecated/gi,
    type: 'factual',
    extractClaim: (match) => match[0],
  },
  // 31. "X is optional" patterns
  {
    pattern: /[`']?(\w+)[`']?\s+is\s+optional/gi,
    type: 'structural',
    extractClaim: (match) => match[0],
  },
  // 32. "X is required" patterns
  {
    pattern: /[`']?(\w+)[`']?\s+is\s+required/gi,
    type: 'structural',
    extractClaim: (match) => match[0],
  },
  // 33. "X is private/public/protected" patterns
  {
    pattern: /[`']?(\w+)[`']?\s+is\s+(private|public|protected)/gi,
    type: 'structural',
    extractClaim: (match) => match[0],
  },
  // 34. "X is static" patterns
  {
    pattern: /[`']?(\w+)[`']?\s+is\s+static/gi,
    type: 'structural',
    extractClaim: (match) => match[0],
  },
  // 35. "X is abstract" patterns
  {
    pattern: /[`']?(\w+)[`']?\s+is\s+abstract/gi,
    type: 'structural',
    extractClaim: (match) => match[0],
  },
  // 36. "X is readonly" patterns
  {
    pattern: /[`']?(\w+)[`']?\s+is\s+readonly/gi,
    type: 'structural',
    extractClaim: (match) => match[0],
  },
  // 37. "X is generic" / "X is a generic type" patterns
  {
    pattern: /[`']?(\w+)[`']?\s+is\s+(?:a\s+)?generic(?:\s+type)?/gi,
    type: 'structural',
    extractClaim: (match) => match[0],
  },
  // 38. "X accepts type parameter Y" patterns
  {
    pattern: /[`']?(\w+)[`']?\s+accepts?\s+type\s+parameter\s+[`']?(\w+)[`']?/gi,
    type: 'structural',
    extractClaim: (match) => match[0],
  },
  // 39. "X implements interface Y" patterns (explicit interface)
  {
    pattern: /[`']?(\w+)[`']?\s+implements\s+interface\s+[`']?(\w+)[`']?/gi,
    type: 'structural',
    extractClaim: (match) => match[0],
  },
  // 40. "X has default value Y" patterns
  {
    pattern: /[`']?(\w+)[`']?\s+has\s+default\s+value\s+[`']?([^`']+)[`']?/gi,
    type: 'structural',
    extractClaim: (match) => match[0],
  },
];

// Source citation pattern
const SOURCE_PATTERN = /\(([^)]+\.ts(?:x)?(?::\d+)?)\)|[`']([^`']+\.ts(?:x)?(?::\d+)?)[`']/g;

// ============================================================================
// ENTAILMENT CHECKER CLASS
// ============================================================================

/**
 * Checks whether claims about code are entailed by source code
 */
export class EntailmentChecker {
  private astExtractor: ASTFactExtractor;

  constructor() {
    this.astExtractor = new ASTFactExtractor();
  }

  /**
   * Extract claims from a response text
   */
  extractClaims(response: string): Claim[] {
    if (!response || response.trim().length === 0) {
      return [];
    }

    const claims: Claim[] = [];
    const seenTexts = new Set<string>();

    for (const patternDef of CLAIM_PATTERNS) {
      const regex = new RegExp(patternDef.pattern.source, patternDef.pattern.flags);
      let match: RegExpExecArray | null;

      while ((match = regex.exec(response)) !== null) {
        const claimText = patternDef.extractClaim(match);
        const normalizedText = claimText.toLowerCase().trim();

        // Avoid duplicates
        if (seenTexts.has(normalizedText)) {
          continue;
        }
        seenTexts.add(normalizedText);

        // Try to find a source citation nearby
        let source: string | undefined;
        const sourceMatch = SOURCE_PATTERN.exec(response.slice(Math.max(0, match.index - 50), match.index + claimText.length + 50));
        if (sourceMatch) {
          source = sourceMatch[1] || sourceMatch[2];
        }

        claims.push({
          text: claimText,
          type: patternDef.type,
          source,
        });
      }
    }

    return claims;
  }

  /**
   * Check if a claim is entailed by the given facts and context
   */
  checkEntailment(claim: Claim, facts: ASTFact[], context: string[]): EntailmentResult {
    const evidence = this.findEvidence(claim, facts, context);

    if (evidence.length === 0) {
      return {
        claim,
        verdict: 'neutral',
        confidence: 0.3,
        evidence: [],
        explanation: 'No evidence found to verify or contradict this claim.',
      };
    }

    const supportingEvidence = evidence.filter((e) => e.supports);
    const contradictingEvidence = evidence.filter((e) => !e.supports);

    let verdict: EntailmentVerdict;
    let confidence: number;
    let explanation: string;

    if (contradictingEvidence.length > 0 && supportingEvidence.length === 0) {
      verdict = 'contradicted';
      confidence = Math.min(0.95, 0.7 + contradictingEvidence.length * 0.1);
      explanation = `Claim contradicted by evidence: ${contradictingEvidence.map((e) => e.content).join('; ')}`;
    } else if (supportingEvidence.length > 0 && contradictingEvidence.length === 0) {
      verdict = 'entailed';
      confidence = Math.min(0.95, 0.7 + supportingEvidence.length * 0.1);
      explanation = `Claim supported by evidence: ${supportingEvidence.map((e) => e.content).join('; ')}`;
    } else if (supportingEvidence.length > contradictingEvidence.length) {
      verdict = 'entailed';
      confidence = 0.5 + (supportingEvidence.length - contradictingEvidence.length) * 0.1;
      explanation = `Claim mostly supported, but some conflicting evidence exists.`;
    } else if (contradictingEvidence.length > supportingEvidence.length) {
      verdict = 'contradicted';
      confidence = 0.5 + (contradictingEvidence.length - supportingEvidence.length) * 0.1;
      explanation = `Claim mostly contradicted, but some supporting evidence exists.`;
    } else {
      verdict = 'neutral';
      confidence = 0.4;
      explanation = 'Mixed evidence - cannot determine entailment with confidence.';
    }

    return {
      claim,
      verdict,
      confidence: Math.min(1, Math.max(0, confidence)),
      evidence,
      explanation,
    };
  }

  /**
   * Find evidence for or against a claim
   */
  findEvidence(claim: Claim, facts: ASTFact[], context: string[]): EntailmentEvidence[] {
    const evidence: EntailmentEvidence[] = [];
    const claimLower = claim.text.toLowerCase();

    // Extract identifiers from claim
    const identifiers = this.extractIdentifiers(claim.text);

    // Check AST facts - prioritize exact matches
    const exactMatches: Array<{ fact: ASTFact; relevance: { relevant: boolean; exactMatch: boolean } }> = [];
    const partialMatches: Array<{ fact: ASTFact; relevance: { relevant: boolean; exactMatch: boolean } }> = [];

    for (const fact of facts) {
      const relevance = this.checkFactRelevance(fact, identifiers, claimLower);
      if (relevance.relevant) {
        if (relevance.exactMatch) {
          exactMatches.push({ fact, relevance });
        } else {
          partialMatches.push({ fact, relevance });
        }
      }
    }

    // Use exact matches if available, otherwise fall back to partial matches
    const relevantFacts = exactMatches.length > 0 ? exactMatches : partialMatches;

    for (const { fact } of relevantFacts) {
      const supports = this.checkFactSupport(fact, claim);
      evidence.push({
        type: supports.evidenceType,
        source: `${fact.file}:${fact.line}`,
        content: supports.content,
        supports: supports.supports,
      });
    }

    // Check context for code matches
    for (const line of context) {
      const lineLower = line.toLowerCase();
      for (const id of identifiers) {
        if (lineLower.includes(id.toLowerCase())) {
          // Check if this is a comment
          const isComment = line.trim().startsWith('//') || line.trim().startsWith('*') || line.trim().startsWith('/*');
          evidence.push({
            type: isComment ? 'comment' : 'code_match',
            source: 'context',
            content: line.trim().slice(0, 100),
            supports: this.doesContextSupportClaim(line, claim),
          });
        }
      }
    }

    return evidence;
  }

  /**
   * Check all claims in a response against a repository
   */
  async checkResponse(response: string, repoPath: string): Promise<EntailmentReport> {
    const claims = this.extractClaims(response);

    if (claims.length === 0) {
      return {
        claims: [],
        results: [],
        summary: {
          entailed: 0,
          contradicted: 0,
          neutral: 0,
          entailmentRate: 0,
        },
      };
    }

    // Extract facts from the repository
    let facts: ASTFact[] = [];
    try {
      facts = await this.astExtractor.extractFromDirectory(repoPath);
    } catch {
      // If extraction fails, we'll check with empty facts
    }

    // Check each claim
    const results: EntailmentResult[] = claims.map((claim) => this.checkEntailment(claim, facts, []));

    // Calculate summary
    const entailed = results.filter((r) => r.verdict === 'entailed').length;
    const contradicted = results.filter((r) => r.verdict === 'contradicted').length;
    const neutral = results.filter((r) => r.verdict === 'neutral').length;

    return {
      claims,
      results,
      summary: {
        entailed,
        contradicted,
        neutral,
        entailmentRate: claims.length > 0 ? entailed / claims.length : 0,
      },
    };
  }

  // ============================================================================
  // PRIVATE HELPER METHODS
  // ============================================================================

  private extractIdentifiers(text: string): string[] {
    const identifiers: string[] = [];

    // Extract backtick-quoted identifiers
    const backtickMatches = text.matchAll(/[`'](\w+)[`']/g);
    for (const match of backtickMatches) {
      identifiers.push(match[1]);
    }

    // Extract CamelCase identifiers
    const camelCaseMatches = text.matchAll(/\b([A-Z][a-zA-Z0-9]*)\b/g);
    for (const match of camelCaseMatches) {
      if (!identifiers.includes(match[1])) {
        identifiers.push(match[1]);
      }
    }

    // Extract snake_case identifiers
    const snakeCaseMatches = text.matchAll(/\b([a-z][a-z0-9]*(?:_[a-z0-9]+)+)\b/g);
    for (const match of snakeCaseMatches) {
      if (!identifiers.includes(match[1])) {
        identifiers.push(match[1]);
      }
    }

    return identifiers;
  }

  private checkFactRelevance(fact: ASTFact, identifiers: string[], claimLower: string): { relevant: boolean; exactMatch: boolean } {
    // Check if the fact's identifier matches any extracted identifier
    const factIdLower = fact.identifier.toLowerCase();

    // First check for exact matches (highest priority)
    for (const id of identifiers) {
      if (factIdLower === id.toLowerCase()) {
        return { relevant: true, exactMatch: true };
      }
    }

    // Check if the claim contains the exact identifier as a word boundary
    // Use word boundary regex to avoid matching "ASTFactExtractor" when claim has "createASTFactExtractor"
    // First escape any special regex characters in the identifier
    const escapedFactId = factIdLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    try {
      const wordBoundaryRegex = new RegExp(`\\b${escapedFactId}\\b`, 'i');
      if (wordBoundaryRegex.test(claimLower)) {
        return { relevant: true, exactMatch: true };
      }
    } catch {
      // If regex fails, fall back to simple includes check
      if (claimLower.includes(factIdLower)) {
        return { relevant: true, exactMatch: false };
      }
    }

    // Check for substring matches (lower priority)
    for (const id of identifiers) {
      if (factIdLower.includes(id.toLowerCase()) || id.toLowerCase().includes(factIdLower)) {
        // Only count as relevant if it's a significant portion
        const overlap = Math.min(factIdLower.length, id.toLowerCase().length);
        if (overlap >= Math.max(factIdLower.length, id.toLowerCase().length) * 0.8) {
          return { relevant: true, exactMatch: false };
        }
      }
    }

    return { relevant: false, exactMatch: false };
  }

  private checkFactSupport(fact: ASTFact, claim: Claim): { supports: boolean; content: string; evidenceType: EvidenceType } {
    const claimLower = claim.text.toLowerCase();

    switch (fact.type) {
      case 'function_def': {
        const details = fact.details as FunctionDefDetails;
        return this.checkFunctionClaimSupport(fact.identifier, details, claimLower);
      }

      case 'class': {
        const details = fact.details as ClassDetails;
        return this.checkClassClaimSupport(fact.identifier, details, claimLower);
      }

      case 'import': {
        const details = fact.details as ImportDetails;
        return this.checkImportClaimSupport(fact.identifier, details, claimLower);
      }

      case 'type': {
        const details = fact.details as TypeDetails;
        return this.checkTypeClaimSupport(fact.identifier, details, claimLower);
      }

      default:
        return {
          supports: true,
          content: `Found ${fact.type}: ${fact.identifier}`,
          evidenceType: 'ast_fact',
        };
    }
  }

  private checkFunctionClaimSupport(
    identifier: string,
    details: FunctionDefDetails,
    claimLower: string
  ): { supports: boolean; content: string; evidenceType: EvidenceType } {
    const idLower = identifier.toLowerCase();

    // Check return type claims - must match function identifier
    if (claimLower.includes('returns') && claimLower.includes(idLower)) {
      const returnType = details.returnType || 'void';
      const returnTypeLower = returnType.toLowerCase();

      // Check if claim mentions void but function doesn't return void
      if (claimLower.includes('void') && !returnTypeLower.includes('void')) {
        return {
          supports: false,
          content: `Function ${identifier} returns ${returnType}, not void`,
          evidenceType: 'type_info',
        };
      }

      // Check if claim mentions a specific type that contradicts actual return type
      const typeKeywords = ['string', 'number', 'boolean', 'array', 'object', 'promise'];
      for (const typeKw of typeKeywords) {
        if (claimLower.includes(typeKw)) {
          if (returnTypeLower.includes(typeKw)) {
            return {
              supports: true,
              content: `Function ${identifier} returns ${returnType}`,
              evidenceType: 'type_info',
            };
          }
          // Claim says one type but function returns different
          if (!returnTypeLower.includes(typeKw) && !claimLower.includes(returnTypeLower.split(/[<>[\]]/)[0].trim())) {
            return {
              supports: false,
              content: `Function ${identifier} returns ${returnType}, not ${typeKw}`,
              evidenceType: 'type_info',
            };
          }
        }
      }

      // Check if the return type name is mentioned in the claim
      const returnWords = returnTypeLower.replace(/[<>\[\]]/g, ' ').split(/\s+/).filter(w => w.length > 2);
      for (const word of returnWords) {
        if (claimLower.includes(word)) {
          return {
            supports: true,
            content: `Function ${identifier} returns ${returnType}`,
            evidenceType: 'type_info',
          };
        }
      }

      // Default to supporting if we can't find a specific contradiction
      return {
        supports: true,
        content: `Function ${identifier} returns ${returnType}`,
        evidenceType: 'type_info',
      };
    }

    // Check async claims - check if identifier matches
    if ((claimLower.includes('is async') || claimLower.includes(' async')) && claimLower.includes(idLower)) {
      const isAsync = details.isAsync;
      const claimSaysAsync = claimLower.includes('is async');

      if (claimSaysAsync && !isAsync) {
        return {
          supports: false,
          content: `Function ${identifier} is not async`,
          evidenceType: 'ast_fact',
        };
      }
      if (claimSaysAsync && isAsync) {
        return {
          supports: true,
          content: `Function ${identifier} is async`,
          evidenceType: 'ast_fact',
        };
      }
    }

    // Check parameter claims
    if (claimLower.includes('parameter') || claimLower.includes('takes') || claimLower.includes('accepts')) {
      const params = details.parameters;

      // Check parameter count
      const countWords: Record<string, number> = { zero: 0, no: 0, one: 1, two: 2, three: 3, four: 4, five: 5 };
      for (const [word, count] of Object.entries(countWords)) {
        if (claimLower.includes(`${word} parameter`) && claimLower.includes(idLower)) {
          if (params.length !== count) {
            return {
              supports: false,
              content: `Function ${identifier} has ${params.length} parameters, not ${count}`,
              evidenceType: 'ast_fact',
            };
          }
          return {
            supports: true,
            content: `Function ${identifier} has ${count} parameters`,
            evidenceType: 'ast_fact',
          };
        }
      }

      // Check parameter names/types
      for (const param of params) {
        if (claimLower.includes(param.name.toLowerCase())) {
          // Check type if mentioned
          if (param.type && claimLower.includes('number') && !param.type.toLowerCase().includes('number')) {
            return {
              supports: false,
              content: `Parameter ${param.name} has type ${param.type}, not number`,
              evidenceType: 'type_info',
            };
          }
          if (param.type && claimLower.includes('string') && param.type.toLowerCase().includes('string')) {
            return {
              supports: true,
              content: `Parameter ${param.name} has type ${param.type}`,
              evidenceType: 'type_info',
            };
          }
          return {
            supports: true,
            content: `Function ${identifier} has parameter ${param.name}`,
            evidenceType: 'ast_fact',
          };
        }
      }
    }

    // Check exported claims
    if (claimLower.includes('exported') || claimLower.includes('is exported')) {
      return {
        supports: details.isExported,
        content: details.isExported ? `Function ${identifier} is exported` : `Function ${identifier} is not exported`,
        evidenceType: 'ast_fact',
      };
    }

    // Check "is a function" claims
    if (claimLower.includes('is a function') || claimLower.includes('function')) {
      return {
        supports: true,
        content: `${identifier} is a function`,
        evidenceType: 'ast_fact',
      };
    }

    return {
      supports: true,
      content: `Found function ${identifier}`,
      evidenceType: 'ast_fact',
    };
  }

  private checkClassClaimSupport(
    identifier: string,
    details: ClassDetails,
    claimLower: string
  ): { supports: boolean; content: string; evidenceType: EvidenceType } {
    const idLower = identifier.toLowerCase();

    // Check method claims - check both "has method X" patterns
    if (claimLower.includes('method') && claimLower.includes(idLower)) {
      const methods = details.methods;

      // Check if claim says class has a method - look for the method name
      const methodPatterns = [
        /has\s+(?:a\s+)?method\s+[`']?(\w+)[`']?/i,
        /method\s+[`']?(\w+)[`']?/i,
      ];

      for (const pattern of methodPatterns) {
        const methodMatch = claimLower.match(pattern);
        if (methodMatch) {
          const claimedMethod = methodMatch[1];
          const hasMethod = methods.some((m) => m.toLowerCase() === claimedMethod.toLowerCase());
          if (hasMethod) {
            return {
              supports: true,
              content: `Class ${identifier} has method ${claimedMethod}`,
              evidenceType: 'ast_fact',
            };
          } else {
            return {
              supports: false,
              content: `Class ${identifier} does not have method ${claimedMethod}`,
              evidenceType: 'ast_fact',
            };
          }
        }
      }

      // Fallback: check if any method name is mentioned
      for (const method of methods) {
        if (claimLower.includes(method.toLowerCase())) {
          return {
            supports: true,
            content: `Class ${identifier} has method ${method}`,
            evidenceType: 'ast_fact',
          };
        }
      }
    }

    // Check extends claims
    if (claimLower.includes('extends')) {
      const extendsClass = details.extends;
      if (extendsClass) {
        if (claimLower.includes(extendsClass.toLowerCase())) {
          return {
            supports: true,
            content: `Class ${identifier} extends ${extendsClass}`,
            evidenceType: 'ast_fact',
          };
        }
      }
    }

    // Check implements claims
    if (claimLower.includes('implements')) {
      const implementsList = details.implements || [];
      for (const impl of implementsList) {
        if (claimLower.includes(impl.toLowerCase())) {
          return {
            supports: true,
            content: `Class ${identifier} implements ${impl}`,
            evidenceType: 'ast_fact',
          };
        }
      }
    }

    // Check "is a class" claims
    if (claimLower.includes('is a class') || claimLower.includes('class')) {
      return {
        supports: true,
        content: `${identifier} is a class`,
        evidenceType: 'ast_fact',
      };
    }

    return {
      supports: true,
      content: `Found class ${identifier}`,
      evidenceType: 'ast_fact',
    };
  }

  private checkImportClaimSupport(
    identifier: string,
    details: ImportDetails,
    claimLower: string
  ): { supports: boolean; content: string; evidenceType: EvidenceType } {
    // Check import source claims
    if (claimLower.includes('from') || claimLower.includes('imports')) {
      const source = details.source;

      // Check if the claimed source matches
      if (claimLower.includes(source.toLowerCase())) {
        return {
          supports: true,
          content: `${identifier} is imported from ${source}`,
          evidenceType: 'ast_fact',
        };
      }

      // Check if claim mentions a different source
      const sourceMatch = claimLower.match(/from\s+[`']?([^`'.\s]+)[`']?/);
      if (sourceMatch) {
        const claimedSource = sourceMatch[1];
        if (claimedSource.toLowerCase() !== source.toLowerCase()) {
          return {
            supports: false,
            content: `${identifier} is imported from ${source}, not ${claimedSource}`,
            evidenceType: 'ast_fact',
          };
        }
      }
    }

    return {
      supports: true,
      content: `Found import ${identifier} from ${details.source}`,
      evidenceType: 'ast_fact',
    };
  }

  private checkTypeClaimSupport(
    identifier: string,
    details: TypeDetails,
    claimLower: string
  ): { supports: boolean; content: string; evidenceType: EvidenceType } {
    const kind = details.kind;

    // Check type kind claims
    if (claimLower.includes('type alias') && kind === 'type_alias') {
      return {
        supports: true,
        content: `${identifier} is defined as a type alias`,
        evidenceType: 'ast_fact',
      };
    }

    if (claimLower.includes('interface') && kind === 'interface') {
      return {
        supports: true,
        content: `${identifier} is defined as an interface`,
        evidenceType: 'ast_fact',
      };
    }

    if (claimLower.includes('enum') && kind === 'enum') {
      return {
        supports: true,
        content: `${identifier} is defined as an enum`,
        evidenceType: 'ast_fact',
      };
    }

    // Check property claims for interfaces
    if (details.properties && claimLower.includes('properties')) {
      const props = details.properties;
      for (const prop of props) {
        if (claimLower.includes(prop.toLowerCase())) {
          return {
            supports: true,
            content: `${identifier} has property ${prop}`,
            evidenceType: 'ast_fact',
          };
        }
      }
    }

    return {
      supports: true,
      content: `Found type ${identifier}`,
      evidenceType: 'ast_fact',
    };
  }

  private doesContextSupportClaim(line: string, claim: Claim): boolean {
    const lineLower = line.toLowerCase();
    const claimLower = claim.text.toLowerCase();

    // Check for matching keywords
    const claimKeywords = claimLower.split(/\s+/).filter((w) => w.length > 3);
    let matches = 0;
    for (const keyword of claimKeywords) {
      if (lineLower.includes(keyword)) {
        matches++;
      }
    }

    return matches >= 2;
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a new EntailmentChecker instance
 */
export function createEntailmentChecker(): EntailmentChecker {
  return new EntailmentChecker();
}
