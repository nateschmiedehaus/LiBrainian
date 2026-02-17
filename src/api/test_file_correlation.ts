/**
 * @fileoverview Test File Correlation for Librarian Query System
 *
 * This module implements deterministic test file discovery based on path correlation.
 * When a user queries "tests for X", this module finds test files through:
 * 1. Naming conventions (foo.ts -> foo.test.ts, foo.spec.ts)
 * 2. Directory conventions (__tests__/foo.ts, tests/foo.ts)
 * 3. Stored test mappings from the test indexer
 * 4. Class reference search (grep for class name in test files)
 *
 * This approach is deterministic and reliable, unlike semantic search which
 * may match on irrelevant keywords like "coverage" instead of actual test files.
 */

import * as path from 'node:path';
import { getLanguageFromPath } from '../utils/language.js';
import type { LibrarianStorage, TestMapping } from '../storage/types.js';
import type { ContextPack, FunctionKnowledge, ModuleKnowledge } from '../types.js';
import { detectTestQuery, findTestsForClass, type TestDiscoveryResult } from './test_discovery.js';

// ============================================================================
// TEST QUERY DETECTION
// ============================================================================

/**
 * Patterns that indicate a query is asking about test files for a source file.
 */
const TEST_QUERY_PATTERNS = [
  /\btests?\s+for\s+/i,
  /\btest\s+files?\s+for\s+/i,
  /\btesting\s+/i,
  /\bwhat\s+tests?\s+/i,
  /\bwhich\s+tests?\s+/i,
  /\bfind\s+tests?\s+/i,
  /\bshow\s+tests?\s+/i,
  /\btest\s+coverage\s+for\s+/i,
  /\bspec\s+files?\s+for\s+/i,
  /\bunit\s+tests?\s+for\s+/i,
  /\bintegration\s+tests?\s+for\s+/i,
];

/**
 * Patterns to extract the target file from a test query.
 */
const TARGET_FILE_PATTERNS = [
  // "tests for query.ts" -> "query.ts"
  /\btests?\s+for\s+([a-zA-Z0-9_\-./]+\.[a-zA-Z]+)/i,
  // "test files for bootstrap" -> "bootstrap"
  /\btest\s+files?\s+for\s+([a-zA-Z0-9_\-./]+)/i,
  // "tests for the query module" -> "query"
  /\btests?\s+for\s+(?:the\s+)?([a-zA-Z0-9_\-]+)(?:\s+module|\s+file|\s+class)?$/i,
  // "tests for bootstrap" without module/file suffix -> "bootstrap"
  /\btests?\s+for\s+([a-zA-Z0-9_\-]+)$/i,
  // "what tests query.ts" -> "query.ts"
  /\bwhat\s+tests?\s+(?:cover\s+)?([a-zA-Z0-9_\-./]+)/i,
  // "find tests for bootstrap" -> "bootstrap"
  /\bfind\s+tests?\s+for\s+([a-zA-Z0-9_\-./]+)/i,
];

/**
 * Result of test query classification.
 */
export interface TestQueryClassification {
  /** Whether this query is asking about test files */
  isTestQuery: boolean;
  /** The target file/module name extracted from the query */
  targetFile: string | null;
  /** Confidence in the classification (0-1) */
  confidence: number;
  /** Explanation of how the query was classified */
  explanation: string;
}

/**
 * Classifies a query intent to determine if it's asking about test files.
 */
export function classifyTestQuery(intent: string): TestQueryClassification {
  // Check if any test query pattern matches
  const matchingPatterns = TEST_QUERY_PATTERNS.filter(p => p.test(intent));

  if (matchingPatterns.length === 0) {
    return {
      isTestQuery: false,
      targetFile: null,
      confidence: 0.9, // High confidence it's NOT a test query
      explanation: 'No test query patterns matched.',
    };
  }

  // Try to extract the target file
  let targetFile: string | null = null;
  for (const pattern of TARGET_FILE_PATTERNS) {
    const match = intent.match(pattern);
    if (match && match[1]) {
      targetFile = match[1];
      break;
    }
  }

  const confidence = targetFile ? 0.95 : 0.7; // Higher confidence if we found a target

  return {
    isTestQuery: true,
    targetFile,
    confidence,
    explanation: targetFile
      ? `Test query detected for target: "${targetFile}"`
      : 'Test query detected but no specific target file identified.',
  };
}

// ============================================================================
// TEST FILE NAMING CONVENTIONS
// ============================================================================

/**
 * Common test file naming conventions.
 * Maps a source file path to potential test file paths.
 */
export interface TestFilePattern {
  /** Pattern name for debugging */
  name: string;
  /** Generate potential test file paths from a source path */
  generateTestPaths: (sourcePath: string, sourceDir: string, baseName: string) => string[];
}

/**
 * Standard test file naming conventions across ecosystems.
 */
export const TEST_FILE_PATTERNS: TestFilePattern[] = [
  {
    name: 'sibling_test',
    // foo.ts -> foo.test.ts
    generateTestPaths: (_, sourceDir, baseName) => [
      path.join(sourceDir, `${baseName}.test.ts`),
      path.join(sourceDir, `${baseName}.test.tsx`),
      path.join(sourceDir, `${baseName}.test.js`),
      path.join(sourceDir, `${baseName}.test.jsx`),
    ],
  },
  {
    name: 'sibling_spec',
    // foo.ts -> foo.spec.ts
    generateTestPaths: (_, sourceDir, baseName) => [
      path.join(sourceDir, `${baseName}.spec.ts`),
      path.join(sourceDir, `${baseName}.spec.tsx`),
      path.join(sourceDir, `${baseName}.spec.js`),
      path.join(sourceDir, `${baseName}.spec.jsx`),
    ],
  },
  {
    name: '__tests__',
    // foo.ts -> __tests__/foo.ts or __tests__/foo.test.ts
    generateTestPaths: (_, sourceDir, baseName) => [
      path.join(sourceDir, '__tests__', `${baseName}.ts`),
      path.join(sourceDir, '__tests__', `${baseName}.tsx`),
      path.join(sourceDir, '__tests__', `${baseName}.test.ts`),
      path.join(sourceDir, '__tests__', `${baseName}.test.tsx`),
      path.join(sourceDir, '__tests__', `${baseName}.spec.ts`),
    ],
  },
  {
    name: 'tests_directory',
    // src/api/foo.ts -> tests/api/foo.ts or test/api/foo.ts
    generateTestPaths: (sourcePath, _, baseName) => {
      const results: string[] = [];
      // Match paths starting with or containing "src/"
      const srcMatch = sourcePath.match(/^(.*?)src[/\\](.*)$/);
      if (srcMatch) {
        const prefix = srcMatch[1] || ''; // May be empty for "src/..." paths
        const afterSrc = srcMatch[2]; // e.g., "api/query.ts"
        const dir = path.dirname(afterSrc); // e.g., "api"
        for (const testDir of ['tests', 'test', '__tests__']) {
          const testBase = prefix ? path.join(prefix, testDir) : testDir;
          results.push(
            path.join(testBase, dir, `${baseName}.ts`),
            path.join(testBase, dir, `${baseName}.test.ts`),
            path.join(testBase, dir, `${baseName}.spec.ts`),
          );
        }
      }
      return results;
    },
  },
  {
    name: 'suffix_patterns',
    // query.ts -> query_test.ts, query-test.ts
    generateTestPaths: (_, sourceDir, baseName) => [
      path.join(sourceDir, `${baseName}_test.ts`),
      path.join(sourceDir, `${baseName}-test.ts`),
      path.join(sourceDir, `${baseName}_spec.ts`),
      path.join(sourceDir, `${baseName}-spec.ts`),
    ],
  },
];

// ============================================================================
// TEST FILE CORRELATION
// ============================================================================

/**
 * Result of finding test files for a source file.
 */
export interface TestCorrelationResult {
  /** The source file path that was queried */
  sourcePath: string;
  /** Test files found through path correlation */
  correlatedTests: CorrelatedTestFile[];
  /** Test files found through stored mappings (from test indexer) */
  indexedTests: TestMapping[];
  /** Total unique test files found */
  totalTestFiles: number;
  /** Explanation of how tests were found */
  explanation: string;
}

/**
 * A test file correlated to a source file.
 */
export interface CorrelatedTestFile {
  /** Test file path (relative to workspace) */
  testPath: string;
  /** How the test was correlated */
  correlationType: 'naming_convention' | 'directory_convention' | 'indexed_mapping';
  /** Confidence in the correlation (0-1) */
  confidence: number;
  /** The pattern that matched (for debugging) */
  patternName: string;
}

/**
 * Options for test file correlation.
 */
export interface TestCorrelationOptions {
  /** Workspace root for resolving paths */
  workspaceRoot?: string;
  /** Maximum test files to return */
  maxResults?: number;
  /** Include tests from indexed mappings */
  includeIndexed?: boolean;
  /** Function to check if a file exists */
  fileExists?: (path: string) => Promise<boolean>;
}

/**
 * Finds test files for a given source file using path correlation.
 * This is a deterministic approach that doesn't rely on semantic search.
 */
export async function correlateTestFiles(
  sourcePath: string,
  storage: LibrarianStorage,
  options: TestCorrelationOptions = {}
): Promise<TestCorrelationResult> {
  const maxResults = options.maxResults ?? 20;
  const includeIndexed = options.includeIndexed ?? true;

  // Normalize the source path
  const normalizedPath = sourcePath.replace(/\\/g, '/');
  const sourceDir = path.dirname(normalizedPath);
  const sourceFile = path.basename(normalizedPath);
  const baseName = sourceFile.replace(/\.[^/.]+$/, ''); // Remove extension
  const extension = path.extname(sourceFile);

  const correlatedTests: CorrelatedTestFile[] = [];
  const seenPaths = new Set<string>();

  // Generate potential test file paths using naming conventions
  for (const pattern of TEST_FILE_PATTERNS) {
    const candidates = pattern.generateTestPaths(normalizedPath, sourceDir, baseName);
    for (const candidate of candidates) {
      const normalizedCandidate = candidate.replace(/\\/g, '/');
      if (seenPaths.has(normalizedCandidate)) continue;

      // Check if the file exists in the indexed files
      const fileKnowledge = await storage.getFileByPath(normalizedCandidate);
      if (fileKnowledge) {
        seenPaths.add(normalizedCandidate);
        correlatedTests.push({
          testPath: normalizedCandidate,
          correlationType: pattern.name.includes('__tests__') ? 'directory_convention' : 'naming_convention',
          confidence: 0.9,
          patternName: pattern.name,
        });
      }
    }
  }

  // Also try fuzzy matching on the base name in indexed test files
  const allFiles = await storage.getFiles({ category: 'test', limit: 500 });
  for (const file of allFiles) {
    if (seenPaths.has(file.relativePath)) continue;

    // Check if this test file matches our source file by name
    const testBaseName = path.basename(file.relativePath).replace(/\.(test|spec)\.[^/.]+$/, '').replace(/\.[^/.]+$/, '');
    if (testBaseName.toLowerCase() === baseName.toLowerCase()) {
      seenPaths.add(file.relativePath);
      correlatedTests.push({
        testPath: file.relativePath,
        correlationType: 'naming_convention',
        confidence: 0.8,
        patternName: 'fuzzy_name_match',
      });
    }
  }

  // Get indexed test mappings from the test indexer
  let indexedTests: TestMapping[] = [];
  if (includeIndexed) {
    try {
      indexedTests = await storage.getTestMappingsBySourcePath(normalizedPath);

      // Also try without leading slash or with different path formats
      if (indexedTests.length === 0) {
        const alternativePaths = [
          normalizedPath.replace(/^\//, ''),
          normalizedPath.replace(/^\.\//, ''),
          `/${normalizedPath}`,
          `./${normalizedPath}`,
        ];
        for (const altPath of alternativePaths) {
          const altMappings = await storage.getTestMappingsBySourcePath(altPath);
          if (altMappings.length > 0) {
            indexedTests = altMappings;
            break;
          }
        }
      }
    } catch {
      // Storage might not support test mappings
      indexedTests = [];
    }

    // Add indexed tests to correlatedTests if not already present
    for (const mapping of indexedTests) {
      if (!seenPaths.has(mapping.testPath)) {
        seenPaths.add(mapping.testPath);
        correlatedTests.push({
          testPath: mapping.testPath,
          correlationType: 'indexed_mapping',
          confidence: mapping.confidence,
          patternName: 'test_indexer',
        });
      }
    }
  }

  // Sort by confidence (highest first) and limit results
  correlatedTests.sort((a, b) => b.confidence - a.confidence);
  const limitedTests = correlatedTests.slice(0, maxResults);

  // Build explanation
  const explanationParts: string[] = [];
  if (limitedTests.length > 0) {
    const byType = {
      naming: limitedTests.filter(t => t.correlationType === 'naming_convention').length,
      directory: limitedTests.filter(t => t.correlationType === 'directory_convention').length,
      indexed: limitedTests.filter(t => t.correlationType === 'indexed_mapping').length,
    };
    if (byType.naming > 0) explanationParts.push(`${byType.naming} via naming conventions`);
    if (byType.directory > 0) explanationParts.push(`${byType.directory} via directory conventions`);
    if (byType.indexed > 0) explanationParts.push(`${byType.indexed} via indexed mappings`);
  } else {
    explanationParts.push('No test files found through path correlation');
  }

  return {
    sourcePath: normalizedPath,
    correlatedTests: limitedTests,
    indexedTests,
    totalTestFiles: limitedTests.length,
    explanation: `Found ${limitedTests.length} test file(s) for ${baseName}${extension}: ${explanationParts.join(', ')}.`,
  };
}

// ============================================================================
// TEST FILE LOOKUP BY PATTERN MATCHING
// ============================================================================

/**
 * Finds test files by searching for files matching a pattern.
 * Used when the query mentions a file name without a full path.
 */
export async function findTestFilesByPattern(
  pattern: string,
  storage: LibrarianStorage,
  options: { maxResults?: number } = {}
): Promise<CorrelatedTestFile[]> {
  const maxResults = options.maxResults ?? 20;
  const results: CorrelatedTestFile[] = [];

  // Normalize the pattern (remove extension, lowercase for comparison)
  const normalizedPattern = pattern
    .replace(/\.(ts|tsx|js|jsx)$/, '')
    .toLowerCase();

  // Search in indexed test files
  const testFiles = await storage.getFiles({ category: 'test', limit: 500 });

  for (const file of testFiles) {
    const fileName = path.basename(file.relativePath);
    const testBaseName = fileName
      .replace(/\.(test|spec)\.[^/.]+$/, '')
      .replace(/\.[^/.]+$/, '')
      .toLowerCase();

    // Check if the test file name contains or matches the pattern
    if (testBaseName === normalizedPattern || testBaseName.includes(normalizedPattern)) {
      results.push({
        testPath: file.relativePath,
        correlationType: 'naming_convention',
        confidence: testBaseName === normalizedPattern ? 0.95 : 0.7,
        patternName: testBaseName === normalizedPattern ? 'exact_name_match' : 'partial_name_match',
      });
    }
  }

  // Sort by confidence and limit
  results.sort((a, b) => b.confidence - a.confidence);
  return results.slice(0, maxResults);
}

// ============================================================================
// CONTEXT PACK GENERATION FOR TEST FILES
// ============================================================================

/**
 * Creates context packs for correlated test files.
 */
export async function createTestContextPacks(
  correlation: TestCorrelationResult,
  storage: LibrarianStorage
): Promise<ContextPack[]> {
  const packs: ContextPack[] = [];

  for (const testFile of correlation.correlatedTests) {
    // Try to get existing context pack for this test file
    const existingPack = await storage.getContextPackForTarget(testFile.testPath, 'function_context');
    if (existingPack) {
      packs.push(existingPack);
      continue;
    }

    // Get file knowledge for the test file
    const fileKnowledge = await storage.getFileByPath(testFile.testPath);
    if (!fileKnowledge) continue;

    // Get function knowledge for functions in this test file
    const functions = await storage.getFunctionsByPath(testFile.testPath);

    // Determine language from file extension
    const language = getLanguageFromPath(testFile.testPath, 'unknown');

    // Create a context pack for this test file
    // Use 'function_context' as the pack type since test files are functions
    const pack: ContextPack = {
      packId: `test_correlation:${testFile.testPath}`,
      packType: 'function_context',
      targetId: testFile.testPath,
      summary: `Test file for ${correlation.sourcePath}: ${fileKnowledge.purpose || fileKnowledge.summary || testFile.testPath}`,
      keyFacts: [
        `Test correlation type: ${testFile.correlationType}`,
        `Pattern: ${testFile.patternName}`,
        `Contains ${functions.length} test function(s)`,
        ...functions.slice(0, 5).map(f => `- ${f.name}: ${f.purpose || f.signature}`),
      ],
      relatedFiles: [testFile.testPath, correlation.sourcePath],
      codeSnippets: functions.slice(0, 3).map(f => ({
        filePath: testFile.testPath,
        startLine: f.startLine,
        endLine: Math.min(f.endLine, f.startLine + 20), // Limit snippet size
        content: '', // Would need to read file content
        language,
      })),
      confidence: testFile.confidence,
      accessCount: 0,
      lastOutcome: 'unknown' as const,
      successCount: 0,
      failureCount: 0,
      version: { major: 0, minor: 0, patch: 0, string: '0.0.0', qualityTier: 'mvp' as const, indexedAt: new Date(), indexerVersion: 'test', features: [] },
      createdAt: new Date(),
      invalidationTriggers: [correlation.sourcePath],
    };

    packs.push(pack);
  }

  return packs;
}

// ============================================================================
// INTEGRATION WITH QUERY PIPELINE
// ============================================================================

/**
 * Result of running the test correlation stage in the query pipeline.
 */
export interface TestCorrelationStageResult {
  /** Whether this was a test query */
  isTestQuery: boolean;
  /** Test context packs to include in results */
  testPacks: ContextPack[];
  /** Correlation result (if this was a test query) */
  correlation: TestCorrelationResult | null;
  /** Explanation for the stage results */
  explanation: string;
}

/**
 * Runs the test file correlation stage of the query pipeline.
 * This stage should run early to provide deterministic test file results
 * before semantic search adds potentially irrelevant matches.
 *
 * Enhanced to support class-based discovery: when the target looks like a
 * class name (PascalCase), we also grep test files for references to that class.
 */
export async function runTestCorrelationStage(options: {
  intent: string;
  affectedFiles?: string[];
  storage: LibrarianStorage;
  workspaceRoot?: string;
}): Promise<TestCorrelationStageResult> {
  const { intent, affectedFiles, storage, workspaceRoot } = options;

  // Classify the query using the original classifier
  const classification = classifyTestQuery(intent);

  // Also try the enhanced class-based detection
  const classDetection = detectTestQuery(intent);

  if (!classification.isTestQuery && !classDetection.isTestQuery) {
    return {
      isTestQuery: false,
      testPacks: [],
      correlation: null,
      explanation: 'Not a test query.',
    };
  }

  // Determine the target - prefer class-based detection for PascalCase targets
  const target = classDetection.target || classification.targetFile;

  // Check if target looks like a class name (PascalCase)
  const isPascalCase = target ? /^[A-Z][a-zA-Z0-9]*$/.test(target) : false;

  // If we have a workspace root and the target looks like a class name,
  // use class-based discovery (grep for class references in test files)
  if (workspaceRoot && target && isPascalCase) {
    try {
      const classDiscovery = await findTestsForClass(workspaceRoot, target);

      if (classDiscovery.testFiles.length > 0) {
        // Create packs for discovered test files
        const testPacks = await createTestPacksFromDiscovery(
          classDiscovery,
          target,
          storage
        );

        return {
          isTestQuery: true,
          testPacks,
          correlation: null,
          explanation: `Found ${classDiscovery.testFiles.length} test file(s) for class "${target}" via ${classDiscovery.discoveryMethod}. Coverage: ${classDiscovery.coverageStatus}.`,
        };
      }
    } catch {
      // Fall through to path-based correlation if class discovery fails
    }
  }

  // Fall back to path-based correlation for file targets
  let targetFiles: string[] = [];

  // Use extracted target file from query if available
  if (classification.targetFile) {
    targetFiles.push(classification.targetFile);
  }

  // Also use affected files if provided
  if (affectedFiles && affectedFiles.length > 0) {
    targetFiles.push(...affectedFiles);
  }

  // If we still don't have a target, try pattern matching
  if (targetFiles.length === 0 && classification.targetFile) {
    const patternMatches = await findTestFilesByPattern(classification.targetFile, storage);
    if (patternMatches.length > 0) {
      return {
        isTestQuery: true,
        testPacks: [], // Would need to create packs from pattern matches
        correlation: null,
        explanation: `Found ${patternMatches.length} test files matching pattern "${classification.targetFile}".`,
      };
    }
  }

  // Find tests for each target file
  const allCorrelations: TestCorrelationResult[] = [];
  const allPacks: ContextPack[] = [];

  for (const targetFile of targetFiles) {
    // Try to resolve full path if we only have a file name
    let resolvedPath = targetFile;
    if (!targetFile.includes('/') && !targetFile.includes('\\')) {
      // Search for files matching this name
      const allFiles = await storage.getFiles({ limit: 1000 });
      const matchingFiles = allFiles.filter(f =>
        path.basename(f.relativePath).replace(/\.[^/.]+$/, '') === targetFile.replace(/\.[^/.]+$/, '')
      );
      if (matchingFiles.length > 0) {
        resolvedPath = matchingFiles[0]!.relativePath;
      }
    }

    const correlation = await correlateTestFiles(resolvedPath, storage);
    allCorrelations.push(correlation);

    const packs = await createTestContextPacks(correlation, storage);
    allPacks.push(...packs);
  }

  // Combine results
  const totalTests = allCorrelations.reduce((sum, c) => sum + c.totalTestFiles, 0);
  const explanations = allCorrelations.map(c => c.explanation);

  return {
    isTestQuery: true,
    testPacks: allPacks,
    correlation: allCorrelations.length === 1 ? allCorrelations[0]! : null,
    explanation: totalTests > 0
      ? `Test correlation found ${totalTests} test file(s). ${explanations.join(' ')}`
      : `No test files found through path correlation. ${explanations.join(' ')}`,
  };
}

/**
 * Creates context packs from class-based test discovery results.
 */
async function createTestPacksFromDiscovery(
  discovery: TestDiscoveryResult,
  className: string,
  storage: LibrarianStorage
): Promise<ContextPack[]> {
  const packs: ContextPack[] = [];

  for (const testFile of discovery.testFiles) {
    // Try to get existing context pack for this test file
    const existingPack = await storage.getContextPackForTarget(testFile, 'function_context');
    if (existingPack) {
      packs.push(existingPack);
      continue;
    }

    // Get file knowledge for the test file
    const fileKnowledge = await storage.getFileByPath(testFile);

    // Get function knowledge for functions in this test file
    let functions: FunctionKnowledge[] = [];
    try {
      functions = await storage.getFunctionsByPath(testFile);
    } catch {
      // Storage might not support this method
    }

    // Determine language from file extension
    const extension = path.extname(testFile);
    const language = extension === '.ts' || extension === '.tsx' ? 'typescript'
      : extension === '.js' || extension === '.jsx' ? 'javascript'
      : 'unknown';

    // Create a context pack for this test file
    const pack: ContextPack = {
      packId: `test_discovery:${className}:${testFile}`,
      packType: 'function_context',
      targetId: testFile,
      summary: `Test file for ${className}: ${fileKnowledge?.purpose || fileKnowledge?.summary || testFile}`,
      keyFacts: [
        `Found via ${discovery.discoveryMethod} discovery for class "${className}"`,
        `Coverage status: ${discovery.coverageStatus}`,
        `Contains ${functions.length} test function(s)`,
        ...functions.slice(0, 5).map(f => `- ${f.name}: ${f.purpose || f.signature}`),
      ],
      relatedFiles: [testFile],
      codeSnippets: functions.slice(0, 3).map(f => ({
        filePath: testFile,
        startLine: f.startLine,
        endLine: Math.min(f.endLine, f.startLine + 20),
        content: '',
        language,
      })),
      confidence: discovery.discoveryMethod === 'class_reference' ? 0.9 : 0.85,
      accessCount: 0,
      lastOutcome: 'unknown' as const,
      successCount: 0,
      failureCount: 0,
      version: { major: 0, minor: 0, patch: 0, string: '0.0.0', qualityTier: 'mvp' as const, indexedAt: new Date(), indexerVersion: 'test', features: [] },
      createdAt: new Date(),
      invalidationTriggers: [],
    };

    packs.push(pack);
  }

  return packs;
}
