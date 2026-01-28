/**
 * @fileoverview Iterative Retrieval (WU-1108)
 *
 * Improves retrieval quality by doing multiple rounds of retrieval,
 * using results from each round to refine the next. This is a Tier-2 feature.
 *
 * Strategy:
 * 1. Round 1: Initial keyword-based retrieval
 * 2. Term Extraction: Find new relevant terms in results
 * 3. Round 2: Expand query with new terms, retrieve again
 * 4. Cross-file Chasing: Follow imports/references to related files
 * 5. Repeat until coverage gain is below threshold or max rounds
 *
 * @packageDocumentation
 */

import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * A single result item from retrieval
 */
export interface IterativeRetrievalResultItem {
  /** The file path */
  file: string;
  /** Relevance score (0.0 to 1.0) */
  score: number;
  /** Code snippet from the file */
  snippet: string;
  /** Terms that matched in this result */
  matchedTerms: string[];
}

/**
 * Results from a single round of retrieval
 */
export interface RetrievalRound {
  /** Round number (1-indexed) */
  round: number;
  /** Query used for this round */
  query: string;
  /** Results from this round */
  results: IterativeRetrievalResultItem[];
  /** New terms discovered for next round */
  newTerms: string[];
  /** Estimated topic coverage (0.0 to 1.0) */
  coverage: number;
}

/**
 * Configuration for iterative retrieval
 */
export interface IterativeRetrievalConfig {
  /** Maximum number of retrieval iterations (default: 3) */
  maxRounds: number;
  /** Stop if coverage gain < this (default: 0.1) */
  minCoverageGain: number;
  /** Expand query with discovered terms (default: true) */
  termExpansion: boolean;
  /** Follow references to other files (default: true) */
  crossFileChasing: boolean;
}

/**
 * Final result from iterative retrieval
 */
export interface IterativeRetrievalResult {
  /** Original query */
  query: string;
  /** All rounds of retrieval */
  rounds: RetrievalRound[];
  /** Combined final results */
  finalResults: IterativeRetrievalResultItem[];
  /** Total coverage achieved */
  totalCoverage: number;
  /** All terms discovered across rounds */
  termsDiscovered: string[];
  /** All files explored across rounds */
  filesExplored: string[];
}

/**
 * Default configuration
 */
export const DEFAULT_ITERATIVE_CONFIG: IterativeRetrievalConfig = {
  maxRounds: 3,
  minCoverageGain: 0.1,
  termExpansion: true,
  crossFileChasing: true,
};

// ============================================================================
// ITERATIVE RETRIEVER CLASS
// ============================================================================

/**
 * Performs iterative retrieval to improve search quality
 */
export class IterativeRetriever {
  /** Maximum terms to add in query expansion */
  private static readonly MAX_EXPANSION_TERMS = 10;

  /** Maximum query word count */
  private static readonly MAX_QUERY_WORDS = 25;

  /** Patterns for extracting identifiers from code */
  private static readonly IDENTIFIER_PATTERNS = [
    // Function declarations
    /(?:function|async function)\s+([A-Za-z_][A-Za-z0-9_]*)/g,
    // Arrow function assignments
    /(?:const|let|var)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:async\s*)?\(/g,
    // Class declarations
    /class\s+([A-Za-z_][A-Za-z0-9_]*)/g,
    // Interface declarations
    /interface\s+([A-Za-z_][A-Za-z0-9_]*)/g,
    // Type declarations
    /type\s+([A-Za-z_][A-Za-z0-9_]*)/g,
    // Import identifiers
    /import\s+\{\s*([^}]+)\s*\}/g,
    // Import default
    /import\s+([A-Za-z_][A-Za-z0-9_]*)\s+from/g,
    // Type annotations (capturing type names)
    /:\s*([A-Z][A-Za-z0-9_]*)/g,
    // Generic type parameters
    /<([A-Z][A-Za-z0-9_]*)(?:[,>])/g,
  ];

  /** Patterns for extracting import sources */
  private static readonly IMPORT_SOURCE_PATTERNS = [
    // import from (single line)
    /import\s+(?:.*?)\s+from\s+['"]([^'"]+)['"]/g,
    // require
    /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    // dynamic import
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    // export from (single line)
    /export\s+(?:.*?)\s+from\s+['"]([^'"]+)['"]/g,
    // Re-export pattern (multi-line): } from './module.js';
    /\}\s*from\s+['"]([^'"]+)['"]/g,
  ];

  /**
   * Run iterative retrieval
   */
  async retrieve(
    query: string,
    repoPath: string,
    config: IterativeRetrievalConfig = DEFAULT_ITERATIVE_CONFIG
  ): Promise<IterativeRetrievalResult> {
    const rounds: RetrievalRound[] = [];
    const allTerms = new Set<string>();
    const allFiles = new Set<string>();
    let currentQuery = query;
    let prevCoverage = 0;

    // Handle edge cases
    if (config.maxRounds <= 0) {
      return {
        query,
        rounds: [],
        finalResults: [],
        totalCoverage: 0,
        termsDiscovered: [],
        filesExplored: [],
      };
    }

    // Check if repo exists
    if (!fs.existsSync(repoPath)) {
      return {
        query,
        rounds: [],
        finalResults: [],
        totalCoverage: 0,
        termsDiscovered: [],
        filesExplored: [],
      };
    }

    // Extract initial terms from query
    const queryTerms = this.extractTermsFromQuery(query);
    for (const term of queryTerms) {
      allTerms.add(term);
    }

    for (let roundNum = 1; roundNum <= config.maxRounds; roundNum++) {
      // Perform retrieval for this round
      const results = await this.performRetrieval(currentQuery, repoPath);

      // Track files
      for (const result of results) {
        allFiles.add(result.file);
      }

      // Extract new terms from results
      const newTerms = this.extractNewTerms(results, [...allTerms]);

      // Add new terms to collection
      for (const term of newTerms) {
        allTerms.add(term);
      }

      // Calculate coverage for this round
      const coverage = this.estimateCoverage(results, currentQuery);

      // Create round record
      const round: RetrievalRound = {
        round: roundNum,
        query: currentQuery,
        results,
        newTerms,
        coverage,
      };
      rounds.push(round);

      // Check if we should stop
      const coverageGain = coverage - prevCoverage;
      if (roundNum > 1 && coverageGain < config.minCoverageGain) {
        break;
      }

      prevCoverage = coverage;

      // Chase cross-file references if enabled
      if (config.crossFileChasing && results.length > 0) {
        for (const result of results.slice(0, 5)) {
          // Limit to top 5 results
          const referencedFiles = await this.chaseReferences(result.file, repoPath);
          for (const ref of referencedFiles) {
            allFiles.add(ref);
          }
        }
      }

      // Expand query for next round if enabled
      if (config.termExpansion && newTerms.length > 0 && roundNum < config.maxRounds) {
        currentQuery = this.expandQuery(query, [...allTerms].slice(0, IterativeRetriever.MAX_EXPANSION_TERMS));
      }
    }

    // Combine and deduplicate final results
    const finalResults = this.combineResults(rounds);

    // Calculate total coverage
    const totalCoverage = rounds.length > 0 ? rounds[rounds.length - 1].coverage : 0;

    // Get discovered terms (excluding original query terms)
    const termsDiscovered = [...allTerms].filter((t) => !queryTerms.includes(t.toLowerCase()));

    return {
      query,
      rounds,
      finalResults,
      totalCoverage,
      termsDiscovered,
      filesExplored: [...allFiles],
    };
  }

  /**
   * Extract new terms from results
   */
  extractNewTerms(results: IterativeRetrievalResultItem[], existingTerms: string[]): string[] {
    const existingSet = new Set(existingTerms.map((t) => t.toLowerCase()));
    const newTerms = new Set<string>();

    for (const result of results) {
      // Extract from snippet
      const identifiers = this.extractIdentifiers(result.snippet);
      for (const id of identifiers) {
        if (!existingSet.has(id.toLowerCase()) && this.isValidTerm(id)) {
          newTerms.add(id);
        }
      }

      // Extract from matched terms
      for (const term of result.matchedTerms) {
        if (!existingSet.has(term.toLowerCase()) && this.isValidTerm(term)) {
          newTerms.add(term);
        }
      }

      // Extract import sources
      const sources = this.extractImportSources(result.snippet);
      for (const source of sources) {
        if (!existingSet.has(source.toLowerCase())) {
          newTerms.add(source);
        }
      }
    }

    return [...newTerms];
  }

  /**
   * Expand query with new terms
   */
  expandQuery(originalQuery: string, newTerms: string[]): string {
    if (newTerms.length === 0) {
      return originalQuery;
    }

    // Start with original query words
    const queryWords = originalQuery.split(/\s+/);

    // Add new terms up to limit
    const remainingSlots = IterativeRetriever.MAX_QUERY_WORDS - queryWords.length;
    const termsToAdd = newTerms.slice(0, Math.min(remainingSlots, IterativeRetriever.MAX_EXPANSION_TERMS));

    if (termsToAdd.length === 0) {
      return originalQuery;
    }

    return [...queryWords, ...termsToAdd].join(' ');
  }

  /**
   * Follow cross-file references
   */
  async chaseReferences(file: string, repoPath: string): Promise<string[]> {
    const references: string[] = [];

    try {
      if (!fs.existsSync(file)) {
        return [];
      }

      const content = fs.readFileSync(file, 'utf-8');
      const sources = this.extractFullImportPaths(content);

      for (const source of sources) {
        // Resolve relative paths
        const resolvedPath = this.resolveImportPath(source, file, repoPath);
        if (resolvedPath && !references.includes(resolvedPath)) {
          references.push(resolvedPath);
        }
      }
    } catch {
      // Ignore errors (file might not exist, etc.)
    }

    return references;
  }

  /**
   * Extract full import paths (for chaseReferences)
   */
  private extractFullImportPaths(content: string): string[] {
    const paths = new Set<string>();

    for (const pattern of IterativeRetriever.IMPORT_SOURCE_PATTERNS) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;

      while ((match = pattern.exec(content)) !== null) {
        const source = match[1];
        // Only include relative imports (starting with . or ..)
        if (source.startsWith('.')) {
          paths.add(source);
        }
      }
    }

    return [...paths];
  }

  /**
   * Calculate coverage improvement between rounds
   */
  calculateCoverageGain(prevRound: RetrievalRound, currentRound: RetrievalRound): number {
    return currentRound.coverage - prevRound.coverage;
  }

  // ============================================================================
  // PRIVATE HELPER METHODS
  // ============================================================================

  /**
   * Perform actual file retrieval (keyword-based search)
   */
  private async performRetrieval(
    query: string,
    repoPath: string
  ): Promise<IterativeRetrievalResultItem[]> {
    const results: IterativeRetrievalResultItem[] = [];
    const queryTerms = this.extractTermsFromQuery(query);

    if (queryTerms.length === 0) {
      return results;
    }

    try {
      const files = await this.findMatchingFiles(queryTerms, repoPath);

      for (const file of files.slice(0, 20)) {
        // Limit to top 20 files
        try {
          const content = fs.readFileSync(file, 'utf-8');
          const snippet = this.extractRelevantSnippet(content, queryTerms);
          const matchedTerms = this.findMatchedTerms(content, queryTerms);
          const score = this.calculateRelevanceScore(content, queryTerms);

          if (score > 0.1) {
            results.push({
              file: this.normalizeFilePath(file, repoPath),
              score,
              snippet,
              matchedTerms,
            });
          }
        } catch {
          // Skip files that can't be read
        }
      }

      // Sort by score descending
      results.sort((a, b) => b.score - a.score);
    } catch {
      // Return empty results on error
    }

    return results;
  }

  /**
   * Find files matching query terms
   */
  private async findMatchingFiles(terms: string[], repoPath: string): Promise<string[]> {
    const matchingFiles: Map<string, number> = new Map();

    const walkDir = (dir: string): void => {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);

          // Skip node_modules, .git, etc.
          if (entry.isDirectory()) {
            if (!entry.name.startsWith('.') && entry.name !== 'node_modules' && entry.name !== 'dist') {
              walkDir(fullPath);
            }
          } else if (entry.isFile() && this.isCodeFile(entry.name)) {
            // Check filename for term matches
            const nameLower = entry.name.toLowerCase();
            let fileScore = 0;

            for (const term of terms) {
              if (nameLower.includes(term.toLowerCase())) {
                fileScore += 2; // Higher weight for filename match
              }
            }

            // Check file content for term matches
            try {
              const content = fs.readFileSync(fullPath, 'utf-8');
              const contentLower = content.toLowerCase();

              for (const term of terms) {
                const termLower = term.toLowerCase();
                const matches = (contentLower.match(new RegExp(this.escapeRegex(termLower), 'g')) || []).length;
                fileScore += Math.min(matches, 10); // Cap at 10 to avoid over-weighting
              }

              if (fileScore > 0) {
                matchingFiles.set(fullPath, fileScore);
              }
            } catch {
              // Skip files that can't be read
            }
          }
        }
      } catch {
        // Skip directories that can't be accessed
      }
    };

    walkDir(repoPath);

    // Sort by score and return
    return [...matchingFiles.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([file]) => file);
  }

  /**
   * Extract terms from query string
   */
  private extractTermsFromQuery(query: string): string[] {
    // Remove special characters and split
    const cleaned = query
      .replace(/[:"'()[\]{}]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const words = cleaned.split(' ').filter((w) => w.length > 1);

    // Filter out common stop words
    const stopWords = new Set([
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
      'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
      'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
      'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'find', 'how',
      'what', 'where', 'when', 'why', 'which', 'who', 'search',
    ]);

    return words.filter((w) => !stopWords.has(w.toLowerCase()));
  }

  /**
   * Extract identifiers from code snippet
   */
  private extractIdentifiers(snippet: string): string[] {
    const identifiers = new Set<string>();

    for (const pattern of IterativeRetriever.IDENTIFIER_PATTERNS) {
      pattern.lastIndex = 0; // Reset regex state
      let match: RegExpExecArray | null;

      while ((match = pattern.exec(snippet)) !== null) {
        // Handle import lists which may have multiple identifiers
        const captured = match[1].trim();
        if (captured.includes(',')) {
          // Parse import list like "{ A, B, C }"
          const items = captured.split(',').map((s) => s.trim());
          for (const item of items) {
            const cleanItem = item.replace(/\s+as\s+.*/, '').trim();
            if (this.isValidIdentifier(cleanItem)) {
              identifiers.add(cleanItem);
            }
          }
        } else if (this.isValidIdentifier(captured)) {
          identifiers.add(captured);
        }
      }
    }

    return [...identifiers];
  }

  /**
   * Extract import source paths
   */
  private extractImportSources(snippet: string): string[] {
    const sources = new Set<string>();

    for (const pattern of IterativeRetriever.IMPORT_SOURCE_PATTERNS) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;

      while ((match = pattern.exec(snippet)) !== null) {
        const source = match[1];

        // Extract meaningful parts from the path
        if (source.startsWith('.')) {
          // Relative import - extract last segment
          const segments = source.replace(/\.[jt]sx?$/, '').split('/');
          const lastSegment = segments[segments.length - 1];
          if (lastSegment && this.isValidTerm(lastSegment)) {
            sources.add(lastSegment);
          }
          // Also add the directory name if present
          if (segments.length > 1) {
            const dirName = segments[segments.length - 2];
            if (dirName && dirName !== '.' && dirName !== '..' && this.isValidTerm(dirName)) {
              sources.add(dirName);
            }
          }
        } else if (!source.startsWith('@') && !source.includes('/')) {
          // Package import
          sources.add(source);
        }
      }
    }

    return [...sources];
  }

  /**
   * Extract relevant snippet around matching terms
   */
  private extractRelevantSnippet(content: string, terms: string[]): string {
    const lines = content.split('\n');
    let bestStartLine = 0;
    let bestScore = 0;

    // Find the line with most term matches
    for (let i = 0; i < lines.length; i++) {
      const lineLower = lines[i].toLowerCase();
      let lineScore = 0;

      for (const term of terms) {
        if (lineLower.includes(term.toLowerCase())) {
          lineScore++;
        }
      }

      if (lineScore > bestScore) {
        bestScore = lineScore;
        bestStartLine = i;
      }
    }

    // Extract context around best line
    const startLine = Math.max(0, bestStartLine - 2);
    const endLine = Math.min(lines.length, bestStartLine + 5);
    const snippet = lines.slice(startLine, endLine).join('\n');

    // Truncate if too long
    return snippet.length > 500 ? snippet.slice(0, 500) + '...' : snippet;
  }

  /**
   * Find which terms matched in content
   */
  private findMatchedTerms(content: string, terms: string[]): string[] {
    const contentLower = content.toLowerCase();
    const matched: string[] = [];

    for (const term of terms) {
      if (contentLower.includes(term.toLowerCase())) {
        matched.push(term);
      }
    }

    return matched;
  }

  /**
   * Calculate relevance score for a file
   */
  private calculateRelevanceScore(content: string, terms: string[]): number {
    const contentLower = content.toLowerCase();
    let totalMatches = 0;
    let termsMatched = 0;

    for (const term of terms) {
      const termLower = term.toLowerCase();
      const regex = new RegExp(this.escapeRegex(termLower), 'g');
      const matches = (contentLower.match(regex) || []).length;

      if (matches > 0) {
        termsMatched++;
        totalMatches += matches;
      }
    }

    if (terms.length === 0) return 0;

    // Score based on term coverage and match density
    const termCoverage = termsMatched / terms.length;
    const density = Math.min(totalMatches / 100, 1); // Normalize density

    return termCoverage * 0.7 + density * 0.3;
  }

  /**
   * Estimate coverage based on results
   */
  private estimateCoverage(results: IterativeRetrievalResultItem[], query: string): number {
    if (results.length === 0) return 0;

    const queryTerms = this.extractTermsFromQuery(query);
    if (queryTerms.length === 0) return 0;

    // Collect all matched terms
    const allMatchedTerms = new Set<string>();
    for (const result of results) {
      for (const term of result.matchedTerms) {
        allMatchedTerms.add(term.toLowerCase());
      }
    }

    // Coverage is ratio of matched query terms plus bonus for discovered identifiers
    const matchedQueryTerms = queryTerms.filter((t) =>
      allMatchedTerms.has(t.toLowerCase())
    ).length;

    const baseCoverage = matchedQueryTerms / queryTerms.length;

    // Add bonus for number of results (more results = more coverage)
    const resultBonus = Math.min(results.length / 10, 0.3);

    // Add bonus for high-scoring results
    const avgScore = results.reduce((sum, r) => sum + r.score, 0) / results.length;
    const scoreBonus = avgScore * 0.2;

    return Math.min(1, baseCoverage * 0.5 + resultBonus + scoreBonus);
  }

  /**
   * Combine results from all rounds, deduplicating by file
   */
  private combineResults(rounds: RetrievalRound[]): IterativeRetrievalResultItem[] {
    const fileMap = new Map<string, IterativeRetrievalResultItem>();

    for (const round of rounds) {
      for (const result of round.results) {
        const existing = fileMap.get(result.file);
        if (!existing || existing.score < result.score) {
          // Keep the higher-scoring result
          fileMap.set(result.file, {
            ...result,
            matchedTerms: existing
              ? [...new Set([...existing.matchedTerms, ...result.matchedTerms])]
              : result.matchedTerms,
          });
        } else if (existing) {
          // Merge matched terms
          existing.matchedTerms = [...new Set([...existing.matchedTerms, ...result.matchedTerms])];
        }
      }
    }

    // Sort by score
    return [...fileMap.values()].sort((a, b) => b.score - a.score);
  }

  /**
   * Resolve an import path to an actual file path
   */
  private resolveImportPath(source: string, fromFile: string, repoPath: string): string | null {
    if (!source.startsWith('.')) {
      return null; // Skip non-relative imports
    }

    const fromDir = path.dirname(fromFile);

    // Strip .js/.jsx extension if present (TypeScript projects use .js in imports but files are .ts)
    const sourceWithoutExt = source.replace(/\.[jt]sx?$/, '');
    let resolved = path.resolve(fromDir, sourceWithoutExt);

    // Add extension if needed
    const extensions = ['.ts', '.tsx', '.js', '.jsx', ''];
    for (const ext of extensions) {
      const withExt = resolved + ext;
      if (fs.existsSync(withExt)) {
        // Return relative to repo
        return this.normalizeFilePath(withExt, repoPath);
      }

      // Try index file
      const indexPath = path.join(resolved, `index${ext}`);
      if (fs.existsSync(indexPath)) {
        return this.normalizeFilePath(indexPath, repoPath);
      }
    }

    return null;
  }

  /**
   * Normalize file path relative to repo
   */
  private normalizeFilePath(file: string, repoPath: string): string {
    if (file.startsWith(repoPath)) {
      return file.slice(repoPath.length).replace(/^[/\\]/, '');
    }
    return file;
  }

  /**
   * Check if a filename is a code file
   */
  private isCodeFile(filename: string): boolean {
    const codeExtensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
    return codeExtensions.some((ext) => filename.endsWith(ext));
  }

  /**
   * Check if a string is a valid identifier
   */
  private isValidIdentifier(str: string): boolean {
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(str);
  }

  /**
   * Check if a term is worth extracting
   */
  private isValidTerm(term: string): boolean {
    if (term.length < 2) return false;
    if (term.length > 50) return false;

    // Skip common keywords
    const keywords = new Set([
      'const', 'let', 'var', 'function', 'class', 'interface', 'type',
      'import', 'export', 'from', 'return', 'if', 'else', 'for', 'while',
      'async', 'await', 'new', 'this', 'true', 'false', 'null', 'undefined',
      'string', 'number', 'boolean', 'any', 'void', 'never', 'unknown',
      'public', 'private', 'protected', 'static', 'readonly', 'abstract',
      'extends', 'implements', 'super', 'default', 'throw', 'try', 'catch',
      'finally', 'typeof', 'instanceof', 'in', 'of', 'as', 'is', 'keyof',
    ]);

    return !keywords.has(term.toLowerCase());
  }

  /**
   * Escape regex special characters
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a new IterativeRetriever instance
 */
export function createIterativeRetriever(): IterativeRetriever {
  return new IterativeRetriever();
}
