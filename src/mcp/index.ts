/**
 * @fileoverview MCP Module - Model Context Protocol Server for Librarian
 *
 * This module provides the MCP server implementation for Librarian:
 * - Resources: file tree, symbols, knowledge maps, method packs, audits, provenance, identity
 * - Tools: bootstrap, status, system_contract, diagnose_self, query, find_symbol, verify_claim, run_audit, diff_runs, export_index, get_context_pack_bundle, list_*, compile_*
 * - Authorization and consent hooks
 * - Audit trail integration
 *
 * @packageDocumentation
 */

// Types
export {
  MCP_SCHEMA_VERSION,

  // Resource types
  type LibrarianResource,
  type ResourceProvenance,
  type FileTreeResource,
  type FileTreeNode,
  type SymbolsResource,
  type SymbolInfo,
  type SymbolKind,
  type KnowledgeMapsResource,
  type KnowledgeMapInfo,
  type MethodPacksResource,
  type MethodPackInfo,
  type AuditsResource,
  type AuditInfo,
  type ProvenanceResource,
  type WorkspaceProvenance,
  type IndexProvenance,
  type OperationProvenance,
  type RepoIdentityResource,

  // Tool input types
  type QueryIntent,
  type BootstrapToolInput,
  type BootstrapToolOutput,
  type StatusToolInput,
  type SystemContractToolInput,
  type DiagnoseSelfToolInput,
  type QueryToolInput,
  type QueryToolOutput,
  type ContextPackSummary,
  type EvidenceSummary,
  type FindSymbolKind,
  type FindSymbolMatch,
  type FindSymbolToolInput,
  type FindSymbolToolOutput,
  type VerifyClaimToolInput,
  type VerifyClaimToolOutput,
  type RunAuditToolInput,
  type RunAuditToolOutput,
  type AuditFinding,
  type ListRunsToolInput,
  type DiffRunsToolInput,
  type DiffRunsToolOutput,
  type RunDiff,
  type ExportIndexToolInput,
  type ExportIndexToolOutput,
  type GetContextPackBundleToolInput,
  type GetContextPackBundleToolOutput,

  // Authorization types
  type AuthorizationScope,
  type ToolAuthorization,
  TOOL_AUTHORIZATION,

  // Server config
  type LibrarianMCPServerConfig,
  DEFAULT_MCP_SERVER_CONFIG,

  // Type guards
  isBootstrapToolInput,
  isQueryToolInput,
  isFindSymbolToolInput,
  isVerifyClaimToolInput,
  isRunAuditToolInput,
  isListRunsToolInput,
  isDiffRunsToolInput,
  isExportIndexToolInput,
  isGetContextPackBundleToolInput,
  isLibrarianResource,
} from './types.js';

// Schema and validation
export {
  SCHEMA_VERSION,
  JSON_SCHEMA_DRAFT,

  // Zod schemas
  QueryIntentSchema,
  DepthSchema,
  LLMProviderSchema,
  ExportFormatSchema,
  AuditTypeSchema,
  BundleTypeSchema,
  BootstrapToolInputSchema,
  StatusToolInputSchema,
  SystemContractToolInputSchema,
  DiagnoseSelfToolInputSchema,
  QueryToolInputSchema,
  FindSymbolToolInputSchema,
  VerifyClaimToolInputSchema,
  RunAuditToolInputSchema,
  ListRunsToolInputSchema,
  DiffRunsToolInputSchema,
  ExportIndexToolInputSchema,
  GetContextPackBundleToolInputSchema,

  // Schema registry
  TOOL_INPUT_SCHEMAS,
  type ToolName,

  // JSON Schema types
  type JSONSchema,
  type JSONSchemaProperty,
  JSON_SCHEMAS,

  // Validation
  type ValidationResult,
  type ValidationError,
  validateToolInput,
  getToolSchema,
  getToolJsonSchema,
  listToolSchemas,
  parseToolInput,
  safeParseToolInput,
} from './schema.js';

// Server
export {
  LibrarianMCPServer,
  createLibrarianMCPServer,
  startStdioServer,
  main as startMCPServer,
  type ServerState,
  type WorkspaceState,
  type SessionState,
  type AuditLogEntry,
} from './server.js';

// Authentication
export {
  AuthenticationManager,
  createAuthenticationManager,
  getToolAuthorization,
  checkToolScopes,
  getAvailableTools,
  computeRequiredScopes,
  DEFAULT_AUTH_CONFIG,
  type SessionToken,
  type SessionMetadata,
  type TokenOptions,
  type AuthorizationResult,
  type AuthenticationConfig,
} from './authentication.js';

// Audit Logging
export {
  AuditLogger,
  createAuditLogger,
  DEFAULT_AUDIT_CONFIG,
  type AuditEvent,
  type AuditEventType,
  type AuditSeverity,
  type AuditStatus,
  type AuditQueryOptions,
  type AuditStats,
  type AuditExportFormat,
  type AuditLoggerConfig,
} from './audit.js';
