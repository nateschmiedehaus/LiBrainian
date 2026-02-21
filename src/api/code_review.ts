/**
 * @fileoverview Code Review Support System for Agents
 *
 * Provides automated code review feedback to help agents identify issues
 * before committing changes. Supports both single file review and
 * multi-file change set review.
 *
 * Features:
 * - Security vulnerability detection
 * - Performance anti-pattern detection
 * - Maintainability analysis
 * - Error handling verification
 * - Type safety checks
 * - Naming convention analysis
 * - Best practices enforcement
 *
 * @packageDocumentation
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { LiBrainianStorage } from '../storage/types.js';

// ============================================================================
// TYPES
// ============================================================================

export interface CodeReviewResult {
  /** File path that was reviewed */
  file: string;
  /** Overall quality score (0-100, higher is better) */
  overallScore: number;
  /** Issues found during review */
  issues: ReviewIssue[];
  /** Improvement suggestions */
  suggestions: ReviewSuggestion[];
  /** Positive aspects of the code */
  positives: string[];
  /** Human-readable summary */
  summary: string;
  /** Review timing in milliseconds */
  reviewTimeMs: number;
}

export interface ReviewIssue {
  /** Severity level */
  severity: 'critical' | 'major' | 'minor' | 'info';
  /** Category of the issue */
  category: ReviewCategory;
  /** Line number where issue was found (1-indexed) */
  line?: number;
  /** Description of the issue */
  message: string;
  /** Code snippet showing the issue */
  code?: string;
  /** Suggested fix */
  suggestion?: string;
}

export interface ReviewSuggestion {
  /** Category of the suggestion */
  category: ReviewCategory;
  /** Description of the improvement */
  description: string;
  /** Expected benefit from implementing */
  benefit: string;
  /** Estimated effort to implement */
  effort: 'low' | 'medium' | 'high';
}

export type ReviewCategory =
  | 'security'
  | 'performance'
  | 'maintainability'
  | 'readability'
  | 'error_handling'
  | 'testing'
  | 'naming'
  | 'documentation'
  | 'type_safety'
  | 'best_practices';

export interface ReviewOptions {
  /** Categories to check (defaults to all) */
  categories?: ReviewCategory[];
  /** Minimum severity to report (defaults to 'info') */
  minSeverity?: ReviewIssue['severity'];
  /** Project root for resolving relative paths */
  projectRoot?: string;
}

export interface ChangeSetReviewResult {
  /** Individual file reviews */
  fileReviews: CodeReviewResult[];
  /** Aggregate score across all files */
  overallScore: number;
  /** Total issues by severity */
  issueCounts: Record<ReviewIssue['severity'], number>;
  /** Cross-file concerns */
  crossFileConcerns: string[];
  /** Summary of the entire change set */
  summary: string;
  /** Total review time */
  reviewTimeMs: number;
}

// ============================================================================
// MAIN API
// ============================================================================

/**
 * Review a single file for code quality issues.
 *
 * @param storage - LiBrainian storage instance (used for context, optional)
 * @param filePath - Path to the file to review
 * @param options - Review options
 * @returns Code review result with issues and suggestions
 *
 * @example
 * ```typescript
 * const result = await reviewCode(storage, 'src/api/query.ts');
 * console.log(`Score: ${result.overallScore}/100`);
 * for (const issue of result.issues) {
 *   console.log(`[${issue.severity}] ${issue.message}`);
 * }
 * ```
 */
export async function reviewCode(
  storage: LiBrainianStorage | null,
  filePath: string,
  options: ReviewOptions = {}
): Promise<CodeReviewResult> {
  const startTime = Date.now();

  // Resolve file path
  const resolvedPath = options.projectRoot
    ? path.resolve(options.projectRoot, filePath)
    : filePath;

  // Read file content
  const content = await readFileContent(resolvedPath);
  if (!content) {
    throw new Error(`Cannot read file: ${resolvedPath}`);
  }

  const issues: ReviewIssue[] = [];
  const suggestions: ReviewSuggestion[] = [];
  const positives: string[] = [];

  // Determine which categories to check
  const categoriesToCheck = options.categories ?? getAllCategories();

  // Run all checks
  if (categoriesToCheck.includes('security')) {
    issues.push(...checkSecurity(content, filePath));
  }
  if (categoriesToCheck.includes('performance')) {
    issues.push(...checkPerformance(content, filePath));
  }
  if (categoriesToCheck.includes('maintainability')) {
    issues.push(...checkMaintainability(content, filePath));
  }
  if (categoriesToCheck.includes('error_handling')) {
    issues.push(...checkErrorHandling(content, filePath));
  }
  if (categoriesToCheck.includes('type_safety')) {
    issues.push(...checkTypeSafety(content, filePath));
  }
  if (categoriesToCheck.includes('naming')) {
    issues.push(...checkNaming(content, filePath));
  }
  if (categoriesToCheck.includes('best_practices')) {
    issues.push(...checkBestPractices(content, filePath));
  }

  // Filter by minimum severity
  const filteredIssues = filterBySeverity(issues, options.minSeverity);

  // Generate suggestions based on issues
  suggestions.push(...generateSuggestions(content, filteredIssues));

  // Find positive aspects
  positives.push(...findPositives(content, filePath));

  // Calculate overall score
  const score = calculateScore(filteredIssues);

  // Generate summary
  const summary = generateSummary(score, filteredIssues, positives);

  return {
    file: filePath,
    overallScore: score,
    issues: sortIssuesBySeverity(filteredIssues),
    suggestions,
    positives,
    summary,
    reviewTimeMs: Date.now() - startTime,
  };
}

/**
 * Review multiple files as a change set.
 *
 * @param storage - LiBrainian storage instance (used for context, optional)
 * @param filePaths - Paths to the files to review
 * @param options - Review options
 * @returns Combined review result for all files
 *
 * @example
 * ```typescript
 * const changedFiles = ['src/api/query.ts', 'src/storage/types.ts'];
 * const result = await reviewChangeSet(storage, changedFiles);
 * console.log(`Overall score: ${result.overallScore}/100`);
 * console.log(`Critical issues: ${result.issueCounts.critical}`);
 * ```
 */
export async function reviewChangeSet(
  storage: LiBrainianStorage | null,
  filePaths: string[],
  options: ReviewOptions = {}
): Promise<ChangeSetReviewResult> {
  const startTime = Date.now();

  // Review each file
  const fileReviews: CodeReviewResult[] = [];
  for (const filePath of filePaths) {
    try {
      const review = await reviewCode(storage, filePath, options);
      fileReviews.push(review);
    } catch {
      // Skip files that can't be read (deleted files, binary files, etc.)
      continue;
    }
  }

  // Aggregate issue counts
  const issueCounts: Record<ReviewIssue['severity'], number> = {
    critical: 0,
    major: 0,
    minor: 0,
    info: 0,
  };
  for (const review of fileReviews) {
    for (const issue of review.issues) {
      issueCounts[issue.severity]++;
    }
  }

  // Calculate overall score (weighted average by file)
  const overallScore = fileReviews.length > 0
    ? Math.round(fileReviews.reduce((sum, r) => sum + r.overallScore, 0) / fileReviews.length)
    : 100;

  // Detect cross-file concerns
  const crossFileConcerns = detectCrossFileConcerns(fileReviews);

  // Generate change set summary
  const summary = generateChangeSetSummary(overallScore, issueCounts, fileReviews.length, crossFileConcerns);

  return {
    fileReviews,
    overallScore,
    issueCounts,
    crossFileConcerns,
    summary,
    reviewTimeMs: Date.now() - startTime,
  };
}

/**
 * Quick review that returns only critical and major issues.
 * Useful for pre-commit hooks or CI pipelines.
 *
 * @param filePath - Path to the file to review
 * @param projectRoot - Project root for resolving relative paths
 * @returns Review result with only critical/major issues
 */
export async function quickReview(
  filePath: string,
  projectRoot?: string
): Promise<CodeReviewResult> {
  return reviewCode(null, filePath, {
    minSeverity: 'major',
    projectRoot,
  });
}

// ============================================================================
// SECURITY CHECKS
// ============================================================================

function checkSecurity(content: string, file: string): ReviewIssue[] {
  const issues: ReviewIssue[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Check for eval
    if (/\beval\s*\(/.test(line)) {
      issues.push({
        severity: 'critical',
        category: 'security',
        line: lineNum,
        message: 'Use of eval() is a security risk',
        code: line.trim(),
        suggestion: 'Avoid eval(). Use safer alternatives like JSON.parse() or Function constructor with validated input.',
      });
    }

    // Check for SQL injection patterns
    // Pattern 1: .query() with template literal or concatenation
    if (/\.query\s*\(\s*[`'"].*\$\{/.test(line) || /\.query\s*\(\s*.*\+\s*/.test(line)) {
      issues.push({
        severity: 'critical',
        category: 'security',
        line: lineNum,
        message: 'Potential SQL injection via string interpolation or concatenation',
        code: line.trim(),
        suggestion: 'Use parameterized queries instead of string interpolation.',
      });
    }
    // Pattern 2: SQL query template literal with string interpolation (even without .query on same line)
    if (/`\s*SELECT\s+.*\$\{/.test(line) || /`\s*INSERT\s+.*\$\{/.test(line) ||
        /`\s*UPDATE\s+.*\$\{/.test(line) || /`\s*DELETE\s+.*\$\{/.test(line)) {
      issues.push({
        severity: 'critical',
        category: 'security',
        line: lineNum,
        message: 'Potential SQL injection via string interpolation in SQL query',
        code: line.trim(),
        suggestion: 'Use parameterized queries instead of string interpolation.',
      });
    }

    // Check for command injection
    if (/exec(?:Sync)?\s*\([^)]*\$\{/.test(line) || /spawn(?:Sync)?\s*\([^)]*\$\{/.test(line)) {
      issues.push({
        severity: 'critical',
        category: 'security',
        line: lineNum,
        message: 'Potential command injection via string interpolation',
        code: line.trim(),
        suggestion: 'Validate and sanitize user input before passing to shell commands.',
      });
    }

    // Check for hardcoded secrets
    if (/(?:password|secret|api[_-]?key|auth[_-]?token|private[_-]?key)\s*[:=]\s*['"][^'"]{8,}['"]/i.test(line)) {
      issues.push({
        severity: 'critical',
        category: 'security',
        line: lineNum,
        message: 'Potential hardcoded secret detected',
        code: line.trim().slice(0, 60) + (line.trim().length > 60 ? '...' : ''),
        suggestion: 'Use environment variables or a secrets manager for sensitive values.',
      });
    }

    // Check for innerHTML (XSS risk)
    if (/\.innerHTML\s*=/.test(line)) {
      issues.push({
        severity: 'major',
        category: 'security',
        line: lineNum,
        message: 'Direct innerHTML assignment may lead to XSS vulnerabilities',
        code: line.trim(),
        suggestion: 'Use textContent for plain text, or sanitize HTML with DOMPurify.',
      });
    }

    // Check for insecure random
    if (/Math\.random\s*\(\)/.test(line) && /(?:token|secret|key|password|auth|session)/i.test(line)) {
      issues.push({
        severity: 'major',
        category: 'security',
        line: lineNum,
        message: 'Math.random() is not cryptographically secure',
        code: line.trim(),
        suggestion: 'Use crypto.randomBytes() or crypto.getRandomValues() for security-sensitive random values.',
      });
    }
  }

  return issues;
}

// ============================================================================
// PERFORMANCE CHECKS
// ============================================================================

function checkPerformance(content: string, file: string): ReviewIssue[] {
  const issues: ReviewIssue[] = [];
  const lines = content.split('\n');

  // Track if we've already reported certain issues
  let reportedAwaitInLoop = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Check for await in loops (N+1 pattern)
    if (!reportedAwaitInLoop && /for\s*\([^)]*\)\s*\{/.test(line)) {
      // Look ahead for await inside the loop
      let braceDepth = 1;
      for (let j = i + 1; j < lines.length && braceDepth > 0; j++) {
        const innerLine = lines[j];
        braceDepth += (innerLine.match(/\{/g) ?? []).length;
        braceDepth -= (innerLine.match(/\}/g) ?? []).length;
        if (/\bawait\b/.test(innerLine) && braceDepth > 0) {
          issues.push({
            severity: 'major',
            category: 'performance',
            line: j + 1,
            message: 'Sequential await in loop may cause performance issues',
            code: innerLine.trim(),
            suggestion: 'Use Promise.all() to run async operations in parallel when possible.',
          });
          reportedAwaitInLoop = true;
          break;
        }
      }
    }

    // Check for inefficient array operations
    if (/\.filter\([^)]+\)\.map\([^)]+\)/.test(line)) {
      issues.push({
        severity: 'minor',
        category: 'performance',
        line: lineNum,
        message: 'Chained filter().map() iterates the array twice',
        code: line.trim(),
        suggestion: 'Consider using reduce() for a single pass, or keep as-is if readability is priority.',
      });
    }

    // Check for repeated DOM queries in loops
    if (/for\s*\([^)]*\)/.test(line) && /document\.(?:querySelector|getElementById|getElementsBy)/.test(line)) {
      issues.push({
        severity: 'minor',
        category: 'performance',
        line: lineNum,
        message: 'DOM query inside loop may cause performance issues',
        code: line.trim(),
        suggestion: 'Cache DOM element references outside the loop.',
      });
    }

    // Check for synchronous file operations in potentially async context
    if (/(?:readFileSync|writeFileSync|readdirSync|statSync)\s*\(/.test(line)) {
      issues.push({
        severity: 'minor',
        category: 'performance',
        line: lineNum,
        message: 'Synchronous file operation may block the event loop',
        code: line.trim(),
        suggestion: 'Consider using async alternatives (readFile, writeFile, etc.) in async contexts.',
      });
    }
  }

  return issues;
}

// ============================================================================
// MAINTAINABILITY CHECKS
// ============================================================================

function checkMaintainability(content: string, file: string): ReviewIssue[] {
  const issues: ReviewIssue[] = [];
  const lines = content.split('\n');

  // Check file length
  if (lines.length > 500) {
    issues.push({
      severity: 'major',
      category: 'maintainability',
      message: `File is ${lines.length} lines - consider splitting into smaller modules`,
      suggestion: 'Break into smaller, focused modules with single responsibilities.',
    });
  } else if (lines.length > 300) {
    issues.push({
      severity: 'minor',
      category: 'maintainability',
      message: `File is ${lines.length} lines - approaching recommended limit`,
      suggestion: 'Consider splitting if the file continues to grow.',
    });
  }

  // Check for deeply nested code
  let maxIndent = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const indent = line.search(/\S/);
    if (indent !== -1) {
      const indentLevel = Math.floor(indent / 2); // Assuming 2-space indent
      if (indentLevel > maxIndent) {
        maxIndent = indentLevel;
      }
      if (indentLevel >= 5) {
        issues.push({
          severity: 'minor',
          category: 'maintainability',
          line: i + 1,
          message: `Deeply nested code (${indentLevel} levels) is hard to read`,
          suggestion: 'Extract nested logic into separate functions or use early returns.',
        });
        break; // Only report once
      }
    }
  }

  // Check for long functions
  const functionStarts: { line: number; name: string }[] = [];
  const functionPattern = /(?:async\s+)?function\s+(\w+)|(?:const|let)\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*(?::\s*[^=]+)?\s*=>/g;

  let match;
  while ((match = functionPattern.exec(content)) !== null) {
    const lineNum = content.slice(0, match.index).split('\n').length;
    const name = match[1] ?? match[2] ?? 'anonymous';
    functionStarts.push({ line: lineNum, name });
  }

  // Estimate function lengths
  for (let i = 0; i < functionStarts.length; i++) {
    const start = functionStarts[i].line;
    const end = i < functionStarts.length - 1 ? functionStarts[i + 1].line : lines.length;
    const length = end - start;
    if (length > 80) {
      issues.push({
        severity: 'major',
        category: 'maintainability',
        line: start,
        message: `Function '${functionStarts[i].name}' is approximately ${length} lines`,
        suggestion: 'Break into smaller functions with single responsibilities.',
      });
    } else if (length > 50) {
      issues.push({
        severity: 'minor',
        category: 'maintainability',
        line: start,
        message: `Function '${functionStarts[i].name}' is approximately ${length} lines`,
        suggestion: 'Consider breaking into smaller functions if complexity increases.',
      });
    }
  }

  // Check for magic numbers
  const magicNumberPattern = /(?<![.\w])\b(?!0|1|-1)\d{2,}\b(?!\s*[),\];])/g;
  let magicMatch;
  while ((magicMatch = magicNumberPattern.exec(content)) !== null) {
    const lineNum = content.slice(0, magicMatch.index).split('\n').length;
    // Skip if it looks like it's in a constant declaration
    const line = lines[lineNum - 1];
    if (!/(?:const|let|var)\s+[A-Z_]+\s*=/.test(line)) {
      issues.push({
        severity: 'info',
        category: 'maintainability',
        line: lineNum,
        message: `Magic number ${magicMatch[0]} should be a named constant`,
        code: line.trim(),
        suggestion: 'Extract magic numbers into named constants for better readability.',
      });
      break; // Only report first occurrence
    }
  }

  return issues;
}

// ============================================================================
// ERROR HANDLING CHECKS
// ============================================================================

function checkErrorHandling(content: string, file: string): ReviewIssue[] {
  const issues: ReviewIssue[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Check for empty catch blocks
    if (/catch\s*\([^)]*\)\s*\{\s*\}/.test(line)) {
      issues.push({
        severity: 'major',
        category: 'error_handling',
        line: lineNum,
        message: 'Empty catch block silences errors',
        code: line.trim(),
        suggestion: 'Log the error, re-throw it, or handle it appropriately.',
      });
    }

    // Check for catch with only console.log (look ahead a few lines)
    if (/catch\s*\([^)]*\)\s*\{/.test(line)) {
      const nextLines = lines.slice(i, i + 4).join(' ');
      if (/catch\s*\([^)]*\)\s*\{\s*console\.(log|error)\s*\([^)]*\)\s*;?\s*\}/.test(nextLines)) {
        issues.push({
          severity: 'minor',
          category: 'error_handling',
          line: lineNum,
          message: 'Catch block only logs error without proper handling',
          suggestion: 'Consider re-throwing, returning error state, or adding recovery logic.',
        });
      }
    }

    // Check for unhandled Promise rejections (promise without catch)
    if (/new\s+Promise\s*\(/.test(line) && !content.includes('.catch(') && !content.includes('try')) {
      issues.push({
        severity: 'minor',
        category: 'error_handling',
        line: lineNum,
        message: 'Promise without apparent error handling',
        code: line.trim(),
        suggestion: 'Add .catch() handler or use try/catch with async/await.',
      });
      break; // Only report once
    }

    // Check for throwing string literals
    if (/throw\s+['"`]/.test(line)) {
      issues.push({
        severity: 'minor',
        category: 'error_handling',
        line: lineNum,
        message: 'Throwing string literal instead of Error object',
        code: line.trim(),
        suggestion: 'Use throw new Error("message") for proper stack traces.',
      });
    }
  }

  return issues;
}

// ============================================================================
// TYPE SAFETY CHECKS
// ============================================================================

function checkTypeSafety(content: string, file: string): ReviewIssue[] {
  const issues: ReviewIssue[] = [];
  const lines = content.split('\n');

  // Skip if not a TypeScript file
  if (!file.endsWith('.ts') && !file.endsWith('.tsx')) {
    return issues;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Check for type assertions to 'any'
    if (/as\s+any\b/.test(line)) {
      issues.push({
        severity: 'minor',
        category: 'type_safety',
        line: lineNum,
        message: "Type assertion to 'any' bypasses type checking",
        code: line.trim(),
        suggestion: "Use proper type or 'unknown' with type guards.",
      });
    }

    // Check for @ts-ignore without explanation
    if (/@ts-ignore(?!\s*:)/.test(line)) {
      issues.push({
        severity: 'minor',
        category: 'type_safety',
        line: lineNum,
        message: '@ts-ignore without explanation',
        code: line.trim(),
        suggestion: 'Add explanation: @ts-ignore: reason for ignoring',
      });
    }

    // Check for @ts-expect-error without explanation
    if (/@ts-expect-error(?!\s*:)/.test(line)) {
      issues.push({
        severity: 'info',
        category: 'type_safety',
        line: lineNum,
        message: '@ts-expect-error without explanation',
        code: line.trim(),
        suggestion: 'Add explanation: @ts-expect-error: reason for expecting error',
      });
    }

    // Check for explicit 'any' type annotation
    if (/:\s*any\b(?!\s*\[)/.test(line) && !/\bas\s+any/.test(line)) {
      issues.push({
        severity: 'minor',
        category: 'type_safety',
        line: lineNum,
        message: "Explicit 'any' type annotation loses type safety",
        code: line.trim(),
        suggestion: "Use 'unknown' with type guards, or define proper types.",
      });
    }

    // Check for non-null assertions
    if (/!\s*[.\[]/.test(line) || /!\s*$/.test(line.trim())) {
      issues.push({
        severity: 'info',
        category: 'type_safety',
        line: lineNum,
        message: 'Non-null assertion (!) may hide null pointer errors',
        code: line.trim(),
        suggestion: 'Consider optional chaining (?.) or explicit null checks.',
      });
    }
  }

  return issues;
}

// ============================================================================
// NAMING CHECKS
// ============================================================================

function checkNaming(content: string, file: string): ReviewIssue[] {
  const issues: ReviewIssue[] = [];
  const lines = content.split('\n');

  // Track single-letter variables (except common ones like i, j, k, x, y)
  const acceptableSingleLetter = new Set(['i', 'j', 'k', 'x', 'y', 'z', 'e', 't', 'n', 'm', '_']);
  const singleLetterVars: { name: string; line: number }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Find single-letter variable declarations
    const varPattern = /(?:const|let|var)\s+([a-z])\s*[=:]/g;
    let match;
    while ((match = varPattern.exec(line)) !== null) {
      if (!acceptableSingleLetter.has(match[1])) {
        singleLetterVars.push({ name: match[1], line: lineNum });
      }
    }

    // Check for misleading boolean names
    if (/(?:const|let|var)\s+(?:is|has|should|can|will|did)\w+\s*=\s*(?!true|false|!)/.test(line)) {
      // Only flag if it's clearly not a boolean
      if (/=\s*['"`\d[]/.test(line)) {
        issues.push({
          severity: 'info',
          category: 'naming',
          line: lineNum,
          message: 'Variable with boolean prefix (is/has/should/can) appears to hold non-boolean value',
          code: line.trim(),
          suggestion: 'Use boolean prefixes only for boolean values.',
        });
      }
    }

    // Check for abbreviated names (but allow common abbreviations)
    const commonAbbreviations = new Set(['id', 'db', 'io', 'ui', 'api', 'url', 'uri', 'src', 'dst', 'err', 'req', 'res', 'ctx', 'fn', 'cb', 'el', 'env', 'config', 'params', 'args', 'opts', 'props']);
    const abbrevPattern = /(?:const|let|var)\s+(\w{2,4})\s*[=:]/g;
    while ((match = abbrevPattern.exec(line)) !== null) {
      const name = match[1].toLowerCase();
      if (!commonAbbreviations.has(name) && /^[a-z]+$/.test(name) && !/^(?:is|to|of|by|in|on|at)$/.test(name)) {
        // Check if it looks like an abbreviation (all consonants or uncommon pattern)
        if (/^[bcdfghjklmnpqrstvwxz]+$/.test(name)) {
          issues.push({
            severity: 'info',
            category: 'naming',
            line: lineNum,
            message: `Variable name '${match[1]}' may be too abbreviated`,
            code: line.trim(),
            suggestion: 'Use descriptive names for better readability.',
          });
          break; // Only report first occurrence
        }
      }
    }
  }

  // Report if too many single-letter variables
  if (singleLetterVars.length > 3) {
    issues.push({
      severity: 'minor',
      category: 'naming',
      message: `Multiple single-letter variable names detected: ${singleLetterVars.map(v => `${v.name} (line ${v.line})`).join(', ')}`,
      suggestion: 'Use descriptive names for better readability.',
    });
  }

  return issues;
}

// ============================================================================
// BEST PRACTICES CHECKS
// ============================================================================

function checkBestPractices(content: string, file: string): ReviewIssue[] {
  const issues: ReviewIssue[] = [];
  const lines = content.split('\n');

  // Check for console.log in non-test files
  if (!file.includes('test') && !file.includes('spec') && !file.includes('__tests__')) {
    const consoleStatements: number[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (/console\.(log|debug|info)\s*\(/.test(lines[i])) {
        consoleStatements.push(i + 1);
      }
    }
    if (consoleStatements.length > 2) {
      issues.push({
        severity: 'minor',
        category: 'best_practices',
        message: `${consoleStatements.length} console statements found (lines: ${consoleStatements.slice(0, 5).join(', ')}${consoleStatements.length > 5 ? '...' : ''})`,
        suggestion: 'Use proper logging library in production code.',
      });
    }
  }

  // Check for TODO/FIXME/HACK comments
  const todoComments: { type: string; line: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/\/\/\s*(TODO|FIXME|HACK|XXX)\b/i.test(line)) {
      const match = line.match(/\/\/\s*(TODO|FIXME|HACK|XXX)\b/i);
      if (match) {
        todoComments.push({ type: match[1].toUpperCase(), line: i + 1 });
      }
    }
  }
  if (todoComments.length > 0) {
    const hackCount = todoComments.filter(t => t.type === 'HACK' || t.type === 'XXX').length;
    const fixmeCount = todoComments.filter(t => t.type === 'FIXME').length;
    if (hackCount > 0) {
      issues.push({
        severity: 'minor',
        category: 'best_practices',
        message: `${hackCount} HACK/XXX comments found - these indicate technical debt`,
        suggestion: 'Address these issues or create tracked tickets.',
      });
    }
    if (fixmeCount > 0) {
      issues.push({
        severity: 'minor',
        category: 'best_practices',
        message: `${fixmeCount} FIXME comments found`,
        suggestion: 'Fix these issues or create tracked tickets.',
      });
    }
  }

  // Check for disabled tests
  const disabledTests = content.match(/(?:it|test|describe)\.skip\s*\(/g);
  if (disabledTests && disabledTests.length > 0) {
    issues.push({
      severity: 'minor',
      category: 'best_practices',
      message: `${disabledTests.length} disabled test(s) found`,
      suggestion: 'Fix or remove skipped tests to maintain test coverage.',
    });
  }

  // Check for var usage (prefer const/let)
  for (let i = 0; i < lines.length; i++) {
    if (/\bvar\s+\w+/.test(lines[i])) {
      issues.push({
        severity: 'info',
        category: 'best_practices',
        line: i + 1,
        message: "'var' is used instead of 'const' or 'let'",
        code: lines[i].trim(),
        suggestion: "Use 'const' for values that don't change, 'let' otherwise.",
      });
      break; // Only report first occurrence
    }
  }

  // Check for == instead of ===
  for (let i = 0; i < lines.length; i++) {
    // Match == but not ===, and exclude comments
    if (/[^!=<>]==[^=]/.test(lines[i]) && !lines[i].trim().startsWith('//')) {
      issues.push({
        severity: 'minor',
        category: 'best_practices',
        line: i + 1,
        message: 'Use of loose equality (==) instead of strict equality (===)',
        code: lines[i].trim(),
        suggestion: 'Use === for type-safe comparison.',
      });
      break; // Only report first occurrence
    }
  }

  return issues;
}

// ============================================================================
// POSITIVE DETECTION
// ============================================================================

function findPositives(content: string, file: string): string[] {
  const positives: string[] = [];

  // Check for TypeScript types
  if (/\bexport\b.*\binterface\b|\btype\b.*=.*[{|]/.test(content)) {
    positives.push('Good use of TypeScript types');
  }

  // Check for error handling
  if (/try\s*\{[\s\S]*\}\s*catch/.test(content)) {
    positives.push('Error handling implemented');
  }

  // Check for JSDoc documentation
  if (/\/\*\*[\s\S]*?\*\//.test(content)) {
    positives.push('JSDoc documentation present');
  }

  // Check for tests
  if (content.includes('test(') || content.includes('it(') || content.includes('describe(')) {
    positives.push('Test coverage exists');
  }

  // Check for proper async/await usage
  if (/\basync\b/.test(content) && /\bawait\b/.test(content)) {
    positives.push('Proper async/await patterns used');
  }

  // Check for input validation
  if (/\bif\s*\(\s*!?\w+\s*(?:===?|!==?)\s*(?:null|undefined|'')/.test(content) ||
      /\bif\s*\(\s*typeof\s+\w+\s*(?:===?|!==?)/.test(content)) {
    positives.push('Input validation present');
  }

  // Check for modular exports
  if ((content.match(/\bexport\b/g) ?? []).length > 3) {
    positives.push('Well-organized modular exports');
  }

  // Check for constants
  if (/\bconst\s+[A-Z][A-Z_0-9]+\s*=/.test(content)) {
    positives.push('Named constants used for magic values');
  }

  return positives;
}

// ============================================================================
// SUGGESTION GENERATION
// ============================================================================

function generateSuggestions(content: string, issues: ReviewIssue[]): ReviewSuggestion[] {
  const suggestions: ReviewSuggestion[] = [];

  // Suggest security audit if security issues found
  const securityIssues = issues.filter(i => i.category === 'security');
  if (securityIssues.length > 0) {
    suggestions.push({
      category: 'security',
      description: 'Consider a thorough security audit',
      benefit: 'Reduce vulnerability risk and improve security posture',
      effort: 'medium',
    });
  }

  // Suggest tests if not present
  if (!content.includes('describe(') && !content.includes('test(') && !content.includes('it(')) {
    suggestions.push({
      category: 'testing',
      description: 'Add unit tests for this file',
      benefit: 'Improve code confidence and prevent regressions',
      effort: 'medium',
    });
  }

  // Suggest documentation if limited
  const jsdocCount = (content.match(/\/\*\*[\s\S]*?\*\//g) ?? []).length;
  const functionCount = (content.match(/(?:async\s+)?function\s+\w+|(?:const|let)\s+\w+\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/g) ?? []).length;
  if (functionCount > 5 && jsdocCount < functionCount / 2) {
    suggestions.push({
      category: 'documentation',
      description: 'Add JSDoc documentation for exported functions',
      benefit: 'Improve code discoverability and IDE support',
      effort: 'low',
    });
  }

  // Suggest refactoring for maintainability issues
  const maintainabilityIssues = issues.filter(i => i.category === 'maintainability' && (i.severity === 'major' || i.severity === 'critical'));
  if (maintainabilityIssues.length > 0) {
    suggestions.push({
      category: 'maintainability',
      description: 'Refactor to reduce complexity',
      benefit: 'Easier maintenance and reduced bug risk',
      effort: 'high',
    });
  }

  // Suggest error handling improvements
  const errorIssues = issues.filter(i => i.category === 'error_handling');
  if (errorIssues.length > 2) {
    suggestions.push({
      category: 'error_handling',
      description: 'Implement consistent error handling strategy',
      benefit: 'Better debugging and user experience',
      effort: 'medium',
    });
  }

  return suggestions;
}

// ============================================================================
// SCORING AND SUMMARY
// ============================================================================

function calculateScore(issues: ReviewIssue[]): number {
  let score = 100;

  for (const issue of issues) {
    switch (issue.severity) {
      case 'critical':
        score -= 20;
        break;
      case 'major':
        score -= 10;
        break;
      case 'minor':
        score -= 3;
        break;
      case 'info':
        score -= 1;
        break;
    }
  }

  return Math.max(0, Math.min(100, score));
}

function generateSummary(score: number, issues: ReviewIssue[], positives: string[]): string {
  const critical = issues.filter(i => i.severity === 'critical').length;
  const major = issues.filter(i => i.severity === 'major').length;

  if (critical > 0) {
    return `${critical} critical issue(s) found that should be addressed before merging.`;
  }
  if (major > 3) {
    return `${major} major issues found. Consider addressing before merging.`;
  }
  if (score >= 90) {
    const positive = positives[0] ? ` ${positives[0]}.` : '';
    return `Code looks good! Score: ${score}/100.${positive}`;
  }
  if (score >= 70) {
    return `Score: ${score}/100. ${issues.length} issue(s) found - minor improvements suggested.`;
  }
  return `Score: ${score}/100. ${issues.length} issue(s) found - improvements recommended.`;
}

function generateChangeSetSummary(
  overallScore: number,
  issueCounts: Record<ReviewIssue['severity'], number>,
  fileCount: number,
  crossFileConcerns: string[]
): string {
  const totalIssues = issueCounts.critical + issueCounts.major + issueCounts.minor + issueCounts.info;

  if (issueCounts.critical > 0) {
    return `Change set review: ${issueCounts.critical} critical issue(s) in ${fileCount} file(s). Address before merging.`;
  }
  if (issueCounts.major > 5) {
    return `Change set review: ${issueCounts.major} major issues across ${fileCount} file(s). Consider addressing key issues.`;
  }
  if (overallScore >= 85) {
    return `Change set review: Score ${overallScore}/100. ${fileCount} file(s) reviewed, ${totalIssues} minor issue(s).`;
  }
  return `Change set review: Score ${overallScore}/100. ${fileCount} file(s) reviewed, ${totalIssues} issue(s) found.`;
}

function detectCrossFileConcerns(fileReviews: CodeReviewResult[]): string[] {
  const concerns: string[] = [];

  // Check for consistent security issues across files
  const securityIssueFiles = fileReviews.filter(r =>
    r.issues.some(i => i.category === 'security' && (i.severity === 'critical' || i.severity === 'major'))
  );
  if (securityIssueFiles.length > 1) {
    concerns.push(`Security issues found in ${securityIssueFiles.length} files - consider security review`);
  }

  // Check for consistent error handling issues
  const errorHandlingIssueFiles = fileReviews.filter(r =>
    r.issues.some(i => i.category === 'error_handling' && i.severity === 'major')
  );
  if (errorHandlingIssueFiles.length > 2) {
    concerns.push('Inconsistent error handling across multiple files');
  }

  // Check for widespread type safety issues
  const typeSafetyIssueFiles = fileReviews.filter(r =>
    r.issues.filter(i => i.category === 'type_safety').length > 2
  );
  if (typeSafetyIssueFiles.length > 2) {
    concerns.push('Type safety issues present in multiple files');
  }

  return concerns;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function getAllCategories(): ReviewCategory[] {
  return [
    'security',
    'performance',
    'maintainability',
    'readability',
    'error_handling',
    'testing',
    'naming',
    'documentation',
    'type_safety',
    'best_practices',
  ];
}

function filterBySeverity(issues: ReviewIssue[], minSeverity?: ReviewIssue['severity']): ReviewIssue[] {
  if (!minSeverity) return issues;

  const severityOrder: Record<ReviewIssue['severity'], number> = {
    critical: 0,
    major: 1,
    minor: 2,
    info: 3,
  };

  const minOrder = severityOrder[minSeverity];
  return issues.filter(issue => severityOrder[issue.severity] <= minOrder);
}

function sortIssuesBySeverity(issues: ReviewIssue[]): ReviewIssue[] {
  const severityOrder: Record<ReviewIssue['severity'], number> = {
    critical: 0,
    major: 1,
    minor: 2,
    info: 3,
  };

  return [...issues].sort((a, b) => {
    const severityDiff = severityOrder[a.severity] - severityOrder[b.severity];
    if (severityDiff !== 0) return severityDiff;
    return (a.line ?? 0) - (b.line ?? 0);
  });
}

async function readFileContent(filePath: string): Promise<string | null> {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

// ============================================================================
// QUERY INTEGRATION HELPERS
// ============================================================================

/**
 * Patterns for detecting code review intent in queries.
 */
export const CODE_REVIEW_PATTERNS = [
  /\breview\s+(?:this\s+)?(?:file|code|changes?)\b/i,
  /\bcode\s+review\b/i,
  /\bcheck\s+(?:this\s+)?(?:file|code)\s+for\s+issues?\b/i,
  /\banalyze\s+(?:this\s+)?(?:file|code)\s+quality\b/i,
  /\bfind\s+issues?\s+in\s+(?:this\s+)?(?:file|code)\b/i,
  /\bquality\s+check\b/i,
  /\bpre[- ]commit\s+review\b/i,
  /\bwhat\s+(?:issues?|problems?)\s+(?:are\s+)?(?:in|with)\s+(?:this\s+)?(?:file|code)\b/i,
  /\bsecurity\s+(?:review|check|audit)\b/i,
];

/**
 * Check if a query intent matches code review patterns.
 *
 * @param intent - Query intent string
 * @returns True if the query is asking for code review
 */
export function isCodeReviewQuery(intent: string): boolean {
  return CODE_REVIEW_PATTERNS.some(pattern => pattern.test(intent));
}

/**
 * Extract file path from a code review query.
 *
 * @param intent - Query intent string
 * @returns Extracted file path or undefined
 */
export function extractReviewFilePath(intent: string): string | undefined {
  // Try to extract file path patterns
  const patterns = [
    /review\s+(?:file\s+)?["']?([^\s"']+\.(?:ts|js|tsx|jsx|py|go|rs|java))["']?/i,
    /check\s+["']?([^\s"']+\.(?:ts|js|tsx|jsx|py|go|rs|java))["']?/i,
    /(?:file|code)\s+["']?([^\s"']+\.(?:ts|js|tsx|jsx|py|go|rs|java))["']?/i,
    /["']([^\s"']+\.(?:ts|js|tsx|jsx|py|go|rs|java))["']/i,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(intent);
    if (match?.[1]) {
      return match[1];
    }
  }

  return undefined;
}

/**
 * Format code review result for agent consumption.
 *
 * @param result - Code review result
 * @param verbose - Include all details (default: false)
 * @returns Formatted string
 */
export function formatCodeReviewResult(result: CodeReviewResult, verbose = false): string {
  const lines: string[] = [];

  lines.push(`## Code Review: ${result.file}`);
  lines.push(`**Score:** ${result.overallScore}/100`);
  lines.push('');
  lines.push(`**Summary:** ${result.summary}`);
  lines.push('');

  // Issues
  if (result.issues.length > 0) {
    lines.push('### Issues');
    for (const issue of result.issues) {
      const location = issue.line ? ` (line ${issue.line})` : '';
      const severityBadge = {
        critical: '[CRITICAL]',
        major: '[MAJOR]',
        minor: '[minor]',
        info: '[info]',
      }[issue.severity];

      lines.push(`- ${severityBadge} **${issue.category}**${location}: ${issue.message}`);
      if (verbose && issue.code) {
        lines.push(`  \`\`\`\n  ${issue.code}\n  \`\`\``);
      }
      if (verbose && issue.suggestion) {
        lines.push(`  *Suggestion:* ${issue.suggestion}`);
      }
    }
    lines.push('');
  }

  // Positives
  if (result.positives.length > 0) {
    lines.push('### Positives');
    for (const positive of result.positives) {
      lines.push(`- ${positive}`);
    }
    lines.push('');
  }

  // Suggestions
  if (verbose && result.suggestions.length > 0) {
    lines.push('### Suggestions');
    for (const suggestion of result.suggestions) {
      lines.push(`- [${suggestion.effort} effort] **${suggestion.category}**: ${suggestion.description}`);
      lines.push(`  *Benefit:* ${suggestion.benefit}`);
    }
  }

  return lines.join('\n');
}
