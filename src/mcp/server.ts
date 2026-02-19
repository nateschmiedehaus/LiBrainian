/**
 * @fileoverview MCP Server Implementation for Librarian
 *
 * Implements a Model Context Protocol server that exposes Librarian's
 * knowledge base and tools to MCP clients (e.g., Claude Code).
 *
 * Features:
 * - Resource discovery and access (file tree, symbols, knowledge maps, etc.)
 * - Tool execution (bootstrap, query, verify_claim, run_audit, etc.)
 * - Authorization with scope-based access control
 * - Audit logging for all operations
 *
 * @packageDocumentation
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  type CallToolResult,
  type ListResourcesResult,
  type ListToolsResult,
  type ReadResourceResult,
  type Tool,
  type Resource,
} from '@modelcontextprotocol/sdk/types.js';

import {
  MCP_SCHEMA_VERSION,
  DEFAULT_MCP_SERVER_CONFIG,
  TOOL_AUTHORIZATION,
  type LibrarianMCPServerConfig,
  type AuthorizationScope,
  type BootstrapToolInput,
  type StatusToolInput,
  type GetSessionBriefingToolInput,
  type SemanticSearchToolInput,
  type GetContextPackToolInput,
  type EstimateBudgetToolInput,
  type EstimateTaskComplexityToolInput,
  type SynthesizePlanToolInput,
  type QueryToolInput,
  type ResetSessionStateToolInput,
  type RequestHumanReviewToolInput,
  type ListConstructionsToolInput,
  type InvokeConstructionToolInput,
  type DescribeConstructionToolInput,
  type ExplainOperatorToolInput,
  type CheckConstructionTypesToolInput,
  type GetChangeImpactToolInput,
  type BlastRadiusToolInput,
  type PreCommitCheckToolInput,
  type ClaimWorkScopeToolInput,
  type AppendClaimToolInput,
  type QueryClaimsToolInput,
  type HarvestSessionKnowledgeToolInput,
  type SubmitFeedbackToolInput,
  type ExplainFunctionToolInput,
  type FindCallersToolInput,
  type FindCalleesToolInput,
  type FindUsagesToolInput,
  type TraceImportsToolInput,
  type FindSymbolToolInput,
  type VerifyClaimToolInput,
  type RunAuditToolInput,
  type ListRunsToolInput,
  type DiffRunsToolInput,
  type ExportIndexToolInput,
  type GetContextPackBundleToolInput,
  type SystemContractToolInput,
  type DiagnoseSelfToolInput,
  type ListVerificationPlansToolInput,
  type ListEpisodesToolInput,
  type ListTechniquePrimitivesToolInput,
  type ListTechniqueCompositionsToolInput,
  type SelectTechniqueCompositionsToolInput,
  type CompileTechniqueCompositionToolInput,
  type CompileIntentBundlesToolInput,
  type RetrievalConfidenceTier,
  isBootstrapToolInput,
  isQueryToolInput,
  isVerifyClaimToolInput,
  isRunAuditToolInput,
  isDiffRunsToolInput,
  isExportIndexToolInput,
  isGetContextPackBundleToolInput,
} from './types.js';

import {
  validateToolInput,
  type ValidationResult,
} from './schema.js';
import { z } from 'zod';
import {
  CompileIntentBundlesOutputSchema,
  CompileTechniqueCompositionOutputSchema,
  ConstructionOutputSchemaHints,
  DefaultToolOutputSchemaHint,
  SelectTechniqueCompositionsOutputSchema,
  type ConstructionResultEnvelope,
  validateConstructionOutput,
} from './construction_results.js';

// Librarian API imports
import {
  createLibrarian,
  Librarian,
  bootstrapProject,
  createBootstrapConfig,
  isBootstrapRequired,
  getBootstrapStatus,
  queryLibrarian,
} from '../api/index.js';
import { estimateTokens } from '../api/token_budget.js';
import { computeChangeImpactReport } from '../api/change_impact_tool.js';
import { categorizeRetrievalStatus, computeRetrievalEntropy } from '../api/retrieval_escalation.js';
import { selectTechniqueCompositions } from '../api/plan_compiler.js';
import {
  compileTechniqueCompositionTemplateWithGapsFromStorage,
  compileTechniqueCompositionBundleFromStorage,
} from '../api/plan_compiler.js';
import { compileTechniqueBundlesFromIntent } from '../api/plan_compiler.js';
import { listTechniqueCompositions as listStoredTechniqueCompositions } from '../state/technique_compositions.js';
import { submitQueryFeedback } from '../integration/agent_protocol.js';
import { createSqliteStorage, type LibrarianStorage } from '../storage/index.js';
import { checkDefeaters, STANDARD_DEFEATERS } from '../knowledge/defeater_activation.js';
import {
  AuthenticationManager,
  createAuthenticationManager,
  type SessionToken,
  type AuthorizationResult,
} from './authentication.js';
import { createHash } from 'node:crypto';
import * as path from 'path';
import * as fs from 'fs/promises';
import { createAuditLogger, type AuditLogger } from './audit.js';
import { SqliteEvidenceLedger } from '../epistemics/evidence_ledger.js';
import { AuditBackedToolAdapter, type ToolAdapter } from '../adapters/tool_adapter.js';
import { MemoryBridgeDaemon } from '../memory_bridge/daemon.js';
import {
  CONSTRUCTION_REGISTRY,
  getConstructionManifest,
  invokeConstruction,
  listConstructions,
} from '../constructions/registry.js';

// ============================================================================
// TYPES
// ============================================================================

/** Server state */
export interface ServerState {
  /** Initialized workspaces */
  workspaces: Map<string, WorkspaceState>;

  /** Active sessions */
  sessions: Map<string, SessionState>;

  /** Audit log entries */
  auditLog: AuditLogEntry[];

  /** Authentication manager */
  authManager: AuthenticationManager;

  /** Active cross-session scope claims for parallel coordination */
  scopeClaims: Map<string, ScopeClaimRecord>;

  /** Session knowledge claims persisted via append_claim */
  knowledgeClaims: KnowledgeClaimRecord[];
}

/** Workspace state */
export interface WorkspaceState {
  /** Workspace path */
  path: string;

  /** Storage instance (lazy loaded) */
  storage?: LibrarianStorage;

  /** Librarian instance (for autoWatch support) */
  librarian?: Librarian;

  /** Evidence ledger for epistemic/audit trace (lazy) */
  evidenceLedger?: SqliteEvidenceLedger;

  /** Structured audit logger (lazy) */
  auditLogger?: AuditLogger;

  /** Tool adapter that records tool calls (lazy) */
  toolAdapter?: ToolAdapter;

  /** Indexed at */
  indexedAt?: string;

  /** Index state */
  indexState: 'pending' | 'indexing' | 'ready' | 'stale';

  /** Bootstrap run ID for diff tracking */
  lastBootstrapRunId?: string;

  /** File watcher active */
  watching?: boolean;
}

/** Session state */
export interface SessionState {
  /** Session ID */
  id: string;

  /** Created at */
  createdAt: string;

  /** Authorized scopes */
  authorizedScopes: Set<AuthorizationScope>;

  /** Request count */
  requestCount: number;

  /** Last activity */
  lastActivity: string;

  /** Recent query records for repeated-query loop detection */
  queryHistory: QueryRecord[];

  /** Recent synthesized plans for explicit planning traces */
  planHistory: PlanRecord[];
}

interface QueryRecord {
  fingerprint: string;
  semanticHash: string;
  normalizedIntent: string;
  timestampMs: number;
  resultCount: number;
  workspace: string;
}

interface PlanRecord {
  planId: string;
  task: string;
  plan: string;
  contextUsed: string[];
  workspace?: string;
  createdAt: string;
}

interface ScopeClaimRecord {
  scopeKey: string;
  scopeId: string;
  workspace?: string;
  sessionId: string;
  owner?: string;
  claimedAt: string;
  expiresAt: string;
}

interface KnowledgeClaimRecord {
  claimId: string;
  claim: string;
  workspace?: string;
  sessionId: string;
  tags: string[];
  evidence: string[];
  confidence: number;
  sourceTool?: string;
  createdAt: string;
}

interface LoopDetectionResult {
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
}

interface ToolExecutionContext {
  sessionId?: string;
}

interface LoopMetrics {
  exactCount: number;
  semanticCount: number;
  futileCount: number;
}

/** Audit log entry */
export interface AuditLogEntry {
  /** Entry ID */
  id: string;

  /** Timestamp */
  timestamp: string;

  /** Session ID */
  sessionId?: string;

  /** Operation type */
  operation: 'tool_call' | 'resource_read' | 'authorization' | 'error';

  /** Tool or resource name */
  name: string;

  /** Input (sanitized) */
  input?: unknown;

  /** Result status */
  status: 'success' | 'failure' | 'denied';

  /** Duration ms */
  durationMs?: number;

  /** Error message (if any) */
  error?: string;
}

interface ToolHintMetadata {
  readOnlyHint: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
  requiresIndex: boolean;
  requiresEmbeddings: boolean;
  estimatedTokens: number;
}

const TOOL_HINTS: Record<string, ToolHintMetadata> = {
  bootstrap: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false, requiresIndex: false, requiresEmbeddings: false, estimatedTokens: 12000 },
  status: { readOnlyHint: true, openWorldHint: false, requiresIndex: false, requiresEmbeddings: false, estimatedTokens: 900 },
  get_session_briefing: { readOnlyHint: true, openWorldHint: false, requiresIndex: false, requiresEmbeddings: false, estimatedTokens: 1200 },
  semantic_search: { readOnlyHint: true, openWorldHint: false, requiresIndex: true, requiresEmbeddings: true, estimatedTokens: 4200 },
  get_context_pack: { readOnlyHint: true, openWorldHint: false, requiresIndex: true, requiresEmbeddings: true, estimatedTokens: 2600 },
  estimate_budget: { readOnlyHint: true, openWorldHint: false, requiresIndex: false, requiresEmbeddings: false, estimatedTokens: 1300 },
  estimate_task_complexity: { readOnlyHint: true, openWorldHint: false, requiresIndex: false, requiresEmbeddings: false, estimatedTokens: 1500 },
  system_contract: { readOnlyHint: true, openWorldHint: false, requiresIndex: false, requiresEmbeddings: false, estimatedTokens: 1200 },
  diagnose_self: { readOnlyHint: true, openWorldHint: false, requiresIndex: false, requiresEmbeddings: false, estimatedTokens: 1800 },
  list_verification_plans: { readOnlyHint: true, openWorldHint: false, requiresIndex: true, requiresEmbeddings: false, estimatedTokens: 1400 },
  list_episodes: { readOnlyHint: true, openWorldHint: false, requiresIndex: true, requiresEmbeddings: false, estimatedTokens: 1400 },
  list_technique_primitives: { readOnlyHint: true, openWorldHint: false, requiresIndex: true, requiresEmbeddings: false, estimatedTokens: 1800 },
  list_technique_compositions: { readOnlyHint: true, openWorldHint: false, requiresIndex: true, requiresEmbeddings: false, estimatedTokens: 1800 },
  select_technique_compositions: { readOnlyHint: true, openWorldHint: false, requiresIndex: true, requiresEmbeddings: false, estimatedTokens: 2500 },
  compile_technique_composition: { readOnlyHint: true, openWorldHint: false, requiresIndex: true, requiresEmbeddings: false, estimatedTokens: 2600 },
  compile_intent_bundles: { readOnlyHint: true, openWorldHint: false, requiresIndex: true, requiresEmbeddings: false, estimatedTokens: 3200 },
  query: { readOnlyHint: true, openWorldHint: false, requiresIndex: true, requiresEmbeddings: true, estimatedTokens: 7000 },
  synthesize_plan: { readOnlyHint: true, openWorldHint: false, requiresIndex: false, requiresEmbeddings: false, estimatedTokens: 1800 },
  reset_session_state: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false, requiresIndex: false, requiresEmbeddings: false, estimatedTokens: 300 },
  request_human_review: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false, requiresIndex: false, requiresEmbeddings: false, estimatedTokens: 1200 },
  list_constructions: { readOnlyHint: true, openWorldHint: false, requiresIndex: false, requiresEmbeddings: false, estimatedTokens: 1800 },
  invoke_construction: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true, requiresIndex: false, requiresEmbeddings: false, estimatedTokens: 4200 },
  describe_construction: { readOnlyHint: true, openWorldHint: false, requiresIndex: false, requiresEmbeddings: false, estimatedTokens: 2200 },
  explain_operator: { readOnlyHint: true, openWorldHint: false, requiresIndex: false, requiresEmbeddings: false, estimatedTokens: 1400 },
  check_construction_types: { readOnlyHint: true, openWorldHint: false, requiresIndex: false, requiresEmbeddings: false, estimatedTokens: 1700 },
  get_change_impact: { readOnlyHint: true, openWorldHint: false, requiresIndex: true, requiresEmbeddings: false, estimatedTokens: 2600 },
  blast_radius: { readOnlyHint: true, openWorldHint: false, requiresIndex: true, requiresEmbeddings: false, estimatedTokens: 2600 },
  pre_commit_check: { readOnlyHint: true, openWorldHint: false, requiresIndex: true, requiresEmbeddings: false, estimatedTokens: 3200 },
  claim_work_scope: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false, requiresIndex: false, requiresEmbeddings: false, estimatedTokens: 1100 },
  append_claim: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false, requiresIndex: false, requiresEmbeddings: false, estimatedTokens: 1200 },
  query_claims: { readOnlyHint: true, openWorldHint: false, requiresIndex: false, requiresEmbeddings: false, estimatedTokens: 1400 },
  harvest_session_knowledge: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false, requiresIndex: false, requiresEmbeddings: false, estimatedTokens: 2200 },
  submit_feedback: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false, requiresIndex: true, requiresEmbeddings: false, estimatedTokens: 1500 },
  explain_function: { readOnlyHint: true, openWorldHint: false, requiresIndex: true, requiresEmbeddings: false, estimatedTokens: 1800 },
  find_callers: { readOnlyHint: true, openWorldHint: false, requiresIndex: true, requiresEmbeddings: false, estimatedTokens: 2200 },
  find_callees: { readOnlyHint: true, openWorldHint: false, requiresIndex: true, requiresEmbeddings: false, estimatedTokens: 2200 },
  find_usages: { readOnlyHint: true, openWorldHint: false, requiresIndex: true, requiresEmbeddings: false, estimatedTokens: 2400 },
  trace_imports: { readOnlyHint: true, openWorldHint: false, requiresIndex: true, requiresEmbeddings: false, estimatedTokens: 2400 },
  find_symbol: { readOnlyHint: true, openWorldHint: false, requiresIndex: true, requiresEmbeddings: false, estimatedTokens: 1700 },
  verify_claim: { readOnlyHint: true, openWorldHint: false, requiresIndex: true, requiresEmbeddings: false, estimatedTokens: 3200 },
  run_audit: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false, requiresIndex: true, requiresEmbeddings: false, estimatedTokens: 5200 },
  diff_runs: { readOnlyHint: true, openWorldHint: false, requiresIndex: true, requiresEmbeddings: false, estimatedTokens: 3500 },
  list_runs: { readOnlyHint: true, openWorldHint: false, requiresIndex: false, requiresEmbeddings: false, estimatedTokens: 1200 },
  export_index: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false, requiresIndex: true, requiresEmbeddings: false, estimatedTokens: 2500 },
  get_context_pack_bundle: { readOnlyHint: true, openWorldHint: false, requiresIndex: true, requiresEmbeddings: true, estimatedTokens: 4000 },
};

type ConstructionOperator =
  | 'seq'
  | 'fanout'
  | 'fallback'
  | 'fix'
  | 'select'
  | 'atom'
  | 'dimap'
  | 'map'
  | 'contramap';

interface OperatorGuideEntry {
  summary: string;
  decisionGuide: string;
  example: string;
}

const OPERATOR_GUIDE: Record<ConstructionOperator, OperatorGuideEntry> = {
  seq: {
    summary: 'Use seq when the second construction needs output from the first construction.',
    decisionGuide: 'Choose seq for pipeline stages where data flows A -> B and B cannot run until A completes.',
    example: "seq(blastRadiusOracle, riskRanker)",
  },
  fanout: {
    summary: 'Use fanout when two constructions should run in parallel over the same input.',
    decisionGuide: 'Choose fanout for independent analyses that share identical input and can execute concurrently.',
    example: "fanout(callGraphLookup, testCoverageQuery)",
  },
  fallback: {
    summary: 'Use fallback when the second construction should run only if the first fails or returns unusable output.',
    decisionGuide: 'Choose fallback for resilient pipelines with a preferred primary path and a recovery path.',
    example: "fallback(primaryRetriever, backupRetriever)",
  },
  fix: {
    summary: 'Use fix for recursive or iterative workflows that converge to a stable output.',
    decisionGuide: 'Choose fix when each pass improves the candidate result until no further changes are needed.',
    example: "fix(refinePlanUntilStable)",
  },
  select: {
    summary: 'Use select when branching between constructions based on a discriminator or routing decision.',
    decisionGuide: 'Choose select when a classifier determines which downstream construction should run.',
    example: "select(routeByFileType, tsFlow, pyFlow)",
  },
  atom: {
    summary: 'Use atom for a small focused construction that performs one deterministic transformation.',
    decisionGuide: 'Choose atom for reusable leaf steps that should stay side-effect light and composable.',
    example: "atom('extract-function-ids', (input) => ...)",
  },
  dimap: {
    summary: 'Use dimap to adapt both input and output shapes around an existing construction.',
    decisionGuide: 'Choose dimap when both upstream and downstream contracts differ and one adapter should handle both seams.',
    example: "dimap(existing, adaptInput, adaptOutput)",
  },
  map: {
    summary: 'Use map to transform only output after a construction runs.',
    decisionGuide: 'Choose map for post-processing, formatting, or reducing a result without changing execution logic.',
    example: "map(construction, (out) => out.summary)",
  },
  contramap: {
    summary: 'Use contramap to transform only input before a construction runs.',
    decisionGuide: 'Choose contramap to normalize callsite input into the shape expected by an existing construction.',
    example: "contramap(construction, adaptInput)",
  },
};

interface ReadResourceRequestLike {
  params: {
    uri: string;
  };
}

interface CallToolRequestLike {
  params: {
    name: string;
    arguments?: Record<string, unknown>;
  };
}

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 200;
const DEFAULT_STREAM_CHUNK_SIZE = 5;
const MAX_STREAM_CHUNK_SIZE = 200;
const DEFAULT_RUN_LIST_LIMIT = 10;
const MAX_RUN_LIST_LIMIT = 100;
const MIN_PARAMETER_DESCRIPTION_WORDS = 20;
const LOOP_SEMANTIC_SIMILARITY_THRESHOLD = 0.93;
const LOW_CONFIDENCE_THRESHOLD = 0.35;
const UNCERTAIN_CONFIDENCE_THRESHOLD = 0.6;
const CONFIDENCE_BEHAVIOR_CONTRACT = 'Confidence tiers: definitive/high -> proceed with reasonable trust; medium -> review before write operations; low/uncertain -> verify manually or call request_human_review.';
const BOOTSTRAP_RUN_HISTORY_STATE_KEY = 'librarian.mcp.bootstrap_runs.v1';
const BOOTSTRAP_RUN_HISTORY_SCHEMA_VERSION = 1;
const MAX_PERSISTED_BOOTSTRAP_RUNS = 50;

interface MutableToolSchemaNode {
  type?: string;
  description?: string;
  enum?: unknown[];
  default?: unknown;
  properties?: Record<string, MutableToolSchemaNode>;
  items?: MutableToolSchemaNode | MutableToolSchemaNode[];
}

const SPECIAL_PARAMETER_DESCRIPTIONS: Record<string, string> = {
  'query.depth': 'Context depth for retrieval scope. L0=summary only (fastest, ~500 tokens), L1=summary plus key facts (default, ~2000 tokens), L2=full pack with related files (~5000 tokens), L3=comprehensive cross-module context with richer call-graph evidence (~10000 tokens). Use L1 for routine work, L2 for impact analysis, and L3 only for deep architectural investigation.',
  'query.affectedFiles': 'Absolute paths of files to include as a hard retrieval scope filter. Use this when you already know likely hotspots and need precise context. If omitted, LiBrainian searches the full indexed workspace. Example: ["/workspace/src/auth.ts", "/workspace/src/middleware/session.ts"].',
};

function countWords(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function ensureMinimumDescriptionWords(description: string): string {
  if (countWords(description) >= MIN_PARAMETER_DESCRIPTION_WORDS) {
    return description;
  }
  return `${description} This guidance is intentionally explicit so MCP prompt injection remains actionable without extra system-prompt scaffolding.`;
}

function formatParameterLabel(parameterPath: string[]): string {
  const leaf = parameterPath[parameterPath.length - 1] ?? 'parameter';
  return leaf
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase();
}

function inferFormatHint(parameterPath: string[], schema: MutableToolSchemaNode): string {
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return `One of: ${schema.enum.map((item) => JSON.stringify(item)).join(', ')}`;
  }
  switch (schema.type) {
    case 'string':
      return 'String value';
    case 'number':
    case 'integer':
      return 'Numeric value';
    case 'boolean':
      return 'Boolean value (true or false)';
    case 'array':
      return 'Array value';
    case 'object':
      return `JSON object with nested fields${parameterPath[parameterPath.length - 1] === 'customRatings' ? ' for pack-level feedback ratings' : ''}`;
    default:
      return 'JSON value';
  }
}

function inferExampleValue(parameterPath: string[], schema: MutableToolSchemaNode): string {
  const leaf = parameterPath[parameterPath.length - 1] ?? '';
  if (leaf === 'workspace') return '"/workspace"';
  if (leaf === 'outputFile') return '"/workspace/.librarian/reports/page-0.json"';
  if (leaf.toLowerCase().includes('path') || leaf.toLowerCase().includes('file')) return '"/workspace/src/example.ts"';
  if (leaf.toLowerCase().includes('id')) return '"id_123"';
  if (leaf === 'scope') return '["src/**/*.ts", "docs/**/*.md"]';
  if (leaf === 'include' || leaf === 'exclude') return '["src/**/*.ts"]';
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return JSON.stringify(schema.enum[0]);
  }
  switch (schema.type) {
    case 'string':
      return '"example"';
    case 'number':
    case 'integer':
      return '20';
    case 'boolean':
      return 'true';
    case 'array':
      return '["example"]';
    case 'object':
      return '{"key":"value"}';
    default:
      return '"example"';
  }
}

function buildDetailedParameterDescription(
  toolName: string,
  parameterPath: string[],
  schema: MutableToolSchemaNode,
  existingDescription: string
): string {
  const specialKey = `${toolName}.${parameterPath.join('.')}`;
  const special = SPECIAL_PARAMETER_DESCRIPTIONS[specialKey];
  if (special) {
    return special;
  }

  const label = formatParameterLabel(parameterPath);
  const formatHint = inferFormatHint(parameterPath, schema);
  const example = inferExampleValue(parameterPath, schema);
  const base = existingDescription.trim().length > 0
    ? existingDescription.trim()
    : `Controls ${label} for the ${toolName} tool.`;
  const whenToOverride = schema.default !== undefined
    ? `Use a non-default value when the default (${JSON.stringify(schema.default)}) does not match the precision, cost, or safety profile required by this task.`
    : 'Set this explicitly when you need to constrain scope, tune behavior, or override automatic defaults for this operation.';
  return ensureMinimumDescriptionWords(
    `${base} Format: ${formatHint}. ${whenToOverride} Example: ${example}.`
  );
}

function enrichSchemaDescriptions(toolName: string, schemaNode: MutableToolSchemaNode, parameterPath: string[] = []): void {
  if (!schemaNode || typeof schemaNode !== 'object') {
    return;
  }

  if (parameterPath.length > 0) {
    const existing = typeof schemaNode.description === 'string' ? schemaNode.description : '';
    schemaNode.description = buildDetailedParameterDescription(toolName, parameterPath, schemaNode, existing);
  }

  if (schemaNode.properties) {
    for (const [name, child] of Object.entries(schemaNode.properties)) {
      enrichSchemaDescriptions(toolName, child, [...parameterPath, name]);
    }
  }

  if (Array.isArray(schemaNode.items)) {
    for (let idx = 0; idx < schemaNode.items.length; idx += 1) {
      enrichSchemaDescriptions(toolName, schemaNode.items[idx], [...parameterPath, `items_${idx}`]);
    }
  } else if (schemaNode.items && typeof schemaNode.items === 'object') {
    enrichSchemaDescriptions(toolName, schemaNode.items, [...parameterPath, 'items']);
  }
}

interface BootstrapRunStatsSnapshot {
  filesProcessed: number;
  functionsIndexed: number;
  contextPacksCreated: number;
  averageConfidence: number;
}

interface BootstrapRunRecord {
  runId: string;
  workspace: string;
  startedAt: string;
  completedAt?: string;
  success: boolean;
  durationMs: number;
  stats: BootstrapRunStatsSnapshot;
  error?: string;
}

type FindSymbolMatchKind =
  | 'function'
  | 'module'
  | 'context_pack'
  | 'claim'
  | 'composition'
  | 'run';

interface FindSymbolMatchRecord {
  id: string;
  kind: FindSymbolMatchKind;
  name: string;
  filePath?: string;
  score: number;
  description?: string;
}

interface PaginationOptions {
  pageSize?: number;
  pageIdx?: number;
  limit?: number;
}

interface PaginationMetadata {
  pageSize: number;
  pageIdx: number;
  totalItems: number;
  pageCount: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  nextPageIdx?: number;
  previousPageIdx?: number;
  showingFrom: number;
  showingTo: number;
  showing: string;
}

interface QueryProgressEvent {
  stage: string;
  timestamp: string;
  elapsedMs: number;
  details?: Record<string, unknown>;
}

const TRACE_MESSAGE_PATTERN = /^unverified_by_trace\(([^)]+)\):?\s*(.*)$/i;

interface ParsedEpistemicMessage {
  code?: string;
  userMessage: string;
  rawMessage: string;
}

function parseEpistemicMessage(message: string): ParsedEpistemicMessage {
  const rawMessage = String(message ?? '').trim();
  const match = rawMessage.match(TRACE_MESSAGE_PATTERN);
  if (!match) {
    return {
      userMessage: rawMessage,
      rawMessage,
    };
  }
  const code = (match[1] ?? '').trim();
  const detail = (match[2] ?? '').trim();
  return {
    code,
    userMessage: detail || code.replace(/_/g, ' '),
    rawMessage,
  };
}

function sanitizeDisclosures(disclosures: string[] | undefined): {
  userDisclosures: string[];
  epistemicsDebug: string[];
} {
  const userDisclosures: string[] = [];
  const epistemicsDebug: string[] = [];
  const seen = new Set<string>();
  for (const disclosure of disclosures ?? []) {
    const parsed = parseEpistemicMessage(disclosure);
    if (parsed.code) {
      epistemicsDebug.push(parsed.rawMessage);
    }
    const normalized = parsed.userMessage.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    userDisclosures.push(normalized);
  }
  return { userDisclosures, epistemicsDebug };
}

function sanitizeTraceId(traceId: string | undefined): string | undefined {
  if (!traceId) return traceId;
  const parsed = parseEpistemicMessage(traceId);
  return parsed.code ?? traceId;
}

function buildQueryFixCommands(code: string | undefined, workspace: string | undefined): string[] {
  const workspaceArg = workspace?.trim() ? workspace.trim() : '<workspace>';
  switch (code) {
    case 'workspace_unavailable':
      return [`Run \`librarian bootstrap --workspace ${workspaceArg}\` to register and index this workspace.`];
    case 'bootstrap_required':
      return [`Run \`librarian bootstrap --workspace ${workspaceArg}\` before running query.`];
    case 'provider_unavailable':
      return ['Run `librarian check-providers` to diagnose provider setup and authentication.'];
    case 'query_failed':
      return [
        'Run `librarian doctor` to diagnose storage/workspace issues.',
        'Retry with a narrower intent after confirming providers are healthy.',
      ];
    default:
      return ['Run `librarian doctor` to diagnose this query failure.'];
  }
}

function normalizeErrorCode(rawCode: string | undefined, fallback = 'tool_execution_failed'): string {
  const candidate = String(rawCode ?? '').trim().toLowerCase();
  if (!candidate) return fallback;
  const normalized = candidate.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return normalized || fallback;
}

function inferErrorCode(message: string, parsedCode?: string): string {
  if (parsedCode) return normalizeErrorCode(parsedCode);
  const normalized = message.trim().toLowerCase();
  if (normalized.includes('stale index') || normalized.includes('index stale')) {
    return 'index_stale';
  }
  if (normalized.includes('partial index') || normalized.includes('incomplete index')) {
    return 'partial_index';
  }
  if (
    normalized.includes('embedding')
    && (normalized.includes('unavailable') || normalized.includes('not configured') || normalized.includes('provider'))
  ) {
    return 'embedding_unavailable';
  }
  if (
    normalized.includes('query too vague')
    || normalized.includes('no results found')
    || normalized.includes('no matching results')
  ) {
    return 'query_too_vague';
  }
  if (normalized.includes('workspace not registered') || normalized.includes('workspace_unavailable')) {
    return 'workspace_not_registered';
  }
  if (
    normalized.includes('workspace not ready')
    || normalized.includes('no indexed workspace')
    || normalized.includes('bootstrap first')
    || normalized.includes('not bootstrapped')
    || normalized.includes('bootstrap_required')
  ) {
    return 'workspace_not_bootstrapped';
  }
  if (normalized.includes('authorization denied') || normalized.includes('missing required scopes')) {
    return 'authorization_denied';
  }
  if (normalized.includes('invalid input') || normalized.includes('schema_validation_failed')) {
    return 'invalid_input';
  }
  if (normalized.includes('claim not found') || normalized.includes('claim_not_found')) {
    return 'claim_not_found';
  }
  if (normalized.includes('workspace not found') || normalized.includes('workspace not accessible')) {
    return 'workspace_not_found';
  }
  if (normalized.includes('unknown tool')) return 'tool_not_found';
  return 'tool_execution_failed';
}

function getWorkspaceArg(args: unknown): string | undefined {
  if (!args || typeof args !== 'object') return undefined;
  const workspace = (args as Record<string, unknown>).workspace;
  if (typeof workspace !== 'string') return undefined;
  const trimmed = workspace.trim();
  return trimmed || undefined;
}

function buildAgentNextSteps(code: string, toolName: string, workspace: string | undefined): {
  nextSteps: string[];
  recoverWith?: { tool: string; args: Record<string, unknown> };
} {
  const workspaceArg = workspace ?? '<workspace>';
  switch (code) {
    case 'workspace_not_registered':
      return {
        nextSteps: [
          `Call bootstrap({ workspace: "${workspaceArg}" }) to register and index this workspace.`,
          `After bootstrap succeeds, retry ${toolName}.`,
        ],
        recoverWith: workspace ? { tool: 'bootstrap', args: { workspace } } : undefined,
      };
    case 'workspace_not_bootstrapped':
      return {
        nextSteps: [
          `Call bootstrap({ workspace: "${workspaceArg}" }) to build the index before using ${toolName}.`,
          `Retry ${toolName} after bootstrap completes.`,
        ],
        recoverWith: workspace ? { tool: 'bootstrap', args: { workspace } } : undefined,
      };
    case 'authorization_denied':
      return {
        nextSteps: [
          'Start the MCP server with the required scopes enabled for this tool.',
          'Retry the tool call after scope configuration is updated.',
        ],
      };
    case 'invalid_input':
      return {
        nextSteps: [
          'Check tool argument requirements via list_tools.',
          `Retry ${toolName} with all required fields and valid value types.`,
        ],
      };
    case 'claim_not_found':
      return {
        nextSteps: [
          'Use find_symbol({ query: "...", kind: "claim" }) to discover claim IDs first.',
          'Retry verify_claim with a valid claimId from find_symbol output.',
        ],
      };
    case 'query_too_vague':
      return {
        nextSteps: [
          'Retry with a broader natural-language query (include subsystem and expected behavior).',
          'Run query with explicit affected files when known.',
        ],
      };
    case 'embedding_unavailable':
      return {
        nextSteps: [
          'Run `librarian check-providers --format json` and confirm embedding provider availability.',
          `Retry ${toolName} after provider configuration is restored.`,
        ],
      };
    case 'index_stale':
      return {
        nextSteps: [
          `Run bootstrap({ workspace: "${workspaceArg}" }) to refresh stale index data.`,
          `Retry ${toolName} after refresh completes.`,
        ],
        recoverWith: workspace ? { tool: 'bootstrap', args: { workspace } } : undefined,
      };
    case 'partial_index':
      return {
        nextSteps: [
          `Run bootstrap({ workspace: "${workspaceArg}" }) to complete indexing for missing files.`,
          `Retry ${toolName} after full index coverage is restored.`,
        ],
        recoverWith: workspace ? { tool: 'bootstrap', args: { workspace } } : undefined,
      };
    default:
      return {
        nextSteps: [
          'Retry the tool call once to rule out transient errors.',
          'If the error persists, run `librarian doctor --json` and apply suggested fixes.',
        ],
      };
  }
}

type CompactErrorSeverity = 'blocking' | 'degraded' | 'recoverable';

function classifyCompactError(code: string): {
  errorType: string;
  severity: CompactErrorSeverity;
  retrySafe: boolean;
  humanReviewNeeded: boolean;
  suggestedRephrasings?: string[];
} {
  switch (code) {
    case 'workspace_not_bootstrapped':
    case 'workspace_not_registered':
      return {
        errorType: 'INDEX_NOT_INITIALIZED',
        severity: 'blocking',
        retrySafe: true,
        humanReviewNeeded: false,
      };
    case 'index_stale':
      return {
        errorType: 'INDEX_STALE',
        severity: 'degraded',
        retrySafe: true,
        humanReviewNeeded: false,
      };
    case 'partial_index':
      return {
        errorType: 'PARTIAL_INDEX',
        severity: 'degraded',
        retrySafe: true,
        humanReviewNeeded: false,
      };
    case 'query_too_vague':
    case 'invalid_input':
      return {
        errorType: 'QUERY_TOO_VAGUE',
        severity: 'recoverable',
        retrySafe: true,
        humanReviewNeeded: false,
        suggestedRephrasings: [
          'Try adding subsystem and behavior details (for example: "auth token validation flow").',
          'If you know candidate files, include workspace + explicit scope arguments.',
        ],
      };
    case 'embedding_unavailable':
      return {
        errorType: 'EMBEDDING_SERVICE_UNAVAILABLE',
        severity: 'blocking',
        retrySafe: true,
        humanReviewNeeded: false,
      };
    case 'claim_not_found':
      return {
        errorType: 'CONTEXT_PACK_NOT_FOUND',
        severity: 'recoverable',
        retrySafe: false,
        humanReviewNeeded: false,
      };
    case 'workspace_not_found':
      return {
        errorType: 'WORKSPACE_NOT_FOUND',
        severity: 'blocking',
        retrySafe: true,
        humanReviewNeeded: true,
      };
    case 'server_busy':
      return {
        errorType: 'RATE_LIMITED',
        severity: 'degraded',
        retrySafe: true,
        humanReviewNeeded: false,
      };
    default:
      return {
        errorType: 'TOOL_EXECUTION_FAILED',
        severity: 'blocking',
        retrySafe: true,
        humanReviewNeeded: false,
      };
  }
}

function describeAttempt(toolName: string, args: unknown): string {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return `Call ${toolName}.`;
  }
  const keys = Object.keys(args as Record<string, unknown>).filter((key) => key !== 'authToken');
  if (keys.length === 0) return `Call ${toolName}.`;
  return `Call ${toolName} with arguments: ${keys.slice(0, 8).join(', ')}.`;
}

function toAgentErrorPayload(params: {
  toolName: string;
  args?: unknown;
  message: string;
  basePayload?: Record<string, unknown>;
}): Record<string, unknown> {
  const base = params.basePayload ? { ...params.basePayload } : {};
  const parsedMessage = parseEpistemicMessage(params.message);
  const disclosures = Array.isArray(base.disclosures)
    ? base.disclosures.filter((value): value is string => typeof value === 'string')
    : [];
  const { userDisclosures, epistemicsDebug } = sanitizeDisclosures(disclosures);
  const existingDebug = Array.isArray(base.epistemicsDebug)
    ? base.epistemicsDebug.filter((value): value is string => typeof value === 'string')
    : [];
  const debug = [...existingDebug, ...epistemicsDebug];
  if (parsedMessage.code) {
    debug.push(parsedMessage.rawMessage);
  }
  const code = normalizeErrorCode(
    typeof base.code === 'string' ? base.code : undefined,
    inferErrorCode(params.message, parsedMessage.code)
  );
  const { nextSteps, recoverWith } = buildAgentNextSteps(
    code,
    params.toolName,
    getWorkspaceArg(params.args)
  );
  const suppliedNextSteps = Array.isArray(base.nextSteps)
    ? base.nextSteps.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : [];
  const suppliedRecoverWith = base.recoverWith
    && typeof base.recoverWith === 'object'
    && !Array.isArray(base.recoverWith)
    ? base.recoverWith as { tool?: unknown; args?: unknown }
    : undefined;
  const normalizedRecoverWith = suppliedRecoverWith
    && typeof suppliedRecoverWith.tool === 'string'
    && suppliedRecoverWith.tool.trim()
    && suppliedRecoverWith.args
    && typeof suppliedRecoverWith.args === 'object'
    && !Array.isArray(suppliedRecoverWith.args)
    ? {
      tool: suppliedRecoverWith.tool.trim(),
      args: suppliedRecoverWith.args as Record<string, unknown>,
    }
    : recoverWith;
  const compact = classifyCompactError(code);
  const suppliedSuggestedNextSteps = Array.isArray(base.suggested_next_steps)
    ? base.suggested_next_steps.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : [];
  const partialResults = base.partial_results ?? base.partialResults;

  return {
    ...base,
    error: true,
    code,
    message: parsedMessage.userMessage || 'Tool execution failed.',
    nextSteps: suppliedNextSteps.length > 0 ? suppliedNextSteps : nextSteps,
    error_type: typeof base.error_type === 'string' ? base.error_type : compact.errorType,
    what_was_attempted: typeof base.what_was_attempted === 'string'
      ? base.what_was_attempted
      : describeAttempt(params.toolName, params.args),
    what_failed: typeof base.what_failed === 'string'
      ? base.what_failed
      : (parsedMessage.userMessage || 'Tool execution failed.'),
    severity: base.severity === 'blocking' || base.severity === 'degraded' || base.severity === 'recoverable'
      ? base.severity
      : compact.severity,
    suggested_next_steps: suppliedSuggestedNextSteps.length > 0
      ? suppliedSuggestedNextSteps
      : (suppliedNextSteps.length > 0 ? suppliedNextSteps : nextSteps),
    human_review_needed: typeof base.human_review_needed === 'boolean'
      ? base.human_review_needed
      : compact.humanReviewNeeded,
    retry_safe: typeof base.retry_safe === 'boolean' ? base.retry_safe : compact.retrySafe,
    suggested_rephrasings: Array.isArray(base.suggested_rephrasings)
      ? base.suggested_rephrasings
      : compact.suggestedRephrasings,
    partial_results: partialResults,
    recoverWith: normalizedRecoverWith,
    disclosures: userDisclosures.length > 0 ? userDisclosures : base.disclosures,
    traceId: sanitizeTraceId(typeof base.traceId === 'string' ? base.traceId : undefined) ?? base.traceId,
    llmError: typeof base.llmError === 'string' ? parseEpistemicMessage(base.llmError).userMessage : base.llmError,
    epistemicsDebug: debug.length > 0 ? Array.from(new Set(debug)) : base.epistemicsDebug,
  };
}

function normalizeToolErrorResult(toolName: string, args: unknown, result: unknown): Record<string, unknown> | null {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return null;
  const base = result as Record<string, unknown>;

  if (base.error === true && typeof base.message === 'string') {
    return toAgentErrorPayload({
      toolName,
      args,
      message: base.message,
      basePayload: base,
    });
  }

  if (typeof base.error === 'string') {
    return toAgentErrorPayload({
      toolName,
      args,
      message: base.error,
      basePayload: base,
    });
  }

  if (base.success === false && typeof base.message === 'string') {
    return toAgentErrorPayload({
      toolName,
      args,
      message: base.message,
      basePayload: base,
    });
  }

  return null;
}

// ============================================================================
// SERVER IMPLEMENTATION
// ============================================================================

/**
 * Librarian MCP Server
 *
 * Exposes Librarian's knowledge base and tools via MCP protocol.
 */
export class LibrarianMCPServer {
  private server: Server;
  private config: LibrarianMCPServerConfig;
  private state: ServerState;
  private transport: StdioServerTransport | null = null;
  private inFlightToolCalls = 0;
  private readonly inFlightBootstraps = new Map<string, Promise<unknown>>();

  constructor(config: Partial<LibrarianMCPServerConfig> = {}) {
    this.config = {
      ...DEFAULT_MCP_SERVER_CONFIG,
      ...config,
      authorization: {
        ...DEFAULT_MCP_SERVER_CONFIG.authorization,
        ...(config.authorization ?? {}),
      },
      audit: {
        ...DEFAULT_MCP_SERVER_CONFIG.audit,
        ...(config.audit ?? {}),
      },
      performance: {
        ...DEFAULT_MCP_SERVER_CONFIG.performance,
        ...(config.performance ?? {}),
      },
      autoWatch: {
        ...DEFAULT_MCP_SERVER_CONFIG.autoWatch,
        ...(config.autoWatch ?? {}),
      },
      loopDetection: {
        ...DEFAULT_MCP_SERVER_CONFIG.loopDetection,
        ...(config.loopDetection ?? {}),
      },
      humanReview: {
        ...DEFAULT_MCP_SERVER_CONFIG.humanReview,
        ...(config.humanReview ?? {}),
      },
      confidenceUx: {
        ...DEFAULT_MCP_SERVER_CONFIG.confidenceUx,
        ...(config.confidenceUx ?? {}),
        thresholds: {
          ...DEFAULT_MCP_SERVER_CONFIG.confidenceUx.thresholds,
          ...(config.confidenceUx?.thresholds ?? {}),
        },
      },
    };
    this.state = {
      workspaces: new Map(),
      sessions: new Map(),
      auditLog: [],
      authManager: createAuthenticationManager({
        maxSessionsPerClient: 10,
        allowScopeEscalation: false,
      }),
      scopeClaims: new Map(),
      knowledgeClaims: [],
    };

    // Initialize MCP server
    this.server = new Server(
      {
        name: this.config.name,
        version: this.config.version,
      },
      {
        capabilities: {
          resources: {},
          tools: {},
        },
      }
    );

    // Register handlers
    this.registerHandlers();
  }

  /**
   * Register all MCP request handlers.
   */
  private registerHandlers(): void {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async (): Promise<ListToolsResult> => {
      return { tools: this.getAvailableTools() };
    });

    // List available resources
    this.server.setRequestHandler(ListResourcesRequestSchema, async (): Promise<ListResourcesResult> => {
      return { resources: await this.getAvailableResources() };
    });

    // Read a resource
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request: ReadResourceRequestLike): Promise<ReadResourceResult> => {
      const { uri } = request.params;
      return this.readResource(uri);
    });

    // Call a tool
    this.server.setRequestHandler(CallToolRequestSchema, async (request: CallToolRequestLike): Promise<CallToolResult> => {
      const { name, arguments: args } = request.params;
      return this.callTool(name, args);
    });
  }

  /**
   * Get list of available tools.
   */
  private getAvailableTools(): Tool[] {
    const tools: Tool[] = [
      {
        name: 'bootstrap',
        description: 'Bootstrap/index a workspace for knowledge extraction',
        inputSchema: {
          type: 'object',
          properties: {
            workspace: { type: 'string', description: 'Absolute path to workspace' },
            force: { type: 'boolean', description: 'Force re-index' },
            include: { type: 'array', items: { type: 'string' }, description: 'Include patterns' },
            exclude: { type: 'array', items: { type: 'string' }, description: 'Exclude patterns' },
            llmProvider: { type: 'string', enum: ['claude', 'codex'], description: 'LLM provider' },
            maxFiles: { type: 'number', description: 'Max files to index' },
          },
          required: ['workspace'],
        },
      },
      {
        name: 'status',
        description: 'Get status of a workspace including index state and file watcher status',
        inputSchema: {
          type: 'object',
          properties: {
            workspace: { type: 'string', description: 'Workspace path (optional, uses first available if not specified)' },
            sessionId: { type: 'string', description: 'Optional session identifier for session-scoped status details' },
            planId: { type: 'string', description: 'Optional plan ID to retrieve a specific synthesized plan' },
          },
          required: [],
        },
      },
      {
        name: 'get_session_briefing',
        description: 'Return concise session/workspace orientation with next-step MCP actions for low-token startup',
        inputSchema: {
          type: 'object',
          properties: {
            workspace: { type: 'string', description: 'Workspace path (optional, uses first available if not specified)' },
            sessionId: { type: 'string', description: 'Optional session identifier for session-scoped briefing details' },
            includeConstructions: { type: 'boolean', description: 'Include construction onboarding hints in the response (default true)' },
          },
          required: [],
        },
      },
      {
        name: 'system_contract',
        description: 'Get system contract and provenance for a workspace',
        inputSchema: {
          type: 'object',
          properties: {
            workspace: { type: 'string', description: 'Workspace path (optional, uses first available if not specified)' },
          },
          required: [],
        },
      },
      {
        name: 'diagnose_self',
        description: 'Diagnose Librarian self-knowledge drift for a workspace',
        inputSchema: {
          type: 'object',
          properties: {
            workspace: { type: 'string', description: 'Workspace path (optional, uses first available if not specified)' },
          },
          required: [],
        },
      },
      {
        name: 'list_verification_plans',
        description: 'List verification plans for a workspace (typically 1-8KB per page at pageSize=20)',
        inputSchema: {
          type: 'object',
          properties: {
            workspace: { type: 'string', description: 'Workspace path (optional, uses first available if not specified)' },
            limit: { type: 'number', description: 'Limit number of plans returned' },
            pageSize: { type: 'number', description: 'Items per page (default 20, max 200)' },
            pageIdx: { type: 'number', description: 'Zero-based page index (default 0)' },
            outputFile: { type: 'string', description: 'Write page payload to file and return a reference' },
          },
          required: [],
        },
      },
      {
        name: 'list_episodes',
        description: 'List verification episodes for a workspace (typically 1-8KB per page at pageSize=20)',
        inputSchema: {
          type: 'object',
          properties: {
            workspace: { type: 'string', description: 'Workspace path (optional, uses first available if not specified)' },
            limit: { type: 'number', description: 'Limit number of episodes returned' },
            pageSize: { type: 'number', description: 'Items per page (default 20, max 200)' },
            pageIdx: { type: 'number', description: 'Zero-based page index (default 0)' },
            outputFile: { type: 'string', description: 'Write page payload to file and return a reference' },
          },
          required: [],
        },
      },
      {
        name: 'list_technique_primitives',
        description: 'List technique primitives for a workspace (typically 2-12KB per page at pageSize=20)',
        inputSchema: {
          type: 'object',
          properties: {
            workspace: { type: 'string', description: 'Workspace path (optional, uses first available if not specified)' },
            limit: { type: 'number', description: 'Limit number of primitives returned' },
            pageSize: { type: 'number', description: 'Items per page (default 20, max 200)' },
            pageIdx: { type: 'number', description: 'Zero-based page index (default 0)' },
            outputFile: { type: 'string', description: 'Write page payload to file and return a reference' },
          },
          required: [],
        },
      },
      {
        name: 'list_technique_compositions',
        description: 'List technique compositions for a workspace (typically 2-12KB per page at pageSize=20)',
        inputSchema: {
          type: 'object',
          properties: {
            workspace: { type: 'string', description: 'Workspace path (optional, uses first available if not specified)' },
            limit: { type: 'number', description: 'Limit number of compositions returned' },
            pageSize: { type: 'number', description: 'Items per page (default 20, max 200)' },
            pageIdx: { type: 'number', description: 'Zero-based page index (default 0)' },
            outputFile: { type: 'string', description: 'Write page payload to file and return a reference' },
          },
          required: [],
        },
      },
      {
        name: 'select_technique_compositions',
        description: 'Select technique compositions based on intent',
        inputSchema: {
          type: 'object',
          properties: {
            intent: { type: 'string', description: 'Intent or goal to select compositions for' },
            workspace: { type: 'string', description: 'Workspace path (optional, uses first available if not specified)' },
            limit: { type: 'number', description: 'Limit number of compositions returned' },
          },
          required: ['intent'],
        },
      },
      {
        name: 'compile_technique_composition',
        description: 'Compile a technique composition into a work template (discover compositionId via find_symbol kind=composition)',
        inputSchema: {
          type: 'object',
          properties: {
            compositionId: { type: 'string', description: 'Technique composition ID to compile' },
            workspace: { type: 'string', description: 'Workspace path (optional, uses first available if not specified)' },
          },
          required: ['compositionId'],
        },
      },
      {
        name: 'compile_intent_bundles',
        description: 'Compile intent into technique composition bundles',
        inputSchema: {
          type: 'object',
          properties: {
            intent: { type: 'string', description: 'Intent to compile into technique bundles' },
            workspace: { type: 'string', description: 'Workspace path (optional, uses first available if not specified)' },
            limit: { type: 'number', description: 'Limit number of bundles returned' },
            includePrimitives: { type: 'boolean', description: 'Include primitive definitions in output' },
          },
          required: ['intent'],
        },
      },
      {
        name: 'semantic_search',
        description: `Primary semantic code localization tool for finding relevant files/symbols by meaning. ${CONFIDENCE_BEHAVIOR_CONTRACT}`,
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Localization query for semantic code search' },
            workspace: { type: 'string', description: 'Workspace path (optional, uses first ready workspace if not specified)' },
            sessionId: { type: 'string', description: 'Optional session identifier used for loop detection and adaptive search behavior' },
            minConfidence: { type: 'number', description: `Minimum confidence threshold (0-1). ${CONFIDENCE_BEHAVIOR_CONTRACT}` },
            depth: { type: 'string', enum: ['L0', 'L1', 'L2', 'L3'], description: 'Depth of context' },
            limit: { type: 'number', description: 'Maximum results to return (default 20, max 200)' },
            includeEngines: { type: 'boolean', description: 'Include engine diagnostics in output' },
            includeEvidence: { type: 'boolean', description: 'Include evidence graph summary' },
          },
          required: ['query'],
        },
      },
      {
        name: 'get_context_pack',
        description: 'Token-budgeted task context assembly that compresses relevant function and module knowledge before file reads',
        inputSchema: {
          type: 'object',
          properties: {
            intent: { type: 'string', description: 'Task intent used for context pack retrieval' },
            relevantFiles: { type: 'array', items: { type: 'string' }, description: 'Optional relevant file hints for retrieval focus' },
            tokenBudget: { type: 'number', description: 'Hard token budget for assembled context output (default 4000)' },
            workdir: { type: 'string', description: 'Working directory hint for workspace resolution' },
            workspace: { type: 'string', description: 'Workspace path alias for callers that already have it' },
          },
          required: ['intent'],
        },
      },
      {
        name: 'estimate_budget',
        description: 'Pre-task feasibility gate that estimates token burn and recommends safer lower-cost execution alternatives',
        inputSchema: {
          type: 'object',
          properties: {
            taskDescription: { type: 'string', description: 'Task description to estimate before execution' },
            availableTokens: { type: 'number', description: 'Available token budget before compaction' },
            workdir: { type: 'string', description: 'Working directory hint for workspace resolution' },
            pipeline: { type: 'array', items: { type: 'string' }, description: 'Optional explicit pipeline/tool sequence for estimation' },
            workspace: { type: 'string', description: 'Workspace path alias for callers that already have it' },
          },
          required: ['taskDescription', 'availableTokens'],
        },
      },
      {
        name: 'estimate_task_complexity',
        description: 'Model-routing estimator that predicts task complexity, expected token burn, and whether librainian can answer directly',
        inputSchema: {
          type: 'object',
          properties: {
            task: { type: 'string', description: 'Task statement to classify for routing complexity' },
            workdir: { type: 'string', description: 'Working directory hint for workspace resolution' },
            workspace: { type: 'string', description: 'Workspace path alias for callers that already have it' },
            recentFiles: { type: 'array', items: { type: 'string' }, description: 'Optional recently touched files used as routing hints' },
            functionId: { type: 'string', description: 'Optional primary function target for blast-radius estimation' },
          },
          required: ['task'],
        },
      },
      {
        name: 'query',
        description: `Use query for semantic, cross-file context (how systems work, impact paths, patterns, and unfamiliar modules). Do not use query for direct file reads when you already know the exact path; use your file-read tool for that. Call query before large refactors, cross-module debugging, or test planning in unfamiliar code. ${CONFIDENCE_BEHAVIOR_CONTRACT}`,
        inputSchema: {
          type: 'object',
          properties: {
            intent: { type: 'string', description: 'Goal-oriented question for semantic retrieval (for example: "How does auth token refresh work?" or "What breaks if I change X?")' },
            workspace: { type: 'string', description: 'Workspace path (optional, uses first ready workspace if not specified)' },
            sessionId: { type: 'string', description: 'Optional session identifier used for repeated-query loop detection' },
            intentType: { type: 'string', enum: ['understand', 'debug', 'refactor', 'impact', 'security', 'test', 'document', 'navigate', 'general'], description: 'Intent mode: understand=explain, impact=blast radius, debug=root-cause, refactor=safe changes, security=risk review, test=coverage/tests, document=docs summary, navigate=where to look, general=fallback' },
            affectedFiles: { type: 'array', items: { type: 'string' }, description: 'Scope to files' },
            minConfidence: { type: 'number', description: `Min confidence (0-1). ${CONFIDENCE_BEHAVIOR_CONTRACT}` },
            depth: { type: 'string', enum: ['L0', 'L1', 'L2', 'L3'], description: 'Context depth' },
            includeEngines: { type: 'boolean', description: 'Include engine results' },
            includeEvidence: { type: 'boolean', description: 'Include evidence graph' },
            pageSize: { type: 'number', description: 'Items per page (default 20, max 200)' },
            pageIdx: { type: 'number', description: 'Zero-based page index (default 0)' },
            outputFile: { type: 'string', description: 'Write page payload to file and return a reference' },
            explainMisses: { type: 'boolean', description: 'Include near-miss retrieval diagnostics' },
            explain_misses: { type: 'boolean', description: 'Alias for explainMisses' },
            stream: { type: 'boolean', description: 'Enable chunked stream metadata so clients can consume packs incrementally after the query completes' },
            streamChunkSize: { type: 'number', description: 'Chunk size for stream metadata groups (default 5, max 200)' },
          },
          required: ['intent'],
        },
      },
      {
        name: 'synthesize_plan',
        description: 'Create and persist an explicit task plan grounded in prior context pack IDs before making high-impact edits',
        inputSchema: {
          type: 'object',
          properties: {
            task: { type: 'string', description: 'Task description to plan for' },
            context_pack_ids: { type: 'array', items: { type: 'string' }, description: 'Context pack IDs from prior query/get_context_pack_bundle calls' },
            workspace: { type: 'string', description: 'Workspace path (optional, uses first available if not specified)' },
            sessionId: { type: 'string', description: 'Optional session identifier for plan persistence and retrieval' },
          },
          required: ['task', 'context_pack_ids'],
        },
      },
      {
        name: 'explain_function',
        description: 'Explain a specific function by name or ID with callers, callees, and purpose',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Function name or function ID' },
            filePath: { type: 'string', description: 'Optional file path for disambiguation' },
            workspace: { type: 'string', description: 'Workspace path (optional, uses first ready workspace if not specified)' },
          },
          required: ['name'],
        },
      },
      {
        name: 'find_callers',
        description: 'Find direct or transitive caller callsites for a function name or ID',
        inputSchema: {
          type: 'object',
          properties: {
            functionId: { type: 'string', description: 'Target function ID or name to locate callers for' },
            workspace: { type: 'string', description: 'Workspace path (optional, uses first ready workspace if not specified)' },
            transitive: { type: 'boolean', description: 'Include transitive callers (callers-of-callers)' },
            maxDepth: { type: 'number', description: 'Maximum transitive depth when transitive=true (default 3, max 8)' },
            limit: { type: 'number', description: 'Maximum callsites to return (default 100, max 500)' },
          },
          required: ['functionId'],
        },
      },
      {
        name: 'find_callees',
        description: 'Find direct callees for a function name or ID',
        inputSchema: {
          type: 'object',
          properties: {
            functionId: { type: 'string', description: 'Target function ID or name to locate callees for' },
            workspace: { type: 'string', description: 'Workspace path (optional, uses first ready workspace if not specified)' },
            limit: { type: 'number', description: 'Maximum callees to return (default 100, max 500)' },
          },
          required: ['functionId'],
        },
      },
      {
        name: 'find_usages',
        description: 'Find callsites/usages for a symbol name or function ID',
        inputSchema: {
          type: 'object',
          properties: {
            symbol: { type: 'string', description: 'Function name or function ID to locate usages for' },
            workspace: { type: 'string', description: 'Workspace path (optional, uses first ready workspace if not specified)' },
            limit: { type: 'number', description: 'Maximum callsite records to return (default 100, max 500)' },
          },
          required: ['symbol'],
        },
      },
      {
        name: 'trace_imports',
        description: 'Trace imports and/or importers for a file path with bounded depth',
        inputSchema: {
          type: 'object',
          properties: {
            filePath: { type: 'string', description: 'File path to trace dependencies from' },
            direction: { type: 'string', enum: ['imports', 'importedBy', 'both'], description: 'Trace imports, importers, or both' },
            depth: { type: 'number', description: 'Maximum dependency depth (default 2, max 6)' },
            workspace: { type: 'string', description: 'Workspace path (optional, uses first ready workspace if not specified)' },
          },
          required: ['filePath'],
        },
      },
      {
        name: 'find_symbol',
        description: 'Discover opaque IDs (claimId/entityId/compositionId/runId) from human-readable names before calling downstream tools',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Human-readable function, module, claim, composition, or run query' },
            kind: { type: 'string', enum: ['function', 'module', 'context_pack', 'claim', 'composition', 'run'], description: 'Optional category filter' },
            workspace: { type: 'string', description: 'Workspace path (optional, uses first ready workspace if not specified)' },
            limit: { type: 'number', description: 'Maximum matches to return (default 20, max 200)' },
          },
          required: ['query'],
        },
      },
      {
        name: 'reset_session_state',
        description: 'Reset session-scoped query loop detection state for a stuck agent workflow',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: { type: 'string', description: 'Session ID to reset (optional if auth token is provided)' },
            workspace: { type: 'string', description: 'Workspace hint for anonymous session fallback' },
          },
          required: [],
        },
      },
      {
        name: 'request_human_review',
        description: 'Signal uncertain or risky context and request structured human review before proceeding',
        inputSchema: {
          type: 'object',
          properties: {
            reason: { type: 'string', description: 'Why human review is needed' },
            context_summary: { type: 'string', description: 'Summary of uncertain or conflicting context' },
            proposed_action: { type: 'string', description: 'Action the agent was about to take' },
            confidence_tier: { type: 'string', enum: ['low', 'uncertain'], description: 'Confidence tier requiring escalation' },
            risk_level: { type: 'string', enum: ['low', 'medium', 'high'], description: 'Risk if the action is wrong' },
            blocking: { type: 'boolean', description: 'Whether the agent should pause for human response' },
          },
          required: ['reason', 'context_summary', 'proposed_action', 'confidence_tier', 'risk_level', 'blocking'],
        },
      },
      {
        name: 'list_constructions',
        description: 'List registered constructions with manifests, schemas, trust metadata, and capability tags',
        inputSchema: {
          type: 'object',
          properties: {
            tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags to filter constructions' },
            capabilities: { type: 'array', items: { type: 'string' }, description: 'Optional required capability filter' },
            requires: { type: 'array', items: { type: 'string' }, description: 'Alias for capabilities filter' },
            language: { type: 'string', description: 'Optional language filter (example: typescript, python, rust)' },
            trustTier: { type: 'string', enum: ['official', 'partner', 'community'], description: 'Optional trust tier filter' },
            availableOnly: { type: 'boolean', description: 'Only include constructions executable in this runtime' },
          },
          required: [],
        },
      },
      {
        name: 'invoke_construction',
        description: 'Invoke a registered construction by ID with runtime input payload',
        inputSchema: {
          type: 'object',
          properties: {
            constructionId: { type: 'string', description: 'Construction ID returned by list_constructions' },
            input: { type: 'object', description: 'Construction input payload' },
            workspace: { type: 'string', description: 'Workspace path used for runtime dependencies' },
          },
          required: ['constructionId', 'input'],
        },
      },
      {
        name: 'describe_construction',
        description: 'Describe a construction in detail: what it does, I/O shape, usage example, and composition hints',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Construction ID returned by list_constructions' },
            includeExample: { type: 'boolean', description: 'Include executable example snippet (default true)' },
            includeCompositionHints: { type: 'boolean', description: 'Include composition/operator guidance (default true)' },
          },
          required: ['id'],
        },
      },
      {
        name: 'explain_operator',
        description: 'Explain when to use a construction operator, or recommend one from a described situation',
        inputSchema: {
          type: 'object',
          properties: {
            operator: {
              type: 'string',
              enum: ['seq', 'fanout', 'fallback', 'fix', 'select', 'atom', 'dimap', 'map', 'contramap'],
              description: 'Operator to explain directly',
            },
            situation: { type: 'string', description: 'Situation description used for recommendation when operator is omitted' },
          },
          required: [],
        },
      },
      {
        name: 'check_construction_types',
        description: 'Check composition compatibility between two constructions for seq, fanout, or fallback',
        inputSchema: {
          type: 'object',
          properties: {
            first: { type: 'string', description: 'First construction ID' },
            second: { type: 'string', description: 'Second construction ID' },
            operator: { type: 'string', enum: ['seq', 'fanout', 'fallback'], description: 'Composition operator to validate' },
          },
          required: ['first', 'second', 'operator'],
        },
      },
      {
        name: 'get_change_impact',
        description: 'Rank blast-radius impact for a proposed code change (dependents, tests, co-change signals, and risk)',
        inputSchema: {
          type: 'object',
          properties: {
            target: { type: 'string', description: 'Changed file/module/function identifier to analyze' },
            workspace: { type: 'string', description: 'Workspace path (optional, uses first available if not specified)' },
            depth: { type: 'number', description: 'Maximum transitive depth for propagation (default 3, max 8)' },
            maxResults: { type: 'number', description: 'Maximum impacted files to return (default 200, max 1000)' },
            changeType: { type: 'string', enum: ['modify', 'delete', 'rename', 'move'], description: 'Optional change type to refine risk scoring' },
          },
          required: ['target'],
        },
      },
      {
        name: 'blast_radius',
        description: 'Pre-edit transitive impact analysis before changing a function/module (alias of get_change_impact)',
        inputSchema: {
          type: 'object',
          properties: {
            target: { type: 'string', description: 'Changed file/module/function identifier to analyze' },
            workspace: { type: 'string', description: 'Workspace path (optional, uses first available if not specified)' },
            depth: { type: 'number', description: 'Maximum transitive depth for propagation (default 3, max 8)' },
            maxResults: { type: 'number', description: 'Maximum impacted files to return (default 200, max 1000)' },
            changeType: { type: 'string', enum: ['modify', 'delete', 'rename', 'move'], description: 'Optional change type to refine risk scoring' },
          },
          required: ['target'],
        },
      },
      {
        name: 'pre_commit_check',
        description: 'Semantic pre-submit gate over changed files using blast-radius risk checks',
        inputSchema: {
          type: 'object',
          properties: {
            changedFiles: { type: 'array', items: { type: 'string' }, description: 'Changed files to evaluate before submit' },
            workspace: { type: 'string', description: 'Workspace path (optional, uses first available if not specified)' },
            strict: { type: 'boolean', description: 'Enforce stricter pass criteria (default false)' },
            maxRiskLevel: { type: 'string', enum: ['low', 'medium', 'high', 'critical'], description: 'Maximum acceptable risk level for pass (default high)' },
          },
          required: ['changedFiles'],
        },
      },
      {
        name: 'claim_work_scope',
        description: 'Claim/check/release semantic work scopes for parallel agent coordination',
        inputSchema: {
          type: 'object',
          properties: {
            scopeId: { type: 'string', description: 'Semantic scope identifier (file, module, symbol, or task scope key)' },
            workspace: { type: 'string', description: 'Workspace path (optional, used to namespace scope claims)' },
            sessionId: { type: 'string', description: 'Optional session identifier for ownership' },
            owner: { type: 'string', description: 'Optional owner label (agent name/id)' },
            mode: { type: 'string', enum: ['claim', 'release', 'check'], description: 'Claim operation mode (default claim)' },
            ttlSeconds: { type: 'number', description: 'Claim expiration window in seconds (default 1800)' },
          },
          required: ['scopeId'],
        },
      },
      {
        name: 'append_claim',
        description: 'Persist a session knowledge claim with confidence/tags/evidence for later retrieval and harvest',
        inputSchema: {
          type: 'object',
          properties: {
            claim: { type: 'string', description: 'Claim text to persist for later retrieval and session harvest' },
            workspace: { type: 'string', description: 'Workspace path (optional, used for namespacing and audit logs)' },
            sessionId: { type: 'string', description: 'Optional session identifier that owns this claim' },
            tags: { type: 'array', items: { type: 'string' }, description: 'Optional semantic tags for filtering and harvest summaries' },
            evidence: { type: 'array', items: { type: 'string' }, description: 'Optional evidence snippets, IDs, or citations supporting the claim' },
            confidence: { type: 'number', description: 'Optional confidence score in [0,1] (default 0.6)' },
            sourceTool: { type: 'string', description: 'Optional source tool name that generated this claim' },
          },
          required: ['claim'],
        },
      },
      {
        name: 'query_claims',
        description: 'Filter and retrieve claims previously recorded via append_claim',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Optional text query over claim, evidence, and tags' },
            workspace: { type: 'string', description: 'Workspace path filter (optional)' },
            sessionId: { type: 'string', description: 'Optional session identifier filter' },
            tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags filter (matches any provided tag)' },
            since: { type: 'string', description: 'Optional ISO timestamp lower bound for createdAt filtering' },
            limit: { type: 'number', description: 'Maximum claims to return (default 20, max 200)' },
          },
          required: [],
        },
      },
      {
        name: 'harvest_session_knowledge',
        description: 'Summarize session high-confidence claims and optionally sync them into annotated MEMORY.md via memory bridge',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: { type: 'string', description: 'Session to harvest claims from (optional)' },
            workspace: { type: 'string', description: 'Workspace path filter (optional)' },
            maxItems: { type: 'number', description: 'Maximum harvested claims to include (default 20, max 200)' },
            minConfidence: { type: 'number', description: 'Minimum confidence threshold in [0,1]' },
            includeRecommendations: { type: 'boolean', description: 'Include recommended next tools in output' },
            memoryFilePath: { type: 'string', description: 'Optional explicit MEMORY.md path for memory-bridge sync' },
            openclawRoot: { type: 'string', description: 'Optional OpenClaw root used to resolve memoryFilePath when omitted' },
            persistToMemory: { type: 'boolean', description: 'Persist harvested claims into annotated MEMORY.md (default true)' },
            source: { type: 'string', enum: ['openclaw-session', 'manual', 'harvest'], description: 'Memory-bridge source label' },
          },
          required: [],
        },
      },
      {
        name: 'submit_feedback',
        description: 'Submit outcome feedback for a prior query feedbackToken',
        inputSchema: {
          type: 'object',
          properties: {
            feedbackToken: { type: 'string', description: 'Feedback token from query response' },
            outcome: { type: 'string', enum: ['success', 'failure', 'partial'], description: 'Task outcome' },
            workspace: { type: 'string', description: 'Workspace path (optional, uses first available if not specified)' },
            agentId: { type: 'string', description: 'Agent identifier' },
            missingContext: { type: 'string', description: 'Description of missing context' },
            customRatings: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  packId: { type: 'string' },
                  relevant: { type: 'boolean' },
                  usefulness: { type: 'number' },
                  reason: { type: 'string' },
                },
                required: ['packId', 'relevant'],
              },
              description: 'Optional per-pack relevance ratings',
            },
          },
          required: ['feedbackToken', 'outcome'],
        },
      },
      {
        name: 'verify_claim',
        description: 'Verify a knowledge claim against evidence (discover claimId via find_symbol kind=claim)',
        inputSchema: {
          type: 'object',
          properties: {
            claimId: { type: 'string', description: 'Claim ID to verify' },
            force: { type: 'boolean', description: 'Force re-verification' },
          },
          required: ['claimId'],
        },
      },
      {
        name: 'run_audit',
        description: 'Run an audit on the knowledge base',
        inputSchema: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['full', 'claims', 'coverage', 'security', 'freshness'] },
            scope: { type: 'array', items: { type: 'string' }, description: 'Scope patterns' },
            generateReport: { type: 'boolean', description: 'Generate detailed report' },
          },
          required: ['type'],
        },
      },
      {
        name: 'diff_runs',
        description: 'Compare two indexing runs (discover run IDs via find_symbol kind=run or list_runs)',
        inputSchema: {
          type: 'object',
          properties: {
            workspace: { type: 'string', description: 'Workspace path used to resolve persisted run history' },
            runIdA: { type: 'string', description: 'First run ID' },
            runIdB: { type: 'string', description: 'Second run ID' },
            detailed: { type: 'boolean', description: 'Include detailed diff' },
          },
          required: ['runIdA', 'runIdB'],
        },
      },
      {
        name: 'list_runs',
        description: 'List recent persisted bootstrap runs for a workspace',
        inputSchema: {
          type: 'object',
          properties: {
            workspace: { type: 'string', description: 'Workspace path (optional, uses first available if not specified)' },
            limit: { type: 'number', description: 'Maximum runs to return (default 10, max 100)' },
          },
          required: [],
        },
      },
      {
        name: 'export_index',
        description: 'Export the index to a file',
        inputSchema: {
          type: 'object',
          properties: {
            format: { type: 'string', enum: ['json', 'sqlite', 'scip', 'lsif'] },
            outputPath: { type: 'string', description: 'Output file path' },
            includeEmbeddings: { type: 'boolean', description: 'Include embeddings' },
            scope: { type: 'array', items: { type: 'string' }, description: 'Scope patterns' },
          },
          required: ['format', 'outputPath'],
        },
      },
      {
        name: 'get_context_pack_bundle',
        description: `Get bundled context packs for entities (typically 4-20KB per page at pageSize=20). Discover entityIds via find_symbol kind=function/module/context_pack. ${CONFIDENCE_BEHAVIOR_CONTRACT}`,
        inputSchema: {
          type: 'object',
          properties: {
            entityIds: { type: 'array', items: { type: 'string' }, description: 'Entity IDs' },
            bundleType: { type: 'string', enum: ['minimal', 'standard', 'comprehensive'] },
            maxTokens: { type: 'number', description: 'Max token budget' },
            pageSize: { type: 'number', description: 'Items per page (default 20, max 200)' },
            pageIdx: { type: 'number', description: 'Zero-based page index (default 0)' },
            outputFile: { type: 'string', description: 'Write page payload to file and return a reference' },
          },
          required: ['entityIds'],
        },
      },
    ];

    for (const tool of tools) {
      enrichSchemaDescriptions(tool.name, tool.inputSchema as MutableToolSchemaNode);
    }

    // Filter tools based on authorized scopes and annotate capabilities for clients.
    return tools
      .filter((tool) => {
        const auth = TOOL_AUTHORIZATION[tool.name];
        if (!auth) return true;
        return auth.requiredScopes.every((scope) =>
          this.config.authorization.enabledScopes.includes(scope)
        );
      })
      .map((tool) => this.withToolHints(tool));
  }

  private withToolHints(tool: Tool): Tool {
    const hints = TOOL_HINTS[tool.name] ?? {
      readOnlyHint: true,
      openWorldHint: false,
      requiresIndex: false,
      requiresEmbeddings: false,
      estimatedTokens: 1200,
    };

    return {
      ...tool,
      annotations: {
        ...(tool.annotations ?? {}),
        readOnlyHint: hints.readOnlyHint,
        destructiveHint: hints.destructiveHint ?? !hints.readOnlyHint,
        idempotentHint: hints.idempotentHint ?? hints.readOnlyHint,
        openWorldHint: hints.openWorldHint ?? false,
      },
      _meta: {
        ...(tool._meta ?? {}),
        requiresIndex: hints.requiresIndex,
        requiresEmbeddings: hints.requiresEmbeddings,
        estimatedTokens: hints.estimatedTokens,
        outputSchema: ConstructionOutputSchemaHints[tool.name as keyof typeof ConstructionOutputSchemaHints] ?? DefaultToolOutputSchemaHint,
      },
    };
  }

  /**
   * Get list of available resources.
   */
  private async getAvailableResources(): Promise<Resource[]> {
    const resources: Resource[] = [];

    for (const [path, workspace] of this.state.workspaces) {
      if (workspace.indexState === 'ready') {
        resources.push(
          {
            uri: `librarian://${path}/file-tree`,
            name: 'File Tree',
            description: `File tree for ${path}`,
            mimeType: 'application/json',
          },
          {
            uri: `librarian://${path}/symbols`,
            name: 'Symbols',
            description: `Code symbols for ${path}`,
            mimeType: 'application/json',
          },
          {
            uri: `librarian://${path}/knowledge-maps`,
            name: 'Knowledge Maps',
            description: `Knowledge maps for ${path}`,
            mimeType: 'application/json',
          },
          {
            uri: `librarian://${path}/method-packs`,
            name: 'Method Packs',
            description: `Method packs for ${path}`,
            mimeType: 'application/json',
          },
          {
            uri: `librarian://${path}/provenance`,
            name: 'Provenance',
            description: `Index provenance for ${path}`,
            mimeType: 'application/json',
          },
          {
            uri: `librarian://${path}/identity`,
            name: 'Repository Identity',
            description: `Repository identity for ${path}`,
            mimeType: 'application/json',
          }
        );
      }
    }

    // Add global resources
    resources.push({
      uri: 'librarian://audits',
      name: 'Audits',
      description: 'Recent audit results',
      mimeType: 'application/json',
    });

    return resources;
  }

  /**
   * Read a resource by URI.
   */
  private async readResource(uri: string): Promise<ReadResourceResult> {
    const startTime = Date.now();
    const entryId = this.generateId();
    const started = Date.now();

    try {
      // Parse URI
      const parsed = this.parseResourceUri(uri);
      if (!parsed) {
        throw new Error(`Invalid resource URI: ${uri}`);
      }

      // Get resource data
      const data = await this.getResourceData(parsed.workspace, parsed.resourceType);

      const auditWorkspace = parsed.workspace ? path.resolve(parsed.workspace) : undefined;
      const instrumentation = this.getWorkspaceStateForTool(auditWorkspace);
      instrumentation?.auditLogger?.logResourceAccess({
        operation: uri,
        status: 'success',
        workspace: auditWorkspace,
        durationMs: Date.now() - started,
      });

      // Log audit entry
      this.logAudit({
        id: entryId,
        timestamp: new Date().toISOString(),
        operation: 'resource_read',
        name: uri,
        status: 'success',
        durationMs: Date.now() - startTime,
      });

      return {
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(data, null, 2),
          },
        ],
      };
    } catch (error) {
      try {
        const parsed = this.parseResourceUri(uri);
        const auditWorkspace = parsed?.workspace ? path.resolve(parsed.workspace) : undefined;
        const instrumentation = this.getWorkspaceStateForTool(auditWorkspace);
        instrumentation?.auditLogger?.logResourceAccess({
          operation: uri,
          status: 'failure',
          workspace: auditWorkspace,
          durationMs: Date.now() - started,
          error: error instanceof Error ? error.message : String(error),
        });
      } catch {
        // Ignore audit logger failures for resource reads
      }
      this.logAudit({
        id: entryId,
        timestamp: new Date().toISOString(),
        operation: 'resource_read',
        name: uri,
        status: 'failure',
        durationMs: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Call a tool with arguments.
   */
  private async callTool(name: string, args: unknown): Promise<CallToolResult> {
    const startTime = Date.now();
    const entryId = this.generateId();
    const invocation = this.extractToolInvocationContext(args);
    const executionContext: ToolExecutionContext = {};

    try {
      if (invocation.authTokenError) {
        throw new Error(`Authorization denied: ${invocation.authTokenError}`);
      }

      // Validate input
      const validation = validateToolInput(name, invocation.toolArgs);
      if (!validation.valid) {
        throw new Error(`Invalid input: ${validation.errors.map((e) => e.message).join(', ')}`);
      }
      const workspaceHint = this.resolveWorkspaceHint(validation.data);
      const workspace = workspaceHint ? path.resolve(workspaceHint) : undefined;

      // Check authorization
      const auth = TOOL_AUTHORIZATION[name];
      if (auth) {
        const authorized = auth.requiredScopes.every((scope) =>
          this.config.authorization.enabledScopes.includes(scope)
        );
        if (!authorized) {
          this.logAudit({
            id: entryId,
            timestamp: new Date().toISOString(),
            operation: 'authorization',
            name,
            input: this.sanitizeInput(args),
              status: 'denied',
              error: `Missing required scopes: ${auth.requiredScopes.join(', ')}`,
            });
          throw new Error(`Authorization denied: missing required scopes`);
        }
      }

      if (invocation.authToken) {
        const authorization = this.authorizeToolCall(invocation.authToken, name, workspace);
        if (authorization.sessionId) {
          executionContext.sessionId = authorization.sessionId;
        }
        const consentBypassed = authorization.requiresConsent === true && this.config.authorization.requireConsent === false;
        if (!authorization.authorized && !consentBypassed) {
          const missingScopes = authorization.missingScopes?.join(', ');
          const reason = missingScopes
            ? `${authorization.reason ?? 'Insufficient permissions'} (missing scopes: ${missingScopes})`
            : (authorization.reason ?? 'Access denied');
          this.logAudit({
            id: entryId,
            timestamp: new Date().toISOString(),
            operation: 'authorization',
            name,
            input: this.sanitizeInput(invocation.toolArgs),
            status: 'denied',
            error: reason,
            sessionId: authorization.sessionId,
          });
          throw new Error(`Authorization denied: ${reason}`);
        }
      }

      const sanitizedInput = this.sanitizeInput(invocation.toolArgs);
      const inputRecord =
        sanitizedInput && typeof sanitizedInput === 'object' && !Array.isArray(sanitizedInput)
          ? (sanitizedInput as Record<string, unknown>)
          : { value: sanitizedInput };

      const maxConcurrent = Math.max(1, Number(this.config.performance.maxConcurrent ?? 1));
      if (this.inFlightToolCalls >= maxConcurrent) {
        const retryAfterMs = Math.max(200, Math.min(5000, Math.floor((this.config.performance.timeoutMs ?? 1000) / 10)));
        const busyPayload = toAgentErrorPayload({
          toolName: name,
          args: validation.data,
          message: `Server busy: ${this.inFlightToolCalls} tool calls in flight. Retry in ${retryAfterMs}ms.`,
          basePayload: {
            code: 'server_busy',
            retryAfterMs,
            nextSteps: [
              `Retry ${name} after ${retryAfterMs}ms.`,
              'Reduce concurrent tool calls or increase performance.maxConcurrent.',
            ],
          },
        });
        this.logAudit({
          id: entryId,
          timestamp: new Date().toISOString(),
          operation: 'tool_call',
          name,
          input: sanitizedInput,
          status: 'failure',
          durationMs: Date.now() - startTime,
          error: `Server busy: ${this.inFlightToolCalls}/${maxConcurrent} in flight`,
        });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(busyPayload, null, 2),
            },
          ],
          isError: true,
        };
      }

      this.inFlightToolCalls += 1;

      // Execute tool
      const hint = TOOL_HINTS[name];
      const shouldPersistInstrumentation = !(hint?.readOnlyHint ?? false);
      const instrumentation = shouldPersistInstrumentation
        ? await this.ensureWorkspaceInstrumentation(workspace)
        : this.getWorkspaceStateForTool(workspace, { registerIfMissing: true });
      const executionPromise = instrumentation?.toolAdapter
        ? instrumentation.toolAdapter.call(
            { operation: name, input: inputRecord, workspace },
            () => this.executeTool(name, validation.data, executionContext)
          )
        : this.executeTool(name, validation.data, executionContext);
      const baseTimeoutMs = Math.max(1, Number(this.config.performance.timeoutMs ?? 30000));
      const timeoutMs = name === 'query'
        ? baseTimeoutMs + 100
        : baseTimeoutMs;
      const result = await this.executeWithTimeout(executionPromise, timeoutMs, name);

      const normalizedError = normalizeToolErrorResult(name, validation.data, result);
      if (normalizedError) {
        this.logAudit({
          id: entryId,
          timestamp: new Date().toISOString(),
          operation: 'tool_call',
          name,
          input: sanitizedInput,
          status: 'failure',
          durationMs: Date.now() - startTime,
          error: String(normalizedError.message ?? 'Tool execution failed'),
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(normalizedError, null, 2),
            },
          ],
          isError: true,
        };
      }

      // Log success
      this.logAudit({
        id: entryId,
        timestamp: new Date().toISOString(),
        operation: 'tool_call',
        name,
        input: sanitizedInput,
        status: 'success',
        durationMs: Date.now() - startTime,
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      this.logAudit({
        id: entryId,
        timestamp: new Date().toISOString(),
        operation: 'tool_call',
        name,
        input: this.sanitizeInput(invocation.toolArgs),
        status: 'failure',
        durationMs: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      });

      const normalizedError = toAgentErrorPayload({
        toolName: name,
        args: invocation.toolArgs,
        message: error instanceof Error ? error.message : String(error),
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(normalizedError, null, 2),
          },
        ],
        isError: true,
      };
    } finally {
      this.inFlightToolCalls = Math.max(0, this.inFlightToolCalls - 1);
    }
  }

  private extractToolInvocationContext(args: unknown): {
    toolArgs: unknown;
    authToken?: string;
    authTokenError?: string;
  } {
    if (!args || typeof args !== 'object' || Array.isArray(args)) {
      return { toolArgs: args };
    }
    const raw = args as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(raw, '__authToken')) {
      return { toolArgs: args };
    }
    const { __authToken, ...toolArgs } = raw;
    if (typeof __authToken !== 'string' || __authToken.trim().length === 0) {
      return {
        toolArgs,
        authTokenError: 'Invalid authentication token',
      };
    }
    return {
      toolArgs,
      authToken: __authToken.trim(),
    };
  }

  private async executeWithTimeout<T>(promise: Promise<T>, timeoutMs: number, toolName: string): Promise<T> {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;
    return await new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Tool execution timed out after ${timeoutMs}ms (${toolName})`));
      }, timeoutMs);
      void promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        }
      );
    });
  }

  private executeBootstrapDeduped(input: BootstrapToolInput): Promise<unknown> {
    const workspacePath = path.resolve(input.workspace);
    const inFlight = this.inFlightBootstraps.get(workspacePath);
    if (inFlight) return inFlight;
    const execution = this.executeBootstrap(input).finally(() => {
      if (this.inFlightBootstraps.get(workspacePath) === execution) {
        this.inFlightBootstraps.delete(workspacePath);
      }
    });
    this.inFlightBootstraps.set(workspacePath, execution);
    return execution;
  }

  private resolveWorkspaceHint(args: unknown): string | undefined {
    if (args && typeof args === 'object' && 'workspace' in args) {
      const workspace = (args as { workspace?: unknown }).workspace;
      if (typeof workspace === 'string' && workspace.trim()) return workspace;
    }
    const firstRegistered = this.state.workspaces.keys().next();
    if (!firstRegistered.done && typeof firstRegistered.value === 'string' && firstRegistered.value.trim()) {
      return firstRegistered.value;
    }
    if (this.config.workspaces.length > 0) {
      const first = this.config.workspaces[0];
      if (typeof first === 'string' && first.trim()) return first;
    }
    return undefined;
  }

  private getWorkspaceStateForTool(
    workspacePath: string | undefined,
    options: { registerIfMissing?: boolean } = {}
  ): WorkspaceState | null {
    if (!workspacePath || !workspacePath.trim()) return null;
    const resolvedWorkspace = path.resolve(workspacePath);
    let workspace = this.state.workspaces.get(resolvedWorkspace);
    if (!workspace && options.registerIfMissing) {
      this.registerWorkspace(resolvedWorkspace);
      workspace = this.state.workspaces.get(resolvedWorkspace);
    }
    return workspace ?? null;
  }

  private async ensureWorkspaceInstrumentation(
    workspacePath: string | undefined
  ): Promise<WorkspaceState | null> {
    if (!workspacePath || !workspacePath.trim()) return null;
    const resolvedWorkspace = path.resolve(workspacePath);

    let workspace = this.state.workspaces.get(resolvedWorkspace);
    if (!workspace) {
      this.registerWorkspace(resolvedWorkspace);
      workspace = this.state.workspaces.get(resolvedWorkspace);
    }
    if (!workspace) return null;

    if (workspace.toolAdapter && workspace.auditLogger && workspace.evidenceLedger) return workspace;

    try {
      await fs.access(resolvedWorkspace);
    } catch {
      return workspace;
    }

    try {
      const librarianRoot = path.join(resolvedWorkspace, '.librarian');
      await fs.mkdir(librarianRoot, { recursive: true });

      if (!workspace.evidenceLedger) {
        const ledgerPath = path.join(librarianRoot, 'evidence_ledger.db');
        const ledger = new SqliteEvidenceLedger(ledgerPath);
        await ledger.initialize();
        workspace.evidenceLedger = ledger;
      }

      if (!workspace.auditLogger) {
        workspace.auditLogger = createAuditLogger(
          {
            minSeverity: 'debug',
            logDir: this.config.audit.logPath,
            logFilePrefix: 'mcp',
            maxFiles: Math.max(1, this.config.audit.retentionDays),
          },
          { ledger: workspace.evidenceLedger }
        );
        if (this.config.audit.enabled) {
          await workspace.auditLogger.initPersistence(resolvedWorkspace);
        }
      }

      if (!workspace.toolAdapter) {
        workspace.toolAdapter = new AuditBackedToolAdapter(workspace.auditLogger);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logAudit({
        id: this.generateId(),
        timestamp: new Date().toISOString(),
        operation: 'error',
        name: 'workspace_instrumentation',
        status: 'failure',
        error: `unverified_by_trace(instrumentation_failed): ${message}`,
      });
    }

    return workspace;
  }

  private resolveQuerySessionState(input: {
    workspacePath: string;
    context: ToolExecutionContext;
    input: QueryToolInput;
  }): SessionState | null {
    if (!this.config.loopDetection.enabled) return null;
    const explicitSessionId = typeof input.input.sessionId === 'string' && input.input.sessionId.trim().length > 0
      ? input.input.sessionId.trim()
      : undefined;
    const sessionId = input.context.sessionId ?? explicitSessionId ?? this.buildAnonymousSessionId(input.workspacePath);
    return this.getOrCreateSessionState(sessionId);
  }

  private buildAnonymousSessionId(workspacePath: string): string {
    return `anon:${path.resolve(workspacePath)}`;
  }

  private getOrCreateSessionState(sessionId: string): SessionState {
    const now = new Date().toISOString();
    const existing = this.state.sessions.get(sessionId);
    if (existing) {
      existing.lastActivity = now;
      existing.requestCount += 1;
      return existing;
    }

    const created: SessionState = {
      id: sessionId,
      createdAt: now,
      authorizedScopes: new Set<AuthorizationScope>(['read']),
      requestCount: 1,
      lastActivity: now,
      queryHistory: [],
      planHistory: [],
    };
    this.state.sessions.set(sessionId, created);
    return created;
  }

  private toPlanView(record: PlanRecord): {
    plan_id: string;
    planId: string;
    task: string;
    plan: string;
    context_used: string[];
    contextUsed: string[];
    workspace?: string;
    created_at: string;
    createdAt: string;
  } {
    return {
      plan_id: record.planId,
      planId: record.planId,
      task: record.task,
      plan: record.plan,
      context_used: [...record.contextUsed],
      contextUsed: [...record.contextUsed],
      workspace: record.workspace,
      created_at: record.createdAt,
      createdAt: record.createdAt,
    };
  }

  private collectLoopMetrics(history: QueryRecord[], intent: string, workspacePath: string): LoopMetrics {
    const windowMs = Math.max(1, this.config.loopDetection.windowSeconds) * 1000;
    const nowMs = Date.now();
    const normalizedIntent = this.normalizeLoopIntent(intent);
    const fingerprint = this.hashLoopValue(normalizedIntent);
    const semanticHash = this.hashLoopValue(this.toSemanticHashSource(normalizedIntent));

    const withinWindow = history.filter((record) =>
      record.workspace === workspacePath && (nowMs - record.timestampMs) <= windowMs
    );
    const exactMatches = withinWindow.filter((record) => record.fingerprint === fingerprint);
    const semanticMatches = withinWindow.filter((record) =>
      record.semanticHash === semanticHash
      || this.computeSemanticQuerySimilarity(record.normalizedIntent, normalizedIntent) >= LOOP_SEMANTIC_SIMILARITY_THRESHOLD
    );
    const futileMatches = exactMatches.filter((record) => record.resultCount === 0);

    return {
      exactCount: exactMatches.length,
      semanticCount: semanticMatches.length,
      futileCount: futileMatches.length,
    };
  }

  private applyFutileRepeatEscalation(
    query: {
      intent: string;
      intentType?: QueryToolInput['intentType'];
      affectedFiles?: string[];
      minConfidence?: number;
      depth: 'L0' | 'L1' | 'L2' | 'L3';
    },
    futileCount: number
  ): void {
    const threshold = Math.max(1, this.config.loopDetection.futileRepeatThreshold);
    if (futileCount < threshold) return;

    query.minConfidence = Math.min(query.minConfidence ?? 0.5, 0.2);
    if (query.depth === 'L0' || query.depth === 'L1') {
      query.depth = 'L2';
    } else if (query.depth === 'L2') {
      query.depth = 'L3';
    }

    if (futileCount >= threshold + 1) {
      query.minConfidence = 0;
      query.depth = 'L3';
    }
  }

  private recordQueryAndBuildLoopDetection(input: {
    sessionState: SessionState;
    workspacePath: string;
    intent: string;
    resultCount: number;
  }): LoopDetectionResult | undefined {
    const normalizedIntent = this.normalizeLoopIntent(input.intent);
    const record: QueryRecord = {
      fingerprint: this.hashLoopValue(normalizedIntent),
      semanticHash: this.hashLoopValue(this.toSemanticHashSource(normalizedIntent)),
      normalizedIntent,
      timestampMs: Date.now(),
      resultCount: input.resultCount,
      workspace: input.workspacePath,
    };
    input.sessionState.queryHistory.push(record);
    const maxHistory = Math.max(1, this.config.loopDetection.maxSessionHistory);
    if (input.sessionState.queryHistory.length > maxHistory) {
      input.sessionState.queryHistory.splice(0, input.sessionState.queryHistory.length - maxHistory);
    }

    const metrics = this.collectLoopMetrics(input.sessionState.queryHistory, input.intent, input.workspacePath);
    const exactThreshold = Math.max(1, this.config.loopDetection.exactRepeatThreshold);
    const semanticThreshold = Math.max(1, this.config.loopDetection.semanticRepeatThreshold);
    const futileThreshold = Math.max(1, this.config.loopDetection.futileRepeatThreshold);

    if (metrics.futileCount >= futileThreshold && record.resultCount === 0) {
      return this.buildLoopDetectionResult('futile_repeat', metrics.futileCount, normalizedIntent, true);
    }
    if (metrics.exactCount >= exactThreshold) {
      return this.buildLoopDetectionResult('identical_query', metrics.exactCount, normalizedIntent, false);
    }
    if (metrics.semanticCount >= semanticThreshold) {
      return this.buildLoopDetectionResult('semantic_repeat', metrics.semanticCount, normalizedIntent, false);
    }
    return undefined;
  }

  private buildLoopDetectionResult(
    pattern: 'identical_query' | 'semantic_repeat' | 'futile_repeat',
    occurrences: number,
    normalizedIntent: string,
    humanReviewSuggested: boolean
  ): LoopDetectionResult {
    const windowSeconds = Math.max(1, this.config.loopDetection.windowSeconds);
    const strategyTopic = normalizedIntent.split(/\s+/).slice(0, 6).join(' ');
    const patternMessage = pattern === 'futile_repeat'
      ? 'This query has repeatedly returned no useful results.'
      : 'This query pattern has repeated in the current session.';

    return {
      detected: true,
      pattern,
      occurrences,
      windowSeconds,
      message: `${patternMessage} Seen ${occurrences} times in the last ${windowSeconds} seconds. Consider rephrasing, broadening scope, or switching tools.`,
      alternativeStrategies: [
        {
          tool: 'query',
          topic: strategyTopic || 'broader architecture context',
          rationale: 'Try a broader intent phrase or omit specific identifiers to widen retrieval coverage.',
        },
        {
          tool: 'get_context_pack_bundle',
          rationale: 'Bundle context around related entities to inspect connected implementation details.',
        },
        {
          tool: 'status',
          rationale: 'Verify index freshness before retrying if results appear unexpectedly empty.',
        },
      ],
      humanReviewSuggested,
    };
  }

  private normalizeLoopIntent(intent: string): string {
    return intent
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private toSemanticHashSource(normalizedIntent: string): string {
    const tokens = normalizedIntent
      .split(' ')
      .map((token) => token.trim())
      .filter((token) => token.length > 0);
    const uniqueSorted = Array.from(new Set(tokens)).sort();
    return uniqueSorted.join(' ');
  }

  private hashLoopValue(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private computeSemanticQuerySimilarity(a: string, b: string): number {
    if (!a || !b) return 0;
    if (a === b) return 1;
    const aTokens = new Set(a.split(' ').filter(Boolean));
    const bTokens = new Set(b.split(' ').filter(Boolean));
    const intersection = Array.from(aTokens).filter((token) => bTokens.has(token)).length;
    const union = new Set([...aTokens, ...bTokens]).size;
    if (union === 0) return 0;
    return intersection / union;
  }

  private classifyConfidenceTier(confidence: number): 'low' | 'uncertain' | 'strong' {
    if (confidence <= LOW_CONFIDENCE_THRESHOLD) return 'low';
    if (confidence <= UNCERTAIN_CONFIDENCE_THRESHOLD) return 'uncertain';
    return 'strong';
  }

  private getConfidenceTierThresholds(): {
    definitiveMin: number;
    highMin: number;
    mediumMin: number;
    lowMin: number;
  } {
    const clamp = (value: number): number => Math.max(0, Math.min(1, value));
    const configured = this.config.confidenceUx.thresholds;
    const definitiveMin = clamp(configured.definitiveMin);
    const highMin = Math.min(definitiveMin, clamp(configured.highMin));
    const mediumMin = Math.min(highMin, clamp(configured.mediumMin));
    const lowMin = Math.min(mediumMin, clamp(configured.lowMin));
    return {
      definitiveMin,
      highMin,
      mediumMin,
      lowMin,
    };
  }

  private classifyExplainabilityConfidenceTier(confidence: number): RetrievalConfidenceTier {
    if (!Number.isFinite(confidence)) return 'uncertain';
    const thresholds = this.getConfidenceTierThresholds();
    if (confidence >= thresholds.definitiveMin) return 'definitive';
    if (confidence >= thresholds.highMin) return 'high';
    if (confidence >= thresholds.mediumMin) return 'medium';
    if (confidence >= thresholds.lowMin) return 'low';
    return 'uncertain';
  }

  private confidenceTierRank(tier: RetrievalConfidenceTier): number {
    switch (tier) {
      case 'definitive':
        return 5;
      case 'high':
        return 4;
      case 'medium':
        return 3;
      case 'low':
        return 2;
      case 'uncertain':
      default:
        return 1;
    }
  }

  private downgradeConfidenceTier(tier: RetrievalConfidenceTier, steps = 1): RetrievalConfidenceTier {
    const tiers: RetrievalConfidenceTier[] = ['uncertain', 'low', 'medium', 'high', 'definitive'];
    const currentIdx = tiers.indexOf(tier);
    const targetIdx = Math.max(0, currentIdx - steps);
    return tiers[targetIdx];
  }

  private buildConfidenceStatement(
    tier: RetrievalConfidenceTier,
    pack: { packType: string; targetId: string; relatedFiles?: string[] }
  ): string {
    const anchorCount = pack.relatedFiles?.length ?? 0;
    const anchorDetail = anchorCount > 0
      ? `It is anchored to ${anchorCount} related file${anchorCount === 1 ? '' : 's'}.`
      : 'It has no direct file anchors, so treat it as partial context.';
    switch (tier) {
      case 'definitive':
        return `librainian has definitive confidence this ${pack.packType} result for "${pack.targetId}" is directly relevant. ${anchorDetail}`;
      case 'high':
        return `librainian has high confidence this ${pack.packType} result is relevant. ${anchorDetail}`;
      case 'medium':
        return `librainian has medium confidence this ${pack.packType} result is relevant but should be reviewed before making edits. ${anchorDetail}`;
      case 'low':
        return `librainian has low confidence this ${pack.packType} result is only tangentially relevant. ${anchorDetail}`;
      case 'uncertain':
      default:
        return `librainian is uncertain this ${pack.packType} result is relevant. ${anchorDetail}`;
    }
  }

  private buildVerificationGuidance(tier: RetrievalConfidenceTier): string | undefined {
    switch (tier) {
      case 'medium':
        return 'Review before write operations; verify key assumptions against source before editing.';
      case 'low':
        return 'Manual verification recommended. Rephrase the query and inspect neighboring code before writing changes.';
      case 'uncertain':
        return 'Do not proceed on this context alone. Verify manually or call request_human_review before taking action.';
      case 'definitive':
      case 'high':
      default:
        return undefined;
    }
  }

  private buildConfidenceBreakdown(
    pack: { packType: string; summary?: string; relatedFiles?: string[] },
    tier: RetrievalConfidenceTier,
  ): {
    function_signature?: { tier: RetrievalConfidenceTier; reason: string };
    function_body?: { tier: RetrievalConfidenceTier; reason: string };
    llm_summary?: { tier: RetrievalConfidenceTier; reason: string };
    call_graph?: { tier: RetrievalConfidenceTier; reason: string };
  } {
    const signatureTier = pack.packType === 'function_context'
      ? 'definitive'
      : this.downgradeConfidenceTier(tier, 1);
    const summaryTier = pack.summary
      ? this.downgradeConfidenceTier(tier, tier === 'definitive' ? 1 : 0)
      : 'uncertain';
    const callGraphTier = (pack.relatedFiles?.length ?? 0) > 0
      ? (tier === 'uncertain' ? 'low' : 'high')
      : 'low';
    return {
      function_signature: {
        tier: signatureTier,
        reason: pack.packType === 'function_context'
          ? 'Function-context packs are anchored to a concrete target symbol.'
          : 'Non-function packs provide broader structural context and may require corroboration.',
      },
      function_body: {
        tier,
        reason: 'Body confidence follows retrieval ranking confidence for this pack.',
      },
      llm_summary: {
        tier: summaryTier,
        reason: pack.summary
          ? 'Summary confidence is derived from retrieval quality and can drift from source over time.'
          : 'No summary was attached to this pack.',
      },
      call_graph: {
        tier: callGraphTier,
        reason: (pack.relatedFiles?.length ?? 0) > 0
          ? 'Related file anchors provide structural neighborhood signals.'
          : 'No related file anchors were attached for structural verification.',
      },
    };
  }

  private buildAggregateConfidence(
    packs: Array<{ packId: string; packType: string; confidence?: number; confidenceTier: RetrievalConfidenceTier }>,
  ): {
    tier: RetrievalConfidenceTier;
    statement: string;
    highestRiskElement: string;
  } {
    if (packs.length === 0) {
      return {
        tier: 'uncertain',
        statement: 'librainian returned 0 results; confidence is uncertain and manual verification is required.',
        highestRiskElement: 'No retrieval results were returned.',
      };
    }

    const averageConfidence = packs.reduce((sum, pack) => sum + (pack.confidence ?? 0), 0) / packs.length;
    const aggregateTier = this.classifyExplainabilityConfidenceTier(averageConfidence);
    const distribution = new Map<RetrievalConfidenceTier, number>();
    for (const pack of packs) {
      distribution.set(pack.confidenceTier, (distribution.get(pack.confidenceTier) ?? 0) + 1);
    }
    const orderedTiers: RetrievalConfidenceTier[] = ['definitive', 'high', 'medium', 'low', 'uncertain'];
    const distributionText = orderedTiers
      .filter((tier) => (distribution.get(tier) ?? 0) > 0)
      .map((tier) => `${distribution.get(tier)} ${tier}-confidence`)
      .join(', ');
    const riskiestPack = packs.reduce((lowest, candidate) => {
      if (!lowest) return candidate;
      return this.confidenceTierRank(candidate.confidenceTier) < this.confidenceTierRank(lowest.confidenceTier)
        ? candidate
        : lowest;
    }, packs[0] as { packId: string; packType: string; confidence?: number; confidenceTier: RetrievalConfidenceTier });
    return {
      tier: aggregateTier,
      statement: `librainian returned ${packs.length} result${packs.length === 1 ? '' : 's'} with ${distributionText}.`,
      highestRiskElement: `Pack ${riskiestPack.packId} (${riskiestPack.packType}) is the highest-risk element at ${riskiestPack.confidenceTier} confidence.`,
    };
  }

  private toAggregateConfidenceAlias(aggregateConfidence: {
    tier: RetrievalConfidenceTier;
    statement: string;
    highestRiskElement: string;
  }): {
    tier: RetrievalConfidenceTier;
    statement: string;
    highestRiskElement: string;
    highest_risk_element: string;
  } {
    return {
      ...aggregateConfidence,
      highest_risk_element: aggregateConfidence.highestRiskElement,
    };
  }

  private extractIntentKeywords(intent: string): string[] {
    return intent
      .toLowerCase()
      .split(/[^a-z0-9]+/g)
      .map((token) => token.trim())
      .filter((token) => token.length >= 4)
      .slice(0, 8);
  }

  private buildRetrievalRationale(
    pack: { packType: string; summary?: string; keyFacts?: string[]; relatedFiles?: string[]; confidence?: number },
    queryInput: QueryToolInput,
  ): string {
    const reasons: string[] = [];
    reasons.push(`Matched as ${pack.packType} context for intent "${queryInput.intent}".`);
    if ((pack.relatedFiles?.length ?? 0) > 0) {
      reasons.push(`Anchored to ${pack.relatedFiles!.length} related file(s).`);
      if ((pack.relatedFiles?.length ?? 0) === 1) {
        reasons.push('This appears to be a uniquely scoped file anchor for this pack.');
      }
    }
    if ((pack.keyFacts?.length ?? 0) > 0) {
      reasons.push(`Contains ${pack.keyFacts!.length} extracted key facts.`);
    }
    const keywords = this.extractIntentKeywords(queryInput.intent);
    const summary = String(pack.summary ?? '').toLowerCase();
    const overlappingKeywords = keywords.filter((keyword) => summary.includes(keyword));
    if (overlappingKeywords.length > 0) {
      reasons.push(`Summary overlap detected for keywords: ${overlappingKeywords.slice(0, 3).join(', ')}.`);
    }
    if (typeof pack.confidence === 'number') {
      reasons.push(`Confidence tier: ${this.classifyExplainabilityConfidenceTier(pack.confidence)}.`);
    }
    return reasons.join(' ');
  }

  private buildCoverageNote(pack: { relatedFiles?: string[] }): string {
    const relatedCount = pack.relatedFiles?.length ?? 0;
    if (relatedCount === 0) {
      return 'Coverage appears partial: no direct file anchors were attached to this pack.';
    }
    if (relatedCount === 1) {
      return `Covers one primary file (${pack.relatedFiles![0]}). Related callers/callees may require follow-up retrieval.`;
    }
    return `Covers ${relatedCount} related files. Cross-module edge cases outside these anchors may still require follow-up retrieval.`;
  }

  private isSecuritySensitiveIntent(intent: string): boolean {
    return /\b(auth|token|crypto|secret|password|permission|access|delete|drop|rm)\b/i.test(intent);
  }

  private isWriteIntent(input: QueryToolInput): boolean {
    if (input.intentType === 'refactor' || input.intentType === 'impact') return true;
    return /\b(write|modify|edit|delete|remove|refactor|rename|migrate|update|create)\b/i.test(input.intent);
  }

  private isWorkspaceStaleForHumanReview(workspace: WorkspaceState): boolean {
    if (workspace.indexState === 'stale') return true;
    if (!workspace.indexedAt) return false;
    const staleMinutes = this.config.humanReview?.staleIndexThresholdMinutes
      ?? DEFAULT_MCP_SERVER_CONFIG.humanReview.staleIndexThresholdMinutes;
    const thresholdMs = Math.max(1, staleMinutes) * 60_000;
    const indexedAtMs = Date.parse(workspace.indexedAt);
    if (!Number.isFinite(indexedAtMs)) return false;
    return (Date.now() - indexedAtMs) > thresholdMs;
  }

  private buildHumanReviewRecommendation(input: {
    workspace: WorkspaceState;
    queryInput: QueryToolInput;
    packs: Array<{ confidence?: number }>;
    totalConfidence: number;
    loopDetection?: LoopDetectionResult;
  }): {
    recommended: boolean;
    tool: 'request_human_review';
    reason: string;
    confidenceTier: 'low' | 'uncertain';
    riskLevel: 'low' | 'medium' | 'high';
    blockingSuggested: boolean;
  } | undefined {
    const reasons: string[] = [];
    let riskLevel: 'low' | 'medium' | 'high' = 'low';
    let blockingSuggested = false;
    let tier: 'low' | 'uncertain' | undefined;

    const perPackConfidences = input.packs
      .map((pack) => pack.confidence)
      .filter((value): value is number => typeof value === 'number');
    const allUncertainPacks = perPackConfidences.length > 0
      && perPackConfidences.every((value) => this.classifyConfidenceTier(value) === 'uncertain');
    const overallTier = this.classifyConfidenceTier(input.totalConfidence);

    if (overallTier === 'low') {
      tier = 'low';
      reasons.push('Overall retrieval confidence is low.');
      riskLevel = 'medium';
      blockingSuggested = true;
    } else if (overallTier === 'uncertain') {
      tier = 'uncertain';
    }

    if (allUncertainPacks) {
      tier = tier ?? 'uncertain';
      reasons.push('All retrieved packs are in the uncertain confidence band.');
      riskLevel = riskLevel === 'low' ? 'medium' : riskLevel;
    }

    if ((input.loopDetection?.occurrences ?? 0) >= 3) {
      reasons.push(`Loop detection fired ${input.loopDetection?.occurrences} times in this session.`);
      riskLevel = 'high';
      blockingSuggested = true;
      tier = tier ?? 'uncertain';
    }

    if (this.isSecuritySensitiveIntent(input.queryInput.intent) && overallTier !== 'strong') {
      reasons.push('Intent appears security-sensitive while confidence is below strong.');
      riskLevel = 'high';
      blockingSuggested = true;
      tier = tier ?? 'uncertain';
    }

    if (this.isWorkspaceStaleForHumanReview(input.workspace) && this.isWriteIntent(input.queryInput)) {
      reasons.push('Workspace index appears stale for a write-oriented intent.');
      riskLevel = 'high';
      blockingSuggested = true;
      tier = tier ?? 'uncertain';
    }

    if (reasons.length === 0 || !tier) return undefined;

    return {
      recommended: true,
      tool: 'request_human_review',
      reason: reasons.join(' '),
      confidenceTier: tier,
      riskLevel,
      blockingSuggested,
    };
  }

  private paginateItems<T>(items: T[], options: PaginationOptions = {}): { items: T[]; pagination: PaginationMetadata } {
    const rawPageSize = options.pageSize ?? options.limit ?? DEFAULT_PAGE_SIZE;
    const pageSize = Number.isFinite(rawPageSize)
      ? Math.max(1, Math.min(MAX_PAGE_SIZE, Math.trunc(rawPageSize as number)))
      : DEFAULT_PAGE_SIZE;

    const rawPageIdx = options.pageIdx ?? 0;
    const pageIdx = Number.isFinite(rawPageIdx)
      ? Math.max(0, Math.trunc(rawPageIdx as number))
      : 0;

    const totalItems = items.length;
    const pageCount = totalItems === 0 ? 0 : Math.ceil(totalItems / pageSize);
    const start = pageIdx * pageSize;
    const end = Math.min(start + pageSize, totalItems);
    const pageItems = start >= totalItems ? [] : items.slice(start, end);

    const showingFrom = pageItems.length === 0 ? 0 : start + 1;
    const showingTo = pageItems.length === 0 ? 0 : start + pageItems.length;
    const hasNextPage = end < totalItems;
    const hasPreviousPage = pageIdx > 0 && totalItems > 0;
    const nextPageIdx = hasNextPage ? pageIdx + 1 : undefined;
    const previousPageIdx = hasPreviousPage ? pageIdx - 1 : undefined;
    const showing = `Showing ${showingFrom}-${showingTo} of ${totalItems}. Next: ${nextPageIdx !== undefined ? `pageIdx=${nextPageIdx}` : 'none'}. Total pages: ${pageCount}.`;

    return {
      items: pageItems,
      pagination: {
        pageSize,
        pageIdx,
        totalItems,
        pageCount,
        hasNextPage,
        hasPreviousPage,
        nextPageIdx,
        previousPageIdx,
        showingFrom,
        showingTo,
        showing,
      },
    };
  }

  private coerceStreamChunkSize(raw: unknown): number {
    if (!Number.isFinite(raw as number)) return DEFAULT_STREAM_CHUNK_SIZE;
    return Math.max(1, Math.min(MAX_STREAM_CHUNK_SIZE, Math.trunc(raw as number)));
  }

  private buildQueryStreamChunks(
    packs: Array<{ packId: string }>,
    chunkSize: number
  ): Array<{
    chunkIndex: number;
    packCount: number;
    packIds: string[];
  }> {
    const normalizedChunkSize = Math.max(1, chunkSize);
    const chunks: Array<{ chunkIndex: number; packCount: number; packIds: string[] }> = [];
    for (let start = 0; start < packs.length; start += normalizedChunkSize) {
      const segment = packs.slice(start, start + normalizedChunkSize);
      chunks.push({
        chunkIndex: chunks.length,
        packCount: segment.length,
        packIds: segment.map((pack) => pack.packId),
      });
    }
    return chunks;
  }

  private async writeOutputReference(
    outputFile: string,
    payload: unknown,
    pagination: PaginationMetadata,
    workspacePath?: string
  ): Promise<{
    filePath: string;
    summary: string;
    totalItems: number;
    pageCount: number;
    pageSize: number;
    pageIdx: number;
    pagination: PaginationMetadata;
  }> {
    const basePath = workspacePath ? path.resolve(workspacePath) : process.cwd();
    const outputPath = path.isAbsolute(outputFile)
      ? path.resolve(outputFile)
      : path.resolve(basePath, outputFile);

    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');

    return {
      filePath: outputPath,
      summary: pagination.showing,
      totalItems: pagination.totalItems,
      pageCount: pagination.pageCount,
      pageSize: pagination.pageSize,
      pageIdx: pagination.pageIdx,
      pagination,
    };
  }

  private buildConstructionResultEnvelope<T>(params: {
    output: T;
    schemaName: string;
    runId: string;
    durationMs: number;
    meta: {
      constructionId: string;
      workspace?: string;
      intent?: string;
      compositionId?: string;
    };
    evidence?: string[];
    trivialResult?: boolean;
  }): ConstructionResultEnvelope<T> {
    const tokensUsed = Math.round(JSON.stringify(params.output).length / 4);
    return {
      success: true,
      output: params.output,
      schema: params.schemaName,
      evidence: params.evidence ?? [],
      runId: params.runId,
      tokensUsed,
      durationMs: params.durationMs,
      trivialResult: params.trivialResult ?? false,
      meta: {
        constructionId: params.meta.constructionId,
        schemaName: params.schemaName,
        workspace: params.meta.workspace,
        intent: params.meta.intent,
        compositionId: params.meta.compositionId,
      },
    };
  }

  private validateConstructionOutputOrError<T>(
    constructionId: string,
    schemaName: string,
    schema: z.ZodType<T>,
    output: unknown
  ): { ok: true; data: T } | { ok: false; error: string } {
    const validation = validateConstructionOutput(schema, output);
    if (validation.valid) {
      return { ok: true, data: validation.data };
    }
    const error = new Error(`${validation.message}: ${validation.issues.join('; ')}`);
    console.error('[mcp] Construction output schema validation failed', {
      constructionId,
      schema: schemaName,
      issues: validation.issues,
      stack: error.stack,
    });
    return {
      ok: false,
      error: `schema_validation_failed(${constructionId}): ${validation.issues.join('; ')}`,
    };
  }

  /**
   * Execute a specific tool.
   */
  private async executeTool(name: string, args: unknown, context: ToolExecutionContext = {}): Promise<unknown> {
    switch (name) {
      case 'bootstrap':
        return this.executeBootstrapDeduped(args as BootstrapToolInput);
      case 'status':
        return this.executeStatus(args as StatusToolInput, context);
      case 'get_session_briefing':
        return this.executeGetSessionBriefing(args as GetSessionBriefingToolInput, context);
      case 'system_contract':
        return this.executeSystemContract(args as SystemContractToolInput);
      case 'diagnose_self':
        return this.executeDiagnoseSelf(args as DiagnoseSelfToolInput);
      case 'list_verification_plans':
        return this.executeListVerificationPlans(args as ListVerificationPlansToolInput);
      case 'list_episodes':
        return this.executeListEpisodes(args as ListEpisodesToolInput);
      case 'list_technique_primitives':
        return this.executeListTechniquePrimitives(args as ListTechniquePrimitivesToolInput);
      case 'list_technique_compositions':
        return this.executeListTechniqueCompositions(args as ListTechniqueCompositionsToolInput);
      case 'select_technique_compositions':
        return this.executeSelectTechniqueCompositions(args as SelectTechniqueCompositionsToolInput);
      case 'compile_technique_composition':
        return this.executeCompileTechniqueComposition(args as CompileTechniqueCompositionToolInput);
      case 'compile_intent_bundles':
        return this.executeCompileIntentBundles(args as CompileIntentBundlesToolInput);
      case 'semantic_search':
        return this.executeSemanticSearch(args as SemanticSearchToolInput, context);
      case 'get_context_pack':
        return this.executeGetContextPack(args as GetContextPackToolInput, context);
      case 'estimate_budget':
        return this.executeEstimateBudget(args as EstimateBudgetToolInput);
      case 'estimate_task_complexity':
        return this.executeEstimateTaskComplexity(args as EstimateTaskComplexityToolInput);
      case 'query':
        return this.executeQuery(args as QueryToolInput, context);
      case 'synthesize_plan':
        return this.executeSynthesizePlan(args as SynthesizePlanToolInput, context);
      case 'explain_function':
        return this.executeExplainFunction(args as ExplainFunctionToolInput);
      case 'find_callers':
        return this.executeFindCallers(args as FindCallersToolInput);
      case 'find_callees':
        return this.executeFindCallees(args as FindCalleesToolInput);
      case 'find_usages':
        return this.executeFindUsages(args as FindUsagesToolInput);
      case 'trace_imports':
        return this.executeTraceImports(args as TraceImportsToolInput);
      case 'reset_session_state':
        return this.executeResetSessionState(args as ResetSessionStateToolInput, context);
      case 'request_human_review':
        return this.executeRequestHumanReview(args as RequestHumanReviewToolInput);
      case 'list_constructions':
        return this.executeListConstructions(args as ListConstructionsToolInput);
      case 'invoke_construction':
        return this.executeInvokeConstruction(args as InvokeConstructionToolInput);
      case 'describe_construction':
        return this.executeDescribeConstruction(args as DescribeConstructionToolInput);
      case 'explain_operator':
        return this.executeExplainOperator(args as ExplainOperatorToolInput);
      case 'check_construction_types':
        return this.executeCheckConstructionTypes(args as CheckConstructionTypesToolInput);
      case 'get_change_impact':
        return this.executeGetChangeImpact(args as GetChangeImpactToolInput);
      case 'blast_radius':
        return this.executeBlastRadius(args as BlastRadiusToolInput);
      case 'pre_commit_check':
        return this.executePreCommitCheck(args as PreCommitCheckToolInput);
      case 'claim_work_scope':
        return this.executeClaimWorkScope(args as ClaimWorkScopeToolInput, context);
      case 'append_claim':
        return this.executeAppendClaim(args as AppendClaimToolInput, context);
      case 'query_claims':
        return this.executeQueryClaims(args as QueryClaimsToolInput);
      case 'harvest_session_knowledge':
        return this.executeHarvestSessionKnowledge(args as HarvestSessionKnowledgeToolInput, context);
      case 'submit_feedback':
        return this.executeSubmitFeedback(args as SubmitFeedbackToolInput);
      case 'find_symbol':
        return this.executeFindSymbol(args as FindSymbolToolInput);
      case 'verify_claim':
        return this.executeVerifyClaim(args as VerifyClaimToolInput);
      case 'run_audit':
        return this.executeRunAudit(args as RunAuditToolInput);
      case 'list_runs':
        return this.executeListRuns(args as ListRunsToolInput);
      case 'diff_runs':
        return this.executeDiffRuns(args as DiffRunsToolInput);
      case 'export_index':
        return this.executeExportIndex(args as ExportIndexToolInput);
      case 'get_context_pack_bundle':
        return this.executeGetContextPackBundle(args as GetContextPackBundleToolInput);
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  // ============================================================================
  // TOOL IMPLEMENTATIONS
  // ============================================================================

  /**
   * Get or create storage for a workspace.
   * Prefers using existing Librarian instance's storage to avoid duplicates.
   * Handles migration from legacy .db to .sqlite files.
   */
  private async getOrCreateStorage(workspacePath: string): Promise<LibrarianStorage> {
    // Validate workspace path is absolute and accessible
    const resolvedWorkspace = path.resolve(workspacePath);
    try {
      await fs.access(resolvedWorkspace);
    } catch {
      throw new Error(`Workspace not accessible: ${resolvedWorkspace}`);
    }

    const workspace = this.state.workspaces.get(resolvedWorkspace);

    // First, try to get storage from existing Librarian instance
    if (workspace?.librarian) {
      const librarianStorage = workspace.librarian.getStorage();
      if (librarianStorage) {
        workspace.storage = librarianStorage;
        return librarianStorage;
      }
    }

    // Return existing storage if available
    if (workspace?.storage) {
      return workspace.storage;
    }

    // Setup paths
    const librarianRoot = path.join(resolvedWorkspace, '.librarian');
    const sqlitePath = path.join(librarianRoot, 'librarian.sqlite');
    const legacyDbPath = path.join(librarianRoot, 'librarian.db');

    // Validate path doesn't escape workspace (security check)
    const dbPathRel = path.relative(librarianRoot, sqlitePath);
    if (dbPathRel.startsWith('..') || path.isAbsolute(dbPathRel)) {
      throw new Error('Security: database path must be within workspace/.librarian');
    }

    // Ensure directory exists
    await fs.mkdir(librarianRoot, { recursive: true });

    // Determine which database file to use (migration logic)
    let dbPath = sqlitePath;
    try {
      await fs.access(sqlitePath);
      // .sqlite exists, use it
    } catch {
      // .sqlite doesn't exist, check for legacy .db
      try {
        await fs.access(legacyDbPath);
        // Legacy .db exists - migrate by renaming
        await fs.rename(legacyDbPath, sqlitePath);
        console.error(`[MCP] Migrated database from ${legacyDbPath} to ${sqlitePath}`);
      } catch {
        // Neither exists, create new .sqlite (dbPath is already set)
      }
    }

    // Create and initialize storage
    const storage = createSqliteStorage(dbPath, resolvedWorkspace);
    try {
      await storage.initialize();
    } catch (error) {
      throw new Error(`Failed to initialize storage: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Register workspace if not already registered
    if (!workspace) {
      this.registerWorkspace(resolvedWorkspace);
    }

    // Store the storage instance (safe after registerWorkspace)
    const ws = this.state.workspaces.get(resolvedWorkspace);
    if (ws) {
      ws.storage = storage;
    }

    return storage;
  }

  private getWorkspaceSearchOrder(preferredWorkspace?: string): string[] {
    const candidates: string[] = [];
    if (preferredWorkspace && preferredWorkspace.trim().length > 0) {
      candidates.push(path.resolve(preferredWorkspace));
    }
    for (const workspace of this.state.workspaces.keys()) {
      candidates.push(path.resolve(workspace));
    }
    for (const workspace of this.config.workspaces ?? []) {
      if (typeof workspace === 'string' && workspace.trim().length > 0) {
        candidates.push(path.resolve(workspace));
      }
    }

    const deduped: string[] = [];
    const seen = new Set<string>();
    for (const candidate of candidates) {
      if (seen.has(candidate)) continue;
      seen.add(candidate);
      deduped.push(candidate);
    }
    return deduped;
  }

  private normalizeBootstrapRunHistory(raw: unknown): BootstrapRunRecord[] {
    const toFinite = (value: unknown, fallback = 0): number => {
      const num = typeof value === 'number' ? value : Number(value);
      return Number.isFinite(num) ? num : fallback;
    };
    let candidateRuns: unknown[] = [];
    if (Array.isArray(raw)) {
      candidateRuns = raw;
    } else if (raw && typeof raw === 'object' && Array.isArray((raw as { runs?: unknown[] }).runs)) {
      candidateRuns = (raw as { runs: unknown[] }).runs;
    }

    const runs: BootstrapRunRecord[] = [];
    for (const value of candidateRuns) {
      if (!value || typeof value !== 'object') continue;
      const record = value as Record<string, unknown>;
      const runId = typeof record.runId === 'string' ? record.runId : '';
      const workspace = typeof record.workspace === 'string' ? record.workspace : '';
      const startedAt = typeof record.startedAt === 'string' ? record.startedAt : '';
      if (!runId || !workspace || !startedAt) continue;
      const startedAtMs = Date.parse(startedAt);
      if (!Number.isFinite(startedAtMs)) continue;
      const rawCompletedAt = typeof record.completedAt === 'string' ? record.completedAt : undefined;
      const completedAt = rawCompletedAt && Number.isFinite(Date.parse(rawCompletedAt)) ? rawCompletedAt : undefined;
      const statsRaw = record.stats;
      const statsObj = statsRaw && typeof statsRaw === 'object'
        ? (statsRaw as Record<string, unknown>)
        : {};
      runs.push({
        runId,
        workspace: path.resolve(workspace),
        startedAt,
        completedAt,
        success: record.success === true,
        durationMs: Math.max(0, toFinite(record.durationMs, 0)),
        stats: {
          filesProcessed: Math.max(0, toFinite(statsObj.filesProcessed, 0)),
          functionsIndexed: Math.max(0, toFinite(statsObj.functionsIndexed, 0)),
          contextPacksCreated: Math.max(0, toFinite(statsObj.contextPacksCreated, 0)),
          averageConfidence: toFinite(statsObj.averageConfidence, 0),
        },
        error: typeof record.error === 'string' ? record.error : undefined,
      });
    }

    runs.sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
    return runs;
  }

  private async getBootstrapRunHistory(storage: LibrarianStorage): Promise<BootstrapRunRecord[]> {
    const raw = await storage.getState(BOOTSTRAP_RUN_HISTORY_STATE_KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      return this.normalizeBootstrapRunHistory(parsed);
    } catch {
      return [];
    }
  }

  private async setBootstrapRunHistory(storage: LibrarianStorage, runs: BootstrapRunRecord[]): Promise<void> {
    const payload = {
      schemaVersion: BOOTSTRAP_RUN_HISTORY_SCHEMA_VERSION,
      runs: runs.slice(0, MAX_PERSISTED_BOOTSTRAP_RUNS),
    };
    await storage.setState(BOOTSTRAP_RUN_HISTORY_STATE_KEY, JSON.stringify(payload));
  }

  private async persistBootstrapRunRecord(
    workspacePath: string,
    record: BootstrapRunRecord,
    storageHint?: LibrarianStorage
  ): Promise<void> {
    let storage = storageHint;
    if (!storage) {
      try {
        storage = await this.getOrCreateStorage(workspacePath);
      } catch {
        return;
      }
    }

    const history = await this.getBootstrapRunHistory(storage);
    const merged = [record, ...history.filter((entry) => entry.runId !== record.runId)];
    await this.setBootstrapRunHistory(storage, merged);
  }

  private async findBootstrapRunRecord(
    runId: string,
    preferredWorkspace?: string
  ): Promise<BootstrapRunRecord | null> {
    for (const workspacePath of this.getWorkspaceSearchOrder(preferredWorkspace)) {
      try {
        const storage = await this.getOrCreateStorage(workspacePath);
        const history = await this.getBootstrapRunHistory(storage);
        const match = history.find((entry) => entry.runId === runId);
        if (match) return match;
      } catch {
        // Ignore inaccessible/uninitialized workspaces while searching.
      }
    }
    return null;
  }

  private async executeBootstrap(input: BootstrapToolInput): Promise<unknown> {
    const startTime = Date.now();
    const runId = this.generateId();

    try {
      const workspacePath = path.resolve(input.workspace);

      // Verify workspace exists
      try {
        await fs.access(workspacePath);
      } catch {
        return {
          success: false,
          error: `Workspace not found: ${workspacePath}`,
          workspace: input.workspace,
        };
      }

      // Check if we already have a Librarian instance for this workspace
      const existingWorkspace = this.state.workspaces.get(workspacePath);
      if (existingWorkspace?.librarian && !input.force) {
        // Check if bootstrap is required via existing librarian
        const status = await existingWorkspace.librarian.getStatus();
        if (status.bootstrapped) {
          return {
            success: true,
            message: 'Bootstrap not required',
            reason: 'Already bootstrapped',
            workspace: workspacePath,
            runId,
            watching: existingWorkspace.watching,
            get_started: {
              constructionsQuickstart: 'docs/constructions/quickstart.md',
              constructionsOperatorGuide: 'docs/constructions/operators.md',
              constructionsCookbook: 'docs/constructions/cookbook.md',
              constructionsTesting: 'docs/constructions/testing.md',
              cliListConstructions: 'npx librainian constructions list',
            },
          };
        }
      }

      // Update workspace state
      this.updateWorkspaceState(workspacePath, { indexState: 'indexing' });

      // Create Librarian with autoWatch enabled based on server config
      const autoWatchEnabled = this.config.autoWatch?.enabled ?? true;
      const debounceMs = this.config.autoWatch?.debounceMs ?? 200;

      const librarian = await createLibrarian({
        workspace: workspacePath,
        autoBootstrap: true,
        autoWatch: autoWatchEnabled,
        bootstrapConfig: {
          include: input.include,
          exclude: input.exclude,
          llmProvider: input.llmProvider as 'claude' | 'codex' | undefined,
          maxFileSizeBytes: input.maxFiles ? input.maxFiles * 1024 : undefined,
          forceReindex: input.force,
          fileTimeoutMs: input.fileTimeoutMs,
          fileTimeoutRetries: input.fileTimeoutRetries,
          fileTimeoutPolicy: input.fileTimeoutPolicy,
        },
        llmProvider: input.llmProvider as 'claude' | 'codex' | undefined,
      });

      // Get status after bootstrap
      const status = await librarian.getStatus();
      const storage = librarian.getStorage() ?? undefined;
      const storageStats = storage ? await storage.getStats().catch(() => null) : null;

      // Validate autoWatch is actually running if enabled
      const actuallyWatching = librarian.isWatching();
      const watcherStatus = autoWatchEnabled
        ? actuallyWatching
          ? 'active'
          : 'failed_to_start'
        : 'disabled';

      // Update workspace state with librarian instance
      this.updateWorkspaceState(workspacePath, {
        indexState: status.bootstrapped ? 'ready' : 'stale',
        indexedAt: status.lastBootstrap?.toISOString(),
        lastBootstrapRunId: runId,
        librarian,
        storage,
        watching: actuallyWatching,
      });

      const completedAt = new Date();
      const durationMs = Math.max(0, completedAt.getTime() - startTime);
      const runRecord: BootstrapRunRecord = {
        runId,
        workspace: workspacePath,
        startedAt: new Date(startTime).toISOString(),
        completedAt: completedAt.toISOString(),
        success: status.bootstrapped,
        durationMs,
        stats: {
          filesProcessed: status.stats.totalModules,
          functionsIndexed: status.stats.totalFunctions,
          contextPacksCreated: status.stats.totalContextPacks,
          averageConfidence: storageStats?.averageConfidence ?? 0,
        },
      };
      await this.persistBootstrapRunRecord(workspacePath, runRecord, storage ?? undefined);

      return {
        success: status.bootstrapped,
        runId,
        workspace: workspacePath,
        durationMs,
        stats: {
          filesProcessed: status.stats.totalModules,
          functionsIndexed: status.stats.totalFunctions,
          contextPacksCreated: status.stats.totalContextPacks,
        },
        autoWatch: {
          requested: autoWatchEnabled,
          active: actuallyWatching,
          status: watcherStatus,
          debounceMs: actuallyWatching ? debounceMs : undefined,
        },
        get_started: {
          constructionsQuickstart: 'docs/constructions/quickstart.md',
          constructionsOperatorGuide: 'docs/constructions/operators.md',
          constructionsCookbook: 'docs/constructions/cookbook.md',
          constructionsTesting: 'docs/constructions/testing.md',
          cliListConstructions: 'npx librainian constructions list',
        },
      };
    } catch (error) {
      const workspacePath = typeof input.workspace === 'string' ? path.resolve(input.workspace) : undefined;
      const completedAt = new Date();
      const durationMs = Math.max(0, completedAt.getTime() - startTime);
      if (workspacePath) {
        await this.persistBootstrapRunRecord(workspacePath, {
          runId,
          workspace: workspacePath,
          startedAt: new Date(startTime).toISOString(),
          completedAt: completedAt.toISOString(),
          success: false,
          durationMs,
          stats: {
            filesProcessed: 0,
            functionsIndexed: 0,
            contextPacksCreated: 0,
            averageConfidence: 0,
          },
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return {
        success: false,
        runId,
        workspace: input.workspace,
        durationMs,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async executeStatus(input: StatusToolInput, context: ToolExecutionContext = {}): Promise<unknown> {
    try {
      // Resolve workspace path
      let workspacePath: string | undefined;
      if (input.workspace) {
        workspacePath = path.resolve(input.workspace);
      } else {
        // Find first available workspace
        const first = this.state.workspaces.keys().next();
        workspacePath = first.done ? undefined : first.value;
      }

      if (!workspacePath) {
        return {
          success: false,
          error: 'No workspace specified and no workspaces registered',
          registeredWorkspaces: 0,
        };
      }

      const workspace = this.state.workspaces.get(workspacePath);
      if (!workspace) {
        return {
          success: false,
          error: `Workspace not registered: ${workspacePath}`,
          registeredWorkspaces: this.state.workspaces.size,
          availableWorkspaces: Array.from(this.state.workspaces.keys()),
        };
      }

      // Get librarian status if available
      let librarianStatus = null;
      if (workspace.librarian) {
        const status = await workspace.librarian.getStatus();
        librarianStatus = {
          initialized: status.initialized,
          bootstrapped: status.bootstrapped,
          version: status.version,
          stats: status.stats,
          lastBootstrap: status.lastBootstrap?.toISOString(),
        };
      }

      // Get watcher status
      const isWatching = workspace.librarian?.isWatching() ?? false;
      let watchStatus: { active: boolean; storageAttached: boolean; state: unknown; health?: unknown } | null = null;
      let watchStatusError: string | null = null;
      if (workspace.librarian) {
        try {
          const result = await workspace.librarian.getWatchStatus();
          watchStatus = result ? {
            active: result.active,
            storageAttached: result.storageAttached,
            state: result.state,
            health: result.health,
          } : null;
        } catch (error) {
          watchStatusError = error instanceof Error ? error.message : String(error);
        }
      }
      const watchActive = watchStatus?.active ?? isWatching;
      const watcherStatus = workspace.watching
        ? watchActive
          ? 'active'
          : 'configured_but_inactive'
        : 'disabled';

      const explicitSessionId = typeof input.sessionId === 'string' && input.sessionId.trim().length > 0
        ? input.sessionId.trim()
        : undefined;
      const contextSessionId = typeof context.sessionId === 'string' && context.sessionId.trim().length > 0
        ? context.sessionId.trim()
        : undefined;
      const planSessionId = explicitSessionId ?? contextSessionId ?? this.buildAnonymousSessionId(workspacePath);
      const planSession = this.state.sessions.get(planSessionId);
      const recentPlanViews = (planSession?.planHistory ?? []).slice(-5).map((record) => this.toPlanView(record));
      const requestedPlanId = typeof input.planId === 'string' && input.planId.trim().length > 0
        ? input.planId.trim()
        : undefined;
      const planByIdRecord = requestedPlanId
        ? planSession?.planHistory.find((record) => record.planId === requestedPlanId) ?? null
        : undefined;

      return {
        success: true,
        workspace: workspacePath,
        indexState: workspace.indexState,
        indexedAt: workspace.indexedAt,
        lastBootstrapRunId: workspace.lastBootstrapRunId,
        hasStorage: !!workspace.storage,
        hasLibrarian: !!workspace.librarian,
        autoWatch: {
          configured: workspace.watching ?? false,
          active: watchActive,
          status: watcherStatus,
          debounceMs: this.config.autoWatch?.debounceMs ?? 200,
          storageAttached: watchStatus?.storageAttached ?? false,
          state: watchStatus?.state ?? null,
          health: watchStatus?.health ?? null,
          error: watchStatusError ?? undefined,
        },
        librarian: librarianStatus,
        serverConfig: {
          autoWatchEnabled: this.config.autoWatch?.enabled ?? true,
          autoWatchDebounceMs: this.config.autoWatch?.debounceMs ?? 200,
        },
        planTracking: {
          sessionId: planSessionId,
          session_id: planSessionId,
          totalPlans: planSession?.planHistory.length ?? 0,
          total_plans: planSession?.planHistory.length ?? 0,
          recentPlans: recentPlanViews,
          recent_plans: recentPlanViews,
          planById: planByIdRecord ? this.toPlanView(planByIdRecord) : (requestedPlanId ? null : undefined),
          plan_by_id: planByIdRecord ? this.toPlanView(planByIdRecord) : (requestedPlanId ? null : undefined),
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async executeGetSessionBriefing(
    input: GetSessionBriefingToolInput,
    context: ToolExecutionContext = {},
  ): Promise<unknown> {
    try {
      let workspacePath: string | undefined;
      if (input.workspace) {
        workspacePath = path.resolve(input.workspace);
      } else {
        const first = this.state.workspaces.keys().next();
        workspacePath = first.done ? undefined : first.value;
      }

      const workspace = workspacePath ? this.state.workspaces.get(workspacePath) : undefined;
      const explicitSessionId = typeof input.sessionId === 'string' && input.sessionId.trim().length > 0
        ? input.sessionId.trim()
        : undefined;
      const contextSessionId = typeof context.sessionId === 'string' && context.sessionId.trim().length > 0
        ? context.sessionId.trim()
        : undefined;
      const sessionId = explicitSessionId
        ?? contextSessionId
        ?? this.buildAnonymousSessionId(workspacePath ?? process.cwd());
      const session = this.state.sessions.get(sessionId);
      const includeConstructions = input.includeConstructions ?? true;
      const availableTools = this.getAvailableTools().map((tool) => tool.name);
      const recentPlans = (session?.planHistory ?? []).slice(-5).map((record) => this.toPlanView(record));

      const recommendedActions: Array<{ tool: string; rationale: string }> = [];
      if (!workspacePath) {
        recommendedActions.push({
          tool: 'bootstrap',
          rationale: 'No workspace is registered yet. Bootstrap first so retrieval and symbol tooling can operate.',
        });
      } else if (!workspace) {
        recommendedActions.push({
          tool: 'bootstrap',
          rationale: 'Workspace is not registered in this MCP session. Bootstrap to attach storage and index state.',
        });
      } else if (workspace.indexState !== 'ready') {
        recommendedActions.push({
          tool: 'bootstrap',
          rationale: `Workspace index is ${workspace.indexState}. Re-bootstrap to reach ready state before semantic workflows.`,
        });
      } else {
        recommendedActions.push({
          tool: 'query',
          rationale: 'Start with a semantic orientation query to collect context packs for current goals.',
        });
        recommendedActions.push({
          tool: 'find_symbol',
          rationale: 'Resolve human-readable names into claim/function/run IDs before downstream targeted tools.',
        });
        recommendedActions.push({
          tool: 'get_change_impact',
          rationale: 'Run pre-edit blast-radius analysis before modifying high-risk functions or modules.',
        });
        if ((session?.planHistory.length ?? 0) === 0) {
          recommendedActions.push({
            tool: 'synthesize_plan',
            rationale: 'No persisted plan exists for this session yet; create one before major edits.',
          });
        }
      }

      return {
        success: true,
        sessionId,
        session_id: sessionId,
        workspace: workspacePath,
        workspaceState: workspace
          ? {
            indexState: workspace.indexState,
            indexedAt: workspace.indexedAt,
            hasLibrarian: !!workspace.librarian,
            hasStorage: !!workspace.storage,
            watching: workspace.watching ?? false,
            lastBootstrapRunId: workspace.lastBootstrapRunId,
          }
          : null,
        planTracking: {
          totalPlans: session?.planHistory.length ?? 0,
          total_plans: session?.planHistory.length ?? 0,
          recentPlans,
          recent_plans: recentPlans,
        },
        recommendedActions,
        availableTools,
        guidance: {
          confidenceContract: CONFIDENCE_BEHAVIOR_CONTRACT,
          docs: {
            startHere: 'docs/START_HERE.md',
            mcpSetup: 'docs/mcp-setup.md',
          },
        },
        constructions: includeConstructions
          ? {
            quickstart: 'docs/constructions/quickstart.md',
            operatorGuide: 'docs/constructions/operators.md',
            cookbook: 'docs/constructions/cookbook.md',
            cliListCommand: 'npx librainian constructions list',
          }
          : undefined,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async executeSystemContract(input: { workspace?: string }): Promise<unknown> {
    try {
      let workspacePath: string | undefined;
      if (input.workspace) {
        workspacePath = path.resolve(input.workspace);
      } else {
        const first = this.state.workspaces.keys().next();
        workspacePath = first.done ? undefined : first.value;
      }

      if (!workspacePath) {
        return {
          success: false,
          error: 'No workspace specified and no workspaces registered',
          registeredWorkspaces: 0,
        };
      }

      const workspace = this.state.workspaces.get(workspacePath);
      if (!workspace?.librarian) {
        return {
          success: false,
          error: `Workspace not registered: ${workspacePath}`,
          registeredWorkspaces: this.state.workspaces.size,
          availableWorkspaces: Array.from(this.state.workspaces.keys()),
        };
      }

      const contract = await workspace.librarian.getSystemContract();
      return {
        success: true,
        workspace: workspacePath,
        contract,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async executeDiagnoseSelf(input: { workspace?: string }): Promise<unknown> {
    try {
      let workspacePath: string | undefined;
      if (input.workspace) {
        workspacePath = path.resolve(input.workspace);
      } else {
        const first = this.state.workspaces.keys().next();
        workspacePath = first.done ? undefined : first.value;
      }

      if (!workspacePath) {
        return {
          success: false,
          error: 'No workspace specified and no workspaces registered',
          registeredWorkspaces: 0,
        };
      }

      const workspace = this.state.workspaces.get(workspacePath);
      if (!workspace?.librarian) {
        return {
          success: false,
          error: `Workspace not registered: ${workspacePath}`,
          registeredWorkspaces: this.state.workspaces.size,
          availableWorkspaces: Array.from(this.state.workspaces.keys()),
        };
      }

      const diagnosis = await workspace.librarian.diagnoseSelf();
      return {
        success: true,
        workspace: workspacePath,
        diagnosis,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async executeListVerificationPlans(input: ListVerificationPlansToolInput): Promise<unknown> {
    try {
      let workspacePath: string | undefined;
      if (input.workspace) {
        workspacePath = path.resolve(input.workspace);
      } else {
        const first = this.state.workspaces.keys().next();
        workspacePath = first.done ? undefined : first.value;
      }

      if (!workspacePath) {
        return {
          success: false,
          error: 'No workspace specified and no workspaces registered',
          registeredWorkspaces: 0,
        };
      }

      const workspace = this.state.workspaces.get(workspacePath);
      if (!workspace?.librarian) {
        return {
          success: false,
          error: `Workspace not registered: ${workspacePath}`,
          registeredWorkspaces: this.state.workspaces.size,
          availableWorkspaces: Array.from(this.state.workspaces.keys()),
        };
      }

      const plans = await workspace.librarian.listVerificationPlans();
      const { items: pagedPlans, pagination } = this.paginateItems(plans, input);

      if (input.outputFile) {
        const reference = await this.writeOutputReference(
          input.outputFile,
          {
            success: true,
            workspace: workspacePath,
            plans: pagedPlans,
            pagination,
            sortOrder: 'storage_order',
          },
          pagination,
          workspacePath
        );
        return {
          success: true,
          workspace: workspacePath,
          ...reference,
          sortOrder: 'storage_order',
        };
      }

      return {
        success: true,
        workspace: workspacePath,
        plans: pagedPlans,
        total: plans.length,
        limited: input.limit ? pagedPlans.length : undefined,
        pagination,
        sortOrder: 'storage_order',
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async executeListEpisodes(input: ListEpisodesToolInput): Promise<unknown> {
    try {
      let workspacePath: string | undefined;
      if (input.workspace) {
        workspacePath = path.resolve(input.workspace);
      } else {
        const first = this.state.workspaces.keys().next();
        workspacePath = first.done ? undefined : first.value;
      }

      if (!workspacePath) {
        return {
          success: false,
          error: 'No workspace specified and no workspaces registered',
          registeredWorkspaces: 0,
        };
      }

      const workspace = this.state.workspaces.get(workspacePath);
      if (!workspace?.librarian) {
        return {
          success: false,
          error: `Workspace not registered: ${workspacePath}`,
          registeredWorkspaces: this.state.workspaces.size,
          availableWorkspaces: Array.from(this.state.workspaces.keys()),
        };
      }

      const episodes = await workspace.librarian.listEpisodes();
      const { items: pagedEpisodes, pagination } = this.paginateItems(episodes, input);

      if (input.outputFile) {
        const reference = await this.writeOutputReference(
          input.outputFile,
          {
            success: true,
            workspace: workspacePath,
            episodes: pagedEpisodes,
            pagination,
            sortOrder: 'storage_order',
          },
          pagination,
          workspacePath
        );
        return {
          success: true,
          workspace: workspacePath,
          ...reference,
          sortOrder: 'storage_order',
        };
      }

      return {
        success: true,
        workspace: workspacePath,
        episodes: pagedEpisodes,
        total: episodes.length,
        limited: input.limit ? pagedEpisodes.length : undefined,
        pagination,
        sortOrder: 'storage_order',
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async executeListTechniquePrimitives(input: ListTechniquePrimitivesToolInput): Promise<unknown> {
    try {
      let workspacePath: string | undefined;
      if (input.workspace) {
        workspacePath = path.resolve(input.workspace);
      } else {
        const first = this.state.workspaces.keys().next();
        workspacePath = first.done ? undefined : first.value;
      }

      if (!workspacePath) {
        return {
          success: false,
          error: 'No workspace specified and no workspaces registered',
          registeredWorkspaces: 0,
        };
      }

      const workspace = this.state.workspaces.get(workspacePath);
      if (!workspace?.librarian) {
        return {
          success: false,
          error: `Workspace not registered: ${workspacePath}`,
          registeredWorkspaces: this.state.workspaces.size,
          availableWorkspaces: Array.from(this.state.workspaces.keys()),
        };
      }

      const primitives = await workspace.librarian.listTechniquePrimitives();
      const { items: pagedPrimitives, pagination } = this.paginateItems(primitives, input);

      if (input.outputFile) {
        const reference = await this.writeOutputReference(
          input.outputFile,
          {
            success: true,
            workspace: workspacePath,
            primitives: pagedPrimitives,
            pagination,
            sortOrder: 'storage_order',
          },
          pagination,
          workspacePath
        );
        return {
          success: true,
          workspace: workspacePath,
          ...reference,
          sortOrder: 'storage_order',
        };
      }

      return {
        success: true,
        workspace: workspacePath,
        primitives: pagedPrimitives,
        total: primitives.length,
        limited: input.limit ? pagedPrimitives.length : undefined,
        pagination,
        sortOrder: 'storage_order',
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async executeListTechniqueCompositions(input: ListTechniqueCompositionsToolInput): Promise<unknown> {
    try {
      let workspacePath: string | undefined;
      if (input.workspace) {
        workspacePath = path.resolve(input.workspace);
      } else {
        const first = this.state.workspaces.keys().next();
        workspacePath = first.done ? undefined : first.value;
      }

      if (!workspacePath) {
        return {
          success: false,
          error: 'No workspace specified and no workspaces registered',
          registeredWorkspaces: 0,
        };
      }

      const workspace = this.state.workspaces.get(workspacePath);
      if (!workspace?.librarian) {
        return {
          success: false,
          error: `Workspace not registered: ${workspacePath}`,
          registeredWorkspaces: this.state.workspaces.size,
          availableWorkspaces: Array.from(this.state.workspaces.keys()),
        };
      }

      const compositions = await workspace.librarian.listTechniqueCompositions();
      const { items: pagedCompositions, pagination } = this.paginateItems(compositions, input);

      if (input.outputFile) {
        const reference = await this.writeOutputReference(
          input.outputFile,
          {
            success: true,
            workspace: workspacePath,
            compositions: pagedCompositions,
            pagination,
            sortOrder: 'storage_order',
          },
          pagination,
          workspacePath
        );
        return {
          success: true,
          workspace: workspacePath,
          ...reference,
          sortOrder: 'storage_order',
        };
      }

      return {
        success: true,
        workspace: workspacePath,
        compositions: pagedCompositions,
        total: compositions.length,
        limited: input.limit ? pagedCompositions.length : undefined,
        pagination,
        sortOrder: 'storage_order',
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async executeSelectTechniqueCompositions(
    input: SelectTechniqueCompositionsToolInput
  ): Promise<unknown> {
    const startTime = Date.now();
    const runId = this.generateId();
    try {
      let workspacePath: string | undefined;
      if (input.workspace) {
        workspacePath = path.resolve(input.workspace);
      } else {
        const first = this.state.workspaces.keys().next();
        workspacePath = first.done ? undefined : first.value;
      }

      if (!workspacePath) {
        return {
          success: false,
          error: 'No workspace specified and no workspaces registered',
          registeredWorkspaces: 0,
        };
      }

      const workspace = this.state.workspaces.get(workspacePath);
      if (!workspace?.librarian) {
        return {
          success: false,
          error: `Workspace not registered: ${workspacePath}`,
          registeredWorkspaces: this.state.workspaces.size,
          availableWorkspaces: Array.from(this.state.workspaces.keys()),
        };
      }

      const compositions = await workspace.librarian.ensureTechniqueCompositions();
      const selections = selectTechniqueCompositions(input.intent, compositions);
      const limit = input.limit && input.limit > 0 ? input.limit : undefined;
      const trimmed = limit ? selections.slice(0, limit) : selections;
      const output = {
        intent: input.intent,
        compositions: trimmed,
        total: selections.length,
        limited: limit ? trimmed.length : undefined,
      };
      const validated = this.validateConstructionOutputOrError(
        'select_technique_compositions',
        'SelectTechniqueCompositionsOutputSchema',
        SelectTechniqueCompositionsOutputSchema,
        output
      );
      if (!validated.ok) {
        return {
          success: false,
          error: validated.error,
          workspace: workspacePath,
          runId,
        };
      }
      const constructionResult = this.buildConstructionResultEnvelope({
        output: validated.data,
        schemaName: 'SelectTechniqueCompositionsOutputSchema',
        runId,
        durationMs: Date.now() - startTime,
        trivialResult: trimmed.length <= 1,
        meta: {
          constructionId: 'select_technique_compositions',
          workspace: workspacePath,
          intent: input.intent,
        },
      });

      return {
        success: true,
        workspace: workspacePath,
        ...validated.data,
        runId,
        constructionResult,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async executeCompileTechniqueComposition(
    input: CompileTechniqueCompositionToolInput
  ): Promise<unknown> {
    const startTime = Date.now();
    const runId = this.generateId();
    try {
      let workspacePath: string | undefined;
      if (input.workspace) {
        workspacePath = path.resolve(input.workspace);
      } else {
        const first = this.state.workspaces.keys().next();
        workspacePath = first.done ? undefined : first.value;
      }

      if (!workspacePath) {
        return {
          success: false,
          error: 'No workspace specified and no workspaces registered',
          registeredWorkspaces: 0,
        };
      }

      const workspace = this.state.workspaces.get(workspacePath);
      if (!workspace?.librarian) {
        return {
          success: false,
          error: `Workspace not registered: ${workspacePath}`,
          registeredWorkspaces: this.state.workspaces.size,
          availableWorkspaces: Array.from(this.state.workspaces.keys()),
        };
      }

      const storage = workspace.librarian.getStorage();
      if (!storage) {
        return {
          success: false,
          error: `Workspace storage not initialized: ${workspacePath}`,
        };
      }

      if (input.includePrimitives) {
        const bundle = await compileTechniqueCompositionBundleFromStorage(
          storage,
          input.compositionId
        );
        if (!bundle.template) {
          return {
            success: false,
            error: `Unknown technique composition: ${input.compositionId}`,
          };
        }
        const output = {
          compositionId: input.compositionId,
          template: bundle.template,
          primitives: bundle.primitives,
          missingPrimitiveIds: bundle.missingPrimitiveIds,
        };
        const validated = this.validateConstructionOutputOrError(
          'compile_technique_composition',
          'CompileTechniqueCompositionOutputSchema',
          CompileTechniqueCompositionOutputSchema,
          output
        );
        if (!validated.ok) {
          return {
            success: false,
            error: validated.error,
            workspace: workspacePath,
            runId,
            compositionId: input.compositionId,
          };
        }
        const constructionResult = this.buildConstructionResultEnvelope({
          output: validated.data,
          schemaName: 'CompileTechniqueCompositionOutputSchema',
          runId,
          durationMs: Date.now() - startTime,
          trivialResult: bundle.primitives.length <= 1,
          meta: {
            constructionId: 'compile_technique_composition',
            workspace: workspacePath,
            compositionId: input.compositionId,
          },
        });

        return {
          success: true,
          workspace: workspacePath,
          ...validated.data,
          runId,
          constructionResult,
        };
      }

      const result = await compileTechniqueCompositionTemplateWithGapsFromStorage(
        storage,
        input.compositionId
      );

      if (!result.template) {
        return {
          success: false,
          error: `Unknown technique composition: ${input.compositionId}`,
        };
      }
      const output = {
        compositionId: input.compositionId,
        template: result.template,
        missingPrimitiveIds: result.missingPrimitiveIds,
      };
      const validated = this.validateConstructionOutputOrError(
        'compile_technique_composition',
        'CompileTechniqueCompositionOutputSchema',
        CompileTechniqueCompositionOutputSchema,
        output
      );
      if (!validated.ok) {
        return {
          success: false,
          error: validated.error,
          workspace: workspacePath,
          runId,
          compositionId: input.compositionId,
        };
      }
      const constructionResult = this.buildConstructionResultEnvelope({
        output: validated.data,
        schemaName: 'CompileTechniqueCompositionOutputSchema',
        runId,
        durationMs: Date.now() - startTime,
        trivialResult: result.missingPrimitiveIds.length === 0,
        meta: {
          constructionId: 'compile_technique_composition',
          workspace: workspacePath,
          compositionId: input.compositionId,
        },
      });

      return {
        success: true,
        workspace: workspacePath,
        ...validated.data,
        runId,
        constructionResult,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async executeCompileIntentBundles(
    input: CompileIntentBundlesToolInput
  ): Promise<unknown> {
    const startTime = Date.now();
    const runId = this.generateId();
    try {
      let workspacePath: string | undefined;
      if (input.workspace) {
        workspacePath = path.resolve(input.workspace);
      } else {
        const first = this.state.workspaces.keys().next();
        workspacePath = first.done ? undefined : first.value;
      }

      if (!workspacePath) {
        return {
          success: false,
          error: 'No workspace specified and no workspaces registered',
          registeredWorkspaces: 0,
        };
      }

      const workspace = this.state.workspaces.get(workspacePath);
      if (!workspace?.librarian) {
        return {
          success: false,
          error: `Workspace not registered: ${workspacePath}`,
          registeredWorkspaces: this.state.workspaces.size,
          availableWorkspaces: Array.from(this.state.workspaces.keys()),
        };
      }

      const storage = workspace.librarian.getStorage();
      if (!storage) {
        return {
          success: false,
          error: `Workspace storage not initialized: ${workspacePath}`,
        };
      }

      const bundles = await compileTechniqueBundlesFromIntent(storage, input.intent);
      const limit = input.limit && input.limit > 0 ? input.limit : undefined;
      const trimmed = limit ? bundles.slice(0, limit) : bundles;
      const trimmedBundles = input.includePrimitives === false
        ? trimmed.map(({ template, missingPrimitiveIds }) => ({ template, missingPrimitiveIds }))
        : trimmed;
      const output = {
        intent: input.intent,
        bundles: trimmedBundles,
        total: bundles.length,
        limited: limit ? trimmedBundles.length : undefined,
      };
      const validated = this.validateConstructionOutputOrError(
        'compile_intent_bundles',
        'CompileIntentBundlesOutputSchema',
        CompileIntentBundlesOutputSchema,
        output
      );
      if (!validated.ok) {
        return {
          success: false,
          error: validated.error,
          workspace: workspacePath,
          runId,
          intent: input.intent,
        };
      }
      const constructionResult = this.buildConstructionResultEnvelope({
        output: validated.data,
        schemaName: 'CompileIntentBundlesOutputSchema',
        runId,
        durationMs: Date.now() - startTime,
        trivialResult: trimmedBundles.length <= 1,
        meta: {
          constructionId: 'compile_intent_bundles',
          workspace: workspacePath,
          intent: input.intent,
        },
      });

      return {
        success: true,
        workspace: workspacePath,
        ...validated.data,
        runId,
        constructionResult,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async executeQuery(input: QueryToolInput, context: ToolExecutionContext = {}): Promise<unknown> {
    try {
      // Find workspace - use specified or find first ready
      let workspace: WorkspaceState | undefined;
      if (input.workspace) {
        const resolvedPath = path.resolve(input.workspace);
        workspace = this.state.workspaces.get(resolvedPath);
        if (!workspace) {
          const { userDisclosures, epistemicsDebug } = sanitizeDisclosures([
            `unverified_by_trace(workspace_unavailable): ${input.workspace ?? 'unknown workspace'}`,
          ]);
          return {
            packs: [],
            totalConfidence: 0,
            retrievalStatus: 'insufficient',
            retrievalEntropy: 0,
            retrievalInsufficient: true,
            suggestedClarifyingQuestions: [],
            error: `Specified workspace not registered: ${input.workspace}. Available: ${Array.from(this.state.workspaces.keys()).join(', ') || 'none'}`,
            intent: input.intent,
            disclosures: userDisclosures,
            fix: buildQueryFixCommands('workspace_unavailable', input.workspace),
            adequacy: undefined,
            verificationPlan: undefined,
            traceId: 'replay_unavailable',
            constructionPlan: undefined,
            epistemicsDebug,
          };
        }
        if (workspace.indexState !== 'ready') {
          const { userDisclosures, epistemicsDebug } = sanitizeDisclosures([
            `unverified_by_trace(bootstrap_required): Workspace not ready (${workspace.indexState}).`,
          ]);
          return {
            packs: [],
            totalConfidence: 0,
            retrievalStatus: 'insufficient',
            retrievalEntropy: 0,
            retrievalInsufficient: true,
            suggestedClarifyingQuestions: [],
            error: `Workspace not ready (state: ${workspace.indexState}). Run bootstrap first.`,
            intent: input.intent,
            workspace: resolvedPath,
            disclosures: userDisclosures,
            fix: buildQueryFixCommands('bootstrap_required', input.workspace),
            adequacy: undefined,
            verificationPlan: undefined,
            traceId: 'replay_unavailable',
            constructionPlan: undefined,
            epistemicsDebug,
          };
        }
      } else {
        workspace = this.findReadyWorkspace();
        if (!workspace) {
          const { userDisclosures, epistemicsDebug } = sanitizeDisclosures([
            'unverified_by_trace(bootstrap_required): No indexed workspace available.',
          ]);
          return {
            packs: [],
            totalConfidence: 0,
            retrievalStatus: 'insufficient',
            retrievalEntropy: 0,
            retrievalInsufficient: true,
            suggestedClarifyingQuestions: [],
            error: 'No indexed workspace available. Run bootstrap first.',
            intent: input.intent,
            disclosures: userDisclosures,
            fix: buildQueryFixCommands('bootstrap_required', input.workspace),
            adequacy: undefined,
            verificationPlan: undefined,
            traceId: 'replay_unavailable',
            constructionPlan: undefined,
            epistemicsDebug,
          };
        }
      }

      const storage = await this.getOrCreateStorage(workspace.path);
      const sessionState = this.resolveQuerySessionState({
        workspacePath: workspace.path,
        input,
        context,
      });
      const preLoopMetrics = sessionState
        ? this.collectLoopMetrics(sessionState.queryHistory, input.intent, workspace.path)
        : null;

      const streamEnabled = input.stream === true;
      const streamChunkSize = this.coerceStreamChunkSize(input.streamChunkSize);
      const queryStartMs = Date.now();
      const progressEvents: QueryProgressEvent[] = [];
      const recordProgress = (stage: string, details?: Record<string, unknown>): void => {
        progressEvents.push({
          stage,
          timestamp: new Date().toISOString(),
          elapsedMs: Math.max(0, Date.now() - queryStartMs),
          details,
        });
      };

      // Build query object
      const query = {
        intent: input.intent,
        intentType: input.intentType,
        affectedFiles: input.affectedFiles,
        minConfidence: input.minConfidence,
        depth: (input.depth as 'L0' | 'L1' | 'L2' | 'L3') ?? 'L1',
      };
      if (sessionState && preLoopMetrics && this.config.loopDetection.autoEscalateStrategy) {
        this.applyFutileRepeatEscalation(query, preLoopMetrics.futileCount);
      }
      recordProgress('query_started', {
        workspace: workspace.path,
        intentType: query.intentType ?? 'general',
        depth: query.depth,
        streamEnabled,
      });

      // Execute query with an internal timeout for partial return semantics.
      const configuredTimeoutMs = Math.max(1, Number(this.config.performance.timeoutMs ?? 30000));
      const queryTimeoutMs = Math.max(1, configuredTimeoutMs - 25);
      const timeoutToken = Symbol('query_timeout');
      const responseOrTimeout = await Promise.race([
        queryLibrarian(
          query,
          storage,
          undefined,
          undefined,
          undefined,
          {
            evidenceLedger: workspace.evidenceLedger,
          }
        ),
        new Promise<typeof timeoutToken>((resolve) => {
          setTimeout(() => resolve(timeoutToken), queryTimeoutMs);
        }),
      ]);

      if (responseOrTimeout === timeoutToken) {
        recordProgress('query_timed_out', { timeoutMs: queryTimeoutMs });
        const aggregateConfidence = this.buildAggregateConfidence([]);
        const timeoutResult = {
          packs: [],
          totalConfidence: 0,
          retrievalStatus: 'insufficient' as const,
          retrievalEntropy: 0,
          retrievalInsufficient: true,
          suggestedClarifyingQuestions: [],
          coverageGaps: [] as string[],
          nearMisses: [] as Array<{ packId: string; reason: string }>,
          disclosures: [`Query timed out after ${queryTimeoutMs}ms; returning partial result.`],
          adequacy: undefined,
          verificationPlan: undefined,
          traceId: 'replay_unavailable',
          constructionPlan: undefined,
          intent: input.intent,
          pagination: {
            pageSize: input.pageSize ?? DEFAULT_PAGE_SIZE,
            pageIdx: input.pageIdx ?? 0,
            totalItems: 0,
            pageCount: 0,
            hasNextPage: false,
            hasPreviousPage: false,
            showingFrom: 0,
            showingTo: 0,
            showing: 'Showing 0-0 of 0. Next: none. Total pages: 0.',
          },
          sortOrder: 'retrieval_score_desc' as const,
          aggregateConfidence,
          timedOut: true,
          partial: true,
          timeoutMs: queryTimeoutMs,
          progress: {
            completed: false,
            events: progressEvents,
          },
          stream: streamEnabled
            ? {
                enabled: true,
                chunkSize: streamChunkSize,
                totalChunks: 0,
                chunks: [],
              }
            : undefined,
        };
        return {
          ...timeoutResult,
          coverage_gaps: timeoutResult.coverageGaps,
          aggregate_confidence: this.toAggregateConfidenceAlias(timeoutResult.aggregateConfidence),
          near_misses: timeoutResult.nearMisses,
          timed_out: true,
          partial_result: true,
          progress_view: timeoutResult.progress,
          stream_view: timeoutResult.stream,
        };
      }

      const response = responseOrTimeout;
      recordProgress('query_retrieval_complete', {
        packCount: response.packs.length,
        totalConfidence: response.totalConfidence,
      });

      const transformedPacks = response.packs.map((pack) => {
        const confidenceTier = this.classifyExplainabilityConfidenceTier(pack.confidence ?? 0);
        const retrievalRationale = this.buildRetrievalRationale(pack, input);
        const coverageNote = this.buildCoverageNote(pack);
        const confidenceStatement = this.buildConfidenceStatement(confidenceTier, pack);
        const verificationGuidance = this.buildVerificationGuidance(confidenceTier);
        const confidenceBreakdown = this.buildConfidenceBreakdown(pack, confidenceTier);
        return {
          packId: pack.packId,
          packType: pack.packType,
          targetId: pack.targetId,
          summary: pack.summary,
          keyFacts: pack.keyFacts,
          relatedFiles: pack.relatedFiles,
          confidence: pack.confidence,
          confidenceTier,
          confidence_tier: confidenceTier,
          confidenceStatement,
          confidence_statement: confidenceStatement,
          verificationGuidance,
          verification_guidance: verificationGuidance,
          confidenceBreakdown,
          confidence_breakdown: confidenceBreakdown,
          retrievalRationale,
          retrieval_rationale: retrievalRationale,
          coverageNote,
          coverage_note: coverageNote,
        };
      });
      recordProgress('packs_transformed', {
        transformedCount: transformedPacks.length,
      });
      const { items: pagedPacks, pagination } = this.paginateItems(transformedPacks, input);
      recordProgress('pagination_applied', {
        pageIdx: pagination.pageIdx,
        pageSize: pagination.pageSize,
        totalItems: pagination.totalItems,
        pageCount: pagination.pageCount,
      });
      const aggregateConfidence = this.buildAggregateConfidence(pagedPacks);
      const { userDisclosures, epistemicsDebug } = sanitizeDisclosures(response.disclosures);
      const retrievalEntropy = response.retrievalEntropy
        ?? computeRetrievalEntropy(response.packs.map((pack) => ({ confidence: pack.confidence ?? 0 })));
      const retrievalStatus = response.retrievalStatus
        ?? categorizeRetrievalStatus({
          totalConfidence: response.totalConfidence,
          packCount: response.packs.length,
        });
      const retrievalInsufficient = response.retrievalInsufficient ?? retrievalStatus === 'insufficient';
      const explainMissesEnabled = Boolean(
        (input as { explainMisses?: boolean }).explainMisses
        ?? (input as { explain_misses?: boolean }).explain_misses
      );
      const pagedPackIds = new Set(pagedPacks.map((pack) => pack.packId));
      const nearMisses = explainMissesEnabled
        ? transformedPacks
          .filter((pack) => !pagedPackIds.has(pack.packId))
          .slice(0, 3)
          .map((pack) => ({
            packId: pack.packId,
            reason: `Excluded by pagination window (pageIdx=${pagination.pageIdx}, pageSize=${pagination.pageSize}) despite matching retrieval criteria.`,
          }))
        : undefined;

      const baseResult = {
        disclosures: userDisclosures,
        adequacy: response.adequacy,
        verificationPlan: response.verificationPlan,
        traceId: sanitizeTraceId(response.traceId) ?? 'replay_unavailable',
        constructionPlan: response.constructionPlan,
        totalConfidence: response.totalConfidence,
        retrievalStatus,
        retrievalEntropy,
        retrievalInsufficient,
        suggestedClarifyingQuestions: response.suggestedClarifyingQuestions,
        coverageGaps: response.coverageGaps ?? [],
        cacheHit: response.cacheHit,
        latencyMs: response.latencyMs,
        drillDownHints: response.drillDownHints,
        synthesis: response.synthesis,
        synthesisMode: response.synthesisMode,
        llmError: response.llmError ? parseEpistemicMessage(response.llmError).userMessage : response.llmError,
        intent: input.intent,
        pagination,
        sortOrder: 'retrieval_score_desc',
        aggregateConfidence,
        epistemicsDebug: epistemicsDebug.length ? epistemicsDebug : undefined,
        nearMisses,
        loopDetection: sessionState
          ? this.recordQueryAndBuildLoopDetection({
            sessionState,
            workspacePath: workspace.path,
            intent: input.intent,
            resultCount: transformedPacks.length,
          })
          : undefined,
      };
      const humanReviewRecommendation = this.buildHumanReviewRecommendation({
        workspace,
        queryInput: input,
        packs: transformedPacks,
        totalConfidence: response.totalConfidence,
        loopDetection: baseResult.loopDetection,
      });
      const stream = streamEnabled
        ? {
            enabled: true,
            chunkSize: streamChunkSize,
            totalChunks: 0,
            chunks: this.buildQueryStreamChunks(pagedPacks, streamChunkSize),
          }
        : undefined;
      if (stream) {
        stream.totalChunks = stream.chunks.length;
      }
      recordProgress('query_ready', {
        pagedPackCount: pagedPacks.length,
        streamChunks: stream?.totalChunks ?? 0,
      });
      const resultWithHumanReview = {
        ...baseResult,
        humanReviewRecommendation,
        timedOut: false,
        partial: false,
        timeoutMs: queryTimeoutMs,
        progress: {
          completed: true,
          events: progressEvents,
        },
        stream,
      };
      const baseWithAlias = {
        ...resultWithHumanReview,
        coverage_gaps: resultWithHumanReview.coverageGaps,
        aggregate_confidence: this.toAggregateConfidenceAlias(resultWithHumanReview.aggregateConfidence),
        near_misses: resultWithHumanReview.nearMisses,
        loop_detection: resultWithHumanReview.loopDetection,
        human_review_recommendation: resultWithHumanReview.humanReviewRecommendation,
        timed_out: resultWithHumanReview.timedOut,
        partial_result: resultWithHumanReview.partial,
        progress_view: resultWithHumanReview.progress,
        stream_view: resultWithHumanReview.stream,
      };

      if (input.outputFile) {
        const reference = await this.writeOutputReference(
          input.outputFile,
          {
            ...baseWithAlias,
            packs: pagedPacks,
          },
          pagination,
          workspace.path
        );
        return {
          ...baseWithAlias,
          ...reference,
        };
      }

      // Transform response for MCP
      return {
        ...baseWithAlias,
        packs: pagedPacks,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const parsedError = parseEpistemicMessage(message);
      const rawDisclosure = message.startsWith('unverified_by_trace')
        ? message
        : `unverified_by_trace(query_failed): ${message}`;
      const { userDisclosures, epistemicsDebug } = sanitizeDisclosures([rawDisclosure]);
      const aggregateConfidence = this.buildAggregateConfidence([]);
      return {
        aggregateConfidence,
        aggregate_confidence: this.toAggregateConfidenceAlias(aggregateConfidence),
        packs: [],
        totalConfidence: 0,
        retrievalStatus: 'insufficient',
        retrievalEntropy: 0,
        retrievalInsufficient: true,
        suggestedClarifyingQuestions: [],
        coverageGaps: [],
        coverage_gaps: [],
        nearMisses: [],
        near_misses: [],
        error: parsedError.userMessage || 'Query failed.',
        intent: input.intent,
        disclosures: userDisclosures,
        fix: buildQueryFixCommands(parsedError.code ?? 'query_failed', input.workspace),
        adequacy: undefined,
        verificationPlan: undefined,
        traceId: 'replay_unavailable',
        constructionPlan: undefined,
        epistemicsDebug,
      };
    }
  }

  private async executeSemanticSearch(
    input: SemanticSearchToolInput,
    context: ToolExecutionContext = {},
  ): Promise<unknown> {
    const base = await this.executeQuery(
      {
        intent: input.query,
        workspace: input.workspace,
        sessionId: input.sessionId,
        intentType: 'navigate',
        minConfidence: input.minConfidence,
        depth: input.depth,
        includeEngines: input.includeEngines,
        includeEvidence: input.includeEvidence,
        pageSize: input.limit,
        pageIdx: 0,
      },
      context,
    );

    if (!base || typeof base !== 'object') {
      return base;
    }

    const payload = base as Record<string, unknown>;
    const packs = Array.isArray(payload.packs) ? payload.packs : [];
    const relatedFiles = Array.from(
      new Set(
        packs
          .flatMap((pack) => {
            if (!pack || typeof pack !== 'object') {
              return [];
            }
            const files = (pack as { relatedFiles?: unknown }).relatedFiles;
            return Array.isArray(files)
              ? files.filter((file): file is string => typeof file === 'string')
              : [];
          }),
      ),
    );

    return {
      ...payload,
      tool: 'semantic_search',
      aliasOf: 'query',
      searchQuery: input.query,
      relatedFiles,
      recommendedNextTools: relatedFiles.length > 0
        ? ['find_symbol', 'trace_imports', 'get_change_impact']
        : ['query', 'get_session_briefing'],
    };
  }

  private async executeGetContextPack(
    input: GetContextPackToolInput,
    context: ToolExecutionContext = {},
  ): Promise<unknown> {
    const workspaceHint = typeof input.workspace === 'string' && input.workspace.trim().length > 0
      ? path.resolve(input.workspace)
      : (typeof input.workdir === 'string' && input.workdir.trim().length > 0
        ? path.resolve(input.workdir)
        : undefined);
    const workspacePath = workspaceHint
      ?? this.findReadyWorkspace()?.path
      ?? this.state.workspaces.keys().next().value;
    if (!workspacePath) {
      return {
        success: false,
        tool: 'get_context_pack',
        error: 'No workspace specified and no workspaces registered',
        functions: [],
        callGraphNeighbors: [],
        keyContracts: [],
        tokenCount: 0,
        evidenceIds: [],
        staleness: 'stale',
      };
    }

    const workspace = this.state.workspaces.get(workspacePath);
    const staleness: 'fresh' | 'indexing' | 'stale' = !workspace
      ? 'stale'
      : (workspace.indexState === 'ready'
        ? 'fresh'
        : (workspace.indexState === 'stale' ? 'stale' : 'indexing'));
    if (!workspace) {
      return {
        success: false,
        tool: 'get_context_pack',
        error: `Workspace not registered: ${workspacePath}`,
        functions: [],
        callGraphNeighbors: [],
        keyContracts: [],
        tokenCount: 0,
        evidenceIds: [],
        staleness,
      };
    }

    const tokenBudget = Math.max(100, Math.min(50000, Math.trunc(input.tokenBudget ?? 4000)));
    const base = await this.executeQuery(
      {
        intent: input.intent,
        workspace: workspacePath,
        affectedFiles: input.relevantFiles,
        intentType: 'navigate',
        depth: 'L2',
        pageSize: 50,
        pageIdx: 0,
      },
      context,
    );

    if (!base || typeof base !== 'object') {
      return base;
    }

    const payload = base as Record<string, unknown>;
    const packs = Array.isArray(payload.packs)
      ? payload.packs.filter((pack): pack is Record<string, unknown> => !!pack && typeof pack === 'object')
      : [];

    const selectedPacks: Array<{
      packId: string;
      packType: string;
      targetId?: string;
      summary: string;
      keyFacts: string[];
      relatedFiles: string[];
      confidence: number;
      mode: 'full' | 'summary';
      codeSnippets: string[];
      estimatedTokens: number;
    }> = [];
    let tokenCount = 0;

    for (const pack of packs) {
      const packId = typeof pack.packId === 'string' ? pack.packId : `pack_${this.generateId()}`;
      const packType = typeof pack.packType === 'string' ? pack.packType : 'unknown';
      const targetId = typeof pack.targetId === 'string' ? pack.targetId : undefined;
      const summary = typeof pack.summary === 'string' ? pack.summary : '';
      const keyFacts = Array.isArray(pack.keyFacts)
        ? pack.keyFacts.filter((fact): fact is string => typeof fact === 'string')
        : [];
      const relatedFiles = Array.isArray(pack.relatedFiles)
        ? pack.relatedFiles.filter((file): file is string => typeof file === 'string')
        : [];
      const confidence = typeof pack.confidence === 'number' && Number.isFinite(pack.confidence)
        ? pack.confidence
        : 0.5;
      const snippetTexts = Array.isArray(pack.codeSnippets)
        ? pack.codeSnippets
          .map((snippet) => {
            if (!snippet || typeof snippet !== 'object') return '';
            const code = (snippet as { code?: unknown }).code;
            return typeof code === 'string' ? code : '';
          })
          .filter((code) => code.length > 0)
        : [];

      const fullText = [summary, ...keyFacts, ...snippetTexts].join('\n');
      const fullTokens = estimateTokens(fullText);
      if (tokenCount + fullTokens <= tokenBudget) {
        selectedPacks.push({
          packId,
          packType,
          targetId,
          summary,
          keyFacts,
          relatedFiles,
          confidence,
          mode: 'full',
          codeSnippets: snippetTexts.slice(0, 2),
          estimatedTokens: fullTokens,
        });
        tokenCount += fullTokens;
        continue;
      }

      const summaryText = [summary, ...keyFacts.slice(0, 3)].join('\n');
      const summaryTokens = estimateTokens(summaryText);
      if (tokenCount + summaryTokens <= tokenBudget) {
        selectedPacks.push({
          packId,
          packType,
          targetId,
          summary,
          keyFacts: keyFacts.slice(0, 3),
          relatedFiles,
          confidence,
          mode: 'summary',
          codeSnippets: [],
          estimatedTokens: summaryTokens,
        });
        tokenCount += summaryTokens;
      }
    }

    const functions = selectedPacks.map((pack) => ({
      id: pack.targetId ?? pack.packId,
      packId: pack.packId,
      packType: pack.packType,
      summary: pack.summary,
      keyFacts: pack.keyFacts,
      relatedFiles: pack.relatedFiles,
      confidence: pack.confidence,
      mode: pack.mode,
    }));

    const callGraphNeighbors = selectedPacks.flatMap((pack) => {
      if (!pack.targetId) return [];
      return pack.keyFacts
        .filter((fact) => /calls?|called by|invokes?/i.test(fact))
        .map((fact) => ({
          functionId: pack.targetId,
          relation: /called by/i.test(fact) ? 'caller' : 'callee',
          detail: fact,
        }));
    });

    const keyContracts = selectedPacks.flatMap((pack) =>
      pack.keyFacts
        .filter((fact) => /must|required?|precondition|postcondition|reject|contract/i.test(fact))
        .map((fact) => ({
          statement: fact,
          sourcePackId: pack.packId,
        })));

    const architecturalContext = selectedPacks.find((pack) => pack.packType === 'module_context')?.summary
      ?? (typeof payload.answer === 'string' ? payload.answer : '');
    const evidenceIds = selectedPacks.map((pack) => pack.packId);

    return {
      success: true,
      tool: 'get_context_pack',
      workspace: workspacePath,
      intent: input.intent,
      tokenBudget,
      tokenCount,
      staleness,
      functions,
      callGraphNeighbors,
      keyContracts,
      architecturalContext,
      evidenceIds,
    };
  }

  private async executeEstimateBudget(input: EstimateBudgetToolInput): Promise<unknown> {
    const taskDescription = input.taskDescription?.trim() ?? '';
    if (taskDescription.length === 0) {
      return {
        success: false,
        tool: 'estimate_budget',
        error: 'taskDescription must be a non-empty string.',
      };
    }

    const availableTokens = Math.max(1, Math.trunc(input.availableTokens));
    const normalized = taskDescription.toLowerCase();
    const riskFactors: string[] = [];
    let complexityMultiplier = 1;

    if (/\b(across the codebase|entire codebase|all modules|all callers|system-wide|across)\b/.test(normalized)) {
      complexityMultiplier += 1.6;
      riskFactors.push('Broad cross-codebase scope increases call-graph fanout and exploration overhead.');
    }
    if (/\b(refactor|migrate|rewrite|re-architect)\b/.test(normalized)) {
      complexityMultiplier += 0.8;
      riskFactors.push('Refactor/migration tasks typically require additional verification and rollback-safe sequencing.');
    }
    if (/\b(auth|security|permissions|access control)\b/.test(normalized)) {
      complexityMultiplier += 0.45;
      riskFactors.push('Security-sensitive domains usually require extra validation passes and higher review overhead.');
    }
    if (taskDescription.split(/\s+/).filter(Boolean).length > 16) {
      complexityMultiplier += 0.35;
      riskFactors.push('Long task descriptions indicate multi-objective scope that tends to increase token burn.');
    }
    if (Array.isArray(input.pipeline) && input.pipeline.length > 0) {
      complexityMultiplier += Math.min(1.2, input.pipeline.length * 0.12);
      riskFactors.push(`Explicit pipeline includes ${input.pipeline.length} stages, increasing execution overhead.`);
    }

    const baseEstimate = Math.max(6000, estimateTokens(taskDescription) * 420);
    const estimated = {
      min: Math.max(1000, Math.round(baseEstimate * complexityMultiplier * 0.55)),
      expected: Math.max(1500, Math.round(baseEstimate * complexityMultiplier)),
      max: Math.max(2000, Math.round(baseEstimate * complexityMultiplier * 1.6)),
    };
    const feasible = estimated.max < availableTokens;

    if (availableTokens < estimated.expected) {
      riskFactors.push('Available token budget is below expected burn; compaction/retry risk is elevated.');
    }

    const cheaperAlternative = !feasible
      ? {
          description: 'Use get_context_pack first and narrow scope to one module before spawning broader edits.',
          estimatedTokens: {
            min: Math.max(600, Math.round(estimated.min * 0.3)),
            expected: Math.max(1000, Math.round(estimated.expected * 0.38)),
            max: Math.max(1500, Math.round(estimated.max * 0.45)),
          },
          construction: 'get_context_pack',
        }
      : undefined;

    const recommendation = feasible
      ? `Feasible under current budget. Estimated max ${estimated.max.toLocaleString()} tokens within available ${availableTokens.toLocaleString()}.`
      : `Not feasible within current budget. Scope to a single module or phase the task before execution.`;

    const workspacePath = typeof input.workspace === 'string' && input.workspace.trim().length > 0
      ? path.resolve(input.workspace)
      : (typeof input.workdir === 'string' && input.workdir.trim().length > 0 ? path.resolve(input.workdir) : undefined);
    const evidenceHash = createHash('sha256')
      .update(`${taskDescription}|${availableTokens}|${JSON.stringify(input.pipeline ?? [])}`)
      .digest('hex')
      .slice(0, 16);

    return {
      success: true,
      tool: 'estimate_budget',
      feasible,
      availableTokens,
      estimatedTokens: estimated,
      recommendation,
      cheaperAlternative,
      riskFactors,
      evidenceIds: [`budget_${evidenceHash}`],
      workspace: workspacePath,
    };
  }

  private async executeEstimateTaskComplexity(input: EstimateTaskComplexityToolInput): Promise<unknown> {
    const task = input.task?.trim() ?? '';
    if (task.length === 0) {
      return {
        success: false,
        tool: 'estimate_task_complexity',
        error: 'task must be a non-empty string.',
      };
    }

    const workspacePath = typeof input.workspace === 'string' && input.workspace.trim().length > 0
      ? path.resolve(input.workspace)
      : (typeof input.workdir === 'string' && input.workdir.trim().length > 0 ? path.resolve(input.workdir) : undefined);
    const defaultAvailableTokens = 24_000;

    const budgetEstimate = await this.executeEstimateBudget({
      taskDescription: task,
      availableTokens: defaultAvailableTokens,
      workdir: input.workdir,
      workspace: input.workspace,
      pipeline: ['semantic_search', 'get_context_pack', 'pre_commit_check'],
    }) as {
      success?: boolean;
      estimatedTokens?: { expected?: number; max?: number; min?: number };
      riskFactors?: string[];
    };

    const estimatedTokens = Number.isFinite(budgetEstimate?.estimatedTokens?.expected)
      ? Math.max(500, Math.trunc(budgetEstimate.estimatedTokens?.expected ?? 0))
      : Math.max(500, estimateTokens(task) * 120);
    const budgetRiskFactors = Array.isArray(budgetEstimate?.riskFactors)
      ? budgetEstimate.riskFactors
      : [];

    const contextPackResult = await this.executeGetContextPack({
      intent: task,
      workspace: workspacePath,
      workdir: input.workdir,
      tokenBudget: 1400,
      relevantFiles: input.recentFiles,
    }) as {
      success?: boolean;
      functions?: unknown[];
      tokenCount?: number;
    };
    const contextPackAvailable = contextPackResult?.success === true
      && Array.isArray(contextPackResult.functions)
      && contextPackResult.functions.length > 0;

    let blastRadius: number | undefined;
    const blastTarget = (typeof input.functionId === 'string' && input.functionId.trim().length > 0)
      ? input.functionId
      : (Array.isArray(input.recentFiles) && input.recentFiles.length > 0 ? input.recentFiles[0] : undefined);
    if (blastTarget) {
      const blast = await this.executeGetChangeImpact({
        target: blastTarget,
        workspace: workspacePath,
      }) as { success?: boolean; summary?: { riskScore?: number } };
      if (blast?.success === true && Number.isFinite(blast.summary?.riskScore)) {
        blastRadius = Math.max(0, Math.min(100, Math.round(blast.summary?.riskScore ?? 0)));
      }
    }

    let complexity: 'simple' | 'moderate' | 'complex' | 'expert' = 'simple';
    if (estimatedTokens > 10_000 || (typeof blastRadius === 'number' && blastRadius > 70)) {
      complexity = 'complex';
    }
    if (estimatedTokens > 20_000 || (typeof blastRadius === 'number' && blastRadius > 85)) {
      complexity = 'expert';
    }
    if (estimatedTokens >= 2_000 && estimatedTokens <= 10_000 && complexity === 'simple') {
      complexity = 'moderate';
    }

    const librainianCanAnswer = contextPackAvailable
      && estimatedTokens < 2_000
      && (typeof blastRadius !== 'number' || blastRadius < 30);
    const recommendedModel = librainianCanAnswer
      ? 'librainian-direct'
      : (complexity === 'simple'
        ? 'claude-haiku-3-5'
        : complexity === 'moderate'
          ? 'claude-sonnet-4'
          : complexity === 'complex'
            ? 'claude-sonnet-4'
            : 'claude-opus-4');

    const confidence = Math.max(
      0.4,
      Math.min(
        0.98,
        0.55
          + (budgetEstimate?.success ? 0.15 : 0)
          + (contextPackAvailable ? 0.2 : 0)
          + (typeof blastRadius === 'number' ? 0.1 : 0),
      ),
    );

    const reasoning = librainianCanAnswer
      ? 'High-confidence context pack coverage indicates librainian can answer directly without dispatching a frontier model.'
      : `Estimated ${estimatedTokens.toLocaleString()} tokens with complexity ${complexity}${typeof blastRadius === 'number' ? ` and blast radius ${blastRadius}` : ''}; route to ${recommendedModel}.`;

    return {
      success: true,
      tool: 'estimate_task_complexity',
      complexity,
      estimatedTokens,
      recommendedModel,
      confidence,
      reasoning,
      contextPackAvailable,
      blastRadius,
      librainianCanAnswer,
      libraininaCanAnswer: librainianCanAnswer,
      riskFactors: budgetRiskFactors,
      workspace: workspacePath,
    };
  }

  private async executeResetSessionState(
    input: ResetSessionStateToolInput,
    context: ToolExecutionContext = {}
  ): Promise<unknown> {
    const explicitSessionId = typeof input.sessionId === 'string' && input.sessionId.trim().length > 0
      ? input.sessionId.trim()
      : undefined;
    const authSessionId = typeof context.sessionId === 'string' && context.sessionId.trim().length > 0
      ? context.sessionId.trim()
      : undefined;
    const workspaceHint = typeof input.workspace === 'string' && input.workspace.trim().length > 0
      ? path.resolve(input.workspace)
      : undefined;
    const anonymousFallback = workspaceHint ? this.buildAnonymousSessionId(workspaceHint) : undefined;
    const sessionId = explicitSessionId ?? authSessionId ?? anonymousFallback;

    if (!sessionId) {
      return {
        success: false,
        sessionId: 'unknown',
        clearedQueries: 0,
        message: 'No sessionId provided and no auth session available for reset.',
      };
    }

    const state = this.state.sessions.get(sessionId);
    const clearedQueries = state?.queryHistory.length ?? 0;
    const clearedPlans = state?.planHistory.length ?? 0;
    if (state) {
      state.queryHistory = [];
      state.planHistory = [];
      state.lastActivity = new Date().toISOString();
      state.requestCount += 1;
    }
    const message = (clearedQueries > 0 || clearedPlans > 0)
      ? `Cleared ${clearedQueries} query history record(s) and ${clearedPlans} plan record(s) for session ${sessionId}.`
      : `No query history or plan records found for session ${sessionId}.`;

    return {
      success: true,
      sessionId,
      clearedQueries,
      clearedPlans,
      message,
    };
  }

  private buildSynthesizePlanText(task: string, contextPackIds: string[]): string {
    const uniqueContextIds = Array.from(new Set(contextPackIds));
    const contextSummary = uniqueContextIds.length > 0
      ? uniqueContextIds.join(', ')
      : 'none';
    return [
      `Task: ${task}`,
      '',
      'Plan:',
      `1. Review context packs (${contextSummary}) to confirm scope and constraints.`,
      '2. Identify the minimal safe change set and explicit rollback boundary.',
      '3. Execute changes incrementally with verification checkpoints after each step.',
      '4. Run targeted tests first, then broader regression checks before completion.',
    ].join('\n');
  }

  private async executeSynthesizePlan(
    input: SynthesizePlanToolInput,
    context: ToolExecutionContext = {}
  ): Promise<unknown> {
    const resolvedWorkspace = typeof input.workspace === 'string' && input.workspace.trim().length > 0
      ? path.resolve(input.workspace)
      : this.findReadyWorkspace()?.path
        ?? this.state.workspaces.keys().next().value;
    const explicitSessionId = typeof input.sessionId === 'string' && input.sessionId.trim().length > 0
      ? input.sessionId.trim()
      : undefined;
    const authSessionId = typeof context.sessionId === 'string' && context.sessionId.trim().length > 0
      ? context.sessionId.trim()
      : undefined;
    const sessionId = explicitSessionId
      ?? authSessionId
      ?? (resolvedWorkspace ? this.buildAnonymousSessionId(resolvedWorkspace) : 'anon:global');

    const sessionState = this.getOrCreateSessionState(sessionId);
    const planId = `plan_${this.generateId()}`;
    const createdAt = new Date().toISOString();
    const contextUsed = Array.from(new Set(input.context_pack_ids.map((id) => id.trim()).filter((id) => id.length > 0)));
    const planText = this.buildSynthesizePlanText(input.task.trim(), contextUsed);
    const planRecord: PlanRecord = {
      planId,
      task: input.task.trim(),
      plan: planText,
      contextUsed,
      workspace: resolvedWorkspace,
      createdAt,
    };
    sessionState.planHistory.push(planRecord);
    if (sessionState.planHistory.length > 25) {
      sessionState.planHistory.splice(0, sessionState.planHistory.length - 25);
    }

    await this.appendWorkspaceAuditLog(resolvedWorkspace ?? process.cwd(), {
      ts: createdAt,
      event: 'synthesize_plan',
      plan_id: planId,
      task: planRecord.task,
      plan: planRecord.plan,
      context_used: contextUsed,
      session_id: sessionId,
      workspace: resolvedWorkspace ?? process.cwd(),
    });

    return {
      ...this.toPlanView(planRecord),
      session_id: sessionId,
      sessionId,
    };
  }

  private async appendWorkspaceAuditLog(workspaceRoot: string, record: Record<string, unknown>): Promise<void> {
    const logPath = path.join(workspaceRoot, '.librainian', 'audit-log.jsonl');
    await fs.mkdir(path.dirname(logPath), { recursive: true });
    await fs.appendFile(logPath, `${JSON.stringify(record)}\n`, 'utf8');
  }

  private async executeListConstructions(input: ListConstructionsToolInput): Promise<unknown> {
    const manifests = listConstructions({
      tags: input.tags,
      capabilities: input.capabilities ?? input.requires,
      trustTier: input.trustTier,
      availableOnly: input.availableOnly,
    });
    const languageFilter = input.language?.trim().toLowerCase();
    const filtered = languageFilter
      ? manifests.filter((manifest) =>
        (manifest.languages ?? []).some((language) => String(language).toLowerCase() === languageFilter))
      : manifests;
    const constructions = filtered.map((manifest) => ({
      id: manifest.id,
      name: manifest.name,
      scope: manifest.scope,
      version: manifest.version,
      description: manifest.description,
      agentDescription: manifest.agentDescription,
      tags: manifest.tags,
      trustTier: manifest.trustTier,
      requiredCapabilities: manifest.requiredCapabilities,
      inputType: this.describeConstructionSchema(manifest.inputSchema),
      outputType: this.describeConstructionSchema(manifest.outputSchema),
      inputSchema: manifest.inputSchema,
      outputSchema: manifest.outputSchema,
      languages: manifest.languages,
      frameworks: manifest.frameworks,
      examples: manifest.examples,
      availableInCurrentSession: manifest.available !== false,
      legacyIds: manifest.legacyIds,
    }));

    return {
      count: constructions.length,
      constructions,
      hint: constructions.length > 0
        ? `Call describe_construction with id='${constructions[0].id}' for full details and example code.`
        : 'No constructions matched current filters. Remove language/requires filters or availableOnly to broaden results.',
    };
  }

  private async executeInvokeConstruction(input: InvokeConstructionToolInput): Promise<unknown> {
    const manifest = getConstructionManifest(input.constructionId);
    if (!manifest) {
      throw new Error(
        `Unknown Construction ID: ${input.constructionId}. Use list_constructions to discover IDs.`,
      );
    }
    const requiresLibrarian = manifest.requiredCapabilities.includes('librarian');
    let resolvedWorkspace: string | undefined;
    let deps: Record<string, unknown> = {};

    if (requiresLibrarian) {
      const workspaceRoot = input.workspace
        ? path.resolve(input.workspace)
        : this.findReadyWorkspace()?.path
          ?? this.state.workspaces.keys().next().value
          ?? this.config.workspaces[0];

      if (!workspaceRoot) {
        throw new Error(
          `No workspace available for invoke_construction(${manifest.id}). Provide workspace or run bootstrap first.`,
        );
      }

      resolvedWorkspace = path.resolve(workspaceRoot);
      if (!this.state.workspaces.has(resolvedWorkspace)) {
        this.registerWorkspace(resolvedWorkspace);
      }

      let workspaceState = this.state.workspaces.get(resolvedWorkspace)!;

      if (!workspaceState.librarian) {
        const librarian = await createLibrarian({
          workspace: resolvedWorkspace,
          autoBootstrap: true,
          autoWatch: false,
        });
        const status = await librarian.getStatus().catch(() => null);
        this.updateWorkspaceState(resolvedWorkspace, {
          librarian,
          indexState: status?.bootstrapped ? 'ready' : 'stale',
          indexedAt: status?.lastBootstrap ? status.lastBootstrap.toISOString() : undefined,
          watching: false,
        });
        workspaceState = this.state.workspaces.get(resolvedWorkspace)!;
      }

      const librarian = workspaceState.librarian;
      if (!librarian) {
        throw new Error(`Failed to initialize Librarian runtime for workspace: ${resolvedWorkspace}`);
      }
      deps = { librarian };
    }

    const controller = new AbortController();
    const result = await invokeConstruction(
      manifest.id,
      input.input,
      {
        deps,
        signal: controller.signal,
        sessionId: `invoke_${this.generateId()}`,
        metadata: {
          tool: 'invoke_construction',
          workspace: resolvedWorkspace,
        },
      },
    );

    return {
      constructionId: manifest.id,
      name: manifest.name,
      success: true,
      available: manifest.available !== false,
      workspace: resolvedWorkspace,
      result,
    };
  }

  private async executeDescribeConstruction(input: DescribeConstructionToolInput): Promise<unknown> {
    const manifest = getConstructionManifest(input.id);
    if (!manifest) {
      throw new Error(
        `Unknown Construction ID: ${input.id}. Use list_constructions to discover IDs.`,
      );
    }

    const includeExample = input.includeExample ?? true;
    const includeCompositionHints = input.includeCompositionHints ?? true;
    const compositionHints = includeCompositionHints
      ? this.buildCompositionHints(manifest.id)
      : undefined;

    return {
      id: manifest.id,
      name: manifest.name,
      scope: manifest.scope,
      version: manifest.version,
      description: manifest.description,
      agentDescription: manifest.agentDescription,
      inputType: this.describeConstructionSchema(manifest.inputSchema),
      outputType: this.describeConstructionSchema(manifest.outputSchema),
      requiredCapabilities: manifest.requiredCapabilities,
      tags: manifest.tags,
      trustTier: manifest.trustTier,
      availableInCurrentSession: manifest.available !== false,
      inputSchema: manifest.inputSchema,
      outputSchema: manifest.outputSchema,
      example: includeExample ? this.renderConstructionExample(manifest.id, manifest.examples[0]?.input) : undefined,
      compositionHints,
      examples: manifest.examples,
    };
  }

  private async executeExplainOperator(input: ExplainOperatorToolInput): Promise<unknown> {
    const situation = input.situation?.trim();
    const operator = input.operator;

    if (!operator && situation) {
      const recommendation = this.recommendOperatorForSituation(situation);
      const guide = OPERATOR_GUIDE[recommendation];
      return {
        situation,
        recommendation,
        reason: `${guide.summary} ${guide.decisionGuide}`,
        example: guide.example,
      };
    }

    if (!operator) {
      throw new Error('Either operator or situation is required for explain_operator.');
    }

    const guide = OPERATOR_GUIDE[operator];
    return {
      operator,
      summary: guide.summary,
      decisionGuide: guide.decisionGuide,
      example: guide.example,
    };
  }

  private async executeCheckConstructionTypes(input: CheckConstructionTypesToolInput): Promise<unknown> {
    const first = getConstructionManifest(input.first);
    const second = getConstructionManifest(input.second);
    if (!first) {
      throw new Error(`Unknown Construction ID: ${input.first}. Use list_constructions to discover IDs.`);
    }
    if (!second) {
      throw new Error(`Unknown Construction ID: ${input.second}. Use list_constructions to discover IDs.`);
    }

    if (input.operator === 'seq') {
      const score = CONSTRUCTION_REGISTRY.compatibilityScore(first.id, second.id);
      const compatible = score >= 0.5;
      if (compatible) {
        return {
          compatible: true,
          operator: input.operator,
          seam: `${first.id}.output -> ${second.id}.input`,
          note: `Compatibility score ${score.toFixed(2)} indicates the output shape is assignable to the downstream input.`,
        };
      }
      return {
        compatible: false,
        operator: input.operator,
        problem: `${first.id} outputs ${this.describeConstructionSchema(first.outputSchema)} but ${second.id} expects ${this.describeConstructionSchema(second.inputSchema)}.`,
        suggestions: [
          `Add a dimap adapter: seq(${first.id}, ${second.id}.contramap((value) => ({ ...value })))`,
          `Insert an adapter construction: seq(${first.id}, seq(transform_output_for_${second.id.replace(/[^a-z0-9]+/gi, '_')}, ${second.id}))`,
        ],
      };
    }

    if (input.operator === 'fanout') {
      const score = this.computeSchemaCompatibilityScore(first.inputSchema, second.inputSchema);
      const compatible = score >= 0.5;
      if (compatible) {
        return {
          compatible: true,
          operator: input.operator,
          seam: `${first.id}.input <-> ${second.id}.input`,
          note: `Input compatibility score ${score.toFixed(2)} indicates both constructions can share the same upstream input.`,
        };
      }
      return {
        compatible: false,
        operator: input.operator,
        problem: `${first.id} expects ${this.describeConstructionSchema(first.inputSchema)} while ${second.id} expects ${this.describeConstructionSchema(second.inputSchema)}.`,
        suggestions: [
          `Normalize input before fanout via dimap/contramap adapters on one branch.`,
          `Use seq with an explicit transform step, then fanout on the normalized payload.`,
        ],
      };
    }

    const inputScore = this.computeSchemaCompatibilityScore(first.inputSchema, second.inputSchema);
    const outputScore = this.computeSchemaCompatibilityScore(first.outputSchema, second.outputSchema);
    const compatible = inputScore >= 0.5 && outputScore >= 0.5;
    if (compatible) {
      return {
        compatible: true,
        operator: input.operator,
        seam: `${first.id} ||| ${second.id}`,
        note: `Fallback compatibility confirmed (input ${inputScore.toFixed(2)}, output ${outputScore.toFixed(2)}).`,
      };
    }
    return {
      compatible: false,
      operator: input.operator,
      problem: `Fallback requires compatible input/output contracts, but scores were input=${inputScore.toFixed(2)} and output=${outputScore.toFixed(2)}.`,
      suggestions: [
        `Adapt both branches to a shared contract using dimap before fallback.`,
        `Wrap one branch in map/contramap transforms so both branches return the same output shape.`,
      ],
    };
  }

  private renderConstructionExample(constructionId: string, input: unknown): string {
    const exampleInput = input === undefined ? '{}' : JSON.stringify(input, null, 2);
    return [
      "import { getConstructionManifest } from 'librainian/constructions/registry';",
      '',
      `const manifest = getConstructionManifest('${constructionId}');`,
      "if (!manifest) throw new Error('Construction not found');",
      '',
      'const result = await manifest.construction.execute(',
      `  ${exampleInput},`,
      '  {',
      '    deps: { librarian },',
      '    signal: AbortSignal.timeout(30_000),',
      "    sessionId: 'session-id',",
      '  }',
      ');',
    ].join('\n');
  }

  private buildCompositionHints(constructionId: string): { goodWith: string[]; operator: string } {
    const related = listConstructions({ availableOnly: true })
      .filter((manifest) => manifest.id !== constructionId)
      .map((manifest) => ({
        id: manifest.id,
        score: CONSTRUCTION_REGISTRY.compatibilityScore(constructionId, manifest.id),
      }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    const goodWith = related.map((entry) =>
      `${entry.id} (${entry.score >= 0.6 ? 'seq' : 'fanout'} for ${
        entry.score >= 0.6 ? 'output-to-input chaining' : 'parallel analysis on shared input'
      })`);

    const operator = related.some((entry) => entry.score >= 0.6)
      ? 'Use seq() when you want downstream constructions to consume this output.'
      : 'Use fanout() when you want this construction to run in parallel with another analysis over the same input.';

    return { goodWith, operator };
  }

  private recommendOperatorForSituation(situation: string): ConstructionOperator {
    const normalized = situation.toLowerCase();
    if (/(parallel|concurrent|at the same time|both)/.test(normalized)) return 'fanout';
    if (/(fallback|backup|if fails|on failure|retry with)/.test(normalized)) return 'fallback';
    if (/(recursive|iterate|until stable|fixpoint|converge)/.test(normalized)) return 'fix';
    if (/(branch|route|choose|select|either)/.test(normalized)) return 'select';
    if (/(input transform|normalize input|preprocess input|before running)/.test(normalized)) return 'contramap';
    if (/(output transform|post-process|format output|after running)/.test(normalized)) return 'map';
    if (/(adapt input and output|both input and output)/.test(normalized)) return 'dimap';
    if (/(single step|atomic|primitive|small transform)/.test(normalized)) return 'atom';
    return 'seq';
  }

  private describeConstructionSchema(schema: {
    type?: string;
    properties?: Record<string, { type?: string }>;
    required?: string[];
    items?: { type?: string } | Array<{ type?: string }>;
    oneOf?: Array<{ type?: string }>;
    anyOf?: Array<{ type?: string }>;
    allOf?: Array<{ type?: string }>;
    enum?: Array<string | number | boolean>;
  }): string {
    if (Array.isArray(schema.enum) && schema.enum.length > 0) {
      return schema.enum.slice(0, 4).map((value) => JSON.stringify(value)).join(' | ');
    }
    if (schema.type === 'array') {
      if (Array.isArray(schema.items)) {
        return `Array<${schema.items.map((item) => item?.type ?? 'unknown').join(' | ')}>`;
      }
      return `Array<${schema.items?.type ?? 'unknown'}>`;
    }
    if (schema.type === 'object') {
      const required = new Set(schema.required ?? []);
      const props = Object.entries(schema.properties ?? {});
      if (props.length === 0) {
        return 'Record<string, unknown>';
      }
      const preview = props.slice(0, 4)
        .map(([name, value]) => `${name}${required.has(name) ? '' : '?'}: ${value?.type ?? 'unknown'}`);
      return `{ ${preview.join(', ')}${props.length > 4 ? ', ...' : ''} }`;
    }
    const unionTypes = [
      ...(schema.oneOf ?? []).map((entry) => entry.type).filter((value): value is string => typeof value === 'string'),
      ...(schema.anyOf ?? []).map((entry) => entry.type).filter((value): value is string => typeof value === 'string'),
      ...(schema.allOf ?? []).map((entry) => entry.type).filter((value): value is string => typeof value === 'string'),
    ];
    if (unionTypes.length > 0) {
      return Array.from(new Set(unionTypes)).join(' | ');
    }
    return schema.type ?? 'unknown';
  }

  private computeSchemaCompatibilityScore(
    left: {
      type?: string;
      properties?: Record<string, unknown>;
      required?: string[];
      oneOf?: Array<{ type?: string }>;
      anyOf?: Array<{ type?: string }>;
      allOf?: Array<{ type?: string }>;
      items?: { type?: string } | Array<{ type?: string }>;
    },
    right: {
      type?: string;
      properties?: Record<string, unknown>;
      required?: string[];
      oneOf?: Array<{ type?: string }>;
      anyOf?: Array<{ type?: string }>;
      allOf?: Array<{ type?: string }>;
      items?: { type?: string } | Array<{ type?: string }>;
    },
  ): number {
    const leftTypes = this.collectSchemaTypes(left);
    const rightTypes = this.collectSchemaTypes(right);
    if (leftTypes.size > 0 && rightTypes.size > 0) {
      const overlap = Array.from(leftTypes).filter((type) => rightTypes.has(type));
      if (overlap.length > 0) {
        return overlap.length / Math.max(leftTypes.size, rightTypes.size);
      }
    }

    if (left.type === 'object' && right.type === 'object') {
      const leftProps = new Set(Object.keys(left.properties ?? {}));
      const rightProps = new Set(Object.keys(right.properties ?? {}));
      const leftRequired = left.required ?? [];
      const rightRequired = right.required ?? [];
      const leftMatches = leftRequired.filter((name) => rightProps.has(name)).length;
      const rightMatches = rightRequired.filter((name) => leftProps.has(name)).length;
      const requiredCount = leftRequired.length + rightRequired.length;
      if (requiredCount === 0) {
        return 0.75;
      }
      return (leftMatches + rightMatches) / requiredCount;
    }

    return 0;
  }

  private collectSchemaTypes(schema: {
    type?: string;
    oneOf?: Array<{ type?: string }>;
    anyOf?: Array<{ type?: string }>;
    allOf?: Array<{ type?: string }>;
    items?: { type?: string } | Array<{ type?: string }>;
  }): Set<string> {
    const types = new Set<string>();
    if (typeof schema.type === 'string' && schema.type.length > 0) {
      types.add(schema.type);
    }
    for (const entry of schema.oneOf ?? []) {
      if (typeof entry.type === 'string') {
        types.add(entry.type);
      }
    }
    for (const entry of schema.anyOf ?? []) {
      if (typeof entry.type === 'string') {
        types.add(entry.type);
      }
    }
    for (const entry of schema.allOf ?? []) {
      if (typeof entry.type === 'string') {
        types.add(entry.type);
      }
    }
    if (!Array.isArray(schema.items) && typeof schema.items?.type === 'string') {
      types.add(schema.items.type);
    }
    if (Array.isArray(schema.items)) {
      for (const entry of schema.items) {
        if (typeof entry?.type === 'string') {
          types.add(entry.type);
        }
      }
    }
    return types;
  }

  private async executeRequestHumanReview(input: RequestHumanReviewToolInput): Promise<unknown> {
    const reviewRequestId = `rev_${this.generateId()}`;
    const workspaceRoot = this.findReadyWorkspace()?.path
      ?? this.state.workspaces.keys().next().value
      ?? process.cwd();
    const timeoutSeconds = Math.max(
      30,
      this.config.humanReview?.defaultReviewTimeoutSeconds
        ?? DEFAULT_MCP_SERVER_CONFIG.humanReview.defaultReviewTimeoutSeconds
    );
    const status = input.blocking ? 'pending' : 'advisory';
    const heading = input.blocking ? 'Agent paused for review' : 'Advisory human review requested';
    const humanReadableSummary = [
      `WARNING: ${heading}`,
      '',
      `Reason: ${input.reason}`,
      `Risk: ${input.risk_level}`,
      `Confidence tier: ${input.confidence_tier}`,
      '',
      'Context summary:',
      input.context_summary,
      '',
      `Proposed action: ${input.proposed_action}`,
      '',
      'To proceed: reply "proceed". To abort: reply "abort". To rephrase: provide an alternative query.',
    ].join('\n');

    await this.appendWorkspaceAuditLog(workspaceRoot, {
      ts: new Date().toISOString(),
      review_id: reviewRequestId,
      reason: input.reason,
      outcome: 'pending',
      blocking: input.blocking,
      confidence_tier: input.confidence_tier,
      risk_level: input.risk_level,
      proposed_action: input.proposed_action,
      workspace: workspaceRoot,
    });

    return {
      review_request_id: reviewRequestId,
      status,
      human_readable_summary: humanReadableSummary,
      blocking: input.blocking,
      expires_in_seconds: timeoutSeconds,
    };
  }

  private async executeSubmitFeedback(input: SubmitFeedbackToolInput): Promise<unknown> {
    try {
      let workspacePath: string | undefined;
      if (input.workspace) {
        workspacePath = path.resolve(input.workspace);
      } else {
        workspacePath = this.findReadyWorkspace()?.path
          ?? this.state.workspaces.keys().next().value
          ?? this.config.workspaces[0];
      }

      if (!workspacePath) {
        return {
          feedbackToken: input.feedbackToken,
          outcome: input.outcome,
          success: false,
          adjustmentsApplied: 0,
          error: 'No workspace available. Provide workspace or run bootstrap first.',
        };
      }

      const resolvedWorkspace = path.resolve(workspacePath);
      if (!this.state.workspaces.has(resolvedWorkspace)) {
        this.registerWorkspace(resolvedWorkspace);
      }

      const storage = await this.getOrCreateStorage(resolvedWorkspace);
      const result = await submitQueryFeedback(
        input.feedbackToken,
        input.outcome,
        storage,
        {
          agentId: input.agentId,
          missingContext: input.missingContext,
          customRatings: input.customRatings,
        }
      );

      return {
        feedbackToken: input.feedbackToken,
        outcome: input.outcome,
        success: result.success,
        adjustmentsApplied: result.adjustmentsApplied,
        error: result.error,
        workspace: resolvedWorkspace,
      };
    } catch (error) {
      return {
        feedbackToken: input.feedbackToken,
        outcome: input.outcome,
        success: false,
        adjustmentsApplied: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async executeExplainFunction(input: ExplainFunctionToolInput): Promise<unknown> {
    try {
      const workspacePath = input.workspace
        ? path.resolve(input.workspace)
        : this.findReadyWorkspace()?.path ?? this.state.workspaces.keys().next().value;
      if (!workspacePath) {
        return {
          found: false,
          workspace: undefined,
          error: 'No workspace specified and no workspaces registered',
        };
      }

      const workspace = this.state.workspaces.get(workspacePath);
      if (!workspace) {
        return {
          found: false,
          workspace: workspacePath,
          error: `Workspace not registered: ${workspacePath}`,
        };
      }
      if (workspace.indexState !== 'ready') {
        return {
          found: false,
          workspace: workspacePath,
          error: `Workspace not ready (state: ${workspace.indexState}). Run bootstrap first.`,
        };
      }

      const storage = await this.getOrCreateStorage(workspacePath);
      const exact = await storage.getFunctionsByName(input.name).catch(() => []);
      const fallbackPool = exact.length === 0
        ? await storage.getFunctions({ limit: 1500, orderBy: 'name', orderDirection: 'asc' }).catch(() => [])
        : [];

      let candidates = exact.length > 0
        ? exact
        : fallbackPool.filter((fn) =>
          this.scoreFindSymbolCandidate(
            input.name,
            `${fn.id} ${fn.name} ${fn.signature} ${fn.filePath}`
          ) >= 0.45
        );

      if (input.filePath) {
        const normalizedInputPath = this.normalizeFindSymbolText(input.filePath);
        const filtered = candidates.filter((fn) =>
          this.normalizeFindSymbolText(fn.filePath).includes(normalizedInputPath)
        );
        if (filtered.length > 0) candidates = filtered;
      }

      if (candidates.length === 0) {
        return {
          found: false,
          workspace: workspacePath,
          error: `Function not found: ${input.name}`,
        };
      }

      const ranked = [...candidates].sort((a, b) => {
        const scoreA = this.scoreFindSymbolCandidate(input.name, `${a.id} ${a.name} ${a.signature} ${a.filePath}`);
        const scoreB = this.scoreFindSymbolCandidate(input.name, `${b.id} ${b.name} ${b.signature} ${b.filePath}`);
        return scoreB - scoreA;
      });
      const selected = ranked[0]!;

      const [callerEdges, calleeEdges] = await Promise.all([
        storage.getGraphEdges({ toIds: [selected.id], edgeTypes: ['calls'], limit: 500 }).catch(() => []),
        storage.getGraphEdges({ fromIds: [selected.id], edgeTypes: ['calls'], limit: 500 }).catch(() => []),
      ]);

      const uniqueCallers = Array.from(new Set(callerEdges.map((edge) => edge.fromId))).filter((id) => typeof id === 'string' && id.length > 0);
      const uniqueCallees = Array.from(new Set(calleeEdges.map((edge) => edge.toId))).filter((id) => typeof id === 'string' && id.length > 0);

      const [callers, callees] = await Promise.all([
        Promise.all(uniqueCallers.map(async (id) => {
          const fn = await storage.getFunction(id).catch(() => null);
          return {
            id,
            name: fn?.name ?? id,
            filePath: fn?.filePath ?? callerEdges.find((edge) => edge.fromId === id)?.sourceFile,
          };
        })),
        Promise.all(uniqueCallees.map(async (id) => {
          const fn = await storage.getFunction(id).catch(() => null);
          return {
            id,
            name: fn?.name ?? id,
            filePath: fn?.filePath ?? calleeEdges.find((edge) => edge.toId === id)?.sourceFile,
          };
        })),
      ]);

      const contextPack = await storage.getContextPackForTarget(selected.id, 'function_context').catch(() => null);

      return {
        found: true,
        workspace: workspacePath,
        function: {
          id: selected.id,
          name: selected.name,
          signature: selected.signature,
          filePath: selected.filePath,
          summary: contextPack?.summary ?? selected.purpose,
          purpose: selected.purpose,
          callers,
          callees,
          confidence: Number.isFinite(selected.confidence) ? selected.confidence : (contextPack?.confidence ?? 0.5),
        },
      };
    } catch (error) {
      return {
        found: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async resolveFunctionTargetsForLookup(
    storage: LibrarianStorage,
    query: string,
  ): Promise<Array<{
    id: string;
    name: string;
    signature: string;
    filePath: string;
    purpose?: string;
    confidence?: number;
  }>> {
    const trimmed = query.trim();
    if (trimmed.length === 0) return [];

    const byId = await storage.getFunction(trimmed).catch(() => null);
    const byName = await storage.getFunctionsByName(trimmed).catch(() => []);
    const fallbackPool = byId || byName.length > 0
      ? []
      : await storage.getFunctions({ limit: 1500, orderBy: 'name', orderDirection: 'asc' }).catch(() => []);
    const fallback = fallbackPool.filter((fn) =>
      this.scoreFindSymbolCandidate(
        trimmed,
        `${fn.id} ${fn.name} ${fn.signature} ${fn.filePath}`
      ) >= 0.45
    );

    const merged = [
      ...(byId ? [byId] : []),
      ...byName,
      ...fallback,
    ];
    const deduped = new Map<string, {
      id: string;
      name: string;
      signature: string;
      filePath: string;
      purpose?: string;
      confidence?: number;
    }>();
    for (const fn of merged) {
      if (!fn || typeof fn.id !== 'string' || fn.id.length === 0) continue;
      if (!deduped.has(fn.id)) {
        deduped.set(fn.id, {
          id: fn.id,
          name: fn.name,
          signature: fn.signature,
          filePath: fn.filePath,
          purpose: fn.purpose,
          confidence: fn.confidence,
        });
      }
    }

    return Array.from(deduped.values());
  }

  private async executeFindCallers(input: FindCallersToolInput): Promise<unknown> {
    try {
      const workspacePath = input.workspace
        ? path.resolve(input.workspace)
        : this.findReadyWorkspace()?.path ?? this.state.workspaces.keys().next().value;
      if (!workspacePath) {
        return {
          success: false,
          functionId: input.functionId,
          callSites: [],
          totalCallSites: 0,
          error: 'No workspace specified and no workspaces registered',
        };
      }

      const workspace = this.state.workspaces.get(workspacePath);
      if (!workspace) {
        return {
          success: false,
          functionId: input.functionId,
          callSites: [],
          totalCallSites: 0,
          workspace: workspacePath,
          error: `Workspace not registered: ${workspacePath}`,
        };
      }
      if (workspace.indexState !== 'ready') {
        return {
          success: false,
          functionId: input.functionId,
          callSites: [],
          totalCallSites: 0,
          workspace: workspacePath,
          error: `Workspace not ready (state: ${workspace.indexState}). Run bootstrap first.`,
        };
      }

      const storage = await this.getOrCreateStorage(workspacePath);
      const targets = await this.resolveFunctionTargetsForLookup(storage, input.functionId);
      if (targets.length === 0) {
        return {
          success: true,
          functionId: input.functionId,
          callSites: [],
          totalCallSites: 0,
          workspace: workspacePath,
          transitive: input.transitive ?? false,
          maxDepth: input.maxDepth ?? 3,
        };
      }

      const transitive = input.transitive ?? false;
      const maxDepth = Math.max(1, Math.min(8, Math.trunc(input.maxDepth ?? 3)));
      const depthLimit = transitive ? maxDepth : 1;
      const limit = Math.max(1, Math.min(500, Math.trunc(input.limit ?? 100)));
      const queue: Array<{ targetId: string; depth: number }> = targets.map((target) => ({ targetId: target.id, depth: 1 }));
      const visitedTargets = new Set<string>(targets.map((target) => target.id));
      const seenEdges = new Set<string>();
      const callSites: Array<{
        file: string;
        line: number | null;
        column: number;
        callerFunctionId: string;
        callerName: string;
        calleeFunctionId: string;
        depth: number;
        semanticContext: string;
        confidence: number;
      }> = [];

      while (queue.length > 0 && callSites.length < limit) {
        const current = queue.shift()!;
        if (current.depth > depthLimit) {
          continue;
        }

        const edges = await storage.getGraphEdges({
          toIds: [current.targetId],
          edgeTypes: ['calls'],
          limit,
        }).catch(() => []);

        for (const edge of edges) {
          if (typeof edge.fromId !== 'string' || edge.fromId.length === 0) continue;
          const edgeKey = `${edge.fromId}->${current.targetId}@${current.depth}`;
          if (seenEdges.has(edgeKey)) continue;
          seenEdges.add(edgeKey);

          const caller = await storage.getFunction(edge.fromId).catch(() => null);
          callSites.push({
            file: caller?.filePath ?? edge.sourceFile,
            line: typeof edge.sourceLine === 'number' ? edge.sourceLine : null,
            column: 1,
            callerFunctionId: edge.fromId,
            callerName: caller?.name ?? edge.fromId,
            calleeFunctionId: current.targetId,
            depth: current.depth,
            semanticContext: current.depth > 1
              ? `Transitive caller at depth ${current.depth} in the upstream call chain.`
              : 'Direct caller of the requested function.',
            confidence: Number.isFinite(edge.confidence) ? edge.confidence : 0.5,
          });

          if (callSites.length >= limit) break;
          if (current.depth < depthLimit && !visitedTargets.has(edge.fromId)) {
            visitedTargets.add(edge.fromId);
            queue.push({ targetId: edge.fromId, depth: current.depth + 1 });
          }
        }
      }

      return {
        success: true,
        functionId: input.functionId,
        resolvedFunctionIds: targets.map((target) => target.id),
        workspace: workspacePath,
        transitive,
        maxDepth: depthLimit,
        callSites,
        totalCallSites: callSites.length,
      };
    } catch (error) {
      return {
        success: false,
        functionId: input.functionId,
        callSites: [],
        totalCallSites: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async executeFindCallees(input: FindCalleesToolInput): Promise<unknown> {
    try {
      const workspacePath = input.workspace
        ? path.resolve(input.workspace)
        : this.findReadyWorkspace()?.path ?? this.state.workspaces.keys().next().value;
      if (!workspacePath) {
        return {
          success: false,
          functionId: input.functionId,
          callees: [],
          totalCallees: 0,
          error: 'No workspace specified and no workspaces registered',
        };
      }

      const workspace = this.state.workspaces.get(workspacePath);
      if (!workspace) {
        return {
          success: false,
          functionId: input.functionId,
          callees: [],
          totalCallees: 0,
          workspace: workspacePath,
          error: `Workspace not registered: ${workspacePath}`,
        };
      }
      if (workspace.indexState !== 'ready') {
        return {
          success: false,
          functionId: input.functionId,
          callees: [],
          totalCallees: 0,
          workspace: workspacePath,
          error: `Workspace not ready (state: ${workspace.indexState}). Run bootstrap first.`,
        };
      }

      const storage = await this.getOrCreateStorage(workspacePath);
      const targets = await this.resolveFunctionTargetsForLookup(storage, input.functionId);
      if (targets.length === 0) {
        return {
          success: true,
          functionId: input.functionId,
          callees: [],
          totalCallees: 0,
          workspace: workspacePath,
        };
      }

      const limit = Math.max(1, Math.min(500, Math.trunc(input.limit ?? 100)));
      const seen = new Set<string>();
      const callees: Array<{
        functionId: string;
        name: string;
        file: string;
        line: number | null;
        description: string;
        confidence: number;
        calledFrom: string;
      }> = [];

      for (const target of targets) {
        const edges = await storage.getGraphEdges({
          fromIds: [target.id],
          edgeTypes: ['calls'],
          limit,
        }).catch(() => []);
        for (const edge of edges) {
          if (typeof edge.toId !== 'string' || edge.toId.length === 0) continue;
          const key = `${target.id}->${edge.toId}`;
          if (seen.has(key)) continue;
          seen.add(key);

          const callee = await storage.getFunction(edge.toId).catch(() => null);
          callees.push({
            functionId: edge.toId,
            name: callee?.name ?? edge.toId,
            file: callee?.filePath ?? edge.sourceFile,
            line: typeof edge.sourceLine === 'number' ? edge.sourceLine : null,
            description: callee?.purpose ?? `Function called by ${target.name}.`,
            confidence: Number.isFinite(edge.confidence) ? edge.confidence : (callee?.confidence ?? 0.5),
            calledFrom: target.id,
          });
          if (callees.length >= limit) break;
        }
        if (callees.length >= limit) break;
      }

      return {
        success: true,
        functionId: input.functionId,
        resolvedFunctionIds: targets.map((target) => target.id),
        workspace: workspacePath,
        callees,
        totalCallees: callees.length,
      };
    } catch (error) {
      return {
        success: false,
        functionId: input.functionId,
        callees: [],
        totalCallees: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async executeFindUsages(input: FindUsagesToolInput): Promise<unknown> {
    try {
      const workspacePath = input.workspace
        ? path.resolve(input.workspace)
        : this.findReadyWorkspace()?.path ?? this.state.workspaces.keys().next().value;
      if (!workspacePath) {
        return {
          success: false,
          symbol: input.symbol,
          matches: [],
          totalMatches: 0,
          error: 'No workspace specified and no workspaces registered',
        };
      }

      const workspace = this.state.workspaces.get(workspacePath);
      if (!workspace) {
        return {
          success: false,
          symbol: input.symbol,
          matches: [],
          totalMatches: 0,
          workspace: workspacePath,
          error: `Workspace not registered: ${workspacePath}`,
        };
      }
      if (workspace.indexState !== 'ready') {
        return {
          success: false,
          symbol: input.symbol,
          matches: [],
          totalMatches: 0,
          workspace: workspacePath,
          error: `Workspace not ready (state: ${workspace.indexState}). Run bootstrap first.`,
        };
      }

      const storage = await this.getOrCreateStorage(workspacePath);
      const exact = await storage.getFunctionsByName(input.symbol).catch(() => []);
      const fallbackPool = exact.length === 0
        ? await storage.getFunctions({ limit: 1500, orderBy: 'name', orderDirection: 'asc' }).catch(() => [])
        : [];
      const targets = exact.length > 0
        ? exact
        : fallbackPool.filter((fn) =>
          this.scoreFindSymbolCandidate(
            input.symbol,
            `${fn.id} ${fn.name} ${fn.signature} ${fn.filePath}`
          ) >= 0.45
        );

      const limit = Math.max(1, Math.min(500, Math.trunc(input.limit ?? 100)));
      const matches: Array<{
        id: string;
        name: string;
        filePath: string;
        usageCount: number;
        files: string[];
        callers: Array<{ id: string; name: string; filePath?: string }>;
      }> = [];

      for (const target of targets) {
        const edges = await storage.getGraphEdges({ toIds: [target.id], edgeTypes: ['calls'], limit }).catch(() => []);
        const callerIds = Array.from(new Set(edges.map((edge) => edge.fromId))).filter((id) => typeof id === 'string' && id.length > 0);
        const callers = await Promise.all(callerIds.map(async (id) => {
          const fn = await storage.getFunction(id).catch(() => null);
          return {
            id,
            name: fn?.name ?? id,
            filePath: fn?.filePath ?? edges.find((edge) => edge.fromId === id)?.sourceFile,
          };
        }));

        const files = Array.from(new Set(edges.map((edge) => edge.sourceFile))).filter((file): file is string => typeof file === 'string' && file.length > 0);
        matches.push({
          id: target.id,
          name: target.name,
          filePath: target.filePath,
          usageCount: edges.length,
          files,
          callers,
        });
      }

      matches.sort((a, b) => b.usageCount - a.usageCount || a.name.localeCompare(b.name));

      return {
        success: true,
        symbol: input.symbol,
        matches,
        totalMatches: matches.length,
        workspace: workspacePath,
      };
    } catch (error) {
      return {
        success: false,
        symbol: input.symbol,
        matches: [],
        totalMatches: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async executeTraceImports(input: TraceImportsToolInput): Promise<unknown> {
    try {
      const workspacePath = input.workspace
        ? path.resolve(input.workspace)
        : this.findReadyWorkspace()?.path ?? this.state.workspaces.keys().next().value;
      if (!workspacePath) {
        return {
          success: false,
          filePath: input.filePath,
          direction: input.direction ?? 'both',
          depth: input.depth ?? 2,
          imports: [],
          importedBy: [],
          edges: [],
          error: 'No workspace specified and no workspaces registered',
        };
      }

      const workspace = this.state.workspaces.get(workspacePath);
      if (!workspace) {
        return {
          success: false,
          filePath: input.filePath,
          direction: input.direction ?? 'both',
          depth: input.depth ?? 2,
          imports: [],
          importedBy: [],
          edges: [],
          workspace: workspacePath,
          error: `Workspace not registered: ${workspacePath}`,
        };
      }
      if (workspace.indexState !== 'ready') {
        return {
          success: false,
          filePath: input.filePath,
          direction: input.direction ?? 'both',
          depth: input.depth ?? 2,
          imports: [],
          importedBy: [],
          edges: [],
          workspace: workspacePath,
          error: `Workspace not ready (state: ${workspace.indexState}). Run bootstrap first.`,
        };
      }

      const storage = await this.getOrCreateStorage(workspacePath);
      const files = await storage.getFiles({ limit: 10000 }).catch(() => []);
      type TraceFile = { path: string; relativePath?: string; imports?: string[]; importedBy?: string[] };
      const normalizedFiles = files as TraceFile[];

      const absoluteToRelative = new Map<string, string>();
      const relativeToAbsolute = new Map<string, string>();
      for (const file of normalizedFiles) {
        const absolute = path.normalize(file.path);
        const relative = file.relativePath
          ? file.relativePath
          : path.relative(workspacePath, absolute);
        absoluteToRelative.set(absolute, relative);
        relativeToAbsolute.set(path.normalize(relative), absolute);
      }

      const resolveAbsolute = (candidate: string): string | null => {
        const normalized = path.normalize(candidate);
        if (path.isAbsolute(normalized) && absoluteToRelative.has(normalized)) {
          return normalized;
        }
        const asRelative = path.normalize(candidate.replace(/^\.\/+/, ''));
        if (relativeToAbsolute.has(asRelative)) {
          return relativeToAbsolute.get(asRelative) ?? null;
        }
        const joined = path.normalize(path.join(workspacePath, candidate));
        if (absoluteToRelative.has(joined)) {
          return joined;
        }
        const suffixMatch = Array.from(absoluteToRelative.keys()).find((absPath) => absPath.endsWith(normalized));
        return suffixMatch ?? null;
      };

      const resolvedFileAbs = resolveAbsolute(input.filePath);
      if (!resolvedFileAbs) {
        return {
          success: false,
          filePath: input.filePath,
          direction: input.direction ?? 'both',
          depth: input.depth ?? 2,
          imports: [],
          importedBy: [],
          edges: [],
          workspace: workspacePath,
          error: `File not found in indexed workspace: ${input.filePath}`,
        };
      }

      const resolvedFileRel = absoluteToRelative.get(resolvedFileAbs) ?? path.relative(workspacePath, resolvedFileAbs);
      const maxDepth = Math.max(1, Math.min(6, Math.trunc(input.depth ?? 2)));
      const direction = input.direction ?? 'both';

      const edges: Array<{ from: string; to: string; direction: 'imports' | 'importedBy'; depth: number }> = [];
      const walkedImports = new Set<string>();
      const walkedImportedBy = new Set<string>();

      const walk = (
        seedAbs: string,
        relation: 'imports' | 'importedBy'
      ): string[] => {
        const discovered: string[] = [];
        const queue: Array<{ abs: string; depth: number }> = [{ abs: seedAbs, depth: 0 }];
        const visited = new Set<string>([seedAbs]);

        while (queue.length > 0) {
          const current = queue.shift();
          if (!current) continue;
          if (current.depth >= maxDepth) continue;
          const currentRel = absoluteToRelative.get(current.abs) ?? path.relative(workspacePath, current.abs);
          const currentFile = normalizedFiles.find((file) => path.normalize(file.path) === current.abs);
          if (!currentFile) continue;
          const neighbors = (relation === 'imports' ? currentFile.imports : currentFile.importedBy) ?? [];
          for (const neighbor of neighbors) {
            const neighborAbs = resolveAbsolute(neighbor);
            if (!neighborAbs) continue;
            const neighborRel = absoluteToRelative.get(neighborAbs) ?? path.relative(workspacePath, neighborAbs);

            if (relation === 'imports') {
              edges.push({ from: currentRel, to: neighborRel, direction: relation, depth: current.depth + 1 });
            } else {
              edges.push({ from: neighborRel, to: currentRel, direction: relation, depth: current.depth + 1 });
            }

            if (!discovered.includes(neighborRel)) {
              discovered.push(neighborRel);
            }

            if (!visited.has(neighborAbs)) {
              visited.add(neighborAbs);
              queue.push({ abs: neighborAbs, depth: current.depth + 1 });
            }
          }
        }

        return discovered;
      };

      if (direction === 'imports' || direction === 'both') {
        for (const item of walk(resolvedFileAbs, 'imports')) walkedImports.add(item);
      }
      if (direction === 'importedBy' || direction === 'both') {
        for (const item of walk(resolvedFileAbs, 'importedBy')) walkedImportedBy.add(item);
      }

      return {
        success: true,
        filePath: input.filePath,
        resolvedFile: resolvedFileRel,
        direction,
        depth: maxDepth,
        imports: Array.from(walkedImports),
        importedBy: Array.from(walkedImportedBy),
        edges,
        workspace: workspacePath,
      };
    } catch (error) {
      return {
        success: false,
        filePath: input.filePath,
        direction: input.direction ?? 'both',
        depth: input.depth ?? 2,
        imports: [],
        importedBy: [],
        edges: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private normalizeFindSymbolText(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9/_:\-.\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private scoreFindSymbolCandidate(query: string, candidate: string): number {
    const normalizedQuery = this.normalizeFindSymbolText(query);
    const normalizedCandidate = this.normalizeFindSymbolText(candidate);
    if (!normalizedQuery || !normalizedCandidate) return 0;
    if (normalizedCandidate === normalizedQuery) return 1;
    if (normalizedCandidate.startsWith(normalizedQuery)) return 0.95;
    if (normalizedCandidate.includes(normalizedQuery)) return 0.85;

    const queryTokens = normalizedQuery.split(' ').filter((token) => token.length > 0);
    if (queryTokens.length === 0) return 0;
    const matchedTokens = queryTokens.filter((token) => normalizedCandidate.includes(token));
    if (matchedTokens.length === 0) return 0;
    const coverage = matchedTokens.length / queryTokens.length;
    return Number((0.4 + coverage * 0.4).toFixed(3));
  }

  private upsertFindSymbolMatch(
    target: Map<string, FindSymbolMatchRecord>,
    candidate: FindSymbolMatchRecord
  ): void {
    if (!Number.isFinite(candidate.score) || candidate.score <= 0) return;
    const key = `${candidate.kind}:${candidate.id}`;
    const existing = target.get(key);
    if (!existing || candidate.score > existing.score) {
      target.set(key, candidate);
    }
  }

  private async executeFindSymbol(input: FindSymbolToolInput): Promise<unknown> {
    try {
      const limit = Math.max(1, Math.min(200, Math.trunc(input.limit ?? 20)));
      const workspaceHint = input.workspace
        ? path.resolve(input.workspace)
        : this.findReadyWorkspace()?.path ?? this.state.workspaces.keys().next().value;

      if (!workspaceHint) {
        return {
          success: false,
          query: input.query,
          kind: input.kind ?? 'any',
          matches: [],
          totalMatches: 0,
          error: 'No workspace specified and no workspaces registered',
        };
      }

      const workspacePath = path.resolve(workspaceHint);
      const workspace = this.state.workspaces.get(workspacePath);
      if (!workspace) {
        return {
          success: false,
          query: input.query,
          kind: input.kind ?? 'any',
          matches: [],
          totalMatches: 0,
          workspace: workspacePath,
          error: `Workspace not registered: ${workspacePath}`,
        };
      }

      if (workspace.indexState !== 'ready') {
        return {
          success: false,
          query: input.query,
          kind: input.kind ?? 'any',
          matches: [],
          totalMatches: 0,
          workspace: workspacePath,
          error: `Workspace not ready (state: ${workspace.indexState}). Run bootstrap first.`,
        };
      }

      const storage = await this.getOrCreateStorage(workspacePath);
      const matchMap = new Map<string, FindSymbolMatchRecord>();
      const includeKind = (kind: FindSymbolMatchKind): boolean => !input.kind || input.kind === kind;

      if (includeKind('function')) {
        const exactFunctions = await storage.getFunctionsByName(input.query).catch(() => []);
        for (const fn of exactFunctions) {
          const exactScore = this.normalizeFindSymbolText(fn.name) === this.normalizeFindSymbolText(input.query) ? 1 : 0.97;
          this.upsertFindSymbolMatch(matchMap, {
            id: fn.id,
            kind: 'function',
            name: fn.name,
            filePath: fn.filePath,
            score: exactScore,
            description: fn.signature || fn.purpose,
          });
        }

        const functionCandidates = await storage.getFunctions({ limit: 1200, orderBy: 'name', orderDirection: 'asc' }).catch(() => []);
        for (const fn of functionCandidates) {
          const score = this.scoreFindSymbolCandidate(
            input.query,
            `${fn.name} ${fn.signature} ${fn.filePath} ${fn.purpose}`
          );
          this.upsertFindSymbolMatch(matchMap, {
            id: fn.id,
            kind: 'function',
            name: fn.name,
            filePath: fn.filePath,
            score,
            description: fn.signature || fn.purpose,
          });
        }
      }

      if (includeKind('module')) {
        const moduleCandidates = await storage.getModules({ limit: 1200, orderBy: 'name', orderDirection: 'asc' }).catch(() => []);
        for (const mod of moduleCandidates) {
          const score = this.scoreFindSymbolCandidate(
            input.query,
            `${mod.id} ${mod.path} ${mod.purpose} ${mod.exports.join(' ')} ${mod.dependencies.join(' ')}`
          );
          this.upsertFindSymbolMatch(matchMap, {
            id: mod.id,
            kind: 'module',
            name: mod.path,
            filePath: mod.path,
            score,
            description: mod.purpose,
          });
        }
      }

      const needsPackSearch = includeKind('context_pack') || includeKind('claim');
      if (needsPackSearch) {
        const packCandidates = await storage.getContextPacks({ limit: 1500 }).catch(() => []);
        for (const pack of packCandidates) {
          const candidateText = [
            pack.packId,
            pack.targetId,
            pack.summary,
            ...pack.keyFacts,
            ...pack.relatedFiles,
          ].join(' ');
          const score = this.scoreFindSymbolCandidate(input.query, candidateText);

          if (includeKind('context_pack')) {
            this.upsertFindSymbolMatch(matchMap, {
              id: pack.packId,
              kind: 'context_pack',
              name: pack.targetId,
              filePath: pack.relatedFiles[0],
              score,
              description: pack.summary,
            });
          }

          if (includeKind('claim')) {
            this.upsertFindSymbolMatch(matchMap, {
              id: pack.packId,
              kind: 'claim',
              name: pack.targetId,
              filePath: pack.relatedFiles[0],
              score,
              description: pack.summary,
            });
          }
        }
      }

      if (includeKind('composition')) {
        let compositions: Array<{ id: string; name?: string; description?: string; primitiveIds?: string[] }> = [];
        if (workspace.librarian && typeof (workspace.librarian as unknown as { listTechniqueCompositions?: () => Promise<unknown> }).listTechniqueCompositions === 'function') {
          const listed = await (workspace.librarian as unknown as { listTechniqueCompositions: () => Promise<unknown> }).listTechniqueCompositions().catch(() => []);
          if (Array.isArray(listed)) {
            compositions = listed as Array<{ id: string; name?: string; description?: string; primitiveIds?: string[] }>;
          }
        }
        if (compositions.length === 0) {
          compositions = await listStoredTechniqueCompositions(storage).catch(() => []);
        }

        for (const composition of compositions) {
          const score = this.scoreFindSymbolCandidate(
            input.query,
            `${composition.id} ${composition.name ?? ''} ${composition.description ?? ''} ${(composition.primitiveIds ?? []).join(' ')}`
          );
          this.upsertFindSymbolMatch(matchMap, {
            id: composition.id,
            kind: 'composition',
            name: composition.name ?? composition.id,
            score,
            description: composition.description,
          });
        }
      }

      if (includeKind('run')) {
        const runs = await this.getBootstrapRunHistory(storage).catch(() => []);
        for (const run of runs) {
          const score = this.scoreFindSymbolCandidate(
            input.query,
            `${run.runId} ${run.workspace} ${run.startedAt} ${run.completedAt ?? ''}`
          );
          this.upsertFindSymbolMatch(matchMap, {
            id: run.runId,
            kind: 'run',
            name: run.runId,
            filePath: run.workspace,
            score,
            description: `Bootstrap run at ${run.startedAt}`,
          });
        }
      }

      const matches = Array.from(matchMap.values())
        .sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score;
          if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
          return a.name.localeCompare(b.name);
        });

      return {
        success: true,
        query: input.query,
        kind: input.kind ?? 'any',
        matches: matches.slice(0, limit),
        totalMatches: matches.length,
        workspace: workspacePath,
      };
    } catch (error) {
      return {
        success: false,
        query: input.query,
        kind: input.kind ?? 'any',
        matches: [],
        totalMatches: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async executeVerifyClaim(input: VerifyClaimToolInput): Promise<unknown> {
    try {
      const workspace = this.findReadyWorkspace();
      if (!workspace) {
        return {
          claimId: input.claimId,
          verified: false,
          error: 'No indexed workspace available',
        };
      }

      const storage = await this.getOrCreateStorage(workspace.path);

      // Get the context pack or knowledge item for the claim
      const pack = await storage.getContextPack(input.claimId);
      if (!pack) {
        return {
          claimId: input.claimId,
          verified: false,
          error: 'Claim not found',
        };
      }

      // Build metadata for defeater checking
      const meta = {
        confidence: { overall: pack.confidence, bySection: {} as Record<string, number> },
        evidence: [] as Array<{
          type: 'code' | 'test' | 'commit' | 'comment' | 'usage' | 'doc' | 'inferred';
          source: string;
          description: string;
          confidence: number;
        }>,
        generatedAt: pack.createdAt.toISOString(),
        generatedBy: 'librarian',
        defeaters: [STANDARD_DEFEATERS.codeChange, STANDARD_DEFEATERS.testFailure],
      };

      // Check defeaters
      const result = await checkDefeaters(meta, {
        entityId: pack.targetId,
        filePath: pack.relatedFiles[0] ?? '',
        storage,
      });

      return {
        claimId: input.claimId,
        verified: result.knowledgeValid,
        confidence: pack.confidence + result.confidenceAdjustment,
        activeDefeaters: result.activeDefeaters,
        defeaterResults: result.results.map((r) => ({
          type: r.defeater.type,
          activated: r.activated,
          reason: r.reason,
          severity: r.severity,
        })),
      };
    } catch (error) {
      return {
        claimId: input.claimId,
        verified: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async executeGetChangeImpact(input: GetChangeImpactToolInput): Promise<unknown> {
    try {
      let workspacePath: string | undefined;
      if (input.workspace) {
        workspacePath = path.resolve(input.workspace);
      } else {
        const first = this.state.workspaces.keys().next();
        workspacePath = first.done ? undefined : first.value;
      }

      if (!workspacePath) {
        return {
          success: false,
          error: 'No workspace specified and no workspaces registered',
          registeredWorkspaces: 0,
        };
      }

      const workspace = this.state.workspaces.get(workspacePath);
      if (!workspace) {
        return {
          success: false,
          error: `Workspace not registered: ${workspacePath}`,
          registeredWorkspaces: this.state.workspaces.size,
          availableWorkspaces: Array.from(this.state.workspaces.keys()),
        };
      }

      const storage = workspace.librarian?.getStorage() ?? workspace.storage;
      if (!storage) {
        return {
          success: false,
          error: `Workspace storage not initialized: ${workspacePath}`,
        };
      }

      const report = await computeChangeImpactReport(storage, {
        target: input.target,
        depth: input.depth,
        maxResults: input.maxResults,
        changeType: input.changeType,
      });

      return {
        workspace: workspacePath,
        ...report,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async executeBlastRadius(input: BlastRadiusToolInput): Promise<unknown> {
    const base = await this.executeGetChangeImpact({
      target: input.target,
      workspace: input.workspace,
      depth: input.depth,
      maxResults: input.maxResults,
      changeType: input.changeType,
    });

    if (!base || typeof base !== 'object') {
      return base;
    }

    const payload = base as Record<string, unknown>;
    if (payload.success === false) {
      return {
        ...payload,
        tool: 'blast_radius',
        aliasOf: 'get_change_impact',
      };
    }

    const summary = (payload.summary ?? {}) as Record<string, unknown>;
    const riskLevel = summary.riskLevel;
    const nextTools = riskLevel === 'critical' || riskLevel === 'high'
      ? ['request_human_review', 'synthesize_plan']
      : ['synthesize_plan', 'query'];

    return {
      ...payload,
      tool: 'blast_radius',
      aliasOf: 'get_change_impact',
      preEditGuidance: {
        recommendation: 'Run blast radius before edits; if risk is high, pause for review and create an explicit plan.',
        nextTools,
      },
    };
  }

  private async executePreCommitCheck(input: PreCommitCheckToolInput): Promise<unknown> {
    const changedFiles = Array.from(
      new Set((input.changedFiles ?? []).map((file) => file.trim()).filter((file) => file.length > 0)),
    );
    if (changedFiles.length === 0) {
      return {
        success: false,
        passed: false,
        error: 'changedFiles must contain at least one non-empty file path.',
      };
    }

    const workspacePath = input.workspace
      ? path.resolve(input.workspace)
      : this.findReadyWorkspace()?.path ?? this.state.workspaces.keys().next().value;

    if (!workspacePath) {
      return {
        success: false,
        passed: false,
        changedFiles,
        error: 'No workspace specified and no workspaces registered.',
        recommendedActions: [
          { tool: 'bootstrap', rationale: 'Register and index a workspace before semantic pre-commit checks.' },
        ],
      };
    }

    const riskRank: Record<'low' | 'medium' | 'high' | 'critical', number> = {
      low: 1,
      medium: 2,
      high: 3,
      critical: 4,
    };
    const strict = input.strict ?? false;
    const maxRiskLevel = input.maxRiskLevel ?? (strict ? 'medium' : 'high');
    const thresholdRank = riskRank[maxRiskLevel];

    const fileChecks: Array<{
      file: string;
      passed: boolean;
      riskLevel: 'low' | 'medium' | 'high' | 'critical' | 'unknown';
      totalImpacted: number;
      reason: string;
    }> = [];

    for (const file of changedFiles) {
      const impact = await this.executeGetChangeImpact({
        target: file,
        workspace: workspacePath,
      });

      if (!impact || typeof impact !== 'object') {
        fileChecks.push({
          file,
          passed: !strict,
          riskLevel: 'unknown',
          totalImpacted: 0,
          reason: 'Impact analysis returned an unexpected payload.',
        });
        continue;
      }

      const payload = impact as Record<string, unknown>;
      if (payload.success === false) {
        fileChecks.push({
          file,
          passed: false,
          riskLevel: 'unknown',
          totalImpacted: 0,
          reason: typeof payload.error === 'string' ? payload.error : 'Impact analysis failed.',
        });
        continue;
      }

      const summary = (payload.summary ?? {}) as Record<string, unknown>;
      const riskLevel = (summary.riskLevel ?? 'unknown') as 'low' | 'medium' | 'high' | 'critical' | 'unknown';
      const totalImpacted = typeof summary.totalImpacted === 'number' ? summary.totalImpacted : 0;
      const passed = riskLevel === 'unknown'
        ? !strict
        : riskRank[riskLevel] <= thresholdRank;
      fileChecks.push({
        file,
        passed,
        riskLevel,
        totalImpacted,
        reason: riskLevel === 'unknown'
          ? 'Risk level unavailable from impact analysis.'
          : `Risk ${riskLevel} is ${passed ? 'within' : 'above'} maxRiskLevel=${maxRiskLevel}.`,
      });
    }

    const passed = fileChecks.every((check) => check.passed);
    const highRiskCount = fileChecks.filter((check) => check.riskLevel === 'high' || check.riskLevel === 'critical').length;
    const failingFiles = fileChecks.filter((check) => !check.passed).map((check) => check.file);
    const recommendedActions = passed
      ? [
        { tool: 'submit_feedback', rationale: 'Record successful outcome after merge/verification.' },
      ]
      : highRiskCount > 0
        ? [
          { tool: 'request_human_review', rationale: 'High-risk blast radius detected in changed files.' },
          { tool: 'synthesize_plan', rationale: 'Persist mitigation/rollback plan before submitting.' },
        ]
        : [
          { tool: 'query', rationale: 'Collect more context for failing files before submit.' },
          { tool: 'synthesize_plan', rationale: 'Convert remediation into explicit steps.' },
        ];

    return {
      success: true,
      tool: 'pre_commit_check',
      workspace: workspacePath,
      passed,
      strict,
      maxRiskLevel,
      checks: fileChecks,
      summary: {
        totalFiles: fileChecks.length,
        passedFiles: fileChecks.filter((check) => check.passed).length,
        failingFiles,
        highRiskCount,
      },
      recommendedActions,
    };
  }

  private normalizeClaimValues(values: string[] | undefined, maxItems = 32): string[] {
    if (!Array.isArray(values)) return [];
    const normalized = values
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
    const unique = Array.from(new Set(normalized));
    return unique.slice(0, maxItems);
  }

  private async executeAppendClaim(
    input: AppendClaimToolInput,
    context: ToolExecutionContext = {},
  ): Promise<unknown> {
    const claim = input.claim?.trim() ?? '';
    if (claim.length === 0) {
      return {
        success: false,
        tool: 'append_claim',
        error: 'claim must be a non-empty string.',
      };
    }

    const workspace = typeof input.workspace === 'string' && input.workspace.trim().length > 0
      ? path.resolve(input.workspace)
      : undefined;
    const explicitSessionId = typeof input.sessionId === 'string' && input.sessionId.trim().length > 0
      ? input.sessionId.trim()
      : undefined;
    const contextSessionId = typeof context.sessionId === 'string' && context.sessionId.trim().length > 0
      ? context.sessionId.trim()
      : undefined;
    const sessionId = explicitSessionId
      ?? contextSessionId
      ?? this.buildAnonymousSessionId(workspace ?? process.cwd());
    const tags = this.normalizeClaimValues(input.tags?.map((tag) => tag.toLowerCase()), 24);
    const evidence = this.normalizeClaimValues(input.evidence, 32);
    const confidenceInput = typeof input.confidence === 'number' && Number.isFinite(input.confidence)
      ? input.confidence
      : 0.6;
    const confidence = Math.max(0, Math.min(1, confidenceInput));
    const sourceTool = typeof input.sourceTool === 'string' && input.sourceTool.trim().length > 0
      ? input.sourceTool.trim()
      : undefined;
    const createdAt = new Date().toISOString();
    const claimId = `clm_${this.generateId()}`;

    const record: KnowledgeClaimRecord = {
      claimId,
      claim,
      workspace,
      sessionId,
      tags,
      evidence,
      confidence,
      sourceTool,
      createdAt,
    };
    this.state.knowledgeClaims.push(record);
    if (this.state.knowledgeClaims.length > 5000) {
      this.state.knowledgeClaims.splice(0, this.state.knowledgeClaims.length - 5000);
    }

    await this.appendWorkspaceAuditLog(workspace ?? process.cwd(), {
      ts: createdAt,
      event: 'append_claim',
      claim_id: claimId,
      claim,
      session_id: sessionId,
      workspace: workspace ?? process.cwd(),
      tags,
      confidence,
      source_tool: sourceTool,
    });

    return {
      success: true,
      tool: 'append_claim',
      claimId,
      claim,
      sessionId,
      workspace,
      tags,
      evidence,
      confidence,
      sourceTool,
      storedAt: createdAt,
      claimCount: this.state.knowledgeClaims.length,
    };
  }

  private async executeQueryClaims(input: QueryClaimsToolInput): Promise<unknown> {
    const workspaceFilter = typeof input.workspace === 'string' && input.workspace.trim().length > 0
      ? path.resolve(input.workspace)
      : undefined;
    const sessionFilter = typeof input.sessionId === 'string' && input.sessionId.trim().length > 0
      ? input.sessionId.trim()
      : undefined;
    const query = typeof input.query === 'string' ? input.query.trim().toLowerCase() : '';
    const tagFilters = this.normalizeClaimValues(input.tags?.map((tag) => tag.toLowerCase()), 24);
    const limit = Math.max(1, Math.min(200, Math.trunc(input.limit ?? 20)));

    let sinceMs: number | undefined;
    if (typeof input.since === 'string' && input.since.trim().length > 0) {
      const parsed = Date.parse(input.since);
      if (!Number.isFinite(parsed)) {
        return {
          success: false,
          tool: 'query_claims',
          error: 'since must be a valid ISO timestamp.',
        };
      }
      sinceMs = parsed;
    }

    const filtered = this.state.knowledgeClaims
      .filter((record) => !workspaceFilter || record.workspace === workspaceFilter)
      .filter((record) => !sessionFilter || record.sessionId === sessionFilter)
      .filter((record) => {
        if (tagFilters.length === 0) return true;
        return record.tags.some((tag) => tagFilters.includes(tag));
      })
      .filter((record) => {
        if (typeof sinceMs !== 'number') return true;
        const createdAtMs = Date.parse(record.createdAt);
        return Number.isFinite(createdAtMs) && createdAtMs >= sinceMs;
      })
      .filter((record) => {
        if (!query) return true;
        const searchable = [
          record.claim,
          ...record.tags,
          ...record.evidence,
          record.sourceTool ?? '',
        ].join(' ').toLowerCase();
        return searchable.includes(query);
      })
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

    const claims = filtered.slice(0, limit).map((record) => ({
      claimId: record.claimId,
      claim: record.claim,
      workspace: record.workspace,
      sessionId: record.sessionId,
      tags: record.tags,
      evidence: record.evidence,
      confidence: record.confidence,
      sourceTool: record.sourceTool,
      createdAt: record.createdAt,
    }));

    return {
      success: true,
      tool: 'query_claims',
      totalMatches: filtered.length,
      returned: claims.length,
      claims,
      filters: {
        query: query || undefined,
        workspace: workspaceFilter,
        sessionId: sessionFilter,
        tags: tagFilters,
        since: input.since,
        limit,
      },
    };
  }

  private async executeHarvestSessionKnowledge(
    input: HarvestSessionKnowledgeToolInput,
    context: ToolExecutionContext = {},
  ): Promise<unknown> {
    const workspace = typeof input.workspace === 'string' && input.workspace.trim().length > 0
      ? path.resolve(input.workspace)
      : undefined;
    const explicitSessionId = typeof input.sessionId === 'string' && input.sessionId.trim().length > 0
      ? input.sessionId.trim()
      : undefined;
    const contextSessionId = typeof context.sessionId === 'string' && context.sessionId.trim().length > 0
      ? context.sessionId.trim()
      : undefined;
    const sessionId = explicitSessionId
      ?? contextSessionId
      ?? this.buildAnonymousSessionId(workspace ?? process.cwd());
    const maxItems = Math.max(1, Math.min(200, Math.trunc(input.maxItems ?? 20)));
    const minConfidence = Math.max(0, Math.min(1, input.minConfidence ?? 0));
    const includeRecommendations = input.includeRecommendations ?? true;

    const matching = this.state.knowledgeClaims
      .filter((record) => record.sessionId === sessionId)
      .filter((record) => !workspace || record.workspace === workspace)
      .filter((record) => record.confidence >= minConfidence)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    const claims = matching.slice(0, maxItems).map((record) => ({
      claimId: record.claimId,
      claim: record.claim,
      workspace: record.workspace,
      sessionId: record.sessionId,
      tags: record.tags,
      evidence: record.evidence,
      confidence: record.confidence,
      sourceTool: record.sourceTool,
      createdAt: record.createdAt,
    }));

    const tagCount = new Map<string, number>();
    for (const record of matching) {
      for (const tag of record.tags) {
        tagCount.set(tag, (tagCount.get(tag) ?? 0) + 1);
      }
    }
    const topTags = Array.from(tagCount.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => (b.count - a.count) || a.tag.localeCompare(b.tag))
      .slice(0, 10);
    const averageConfidence = matching.length > 0
      ? matching.reduce((sum, record) => sum + record.confidence, 0) / matching.length
      : 0;

    let memoryBridge: {
      memoryFilePath: string;
      source: 'openclaw-session' | 'manual' | 'harvest';
      written: number;
      skipped: number;
      entries: Array<{
        evidenceId: string;
        confidence: number;
        memoryLineRange: [number, number];
        defeatedBy?: string;
      }>;
      error?: string;
    } | undefined;

    const persistToMemory = input.persistToMemory ?? true;
    if (persistToMemory) {
      const workspaceRoot = workspace ?? process.cwd();
      const memoryFilePath = this.resolveHarvestMemoryFilePath(input, workspaceRoot);
      const source = input.source ?? 'harvest';
      try {
        const instrumentationWorkspace = await this.ensureWorkspaceInstrumentation(workspaceRoot);
        const bridge = new MemoryBridgeDaemon({
          workspaceRoot,
          evidenceLedger: instrumentationWorkspace?.evidenceLedger,
        });

        const harvestResult = await bridge.harvestToMemory({
          claims: matching.slice(0, maxItems).map((record) => ({
            claimId: record.claimId,
            claim: record.claim,
            workspace: record.workspace,
            sessionId: record.sessionId,
            tags: record.tags,
            evidence: record.evidence,
            confidence: record.confidence,
            sourceTool: record.sourceTool,
            createdAt: record.createdAt,
          })),
          memoryFilePath,
          source,
        });

        memoryBridge = {
          memoryFilePath: harvestResult.memoryFilePath,
          source: harvestResult.source,
          written: harvestResult.written,
          skipped: harvestResult.skipped,
          entries: harvestResult.entries.map((entry) => ({
            evidenceId: entry.evidenceId,
            confidence: entry.confidence,
            memoryLineRange: entry.memoryLineRange,
            defeatedBy: entry.defeatedBy,
          })),
        };

        await this.appendWorkspaceAuditLog(workspaceRoot, {
          ts: new Date().toISOString(),
          event: 'memory_bridge_harvest',
          session_id: sessionId,
          workspace: workspaceRoot,
          memory_file: harvestResult.memoryFilePath,
          written: harvestResult.written,
          skipped: harvestResult.skipped,
          source,
        });
      } catch (error) {
        memoryBridge = {
          memoryFilePath,
          source,
          written: 0,
          skipped: 0,
          entries: [],
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    return {
      success: true,
      tool: 'harvest_session_knowledge',
      sessionId,
      workspace,
      minConfidence,
      claims,
      summary: {
        totalClaims: matching.length,
        returnedClaims: claims.length,
        uniqueTags: tagCount.size,
        topTags,
        averageConfidence,
        mostRecentAt: matching[0]?.createdAt,
      },
      recommendations: includeRecommendations
        ? (matching.length === 0
          ? [
            { tool: 'append_claim', rationale: 'No claims were harvested; persist new claims as you resolve uncertain findings.' },
            { tool: 'query', rationale: 'Run a focused query to gather stronger evidence before recording additional claims.' },
          ]
          : [
            { tool: 'query_claims', rationale: 'Filter harvested knowledge by topic or timeframe for targeted planning.' },
            { tool: 'synthesize_plan', rationale: 'Convert harvested claims into an explicit execution plan with traceable context.' },
          ])
        : [],
      memoryBridge,
    };
  }

  private resolveHarvestMemoryFilePath(
    input: HarvestSessionKnowledgeToolInput,
    workspaceRoot: string,
  ): string {
    if (typeof input.memoryFilePath === 'string' && input.memoryFilePath.trim().length > 0) {
      return path.resolve(input.memoryFilePath);
    }
    const openclawRoot = typeof input.openclawRoot === 'string' && input.openclawRoot.trim().length > 0
      ? path.resolve(input.openclawRoot)
      : path.join(workspaceRoot, '.openclaw');
    return path.join(openclawRoot, 'memory', 'MEMORY.md');
  }

  private buildScopeClaimKey(scopeId: string, workspace?: string): string {
    return `${workspace ?? 'global'}::${scopeId}`;
  }

  private pruneExpiredScopeClaims(nowMs = Date.now()): void {
    for (const [key, claim] of this.state.scopeClaims) {
      const expiresAtMs = Date.parse(claim.expiresAt);
      if (!Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs) {
        this.state.scopeClaims.delete(key);
      }
    }
  }

  private async executeClaimWorkScope(
    input: ClaimWorkScopeToolInput,
    context: ToolExecutionContext = {},
  ): Promise<unknown> {
    const scopeId = input.scopeId?.trim() ?? '';
    if (scopeId.length === 0) {
      return {
        success: false,
        claimed: false,
        error: 'scopeId must be a non-empty string.',
      };
    }

    const workspace = typeof input.workspace === 'string' && input.workspace.trim().length > 0
      ? path.resolve(input.workspace)
      : undefined;
    const explicitSessionId = typeof input.sessionId === 'string' && input.sessionId.trim().length > 0
      ? input.sessionId.trim()
      : undefined;
    const contextSessionId = typeof context.sessionId === 'string' && context.sessionId.trim().length > 0
      ? context.sessionId.trim()
      : undefined;
    const sessionId = explicitSessionId
      ?? contextSessionId
      ?? this.buildAnonymousSessionId(workspace ?? process.cwd());
    const mode = input.mode ?? 'claim';
    const ttlSeconds = Math.max(1, Math.min(86400, Math.trunc(input.ttlSeconds ?? 1800)));
    const owner = typeof input.owner === 'string' && input.owner.trim().length > 0
      ? input.owner.trim()
      : undefined;

    this.pruneExpiredScopeClaims();
    const scopeKey = this.buildScopeClaimKey(scopeId, workspace);
    const existing = this.state.scopeClaims.get(scopeKey);

    if (mode === 'check') {
      return {
        success: true,
        mode,
        scopeId,
        workspace,
        available: !existing,
        conflict: existing
          ? {
            sessionId: existing.sessionId,
            owner: existing.owner,
            expiresAt: existing.expiresAt,
          }
          : null,
      };
    }

    if (mode === 'release') {
      if (!existing) {
        return {
          success: true,
          mode,
          scopeId,
          workspace,
          released: false,
          message: 'No active claim existed for this scope.',
        };
      }
      if (existing.sessionId !== sessionId) {
        return {
          success: true,
          mode,
          scopeId,
          workspace,
          released: false,
          message: 'Scope is claimed by another session.',
          conflict: {
            sessionId: existing.sessionId,
            owner: existing.owner,
            expiresAt: existing.expiresAt,
          },
        };
      }
      this.state.scopeClaims.delete(scopeKey);
      return {
        success: true,
        mode,
        scopeId,
        workspace,
        released: true,
        message: 'Scope claim released.',
      };
    }

    if (existing && existing.sessionId !== sessionId) {
      return {
        success: true,
        mode,
        scopeId,
        workspace,
        claimed: false,
        message: 'Scope already claimed by another session.',
        conflict: {
          sessionId: existing.sessionId,
          owner: existing.owner,
          expiresAt: existing.expiresAt,
        },
      };
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
    const record: ScopeClaimRecord = {
      scopeKey,
      scopeId,
      workspace,
      sessionId,
      owner,
      claimedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };
    this.state.scopeClaims.set(scopeKey, record);

    const activeClaims = Array.from(this.state.scopeClaims.values())
      .filter((claim) => claim.workspace === workspace)
      .map((claim) => ({
        scopeId: claim.scopeId,
        sessionId: claim.sessionId,
        owner: claim.owner,
        expiresAt: claim.expiresAt,
      }));

    return {
      success: true,
      mode,
      scopeId,
      workspace,
      claimed: true,
      sessionId,
      owner,
      expiresAt: record.expiresAt,
      activeClaims,
    };
  }

  private async executeRunAudit(input: RunAuditToolInput): Promise<unknown> {
    const auditId = this.generateId();
    const startTime = Date.now();

    try {
      const workspace = this.findReadyWorkspace();
      if (!workspace) {
        return {
          auditId,
          status: 'failed',
          error: 'No indexed workspace available',
          type: input.type,
        };
      }

      const storage = await this.getOrCreateStorage(workspace.path);
      const findings: Array<{
        severity: 'info' | 'warning' | 'error';
        category: string;
        message: string;
        file?: string;
      }> = [];

      // Run audit based on type
      switch (input.type) {
        case 'claims':
        case 'full': {
          // Audit context packs
          const packs = await storage.getContextPacks({ limit: 100 });
          for (const pack of packs) {
            if (pack.confidence < 0.3) {
              findings.push({
                severity: 'warning',
                category: 'low-confidence',
                message: `Low confidence pack: ${pack.packType} for ${pack.targetId}`,
                file: pack.relatedFiles[0],
              });
            }
          }
          break;
        }
        case 'coverage': {
          // Check indexing coverage
          const stats = await storage.getStats();
          if (stats.totalFunctions === 0) {
            findings.push({
              severity: 'error',
              category: 'coverage',
              message: 'No functions indexed',
            });
          }
          if (stats.totalContextPacks === 0) {
            findings.push({
              severity: 'error',
              category: 'coverage',
              message: 'No context packs generated',
            });
          }
          const lastIndexing = await storage.getLastIndexingResult();
          if (lastIndexing?.filesSkipped && lastIndexing.filesSkipped > 0) {
            const sampleSkipped = lastIndexing.errors
              .map((error) => error.path)
              .filter((filePath): filePath is string => typeof filePath === 'string' && filePath.length > 0)
              .slice(0, 3);
            findings.push({
              severity: 'warning',
              category: 'coverage',
              message: sampleSkipped.length > 0
                ? `${lastIndexing.filesSkipped} files were skipped during the last indexing run (examples: ${sampleSkipped.join(', ')})`
                : `${lastIndexing.filesSkipped} files were skipped during the last indexing run`,
            });
          }
          break;
        }
        case 'freshness': {
          // Check data freshness
          const metadata = await storage.getMetadata();
          if (metadata?.lastBootstrap) {
            const age = Date.now() - metadata.lastBootstrap.getTime();
            const daysSinceBootstrap = age / (1000 * 60 * 60 * 24);
            if (daysSinceBootstrap > 7) {
              findings.push({
                severity: 'warning',
                category: 'freshness',
                message: `Index is ${Math.floor(daysSinceBootstrap)} days old`,
              });
            }
          }
          const lastIndexedAt = metadata?.lastIndexing;
          if (lastIndexedAt) {
            const files = await storage.getFiles();
            const staleFiles: string[] = [];
            for (const file of files.slice(0, 250)) {
              const filePath = path.isAbsolute(file.path)
                ? file.path
                : path.join(workspace.path, file.path);
              try {
                const stat = await fs.stat(filePath);
                if (stat.mtime > lastIndexedAt) {
                  staleFiles.push(file.path);
                }
              } catch {
                // Ignore files we cannot stat during freshness checks.
              }
              if (staleFiles.length >= 10) break;
            }
            if (staleFiles.length > 0) {
              findings.push({
                severity: 'warning',
                category: 'freshness',
                message: `Detected ${staleFiles.length} files newer than last indexing time (examples: ${staleFiles.slice(0, 5).join(', ')})`,
              });
            }
          }
          break;
        }
        case 'security': {
          const packs = await storage.getContextPacks({ limit: 200 });
          const suspiciousPatterns: Array<{ pattern: RegExp; label: string }> = [
            { pattern: /\b(api[_-]?key|access[_-]?token|secret|password|private[_-]?key)\b\s*[:=]\s*['"][^'"\s]{12,}/i, label: 'credential_assignment' },
            { pattern: /\bsk_(?:live|test)_[a-z0-9]{16,}\b/i, label: 'stripe_key' },
            { pattern: /\bAKIA[0-9A-Z]{16}\b/, label: 'aws_access_key' },
          ];

          for (const pack of packs) {
            const content = [pack.summary, ...pack.keyFacts].join('\n');
            const matchedPattern = suspiciousPatterns.find(({ pattern }) => pattern.test(content));
            if (!matchedPattern) continue;
            findings.push({
              severity: 'warning',
              category: 'security',
              message: `Potential hardcoded secret pattern (${matchedPattern.label}) in pack ${pack.packId} for ${pack.targetId}`,
              file: pack.relatedFiles[0],
            });
          }

          const deniedAuthAttempts = this.state.auditLog.filter((entry) => {
            if (entry.operation !== 'authorization') return false;
            if (entry.status !== 'denied') return false;
            const ageMs = Date.now() - new Date(entry.timestamp).getTime();
            return Number.isFinite(ageMs) && ageMs <= 24 * 60 * 60 * 1000;
          }).length;
          if (deniedAuthAttempts > 0) {
            findings.push({
              severity: 'info',
              category: 'security',
              message: `${deniedAuthAttempts} authorization denials observed in the last 24h`,
            });
          }

          const riskyScopes = this.config.authorization.enabledScopes.filter(
            (scope) => scope === 'admin' || scope === 'network' || scope === 'execute'
          );
          if (riskyScopes.length > 0 && !this.config.authorization.requireConsent) {
            findings.push({
              severity: 'warning',
              category: 'security',
              message: `High-privilege scopes enabled without consent gate: ${riskyScopes.join(', ')}`,
            });
          }

          if (findings.length === 0) {
            findings.push({
              severity: 'info',
              category: 'security',
              message: `No security findings detected across ${packs.length} context packs and recent authorization logs`,
            });
          }
          break;
        }
      }

      return {
        auditId,
        status: 'completed',
        type: input.type,
        durationMs: Date.now() - startTime,
        findingsCount: findings.length,
        findings: input.generateReport ? findings : findings.slice(0, 5),
        summary: {
          errors: findings.filter((f) => f.severity === 'error').length,
          warnings: findings.filter((f) => f.severity === 'warning').length,
          info: findings.filter((f) => f.severity === 'info').length,
        },
      };
    } catch (error) {
      return {
        auditId,
        status: 'failed',
        type: input.type,
        durationMs: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async executeListRuns(input: ListRunsToolInput): Promise<unknown> {
    try {
      const candidateWorkspaces = this.getWorkspaceSearchOrder(input.workspace);
      const workspacePath = candidateWorkspaces[0];
      if (!workspacePath) {
        return {
          success: false,
          error: 'No workspace specified and no workspaces available',
          totalRuns: 0,
          runs: [],
        };
      }

      const storage = await this.getOrCreateStorage(workspacePath);
      const runs = await this.getBootstrapRunHistory(storage);
      const requestedLimit = Number(input.limit ?? DEFAULT_RUN_LIST_LIMIT);
      const limit = Number.isFinite(requestedLimit)
        ? Math.max(1, Math.min(MAX_RUN_LIST_LIMIT, Math.trunc(requestedLimit)))
        : DEFAULT_RUN_LIST_LIMIT;

      return {
        success: true,
        workspace: workspacePath,
        totalRuns: runs.length,
        runs: runs.slice(0, limit),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        totalRuns: 0,
        runs: [],
      };
    }
  }

  private async executeDiffRuns(input: DiffRunsToolInput): Promise<unknown> {
    try {
      const runA = await this.findBootstrapRunRecord(input.runIdA, input.workspace);
      const runB = await this.findBootstrapRunRecord(input.runIdB, input.workspace);
      if (!runA || !runB) {
        return {
          summary: 'One or both runs not found',
          workspace: input.workspace ? path.resolve(input.workspace) : undefined,
          runIdA: input.runIdA,
          runIdB: input.runIdB,
          error: 'Run IDs were not found in persisted bootstrap history. Use list_runs to discover available run IDs.',
        };
      }

      const diff = {
        functions: {
          before: runA.stats.functionsIndexed,
          after: runB.stats.functionsIndexed,
          delta: runB.stats.functionsIndexed - runA.stats.functionsIndexed,
        },
        modules: {
          before: runA.stats.filesProcessed,
          after: runB.stats.filesProcessed,
          delta: runB.stats.filesProcessed - runA.stats.filesProcessed,
        },
        contextPacks: {
          before: runA.stats.contextPacksCreated,
          after: runB.stats.contextPacksCreated,
          delta: runB.stats.contextPacksCreated - runA.stats.contextPacksCreated,
        },
        avgConfidence: {
          before: runA.stats.averageConfidence,
          after: runB.stats.averageConfidence,
          delta: runB.stats.averageConfidence - runA.stats.averageConfidence,
        },
      };

      return {
        summary: `Diff between ${input.runIdA} and ${input.runIdB}`,
        workspace: input.workspace ? path.resolve(input.workspace) : undefined,
        runIdA: input.runIdA,
        runIdB: input.runIdB,
        runA,
        runB,
        diff,
        detailed: input.detailed ? diff : undefined,
      };
    } catch (error) {
      return {
        summary: 'Diff failed',
        runIdA: input.runIdA,
        runIdB: input.runIdB,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async executeExportIndex(input: ExportIndexToolInput): Promise<unknown> {
    try {
      const workspace = this.findReadyWorkspace();
      if (!workspace) {
        return {
          success: false,
          error: 'No indexed workspace available',
          format: input.format,
          outputPath: input.outputPath,
        };
      }

      const storage = await this.getOrCreateStorage(workspace.path);
      const outputPath = path.resolve(input.outputPath);

      // Security: Validate output path is within workspace or its .librarian directory
      const normalizedOutput = path.normalize(outputPath);
      const normalizedWorkspace = path.normalize(workspace.path);
      const librarianDir = path.join(normalizedWorkspace, '.librarian');

      const isInWorkspace = normalizedOutput.startsWith(normalizedWorkspace + path.sep) ||
                            normalizedOutput === normalizedWorkspace;
      const isInLibrarianDir = normalizedOutput.startsWith(librarianDir + path.sep) ||
                               normalizedOutput === librarianDir;

      // Allow exports only within workspace or .librarian/exports subdirectory
      if (!isInWorkspace && !isInLibrarianDir) {
        return {
          success: false,
          error: 'Export path must be within the workspace directory',
          format: input.format,
          outputPath: input.outputPath,
          allowedPath: workspace.path,
        };
      }

      // Ensure output directory exists
      await fs.mkdir(path.dirname(outputPath), { recursive: true });

      switch (input.format) {
        case 'json': {
          // Export as JSON
          const stats = await storage.getStats();
          const metadata = await storage.getMetadata();
          const packs = await storage.getContextPacks({ limit: 1000 });

          const exportData = {
            version: metadata?.version,
            workspace: workspace.path,
            exportedAt: new Date().toISOString(),
            stats,
            contextPacks: packs.map((pack) => ({
              ...pack,
              createdAt: pack.createdAt.toISOString(),
            })),
          };

          await fs.writeFile(outputPath, JSON.stringify(exportData, null, 2));
          break;
        }
        case 'sqlite': {
          // Copy the database file
          const sourcePath = path.join(workspace.path, '.librarian', 'librarian.sqlite');
          await fs.copyFile(sourcePath, outputPath);
          break;
        }
        default:
          return {
            success: false,
            error: `Export format '${input.format}' not yet supported`,
            format: input.format,
            outputPath: input.outputPath,
          };
      }

      return {
        success: true,
        format: input.format,
        outputPath,
        workspace: workspace.path,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        format: input.format,
        outputPath: input.outputPath,
      };
    }
  }

  private async executeGetContextPackBundle(input: GetContextPackBundleToolInput): Promise<unknown> {
    const bundleId = this.generateId();

    try {
      const workspace = this.findReadyWorkspace();
      if (!workspace) {
        return {
          bundleId,
          packs: [],
          error: 'No indexed workspace available',
          entityIds: input.entityIds,
        };
      }

      const storage = await this.getOrCreateStorage(workspace.path);
      const bundledPacks: unknown[] = [];

      // Collect packs for each entity
      for (const entityId of input.entityIds) {
        // Try different pack types
        const packTypes = input.bundleType === 'comprehensive'
          ? ['function_context', 'module_context', 'change_impact', 'pattern_context']
          : input.bundleType === 'standard'
            ? ['function_context', 'module_context']
            : ['function_context'];

        for (const packType of packTypes) {
          const pack = await storage.getContextPackForTarget(entityId, packType);
          if (pack) {
            const syntheticInput: QueryToolInput = {
              intent: `context bundle for ${entityId}`,
              workspace: workspace.path,
            };
            const confidenceTier = this.classifyExplainabilityConfidenceTier(pack.confidence ?? 0);
            const retrievalRationale = this.buildRetrievalRationale(pack, syntheticInput);
            const coverageNote = this.buildCoverageNote(pack);
            const confidenceStatement = this.buildConfidenceStatement(confidenceTier, pack);
            const verificationGuidance = this.buildVerificationGuidance(confidenceTier);
            const confidenceBreakdown = this.buildConfidenceBreakdown(pack, confidenceTier);
            bundledPacks.push({
              packId: pack.packId,
              packType: pack.packType,
              targetId: pack.targetId,
              summary: pack.summary,
              keyFacts: pack.keyFacts,
              relatedFiles: pack.relatedFiles,
              confidence: pack.confidence,
              confidenceTier,
              confidence_tier: confidenceTier,
              confidenceStatement,
              confidence_statement: confidenceStatement,
              verificationGuidance,
              verification_guidance: verificationGuidance,
              confidenceBreakdown,
              confidence_breakdown: confidenceBreakdown,
              retrievalRationale,
              retrieval_rationale: retrievalRationale,
              coverageNote,
              coverage_note: coverageNote,
            });
          }
        }
      }

      // Apply token budget if specified
      let truncatedByTokens = false;
      let tokenFilteredPacks = bundledPacks;
      if (input.maxTokens) {
        let estimatedTokens = 0;
        const filteredPacks: unknown[] = [];
        for (const pack of bundledPacks) {
          const packTokens = estimateTokens(JSON.stringify(pack));
          if (estimatedTokens + packTokens <= input.maxTokens) {
            filteredPacks.push(pack);
            estimatedTokens += packTokens;
          } else {
            truncatedByTokens = true;
            break;
          }
        }
        tokenFilteredPacks = filteredPacks;
      }

      const { items: pagedPacks, pagination } = this.paginateItems(tokenFilteredPacks, input);
      const aggregateConfidence = this.buildAggregateConfidence(
        (pagedPacks as Array<{
          packId: string;
          packType: string;
          confidence?: number;
          confidenceTier: RetrievalConfidenceTier;
        }>)
      );
      const estimatedTokens = Math.round(
        (pagedPacks as unknown[]).reduce<number>(
          (sum, pack) => sum + estimateTokens(JSON.stringify(pack)),
          0
        )
      );

      if (input.outputFile) {
        const reference = await this.writeOutputReference(
          input.outputFile,
          {
            bundleId,
            entityIds: input.entityIds,
            bundleType: input.bundleType ?? 'minimal',
            packs: pagedPacks,
            pagination,
            truncated: truncatedByTokens,
            truncatedByTokens,
            estimatedTokens,
            aggregateConfidence,
            aggregate_confidence: this.toAggregateConfidenceAlias(aggregateConfidence),
            coverageGaps: [],
            coverage_gaps: [],
            sortOrder: 'entity_then_pack_type',
          },
          pagination,
          workspace.path
        );
        return {
          bundleId,
          entityIds: input.entityIds,
          bundleType: input.bundleType ?? 'minimal',
          truncated: truncatedByTokens,
          truncatedByTokens,
          estimatedTokens,
          aggregateConfidence,
          aggregate_confidence: this.toAggregateConfidenceAlias(aggregateConfidence),
          coverageGaps: [],
          coverage_gaps: [],
          sortOrder: 'entity_then_pack_type',
          ...reference,
        };
      }

      return {
        bundleId,
        packs: pagedPacks,
        entityIds: input.entityIds,
        bundleType: input.bundleType ?? 'minimal',
        truncated: truncatedByTokens,
        truncatedByTokens,
        estimatedTokens,
        aggregateConfidence,
        aggregate_confidence: this.toAggregateConfidenceAlias(aggregateConfidence),
        coverageGaps: [],
        coverage_gaps: [],
        pagination,
        sortOrder: 'entity_then_pack_type',
      };
    } catch (error) {
      return {
        bundleId,
        packs: [],
        error: error instanceof Error ? error.message : String(error),
        entityIds: input.entityIds,
      };
    }
  }

  /**
   * Find a workspace with ready index.
   */
  private findReadyWorkspace(): WorkspaceState | undefined {
    for (const [, ws] of this.state.workspaces) {
      if (ws.indexState === 'ready') {
        return ws;
      }
    }
    // Fall back to any workspace with storage
    for (const [, ws] of this.state.workspaces) {
      if (ws.storage) {
        return ws;
      }
    }
    return undefined;
  }

  // ============================================================================
  // RESOURCE IMPLEMENTATIONS
  // ============================================================================

  private parseResourceUri(uri: string): { workspace: string; resourceType: string } | null {
    // Handle global resources
    if (uri === 'librarian://audits') {
      return { workspace: '', resourceType: 'audits' };
    }

    const match = uri.match(/^librarian:\/\/(.+?)\/(.+)$/);
    if (!match) return null;
    return { workspace: match[1], resourceType: match[2] };
  }

  private async getResourceData(workspace: string, resourceType: string): Promise<unknown> {
    // Handle global resources
    if (resourceType === 'audits') {
      return {
        audits: this.state.auditLog
          .filter((entry) => entry.operation === 'tool_call' && entry.name === 'run_audit')
          .slice(-20)
          .map((entry) => ({
            id: entry.id,
            timestamp: entry.timestamp,
            status: entry.status,
            durationMs: entry.durationMs,
          })),
      };
    }

    // Get workspace storage
    const workspacePath = this.resolveWorkspacePath(workspace);
    if (!workspacePath) {
      throw new Error(`Workspace not registered: ${workspace}`);
    }

    const storage = await this.getOrCreateStorage(workspacePath);

    switch (resourceType) {
      case 'file-tree': {
        const files = await storage.getFiles();
        const directories = await storage.getDirectories();
        return {
          workspace: workspacePath,
          files: files.map((f) => ({
            id: f.id,
            path: f.path,
            category: f.category,
            extension: f.extension,
            purpose: f.purpose,
          })),
          directories: directories.map((d) => ({
            id: d.id,
            path: d.path,
            purpose: d.purpose,
          })),
          counts: {
            files: files.length,
            directories: directories.length,
          },
        };
      }

      case 'symbols': {
        const functions = await storage.getFunctions();
        const modules = await storage.getModules();
        return {
          workspace: workspacePath,
          functions: functions.slice(0, 200).map((f) => ({
            id: f.id,
            name: f.name,
            filePath: f.filePath,
            signature: f.signature,
            confidence: f.confidence,
          })),
          modules: modules.slice(0, 100).map((m) => ({
            id: m.id,
            name: path.basename(m.path),
            path: m.path,
            exports: m.exports,
            dependencies: m.dependencies,
          })),
          counts: {
            functions: functions.length,
            modules: modules.length,
          },
        };
      }

      case 'knowledge-maps': {
        const stats = await storage.getStats();
        return {
          workspace: workspacePath,
          stats: {
            totalFunctions: stats.totalFunctions,
            totalModules: stats.totalModules,
            totalContextPacks: stats.totalContextPacks,
            averageConfidence: stats.averageConfidence,
          },
        };
      }

      case 'method-packs': {
        const packs = await storage.getContextPacks({ limit: 50 });
        return {
          workspace: workspacePath,
          packs: packs.map((pack) => ({
            packId: pack.packId,
            packType: pack.packType,
            targetId: pack.targetId,
            summary: pack.summary,
            confidence: pack.confidence,
            relatedFiles: pack.relatedFiles,
          })),
          count: packs.length,
        };
      }

      case 'provenance': {
        const metadata = await storage.getMetadata();
        const lastBootstrap = await storage.getLastBootstrapReport();
        return {
          workspace: workspacePath,
          version: metadata?.version,
          lastBootstrap: lastBootstrap ? {
            startedAt: lastBootstrap.startedAt.toISOString(),
            completedAt: lastBootstrap.completedAt?.toISOString(),
            success: lastBootstrap.success,
            filesProcessed: lastBootstrap.totalFilesProcessed,
            functionsIndexed: lastBootstrap.totalFunctionsIndexed,
            contextPacksCreated: lastBootstrap.totalContextPacksCreated,
          } : null,
          indexedAt: metadata?.lastIndexing?.toISOString(),
          qualityTier: metadata?.qualityTier,
        };
      }

      case 'identity': {
        const metadata = await storage.getMetadata();
        return {
          workspace: workspacePath,
          workspaceName: path.basename(workspacePath),
          version: metadata?.version,
          qualityTier: metadata?.qualityTier,
          fileCount: metadata?.totalFiles,
          functionCount: metadata?.totalFunctions,
          contextPackCount: metadata?.totalContextPacks,
        };
      }

      default:
        throw new Error(`Unknown resource type: ${resourceType}`);
    }
  }

  /**
   * Resolve a workspace path from registered workspaces.
   */
  private resolveWorkspacePath(workspace: string): string | null {
    // Direct match
    if (this.state.workspaces.has(workspace)) {
      return workspace;
    }

    // Check if workspace matches any registered path
    for (const [registeredPath] of this.state.workspaces) {
      if (registeredPath.endsWith(workspace) || workspace.endsWith(registeredPath)) {
        return registeredPath;
      }
    }

    // If only one workspace is registered, use it
    if (this.state.workspaces.size === 1) {
      return this.state.workspaces.keys().next().value as string;
    }

    return null;
  }

  // ============================================================================
  // UTILITIES
  // ============================================================================

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  }

  private sanitizeInput(input: unknown): unknown {
    // Remove sensitive data from audit logs
    if (typeof input !== 'object' || input === null) return input;
    const sanitized = { ...input as object };
    // Remove potential secrets
    for (const key of ['password', 'secret', 'token', 'apiKey', 'credentials']) {
      if (key in sanitized) {
        (sanitized as Record<string, unknown>)[key] = '[REDACTED]';
      }
    }
    return sanitized;
  }

  private logAudit(entry: AuditLogEntry): void {
    this.state.auditLog.push(entry);

    // Trim old entries if needed
    const maxEntries = 10000;
    if (this.state.auditLog.length > maxEntries) {
      this.state.auditLog = this.state.auditLog.slice(-maxEntries);
    }

    // Log to console in debug mode
    if (process.env.DEBUG_MCP) {
      console.error(`[MCP Audit] ${entry.operation}: ${entry.name} - ${entry.status}`);
    }
  }

  /**
   * Register a workspace.
   */
  registerWorkspace(path: string): void {
    if (!this.state.workspaces.has(path)) {
      this.state.workspaces.set(path, {
        path,
        indexState: 'pending',
      });
    }
  }

  /**
   * Update workspace state.
   */
  updateWorkspaceState(path: string, state: Partial<WorkspaceState>): void {
    const workspace = this.state.workspaces.get(path);
    if (workspace) {
      Object.assign(workspace, state);
    }
  }

  /**
   * Get audit log entries.
   */
  getAuditLog(options?: { limit?: number; since?: string }): AuditLogEntry[] {
    let entries = this.state.auditLog;

    if (options?.since) {
      entries = entries.filter((e) => e.timestamp >= options.since!);
    }

    if (options?.limit) {
      entries = entries.slice(-options.limit);
    }

    return entries;
  }

  // ============================================================================
  // SERVER LIFECYCLE
  // ============================================================================

  /**
   * Start the server with stdio transport.
   */
  async start(): Promise<void> {
    this.transport = new StdioServerTransport();
    await this.server.connect(this.transport);
    console.error(`[MCP] Librarian server started (${this.config.name} v${this.config.version})`);
  }

  /**
   * Stop the server.
   */
  async stop(): Promise<void> {
    // Stop file watchers for all workspaces
    for (const [, workspace] of this.state.workspaces) {
      if (workspace.librarian && workspace.watching) {
        workspace.librarian.stopWatching();
      }
    }

    if (this.transport) {
      await this.server.close();
      this.transport = null;
    }
    console.error('[MCP] Librarian server stopped');
  }

  /**
   * Get server info.
   */
  getServerInfo(): {
    name: string;
    version: string;
    workspaceCount: number;
    auditLogSize: number;
    activeSessions: number;
  } {
    return {
      name: this.config.name,
      version: this.config.version,
      workspaceCount: this.state.workspaces.size,
      auditLogSize: this.state.auditLog.length,
      activeSessions: this.state.authManager.getStats().totalSessions,
    };
  }

  // ==========================================================================
  // AUTHENTICATION API
  // ==========================================================================

  /**
   * Create a new authentication session.
   */
  createAuthSession(options: {
    clientId: string;
    scopes: AuthorizationScope[];
    allowedWorkspaces?: string[];
    ttlMs?: number;
  }): { token: string; sessionId: string; expiresAt: Date } {
    const { token, session } = this.state.authManager.createSession({
      scopes: options.scopes,
      clientId: options.clientId,
      allowedWorkspaces: options.allowedWorkspaces,
      ttlMs: options.ttlMs,
    });

    this.logAudit({
      id: this.generateId(),
      timestamp: new Date().toISOString(),
      operation: 'authorization',
      name: 'session_create',
      status: 'success',
      sessionId: session.id,
    });

    return {
      token,
      sessionId: session.id,
      expiresAt: session.expiresAt,
    };
  }

  /**
   * Validate an authentication token.
   */
  validateAuthToken(token: string): SessionToken | null {
    return this.state.authManager.validateToken(token);
  }

  /**
   * Authorize a tool call with a session token.
   */
  authorizeToolCall(
    token: string,
    toolName: string,
    workspace?: string
  ): AuthorizationResult {
    const session = this.state.authManager.validateToken(token);
    if (!session) {
      return {
        authorized: false,
        reason: 'Invalid or expired token',
      };
    }

    return this.state.authManager.authorize(session, toolName, workspace);
  }

  /**
   * Grant consent for a high-risk operation.
   */
  grantConsent(sessionId: string, operation: string): boolean {
    const result = this.state.authManager.grantConsent(sessionId, operation);

    if (result) {
      this.logAudit({
        id: this.generateId(),
        timestamp: new Date().toISOString(),
        operation: 'authorization',
        name: 'consent_grant',
        status: 'success',
        sessionId,
        input: { operation },
      });
    }

    return result;
  }

  /**
   * Revoke consent for an operation.
   */
  revokeConsent(sessionId: string, operation: string): boolean {
    const result = this.state.authManager.revokeConsent(sessionId, operation);

    if (result) {
      this.logAudit({
        id: this.generateId(),
        timestamp: new Date().toISOString(),
        operation: 'authorization',
        name: 'consent_revoke',
        status: 'success',
        sessionId,
        input: { operation },
      });
    }

    return result;
  }

  /**
   * Revoke an authentication session.
   */
  revokeAuthSession(sessionId: string): boolean {
    const result = this.state.authManager.revokeSession(sessionId);
    if (result) {
      this.state.sessions.delete(sessionId);
    }

    if (result) {
      this.logAudit({
        id: this.generateId(),
        timestamp: new Date().toISOString(),
        operation: 'authorization',
        name: 'session_revoke',
        status: 'success',
        sessionId,
      });
    }

    return result;
  }

  /**
   * Refresh a session to extend its expiration.
   */
  refreshAuthSession(sessionId: string, extendMs?: number): SessionToken | null {
    const session = this.state.authManager.refreshSession(sessionId, extendMs);

    if (session) {
      this.logAudit({
        id: this.generateId(),
        timestamp: new Date().toISOString(),
        operation: 'authorization',
        name: 'session_refresh',
        status: 'success',
        sessionId,
      });
    }

    return session;
  }

  /**
   * Get authentication statistics.
   */
  getAuthStats(): {
    totalSessions: number;
    activeClients: number;
    expiredSessions: number;
  } {
    return this.state.authManager.getStats();
  }

  /**
   * Clean up expired sessions.
   */
  cleanupExpiredSessions(): number {
    return this.state.authManager.cleanup();
  }

  /**
   * Get the authentication manager for advanced operations.
   */
  getAuthManager(): AuthenticationManager {
    return this.state.authManager;
  }
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Create and start a Librarian MCP server.
 */
export async function createLibrarianMCPServer(
  config?: Partial<LibrarianMCPServerConfig>
): Promise<LibrarianMCPServer> {
  const server = new LibrarianMCPServer(config);
  return server;
}

/**
 * Create and start a server with stdio transport.
 */
export async function startStdioServer(
  config?: Partial<LibrarianMCPServerConfig>
): Promise<LibrarianMCPServer> {
  const server = await createLibrarianMCPServer(config);
  await server.start();
  return server;
}

// ============================================================================
// CLI ENTRY POINT
// ============================================================================

/**
 * Main entry point for CLI invocation.
 */
export async function main(): Promise<void> {
  const writeEnabled = process.argv.includes('--write');
  const config: Partial<LibrarianMCPServerConfig> = {
    authorization: {
      enabledScopes: writeEnabled ? ['read', 'write'] : ['read'],
      requireConsent: true,
    },
  };

  const server = await startStdioServer(config);

  // Handle shutdown
  process.on('SIGINT', async () => {
    await server.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await server.stop();
    process.exit(0);
  });
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('[MCP] Fatal error:', error);
    process.exit(1);
  });
}
