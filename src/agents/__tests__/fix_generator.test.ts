/**
 * @fileoverview Tests for FixGeneratorAgent
 *
 * Following TDD: this test file is created BEFORE implementation.
 * Tests should FAIL initially, then PASS after implementation.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createFixGenerator } from '../fix_generator.js';
import type { LibrarianStorage } from '../../storage/types.js';
import type {
  Problem,
  Hypothesis,
  HypothesisTestResult,
  FixGeneratorInput,
  FixGeneratorReport,
  Fix,
  FileChange,
  FileChangeType,
} from '../types.js';

describe('FixGenerator', () => {
  describe('Agent metadata', () => {
    it('returns agent with correct agentType', () => {
      const generator = createFixGenerator();
      expect(generator.agentType).toBe('fix_generator');
    });

    it('returns agent with correct name', () => {
      const generator = createFixGenerator();
      expect(generator.name).toBe('Fix Generator');
    });

    it('returns agent with fix_generation capability', () => {
      const generator = createFixGenerator();
      expect(generator.capabilities).toContain('fix_generation');
    });

    it('returns agent with version string', () => {
      const generator = createFixGenerator();
      expect(generator.version).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('returns agent with qualityTier', () => {
      const generator = createFixGenerator();
      expect(generator.qualityTier).toBe('full');
    });
  });

  describe('Agent lifecycle', () => {
    it('isReady returns false before initialization', () => {
      const generator = createFixGenerator();
      expect(generator.isReady()).toBe(false);
    });

    it('isReady returns true after initialization', async () => {
      const generator = createFixGenerator();
      await generator.initialize({} as LibrarianStorage);
      expect(generator.isReady()).toBe(true);
    });

    it('isReady returns false after shutdown', async () => {
      const generator = createFixGenerator();
      await generator.initialize({} as LibrarianStorage);
      await generator.shutdown();
      expect(generator.isReady()).toBe(false);
    });
  });

  describe('generateFix', () => {
    let generator: ReturnType<typeof createFixGenerator>;

    const baseTestResult: HypothesisTestResult = {
      hypothesisId: 'HYP-PROB-TEST-1-A',
      verdict: 'supported',
      evidence: [
        {
          type: 'log_analysis',
          finding: 'Assertion mismatch in test output',
          implication: 'Test assertion is incorrect',
        },
      ],
      confidence: 0.85,
      recommendation: 'proceed_to_fix',
    };

    beforeEach(async () => {
      generator = createFixGenerator();
      await generator.initialize({} as LibrarianStorage);
    });

    describe('FixGeneratorReport structure', () => {
      const testFailureProblem: Problem = {
        id: 'PROB-TEST-1',
        type: 'test_failure',
        description: 'Test command failed: npm test -- --run some.test.ts',
        evidence: ['FAIL: expected true, got false', 'at line 42'],
        severity: 'high',
        reproducible: true,
        minimalReproduction: 'npm test -- --run some.test.ts',
      };

      const testFailureHypothesis: Hypothesis = {
        id: 'HYP-PROB-TEST-1-A',
        statement: 'The test assertion logic is incorrect or outdated',
        rationale: 'Test assertions may not reflect current expected behavior',
        prediction: 'Inspecting the test will reveal assertions that do not match',
        test: {
          type: 'code_inspection',
          target: 'test file assertions',
          expected: 'Assertion mismatch with documented behavior',
        },
        likelihood: 'high',
      };

      it('returns report with fixes array', () => {
        const input: FixGeneratorInput = {
          problem: testFailureProblem,
          hypothesis: testFailureHypothesis,
          testResult: baseTestResult,
        };

        const report = generator.generateFix(input);
        expect(Array.isArray(report.fixes)).toBe(true);
        expect(report.fixes.length).toBeGreaterThan(0);
      });

      it('returns report with preferred fix ID', () => {
        const input: FixGeneratorInput = {
          problem: testFailureProblem,
          hypothesis: testFailureHypothesis,
          testResult: baseTestResult,
        };

        const report = generator.generateFix(input);
        expect(report.preferred).toBeTruthy();
        expect(report.fixes.some((f) => f.id === report.preferred)).toBe(true);
      });

      it('returns report with alternatives array', () => {
        const input: FixGeneratorInput = {
          problem: testFailureProblem,
          hypothesis: testFailureHypothesis,
          testResult: baseTestResult,
        };

        const report = generator.generateFix(input);
        expect(Array.isArray(report.alternatives)).toBe(true);
      });

      it('alternatives do not include preferred', () => {
        const input: FixGeneratorInput = {
          problem: testFailureProblem,
          hypothesis: testFailureHypothesis,
          testResult: baseTestResult,
        };

        const report = generator.generateFix(input);
        expect(report.alternatives.includes(report.preferred)).toBe(false);
      });
    });

    describe('Fix structure', () => {
      const problem: Problem = {
        id: 'PROB-TEST-1',
        type: 'test_failure',
        description: 'Test failed with assertion error',
        evidence: ['expected: 5, got: 3'],
        severity: 'high',
        reproducible: true,
      };

      const hypothesis: Hypothesis = {
        id: 'HYP-PROB-TEST-1-A',
        statement: 'Implementation returns wrong value',
        rationale: 'Function logic may be incorrect',
        prediction: 'Fix will correct the calculation',
        test: { type: 'code_inspection', target: 'implementation', expected: 'logic error' },
        likelihood: 'high',
      };

      it('fix has unique id', () => {
        const input: FixGeneratorInput = {
          problem,
          hypothesis,
          testResult: baseTestResult,
        };

        const report = generator.generateFix(input);
        const fix = report.fixes[0];
        expect(fix.id).toMatch(/^FIX-/);
      });

      it('fix references problemId', () => {
        const input: FixGeneratorInput = {
          problem,
          hypothesis,
          testResult: baseTestResult,
        };

        const report = generator.generateFix(input);
        const fix = report.fixes[0];
        expect(fix.problemId).toBe('PROB-TEST-1');
      });

      it('fix references hypothesisId', () => {
        const input: FixGeneratorInput = {
          problem,
          hypothesis,
          testResult: baseTestResult,
        };

        const report = generator.generateFix(input);
        const fix = report.fixes[0];
        expect(fix.hypothesisId).toBe('HYP-PROB-TEST-1-A');
      });

      it('fix has description', () => {
        const input: FixGeneratorInput = {
          problem,
          hypothesis,
          testResult: baseTestResult,
        };

        const report = generator.generateFix(input);
        const fix = report.fixes[0];
        expect(fix.description).toBeTruthy();
        expect(fix.description.length).toBeGreaterThan(10);
      });

      it('fix has changes array', () => {
        const input: FixGeneratorInput = {
          problem,
          hypothesis,
          testResult: baseTestResult,
        };

        const report = generator.generateFix(input);
        const fix = report.fixes[0];
        expect(Array.isArray(fix.changes)).toBe(true);
        expect(fix.changes.length).toBeGreaterThan(0);
      });

      it('fix has rationale', () => {
        const input: FixGeneratorInput = {
          problem,
          hypothesis,
          testResult: baseTestResult,
        };

        const report = generator.generateFix(input);
        const fix = report.fixes[0];
        expect(fix.rationale).toBeTruthy();
      });

      it('fix has prediction', () => {
        const input: FixGeneratorInput = {
          problem,
          hypothesis,
          testResult: baseTestResult,
        };

        const report = generator.generateFix(input);
        const fix = report.fixes[0];
        expect(fix.prediction).toBeTruthy();
      });
    });

    describe('FileChange structure', () => {
      const problem: Problem = {
        id: 'PROB-TEST-1',
        type: 'test_failure',
        description: 'Test failed',
        evidence: ['assertion error'],
        severity: 'high',
        reproducible: true,
      };

      const hypothesis: Hypothesis = {
        id: 'HYP-PROB-TEST-1-A',
        statement: 'Code has bug',
        rationale: 'Logic error',
        prediction: 'Fix will resolve',
        test: { type: 'code_inspection', target: 'file', expected: 'bug' },
        likelihood: 'high',
      };

      it('fileChange has filePath', () => {
        const input: FixGeneratorInput = {
          problem,
          hypothesis,
          testResult: baseTestResult,
        };

        const report = generator.generateFix(input);
        const change = report.fixes[0].changes[0];
        expect(change.filePath).toBeTruthy();
      });

      it('fileChange has valid changeType', () => {
        const input: FixGeneratorInput = {
          problem,
          hypothesis,
          testResult: baseTestResult,
        };

        const report = generator.generateFix(input);
        const change = report.fixes[0].changes[0];
        const validTypes: FileChangeType[] = ['modify', 'create', 'delete'];
        expect(validTypes).toContain(change.changeType);
      });

      it('fileChange has description', () => {
        const input: FixGeneratorInput = {
          problem,
          hypothesis,
          testResult: baseTestResult,
        };

        const report = generator.generateFix(input);
        const change = report.fixes[0].changes[0];
        expect(change.description).toBeTruthy();
      });

      it('modify changeType has before and after', () => {
        const input: FixGeneratorInput = {
          problem,
          hypothesis,
          testResult: baseTestResult,
        };

        const report = generator.generateFix(input);
        const modifyChange = report.fixes
          .flatMap((f) => f.changes)
          .find((c) => c.changeType === 'modify');

        // If there's a modify change, it should have before/after
        if (modifyChange) {
          expect(modifyChange.before).toBeDefined();
          expect(modifyChange.after).toBeDefined();
        }
      });
    });

    describe('Problem type: test_failure', () => {
      const testFailureProblem: Problem = {
        id: 'PROB-TEST-FAILURE-1',
        type: 'test_failure',
        description: 'Test failed: expected 5, got 3',
        evidence: ['AssertionError: expected 5, got 3', 'at calculator.test.ts:42'],
        severity: 'high',
        reproducible: true,
        minimalReproduction: 'npm test -- --run calculator.test.ts',
      };

      const assertionHypothesis: Hypothesis = {
        id: 'HYP-TEST-FAILURE-A',
        statement: 'Test assertion is incorrect',
        rationale: 'The expected value may be outdated',
        prediction: 'Updating assertion will fix test',
        test: { type: 'code_inspection', target: 'test assertion', expected: 'wrong expected value' },
        likelihood: 'high',
      };

      const implementationHypothesis: Hypothesis = {
        id: 'HYP-TEST-FAILURE-B',
        statement: 'Implementation has bug',
        rationale: 'The function logic is incorrect',
        prediction: 'Fixing implementation will fix test',
        test: { type: 'code_inspection', target: 'implementation', expected: 'logic error' },
        likelihood: 'medium',
      };

      it('generates fix for assertion-related hypothesis', () => {
        const input: FixGeneratorInput = {
          problem: testFailureProblem,
          hypothesis: assertionHypothesis,
          testResult: baseTestResult,
        };

        const report = generator.generateFix(input);
        expect(report.fixes.length).toBeGreaterThan(0);

        // Should suggest fixing the assertion
        const hasAssertionFix = report.fixes.some(
          (f) => f.description.toLowerCase().includes('assertion') ||
                 f.changes.some((c) => c.description.toLowerCase().includes('assertion'))
        );
        expect(hasAssertionFix).toBe(true);
      });

      it('generates fix for implementation-related hypothesis', () => {
        const input: FixGeneratorInput = {
          problem: testFailureProblem,
          hypothesis: implementationHypothesis,
          testResult: baseTestResult,
        };

        const report = generator.generateFix(input);
        expect(report.fixes.length).toBeGreaterThan(0);

        // Should suggest fixing the implementation
        const hasImplementationFix = report.fixes.some(
          (f) => f.description.toLowerCase().includes('implement') ||
                 f.description.toLowerCase().includes('logic') ||
                 f.description.toLowerCase().includes('fix')
        );
        expect(hasImplementationFix).toBe(true);
      });
    });

    describe('Problem type: regression', () => {
      const regressionProblem: Problem = {
        id: 'PROB-REGRESSION-1',
        type: 'regression',
        description: 'Query returns different results after update',
        evidence: ['Expected: foo, Got: bar', 'Change introduced in commit abc123'],
        severity: 'high',
        reproducible: true,
      };

      const regressionHypothesis: Hypothesis = {
        id: 'HYP-REGRESSION-A',
        statement: 'Recent change broke behavior',
        rationale: 'A recent commit altered the expected behavior',
        prediction: 'Reverting or fixing change will restore behavior',
        test: { type: 'code_inspection', target: 'recent changes', expected: 'breaking change' },
        likelihood: 'high',
      };

      it('generates fix for regression problem', () => {
        const input: FixGeneratorInput = {
          problem: regressionProblem,
          hypothesis: regressionHypothesis,
          testResult: baseTestResult,
        };

        const report = generator.generateFix(input);
        expect(report.fixes.length).toBeGreaterThan(0);

        // Should suggest revert or fix
        const hasRegressionFix = report.fixes.some(
          (f) => f.description.toLowerCase().includes('revert') ||
                 f.description.toLowerCase().includes('restore') ||
                 f.description.toLowerCase().includes('config') ||
                 f.description.toLowerCase().includes('fix')
        );
        expect(hasRegressionFix).toBe(true);
      });
    });

    describe('Problem type: hallucination', () => {
      const hallucinationProblem: Problem = {
        id: 'PROB-HALLUCINATION-1',
        type: 'hallucination',
        description: 'System returned non-existent function name',
        evidence: ['Claimed function "calculateTotal" exists but it does not'],
        severity: 'critical',
        reproducible: true,
      };

      const hallucinationHypothesis: Hypothesis = {
        id: 'HYP-HALLUCINATION-A',
        statement: 'Retrieval filter is too permissive',
        rationale: 'Filter allows low-confidence matches',
        prediction: 'Tightening filter will prevent hallucination',
        test: { type: 'code_inspection', target: 'retrieval filter', expected: 'permissive threshold' },
        likelihood: 'high',
      };

      it('generates fix for hallucination problem', () => {
        const input: FixGeneratorInput = {
          problem: hallucinationProblem,
          hypothesis: hallucinationHypothesis,
          testResult: baseTestResult,
        };

        const report = generator.generateFix(input);
        expect(report.fixes.length).toBeGreaterThan(0);

        // Should suggest improving retrieval or grounding
        const hasHallucinationFix = report.fixes.some(
          (f) => f.description.toLowerCase().includes('retrieval') ||
                 f.description.toLowerCase().includes('filter') ||
                 f.description.toLowerCase().includes('ground') ||
                 f.description.toLowerCase().includes('context') ||
                 f.description.toLowerCase().includes('threshold')
        );
        expect(hasHallucinationFix).toBe(true);
      });
    });

    describe('Problem type: performance_gap', () => {
      const performanceProblem: Problem = {
        id: 'PROB-PERF-1',
        type: 'performance_gap',
        description: 'Treatment group not outperforming control',
        evidence: ['Control: 60%, Treatment: 58%', 'Expected: >25% lift'],
        severity: 'high',
        reproducible: true,
      };

      const performanceHypothesis: Hypothesis = {
        id: 'HYP-PERF-A',
        statement: 'Algorithm is inefficient',
        rationale: 'Algorithm has O(n^2) complexity',
        prediction: 'Optimizing algorithm will improve performance',
        test: { type: 'code_inspection', target: 'algorithm', expected: 'inefficient code' },
        likelihood: 'high',
      };

      it('generates fix for performance gap problem', () => {
        const input: FixGeneratorInput = {
          problem: performanceProblem,
          hypothesis: performanceHypothesis,
          testResult: baseTestResult,
        };

        const report = generator.generateFix(input);
        expect(report.fixes.length).toBeGreaterThan(0);

        // Should suggest optimization
        const hasPerformanceFix = report.fixes.some(
          (f) => f.description.toLowerCase().includes('optim') ||
                 f.description.toLowerCase().includes('cache') ||
                 f.description.toLowerCase().includes('algorithm') ||
                 f.description.toLowerCase().includes('performance')
        );
        expect(hasPerformanceFix).toBe(true);
      });
    });

    describe('Problem type: inconsistency', () => {
      const inconsistencyProblem: Problem = {
        id: 'PROB-INCONSIST-1',
        type: 'inconsistency',
        description: 'Same question with different phrasing gives different answers',
        evidence: [
          'Q1: "What does foo do?" -> A1: "Returns sum"',
          'Q2: "Describe foo function" -> A2: "Calculates product"',
        ],
        severity: 'high',
        reproducible: true,
      };

      const inconsistencyHypothesis: Hypothesis = {
        id: 'HYP-INCONSIST-A',
        statement: 'Input normalization is missing',
        rationale: 'Different phrasings are not normalized',
        prediction: 'Normalizing inputs will produce consistent results',
        test: { type: 'code_inspection', target: 'input processing', expected: 'no normalization' },
        likelihood: 'high',
      };

      it('generates fix for inconsistency problem', () => {
        const input: FixGeneratorInput = {
          problem: inconsistencyProblem,
          hypothesis: inconsistencyHypothesis,
          testResult: baseTestResult,
        };

        const report = generator.generateFix(input);
        expect(report.fixes.length).toBeGreaterThan(0);

        // Should suggest normalization or consistency fix
        const hasInconsistencyFix = report.fixes.some(
          (f) => f.description.toLowerCase().includes('normal') ||
                 f.description.toLowerCase().includes('consist') ||
                 f.description.toLowerCase().includes('embed') ||
                 f.description.toLowerCase().includes('input')
        );
        expect(hasInconsistencyFix).toBe(true);
      });
    });

    describe('Fix principles', () => {
      const problem: Problem = {
        id: 'PROB-PRINCIPLE-1',
        type: 'test_failure',
        description: 'Test failed',
        evidence: ['expected: X, got: Y'],
        severity: 'high',
        reproducible: true,
      };

      const hypothesis: Hypothesis = {
        id: 'HYP-PRINCIPLE-A',
        statement: 'Bug in code',
        rationale: 'Logic error',
        prediction: 'Fix will resolve',
        test: { type: 'code_inspection', target: 'code', expected: 'bug' },
        likelihood: 'high',
      };

      it('generates minimal fixes (principle 1)', () => {
        const input: FixGeneratorInput = {
          problem,
          hypothesis,
          testResult: baseTestResult,
        };

        const report = generator.generateFix(input);
        const fix = report.fixes[0];

        // Fixes should be minimal - not too many changes
        expect(fix.changes.length).toBeLessThanOrEqual(5);
      });

      it('fix rationale explains root cause (principle 3)', () => {
        const input: FixGeneratorInput = {
          problem,
          hypothesis,
          testResult: baseTestResult,
        };

        const report = generator.generateFix(input);
        const fix = report.fixes[0];

        // Rationale should reference the hypothesis
        expect(fix.rationale.length).toBeGreaterThan(10);
      });

      it('fix prediction describes expected outcome (principle 4)', () => {
        const input: FixGeneratorInput = {
          problem,
          hypothesis,
          testResult: baseTestResult,
        };

        const report = generator.generateFix(input);
        const fix = report.fixes[0];

        // Prediction should describe what happens after fix
        expect(fix.prediction.length).toBeGreaterThan(10);
      });
    });

    describe('codebaseContext', () => {
      const problem: Problem = {
        id: 'PROB-CTX-1',
        type: 'test_failure',
        description: 'Test failed',
        evidence: ['error'],
        severity: 'high',
        reproducible: true,
      };

      const hypothesis: Hypothesis = {
        id: 'HYP-CTX-A',
        statement: 'Bug exists',
        rationale: 'Logic error',
        prediction: 'Fix will work',
        test: { type: 'code_inspection', target: 'code', expected: 'bug' },
        likelihood: 'high',
      };

      it('accepts optional codebaseContext without error', () => {
        const input: FixGeneratorInput = {
          problem,
          hypothesis,
          testResult: baseTestResult,
          codebaseContext: 'This is a TypeScript project using Vitest for testing.',
        };

        expect(() => generator.generateFix(input)).not.toThrow();
      });

      it('still produces a report when codebaseContext is provided', () => {
        const input: FixGeneratorInput = {
          problem,
          hypothesis,
          testResult: baseTestResult,
          codebaseContext: 'This is a TypeScript project using Vitest for testing.',
        };

        const report = generator.generateFix(input);
        expect(report.fixes.length).toBeGreaterThan(0);
        expect(report.preferred).toBeTruthy();
      });
    });

    describe('Multiple fixes and ranking', () => {
      const problem: Problem = {
        id: 'PROB-MULTI-1',
        type: 'test_failure',
        description: 'Test failed with multiple potential causes',
        evidence: ['assertion error', 'possible fixture issue', 'implementation may be wrong'],
        severity: 'high',
        reproducible: true,
      };

      const hypothesis: Hypothesis = {
        id: 'HYP-MULTI-A',
        statement: 'Multiple potential root causes',
        rationale: 'Evidence suggests several issues',
        prediction: 'One of the fixes will resolve the issue',
        test: { type: 'log_analysis', target: 'test output', expected: 'multiple errors' },
        likelihood: 'high',
      };

      it('can generate multiple alternative fixes', () => {
        const input: FixGeneratorInput = {
          problem,
          hypothesis,
          testResult: {
            ...baseTestResult,
            evidence: [
              { type: 'log_analysis', finding: 'Error 1', implication: 'Issue 1' },
              { type: 'log_analysis', finding: 'Error 2', implication: 'Issue 2' },
            ],
          },
        };

        const report = generator.generateFix(input);

        // Should have at least one preferred fix
        expect(report.preferred).toBeTruthy();

        // All alternatives should be valid fix IDs (if any)
        for (const altId of report.alternatives) {
          expect(report.fixes.some((f) => f.id === altId)).toBe(true);
        }
      });

      it('preferred fix is not in alternatives', () => {
        const input: FixGeneratorInput = {
          problem,
          hypothesis,
          testResult: baseTestResult,
        };

        const report = generator.generateFix(input);
        expect(report.alternatives.includes(report.preferred)).toBe(false);
      });
    });
  });
});
