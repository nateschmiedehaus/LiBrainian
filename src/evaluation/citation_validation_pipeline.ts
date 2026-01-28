/**
 * @fileoverview Citation Validation Pipeline (WU-1107)
 *
 * Integrates the Citation Verifier into Librarian's response generation.
 * Ensures all citations in responses are validated before delivery.
 *
 * Pipeline Steps:
 * 1. Extract citations from response (uses CitationVerifier.extractCitations)
 * 2. Verify each citation against repo (uses CitationVerifier.verifyCitation)
 * 3. For invalid citations with autoCorrect, attempt to find correct reference
 * 4. Generate validation report
 * 5. If strictMode, reject if below threshold
 *
 * Correction Strategies:
 * - File not found: Search for similar filenames
 * - Line out of range: Find nearest matching identifier
 * - Identifier not found: Search for similar identifiers
 *
 * @packageDocumentation
 */

import {
  CitationVerifier,
  createCitationVerifier,
  type Citation,
  type CitationVerificationResult,
} from './citation_verifier.js';
import {
  ASTFactExtractor,
  createASTFactExtractor,
  type ASTFact,
} from './ast_fact_extractor.js';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Result of validating a single citation
 */
export interface CitationValidationResult {
  /** The original citation */
  citation: Citation;
  /** Whether the citation is valid */
  isValid: boolean;
  /** The type of validation performed */
  validationType: 'file_exists' | 'line_valid' | 'identifier_match' | 'content_match';
  /** Confidence score from 0.0 to 1.0 */
  confidence: number;
  /** Corrected citation if invalid and correction was found */
  suggestion?: Citation;
}

/**
 * Configuration for the validation pipeline
 */
export interface ValidationPipelineConfig {
  /** Reject responses with invalid citations */
  strictMode: boolean;
  /** Attempt to fix invalid citations */
  autoCorrect: boolean;
  /** Minimum percentage of citations that must validate */
  minValidationRate: number;
  /** Maximum time for validation in milliseconds */
  timeoutMs: number;
}

/**
 * Result of the validation pipeline
 */
export interface ValidationPipelineResult {
  /** The original response text */
  originalResponse: string;
  /** Response with corrections if autoCorrect was enabled */
  validatedResponse: string;
  /** Validation results for each citation */
  citations: CitationValidationResult[];
  /** Percentage of citations that validated (0.0 to 1.0) */
  validationRate: number;
  /** Whether the response met the minimum validation rate */
  passed: boolean;
  /** Number of auto-corrections made */
  corrections: number;
  /** Warning messages */
  warnings: string[];
}

// ============================================================================
// DEFAULT CONFIGURATION
// ============================================================================

/**
 * Default configuration for the validation pipeline
 */
export const DEFAULT_VALIDATION_CONFIG: ValidationPipelineConfig = {
  strictMode: false,
  autoCorrect: false,
  minValidationRate: 0.8,
  timeoutMs: 30000,
};

// ============================================================================
// CITATION VALIDATION PIPELINE CLASS
// ============================================================================

/**
 * Pipeline for validating citations in Librarian responses
 */
export class CitationValidationPipeline {
  private citationVerifier: CitationVerifier;
  private astExtractor: ASTFactExtractor;
  private defaultConfig: ValidationPipelineConfig;

  constructor(config?: Partial<ValidationPipelineConfig>) {
    this.citationVerifier = createCitationVerifier();
    this.astExtractor = createASTFactExtractor();
    this.defaultConfig = { ...DEFAULT_VALIDATION_CONFIG, ...config };
  }

  /**
   * Validate all citations in a response
   */
  async validate(
    response: string,
    repoPath: string,
    config?: ValidationPipelineConfig
  ): Promise<ValidationPipelineResult> {
    const effectiveConfig = config || this.defaultConfig;
    const warnings: string[] = [];
    let validatedResponse = response;
    let corrections = 0;

    // Step 1: Extract citations from response
    const rawCitations = this.citationVerifier.extractCitations(response);

    // Handle empty citations
    if (rawCitations.length === 0) {
      warnings.push('No citations found in response');
      return {
        originalResponse: response,
        validatedResponse: response,
        citations: [],
        validationRate: 1.0, // Vacuously true
        passed: true,
        corrections: 0,
        warnings,
      };
    }

    // Step 2: Extract AST facts from repo for validation
    let facts: ASTFact[] = [];
    try {
      facts = await this.astExtractor.extractFromDirectory(repoPath);
    } catch {
      warnings.push(`Failed to extract AST facts from repo: ${repoPath}`);
    }

    // Step 3: Verify each citation
    const citationResults: CitationValidationResult[] = [];
    const correctionsMap = new Map<Citation, Citation>();

    for (const citation of rawCitations) {
      // Resolve relative paths against repo root
      const resolvedCitation: Citation = {
        ...citation,
        file: this.resolvePath(citation.file, repoPath),
      };

      const verificationResult = await this.citationVerifier.verifyCitation(
        resolvedCitation,
        facts
      );

      const validationResult = this.convertToValidationResult(verificationResult);

      // Step 3b: Attempt auto-correction for invalid citations
      if (!validationResult.isValid && effectiveConfig.autoCorrect) {
        const suggestion = this.suggestCorrection(resolvedCitation, facts);
        if (suggestion) {
          validationResult.suggestion = suggestion;
          correctionsMap.set(citation, suggestion);
        } else {
          warnings.push(
            `Could not find correction for invalid citation: ${citation.file}${citation.line ? `:${citation.line}` : ''}`
          );
        }
      }

      citationResults.push(validationResult);
    }

    // Step 4: Apply corrections if enabled
    if (effectiveConfig.autoCorrect && correctionsMap.size > 0) {
      validatedResponse = this.applyCorrections(response, correctionsMap);
      corrections = correctionsMap.size;
    }

    // Step 5: Calculate validation rate
    const validCount = citationResults.filter((r) => r.isValid).length;
    const validationRate = citationResults.length > 0 ? validCount / citationResults.length : 1.0;

    // Add warning for low validation rate
    if (validationRate < effectiveConfig.minValidationRate) {
      warnings.push(
        `Low validation rate: ${(validationRate * 100).toFixed(1)}% (minimum: ${(effectiveConfig.minValidationRate * 100).toFixed(1)}%)`
      );
    }

    // Step 6: Determine pass/fail
    const passed = validationRate >= effectiveConfig.minValidationRate;

    // Add strict mode warning if failing
    if (!passed && effectiveConfig.strictMode) {
      warnings.push(
        `Strict mode: Response rejected due to low validation rate (${(validationRate * 100).toFixed(1)}%)`
      );
    }

    return {
      originalResponse: response,
      validatedResponse,
      citations: citationResults,
      validationRate,
      passed,
      corrections,
      warnings,
    };
  }

  /**
   * Suggest a correction for an invalid citation
   */
  suggestCorrection(citation: Citation, facts: ASTFact[]): Citation | null {
    if (facts.length === 0) {
      return null;
    }

    // Strategy 1: Identifier not found - search for similar identifiers first
    // This takes priority because it's the most common correction need
    if (citation.identifier) {
      const similarIdentifier = this.findSimilarIdentifier(citation.identifier, citation.file, facts);
      if (similarIdentifier && similarIdentifier.identifier !== citation.identifier) {
        return {
          ...citation,
          identifier: similarIdentifier.identifier,
          line: similarIdentifier.line,
          file: similarIdentifier.file,
        };
      }
    }

    // Strategy 2: File not found - search for similar filenames
    const similarFileFact = this.findSimilarFile(citation.file, facts);
    if (similarFileFact) {
      // Found a similar file
      const suggestion: Citation = {
        ...citation,
        file: similarFileFact.file,
      };

      // If identifier was provided, try to find it or similar in the new file
      if (citation.identifier) {
        // First try exact match
        const matchingFact = this.findMatchingIdentifierInFile(
          citation.identifier,
          similarFileFact.file,
          facts
        );
        if (matchingFact) {
          suggestion.line = matchingFact.line;
          suggestion.identifier = matchingFact.identifier;
        } else {
          // Then try similar identifier in new file
          const similarIdInFile = this.findSimilarIdentifier(
            citation.identifier,
            similarFileFact.file,
            facts
          );
          if (similarIdInFile) {
            suggestion.line = similarIdInFile.line;
            suggestion.identifier = similarIdInFile.identifier;
          }
        }
      }

      return suggestion;
    }

    // Strategy 3: Line out of range - find nearest matching identifier
    if (citation.identifier && citation.line !== undefined) {
      const nearestFact = this.findNearestIdentifier(citation.identifier, citation.file, facts);
      if (nearestFact) {
        return {
          ...citation,
          line: nearestFact.line,
          file: nearestFact.file,
        };
      }
    }

    return null;
  }

  /**
   * Apply corrections to response text
   */
  applyCorrections(response: string, corrections: Map<Citation, Citation>): string {
    if (corrections.size === 0) {
      return response;
    }

    let correctedResponse = response;

    for (const [original, corrected] of corrections) {
      // Build patterns to find and replace
      const patterns = this.buildCitationPatterns(original);
      const replacement = this.buildCitationReplacement(corrected);

      for (const pattern of patterns) {
        correctedResponse = correctedResponse.replace(pattern, replacement);
      }
    }

    return correctedResponse;
  }

  /**
   * Check if a validation result meets the quality threshold
   */
  meetsQualityThreshold(result: ValidationPipelineResult): boolean {
    return result.validationRate >= this.defaultConfig.minValidationRate;
  }

  // ============================================================================
  // PRIVATE HELPER METHODS
  // ============================================================================

  /**
   * Convert CitationVerificationResult to CitationValidationResult
   */
  private convertToValidationResult(
    verificationResult: CitationVerificationResult
  ): CitationValidationResult {
    const validationType = this.mapReasonToValidationType(verificationResult.reason);

    return {
      citation: verificationResult.citation,
      isValid: verificationResult.verified,
      validationType,
      confidence: verificationResult.confidence,
    };
  }

  /**
   * Map verification reason to validation type
   */
  private mapReasonToValidationType(
    reason: string
  ): 'file_exists' | 'line_valid' | 'identifier_match' | 'content_match' {
    switch (reason) {
      case 'file_exists':
      case 'file_not_found':
        return 'file_exists';
      case 'line_valid':
      case 'line_out_of_range':
        return 'line_valid';
      case 'identifier_found':
      case 'identifier_not_found':
        return 'identifier_match';
      case 'claim_matches_fact':
      case 'claim_mismatch':
        return 'content_match';
      default:
        return 'file_exists';
    }
  }

  /**
   * Resolve a potentially relative path against a base path
   */
  private resolvePath(filePath: string, basePath: string): string {
    // Normalize the file path first
    const normalized = filePath.replace(/\\/g, '/');

    // If already absolute, return as-is
    if (normalized.startsWith('/')) {
      return normalized;
    }

    // Resolve against base path
    // Simple path resolution without using path module
    const base = basePath.endsWith('/') ? basePath : basePath + '/';
    return base + normalized;
  }

  /**
   * Find a file in facts with a similar filename
   */
  private findSimilarFile(targetFile: string, facts: ASTFact[]): ASTFact | undefined {
    const targetFilename = this.extractFilename(targetFile);
    const targetParts = targetFile.toLowerCase().split('/');

    let bestMatch: ASTFact | undefined;
    let bestScore = 0;

    const seenFiles = new Set<string>();

    for (const fact of facts) {
      if (seenFiles.has(fact.file)) {
        continue;
      }
      seenFiles.add(fact.file);

      const factFilename = this.extractFilename(fact.file);
      const factParts = fact.file.toLowerCase().split('/');

      // Calculate similarity score
      let score = 0;

      // Exact filename match
      if (factFilename.toLowerCase() === targetFilename.toLowerCase()) {
        score += 10;
      } else {
        // Check for similar filename (Levenshtein distance)
        const distance = this.levenshteinDistance(
          factFilename.toLowerCase(),
          targetFilename.toLowerCase()
        );
        if (distance <= 3) {
          score += 10 - distance;
        }
      }

      // Matching path components
      for (const part of targetParts) {
        if (factParts.includes(part)) {
          score += 1;
        }
      }

      if (score > bestScore) {
        bestScore = score;
        bestMatch = fact;
      }
    }

    // Only return if we have a reasonable match
    return bestScore >= 5 ? bestMatch : undefined;
  }

  /**
   * Find a matching identifier in a specific file
   */
  private findMatchingIdentifierInFile(
    identifier: string,
    file: string,
    facts: ASTFact[]
  ): ASTFact | undefined {
    const normalizedFile = file.toLowerCase();

    for (const fact of facts) {
      if (fact.file.toLowerCase() === normalizedFile && fact.identifier === identifier) {
        return fact;
      }
    }

    return undefined;
  }

  /**
   * Find the nearest fact with a matching identifier
   */
  private findNearestIdentifier(
    identifier: string,
    file: string,
    facts: ASTFact[]
  ): ASTFact | undefined {
    const normalizedFile = file.toLowerCase();

    // First try exact file match
    for (const fact of facts) {
      if (
        fact.file.toLowerCase().includes(normalizedFile) ||
        normalizedFile.includes(fact.file.toLowerCase())
      ) {
        if (fact.identifier === identifier) {
          return fact;
        }
      }
    }

    // Then try any file
    for (const fact of facts) {
      if (fact.identifier === identifier) {
        return fact;
      }
    }

    return undefined;
  }

  /**
   * Find a similar identifier in the codebase
   */
  private findSimilarIdentifier(
    targetIdentifier: string,
    file: string,
    facts: ASTFact[]
  ): ASTFact | undefined {
    const normalizedFile = this.normalizePath(file);
    let bestMatch: ASTFact | undefined;
    let bestDistance = Infinity;

    for (const fact of facts) {
      // Prefer facts from the same or similar file
      const normalizedFactFile = this.normalizePath(fact.file);
      const fileMatch =
        normalizedFactFile.includes(normalizedFile) ||
        normalizedFile.includes(normalizedFactFile) ||
        this.extractFilename(normalizedFactFile) === this.extractFilename(normalizedFile);

      const distance = this.levenshteinDistance(
        fact.identifier.toLowerCase(),
        targetIdentifier.toLowerCase()
      );

      // Only consider close matches (distance <= 3)
      if (distance <= 3) {
        // Prefer same file matches
        const adjustedDistance = fileMatch ? distance : distance + 5;

        if (adjustedDistance < bestDistance) {
          bestDistance = adjustedDistance;
          bestMatch = fact;
        }
      }
    }

    return bestMatch;
  }

  /**
   * Normalize a path for comparison
   */
  private normalizePath(filePath: string): string {
    return filePath.replace(/\\/g, '/').toLowerCase();
  }

  /**
   * Extract filename from path
   */
  private extractFilename(filePath: string): string {
    const parts = filePath.replace(/\\/g, '/').split('/');
    return parts[parts.length - 1] || filePath;
  }

  /**
   * Calculate Levenshtein distance between two strings
   */
  private levenshteinDistance(a: string, b: string): number {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;

    const matrix: number[][] = [];

    for (let i = 0; i <= b.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= a.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1, // substitution
            matrix[i][j - 1] + 1, // insertion
            matrix[i - 1][j] + 1 // deletion
          );
        }
      }
    }

    return matrix[b.length][a.length];
  }

  /**
   * Build regex patterns to match a citation in text
   */
  private buildCitationPatterns(citation: Citation): RegExp[] {
    const patterns: RegExp[] = [];
    const escapedFile = this.escapeRegExp(citation.file);

    if (citation.line !== undefined) {
      // Pattern: `file:line`
      patterns.push(new RegExp(`\`${escapedFile}:${citation.line}(?:-\\d+)?\``, 'g'));
      // Pattern: `file` line N
      patterns.push(new RegExp(`\`${escapedFile}\`\\s+line\\s+${citation.line}`, 'gi'));
    }

    if (citation.identifier) {
      const escapedId = this.escapeRegExp(citation.identifier);
      // Pattern: `identifier` in `file`
      patterns.push(new RegExp(`\`${escapedId}\`\\s+(?:in|from)\\s+\`${escapedFile}\``, 'g'));
      // Pattern: `identifier` function/class/etc in `file`
      patterns.push(new RegExp(`\`${escapedId}\`\\s+\\w+\\s+(?:in|from)\\s+\`${escapedFile}\``, 'g'));
      // Pattern: The `identifier` in/from `file`
      patterns.push(new RegExp(`The\\s+\`${escapedId}\`\\s+(?:in|from)\\s+\`${escapedFile}\``, 'gi'));
    }

    return patterns;
  }

  /**
   * Build replacement text for a corrected citation
   */
  private buildCitationReplacement(citation: Citation): string {
    if (citation.line !== undefined) {
      return `\`${citation.file}:${citation.line}\``;
    }
    if (citation.identifier) {
      return `\`${citation.identifier}\` in \`${citation.file}\``;
    }
    return `\`${citation.file}\``;
  }

  /**
   * Escape special regex characters in a string
   */
  private escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a new CitationValidationPipeline instance
 */
export function createCitationValidationPipeline(
  config?: Partial<ValidationPipelineConfig>
): CitationValidationPipeline {
  return new CitationValidationPipeline(config);
}
