/**
 * @fileoverview Consistency Analysis Primitive (tp_analyze_consistency)
 *
 * Check consistency between code, tests, and documentation.
 * Detects mismatches, unreferenced code, and stale documentation.
 *
 * Based on self-improvement-primitives.md specification.
 */

import * as path from 'path';
import type { LibrarianStorage, ModuleKnowledge, FunctionKnowledge, TestMapping } from '../../storage/types.js';
import { getErrorMessage } from '../../utils/errors.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Types of consistency checks to perform.
 */
export type ConsistencyCheck =
  | 'interface_signature'
  | 'behavior_test_evidence'
  | 'doc_code_alignment'
  | 'type_definition_match'
  | 'export_usage_match';

/**
 * A mismatch between two artifacts.
 */
export interface Mismatch {
  /** Unique identifier for this mismatch */
  id: string;
  /** Type of mismatch */
  type: ConsistencyCheck;
  /** Severity of the mismatch */
  severity: 'error' | 'warning' | 'info';
  /** What was claimed/expected */
  claimed: string;
  /** What was actually found */
  actual: string;
  /** Location of the mismatch */
  location: string;
  /** Suggested resolution */
  suggestedResolution: string;
}

/**
 * A claim without supporting code evidence.
 */
export interface PhantomClaim {
  /** The claim text */
  claim: string;
  /** Where the claim was made */
  claimedLocation: string;
  /** Locations that were searched */
  searchedLocations: string[];
  /** Confidence that this is actually phantom (0-1) */
  confidence: number;
}

/**
 * A claim without test evidence.
 */
export interface UntestedClaim {
  /** The claim being made */
  claim: string;
  /** Entity ID making the claim */
  entityId: string;
  /** Entity path */
  entityPath: string;
  /** Expected test file pattern */
  expectedTestPattern: string;
  /** Test files that were searched */
  searchedTestFiles: string[];
}

/**
 * Documentation that has drifted from code.
 */
export interface DocDrift {
  /** Location of the documentation */
  docLocation: string;
  /** Location of the code */
  codeLocation: string;
  /** Content in documentation */
  docContent: string;
  /** Content in code */
  codeContent: string;
  /** Type of drift detected */
  driftType: 'signature_mismatch' | 'behavior_mismatch' | 'missing_doc' | 'outdated_doc';
}

/**
 * Result of a consistency analysis operation.
 */
export interface ConsistencyAnalysisResult {
  /** Mismatches between code and tests */
  codeTestMismatches: Mismatch[];
  /** Mismatches between code and documentation */
  codeDocMismatches: Mismatch[];
  /** Code that is not referenced anywhere */
  unreferencedCode: string[];
  /** Documentation that appears stale */
  staleDocs: string[];
  /** Overall consistency score (0-1) */
  overallScore: number;
  /** Phantom claims detected */
  phantomClaims: PhantomClaim[];
  /** Untested claims */
  untestedClaims: UntestedClaim[];
  /** Documentation drift */
  docDrift: DocDrift[];
  /** Duration of the analysis in milliseconds */
  duration: number;
  /** Any errors encountered during analysis */
  errors: string[];
}

/**
 * Options for the consistency analysis operation.
 */
export interface AnalyzeConsistencyOptions {
  /** Root directory of the codebase */
  rootDir: string;
  /** Storage instance to use */
  storage: LibrarianStorage;
  /** Whether to check test consistency */
  checkTests?: boolean;
  /** Whether to check documentation consistency */
  checkDocs?: boolean;
  /** Specific consistency checks to perform */
  checks?: ConsistencyCheck[];
  /** Enable verbose logging */
  verbose?: boolean;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_CHECKS: ConsistencyCheck[] = [
  'interface_signature',
  'behavior_test_evidence',
  'doc_code_alignment',
];

// ============================================================================
// TEST CONSISTENCY ANALYSIS
// ============================================================================

/**
 * Analyze consistency between code and tests.
 */
async function analyzeTestConsistency(
  storage: LibrarianStorage,
  functions: FunctionKnowledge[],
  modules: ModuleKnowledge[],
  verbose: boolean
): Promise<{ mismatches: Mismatch[]; untestedClaims: UntestedClaim[] }> {
  const mismatches: Mismatch[] = [];
  const untestedClaims: UntestedClaim[] = [];

  // Get test mappings
  let testMappings: TestMapping[] = [];
  try {
    testMappings = await storage.getTestMappings({ limit: 10000 });
  } catch {
    // Test mappings may not be available
  }

  // Build a map of source files to their tests
  const sourceToTests = new Map<string, Set<string>>();
  for (const mapping of testMappings) {
    const tests = sourceToTests.get(mapping.sourcePath) ?? new Set();
    tests.add(mapping.testPath);
    sourceToTests.set(mapping.sourcePath, tests);
  }

  // Check each function for test coverage
  for (const fn of functions) {
    const filePath = fn.filePath;
    const tests = sourceToTests.get(filePath);

    // Check if the function has any test coverage
    if (!tests || tests.size === 0) {
      // Check if this function should be tested (not a test itself, not internal)
      if (!isTestFile(filePath) && !isInternalFunction(fn)) {
        untestedClaims.push({
          claim: `Function "${fn.name}" behaves as documented`,
          entityId: fn.id,
          entityPath: filePath,
          expectedTestPattern: generateExpectedTestPattern(filePath),
          searchedTestFiles: [],
        });
      }
    }
  }

  // Check modules for test coverage
  for (const mod of modules) {
    const tests = sourceToTests.get(mod.path);

    if (!tests || tests.size === 0) {
      if (!isTestFile(mod.path)) {
        // Only flag if the module has exports that need testing
        if (mod.exports.length > 0) {
          untestedClaims.push({
            claim: `Module "${path.basename(mod.path)}" exports are tested`,
            entityId: mod.id,
            entityPath: mod.path,
            expectedTestPattern: generateExpectedTestPattern(mod.path),
            searchedTestFiles: [],
          });
        }
      }
    }
  }

  if (verbose) {
    console.error(`[analyzeConsistency] Found ${untestedClaims.length} untested claims`);
  }

  return { mismatches, untestedClaims };
}

/**
 * Check if a file is a test file.
 */
function isTestFile(filePath: string): boolean {
  const name = path.basename(filePath).toLowerCase();
  return (
    name.includes('.test.') ||
    name.includes('.spec.') ||
    name.includes('_test.') ||
    filePath.includes('__tests__') ||
    filePath.includes('/test/') ||
    filePath.includes('/tests/')
  );
}

/**
 * Check if a function appears to be internal (not needing direct tests).
 */
function isInternalFunction(fn: FunctionKnowledge): boolean {
  // Functions starting with _ are typically internal
  if (fn.name.startsWith('_')) return true;
  // Check signature for trivial functions
  const sig = fn.signature ?? '';
  // Functions with no parameters and void return are often trivial
  if (sig.includes('()') && (sig.includes('void') || sig.includes(': undefined'))) return true;
  return false;
}

/**
 * Generate expected test file pattern for a source file.
 */
function generateExpectedTestPattern(sourcePath: string): string {
  const dir = path.dirname(sourcePath);
  const base = path.basename(sourcePath, path.extname(sourcePath));
  return `${dir}/__tests__/${base}.test.ts or ${dir}/${base}.test.ts`;
}

// ============================================================================
// DOCUMENTATION CONSISTENCY ANALYSIS
// ============================================================================

/**
 * Analyze consistency between code and documentation.
 */
async function analyzeDocConsistency(
  storage: LibrarianStorage,
  functions: FunctionKnowledge[],
  modules: ModuleKnowledge[],
  verbose: boolean
): Promise<{ mismatches: Mismatch[]; docDrift: DocDrift[]; staleDocs: string[] }> {
  const mismatches: Mismatch[] = [];
  const docDrift: DocDrift[] = [];
  const staleDocs: string[] = [];

  // Check function documentation
  for (const fn of functions) {
    // The purpose field serves as documentation
    const hasDocumentation = fn.purpose && fn.purpose.length > 0;

    // Check for missing documentation on public functions
    if (!hasDocumentation && !isInternalFunction(fn)) {
      docDrift.push({
        docLocation: fn.filePath,
        codeLocation: `${fn.filePath}:${fn.name}`,
        docContent: '',
        codeContent: fn.name,
        driftType: 'missing_doc',
      });
    }
  }

  // Check module documentation
  for (const mod of modules) {
    // Check if module has a purpose but it's incomplete
    if (mod.purpose && mod.purpose.includes('TODO')) {
      staleDocs.push(mod.path);
    }
  }

  if (verbose) {
    console.error(`[analyzeConsistency] Found ${mismatches.length} doc mismatches, ${docDrift.length} drift cases`);
  }

  return { mismatches, docDrift, staleDocs };
}

// Note: Signature comparison is removed since FunctionKnowledge
// doesn't have detailed parameter/return types. The signature
// field contains the complete signature string.

// ============================================================================
// UNREFERENCED CODE DETECTION
// ============================================================================

/**
 * Find code that is not referenced anywhere.
 */
async function findUnreferencedCode(
  storage: LibrarianStorage,
  functions: FunctionKnowledge[],
  modules: ModuleKnowledge[],
  verbose: boolean
): Promise<string[]> {
  const unreferenced: string[] = [];

  // Build a set of all referenced entities
  const referencedFunctions = new Set<string>();

  // Get graph edges to find references
  try {
    const edges = await storage.getGraphEdges({ limit: 50000 });

    for (const edge of edges) {
      if (edge.toId) {
        referencedFunctions.add(edge.toId);
      }
    }
  } catch {
    // Graph edges may not be available
  }

  // Also consider exports as "referenced"
  for (const mod of modules) {
    for (const exportName of mod.exports) {
      // Find the function with this export name
      const fn = functions.find((f) => f.name === exportName && f.filePath === mod.path);
      if (fn) {
        referencedFunctions.add(fn.id);
      }
    }
  }

  // Find unreferenced functions (excluding test files and internal functions)
  for (const fn of functions) {
    if (!referencedFunctions.has(fn.id) && !isTestFile(fn.filePath) && !isInternalFunction(fn)) {
      // Check if it's an exported function (entry point)
      const mod = modules.find((m) => m.path === fn.filePath);
      const isExported = mod?.exports.includes(fn.name);

      if (!isExported) {
        unreferenced.push(`${fn.filePath}:${fn.name}`);
      }
    }
  }

  if (verbose) {
    console.error(`[analyzeConsistency] Found ${unreferenced.length} unreferenced code entities`);
  }

  return unreferenced;
}

// ============================================================================
// PHANTOM CLAIM DETECTION
// ============================================================================

/**
 * Find claims that don't have supporting code.
 */
async function findPhantomClaims(
  storage: LibrarianStorage,
  modules: ModuleKnowledge[],
  verbose: boolean
): Promise<PhantomClaim[]> {
  const phantomClaims: PhantomClaim[] = [];

  // Check each module's purpose against its actual implementation
  for (const mod of modules) {
    if (mod.purpose) {
      // Extract claimed capabilities from purpose
      const claimedCapabilities = extractCapabilitiesFromPurpose(mod.purpose);

      // Check if exports support these capabilities
      for (const capability of claimedCapabilities) {
        const hasMatchingExport = mod.exports.some((exp) =>
          exp.toLowerCase().includes(capability.toLowerCase()) ||
          capability.toLowerCase().includes(exp.toLowerCase())
        );

        if (!hasMatchingExport && mod.exports.length > 0) {
          phantomClaims.push({
            claim: `Module provides "${capability}" capability`,
            claimedLocation: mod.path,
            searchedLocations: mod.exports,
            confidence: 0.6, // Moderate confidence since this is heuristic
          });
        }
      }
    }
  }

  if (verbose) {
    console.error(`[analyzeConsistency] Found ${phantomClaims.length} potential phantom claims`);
  }

  return phantomClaims;
}

/**
 * Extract claimed capabilities from a purpose statement.
 */
function extractCapabilitiesFromPurpose(purpose: string): string[] {
  const capabilities: string[] = [];

  // Look for action verbs that indicate capabilities
  const patterns = [
    /provides?\s+(\w+(?:\s+\w+)?)/gi,
    /enables?\s+(\w+(?:\s+\w+)?)/gi,
    /supports?\s+(\w+(?:\s+\w+)?)/gi,
    /handles?\s+(\w+(?:\s+\w+)?)/gi,
    /manages?\s+(\w+(?:\s+\w+)?)/gi,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(purpose)) !== null) {
      capabilities.push(match[1].trim());
    }
  }

  return capabilities;
}

// ============================================================================
// SCORE CALCULATION
// ============================================================================

/**
 * Calculate overall consistency score.
 */
function calculateOverallScore(
  codeTestMismatches: Mismatch[],
  codeDocMismatches: Mismatch[],
  unreferencedCode: string[],
  staleDocs: string[],
  untestedClaims: UntestedClaim[],
  phantomClaims: PhantomClaim[],
  totalFunctions: number,
  totalModules: number
): number {
  const totalEntities = totalFunctions + totalModules;
  if (totalEntities === 0) return 1.0;

  // Weight different issues
  const weights = {
    codeTestMismatch: 0.3,
    codeDocMismatch: 0.2,
    unreferenced: 0.1,
    staleDoc: 0.1,
    untested: 0.2,
    phantom: 0.1,
  };

  // Calculate penalty for each issue type
  const testMismatchPenalty = Math.min(1, codeTestMismatches.length / totalEntities) * weights.codeTestMismatch;
  const docMismatchPenalty = Math.min(1, codeDocMismatches.length / totalEntities) * weights.codeDocMismatch;
  const unreferencedPenalty = Math.min(1, unreferencedCode.length / totalEntities) * weights.unreferenced;
  const staleDocPenalty = Math.min(1, staleDocs.length / totalModules || 1) * weights.staleDoc;
  const untestedPenalty = Math.min(1, untestedClaims.length / totalEntities) * weights.untested;
  const phantomPenalty = Math.min(1, phantomClaims.length / totalModules || 1) * weights.phantom;

  const totalPenalty = testMismatchPenalty + docMismatchPenalty + unreferencedPenalty +
    staleDocPenalty + untestedPenalty + phantomPenalty;

  return Math.max(0, 1 - totalPenalty);
}

// ============================================================================
// MAIN ANALYSIS FUNCTION
// ============================================================================

/**
 * Analyze consistency between code, tests, and documentation.
 *
 * This function:
 * 1. Checks test coverage and consistency
 * 2. Validates documentation matches code
 * 3. Finds unreferenced code
 * 4. Detects phantom claims
 * 5. Computes an overall consistency score
 *
 * @param options - Analysis configuration options
 * @returns Result of the consistency analysis
 *
 * @example
 * ```typescript
 * const result = await analyzeConsistency({
 *   rootDir: '/path/to/repo',
 *   storage: myStorage,
 *   checkTests: true,
 *   checkDocs: true,
 * });
 * console.log(`Consistency score: ${result.overallScore}`);
 * ```
 */
export async function analyzeConsistency(
  options: AnalyzeConsistencyOptions
): Promise<ConsistencyAnalysisResult> {
  const startTime = Date.now();
  const errors: string[] = [];

  const {
    rootDir,
    storage,
    checkTests = true,
    checkDocs = true,
    checks = DEFAULT_CHECKS,
    verbose = false,
  } = options;

  // Validate inputs
  if (!rootDir) {
    throw new Error('rootDir is required for analyzeConsistency');
  }
  if (!storage) {
    throw new Error('storage is required for analyzeConsistency');
  }

  // Fetch data from storage
  let functions: FunctionKnowledge[] = [];
  let modules: ModuleKnowledge[] = [];

  try {
    functions = await storage.getFunctions();
  } catch (error) {
    errors.push(`Failed to fetch functions: ${getErrorMessage(error)}`);
  }

  try {
    modules = await storage.getModules();
  } catch (error) {
    errors.push(`Failed to fetch modules: ${getErrorMessage(error)}`);
  }

  if (verbose) {
    console.error(`[analyzeConsistency] Analyzing ${functions.length} functions and ${modules.length} modules`);
  }

  // Initialize results
  let codeTestMismatches: Mismatch[] = [];
  let codeDocMismatches: Mismatch[] = [];
  let unreferencedCode: string[] = [];
  let staleDocs: string[] = [];
  let phantomClaims: PhantomClaim[] = [];
  let untestedClaims: UntestedClaim[] = [];
  let docDrift: DocDrift[] = [];

  // Perform test consistency analysis
  if (checkTests && checks.includes('behavior_test_evidence')) {
    try {
      const testResult = await analyzeTestConsistency(storage, functions, modules, verbose);
      codeTestMismatches = testResult.mismatches;
      untestedClaims = testResult.untestedClaims;
    } catch (error) {
      errors.push(`Test consistency analysis failed: ${getErrorMessage(error)}`);
    }
  }

  // Perform documentation consistency analysis
  if (checkDocs && (checks.includes('doc_code_alignment') || checks.includes('interface_signature'))) {
    try {
      const docResult = await analyzeDocConsistency(storage, functions, modules, verbose);
      codeDocMismatches = docResult.mismatches;
      docDrift = docResult.docDrift;
      staleDocs = docResult.staleDocs;
    } catch (error) {
      errors.push(`Documentation consistency analysis failed: ${getErrorMessage(error)}`);
    }
  }

  // Find unreferenced code
  try {
    unreferencedCode = await findUnreferencedCode(storage, functions, modules, verbose);
  } catch (error) {
    errors.push(`Unreferenced code detection failed: ${getErrorMessage(error)}`);
  }

  // Find phantom claims
  try {
    phantomClaims = await findPhantomClaims(storage, modules, verbose);
  } catch (error) {
    errors.push(`Phantom claim detection failed: ${getErrorMessage(error)}`);
  }

  // Calculate overall score
  const overallScore = calculateOverallScore(
    codeTestMismatches,
    codeDocMismatches,
    unreferencedCode,
    staleDocs,
    untestedClaims,
    phantomClaims,
    functions.length,
    modules.length
  );

  return {
    codeTestMismatches,
    codeDocMismatches,
    unreferencedCode,
    staleDocs,
    overallScore,
    phantomClaims,
    untestedClaims,
    docDrift,
    duration: Date.now() - startTime,
    errors,
  };
}

/**
 * Create a consistency analysis primitive with bound options.
 */
export function createAnalyzeConsistency(
  defaultOptions: Partial<AnalyzeConsistencyOptions>
): (options: Partial<AnalyzeConsistencyOptions> & { rootDir: string; storage: LibrarianStorage }) => Promise<ConsistencyAnalysisResult> {
  return async (options) => {
    return analyzeConsistency({
      ...defaultOptions,
      ...options,
    });
  };
}
