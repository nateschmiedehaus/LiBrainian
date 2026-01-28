/**
 * @fileoverview Self-Index Validator (WU-META-002)
 *
 * Validates the quality of Librarian's self-index by querying the index
 * with known questions about Librarian's own codebase and verifying that
 * results are accurate, relevant, and provide good coverage.
 *
 * This is a key primitive for the meta-epistemic loop: Librarian must be
 * able to verify that its knowledge about itself is accurate.
 *
 * @packageDocumentation
 */

import type { LibrarianStorage } from '../../storage/types.js';
import type { QueryInterface, SearchResult } from '../../api/query_interface.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * A query specification for validation.
 */
export interface QuerySpec {
  /** The query string to send to the index */
  query: string;
  /** File paths that should appear in results (partial matches allowed) */
  expectedFiles: string[];
  /** Concepts/terms that should appear in result content */
  expectedConcepts: string[];
  /** Optional: minimum number of results expected */
  minResults?: number;
  /** Optional: category for grouping validation results */
  category?: string;
}

/**
 * Result of validating a single query.
 */
export interface ValidationResult {
  /** The original query */
  query: string;
  /** Whether the validation passed */
  passed: boolean;
  /** Relevance score (0.0 - 1.0) based on expected files and concepts found */
  relevanceScore: number;
  /** Files that were found in results */
  foundFiles: string[];
  /** Expected files that were NOT found */
  missingFiles: string[];
  /** Concepts that were found in results */
  foundConcepts: string[];
  /** Expected concepts that were NOT found */
  missingConcepts: string[];
  /** Number of results returned */
  resultCount: number;
  /** Time taken to execute query (ms) */
  queryTimeMs: number;
  /** Category of this query (if specified) */
  category?: string;
  /** Any errors encountered */
  error?: string;
}

/**
 * Overall validation report.
 */
export interface ValidationReport {
  /** Total number of queries executed */
  totalQueries: number;
  /** Number of queries that passed */
  passedQueries: number;
  /** Average relevance score across all queries */
  avgRelevanceScore: number;
  /** Coverage percentage: passed / total */
  coveragePercent: number;
  /** Individual results for each query */
  results: ValidationResult[];
  /** Actionable recommendations for improving the index */
  recommendations: string[];
  /** Total time for validation run (ms) */
  totalTimeMs: number;
  /** Breakdown by category (if categories were used) */
  categoryBreakdown?: Record<string, {
    total: number;
    passed: number;
    avgRelevance: number;
  }>;
}

/**
 * Options for the validator.
 */
export interface SelfIndexValidatorOptions {
  /** Storage instance to use */
  storage?: LibrarianStorage;
  /** Query interface to use (alternative to storage) */
  queryInterface?: QueryInterface;
  /** Minimum relevance score to consider a query passed (default: 0.5) */
  passThreshold?: number;
  /** Enable verbose logging */
  verbose?: boolean;
}

// ============================================================================
// DEFAULT VALIDATION QUERIES
// ============================================================================

/**
 * Default validation queries that cover key Librarian components.
 * These queries test the self-index's knowledge of Librarian's own codebase.
 */
export const DEFAULT_VALIDATION_QUERIES: QuerySpec[] = [
  // Epistemics - Confidence
  {
    query: 'What is ConfidenceValue?',
    expectedFiles: ['src/epistemics/confidence.ts', 'src/epistemics/types.ts'],
    expectedConcepts: ['deterministic', 'derived', 'measured', 'bounded', 'absent'],
    category: 'epistemics',
  },
  // Epistemics - Evidence Ledger
  {
    query: 'How does the evidence ledger work?',
    expectedFiles: ['src/epistemics/evidence_ledger.ts'],
    expectedConcepts: ['append', 'entry', 'provenance'],
    category: 'epistemics',
  },
  // Epistemics - Defeaters
  {
    query: 'How are defeaters implemented?',
    expectedFiles: ['src/epistemics/defeaters.ts'],
    expectedConcepts: ['rebutting', 'undercutting', 'undermining'],
    category: 'epistemics',
  },
  // Self-Improvement
  {
    query: 'What self-improvement primitives exist?',
    expectedFiles: ['src/agents/self_improvement/'],
    expectedConcepts: ['bootstrap', 'refresh', 'verify', 'analyze'],
    category: 'self-improvement',
  },
  // Templates
  {
    query: 'What templates are available?',
    expectedFiles: ['src/api/template_registry.ts'],
    expectedConcepts: ['T1', 'T2', 'RepoMap', 'DeltaMap'],
    category: 'api',
  },
  // Storage
  {
    query: 'How does Librarian storage work?',
    expectedFiles: ['src/storage/'],
    expectedConcepts: ['function', 'module', 'context', 'pack'],
    category: 'storage',
  },
  // Calibration
  {
    query: 'How is confidence calibration done?',
    expectedFiles: ['src/epistemics/calibration.ts'],
    expectedConcepts: ['ECE', 'Brier', 'reliability', 'bin'],
    category: 'epistemics',
  },
  // Query Interface
  {
    query: 'How does the query interface work?',
    expectedFiles: ['src/api/query_interface.ts'],
    expectedConcepts: ['intent', 'search', 'similar'],
    category: 'api',
  },
  // Index Librarian
  {
    query: 'What does IndexLibrarian do?',
    expectedFiles: ['src/agents/index_librarian.ts'],
    expectedConcepts: ['index', 'file', 'function', 'symbol'],
    category: 'agents',
  },
  // Epistemics Types
  {
    query: 'What types are used in the epistemics module?',
    expectedFiles: ['src/epistemics/types.ts'],
    expectedConcepts: ['Claim', 'ClaimId', 'EvidenceEdge', 'ExtendedDefeater'],
    category: 'epistemics',
  },
  // Self Bootstrap
  {
    query: 'How does self-bootstrap work?',
    expectedFiles: ['src/agents/self_improvement/self_bootstrap.ts'],
    expectedConcepts: ['index', 'coverage', 'isSelfReferential'],
    category: 'self-improvement',
  },
  // Self Refresh
  {
    query: 'What does self-refresh do?',
    expectedFiles: ['src/agents/self_improvement/self_refresh.ts'],
    expectedConcepts: ['change', 'update', 'incremental'],
    category: 'self-improvement',
  },
  // Architecture Analysis
  {
    query: 'How is architecture analyzed?',
    expectedFiles: ['src/agents/self_improvement/analyze_architecture.ts'],
    expectedConcepts: ['module', 'dependency', 'cycle', 'coupling'],
    category: 'self-improvement',
  },
  // Claim Verification
  {
    query: 'How are claims verified?',
    expectedFiles: ['src/agents/self_improvement/verify_claim.ts'],
    expectedConcepts: ['evidence', 'verification', 'gettier'],
    category: 'self-improvement',
  },
  // Pattern Extraction
  {
    query: 'How are patterns extracted?',
    expectedFiles: ['src/agents/self_improvement/extract_pattern.ts'],
    expectedConcepts: ['pattern', 'generalization', 'applicability'],
    category: 'self-improvement',
  },
];

// ============================================================================
// SELF INDEX VALIDATOR CLASS
// ============================================================================

/**
 * Validates the quality of Librarian's self-index.
 *
 * This class provides methods to:
 * - Validate individual queries against expected results
 * - Run full validation suites
 * - Check coverage of expected file paths
 * - Generate recommendations for improving the index
 *
 * @example
 * ```typescript
 * const validator = new SelfIndexValidator({ queryInterface });
 * const report = await validator.runFullValidation();
 * console.log(`Coverage: ${report.coveragePercent}%`);
 * ```
 */
export class SelfIndexValidator {
  private queryInterface: QueryInterface | null;
  private storage: LibrarianStorage | null;
  private passThreshold: number;
  private verbose: boolean;

  constructor(options: SelfIndexValidatorOptions = {}) {
    this.queryInterface = options.queryInterface ?? null;
    this.storage = options.storage ?? null;
    this.passThreshold = options.passThreshold ?? 0.5;
    this.verbose = options.verbose ?? false;

    if (!this.queryInterface && !this.storage) {
      // Allow construction without either for testing
      // In production, one must be provided before querying
    }
  }

  /**
   * Validate a single query against expected results.
   *
   * @param spec - The query specification to validate
   * @returns Validation result with relevance score and found/missing items
   */
  async validateQuery(spec: QuerySpec): Promise<ValidationResult> {
    const startTime = Date.now();
    const result: ValidationResult = {
      query: spec.query,
      passed: false,
      relevanceScore: 0,
      foundFiles: [],
      missingFiles: [...spec.expectedFiles],
      foundConcepts: [],
      missingConcepts: [...spec.expectedConcepts],
      resultCount: 0,
      queryTimeMs: 0,
      category: spec.category,
    };

    try {
      // Execute query
      const searchResults = await this.executeQuery(spec.query);
      result.resultCount = searchResults.length;
      result.queryTimeMs = Date.now() - startTime;

      if (searchResults.length === 0) {
        result.error = 'No results returned';
        return result;
      }

      // Check minimum results
      if (spec.minResults && searchResults.length < spec.minResults) {
        result.error = `Expected at least ${spec.minResults} results, got ${searchResults.length}`;
      }

      // Analyze results for expected files
      const allContent = this.extractContentFromResults(searchResults);

      for (const expectedFile of spec.expectedFiles) {
        const found = this.fileInResults(expectedFile, searchResults, allContent);
        if (found) {
          result.foundFiles.push(expectedFile);
          result.missingFiles = result.missingFiles.filter((f) => f !== expectedFile);
        }
      }

      // Analyze results for expected concepts
      const contentLower = allContent.toLowerCase();
      for (const expectedConcept of spec.expectedConcepts) {
        if (contentLower.includes(expectedConcept.toLowerCase())) {
          result.foundConcepts.push(expectedConcept);
          result.missingConcepts = result.missingConcepts.filter((c) => c !== expectedConcept);
        }
      }

      // Compute relevance score
      const fileScore = spec.expectedFiles.length > 0
        ? result.foundFiles.length / spec.expectedFiles.length
        : 1;
      const conceptScore = spec.expectedConcepts.length > 0
        ? result.foundConcepts.length / spec.expectedConcepts.length
        : 1;

      // Weight files and concepts equally
      result.relevanceScore = (fileScore + conceptScore) / 2;
      result.passed = result.relevanceScore >= this.passThreshold;

      if (this.verbose) {
        console.log(`[SelfIndexValidator] Query: "${spec.query}"`);
        console.log(`  Relevance: ${(result.relevanceScore * 100).toFixed(1)}%`);
        console.log(`  Found files: ${result.foundFiles.join(', ') || 'none'}`);
        console.log(`  Missing files: ${result.missingFiles.join(', ') || 'none'}`);
        console.log(`  Found concepts: ${result.foundConcepts.join(', ') || 'none'}`);
        console.log(`  Missing concepts: ${result.missingConcepts.join(', ') || 'none'}`);
      }
    } catch (error) {
      result.queryTimeMs = Date.now() - startTime;
      result.error = error instanceof Error ? error.message : String(error);
    }

    return result;
  }

  /**
   * Run full validation with all default queries plus any custom queries.
   *
   * @param customQueries - Additional queries to include in validation
   * @returns Comprehensive validation report
   */
  async runFullValidation(customQueries: QuerySpec[] = []): Promise<ValidationReport> {
    const startTime = Date.now();
    const allQueries = [...DEFAULT_VALIDATION_QUERIES, ...customQueries];
    const results: ValidationResult[] = [];

    for (const spec of allQueries) {
      const result = await this.validateQuery(spec);
      results.push(result);
    }

    // Compute statistics
    const passedQueries = results.filter((r) => r.passed).length;
    const totalRelevance = results.reduce((sum, r) => sum + r.relevanceScore, 0);
    const avgRelevanceScore = results.length > 0 ? totalRelevance / results.length : 0;
    const coveragePercent = results.length > 0
      ? (passedQueries / results.length) * 100
      : 0;

    // Generate recommendations
    const recommendations = this.generateRecommendations(results);

    // Compute category breakdown
    const categoryBreakdown = this.computeCategoryBreakdown(results);

    return {
      totalQueries: results.length,
      passedQueries,
      avgRelevanceScore,
      coveragePercent,
      results,
      recommendations,
      totalTimeMs: Date.now() - startTime,
      categoryBreakdown,
    };
  }

  /**
   * Check coverage of a set of expected file paths.
   *
   * @param expectedPaths - Paths that should be discoverable via the index
   * @returns Coverage percentage (0.0 - 1.0)
   */
  async checkCoverage(expectedPaths: string[]): Promise<number> {
    if (expectedPaths.length === 0) {
      return 1.0;
    }

    let coveredCount = 0;

    for (const path of expectedPaths) {
      // Query for the path directly
      const query = `What is in ${path}?`;
      try {
        const results = await this.executeQuery(query);
        const content = this.extractContentFromResults(results);

        // Check if any result references this path
        if (this.fileInResults(path, results, content)) {
          coveredCount++;
        }
      } catch {
        // Path not covered
      }
    }

    return coveredCount / expectedPaths.length;
  }

  /**
   * Set the query interface (for dependency injection).
   */
  setQueryInterface(queryInterface: QueryInterface): void {
    this.queryInterface = queryInterface;
  }

  /**
   * Set the storage (for dependency injection).
   */
  setStorage(storage: LibrarianStorage): void {
    this.storage = storage;
  }

  // ============================================================================
  // PRIVATE METHODS
  // ============================================================================

  private async executeQuery(query: string): Promise<SearchResult[]> {
    if (this.queryInterface) {
      return this.queryInterface.search(query);
    }

    // Fallback: create a mock result if no query interface
    // This allows the validator to be tested without a full Librarian instance
    return [];
  }

  private extractContentFromResults(results: SearchResult[]): string {
    return results
      .map((r) => `${r.packId} ${r.packType} ${r.summary} ${r.relatedFiles.join(' ')}`)
      .join(' ');
  }

  private fileInResults(
    expectedFile: string,
    results: SearchResult[],
    allContent: string
  ): boolean {
    // Check relatedFiles arrays
    for (const result of results) {
      for (const file of result.relatedFiles) {
        if (this.pathMatches(expectedFile, file)) {
          return true;
        }
      }
    }

    // Check in content/summaries (partial match)
    if (allContent.includes(expectedFile)) {
      return true;
    }

    // Check if it's a directory pattern (ends with /)
    if (expectedFile.endsWith('/')) {
      const dirPattern = expectedFile.slice(0, -1);
      return allContent.includes(dirPattern);
    }

    return false;
  }

  private pathMatches(expected: string, actual: string): boolean {
    // Exact match
    if (expected === actual) {
      return true;
    }

    // Expected is a directory pattern (ends with /)
    if (expected.endsWith('/')) {
      return actual.startsWith(expected);
    }

    // Partial path match (expected is a suffix)
    if (actual.endsWith(expected)) {
      return true;
    }

    // Partial path match (expected without leading path)
    const expectedBasename = expected.split('/').pop() ?? expected;
    const actualBasename = actual.split('/').pop() ?? actual;
    return expectedBasename === actualBasename;
  }

  private generateRecommendations(results: ValidationResult[]): string[] {
    const recommendations: string[] = [];

    // Find common missing patterns
    const missingFileCounts = new Map<string, number>();
    const missingConceptCounts = new Map<string, number>();

    for (const result of results) {
      for (const file of result.missingFiles) {
        missingFileCounts.set(file, (missingFileCounts.get(file) ?? 0) + 1);
      }
      for (const concept of result.missingConcepts) {
        missingConceptCounts.set(concept, (missingConceptCounts.get(concept) ?? 0) + 1);
      }
    }

    // Recommend re-indexing for frequently missing files
    const missingFileEntries = Array.from(missingFileCounts.entries())
      .sort((a, b) => b[1] - a[1]);

    if (missingFileEntries.length > 0) {
      const topMissing = missingFileEntries.slice(0, 3);
      recommendations.push(
        `Consider re-indexing these files that are frequently missing from results: ${topMissing.map(([f]) => f).join(', ')}`
      );
    }

    // Recommend adding context for frequently missing concepts
    const missingConceptEntries = Array.from(missingConceptCounts.entries())
      .sort((a, b) => b[1] - a[1]);

    if (missingConceptEntries.length > 0) {
      const topMissing = missingConceptEntries.slice(0, 5);
      recommendations.push(
        `Consider enriching index with these concepts: ${topMissing.map(([c]) => c).join(', ')}`
      );
    }

    // Check overall coverage
    const failedResults = results.filter((r) => !r.passed);
    if (failedResults.length > results.length * 0.3) {
      recommendations.push(
        `Over 30% of validation queries failed. Consider running a full self-bootstrap to refresh the index.`
      );
    }

    // Check for errors
    const errorResults = results.filter((r) => r.error);
    if (errorResults.length > 0) {
      recommendations.push(
        `${errorResults.length} queries encountered errors. Check query interface and storage connectivity.`
      );
    }

    // Category-specific recommendations
    const categoryResults = this.computeCategoryBreakdown(results);
    for (const [category, stats] of Object.entries(categoryResults)) {
      if (stats.avgRelevance < 0.3) {
        recommendations.push(
          `Category '${category}' has low relevance (${(stats.avgRelevance * 100).toFixed(1)}%). Consider improving coverage for this area.`
        );
      }
    }

    // No issues found
    if (recommendations.length === 0) {
      recommendations.push('Self-index quality is good. No specific improvements needed.');
    }

    return recommendations;
  }

  private computeCategoryBreakdown(results: ValidationResult[]): Record<string, {
    total: number;
    passed: number;
    avgRelevance: number;
  }> {
    const breakdown: Record<string, { total: number; passed: number; totalRelevance: number }> = {};

    for (const result of results) {
      const category = result.category ?? 'uncategorized';
      if (!breakdown[category]) {
        breakdown[category] = { total: 0, passed: 0, totalRelevance: 0 };
      }
      breakdown[category].total++;
      if (result.passed) {
        breakdown[category].passed++;
      }
      breakdown[category].totalRelevance += result.relevanceScore;
    }

    // Convert to final format
    const result: Record<string, { total: number; passed: number; avgRelevance: number }> = {};
    for (const [category, stats] of Object.entries(breakdown)) {
      result[category] = {
        total: stats.total,
        passed: stats.passed,
        avgRelevance: stats.total > 0 ? stats.totalRelevance / stats.total : 0,
      };
    }

    return result;
  }
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Create a SelfIndexValidator with the given options.
 */
export function createSelfIndexValidator(
  options: SelfIndexValidatorOptions = {}
): SelfIndexValidator {
  return new SelfIndexValidator(options);
}

/**
 * Run self-index validation and return a report.
 * Convenience function for one-shot validation.
 */
export async function validateSelfIndex(
  options: SelfIndexValidatorOptions,
  customQueries: QuerySpec[] = []
): Promise<ValidationReport> {
  const validator = new SelfIndexValidator(options);
  return validator.runFullValidation(customQueries);
}
