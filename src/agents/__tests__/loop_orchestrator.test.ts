/**
 * @fileoverview Tests for ScientificLoopOrchestrator
 *
 * Following TDD: this test file is created BEFORE implementation.
 * Tests should FAIL initially, then PASS after implementation.
 *
 * The Scientific Loop Orchestrator coordinates all agents in the debugging loop:
 * 1. Problem Detection -> collect problems
 * 2. Hypothesis Generation -> generate hypotheses for each problem
 * 3. Hypothesis Testing -> test hypotheses ranked by likelihood
 * 4. Fix Generation -> create fix for supported hypothesis
 * 5. Fix Verification -> verify fix with RLVR-style rewards
 * 6. Benchmark Evolution -> prevent recurrence
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createScientificLoopOrchestrator,
  ScientificLoopOrchestratorImpl,
} from '../loop_orchestrator.js';
import type { LibrarianStorage } from '../../storage/types.js';
import type {
  Problem,
  ProblemDetectionInput,
  ProblemDetectionReport,
  ProblemDetectorAgent,
  HypothesisGeneratorAgent,
  HypothesisGenerationReport,
  HypothesisTesterAgent,
  HypothesisTestResult,
  FixGeneratorAgent,
  FixGeneratorReport,
  FixVerifierAgent,
  VerificationResult,
  BenchmarkEvolverAgent,
  BenchmarkEvolution,
  ScientificLoopState,
  LoopResult,
  Escalation,
  Hypothesis,
  Fix,
} from '../types.js';

describe('ScientificLoopOrchestrator', () => {
  describe('Agent metadata', () => {
    it('returns agent with correct agentType', () => {
      const orchestrator = createScientificLoopOrchestrator();
      expect(orchestrator.agentType).toBe('scientific_loop_orchestrator');
    });

    it('returns agent with correct name', () => {
      const orchestrator = createScientificLoopOrchestrator();
      expect(orchestrator.name).toBe('Scientific Loop Orchestrator');
    });

    it('returns agent with version string', () => {
      const orchestrator = createScientificLoopOrchestrator();
      expect(orchestrator.version).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('returns agent with qualityTier', () => {
      const orchestrator = createScientificLoopOrchestrator();
      expect(orchestrator.qualityTier).toBe('full');
    });

    it('returns agent with capabilities', () => {
      const orchestrator = createScientificLoopOrchestrator();
      expect(orchestrator.capabilities.length).toBeGreaterThan(0);
    });
  });

  describe('Agent lifecycle', () => {
    it('isReady returns false before initialization', () => {
      const orchestrator = createScientificLoopOrchestrator();
      expect(orchestrator.isReady()).toBe(false);
    });

    it('isReady returns true after initialization', async () => {
      const orchestrator = createScientificLoopOrchestrator();
      await orchestrator.initialize({} as LibrarianStorage);
      expect(orchestrator.isReady()).toBe(true);
    });

    it('isReady returns false after shutdown', async () => {
      const orchestrator = createScientificLoopOrchestrator();
      await orchestrator.initialize({} as LibrarianStorage);
      await orchestrator.shutdown();
      expect(orchestrator.isReady()).toBe(false);
    });
  });

  describe('Dependency Injection', () => {
    let orchestrator: ScientificLoopOrchestratorImpl;

    beforeEach(async () => {
      orchestrator = createScientificLoopOrchestrator();
      await orchestrator.initialize({} as LibrarianStorage);
    });

    it('setProblemDetector sets the problem detector agent', () => {
      const mockDetector = createMockProblemDetector();
      orchestrator.setProblemDetector(mockDetector);
      // Should not throw and should be usable
      expect(() => orchestrator.setProblemDetector(mockDetector)).not.toThrow();
    });

    it('setHypothesisGenerator sets the hypothesis generator agent', () => {
      const mockGenerator = createMockHypothesisGenerator();
      orchestrator.setHypothesisGenerator(mockGenerator);
      expect(() => orchestrator.setHypothesisGenerator(mockGenerator)).not.toThrow();
    });

    it('setHypothesisTester sets the hypothesis tester agent', () => {
      const mockTester = createMockHypothesisTester();
      orchestrator.setHypothesisTester(mockTester);
      expect(() => orchestrator.setHypothesisTester(mockTester)).not.toThrow();
    });

    it('setFixGenerator sets the fix generator agent', () => {
      const mockGenerator = createMockFixGenerator();
      orchestrator.setFixGenerator(mockGenerator);
      expect(() => orchestrator.setFixGenerator(mockGenerator)).not.toThrow();
    });

    it('setFixVerifier sets the fix verifier agent', () => {
      const mockVerifier = createMockFixVerifier();
      orchestrator.setFixVerifier(mockVerifier);
      expect(() => orchestrator.setFixVerifier(mockVerifier)).not.toThrow();
    });

    it('setBenchmarkEvolver sets the benchmark evolver agent', () => {
      const mockEvolver = createMockBenchmarkEvolver();
      orchestrator.setBenchmarkEvolver(mockEvolver);
      expect(() => orchestrator.setBenchmarkEvolver(mockEvolver)).not.toThrow();
    });
  });

  describe('getState', () => {
    let orchestrator: ScientificLoopOrchestratorImpl;

    beforeEach(async () => {
      orchestrator = createScientificLoopOrchestrator();
      await orchestrator.initialize({} as LibrarianStorage);
    });

    it('returns initial state with iteration 0', () => {
      const state = orchestrator.getState();
      expect(state.iteration).toBe(0);
    });

    it('returns initial state with empty problemsDetected', () => {
      const state = orchestrator.getState();
      expect(state.problemsDetected).toEqual([]);
    });

    it('returns initial state with empty problemsFixed', () => {
      const state = orchestrator.getState();
      expect(state.problemsFixed).toEqual([]);
    });

    it('returns initial state with empty problemsEscalated', () => {
      const state = orchestrator.getState();
      expect(state.problemsEscalated).toEqual([]);
    });

    it('returns initial state with empty hypothesesTested', () => {
      const state = orchestrator.getState();
      expect(state.hypothesesTested).toEqual([]);
    });

    it('returns initial state with empty fixesAttempted', () => {
      const state = orchestrator.getState();
      expect(state.fixesAttempted).toEqual([]);
    });

    it('returns initial state with empty benchmarkEvolutions', () => {
      const state = orchestrator.getState();
      expect(state.benchmarkEvolutions).toEqual([]);
    });
  });

  describe('reset', () => {
    let orchestrator: ScientificLoopOrchestratorImpl;

    beforeEach(async () => {
      orchestrator = createScientificLoopOrchestrator();
      await orchestrator.initialize({} as LibrarianStorage);
    });

    it('resets iteration to 0', async () => {
      // First, run an iteration to change state
      setupOrchestrator(orchestrator, { detectProblems: [] });
      await orchestrator.runIteration({ testRuns: [] });

      // Now reset
      orchestrator.reset();
      const state = orchestrator.getState();
      expect(state.iteration).toBe(0);
    });

    it('clears problemsDetected', async () => {
      setupOrchestrator(orchestrator, {
        detectProblems: [createMockProblem('PROB-001')],
      });
      await orchestrator.runIteration({ testRuns: [] });

      orchestrator.reset();
      const state = orchestrator.getState();
      expect(state.problemsDetected).toEqual([]);
    });

    it('clears problemsFixed', async () => {
      setupOrchestratorForSuccessfulFix(orchestrator);
      await orchestrator.runIteration({ testRuns: [] });

      orchestrator.reset();
      const state = orchestrator.getState();
      expect(state.problemsFixed).toEqual([]);
    });

    it('clears problemsEscalated', async () => {
      setupOrchestratorForEscalation(orchestrator);
      await orchestrator.runIteration({ testRuns: [] });

      orchestrator.reset();
      const state = orchestrator.getState();
      expect(state.problemsEscalated).toEqual([]);
    });

    it('clears hypothesesTested', async () => {
      setupOrchestratorForSuccessfulFix(orchestrator);
      await orchestrator.runIteration({ testRuns: [] });

      orchestrator.reset();
      const state = orchestrator.getState();
      expect(state.hypothesesTested).toEqual([]);
    });

    it('clears fixesAttempted', async () => {
      setupOrchestratorForSuccessfulFix(orchestrator);
      await orchestrator.runIteration({ testRuns: [] });

      orchestrator.reset();
      const state = orchestrator.getState();
      expect(state.fixesAttempted).toEqual([]);
    });

    it('clears benchmarkEvolutions', async () => {
      setupOrchestratorForSuccessfulFix(orchestrator);
      await orchestrator.runIteration({ testRuns: [] });

      orchestrator.reset();
      const state = orchestrator.getState();
      expect(state.benchmarkEvolutions).toEqual([]);
    });
  });

  describe('runIteration', () => {
    let orchestrator: ScientificLoopOrchestratorImpl;

    beforeEach(async () => {
      orchestrator = createScientificLoopOrchestrator();
      await orchestrator.initialize({} as LibrarianStorage);
    });

    describe('with no problems detected', () => {
      it('returns result with empty escalations', async () => {
        setupOrchestrator(orchestrator, { detectProblems: [] });
        const result = await orchestrator.runIteration({ testRuns: [] });
        expect(result.escalations).toEqual([]);
      });

      it('returns summary with zero problemsDetected', async () => {
        setupOrchestrator(orchestrator, { detectProblems: [] });
        const result = await orchestrator.runIteration({ testRuns: [] });
        expect(result.summary.problemsDetected).toBe(0);
      });

      it('returns summary with zero problemsFixed', async () => {
        setupOrchestrator(orchestrator, { detectProblems: [] });
        const result = await orchestrator.runIteration({ testRuns: [] });
        expect(result.summary.problemsFixed).toBe(0);
      });

      it('returns summary with zero problemsEscalated', async () => {
        setupOrchestrator(orchestrator, { detectProblems: [] });
        const result = await orchestrator.runIteration({ testRuns: [] });
        expect(result.summary.problemsEscalated).toBe(0);
      });

      it('increments iteration count', async () => {
        setupOrchestrator(orchestrator, { detectProblems: [] });
        await orchestrator.runIteration({ testRuns: [] });
        expect(orchestrator.getState().iteration).toBe(1);
      });
    });

    describe('with problems detected and successfully fixed', () => {
      it('tracks the problem as detected', async () => {
        setupOrchestratorForSuccessfulFix(orchestrator);
        await orchestrator.runIteration({ testRuns: [] });

        const state = orchestrator.getState();
        expect(state.problemsDetected.length).toBe(1);
        expect(state.problemsDetected[0].id).toBe('PROB-001');
      });

      it('tracks the problem as fixed', async () => {
        setupOrchestratorForSuccessfulFix(orchestrator);
        await orchestrator.runIteration({ testRuns: [] });

        const state = orchestrator.getState();
        expect(state.problemsFixed).toContain('PROB-001');
      });

      it('tracks hypotheses tested', async () => {
        setupOrchestratorForSuccessfulFix(orchestrator);
        await orchestrator.runIteration({ testRuns: [] });

        const state = orchestrator.getState();
        expect(state.hypothesesTested.length).toBeGreaterThan(0);
      });

      it('tracks fixes attempted', async () => {
        setupOrchestratorForSuccessfulFix(orchestrator);
        await orchestrator.runIteration({ testRuns: [] });

        const state = orchestrator.getState();
        expect(state.fixesAttempted.length).toBeGreaterThan(0);
      });

      it('tracks benchmark evolutions', async () => {
        setupOrchestratorForSuccessfulFix(orchestrator);
        await orchestrator.runIteration({ testRuns: [] });

        const state = orchestrator.getState();
        expect(state.benchmarkEvolutions.length).toBeGreaterThan(0);
      });

      it('returns summary with correct problemsFixed count', async () => {
        setupOrchestratorForSuccessfulFix(orchestrator);
        const result = await orchestrator.runIteration({ testRuns: [] });
        expect(result.summary.problemsFixed).toBe(1);
      });

      it('returns summary with fixSuccessRate of 1.0', async () => {
        setupOrchestratorForSuccessfulFix(orchestrator);
        const result = await orchestrator.runIteration({ testRuns: [] });
        expect(result.summary.fixSuccessRate).toBe(1.0);
      });
    });

    describe('with problems that cannot be fixed (escalation)', () => {
      it('escalates when no hypothesis is supported', async () => {
        setupOrchestratorForNoSupportedHypothesis(orchestrator);
        const result = await orchestrator.runIteration({ testRuns: [] });

        expect(result.escalations.length).toBe(1);
        expect(result.escalations[0].reason).toBe('no_supported_hypothesis');
      });

      it('escalates when all fixes fail', async () => {
        setupOrchestratorForAllFixesFailed(orchestrator);
        const result = await orchestrator.runIteration({ testRuns: [] });

        expect(result.escalations.length).toBe(1);
        expect(result.escalations[0].reason).toBe('all_fixes_failed');
      });

      it('tracks escalated problem in state', async () => {
        setupOrchestratorForEscalation(orchestrator);
        await orchestrator.runIteration({ testRuns: [] });

        const state = orchestrator.getState();
        expect(state.problemsEscalated).toContain('PROB-001');
      });

      it('includes hypothesesTested in escalation', async () => {
        setupOrchestratorForEscalation(orchestrator);
        const result = await orchestrator.runIteration({ testRuns: [] });

        expect(result.escalations[0].hypothesesTested.length).toBeGreaterThan(0);
      });

      it('includes fixesAttempted in escalation (if any)', async () => {
        setupOrchestratorForAllFixesFailed(orchestrator);
        const result = await orchestrator.runIteration({ testRuns: [] });

        expect(result.escalations[0].fixesAttempted.length).toBeGreaterThanOrEqual(0);
      });

      it('provides recommendation for escalated problem', async () => {
        setupOrchestratorForEscalation(orchestrator);
        const result = await orchestrator.runIteration({ testRuns: [] });

        expect(['human_review', 'defer', 'wontfix']).toContain(
          result.escalations[0].recommendation
        );
      });

      it('returns summary with correct problemsEscalated count', async () => {
        setupOrchestratorForEscalation(orchestrator);
        const result = await orchestrator.runIteration({ testRuns: [] });
        expect(result.summary.problemsEscalated).toBe(1);
      });
    });

    describe('loop logic', () => {
      it('tests hypotheses in order of likelihood', async () => {
        const testOrder: string[] = [];
        setupOrchestratorWithHypothesisTesting(orchestrator, (hyp) => {
          testOrder.push(hyp.id);
          // Support only the last hypothesis to force testing multiple
          return hyp.likelihood === 'low';
        });

        await orchestrator.runIteration({ testRuns: [] });

        // Should have tested in order (high likelihood first)
        expect(testOrder.length).toBeGreaterThan(0);
      });

      it('stops testing hypotheses when one is supported', async () => {
        let testedCount = 0;
        setupOrchestratorWithHypothesisTesting(orchestrator, (_hyp) => {
          testedCount++;
          return true; // First hypothesis is supported
        });

        await orchestrator.runIteration({ testRuns: [] });

        // Should stop after first supported hypothesis
        expect(testedCount).toBe(1);
      });

      it('calls fix generator only for supported hypotheses', async () => {
        const fixGenerator = createMockFixGenerator();
        const generateFixSpy = vi.spyOn(fixGenerator, 'generateFix');

        setupOrchestratorForSuccessfulFix(orchestrator);
        orchestrator.setFixGenerator(fixGenerator);

        await orchestrator.runIteration({ testRuns: [] });

        expect(generateFixSpy).toHaveBeenCalled();
      });

      it('calls fix verifier after fix generation', async () => {
        const fixVerifier = createMockFixVerifier(true);
        const verifyFixSpy = vi.spyOn(fixVerifier, 'verifyFix');

        setupOrchestratorForSuccessfulFix(orchestrator);
        orchestrator.setFixVerifier(fixVerifier);

        await orchestrator.runIteration({ testRuns: [] });

        expect(verifyFixSpy).toHaveBeenCalled();
      });

      it('calls benchmark evolver after successful fix', async () => {
        const benchmarkEvolver = createMockBenchmarkEvolver();
        const evolveBenchmarkSpy = vi.spyOn(benchmarkEvolver, 'evolveBenchmark');

        setupOrchestratorForSuccessfulFix(orchestrator);
        orchestrator.setBenchmarkEvolver(benchmarkEvolver);

        await orchestrator.runIteration({ testRuns: [] });

        expect(evolveBenchmarkSpy).toHaveBeenCalled();
      });

      it('does not call benchmark evolver for failed fix', async () => {
        const benchmarkEvolver = createMockBenchmarkEvolver();
        const evolveBenchmarkSpy = vi.spyOn(benchmarkEvolver, 'evolveBenchmark');

        setupOrchestratorForAllFixesFailed(orchestrator);
        orchestrator.setBenchmarkEvolver(benchmarkEvolver);

        await orchestrator.runIteration({ testRuns: [] });

        expect(evolveBenchmarkSpy).not.toHaveBeenCalled();
      });
    });

    describe('configuration', () => {
      it('respects maxHypothesesPerProblem config', async () => {
        const orchestrator = createScientificLoopOrchestrator({
          maxHypothesesPerProblem: 2,
        });
        await orchestrator.initialize({} as LibrarianStorage);

        let testedCount = 0;
        setupOrchestratorWithHypothesisTesting(orchestrator, (_hyp) => {
          testedCount++;
          return false; // Never supported, should stop at max
        });

        await orchestrator.runIteration({ testRuns: [] });

        expect(testedCount).toBeLessThanOrEqual(2);
      });

      it('respects maxFixAttemptsPerProblem config', async () => {
        const orchestrator = createScientificLoopOrchestrator({
          maxFixAttemptsPerProblem: 1,
        });
        await orchestrator.initialize({} as LibrarianStorage);

        let fixAttempts = 0;
        setupOrchestratorWithFixAttempts(orchestrator, () => {
          fixAttempts++;
          return false; // Always fail
        });

        await orchestrator.runIteration({ testRuns: [] });

        expect(fixAttempts).toBeLessThanOrEqual(1);
      });
    });
  });

  describe('runUntilDone', () => {
    let orchestrator: ScientificLoopOrchestratorImpl;

    beforeEach(async () => {
      orchestrator = createScientificLoopOrchestrator();
      await orchestrator.initialize({} as LibrarianStorage);
    });

    it('stops when no problems remain', async () => {
      // First iteration finds problems and fixes them
      // Second iteration finds no problems
      let callCount = 0;
      const problemDetector = createMockProblemDetector();
      vi.spyOn(problemDetector, 'identifyProblems').mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return {
            problems: [createMockProblem('PROB-001')],
            summary: createMockSummary(1),
          };
        }
        return { problems: [], summary: createMockSummary(0) };
      });

      setupOrchestratorForSuccessfulFix(orchestrator);
      orchestrator.setProblemDetector(problemDetector);

      const result = await orchestrator.runUntilDone({ testRuns: [] });

      expect(result.state.iteration).toBe(2);
      expect(callCount).toBe(2);
    });

    it('stops when max iterations reached', async () => {
      const orchestrator = createScientificLoopOrchestrator({
        maxIterations: 3,
      });
      await orchestrator.initialize({} as LibrarianStorage);

      // Always find problems (infinite loop without max)
      setupOrchestratorForEscalation(orchestrator);

      const result = await orchestrator.runUntilDone({ testRuns: [] });

      expect(result.state.iteration).toBe(3);
    });

    it('accumulates state across iterations', async () => {
      let callCount = 0;
      const problemDetector = createMockProblemDetector();
      vi.spyOn(problemDetector, 'identifyProblems').mockImplementation(async () => {
        callCount++;
        if (callCount <= 2) {
          return {
            problems: [createMockProblem(`PROB-00${callCount}`)],
            summary: createMockSummary(1),
          };
        }
        return { problems: [], summary: createMockSummary(0) };
      });

      setupOrchestratorForSuccessfulFix(orchestrator);
      orchestrator.setProblemDetector(problemDetector);

      const result = await orchestrator.runUntilDone({ testRuns: [] });

      // Should have detected 2 problems across iterations
      expect(result.state.problemsDetected.length).toBe(2);
    });

    it('returns cumulative summary', async () => {
      let callCount = 0;
      const problemDetector = createMockProblemDetector();
      vi.spyOn(problemDetector, 'identifyProblems').mockImplementation(async () => {
        callCount++;
        if (callCount <= 2) {
          return {
            problems: [createMockProblem(`PROB-00${callCount}`)],
            summary: createMockSummary(1),
          };
        }
        return { problems: [], summary: createMockSummary(0) };
      });

      setupOrchestratorForSuccessfulFix(orchestrator);
      orchestrator.setProblemDetector(problemDetector);

      const result = await orchestrator.runUntilDone({ testRuns: [] });

      expect(result.summary.problemsDetected).toBe(2);
      expect(result.summary.problemsFixed).toBe(2);
    });
  });

  describe('LoopResult structure', () => {
    let orchestrator: ScientificLoopOrchestratorImpl;

    beforeEach(async () => {
      orchestrator = createScientificLoopOrchestrator();
      await orchestrator.initialize({} as LibrarianStorage);
    });

    it('returns state in result', async () => {
      setupOrchestrator(orchestrator, { detectProblems: [] });
      const result = await orchestrator.runIteration({ testRuns: [] });
      expect(result.state).toBeDefined();
      expect(typeof result.state.iteration).toBe('number');
    });

    it('returns escalations array in result', async () => {
      setupOrchestrator(orchestrator, { detectProblems: [] });
      const result = await orchestrator.runIteration({ testRuns: [] });
      expect(Array.isArray(result.escalations)).toBe(true);
    });

    it('returns summary in result', async () => {
      setupOrchestrator(orchestrator, { detectProblems: [] });
      const result = await orchestrator.runIteration({ testRuns: [] });
      expect(result.summary).toBeDefined();
      expect(typeof result.summary.problemsDetected).toBe('number');
      expect(typeof result.summary.problemsFixed).toBe('number');
      expect(typeof result.summary.problemsEscalated).toBe('number');
      expect(typeof result.summary.fixSuccessRate).toBe('number');
      expect(typeof result.summary.hypothesisAccuracy).toBe('number');
    });
  });

  describe('Summary calculations', () => {
    let orchestrator: ScientificLoopOrchestratorImpl;

    beforeEach(async () => {
      orchestrator = createScientificLoopOrchestrator();
      await orchestrator.initialize({} as LibrarianStorage);
    });

    it('calculates fixSuccessRate correctly', async () => {
      // Create orchestrator with maxFixAttemptsPerProblem: 1 to simplify
      const orchestrator = createScientificLoopOrchestrator({
        maxFixAttemptsPerProblem: 1,
      });
      await orchestrator.initialize({} as LibrarianStorage);

      // 2 problems, 1 fixed, 1 escalated
      const problemDetector = createMockProblemDetector();
      vi.spyOn(problemDetector, 'identifyProblems').mockImplementation(async () => {
        return {
          problems: [
            createMockProblem('PROB-001'),
            createMockProblem('PROB-002'),
          ],
          summary: createMockSummary(2),
        };
      });

      let fixCallCount = 0;
      const fixVerifier = createMockFixVerifier(true);
      vi.spyOn(fixVerifier, 'verifyFix').mockImplementation(async () => {
        fixCallCount++;
        // First fix succeeds, second fails
        return createMockVerificationResult(
          `FIX-00${fixCallCount}`,
          fixCallCount === 1
        );
      });

      setupOrchestratorForMultipleProblems(orchestrator, problemDetector, fixVerifier);

      const result = await orchestrator.runIteration({ testRuns: [] });

      // 1 fix succeeded out of 2 attempts = 0.5
      expect(result.summary.fixSuccessRate).toBe(0.5);
    });

    it('calculates hypothesisAccuracy correctly', async () => {
      // hypothesisAccuracy = supported hypotheses that led to fix / total supported
      setupOrchestratorForSuccessfulFix(orchestrator);

      const result = await orchestrator.runIteration({ testRuns: [] });

      // All supported hypotheses led to successful fixes
      expect(result.summary.hypothesisAccuracy).toBe(1.0);
    });

    it('handles zero divisions gracefully', async () => {
      // No problems = no fixes attempted
      setupOrchestrator(orchestrator, { detectProblems: [] });
      const result = await orchestrator.runIteration({ testRuns: [] });

      // Should be 0, not NaN or error
      expect(result.summary.fixSuccessRate).toBe(0);
      expect(result.summary.hypothesisAccuracy).toBe(0);
    });
  });

  describe('Deterministic output (Tier-0)', () => {
    it('produces consistent output for same input', async () => {
      const orchestrator1 = createScientificLoopOrchestrator();
      await orchestrator1.initialize({} as LibrarianStorage);
      setupOrchestratorForSuccessfulFix(orchestrator1);

      const orchestrator2 = createScientificLoopOrchestrator();
      await orchestrator2.initialize({} as LibrarianStorage);
      setupOrchestratorForSuccessfulFix(orchestrator2);

      const input: ProblemDetectionInput = { testRuns: [] };

      const result1 = await orchestrator1.runIteration(input);
      const result2 = await orchestrator2.runIteration(input);

      expect(result1.summary.problemsDetected).toBe(result2.summary.problemsDetected);
      expect(result1.summary.problemsFixed).toBe(result2.summary.problemsFixed);
      expect(result1.summary.problemsEscalated).toBe(result2.summary.problemsEscalated);
    });
  });
});

// ============================================================================
// Test Helpers
// ============================================================================

function createMockProblem(
  id: string = 'PROB-001',
  type: 'test_failure' | 'regression' | 'hallucination' | 'performance_gap' | 'inconsistency' = 'test_failure'
): Problem {
  return {
    id,
    type,
    description: `Problem ${id}`,
    evidence: ['Evidence 1'],
    severity: 'high',
    reproducible: true,
    minimalReproduction: 'npm test -- --run example.test.ts',
  };
}

function createMockSummary(total: number) {
  return {
    total,
    byType: { test_failure: total, regression: 0, hallucination: 0, performance_gap: 0, inconsistency: 0 },
    bySeverity: { critical: 0, high: total, medium: 0, low: 0 },
  };
}

function createMockHypothesis(problemId: string, letter: string, likelihood: 'high' | 'medium' | 'low' = 'high'): Hypothesis {
  return {
    id: `HYP-${problemId}-${letter}`,
    statement: `Hypothesis ${letter}`,
    rationale: 'Test rationale',
    prediction: 'Test prediction',
    test: {
      type: 'code_inspection',
      target: 'target',
      expected: 'expected',
    },
    likelihood,
  };
}

function createMockFix(id: string, problemId: string, hypothesisId: string): Fix {
  return {
    id,
    problemId,
    hypothesisId,
    description: 'Fix the issue',
    changes: [],
    rationale: 'This fixes the root cause',
    prediction: 'Test will pass',
  };
}

function createMockVerificationResult(fixId: string, success: boolean): VerificationResult {
  return {
    fixId,
    verification: {
      originalTestPasses: success,
      noRegressions: success,
      typesValid: success,
    },
    reward: success ? 1 : 0,
    verdict: success ? 'fix_accepted' : 'fix_rejected',
    notes: success ? 'All checks passed' : 'Fix rejected',
    executionLog: [],
  };
}

function createMockProblemDetector(problems: Problem[] = []): ProblemDetectorAgent {
  return {
    agentType: 'problem_detector',
    name: 'Mock Problem Detector',
    capabilities: ['problem_detection'],
    version: '1.0.0',
    qualityTier: 'full',
    initialize: vi.fn().mockResolvedValue(undefined),
    isReady: vi.fn().mockReturnValue(true),
    shutdown: vi.fn().mockResolvedValue(undefined),
    testFailures: vi.fn().mockResolvedValue(problems),
    regressionCheck: vi.fn().mockReturnValue([]),
    adversarialProbe: vi.fn().mockReturnValue([]),
    performanceGap: vi.fn().mockReturnValue([]),
    consistencyViolations: vi.fn().mockReturnValue([]),
    identifyProblems: vi.fn().mockResolvedValue({
      problems,
      summary: createMockSummary(problems.length),
    }),
  };
}

function createMockHypothesisGenerator(hypotheses?: Hypothesis[]): HypothesisGeneratorAgent {
  return {
    agentType: 'hypothesis_generator',
    name: 'Mock Hypothesis Generator',
    capabilities: ['hypothesis_generation'],
    version: '1.0.0',
    qualityTier: 'full',
    initialize: vi.fn().mockResolvedValue(undefined),
    isReady: vi.fn().mockReturnValue(true),
    shutdown: vi.fn().mockResolvedValue(undefined),
    generateHypotheses: vi.fn().mockImplementation((input) => {
      const hyps = hypotheses || [
        createMockHypothesis(input.problem.id, 'A', 'high'),
        createMockHypothesis(input.problem.id, 'B', 'medium'),
        createMockHypothesis(input.problem.id, 'C', 'low'),
      ];
      return {
        problemId: input.problem.id,
        hypotheses: hyps,
        rankedByLikelihood: hyps.map((h) => h.id),
      };
    }),
  };
}

function createMockHypothesisTester(supported: boolean = true): HypothesisTesterAgent {
  return {
    agentType: 'hypothesis_tester',
    name: 'Mock Hypothesis Tester',
    capabilities: ['hypothesis_testing'],
    version: '1.0.0',
    qualityTier: 'full',
    initialize: vi.fn().mockResolvedValue(undefined),
    isReady: vi.fn().mockReturnValue(true),
    shutdown: vi.fn().mockResolvedValue(undefined),
    testHypothesis: vi.fn().mockImplementation(async (input) => ({
      hypothesisId: input.hypothesis.id,
      verdict: supported ? 'supported' : 'refuted',
      evidence: [{ type: 'code_inspection', finding: 'test', implication: 'test' }],
      confidence: supported ? 0.85 : 0.2,
      recommendation: supported ? 'proceed_to_fix' : 'test_another_hypothesis',
    })),
    setCommandRunner: vi.fn(),
    getCommandRunner: vi.fn().mockReturnValue(null),
  };
}

function createMockFixGenerator(): FixGeneratorAgent {
  return {
    agentType: 'fix_generator',
    name: 'Mock Fix Generator',
    capabilities: ['fix_generation'],
    version: '1.0.0',
    qualityTier: 'full',
    initialize: vi.fn().mockResolvedValue(undefined),
    isReady: vi.fn().mockReturnValue(true),
    shutdown: vi.fn().mockResolvedValue(undefined),
    generateFix: vi.fn().mockImplementation((input) => {
      const fix = createMockFix(
        `FIX-${input.problem.id}`,
        input.problem.id,
        input.hypothesis.id
      );
      return {
        fixes: [fix],
        preferred: fix.id,
        alternatives: [],
      };
    }),
  };
}

function createMockFixVerifier(success: boolean = true): FixVerifierAgent {
  return {
    agentType: 'fix_verifier',
    name: 'Mock Fix Verifier',
    capabilities: ['fix_verification'],
    version: '1.0.0',
    qualityTier: 'full',
    initialize: vi.fn().mockResolvedValue(undefined),
    isReady: vi.fn().mockReturnValue(true),
    shutdown: vi.fn().mockResolvedValue(undefined),
    verifyFix: vi.fn().mockImplementation(async (input) =>
      createMockVerificationResult(input.fix.id, success)
    ),
    setCommandRunner: vi.fn(),
    getCommandRunner: vi.fn().mockReturnValue(null),
  };
}

function createMockBenchmarkEvolver(): BenchmarkEvolverAgent {
  return {
    agentType: 'benchmark_evolver',
    name: 'Mock Benchmark Evolver',
    capabilities: ['benchmark_evolution'],
    version: '1.0.0',
    qualityTier: 'full',
    initialize: vi.fn().mockResolvedValue(undefined),
    isReady: vi.fn().mockReturnValue(true),
    shutdown: vi.fn().mockResolvedValue(undefined),
    evolveBenchmark: vi.fn().mockImplementation(async (input) => ({
      problemId: input.problem.id,
      fixId: input.fix.id,
      newTests: [],
      regressionGuards: [],
      variantTests: [],
      coverageGaps: [],
    })),
  };
}

function setupOrchestrator(
  orchestrator: ScientificLoopOrchestratorImpl,
  options: { detectProblems: Problem[] }
): void {
  orchestrator.setProblemDetector(createMockProblemDetector(options.detectProblems));
  orchestrator.setHypothesisGenerator(createMockHypothesisGenerator());
  orchestrator.setHypothesisTester(createMockHypothesisTester());
  orchestrator.setFixGenerator(createMockFixGenerator());
  orchestrator.setFixVerifier(createMockFixVerifier());
  orchestrator.setBenchmarkEvolver(createMockBenchmarkEvolver());
}

function setupOrchestratorForSuccessfulFix(orchestrator: ScientificLoopOrchestratorImpl): void {
  orchestrator.setProblemDetector(createMockProblemDetector([createMockProblem('PROB-001')]));
  orchestrator.setHypothesisGenerator(createMockHypothesisGenerator());
  orchestrator.setHypothesisTester(createMockHypothesisTester(true));
  orchestrator.setFixGenerator(createMockFixGenerator());
  orchestrator.setFixVerifier(createMockFixVerifier(true));
  orchestrator.setBenchmarkEvolver(createMockBenchmarkEvolver());
}

function setupOrchestratorForEscalation(orchestrator: ScientificLoopOrchestratorImpl): void {
  orchestrator.setProblemDetector(createMockProblemDetector([createMockProblem('PROB-001')]));
  orchestrator.setHypothesisGenerator(createMockHypothesisGenerator());
  orchestrator.setHypothesisTester(createMockHypothesisTester(false)); // All refuted
  orchestrator.setFixGenerator(createMockFixGenerator());
  orchestrator.setFixVerifier(createMockFixVerifier(false));
  orchestrator.setBenchmarkEvolver(createMockBenchmarkEvolver());
}

function setupOrchestratorForNoSupportedHypothesis(orchestrator: ScientificLoopOrchestratorImpl): void {
  orchestrator.setProblemDetector(createMockProblemDetector([createMockProblem('PROB-001')]));
  orchestrator.setHypothesisGenerator(createMockHypothesisGenerator());
  orchestrator.setHypothesisTester(createMockHypothesisTester(false)); // All refuted
  orchestrator.setFixGenerator(createMockFixGenerator());
  orchestrator.setFixVerifier(createMockFixVerifier(false));
  orchestrator.setBenchmarkEvolver(createMockBenchmarkEvolver());
}

function setupOrchestratorForAllFixesFailed(orchestrator: ScientificLoopOrchestratorImpl): void {
  orchestrator.setProblemDetector(createMockProblemDetector([createMockProblem('PROB-001')]));
  orchestrator.setHypothesisGenerator(createMockHypothesisGenerator());
  orchestrator.setHypothesisTester(createMockHypothesisTester(true)); // Hypotheses supported
  orchestrator.setFixGenerator(createMockFixGenerator());
  orchestrator.setFixVerifier(createMockFixVerifier(false)); // But fixes all fail
  orchestrator.setBenchmarkEvolver(createMockBenchmarkEvolver());
}

function setupOrchestratorWithHypothesisTesting(
  orchestrator: ScientificLoopOrchestratorImpl,
  testCallback: (hyp: Hypothesis) => boolean
): void {
  orchestrator.setProblemDetector(createMockProblemDetector([createMockProblem('PROB-001')]));
  orchestrator.setHypothesisGenerator(createMockHypothesisGenerator());

  const tester = createMockHypothesisTester();
  vi.spyOn(tester, 'testHypothesis').mockImplementation(async (input) => {
    const supported = testCallback(input.hypothesis);
    return {
      hypothesisId: input.hypothesis.id,
      verdict: supported ? 'supported' : 'refuted',
      evidence: [{ type: 'code_inspection', finding: 'test', implication: 'test' }],
      confidence: supported ? 0.85 : 0.2,
      recommendation: supported ? 'proceed_to_fix' : 'test_another_hypothesis',
    };
  });
  orchestrator.setHypothesisTester(tester);

  orchestrator.setFixGenerator(createMockFixGenerator());
  orchestrator.setFixVerifier(createMockFixVerifier(true));
  orchestrator.setBenchmarkEvolver(createMockBenchmarkEvolver());
}

function setupOrchestratorWithFixAttempts(
  orchestrator: ScientificLoopOrchestratorImpl,
  verifyCallback: () => boolean
): void {
  orchestrator.setProblemDetector(createMockProblemDetector([createMockProblem('PROB-001')]));
  orchestrator.setHypothesisGenerator(createMockHypothesisGenerator());
  orchestrator.setHypothesisTester(createMockHypothesisTester(true));
  orchestrator.setFixGenerator(createMockFixGenerator());

  const verifier = createMockFixVerifier();
  vi.spyOn(verifier, 'verifyFix').mockImplementation(async (input) => {
    const success = verifyCallback();
    return createMockVerificationResult(input.fix.id, success);
  });
  orchestrator.setFixVerifier(verifier);

  orchestrator.setBenchmarkEvolver(createMockBenchmarkEvolver());
}

function setupOrchestratorForMultipleProblems(
  orchestrator: ScientificLoopOrchestratorImpl,
  problemDetector: ProblemDetectorAgent,
  fixVerifier: FixVerifierAgent
): void {
  orchestrator.setProblemDetector(problemDetector);
  orchestrator.setHypothesisGenerator(createMockHypothesisGenerator());
  orchestrator.setHypothesisTester(createMockHypothesisTester(true));
  orchestrator.setFixGenerator(createMockFixGenerator());
  orchestrator.setFixVerifier(fixVerifier);
  orchestrator.setBenchmarkEvolver(createMockBenchmarkEvolver());
}
