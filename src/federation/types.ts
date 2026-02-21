/**
 * @fileoverview Cross-Repo Federation Types
 *
 * Per docs/librainian/STATUS.md gap #8: Cross-repo federation protocol.
 * This module defines the types for federated queries across multiple repositories.
 *
 * Key requirements:
 * - Shared index format with namespace rules
 * - Conflict resolution for overlapping entities
 * - Provenance separation per repository
 * - Safe query boundaries (no leakage between repos)
 */

// ============================================================================
// REPOSITORY IDENTITY
// ============================================================================

/**
 * Unique identifier for a federated repository.
 * Format: "namespace/repo-name" or absolute path hash.
 */
export type RepoId = string;

/**
 * Repository registration in the federation.
 */
export interface FederatedRepo {
  /** Unique identifier for this repo in the federation */
  repoId: RepoId;
  /** Display name for the repository */
  name: string;
  /** Absolute path to the workspace root */
  workspacePath: string;
  /** Git remote URL (if available) */
  remoteUrl?: string;
  /** Current commit hash */
  currentCommit?: string;
  /** When this repo was last indexed */
  lastIndexedAt: string;
  /** Whether this repo is currently available for queries */
  available: boolean;
  /** Trust level for this repo's knowledge */
  trustLevel: 'local' | 'trusted' | 'untrusted';
  /** Tags for filtering in federated queries */
  tags?: string[];
}

// ============================================================================
// FEDERATED ENTITY PROVENANCE
// ============================================================================

/**
 * Provenance tracking for federated entities.
 * Every entity must clearly indicate which repository it came from.
 */
export interface FederatedProvenance {
  /** Source repository ID */
  repoId: RepoId;
  /** Repository name (for display) */
  repoName: string;
  /** Commit hash when entity was indexed */
  commitHash?: string;
  /** When this entity was last verified */
  verifiedAt: string;
  /** Relative path within the source repo */
  relativePath: string;
  /** Trust level inherited from repo */
  trustLevel: 'local' | 'trusted' | 'untrusted';
}

/**
 * Entity wrapper with federation provenance.
 */
export interface FederatedEntity<T> {
  /** The actual entity data */
  entity: T;
  /** Federation provenance */
  provenance: FederatedProvenance;
  /** Global unique ID (repoId:entityId) */
  federatedId: string;
}

// ============================================================================
// FEDERATED QUERY
// ============================================================================

/**
 * Scope for federated queries.
 */
export interface FederationScope {
  /** Include all registered repos */
  all?: boolean;
  /** Include only specific repos by ID */
  repoIds?: RepoId[];
  /** Include repos with specific tags */
  tags?: string[];
  /** Exclude specific repos */
  excludeRepoIds?: RepoId[];
  /** Minimum trust level required */
  minTrustLevel?: 'local' | 'trusted' | 'untrusted';
}

/**
 * Federated query request.
 */
export interface FederatedQuery {
  /** Original query intent */
  intent: string;
  /** Task type */
  taskType?: string;
  /** Federation scope (which repos to query) */
  scope: FederationScope;
  /** Maximum results per repository */
  maxResultsPerRepo?: number;
  /** Total maximum results */
  maxTotalResults?: number;
  /** Merge strategy for results */
  mergeStrategy: 'interleave' | 'by_repo' | 'score_ranked';
  /** Whether to include cross-repo relationships */
  includeRelationships?: boolean;
}

/**
 * Result from a single repository in a federated query.
 */
export interface FederatedRepoResult<T> {
  /** Repository ID */
  repoId: RepoId;
  /** Repository name */
  repoName: string;
  /** Results from this repo */
  results: FederatedEntity<T>[];
  /** Query latency for this repo (ms) */
  latencyMs: number;
  /** Whether query succeeded */
  success: boolean;
  /** Error message if failed */
  error?: string;
}

/**
 * Aggregated federated query response.
 */
export interface FederatedQueryResponse<T> {
  /** Query ID for tracking */
  queryId: string;
  /** Timestamp */
  timestamp: string;
  /** Per-repo results */
  repoResults: FederatedRepoResult<T>[];
  /** Merged results (if merge strategy specified) */
  merged?: FederatedEntity<T>[];
  /** Cross-repo relationships found */
  relationships?: FederatedRelationship[];
  /** Total query time (ms) */
  totalLatencyMs: number;
  /** Federation statistics */
  stats: {
    reposQueried: number;
    reposSucceeded: number;
    reposFailed: number;
    totalResults: number;
  };
}

// ============================================================================
// CROSS-REPO RELATIONSHIPS
// ============================================================================

/**
 * Relationship between entities in different repositories.
 */
export interface FederatedRelationship {
  /** Relationship type */
  type: 'dependency' | 'reference' | 'similar' | 'cochange';
  /** Source entity (global ID) */
  sourceId: string;
  /** Source repo */
  sourceRepoId: RepoId;
  /** Target entity (global ID) */
  targetId: string;
  /** Target repo */
  targetRepoId: RepoId;
  /** Relationship strength/confidence */
  strength: number;
  /** Evidence for this relationship */
  evidence?: string;
}

// ============================================================================
// CONFLICT RESOLUTION
// ============================================================================

/**
 * Conflict when same entity exists in multiple repos.
 */
export interface FederatedConflict {
  /** Entity ID (before repo prefix) */
  entityId: string;
  /** Conflicting versions */
  versions: Array<{
    repoId: RepoId;
    federatedId: string;
    lastModified: string;
    trustLevel: 'local' | 'trusted' | 'untrusted';
  }>;
  /** Resolution strategy used */
  resolution: 'latest' | 'highest_trust' | 'local_first' | 'manual';
  /** Which version was selected */
  selectedFederatedId: string;
}

// ============================================================================
// FEDERATION CONFIGURATION
// ============================================================================

/**
 * Federation configuration.
 */
export interface FederationConfig {
  /** Whether federation is enabled */
  enabled: boolean;
  /** Default merge strategy */
  defaultMergeStrategy: 'interleave' | 'by_repo' | 'score_ranked';
  /** Default conflict resolution */
  defaultConflictResolution: 'latest' | 'highest_trust' | 'local_first' | 'manual';
  /** Maximum repos to query in parallel */
  maxParallelRepos: number;
  /** Query timeout per repo (ms) */
  repoTimeoutMs: number;
  /** Whether to include untrusted repos by default */
  includeUntrustedByDefault: boolean;
  /** Path to federation state file */
  statePath: string;
}

/**
 * Default federation configuration.
 */
export const DEFAULT_FEDERATION_CONFIG: FederationConfig = {
  enabled: false,
  defaultMergeStrategy: 'score_ranked',
  defaultConflictResolution: 'highest_trust',
  maxParallelRepos: 4,
  repoTimeoutMs: 30000,
  includeUntrustedByDefault: false,
  statePath: '.librainian/federation.json',
};
