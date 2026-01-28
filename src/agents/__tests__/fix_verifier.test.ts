/**
 * @fileoverview Tests for FixVerifierAgent
 *
 * Following TDD: this test file is created BEFORE implementation.
 * Tests should FAIL initially, then PASS after implementation.
 *
 * The Fix Verifier uses RLVR-style (Reinforcement Learning with Verifiable Rewards)
 * binary verification:
 * - reward = 1 ONLY if: originalTestPasses AND noRegressions AND typesValid
 * - reward = 0: Fix rejected, no partial credit
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFixVerifier } from '../fix_verifier.js';
import type { LibrarianStorage } from '../../storage/types.js';
import type {
  Problem,
  Fix,
  FileChange,
  FixVerifierInput,
  VerificationResult,
  ExecutionEntry,
  CommandRunner,
  CommandResult,
  TestFailureCheck,
} from '../types.js';

describe('FixVerifier', () => {
  describe('Agent metadata', () => {
    it('returns agent with correct agentType', () => {
      const verifier = createFixVerifier();
      expect(verifier.agentType).toBe('fix_verifier');
    });

    it('returns agent with correct name', () => {
      const verifier = createFixVerifier();
      expect(verifier.name).toBe('Fix Verifier');
    });

    it('returns agent with fix_verification capability', () => {
      const verifier = createFixVerifier();
      expect(verifier.capabilities).toContain('fix_verification');
    });

    it('returns agent with version string', () => {
      const verifier = createFixVerifier();
      expect(verifier.version).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('returns agent with qualityTier', () => {
      const verifier = createFixVerifier();
      expect(verifier.qualityTier).toBe('full');
    });
  });

  describe('Agent lifecycle', () => {
    it('isReady returns false before initialization', () => {
      const verifier = createFixVerifier();
      expect(verifier.isReady()).toBe(false);
    });

    it('isReady returns true after initialization', async () => {
      const verifier = createFixVerifier();
      await verifier.initialize({} as LibrarianStorage);
      expect(verifier.isReady()).toBe(true);
    });

    it('isReady returns false after shutdown', async () => {
      const verifier = createFixVerifier();
      await verifier.initialize({} as LibrarianStorage);
      await verifier.shutdown();
      expect(verifier.isReady()).toBe(false);
    });
  });

  describe('CommandRunner integration', () => {
    it('getCommandRunner returns null initially', () => {
      const verifier = createFixVerifier();
      expect(verifier.getCommandRunner()).toBeNull();
    });

    it('setCommandRunner stores the runner', () => {
      const verifier = createFixVerifier();
      const mockRunner: CommandRunner = vi.fn();
      verifier.setCommandRunner(mockRunner);
      expect(verifier.getCommandRunner()).toBe(mockRunner);
    });

    it('rejects fix when no CommandRunner is set', async () => {
      const verifier = createFixVerifier();
      await verifier.initialize({} as LibrarianStorage);

      const input: FixVerifierInput = {
        fix: createMockFix(),
        problem: createMockProblem(),
      };

      const result = await verifier.verifyFix(input);

      expect(result.verdict).toBe('fix_rejected');
      expect(result.reward).toBe(0);
      expect(result.notes).toContain('CommandRunner');
    });
  });

  describe('verifyFix', () => {
    let verifier: ReturnType<typeof createFixVerifier>;
    let mockRunner: CommandRunner;
    let commandResults: Map<string, CommandResult>;

    beforeEach(async () => {
      verifier = createFixVerifier();
      await verifier.initialize({} as LibrarianStorage);

      commandResults = new Map();
      mockRunner = vi.fn(async (check: TestFailureCheck): Promise<CommandResult> => {
        const result = commandResults.get(check.command);
        if (result) {
          return result;
        }
        return {
          command: check.command,
          exitCode: 0,
          stdout: 'Tests passed',
          stderr: '',
          durationMs: 100,
        };
      });
      verifier.setCommandRunner(mockRunner);
    });

    describe('VerificationResult structure', () => {
      it('returns result with fixId', async () => {
        const input: FixVerifierInput = {
          fix: createMockFix('FIX-001'),
          problem: createMockProblem(),
        };

        const result = await verifier.verifyFix(input);
        expect(result.fixId).toBe('FIX-001');
      });

      it('returns result with verification object', async () => {
        const input: FixVerifierInput = {
          fix: createMockFix(),
          problem: createMockProblem(),
        };

        const result = await verifier.verifyFix(input);
        expect(result.verification).toBeDefined();
        expect(typeof result.verification.originalTestPasses).toBe('boolean');
        expect(typeof result.verification.noRegressions).toBe('boolean');
        expect(typeof result.verification.typesValid).toBe('boolean');
      });

      it('returns result with binary reward (0 or 1)', async () => {
        const input: FixVerifierInput = {
          fix: createMockFix(),
          problem: createMockProblem(),
        };

        const result = await verifier.verifyFix(input);
        expect([0, 1]).toContain(result.reward);
      });

      it('returns result with verdict', async () => {
        const input: FixVerifierInput = {
          fix: createMockFix(),
          problem: createMockProblem(),
        };

        const result = await verifier.verifyFix(input);
        expect(['fix_accepted', 'fix_rejected']).toContain(result.verdict);
      });

      it('returns result with notes', async () => {
        const input: FixVerifierInput = {
          fix: createMockFix(),
          problem: createMockProblem(),
        };

        const result = await verifier.verifyFix(input);
        expect(typeof result.notes).toBe('string');
        expect(result.notes.length).toBeGreaterThan(0);
      });

      it('returns result with executionLog', async () => {
        const input: FixVerifierInput = {
          fix: createMockFix(),
          problem: createMockProblem(),
        };

        const result = await verifier.verifyFix(input);
        expect(Array.isArray(result.executionLog)).toBe(true);
      });
    });

    describe('ExecutionEntry structure', () => {
      it('each entry has command', async () => {
        const input: FixVerifierInput = {
          fix: createMockFix(),
          problem: createMockProblem(),
        };

        const result = await verifier.verifyFix(input);

        for (const entry of result.executionLog) {
          expect(typeof entry.command).toBe('string');
          expect(entry.command.length).toBeGreaterThan(0);
        }
      });

      it('each entry has exitCode', async () => {
        const input: FixVerifierInput = {
          fix: createMockFix(),
          problem: createMockProblem(),
        };

        const result = await verifier.verifyFix(input);

        for (const entry of result.executionLog) {
          expect(typeof entry.exitCode).toBe('number');
        }
      });

      it('each entry has durationMs', async () => {
        const input: FixVerifierInput = {
          fix: createMockFix(),
          problem: createMockProblem(),
        };

        const result = await verifier.verifyFix(input);

        for (const entry of result.executionLog) {
          expect(typeof entry.durationMs).toBe('number');
          expect(entry.durationMs).toBeGreaterThanOrEqual(0);
        }
      });
    });

    describe('RLVR-style binary rewards', () => {
      it('reward=1 when ALL checks pass', async () => {
        // All commands succeed
        commandResults.set('npm test -- --run some.test.ts', {
          command: 'npm test -- --run some.test.ts',
          exitCode: 0,
          stdout: 'PASS',
          stderr: '',
          durationMs: 100,
        });
        commandResults.set('npm test -- --run', {
          command: 'npm test -- --run',
          exitCode: 0,
          stdout: 'All tests passed',
          stderr: '',
          durationMs: 500,
        });
        commandResults.set('npx tsc --noEmit', {
          command: 'npx tsc --noEmit',
          exitCode: 0,
          stdout: '',
          stderr: '',
          durationMs: 200,
        });

        const input: FixVerifierInput = {
          fix: createMockFix(),
          problem: createMockProblem(),
          originalTestCommand: 'npm test -- --run some.test.ts',
        };

        const result = await verifier.verifyFix(input);

        expect(result.verification.originalTestPasses).toBe(true);
        expect(result.verification.noRegressions).toBe(true);
        expect(result.verification.typesValid).toBe(true);
        expect(result.reward).toBe(1);
        expect(result.verdict).toBe('fix_accepted');
      });

      it('reward=0 when originalTestPasses is false', async () => {
        commandResults.set('npm test -- --run some.test.ts', {
          command: 'npm test -- --run some.test.ts',
          exitCode: 1,
          stdout: 'FAIL',
          stderr: 'Test failed',
          durationMs: 100,
        });
        commandResults.set('npm test -- --run', {
          command: 'npm test -- --run',
          exitCode: 0,
          stdout: 'All tests passed',
          stderr: '',
          durationMs: 500,
        });
        commandResults.set('npx tsc --noEmit', {
          command: 'npx tsc --noEmit',
          exitCode: 0,
          stdout: '',
          stderr: '',
          durationMs: 200,
        });

        const input: FixVerifierInput = {
          fix: createMockFix(),
          problem: createMockProblem(),
          originalTestCommand: 'npm test -- --run some.test.ts',
        };

        const result = await verifier.verifyFix(input);

        expect(result.verification.originalTestPasses).toBe(false);
        expect(result.reward).toBe(0);
        expect(result.verdict).toBe('fix_rejected');
      });

      it('reward=0 when noRegressions is false', async () => {
        commandResults.set('npm test -- --run some.test.ts', {
          command: 'npm test -- --run some.test.ts',
          exitCode: 0,
          stdout: 'PASS',
          stderr: '',
          durationMs: 100,
        });
        commandResults.set('npm test -- --run', {
          command: 'npm test -- --run',
          exitCode: 1,
          stdout: 'Some tests failed',
          stderr: 'Regression detected',
          durationMs: 500,
        });
        commandResults.set('npx tsc --noEmit', {
          command: 'npx tsc --noEmit',
          exitCode: 0,
          stdout: '',
          stderr: '',
          durationMs: 200,
        });

        const input: FixVerifierInput = {
          fix: createMockFix(),
          problem: createMockProblem(),
          originalTestCommand: 'npm test -- --run some.test.ts',
        };

        const result = await verifier.verifyFix(input);

        expect(result.verification.noRegressions).toBe(false);
        expect(result.reward).toBe(0);
        expect(result.verdict).toBe('fix_rejected');
      });

      it('reward=0 when typesValid is false', async () => {
        commandResults.set('npm test -- --run some.test.ts', {
          command: 'npm test -- --run some.test.ts',
          exitCode: 0,
          stdout: 'PASS',
          stderr: '',
          durationMs: 100,
        });
        commandResults.set('npm test -- --run', {
          command: 'npm test -- --run',
          exitCode: 0,
          stdout: 'All tests passed',
          stderr: '',
          durationMs: 500,
        });
        commandResults.set('npx tsc --noEmit', {
          command: 'npx tsc --noEmit',
          exitCode: 1,
          stdout: '',
          stderr: 'TS2322: Type error',
          durationMs: 200,
        });

        const input: FixVerifierInput = {
          fix: createMockFix(),
          problem: createMockProblem(),
          originalTestCommand: 'npm test -- --run some.test.ts',
        };

        const result = await verifier.verifyFix(input);

        expect(result.verification.typesValid).toBe(false);
        expect(result.reward).toBe(0);
        expect(result.verdict).toBe('fix_rejected');
      });

      it('reward=0 when multiple checks fail (no partial credit)', async () => {
        commandResults.set('npm test -- --run some.test.ts', {
          command: 'npm test -- --run some.test.ts',
          exitCode: 1,
          stdout: 'FAIL',
          stderr: 'Test failed',
          durationMs: 100,
        });
        commandResults.set('npm test -- --run', {
          command: 'npm test -- --run',
          exitCode: 1,
          stdout: 'Tests failed',
          stderr: 'Multiple failures',
          durationMs: 500,
        });
        commandResults.set('npx tsc --noEmit', {
          command: 'npx tsc --noEmit',
          exitCode: 1,
          stdout: '',
          stderr: 'Type errors',
          durationMs: 200,
        });

        const input: FixVerifierInput = {
          fix: createMockFix(),
          problem: createMockProblem(),
          originalTestCommand: 'npm test -- --run some.test.ts',
        };

        const result = await verifier.verifyFix(input);

        expect(result.verification.originalTestPasses).toBe(false);
        expect(result.verification.noRegressions).toBe(false);
        expect(result.verification.typesValid).toBe(false);
        expect(result.reward).toBe(0);
        expect(result.verdict).toBe('fix_rejected');
      });
    });

    describe('Verification steps', () => {
      it('runs original test command', async () => {
        const input: FixVerifierInput = {
          fix: createMockFix(),
          problem: createMockProblem(),
          originalTestCommand: 'npm test -- --run specific.test.ts',
        };

        await verifier.verifyFix(input);

        expect(mockRunner).toHaveBeenCalledWith(
          expect.objectContaining({
            command: 'npm test -- --run specific.test.ts',
          })
        );
      });

      it('runs full test suite', async () => {
        const input: FixVerifierInput = {
          fix: createMockFix(),
          problem: createMockProblem(),
        };

        await verifier.verifyFix(input);

        expect(mockRunner).toHaveBeenCalledWith(
          expect.objectContaining({
            command: 'npm test -- --run',
          })
        );
      });

      it('runs TypeScript check', async () => {
        const input: FixVerifierInput = {
          fix: createMockFix(),
          problem: createMockProblem(),
        };

        await verifier.verifyFix(input);

        expect(mockRunner).toHaveBeenCalledWith(
          expect.objectContaining({
            command: 'npx tsc --noEmit',
          })
        );
      });

      it('extracts test command from problem.minimalReproduction if not provided', async () => {
        const problem = createMockProblem();
        problem.minimalReproduction = 'npm test -- --run calculator.test.ts';

        const input: FixVerifierInput = {
          fix: createMockFix(),
          problem,
        };

        await verifier.verifyFix(input);

        expect(mockRunner).toHaveBeenCalledWith(
          expect.objectContaining({
            command: 'npm test -- --run calculator.test.ts',
          })
        );
      });

      it('logs all executed commands', async () => {
        const input: FixVerifierInput = {
          fix: createMockFix(),
          problem: createMockProblem(),
          originalTestCommand: 'npm test -- --run my.test.ts',
        };

        const result = await verifier.verifyFix(input);

        // Should have at least 3 entries: original test, full suite, type check
        expect(result.executionLog.length).toBeGreaterThanOrEqual(3);

        const commands = result.executionLog.map((e) => e.command);
        expect(commands).toContain('npm test -- --run my.test.ts');
        expect(commands).toContain('npm test -- --run');
        expect(commands).toContain('npx tsc --noEmit');
      });
    });

    describe('Notes explanation', () => {
      it('notes explain acceptance when all checks pass', async () => {
        const input: FixVerifierInput = {
          fix: createMockFix(),
          problem: createMockProblem(),
        };

        const result = await verifier.verifyFix(input);

        if (result.verdict === 'fix_accepted') {
          expect(result.notes.toLowerCase()).toMatch(/pass|accept|success|verif/i);
        }
      });

      it('notes explain rejection when checks fail', async () => {
        commandResults.set('npm test -- --run', {
          command: 'npm test -- --run',
          exitCode: 1,
          stdout: '',
          stderr: 'Test failed',
          durationMs: 100,
        });

        const input: FixVerifierInput = {
          fix: createMockFix(),
          problem: createMockProblem(),
        };

        const result = await verifier.verifyFix(input);

        expect(result.verdict).toBe('fix_rejected');
        expect(result.notes.length).toBeGreaterThan(10);
      });

      it('notes specify which check failed', async () => {
        commandResults.set('npx tsc --noEmit', {
          command: 'npx tsc --noEmit',
          exitCode: 1,
          stdout: '',
          stderr: 'TS2322: Type error at file.ts:42',
          durationMs: 200,
        });

        const input: FixVerifierInput = {
          fix: createMockFix(),
          problem: createMockProblem(),
        };

        const result = await verifier.verifyFix(input);

        expect(result.notes.toLowerCase()).toMatch(/type|typescript|tsc|compile/i);
      });
    });

    describe('Error handling', () => {
      it('handles command execution errors gracefully', async () => {
        const errorRunner: CommandRunner = vi.fn().mockRejectedValue(new Error('Command failed'));
        verifier.setCommandRunner(errorRunner);

        const input: FixVerifierInput = {
          fix: createMockFix(),
          problem: createMockProblem(),
        };

        const result = await verifier.verifyFix(input);

        expect(result.reward).toBe(0);
        expect(result.verdict).toBe('fix_rejected');
        expect(result.notes).toContain('error');
      });

      it('treats command errors as check failures', async () => {
        const errorRunner: CommandRunner = vi.fn().mockRejectedValue(new Error('Network error'));
        verifier.setCommandRunner(errorRunner);

        const input: FixVerifierInput = {
          fix: createMockFix(),
          problem: createMockProblem(),
        };

        const result = await verifier.verifyFix(input);

        expect(result.verification.originalTestPasses).toBe(false);
        expect(result.verification.noRegressions).toBe(false);
        expect(result.verification.typesValid).toBe(false);
      });
    });

    describe('Configuration', () => {
      it('accepts custom test suite command', async () => {
        const customVerifier = createFixVerifier({
          testSuiteCommand: 'yarn test',
        });
        await customVerifier.initialize({} as LibrarianStorage);
        customVerifier.setCommandRunner(mockRunner);

        const input: FixVerifierInput = {
          fix: createMockFix(),
          problem: createMockProblem(),
        };

        await customVerifier.verifyFix(input);

        expect(mockRunner).toHaveBeenCalledWith(
          expect.objectContaining({
            command: 'yarn test',
          })
        );
      });

      it('accepts custom TypeScript check command', async () => {
        const customVerifier = createFixVerifier({
          typeCheckCommand: 'yarn tsc',
        });
        await customVerifier.initialize({} as LibrarianStorage);
        customVerifier.setCommandRunner(mockRunner);

        const input: FixVerifierInput = {
          fix: createMockFix(),
          problem: createMockProblem(),
        };

        await customVerifier.verifyFix(input);

        expect(mockRunner).toHaveBeenCalledWith(
          expect.objectContaining({
            command: 'yarn tsc',
          })
        );
      });

      it('accepts custom command timeout', async () => {
        const customVerifier = createFixVerifier({
          commandTimeoutMs: 30000,
        });
        await customVerifier.initialize({} as LibrarianStorage);
        customVerifier.setCommandRunner(mockRunner);

        const input: FixVerifierInput = {
          fix: createMockFix(),
          problem: createMockProblem(),
        };

        await customVerifier.verifyFix(input);

        expect(mockRunner).toHaveBeenCalledWith(
          expect.objectContaining({
            timeoutMs: 30000,
          })
        );
      });
    });

    describe('Fix reference tracking', () => {
      it('includes fixId from input fix', async () => {
        const input: FixVerifierInput = {
          fix: createMockFix('FIX-CUSTOM-ID'),
          problem: createMockProblem(),
        };

        const result = await verifier.verifyFix(input);
        expect(result.fixId).toBe('FIX-CUSTOM-ID');
      });

      it('preserves fix metadata in result', async () => {
        const fix = createMockFix('FIX-123');
        fix.problemId = 'PROB-456';

        const input: FixVerifierInput = {
          fix,
          problem: createMockProblem('PROB-456'),
        };

        const result = await verifier.verifyFix(input);
        expect(result.fixId).toBe('FIX-123');
      });
    });
  });
});

// ============================================================================
// Test Helpers
// ============================================================================

function createMockFix(id: string = 'FIX-001'): Fix {
  return {
    id,
    problemId: 'PROB-001',
    hypothesisId: 'HYP-001-A',
    description: 'Fix the failing test assertion',
    changes: [
      {
        filePath: 'src/calculator.ts',
        changeType: 'modify',
        before: 'return a - b;',
        after: 'return a + b;',
        description: 'Fix subtraction to addition',
      },
    ],
    rationale: 'The function was subtracting instead of adding',
    prediction: 'Test will pass after this change',
  };
}

function createMockProblem(id: string = 'PROB-001'): Problem {
  return {
    id,
    type: 'test_failure',
    description: 'Test command failed: npm test -- --run calculator.test.ts',
    evidence: ['FAIL: expected 5, got -1', 'at calculator.test.ts:15'],
    severity: 'high',
    reproducible: true,
    minimalReproduction: 'npm test -- --run calculator.test.ts',
  };
}
