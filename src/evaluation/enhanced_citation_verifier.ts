/**
 * @fileoverview Enhanced Citation Verification Pipeline
 *
 * Provides comprehensive citation verification with:
 * - Multiple citation types (code, documentation, URLs, commits)
 * - Epistemic integration (Evidence, Grounding, ConfidenceValue)
 * - Batch verification for efficiency
 * - Detailed validation reports
 *
 * Based on GATES.json layer5.citationVerifier requirements.
 *
 * @packageDocumentation
 */

import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'node:crypto';
import {
  type ConfidenceValue,
  type DerivedConfidence,
  deterministic,
  bounded,
  absent,
  sequenceConfidence,
  parallelAllConfidence,
  getNumericValue,
  isAbsentConfidence,
} from '../epistemics/confidence.js';
import {
  type EvidenceEntry,
  type EvidenceId,
  type IEvidenceLedger,
  type VerificationEvidence,
  createEvidenceId,
} from '../epistemics/evidence_ledger.js';
import {
  type Grounding,
  type GroundingId,
  type ObjectId,
  type ExtendedGroundingType,
  createGroundingId,
  createObjectId,
} from '../epistemics/universal_coherence.js';
import {
  type ASTFact,
  type ASTFactType,
  ASTFactExtractor,
  createASTFactExtractor,
} from './ast_fact_extractor.js';

// ============================================================================
// CITATION TYPE DEFINITIONS
// ============================================================================

/**
 * Types of citations that can be verified
 */
export type CitationType =
  | 'code_reference'       // File:line or file:line-range
  | 'identifier_reference' // Function/class/type name
  | 'documentation'        // Documentation files (README, docs/)
  | 'external_url'         // HTTP/HTTPS URLs
  | 'commit_reference'     // Git commit SHA or reference
  | 'issue_reference'      // GitHub issue/PR reference
  | 'line_range';          // Multi-line range citation

/**
 * Extended citation with type information
 */
export interface EnhancedCitation {
  /** Unique identifier for this citation */
  id: string;

  /** Type of citation */
  type: CitationType;

  /** The file path being cited (for code citations) */
  file?: string;

  /** The line number (1-based, optional) */
  line?: number;

  /** End line for range citations */
  endLine?: number;

  /** The identifier being cited (function name, class name, etc.) */
  identifier?: string;

  /** The claim being made about this citation */
  claim: string;

  /** URL for external references */
  url?: string;

  /** Git commit SHA */
  commitSha?: string;

  /** Issue/PR number */
  issueNumber?: number;

  /** Repository reference (owner/repo) */
  repository?: string;

  /** Raw text that was parsed into this citation */
  rawText: string;

  /** Position in source text */
  position: {
    start: number;
    end: number;
  };
}

/**
 * Verification status for a citation
 */
export type VerificationStatus =
  | 'verified'          // Citation is valid
  | 'partially_verified' // Some aspects verified, some not
  | 'unverified'        // Could not verify
  | 'refuted'           // Proven incorrect
  | 'stale'             // May have been valid, now outdated
  | 'inaccessible';     // Cannot access resource to verify

/**
 * Detailed verification result for a single citation
 */
export interface EnhancedVerificationResult {
  /** The citation that was verified */
  citation: EnhancedCitation;

  /** Overall verification status */
  status: VerificationStatus;

  /** Epistemic confidence in the verification */
  confidence: ConfidenceValue;

  /** Individual check results */
  checks: VerificationCheck[];

  /** The AST fact that matched (if applicable) */
  matchedFact?: ASTFact;

  /** Suggested correction if citation is incorrect */
  suggestion?: EnhancedCitation;

  /** Grounding relation to evidence */
  grounding?: Grounding;

  /** Timestamp of verification */
  verifiedAt: string;

  /** Duration of verification in milliseconds */
  verificationDurationMs: number;
}

/**
 * Individual verification check
 */
export interface VerificationCheck {
  /** Name of the check */
  name: string;

  /** Whether the check passed */
  passed: boolean;

  /** Confidence in this specific check */
  confidence: ConfidenceValue;

  /** Details about the check */
  details: string;

  /** Evidence supporting this check */
  evidence?: string;
}

// ============================================================================
// BATCH VERIFICATION TYPES
// ============================================================================

/**
 * Configuration for batch verification
 */
export interface BatchVerificationConfig {
  /** Maximum concurrent verifications */
  concurrency: number;

  /** Timeout per citation in milliseconds */
  timeoutMs: number;

  /** Whether to verify external URLs */
  verifyUrls: boolean;

  /** Whether to verify git commits */
  verifyCommits: boolean;

  /** Cache duration for URL verification results */
  urlCacheDurationMs: number;

  /** AST facts to use (if pre-extracted) */
  preloadedFacts?: ASTFact[];
}

/**
 * Default batch verification configuration
 */
export const DEFAULT_BATCH_CONFIG: BatchVerificationConfig = {
  concurrency: 5,
  timeoutMs: 5000,
  verifyUrls: false, // Disabled by default to avoid network calls in tests
  verifyCommits: true,
  urlCacheDurationMs: 300000, // 5 minutes
};

/**
 * Result of batch verification
 */
export interface BatchVerificationResult {
  /** Individual results */
  results: EnhancedVerificationResult[];

  /** Overall statistics */
  statistics: VerificationStatistics;

  /** Aggregate confidence */
  aggregateConfidence: ConfidenceValue;

  /** Total duration */
  totalDurationMs: number;

  /** Timestamp */
  completedAt: string;
}

/**
 * Statistics from verification
 */
export interface VerificationStatistics {
  /** Total citations processed */
  total: number;

  /** Verified citations */
  verified: number;

  /** Partially verified */
  partiallyVerified: number;

  /** Unverified citations */
  unverified: number;

  /** Refuted citations */
  refuted: number;

  /** Stale citations */
  stale: number;

  /** Inaccessible citations */
  inaccessible: number;

  /** Verification rate (verified + partially / total) */
  verificationRate: number;

  /** Average confidence score */
  averageConfidence: number;

  /** Breakdown by citation type */
  byType: Record<CitationType, {
    total: number;
    verified: number;
    verificationRate: number;
  }>;
}

// ============================================================================
// DETAILED VALIDATION REPORT
// ============================================================================

/**
 * Comprehensive validation report
 */
export interface ValidationReport {
  /** Report ID */
  id: string;

  /** Report title */
  title: string;

  /** Source document/response being validated */
  sourceDocument: {
    content: string;
    hash: string;
  };

  /** Repository being validated against */
  repository: {
    path: string;
    gitHash?: string;
  };

  /** Batch verification results */
  verification: BatchVerificationResult;

  /** Epistemic grounding chain */
  groundingChain: Grounding[];

  /** Recommendations for fixing issues */
  recommendations: ValidationRecommendation[];

  /** Overall assessment */
  assessment: {
    quality: 'excellent' | 'good' | 'acceptable' | 'poor' | 'failing';
    summary: string;
    confidence: ConfidenceValue;
  };

  /** Report metadata */
  metadata: {
    generatedAt: string;
    generatorVersion: string;
    configUsed: BatchVerificationConfig;
  };
}

/**
 * Recommendation for improving citations
 */
export interface ValidationRecommendation {
  /** Severity of the issue */
  severity: 'critical' | 'warning' | 'suggestion';

  /** Category of recommendation */
  category: 'missing_citation' | 'incorrect_citation' | 'stale_citation' | 'ambiguous_citation';

  /** Description of the issue */
  description: string;

  /** Suggested fix */
  suggestedFix?: string;

  /** Related citation IDs */
  relatedCitationIds: string[];
}

// ============================================================================
// ENHANCED CITATION VERIFIER CLASS
// ============================================================================

/**
 * Enhanced citation verifier with epistemic integration
 */
export class EnhancedCitationVerifier {
  private astExtractor: ASTFactExtractor;
  private factCache: Map<string, { facts: ASTFact[]; timestamp: number }> = new Map();
  private urlCache: Map<string, { status: VerificationStatus; timestamp: number }> = new Map();

  /** Cache duration for AST facts in milliseconds */
  private static readonly FACT_CACHE_DURATION_MS = 60000; // 1 minute

  /** Line tolerance for fuzzy matching */
  private static readonly LINE_TOLERANCE = 15;

  constructor() {
    this.astExtractor = createASTFactExtractor();
  }

  // ============================================================================
  // CITATION EXTRACTION
  // ============================================================================

  /**
   * Extract all citations from text with type classification
   */
  extractCitations(text: string): EnhancedCitation[] {
    const citations: EnhancedCitation[] = [];
    let citationIndex = 0;

    // Pattern 1: Code references - `file.ts:line` or `file.ts:line-endLine`
    const codeRefPattern = /`([^`]+\.[jt]sx?):(\d+)(?:-(\d+))?`/g;
    let match: RegExpExecArray | null;

    while ((match = codeRefPattern.exec(text)) !== null) {
      citations.push({
        id: `citation_${citationIndex++}`,
        type: match[3] ? 'line_range' : 'code_reference',
        file: match[1],
        line: parseInt(match[2], 10),
        endLine: match[3] ? parseInt(match[3], 10) : undefined,
        claim: this.extractClaimContext(text, match.index),
        rawText: match[0],
        position: { start: match.index, end: match.index + match[0].length },
      });
    }

    // Pattern 2: GitHub-style line references `file.ts#L25` or `file.ts#L25-L30`
    const githubLinePattern = /`([^`]+\.[jt]sx?)#L(\d+)(?:-L?(\d+))?`/g;
    while ((match = githubLinePattern.exec(text)) !== null) {
      if (!this.isDuplicate(citations, match[1], parseInt(match[2], 10))) {
        citations.push({
          id: `citation_${citationIndex++}`,
          type: match[3] ? 'line_range' : 'code_reference',
          file: match[1],
          line: parseInt(match[2], 10),
          endLine: match[3] ? parseInt(match[3], 10) : undefined,
          claim: this.extractClaimContext(text, match.index),
          rawText: match[0],
          position: { start: match.index, end: match.index + match[0].length },
        });
      }
    }

    // Pattern 3: Identifier references - `identifier` in `file.ts`
    const identifierPattern = /`([A-Za-z_][A-Za-z0-9_]*)`\s+(?:in|from|at)\s+`([^`]+\.[jt]sx?)`/g;
    while ((match = identifierPattern.exec(text)) !== null) {
      citations.push({
        id: `citation_${citationIndex++}`,
        type: 'identifier_reference',
        identifier: match[1],
        file: match[2],
        claim: this.extractClaimContext(text, match.index),
        rawText: match[0],
        position: { start: match.index, end: match.index + match[0].length },
      });
    }

    // Pattern 4: `identifier` is defined in `file.ts:line`
    const definedInPattern =
      /`([A-Za-z_][A-Za-z0-9_]*)`\s+(?:is\s+)?defined\s+in\s+`([^`]+\.[jt]sx?):(\d+)`/gi;
    while ((match = definedInPattern.exec(text)) !== null) {
      citations.push({
        id: `citation_${citationIndex++}`,
        type: 'identifier_reference',
        identifier: match[1],
        file: match[2],
        line: parseInt(match[3], 10),
        claim: this.extractClaimContext(text, match.index),
        rawText: match[0],
        position: { start: match.index, end: match.index + match[0].length },
      });
    }

    // Pattern 5: Documentation references - `README.md`, `docs/...`
    const docPattern = /`((?:docs?\/|README|CHANGELOG|CONTRIBUTING)[^`]*\.(?:md|rst|txt))`/gi;
    while ((match = docPattern.exec(text)) !== null) {
      citations.push({
        id: `citation_${citationIndex++}`,
        type: 'documentation',
        file: match[1],
        claim: this.extractClaimContext(text, match.index),
        rawText: match[0],
        position: { start: match.index, end: match.index + match[0].length },
      });
    }

    // Pattern 6: External URLs
    const urlPattern = /\bhttps?:\/\/[^\s<>\[\]`'"]+/g;
    while ((match = urlPattern.exec(text)) !== null) {
      // Clean up URL (remove trailing punctuation)
      let url = match[0].replace(/[.,;:!?)]+$/, '');
      citations.push({
        id: `citation_${citationIndex++}`,
        type: 'external_url',
        url,
        claim: this.extractClaimContext(text, match.index),
        rawText: match[0],
        position: { start: match.index, end: match.index + match[0].length },
      });
    }

    // Pattern 7: Git commit references (SHA)
    const commitPattern = /\b([a-f0-9]{7,40})\b(?=\s*(?:commit|sha|hash|rev)|\s*$)/gi;
    while ((match = commitPattern.exec(text)) !== null) {
      // Only match if it looks like a commit (not a hex color or similar)
      if (match[1].length >= 7) {
        citations.push({
          id: `citation_${citationIndex++}`,
          type: 'commit_reference',
          commitSha: match[1],
          claim: this.extractClaimContext(text, match.index),
          rawText: match[0],
          position: { start: match.index, end: match.index + match[0].length },
        });
      }
    }

    // Pattern 8: GitHub issue/PR references - #123 or owner/repo#123
    const issuePattern = /(?:([a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+))?#(\d+)\b/g;
    while ((match = issuePattern.exec(text)) !== null) {
      citations.push({
        id: `citation_${citationIndex++}`,
        type: 'issue_reference',
        repository: match[1],
        issueNumber: parseInt(match[2], 10),
        claim: this.extractClaimContext(text, match.index),
        rawText: match[0],
        position: { start: match.index, end: match.index + match[0].length },
      });
    }

    return citations;
  }

  // ============================================================================
  // SINGLE CITATION VERIFICATION
  // ============================================================================

  /**
   * Verify a single citation with full epistemic grounding
   */
  async verifyCitation(
    citation: EnhancedCitation,
    repoPath: string,
    facts?: ASTFact[]
  ): Promise<EnhancedVerificationResult> {
    const startTime = Date.now();
    const checks: VerificationCheck[] = [];

    // Get or extract facts
    const astFacts = facts ?? await this.getOrExtractFacts(repoPath);

    // Resolve file path
    const resolvedFile = citation.file
      ? this.resolvePath(citation.file, repoPath)
      : undefined;

    // Run type-specific verification
    let status: VerificationStatus = 'unverified';
    let matchedFact: ASTFact | undefined;
    let suggestion: EnhancedCitation | undefined;

    switch (citation.type) {
      case 'code_reference':
      case 'line_range': {
        const codeResult = await this.verifyCodeReference(citation, resolvedFile, astFacts);
        status = codeResult.status;
        matchedFact = codeResult.matchedFact;
        suggestion = codeResult.suggestion;
        checks.push(...codeResult.checks);
        break;
      }

      case 'identifier_reference': {
        const idResult = await this.verifyIdentifierReference(citation, resolvedFile, astFacts);
        status = idResult.status;
        matchedFact = idResult.matchedFact;
        suggestion = idResult.suggestion;
        checks.push(...idResult.checks);
        break;
      }

      case 'documentation':
        status = await this.verifyDocumentation(citation, resolvedFile, checks);
        break;

      case 'external_url':
        status = await this.verifyExternalUrl(citation, checks);
        break;

      case 'commit_reference':
        status = await this.verifyCommitReference(citation, repoPath, checks);
        break;

      case 'issue_reference':
        status = 'unverified'; // Would require GitHub API
        checks.push({
          name: 'issue_reference_check',
          passed: false,
          confidence: absent('not_applicable'),
          details: 'Issue reference verification requires GitHub API access',
        });
        break;

      default:
        status = 'unverified';
    }

    // Compute aggregate confidence from checks
    const confidence = this.computeVerificationConfidence(checks, status);

    // Create grounding relation
    const grounding = this.createGrounding(citation, status, confidence);

    const duration = Date.now() - startTime;

    return {
      citation,
      status,
      confidence,
      checks,
      matchedFact,
      suggestion,
      grounding,
      verifiedAt: new Date().toISOString(),
      verificationDurationMs: duration,
    };
  }

  /**
   * Verify a code reference citation
   */
  private async verifyCodeReference(
    citation: EnhancedCitation,
    resolvedFile: string | undefined,
    facts: ASTFact[]
  ): Promise<{
    status: VerificationStatus;
    matchedFact?: ASTFact;
    suggestion?: EnhancedCitation;
    checks: VerificationCheck[];
  }> {
    const checks: VerificationCheck[] = [];

    // Check 1: File exists
    const fileExists = resolvedFile ? fs.existsSync(resolvedFile) : false;
    checks.push({
      name: 'file_exists',
      passed: fileExists,
      confidence: deterministic(fileExists, fileExists ? 'file_found' : 'file_not_found'),
      details: fileExists ? `File exists: ${resolvedFile}` : `File not found: ${citation.file}`,
    });

    if (!fileExists) {
      // Try to suggest a correction
      const suggestion = this.suggestFileCorrection(citation, facts);
      return {
        status: 'refuted',
        suggestion,
        checks,
      };
    }

    // Check 2: Line is valid
    if (citation.line !== undefined) {
      const lineCount = this.getFileLineCount(resolvedFile!);
      const lineValid = citation.line > 0 && citation.line <= lineCount;
      const endLineValid = !citation.endLine || (citation.endLine >= citation.line && citation.endLine <= lineCount);

      checks.push({
        name: 'line_valid',
        passed: lineValid && endLineValid,
        confidence: deterministic(lineValid && endLineValid, lineValid ? 'line_in_range' : 'line_out_of_range'),
        details: lineValid
          ? `Line ${citation.line}${citation.endLine ? `-${citation.endLine}` : ''} is valid (file has ${lineCount} lines)`
          : `Line ${citation.line} is out of range (file has ${lineCount} lines)`,
      });

      if (!lineValid) {
        return {
          status: 'refuted',
          checks,
        };
      }
    }

    // Check 3: Find matching fact near line
    const matchedFact = this.findFactNearLine(resolvedFile!, citation.line!, facts);
    checks.push({
      name: 'fact_at_line',
      passed: !!matchedFact,
      confidence: matchedFact
        ? bounded(0.7, 0.95, 'theoretical', 'AST fact found near cited line')
        : bounded(0.3, 0.6, 'theoretical', 'No AST fact near cited line (may be comment or expression)'),
      details: matchedFact
        ? `Found ${matchedFact.type} '${matchedFact.identifier}' at line ${matchedFact.line}`
        : 'No AST entity found at cited line (could be valid line reference)',
    });

    const status = matchedFact ? 'verified' : 'partially_verified';
    return { status, matchedFact, checks };
  }

  /**
   * Verify an identifier reference citation
   */
  private async verifyIdentifierReference(
    citation: EnhancedCitation,
    resolvedFile: string | undefined,
    facts: ASTFact[]
  ): Promise<{
    status: VerificationStatus;
    matchedFact?: ASTFact;
    suggestion?: EnhancedCitation;
    checks: VerificationCheck[];
  }> {
    const checks: VerificationCheck[] = [];

    if (!citation.identifier) {
      checks.push({
        name: 'identifier_present',
        passed: false,
        confidence: deterministic(false, 'no_identifier'),
        details: 'No identifier specified in citation',
      });
      return { status: 'unverified', checks };
    }

    // Check 1: File exists (if specified)
    if (resolvedFile) {
      const fileExists = fs.existsSync(resolvedFile);
      checks.push({
        name: 'file_exists',
        passed: fileExists,
        confidence: deterministic(fileExists, fileExists ? 'file_found' : 'file_not_found'),
        details: fileExists ? `File exists: ${resolvedFile}` : `File not found: ${citation.file}`,
      });

      if (!fileExists) {
        const suggestion = this.suggestFileCorrection(citation, facts);
        return { status: 'refuted', suggestion, checks };
      }
    }

    // Check 2: Find identifier in facts
    const matchedFact = this.findIdentifierInFacts(
      citation.identifier,
      resolvedFile,
      citation.line,
      facts
    );

    checks.push({
      name: 'identifier_found',
      passed: !!matchedFact,
      confidence: matchedFact
        ? deterministic(true, 'identifier_found_in_ast')
        : bounded(0.1, 0.3, 'theoretical', 'Identifier not found in AST'),
      details: matchedFact
        ? `Found '${matchedFact.identifier}' (${matchedFact.type}) at ${matchedFact.file}:${matchedFact.line}`
        : `Identifier '${citation.identifier}' not found in codebase`,
    });

    if (!matchedFact) {
      // Try to suggest a correction
      const suggestion = this.suggestIdentifierCorrection(citation, facts);
      return { status: 'refuted', suggestion, checks };
    }

    // Check 3: Line matches (if specified)
    if (citation.line !== undefined) {
      const lineDiff = Math.abs(matchedFact.line - citation.line);
      const lineMatches = lineDiff <= EnhancedCitationVerifier.LINE_TOLERANCE;

      checks.push({
        name: 'line_matches',
        passed: lineMatches,
        confidence: lineMatches
          ? bounded(0.8, 1.0, 'theoretical', `Line within ${lineDiff} of actual`)
          : bounded(0.2, 0.5, 'theoretical', `Line off by ${lineDiff}`),
        details: lineMatches
          ? `Line ${citation.line} matches fact at line ${matchedFact.line} (diff: ${lineDiff})`
          : `Line ${citation.line} does not match fact at line ${matchedFact.line} (diff: ${lineDiff})`,
      });

      if (!lineMatches) {
        // Suggest correction with correct line
        const suggestion: EnhancedCitation = {
          ...citation,
          line: matchedFact.line,
          file: matchedFact.file,
        };
        return { status: 'partially_verified', matchedFact, suggestion, checks };
      }
    }

    return { status: 'verified', matchedFact, checks };
  }

  /**
   * Verify a documentation reference
   */
  private async verifyDocumentation(
    citation: EnhancedCitation,
    resolvedFile: string | undefined,
    checks: VerificationCheck[]
  ): Promise<VerificationStatus> {
    const fileExists = resolvedFile ? fs.existsSync(resolvedFile) : false;

    checks.push({
      name: 'documentation_exists',
      passed: fileExists,
      confidence: deterministic(fileExists, fileExists ? 'doc_found' : 'doc_not_found'),
      details: fileExists
        ? `Documentation file exists: ${resolvedFile}`
        : `Documentation file not found: ${citation.file}`,
    });

    return fileExists ? 'verified' : 'refuted';
  }

  /**
   * Verify an external URL (basic check - does not make network requests by default)
   */
  private async verifyExternalUrl(
    citation: EnhancedCitation,
    checks: VerificationCheck[]
  ): Promise<VerificationStatus> {
    if (!citation.url) {
      checks.push({
        name: 'url_present',
        passed: false,
        confidence: deterministic(false, 'no_url'),
        details: 'No URL specified',
      });
      return 'unverified';
    }

    // Basic URL validation
    try {
      const url = new URL(citation.url);
      const isHttps = url.protocol === 'https:';

      checks.push({
        name: 'url_valid',
        passed: true,
        confidence: deterministic(true, 'valid_url_syntax'),
        details: `Valid URL: ${citation.url}`,
      });

      checks.push({
        name: 'url_secure',
        passed: isHttps,
        confidence: deterministic(isHttps, isHttps ? 'https_url' : 'http_url'),
        details: isHttps ? 'URL uses HTTPS' : 'URL uses HTTP (not HTTPS)',
      });

      // Check cache for previous verification
      const cached = this.urlCache.get(citation.url);
      if (cached && Date.now() - cached.timestamp < DEFAULT_BATCH_CONFIG.urlCacheDurationMs) {
        checks.push({
          name: 'url_cached',
          passed: cached.status === 'verified',
          confidence: bounded(0.5, 0.8, 'theoretical', 'Cached URL status'),
          details: `Cached status: ${cached.status}`,
        });
        return cached.status;
      }

      // Without network verification, mark as partially verified
      return 'partially_verified';
    } catch {
      checks.push({
        name: 'url_valid',
        passed: false,
        confidence: deterministic(false, 'invalid_url_syntax'),
        details: `Invalid URL: ${citation.url}`,
      });
      return 'refuted';
    }
  }

  /**
   * Verify a git commit reference
   */
  private async verifyCommitReference(
    citation: EnhancedCitation,
    repoPath: string,
    checks: VerificationCheck[]
  ): Promise<VerificationStatus> {
    if (!citation.commitSha) {
      checks.push({
        name: 'commit_sha_present',
        passed: false,
        confidence: deterministic(false, 'no_commit_sha'),
        details: 'No commit SHA specified',
      });
      return 'unverified';
    }

    // Check if .git directory exists
    const gitDir = path.join(repoPath, '.git');
    const isGitRepo = fs.existsSync(gitDir);

    checks.push({
      name: 'git_repo_exists',
      passed: isGitRepo,
      confidence: deterministic(isGitRepo, isGitRepo ? 'git_repo_found' : 'not_git_repo'),
      details: isGitRepo ? 'Repository is a git repo' : 'Not a git repository',
    });

    if (!isGitRepo) {
      return 'inaccessible';
    }

    // Basic SHA format validation
    const isValidShaFormat = /^[a-f0-9]{7,40}$/.test(citation.commitSha);
    checks.push({
      name: 'sha_format_valid',
      passed: isValidShaFormat,
      confidence: deterministic(isValidShaFormat, isValidShaFormat ? 'valid_sha_format' : 'invalid_sha_format'),
      details: isValidShaFormat
        ? `Valid SHA format: ${citation.commitSha}`
        : `Invalid SHA format: ${citation.commitSha}`,
    });

    if (!isValidShaFormat) {
      return 'refuted';
    }

    // Without executing git commands, mark as partially verified
    // Full verification would require: git cat-file -e <sha>
    return 'partially_verified';
  }

  // ============================================================================
  // BATCH VERIFICATION
  // ============================================================================

  /**
   * Verify multiple citations in batch for efficiency
   */
  async verifyBatch(
    citations: EnhancedCitation[],
    repoPath: string,
    config: Partial<BatchVerificationConfig> = {}
  ): Promise<BatchVerificationResult> {
    const startTime = Date.now();
    const effectiveConfig = { ...DEFAULT_BATCH_CONFIG, ...config };

    // Pre-extract facts once for all citations
    const facts = effectiveConfig.preloadedFacts ?? await this.getOrExtractFacts(repoPath);

    // Process in batches for concurrency control
    const results: EnhancedVerificationResult[] = [];
    const batchSize = effectiveConfig.concurrency;

    for (let i = 0; i < citations.length; i += batchSize) {
      const batch = citations.slice(i, i + batchSize);
      const batchPromises = batch.map(citation =>
        this.verifyCitation(citation, repoPath, facts)
      );

      // Add timeout wrapper
      const timeoutPromises = batchPromises.map(promise =>
        Promise.race([
          promise,
          new Promise<EnhancedVerificationResult>((_, reject) =>
            setTimeout(() => reject(new Error('Verification timeout')), effectiveConfig.timeoutMs)
          ),
        ]).catch(error => this.createTimeoutResult(batch[batchPromises.indexOf(promise)], error))
      );

      const batchResults = await Promise.all(timeoutPromises);
      results.push(...batchResults);
    }

    // Compute statistics
    const statistics = this.computeStatistics(results);

    // Compute aggregate confidence
    const confidenceValues = results
      .map(r => r.confidence)
      .filter((c): c is ConfidenceValue => !isAbsentConfidence(c));

    const aggregateConfidence = confidenceValues.length > 0
      ? parallelAllConfidence(confidenceValues)
      : absent('insufficient_data');

    return {
      results,
      statistics,
      aggregateConfidence,
      totalDurationMs: Date.now() - startTime,
      completedAt: new Date().toISOString(),
    };
  }

  // ============================================================================
  // VALIDATION REPORT GENERATION
  // ============================================================================

  /**
   * Generate a comprehensive validation report
   */
  async generateReport(
    sourceDocument: string,
    repoPath: string,
    config: Partial<BatchVerificationConfig> = {}
  ): Promise<ValidationReport> {
    // Extract citations
    const citations = this.extractCitations(sourceDocument);

    // Verify all citations
    const verification = await this.verifyBatch(citations, repoPath, config);

    // Build grounding chain
    const groundingChain = verification.results
      .filter(r => r.grounding)
      .map(r => r.grounding!);

    // Generate recommendations
    const recommendations = this.generateRecommendations(verification);

    // Assess overall quality
    const assessment = this.assessQuality(verification);

    // Compute document hash
    const docHash = createHash('sha256').update(sourceDocument).digest('hex');

    // Get git hash if available
    let gitHash: string | undefined;
    const gitHeadPath = path.join(repoPath, '.git', 'HEAD');
    if (fs.existsSync(gitHeadPath)) {
      try {
        const headContent = fs.readFileSync(gitHeadPath, 'utf-8').trim();
        if (headContent.startsWith('ref:')) {
          const refPath = path.join(repoPath, '.git', headContent.slice(5).trim());
          if (fs.existsSync(refPath)) {
            gitHash = fs.readFileSync(refPath, 'utf-8').trim();
          }
        } else {
          gitHash = headContent;
        }
      } catch {
        // Ignore git errors
      }
    }

    return {
      id: `report_${createHash('sha256').update(docHash + Date.now()).digest('hex').slice(0, 16)}`,
      title: 'Citation Validation Report',
      sourceDocument: {
        content: sourceDocument,
        hash: docHash,
      },
      repository: {
        path: repoPath,
        gitHash,
      },
      verification,
      groundingChain,
      recommendations,
      assessment,
      metadata: {
        generatedAt: new Date().toISOString(),
        generatorVersion: '1.0.0',
        configUsed: { ...DEFAULT_BATCH_CONFIG, ...config },
      },
    };
  }

  // ============================================================================
  // EPISTEMIC INTEGRATION
  // ============================================================================

  /**
   * Create evidence entry for ledger integration
   */
  createEvidenceEntry(
    result: EnhancedVerificationResult
  ): Omit<EvidenceEntry, 'id' | 'timestamp'> {
    const payload: VerificationEvidence = {
      claimId: result.citation.id as unknown as EvidenceId,
      method: 'static_analysis',
      result: result.status === 'verified'
        ? 'verified'
        : result.status === 'refuted'
          ? 'refuted'
          : 'inconclusive',
      details: result.checks.map(c => `${c.name}: ${c.passed ? 'PASS' : 'FAIL'} - ${c.details}`).join('\n'),
    };

    return {
      kind: 'verification',
      payload,
      provenance: {
        source: 'ast_parser',
        method: 'enhanced_citation_verification',
        agent: {
          type: 'tool',
          identifier: 'EnhancedCitationVerifier',
          version: '1.0.0',
        },
      },
      confidence: result.confidence,
      relatedEntries: [],
    };
  }

  /**
   * Record verification results to evidence ledger
   */
  async recordToLedger(
    results: EnhancedVerificationResult[],
    ledger: IEvidenceLedger
  ): Promise<EvidenceEntry[]> {
    const entries = results.map(r => this.createEvidenceEntry(r));
    return ledger.appendBatch(entries);
  }

  // ============================================================================
  // PRIVATE HELPER METHODS
  // ============================================================================

  /**
   * Get or extract AST facts with caching
   */
  private async getOrExtractFacts(repoPath: string): Promise<ASTFact[]> {
    const cached = this.factCache.get(repoPath);
    if (cached && Date.now() - cached.timestamp < EnhancedCitationVerifier.FACT_CACHE_DURATION_MS) {
      return cached.facts;
    }

    const facts = await this.astExtractor.extractFromDirectory(repoPath);
    this.factCache.set(repoPath, { facts, timestamp: Date.now() });
    return facts;
  }

  /**
   * Extract context around a match to form the claim
   */
  private extractClaimContext(text: string, matchIndex: number): string {
    const start = Math.max(0, matchIndex - 50);
    const end = Math.min(text.length, matchIndex + 100);
    let context = text.slice(start, end).trim();
    context = context.replace(/\s+/g, ' ');
    if (start > 0) context = '...' + context;
    if (end < text.length) context = context + '...';
    return context;
  }

  /**
   * Check if a citation is a duplicate
   */
  private isDuplicate(citations: EnhancedCitation[], file: string, line: number): boolean {
    return citations.some(c => c.file === file && c.line === line);
  }

  /**
   * Resolve a potentially relative path against a base path
   */
  private resolvePath(filePath: string, basePath: string): string {
    const normalized = filePath.replace(/\\/g, '/');
    if (path.isAbsolute(normalized)) {
      return normalized;
    }
    return path.resolve(basePath, normalized);
  }

  /**
   * Get the number of lines in a file
   */
  private getFileLineCount(filePath: string): number {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      return content.split('\n').length;
    } catch {
      return 0;
    }
  }

  /**
   * Find a fact near a specific line
   */
  private findFactNearLine(file: string, line: number, facts: ASTFact[]): ASTFact | undefined {
    const normalizedFile = this.normalizePath(file);

    for (const fact of facts) {
      const factFile = this.normalizePath(fact.file);
      const filesMatch =
        factFile === normalizedFile ||
        factFile.endsWith(normalizedFile) ||
        normalizedFile.endsWith(factFile);

      if (filesMatch) {
        const lineDiff = Math.abs(fact.line - line);
        if (lineDiff <= EnhancedCitationVerifier.LINE_TOLERANCE) {
          return fact;
        }
      }
    }

    return undefined;
  }

  /**
   * Find an identifier in facts
   */
  private findIdentifierInFacts(
    identifier: string,
    file: string | undefined,
    line: number | undefined,
    facts: ASTFact[]
  ): ASTFact | undefined {
    const normalizedFile = file ? this.normalizePath(file) : undefined;

    // First try exact match with file
    if (normalizedFile) {
      for (const fact of facts) {
        const factFile = this.normalizePath(fact.file);
        const filesMatch =
          factFile === normalizedFile ||
          factFile.endsWith(normalizedFile) ||
          normalizedFile.endsWith(factFile);

        if (filesMatch && fact.identifier === identifier) {
          if (line === undefined || Math.abs(fact.line - line) <= EnhancedCitationVerifier.LINE_TOLERANCE) {
            return fact;
          }
        }
      }
    }

    // Then try identifier only
    const identifierMatches = facts.filter(f => f.identifier === identifier);
    if (identifierMatches.length === 1) {
      return identifierMatches[0];
    }

    // If multiple matches and line specified, find closest
    if (identifierMatches.length > 1 && line !== undefined) {
      return identifierMatches.reduce((closest, fact) =>
        Math.abs(fact.line - line) < Math.abs(closest.line - line) ? fact : closest
      );
    }

    return identifierMatches[0];
  }

  /**
   * Normalize a path for comparison
   */
  private normalizePath(filePath: string): string {
    return filePath.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
  }

  /**
   * Suggest a file correction
   */
  private suggestFileCorrection(
    citation: EnhancedCitation,
    facts: ASTFact[]
  ): EnhancedCitation | undefined {
    if (!citation.file) return undefined;

    const targetFilename = path.basename(citation.file).toLowerCase();
    const seenFiles = new Set<string>();
    let bestMatch: ASTFact | undefined;
    let bestScore = 0;

    for (const fact of facts) {
      if (seenFiles.has(fact.file)) continue;
      seenFiles.add(fact.file);

      const factFilename = path.basename(fact.file).toLowerCase();
      const distance = this.levenshteinDistance(factFilename, targetFilename);

      if (distance <= 3) {
        const score = 10 - distance;
        if (score > bestScore) {
          bestScore = score;
          bestMatch = fact;
        }
      }
    }

    if (bestMatch && bestScore >= 5) {
      return {
        ...citation,
        file: bestMatch.file,
      };
    }

    return undefined;
  }

  /**
   * Suggest an identifier correction
   */
  private suggestIdentifierCorrection(
    citation: EnhancedCitation,
    facts: ASTFact[]
  ): EnhancedCitation | undefined {
    if (!citation.identifier) return undefined;

    const targetId = citation.identifier.toLowerCase();
    let bestMatch: ASTFact | undefined;
    let bestDistance = Infinity;

    for (const fact of facts) {
      const distance = this.levenshteinDistance(fact.identifier.toLowerCase(), targetId);
      if (distance <= 3 && distance < bestDistance) {
        bestDistance = distance;
        bestMatch = fact;
      }
    }

    if (bestMatch) {
      return {
        ...citation,
        identifier: bestMatch.identifier,
        file: bestMatch.file,
        line: bestMatch.line,
      };
    }

    return undefined;
  }

  /**
   * Calculate Levenshtein distance
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
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }

    return matrix[b.length][a.length];
  }

  /**
   * Compute verification confidence from checks
   */
  private computeVerificationConfidence(
    checks: VerificationCheck[],
    status: VerificationStatus
  ): ConfidenceValue {
    if (checks.length === 0) {
      return absent('insufficient_data');
    }

    const confidenceValues = checks
      .map(c => c.confidence)
      .filter((c): c is ConfidenceValue => !isAbsentConfidence(c));

    if (confidenceValues.length === 0) {
      return absent('uncalibrated');
    }

    // Use sequence confidence (min) for verification checks - all must pass
    return sequenceConfidence(confidenceValues);
  }

  /**
   * Create grounding relation for verification result
   */
  private createGrounding(
    citation: EnhancedCitation,
    status: VerificationStatus,
    confidence: ConfidenceValue
  ): Grounding {
    const groundingType: ExtendedGroundingType =
      status === 'verified' ? 'evidential' :
      status === 'refuted' ? 'rebutting' :
      'partial';

    const numericConfidence = getNumericValue(confidence) ?? 0.5;

    return {
      id: createGroundingId('citation'),
      from: createObjectId('verification'),
      to: createObjectId(`citation_${citation.id}`),
      type: groundingType,
      strength: {
        value: numericConfidence,
        basis: 'derived',
      },
      active: status === 'verified' || status === 'partially_verified',
      explanation: `Citation verification: ${status}`,
    };
  }

  /**
   * Create timeout result for failed verification
   */
  private createTimeoutResult(
    citation: EnhancedCitation,
    error: unknown
  ): EnhancedVerificationResult {
    return {
      citation,
      status: 'inaccessible',
      confidence: absent('insufficient_data'),
      checks: [{
        name: 'timeout',
        passed: false,
        confidence: deterministic(false, 'verification_timeout'),
        details: `Verification timed out: ${error instanceof Error ? error.message : 'Unknown error'}`,
      }],
      verifiedAt: new Date().toISOString(),
      verificationDurationMs: DEFAULT_BATCH_CONFIG.timeoutMs,
    };
  }

  /**
   * Compute statistics from verification results
   */
  private computeStatistics(results: EnhancedVerificationResult[]): VerificationStatistics {
    const byType: Record<CitationType, { total: number; verified: number; verificationRate: number }> = {
      code_reference: { total: 0, verified: 0, verificationRate: 0 },
      identifier_reference: { total: 0, verified: 0, verificationRate: 0 },
      documentation: { total: 0, verified: 0, verificationRate: 0 },
      external_url: { total: 0, verified: 0, verificationRate: 0 },
      commit_reference: { total: 0, verified: 0, verificationRate: 0 },
      issue_reference: { total: 0, verified: 0, verificationRate: 0 },
      line_range: { total: 0, verified: 0, verificationRate: 0 },
    };

    let verified = 0;
    let partiallyVerified = 0;
    let unverified = 0;
    let refuted = 0;
    let stale = 0;
    let inaccessible = 0;
    let totalConfidence = 0;
    let confidenceCount = 0;

    for (const result of results) {
      // Count by status
      switch (result.status) {
        case 'verified': verified++; break;
        case 'partially_verified': partiallyVerified++; break;
        case 'unverified': unverified++; break;
        case 'refuted': refuted++; break;
        case 'stale': stale++; break;
        case 'inaccessible': inaccessible++; break;
      }

      // Count by type
      byType[result.citation.type].total++;
      if (result.status === 'verified' || result.status === 'partially_verified') {
        byType[result.citation.type].verified++;
      }

      // Accumulate confidence
      const numericConf = getNumericValue(result.confidence);
      if (numericConf !== null) {
        totalConfidence += numericConf;
        confidenceCount++;
      }
    }

    // Calculate rates per type
    for (const type of Object.keys(byType) as CitationType[]) {
      if (byType[type].total > 0) {
        byType[type].verificationRate = byType[type].verified / byType[type].total;
      }
    }

    const total = results.length;
    const verificationRate = total > 0 ? (verified + partiallyVerified) / total : 0;
    const averageConfidence = confidenceCount > 0 ? totalConfidence / confidenceCount : 0;

    return {
      total,
      verified,
      partiallyVerified,
      unverified,
      refuted,
      stale,
      inaccessible,
      verificationRate,
      averageConfidence,
      byType,
    };
  }

  /**
   * Generate recommendations from verification results
   */
  private generateRecommendations(
    verification: BatchVerificationResult
  ): ValidationRecommendation[] {
    const recommendations: ValidationRecommendation[] = [];

    for (const result of verification.results) {
      if (result.status === 'refuted') {
        recommendations.push({
          severity: 'critical',
          category: 'incorrect_citation',
          description: `Citation "${result.citation.rawText}" is incorrect`,
          suggestedFix: result.suggestion
            ? `Replace with: ${result.suggestion.file}${result.suggestion.line ? `:${result.suggestion.line}` : ''}`
            : 'Remove or correct the citation',
          relatedCitationIds: [result.citation.id],
        });
      } else if (result.status === 'stale') {
        recommendations.push({
          severity: 'warning',
          category: 'stale_citation',
          description: `Citation "${result.citation.rawText}" may be outdated`,
          suggestedFix: 'Verify the citation is still accurate',
          relatedCitationIds: [result.citation.id],
        });
      } else if (result.status === 'unverified') {
        recommendations.push({
          severity: 'suggestion',
          category: 'ambiguous_citation',
          description: `Citation "${result.citation.rawText}" could not be verified`,
          suggestedFix: 'Add more specific file/line information',
          relatedCitationIds: [result.citation.id],
        });
      }
    }

    return recommendations;
  }

  /**
   * Assess overall quality of verification results
   */
  private assessQuality(
    verification: BatchVerificationResult
  ): ValidationReport['assessment'] {
    const stats = verification.statistics;
    const rate = stats.verificationRate;

    let quality: ValidationReport['assessment']['quality'];
    let summary: string;

    if (rate >= 0.95) {
      quality = 'excellent';
      summary = `All ${stats.total} citations verified successfully`;
    } else if (rate >= 0.85) {
      quality = 'good';
      summary = `${stats.verified + stats.partiallyVerified}/${stats.total} citations verified (${Math.round(rate * 100)}%)`;
    } else if (rate >= 0.7) {
      quality = 'acceptable';
      summary = `${stats.verified + stats.partiallyVerified}/${stats.total} citations verified (${Math.round(rate * 100)}%). Some citations need attention.`;
    } else if (rate >= 0.5) {
      quality = 'poor';
      summary = `Only ${stats.verified + stats.partiallyVerified}/${stats.total} citations verified (${Math.round(rate * 100)}%). Multiple citations need correction.`;
    } else {
      quality = 'failing';
      summary = `Verification rate too low: ${Math.round(rate * 100)}%. Major citation issues detected.`;
    }

    return {
      quality,
      summary,
      confidence: verification.aggregateConfidence,
    };
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a new EnhancedCitationVerifier instance
 */
export function createEnhancedCitationVerifier(): EnhancedCitationVerifier {
  return new EnhancedCitationVerifier();
}
