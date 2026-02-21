/**
 * @fileoverview Performance Analysis System for Agents
 *
 * A system that identifies performance issues and optimization opportunities
 * in code files. Provides detailed analysis including:
 * - N+1 query patterns
 * - Blocking I/O operations
 * - Memory leak risks
 * - Inefficient loops
 * - Expensive operations
 *
 * Designed for agent-driven queries like "analyze performance of X" or
 * "find performance issues".
 *
 * @example
 * ```typescript
 * const analysis = await analyzePerformance(storage, 'src/api/query.ts');
 * console.log(analysis.overallRisk); // 'low' | 'medium' | 'high'
 * for (const issue of analysis.issues) {
 *   console.log(`${issue.severity}: ${issue.description}`);
 * }
 * ```
 */

import type { LiBrainianStorage, FunctionKnowledge } from '../storage/types.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Complete performance analysis result for a file.
 */
export interface PerformanceAnalysis {
  /** The file that was analyzed */
  file: string;
  /** Overall risk assessment */
  overallRisk: 'low' | 'medium' | 'high';
  /** Detected performance issues */
  issues: PerformanceIssue[];
  /** Performance hotspots (high complexity functions) */
  hotspots: PerformanceHotspot[];
  /** Suggested optimizations */
  optimizations: OptimizationSuggestion[];
  /** Analysis metadata */
  metadata: PerformanceAnalysisMetadata;
}

/**
 * A specific performance issue detected in code.
 */
export interface PerformanceIssue {
  /** Type of the issue */
  type: PerformanceIssueType;
  /** Severity level */
  severity: 'critical' | 'warning' | 'info';
  /** Line number where issue was detected */
  line: number;
  /** Code snippet showing the issue */
  code: string;
  /** Human-readable description */
  description: string;
  /** Expected impact if not addressed */
  impact: string;
  /** Suggested fix */
  fix: string;
}

/**
 * Types of performance issues that can be detected.
 */
export type PerformanceIssueType =
  | 'n_plus_one'
  | 'blocking_io'
  | 'memory_leak_risk'
  | 'inefficient_loop'
  | 'redundant_computation'
  | 'large_bundle_import'
  | 'sync_in_async'
  | 'unbounded_growth'
  | 'missing_index_hint'
  | 'expensive_regex';

/**
 * A performance hotspot - a function with high complexity.
 */
export interface PerformanceHotspot {
  /** Function name */
  function: string;
  /** File path */
  file: string;
  /** Start line of the function */
  line: number;
  /** Cyclomatic complexity score */
  complexity: number;
  /** Estimated performance cost */
  estimatedCost: 'low' | 'medium' | 'high';
  /** Reason for being a hotspot */
  reason: string;
}

/**
 * A suggested optimization with before/after examples.
 */
export interface OptimizationSuggestion {
  /** Type of optimization */
  type: string;
  /** Description of the optimization */
  description: string;
  /** Expected impact */
  impact: 'low' | 'medium' | 'high';
  /** Effort required to implement */
  effort: 'low' | 'medium' | 'high';
  /** Optional code examples */
  code?: {
    before: string;
    after: string;
  };
}

/**
 * Metadata about the analysis run.
 */
export interface PerformanceAnalysisMetadata {
  /** When the analysis was performed */
  analyzedAt: string;
  /** Duration of analysis in milliseconds */
  analysisTimeMs: number;
  /** Number of lines analyzed */
  linesAnalyzed: number;
  /** Number of functions analyzed */
  functionsAnalyzed: number;
}

// ============================================================================
// QUERY PATTERNS
// ============================================================================

/**
 * Patterns that indicate a performance analysis query.
 */
export const PERFORMANCE_QUERY_PATTERNS: RegExp[] = [
  /\banalyze\s+performance\b/i,
  /\bperformance\s+(?:issues?|problems?|analysis)\b/i,
  /\bfind\s+performance\s+(?:issues?|problems?|bottlenecks?)\b/i,
  /\bperformance\s+bottlenecks?\b/i,
  /\boptimization\s+opportunities\b/i,
  /\bslow\s+(?:code|functions?)\b/i,
  /\bn\+1\s+(?:query|pattern|problem)\b/i,
  /\bmemory\s+leak/i,
  /\bblocking\s+(?:io|i\/o|operations?)\b/i,
  /\bperformance\s+hotspots?\b/i,
  /\bcpu\s+(?:intensive|heavy|bound)\b/i,
  /\btime\s+complexity\b/i,
  /\binefficient\b/i,
];

/**
 * Check if a query intent is about performance analysis.
 */
export function isPerformanceQuery(intent: string): boolean {
  return PERFORMANCE_QUERY_PATTERNS.some(pattern => pattern.test(intent));
}

/**
 * Extract the target file or scope from a performance query.
 */
export function extractPerformanceTarget(intent: string): string | undefined {
  const patterns = [
    // "analyze performance of query.ts"
    /analyze\s+performance\s+(?:of|in|for)\s+(['"`]?)([^'"`\s]+)\1/i,
    // "performance issues in src/api/query.ts"
    /performance\s+(?:issues?|problems?)\s+(?:in|of|for)\s+(['"`]?)([^'"`\s]+)\1/i,
    // "find bottlenecks in storage.ts"
    /(?:find|check)\s+(?:performance|bottlenecks?)\s+(?:in|of|for)\s+(['"`]?)([^'"`\s]+)\1/i,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(intent);
    if (match?.[2]) {
      return match[2];
    }
  }
  return undefined;
}

// ============================================================================
// MAIN ANALYSIS FUNCTION
// ============================================================================

/**
 * Storage interface with optional file content retrieval.
 */
interface PerformanceAnalysisStorage extends LiBrainianStorage {
  getFileContent?(filePath: string): Promise<string | null>;
}

/**
 * Analyze a file for performance issues.
 *
 * @param storage - The storage backend (must have file content access)
 * @param filePath - Path to the file to analyze
 * @returns Complete performance analysis
 */
export async function analyzePerformance(
  storage: PerformanceAnalysisStorage,
  filePath: string
): Promise<PerformanceAnalysis> {
  const startTime = Date.now();

  // Get file content by reading from filesystem
  let content: string;

  try {
    const fs = await import('fs/promises');
    content = await fs.readFile(filePath, 'utf-8');
  } catch (error) {
    throw new Error(`Cannot read file: ${filePath}`);
  }

  const lines = content.split('\n');
  const issues: PerformanceIssue[] = [];
  const hotspots: PerformanceHotspot[] = [];
  const optimizations: OptimizationSuggestion[] = [];

  // Find performance issues
  issues.push(...findNPlusOne(content, filePath));
  issues.push(...findBlockingIO(content, filePath));
  issues.push(...findMemoryLeakRisks(content, filePath));
  issues.push(...findInefficientLoops(content, filePath));
  issues.push(...findExpensiveOperations(content, filePath));
  issues.push(...findSyncInAsync(content, filePath));
  issues.push(...findLargeBundleImports(content, filePath));

  // Find hotspots from indexed functions
  const functionHotspots = await findHotspots(storage, filePath, content);
  hotspots.push(...functionHotspots);

  // Generate optimizations based on issues
  optimizations.push(...generateOptimizations(issues, content));

  const overallRisk = calculateOverallRisk(issues);
  const analysisTimeMs = Date.now() - startTime;

  return {
    file: filePath,
    overallRisk,
    issues,
    hotspots,
    optimizations,
    metadata: {
      analyzedAt: new Date().toISOString(),
      analysisTimeMs,
      linesAnalyzed: lines.length,
      functionsAnalyzed: functionHotspots.length,
    },
  };
}

// ============================================================================
// ISSUE DETECTION FUNCTIONS
// ============================================================================

/**
 * Find N+1 query patterns (sequential awaits in loops).
 */
export function findNPlusOne(content: string, file: string): PerformanceIssue[] {
  const issues: PerformanceIssue[] = [];
  const lines = content.split('\n');
  const detectedLines = new Set<number>();

  for (let i = 0; i < lines.length; i++) {
    // Look at a window of lines to detect patterns
    const context = lines.slice(Math.max(0, i - 2), i + 5).join('\n');

    // Pattern: await inside for/forEach/map
    // Note: async arrow functions can use `async item =>` or `async (item) =>`
    // Using [\s\S] instead of . with 's' flag for cross-line matching
    if (
      (/for\s*\([^)]*\)\s*\{[\s\S]*await\s+/.test(context) ||
        /\.forEach\(\s*async\s*[\w(]/.test(context) ||
        /\.map\(\s*async\s*[\w(]/.test(context)) &&
      !detectedLines.has(i + 1)
    ) {
      detectedLines.add(i + 1);
      issues.push({
        type: 'n_plus_one',
        severity: 'warning',
        line: i + 1,
        code: lines[i].trim(),
        description: 'Sequential await in loop (N+1 pattern)',
        impact: 'Each iteration waits for the previous - O(n) latency instead of O(1)',
        fix: 'Use Promise.all() to parallelize: await Promise.all(items.map(async item => ...))',
      });
    }
  }

  return issues;
}

/**
 * Find blocking I/O operations (synchronous fs, exec, etc.).
 */
export function findBlockingIO(content: string, file: string): PerformanceIssue[] {
  const issues: PerformanceIssue[] = [];
  const lines = content.split('\n');

  const blockingPatterns = [
    { pattern: /\breadFileSync\b/, name: 'readFileSync' },
    { pattern: /\bwriteFileSync\b/, name: 'writeFileSync' },
    { pattern: /\bexecSync\b/, name: 'execSync' },
    { pattern: /\bexistsSync\b/, name: 'existsSync' },
    { pattern: /\breaddirSync\b/, name: 'readdirSync' },
    { pattern: /\bstatSync\b/, name: 'statSync' },
    { pattern: /\bmkdirSync\b/, name: 'mkdirSync' },
    { pattern: /\bunlinkSync\b/, name: 'unlinkSync' },
    { pattern: /\bcopyFileSync\b/, name: 'copyFileSync' },
    { pattern: /\bspawnSync\b/, name: 'spawnSync' },
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const { pattern, name } of blockingPatterns) {
      if (pattern.test(line)) {
        issues.push({
          type: 'blocking_io',
          severity: 'warning',
          line: i + 1,
          code: line.trim(),
          description: `Synchronous I/O operation: ${name}`,
          impact: 'Blocks the event loop, reducing throughput and responsiveness',
          fix: `Use async version: ${name.replace('Sync', '')} with await`,
        });
      }
    }
  }

  return issues;
}

/**
 * Find potential memory leak risks.
 */
export function findMemoryLeakRisks(content: string, file: string): PerformanceIssue[] {
  const issues: PerformanceIssue[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const context = lines.slice(Math.max(0, i - 10), Math.min(lines.length, i + 10)).join('\n');

    // Growing arrays without bounds
    if (/\.push\(/.test(line)) {
      // Check if there's any limiting logic in context
      if (!/.length\s*[<>=]|\.slice\(|\.splice\(|\.shift\(|\.pop\(|\.clear\(/.test(context)) {
        issues.push({
          type: 'unbounded_growth',
          severity: 'info',
          line: i + 1,
          code: line.trim(),
          description: 'Array grows without apparent bound',
          impact: 'Could lead to memory exhaustion over time',
          fix: 'Add size limits, use circular buffer, or periodically trim the array',
        });
      }
    }

    // Event listeners without cleanup (skip test files)
    if (/\.addEventListener\(|\.on\(['"]\w+['"],/.test(line) && !file.includes('test')) {
      const hasRemove =
        content.includes('removeEventListener') ||
        content.includes('.off(') ||
        content.includes('.removeListener(') ||
        content.includes('return () =>'); // cleanup function pattern

      if (!hasRemove) {
        issues.push({
          type: 'memory_leak_risk',
          severity: 'info',
          line: i + 1,
          code: line.trim(),
          description: 'Event listener added without corresponding cleanup',
          impact: 'Could cause memory leak if component is recreated',
          fix: 'Add cleanup logic: removeEventListener, .off(), or use AbortController',
        });
      }
    }

    // setInterval without cleanup
    if (/\bsetInterval\b/.test(line)) {
      const hasClear = content.includes('clearInterval');
      if (!hasClear) {
        issues.push({
          type: 'memory_leak_risk',
          severity: 'warning',
          line: i + 1,
          code: line.trim(),
          description: 'setInterval without matching clearInterval',
          impact: 'Interval continues after component unmount, causing memory leak',
          fix: 'Store interval ID and call clearInterval in cleanup',
        });
      }
    }
  }

  return issues;
}

/**
 * Find inefficient loop patterns.
 */
export function findInefficientLoops(content: string, file: string): PerformanceIssue[] {
  const issues: PerformanceIssue[] = [];
  const lines = content.split('\n');
  const detectedPatterns = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Array.includes() or indexOf() in a loop (O(n^2))
    if (/for\s*\(/.test(line) || /\.forEach\(/.test(line) || /while\s*\(/.test(line)) {
      const loopContext = lines.slice(i, Math.min(i + 20, lines.length)).join('\n');
      const closingBrace = loopContext.indexOf('}');
      const loopBody = loopContext.slice(0, closingBrace > 0 ? closingBrace : undefined);

      if (/\.includes\(|\.indexOf\(/.test(loopBody) && !detectedPatterns.has('includes_in_loop')) {
        detectedPatterns.add('includes_in_loop');
        issues.push({
          type: 'inefficient_loop',
          severity: 'warning',
          line: i + 1,
          code: line.trim(),
          description: 'Array.includes() or indexOf() inside loop (O(n^2))',
          impact: 'Quadratic time complexity for large arrays',
          fix: 'Convert to Set for O(1) lookup: const set = new Set(arr); set.has(item)',
        });
      }

      // Array access with repeated property traversal
      if (/(\w+\.\w+\.\w+)/.test(loopBody)) {
        const match = loopBody.match(/(\w+\.\w+\.\w+)/);
        if (match) {
          const repeatedAccess = new RegExp(match[1].replace(/\./g, '\\.'), 'g');
          const occurrences = (loopBody.match(repeatedAccess) || []).length;
          if (occurrences > 2 && !detectedPatterns.has('repeated_property')) {
            detectedPatterns.add('repeated_property');
            issues.push({
              type: 'redundant_computation',
              severity: 'info',
              line: i + 1,
              code: line.trim(),
              description: 'Repeated property access in loop',
              impact: 'Minor overhead; reduces readability',
              fix: `Cache in variable: const value = ${match[1]}`,
            });
          }
        }
      }
    }

    // Array.filter().map() or similar chains that could be optimized
    if (/\.filter\([^)]+\)\.map\(/.test(line) || /\.map\([^)]+\)\.filter\(/.test(line)) {
      issues.push({
        type: 'redundant_computation',
        severity: 'info',
        line: i + 1,
        code: line.trim().slice(0, 80) + (line.length > 80 ? '...' : ''),
        description: 'Chained array methods create intermediate arrays',
        impact: 'Extra memory allocation and iteration',
        fix: 'Consider using reduce() or a single loop for better performance',
      });
    }
  }

  return issues;
}

/**
 * Find expensive operations in hot paths.
 */
export function findExpensiveOperations(content: string, file: string): PerformanceIssue[] {
  const issues: PerformanceIssue[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const context = lines.slice(Math.max(0, i - 5), i).join('\n');

    // Regex created inside loop
    if (/new\s+RegExp\(/.test(line) || /\/[^/]+\/[gim]*/.test(line)) {
      if (/for\s*\(|\.forEach|\.map|\.filter|while\s*\(/.test(context)) {
        issues.push({
          type: 'expensive_regex',
          severity: 'info',
          line: i + 1,
          code: line.trim(),
          description: 'Regex created inside loop',
          impact: 'Regex compilation on each iteration',
          fix: 'Move regex outside loop: const pattern = /.../; (compile once)',
        });
      }
    }

    // JSON.parse/stringify in loop
    if (/JSON\.(parse|stringify)/.test(line)) {
      if (/for\s*\(|\.forEach|\.map|while\s*\(/.test(context)) {
        issues.push({
          type: 'redundant_computation',
          severity: 'warning',
          line: i + 1,
          code: line.trim(),
          description: 'JSON parsing/stringifying in loop',
          impact: 'Serialization is CPU-intensive',
          fix: 'Move outside loop if operating on the same data structure',
        });
      }
    }

    // Deeply nested try-catch in hot path
    if (/try\s*\{/.test(line)) {
      const tryContext = lines.slice(i, Math.min(i + 50, lines.length)).join('\n');
      const nestedTries = (tryContext.match(/try\s*\{/g) || []).length;
      if (nestedTries > 2) {
        issues.push({
          type: 'redundant_computation',
          severity: 'info',
          line: i + 1,
          code: line.trim(),
          description: 'Deeply nested try-catch blocks',
          impact: 'Exception handling has overhead; nesting compounds it',
          fix: 'Consolidate error handling at higher level',
        });
      }
    }
  }

  return issues;
}

/**
 * Find synchronous operations in async functions.
 */
export function findSyncInAsync(content: string, file: string): PerformanceIssue[] {
  const issues: PerformanceIssue[] = [];
  const lines = content.split('\n');
  let inAsyncFunction = false;
  let asyncStartLine = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Track async function boundaries
    if (/async\s+function|async\s*\(/.test(line)) {
      inAsyncFunction = true;
      asyncStartLine = i;
    }

    if (inAsyncFunction) {
      // Heavy synchronous operations in async function
      if (/JSON\.parse\(/.test(line) && line.includes('JSON.parse(fs.')) {
        issues.push({
          type: 'sync_in_async',
          severity: 'warning',
          line: i + 1,
          code: line.trim(),
          description: 'Synchronous file read followed by JSON parse in async function',
          impact: 'Blocks event loop despite being in async function',
          fix: 'Use fs.promises.readFile and async JSON streaming',
        });
      }

      // Large array operations
      if (/\.sort\(|\.reverse\(/.test(line)) {
        const context = lines.slice(Math.max(0, i - 3), i + 3).join('\n');
        if (/\d{4,}|\blarge\b|\ball\b/.test(context)) {
          issues.push({
            type: 'sync_in_async',
            severity: 'info',
            line: i + 1,
            code: line.trim(),
            description: 'Potentially large array sort/reverse in async function',
            impact: 'Sorting large arrays blocks the event loop',
            fix: 'Consider chunking or using web workers for large datasets',
          });
        }
      }

      // Track function end
      if (/^\s*\}/.test(line) && i > asyncStartLine + 1) {
        // Simple heuristic - could be improved with AST parsing
        const funcContent = lines.slice(asyncStartLine, i + 1).join('\n');
        const braceCount = (funcContent.match(/\{/g) || []).length - (funcContent.match(/\}/g) || []).length;
        if (braceCount <= 0) {
          inAsyncFunction = false;
        }
      }
    }
  }

  return issues;
}

/**
 * Find large bundle imports that could be tree-shaken.
 */
export function findLargeBundleImports(content: string, file: string): PerformanceIssue[] {
  const issues: PerformanceIssue[] = [];
  const lines = content.split('\n');

  const largeBundles = [
    { pattern: /import\s+\*\s+as\s+\w+\s+from\s+['"]lodash['"]/, name: 'lodash', fix: "import { specificFn } from 'lodash'" },
    { pattern: /import\s+\*\s+as\s+\w+\s+from\s+['"]moment['"]/, name: 'moment', fix: "Consider dayjs or date-fns for smaller bundle" },
    { pattern: /import\s+\*\s+as\s+\w+\s+from\s+['"]rxjs['"]/, name: 'rxjs', fix: "import { Observable } from 'rxjs'" },
    { pattern: /import\s+\w+\s+from\s+['"]lodash['"]/, name: 'lodash', fix: "import { specificFn } from 'lodash/specificFn'" },
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    for (const { pattern, name, fix } of largeBundles) {
      if (pattern.test(line)) {
        issues.push({
          type: 'large_bundle_import',
          severity: 'info',
          line: i + 1,
          code: line.trim(),
          description: `Full import of ${name} - large bundle size`,
          impact: 'Increases bundle size; slower initial load',
          fix,
        });
      }
    }

    // Generic namespace import detection
    if (/import\s+\*\s+as/.test(line) && !line.includes('node:') && !line.includes('./')) {
      const match = line.match(/from\s+['"]([^'"]+)['"]/);
      if (match) {
        const moduleName = match[1];
        // Skip already detected large bundles
        if (!largeBundles.some(lb => line.match(lb.pattern))) {
          issues.push({
            type: 'large_bundle_import',
            severity: 'info',
            line: i + 1,
            code: line.trim(),
            description: `Namespace import from ${moduleName}`,
            impact: 'May prevent tree-shaking optimization',
            fix: 'Use named imports: import { specific } from ...',
          });
        }
      }
    }
  }

  return issues;
}

// ============================================================================
// HOTSPOT DETECTION
// ============================================================================

/**
 * Find performance hotspots by analyzing function complexity.
 */
async function findHotspots(
  storage: LiBrainianStorage,
  file: string,
  content: string
): Promise<PerformanceHotspot[]> {
  const hotspots: PerformanceHotspot[] = [];

  // Try to get indexed functions from storage
  try {
    const functions = await storage.getFunctionsByPath(file);

    for (const func of functions) {
      // Estimate complexity from function signature and line count
      const lineCount = (func.endLine ?? func.startLine) - func.startLine;
      const complexity = Math.max(1, Math.floor(lineCount / 5) + (func.signature.split(',').length - 1));

      if (complexity > 10) {
        hotspots.push({
          function: func.name,
          file,
          line: func.startLine ?? 0,
          complexity,
          estimatedCost: complexity > 20 ? 'high' : complexity > 15 ? 'medium' : 'low',
          reason: `High cyclomatic complexity (${complexity}) - many decision paths`,
        });
      }
    }
  } catch {
    // If we can't get functions from storage, fall back to basic analysis
    const functionMatches = content.matchAll(/(?:function\s+(\w+)|const\s+(\w+)\s*=\s*(?:async\s+)?\(|(\w+)\s*:\s*\([^)]*\)\s*=>)/g);
    let lineNum = 1;
    for (const match of functionMatches) {
      const funcName = match[1] || match[2] || match[3] || 'anonymous';
      const startIdx = match.index ?? 0;
      lineNum = content.slice(0, startIdx).split('\n').length;

      // Extract function body (simplified)
      const funcStart = content.indexOf('{', startIdx);
      if (funcStart > 0) {
        let braceCount = 1;
        let funcEnd = funcStart + 1;
        while (braceCount > 0 && funcEnd < content.length) {
          if (content[funcEnd] === '{') braceCount++;
          if (content[funcEnd] === '}') braceCount--;
          funcEnd++;
        }
        const funcBody = content.slice(funcStart, funcEnd);
        const complexity = calculateCyclomaticComplexity(funcBody);

        if (complexity > 10) {
          hotspots.push({
            function: funcName,
            file,
            line: lineNum,
            complexity,
            estimatedCost: complexity > 20 ? 'high' : complexity > 15 ? 'medium' : 'low',
            reason: `High cyclomatic complexity (${complexity}) - many decision paths`,
          });
        }
      }
    }
  }

  return hotspots.sort((a, b) => b.complexity - a.complexity);
}

/**
 * Calculate cyclomatic complexity of a code block.
 */
function calculateCyclomaticComplexity(code: string): number {
  // Count decision points
  const patterns = [
    /\bif\b/g,
    /\belse\s+if\b/g,
    /\bfor\b/g,
    /\bwhile\b/g,
    /\bcase\b/g,
    /\bcatch\b/g,
    /\?\s*[^:]/g,  // Ternary operator
    /&&/g,
    /\|\|/g,
    /\?\?/g,  // Nullish coalescing
  ];

  let complexity = 1; // Base complexity
  for (const pattern of patterns) {
    const matches = code.match(pattern);
    complexity += matches?.length ?? 0;
  }

  return complexity;
}

// ============================================================================
// OPTIMIZATION SUGGESTIONS
// ============================================================================

/**
 * Generate optimization suggestions based on detected issues.
 */
function generateOptimizations(
  issues: PerformanceIssue[],
  content: string
): OptimizationSuggestion[] {
  const suggestions: OptimizationSuggestion[] = [];
  const addedTypes = new Set<string>();

  // Based on found issues
  if (issues.some(i => i.type === 'n_plus_one') && !addedTypes.has('batch_async')) {
    addedTypes.add('batch_async');
    suggestions.push({
      type: 'batch_async',
      description: 'Batch async operations with Promise.all() to parallelize',
      impact: 'high',
      effort: 'low',
      code: {
        before: 'for (const item of items) { await process(item); }',
        after: 'await Promise.all(items.map(item => process(item)));',
      },
    });
  }

  if (issues.some(i => i.type === 'inefficient_loop') && !addedTypes.has('use_set')) {
    addedTypes.add('use_set');
    suggestions.push({
      type: 'use_set',
      description: 'Use Set for O(1) lookups instead of Array.includes()',
      impact: 'high',
      effort: 'low',
      code: {
        before: 'if (arr.includes(item)) { /* O(n) */ }',
        after: 'const set = new Set(arr);\nif (set.has(item)) { /* O(1) */ }',
      },
    });
  }

  if (issues.some(i => i.type === 'blocking_io') && !addedTypes.has('async_io')) {
    addedTypes.add('async_io');
    suggestions.push({
      type: 'async_io',
      description: 'Convert synchronous I/O to async to avoid blocking event loop',
      impact: 'high',
      effort: 'medium',
      code: {
        before: "const data = fs.readFileSync('file.txt', 'utf8');",
        after: "const data = await fs.promises.readFile('file.txt', 'utf8');",
      },
    });
  }

  if (issues.some(i => i.type === 'memory_leak_risk') && !addedTypes.has('cleanup')) {
    addedTypes.add('cleanup');
    suggestions.push({
      type: 'cleanup',
      description: 'Add cleanup handlers for event listeners and intervals',
      impact: 'medium',
      effort: 'low',
      code: {
        before: 'element.addEventListener("click", handler);',
        after: 'element.addEventListener("click", handler);\n// In cleanup:\nelement.removeEventListener("click", handler);',
      },
    });
  }

  // General suggestions based on code patterns
  if (content.includes('import *') && !addedTypes.has('tree_shake')) {
    addedTypes.add('tree_shake');
    suggestions.push({
      type: 'tree_shake',
      description: 'Use named imports instead of namespace imports for better tree-shaking',
      impact: 'medium',
      effort: 'low',
      code: {
        before: "import * as utils from './utils';",
        after: "import { specificFunc } from './utils';",
      },
    });
  }

  if (/JSON\.stringify\([^)]*,\s*null,\s*\d+\)/.test(content) && !addedTypes.has('no_pretty_json')) {
    addedTypes.add('no_pretty_json');
    suggestions.push({
      type: 'no_pretty_json',
      description: 'Avoid pretty-printing JSON in production (saves CPU and bytes)',
      impact: 'low',
      effort: 'low',
      code: {
        before: 'JSON.stringify(data, null, 2)',
        after: 'JSON.stringify(data)',
      },
    });
  }

  // Memoization suggestion for repeated expensive calls
  const expensiveCalls = issues.filter(i => i.type === 'redundant_computation');
  if (expensiveCalls.length > 2 && !addedTypes.has('memoize')) {
    addedTypes.add('memoize');
    suggestions.push({
      type: 'memoize',
      description: 'Consider memoization for expensive repeated computations',
      impact: 'medium',
      effort: 'medium',
      code: {
        before: 'function expensive(n) { /* heavy work */ }',
        after: 'const memoExpensive = memoize((n) => { /* heavy work */ });',
      },
    });
  }

  return suggestions;
}

// ============================================================================
// RISK CALCULATION
// ============================================================================

/**
 * Calculate overall risk based on issues.
 */
function calculateOverallRisk(issues: PerformanceIssue[]): 'low' | 'medium' | 'high' {
  const criticalCount = issues.filter(i => i.severity === 'critical').length;
  const warningCount = issues.filter(i => i.severity === 'warning').length;

  if (criticalCount > 0) return 'high';
  if (warningCount > 3) return 'high';
  if (warningCount > 1) return 'medium';
  return 'low';
}

// ============================================================================
// BATCH ANALYSIS
// ============================================================================

/**
 * Analyze multiple files for performance issues.
 */
export async function analyzePerformanceBatch(
  storage: PerformanceAnalysisStorage,
  filePaths: string[]
): Promise<Map<string, PerformanceAnalysis>> {
  const results = new Map<string, PerformanceAnalysis>();

  for (const filePath of filePaths) {
    try {
      const analysis = await analyzePerformance(storage, filePath);
      results.set(filePath, analysis);
    } catch (error) {
      // Skip files that can't be analyzed
      console.warn(`Could not analyze ${filePath}: ${error}`);
    }
  }

  return results;
}

/**
 * Get a summary of performance issues across multiple files.
 */
export function summarizePerformanceAnalysis(
  analyses: Map<string, PerformanceAnalysis>
): {
  totalFiles: number;
  totalIssues: number;
  issuesByType: Record<string, number>;
  issuesBySeverity: Record<string, number>;
  highRiskFiles: string[];
  topHotspots: PerformanceHotspot[];
  topOptimizations: OptimizationSuggestion[];
} {
  const issuesByType: Record<string, number> = {};
  const issuesBySeverity: Record<string, number> = {};
  const highRiskFiles: string[] = [];
  const allHotspots: PerformanceHotspot[] = [];
  const allOptimizations: OptimizationSuggestion[] = [];

  let totalIssues = 0;

  for (const [file, analysis] of analyses) {
    totalIssues += analysis.issues.length;

    if (analysis.overallRisk === 'high') {
      highRiskFiles.push(file);
    }

    for (const issue of analysis.issues) {
      issuesByType[issue.type] = (issuesByType[issue.type] ?? 0) + 1;
      issuesBySeverity[issue.severity] = (issuesBySeverity[issue.severity] ?? 0) + 1;
    }

    allHotspots.push(...analysis.hotspots);
    allOptimizations.push(...analysis.optimizations);
  }

  // Deduplicate and sort optimizations by impact
  const uniqueOptimizations = Array.from(
    new Map(allOptimizations.map(o => [o.type, o])).values()
  ).sort((a, b) => {
    const impactOrder = { high: 0, medium: 1, low: 2 };
    return impactOrder[a.impact] - impactOrder[b.impact];
  });

  return {
    totalFiles: analyses.size,
    totalIssues,
    issuesByType,
    issuesBySeverity,
    highRiskFiles,
    topHotspots: allHotspots.sort((a, b) => b.complexity - a.complexity).slice(0, 10),
    topOptimizations: uniqueOptimizations.slice(0, 5),
  };
}
