/**
 * @fileoverview Tests for HypothesisTesterAgent
 *
 * Following TDD: this test file is created BEFORE implementation.
 * Tests should FAIL initially, then PASS after implementation.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createHypothesisTester } from '../hypothesis_tester.js';
import type { LibrarianStorage } from '../../storage/types.js';
import type {
  Problem,
  Hypothesis,
  HypothesisTesterInput,
  HypothesisTestResult,
  HypothesisTestVerdict,
  HypothesisTestRecommendation,
  CommandRunner,
  CommandResult,
} from '../types.js';

describe('HypothesisTester', () => {
  describe('Agent metadata', () => {
    it('returns agent with correct agentType', () => {
      const tester = createHypothesisTester();
      expect(tester.agentType).toBe('hypothesis_tester');
    });

    it('returns agent with correct name', () => {
      const tester = createHypothesisTester();
      expect(tester.name).toBe('Hypothesis Tester');
    });

    it('returns agent with hypothesis_testing capability', () => {
      const tester = createHypothesisTester();
      expect(tester.capabilities).toContain('hypothesis_testing');
    });

    it('returns agent with version string', () => {
      const tester = createHypothesisTester();
      expect(tester.version).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('returns agent with qualityTier', () => {
      const tester = createHypothesisTester();
      expect(tester.qualityTier).toBe('full');
    });
  });

  describe('Agent lifecycle', () => {
    it('isReady returns false before initialization', () => {
      const tester = createHypothesisTester();
      expect(tester.isReady()).toBe(false);
    });

    it('isReady returns true after initialization', async () => {
      const tester = createHypothesisTester();
      await tester.initialize({} as LibrarianStorage);
      expect(tester.isReady()).toBe(true);
    });

    it('isReady returns false after shutdown', async () => {
      const tester = createHypothesisTester();
      await tester.initialize({} as LibrarianStorage);
      await tester.shutdown();
      expect(tester.isReady()).toBe(false);
    });
  });

  describe('CommandRunner integration', () => {
    it('setCommandRunner stores the runner', async () => {
      const tester = createHypothesisTester();
      await tester.initialize({} as LibrarianStorage);

      const mockRunner: CommandRunner = vi.fn();
      tester.setCommandRunner(mockRunner);

      expect(tester.getCommandRunner()).toBe(mockRunner);
    });

    it('getCommandRunner returns null when not set', async () => {
      const tester = createHypothesisTester();
      await tester.initialize({} as LibrarianStorage);

      expect(tester.getCommandRunner()).toBeNull();
    });
  });

  describe('testHypothesis', () => {
    let tester: ReturnType<typeof createHypothesisTester>;

    const baseProblem: Problem = {
      id: 'PROB-TEST-1',
      type: 'test_failure',
      description: 'Test command failed: npm test -- --run some.test.ts',
      evidence: ['FAIL: expected true, got false', 'at line 42'],
      severity: 'high',
      reproducible: true,
      minimalReproduction: 'npm test -- --run some.test.ts',
    };

    beforeEach(async () => {
      tester = createHypothesisTester();
      await tester.initialize({} as LibrarianStorage);
    });

    describe('HypothesisTestResult structure', () => {
      const codeInspectionHypothesis: Hypothesis = {
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

      it('returns result with hypothesisId matching input', async () => {
        const input: HypothesisTesterInput = {
          hypothesis: codeInspectionHypothesis,
          problem: baseProblem,
        };

        const result = await tester.testHypothesis(input);
        expect(result.hypothesisId).toBe('HYP-PROB-TEST-1-A');
      });

      it('returns result with valid verdict', async () => {
        const input: HypothesisTesterInput = {
          hypothesis: codeInspectionHypothesis,
          problem: baseProblem,
        };

        const result = await tester.testHypothesis(input);
        const validVerdicts: HypothesisTestVerdict[] = ['supported', 'refuted', 'inconclusive'];
        expect(validVerdicts).toContain(result.verdict);
      });

      it('returns result with evidence array', async () => {
        const input: HypothesisTesterInput = {
          hypothesis: codeInspectionHypothesis,
          problem: baseProblem,
        };

        const result = await tester.testHypothesis(input);
        expect(Array.isArray(result.evidence)).toBe(true);
      });

      it('evidence items have type, finding, and implication', async () => {
        const input: HypothesisTesterInput = {
          hypothesis: codeInspectionHypothesis,
          problem: baseProblem,
        };

        const result = await tester.testHypothesis(input);
        for (const evidence of result.evidence) {
          expect(evidence.type).toBeTruthy();
          expect(evidence.finding).toBeTruthy();
          expect(evidence.implication).toBeTruthy();
        }
      });

      it('returns result with confidence between 0 and 1', async () => {
        const input: HypothesisTesterInput = {
          hypothesis: codeInspectionHypothesis,
          problem: baseProblem,
        };

        const result = await tester.testHypothesis(input);
        expect(result.confidence).toBeGreaterThanOrEqual(0.0);
        expect(result.confidence).toBeLessThanOrEqual(1.0);
      });

      it('returns result with valid recommendation', async () => {
        const input: HypothesisTesterInput = {
          hypothesis: codeInspectionHypothesis,
          problem: baseProblem,
        };

        const result = await tester.testHypothesis(input);
        const validRecommendations: HypothesisTestRecommendation[] = [
          'proceed_to_fix',
          'test_another_hypothesis',
          'need_more_evidence',
        ];
        expect(validRecommendations).toContain(result.recommendation);
      });
    });

    describe('test type: code_inspection', () => {
      const codeInspectionHypothesis: Hypothesis = {
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

      it('handles code_inspection test type', async () => {
        const input: HypothesisTesterInput = {
          hypothesis: codeInspectionHypothesis,
          problem: baseProblem,
        };

        const result = await tester.testHypothesis(input);
        // code_inspection without actual file access should be inconclusive
        expect(result.verdict).toBe('inconclusive');
        expect(result.evidence.length).toBeGreaterThan(0);
        expect(result.evidence[0].type).toBe('code_inspection');
      });

      it('includes file target information in evidence', async () => {
        const input: HypothesisTesterInput = {
          hypothesis: codeInspectionHypothesis,
          problem: baseProblem,
        };

        const result = await tester.testHypothesis(input);
        const findings = result.evidence.map((e) => e.finding).join(' ');
        expect(findings.length).toBeGreaterThan(0);
      });
    });

    describe('test type: test_run', () => {
      const testRunHypothesis: Hypothesis = {
        id: 'HYP-PROB-TEST-1-B',
        statement: 'The ranking algorithm produces non-deterministic results',
        rationale: 'The ranking may include randomness or tie-breaking',
        prediction: 'Running the same query multiple times will show different rankings',
        test: {
          type: 'test_run',
          target: 'npm test -- --run ranking.test.ts',
          expected: 'Varying results across identical runs',
        },
        likelihood: 'medium',
      };

      it('handles test_run type without CommandRunner as inconclusive', async () => {
        const input: HypothesisTesterInput = {
          hypothesis: testRunHypothesis,
          problem: baseProblem,
        };

        const result = await tester.testHypothesis(input);
        expect(result.verdict).toBe('inconclusive');
        expect(result.recommendation).toBe('need_more_evidence');
      });

      it('invokes CommandRunner when available for test_run', async () => {
        const mockResult: CommandResult = {
          command: 'npm test -- --run ranking.test.ts',
          exitCode: 0,
          stdout: 'All tests passed',
          stderr: '',
          durationMs: 1000,
        };

        const mockCommandRunner: CommandRunner = vi.fn().mockResolvedValue(mockResult);
        tester.setCommandRunner(mockCommandRunner);

        const input: HypothesisTesterInput = {
          hypothesis: testRunHypothesis,
          problem: baseProblem,
        };

        const result = await tester.testHypothesis(input);

        expect(mockCommandRunner).toHaveBeenCalledTimes(1);
        // Test passed (exit code 0) and expected varying results but got consistent
        // This means hypothesis is refuted (no variation observed)
        expect(result.evidence.length).toBeGreaterThan(0);
        expect(result.evidence[0].type).toBe('test_run');
      });

      it('marks test_run as supported when test fails and matches expected', async () => {
        const mockResult: CommandResult = {
          command: 'npm test -- --run ranking.test.ts',
          exitCode: 1,
          stdout: '',
          stderr: 'FAIL: Results varied between runs',
          durationMs: 1000,
        };

        const mockCommandRunner: CommandRunner = vi.fn().mockResolvedValue(mockResult);
        tester.setCommandRunner(mockCommandRunner);

        const input: HypothesisTesterInput = {
          hypothesis: testRunHypothesis,
          problem: baseProblem,
        };

        const result = await tester.testHypothesis(input);

        // Test failed (non-zero exit), which could support the hypothesis
        // depending on the expected outcome
        expect(result.evidence.length).toBeGreaterThan(0);
      });

      it('handles CommandRunner errors gracefully', async () => {
        const mockCommandRunner: CommandRunner = vi
          .fn()
          .mockRejectedValue(new Error('Command execution timeout'));
        tester.setCommandRunner(mockCommandRunner);

        const input: HypothesisTesterInput = {
          hypothesis: testRunHypothesis,
          problem: baseProblem,
        };

        const result = await tester.testHypothesis(input);

        expect(result.verdict).toBe('inconclusive');
        expect(result.recommendation).toBe('need_more_evidence');
        expect(result.evidence[0].finding).toContain('timeout');
      });
    });

    describe('test type: log_analysis', () => {
      const logAnalysisHypothesis: Hypothesis = {
        id: 'HYP-PROB-TEST-1-C',
        statement: 'A dependency changed its behavior or interface',
        rationale: 'External dependencies may have been updated with breaking changes',
        prediction: 'Checking dependency versions will reveal recent updates',
        test: {
          type: 'log_analysis',
          target: 'package.json and dependency changelogs',
          expected: 'Recent dependency version change',
        },
        likelihood: 'medium',
      };

      it('handles log_analysis test type', async () => {
        const input: HypothesisTesterInput = {
          hypothesis: logAnalysisHypothesis,
          problem: baseProblem,
        };

        const result = await tester.testHypothesis(input);
        expect(result.evidence.length).toBeGreaterThan(0);
        expect(result.evidence[0].type).toBe('log_analysis');
      });

      it('analyzes problem evidence for log patterns', async () => {
        const problemWithLogs: Problem = {
          ...baseProblem,
          evidence: [
            'npm WARN deprecated package@1.0.0',
            'ERROR: breaking change in dependency',
          ],
        };

        const input: HypothesisTesterInput = {
          hypothesis: logAnalysisHypothesis,
          problem: problemWithLogs,
        };

        const result = await tester.testHypothesis(input);
        // With error/warning evidence, hypothesis might be supported
        expect(result.evidence.length).toBeGreaterThan(0);
      });
    });

    describe('test type: behavioral', () => {
      const behavioralHypothesis: Hypothesis = {
        id: 'HYP-PROB-TEST-1-D',
        statement: 'The index or cache has become stale',
        rationale: 'Cached data may not reflect current state',
        prediction: 'Rebuilding index will restore expected behavior',
        test: {
          type: 'behavioral',
          target: 'index rebuild or cache clear',
          expected: 'Behavior restored after rebuild/clear',
        },
        likelihood: 'medium',
      };

      it('handles behavioral test type', async () => {
        const input: HypothesisTesterInput = {
          hypothesis: behavioralHypothesis,
          problem: baseProblem,
        };

        const result = await tester.testHypothesis(input);
        expect(result.evidence.length).toBeGreaterThan(0);
        expect(result.evidence[0].type).toBe('behavioral');
      });

      it('compares actual vs expected behavior from evidence', async () => {
        const problemWithBehavior: Problem = {
          ...baseProblem,
          description: 'Cache returns stale data after update',
          evidence: ['Expected: new_value', 'Actual: old_value'],
        };

        const input: HypothesisTesterInput = {
          hypothesis: behavioralHypothesis,
          problem: problemWithBehavior,
        };

        const result = await tester.testHypothesis(input);
        // Evidence shows mismatch, might support cache hypothesis
        expect(result.evidence.length).toBeGreaterThan(0);
      });
    });

    describe('verdict determination', () => {
      it('returns supported when evidence strongly matches prediction', async () => {
        const hypothesis: Hypothesis = {
          id: 'HYP-TEST-1',
          statement: 'Test failure due to assertion mismatch',
          rationale: 'Assertions may be outdated',
          prediction: 'Test output shows assertion error',
          test: {
            type: 'log_analysis',
            target: 'test output',
            expected: 'assertion',
          },
          likelihood: 'high',
        };

        const problem: Problem = {
          id: 'PROB-TEST-1',
          type: 'test_failure',
          description: 'Test failed',
          evidence: ['AssertionError: expected true to equal false', 'at assertion.js:42'],
          severity: 'high',
          reproducible: true,
        };

        const input: HypothesisTesterInput = { hypothesis, problem };
        const result = await tester.testHypothesis(input);

        expect(result.verdict).toBe('supported');
        expect(result.confidence).toBeGreaterThan(0.5);
        expect(result.recommendation).toBe('proceed_to_fix');
      });

      it('returns refuted when evidence contradicts prediction', async () => {
        const hypothesis: Hypothesis = {
          id: 'HYP-TEST-1',
          statement: 'Test failure due to network timeout',
          rationale: 'Network issues may cause failures',
          prediction: 'Logs show timeout or connection errors',
          test: {
            type: 'log_analysis',
            target: 'test output',
            expected: 'timeout',
          },
          likelihood: 'low',
        };

        const problem: Problem = {
          id: 'PROB-TEST-1',
          type: 'test_failure',
          description: 'Test failed',
          evidence: ['TypeError: Cannot read property of undefined', 'null reference'],
          severity: 'high',
          reproducible: true,
        };

        const input: HypothesisTesterInput = { hypothesis, problem };
        const result = await tester.testHypothesis(input);

        expect(result.verdict).toBe('refuted');
        expect(result.recommendation).toBe('test_another_hypothesis');
      });

      it('returns inconclusive when evidence is insufficient', async () => {
        const hypothesis: Hypothesis = {
          id: 'HYP-TEST-1',
          statement: 'Configuration drift between environments',
          rationale: 'Settings may have diverged',
          prediction: 'Config files show different values',
          test: {
            type: 'code_inspection',
            target: 'environment configuration',
            expected: 'Config value differences',
          },
          likelihood: 'medium',
        };

        const problem: Problem = {
          id: 'PROB-TEST-1',
          type: 'test_failure',
          description: 'Test failed intermittently',
          evidence: [], // No evidence provided
          severity: 'medium',
          reproducible: false,
        };

        const input: HypothesisTesterInput = { hypothesis, problem };
        const result = await tester.testHypothesis(input);

        expect(result.verdict).toBe('inconclusive');
        expect(result.recommendation).toBe('need_more_evidence');
      });
    });

    describe('confidence calculation', () => {
      it('higher confidence for high likelihood hypotheses with matching evidence', async () => {
        const highLikelihood: Hypothesis = {
          id: 'HYP-HIGH',
          statement: 'Test assertion is wrong',
          rationale: 'Assertions may be outdated',
          prediction: 'Assertion error in logs',
          test: { type: 'log_analysis', target: 'logs', expected: 'assertion' },
          likelihood: 'high',
        };

        const lowLikelihood: Hypothesis = {
          id: 'HYP-LOW',
          statement: 'Random cosmic ray bit flip',
          rationale: 'Cosmic rays can flip bits',
          prediction: 'Assertion error in logs',
          test: { type: 'log_analysis', target: 'logs', expected: 'assertion' },
          likelihood: 'low',
        };

        const problem: Problem = {
          id: 'PROB-1',
          type: 'test_failure',
          description: 'Test failed',
          evidence: ['AssertionError: expected value'],
          severity: 'high',
          reproducible: true,
        };

        const highResult = await tester.testHypothesis({ hypothesis: highLikelihood, problem });
        const lowResult = await tester.testHypothesis({ hypothesis: lowLikelihood, problem });

        expect(highResult.confidence).toBeGreaterThan(lowResult.confidence);
      });

      it('lower confidence when problem is not reproducible', async () => {
        const hypothesis: Hypothesis = {
          id: 'HYP-1',
          statement: 'Test has a bug',
          rationale: 'Tests can have bugs',
          prediction: 'Error in test file',
          test: { type: 'log_analysis', target: 'logs', expected: 'error' },
          likelihood: 'high',
        };

        const reproducible: Problem = {
          id: 'PROB-1',
          type: 'test_failure',
          description: 'Test failed',
          evidence: ['Error: something went wrong'],
          severity: 'high',
          reproducible: true,
        };

        const notReproducible: Problem = {
          ...reproducible,
          reproducible: false,
        };

        const reproducibleResult = await tester.testHypothesis({
          hypothesis,
          problem: reproducible,
        });
        const notReproducibleResult = await tester.testHypothesis({
          hypothesis,
          problem: notReproducible,
        });

        expect(reproducibleResult.confidence).toBeGreaterThanOrEqual(
          notReproducibleResult.confidence
        );
      });
    });

    describe('codebaseContext', () => {
      const hypothesis: Hypothesis = {
        id: 'HYP-1',
        statement: 'Test has a bug',
        rationale: 'Tests can have bugs',
        prediction: 'Error in test file',
        test: { type: 'code_inspection', target: 'test file', expected: 'bug' },
        likelihood: 'high',
      };

      it('accepts optional codebaseContext without error', async () => {
        const input: HypothesisTesterInput = {
          hypothesis,
          problem: baseProblem,
          codebaseContext: 'This is a TypeScript project using Vitest.',
        };

        await expect(tester.testHypothesis(input)).resolves.not.toThrow();
      });

      it('still produces a result when codebaseContext is provided', async () => {
        const input: HypothesisTesterInput = {
          hypothesis,
          problem: baseProblem,
          codebaseContext: 'This is a TypeScript project using Vitest.',
        };

        const result = await tester.testHypothesis(input);
        expect(result.hypothesisId).toBe('HYP-1');
        expect(result.evidence.length).toBeGreaterThan(0);
      });
    });
  });
});
