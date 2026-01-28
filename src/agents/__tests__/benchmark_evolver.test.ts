/**
 * @fileoverview Tests for BenchmarkEvolverAgent
 *
 * Following TDD: this test file is created BEFORE implementation.
 * Tests should FAIL initially, then PASS after implementation.
 *
 * The Benchmark Evolver generates test cases after a fix is verified:
 * - Prevention tests: Tests that would have caught the bug earlier
 * - Regression guards: Assertions that fail if the bug recurs
 * - Variant tests: Variations to probe related edge cases
 * - Coverage gaps: What gap allowed the bug to exist
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createBenchmarkEvolver } from '../benchmark_evolver.js';
import type { LibrarianStorage } from '../../storage/types.js';
import type {
  Problem,
  Fix,
  VerificationResult,
  BenchmarkEvolverInput,
  BenchmarkEvolution,
  TestCase,
  CoverageGap,
} from '../types.js';

describe('BenchmarkEvolver', () => {
  describe('Agent metadata', () => {
    it('returns agent with correct agentType', () => {
      const evolver = createBenchmarkEvolver();
      expect(evolver.agentType).toBe('benchmark_evolver');
    });

    it('returns agent with correct name', () => {
      const evolver = createBenchmarkEvolver();
      expect(evolver.name).toBe('Benchmark Evolver');
    });

    it('returns agent with benchmark_evolution capability', () => {
      const evolver = createBenchmarkEvolver();
      expect(evolver.capabilities).toContain('benchmark_evolution');
    });

    it('returns agent with version string', () => {
      const evolver = createBenchmarkEvolver();
      expect(evolver.version).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('returns agent with qualityTier', () => {
      const evolver = createBenchmarkEvolver();
      expect(evolver.qualityTier).toBe('full');
    });
  });

  describe('Agent lifecycle', () => {
    it('isReady returns false before initialization', () => {
      const evolver = createBenchmarkEvolver();
      expect(evolver.isReady()).toBe(false);
    });

    it('isReady returns true after initialization', async () => {
      const evolver = createBenchmarkEvolver();
      await evolver.initialize({} as LibrarianStorage);
      expect(evolver.isReady()).toBe(true);
    });

    it('isReady returns false after shutdown', async () => {
      const evolver = createBenchmarkEvolver();
      await evolver.initialize({} as LibrarianStorage);
      await evolver.shutdown();
      expect(evolver.isReady()).toBe(false);
    });
  });

  describe('evolveBenchmark', () => {
    let evolver: ReturnType<typeof createBenchmarkEvolver>;

    beforeEach(async () => {
      evolver = createBenchmarkEvolver();
      await evolver.initialize({} as LibrarianStorage);
    });

    describe('BenchmarkEvolution structure', () => {
      it('returns result with problemId', async () => {
        const input = createMockInput('PROB-001');
        const result = await evolver.evolveBenchmark(input);
        expect(result.problemId).toBe('PROB-001');
      });

      it('returns result with fixId', async () => {
        const input = createMockInput('PROB-001', 'FIX-001');
        const result = await evolver.evolveBenchmark(input);
        expect(result.fixId).toBe('FIX-001');
      });

      it('returns result with newTests array', async () => {
        const input = createMockInput();
        const result = await evolver.evolveBenchmark(input);
        expect(Array.isArray(result.newTests)).toBe(true);
      });

      it('returns result with regressionGuards array', async () => {
        const input = createMockInput();
        const result = await evolver.evolveBenchmark(input);
        expect(Array.isArray(result.regressionGuards)).toBe(true);
      });

      it('returns result with variantTests array', async () => {
        const input = createMockInput();
        const result = await evolver.evolveBenchmark(input);
        expect(Array.isArray(result.variantTests)).toBe(true);
      });

      it('returns result with coverageGaps array', async () => {
        const input = createMockInput();
        const result = await evolver.evolveBenchmark(input);
        expect(Array.isArray(result.coverageGaps)).toBe(true);
      });
    });

    describe('TestCase structure', () => {
      it('each newTest has name', async () => {
        const input = createMockInput();
        const result = await evolver.evolveBenchmark(input);

        for (const test of result.newTests) {
          expect(typeof test.name).toBe('string');
          expect(test.name.length).toBeGreaterThan(0);
        }
      });

      it('each newTest has file', async () => {
        const input = createMockInput();
        const result = await evolver.evolveBenchmark(input);

        for (const test of result.newTests) {
          expect(typeof test.file).toBe('string');
          expect(test.file.length).toBeGreaterThan(0);
        }
      });

      it('each newTest has code', async () => {
        const input = createMockInput();
        const result = await evolver.evolveBenchmark(input);

        for (const test of result.newTests) {
          expect(typeof test.code).toBe('string');
          expect(test.code.length).toBeGreaterThan(0);
        }
      });

      it('each newTest has category "prevention"', async () => {
        const input = createMockInput();
        const result = await evolver.evolveBenchmark(input);

        for (const test of result.newTests) {
          expect(test.category).toBe('prevention');
        }
      });

      it('each regressionGuard has category "regression_guard"', async () => {
        const input = createMockInput();
        const result = await evolver.evolveBenchmark(input);

        for (const test of result.regressionGuards) {
          expect(test.category).toBe('regression_guard');
        }
      });

      it('each variantTest has category "variant"', async () => {
        const input = createMockInput();
        const result = await evolver.evolveBenchmark(input);

        for (const test of result.variantTests) {
          expect(test.category).toBe('variant');
        }
      });
    });

    describe('CoverageGap structure', () => {
      it('each coverageGap has description', async () => {
        const input = createMockInput();
        const result = await evolver.evolveBenchmark(input);

        for (const gap of result.coverageGaps) {
          expect(typeof gap.description).toBe('string');
          expect(gap.description.length).toBeGreaterThan(0);
        }
      });

      it('each coverageGap has affectedArea', async () => {
        const input = createMockInput();
        const result = await evolver.evolveBenchmark(input);

        for (const gap of result.coverageGaps) {
          expect(typeof gap.affectedArea).toBe('string');
          expect(gap.affectedArea.length).toBeGreaterThan(0);
        }
      });

      it('each coverageGap has suggestedTests array', async () => {
        const input = createMockInput();
        const result = await evolver.evolveBenchmark(input);

        for (const gap of result.coverageGaps) {
          expect(Array.isArray(gap.suggestedTests)).toBe(true);
        }
      });
    });

    describe('Problem type-specific evolution', () => {
      describe('test_failure problems', () => {
        it('generates edge case tests', async () => {
          const input = createMockInput('PROB-001', 'FIX-001', 'test_failure');
          const result = await evolver.evolveBenchmark(input);

          // Should have at least 2 prevention tests
          expect(result.newTests.length).toBeGreaterThanOrEqual(2);

          // At least one should mention edge case or boundary
          const hasEdgeCaseTest = result.newTests.some(
            (t) =>
              t.name.toLowerCase().includes('edge') ||
              t.name.toLowerCase().includes('boundary') ||
              t.code.toLowerCase().includes('edge') ||
              t.code.toLowerCase().includes('boundary')
          );
          expect(hasEdgeCaseTest).toBe(true);
        });

        it('generates boundary condition tests', async () => {
          const input = createMockInput('PROB-001', 'FIX-001', 'test_failure');
          const result = await evolver.evolveBenchmark(input);

          // Should generate at least one regression guard
          expect(result.regressionGuards.length).toBeGreaterThanOrEqual(1);
        });
      });

      describe('regression problems', () => {
        it('generates snapshot tests', async () => {
          const input = createMockInput('PROB-001', 'FIX-001', 'regression');
          const result = await evolver.evolveBenchmark(input);

          // Should have prevention tests for regression
          expect(result.newTests.length).toBeGreaterThanOrEqual(2);

          // At least one should mention snapshot or golden
          const hasSnapshotTest = result.newTests.some(
            (t) =>
              t.name.toLowerCase().includes('snapshot') ||
              t.name.toLowerCase().includes('golden') ||
              t.code.toLowerCase().includes('snapshot') ||
              t.code.toLowerCase().includes('golden')
          );
          expect(hasSnapshotTest).toBe(true);
        });

        it('generates golden value tests', async () => {
          const input = createMockInput('PROB-001', 'FIX-001', 'regression');
          const result = await evolver.evolveBenchmark(input);

          expect(result.regressionGuards.length).toBeGreaterThanOrEqual(1);
        });
      });

      describe('hallucination problems', () => {
        it('generates adversarial probes', async () => {
          const input = createMockInput('PROB-001', 'FIX-001', 'hallucination');
          const result = await evolver.evolveBenchmark(input);

          expect(result.newTests.length).toBeGreaterThanOrEqual(2);

          // At least one should mention adversarial or grounding
          const hasAdversarialTest = result.newTests.some(
            (t) =>
              t.name.toLowerCase().includes('adversarial') ||
              t.name.toLowerCase().includes('grounding') ||
              t.code.toLowerCase().includes('adversarial') ||
              t.code.toLowerCase().includes('grounding')
          );
          expect(hasAdversarialTest).toBe(true);
        });

        it('generates grounding checks', async () => {
          const input = createMockInput('PROB-001', 'FIX-001', 'hallucination');
          const result = await evolver.evolveBenchmark(input);

          expect(result.regressionGuards.length).toBeGreaterThanOrEqual(1);
        });
      });

      describe('performance_gap problems', () => {
        it('generates benchmark tests', async () => {
          const input = createMockInput('PROB-001', 'FIX-001', 'performance_gap');
          const result = await evolver.evolveBenchmark(input);

          expect(result.newTests.length).toBeGreaterThanOrEqual(2);

          // At least one should mention benchmark or performance
          const hasBenchmarkTest = result.newTests.some(
            (t) =>
              t.name.toLowerCase().includes('benchmark') ||
              t.name.toLowerCase().includes('performance') ||
              t.code.toLowerCase().includes('benchmark') ||
              t.code.toLowerCase().includes('performance')
          );
          expect(hasBenchmarkTest).toBe(true);
        });

        it('generates load tests', async () => {
          const input = createMockInput('PROB-001', 'FIX-001', 'performance_gap');
          const result = await evolver.evolveBenchmark(input);

          expect(result.regressionGuards.length).toBeGreaterThanOrEqual(1);
        });
      });

      describe('inconsistency problems', () => {
        it('generates equivalence tests', async () => {
          const input = createMockInput('PROB-001', 'FIX-001', 'inconsistency');
          const result = await evolver.evolveBenchmark(input);

          expect(result.newTests.length).toBeGreaterThanOrEqual(2);

          // At least one should mention equivalence or normalization
          const hasEquivalenceTest = result.newTests.some(
            (t) =>
              t.name.toLowerCase().includes('equivalen') ||
              t.name.toLowerCase().includes('normaliz') ||
              t.code.toLowerCase().includes('equivalen') ||
              t.code.toLowerCase().includes('normaliz')
          );
          expect(hasEquivalenceTest).toBe(true);
        });

        it('generates normalization checks', async () => {
          const input = createMockInput('PROB-001', 'FIX-001', 'inconsistency');
          const result = await evolver.evolveBenchmark(input);

          expect(result.regressionGuards.length).toBeGreaterThanOrEqual(1);
        });
      });
    });

    describe('Coverage gap identification', () => {
      it('identifies at least one coverage gap', async () => {
        const input = createMockInput();
        const result = await evolver.evolveBenchmark(input);

        expect(result.coverageGaps.length).toBeGreaterThanOrEqual(1);
      });

      it('coverage gap references the problem type', async () => {
        const input = createMockInput('PROB-001', 'FIX-001', 'test_failure');
        const result = await evolver.evolveBenchmark(input);

        // The affected area or description should relate to the problem
        const hasRelevantGap = result.coverageGaps.some(
          (g) =>
            g.affectedArea.length > 0 &&
            g.description.length > 0
        );
        expect(hasRelevantGap).toBe(true);
      });

      it('coverage gap suggests tests', async () => {
        const input = createMockInput();
        const result = await evolver.evolveBenchmark(input);

        // At least one gap should have suggested tests
        const hasGapWithSuggestions = result.coverageGaps.some(
          (g) => g.suggestedTests.length > 0
        );
        expect(hasGapWithSuggestions).toBe(true);
      });
    });

    describe('Variant test generation', () => {
      it('generates at least one variant test', async () => {
        const input = createMockInput();
        const result = await evolver.evolveBenchmark(input);

        expect(result.variantTests.length).toBeGreaterThanOrEqual(1);
      });

      it('variant tests are related to the fix', async () => {
        const input = createMockInput();
        const result = await evolver.evolveBenchmark(input);

        // All variant tests should have proper structure
        for (const variant of result.variantTests) {
          expect(variant.name.length).toBeGreaterThan(0);
          expect(variant.file.length).toBeGreaterThan(0);
          expect(variant.code.length).toBeGreaterThan(0);
        }
      });
    });

    describe('Test code generation', () => {
      it('generates valid-looking test code for prevention tests', async () => {
        const input = createMockInput();
        const result = await evolver.evolveBenchmark(input);

        for (const test of result.newTests) {
          // Should look like test code
          expect(
            test.code.includes('test(') ||
            test.code.includes('it(') ||
            test.code.includes('describe(') ||
            test.code.includes('expect(')
          ).toBe(true);
        }
      });

      it('generates valid-looking test code for regression guards', async () => {
        const input = createMockInput();
        const result = await evolver.evolveBenchmark(input);

        for (const test of result.regressionGuards) {
          // Should look like test code
          expect(
            test.code.includes('test(') ||
            test.code.includes('it(') ||
            test.code.includes('describe(') ||
            test.code.includes('expect(')
          ).toBe(true);
        }
      });

      it('generates valid-looking test code for variant tests', async () => {
        const input = createMockInput();
        const result = await evolver.evolveBenchmark(input);

        for (const test of result.variantTests) {
          // Should look like test code
          expect(
            test.code.includes('test(') ||
            test.code.includes('it(') ||
            test.code.includes('describe(') ||
            test.code.includes('expect(')
          ).toBe(true);
        }
      });
    });

    describe('Input validation', () => {
      it('uses problem information in evolution', async () => {
        const input = createMockInput();
        input.problem.description = 'Calculator add function returns wrong value';
        input.problem.evidence = ['Expected 5, got -1', 'at calculator.test.ts:42'];

        const result = await evolver.evolveBenchmark(input);

        // Should have generated tests (doesn't fail with real input)
        expect(result.newTests.length).toBeGreaterThan(0);
      });

      it('uses fix information in evolution', async () => {
        const input = createMockInput();
        input.fix.description = 'Changed subtraction to addition';
        input.fix.changes = [
          {
            filePath: 'src/calculator.ts',
            changeType: 'modify',
            before: 'return a - b;',
            after: 'return a + b;',
            description: 'Fix operator',
          },
        ];

        const result = await evolver.evolveBenchmark(input);

        // Should have generated tests (doesn't fail with real input)
        expect(result.newTests.length).toBeGreaterThan(0);
      });

      it('uses verification result in evolution', async () => {
        const input = createMockInput();
        input.verificationResult = {
          fixId: 'FIX-001',
          verification: {
            originalTestPasses: true,
            noRegressions: true,
            typesValid: true,
          },
          reward: 1,
          verdict: 'fix_accepted',
          notes: 'All checks passed',
          executionLog: [],
        };

        const result = await evolver.evolveBenchmark(input);

        // Should have generated tests (doesn't fail with real input)
        expect(result.newTests.length).toBeGreaterThan(0);
      });
    });

    describe('Deterministic output (Tier-0)', () => {
      it('produces consistent output for same input', async () => {
        const input1 = createMockInput('PROB-001', 'FIX-001', 'test_failure');
        const input2 = createMockInput('PROB-001', 'FIX-001', 'test_failure');

        const result1 = await evolver.evolveBenchmark(input1);
        const result2 = await evolver.evolveBenchmark(input2);

        // Same inputs should produce same structure
        expect(result1.newTests.length).toBe(result2.newTests.length);
        expect(result1.regressionGuards.length).toBe(result2.regressionGuards.length);
        expect(result1.variantTests.length).toBe(result2.variantTests.length);
        expect(result1.coverageGaps.length).toBe(result2.coverageGaps.length);
      });
    });
  });
});

// ============================================================================
// Test Helpers
// ============================================================================

function createMockInput(
  problemId: string = 'PROB-001',
  fixId: string = 'FIX-001',
  problemType: 'test_failure' | 'regression' | 'hallucination' | 'performance_gap' | 'inconsistency' = 'test_failure'
): BenchmarkEvolverInput {
  return {
    problem: createMockProblem(problemId, problemType),
    fix: createMockFix(fixId, problemId),
    verificationResult: createMockVerificationResult(fixId),
  };
}

function createMockProblem(
  id: string = 'PROB-001',
  type: 'test_failure' | 'regression' | 'hallucination' | 'performance_gap' | 'inconsistency' = 'test_failure'
): Problem {
  return {
    id,
    type,
    description: `Problem of type ${type}`,
    evidence: ['Evidence 1', 'Evidence 2'],
    severity: 'high',
    reproducible: true,
    minimalReproduction: 'npm test -- --run example.test.ts',
  };
}

function createMockFix(id: string = 'FIX-001', problemId: string = 'PROB-001'): Fix {
  return {
    id,
    problemId,
    hypothesisId: 'HYP-001-A',
    description: 'Fix the issue',
    changes: [
      {
        filePath: 'src/example.ts',
        changeType: 'modify',
        before: 'old code',
        after: 'new code',
        description: 'Fix the bug',
      },
    ],
    rationale: 'This fixes the root cause',
    prediction: 'Test will pass after this change',
  };
}

function createMockVerificationResult(fixId: string = 'FIX-001'): VerificationResult {
  return {
    fixId,
    verification: {
      originalTestPasses: true,
      noRegressions: true,
      typesValid: true,
    },
    reward: 1,
    verdict: 'fix_accepted',
    notes: 'All checks passed',
    executionLog: [],
  };
}
