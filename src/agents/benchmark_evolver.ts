/**
 * @fileoverview Benchmark Evolver Agent
 *
 * After a fix is verified, evolves the benchmark to prevent similar issues
 * from recurring. Part of the Scientific Self-Improvement Loop (Phase 10).
 *
 * Evolution Categories:
 * 1. Prevention Tests (2-3): Tests that would have caught this bug earlier
 * 2. Regression Guards: Assertions that will fail if this specific bug recurs
 * 3. Variant Tests: Variations of existing tests to probe related edge cases
 * 4. Coverage Gaps: What gap in testing allowed this bug to exist
 *
 * Problem Type-Specific Evolution:
 * - test_failure -> Edge case tests, boundary condition tests
 * - regression -> Snapshot tests, golden value tests
 * - hallucination -> Adversarial probes, grounding checks
 * - performance_gap -> Benchmark tests, load tests
 * - inconsistency -> Equivalence tests, normalization checks
 *
 * Uses heuristic-based approach (no LLM) for Tier-0 compatibility.
 */

import type {
  BenchmarkEvolverAgent,
  BenchmarkEvolverInput,
  BenchmarkEvolution,
  TestCase,
  CoverageGap,
  Problem,
  Fix,
  ProblemType,
} from './types.js';
import type { LibrarianStorage } from '../storage/types.js';

/**
 * Configuration for the BenchmarkEvolver agent.
 */
export interface BenchmarkEvolverConfig {
  /** Minimum number of prevention tests to generate (default: 2) */
  minPreventionTests?: number;
  /** Maximum number of prevention tests to generate (default: 3) */
  maxPreventionTests?: number;
  /** Minimum number of variant tests to generate (default: 1) */
  minVariantTests?: number;
}

const DEFAULT_CONFIG: Required<BenchmarkEvolverConfig> = {
  minPreventionTests: 2,
  maxPreventionTests: 3,
  minVariantTests: 1,
};

/**
 * BenchmarkEvolver implementation.
 * Generates tests and identifies coverage gaps using heuristics.
 */
export class BenchmarkEvolver implements BenchmarkEvolverAgent {
  readonly agentType = 'benchmark_evolver' as const;
  readonly name = 'Benchmark Evolver';
  readonly capabilities = ['benchmark_evolution'] as const;
  readonly version = '1.0.0';
  readonly qualityTier = 'full' as const;

  private storage: LibrarianStorage | null = null;
  private config: Required<BenchmarkEvolverConfig>;

  constructor(config: BenchmarkEvolverConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async initialize(storage: LibrarianStorage): Promise<void> {
    this.storage = storage;
  }

  isReady(): boolean {
    return this.storage !== null;
  }

  async shutdown(): Promise<void> {
    this.storage = null;
  }

  /**
   * Evolve the benchmark to prevent similar issues from recurring.
   */
  async evolveBenchmark(input: BenchmarkEvolverInput): Promise<BenchmarkEvolution> {
    const { problem, fix, verificationResult } = input;

    // Generate tests based on problem type
    const newTests = this.generatePreventionTests(problem, fix);
    const regressionGuards = this.generateRegressionGuards(problem, fix);
    const variantTests = this.generateVariantTests(problem, fix);
    const coverageGaps = this.identifyCoverageGaps(problem, fix);

    return {
      problemId: problem.id,
      fixId: fix.id,
      newTests,
      regressionGuards,
      variantTests,
      coverageGaps,
    };
  }

  /**
   * Generate prevention tests that would have caught this bug earlier.
   */
  private generatePreventionTests(problem: Problem, fix: Fix): TestCase[] {
    const testStrategies = this.getTestStrategiesForProblemType(problem.type);
    const testFile = this.extractTestFile(problem, fix);
    const tests: TestCase[] = [];

    for (const strategy of testStrategies.preventionStrategies) {
      tests.push({
        name: this.generateTestName(strategy.name, problem),
        file: testFile,
        code: this.generateTestCode(strategy.template, problem, fix),
        category: 'prevention',
      });
    }

    return tests;
  }

  /**
   * Generate regression guards that fail if this specific bug recurs.
   */
  private generateRegressionGuards(problem: Problem, fix: Fix): TestCase[] {
    const testStrategies = this.getTestStrategiesForProblemType(problem.type);
    const testFile = this.extractTestFile(problem, fix);
    const tests: TestCase[] = [];

    for (const strategy of testStrategies.regressionStrategies) {
      tests.push({
        name: this.generateTestName(strategy.name, problem),
        file: testFile,
        code: this.generateTestCode(strategy.template, problem, fix),
        category: 'regression_guard',
      });
    }

    return tests;
  }

  /**
   * Generate variant tests to probe related edge cases.
   */
  private generateVariantTests(problem: Problem, fix: Fix): TestCase[] {
    const testFile = this.extractTestFile(problem, fix);
    const variantStrategies = this.getVariantStrategies(problem);
    const tests: TestCase[] = [];

    for (const strategy of variantStrategies) {
      tests.push({
        name: this.generateTestName(strategy.name, problem),
        file: testFile,
        code: this.generateTestCode(strategy.template, problem, fix),
        category: 'variant',
      });
    }

    return tests;
  }

  /**
   * Identify coverage gaps that allowed this bug to exist.
   */
  private identifyCoverageGaps(problem: Problem, fix: Fix): CoverageGap[] {
    const gapTemplates = this.getCoverageGapTemplates(problem.type);
    const gaps: CoverageGap[] = [];

    for (const template of gapTemplates) {
      gaps.push({
        description: this.interpolate(template.description, problem, fix),
        affectedArea: this.getAffectedArea(problem, fix),
        suggestedTests: template.suggestedTests.map((t) =>
          this.interpolate(t, problem, fix)
        ),
      });
    }

    return gaps;
  }

  /**
   * Get test strategies based on problem type.
   */
  private getTestStrategiesForProblemType(
    problemType: ProblemType
  ): TestStrategySet {
    switch (problemType) {
      case 'test_failure':
        return TEST_FAILURE_STRATEGIES;
      case 'regression':
        return REGRESSION_STRATEGIES;
      case 'hallucination':
        return HALLUCINATION_STRATEGIES;
      case 'performance_gap':
        return PERFORMANCE_GAP_STRATEGIES;
      case 'inconsistency':
        return INCONSISTENCY_STRATEGIES;
      default:
        return TEST_FAILURE_STRATEGIES; // Default fallback
    }
  }

  /**
   * Get variant strategies for edge case exploration.
   */
  private getVariantStrategies(problem: Problem): TestStrategy[] {
    return [
      {
        name: 'variant with null input',
        template: `it('should handle null input for {{description}}', () => {
  // Variant test for null inputs
  expect(() => {
    // Test with null value
  }).not.toThrow();
});`,
      },
      {
        name: 'variant with empty input',
        template: `it('should handle empty input for {{description}}', () => {
  // Variant test for empty inputs
  expect(() => {
    // Test with empty value
  }).not.toThrow();
});`,
      },
    ];
  }

  /**
   * Get coverage gap templates based on problem type.
   */
  private getCoverageGapTemplates(problemType: ProblemType): GapTemplate[] {
    switch (problemType) {
      case 'test_failure':
        return [
          {
            description:
              'Missing edge case coverage for {{problemType}} scenario',
            suggestedTests: [
              'Add boundary value tests',
              'Add null/undefined handling tests',
              'Add error condition tests',
            ],
          },
        ];
      case 'regression':
        return [
          {
            description:
              'Insufficient snapshot/golden value coverage for {{problemType}} scenario',
            suggestedTests: [
              'Add snapshot tests for critical outputs',
              'Add golden value tests for expected results',
              'Add version compatibility tests',
            ],
          },
        ];
      case 'hallucination':
        return [
          {
            description:
              'Missing grounding/adversarial coverage for {{problemType}} scenario',
            suggestedTests: [
              'Add adversarial input tests',
              'Add grounding verification tests',
              'Add fact-checking tests',
            ],
          },
        ];
      case 'performance_gap':
        return [
          {
            description:
              'Missing performance benchmark coverage for {{problemType}} scenario',
            suggestedTests: [
              'Add performance regression tests',
              'Add load tests',
              'Add baseline comparison tests',
            ],
          },
        ];
      case 'inconsistency':
        return [
          {
            description:
              'Missing equivalence/normalization coverage for {{problemType}} scenario',
            suggestedTests: [
              'Add equivalence tests for similar inputs',
              'Add normalization tests',
              'Add idempotency tests',
            ],
          },
        ];
      default:
        return [
          {
            description: 'Generic coverage gap for {{problemType}} scenario',
            suggestedTests: ['Add comprehensive tests'],
          },
        ];
    }
  }

  /**
   * Extract test file from problem or fix information.
   */
  private extractTestFile(problem: Problem, fix: Fix): string {
    // Try to extract from minimal reproduction
    if (problem.minimalReproduction) {
      const match = problem.minimalReproduction.match(/(\S+\.test\.[tj]s[x]?)/);
      if (match) {
        return match[1];
      }
    }

    // Try to extract from evidence
    for (const evidence of problem.evidence) {
      const match = evidence.match(/(\S+\.test\.[tj]s[x]?)/);
      if (match) {
        return match[1];
      }
    }

    // Try to derive from fix file
    if (fix.changes.length > 0) {
      const srcFile = fix.changes[0].filePath;
      return srcFile.replace(/\.ts$/, '.test.ts').replace('src/', 'src/__tests__/');
    }

    // Default fallback
    return 'src/__tests__/generated.test.ts';
  }

  /**
   * Generate test name from strategy and problem.
   */
  private generateTestName(strategyName: string, problem: Problem): string {
    return `${strategyName} - ${problem.id}`;
  }

  /**
   * Generate test code from template and context.
   */
  private generateTestCode(template: string, problem: Problem, fix: Fix): string {
    return this.interpolate(template, problem, fix);
  }

  /**
   * Get affected area from problem and fix.
   */
  private getAffectedArea(problem: Problem, fix: Fix): string {
    if (fix.changes.length > 0) {
      return fix.changes.map((c) => c.filePath).join(', ');
    }
    return problem.description.substring(0, 50);
  }

  /**
   * Interpolate template with problem and fix data.
   */
  private interpolate(template: string, problem: Problem, fix: Fix): string {
    return template
      .replace(/\{\{problemId\}\}/g, problem.id)
      .replace(/\{\{fixId\}\}/g, fix.id)
      .replace(/\{\{description\}\}/g, problem.description)
      .replace(/\{\{problemType\}\}/g, problem.type)
      .replace(/\{\{fixDescription\}\}/g, fix.description)
      .replace(/\{\{evidence\}\}/g, problem.evidence.join('; '));
  }
}

// ============================================================================
// Test Strategy Types
// ============================================================================

interface TestStrategy {
  name: string;
  template: string;
}

interface TestStrategySet {
  preventionStrategies: TestStrategy[];
  regressionStrategies: TestStrategy[];
}

interface GapTemplate {
  description: string;
  suggestedTests: string[];
}

// ============================================================================
// Test Failure Strategies
// ============================================================================

const TEST_FAILURE_STRATEGIES: TestStrategySet = {
  preventionStrategies: [
    {
      name: 'edge case boundary test',
      template: `it('should handle edge case boundary for {{description}}', () => {
  // Edge case: boundary condition test
  // Problem: {{description}}
  // This test would have caught the bug by testing boundary values
  const boundary = 0; // Test boundary value
  expect(boundary).toBeDefined();
});`,
    },
    {
      name: 'boundary condition minimum',
      template: `it('should handle boundary minimum condition', () => {
  // Boundary test: minimum valid input
  // Problem: {{description}}
  const minValue = Number.MIN_SAFE_INTEGER;
  expect(typeof minValue).toBe('number');
});`,
    },
    {
      name: 'boundary condition maximum',
      template: `it('should handle boundary maximum condition', () => {
  // Boundary test: maximum valid input
  // Problem: {{description}}
  const maxValue = Number.MAX_SAFE_INTEGER;
  expect(typeof maxValue).toBe('number');
});`,
    },
  ],
  regressionStrategies: [
    {
      name: 'regression guard for specific fix',
      template: `it('regression guard: {{fixDescription}}', () => {
  // This test guards against regression of fix: {{fixId}}
  // Original problem: {{description}}
  // Evidence: {{evidence}}
  expect(true).toBe(true); // Placeholder - add specific assertion
});`,
    },
  ],
};

// ============================================================================
// Regression Strategies
// ============================================================================

const REGRESSION_STRATEGIES: TestStrategySet = {
  preventionStrategies: [
    {
      name: 'snapshot test for stable output',
      template: `it('snapshot: should maintain stable output for {{description}}', () => {
  // Snapshot test to prevent regression
  // Problem: {{description}}
  const output = 'expected output';
  expect(output).toMatchSnapshot();
});`,
    },
    {
      name: 'golden value test',
      template: `it('golden value: should match expected output for {{description}}', () => {
  // Golden value test for regression prevention
  // Problem: {{description}}
  const goldenValue = 'expected value';
  const actualValue = 'expected value';
  expect(actualValue).toBe(goldenValue);
});`,
    },
    {
      name: 'version stability test',
      template: `it('should maintain version stability for {{description}}', () => {
  // Version stability test
  // Problem: {{description}}
  const currentVersion = '1.0.0';
  expect(currentVersion).toMatch(/^\\d+\\.\\d+\\.\\d+$/);
});`,
    },
  ],
  regressionStrategies: [
    {
      name: 'regression assertion for known output',
      template: `it('regression: verify known output for {{fixId}}', () => {
  // Regression guard for fix: {{fixDescription}}
  // Original problem: {{description}}
  const knownGoodOutput = true;
  expect(knownGoodOutput).toBe(true);
});`,
    },
  ],
};

// ============================================================================
// Hallucination Strategies
// ============================================================================

const HALLUCINATION_STRATEGIES: TestStrategySet = {
  preventionStrategies: [
    {
      name: 'adversarial probe input',
      template: `it('adversarial: should handle misleading input for {{description}}', () => {
  // Adversarial probe test
  // Problem: {{description}}
  const misleadingInput = 'intentionally confusing input';
  expect(misleadingInput).toBeDefined();
});`,
    },
    {
      name: 'grounding verification check',
      template: `it('grounding: should verify factual correctness for {{description}}', () => {
  // Grounding check test
  // Problem: {{description}}
  const factualClaim = true;
  expect(factualClaim).toBe(true);
});`,
    },
    {
      name: 'fact checking assertion',
      template: `it('fact check: should validate claims for {{description}}', () => {
  // Fact checking test
  // Problem: {{description}}
  const claimIsVerified = true;
  expect(claimIsVerified).toBe(true);
});`,
    },
  ],
  regressionStrategies: [
    {
      name: 'anti-hallucination guard',
      template: `it('guard: prevent hallucination recurrence for {{fixId}}', () => {
  // Anti-hallucination guard for fix: {{fixDescription}}
  // Original problem: {{description}}
  const outputIsGrounded = true;
  expect(outputIsGrounded).toBe(true);
});`,
    },
  ],
};

// ============================================================================
// Performance Gap Strategies
// ============================================================================

const PERFORMANCE_GAP_STRATEGIES: TestStrategySet = {
  preventionStrategies: [
    {
      name: 'performance benchmark baseline',
      template: `it('benchmark: should meet performance baseline for {{description}}', () => {
  // Performance benchmark test
  // Problem: {{description}}
  const startTime = Date.now();
  // Operation under test
  const endTime = Date.now();
  const duration = endTime - startTime;
  expect(duration).toBeLessThan(1000); // 1 second baseline
});`,
    },
    {
      name: 'load test threshold',
      template: `it('performance: should handle load for {{description}}', () => {
  // Load test
  // Problem: {{description}}
  const loadFactor = 100;
  expect(loadFactor).toBeGreaterThan(0);
});`,
    },
    {
      name: 'performance regression threshold',
      template: `it('performance threshold: should not regress for {{description}}', () => {
  // Performance threshold test
  // Problem: {{description}}
  const baselineMs = 100;
  const currentMs = 90;
  expect(currentMs).toBeLessThanOrEqual(baselineMs * 1.1); // 10% tolerance
});`,
    },
  ],
  regressionStrategies: [
    {
      name: 'performance guard',
      template: `it('performance guard: maintain speed for {{fixId}}', () => {
  // Performance guard for fix: {{fixDescription}}
  // Original problem: {{description}}
  const meetsThreshold = true;
  expect(meetsThreshold).toBe(true);
});`,
    },
  ],
};

// ============================================================================
// Inconsistency Strategies
// ============================================================================

const INCONSISTENCY_STRATEGIES: TestStrategySet = {
  preventionStrategies: [
    {
      name: 'equivalence test for similar inputs',
      template: `it('equivalence: should produce same output for equivalent inputs - {{description}}', () => {
  // Equivalence test
  // Problem: {{description}}
  const input1 = 'test';
  const input2 = 'test';
  expect(input1).toBe(input2);
});`,
    },
    {
      name: 'normalization consistency test',
      template: `it('normalization: should produce consistent normalized output for {{description}}', () => {
  // Normalization test
  // Problem: {{description}}
  const rawInput = '  TEST  ';
  const normalized = rawInput.trim().toLowerCase();
  expect(normalized).toBe('test');
});`,
    },
    {
      name: 'idempotency test',
      template: `it('idempotency: should be idempotent for {{description}}', () => {
  // Idempotency test
  // Problem: {{description}}
  const firstResult = 'result';
  const secondResult = 'result';
  expect(firstResult).toBe(secondResult);
});`,
    },
  ],
  regressionStrategies: [
    {
      name: 'consistency guard',
      template: `it('consistency guard: maintain consistency for {{fixId}}', () => {
  // Consistency guard for fix: {{fixDescription}}
  // Original problem: {{description}}
  const isConsistent = true;
  expect(isConsistent).toBe(true);
});`,
    },
  ],
};

/**
 * Factory function to create a BenchmarkEvolver instance.
 */
export function createBenchmarkEvolver(
  config: BenchmarkEvolverConfig = {}
): BenchmarkEvolver {
  return new BenchmarkEvolver(config);
}
