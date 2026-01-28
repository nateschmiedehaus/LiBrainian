/**
 * @fileoverview Core types for the Librarian system
 */

import type { EmbeddingProvider, EmbeddingService } from './api/embeddings.js';
import type { AdequacyReport } from './api/difficulty_detectors.js';
import type { EvidenceRef } from './api/evidence.js';
import type { TechniqueOperatorType } from './strategic/techniques.js';
import type { VerificationPlan } from './strategic/verification_plan.js';
import type {
  RelevanceResult,
  Constraint,
  Violation,
  Warning,
  ConfidenceReport,
  ProceedDecision,
} from './engines/types.js';

// ============================================================================
// VERSION TYPES
// ============================================================================

export interface LibrarianVersion {
  major: number;
  minor: number;
  patch: number;
  string: string;
  qualityTier: QualityTier;
  indexedAt: Date;
  indexerVersion: string;
  features: readonly string[];
}

export type QualityTier = 'mvp' | 'enhanced' | 'full';

export interface VersionComparison {
  current: LibrarianVersion | null;
  target: LibrarianVersion;
  upgradeRequired: boolean;
  upgradeType: 'none' | 'patch' | 'minor' | 'major' | 'quality_tier';
  reason: string;
}

// ============================================================================
// KNOWLEDGE TYPES
// ============================================================================

export interface FunctionKnowledge {
  id: string;
  filePath: string;
  name: string;
  signature: string;
  purpose: string;
  startLine: number;
  endLine: number;
  embedding?: Float32Array;
  confidence: number;
  accessCount: number;
  lastAccessed: Date | null;
  validationCount: number;
  outcomeHistory: {
    successes: number;
    failures: number;
  };
}

export interface ModuleKnowledge {
  id: string;
  path: string;
  purpose: string;
  exports: string[];
  dependencies: string[];
  confidence: number;
}

/**
 * File-level knowledge - understanding of a complete source file.
 * Survives between bootstraps via checksum-based caching.
 */
export interface FileKnowledge {
  id: string;                    // SHA hash of path
  path: string;                  // Absolute file path
  relativePath: string;          // Path relative to workspace
  name: string;                  // File name
  extension: string;             // File extension
  category: 'code' | 'config' | 'docs' | 'test' | 'data' | 'schema' | 'other';

  // Semantic understanding
  purpose: string;               // What this file does (LLM-generated)
  role: string;                  // Role in the system (entry point, utility, etc.)
  summary: string;               // Brief content summary
  keyExports: string[];          // Main exports
  mainConcepts: string[];        // Domain concepts

  // Structural info
  lineCount: number;
  functionCount: number;
  classCount: number;
  importCount: number;
  exportCount: number;

  // Relationships
  imports: string[];             // Files this imports
  importedBy: string[];          // Files that import this
  directory: string;             // Parent directory path

  // Quality
  complexity: 'low' | 'medium' | 'high';
  testCoverage?: number;         // 0-1 if known
  hasTests: boolean;

  // Tracking
  checksum: string;              // Content hash for incremental updates
  confidence: number;            // 0-1 confidence in understanding
  lastIndexed: string;           // ISO timestamp
  lastModified: string;          // From file system

  // LLM Evidence (required when semantic fields are LLM-generated)
  llmEvidence?: {
    provider: string;            // 'claude' | 'codex'
    modelId: string;             // Model identifier used
    promptDigest: string;        // Hash of the prompt for reproducibility
    timestamp: string;           // ISO timestamp of generation
  };
}

/**
 * Directory-level knowledge - understanding of a directory's role and organization.
 * Critical for understanding codebase structure.
 */
export interface DirectoryKnowledge {
  id: string;                    // SHA hash of path
  path: string;                  // Absolute directory path
  relativePath: string;          // Path relative to workspace
  name: string;                  // Directory name

  // Incremental caching
  fingerprint: string;           // Deterministic fingerprint of directory contents

  // Semantic understanding
  purpose: string;               // What this directory is for
  role: 'feature' | 'layer' | 'utility' | 'config' | 'tests' | 'docs' | 'root' | 'other';
  description: string;           // Detailed description
  boundedContext?: string;       // DDD bounded context if applicable

  // Organization
  pattern: 'flat' | 'nested' | 'hybrid'; // Organization style
  depth: number;                 // Depth from workspace root
  fileCount: number;             // Files directly in this directory
  subdirectoryCount: number;     // Immediate subdirectories
  totalFiles: number;            // All files recursively

  // Contents
  mainFiles: string[];           // Key files (index.ts, README, etc.)
  subdirectories: string[];      // Child directory names
  fileTypes: Record<string, number>; // Extension -> count

  // Relationships
  parent: string | null;         // Parent directory path
  siblings: string[];            // Sibling directory names
  relatedDirectories: string[];  // Conceptually related directories

  // Quality
  hasReadme: boolean;
  hasIndex: boolean;
  hasTests: boolean;
  complexity: 'low' | 'medium' | 'high';

  // Tracking
  confidence: number;
  lastIndexed: string;

  // LLM Evidence (required when semantic fields are LLM-generated)
  llmEvidence?: {
    provider: string;            // 'claude' | 'codex'
    modelId: string;             // Model identifier used
    promptDigest: string;        // Hash of the prompt for reproducibility
    timestamp: string;           // ISO timestamp of generation
  };
}

export type GraphEntityType = 'function' | 'module' | 'file' | 'directory';
export type GraphEdgeType = 'calls' | 'imports' | 'extends' | 'implements';

export interface GraphEdge {
  fromId: string;
  fromType: GraphEntityType;
  toId: string;
  toType: GraphEntityType;
  edgeType: GraphEdgeType;
  sourceFile: string;
  sourceLine?: number | null;
  confidence: number;
  computedAt: Date;
}

export interface ContextPack {
  packId: string;
  packType: ContextPackType;
  targetId: string; // Function/module ID this pack is for
  summary: string;
  keyFacts: string[];
  codeSnippets: CodeSnippet[];
  relatedFiles: string[];
  confidence: number;
  rawConfidence?: number;
  calibratedConfidence?: number;
  uncertainty?: number;
  createdAt: Date;
  accessCount: number;
  lastOutcome: 'success' | 'failure' | 'unknown';
  successCount: number;
  failureCount: number;
  version: LibrarianVersion;
  invalidationTriggers: string[]; // File paths that invalidate this pack
}

export type ContextPackType =
  | 'function_context'
  | 'module_context'
  | 'pattern_context'
  | 'decision_context'
  | 'change_impact'
  | 'similar_tasks';

export interface CodeSnippet {
  filePath: string;
  startLine: number;
  endLine: number;
  content: string;
  language: string;
}
export type { TaxonomyItem, TaxonomySource } from './api/taxonomy.js';

// ============================================================================
// CONFIDENCE TYPES
// ============================================================================

export interface ConfidenceModel {
  baseConfidence: number;      // Initial confidence (0.5)
  reinforcementDelta: number;  // +0.1 on success
  decayDelta: number;          // -0.2 on failure
  timeDecayRate: number;       // -0.01 per day
  minConfidence: number;       // 0.1 floor
  maxConfidence: number;       // 0.95 ceiling
}

export const DEFAULT_CONFIDENCE_MODEL: ConfidenceModel = {
  baseConfidence: 0.5,
  reinforcementDelta: 0.1,
  decayDelta: 0.2,
  timeDecayRate: 0.01,
  minConfidence: 0.1,
  maxConfidence: 0.95,
};

// ============================================================================
// INDEXING TYPES
// ============================================================================

export interface IndexingTask {
  type: 'full' | 'incremental' | 'targeted';
  paths: string[];
  priority: 'critical' | 'high' | 'normal' | 'background';
  reason: string;
  triggeredBy: 'bootstrap' | 'file_change' | 'upgrade' | 'manual' | 'scheduled';
}

export interface IndexingResult {
  taskId: string;
  type: IndexingTask['type'];
  startedAt: Date;
  completedAt: Date;
  filesProcessed: number;
  filesSkipped: number;
  functionsIndexed: number;
  modulesIndexed: number;
  contextPacksCreated: number;
  errors: IndexingError[];
  version: LibrarianVersion;
}

export interface IndexingError {
  path: string;
  error: string;
  recoverable: boolean;
}

// ============================================================================
// BOOTSTRAP TYPES
// ============================================================================

export type BootstrapPhaseName =
  | 'structural_scan'
  | 'semantic_indexing'
  | 'relationship_mapping'
  | 'context_pack_generation'
  | 'knowledge_generation';

export interface BootstrapLlmPhaseConfig {
  llmProvider?: 'claude' | 'codex';
  llmModelId?: string;
}

export interface BootstrapConfig {
  workspace: string;
  /** Bootstrap mode: `fast` (no per-entity LLM enrichment) or `full` (LLM enrichment phases). */
  bootstrapMode?: 'fast' | 'full';
  // Optional override for ingestion sources (e.g., scope to a fixture subdir)
  ingestionWorkspace?: string;
  include: string[];  // Glob patterns
  exclude: string[];  // Glob patterns
  maxFileSizeBytes: number;
  // 0 or undefined means no timeout (preferred)
  timeoutMs?: number;
  /** Timeout per file in ms (0 disables). */
  fileTimeoutMs?: number;
  /** Max retries per file on timeout. */
  fileTimeoutRetries?: number;
  /** Timeout policy after retries are exhausted ('retry' retries then fails). */
  fileTimeoutPolicy?: 'skip' | 'retry' | 'fail';
  progressCallback?: (phase: BootstrapPhase, progress: number) => void;

  // LLM Configuration (REQUIRED - there is NO non-agentic mode)
  llmProvider?: 'claude' | 'codex';
  llmModelId?: string;
  llmPhaseOverrides?: Partial<Record<BootstrapPhaseName, BootstrapLlmPhaseConfig>>;
  // Force AST + LLM analysis (overrides test-mode fallback)
  useAstIndexer?: boolean;

  // Embedding Configuration (required)
  // Real embedding providers: @xenova/transformers or sentence-transformers
  // NO LLM-generated embeddings (they're hallucinated numbers, not real vectors)
  embeddingProvider?: EmbeddingProvider;
  embeddingModelId?: string;
  embeddingService?: EmbeddingService;

  // Force re-indexing of all files, ignoring checkpoint cache
  // Use this for clean re-bootstraps or when testing
  forceReindex?: boolean;

  // Allow resuming bootstrap even if workspace fingerprint changed
  // Use with caution to continue recovery on mutable workspaces
  forceResume?: boolean;

  // Skip the slow provider probe check (use when providers were already verified)
  // Default: false (always probe). Set to true for tests where providers were pre-checked.
  skipProviderProbe?: boolean;

  // Composition suggestion settings (codebase-aware recommendations after bootstrap)
  compositionSuggestions?: BootstrapCompositionSuggestionConfig;
}

export interface BootstrapPhase {
  name: string;
  description: string;
  parallel: boolean;
  targetDurationMs: number;
}

export const BOOTSTRAP_PHASES: readonly BootstrapPhase[] = [
  {
    name: 'structural_scan',
    description: 'Scanning directory structure and file types',
    parallel: true,
    targetDurationMs: 10_000,
  },
  {
    name: 'semantic_indexing',
    description: 'Computing embeddings for functions and modules',
    parallel: true,
    targetDurationMs: 30_000,
  },
  {
    name: 'relationship_mapping',
    description: 'Building import and call graphs',
    parallel: false,
    targetDurationMs: 15_000,
  },
  {
    name: 'context_pack_generation',
    description: 'Creating pre-computed context packs',
    parallel: true,
    targetDurationMs: 20_000,
  },
  {
    name: 'knowledge_generation',
    description: 'Generating universal knowledge records',
    parallel: true,
    targetDurationMs: 30_000,
  },
] as const;

/**
 * Capabilities available after bootstrap - shows what the librarian can do
 */
export interface BootstrapCapabilities {
  /** Whether semantic vector search is available (requires embeddings) */
  semanticSearch: boolean;
  /** Whether LLM-powered enrichment is available */
  llmEnrichment: boolean;
  /** Whether AST parsing extracted function data */
  functionData: boolean;
  /** Whether structural file/module data is available */
  structuralData: boolean;
  /** Whether relationship graph was built */
  relationshipGraph: boolean;
  /** Whether context packs were generated */
  contextPacks: boolean;
}

export interface OperatorRecommendation {
  type: TechniqueOperatorType;
  purpose: string;
  placement: 'early' | 'middle' | 'late' | 'wrapper';
}

export interface CompositionSuggestion {
  suggestedCompositionId: string;
  suggestedName: string;
  reason: string;
  basedOnFeatures: string[];
  suggestedPrimitives: string[];
  suggestedOperators: OperatorRecommendation[];
  priority: 'high' | 'medium' | 'low';
  estimatedValue: string;
}

export interface BootstrapCompositionSuggestionConfig {
  enabled?: boolean;
  minConfidence?: number;
  maxSuggestions?: number;
  queryDepth?: LibrarianQuery['depth'];
  queryTimeoutMs?: number;
}

export interface BootstrapReport {
  workspace: string;
  startedAt: Date;
  completedAt: Date | null;
  phases: BootstrapPhaseResult[];
  totalFilesProcessed: number;
  totalFunctionsIndexed: number;
  totalContextPacksCreated: number;
  version: LibrarianVersion;
  success: boolean;
  error?: string;
  /** What capabilities are available after bootstrap */
  capabilities?: BootstrapCapabilities;
  /** Warnings about limitations or degraded functionality */
  warnings?: string[];
  /** Summary assessment for human readers */
  statusSummary?: string;
  /** Actionable next steps for the user/agent */
  nextSteps?: string[];
  /** Suggested technique compositions to run next */
  compositionSuggestions?: CompositionSuggestion[];
}

export interface BootstrapPhaseMetrics {
  filesDiscovered?: number;
  totalFiles?: number;
  filesIndexed?: number;
  functionsIndexed?: number;
  contextPacksCreated?: number;
  ingestionItems?: number;
  fileKnowledgeItems?: number;
  directoryKnowledgeItems?: number;
  totalSupplementalItems?: number;
  totalItems?: number;
  /** Number of failed precondition validation gates */
  preconditionsFailed?: number;
  /** Number of failed postcondition validation gates */
  postconditionsFailed?: number;
}

export interface BootstrapPhaseResult {
  phase: BootstrapPhase;
  startedAt: Date;
  completedAt: Date;
  durationMs: number;
  itemsProcessed: number;
  errors: string[];
  metrics?: BootstrapPhaseMetrics;
}

// ============================================================================
// QUERY TYPES
// ============================================================================

export type LlmRequirement = 'required' | 'optional' | 'disabled';

export type LlmRequired<T> = T & { llmRequirement: 'required'; llmAvailable: true };
export type LlmOptional<T> = T & { llmRequirement: 'optional' | 'disabled'; llmAvailable: boolean };
export type LlmResult<T> =
  | { success: true; value: T }
  | { success: false; error: 'llm_unavailable'; partialResult?: Partial<T> };

export type StageName =
  | 'adequacy_scan'
  | 'direct_packs'
  | 'semantic_retrieval'
  | 'graph_expansion'
  | 'multi_signal_scoring'
  | 'multi_vector_scoring'
  | 'reranking'
  | 'defeater_check'
  | 'synthesis'
  | 'fallback'
  | 'method_guidance'
  | 'post_processing';

export type StageStatus = 'success' | 'partial' | 'failed' | 'skipped';
export type StageIssueSeverity = 'minor' | 'moderate' | 'significant';

export interface StageIssue {
  message: string;
  severity: StageIssueSeverity;
  remediation?: string;
}

export interface StageResults {
  inputCount: number;
  outputCount: number;
  filteredCount: number;
}

export interface StageReport {
  stage: StageName;
  status: StageStatus;
  results: StageResults;
  issues: StageIssue[];
  durationMs: number;
}

export interface QueryPipelineStageDefinition {
  stage: StageName;
  description: string;
  requires: string[];
  produces: string[];
}

export interface QueryPipelineDefinition {
  stages: QueryPipelineStageDefinition[];
}

export type QueryStageObserver = (report: StageReport) => void;

export interface CoverageGap {
  source: StageName;
  description: string;
  severity: StageIssueSeverity;
  remediation?: string;
}

export interface CoverageAssessment {
  estimatedCoverage: number;
  coverageConfidence: number;
  gaps: CoverageGap[];
  suggestions: string[];
}

export interface LibrarianQuery {
  intent: string;
  affectedFiles?: string[];
  taskType?: string;
  depth: 'L0' | 'L1' | 'L2' | 'L3';
  // 0 or undefined means no timeout (preferred)
  timeoutMs?: number;
  waitForIndexMs?: number;
  includeEngines?: boolean;
  minConfidence?: number;
  ucRequirements?: UCRequirementSet;
  llmRequirement?: LlmRequirement;
}

export interface UCRequirementSet {
  ucIds: string[];
  priority?: 'low' | 'medium' | 'high';
  evidenceThreshold?: number;
  freshnessMaxDays?: number;
}

export interface ConstructionPlan {
  id: string;
  templateId: string;
  ucIds: string[];
  domain?: string;
  intent: string;
  source: 'uc' | 'intent' | 'taskType' | 'default';
  createdAt: string;
}

export interface ConfidenceCalibrationSummary {
  bucketCount: number;
  sampleCount: number;
  expectedCalibrationError: number;
  maxCalibrationError: number;
  updatedAt: string;
}

export interface UncertaintyMetrics {
  confidence: number;
  entropy: number;
  variance: number;
}

export interface LibrarianResponse {
  query: LibrarianQuery;
  packs: ContextPack[];
  disclosures: string[];
  verificationPlan?: VerificationPlan;
  adequacy?: AdequacyReport;
  traceId: string;
  constructionPlan?: ConstructionPlan;
  totalConfidence: number;
  calibration?: ConfidenceCalibrationSummary;
  uncertainty?: UncertaintyMetrics;
  cacheHit: boolean;
  latencyMs: number;
  version: LibrarianVersion;
  llmRequirement?: LlmRequirement;
  llmAvailable?: boolean;
  drillDownHints: string[];
  methodHints?: string[];
  methodFamilies?: string[];
  methodHintSource?: 'uc' | 'taskType' | 'intent' | 'llm';
  explanation?: string;
  coverageGaps?: string[];
  evidenceByPack?: Record<string, EvidenceRef[]>;
  engines?: LibrarianEngineResults;
  stages?: StageReport[];
  coverage?: CoverageAssessment;

  /**
   * LLM-synthesized answer from retrieved knowledge.
   * Per VISION architecture, queries should produce synthesized understanding,
   * not just retrieved context packs. The synthesis is mandatory when LLM is available.
   */
  synthesis?: SynthesizedResponse;

  /**
   * Token for submitting feedback about this query's results.
   * Agents use this to report relevance ratings, which adjusts pack confidence.
   * Per CONTROL_LOOP.md: -0.1 for irrelevant, +0.05 × usefulness for relevant.
   */
  feedbackToken?: string;
}

export interface OutputEnvelope {
  constructionPlan: ConstructionPlan;
  packs: ContextPack[];
  adequacy?: AdequacyReport | null;
  verificationPlan?: VerificationPlan | null;
  disclosures: string[];
  traceId: string;
}

export function ensureOutputEnvelope(response: LibrarianResponse): LibrarianResponse & OutputEnvelope {
  const disclosures = new Set(response.disclosures ?? []);
  let constructionPlan = response.constructionPlan;
  if (!constructionPlan) {
    disclosures.add('unverified_by_trace(construction_plan_missing)');
    constructionPlan = {
      id: 'cp_unverified',
      templateId: 'T1',
      ucIds: [],
      intent: response.query?.intent ?? '',
      source: 'default',
      createdAt: new Date().toISOString(),
    };
  }
  const adequacy = response.adequacy;
  if (!response.adequacy) {
    disclosures.add('unverified_by_trace(adequacy_missing)');
  }
  const verificationPlan = response.verificationPlan;
  if (!response.verificationPlan) {
    disclosures.add('unverified_by_trace(verification_plan_missing)');
  }

  return {
    ...response,
    constructionPlan,
    adequacy,
    verificationPlan,
    disclosures: Array.from(disclosures),
  };
}

/**
 * LLM-synthesized response from query knowledge.
 * Represents the understanding produced by synthesizing retrieved context.
 */
export interface SynthesizedResponse {
  /** The synthesized understanding/answer */
  answer: string;

  /** Confidence in the synthesis (0-1), using geometric mean model */
  confidence: number;

  /** Citations to evidence supporting the answer */
  citations: Array<{
    packId: string;
    content: string;
    relevance: number;
    file?: string;
    line?: number;
  }>;

  /** Key insights extracted during synthesis */
  keyInsights: string[];

  /** Gaps or uncertainties identified */
  uncertainties: string[];
}

export interface LibrarianEngineResults {
  relevance?: RelevanceResult;
  constraints?: EngineConstraintSummary;
  meta?: {
    confidence: ConfidenceReport;
    proceedDecision: ProceedDecision;
  };
}

export interface EngineConstraintSummary {
  applicable: Constraint[];
  violations: Violation[];
  warnings: Warning[];
  blocking: boolean;
}

// ============================================================================
// ANALYSIS TYPES - Pre-Mortem, Slop Detection, Problem Detection
// ============================================================================

/**
 * Task types for specialized analysis modes.
 * Use these with LibrarianQuery.taskType for targeted analysis.
 */
export type AnalysisTaskType =
  | 'premortem'           // Anticipate failures before they occur
  | 'slop_detection'      // Detect AI-generated low-quality patterns
  | 'code_review'         // General code quality review
  | 'security_audit'      // Security vulnerability detection
  | 'complexity_audit'    // Find complexity debt indicators
  | 'debugging'           // Debug and diagnose issues
  | 'architecture_review' // Architectural anti-pattern detection
  | 'test_coverage'       // Identify testing blind spots
  | 'integration_risk'    // Find integration failure points
  | 'performance_audit';  // Identify performance issues

/**
 * Pre-mortem analysis request - anticipate failures before implementation.
 */
export interface PreMortemRequest {
  /** Files that will be modified */
  affectedFiles: string[];
  /** Description of the proposed change */
  changeDescription: string;
  /** Failure categories to analyze */
  categories?: PreMortemCategory[];
  /** Maximum failure modes to return per category */
  maxResultsPerCategory?: number;
}

export type PreMortemCategory =
  | 'data_flow'       // Null propagation, type coercion
  | 'state'           // Consistency, atomicity
  | 'concurrency'     // Race conditions, deadlocks
  | 'resources'       // Leaks, exhaustion
  | 'dependencies'    // External failure modes
  | 'schema'          // Data shape assumptions
  | 'error_handling'  // Unhandled cases
  | 'security';       // Vulnerability introduction

/**
 * Pre-mortem analysis result.
 */
export interface PreMortemResult {
  /** Identified failure modes */
  failureModes: FailureMode[];
  /** Risk score (0-1) */
  overallRisk: number;
  /** Recommended mitigations */
  mitigations: Mitigation[];
  /** Pre-implementation checklist */
  checklist: ChecklistItem[];
}

export interface FailureMode {
  category: PreMortemCategory;
  description: string;
  likelihood: 'low' | 'medium' | 'high';
  impact: 'low' | 'medium' | 'high' | 'critical';
  affectedCode: Array<{ file: string; line?: number; function?: string }>;
  evidence: string[];
}

export interface Mitigation {
  failureModeId: number;
  action: string;
  priority: 'immediate' | 'short_term' | 'long_term';
  effort: 'low' | 'medium' | 'high';
}

export interface ChecklistItem {
  category: string;
  item: string;
  checked: boolean;
  reason?: string;
}

/**
 * AI Slop detection request.
 */
export interface SlopDetectionRequest {
  /** Files to analyze */
  files: string[];
  /** Slop patterns to detect */
  patterns?: SlopPattern[];
  /** Severity threshold */
  minSeverity?: 'low' | 'medium' | 'high';
}

export type SlopPattern =
  // Structural slop
  | 'cargo_cult'           // Copied patterns without understanding
  | 'over_abstraction'     // Unnecessary interfaces/factories
  | 'premature_optimization'// Complex caching without benchmarks
  | 'comment_noise'        // Excessive obvious comments
  | 'type_assertion_abuse' // Excessive `as` casts
  // Logic slop
  | 'optimistic_happy_path'// Only handles success cases
  | 'boolean_blindness'    // Booleans without context
  | 'stringly_typed'       // Strings where enums belong
  | 'magic_numbers'        // Unexplained constants
  | 'zombie_code'          // Dead code kept "just in case"
  // Integration slop
  | 'leaky_abstraction'    // Implementation details exposed
  | 'circular_dependency'  // A imports B imports A
  | 'god_object'           // Class doing too much
  | 'feature_envy';        // Function uses other module's data

/**
 * AI Slop detection result.
 */
export interface SlopDetectionResult {
  /** Detected slop instances */
  instances: SlopInstance[];
  /** Summary by pattern */
  summary: Record<SlopPattern, number>;
  /** Overall slop score (0-1, lower is better) */
  slopScore: number;
  /** Recommendations for cleanup */
  recommendations: SlopRecommendation[];
}

export interface SlopInstance {
  pattern: SlopPattern;
  file: string;
  line: number;
  endLine?: number;
  function?: string;
  severity: 'low' | 'medium' | 'high';
  description: string;
  suggestion: string;
  confidence: number;
}

export interface SlopRecommendation {
  pattern: SlopPattern;
  action: string;
  priority: number;
  estimatedEffort: 'trivial' | 'small' | 'medium' | 'large';
}

/**
 * Problem detection request - comprehensive codebase health check.
 */
export interface ProblemDetectionRequest {
  /** Scope of analysis */
  scope: 'full' | 'changed' | 'specified';
  /** Files to analyze (if scope is 'specified') */
  files?: string[];
  /** Problem categories to check */
  categories?: ProblemCategory[];
  /** Include low-severity issues */
  includeLowSeverity?: boolean;
}

export type ProblemCategory =
  | 'logic_errors'         // Off-by-one, null chains, race conditions
  | 'architectural'        // God modules, circular deps, coupling
  | 'complexity'           // High cyclomatic, deep nesting
  | 'security'             // OWASP vulnerabilities
  | 'testing'              // Coverage gaps, test quality
  | 'integration'          // API contracts, database issues
  | 'runtime'              // Memory leaks, resource exhaustion
  | 'documentation';       // Missing docs on complex code

/**
 * Problem detection result.
 */
export interface ProblemDetectionResult {
  /** Detected problems */
  problems: DetectedProblem[];
  /** Health score (0-100) */
  healthScore: number;
  /** Summary by category */
  summary: Record<ProblemCategory, CategorySummary>;
  /** Priority-ordered action items */
  actionItems: ActionItem[];
}

export interface DetectedProblem {
  id: string;
  category: ProblemCategory;
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
  title: string;
  description: string;
  location: {
    file: string;
    line?: number;
    endLine?: number;
    function?: string;
  };
  evidence: string[];
  suggestedFix?: string;
  relatedProblems?: string[];
}

export interface CategorySummary {
  total: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
}

export interface ActionItem {
  problemId: string;
  action: string;
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  effort: 'trivial' | 'small' | 'medium' | 'large' | 'epic';
  dependencies?: string[];
}

/**
 * Recovery strategy for detected problems.
 */
export interface RecoveryStrategy {
  problemCategory: ProblemCategory;
  severity: 'critical' | 'high' | 'medium' | 'low';
  immediate: string[];
  shortTerm: string[];
  longTerm: string[];
}

// ============================================================================
// STORAGE TYPES
// ============================================================================

export interface LibrarianMetadata {
  version: LibrarianVersion;
  workspace: string;
  lastBootstrap: Date | null;
  lastIndexing: Date | null;
  totalFiles: number;
  totalFunctions: number;
  totalContextPacks: number;
  qualityTier: QualityTier;
}

// ============================================================================
// EVENT TYPES
// ============================================================================

export type LibrarianEventType =
  | 'bootstrap_started'
  | 'bootstrap_phase_complete'
  | 'bootstrap_complete'
  | 'bootstrap_error'
  | 'ingestion_started'
  | 'ingestion_source_completed'
  | 'ingestion_completed'
  | 'indexing_started'
  | 'indexing_complete'
  | 'task_received'
  | 'task_completed'
  | 'task_failed'
  | 'file_modified'
  | 'file_created'
  | 'file_deleted'
  | 'entity_created'
  | 'entity_updated'
  | 'entity_deleted'
  | 'language_onboarding'
  | 'query_received'
  | 'query_complete'
  | 'query_start'
  | 'query_result'
  | 'query_error'
  | 'index_file'
  | 'index_function'
  | 'index_complete'
  | 'understanding_generation_started'
  | 'understanding_generated'
  | 'understanding_generation_complete'
  | 'understanding_invalidated'
  | 'feedback_received'
  | 'engine_relevance'
  | 'engine_constraint'
  | 'engine_confidence'
  | 'integration_context'
  | 'integration_outcome'
  | 'upgrade_started'
  | 'upgrade_complete'
  | 'confidence_updated'
  | 'context_pack_invalidated'
  | 'context_packs_invalidated'
  | 'threshold_alert';

export interface LibrarianEvent {
  type: LibrarianEventType;
  timestamp: Date;
  data: Record<string, unknown>;
  /** Correlation ID for multi-agent coordination (session/run) */
  sessionId?: string;
  /** Optional cross-system correlation ID */
  correlationId?: string;
}
