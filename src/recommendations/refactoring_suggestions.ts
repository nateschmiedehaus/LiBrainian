/**
 * @fileoverview Intelligent Refactoring Suggestion System
 *
 * Identifies refactoring opportunities and helps agents improve code quality by:
 * - Detecting code smells (duplicates, long functions, complex conditionals)
 * - Analyzing magic numbers and dead code
 * - Finding parameter list issues
 * - Providing actionable, step-by-step refactoring guidance
 *
 * Designed for agent queries like "what should I refactor" or "refactoring opportunities".
 */

import type { LiBrainianStorage } from '../storage/types.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Types of refactoring operations that can be suggested.
 * Based on Martin Fowler's refactoring catalog.
 */
export type RefactoringType =
  | 'extract_function'
  | 'extract_variable'
  | 'extract_class'
  | 'inline'
  | 'rename'
  | 'move'
  | 'decompose_conditional'
  | 'consolidate_duplicate'
  | 'replace_magic_number'
  | 'introduce_parameter_object'
  | 'replace_temp_with_query'
  | 'simplify_boolean'
  | 'remove_dead_code'
  | 'extract_interface';

/**
 * A single refactoring suggestion with full context for agent execution.
 */
export interface RefactoringSuggestion {
  /** The type of refactoring to apply */
  type: RefactoringType;
  /** Location of the code to refactor */
  target: {
    file: string;
    startLine: number;
    endLine: number;
    code?: string;
  };
  /** Human-readable description of what needs to change */
  description: string;
  /** Why this refactoring improves the code */
  benefit: string;
  /** Risk level of this change (low = safe, high = careful testing needed) */
  risk: 'low' | 'medium' | 'high';
  /** Effort required to implement */
  effort: 'trivial' | 'easy' | 'moderate' | 'significant';
  /** Whether this can be automated by tools */
  automatable: boolean;
  /** Step-by-step instructions for executing the refactoring */
  steps: string[];
  /** Optional before/after code examples */
  beforeAfter?: {
    before: string;
    after: string;
  };
}

/**
 * Options for finding refactoring opportunities.
 */
export interface RefactoringOptions {
  /** Maximum number of files to analyze (for performance) */
  maxFiles?: number;
  /** Minimum function length to flag as "long" */
  longFunctionThreshold?: number;
  /** Minimum duplicate block size in lines */
  duplicateBlockSize?: number;
  /** Whether to include low-priority suggestions */
  includeLowPriority?: boolean;
}

// ============================================================================
// MAIN API
// ============================================================================

/**
 * Find refactoring opportunities in the codebase.
 *
 * Analyzes code for common code smells and returns prioritized suggestions
 * for improving code quality.
 *
 * @param storage - The librainian storage instance
 * @param filePath - Optional specific file to analyze (analyzes all if not provided)
 * @param options - Configuration options
 * @returns Array of refactoring suggestions sorted by risk (low first)
 *
 * @example
 * ```typescript
 * // Find all refactoring opportunities
 * const suggestions = await findRefactoringOpportunities(storage);
 *
 * // Focus on a specific file
 * const fileSuggestions = await findRefactoringOpportunities(
 *   storage,
 *   'src/api/query.ts'
 * );
 * ```
 */
export async function findRefactoringOpportunities(
  storage: LiBrainianStorage,
  filePath?: string,
  options: RefactoringOptions = {}
): Promise<RefactoringSuggestion[]> {
  const {
    maxFiles = 50,
    longFunctionThreshold = 40,
    duplicateBlockSize = 5,
    includeLowPriority = false,
  } = options;

  const suggestions: RefactoringSuggestion[] = [];

  // Get files to analyze
  const files = filePath
    ? [{ path: filePath }]
    : await storage.getFiles();

  // Analyze each file for refactoring opportunities
  for (const file of files.slice(0, maxFiles)) {
    const content = await getFileContent(storage, file.path);
    if (!content) continue;

    // Run all detectors
    suggestions.push(...findDuplicateCode(content, file.path, duplicateBlockSize));
    suggestions.push(...findLongFunctions(content, file.path, longFunctionThreshold));
    suggestions.push(...findComplexConditionals(content, file.path));
    suggestions.push(...findMagicNumbers(content, file.path));
    suggestions.push(...findDeadCode(content, file.path));
    suggestions.push(...findParameterListSmells(content, file.path));
  }

  // Filter low-priority if requested
  let filteredSuggestions = includeLowPriority
    ? suggestions
    : suggestions.filter((s) => s.risk !== 'low' || s.effort !== 'trivial');

  // Sort by risk (low first) then by effort (easy first)
  return filteredSuggestions.sort((a, b) => {
    const riskDiff = riskOrder(a.risk) - riskOrder(b.risk);
    if (riskDiff !== 0) return riskDiff;
    return effortOrder(a.effort) - effortOrder(b.effort);
  });
}

/**
 * Get a summary of refactoring opportunities by type.
 *
 * @param suggestions - Array of refactoring suggestions
 * @returns Summary object with counts by type
 */
export function summarizeRefactoringSuggestions(
  suggestions: RefactoringSuggestion[]
): RefactoringSummary {
  const byType: Partial<Record<RefactoringType, number>> = {};
  const byRisk: Record<'low' | 'medium' | 'high', number> = { low: 0, medium: 0, high: 0 };
  const byEffort: Record<'trivial' | 'easy' | 'moderate' | 'significant', number> = {
    trivial: 0,
    easy: 0,
    moderate: 0,
    significant: 0,
  };
  let automatableCount = 0;

  for (const s of suggestions) {
    byType[s.type] = (byType[s.type] ?? 0) + 1;
    byRisk[s.risk]++;
    byEffort[s.effort]++;
    if (s.automatable) automatableCount++;
  }

  return {
    total: suggestions.length,
    byType: byType as Record<RefactoringType, number>,
    byRisk,
    byEffort,
    automatableCount,
    topOpportunities: suggestions.slice(0, 5).map((s) => ({
      type: s.type,
      file: s.target.file,
      description: s.description,
    })),
  };
}

/**
 * Summary of refactoring opportunities.
 */
export interface RefactoringSummary {
  total: number;
  byType: Record<RefactoringType, number>;
  byRisk: Record<'low' | 'medium' | 'high', number>;
  byEffort: Record<'trivial' | 'easy' | 'moderate' | 'significant', number>;
  automatableCount: number;
  topOpportunities: Array<{ type: RefactoringType; file: string; description: string }>;
}

// ============================================================================
// DUPLICATE CODE DETECTION
// ============================================================================

/**
 * Find duplicate code blocks in a file.
 *
 * Uses a simple hash-based approach to detect exact duplicates.
 * For more sophisticated clone detection, use the code_clone_analysis module.
 */
function findDuplicateCode(
  content: string,
  file: string,
  blockSize: number = 5
): RefactoringSuggestion[] {
  const suggestions: RefactoringSuggestion[] = [];
  const lines = content.split('\n');

  // Skip trivial files
  if (lines.length < blockSize * 2) return suggestions;

  // Simple duplicate detection: find repeated blocks
  const seen = new Map<string, number[]>();

  for (let i = 0; i <= lines.length - blockSize; i++) {
    const block = lines
      .slice(i, i + blockSize)
      .join('\n')
      .trim();

    // Skip trivial blocks (empty, only braces, comments)
    if (block.length < 50) continue;
    if (/^[\s{}();\[\]]*$/.test(block)) continue;

    if (seen.has(block)) {
      seen.get(block)!.push(i);
    } else {
      seen.set(block, [i]);
    }
  }

  for (const [block, locations] of seen) {
    if (locations.length >= 2) {
      suggestions.push({
        type: 'consolidate_duplicate',
        target: {
          file,
          startLine: locations[0] + 1,
          endLine: locations[0] + blockSize,
          code: block.slice(0, 100) + (block.length > 100 ? '...' : ''),
        },
        description: `Duplicate code found at lines ${locations.map((l) => l + 1).join(', ')}`,
        benefit: 'Reduces code duplication and maintenance burden',
        risk: 'medium',
        effort: 'moderate',
        automatable: false,
        steps: [
          'Identify the common functionality',
          'Create a new function with the shared code',
          'Replace all occurrences with function call',
          'Add appropriate parameters for variations',
          'Update tests to cover the new shared function',
        ],
      });
    }
  }

  return suggestions;
}

// ============================================================================
// LONG FUNCTION DETECTION
// ============================================================================

/**
 * Find functions that are too long and should be split.
 */
function findLongFunctions(
  content: string,
  file: string,
  threshold: number = 40
): RefactoringSuggestion[] {
  const suggestions: RefactoringSuggestion[] = [];

  // Match function declarations (regular, arrow, async)
  const functionPattern =
    /(?:async\s+)?(?:function\s+(\w+)|(?:const|let)\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*(?::\s*[^=]+)?\s*=>)/g;

  let match;
  while ((match = functionPattern.exec(content)) !== null) {
    const funcName = match[1] || match[2];
    const startLine = content.slice(0, match.index).split('\n').length;

    // Find function body
    const funcStart = content.indexOf('{', match.index);
    if (funcStart === -1) continue;

    // Track brace depth to find function end
    let depth = 0;
    let funcEnd = funcStart;
    for (let i = funcStart; i < content.length; i++) {
      if (content[i] === '{') depth++;
      if (content[i] === '}') depth--;
      if (depth === 0) {
        funcEnd = i;
        break;
      }
    }

    const funcLength = content.slice(funcStart, funcEnd).split('\n').length;

    if (funcLength > threshold) {
      suggestions.push({
        type: 'extract_function',
        target: {
          file,
          startLine,
          endLine: startLine + funcLength,
        },
        description: `Function '${funcName}' is ${funcLength} lines long (threshold: ${threshold})`,
        benefit: 'Improves readability, testability, and reusability',
        risk: 'low',
        effort: funcLength > 100 ? 'significant' : 'moderate',
        automatable: false,
        steps: [
          'Identify logical sections within the function',
          'Group related operations that can be named',
          'Extract each section to a well-named helper function',
          'Ensure each new function has a single responsibility',
          'Add tests for extracted functions',
          'Review for opportunities to reuse the extracted functions',
        ],
      });
    }
  }

  return suggestions;
}

// ============================================================================
// COMPLEX CONDITIONAL DETECTION
// ============================================================================

/**
 * Find complex conditional expressions that should be simplified.
 */
function findComplexConditionals(content: string, file: string): RefactoringSuggestion[] {
  const suggestions: RefactoringSuggestion[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Count boolean operators
    const andOrCount = (line.match(/&&|\|\|/g) || []).length;
    if (andOrCount >= 3) {
      suggestions.push({
        type: 'decompose_conditional',
        target: {
          file,
          startLine: i + 1,
          endLine: i + 1,
          code: line.trim().slice(0, 80) + (line.trim().length > 80 ? '...' : ''),
        },
        description: `Complex conditional with ${andOrCount} boolean operators`,
        benefit: 'Improves readability and makes logic easier to understand',
        risk: 'low',
        effort: 'easy',
        automatable: true,
        steps: [
          'Extract each condition into a well-named boolean variable',
          'Use descriptive names that explain the intent',
          'Combine the variables in the if statement',
          'Consider extracting to a predicate function if reusable',
        ],
        beforeAfter: {
          before: 'if (a && b || c && d) { ... }',
          after: `const isFirstCondition = a && b;
const isSecondCondition = c && d;
if (isFirstCondition || isSecondCondition) { ... }`,
        },
      });
    }

    // Nested ternaries - exclude optional chaining (?.) and nullish coalescing (??)
    // Remove ?. and ?? first, then count remaining ? that are part of ternary operators
    const lineWithoutOptionalChaining = line.replace(/\?\./g, '').replace(/\?\?/g, '');
    const ternaryCount = (lineWithoutOptionalChaining.match(/\?[^:]/g) || []).length;
    if (ternaryCount >= 2 && lineWithoutOptionalChaining.includes(':')) {
      suggestions.push({
        type: 'simplify_boolean',
        target: {
          file,
          startLine: i + 1,
          endLine: i + 1,
          code: line.trim().slice(0, 80) + (line.trim().length > 80 ? '...' : ''),
        },
        description: 'Nested ternary operator detected',
        benefit: 'Improves readability - nested ternaries are hard to parse',
        risk: 'low',
        effort: 'easy',
        automatable: false,
        steps: [
          'Convert nested ternary to if-else or switch statement',
          'Consider extracting to a function for complex logic',
          'Use early returns to simplify the logic',
        ],
        beforeAfter: {
          before: 'result = a ? (b ? x : y) : z',
          after: `if (a && b) {
  result = x;
} else if (a) {
  result = y;
} else {
  result = z;
}`,
        },
      });
    }
  }

  return suggestions;
}

// ============================================================================
// MAGIC NUMBER DETECTION
// ============================================================================

/**
 * Find magic numbers that should be extracted to named constants.
 */
function findMagicNumbers(content: string, file: string): RefactoringSuggestion[] {
  const suggestions: RefactoringSuggestion[] = [];
  const lines = content.split('\n');

  // Common acceptable numbers (not worth extracting)
  const acceptable = new Set([0, 1, 2, -1, 10, 100, 1000, 60, 24, 365, 1024]);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip comments, imports, and declarations
    if (line.trim().startsWith('//') || line.trim().startsWith('/*')) continue;
    if (line.trim().startsWith('import')) continue;
    if (/^\s*(const|let|var)\s+\w+\s*=\s*\d+/.test(line)) continue;

    // Find numeric literals (2+ digits to avoid trivial numbers)
    const numbers = line.match(/\b\d{2,}\b/g);
    if (numbers) {
      for (const num of numbers) {
        const value = parseInt(num, 10);

        // Skip acceptable values
        if (acceptable.has(value)) continue;

        // Skip if it's part of a constant declaration
        if (line.includes('const ') && line.includes(num)) continue;

        suggestions.push({
          type: 'replace_magic_number',
          target: {
            file,
            startLine: i + 1,
            endLine: i + 1,
            code: line.trim(),
          },
          description: `Magic number ${num} found - extract to named constant`,
          benefit: 'Improves code clarity and maintainability',
          risk: 'low',
          effort: 'trivial',
          automatable: true,
          steps: [
            `Extract ${num} to a named constant`,
            'Give it a descriptive name explaining its purpose',
            'Replace all occurrences with the constant',
            'Consider grouping related constants together',
          ],
          beforeAfter: {
            before: `if (items.length > ${num}) { ... }`,
            after: `const MAX_ITEMS = ${num};
if (items.length > MAX_ITEMS) { ... }`,
          },
        });
        break; // One suggestion per line to avoid noise
      }
    }
  }

  return suggestions;
}

// ============================================================================
// DEAD CODE DETECTION
// ============================================================================

/**
 * Find potentially dead or unreachable code.
 */
function findDeadCode(content: string, file: string): RefactoringSuggestion[] {
  const suggestions: RefactoringSuggestion[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Unreachable code after return - only flag code that is truly within the same scope
    if (/^\s*return\b/.test(line)) {
      // Check next non-empty, non-comment lines
      for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
        const nextLine = lines[j].trim();
        // Skip empty lines and comments
        if (!nextLine) continue;
        if (nextLine.startsWith('//') || nextLine.startsWith('/*')) continue;
        // Stop at any line containing closing brace - ends current scope or opens new one
        // This catches: }, } else {, } catch {, } finally {, etc.
        if (nextLine.includes('}')) break;
        // Stop at case/default labels - code after these is reachable via the switch
        if (nextLine.startsWith('case ') || nextLine.startsWith('default:')) break;
        // Stop at break statements - these end control flow
        if (nextLine === 'break;') break;
        // Stop at function/class definitions - these are new scopes
        if (/^\s*(async\s+)?(function|class|export|const\s+\w+\s*=\s*\(|const\s+\w+\s*=\s*async)/.test(nextLine)) break;
        // Stop at export statements
        if (/^\s*export\s+(default\s+)?(function|class|const|let|var)/.test(nextLine)) break;

        // This line is unreachable
        suggestions.push({
          type: 'remove_dead_code',
          target: {
            file,
            startLine: j + 1,
            endLine: j + 1,
            code: nextLine,
          },
          description: 'Unreachable code after return statement',
          benefit: 'Removes confusion and reduces file size',
          risk: 'low',
          effort: 'trivial',
          automatable: true,
          steps: ['Remove the unreachable code', 'Verify no side effects were intended'],
        });
        break;
      }
    }

    // Commented out code blocks
    if (/^\s*\/\/\s*(const|let|var|function|class|if|for|while|return|await)/.test(line)) {
      suggestions.push({
        type: 'remove_dead_code',
        target: {
          file,
          startLine: i + 1,
          endLine: i + 1,
          code: line.trim(),
        },
        description: 'Commented-out code detected',
        benefit: 'Reduces clutter - use version control for history',
        risk: 'low',
        effort: 'trivial',
        automatable: true,
        steps: ['Remove commented code', 'Rely on git history if the code is ever needed again'],
      });
    }
  }

  return suggestions;
}

// ============================================================================
// PARAMETER LIST SMELL DETECTION
// ============================================================================

/**
 * Find functions with too many parameters.
 */
function findParameterListSmells(content: string, file: string): RefactoringSuggestion[] {
  const suggestions: RefactoringSuggestion[] = [];

  // Match function parameters
  const funcPattern =
    /(?:function\s+\w+|(?:const|let)\s+\w+\s*=\s*(?:async\s*)?)\s*\(([^)]+)\)/g;

  let match;
  while ((match = funcPattern.exec(content)) !== null) {
    const paramsStr = match[1];
    const params = paramsStr
      .split(',')
      .filter((p) => p.trim())
      .map((p) => p.trim());

    if (params.length >= 4) {
      const startLine = content.slice(0, match.index).split('\n').length;
      suggestions.push({
        type: 'introduce_parameter_object',
        target: {
          file,
          startLine,
          endLine: startLine,
        },
        description: `Function has ${params.length} parameters - consider using an options object`,
        benefit: 'Improves readability and makes function calls clearer',
        risk: 'medium',
        effort: 'moderate',
        automatable: false,
        steps: [
          'Create an interface for the parameters',
          'Group related parameters together',
          'Replace individual parameters with the options object',
          'Update all call sites',
          'Consider which parameters are truly required vs optional',
        ],
        beforeAfter: {
          before: 'function process(a, b, c, d, e) { ... }',
          after: `interface ProcessOptions {
  a: TypeA;
  b: TypeB;
  c?: TypeC;
  d?: TypeD;
  e?: TypeE;
}

function process(options: ProcessOptions) { ... }`,
        },
      });
    }
  }

  return suggestions;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get file content from filesystem.
 * Storage types don't include raw code content, so we read from disk.
 */
async function getFileContent(
  _storage: LiBrainianStorage,
  filePath: string
): Promise<string | null> {
  try {
    const fs = await import('fs/promises');
    return await fs.readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Convert risk level to numeric order for sorting.
 */
function riskOrder(risk: string): number {
  return { low: 0, medium: 1, high: 2 }[risk] ?? 3;
}

/**
 * Convert effort level to numeric order for sorting.
 */
function effortOrder(effort: string): number {
  return { trivial: 0, easy: 1, moderate: 2, significant: 3 }[effort] ?? 4;
}

// ============================================================================
// EXPORTS FOR TESTING
// ============================================================================

export const _internal = {
  findDuplicateCode,
  findLongFunctions,
  findComplexConditionals,
  findMagicNumbers,
  findDeadCode,
  findParameterListSmells,
  riskOrder,
  effortOrder,
};
