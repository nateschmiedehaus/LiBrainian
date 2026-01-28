/**
 * @fileoverview Scientific Loop Orchestrator
 *
 * Coordinates all agents in the Scientific Self-Improvement Loop (Phase 10).
 * Based on AutoSD, RLVR, SWE-agent research.
 *
 * Loop Logic:
 * 1. SPAWN Problem Detector -> collect problems
 * 2. FOR each problem:
 *    a. SPAWN Hypothesis Generator -> get hypotheses
 *    b. FOR each hypothesis (ranked by likelihood):
 *       i. SPAWN Hypothesis Tester -> test it
 *       ii. IF supported: break, proceed to fix
 *       iii. IF refuted: try next hypothesis
 *    c. SPAWN Fix Generator -> create fix
 *    d. SPAWN Fix Verifier -> verify with RLVR-style rewards
 *    e. IF reward = 1: accept fix
 *       IF reward = 0: reject, try next hypothesis or escalate
 * 3. SPAWN Benchmark Evolver -> prevent recurrence
 * 4. UPDATE tracking state
 * 5. REPEAT until no problems remain
 *
 * Uses heuristic-based approach (no LLM) for Tier-0 compatibility.
 */

import type {
  ScientificLoopOrchestrator,
  ScientificLoopState,
  ScientificLoopOrchestratorConfig,
  LoopResult,
  LoopSummary,
  Escalation,
  EscalationReason,
  EscalationRecommendation,
  ProblemDetectorAgent,
  HypothesisGeneratorAgent,
  HypothesisTesterAgent,
  FixGeneratorAgent,
  FixVerifierAgent,
  BenchmarkEvolverAgent,
  ProblemDetectionInput,
  Problem,
  Hypothesis,
  HypothesisTestResult,
  Fix,
  VerificationResult,
  BenchmarkEvolution,
  AgentCapability,
} from './types.js';
import type { LibrarianStorage } from '../storage/types.js';

/**
 * Default configuration for the Scientific Loop Orchestrator.
 */
const DEFAULT_CONFIG: Required<ScientificLoopOrchestratorConfig> = {
  maxIterations: 10,
  maxHypothesesPerProblem: 5,
  maxFixAttemptsPerProblem: 3,
};

/**
 * Creates an initial empty state for the Scientific Loop.
 */
function createInitialState(): ScientificLoopState {
  return {
    iteration: 0,
    problemsDetected: [],
    problemsFixed: [],
    problemsEscalated: [],
    hypothesesTested: [],
    fixesAttempted: [],
    benchmarkEvolutions: [],
  };
}

/**
 * Implementation of the Scientific Loop Orchestrator.
 */
export class ScientificLoopOrchestratorImpl implements ScientificLoopOrchestrator {
  readonly agentType = 'scientific_loop_orchestrator';
  readonly name = 'Scientific Loop Orchestrator';
  readonly capabilities: readonly AgentCapability[] = [
    'problem_detection',
    'hypothesis_generation',
    'hypothesis_testing',
    'fix_generation',
    'fix_verification',
    'benchmark_evolution',
  ];
  readonly version = '1.0.0';
  readonly qualityTier = 'full' as const;

  private storage: LibrarianStorage | null = null;
  private config: Required<ScientificLoopOrchestratorConfig>;
  private state: ScientificLoopState;

  // Injected agents
  private problemDetector: ProblemDetectorAgent | null = null;
  private hypothesisGenerator: HypothesisGeneratorAgent | null = null;
  private hypothesisTester: HypothesisTesterAgent | null = null;
  private fixGenerator: FixGeneratorAgent | null = null;
  private fixVerifier: FixVerifierAgent | null = null;
  private benchmarkEvolver: BenchmarkEvolverAgent | null = null;

  constructor(config: ScientificLoopOrchestratorConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.state = createInitialState();
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

  // ============================================================================
  // Dependency Injection
  // ============================================================================

  setProblemDetector(agent: ProblemDetectorAgent): void {
    this.problemDetector = agent;
  }

  setHypothesisGenerator(agent: HypothesisGeneratorAgent): void {
    this.hypothesisGenerator = agent;
  }

  setHypothesisTester(agent: HypothesisTesterAgent): void {
    this.hypothesisTester = agent;
  }

  setFixGenerator(agent: FixGeneratorAgent): void {
    this.fixGenerator = agent;
  }

  setFixVerifier(agent: FixVerifierAgent): void {
    this.fixVerifier = agent;
  }

  setBenchmarkEvolver(agent: BenchmarkEvolverAgent): void {
    this.benchmarkEvolver = agent;
  }

  // ============================================================================
  // State Management
  // ============================================================================

  getState(): ScientificLoopState {
    return { ...this.state };
  }

  reset(): void {
    this.state = createInitialState();
  }

  // ============================================================================
  // Main Loop Methods
  // ============================================================================

  /**
   * Run a single iteration of the scientific loop.
   */
  async runIteration(input: ProblemDetectionInput): Promise<LoopResult> {
    // Increment iteration counter
    this.state.iteration++;

    const escalations: Escalation[] = [];
    const iterationHypothesesTested: HypothesisTestResult[] = [];
    const iterationFixesAttempted: VerificationResult[] = [];
    const iterationEvolutions: BenchmarkEvolution[] = [];
    const iterationProblemsFixed: string[] = [];
    const iterationProblemsEscalated: string[] = [];

    // Step 1: Detect problems
    const problems = await this.detectProblems(input);
    this.state.problemsDetected.push(...problems);

    // Step 2: Process each problem
    for (const problem of problems) {
      const result = await this.processProblem(
        problem,
        iterationHypothesesTested,
        iterationFixesAttempted,
        iterationEvolutions
      );

      if (result.fixed) {
        iterationProblemsFixed.push(problem.id);
      } else if (result.escalation) {
        escalations.push(result.escalation);
        iterationProblemsEscalated.push(problem.id);
      }
    }

    // Update state
    this.state.problemsFixed.push(...iterationProblemsFixed);
    this.state.problemsEscalated.push(...iterationProblemsEscalated);
    this.state.hypothesesTested.push(...iterationHypothesesTested);
    this.state.fixesAttempted.push(...iterationFixesAttempted);
    this.state.benchmarkEvolutions.push(...iterationEvolutions);

    // Calculate summary
    const summary = this.calculateSummary();

    return {
      state: this.getState(),
      escalations,
      summary,
    };
  }

  /**
   * Run the loop until no problems remain or max iterations reached.
   */
  async runUntilDone(input: ProblemDetectionInput): Promise<LoopResult> {
    const allEscalations: Escalation[] = [];
    let previousProblemCount = this.state.problemsDetected.length;

    while (this.state.iteration < this.config.maxIterations) {
      const result = await this.runIteration(input);
      allEscalations.push(...result.escalations);

      // Check how many new problems were detected this iteration
      const currentProblemCount = this.state.problemsDetected.length;
      const newProblemsThisIteration = currentProblemCount - previousProblemCount;
      previousProblemCount = currentProblemCount;

      // Stop if no new problems were detected this iteration
      if (newProblemsThisIteration === 0) {
        break;
      }
    }

    // Return final result
    return {
      state: this.getState(),
      escalations: allEscalations,
      summary: this.calculateSummary(),
    };
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Detect problems using the Problem Detector agent.
   */
  private async detectProblems(input: ProblemDetectionInput): Promise<Problem[]> {
    if (!this.problemDetector) {
      return [];
    }

    const report = await this.problemDetector.identifyProblems(input);
    return report.problems;
  }

  /**
   * Process a single problem through the scientific loop.
   */
  private async processProblem(
    problem: Problem,
    hypothesesTested: HypothesisTestResult[],
    fixesAttempted: VerificationResult[],
    evolutions: BenchmarkEvolution[]
  ): Promise<{ fixed: boolean; escalation?: Escalation }> {
    if (!this.hypothesisGenerator || !this.hypothesisTester || !this.fixGenerator || !this.fixVerifier) {
      return {
        fixed: false,
        escalation: this.createEscalation(problem, [], [], 'no_supported_hypothesis'),
      };
    }

    // Generate hypotheses
    const hypothesisReport = this.hypothesisGenerator.generateHypotheses({ problem });
    const rankedHypotheses = this.getRankedHypotheses(hypothesisReport);

    // Track hypotheses and fixes for this problem
    const problemHypothesesTested: Hypothesis[] = [];
    const problemFixesAttempted: Fix[] = [];
    let fixAttempts = 0;

    // Test hypotheses in order of likelihood
    const maxHypotheses = Math.min(rankedHypotheses.length, this.config.maxHypothesesPerProblem);

    for (let i = 0; i < maxHypotheses; i++) {
      const hypothesis = rankedHypotheses[i];
      problemHypothesesTested.push(hypothesis);

      // Test the hypothesis
      const testResult = await this.hypothesisTester.testHypothesis({
        hypothesis,
        problem,
      });
      hypothesesTested.push(testResult);

      // If hypothesis is supported, try to fix
      if (testResult.verdict === 'supported') {
        // Check if we've exceeded max fix attempts
        if (fixAttempts >= this.config.maxFixAttemptsPerProblem) {
          break;
        }

        // Generate and verify fix
        const fixResult = await this.attemptFix(
          problem,
          hypothesis,
          testResult,
          fixesAttempted,
          evolutions
        );

        if (fixResult.fix) {
          problemFixesAttempted.push(fixResult.fix);
        }
        fixAttempts++;

        if (fixResult.success) {
          return { fixed: true };
        }
      }
    }

    // Problem could not be fixed - escalate
    const reason = problemFixesAttempted.length > 0
      ? 'all_fixes_failed'
      : 'no_supported_hypothesis';

    return {
      fixed: false,
      escalation: this.createEscalation(problem, problemHypothesesTested, problemFixesAttempted, reason),
    };
  }

  /**
   * Get hypotheses in ranked order by likelihood.
   */
  private getRankedHypotheses(report: ReturnType<HypothesisGeneratorAgent['generateHypotheses']>): Hypothesis[] {
    const hypothesesById = new Map(report.hypotheses.map((h) => [h.id, h]));
    return report.rankedByLikelihood
      .map((id) => hypothesesById.get(id))
      .filter((h): h is Hypothesis => h !== undefined);
  }

  /**
   * Attempt to generate and verify a fix for a supported hypothesis.
   */
  private async attemptFix(
    problem: Problem,
    hypothesis: Hypothesis,
    testResult: HypothesisTestResult,
    fixesAttempted: VerificationResult[],
    evolutions: BenchmarkEvolution[]
  ): Promise<{ success: boolean; fix?: Fix }> {
    if (!this.fixGenerator || !this.fixVerifier) {
      return { success: false };
    }

    // Generate fix
    const fixReport = this.fixGenerator.generateFix({
      problem,
      hypothesis,
      testResult,
    });

    const preferredFix = fixReport.fixes.find((f) => f.id === fixReport.preferred) || fixReport.fixes[0];
    if (!preferredFix) {
      return { success: false };
    }

    // Verify fix
    const verificationResult = await this.fixVerifier.verifyFix({
      fix: preferredFix,
      problem,
    });
    fixesAttempted.push(verificationResult);

    // If fix accepted, evolve benchmark
    if (verificationResult.reward === 1 && this.benchmarkEvolver) {
      const evolution = await this.benchmarkEvolver.evolveBenchmark({
        problem,
        fix: preferredFix,
        verificationResult,
      });
      evolutions.push(evolution);
      return { success: true, fix: preferredFix };
    }

    return { success: false, fix: preferredFix };
  }

  /**
   * Create an escalation for a problem that could not be fixed.
   */
  private createEscalation(
    problem: Problem,
    hypothesesTested: Hypothesis[],
    fixesAttempted: Fix[],
    reason: EscalationReason
  ): Escalation {
    // Determine recommendation based on reason and severity
    const recommendation = this.determineRecommendation(problem, reason);

    return {
      problemId: problem.id,
      hypothesesTested,
      fixesAttempted,
      reason,
      recommendation,
    };
  }

  /**
   * Determine the recommendation for an escalated problem.
   */
  private determineRecommendation(
    problem: Problem,
    reason: EscalationReason
  ): EscalationRecommendation {
    // Critical problems always need human review
    if (problem.severity === 'critical') {
      return 'human_review';
    }

    // Low severity problems can be deferred
    if (problem.severity === 'low') {
      return 'defer';
    }

    // Based on reason
    switch (reason) {
      case 'regression_unavoidable':
        return 'wontfix';
      case 'all_fixes_failed':
        return 'human_review';
      case 'no_supported_hypothesis':
      default:
        return 'defer';
    }
  }

  /**
   * Calculate summary metrics for the current state.
   */
  private calculateSummary(): LoopSummary {
    const problemsDetected = this.state.problemsDetected.length;
    const problemsFixed = this.state.problemsFixed.length;
    const problemsEscalated = this.state.problemsEscalated.length;

    // Fix success rate = fixes accepted / fixes attempted
    const fixesAttempted = this.state.fixesAttempted.length;
    const fixesAccepted = this.state.fixesAttempted.filter((f) => f.reward === 1).length;
    const fixSuccessRate = fixesAttempted > 0 ? fixesAccepted / fixesAttempted : 0;

    // Hypothesis accuracy = supported hypotheses that led to successful fix / total supported
    const supportedHypotheses = this.state.hypothesesTested.filter(
      (h) => h.verdict === 'supported'
    );
    const hypothesesLeadingToFix = supportedHypotheses.filter((h) => {
      // A hypothesis led to a fix if there's an accepted fix for the same problem
      return this.state.fixesAttempted.some(
        (f) => f.reward === 1 && f.fixId.includes(h.hypothesisId.split('-')[1])
      );
    });
    const hypothesisAccuracy = supportedHypotheses.length > 0
      ? hypothesesLeadingToFix.length / supportedHypotheses.length
      : 0;

    return {
      problemsDetected,
      problemsFixed,
      problemsEscalated,
      fixSuccessRate,
      hypothesisAccuracy,
    };
  }
}

/**
 * Factory function to create a ScientificLoopOrchestrator instance.
 */
export function createScientificLoopOrchestrator(
  config: ScientificLoopOrchestratorConfig = {}
): ScientificLoopOrchestratorImpl {
  return new ScientificLoopOrchestratorImpl(config);
}
