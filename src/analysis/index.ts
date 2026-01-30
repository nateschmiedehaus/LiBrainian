/**
 * Analysis Module Index
 *
 * Exports all analysis functionality:
 * - Deterministic: Graph algorithms (SCC, CFG, adjacency)
 * - Probabilistic: Bayesian confidence, stability tracking
 * - Hybrid: Feedback loops, system health, risk propagation
 */

// Deterministic Analysis
export {
  findSCCs,
  storeSCCAnalysis,
  computeAdjacencyAnalysis,
  findShortestPath,
  buildControlFlowGraph,
  storeCFGAnalysis,
  computeGraphMetrics,
  runDeterministicAnalysis,
  type AdjacencyAnalysis,
  type BasicBlock,
  type ControlFlowResult,
  type GraphMetrics,
  type DeterministicAnalysisResult,
} from './deterministic_analysis.js';

// Probabilistic Analysis
export {
  betaMean,
  betaVariance,
  betaCredibleInterval,
  computeConfidenceEstimate,
  createInitialConfidence,
  updateConfidence,
  recordObservations,
  propagateConfidence,
  aggregateConfidence,
  computeStabilityFromHistory,
  recordStabilityMetrics,
  generateUncertaintyReport,
  runProbabilisticAnalysis,
  type ConfidenceObservation,
  type ConfidenceEstimate,
  type PropagationResult,
  type UncertaintyReport,
  type ProbabilisticAnalysisResult,
} from './probabilistic_analysis.js';

// Hybrid Analysis
export {
  detectFeedbackLoops,
  storeFeedbackLoops,
  computeControlStability,
  generateSystemHealthReport,
  propagateRisk,
  runHybridAnalysis,
  type DetectedLoop,
  type ControlStabilityMetrics,
  type SystemHealthReport,
  type RiskPropagationResult,
  type HybridAnalysisResult,
} from './hybrid_analysis.js';

// Code Clone Analysis (2025-2026 research: 15-30% codebase duplication)
export {
  tokenize,
  normalizeTokens,
  jaccardSimilarity,
  classifyCloneType,
  findCloneCandidates,
  analyzeClones,
  getRefactoringOpportunities,
  getSemanticClones,
  calculateDuplicationMetrics,
  lcsRatio,
  cosineSimilarity,
  estimateRefactoringPotential,
  getClonesForEntity,
  getCloneClustersWithAnalysis,
  type CloneAnalysisOptions,
  type CloneAnalysisResult,
  type ClonePair,
  type TokenizedFunction,
} from './code_clone_analysis.js';

// Technical Debt Analysis (2025-2026 research: multi-dimensional debt tracking)
export {
  calculateComplexityDebt,
  calculateDuplicationDebt,
  calculateCouplingDebt,
  calculateArchitectureDebt,
  calculateChurnDebt,
  calculateCoverageDebt,
  calculateDocumentationDebt,
  calculateSecurityDebt,
  aggregateDebt,
  analyzeDebt,
  getDebtHotspots as getTechnicalDebtHotspots,
  getDegradingEntities,
  getEntitiesByPriority,
  calculateCodebaseHealth,
  estimateFixHours,
  COMPLEXITY_THRESHOLDS,
  DEBT_WEIGHTS,
  PRIORITY_THRESHOLDS,
  type DebtAnalysisOptions,
  type DebtAnalysisResult,
  type DebtSignals,
} from './technical_debt_analysis.js';

// Data Flow Analysis (tp_data_lineage, tp_state_trace from track-e-domain D1)
export {
  buildDataFlowGraph,
  traceDataLineage,
  traceState,
  findDataSources,
  findDataSinks,
  findTaintedPaths,
  findNullFlowRisks,
  type DataFlowNode,
  type DataFlowNodeType,
  type DataFlowLocation,
  type DataFlowNodeMetadata,
  type DataFlowEdge,
  type DataFlowTransformType,
  type DataLineage,
  type StateMutation,
  type StateTrace,
  type DataFlowGraph,
} from './data_flow.js';
