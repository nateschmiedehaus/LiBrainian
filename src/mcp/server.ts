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
  type QueryToolInput,
  type GetChangeImpactToolInput,
  type SubmitFeedbackToolInput,
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
import { submitQueryFeedback } from '../integration/agent_protocol.js';
import { createSqliteStorage, type LibrarianStorage } from '../storage/index.js';
import { checkDefeaters, STANDARD_DEFEATERS } from '../knowledge/defeater_activation.js';
import {
  AuthenticationManager,
  createAuthenticationManager,
  type SessionToken,
  type AuthorizationResult,
} from './authentication.js';
import * as path from 'path';
import * as fs from 'fs/promises';
import { createAuditLogger, type AuditLogger } from './audit.js';
import { SqliteEvidenceLedger } from '../epistemics/evidence_ledger.js';
import { AuditBackedToolAdapter, type ToolAdapter } from '../adapters/tool_adapter.js';

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
  get_change_impact: { readOnlyHint: true, openWorldHint: false, requiresIndex: true, requiresEmbeddings: false, estimatedTokens: 2600 },
  submit_feedback: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false, requiresIndex: true, requiresEmbeddings: false, estimatedTokens: 1500 },
  verify_claim: { readOnlyHint: true, openWorldHint: false, requiresIndex: true, requiresEmbeddings: false, estimatedTokens: 3200 },
  run_audit: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false, requiresIndex: true, requiresEmbeddings: false, estimatedTokens: 5200 },
  diff_runs: { readOnlyHint: true, openWorldHint: false, requiresIndex: true, requiresEmbeddings: false, estimatedTokens: 3500 },
  list_runs: { readOnlyHint: true, openWorldHint: false, requiresIndex: false, requiresEmbeddings: false, estimatedTokens: 1200 },
  export_index: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false, requiresIndex: true, requiresEmbeddings: false, estimatedTokens: 2500 },
  get_context_pack_bundle: { readOnlyHint: true, openWorldHint: false, requiresIndex: true, requiresEmbeddings: true, estimatedTokens: 4000 },
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
const DEFAULT_RUN_LIST_LIMIT = 10;
const MAX_RUN_LIST_LIMIT = 100;
const BOOTSTRAP_RUN_HISTORY_STATE_KEY = 'librarian.mcp.bootstrap_runs.v1';
const BOOTSTRAP_RUN_HISTORY_SCHEMA_VERSION = 1;
const MAX_PERSISTED_BOOTSTRAP_RUNS = 50;

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
          'Use query to discover relevant claim IDs first.',
          'Retry verify_claim with a valid claimId from query output.',
        ],
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

  return {
    ...base,
    error: true,
    code,
    message: parsedMessage.userMessage || 'Tool execution failed.',
    nextSteps: suppliedNextSteps.length > 0 ? suppliedNextSteps : nextSteps,
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
    this.config = { ...DEFAULT_MCP_SERVER_CONFIG, ...config };
    this.state = {
      workspaces: new Map(),
      sessions: new Map(),
      auditLog: [],
      authManager: createAuthenticationManager({
        maxSessionsPerClient: 10,
        allowScopeEscalation: false,
      }),
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
        description: 'Compile a technique composition into a work template',
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
        name: 'query',
        description: 'Query the knowledge base for context and insights (typically 3-15KB per page at pageSize=20)',
        inputSchema: {
          type: 'object',
          properties: {
            intent: { type: 'string', description: 'Query intent or question' },
            workspace: { type: 'string', description: 'Workspace path (optional, uses first ready workspace if not specified)' },
            intentType: { type: 'string', enum: ['understand', 'debug', 'refactor', 'impact', 'security', 'test', 'document', 'navigate', 'general'] },
            affectedFiles: { type: 'array', items: { type: 'string' }, description: 'Scope to files' },
            minConfidence: { type: 'number', description: 'Min confidence (0-1)' },
            depth: { type: 'string', enum: ['L0', 'L1', 'L2', 'L3'], description: 'Context depth' },
            includeEngines: { type: 'boolean', description: 'Include engine results' },
            includeEvidence: { type: 'boolean', description: 'Include evidence graph' },
            pageSize: { type: 'number', description: 'Items per page (default 20, max 200)' },
            pageIdx: { type: 'number', description: 'Zero-based page index (default 0)' },
            outputFile: { type: 'string', description: 'Write page payload to file and return a reference' },
          },
          required: ['intent'],
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
        description: 'Verify a knowledge claim against evidence',
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
        description: 'Compare two indexing runs',
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
        description: 'Get bundled context packs for entities (typically 4-20KB per page at pageSize=20)',
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
            () => this.executeTool(name, validation.data)
          )
        : this.executeTool(name, validation.data);
      const timeoutMs = Math.max(1, Number(this.config.performance.timeoutMs ?? 30000));
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
  private async executeTool(name: string, args: unknown): Promise<unknown> {
    switch (name) {
      case 'bootstrap':
        return this.executeBootstrapDeduped(args as BootstrapToolInput);
      case 'status':
        return this.executeStatus(args as StatusToolInput);
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
      case 'query':
        return this.executeQuery(args as QueryToolInput);
      case 'get_change_impact':
        return this.executeGetChangeImpact(args as GetChangeImpactToolInput);
      case 'submit_feedback':
        return this.executeSubmitFeedback(args as SubmitFeedbackToolInput);
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

  private async executeStatus(input: { workspace?: string }): Promise<unknown> {
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

  private async executeQuery(input: QueryToolInput): Promise<unknown> {
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

      // Build query object
      const query = {
        intent: input.intent,
        intentType: input.intentType,
        affectedFiles: input.affectedFiles,
        minConfidence: input.minConfidence,
        depth: (input.depth as 'L0' | 'L1' | 'L2' | 'L3') ?? 'L1',
      };

      // Execute query
      const response = await queryLibrarian(
        query,
        storage,
        undefined,
        undefined,
        undefined,
        {
          evidenceLedger: workspace.evidenceLedger,
        }
      );

      const transformedPacks = response.packs.map((pack) => ({
        packId: pack.packId,
        packType: pack.packType,
        targetId: pack.targetId,
        summary: pack.summary,
        keyFacts: pack.keyFacts,
        relatedFiles: pack.relatedFiles,
        confidence: pack.confidence,
      }));
      const { items: pagedPacks, pagination } = this.paginateItems(transformedPacks, input);
      const { userDisclosures, epistemicsDebug } = sanitizeDisclosures(response.disclosures);
      const retrievalEntropy = response.retrievalEntropy
        ?? computeRetrievalEntropy(response.packs.map((pack) => ({ confidence: pack.confidence ?? 0 })));
      const retrievalStatus = response.retrievalStatus
        ?? categorizeRetrievalStatus({
          totalConfidence: response.totalConfidence,
          packCount: response.packs.length,
        });
      const retrievalInsufficient = response.retrievalInsufficient ?? retrievalStatus === 'insufficient';

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
        cacheHit: response.cacheHit,
        latencyMs: response.latencyMs,
        drillDownHints: response.drillDownHints,
        synthesis: response.synthesis,
        synthesisMode: response.synthesisMode,
        llmError: response.llmError ? parseEpistemicMessage(response.llmError).userMessage : response.llmError,
        intent: input.intent,
        pagination,
        sortOrder: 'retrieval_score_desc',
        epistemicsDebug: epistemicsDebug.length ? epistemicsDebug : undefined,
      };

      if (input.outputFile) {
        const reference = await this.writeOutputReference(
          input.outputFile,
          {
            ...baseResult,
            packs: pagedPacks,
          },
          pagination,
          workspace.path
        );
        return {
          ...baseResult,
          ...reference,
        };
      }

      // Transform response for MCP
      return {
        ...baseResult,
        packs: pagedPacks,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const parsedError = parseEpistemicMessage(message);
      const rawDisclosure = message.startsWith('unverified_by_trace')
        ? message
        : `unverified_by_trace(query_failed): ${message}`;
      const { userDisclosures, epistemicsDebug } = sanitizeDisclosures([rawDisclosure]);
      return {
        packs: [],
        totalConfidence: 0,
        retrievalStatus: 'insufficient',
        retrievalEntropy: 0,
        retrievalInsufficient: true,
        suggestedClarifyingQuestions: [],
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
            bundledPacks.push({
              packId: pack.packId,
              packType: pack.packType,
              targetId: pack.targetId,
              summary: pack.summary,
              keyFacts: pack.keyFacts,
              relatedFiles: pack.relatedFiles,
              confidence: pack.confidence,
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
