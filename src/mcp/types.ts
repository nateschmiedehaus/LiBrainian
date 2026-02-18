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
}

/** Query tool input */
export interface QueryToolInput {
  /** Query intent/question */
  intent: string;

  /** Workspace path (optional, uses first ready workspace if not specified) */
  workspace?: string;

  /** Optional session identifier for loop detection and adaptive retrieval behavior */
  sessionId?: string;

  /** Typed query intent */
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
  message: string;
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

export interface ContextPackSummary {
  /** Pack ID */
  packId: string;

  /** Pack type */
  packType: string;

  /** Summary */
  summary: string;

  /** Confidence */
  confidence: number;

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
  query: {
    tool: 'query',
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
  get_change_impact: {
    tool: 'get_change_impact',
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

/** Type guard for QueryToolInput */
export function isQueryToolInput(value: unknown): value is QueryToolInput {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  const intentOk = typeof obj.intent === 'string';
  const sessionIdOk = typeof obj.sessionId === 'string' || typeof obj.sessionId === 'undefined';
  const pageSizeOk = typeof obj.pageSize === 'number' || typeof obj.pageSize === 'undefined';
  const pageIdxOk = typeof obj.pageIdx === 'number' || typeof obj.pageIdx === 'undefined';
  const outputFileOk = typeof obj.outputFile === 'string' || typeof obj.outputFile === 'undefined';
  return intentOk && sessionIdOk && pageSizeOk && pageIdxOk && outputFileOk;
}

/** Type guard for ResetSessionStateToolInput */
export function isResetSessionStateToolInput(value: unknown): value is ResetSessionStateToolInput {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  const sessionIdOk = typeof obj.sessionId === 'string' || typeof obj.sessionId === 'undefined';
  const workspaceOk = typeof obj.workspace === 'string' || typeof obj.workspace === 'undefined';
  return sessionIdOk && workspaceOk;
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

/** Type guard for VerifyClaimToolInput */
export function isVerifyClaimToolInput(value: unknown): value is VerifyClaimToolInput {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.claimId === 'string';
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
