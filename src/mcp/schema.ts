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

/** Symbol discovery kinds */
export const FindSymbolKindSchema = z.enum([
  'function',
  'module',
  'context_pack',
  'claim',
  'composition',
  'run',
]);

/** Shared pagination/output controls */
const PageSizeSchema = z.number().int().min(1).max(200);
const PageIdxSchema = z.number().int().min(0);
const OutputFileSchema = z.string().min(1);
const CONFIDENCE_BEHAVIOR_CONTRACT = 'Confidence contract: when confidence_tier is definitive/high, proceed with reasonable trust; medium requires review before write operations; low/uncertain requires manual verification or request_human_review.';

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
  minConfidence: z.number().min(0).max(1).optional().default(0.5).describe(`Minimum confidence threshold (0-1). ${CONFIDENCE_BEHAVIOR_CONTRACT}`),
  depth: DepthSchema.optional().default('L1').describe('Depth of context to retrieve'),
  includeEngines: z.boolean().optional().default(false).describe('Include engine results in response'),
  includeEvidence: z.boolean().optional().default(false).describe('Include evidence graph summary'),
  pageSize: PageSizeSchema.optional().default(20).describe('Items per page (default: 20, max: 200)'),
  pageIdx: PageIdxSchema.optional().default(0).describe('Zero-based page index (default: 0)'),
  outputFile: OutputFileSchema.optional().describe('Write paged response payload to file and return a file reference'),
  explainMisses: z.boolean().optional().default(false).describe('Include near-miss retrieval diagnostics'),
  explain_misses: z.boolean().optional().describe('Alias for explainMisses'),
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
 * Submit feedback tool input schema
 */
export const SubmitFeedbackToolInputSchema = z.object({
  feedbackToken: z.string().min(1).describe('Feedback token from query response'),
  outcome: z.enum(['success', 'failure', 'partial']).describe('Task outcome'),
  workspace: z.string().optional().describe('Workspace path (optional, uses first available if not specified)'),
  agentId: z.string().optional().describe('Agent identifier'),
  missingContext: z.string().optional().describe('Description of missing context'),
  customRatings: z.array(z.object({
    packId: z.string().min(1),
    relevant: z.boolean(),
    usefulness: z.number().min(0).max(1).optional(),
    reason: z.string().optional(),
  }).strict()).optional().describe('Optional per-pack relevance ratings'),
}).strict();

/**
 * Reset session state tool input schema
 */
export const ResetSessionStateToolInputSchema = z.object({
  sessionId: z.string().min(1).optional().describe('Session ID to reset (optional if auth token is provided)'),
  workspace: z.string().optional().describe('Workspace hint used for anonymous session reset fallback'),
}).strict().default({});

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
 * Status tool input schema
 */
export const StatusToolInputSchema = z.object({
  workspace: z.string().optional().describe('Workspace path (optional, uses first available if not specified)'),
}).strict();

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export type BootstrapToolInputType = z.infer<typeof BootstrapToolInputSchema>;
export type QueryToolInputType = z.infer<typeof QueryToolInputSchema>;
export type GetChangeImpactToolInputType = z.infer<typeof GetChangeImpactToolInputSchema>;
export type SubmitFeedbackToolInputType = z.infer<typeof SubmitFeedbackToolInputSchema>;
export type ResetSessionStateToolInputType = z.infer<typeof ResetSessionStateToolInputSchema>;
export type RequestHumanReviewToolInputType = z.infer<typeof RequestHumanReviewToolInputSchema>;
export type VerifyClaimToolInputType = z.infer<typeof VerifyClaimToolInputSchema>;
export type FindSymbolToolInputType = z.infer<typeof FindSymbolToolInputSchema>;
export type RunAuditToolInputType = z.infer<typeof RunAuditToolInputSchema>;
export type ListRunsToolInputType = z.infer<typeof ListRunsToolInputSchema>;
export type DiffRunsToolInputType = z.infer<typeof DiffRunsToolInputSchema>;
export type ExportIndexToolInputType = z.infer<typeof ExportIndexToolInputSchema>;
export type GetContextPackBundleToolInputType = z.infer<typeof GetContextPackBundleToolInputSchema>;
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

// ============================================================================
// SCHEMA REGISTRY
// ============================================================================

/** All tool input schemas (Zod) */
export const TOOL_INPUT_SCHEMAS = {
  bootstrap: BootstrapToolInputSchema,
  system_contract: SystemContractToolInputSchema,
  diagnose_self: DiagnoseSelfToolInputSchema,
  status: StatusToolInputSchema,
  query: QueryToolInputSchema,
  reset_session_state: ResetSessionStateToolInputSchema,
  request_human_review: RequestHumanReviewToolInputSchema,
  get_change_impact: GetChangeImpactToolInputSchema,
  submit_feedback: SubmitFeedbackToolInputSchema,
  verify_claim: VerifyClaimToolInputSchema,
  find_symbol: FindSymbolToolInputSchema,
  run_audit: RunAuditToolInputSchema,
  list_runs: ListRunsToolInputSchema,
  diff_runs: DiffRunsToolInputSchema,
  export_index: ExportIndexToolInputSchema,
  get_context_pack_bundle: GetContextPackBundleToolInputSchema,
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

/** Query tool JSON Schema */
export const queryToolJsonSchema: JSONSchema = {
  $schema: JSON_SCHEMA_DRAFT,
  $id: 'librarian://schemas/query-tool-input',
  title: 'QueryToolInput',
  description: `Input for the query tool - searches indexed knowledge. ${CONFIDENCE_BEHAVIOR_CONTRACT}`,
  type: 'object',
  properties: {
    intent: { type: 'string', description: 'The query intent or question', minLength: 1, maxLength: 2000 },
    workspace: { type: 'string', description: 'Workspace path (optional, uses first ready workspace if not specified)' },
    sessionId: { type: 'string', description: 'Optional session identifier used for loop detection and adaptive query behavior', minLength: 1 },
    intentType: { type: 'string', enum: ['understand', 'debug', 'refactor', 'impact', 'security', 'test', 'document', 'navigate', 'general'], description: 'Typed query intent' },
    affectedFiles: { type: 'array', items: { type: 'string' }, description: 'File paths to scope the query to' },
    minConfidence: { type: 'number', description: `Minimum confidence threshold. ${CONFIDENCE_BEHAVIOR_CONTRACT}`, minimum: 0, maximum: 1, default: 0.5 },
    depth: { type: 'string', enum: ['L0', 'L1', 'L2', 'L3'], description: 'Depth of context', default: 'L1' },
    includeEngines: { type: 'boolean', description: 'Include engine results', default: false },
    includeEvidence: { type: 'boolean', description: 'Include evidence graph summary', default: false },
    pageSize: { type: 'number', description: 'Items per page (default: 20, max: 200)', minimum: 1, maximum: 200, default: 20 },
    pageIdx: { type: 'number', description: 'Zero-based page index (default: 0)', minimum: 0, default: 0 },
    outputFile: { type: 'string', description: 'Write paged response payload to file and return a file reference', minLength: 1 },
    explainMisses: { type: 'boolean', description: 'Include near-miss retrieval diagnostics', default: false },
    explain_misses: { type: 'boolean', description: 'Alias for explainMisses' },
  },
  required: ['intent'],
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
    missingContext: { type: 'string', description: 'Description of missing context' },
    customRatings: { type: 'array', items: { type: 'string' }, description: 'Optional per-pack ratings' },
  },
  required: ['feedbackToken', 'outcome'],
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

/** All JSON schemas */
export const JSON_SCHEMAS: Record<string, JSONSchema> = {
  bootstrap: bootstrapToolJsonSchema,
  query: queryToolJsonSchema,
  reset_session_state: resetSessionStateToolJsonSchema,
  request_human_review: requestHumanReviewToolJsonSchema,
  get_change_impact: getChangeImpactToolJsonSchema,
  submit_feedback: submitFeedbackToolJsonSchema,
  find_symbol: findSymbolToolJsonSchema,
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
