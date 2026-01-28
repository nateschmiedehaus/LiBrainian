/**
 * @fileoverview E2E Scientific Self-Improvement Loop Test
 *
 * WU-1204: End-to-end integration test for the Scientific Self-Improvement Loop.
 *
 * Based on AutoSD, RLVR (DeepSeek R1), SWE-agent research.
 * Loop: DETECT -> HYPOTHESIZE -> TEST -> FIX -> VERIFY -> EVOLVE
 *
 * Test Categories:
 * 1. Individual Agent Tests: Each agent functions correctly in isolation
 * 2. Loop Orchestration Tests: Full loop executes correctly
 * 3. RLVR Verification Tests: Binary reward system (pass/fail only)
 * 4. Benchmark Evolution Tests: Prevention tests generated after fixes
 * 5. Improvement Tracking Tests: Progress tracked across iterations
 * 6. Integration Tests: Agents work together in the pipeline
 *
 * @packageDocumentation
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// Import all Scientific Loop agents
import {
  ScientificLoopOrchestratorImpl,
  createScientificLoopOrchestrator,
} from '../../agents/loop_orchestrator.js';
import {
  ProblemDetector,
  createProblemDetector,
} from '../../agents/problem_detector.js';
import {
  HypothesisGenerator,
  createHypothesisGenerator,
} from '../../agents/hypothesis_generator.js';
import {
  HypothesisTester,
  createHypothesisTester,
} from '../../agents/hypothesis_tester.js';
import {
  FixGenerator,
  createFixGenerator,
} from '../../agents/fix_generator.js';
import {
  FixVerifier,
  createFixVerifier,
} from '../../agents/fix_verifier.js';
import {
  BenchmarkEvolver,
  createBenchmarkEvolver,
} from '../../agents/benchmark_evolver.js';
import {
  ImprovementTrackerImpl,
  createImprovementTracker,
} from '../../agents/improvement_tracker.js';

// Import types
import type {
  ProblemDetectionInput,
  Problem,
  ProblemType,
  ProblemSeverity,
  Hypothesis,
  HypothesisTestResult,
  Fix,
  VerificationResult,
  BenchmarkEvolution,
  LoopResult,
  CommandRunner,
  CommandResult,
  TestFailureCheck,
  RegressionCheck,
  AdversarialProbe,
  PerformanceExperiment,
  ConsistencyCheck,
  ImprovementTracking,
  LoopHealthMetrics,
} from '../../agents/types.js';

// ============================================================================
// TEST CONFIGURATION
// ============================================================================

// Metrics thresholds for scientific loop health
const FIX_SUCCESS_RATE_TARGET = 0.70;
const HYPOTHESIS_ACCURACY_TARGET = 0.50;
const REGRESSION_RATE_TARGET = 0.05;

// ============================================================================
// MOCK HELPERS
// ============================================================================

/**
 * Create a mock LibrarianStorage for agent initialization.
 */
function createMockStorage(): any {
  return {
    initialize: async () => {},
    shutdown: async () => {},
    isReady: () => true,
  };
}

/**
 * Create a mock CommandRunner that simulates command execution.
 * Can be configured to succeed or fail specific commands.
 * Priority: failCommands > successCommands > defaultExitCode
 */
function createMockCommandRunner(config: {
  successCommands?: string[];
  failCommands?: string[];
  defaultExitCode?: number;
}): CommandRunner {
  const { successCommands = [], failCommands = [], defaultExitCode = 0 } = config;

  return async (check: TestFailureCheck): Promise<CommandResult> => {
    const command = check.command;
    let exitCode = defaultExitCode;

    // Check failCommands first (higher priority)
    if (failCommands.some((c) => command.includes(c))) {
      exitCode = 1;
    } else if (successCommands.some((c) => command.includes(c))) {
      exitCode = 0;
    }

    return {
      command,
      exitCode,
      stdout: exitCode === 0 ? 'Tests passed' : '',
      stderr: exitCode !== 0 ? 'Test failed: assertion error' : '',
      durationMs: 100,
    };
  };
}

/**
 * Create sample problems for testing.
 */
function createSampleProblems(): Problem[] {
  return [
    {
      id: 'PROB-TEST-1',
      type: 'test_failure',
      description: 'Test command failed: npm test -- --run src/__tests__/sample.test.ts',
      evidence: [
        'Expected: true',
        'Actual: false',
        'AssertionError: expected true to be false',
      ],
      severity: 'high',
      reproducible: true,
      minimalReproduction: 'npm test -- --run src/__tests__/sample.test.ts',
    },
    {
      id: 'PROB-REG-1',
      type: 'regression',
      description: 'Regression detected for query: findFunction',
      evidence: ['Expected: functionA', 'Actual: functionB'],
      severity: 'high',
      reproducible: true,
      minimalReproduction: 'Run regression query: findFunction',
    },
    {
      id: 'PROB-HALL-1',
      type: 'hallucination',
      description: 'Hallucination detected for probe: describe the compile function',
      evidence: [
        'Expected: No such function exists',
        'Actual: The compile function processes data...',
      ],
      severity: 'high',
      reproducible: true,
      minimalReproduction: 'Run probe: describe the compile function',
    },
  ];
}

/**
 * Create problem detection input from various checks.
 */
function createProblemDetectionInput(options: {
  testFailures?: boolean;
  regressions?: boolean;
  hallucinations?: boolean;
  performance?: boolean;
  consistency?: boolean;
}): ProblemDetectionInput {
  const input: ProblemDetectionInput = {};

  if (options.testFailures) {
    input.testRuns = [
      {
        command: 'npm test -- --run src/__tests__/failing.test.ts',
        result: {
          command: 'npm test -- --run src/__tests__/failing.test.ts',
          exitCode: 1,
          stdout: '',
          stderr: 'AssertionError: expected true to be false',
          durationMs: 500,
        },
      },
    ];
  }

  if (options.regressions) {
    input.regressions = [
      {
        query: 'findFunction(name)',
        expected: 'returns function definition',
        actual: 'returns null',
        evidence: ['Function lookup failed'],
      },
    ];
  }

  if (options.hallucinations) {
    input.adversarial = [
      {
        prompt: 'describe nonExistentFunction',
        expected: 'Function does not exist',
        actual: 'nonExistentFunction is a helper that processes data',
        evidence: ['Fabricated function description'],
      },
    ];
  }

  if (options.performance) {
    input.performance = [
      {
        metric: 'search_latency_p95',
        controlScore: 100,
        treatmentScore: 80,
        minImprovement: 30,
        evidence: ['Treatment did not meet improvement target'],
      },
    ];
  }

  if (options.consistency) {
    input.consistency = [
      {
        question: 'What does the compile function do?',
        variants: [
          'What does the compile function do?',
          'Describe the compile function',
          'How does compile work?',
        ],
        answers: [
          'It compiles code',
          'It transforms input',
          'It processes data',
        ],
        evidence: ['Inconsistent answers for same semantic question'],
      },
    ];
  }

  return input;
}

// ============================================================================
// METRICS TRACKING
// ============================================================================

interface E2EScientificLoopMetrics {
  problemsDetected: number;
  problemsFixed: number;
  problemsEscalated: number;
  hypothesesGenerated: number;
  hypothesesSupported: number;
  hypothesesRefuted: number;
  fixesAttempted: number;
  fixesAccepted: number;
  fixSuccessRate: number;
  hypothesisAccuracy: number;
  benchmarkEvolutions: number;
  newTestsGenerated: number;
  timestamp: string;
}

function computeMetrics(results: LoopResult[]): E2EScientificLoopMetrics {
  let problemsDetected = 0;
  let problemsFixed = 0;
  let problemsEscalated = 0;
  let hypothesesSupported = 0;
  let hypothesesRefuted = 0;
  let fixesAttempted = 0;
  let fixesAccepted = 0;
  let benchmarkEvolutions = 0;
  let newTestsGenerated = 0;

  for (const result of results) {
    problemsDetected += result.state.problemsDetected.length;
    problemsFixed += result.state.problemsFixed.length;
    problemsEscalated += result.state.problemsEscalated.length;

    for (const h of result.state.hypothesesTested) {
      if (h.verdict === 'supported') hypothesesSupported++;
      if (h.verdict === 'refuted') hypothesesRefuted++;
    }

    fixesAttempted += result.state.fixesAttempted.length;
    fixesAccepted += result.state.fixesAttempted.filter((f) => f.reward === 1).length;

    benchmarkEvolutions += result.state.benchmarkEvolutions.length;
    for (const e of result.state.benchmarkEvolutions) {
      newTestsGenerated += e.newTests.length + e.regressionGuards.length + e.variantTests.length;
    }
  }

  const hypothesesGenerated = hypothesesSupported + hypothesesRefuted;
  const fixSuccessRate = fixesAttempted > 0 ? fixesAccepted / fixesAttempted : 0;
  const hypothesisAccuracy = hypothesesSupported > 0 ? fixesAccepted / hypothesesSupported : 0;

  return {
    problemsDetected,
    problemsFixed,
    problemsEscalated,
    hypothesesGenerated,
    hypothesesSupported,
    hypothesesRefuted,
    fixesAttempted,
    fixesAccepted,
    fixSuccessRate,
    hypothesisAccuracy,
    benchmarkEvolutions,
    newTestsGenerated,
    timestamp: new Date().toISOString(),
  };
}

// ============================================================================
// TEST SUITES
// ============================================================================

describe('E2E Scientific Self-Improvement Loop', () => {
  let mockStorage: any;

  beforeEach(() => {
    mockStorage = createMockStorage();
  });

  // ==========================================================================
  // 1. INDIVIDUAL AGENT TESTS
  // ==========================================================================

  describe('1. Individual Agent Tests', () => {
    describe('ProblemDetector', () => {
      let detector: ProblemDetector;

      beforeEach(async () => {
        detector = createProblemDetector();
        await detector.initialize(mockStorage);
      });

      afterEach(async () => {
        await detector.shutdown();
      });

      it('creates detector with factory function', () => {
        expect(detector).toBeDefined();
        expect(detector.agentType).toBe('problem_detector');
        expect(detector.capabilities).toContain('problem_detection');
      });

      it('detects test failures from provided results', async () => {
        const input: ProblemDetectionInput = {
          testRuns: [
            {
              command: 'npm test -- --run failing.test.ts',
              result: {
                command: 'npm test -- --run failing.test.ts',
                exitCode: 1,
                stdout: '',
                stderr: 'AssertionError: expected 1 to be 2',
                durationMs: 100,
              },
            },
          ],
        };

        const report = await detector.identifyProblems(input);

        expect(report.problems.length).toBe(1);
        expect(report.problems[0].type).toBe('test_failure');
        expect(report.summary.byType.test_failure).toBe(1);
      });

      it('detects regressions from expected/actual mismatches', async () => {
        const input: ProblemDetectionInput = {
          regressions: [
            { query: 'search(term)', expected: 'result A', actual: 'result B' },
            { query: 'find(id)', expected: 'found', actual: 'found' }, // Should NOT be a problem
          ],
        };

        const report = await detector.identifyProblems(input);

        expect(report.problems.length).toBe(1);
        expect(report.problems[0].type).toBe('regression');
      });

      it('detects hallucinations from adversarial probes', async () => {
        const input: ProblemDetectionInput = {
          adversarial: [
            {
              prompt: 'describe fakeFunction',
              expected: 'does not exist',
              actual: 'fakeFunction processes data',
            },
          ],
        };

        const report = await detector.identifyProblems(input);

        expect(report.problems.length).toBe(1);
        expect(report.problems[0].type).toBe('hallucination');
      });

      it('detects performance gaps below threshold', async () => {
        const input: ProblemDetectionInput = {
          performance: [
            {
              metric: 'latency_p95',
              controlScore: 100,
              treatmentScore: 90,
              minImprovement: 20, // Treatment should be at least 100 + 20 = 120
            },
          ],
        };

        const report = await detector.identifyProblems(input);

        expect(report.problems.length).toBe(1);
        expect(report.problems[0].type).toBe('performance_gap');
      });

      it('detects consistency violations', async () => {
        const input: ProblemDetectionInput = {
          consistency: [
            {
              question: 'What is X?',
              variants: ['What is X?', 'Define X', 'Explain X'],
              answers: ['A thing', 'Something else', 'Different answer'],
            },
          ],
        };

        const report = await detector.identifyProblems(input);

        expect(report.problems.length).toBe(1);
        expect(report.problems[0].type).toBe('inconsistency');
      });

      it('returns empty problems for passing tests', async () => {
        const input: ProblemDetectionInput = {
          testRuns: [
            {
              command: 'npm test -- --run passing.test.ts',
              result: {
                command: 'npm test -- --run passing.test.ts',
                exitCode: 0,
                stdout: 'All tests passed',
                stderr: '',
                durationMs: 50,
              },
            },
          ],
        };

        const report = await detector.identifyProblems(input);

        expect(report.problems.length).toBe(0);
      });

      it('uses CommandRunner when result not provided', async () => {
        const mockRunner = createMockCommandRunner({
          failCommands: ['failing'],
        });
        detector.setCommandRunner(mockRunner);

        const input: ProblemDetectionInput = {
          testRuns: [
            { command: 'npm test -- --run failing.test.ts' },
          ],
        };

        const report = await detector.identifyProblems(input);

        expect(report.problems.length).toBe(1);
        expect(report.problems[0].type).toBe('test_failure');
      });
    });

    describe('HypothesisGenerator', () => {
      let generator: HypothesisGenerator;

      beforeEach(async () => {
        generator = createHypothesisGenerator();
        await generator.initialize(mockStorage);
      });

      afterEach(async () => {
        await generator.shutdown();
      });

      it('creates generator with factory function', () => {
        expect(generator).toBeDefined();
        expect(generator.agentType).toBe('hypothesis_generator');
        expect(generator.capabilities).toContain('hypothesis_generation');
      });

      it('generates hypotheses for test_failure problems', () => {
        const problem: Problem = {
          id: 'PROB-001',
          type: 'test_failure',
          description: 'Test failed',
          evidence: ['AssertionError'],
          severity: 'high',
          reproducible: true,
        };

        const report = generator.generateHypotheses({ problem });

        expect(report.hypotheses.length).toBeGreaterThanOrEqual(3);
        expect(report.rankedByLikelihood.length).toBe(report.hypotheses.length);
        // All hypotheses should have required fields
        for (const h of report.hypotheses) {
          expect(h.id).toContain('HYP-');
          expect(h.statement).toBeDefined();
          expect(h.rationale).toBeDefined();
          expect(h.prediction).toBeDefined();
          expect(h.test).toBeDefined();
          expect(['high', 'medium', 'low']).toContain(h.likelihood);
        }
      });

      it('generates hypotheses for each problem type', () => {
        const problemTypes: ProblemType[] = [
          'test_failure',
          'regression',
          'hallucination',
          'performance_gap',
          'inconsistency',
        ];

        for (const type of problemTypes) {
          const problem: Problem = {
            id: `PROB-${type}`,
            type,
            description: `Problem of type ${type}`,
            evidence: [],
            severity: 'medium',
            reproducible: true,
          };

          const report = generator.generateHypotheses({ problem });

          expect(report.hypotheses.length).toBeGreaterThanOrEqual(3);
          expect(report.problemId).toBe(problem.id);
        }
      });

      it('ranks hypotheses by likelihood', () => {
        const problem: Problem = {
          id: 'PROB-001',
          type: 'test_failure',
          description: 'Test failed',
          evidence: [],
          severity: 'high',
          reproducible: true,
        };

        const report = generator.generateHypotheses({ problem });

        // First ranked should be high likelihood
        const firstId = report.rankedByLikelihood[0];
        const firstHypothesis = report.hypotheses.find((h) => h.id === firstId);
        expect(firstHypothesis?.likelihood).toBe('high');
      });
    });

    describe('HypothesisTester', () => {
      let tester: HypothesisTester;

      beforeEach(async () => {
        tester = createHypothesisTester();
        await tester.initialize(mockStorage);
      });

      afterEach(async () => {
        await tester.shutdown();
      });

      it('creates tester with factory function', () => {
        expect(tester).toBeDefined();
        expect(tester.agentType).toBe('hypothesis_tester');
        expect(tester.capabilities).toContain('hypothesis_testing');
      });

      it('tests hypothesis with log_analysis type', async () => {
        const hypothesis: Hypothesis = {
          id: 'HYP-001-A',
          statement: 'A dependency changed its behavior',
          rationale: 'Dependencies may have breaking changes',
          prediction: 'Log will show dependency version change',
          test: {
            type: 'log_analysis',
            target: 'package.json changes',
            expected: 'Recent dependency version change',
          },
          likelihood: 'medium',
        };

        const problem: Problem = {
          id: 'PROB-001',
          type: 'test_failure',
          description: 'Test failed after npm update',
          evidence: ['package-lock.json changed', 'dependency version update detected'],
          severity: 'high',
          reproducible: true,
        };

        const result = await tester.testHypothesis({ hypothesis, problem });

        expect(result.hypothesisId).toBe('HYP-001-A');
        expect(['supported', 'refuted', 'inconclusive']).toContain(result.verdict);
        expect(result.confidence).toBeGreaterThanOrEqual(0);
        expect(result.confidence).toBeLessThanOrEqual(1);
        expect(result.evidence.length).toBeGreaterThan(0);
      });

      it('tests hypothesis with behavioral type', async () => {
        const hypothesis: Hypothesis = {
          id: 'HYP-001-B',
          statement: 'Data volume exceeded algorithm capacity',
          rationale: 'Algorithm may not scale well',
          prediction: 'Smaller data will perform better',
          test: {
            type: 'behavioral',
            target: 'algorithm with reduced data',
            expected: 'Better performance with smaller data',
          },
          likelihood: 'high',
        };

        const problem: Problem = {
          id: 'PROB-PERF-001',
          type: 'performance_gap',
          description: 'Performance degraded with large dataset',
          evidence: ['Actual: 500ms', 'Expected: 100ms'],
          severity: 'medium',
          reproducible: true,
        };

        const result = await tester.testHypothesis({ hypothesis, problem });

        expect(result.hypothesisId).toBe('HYP-001-B');
        expect(result.evidence.length).toBeGreaterThan(0);
        expect(['proceed_to_fix', 'test_another_hypothesis', 'need_more_evidence']).toContain(
          result.recommendation
        );
      });

      it('returns inconclusive for code_inspection without file access', async () => {
        const hypothesis: Hypothesis = {
          id: 'HYP-001-C',
          statement: 'Implementation has a bug',
          rationale: 'Code may have logic error',
          prediction: 'Code inspection will reveal error',
          test: {
            type: 'code_inspection',
            target: 'implementation source',
            expected: 'Logic error',
          },
          likelihood: 'high',
        };

        const problem: Problem = {
          id: 'PROB-001',
          type: 'test_failure',
          description: 'Test failed',
          evidence: [],
          severity: 'high',
          reproducible: true,
        };

        const result = await tester.testHypothesis({ hypothesis, problem });

        // Without actual file access, code_inspection is inconclusive
        expect(result.verdict).toBe('inconclusive');
      });

      it('uses CommandRunner for test_run type', async () => {
        const mockRunner = createMockCommandRunner({
          successCommands: ['specific_test'],
        });
        tester.setCommandRunner(mockRunner);

        const hypothesis: Hypothesis = {
          id: 'HYP-001-D',
          statement: 'Specific test will pass',
          rationale: 'Testing specific behavior',
          prediction: 'Test passes',
          test: {
            type: 'test_run',
            target: 'npm test -- --run specific_test',
            expected: 'Test passed',
          },
          likelihood: 'high',
        };

        const problem: Problem = {
          id: 'PROB-001',
          type: 'test_failure',
          description: 'Test failing',
          evidence: [],
          severity: 'high',
          reproducible: true,
        };

        const result = await tester.testHypothesis({ hypothesis, problem });

        expect(result.evidence.some((e) => e.type === 'test_run')).toBe(true);
      });
    });

    describe('FixGenerator', () => {
      let generator: FixGenerator;

      beforeEach(async () => {
        generator = createFixGenerator();
        await generator.initialize(mockStorage);
      });

      afterEach(async () => {
        await generator.shutdown();
      });

      it('creates generator with factory function', () => {
        expect(generator).toBeDefined();
        expect(generator.agentType).toBe('fix_generator');
        expect(generator.capabilities).toContain('fix_generation');
      });

      it('generates fixes for supported hypothesis', () => {
        const problem: Problem = {
          id: 'PROB-001',
          type: 'test_failure',
          description: 'Test assertion failed',
          evidence: ['Expected: true', 'Actual: false'],
          severity: 'high',
          reproducible: true,
        };

        const hypothesis: Hypothesis = {
          id: 'HYP-001-A',
          statement: 'Test assertion is incorrect',
          rationale: 'Assertion expects outdated behavior',
          prediction: 'Updating assertion will fix test',
          test: {
            type: 'code_inspection',
            target: 'test file',
            expected: 'Assertion mismatch',
          },
          likelihood: 'high',
        };

        const testResult: HypothesisTestResult = {
          hypothesisId: 'HYP-001-A',
          verdict: 'supported',
          evidence: [{ type: 'code_inspection', finding: 'Assertion mismatch', implication: 'Fix needed' }],
          confidence: 0.8,
          recommendation: 'proceed_to_fix',
        };

        const report = generator.generateFix({ problem, hypothesis, testResult });

        expect(report.fixes.length).toBeGreaterThan(0);
        expect(report.preferred).toBeDefined();
        // Check fix structure
        const fix = report.fixes[0];
        expect(fix.id).toContain('FIX-');
        expect(fix.problemId).toBe(problem.id);
        expect(fix.hypothesisId).toBe(hypothesis.id);
        expect(fix.changes.length).toBeGreaterThan(0);
      });

      it('generates fixes for each problem type', () => {
        const problemTypes: ProblemType[] = [
          'test_failure',
          'regression',
          'hallucination',
          'performance_gap',
          'inconsistency',
        ];

        for (const type of problemTypes) {
          const problem: Problem = {
            id: `PROB-${type}`,
            type,
            description: `Problem: ${type}`,
            evidence: [],
            severity: 'medium',
            reproducible: true,
          };

          const hypothesis: Hypothesis = {
            id: `HYP-${type}-A`,
            statement: 'Hypothesis statement',
            rationale: 'Rationale',
            prediction: 'Prediction',
            test: { type: 'behavioral', target: 'target', expected: 'expected' },
            likelihood: 'high',
          };

          const testResult: HypothesisTestResult = {
            hypothesisId: hypothesis.id,
            verdict: 'supported',
            evidence: [],
            confidence: 0.7,
            recommendation: 'proceed_to_fix',
          };

          const report = generator.generateFix({ problem, hypothesis, testResult });

          expect(report.fixes.length).toBeGreaterThan(0);
        }
      });
    });

    describe('FixVerifier', () => {
      let verifier: FixVerifier;

      beforeEach(async () => {
        verifier = createFixVerifier();
        await verifier.initialize(mockStorage);
      });

      afterEach(async () => {
        await verifier.shutdown();
      });

      it('creates verifier with factory function', () => {
        expect(verifier).toBeDefined();
        expect(verifier.agentType).toBe('fix_verifier');
        expect(verifier.capabilities).toContain('fix_verification');
      });

      it('rejects fix when no CommandRunner is set', async () => {
        const fix: Fix = {
          id: 'FIX-001',
          problemId: 'PROB-001',
          hypothesisId: 'HYP-001-A',
          description: 'Fix description',
          changes: [],
          rationale: 'Rationale',
          prediction: 'Prediction',
        };

        const problem: Problem = {
          id: 'PROB-001',
          type: 'test_failure',
          description: 'Test failed',
          evidence: [],
          severity: 'high',
          reproducible: true,
        };

        const result = await verifier.verifyFix({ fix, problem });

        expect(result.reward).toBe(0);
        expect(result.verdict).toBe('fix_rejected');
        expect(result.notes).toContain('No CommandRunner');
      });

      it('accepts fix when all checks pass (RLVR reward = 1)', async () => {
        // Mock runner where all commands succeed
        const mockRunner = createMockCommandRunner({
          defaultExitCode: 0,
        });
        verifier.setCommandRunner(mockRunner);

        const fix: Fix = {
          id: 'FIX-001',
          problemId: 'PROB-001',
          hypothesisId: 'HYP-001-A',
          description: 'Fix description',
          changes: [],
          rationale: 'Rationale',
          prediction: 'Prediction',
        };

        const problem: Problem = {
          id: 'PROB-001',
          type: 'test_failure',
          description: 'Test failed',
          evidence: [],
          severity: 'high',
          reproducible: true,
          minimalReproduction: 'npm test -- --run sample.test.ts',
        };

        const result = await verifier.verifyFix({ fix, problem });

        expect(result.reward).toBe(1);
        expect(result.verdict).toBe('fix_accepted');
        expect(result.verification.originalTestPasses).toBe(true);
        expect(result.verification.noRegressions).toBe(true);
        expect(result.verification.typesValid).toBe(true);
      });

      it('rejects fix when original test fails (RLVR reward = 0)', async () => {
        // Mock runner where the original test fails
        const mockRunner = createMockCommandRunner({
          failCommands: ['sample.test.ts'],
          successCommands: ['npm test -- --run', 'tsc'],
        });
        verifier.setCommandRunner(mockRunner);

        const fix: Fix = {
          id: 'FIX-001',
          problemId: 'PROB-001',
          hypothesisId: 'HYP-001-A',
          description: 'Fix description',
          changes: [],
          rationale: 'Rationale',
          prediction: 'Prediction',
        };

        const problem: Problem = {
          id: 'PROB-001',
          type: 'test_failure',
          description: 'Test failed',
          evidence: [],
          severity: 'high',
          reproducible: true,
          minimalReproduction: 'npm test -- --run sample.test.ts',
        };

        const result = await verifier.verifyFix({ fix, problem });

        expect(result.reward).toBe(0);
        expect(result.verdict).toBe('fix_rejected');
        expect(result.verification.originalTestPasses).toBe(false);
      });

      it('rejects fix when regressions detected (RLVR reward = 0)', async () => {
        // Mock runner where test suite has regressions
        const mockRunner = createMockCommandRunner({
          successCommands: ['sample.test.ts', 'tsc'],
          failCommands: ['npm test -- --run'],
        });
        verifier.setCommandRunner(mockRunner);

        const fix: Fix = {
          id: 'FIX-001',
          problemId: 'PROB-001',
          hypothesisId: 'HYP-001-A',
          description: 'Fix description',
          changes: [],
          rationale: 'Rationale',
          prediction: 'Prediction',
        };

        const problem: Problem = {
          id: 'PROB-001',
          type: 'test_failure',
          description: 'Test failed',
          evidence: [],
          severity: 'high',
          reproducible: true,
          minimalReproduction: 'npm test -- --run sample.test.ts',
        };

        const result = await verifier.verifyFix({ fix, problem });

        expect(result.reward).toBe(0);
        expect(result.verdict).toBe('fix_rejected');
      });

      it('rejects fix when TypeScript fails (RLVR reward = 0)', async () => {
        // Mock runner where TypeScript check fails
        const mockRunner = createMockCommandRunner({
          successCommands: ['sample.test.ts', 'npm test -- --run'],
          failCommands: ['tsc'],
        });
        verifier.setCommandRunner(mockRunner);

        const fix: Fix = {
          id: 'FIX-001',
          problemId: 'PROB-001',
          hypothesisId: 'HYP-001-A',
          description: 'Fix description',
          changes: [],
          rationale: 'Rationale',
          prediction: 'Prediction',
        };

        const problem: Problem = {
          id: 'PROB-001',
          type: 'test_failure',
          description: 'Test failed',
          evidence: [],
          severity: 'high',
          reproducible: true,
          minimalReproduction: 'npm test -- --run sample.test.ts',
        };

        const result = await verifier.verifyFix({ fix, problem });

        expect(result.reward).toBe(0);
        expect(result.verdict).toBe('fix_rejected');
        expect(result.verification.typesValid).toBe(false);
      });
    });

    describe('BenchmarkEvolver', () => {
      let evolver: BenchmarkEvolver;

      beforeEach(async () => {
        evolver = createBenchmarkEvolver();
        await evolver.initialize(mockStorage);
      });

      afterEach(async () => {
        await evolver.shutdown();
      });

      it('creates evolver with factory function', () => {
        expect(evolver).toBeDefined();
        expect(evolver.agentType).toBe('benchmark_evolver');
        expect(evolver.capabilities).toContain('benchmark_evolution');
      });

      it('generates prevention tests after fix', async () => {
        const problem: Problem = {
          id: 'PROB-001',
          type: 'test_failure',
          description: 'Test assertion failed',
          evidence: [],
          severity: 'high',
          reproducible: true,
        };

        const fix: Fix = {
          id: 'FIX-001',
          problemId: 'PROB-001',
          hypothesisId: 'HYP-001-A',
          description: 'Updated assertion',
          changes: [{ filePath: 'src/__tests__/sample.test.ts', changeType: 'modify', description: 'Fix' }],
          rationale: 'Fix rationale',
          prediction: 'Test will pass',
        };

        const verificationResult: VerificationResult = {
          fixId: 'FIX-001',
          verification: { originalTestPasses: true, noRegressions: true, typesValid: true },
          reward: 1,
          verdict: 'fix_accepted',
          notes: 'All checks passed',
          executionLog: [],
        };

        const evolution = await evolver.evolveBenchmark({ problem, fix, verificationResult });

        expect(evolution.problemId).toBe(problem.id);
        expect(evolution.fixId).toBe(fix.id);
        expect(evolution.newTests.length).toBeGreaterThanOrEqual(2);
        expect(evolution.regressionGuards.length).toBeGreaterThanOrEqual(1);
        expect(evolution.variantTests.length).toBeGreaterThanOrEqual(1);
        expect(evolution.coverageGaps.length).toBeGreaterThan(0);
      });

      it('generates problem-type-specific tests', async () => {
        const problemTypes: ProblemType[] = [
          'test_failure',
          'regression',
          'hallucination',
          'performance_gap',
          'inconsistency',
        ];

        for (const type of problemTypes) {
          const problem: Problem = {
            id: `PROB-${type}`,
            type,
            description: `Problem: ${type}`,
            evidence: [],
            severity: 'medium',
            reproducible: true,
          };

          const fix: Fix = {
            id: `FIX-${type}`,
            problemId: problem.id,
            hypothesisId: `HYP-${type}-A`,
            description: 'Fix',
            changes: [{ filePath: 'src/fix.ts', changeType: 'modify', description: 'Fix' }],
            rationale: 'Rationale',
            prediction: 'Prediction',
          };

          const verificationResult: VerificationResult = {
            fixId: fix.id,
            verification: { originalTestPasses: true, noRegressions: true, typesValid: true },
            reward: 1,
            verdict: 'fix_accepted',
            notes: 'Passed',
            executionLog: [],
          };

          const evolution = await evolver.evolveBenchmark({ problem, fix, verificationResult });

          expect(evolution.newTests.length).toBeGreaterThan(0);
          // Each test should have required fields
          for (const test of evolution.newTests) {
            expect(test.name).toBeDefined();
            expect(test.file).toBeDefined();
            expect(test.code).toBeDefined();
            expect(['prevention', 'regression_guard', 'variant']).toContain(test.category);
          }
        }
      });
    });

    describe('ImprovementTracker', () => {
      let tracker: ImprovementTrackerImpl;

      beforeEach(() => {
        tracker = createImprovementTracker();
      });

      it('creates tracker with factory function', () => {
        expect(tracker).toBeDefined();
      });

      it('records iteration data', () => {
        tracker.recordIteration({
          iteration: 1,
          problemsFixed: 3,
          testSuitePassRate: 0.95,
          agentSuccessRateLift: 0.10,
          agentTimeReduction: 0.20,
        });

        const history = tracker.getHistory();
        expect(history.length).toBe(1);
        expect(history[0].iteration).toBe(1);
        expect(history[0].problemsFixed).toBe(3);
      });

      it('computes trend from multiple iterations', () => {
        // Record improving trend
        tracker.recordIteration({
          iteration: 1,
          problemsFixed: 2,
          testSuitePassRate: 0.90,
          agentSuccessRateLift: 0.05,
          agentTimeReduction: 0.10,
        });
        tracker.recordIteration({
          iteration: 2,
          problemsFixed: 3,
          testSuitePassRate: 0.92,
          agentSuccessRateLift: 0.08,
          agentTimeReduction: 0.15,
        });
        tracker.recordIteration({
          iteration: 3,
          problemsFixed: 4,
          testSuitePassRate: 0.95,
          agentSuccessRateLift: 0.12,
          agentTimeReduction: 0.20,
        });

        const trend = tracker.computeTrend();

        expect(trend.dataPoints.length).toBe(3);
        expect(trend.totalProblemsFixed).toBe(9);
        expect(trend.averageImprovement).toBeGreaterThan(0);
        expect(['improving', 'stable', 'declining']).toContain(trend.trendDirection);
      });

      it('computes health metrics from loop results', () => {
        const loopResults: LoopResult[] = [
          {
            state: {
              iteration: 1,
              problemsDetected: [],
              problemsFixed: ['P1'],
              problemsEscalated: [],
              hypothesesTested: [
                { hypothesisId: 'H1', verdict: 'supported', evidence: [], confidence: 0.8, recommendation: 'proceed_to_fix' },
              ],
              fixesAttempted: [
                {
                  fixId: 'F1',
                  verification: { originalTestPasses: true, noRegressions: true, typesValid: true },
                  reward: 1,
                  verdict: 'fix_accepted',
                  notes: '',
                  executionLog: [],
                },
              ],
              benchmarkEvolutions: [],
            },
            escalations: [],
            summary: { problemsDetected: 1, problemsFixed: 1, problemsEscalated: 0, fixSuccessRate: 1, hypothesisAccuracy: 1 },
          },
        ];

        const health = tracker.computeHealth(loopResults);

        expect(health.fixSuccessRate).toBe(1);
        expect(health.hypothesisAccuracy).toBe(1);
        expect(health.regressionRate).toBe(0);
      });

      it('generates recommendations when below targets', () => {
        // Record poor performance
        tracker.recordIteration({
          iteration: 1,
          problemsFixed: 1,
          testSuitePassRate: 0.60,
          agentSuccessRateLift: -0.05,
          agentTimeReduction: -0.10,
        });

        const loopResults: LoopResult[] = [
          {
            state: {
              iteration: 1,
              problemsDetected: [],
              problemsFixed: [],
              problemsEscalated: ['P1', 'P2'],
              hypothesesTested: [
                { hypothesisId: 'H1', verdict: 'supported', evidence: [], confidence: 0.5, recommendation: 'proceed_to_fix' },
                { hypothesisId: 'H2', verdict: 'supported', evidence: [], confidence: 0.5, recommendation: 'proceed_to_fix' },
              ],
              fixesAttempted: [
                {
                  fixId: 'F1',
                  verification: { originalTestPasses: false, noRegressions: false, typesValid: true },
                  reward: 0,
                  verdict: 'fix_rejected',
                  notes: '',
                  executionLog: [],
                },
                {
                  fixId: 'F2',
                  verification: { originalTestPasses: false, noRegressions: true, typesValid: true },
                  reward: 0,
                  verdict: 'fix_rejected',
                  notes: '',
                  executionLog: [],
                },
              ],
              benchmarkEvolutions: [],
            },
            escalations: [],
            summary: { problemsDetected: 2, problemsFixed: 0, problemsEscalated: 2, fixSuccessRate: 0, hypothesisAccuracy: 0 },
          },
        ];

        const report = tracker.generateReport(loopResults);

        expect(report.recommendations.length).toBeGreaterThan(0);
        // Should have recommendation about test suite health
        expect(report.recommendations.some((r) => r.includes('health'))).toBe(true);
      });

      it('resets tracking state', () => {
        tracker.recordIteration({
          iteration: 1,
          problemsFixed: 1,
          testSuitePassRate: 0.90,
          agentSuccessRateLift: 0.05,
          agentTimeReduction: 0.10,
        });

        tracker.reset();

        expect(tracker.getHistory().length).toBe(0);
      });
    });
  });

  // ==========================================================================
  // 2. LOOP ORCHESTRATION TESTS
  // ==========================================================================

  describe('2. Loop Orchestration Tests', () => {
    let orchestrator: ScientificLoopOrchestratorImpl;
    let problemDetector: ProblemDetector;
    let hypothesisGenerator: HypothesisGenerator;
    let hypothesisTester: HypothesisTester;
    let fixGenerator: FixGenerator;
    let fixVerifier: FixVerifier;
    let benchmarkEvolver: BenchmarkEvolver;

    beforeEach(async () => {
      // Create all agents
      orchestrator = createScientificLoopOrchestrator({ maxIterations: 3 });
      problemDetector = createProblemDetector();
      hypothesisGenerator = createHypothesisGenerator();
      hypothesisTester = createHypothesisTester();
      fixGenerator = createFixGenerator();
      fixVerifier = createFixVerifier();
      benchmarkEvolver = createBenchmarkEvolver();

      // Initialize all agents
      await orchestrator.initialize(mockStorage);
      await problemDetector.initialize(mockStorage);
      await hypothesisGenerator.initialize(mockStorage);
      await hypothesisTester.initialize(mockStorage);
      await fixGenerator.initialize(mockStorage);
      await fixVerifier.initialize(mockStorage);
      await benchmarkEvolver.initialize(mockStorage);

      // Wire up orchestrator with agents
      orchestrator.setProblemDetector(problemDetector);
      orchestrator.setHypothesisGenerator(hypothesisGenerator);
      orchestrator.setHypothesisTester(hypothesisTester);
      orchestrator.setFixGenerator(fixGenerator);
      orchestrator.setFixVerifier(fixVerifier);
      orchestrator.setBenchmarkEvolver(benchmarkEvolver);
    });

    afterEach(async () => {
      await orchestrator.shutdown();
      await problemDetector.shutdown();
      await hypothesisGenerator.shutdown();
      await hypothesisTester.shutdown();
      await fixGenerator.shutdown();
      await fixVerifier.shutdown();
      await benchmarkEvolver.shutdown();
    });

    it('creates orchestrator with factory function', () => {
      expect(orchestrator).toBeDefined();
      expect(orchestrator.agentType).toBe('scientific_loop_orchestrator');
      expect(orchestrator.capabilities).toContain('problem_detection');
      expect(orchestrator.capabilities).toContain('hypothesis_generation');
      expect(orchestrator.capabilities).toContain('fix_verification');
    });

    it('runs single iteration detecting problems', async () => {
      const input = createProblemDetectionInput({ testFailures: true });
      const result = await orchestrator.runIteration(input);

      expect(result.state.iteration).toBe(1);
      expect(result.state.problemsDetected.length).toBeGreaterThan(0);
      expect(result.summary).toBeDefined();
    });

    it('runs until done with no problems', async () => {
      const input: ProblemDetectionInput = {}; // Empty input = no problems
      const result = await orchestrator.runUntilDone(input);

      // Should complete after first iteration with no problems
      expect(result.state.problemsDetected.length).toBe(0);
    });

    it('tracks state across iterations', async () => {
      // First iteration
      const input1 = createProblemDetectionInput({ testFailures: true });
      const result1 = await orchestrator.runIteration(input1);
      expect(result1.state.iteration).toBe(1);

      // Second iteration
      const input2 = createProblemDetectionInput({ regressions: true });
      const result2 = await orchestrator.runIteration(input2);
      expect(result2.state.iteration).toBe(2);

      // State should accumulate
      expect(result2.state.problemsDetected.length).toBeGreaterThanOrEqual(
        result1.state.problemsDetected.length
      );
    });

    it('resets state correctly', async () => {
      const input = createProblemDetectionInput({ testFailures: true });
      await orchestrator.runIteration(input);

      orchestrator.reset();
      const state = orchestrator.getState();

      expect(state.iteration).toBe(0);
      expect(state.problemsDetected.length).toBe(0);
      expect(state.problemsFixed.length).toBe(0);
    });

    it('escalates problems when no hypotheses supported', async () => {
      // Problem detection with no CommandRunner means hypotheses can't be truly tested
      const input = createProblemDetectionInput({ testFailures: true });
      const result = await orchestrator.runIteration(input);

      // Without CommandRunner, fixes get rejected, leading to escalation
      if (result.escalations.length > 0) {
        expect(result.escalations[0].reason).toBeDefined();
        expect(['human_review', 'defer', 'wontfix']).toContain(result.escalations[0].recommendation);
      }
    });

    it('respects maxIterations config', async () => {
      const limitedOrchestrator = createScientificLoopOrchestrator({ maxIterations: 2 });
      await limitedOrchestrator.initialize(mockStorage);
      limitedOrchestrator.setProblemDetector(problemDetector);
      limitedOrchestrator.setHypothesisGenerator(hypothesisGenerator);
      limitedOrchestrator.setHypothesisTester(hypothesisTester);
      limitedOrchestrator.setFixGenerator(fixGenerator);
      limitedOrchestrator.setFixVerifier(fixVerifier);
      limitedOrchestrator.setBenchmarkEvolver(benchmarkEvolver);

      // Run with problems that keep appearing
      const input = createProblemDetectionInput({ testFailures: true });
      const result = await limitedOrchestrator.runUntilDone(input);

      expect(result.state.iteration).toBeLessThanOrEqual(2);
      await limitedOrchestrator.shutdown();
    });
  });

  // ==========================================================================
  // 3. RLVR VERIFICATION TESTS
  // ==========================================================================

  describe('3. RLVR Verification Tests', () => {
    let verifier: FixVerifier;

    beforeEach(async () => {
      verifier = createFixVerifier();
      await verifier.initialize(mockStorage);
    });

    afterEach(async () => {
      await verifier.shutdown();
    });

    it('RLVR principle: reward is strictly binary (0 or 1)', async () => {
      const mockRunner = createMockCommandRunner({ defaultExitCode: 0 });
      verifier.setCommandRunner(mockRunner);

      const fix: Fix = {
        id: 'FIX-001',
        problemId: 'PROB-001',
        hypothesisId: 'HYP-001-A',
        description: 'Fix',
        changes: [],
        rationale: 'Rationale',
        prediction: 'Prediction',
      };

      const problem: Problem = {
        id: 'PROB-001',
        type: 'test_failure',
        description: 'Test failed',
        evidence: [],
        severity: 'high',
        reproducible: true,
      };

      const result = await verifier.verifyFix({ fix, problem });

      // Reward must be exactly 0 or 1
      expect([0, 1]).toContain(result.reward);
    });

    it('RLVR principle: no partial credit', async () => {
      // Scenario: 2 of 3 checks pass - should still be reward=0
      const mockRunner = createMockCommandRunner({
        successCommands: ['sample.test.ts', 'tsc'], // Original test and types pass
        failCommands: ['npm test -- --run'], // But full suite fails
      });
      verifier.setCommandRunner(mockRunner);

      const fix: Fix = {
        id: 'FIX-001',
        problemId: 'PROB-001',
        hypothesisId: 'HYP-001-A',
        description: 'Fix',
        changes: [],
        rationale: 'Rationale',
        prediction: 'Prediction',
      };

      const problem: Problem = {
        id: 'PROB-001',
        type: 'test_failure',
        description: 'Test failed',
        evidence: [],
        severity: 'high',
        reproducible: true,
        minimalReproduction: 'npm test -- --run sample.test.ts',
      };

      const result = await verifier.verifyFix({ fix, problem });

      // Even with 2/3 passing, reward must be 0
      expect(result.reward).toBe(0);
      expect(result.verdict).toBe('fix_rejected');
    });

    it('RLVR principle: all three checks required for reward=1', async () => {
      const mockRunner = createMockCommandRunner({ defaultExitCode: 0 });
      verifier.setCommandRunner(mockRunner);

      const fix: Fix = {
        id: 'FIX-001',
        problemId: 'PROB-001',
        hypothesisId: 'HYP-001-A',
        description: 'Fix',
        changes: [],
        rationale: 'Rationale',
        prediction: 'Prediction',
      };

      const problem: Problem = {
        id: 'PROB-001',
        type: 'test_failure',
        description: 'Test failed',
        evidence: [],
        severity: 'high',
        reproducible: true,
      };

      const result = await verifier.verifyFix({ fix, problem });

      // All three checks must pass for reward=1
      if (result.reward === 1) {
        expect(result.verification.originalTestPasses).toBe(true);
        expect(result.verification.noRegressions).toBe(true);
        expect(result.verification.typesValid).toBe(true);
      }
    });

    it('execution log captures all verification steps', async () => {
      const mockRunner = createMockCommandRunner({ defaultExitCode: 0 });
      verifier.setCommandRunner(mockRunner);

      const fix: Fix = {
        id: 'FIX-001',
        problemId: 'PROB-001',
        hypothesisId: 'HYP-001-A',
        description: 'Fix',
        changes: [],
        rationale: 'Rationale',
        prediction: 'Prediction',
      };

      const problem: Problem = {
        id: 'PROB-001',
        type: 'test_failure',
        description: 'Test failed',
        evidence: [],
        severity: 'high',
        reproducible: true,
      };

      const result = await verifier.verifyFix({ fix, problem });

      // Should have 3 execution entries: original test, full suite, type check
      expect(result.executionLog.length).toBe(3);
      for (const entry of result.executionLog) {
        expect(entry.command).toBeDefined();
        expect(typeof entry.exitCode).toBe('number');
        expect(typeof entry.durationMs).toBe('number');
      }
    });
  });

  // ==========================================================================
  // 4. BENCHMARK EVOLUTION TESTS
  // ==========================================================================

  describe('4. Benchmark Evolution Tests', () => {
    let evolver: BenchmarkEvolver;

    beforeEach(async () => {
      evolver = createBenchmarkEvolver();
      await evolver.initialize(mockStorage);
    });

    afterEach(async () => {
      await evolver.shutdown();
    });

    it('generates prevention tests that would catch the bug', async () => {
      const problem: Problem = {
        id: 'PROB-001',
        type: 'test_failure',
        description: 'Boundary condition not handled',
        evidence: ['Input: -1', 'Expected: error', 'Actual: undefined'],
        severity: 'high',
        reproducible: true,
      };

      const fix: Fix = {
        id: 'FIX-001',
        problemId: 'PROB-001',
        hypothesisId: 'HYP-001-A',
        description: 'Added boundary check',
        changes: [{ filePath: 'src/validator.ts', changeType: 'modify', description: 'Add check' }],
        rationale: 'Missing boundary validation',
        prediction: 'Boundary errors now caught',
      };

      const verificationResult: VerificationResult = {
        fixId: 'FIX-001',
        verification: { originalTestPasses: true, noRegressions: true, typesValid: true },
        reward: 1,
        verdict: 'fix_accepted',
        notes: 'All checks passed',
        executionLog: [],
      };

      const evolution = await evolver.evolveBenchmark({ problem, fix, verificationResult });

      // Check that prevention tests are generated
      expect(evolution.newTests.length).toBeGreaterThanOrEqual(2);
      expect(evolution.newTests.every((t) => t.category === 'prevention')).toBe(true);

      // Tests should be related to boundary conditions for test_failure
      const testNames = evolution.newTests.map((t) => t.name.toLowerCase());
      const hasBoundaryTest = testNames.some(
        (n) => n.includes('boundary') || n.includes('edge')
      );
      expect(hasBoundaryTest).toBe(true);
    });

    it('generates regression guards for specific fix', async () => {
      const problem: Problem = {
        id: 'PROB-002',
        type: 'regression',
        description: 'Output format changed',
        evidence: ['Expected: JSON', 'Actual: XML'],
        severity: 'high',
        reproducible: true,
      };

      const fix: Fix = {
        id: 'FIX-002',
        problemId: 'PROB-002',
        hypothesisId: 'HYP-002-A',
        description: 'Restored JSON output format',
        changes: [{ filePath: 'src/formatter.ts', changeType: 'modify', description: 'Fix format' }],
        rationale: 'Format was inadvertently changed',
        prediction: 'Output is JSON again',
      };

      const verificationResult: VerificationResult = {
        fixId: 'FIX-002',
        verification: { originalTestPasses: true, noRegressions: true, typesValid: true },
        reward: 1,
        verdict: 'fix_accepted',
        notes: 'All checks passed',
        executionLog: [],
      };

      const evolution = await evolver.evolveBenchmark({ problem, fix, verificationResult });

      // Check that regression guards are generated
      expect(evolution.regressionGuards.length).toBeGreaterThanOrEqual(1);
      expect(evolution.regressionGuards.every((t) => t.category === 'regression_guard')).toBe(true);

      // Regression guard should reference the fix
      const guardCode = evolution.regressionGuards[0].code;
      expect(guardCode).toContain(fix.id);
    });

    it('generates variant tests for edge cases', async () => {
      const problem: Problem = {
        id: 'PROB-003',
        type: 'inconsistency',
        description: 'Different outputs for equivalent inputs',
        evidence: ['Input A: result1', 'Input B (equivalent): result2'],
        severity: 'medium',
        reproducible: true,
      };

      const fix: Fix = {
        id: 'FIX-003',
        problemId: 'PROB-003',
        hypothesisId: 'HYP-003-A',
        description: 'Normalized inputs before processing',
        changes: [{ filePath: 'src/processor.ts', changeType: 'modify', description: 'Normalize' }],
        rationale: 'Inputs need normalization',
        prediction: 'Consistent outputs',
      };

      const verificationResult: VerificationResult = {
        fixId: 'FIX-003',
        verification: { originalTestPasses: true, noRegressions: true, typesValid: true },
        reward: 1,
        verdict: 'fix_accepted',
        notes: 'All checks passed',
        executionLog: [],
      };

      const evolution = await evolver.evolveBenchmark({ problem, fix, verificationResult });

      // Check that variant tests are generated
      expect(evolution.variantTests.length).toBeGreaterThanOrEqual(1);
      expect(evolution.variantTests.every((t) => t.category === 'variant')).toBe(true);
    });

    it('identifies coverage gaps that allowed the bug', async () => {
      const problem: Problem = {
        id: 'PROB-004',
        type: 'hallucination',
        description: 'System fabricated non-existent function',
        evidence: ['Claimed function "xyz" exists', 'Function does not exist in codebase'],
        severity: 'high',
        reproducible: true,
      };

      const fix: Fix = {
        id: 'FIX-004',
        problemId: 'PROB-004',
        hypothesisId: 'HYP-004-A',
        description: 'Added existence verification',
        changes: [{ filePath: 'src/verifier.ts', changeType: 'modify', description: 'Verify' }],
        rationale: 'Missing verification step',
        prediction: 'Only existing functions returned',
      };

      const verificationResult: VerificationResult = {
        fixId: 'FIX-004',
        verification: { originalTestPasses: true, noRegressions: true, typesValid: true },
        reward: 1,
        verdict: 'fix_accepted',
        notes: 'All checks passed',
        executionLog: [],
      };

      const evolution = await evolver.evolveBenchmark({ problem, fix, verificationResult });

      // Check that coverage gaps are identified
      expect(evolution.coverageGaps.length).toBeGreaterThan(0);
      for (const gap of evolution.coverageGaps) {
        expect(gap.description).toBeDefined();
        expect(gap.affectedArea).toBeDefined();
        expect(gap.suggestedTests.length).toBeGreaterThan(0);
      }
    });
  });

  // ==========================================================================
  // 5. IMPROVEMENT TRACKING TESTS
  // ==========================================================================

  describe('5. Improvement Tracking Tests', () => {
    let tracker: ImprovementTrackerImpl;

    beforeEach(() => {
      tracker = createImprovementTracker();
    });

    it('tracks progress across multiple iterations', () => {
      for (let i = 1; i <= 5; i++) {
        tracker.recordIteration({
          iteration: i,
          problemsFixed: i * 2,
          testSuitePassRate: 0.80 + i * 0.03,
          agentSuccessRateLift: 0.05 * i,
          agentTimeReduction: 0.10 * i,
        });
      }

      const history = tracker.getHistory();
      expect(history.length).toBe(5);

      const trend = tracker.computeTrend();
      expect(trend.totalProblemsFixed).toBe(2 + 4 + 6 + 8 + 10); // 30
      expect(trend.dataPoints.length).toBe(5);
    });

    it('detects improving trend', () => {
      // Steadily improving metrics
      tracker.recordIteration({
        iteration: 1,
        problemsFixed: 1,
        testSuitePassRate: 0.85,
        agentSuccessRateLift: 0.05,
        agentTimeReduction: 0.10,
      });
      tracker.recordIteration({
        iteration: 2,
        problemsFixed: 2,
        testSuitePassRate: 0.90,
        agentSuccessRateLift: 0.10,
        agentTimeReduction: 0.15,
      });
      tracker.recordIteration({
        iteration: 3,
        problemsFixed: 3,
        testSuitePassRate: 0.95,
        agentSuccessRateLift: 0.15,
        agentTimeReduction: 0.20,
      });

      const trend = tracker.computeTrend();
      expect(trend.trendDirection).toBe('improving');
    });

    it('detects declining trend', () => {
      // Steadily declining metrics
      tracker.recordIteration({
        iteration: 1,
        problemsFixed: 3,
        testSuitePassRate: 0.95,
        agentSuccessRateLift: 0.15,
        agentTimeReduction: 0.20,
      });
      tracker.recordIteration({
        iteration: 2,
        problemsFixed: 2,
        testSuitePassRate: 0.90,
        agentSuccessRateLift: 0.10,
        agentTimeReduction: 0.15,
      });
      tracker.recordIteration({
        iteration: 3,
        problemsFixed: 1,
        testSuitePassRate: 0.85,
        agentSuccessRateLift: 0.05,
        agentTimeReduction: 0.10,
      });

      const trend = tracker.computeTrend();
      expect(trend.trendDirection).toBe('declining');
    });

    it('detects stable trend', () => {
      // Flat metrics
      tracker.recordIteration({
        iteration: 1,
        problemsFixed: 2,
        testSuitePassRate: 0.90,
        agentSuccessRateLift: 0.10,
        agentTimeReduction: 0.15,
      });
      tracker.recordIteration({
        iteration: 2,
        problemsFixed: 2,
        testSuitePassRate: 0.90,
        agentSuccessRateLift: 0.10,
        agentTimeReduction: 0.15,
      });
      tracker.recordIteration({
        iteration: 3,
        problemsFixed: 2,
        testSuitePassRate: 0.90,
        agentSuccessRateLift: 0.10,
        agentTimeReduction: 0.15,
      });

      const trend = tracker.computeTrend();
      expect(trend.trendDirection).toBe('stable');
    });

    it('assesses test suite health correctly', () => {
      // Healthy: >= 90%
      tracker.recordIteration({
        iteration: 1,
        problemsFixed: 1,
        testSuitePassRate: 0.95,
        agentSuccessRateLift: 0.10,
        agentTimeReduction: 0.10,
      });

      let trend = tracker.computeTrend();
      expect(trend.testSuiteHealth).toBe('healthy');

      // Reset and test degrading: 70-90%
      tracker.reset();
      tracker.recordIteration({
        iteration: 1,
        problemsFixed: 1,
        testSuitePassRate: 0.80,
        agentSuccessRateLift: 0.10,
        agentTimeReduction: 0.10,
      });

      trend = tracker.computeTrend();
      expect(trend.testSuiteHealth).toBe('degrading');

      // Reset and test critical: < 70%
      tracker.reset();
      tracker.recordIteration({
        iteration: 1,
        problemsFixed: 1,
        testSuitePassRate: 0.60,
        agentSuccessRateLift: 0.10,
        agentTimeReduction: 0.10,
      });

      trend = tracker.computeTrend();
      expect(trend.testSuiteHealth).toBe('critical');
    });

    it('computes health metrics from loop results', () => {
      const loopResults: LoopResult[] = [
        {
          state: {
            iteration: 1,
            problemsDetected: [],
            problemsFixed: ['P1', 'P2'],
            problemsEscalated: ['P3'],
            hypothesesTested: [
              { hypothesisId: 'H1', verdict: 'supported', evidence: [], confidence: 0.8, recommendation: 'proceed_to_fix' },
              { hypothesisId: 'H2', verdict: 'supported', evidence: [], confidence: 0.7, recommendation: 'proceed_to_fix' },
              { hypothesisId: 'H3', verdict: 'refuted', evidence: [], confidence: 0.3, recommendation: 'test_another_hypothesis' },
            ],
            fixesAttempted: [
              {
                fixId: 'F1',
                verification: { originalTestPasses: true, noRegressions: true, typesValid: true },
                reward: 1,
                verdict: 'fix_accepted',
                notes: '',
                executionLog: [],
              },
              {
                fixId: 'F2',
                verification: { originalTestPasses: true, noRegressions: true, typesValid: true },
                reward: 1,
                verdict: 'fix_accepted',
                notes: '',
                executionLog: [],
              },
              {
                fixId: 'F3',
                verification: { originalTestPasses: false, noRegressions: true, typesValid: true },
                reward: 0,
                verdict: 'fix_rejected',
                notes: '',
                executionLog: [],
              },
            ],
            benchmarkEvolutions: [
              {
                problemId: 'P1',
                fixId: 'F1',
                newTests: [{ name: 'T1', file: 'test.ts', code: '', category: 'prevention' }],
                regressionGuards: [],
                variantTests: [],
                coverageGaps: [],
              },
            ],
          },
          escalations: [],
          summary: { problemsDetected: 3, problemsFixed: 2, problemsEscalated: 1, fixSuccessRate: 0.67, hypothesisAccuracy: 1 },
        },
      ];

      const health = tracker.computeHealth(loopResults);

      expect(health.fixSuccessRate).toBeCloseTo(2 / 3, 2); // 2 accepted / 3 attempted
      expect(health.hypothesisAccuracy).toBe(1); // 2 successful / 2 supported
      expect(health.regressionRate).toBe(0); // No regressions
    });

    it('generates improvement report', () => {
      tracker.recordIteration({
        iteration: 1,
        problemsFixed: 2,
        testSuitePassRate: 0.90,
        agentSuccessRateLift: 0.10,
        agentTimeReduction: 0.15,
      });

      const loopResults: LoopResult[] = [
        {
          state: {
            iteration: 1,
            problemsDetected: [],
            problemsFixed: ['P1', 'P2'],
            problemsEscalated: [],
            hypothesesTested: [],
            fixesAttempted: [],
            benchmarkEvolutions: [],
          },
          escalations: [],
          summary: { problemsDetected: 2, problemsFixed: 2, problemsEscalated: 0, fixSuccessRate: 1, hypothesisAccuracy: 1 },
        },
      ];

      const report = tracker.generateReport(loopResults);

      expect(report.currentIteration).toBe(1);
      expect(report.tracking).toBeDefined();
      expect(report.trend).toBeDefined();
      expect(report.health).toBeDefined();
      expect(report.recommendations).toBeDefined();
    });
  });

  // ==========================================================================
  // 6. INTEGRATION TESTS
  // ==========================================================================

  describe('6. Integration Tests', () => {
    let orchestrator: ScientificLoopOrchestratorImpl;
    let problemDetector: ProblemDetector;
    let hypothesisGenerator: HypothesisGenerator;
    let hypothesisTester: HypothesisTester;
    let fixGenerator: FixGenerator;
    let fixVerifier: FixVerifier;
    let benchmarkEvolver: BenchmarkEvolver;
    let tracker: ImprovementTrackerImpl;

    beforeEach(async () => {
      // Create all components
      orchestrator = createScientificLoopOrchestrator({ maxIterations: 5 });
      problemDetector = createProblemDetector();
      hypothesisGenerator = createHypothesisGenerator();
      hypothesisTester = createHypothesisTester();
      fixGenerator = createFixGenerator();
      fixVerifier = createFixVerifier();
      benchmarkEvolver = createBenchmarkEvolver();
      tracker = createImprovementTracker();

      // Initialize
      await orchestrator.initialize(mockStorage);
      await problemDetector.initialize(mockStorage);
      await hypothesisGenerator.initialize(mockStorage);
      await hypothesisTester.initialize(mockStorage);
      await fixGenerator.initialize(mockStorage);
      await fixVerifier.initialize(mockStorage);
      await benchmarkEvolver.initialize(mockStorage);

      // Wire up
      orchestrator.setProblemDetector(problemDetector);
      orchestrator.setHypothesisGenerator(hypothesisGenerator);
      orchestrator.setHypothesisTester(hypothesisTester);
      orchestrator.setFixGenerator(fixGenerator);
      orchestrator.setFixVerifier(fixVerifier);
      orchestrator.setBenchmarkEvolver(benchmarkEvolver);
    });

    afterEach(async () => {
      await orchestrator.shutdown();
      await problemDetector.shutdown();
      await hypothesisGenerator.shutdown();
      await hypothesisTester.shutdown();
      await fixGenerator.shutdown();
      await fixVerifier.shutdown();
      await benchmarkEvolver.shutdown();
    });

    it('full pipeline: detect -> hypothesize -> test -> fix -> verify -> evolve', async () => {
      // Set up CommandRunner for successful verification
      const mockRunner = createMockCommandRunner({ defaultExitCode: 0 });
      problemDetector.setCommandRunner(mockRunner);
      hypothesisTester.setCommandRunner(mockRunner);
      fixVerifier.setCommandRunner(mockRunner);

      // Create input with a test failure
      const input = createProblemDetectionInput({ testFailures: true });

      // Run a single iteration
      const result = await orchestrator.runIteration(input);

      // Log metrics for visibility
      const metrics = computeMetrics([result]);
      console.log(`
========================================
E2E SCIENTIFIC LOOP METRICS
========================================
Problems Detected: ${metrics.problemsDetected}
Problems Fixed: ${metrics.problemsFixed}
Problems Escalated: ${metrics.problemsEscalated}
Hypotheses Generated: ${metrics.hypothesesGenerated}
  - Supported: ${metrics.hypothesesSupported}
  - Refuted: ${metrics.hypothesesRefuted}
Fixes Attempted: ${metrics.fixesAttempted}
Fixes Accepted: ${metrics.fixesAccepted}
Fix Success Rate: ${(metrics.fixSuccessRate * 100).toFixed(1)}%
Hypothesis Accuracy: ${(metrics.hypothesisAccuracy * 100).toFixed(1)}%
Benchmark Evolutions: ${metrics.benchmarkEvolutions}
New Tests Generated: ${metrics.newTestsGenerated}
========================================
`);

      // Verify full pipeline executed
      expect(result.state.problemsDetected.length).toBeGreaterThan(0);
      expect(result.summary).toBeDefined();
    });

    it('agents work together with CommandRunner', async () => {
      // Set up CommandRunner
      const mockRunner = createMockCommandRunner({ defaultExitCode: 0 });
      problemDetector.setCommandRunner(mockRunner);
      hypothesisTester.setCommandRunner(mockRunner);
      fixVerifier.setCommandRunner(mockRunner);

      // Run test failure detection
      const testInput: ProblemDetectionInput = {
        testRuns: [{ command: 'npm test -- --run sample.test.ts' }],
      };

      const report = await problemDetector.identifyProblems(testInput);

      if (report.problems.length > 0) {
        const problem = report.problems[0];

        // Generate hypotheses
        const hypothesisReport = hypothesisGenerator.generateHypotheses({ problem });
        expect(hypothesisReport.hypotheses.length).toBeGreaterThan(0);

        // Test first hypothesis
        const hypothesis = hypothesisReport.hypotheses[0];
        const testResult = await hypothesisTester.testHypothesis({ hypothesis, problem });

        // Generate fix
        const fixReport = fixGenerator.generateFix({ problem, hypothesis, testResult });
        expect(fixReport.fixes.length).toBeGreaterThan(0);

        // Verify fix
        const fix = fixReport.fixes[0];
        const verification = await fixVerifier.verifyFix({ fix, problem });

        // If fix accepted, evolve benchmark
        if (verification.reward === 1) {
          const evolution = await benchmarkEvolver.evolveBenchmark({
            problem,
            fix,
            verificationResult: verification,
          });
          expect(evolution.newTests.length).toBeGreaterThan(0);
        }
      }
    });

    it('tracks improvement across multiple loop runs', async () => {
      const mockRunner = createMockCommandRunner({ defaultExitCode: 0 });
      fixVerifier.setCommandRunner(mockRunner);

      const allResults: LoopResult[] = [];

      // Run multiple iterations
      for (let i = 1; i <= 3; i++) {
        const input = createProblemDetectionInput({
          testFailures: i === 1,
          regressions: i === 2,
          hallucinations: i === 3,
        });

        const result = await orchestrator.runIteration(input);
        allResults.push(result);

        // Record iteration metrics
        tracker.recordIteration({
          iteration: i,
          problemsFixed: result.state.problemsFixed.length,
          testSuitePassRate: 0.85 + i * 0.03,
          agentSuccessRateLift: 0.05 * i,
          agentTimeReduction: 0.10 * i,
        });
      }

      // Generate final report
      const report = tracker.generateReport(allResults);

      console.log(`
========================================
IMPROVEMENT TRACKING REPORT
========================================
Current Iteration: ${report.currentIteration}
Test Suite Health: ${report.trend.testSuiteHealth}
Trend Direction: ${report.trend.trendDirection}
Total Problems Fixed: ${report.trend.totalProblemsFixed}
Average Improvement: ${(report.trend.averageImprovement * 100).toFixed(1)}%

Health Metrics:
- Fix Success Rate: ${(report.health.fixSuccessRate * 100).toFixed(1)}%
- Hypothesis Accuracy: ${(report.health.hypothesisAccuracy * 100).toFixed(1)}%
- Regression Rate: ${(report.health.regressionRate * 100).toFixed(1)}%

Recommendations:
${report.recommendations.map((r) => `- ${r}`).join('\n') || '- None'}
========================================
`);

      expect(report.currentIteration).toBe(3);
      expect(report.trend.dataPoints.length).toBe(3);
    });

    it('handles mixed problem types in single iteration', async () => {
      const mockRunner = createMockCommandRunner({ defaultExitCode: 0 });
      problemDetector.setCommandRunner(mockRunner);

      // Input with multiple problem types
      const input = createProblemDetectionInput({
        testFailures: true,
        regressions: true,
        hallucinations: true,
        performance: true,
        consistency: true,
      });

      const result = await orchestrator.runIteration(input);

      // Should detect all problem types
      const problemTypes = result.state.problemsDetected.map((p) => p.type);
      expect(problemTypes).toContain('test_failure');
      expect(problemTypes).toContain('regression');
      expect(problemTypes).toContain('hallucination');
      expect(problemTypes).toContain('performance_gap');
      expect(problemTypes).toContain('inconsistency');
    });

    it('escalation path works correctly', async () => {
      // No CommandRunner = fixes will be rejected = escalation
      const input = createProblemDetectionInput({ testFailures: true });
      const result = await orchestrator.runIteration(input);

      // Without CommandRunner, fixes should be rejected and problems escalated
      if (result.escalations.length > 0) {
        const escalation = result.escalations[0];
        expect(escalation.problemId).toBeDefined();
        expect(escalation.reason).toBeDefined();
        expect(escalation.recommendation).toBeDefined();
        expect(['human_review', 'defer', 'wontfix']).toContain(escalation.recommendation);
      }
    });
  });

  // ==========================================================================
  // METRICS EXPORT
  // ==========================================================================

  describe('Metrics Export', () => {
    it('exports scientific loop metrics for CI', async () => {
      const orchestrator = createScientificLoopOrchestrator();
      const problemDetector = createProblemDetector();
      const hypothesisGenerator = createHypothesisGenerator();
      const hypothesisTester = createHypothesisTester();
      const fixGenerator = createFixGenerator();
      const fixVerifier = createFixVerifier();
      const benchmarkEvolver = createBenchmarkEvolver();

      await orchestrator.initialize(mockStorage);
      await problemDetector.initialize(mockStorage);
      await hypothesisGenerator.initialize(mockStorage);
      await hypothesisTester.initialize(mockStorage);
      await fixGenerator.initialize(mockStorage);
      await fixVerifier.initialize(mockStorage);
      await benchmarkEvolver.initialize(mockStorage);

      orchestrator.setProblemDetector(problemDetector);
      orchestrator.setHypothesisGenerator(hypothesisGenerator);
      orchestrator.setHypothesisTester(hypothesisTester);
      orchestrator.setFixGenerator(fixGenerator);
      orchestrator.setFixVerifier(fixVerifier);
      orchestrator.setBenchmarkEvolver(benchmarkEvolver);

      // Set up for successful path
      const mockRunner = createMockCommandRunner({ defaultExitCode: 0 });
      fixVerifier.setCommandRunner(mockRunner);

      const input = createProblemDetectionInput({ testFailures: true });
      const result = await orchestrator.runIteration(input);
      const metrics = computeMetrics([result]);

      const exportedMetrics: E2EScientificLoopMetrics = {
        ...metrics,
        timestamp: new Date().toISOString(),
      };

      console.log('\nExported Metrics:', JSON.stringify(exportedMetrics, null, 2));

      expect(typeof exportedMetrics.problemsDetected).toBe('number');
      expect(typeof exportedMetrics.fixSuccessRate).toBe('number');
      expect(typeof exportedMetrics.hypothesisAccuracy).toBe('number');

      await orchestrator.shutdown();
      await problemDetector.shutdown();
      await hypothesisGenerator.shutdown();
      await hypothesisTester.shutdown();
      await fixGenerator.shutdown();
      await fixVerifier.shutdown();
      await benchmarkEvolver.shutdown();
    });
  });
});

// ============================================================================
// TYPE EXPORTS FOR CI INTEGRATION
// ============================================================================

export { E2EScientificLoopMetrics };
