/**
 * Review Context Provider - Bridges agentic review with librainian knowledge
 *
 * Provides enriched context for code review perspectives by:
 * 1. On-demand AST parsing of changed files (no regex)
 * 2. Cached embedding lookups for semantic understanding
 * 3. Call/import graph analysis for impact assessment
 * 4. Test mapping for coverage awareness
 *
 * Philosophy: Use librainian's capabilities to make review smarter,
 * not just faster. The goal is richer findings with fewer false positives.
 */

import type { LiBrainianStorage } from '../storage/types.js';
import type { FileKnowledge, GraphEdge } from '../types.js';
import { logWarning } from '../telemetry/logger.js';
import { getErrorMessage } from '../utils/errors.js';

export interface ReviewFile {
  path: string;
  diffHunks?: string[];
  isNew?: boolean;
  isDeleted?: boolean;
}

export interface ReviewContextRequest {
  /** Files included in the review (from git diff) */
  affectedFiles: ReviewFile[];
  /** Workspace root for context resolution */
  workspaceRoot: string;
  /** Optional: specific symbols/functions changed */
  changedSymbols?: string[];
  /** Review intent (security, correctness, maintainability) */
  reviewIntent?: 'security' | 'correctness' | 'maintainability' | 'general';
  /** Max time to spend on pre-indexing (ms) */
  timeoutMs?: number;
  /** Skip if librainian unavailable (graceful degradation) */
  optional?: boolean;
}

export interface FileContext {
  path: string;
  /** Symbols exported from this file */
  exports?: string[];
  /** Symbols imported by this file */
  imports?: Array<{ from: string; symbols: string[] }>;
  /** Functions/methods in this file */
  functions?: string[];
  /** Files that import from this file (call sites) */
  importedBy?: string[];
  /** Files that this file imports from */
  importedFrom?: string[];
  /** Test files covering this file */
  testFiles?: string[];
  /** Code ownership (team/person) */
  ownership?: string[];
  /** Recent changes (last N commits) */
  recentChanges?: Array<{ sha: string; message: string; author: string }>;
  /** Confidence in this context (0-1) */
  confidence: number;
}

export interface ReviewContext {
  /** Per-file context enrichment */
  files: Map<string, FileContext>;
  /** Domain classification (auth, api, database, etc.) */
  domains: string[];
  /** Patterns detected via AST (async/await, error handling, etc.) */
  patterns: string[];
  /** Related files not in diff but relevant */
  relatedFiles: string[];
  /** Test coverage summary */
  testCoverage: {
    hasTests: boolean;
    coveredFiles: number;
    uncoveredFiles: number;
    coverageRatio: number;
  };
  /** Anti-patterns detected */
  antiPatterns?: string[];
  /** Similar historical issues (from librainian memory) */
  similarIssues?: Array<{
    description: string;
    resolution: string;
    confidence: number;
  }>;
  /** Total time spent on context assembly (ms) */
  assemblyTimeMs: number;
  /** Whether context came from cache */
  fromCache: boolean;
  /** Source of context (librainian, fallback, etc.) */
  source: 'librainian' | 'fallback' | 'partial';
}

export interface ReviewContextProvider {
  /** Assemble enriched context for review */
  getContext(request: ReviewContextRequest): Promise<ReviewContext>;
  /** Check if librainian is available for context */
  isAvailable(): Promise<boolean>;
  /** Pre-warm cache for files (async background) */
  preWarmCache?(files: string[]): void;
}

/**
 * Create a review context provider backed by librainian
 */
export function createReviewContextProvider(
  storage: LiBrainianStorage | null,
  options: { enableCache?: boolean; maxFileCount?: number } = {}
): ReviewContextProvider {
  const { enableCache = true, maxFileCount = 50 } = options;

  return {
    async getContext(request: ReviewContextRequest): Promise<ReviewContext> {
      const startTime = Date.now();

      // If librainian storage unavailable, return fallback context
      if (!storage) {
        return buildFallbackContext(request, startTime);
      }

      try {
        return await assembleLiBrainianContext(storage, request, enableCache, maxFileCount, startTime);
      } catch (error) {
        if (request.optional) {
          // Graceful degradation - return fallback
          console.warn('[review-context] LiBrainian context failed, using fallback:', error);
          return buildFallbackContext(request, startTime);
        }
        throw error;
      }
    },

    async isAvailable(): Promise<boolean> {
      if (!storage) return false;
      try {
        // Quick health check - check if storage is initialized
        return storage.isInitialized();
      } catch {
        return false;
      }
    },

    preWarmCache(files: string[]): void {
      if (!storage || !enableCache) return;
      // Background pre-warming - fire and forget
      void preWarmFilesAsync(storage, files).catch(() => {
        // Silently ignore pre-warm failures
      });
    },
  };
}

/**
 * Assemble context from librainian storage
 */
async function assembleLiBrainianContext(
  storage: LiBrainianStorage,
  request: ReviewContextRequest,
  enableCache: boolean,
  maxFileCount: number,
  startTime: number
): Promise<ReviewContext> {
  const files = new Map<string, FileContext>();
  const domains = new Set<string>();
  const patterns = new Set<string>();
  const relatedFiles = new Set<string>();
  let hasTests = false;
  let coveredCount = 0;
  let uncoveredCount = 0;

  // Limit files to prevent timeout
  const filesToProcess = request.affectedFiles.slice(0, maxFileCount);

  // Pre-load graph edges for affected files (batch query for efficiency)
  let graphEdges: GraphEdge[] = [];
  try {
    graphEdges = await storage.getGraphEdges({
      edgeTypes: ['imports', 'calls'],
      limit: 1000,
    });
  } catch {
    // Gracefully continue without graph edges
  }

  // Process each file
  for (const file of filesToProcess) {
    const fileContext = await assembleFileContext(storage, file, request.workspaceRoot, graphEdges);
    files.set(file.path, fileContext);

    // Aggregate domains from file paths
    const domain = inferDomainFromPath(file.path);
    if (domain) domains.add(domain);

    // Track test coverage
    if (fileContext.testFiles && fileContext.testFiles.length > 0) {
      coveredCount++;
      hasTests = true;
    } else if (!file.path.includes('.test.') && !file.path.includes('.spec.')) {
      uncoveredCount++;
    }

    // Collect related files
    for (const related of fileContext.importedBy || []) {
      if (!request.affectedFiles.some(f => f.path === related)) {
        relatedFiles.add(related);
      }
    }
    for (const related of fileContext.importedFrom || []) {
      if (!request.affectedFiles.some(f => f.path === related)) {
        relatedFiles.add(related);
      }
    }
  }

  // Detect patterns from file contents (use librainian AST data)
  const detectedPatterns = await detectPatternsFromStorage(storage, filesToProcess.map(f => f.path));
  for (const pattern of detectedPatterns) {
    patterns.add(pattern);
  }

  const totalFiles = coveredCount + uncoveredCount;
  const coverageRatio = totalFiles > 0 ? coveredCount / totalFiles : 0;

  return {
    files,
    domains: Array.from(domains),
    patterns: Array.from(patterns),
    relatedFiles: Array.from(relatedFiles).slice(0, 20), // Limit related files
    testCoverage: {
      hasTests,
      coveredFiles: coveredCount,
      uncoveredFiles: uncoveredCount,
      coverageRatio,
    },
    assemblyTimeMs: Date.now() - startTime,
    fromCache: enableCache, // TODO: track actual cache hits
    source: 'librainian',
  };
}

/**
 * Assemble context for a single file
 */
async function assembleFileContext(
  storage: LiBrainianStorage,
  file: ReviewFile,
  workspaceRoot: string,
  graphEdges: GraphEdge[]
): Promise<FileContext> {
  const context: FileContext = {
    path: file.path,
    confidence: 0.5, // Default confidence
  };

  try {
    // Try to get file knowledge from storage
    const fileKnowledge = await storage.getFileByPath(file.path);
    if (fileKnowledge) {
      // Extract exports from file knowledge
      context.exports = fileKnowledge.keyExports;
      context.confidence = 0.8;
    }

    // Get functions for this file
    const functions = await storage.getFunctionsByPath(file.path);
    if (functions.length > 0) {
      context.functions = functions.map(f => f.name);
    }

    // Find edges involving this file from pre-loaded graph edges
    // GraphEdge uses fromId/toId and sourceFile
    const importedBy = graphEdges
      .filter(e => e.toId === file.path || e.sourceFile === file.path)
      .map(e => e.fromId);
    const importedFrom = graphEdges
      .filter(e => e.fromId === file.path)
      .map(e => e.toId);

    if (importedBy.length > 0) {
      context.importedBy = [...new Set(importedBy)];
    }
    if (importedFrom.length > 0) {
      context.importedFrom = [...new Set(importedFrom)];
    }

    // Check for test files (heuristic based on file patterns)
    const testFiles = graphEdges
      .filter(e => e.sourceFile.includes('.test.') || e.sourceFile.includes('.spec.'))
      .filter(e => e.toId === file.path || e.toId.includes(file.path))
      .map(e => e.sourceFile);
    if (testFiles.length > 0) {
      context.testFiles = [...new Set(testFiles)];
    }

  } catch (error) {
    // Partial failure - return what we have with lower confidence
    context.confidence = 0.3;
  }

  return context;
}

/**
 * Detect code patterns from librainian storage
 */
async function detectPatternsFromStorage(
  storage: LiBrainianStorage,
  files: string[]
): Promise<string[]> {
  const patterns = new Set<string>();

  for (const file of files) {
    try {
      const fileKnowledge = await storage.getFileByPath(file);
      if (fileKnowledge) {
        // Extract patterns from file category and concepts
        if (fileKnowledge.category === 'test') {
          patterns.add('testing');
        }
        if (fileKnowledge.category === 'config') {
          patterns.add('configuration');
        }
        // Extract patterns from main concepts
        for (const concept of fileKnowledge.mainConcepts || []) {
          patterns.add(concept.toLowerCase());
        }
      }

      // Also check function-level patterns by looking at purpose
      const functions = await storage.getFunctionsByPath(file);
      for (const fn of functions) {
        // Infer patterns from function purpose text
        const purpose = fn.purpose?.toLowerCase() || '';
        if (purpose.includes('async') || purpose.includes('promise')) {
          patterns.add('async/await');
        }
        if (purpose.includes('error') || purpose.includes('catch') || purpose.includes('throw')) {
          patterns.add('error_handling');
        }
        if (purpose.includes('validate') || purpose.includes('check')) {
          patterns.add('validation');
        }
      }
    } catch {
      // Ignore pattern detection failures
    }
  }

  return Array.from(patterns);
}

/**
 * Infer domain from file path
 */
function inferDomainFromPath(filePath: string): string | null {
  const lower = filePath.toLowerCase();

  if (lower.includes('/auth') || lower.includes('authentication') || lower.includes('login')) {
    return 'auth';
  }
  if (lower.includes('/api') || lower.includes('/routes') || lower.includes('/endpoints')) {
    return 'api';
  }
  if (lower.includes('/db') || lower.includes('/database') || lower.includes('/storage') || lower.includes('sqlite')) {
    return 'database';
  }
  if (lower.includes('/security') || lower.includes('/crypto')) {
    return 'security';
  }
  if (lower.includes('/test') || lower.includes('.test.') || lower.includes('.spec.')) {
    return 'testing';
  }
  if (lower.includes('/config') || lower.includes('.config.')) {
    return 'configuration';
  }
  if (lower.includes('/ui') || lower.includes('/components') || lower.includes('/views')) {
    return 'ui';
  }

  return null;
}

/**
 * Build fallback context when librainian is unavailable
 */
function buildFallbackContext(request: ReviewContextRequest, startTime: number): ReviewContext {
  const files = new Map<string, FileContext>();
  const domains = new Set<string>();

  for (const file of request.affectedFiles) {
    files.set(file.path, {
      path: file.path,
      confidence: 0.2, // Low confidence without librainian
    });

    const domain = inferDomainFromPath(file.path);
    if (domain) domains.add(domain);
  }

  return {
    files,
    domains: Array.from(domains),
    patterns: [], // Can't detect patterns without AST
    relatedFiles: [],
    testCoverage: {
      hasTests: false,
      coveredFiles: 0,
      uncoveredFiles: request.affectedFiles.length,
      coverageRatio: 0,
    },
    assemblyTimeMs: Date.now() - startTime,
    fromCache: false,
    source: 'fallback',
  };
}

/**
 * Background pre-warming of file cache
 */
async function preWarmFilesAsync(storage: LiBrainianStorage, files: string[]): Promise<void> {
  // Limit concurrent pre-warms
  const batchSize = 10;
  for (let i = 0; i < files.length; i += batchSize) {
    const batch = files.slice(i, i + batchSize);
    await Promise.all(batch.map(file => storage.getFileByPath(file).catch((err) => {
      logWarning('[review_context] Failed to pre-warm file cache', { file, error: getErrorMessage(err) });
      return null;
    })));
  }
}

/**
 * Format context for inclusion in review prompt
 */
export function formatContextForPrompt(context: ReviewContext): string {
  const lines: string[] = [];

  lines.push('## Code Context (from LiBrainian analysis)');
  lines.push('');

  // Domains
  if (context.domains.length > 0) {
    lines.push(`**Domains:** ${context.domains.join(', ')}`);
  }

  // Patterns
  if (context.patterns.length > 0) {
    lines.push(`**Code Patterns:** ${context.patterns.join(', ')}`);
  }

  // Test coverage
  const coverage = context.testCoverage;
  const coverageStatus = coverage.hasTests
    ? `${Math.round(coverage.coverageRatio * 100)}% of files have tests`
    : 'No test coverage detected';
  lines.push(`**Test Coverage:** ${coverageStatus}`);

  // Related files
  if (context.relatedFiles.length > 0) {
    lines.push('');
    lines.push(`**Related Files (not in diff but affected):**`);
    for (const file of context.relatedFiles.slice(0, 5)) {
      lines.push(`  - ${file}`);
    }
    if (context.relatedFiles.length > 5) {
      lines.push(`  - ... and ${context.relatedFiles.length - 5} more`);
    }
  }

  // Per-file context for high-confidence files
  const highConfidenceFiles = Array.from(context.files.values())
    .filter(f => f.confidence >= 0.7)
    .slice(0, 10);

  if (highConfidenceFiles.length > 0) {
    lines.push('');
    lines.push('**File Details:**');
    for (const file of highConfidenceFiles) {
      const parts: string[] = [file.path];
      if (file.testFiles && file.testFiles.length > 0) {
        parts.push(`tested by ${file.testFiles.length} files`);
      }
      if (file.importedBy && file.importedBy.length > 0) {
        parts.push(`imported by ${file.importedBy.length} files`);
      }
      lines.push(`  - ${parts.join(' | ')}`);
    }
  }

  // Source and timing
  lines.push('');
  lines.push(`*Context source: ${context.source}, assembled in ${context.assemblyTimeMs}ms*`);

  return lines.join('\n');
}
