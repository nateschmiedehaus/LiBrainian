/**
 * @fileoverview Intelligent error explanation system for agents
 *
 * Provides context-aware error explanations by:
 * - Classifying error types
 * - Finding relevant code context
 * - Suggesting likely causes
 * - Proposing fixes with confidence levels
 * - Linking to documentation
 *
 * This module integrates with the LiBrainian storage to provide
 * code-aware error analysis for agents encountering errors.
 */

import type { LiBrainianStorage } from '../storage/types.js';

// ============================================================================
// TYPES
// ============================================================================

export interface ErrorExplanation {
  /** The original error message/string */
  error: string;
  /** Classified error type */
  type: ErrorType;
  /** Human-readable explanation of what this error means */
  explanation: string;
  /** Likely root cause based on error analysis */
  likelyCause: string;
  /** Relevant code snippets from the codebase */
  relevantCode: Array<{
    file: string;
    line: number;
    snippet: string;
    relevance: string;
  }>;
  /** Suggested fixes with confidence levels */
  suggestedFixes: Array<{
    description: string;
    code?: string;
    confidence: number;
  }>;
  /** Related errors that often accompany this one */
  relatedErrors: string[];
  /** Link to relevant documentation */
  documentation?: string;
}

export type ErrorType =
  | 'type_error'
  | 'reference_error'
  | 'syntax_error'
  | 'runtime_error'
  | 'async_error'
  | 'import_error'
  | 'test_failure'
  | 'build_error'
  | 'configuration_error'
  | 'network_error'
  | 'database_error'
  | 'unknown';

export interface ErrorContext {
  /** File where the error occurred */
  file?: string;
  /** Line number of the error */
  line?: number;
  /** Additional context like function name */
  functionName?: string;
  /** Stack trace if available */
  stackTrace?: string;
}

export interface ErrorPatternConfig {
  type: ErrorType;
  explanation: string;
  fixes: string[];
}

// ============================================================================
// ERROR PATTERNS
// ============================================================================

/**
 * Known error patterns with explanations and fix suggestions.
 * Patterns are matched against error messages to provide context-aware help.
 */
export const ERROR_PATTERNS: Record<string, ErrorPatternConfig> = {
  'Cannot find module': {
    type: 'import_error',
    explanation: 'The specified module cannot be found. This usually means the package is not installed or the path is incorrect.',
    fixes: [
      'Run npm install to ensure dependencies are installed',
      'Check the import path for typos',
      'Verify the module exists in node_modules',
      'Check if the module name matches package.json',
    ],
  },
  'is not a function': {
    type: 'type_error',
    explanation: 'Attempting to call something that is not a function. The value might be undefined, null, or a different type.',
    fixes: [
      'Check if the import is correct (named vs default export)',
      "Verify the object has the method you're calling",
      "Check for async timing issues - the value might not be ready yet",
      'Add null checks before calling the function',
    ],
  },
  'Cannot read propert': {
    type: 'type_error',
    explanation: "Trying to access a property on undefined or null. The object doesn't exist or hasn't been initialized.",
    fixes: [
      'Add null/undefined checks before accessing properties',
      'Use optional chaining (?.) for safe property access',
      'Check if async data has loaded before accessing',
      'Verify the variable is properly initialized',
    ],
  },
  'ENOENT': {
    type: 'runtime_error',
    explanation: "File or directory not found. The path doesn't exist on the file system.",
    fixes: [
      'Check if the file path is correct',
      'Ensure the file exists before accessing',
      'Use absolute paths instead of relative',
      'Create the directory/file if it should exist',
    ],
  },
  'ECONNREFUSED': {
    type: 'network_error',
    explanation: 'Connection refused. The server is not running or not accepting connections.',
    fixes: [
      'Check if the server/service is running',
      'Verify the port number is correct',
      'Check firewall settings',
      'Ensure the host address is correct',
    ],
  },
  'ETIMEDOUT': {
    type: 'network_error',
    explanation: 'Connection timed out. The server took too long to respond.',
    fixes: [
      'Check network connectivity',
      'Verify the server is reachable',
      'Increase timeout settings if appropriate',
      'Check for firewall or proxy issues',
    ],
  },
  'async/await': {
    type: 'async_error',
    explanation: 'Async/await related error. Missing await, unhandled promise, or async context issue.',
    fixes: [
      'Add await before async function calls',
      'Wrap async code in async function',
      'Add .catch() to handle promise rejections',
      'Check for missing async keyword on function',
    ],
  },
  'SyntaxError': {
    type: 'syntax_error',
    explanation: 'Invalid JavaScript/TypeScript syntax. Code cannot be parsed.',
    fixes: [
      'Check for missing brackets, parentheses, or semicolons',
      'Verify string quotes are properly closed',
      'Look for invalid characters in the code',
      'Check for incomplete expressions',
    ],
  },
  'Type.*is not assignable': {
    type: 'type_error',
    explanation: "TypeScript type mismatch. The value type doesn't match the expected type.",
    fixes: [
      'Check the function/variable type annotations',
      'Cast the value to the correct type if safe',
      'Update the type definition to accept the value',
      'Use a type guard to narrow the type',
    ],
  },
  'Unexpected token': {
    type: 'syntax_error',
    explanation: 'Parser encountered an unexpected character or keyword.',
    fixes: [
      'Check for JSON parsing errors if parsing JSON',
      'Look for missing commas in objects/arrays',
      'Verify file encoding is UTF-8',
      'Check for copy-paste artifacts',
    ],
  },
  'Maximum call stack': {
    type: 'runtime_error',
    explanation: 'Stack overflow due to infinite recursion or very deep call stack.',
    fixes: [
      'Check for infinite recursive calls',
      'Add base case to recursive functions',
      'Convert recursion to iteration if deep',
      'Check for circular references in data structures',
    ],
  },
  'out of memory': {
    type: 'runtime_error',
    explanation: 'Process ran out of memory. Could be a memory leak or processing too much data.',
    fixes: [
      'Process data in smaller chunks',
      'Increase Node.js memory limit with --max-old-space-size',
      'Check for memory leaks (unreleased event listeners, etc.)',
      'Use streams for large files',
    ],
  },
  'EACCES': {
    type: 'runtime_error',
    explanation: 'Permission denied. The process lacks permission to access the resource.',
    fixes: [
      'Check file/directory permissions',
      'Run with appropriate user permissions',
      'Avoid using ports below 1024 without root',
      'Check if file is locked by another process',
    ],
  },
  'EADDRINUSE': {
    type: 'network_error',
    explanation: 'Port already in use. Another process is using the requested network port.',
    fixes: [
      'Use a different port',
      'Kill the process using the port',
      'Check for zombie processes from previous runs',
      'Use port 0 for automatic port assignment',
    ],
  },
  'Unhandled.*rejection': {
    type: 'async_error',
    explanation: 'A Promise was rejected but no error handler was attached.',
    fixes: [
      'Add .catch() handler to the Promise',
      'Use try/catch with await',
      'Add global unhandledRejection handler',
      'Check async function return values',
    ],
  },
  'SQLITE_BUSY': {
    type: 'database_error',
    explanation: 'SQLite database is locked. Another process or connection is holding a lock.',
    fixes: [
      'Wait and retry the operation',
      'Use WAL mode for better concurrency',
      'Close unused database connections',
      'Check for long-running transactions',
    ],
  },
  'SQLITE_CONSTRAINT': {
    type: 'database_error',
    explanation: 'Database constraint violation. Data violates a schema constraint.',
    fixes: [
      'Check for unique constraint violations',
      'Verify foreign key references exist',
      'Check NOT NULL constraints',
      'Review data before insertion',
    ],
  },
  'expect.*receive': {
    type: 'test_failure',
    explanation: 'Test assertion failed. Expected value did not match received value.',
    fixes: [
      'Check the test expectations are correct',
      'Verify mock return values',
      'Check for async timing issues in tests',
      'Ensure test setup is complete before assertions',
    ],
  },
  'tsc.*error': {
    type: 'build_error',
    explanation: 'TypeScript compilation failed. Type checking found errors.',
    fixes: [
      'Run tsc --noEmit to see all errors',
      'Fix type errors before building',
      'Check tsconfig.json settings',
      'Update type definitions if outdated',
    ],
  },
  'MODULE_NOT_FOUND': {
    type: 'import_error',
    explanation: 'Node.js could not resolve the module path.',
    fixes: [
      'Check if the module is installed',
      'Verify the import path is correct',
      'Check for .js extension in ESM imports',
      'Verify package.json exports field',
    ],
  },
  'ERR_REQUIRE_ESM': {
    type: 'import_error',
    explanation: 'Tried to require() an ES module. ESM modules cannot be loaded with require().',
    fixes: [
      'Use dynamic import() instead of require()',
      'Convert your code to ESM',
      'Check if a CommonJS version of the package exists',
      'Use --experimental-require-module flag in Node 22+',
    ],
  },
};

// ============================================================================
// CORE FUNCTIONS
// ============================================================================

/**
 * Explain an error by classifying it and providing context-aware help.
 *
 * @param error - The error message or string to explain
 * @param storage - LiBrainianStorage instance for code context lookup
 * @param context - Optional context about where the error occurred
 * @returns Promise<ErrorExplanation> with comprehensive error analysis
 *
 * @example
 * ```typescript
 * const explanation = await explainError(
 *   "Cannot read property 'foo' of undefined",
 *   storage,
 *   { file: 'src/api/query.ts', line: 42 }
 * );
 * console.log(explanation.likelyCause);
 * console.log(explanation.suggestedFixes);
 * ```
 */
export async function explainError(
  error: string,
  storage: LiBrainianStorage,
  context?: ErrorContext
): Promise<ErrorExplanation> {
  // Classify the error
  const type = classifyError(error);

  // Find matching pattern
  const pattern = findMatchingPattern(error);

  // Find relevant code
  const relevantCode = await findRelevantCode(storage, error, context);

  // Generate suggested fixes
  const suggestedFixes = generateFixes(error, type, pattern, relevantCode);

  // Infer likely cause
  const likelyCause = inferLikelyCause(error, type, relevantCode, context);

  return {
    error,
    type,
    explanation: pattern?.explanation ?? generateGenericExplanation(type),
    likelyCause,
    relevantCode,
    suggestedFixes,
    relatedErrors: findRelatedErrors(error, type),
    documentation: findDocumentation(type),
  };
}

/**
 * Classify an error string into a specific error type.
 *
 * @param error - The error message to classify
 * @returns The classified ErrorType
 */
export function classifyError(error: string): ErrorType {
  // Check patterns in order of specificity (more specific patterns first)

  // Type errors - includes "is not a function" patterns
  if (/typeerror|type.*is not|not assignable|cannot.*type|is not a function|is not a constructor/i.test(error)) {
    return 'type_error';
  }
  if (/referenceerror|is not defined|cannot find name/i.test(error)) {
    return 'reference_error';
  }
  if (/syntaxerror|unexpected token|unexpected end|parsing error/i.test(error)) {
    return 'syntax_error';
  }
  if (/cannot find module|module not found|err_require|err_module/i.test(error)) {
    return 'import_error';
  }
  if (/econnrefused|etimedout|enotfound|network|getaddrinfo|econnreset|eaddrinuse/i.test(error)) {
    return 'network_error';
  }
  // Runtime errors (file system, permissions) - check BEFORE configuration
  // These are more specific patterns
  if (/enoent|eacces|eperm|file.*not found|no such file|maximum call stack|out of memory/i.test(error)) {
    return 'runtime_error';
  }
  // Configuration errors - patterns that clearly indicate config issues
  if (/configuration|\.env\b|environment\s+variable|missing\s+env|invalid\s+(config|setting)/i.test(error)) {
    return 'configuration_error';
  }
  if (/test.*fail|expect.*receive|assertion|jest|vitest|mocha/i.test(error)) {
    return 'test_failure';
  }
  if (/build.*fail|compile.*error|tsc|webpack|esbuild|rollup/i.test(error)) {
    return 'build_error';
  }
  if (/async|await|promise.*reject|unhandled.*rejection/i.test(error)) {
    return 'async_error';
  }
  if (/sqlite|database|db\b|query|postgres|mysql|mongo/i.test(error)) {
    return 'database_error';
  }

  return 'unknown';
}

/**
 * Find the best matching error pattern.
 *
 * @param error - The error message to match
 * @returns The matching pattern config or null
 */
export function findMatchingPattern(error: string): ErrorPatternConfig | null {
  for (const [pattern, config] of Object.entries(ERROR_PATTERNS)) {
    try {
      if (error.includes(pattern) || new RegExp(pattern, 'i').test(error)) {
        return config;
      }
    } catch {
      // If regex is invalid, try simple string match
      if (error.toLowerCase().includes(pattern.toLowerCase())) {
        return config;
      }
    }
  }
  return null;
}

/**
 * Find relevant code from the storage based on error content.
 *
 * @param storage - LiBrainianStorage for code lookup
 * @param error - The error message
 * @param context - Optional error context
 * @returns Array of relevant code snippets
 */
export async function findRelevantCode(
  storage: LiBrainianStorage,
  error: string,
  context?: ErrorContext
): Promise<ErrorExplanation['relevantCode']> {
  const relevant: ErrorExplanation['relevantCode'] = [];

  // If we have file context, try to get that file's content
  if (context?.file) {
    try {
      const file = await storage.getFileByPath(context.file);
      if (file && context.line) {
        relevant.push({
          file: context.file,
          line: context.line,
          snippet: `[Error location in ${file.name}]`,
          relevance: 'Error location',
        });
      }
    } catch {
      // File lookup failed, continue with other methods
    }
  }

  // Extract identifiers from error message
  const identifiers = extractIdentifiers(error);

  // Search for functions/modules matching identifiers
  for (const id of identifiers.slice(0, 3)) {
    try {
      // Try to find functions by name
      const functions = await storage.getFunctionsByName(id);
      for (const fn of functions.slice(0, 2)) {
        relevant.push({
          file: fn.filePath,
          line: fn.startLine,
          snippet: fn.signature || fn.name,
          relevance: `Definition of ${id}`,
        });
      }
    } catch {
      // Search failed, continue
    }
  }

  return relevant;
}

/**
 * Extract identifiers from an error message.
 *
 * @param error - The error message
 * @returns Array of potential identifiers
 */
export function extractIdentifiers(error: string): string[] {
  const identifiers: string[] = [];

  // Match quoted strings (potential variable/function names)
  const quoted = error.match(/['"`]([^'"`]+)['"`]/g);
  if (quoted) {
    for (const q of quoted) {
      const cleaned = q.slice(1, -1);
      if (cleaned.length > 1 && cleaned.length < 50 && /^[a-zA-Z_]/.test(cleaned)) {
        identifiers.push(cleaned);
      }
    }
  }

  // Match PascalCase/camelCase identifiers
  const camel = error.match(/\b[A-Z][a-z]+[A-Za-z]*\b|\b[a-z]+[A-Z][a-zA-Z]*\b/g);
  if (camel) {
    identifiers.push(...camel);
  }

  // Match file paths
  const paths = error.match(/[a-zA-Z_\-./]+\.(ts|js|tsx|jsx|mjs|cjs)/g);
  if (paths) {
    identifiers.push(...paths);
  }

  // Deduplicate using Array.from for better TypeScript compatibility
  return Array.from(new Set(identifiers));
}

/**
 * Generate suggested fixes based on error analysis.
 *
 * @param error - The error message
 * @param type - The classified error type
 * @param pattern - The matched error pattern
 * @param relevantCode - Relevant code snippets found
 * @returns Array of suggested fixes
 */
export function generateFixes(
  error: string,
  type: ErrorType,
  pattern: ErrorPatternConfig | null,
  relevantCode: ErrorExplanation['relevantCode']
): ErrorExplanation['suggestedFixes'] {
  const fixes: ErrorExplanation['suggestedFixes'] = [];

  // Add pattern-based fixes
  if (pattern) {
    for (const fix of pattern.fixes) {
      fixes.push({ description: fix, confidence: 0.7 });
    }
  }

  // Add type-specific fixes
  switch (type) {
    case 'import_error':
      fixes.push({
        description: 'Install missing package',
        code: 'npm install <package-name>',
        confidence: 0.8,
      });
      if (error.includes('.js')) {
        fixes.push({
          description: 'Add .js extension to ESM imports',
          confidence: 0.75,
        });
      }
      break;

    case 'type_error':
      fixes.push({
        description: 'Add type annotation or assertion',
        confidence: 0.6,
      });
      if (error.includes('undefined')) {
        fixes.push({
          description: 'Add null check or optional chaining',
          code: 'const value = obj?.property ?? defaultValue;',
          confidence: 0.75,
        });
      }
      break;

    case 'async_error':
      fixes.push({
        description: 'Add try-catch around async operation',
        code: 'try { await operation(); } catch (e) { console.error(e); }',
        confidence: 0.7,
      });
      fixes.push({
        description: 'Add await keyword before async call',
        confidence: 0.65,
      });
      break;

    case 'runtime_error':
      if (error.includes('ENOENT')) {
        fixes.push({
          description: 'Check file existence before access',
          code: "import { existsSync } from 'fs';\nif (existsSync(path)) { /* ... */ }",
          confidence: 0.8,
        });
      }
      break;

    case 'network_error':
      fixes.push({
        description: 'Add retry logic for transient failures',
        confidence: 0.65,
      });
      fixes.push({
        description: 'Implement exponential backoff',
        confidence: 0.6,
      });
      break;

    case 'database_error':
      fixes.push({
        description: 'Check database connection settings',
        confidence: 0.7,
      });
      if (error.includes('BUSY')) {
        fixes.push({
          description: 'Enable WAL mode for SQLite',
          code: "PRAGMA journal_mode=WAL;",
          confidence: 0.75,
        });
      }
      break;

    case 'test_failure':
      fixes.push({
        description: 'Verify expected values match actual implementation',
        confidence: 0.7,
      });
      fixes.push({
        description: 'Check for async timing issues in test',
        confidence: 0.6,
      });
      break;

    case 'build_error':
      fixes.push({
        description: 'Run type checker for detailed errors',
        code: 'npx tsc --noEmit',
        confidence: 0.8,
      });
      break;
  }

  // Deduplicate and limit
  const seen = new Set<string>();
  return fixes
    .filter(f => {
      if (seen.has(f.description)) return false;
      seen.add(f.description);
      return true;
    })
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 5);
}

/**
 * Infer the likely cause of an error.
 *
 * @param error - The error message
 * @param type - The classified error type
 * @param relevantCode - Relevant code found
 * @param context - Error context
 * @returns Likely cause string
 */
export function inferLikelyCause(
  error: string,
  type: ErrorType,
  relevantCode: ErrorExplanation['relevantCode'],
  context?: ErrorContext
): string {
  // Check for specific error patterns
  if (error.includes('undefined')) {
    if (error.includes('Cannot read')) {
      return 'A value that was expected to exist is undefined. Check initialization order and async timing.';
    }
    if (error.includes('is not defined')) {
      return 'Variable or function is not in scope. Check imports and variable declarations.';
    }
  }

  if (error.includes('not a function')) {
    return "The value you're trying to call as a function is not callable. Check imports and object types.";
  }

  if (error.includes('ENOENT')) {
    return "The file or directory path doesn't exist. Verify paths and file existence.";
  }

  if (error.includes('ECONNREFUSED')) {
    return 'Connection was actively refused. The service may not be running or is on a different port.';
  }

  // Type-based generic causes
  const typeCauses: Record<ErrorType, string> = {
    type_error: 'Type mismatch or unexpected value type. Review type annotations and value sources.',
    reference_error: 'Reference to undefined variable or function. Check scope and imports.',
    syntax_error: 'Code syntax is invalid. Review recent changes for typos or incomplete statements.',
    runtime_error: 'Runtime exception during code execution. Check resource availability and error handling.',
    async_error: 'Async operation error. Check Promise handling and async/await usage.',
    import_error: 'Module resolution failed. Verify package installation and import paths.',
    test_failure: 'Test assertion failed. Review test expectations and implementation.',
    build_error: 'Build process failed. Check for type errors and configuration issues.',
    configuration_error: 'Configuration issue. Review environment variables and config files.',
    network_error: 'Network operation failed. Check connectivity, URLs, and service availability.',
    database_error: 'Database operation failed. Check connection, queries, and constraints.',
    unknown: 'Unknown cause. Review the error message and stack trace for more details.',
  };

  return typeCauses[type];
}

/**
 * Find related errors that commonly occur together.
 *
 * @param error - The error message
 * @param type - The classified error type
 * @returns Array of related error descriptions
 */
export function findRelatedErrors(error: string, type: ErrorType): string[] {
  const related: string[] = [];

  if (type === 'type_error') {
    if (error.includes('undefined')) {
      related.push('Check imports at the top of the file');
      related.push('Related: ReferenceError if variable is completely missing');
    }
    if (error.includes('is not a function')) {
      related.push('Related: TypeError when object shape is wrong');
    }
  }

  if (type === 'import_error') {
    related.push('Related: Build errors if imports fail during compilation');
    related.push('Related: Runtime errors if dynamic imports fail');
  }

  if (type === 'async_error') {
    related.push('Related: Unhandled promise rejections may mask underlying errors');
    related.push('Related: Test timeouts if async operations hang');
  }

  if (type === 'database_error') {
    related.push('Related: Connection errors may precede query errors');
    related.push('Related: Constraint violations may indicate data issues');
  }

  return related;
}

/**
 * Generate a generic explanation for an error type.
 *
 * @param type - The error type
 * @returns Generic explanation string
 */
export function generateGenericExplanation(type: ErrorType): string {
  const explanations: Record<ErrorType, string> = {
    type_error: 'A type error occurred. The code attempted an operation with an incompatible type.',
    reference_error: 'A reference error occurred. The code referenced a variable or function that does not exist.',
    syntax_error: 'A syntax error occurred. The code contains invalid JavaScript/TypeScript syntax.',
    runtime_error: 'A runtime error occurred during code execution.',
    async_error: 'An async/await or Promise error occurred.',
    import_error: 'A module import error occurred. The requested module could not be found or loaded.',
    test_failure: 'A test assertion failed. The actual value did not match the expected value.',
    build_error: 'A build error occurred during compilation or bundling.',
    configuration_error: 'A configuration error occurred. Check environment and config settings.',
    network_error: 'A network error occurred. Check connectivity and remote service status.',
    database_error: 'A database error occurred. Check connection and query syntax.',
    unknown: 'An error occurred. Review the error message for specific details.',
  };

  return explanations[type];
}

/**
 * Find documentation URL for an error type.
 *
 * @param type - The error type
 * @returns Documentation URL or undefined
 */
export function findDocumentation(type: ErrorType): string | undefined {
  const docs: Record<ErrorType, string | undefined> = {
    type_error: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/TypeError',
    reference_error: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/ReferenceError',
    syntax_error: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SyntaxError',
    import_error: 'https://nodejs.org/api/errors.html#module_not_found',
    async_error: 'https://developer.mozilla.org/en-US/docs/Learn/JavaScript/Asynchronous',
    runtime_error: 'https://nodejs.org/api/errors.html',
    test_failure: undefined,
    build_error: undefined,
    configuration_error: undefined,
    network_error: 'https://nodejs.org/api/errors.html#nodejs-error-codes',
    database_error: undefined,
    unknown: undefined,
  };

  return docs[type];
}

// ============================================================================
// QUERY INTEGRATION
// ============================================================================

/**
 * Error explanation query patterns for detection.
 * These patterns identify queries that are asking for error explanation.
 */
export const ERROR_EXPLANATION_PATTERNS: RegExp[] = [
  /^explain\s+(this\s+)?error/i,
  /^what\s+does\s+(this\s+)?error\s+mean/i,
  /^why\s+(am\s+I|did\s+I|do\s+I)\s+(get|getting|have|see)/i,
  /^help\s+(me\s+)?(understand|fix|debug)/i,
  /^how\s+(do\s+I|to)\s+fix/i,
  /error.*explanation/i,
  /debug\s+(this|the)\s+error/i,
  /what('s| is)\s+causing/i,
];

/**
 * Check if a query is asking for error explanation.
 *
 * @param intent - The query intent string
 * @returns true if the query is asking for error explanation
 */
export function isErrorExplanationQuery(intent: string): boolean {
  return ERROR_EXPLANATION_PATTERNS.some(pattern => pattern.test(intent));
}

/**
 * Extract the error string from an error explanation query.
 *
 * @param intent - The query intent string
 * @returns The extracted error string or the full intent if not found
 */
export function extractErrorFromQuery(intent: string): string {
  // Try to extract quoted error message
  const quotedMatch = intent.match(/['"`]([^'"`]+)['"`]/);
  if (quotedMatch) {
    return quotedMatch[1];
  }

  // Try to extract error after colon
  const colonMatch = intent.match(/error[:\s]+(.+)$/i);
  if (colonMatch) {
    return colonMatch[1].trim();
  }

  // Try to extract after "explain" keyword
  const explainMatch = intent.match(/explain\s+(?:this\s+)?(?:error\s*)?[:\s]*(.+)$/i);
  if (explainMatch) {
    return explainMatch[1].trim();
  }

  // Return the whole intent if we can't extract
  return intent;
}

// ============================================================================
// CONTEXT PACK INTEGRATION
// ============================================================================

import type { ContextPack, LiBrainianVersion, CodeSnippet } from '../types.js';

/**
 * Stage result for error explanation queries.
 */
export interface ErrorExplanationStageResult {
  /** Whether error explanation was performed */
  analyzed: boolean;
  /** Context packs containing the explanation */
  packs: ContextPack[];
  /** Human-readable explanation for the stage report */
  explanation: string;
  /** The full error explanation object */
  errorExplanation?: ErrorExplanation;
}

/**
 * Options for running the error explanation stage.
 */
export interface ErrorExplanationStageOptions {
  storage: LiBrainianStorage;
  intent: string;
  version: LiBrainianVersion;
  context?: ErrorContext;
}

/**
 * Run the error explanation stage of the query pipeline.
 * Creates context packs from error analysis.
 *
 * @param options - Stage options
 * @returns Stage result with context packs
 */
export async function runErrorExplanationStage(
  options: ErrorExplanationStageOptions
): Promise<ErrorExplanationStageResult> {
  const { storage, intent, version, context } = options;

  // Check if this is an error explanation query
  if (!isErrorExplanationQuery(intent)) {
    return {
      analyzed: false,
      packs: [],
      explanation: 'Not an error explanation query.',
    };
  }

  // Extract the error from the query
  const errorString = extractErrorFromQuery(intent);
  if (!errorString || errorString === intent) {
    return {
      analyzed: false,
      packs: [],
      explanation: 'Could not extract error message from query.',
    };
  }

  // Get the full error explanation
  const errorExplanation = await explainError(errorString, storage, context);

  // Create the main explanation pack
  const mainPack = createErrorExplanationPack(errorExplanation, version);

  // Create code context packs for relevant code
  const codePacks = createRelevantCodePacks(errorExplanation, version);

  return {
    analyzed: true,
    packs: [mainPack, ...codePacks],
    explanation: `Error explanation generated: ${errorExplanation.type} - ${errorExplanation.likelyCause}`,
    errorExplanation,
  };
}

/**
 * Create a context pack from an error explanation.
 *
 * @param explanation - The error explanation
 * @param version - LiBrainian version
 * @returns Context pack containing the explanation
 */
export function createErrorExplanationPack(
  explanation: ErrorExplanation,
  version: LiBrainianVersion
): ContextPack {
  const keyFacts: string[] = [
    `Error Type: ${explanation.type}`,
    `Likely Cause: ${explanation.likelyCause}`,
    ...explanation.suggestedFixes.slice(0, 3).map((f, i) => `Fix ${i + 1}: ${f.description}`),
  ];

  if (explanation.documentation) {
    keyFacts.push(`Documentation: ${explanation.documentation}`);
  }

  if (explanation.relatedErrors.length > 0) {
    keyFacts.push(`Related: ${explanation.relatedErrors[0]}`);
  }

  // Create code snippets from suggested fixes with code
  const codeSnippets: CodeSnippet[] = explanation.suggestedFixes
    .filter(f => f.code)
    .map(f => ({
      filePath: 'suggestion',
      startLine: 1,
      endLine: f.code!.split('\n').length,
      content: f.code!,
      language: 'typescript',
    }));

  return {
    packId: `err_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    packType: 'function_context', // Use existing pack type for compatibility
    targetId: `error:${explanation.type}`,
    summary: formatErrorSummary(explanation),
    keyFacts,
    codeSnippets,
    relatedFiles: explanation.relevantCode.map(r => r.file),
    confidence: 0.85,
    createdAt: new Date(),
    accessCount: 0,
    lastOutcome: 'unknown',
    successCount: 0,
    failureCount: 0,
    version,
    invalidationTriggers: [],
  };
}

/**
 * Create context packs for relevant code from error explanation.
 *
 * @param explanation - The error explanation
 * @param version - LiBrainian version
 * @returns Array of context packs for relevant code
 */
export function createRelevantCodePacks(
  explanation: ErrorExplanation,
  version: LiBrainianVersion
): ContextPack[] {
  return explanation.relevantCode.slice(0, 3).map((code, index) => ({
    packId: `err_code_${Date.now()}_${index}`,
    packType: 'function_context',
    targetId: `error_code:${code.file}:${code.line}`,
    summary: `Relevant code: ${code.relevance}`,
    keyFacts: [
      `File: ${code.file}`,
      `Line: ${code.line}`,
      `Relevance: ${code.relevance}`,
    ],
    codeSnippets: code.snippet ? [{
      filePath: code.file,
      startLine: code.line,
      endLine: code.line + (code.snippet.split('\n').length - 1),
      content: code.snippet,
      language: 'typescript',
    }] : [],
    relatedFiles: [code.file],
    confidence: 0.7,
    createdAt: new Date(),
    accessCount: 0,
    lastOutcome: 'unknown',
    successCount: 0,
    failureCount: 0,
    version,
    invalidationTriggers: [code.file],
  }));
}

/**
 * Format error explanation as a human-readable summary.
 *
 * @param explanation - The error explanation
 * @returns Formatted summary string
 */
export function formatErrorSummary(explanation: ErrorExplanation): string {
  const parts: string[] = [
    `**Error:** ${explanation.error}`,
    '',
    `**Type:** ${explanation.type}`,
    '',
    `**Explanation:** ${explanation.explanation}`,
    '',
    `**Likely Cause:** ${explanation.likelyCause}`,
  ];

  if (explanation.suggestedFixes.length > 0) {
    parts.push('', '**Suggested Fixes:**');
    for (const fix of explanation.suggestedFixes.slice(0, 5)) {
      const confidence = Math.round(fix.confidence * 100);
      parts.push(`- ${fix.description} (${confidence}% confidence)`);
      if (fix.code) {
        parts.push(`  \`\`\`\n  ${fix.code}\n  \`\`\``);
      }
    }
  }

  if (explanation.documentation) {
    parts.push('', `**Documentation:** ${explanation.documentation}`);
  }

  return parts.join('\n');
}
