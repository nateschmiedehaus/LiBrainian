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
  /** Heuristic behavioral fingerprint: no side effects, no throws, no parameter mutation. */
  isPure?: boolean;
  /** Heuristic flag for potential observable side effects. */
  hasSideEffects?: boolean;
  /** Heuristic flag for parameter mutation within function body. */
  modifiesParams?: boolean;
  /** Heuristic flag for explicit throw statements. */
  throws?: boolean;
  /** Heuristic return dependency signal (return appears to depend on parameters). */
  returnDependsOnInputs?: boolean;
  /** Heuristic effect categories observed in function body. */
  effectSignature?: string[];
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

/**
 * Document-level knowledge - understanding of documentation files.
 * Used for meta-queries like "How should an agent use Librarian?"
 * Documents have high relevance for conceptual/how-to queries.
 */
export interface DocumentKnowledge {
  id: string;                      // doc:relativePath
  path: string;                    // Absolute file path
  relativePath: string;            // Path relative to workspace
  name: string;                    // File name (e.g., "AGENTS.md")

  // Semantic understanding
  title: string;                   // Primary heading or file name
  summary: string;                 // LLM-generated summary
  purpose: string;                 // What this document is for
  audience: 'agent' | 'developer' | 'user' | 'general';

  // Content structure
  headings: string[];              // H1/H2 headings
  keyTopics: string[];             // Main topics covered
  wordCount: number;

  // Relevance signals
  isMetaDoc: boolean;              // AGENTS.md, README.md, etc.
  relevanceBoost: number;          // 0-1, higher for agent-facing docs

  // Tracking
  embedding?: Float32Array;        // Semantic vector
  confidence: number;
  lastIndexed: string;
  checksum: string;

  // LLM Evidence
  llmEvidence?: {
    provider: string;
    modelId: string;
    promptDigest: string;
    timestamp: string;
  };
}

export type GraphEntityType =
  | 'function'
  | 'module'
  | 'file'
  | 'directory'
  | 'class'
  | 'interface'
  | 'endpoint'
  | 'graphql_type'
  | 'graphql_operation';
export type GraphEdgeType = 'calls' | 'imports' | 'extends' | 'implements' | 'entangled';

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
  intentType?: string;
  scope?: string;
  provenance?: string;
  tokenEstimate?: number;
  sourceConstructionId?: string;
  sessionId?: string;
  schemaVersion?: number;
  contentHash?: string;
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

  /**
   * Signals this is the primary/best result for the query.
   * Agents should focus on this pack first when processing results.
   * Only one pack per response should have this flag set to true.
   */
  isPrimaryResult?: boolean;
}

export type ContextPackType =
  | 'function_context'
  | 'module_context'
  | 'pattern_context'
  | 'decision_context'
  | 'change_impact'
  | 'similar_tasks'
  | 'doc_context'
  | 'project_understanding'
  | 'symbol_definition'
  | 'enumeration_result'
  | 'git_history'
  | 'call_flow';

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
  progressCallback?: (phase: BootstrapPhase, progress: number, details?: {
    total?: number;
    current?: number;
    currentFile?: string;
  }) => void;

  /**
   * If true, bootstrap must not invoke LLMs (heuristic/offline mode).
   * Embeddings/AST indexing can still run.
   */
  skipLlm?: boolean;
  /**
   * If true, bootstrap must not generate embeddings (degraded/offline mode).
   * Structural indexing and context packs can still run.
   */
  skipEmbeddings?: boolean;
  /**
   * Emit an onboarding baseline report after successful bootstrap.
   */
  emitBaseline?: boolean;
  /**
   * Write .librainian-manifest.json uninstall metadata after successful bootstrap.
   */
  emitInstallManifest?: boolean;
  /**
   * Opt-in to mutating AGENTS.md / CLAUDE.md / CODEX.md with generated sections.
   * Default is false to avoid surprising edits in instruction files.
   */
  updateAgentDocs?: boolean;
  /**
   * When true, skip CLAUDE.md writes even if updateAgentDocs is enabled.
   */
  noClaudeMd?: boolean;
  /**
   * Automatically recover from stale bootstrap checkpoints by restarting clean.
   * When false, stale checkpoints throw and require manual force-resume.
   */
  autoRecover?: boolean;

  // LLM Configuration (optional when skipLlm=true)
  llmProvider?: 'claude' | 'codex';
  llmModelId?: string;
  llmPhaseOverrides?: Partial<Record<BootstrapPhaseName, BootstrapLlmPhaseConfig>>;
  // Force AST + LLM analysis (overrides test-mode fallback)
  useAstIndexer?: boolean;

  // Embedding Configuration (required)
  // Real embedding providers: @huggingface/transformers or sentence-transformers
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

  // Constructable auto-selection settings
  constructableAutoSelection?: {
    /** Enable automatic constructable selection based on project analysis (default: true) */
    enabled?: boolean;
    /** Minimum confidence threshold for auto-enabling constructables (default: 0.6) */
    minConfidence?: number;
    /** Force enable specific constructables regardless of detection */
    forceEnable?: string[];
    /** Force disable specific constructables regardless of detection */
    forceDisable?: string[];
  };
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

export type BootstrapBriefingFileRole =
  | 'router'
  | 'controller'
  | 'service'
  | 'model'
  | 'util'
  | 'test'
  | 'config'
  | 'unknown';

export interface BootstrapBriefingRoleCount {
  role: BootstrapBriefingFileRole;
  count: number;
}

export interface BootstrapBriefingSummary {
  path: string;
  frameworks: string[];
  primaryLanguage: string;
  keyEntryPoints: string[];
  monorepoPackages: string[];
  roleCounts: BootstrapBriefingRoleCount[];
  findings: string[];
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
  /** Auto-selected constructables based on project analysis */
  autoSelectedConstructables?: {
    enabled: string[];
    disabled: string[];
    confidence: number;
    projectType: string | null;
    frameworks: string[];
    languages: string[];
  };
  /** Bootstrap-time repository orientation persisted to .librarian/CODEBASE_BRIEFING.md */
  codebaseBriefing?: BootstrapBriefingSummary;
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
// ONBOARDING BASELINE
// ============================================================================

export interface OnboardingBaseline {
  kind: 'OnboardingBaseline.v1';
  schemaVersion: 1;
  workspacePath: string;
  capturedAt: string;
  environment: {
    nodeVersion: string;
    platform: string;
    providerAvailable: boolean;
    modelId: string;
  };
  metrics: {
    bootstrapDurationMs: number;
    entityCoverage: number;
    confidenceMean: number;
    defeaterCount: number;
    providerLatencyP50Ms: number;
  };
  entities: {
    files: number;
    functions: number;
    classes: number;
    modules: number;
  };
  quality: {
    orphanEntities: number;
    lowConfidenceEntities: number;
    missingOwnership: number;
  };
}

// ============================================================================
// PERSPECTIVE TYPES
// ============================================================================

/**
 * Query perspectives for multi-view retrieval.
 * Each perspective maps to relevant T-patterns and adjusts scoring weights.
 *
 * Research basis: docs/research/MULTI-PERSPECTIVE-VIEWS-RESEARCH.md
 */
export type Perspective =
  | 'navigation'     // T-01 to T-06, T-16: Code/file navigation and location discovery
  | 'debugging'      // T-19 to T-24: Bug investigation patterns
  | 'security'       // T-27: Security vulnerability patterns
  | 'performance'    // T-28: Performance anti-patterns
  | 'architecture'   // T-07, T-08, T-09, T-29: Design patterns, module architecture, circular deps
  | 'modification'   // T-13 to T-18: Feature location, breaking changes, usages
  | 'testing'        // T-06, T-17: Test mapping, coverage gaps
  | 'understanding'; // T-01 to T-12: Code navigation and understanding

/**
 * All valid perspective values for validation.
 */
export const PERSPECTIVES: readonly Perspective[] = [
  'navigation',
  'debugging',
  'security',
  'performance',
  'architecture',
  'modification',
  'testing',
  'understanding',
] as const;

/**
 * Type guard for Perspective values.
 */
export function isPerspective(value: unknown): value is Perspective {
  return typeof value === 'string' && PERSPECTIVES.includes(value as Perspective);
}

// ============================================================================
// TOKEN BUDGET TYPES
// ============================================================================

/**
 * Token budget configuration for query responses.
 * Agents have finite context windows - this allows them to request
 * appropriately-sized responses to avoid wasting context space.
 *
 * Motivation: L1 queries can return 10,000+ tokens even when agents
 * only need a 500-token answer. Token budgeting enables intelligent
 * truncation by relevance rather than arbitrary cutoffs.
 */
export interface TokenBudget {
  /** Maximum tokens allowed in the response */
  maxTokens: number;
  /** Reserve tokens for agent's response (subtracted from maxTokens) */
  reserveTokens?: number;
  /** Priority for what to preserve when truncating */
  priority?: 'relevance' | 'recency' | 'diversity';
}

/**
 * Result of token budget enforcement.
 * Returned in LibrarianResponse to inform agents about truncation.
 */
export interface TokenBudgetResult {
  /** Whether the response was truncated to fit the budget */
  truncated: boolean;
  /** Estimated tokens used in the response */
  tokensUsed: number;
  /** Total tokens available (maxTokens - reserveTokens) */
  totalAvailable: number;
  /** Strategy used for truncation */
  truncationStrategy: 'relevance' | 'count' | 'none';
  /** Number of packs before truncation */
  originalPackCount?: number;
  /** Number of packs after truncation */
  finalPackCount?: number;
  /** Fields that were trimmed */
  trimmedFields?: string[];
}

// ============================================================================
// QUERY TYPES
// ============================================================================

export type LlmRequirement = 'required' | 'optional' | 'disabled';
export type EmbeddingRequirement = 'required' | 'optional' | 'disabled';

export type LlmRequired<T> = T & { llmRequirement: 'required'; llmAvailable: true };
export type LlmOptional<T> = T & { llmRequirement: 'optional' | 'disabled'; llmAvailable: boolean };
export type LlmResult<T> =
  | { success: true; value: T }
  | { success: false; error: 'llm_unavailable'; partialResult?: Partial<T> };

// ============================================================================
// DETERMINISTIC MODE TYPES
// ============================================================================

/**
 * Context for deterministic query execution.
 * Provides fixed values for operations that would otherwise be non-deterministic.
 */
export interface DeterministicContext {
  /** Fixed timestamp for all operations (ISO string) */
  fixedTimestamp: string;
  /** Fixed Date object for operations requiring Date */
  fixedDate: Date;
  /** Counter for generating sequential deterministic IDs */
  idCounter: number;
  /** Generate a deterministic ID with optional prefix */
  generateId: (prefix?: string) => string;
  /** Get the current fixed timestamp */
  now: () => string;
  /** Get the current fixed Date */
  nowDate: () => Date;
}

/**
 * Creates a deterministic context for reproducible query execution.
 * Uses a fixed epoch timestamp and sequential ID generation.
 */
export function createDeterministicContext(seed?: string): DeterministicContext {
  // Use a fixed timestamp: 2025-01-01T00:00:00.000Z
  const fixedTimestamp = '2025-01-01T00:00:00.000Z';
  const fixedDate = new Date(fixedTimestamp);
  let idCounter = 0;

  // Create deterministic ID based on seed and counter
  const generateId = (prefix?: string): string => {
    const counter = idCounter++;
    const base = seed ? `${seed}-${counter}` : `det-${counter}`;
    return prefix ? `${prefix}${base}` : base;
  };

  return {
    fixedTimestamp,
    fixedDate,
    idCounter: 0,
    generateId,
    now: () => fixedTimestamp,
    nowDate: () => fixedDate,
  };
}

/**
 * Applies stable sorting to an array by a secondary key (ID) when primary scores tie.
 * This ensures deterministic ordering in query results.
 *
 * @param items - Array to sort
 * @param getScore - Function to extract primary sort score (higher first)
 * @param getId - Function to extract secondary sort key (alphabetical on ties)
 * @returns Stably sorted array
 */
export function stableSort<T>(
  items: T[],
  getScore: (item: T) => number,
  getId: (item: T) => string
): T[] {
  return [...items].sort((a, b) => {
    const scoreA = getScore(a);
    const scoreB = getScore(b);
    if (scoreA !== scoreB) {
      return scoreB - scoreA; // Higher score first
    }
    // On ties, sort by ID for stability
    return getId(a).localeCompare(getId(b));
  });
}

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
  telemetry?: StageTelemetry;
}

export interface StageTelemetry {
  candidateWindow?: number;
  searchExecutions?: number;
  rerankWindow?: number;
  rerankInputCount?: number;
  rerankAppliedCount?: number;
  rerankSkipReason?: string;
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

export interface SearchFilter {
  /**
   * Restrict retrieval to files under this workspace-relative path prefix.
   * Example: "packages/api/".
   */
  pathPrefix?: string;

  /**
   * Restrict retrieval to a language family.
   * Supported values are normalized by storage (for example: typescript, javascript, python, go, rust, java, kotlin, csharp, ruby, php, swift).
   */
  language?: string;

  /**
   * Restrict retrieval to exported/public symbols when true, or non-exported/internal symbols when false.
   */
  isExported?: boolean;

  /**
   * Restrict retrieval to functions marked pure (true) or impure (false) by behavioral heuristics.
   */
  isPure?: boolean;

  /**
   * Exclude common test/spec paths when true.
   */
  excludeTests?: boolean;

  /**
   * Optional max file size guard in bytes.
   */
  maxFileSizeBytes?: number;
}

export interface LibrarianQuery {
  intent: string;
  /**
   * Optional typed intent contract for callers that want deterministic output shapes.
   * Supported values mirror MCP query intent categories.
   */
  intentType?: QueryIntentType;
  affectedFiles?: string[];
  /**
   * Optional monorepo/package scope alias.
   * Equivalent to setting `filter.pathPrefix` but simpler for callers.
   * Example: "apps/api" limits retrieval to files under that path prefix.
   */
  scope?: string;
  /**
   * Enable Maximal Marginal Relevance (MMR) diversification during reranking.
   * When true, balances relevance with non-redundancy across returned packs.
   */
  diversify?: boolean;
  /**
   * MMR lambda in [0,1]. 1 prioritizes relevance, 0 prioritizes diversity.
   * Ignored unless `diversify` is true.
   */
  diversityLambda?: number;
  filter?: SearchFilter;
  workingFile?: string;
  taskType?: string;
  depth: 'L0' | 'L1' | 'L2' | 'L3';
  // 0 or undefined means no timeout (preferred)
  timeoutMs?: number;
  waitForIndexMs?: number;
  includeEngines?: boolean;
  minConfidence?: number;
  ucRequirements?: UCRequirementSet;
  llmRequirement?: LlmRequirement;
  /**
   * Surface raw LLM synthesis errors on the response when available.
   * Defaults to true. Set false for backward-compatible silent mode.
   */
  showLlmErrors?: boolean;
  embeddingRequirement?: EmbeddingRequirement;

  /**
   * Deterministic mode for testing and verification.
   * When true, the query pipeline produces reproducible results by:
   * - Skipping LLM synthesis (uses cached or returns without synthesis)
   * - Using stable sorting (by ID when relevance scores tie)
   * - Disabling any randomization (fixed UUIDs, fixed timestamps)
   * - Returning consistent/omitted timestamps
   *
   * This is critical for agent testing where the same query must return
   * identical results across multiple runs.
   *
   * Non-deterministic operations that ARE affected:
   * - LLM synthesis: skipped (returns undefined or cached)
   * - Result sorting: stable by ID on ties
   * - UUID generation: uses deterministic IDs
   * - Timestamps: uses fixed epoch or omitted
   *
   * Non-deterministic operations that are NOT affected:
   * - Vector similarity search: inherently deterministic for same embeddings
   * - Graph traversal: deterministic for same graph state
   * - Cache hits: still used when available
   */
  deterministic?: boolean;

  /**
   * Disable method-guidance LLM enrichment for this query.
   * Useful for latency-critical evaluation paths where guidance hints are not part of the scoring target.
   */
  disableMethodGuidance?: boolean;

  /**
   * Force synthesis from retrieved summaries without issuing a full LLM synthesis call.
   * Intended for high-volume evaluation workflows where deterministic, evidence-linked summaries are preferred.
   */
  forceSummarySynthesis?: boolean;

  /**
   * Query perspective for multi-view retrieval.
   * When specified, boosts relevant T-patterns and adjusts scoring weights.
   *
   * Perspectives map to T-pattern categories:
   * - 'debugging': T-19 to T-24 (bug investigation)
   * - 'security': T-27 (security vulnerabilities)
   * - 'performance': T-28 (performance anti-patterns)
   * - 'architecture': T-07, T-08, T-09, T-29 (design patterns, structure)
   * - 'modification': T-13 to T-18 (feature location, breaking changes)
   * - 'testing': T-06, T-17 (test mapping, coverage)
   * - 'understanding': T-01 to T-12 (navigation, comprehension)
   */
  perspective?: Perspective;

  /**
   * Token budget for response size control.
   * When specified, the response will be truncated to fit within the budget,
   * preserving the most relevant results by score.
   *
   * This is critical for agent integration where context windows are finite
   * and verbose responses waste valuable context space.
   */
  tokenBudget?: TokenBudget;

  /**
   * Disable query cache reads/writes for this request.
   * Useful for evaluation runs that must reflect current logic rather than prior cached responses.
   */
  disableCache?: boolean;

  /**
   * Enable HyDE (Hypothetical Document Expansion) for semantic retrieval.
   * When true, retrieval generates a concise hypothetical TypeScript stub from intent,
   * embeds it, and fuses direct+HyDE rankings via reciprocal-rank fusion.
   *
   * Default: false (opt-in due to additional LLM latency).
   */
  hydeExpansion?: boolean;

  /**
   * Maximum number of automatic retrieval escalations for this query.
   * Defaults to 2 when not provided.
   */
  maxEscalationDepth?: number;

  /**
   * Edge types to filter knowledge graph traversal.
   * When specified, only edges of these types are considered during graph
   * expansion and relation discovery.
   *
   * This enables targeted queries like:
   * - "Show me what supports this decision" → filter to 'supports' edges
   * - "Show me contradicting alternatives" → filter to 'contradicts' edges
   * - "Show me the decision chain" → filter to 'supersedes', 'depends_on_decision'
   *
   * Can include both KnowledgeEdgeType (imports, calls, etc.) and
   * ArgumentEdgeType (supports, warrants, contradicts, etc.) values.
   *
   * @see docs/research/ARGUMENTATION-STRUCTURES-FOR-CODE-REASONING.md
   */
  edgeTypes?: string[];

  /**
   * Exhaustive mode for complete dependency enumeration.
   *
   * When enabled, the query uses graph traversal instead of semantic search
   * to find ALL entities matching the dependency criteria. This is critical
   * for refactoring scenarios where missing even one dependent can cause breakage.
   *
   * Use cases:
   * - "What depends on SqliteLibrarianStorage" -> Returns ALL 208 files, not 6
   * - "Everything that imports src/storage/types.ts" -> Complete list
   * - Impact analysis for breaking changes
   *
   * Options:
   * - enabled: Turn on exhaustive mode (default: auto-detected from intent)
   * - includeTransitive: Follow transitive dependencies (A->B->C means A depends on C)
   * - maxDepth: Maximum depth for transitive traversal (default: 10)
   * - direction: 'dependents' (who imports this) or 'dependencies' (what this imports)
   *
   * Performance note: Exhaustive queries can be slow on large codebases.
   * Use semantic search for exploration, exhaustive for refactoring.
   */
  exhaustive?: {
    /** Enable exhaustive enumeration mode */
    enabled: boolean;
    /** Include transitive dependencies (A imports B imports C -> A depends on C) */
    includeTransitive?: boolean;
    /** Maximum depth for transitive traversal (default: 10) */
    maxDepth?: number;
    /** Direction: 'dependents' (who imports this) or 'dependencies' (what this imports) */
    direction?: 'dependents' | 'dependencies';
    /** Specific target entity (file path or symbol name) */
    targetEntity?: string;
  };

  /**
   * Enabled constructables for query routing.
   * When provided, only constructions in this list will be activated during query.
   * This is typically populated from the session's constructableConfig.enabled.
   *
   * Construction IDs map to stage runners:
   * - 'refactoring-safety-checker' -> runRefactoringSafetyStage
   * - 'bug-investigation-assistant' -> runBugInvestigationStage
   * - 'security-audit-helper' -> runSecurityAuditStage
   * - 'architecture-verifier' -> runArchitectureVerificationStage
   * - 'code-quality-reporter' -> runCodeQualityStage
   * - 'feature-location-advisor' -> runFeatureLocationStage
   *
   * When undefined, all constructions that match pattern are enabled (legacy behavior).
   */
  enabledConstructables?: string[];
}

export type QueryIntentType =
  | 'understand'
  | 'debug'
  | 'refactor'
  | 'impact'
  | 'security'
  | 'test'
  | 'document'
  | 'navigate'
  | 'general';

export interface QueryRelevantFile {
  path: string;
  role: string;
  confidence: number;
}

export interface UnderstandQueryResultContract {
  intentType: 'understand';
  summary: string;
  keyFacts: string[];
  relevantFiles: QueryRelevantFile[];
  confidence: number;
  dataAge: string;
}

export interface ImpactDirectEntry {
  file: string;
  reason: string;
}

export interface ImpactTransitiveEntry {
  file: string;
  hopDistance: number;
}

export interface ImpactQueryResultContract {
  intentType: 'impact';
  directImpact: ImpactDirectEntry[];
  transitiveImpact: ImpactTransitiveEntry[];
  safeToChange: boolean;
  riskFactors: string[];
  confidence: number;
}

export type QueryResultContract =
  | UnderstandQueryResultContract
  | ImpactQueryResultContract;

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
  selectionReason?: string;
  rankedCandidates?: Array<{
    templateId: string;
    score: number;
    reasoning: string;
    source: 'uc' | 'intent' | 'default';
  }>;
  requiredMaps?: string[];
  optionalMaps?: string[];
  requiredObjects?: string[];
  optionalObjects?: string[];
  requiredCapabilities?: string[];
  requiredArtifacts?: string[];
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

export type RetrievalStatus = 'sufficient' | 'partial' | 'insufficient';

/**
 * Structured follow-up query suggestion.
 * Provides actionable queries agents can execute directly, rather than
 * generic string hints that require interpretation.
 */
export interface FollowUpQuery {
  /** The query intent to execute (can be passed directly to librarian) */
  intent: string;
  /** Why this follow-up is relevant based on current results */
  reason: string;
}

/**
 * Diagnostic information when a query returns zero results.
 * Helps agents understand why no results were found and what to try next.
 */
export interface QueryDiagnostics {
  /** Always true when this field is present - indicates empty results */
  noResults: true;
  /** Reasons explaining why no results were returned */
  reasons: string[];
  /** Actionable suggestions for getting better results */
  suggestions: string[];
}

export type SynthesisMode = 'llm' | 'heuristic' | 'cache';

export interface RiskHighlight {
  entity: string;
  risk: 'HIGH' | 'CRITICAL';
  rationale: string;
}

export interface StabilityAlert {
  entity: string;
  changes: number;
  period: string;
  trend: 'increasing' | 'stable' | 'decreasing';
}

export interface OwnershipContext {
  entity: string;
  owner: string;
  lastActive: string;
}

export interface EntityIntel {
  entity: string;
  maintainabilityIndex?: number;
  coChangesWith?: string[];
}

export interface LibrarianResponse {
  query: LibrarianQuery;
  intentType?: QueryIntentType;
  contract?: QueryResultContract;
  packs: ContextPack[];
  riskHighlights?: RiskHighlight[];
  stabilityAlerts?: StabilityAlert[];
  ownershipContext?: OwnershipContext[];
  entityIntel?: EntityIntel[];
  disclosures: string[];
  verificationPlan?: VerificationPlan;
  adequacy?: AdequacyReport;
  traceId: string;
  constructionPlan?: ConstructionPlan;
  totalConfidence: number;
  calibration?: ConfidenceCalibrationSummary;
  uncertainty?: UncertaintyMetrics;
  retrievalStatus?: RetrievalStatus;
  retrievalEntropy?: number;
  retrievalInsufficient?: boolean;
  suggestedClarifyingQuestions?: string[];
  cacheHit: boolean;
  latencyMs: number;
  version: LibrarianVersion;
  llmRequirement?: LlmRequirement;
  llmAvailable?: boolean;
  synthesisMode?: SynthesisMode;
  llmError?: string;
  drillDownHints: string[];
  /**
   * Structured follow-up queries agents can execute directly.
   * Each entry includes an intent (the actual query) and reason (why it's relevant).
   * Agents should prefer these over drillDownHints for automated exploration.
   */
  followUpQueries?: FollowUpQuery[];
  methodHints?: string[];
  methodFamilies?: string[];
  methodHintSource?: 'uc' | 'taskType' | 'intent' | 'llm';
  explanation?: string;
  coverageGaps?: string[];
  /**
   * Raw epistemic trace markers removed from user-facing fields.
   * Useful for diagnostics, verbose logs, and strict evidence checks.
   */
  epistemicsDebug?: string[];
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

  /**
   * Token budget enforcement result.
   * Present when tokenBudget was specified in the query.
   * Provides metadata about any truncation that was applied.
   */
  tokenBudgetResult?: TokenBudgetResult;

  /**
   * Edge information from graph traversal.
   * Present when edgeTypes filter is specified in the query.
   * Contains edges discovered during graph expansion, filtered by the specified types.
   *
   * This is especially useful for argument edge queries like:
   * - "What supports this decision?" (supports, warrants edges)
   * - "What contradicts this?" (contradicts, undermines, rebuts edges)
   * - "Show decision chain" (supersedes, depends_on_decision edges)
   */
  edges?: EdgeQueryResult;

  /**
   * Complete dependency enumeration result.
   * Present when exhaustive mode is enabled (explicitly or auto-detected).
   *
   * Unlike semantic search which returns top-k ranked matches, exhaustive mode
   * uses graph traversal to find ALL dependents. Critical for refactoring.
   *
   * Example: "What depends on SqliteLibrarianStorage" returns 208 files, not 6.
   */
  exhaustiveResult?: ExhaustiveQuerySummary;

  /**
   * Diagnostic information explaining why no results were returned.
   * Only present when packs.length === 0.
   *
   * Helps agents understand the root cause and take corrective action:
   * - "Vector index empty - no semantic search available"
   * - "No semantic matches for query"
   * - "Found candidates but no matching context packs"
   * - "All packs below confidence threshold"
   */
  queryDiagnostics?: QueryDiagnostics;
}

/**
 * Summary of exhaustive query results for the response.
 * Full details available via dedicated exhaustive query API.
 */
export interface ExhaustiveQuerySummary {
  /** Target entity that was queried */
  targetId: string;
  /** Query direction */
  direction: 'dependents' | 'dependencies';
  /** Total count of entities found */
  totalCount: number;
  /** Count of direct dependents/dependencies */
  directCount: number;
  /** Count of transitive dependents/dependencies */
  transitiveCount: number;
  /** Maximum depth reached in traversal */
  maxDepthReached: number;
  /** Number of dependency cycles detected */
  cycleCount: number;
  /** Whether results were truncated due to limits */
  truncated: boolean;
  /** File paths of all dependents (complete list) */
  files: string[];
  /** Files grouped by directory */
  byDirectory: Record<string, string[]>;
  /** Query duration in milliseconds */
  durationMs: number;
}

/**
 * Edge information included in query results.
 */
export interface EdgeQueryResult {
  /** Edges discovered during graph traversal */
  edges: EdgeInfo[];
  /** Edge types that were searched */
  edgeTypesSearched: string[];
  /** Total edges before filtering/limit */
  totalCount: number;
}

/**
 * Simplified edge information for query responses.
 */
export interface EdgeInfo {
  /** Edge type (e.g., 'supports', 'calls', 'imports') */
  type: string;
  /** Source entity ID */
  sourceId: string;
  /** Target entity ID */
  targetId: string;
  /** Edge weight (0-1) */
  weight: number;
  /** Edge confidence (0-1) */
  confidence: number;
  /** Whether this is an argument edge (Toulmin-IBIS type) */
  isArgumentEdge: boolean;
}

export interface OutputEnvelope {
  constructionPlan: ConstructionPlan;
  packs: ContextPack[];
  adequacy?: AdequacyReport | null;
  verificationPlan?: VerificationPlan | null;
  disclosures: string[];
  traceId: string;
}

const TRACE_MARKER_PATTERN = /^unverified_by_trace\(([^)]+)\):?\s*(.*)$/i;

interface ParsedTraceMarkerMessage {
  code?: string;
  userMessage: string;
  rawMessage: string;
}

function parseTraceMarkerMessage(message: string | undefined): ParsedTraceMarkerMessage {
  const rawMessage = String(message ?? '').trim();
  const match = rawMessage.match(TRACE_MARKER_PATTERN);
  if (!match) {
    return {
      userMessage: rawMessage,
      rawMessage,
    };
  }

  const code = (match[1] ?? '').trim();
  const detail = (match[2] ?? '').trim();
  return {
    code: code || undefined,
    userMessage: detail || code.replace(/_/g, ' '),
    rawMessage,
  };
}

function sanitizeTraceMessageList(values: string[] | undefined, debug: string[]): string[] | undefined {
  if (!Array.isArray(values)) return values;
  const seen = new Set<string>();
  const sanitized: string[] = [];
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const parsed = parseTraceMarkerMessage(value);
    if (parsed.code) debug.push(parsed.rawMessage);
    const message = parsed.userMessage.trim();
    if (!message || seen.has(message)) continue;
    seen.add(message);
    sanitized.push(message);
  }
  return sanitized;
}

function sanitizeTraceId(traceId: string | undefined, debug: string[]): string | undefined {
  if (!traceId) return traceId;
  const parsed = parseTraceMarkerMessage(traceId);
  if (parsed.code) {
    debug.push(parsed.rawMessage);
    return parsed.code;
  }
  return parsed.userMessage || traceId;
}

export function sanitizeLibrarianResponse(response: LibrarianResponse): LibrarianResponse {
  const debug = Array.isArray(response.epistemicsDebug)
    ? response.epistemicsDebug.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : [];
  const disclosures = sanitizeTraceMessageList(response.disclosures, debug) ?? [];
  const coverageGaps = sanitizeTraceMessageList(response.coverageGaps, debug);
  const methodHints = sanitizeTraceMessageList(response.methodHints, debug);
  const drillDownHints = sanitizeTraceMessageList(response.drillDownHints, debug) ?? [];
  const parsedLlmError = response.llmError ? parseTraceMarkerMessage(response.llmError) : undefined;
  const llmError = parsedLlmError?.userMessage;
  if (parsedLlmError?.code) {
    debug.push(parsedLlmError.rawMessage);
  }
  const followUpQueries = response.followUpQueries?.map((query) => ({
    ...query,
    reason: parseTraceMarkerMessage(query.reason).userMessage,
  }));
  const synthesis = response.synthesis
    ? {
      ...response.synthesis,
      uncertainties: sanitizeTraceMessageList(response.synthesis.uncertainties, debug) ?? [],
    }
    : response.synthesis;

  const sanitized = {
    ...response,
    disclosures,
    coverageGaps,
    methodHints,
    drillDownHints,
    llmError,
    traceId: sanitizeTraceId(response.traceId, debug) ?? response.traceId,
    followUpQueries,
    synthesis,
  };
  const dedupedDebug = Array.from(new Set(debug));
  if (dedupedDebug.length > 0) {
    sanitized.epistemicsDebug = dedupedDebug;
  } else {
    sanitized.epistemicsDebug = undefined;
  }
  return sanitized;
}

export function ensureOutputEnvelope(response: LibrarianResponse): LibrarianResponse & OutputEnvelope {
  const disclosures = new Set(response.disclosures ?? []);
  const epistemicsDebug = Array.isArray(response.epistemicsDebug)
    ? response.epistemicsDebug.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : [];
  let constructionPlan = response.constructionPlan;
  if (!constructionPlan) {
    disclosures.add('Construction plan missing; generated default plan.');
    epistemicsDebug.push('unverified_by_trace(construction_plan_missing)');
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
    disclosures.add('Adequacy report missing; verification completeness is unknown.');
    epistemicsDebug.push('unverified_by_trace(adequacy_missing)');
  }
  const verificationPlan = response.verificationPlan;
  if (!response.verificationPlan) {
    disclosures.add('Verification plan missing; follow-up checks may be incomplete.');
    epistemicsDebug.push('unverified_by_trace(verification_plan_missing)');
  }

  return sanitizeLibrarianResponse({
    ...response,
    constructionPlan,
    adequacy,
    verificationPlan,
    disclosures: Array.from(disclosures),
    epistemicsDebug,
  }) as LibrarianResponse & OutputEnvelope;
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
  | 'index:external_edges_resolved'
  | 'task_received'
  | 'task_phase_transition'
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
  | 'index_change'
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
  | 'safety_violation'
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

// Canonical LiBrainian aliases for migrated modules.
export type LiBrainianVersion = LibrarianVersion;
export type LiBrainianMetadata = LibrarianMetadata;
export type LiBrainianQuery = LibrarianQuery;
export type LiBrainianResponse = LibrarianResponse;
export type LiBrainianEngineResults = LibrarianEngineResults;
export type LiBrainianEventType = LibrarianEventType;
export type LiBrainianEvent = LibrarianEvent;
