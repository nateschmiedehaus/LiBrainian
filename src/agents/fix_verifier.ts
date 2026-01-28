/**
 * @fileoverview Fix Verifier Agent
 *
 * Implements RLVR-style (Reinforcement Learning with Verifiable Rewards)
 * binary verification for the Scientific Loop.
 *
 * Verification uses BINARY rewards - no partial credit:
 * - reward = 1 ONLY if: originalTestPasses AND noRegressions AND typesValid
 * - reward = 0: Fix rejected
 *
 * Verification Steps:
 * 1. Run the original failing test
 * 2. Run full test suite
 * 3. Run TypeScript check
 * 4. Compute binary reward
 * 5. Return verdict based on reward
 */

import type {
  FixVerifierAgent,
  AgentCapability,
  Fix,
  Problem,
  FixVerifierInput,
  VerificationResult,
  ExecutionEntry,
  CommandRunner,
  CommandResult,
} from './types.js';
import type { LibrarianStorage } from '../storage/types.js';

/**
 * Configuration for the FixVerifier agent.
 */
export interface FixVerifierConfig {
  /** Command to run full test suite (default: 'npm test -- --run') */
  testSuiteCommand?: string;
  /** Command to check TypeScript types (default: 'npx tsc --noEmit') */
  typeCheckCommand?: string;
  /** Timeout for each command in milliseconds (default: 60000) */
  commandTimeoutMs?: number;
}

const DEFAULT_CONFIG: Required<FixVerifierConfig> = {
  testSuiteCommand: 'npm test -- --run',
  typeCheckCommand: 'npx tsc --noEmit',
  commandTimeoutMs: 60000,
};

/**
 * FixVerifier implementation.
 * Uses RLVR-style binary verification without LLM calls.
 */
export class FixVerifier implements FixVerifierAgent {
  readonly agentType = 'fix_verifier' as const;
  readonly name = 'Fix Verifier';
  readonly capabilities = ['fix_verification'] as const;
  readonly version = '1.0.0';
  readonly qualityTier = 'full' as const;

  private storage: LibrarianStorage | null = null;
  private config: Required<FixVerifierConfig>;
  private commandRunner: CommandRunner | null = null;

  constructor(config: FixVerifierConfig = {}) {
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
   * Set the command runner for executing verification commands.
   */
  setCommandRunner(runner: CommandRunner): void {
    this.commandRunner = runner;
  }

  /**
   * Get the current command runner (if any).
   */
  getCommandRunner(): CommandRunner | null {
    return this.commandRunner;
  }

  /**
   * Verify a fix using RLVR-style binary verification.
   * Returns reward=1 ONLY if: originalTestPasses AND noRegressions AND typesValid
   */
  async verifyFix(input: FixVerifierInput): Promise<VerificationResult> {
    const { fix, problem, originalTestCommand } = input;
    const executionLog: ExecutionEntry[] = [];

    // If no CommandRunner is set, reject immediately
    if (!this.commandRunner) {
      return {
        fixId: fix.id,
        verification: {
          originalTestPasses: false,
          noRegressions: false,
          typesValid: false,
        },
        reward: 0,
        verdict: 'fix_rejected',
        notes: 'Fix rejected: No CommandRunner available. Cannot verify fix without ability to execute commands.',
        executionLog: [],
      };
    }

    // Determine the original test command
    const testCommand = this.determineOriginalTestCommand(originalTestCommand, problem);

    // Run verification steps
    let originalTestPasses = false;
    let noRegressions = false;
    let typesValid = false;
    const failedChecks: string[] = [];
    const passedChecks: string[] = [];

    try {
      // Step 1: Run the original failing test
      const originalTestResult = await this.runCommand(testCommand);
      executionLog.push(originalTestResult);
      originalTestPasses = originalTestResult.exitCode === 0;
      if (originalTestPasses) {
        passedChecks.push('original test');
      } else {
        failedChecks.push('original test failed');
      }
    } catch (error) {
      executionLog.push(this.createErrorEntry(testCommand, error));
      failedChecks.push('original test execution error');
    }

    try {
      // Step 2: Run full test suite
      const suiteResult = await this.runCommand(this.config.testSuiteCommand);
      executionLog.push(suiteResult);
      noRegressions = suiteResult.exitCode === 0;
      if (noRegressions) {
        passedChecks.push('full test suite');
      } else {
        failedChecks.push('regression detected in test suite');
      }
    } catch (error) {
      executionLog.push(this.createErrorEntry(this.config.testSuiteCommand, error));
      failedChecks.push('test suite execution error');
    }

    try {
      // Step 3: Run TypeScript check
      const typeCheckResult = await this.runCommand(this.config.typeCheckCommand);
      executionLog.push(typeCheckResult);
      typesValid = typeCheckResult.exitCode === 0;
      if (typesValid) {
        passedChecks.push('TypeScript compilation');
      } else {
        failedChecks.push('TypeScript type errors');
      }
    } catch (error) {
      executionLog.push(this.createErrorEntry(this.config.typeCheckCommand, error));
      failedChecks.push('TypeScript check execution error');
    }

    // Step 4: Compute binary reward (RLVR-style - no partial credit)
    const reward = this.computeReward(originalTestPasses, noRegressions, typesValid);

    // Step 5: Determine verdict
    const verdict = reward === 1 ? 'fix_accepted' : 'fix_rejected';

    // Generate notes explaining the result
    const notes = this.generateNotes(
      verdict,
      failedChecks,
      passedChecks,
      executionLog
    );

    return {
      fixId: fix.id,
      verification: {
        originalTestPasses,
        noRegressions,
        typesValid,
      },
      reward,
      verdict,
      notes,
      executionLog,
    };
  }

  /**
   * Determine the original test command to run.
   * Priority: explicit command > problem.minimalReproduction > fallback
   */
  private determineOriginalTestCommand(
    explicitCommand: string | undefined,
    problem: Problem
  ): string {
    // Use explicit command if provided
    if (explicitCommand) {
      return explicitCommand;
    }

    // Extract from problem's minimal reproduction
    if (problem.minimalReproduction) {
      // If it looks like a test command, use it directly
      if (
        problem.minimalReproduction.includes('npm test') ||
        problem.minimalReproduction.includes('vitest') ||
        problem.minimalReproduction.includes('jest')
      ) {
        return problem.minimalReproduction;
      }
    }

    // Try to extract test file from problem evidence
    const testFileMatch = this.extractTestFile(problem);
    if (testFileMatch) {
      return `npm test -- --run ${testFileMatch}`;
    }

    // Fallback to full test suite
    return this.config.testSuiteCommand;
  }

  /**
   * Extract test file path from problem evidence.
   */
  private extractTestFile(problem: Problem): string | null {
    // Check minimal reproduction first
    if (problem.minimalReproduction) {
      const match = problem.minimalReproduction.match(/(\S+\.test\.[tj]s[x]?)/);
      if (match) {
        return match[1];
      }
    }

    // Check evidence
    for (const evidence of problem.evidence) {
      const match = evidence.match(/(\S+\.test\.[tj]s[x]?)/);
      if (match) {
        return match[1];
      }
    }

    // Check description
    const descMatch = problem.description.match(/(\S+\.test\.[tj]s[x]?)/);
    if (descMatch) {
      return descMatch[1];
    }

    return null;
  }

  /**
   * Run a command via the CommandRunner.
   */
  private async runCommand(command: string): Promise<ExecutionEntry> {
    const startTime = Date.now();
    const result = await this.commandRunner!({
      command,
      timeoutMs: this.config.commandTimeoutMs,
    });

    return {
      command,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      durationMs: result.durationMs || (Date.now() - startTime),
    };
  }

  /**
   * Create an error entry for command execution failures.
   */
  private createErrorEntry(command: string, error: unknown): ExecutionEntry {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return {
      command,
      exitCode: -1,
      stdout: '',
      stderr: `Execution error: ${errorMsg}`,
      durationMs: 0,
    };
  }

  /**
   * Compute binary reward (RLVR-style).
   * Returns 1 ONLY if ALL checks pass, 0 otherwise.
   */
  private computeReward(
    originalTestPasses: boolean,
    noRegressions: boolean,
    typesValid: boolean
  ): 0 | 1 {
    return (originalTestPasses && noRegressions && typesValid) ? 1 : 0;
  }

  /**
   * Generate explanatory notes for the verification result.
   */
  private generateNotes(
    verdict: 'fix_accepted' | 'fix_rejected',
    failedChecks: string[],
    passedChecks: string[],
    executionLog: ExecutionEntry[]
  ): string {
    if (verdict === 'fix_accepted') {
      return `Fix accepted: All verification checks passed (${passedChecks.join(', ')}). RLVR reward = 1.`;
    }

    // Build rejection explanation
    let notes = `Fix rejected: RLVR reward = 0 (no partial credit). `;

    if (failedChecks.length > 0) {
      notes += `Failed checks: ${failedChecks.join('; ')}. `;
    }

    // Add stderr from failed commands for more context
    for (const entry of executionLog) {
      if (entry.exitCode !== 0 && entry.stderr) {
        const truncatedStderr = entry.stderr.substring(0, 200);
        notes += `[${entry.command}]: ${truncatedStderr}${entry.stderr.length > 200 ? '...' : ''} `;
      }
    }

    return notes.trim();
  }
}

/**
 * Factory function to create a FixVerifier instance.
 */
export function createFixVerifier(config: FixVerifierConfig = {}): FixVerifier {
  return new FixVerifier(config);
}
