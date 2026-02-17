/**
 * @fileoverview Agents module exports
 */

export type {
  LibrarianAgent,
  AgentCapability,
  IndexingAgent,
  FileIndexResult,
  IndexingStats,
  PatternAgent,
  PatternDetectionResult,
  Pattern,
  AntiPattern,
  AgentRegistry,
  ProblemDetectorAgent,
  Problem,
  ProblemType,
  ProblemSeverity,
  ProblemDetectionInput,
  ProblemDetectionReport,
  ProblemDetectionSummary,
  CommandRunner,
  CommandResult,
  TestFailureCheck,
  RegressionCheck,
  AdversarialProbe,
  PerformanceExperiment,
  ConsistencyCheck,
  // Hypothesis Generator types (Phase 10)
  HypothesisGeneratorAgent,
  Hypothesis,
  HypothesisTest,
  HypothesisTestType,
  HypothesisLikelihood,
  HypothesisGenerationInput,
  HypothesisGenerationReport,
  // Hypothesis Tester types (Phase 10)
  HypothesisTesterAgent,
  HypothesisTesterInput,
  HypothesisTestResult,
  HypothesisTestVerdict,
  HypothesisTestRecommendation,
  TestEvidence,
  TestEvidenceType,
  // Fix Generator types (Phase 10)
  FixGeneratorAgent,
  FixGeneratorInput,
  FixGeneratorReport,
  Fix,
  FileChange,
  FileChangeType,
  // Fix Verifier types (Phase 10)
  FixVerifierAgent,
  FixVerifierInput,
  VerificationResult,
  ExecutionEntry,
  // Benchmark Evolver types (Phase 10)
  BenchmarkEvolverAgent,
  BenchmarkEvolverInput,
  BenchmarkEvolution,
  TestCase,
  TestCaseCategory,
  CoverageGap,
  // Scientific Loop Orchestrator types (Phase 10)
  ScientificLoopOrchestrator,
  ScientificLoopState,
  ScientificLoopOrchestratorConfig,
  LoopResult,
  LoopSummary,
  Escalation,
  EscalationReason,
  EscalationRecommendation,
  // Improvement Tracker types (Phase 10)
  ImprovementTracking,
  ImprovementTrend,
  LoopHealthMetrics,
  ImprovementReport,
  ImprovementTracker,
} from './types.js';

export { SimpleAgentRegistry } from './types.js';

export {
  IndexLibrarian,
  createIndexLibrarian,
  DEFAULT_CONFIG as DEFAULT_INDEX_LIBRARIAN_CONFIG,
} from './index_librarian.js';
export type { IndexLibrarianConfig } from './index_librarian.js';

export {
  ProblemDetector,
  createProblemDetector,
} from './problem_detector.js';
export type { ProblemDetectorConfig } from './problem_detector.js';

export {
  HypothesisGenerator,
  createHypothesisGenerator,
} from './hypothesis_generator.js';
export type { HypothesisGeneratorConfig } from './hypothesis_generator.js';

export {
  HypothesisTester,
  createHypothesisTester,
} from './hypothesis_tester.js';
export type { HypothesisTesterConfig } from './hypothesis_tester.js';

export {
  FixGenerator,
  createFixGenerator,
} from './fix_generator.js';
export type { FixGeneratorConfig } from './fix_generator.js';

export {
  FixVerifier,
  createFixVerifier,
} from './fix_verifier.js';
export type { FixVerifierConfig } from './fix_verifier.js';

export {
  BenchmarkEvolver,
  createBenchmarkEvolver,
} from './benchmark_evolver.js';
export type { BenchmarkEvolverConfig } from './benchmark_evolver.js';

export {
  ScientificLoopOrchestratorImpl,
  createScientificLoopOrchestrator,
} from './loop_orchestrator.js';

export {
  ImprovementTrackerImpl,
  createImprovementTracker,
} from './improvement_tracker.js';
export type { ImprovementTrackerConfig } from './improvement_tracker.js';

// Hierarchical Agent Orchestration (WU-AGENT-001)
export {
  HierarchicalOrchestrator,
  createHierarchicalOrchestrator,
} from './hierarchical_orchestrator.js';
export type {
  AgentRole,
  TaskDecomposition,
  Subtask,
  OrchestrationConfig,
  OrchestrationResult,
  OrchestrationState,
  WorkerExecutor,
  PlannerStrategy,
} from './hierarchical_orchestrator.js';

// Self-Improvement Primitives (Meta-epistemic loop)
export {
  selfBootstrap,
  createSelfBootstrap,
  selfRefresh,
  createSelfRefresh,
  analyzeArchitecture,
  createAnalyzeArchitecture,
} from './self_improvement/index.js';
export type {
  SelfBootstrapResult,
  SelfBootstrapOptions,
  CoverageMetrics,
  SelfRefreshResult,
  SelfRefreshOptions,
  ChangeSummary,
  ArchitectureAnalysisResult,
  AnalyzeArchitectureOptions,
  ModuleInfo,
  DependencyInfo,
  CycleInfo,
  ViolationInfo,
  CouplingMetrics,
  ArchitectureSuggestion,
  ArchitectureCheck,
  ArchitectureThresholds,
} from './self_improvement/index.js';

// Tree-sitter Universal Parser (WU-LANG-001)
export {
  TreeSitterParser,
  createTreeSitterParser,
  registerTreeSitterLanguage,
  getTreeSitterLanguageConfigs,
} from './parsers/index.js';
export type {
  ParseResult,
  SyntaxTree,
  SyntaxNode,
  Position,
  ParseError,
  LanguageSupport,
  FunctionNode,
  ClassNode,
  EditRange,
  ParseOptions,
  TreeSitterLanguageConfig,
} from './parsers/index.js';

// Specialized Retrieval Agents (WU-AGENT-002)
export {
  createGraphRetriever,
  createVectorRetriever,
  createLSPRetriever,
} from './specialized_retrievers.js';
export type {
  RetrieverAgent,
  GraphRetriever,
  VectorRetriever,
  LSPRetriever,
  RetrievalResult,
  RetrievalOptions,
  GraphRetrieverConfig,
  VectorRetrieverConfig,
  LSPRetrieverConfig,
} from './specialized_retrievers.js';
