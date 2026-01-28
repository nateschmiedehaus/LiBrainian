import { describe, it, expect, vi } from 'vitest';
import { createProblemDetector } from '../problem_detector.js';
import type { LibrarianStorage } from '../../storage/types.js';
import type { ProblemDetectionInput, CommandRunner, CommandResult } from '../types.js';

describe('ProblemDetector', () => {
  it('returns structured problems for stub inputs', async () => {
    const detector = createProblemDetector();
    await detector.initialize({} as LibrarianStorage);

    const input: ProblemDetectionInput = {
      testRuns: [
        {
          command: 'npm test -- --run',
          result: {
            command: 'npm test -- --run',
            exitCode: 1,
            stdout: '',
            stderr: 'failing test output',
            durationMs: 123,
          },
        },
      ],
      regressions: [
        {
          query: 'known query',
          expected: 'expected answer',
          actual: 'wrong answer',
        },
      ],
      adversarial: [
        {
          prompt: 'adversarial prompt',
          expected: 'grounded response',
          actual: 'hallucinated response',
        },
      ],
      performance: [
        {
          metric: 'accuracy',
          controlScore: 0.62,
          treatmentScore: 0.60,
          minImprovement: 0.05,
        },
      ],
      consistency: [
        {
          question: 'How is uptime measured?',
          variants: ['How do you measure uptime?', 'What is the uptime metric?'],
          answers: ['answer A', 'answer B'],
        },
      ],
    };

    const report = await detector.identifyProblems(input);

    expect(report.problems).toHaveLength(5);
    const types = report.problems.map((problem) => problem.type).sort();
    expect(types).toEqual([
      'hallucination',
      'inconsistency',
      'performance_gap',
      'regression',
      'test_failure',
    ]);

    expect(report.summary.total).toBe(5);
    expect(report.summary.byType.test_failure).toBe(1);
    expect(report.summary.byType.regression).toBe(1);
    expect(report.summary.byType.hallucination).toBe(1);
    expect(report.summary.byType.performance_gap).toBe(1);
    expect(report.summary.byType.inconsistency).toBe(1);
  });

  describe('CommandRunner integration', () => {
    it('invokes CommandRunner when testRuns result is missing', async () => {
      const detector = createProblemDetector();
      await detector.initialize({} as LibrarianStorage);

      const mockResult: CommandResult = {
        command: 'npm test -- --run',
        exitCode: 1,
        stdout: 'test output',
        stderr: 'FAIL: some test failed',
        durationMs: 1500,
      };

      const mockCommandRunner: CommandRunner = vi.fn().mockResolvedValue(mockResult);
      detector.setCommandRunner(mockCommandRunner);

      const input: ProblemDetectionInput = {
        testRuns: [
          {
            command: 'npm test -- --run',
            // Note: result is intentionally missing
          },
        ],
      };

      const report = await detector.identifyProblems(input);

      expect(mockCommandRunner).toHaveBeenCalledTimes(1);
      expect(mockCommandRunner).toHaveBeenCalledWith(
        expect.objectContaining({ command: 'npm test -- --run' })
      );
      expect(report.problems).toHaveLength(1);
      expect(report.problems[0].type).toBe('test_failure');
      expect(report.problems[0].evidence).toContain('FAIL: some test failed');
    });

    it('does not invoke CommandRunner when result is provided', async () => {
      const detector = createProblemDetector();
      await detector.initialize({} as LibrarianStorage);

      const mockCommandRunner: CommandRunner = vi.fn();
      detector.setCommandRunner(mockCommandRunner);

      const input: ProblemDetectionInput = {
        testRuns: [
          {
            command: 'npm test -- --run',
            result: {
              command: 'npm test -- --run',
              exitCode: 0,
              stdout: 'all tests passed',
              stderr: '',
              durationMs: 100,
            },
          },
        ],
      };

      const report = await detector.identifyProblems(input);

      expect(mockCommandRunner).not.toHaveBeenCalled();
      // No failures since exit code is 0
      expect(report.problems).toHaveLength(0);
    });

    it('handles multiple test runs with mixed results', async () => {
      const detector = createProblemDetector();
      await detector.initialize({} as LibrarianStorage);

      const mockCommandRunner: CommandRunner = vi.fn().mockResolvedValue({
        command: 'npx tsc --noEmit',
        exitCode: 2,
        stdout: '',
        stderr: 'error TS2345: type mismatch',
        durationMs: 3000,
      });
      detector.setCommandRunner(mockCommandRunner);

      const input: ProblemDetectionInput = {
        testRuns: [
          {
            command: 'npm test -- --run',
            result: {
              command: 'npm test -- --run',
              exitCode: 1,
              stdout: '',
              stderr: 'test failure',
              durationMs: 100,
            },
          },
          {
            command: 'npx tsc --noEmit',
            // Missing result - should invoke CommandRunner
          },
        ],
      };

      const report = await detector.identifyProblems(input);

      expect(mockCommandRunner).toHaveBeenCalledTimes(1);
      expect(report.problems).toHaveLength(2);
      expect(report.summary.byType.test_failure).toBe(2);
    });

    it('handles CommandRunner errors gracefully', async () => {
      const detector = createProblemDetector();
      await detector.initialize({} as LibrarianStorage);

      const mockCommandRunner: CommandRunner = vi.fn().mockRejectedValue(
        new Error('Command execution failed: timeout')
      );
      detector.setCommandRunner(mockCommandRunner);

      const input: ProblemDetectionInput = {
        testRuns: [
          {
            command: 'npm test -- --run',
            // Missing result
          },
        ],
      };

      const report = await detector.identifyProblems(input);

      expect(mockCommandRunner).toHaveBeenCalled();
      // Should still report a problem even when runner fails
      expect(report.problems).toHaveLength(1);
      expect(report.problems[0].type).toBe('test_failure');
      expect(report.problems[0].evidence).toContain('Command execution failed: timeout');
    });

    it('skips test checks without CommandRunner when results are missing', async () => {
      const detector = createProblemDetector();
      await detector.initialize({} as LibrarianStorage);
      // Note: no CommandRunner set

      const input: ProblemDetectionInput = {
        testRuns: [
          {
            command: 'npm test -- --run',
            // Missing result and no CommandRunner
          },
        ],
      };

      const report = await detector.identifyProblems(input);

      // Without a CommandRunner and no result, the check should report
      // an "inconclusive" problem (cannot verify)
      expect(report.problems).toHaveLength(1);
      expect(report.problems[0].description).toContain('no result');
    });
  });
});
