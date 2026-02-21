/**
 * @fileoverview Federation Module Exports
 *
 * Cross-repo federation protocol for LiBrainian.
 * Enables querying knowledge across multiple repositories with:
 * - Safe provenance tracking
 * - Trust level boundaries
 * - Conflict resolution
 */

// Types
export type {
  RepoId,
  FederatedRepo,
  FederatedProvenance,
  FederatedEntity,
  FederationScope,
  FederatedQuery,
  FederatedRepoResult,
  FederatedQueryResponse,
  FederatedRelationship,
  FederatedConflict,
  FederationConfig,
} from './types.js';

export { DEFAULT_FEDERATION_CONFIG } from './types.js';

// Registry
export { FederationRegistry } from './registry.js';

// Query Executor
export { FederatedQueryExecutor, type RepoQueryExecutor, type ResultScorer } from './query.js';
