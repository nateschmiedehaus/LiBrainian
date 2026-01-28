/**
 * @fileoverview Agent interfaces for Librarian system
 *
 * Designed for extension: MVP ships with IndexLibrarian only,
 * future versions add PatternLibrarian, DecisionLibrarian, etc.
 */

import type { LibrarianStorage } from '../storage/types.js';
import type { LibrarianVersion, IndexingTask, IndexingResult } from '../types.js';

// ============================================================================
// AGENT CAPABILITY ENUM
// ============================================================================

/**
 * Capabilities that librarian agents can have.
 * Used for discovery and routing.
 */
export type AgentCapability =
  | 'indexing'           // Can index files and create embeddings
  | 'pattern_detection'  // Can detect architectural patterns (Phase 3+)
  | 'decision_tracking'  // Can track decisions and outcomes (Phase 3+)
  | 'summarization'      // Can create hierarchical summaries (Phase 3+)
  | 'dependency_analysis' // Can analyze dependencies (Phase 2+)
  | 'problem_detection'  // Can detect problems in scientific loop (Phase 10)
  | 'hypothesis_generation' // Can generate hypotheses for problems (Phase 10)
  | 'hypothesis_testing' // Can test hypotheses for problems (Phase 10)
  | 'fix_generation'     // Can generate fixes for supported hypotheses (Phase 10)
  | 'fix_verification'   // Can verify fixes using RLVR-style binary verification (Phase 10)
  | 'benchmark_evolution'; // Can evolve benchmarks after verified fixes (Phase 10)

// ============================================================================
// AGENT INTERFACE
// ============================================================================

/**
 * Base interface for all librarian agents.
 * Agents are specialized workers that perform specific knowledge tasks.
 */
export interface LibrarianAgent {
  /** Unique identifier for this agent type */
  readonly agentType: string;

  /** Human-readable name */
  readonly name: string;

  /** Capabilities this agent provides */
  readonly capabilities: readonly AgentCapability[];

  /** Version of this agent implementation */
  readonly version: string;

  /** Quality tier this agent outputs */
  readonly qualityTier: 'mvp' | 'enhanced' | 'full';

  /**
   * Initialize the agent with storage.
   * Called once before any work methods.
   */
  initialize(storage: LibrarianStorage): Promise<void>;

  /**
   * Check if agent is ready to work.
   */
  isReady(): boolean;

  /**
   * Shutdown the agent gracefully.
   */
  shutdown(): Promise<void>;
}

// ============================================================================
// INDEXING AGENT INTERFACE
// ============================================================================

/**
 * Interface for agents that can index code.
 */
export interface IndexingAgent extends LibrarianAgent {
  /**
   * Process an indexing task.
   * Should emit progress events during execution.
   */
  processTask(task: IndexingTask): Promise<IndexingResult>;

  /**
   * Index a single file.
   * Lower-level API for incremental updates.
   */
  indexFile(filePath: string): Promise<FileIndexResult>;

  /**
   * Remove all indexed data for a file.
   */
  removeFile(filePath: string): Promise<void>;

  /**
   * Get indexing statistics.
   */
  getStats(): IndexingStats;
}

// ============================================================================
// PROBLEM DETECTOR AGENT INTERFACE (Phase 10)
// ============================================================================

export type ProblemType =
  | 'test_failure'
  | 'regression'
  | 'hallucination'
  | 'performance_gap'
  | 'inconsistency';

export type ProblemSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface Problem {
  id: string;
  type: ProblemType;
  description: string;
  evidence: string[];
  severity: ProblemSeverity;
  reproducible: boolean;
  minimalReproduction?: string;
}

export interface CommandResult {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface TestFailureCheck {
  command: string;
  cwd?: string;
  timeoutMs?: number;
  severity?: ProblemSeverity;
  result?: CommandResult;
}

export interface RegressionCheck {
  query: string;
  expected: string;
  actual: string;
  evidence?: string[];
  severity?: ProblemSeverity;
}

export interface AdversarialProbe {
  prompt: string;
  expected: string;
  actual: string;
  evidence?: string[];
  severity?: ProblemSeverity;
}

export interface PerformanceExperiment {
  metric: string;
  controlScore: number;
  treatmentScore: number;
  minImprovement?: number;
  evidence?: string[];
  severity?: ProblemSeverity;
}

export interface ConsistencyCheck {
  question: string;
  variants: string[];
  answers: string[];
  evidence?: string[];
  severity?: ProblemSeverity;
}

export interface ProblemDetectionInput {
  testRuns?: TestFailureCheck[];
  regressions?: RegressionCheck[];
  adversarial?: AdversarialProbe[];
  performance?: PerformanceExperiment[];
  consistency?: ConsistencyCheck[];
}

export interface ProblemDetectionSummary {
  total: number;
  byType: Record<ProblemType, number>;
  bySeverity: Record<ProblemSeverity, number>;
}

export interface ProblemDetectionReport {
  problems: Problem[];
  summary: ProblemDetectionSummary;
}

export type CommandRunner = (check: TestFailureCheck) => Promise<CommandResult>;

export interface ProblemDetectorAgent extends LibrarianAgent {
  testFailures(tests: TestFailureCheck[]): Promise<Problem[]>;
  regressionCheck(regressions: RegressionCheck[]): Problem[];
  adversarialProbe(probes: AdversarialProbe[]): Problem[];
  performanceGap(experiments: PerformanceExperiment[]): Problem[];
  consistencyViolations(sets: ConsistencyCheck[]): Problem[];
  identifyProblems(input: ProblemDetectionInput): Promise<ProblemDetectionReport>;
}

// ============================================================================
// HYPOTHESIS GENERATOR AGENT INTERFACE (Phase 10)
// ============================================================================

export type HypothesisTestType =
  | 'code_inspection'
  | 'test_run'
  | 'log_analysis'
  | 'behavioral';

export type HypothesisLikelihood = 'high' | 'medium' | 'low';

export interface HypothesisTest {
  type: HypothesisTestType;
  target: string;
  expected: string;
}

export interface Hypothesis {
  id: string;                    // e.g., "HYP-001-A"
  statement: string;             // Clear statement of the hypothesis
  rationale: string;             // Why this could cause the problem
  prediction: string;            // What we'd observe if true
  test: HypothesisTest;          // Minimal test to verify/falsify
  likelihood: HypothesisLikelihood;  // Ranking
}

export interface HypothesisGenerationInput {
  problem: Problem;              // From ProblemDetector
  codebaseContext?: string;      // Optional additional context
}

export interface HypothesisGenerationReport {
  problemId: string;
  hypotheses: Hypothesis[];
  rankedByLikelihood: string[];  // Hypothesis IDs in order
}

export interface HypothesisGeneratorAgent extends LibrarianAgent {
  /**
   * Generate hypotheses for a given problem.
   * Uses heuristic-based approach (no LLM) for Tier-0 compatibility.
   */
  generateHypotheses(input: HypothesisGenerationInput): HypothesisGenerationReport;
}

// ============================================================================
// HYPOTHESIS TESTER AGENT INTERFACE (Phase 10)
// ============================================================================

export type HypothesisTestVerdict = 'supported' | 'refuted' | 'inconclusive';

export type HypothesisTestRecommendation =
  | 'proceed_to_fix'
  | 'test_another_hypothesis'
  | 'need_more_evidence';

export type TestEvidenceType =
  | 'code_inspection'
  | 'test_run'
  | 'log_analysis'
  | 'behavioral';

export interface TestEvidence {
  type: TestEvidenceType;
  finding: string;
  implication: string;
}

export interface HypothesisTestResult {
  hypothesisId: string;
  verdict: HypothesisTestVerdict;
  evidence: TestEvidence[];
  confidence: number;  // 0.0 to 1.0
  recommendation: HypothesisTestRecommendation;
}

export interface HypothesisTesterInput {
  hypothesis: Hypothesis;        // From HypothesisGenerator
  problem: Problem;              // Original problem
  codebaseContext?: string;      // Optional additional context
}

export interface HypothesisTesterAgent extends LibrarianAgent {
  /**
   * Test a hypothesis to determine if it's supported, refuted, or inconclusive.
   * Uses heuristic-based approach (no LLM) for Tier-0 compatibility.
   */
  testHypothesis(input: HypothesisTesterInput): Promise<HypothesisTestResult>;

  /**
   * Set the command runner for executing test commands.
   * When set, tests with type 'test_run' will execute the command.
   */
  setCommandRunner(runner: CommandRunner): void;

  /**
   * Get the current command runner (if any).
   */
  getCommandRunner(): CommandRunner | null;
}

// ============================================================================
// FIX GENERATOR AGENT INTERFACE (Phase 10)
// ============================================================================

/**
 * Type of file change in a fix.
 */
export type FileChangeType = 'modify' | 'create' | 'delete';

/**
 * Represents a single file modification in a fix.
 */
export interface FileChange {
  filePath: string;
  changeType: FileChangeType;
  before?: string;               // For modify/delete
  after?: string;                // For modify/create
  description: string;           // What this change does
}

/**
 * Represents a generated fix for a problem.
 */
export interface Fix {
  id: string;                    // e.g., "FIX-001"
  problemId: string;             // Original problem ID
  hypothesisId: string;          // Supported hypothesis ID
  description: string;           // What the fix does
  changes: FileChange[];         // Proposed file modifications
  rationale: string;             // Why this fixes the root cause
  prediction: string;            // What should happen after the fix
}

/**
 * Input for the Fix Generator agent.
 */
export interface FixGeneratorInput {
  problem: Problem;              // Original problem
  hypothesis: Hypothesis;        // Supported hypothesis
  testResult: HypothesisTestResult;  // Evidence from testing
  codebaseContext?: string;      // Optional additional context
}

/**
 * Report from the Fix Generator agent.
 */
export interface FixGeneratorReport {
  fixes: Fix[];                  // One or more proposed fixes
  preferred: string;             // ID of recommended fix
  alternatives: string[];        // IDs of alternative fixes
}

/**
 * Interface for agents that generate fixes for supported hypotheses.
 */
export interface FixGeneratorAgent extends LibrarianAgent {
  /**
   * Generate fixes for a supported hypothesis.
   * Uses heuristic-based approach (no LLM) for Tier-0 compatibility.
   */
  generateFix(input: FixGeneratorInput): FixGeneratorReport;
}

// ============================================================================
// FIX VERIFIER AGENT INTERFACE (Phase 10)
// ============================================================================

/**
 * Entry in the execution log capturing command execution details.
 */
export interface ExecutionEntry {
  command: string;
  exitCode: number;
  stdout?: string;
  stderr?: string;
  durationMs: number;
}

/**
 * Result of RLVR-style fix verification.
 * Uses binary rewards - no partial credit.
 */
export interface VerificationResult {
  fixId: string;
  verification: {
    originalTestPasses: boolean;   // Did the originally failing test pass?
    noRegressions: boolean;        // Do all other tests still pass?
    typesValid: boolean;           // Does TypeScript compile?
  };
  reward: 0 | 1;                   // 1 ONLY if ALL above are true
  verdict: 'fix_accepted' | 'fix_rejected';
  notes: string;                   // Explanation
  executionLog: ExecutionEntry[];  // Log of what was executed
}

/**
 * Input for the Fix Verifier agent.
 */
export interface FixVerifierInput {
  fix: Fix;                        // From FixGenerator
  problem: Problem;                // Original problem
  originalTestCommand?: string;    // Command to run the original failing test
}

/**
 * Interface for agents that verify fixes using RLVR-style binary verification.
 */
export interface FixVerifierAgent extends LibrarianAgent {
  agentType: 'fix_verifier';
  capabilities: readonly ['fix_verification'];

  /**
   * Verify a fix using RLVR-style binary verification.
   * Returns reward=1 ONLY if: originalTestPasses AND noRegressions AND typesValid
   */
  verifyFix(input: FixVerifierInput): Promise<VerificationResult>;

  /**
   * Set the command runner for executing verification commands.
   */
  setCommandRunner(runner: CommandRunner): void;

  /**
   * Get the current command runner (if any).
   */
  getCommandRunner(): CommandRunner | null;
}

export interface FileIndexResult {
  filePath: string;
  functionsFound: number;
  functionsIndexed: number;
  moduleIndexed: boolean;
  contextPacksCreated: number;
  durationMs: number;
  errors: string[];
}

export interface IndexingStats {
  totalFilesIndexed: number;
  totalFunctionsIndexed: number;
  totalModulesIndexed: number;
  totalContextPacksCreated: number;
  averageFileProcessingMs: number;
  lastIndexingTime: Date | null;
}

// ============================================================================
// BENCHMARK EVOLVER AGENT INTERFACE (Phase 10)
// ============================================================================

/**
 * Category of test case generated by benchmark evolution.
 */
export type TestCaseCategory = 'prevention' | 'regression_guard' | 'variant';

/**
 * A test case generated by benchmark evolution.
 */
export interface TestCase {
  name: string;
  file: string;
  code: string;
  category: TestCaseCategory;
}

/**
 * A coverage gap identified during benchmark evolution.
 */
export interface CoverageGap {
  description: string;
  affectedArea: string;
  suggestedTests: string[];
}

/**
 * Result of benchmark evolution for a fixed problem.
 */
export interface BenchmarkEvolution {
  problemId: string;
  fixId: string;
  newTests: TestCase[];              // Prevention tests that would have caught this bug
  regressionGuards: TestCase[];      // Assertions that fail if this bug recurs
  variantTests: TestCase[];          // Variations to probe related edge cases
  coverageGaps: CoverageGap[];       // What gap allowed this bug to exist
}

/**
 * Input for the Benchmark Evolver agent.
 */
export interface BenchmarkEvolverInput {
  problem: Problem;                  // Problem that was fixed
  fix: Fix;                          // Fix that resolved it
  verificationResult: VerificationResult;  // Verification results
}

/**
 * Interface for agents that evolve benchmarks after verified fixes.
 * Uses heuristic-based approach (no LLM) for Tier-0 compatibility.
 */
export interface BenchmarkEvolverAgent extends LibrarianAgent {
  agentType: 'benchmark_evolver';
  capabilities: readonly ['benchmark_evolution'];

  /**
   * Evolve the benchmark to prevent similar issues from recurring.
   * Generates prevention tests, regression guards, variant tests, and identifies coverage gaps.
   */
  evolveBenchmark(input: BenchmarkEvolverInput): Promise<BenchmarkEvolution>;
}

// ============================================================================
// SCIENTIFIC LOOP ORCHESTRATOR INTERFACE (Phase 10)
// ============================================================================

/**
 * State of the Scientific Loop across iterations.
 */
export interface ScientificLoopState {
  iteration: number;
  problemsDetected: Problem[];
  problemsFixed: string[];           // Problem IDs
  problemsEscalated: string[];       // Problem IDs
  hypothesesTested: HypothesisTestResult[];
  fixesAttempted: VerificationResult[];
  benchmarkEvolutions: BenchmarkEvolution[];
}

/**
 * Reason for escalating a problem.
 */
export type EscalationReason =
  | 'no_supported_hypothesis'
  | 'all_fixes_failed'
  | 'regression_unavoidable';

/**
 * Recommendation for how to handle an escalated problem.
 */
export type EscalationRecommendation = 'human_review' | 'defer' | 'wontfix';

/**
 * An escalated problem that could not be fixed automatically.
 */
export interface Escalation {
  problemId: string;
  hypothesesTested: Hypothesis[];
  fixesAttempted: Fix[];
  reason: EscalationReason;
  recommendation: EscalationRecommendation;
}

/**
 * Summary metrics for a loop run.
 */
export interface LoopSummary {
  problemsDetected: number;
  problemsFixed: number;
  problemsEscalated: number;
  fixSuccessRate: number;            // Fixes accepted / Fixes attempted
  hypothesisAccuracy: number;        // Supported hypotheses that led to fix
}

/**
 * Result of running the Scientific Loop.
 */
export interface LoopResult {
  state: ScientificLoopState;
  escalations: Escalation[];
  summary: LoopSummary;
}

/**
 * Configuration for the Scientific Loop Orchestrator.
 */
export interface ScientificLoopOrchestratorConfig {
  maxIterations?: number;            // Max loop iterations (default: 10)
  maxHypothesesPerProblem?: number;  // Max hypotheses to test (default: 5)
  maxFixAttemptsPerProblem?: number; // Max fix attempts (default: 3)
}

/**
 * Interface for the Scientific Loop Orchestrator.
 * Coordinates all agents in the scientific debugging loop.
 */
export interface ScientificLoopOrchestrator extends LibrarianAgent {
  /**
   * Run a single iteration of the loop.
   */
  runIteration(input: ProblemDetectionInput): Promise<LoopResult>;

  /**
   * Run loop until no problems or max iterations reached.
   */
  runUntilDone(input: ProblemDetectionInput): Promise<LoopResult>;

  /**
   * Get current state.
   */
  getState(): ScientificLoopState;

  /**
   * Reset state for new run.
   */
  reset(): void;

  /**
   * Set agents (for dependency injection).
   */
  setProblemDetector(agent: ProblemDetectorAgent): void;
  setHypothesisGenerator(agent: HypothesisGeneratorAgent): void;
  setHypothesisTester(agent: HypothesisTesterAgent): void;
  setFixGenerator(agent: FixGeneratorAgent): void;
  setFixVerifier(agent: FixVerifierAgent): void;
  setBenchmarkEvolver(agent: BenchmarkEvolverAgent): void;
}

// ============================================================================
// PATTERN AGENT INTERFACE (Phase 3+)
// ============================================================================

/**
 * Interface for agents that detect patterns.
 * Not implemented in MVP.
 */
export interface PatternAgent extends LibrarianAgent {
  detectPatterns(files: string[]): Promise<PatternDetectionResult>;
}

export interface PatternDetectionResult {
  patternsFound: Pattern[];
  antiPatternsFound: AntiPattern[];
}

export interface Pattern {
  id: string;
  name: string;
  description: string;
  confidence: number;
  examples: string[];
}

export interface AntiPattern {
  id: string;
  name: string;
  description: string;
  severity: 'low' | 'medium' | 'high';
  locations: string[];
}

// ============================================================================
// IMPROVEMENT TRACKING INTERFACES (Phase 10)
// ============================================================================

/**
 * A single data point tracking improvement after a loop iteration.
 */
export interface ImprovementTracking {
  iteration: number;
  problemsFixed: number;
  testSuitePassRate: number;         // 0.0 to 1.0
  agentSuccessRateLift: number;      // vs baseline (can be negative)
  agentTimeReduction: number;        // vs baseline (can be negative)
  timestamp: string;                 // ISO format
}

/**
 * Trend analysis over multiple improvement data points.
 */
export interface ImprovementTrend {
  dataPoints: ImprovementTracking[];
  trendDirection: 'improving' | 'stable' | 'declining';
  averageImprovement: number;        // Average lift per iteration
  totalProblemsFixed: number;
  testSuiteHealth: 'healthy' | 'degrading' | 'critical';
}

/**
 * Health metrics for the scientific loop itself.
 */
export interface LoopHealthMetrics {
  fixSuccessRate: number;            // Fixes accepted / Fixes attempted (target: > 70%)
  hypothesisAccuracy: number;        // Supported hypotheses → successful fix (target: > 50%)
  regressionRate: number;            // New failures from fixes (target: < 5%)
  evolutionCoverage: number;         // New tests catching real bugs (target: > 20%)
}

/**
 * Full improvement report combining tracking, trend, and health.
 */
export interface ImprovementReport {
  currentIteration: number;
  tracking: ImprovementTracking;
  trend: ImprovementTrend;
  health: LoopHealthMetrics;
  recommendations: string[];
}

/**
 * Interface for the Improvement Tracker agent.
 * Records and analyzes improvement over scientific loop iterations.
 */
export interface ImprovementTracker {
  // Record a data point after each iteration
  recordIteration(data: Omit<ImprovementTracking, 'timestamp'>): void;

  // Get the full tracking history
  getHistory(): ImprovementTracking[];

  // Compute trend from history
  computeTrend(): ImprovementTrend;

  // Compute loop health metrics
  computeHealth(loopResults: LoopResult[]): LoopHealthMetrics;

  // Generate full improvement report
  generateReport(loopResults: LoopResult[]): ImprovementReport;

  // Reset tracking
  reset(): void;
}

// ============================================================================
// AGENT REGISTRY
// ============================================================================

/**
 * Registry of available agent types.
 * Agents register themselves here for discovery.
 */
export interface AgentRegistry {
  register(agent: LibrarianAgent): void;
  getAgent(agentType: string): LibrarianAgent | undefined;
  getAgentsByCapability(capability: AgentCapability): LibrarianAgent[];
  getAllAgents(): LibrarianAgent[];
}

/**
 * Simple in-memory agent registry.
 */
export class SimpleAgentRegistry implements AgentRegistry {
  private agents = new Map<string, LibrarianAgent>();

  register(agent: LibrarianAgent): void {
    this.agents.set(agent.agentType, agent);
  }

  getAgent(agentType: string): LibrarianAgent | undefined {
    return this.agents.get(agentType);
  }

  getAgentsByCapability(capability: AgentCapability): LibrarianAgent[] {
    return Array.from(this.agents.values()).filter((agent) =>
      agent.capabilities.includes(capability)
    );
  }

  getAllAgents(): LibrarianAgent[] {
    return Array.from(this.agents.values());
  }
}
