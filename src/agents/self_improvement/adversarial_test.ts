/**
 * @fileoverview Adversarial Test Generation Primitive (tp_improve_adversarial_test)
 *
 * Generate adversarial test cases targeting known weaknesses.
 * Creates edge cases, boundary tests, and stress tests.
 *
 * Based on self-improvement-primitives.md specification.
 */

import type { ConfidenceValue } from './types.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Types of weaknesses that can be targeted.
 */
export type WeaknessType =
  | 'edge_case'
  | 'boundary'
  | 'race_condition'
  | 'resource_exhaustion'
  | 'semantic_confusion'
  | 'type_coercion'
  | 'null_handling'
  | 'concurrency';

/**
 * Difficulty levels for adversarial tests.
 */
export type TestDifficulty = 'easy' | 'medium' | 'hard' | 'extreme';

/**
 * A weakness that can be targeted by adversarial tests.
 */
export interface Weakness {
  /** Unique identifier */
  id: string;
  /** Type of weakness */
  type: WeaknessType;
  /** Human-readable description */
  description: string;
  /** Component affected by the weakness */
  affectedComponent: string;
  /** How the weakness was discovered */
  discoveredBy: string;
  /** Gettier risk associated with this weakness */
  gettierRisk?: number;
}

/**
 * Expected behavior when the adversarial test is run.
 */
export type ExpectedBehavior = 'fail' | 'degrade' | 'timeout' | 'incorrect_output' | 'crash';

/**
 * An adversarial test case.
 */
export interface AdversarialTestCase {
  /** Unique identifier */
  id: string;
  /** Test name */
  name: string;
  /** Description of what this test targets */
  description: string;
  /** The input to use */
  input: unknown;
  /** Expected behavior when run against weak code */
  expectedBehavior: ExpectedBehavior;
  /** Difficulty level */
  difficulty: TestDifficulty;
  /** ID of the weakness this targets */
  targetedWeakness: string;
  /** Generated test code */
  testCode: string;
  /** Assertion to verify the weakness */
  assertion: string;
  /** Timeout for this test in ms */
  timeoutMs: number;
}

/**
 * A failure mode that can occur.
 */
export interface FailureMode {
  /** Name of the failure mode */
  mode: string;
  /** Probability of this failure (0.0-1.0) */
  probability: number;
  /** Severity of the failure */
  severity: 'crash' | 'incorrect' | 'degraded' | 'slow';
  /** How to recover from this failure */
  recovery: string;
}

/**
 * Coverage analysis for the weakness.
 */
export interface WeaknessCoverage {
  /** ID of the weakness */
  weaknessId: string;
  /** Test IDs that cover this weakness */
  testsCovering: string[];
  /** Aspects of the weakness not yet covered */
  uncoveredAspects: string[];
  /** Coverage score (0.0-1.0) */
  coverageScore: number;
}

/**
 * An edge case identified for the weakness.
 */
export interface EdgeCase {
  /** Name of the edge case */
  name: string;
  /** Description */
  description: string;
  /** Example input that triggers this edge case */
  exampleInput: unknown;
  /** Why this is problematic */
  problematicReason: string;
  /** Whether a test was generated for this */
  hasTest: boolean;
}

/**
 * A coverage gap in the tests.
 */
export interface CoverageGap {
  /** Area of the gap */
  area: string;
  /** Description of what's missing */
  description: string;
  /** Severity of the gap */
  severity: 'critical' | 'high' | 'medium' | 'low';
  /** Suggested test to fill the gap */
  suggestedTest: string;
}

/**
 * Options for adversarial test generation.
 */
export interface GenerateAdversarialTestsOptions {
  /** Difficulty level for tests */
  difficulty?: TestDifficulty;
  /** Maximum number of tests to generate */
  maxTests?: number;
  /** Include regression tests */
  includeRegression?: boolean;
  /** Test timeout in ms */
  testTimeoutMs?: number;
  /** Enable verbose logging */
  verbose?: boolean;
}

/**
 * Result of adversarial test generation.
 */
export interface AdversarialTestResult {
  /** Generated test cases */
  tests: AdversarialTestCase[];
  /** Expected failure modes */
  expectedFailureModes: FailureMode[];
  /** Coverage analysis */
  coverageAnalysis: WeaknessCoverage;
  /** Identified coverage gaps */
  coverageGaps: CoverageGap[];
  /** Edge cases identified */
  edgeCases: EdgeCase[];
  /** Duration of generation in milliseconds */
  duration: number;
  /** Any errors encountered */
  errors: string[];
}

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_MAX_TESTS = 10;
const DEFAULT_DIFFICULTY: TestDifficulty = 'hard';
const DEFAULT_TIMEOUT_MS = 5000;

/**
 * Test templates by weakness type.
 */
const TEST_TEMPLATES: Record<WeaknessType, string[]> = {
  edge_case: [
    'test_empty_input',
    'test_single_element',
    'test_maximum_size',
    'test_unicode_characters',
  ],
  boundary: [
    'test_min_boundary',
    'test_max_boundary',
    'test_overflow',
    'test_underflow',
  ],
  race_condition: [
    'test_concurrent_access',
    'test_rapid_succession',
    'test_interleaved_operations',
  ],
  resource_exhaustion: [
    'test_memory_pressure',
    'test_large_input',
    'test_deep_nesting',
    'test_infinite_loop_guard',
  ],
  semantic_confusion: [
    'test_ambiguous_input',
    'test_similar_but_different',
    'test_context_switching',
  ],
  type_coercion: [
    'test_string_number_conversion',
    'test_truthy_falsy',
    'test_null_undefined',
    'test_object_primitive',
  ],
  null_handling: [
    'test_null_input',
    'test_undefined_input',
    'test_null_nested',
    'test_optional_chain',
  ],
  concurrency: [
    'test_parallel_writes',
    'test_read_during_write',
    'test_deadlock_prevention',
  ],
};

// ============================================================================
// TEST GENERATION
// ============================================================================

/**
 * Generate adversarial inputs for a weakness type.
 */
function generateAdversarialInputs(weakness: Weakness, difficulty: TestDifficulty): unknown[] {
  const inputs: unknown[] = [];

  switch (weakness.type) {
    case 'edge_case':
      inputs.push(null, undefined, '', [], {}, 0, -1);
      if (difficulty === 'hard' || difficulty === 'extreme') {
        inputs.push(
          Number.MAX_SAFE_INTEGER,
          Number.MIN_SAFE_INTEGER,
          Number.NaN,
          Number.POSITIVE_INFINITY,
          '\u0000',
          '\uFFFF',
          new Array(10000).fill(0),
        );
      }
      break;

    case 'boundary':
      inputs.push(
        0, 1, -1,
        Number.MAX_SAFE_INTEGER,
        Number.MIN_SAFE_INTEGER,
      );
      if (difficulty === 'hard' || difficulty === 'extreme') {
        inputs.push(
          Math.pow(2, 31) - 1,
          -Math.pow(2, 31),
          0.1 + 0.2, // Floating point edge case
        );
      }
      break;

    case 'race_condition':
      inputs.push(
        { concurrent: true, count: 10 },
        { concurrent: true, count: 100 },
      );
      if (difficulty === 'extreme') {
        inputs.push({ concurrent: true, count: 1000 });
      }
      break;

    case 'resource_exhaustion':
      inputs.push(
        new Array(1000).fill('a').join(''),
        { depth: 10 },
      );
      if (difficulty === 'hard' || difficulty === 'extreme') {
        inputs.push(
          new Array(100000).fill('a').join(''),
          { depth: 100 },
          new Array(10000).fill(null).map(() => ({})),
        );
      }
      break;

    case 'semantic_confusion':
      inputs.push(
        '0',
        'false',
        'null',
        'undefined',
        '[]',
        '{}',
      );
      break;

    case 'type_coercion':
      inputs.push(
        '123',
        '0x10',
        '1e10',
        true,
        false,
        [],
        {},
        () => {},
      );
      break;

    case 'null_handling':
      inputs.push(
        null,
        undefined,
        { nested: null },
        { nested: { deep: null } },
        [null, undefined],
      );
      break;

    case 'concurrency':
      inputs.push(
        { operations: ['read', 'write', 'read'] },
        { operations: ['write', 'write'] },
      );
      break;
  }

  return inputs;
}

/**
 * Generate test code for a specific input.
 */
function generateTestCode(
  weakness: Weakness,
  input: unknown,
  index: number,
  difficulty: TestDifficulty
): string {
  const inputStr = JSON.stringify(input);
  const component = weakness.affectedComponent;

  // Generate appropriate test structure
  const testCode = `
describe('Adversarial: ${weakness.description}', () => {
  it('test_${index}_${difficulty}: handles ${typeof input} input', async () => {
    const input = ${inputStr};

    // Setup
    const component = await setup${component}();

    // Execute
    let error: Error | null = null;
    let result: unknown;
    try {
      result = await component.process(input);
    } catch (e) {
      error = e as Error;
    }

    // Assert - should handle gracefully
    if (error) {
      expect(error.message).toBeDefined();
      expect(error.message).not.toMatch(/undefined|null/i);
    } else {
      expect(result).toBeDefined();
    }
  });
});`.trim();

  return testCode;
}

/**
 * Generate adversarial test cases for a weakness.
 */
function generateTestCases(
  weakness: Weakness,
  options: GenerateAdversarialTestsOptions
): AdversarialTestCase[] {
  const {
    difficulty = DEFAULT_DIFFICULTY,
    maxTests = DEFAULT_MAX_TESTS,
    testTimeoutMs = DEFAULT_TIMEOUT_MS,
  } = options;

  const tests: AdversarialTestCase[] = [];
  const inputs = generateAdversarialInputs(weakness, difficulty);
  const templates = TEST_TEMPLATES[weakness.type] || [];

  let testIndex = 0;
  for (const input of inputs.slice(0, maxTests)) {
    const templateName = templates[testIndex % templates.length] || 'test_adversarial';
    const testId = `adv-${weakness.id}-${testIndex}`;

    tests.push({
      id: testId,
      name: `${templateName}_${testIndex}`,
      description: `Adversarial test for ${weakness.type}: ${weakness.description}`,
      input,
      expectedBehavior: determineExpectedBehavior(weakness.type, input),
      difficulty,
      targetedWeakness: weakness.id,
      testCode: generateTestCode(weakness, input, testIndex, difficulty),
      assertion: `expect(result).toBeDefined()`,
      timeoutMs: testTimeoutMs,
    });

    testIndex++;
  }

  return tests;
}

/**
 * Determine expected behavior based on weakness type and input.
 */
function determineExpectedBehavior(type: WeaknessType, input: unknown): ExpectedBehavior {
  switch (type) {
    case 'resource_exhaustion':
      if (typeof input === 'string' && input.length > 10000) return 'timeout';
      if (typeof input === 'object' && input !== null && 'depth' in input) {
        const depth = (input as { depth: number }).depth;
        if (depth > 50) return 'crash';
      }
      return 'degrade';

    case 'race_condition':
    case 'concurrency':
      return 'incorrect_output';

    case 'null_handling':
      if (input === null || input === undefined) return 'fail';
      return 'incorrect_output';

    case 'type_coercion':
      return 'incorrect_output';

    case 'boundary':
      if (input === Number.MAX_SAFE_INTEGER || input === Number.MIN_SAFE_INTEGER) {
        return 'fail';
      }
      return 'incorrect_output';

    default:
      return 'fail';
  }
}

// ============================================================================
// FAILURE MODE ANALYSIS
// ============================================================================

/**
 * Identify expected failure modes for a weakness.
 */
function identifyFailureModes(weakness: Weakness): FailureMode[] {
  const modes: FailureMode[] = [];

  switch (weakness.type) {
    case 'edge_case':
      modes.push({
        mode: 'unexpected_null',
        probability: 0.3,
        severity: 'incorrect',
        recovery: 'Add null checks before processing',
      });
      modes.push({
        mode: 'empty_collection_error',
        probability: 0.4,
        severity: 'crash',
        recovery: 'Check collection length before iteration',
      });
      break;

    case 'boundary':
      modes.push({
        mode: 'integer_overflow',
        probability: 0.2,
        severity: 'incorrect',
        recovery: 'Use BigInt or validate range',
      });
      modes.push({
        mode: 'array_index_out_of_bounds',
        probability: 0.35,
        severity: 'crash',
        recovery: 'Validate index before access',
      });
      break;

    case 'race_condition':
      modes.push({
        mode: 'data_corruption',
        probability: 0.15,
        severity: 'incorrect',
        recovery: 'Use locks or atomic operations',
      });
      modes.push({
        mode: 'deadlock',
        probability: 0.05,
        severity: 'slow',
        recovery: 'Implement timeout and deadlock detection',
      });
      break;

    case 'resource_exhaustion':
      modes.push({
        mode: 'out_of_memory',
        probability: 0.1,
        severity: 'crash',
        recovery: 'Implement memory limits and streaming',
      });
      modes.push({
        mode: 'stack_overflow',
        probability: 0.25,
        severity: 'crash',
        recovery: 'Convert recursion to iteration',
      });
      break;

    case 'semantic_confusion':
      modes.push({
        mode: 'wrong_type_interpretation',
        probability: 0.5,
        severity: 'incorrect',
        recovery: 'Use strict type checking',
      });
      break;

    case 'type_coercion':
      modes.push({
        mode: 'implicit_conversion_error',
        probability: 0.4,
        severity: 'incorrect',
        recovery: 'Use explicit type conversion',
      });
      break;

    case 'null_handling':
      modes.push({
        mode: 'null_pointer_exception',
        probability: 0.6,
        severity: 'crash',
        recovery: 'Use optional chaining and null checks',
      });
      break;

    case 'concurrency':
      modes.push({
        mode: 'race_condition',
        probability: 0.3,
        severity: 'incorrect',
        recovery: 'Use proper synchronization',
      });
      break;
  }

  return modes;
}

// ============================================================================
// COVERAGE ANALYSIS
// ============================================================================

/**
 * Analyze test coverage for a weakness.
 */
function analyzeCoverage(
  weakness: Weakness,
  tests: AdversarialTestCase[]
): WeaknessCoverage {
  const templates = TEST_TEMPLATES[weakness.type] || [];
  const coveredTemplates = new Set<string>();

  for (const test of tests) {
    // Extract template from test name
    const templateMatch = templates.find((t) => test.name.startsWith(t));
    if (templateMatch) {
      coveredTemplates.add(templateMatch);
    }
  }

  const uncoveredAspects = templates.filter((t) => !coveredTemplates.has(t));
  const coverageScore = templates.length > 0
    ? coveredTemplates.size / templates.length
    : 1.0;

  return {
    weaknessId: weakness.id,
    testsCovering: tests.map((t) => t.id),
    uncoveredAspects,
    coverageScore,
  };
}

/**
 * Identify coverage gaps.
 */
function identifyCoverageGaps(
  weakness: Weakness,
  coverage: WeaknessCoverage
): CoverageGap[] {
  const gaps: CoverageGap[] = [];

  for (const aspect of coverage.uncoveredAspects) {
    gaps.push({
      area: aspect,
      description: `Missing test coverage for ${aspect}`,
      severity: coverage.coverageScore < 0.5 ? 'high' : 'medium',
      suggestedTest: `Create test for ${aspect} in ${weakness.affectedComponent}`,
    });
  }

  // Add weakness-specific gaps
  if (weakness.type === 'race_condition' && coverage.coverageScore < 0.8) {
    gaps.push({
      area: 'concurrency_stress',
      description: 'Need high-concurrency stress tests',
      severity: 'critical',
      suggestedTest: 'Add stress test with 1000+ concurrent operations',
    });
  }

  if (weakness.type === 'resource_exhaustion' && coverage.coverageScore < 0.7) {
    gaps.push({
      area: 'memory_limits',
      description: 'Need tests that verify memory limits are enforced',
      severity: 'high',
      suggestedTest: 'Add test that monitors memory usage under load',
    });
  }

  return gaps;
}

// ============================================================================
// EDGE CASE IDENTIFICATION
// ============================================================================

/**
 * Identify edge cases for a weakness.
 */
function identifyEdgeCases(
  weakness: Weakness,
  tests: AdversarialTestCase[]
): EdgeCase[] {
  const edgeCases: EdgeCase[] = [];
  const coveredInputs = new Set(tests.map((t) => JSON.stringify(t.input)));

  // Add standard edge cases by type
  const standardEdgeCases: Record<WeaknessType, Array<{ name: string; input: unknown; reason: string }>> = {
    edge_case: [
      { name: 'empty_string', input: '', reason: 'Often handled differently than null' },
      { name: 'whitespace_only', input: '   ', reason: 'May pass empty checks but cause issues' },
      { name: 'zero', input: 0, reason: 'Falsy value that is valid in many contexts' },
    ],
    boundary: [
      { name: 'max_array_length', input: new Array(2 ** 16).fill(0), reason: 'Near TypedArray limit' },
      { name: 'negative_zero', input: -0, reason: 'Special numeric value' },
    ],
    race_condition: [
      { name: 'rapid_toggle', input: { toggleCount: 1000 }, reason: 'State can become inconsistent' },
    ],
    resource_exhaustion: [
      { name: 'circular_reference', input: { type: 'circular', description: 'Object with self-reference' }, reason: 'Can cause infinite loops in serialization' },
    ],
    semantic_confusion: [
      { name: 'lookalike_characters', input: '\u0430\u0435', reason: 'Cyrillic letters look like Latin' },
    ],
    type_coercion: [
      { name: 'array_with_one_element', input: ['42'], reason: 'Coerces to "42" in some contexts' },
    ],
    null_handling: [
      { name: 'prototype_pollution', input: { __proto__: { polluted: true } }, reason: 'Can modify Object.prototype' },
    ],
    concurrency: [
      { name: 'alternating_ops', input: { pattern: ['read', 'write', 'read', 'write'] }, reason: 'Maximizes race window' },
    ],
  };

  const cases = standardEdgeCases[weakness.type] || [];
  for (const ec of cases) {
    const inputStr = JSON.stringify(ec.input);
    edgeCases.push({
      name: ec.name,
      description: `Edge case: ${ec.name}`,
      exampleInput: ec.input,
      problematicReason: ec.reason,
      hasTest: coveredInputs.has(inputStr),
    });
  }

  return edgeCases;
}

// ============================================================================
// MAIN GENERATION FUNCTION
// ============================================================================

/**
 * Generate adversarial test cases for identified weaknesses.
 *
 * This function:
 * 1. Analyzes the weakness type and affected component
 * 2. Generates targeted adversarial inputs
 * 3. Creates executable test cases
 * 4. Identifies expected failure modes
 * 5. Analyzes coverage and gaps
 *
 * @param weakness - The weakness to target
 * @param options - Generation options
 * @returns Adversarial test result
 *
 * @example
 * ```typescript
 * const result = await generateAdversarialTests({
 *   id: 'weak-1',
 *   type: 'null_handling',
 *   description: 'Parser crashes on null input',
 *   affectedComponent: 'Parser',
 *   discoveredBy: 'tp_analyze_consistency',
 * });
 * console.log(`Generated ${result.tests.length} adversarial tests`);
 * console.log(`Coverage: ${(result.coverageAnalysis.coverageScore * 100).toFixed(0)}%`);
 * ```
 */
export async function generateAdversarialTests(
  weakness: Weakness,
  options: GenerateAdversarialTestsOptions = {}
): Promise<AdversarialTestResult> {
  const startTime = Date.now();
  const errors: string[] = [];

  const {
    verbose = false,
  } = options;

  if (verbose) {
    console.error(`[generateAdversarialTests] Generating tests for weakness: ${weakness.id}`);
  }

  // Generate test cases
  const tests = generateTestCases(weakness, options);

  if (verbose) {
    console.error(`[generateAdversarialTests] Generated ${tests.length} test cases`);
  }

  // Identify failure modes
  const expectedFailureModes = identifyFailureModes(weakness);

  // Analyze coverage
  const coverageAnalysis = analyzeCoverage(weakness, tests);

  // Identify coverage gaps
  const coverageGaps = identifyCoverageGaps(weakness, coverageAnalysis);

  // Identify edge cases
  const edgeCases = identifyEdgeCases(weakness, tests);

  if (verbose) {
    console.error(`[generateAdversarialTests] Coverage: ${(coverageAnalysis.coverageScore * 100).toFixed(0)}%`);
  }

  return {
    tests,
    expectedFailureModes,
    coverageAnalysis,
    coverageGaps,
    edgeCases,
    duration: Date.now() - startTime,
    errors,
  };
}

/**
 * Create an adversarial test generation primitive with bound options.
 */
export function createGenerateAdversarialTests(
  defaultOptions: Partial<GenerateAdversarialTestsOptions>
): (weakness: Weakness, options?: Partial<GenerateAdversarialTestsOptions>) => Promise<AdversarialTestResult> {
  return async (weakness, options = {}) => {
    return generateAdversarialTests(weakness, {
      ...defaultOptions,
      ...options,
    });
  };
}
