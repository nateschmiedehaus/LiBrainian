/**
 * @fileoverview MCP Protocol Types for Librarian Server
 *
 * Defines typed interfaces for all MCP resources, tools, and roots
 * that Librarian exposes. Aligned with @modelcontextprotocol/sdk v1.20.0.
 *
 * Resources exposed:
 * - File tree, symbols, knowledge maps
 * - Method packs/skills
 * - Audits, provenance, repo identity
 *
 * Tools exposed:
 * - bootstrap/index/update
 * - query (with typed intent)
 * - get_context_pack_bundle
 * - verify_claim
 * - find_symbol
 * - explain_function
 * - find_usages
 * - trace_imports
 * - run_audit
 * - list_runs
 * - diff_runs
 * - export_index
 *
 * @packageDocumentation
 */

import type { VerificationPlan } from '../strategic/verification_plan.js';

// ============================================================================
// SCHEMA VERSION
// ============================================================================

export const MCP_SCHEMA_VERSION = '1.0.0';

// ============================================================================
// RESOURCE TYPES
// ============================================================================

/**
 * Base interface for all Librarian MCP resources.
 */
export interface LibrarianResource<T = unknown> {
  /** Resource URI following MCP conventions */
  uri: string;

  /** Human-readable name */
  name: string;

  /** Description for discovery */
  description: string;

  /** MIME type of the resource content */
  mimeType: string;

  /** The resource data */
  data: T;

  /** Provenance information */
  provenance: ResourceProvenance;
}

/** Provenance tracking for resources */
export interface ResourceProvenance {
  /** When this resource was generated */
  generatedAt: string;

  /** Version of the generator */
  generatorVersion: string;

  /** Hash of the source data */
  sourceHash: string;

  /** Workspace this belongs to */
  workspace: string;

  /** Git revision if available */
  revision?: string;
}

// ============================================================================
// SPECIFIC RESOURCE TYPES
// ============================================================================

/** File tree resource */
export interface FileTreeResource {
  /** Root directory */
  root: string;

  /** Total file count */
  fileCount: number;

  /** Total directory count */
  directoryCount: number;

  /** Tree structure */
  tree: FileTreeNode[];

  /** File types breakdown */
  fileTypes: Record<string, number>;
}

export interface FileTreeNode {
  /** File or directory name */
  name: string;

  /** Full path */
  path: string;

  /** Node type */
  type: 'file' | 'directory';

  /** Children (for directories) */
  children?: FileTreeNode[];

  /** File metadata (for files) */
  metadata?: {
    size: number;
    extension: string;
    category: string;
    lastModified: string;
  };
}

/** Symbols resource */
export interface SymbolsResource {
  /** Total symbol count */
  symbolCount: number;

  /** Symbols by type */
  symbols: SymbolInfo[];

  /** Symbol index by file */
  byFile: Record<string, string[]>;
}

export interface SymbolInfo {
  /** Symbol ID */
  id: string;

  /** Symbol name */
  name: string;

  /** Fully qualified name */
  qualifiedName: string;

  /** Symbol kind */
  kind: SymbolKind;

  /** Location */
  location: {
    file: string;
    startLine: number;
    endLine: number;
    startColumn?: number;
    endColumn?: number;
  };

  /** Visibility */
  visibility: 'public' | 'private' | 'protected' | 'internal';

  /** Signature (for functions) */
  signature?: string;

  /** Parent symbol ID (for nested) */
  parentId?: string;
}

export type SymbolKind =
  | 'function'
  | 'class'
  | 'interface'
  | 'type'
  | 'variable'
  | 'constant'
  | 'enum'
  | 'module'
  | 'method'
  | 'property';

/** Knowledge maps resource */
export interface KnowledgeMapsResource {
  /** Available knowledge maps */
  maps: KnowledgeMapInfo[];

  /** Total entity count */
  entityCount: number;

  /** Total edge count */
  edgeCount: number;
}

export interface KnowledgeMapInfo {
  /** Map ID */
  id: string;

  /** Map name */
  name: string;

  /** Map type */
  type: 'dependency' | 'call_graph' | 'ownership' | 'co_change' | 'semantic';

  /** Entity count in this map */
  entityCount: number;

  /** Edge count in this map */
  edgeCount: number;

  /** When last updated */
  updatedAt: string;
}

/** Method packs resource */
export interface MethodPacksResource {
  /** Available method packs */
  packs: MethodPackInfo[];

  /** Total pack count */
  packCount: number;

  /** Method families available */
  families: string[];
}

export interface MethodPackInfo {
  /** Pack ID */
  id: string;

  /** Method families in this pack */
  families: string[];

  /** Use case IDs this pack addresses */
  ucIds: string[];

  /** Intent this pack was generated for */
  intent: string | null;

  /** Confidence score */
  confidence: number;

  /** When generated */
  generatedAt: string;

  /** Hit count (cache) */
  hitCount: number;
}

/** Audits resource */
export interface AuditsResource {
  /** Recent audits */
  audits: AuditInfo[];

  /** Total audit count */
  auditCount: number;

  /** Last audit time */
  lastAuditAt?: string;
}

export interface AuditInfo {
  /** Audit ID */
  id: string;

  /** Audit type */
  type: 'bootstrap' | 'query' | 'index' | 'claim_verification' | 'security';

  /** When the audit ran */
  timestamp: string;

  /** Duration in ms */
  durationMs: number;

  /** Status */
  status: 'success' | 'failure' | 'partial';

  /** Summary */
  summary: string;

  /** Artifacts produced */
  artifactPaths: string[];
}

/** Provenance resource */
export interface ProvenanceResource {
  /** Workspace provenance */
  workspace: WorkspaceProvenance;

  /** Index provenance */
  index: IndexProvenance;

  /** Recent operations */
  recentOperations: OperationProvenance[];
}

export interface WorkspaceProvenance {
  /** Workspace path */
  path: string;

  /** Git remote URL */
  remoteUrl?: string;

  /** Current branch */
  branch?: string;

  /** Current commit */
  commit?: string;

  /** Dirty state */
  isDirty?: boolean;
}

export interface IndexProvenance {
  /** Index version */
  version: string;

  /** Schema version */
  schemaVersion: string;

  /** When indexed */
  indexedAt: string;

  /** File count */
  fileCount: number;

  /** Function count */
  functionCount: number;

  /** Total claims */
  claimCount: number;
}

export interface OperationProvenance {
  /** Operation ID */
  id: string;

  /** Operation type */
  type: string;

  /** Timestamp */
  timestamp: string;

  /** Duration ms */
  durationMs: number;

  /** Hash of inputs */
  inputHash: string;

  /** Hash of outputs */
  outputHash: string;
}

/** Repo identity resource */
export interface RepoIdentityResource {
  /** Repo name */
  name: string;

  /** Repo path */
  path: string;

  /** Detected languages */
  languages: string[];

  /** Detected frameworks */
  frameworks: string[];

  /** Package manager */
  packageManager?: string;

  /** Monorepo detection */
  isMonorepo: boolean;

  /** Workspace roots (for monorepos) */
  workspaceRoots?: string[];

  /** AGENTS.md locations */
  agentsMdLocations: string[];

  /** Skills locations */
  skillsLocations: string[];
}

// ============================================================================
// TOOL INPUT/OUTPUT TYPES
// ============================================================================

/** Query intent types */
export type QueryIntent =
  | 'understand'
  | 'debug'
  | 'refactor'
  | 'impact'
  | 'security'
  | 'test'
  | 'document'
  | 'navigate'
  | 'general';

/** Bootstrap tool input */
export interface BootstrapToolInput {
  /** Workspace to bootstrap */
  workspace: string;

  /** Force re-index even if cached */
  force?: boolean;

  /** Include patterns (globs) */
  include?: string[];

  /** Exclude patterns (globs) */
  exclude?: string[];

  /** LLM provider preference */
  llmProvider?: 'claude' | 'codex';

  /** Maximum files to index (for testing) */
  maxFiles?: number;

  /** Timeout per file in ms */
  fileTimeoutMs?: number;

  /** Max retries per file on timeout */
  fileTimeoutRetries?: number;

  /** Timeout policy after retries */
  fileTimeoutPolicy?: 'skip' | 'retry' | 'fail';
}

export interface BootstrapToolOutput {
  /** Success status */
  success: boolean;

  /** Duration in ms */
  durationMs: number;

  /** Files processed */
  filesProcessed: number;

  /** Functions indexed */
  functionsIndexed: number;

  /** Context packs created */
  contextPacksCreated: number;

  /** Errors encountered */
  errors: string[];

  /** Audit artifact path */
  auditPath: string;
}

/** Status tool input */
export interface StatusToolInput {
  /** Workspace path (optional, uses first available if not specified) */
  workspace?: string;

  /** Optional session identifier for session-scoped status details */
  sessionId?: string;

  /** Optional plan ID to retrieve a specific synthesized plan from status */
  planId?: string;
}

/** get_session_briefing tool input */
export interface GetSessionBriefingToolInput {
  /** Workspace path (optional, uses first available if not specified) */
  workspace?: string;

  /** Optional session identifier for session-scoped briefing details */
  sessionId?: string;

  /** Include construction onboarding hints in briefing output */
  includeConstructions?: boolean;
}

/** Synthesize plan tool input */
export interface SynthesizePlanToolInput {
  /** Task description to plan for */
  task: string;

  /** Context pack IDs that informed the plan */
  context_pack_ids: string[];

  /** Workspace path (optional, uses first available if not specified) */
  workspace?: string;

  /** Optional session identifier used to persist and retrieve planning state */
  sessionId?: string;
}

/** Synthesize plan tool output */
export interface SynthesizePlanToolOutput {
  /** Unique plan reference ID */
  plan_id: string;

  /** Camel-case alias for plan_id */
  planId: string;

  /** Planned task */
  task: string;

  /** Structured plan text */
  plan: string;

  /** Context pack IDs used to produce the plan */
  context_used: string[];

  /** Camel-case alias for context_used */
  contextUsed: string[];

  /** Session identifier that owns this plan */
  session_id: string;

  /** Camel-case alias for session_id */
  sessionId: string;

  /** Plan creation timestamp */
  created_at: string;

  /** Camel-case alias for created_at */
  createdAt: string;

  /** Workspace used for plan synthesis when available */
  workspace?: string;
}

/** semantic_search tool input */
export interface SemanticSearchToolInput {
  /** Localization question or concept to search for */
  query: string;

  /** Workspace path (optional, uses first ready workspace if not specified) */
  workspace?: string;

  /** Optional session identifier used for loop detection and adaptive query behavior */
  sessionId?: string;

  /** Minimum confidence threshold (0-1) */
  minConfidence?: number;

  /** Depth of context to retrieve */
  depth?: 'L0' | 'L1' | 'L2' | 'L3';

  /** Maximum results to return (maps to query pageSize, default 20, max 200) */
  limit?: number;

  /** Include engine diagnostics in output */
  includeEngines?: boolean;

  /** Include evidence metadata in output */
  includeEvidence?: boolean;
}

/** Query tool input */
export interface QueryToolInput {
  /** Goal-oriented semantic question (architecture, behavior, impact), not a direct file-read request */
  intent: string;

  /** Workspace path (optional, uses first ready workspace if not specified) */
  workspace?: string;

  /** Optional session identifier for loop detection and adaptive retrieval behavior */
  sessionId?: string;

  /** Intent mode: understand, impact, debug, refactor, security, test, document, navigate, or general */
  intentType?: QueryIntent;

  /** Affected files (for scoping) */
  affectedFiles?: string[];

  /** Minimum confidence threshold */
  minConfidence?: number;

  /** Depth of context */
  depth?: 'L0' | 'L1' | 'L2' | 'L3';

  /** Include engine results */
  includeEngines?: boolean;

  /** Include evidence graph */
  includeEvidence?: boolean;

  /** Items per page (default: 20) */
  pageSize?: number;

  /** Zero-based page index (default: 0) */
  pageIdx?: number;

  /** Write paged output payload to file and return a file reference */
  outputFile?: string;

  /** Include near-miss retrieval diagnostics */
  explainMisses?: boolean;

  /** Snake-case alias for include near-miss retrieval diagnostics */
  explain_misses?: boolean;

  /** Enable chunked stream view metadata for progressive result consumption */
  stream?: boolean;

  /** Chunk size used for stream view metadata (default: 5, max: 200) */
  streamChunkSize?: number;
}

export type RetrievalConfidenceTier = 'definitive' | 'high' | 'medium' | 'low' | 'uncertain';

export interface ConfidenceBreakdownEntry {
  tier: RetrievalConfidenceTier;
  reason: string;
}

export interface QueryToolOutput {
  /** Context packs returned */
  packs: ContextPackSummary[];

  /** Total confidence */
  totalConfidence: number;

  /** Retrieval sufficiency classification */
  retrievalStatus?: 'sufficient' | 'partial' | 'insufficient';

  /** Retrieval entropy over returned confidence distribution */
  retrievalEntropy?: number;

  /** True when retrieval quality remains insufficient after escalation */
  retrievalInsufficient?: boolean;

  /** Clarifying questions to recover from insufficient retrieval */
  suggestedClarifyingQuestions?: string[];

  /** Synthesized answer (if LLM available) */
  synthesis?: string;

  /** How synthesis was produced */
  synthesisMode?: 'llm' | 'heuristic' | 'cache';

  /** LLM synthesis error when fallback mode is active */
  llmError?: string;

  /** Verification plan for follow-up validation */
  verificationPlan?: VerificationPlan;

  /** Method hints */
  methodHints?: string[];

  /** Coverage gaps */
  coverageGaps?: string[];

  /** Optional near-miss retrieval diagnostics */
  nearMisses?: Array<{
    packId: string;
    reason: string;
  }>;

  /** Aggregate confidence signal for the full response page */
  aggregateConfidence?: {
    tier: RetrievalConfidenceTier;
    statement: string;
    highestRiskElement: string;
  };

  /** Evidence summary */
  evidenceSummary?: EvidenceSummary;

  /** Latency in ms */
  latencyMs: number;

  /** Cache hit */
  cacheHit: boolean;

  /** Repeated-query loop detection and recovery guidance */
  loopDetection?: {
    detected: boolean;
    pattern: 'identical_query' | 'semantic_repeat' | 'futile_repeat';
    occurrences: number;
    windowSeconds: number;
    message: string;
    alternativeStrategies: Array<{
      tool: 'query' | 'get_context_pack_bundle' | 'list_runs' | 'run_audit' | 'status';
      rationale: string;
      topic?: string;
    }>;
    humanReviewSuggested: boolean;
  };

  /** Optional recommendation to escalate to a human review tool call */
  humanReviewRecommendation?: {
    recommended: boolean;
    tool: 'request_human_review';
    reason: string;
    confidenceTier: 'low' | 'uncertain';
    riskLevel: 'low' | 'medium' | 'high';
    blockingSuggested: boolean;
  };

  /** True when query hit timeout budget and returned a partial payload */
  timedOut?: boolean;

  /** True when payload is intentionally partial rather than complete */
  partial?: boolean;

  /** Timeout budget used by the query execution path */
  timeoutMs?: number;

  /** Progress snapshots captured across query execution phases */
  progress?: {
    completed: boolean;
    events: Array<{
      stage: string;
      elapsedMs: number;
      timestamp: string;
      details?: Record<string, unknown>;
    }>;
  };

  /** Optional chunk metadata for agents that consume query results incrementally */
  stream?: {
    enabled: boolean;
    chunkSize: number;
    totalChunks: number;
    chunks: Array<{
      chunkIndex: number;
      packCount: number;
      packIds: string[];
    }>;
  };
}

/** Reset session state tool input */
export interface ResetSessionStateToolInput {
  /** Session ID to reset (optional if auth token is provided) */
  sessionId?: string;

  /** Optional workspace hint used for anonymous session reset fallback */
  workspace?: string;
}

/** Reset session state tool output */
export interface ResetSessionStateToolOutput {
  success: boolean;
  sessionId: string;
  clearedQueries: number;
  clearedPlans?: number;
  message: string;
}

/** Request human review tool input */
export interface RequestHumanReviewToolInput {
  /** Why human review is needed */
  reason: string;

  /** Summary of uncertain or conflicting context */
  context_summary: string;

  /** Action the agent was about to take */
  proposed_action: string;

  /** Confidence tier forcing escalation */
  confidence_tier: 'low' | 'uncertain';

  /** Risk if the action is wrong */
  risk_level: 'low' | 'medium' | 'high';

  /** Whether the agent should pause for response */
  blocking: boolean;
}

/** Request human review tool output */
export interface RequestHumanReviewToolOutput {
  review_request_id: string;
  status: 'pending' | 'advisory';
  human_readable_summary: string;
  blocking: boolean;
  expires_in_seconds: number;
}

/** List constructions tool input */
export interface ListConstructionsToolInput {
  /** Optional tags used for filtering */
  tags?: string[];

  /** Optional required capabilities filter */
  capabilities?: string[];

  /** Alias for capabilities */
  requires?: string[];

  /** Optional language filter */
  language?: string;

  /** Optional trust tier filter */
  trustTier?: 'official' | 'partner' | 'community';

  /** Only include constructions executable in this runtime */
  availableOnly?: boolean;
}

/** Invoke construction tool input */
export interface InvokeConstructionToolInput {
  /** Construction ID returned by list_constructions */
  constructionId: string;

  /** Construction input payload */
  input: unknown;

  /** Workspace used to resolve runtime dependencies */
  workspace?: string;
}

export type ConstructionOperator =
  | 'seq'
  | 'fanout'
  | 'fallback'
  | 'fix'
  | 'select'
  | 'atom'
  | 'dimap'
  | 'map'
  | 'contramap';

export type ConstructionTypeCheckOperator = 'seq' | 'fanout' | 'fallback';

/** Describe construction tool input */
export interface DescribeConstructionToolInput {
  /** Construction ID to describe */
  id: string;

  /** Include executable example in response */
  includeExample?: boolean;

  /** Include composition suggestions in response */
  includeCompositionHints?: boolean;
}

/** Explain operator tool input */
export interface ExplainOperatorToolInput {
  /** Target operator to explain */
  operator?: ConstructionOperator;

  /** Situation description used for operator recommendation */
  situation?: string;
}

/** check_construction_types tool input */
export interface CheckConstructionTypesToolInput {
  /** First construction ID */
  first: string;

  /** Second construction ID */
  second: string;

  /** Composition operator */
  operator: ConstructionTypeCheckOperator;
}

/** Change impact tool input */
export interface GetChangeImpactToolInput {
  /** Changed file/module/function identifier to analyze */
  target: string;

  /** Workspace path (optional, uses first available if not specified) */
  workspace?: string;

  /** Maximum transitive depth for propagation (default: 3) */
  depth?: number;

  /** Maximum impacted files to return (default: 200) */
  maxResults?: number;

  /** Optional change type to refine risk scoring */
  changeType?: 'modify' | 'delete' | 'rename' | 'move';
}

/** blast_radius tool input */
export interface BlastRadiusToolInput {
  /** Changed file/module/function identifier to analyze */
  target: string;

  /** Workspace path (optional, uses first available if not specified) */
  workspace?: string;

  /** Maximum transitive depth for propagation (default: 3) */
  depth?: number;

  /** Maximum impacted files to return (default: 200) */
  maxResults?: number;

  /** Optional change type to refine risk scoring */
  changeType?: 'modify' | 'delete' | 'rename' | 'move';
}

/** pre_commit_check tool input */
export interface PreCommitCheckToolInput {
  /** Changed files to evaluate before submit */
  changedFiles: string[];

  /** Workspace path (optional, uses first available if not specified) */
  workspace?: string;

  /** Enforce stricter pass criteria */
  strict?: boolean;

  /** Maximum acceptable risk level for pass */
  maxRiskLevel?: 'low' | 'medium' | 'high' | 'critical';
}

/** claim_work_scope tool input */
export interface ClaimWorkScopeToolInput {
  /** Semantic scope identifier (file, module, symbol, or task scope key) */
  scopeId: string;

  /** Workspace path (optional, used to namespace scope claims) */
  workspace?: string;

  /** Optional session identifier for ownership */
  sessionId?: string;

  /** Optional owner label (agent name/id) */
  owner?: string;

  /** Claim operation mode */
  mode?: 'claim' | 'release' | 'check';

  /** Claim expiration window in seconds (claim mode only) */
  ttlSeconds?: number;
}

export interface GetChangeImpactToolOutput {
  success: boolean;
  target: string;
  resolvedTarget?: string;
  depth: number;
  impacted: Array<{
    file: string;
    depth: number;
    direct: boolean;
    relationship: 'imports';
    impactScore: number;
    confidence: number;
    reason: string;
    reasonFlags: string[];
    testCoversChanged: boolean;
    coChangeWeight: number;
  }>;
  summary: {
    totalImpacted: number;
    directCount: number;
    transitiveCount: number;
    testsFlagged: number;
    maxImpactScore: number;
    durationMs: number;
    riskLevel?: 'low' | 'medium' | 'high' | 'critical';
    riskScore?: number;
  };
  error?: string;
}

/** Submit feedback tool input */
export interface SubmitFeedbackToolInput {
  /** Feedback token from query response */
  feedbackToken: string;

  /** Task outcome */
  outcome: 'success' | 'failure' | 'partial';

  /** Workspace path (optional, uses first available if not specified) */
  workspace?: string;

  /** Agent identifier */
  agentId?: string;

  /** Description of missing context */
  missingContext?: string;

  /** Optional per-pack ratings */
  customRatings?: Array<{
    packId: string;
    relevant: boolean;
    usefulness?: number;
    reason?: string;
  }>;
}

export interface SubmitFeedbackToolOutput {
  /** Feedback token */
  feedbackToken: string;

  /** Outcome used */
  outcome: 'success' | 'failure' | 'partial';

  /** Whether processing succeeded */
  success: boolean;

  /** Number of confidence adjustments applied */
  adjustmentsApplied: number;

  /** Error message when processing fails */
  error?: string;
}

/** Explain function tool input */
export interface ExplainFunctionToolInput {
  /** Function name or function ID */
  name: string;

  /** Optional file path for disambiguation */
  filePath?: string;

  /** Workspace path (optional, uses first available if not specified) */
  workspace?: string;
}

export interface ExplainFunctionToolOutput {
  found: boolean;
  function?: {
    id: string;
    name: string;
    signature: string;
    filePath: string;
    summary: string;
    purpose: string;
    callers: Array<{ id: string; name: string; filePath?: string }>;
    callees: Array<{ id: string; name: string; filePath?: string }>;
    confidence: number;
  };
  workspace?: string;
  error?: string;
}

/** Find usages tool input */
export interface FindUsagesToolInput {
  /** Function name or function ID */
  symbol: string;

  /** Workspace path (optional, uses first available if not specified) */
  workspace?: string;

  /** Maximum number of callsites to return */
  limit?: number;
}

export interface FindUsagesToolOutput {
  success: boolean;
  symbol: string;
  matches: Array<{
    id: string;
    name: string;
    filePath: string;
    usageCount: number;
    files: string[];
    callers: Array<{ id: string; name: string; filePath?: string }>;
  }>;
  totalMatches: number;
  workspace?: string;
  error?: string;
}

/** Trace imports tool input */
export interface TraceImportsToolInput {
  filePath: string;
  direction?: 'imports' | 'importedBy' | 'both';
  depth?: number;
  workspace?: string;
}

export interface TraceImportsToolOutput {
  success: boolean;
  filePath: string;
  resolvedFile?: string;
  direction: 'imports' | 'importedBy' | 'both';
  depth: number;
  imports: string[];
  importedBy: string[];
  edges: Array<{ from: string; to: string; direction: 'imports' | 'importedBy'; depth: number }>;
  workspace?: string;
  error?: string;
}

export interface ContextPackSummary {
  /** Pack ID */
  packId: string;

  /** Pack type */
  packType: string;

  /** Summary */
  summary: string;

  /** Confidence */
  confidence: number;

  /** Human-readable confidence tier */
  confidenceTier?: RetrievalConfidenceTier;

  /** Why this context pack was selected */
  retrievalRationale?: string;

  /** What this pack covers and what it may omit */
  coverageNote?: string;

  /** Human-readable confidence statement suitable for agent-to-human relay */
  confidenceStatement?: string;

  /** Action guidance for medium/low/uncertain confidence results */
  verificationGuidance?: string;

  /** Per-field confidence decomposition */
  confidenceBreakdown?: {
    function_signature?: ConfidenceBreakdownEntry;
    function_body?: ConfidenceBreakdownEntry;
    llm_summary?: ConfidenceBreakdownEntry;
    call_graph?: ConfidenceBreakdownEntry;
  };

  /** Related files */
  relatedFiles: string[];
}

export interface EvidenceSummary {
  /** Total claims */
  claimCount: number;

  /** Active defeaters */
  activeDefeaterCount: number;

  /** Unresolved contradictions */
  contradictionCount: number;

  /** Overall graph health */
  graphHealth: number;
}

/** Verify claim tool input */
export interface VerifyClaimToolInput {
  /** Claim ID to verify */
  claimId: string;

  /** Force re-verification */
  force?: boolean;
}

export interface VerifyClaimToolOutput {
  /** Claim ID */
  claimId: string;

  /** Verification result */
  verified: boolean;

  /** Current status */
  status: string;

  /** Confidence after verification */
  confidence: number;

  /** Active defeaters */
  defeaters: string[];

  /** Contradictions */
  contradictions: string[];

  /** Evidence checked */
  evidenceChecked: number;
}

export type FindSymbolKind =
  | 'function'
  | 'module'
  | 'context_pack'
  | 'claim'
  | 'composition'
  | 'run';

/** Find symbol tool input */
export interface FindSymbolToolInput {
  /** Human-readable symbol query */
  query: string;

  /** Optional category filter */
  kind?: FindSymbolKind;

  /** Workspace path (optional, uses first available if not specified) */
  workspace?: string;

  /** Maximum matches to return (default: 20) */
  limit?: number;
}

export interface FindSymbolMatch {
  /** Opaque ID for downstream tools */
  id: string;

  /** Match category */
  kind: FindSymbolKind;

  /** Human-readable name */
  name: string;

  /** Source file path when available */
  filePath?: string;

  /** Match confidence score (0-1) */
  score: number;

  /** Optional short description */
  description?: string;
}

export interface FindSymbolToolOutput {
  success: boolean;
  query: string;
  kind: FindSymbolKind | 'any';
  matches: FindSymbolMatch[];
  totalMatches: number;
  workspace?: string;
  error?: string;
}

/** Run audit tool input */
export interface RunAuditToolInput {
  /** Audit type */
  type: 'full' | 'claims' | 'coverage' | 'security' | 'freshness';

  /** Scope (file paths or patterns) */
  scope?: string[];

  /** Generate report */
  generateReport?: boolean;
}

export interface RunAuditToolOutput {
  /** Audit ID */
  auditId: string;

  /** Status */
  status: 'success' | 'failure' | 'partial';

  /** Duration ms */
  durationMs: number;

  /** Findings */
  findings: AuditFinding[];

  /** Report path (if generated) */
  reportPath?: string;

  /** Summary statistics */
  stats: {
    totalChecks: number;
    passed: number;
    failed: number;
    warnings: number;
  };
}

export interface AuditFinding {
  /** Finding ID */
  id: string;

  /** Severity */
  severity: 'error' | 'warning' | 'info';

  /** Category */
  category: string;

  /** Message */
  message: string;

  /** Location (if applicable) */
  location?: {
    file: string;
    line?: number;
  };

  /** Remediation hint */
  remediation?: string;
}

/** List runs tool input */
export interface ListRunsToolInput {
  /** Workspace path (optional, uses first available if not specified) */
  workspace?: string;

  /** Maximum runs to return */
  limit?: number;
}

/** Diff runs tool input */
export interface DiffRunsToolInput {
  /** Workspace path to resolve persisted run history */
  workspace?: string;

  /** First run ID */
  runIdA: string;

  /** Second run ID */
  runIdB: string;

  /** Include detailed diff */
  detailed?: boolean;
}

export interface DiffRunsToolOutput {
  /** Diff summary */
  summary: string;

  /** Claims added */
  claimsAdded: number;

  /** Claims removed */
  claimsRemoved: number;

  /** Claims modified */
  claimsModified: number;

  /** Confidence delta */
  confidenceDelta: number;

  /** Detailed diffs (if requested) */
  details?: RunDiff[];
}

export interface RunDiff {
  /** Entity ID */
  entityId: string;

  /** Change type */
  changeType: 'added' | 'removed' | 'modified';

  /** Before state (if applicable) */
  before?: unknown;

  /** After state (if applicable) */
  after?: unknown;
}

/** Export index tool input */
export interface ExportIndexToolInput {
  /** Export format */
  format: 'json' | 'sqlite' | 'scip' | 'lsif';

  /** Output path */
  outputPath: string;

  /** Include embeddings */
  includeEmbeddings?: boolean;

  /** Scope (file patterns) */
  scope?: string[];
}

export interface ExportIndexToolOutput {
  /** Success status */
  success: boolean;

  /** Output path */
  outputPath: string;

  /** File size in bytes */
  fileSizeBytes: number;

  /** Entity count exported */
  entityCount: number;

  /** Duration ms */
  durationMs: number;
}

/** Context pack bundle tool input */
export interface GetContextPackBundleToolInput {
  /** Target entity IDs */
  entityIds: string[];

  /** Bundle type */
  bundleType?: 'minimal' | 'standard' | 'comprehensive';

  /** Max token budget */
  maxTokens?: number;

  /** Items per page (default: 20) */
  pageSize?: number;

  /** Zero-based page index (default: 0) */
  pageIdx?: number;

  /** Write paged output payload to file and return a file reference */
  outputFile?: string;
}

export interface GetContextPackBundleToolOutput {
  /** Bundle ID */
  bundleId: string;

  /** Included packs */
  packs: ContextPackSummary[];

  /** Total tokens */
  totalTokens: number;

  /** Truncated */
  truncated: boolean;

  /** Missing entities */
  missingEntities: string[];

  /** Coverage gaps for the paged bundle response */
  coverageGaps?: string[];

  /** Aggregate confidence signal for the full response page */
  aggregateConfidence?: {
    tier: RetrievalConfidenceTier;
    statement: string;
    highestRiskElement: string;
  };
}

/** System contract tool input */
export interface SystemContractToolInput {
  /** Workspace path (optional, uses first available if not specified) */
  workspace?: string;
}

/** Self-diagnosis tool input */
export interface DiagnoseSelfToolInput {
  /** Workspace path (optional, uses first available if not specified) */
  workspace?: string;
}

/** List verification plans tool input */
export interface ListVerificationPlansToolInput {
  /** Workspace path (optional, uses first available if not specified) */
  workspace?: string;

  /** Limit number of plans returned */
  limit?: number;

  /** Items per page (default: 20) */
  pageSize?: number;

  /** Zero-based page index (default: 0) */
  pageIdx?: number;

  /** Write paged output payload to file and return a file reference */
  outputFile?: string;
}

/** List episodes tool input */
export interface ListEpisodesToolInput {
  /** Workspace path (optional, uses first available if not specified) */
  workspace?: string;

  /** Limit number of episodes returned */
  limit?: number;

  /** Items per page (default: 20) */
  pageSize?: number;

  /** Zero-based page index (default: 0) */
  pageIdx?: number;

  /** Write paged output payload to file and return a file reference */
  outputFile?: string;
}

/** List technique primitives tool input */
export interface ListTechniquePrimitivesToolInput {
  /** Workspace path (optional, uses first available if not specified) */
  workspace?: string;

  /** Limit number of primitives returned */
  limit?: number;

  /** Items per page (default: 20) */
  pageSize?: number;

  /** Zero-based page index (default: 0) */
  pageIdx?: number;

  /** Write paged output payload to file and return a file reference */
  outputFile?: string;
}

/** List technique compositions tool input */
export interface ListTechniqueCompositionsToolInput {
  /** Workspace path (optional, uses first available if not specified) */
  workspace?: string;

  /** Limit number of compositions returned */
  limit?: number;

  /** Items per page (default: 20) */
  pageSize?: number;

  /** Zero-based page index (default: 0) */
  pageIdx?: number;

  /** Write paged output payload to file and return a file reference */
  outputFile?: string;
}

/** Select technique compositions tool input */
export interface SelectTechniqueCompositionsToolInput {
  /** Intent or goal to select compositions for */
  intent: string;

  /** Workspace path (optional, uses first available if not specified) */
  workspace?: string;

  /** Limit number of compositions returned */
  limit?: number;
}

/** Compile technique composition tool input */
export interface CompileTechniqueCompositionToolInput {
  /** Technique composition ID to compile */
  compositionId: string;

  /** Workspace path (optional, uses first available if not specified) */
  workspace?: string;

  /** Include primitive definitions in output */
  includePrimitives?: boolean;
}

/** Compile intent bundles tool input */
export interface CompileIntentBundlesToolInput {
  /** Intent to compile into technique bundles */
  intent: string;

  /** Workspace path (optional, uses first available if not specified) */
  workspace?: string;

  /** Limit number of bundles returned */
  limit?: number;

  /** Include primitive definitions in output */
  includePrimitives?: boolean;
}

// ============================================================================
// AUTHORIZATION TYPES
// ============================================================================

/** Authorization scope for MCP operations */
export type AuthorizationScope =
  | 'read'              // Read-only access
  | 'write'             // Can modify files
  | 'execute'           // Can execute code
  | 'network'           // Can access network
  | 'admin';            // Full administrative access

/** Authorization requirement for a tool */
export interface ToolAuthorization {
  /** Tool name */
  tool: string;

  /** Required scopes */
  requiredScopes: AuthorizationScope[];

  /** Requires user consent */
  requiresConsent: boolean;

  /** Consent message */
  consentMessage?: string;

  /** Risk level */
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
}

/** Authorization matrix for all tools */
export const TOOL_AUTHORIZATION: Record<string, ToolAuthorization> = {
  bootstrap: {
    tool: 'bootstrap',
    requiredScopes: ['read', 'write'],
    requiresConsent: true,
    consentMessage: 'Bootstrap will index the workspace and write to .librarian directory',
    riskLevel: 'medium',
  },
  get_session_briefing: {
    tool: 'get_session_briefing',
    requiredScopes: ['read'],
    requiresConsent: false,
    riskLevel: 'low',
  },
  semantic_search: {
    tool: 'semantic_search',
    requiredScopes: ['read'],
    requiresConsent: false,
    riskLevel: 'low',
  },
  query: {
    tool: 'query',
    requiredScopes: ['read'],
    requiresConsent: false,
    riskLevel: 'low',
  },
  synthesize_plan: {
    tool: 'synthesize_plan',
    requiredScopes: ['read'],
    requiresConsent: false,
    riskLevel: 'low',
  },
  reset_session_state: {
    tool: 'reset_session_state',
    requiredScopes: ['read'],
    requiresConsent: false,
    riskLevel: 'low',
  },
  request_human_review: {
    tool: 'request_human_review',
    requiredScopes: ['read', 'write'],
    requiresConsent: false,
    riskLevel: 'low',
  },
  list_constructions: {
    tool: 'list_constructions',
    requiredScopes: ['read'],
    requiresConsent: false,
    riskLevel: 'low',
  },
  invoke_construction: {
    tool: 'invoke_construction',
    requiredScopes: ['read'],
    requiresConsent: false,
    riskLevel: 'medium',
  },
  describe_construction: {
    tool: 'describe_construction',
    requiredScopes: ['read'],
    requiresConsent: false,
    riskLevel: 'low',
  },
  explain_operator: {
    tool: 'explain_operator',
    requiredScopes: ['read'],
    requiresConsent: false,
    riskLevel: 'low',
  },
  check_construction_types: {
    tool: 'check_construction_types',
    requiredScopes: ['read'],
    requiresConsent: false,
    riskLevel: 'low',
  },
  get_change_impact: {
    tool: 'get_change_impact',
    requiredScopes: ['read'],
    requiresConsent: false,
    riskLevel: 'low',
  },
  blast_radius: {
    tool: 'blast_radius',
    requiredScopes: ['read'],
    requiresConsent: false,
    riskLevel: 'low',
  },
  pre_commit_check: {
    tool: 'pre_commit_check',
    requiredScopes: ['read'],
    requiresConsent: false,
    riskLevel: 'low',
  },
  claim_work_scope: {
    tool: 'claim_work_scope',
    requiredScopes: ['read'],
    requiresConsent: false,
    riskLevel: 'low',
  },
  submit_feedback: {
    tool: 'submit_feedback',
    requiredScopes: ['read', 'write'],
    requiresConsent: false,
    riskLevel: 'low',
  },
  explain_function: {
    tool: 'explain_function',
    requiredScopes: ['read'],
    requiresConsent: false,
    riskLevel: 'low',
  },
  find_usages: {
    tool: 'find_usages',
    requiredScopes: ['read'],
    requiresConsent: false,
    riskLevel: 'low',
  },
  trace_imports: {
    tool: 'trace_imports',
    requiredScopes: ['read'],
    requiresConsent: false,
    riskLevel: 'low',
  },
  get_context_pack_bundle: {
    tool: 'get_context_pack_bundle',
    requiredScopes: ['read'],
    requiresConsent: false,
    riskLevel: 'low',
  },
  verify_claim: {
    tool: 'verify_claim',
    requiredScopes: ['read'],
    requiresConsent: false,
    riskLevel: 'low',
  },
  find_symbol: {
    tool: 'find_symbol',
    requiredScopes: ['read'],
    requiresConsent: false,
    riskLevel: 'low',
  },
  run_audit: {
    tool: 'run_audit',
    requiredScopes: ['read', 'write'],
    requiresConsent: true,
    consentMessage: 'Audit will analyze codebase and write reports',
    riskLevel: 'low',
  },
  list_runs: {
    tool: 'list_runs',
    requiredScopes: ['read'],
    requiresConsent: false,
    riskLevel: 'low',
  },
  diff_runs: {
    tool: 'diff_runs',
    requiredScopes: ['read'],
    requiresConsent: false,
    riskLevel: 'low',
  },
  system_contract: {
    tool: 'system_contract',
    requiredScopes: ['read'],
    requiresConsent: false,
    riskLevel: 'low',
  },
  diagnose_self: {
    tool: 'diagnose_self',
    requiredScopes: ['read'],
    requiresConsent: false,
    riskLevel: 'low',
  },
  list_verification_plans: {
    tool: 'list_verification_plans',
    requiredScopes: ['read'],
    requiresConsent: false,
    riskLevel: 'low',
  },
  list_episodes: {
    tool: 'list_episodes',
    requiredScopes: ['read'],
    requiresConsent: false,
    riskLevel: 'low',
  },
  list_technique_primitives: {
    tool: 'list_technique_primitives',
    requiredScopes: ['read'],
    requiresConsent: false,
    riskLevel: 'low',
  },
  list_technique_compositions: {
    tool: 'list_technique_compositions',
    requiredScopes: ['read'],
    requiresConsent: false,
    riskLevel: 'low',
  },
  select_technique_compositions: {
    tool: 'select_technique_compositions',
    requiredScopes: ['read'],
    requiresConsent: false,
    riskLevel: 'low',
  },
  compile_technique_composition: {
    tool: 'compile_technique_composition',
    requiredScopes: ['read'],
    requiresConsent: false,
    riskLevel: 'low',
  },
  compile_intent_bundles: {
    tool: 'compile_intent_bundles',
    requiredScopes: ['read'],
    requiresConsent: false,
    riskLevel: 'low',
  },
  export_index: {
    tool: 'export_index',
    requiredScopes: ['read', 'write'],
    requiresConsent: true,
    consentMessage: 'Export will write index data to specified path',
    riskLevel: 'medium',
  },
};

// ============================================================================
// MCP SERVER CONFIGURATION
// ============================================================================

/** MCP server configuration */
export interface LibrarianMCPServerConfig {
  /** Server name */
  name: string;

  /** Server version */
  version: string;

  /** Workspace roots to serve */
  workspaces: string[];

  /** Authorization settings */
  authorization: {
    /** Enabled scopes */
    enabledScopes: AuthorizationScope[];

    /** Require consent for high-risk operations */
    requireConsent: boolean;

    /** Allowed origins (for network access) */
    allowedOrigins?: string[];
  };

  /** Audit settings */
  audit: {
    /** Enable audit logging */
    enabled: boolean;

    /** Audit log path */
    logPath: string;

    /** Retention days */
    retentionDays: number;
  };

  /** Performance settings */
  performance: {
    /** Max concurrent operations */
    maxConcurrent: number;

    /** Request timeout ms */
    timeoutMs: number;

    /** Enable caching */
    cacheEnabled: boolean;
  };

  /** Auto-watch settings */
  autoWatch: {
    /** Enable file watching for automatic reindexing */
    enabled: boolean;

    /** Debounce interval in ms for file change events */
    debounceMs: number;
  };

  /** Loop detection and recovery settings */
  loopDetection: {
    /** Enable repeated-query loop detection */
    enabled: boolean;

    /** Detection window in seconds */
    windowSeconds: number;

    /** Fire identical query warnings after this many occurrences */
    exactRepeatThreshold: number;

    /** Fire semantic repeat warnings after this many occurrences */
    semanticRepeatThreshold: number;

    /** Fire futile repeat strategy escalation after this many zero-result repeats */
    futileRepeatThreshold: number;

    /** Maximum query records to retain per session */
    maxSessionHistory: number;

    /** Whether to auto-adjust retrieval strategy on repeated futile queries */
    autoEscalateStrategy: boolean;
  };

  /** Human review escalation settings */
  humanReview: {
    /** Threshold in minutes where stale index should trigger recommendation for write-intent queries */
    staleIndexThresholdMinutes: number;

    /** Default expiration timeout included in review requests */
    defaultReviewTimeoutSeconds: number;
  };

  /** Confidence UX settings for retrieval responses */
  confidenceUx: {
    /** Score thresholds used to classify confidence tiers */
    thresholds: {
      definitiveMin: number;
      highMin: number;
      mediumMin: number;
      lowMin: number;
    };
  };
}

/** Default server configuration */
export const DEFAULT_MCP_SERVER_CONFIG: LibrarianMCPServerConfig = {
  name: 'librarian-mcp-server',
  version: MCP_SCHEMA_VERSION,
  workspaces: [],
  authorization: {
    enabledScopes: ['read'],
    requireConsent: true,
  },
  audit: {
    enabled: true,
    logPath: '.librarian/audit/mcp',
    retentionDays: 30,
  },
  performance: {
    maxConcurrent: 10,
    timeoutMs: 30000,
    cacheEnabled: true,
  },
  autoWatch: {
    enabled: true,
    debounceMs: 200,
  },
  loopDetection: {
    enabled: true,
    windowSeconds: 60,
    exactRepeatThreshold: 2,
    semanticRepeatThreshold: 3,
    futileRepeatThreshold: 2,
    maxSessionHistory: 20,
    autoEscalateStrategy: true,
  },
  humanReview: {
    staleIndexThresholdMinutes: 30,
    defaultReviewTimeoutSeconds: 300,
  },
  confidenceUx: {
    thresholds: {
      definitiveMin: 0.95,
      highMin: 0.85,
      mediumMin: 0.7,
      lowMin: 0.5,
    },
  },
};

// ============================================================================
// TYPE GUARDS
// ============================================================================

/** Type guard for BootstrapToolInput */
export function isBootstrapToolInput(value: unknown): value is BootstrapToolInput {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.workspace === 'string';
}

/** Type guard for GetSessionBriefingToolInput */
export function isGetSessionBriefingToolInput(value: unknown): value is GetSessionBriefingToolInput {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  const workspaceOk = typeof obj.workspace === 'string' || typeof obj.workspace === 'undefined';
  const sessionIdOk = typeof obj.sessionId === 'string' || typeof obj.sessionId === 'undefined';
  const includeConstructionsOk = typeof obj.includeConstructions === 'boolean' || typeof obj.includeConstructions === 'undefined';
  return workspaceOk && sessionIdOk && includeConstructionsOk;
}

/** Type guard for SemanticSearchToolInput */
export function isSemanticSearchToolInput(value: unknown): value is SemanticSearchToolInput {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  const queryOk = typeof obj.query === 'string';
  const workspaceOk = typeof obj.workspace === 'string' || typeof obj.workspace === 'undefined';
  const sessionIdOk = typeof obj.sessionId === 'string' || typeof obj.sessionId === 'undefined';
  const minConfidenceOk = typeof obj.minConfidence === 'number' || typeof obj.minConfidence === 'undefined';
  const depthOk = obj.depth === 'L0'
    || obj.depth === 'L1'
    || obj.depth === 'L2'
    || obj.depth === 'L3'
    || typeof obj.depth === 'undefined';
  const limitOk = typeof obj.limit === 'number' || typeof obj.limit === 'undefined';
  const includeEnginesOk = typeof obj.includeEngines === 'boolean' || typeof obj.includeEngines === 'undefined';
  const includeEvidenceOk = typeof obj.includeEvidence === 'boolean' || typeof obj.includeEvidence === 'undefined';
  return queryOk
    && workspaceOk
    && sessionIdOk
    && minConfidenceOk
    && depthOk
    && limitOk
    && includeEnginesOk
    && includeEvidenceOk;
}

/** Type guard for QueryToolInput */
export function isQueryToolInput(value: unknown): value is QueryToolInput {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  const intentOk = typeof obj.intent === 'string';
  const sessionIdOk = typeof obj.sessionId === 'string' || typeof obj.sessionId === 'undefined';
  const pageSizeOk = typeof obj.pageSize === 'number' || typeof obj.pageSize === 'undefined';
  const pageIdxOk = typeof obj.pageIdx === 'number' || typeof obj.pageIdx === 'undefined';
  const outputFileOk = typeof obj.outputFile === 'string' || typeof obj.outputFile === 'undefined';
  const explainMissesOk = typeof obj.explainMisses === 'boolean' || typeof obj.explainMisses === 'undefined';
  const explainMissesAliasOk = typeof obj.explain_misses === 'boolean' || typeof obj.explain_misses === 'undefined';
  const streamOk = typeof obj.stream === 'boolean' || typeof obj.stream === 'undefined';
  const streamChunkSizeOk = typeof obj.streamChunkSize === 'number' || typeof obj.streamChunkSize === 'undefined';
  return intentOk
    && sessionIdOk
    && pageSizeOk
    && pageIdxOk
    && outputFileOk
    && explainMissesOk
    && explainMissesAliasOk
    && streamOk
    && streamChunkSizeOk;
}

/** Type guard for SynthesizePlanToolInput */
export function isSynthesizePlanToolInput(value: unknown): value is SynthesizePlanToolInput {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  const taskOk = typeof obj.task === 'string' && obj.task.trim().length > 0;
  const contextOk = Array.isArray(obj.context_pack_ids)
    && obj.context_pack_ids.length > 0
    && obj.context_pack_ids.every((entry) => typeof entry === 'string' && entry.length > 0);
  const workspaceOk = typeof obj.workspace === 'string' || typeof obj.workspace === 'undefined';
  const sessionIdOk = typeof obj.sessionId === 'string' || typeof obj.sessionId === 'undefined';
  return taskOk && contextOk && workspaceOk && sessionIdOk;
}

/** Type guard for ResetSessionStateToolInput */
export function isResetSessionStateToolInput(value: unknown): value is ResetSessionStateToolInput {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  const sessionIdOk = typeof obj.sessionId === 'string' || typeof obj.sessionId === 'undefined';
  const workspaceOk = typeof obj.workspace === 'string' || typeof obj.workspace === 'undefined';
  return sessionIdOk && workspaceOk;
}

/** Type guard for RequestHumanReviewToolInput */
export function isRequestHumanReviewToolInput(value: unknown): value is RequestHumanReviewToolInput {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  const reasonOk = typeof obj.reason === 'string';
  const summaryOk = typeof obj.context_summary === 'string';
  const actionOk = typeof obj.proposed_action === 'string';
  const confidenceOk = obj.confidence_tier === 'low' || obj.confidence_tier === 'uncertain';
  const riskOk = obj.risk_level === 'low' || obj.risk_level === 'medium' || obj.risk_level === 'high';
  const blockingOk = typeof obj.blocking === 'boolean';
  return reasonOk && summaryOk && actionOk && confidenceOk && riskOk && blockingOk;
}

/** Type guard for ListConstructionsToolInput */
export function isListConstructionsToolInput(value: unknown): value is ListConstructionsToolInput {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  const tagsOk = (
    Array.isArray(obj.tags)
    && obj.tags.every((entry) => typeof entry === 'string')
  ) || typeof obj.tags === 'undefined';
  const capabilitiesOk = (
    Array.isArray(obj.capabilities)
    && obj.capabilities.every((entry) => typeof entry === 'string')
  ) || typeof obj.capabilities === 'undefined';
  const requiresOk = (
    Array.isArray(obj.requires)
    && obj.requires.every((entry) => typeof entry === 'string')
  ) || typeof obj.requires === 'undefined';
  const languageOk = typeof obj.language === 'string' || typeof obj.language === 'undefined';
  const trustTierOk = obj.trustTier === 'official'
    || obj.trustTier === 'partner'
    || obj.trustTier === 'community'
    || typeof obj.trustTier === 'undefined';
  const availableOnlyOk = typeof obj.availableOnly === 'boolean' || typeof obj.availableOnly === 'undefined';
  return tagsOk && capabilitiesOk && requiresOk && languageOk && trustTierOk && availableOnlyOk;
}

/** Type guard for InvokeConstructionToolInput */
export function isInvokeConstructionToolInput(value: unknown): value is InvokeConstructionToolInput {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  const constructionIdOk = typeof obj.constructionId === 'string';
  const inputOk = Object.prototype.hasOwnProperty.call(obj, 'input');
  const workspaceOk = typeof obj.workspace === 'string' || typeof obj.workspace === 'undefined';
  return constructionIdOk && inputOk && workspaceOk;
}

/** Type guard for DescribeConstructionToolInput */
export function isDescribeConstructionToolInput(value: unknown): value is DescribeConstructionToolInput {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  const idOk = typeof obj.id === 'string' && obj.id.trim().length > 0;
  const includeExampleOk = typeof obj.includeExample === 'boolean' || typeof obj.includeExample === 'undefined';
  const includeHintsOk = typeof obj.includeCompositionHints === 'boolean' || typeof obj.includeCompositionHints === 'undefined';
  return idOk && includeExampleOk && includeHintsOk;
}

/** Type guard for ExplainOperatorToolInput */
export function isExplainOperatorToolInput(value: unknown): value is ExplainOperatorToolInput {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  const operatorOk = obj.operator === 'seq'
    || obj.operator === 'fanout'
    || obj.operator === 'fallback'
    || obj.operator === 'fix'
    || obj.operator === 'select'
    || obj.operator === 'atom'
    || obj.operator === 'dimap'
    || obj.operator === 'map'
    || obj.operator === 'contramap'
    || typeof obj.operator === 'undefined';
  const situationOk = typeof obj.situation === 'string' || typeof obj.situation === 'undefined';
  const hasInput = (typeof obj.operator === 'string' && obj.operator.length > 0)
    || (typeof obj.situation === 'string' && obj.situation.trim().length > 0);
  return operatorOk && situationOk && hasInput;
}

/** Type guard for CheckConstructionTypesToolInput */
export function isCheckConstructionTypesToolInput(value: unknown): value is CheckConstructionTypesToolInput {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  const firstOk = typeof obj.first === 'string' && obj.first.trim().length > 0;
  const secondOk = typeof obj.second === 'string' && obj.second.trim().length > 0;
  const operatorOk = obj.operator === 'seq' || obj.operator === 'fanout' || obj.operator === 'fallback';
  return firstOk && secondOk && operatorOk;
}

/** Type guard for GetChangeImpactToolInput */
export function isGetChangeImpactToolInput(value: unknown): value is GetChangeImpactToolInput {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  const targetOk = typeof obj.target === 'string';
  const workspaceOk = typeof obj.workspace === 'string' || typeof obj.workspace === 'undefined';
  const depthOk = typeof obj.depth === 'number' || typeof obj.depth === 'undefined';
  const maxResultsOk = typeof obj.maxResults === 'number' || typeof obj.maxResults === 'undefined';
  const changeTypeOk = obj.changeType === 'modify' || obj.changeType === 'delete' || obj.changeType === 'rename' || obj.changeType === 'move' || typeof obj.changeType === 'undefined';
  return targetOk && workspaceOk && depthOk && maxResultsOk && changeTypeOk;
}

/** Type guard for BlastRadiusToolInput */
export function isBlastRadiusToolInput(value: unknown): value is BlastRadiusToolInput {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  const targetOk = typeof obj.target === 'string';
  const workspaceOk = typeof obj.workspace === 'string' || typeof obj.workspace === 'undefined';
  const depthOk = typeof obj.depth === 'number' || typeof obj.depth === 'undefined';
  const maxResultsOk = typeof obj.maxResults === 'number' || typeof obj.maxResults === 'undefined';
  const changeTypeOk = obj.changeType === 'modify' || obj.changeType === 'delete' || obj.changeType === 'rename' || obj.changeType === 'move' || typeof obj.changeType === 'undefined';
  return targetOk && workspaceOk && depthOk && maxResultsOk && changeTypeOk;
}

/** Type guard for PreCommitCheckToolInput */
export function isPreCommitCheckToolInput(value: unknown): value is PreCommitCheckToolInput {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  const changedFilesOk = Array.isArray(obj.changedFiles)
    && obj.changedFiles.every((entry) => typeof entry === 'string');
  const workspaceOk = typeof obj.workspace === 'string' || typeof obj.workspace === 'undefined';
  const strictOk = typeof obj.strict === 'boolean' || typeof obj.strict === 'undefined';
  const maxRiskLevelOk = obj.maxRiskLevel === 'low'
    || obj.maxRiskLevel === 'medium'
    || obj.maxRiskLevel === 'high'
    || obj.maxRiskLevel === 'critical'
    || typeof obj.maxRiskLevel === 'undefined';
  return changedFilesOk && workspaceOk && strictOk && maxRiskLevelOk;
}

/** Type guard for ClaimWorkScopeToolInput */
export function isClaimWorkScopeToolInput(value: unknown): value is ClaimWorkScopeToolInput {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  const scopeIdOk = typeof obj.scopeId === 'string';
  const workspaceOk = typeof obj.workspace === 'string' || typeof obj.workspace === 'undefined';
  const sessionIdOk = typeof obj.sessionId === 'string' || typeof obj.sessionId === 'undefined';
  const ownerOk = typeof obj.owner === 'string' || typeof obj.owner === 'undefined';
  const modeOk = obj.mode === 'claim'
    || obj.mode === 'release'
    || obj.mode === 'check'
    || typeof obj.mode === 'undefined';
  const ttlOk = typeof obj.ttlSeconds === 'number' || typeof obj.ttlSeconds === 'undefined';
  return scopeIdOk && workspaceOk && sessionIdOk && ownerOk && modeOk && ttlOk;
}

/** Type guard for SubmitFeedbackToolInput */
export function isSubmitFeedbackToolInput(value: unknown): value is SubmitFeedbackToolInput {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  const tokenOk = typeof obj.feedbackToken === 'string';
  const outcomeOk = obj.outcome === 'success' || obj.outcome === 'failure' || obj.outcome === 'partial';
  const workspaceOk = typeof obj.workspace === 'string' || typeof obj.workspace === 'undefined';
  const agentIdOk = typeof obj.agentId === 'string' || typeof obj.agentId === 'undefined';
  const missingContextOk = typeof obj.missingContext === 'string' || typeof obj.missingContext === 'undefined';
  const ratingsOk = Array.isArray(obj.customRatings) || typeof obj.customRatings === 'undefined';
  return tokenOk && outcomeOk && workspaceOk && agentIdOk && missingContextOk && ratingsOk;
}

/** Type guard for ExplainFunctionToolInput */
export function isExplainFunctionToolInput(value: unknown): value is ExplainFunctionToolInput {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  const nameOk = typeof obj.name === 'string';
  const filePathOk = typeof obj.filePath === 'string' || typeof obj.filePath === 'undefined';
  const workspaceOk = typeof obj.workspace === 'string' || typeof obj.workspace === 'undefined';
  return nameOk && filePathOk && workspaceOk;
}

/** Type guard for FindUsagesToolInput */
export function isFindUsagesToolInput(value: unknown): value is FindUsagesToolInput {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  const symbolOk = typeof obj.symbol === 'string';
  const workspaceOk = typeof obj.workspace === 'string' || typeof obj.workspace === 'undefined';
  const limitOk = typeof obj.limit === 'number' || typeof obj.limit === 'undefined';
  return symbolOk && workspaceOk && limitOk;
}

/** Type guard for TraceImportsToolInput */
export function isTraceImportsToolInput(value: unknown): value is TraceImportsToolInput {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  const filePathOk = typeof obj.filePath === 'string';
  const directionOk = obj.direction === 'imports'
    || obj.direction === 'importedBy'
    || obj.direction === 'both'
    || typeof obj.direction === 'undefined';
  const depthOk = typeof obj.depth === 'number' || typeof obj.depth === 'undefined';
  const workspaceOk = typeof obj.workspace === 'string' || typeof obj.workspace === 'undefined';
  return filePathOk && directionOk && depthOk && workspaceOk;
}

/** Type guard for VerifyClaimToolInput */
export function isVerifyClaimToolInput(value: unknown): value is VerifyClaimToolInput {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.claimId === 'string';
}

/** Type guard for FindSymbolToolInput */
export function isFindSymbolToolInput(value: unknown): value is FindSymbolToolInput {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  const queryOk = typeof obj.query === 'string';
  const kindOk = obj.kind === 'function'
    || obj.kind === 'module'
    || obj.kind === 'context_pack'
    || obj.kind === 'claim'
    || obj.kind === 'composition'
    || obj.kind === 'run'
    || typeof obj.kind === 'undefined';
  const workspaceOk = typeof obj.workspace === 'string' || typeof obj.workspace === 'undefined';
  const limitOk = typeof obj.limit === 'number' || typeof obj.limit === 'undefined';
  return queryOk && kindOk && workspaceOk && limitOk;
}

/** Type guard for RunAuditToolInput */
export function isRunAuditToolInput(value: unknown): value is RunAuditToolInput {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.type === 'string';
}

/** Type guard for DiffRunsToolInput */
export function isDiffRunsToolInput(value: unknown): value is DiffRunsToolInput {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  const workspaceOk = typeof obj.workspace === 'string' || typeof obj.workspace === 'undefined';
  return workspaceOk && typeof obj.runIdA === 'string' && typeof obj.runIdB === 'string';
}

/** Type guard for ListRunsToolInput */
export function isListRunsToolInput(value: unknown): value is ListRunsToolInput {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  const workspaceOk = typeof obj.workspace === 'string' || typeof obj.workspace === 'undefined';
  const limitOk = typeof obj.limit === 'number' || typeof obj.limit === 'undefined';
  return workspaceOk && limitOk;
}

/** Type guard for ExportIndexToolInput */
export function isExportIndexToolInput(value: unknown): value is ExportIndexToolInput {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.format === 'string' && typeof obj.outputPath === 'string';
}

/** Type guard for GetContextPackBundleToolInput */
export function isGetContextPackBundleToolInput(value: unknown): value is GetContextPackBundleToolInput {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  const entityIdsOk = Array.isArray(obj.entityIds);
  const pageSizeOk = typeof obj.pageSize === 'number' || typeof obj.pageSize === 'undefined';
  const pageIdxOk = typeof obj.pageIdx === 'number' || typeof obj.pageIdx === 'undefined';
  const outputFileOk = typeof obj.outputFile === 'string' || typeof obj.outputFile === 'undefined';
  return entityIdsOk && pageSizeOk && pageIdxOk && outputFileOk;
}

/** Type guard for SystemContractToolInput */
export function isSystemContractToolInput(value: unknown): value is SystemContractToolInput {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.workspace === 'string' || typeof obj.workspace === 'undefined';
}

/** Type guard for DiagnoseSelfToolInput */
export function isDiagnoseSelfToolInput(value: unknown): value is DiagnoseSelfToolInput {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.workspace === 'string' || typeof obj.workspace === 'undefined';
}

/** Type guard for ListVerificationPlansToolInput */
export function isListVerificationPlansToolInput(value: unknown): value is ListVerificationPlansToolInput {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  const workspaceOk = typeof obj.workspace === 'string' || typeof obj.workspace === 'undefined';
  const limitOk = typeof obj.limit === 'number' || typeof obj.limit === 'undefined';
  const pageSizeOk = typeof obj.pageSize === 'number' || typeof obj.pageSize === 'undefined';
  const pageIdxOk = typeof obj.pageIdx === 'number' || typeof obj.pageIdx === 'undefined';
  const outputFileOk = typeof obj.outputFile === 'string' || typeof obj.outputFile === 'undefined';
  return workspaceOk && limitOk && pageSizeOk && pageIdxOk && outputFileOk;
}

/** Type guard for ListEpisodesToolInput */
export function isListEpisodesToolInput(value: unknown): value is ListEpisodesToolInput {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  const workspaceOk = typeof obj.workspace === 'string' || typeof obj.workspace === 'undefined';
  const limitOk = typeof obj.limit === 'number' || typeof obj.limit === 'undefined';
  const pageSizeOk = typeof obj.pageSize === 'number' || typeof obj.pageSize === 'undefined';
  const pageIdxOk = typeof obj.pageIdx === 'number' || typeof obj.pageIdx === 'undefined';
  const outputFileOk = typeof obj.outputFile === 'string' || typeof obj.outputFile === 'undefined';
  return workspaceOk && limitOk && pageSizeOk && pageIdxOk && outputFileOk;
}

/** Type guard for ListTechniquePrimitivesToolInput */
export function isListTechniquePrimitivesToolInput(value: unknown): value is ListTechniquePrimitivesToolInput {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  const workspaceOk = typeof obj.workspace === 'string' || typeof obj.workspace === 'undefined';
  const limitOk = typeof obj.limit === 'number' || typeof obj.limit === 'undefined';
  const pageSizeOk = typeof obj.pageSize === 'number' || typeof obj.pageSize === 'undefined';
  const pageIdxOk = typeof obj.pageIdx === 'number' || typeof obj.pageIdx === 'undefined';
  const outputFileOk = typeof obj.outputFile === 'string' || typeof obj.outputFile === 'undefined';
  return workspaceOk && limitOk && pageSizeOk && pageIdxOk && outputFileOk;
}

/** Type guard for ListTechniqueCompositionsToolInput */
export function isListTechniqueCompositionsToolInput(value: unknown): value is ListTechniqueCompositionsToolInput {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  const workspaceOk = typeof obj.workspace === 'string' || typeof obj.workspace === 'undefined';
  const limitOk = typeof obj.limit === 'number' || typeof obj.limit === 'undefined';
  const pageSizeOk = typeof obj.pageSize === 'number' || typeof obj.pageSize === 'undefined';
  const pageIdxOk = typeof obj.pageIdx === 'number' || typeof obj.pageIdx === 'undefined';
  const outputFileOk = typeof obj.outputFile === 'string' || typeof obj.outputFile === 'undefined';
  return workspaceOk && limitOk && pageSizeOk && pageIdxOk && outputFileOk;
}

/** Type guard for SelectTechniqueCompositionsToolInput */
export function isSelectTechniqueCompositionsToolInput(value: unknown): value is SelectTechniqueCompositionsToolInput {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  const intentOk = typeof obj.intent === 'string';
  const workspaceOk = typeof obj.workspace === 'string' || typeof obj.workspace === 'undefined';
  const limitOk = typeof obj.limit === 'number' || typeof obj.limit === 'undefined';
  return intentOk && workspaceOk && limitOk;
}

/** Type guard for CompileTechniqueCompositionToolInput */
export function isCompileTechniqueCompositionToolInput(value: unknown): value is CompileTechniqueCompositionToolInput {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  const compositionOk = typeof obj.compositionId === 'string';
  const workspaceOk = typeof obj.workspace === 'string' || typeof obj.workspace === 'undefined';
  const includeOk = typeof obj.includePrimitives === 'boolean' || typeof obj.includePrimitives === 'undefined';
  return compositionOk && workspaceOk && includeOk;
}

/** Type guard for CompileIntentBundlesToolInput */
export function isCompileIntentBundlesToolInput(value: unknown): value is CompileIntentBundlesToolInput {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  const intentOk = typeof obj.intent === 'string';
  const workspaceOk = typeof obj.workspace === 'string' || typeof obj.workspace === 'undefined';
  const limitOk = typeof obj.limit === 'number' || typeof obj.limit === 'undefined';
  const includeOk = typeof obj.includePrimitives === 'boolean' || typeof obj.includePrimitives === 'undefined';
  return intentOk && workspaceOk && limitOk && includeOk;
}

/** Type guard for LibrarianResource */
export function isLibrarianResource(value: unknown): value is LibrarianResource {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.uri === 'string' &&
    typeof obj.name === 'string' &&
    typeof obj.description === 'string' &&
    typeof obj.mimeType === 'string' &&
    typeof obj.provenance === 'object'
  );
}
