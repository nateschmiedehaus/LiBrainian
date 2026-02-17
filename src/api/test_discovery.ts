/**
 * @fileoverview Test Discovery for Class-Based Queries
 *
 * This module enhances test file discovery by searching for class references
 * in test files, not just path-based naming conventions.
 *
 * For queries like "tests for SqliteLibrarianStorage", this module:
 * 1. Finds test files by naming convention (e.g., SqliteLibrarianStorage.test.ts)
 * 2. Greps all test files for references to the class name
 * 3. Returns both convention-matched and reference-matched test files
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { glob } from 'glob';

const DEFAULT_TEST_DISCOVERY_MAX_FILES = 2000;
const DEFAULT_TEST_DISCOVERY_MAX_FILES_TEST = 2000;
const DEFAULT_TEST_DISCOVERY_BUDGET_MS = 15000;
const DEFAULT_TEST_DISCOVERY_BUDGET_MS_TEST = 15000;
const DEFAULT_TEST_DISCOVERY_CACHE_TTL_MS = 2 * 60 * 1000;
const DEFAULT_TEST_DISCOVERY_MAX_CACHED_FILE_BYTES = 200 * 1024;

function readEnvNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isUnitTestMode(): boolean {
  return process.env.NODE_ENV === 'test' || process.env.LIBRARIAN_TEST_MODE === 'unit';
}

function getTestDiscoverySettings(): {
  maxFiles: number;
  timeBudgetMs: number;
  cacheTtlMs: number;
  cacheEnabled: boolean;
  maxCachedFileBytes: number;
} {
  const isUnit = isUnitTestMode();
  const maxFiles = Math.max(
    1,
    readEnvNumber(
      'LIBRARIAN_TEST_DISCOVERY_MAX_FILES',
      isUnit ? DEFAULT_TEST_DISCOVERY_MAX_FILES_TEST : DEFAULT_TEST_DISCOVERY_MAX_FILES
    )
  );
  const timeBudgetRaw = readEnvNumber(
    'LIBRARIAN_TEST_DISCOVERY_BUDGET_MS',
    isUnit ? DEFAULT_TEST_DISCOVERY_BUDGET_MS_TEST : DEFAULT_TEST_DISCOVERY_BUDGET_MS
  );
  const timeBudgetMs = timeBudgetRaw <= 0 ? Number.POSITIVE_INFINITY : timeBudgetRaw;
  const cacheTtlMs = Math.max(0, readEnvNumber('LIBRARIAN_TEST_DISCOVERY_CACHE_TTL_MS', DEFAULT_TEST_DISCOVERY_CACHE_TTL_MS));
  const cacheEnabled = process.env.LIBRARIAN_TEST_DISCOVERY_CACHE_DISABLED !== '1' && cacheTtlMs > 0;
  const maxCachedFileBytes = Math.max(
    0,
    readEnvNumber('LIBRARIAN_TEST_DISCOVERY_MAX_CACHED_BYTES', DEFAULT_TEST_DISCOVERY_MAX_CACHED_FILE_BYTES)
  );
  return { maxFiles, timeBudgetMs, cacheTtlMs, cacheEnabled, maxCachedFileBytes };
}

type TestFileListCacheEntry = { at: number; files: string[] };
const testFileListCache = new Map<string, TestFileListCacheEntry>();
const testFileContentCache = new Map<string, Map<string, string>>();

// ============================================================================
// TYPES
// ============================================================================

/**
 * Result of test discovery for a class or symbol.
 */
export interface TestDiscoveryResult {
  /** Test files that were found */
  testFiles: string[];
  /** Test functions that reference the target (extracted from test files) */
  testFunctions: string[];
  /** Coverage status based on number and type of tests found */
  coverageStatus: 'full' | 'partial' | 'none';
  /** How the tests were discovered */
  discoveryMethod: 'naming_convention' | 'class_reference' | 'both' | 'none';
}

/**
 * Result of detecting if a query is asking about tests.
 */
export interface TestQueryDetection {
  /** Whether this appears to be a test query */
  isTestQuery: boolean;
  /** The target class/function/module name extracted from the query */
  target?: string;
  /** Confidence in the detection (0-1) */
  confidence: number;
}

// ============================================================================
// TEST QUERY DETECTION
// ============================================================================

/**
 * Patterns that detect test queries and extract the target name.
 * Each pattern should capture the target in group 1.
 */
const TEST_QUERY_PATTERNS: RegExp[] = [
  // "tests for SqliteLibrarianStorage" -> "SqliteLibrarianStorage"
  /tests?\s+(?:for|of|covering)\s+(\w+)/i,
  // "SqliteLibrarianStorage tests" -> "SqliteLibrarianStorage"
  /(\w+)\s+tests?$/i,
  // "test files for SqliteLibrarianStorage" -> "SqliteLibrarianStorage"
  /test\s+(?:files?|coverage)\s+(?:for|of)\s+(\w+)/i,
  // "unit tests for SqliteLibrarianStorage" -> "SqliteLibrarianStorage"
  /unit\s+tests?\s+(?:for|in)\s+(\w+)/i,
  // "integration tests for SymbolTable" -> "SymbolTable"
  /integration\s+tests?\s+(?:for|of)\s+(\w+)/i,
  // "find tests for X" -> "X"
  /find\s+tests?\s+(?:for|of)\s+(\w+)/i,
  // "what tests X" -> "X"
  /what\s+tests?\s+(?:cover|test)\s+(\w+)/i,
  // "show tests for X" -> "X"
  /show\s+tests?\s+(?:for|of)\s+(\w+)/i,
];

/**
 * Words that should not be treated as targets (too generic).
 */
const EXCLUDED_TARGETS = new Set([
  'the', 'a', 'an', 'this', 'that', 'it',
  'file', 'files', 'module', 'modules', 'class', 'classes',
  'function', 'functions', 'method', 'methods',
  'code', 'source', 'test', 'tests',
]);

/**
 * Detects if a query is asking about tests and extracts the target.
 */
export function detectTestQuery(intent: string): TestQueryDetection {
  const normalizedIntent = intent.trim();

  for (const pattern of TEST_QUERY_PATTERNS) {
    const match = normalizedIntent.match(pattern);
    if (match && match[1]) {
      const target = match[1];

      // Skip generic words
      if (EXCLUDED_TARGETS.has(target.toLowerCase())) {
        continue;
      }

      // Higher confidence for PascalCase (likely class names)
      const isPascalCase = /^[A-Z][a-zA-Z0-9]*$/.test(target);
      const confidence = isPascalCase ? 0.95 : 0.85;

      return {
        isTestQuery: true,
        target,
        confidence,
      };
    }
  }

  return {
    isTestQuery: false,
    confidence: 0.9, // High confidence it's NOT a test query
  };
}

// ============================================================================
// TEST FILE DISCOVERY
// ============================================================================

/**
 * Finds test files for a given class/symbol name.
 *
 * This function uses two strategies:
 * 1. Naming convention: Find test files that include the class name in the filename
 * 2. Content search: Grep all test files for references to the class name
 *
 * @param workspace - The workspace root directory
 * @param className - The class/symbol name to find tests for
 * @returns TestDiscoveryResult with found test files
 */
export async function findTestsForClass(
  workspace: string,
  className: string
): Promise<TestDiscoveryResult> {
  const results: Set<string> = new Set();
  let hasConventionMatches = false;
  let hasReferenceMatches = false;
  const settings = getTestDiscoverySettings();

  // Strategy 1: Find test files by naming convention
  // Look for files like ClassName.test.ts or class_name.test.ts
  const conventionPatterns = [
    `**/__tests__/**/*${className}*.test.ts`,
    `**/__tests__/**/*${className}*.test.tsx`,
    `**/__tests__/**/*${className}*.spec.ts`,
    `**/${className}.test.ts`,
    `**/${className}.spec.ts`,
    `**/${className.toLowerCase()}.test.ts`,
    `**/${toSnakeCase(className)}.test.ts`,
    `**/${toKebabCase(className)}.test.ts`,
  ];

  for (const pattern of conventionPatterns) {
    try {
      const matches = await glob(pattern, {
        cwd: workspace,
        ignore: ['node_modules/**', '**/node_modules/**'],
        nodir: true,
      });

      for (const match of matches) {
        results.add(match);
        hasConventionMatches = true;
      }
    } catch {
      // Continue with other patterns if one fails
    }
  }

  // Strategy 2: Search for class references in all test files
  // This catches tests that test the class but aren't named after it
  try {
    const cacheKey = workspace;
    const now = Date.now();
    let allFiles: string[] = [];
    const cachedList = settings.cacheEnabled ? testFileListCache.get(cacheKey) : undefined;
    if (cachedList && now - cachedList.at < settings.cacheTtlMs) {
      allFiles = cachedList.files;
    } else {
      const allTestFiles = await glob('**/*.test.ts', {
        cwd: workspace,
        ignore: ['node_modules/**', '**/node_modules/**'],
        nodir: true,
      });

      // Also include spec files and __tests__ directories
      const specFiles = await glob('**/*.spec.ts', {
        cwd: workspace,
        ignore: ['node_modules/**', '**/node_modules/**'],
        nodir: true,
      });

      const testDirFiles = await glob('**/__tests__/**/*.ts', {
        cwd: workspace,
        ignore: ['node_modules/**', '**/node_modules/**'],
        nodir: true,
      });

      allFiles = Array.from(new Set([...allTestFiles, ...specFiles, ...testDirFiles])).sort();
      if (settings.cacheEnabled) {
        testFileListCache.set(cacheKey, { at: now, files: allFiles });
        testFileContentCache.delete(cacheKey);
      }
    }

    const contentCache = settings.cacheEnabled
      ? (testFileContentCache.get(cacheKey) ?? new Map<string, string>())
      : new Map<string, string>();
    if (settings.cacheEnabled && !testFileContentCache.has(cacheKey)) {
      testFileContentCache.set(cacheKey, contentCache);
    }

    const classPattern = new RegExp(`\\b${escapeRegExp(className)}\\b`);
    const classTokens = new Set([
      className.toLowerCase(),
      toSnakeCase(className),
      toKebabCase(className),
      ...splitPascalCase(className).map((token) => token.toLowerCase()),
    ].filter((token) => token.length >= 3));
    const orderedFiles = allFiles
      .map((file) => {
        const lower = file.toLowerCase();
        let score = 0;
        for (const token of classTokens) {
          if (lower.includes(token)) {
            score += 1;
          }
        }
        return { file, score };
      })
      .sort((a, b) => {
        if (b.score !== a.score) {
          return b.score - a.score;
        }
        return a.file.localeCompare(b.file);
      })
      .map((item) => item.file);
    const scanStart = Date.now();
    let scanned = 0;

    // Read each test file and check for class references
    for (const testFile of orderedFiles) {
      // Skip if already found via convention
      if (results.has(testFile)) {
        continue;
      }
      if (scanned >= settings.maxFiles) {
        break;
      }
      if (Date.now() - scanStart > settings.timeBudgetMs) {
        break;
      }
      scanned += 1;

      try {
        const fullPath = path.join(workspace, testFile);
        let content = contentCache.get(testFile);
        if (content === undefined) {
          content = await fs.readFile(fullPath, 'utf-8');
          if (settings.cacheEnabled && content.length <= settings.maxCachedFileBytes) {
            contentCache.set(testFile, content);
          }
        }

        // Check if the file contains the class name
        // Use word boundary to avoid partial matches
        if (classPattern.test(content)) {
          results.add(testFile);
          hasReferenceMatches = true;
        }
      } catch {
        // Skip files that can't be read
      }
    }
  } catch {
    // Continue even if glob fails
  }

  // Extract test function names from found test files
  const testFunctions = await extractTestFunctions(workspace, Array.from(results), className);

  // Determine discovery method
  let discoveryMethod: TestDiscoveryResult['discoveryMethod'] = 'none';
  if (hasConventionMatches && hasReferenceMatches) {
    discoveryMethod = 'both';
  } else if (hasConventionMatches) {
    discoveryMethod = 'naming_convention';
  } else if (hasReferenceMatches) {
    discoveryMethod = 'class_reference';
  }

  // Determine coverage status
  let coverageStatus: TestDiscoveryResult['coverageStatus'] = 'none';
  if (results.size > 0) {
    // Consider 'full' if we have multiple test files or many test functions
    if (results.size >= 3 || testFunctions.length >= 5) {
      coverageStatus = 'full';
    } else {
      coverageStatus = 'partial';
    }
  }

  return {
    testFiles: Array.from(results).sort(),
    testFunctions,
    coverageStatus,
    discoveryMethod,
  };
}

/**
 * Extracts test function names from test files that reference the target class.
 */
async function extractTestFunctions(
  workspace: string,
  testFiles: string[],
  className: string
): Promise<string[]> {
  const testFunctions: string[] = [];

  // Patterns for test function definitions
  const testPatterns = [
    // Jest/Vitest: it('description', ...)
    /\bit\s*\(\s*['"`]([^'"`]+)['"`]/g,
    // Jest/Vitest: test('description', ...)
    /\btest\s*\(\s*['"`]([^'"`]+)['"`]/g,
    // describe blocks that mention the class
    /\bdescribe\s*\(\s*['"`]([^'"`]+)['"`]/g,
  ];

  const classPattern = new RegExp(escapeRegExp(className), 'i');

  for (const testFile of testFiles) {
    try {
      const fullPath = path.join(workspace, testFile);
      const content = await fs.readFile(fullPath, 'utf-8');

      // Check if this file is relevant to the class
      if (!classPattern.test(content)) {
        continue;
      }

      for (const pattern of testPatterns) {
        let match;
        // Reset regex lastIndex for each file
        pattern.lastIndex = 0;
        while ((match = pattern.exec(content)) !== null) {
          const testName = match[1];
          if (testName) {
            testFunctions.push(testName);
          }
        }
      }
    } catch {
      // Skip files that can't be read
    }
  }

  // Deduplicate and limit results
  return Array.from(new Set(testFunctions)).slice(0, 50);
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Converts PascalCase to snake_case.
 */
function toSnakeCase(str: string): string {
  return str
    .replace(/([A-Z])/g, '_$1')
    .toLowerCase()
    .replace(/^_/, '');
}

/**
 * Converts PascalCase to kebab-case.
 */
function toKebabCase(str: string): string {
  return str
    .replace(/([A-Z])/g, '-$1')
    .toLowerCase()
    .replace(/^-/, '');
}

/**
 * Escapes special regex characters in a string.
 */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function splitPascalCase(str: string): string[] {
  return str
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[\s_-]+/)
    .filter(Boolean);
}
