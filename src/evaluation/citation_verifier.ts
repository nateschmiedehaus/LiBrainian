/**
 * @fileoverview Citation Verifier (WU-804)
 *
 * Validates Librarian's output citations against ground truth.
 * When Librarian claims "function X is defined in file Y at line Z",
 * the Citation Verifier checks if that's actually true.
 *
 * @packageDocumentation
 */

import * as fs from 'fs';
import * as path from 'path';
import { ASTFactExtractor, createASTFactExtractor, type ASTFact } from './ast_fact_extractor.js';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * A citation extracted from Librarian output
 */
export interface Citation {
  /** The file path being cited */
  file: string;
  /** The line number (1-based, optional) */
  line?: number;
  /** The identifier being cited (function name, class name, etc.) */
  identifier?: string;
  /** The claim being made about this citation */
  claim: string;
}

/**
 * Reason for verification success or failure
 */
export type VerificationReason =
  | 'file_exists'
  | 'file_not_found'
  | 'line_valid'
  | 'line_out_of_range'
  | 'line_empty'
  | 'identifier_found'
  | 'identifier_not_found'
  | 'identifier_not_in_file'
  | 'identifier_not_at_line'
  | 'claim_matches_fact'
  | 'claim_mismatch';

/**
 * Result of verifying a single citation
 */
export interface CitationVerificationResult {
  /** The original citation */
  citation: Citation;
  /** Whether the citation was verified as true */
  verified: boolean;
  /** The reason for the verification result */
  reason: VerificationReason;
  /** The AST fact that matched the citation (if any) */
  matchedFact?: ASTFact;
  /** Confidence score from 0.0 to 1.0 */
  confidence: number;
}

/**
 * Report summarizing verification of multiple citations
 */
export interface CitationVerificationReport {
  /** Total number of citations processed */
  totalCitations: number;
  /** Number of citations that were verified */
  verifiedCount: number;
  /** Number of citations that failed verification */
  failedCount: number;
  /** Verification rate (verifiedCount / totalCitations) */
  verificationRate: number;
  /** Individual verification results */
  results: CitationVerificationResult[];
  /** Summary statistics */
  summary: {
    /** Rate of citations where the file exists */
    fileExistenceRate: number;
    /** Rate of citations where the line number is valid */
    lineValidityRate: number;
    /** Rate of citations where the identifier was found */
    identifierMatchRate: number;
  };
}

// ============================================================================
// CITATION VERIFIER CLASS
// ============================================================================

/**
 * Verifies citations in Librarian output against AST facts
 */
export class CitationVerifier {
  private astExtractor: ASTFactExtractor;
  private fileLineCache: Map<string, string[]>;

  /** Line tolerance for fuzzy matching (citations within this many lines of a fact are considered matches) */
  private static readonly LINE_TOLERANCE = 15;

  constructor() {
    this.astExtractor = createASTFactExtractor();
    this.fileLineCache = new Map();
  }

  /**
   * Extract citations from Librarian output text
   */
  extractCitations(text: string): Citation[] {
    const citations: Citation[] = [];

    // Pattern 1: `file.ts:line` - backtick file with line number
    const fileLinePattern = /`([^`]+\.[jt]sx?):(\d+)(?:-\d+)?`/g;
    let match: RegExpExecArray | null;
    while ((match = fileLinePattern.exec(text)) !== null) {
      const file = match[1];
      const line = parseInt(match[2], 10);
      const claim = this.extractClaimContext(text, match.index);
      const identifier = this.extractNearbyIdentifier(text, match.index);

      citations.push({ file, line, identifier, claim });
    }

    // Pattern 2: GitHub-style `file.ts#L25` or `file.ts#L25-L30`
    const githubPattern = /`([^`]+\.[jt]sx?)#L(\d+)(?:-L?\d+)?`/g;
    while ((match = githubPattern.exec(text)) !== null) {
      const file = match[1];
      const line = parseInt(match[2], 10);
      const claim = this.extractClaimContext(text, match.index);
      const identifier = this.extractNearbyIdentifier(text, match.index);

      // Skip if already captured
      if (!citations.some((c) => c.file === file && c.line === line)) {
        citations.push({ file, line, identifier, claim });
      }
    }

    // Pattern 3: `file.ts` line N - file followed by "line N"
    const fileLineTextPattern = /`([^`]+\.[jt]sx?)`\s+line\s+(\d+)/gi;
    while ((match = fileLineTextPattern.exec(text)) !== null) {
      const file = match[1];
      const line = parseInt(match[2], 10);
      const claim = this.extractClaimContext(text, match.index);
      const identifier = this.extractNearbyIdentifier(text, match.index);

      // Skip if already captured
      if (!citations.some((c) => c.file === file && c.line === line)) {
        citations.push({ file, line, identifier, claim });
      }
    }

    // Pattern 4: `identifier` in `file.ts` - function/class in file
    const identifierInFilePattern = /`([A-Za-z_][A-Za-z0-9_]*)`\s+(?:in|from)\s+`([^`]+\.[jt]sx?)`/g;
    while ((match = identifierInFilePattern.exec(text)) !== null) {
      const identifier = match[1];
      const file = match[2];
      const claim = this.extractClaimContext(text, match.index);

      // Skip if already captured (might have line number from another pattern)
      if (!citations.some((c) => c.file === file && c.identifier === identifier)) {
        citations.push({ file, identifier, claim });
      }
    }

    // Pattern 5: `identifier` (file.ts:line) - parenthetical file reference
    const parenPattern = /`([A-Za-z_][A-Za-z0-9_]*)`\s*\(([^)]+\.[jt]sx?):(\d+)\)/g;
    while ((match = parenPattern.exec(text)) !== null) {
      const identifier = match[1];
      const file = match[2];
      const line = parseInt(match[3], 10);
      const claim = this.extractClaimContext(text, match.index);

      // Skip if already captured
      if (!citations.some((c) => c.file === file && c.line === line)) {
        citations.push({ file, line, identifier, claim });
      }
    }

    // Pattern 6: `identifier` is defined in `file.ts:line`
    const definedInPattern =
      /`([A-Za-z_][A-Za-z0-9_]*)`\s+(?:is\s+)?defined\s+in\s+`([^`]+\.[jt]sx?):(\d+)`/gi;
    while ((match = definedInPattern.exec(text)) !== null) {
      const identifier = match[1];
      const file = match[2];
      const line = parseInt(match[3], 10);
      const claim = this.extractClaimContext(text, match.index);

      // Check if we already have this citation without identifier and update it
      const existingIndex = citations.findIndex((c) => c.file === file && c.line === line);
      if (existingIndex >= 0 && !citations[existingIndex].identifier) {
        // Update existing citation with the identifier
        citations[existingIndex].identifier = identifier;
        citations[existingIndex].claim = claim;
      } else if (!citations.some((c) => c.file === file && c.line === line && c.identifier === identifier)) {
        citations.push({ file, line, identifier, claim });
      }
    }

    // Pattern 7: Standalone file reference `file.ts` (no line number)
    // Only match if it looks like a real file path (contains / or starts with src/)
    const standaloneFilePattern = /`((?:src\/|\.\/)?[^`]+\.[jt]sx?)`(?!\s*(?:line|\())/g;
    while ((match = standaloneFilePattern.exec(text)) !== null) {
      const file = match[1];

      // Skip non-file patterns like npm commands
      if (this.looksLikeCommand(file)) {
        continue;
      }

      const claim = this.extractClaimContext(text, match.index);
      const identifier = this.extractNearbyIdentifier(text, match.index);

      // Skip if already captured with more specific pattern
      if (!citations.some((c) => c.file === file)) {
        citations.push({ file, identifier, claim });
      }
    }

    // Pattern 8: Handle Windows-style paths (backslashes)
    const windowsPathPattern = /`([^`]+\\[^`]+\.[jt]sx?):(\d+)`/g;
    while ((match = windowsPathPattern.exec(text)) !== null) {
      const file = match[1].replace(/\\/g, '/');
      const line = parseInt(match[2], 10);
      const claim = this.extractClaimContext(text, match.index);
      const identifier = this.extractNearbyIdentifier(text, match.index);

      // Skip if already captured
      if (!citations.some((c) => c.file === file && c.line === line)) {
        citations.push({ file, line, identifier, claim });
      }
    }

    return citations;
  }

  /**
   * Verify a single citation against AST facts
   */
  verifyCitation(citation: Citation, facts: ASTFact[]): CitationVerificationResult {
    // Step 1: Check file existence
    const fileExists = fs.existsSync(citation.file);

    if (!fileExists) {
      return {
        citation,
        verified: false,
        reason: 'file_not_found',
        confidence: 0,
      };
    }

    const fileLines = this.getFileLines(citation.file);

    // Step 2: If line number is provided, validate it
    if (citation.line !== undefined) {
      if (citation.line <= 0) {
        return {
          citation,
          verified: false,
          reason: 'line_out_of_range',
          confidence: 0,
        };
      }

      const lineCount = fileLines.length;
      if (citation.line > lineCount) {
        return {
          citation,
          verified: false,
          reason: 'line_out_of_range',
          confidence: 0.1,
        };
      }

      const lineText = fileLines[citation.line - 1] ?? '';
      if (!lineText.trim()) {
        return {
          citation,
          verified: false,
          reason: 'line_empty',
          confidence: 0.2,
        };
      }
    }

    // Step 3: If identifier is provided, look for matching fact
    if (citation.identifier) {
      const identifierLines = this.findIdentifierLines(fileLines, citation.identifier);

      if (identifierLines.length === 0) {
        return {
          citation,
          verified: false,
          reason: 'identifier_not_in_file',
          confidence: 0.2,
        };
      }

      if (citation.line !== undefined) {
        const nearest = this.findNearestLine(identifierLines, citation.line);
        if (nearest !== undefined && Math.abs(nearest - citation.line) <= CitationVerifier.LINE_TOLERANCE) {
          return {
            citation,
            verified: true,
            reason: 'identifier_found',
            confidence: 0.9,
          };
        }

        return {
          citation,
          verified: false,
          reason: 'identifier_not_at_line',
          confidence: 0.4,
        };
      }

      // Identifier exists in file, consider verified even without AST facts
      if (identifierLines.length > 0 && citation.line === undefined) {
        return {
          citation,
          verified: true,
          reason: 'identifier_found',
          confidence: 0.8,
        };
      }

      const matchingFact = this.findMatchingFact(citation, facts);

      if (matchingFact) {
        const confidence = this.calculateConfidence(citation, matchingFact);
        return {
          citation,
          verified: true,
          reason: 'identifier_found',
          matchedFact: matchingFact,
          confidence,
        };
      }

      // Identifier provided but not found in AST facts
      return {
        citation,
        verified: false,
        reason: 'identifier_not_found',
        confidence: 0.2,
      };
    }

    // Step 4: If only line number, check if any fact exists near that line
    if (citation.line !== undefined) {
      const factAtLine = this.findFactNearLine(citation.file, citation.line, facts);

      if (factAtLine) {
        return {
          citation,
          verified: true,
          reason: 'claim_matches_fact',
          matchedFact: factAtLine,
          confidence: 0.7,
        };
      }

      // Line is valid but no specific fact found
      return {
        citation,
        verified: true,
        reason: 'line_valid',
        confidence: 0.6,
      };
    }

    // Step 5: File exists but no line/identifier - basic verification
    return {
      citation,
      verified: true,
      reason: 'file_exists',
      confidence: 0.5,
    };
  }

  /**
   * Verify multiple citations and generate a report
   */
  async verifyAll(citations: Citation[], facts: ASTFact[]): Promise<CitationVerificationReport> {
    if (citations.length === 0) {
      return {
        totalCitations: 0,
        verifiedCount: 0,
        failedCount: 0,
        verificationRate: 0,
        results: [],
        summary: {
          fileExistenceRate: 0,
          lineValidityRate: 0,
          identifierMatchRate: 0,
        },
      };
    }

    const results: CitationVerificationResult[] = [];

    for (const citation of citations) {
      const result = this.verifyCitation(citation, facts);
      results.push(result);
    }

    const verifiedCount = results.filter((r) => r.verified).length;
    const failedCount = results.filter((r) => !r.verified).length;

    // Calculate summary statistics
    const citationsWithFile = citations.filter((c) => c.file);
    const filesExist = results.filter(
      (r) => r.reason !== 'file_not_found'
    ).length;
    const fileExistenceRate = citationsWithFile.length > 0
      ? filesExist / citationsWithFile.length
      : 0;

    const citationsWithLine = citations.filter((c) => c.line !== undefined);
    const validLines = results.filter(
      (r) =>
        r.reason === 'line_valid' ||
        r.reason === 'identifier_found' ||
        r.reason === 'claim_matches_fact'
    ).length;
    const lineValidityRate = citationsWithLine.length > 0
      ? Math.min(1, validLines / citationsWithLine.length)
      : 0;

    const citationsWithIdentifier = citations.filter((c) => c.identifier);
    const identifiersFound = results.filter((r) => r.reason === 'identifier_found').length;
    const identifierMatchRate = citationsWithIdentifier.length > 0
      ? identifiersFound / citationsWithIdentifier.length
      : 0;

    return {
      totalCitations: citations.length,
      verifiedCount,
      failedCount,
      verificationRate: verifiedCount / citations.length,
      results,
      summary: {
        fileExistenceRate,
        lineValidityRate,
        identifierMatchRate,
      },
    };
  }

  /**
   * Verify citations extracted from Librarian output against a repository
   */
  async verifyLibrarianOutput(output: string, repoPath: string): Promise<CitationVerificationReport> {
    // Extract citations from the output
    const rawCitations = this.extractCitations(output);

    if (rawCitations.length === 0) {
      return {
        totalCitations: 0,
        verifiedCount: 0,
        failedCount: 0,
        verificationRate: 0,
        results: [],
        summary: {
          fileExistenceRate: 0,
          lineValidityRate: 0,
          identifierMatchRate: 0,
        },
      };
    }

    // Resolve relative paths against repo root
    const citations: Citation[] = rawCitations.map((c) => ({
      ...c,
      file: this.resolvePath(c.file, repoPath),
    }));

    // Extract AST facts from the repo
    let facts: ASTFact[] = [];
    if (fs.existsSync(repoPath) && fs.statSync(repoPath).isDirectory()) {
      facts = await this.astExtractor.extractFromDirectory(repoPath);
    }

    // Verify all citations
    return this.verifyAll(citations, facts);
  }

  // ============================================================================
  // PRIVATE HELPER METHODS
  // ============================================================================

  /**
   * Extract context around a match to form the claim
   */
  private extractClaimContext(text: string, matchIndex: number): string {
    const start = Math.max(0, matchIndex - 50);
    const end = Math.min(text.length, matchIndex + 100);
    let context = text.slice(start, end).trim();

    // Clean up the context
    context = context.replace(/\s+/g, ' ');
    if (start > 0) context = '...' + context;
    if (end < text.length) context = context + '...';

    return context;
  }

  /**
   * Look for an identifier near the match (e.g., backticked word before "is defined in")
   */
  private extractNearbyIdentifier(text: string, matchIndex: number): string | undefined {
    // Look backwards for a backticked identifier
    const beforeMatch = text.slice(Math.max(0, matchIndex - 100), matchIndex);
    const identifierMatch = beforeMatch.match(/`([A-Za-z_][A-Za-z0-9_]*)`\s*(?:is\s+)?(?:defined|located|found)?\s*$/i);

    if (identifierMatch) {
      return identifierMatch[1];
    }

    return undefined;
  }

  /**
   * Check if a string looks like a command rather than a file path
   */
  private looksLikeCommand(str: string): boolean {
    const commandPatterns = [
      /^npm\s+/i,
      /^yarn\s+/i,
      /^pnpm\s+/i,
      /^npx\s+/i,
      /^node\s+/i,
      /^git\s+/i,
      /^cd\s+/i,
      /^ls\s+/i,
      /^mkdir\s+/i,
      /^rm\s+/i,
      /^mv\s+/i,
      /^cp\s+/i,
      /^cat\s+/i,
      /^echo\s+/i,
    ];

    return commandPatterns.some((p) => p.test(str));
  }

  /**
   * Get the number of lines in a file
   */
  private getFileLineCount(filePath: string): number {
    return this.getFileLines(filePath).length;
  }

  /**
   * Read file lines with caching
   */
  private getFileLines(filePath: string): string[] {
    const cached = this.fileLineCache.get(filePath);
    if (cached) return cached;
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      this.fileLineCache.set(filePath, lines);
      return lines;
    } catch {
      return [];
    }
  }

  private findIdentifierLines(lines: string[], identifier: string): number[] {
    const results: number[] = [];
    const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`\\b${escaped}\\b`);
    for (let i = 0; i < lines.length; i += 1) {
      if (pattern.test(lines[i])) {
        results.push(i + 1);
      }
    }
    return results;
  }

  private findNearestLine(lines: number[], target: number): number | undefined {
    if (lines.length === 0) return undefined;
    let nearest = lines[0];
    let bestDiff = Math.abs(nearest - target);
    for (const line of lines) {
      const diff = Math.abs(line - target);
      if (diff < bestDiff) {
        bestDiff = diff;
        nearest = line;
      }
    }
    return nearest;
  }

  /**
   * Find a fact that matches the citation's identifier and file
   */
  private findMatchingFact(citation: Citation, facts: ASTFact[]): ASTFact | undefined {
    const normalizedCitationFile = this.normalizePath(citation.file);

    for (const fact of facts) {
      const normalizedFactFile = this.normalizePath(fact.file);

      // Check if files match (allow partial path matching)
      const filesMatch =
        normalizedFactFile === normalizedCitationFile ||
        normalizedFactFile.endsWith(normalizedCitationFile) ||
        normalizedCitationFile.endsWith(normalizedFactFile);

      if (!filesMatch) continue;

      // Check identifier match
      if (fact.identifier === citation.identifier) {
        // If line is specified, check it's within tolerance
        if (citation.line !== undefined) {
          const lineDiff = Math.abs(fact.line - citation.line);
          if (lineDiff <= CitationVerifier.LINE_TOLERANCE) {
            return fact;
          }
        } else {
          return fact;
        }
      }
    }

    // Try fuzzy matching with just the identifier (for different paths)
    if (citation.identifier) {
      const identifierMatches = facts.filter((f) => f.identifier === citation.identifier);
      if (identifierMatches.length === 1) {
        // Only one match, likely the right one
        return identifierMatches[0];
      }
    }

    return undefined;
  }

  /**
   * Find any fact near a specific line in a file
   */
  private findFactNearLine(
    file: string,
    line: number,
    facts: ASTFact[]
  ): ASTFact | undefined {
    const normalizedFile = this.normalizePath(file);

    for (const fact of facts) {
      const normalizedFactFile = this.normalizePath(fact.file);

      const filesMatch =
        normalizedFactFile === normalizedFile ||
        normalizedFactFile.endsWith(normalizedFile) ||
        normalizedFile.endsWith(normalizedFactFile);

      if (filesMatch) {
        const lineDiff = Math.abs(fact.line - line);
        if (lineDiff <= CitationVerifier.LINE_TOLERANCE) {
          return fact;
        }
      }
    }

    return undefined;
  }

  /**
   * Calculate confidence score based on how well citation matches fact
   */
  private calculateConfidence(citation: Citation, fact: ASTFact): number {
    let confidence = 0.5; // Base confidence for matching identifier

    // Add confidence for matching file
    const normalizedCitationFile = this.normalizePath(citation.file);
    const normalizedFactFile = this.normalizePath(fact.file);
    if (normalizedFactFile === normalizedCitationFile) {
      confidence += 0.2;
    } else if (
      normalizedFactFile.endsWith(normalizedCitationFile) ||
      normalizedCitationFile.endsWith(normalizedFactFile)
    ) {
      confidence += 0.1;
    }

    // Add confidence for matching line
    if (citation.line !== undefined) {
      const lineDiff = Math.abs(fact.line - citation.line);
      if (lineDiff === 0) {
        confidence += 0.3;
      } else if (lineDiff <= 2) {
        confidence += 0.2;
      } else if (lineDiff <= CitationVerifier.LINE_TOLERANCE) {
        confidence += 0.1;
      }
    }

    return Math.min(1.0, confidence);
  }

  /**
   * Normalize a file path for comparison
   */
  private normalizePath(filePath: string): string {
    return filePath
      .replace(/\\/g, '/')
      .replace(/^\.\//, '')
      .toLowerCase();
  }

  /**
   * Resolve a potentially relative path against a base path
   */
  private resolvePath(filePath: string, basePath: string): string {
    // Normalize the file path first
    const normalized = filePath.replace(/\\/g, '/');

    // If already absolute, return as-is
    if (path.isAbsolute(normalized)) {
      return normalized;
    }

    // Resolve against base path
    return path.resolve(basePath, normalized);
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a new CitationVerifier instance
 */
export function createCitationVerifier(): CitationVerifier {
  return new CitationVerifier();
}
