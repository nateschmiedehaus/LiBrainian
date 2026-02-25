/**
 * @fileoverview JSON Schema definitions and Zod validators for MCP Tool Inputs
 *
 * Provides JSON Schema Draft-07 compatible schemas for all MCP tool inputs.
 * Uses Zod for runtime validation (project standard) with JSON Schema for documentation.
 *
 * @packageDocumentation
 */

import { z } from 'zod';

// ============================================================================
// SCHEMA VERSION
// ============================================================================

export const SCHEMA_VERSION = '1.0.0';
export const JSON_SCHEMA_DRAFT = 'http://json-schema.org/draft-07/schema#';

// ============================================================================
// ZOD SCHEMAS
// ============================================================================

/** Query intent types */
export const QueryIntentSchema = z.enum([
  'understand', 'debug', 'refactor', 'impact', 'security', 'test', 'document', 'navigate', 'general'
]);

/** Context depth levels */
export const DepthSchema = z.enum(['L0', 'L1', 'L2', 'L3']);

/** LLM provider options */
export const LLMProviderSchema = z.enum(['claude', 'codex']);

/** Export format options */
export const ExportFormatSchema = z.enum(['json', 'sqlite', 'scip', 'lsif']);

/** Audit type options */
export const AuditTypeSchema = z.enum(['full', 'claims', 'coverage', 'security', 'freshness']);

/** Bundle type options */
export const BundleTypeSchema = z.enum(['minimal', 'standard', 'comprehensive']);
export const RepoMapStyleSchema = z.enum(['compact', 'detailed', 'json']);

/** Symbol discovery kinds */
export const FindSymbolKindSchema = z.enum([
  'function',
  'module',
  'context_pack',
  'claim',
  'composition',
  'run',
]);

/** Import trace direction */
export const TraceImportsDirectionSchema = z.enum(['imports', 'importedBy', 'both']);

/** Shared pagination/output controls */
const PageSizeSchema = z.number().int().min(1).max(200);
const PageIdxSchema = z.number().int().min(0);
const OutputFileSchema = z.string().min(1);
const CONFIDENCE_BEHAVIOR_CONTRACT = 'Confidence contract: when confidence_tier is definitive/high, proceed with reasonable trust; medium requires review before write operations; low/uncertain requires manual verification or request_human_review.';
const SearchFilterSchema = z.object({
  pathPrefix: z.string().min(1).optional().describe('Workspace-relative path prefix for scoped retrieval (example: packages/api/)'),
  language: z.string().min(1).optional().describe('Language filter (example: typescript, python, rust)'),
  isExported: z.boolean().optional().describe('Filter for exported/public symbols'),
  isPure: z.boolean().optional().describe('Filter for functions classified as pure/impure by behavioral heuristics'),
  excludeTests: z.boolean().optional().describe('Exclude test/spec files from retrieval'),
  maxFileSizeBytes: z.number().int().positive().optional().describe('Optional max file size guard in bytes'),
}).strict();

/**
 * Bootstrap tool input schema
 */
export const BootstrapToolInputSchema = z.object({
  workspace: z.string().min(1).describe('Absolute path to the workspace to bootstrap'),
  force: z.boolean().optional().default(false).describe('Force re-index even if cached data exists'),
  include: z.array(z.string()).optional().describe('Glob patterns for files to include'),
  exclude: z.array(z.string()).optional().describe('Glob patterns for files to exclude'),
  llmProvider: LLMProviderSchema.optional().describe('Preferred LLM provider for semantic analysis'),
  maxFiles: z.number().int().positive().optional().describe('Maximum files to index (for testing)'),
  fileTimeoutMs: z.number().int().min(0).optional().describe('Per-file timeout in ms (0 disables)'),
  fileTimeoutRetries: z.number().int().min(0).optional().describe('Retries per file on timeout'),
  fileTimeoutPolicy: z.enum(['skip', 'retry', 'fail']).optional().describe('Policy after file timeout retries'),
}).strict();

/**
 * Query tool input schema
 */
export const QueryToolInputSchema = z.object({
  intent: z.string().min(1).max(2000).describe('The query intent or question'),
  workspace: z.string().optional().describe('Workspace path (optional, uses first ready workspace if not specified)'),
  sessionId: z.string().min(1).optional().describe('Optional session identifier used for loop detection and adaptive query behavior'),
  intentType: QueryIntentSchema.optional().describe('Typed query intent for routing optimization'),
  affectedFiles: z.array(z.string()).optional().describe('File paths to scope the query to'),
  contextHints: z.object({
    active_file: z.string().min(1).optional().describe('Absolute path of the active file'),
    active_symbol: z.string().min(1).optional().describe('Active symbol in focus (function/class/module)'),
    recently_edited_files: z.array(z.string().min(1)).optional().describe('Files recently edited in this session'),
    recent_tool_calls: z.array(z.string().min(1)).optional().describe('Recent tool call names for trajectory hints'),
    conversation_context: z.string().min(1).max(2000).optional().describe('Recent conversation context snippet'),
  }).strict().optional().describe('Optional agent-state hints that bias retrieval toward active session topology, helping LiBrainian prioritize files and symbols related to current edits without rewriting the main intent.'),
  context_hints: z.object({
    active_file: z.string().min(1).optional(),
    active_symbol: z.string().min(1).optional(),
    recently_edited_files: z.array(z.string().min(1)).optional(),
    recent_tool_calls: z.array(z.string().min(1)).optional(),
    conversation_context: z.string().min(1).max(2000).optional(),
  }).strict().optional().describe('Snake-case alias for contextHints with identical semantics so backward-compatible clients can pass session topology hints and get the same retrieval behavior.'),
  filter: SearchFilterSchema.optional().describe('Structured retrieval filter for path/language/export/test constraints'),
  workingFile: z.string().min(1).optional().describe('Active file path used for monorepo package-scope auto-detection'),
  alpha: z.number().min(0.01).max(0.5).optional().describe('Conformal error-rate target alpha in [0.01, 0.5]. Example: alpha=0.10 targets a 90% coverage guarantee and adjusts retrieval thresholding accordingly.'),
  recencyWeight: z.number().min(0).max(1).optional().describe('Optional episodic recency-bias weight in [0,1]. Set 0 for cold retrieval, or increase toward 1 to favor recently accessed files that also pass semantic relevance checks.'),
  recency_weight: z.number().min(0).max(1).optional().describe('Snake-case alias for recencyWeight with identical semantics, allowing clients to tune episodic recency biasing without changing payload conventions.'),
  minConfidence: z.number().min(0).max(1).optional().default(0.5).describe(`Minimum confidence threshold (0-1). ${CONFIDENCE_BEHAVIOR_CONTRACT}`),
  depth: DepthSchema.optional().default('L1').describe('Depth of context to retrieve'),
  includeEngines: z.boolean().optional().default(false).describe('Include engine results in response'),
  includeEvidence: z.boolean().optional().default(false).describe('Include evidence graph summary'),
  pageSize: PageSizeSchema.optional().default(20).describe('Items per page (default: 20, max: 200)'),
  pageIdx: PageIdxSchema.optional().default(0).describe('Zero-based page index (default: 0)'),
  outputFile: OutputFileSchema.optional().describe('Write paged response payload to file and return a file reference'),
  explainMisses: z.boolean().optional().default(false).describe('Include near-miss retrieval diagnostics'),
  explain_misses: z.boolean().optional().describe('Alias for explainMisses'),
  stream: z.boolean().optional().default(false).describe('Enable chunked stream view metadata for progressive result consumption'),
  streamChunkSize: PageSizeSchema.optional().default(5).describe('Chunk size for stream view metadata (default: 5, max: 200)'),
}).strict();

/**
 * librainian_get_uncertainty tool input schema
 */
export const LibrainianGetUncertaintyToolInputSchema = z.object({
  query: z.string().min(1).max(2000).describe('Natural-language query to evaluate retrieval uncertainty for'),
  workspace: z.string().optional().describe('Workspace path (optional, uses first ready workspace if not specified)'),
  depth: DepthSchema.optional().default('L1').describe('Depth of context to retrieve for uncertainty scoring'),
  minConfidence: z.number().min(0).max(1).optional().default(0).describe('Minimum confidence threshold (0-1)'),
  topK: z.number().int().min(1).max(50).optional().default(10).describe('Maximum packs to include in uncertainty details'),
}).strict();

/**
 * semantic_search tool input schema
 */
export const SemanticSearchToolInputSchema = z.object({
  query: z.string().min(1).max(2000).describe('Localization query for semantic code search'),
  workspace: z.string().optional().describe('Workspace path (optional, uses first ready workspace if not specified)'),
  sessionId: z.string().min(1).optional().describe('Optional session identifier used for loop detection and adaptive search behavior'),
  filter: SearchFilterSchema.optional().describe('Structured retrieval filter for path/language/export/test constraints'),
  workingFile: z.string().min(1).optional().describe('Active file path used for monorepo package-scope auto-detection'),
  minConfidence: z.number().min(0).max(1).optional().default(0.4).describe(`Minimum confidence threshold (0-1). ${CONFIDENCE_BEHAVIOR_CONTRACT}`),
  depth: DepthSchema.optional().default('L1').describe('Depth of context to retrieve'),
  limit: PageSizeSchema.optional().default(20).describe('Maximum results to return (default: 20, max: 200)'),
  includeEngines: z.boolean().optional().default(false).describe('Include engine diagnostics in output'),
  includeEvidence: z.boolean().optional().default(false).describe('Include evidence graph summary'),
}).strict();

/**
 * validate_import tool input schema
 */
export const ValidateImportToolInputSchema = z.object({
  package: z.string().min(1).describe('Package specifier to validate (e.g. axios, next/router, @scope/pkg)'),
  importName: z.string().min(1).describe('Export/symbol name to validate from the package'),
  memberName: z.string().min(1).optional().describe('Optional class/interface member to validate (method/property)'),
  workspace: z.string().optional().describe('Workspace path (optional, uses first available if not specified)'),
  context: z.string().min(1).max(2000).optional().describe('Optional intent/context text used for richer diagnostics'),
}).strict();

/**
 * get_context_pack tool input schema
 */
export const GetContextPackToolInputSchema = z.object({
  intent: z.string().min(1).max(2000).describe('Task intent used for context pack retrieval'),
  relevantFiles: z.array(z.string().min(1)).optional().describe('Optional relevant file hints for retrieval focus'),
  tokenBudget: z.number().int().min(100).max(50000).optional().default(4000).describe('Hard token budget for assembled context output'),
  workdir: z.string().optional().describe('Working directory hint for workspace resolution'),
  workspace: z.string().optional().describe('Workspace path alias for callers that already have it'),
}).strict();

/**
 * estimate_budget tool input schema
 */
export const EstimateBudgetToolInputSchema = z.object({
  taskDescription: z.string().min(1).max(4000).describe('Task description to estimate before execution'),
  availableTokens: z.number().int().min(1).max(1_000_000).describe('Available token budget before compaction'),
  workdir: z.string().optional().describe('Working directory hint for workspace resolution'),
  pipeline: z.array(z.string().min(1)).optional().describe('Optional explicit pipeline/tool sequence for estimation'),
  workspace: z.string().optional().describe('Workspace path alias for callers that already have it'),
}).strict();

/**
 * estimate_task_complexity tool input schema
 */
export const EstimateTaskComplexityToolInputSchema = z.object({
  task: z.string().min(1).max(4000).describe('Task statement to classify for routing complexity'),
  workdir: z.string().optional().describe('Working directory hint for workspace resolution'),
  workspace: z.string().optional().describe('Workspace path alias for callers that already have it'),
  recentFiles: z.array(z.string().min(1)).optional().describe('Optional recently touched files used as routing hints'),
  functionId: z.string().min(1).optional().describe('Optional primary function target for blast-radius estimation'),
}).strict();

/**
 * get_change_impact tool input schema
 */
export const GetChangeImpactToolInputSchema = z.object({
  target: z.string().min(1).describe('Changed file/module/function identifier to analyze'),
  workspace: z.string().optional().describe('Workspace path (optional, uses first available if not specified)'),
  depth: z.number().int().min(1).max(8).optional().default(3).describe('Maximum transitive depth for propagation (default: 3)'),
  maxResults: z.number().int().min(1).max(1000).optional().default(200).describe('Maximum impacted files to return (default: 200)'),
  changeType: z.enum(['modify', 'delete', 'rename', 'move']).optional().describe('Optional change type to refine risk scoring'),
}).strict();

/**
 * blast_radius tool input schema
 */
export const BlastRadiusToolInputSchema = z.object({
  target: z.string().min(1).describe('Changed file/module/function identifier to analyze'),
  workspace: z.string().optional().describe('Workspace path (optional, uses first available if not specified)'),
  depth: z.number().int().min(1).max(8).optional().default(3).describe('Maximum transitive depth for propagation (default: 3)'),
  maxResults: z.number().int().min(1).max(1000).optional().default(200).describe('Maximum impacted files to return (default: 200)'),
  changeType: z.enum(['modify', 'delete', 'rename', 'move']).optional().describe('Optional change type to refine risk scoring'),
}).strict();

/**
 * pre_commit_check tool input schema
 */
export const PreCommitCheckToolInputSchema = z.object({
  changedFiles: z.array(z.string().min(1)).min(1).max(200).describe('Changed files to evaluate before submit'),
  workspace: z.string().optional().describe('Workspace path (optional, uses first available if not specified)'),
  strict: z.boolean().optional().default(false).describe('Enforce stricter pass criteria'),
  maxRiskLevel: z.enum(['low', 'medium', 'high', 'critical']).optional().default('high').describe('Maximum acceptable risk level for pass'),
}).strict();

/**
 * librarian_completeness_check tool input schema
 */
export const LibrarianCompletenessCheckToolInputSchema = z.object({
  workspace: z.string().optional().describe('Workspace path (optional, uses first available if not specified)'),
  changedFiles: z.array(z.string().min(1)).max(500).optional().describe('Optional changed files to scope post-implementation completeness checks'),
  mode: z.enum(['auto', 'changed', 'full']).optional().default('auto').describe('auto uses git status when available, changed scopes to changedFiles, full checks all indexed elements'),
  supportThreshold: z.number().int().min(1).max(500).optional().default(5).describe('Minimum cluster support before findings are enforced instead of informational'),
  counterevidence: z.array(z.object({
    artifact: z.string().min(1).describe('Artifact name to exempt or down-weight'),
    pattern: z.string().min(1).optional().describe('Optional pattern filter (for example crud_function or api_endpoint)'),
    filePattern: z.string().min(1).optional().describe('Optional regex string matched against candidate file path'),
    reason: z.string().min(1).describe('Human rationale for intentional exception'),
    weight: z.number().min(0).max(1).optional().describe('Optional suppression weight in [0,1]'),
  }).strict()).optional().describe('Optional intentional-exception entries used to reduce confidence and suppress false positives'),
}).strict().default({});

/**
 * claim_work_scope tool input schema
 */
export const ClaimWorkScopeToolInputSchema = z.object({
  scopeId: z.string().min(1).describe('Semantic scope identifier (file, module, symbol, or task scope key)'),
  workspace: z.string().optional().describe('Workspace path (optional, used to namespace scope claims)'),
  sessionId: z.string().min(1).optional().describe('Optional session identifier for ownership'),
  owner: z.string().min(1).optional().describe('Optional owner label (agent name/id)'),
  mode: z.enum(['claim', 'release', 'check']).optional().default('claim').describe('Claim operation mode'),
  ttlSeconds: z.number().int().min(1).max(86400).optional().default(1800).describe('Claim expiration window in seconds (claim mode only)'),
}).strict();

/**
 * append_claim tool input schema
 */
export const AppendClaimToolInputSchema = z.object({
  claim: z.string().min(1).describe('Claim text to persist for later retrieval and session harvest'),
  workspace: z.string().optional().describe('Workspace path (optional, used for namespacing and audit logs)'),
  sessionId: z.string().min(1).optional().describe('Optional session identifier that owns this claim'),
  tags: z.array(z.string().min(1)).optional().describe('Optional semantic tags for filtering and harvest summaries'),
  evidence: z.array(z.string().min(1)).optional().describe('Optional evidence snippets, IDs, or citations supporting the claim'),
  confidence: z.number().min(0).max(1).optional().default(0.6).describe('Optional confidence score in [0,1]'),
  sourceTool: z.string().min(1).optional().describe('Optional source tool name that produced this claim'),
}).strict();

/**
 * query_claims tool input schema
 */
export const QueryClaimsToolInputSchema = z.object({
  query: z.string().min(1).max(2000).optional().describe('Optional text query over claim, evidence, and tag fields'),
  workspace: z.string().optional().describe('Workspace path filter (optional)'),
  sessionId: z.string().min(1).optional().describe('Optional session identifier filter'),
  tags: z.array(z.string().min(1)).optional().describe('Optional tags filter (matches any provided tag)'),
  since: z.string().min(1).optional().describe('Optional ISO timestamp lower bound for createdAt filtering'),
  limit: z.number().int().min(1).max(200).optional().default(20).describe('Maximum claims to return (default: 20, max: 200)'),
}).strict().default({});

/**
 * harvest_session_knowledge tool input schema
 */
export const HarvestSessionKnowledgeToolInputSchema = z.object({
  sessionId: z.string().min(1).optional().describe('Session to harvest claims from (optional)'),
  workspace: z.string().optional().describe('Workspace path filter (optional)'),
  maxItems: z.number().int().min(1).max(200).optional().default(20).describe('Maximum harvested claims to include (default: 20, max: 200)'),
  minConfidence: z.number().min(0).max(1).optional().default(0).describe('Minimum confidence threshold in [0,1]'),
  includeRecommendations: z.boolean().optional().default(true).describe('Include recommended next tools in output'),
  memoryFilePath: z.string().min(1).optional().describe('Optional explicit MEMORY.md path for memory-bridge sync'),
  openclawRoot: z.string().min(1).optional().describe('Optional OpenClaw root path used when memoryFilePath is omitted'),
  persistToMemory: z.boolean().optional().default(true).describe('Persist harvested claims to annotated MEMORY.md'),
  source: z.enum(['openclaw-session', 'manual', 'harvest']).optional().default('harvest').describe('Memory-bridge source label'),
}).strict().default({});

/**
 * memory_add tool input schema
 */
export const MemoryAddToolInputSchema = z.object({
  content: z.string().min(1).describe('Memory fact content to persist'),
  workspace: z.string().optional().describe('Workspace path (optional, uses first available if not specified)'),
  scope: z.enum(['codebase', 'module', 'function']).optional().default('codebase').describe('Memory scope'),
  scopeKey: z.string().min(1).optional().describe('Optional scope key (module path or symbol ID)'),
  source: z.enum(['agent', 'analysis', 'user']).optional().default('agent').describe('Fact source'),
  confidence: z.number().min(0).max(1).optional().default(0.7).describe('Confidence score in [0,1]'),
  evergreen: z.boolean().optional().default(false).describe('Disable age decay for this fact'),
}).strict();

/**
 * memory_search tool input schema
 */
export const MemorySearchToolInputSchema = z.object({
  query: z.string().min(1).describe('Semantic query for memory facts'),
  workspace: z.string().optional().describe('Workspace path (optional, uses first available if not specified)'),
  scopeKey: z.string().min(1).optional().describe('Optional scope key filter'),
  limit: z.number().int().min(1).max(200).optional().default(10).describe('Maximum facts to return'),
  minScore: z.number().min(0).max(1).optional().default(0.1).describe('Minimum scored threshold'),
}).strict();

/**
 * memory_update tool input schema
 */
export const MemoryUpdateToolInputSchema = z.object({
  id: z.string().min(1).describe('Memory fact ID'),
  content: z.string().min(1).describe('Updated memory content'),
  workspace: z.string().optional().describe('Workspace path (optional, uses first available if not specified)'),
}).strict();

/**
 * memory_delete tool input schema
 */
export const MemoryDeleteToolInputSchema = z.object({
  id: z.string().min(1).describe('Memory fact ID'),
  workspace: z.string().optional().describe('Workspace path (optional, uses first available if not specified)'),
}).strict();

/**
 * Submit feedback tool input schema
 */
export const SubmitFeedbackToolInputSchema = z.object({
  feedbackToken: z.string().min(1).describe('Feedback token from query response'),
  outcome: z.enum(['success', 'failure', 'partial']).describe('Task outcome'),
  workspace: z.string().optional().describe('Workspace path (optional, uses first available if not specified)'),
  agentId: z.string().optional().describe('Agent identifier'),
  predictionId: z.string().optional().describe('Optional prediction ID when feedback resolves a human review'),
  missingContext: z.string().optional().describe('Description of missing context'),
  customRatings: z.array(z.object({
    packId: z.string().min(1),
    relevant: z.boolean(),
    usefulness: z.number().min(0).max(1).optional(),
    reason: z.string().optional(),
  }).strict()).optional().describe('Optional per-pack relevance ratings'),
}).strict();

/**
 * feedback_retrieval_result tool input schema
 */
export const FeedbackRetrievalResultToolInputSchema = z.object({
  feedbackToken: z.string().min(1).describe('Feedback token from query response'),
  wasHelpful: z.boolean().describe('Whether retrieved context was helpful'),
  workspace: z.string().optional().describe('Workspace path (optional, uses first available if not specified)'),
  agentId: z.string().optional().describe('Agent identifier'),
  missingContext: z.string().optional().describe('Description of missing context'),
}).strict();

/**
 * get_retrieval_stats tool input schema
 */
export const GetRetrievalStatsToolInputSchema = z.object({
  workspace: z.string().optional().describe('Workspace path (optional, uses first available if not specified)'),
  intentType: z.string().min(1).optional().describe('Optional retrieval intent type filter'),
  limit: z.number().int().min(1).max(1000).optional().default(200).describe('Maximum selection events to return (default 200, max 1000)'),
}).strict().default({});

/**
 * get_exploration_suggestions tool input schema
 */
export const GetExplorationSuggestionsToolInputSchema = z.object({
  workspace: z.string().optional().describe('Workspace path (optional, uses first available if not specified)'),
  entityType: z.enum(['function', 'module']).optional().default('module').describe('Entity type filter (module recommended)'),
  limit: z.number().int().min(1).max(200).optional().default(5).describe('Maximum suggestions to return (default 5, max 200)'),
}).strict().default({});

/**
 * Explain function tool input schema
 */
export const ExplainFunctionToolInputSchema = z.object({
  name: z.string().min(1).max(500).describe('Function name or function ID to explain'),
  filePath: z.string().optional().describe('Optional file path for disambiguation when names collide'),
  workspace: z.string().optional().describe('Workspace path (optional, uses first ready workspace if not specified)'),
}).strict();

/**
 * Find callers tool input schema
 */
export const FindCallersToolInputSchema = z.object({
  functionId: z.string().min(1).max(500).describe('Target function ID or name to locate callers for'),
  workspace: z.string().optional().describe('Workspace path (optional, uses first ready workspace if not specified)'),
  transitive: z.boolean().optional().default(false).describe('Include transitive callers (callers-of-callers)'),
  maxDepth: z.number().int().min(1).max(8).optional().default(3).describe('Maximum transitive caller depth when transitive is enabled'),
  limit: z.number().int().min(1).max(500).optional().default(100).describe('Maximum caller callsites to return (default: 100, max: 500)'),
}).strict();

/**
 * Find callees tool input schema
 */
export const FindCalleesToolInputSchema = z.object({
  functionId: z.string().min(1).max(500).describe('Target function ID or name to locate callees for'),
  workspace: z.string().optional().describe('Workspace path (optional, uses first ready workspace if not specified)'),
  limit: z.number().int().min(1).max(500).optional().default(100).describe('Maximum callees to return (default: 100, max: 500)'),
}).strict();

/**
 * Find usages tool input schema
 */
export const FindUsagesToolInputSchema = z.object({
  symbol: z.string().min(1).max(500).describe('Function name or function ID to locate call sites for'),
  workspace: z.string().optional().describe('Workspace path (optional, uses first ready workspace if not specified)'),
  limit: z.number().int().min(1).max(500).optional().default(100).describe('Maximum callsite records to return (default: 100, max: 500)'),
}).strict();

/**
 * Trace imports tool input schema
 */
export const TraceImportsToolInputSchema = z.object({
  filePath: z.string().min(1).describe('File path to trace dependencies from'),
  direction: TraceImportsDirectionSchema.optional().default('both').describe('Trace imports, importers, or both'),
  depth: z.number().int().min(1).max(6).optional().default(2).describe('Maximum dependency depth (default: 2, max: 6)'),
  workspace: z.string().optional().describe('Workspace path (optional, uses first ready workspace if not specified)'),
}).strict();

/**
 * Trace control flow tool input schema
 */
export const TraceControlFlowToolInputSchema = z.object({
  functionId: z.string().min(1).max(500).describe('Target function ID or name to trace control flow for'),
  workspace: z.string().optional().describe('Workspace path (optional, uses first ready workspace if not specified)'),
  maxBlocks: z.number().int().min(1).max(1000).optional().default(200).describe('Maximum basic blocks to return (default: 200, max: 1000)'),
}).strict();

/**
 * Trace data flow tool input schema
 */
export const TraceDataFlowToolInputSchema = z.object({
  source: z.string().min(1).max(500).describe('Source expression or variable (for example: req.params.userId)'),
  sink: z.string().min(1).max(500).describe('Sink function or expression (for example: db.query)'),
  functionId: z.string().min(1).max(500).optional().describe('Optional function ID or name to scope tracing'),
  workspace: z.string().optional().describe('Workspace path (optional, uses first ready workspace if not specified)'),
}).strict();

/**
 * Reset session state tool input schema
 */
export const ResetSessionStateToolInputSchema = z.object({
  sessionId: z.string().min(1).optional().describe('Session ID to reset (optional if auth token is provided)'),
  workspace: z.string().optional().describe('Workspace hint used for anonymous session reset fallback'),
}).strict().default({});

/**
 * Synthesize plan tool input schema
 */
export const SynthesizePlanToolInputSchema = z.object({
  task: z.string().min(1).max(2000).describe('Task description the agent is planning to execute'),
  context_pack_ids: z.array(z.string().min(1)).min(1).max(100).describe('Context pack IDs from prior retrieval that informed the plan'),
  workspace: z.string().optional().describe('Workspace path (optional, uses first available if not specified)'),
  sessionId: z.string().min(1).optional().describe('Optional session identifier used to persist and retrieve plan state'),
}).strict();

/**
 * Request human review tool input schema
 */
export const RequestHumanReviewToolInputSchema = z.object({
  reason: z.string().min(1).describe('Why human review is needed'),
  context_summary: z.string().min(1).describe('Summary of uncertain or conflicting context'),
  proposed_action: z.string().min(1).describe('Action the agent was about to take'),
  confidence_tier: z.enum(['low', 'uncertain']).describe('Confidence tier requiring escalation'),
  risk_level: z.enum(['low', 'medium', 'high']).describe('Risk if the proposed action is wrong'),
  blocking: z.boolean().describe('Whether the agent should pause for human response'),
}).strict();

/**
 * List constructions tool input schema
 */
export const ListConstructionsToolInputSchema = z.object({
  tags: z.array(z.string()).optional().describe('Optional tags to filter constructions'),
  capabilities: z.array(z.string()).optional().describe('Optional required capabilities filter'),
  requires: z.array(z.string()).optional().describe('Alias for capabilities filter'),
  language: z.string().optional().describe('Optional language filter (for example: typescript, python, rust)'),
  trustTier: z.enum(['official', 'partner', 'community']).optional().describe('Optional trust tier filter'),
  availableOnly: z.boolean().optional().default(false).describe('Only return constructions executable in this runtime'),
}).strict().default({});

/**
 * List capabilities tool input schema
 */
export const ListCapabilitiesToolInputSchema = z.object({
  workspace: z.string().optional().describe('Workspace path used to resolve workspace-scoped compositions'),
}).strict().default({});

/**
 * Invoke construction tool input schema
 */
export const InvokeConstructionToolInputSchema = z.object({
  constructionId: z.string().min(1).describe('Construction ID from list_constructions'),
  input: z.unknown().describe('Construction input payload'),
  workspace: z.string().optional().describe('Workspace path used to resolve runtime dependencies'),
}).strict();

/**
 * Describe construction tool input schema
 */
export const DescribeConstructionToolInputSchema = z.object({
  id: z.string().min(1).describe('Construction ID to describe'),
  includeExample: z.boolean().optional().default(true).describe('Include an executable example code snippet'),
  includeCompositionHints: z.boolean().optional().default(true).describe('Include composition/operator hints'),
}).strict();

const ConstructionOperatorSchema = z.enum([
  'seq',
  'fanout',
  'fallback',
  'fix',
  'select',
  'atom',
  'dimap',
  'map',
  'contramap',
]);

/**
 * Explain operator tool input schema
 */
export const ExplainOperatorToolInputSchema = z.object({
  operator: ConstructionOperatorSchema.optional().describe('Operator to explain directly'),
  situation: z.string().min(1).optional().describe('Situation description used for operator recommendation'),
})
  .strict()
  .refine(
    (value) => typeof value.operator === 'string' || typeof value.situation === 'string',
    {
      message: 'Either operator or situation is required',
      path: ['operator'],
    },
  );

/**
 * Check construction types tool input schema
 */
export const CheckConstructionTypesToolInputSchema = z.object({
  first: z.string().min(1).describe('First construction ID'),
  second: z.string().min(1).describe('Second construction ID'),
  operator: z.enum(['seq', 'fanout', 'fallback']).describe('Composition operator to check'),
}).strict();

/**
 * Verify claim tool input schema
 */
export const VerifyClaimToolInputSchema = z.object({
  claimId: z.string().min(1).describe('ID of the claim to verify'),
  force: z.boolean().optional().default(false).describe('Force re-verification even if recently verified'),
}).strict();

/**
 * Find symbol tool input schema
 */
export const FindSymbolToolInputSchema = z.object({
  query: z.string().min(1).max(500).describe('Human-readable function, module, claim, composition, or run query'),
  kind: FindSymbolKindSchema.optional().describe('Optional category filter for symbol discovery'),
  workspace: z.string().optional().describe('Workspace path (optional, uses first ready workspace if not specified)'),
  limit: z.number().int().min(1).max(200).optional().default(20).describe('Maximum matches to return (default: 20, max: 200)'),
}).strict();

/**
 * Run audit tool input schema
 */
export const RunAuditToolInputSchema = z.object({
  type: AuditTypeSchema.describe('Type of audit to perform'),
  scope: z.array(z.string()).optional().describe('File paths or patterns to scope the audit'),
  generateReport: z.boolean().optional().default(true).describe('Generate a detailed audit report'),
}).strict();

/**
 * List runs tool input schema
 */
export const ListRunsToolInputSchema = z.object({
  workspace: z.string().optional().describe('Workspace path (optional, uses first available if not specified)'),
  limit: z.number().int().positive().max(100).optional().describe('Maximum number of runs to return (default: 10, max: 100)'),
}).strict().default({});

/**
 * Diff runs tool input schema
 */
export const DiffRunsToolInputSchema = z.object({
  workspace: z.string().optional().describe('Workspace path used to resolve persisted run history'),
  runIdA: z.string().min(1).describe('ID of the first run'),
  runIdB: z.string().min(1).describe('ID of the second run'),
  detailed: z.boolean().optional().default(false).describe('Include detailed diff information'),
}).strict();

/**
 * Export index tool input schema
 */
export const ExportIndexToolInputSchema = z.object({
  format: ExportFormatSchema.describe('Export format'),
  outputPath: z.string().min(1).describe('Path to write the export'),
  includeEmbeddings: z.boolean().optional().default(false).describe('Include embedding vectors in export'),
  scope: z.array(z.string()).optional().describe('File patterns to scope the export'),
}).strict();

/**
 * Get context pack bundle tool input schema
 */
export const GetContextPackBundleToolInputSchema = z.object({
  entityIds: z.array(z.string()).min(1).describe('Entity IDs to bundle context for'),
  bundleType: BundleTypeSchema.optional().default('standard').describe('Type of bundle to create'),
  maxTokens: z.number().int().min(100).max(100000).optional().describe('Maximum token budget for the bundle'),
  pageSize: PageSizeSchema.optional().default(20).describe('Items per page (default: 20, max: 200)'),
  pageIdx: PageIdxSchema.optional().default(0).describe('Zero-based page index (default: 0)'),
  outputFile: OutputFileSchema.optional().describe('Write paged response payload to file and return a file reference'),
}).strict();

/**
 * Get repo map tool input schema
 */
export const GetRepoMapToolInputSchema = z.object({
  workspace: z.string().optional().describe('Workspace path (optional, uses first ready workspace if not specified)'),
  maxTokens: z.number().int().min(128).max(50000).optional().default(4096).describe('Token budget cap for repo map output'),
  focus: z.array(z.string().min(1)).max(64).optional().describe('Optional file/path focus hints that boost matching entries'),
  style: RepoMapStyleSchema.optional().default('compact').describe('Output style: compact, detailed, or json'),
}).strict().default({});

/**
 * List verification plans tool input schema
 */
export const ListVerificationPlansToolInputSchema = z.object({
  workspace: z.string().optional().describe('Workspace path (optional, uses first available if not specified)'),
  limit: z.number().int().positive().optional().describe('Limit number of plans returned'),
  pageSize: PageSizeSchema.optional().default(20).describe('Items per page (default: 20, max: 200)'),
  pageIdx: PageIdxSchema.optional().default(0).describe('Zero-based page index (default: 0)'),
  outputFile: OutputFileSchema.optional().describe('Write paged response payload to file and return a file reference'),
}).strict().default({});

/**
 * List episodes tool input schema
 */
export const ListEpisodesToolInputSchema = z.object({
  workspace: z.string().optional().describe('Workspace path (optional, uses first available if not specified)'),
  limit: z.number().int().positive().optional().describe('Limit number of episodes returned'),
  pageSize: PageSizeSchema.optional().default(20).describe('Items per page (default: 20, max: 200)'),
  pageIdx: PageIdxSchema.optional().default(0).describe('Zero-based page index (default: 0)'),
  outputFile: OutputFileSchema.optional().describe('Write paged response payload to file and return a file reference'),
}).strict().default({});

/**
 * List technique primitives tool input schema
 */
export const ListTechniquePrimitivesToolInputSchema = z.object({
  workspace: z.string().optional().describe('Workspace path (optional, uses first available if not specified)'),
  limit: z.number().int().positive().optional().describe('Limit number of primitives returned'),
  pageSize: PageSizeSchema.optional().default(20).describe('Items per page (default: 20, max: 200)'),
  pageIdx: PageIdxSchema.optional().default(0).describe('Zero-based page index (default: 0)'),
  outputFile: OutputFileSchema.optional().describe('Write paged response payload to file and return a file reference'),
}).strict().default({});

/**
 * List technique compositions tool input schema
 */
export const ListTechniqueCompositionsToolInputSchema = z.object({
  workspace: z.string().optional().describe('Workspace path (optional, uses first available if not specified)'),
  limit: z.number().int().positive().optional().describe('Limit number of compositions returned'),
  pageSize: PageSizeSchema.optional().default(20).describe('Items per page (default: 20, max: 200)'),
  pageIdx: PageIdxSchema.optional().default(0).describe('Zero-based page index (default: 0)'),
  outputFile: OutputFileSchema.optional().describe('Write paged response payload to file and return a file reference'),
}).strict().default({});

/**
 * Select technique compositions tool input schema
 */
export const SelectTechniqueCompositionsToolInputSchema = z.object({
  intent: z.string().min(1).describe('Intent or goal to select compositions for'),
  workspace: z.string().optional().describe('Workspace path (optional, uses first available if not specified)'),
  limit: z.number().int().positive().optional().describe('Limit number of compositions returned'),
}).strict();

/**
 * Compile technique composition tool input schema
 */
export const CompileTechniqueCompositionToolInputSchema = z.object({
  compositionId: z.string().min(1).describe('Technique composition ID to compile'),
  workspace: z.string().optional().describe('Workspace path (optional, uses first available if not specified)'),
  includePrimitives: z.boolean().optional().describe('Include primitive definitions in output'),
}).strict();

/**
 * Compile intent bundles tool input schema
 */
export const CompileIntentBundlesToolInputSchema = z.object({
  intent: z.string().min(1).describe('Intent to compile into technique bundles'),
  workspace: z.string().optional().describe('Workspace path (optional, uses first available if not specified)'),
  limit: z.number().int().positive().optional().describe('Limit number of bundles returned'),
  includePrimitives: z.boolean().optional().describe('Include primitive definitions in output'),
}).strict();

/**
 * System contract tool input schema
 */
export const SystemContractToolInputSchema = z.object({
  workspace: z.string().optional().describe('Workspace path (optional, uses first available if not specified)'),
}).strict();

/**
 * Diagnose self tool input schema
 */
export const DiagnoseSelfToolInputSchema = z.object({
  workspace: z.string().optional().describe('Workspace path (optional, uses first available if not specified)'),
}).strict();

/**
 * List strategic contracts tool input schema
 */
export const ListStrategicContractsToolInputSchema = z.object({
  workspace: z.string().optional().describe('Workspace path (optional, uses first available if not specified)'),
  contractType: z.enum(['api', 'event', 'schema']).optional().describe('Optional strategic contract type filter'),
  breakingOnly: z.boolean().optional().default(false).describe('If true, only return breaking contracts'),
  limit: z.number().int().positive().optional().describe('Limit number of contracts returned'),
  pageSize: PageSizeSchema.optional().default(20).describe('Items per page (default: 20, max: 200)'),
  pageIdx: PageIdxSchema.optional().default(0).describe('Zero-based page index (default: 0)'),
  outputFile: OutputFileSchema.optional().describe('Write paged response payload to file and return a file reference'),
}).strict().default({});

/**
 * Get strategic contract tool input schema
 */
export const GetStrategicContractToolInputSchema = z.object({
  workspace: z.string().optional().describe('Workspace path (optional, uses first available if not specified)'),
  contractId: z.string().min(1).describe('Strategic contract ID'),
}).strict();

/**
 * Status tool input schema
 */
export const StatusToolInputSchema = z.object({
  workspace: z.string().optional().describe('Workspace path (optional, uses first available if not specified)'),
  sessionId: z.string().min(1).optional().describe('Optional session identifier used for session-scoped status details'),
  planId: z.string().min(1).optional().describe('Optional plan ID to retrieve a specific synthesized plan'),
  costBudgetUsd: z.number().nonnegative().optional().describe('Optional budget threshold (USD) for session cost alerts'),
}).strict();

/**
 * get_session_briefing tool input schema
 */
export const GetSessionBriefingToolInputSchema = z.object({
  workspace: z.string().optional().describe('Workspace path (optional, uses first available if not specified)'),
  sessionId: z.string().min(1).optional().describe('Optional session identifier for session-scoped briefing details'),
  includeConstructions: z.boolean().optional().default(true).describe('Include construction onboarding hints in the response'),
}).strict();

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export type BootstrapToolInputType = z.infer<typeof BootstrapToolInputSchema>;
export type QueryToolInputType = z.infer<typeof QueryToolInputSchema>;
export type LibrainianGetUncertaintyToolInputType = z.infer<typeof LibrainianGetUncertaintyToolInputSchema>;
export type SemanticSearchToolInputType = z.infer<typeof SemanticSearchToolInputSchema>;
export type GetContextPackToolInputType = z.infer<typeof GetContextPackToolInputSchema>;
export type EstimateBudgetToolInputType = z.infer<typeof EstimateBudgetToolInputSchema>;
export type EstimateTaskComplexityToolInputType = z.infer<typeof EstimateTaskComplexityToolInputSchema>;
export type SynthesizePlanToolInputType = z.infer<typeof SynthesizePlanToolInputSchema>;
export type GetChangeImpactToolInputType = z.infer<typeof GetChangeImpactToolInputSchema>;
export type BlastRadiusToolInputType = z.infer<typeof BlastRadiusToolInputSchema>;
export type PreCommitCheckToolInputType = z.infer<typeof PreCommitCheckToolInputSchema>;
export type LibrarianCompletenessCheckToolInputType = z.infer<typeof LibrarianCompletenessCheckToolInputSchema>;
export type ValidateImportToolInputType = z.infer<typeof ValidateImportToolInputSchema>;
export type ClaimWorkScopeToolInputType = z.infer<typeof ClaimWorkScopeToolInputSchema>;
export type AppendClaimToolInputType = z.infer<typeof AppendClaimToolInputSchema>;
export type QueryClaimsToolInputType = z.infer<typeof QueryClaimsToolInputSchema>;
export type HarvestSessionKnowledgeToolInputType = z.infer<typeof HarvestSessionKnowledgeToolInputSchema>;
export type MemoryAddToolInputType = z.infer<typeof MemoryAddToolInputSchema>;
export type MemorySearchToolInputType = z.infer<typeof MemorySearchToolInputSchema>;
export type MemoryUpdateToolInputType = z.infer<typeof MemoryUpdateToolInputSchema>;
export type MemoryDeleteToolInputType = z.infer<typeof MemoryDeleteToolInputSchema>;
export type SubmitFeedbackToolInputType = z.infer<typeof SubmitFeedbackToolInputSchema>;
export type FeedbackRetrievalResultToolInputType = z.infer<typeof FeedbackRetrievalResultToolInputSchema>;
export type GetRetrievalStatsToolInputType = z.infer<typeof GetRetrievalStatsToolInputSchema>;
export type GetExplorationSuggestionsToolInputType = z.infer<typeof GetExplorationSuggestionsToolInputSchema>;
export type ExplainFunctionToolInputType = z.infer<typeof ExplainFunctionToolInputSchema>;
export type FindCallersToolInputType = z.infer<typeof FindCallersToolInputSchema>;
export type FindCalleesToolInputType = z.infer<typeof FindCalleesToolInputSchema>;
export type FindUsagesToolInputType = z.infer<typeof FindUsagesToolInputSchema>;
export type TraceImportsToolInputType = z.infer<typeof TraceImportsToolInputSchema>;
export type TraceControlFlowToolInputType = z.infer<typeof TraceControlFlowToolInputSchema>;
export type TraceDataFlowToolInputType = z.infer<typeof TraceDataFlowToolInputSchema>;
export type ResetSessionStateToolInputType = z.infer<typeof ResetSessionStateToolInputSchema>;
export type RequestHumanReviewToolInputType = z.infer<typeof RequestHumanReviewToolInputSchema>;
export type ListConstructionsToolInputType = z.infer<typeof ListConstructionsToolInputSchema>;
export type ListCapabilitiesToolInputType = z.infer<typeof ListCapabilitiesToolInputSchema>;
export type InvokeConstructionToolInputType = z.infer<typeof InvokeConstructionToolInputSchema>;
export type DescribeConstructionToolInputType = z.infer<typeof DescribeConstructionToolInputSchema>;
export type ExplainOperatorToolInputType = z.infer<typeof ExplainOperatorToolInputSchema>;
export type CheckConstructionTypesToolInputType = z.infer<typeof CheckConstructionTypesToolInputSchema>;
export type VerifyClaimToolInputType = z.infer<typeof VerifyClaimToolInputSchema>;
export type FindSymbolToolInputType = z.infer<typeof FindSymbolToolInputSchema>;
export type RunAuditToolInputType = z.infer<typeof RunAuditToolInputSchema>;
export type ListRunsToolInputType = z.infer<typeof ListRunsToolInputSchema>;
export type DiffRunsToolInputType = z.infer<typeof DiffRunsToolInputSchema>;
export type ExportIndexToolInputType = z.infer<typeof ExportIndexToolInputSchema>;
export type GetContextPackBundleToolInputType = z.infer<typeof GetContextPackBundleToolInputSchema>;
export type GetRepoMapToolInputType = z.infer<typeof GetRepoMapToolInputSchema>;
export type ListVerificationPlansToolInputType = z.infer<typeof ListVerificationPlansToolInputSchema>;
export type ListEpisodesToolInputType = z.infer<typeof ListEpisodesToolInputSchema>;
export type ListTechniquePrimitivesToolInputType = z.infer<typeof ListTechniquePrimitivesToolInputSchema>;
export type ListTechniqueCompositionsToolInputType = z.infer<typeof ListTechniqueCompositionsToolInputSchema>;
export type SelectTechniqueCompositionsToolInputType = z.infer<typeof SelectTechniqueCompositionsToolInputSchema>;
export type CompileTechniqueCompositionToolInputType = z.infer<typeof CompileTechniqueCompositionToolInputSchema>;
export type CompileIntentBundlesToolInputType = z.infer<typeof CompileIntentBundlesToolInputSchema>;
export type SystemContractToolInputType = z.infer<typeof SystemContractToolInputSchema>;
export type DiagnoseSelfToolInputType = z.infer<typeof DiagnoseSelfToolInputSchema>;
export type StatusToolInputType = z.infer<typeof StatusToolInputSchema>;
export type GetSessionBriefingToolInputType = z.infer<typeof GetSessionBriefingToolInputSchema>;

// ============================================================================
// SCHEMA REGISTRY
// ============================================================================

/** All tool input schemas (Zod) */
export const TOOL_INPUT_SCHEMAS = {
  bootstrap: BootstrapToolInputSchema,
  get_session_briefing: GetSessionBriefingToolInputSchema,
  system_contract: SystemContractToolInputSchema,
  diagnose_self: DiagnoseSelfToolInputSchema,
  list_strategic_contracts: ListStrategicContractsToolInputSchema,
  get_strategic_contract: GetStrategicContractToolInputSchema,
  status: StatusToolInputSchema,
  semantic_search: SemanticSearchToolInputSchema,
  validate_import: ValidateImportToolInputSchema,
  get_context_pack: GetContextPackToolInputSchema,
  estimate_budget: EstimateBudgetToolInputSchema,
  estimate_task_complexity: EstimateTaskComplexityToolInputSchema,
  query: QueryToolInputSchema,
  librainian_get_uncertainty: LibrainianGetUncertaintyToolInputSchema,
  synthesize_plan: SynthesizePlanToolInputSchema,
  explain_function: ExplainFunctionToolInputSchema,
  find_usages: FindUsagesToolInputSchema,
  trace_imports: TraceImportsToolInputSchema,
  trace_control_flow: TraceControlFlowToolInputSchema,
  trace_data_flow: TraceDataFlowToolInputSchema,
  reset_session_state: ResetSessionStateToolInputSchema,
  request_human_review: RequestHumanReviewToolInputSchema,
  list_constructions: ListConstructionsToolInputSchema,
  list_capabilities: ListCapabilitiesToolInputSchema,
  invoke_construction: InvokeConstructionToolInputSchema,
  describe_construction: DescribeConstructionToolInputSchema,
  explain_operator: ExplainOperatorToolInputSchema,
  check_construction_types: CheckConstructionTypesToolInputSchema,
  get_change_impact: GetChangeImpactToolInputSchema,
  blast_radius: BlastRadiusToolInputSchema,
  pre_commit_check: PreCommitCheckToolInputSchema,
  librarian_completeness_check: LibrarianCompletenessCheckToolInputSchema,
  claim_work_scope: ClaimWorkScopeToolInputSchema,
  append_claim: AppendClaimToolInputSchema,
  query_claims: QueryClaimsToolInputSchema,
  harvest_session_knowledge: HarvestSessionKnowledgeToolInputSchema,
  memory_add: MemoryAddToolInputSchema,
  memory_search: MemorySearchToolInputSchema,
  memory_update: MemoryUpdateToolInputSchema,
  memory_delete: MemoryDeleteToolInputSchema,
  submit_feedback: SubmitFeedbackToolInputSchema,
  feedback_retrieval_result: FeedbackRetrievalResultToolInputSchema,
  get_retrieval_stats: GetRetrievalStatsToolInputSchema,
  get_exploration_suggestions: GetExplorationSuggestionsToolInputSchema,
  verify_claim: VerifyClaimToolInputSchema,
  find_callers: FindCallersToolInputSchema,
  find_callees: FindCalleesToolInputSchema,
  find_symbol: FindSymbolToolInputSchema,
  run_audit: RunAuditToolInputSchema,
  list_runs: ListRunsToolInputSchema,
  diff_runs: DiffRunsToolInputSchema,
  export_index: ExportIndexToolInputSchema,
  get_context_pack_bundle: GetContextPackBundleToolInputSchema,
  get_repo_map: GetRepoMapToolInputSchema,
  list_verification_plans: ListVerificationPlansToolInputSchema,
  list_episodes: ListEpisodesToolInputSchema,
  list_technique_primitives: ListTechniquePrimitivesToolInputSchema,
  list_technique_compositions: ListTechniqueCompositionsToolInputSchema,
  select_technique_compositions: SelectTechniqueCompositionsToolInputSchema,
  compile_technique_composition: CompileTechniqueCompositionToolInputSchema,
  compile_intent_bundles: CompileIntentBundlesToolInputSchema,
} as const;

export type ToolName = keyof typeof TOOL_INPUT_SCHEMAS;

// ============================================================================
// JSON SCHEMA REPRESENTATIONS
// ============================================================================

/** JSON Schema type definition (simplified for docs) */
export interface JSONSchema {
  $schema?: string;
  $id?: string;
  title?: string;
  description?: string;
  type: string;
  properties?: Record<string, JSONSchemaProperty>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface JSONSchemaProperty {
  type: string;
  description?: string;
  enum?: string[];
  items?: { type: string };
  properties?: Record<string, JSONSchemaProperty>;
  required?: string[];
  additionalProperties?: boolean;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  default?: unknown;
}

/** Bootstrap tool JSON Schema */
export const bootstrapToolJsonSchema: JSONSchema = {
  $schema: JSON_SCHEMA_DRAFT,
  $id: 'librarian://schemas/bootstrap-tool-input',
  title: 'BootstrapToolInput',
  description: 'Input for the bootstrap tool - indexes a workspace',
  type: 'object',
  properties: {
    workspace: { type: 'string', description: 'Absolute path to the workspace to bootstrap', minLength: 1 },
    force: { type: 'boolean', description: 'Force re-index even if cached data exists', default: false },
    include: { type: 'array', items: { type: 'string' }, description: 'Glob patterns for files to include' },
    exclude: { type: 'array', items: { type: 'string' }, description: 'Glob patterns for files to exclude' },
    llmProvider: { type: 'string', enum: ['claude', 'codex'], description: 'Preferred LLM provider' },
    maxFiles: { type: 'number', description: 'Maximum files to index', minimum: 1 },
    fileTimeoutMs: { type: 'number', description: 'Per-file timeout in ms (0 disables)', minimum: 0 },
    fileTimeoutRetries: { type: 'number', description: 'Retries per file on timeout', minimum: 0 },
    fileTimeoutPolicy: { type: 'string', enum: ['skip', 'retry', 'fail'], description: 'Policy after file timeout retries' },
  },
  required: ['workspace'],
  additionalProperties: false,
};

/** get_session_briefing tool JSON Schema */
export const getSessionBriefingToolJsonSchema: JSONSchema = {
  $schema: JSON_SCHEMA_DRAFT,
  $id: 'librarian://schemas/get-session-briefing-tool-input',
  title: 'GetSessionBriefingToolInput',
  description: 'Input for get_session_briefing - return high-signal session/workspace orientation to reduce startup token overhead',
  type: 'object',
  properties: {
    workspace: { type: 'string', description: 'Workspace path (optional, uses first available if not specified)' },
    sessionId: { type: 'string', description: 'Optional session identifier for session-scoped briefing details', minLength: 1 },
    includeConstructions: { type: 'boolean', description: 'Include construction onboarding hints in the response', default: true },
  },
  required: [],
  additionalProperties: false,
};

/** Query tool JSON Schema */
export const queryToolJsonSchema: JSONSchema = {
  $schema: JSON_SCHEMA_DRAFT,
  $id: 'librarian://schemas/query-tool-input',
  title: 'QueryToolInput',
  description: `Input for semantic, cross-file retrieval and impact-aware context generation. ${CONFIDENCE_BEHAVIOR_CONTRACT}`,
  type: 'object',
  properties: {
    intent: { type: 'string', description: 'Goal-oriented question about behavior, architecture, or impact (not a raw file-read request)', minLength: 1, maxLength: 2000 },
    workspace: { type: 'string', description: 'Workspace path (optional, uses first ready workspace if not specified)' },
    sessionId: { type: 'string', description: 'Optional session identifier used for loop detection and adaptive query behavior', minLength: 1 },
    intentType: { type: 'string', enum: ['understand', 'debug', 'refactor', 'impact', 'security', 'test', 'document', 'navigate', 'general'], description: 'Intent mode: understand=explain, impact=blast radius, debug=root-cause, refactor=safe changes, security=risk review, test=coverage/tests, document=docs summary, navigate=where to look, general=fallback' },
    affectedFiles: { type: 'array', items: { type: 'string' }, description: 'File paths to scope the query to' },
    contextHints: {
      type: 'object',
      description: 'Optional agent-state hints that bias retrieval toward active session topology, helping LiBrainian prioritize files and symbols related to active edits without rewriting the main intent.',
      properties: {
        active_file: { type: 'string', description: 'Absolute path of the active file' },
        active_symbol: { type: 'string', description: 'Active symbol in focus (function/class/module)' },
        recently_edited_files: { type: 'array', items: { type: 'string' }, description: 'Files recently edited in this session' },
        recent_tool_calls: { type: 'array', items: { type: 'string' }, description: 'Recent tool call names for trajectory hints' },
        conversation_context: { type: 'string', description: 'Recent conversation context snippet' },
      },
      additionalProperties: false,
    },
    context_hints: {
      type: 'object',
      description: 'Snake-case alias for contextHints with identical semantics so legacy clients can pass session topology hints and receive the same retrieval behavior.',
      properties: {
        active_file: { type: 'string' },
        active_symbol: { type: 'string' },
        recently_edited_files: { type: 'array', items: { type: 'string' } },
        recent_tool_calls: { type: 'array', items: { type: 'string' } },
        conversation_context: { type: 'string' },
      },
      additionalProperties: false,
    },
    filter: {
      type: 'object',
      description: 'Structured retrieval filter for path/language/export/test constraints',
      properties: {
        pathPrefix: { type: 'string', description: 'Workspace-relative path prefix (example: packages/api/)', minLength: 1 },
        language: { type: 'string', description: 'Language filter (example: typescript, python, rust)', minLength: 1 },
        isExported: { type: 'boolean', description: 'Filter for exported/public symbols' },
        isPure: { type: 'boolean', description: 'Filter for functions classified as pure/impure by behavioral heuristics' },
        excludeTests: { type: 'boolean', description: 'Exclude test/spec files from retrieval' },
        maxFileSizeBytes: { type: 'number', description: 'Optional max file size guard in bytes', minimum: 1 },
      },
      additionalProperties: false,
    },
    workingFile: { type: 'string', description: 'Active file path used for monorepo package-scope auto-detection', minLength: 1 },
    alpha: { type: 'number', description: 'Conformal error-rate target alpha in [0.01, 0.5]. Example: alpha=0.10 targets a 90% coverage guarantee and adjusts retrieval thresholds accordingly.', minimum: 0.01, maximum: 0.5 },
    recencyWeight: { type: 'number', description: 'Optional episodic recency-bias weight in [0,1]. Set 0 for cold retrieval, or increase toward 1 to bias toward recent session files that pass semantic relevance checks.', minimum: 0, maximum: 1 },
    recency_weight: { type: 'number', description: 'Snake-case alias for recencyWeight with identical semantics, preserving backward-compatible clients that prefer snake-case payload conventions.', minimum: 0, maximum: 1 },
    minConfidence: { type: 'number', description: `Minimum confidence threshold. ${CONFIDENCE_BEHAVIOR_CONTRACT}`, minimum: 0, maximum: 1, default: 0.5 },
    depth: { type: 'string', enum: ['L0', 'L1', 'L2', 'L3'], description: 'Depth of context', default: 'L1' },
    includeEngines: { type: 'boolean', description: 'Include engine results', default: false },
    includeEvidence: { type: 'boolean', description: 'Include evidence graph summary', default: false },
    pageSize: { type: 'number', description: 'Items per page (default: 20, max: 200)', minimum: 1, maximum: 200, default: 20 },
    pageIdx: { type: 'number', description: 'Zero-based page index (default: 0)', minimum: 0, default: 0 },
    outputFile: { type: 'string', description: 'Write paged response payload to file and return a file reference', minLength: 1 },
    explainMisses: { type: 'boolean', description: 'Include near-miss retrieval diagnostics', default: false },
    explain_misses: { type: 'boolean', description: 'Alias for explainMisses' },
    stream: { type: 'boolean', description: 'Enable chunked stream view metadata for progressive result consumption', default: false },
    streamChunkSize: { type: 'number', description: 'Chunk size for stream view metadata (default: 5, max: 200)', minimum: 1, maximum: 200, default: 5 },
  },
  required: ['intent'],
  additionalProperties: false,
};

/** librainian_get_uncertainty tool JSON Schema */
export const librainianGetUncertaintyToolJsonSchema: JSONSchema = {
  $schema: JSON_SCHEMA_DRAFT,
  $id: 'librarian://schemas/librainian-get-uncertainty-tool-input',
  title: 'LibrainianGetUncertaintyToolInput',
  description: 'Input for librainian_get_uncertainty - returns retrieval confidence/entropy diagnostics for a query',
  type: 'object',
  properties: {
    query: { type: 'string', description: 'Natural-language query to evaluate retrieval uncertainty for', minLength: 1, maxLength: 2000 },
    workspace: { type: 'string', description: 'Workspace path (optional, uses first ready workspace if not specified)' },
    depth: { type: 'string', enum: ['L0', 'L1', 'L2', 'L3'], description: 'Depth of context to retrieve for uncertainty scoring', default: 'L1' },
    minConfidence: { type: 'number', description: 'Minimum confidence threshold (0-1)', minimum: 0, maximum: 1, default: 0 },
    topK: { type: 'number', description: 'Maximum packs to include in uncertainty details', minimum: 1, maximum: 50, default: 10 },
  },
  required: ['query'],
  additionalProperties: false,
};

/** semantic_search tool JSON Schema */
export const semanticSearchToolJsonSchema: JSONSchema = {
  $schema: JSON_SCHEMA_DRAFT,
  $id: 'librarian://schemas/semantic-search-tool-input',
  title: 'SemanticSearchToolInput',
  description: `Input for semantic_search - primary semantic code localization. ${CONFIDENCE_BEHAVIOR_CONTRACT}`,
  type: 'object',
  properties: {
    query: { type: 'string', description: 'Localization query for semantic code search', minLength: 1, maxLength: 2000 },
    workspace: { type: 'string', description: 'Workspace path (optional, uses first ready workspace if not specified)' },
    sessionId: { type: 'string', description: 'Optional session identifier used for loop detection and adaptive search behavior', minLength: 1 },
    filter: {
      type: 'object',
      description: 'Structured retrieval filter for path/language/export/test constraints',
      properties: {
        pathPrefix: { type: 'string', description: 'Workspace-relative path prefix (example: packages/api/)', minLength: 1 },
        language: { type: 'string', description: 'Language filter (example: typescript, python, rust)', minLength: 1 },
        isExported: { type: 'boolean', description: 'Filter for exported/public symbols' },
        isPure: { type: 'boolean', description: 'Filter for functions classified as pure/impure by behavioral heuristics' },
        excludeTests: { type: 'boolean', description: 'Exclude test/spec files from retrieval' },
        maxFileSizeBytes: { type: 'number', description: 'Optional max file size guard in bytes', minimum: 1 },
      },
      additionalProperties: false,
    },
    workingFile: { type: 'string', description: 'Active file path used for monorepo package-scope auto-detection', minLength: 1 },
    minConfidence: { type: 'number', description: `Minimum confidence threshold. ${CONFIDENCE_BEHAVIOR_CONTRACT}`, minimum: 0, maximum: 1, default: 0.4 },
    depth: { type: 'string', enum: ['L0', 'L1', 'L2', 'L3'], description: 'Depth of context', default: 'L1' },
    limit: { type: 'number', description: 'Maximum results to return (default: 20, max: 200)', minimum: 1, maximum: 200, default: 20 },
    includeEngines: { type: 'boolean', description: 'Include engine diagnostics in output', default: false },
    includeEvidence: { type: 'boolean', description: 'Include evidence graph summary', default: false },
  },
  required: ['query'],
  additionalProperties: false,
};

/** validate_import tool JSON Schema */
export const validateImportToolJsonSchema: JSONSchema = {
  $schema: JSON_SCHEMA_DRAFT,
  $id: 'librarian://schemas/validate-import-tool-input',
  title: 'ValidateImportToolInput',
  description: 'Input for validate_import - validate package exports and members against local node_modules declarations',
  type: 'object',
  properties: {
    package: { type: 'string', description: 'Package specifier to validate (e.g. axios, next/router, @scope/pkg)', minLength: 1 },
    importName: { type: 'string', description: 'Export/symbol name to validate from the package', minLength: 1 },
    memberName: { type: 'string', description: 'Optional class/interface member to validate (method/property)', minLength: 1 },
    workspace: { type: 'string', description: 'Workspace path (optional, uses first available if not specified)' },
    context: { type: 'string', description: 'Optional intent/context text used for richer diagnostics', minLength: 1, maxLength: 2000 },
  },
  required: ['package', 'importName'],
  additionalProperties: false,
};

/** get_context_pack tool JSON Schema */
export const getContextPackToolJsonSchema: JSONSchema = {
  $schema: JSON_SCHEMA_DRAFT,
  $id: 'librarian://schemas/get-context-pack-tool-input',
  title: 'GetContextPackToolInput',
  description: 'Input for get_context_pack - token-budgeted context pack assembly for a task intent',
  type: 'object',
  properties: {
    intent: { type: 'string', description: 'Task intent used for context pack retrieval', minLength: 1, maxLength: 2000 },
    relevantFiles: { type: 'array', items: { type: 'string' }, description: 'Optional relevant file hints for retrieval focus' },
    tokenBudget: { type: 'number', description: 'Hard token budget for assembled context output', minimum: 100, maximum: 50000, default: 4000 },
    workdir: { type: 'string', description: 'Working directory hint for workspace resolution' },
    workspace: { type: 'string', description: 'Workspace path alias for callers that already have it' },
  },
  required: ['intent'],
  additionalProperties: false,
};

/** estimate_budget tool JSON Schema */
export const estimateBudgetToolJsonSchema: JSONSchema = {
  $schema: JSON_SCHEMA_DRAFT,
  $id: 'librarian://schemas/estimate-budget-tool-input',
  title: 'EstimateBudgetToolInput',
  description: 'Input for estimate_budget - pre-task token feasibility estimation and safer fallback recommendations',
  type: 'object',
  properties: {
    taskDescription: { type: 'string', description: 'Task description to estimate before execution', minLength: 1, maxLength: 4000 },
    availableTokens: { type: 'number', description: 'Available token budget before compaction', minimum: 1, maximum: 1000000 },
    workdir: { type: 'string', description: 'Working directory hint for workspace resolution' },
    pipeline: { type: 'array', items: { type: 'string' }, description: 'Optional explicit pipeline/tool sequence for estimation' },
    workspace: { type: 'string', description: 'Workspace path alias for callers that already have it' },
  },
  required: ['taskDescription', 'availableTokens'],
  additionalProperties: false,
};

/** estimate_task_complexity tool JSON Schema */
export const estimateTaskComplexityToolJsonSchema: JSONSchema = {
  $schema: JSON_SCHEMA_DRAFT,
  $id: 'librarian://schemas/estimate-task-complexity-tool-input',
  title: 'EstimateTaskComplexityToolInput',
  description: 'Input for estimate_task_complexity - pre-dispatch routing estimate for complexity, model tier, and confidence',
  type: 'object',
  properties: {
    task: { type: 'string', description: 'Task statement to classify for routing complexity', minLength: 1, maxLength: 4000 },
    workdir: { type: 'string', description: 'Working directory hint for workspace resolution' },
    workspace: { type: 'string', description: 'Workspace path alias for callers that already have it' },
    recentFiles: { type: 'array', items: { type: 'string' }, description: 'Optional recently touched files used as routing hints' },
    functionId: { type: 'string', description: 'Optional primary function target for blast-radius estimation', minLength: 1 },
  },
  required: ['task'],
  additionalProperties: false,
};

/** get_change_impact tool JSON Schema */
export const getChangeImpactToolJsonSchema: JSONSchema = {
  $schema: JSON_SCHEMA_DRAFT,
  $id: 'librarian://schemas/get-change-impact-tool-input',
  title: 'GetChangeImpactToolInput',
  description: 'Input for get_change_impact - ranked blast-radius and risk analysis for a proposed change',
  type: 'object',
  properties: {
    target: { type: 'string', description: 'Changed file/module/function identifier to analyze', minLength: 1 },
    workspace: { type: 'string', description: 'Workspace path (optional, uses first available if not specified)' },
    depth: { type: 'number', description: 'Maximum transitive depth for propagation (default: 3, max: 8)', minimum: 1, maximum: 8, default: 3 },
    maxResults: { type: 'number', description: 'Maximum impacted files to return (default: 200, max: 1000)', minimum: 1, maximum: 1000, default: 200 },
    changeType: { type: 'string', enum: ['modify', 'delete', 'rename', 'move'], description: 'Optional change type to refine risk scoring' },
  },
  required: ['target'],
  additionalProperties: false,
};

/** blast_radius tool JSON Schema */
export const blastRadiusToolJsonSchema: JSONSchema = {
  $schema: JSON_SCHEMA_DRAFT,
  $id: 'librarian://schemas/blast-radius-tool-input',
  title: 'BlastRadiusToolInput',
  description: 'Input for blast_radius - pre-edit transitive impact analysis (alias for get_change_impact)',
  type: 'object',
  properties: {
    target: { type: 'string', description: 'Changed file/module/function identifier to analyze', minLength: 1 },
    workspace: { type: 'string', description: 'Workspace path (optional, uses first available if not specified)' },
    depth: { type: 'number', description: 'Maximum transitive depth for propagation (default: 3, max: 8)', minimum: 1, maximum: 8, default: 3 },
    maxResults: { type: 'number', description: 'Maximum impacted files to return (default: 200, max: 1000)', minimum: 1, maximum: 1000, default: 200 },
    changeType: { type: 'string', enum: ['modify', 'delete', 'rename', 'move'], description: 'Optional change type to refine risk scoring' },
  },
  required: ['target'],
  additionalProperties: false,
};

/** pre_commit_check tool JSON Schema */
export const preCommitCheckToolJsonSchema: JSONSchema = {
  $schema: JSON_SCHEMA_DRAFT,
  $id: 'librarian://schemas/pre-commit-check-tool-input',
  title: 'PreCommitCheckToolInput',
  description: 'Input for pre_commit_check - semantic gate for changed files before submit',
  type: 'object',
  properties: {
    changedFiles: { type: 'array', items: { type: 'string' }, description: 'Changed files to evaluate before submit', minItems: 1 },
    workspace: { type: 'string', description: 'Workspace path (optional, uses first available if not specified)' },
    strict: { type: 'boolean', description: 'Enforce stricter pass criteria', default: false },
    maxRiskLevel: { type: 'string', enum: ['low', 'medium', 'high', 'critical'], description: 'Maximum acceptable risk level for pass', default: 'high' },
  },
  required: ['changedFiles'],
  additionalProperties: false,
};

/** claim_work_scope tool JSON Schema */
export const claimWorkScopeToolJsonSchema: JSONSchema = {
  $schema: JSON_SCHEMA_DRAFT,
  $id: 'librarian://schemas/claim-work-scope-tool-input',
  title: 'ClaimWorkScopeToolInput',
  description: 'Input for claim_work_scope - semantic coordination primitive for parallel agents',
  type: 'object',
  properties: {
    scopeId: { type: 'string', description: 'Semantic scope identifier (file, module, symbol, or task scope key)', minLength: 1 },
    workspace: { type: 'string', description: 'Workspace path (optional, used to namespace scope claims)' },
    sessionId: { type: 'string', description: 'Optional session identifier for ownership', minLength: 1 },
    owner: { type: 'string', description: 'Optional owner label (agent name/id)', minLength: 1 },
    mode: { type: 'string', enum: ['claim', 'release', 'check'], description: 'Claim operation mode', default: 'claim' },
    ttlSeconds: { type: 'number', description: 'Claim expiration window in seconds (claim mode only)', minimum: 1, maximum: 86400, default: 1800 },
  },
  required: ['scopeId'],
  additionalProperties: false,
};

/** append_claim tool JSON Schema */
export const appendClaimToolJsonSchema: JSONSchema = {
  $schema: JSON_SCHEMA_DRAFT,
  $id: 'librarian://schemas/append-claim-tool-input',
  title: 'AppendClaimToolInput',
  description: 'Input for append_claim - persist session knowledge claims for later retrieval and harvest',
  type: 'object',
  properties: {
    claim: { type: 'string', description: 'Claim text to persist for later retrieval and session harvest', minLength: 1 },
    workspace: { type: 'string', description: 'Workspace path (optional, used for namespacing and audit logs)' },
    sessionId: { type: 'string', description: 'Optional session identifier that owns this claim', minLength: 1 },
    tags: { type: 'array', items: { type: 'string' }, description: 'Optional semantic tags for filtering and harvest summaries' },
    evidence: { type: 'array', items: { type: 'string' }, description: 'Optional evidence snippets, IDs, or citations supporting the claim' },
    confidence: { type: 'number', description: 'Optional confidence score in [0,1]', minimum: 0, maximum: 1, default: 0.6 },
    sourceTool: { type: 'string', description: 'Optional source tool name that produced this claim', minLength: 1 },
  },
  required: ['claim'],
  additionalProperties: false,
};

/** query_claims tool JSON Schema */
export const queryClaimsToolJsonSchema: JSONSchema = {
  $schema: JSON_SCHEMA_DRAFT,
  $id: 'librarian://schemas/query-claims-tool-input',
  title: 'QueryClaimsToolInput',
  description: 'Input for query_claims - filter and retrieve previously appended knowledge claims',
  type: 'object',
  properties: {
    query: { type: 'string', description: 'Optional text query over claim, evidence, and tag fields', minLength: 1, maxLength: 2000 },
    workspace: { type: 'string', description: 'Workspace path filter (optional)' },
    sessionId: { type: 'string', description: 'Optional session identifier filter', minLength: 1 },
    tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags filter (matches any provided tag)' },
    since: { type: 'string', description: 'Optional ISO timestamp lower bound for createdAt filtering', minLength: 1 },
    limit: { type: 'number', description: 'Maximum claims to return (default: 20, max: 200)', minimum: 1, maximum: 200, default: 20 },
  },
  required: [],
  additionalProperties: false,
};

/** harvest_session_knowledge tool JSON Schema */
export const harvestSessionKnowledgeToolJsonSchema: JSONSchema = {
  $schema: JSON_SCHEMA_DRAFT,
  $id: 'librarian://schemas/harvest-session-knowledge-tool-input',
  title: 'HarvestSessionKnowledgeToolInput',
  description: 'Input for harvest_session_knowledge - summarize high-confidence claims for a session/workspace',
  type: 'object',
  properties: {
    sessionId: { type: 'string', description: 'Session to harvest claims from (optional)', minLength: 1 },
    workspace: { type: 'string', description: 'Workspace path filter (optional)' },
    maxItems: { type: 'number', description: 'Maximum harvested claims to include (default: 20, max: 200)', minimum: 1, maximum: 200, default: 20 },
    minConfidence: { type: 'number', description: 'Minimum confidence threshold in [0,1]', minimum: 0, maximum: 1, default: 0 },
    includeRecommendations: { type: 'boolean', description: 'Include recommended next tools in output', default: true },
    memoryFilePath: { type: 'string', description: 'Optional explicit MEMORY.md path for memory-bridge sync', minLength: 1 },
    openclawRoot: { type: 'string', description: 'Optional OpenClaw root path used when memoryFilePath is omitted', minLength: 1 },
    persistToMemory: { type: 'boolean', description: 'Persist harvested claims to annotated MEMORY.md', default: true },
    source: { type: 'string', enum: ['openclaw-session', 'manual', 'harvest'], description: 'Memory-bridge source label', default: 'harvest' },
  },
  required: [],
  additionalProperties: false,
};

/** memory_add tool JSON Schema */
export const memoryAddToolJsonSchema: JSONSchema = {
  $schema: JSON_SCHEMA_DRAFT,
  $id: 'librarian://schemas/memory-add-tool-input',
  title: 'MemoryAddToolInput',
  description: 'Input for memory_add - persist a semantic memory fact',
  type: 'object',
  properties: {
    content: { type: 'string', description: 'Memory fact content to persist', minLength: 1 },
    workspace: { type: 'string', description: 'Workspace path (optional)' },
    scope: { type: 'string', enum: ['codebase', 'module', 'function'], description: 'Memory scope', default: 'codebase' },
    scopeKey: { type: 'string', description: 'Optional scope key (module path or symbol ID)', minLength: 1 },
    source: { type: 'string', enum: ['agent', 'analysis', 'user'], description: 'Fact source', default: 'agent' },
    confidence: { type: 'number', description: 'Confidence score in [0,1]', minimum: 0, maximum: 1, default: 0.7 },
    evergreen: { type: 'boolean', description: 'Disable age decay for this fact', default: false },
  },
  required: ['content'],
  additionalProperties: false,
};

/** memory_search tool JSON Schema */
export const memorySearchToolJsonSchema: JSONSchema = {
  $schema: JSON_SCHEMA_DRAFT,
  $id: 'librarian://schemas/memory-search-tool-input',
  title: 'MemorySearchToolInput',
  description: 'Input for memory_search - retrieve semantically relevant memory facts',
  type: 'object',
  properties: {
    query: { type: 'string', description: 'Semantic query for memory facts', minLength: 1 },
    workspace: { type: 'string', description: 'Workspace path (optional)' },
    scopeKey: { type: 'string', description: 'Optional scope key filter', minLength: 1 },
    limit: { type: 'number', description: 'Maximum facts to return', minimum: 1, maximum: 200, default: 10 },
    minScore: { type: 'number', description: 'Minimum scored threshold', minimum: 0, maximum: 1, default: 0.1 },
  },
  required: ['query'],
  additionalProperties: false,
};

/** memory_update tool JSON Schema */
export const memoryUpdateToolJsonSchema: JSONSchema = {
  $schema: JSON_SCHEMA_DRAFT,
  $id: 'librarian://schemas/memory-update-tool-input',
  title: 'MemoryUpdateToolInput',
  description: 'Input for memory_update - update an existing memory fact',
  type: 'object',
  properties: {
    id: { type: 'string', description: 'Memory fact ID', minLength: 1 },
    content: { type: 'string', description: 'Updated memory content', minLength: 1 },
    workspace: { type: 'string', description: 'Workspace path (optional)' },
  },
  required: ['id', 'content'],
  additionalProperties: false,
};

/** memory_delete tool JSON Schema */
export const memoryDeleteToolJsonSchema: JSONSchema = {
  $schema: JSON_SCHEMA_DRAFT,
  $id: 'librarian://schemas/memory-delete-tool-input',
  title: 'MemoryDeleteToolInput',
  description: 'Input for memory_delete - delete a memory fact',
  type: 'object',
  properties: {
    id: { type: 'string', description: 'Memory fact ID', minLength: 1 },
    workspace: { type: 'string', description: 'Workspace path (optional)' },
  },
  required: ['id'],
  additionalProperties: false,
};

/** Submit feedback tool JSON Schema */
export const submitFeedbackToolJsonSchema: JSONSchema = {
  $schema: JSON_SCHEMA_DRAFT,
  $id: 'librarian://schemas/submit-feedback-tool-input',
  title: 'SubmitFeedbackToolInput',
  description: 'Input for the submit_feedback tool - records agent feedback for a query',
  type: 'object',
  properties: {
    feedbackToken: { type: 'string', description: 'Feedback token from query response', minLength: 1 },
    outcome: { type: 'string', enum: ['success', 'failure', 'partial'], description: 'Task outcome' },
    workspace: { type: 'string', description: 'Workspace path' },
    agentId: { type: 'string', description: 'Agent identifier' },
    predictionId: { type: 'string', description: 'Optional prediction ID when feedback resolves a human review' },
    missingContext: { type: 'string', description: 'Description of missing context' },
    customRatings: { type: 'array', items: { type: 'string' }, description: 'Optional per-pack ratings' },
  },
  required: ['feedbackToken', 'outcome'],
  additionalProperties: false,
};

/** feedback_retrieval_result tool JSON Schema */
export const feedbackRetrievalResultToolJsonSchema: JSONSchema = {
  $schema: JSON_SCHEMA_DRAFT,
  $id: 'librarian://schemas/feedback-retrieval-result-tool-input',
  title: 'FeedbackRetrievalResultToolInput',
  description: 'Input for feedback_retrieval_result - submit retrieval helpfulness outcome from a query feedback token',
  type: 'object',
  properties: {
    feedbackToken: { type: 'string', description: 'Feedback token from query response', minLength: 1 },
    wasHelpful: { type: 'boolean', description: 'Whether retrieved context was helpful' },
    workspace: { type: 'string', description: 'Workspace path' },
    agentId: { type: 'string', description: 'Agent identifier' },
    missingContext: { type: 'string', description: 'Description of missing context' },
  },
  required: ['feedbackToken', 'wasHelpful'],
  additionalProperties: false,
};

/** get_retrieval_stats tool JSON Schema */
export const getRetrievalStatsToolJsonSchema: JSONSchema = {
  $schema: JSON_SCHEMA_DRAFT,
  $id: 'librarian://schemas/get-retrieval-stats-tool-input',
  title: 'GetRetrievalStatsToolInput',
  description: 'Input for get_retrieval_stats - summarize retrieval strategy routing outcomes and rewards',
  type: 'object',
  properties: {
    workspace: { type: 'string', description: 'Workspace path' },
    intentType: { type: 'string', description: 'Optional retrieval intent type filter', minLength: 1 },
    limit: { type: 'number', description: 'Maximum selection events to return', minimum: 1, maximum: 1000, default: 200 },
  },
  required: [],
  additionalProperties: false,
};

/** get_exploration_suggestions tool JSON Schema */
export const getExplorationSuggestionsToolJsonSchema: JSONSchema = {
  $schema: JSON_SCHEMA_DRAFT,
  $id: 'librarian://schemas/get-exploration-suggestions-tool-input',
  title: 'GetExplorationSuggestionsToolInput',
  description: 'Input for get_exploration_suggestions - surface high-centrality low-query dark zones for exploration',
  type: 'object',
  properties: {
    workspace: { type: 'string', description: 'Workspace path' },
    entityType: { type: 'string', enum: ['function', 'module'], description: 'Entity type filter', default: 'module' },
    limit: { type: 'number', description: 'Maximum suggestions to return', minimum: 1, maximum: 200, default: 5 },
  },
  required: [],
  additionalProperties: false,
};

/** Explain function tool JSON Schema */
export const explainFunctionToolJsonSchema: JSONSchema = {
  $schema: JSON_SCHEMA_DRAFT,
  $id: 'librarian://schemas/explain-function-tool-input',
  title: 'ExplainFunctionToolInput',
  description: 'Input for explain_function - return focused symbol-level context for a function',
  type: 'object',
  properties: {
    name: { type: 'string', description: 'Function name or function ID to explain', minLength: 1, maxLength: 500 },
    filePath: { type: 'string', description: 'Optional file path for disambiguation when names collide' },
    workspace: { type: 'string', description: 'Workspace path (optional, uses first ready workspace if not specified)' },
  },
  required: ['name'],
  additionalProperties: false,
};

/** Find callers tool JSON Schema */
export const findCallersToolJsonSchema: JSONSchema = {
  $schema: JSON_SCHEMA_DRAFT,
  $id: 'librarian://schemas/find-callers-tool-input',
  title: 'FindCallersToolInput',
  description: 'Input for find_callers - return direct or transitive caller callsites for a function',
  type: 'object',
  properties: {
    functionId: { type: 'string', description: 'Target function ID or name to locate callers for', minLength: 1, maxLength: 500 },
    workspace: { type: 'string', description: 'Workspace path (optional, uses first ready workspace if not specified)' },
    transitive: { type: 'boolean', description: 'Include transitive callers (callers-of-callers)', default: false },
    maxDepth: { type: 'number', description: 'Maximum transitive caller depth when transitive is enabled', minimum: 1, maximum: 8, default: 3 },
    limit: { type: 'number', description: 'Maximum caller callsites to return (default: 100, max: 500)', minimum: 1, maximum: 500, default: 100 },
  },
  required: ['functionId'],
  additionalProperties: false,
};

/** Find callees tool JSON Schema */
export const findCalleesToolJsonSchema: JSONSchema = {
  $schema: JSON_SCHEMA_DRAFT,
  $id: 'librarian://schemas/find-callees-tool-input',
  title: 'FindCalleesToolInput',
  description: 'Input for find_callees - return direct callees for a function',
  type: 'object',
  properties: {
    functionId: { type: 'string', description: 'Target function ID or name to locate callees for', minLength: 1, maxLength: 500 },
    workspace: { type: 'string', description: 'Workspace path (optional, uses first ready workspace if not specified)' },
    limit: { type: 'number', description: 'Maximum callees to return (default: 100, max: 500)', minimum: 1, maximum: 500, default: 100 },
  },
  required: ['functionId'],
  additionalProperties: false,
};

/** Find usages tool JSON Schema */
export const findUsagesToolJsonSchema: JSONSchema = {
  $schema: JSON_SCHEMA_DRAFT,
  $id: 'librarian://schemas/find-usages-tool-input',
  title: 'FindUsagesToolInput',
  description: 'Input for find_usages - return symbol callsites and usage files',
  type: 'object',
  properties: {
    symbol: { type: 'string', description: 'Function name or function ID to locate call sites for', minLength: 1, maxLength: 500 },
    workspace: { type: 'string', description: 'Workspace path (optional, uses first ready workspace if not specified)' },
    limit: { type: 'number', description: 'Maximum callsite records to return (default: 100, max: 500)', minimum: 1, maximum: 500, default: 100 },
  },
  required: ['symbol'],
  additionalProperties: false,
};

/** Trace imports tool JSON Schema */
export const traceImportsToolJsonSchema: JSONSchema = {
  $schema: JSON_SCHEMA_DRAFT,
  $id: 'librarian://schemas/trace-imports-tool-input',
  title: 'TraceImportsToolInput',
  description: 'Input for trace_imports - walk import and importedBy relationships for a file',
  type: 'object',
  properties: {
    filePath: { type: 'string', description: 'File path to trace dependencies from', minLength: 1 },
    direction: { type: 'string', enum: ['imports', 'importedBy', 'both'], description: 'Trace imports, importers, or both' },
    depth: { type: 'number', description: 'Maximum dependency depth (default: 2, max: 6)', minimum: 1, maximum: 6, default: 2 },
    workspace: { type: 'string', description: 'Workspace path (optional, uses first ready workspace if not specified)' },
  },
  required: ['filePath'],
  additionalProperties: false,
};

/** Trace control flow tool JSON Schema */
export const traceControlFlowToolJsonSchema: JSONSchema = {
  $schema: JSON_SCHEMA_DRAFT,
  $id: 'librarian://schemas/trace-control-flow-tool-input',
  title: 'TraceControlFlowToolInput',
  description: 'Input for trace_control_flow - return CFG/basic-block sequence for a function',
  type: 'object',
  properties: {
    functionId: { type: 'string', description: 'Target function ID or name to trace control flow for', minLength: 1, maxLength: 500 },
    workspace: { type: 'string', description: 'Workspace path (optional, uses first ready workspace if not specified)' },
    maxBlocks: { type: 'number', description: 'Maximum basic blocks to return (default: 200, max: 1000)', minimum: 1, maximum: 1000, default: 200 },
  },
  required: ['functionId'],
  additionalProperties: false,
};

/** Trace data flow tool JSON Schema */
export const traceDataFlowToolJsonSchema: JSONSchema = {
  $schema: JSON_SCHEMA_DRAFT,
  $id: 'librarian://schemas/trace-data-flow-tool-input',
  title: 'TraceDataFlowToolInput',
  description: 'Input for trace_data_flow - return source-to-sink data flow evidence',
  type: 'object',
  properties: {
    source: { type: 'string', description: 'Source expression or variable (for example: req.params.userId)', minLength: 1, maxLength: 500 },
    sink: { type: 'string', description: 'Sink function or expression (for example: db.query)', minLength: 1, maxLength: 500 },
    functionId: { type: 'string', description: 'Optional function ID or name to scope tracing', minLength: 1, maxLength: 500 },
    workspace: { type: 'string', description: 'Workspace path (optional, uses first ready workspace if not specified)' },
  },
  required: ['source', 'sink'],
  additionalProperties: false,
};

/** Reset session state tool JSON Schema */
export const resetSessionStateToolJsonSchema: JSONSchema = {
  $schema: JSON_SCHEMA_DRAFT,
  $id: 'librarian://schemas/reset-session-state-tool-input',
  title: 'ResetSessionStateToolInput',
  description: 'Input for reset_session_state - clears session-scoped query loop detection history',
  type: 'object',
  properties: {
    sessionId: { type: 'string', description: 'Session ID to reset', minLength: 1 },
    workspace: { type: 'string', description: 'Workspace hint for anonymous session fallback' },
  },
  required: [],
  additionalProperties: false,
};

/** Synthesize plan tool JSON Schema */
export const synthesizePlanToolJsonSchema: JSONSchema = {
  $schema: JSON_SCHEMA_DRAFT,
  $id: 'librarian://schemas/synthesize-plan-tool-input',
  title: 'SynthesizePlanToolInput',
  description: 'Input for synthesize_plan - persist an explicit task plan grounded in retrieved context packs',
  type: 'object',
  properties: {
    task: { type: 'string', description: 'Task description the agent is planning to execute', minLength: 1, maxLength: 2000 },
    context_pack_ids: { type: 'array', items: { type: 'string' }, description: 'Context pack IDs that informed the plan', minItems: 1 },
    workspace: { type: 'string', description: 'Workspace path (optional, uses first available if not specified)' },
    sessionId: { type: 'string', description: 'Optional session identifier used to persist and retrieve plan state', minLength: 1 },
  },
  required: ['task', 'context_pack_ids'],
  additionalProperties: false,
};

/** Request human review tool JSON Schema */
export const requestHumanReviewToolJsonSchema: JSONSchema = {
  $schema: JSON_SCHEMA_DRAFT,
  $id: 'librarian://schemas/request-human-review-tool-input',
  title: 'RequestHumanReviewToolInput',
  description: 'Input for request_human_review - structured human escalation for uncertain or risky agent actions',
  type: 'object',
  properties: {
    reason: { type: 'string', description: 'Why human review is needed', minLength: 1 },
    context_summary: { type: 'string', description: 'Summary of uncertain or conflicting context', minLength: 1 },
    proposed_action: { type: 'string', description: 'Action the agent was about to take', minLength: 1 },
    confidence_tier: { type: 'string', enum: ['low', 'uncertain'], description: 'Confidence tier requiring escalation' },
    risk_level: { type: 'string', enum: ['low', 'medium', 'high'], description: 'Risk if the action is wrong' },
    blocking: { type: 'boolean', description: 'Whether the agent should pause for human response' },
  },
  required: ['reason', 'context_summary', 'proposed_action', 'confidence_tier', 'risk_level', 'blocking'],
  additionalProperties: false,
};

/** List constructions tool JSON Schema */
export const listConstructionsToolJsonSchema: JSONSchema = {
  $schema: JSON_SCHEMA_DRAFT,
  $id: 'librarian://schemas/list-constructions-tool-input',
  title: 'ListConstructionsToolInput',
  description: 'Input for list_constructions - discover registered constructions and their manifests',
  type: 'object',
  properties: {
    tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags to filter constructions' },
    capabilities: { type: 'array', items: { type: 'string' }, description: 'Optional required capabilities filter' },
    requires: { type: 'array', items: { type: 'string' }, description: 'Alias for capabilities filter' },
    language: { type: 'string', description: 'Optional language filter (for example: typescript, python, rust)' },
    trustTier: { type: 'string', enum: ['official', 'partner', 'community'], description: 'Optional trust tier filter' },
    availableOnly: { type: 'boolean', description: 'Only return constructions executable in this runtime', default: false },
  },
  required: [],
  additionalProperties: false,
};

/** List capabilities tool JSON Schema */
export const listCapabilitiesToolJsonSchema: JSONSchema = {
  $id: 'librarian://schemas/list-capabilities-tool-input',
  type: 'object',
  description: 'Input for list_capabilities - return a versioned capability inventory for MCP tools, constructions, and compositions',
  properties: {
    workspace: { type: 'string', description: 'Workspace path used to resolve workspace-scoped compositions' },
  },
  required: [],
  additionalProperties: false,
};

/** Invoke construction tool JSON Schema */
export const invokeConstructionToolJsonSchema: JSONSchema = {
  $schema: JSON_SCHEMA_DRAFT,
  $id: 'librarian://schemas/invoke-construction-tool-input',
  title: 'InvokeConstructionToolInput',
  description: 'Input for invoke_construction - execute a registered construction by ID',
  type: 'object',
  properties: {
    constructionId: { type: 'string', description: 'Construction ID from list_constructions', minLength: 1 },
    input: { type: 'object', description: 'Construction input payload' },
    workspace: { type: 'string', description: 'Workspace path used to resolve runtime dependencies' },
  },
  required: ['constructionId', 'input'],
  additionalProperties: false,
};

/** Describe construction tool JSON Schema */
export const describeConstructionToolJsonSchema: JSONSchema = {
  $schema: JSON_SCHEMA_DRAFT,
  $id: 'librarian://schemas/describe-construction-tool-input',
  title: 'DescribeConstructionToolInput',
  description: 'Input for describe_construction - retrieve detailed construction metadata and usage guidance',
  type: 'object',
  properties: {
    id: { type: 'string', description: 'Construction ID to describe', minLength: 1 },
    includeExample: { type: 'boolean', description: 'Include an executable example code snippet', default: true },
    includeCompositionHints: { type: 'boolean', description: 'Include composition/operator hints', default: true },
  },
  required: ['id'],
  additionalProperties: false,
};

/** Explain operator tool JSON Schema */
export const explainOperatorToolJsonSchema: JSONSchema = {
  $schema: JSON_SCHEMA_DRAFT,
  $id: 'librarian://schemas/explain-operator-tool-input',
  title: 'ExplainOperatorToolInput',
  description: 'Input for explain_operator - explain or recommend construction operators',
  type: 'object',
  properties: {
    operator: { type: 'string', enum: ['seq', 'fanout', 'fallback', 'fix', 'select', 'atom', 'dimap', 'map', 'contramap'], description: 'Operator to explain directly' },
    situation: { type: 'string', description: 'Situation description used for operator recommendation', minLength: 1 },
  },
  required: [],
  additionalProperties: false,
};

/** Check construction types tool JSON Schema */
export const checkConstructionTypesToolJsonSchema: JSONSchema = {
  $schema: JSON_SCHEMA_DRAFT,
  $id: 'librarian://schemas/check-construction-types-tool-input',
  title: 'CheckConstructionTypesToolInput',
  description: 'Input for check_construction_types - verify composition compatibility for two constructions',
  type: 'object',
  properties: {
    first: { type: 'string', description: 'First construction ID', minLength: 1 },
    second: { type: 'string', description: 'Second construction ID', minLength: 1 },
    operator: { type: 'string', enum: ['seq', 'fanout', 'fallback'], description: 'Composition operator to check' },
  },
  required: ['first', 'second', 'operator'],
  additionalProperties: false,
};

/** Find symbol tool JSON Schema */
export const findSymbolToolJsonSchema: JSONSchema = {
  $schema: JSON_SCHEMA_DRAFT,
  $id: 'librarian://schemas/find-symbol-tool-input',
  title: 'FindSymbolToolInput',
  description: 'Input for find_symbol - discover opaque IDs for downstream MCP tools',
  type: 'object',
  properties: {
    query: { type: 'string', description: 'Human-readable function, module, claim, composition, or run query', minLength: 1, maxLength: 500 },
    kind: { type: 'string', enum: ['function', 'module', 'context_pack', 'claim', 'composition', 'run'], description: 'Optional category filter for symbol discovery' },
    workspace: { type: 'string', description: 'Workspace path (optional, uses first ready workspace if not specified)' },
    limit: { type: 'number', description: 'Maximum matches to return (default: 20, max: 200)', minimum: 1, maximum: 200, default: 20 },
  },
  required: ['query'],
  additionalProperties: false,
};

/** get_repo_map tool JSON Schema */
export const getRepoMapToolJsonSchema: JSONSchema = {
  $schema: JSON_SCHEMA_DRAFT,
  $id: 'librarian://schemas/get-repo-map-tool-input',
  title: 'GetRepoMapToolInput',
  description: 'Input for get_repo_map - compact PageRank-ranked repository map for fast orientation',
  type: 'object',
  properties: {
    workspace: { type: 'string', description: 'Workspace path (optional, uses first ready workspace if not specified)' },
    maxTokens: { type: 'number', description: 'Token budget cap for repo map output', minimum: 128, maximum: 50000, default: 4096 },
    focus: { type: 'array', items: { type: 'string' }, description: 'Optional file/path focus hints that boost matching entries', minItems: 1 },
    style: { type: 'string', enum: ['compact', 'detailed', 'json'], description: 'Output style', default: 'compact' },
  },
  required: [],
  additionalProperties: false,
};

/** All JSON schemas */
export const JSON_SCHEMAS: Record<string, JSONSchema> = {
  bootstrap: bootstrapToolJsonSchema,
  get_session_briefing: getSessionBriefingToolJsonSchema,
  semantic_search: semanticSearchToolJsonSchema,
  validate_import: validateImportToolJsonSchema,
  get_context_pack: getContextPackToolJsonSchema,
  estimate_budget: estimateBudgetToolJsonSchema,
  estimate_task_complexity: estimateTaskComplexityToolJsonSchema,
  query: queryToolJsonSchema,
  librainian_get_uncertainty: librainianGetUncertaintyToolJsonSchema,
  explain_function: explainFunctionToolJsonSchema,
  find_callers: findCallersToolJsonSchema,
  find_callees: findCalleesToolJsonSchema,
  find_usages: findUsagesToolJsonSchema,
  trace_imports: traceImportsToolJsonSchema,
  trace_control_flow: traceControlFlowToolJsonSchema,
  trace_data_flow: traceDataFlowToolJsonSchema,
  synthesize_plan: synthesizePlanToolJsonSchema,
  reset_session_state: resetSessionStateToolJsonSchema,
  request_human_review: requestHumanReviewToolJsonSchema,
  list_constructions: listConstructionsToolJsonSchema,
  list_capabilities: listCapabilitiesToolJsonSchema,
  invoke_construction: invokeConstructionToolJsonSchema,
  describe_construction: describeConstructionToolJsonSchema,
  explain_operator: explainOperatorToolJsonSchema,
  check_construction_types: checkConstructionTypesToolJsonSchema,
  get_change_impact: getChangeImpactToolJsonSchema,
  blast_radius: blastRadiusToolJsonSchema,
  pre_commit_check: preCommitCheckToolJsonSchema,
  claim_work_scope: claimWorkScopeToolJsonSchema,
  append_claim: appendClaimToolJsonSchema,
  query_claims: queryClaimsToolJsonSchema,
  harvest_session_knowledge: harvestSessionKnowledgeToolJsonSchema,
  memory_add: memoryAddToolJsonSchema,
  memory_search: memorySearchToolJsonSchema,
  memory_update: memoryUpdateToolJsonSchema,
  memory_delete: memoryDeleteToolJsonSchema,
  submit_feedback: submitFeedbackToolJsonSchema,
  feedback_retrieval_result: feedbackRetrievalResultToolJsonSchema,
  get_retrieval_stats: getRetrievalStatsToolJsonSchema,
  get_exploration_suggestions: getExplorationSuggestionsToolJsonSchema,
  find_symbol: findSymbolToolJsonSchema,
  get_repo_map: getRepoMapToolJsonSchema,
};

// ============================================================================
// VALIDATION UTILITIES
// ============================================================================

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  data?: unknown;
}

export interface ValidationError {
  path: string;
  message: string;
  code: string;
}

/**
 * Validate tool input against schema
 */
export function validateToolInput(
  toolName: string,
  input: unknown
): ValidationResult {
  const schema = TOOL_INPUT_SCHEMAS[toolName as ToolName];
  if (!schema) {
    return {
      valid: false,
      errors: [{
        path: '',
        message: `Unknown tool: ${toolName}`,
        code: 'unknown_tool',
      }],
    };
  }

  const result = schema.safeParse(input);

  if (result.success) {
    return {
      valid: true,
      errors: [],
      data: result.data,
    };
  }

  const errors: ValidationError[] = result.error.errors.map((err) => ({
    path: err.path.join('.') || '/',
    message: err.message,
    code: err.code,
  }));

  return { valid: false, errors };
}

/**
 * Get Zod schema for a tool
 */
export function getToolSchema(toolName: string): z.ZodSchema | undefined {
  return TOOL_INPUT_SCHEMAS[toolName as ToolName];
}

/**
 * Get JSON Schema for a tool
 */
export function getToolJsonSchema(toolName: string): JSONSchema | undefined {
  return JSON_SCHEMAS[toolName];
}

/**
 * List all available tool schemas
 */
export function listToolSchemas(): string[] {
  return Object.keys(TOOL_INPUT_SCHEMAS);
}

/**
 * Parse and validate tool input, returning typed result
 */
export function parseToolInput<T extends ToolName>(
  toolName: T,
  input: unknown
): z.infer<typeof TOOL_INPUT_SCHEMAS[T]> {
  const schema = TOOL_INPUT_SCHEMAS[toolName];
  return schema.parse(input);
}

/**
 * Safely parse tool input, returning result or null
 */
export function safeParseToolInput<T extends ToolName>(
  toolName: T,
  input: unknown
): z.SafeParseReturnType<unknown, z.infer<typeof TOOL_INPUT_SCHEMAS[T]>> {
  const schema = TOOL_INPUT_SCHEMAS[toolName];
  return schema.safeParse(input);
}
