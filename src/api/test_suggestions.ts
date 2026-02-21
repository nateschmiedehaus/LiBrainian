/**
 * @fileoverview Test Suggestion System for Agents
 *
 * This module provides intelligent test suggestions for code, helping agents
 * ensure quality by identifying what tests should be written for a given
 * function, file, or module.
 *
 * Features:
 * - Analyzes function signatures, parameters, and content
 * - Generates test scenarios for happy paths, error cases, and edge cases
 * - Identifies mock requirements based on dependencies
 * - Suggests test file locations based on project conventions
 * - Prioritizes functions by importance (exported > complex > private)
 *
 * Usage:
 * ```typescript
 * const suggestions = await suggestTests(storage, 'src/api/query.ts');
 * // Returns TestSuggestion[] with scenarios and mock requirements
 * ```
 */

import type { LiBrainianStorage, GraphEdge } from '../storage/types.js';
import type { FunctionKnowledge } from '../types.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * A complete test suggestion for a function.
 */
export interface TestSuggestion {
  /** Name of the function to test */
  targetFunction: string;
  /** Source file containing the function */
  file: string;
  /** Suggested test file path */
  testFile: string;
  /** Type of test recommended */
  testType: 'unit' | 'integration' | 'e2e';
  /** Test scenarios to implement */
  scenarios: TestScenario[];
  /** Dependencies that should be mocked */
  mockRequirements: MockRequirement[];
  /** Suggested setup code for the test file */
  setupCode?: string;
  /** Priority for testing this function */
  priority: 'critical' | 'high' | 'medium' | 'low';
  /** Explanation of why these tests are suggested */
  rationale: string;
}

/**
 * A specific test scenario to implement.
 */
export interface TestScenario {
  /** Name for the test case */
  name: string;
  /** Description of what this scenario tests */
  description: string;
  /** Example input for the test */
  input: string;
  /** Expected output or behavior */
  expectedOutput: string;
  /** Generated test code template */
  testCode: string;
  /** Category of the scenario */
  category: 'happy_path' | 'error_handling' | 'edge_case' | 'async' | 'boundary';
}

/**
 * A dependency that should be mocked in tests.
 */
export interface MockRequirement {
  /** Name of the dependency */
  dependency: string;
  /** Type of mock to create */
  mockType: 'function' | 'module' | 'class' | 'constant';
  /** Suggested mock implementation */
  suggestion: string;
  /** Why this dependency should be mocked */
  reason: string;
}

/**
 * Options for generating test suggestions.
 */
export interface TestSuggestionOptions {
  /** Include private functions (default: false) */
  includePrivate?: boolean;
  /** Maximum number of scenarios per function (default: 5) */
  maxScenariosPerFunction?: number;
  /** Minimum complexity for inclusion (default: 0) */
  minComplexity?: number;
}

/**
 * Query classification for test suggestion queries.
 */
export interface TestSuggestionQueryClassification {
  /** Whether this is a test suggestion query */
  isTestSuggestionQuery: boolean;
  /** Target file or function to suggest tests for */
  target: string | null;
  /** Confidence in the classification */
  confidence: number;
  /** Explanation of classification */
  explanation: string;
}

// ============================================================================
// QUERY CLASSIFICATION
// ============================================================================

/**
 * Patterns that indicate a test suggestion query.
 */
const TEST_SUGGESTION_PATTERNS = [
  /what\s+tests?\s+should\s+(?:I|we)\s+write\s+for/i,
  /suggest\s+tests?\s+for/i,
  /generate\s+tests?\s+for/i,
  /tests?\s+(?:suggestions?|recommendations?)\s+for/i,
  /what\s+(?:should\s+be|needs?\s+to\s+be)\s+tested\s+in/i,
  /how\s+should\s+(?:I|we)\s+test/i,
  /test\s+cases?\s+for/i,
  /testing\s+(?:strategy|plan)\s+for/i,
];

/**
 * Patterns to extract target from test suggestion query.
 */
const TARGET_EXTRACTION_PATTERNS = [
  // "what tests should I write for X" -> X
  /what\s+tests?\s+should\s+(?:I|we)\s+write\s+for\s+([a-zA-Z0-9_\-./]+)/i,
  // "suggest tests for X" -> X
  /suggest\s+tests?\s+for\s+([a-zA-Z0-9_\-./]+)/i,
  // "generate tests for X" -> X
  /generate\s+tests?\s+for\s+([a-zA-Z0-9_\-./]+)/i,
  // "test suggestions for X" -> X
  /tests?\s+suggestions?\s+for\s+([a-zA-Z0-9_\-./]+)/i,
  // "test recommendations for X" -> X
  /tests?\s+recommendations?\s+for\s+([a-zA-Z0-9_\-./]+)/i,
  // "what should be tested in X" -> X
  /what\s+should\s+be\s+tested\s+in\s+([a-zA-Z0-9_\-./]+)/i,
  // "what needs to be tested in X" -> X
  /what\s+needs?\s+to\s+be\s+tested\s+in\s+([a-zA-Z0-9_\-./]+)/i,
  // "how should I test X" -> X (at end of string or before words like 'the', 'module')
  /how\s+should\s+(?:I|we)\s+test\s+(?:the\s+)?([a-zA-Z0-9_\-./]+)/i,
  // "test cases for X" -> X
  /test\s+cases?\s+for\s+([a-zA-Z0-9_\-./]+)/i,
  // "testing strategy for X" -> X
  /testing\s+(?:strategy|plan)\s+for\s+([a-zA-Z0-9_\-./]+)/i,
];

/**
 * Classifies a query to determine if it's asking for test suggestions.
 */
export function classifyTestSuggestionQuery(intent: string): TestSuggestionQueryClassification {
  const matchingPatterns = TEST_SUGGESTION_PATTERNS.filter(p => p.test(intent));

  if (matchingPatterns.length === 0) {
    return {
      isTestSuggestionQuery: false,
      target: null,
      confidence: 0.9,
      explanation: 'No test suggestion patterns matched.',
    };
  }

  // Extract target
  let target: string | null = null;
  for (const pattern of TARGET_EXTRACTION_PATTERNS) {
    const match = intent.match(pattern);
    if (match?.[1]) {
      target = match[1];
      break;
    }
  }

  return {
    isTestSuggestionQuery: true,
    target,
    confidence: target ? 0.95 : 0.75,
    explanation: target
      ? `Test suggestion query detected for target: "${target}"`
      : 'Test suggestion query detected but no specific target identified.',
  };
}

// ============================================================================
// MAIN API
// ============================================================================

/**
 * Generates test suggestions for a file or specific function.
 *
 * @param storage - LiBrainian storage instance
 * @param targetPath - Path to the file to analyze
 * @param targetFunction - Optional specific function name
 * @param options - Configuration options
 * @returns Array of test suggestions sorted by priority
 */
export async function suggestTests(
  storage: LiBrainianStorage,
  targetPath: string,
  targetFunction?: string,
  options: TestSuggestionOptions = {}
): Promise<TestSuggestion[]> {
  const {
    includePrivate = false,
    maxScenariosPerFunction = 5,
  } = options;

  const suggestions: TestSuggestion[] = [];

  // Get functions to analyze
  let functions: FunctionKnowledge[];
  if (targetFunction) {
    const func = await storage.getFunctionByPath(targetPath, targetFunction);
    functions = func ? [func] : [];
  } else {
    functions = await storage.getFunctionsByPath(targetPath);
  }

  for (const func of functions) {
    // Skip test functions and optionally private functions
    if (isTestFunction(func)) continue;
    if (!includePrivate && isPrivateFunction(func)) continue;

    const suggestion = await generateTestSuggestion(storage, func, maxScenariosPerFunction);
    suggestions.push(suggestion);
  }

  return suggestions.sort((a, b) => priorityOrder(a.priority) - priorityOrder(b.priority));
}

/**
 * Generates a test suggestion for a single function.
 */
async function generateTestSuggestion(
  storage: LiBrainianStorage,
  func: FunctionKnowledge,
  maxScenarios: number
): Promise<TestSuggestion> {
  const scenarios = generateScenarios(func, maxScenarios);
  const mocks = await identifyMockRequirements(storage, func);
  const testFile = suggestTestFilePath(func.filePath);
  const testType = inferTestType(func, mocks);
  const priority = calculatePriority(func);

  return {
    targetFunction: func.name,
    file: func.filePath,
    testFile,
    testType,
    scenarios,
    mockRequirements: mocks,
    setupCode: generateSetupCode(func, mocks),
    priority,
    rationale: generateRationale(func, priority, testType),
  };
}

// ============================================================================
// SCENARIO GENERATION
// ============================================================================

/**
 * Generates test scenarios based on function analysis.
 */
function generateScenarios(func: FunctionKnowledge, maxScenarios: number): TestScenario[] {
  const scenarios: TestScenario[] = [];
  const signature = func.signature || '';
  const purpose = func.purpose || '';
  const isAsync = signature.includes('async') || signature.includes('Promise<');

  // Happy path scenario
  scenarios.push({
    name: `${func.name} returns expected result`,
    description: `Test normal operation of ${func.name} with valid input`,
    input: generateSampleInput(func),
    expectedOutput: 'Expected result based on function purpose',
    testCode: generateHappyPathTest(func, isAsync),
    category: 'happy_path',
  });

  // Error handling scenario (if function likely handles errors)
  if (hasErrorHandling(signature, purpose)) {
    scenarios.push({
      name: `${func.name} handles errors gracefully`,
      description: 'Test error handling behavior with invalid input',
      input: 'Invalid or edge case input',
      expectedOutput: 'Proper error or graceful failure',
      testCode: generateErrorTest(func, isAsync),
      category: 'error_handling',
    });
  }

  // Parameter-based edge cases
  const paramEdgeCases = generateParameterEdgeCases(func, signature, isAsync);
  scenarios.push(...paramEdgeCases);

  // Async-specific scenario
  if (isAsync) {
    scenarios.push({
      name: `${func.name} resolves correctly`,
      description: 'Test async resolution behavior',
      input: 'Valid async input',
      expectedOutput: 'Resolved promise with expected value',
      testCode: generateAsyncTest(func),
      category: 'async',
    });
  }

  // Limit to maxScenarios
  return scenarios.slice(0, maxScenarios);
}

/**
 * Checks if function has error handling based on signature and purpose.
 */
function hasErrorHandling(signature: string, purpose: string): boolean {
  const errorKeywords = ['throw', 'error', 'catch', 'try', 'exception', 'fail', 'invalid'];
  const combined = (signature + ' ' + purpose).toLowerCase();
  return errorKeywords.some(keyword => combined.includes(keyword));
}

/**
 * Generates edge case scenarios based on parameter types.
 */
function generateParameterEdgeCases(
  func: FunctionKnowledge,
  signature: string,
  isAsync: boolean
): TestScenario[] {
  const scenarios: TestScenario[] = [];

  // Extract parameter patterns from signature
  const paramPatterns = [
    { pattern: /:\s*string/i, name: 'empty string', value: '""', type: 'string' },
    { pattern: /:\s*number/i, name: 'zero', value: '0', type: 'number' },
    { pattern: /:\s*number/i, name: 'negative number', value: '-1', type: 'number' },
    { pattern: /\[\]|Array</i, name: 'empty array', value: '[]', type: 'array' },
    { pattern: /:\s*boolean/i, name: 'false value', value: 'false', type: 'boolean' },
    { pattern: /null|undefined|\?:/i, name: 'null/undefined', value: 'null', type: 'nullable' },
  ];

  for (const { pattern, name, value, type } of paramPatterns) {
    if (pattern.test(signature)) {
      scenarios.push({
        name: `${func.name} handles ${name}`,
        description: `Test behavior with ${type} edge case: ${name}`,
        input: value,
        expectedOutput: 'Handles gracefully without crashing',
        testCode: generateEdgeCaseTest(func, name, value, isAsync),
        category: 'edge_case',
      });
    }
  }

  return scenarios;
}

// ============================================================================
// MOCK REQUIREMENTS
// ============================================================================

/**
 * Identifies dependencies that should be mocked.
 */
async function identifyMockRequirements(
  storage: LiBrainianStorage,
  func: FunctionKnowledge
): Promise<MockRequirement[]> {
  const mocks: MockRequirement[] = [];
  const signature = func.signature || '';
  const purpose = func.purpose || '';
  const combined = (signature + ' ' + purpose).toLowerCase();

  // Get graph edges to find dependencies
  try {
    const edges = await storage.getGraphEdges({
      fromIds: [func.id],
      edgeTypes: ['calls', 'imports'],
      limit: 50,
    });

    for (const edge of edges) {
      const depName = extractDependencyName(edge);
      if (!depName) continue;

      // External modules should be mocked
      if (isExternalDependency(edge)) {
        mocks.push({
          dependency: depName,
          mockType: 'module',
          suggestion: `vi.mock('${depName}')`,
          reason: 'External dependency should be isolated in unit tests',
        });
      }

      // Storage/DB access should be mocked
      if (isStorageDependency(depName)) {
        mocks.push({
          dependency: depName,
          mockType: 'class',
          suggestion: `const mock${capitalize(depName)} = { /* mock methods */ } as jest.Mocked<${capitalize(depName)}>`,
          reason: 'Database/storage access should be mocked for predictable tests',
        });
      }
    }
  } catch {
    // Graph edges not available, fall back to pattern matching
  }

  // Check for common patterns that need mocking
  if (combined.includes('fetch') || combined.includes('axios') || combined.includes('http')) {
    mocks.push({
      dependency: 'fetch/axios',
      mockType: 'function',
      suggestion: "vi.mock('fetch') or mock axios responses",
      reason: 'HTTP requests should be mocked to avoid network dependencies',
    });
  }

  if (combined.includes('fs.') || combined.includes('readfile') || combined.includes('writefile')) {
    mocks.push({
      dependency: 'fs',
      mockType: 'module',
      suggestion: "vi.mock('fs/promises')",
      reason: 'File system operations should be mocked for test isolation',
    });
  }

  if (combined.includes('storage') || combined.includes('database') || combined.includes('db')) {
    if (!mocks.some(m => m.dependency.includes('storage'))) {
      mocks.push({
        dependency: 'storage',
        mockType: 'class',
        suggestion: 'Create mock storage with vi.fn() implementations',
        reason: 'Storage layer should be mocked for unit tests',
      });
    }
  }

  return mocks;
}

/**
 * Extracts dependency name from a graph edge.
 */
function extractDependencyName(edge: GraphEdge): string | null {
  return edge.toId.split('/').pop()?.replace(/\.(ts|js|tsx|jsx)$/, '') || null;
}

/**
 * Checks if edge represents an external dependency.
 */
function isExternalDependency(edge: GraphEdge): boolean {
  return edge.toId.includes('node_modules') || !edge.toId.startsWith('src');
}

/**
 * Checks if name represents a storage dependency.
 */
function isStorageDependency(name: string): boolean {
  const storageTerms = ['storage', 'db', 'database', 'repository', 'store', 'cache'];
  return storageTerms.some(term => name.toLowerCase().includes(term));
}

// ============================================================================
// TEST CODE GENERATION
// ============================================================================

/**
 * Generates happy path test code.
 */
function generateHappyPathTest(func: FunctionKnowledge, isAsync: boolean): string {
  const asyncPrefix = isAsync ? 'async ' : '';
  const awaitPrefix = isAsync ? 'await ' : '';

  return `
it('should ${func.name} successfully', ${asyncPrefix}() => {
  // Arrange
  const input = /* valid input based on function signature */;

  // Act
  const result = ${awaitPrefix}${func.name}(input);

  // Assert
  expect(result).toBeDefined();
  // Add specific assertions based on expected behavior
});
`.trim();
}

/**
 * Generates error handling test code.
 */
function generateErrorTest(func: FunctionKnowledge, isAsync: boolean): string {
  const asyncPrefix = isAsync ? 'async ' : '';

  if (isAsync) {
    return `
it('should handle errors in ${func.name}', ${asyncPrefix}() => {
  // Arrange
  const invalidInput = /* invalid input */;

  // Act & Assert
  await expect(${func.name}(invalidInput)).rejects.toThrow();
});
`.trim();
  }

  return `
it('should handle errors in ${func.name}', () => {
  // Arrange
  const invalidInput = /* invalid input */;

  // Act & Assert
  expect(() => ${func.name}(invalidInput)).toThrow();
});
`.trim();
}

/**
 * Generates edge case test code.
 */
function generateEdgeCaseTest(
  func: FunctionKnowledge,
  caseName: string,
  value: string,
  isAsync: boolean
): string {
  const asyncPrefix = isAsync ? 'async ' : '';
  const awaitPrefix = isAsync ? 'await ' : '';

  return `
it('should handle ${caseName}', ${asyncPrefix}() => {
  // Arrange
  const input = ${value};

  // Act
  const result = ${awaitPrefix}${func.name}(input);

  // Assert
  // Verify it handles this edge case appropriately
  expect(result).toBeDefined();
});
`.trim();
}

/**
 * Generates async-specific test code.
 */
function generateAsyncTest(func: FunctionKnowledge): string {
  return `
it('should resolve ${func.name} async operation', async () => {
  // Arrange
  const input = /* async-compatible input */;

  // Act
  const promise = ${func.name}(input);

  // Assert
  await expect(promise).resolves.toBeDefined();
});
`.trim();
}

/**
 * Generates setup code for test file.
 */
function generateSetupCode(func: FunctionKnowledge, mocks: MockRequirement[]): string | undefined {
  if (mocks.length === 0) return undefined;

  const mockSetup = mocks.map(m => m.suggestion).join('\n  ');

  return `
beforeEach(() => {
  vi.clearAllMocks();
  ${mockSetup}
});

afterEach(() => {
  vi.restoreAllMocks();
});
`.trim();
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Suggests a test file path based on source file conventions.
 */
function suggestTestFilePath(sourcePath: string): string {
  // src/api/query.ts -> src/api/__tests__/query.test.ts
  const dir = sourcePath.replace(/\/[^/]+$/, '');
  const fileName = sourcePath.split('/').pop()!.replace(/\.(ts|tsx|js|jsx)$/, '');
  return `${dir}/__tests__/${fileName}.test.ts`;
}

/**
 * Infers the appropriate test type based on function characteristics.
 */
function inferTestType(func: FunctionKnowledge, mocks: MockRequirement[]): 'unit' | 'integration' | 'e2e' {
  const signature = func.signature || '';
  const purpose = func.purpose || '';
  const combined = (signature + ' ' + purpose).toLowerCase();

  // E2E indicators
  if (combined.includes('server') || combined.includes('app.listen') || combined.includes('endpoint')) {
    return 'e2e';
  }

  // Integration indicators (multiple external dependencies)
  if (mocks.length >= 3 || combined.includes('database') || combined.includes('external api')) {
    return 'integration';
  }

  // Default to unit tests
  return 'unit';
}

/**
 * Calculates test priority based on function characteristics.
 */
function calculatePriority(func: FunctionKnowledge): 'critical' | 'high' | 'medium' | 'low' {
  const signature = func.signature || '';
  const purpose = func.purpose || '';

  // Low: private/internal functions (check first - private functions are always low priority)
  if (func.name.startsWith('_')) {
    return 'low';
  }

  // Critical: exported public API
  if (signature.includes('export')) {
    // Check for important functionality
    if (purpose.toLowerCase().includes('public') || purpose.toLowerCase().includes('api')) {
      return 'critical';
    }
    return 'high';
  }

  // High: complex functions (long signature suggests complexity)
  if (signature.length > 200 || (func.endLine - func.startLine) > 50) {
    return 'high';
  }

  // Medium: everything else
  return 'medium';
}

/**
 * Generates a rationale for the test suggestion.
 */
function generateRationale(
  func: FunctionKnowledge,
  priority: string,
  testType: string
): string {
  const parts: string[] = [];

  if (priority === 'critical' || priority === 'high') {
    parts.push(`This is a ${priority}-priority function that should have comprehensive test coverage.`);
  }

  if (testType === 'integration') {
    parts.push('Due to external dependencies, integration tests are recommended.');
  } else if (testType === 'e2e') {
    parts.push('This function involves server/endpoint behavior, consider e2e tests.');
  }

  if (!parts.length) {
    parts.push(`Standard ${testType} tests recommended for this function.`);
  }

  return parts.join(' ');
}

/**
 * Checks if a function is a test function.
 */
function isTestFunction(func: FunctionKnowledge): boolean {
  const testIndicators = ['.test.', '.spec.', '__tests__', 'test/', 'tests/'];
  if (testIndicators.some(i => func.filePath.includes(i))) return true;
  if (func.name.startsWith('test') || func.name.startsWith('it')) return true;
  if (func.name.match(/^(describe|beforeEach|afterEach|beforeAll|afterAll)$/)) return true;
  return false;
}

/**
 * Checks if a function is private.
 */
function isPrivateFunction(func: FunctionKnowledge): boolean {
  return func.name.startsWith('_');
}

/**
 * Converts priority to numeric order for sorting.
 */
function priorityOrder(priority: string): number {
  const order: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  return order[priority] ?? 4;
}

/**
 * Generates sample input description based on function signature.
 */
function generateSampleInput(func: FunctionKnowledge): string {
  const signature = func.signature || '';

  // Try to extract parameter info from signature
  const paramMatch = signature.match(/\(([^)]*)\)/);
  if (paramMatch?.[1]) {
    const params = paramMatch[1].split(',').map(p => p.trim()).filter(Boolean);
    if (params.length > 0) {
      return `/* ${params.join(', ')} */`;
    }
  }

  return '/* sample input based on function signature */';
}

/**
 * Capitalizes the first letter of a string.
 */
function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// ============================================================================
// QUERY STAGE INTEGRATION
// ============================================================================

/**
 * Result of the test suggestion stage.
 */
export interface TestSuggestionStageResult {
  /** Whether this query is asking for test suggestions */
  isTestSuggestionQuery: boolean;
  /** Generated suggestions */
  suggestions: TestSuggestion[];
  /** Context packs created from suggestions */
  suggestionPacks: ContextPack[];
  /** Human-readable explanation */
  explanation: string;
  /** Whether to short-circuit the query pipeline */
  shouldShortCircuit: boolean;
}

/**
 * Options for running the test suggestion stage.
 */
export interface TestSuggestionStageOptions {
  /** Query intent */
  intent: string;
  /** Files affected by the query */
  affectedFiles?: string[];
  /** LiBrainian storage */
  storage: LiBrainianStorage;
  /** Workspace root for file resolution */
  workspaceRoot: string;
  /** LiBrainian version for pack creation */
  version: LiBrainianVersion;
}

// Import ContextPack and LiBrainianVersion for stage integration
import type { ContextPack, LiBrainianVersion } from '../types.js';

/**
 * Runs the test suggestion stage of the query pipeline.
 *
 * This stage intercepts queries like "what tests should I write for X" and
 * provides actionable test suggestions instead of just finding existing tests.
 *
 * @param options - Stage options
 * @returns Test suggestion stage result
 */
export async function runTestSuggestionStage(
  options: TestSuggestionStageOptions
): Promise<TestSuggestionStageResult> {
  const { intent, affectedFiles, storage, workspaceRoot, version } = options;

  // Classify the query
  const classification = classifyTestSuggestionQuery(intent);

  if (!classification.isTestSuggestionQuery) {
    return {
      isTestSuggestionQuery: false,
      suggestions: [],
      suggestionPacks: [],
      explanation: 'Not a test suggestion query.',
      shouldShortCircuit: false,
    };
  }

  // Determine target file(s) to analyze
  let targetFiles: string[] = [];

  if (classification.target) {
    // Try to resolve the target to a file path
    const resolvedPath = await resolveTargetPath(storage, classification.target, workspaceRoot);
    if (resolvedPath) {
      targetFiles = [resolvedPath];
    }
  }

  // Fall back to affected files if no specific target
  if (targetFiles.length === 0 && affectedFiles?.length) {
    targetFiles = affectedFiles.filter(f => !f.includes('.test.') && !f.includes('.spec.'));
  }

  if (targetFiles.length === 0) {
    return {
      isTestSuggestionQuery: true,
      suggestions: [],
      suggestionPacks: [],
      explanation: `Test suggestion query detected, but could not identify target file. Try specifying a file path like "what tests should I write for src/api/query.ts".`,
      shouldShortCircuit: false,
    };
  }

  // Generate suggestions for each target file
  const allSuggestions: TestSuggestion[] = [];
  for (const targetFile of targetFiles) {
    try {
      const suggestions = await suggestTests(storage, targetFile);
      allSuggestions.push(...suggestions);
    } catch {
      // Continue with other files if one fails
    }
  }

  if (allSuggestions.length === 0) {
    return {
      isTestSuggestionQuery: true,
      suggestions: [],
      suggestionPacks: [],
      explanation: `No functions found in ${targetFiles.join(', ')} to generate test suggestions for.`,
      shouldShortCircuit: false,
    };
  }

  // Create context packs from suggestions
  const suggestionPacks = createTestSuggestionPacks(allSuggestions, targetFiles, version);

  const explanation = generateStageExplanation(allSuggestions, targetFiles);

  return {
    isTestSuggestionQuery: true,
    suggestions: allSuggestions,
    suggestionPacks,
    explanation,
    shouldShortCircuit: true, // We have complete results, no need for semantic search
  };
}

/**
 * Resolves a target string to a file path.
 */
async function resolveTargetPath(
  storage: LiBrainianStorage,
  target: string,
  workspaceRoot: string
): Promise<string | null> {
  // If target looks like a path, try to find it directly
  if (target.includes('/') || target.includes('.')) {
    const file = await storage.getFileByPath(target);
    if (file) return file.path;

    // Try with src/ prefix
    const srcPath = target.startsWith('src/') ? target : `src/${target}`;
    const srcFile = await storage.getFileByPath(srcPath);
    if (srcFile) return srcFile.path;
  }

  // Try to find a file containing the target name
  try {
    const files = await storage.getFiles({ limit: 100 });
    const matching = files.find(f =>
      f.name.toLowerCase().includes(target.toLowerCase()) ||
      f.relativePath.toLowerCase().includes(target.toLowerCase())
    );
    if (matching) return matching.path;
  } catch {
    // Files query not available
  }

  return null;
}

/**
 * Creates context packs from test suggestions.
 */
function createTestSuggestionPacks(
  suggestions: TestSuggestion[],
  targetFiles: string[],
  version: LiBrainianVersion
): ContextPack[] {
  const packs: ContextPack[] = [];

  // Group suggestions by file
  const byFile = new Map<string, TestSuggestion[]>();
  for (const suggestion of suggestions) {
    const existing = byFile.get(suggestion.file) ?? [];
    existing.push(suggestion);
    byFile.set(suggestion.file, existing);
  }

  for (const [file, fileSuggestions] of Array.from(byFile.entries())) {
    // Create summary
    const priorityCounts = {
      critical: fileSuggestions.filter(s => s.priority === 'critical').length,
      high: fileSuggestions.filter(s => s.priority === 'high').length,
      medium: fileSuggestions.filter(s => s.priority === 'medium').length,
      low: fileSuggestions.filter(s => s.priority === 'low').length,
    };

    const totalScenarios = fileSuggestions.reduce((sum, s) => sum + s.scenarios.length, 0);
    const totalMocks = new Set(fileSuggestions.flatMap(s => s.mockRequirements.map(m => m.dependency))).size;

    const summary = [
      `Test suggestions for ${file}:`,
      `${fileSuggestions.length} function(s) should be tested`,
      `${totalScenarios} test scenario(s) suggested`,
      totalMocks > 0 ? `${totalMocks} mock(s) recommended` : '',
      priorityCounts.critical > 0 ? `${priorityCounts.critical} critical priority` : '',
      priorityCounts.high > 0 ? `${priorityCounts.high} high priority` : '',
    ].filter(Boolean).join('. ');

    // Create key facts
    const keyFacts: string[] = [];
    for (const suggestion of fileSuggestions.slice(0, 5)) { // Limit to top 5
      keyFacts.push(
        `${suggestion.targetFunction}: ${suggestion.priority} priority, ${suggestion.testType} test, ${suggestion.scenarios.length} scenarios`
      );
    }

    // Create code snippets with test templates
    const codeSnippets = fileSuggestions.slice(0, 3).map(suggestion => ({
      filePath: suggestion.testFile,
      startLine: 1,
      endLine: 20,
      content: formatTestTemplate(suggestion),
      language: 'typescript',
    }));

    const pack: ContextPack = {
      packId: `test-suggestion-${file.replace(/[^a-zA-Z0-9]/g, '-')}`,
      packType: 'function_context',
      targetId: file,
      summary,
      keyFacts,
      codeSnippets,
      relatedFiles: [file, ...fileSuggestions.map(s => s.testFile)],
      confidence: 0.9,
      createdAt: new Date(),
      accessCount: 0,
      lastOutcome: 'unknown',
      successCount: 0,
      failureCount: 0,
      version,
      invalidationTriggers: [file],
    };

    packs.push(pack);
  }

  return packs;
}

/**
 * Formats a test suggestion into a test template.
 */
function formatTestTemplate(suggestion: TestSuggestion): string {
  const lines: string[] = [
    `// Test file: ${suggestion.testFile}`,
    `// Testing: ${suggestion.targetFunction}`,
    `// Type: ${suggestion.testType} tests`,
    `// Priority: ${suggestion.priority}`,
    '',
    `import { ${suggestion.targetFunction} } from '${getRelativeImport(suggestion.testFile, suggestion.file)}';`,
    '',
  ];

  // Add setup code if mocks are needed
  if (suggestion.setupCode) {
    lines.push(suggestion.setupCode, '');
  }

  // Add describe block
  lines.push(`describe('${suggestion.targetFunction}', () => {`);

  // Add first 2 scenarios
  for (const scenario of suggestion.scenarios.slice(0, 2)) {
    lines.push('', scenario.testCode);
  }

  lines.push('});');

  return lines.join('\n');
}

/**
 * Gets relative import path from test file to source file.
 */
function getRelativeImport(testFile: string, sourceFile: string): string {
  // Simple implementation - assumes __tests__ directory
  const sourceName = sourceFile.split('/').pop()!.replace(/\.(ts|tsx|js|jsx)$/, '');
  return `../${sourceName}`;
}

/**
 * Generates explanation for the stage result.
 */
function generateStageExplanation(suggestions: TestSuggestion[], targetFiles: string[]): string {
  const totalFunctions = suggestions.length;
  const totalScenarios = suggestions.reduce((sum, s) => sum + s.scenarios.length, 0);
  const criticalCount = suggestions.filter(s => s.priority === 'critical').length;
  const highCount = suggestions.filter(s => s.priority === 'high').length;

  const parts: string[] = [
    `Generated ${totalScenarios} test scenarios for ${totalFunctions} function(s)`,
    `in ${targetFiles.join(', ')}.`,
  ];

  if (criticalCount > 0 || highCount > 0) {
    parts.push(`${criticalCount + highCount} function(s) are high/critical priority and should be tested first.`);
  }

  return parts.join(' ');
}
