/**
 * @fileoverview Problem Detector Agent
 *
 * Implements deterministic problem detection for the Scientific Loop.
 * Can optionally execute test commands via CommandRunner when results are missing.
 */

import type {
  ProblemDetectorAgent,
  AgentCapability,
  Problem,
  ProblemDetectionInput,
  ProblemDetectionReport,
  ProblemDetectionSummary,
  ProblemSeverity,
  ProblemType,
  TestFailureCheck,
  RegressionCheck,
  AdversarialProbe,
  PerformanceExperiment,
  ConsistencyCheck,
  CommandRunner,
  CommandResult,
} from './types.js';
import type { LibrarianStorage } from '../storage/types.js';

const DEFAULT_SEVERITY: Record<ProblemType, ProblemSeverity> = {
  test_failure: 'high',
  regression: 'high',
  hallucination: 'high',
  performance_gap: 'medium',
  inconsistency: 'medium',
};

export interface ProblemDetectorConfig {
  lowPrecisionThreshold?: number;
  lowRecallThreshold?: number;
  hallucinationRateThreshold?: number;
  citationAccuracyThreshold?: number;
}

const DEFAULT_CONFIG: Required<ProblemDetectorConfig> = {
  lowPrecisionThreshold: 0.7,
  lowRecallThreshold: 0.6,
  hallucinationRateThreshold: 0.05,
  citationAccuracyThreshold: 0.9,
};

export class ProblemDetector implements ProblemDetectorAgent {
  readonly agentType = 'problem_detector';
  readonly name = 'Problem Detector';
  readonly capabilities: readonly AgentCapability[] = ['problem_detection'];
  readonly version = '1.0.0';
  readonly qualityTier = 'full' as const;

  private storage: LibrarianStorage | null = null;
  private config: Required<ProblemDetectorConfig>;
  private commandRunner: CommandRunner | null = null;

  constructor(config: ProblemDetectorConfig = {}) {
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
   * Set the command runner for executing test commands.
   * When set, tests without pre-provided results will be executed.
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

  async testFailures(tests: TestFailureCheck[]): Promise<Problem[]> {
    const problems: Problem[] = [];

    for (let index = 0; index < tests.length; index++) {
      const test = tests[index];
      let result: CommandResult | undefined = test.result;

      // If no result provided, try to run the command
      if (!result) {
        if (this.commandRunner) {
          try {
            result = await this.commandRunner(test);
          } catch (error) {
            // CommandRunner failed - report the error as a problem
            const errorMsg = error instanceof Error ? error.message : String(error);
            problems.push(
              this.buildProblem({
                id: `PROB-TEST-${index + 1}`,
                type: 'test_failure',
                description: `Test command failed to execute: ${test.command}`,
                evidence: [errorMsg],
                severity: test.severity ?? DEFAULT_SEVERITY.test_failure,
                reproducible: true,
                minimalReproduction: test.command,
              })
            );
            continue;
          }
        } else {
          // No CommandRunner and no result - report inconclusive
          problems.push(
            this.buildProblem({
              id: `PROB-TEST-${index + 1}`,
              type: 'test_failure',
              description: `Test check has no result and no CommandRunner available: ${test.command}`,
              evidence: ['Unable to verify: no result provided and no CommandRunner configured'],
              severity: 'medium',
              reproducible: false,
              minimalReproduction: test.command,
            })
          );
          continue;
        }
      }

      // Check if the test failed (non-zero exit code)
      if (result.exitCode !== 0) {
        const evidence: string[] = [];
        if (result.stderr) evidence.push(result.stderr);
        if (result.stdout) evidence.push(result.stdout);
        problems.push(
          this.buildProblem({
            id: `PROB-TEST-${index + 1}`,
            type: 'test_failure',
            description: `Test command failed: ${test.command}`,
            evidence,
            severity: test.severity ?? DEFAULT_SEVERITY.test_failure,
            reproducible: true,
            minimalReproduction: test.command,
          })
        );
      }
    }

    return problems;
  }

  regressionCheck(regressions: RegressionCheck[]): Problem[] {
    return regressions
      .filter((regression) => regression.actual !== regression.expected)
      .map((regression, index) =>
        this.buildProblem({
          id: `PROB-REG-${index + 1}`,
          type: 'regression',
          description: `Regression detected for query: ${regression.query}`,
          evidence: regression.evidence ?? [
            `Expected: ${regression.expected}`,
            `Actual: ${regression.actual}`,
          ],
          severity: regression.severity ?? DEFAULT_SEVERITY.regression,
          reproducible: true,
          minimalReproduction: `Run regression query: ${regression.query}`,
        })
      );
  }

  adversarialProbe(probes: AdversarialProbe[]): Problem[] {
    return probes
      .filter((probe) => probe.actual !== probe.expected)
      .map((probe, index) =>
        this.buildProblem({
          id: `PROB-HALL-${index + 1}`,
          type: 'hallucination',
          description: `Hallucination detected for probe: ${probe.prompt}`,
          evidence: probe.evidence ?? [
            `Expected: ${probe.expected}`,
            `Actual: ${probe.actual}`,
          ],
          severity: probe.severity ?? DEFAULT_SEVERITY.hallucination,
          reproducible: true,
          minimalReproduction: `Run probe: ${probe.prompt}`,
        })
      );
  }

  performanceGap(experiments: PerformanceExperiment[]): Problem[] {
    return experiments
      .filter((experiment) => {
        const minImprovement = experiment.minImprovement ?? 0;
        return experiment.treatmentScore < experiment.controlScore + minImprovement;
      })
      .map((experiment, index) => {
        const minImprovement = experiment.minImprovement ?? 0;
        const evidence = experiment.evidence ?? [
          `Control: ${experiment.controlScore}`,
          `Treatment: ${experiment.treatmentScore}`,
          `MinImprovement: ${minImprovement}`,
        ];
        return this.buildProblem({
          id: `PROB-PERF-${index + 1}`,
          type: 'performance_gap',
          description: `Performance gap on ${experiment.metric}`,
          evidence,
          severity: experiment.severity ?? DEFAULT_SEVERITY.performance_gap,
          reproducible: true,
          minimalReproduction: `Re-run experiment: ${experiment.metric}`,
        });
      });
  }

  consistencyViolations(sets: ConsistencyCheck[]): Problem[] {
    return sets
      .filter((set) => this.isInconsistent(set.answers))
      .map((set, index) =>
        this.buildProblem({
          id: `PROB-CONS-${index + 1}`,
          type: 'inconsistency',
          description: `Inconsistent answers for question: ${set.question}`,
          evidence: set.evidence ?? [
            `Variants: ${set.variants.join(' | ')}`,
            `Answers: ${set.answers.join(' | ')}`,
          ],
          severity: set.severity ?? DEFAULT_SEVERITY.inconsistency,
          reproducible: true,
          minimalReproduction: `Ask variants: ${set.variants.join(' | ')}`,
        })
      );
  }

  async identifyProblems(input: ProblemDetectionInput): Promise<ProblemDetectionReport> {
    const problems: Problem[] = [];
    if (input.testRuns?.length) {
      problems.push(...(await this.testFailures(input.testRuns)));
    }
    if (input.regressions?.length) {
      problems.push(...this.regressionCheck(input.regressions));
    }
    if (input.adversarial?.length) {
      problems.push(...this.adversarialProbe(input.adversarial));
    }
    if (input.performance?.length) {
      problems.push(...this.performanceGap(input.performance));
    }
    if (input.consistency?.length) {
      problems.push(...this.consistencyViolations(input.consistency));
    }

    const summary = this.summarize(problems);
    return { problems, summary };
  }

  private summarize(problems: Problem[]): ProblemDetectionSummary {
    const byType: Record<ProblemType, number> = {
      test_failure: 0,
      regression: 0,
      hallucination: 0,
      performance_gap: 0,
      inconsistency: 0,
    };
    const bySeverity: Record<ProblemSeverity, number> = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
    };

    for (const problem of problems) {
      byType[problem.type] += 1;
      bySeverity[problem.severity] += 1;
    }

    return {
      total: problems.length,
      byType,
      bySeverity,
    };
  }

  private buildProblem(problem: Problem): Problem {
    return {
      ...problem,
      evidence: problem.evidence ?? [],
      reproducible: problem.reproducible ?? true,
    };
  }

  private isInconsistent(answers: string[]): boolean {
    if (answers.length <= 1) return false;
    const normalized = answers.map((answer) => this.normalizeAnswer(answer));
    return new Set(normalized).size > 1;
  }

  private normalizeAnswer(answer: string): string {
    return answer.trim().toLowerCase().replace(/\s+/g, ' ');
  }
}

export function createProblemDetector(config: ProblemDetectorConfig = {}): ProblemDetector {
  return new ProblemDetector(config);
}
